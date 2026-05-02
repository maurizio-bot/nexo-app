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
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelUuid
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.LinkedList
import java.util.Random
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * BleService v3.0.0-ARCH — ÚNICO DUEÑO DE TODO BLE
 *
 * Arquitectura: Service monolítico estándar Android BLE 2026
 * - GATT Server (1 servicio, 1 característica principal + 1 announce)
 * - GATT Client (máquina de estados, queue, retries, timeouts)
 * - Scan (sin hardware filter, software filter S24 fix)
 * - Advertising (foreground + device name)
 * - Emite Broadcasts para Plugin bridge
 *
 * NO toca notifyListeners() — eso es trabajo del bridge.
 */
class BleService : Service() {

    // ═══════════════════════════════════════════════════════════════════════
    // COMPANION OBJECT — ÚNICO SOURCE OF TRUTH UUIDs
    // ═══════════════════════════════════════════════════════════════════════
    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "nexo_ble_channel"

        // UUIDs NEXO v1.0 — inline para evitar dependencias cruzadas rotas
        val SERVICE_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6")
        val MESSAGE_CHAR_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c7")
        val ANNOUNCE_CHAR_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c8")
        val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        // Broadcast Actions — contrato público Service ↔ Plugin Bridge
        const val ACTION_SCAN_RESULT = "com.nexo.ble.SCAN_RESULT"
        const val ACTION_SCAN_FAILED = "com.nexo.ble.SCAN_FAILED"
        const val ACTION_SCAN_STOPPED = "com.nexo.ble.SCAN_STOPPED"
        const val ACTION_ADVERT_STATE = "com.nexo.ble.ADVERT_STATE"
        const val ACTION_MESSAGE_RECEIVED = "com.nexo.ble.MESSAGE_RECEIVED"
        const val ACTION_MESSAGE_SENT = "com.nexo.ble.MESSAGE_SENT"
        const val ACTION_DEVICE_CONNECTED = "com.nexo.ble.DEVICE_CONNECTED"
        const val ACTION_DEVICE_DISCONNECTED = "com.nexo.ble.DEVICE_DISCONNECTED"
        const val ACTION_CONNECTION_ERROR = "com.nexo.ble.CONNECTION_ERROR"

        // Nuevos actions (antes notifyListeners del plugin)
        const val ACTION_SERVICES_READY = "com.nexo.ble.SERVICES_READY"
        const val ACTION_NOTIFICATIONS_ENABLED = "com.nexo.ble.NOTIFICATIONS_ENABLED"
        const val ACTION_CONNECTION_FAILED = "com.nexo.ble.CONNECTION_FAILED"
        const val ACTION_RETRY_SCHEDULED = "com.nexo.ble.RETRY_SCHEDULED"
        const val ACTION_PAYLOAD_SENT = "com.nexo.ble.PAYLOAD_SENT"
        const val ACTION_PEER_INFO_RECEIVED = "com.nexo.ble.PEER_INFO_RECEIVED"
        const val ACTION_CLIENT_NOTIFICATION_STATE_CHANGED = "com.nexo.ble.CLIENT_NOTIFICATION_STATE_CHANGED"
        const val ACTION_NAP_AUDIT = "com.nexo.ble.NAP_AUDIT"

        // Extras keys
        const val EXTRA_DEVICE_ADDRESS = "device_address"
        const val EXTRA_DEVICE_NAME = "device_name"
        const val EXTRA_RSSI = "rssi"
        const val EXTRA_ERROR_CODE = "error_code"
        const val EXTRA_ERROR_DESC = "error_description"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_MESSAGE_ID = "message_id"
        const val EXTRA_ADVERTISING = "advertising"
        const val EXTRA_SUCCESS = "success"
        const val EXTRA_REASON = "reason"
        const val EXTRA_ATTEMPT = "attempt"
        const val EXTRA_MAX_ATTEMPTS = "max_attempts"
        const val EXTRA_DELAY_MS = "delay_ms"
        const val EXTRA_ENABLED = "enabled"
        const val EXTRA_USER_ID = "user_id"
        const val EXTRA_USER_NAME = "user_name"
        const val EXTRA_NAP_CODE = "nap_code"
        const val EXTRA_NAP_MESSAGE = "nap_message"
        const val EXTRA_NAP_LEVEL = "nap_level"
        const val EXTRA_TIMESTAMP = "timestamp"
        const val EXTRA_DIRECTION = "direction"
        const val EXTRA_SOURCE = "source"
        const val EXTRA_CONTENT = "content"
        const val EXTRA_DATA = "data"
        const val EXTRA_SENDER_NAME = "sender_name"

        // Constantes operativas
        const val MTU_DEFAULT = 512
        const val CHUNK_SIZE = 507
        const val MAX_RETRY_ATTEMPTS = 3
        const val RETRY_BASE_DELAY_MS = 2000L
        const val RETRY_MAX_DELAY_MS = 16000L
        const val CONNECT_TIMEOUT_MS = 15000L
        const val WRITE_TIMEOUT_MS = 5000L
        const val RATE_LIMIT_MS = 5000L
        const val SCAN_RATE_LIMIT_MS = 30000L
        const val SCAN_AUTO_STOP_MS = 15000L
    }

    // ═══════════════════════════════════════════════════════════════════════
    // A. MÁQUINA DE ESTADOS
    // ═══════════════════════════════════════════════════════════════════════
    enum class ConnectionState {
        IDLE, CONNECTING, DISCOVERING, READY, DISCONNECTING, FAILED
    }

    data class BLEConnection(
        val deviceId: String,
        var gatt: BluetoothGatt? = null,
        var state: ConnectionState = ConnectionState.IDLE,
        var lastStateChangeTime: Long = 0L,
        var retryCount: Int = 0,
        var lastAttemptTime: Long = 0L,
        var pendingWritePayload: ByteArray? = null,
        var pendingWriteMessageId: String? = null,
        var userDisconnected: Boolean = false,
        var servicesReady: Boolean = false,
        var notificationsEnabled: Boolean = false
    )

    // ═══════════════════════════════════════════════════════════════════════
    // B. SERIALIZACIÓN ESTRUCTA
    // ═══════════════════════════════════════════════════════════════════════
    private val operationQueue = ConcurrentHashMap<String, LinkedList<Runnable>>()
    private val isOperating = ConcurrentHashMap<String, java.util.concurrent.atomic.AtomicBoolean>()

    private fun enqueueOperation(deviceId: String, operation: Runnable) {
        val queue = operationQueue.getOrPut(deviceId) { LinkedList() }
        synchronized(queue) { queue.add(operation) }
        processNextOperation(deviceId)
    }

    private fun processNextOperation(deviceId: String) {
        val flag = isOperating.getOrPut(deviceId) { java.util.concurrent.atomic.AtomicBoolean(false) }
        if (flag.getAndSet(true)) return
        val queue = operationQueue[deviceId] ?: return
        val next: Runnable?
        synchronized(queue) { next = queue.pollFirst() }
        if (next == null) { flag.set(false); return }
        handler.post {
            try { next.run() } finally {
                flag.set(false)
                processNextOperation(deviceId)
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // C. PROPIEDADES DEL SERVICIO
    // ═══════════════════════════════════════════════════════════════════════
    private val binder = LocalBinder()
    private val handler = Handler(Looper.getMainLooper())

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null
    private var gattServer: BluetoothGattServer? = null

    private var isAdvertising = false
    private var isScanning = false
    private var lastScanStartTime: Long = 0
    private val scanResults = ConcurrentHashMap<String, ScanResult>()
    private val scanTimestamps = ArrayDeque<Long>(5)

    private val connectedGatts = ConcurrentHashMap<String, BluetoothGatt>()
    private val connections = ConcurrentHashMap<String, BLEConnection>()
    private val serverConnections = ConcurrentHashMap<String, BluetoothDevice>()

    private var userId: String = ""
    private var userName: String = "NEXO User"

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
        try { initGattServer() } catch (e: Exception) { napLog("BLE_INIT", "Error GATT Server: ${e.message}", "ERROR") }
    }

    override fun onDestroy() {
        stopScan()
        stopAdvertising()
        cleanupAllConnections()
        gattServer?.close()
        super.onDestroy()
    }

    // ═══════════════════════════════════════════════════════════════════════
    // D. FOREGROUND SERVICE
    // ═══════════════════════════════════════════════════════════════════════
    private fun startForegroundService() {
        val notification = buildNotification("NEXO BLE activo")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(content: String): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
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
            val channel = NotificationChannel(CHANNEL_ID, "NEXO BLE Service", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // E. GATT SERVER
    // ═══════════════════════════════════════════════════════════════════════
    private fun initGattServer() {
        val adapter = bluetoothAdapter ?: return
        gattServer = bluetoothManager?.openGattServer(this, gattServerCallback)
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val messageChar = BluetoothGattCharacteristic(MESSAGE_CHAR_UUID, BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_WRITE)
        val cccd = BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_WRITE or BluetoothGattDescriptor.PERMISSION_READ)
        messageChar.addDescriptor(cccd)
        service.addCharacteristic(messageChar)
        val announceChar = BluetoothGattCharacteristic(ANNOUNCE_CHAR_UUID, BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY, BluetoothGattCharacteristic.PERMISSION_READ)
        service.addCharacteristic(announceChar)
        gattServer?.addService(service)
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    device?.address?.let { addr ->
                        serverConnections[addr] = device
                        broadcastDeviceEvent(ACTION_DEVICE_CONNECTED, device, direction = "incoming")
                    }
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    device?.address?.let { addr ->
                        serverConnections.remove(addr)
                        broadcastDeviceEvent(ACTION_DEVICE_DISCONNECTED, device)
                    }
                }
            }
        }

        override fun onCharacteristicWriteRequest(device: BluetoothDevice?, requestId: Int, characteristic: BluetoothGattCharacteristic?, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            if (characteristic?.uuid == MESSAGE_CHAR_UUID && value != null) {
                val message = String(value, Charsets.UTF_8)
                var senderName = "NEXO Peer"; var content = message; var mId = ""
                try {
                    val json = org.json.JSONObject(message)
                    senderName = json.optString("senderName", senderName)
                    content = json.optString("content", content)
                    mId = json.optString("messageId", mId)
                } catch (e: Exception) {}
                sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, device?.address)
                    putExtra(EXTRA_MESSAGE, message)
                    putExtra(EXTRA_CONTENT, content)
                    putExtra(EXTRA_SENDER_NAME, senderName)
                    putExtra(EXTRA_MESSAGE_ID, mId)
                    putExtra(EXTRA_SOURCE, "server_write_request")
                    putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                })
                if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // F. GATT CLIENT
    // ═══════════════════════════════════════════════════════════════════════
    fun connectToDevice(address: String): Boolean {
        val adapter = bluetoothAdapter ?: return false
        val device = adapter.getRemoteDevice(address) ?: return false
        val conn = connections.getOrPut(address) { BLEConnection(address) }
        if (conn.state == ConnectionState.READY || conn.state == ConnectionState.CONNECTING) return true
        enqueueOperation(address) { executeConnectInternal(device, address) }
        return true
    }

    private fun executeConnectInternal(device: BluetoothDevice, deviceId: String) {
        val conn = connections.getOrPut(deviceId) { BLEConnection(deviceId) }
        conn.state = ConnectionState.CONNECTING
        conn.lastAttemptTime = System.currentTimeMillis()
        conn.gatt?.let { try { it.disconnect(); it.close() } catch (e: Exception) {} }
        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(this, false, unifiedGattCallback, BluetoothDevice.TRANSPORT_LE)
        } else { device.connectGatt(this, false, unifiedGattCallback) }
        conn.gatt = gatt
        handler.postDelayed({ if (connections[deviceId]?.state == ConnectionState.CONNECTING) handleConnectionFailure(deviceId, "Timeout") }, CONNECT_TIMEOUT_MS)
    }

    fun sendMessage(address: String, message: String): Boolean {
        val conn = connections[address] ?: return false
        if (conn.state != ConnectionState.READY) return false
        val mId = UUID.randomUUID().toString()
        val payload = try {
            val json = org.json.JSONObject()
            json.put("messageId", mId); json.put("timestamp", System.currentTimeMillis())
            json.put("senderId", userId); json.put("senderName", userName); json.put("content", message)
            json.toString().toByteArray()
        } catch (e: Exception) { message.toByteArray() }
        performWrite(address, payload, mId)
        return true
    }

    private fun performWrite(deviceId: String, payload: ByteArray, mId: String) {
        val conn = connections[deviceId] ?: return
        val gatt = conn.gatt ?: return
        try {
            val char = gatt.getService(SERVICE_UUID)?.getCharacteristic(MESSAGE_CHAR_UUID) ?: return
            conn.pendingWriteMessageId = mId
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(char, payload, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
            } else {
                @Suppress("DEPRECATION") char.value = payload
                @Suppress("DEPRECATION") gatt.writeCharacteristic(char)
            }
        } catch (e: Exception) { broadcastPayloadSent(deviceId, mId, false) }
    }

    private val unifiedGattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val addr = gatt.device.address
            val conn = connections[addr] ?: return
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                conn.state = ConnectionState.DISCOVERING
                handler.postDelayed({ try { gatt.discoverServices() } catch (e: Exception) {} }, 800)
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                conn.state = ConnectionState.IDLE; conn.gatt = null
                if (!conn.userDisconnected && conn.retryCount < MAX_RETRY_ATTEMPTS) scheduleRetry(addr)
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val addr = gatt.device.address
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(MESSAGE_CHAR_UUID)
            if (char != null) {
                gatt.setCharacteristicNotification(char, true)
                val d = char.getDescriptor(CCCD_UUID)
                if (d != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gatt.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    } else {
                        @Suppress("DEPRECATION") d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        @Suppress("DEPRECATION") gatt.writeDescriptor(d)
                    }
                } else { markConnectionReady(addr, gatt) }
            }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (descriptor.uuid == CCCD_UUID && status == BluetoothGatt.GATT_SUCCESS) markConnectionReady(gatt.device.address, gatt)
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid == MESSAGE_CHAR_UUID) {
                val msg = String(characteristic.value, Charsets.UTF_8)
                sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, gatt.device.address)
                    putExtra(EXTRA_MESSAGE, msg)
                    putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                })
            }
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val addr = gatt.device.address
            val mId = connections[addr]?.pendingWriteMessageId ?: ""
            broadcastPayloadSent(addr, mId, status == BluetoothGatt.GATT_SUCCESS)
        }
    }

    //     // ═══════════════════════════════════════════════════════════════════════
    // G. SCAN & ADVERTISING
    // ═══════════════════════════════════════════════════════════════════════
    fun startScan() {
        val adapter = bluetoothAdapter ?: return
        scanner = adapter.bluetoothLeScanner
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        scanResults.clear(); isScanning = true
        try {
            scanner?.startScan(null, settings, scanCallback)
            handler.postDelayed({ stopScan() }, SCAN_AUTO_STOP_MS)
        } catch (e: Exception) { isScanning = false }
    }

    fun stopScan() { if (isScanning) { try { scanner?.stopScan(scanCallback) } catch (e: Exception) {}; isScanning = false } }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.let {
                val isNexo = it.scanRecord?.serviceUuids?.any { u -> u.uuid == SERVICE_UUID } == true
                if (isNexo) {
                    val addr = it.device.address
                    scanResults[addr] = it
                    sendBroadcast(Intent(ACTION_SCAN_RESULT).apply {
                        putExtra(EXTRA_DEVICE_ADDRESS, addr); putExtra(EXTRA_RSSI, it.rssi)
                        putExtra(EXTRA_DEVICE_NAME, it.device.name ?: "NEXO Device")
                    })
                }
            }
        }
    }

    fun startAdvertising(name: String) {
        val adapter = bluetoothAdapter ?: return
        try { adapter.name = name } catch (e: Exception) {}
        advertiser = adapter.bluetoothLeAdvertiser
        val settings = AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setConnectable(true).build()
        val data = AdvertiseData.Builder().setIncludeDeviceName(true).addServiceUuid(ParcelUuid(SERVICE_UUID)).build()
        advertiser?.startAdvertising(settings, data, advertiseCallback)
    }

    fun stopAdvertising() { advertiser?.stopAdvertising(advertiseCallback); isAdvertising = false }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(s: AdvertiseSettings?) { isAdvertising = true; broadcastAdvertState(true) }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // H. UTILIDADES
    // ═══════════════════════════════════════════════════════════════════════
    private fun scheduleRetry(addr: String) {
        val conn = connections[addr] ?: return
        conn.retryCount++
        val delay = RETRY_BASE_DELAY_MS * conn.retryCount
        handler.postDelayed({
            val dev = bluetoothAdapter?.getRemoteDevice(addr)
            if (dev != null && connections[addr]?.state == ConnectionState.IDLE) executeConnectInternal(dev, addr)
        }, delay)
    }

    private fun markConnectionReady(addr: String, gatt: BluetoothGatt) {
        val conn = connections[addr] ?: return
        conn.state = ConnectionState.READY; conn.retryCount = 0; conn.gatt = gatt
        sendBroadcast(Intent(ACTION_SERVICES_READY).apply { putExtra(EXTRA_DEVICE_ADDRESS, addr); putExtra(EXTRA_SUCCESS, true) })
    }

    private fun handleConnectionFailure(addr: String, reason: String) {
        connections[addr]?.let { it.state = ConnectionState.IDLE; it.gatt?.close(); it.gatt = null }
        broadcastConnectionFailed(addr, reason, connections[addr]?.retryCount ?: 0)
    }

    private fun napLog(code: String, msg: String, level: String) {
        val f = "[$code] $msg"; when(level){"ERROR"->Log.e(TAG,f);"WARN"->Log.w(TAG,f);else->Log.i(TAG,f)}
        sendBroadcast(Intent(ACTION_NAP_AUDIT).apply { putExtra(EXTRA_NAP_CODE, code); putExtra(EXTRA_NAP_MESSAGE, msg); putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()) })
    }

    private fun broadcastDeviceEvent(a: String, d: BluetoothDevice?, direction: String = "") {
        sendBroadcast(Intent(a).apply { putExtra(EXTRA_DEVICE_ADDRESS, d?.address); putExtra(EXTRA_DIRECTION, direction) })
    }

    private fun broadcastPayloadSent(addr: String, mId: String, success: Boolean) {
        sendBroadcast(Intent(ACTION_MESSAGE_SENT).apply { putExtra(EXTRA_DEVICE_ADDRESS, addr); putExtra(EXTRA_MESSAGE_ID, mId); putExtra(EXTRA_SUCCESS, success) })
    }

    private fun broadcastConnectionFailed(addr: String, r: String, att: Int) {
        sendBroadcast(Intent(ACTION_CONNECTION_FAILED).apply { putExtra(EXTRA_DEVICE_ADDRESS, addr); putExtra(EXTRA_REASON, r); putExtra(EXTRA_ATTEMPT, att) })
    }

    private fun broadcastAdvertState(adv: Boolean) { sendBroadcast(Intent(ACTION_ADVERT_STATE).apply { putExtra(EXTRA_ADVERTISING, adv) }) }

    private fun cleanupAllConnections() {
        connections.forEach { (_, c) -> c.gatt?.close() }
        connections.clear(); serverConnections.clear(); stopScan(); stopAdvertising()
    }
}
