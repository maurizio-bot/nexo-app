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
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.nexo.ble.model.NexoGattService
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

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
        
        // NAP v2.3 - Códigos de Inicialización (1-7)
        const val NAP_BLE_INIT_001 = "BLE_INIT_001" // [1/7] Verificando permisos
        const val NAP_BLE_INIT_002 = "BLE_INIT_002" // [2/7] Permisos concedidos
        const val NAP_BLE_INIT_003 = "BLE_INIT_003" // [3/7] Inicializando adapter
        const val NAP_BLE_INIT_004 = "BLE_INIT_004" // [4/7] Verificando estado BT
        const val NAP_BLE_INIT_005 = "BLE_INIT_005" // [5/7] Solicitando activación BT
        const val NAP_BLE_INIT_006 = "BLE_INIT_006" // [6/7] Setup GATT Server
        const val NAP_BLE_INIT_007 = "BLE_INIT_007" // [7/7] BLE Ready
        
        // NAP - Éxito (050-099)
        const val NAP_BLE_READY = "BLE_050"
        const val NAP_BLE_CONNECTED = "BLE_051"
        const val NAP_BLE_SCAN_STARTED = "BLE_052"
        const val NAP_BLE_ADVERTISE_STARTED = "BLE_053"
        const val NAP_BLE_MESSAGE_SENT = "BLE_054"
        const val NAP_BLE_RECOVERY_SUCCESS = "BLE_055"
        const val NAP_BLE_PERMISSIONS_GRANTED = "BLE_056"
        
        // NAP - Warnings/Waiting (100-199)
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
        
        // NAP - Errores Críticos (200-299)
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
        
        // Legacy
        const val ERR_INVALID_PARAMS = "BLE_019"
        const val ERR_NOT_CONNECTED = "BLE_011"
        const val ERR_MESSAGE_TOO_LARGE = "BLE_008"
        const val ERR_DEVICE_NOT_FOUND = "BLE_006"
        
        const val MTU_DEFAULT = 512
        const val CHUNK_SIZE = 507
        const val REQUEST_ENABLE_BT = 1001
        
        // Edge Case Thresholds
        const val THERMAL_THRESHOLD_C = 42.0f
        const val BATTERY_LOW_THRESHOLD = 20
        const val MAX_RETRY_ATTEMPTS = 3
        const val CONCURRENT_INIT_LOCK_TIMEOUT = 10000L
        const val THERMAL_COOLDOWN_MS = 30000L
        
        val SERVICE_UUID = NexoGattService.SERVICE_UUID
        val CHAR_ANNOUNCE = NexoGattService.ANNOUNCE_CHAR_UUID
        val CHAR_HANDSHAKE = NexoGattService.HANDSHAKE_CHAR_UUID
        val CHAR_PAYLOAD = NexoGattService.PAYLOAD_CHAR_UUID
        val CHAR_CONTROL = NexoGattService.CONTROL_CHAR_UUID
    }

    // State Management
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var gattServer: BluetoothGattServer? = null
    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val connectedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val pendingChunks = ConcurrentHashMap<String, MutableMap<Int, ByteArray>>()
    private val messageBuffers = ConcurrentHashMap<String, ByteArrayOutputStream>()
    private var isAdvertising = false
    private var isScanning = false
    private var advertiseCallback: AdvertiseCallback? = null
    private var scanCallback: ScanCallback? = null
    private val handler = Handler(Looper.getMainLooper())
    private var userId: String = ""
    private val connectionCounter = AtomicInteger(0)
    private val pendingCalls = ConcurrentHashMap<String, PluginCall>()
    
    // Edge Case State Trackers
    private val isInitializing = AtomicBoolean(false)
    private val initLock = Object()
    private var lastInitAttempt = 0L
    private var thermalCooldownActive = false
    private var retryCount = 0
    private var lastKnownPermissionState = true
    
    // Cache de estado para recovery rápido
    private var cachedDeviceState: JSObject? = null
    
    // Tracking para requestPermissions()
    private var pendingPermissionAliases = mutableListOf<String>()
    private var currentPermissionIndex = 0
    // FIX v2.4-RC5: Tracking de éxito para evitar race condition
    private var permissionCallbacksSuccess = mutableMapOf<String, Boolean>()
    private var permissionTimeoutRunnable: Runnable? = null

    // NAP Logger unificado
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
            NAP_BLE_THERMAL_THROTTLE -> "Espere 30 segundos para enfriamiento o mueva el dispositivo a zona ventilada"
            NAP_BLE_ERR_AIRPLANE_MODE -> "Desactive Modo Avión desde el panel de notificaciones"
            NAP_BLE_ERR_DISABLED -> "Active Bluetooth desde Configuración o el panel rápido"
            NAP_BLE_LOW_BATTERY -> "Conecte el cargador o cierre otras apps para ahorrar energía"
            NAP_BLE_DOZE_MODE -> "Desbloquee el dispositivo para salir de Doze Mode"
            NAP_BLE_CONCURRENT_INIT -> "Espere a que termine la inicialización en curso"
            else -> "Contacte soporte si el problema persiste"
        }
    }

    // Monitoreo de estado del sistema
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
        } else {
            false
        }
    }
    
    private fun isAirplaneMode(): Boolean {
        return try {
            Settings.Global.getInt(context.contentResolver, Settings.Global.AIRPLANE_MODE_ON) != 0
        } catch (e: Exception) { false }
    }

    // Validación de salud del sistema antes de operaciones críticas
    private fun validateSystemHealth(call: PluginCall?, operation: String): Boolean {
        // 1. Check Thermal
        if (getBatteryTemp() > THERMAL_THRESHOLD_C) {
            thermalCooldownActive = true
            napError(call, NAP_BLE_ERR_THERMAL_SHUTDOWN, 
                "Temperatura crítica: ${getBatteryTemp()}°C. Operación $operation bloqueada por seguridad.", 
                "ERROR", recoverable = true)
            
            handler.postDelayed({
                thermalCooldownActive = false
                napLog(NAP_BLE_RECOVERY_SUCCESS, "Cooldown completado, operaciones BLE reanudadas")
            }, THERMAL_COOLDOWN_MS)
            
            return false
        }
        
        // 2. Check Battery
        if (getBatteryLevel() < BATTERY_LOW_THRESHOLD && operation != "initialize") {
            napLog(NAP_BLE_LOW_BATTERY, "Batería baja (${getBatteryLevel()}%), rendimiento BLE puede degradarse", "WARN")
        }
        
        // 3. Check Doze Mode
        if (isDozeMode() && operation in listOf("scan", "advertise")) {
            napError(call, NAP_BLE_DOZE_MODE, 
                "Dispositivo en Doze Mode. $operation requiere desbloqueo o whitelist de batería.", 
                "WARN", recoverable = true)
            return false
        }
        
        // 4. Check Airplane Mode
        if (isAirplaneMode()) {
            napError(call, NAP_BLE_ERR_AIRPLANE_MODE, 
                "Modo Avión activado. Desactívelo para usar $operation.", 
                "ERROR", recoverable = true)
            return false
        }
        
        // 5. Check Permission Revocation (Hot)
        if (!canAccessBluetooth()) {
            if (lastKnownPermissionState) {
                lastKnownPermissionState = false
                napError(call, NAP_BLE_PERMISSION_REVOKED, 
                    "Permisos Bluetooth revocados en tiempo de ejecución. Reinicio requerido.", 
                    "ERROR", recoverable = true)
            } else {
                napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permisos no disponibles", "ERROR")
            }
            return false
        } else {
            lastKnownPermissionState = true
        }
        
        return true
    }

    override fun load() {
        napLog("BLE_LOAD", "NAP-BLE v2.4-RC5 PRODUCTION loaded")
        
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
                                        napLog(NAP_BLE_RECOVERY_SUCCESS, "BT reactivado automáticamente, continuando init")
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
                    
                    napLog("BLE_STATE_CHANGE", "BT State: $stateName ($state)")
                    notifyListeners("onBluetoothStateChanged", JSObject().apply {
                        put("state", stateName)
                        put("stateCode", state)
                        put("thermal", getThermalState())
                    })
                }
                
                Intent.ACTION_BATTERY_CHANGED -> {
                    val level = getBatteryLevel()
                    val temp = getBatteryTemp()
                    
                    if (temp > THERMAL_THRESHOLD_C && !thermalCooldownActive) {
                        napLog(NAP_BLE_THERMAL_THROTTLE, "Throttling activado por temperatura: ${temp}°C", "WARN")
                        thermalCooldownActive = true
                    }
                }
                
                Intent.ACTION_AIRPLANE_MODE_CHANGED -> {
                    if (isAirplaneMode()) {
                        napLog(NAP_BLE_ERR_AIRPLANE_MODE, "Modo Avión detectado - todas las operaciones BLE pausadas", "ERROR")
                        stopAllOperations()
                    }
                }
            }
        }
    }

    // Manejo de concurrencia estricto
    private fun acquireInitLock(): Boolean {
        synchronized(initLock) {
            val now = System.currentTimeMillis()
            
            if (isInitializing.get() && (now - lastInitAttempt) > CONCURRENT_INIT_LOCK_TIMEOUT) {
                napLog(NAP_BLE_CONCURRENT_INIT, "Deadlock detectado, liberando lock forzado", "WARN")
                isInitializing.set(false)
            }
            
            if (isInitializing.get()) {
                return false
            }
            
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
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) == 
                PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH) == 
                PackageManager.PERMISSION_GRANTED
        }
    }

    private fun initializeAdapter(): Boolean {
        if (!canAccessBluetooth()) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "BLUETOOTH_CONNECT permission not granted", "ERROR")
            return false
        }

        try {
            if (bluetoothManager == null) {
                bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            }
            bluetoothAdapter = bluetoothManager?.adapter
            
            if (bluetoothAdapter == null) {
                napLog(NAP_BLE_ERR_NOT_SUPPORTED, "Device does not support Bluetooth", "ERROR")
                return false
            }
            return true
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException: ${e.message}", "ERROR")
            return false
        }
    }

    // ============================================================
    // [FIX v2.4-RC5] PERMISSION BRIDGE PRODUCTION
    // Cambios críticos: 
    // 1. Tracking de éxito por callback para evitar race condition
    // 2. Verificación final basada en tracking, no en hasRequiredPermissions()
    // 3. Limpieza correcta de timeout
    // ============================================================
    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        napLog(NAP_BLE_INIT_001, "[1/3] Solicitud explícita de permisos BLE iniciada desde UI")
        
        // Reset estado
        pendingPermissionAliases.clear()
        currentPermissionIndex = 0
        permissionCallbacksSuccess.clear()
        permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!hasPermission("bluetoothConnect")) pendingPermissionAliases.add("bluetoothConnect")
            if (!hasPermission("bluetoothScan")) pendingPermissionAliases.add("bluetoothScan")
            if (!hasPermission("bluetoothAdvertise")) pendingPermissionAliases.add("bluetoothAdvertise")
        } else {
            if (!hasPermission("location")) pendingPermissionAliases.add("location")
        }
        
        if (pendingPermissionAliases.isEmpty()) {
            napLog(NAP_BLE_PERMISSIONS_GRANTED, "[2/3] Todos los permisos ya concedidos previamente")
            val result = buildPermissionsResult()
            result.put("alreadyGranted", true)
            call.resolve(result)
            return
        }
        
        napLog(NAP_BLE_WAITING_PERMISSIONS, "[2/3] Solicitando ${pendingPermissionAliases.size} permiso(s): $pendingPermissionAliases")
        
        // Timeout de seguridad - 30 segundos
        permissionTimeoutRunnable = Runnable {
            if (!call.isReleased && !call.isSaved) {
                napLog(NAP_BLE_PARTIAL_PERMISSIONS, "TIMEOUT: El usuario no respondió a los diálogos de permisos", "WARN")
                val errorData = JSObject()
                errorData.put("timeout", true)
                errorData.put("message", "Tiempo de espera agotado para permisos")
                call.reject(NAP_BLE_PARTIAL_PERMISSIONS, "Permisos timeout", errorData)
                pendingPermissionAliases.clear()
            }
        }
        handler.postDelayed(permissionTimeoutRunnable!!, 30000)
        
        saveCall(call)
        requestNextPermission(call)
    }
    
    @PermissionCallback
    private fun requestPermissionsCallback(call: PluginCall) {
        try {
            val currentAlias = pendingPermissionAliases.getOrNull(currentPermissionIndex)
            
            if (currentAlias != null) {
                val granted = hasPermission(currentAlias)
                napLog("BLE_PERM_RESULT", "Callback ejecutado - Permiso $currentAlias: ${if (granted) "CONCEDIDO" else "DENEGADO"}")
                
                // FIX RC5: Trackear éxito/fracaso de cada callback
                permissionCallbacksSuccess[currentAlias] = granted
                
                if (!granted) {
                    napLog(NAP_BLE_PARTIAL_PERMISSIONS, "Permiso $currentAlias denegado, abortando secuencia")
                    permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
                    reportFinalPermissionsResult(call, forcedDenial = true)
                    return
                }
            } else {
                napLog("BLE_PERM_WARN", "Callback llamado pero currentAlias es null (índice: $currentPermissionIndex)", "WARN")
            }
            
            currentPermissionIndex++
            
            if (currentPermissionIndex < pendingPermissionAliases.size) {
                requestNextPermission(call)
            } else {
                permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
                reportFinalPermissionsResult(call, forcedDenial = false)
            }
        } catch (e: Exception) {
            napLog("BLE_PERM_ERR", "Excepción en callback: ${e.message}", "ERROR")
            permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
            
            val errorData = JSObject()
            errorData.put("exception", e.message)
            call.reject(NAP_BLE_ERR_INIT_FAILED, "Error en callback de permisos", errorData)
        }
    }
    
    private fun requestNextPermission(call: PluginCall) {
        val alias = pendingPermissionAliases.getOrNull(currentPermissionIndex)
        if (alias != null) {
            napLog(NAP_BLE_INIT_001, "Solicitando permiso [${currentPermissionIndex + 1}/${pendingPermissionAliases.size}]: $alias")
            requestPermissionForAlias(alias, call, "requestPermissionsCallback")
        } else {
            napLog("BLE_PERM_ERR", "Alias null en índice $currentPermissionIndex", "ERROR")
            permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
            reportFinalPermissionsResult(call, forcedDenial = true)
        }
    }
    
    // FIX v2.4-RC5: Usar tracking de callbacks en lugar de hasRequiredPermissions()
    // para evitar race condition donde Android no actualiza estado inmediatamente
    private fun reportFinalPermissionsResult(call: PluginCall, forcedDenial: Boolean = false) {
        // Si no hay denegación forzada y procesamos todos los aliases,
        // verificar si todos los callbacks reportaron éxito
        val allGranted = if (forcedDenial) {
            false
        } else {
            // Verificar tracking de callbacks
            val allCallbacksSuccessful = pendingPermissionAliases.all { alias ->
                permissionCallbacksSuccess[alias] == true
            }
            
            // Fallback: si el tracking está vacío (caso edge), usar verificación OS
            if (permissionCallbacksSuccess.isEmpty()) {
                hasRequiredPermissions()
            } else {
                allCallbacksSuccessful
            }
        }
        
        val result = buildPermissionsResult()
        
        if (allGranted) {
            napLog(NAP_BLE_PERMISSIONS_GRANTED, "[3/3] Todos los permisos BLE concedidos correctamente")
            notifyListeners("onPermissionsGranted", JSObject().apply {
                put("allGranted", true)
                put("platform", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "android12+" else "legacy")
            })
            call.resolve(result)
        } else {
            napLog(NAP_BLE_PARTIAL_PERMISSIONS, "[3/3] Algunos permisos fueron denegados o timeout")
            val errorData = JSObject()
            errorData.put("permissions", result.getJSObject("permissions"))
            errorData.put("allGranted", false)
            errorData.put("message", "Se requieren todos los permisos para funcionalidad BLE completa")
            errorData.put("napCode", NAP_BLE_PARTIAL_PERMISSIONS)
            call.reject(NAP_BLE_PARTIAL_PERMISSIONS, "Permisos incompletos", errorData)
        }
    }
    
    private fun buildPermissionsResult(): JSObject {
        val result = JSObject()
        val permissions = JSObject()
        val allGranted: Boolean
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.put("bluetoothConnect", hasPermission("bluetoothConnect"))
            permissions.put("bluetoothScan", hasPermission("bluetoothScan"))
            permissions.put("bluetoothAdvertise", hasPermission("bluetoothAdvertise"))
            allGranted = hasPermission("bluetoothConnect") && hasPermission("bluetoothScan") && hasPermission("bluetoothAdvertise")
        } else {
            permissions.put("location", hasPermission("location"))
            allGranted = hasPermission("location")
        }
        
        result.put("permissions", permissions)
        result.put("allGranted", allGranted)
        result.put("androidVersion", Build.VERSION.SDK_INT)
        result.put("isAndroid12OrHigher", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        
        return result
    }

    // ============================================================
    // [FIX v2.4-RC5] isBluetoothEnabled - Detección robusta de estado
    // Incluye detección de denegación permanente
    // ============================================================
    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        // FIX: Si no podemos acceder al Bluetooth, reportar estado adecuado
        if (!canAccessBluetooth()) {
            val result = JSObject()
            result.put("enabled", false)
            result.put("state", BluetoothAdapter.STATE_OFF)
            result.put("stateName", "NO_PERMISSION")
            result.put("isPermanentlyDenied", isPermanentlyDenied())
            result.put("error", "Permission not granted")
            call.resolve(result)
            return
        }
        
        if (!validateSystemHealth(call, "status_check")) return
        
        reportBluetoothState(call)
    }

    // FIX v2.4-RC5: Detección de denegación permanente usando shouldShowRequestPermissionRationale
    private fun isPermanentlyDenied(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            !hasPermission("bluetoothConnect") && 
            !activity.shouldShowRequestPermissionRationale(android.Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            !hasPermission("location") && 
            !activity.shouldShowRequestPermissionRationale(android.Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    private fun reportBluetoothState(call: PluginCall) {
        if (!initializeAdapter()) {
            val result = JSObject()
            result.put("enabled", false)
            result.put("state", BluetoothAdapter.STATE_OFF)
            result.put("stateName", if (!canAccessBluetooth()) "NO_PERMISSION" else "NOT_SUPPORTED")
            result.put("isPermanentlyDenied", isPermanentlyDenied())
            result.put("error", "Permission or support issue")
            result.put("health", getSystemHealthReport())
            call.resolve(result)
            return
        }
        
        val adapter = bluetoothAdapter
        val state = try {
            adapter?.state ?: BluetoothAdapter.STATE_OFF
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "Cannot read BT state", "ERROR")
            BluetoothAdapter.STATE_OFF
        }
        
        val result = JSObject()
        result.put("enabled", adapter?.isEnabled == true)
        result.put("state", state)
        result.put("stateName", when(state) {
            BluetoothAdapter.STATE_OFF -> "OFF"
            BluetoothAdapter.STATE_ON -> "ON"
            BluetoothAdapter.STATE_TURNING_ON -> "TURNING_ON"
            BluetoothAdapter.STATE_TURNING_OFF -> "TURNING_OFF"
            else -> "UNKNOWN"
        })
        result.put("isPermanentlyDenied", isPermanentlyDenied())
        result.put("health", getSystemHealthReport())
        
        napLog("BLE_STATE_REPORT", "BT State reported: ${adapter?.isEnabled}, isPermanentlyDenied: ${isPermanentlyDenied()}")
        call.resolve(result)
    }
    
    private fun getSystemHealthReport(): JSObject {
        return JSObject().apply {
            put("thermalState", getThermalState())
            put("batteryLevel", getBatteryLevel())
            put("batteryTemp", getBatteryTemp())
            put("isDozeMode", isDozeMode())
            put("isAirplaneMode", isAirplaneMode())
            put("thermalCooldownActive", thermalCooldownActive)
            put("canAccessBluetooth", canAccessBluetooth())
        }
    }

    @PluginMethod
    fun initialize(call: PluginCall) {
        userId = call.getString("userId") ?: generateUserId()
        
        if (!acquireInitLock()) {
            val timeWaiting = System.currentTimeMillis() - lastInitAttempt
            napError(call, NAP_BLE_CONCURRENT_INIT, 
                "Inicialización ya en progreso (esperando ${timeWaiting}ms). Use reintentar después.", 
                "WARN", recoverable = true)
            return
        }
        
        try {
            if (!validateSystemHealth(call, "initialize")) {
                releaseInitLock()
                return
            }
            
            cachedDeviceState = JSObject().apply {
                put("timestamp", System.currentTimeMillis())
                put("battery", getBatteryLevel())
                put("temp", getBatteryTemp())
            }
            
            if (bluetoothAdapter?.isEnabled == true && gattServer != null) {
                napLog(NAP_BLE_ALREADY_INITIALIZED, "BLE ya inicializado, retornando estado actual", "WARN")
                val result = JSObject()
                result.put("userId", userId)
                result.put("status", "already_initialized")
                result.put("version", "2.4-NAP-RC5")
                result.put("native", true)
                result.put("health", getSystemHealthReport())
                call.resolve(result)
                return
            }
            
            napLog(NAP_BLE_INIT_001, "[1/7] Verificando permisos Bluetooth (Android 14)...")
            
            if (!hasRequiredPermissions()) {
                napLog(NAP_BLE_WAITING_PERMISSIONS, "Permisos pendientes, iniciando secuencia de solicitud...")
                pendingCalls["init"] = call
                checkAndRequestPermissions(call, "initializePermissionCallback")
                return
            }
            
            napLog(NAP_BLE_INIT_002, "[2/7] Permisos BLE concedidos")
            performInitialization(call)
            
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_INIT_FAILED, "Excepción inesperada: ${e.message}", "ERROR")
            releaseInitLock()
        }
    }

    @PermissionCallback
    private fun initializePermissionCallback(call: PluginCall) {
        if (hasRequiredPermissions()) {
            napLog(NAP_BLE_INIT_002, "[2/7] Permisos concedidos vía callback")
            performInitialization(call)
        } else {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permisos Bluetooth requeridos rechazados")
            pendingCalls.remove("init")
            releaseInitLock()
        }
    }

    private fun performInitialization(call: PluginCall) {
        try {
            napLog(NAP_BLE_INIT_003, "[3/7] Inicializando BluetoothAdapter...")
            
            if (!initializeAdapter()) {
                napError(call, NAP_BLE_ERR_NOT_SUPPORTED, "No se puede acceder al BluetoothAdapter")
                pendingCalls.remove("init")
                releaseInitLock()
                return
            }
            
            val adapter = bluetoothAdapter
            if (adapter == null) {
                napError(call, NAP_BLE_ERR_NOT_SUPPORTED, "Dispositivo no soporta Bluetooth")
                pendingCalls.remove("init")
                releaseInitLock()
                return
            }
            
            val currentState = try {
                adapter.state
            } catch (e: SecurityException) {
                napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException reading state", "ERROR")
                BluetoothAdapter.STATE_OFF
            }
            
            napLog(NAP_BLE_INIT_004, "[4/7] Estado BT: $currentState")
            
            when (currentState) {
                BluetoothAdapter.STATE_ON -> {
                    setupGattServerAndComplete(call)
                }
                
                BluetoothAdapter.STATE_OFF -> {
                    napLog(NAP_BLE_INIT_005, "[5/7] BT apagado, solicitando activación al usuario...")
                    pendingCalls["init"] = call
                    requestBluetoothActivation(call)
                }
                
                BluetoothAdapter.STATE_TURNING_ON -> {
                    napLog(NAP_BLE_WAITING_BT_ON, "Esperando a que BT termine de encenderse...")
                    pendingCalls["init"] = call
                    handler.postDelayed({
                        if (!isInitializing.get() && pendingCalls.containsKey("init")) {
                            napLog(NAP_BLE_RETRY_ATTEMPT, "Reintentando después de espera TURNING_ON")
                            performInitialization(call)
                        }
                    }, 1000)
                }
                
                BluetoothAdapter.STATE_TURNING_OFF -> {
                    napError(call, NAP_BLE_ERR_DISABLED, "Bluetooth está apagándose, no se puede inicializar ahora", recoverable = true)
                    pendingCalls.remove("init")
                    releaseInitLock()
                }
                
                else -> {
                    napError(call, NAP_BLE_ERR_INIT_FAILED, "Estado BT desconocido: $currentState")
                    pendingCalls.remove("init")
                    releaseInitLock()
                }
            }
        } catch (e: OutOfMemoryError) {
            napError(call, NAP_BLE_ERR_MEMORY_PRESSURE, "Memoria insuficiente para inicializar BLE", "ERROR")
            pendingCalls.remove("init")
            releaseInitLock()
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_INIT_FAILED, "Error crítico: ${e.message}", "ERROR")
            pendingCalls.remove("init")
            releaseInitLock()
        }
    }

    private fun setupGattServerAndComplete(call: PluginCall) {
        try {
            napLog(NAP_BLE_INIT_006, "[6/7] Configurando GATT Server...")
            setupGattServer()
            
            napLog(NAP_BLE_INIT_007, "[7/7] BLE Native Layer inicializado completamente")
            napLog(NAP_BLE_READY, "🚀 NAP-BLE RC5 Ready [Native:true]")
            
            val result = JSObject()
            result.put("userId", userId)
            result.put("status", "initialized")
            result.put("version", "2.4-NAP-RC5")
            result.put("bluetoothState", BluetoothAdapter.STATE_ON)
            result.put("native", true)
            result.put("napProtocol", "v2.4")
            result.put("health", getSystemHealthReport())
            call.resolve(result)
            
            retryCount = 0
            pendingCalls.remove("init")
            releaseInitLock()
            
        } catch (e: IllegalStateException) {
            if (retryCount < MAX_RETRY_ATTEMPTS) {
                retryCount++
                napLog(NAP_BLE_ERR_GATT_CONFLICT, "Conflicto GATT detectado, reintento $retryCount/$MAX_RETRY_ATTEMPTS en 2s...", "WARN")
                handler.postDelayed({
                    setupGattServerAndComplete(call)
                }, 2000)
            } else {
                napError(call, NAP_BLE_ERR_GATT_CONFLICT, 
                    "Conflicto persistente con otro servicio BLE. Cierre otras apps y reintente.", 
                    "ERROR", recoverable = true)
                pendingCalls.remove("init")
                releaseInitLock()
            }
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_INIT_FAILED, "Error en setup GATT: ${e.message}")
            pendingCalls.remove("init")
            releaseInitLock()
        }
    }

    private fun requestBluetoothActivation(call: PluginCall) {
        val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
        try {
            saveCall(call)
            startActivityForResult(call, enableBtIntent, REQUEST_ENABLE_BT)
            napLog("BLE_ACT_REQUEST", "Diálogo de activación BT presentado")
        } catch (e: Exception) {
            bridge?.releaseCall(call)
            pendingCalls.remove("init")
            napError(call, NAP_BLE_ERR_DISABLED, "No se pudo solicitar activación BT: ${e.message}")
            releaseInitLock()
        }
    }

    override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.handleOnActivityResult(requestCode, resultCode, data)
        
        if (requestCode == REQUEST_ENABLE_BT) {
            val call = savedLastCall ?: pendingCalls["init"]
            
            if (resultCode == Activity.RESULT_OK) {
                napLog(NAP_BLE_INIT_005, "Usuario activó BT vía diálogo sistema")
                handler.postDelayed({
                    call?.let { setupGattServerAndComplete(it) }
                }, 600)
            } else {
                napLog(NAP_BLE_ERR_DISABLED, "Usuario rechazó activar Bluetooth (code: $resultCode)", "WARN")
                call?.reject(NAP_BLE_ERR_DISABLED, "Bluetooth activation denied")
                bridge?.releaseCall(call)
                pendingCalls.remove("init")
                releaseInitLock()
            }
        }
    }

    private fun checkAndRequestPermissions(call: PluginCall, callback: String): Boolean {
        if (hasRequiredPermissions()) return true
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            when {
                !hasPermission("bluetoothConnect") -> {
                    napLog(NAP_BLE_INIT_001, "Solicitando BLUETOOTH_CONNECT...")
                    requestPermissionForAlias("bluetoothConnect", call, callback)
                    return false
                }
                !hasPermission("bluetoothScan") -> {
                    napLog(NAP_BLE_INIT_001, "Solicitando BLUETOOTH_SCAN...")
                    requestPermissionForAlias("bluetoothScan", call, callback)
                    return false
                }
                !hasPermission("bluetoothAdvertise") -> {
                    napLog(NAP_BLE_INIT_001, "Solicitando BLUETOOTH_ADVERTISE...")
                    requestPermissionForAlias("bluetoothAdvertise", call, callback)
                    return false
                }
            }
        } else {
            if (!hasPermission("location")) {
                napLog(NAP_BLE_INIT_001, "Solicitando LOCATION (Legacy)")
                requestPermissionForAlias("location", call, callback)
                return false
            }
        }
        return false
    }

    override fun hasRequiredPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            hasPermission("bluetoothScan") && hasPermission("bluetoothConnect") && hasPermission("bluetoothAdvertise")
        } else {
            hasPermission("location")
        }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        if (!validateSystemHealth(call, "advertise")) return
        if (!ensureInitialized(call)) return
        
        if (hasPermission("bluetoothAdvertise")) {
            startAdvertisingInternal(call)
        } else {
            requestPermissionForAlias("bluetoothAdvertise", call, "advertisePermissionCallback")
        }
    }

    @PermissionCallback
    private fun advertisePermissionCallback(call: PluginCall) {
        if (hasPermission("bluetoothAdvertise")) {
            startAdvertisingInternal(call)
        } else {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permiso BLUETOOTH_ADVERTISE requerido")
        }
    }

    private fun startAdvertisingInternal(call: PluginCall) {
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "BLUETOOTH_CONNECT requerido")
            return
        }
        
        val advertiser = bluetoothAdapter?.bluetoothLeAdvertiser ?: run {
            napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "Bluetooth LE Advertising no soportado")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .addManufacturerData(0x4E58, hexToBytes(userId.take(8)))
            .build()

        advertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                napLog(NAP_BLE_ADVERTISE_STARTED, "Advertising iniciado [Native:true]")
                val result = JSObject()
                result.put("active", true)
                call.resolve(result)
            }

            override fun onStartFailure(errorCode: Int) {
                isAdvertising = false
                val isRecoverable = errorCode == AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE
                napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, 
                    "Advertising falló: ${getAdvertiseErrorMessage(errorCode)}", 
                    "ERROR", recoverable = isRecoverable)
            }
        }

        try {
            advertiser.startAdvertising(settings, data, advertiseCallback)
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException al iniciar advertising")
        } catch (e: IllegalStateException) {
            napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "Adapter no listo para advertising", recoverable = true)
        }
    }
    
    private fun getAdvertiseErrorMessage(code: Int): String {
        return when(code) {
            AdvertiseCallback.ADVERTISE_FAILED_DATA_TOO_LARGE -> "Datos demasiado grandes"
            AdvertiseCallback.ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "Demasiados anunciantes en el sistema"
            AdvertiseCallback.ADVERTISE_FAILED_ALREADY_STARTED -> "Ya iniciado"
            AdvertiseCallback.ADVERTISE_FAILED_INTERNAL_ERROR -> "Error interno BT"
            AdvertiseCallback.ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "Feature no soportado"
            else -> "Código desconocido: $code"
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        if (!ensureInitialized(call)) return
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permisos requeridos")
            return
        }
        try {
            bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
            isAdvertising = false
            advertiseCallback = null
            napLog("BLE_ADV_STOP", "Advertising detenido")
            call.resolve()
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "Error al detener advertising")
        }
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (!validateSystemHealth(call, "scan")) return
        
        if (!canAccessBluetooth()) {
            requestPermissionForAlias("bluetoothConnect", call, "scanPermissionCallback")
            return
        }
        
        if (!hasPermission("bluetoothScan")) {
            requestPermissionForAlias("bluetoothScan", call, "scanPermissionCallback")
            return
        }
        
        if (!ensureInitialized(call)) return
        startScanInternal(call)
    }

    @PermissionCallback
    private fun scanPermissionCallback(call: PluginCall) {
        if (canAccessBluetooth() && hasPermission("bluetoothScan")) {
            if (ensureInitialized(call)) {
                startScanInternal(call)
            }
        } else {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permisos SCAN/CONNECT requeridos")
        }
    }

    private fun startScanInternal(call: PluginCall) {
        if (isScanning) {
            napLog("BLE_SCAN_ALREADY", "Scan ya activo, deteniendo y reiniciando...", "WARN")
            stopScanInternal()
        }
        
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "BLUETOOTH_CONNECT requerido")
            return
        }
        
        val scanner = bluetoothAdapter?.bluetoothLeScanner ?: run {
            napError(call, NAP_BLE_ERR_SCAN_FAILED, "Scanner no disponible - BT podría estar apagándose", recoverable = true)
            return
        }

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
            .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
            .build()

        scanCallback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                result?.let { processScanResult(it) }
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>?) {
                results?.forEach { processScanResult(it) }
            }

            override fun onScanFailed(errorCode: Int) {
                val errorMsg = when(errorCode) {
                    SCAN_FAILED_ALREADY_STARTED -> "Scan ya iniciado"
                    SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "Registro de app falló (demasiadas apps escaneando)"
                    SCAN_FAILED_INTERNAL_ERROR -> "Error interno"
                    SCAN_FAILED_FEATURE_UNSUPPORTED -> "Feature no soportado"
                    SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES -> "Recursos hardware agotados (thermal?)"
                    SCAN_FAILED_SCANNING_TOO_FREQUENTLY -> "Escaneando demasiado frecuente"
                    else -> "Error desconocido: $errorCode"
                }
                
                napLog(NAP_BLE_ERR_SCAN_FAILED, "Scan falló: $errorMsg (code: $errorCode)", "ERROR")
                
                val isRecoverable = errorCode in listOf(
                    SCAN_FAILED_ALREADY_STARTED,
                    SCAN_FAILED_SCANNING_TOO_FREQUENTLY,
                    SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES
                )
                
                val eventData = JSObject()
                eventData.put("error", errorCode)
                eventData.put("errorMessage", errorMsg)
                eventData.put("napCode", NAP_BLE_ERR_SCAN_FAILED)
                eventData.put("recoverable", isRecoverable)
                eventData.put("suggestion", if (isRecoverable) "Espere 5 segundos y reintente" else "Reinicie Bluetooth")
                notifyListeners("onScanFailed", eventData)
            }
        }

        try {
            scanner.startScan(listOf(filter), settings, scanCallback)
            isScanning = true
            napLog(NAP_BLE_SCAN_STARTED, "Scan iniciado [Native:true]")
            call.resolve()
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException al iniciar scan")
        } catch (e: IllegalStateException) {
            napError(call, NAP_BLE_ERR_SCAN_FAILED, "BT no está listo para scan", recoverable = true)
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_SCAN_FAILED, "Error inesperado: ${e.message}")
        }
    }

    private fun stopScanInternal() {
        if (!canAccessBluetooth()) return
        try {
            bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
            isScanning = false
            scanCallback = null
        } catch (e: Exception) {
            napLog("BLE_SCAN_STOP_ERR", "Error deteniendo scan: ${e.message}", "WARN")
        }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        stopScanInternal()
        call.resolve()
    }

    private fun processScanResult(result: ScanResult) {
        val device = result.device
        val rssi = result.rssi
        
        if (rssi < -85) return

        val manufacturerData = result.scanRecord?.manufacturerSpecificData
        val userIdFromData = if (manufacturerData != null && manufacturerData.size() > 0) {
            bytesToHex(manufacturerData.valueAt(0))
        } else {
            null
        }

        val data = JSObject()
        data.put("id", device.address)
        data.put("address", device.address)
        data.put("rssi", rssi)
        data.put("name", (device.name ?: "NEXO-${device.address.takeLast(4)}"))
        data.put("userId", (userIdFromData ?: ""))
        data.put("timestamp", System.currentTimeMillis())
        
        notifyListeners("onPeerDiscovered", data)
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        if (!validateSystemHealth(call, "connect")) return
        if (!ensureInitialized(call)) return
        
        val deviceId = call.getString("deviceId") ?: run {
            napError(call, ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }

        if (!deviceId.matches(Regex("([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}"))) {
            napError(call, ERR_INVALID_PARAMS, "Formato MAC inválido")
            return
        }

        if (connectedDevices.containsKey(deviceId)) {
            napError(call, ERR_NOT_CONNECTED, "Dispositivo ya conectado", recoverable = true)
            return
        }

        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "BLUETOOTH_CONNECT requerido")
            return
        }

        val device = bluetoothAdapter?.getRemoteDevice(deviceId) ?: run {
            napError(call, ERR_DEVICE_NOT_FOUND, "Dispositivo no encontrado: $deviceId")
            return
        }

        napLog("BLE_CONNECTING", "Conectando a $deviceId...")

        val gattCallback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> {
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            napLog(NAP_BLE_CONNECTED, "Conectado a $deviceId [Native:true]")
                            gatt?.requestMtu(MTU_DEFAULT)
                            connectedDevices[deviceId] = device
                            notifyConnectionState(deviceId, "connected")
                        } else {
                            val isAuthFail = status == 133 || status == 101
                            napLog(NAP_BLE_ERR_CONNECTION_FAILED, 
                                "Conexión falló post-connect (status: $status)", 
                                if (isAuthFail) "WARN" else "ERROR")
                            
                            if (isAuthFail) {
                                handler.postDelayed({
                                    device.createBond()
                                }, 500)
                            }
                            
                            cleanupConnection(deviceId)
                            notifyConnectionState(deviceId, "error")
                        }
                    }
                    BluetoothProfile.STATE_DISCONNECTED -> {
                        napLog("BLE_DISCONNECTED", "Desconectado de $deviceId (status: $status)")
                        cleanupConnection(deviceId)
                        notifyConnectionState(deviceId, "disconnected")
                    }
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt?, mtu: Int, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    napLog("BLE_MTU", "MTU negociado: $mtu")
                    gatt?.discoverServices()
                } else {
                    napLog("BLE_MTU_ERR", "MTU negotiation failed, usando default", "WARN")
                    gatt?.discoverServices()
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    try {
                        gatt?.getService(SERVICE_UUID)?.getCharacteristic(CHAR_PAYLOAD)?.let { char ->
                            val descriptor = char.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
                            descriptor?.let {
                                it.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                                gatt.writeDescriptor(it)
                            }
                            gatt.setCharacteristicNotification(char, true)
                        }
                        
                        val servicesArray = JSONArray()
                        gatt?.services?.forEach { service ->
                            servicesArray.put(service.uuid.toString())
                        }
                        
                        val eventData = JSObject()
                        eventData.put("deviceId", deviceId)
                        eventData.put("services", servicesArray)
                        notifyListeners("onServicesDiscovered", eventData)
                    } catch (e: SecurityException) {
                        napLog("BLE_SVC_ERR", "SecurityException accessing services", "ERROR")
                    }
                } else {
                    napLog("BLE_SVC_FAIL", "Service discovery failed: $status", "ERROR")
                }
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?) {
                characteristic?.let { char ->
                    val value = char.value ?: return
                    val addr = gatt?.device?.address ?: return
                    
                    when (char.uuid) {
                        CHAR_PAYLOAD -> processPayloadChunk(addr, value)
                        CHAR_HANDSHAKE -> processHandshake(addr, value)
                        CHAR_CONTROL -> processControl(addr, value)
                    }
                }
            }
        }

        val gatt = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
            } else {
                device.connectGatt(context, false, gattCallback)
            }
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "No se pudo crear conexión GATT")
            return
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_CONNECTION_FAILED, "Error creando GATT: ${e.message}")
            return
        }
        
        if (gatt == null) {
            napError(call, NAP_BLE_ERR_CONNECTION_FAILED, "GATT es null - recursos agotados?", recoverable = true)
            return
        }
        
        gattClients[deviceId] = gatt
        val result = JSObject()
        result.put("deviceId", deviceId)
        result.put("status", "connecting")
        call.resolve(result)
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val list = JSONArray()
        connectedDevices.keys.forEach { addr ->
            val deviceObj = JSObject()
            deviceObj.put("id", addr)
            deviceObj.put("address", addr)
            deviceObj.put("connected", true)
            deviceObj.put("rssi", -60)
            list.put(deviceObj)
        }
        val result = JSObject()
        result.put("devices", list)
        result.put("count", connectedDevices.size)
        call.resolve(result)
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            napError(call, ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }
        
        cleanupConnection(deviceId)
        napLog("BLE_DISCONNECT", "Desconexión solicitada para $deviceId")
        call.resolve()
    }
    
    private fun cleanupConnection(deviceId: String) {
        gattClients[deviceId]?.let { gatt ->
            try {
                gatt.disconnect()
                gatt.close()
            } catch (e: Exception) {
                napLog("BLE_CLEANUP_ERR", "Error cerrando GATT: ${e.message}", "WARN")
            }
        }
        gattClients.remove(deviceId)
        connectedDevices.remove(deviceId)
        messageBuffers.remove(deviceId)
        pendingChunks.remove(deviceId)
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        if (!validateSystemHealth(call, "send")) return
        if (!ensureInitialized(call)) return
        
        val deviceId = call.getString("deviceId") ?: run {
            napError(call, ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }
        
        if (!connectedDevices.containsKey(deviceId)) {
            napError(call, ERR_NOT_CONNECTED, "Dispositivo no conectado: $deviceId")
            return
        }
        
        val dataArray = call.getArray("data") ?: run {
            napError(call, ERR_INVALID_PARAMS, "data array requerido")
            return
        }

        val bytes = try {
            ByteArray(dataArray.length()) { i ->
                val value = dataArray.getInt(i)
                if (value < 0 || value > 255) {
                    throw IllegalArgumentException("Byte value out of range at index $i: $value")
                }
                (value and 0xFF).toByte()
            }
        } catch (e: Exception) {
            napError(call, ERR_INVALID_PARAMS, "Array de datos inválido: ${e.message}")
            return
        }

        if (bytes.size > 65535) {
            napError(call, ERR_MESSAGE_TOO_LARGE, "Mensaje > 64KB")
            return
        }

        try {
            sendChunkedMessage(deviceId, bytes)
            napLog(NAP_BLE_MESSAGE_SENT, "Mensaje enviado: ${bytes.size} bytes a $deviceId")
            val result = JSObject()
            result.put("success", true)
            result.put("bytesSent", bytes.size)
            result.put("chunks", (bytes.size + CHUNK_SIZE - 1) / CHUNK_SIZE)
            call.resolve(result)
        } catch (e: Exception) {
            napError(call, "SEND_FAILED", "Error enviando: ${e.message}", recoverable = true)
        }
    }

    private fun sendChunkedMessage(deviceId: String, data: ByteArray) {
        val totalSize = data.size
        val chunks = (totalSize + CHUNK_SIZE - 1) / CHUNK_SIZE
        val messageId = connectionCounter.incrementAndGet() and 0xFFFF
        
        val chunkedData = data.toList().chunked(CHUNK_SIZE)
        for (index in chunkedData.indices) {
            val chunk = chunkedData[index]
            val isLast = index == chunks - 1
            val flags = if (isLast) 0x03 else 0x01
            
            val buffer = ByteBuffer.allocate(7 + chunk.size)
            buffer.order(ByteOrder.BIG_ENDIAN)
            buffer.put(flags.toByte())
            buffer.putShort(messageId.toShort())
            buffer.putShort(index.toShort())
            buffer.putShort(chunks.toShort())
            chunk.forEach { byte -> buffer.put(byte) }
            
            val success = writeCharacteristic(deviceId, CHAR_PAYLOAD, buffer.array())
            if (!success) {
                throw Exception("Falló escritura en chunk $index")
            }
            
            if (!isLast) {
                Thread.sleep(10)
            }
        }
    }

    private fun processPayloadChunk(deviceId: String, data: ByteArray) {
        if (data.size < 7) {
            napLog("BLE_CHUNK_ERR", "Chunk muy pequeño: ${data.size} bytes", "WARN")
            return
        }
        
        val buffer = ByteBuffer.wrap(data)
        buffer.order(ByteOrder.BIG_ENDIAN)
        val flags = buffer.get().toInt() and 0xFF
        val messageId = buffer.short.toInt() and 0xFFFF
        val chunkIndex = buffer.short.toInt() and 0xFFFF
        val totalChunks = buffer.short.toInt() and 0xFFFF
        
        val isLast = (flags and 0x02) != 0
        val payload = data.copyOfRange(7, data.size)
        
        val key = "$deviceId:$messageId"
        
        if (!pendingChunks.containsKey(key)) {
            pendingChunks[key] = ConcurrentHashMap()
        }
        
        pendingChunks[key]?.put(chunkIndex, payload)
        val receivedCount = pendingChunks[key]?.size ?: 0
        
        if (receivedCount == totalChunks) {
            val chunks = pendingChunks[key]
            val completeMessage = ByteArrayOutputStream()
            
            for (i in 0 until totalChunks) {
                chunks?.get(i)?.let { completeMessage.write(it) }
            }
            
            pendingChunks.remove(key)
            
            val result = completeMessage.toByteArray()
            
            val dataArray = JSONArray()
            for (i in result.indices) {
                dataArray.put(result[i].toInt() and 0xFF)
            }
            
            val eventData = JSObject()
            eventData.put("deviceId", deviceId)
            eventData.put("from", deviceId)
            eventData.put("messageId", messageId)
            eventData.put("data", dataArray)
            eventData.put("size", result.size)
            eventData.put("timestamp", System.currentTimeMillis())
            notifyListeners("onMessageReceived", eventData)
        }
    }

    private fun processHandshake(deviceId: String, data: ByteArray) {
        val payloadArray = JSONArray()
        for (i in data.indices) {
            payloadArray.put(data[i].toInt() and 0xFF)
        }
        
        val eventData = JSObject()
        eventData.put("deviceId", deviceId)
        eventData.put("type", (data[0].toInt() and 0xFF))
        eventData.put("payload", payloadArray)
        notifyListeners("onHandshakeReceived", eventData)
    }

    private fun processControl(deviceId: String, data: ByteArray) {
        if (data.isNotEmpty() && data[0].toInt() == 0x04) {
            writeCharacteristic(deviceId, CHAR_CONTROL, byteArrayOf(0x05))
        }
    }

    private fun writeCharacteristic(deviceId: String, uuid: UUID, data: ByteArray): Boolean {
        val gatt = gattClients[deviceId] ?: return false
        
        val characteristic = gatt.getService(SERVICE_UUID)?.getCharacteristic(uuid) ?: return false
        
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                val result = gatt.writeCharacteristic(characteristic, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                result == BluetoothGatt.GATT_SUCCESS
            } catch (e: Exception) {
                false
            }
        } else {
            characteristic.value = data
            characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            gatt.writeCharacteristic(characteristic)
        }
    }

    private fun setupGattServer() {
        val serverCallback = object : BluetoothGattServerCallback() {
            override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
                device?.address?.let { addr ->
                    when (newState) {
                        BluetoothProfile.STATE_CONNECTED -> {
                            connectedDevices[addr] = device
                            notifyConnectionState(addr, "connected")
                        }
                        BluetoothProfile.STATE_DISCONNECTED -> {
                            connectedDevices.remove(addr)
                            notifyConnectionState(addr, "disconnected")
                        }
                    }
                }
            }

            override fun onCharacteristicReadRequest(
                device: BluetoothDevice?, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic?
            ) {
                if (characteristic?.uuid == CHAR_ANNOUNCE) {
                    val response = createAnnounceBeacon()
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, response)
                } else {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, 0, null)
                }
            }

            override fun onCharacteristicWriteRequest(
                device: BluetoothDevice?, requestId: Int, characteristic: BluetoothGattCharacteristic?,
                preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
            ) {
                val addr = device?.address ?: return
                value?.let {
                    when (characteristic?.uuid) {
                        CHAR_PAYLOAD -> processPayloadChunk(addr, it)
                        CHAR_HANDSHAKE -> processHandshake(addr, it)
                        CHAR_CONTROL -> processControl(addr, it)
                    }
                }
                
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
            }
        }

        gattServer = bluetoothManager?.openGattServer(context, serverCallback)
        
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_ANNOUNCE,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        ))
        
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_HANDSHAKE,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ))
        
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_PAYLOAD,
            BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ))
        
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_CONTROL,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ
        ))
        
        gattServer?.addService(service)
    }

    private fun createAnnounceBeacon(): ByteArray {
        val buffer = ByteBuffer.allocate(32)
        buffer.order(ByteOrder.BIG_ENDIAN)
        val idBytes = hexToBytes(userId).copyOf(16)
        buffer.put(idBytes)
        buffer.putLong(System.currentTimeMillis() / 1000)
        buffer.putLong((Math.random() * Long.MAX_VALUE).toLong())
        return buffer.array()
    }

    private fun notifyConnectionState(deviceId: String, state: String) {
        val data = JSObject()
        data.put("deviceId", deviceId)
        data.put("state", state)
        data.put("timestamp", System.currentTimeMillis())
        data.put("health", getSystemHealthReport())
        notifyListeners("onConnectionStateChanged", data)
    }

    private fun stopAllOperations() {
        stopScanInternal()
        if (canAccessBluetooth()) {
            try {
                bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
                bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
            } catch (e: Exception) {}
        }
    }
    
    private fun cleanupAllConnections() {
        gattClients.values.forEach { gatt ->
            try {
                gatt.disconnect()
                gatt.close()
            } catch (e: Exception) {}
        }
        gattClients.clear()
        connectedDevices.clear()
    }

    private fun generateUserId(): String {
        return UUID.randomUUID().toString().replace("-", "").take(32)
    }

    private fun bytesToHex(bytes: ByteArray): String {
        return bytes.joinToString("") { "%02x".format(it) }
    }
    
    private fun hexToBytes(hex: String): ByteArray {
        val cleanHex = hex.replace("-", "").replace(":", "")
        return if (cleanHex.length % 2 == 0) {
            cleanHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        } else {
            ByteArray(0)
        }
    }
    
    private fun ensureInitialized(call: PluginCall): Boolean {
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Permisos Bluetooth no concedidos")
            return false
        }
        
        if (bluetoothAdapter == null) {
            napError(call, NAP_BLE_ERR_NOT_SUPPORTED, "Bluetooth no inicializado. Llame a initialize() primero.")
            return false
        }
        
        val isEnabled = try {
            bluetoothAdapter!!.isEnabled
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException checking BT enabled", "ERROR")
            false
        }
        
        if (!isEnabled) {
            napError(call, NAP_BLE_ERR_DISABLED, "Bluetooth está desactivado", recoverable = true)
            return false
        }
        
        return true
    }
    
    override fun handleOnDestroy() {
        napLog("BLE_DESTROY", "Destruyendo NAP-BLE Plugin...")
        
        try {
            context.unregisterReceiver(systemStateReceiver)
        } catch (e: IllegalArgumentException) {}
        
        cleanupAllConnections()
        
        if (canAccessBluetooth()) {
            try {
                bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
                bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
            } catch (e: Exception) {}
        }
        
        gattServer?.close()
        pendingChunks.clear()
        messageBuffers.clear()
        connectedDevices.clear()
        pendingCalls.clear()
        pendingPermissionAliases.clear()
        permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
        releaseInitLock()
        
        super.handleOnDestroy()
    }
}
