package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import java.nio.charset.Charset

/**
 * BleService: Único dueño del GATT Server.
 * Patrón: Android-BLE-Library server example + nRF Toolbox foreground service.
 */
class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_CHANNEL_ID = "nexo_ble_channel"
        private const val NOTIFICATION_ID = 1001
    }

    private var bluetoothGattServer: BluetoothGattServer? = null
    private var txCharacteristic: BluetoothGattCharacteristic? = null
    private var rxCharacteristic: BluetoothGattCharacteristic? = null
    private val connectedDevices = mutableSetOf<BluetoothDevice>()

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, createNotification())
        startGattServer()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            NexoBleSpec.ACTION_BLE_SEND_MESSAGE -> {
                val msg = intent.getStringExtra(NexoBleSpec.EXTRA_MESSAGE_DATA) ?: ""
                sendNotificationToAll(msg)
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startGattServer() {
        val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bluetoothGattServer = bluetoothManager.openGattServer(this, gattServerCallback)

        val service = android.bluetooth.BluetoothGattService(
            NexoBleSpec.NEXO_SERVICE_UUID,
            android.bluetooth.BluetoothGattService.SERVICE_TYPE_PRIMARY
        )

        // TX characteristic: NOTIFY (enviamos datos al central)
        txCharacteristic = BluetoothGattCharacteristic(
            NexoBleSpec.TX_CHARACTERISTIC_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        ).apply {
            addDescriptor(BluetoothGattDescriptor(
                NexoBleSpec.CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            ))
        }

        // RX characteristic: WRITE (el central nos escribe aquí)
        rxCharacteristic = BluetoothGattCharacteristic(
            NexoBleSpec.RX_CHARACTERISTIC_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        service.addCharacteristic(txCharacteristic)
        service.addCharacteristic(rxCharacteristic)

        val success = bluetoothGattServer?.addService(service) ?: false
        Log.i(TAG, "GATT Server addService success=$success")
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            Log.i(TAG, "onConnectionStateChange ${device.address} status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connectedDevices.add(device)
                broadcast(NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED, device.address)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connectedDevices.remove(device)
                broadcast(NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED, device.address)
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            if (characteristic.uuid == NexoBleSpec.RX_CHARACTERISTIC_UUID) {
                val message = value?.toString(Charset.defaultCharset()) ?: ""
                Log.i(TAG, "RX received from ${device.address}: $message")

                // Notificar a la app vía broadcast (patrón nRF Toolbox)
                val intent = Intent(NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED).apply {
                    putExtra(NexoBleSpec.EXTRA_MESSAGE_DATA, message)
                    putExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS, device.address)
                    setPackage(packageName)
                }
                sendBroadcast(intent)

                if (responseNeeded) {
                    bluetoothGattServer?.sendResponse(device, requestId, android.bluetooth.BluetoothGatt.GATT_SUCCESS, offset, value)
                }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            if (descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                descriptor.value = value
                if (responseNeeded) {
                    bluetoothGattServer?.sendResponse(device, requestId, android.bluetooth.BluetoothGatt.GATT_SUCCESS, offset, value)
                }
            }
        }
    }

    private fun sendNotificationToAll(message: String) {
        val data = message.toByteArray(Charset.defaultCharset())
        txCharacteristic?.value = data
        connectedDevices.forEach { device ->
            try {
                bluetoothGattServer?.notifyCharacteristicChanged(device, txCharacteristic, false)
            } catch (e: Exception) {
                Log.e(TAG, "notify failed for ${device.address}", e)
            }
        }
    }

    private fun broadcast(action: String, address: String) {
        val intent = Intent(action).apply {
            putExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS, address)
            setPackage(packageName)
        }
        sendBroadcast(intent)
    }

    private fun createNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "NEXO BLE",
                NotificationManager.IMPORTANCE_LOW
            )
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }

        // FIX: No importar CapacitorActivity. Usar launch intent del package.
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        } ?: Intent()

        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("NEXO BLE Activo")
            .setContentText("Servidor GATT escuchando mensajes...")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        bluetoothGattServer?.close()
        connectedDevices.clear()
        Log.i(TAG, "BleService destroyed")
    }
}
