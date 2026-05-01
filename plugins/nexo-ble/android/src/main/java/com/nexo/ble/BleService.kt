// ============================================================
// BleService.kt v2 — ADVERTISING ROBUSTO con Scan Response
// android/app/src/main/java/com/nexo/ble/BleService.kt
// FIX: setIncludeDeviceName(false) en advertisement para liberar payload.
//      Scan response con nombre. Espera onServiceAdded antes de advertise.
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
import android.bluetooth.BluetoothGattService
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

        private val NEXO_SERVICE_UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
        private val TX_CHARACTERISTIC_UUID = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")
        private val RX_CHARACTERISTIC_UUID = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")
        private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

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
    private var txCharacteristic: BluetoothGattCharacteristic? = null
    private var rxCharacteristic: BluetoothGattCharacteristic? = null

    private val connectedDevices = mutableMapOf<String, BluetoothDevice>()
    private val deviceNotificationsEnabled = mutableMapOf<String, Boolean>()
    private var messageReceiver: BroadcastReceiver? = null
    private var isAdvertising = false
    private var gattServerReady = false

    inner class LocalBinder : Binder() {
        fun getService(): BleService = this@BleService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        createNotificationChannel()
        registerMessageReceiver()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
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
        Log.i(TAG, "onDestroy — stopping BLE stack")
        stopBleStack()
        unregisterMessageReceiver()
    }

    // ============================================================
    // NOTIFICACIÓN FOREGROUND
    // ============================================================
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, "NEXO BLE Service", NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Mantiene activo el advertising BLE"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
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
    // BLE STACK
    // ============================================================
    private fun startBleStack() {
        if (!hasPermission(android.Manifest.permission.BLUETOOTH_ADVERTISE) ||
            !hasPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
        ) {
            Log.e(TAG, "Permisos BLE faltantes. Abortando.")
            return
        }
        val adapter = bluetoothManager?.adapter
        if (adapter == null || !adapter.isEnabled) {
            Log.e(TAG, "Bluetooth desactivado")
            return
        }
        bluetoothLeAdvertiser = adapter.bluetoothLeAdvertiser
        startGattServer() // Advertising se inicia desde onServiceAdded
    }

    private fun stopBleStack() {
        stopAdvertising()
        try { bluetoothGattServer?.close() } catch (e: Exception) { }
        bluetoothGattServer = null
        txCharacteristic = null
        rxCharacteristic = null
        connectedDevices.clear()
        deviceNotificationsEnabled.clear()
        gattServerReady = false
    }

    // ============================================================
    // ADVERTISING — Advertisement limpio + Scan Response con nombre
    // ============================================================
    private fun startAdvertising() {
        if (isAdvertising || !gattServerReady) return
        val advertiser = bluetoothLeAdvertiser ?: return

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setTimeout(0)
            .build()

        // Advertisement principal: SOLO Service UUID (sin nombre, para que quepa en 31 bytes)
        val advertiseData = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceUuid(ParcelUuid(NEXO_SERVICE_UUID))
            .build()

        // Scan Response: nombre del dispositivo (segundo paquete BLE)
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .build()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                advertiser.startAdvertising(settings, advertiseData, scanResponse, advertiseCallback)
            } else {
                advertiser.startAdvertising(settings, advertiseData, advertiseCallback)
            }
            Log.i(TAG, "Advertising iniciado (UUID: $NEXO_SERVICE_UUID)")
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException startAdvertising: ${e.message}")
        }
    }

    private fun stopAdvertising() {
        if (!isAdvertising) return
        try { bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback) } catch (e: SecurityException) { }
        isAdvertising = false
        Log.i(TAG, "Advertising detenido")
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            isAdvertising = true
            Log.i(TAG, "✅ Advertising SUCCESS")
        }
        override fun onStartFailure(errorCode: Int) {
            isAdvertising = false
            Log.e(TAG, "❌ Advertising FAILURE: errorCode=$errorCode")
        }
    }

    // ============================================================
    // GATT SERVER — Espera onServiceAdded antes de advertising
    // ============================================================
    private fun startGattServer() {
        if (!hasPermission(android.Manifest.permission.BLUETOOTH_CONNECT)) return

        txCharacteristic = BluetoothGattCharacteristic(
            TX_CHARACTERISTIC_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        ).apply {
            addDescriptor(BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            ))
        }

        rxCharacteristic = BluetoothGattCharacteristic(
            RX_CHARACTERISTIC_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        val service = BluetoothGattService(
            NEXO_SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY
        ).apply {
            addCharacteristic(txCharacteristic)
            addCharacteristic(rxCharacteristic)
        }

        try {
            bluetoothGattServer = bluetoothManager?.openGattServer(this, gattServerCallback)
            bluetoothGattServer?.addService(service)
            Log.i(TAG, "GATT Server abierto, esperando onServiceAdded...")
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException GATT Server: ${e.message}")
        }
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {

        override fun onServiceAdded(status: Int, service: BluetoothGattService?) {
            if (status == BluetoothGatt.GATT_SUCCESS && service?.uuid == NEXO_SERVICE_UUID) {
                gattServerReady = true
                Log.i(TAG, "✅ GATT Service registrado. Iniciando advertising...")
                startAdvertising()
            } else {
                Log.e(TAG, "❌ GATT Service add failed: status=$status")
            }
        }

        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val addr = device.address
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "✅ GATT Client CONNECTED: $addr")
                    connectedDevices[addr] = device
                    sendBroadcastToPlugin(ACTION_BLE_DEVICE_CONNECTED, addr, null)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "❌ GATT Client DISCONNECTED: $addr")
                    connectedDevices.remove(addr)
                    deviceNotificationsEnabled.remove(addr)
                    sendBroadcastToPlugin(ACTION_BLE_DEVICE_DISCONNECTED, addr, null)
                }
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean,
            offset: Int, value: ByteArray?
        ) {
            if (characteristic.uuid == RX_CHARACTERISTIC_UUID) {
                val message = value?.toString(Charset.defaultCharset()) ?: ""
                Log.i(TAG, "📨 RX from ${device.address}: $message")
                sendBroadcastToPlugin(ACTION_BLE_MESSAGE_RECEIVED, device.address, message)

                if (responseNeeded) {
                    try {
                        bluetoothGattServer?.sendResponse(
                            device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value
                        )
                    } catch (e: SecurityException) {
                        Log.w(TAG, "sendResponse error: ${e.message}")
                    }
                }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean,
            offset: Int, value: ByteArray?
        ) {
            if (descriptor.uuid == CCCD_UUID) {
                val enabled = value != null && (
                    value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) ||
                    value.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE)
                )
                deviceNotificationsEnabled[device.address] = enabled
                Log.i(TAG, "🔔 CCCD ${device.address}: notifications=$enabled")

                if (responseNeeded) {
                    try {
                        bluetoothGattServer?.sendResponse(
                            device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value
                        )
                    } catch (e: SecurityException) { }
                }
            }
        }
    }

    // ============================================================
    // BROADCASTS
    // ============================================================
    private fun registerMessageReceiver() {
        if (messageReceiver != null) return
        messageReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action == ACTION_BLE_SEND_MESSAGE) {
                    val message = intent.getStringExtra(EXTRA_MESSAGE_DATA) ?: return
                    val target = intent.getStringExtra(EXTRA_DEVICE_ADDRESS)
                    broadcastMessageToClients(message, target)
                }
            }
        }
        val filter = IntentFilter(ACTION_BLE_SEND_MESSAGE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(messageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(messageReceiver, filter)
        }
    }

    private fun unregisterMessageReceiver() {
        messageReceiver?.let {
            try { unregisterReceiver(it) } catch (e: IllegalArgumentException) { }
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
    // ENVIAR MENSAJE A CLIENTES
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
                Log.w(TAG, "⚠️ ${device.address} sin notificaciones habilitadas, skip")
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
                Log.i(TAG, "📤 TX to ${device.address}: ${message.take(50)}")
            } catch (e: SecurityException) {
                Log.e(TAG, "SecurityException notify ${device.address}: ${e.message}")
            }
        }
    }

    private fun hasPermission(permission: String): Boolean {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
    }
}
