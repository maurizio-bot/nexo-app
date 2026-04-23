package com.nexo.ble

import android.app.Activity
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import android.widget.Toast
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
// NAP-BLE v4.1.0-ARCH
// Fix: serverReady tracking, MTU negotiation,
// service refresh, server-side onServicesReady
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
        
        // NAP Codes
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
        
        val SERVICE_UUID = NexoGattService.SERVICE_UUID
        val CHAR_ANNOUNCE = NexoGattService.ANNOUNCE_CHAR_UUID
        val CHAR_HANDSHAKE = NexoGattService.HANDSHAKE_CHAR_UUID
        val CHAR_PAYLOAD = NexoGattService.PAYLOAD_CHAR_UUID
        val CHAR_CONTROL = NexoGattService.CONTROL_CHAR_UUID
        val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    // ============================================================
    // A. MÁQUINA DE ESTADOS - Un solo GATT por deviceId
    // ============================================================
    enum class ConnectionState {
        IDLE,           // Sin GATT, sin intentos
        CONNECTING,     // GATT creado, esperando onConnectionStateChange(CONNECTED)
        DISCOVERING,    // Conectado, esperando onServicesDiscovered
        READY,          // Servicios listos, notificaciones activas, listo para mensajes
        DISCONNECTING,  // disconnect() llamado, esperando callback DISCONNECTED
        FAILED          // Máximo de retries alcanzado, esperando acción usuario
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
        // v4.1.0 FIX: MTU negociado y cola de chunks
        var negotiatedMtu: Int = 20,
        var pendingChunks: LinkedList<ByteArray>? = null,
        var currentChunkIndex: Int = 0,
        var totalChunks: Int = 0
    )
    
    private val connections = ConcurrentHashMap<String, BLEConnection>()
    
    // ============================================================
    // B. SERIALIZACIÓN ESTRUCTA - Nunca dos operaciones simultáneas
    // ============================================================
    private val operationQueue = ConcurrentHashMap<String, LinkedList<Runnable>>()
    private val isOperating = ConcurrentHashMap<String, AtomicBoolean>()
    
    private fun enqueueOperation(deviceId: String, operation: Runnable) {
        val queue = operationQueue.getOrPut(deviceId) { LinkedList() }
        synchronized(queue) {
            queue.add(operation)
        }
        processNextOperation(deviceId)
    }
    
    private fun processNextOperation(deviceId: String) {
        val flag = isOperating.getOrPut(deviceId) { AtomicBoolean(false) }
        if (flag.getAndSet(true)) return
        
        val queue = operationQueue[deviceId] ?: return
        val next: Runnable?
        synchronized(queue) {
            next = queue.pollFirst()
        }
        if (next == null) {
            flag.set(false)
            return
        }
        
        handler.post {
            try {
                next.run()
            } finally {
                flag.set(false)
                processNextOperation(deviceId)
            }
        }
    }

    // ============================================================
    // C. GATT SERVER (siempre activo)
    // ============================================================
    private var gattServer: BluetoothGattServer? = null
    private val serverConnections = ConcurrentHashMap<String, BluetoothDevice>()
    // v4.1.0 FIX: Tracking de server listo
    private var serverReady = false

    // ============================================================
    // D. SCAN / ADVERTISE
    // ============================================================
    private var advertisingActive = false
    private var isScanning = false
    private var advertiseCallback: AdvertiseCallback? = null
    private var scanCallback: ScanCallback? = null
    
    // ============================================================
    // E. PERMISOS
    // ============================================================
    private val handler = Handler(Looper.getMainLooper())
    private var userId: String = ""
    private var userName: String = ""
    private val pendingCalls = ConcurrentHashMap<String, PluginCall>()
    private var isRequestingPermissions = false

    // ============================================================
    // F. CALLBACK ÚNICO - Un solo BluetoothGattCallback para TODO
    // ============================================================
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
                        
                        // v4.1.0 FIX: Negociar MTU inmediatamente antes de discoverServices
                        handler.postDelayed({
                            try {
                                gatt.requestMtu(MTU_DEFAULT)
                            } catch (e: SecurityException) {
                                napLog("BLE_MTU_EX", "SecurityException requestMtu: ${e.message}")
                                // Fallback: continuar sin MTU negociado
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
                    
                    // CIERRE SÍNCRONO INMEDIATO - nunca dejar GATT huérfano
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
                        pendingCalls.remove("connect_$deviceId")?.reject(
                            ERR_NOT_CONNECTED,
                            "Falló después de $MAX_RETRY_ATTEMPTS intentos"
                        )
                    }
                }
            }
        }
        
        // v4.1.0 FIX: MTU negociado -> luego discoverServices
        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            val conn = connections[deviceId] ?: return
            
            if (status == BluetoothGatt.GATT_SUCCESS) {
                // ATT overhead = 3 bytes (opcode + handle + len)
                conn.negotiatedMtu = mtu - 3
                napLog(NAP_BLE_MTU_CHANGED, "MTU=$mtu payloadMax=${conn.negotiatedMtu} para $deviceId")
            } else {
                conn.negotiatedMtu = 20
                napLog(NAP_BLE_MTU_CHANGED, "MTU falló status=$status, usando default 20 para $deviceId", "WARN")
            }
            
            // Ahora sí descubrir servicios con MTU conocido
            triggerDiscoverServices(gatt, deviceId)
        }
        
        private fun triggerDiscoverServices(gatt: BluetoothGatt, deviceId: String) {
            handler.postDelayed({
                try {
                    // v4.1.0 FIX: Refrescar caché de servicios antes de descubrir
                    // Esto fuerza redescubrimiento real en lugar de caché vieja
                    try {
                        val refreshMethod = gatt.javaClass.getMethod("refresh")
                        refreshMethod.invoke(gatt)
                        napLog("BLE_REFRESH", "Service cache refrescada para $deviceId")
                    } catch (e: Exception) {
                        // refresh() no disponible en esta versión de Android
                    }
                    
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
                // v4.1.0 FIX: Log detallado de qué servicios SÍ existen para debug
                val foundServices = gatt.services?.map { it.uuid.toString() } ?: emptyList()
                napLog("BLE_SVC_FOUND", "Servicios descubiertos en $deviceId: $foundServices")
                handleConnectionFailure(deviceId, "Servicio NEXO no encontrado (UUID=${SERVICE_UUID})")
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
        
        // v4.1.0 FIX: Soporte para escritura chunkada
        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val deviceId = try { gatt.device?.address } catch (e: Exception) { null } ?: return
            val conn = connections[deviceId] ?: return
            
            if (status != BluetoothGatt.GATT_SUCCESS) {
                conn.pendingWriteCall?.reject(ERR_NOT_CONNECTED, "Escritura falló status=$status")
                conn.pendingWriteCall = null
                conn.pendingChunks = null
                return
            }
            
            // Si hay chunks pendientes, escribir el siguiente
            val chunks = conn.pendingChunks
            if (chunks != null && chunks.isNotEmpty()) {
                conn.currentChunkIndex++
                val nextChunk = chunks.pollFirst()
                if (nextChunk != null) {
                    writeChunk(gatt, characteristic, nextChunk)
                    return
                }
            }
            
            // Todos los chunks escritos (o escritura simple)
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
                    val payloadStr = data?.let { String(it) } ?: ""
                    var senderName = "NEXO Peer"
                    var messageContent = payloadStr
                    var messageId = ""
                    try {
                        val json = org.json.JSONObject(payloadStr)
                        if (json.has("senderName")) senderName = json.getString("senderName")
                        if (json.has("content")) messageContent = json.getString("content")
                        if (json.has("messageId")) messageId = json.getString("messageId")
                    } catch (e: Exception) { }
                    
                    notifyListeners("onPayloadReceived", JSObject().apply {
                        put("deviceId", deviceId)
                        put("data", payloadStr)
                        put("content", messageContent)
                        put("senderName", senderName)
                        put("messageId", messageId)
                        put("source", "client_notification")
                        put("timestamp", System.currentTimeMillis())
                    })
                }
            }
        }
    }

    // ============================================================
    // G. RATE LIMITING + EXPONENTIAL BACKOFF
    // ============================================================
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
                executeConnectInternal(device, deviceId)
            }
        }, totalDelay)
    }

    // ============================================================
    // H. AUXILIARES
    // ============================================================
    private fun markConnectionReady(deviceId: String, gatt: BluetoothGatt) {
        val conn = connections[deviceId] ?: return
        conn.state = ConnectionState.READY
        conn.retryCount = 0
        conn.gatt = gatt
        conn.lastStateChangeTime = System.currentTimeMillis()
        
        pendingCalls.remove("connect_$deviceId")?.resolve(JSObject().apply {
            put("connected", true)
            put("deviceId", deviceId)
            put("servicesReady", true)
            put("role", "client")
        })
        
        notifyListeners("onServicesReady", JSObject().apply {
            put("deviceId", deviceId)
            put("ready", true)
        })
        
        // Procesar write pendiente si existe
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
        
        // Cierre síncrono inmediato
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
        
        if (!conn.userDisconnected && conn.retryCount < MAX_RETRY_ATTEMPTS) {
            scheduleRetry(deviceId)
        } else {
            conn.state = ConnectionState.FAILED
            pendingCalls.remove("connect_$deviceId")?.reject(ERR_NOT_CONNECTED, reason)
        }
    }

    // ============================================================
    // I. LOGGING / TOAST / HEALTH
    // ============================================================
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

    // ============================================================
    // J. LIFECYCLE
    // ============================================================
    override fun load() {
        napLog("BLE_LOAD", "NAP-BLE v4.1.0-ARCH loaded")
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        context.registerReceiver(systemStateReceiver, filter)
    }
    
    private val systemStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == BluetoothAdapter.ACTION_STATE_CHANGED) {
                val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                if (state == BluetoothAdapter.STATE_OFF) {
                    cleanupAllConnections()
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
        serverConnections.clear()
        gattServer?.close()
        gattServer = null
        serverReady = false
        stopScanInternal()
        stopAdvertiseInternal()
    }

    // ============================================================
    // K. PERMISOS — v4.0.1 FIX: requestAllPermissions()
    // ============================================================
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

    // ============================================================
    // L. INIT / GATT SERVER
    // ============================================================
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
            napError(call, NAP_BLE_ERR_INIT_FAILED, "No se pudo obtener BluetoothAdapter")
            return
        }
        if (!adapter.isEnabled) {
            pendingCalls["init"] = call
            val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
            startActivityForResult(call, enableBtIntent, "enableBluetoothResult")
            return
        }
        setupGattServer(adapter)
        userId = call.getString("userId") ?: ""
        userName = call.getString("userName") ?: "NEXO User"
        call.resolve(JSObject().apply {
            put("initialized", true)
            put("userId", userId)
            put("userName", userName)
            put("serverReady", serverReady)
        })
        napLog(NAP_BLE_READY, "Inicialización completada (serverReady=$serverReady)")
    }
    
    @ActivityCallback
    private fun enableBluetoothResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) {
            performInitialization(call)
        } else {
            napError(call, NAP_BLE_ERR_DISABLED, "Usuario rechazó activar Bluetooth")
            pendingCalls.remove("init")
        }
    }
    
    private fun setupGattServer(adapter: BluetoothAdapter) {
        try {
            if (gattServer != null) return
            serverReady = false
            val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
            
            val announceChar = BluetoothGattCharacteristic(
                CHAR_ANNOUNCE,
                BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_READ
            )
            val handshakeChar = BluetoothGattCharacteristic(
                CHAR_HANDSHAKE,
                BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_WRITE,
                BluetoothGattCharacteristic.PERMISSION_READ or BluetoothGattCharacteristic.PERMISSION_WRITE
            )
            val payloadChar = BluetoothGattCharacteristic(
                CHAR_PAYLOAD,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )
            payloadChar.addDescriptor(BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            ))
            val controlChar = BluetoothGattCharacteristic(
                CHAR_CONTROL,
                BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                BluetoothGattCharacteristic.PROPERTY_READ or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ
            )
            controlChar.addDescriptor(BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            ))
            
            service.addCharacteristic(announceChar)
            service.addCharacteristic(handshakeChar)
            service.addCharacteristic(payloadChar)
            service.addCharacteristic(controlChar)
            
            gattServer = manager?.openGattServer(context, gattServerCallback)
            gattServer?.addService(service)
            napLog("BLE_GS_REQ", "GattServer abierto, servicio en cola de registro...")
        } catch (e: Exception) {
            napLog(NAP_BLE_ERR_INIT_FAILED, "Error setupGattServer: ${e.message}", "ERROR")
        }
    }
    
    private val gattServerCallback = object : BluetoothGattServerCallback() {
        // v4.1.0 FIX: Tracking de cuando el servicio está realmente registrado
        override fun onServiceAdded(status: Int, service: BluetoothGattService?) {
            if (status == BluetoothGatt.GATT_SUCCESS && service?.uuid == SERVICE_UUID) {
                serverReady = true
                napLog(NAP_BLE_SERVICE_ADDED, "Servicio NEXO registrado en stack Bluetooth")
                notifyListeners("onServerReady", JSObject().apply {
                    put("ready", true)
                    put("serviceUuid", SERVICE_UUID.toString())
                })
            } else {
                serverReady = false
                napLog("BLE_SRV_ERR", "Fallo al registrar servicio: status=$status uuid=${service?.uuid}", "ERROR")
            }
        }
        
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    serverConnections[device.address] = device
                    napLog(NAP_BLE_CONNECTED, "[SERVER] Dispositivo conectado ENTRANTE: ${device.address}")
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceId", device.address)
                        put("name", "NEXO Peer")
                        put("direction", "incoming")
                    })
                    // v4.1.0 FIX: Para conexiones entrantes, el server YA tiene servicios listos
                    // Notificar ready inmediatamente para que el JS sepa que puede recibir
                    handler.postDelayed({
                        notifyListeners("onServicesReady", JSObject().apply {
                            put("deviceId", device.address)
                            put("ready", true)
                            put("direction", "incoming")
                            put("role", "server")
                        })
                    }, 500)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    serverConnections.remove(device.address)
                    notifyListeners("onDeviceDisconnected", JSObject().apply {
                        put("deviceId", device.address)
                    })
                }
            }
        }
        
        override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic) {
            try {
                val value = when (characteristic.uuid) {
                    CHAR_ANNOUNCE -> {
                        val data = JSObject()
                        data.put("userId", userId)
                        data.put("userName", userName)
                        data.put("timestamp", System.currentTimeMillis())
                        data.put("napVersion", "4.1.0-ARCH")
                        data.toString().toByteArray()
                    }
                    else -> byteArrayOf()
                }
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
            } catch (e: SecurityException) { }
        }
        
        override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            try {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
                value?.let { data ->
                    when (characteristic.uuid) {
                        CHAR_PAYLOAD -> {
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
                            
                            notifyListeners("onPayloadReceived", JSObject().apply {
                                put("deviceId", device.address)
                                put("data", payloadStr)
                                put("content", messageContent)
                                put("senderName", senderName)
                                put("messageId", messageId)
                                put("source", "server_write_request")
                                put("timestamp", System.currentTimeMillis())
                            })
                        }
                        CHAR_CONTROL -> {
                            val cmd = String(data)
                            if (cmd == "ping") {
                                val svc = gattServer?.getService(SERVICE_UUID)
                                val ctrl = svc?.getCharacteristic(CHAR_CONTROL)
                                ctrl?.value = "pong".toByteArray()
                                gattServer?.notifyCharacteristicChanged(device, ctrl, false)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                napLog("BLE_SRV_EX", "[SERVER] Excepción: ${e.message}", "ERROR")
            }
        }
        
        override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            try {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
                if (descriptor.uuid == CCCD_UUID) {
                    descriptor.value = value
                    val enabled = value != null && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    notifyListeners("onClientNotificationStateChanged", JSObject().apply {
                        put("deviceId", device.address)
                        put("enabled", enabled)
                    })
                }
            } catch (e: SecurityException) { }
        }
    }

    // ============================================================
    // M. SCAN
    // ============================================================
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

    // ============================================================
    // N. ADVERTISE
    // ============================================================
    @PluginMethod
    fun startAdvertise(call: PluginCall) {
        if (!canAccessBluetooth() || !canAccessAdvertising()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos")
            return
        }
        // v4.1.0 FIX: No anunciar si el server no está listo
        if (!serverReady) {
            napError(call, NAP_BLE_ERR_INIT_FAILED, "GATT Server no listo. Espera onServerReady o reinicia BLE.")
            return
        }
        if (advertisingActive) {
            call.resolve(JSObject().apply { put("started", true); put("alreadyActive", true) })
            return
        }
        try {
            val adapter = getBluetoothAdapter()
            if (adapter == null || !adapter.isMultipleAdvertisementSupported) {
                napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "Advertising no soportado")
                return
            }
            val advertiser = adapter.bluetoothLeAdvertiser ?: throw IllegalStateException("Advertiser no disponible")
            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(true)
                .build()
            val advertiseData = AdvertiseData.Builder().addServiceUuid(ParcelUuid(SERVICE_UUID)).build()
            val scanResponse = AdvertiseData.Builder().setIncludeDeviceName(true).build()
            
            advertiseCallback = object : AdvertiseCallback() {
                override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                    advertisingActive = true
                    notifyListeners("onAdvertiseStarted", JSObject().apply { put("success", true) })
                }
                override fun onStartFailure(errorCode: Int) {
                    advertisingActive = false
                    notifyListeners("onAdvertiseFailed", JSObject().apply { put("errorCode", errorCode) })
                }
            }
            advertiser.startAdvertising(settings, advertiseData, scanResponse, advertiseCallback!!)
            call.resolve(JSObject().apply { put("started", true); put("pendingConfirmation", true) })
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "Error: ${e.message}")
        }
    }
    
    @PluginMethod
    fun stopAdvertise(call: PluginCall) {
        stopAdvertiseInternal()
        call.resolve()
    }
    
    private fun stopAdvertiseInternal() {
        if (!advertisingActive) return
        try {
            advertiseCallback?.let { getBluetoothAdapter()?.bluetoothLeAdvertiser?.stopAdvertising(it) }
            advertisingActive = false
            advertiseCallback = null
        } catch (e: SecurityException) { }
    }

    // ============================================================
    // O. CONNECT - SERIALIZADO Estricto
    // ============================================================
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
        
        // Rate limiting: verificar si ya hay operación en curso
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
        
        // Cerrar GATT anterior si existe en estado IDLE/FAILED
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
            executeConnectInternal(device, deviceId)
        }
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
        conn.negotiatedMtu = 20 // reset a default
        
        // Cerrar GATT anterior si existe
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
        
        // Timeout
        handler.postDelayed({
            if (connections[deviceId]?.state == ConnectionState.CONNECTING) {
                handleConnectionFailure(deviceId, "Timeout esperando conexión")
            }
        }, CONNECT_TIMEOUT_MS)
    }

    // ============================================================
    // P. DISCONNECT
    // ============================================================
    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        if (deviceId == null) {
            call.reject(ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }
        val conn = connections[deviceId]
        if (conn != null) {
            conn.userDisconnected = true
            conn.state = ConnectionState.DISCONNECTING
            conn.pendingChunks = null
            conn.gatt?.let { gatt ->
                try { gatt.disconnect() } catch (e: Exception) { }
            }
            // El cierre real ocurre en onConnectionStateChange(DISCONNECTED)
        }
        serverConnections.remove(deviceId)
        call.resolve()
    }

    // ============================================================
    // Q. SEND MESSAGE - Cola nativa integrada + Chunking
    // ============================================================
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
        
        // v4.1.0 FIX: Usar MTU negociado para validar tamaño
        val conn = connections[deviceId]
        val maxPayload = (conn?.negotiatedMtu ?: 20)
        
        if (payload.size > maxPayload * 10) {
            call.reject(ERR_MESSAGE_TOO_LARGE, "Mensaje demasiado grande (${payload.size} > ${maxPayload * 10})")
            return
        }
        
        if (conn != null && conn.state == ConnectionState.READY && conn.gatt != null) {
            performWrite(call, conn.gatt!!, deviceId, payload, messageId)
            return
        }
        
        // Si hay conexión server, intentar notificar
        if (serverConnections.containsKey(deviceId)) {
            val success = notifyClient(deviceId, payload)
            if (success) {
                call.resolve(JSObject().apply {
                    put("sent", true)
                    put("via", "server_notification")
                    put("messageId", messageId)
                })
                return
            }
        }
        
        // Encolar y conectar
        val queueConn = connections.getOrPut(deviceId) { BLEConnection(deviceId) }
        queueConn.pendingWriteCall = call
        queueConn.pendingWritePayload = payload
        queueConn.pendingWriteMessageId = messageId
        
        val adapter = getBluetoothAdapter()
        val device = adapter?.getRemoteDevice(deviceId)
        if (device != null) {
            enqueueOperation(deviceId) {
                executeConnectInternal(device, deviceId)
            }
        } else {
            call.reject(ERR_DEVICE_NOT_FOUND, "Dispositivo no encontrado")
        }
    }
    
    private fun notifyClient(deviceId: String, data: ByteArray): Boolean {
        val device = serverConnections[deviceId] ?: return false
        val service = gattServer?.getService(SERVICE_UUID) ?: return false
        val char = service.getCharacteristic(CHAR_PAYLOAD) ?: return false
        val descriptor = char.getDescriptor(CCCD_UUID)
        val isSubscribed = descriptor?.value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true
        if (!isSubscribed) return false
        return try {
            char.value = data
            gattServer?.notifyCharacteristicChanged(device, char, false) ?: false
        } catch (e: Exception) { false }
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
                // Escritura simple
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
                // v4.1.0 FIX: Escritura chunkada
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
                
                // Escribir primer chunk
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

    // ============================================================
    // R. UTILIDADES
    // ============================================================
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
                devices.put(obj)
            }
        }
        serverConnections.forEach { (id, device) ->
            try {
                val obj = JSObject()
                obj.put("deviceId", id)
                obj.put("name", "NEXO Peer")
                obj.put("direction", "incoming")
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
        call.resolve(JSObject().apply { put("isAdvertising", advertisingActive) })
    }
}
