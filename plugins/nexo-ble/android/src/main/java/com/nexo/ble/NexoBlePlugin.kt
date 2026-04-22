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
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

// Build #796 → v3.1.2-FINAL
// Fixes GATT Error 133 específicos Samsung Galaxy + Android 14 Stack Bug:
// 1. TRANSPORT_LE explícito en connectGatt
// 2. requestMtu(512) eliminado del handshake (timeout Samsung)
// 3. safeCloseGatt(): disconnect → espera STATE_DISCONNECTED → close
// 4. refreshDeviceCache() vía reflection EN onConnectionStateChange(STATE_CONNECTED)
// 5. Exponential backoff retry: 1s, 2s, 4s (autoConnect=true en retries)
// 6. NUNCA connectGatt() desde callback → siempre handler.post
// 7. Delay 1.5s antes de discoverServices() post-conexión
// 8. Logging a archivo interno (visible sin root)
// 9. stopScanInternal() antes de cada connectGatt (no scan+connect simultáneo)
// 10. connectGatt() SIEMPRE en UI thread via activity.runOnUiThread
// 11. Detector Android 14 Stack Bug: 3 fallos 133 en 30s → onBluetoothStackBroken
// 12. Evento onConnectionFailed enriquecido con reason, attempt, suggestion

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
        const val GATT_RECONNECT_PAUSE_MS = 600L
        
        // ─── FIX SAMSUNG: Constantes de timing ───
        const val SAMSUNG_DISCOVER_DELAY_MS = 1500L
        const val GATT_CLOSE_DELAY_MS = 600L
        const val RETRY_BASE_DELAY_MS = 1000L
        
        // ─── FIX STACK BUG: Detector de stack corrupto ───
        const val STACK_BUG_FAIL_THRESHOLD = 3
        const val STACK_BUG_WINDOW_MS = 30000L
        
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
    private val connectionCounter = AtomicInteger(0)
    private val pendingCalls = ConcurrentHashMap<String, PluginCall>()
    
    private val isInitializing = AtomicBoolean(false)
    private val initLock = Object()
    private var lastInitAttempt = 0L
    private var thermalCooldownActive = false
    private var retryCount = 0
    private var lastKnownPermissionState = true
    
    private var cachedDeviceState: JSObject? = null
    
    private var pendingPermissionAliases = mutableListOf<String>()
    private var currentPermissionIndex = 0
    private var permissionResults = mutableMapOf<String, Boolean>()
    private var permissionTimeoutRunnable: Runnable? = null
    private var isRequestingPermissions = false

    // ─── FIX SAMSUNG: Trackers para retry y timeouts ───
    private val retryAttempts = ConcurrentHashMap<String, Int>()
    private val connectTimeoutRunnables = ConcurrentHashMap<String, Runnable>()

    // ─── FIX STACK BUG: Tracker de fallos 133 ───
    private val gatt133Failures = mutableListOf<Long>()
    private var stackBrokenNotified = false

    // ─── FIX safeClose: GATTs pendientes de cierre ───
    private val pendingGattCloses = ConcurrentHashMap<String, BluetoothGatt>()

    private fun getBluetoothAdapter(): BluetoothAdapter? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) 
                    != PackageManager.PERMISSION_GRANTED) {
                    napLog("BLE_202", "BLUETOOTH_CONNECT no concedido, no se puede obtener adapter", "WARN")
                    return null
                }
            }
            val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val adapter = manager?.adapter
            if (adapter == null) {
                napLog(NAP_BLE_ERR_NOT_SUPPORTED, "Dispositivo sin soporte Bluetooth", "ERROR")
            }
            adapter
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException obteniendo adapter: ${e.message}", "ERROR")
            null
        } catch (e: Exception) {
            napLog(NAP_BLE_ERR_INIT_FAILED, "Error obteniendo adapter: ${e.message}", "ERROR")
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

    // ─── FIX SAMSUNG: Logging a archivo interno (visible sin root) ───
    private fun fileLog(tag: String, message: String) {
        try {
            val logFile = File(context.filesDir, "nap-ble-log.txt")
            val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
            logFile.appendText("${sdf.format(Date())} [$tag] $message\n")
        } catch (e: Exception) {
            // Silencioso — nunca debe fallar por logging
        }
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
        auditData.put("thermalState", getThermalState())
        auditData.put("batteryLevel", getBatteryLevel())
        notifyListeners("napAuditEvent", auditData)
    }

    private fun napError(call: PluginCall?, code: String, message: String, logLevel: String = "ERROR", recoverable: Boolean = false) {
        napLog(code, message, logLevel)
        val errorData = JSObject()
        errorData.put("code", code)
        errorData.put("message", message)
        errorData.put("recoverable", recoverable)
        errorData.put("suggestion", getRecoverySuggestion(code))
        errorData.put("timestamp", System.currentTimeMillis())
        call?.reject(code, "[$code] $message", errorData)
        if (recoverable) {
            notifyListeners("napRecoveryAvailable", errorData)
        }
    }
    
    private fun getRecoverySuggestion(code: String): String {
        return when (code) {
            NAP_BLE_PERMISSION_REVOKED -> "Reinicie la app y conceda permisos desde Configuración > Apps > NEXO > Permisos"
            NAP_BLE_PARTIAL_PERMISSIONS -> "Conceda todos los permisos solicitados para funcionalidad completa BLE"
            NAP_BLE_THERMAL_THROTTLE -> "Espere 30 segundos para enfriamiento"
            NAP_BLE_ERR_AIRPLANE_MODE -> "Desactive Modo Avión"
            NAP_BLE_ERR_DISABLED -> "Active Bluetooth desde Configuración"
            NAP_BLE_LOW_BATTERY -> "Conecte el cargador"
            NAP_BLE_DOZE_MODE -> "Desbloquee el dispositivo"
            NAP_BLE_CONCURRENT_INIT -> "Espere a que termine la inicialización"
            NAP_BLE_ADV_NO_PERMISSION -> "Conceda permiso 'Dispositivos cercanos' en Configuración"
            else -> "Contacte soporte si el problema persiste"
        }
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
            handler.postDelayed({ thermalCooldownActive = false; napLog(NAP_BLE_RECOVERY_SUCCESS, "Cooldown completado") }, THERMAL_COOLDOWN_MS)
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
            if (lastKnownPermissionState) {
                lastKnownPermissionState = false
                napError(call, NAP_BLE_PERMISSION_REVOKED, "Permisos revocados", "ERROR", recoverable = true)
            } else {
                napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permisos no disponibles", "ERROR")
            }
            return false
        } else {
            lastKnownPermissionState = true
        }
        if (operation == "advertise" && !canAccessAdvertising()) {
            napError(call, NAP_BLE_ADV_NO_PERMISSION, "BLUETOOTH_ADVERTISE no concedido. Requerido para advertising en Android 12+.", "ERROR", recoverable = true)
            return false
        }
        return true
    }

    override fun load() {
        remToast("INIT", "NAP-BLE v3.1.2-FINAL cargado")
        napLog("BLE_LOAD", "NAP-BLE v3.1.2-FINAL loaded - TRANSPORT_LE + safeCloseGatt + Samsung GATT 133 fixes + Stack Bug detector")
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
                    val stateName = when(state) {
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
                            "ON"
                        }
                        BluetoothAdapter.STATE_OFF -> "OFF"
                        BluetoothAdapter.STATE_TURNING_ON -> "TURNING_ON"
                        BluetoothAdapter.STATE_TURNING_OFF -> {
                            cleanupAllConnections()
                            "TURNING_OFF"
                        }
                        else -> "UNKNOWN"
                    }
                    notifyListeners("onBluetoothStateChanged", JSObject().apply {
                        put("state", stateName)
                        put("stateCode", state)
                        put("thermal", getThermalState())
                        put("source", "broadcast_receiver")
                    })
                }
                Intent.ACTION_BATTERY_CHANGED -> {
                    val temp = getBatteryTemp()
                    if (temp > THERMAL_THRESHOLD_C && !thermalCooldownActive) {
                        napLog(NAP_BLE_THERMAL_THROTTLE, "Throttling por temperatura: ${temp}°C", "WARN")
                        thermalCooldownActive = true
                    }
                }
                Intent.ACTION_AIRPLANE_MODE_CHANGED -> {
                    if (isAirplaneMode()) {
                        napLog(NAP_BLE_ERR_AIRPLANE_MODE, "Modo Avión detectado", "ERROR")
                        stopAllOperations()
                    }
                }
            }
        }
    }

    private fun acquireInitLock(): Boolean {
        synchronized(initLock) {
            val now = System.currentTimeMillis()
            if (isInitializing.get() && (now - lastInitAttempt) > CONCURRENT_INIT_LOCK_TIMEOUT) {
                napLog(NAP_BLE_CONCURRENT_INIT, "Deadlock detectado, liberando lock", "WARN")
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

    private fun initializeAdapter(): Boolean {
        if (!canAccessBluetooth()) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "BLUETOOTH_CONNECT no concedido", "ERROR")
            return false
        }
        try {
            val adapter = getBluetoothAdapter()
            if (adapter == null) {
                napLog(NAP_BLE_ERR_NOT_SUPPORTED, "Dispositivo sin soporte Bluetooth", "ERROR")
                return false
            }
            return true
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException: ${e.message}", "ERROR")
            return false
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
                errorData.put("pendingAliases", JSArray(pendingPermissionAliases))
                call.reject(NAP_BLE_PARTIAL_PERMISSIONS, "Permisos timeout", errorData)
                pendingPermissionAliases.clear()
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
            if (granted) {
                napLog("REM_PERM_GRANTED", "Permiso $currentAlias concedido")
            } else {
                val isPermanent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val permission = when(currentAlias) {
                        "bluetoothConnect" -> android.Manifest.permission.BLUETOOTH_CONNECT
                        "bluetoothScan" -> android.Manifest.permission.BLUETOOTH_SCAN
                        "bluetoothAdvertise" -> android.Manifest.permission.BLUETOOTH_ADVERTISE
                        else -> null
                    }
                    permission?.let {
                        val activity = activity
                        activity != null && !activity.shouldShowRequestPermissionRationale(it)
                    } ?: false
                } else false
                if (isPermanent) {
                    napLog("REM_PERM_DENIED_PERM", "Permiso $currentAlias denegado permanentemente")
                } else {
                    napLog("REM_PERM_DENIED_TEMP", "Permiso $currentAlias denegado temporalmente")
                }
            }
            currentPermissionIndex++
            if (currentPermissionIndex < pendingPermissionAliases.size) {
                requestNextPermission(call)
            } else {
                finishPermissionSequence(call)
            }
        } catch (e: Exception) {
            napLog("REM_PERM_ERROR", "Excepción en callback: ${e.message}", "ERROR")
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
        val hasPermanentDenial = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val activity = activity
            activity != null && pendingPermissionAliases.any { alias ->
                val permission = when(alias) {
                    "bluetoothConnect" -> android.Manifest.permission.BLUETOOTH_CONNECT
                    "bluetoothScan" -> android.Manifest.permission.BLUETOOTH_SCAN
                    "bluetoothAdvertise" -> android.Manifest.permission.BLUETOOTH_ADVERTISE
                    else -> return@any false
                }
                !activity.shouldShowRequestPermissionRationale(permission) && 
                ContextCompat.checkSelfPermission(activity, permission) != PackageManager.PERMISSION_GRANTED
            }
        } else false
        result.put("isPermanentDenial", hasPermanentDenial)
        result.put("permissionResults", JSObject().apply {
            permissionResults.forEach { (k, v) -> put(k, v) }
        })
        if (allGranted) {
            napLog(NAP_BLE_PERMISSIONS_GRANTED, "Todos los permisos concedidos")
            notifyListeners("onPermissionsGranted", JSObject().apply {
                put("allGranted", true)
                put("platform", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "android12+" else "legacy")
            })
            call.resolve(result)
        } else {
            napLog(NAP_BLE_PARTIAL_PERMISSIONS, "Algunos permisos denegados")
            val errorData = JSObject()
            val permsObj = result.getJSObject("permissions")
            if (permsObj != null) errorData.put("permissions", permsObj)
            errorData.put("allGranted", false)
            errorData.put("isPermanentDenial", hasPermanentDenial)
            errorData.put("detailedResults", JSObject().apply {
                permissionResults.forEach { (k, v) -> put(k, v) }
            })
            call.reject(NAP_BLE_PARTIAL_PERMISSIONS, "Permisos incompletos", errorData)
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
        val allGranted: Boolean
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.put("bluetoothConnect", checkPermissionDirectly("bluetoothConnect"))
            permissions.put("bluetoothScan", checkPermissionDirectly("bluetoothScan"))
            permissions.put("bluetoothAdvertise", checkPermissionDirectly("bluetoothAdvertise"))
            allGranted = hasAllBlePermissionsDirect()
        } else {
            permissions.put("location", checkPermissionDirectly("location"))
            allGranted = hasAllBlePermissionsDirect()
        }
        result.put("permissions", permissions)
        result.put("allGranted", allGranted)
        result.put("androidVersion", Build.VERSION.SDK_INT)
        result.put("isAndroid12OrHigher", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        return result
    }

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        napLog("BLE_STATE_CHECK", "Verificando estado Bluetooth")
        if (!canAccessBluetooth()) {
            napLog(NAP_BLE_WAITING_PERMISSIONS, "Permisos no concedidos, reportando estado desconocido")
            val result = JSObject()
            result.put("enabled", false)
            result.put("state", BluetoothAdapter.STATE_OFF)
            result.put("stateName", "NO_PERMISSION")
            result.put("needsPermission", true)
            result.put("canPrompt", true)
            result.put("health", getSystemHealthReport())
            call.resolve(result)
            return
        }
        val adapter = getBluetoothAdapter()
        if (adapter == null) {
            napLog(NAP_BLE_ERR_NOT_SUPPORTED, "No se pudo obtener adapter aunque hay permisos")
            val result = JSObject()
            result.put("enabled", false)
            result.put("state", BluetoothAdapter.ERROR)
            result.put("stateName", "ADAPTER_NULL")
            result.put("error", "BluetoothManager returned null adapter")
            result.put("health", getSystemHealthReport())
            call.resolve(result)
            return
        }
        val state = try { adapter.state } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException leyendo estado", "ERROR")
            BluetoothAdapter.STATE_OFF
        }
        val isEnabled = state == BluetoothAdapter.STATE_ON
        val stateName = when(state) {
            BluetoothAdapter.STATE_ON -> "ON"
            BluetoothAdapter.STATE_OFF -> "OFF"
            BluetoothAdapter.STATE_TURNING_ON -> "TURNING_ON"
            BluetoothAdapter.STATE_TURNING_OFF -> "TURNING_OFF"
            else -> "UNKNOWN"
        }
        napLog("BLE_STATE_RESULT", "Estado real: $stateName ($state), enabled: $isEnabled")
        val result = JSObject()
        result.put("enabled", isEnabled)
        result.put("state", state)
        result.put("stateName", stateName)
        result.put("health", getSystemHealthReport())
        result.put("canScan", isEnabled && canAccessBluetooth())
        result.put("canAdvertise", isEnabled && canAccessAdvertising())
        result.put("isMultipleAdvertisementSupported", adapter.isMultipleAdvertisementSupported)
        result.put("isOffloadedFilteringSupported", adapter.isOffloadedFilteringSupported)
        call.resolve(result)
    }

    private fun getSystemHealthReport(): JSObject {
        val health = JSObject()
        health.put("thermalState", getThermalState())
        health.put("batteryLevel", getBatteryLevel())
        health.put("batteryTemp", getBatteryTemp())
        health.put("isDozeMode", isDozeMode())
        health.put("isAirplaneMode", isAirplaneMode())
        health.put("canAccessBluetooth", canAccessBluetooth())
        health.put("canAccessAdvertising", canAccessAdvertising())
        health.put("permissionsGranted", hasAllBlePermissionsDirect())
        health.put("androidVersion", Build.VERSION.SDK_INT)
        health.put("isAndroid12OrHigher", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        return health
    }

    // ─── FIX v3.1.2: safeCloseGatt refactorizado ───
    // Espera STATE_DISCONNECTED antes de close(), o fuerza tras timeout extendido
    private fun safeCloseGatt(gatt: BluetoothGatt?, deviceId: String? = null) {
        gatt ?: return
        val id = deviceId ?: try { gatt.device?.address } catch (e: Exception) { null } ?: "unknown"
        
        // Paso 1: disconnect inmediato
        try {
            gatt.disconnect()
            napLog("BLE_SAFE_CLOSE", "disconnect() llamado para $id")
        } catch (e: Exception) {
            Log.w(TAG, "safeCloseGatt disconnect error: ${e.message}")
        }
        
        // Paso 2: Registrar en pending para cerrar cuando llegue STATE_DISCONNECTED
        pendingGattCloses[id] = gatt
        
        // Paso 3: Timeout de seguridad (si nunca llega STATE_DISCONNECTED)
        handler.postDelayed({
            val pending = pendingGattCloses.remove(id)
            if (pending != null) {
                try {
                    pending.close()
                    napLog("BLE_SAFE_CLOSE", "close() forzado por timeout para $id")
                } catch (e: Exception) {
                    Log.w(TAG, "safeCloseGatt forced close error: ${e.message}")
                }
            }
        }, 3000) // 3 segundos es suficiente para que llegue STATE_DISCONNECTED
    }
    
    // Llamado desde onConnectionStateChange cuando llega STATE_DISCONNECTED
    private fun completeGattClose(deviceId: String) {
        val gatt = pendingGattCloses.remove(deviceId)
        if (gatt != null) {
            try {
                gatt.close()
                napLog("BLE_SAFE_CLOSE", "close() completado tras STATE_DISCONNECTED para $deviceId")
            } catch (e: Exception) {
                Log.w(TAG, "completeGattClose error: ${e.message}")
            }
        }
    }

    // ─── FIX SAMSUNG: refreshDeviceCache vía reflection ───
    private fun refreshDeviceCache(gatt: BluetoothGatt?): Boolean {
        gatt ?: return false
        return try {
            val method = gatt.javaClass.getMethod("refresh")
            val result = method.invoke(gatt) as Boolean
            napLog("BLE_CACHE_REFRESH", "refreshDeviceCache result: $result")
            result
        } catch (e: Exception) {
            napLog("BLE_CACHE_REFRESH_FAIL", "refreshDeviceCache failed: ${e.message}", "WARN")
            false
        }
    }

    private fun cleanupAllConnections() {
        napLog("BLE_CLEANUP", "Limpiando todas las conexiones BLE")
        try {
            gattClients.forEach { (id, gatt) ->
                safeCloseGatt(gatt, id)
            }
            gattClients.clear()
            pendingGattCloses.forEach { (id, gatt) ->
                try { gatt.close() } catch (e: Exception) { }
            }
            pendingGattCloses.clear()
            serverConnections.clear()
            gattServer?.close()
            gattServer = null
            messageBuffers.clear()
            pendingChunks.clear()
            retryAttempts.clear()
            connectTimeoutRunnables.forEach { (_, r) -> handler.removeCallbacks(r) }
            connectTimeoutRunnables.clear()
            gatt133Failures.clear()
            stackBrokenNotified = false
            napLog("BLE_CLEANUP_OK", "Conexiones limpiadas")
        } catch (e: Exception) {
            napLog(NAP_BLE_ERR_INIT_FAILED, "Error en cleanup: ${e.message}", "ERROR")
        }
    }

    private fun stopAllOperations() {
        napLog("BLE_STOP_ALL", "Deteniendo todas las operaciones BLE")
        stopScanInternal()
        stopAdvertiseInternal()
    }

    private fun stopScanInternal() {
        if (!isScanning) return
        try {
            scanCallback?.let { getBluetoothAdapter()?.bluetoothLeScanner?.stopScan(it) }
            isScanning = false
            scanCallback = null
            napLog("BLE_SCAN_STOP", "Scan detenido")
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "Error deteniendo scan: ${e.message}", "ERROR")
        }
    }

    private fun stopAdvertiseInternal() {
        if (!advertisingActive) return
        try {
            advertiseCallback?.let { getBluetoothAdapter()?.bluetoothLeAdvertiser?.stopAdvertising(it) }
            advertisingActive = false
            advertiseCallback = null
            napLog("BLE_AD_STOP", "Advertising detenido")
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "Error deteniendo advertise: ${e.message}", "ERROR")
        }
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
        if (canAccessBluetooth()) {
            performInitialization(call)
        } else {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permisos requeridos no concedidos")
            pendingCalls.remove("init")
        }
    }

    private fun performInitialization(call: PluginCall) {
        if (!acquireInitLock()) {
            napLog(NAP_BLE_CONCURRENT_INIT, "Inicialización ya en progreso")
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
                napLog(NAP_BLE_WAITING_BT_ON, "Bluetooth desactivado, solicitando activación")
                pendingCalls["init"] = call
                val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
                startActivityForResult(call, enableBtIntent, "enableBluetoothResult")
                releaseInitLock()
                return
            }
            setupGattServer(adapter)
            userId = call.getString("userId") ?: ""
            val result = JSObject()
            result.put("initialized", true)
            result.put("userId", userId)
            result.put("adapterAddress", adapter.address ?: "unknown")
            result.put("mtu", MTU_DEFAULT)
            result.put("health", getSystemHealthReport())
            napLog(NAP_BLE_READY, "Inicialización completada")
            notifyListeners("onBLEInitialized", JSObject().apply {
                put("ready", true)
                put("userId", userId)
            })
            call.resolve(result)
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_INIT_FAILED, "Excepción: ${e.message}")
        } finally {
            releaseInitLock()
        }
    }

    @ActivityCallback
    private fun enableBluetoothResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) {
            napLog(NAP_BLE_RECOVERY_SUCCESS, "Usuario activó Bluetooth")
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
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ
            )
            service.addCharacteristic(announceChar)
            service.addCharacteristic(handshakeChar)
            service.addCharacteristic(payloadChar)
            service.addCharacteristic(controlChar)
            gattServer = manager?.openGattServer(context, gattServerCallback)
            gattServer?.addService(service)
            napLog(NAP_BLE_INIT_007, "GattServer configurado correctamente con CCCD + NOTIFY")
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException en setupGattServer: ${e.message}", "ERROR")
        } catch (e: Exception) {
            napLog(NAP_BLE_ERR_INIT_FAILED, "Error setupGattServer: ${e.message}", "ERROR")
        }
    }
    
    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    serverConnections[device.address] = device
                    napLog(NAP_BLE_CONNECTED, "[SERVER] Dispositivo conectado ENTRANTE: ${device.address}")
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceId", device.address)
                        put("name", device.name ?: "Unknown")
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
            device: BluetoothDevice,
            requestId: Int,
            offset: Int,
            characteristic: BluetoothGattCharacteristic
        ) {
            try {
                val value = when (characteristic.uuid) {
                    CHAR_ANNOUNCE -> {
                        val data = JSObject()
                        data.put("userId", userId)
                        data.put("timestamp", System.currentTimeMillis())
                        data.put("napVersion", "3.1.2-FINAL")
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
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            try {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
                value?.let { data ->
                    when (characteristic.uuid) {
                        CHAR_HANDSHAKE -> {
                            notifyListeners("onHandshakeReceived", JSObject().apply {
                                put("deviceId", device.address)
                                put("data", String(data))
                            })
                        }
                        CHAR_PAYLOAD -> {
                            napLog("BLE_PAYLOAD_RECV", "[SERVER] Payload recibido de ${device.address}: ${String(data)}")
                            notifyListeners("onPayloadReceived", JSObject().apply {
                                put("deviceId", device.address)
                                put("data", String(data))
                                put("source", "server_write_request")
                                put("timestamp", System.currentTimeMillis())
                            })
                        }
                        CHAR_CONTROL -> {
                            notifyListeners("onControlCommand", JSObject().apply {
                                put("deviceId", device.address)
                                put("command", String(data))
                            })
                        }
                    }
                }
            } catch (e: SecurityException) {
                napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "Error procesando write: ${e.message}", "ERROR")
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
            try {
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
                if (descriptor.uuid == CCCD_UUID) {
                    descriptor.value = value
                    val enabled = value != null && value.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    napLog(NAP_BLE_NOTIFICATION_ENABLED, "[SERVER] Cliente ${device.address} configuró CCCD: notifications=$enabled")
                    notifyListeners("onClientNotificationStateChanged", JSObject().apply {
                        put("deviceId", device.address)
                        put("enabled", enabled)
                    })
                }
            } catch (e: SecurityException) {
                napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "Error en descriptor write request: ${e.message}", "ERROR")
            }
        }
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (!validateSystemHealth(call, "scan")) return
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos para escanear")
            return
        }
        if (isScanning) {
            call.resolve(JSObject().apply { put("started", true) })
            return
        }
        try {
            val adapter = getBluetoothAdapter()
            if (adapter == null) {
                napError(call, NAP_BLE_ERR_NOT_SUPPORTED, "Adapter no disponible")
                return
            }
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
                        } catch (e: SecurityException) {
                            // Device may have disappeared
                        }
                    }
                }
                override fun onScanFailed(errorCode: Int) {
                    napLog(NAP_BLE_ERR_SCAN_FAILED, "Scan failed: $errorCode", "ERROR")
                }
            }
            adapter.bluetoothLeScanner?.startScan(listOf(filter), settings, scanCallback!!)
            isScanning = true
            napLog(NAP_BLE_SCAN_STARTED, "Scan iniciado")
            call.resolve(JSObject().apply { put("started", true) })
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException en scan: ${e.message}")
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_SCAN_FAILED, "Error iniciando scan: ${e.message}")
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
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos para anunciar")
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
            val adapter = getBluetoothAdapter()
            if (adapter == null) {
                napError(call, NAP_BLE_ERR_NOT_SUPPORTED, "Adapter no disponible")
                return
            }
            if (!adapter.isMultipleAdvertisementSupported) {
                napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "Este dispositivo no soporta BLE Advertising", "ERROR")
                return
            }
            val advertiser = adapter.bluetoothLeAdvertiser
            if (advertiser == null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADVERTISE) 
                    != PackageManager.PERMISSION_GRANTED) {
                    napError(call, NAP_BLE_ADV_NO_PERMISSION, "BLUETOOTH_ADVERTISE no concedido. El advertising requiere este permiso en Android 12+.", "ERROR", recoverable = true)
                } else if (!adapter.isEnabled) {
                    napError(call, NAP_BLE_ERR_DISABLED, "Bluetooth está desactivado. Actívalo para poder anunciar.", "ERROR", recoverable = true)
                } else {
                    napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "BluetoothLeAdvertiser no disponible. Posible causa: permiso ADVERTISE denegado o no soportado.", "ERROR", recoverable = true)
                }
                return
            }
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
                    napLog(NAP_BLE_ADVERTISE_STARTED, "Advertising iniciado correctamente")
                    notifyListeners("onAdvertiseStarted", JSObject().apply {
                        put("success", true)
                        put("timestamp", System.currentTimeMillis())
                    })
                }
                override fun onStartFailure(errorCode: Int) {
                    advertisingActive = false
                    val errorName = when(errorCode) {
                        ADVERTISE_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                        ADVERTISE_FAILED_DATA_TOO_LARGE -> "DATA_TOO_LARGE"
                        ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "TOO_MANY_ADVERTISERS"
                        ADVERTISE_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                        ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
                        else -> "UNKNOWN ($errorCode)"
                    }
                    napLog(NAP_BLE_ERR_ADVERTISE_FAILED, "Advertising failed: $errorName", "ERROR")
                    notifyListeners("onAdvertiseFailed", JSObject().apply {
                        put("errorCode", errorCode)
                        put("errorName", errorName)
                    })
                }
            }
            advertiser.startAdvertising(settings, advertiseData, scanResponse, advertiseCallback!!)
            call.resolve(JSObject().apply { 
                put("started", true) 
                put("pendingConfirmation", true)
                put("note", "Advertising iniciado nativamente. Estado real confirmado por evento onAdvertiseStarted.")
            })
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException en advertise: ${e.message}")
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "Error iniciando advertise: ${e.message}")
        }
    }

    @PluginMethod
    fun stopAdvertise(call: PluginCall) {
        stopAdvertiseInternal()
        call.resolve()
    }

    // ─── FIX v3.1.2: connectToDevice con stopScan + UI thread + safeClose ───
    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        if (deviceId == null) {
            call.reject(ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos para conectar")
            return
        }
        val adapter = getBluetoothAdapter()
        if (adapter?.address == deviceId) {
            napError(call, ERR_INVALID_PARAMS, "No puedes conectarte a tu propio dispositivo")
            return
        }
        
        napLog("BLE_CONN_REQ", "[CLIENT] Solicitud conectar a: $deviceId | gattClients actuales: ${gattClients.keys} | serverConnections=${serverConnections.keys}")
        
        // ─── FIX v3.1.2: Detener scan ANTES de conectar (evita 133 en Samsung) ───
        stopScanInternal()
        
        // Cerrar GATT existente de forma segura
        val existingGatt = gattClients.remove(deviceId)
        if (existingGatt != null) {
            napLog("BLE_CONN_CLEAN", "[CLIENT] Cerrando GATT anterior para: $deviceId")
            safeCloseGatt(existingGatt, deviceId)
        }
        
        if (pendingCalls.containsKey("connect_$deviceId")) {
            napLog("BLE_CONN_DUP", "[CLIENT] Conexión ya en progreso a $deviceId, rechazando duplicado")
            call.reject(ERR_NOT_CONNECTED, "Conexión ya en progreso a este dispositivo. Espere a que termine.")
            return
        }
        
        try {
            val device = adapter?.getRemoteDevice(deviceId)
            if (device == null) {
                napLog("BLE_CONN_NULL_DEVICE", "[CLIENT] getRemoteDevice($deviceId) retornó null. ¿Es una MAC válida?")
                call.reject(ERR_DEVICE_NOT_FOUND, "Dispositivo no encontrado (MAC inválida o no resoluble)")
                return
            }
            
            pendingCalls["connect_$deviceId"] = call
            retryAttempts.remove(deviceId) // Reset contador
            
            // ─── FIX v3.1.2: SIEMPRE ejecutar connectGatt en UI thread ───
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
            napLog("BLE_CONN_INV_MAC", "[CLIENT] IllegalArgumentException para deviceId='$deviceId': ${e.message}", "ERROR")
            call.reject(ERR_DEVICE_NOT_FOUND, "Dirección Bluetooth inválida: $deviceId")
        } catch (e: SecurityException) {
            pendingCalls.remove("connect_$deviceId")
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException en connect: ${e.message}")
        }
    }

    private fun executeConnect(device: BluetoothDevice, deviceId: String, attempt: Int) {
        val autoConnect = attempt > 0
        val callback = ClientGattCallback(deviceId, attempt)
        
        napLog("BLE_CONN_EXEC", "[CLIENT] executeConnect deviceId=$deviceId attempt=$attempt autoConnect=$autoConnect")
        
        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, autoConnect, callback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, autoConnect, callback)
        }
        
        if (gatt == null) {
            napLog("BLE_CONN_NULL_GATT", "[CLIENT] connectGatt retornó null para $deviceId")
            handleConnectFailure(deviceId, "connectGatt retornó null", attempt)
            return
        }
        
        val timeoutRunnable = Runnable {
            val pending = pendingCalls.remove("connect_$deviceId")
            if (pending != null) {
                napError(pending, ERR_NOT_CONNECTED, "Timeout esperando descubrimiento de servicios para $deviceId (attempt=$attempt)")
                safeCloseGatt(gatt, deviceId)
                gattClients.remove(deviceId)
            }
        }
        connectTimeoutRunnables[deviceId] = timeoutRunnable
        handler.postDelayed(timeoutRunnable, 15000)
    }

    // ─── FIX v3.1.2: Retry con exponential backoff + detector 133 ───
    private fun handleConnectFailure(deviceId: String, reason: String, attempt: Int) {
        connectTimeoutRunnables.remove(deviceId)?.let { handler.removeCallbacks(it) }
        
        // ─── FIX STACK BUG: Trackear fallos 133 ───
        val is133 = reason.contains("status=133") || reason.contains("GATT 133")
        if (is133) {
            val now = System.currentTimeMillis()
            gatt133Failures.add(now)
            // Limpiar fallos antiguos (>30s)
            gatt133Failures.removeAll { now - it > STACK_BUG_WINDOW_MS }
            
            if (gatt133Failures.size >= STACK_BUG_FAIL_THRESHOLD && !stackBrokenNotified) {
                stackBrokenNotified = true
                napLog("BLE_STACK_BROKEN", "DETECTADO: $STACK_BUG_FAIL_THRESHOLD fallos GATT 133 en ${STACK_BUG_WINDOW_MS/1000}s. Stack Bluetooth corrupto.", "ERROR")
                notifyListeners("onBluetoothStackBroken", JSObject().apply {
                    put("failCount", gatt133Failures.size)
                    put("windowSeconds", STACK_BUG_WINDOW_MS / 1000)
                    put("suggestion", "Reinicie Bluetooth desde Configuración > Bluetooth")
                    put("isAndroid14Bug", Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
                })
            }
        }
        
        // Emitir evento de fallo enriquecido para JS
        notifyListeners("onConnectionFailed", JSObject().apply {
            put("deviceId", deviceId)
            put("reason", reason)
            put("attempt", attempt)
            put("maxAttempts", MAX_RETRY_ATTEMPTS)
            put("isGATT133", is133)
            put("recoverable", attempt < MAX_RETRY_ATTEMPTS)
            put("suggestion", if (is133) "Reintentando con autoConnect=true..." else "Verifique que el dispositivo esté visible")
        })
        
        if (attempt < MAX_RETRY_ATTEMPTS) {
            val nextAttempt = attempt + 1
            val delay = RETRY_BASE_DELAY_MS * (1 shl attempt)
            retryAttempts[deviceId] = nextAttempt
            napLog("BLE_CONN_RETRY", "[CLIENT] Retry $nextAttempt para $deviceId en ${delay}ms (autoConnect=true). Razón: $reason")
            handler.postDelayed({
                val adapter = getBluetoothAdapter()
                val dev = adapter?.getRemoteDevice(deviceId)
                if (dev != null) {
                    val activity = activity
                    if (activity != null) {
                        activity.runOnUiThread {
                            executeConnect(dev, deviceId, nextAttempt)
                        }
                    } else {
                        executeConnect(dev, deviceId, nextAttempt)
                    }
                } else {
                    val pending = pendingCalls.remove("connect_$deviceId")
                    pending?.reject(ERR_NOT_CONNECTED, "No se pudo obtener dispositivo para retry: $deviceId")
                    retryAttempts.remove(deviceId)
                }
            }, delay)
        } else {
            retryAttempts.remove(deviceId)
            val pending = pendingCalls.remove("connect_$deviceId")
            pending?.reject(ERR_NOT_CONNECTED, "Conexión fallida para $deviceId después de $MAX_RETRY_ATTEMPTS intentos. Último error: $reason")
        }
    }

    private inner class ClientGattCallback(
        private val deviceId: String,
        private val attempt: Int
    ) : BluetoothGattCallback() {
        
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        napLog("BLE_CONN_WARN", "[CLIENT] STATE_CONNECTED pero status=$status (no success). Posible GATT 133.")
                    }
                    napLog(NAP_BLE_CONNECTED, "[CLIENT] GATT conectado: $deviceId (attempt=$attempt, status=$status). Delay 1.5s antes de discoverServices...")
                    
                    // ─── FIX v3.1.2: refresh cache INMEDIATAMENTE tras STATE_CONNECTED ───
                    refreshDeviceCache(gatt)
                    
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceId", deviceId)
                        put("name", try { gatt.device?.name } catch (e: SecurityException) { "Unknown" } ?: "Unknown")
                        put("direction", "outgoing")
                        put("servicesReady", false)
                        put("attempt", attempt)
                        put("gattStatus", status)
                    })
                    handler.postDelayed({
                        try {
                            gatt.discoverServices()
                        } catch (e: SecurityException) {
                            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "Error iniciando discoverServices: ${e.message}", "ERROR")
                            val pending = pendingCalls.remove("connect_$deviceId")
                            pending?.reject(ERR_NOT_CONNECTED, "SecurityException post-conexión: ${e.message}")
                            safeCloseGatt(gatt, deviceId)
                        }
                    }, SAMSUNG_DISCOVER_DELAY_MS)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    gattClients.remove(deviceId)
                    // ─── FIX v3.1.2: Completar cierre seguro tras STATE_DISCONNECTED ───
                    completeGattClose(deviceId)
                    notifyListeners("onDeviceDisconnected", JSObject().apply {
                        put("deviceId", deviceId)
                        put("gattStatus", status)
                    })
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        napLog("BLE_CONN_FAIL", "[CLIENT] Desconexión con error status=$status para $deviceId (attempt=$attempt)")
                        handleConnectFailure(deviceId, "Desconexión con status=$status", attempt)
                    } else {
                        val pending = pendingCalls.remove("connect_$deviceId")
                        pending?.reject(ERR_NOT_CONNECTED, "Conexión cerrada para $deviceId (status=$status)")
                    }
                }
            }
        }
        
        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            napLog("BLE_SERVICES_DISC", "[CLIENT] onServicesDiscovered status=$status para $deviceId")
            if (status == BluetoothGatt.GATT_SUCCESS) {
                val service = gatt.getService(SERVICE_UUID)
                val char = service?.getCharacteristic(CHAR_PAYLOAD)
                if (service != null && char != null) {
                    gattClients[deviceId] = gatt
                    retryAttempts.remove(deviceId)
                    connectTimeoutRunnables.remove(deviceId)?.let { handler.removeCallbacks(it) }
                    napLog(NAP_BLE_READY, "[CLIENT] Servicios NEXO validados para: $deviceId. gattClients AGREGADO.")
                    
                    try {
                        val notificationSet = gatt.setCharacteristicNotification(char, true)
                        napLog("BLE_NOTIFY_SET", "[CLIENT] setCharacteristicNotification result: $notificationSet")
                        
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
                            napLog("BLE_CCCD_WRITE", "[CLIENT] Escritura CCCD iniciada para notificaciones")
                        } else {
                            napLog("BLE_CCCD_MISSING", "[CLIENT] Descriptor CCCD no encontrado en característica", "WARN")
                        }
                    } catch (e: SecurityException) {
                        napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "[CLIENT] Error suscribiendo notificaciones: ${e.message}", "ERROR")
                    }
                    
                    val pending = pendingCalls.remove("connect_$deviceId")
                    pending?.resolve(JSObject().apply {
                        put("connected", true)
                        put("deviceId", deviceId)
                        put("servicesReady", true)
                        put("notificationsSubscribed", true)
                        put("attempt", attempt)
                    })
                    notifyListeners("onServicesReady", JSObject().apply {
                        put("deviceId", deviceId)
                        put("ready", true)
                    })
                } else {
                    napLog(NAP_BLE_ERR_INIT_FAILED, "[CLIENT] Servicio NEXO no encontrado en: $deviceId. UUIDs encontrados: ${gatt.services.map { it.uuid }}", "ERROR")
                    safeCloseGatt(gatt, deviceId)
                    handleConnectFailure(deviceId, "Servicio NEXO no encontrado", attempt)
                }
            } else {
                napLog(NAP_BLE_ERR_CONNECTION_FAILED, "[CLIENT] Descubrimiento falló status=$status para: $deviceId", "ERROR")
                safeCloseGatt(gatt, deviceId)
                handleConnectFailure(deviceId, "Descubrimiento falló status=$status", attempt)
            }
            notifyListeners("onServicesDiscovered", JSObject().apply {
                put("deviceId", deviceId)
                put("status", status)
            })
        }
        
        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            val addr = gatt.device?.address ?: "unknown"
            napLog("BLE_DESC_WRITE", "[CLIENT] onDescriptorWrite addr=$addr status=$status uuid=${descriptor.uuid}")
            if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == CCCD_UUID) {
                napLog(NAP_BLE_NOTIFICATION_CONFIRMED, "[CLIENT] Notificaciones activadas confirmadas para $addr")
                notifyListeners("onNotificationsEnabled", JSObject().apply {
                    put("deviceId", addr)
                    put("enabled", true)
                })
            }
        }
        
        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            val addr = gatt.device?.address ?: "unknown"
            napLog("BLE_CHAR_WRITE_CB", "[CLIENT] onCharacteristicWrite addr=$addr status=$status uuid=${characteristic.uuid}")
            val pending = pendingCalls.remove("write_$addr")
            if (status == BluetoothGatt.GATT_SUCCESS) {
                napLog(NAP_BLE_MESSAGE_SENT, "[CLIENT] onCharacteristicWrite SUCCESS para $addr")
                pending?.resolve(JSObject().apply {
                    put("sent", true)
                    put("bytes", characteristic.value?.size ?: 0)
                    put("confirmed", true)
                })
            } else {
                napLog("BLE_SEND_FAIL", "[CLIENT] onCharacteristicWrite FAILED status=$status para $addr")
                gattClients.remove(addr)
                safeCloseGatt(gatt, addr)
                pending?.reject(ERR_NOT_CONNECTED, "Escritura falló (status=$status). GATT cerrado. Reconecte.")
            }
        }
        
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val addr = gatt.device?.address ?: "unknown"
            val data = characteristic.value
            napLog("BLE_CHAR_CHANGED", "[CLIENT] Notificación recibida de $addr uuid=${characteristic.uuid} bytes=${data?.size ?: 0}")
            when (characteristic.uuid) {
                CHAR_PAYLOAD -> {
                    notifyListeners("onPayloadReceived", JSObject().apply {
                        put("deviceId", addr)
                        put("data", data?.let { String(it) } ?: "")
                        put("source", "client_notification")
                    })
                }
                CHAR_ANNOUNCE -> {
                    notifyListeners("onAnnouncementReceived", JSObject().apply {
                        put("deviceId", addr)
                        put("data", data?.let { String(it) } ?: "")
                    })
                }
            }
        }
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        if (deviceId == null) {
            call.reject(ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }
        gattClients.remove(deviceId)?.let { gatt ->
            safeCloseGatt(gatt, deviceId)
        }
        serverConnections.remove(deviceId)
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
        val payload = message?.toByteArray() ?: android.util.Base64.decode(data, android.util.Base64.DEFAULT)
        if (payload.size > CHUNK_SIZE * 10) {
            call.reject(ERR_MESSAGE_TOO_LARGE, "Mensaje excede tamaño máximo permitido")
            return
        }
        
        napLog("BLE_SEND_LOOKUP", "[SEND] Buscando GATT para deviceId=$deviceId | gattClients keys=${gattClients.keys} | serverConnections=${serverConnections.keys}")
        
        val gatt = gattClients[deviceId]
        if (gatt != null) {
            performWrite(call, gatt, deviceId, payload)
            return
        }
        
        if (serverConnections.containsKey(deviceId)) {
            napLog("BLE_SEND_SERVER", "[SEND] Enviando vía SERVER notify a $deviceId")
            val success = notifyClient(deviceId, payload)
            if (success) {
                call.resolve(JSObject().apply {
                    put("sent", true)
                    put("bytes", payload.size)
                    put("via", "server_notification")
                })
                napLog(NAP_BLE_MESSAGE_SENT, "[SEND] Notificación servidor enviada a $deviceId")
                return
            } else {
                napLog("BLE_SEND_SERVER_FAIL", "[SEND] notifyClient falló para $deviceId", "WARN")
            }
        }
        
        napLog(ERR_NOT_CONNECTED, "[SEND] RECHAZADO: deviceId=$deviceId NO está en gattClients ni serverConnections")
        call.reject(ERR_NOT_CONNECTED, "No conectado a dispositivo. Ni como cliente ni como servidor.")
    }
    
    private fun notifyClient(deviceId: String, data: ByteArray): Boolean {
        val device = serverConnections[deviceId]
        if (device == null) {
            napLog("BLE_NOTIFY_NO_DEV", "[SERVER] Dispositivo $deviceId no está en serverConnections", "WARN")
            return false
        }
        val service = gattServer?.getService(SERVICE_UUID)
        if (service == null) {
            napLog("BLE_NOTIFY_NO_SVC", "[SERVER] GATT Server no tiene servicio NEXO", "WARN")
            return false
        }
        val char = service.getCharacteristic(CHAR_PAYLOAD)
        if (char == null) {
            napLog("BLE_NOTIFY_NO_CHAR", "[SERVER] Característica PAYLOAD no encontrada", "WARN")
            return false
        }
        
        return try {
            char.value = data
            val result = gattServer?.notifyCharacteristicChanged(device, char, false) ?: false
            if (result) {
                napLog(NAP_BLE_MESSAGE_SENT, "[SERVER] Notificación enviada a $deviceId (${data.size} bytes)")
            } else {
                napLog("BLE_NOTIFY_FAIL", "[SERVER] notifyCharacteristicChanged retornó false para $deviceId", "WARN")
            }
            result
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "[SERVER] SecurityException notificando: ${e.message}", "ERROR")
            false
        }
    }

    private fun performWrite(call: PluginCall, gatt: BluetoothGatt, deviceId: String, payload: ByteArray) {
        try {
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(CHAR_PAYLOAD)
            if (char == null) {
                napLog("BLE_SEND_NOCHAR", "[SEND] Característica PAYLOAD no disponible para $deviceId. UUIDs en servicios: ${gatt.services.map { it.uuid }}")
                call.reject(ERR_NOT_CONNECTED, "Característica PAYLOAD no disponible tras descubrimiento")
                return
            }
            pendingCalls["write_$deviceId"] = call
            handler.postDelayed({
                val pending = pendingCalls.remove("write_$deviceId")
                if (pending != null) {
                    napLog("BLE_SEND_TIMEOUT", "[SEND] Timeout esperando onCharacteristicWrite para $deviceId")
                    pending.reject(ERR_NOT_CONNECTED, "Timeout esperando confirmación de escritura")
                }
            }, 5000)
            
            if (payload.size <= CHUNK_SIZE) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gatt.writeCharacteristic(char, payload, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                } else {
                    @Suppress("DEPRECATION")
                    char.value = payload
                    @Suppress("DEPRECATION")
                    gatt.writeCharacteristic(char)
                }
                napLog("BLE_SEND_WRITE", "[SEND] writeCharacteristic llamado (${payload.size} bytes) a $deviceId con WRITE_TYPE_DEFAULT")
            } else {
                val chunks = payload.toList().chunked(CHUNK_SIZE)
                chunks.forEachIndexed { index, chunk ->
                    handler.postDelayed({
                        try {
                            val currentService = gatt.getService(SERVICE_UUID)
                            val currentChar = currentService?.getCharacteristic(CHAR_PAYLOAD)
                            if (currentChar != null) {
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                    gatt.writeCharacteristic(currentChar, chunk.toByteArray(), BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                                } else {
                                    @Suppress("DEPRECATION")
                                    currentChar.value = chunk.toByteArray()
                                    @Suppress("DEPRECATION")
                                    gatt.writeCharacteristic(currentChar)
                                }
                            }
                        } catch (e: SecurityException) {
                            Log.w(TAG, "SecurityException en chunk $index: ${e.message}")
                        }
                    }, (index * 50).toLong())
                }
                pendingCalls.remove("write_$deviceId")
                call.resolve(JSObject().apply {
                    put("sent", true)
                    put("bytes", payload.size)
                    put("chunks", chunks.size)
                    put("chunked", true)
                })
                napLog(NAP_BLE_MESSAGE_SENT, "[SEND] Mensaje chunk enviado (${payload.size} bytes)")
            }
        } catch (e: SecurityException) {
            pendingCalls.remove("write_$deviceId")
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException enviando mensaje: ${e.message}")
        }
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val devices = JSArray()
        gattClients.keys.forEach { address ->
            val obj = JSObject()
            obj.put("deviceId", address)
            obj.put("name", "NEXO Peer (Client)")
            obj.put("direction", "outgoing")
            obj.put("servicesReady", true)
            devices.put(obj)
        }
        serverConnections.forEach { (address, device) ->
            try {
                val obj = JSObject()
                obj.put("deviceId", address)
                obj.put("name", device.name ?: "Unknown")
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
            result.put("isMultipleAdvertisementSupported", adapter?.isMultipleAdvertisementSupported ?: false)
            call.resolve(result)
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "Error obteniendo info del dispositivo")
        }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        napLog(NAP_BLE_ADVERTISE_STARTED, "startAdvertising() llamado - delegando a startAdvertise()")
        startAdvertise(call)
    }
    
    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        napLog("BLE_AD_STOP", "stopAdvertising() llamado - delegando a stopAdvertise()")
        stopAdvertise(call)
    }
    
    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val result = JSObject()
        result.put("isAdvertising", advertisingActive)
        result.put("timestamp", System.currentTimeMillis())
        result.put("nap_code", if (advertisingActive) "ADVERTISING_ACTIVE" else "ADVERTISING_INACTIVE")
        call.resolve(result)
    }
}
