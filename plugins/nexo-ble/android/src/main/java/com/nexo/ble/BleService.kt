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
 * BleService v3.0.1-ARCH — ÚNICO DUEÑO DE TODO BLE
 */
class BleService : Service() {

    companion object {
        private const val TAG = "NexoBleService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "nexo_ble_channel"

        val SERVICE_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6")
        val MESSAGE_CHAR_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c7")
        val ANNOUNCE_CHAR_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c8")
        val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        const val ACTION_SCAN_RESULT = "com.nexo.ble.SCAN_RESULT"
        const val ACTION_SCAN_FAILED = "com.nexo.ble.SCAN_FAILED"
        const val ACTION_SCAN_STOPPED = "com.nexo.ble.SCAN_STOPPED"
        const val ACTION_ADVERT_STATE = "com.nexo.ble.ADVERT_STATE"
        const val ACTION_MESSAGE_RECEIVED = "com.nexo.ble.MESSAGE_RECEIVED"
        const val ACTION_MESSAGE_SENT = "com.nexo.ble.MESSAGE_SENT"
        const val ACTION_DEVICE_CONNECTED = "com.nexo.ble.DEVICE_CONNECTED"
        const val ACTION_DEVICE_DISCONNECTED = "com.nexo.ble.DEVICE_DISCONNECTED"
        const val ACTION_SERVICES_READY = "com.nexo.ble.SERVICES_READY"
        const val ACTION_NOTIFICATIONS_ENABLED = "com.nexo.ble.NOTIFICATIONS_ENABLED"
        const val ACTION_CONNECTION_FAILED = "com.nexo.ble.CONNECTION_FAILED"
        const val ACTION_RETRY_SCHEDULED = "com.nexo.ble.RETRY_SCHEDULED"
        const val ACTION_PEER_INFO_RECEIVED = "com.nexo.ble.PEER_INFO_RECEIVED"
        const val ACTION_CLIENT_NOTIFICATION_STATE_CHANGED = "com.nexo.ble.CLIENT_NOTIFICATION_STATE_CHANGED"
        const val ACTION_NAP_AUDIT = "com.nexo.ble.NAP_AUDIT"

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

    enum class ConnectionState { IDLE, CONNECTING, DISCOVERING, READY, DISCONNECTING, FAILED }

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
            try { next.run() } finally { flag.set(false); processNextOperation(deviceId) }
        }
    }

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
        try { initGattServer() } catch (e: Exception) { napLog("BLE_INIT", "Error GATT: ${e.message}", "ERROR") }
    }

    override fun onDestroy() {
        stopScan(); stopAdvertising(); cleanupAllConnections(); gattServer?.close(); super.onDestroy()
    }

    private fun startForegroundService() {
        val notification = buildNotification("NEXO BLE activo")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else { startForeground(NOTIFICATION_ID, notification) }
    }

    private fun buildNotification(content: String): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXO Mesh").setContentText(content)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pendingIntent).setOngoing(true).build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "NEXO BLE Service", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

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
                        broadcastDeviceEvent(ACTION_DEVICE_CONNECTED, device, "incoming")
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

        override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic) {
            try {
                val value = if (characteristic.uuid == ANNOUNCE_CHAR_UUID) {
                    val json = org.json.JSONObject()
                    json.put("userId", userId); json.put("userName", userName)
                    json.put("timestamp", System.currentTimeMillis()); json.put("version", "3.0.1")
                    json.toString().toByteArray(Charsets.UTF_8)
                } else byteArrayOf()
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
            } catch (e: SecurityException) {}
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
                    putExtra(EXTRA_DEVICE_NAME, device?.name ?: "Unknown")
                    putExtra(EXTRA_MESSAGE, message); putExtra(EXTRA_CONTENT, content)
                    putExtra(EXTRA_SENDER_NAME, senderName); putExtra(EXTRA_MESSAGE_ID, mId)
                    putExtra(EXTRA_SOURCE, "server_write_request"); putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                })
                if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }

        override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            try {
                if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                if (descriptor.uuid == CCCD_UUID) {
                    val enabled = value != null && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    sendBroadcast(Intent(ACTION_CLIENT_NOTIFICATION_STATE_CHANGED).apply {
                        putExtra(EXTRA_DEVICE_ADDRESS, device.address); putExtra(EXTRA_ENABLED, enabled)
                    })
                }
            } catch (e: SecurityException) {}
        }
    }

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
        val now = System.currentTimeMillis()
        if (now - conn.lastAttemptTime < RATE_LIMIT_MS && conn.retryCount > 0) {
            handler.postDelayed({ executeConnectInternal(device, deviceId) }, RATE_LIMIT_MS - (now - conn.lastAttemptTime))
            return
        }
        conn.state = ConnectionState.CONNECTING
        conn.lastAttemptTime = now
        conn.userDisconnected = false
        conn.gatt?.let { try { it.disconnect(); it.close() } catch (e: Exception) {} }
        conn.gatt = null
        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(this, false, unifiedGattCallback, BluetoothDevice.TRANSPORT_LE)
        } else { device.connectGatt(this, false, unifiedGattCallback) }
        conn.gatt = gatt
        connectedGatts[deviceId] = gatt
        handler.postDelayed({ if (connections[deviceId]?.state == ConnectionState.CONNECTING) handleConnectionFailure(deviceId, "Timeout conexión") }, CONNECT_TIMEOUT_MS)
    }

    fun disconnectDevice(address: String) {
        val conn = connections[address]
        if (conn != null) {
            conn.userDisconnected = true
            conn.state = ConnectionState.DISCONNECTING
            conn.gatt?.let { try { it.disconnect() } catch (e: Exception) {} }
        }
        serverConnections.remove(address)
    }

    fun sendMessage(address: String, message: String): Boolean {
        val conn = connections[address] ?: return false
        if (conn.state != ConnectionState.READY) return false
        val mId = UUID.randomUUID().toString()
        val payload = try {
            val json = org.json.JSONObject()
            json.put("messageId", mId); json.put("timestamp", System.currentTimeMillis())
            json.put("senderId", userId); json.put("senderName", userName); json.put("content", message)
            json.toString().toByteArray(Charsets.UTF_8)
        } catch (e: Exception) { message.toByteArray(Charsets.UTF_8) }
        if (payload.size > CHUNK_SIZE * 10) return false
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
            handler.postDelayed({
                if (conn.pendingWriteMessageId == mId) {
                    conn.pendingWriteMessageId = null
                    broadcastPayloadSent(deviceId, mId, false)
                }
            }, WRITE_TIMEOUT_MS)
        } catch (e: Exception) { broadcastPayloadSent(deviceId, mId, false) }
    }

    private val unifiedGattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val addr = gatt.device.address
            val conn = connections[addr] ?: return
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                if (conn.state == ConnectionState.CONNECTING) {
                    conn.state = ConnectionState.DISCOVERING
                    conn.lastStateChangeTime = System.currentTimeMillis()
                    broadcastDeviceEvent(ACTION_DEVICE_CONNECTED, gatt.device, "outgoing", conn.retryCount)
                    handler.postDelayed({ try { gatt.discoverServices() } catch (e: Exception) {} }, 800)
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                val wasReady = conn.state == ConnectionState.READY
                conn.state = ConnectionState.IDLE; conn.gatt = null; connectedGatts.remove(addr)
                try { gatt.close() } catch (e: Exception) {}
                broadcastDeviceEvent(ACTION_DEVICE_DISCONNECTED, gatt.device, wasReady = wasReady)
                if (!conn.userDisconnected && conn.retryCount < MAX_RETRY_ATTEMPTS) scheduleRetry(addr)
                else if (conn.retryCount >= MAX_RETRY_ATTEMPTS) { conn.state = ConnectionState.FAILED; broadcastConnectionFailed(addr, "Máximo reintentos", conn.retryCount) }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val addr = gatt.device.address
            if (status != BluetoothGatt.GATT_SUCCESS) { handleConnectionFailure(addr, "Descubrimiento falló"); return }
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(MESSAGE_CHAR_UUID)
            if (char == null) { handleConnectionFailure(addr, "Servicio no encontrado"); return }
            try {
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
            } catch (e: SecurityException) { handleConnectionFailure(addr, "SecurityException notifications") }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (descriptor.uuid == CCCD_UUID && status == BluetoothGatt.GATT_SUCCESS) {
                sendBroadcast(Intent(ACTION_NOTIFICATIONS_ENABLED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, gatt.device.address); putExtra(EXTRA_ENABLED, true)
                })
                markConnectionReady(gatt.device.address, gatt)
            } else if (status != BluetoothGatt.GATT_SUCCESS) { handleConnectionFailure(gatt.device.address, "Descriptor write failed") }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid == MESSAGE_CHAR_UUID) {
                val msg = String(characteristic.value ?: byteArrayOf(), Charsets.UTF_8)
                var senderName = "NEXO Peer"; var content = msg; var mId = ""
                try {
                    val json = org.json.JSONObject(msg)
                    senderName = json.optString("senderName", senderName)
                    content = json.optString("content", content)
                    mId = json.optString("messageId", mId)
                } catch (e: Exception) {}
                sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, gatt.device.address)
                    putExtra(EXTRA_DEVICE_NAME, gatt.device.name ?: "Unknown")
                    putExtra(EXTRA_MESSAGE, msg); putExtra(EXTRA_CONTENT, content)
                    putExtra(EXTRA_SENDER_NAME, senderName); putExtra(EXTRA_MESSAGE_ID, mId)
                    putExtra(EXTRA_SOURCE, "client_notification"); putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                })
            }
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val addr = gatt.device.address
            val mId = connections[addr]?.pendingWriteMessageId ?: ""
            connections[addr]?.pendingWriteMessageId = null
            broadcastPayloadSent(addr, mId, status == BluetoothGatt.GATT_SUCCESS)
        }
    }

    private fun scheduleRetry(addr: String) {
        val conn = connections[addr] ?: return
        if (conn.userDisconnected) return
        val now = System.currentTimeMillis()
        if (now - conn.lastAttemptTime < RATE_LIMIT_MS) {
            handler.postDelayed({ scheduleRetry(addr) }, RATE_LIMIT_MS - (now - conn.lastAttemptTime))
            return
        }
        conn.retryCount++; conn.lastAttemptTime = now
        val delay = minOf(RETRY_BASE_DELAY_MS * (1 shl (conn.retryCount - 1)), RETRY_MAX_DELAY_MS)
        val jitter = Random().nextInt(1000)
        val total = delay + jitter
        broadcastRetryScheduled(addr, total, conn.retryCount)
        handler.postDelayed({
            val dev = bluetoothAdapter?.getRemoteDevice(addr)
            if (dev != null && connections[addr]?.state == ConnectionState.IDLE) executeConnectInternal(dev, addr)
        }, total)
    }

    private fun markConnectionReady(addr: String, gatt: BluetoothGatt) {
        val conn = connections[addr] ?: return
        conn.state = ConnectionState.READY; conn.retryCount = 0; conn.gatt = gatt
        sendBroadcast(Intent(ACTION_SERVICES_READY).apply { putExtra(EXTRA_DEVICE_ADDRESS, addr); putExtra(EXTRA_SUCCESS, true) })
        val pending = conn.pendingWritePayload; val pendingId = conn.pendingWriteMessageId
        if (pending != null && pendingId != null) { conn.pendingWritePayload = null; conn.pendingWriteMessageId = null; performWrite(addr, pending, pendingId) }
    }

    private fun handleConnectionFailure(addr: String, reason: String) {
        connections[addr]?.let { it.state = ConnectionState.IDLE; it.gatt?.close(); it.gatt = null }
        broadcastConnectionFailed(addr, reason, connections[addr]?.retryCount ?: 0)
    }

    fun startScan() {
        val adapter = bluetoothAdapter ?: run { broadcastScanFailed(-1, "Adapter null"); return }
        scanner = adapter.bluetoothLeScanner
        if (scanner == null) { broadcastScanFailed(-2, "Scanner null"); return }
        val now = SystemClock.elapsedRealtime()
        cleanupOldScanTimestamps(now)
        if (scanTimestamps.size >= 5) { broadcastScanFailed(-3, "Rate limit"); return }
        scanTimestamps.addLast(now); lastScanStartTime = now
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).setReportDelay(0).build()
        scanResults.clear(); isScanning = true
        try {
            scanner?.startScan(null, settings, scanCallback)
            handler.postDelayed({ if (isScanning) stopScan() }, SCAN_AUTO_STOP_MS)
        } catch (e: SecurityException) { isScanning = false; broadcastScanFailed(-4, "SecurityException") }
    }

    fun stopScan() {
        if (!isScanning) return
        isScanning = false
        try { scanner?.stopScan(scanCallback) } catch (e: Exception) {}
        sendBroadcast(Intent(ACTION_SCAN_STOPPED).apply { putExtra("result_count", scanResults.size) })
    }

    private fun cleanupOldScanTimestamps(now: Long) {
        while (scanTimestamps.isNotEmpty() && (now - scanTimestamps.first() > SCAN_RATE_LIMIT_MS)) scanTimestamps.removeFirst()
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.let {
                val isNexo = it.scanRecord?.serviceUuids?.any { u -> u.uuid == SERVICE_UUID } == true
                if (isNexo) {
                    val addr = it.device.address
                    val existing = scanResults[addr]
                    if (existing == null || it.rssi > existing.rssi) scanResults[addr] = it
                    sendBroadcast(Intent(ACTION_SCAN_RESULT).apply {
                        putExtra(EXTRA_DEVICE_ADDRESS, addr); putExtra(EXTRA_RSSI, it.rssi)
                        putExtra(EXTRA_DEVICE_NAME, it.device.name ?: it.scanRecord?.deviceName ?: "NEXO Device")
                    })
                }
            }
        }
        override fun onScanFailed(errorCode: Int) {
            isScanning = false
            val desc = when(errorCode) {
                SCAN_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "REGISTRATION_FAILED"
                SCAN_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                SCAN_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
                SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES -> "OUT_OF_RESOURCES"
                SCAN_FAILED_SCANNING_TOO_FREQUENTLY -> "TOO_FREQUENTLY"
                else -> "UNKNOWN($errorCode)"
            }
            broadcastScanFailed(errorCode, desc)
        }
    }

    fun startAdvertising(name: String) {
        val adapter = bluetoothAdapter ?: return
        try { adapter.name = name } catch (e: Exception) {}
        advertiser = adapter.bluetoothLeAdvertiser
        val settings = AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setConnectable(true).setTimeout(0).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH).build()
        val data = AdvertiseData.Builder().setIncludeDeviceName(true).addServiceUuid(ParcelUuid(SERVICE_UUID)).build()
        advertiser?.startAdvertising(settings, data, advertiseCallback)
    }

    fun stopAdvertising() {
        advertiser?.stopAdvertising(advertiseCallback)
        isAdvertising = false
        broadcastAdvertState(false)
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(s: AdvertiseSettings?) { isAdvertising = true; broadcastAdvertState(true) }
        override fun onStartFailure(errorCode: Int) { isAdvertising = false; broadcastAdvertState(false) }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MÉTODOS PÚBLICOS QUE EL PLUGIN BRIDGE NECESITA
    // ═══════════════════════════════════════════════════════════════════════
    fun setUserInfo(uid: String, uname: String) { userId = uid; userName = uname }

    fun isBluetoothEnabled(): Boolean = bluetoothAdapter?.isEnabled == true
    fun isScanning(): Boolean = isScanning
    fun isAdvertising(): Boolean = isAdvertising
    fun getScanResultCount(): Int = scanResults.size

    fun getConnectedDevices(): List<Map<String, String>> {
        val list = mutableListOf<Map<String, String>>()
        connections.forEach { (id, conn) ->
            if (conn.state == ConnectionState.READY) {
                list.add(mapOf("deviceId" to id, "address" to id, "name" to (conn.gatt?.device?.name ?: "NEXO Peer"), "direction" to "outgoing", "servicesReady" to "true"))
            }
        }
        serverConnections.forEach { (id, dev) ->
            try { list.add(mapOf("deviceId" to id, "address" to id, "name" to (dev.name ?: "NEXO Peer"), "direction" to "incoming", "servicesReady" to "true")) } catch (e: SecurityException) {}
        }
        return list
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BROADCAST HELPERS
    // ═══════════════════════════════════════════════════════════════════════
    private fun broadcastScanFailed(code: Int, desc: String) { sendBroadcast(Intent(ACTION_SCAN_FAILED).apply { putExtra(EXTRA_ERROR_CODE, code); putExtra(EXTRA_ERROR_DESC, desc) }) }
    private fun broadcastAdvertState(adv: Boolean) { sendBroadcast(Intent(ACTION_ADVERT_STATE).apply { putExtra(EXTRA_ADVERTISING, adv) }) }
    private fun broadcastDeviceEvent(action: String, dev: BluetoothDevice?, dir: String = "", attempt: Int = 0, wasReady: Boolean = false) { sendBroadcast(Intent(action).apply { putExtra(EXTRA_DEVICE_ADDRESS, dev?.address); putExtra(EXTRA_DEVICE_NAME, dev?.name ?: "Unknown"); putExtra(EXTRA_DIRECTION, dir); putExtra(EXTRA_ATTEMPT, attempt); putExtra("wasReady", wasReady) }) }
    private fun broadcastConnectionFailed(addr: String, r: String, att: Int) { sendBroadcast(Intent(ACTION_CONNECTION_FAILED).apply { putExtra(EXTRA_DEVICE_ADDRESS, addr); putExtra(EXTRA_REASON, r); putExtra(EXTRA_ATTEMPT, att); putExtra(EXTRA_MAX_ATTEMPTS, MAX_RETRY_ATTEMPTS) }) }
    private fun broadcastRetryScheduled(addr: String, delay: Long, att: Int) { sendBroadcast(Intent(ACTION_RETRY_SCHEDULED).apply { putExtra(EXTRA_DEVICE_ADDRESS, addr); putExtra(EXTRA_DELAY_MS, delay); putExtra(EXTRA_ATTEMPT, att) }) }
    private fun broadcastPayloadSent(addr: String, mId: String, success: Boolean) { sendBroadcast(Intent(ACTION_MESSAGE_SENT).apply { putExtra(EXTRA_DEVICE_ADDRESS, addr); putExtra(EXTRA_MESSAGE_ID, mId); putExtra(EXTRA_SUCCESS, success) }) }

    private fun napLog(code: String, msg: String, level: String = "INFO") {
        val f = "[$code] $msg"
        when(level) { "ERROR" -> Log.e(TAG, f); "WARN" -> Log.w(TAG, f); "DEBUG" -> Log.d(TAG, f); else -> Log.i(TAG, f) }
        sendBroadcast(Intent(ACTION_NAP_AUDIT).apply { putExtra(EXTRA_NAP_CODE, code); putExtra(EXTRA_NAP_MESSAGE, msg); putExtra(EXTRA_NAP_LEVEL, level); putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis()) })
    }

        private fun cleanupAllConnections() {
        connections.forEach { (_, c) ->
            c.userDisconnected = true
            c.gatt?.let { try { it.disconnect(); it.close() } catch (e: Exception) {} }
            c.gatt = null
            c.state = ConnectionState.IDLE
        }
        serverConnections.clear()
        gattServer?.close()
        gattServer = null
    }
}

        

