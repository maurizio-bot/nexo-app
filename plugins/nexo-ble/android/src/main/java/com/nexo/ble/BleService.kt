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
        const val EXTRA_WAS_READY = "wasReady"

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
        IDLE,           // Sin GATT, sin intentos
        CONNECTING,     // GATT creado, esperando onConnectionStateChange(CONNECTED)
        DISCOVERING,    // Conectado, esperando onServicesDiscovered
        READY,          // Servicios listos, notificaciones activas, listo para mensajes
        DISCONNECTING,  // disconnect() llamado, esperando callback DISCONNECTED
        FAILED          // Máximo de retries alcanzado
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
    // B. SERIALIZACIÓN ESTRUCTA — Nunca dos operaciones simultáneas por device
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

    // ═══════════════════════════════════════════════════════════════════════
    // D. LIFECYCLE
    // ═══════════════════════════════════════════════════════════════════════
    override fun onCreate() {
        super.onCreate()
        bluetoothManager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter

        createNotificationChannel()
        startForegroundService()

        try { initGattServer() }
        catch (e: SecurityException) {
            napLog("BLE_INIT", "GATT Server postergado — sin permisos: ${e.message}", "WARN")
        } catch (e: Exception) {
            napLog("BLE_INIT", "Error GATT Server: ${e.message}", "ERROR")
        }

        napLog("BLE_INIT", "BleService v3.0.0-ARCH creado — Único dueño BLE", "INFO")
    }

    override fun onDestroy() {
        stopScan()
        stopAdvertising()
        cleanupAllConnections()
        gattServer?.close()
        super.onDestroy()
        napLog("BLE_DESTROY", "BleService destruido", "INFO")
    }

    // ═══════════════════════════════════════════════════════════════════════
    // E. FOREGROUND SERVICE
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
            val channel = NotificationChannel(CHANNEL_ID, "NEXO BLE Service", NotificationManager.IMPORTANCE_LOW)
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // F. GATT SERVER (Único en la app)
    // ═══════════════════════════════════════════════════════════════════════
    private fun ensureGattServer() {
        if (gattServer != null) return
        try { initGattServer() }
        catch (e: SecurityException) { napLog("BLE_GATT", "ensureGattServer postergado", "WARN") }
        catch (e: Exception) { napLog("BLE_GATT", "ensureGattServer falló: ${e.message}", "ERROR") }
    }

    private fun initGattServer() {
        val adapter = bluetoothAdapter ?: return
        gattServer = bluetoothManager?.openGattServer(this, gattServerCallback)

        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)

        // Característica principal: RX/TX mensajes
        val messageChar = BluetoothGattCharacteristic(
            MESSAGE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        val cccd = BluetoothGattDescriptor(CCCD_UUID, BluetoothGattDescriptor.PERMISSION_WRITE or BluetoothGattDescriptor.PERMISSION_READ)
        messageChar.addDescriptor(cccd)
        service.addCharacteristic(messageChar)

        // Característica announce: info del peer para reads entrantes
        val announceChar = BluetoothGattCharacteristic(
            ANNOUNCE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        service.addCharacteristic(announceChar)

        gattServer?.addService(service)
        napLog("BLE_GS_OK", "GATT Server iniciado: servicio=$SERVICE_UUID", "INFO")
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    device?.address?.let { addr ->
                        serverConnections[addr] = device
                        napLog("BLE_SRV_CONN", "[SERVER] Conectado ENTRANTE: $addr", "INFO")
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

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic
        ) {
            try {
                val value = when (characteristic.uuid) {
                    ANNOUNCE_CHAR_UUID -> {
                        val json = org.json.JSONObject()
                        json.put("userId", userId)
                        json.put("userName", userName)
                        json.put("timestamp", System.currentTimeMillis())
                        json.put("serviceVersion", "3.0.0-ARCH")
                        json.toString().toByteArray(Charsets.UTF_8)
                    }
                    else -> byteArrayOf()
                }
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
            } catch (e: SecurityException) { }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice?, requestId: Int, characteristic: BluetoothGattCharacteristic?,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            if (characteristic?.uuid == MESSAGE_CHAR_UUID && value != null) {
                val message = String(value, Charsets.UTF_8)
                napLog("BLE_SRV_MSG", "[SERVER] Mensaje recibido de ${device?.address}: $message", "INFO")

                var senderName = "NEXO Peer"
                var messageContent = message
                var messageId = ""
                try {
                    val json = org.json.JSONObject(message)
                    if (json.has("senderName")) senderName = json.getString("senderName")
                    if (json.has("content")) messageContent = json.getString("content")
                    if (json.has("messageId")) messageId = json.getString("messageId")
                } catch (e: Exception) { }

                sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, device?.address)
                    putExtra(EXTRA_DEVICE_NAME, device?.name ?: "Unknown")
                    putExtra(EXTRA_MESSAGE, message)
                    putExtra(EXTRA_CONTENT, messageContent)
                    putExtra(EXTRA_DATA, message)
                    putExtra(EXTRA_SENDER_NAME, senderName)
                    putExtra(EXTRA_MESSAGE_ID, messageId)
                    putExtra(EXTRA_SOURCE, "server_write_request")
                    putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                })

                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
                }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            try {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
                if (descriptor.uuid == CCCD_UUID) {
                    val enabled = value != null && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    sendBroadcast(Intent(ACTION_CLIENT_NOTIFICATION_STATE_CHANGED).apply {
                        putExtra(EXTRA_DEVICE_ADDRESS, device.address)
                        putExtra(EXTRA_ENABLED, enabled)
                    })
                }
            } catch (e: SecurityException) { }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // G. GATT CLIENT (máquina de estados completa)
    // ═══════════════════════════════════════════════════════════════════════
    fun connectToDevice(address: String): Boolean {
        val adapter = bluetoothAdapter ?: return false
        if (!adapter.isEnabled) return false
        val device = adapter.getRemoteDevice(address) ?: return false

        val conn = connections.getOrPut(address) { BLEConnection(address) }
        if (conn.state == ConnectionState.READY) {
            napLog("BLE_CONN_DUP", "Ya conectado a $address", "INFO")
            return true
        }
        if (conn.state == ConnectionState.CONNECTING) {
            napLog("BLE_CONN_DUP", "Conexión en progreso a $address", "WARN")
            return false
        }

        // Cerrar GATT anterior si existe en estado IDLE/FAILED
        conn.gatt?.let { oldGatt ->
            if (conn.state == ConnectionState.IDLE || conn.state == ConnectionState.FAILED) {
                try { oldGatt.disconnect() } catch (e: Exception) { }
                try { oldGatt.close() } catch (e: Exception) { }
                conn.gatt = null
            }
        }

        enqueueOperation(address) {
            executeConnectInternal(device, address)
        }
        return true
    }

    private fun executeConnectInternal(device: BluetoothDevice, deviceId: String) {
        val conn = connections.getOrPut(deviceId) { BLEConnection(deviceId) }

        // Rate limiting
        val now = System.currentTimeMillis()
        if (now - conn.lastAttemptTime < RATE_LIMIT_MS && conn.retryCount > 0) {
            val wait = RATE_LIMIT_MS - (now - conn.lastAttemptTime)
            handler.postDelayed({ executeConnectInternal(device, deviceId) }, wait)
            return
        }

        conn.state = ConnectionState.CONNECTING
        conn.lastAttemptTime = now
        conn.userDisconnected = false
        conn.servicesReady = false
        conn.notificationsEnabled = false

        // Cierre síncrono de GATT anterior
        conn.gatt?.let { oldGatt ->
            try { oldGatt.disconnect() } catch (e: Exception) { }
            try { oldGatt.close() } catch (e: Exception) { }
            conn.gatt = null
        }

        napLog("BLE_CONN_REQ", "Conectar a $deviceId (attempt=${conn.retryCount})", "INFO")

        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(this, false, unifiedGattCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(this, false, unifiedGattCallback)
        }

        if (gatt == null) {
            handleConnectionFailure(deviceId, "connectGatt retornó null")
            return
        }
        conn.gatt = gatt
        connectedGatts[deviceId] = gatt

        // Timeout de conexión
        handler.postDelayed({
            if (connections[deviceId]?.state == ConnectionState.CONNECTING) {
                handleConnectionFailure(deviceId, "Timeout esperando conexión")
            }
        }, CONNECT_TIMEOUT_MS)
    }

    fun disconnectDevice(address: String) {
        val conn = connections[address]
        if (conn != null) {
            conn.userDisconnected = true
            conn.state = ConnectionState.DISCONNECTING
            conn.gatt?.let { gatt ->
                try { gatt.disconnect() } catch (e: Exception) { }
            }
        }
        serverConnections.remove(address)
    }

    fun sendMessage(address: String, message: String): Boolean {
        val conn = connections[address] ?: return false
        if (conn.state != ConnectionState.READY || conn.gatt == null) return false

        val messageId = UUID.randomUUID().toString()
        val payload = try {
            val json = org.json.JSONObject()
            json.put("messageId", messageId)
            json.put("timestamp", System.currentTimeMillis())
            json.put("senderId", userId)
            json.put("senderName", userName)
            json.put("content", message)
            json.put("type", "chat")
            json.toString().toByteArray(Charsets.UTF_8)
        } catch (e: Exception) {
            message.toByteArray(Charsets.UTF_8)
        }

        if (payload.size > CHUNK_SIZE * 10) {
            napLog("BLE_MSG_BIG", "Mensaje demasiado grande: ${payload.size}", "ERROR")
            return false
        }

        performWrite(address, payload, messageId)
        return true
    }

    private fun performWrite(deviceId: String, payload: ByteArray, messageId: String) {
        val conn = connections[deviceId] ?: return
        val gatt = conn.gatt ?: return
        if (conn.state != ConnectionState.READY) {
            napLog("BLE_WRITE_ERR", "No está listo para escribir a $deviceId", "ERROR")
            return
        }
        try {
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(MESSAGE_CHAR_UUID)
            if (char == null) {
                napLog("BLE_WRITE_ERR", "Característica no disponible en $deviceId", "ERROR")
                return
            }
            conn.pendingWritePayload = payload
            conn.pendingWriteMessageId = messageId

            // Timeout de escritura
            handler.postDelayed({
                if (conn.pendingWriteMessageId == messageId) {
                    conn.pendingWritePayload = null
                    conn.pendingWriteMessageId = null
                    napLog("BLE_WRITE_TO", "Timeout escritura $deviceId", "ERROR")
                    broadcastPayloadSent(deviceId, messageId, false)
                }
            }, WRITE_TIMEOUT_MS)

            val success = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(char, payload, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == android.bluetooth.BluetoothStatusCodes.SUCCESS
            } else {
                @Suppress("DEPRECATION")
                char.value = payload
                @Suppress("DEPRECATION")
                gatt.writeCharacteristic(char)
            }
            napLog("BLE_WRITE", "Enviando a $deviceId (success=$success, id=$messageId)", "INFO")
        } catch (e: SecurityException) {
            conn.pendingWritePayload = null
            conn.pendingWriteMessageId = null
            napLog("BLE_WRITE_SEC", "SecurityException: ${e.message}", "ERROR")
        }
    }

    private val unifiedGattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            val conn = connections[deviceId] ?: return

            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    if (conn.state == ConnectionState.CONNECTING) {
                        conn.state = ConnectionState.DISCOVERING
                        conn.lastStateChangeTime = System.currentTimeMillis()
                        napLog("BLE_GATT_OK", "[CLIENT] GATT conectado: $deviceId (attempt=${conn.retryCount})", "INFO")
                        broadcastDeviceEvent(ACTION_DEVICE_CONNECTED, gatt.device, direction = "outgoing", attempt = conn.retryCount)
                        handler.postDelayed({
                            try { gatt.discoverServices() }
                            catch (e: SecurityException) {
                                handleConnectionFailure(deviceId, "SecurityException discoverServices")
                            }
                        }, 800)
                    }
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    val wasReady = conn.state == ConnectionState.READY
                    conn.state = ConnectionState.IDLE
                    conn.gatt = null
                    connectedGatts.remove(deviceId)
                    try { gatt.close() } catch (e: Exception) { }

                    broadcastDeviceEvent(ACTION_DEVICE_DISCONNECTED, gatt.device, wasReady = wasReady)

                    if (conn.userDisconnected) {
                        napLog("BLE_USER_DISC", "Desconexión manual $deviceId — no reintentar", "INFO")
                        conn.userDisconnected = false
                        return
                    }
                    if (status != BluetoothGatt.GATT_SUCCESS && conn.retryCount < MAX_RETRY_ATTEMPTS) {
                        scheduleRetry(deviceId)
                    } else if (conn.retryCount >= MAX_RETRY_ATTEMPTS) {
                        conn.state = ConnectionState.FAILED
                        broadcastConnectionFailed(deviceId, "Máximo reintentos alcanzados", conn.retryCount)
                    }
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            val conn = connections[deviceId] ?: return
            if (status != BluetoothGatt.GATT_SUCCESS) {
                handleConnectionFailure(deviceId, "Descubrimiento falló status=$status")
                return
            }
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(MESSAGE_CHAR_UUID)
            if (service == null || char == null) {
                handleConnectionFailure(deviceId, "Servicio NEXO no encontrado")
                return
            }
            try {
                gatt.setCharacteristicNotification(char, true)
                val descriptor = char.getDescriptor(CCCD_UUID)
                if (descriptor != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    } else {
                        @Suppress("DEPRECATION")
                        descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        @Suppress("DEPRECATION")
                        gatt.writeDescriptor(descriptor)
                    }
                } else {
                    markConnectionReady(deviceId, gatt)
                }
            } catch (e: SecurityException) {
                handleConnectionFailure(deviceId, "SecurityException notifications")
            }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == CCCD_UUID) {
                sendBroadcast(Intent(ACTION_NOTIFICATIONS_ENABLED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, deviceId)
                    putExtra(EXTRA_ENABLED, true)
                })
                markConnectionReady(deviceId, gatt)
            } else if (status != BluetoothGatt.GATT_SUCCESS) {
                handleConnectionFailure(deviceId, "Descriptor write failed: $status")
            }
        }

        override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS && characteristic.uuid == ANNOUNCE_CHAR_UUID) {
                val data = characteristic.value?.let { String(it) } ?: "{}"
                try {
                    val json = org.json.JSONObject(data)
                    val peerName = json.optString("userName", "NEXO Peer")
                    val peerId = json.optString("userId", "")
                    sendBroadcast(Intent(ACTION_PEER_INFO_RECEIVED).apply {
                        putExtra(EXTRA_DEVICE_ADDRESS, gatt.device?.address ?: "")
                        putExtra(EXTRA_DEVICE_NAME, peerName)
                        putExtra(EXTRA_USER_ID, peerId)
                    })
                } catch (e: Exception) { }
            }
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            val conn = connections[deviceId] ?: return
            val messageId = conn.pendingWriteMessageId ?: ""
            val success = status == BluetoothGatt.GATT_SUCCESS
            if (success) {
                conn.pendingWritePayload = null
                conn.pendingWriteMessageId = null
                broadcastPayloadSent(deviceId, messageId, true)
            } else {
                conn.pendingWritePayload = null
                conn.pendingWriteMessageId = null
                broadcastPayloadSent(deviceId, messageId, false)
                napLog("BLE_WRITE_FAIL", "Escritura falló status=$status en $deviceId", "ERROR")
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid == MESSAGE_CHAR_UUID) {
                val message = String(characteristic.value ?: byteArrayOf(), Charsets.UTF_8)
                val address = gatt.device?.address ?: "unknown"
                napLog("BLE_NOTIF", "[CLIENT] Notificación de $address: $message", "INFO")

                var senderName = "NEXO Peer"
                var messageContent = message
                var messageId = ""
                try {
                    val json = org.json.JSONObject(message)
                    if (json.has("senderName")) senderName = json.getString("senderName")
                    if (json.has("content")) messageContent = json.getString("content")
                    if (json.has("messageId")) messageId = json.getString("messageId")
                } catch (e: Exception) { }

                sendBroadcast(Intent(ACTION_MESSAGE_RECEIVED).apply {
                    putExtra(EXTRA_DEVICE_ADDRESS, address)
                    putExtra(EXTRA_DEVICE_NAME, gatt.device?.name ?: "Unknown")
                    putExtra(EXTRA_MESSAGE, message)
                    putExtra(EXTRA_CONTENT, messageContent)
                    putExtra(EXTRA_DATA, message)
                    putExtra(EXTRA_SENDER_NAME, senderName)
                    putExtra(EXTRA_MESSAGE_ID, messageId)
                    putExtra(EXTRA_SOURCE, "client_notification")
                    putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                })
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // H. RETRY + ESTADOS
    // ═══════════════════════════════════════════════════════════════════════
    private fun scheduleRetry(deviceId: String) {
        val conn = connections[deviceId] ?: return
        if (conn.userDisconnected) return

        val now = System.currentTimeMillis()
        val elapsed = now - conn.lastAttemptTime
        if (elapsed < RATE_LIMIT_MS) {
            handler.postDelayed({ scheduleRetry(deviceId) }, RATE_LIMIT_MS - elapsed)
            return
        }
        conn.retryCount++
        conn.lastAttemptTime = now
        val delay = minOf(RETRY_BASE_DELAY_MS * (1 shl (conn.retryCount - 1)), RETRY_MAX_DELAY_MS)
        val jitter = Random().nextInt(1000)
        val totalDelay = delay + jitter

        napLog("BLE_RETRY", "Retry $deviceId en ${totalDelay}ms (attempt=${conn.retryCount})", "INFO")
        broadcastRetryScheduled(deviceId, totalDelay, conn.retryCount)

        handler.postDelayed({
            val adapter = bluetoothAdapter
            val device = adapter?.getRemoteDevice(deviceId)
            if (device != null && (connections[deviceId]?.state == ConnectionState.IDLE)) {
                executeConnectInternal(device, deviceId)
            }
        }, totalDelay)
    }

    private fun markConnectionReady(deviceId: String, gatt: BluetoothGatt) {
        val conn = connections[deviceId] ?: return
        conn.state = ConnectionState.READY
        conn.retryCount = 0
        conn.gatt = gatt
        conn.servicesReady = true
        conn.notificationsEnabled = true
        conn.lastStateChangeTime = System.currentTimeMillis()

        sendBroadcast(Intent(ACTION_SERVICES_READY).apply {
            putExtra(EXTRA_DEVICE_ADDRESS, deviceId)
            putExtra(EXTRA_SUCCESS, true)
        })

        // Procesar write pendiente
        val pendingPayload = conn.pendingWritePayload
        val pendingMessageId = conn.pendingWriteMessageId
        if (pendingPayload != null && pendingMessageId != null) {
            conn.pendingWritePayload = null
            conn.pendingWriteMessageId = null
            performWrite(deviceId, pendingPayload, pendingMessageId)
        }
    }

    private fun handleConnectionFailure(deviceId: String, reason: String) {
        val conn = connections[deviceId] ?: return
        conn.gatt?.let { gatt ->
            try { gatt.disconnect() } catch (e: Exception) { }
            try { gatt.close() } catch (e: Exception) { }
        }
        conn.gatt = null
        conn.state = ConnectionState.IDLE
        connectedGatts.remove(deviceId)

        broadcastConnectionFailed(deviceId, reason, conn.retryCount)

        if (!conn.userDisconnected && conn.retryCount < MAX_RETRY_ATTEMPTS) {
            scheduleRetry(deviceId)
        } else {
            conn.state = ConnectionState.FAILED
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // I. SCAN (FIX S24 — sin hardware filter)
    // ═══════════════════════════════════════════════════════════════════════
    fun startScan() {
        val adapter = bluetoothAdapter ?: run {
            broadcastScanFailed(-1, "BluetoothAdapter null")
            return
        }
        scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
            broadcastScanFailed(-2, "BluetoothLeScanner null")
            return
        }

        val now = SystemClock.elapsedRealtime()
        cleanupOldScanTimestamps(now)
        if (scanTimestamps.size >= 5) {
            val oldest = scanTimestamps.first()
            val waitMs = SCAN_RATE_LIMIT_MS - (now - oldest)
            broadcastScanFailed(-3, "Rate limit: espera ${waitMs}ms")
            return
        }
        scanTimestamps.addLast(now)
        lastScanStartTime = now

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()

        scanResults.clear()
        isScanning = true

        try {
            scanner?.startScan(null, settings, scanCallback)
            napLog("BLE_SCAN", "Scan iniciado (software filter S24)", "INFO")
            handler.postDelayed({ if (isScanning) stopScan() }, SCAN_AUTO_STOP_MS)
        } catch (e: SecurityException) {
            isScanning = false
            broadcastScanFailed(-4, "SecurityException: ${e.message}")
        }
    }

    fun stopScan() {
        if (!isScanning) return
        isScanning = false
        try {
            scanner?.stopScan(scanCallback)
            napLog("BLE_SCAN", "Scan detenido. Resultados: ${scanResults.size}", "INFO")
            sendBroadcast(Intent(ACTION_SCAN_STOPPED).apply {
                putExtra("result_count", scanResults.size)
            })
        } catch (e: SecurityException) {
            napLog("BLE_SCAN", "SecurityException stopScan: ${e.message}", "ERROR")
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
            val name = try { device.name ?: result.scanRecord?.deviceName ?: "NEXO Device" } catch (e: SecurityException) { "NEXO Device" }

            // FIX S24: Filtrado por software
            val uuids = result.scanRecord?.serviceUuids
            val isNexo = uuids?.any { it.uuid == SERVICE_UUID } == true
            if (!isNexo) return

            val existing = scanResults[address]
            if (existing == null || result.rssi > existing.rssi) {
                scanResults[address] = result
            }

            sendBroadcast(Intent(ACTION_SCAN_RESULT).apply {
                putExtra(EXTRA_DEVICE_ADDRESS, address)
                putExtra(EXTRA_DEVICE_NAME, name)
                putExtra(EXTRA_RSSI, result.rssi)
            })
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            results?.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
        }

        override fun onScanFailed(errorCode: Int) {
            isScanning = false
            val errorDesc = "SCAN_FAILED_$errorCode"
            napLog("BLE_SCAN_FAIL", "Scan failed: $errorCode ($errorDesc)", "ERROR")
            broadcastScanFailed(errorCode, errorDesc)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // J. ADVERTISING
    // ═══════════════════════════════════════════════════════════════════════
    fun startAdvertising(deviceName: String) {
        ensureGattServer()
        val adapter = bluetoothAdapter ?: run {
            napLog("BLE_ADVERT", "BluetoothAdapter null", "ERROR")
            return
        }
        try { adapter.name = deviceName } catch (e: SecurityException) { }

        advertiser = adapter.bluetoothLeAdvertiser
        if (advertiser == null) {
            napLog("BLE_ADVERT", "Advertiser no soportado", "ERROR")
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
        napLog("BLE_ADVERT", "Advertising iniciado: name=$deviceName", "INFO")
    }

    fun stopAdvertising() {
        advertiser?.stopAdvertising(advertiseCallback)
        isAdvertising = false
        broadcastAdvertState(false)
        napLog("BLE_ADVERT", "Advertising detenido", "INFO")
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            isAdvertising = true
            broadcastAdvertState(true)
            napLog("BLE_ADVERT", "onStartSuccess", "INFO")
        }
        override fun onStartFailure(errorCode: Int) {
            isAdvertising = false
            broadcastAdvertState(false)
            napLog("BLE_ADVERT", "onStartFailure: $errorCode", "ERROR")
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // K. UTILIDADES PÚBLICAS (accesibles vía LocalBinder)
    // ═══════════════════════════════════════════════════════════════════════
    fun isBluetoothEnabled(): Boolean = bluetoothAdapter?.isEnabled == true
    fun isScanning(): Boolean = isScanning
    fun isAdvertising(): Boolean = isAdvertising
    fun getScanResultCount(): Int = scanResults.size
    fun getScanResults(): Map<String, ScanResult> = scanResults.toMap()

    fun getConnectedDevices(): List<Map<String, String>> {
        val list = mutableListOf<Map<String, String>>()
        connections.forEach { (id, conn) ->
            if (conn.state == ConnectionState.READY) {
                list.add(mapOf(
                    "deviceId" to id,
                    "address" to id,
                    "name" to (conn.gatt?.device?.name ?: "NEXO Peer"),
                    "direction" to "outgoing",
                    "servicesReady" to "true"
                ))
            }
        }
        serverConnections.forEach { (id, device) ->
            try {
                list.add(mapOf(
                    "deviceId" to id,
                    "address" to id,
                    "name" to (device.name ?: "NEXO Peer"),
                    "direction" to "incoming",
                    "servicesReady" to "true"
                ))
            } catch (e: SecurityException) { }
        }
        return list
    }

    fun setUserInfo(uid: String, uname: String) {
        userId = uid
        userName = uname
    }

    // ═══════════════════════════════════════════════════════════════════════
    // L. BROADCAST HELPERS
    // ═══════════════════════════════════════════════════════════════════════
    private fun broadcastScanFailed(errorCode: Int, description: String) {
        sendBroadcast(Intent(ACTION_SCAN_FAILED).apply {
            putExtra(EXTRA_ERROR_CODE, errorCode)
            putExtra(EXTRA_ERROR_DESC, description)
        })
    }

    private fun broadcastAdvertState(advertising: Boolean) {
        sendBroadcast(Intent(ACTION_ADVERT_STATE).apply {
            putExtra(EXTRA_ADVERTISING, advertising)
        })
    }

    private fun broadcastDeviceEvent(action: String, device: BluetoothDevice?, direction: String = "unknown", attempt: Int = 0, wasReady: Boolean = false) {
        sendBroadcast(Intent(action).apply {
            putExtra(EXTRA_DEVICE_ADDRESS, device?.address)
            putExtra(EXTRA_DEVICE_NAME, try { device?.name ?: "Unknown" } catch (e: SecurityException) { "Unknown" })
            putExtra(EXTRA_DIRECTION, direction)
            putExtra(EXTRA_ATTEMPT, attempt)
            putExtra(EXTRA_WAS_READY, wasReady)
        })
    }

    private fun broadcastConnectionFailed(deviceId: String, reason: String, attempt: Int) {
        sendBroadcast(Intent(ACTION_CONNECTION_FAILED).apply {
            putExtra(EXTRA_DEVICE_ADDRESS, deviceId)
            putExtra(EXTRA_REASON, reason)
            putExtra(EXTRA_ATTEMPT, attempt)
            putExtra(EXTRA_MAX_ATTEMPTS, MAX_RETRY_ATTEMPTS)
        })
    }

    private fun broadcastRetryScheduled(deviceId: String, delayMs: Long, attempt: Int) {
        sendBroadcast(Intent(ACTION_RETRY_SCHEDULED).apply {
            putExtra(EXTRA_DEVICE_ADDRESS, deviceId)
            putExtra(EXTRA_DELAY_MS, delayMs)
            putExtra(EXTRA_ATTEMPT, attempt)
        })
    }

    private fun broadcastPayloadSent(deviceId: String, messageId: String, success: Boolean) {
        sendBroadcast(Intent(ACTION_MESSAGE_SENT).apply {
            putExtra(EXTRA_DEVICE_ADDRESS, deviceId)
            putExtra(EXTRA_MESSAGE_ID, messageId)
            putExtra(EXTRA_SUCCESS, success)
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // M. NAP LOGGING (emite broadcast para auditoría)
    // ═══════════════════════════════════════════════════════════════════════
    private fun napLog(code: String, message: String, level: String = "INFO") {
        val formatted = "[$code] $message [Native:true]"
        when (level) {
            "ERROR" -> Log.e(TAG, formatted)
            "WARN" -> Log.w(TAG, formatted)
            "DEBUG" -> Log.d(TAG, formatted)
            else -> Log.i(TAG, formatted)
        }
        sendBroadcast(Intent(ACTION_NAP_AUDIT).apply {
            putExtra(EXTRA_NAP_CODE, code)
            putExtra(EXTRA_NAP_MESSAGE, message)
            putExtra(EXTRA_NAP_LEVEL, level)
            putExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // N. CLEANUP
    // ═══════════════════════════════════════════════════════════════════════
    private fun cleanupAllConnections() {
        connections.forEach { (id, conn) ->
            conn.userDisconnected = true
            conn.gatt?.let { gatt ->
                try { gatt.disconnect() } catch (e: Exception) { }
                try { gatt.close() } catch (e: Exception) { }
            }
            conn.gatt = null
            conn.state = ConnectionState.IDLE
        }
        serverConnections.clear()
        gattServer?.close()
        gattServer = null
        stopScan()
        stopAdvertising()
    }
}
