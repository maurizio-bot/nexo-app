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
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

// Force commit - Build #710


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
        napLog("BLE_LOAD", "NAP-BLE v2.5.4-FIX loaded (TypeFixes)")
        
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
    // [FIX CRÍTICO v2.5.4] PERMISSION BRIDGE CON DELAY
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
            if (!call.isSaved) {
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
    
    @PermissionCallback
    private fun requestPermissionsCallback(call: PluginCall) {
        try {
            val currentAlias = pendingPermissionAliases.getOrNull(currentPermissionIndex)
            
            if (currentAlias != null) {
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
                }, 300)
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
        val allGranted = hasAllBlePermissions()
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
            val permsObj = result.getJSObject("permissions")
            if (permsObj != null) {
                errorData.put("permissions", permsObj)
            }
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
        val isEnabled = state == BluetoothAdapter.STATE_ON
        result.put("enabled", isEnabled)
        result.put("state", state)
        result.put("stateName", when(state) {
            BluetoothAdapter.STATE_ON -> "ON"
            BluetoothAdapter.STATE_OFF -> "OFF"
            BluetoothAdapter.STATE_TURNING_ON -> "TURNING_ON"
            BluetoothAdapter.STATE_TURNING_OFF -> "TURNING_OFF"
            else -> "UNKNOWN"
        })
        result.put("health", getSystemHealthReport())
        result.put("canScan", isEnabled && canAccessBluetooth())
        result.put("canAdvertise", isEnabled && canAccessBluetooth())
        result.put("address", adapter?.address ?: "unknown")
        
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
        health.put("permissionsGranted", hasAllBlePermissions())
        health.put("androidVersion", Build.VERSION.SDK_INT)
        health.put("isAndroid12OrHigher", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        return health
    }

    private fun hasAllBlePermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            hasPermission("bluetoothConnect") && hasPermission("bluetoothScan") && hasPermission("bluetoothAdvertise")
        } else {
            hasPermission("location")
        }
    }

    private fun cleanupAllConnections() {
        napLog(NAP_BLE_INIT_002, "Limpiando todas las conexiones BLE")
        
        try {
            gattClients.forEach { (_, gatt) ->
                try {
                    gatt.disconnect()
                    gatt.close()
                } catch (e: Exception) {
                    Log.w(TAG, "Error cerrando GATT client: ${e.message}")
                }
            }
            gattClients.clear()
            connectedDevices.clear()
            
            gattServer?.close()
            gattServer = null
            
            messageBuffers.clear()
            pendingChunks.clear()
            
            napLog(NAP_BLE_INIT_003, "Conexiones limpiadas")
        } catch (e: Exception) {
            napLog(NAP_BLE_ERR_INIT_FAILED, "Error en cleanup: ${e.message}", "ERROR")
        }
    }

    private fun stopAllOperations() {
        napLog(NAP_BLE_INIT_004, "Deteniendo todas las operaciones BLE")
        stopScanInternal()
        stopAdvertiseInternal()
    }

    private fun stopScanInternal() {
        if (!isScanning) return
        try {
            scanCallback?.let {
                bluetoothAdapter?.bluetoothLeScanner?.stopScan(it)
            }
            isScanning = false
            scanCallback = null
            napLog(NAP_BLE_INIT_005, "Scan detenido")
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "Error deteniendo scan: ${e.message}", "ERROR")
        }
    }

    private fun stopAdvertiseInternal() {
        if (!isAdvertising) return
        try {
            advertiseCallback?.let {
                bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(it)
            }
            isAdvertising = false
            advertiseCallback = null
            napLog(NAP_BLE_INIT_006, "Advertising detenido")
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

            if (!initializeAdapter()) {
                napError(call, NAP_BLE_ERR_INIT_FAILED, "No se pudo inicializar adapter")
                releaseInitLock()
                return
            }

            val adapter = bluetoothAdapter
            if (adapter?.isEnabled != true) {
                napLog(NAP_BLE_WAITING_BT_ON, "Bluetooth desactivado, solicitando activación")
                pendingCalls["init"] = call
                val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
                startActivityForResult(call, enableBtIntent, "enableBluetoothResult")
                releaseInitLock()
                return
            }

            setupGattServer()

            userId = call.getString("userId") ?: ""

            val result = JSObject()
            result.put("initialized", true)
            result.put("userId", userId)
            result.put("adapterAddress", adapter?.address ?: "unknown")
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

    // FIX: ActivityResult callback para enable Bluetooth
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

    private fun setupGattServer() {
        try {
            if (gattServer != null) return
            
            val manager = bluetoothManager ?: return
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
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )
            
            val controlChar = BluetoothGattCharacteristic(
                CHAR_CONTROL,
                BluetoothGattCharacteristic.PROPERTY_WRITE,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )
            
            service.addCharacteristic(announceChar)
            service.addCharacteristic(handshakeChar)
            service.addCharacteristic(payloadChar)
            service.addCharacteristic(controlChar)
            
            gattServer = manager.openGattServer(context, object : BluetoothGattServerCallback() {
                override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
                    super.onConnectionStateChange(device, status, newState)
                    val address = device?.address ?: "unknown"
                    when (newState) {
                        BluetoothProfile.STATE_CONNECTED -> {
                            connectedDevices[address] = device!!
                            connectionCounter.incrementAndGet()
                            napLog(NAP_BLE_CONNECTED, "Dispositivo conectado: $address")
                            notifyListeners("onDeviceConnected", JSObject().apply {
                                put("address", address)
                                put("name", device.name ?: "Unknown")
                            })
                        }
                        BluetoothProfile.STATE_DISCONNECTED -> {
                            connectedDevices.remove(address)
                            gattClients.remove(address)
                            napLog(NAP_BLE_INIT_007, "Dispositivo desconectado: $address")
                            notifyListeners("onDeviceDisconnected", JSObject().apply {
                                put("address", address)
                            })
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
                    super.onCharacteristicWriteRequest(device, requestId, characteristic, preparedWrite, responseNeeded, offset, value)
                    val address = device?.address ?: return
                    
                    when (characteristic?.uuid) {
                        CHAR_HANDSHAKE -> {
                            napLog(NAP_BLE_INIT_002, "Handshake recibido de $address")
                        }
                        CHAR_PAYLOAD -> {
                            value?.let { handleIncomingPayload(address, it) }
                        }
                        CHAR_CONTROL -> {
                            value?.let { handleControlMessage(address, it) }
                        }
                    }
                    
                    if (responseNeeded) {
                        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
                    }
                }
            })
            
            gattServer?.addService(service)
            napLog(NAP_BLE_INIT_003, "GATT Server configurado")
            
        } catch (e: SecurityException) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException en GATT Server: ${e.message}", "ERROR")
        } catch (e: Exception) {
            napLog(NAP_BLE_ERR_INIT_FAILED, "Error GATT Server: ${e.message}", "ERROR")
        }
    }

    private fun handleIncomingPayload(address: String, data: ByteArray) {
        try {
            val buffer = messageBuffers.getOrPut(address) { ByteArrayOutputStream() }
            buffer.write(data)
            
            if (data.size < CHUNK_SIZE) {
                val completeMessage = buffer.toByteArray()
                messageBuffers.remove(address)
                
                napLog(NAP_BLE_MESSAGE_SENT, "Mensaje completo recibido de $address: ${completeMessage.size} bytes")
                
                // FIX: Usar JSONArray de org.json y convertir a lista manualmente para JSObject
                val jsonArray = JSONArray()
                for (byte in completeMessage) {
                    jsonArray.put(byte.toInt() and 0xFF)
                }
                
                val eventData = JSObject()
                eventData.put("from", address)
                eventData.put("data", jsonArray)
                eventData.put("size", completeMessage.size)
                notifyListeners("onMessageReceived", eventData)
            }
        } catch (e: Exception) {
            napLog(NAP_BLE_ERR_MEMORY_PRESSURE, "Error procesando payload: ${e.message}", "ERROR")
        }
    }

    private fun handleControlMessage(address: String, data: ByteArray) {
        val command = String(data, Charsets.UTF_8)
        napLog(NAP_BLE_INIT_004, "Control message de $address: $command")
        val eventData = JSObject()
        eventData.put("from", address)
        eventData.put("command", command)
        notifyListeners("onControlMessage", eventData)
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (!validateSystemHealth(call, "scan")) return
        
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos para scan")
            return
        }
        
        if (!initializeAdapter()) {
            napError(call, NAP_BLE_ERR_INIT_FAILED, "Adapter no disponible")
            return
        }
        
        if (isScanning) {
            napLog(NAP_BLE_ALREADY_INITIALIZED, "Scan ya activo")
            call.resolve(JSObject().apply { put("started", true) })
            return
        }
        
        try {
            val scanFilter = ScanFilter.Builder()
                .setServiceUuid(ParcelUuid(SERVICE_UUID))
                .build()
            
            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build()
            
            scanCallback = object : ScanCallback() {
                override fun onScanResult(callbackType: Int, result: ScanResult?) {
                    result?.device?.let { device ->
                        val address = device.address ?: return@let
                        val name = device.name ?: "Unknown"
                        
                        val deviceData = JSObject()
                        deviceData.put("address", address)
                        deviceData.put("name", name)
                        deviceData.put("rssi", result.rssi)
                        
                        notifyListeners("onScanResult", deviceData)
                    }
                }
                
                override fun onScanFailed(errorCode: Int) {
                    napLog(NAP_BLE_ERR_SCAN_FAILED, "Scan failed: $errorCode", "ERROR")
                    val errorData = JSObject()
                    errorData.put("errorCode", errorCode)
                    notifyListeners("onScanFailed", errorData)
                }
            }
            
            bluetoothAdapter?.bluetoothLeScanner?.startScan(
                listOf(scanFilter),
                settings,
                scanCallback!!
            )
            
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
        call.resolve(JSObject().apply { put("stopped", true) })
    }

    @PluginMethod
    fun startAdvertise(call: PluginCall) {
        if (!validateSystemHealth(call, "advertise")) return
        
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos para advertise")
            return
        }
        
        if (!initializeAdapter()) {
            napError(call, NAP_BLE_ERR_INIT_FAILED, "Adapter no disponible")
            return
        }
        
        if (isAdvertising) {
            napLog(NAP_BLE_ALREADY_INITIALIZED, "Advertise ya activo")
            call.resolve(JSObject().apply { put("started", true) })
            return
        }
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!hasPermission("bluetoothAdvertise")) {
                napError(call, NAP_BLE_ADV_NO_PERMISSION, "Permiso BLUETOOTH_ADVERTISE no concedido", recoverable = true)
                return
            }
        }
        
        try {
            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(true)
                .build()
            
            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .addServiceUuid(ParcelUuid(SERVICE_UUID))
                .build()
            
            advertiseCallback = object : AdvertiseCallback() {
                override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                    isAdvertising = true
                    napLog(NAP_BLE_ADVERTISE_STARTED, "Advertising iniciado")
                    val eventData = JSObject()
                    eventData.put("started", true)
                    notifyListeners("onAdvertiseStarted", eventData)
                }
                
                override fun onStartFailure(errorCode: Int) {
                    napLog(NAP_BLE_ERR_ADVERTISE_FAILED, "Advertise failed: $errorCode", "ERROR")
                    val eventData = JSObject()
                    eventData.put("errorCode", errorCode)
                    notifyListeners("onAdvertiseFailed", eventData)
                }
            }
            
            bluetoothAdapter?.bluetoothLeAdvertiser?.startAdvertising(
                settings,
                data,
                advertiseCallback!!
            )
            
            call.resolve(JSObject().apply { put("started", true) })
            
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException en advertise: ${e.message}")
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, "Error iniciando advertise: ${e.message}")
        }
    }

    @PluginMethod
    fun stopAdvertise(call: PluginCall) {
        stopAdvertiseInternal()
        call.resolve(JSObject().apply { put("stopped", true) })
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val address = call.getString("address")
        val message = call.getString("message")
        val dataArray = call.getArray("data", JSONArray())
        
        if (address == null) {
            napError(call, ERR_INVALID_PARAMS, "address requerido")
            return
        }
        
        // FIX: Manejo correcto de JSONArray de org.json
        val payload = if (message != null) {
            message.toByteArray(Charsets.UTF_8)
        } else {
            val len = dataArray?.length() ?: 0
            ByteArray(len) { i -> 
                (dataArray?.optInt(i, 0) ?: 0).toByte() 
            }
        }
        
        if (payload.isEmpty()) {
            napError(call, ERR_INVALID_PARAMS, "Payload vacío")
            return
        }
        
        if (payload.size > CHUNK_SIZE * 10) {
            napError(call, ERR_MESSAGE_TOO_LARGE, "Mensaje excede límite de ${CHUNK_SIZE * 10} bytes")
            return
        }
        
        val gatt = gattClients[address]
        if (gatt == null) {
            napError(call, ERR_NOT_CONNECTED, "No conectado a $address")
            return
        }
        
        try {
            val chunks = payload.toList().chunked(CHUNK_SIZE)
            chunks.forEachIndexed { index, chunk ->
                val service = gatt.getService(SERVICE_UUID)
                val char = service?.getCharacteristic(CHAR_PAYLOAD)
                char?.value = chunk.toByteArray()
                gatt.writeCharacteristic(char)
            }
            
            napLog(NAP_BLE_MESSAGE_SENT, "Mensaje enviado a $address: ${payload.size} bytes en ${chunks.size} chunks")
            val result = JSObject()
            result.put("sent", true)
            result.put("chunks", chunks.size)
            result.put("bytes", payload.size)
            call.resolve(result)
            
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "Error enviando: ${e.message}")
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_CONNECTION_FAILED, "Error enviando mensaje: ${e.message}")
        }
    }

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val address = call.getString("address")
        if (address == null) {
            napError(call, ERR_INVALID_PARAMS, "address requerido")
            return
        }
        
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos")
            return
        }
        
        if (!initializeAdapter()) {
            napError(call, NAP_BLE_ERR_INIT_FAILED, "Adapter no disponible")
            return
        }
        
        try {
            val device = bluetoothAdapter?.getRemoteDevice(address)
            if (device == null) {
                napError(call, ERR_DEVICE_NOT_FOUND, "Dispositivo no encontrado: $address")
                return
            }
            
            val gattCallback = object : BluetoothGattCallback() {
                override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
                    when (newState) {
                        BluetoothProfile.STATE_CONNECTED -> {
                            if (gatt != null) {
                                gattClients[address] = gatt
                                gatt.requestMtu(MTU_DEFAULT)
                                napLog(NAP_BLE_CONNECTED, "Conectado a $address")
                                val eventData = JSObject()
                                eventData.put("address", address)
                                eventData.put("status", "connected")
                                notifyListeners("onDeviceConnected", eventData)
                            }
                        }
                        BluetoothProfile.STATE_DISCONNECTED -> {
                            gattClients.remove(address)
                            napLog(NAP_BLE_INIT_007, "Desconectado de $address")
                            val eventData = JSObject()
                            eventData.put("address", address)
                            eventData.put("status", "disconnected")
                            notifyListeners("onDeviceDisconnected", eventData)
                        }
                    }
                }
                
                override fun onMtuChanged(gatt: BluetoothGatt?, mtu: Int, status: Int) {
                    napLog(NAP_BLE_INIT_005, "MTU negociado: $mtu")
                }
            }
            
            val gatt = device.connectGatt(context, false, gattCallback)
            if (gatt != null) {
                val result = JSObject()
                result.put("connecting", true)
                result.put("address", address)
                call.resolve(result)
            } else {
                napError(call, NAP_BLE_ERR_CONNECTION_FAILED, "No se pudo iniciar conexión")
            }
            
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException: ${e.message}")
        } catch (e: IllegalArgumentException) {
            napError(call, ERR_DEVICE_NOT_FOUND, "Dirección MAC inválida: $address")
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_CONNECTION_FAILED, "Error: ${e.message}")
        }
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val address = call.getString("address")
        if (address == null) {
            napError(call, ERR_INVALID_PARAMS, "address requerido")
            return
        }
        
        try {
            gattClients[address]?.let { gatt ->
                gatt.disconnect()
                gatt.close()
                gattClients.remove(address)
                connectedDevices.remove(address)
                napLog(NAP_BLE_INIT_007, "Desconectado manualmente: $address")
            }
            call.resolve(JSObject().apply { put("disconnected", true) })
        } catch (e: Exception) {
            napError(call, NAP_BLE_ERR_CONNECTION_FAILED, "Error desconectando: ${e.message}")
        }
    }

    @PluginMethod
    fun getCapabilities(call: PluginCall) {
        val result = JSObject()
        val capabilities = JSObject()
        
        capabilities.put("canScan", canAccessBluetooth() && bluetoothAdapter?.isEnabled == true)
        capabilities.put("canAdvertise", canAccessBluetooth() && bluetoothAdapter?.isEnabled == true)
        capabilities.put("canConnect", canAccessBluetooth())
        capabilities.put("mtuSupported", MTU_DEFAULT)
        capabilities.put("chunkSize", CHUNK_SIZE)
        capabilities.put("maxMessageSize", CHUNK_SIZE * 10)
        capabilities.put("multiDevice", true)
        
        result.put("capabilities", capabilities)
        result.put("androidVersion", Build.VERSION.SDK_INT)
        result.put("isAndroid12OrHigher", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
        result.put("health", getSystemHealthReport())
        
        call.resolve(result)
    }

    @PluginMethod
    fun isPermanentlyDenied(call: PluginCall) {
        val result = JSObject()
        result.put("isPermanentDenial", checkPermanentDenial())
        call.resolve(result)
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        try {
            context.unregisterReceiver(systemStateReceiver)
        } catch (e: Exception) {
            Log.w(TAG, "Receiver ya no registrado")
        }
        cleanupAllConnections()
        napLog(NAP_BLE_INIT_007, "Plugin destruido")
    }
}
