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
        
        const val NAP_BLE_INIT_001 = "BLE_INIT_001"
        const val NAP_BLE_INIT_002 = "BLE_INIT_002"
        const val NAP_BLE_INIT_003 = "BLE_INIT_003"
        const val NAP_BLE_INIT_004 = "BLE_INIT_004"
        const val NAP_BLE_INIT_005 = "BLE_INIT_005"
        const val NAP_BLE_INIT_006 = "BLE_INIT_006"
        const val NAP_BLE_INIT_007 = "BLE_INIT_007"
        
        const val NAP_BLE_READY = "BLE_050"
        const val NAP_BLE_CONNECTED = "BLE_051"
        const val NAP_BLE_SCAN_STARTED = "BLE_052"
        const val NAP_BLE_ADVERTISE_STARTED = "BLE_053"
        const val NAP_BLE_MESSAGE_SENT = "BLE_054"
        const val NAP_BLE_RECOVERY_SUCCESS = "BLE_055"
        const val NAP_BLE_PERMISSIONS_GRANTED = "BLE_056"
        
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
        
        val SERVICE_UUID = NexoGattService.SERVICE_UUID
        val CHAR_ANNOUNCE = NexoGattService.ANNOUNCE_CHAR_UUID
        val CHAR_HANDSHAKE = NexoGattService.HANDSHAKE_CHAR_UUID
        val CHAR_PAYLOAD = NexoGattService.PAYLOAD_CHAR_UUID
        val CHAR_CONTROL = NexoGattService.CONTROL_CHAR_UUID
    }

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
    
    private val isInitializing = AtomicBoolean(false)
    private val initLock = Object()
    private var lastInitAttempt = 0L
    private var thermalCooldownActive = false
    private var retryCount = 0
    private var lastKnownPermissionState = true
    
    private var cachedDeviceState: JSObject? = null
    
    private var pendingPermissionAliases = mutableListOf<String>()
    private var currentPermissionIndex = 0
    private var permissionTimeoutRunnable: Runnable? = null

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
            val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
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

    private fun validateSystemHealth(call: PluginCall?, operation: String): Boolean {
        if (getBatteryTemp() > THERMAL_THRESHOLD_C) {
            thermalCooldownActive = true
            napError(call, NAP_BLE_ERR_THERMAL_SHUTDOWN, 
                "Temperatura crítica: ${getBatteryTemp()}°C", "ERROR", recoverable = true)
            
            handler.postDelayed({
                thermalCooldownActive = false
                napLog(NAP_BLE_RECOVERY_SUCCESS, "Cooldown completado")
            }, THERMAL_COOLDOWN_MS)
            
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
        
        return true
    }

    override fun load() {
        napLog("BLE_LOAD", "NAP-BLE v2.5.2-FIX loaded (CallbackDelayFix)")
        
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
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "BLUETOOTH_CONNECT no concedido", "ERROR")
            return false
        }

        try {
            if (bluetoothManager == null) {
                bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            }
            bluetoothAdapter = bluetoothManager?.adapter
            
            if (bluetoothAdapter == null) {
                napLog(NAP_BLE_ERR_NOT_SUPPORTED, "Dispositivo sin soporte Bluetooth", "ERROR")
                return false
            }
            return true
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException: ${e.message}", "ERROR")
            return false
        }
    }

    // ============================================================
    // [FIX CRÍTICO v2.5.2] PERMISSION BRIDGE CON DELAY
    // Delay de 300ms para Android 14 - espera actualización estado interno
    // ============================================================
    
    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        napLog(NAP_BLE_INIT_001, "[1/3] Solicitud de permisos BLE iniciada")
        
        pendingPermissionAliases.clear()
        currentPermissionIndex = 0
        permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!hasPermission("bluetoothConnect")) pendingPermissionAliases.add("bluetoothConnect")
            if (!hasPermission("bluetoothScan")) pendingPermissionAliases.add("bluetoothScan")
            if (!hasPermission("bluetoothAdvertise")) pendingPermissionAliases.add("bluetoothAdvertise")
        } else {
            if (!hasPermission("location")) pendingPermissionAliases.add("location")
        }
        
        if (pendingPermissionAliases.isEmpty()) {
            napLog(NAP_BLE_PERMISSIONS_GRANTED, "Todos los permisos ya concedidos")
            val result = buildPermissionsResult()
            result.put("alreadyGranted", true)
            call.resolve(result)
            return
        }
        
        val hasPermanentDenial = checkPermanentDenial()
        napLog(NAP_BLE_WAITING_PERMISSIONS, "Solicitando ${pendingPermissionAliases.size} permiso(s). PermanentDenial: $hasPermanentDenial")
        
        permissionTimeoutRunnable = Runnable {
            if (!call.isReleased && !call.isSaved) {
                napLog(NAP_BLE_PARTIAL_PERMISSIONS, "TIMEOUT: Usuario no respondió", "WARN")
                val errorData = JSObject()
                errorData.put("timeout", true)
                errorData.put("isPermanentDenial", hasPermanentDenial)
                call.reject(NAP_BLE_PARTIAL_PERMISSIONS, "Permisos timeout", errorData)
                pendingPermissionAliases.clear()
            }
        }
        handler.postDelayed(permissionTimeoutRunnable!!, 30000)
        
        saveCall(call)
        requestNextPermission(call)
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
    
    // ============================================================
    // [FIX CRÍTICO] Delay de 300ms antes de verificar permiso
    // Android 14 necesita tiempo para actualizar estado interno post-diálogo
    // ============================================================
    @PermissionCallback
    private fun requestPermissionsCallback(call: PluginCall) {
        try {
            val currentAlias = pendingPermissionAliases.getOrNull(currentPermissionIndex)
            
            if (currentAlias != null) {
                // FIX CRÍTICO: Delay 300ms para Android 14 actualice estado interno
                handler.postDelayed({
                    val granted = hasPermission(currentAlias)
                    napLog("BLE_PERM_RESULT", "Callback - Permiso $currentAlias: ${if (granted) "CONCEDIDO" else "DENEGADO"}")
                    
                    if (!granted) {
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
                            napLog(NAP_BLE_PARTIAL_PERMISSIONS, "Permiso $currentAlias denegado PERMANENTEMENTE")
                        }
                    }
                    
                    currentPermissionIndex++
                    
                    if (currentPermissionIndex < pendingPermissionAliases.size) {
                        requestNextPermission(call)
                    } else {
                        permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
                        reportFinalPermissionsResult(call)
                    }
                }, 300) // 300ms delay crítico para S24 Ultra Android 14
            } else {
                napLog("BLE_PERM_WARN", "Callback llamado pero currentAlias es null", "WARN")
                permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
                reportFinalPermissionsResult(call)
            }
        } catch (e: Exception) {
            napLog("BLE_PERM_ERR", "Excepción: ${e.message}", "ERROR")
            permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
            
            val errorData = JSObject()
            errorData.put("exception", e.message)
            call.reject(NAP_BLE_ERR_INIT_FAILED, "Error en callback", errorData)
        }
    }
    
    private fun requestNextPermission(call: PluginCall) {
        val alias = pendingPermissionAliases.getOrNull(currentPermissionIndex)
        if (alias != null) {
            napLog(NAP_BLE_INIT_001, "Solicitando [$currentPermissionIndex/${pendingPermissionAliases.size}]: $alias")
            requestPermissionForAlias(alias, call, "requestPermissionsCallback")
        } else {
            napLog("BLE_PERM_ERR", "Alias null", "ERROR")
            permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
            reportFinalPermissionsResult(call)
        }
    }
    
    private fun reportFinalPermissionsResult(call: PluginCall) {
        val allGranted = hasRequiredPermissions()
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
            errorData.put("permissions", result.getJSObject("permissions"))
            errorData.put("allGranted", false)
            errorData.put("isPermanentDenial", hasPermanentDenial)
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

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        if (!validateSystemHealth(call, "status_check")) return
        
        if (!canAccessBluetooth()) {
            napLog(NAP_BLE_WAITING_PERMISSIONS, "Permisos no concedidos")
            pendingCalls["btStateCheck"] = call
            requestPermissionForAlias("bluetoothConnect", call, "btStatePermissionCallback")
            return
        }
        reportBluetoothState(call)
    }

    @PermissionCallback
    private fun btStatePermissionCallback(call: PluginCall) {
        if (canAccessBluetooth()) {
            reportBluetoothState(call)
        } else {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Usuario rechazó permisos")
            pendingCalls.remove("btStateCheck")
        }
    }

    private fun reportBluetoothState(call: PluginCall) {
        if (!initializeAdapter()) {
            val result = JSObject()
            result.put("enabled", false)
            result.put("state", BluetoothAdapter.STATE_OFF)
            result.put("stateName", if (!canAccessBluetooth()) "NO_PERMISSION" else "NOT_SUPPORTED")
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
