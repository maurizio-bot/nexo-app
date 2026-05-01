// ============================================================
// BleService.kt — SERVICIO FOREGROUND BLE (advertising + GATT server)
// android/app/src/main/java/com/nexo/ble/BleService.kt
// FIX: Reconstruido tras sobreescritura accidental. UUIDs inline.
// ============================================================
package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
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
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.NotificationCompat
import java.nio.charset.Charset
import java.util.UUID

class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "nexo_ble_channel"

        // UUIDs inline — idénticos a NexoBlePlugin.kt
        private val NEXO_SERVICE_UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
        private val TX_CHARACTERISTIC_UUID = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")
        private val RX_CHARACTERISTIC_UUID = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")
        private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        // Actions — idénticas a NexoBlePlugin.kt
        const val ACTION_BLE_SEND_MESSAGE = "com.nexo.ble.ACTION_BLE_SEND_MESSAGE"
        const val ACTION_BLE_MESSAGE_RECEIVED = "com.nexo.ble.ACTION_BLE_MESSAGE_RECEIVED"
        const val ACTION_BLE_DEVICE_CONNECTED = "com.nexo.ble.ACTION_BLE_DEVICE_CONNECTED"
        const val ACTION_BLE_DEVICE_DISCONNECTED = "com.nexo.ble.ACTION_BLE_DEVICE_DISCONNECTED"
        const val EXTRA_MESSAGE_DATA = "message_data"
        const val EXTRA_DEVICE_ADDRESS = "device_address"
    }

    private val binder = LocalBinder()
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null
    private var bluetoothGattServer: BluetoothGattServer? = null
    private var gattService: android.bluetooth.BluetoothGattService? = null
    private var txCharacteristic: BluetoothGattCharacteristic? = null
    private var rxCharacteristic: BluetoothGattCharacteristic? = null

    private val connectedDevices = mutableMapOf<String, BluetoothDevice>()
    private val deviceNotificationsEnabled = mutableMapOf<String, Boolean>()
    private var messageReceiver: BroadcastReceiver? = null
    private var isAdvertising = false

    inner class LocalBinder : Binder() {
        fun getService(): BleService = this@BleService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")
        bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        createNotificationChannel()
        registerMessageReceiver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand")
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        startBleStack()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "onDestroy — deteniendo BLE stack")
        stopBleStack()
        unregisterMessageReceiver()
    }

    // ============================================================
    // NOTIFICACIÓN FOREGROUND
    // ============================================================
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "NEXO BLE Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantiene activo el advertising BLE"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXO")
            .setContentText("Visibilidad BLE activa")
            .setSmallIcon(android.R.drawable.ic_menu_info_details)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    // ============================================================
    // BLE STACK: Advertising + GATT Server
    // ============================================================
    private fun startBleStack() {
        if (!hasPermission(android.Manifest.permission.BLUETOOTH_ADVERTISE) ||
            !hasPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
        ) {
            Log.e(TAG, "Permisos BLE faltantes. Abortando stack.")
            return
        }

        val adapter = bluetoothManager?.adapter
        if (adapter == null || !adapter.isEnabled) {
            Log.e(TAG, "Bluetooth desactivado")
            return
        }

        bluetoothLeAdvertiser = adapter.bluetoothLeAdvertiser
        startGattServer()
        startAdvertising()
    }

    private fun stopBleStack() {
        stopAdvertising()
        stopGattServer()
        connectedDevices.clear()
        deviceNotificationsEnabled.clear()
    }

    // ============================================================
    // ADVERTISING
    // ============================================================
    private fun startAdvertising() {
        val advertiser = bluetoothLeAdvertiser ?: return
        if (isAdvertising) return

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setTimeout(0)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .addServiceUuid(ParcelUuid(NEXO_SERVICE_UUID))
            .build()

        try {
            advertiser.startAdvertising(settings, data, advertiseCallback)
            Log.i(TAG, "Advertising iniciado con UUID: $NEXO_SERVICE_UUID")
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException startAdvertising: ${e.message}")
        }
    }

    private fun stopAdvertising() {
        if (!isAdvertising) return
        try {
            bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        } catch (e: SecurityException) {
            Log.w(TAG, "SecurityException stopAdvertising: ${e.message}")
        }
        isAdvertising = false
        Log.i(TAG, "Advertising detenido")
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            isAdvertising = true
            Log.i(TAG, "Advertising SUCCESS")
        }

        override fun onStartFailure(errorCode: Int) {
            isAdvertising = false
            Log.e(TAG, "Advertising FAILURE: errorCode=$errorCode")
        }
    }

    // ============================================================
    // GATT SERVER
    // ============================================================
    private fun startGattServer() {
        if (!hasPermission(android.Manifest.permission.BLUETOOTH_CONNECT)) return

        txCharacteristic = BluetoothGattCharacteristic(
            TX_CHARACTERISTIC_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        ).apply {
            addDescriptor(BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
        }

        rxCharacteristic = BluetoothGattCharacteristic(
            RX_CHARACTERISTIC_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        gattService = android.bluetooth.BluetoothGattService(
            NEXO_SERVICE_UUID,
            android.bluetooth.BluetoothGattService.SERVICE_TYPE_PRIMARY
        ).apply {
            addCharacteristic(txCharacteristic)
            addCharacteristic(rxCharacteristic)
        }

        try {
            bluetoothGattServer = bluetoothManager?.openGattServer(this, gattServerCallback)
            bluetoothGattServer?.addService(gattService)
            Log.i(TAG, "GATT Server iniciado")
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException GATT Server: ${e.message}")
        }
    }

    private fun stopGattServer() {
        try {
            bluetoothGattServer?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error cerrando GATT Server: ${e.message}")
        }
        bluetoothGattServer = null
        txCharacteristic = null
        rxCharacteristic = null
        gattService = null
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {

        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val addr = device.address
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "GATT Client CONNECTED: $addr")
                    connectedDevices[addr] = device
                    sendBroadcastToPlugin(ACTION_BLE_DEVICE_CONNECTED, addr, null)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "GATT Client DISCONNECTED: $addr")
                    connectedDevices.remove(addr)
                    deviceNotificationsEnabled.remove(addr)
                    sendBroadcastToPlugin(ACTION_BLE_DEVICE_DISCONNECTED, addr, null)
                }
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
            if (characteristic.uuid == RX_CHARACTERISTIC_UUID) {
                val message = value?.toString(Charset.defaultCharset()) ?: ""
                Log.i(TAG, "RX recibido de ${device.address}: $message")
                sendBroadcastToPlugin(ACTION_BLE_MESSAGE_RECEIVED, device.address, message)

                if (responseNeeded) {
                    try {
                        bluetoothGattServer?.sendResponse(
                            device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value
                        )
                    } catch (e: SecurityException) {
                        Log.w(TAG, "sendResponse SecurityException: ${e.message}")
                    }
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
            if (descriptor.uuid == CCCD_UUID) {
                val enabled = value != null && (
                    value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) ||
                    value.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE)
                )
                deviceNotificationsEnabled[device.address] = enabled
                Log.i(TAG, "CCCCD write ${device.address}: notificationsEnabled=$enabled")

                if (responseNeeded) {
                    try {
                        bluetoothGattServer?.sendResponse(
                            device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value
                        )
                    } catch (e: SecurityException) {
                        Log.w(TAG, "CCCD sendResponse SecurityException: ${e.message}")
                    }
                }
            }
        }
    }

    // ============================================================
    // BROADCASTS: Comunicación con NexoBlePlugin
    // ============================================================
    private fun registerMessageReceiver() {
        if (messageReceiver != null) return
        messageReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action == ACTION_BLE_SEND_MESSAGE) {
                    val message = intent.getStringExtra(EXTRA_MESSAGE_DATA) ?: return
                    val targetAddress = intent.getStringExtra(EXTRA_DEVICE_ADDRESS)
                    broadcastMessageToClients(message, targetAddress)
                }
            }
        }
        val filter = IntentFilter(ACTION_BLE_SEND_MESSAGE).apply {
            addAction(ACTION_BLE_SEND_MESSAGE)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(messageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(messageReceiver, filter)
        }
        Log.i(TAG, "BroadcastReceiver registrado")
    }

    private fun unregisterMessageReceiver() {
        messageReceiver?.let {
            try {
                unregisterReceiver(it)
                Log.i(TAG, "BroadcastReceiver desregistrado")
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "Receiver ya estaba desregistrado")
            }
            messageReceiver = null
        }
    }

    private fun sendBroadcastToPlugin(action: String, deviceAddress: String, message: String?) {
        val intent = Intent(action).apply {
            putExtra(EXTRA_DEVICE_ADDRESS, deviceAddress)
            message?.let { putExtra(EXTRA_MESSAGE_DATA, it) }
            setPackage(packageName)
        }
        sendBroadcast(intent)
    }

    // ============================================================
    // ENVIAR MENSAJE A CLIENTES GATT
    // ============================================================
    private fun broadcastMessageToClients(message: String, targetAddress: String? = null) {
        val data = message.toByteArray(Charset.defaultCharset())
        val tx = txCharacteristic ?: return

        val targets = if (targetAddress != null) {
            listOfNotNull(connectedDevices[targetAddress])
        } else {
            connectedDevices.values.toList()
        }

        targets.forEach { device ->
            if (deviceNotificationsEnabled[device.address] != true) {
                Log.w(TAG, "Device ${device.address} no tiene notificaciones habilitadas, skip")
                return@forEach
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    bluetoothGattServer?.notifyCharacteristicChanged(device, tx, false, data)
                } else {
                    @Suppress("DEPRECATION")
                    tx.value = data
                    @Suppress("DEPRECATION")
                    bluetoothGattServer?.notifyCharacteristicChanged(device, tx, false)
                }
                Log.i(TAG, "Notificación enviada a ${device.address}")
            } catch (e: SecurityException) {
                Log.e(TAG, "SecurityException notify ${device.address}: ${e.message}")
            }
        }
    }

    // ============================================================
    // UTILS
    // ============================================================
    private fun hasPermission(permission: String): Boolean {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }
}
