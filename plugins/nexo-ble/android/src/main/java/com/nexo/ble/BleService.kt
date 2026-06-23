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
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.ParcelUuid
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import java.nio.charset.Charset
import java.util.concurrent.ConcurrentHashMap

/**
 * BleService v2.0 - DUAL GATT SUPPORT
 * 
 * Este servicio mantiene:
 * 1. GATT Server local (para que otros dispositivos se conecten a nosotros)
 * 2. BLE Advertising (para que otros nos encuentren)
 * 
 * NOTA: Las conexiones GATT Client (nosotros conectandonos a otros) 
 * ahora se manejan directamente en NexoBlePlugin.kt para tener
 * multiples conexiones simultaneas.
 */
class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_CHANNEL_ID = "nexo_ble_channel"
        private const val NOTIFICATION_ID = 1001
    }

    private fun showToast(message: String) {
        try {
            Toast.makeText(applicationContext, message, Toast.LENGTH_SHORT).show()
        } catch (e: Exception) { }
    }

    private var bluetoothGattServer: BluetoothGattServer? = null
    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null
    private var txCharacteristic: BluetoothGattCharacteristic? = null
    private var rxCharacteristic: BluetoothGattCharacteristic? = null
    private val connectedDevices = ConcurrentHashMap<String, BluetoothDevice>()

    override fun onCreate() {
        super.onCreate()
        showToast("[BLE Svc] onCreate - Dual GATT")
        Log.i(TAG, "onCreate - Dual GATT Service")
        try {
            val notification = createNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            startGattServer()
            startAdvertising()
        } catch (e: Exception) {
            showToast("[BLE Svc] FATAL onCreate: ${e.message}")
            Log.e(TAG, "Fatal error in onCreate", e)
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand action=${intent?.action}")
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
        showToast("[BLE Svc] startGattServer...")
        try {
            val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            if (adapter == null || !adapter.isEnabled) {
                Log.e(TAG, "Bluetooth not available")
                return
            }
            bluetoothGattServer = bluetoothManager.openGattServer(this, gattServerCallback)

            val service = android.bluetooth.BluetoothGattService(
                NexoBleSpec.NEXO_SERVICE_UUID,
                android.bluetooth.BluetoothGattService.SERVICE_TYPE_PRIMARY
            )

            txCharacteristic = BluetoothGattCharacteristic(
                NexoBleSpec.TX_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ
            ).apply {
                addDescriptor(BluetoothGattDescriptor(
                    NexoBleSpec.CCCD_UUID,
                    BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
                ))
            }

            rxCharacteristic = BluetoothGattCharacteristic(
                NexoBleSpec.RX_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )

            service.addCharacteristic(txCharacteristic)
            service.addCharacteristic(rxCharacteristic)

            val success = bluetoothGattServer?.addService(service) ?: false
            showToast("[BLE Svc] GATT Server: addService=$success")
            Log.i(TAG, "GATT Server addService success=$success")
        } catch (e: Exception) {
            showToast("[BLE Svc] GATT Server ERROR: ${e.message}")
            Log.e(TAG, "Error starting GATT server", e)
        }
    }

    private fun startAdvertising() {
        showToast("[BLE Svc] startAdvertising...")
        try {
            val bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            if (adapter == null || !adapter.isEnabled) {
                Log.e(TAG, "Bluetooth adapter not available")
                return
            }
            bluetoothLeAdvertiser = adapter.bluetoothLeAdvertiser

            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setConnectable(true)
                .setTimeout(0)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .build()

            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .addServiceUuid(ParcelUuid(NexoBleSpec.NEXO_SERVICE_UUID))
                .build()

            bluetoothLeAdvertiser?.startAdvertising(settings, data, advertiseCallback)
            showToast("[BLE Svc] Advertising iniciado")
        } catch (e: Exception) {
            showToast("[BLE Svc] Advertising ERROR: ${e.message}")
            Log.e(TAG, "Error starting advertising", e)
        }
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            showToast("[BLE Svc] Advertising STARTED")
            Log.i(TAG, "Advertising started")
        }
        override fun onStartFailure(errorCode: Int) {
            showToast("[BLE Svc] Advertising FAILED: $errorCode")
            Log.e(TAG, "Advertising failed: $errorCode")
        }
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            Log.i(TAG, "Connection ${device.address} status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                showToast("[BLE Svc] Device CONNECTED: ${device.address}")
                connectedDevices[device.address] = device
                broadcast(NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED, device.address)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                showToast("[BLE Svc] Device DISCONNECTED: ${device.address}")
                connectedDevices.remove(device.address)
                broadcast(NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED, device.address)
                try { startAdvertising() } catch (e: Exception) { }
            }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice, requestId: Int, offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                val value = characteristic.value ?: ByteArray(0)
                bluetoothGattServer?.sendResponse(device, requestId, android.bluetooth.BluetoothGatt.GATT_SUCCESS, offset, value)
            } else {
                bluetoothGattServer?.sendResponse(device, requestId, android.bluetooth.BluetoothGatt.GATT_READ_NOT_PERMITTED, offset, null)
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            showToast("[BLE Svc] RX WriteRequest from ${device.address}")
            if (characteristic.uuid == NexoBleSpec.RX_CHARACTERISTIC_UUID) {
                val message = value?.toString(Charset.defaultCharset()) ?: ""
                Log.i(TAG, "RX from ${device.address}: $message")
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
            device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
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
        showToast("[BLE Svc] Notify all: ${message.take(20)}...")
        val data = message.toByteArray(Charset.defaultCharset())
        txCharacteristic?.value = data
        connectedDevices.forEach { (_, device) ->
            try {
                bluetoothGattServer?.notifyCharacteristicChanged(device, txCharacteristic, false)
            } catch (e: Exception) {
                Log.e(TAG, "Notify failed for ${device.address}", e)
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
            val channel = NotificationChannel(NOTIFICATION_CHANNEL_ID, "NEXO BLE", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        } ?: Intent()
        val pendingIntent = PendingIntent.getActivity(this, 0, launchIntent, PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("NEXO BLE Activo")
            .setContentText("Servidor GATT + Advertising...")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        super.onDestroy()
        showToast("[BLE Svc] onDestroy")
        try { bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback) } catch (e: Exception) { }
        try { bluetoothGattServer?.close() } catch (e: Exception) { }
        connectedDevices.clear()
        Log.i(TAG, "Destroyed")
    }
}
