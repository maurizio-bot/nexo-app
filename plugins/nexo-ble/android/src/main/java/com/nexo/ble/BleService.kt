package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
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
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * BleService v2.3-ARCH — FIX UUID + GATT Client completo
 * 
 * Cambios críticos:
 * 1. UUIDs válidos (placeholder — REEMPLAZA con tu spec v1.0)
 * 2. GATT Client: connect, disconnect, sendMessage, getConnectedDevices
 * 3. isBluetoothEnabled() helper
 * 4. Foreground service type CONNECTED_DEVICE
 */
class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "nexo_ble_channel"

        // === NEXO BLE UUIDs v1.0 — REEMPLAZA CON TUS UUIDS REALES ===
        val SERVICE_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6")
        val MESSAGE_CHAR_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c7")
        val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        // Broadcasts
        const val ACTION_SCAN_RESULT = "com.nexo.ble.SCAN_RESULT"
        const val ACTION_SCAN_FAILED = "com.nexo.ble.SCAN_FAILED"
        const val ACTION_SCAN_STOPPED = "com.nexo.ble.SCAN_STOPPED"
        const val ACTION_ADVERT_STATE = "com.nexo.ble.ADVERT_STATE"
        const val ACTION_MESSAGE_RECEIVED = "com.nexo.ble.MESSAGE_RECEIVED"
        const val ACTION_MESSAGE_SENT = "com.nexo.ble.MESSAGE_SENT"
        const val ACTION_DEVICE_CONNECTED = "com.nexo.ble.DEVICE_CONNECTED"
        const val ACTION_DEVICE_DISCONNECTED = "com.nexo.ble.DEVICE_DISCONNECTED"
        const val ACTION_CONNECTION_ERROR = "com.nexo.ble.CONNECTION_ERROR"

        const val EXTRA_DEVICE_ADDRESS = "device_address"
        const val EXTRA_DEVICE_NAME = "device_name"
        const val EXTRA_RSSI = "rssi"
        const val EXTRA_ERROR_CODE = "error_code"
        const val EXTRA_ERROR_DESC = "error_description"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_ADVERTISING = "advertising"
        const val EXTRA_SUCCESS = "success"
    }

    private val binder = LocalBinder()
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null
    private var gattServer: BluetoothGattServer? = null

    private var isAdvertising = false
    private var isScanning = false
    private var lastScanStartTime: Long = 0
    private val scanResults = ConcurrentHashMap<String, ScanResult>()

    // GATT Client connections
    private val connectedGatts = ConcurrentHashMap<String, BluetoothGatt>()
    private val connectionState = ConcurrentHashMap<String, Int>() // DISCONNECTED=0, CONNECTING=1, CONNECTED=2

    private val SCAN_RATE_LIMIT_MS = 30000L
    private val scanTimestamps = ArrayDeque<Long>(5)

    inner class LocalBinder : Binder() {
        fun getService(): BleService = this@BleService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter

        createNotificationChannel()
        startForegroundService()
        initGattServer()

        Log.i(TAG, "[BLE_INIT] BleService v2.3-ARCH creado")
    }

    // ==================== FOREGROUND SERVICE ====================

    private fun startForegroundService() {
        val notification = buildNotification("NEXO BLE activo")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            )
            Log.i(TAG, "[BLE_FOREGROUND] startForeground() CONNECTED_DEVICE")
        } else {
            startForeground(NOTIFICATION_ID, notification)
            Log.i(TAG, "[BLE_FOREGROUND] startForeground() legacy")
        }
    }

    private fun buildNotification(content: String): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXO Mesh")
            .setContentText(content)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "NEXO BLE Service",
                NotificationManager.IMPORTANCE_LOW
            )
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    // ==================== BLUETOOTH STATE ====================

    fun isBluetoothEnabled(): Boolean {
        return bluetoothAdapter?.isEnabled == true
    }

    // ==================== GATT SERVER ====================

    private fun initGattServer() {
        val adapter = bluetoothAdapter ?: return

        gattServer = bluetoothManager?.openGattServer(this, gattServerCallback)

        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val messageChar = BluetoothGattCharacteristic(
            MESSAGE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        val cccd = BluetoothGattDescriptor(
            CCCD_UUID,
            BluetoothGattDescriptor.PERMISSION_WRITE or BluetoothGattDescriptor.PERMISSION_READ
        )
        messageChar.addDescriptor(cccd)
        service.addCharacteristic(messageChar)

        gattServer?.addService(service)
        Log.i(TAG, "[BLE_GATT] GATT Server iniciado con servicio $SERVICE_UUID")
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "[BLE_GATT_SERVER] Conectado: ${device?.address}")
                    broadcast(ACTION_DEVICE_CONNECTED, device)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "[BLE_GATT_SERVER] Desconectado: ${device?.address}")
                    broadcast(ACTION_DEVICE_DISCONNECTED, device)
                }
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice?,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic?,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            if (characteristic?.uuid == MESSAGE_CHAR_UUID && value != null) {
                val message = String(value, Charsets.UTF_8)
                Log.i(TAG, "[BLE_GATT_SERVER] Mensaje recibido de ${device?.address}: $message")

                val intent = Intent(ACTION_MESSAGE_RECEIVED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, device?.address)
                    putExtra(EXTRA_DEVICE_NAME, device?.name ?: "Unknown")
                    putExtra(EXTRA_MESSAGE, message)
                }
                sendBroadcast(intent)

                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
                }
            }
        }
    }

    // ==================== GATT CLIENT ====================

    fun connectToDevice(address: String): Boolean {
        val adapter = bluetoothAdapter ?: return false
        if (!adapter.isEnabled) return false

        val device = adapter.getRemoteDevice(address) ?: return false

        // Si ya está conectado, no reconectar
        if (connectionState[address] == BluetoothProfile.STATE_CONNECTED) {
            Log.d(TAG, "[BLE_GATT_CLIENT] Ya conectado a $address")
            return true
        }

        connectionState[address] = BluetoothProfile.STATE_CONNECTING

        val gatt = device.connectGatt(this, false, gattClientCallback)
        if (gatt != null) {
            connectedGatts[address] = gatt
            Log.i(TAG, "[BLE_GATT_CLIENT] Conectando a $address...")
            return true
        }
        return false
    }

    fun disconnectDevice(address: String) {
        val gatt = connectedGatts[address]
        if (gatt != null) {
            gatt.disconnect()
            gatt.close()
            connectedGatts.remove(address)
            connectionState.remove(address)
            Log.i(TAG, "[BLE_GATT_CLIENT] Desconectado de $address")
        }
    }

    fun sendMessage(address: String, message: String): Boolean {
        val gatt = connectedGatts[address] ?: return false
        if (connectionState[address] != BluetoothProfile.STATE_CONNECTED) return false

        val service = gatt.getService(SERVICE_UUID) ?: return false
        val characteristic = service.getCharacteristic(MESSAGE_CHAR_UUID) ?: return false

        characteristic.value = message.toByteArray(Charsets.UTF_8)
        val success = gatt.writeCharacteristic(characteristic)

        Log.i(TAG, "[BLE_GATT_CLIENT] Enviando a $address: $message (success=$success)")
        return success
    }

    fun getConnectedDevices(): List<Map<String, String>> {
        val list = mutableListOf<Map<String, String>>()
        for ((address, gatt) in connectedGatts) {
            if (connectionState[address] == BluetoothProfile.STATE_CONNECTED) {
                list.add(mapOf(
                    "deviceId" to address,
                    "address" to address,
                    "name" to (gatt.device?.name ?: "NEXO Peer")
                ))
            }
        }
        return list
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
            val address = gatt?.device?.address ?: return

            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "[BLE_GATT_CLIENT] Conectado a $address")
                    connectionState[address] = BluetoothProfile.STATE_CONNECTED
                    broadcast(ACTION_DEVICE_CONNECTED, gatt.device)
                    gatt.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "[BLE_GATT_CLIENT] Desconectado de $address")
                    connectionState.remove(address)
                    connectedGatts.remove(address)
                    broadcast(ACTION_DEVICE_DISCONNECTED, gatt.device)
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "[BLE_GATT_CLIENT] Servicios descubiertos en ${gatt?.device?.address}")
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?) {
            if (characteristic?.uuid == MESSAGE_CHAR_UUID) {
                val message = String(characteristic.value ?: byteArrayOf(), Charsets.UTF_8)
                val address = gatt?.device?.address ?: "unknown"
                Log.i(TAG, "[BLE_GATT_CLIENT] Notificación recibida de $address: $message")

                sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, address)
                    putExtra(EXTRA_DEVICE_NAME, gatt?.device?.name ?: "Unknown")
                    putExtra(EXTRA_MESSAGE, message)
                })
            }
        }
    }

    // ==================== ADVERTISING ====================

    fun startAdvertising(deviceName: String) {
        val adapter = bluetoothAdapter ?: run {
            Log.e(TAG, "[BLE_ADVERT] BluetoothAdapter es null")
            return
        }

        // Cambiar nombre del dispositivo si es posible
        try {
            adapter.name = deviceName
        } catch (e: SecurityException) {
            Log.w(TAG, "[BLE_ADVERT] No se pudo cambiar nombre: ${e.message}")
        }

        advertiser = adapter.bluetoothLeAdvertiser
        if (advertiser == null) {
            Log.e(TAG, "[BLE_ADVERT] Advertiser no soportado")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()

        advertiser?.startAdvertising(settings, data, advertiseCallback)
        Log.i(TAG, "[BLE_ADVERT] Advertising iniciado: name=$deviceName, uuid=$SERVICE_UUID")
    }

    fun stopAdvertising() {
        advertiser?.stopAdvertising(advertiseCallback)
        isAdvertising = false
        broadcastAdvertState(false)
        Log.i(TAG, "[BLE_ADVERT] Advertising detenido")
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            isAdvertising = true
            broadcastAdvertState(true)
            Log.i(TAG, "[BLE_ADVERT] onStartSuccess")
        }

        override fun onStartFailure(errorCode: Int) {
            isAdvertising = false
            broadcastAdvertState(false)
            Log.e(TAG, "[BLE_ADVERT] onStartFailure: errorCode=$errorCode")
        }
    }

    private fun broadcastAdvertState(advertising: Boolean) {
        sendBroadcast(Intent(ACTION_ADVERT_STATE).apply {
            putExtra(EXTRA_ADVERTISING, advertising)
        })
    }

    // ==================== SCAN ====================

    fun startScan() {
        val adapter = bluetoothAdapter ?: run {
            Log.e(TAG, "[BLE_SCAN] BluetoothAdapter es null")
            broadcastScanFailed(-1, "BluetoothAdapter null")
            return
        }

        scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
            Log.e(TAG, "[BLE_SCAN] BluetoothLeScanner es null")
            broadcastScanFailed(-2, "BluetoothLeScanner null")
            return
        }

        // Rate limit guard
        val now = SystemClock.elapsedRealtime()
        cleanupOldScanTimestamps(now)
        if (scanTimestamps.size >= 5) {
            val oldest = scanTimestamps.first()
            val waitMs = SCAN_RATE_LIMIT_MS - (now - oldest)
            Log.w(TAG, "[BLE_RATE_LIMIT] Demasiados scans. Espera ${waitMs}ms")
            broadcastScanFailed(-3, "Rate limit: espera ${waitMs}ms")
            return
        }
        scanTimestamps.addLast(now)
        lastScanStartTime = now

        // FIX S24: ScanFilter por Service UUID
        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()

        scanResults.clear()
        isScanning = true

        try {
            scanner?.startScan(listOf(filter), settings, scanCallback)
            Log.i(TAG, "[BLE_SCAN_START] Scan iniciado filter=$SERVICE_UUID")
        } catch (e: SecurityException) {
            Log.e(TAG, "[BLE_SCAN] SecurityException: ${e.message}")
            isScanning = false
            broadcastScanFailed(-4, "SecurityException: ${e.message}")
        }
    }

    fun stopScan() {
        if (!isScanning) return
        isScanning = false

        try {
            scanner?.stopScan(scanCallback)
            Log.i(TAG, "[BLE_SCAN_STOP] Scan detenido. Resultados: ${scanResults.size}")
            sendBroadcast(Intent(ACTION_SCAN_STOPPED).apply {
                putExtra("result_count", scanResults.size)
            })
        } catch (e: SecurityException) {
            Log.e(TAG, "[BLE_SCAN_STOP] SecurityException: ${e.message}")
        }
    }

    private fun cleanupOldScanTimestamps(now: Long) {
        while (scanTimestamps.isNotEmpty() && (now - scanTimestamps.first() > SCAN_RATE_LIMIT_MS)) {
            scanTimestamps.removeFirst()
        }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result ?: return
            val device = result.device
            val address = device.address ?: return
            val name = device.name ?: "Unknown"

            val existing = scanResults[address]
            if (existing == null || result.rssi > existing.rssi) {
                scanResults[address] = result
            }

            Log.d(TAG, "[BLE_SCAN_RESULT] $name [$address] RSSI=${result.rssi}")

            val intent = Intent(ACTION_SCAN_RESULT).apply {
                putExtra(EXTRA_DEVICE_ADDRESS, address)
                putExtra(EXTRA_DEVICE_NAME, name)
                putExtra(EXTRA_RSSI, result.rssi)
            }
            sendBroadcast(intent)
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            results?.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
        }

        override fun onScanFailed(errorCode: Int) {
            isScanning = false
            val errorDesc = when (errorCode) {
                SCAN_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "APPLICATION_REGISTRATION_FAILED"
                SCAN_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                SCAN_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
                SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES -> "OUT_OF_HARDWARE_RESOURCES"
                SCAN_FAILED_SCANNING_TOO_FREQUENTLY -> "SCANNING_TOO_FREQUENTLY"
                else -> "UNKNOWN($errorCode)"
            }
            Log.e(TAG, "[BLE_SCAN_FAILED] errorCode=$errorCode ($errorDesc)")
            broadcastScanFailed(errorCode, errorDesc)
        }
    }

    private fun broadcastScanFailed(errorCode: Int, description: String) {
        sendBroadcast(Intent(ACTION_SCAN_FAILED).apply {
            putExtra(EXTRA_ERROR_CODE, errorCode)
            putExtra(EXTRA_ERROR_DESC, description)
        })
    }

    // ==================== UTILS ====================

    fun isScanning(): Boolean = isScanning
    fun isAdvertising(): Boolean = isAdvertising
    fun getScanResultCount(): Int = scanResults.size
    fun getScanResults(): Map<String, ScanResult> = scanResults.toMap()

    private fun broadcast(action: String, device: BluetoothDevice?) {
        sendBroadcast(Intent(action).apply {
            putExtra(EXTRA_DEVICE_ADDRESS, device?.address)
            putExtra(EXTRA_DEVICE_NAME, device?.name ?: "Unknown")
        })
    }

    override fun onDestroy() {
        stopScan()
        stopAdvertising()
        connectedGatts.values.forEach { it.disconnect(); it.close() }
        connectedGatts.clear()
        connectionState.clear()
        gattServer?.close()
        super.onDestroy()
        Log.i(TAG, "[BLE_DESTROY] BleService destruido")
    }
}
