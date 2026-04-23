package com.nexo.ble

import android.app.Activity
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.*
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import android.util.LruCache
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.JSArray
import com.nexo.ble.model.NexoGattService
import com.nexo.ble.model.MessageChunker
import org.json.JSONObject
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

// ==========================================
// NAP-BLE v5.0.0-ARCH
// FIX: Foreground Service, synchronized GATT, LRU dedup,
// auto-restart server, forced disconnect timeout, memory leak cleanup
// ==========================================

@CapacitorPlugin(
    name = "NexoBLE",
    permissions = [
        Permission(strings = [android.Manifest.permission.BLUETOOTH_SCAN], alias = "bluetoothScan"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetoothConnect"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_ADVERTISE], alias = "bluetoothAdvertise"),
        Permission(strings = [android.Manifest.permission.ACCESS_FINE_LOCATION], alias = "location")
    ]
)
class NexoBlePlugin : Plugin() {
    companion object {
        const val TAG = "NAP-BLE"
        
        const val NAP_BLE_READY = "BLE_050"
        const val NAP_BLE_CONNECTED = "BLE_051"
        const val NAP_BLE_SCAN_STARTED = "BLE_052"
        const val NAP_BLE_ADVERTISE_STARTED = "BLE_053"
        const val NAP_BLE_MESSAGE_SENT = "BLE_054"
        const val NAP_BLE_MESSAGE_RECEIVED = "BLE_054_R"
        const val NAP_BLE_PERMISSIONS_GRANTED = "BLE_056"
        const val NAP_BLE_NOTIFICATION_ENABLED = "BLE_057"
        const val NAP_BLE_MTU_CHANGED = "BLE_058"
        const val NAP_BLE_SERVER_READY = "BLE_059"
        const val NAP_BLE_SERVICE_ADDED = "BLE_060"
        
        const val NAP_BLE_ERR_NOT_SUPPORTED = "BLE_200"
        const val NAP_BLE_ERR_DISABLED = "BLE_201"
        const val NAP_BLE_ERR_PERMISSION_DENIED = "BLE_202"
        const val NAP_BLE_ERR_INIT_FAILED = "BLE_203"
        const val NAP_BLE_ERR_SCAN_FAILED = "BLE_204"
        const val NAP_BLE_ERR_ADVERTISE_FAILED = "BLE_205"
        const val NAP_BLE_ERR_CONNECTION_FAILED = "BLE_206"
        const val NAP_BLE_ERR_SECURITY_EXCEPTION = "BLE_207"
        const val NAP_BLE_ERR_GATT_CONFLICT = "BLE_209"
        
        const val ERR_INVALID_PARAMS = "BLE_019"
        const val ERR_NOT_CONNECTED = "BLE_011"
        const val ERR_MESSAGE_TOO_LARGE = "BLE_008"
        const val ERR_DEVICE_NOT_FOUND = "BLE_006"
        
        const val MTU_DEFAULT = 512
        const val CHUNK_SIZE = 507
        const val REQUEST_ENABLE_BT = 1001
        
        const val MAX_RETRY_ATTEMPTS = 3
        const val RETRY_BASE_DELAY_MS = 2000L
        const val RETRY_MAX_DELAY_MS = 16000L
        const val CONNECT_TIMEOUT_MS = 15000L
        const val WRITE_TIMEOUT_MS = 5000L
        const val RATE_LIMIT_MS = 5000L
        const val DISCONNECT_FORCE_CLOSE_MS = 2000L
        
        val SERVICE_UUID = NexoGattService.SERVICE_UUID
        val CHAR_ANNOUNCE = NexoGattService.ANNOUNCE_CHAR_UUID
        val CHAR_HANDSHAKE = NexoGattService.HANDSHAKE_CHAR_UUID
        val CHAR_PAYLOAD = NexoGattService.PAYLOAD_CHAR_UUID
        val CHAR_CONTROL = NexoGattService.CONTROL_CHAR_UUID
        val CCCD_UUID = NexoGattService.CLIENT_CONFIG_UUID
    }

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
        var pendingWriteCall: PluginCall? = null,
        var pendingWritePayload: ByteArray? = null,
        var pendingWriteMessageId: String? = null,
        var userDisconnected: Boolean = false,
        var negotiatedMtu: Int = 20,
        var pendingChunks: LinkedList<ByteArray>? = null,
        var currentChunkIndex: Int = 0,
        var totalChunks: Int = 0,
        var role: String = "client"
    )
    
    private val connections = ConcurrentHashMap<String, BLEConnection>()
    private val operationQueue = ConcurrentHashMap<String, LinkedList<Runnable>>()
    private val isOperating = ConcurrentHashMap<String, AtomicBoolean>()
    
    private fun enqueueOperation(deviceId: String, operation: Runnable) {
        val queue = operationQueue.getOrPut(deviceId) { LinkedList() }
        synchronized(queue) { queue.add(operation) }
        processNextOperation(deviceId)
    }
    
    private fun processNextOperation(deviceId: String) {
        val flag = isOperating.getOrPut(deviceId) { AtomicBoolean(false) }
        if (flag.getAndSet(true)) return
        val queue = operationQueue[deviceId] ?: return
        val next: Runnable?
        synchronized(queue) { next = queue.pollFirst() }
        if (next == null) { flag.set(false); return }
        handler.post {
            try { next.run() }
            finally {
                flag.set(false)
                processNextOperation(deviceId)
            }
        }
    }

    private var bleService: BleService? = null
    private var serviceBound = false
    
    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? BleService.LocalBinder
            bleService = binder?.getService()
            serviceBound = true
            napLog("BLE_SVC_BOUND", "BleService conectado")
            val ready = bleService?.isServerReady() ?: false
            if (ready) {
                serverReady = true
                notifyListeners("onServerReady", JSObject().apply {
                    put("ready", true)
                    put("serviceUuid", SERVICE_UUID.toString())
                })
            }
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            bleService = null
            serviceBound = false
            napLog("BLE_SVC_DISC", "BleService desconectado", "WARN")
        }
    }

    private val serviceEventReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                "com.nexo.ble.SERVER_READY" -> {
                    serverReady = intent.getBooleanExtra("ready", false)
                    notifyListeners("onServerReady", JSObject().apply {
                        put("ready", serverReady)
                        put("serviceUuid", SERVICE_UUID.toString())
                    })
                }
                "com.nexo.ble.DEVICE_CONNECTED" -> {
                    val deviceId = intent.getStringExtra("deviceId") ?: return
                    val direction = intent.getStringExtra("direction") ?: "incoming"
                    handleServerDeviceConnected(deviceId, direction)
                }
                "com.nexo.ble.DEVICE_DISCONNECTED" -> {
                    val deviceId = intent.getStringExtra("deviceId") ?: return
                    handleServerDeviceDisconnected(deviceId)
                }
                "com.nexo.ble.SERVICES_READY" -> {
                    val deviceId = intent.getStringExtra("deviceId") ?: return
                    notifyListeners("onServicesReady", JSObject().apply {
                        put("deviceId", deviceId)
                        put("ready", true)
                        put("direction", "incoming")
                        put("role", "server")
                    })
                }
                "com.nexo.ble.PAYLOAD_RECEIVED" -> {
                    val deviceId = intent.getStringExtra("deviceId") ?: return
                    val data = intent.getByteArrayExtra("data") ?: return
                    val source = intent.getStringExtra("source") ?: "server_write_request"
                    handlePayloadReceived(deviceId, data, source)
                }
                "com.nexo.ble.NOTIFICATION_STATE" -> {
                    val deviceId = intent.getStringExtra("deviceId") ?: return
                    val enabled = intent.getBooleanExtra("enabled", false)
                    notifyListeners("onClientNotificationStateChanged", JSObject().apply {
                        put("deviceId", deviceId)
                        put("enabled", enabled)
                    })
                }
                "com.nexo.ble.ADVERTISE_STARTED" -> {
                    advertisingActive = true
                    notifyListeners("onAdvertiseStarted", JSObject().apply { put("success", true) })
                }
                "com.nexo.ble.ADVERTISE_FAILED" -> {
                    advertisingActive = false
                    notifyListeners("onAdvertiseFailed", JSObject().apply {
                        put("errorCode", intent.getIntExtra("errorCode", -1))
                    })
                }
            }
        }
    }

    private var advertisingActive = false
    private var isScanning = false
    private var scanCallback: ScanCallback? = null
    private var serverReady = false

    private val handler = Handler(Looper.getMainLooper())
    private var userId: String = ""
    private var userName: String = ""
    private val pendingCalls = ConcurrentHashMap<String, PluginCall>()
    private var isRequestingPermissions = false

    private val receivedMessageIds = LruCache<String, Long>(100)

    private val unifiedGattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            val conn = connections[deviceId] ?: return
            
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    if (conn.state == ConnectionState.CONNECTING) {
                        conn.state = ConnectionState.DISCOVERING
                        conn.lastStateChangeTime = System.currentTimeMillis()
                        napLog(NAP_BLE_CONNECTED, "[CLIENT] GATT conectado: $deviceId (attempt=${conn.retryCount})")
                        notifyListeners("onDeviceConnected", JSObject().apply {
                            put("deviceId", deviceId)
                            put("direction", "outgoing")
                            put("attempt", conn.retryCount)
                        })
                        handler.postDelayed({
                            try {
                                gatt.requestMtu(MTU_DEFAULT)
                            } catch (e: SecurityException) {
                                napLog("BLE_MTU_EX", "SecurityException requestMtu: ${e.message}")
                                triggerDiscoverServices(gatt, deviceId)
                            }
                        }, 300)
                    }
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    val wasReady = conn.state == ConnectionState.READY
                    conn.state = ConnectionState.IDLE
                    conn.gatt = null
                    conn.pendingChunks = null
                    conn.currentChunkIndex = 0
                    conn.totalChunks = 0
                    try { gatt.close() } catch (e: Exception) { }
                    
                    notifyListeners("onDeviceDisconnected", JSObject().apply {
                        put("deviceId", deviceId)
                        put("gattStatus", status)
                        put("wasReady", wasReady)
                    })
                    
                    if (conn.userDisconnected) {
                        napLog("BLE_USER_DISC", "Desconexión manual de $deviceId - no reintentar")
                        conn.userDisconnected = false
                        return
                    }
                    
                    if (status != BluetoothGatt.GATT_SUCCESS && conn.retryCount < MAX_RETRY_ATTEMPTS) {
                        scheduleRetry(deviceId)
                    } else if (conn.retryCount >= MAX_RETRY_ATTEMPTS) {
                        conn.state = ConnectionState.FAILED
                        val call = pendingCalls.remove("connect_$deviceId")
                        call?.reject(ERR_NOT_CONNECTED, "Falló después de $MAX_RETRY_ATTEMPTS intentos")
                    }
                }
            }
        }
        
        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            val conn = connections[deviceId] ?: return
            
            if (status == BluetoothGatt.GATT_SUCCESS) {
                conn.negotiatedMtu = mtu - 3
                napLog(NAP_BLE_MTU_CHANGED, "MTU=$mtu payloadMax=${conn.negotiatedMtu} para $deviceId")
            } else {
                conn.negotiatedMtu = 20
                napLog(NAP_BLE_MTU_CHANGED, "MTU falló status=$status, usando default 20 para $deviceId", "WARN")
            }
            triggerDiscoverServices(gatt, deviceId)
        }
        
        private fun triggerDiscoverServices(gatt: BluetoothGatt, deviceId: String) {
            handler.postDelayed({
                try {
                    try {
                        val refreshMethod = gatt.javaClass.getMethod("refresh")
                        refreshMethod.invoke(gatt)
                        napLog("BLE_REFRESH", "Service cache refrescada para $deviceId")
                    } catch (e: Exception) { }
                    gatt.discoverServices()
                } catch (e: SecurityException) {
                    handleConnectionFailure(deviceId, "SecurityException discoverServices")
                }
            }, 400)
        }
        
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            val conn = connections[deviceId] ?: return
            
            if (status != BluetoothGatt.GATT_SUCCESS) {
                handleConnectionFailure(deviceId, "Descubrimiento falló status=$status")
                return
            }
            
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(CHAR_PAYLOAD)
            if (service == null || char == null) {
                val foundServices = gatt.services?.map { it.uuid.toString() } ?: emptyList()
                napLog("BLE_SVC_FOUND", "Servicios descubiertos en $deviceId: $foundServices")
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
                notifyListeners("onNotificationsEnabled", JSObject().apply {
                    put("deviceId", deviceId)
                    put("enabled", true)
                })
                markConnectionReady(deviceId, gatt)
            } else if (status != BluetoothGatt.GATT_SUCCESS) {
                handleConnectionFailure(deviceId, "Descriptor write failed: $status")
            }
        }
        
        override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS && characteristic.uuid == CHAR_ANNOUNCE) {
                val data = characteristic.value?.let { String(it) } ?: "{}"
                try {
                    val json = org.json.JSONObject(data)
                    val peerName = json.optString("userName", "NEXO Peer")
                    val peerId = json.optString("userId", "")
                    notifyListeners("onPeerInfoReceived", JSObject().apply {
                        put("deviceId", gatt.device?.address ?: "")
                        put("name", peerName)
                        put("userId", peerId)
                    })
                } catch (e: Exception) { }
            }
        }
        
        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            val conn = connections[deviceId] ?: return
            
            if (status != BluetoothGatt.GATT_SUCCESS) {
                conn.pendingWriteCall?.reject(ERR_NOT_CONNECTED, "Escritura falló status=$status")
                conn.pendingWriteCall = null
                conn.pendingChunks = null
                return
            }
            
            val chunks = conn.pendingChunks
            if (chunks != null && chunks.isNotEmpty()) {
                conn.currentChunkIndex++
                val nextChunk = chunks.pollFirst()
                if (nextChunk != null) {
                    writeChunk(gatt, characteristic, nextChunk)
                    return
                }
            }
            
            if (conn.currentChunkIndex >= conn.totalChunks - 1 || conn.totalChunks == 0) {
                conn.pendingWriteCall?.resolve(JSObject().apply {
                    put("sent", true)
                    put("confirmed", true)
                    put("messageId", conn.pendingWriteMessageId ?: "")
                    put("chunks", conn.totalChunks.coerceAtLeast(1))
                })
                conn.pendingWriteCall = null
                conn.pendingChunks = null
                conn.currentChunkIndex = 0
                conn.totalChunks = 0
            }
        }
        
        private fun writeChunk(gatt: BluetoothGatt, char: BluetoothGattCharacteristic, chunk: ByteArray) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(char, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
            } else {
                @Suppress("DEPRECATION")
                char.value = chunk
                @Suppress("DEPRECATION")
                gatt.writeCharacteristic(char)
            }
        }
        
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            val data = characteristic.value
            
            when (characteristic.uuid) {
                CHAR_PAYLOAD -> {
                    handlePayloadReceived(deviceId, data, "client_notification")
                }
            }
        }
    }

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
        
        napLog("BLE_RETRY", "Retry $deviceId en ${totalDelay}ms (attempt=${conn.retryCount})")
        
        handler.postDelayed({
            val adapter = getBluetoothAdapter()
            val device = adapter?.getRemoteDevice(deviceId)
            if (device != null && connections[deviceId]?.state == ConnectionState.IDLE) {
                synchronized(deviceId.intern()) {
                    executeConnectInternal(device, deviceId)
                }
            }
        }, totalDelay)
    }

    private fun markConnectionReady(deviceId: String, gatt: BluetoothGatt) {
        val conn = connections[deviceId] ?: return
        conn.state = ConnectionState.READY
        conn.retryCount = 0
        conn.gatt = gatt
        conn.lastStateChangeTime = System.currentTimeMillis()
        
        val call = pendingCalls.remove("connect_$deviceId")
        call?.resolve(JSObject().apply {
            put("connected", true)
            put("deviceId", deviceId)
            put("servicesReady", true)
            put("role", "client")
        })
        
        notifyListeners("onServicesReady", JSObject().apply {
            put("deviceId", deviceId)
            put("ready", true)
        })
        
        val pendingCall = conn.pendingWriteCall
        val pendingPayload = conn.pendingWritePayload
        if (pendingCall != null && pendingPayload != null) {
            conn.pendingWriteCall = null
            conn.pendingWritePayload = null
            performWrite(pendingCall, gatt, deviceId, pendingPayload, conn.pendingWriteMessageId ?: "")
        }
    }
    
    private fun handleConnectionFailure(deviceId: String, reason: String) {
        val conn = connections[deviceId] ?: return
        
        conn.gatt?.let { gatt ->
            try { gatt.disconnect() } catch (e: Exception) { }
            try { gatt.close() } catch (e: Exception) { }
        }
        conn.gatt = null
        conn.pendingChunks = null
        conn.state = ConnectionState.IDLE
        
        notifyListeners("onConnectionFailed", JSObject().apply {
            put("deviceId", deviceId)
            put("reason", reason)
            put("attempt", conn.retryCount)
            put("maxAttempts", MAX_RETRY_ATTEMPTS)
        })
        
        val call = pendingCalls.remove("connect_$deviceId")
        
        if (!conn.userDisconnected && conn.retryCount < MAX_RETRY_ATTEMPTS) {
            scheduleRetry(deviceId)
        } else {
            conn.state = ConnectionState.FAILED
            call?.reject(ERR_NOT_CONNECTED, reason)
        }
    }

    private fun handlePayloadReceived(deviceId: String, data: ByteArray?, source: String) {
        data ?: return
        val payloadStr = String(data)
        var senderName = "NEXO Peer"
        var messageContent = payloadStr
        var messageId = ""
        try {
            val json = org.json.JSONObject(payloadStr)
            if (json.has("senderName")) senderName = json.getString("senderName")
            if (json.has("content")) messageContent = json.getString("content")
            if (json.has("messageId")) messageId = json.getString("messageId")
        } catch (e: Exception) { }
        
        if (messageId.isNotEmpty()) {
            if (receivedMessageIds.get(messageId) != null) {
                napLog("BLE_DEDUP", "Mensaje duplicado descartado: $messageId", "DEBUG")
                return
            }
            receivedMessageIds.put(messageId, System.currentTimeMillis())
        }
        
        notifyListeners("onPayloadReceived", JSObject().apply {
            put("deviceId", deviceId)
            put("data", payloadStr)
            put("content", messageContent)
            put("senderName", senderName)
            put("messageId", messageId)
            put("source", source)
            put("timestamp", System.currentTimeMillis())
        })
    }

    private fun handleServerDeviceConnected(deviceId: String, direction: String) {
        val conn = connections.getOrPut(deviceId) { BLEConnection(deviceId) }
        conn.role = if (conn.role == "client") "both" else "server"
        notifyListeners("onDeviceConnected", JSObject().apply {
            put("deviceId", deviceId)
            put("name", "NEXO Peer")
            put("direction", direction)
        })
    }

    private fun handleServerDeviceDisconnected(deviceId: String) {
        val conn = connections[deviceId]
        if (conn != null) {
            if (conn.role == "server") {
                connections.remove(deviceId)
            } else if (conn.role == "both") {
                conn.role = "client"
            }
        }
        notifyListeners("onDeviceDisconnected", JSObject().apply {
            put("deviceId", deviceId)
        })
    }

    private fun getBluetoothAdapter(): BluetoothAdapter? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT)
                    != PackageManager.PERMISSION_GRANTED) return null
            }
            val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            manager?.adapter
        } catch (e: SecurityException) { null } catch (e: Exception) { null }
    }
    
    private fun napLog(code: String, message: String, level: String = "INFO") {
        val formatted = "[$code] $message [Native:true]"
        when (level) {
            "ERROR" -> Log.e(TAG, formatted)
            "WARN" -> Log.w(TAG, formatted)
            "DEBUG" -> Log.d(TAG, formatted)
            else -> Log.i(TAG, formatted)
        }
        val auditData = JSObject()
        auditData.put("code", code)
        auditData.put("message", message)
        auditData.put("level", level)
        auditData.put("timestamp", System.currentTimeMillis())
        auditData.put("native", true)
        notifyListeners("napAuditEvent", auditData)
    }
    
    private fun napError(call: PluginCall?, code: String, message: String) {
        napLog(code, message, "ERROR")
        val errorData = JSObject()
        errorData.put("code", code)
        errorData.put("message", message)
        call?.reject(code, "[$code] $message", errorData)
    }
    
    private fun canAccessBluetooth(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }
    }
    
    private fun canAccessAdvertising(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED
        }
    }

    override fun load() {
        napLog("BLE_LOAD", "NAP-BLE v5.0.0-ARCH loaded")
        
        val serviceIntent = Intent(context, BleService::class.java).apply {
            action = BleService.ACTION_START
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
        context.bindService(serviceIntent, serviceConnection, Context.BIND_AUTO_CREATE)
        
        val filter = IntentFilter().apply {
            addAction("com.nexo.ble.SERVER_READY")
            addAction("com.nexo.ble.DEVICE_CONNECTED")
            addAction("com.nexo.ble.DEVICE_DISCONNECTED")
            addAction("com.nexo.ble.SERVICES_READY")
            addAction("com.nexo.ble.PAYLOAD_RECEIVED")
            addAction("com.nexo.ble.NOTIFICATION_STATE")
            addAction("com.nexo.ble.ADVERTISE_STARTED")
            addAction("com.nexo.ble.ADVERTISE_FAILED")
        }
        ContextCompat.registerReceiver(context, serviceEventReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        
        val btFilter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        context.registerReceiver(systemStateReceiver, btFilter)
    }
    
    private val systemStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == BluetoothAdapter.ACTION_STATE_CHANGED) {
                val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                when (state) {
                    BluetoothAdapter.STATE_OFF -> {
                        cleanupAllConnections()
                        serverReady = false
                    }
                    BluetoothAdapter.STATE_ON -> {
                        napLog("BLE_BT_ON", "Bluetooth encendido, reiniciando server...")
                        bleService?.cleanup()
                        handler.postDelayed({
                            val serviceIntent = Intent(context, BleService::class.java).apply {
                                action = BleService.ACTION_START
                            }
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                context.startForegroundService(serviceIntent)
                            } else {
                                context.startService(serviceIntent)
                            }
                        }, 1000)
                    }
                }
            }
        }
    }
    
    private fun cleanupAllConnections() {
        connections.forEach { (id, conn) ->
            conn.userDisconnected = true
            conn.gatt?.let { gatt ->
                try { gatt.disconnect() } catch (e: Exception) { }
                try { gatt.close() } catch (e: Exception) { }
            }
            conn.gatt = null
            conn.pendingChunks = null
            conn.state = ConnectionState.IDLE
        }
        bleService?.cleanup()
        stopScanInternal()
    }

    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        napLog("BLE_PERM_REQ", "Solicitud de permisos BLE iniciada")
        
        if (canAccessBluetooth()) {
            napLog(NAP_BLE_PERMISSIONS_GRANTED, "Todos los permisos ya concedidos")
            call.resolve(buildPermissionsResult().apply { put("alreadyGranted", true) })
            return
        }
        
        isRequestingPermissions = true
        saveCall(call)
        requestAllPermissions(call, "requestPermissionsCallback")
    }
    
    @PermissionCallback
    private fun requestPermissionsCallback(call: PluginCall) {
        isRequestingPermissions = false
        val result = buildPermissionsResult()
        if (result.getBoolean("allGranted", false) == true) {
            napLog(NAP_BLE_PERMISSIONS_GRANTED, "Todos los permisos concedidos")
            call.resolve(result)
        } else {
            napError(call, "BLE_109", "Permisos incompletos")
        }
    }
    
    private fun checkPermissionDirectly(alias: String): Boolean {
        val permission = when(alias) {
            "bluetoothConnect" -> android.Manifest.permission.BLUETOOTH_CONNECT
            "bluetoothScan" -> android.Manifest.permission.BLUETOOTH_SCAN
            "bluetoothAdvertise" -> android.Manifest.permission.BLUETOOTH_ADVERTISE
            "location" -> android.Manifest.permission.ACCESS_FINE_LOCATION
            else -> return false
        }
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }
    
    private fun buildPermissionsResult(): JSObject {
        val result = JSObject()
        val permissions = JSObject()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.put("bluetoothConnect", checkPermissionDirectly("bluetoothConnect"))
            permissions.put("bluetoothScan", checkPermissionDirectly("bluetoothScan"))
            permissions.put("bluetoothAdvertise", checkPermissionDirectly("bluetoothAdvertise"))
        } else {
            permissions.put("location", checkPermissionDirectly("location"))
        }
        result.put("permissions", permissions)
        result.put("allGranted", canAccessBluetooth())
        result.put("androidVersion", Build.VERSION.SDK_INT)
        return result
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        if (!canAccessBluetooth()) {
            pendingCalls["init"] = call
            requestPermissionForAlias("bluetoothConnect", call, "initPermissionCallback")
            return
        }
        performInitialization(call)
    }
    
    @PermissionCallback
    private fun initPermissionCallback(call: PluginCall) {
        if (canAccessBluetooth()) performInitialization(call)
        else napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permisos requeridos no concedidos")
    }
    
    private fun performInitialization(call: PluginCall) {
        val adapter = getBluetoothAdapter()
        if (adapter == null) {
            pendingCalls.remove("init")
            napError(call, NAP_BLE_ERR_INIT_FAILED, "No se pudo obtener BluetoothAdapter")
            return
        }
        if (!adapter.isEnabled) {
            pendingCalls["init"] = call
            val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
            startActivityForResult(call, enableBtIntent, "enableBluetoothResult")
            return
        }
        
        if (!serviceBound || bleService == null) {
            val serviceIntent = Intent(context, BleService::class.java).apply {
                action = BleService.ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            context.bindService(serviceIntent, serviceConnection, Context.BIND_AUTO_CREATE)
        }
        
        userId = call.getString("userId") ?: ""
        userName = call.getString("userName") ?: "NEXO User"
        
        call.resolve(JSObject().apply {
            put("initialized", true)
            put("userId", userId)
            put("userName", userName)
            put("serverReady", serverReady)
        })
        napLog(NAP_BLE_READY, "Inicialización completada (serverReady=$serverReady)")
        pendingCalls.remove("init")
    }
    
    @ActivityCallback
    private fun enableBluetoothResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) {
            performInitialization(call)
        } else {
            pendingCalls.remove("init")
            napError(call, NAP_BLE_ERR_DISABLED, "Usuario rechazó activar Bluetooth")
        }
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos")
            return
        }
        if (isScanning) {
            call.resolve(JSObject().apply { put("started", true) })
            return
        }
        try {
            val adapter = getBluetoothAdapter()
            val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
            val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
            scanCallback = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult?) {
                    result?.device?.let { device ->
                        try {
                            val displayName = device.name ?: result.scanRecord?.deviceName ?: "NEXO Device"
                            notifyListeners("onDeviceFound", JSObject().apply {
                                put("deviceId", device.address)
                                put("name", displayName)
                                put("rssi", result.rssi)
                            })
                        } catch (e: SecurityException) { }
                    }
                }
                override fun onScanFailed(errorCode: Int) {
                    napLog(NAP_BLE_ERR_SCAN_FAILED, "Scan failed: $errorCode", "ERROR")
                }
            }
            adapter?.bluetoothLeScanner?.startScan(listOf(filter), settings, scanCallback!!)
            isScanning = true
            call.resolve(JSObject().apply { put("started", true) })
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_SCAN_FAILED, "Error: ${e.message}")
        }
    }
    
    @PluginMethod
    fun stopScan(call: PluginCall) {
        stopScanInternal()
        call.resolve()
    }
    
    private fun stopScanInternal() {
        if (!isScanning) return
        try {
            scanCallback?.let { getBluetoothAdapter()?.bluetoothLeScanner?.stopScan(it) }
            isScanning = false
            scanCallback = null
        } catch (e: SecurityException) { }
    }

    @PluginMethod
    fun startAdvertise(call: PluginCall) {
        if (!canAccessBluetooth() || !canAccessAdvertising()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos")
            return
        }
        if (!serverReady) {
            napError(call, NAP_BLE_ERR_INIT_FAILED, "GATT Server no listo. Espera onServerReady o reinicia BLE.")
            return
        }
        if (advertisingActive) {
            call.resolve(JSObject().apply { put("started", true); put("alreadyActive", true) })
            return
        }
        try {
            val success = bleService?.startAdvertising() ?: false
            if (success) {
                call.resolve(JSObject().apply { put("started", true); put("pendingConfirmation", true) })
            } else {
                napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "BleService no pudo iniciar advertising")
            }
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "Error: ${e.message}")
        }
    }
    
    @PluginMethod
    fun stopAdvertise(call: PluginCall) {
        bleService?.stopAdvertising()
        advertisingActive = false
        call.resolve()
    }

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        if (deviceId == null) {
            call.reject(ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos")
            return
        }
        val adapter = getBluetoothAdapter()
        if (adapter?.address == deviceId) {
            napError(call, ERR_INVALID_PARAMS, "No puedes conectarte a ti mismo")
            return
        }
        
        val existing = connections[deviceId]
        if (existing != null && existing.state == ConnectionState.CONNECTING) {
            call.reject(ERR_NOT_CONNECTED, "Conexión en progreso")
            return
        }
        if (existing != null && existing.state == ConnectionState.READY) {
            call.resolve(JSObject().apply {
                put("connected", true)
                put("deviceId", deviceId)
                put("servicesReady", true)
                put("alreadyConnected", true)
            })
            return
        }
        
        existing?.gatt?.let { oldGatt ->
            if (existing.state == ConnectionState.IDLE || existing.state == ConnectionState.FAILED) {
                try { oldGatt.close() } catch (e: Exception) { }
                existing.gatt = null
            }
        }
        
        val device = adapter?.getRemoteDevice(deviceId)
        if (device == null) {
            call.reject(ERR_DEVICE_NOT_FOUND, "Dispositivo no encontrado")
            return
        }
        
        pendingCalls["connect_$deviceId"] = call
        enqueueOperation(deviceId) {
            synchronized(deviceId.intern()) {
                executeConnectInternal(device, deviceId)
            }
        }
    }
    
    private fun executeConnectInternal(device: BluetoothDevice, deviceId: String) {
        val conn = connections.getOrPut(deviceId) { BLEConnection(deviceId) }
        
        val now = System.currentTimeMillis()
        if (now - conn.lastAttemptTime < RATE_LIMIT_MS && conn.retryCount > 0) {
            val wait = RATE_LIMIT_MS - (now - conn.lastAttemptTime)
            handler.postDelayed({ 
                synchronized(deviceId.intern()) {
                    executeConnectInternal(device, deviceId) 
                }
            }, wait)
            return
        }
        
        conn.state = ConnectionState.CONNECTING
        conn.lastAttemptTime = now
        conn.userDisconnected = false
        conn.negotiatedMtu = 20
        
        conn.gatt?.let { oldGatt ->
            try { oldGatt.disconnect() } catch (e: Exception) { }
            try { oldGatt.close() } catch (e: Exception) { }
            conn.gatt = null
        }
        
        napLog("BLE_CONN_REQ", "Conectar a: $deviceId (attempt=${conn.retryCount})")
        
        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, false, unifiedGattCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, unifiedGattCallback)
        }
        
        if (gatt == null) {
            handleConnectionFailure(deviceId, "connectGatt retornó null")
            return
        }
        
        conn.gatt = gatt
        
        handler.postDelayed({
            if (connections[deviceId]?.state == ConnectionState.CONNECTING) {
                handleConnectionFailure(deviceId, "Timeout esperando conexión")
            }
        }, CONNECT_TIMEOUT_MS)
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        if (deviceId == null) {
            call.reject(ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }
        
        synchronized(deviceId.intern()) {
            val conn = connections[deviceId]
            if (conn != null) {
                conn.userDisconnected = true
                conn.state = ConnectionState.DISCONNECTING
                conn.pendingChunks = null
                conn.gatt?.let { gatt ->
                    try { gatt.disconnect() } catch (e: Exception) { }
                }
                handler.postDelayed({
                    val currentConn = connections[deviceId]
                    if (currentConn != null && currentConn.state == ConnectionState.DISCONNECTING) {
                        napLog("BLE_FORCE_CLOSE", "Forzando close() tras timeout disconnect para $deviceId")
                        currentConn.gatt?.let { gatt ->
                            try { gatt.close() } catch (e: Exception) { }
                        }
                        currentConn.gatt = null
                        currentConn.state = ConnectionState.IDLE
                    }
                }, DISCONNECT_FORCE_CLOSE_MS)
            }
        }
        call.resolve()
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        val message = call.getString("message")
        val data = call.getString("data")
        if (deviceId == null || (message == null && data == null)) {
            call.reject(ERR_INVALID_PARAMS, "deviceId y message/data requeridos")
            return
        }
        
        val messageId = UUID.randomUUID().toString()
        val payload = try {
            val json = org.json.JSONObject()
            json.put("messageId", messageId)
            json.put("timestamp", System.currentTimeMillis())
            json.put("senderId", userId)
            json.put("senderName", userName)
            json.put("content", message ?: "")
            if (data != null) json.put("data", data)
            json.put("type", "chat")
            json.toString().toByteArray(Charsets.UTF_8)
        } catch (e: Exception) {
            (message ?: data ?: "").toByteArray(Charsets.UTF_8)
        }
        
        val conn = connections[deviceId]
        val maxPayload = (conn?.negotiatedMtu ?: 20)
        
        if (payload.size > maxPayload * 10) {
            call.reject(ERR_MESSAGE_TOO_LARGE, "Mensaje demasiado grande (${payload.size} > ${maxPayload * 10})")
            return
        }
        
        if (conn != null && conn.state == ConnectionState.READY && conn.gatt != null) {
            synchronized(deviceId.intern()) {
                performWrite(call, conn.gatt!!, deviceId, payload, messageId)
            }
            return
        }
        
        val serverSuccess = bleService?.notifyClient(deviceId, payload) ?: false
        if (serverSuccess) {
            call.resolve(JSObject().apply {
                put("sent", true)
                put("via", "server_notification")
                put("messageId", messageId)
            })
            return
        }
        
        val queueConn = connections.getOrPut(deviceId) { BLEConnection(deviceId) }
        queueConn.pendingWriteCall = call
        queueConn.pendingWritePayload = payload
        queueConn.pendingWriteMessageId = messageId
        
        val adapter = getBluetoothAdapter()
        val device = adapter?.getRemoteDevice(deviceId)
        if (device != null) {
            enqueueOperation(deviceId) {
                synchronized(deviceId.intern()) {
                    executeConnectInternal(device, deviceId)
                }
            }
        } else {
            call.reject(ERR_DEVICE_NOT_FOUND, "Dispositivo no encontrado")
        }
    }
    
    private fun performWrite(call: PluginCall, gatt: BluetoothGatt, deviceId: String, payload: ByteArray, messageId: String) {
        val conn = connections[deviceId] ?: return
        if (conn.state != ConnectionState.READY) {
            call.reject(ERR_NOT_CONNECTED, "No está listo")
            return
        }
        try {
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(CHAR_PAYLOAD)
            if (char == null) {
                call.reject(ERR_NOT_CONNECTED, "Característica no disponible")
                return
            }
            
            conn.pendingWriteCall = call
            conn.pendingWriteMessageId = messageId
            
            val maxPayload = conn.negotiatedMtu.coerceAtLeast(20)
            
            if (payload.size <= maxPayload) {
                conn.totalChunks = 1
                conn.currentChunkIndex = 0
                conn.pendingChunks = null
                
                handler.postDelayed({
                    if (conn.pendingWriteCall === call) {
                        conn.pendingWriteCall = null
                        call.reject(ERR_NOT_CONNECTED, "Timeout escritura")
                    }
                }, WRITE_TIMEOUT_MS)
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gatt.writeCharacteristic(char, payload, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                } else {
                    @Suppress("DEPRECATION")
                    char.value = payload
                    @Suppress("DEPRECATION")
                    gatt.writeCharacteristic(char)
                }
            } else {
                val chunker = MessageChunker()
                val chunks = chunker.createChunks(payload, maxPayload)
                conn.totalChunks = chunks.size
                conn.currentChunkIndex = 0
                conn.pendingChunks = LinkedList(chunks)
                
                handler.postDelayed({
                    if (conn.pendingWriteCall === call) {
                        conn.pendingWriteCall = null
                        conn.pendingChunks = null
                        call.reject(ERR_NOT_CONNECTED, "Timeout escritura chunkada")
                    }
                }, WRITE_TIMEOUT_MS * chunks.size)
                
                val firstChunk = conn.pendingChunks!!.pollFirst()
                if (firstChunk != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gatt.writeCharacteristic(char, firstChunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                    } else {
                        @Suppress("DEPRECATION")
                        char.value = firstChunk
                        @Suppress("DEPRECATION")
                        gatt.writeCharacteristic(char)
                    }
                }
            }
        } catch (e: SecurityException) {
            conn.pendingWriteCall = null
            conn.pendingChunks = null
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException enviando")
        }
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val devices = JSArray()
        connections.forEach { (id, conn) ->
            if (conn.state == ConnectionState.READY) {
                val obj = JSObject()
                obj.put("deviceId", id)
                obj.put("direction", "outgoing")
                obj.put("servicesReady", true)
                obj.put("mtu", conn.negotiatedMtu)
                obj.put("role", conn.role)
                devices.put(obj)
            }
        }
        bleService?.getServerConnections()?.forEach { (id, device) ->
            try {
                val obj = JSObject()
                obj.put("deviceId", id)
                obj.put("name", "NEXO Peer")
                obj.put("direction", "incoming")
                obj.put("role", "server")
                devices.put(obj)
            } catch (e: SecurityException) { }
        }
        call.resolve(JSObject().apply { put("devices", devices) })
    }
    
    @PluginMethod
    fun getLocalDeviceInfo(call: PluginCall) {
        try {
            val adapter = getBluetoothAdapter()
            call.resolve(JSObject().apply {
                put("deviceName", adapter?.name ?: "Unknown")
                put("deviceAddress", adapter?.address ?: "Unknown")
                put("userId", userId)
                put("userName", userName)
            })
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "Error obteniendo info")
        }
    }
    
    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        val adapter = getBluetoothAdapter()
        val isEnabled = adapter?.state == BluetoothAdapter.STATE_ON
        call.resolve(JSObject().apply {
            put("enabled", isEnabled)
            put("stateName", if (isEnabled) "ON" else "OFF")
            put("canScan", isEnabled && canAccessBluetooth())
            put("canAdvertise", isEnabled && canAccessAdvertising())
            put("serverReady", serverReady)
        })
    }
    
    @PluginMethod
    fun startAdvertising(call: PluginCall) { startAdvertise(call) }
    @PluginMethod
    fun stopAdvertising(call: PluginCall) { stopAdvertise(call) }
    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        call.resolve(JSObject().apply { put("isAdvertising", advertisingActive || (bleService?.isAdvertisingActive() ?: false)) })
    }

    override fun handleOnDestroy() {
        try {
            context.unregisterReceiver(serviceEventReceiver)
        } catch (e: Exception) { }
        try {
            context.unregisterReceiver(systemStateReceiver)
        } catch (e: Exception) { }
        if (serviceBound) {
            context.unbindService(serviceConnection)
            serviceBound = false
        }
        cleanupAllConnections()
        super.handleOnDestroy()
    }
}
