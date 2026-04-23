package com.nexo.ble

import android.app.Activity
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.os.PowerManager
import android.provider.Settings
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
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

// Build #815 → v3.4.0-P2P-ROBUST
// FIX v3.4.0: GATT se cierra INMEDIATAMENTE en desconexión (anti-133 loop)
// FIX v3.4.0: isGattAlive() valida conexión real vía BluetoothManager
// FIX v3.4.0: connectToDevice verifica GATT vivo antes de alreadyConnected
// FIX v3.4.0: getConnectedDevices filtra solo GATTs vivos
// FIX v3.4.0: sendMessage valida GATT vivo antes de escribir
// FIX v3.4.0: notifyClient verifica suscripción CCCD antes de notificar
// FIX v3.4.0: readPeerName() lee CHAR_ANNOUNCE para nombre real
// FIX v3.4.0: safeCloseGatt delay reducido 3000ms→600ms (anti-bloqueo)
// FIX v3.4.0: forceReconnect() limpia GATT muerto y reconecta limpio
// FIX v3.4.0: userDisconnectedDevices evita auto-retry tras disconnect manual
// FIX v3.4.0: onServicesDiscovered espera confirmación descriptor antes de ready

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
        const val NAP_BLE_RECOVERY_SUCCESS = "BLE_055"
        const val NAP_BLE_PERMISSIONS_GRANTED = "BLE_056"
        const val NAP_BLE_NOTIFICATION_ENABLED = "BLE_057"
        const val NAP_BLE_NOTIFICATION_CONFIRMED = "BLE_058"
        
        const val NAP_BLE_WAITING_PERMISSIONS = "BLE_100"
        const val NAP_BLE_WAITING_BT_ON = "BLE_101"
        const val NAP_BLE_RETRY_ATTEMPT = "BLE_102"
        const val NAP_BLE_ALREADY_INITIALIZED = "BLE_103"
        const val NAP_BLE_THERMAL_THROTTLE = "BLE_104"
        const val NAP_BLE_LOW_BATTERY = "BLE_105"
        const val NAP_BLE_PERMISSION_REVOKED = "BLE_106"
        const val NAP_BLE_CONCURRENT_INIT = "BLE_107"
        const val NAP_BLE_DOZE_MODE = "BLE_108"
        const val NAP_BLE_PARTIAL_PERMISSIONS = "BLE_109"
        
        const val NAP_BLE_ERR_NOT_SUPPORTED = "BLE_200"
        const val NAP_BLE_ERR_DISABLED = "BLE_201"
        const val NAP_BLE_ERR_PERMISSION_DENIED = "BLE_202"
        const val NAP_BLE_ERR_INIT_FAILED = "BLE_203"
        const val NAP_BLE_ERR_SCAN_FAILED = "BLE_204"
        const val NAP_BLE_ERR_ADVERTISE_FAILED = "BLE_205"
        const val NAP_BLE_ERR_CONNECTION_FAILED = "BLE_206"
        const val NAP_BLE_ERR_SECURITY_EXCEPTION = "BLE_207"
        const val NAP_BLE_ERR_MEMORY_PRESSURE = "BLE_208"
        const val NAP_BLE_ERR_GATT_CONFLICT = "BLE_209"
        const val NAP_BLE_ERR_THERMAL_SHUTDOWN = "BLE_210"
        const val NAP_BLE_ERR_AIRPLANE_MODE = "BLE_211"
        
        const val NAP_BLE_INIT_007 = "BLE_007"
        const val REM_PERM_REQUEST_START = "REM_PERM_REQUEST_START"
        const val NAP_BLE_ADV_NO_PERMISSION = "BLE_205_ADV_NO_PERMISSION"
        
        const val ERR_INVALID_PARAMS = "BLE_019"
        const val ERR_NOT_CONNECTED = "BLE_011"
        const val ERR_MESSAGE_TOO_LARGE = "BLE_008"
        const val ERR_DEVICE_NOT_FOUND = "BLE_006"
        
        const val MTU_DEFAULT = 512
        const val CHUNK_SIZE = 507
        const val REQUEST_ENABLE_BT = 1001
        
        const val THERMAL_THRESHOLD_C = 42.0f
        const val BATTERY_LOW_THRESHOLD = 20
        const val MAX_RETRY_ATTEMPTS = 3
        const val CONCURRENT_INIT_LOCK_TIMEOUT = 10000L
        const val THERMAL_COOLDOWN_MS = 30000L
        
        const val SAMSUNG_DISCOVER_DELAY_MS = 1500L
        const val GATT_CLOSE_DELAY_MS = 600L
        const val RETRY_DELAY_MS = 2000L
        const val KEEPALIVE_INTERVAL_MS = 2000L
        
        val SERVICE_UUID = NexoGattService.SERVICE_UUID
        val CHAR_ANNOUNCE = NexoGattService.ANNOUNCE_CHAR_UUID
        val CHAR_HANDSHAKE = NexoGattService.HANDSHAKE_CHAR_UUID
        val CHAR_PAYLOAD = NexoGattService.PAYLOAD_CHAR_UUID
        val CHAR_CONTROL = NexoGattService.CONTROL_CHAR_UUID
        
        val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private var gattServer: BluetoothGattServer? = null
    private val serverConnections = ConcurrentHashMap<String, BluetoothDevice>()
    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val pendingChunks = ConcurrentHashMap<String, MutableMap<Int, ByteArray>>()
    private val messageBuffers = ConcurrentHashMap<String, ByteArrayOutputStream>()
    private var advertisingActive = false
    private var isScanning = false
    private var advertiseCallback: AdvertiseCallback? = null
    private var scanCallback: ScanCallback? = null
    private val handler = Handler(Looper.getMainLooper())
    private var userId: String = ""
    private var userName: String = ""
    private val connectionCounter = AtomicInteger(0)
    private val pendingCalls = ConcurrentHashMap<String, PluginCall>()
    
    private val isInitializing = AtomicBoolean(false)
    private val initLock = Object()
    private var lastInitAttempt = 0L
    private var thermalCooldownActive = false
    private var retryCount = 0
    private var lastKnownPermissionState = true
    
    private var pendingPermissionAliases = mutableListOf<String>()
    private var currentPermissionIndex = 0
    private var permissionResults = mutableMapOf<String, Boolean>()
    private var permissionTimeoutRunnable: Runnable? = null
    private var isRequestingPermissions = false

    private val retryAttempts = ConcurrentHashMap<String, Int>()
    private val connectTimeoutRunnables = ConcurrentHashMap<String, Runnable>()
    private val pendingGattCloses = ConcurrentHashMap<String, BluetoothGatt>()
    private val pendingWrites = ConcurrentHashMap<String, MutableList<PendingWrite>>()
    private val keepaliveRunnables = ConcurrentHashMap<String, Runnable>()
    
    // FIX v3.4.0: Track dispositivos desconectados manualmente para evitar auto-retry
    private val userDisconnectedDevices = Collections.newSetFromMap(ConcurrentHashMap<String, Boolean>())
    
    // FIX v3.4.0: Track descriptor writes pendientes para esperar confirmación
    private val pendingDescriptorWrites = ConcurrentHashMap<String, PluginCall>()

    data class PendingWrite(
        val call: PluginCall,
        val payload: ByteArray,
        val messageId: String
    )

    private fun getBluetoothAdapter(): BluetoothAdapter? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) 
                    != PackageManager.PERMISSION_GRANTED) {
                    napLog("BLE_202", "BLUETOOTH_CONNECT no concedido", "WARN")
                    return null
                }
            }
            val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            manager?.adapter
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException: ${e.message}", "ERROR")
            null
        } catch (e: Exception) {
            napLog(NAP_BLE_ERR_INIT_FAILED, "Error: ${e.message}", "ERROR")
            null
        }
    }

    private fun remToast(code: String, msg: String) {
        try {
            val activity = activity
            activity?.runOnUiThread {
                Toast.makeText(activity, "[$code] $msg", Toast.LENGTH_LONG).show()
            }
            val remData = JSObject()
            remData.put("code", code)
            remData.put("message", msg)
            remData.put("timestamp", System.currentTimeMillis())
            remData.put("type", "TOAST")
            notifyListeners("remNativeLog", remData)
        } catch (e: Exception) {
            Log.e(TAG, "REM Toast error: ${e.message}")
        }
    }

    private fun fileLog(tag: String, message: String) {
        try {
            val logFile = File(context.filesDir, "nap-ble-log.txt")
            val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
            logFile.appendText("${sdf.format(Date())} [$tag] $message\n")
        } catch (e: Exception) { }
    }

    private fun napLog(code: String, message: String, level: String = "INFO") {
        val formatted = "[$code] $message [Native:true]"
        when (level) {
            "ERROR" -> Log.e(TAG, formatted)
            "WARN" -> Log.w(TAG, formatted)
            "DEBUG" -> Log.d(TAG, formatted)
            else -> Log.i(TAG, formatted)
        }
        fileLog(code, "[$level] $message")
        val auditData = JSObject()
        auditData.put("code", code)
        auditData.put("message", message)
        auditData.put("level", level)
        auditData.put("timestamp", System.currentTimeMillis())
        auditData.put("native", true)
        auditData.put("component", "BLE")
        auditData.put("userId", userId)
        notifyListeners("napAuditEvent", auditData)
    }

    private fun napError(call: PluginCall?, code: String, message: String, logLevel: String = "ERROR", recoverable: Boolean = false) {
        napLog(code, message, logLevel)
        val errorData = JSObject()
        errorData.put("code", code)
        errorData.put("message", message)
        errorData.put("recoverable", recoverable)
        errorData.put("timestamp", System.currentTimeMillis())
        call?.reject(code, "[$code] $message", errorData)
    }

    private fun getThermalState(): String {
        return try {
            when {
                thermalCooldownActive -> "THROTTLING_ACTIVE"
                getBatteryTemp() > THERMAL_THRESHOLD_C -> "CRITICAL"
                getBatteryTemp() > THERMAL_THRESHOLD_C - 5 -> "WARNING"
                else -> "NORMAL"
            }
        } catch (e: Exception) { "UNKNOWN" }
    }
    
    private fun getBatteryTemp(): Float {
        return try {
            val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val temp = intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0
            temp / 10.0f
        } catch (e: Exception) { 0f }
    }
    
    private fun getBatteryLevel(): Int {
        return try {
            val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        } catch (e: Exception) { 100 }
    }
    
    private fun isDozeMode(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            powerManager.isDeviceIdleMode
        } else false
    }
    
    private fun isAirplaneMode(): Boolean {
        return try {
            Settings.Global.getInt(context.contentResolver, Settings.Global.AIRPLANE_MODE_ON) != 0
        } catch (e: Exception) { false }
    }

    private fun validateSystemHealth(call: PluginCall?, operation: String): Boolean {
        if (getBatteryTemp() > THERMAL_THRESHOLD_C) {
            thermalCooldownActive = true
            napError(call, NAP_BLE_ERR_THERMAL_SHUTDOWN, "Temperatura crítica: ${getBatteryTemp()}°C", "ERROR", recoverable = true)
            handler.postDelayed({ thermalCooldownActive = false }, THERMAL_COOLDOWN_MS)
            return false
        }
        if (getBatteryLevel() < BATTERY_LOW_THRESHOLD && operation != "initialize") {
            napLog(NAP_BLE_LOW_BATTERY, "Batería baja (${getBatteryLevel()}%)", "WARN")
        }
        if (isDozeMode() && operation in listOf("scan", "advertise")) {
            napError(call, NAP_BLE_DOZE_MODE, "Dispositivo en Doze Mode", "WARN", recoverable = true)
            return false
        }
        if (isAirplaneMode()) {
            napError(call, NAP_BLE_ERR_AIRPLANE_MODE, "Modo Avión activado", "ERROR", recoverable = true)
            return false
        }
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permisos no disponibles", "ERROR")
            return false
        }
        if (operation == "advertise" && !canAccessAdvertising()) {
            napError(call, NAP_BLE_ADV_NO_PERMISSION, "BLUETOOTH_ADVERTISE no concedido", "ERROR", recoverable = true)
            return false
        }
        return true
    }

    override fun load() {
        remToast("INIT", "NAP-BLE v3.4.0-P2P-ROBUST cargado")
        napLog("BLE_LOAD", "NAP-BLE v3.4.0-P2P-ROBUST loaded")
        handler.postDelayed({
            if (canAccessBluetooth()) {
                val adapter = getBluetoothAdapter()
                if (adapter != null && adapter.isEnabled) {
                    setupGattServer(adapter)
                    napLog(NAP_BLE_INIT_007, "GattServer auto-inicializado en load()")
                }
            }
        }, 1500)
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED).apply {
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction(Intent.ACTION_AIRPLANE_MODE_CHANGED)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                addAction(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED)
            }
        }
        context.registerReceiver(systemStateReceiver, filter)
    }

    private val systemStateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                BluetoothAdapter.ACTION_STATE_CHANGED -> {
                    val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                    when(state) {
                        BluetoothAdapter.STATE_ON -> {
                            pendingCalls["init"]?.let { call ->
                                handler.postDelayed({
                                    if (!isInitializing.get()) {
                                        napLog(NAP_BLE_RECOVERY_SUCCESS, "BT reactivado, continuando init")
                                        performInitialization(call)
                                        pendingCalls.remove("init")
                                    }
                                }, 500)
                            }
                        }
                        BluetoothAdapter.STATE_TURNING_OFF -> cleanupAllConnections()
                    }
                }
            }
        }
    }

    private fun acquireInitLock(): Boolean {
        synchronized(initLock) {
            val now = System.currentTimeMillis()
            if (isInitializing.get() && (now - lastInitAttempt) > CONCURRENT_INIT_LOCK_TIMEOUT) {
                isInitializing.set(false)
            }
            if (isInitializing.get()) return false
            isInitializing.set(true)
            lastInitAttempt = now
            return true
        }
    }
    
    private fun releaseInitLock() {
        synchronized(initLock) {
            isInitializing.set(false)
            lastInitAttempt = 0L
        }
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

    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        napLog(REM_PERM_REQUEST_START, "Solicitud de permisos BLE iniciada")
        pendingPermissionAliases.clear()
        permissionResults.clear()
        currentPermissionIndex = 0
        isRequestingPermissions = true
        permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!checkPermissionDirectly("bluetoothConnect")) pendingPermissionAliases.add("bluetoothConnect")
            if (!checkPermissionDirectly("bluetoothScan")) pendingPermissionAliases.add("bluetoothScan")
            if (!checkPermissionDirectly("bluetoothAdvertise")) pendingPermissionAliases.add("bluetoothAdvertise")
        } else {
            if (!checkPermissionDirectly("location")) pendingPermissionAliases.add("location")
        }
        if (pendingPermissionAliases.isEmpty()) {
            napLog(NAP_BLE_PERMISSIONS_GRANTED, "Todos los permisos ya concedidos")
            val result = buildPermissionsResult()
            result.put("alreadyGranted", true)
            isRequestingPermissions = false
            call.resolve(result)
            return
        }
        val hasPermanentDenial = checkPermanentDenial()
        permissionTimeoutRunnable = Runnable {
            if (isRequestingPermissions) {
                isRequestingPermissions = false
                napLog(NAP_BLE_PARTIAL_PERMISSIONS, "TIMEOUT: Usuario no respondió", "WARN")
                val errorData = JSObject()
                errorData.put("timeout", true)
                errorData.put("isPermanentDenial", hasPermanentDenial)
                call.reject(NAP_BLE_PARTIAL_PERMISSIONS, "Permisos timeout", errorData)
            }
        }
        handler.postDelayed(permissionTimeoutRunnable!!, 30000)
        saveCall(call)
        requestNextPermission(call)
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
    
    private fun checkPermanentDenial(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        val activity = activity ?: return false
        return pendingPermissionAliases.any { alias ->
            val permission = when(alias) {
                "bluetoothConnect" -> android.Manifest.permission.BLUETOOTH_CONNECT
                "bluetoothScan" -> android.Manifest.permission.BLUETOOTH_SCAN
                "bluetoothAdvertise" -> android.Manifest.permission.BLUETOOTH_ADVERTISE
                else -> return@any false
            }
            !activity.shouldShowRequestPermissionRationale(permission) && 
            ContextCompat.checkSelfPermission(activity, permission) != PackageManager.PERMISSION_GRANTED
        }
    }
    
    @PermissionCallback
    private fun requestPermissionsCallback(call: PluginCall) {
        try {
            val currentAlias = pendingPermissionAliases.getOrNull(currentPermissionIndex)
            if (currentAlias == null) {
                finishPermissionSequence(call)
                return
            }
            val granted = checkPermissionDirectly(currentAlias)
            permissionResults[currentAlias] = granted
            currentPermissionIndex++
            if (currentPermissionIndex < pendingPermissionAliases.size) {
                requestNextPermission(call)
            } else {
                finishPermissionSequence(call)
            }
        } catch (e: Exception) {
            finishPermissionSequence(call)
        }
    }
    
    private fun requestNextPermission(call: PluginCall) {
        val alias = pendingPermissionAliases.getOrNull(currentPermissionIndex)
        if (alias != null) {
            requestPermissionForAlias(alias, call, "requestPermissionsCallback")
        } else {
            finishPermissionSequence(call)
        }
    }
    
    private fun finishPermissionSequence(call: PluginCall) {
        permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
        isRequestingPermissions = false
        reportFinalPermissionsResult(call)
    }
    
    private fun reportFinalPermissionsResult(call: PluginCall) {
        val allGranted = hasAllBlePermissionsDirect()
        val result = buildPermissionsResult()
        if (allGranted) {
            napLog(NAP_BLE_PERMISSIONS_GRANTED, "Todos los permisos concedidos")
            call.resolve(result)
        } else {
            napLog(NAP_BLE_PARTIAL_PERMISSIONS, "Algunos permisos denegados")
            call.reject(NAP_BLE_PARTIAL_PERMISSIONS, "Permisos incompletos")
        }
    }
    
    private fun hasAllBlePermissionsDirect(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            checkPermissionDirectly("bluetoothConnect") && 
            checkPermissionDirectly("bluetoothScan") && 
            checkPermissionDirectly("bluetoothAdvertise")
        } else {
            checkPermissionDirectly("location")
        }
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
        result.put("allGranted", hasAllBlePermissionsDirect())
        result.put("androidVersion", Build.VERSION.SDK_INT)
        return result
    }

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        if (!canAccessBluetooth()) {
            val result = JSObject()
            result.put("enabled", false)
            result.put("stateName", "NO_PERMISSION")
            call.resolve(result)
            return
        }
        val adapter = getBluetoothAdapter()
        val state = try { adapter?.state ?: BluetoothAdapter.STATE_OFF } catch (e: SecurityException) { BluetoothAdapter.STATE_OFF }
        val isEnabled = state == BluetoothAdapter.STATE_ON
        val result = JSObject()
        result.put("enabled", isEnabled)
        result.put("state", state)
        result.put("stateName", if (isEnabled) "ON" else "OFF")
        result.put("canScan", isEnabled && canAccessBluetooth())
        result.put("canAdvertise", isEnabled && canAccessAdvertising())
        call.resolve(result)
    }

    // FIX v3.4.0: Nuevo método para verificar si un GATT está realmente vivo
    private fun isGattAlive(gatt: BluetoothGatt?): Boolean {
        if (gatt == null) return false
        return try {
            val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val device = gatt.device
            if (device == null) return false
            val state = manager?.getConnectionState(device, BluetoothProfile.GATT)
            state == BluetoothProfile.STATE_CONNECTED
        } catch (e: Exception) { false }
    }

    // FIX v3.4.0: Reducido delay de 3000ms a 600ms para evitar bloquear reconexiones
    private fun safeCloseGatt(gatt: BluetoothGatt?, deviceId: String? = null) {
        gatt ?: return
        val id = deviceId ?: try { gatt.device?.address } catch (e: Exception) { null } ?: "unknown"
        keepaliveRunnables.remove(id)?.let { handler.removeCallbacks(it) }
        try {
            gatt.disconnect()
        } catch (e: Exception) { }
        pendingGattCloses[id] = gatt
        handler.postDelayed({
            val pending = pendingGattCloses.remove(id)
            if (pending != null) {
                try { pending.close() } catch (e: Exception) { }
            }
        }, 600)
    }
    
    private fun completeGattClose(deviceId: String) {
        keepaliveRunnables.remove(deviceId)?.let { handler.removeCallbacks(it) }
        val gatt = pendingGattCloses.remove(deviceId)
        if (gatt != null) {
            try { gatt.close() } catch (e: Exception) { }
        }
    }

    private fun cleanupAllConnections() {
        keepaliveRunnables.forEach { (_, r) -> handler.removeCallbacks(r) }
        keepaliveRunnables.clear()
        gattClients.forEach { (id, gatt) ->
            try { gatt.disconnect() } catch (e: Exception) { }
            try { gatt.close() } catch (e: Exception) { }
        }
        gattClients.clear()
        pendingGattCloses.forEach { (_, gatt) ->
            try { gatt.close() } catch (e: Exception) { }
        }
        pendingGattCloses.clear()
        serverConnections.clear()
        gattServer?.close()
        gattServer = null
        messageBuffers.clear()
        pendingChunks.clear()
        retryAttempts.clear()
        pendingWrites.clear()
        connectTimeoutRunnables.forEach { (_, r) -> handler.removeCallbacks(r) }
        connectTimeoutRunnables.clear()
        userDisconnectedDevices.clear()
        pendingDescriptorWrites.clear()
    }

    private fun stopScanInternal() {
        if (!isScanning) return
        try {
            scanCallback?.let { getBluetoothAdapter()?.bluetoothLeScanner?.stopScan(it) }
            isScanning = false
            scanCallback = null
        } catch (e: SecurityException) { }
    }

    private fun stopAdvertiseInternal() {
        if (!advertisingActive) return
        try {
            advertiseCallback?.let { getBluetoothAdapter()?.bluetoothLeAdvertiser?.stopAdvertising(it) }
            advertisingActive = false
            advertiseCallback = null
        } catch (e: SecurityException) { }
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
        else {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permisos requeridos no concedidos")
            pendingCalls.remove("init")
        }
    }

    private fun performInitialization(call: PluginCall) {
        if (!acquireInitLock()) {
            call.resolve(JSObject().apply {
                put("initialized", false)
                put("reason", "concurrent_init")
            })
            return
        }
        try {
            if (!validateSystemHealth(call, "initialize")) {
                releaseInitLock()
                return
            }
            val adapter = getBluetoothAdapter()
            if (adapter == null) {
                napError(call, NAP_BLE_ERR_INIT_FAILED, "No se pudo obtener BluetoothAdapter")
                releaseInitLock()
                return
            }
            if (!adapter.isEnabled) {
                pendingCalls["init"] = call
                val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
                startActivityForResult(call, enableBtIntent, "enableBluetoothResult")
                releaseInitLock()
                return
            }
            setupGattServer(adapter)
            userId = call.getString("userId") ?: ""
            userName = call.getString("userName") ?: "NEXO User"
            val result = JSObject()
            result.put("initialized", true)
            result.put("userId", userId)
            result.put("userName", userName)
            result.put("adapterAddress", adapter.address ?: "unknown")
            call.resolve(result)
            napLog(NAP_BLE_READY, "Inicialización completada")
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_INIT_FAILED, "Excepción: ${e.message}")
        } finally {
            releaseInitLock()
        }
    }

    @ActivityCallback
    private fun enableBluetoothResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) {
            performInitialization(call)
        } else {
            napError(call, NAP_BLE_ERR_DISABLED, "Usuario rechazó activar Bluetooth", recoverable = true)
            pendingCalls.remove("init")
        }
    }

    private fun setupGattServer(adapter: BluetoothAdapter) {
        try {
            if (gattServer != null) return
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
            val cccdDescriptor = BluetoothGattDescriptor(
                CCCD_UUID,
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
            payloadChar.addDescriptor(cccdDescriptor)
            
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
            napLog(NAP_BLE_INIT_007, "GattServer configurado")
        } catch (e: Exception) {
            napLog(NAP_BLE_ERR_INIT_FAILED, "Error setupGattServer: ${e.message}", "ERROR")
        }
    }
    
    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    serverConnections[device.address] = device
                    // FIX v3.4.0: No usar device.name (null en Android 14). Usar placeholder hasta que se lea CHAR_ANNOUNCE
                    napLog(NAP_BLE_CONNECTED, "[SERVER] Dispositivo conectado ENTRANTE: ${device.address}")
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceId", device.address)
                        put("name", "NEXO Peer") // FIX v3.4.0: Placeholder, nombre real se lee vía CHAR_ANNOUNCE
                        put("direction", "incoming")
                    })
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    serverConnections.remove(device.address)
                    napLog("BLE_SERVER_DISC", "[SERVER] Dispositivo desconectado: ${device.address}")
                    notifyListeners("onDeviceDisconnected", JSObject().apply {
                        put("deviceId", device.address)
                    })
                }
            }
        }
        
        override fun onCharacteristicReadRequest(
            device: BluetoothDevice, requestId: Int, offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            try {
                val value = when (characteristic.uuid) {
                    CHAR_ANNOUNCE -> {
                        val data = JSObject()
                        data.put("userId", userId)
                        data.put("userName", userName)
                        data.put("timestamp", System.currentTimeMillis())
                        data.put("napVersion", "3.4.0-P2P-ROBUST")
                        data.toString().toByteArray()
                    }
                    else -> byteArrayOf()
                }
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, value)
            } catch (e: SecurityException) {
                napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "Error enviando respuesta: ${e.message}", "ERROR")
            }
        }
        
        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean,
            offset: Int, value: ByteArray?
        ) {
            try {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
                value?.let { data ->
                    when (characteristic.uuid) {
                        CHAR_PAYLOAD -> {
                            val payloadStr = String(data)
                            napLog(NAP_BLE_MESSAGE_RECEIVED, "[SERVER] Payload de ${device.address}: ${payloadStr.take(100)}")
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
                napLog("BLE_SERVER_EX", "[SERVER] Excepción: ${e.message}", "ERROR")
            }
        }
        
        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean,
            offset: Int, value: ByteArray?
        ) {
            try {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
                if (descriptor.uuid == CCCD_UUID) {
                    descriptor.value = value
                    val enabled = value != null && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    napLog(NAP_BLE_NOTIFICATION_ENABLED, "[SERVER] Cliente ${device.address} CCCD: notifications=$enabled")
                    notifyListeners("onClientNotificationStateChanged", JSObject().apply {
                        put("deviceId", device.address)
                        put("enabled", enabled)
                    })
                }
            } catch (e: SecurityException) {
                napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "Error en descriptor: ${e.message}", "ERROR")
            }
        }
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (!validateSystemHealth(call, "scan")) return
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
            val filter = ScanFilter.Builder()
                .setServiceUuid(ParcelUuid(SERVICE_UUID))
                .build()
            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build()
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

    @PluginMethod
    fun startAdvertise(call: PluginCall) {
        if (!validateSystemHealth(call, "advertise")) return
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos")
            return
        }
        if (advertisingActive) {
            call.resolve(JSObject().apply { 
                put("started", true) 
                put("alreadyActive", true)
            })
            return
        }
        try {
            performStartAdvertisingInternal()
            call.resolve(JSObject().apply { 
                put("started", true) 
                put("pendingConfirmation", true)
            })
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "Error: ${e.message}")
        }
    }

    private fun performStartAdvertisingInternal() {
        val adapter = getBluetoothAdapter()
        if (adapter == null) throw IllegalStateException("Adapter no disponible")
        if (!adapter.isMultipleAdvertisementSupported) throw IllegalStateException("No soporta advertising")
        val advertiser = adapter.bluetoothLeAdvertiser
            ?: throw IllegalStateException("Advertiser no disponible")
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()
        val advertiseData = AdvertiseData.Builder()
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .build()
        advertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                advertisingActive = true
                notifyListeners("onAdvertiseStarted", JSObject().apply {
                    put("success", true)
                })
            }
            override fun onStartFailure(errorCode: Int) {
                advertisingActive = false
                notifyListeners("onAdvertiseFailed", JSObject().apply {
                    put("errorCode", errorCode)
                })
            }
        }
        advertiser.startAdvertising(settings, advertiseData, scanResponse, advertiseCallback!!)
    }

    @PluginMethod
    fun stopAdvertise(call: PluginCall) {
        stopAdvertiseInternal()
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
        
        // FIX v3.4.0: Verificar que el GATT existente está VIVO, no solo en el mapa
        val existingGatt = gattClients[deviceId]
        if (existingGatt != null && isGattAlive(existingGatt)) {
            napLog("BLE_CONN_EXISTING", "[P2P] GATT client vivo para $deviceId")
            call.resolve(JSObject().apply {
                put("connected", true)
                put("deviceId", deviceId)
                put("servicesReady", true)
                put("alreadyConnected", true)
            })
            return
        }
        // FIX v3.4.0: Si existe pero está muerto, limpiarlo
        if (existingGatt != null) {
            napLog("BLE_CONN_DEAD", "[P2P] GATT muerto detectado, limpiando")
            safeCloseGatt(existingGatt, deviceId)
            gattClients.remove(deviceId)
        }
        
        // FIX v3.4.0: Remover de userDisconnectedDevices para permitir reconexión
        userDisconnectedDevices.remove(deviceId)
        
        napLog("BLE_CONN_REQ", "[P2P] Conectar a: $deviceId")
        
        stopScanInternal()
        
        if (pendingCalls.containsKey("connect_$deviceId")) {
            call.reject(ERR_NOT_CONNECTED, "Conexión en progreso")
            return
        }
        
        try {
            val device = adapter?.getRemoteDevice(deviceId)
            if (device == null) {
                call.reject(ERR_DEVICE_NOT_FOUND, "Dispositivo no encontrado")
                return
            }
            
            pendingCalls["connect_$deviceId"] = call
            retryAttempts.remove(deviceId)
            
            val activity = activity
            if (activity != null) {
                activity.runOnUiThread {
                    executeConnect(device, deviceId, attempt = 0)
                }
            } else {
                executeConnect(device, deviceId, attempt = 0)
            }
        } catch (e: IllegalArgumentException) {
            pendingCalls.remove("connect_$deviceId")
            call.reject(ERR_DEVICE_NOT_FOUND, "MAC inválida")
        } catch (e: SecurityException) {
            pendingCalls.remove("connect_$deviceId")
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException")
        }
    }

    private fun executeConnect(device: BluetoothDevice, deviceId: String, attempt: Int) {
        val callback = ClientGattCallback(deviceId, attempt)
        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, callback)
        }
        if (gatt == null) {
            handleConnectFailure(deviceId, "connectGatt retornó null", attempt)
            return
        }
        val timeoutRunnable = Runnable {
            val pending = pendingCalls.remove("connect_$deviceId")
            if (pending != null) {
                napError(pending, ERR_NOT_CONNECTED, "Timeout esperando servicios")
                safeCloseGatt(gatt, deviceId)
                gattClients.remove(deviceId)
            }
        }
        connectTimeoutRunnables[deviceId] = timeoutRunnable
        handler.postDelayed(timeoutRunnable, 15000)
    }

    private fun handleConnectFailure(deviceId: String, reason: String, attempt: Int) {
        connectTimeoutRunnables.remove(deviceId)?.let { handler.removeCallbacks(it) }
        notifyListeners("onConnectionFailed", JSObject().apply {
            put("deviceId", deviceId)
            put("reason", reason)
            put("attempt", attempt)
            put("maxAttempts", MAX_RETRY_ATTEMPTS)
        })
        
        // FIX v3.4.0: No auto-retry si el usuario desconectó manualmente
        if (userDisconnectedDevices.contains(deviceId)) {
            pendingCalls.remove("connect_$deviceId")?.reject(ERR_NOT_CONNECTED, "Desconexión manual")
            return
        }
        
        if (attempt < MAX_RETRY_ATTEMPTS) {
            val nextAttempt = attempt + 1
            retryAttempts[deviceId] = nextAttempt
            handler.postDelayed({
                val adapter = getBluetoothAdapter()
                val dev = adapter?.getRemoteDevice(deviceId)
                if (dev != null) {
                    executeConnect(dev, deviceId, nextAttempt)
                } else {
                    pendingCalls.remove("connect_$deviceId")?.reject(ERR_NOT_CONNECTED, "No se pudo obtener dispositivo")
                }
            }, RETRY_DELAY_MS)
        } else {
            pendingCalls.remove("connect_$deviceId")?.reject(ERR_NOT_CONNECTED, "Falló después de $MAX_RETRY_ATTEMPTS intentos")
        }
    }

    // FIX v3.4.0: Nuevo método para leer nombre del peer desde CHAR_ANNOUNCE
    private fun readPeerName(gatt: BluetoothGatt, deviceId: String) {
        try {
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(CHAR_ANNOUNCE)
            if (char != null) {
                gatt.readCharacteristic(char)
            }
        } catch (e: Exception) { }
    }

    // FIX v3.4.0: Nuevo método para marcar cliente listo cuando todo está confirmado
    private fun markClientReady(deviceId: String, gatt: BluetoothGatt) {
        startKeepalive(deviceId, gatt)
        processPendingWrites(deviceId)
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
    }

    private inner class ClientGattCallback(
        private val deviceId: String,
        private val attempt: Int
    ) : BluetoothGattCallback() {
        
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    napLog(NAP_BLE_CONNECTED, "[CLIENT] GATT conectado: $deviceId")
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceId", deviceId)
                        put("direction", "outgoing")
                        put("attempt", attempt)
                    })
                    handler.postDelayed({
                        try { gatt.discoverServices() } 
                        catch (e: SecurityException) {
                            safeCloseGatt(gatt, deviceId)
                            handleConnectFailure(deviceId, "SecurityException discoverServices", attempt)
                        }
                    }, SAMSUNG_DISCOVER_DELAY_MS)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    // FIX v3.4.0: Cerrar GATT INMEDIATAMENTE en desconexión. 
                    // El GATT muerto en el mapa causa reconnect loop (Error 133).
                    safeCloseGatt(gatt, deviceId)
                    gattClients.remove(deviceId)
                    
                    notifyListeners("onDeviceDisconnected", JSObject().apply {
                        put("deviceId", deviceId)
                        put("gattStatus", status)
                    })
                    
                    // FIX v3.4.0: Solo retry si NO fue desconexión manual
                    // y esperar 600ms antes de retry (anti-133)
                    if (status != BluetoothGatt.GATT_SUCCESS && !userDisconnectedDevices.contains(deviceId)) {
                        handler.postDelayed({
                            handleConnectFailure(deviceId, "Desconexión status=$status", attempt)
                        }, 600)
                    }
                }
            }
        }
        
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                val service = gatt.getService(SERVICE_UUID)
                val char = service?.getCharacteristic(CHAR_PAYLOAD)
                if (service != null && char != null) {
                    gattClients[deviceId] = gatt
                    retryAttempts.remove(deviceId)
                    connectTimeoutRunnables.remove(deviceId)?.let { handler.removeCallbacks(it) }
                    
                    // FIX v3.4.0: Suscribir notificaciones y esperar confirmación de descriptor
                    // antes de marcar ready. Usar pendingDescriptorWrites para trackear.
                    try {
                        gatt.setCharacteristicNotification(char, true)
                        val descriptor = char.getDescriptor(CCCD_UUID)
                        if (descriptor != null) {
                            pendingDescriptorWrites[deviceId] = pendingCalls["connect_$deviceId"]
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                            } else {
                                @Suppress("DEPRECATION")
                                descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                                @Suppress("DEPRECATION")
                                gatt.writeDescriptor(descriptor)
                            }
                        } else {
                            // Sin descriptor, marcar ready inmediatamente (caso raro)
                            markClientReady(deviceId, gatt)
                        }
                    } catch (e: SecurityException) { 
                        safeCloseGatt(gatt, deviceId)
                        handleConnectFailure(deviceId, "SecurityException notifications", attempt)
                    }
                    
                    // FIX v3.4.0: Leer nombre del peer desde CHAR_ANNOUNCE
                    readPeerName(gatt, deviceId)
                } else {
                    safeCloseGatt(gatt, deviceId)
                    handleConnectFailure(deviceId, "Servicio NEXO no encontrado", attempt)
                }
            } else {
                safeCloseGatt(gatt, deviceId)
                handleConnectFailure(deviceId, "Descubrimiento falló status=$status", attempt)
            }
        }
        
        // FIX v3.4.0: Nuevo callback para leer nombre del peer
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
        
        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            val addr = gatt.device?.address ?: "unknown"
            if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == CCCD_UUID) {
                notifyListeners("onNotificationsEnabled", JSObject().apply {
                    put("deviceId", addr)
                    put("enabled", true)
                })
                // FIX v3.4.0: Marcar cliente como listo para chat SOLO después de confirmación CCCD
                markClientReady(addr, gatt)
            } else if (status != BluetoothGatt.GATT_SUCCESS) {
                // Descriptor write falló, conexión no es usable para notificaciones
                notifyListeners("onConnectionFailed", JSObject().apply {
                    put("deviceId", addr)
                    put("reason", "Descriptor write failed: $status")
                })
            }
        }
        
        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val addr = gatt.device?.address ?: "unknown"
            val pending = pendingCalls.remove("write_$addr")
            if (status == BluetoothGatt.GATT_SUCCESS) {
                pending?.resolve(JSObject().apply {
                    put("sent", true)
                    put("confirmed", true)
                })
            } else {
                pending?.reject(ERR_NOT_CONNECTED, "Escritura falló status=$status")
            }
        }
        
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val addr = gatt.device?.address ?: "unknown"
            val data = characteristic.value
            when (characteristic.uuid) {
                CHAR_PAYLOAD -> {
                    val payloadStr = data?.let { String(it) } ?: ""
                    var senderName = "NEXO Peer"
                    var messageContent = payloadStr
                    try {
                        val json = org.json.JSONObject(payloadStr)
                        if (json.has("senderName")) senderName = json.getString("senderName")
                        if (json.has("content")) messageContent = json.getString("content")
                    } catch (e: Exception) { }
                    notifyListeners("onPayloadReceived", JSObject().apply {
                        put("deviceId", addr)
                        put("data", payloadStr)
                        put("content", messageContent)
                        put("senderName", senderName)
                        put("source", "client_notification")
                    })
                }
            }
        }
    }

    private fun startKeepalive(deviceId: String, gatt: BluetoothGatt) {
        val runnable = object : Runnable {
            override fun run() {
                if (!gattClients.containsKey(deviceId) || !isGattAlive(gatt)) return
                try {
                    val service = gatt.getService(SERVICE_UUID)
                    val char = service?.getCharacteristic(CHAR_CONTROL)
                    if (char != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            gatt.writeCharacteristic(char, "ping".toByteArray(), BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE)
                        } else {
                            @Suppress("DEPRECATION")
                            char.value = "ping".toByteArray()
                            @Suppress("DEPRECATION")
                            gatt.writeCharacteristic(char)
                        }
                    }
                } catch (e: Exception) {
                    napLog("BLE_KEEPALIVE_FAIL", "Keepalive falló: ${e.message}", "WARN")
                }
                handler.postDelayed(this, KEEPALIVE_INTERVAL_MS)
            }
        }
        keepaliveRunnables[deviceId] = runnable
        handler.postDelayed(runnable, KEEPALIVE_INTERVAL_MS)
        napLog("BLE_KEEPALIVE", "Keepalive iniciado para $deviceId cada ${KEEPALIVE_INTERVAL_MS}ms")
    }

    private fun processPendingWrites(deviceId: String) {
        val writes = pendingWrites.remove(deviceId)
        if (writes.isNullOrEmpty()) return
        val gatt = gattClients[deviceId]
        if (gatt == null || !isGattAlive(gatt)) {
            writes.forEach { it.call.reject(ERR_NOT_CONNECTED, "GATT no disponible") }
            return
        }
        writes.forEachIndexed { index, pendingWrite ->
            handler.postDelayed({
                performWrite(pendingWrite.call, gatt, deviceId, pendingWrite.payload, pendingWrite.messageId)
            }, (index * 200).toLong())
        }
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        if (deviceId == null) {
            call.reject(ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }
        // FIX v3.4.0: Marcar como desconexión manual para evitar auto-retry
        userDisconnectedDevices.add(deviceId)
        
        gattClients.remove(deviceId)?.let { gatt ->
            safeCloseGatt(gatt, deviceId)
        }
        serverConnections.remove(deviceId)
        pendingWrites.remove(deviceId)
        call.resolve()
    }

    // FIX v3.4.0: Nuevo método forceReconnect para limpiar GATT muerto y reconectar
    @PluginMethod
    fun forceReconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        if (deviceId == null) {
            call.reject(ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }
        // Limpiar GATT muerto
        gattClients.remove(deviceId)?.let { gatt ->
            safeCloseGatt(gatt, deviceId)
        }
        serverConnections.remove(deviceId)
        pendingWrites.remove(deviceId)
        userDisconnectedDevices.remove(deviceId)
        
        handler.postDelayed({
            val adapter = getBluetoothAdapter()
            val device = adapter?.getRemoteDevice(deviceId)
            if (device != null) {
                pendingCalls["connect_$deviceId"] = call
                executeConnect(device, deviceId, 0)
            } else {
                call.reject(ERR_DEVICE_NOT_FOUND, "Dispositivo no encontrado")
            }
        }, 600)
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
        
        if (payload.size > CHUNK_SIZE * 10) {
            call.reject(ERR_MESSAGE_TOO_LARGE, "Mensaje demasiado grande")
            return
        }
        
        // FIX v3.4.0: ESTRATEGIA 1 - GATT client activo y VIVO
        val gatt = gattClients[deviceId]
        if (gatt != null && isGattAlive(gatt)) {
            performWrite(call, gatt, deviceId, payload, messageId)
            return
        } else if (gatt != null) {
            // GATT muerto en mapa, limpiar
            safeCloseGatt(gatt, deviceId)
            gattClients.remove(deviceId)
        }
        
        // FIX v3.4.0: ESTRATEGIA 2 - Peer en serverConnections → notify (verificar suscripción)
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
        
        // ESTRATEGIA 3: Abrir GATT client y encolar
        val adapter = getBluetoothAdapter()
        val device = adapter?.getRemoteDevice(deviceId)
        if (device == null) {
            call.reject(ERR_DEVICE_NOT_FOUND, "Dispositivo no encontrado")
            return
        }
        
        val queue = pendingWrites.getOrPut(deviceId) { mutableListOf() }
        queue.add(PendingWrite(call, payload, messageId))
        executeConnect(device, deviceId, 0)
    }
    
    // FIX v3.4.0: notifyClient ahora verifica que el cliente está suscrito antes de notificar
    private fun notifyClient(deviceId: String, data: ByteArray): Boolean {
        val device = serverConnections[deviceId] ?: return false
        val service = gattServer?.getService(SERVICE_UUID) ?: return false
        val char = service.getCharacteristic(CHAR_PAYLOAD) ?: return false
        
        // FIX v3.4.0: Verificar que el cliente está suscrito antes de notificar
        val descriptor = char.getDescriptor(CCCD_UUID)
        val isSubscribed = descriptor?.value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true
        if (!isSubscribed) {
            napLog("BLE_NOTIFY_NO_SUB", "Cliente $deviceId no suscrito a notificaciones", "WARN")
            return false
        }
        
        return try {
            char.value = data
            gattServer?.notifyCharacteristicChanged(device, char, false) ?: false
        } catch (e: Exception) { false }
    }

    // FIX v3.4.0: performWrite valida GATT vivo antes de escribir
    private fun performWrite(call: PluginCall, gatt: BluetoothGatt, deviceId: String, payload: ByteArray, messageId: String) {
        if (!isGattAlive(gatt)) {
            call.reject(ERR_NOT_CONNECTED, "GATT desconectado")
            gattClients.remove(deviceId)
            return
        }
        try {
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(CHAR_PAYLOAD)
            if (char == null) {
                call.reject(ERR_NOT_CONNECTED, "Característica no disponible")
                return
            }
            pendingCalls["write_$deviceId"] = call
            handler.postDelayed({
                val pending = pendingCalls.remove("write_$deviceId")
                pending?.reject(ERR_NOT_CONNECTED, "Timeout escritura")
            }, 5000)
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(char, payload, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
            } else {
                @Suppress("DEPRECATION")
                char.value = payload
                @Suppress("DEPRECATION")
                gatt.writeCharacteristic(char)
            }
        } catch (e: SecurityException) {
            pendingCalls.remove("write_$deviceId")
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException enviando")
        }
    }

    // FIX v3.4.0: getConnectedDevices filtra solo GATTs realmente vivos
    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val devices = JSArray()
        
        // Filtrar GATT clients vivos
        val deadClients = mutableListOf<String>()
        gattClients.forEach { (address, gatt) ->
            if (isGattAlive(gatt)) {
                val obj = JSObject()
                obj.put("deviceId", address)
                obj.put("direction", "outgoing")
                obj.put("servicesReady", true)
                devices.put(obj)
            } else {
                deadClients.add(address)
            }
        }
        // Limpiar GATTs muertos
        deadClients.forEach { address ->
            gattClients[address]?.let { safeCloseGatt(it, address) }
            gattClients.remove(address)
        }
        
        serverConnections.forEach { (address, device) ->
            try {
                val obj = JSObject()
                obj.put("deviceId", address)
                obj.put("name", "NEXO Peer") // FIX v3.4.0: Placeholder consistente
                obj.put("direction", "incoming")
                devices.put(obj)
            } catch (e: SecurityException) { }
        }
        val result = JSObject()
        result.put("devices", devices)
        call.resolve(result)
    }

    @PluginMethod
    fun getLocalDeviceInfo(call: PluginCall) {
        try {
            val adapter = getBluetoothAdapter()
            val result = JSObject()
            result.put("deviceName", adapter?.name ?: "Unknown")
            result.put("deviceAddress", adapter?.address ?: "Unknown")
            result.put("userId", userId)
            result.put("userName", userName)
            call.resolve(result)
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "Error obteniendo info")
        }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) { startAdvertise(call) }
    @PluginMethod
    fun stopAdvertising(call: PluginCall) { stopAdvertise(call) }
    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val result = JSObject()
        result.put("isAdvertising", advertisingActive)
        call.resolve(result)
    }
}
