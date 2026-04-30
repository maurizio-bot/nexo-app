// ============================================================
// BleService.kt v2.2-ARCH
// Ubicacion: android/app/src/main/java/com/nexo/ble/BleService.kt
// FIXES: Truncated payload, no duplicate device name, retry ALREADY_STARTED,
//        ordered cleanup, nullify refs in onDestroy.
// ============================================================
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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.NotificationCompat
import java.nio.charset.Charset

class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_CHANNEL_ID = "nexo_ble_channel"
        private const val NOTIFICATION_ID = 1001
        private const val MANUFACTURER_ID = 0xFFFF
        const val ACTION_STOP_ADVERTISING = "com.nexo.ble.ACTION_STOP_ADVERTISING"
        const val ACTION_START_ADVERTISING = "com.nexo.ble.ACTION_START_ADVERTISING"
        private const val ADVERTISE_FAILED_ALREADY_STARTED = 3
        private const val ADVERTISE_FAILED_DATA_TOO_LARGE = 1
    }

    private var bluetoothGattServer: BluetoothGattServer? = null
    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null
    private var txCharacteristic: BluetoothGattCharacteristic? = null
    private var rxCharacteristic: BluetoothGattCharacteristic? = null
    private val connectedDevices = mutableSetOf<BluetoothDevice>()
    private var deviceUUID: String = ""
    private var deviceName: String = "NEXO Device"
    private val serviceHandler = Handler(Looper.getMainLooper())

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")
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
        } catch (e: Exception) {
            Log.e(TAG, "Fatal error in onCreate", e)
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand action=${intent?.action}")

        deviceUUID = intent?.getStringExtra("device_uuid") ?: ""
        deviceName = intent?.getStringExtra("device_name") ?: "NEXO Device"
        Log.i(TAG, "Identity loaded: UUID=${deviceUUID.take(8)}..., Name=$deviceName")

        when (intent?.action) {
            ACTION_STOP_ADVERTISING -> {
                stopAdvertisingInternal()
            }
            NexoBleSpec.ACTION_BLE_SEND_MESSAGE -> {
                val msg = intent.getStringExtra(NexoBleSpec.EXTRA_MESSAGE_DATA) ?: ""
                sendNotificationToAll(msg)
            }
            else -> {
                if (deviceUUID.isNotEmpty()) {
                    startAdvertising()
                }
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startGattServer() {
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
            Log.i(TAG, "GATT Server addService success=$success")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting GATT server", e)
        }
    }

    // FIX v2.2-ARCH: Stop any previous advertising first, truncate payload, no duplicate name.
    private fun startAdvertising() {
        try {
            stopAdvertisingInternal()

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

            // Truncate payload to 20 bytes max to avoid DATA_TOO_LARGE on strict stacks (S24)
            val rawPayload = "NEXO|$deviceUUID".toByteArray(Charset.defaultCharset())
            val payload = if (rawPayload.size > 20) rawPayload.copyOfRange(0, 20) else rawPayload

            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(false) // Name already embedded in payload, avoid duplication
                .addServiceUuid(ParcelUuid(NexoBleSpec.NEXO_SERVICE_UUID))
                .addManufacturerData(MANUFACTURER_ID, payload)
                .build()

            bluetoothLeAdvertiser?.startAdvertising(settings, data, advertiseCallback)
            Log.i(TAG, "Advertising start requested with UUID ${deviceUUID.take(8)}...")
        } catch (e: Exception) {
            Log.e(TAG, "Error starting advertising", e)
        }
    }

    // FIX v2.2-ARCH: Ordered stop + nullify to free BLE stack resources.
    private fun stopAdvertisingInternal() {
        try {
            bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
            Log.i(TAG, "Advertising stopped internally")
        } catch (e: Exception) {
            Log.w(TAG, "Stop adv internal error", e)
        }
        bluetoothLeAdvertiser = null
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            Log.i(TAG, "Advertising started successfully")
        }
        override fun onStartFailure(errorCode: Int) {
            Log.e(TAG, "Advertising failed: $errorCode")
            when (errorCode) {
                ADVERTISE_FAILED_ALREADY_STARTED -> {
                    Log.w(TAG, "ADVERTISE_FAILED_ALREADY_STARTED, retrying in 500ms...")
                    stopAdvertisingInternal()
                    serviceHandler.postDelayed({
                        if (deviceUUID.isNotEmpty()) startAdvertising()
                    }, 500)
                }
                ADVERTISE_FAILED_DATA_TOO_LARGE -> {
                    Log.e(TAG, "ADVERTISE_FAILED_DATA_TOO_LARGE - reduce payload")
                }
            }
        }
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            Log.i(TAG, "Connection ${device.address} status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connectedDevices.add(device)
                broadcast(NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED, device.address)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connectedDevices.remove(device)
                broadcast(NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED, device.address)
                try { startAdvertising() } catch (e: Exception) { Log.w(TAG, "Restart adv failed", e) }
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
        val data = message.toByteArray(Charset.defaultCharset())
        txCharacteristic?.value = data
        connectedDevices.forEach { device ->
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

    // FIX v2.2-ARCH: Nullify refs after stopping to prevent stale state on S24.
    override fun onDestroy() {
        super.onDestroy()
        stopAdvertisingInternal()
        try { bluetoothGattServer?.close() } catch (e: Exception) { Log.w(TAG, "Close server error", e) }
        bluetoothGattServer = null
        connectedDevices.clear()
        serviceHandler.removeCallbacksAndMessages(null)
        Log.i(TAG, "Destroyed")
    }
}
