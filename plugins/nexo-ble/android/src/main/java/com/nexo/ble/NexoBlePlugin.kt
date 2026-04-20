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
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

// Build #739 - [NORDIC_010] FIX v3.0.4-NAP
// Fix: Device name in scan/advertise + connection events to JS + getLocalDeviceInfo

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
        
        // REM Códigos de Inicialización
        const val NAP_BLE_INIT_001 = "BLE_INIT_001"
        const val NAP_BLE_INIT_002 = "BLE_INIT_002"
        const val NAP_BLE_INIT_003 = "BLE_INIT_003"
        const val NAP_BLE_INIT_004 = "BLE_INIT_004"
        const val NAP_BLE_INIT_005 = "BLE_INIT_005"
        const val NAP_BLE_INIT_006 = "BLE_INIT_006"
        const val NAP_BLE_INIT_007 = "BLE_INIT_007"
        
        // REM Códigos de Permisos (Nuevos - Detallados)
        const val REM_PERM_REQUEST_START = "REM_PERM_001"
        const val REM_PERM_CHECK_ALIASES = "REM_PERM_002"
        const val REM_PERM_CHECK_EXISTING = "REM_PERM_003"
        const val REM_PERM_CHECK_PERMANENT = "REM_PERM_004"
        const val REM_PERM_DIALOG_SHOW = "REM_PERM_010"
        const val REM_PERM_DIALOG_RESPONSE = "REM_PERM_011"
        const val REM_PERM_VERIFY_RESULT = "REM_PERM_012"
        const val REM_PERM_GRANTED = "REM_PERM_020"
        const val REM_PERM_DENIED_TEMP = "REM_PERM_021"
        const val REM_PERM_DENIED_PERM = "REM_PERM_022"
        const val REM_PERM_SEQUENCE_COMPLETE = "REM_PERM_030"
        const val REM_PERM_TIMEOUT = "REM_PERM_040"
        const val REM_PERM_ERROR = "REM_PERM_050"
        
        // NAP Códigos estándar
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

    // ============================================================
    // [NORDIC_010] FIX: Variables de clase - solo GATT y estado, NO adapter/manager
    // ============================================================
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
    
    // Sistema de Permisos Secuencial
    private var pendingPermissionAliases = mutableListOf<String>()
    private var currentPermissionIndex = 0
    private var permissionResults = mutableMapOf<String, Boolean>()
    private var permissionTimeoutRunnable: Runnable? = null
    private var isRequestingPermissions = false

    // ============================================================
    // [NORDIC_010] FIX: Helper para obtener adapter FRESH cada vez
    // ============================================================
    
    /**
     * [NORDIC_010] CRITICAL FIX: Obtiene BluetoothAdapter fresh desde el sistema
     * No usa variables cacheadas que pueden invalidarse en Android 14
     */
    private fun getBluetoothAdapter(): BluetoothAdapter? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android 12+ requiere BLUETOOTH_CONNECT para obtener el adapter
                if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) 
                    != PackageManager.PERMISSION_GRANTED) {
                    napLog("BLE_202", "BLUETOOTH_CONNECT no concedido, no se puede obtener adapter", "WARN")
                    return null
                }
            }
            
            // Obtener FRESH cada vez - NO cachear
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

    // ============================================================
    // [REM DEBUG] Helper para Toast visible con códigos
    // ============================================================
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
        
        // [NORDIC_010] FIX v3.0.3: Validación específica de permisos según operación
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
        
        // [NORDIC_010] FIX v3.0.3: Validación específica para advertising
        if (operation == "advertise" && !canAccessAdvertising()) {
            napError(call, NAP_BLE_ADV_NO_PERMISSION, 
                "BLUETOOTH_ADVERTISE no concedido. Requerido para advertising en Android 12+.", 
                "ERROR", recoverable = true)
            return false
        }
        
        return true
    }

    override fun load() {
        remToast("INIT", "NAP-BLE v3.0.4 [NORDIC_010] FIX cargado")
        napLog("BLE_LOAD", "NAP-BLE v3.0.4 loaded - Device name + connection events fix")
        
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
                    
                    // [NORDIC_010] Notificar inmediatamente el cambio de estado
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

    // ============================================================
    // [NORDIC_010] FIX v3.0.3: canAccessBluetooth() verifica TODOS los permisos BLE
    // ============================================================
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
    
    // [NORDIC_010] FIX v3.0.3: Validación específica para advertising
    private fun canAccessAdvertising(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
        } else {
            // Android < 12 no requiere permiso específico de advertising
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED
        }
    }

    // ============================================================
    // [NORDIC_010] FIX: initializeAdapter() usa getBluetoothAdapter()
    // ============================================================
    private fun initializeAdapter(): Boolean {
        if (!canAccessBluetooth()) {
            napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "BLUETOOTH_CONNECT no concedido", "ERROR")
            return false
        }

        try {
            // [NORDIC_010] Usar método fresh, no variable cacheada
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

    // ============================================================
    // [REM v3.0] SISTEMA DE PERMISOS CORREGIDO - SIN RACE CONDITION
    // ============================================================
    
    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        remToast(REM_PERM_REQUEST_START, "Iniciando solicitud de permisos BLE")
        napLog(REM_PERM_REQUEST_START, "Solicitud de permisos BLE iniciada")
        
        // Reset estado
        pendingPermissionAliases.clear()
        permissionResults.clear()
        currentPermissionIndex = 0
        isRequestingPermissions = true
        
        // Cancelar timeout anterior si existe
        permissionTimeoutRunnable?.let { handler.removeCallbacks(it) }
        
        // [REM] Verificar qué permisos necesitamos
        remToast(REM_PERM_CHECK_ALIASES, "Verificando aliases de permisos requeridos")
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!checkPermissionDirectly("bluetoothConnect")) pendingPermissionAliases.add("bluetoothConnect")
            if (!checkPermissionDirectly("bluetoothScan")) pendingPermissionAliases.add("bluetoothScan")
            if (!checkPermissionDirectly("bluetoothAdvertise")) pendingPermissionAliases.add("bluetoothAdvertise")
        } else {
            if (!checkPermissionDirectly("location")) pendingPermissionAliases.add("location")
        }
        
        // [REM] Si todos ya están concedidos, resolver inmediatamente
        if (pendingPermissionAliases.isEmpty()) {
            remToast(REM_PERM_CHECK_EXISTING, "Todos los permisos ya concedidos - SIN DIÁLOGO")
            napLog(NAP_BLE_PERMISSIONS_GRANTED, "Todos los permisos ya concedidos")
            val result = buildPermissionsResult()
            result.put("alreadyGranted", true)
            isRequestingPermissions = false
            call.resolve(result)
            return
        }
        
        // [REM] Verificar si hay denegación permanente antes de empezar
        val hasPermanentDenial = checkPermanentDenial()
        remToast(REM_PERM_CHECK_PERMANENT, "PermanentDenial detectado: $hasPermanentDenial")
        
        // [REM] Configurar timeout de seguridad (30 segundos)
        permissionTimeoutRunnable = Runnable {
            if (isRequestingPermissions) {
                isRequestingPermissions = false
                remToast(REM_PERM_TIMEOUT, "TIMEOUT - Usuario no respondió en 30s")
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
        
        // [REM] Guardar call y comenzar secuencia
        saveCall(call)
        remToast(REM_PERM_DIALOG_SHOW, "Iniciando secuencia de ${pendingPermissionAliases.size} diálogos")
        requestNextPermission(call)
    }
    
    /**
     * [REM v3.0] Verificación DIRECTA de permisos - EVITA RACE CONDITION
     * Usa ContextCompat en lugar de hasPermission() de Capacitor
     */
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
    
    /**
     * [REM v3.0] CALLBACK CORREGIDO - Verificación síncrona inmediata
     */
    @PermissionCallback
    private fun requestPermissionsCallback(call: PluginCall) {
        remToast(REM_PERM_DIALOG_RESPONSE, "Callback nativo ejecutado - Procesando respuesta")
        
        try {
            val currentAlias = pendingPermissionAliases.getOrNull(currentPermissionIndex)
            
            if (currentAlias == null) {
                remToast(REM_PERM_ERROR, "ERROR: Alias null en callback")
                finishPermissionSequence(call)
                return
            }
            
            // [REM] Verificación INMEDIATA y DIRECTA (sin delay)
            val granted = checkPermissionDirectly(currentAlias)
            
            // [REM] Guardar resultado
            permissionResults[currentAlias] = granted
            
            if (granted) {
                remToast(REM_PERM_GRANTED, "$currentAlias CONCEDIDO")
                napLog(REM_PERM_GRANTED, "Permiso $currentAlias concedido")
            } else {
                // [REM] Determinar si es denegación permanente
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
                    remToast(REM_PERM_DENIED_PERM, "$currentAlias DENEGADO PERMANENTEMENTE")
                    napLog(REM_PERM_DENIED_PERM, "Permiso $currentAlias denegado permanentemente")
                } else {
                    remToast(REM_PERM_DENIED_TEMP, "$currentAlias DENEGADO (puede reintentar)")
                    napLog(REM_PERM_DENIED_TEMP, "Permiso $currentAlias denegado temporalmente")
                }
            }
            
            // [REM] Avanzar al siguiente permiso
            currentPermissionIndex++
            
            if (currentPermissionIndex < pendingPermissionAliases.size) {
                // Hay más permisos por solicitar
                remToast(REM_PERM_DIALOG_SHOW, "Solicitando siguiente permiso [${currentPermissionIndex + 1}/${pendingPermissionAliases.size}]")
                requestNextPermission(call)
            } else {
                // Todos los diálogos completados
                remToast(REM_PERM_SEQUENCE_COMPLETE, "Secuencia de permisos completada - Reportando resultados")
                finishPermissionSequence(call)
            }
            
        } catch (e: Exception) {
            remToast(REM_PERM_ERROR, "ERROR en callback: ${e.message}")
            napLog(REM_PERM_ERROR, "Excepción en callback: ${e.message}", "ERROR")
            finishPermissionSequence(call)
        }
    }
    
    private fun requestNextPermission(call: PluginCall) {
        val alias = pendingPermissionAliases.getOrNull(currentPermissionIndex)
        if (alias != null) {
            remToast(REM_PERM_DIALOG_SHOW, "Mostrando diálogo [$currentPermissionIndex/${pendingPermissionAliases.size}]: $alias")
            napLog(REM_PERM_DIALOG_SHOW, "Solicitando [$currentPermissionIndex/${pendingPermissionAliases.size}]: $alias")
            requestPermissionForAlias(alias, call, "requestPermissionsCallback")
        } else {
            remToast(REM_PERM_ERROR, "ERROR: Alias null al solicitar")
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
        remToast(REM_PERM_VERIFY_RESULT, "Estado final - Todos concedidos: $allGranted")
        
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
            remToast(REM_PERM_GRANTED, "RESOLVIENDO ÉXITO - Todos los permisos concedidos")
            napLog(NAP_BLE_PERMISSIONS_GRANTED, "Todos los permisos concedidos")
            notifyListeners("onPermissionsGranted", JSObject().apply {
                put("allGranted", true)
                put("platform", if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "android12+" else "legacy")
            })
            call.resolve(result)
        } else {
            remToast(REM_PERM_DENIED_TEMP, "RECHAZANDO - Algunos permisos denegados")
            napLog(NAP_BLE_PARTIAL_PERMISSIONS, "Algunos permisos denegados")
            val errorData = JSObject()
            val permsObj = result.getJSObject("permissions")
            if (permsObj != null) {
                errorData.put("permissions", permsObj)
            }
            errorData.put("allGranted", false)
            errorData.put("isPermanentDenial", hasPermanentDenial)
            errorData.put("detailedResults", JSObject().apply {
                permissionResults.forEach { (k, v) -> put(k, v) }
            })
            call.reject(NAP_BLE_PARTIAL_PERMISSIONS, "Permisos incompletos", errorData)
        }
    }
    
    /**
     * [REM v3.0] Usa verificación directa para resultado final
     */
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

    // ============================================================
    // [NORDIC_010] FIX: isBluetoothEnabled() - Lógica completamente revisada
    // ============================================================
    
    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        napLog("BLE_STATE_CHECK", "Verificando estado Bluetooth [NORDIC_010]")
        
        // [NORDIC_010] FIX: Primero verificar si tenemos permisos
        if (!canAccessBluetooth()) {
            napLog(NAP_BLE_WAITING_PERMISSIONS, "Permisos no concedidos, reportando estado desconocido")
            // No rechazamos, reportamos que necesitamos permisos pero no asumimos OFF
            val result = JSObject()
            result.put("enabled", false)
            result.put("state", BluetoothAdapter.STATE_OFF) // Conservador
            result.put("stateName", "NO_PERMISSION")
            result.put("needsPermission", true)
            result.put("canPrompt", true)
            result.put("health", getSystemHealthReport())
            call.resolve(result)
            return
        }
        
        // [NORDIC_010] FIX: Obtener adapter FRESH, no usar variable cacheada
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
        
        // [NORDIC_010] Leer estado real del adapter
        val state = try {
            adapter.state
        } catch (e: SecurityException) {
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
        
        // [NORDIC_010] FIX: Incluir info de soporte de advertising
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
                getBluetoothAdapter()?.bluetoothLeScanner?.stopScan(it)
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
                getBluetoothAdapter()?.bluetoothLeAdvertiser?.stopAdvertising(it)
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

            // [NORDIC_010] Verificar que podemos obtener el adapter
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

    // [NORDIC_010] FIX: setupGattServer recibe adapter como parámetro
    private fun setupGattServer(adapter: BluetoothAdapter) {
        try {
            if (gattServer != null) return
            
            // [NORDIC_010] Usar adapter para obtener el manager si es necesario
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
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )
            
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
            
            napLog(NAP_BLE_INIT_007, "GattServer configurado correctamente")
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
                    connectedDevices[device.address] = device
                    napLog(NAP_BLE_CONNECTED, "Dispositivo conectado: ${device.address}")
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceId", device.address)
                        put("name", device.name ?: "Unknown")
                    })
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedDevices.remove(device.address)
                    gattClients.remove(device.address)
                    napLog(NAP_BLE_INIT_003, "Dispositivo desconectado: ${device.address}")
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
                        data.put("napVersion", "3.0.4")
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
                            notifyListeners("onPayloadReceived", JSObject().apply {
                                put("deviceId", device.address)
                                put("data", String(data))
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
                            // [NORDIC_010] FIX v3.0.4: Leer nombre del scanRecord si device.name es null
                            val displayName = device.name 
                                ?: result.scanRecord?.deviceName 
                                ?: "NEXO Device"
                            
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

    // ============================================================
    // [NORDIC_010] FIX v3.0.3: startAdvertise() - Validación robusta de advertiser
    // ============================================================
    @PluginMethod
    fun startAdvertise(call: PluginCall) {
        if (!validateSystemHealth(call, "advertise")) return
        if (!canAccessBluetooth()) {
            napError(call, NAP_BLE_ERR_PERMISSION_DENIED, "Sin permisos para anunciar")
            return
        }
        
        if (isAdvertising) {
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
            
            // [NORDIC_010] FIX v3.0.3: Verificar que el dispositivo soporta advertising
            if (!adapter.isMultipleAdvertisementSupported) {
                napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, 
                    "Este dispositivo no soporta BLE Advertising", "ERROR")
                return
            }
            
            // [NORDIC_010] FIX v3.0.3: Obtener advertiser y verificar que no es null
            val advertiser = adapter.bluetoothLeAdvertiser
            if (advertiser == null) {
                // Determinar la causa exacta para reportar error preciso
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                    ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADVERTISE) 
                    != PackageManager.PERMISSION_GRANTED) {
                    napError(call, NAP_BLE_ADV_NO_PERMISSION, 
                        "BLUETOOTH_ADVERTISE no concedido. El advertising requiere este permiso en Android 12+.", 
                        "ERROR", recoverable = true)
                } else if (!adapter.isEnabled) {
                    napError(call, NAP_BLE_ERR_DISABLED, 
                        "Bluetooth está desactivado. Actívalo para poder anunciar.", 
                        "ERROR", recoverable = true)
                } else {
                    napError(call, NAP_BLE_ERR_ADVERTISE_FAILED, 
                        "BluetoothLeAdvertiser no disponible. Posible causa: permiso ADVERTISE denegado o no soportado.", 
                        "ERROR", recoverable = true)
                }
                return
            }
            
            val settings = AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(true)
                .build()
            
            // [NORDIC_010] FIX v3.0.4: Incluir nombre del dispositivo en advertising
            val data = AdvertiseData.Builder()
                .setIncludeDeviceName(true)
                .addServiceUuid(ParcelUuid(SERVICE_UUID))
                .build()
            
            advertiseCallback = object : AdvertiseCallback() {
                override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                    isAdvertising = true
                    napLog(NAP_BLE_ADVERTISE_STARTED, "Advertising iniciado correctamente")
                    notifyListeners("onAdvertiseStarted", JSObject().apply {
                        put("success", true)
                        put("timestamp", System.currentTimeMillis())
                    })
                }
                
                override fun onStartFailure(errorCode: Int) {
                    isAdvertising = false
                    napLog(NAP_BLE_ERR_ADVERTISE_FAILED, "Advertising failed: $errorCode", "ERROR")
                    notifyListeners("onAdvertiseFailed", JSObject().apply {
                        put("errorCode", errorCode)
                        put("errorName", when(errorCode) {
                            ADVERTISE_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                            ADVERTISE_FAILED_DATA_TOO_LARGE -> "DATA_TOO_LARGE"
                            ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "TOO_MANY_ADVERTISERS"
                            ADVERTISE_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                            ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
                            else -> "UNKNOWN"
                        })
                    })
                }
            }
            
            // [NORDIC_010] FIX v3.0.3: Iniciar advertising con advertiser verificado
            advertiser.startAdvertising(settings, data, advertiseCallback!!)
            
            // [NORDIC_010] FIX v3.0.3: Resolver indicando que se ENVIÓ el comando nativo
            // El estado real se confirma vía onAdvertiseStarted / onAdvertiseFailed
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

    // ============================================================
    // [NORDIC_010] FIX v3.0.4: connectToDevice - Notifica conexión/desconexión al JS
    // ============================================================
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
        
        try {
            val adapter = getBluetoothAdapter()
            if (adapter == null) {
                call.reject(NAP_BLE_ERR_NOT_SUPPORTED, "Adapter no disponible")
                return
            }
            
            val device = adapter.getRemoteDevice(deviceId)
            if (device == null) {
                call.reject(ERR_DEVICE_NOT_FOUND, "Dispositivo no encontrado")
                return
            }
            
            val gatt = device.connectGatt(context, false, object : BluetoothGattCallback() {
                override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                    when (newState) {
                        BluetoothProfile.STATE_CONNECTED -> {
                            gattClients[deviceId] = gatt
                            // [NORDIC_010] FIX v3.0.4: Notificar a JS que el dispositivo se conectó
                            notifyListeners("onDeviceConnected", JSObject().apply {
                                put("deviceId", deviceId)
                                put("name", device.name ?: "Unknown")
                            })
                            try {
                                gatt.requestMtu(MTU_DEFAULT)
                                gatt.discoverServices()
                            } catch (e: SecurityException) {
                                napLog(NAP_BLE_ERR_SECURITY_EXCEPTION, "Error configurando MTU", "ERROR")
                            }
                        }
                        BluetoothProfile.STATE_DISCONNECTED -> {
                            gattClients.remove(deviceId)
                            gatt.close()
                            // [NORDIC_010] FIX v3.0.4: Notificar a JS que el dispositivo se desconectó
                            notifyListeners("onDeviceDisconnected", JSObject().apply {
                                put("deviceId", deviceId)
                            })
                        }
                    }
                }
                
                override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                    napLog(NAP_BLE_READY, "MTU configurado: $mtu")
                }
                
                override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                    notifyListeners("onServicesDiscovered", JSObject().apply {
                        put("deviceId", deviceId)
                        put("status", status)
                    })
                }
            })
            
            call.resolve(JSObject().apply {
                put("connecting", true)
                put("deviceId", deviceId)
            })
        } catch (e: IllegalArgumentException) {
            call.reject(ERR_DEVICE_NOT_FOUND, "Dirección Bluetooth inválida")
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException en connect: ${e.message}")
        }
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        if (deviceId == null) {
            call.reject(ERR_INVALID_PARAMS, "deviceId requerido")
            return
        }
        
        gattClients[deviceId]?.let { gatt ->
            try {
                gatt.disconnect()
                gatt.close()
            } catch (e: Exception) {
                Log.w(TAG, "Error desconectando: ${e.message}")
            }
            gattClients.remove(deviceId)
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
        
        val payload = message?.toByteArray() ?: android.util.Base64.decode(data, android.util.Base64.DEFAULT)
        
        if (payload.size > CHUNK_SIZE * 10) {
            call.reject(ERR_MESSAGE_TOO_LARGE, "Mensaje excede tamaño máximo permitido")
            return
        }
        
        val gatt = gattClients[deviceId]
        if (gatt == null) {
            call.reject(ERR_NOT_CONNECTED, "No conectado a dispositivo")
            return
        }
        
        try {
            val service = gatt.getService(SERVICE_UUID)
            val char = service?.getCharacteristic(CHAR_PAYLOAD)
            
            if (char == null) {
                call.reject(ERR_NOT_CONNECTED, "Característica no encontrada")
                return
            }
            
            // Fragmentar si es necesario
            if (payload.size <= CHUNK_SIZE) {
                char.value = payload
                gatt.writeCharacteristic(char)
            } else {
                val chunks = payload.toList().chunked(CHUNK_SIZE)
                chunks.forEachIndexed { index, chunk ->
                    val chunkBytes = chunk.toByteArray()
                    char.value = chunkBytes
                    gatt.writeCharacteristic(char)
                }
            }
            
            call.resolve(JSObject().apply {
                put("sent", true)
                put("bytes", payload.size)
                put("chunks", if (payload.size > CHUNK_SIZE) (payload.size / CHUNK_SIZE) + 1 else 1)
            })
            
            napLog(NAP_BLE_MESSAGE_SENT, "Mensaje enviado (${payload.size} bytes)")
        } catch (e: SecurityException) {
            napError(call, NAP_BLE_ERR_SECURITY_EXCEPTION, "SecurityException enviando mensaje: ${e.message}")
        }
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val devices = JSArray()
        connectedDevices.forEach { (address, device) ->
            try {
                val obj = JSObject()
                obj.put("deviceId", address)
                obj.put("name", device.name ?: "Unknown")
                devices.put(obj)
            } catch (e: SecurityException) {
                // Skip
            }
        }
        
        val result = JSObject()
        result.put("devices", devices)
        call.resolve(result)
    }

    // ============================================================
    // [NORDIC_010] FEATURE v3.0.4: getLocalDeviceInfo - Nombre del dispositivo local
    // ============================================================
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

    // ============================================================
    // [REM v3.0.1] ALIASES PARA COMPATIBILIDAD NORDIC MESH
    // ============================================================
    
    /**
     * Alias de startAdvertise() para compatibilidad con código que usa
     * el nombre startAdvertising() (con 'g' al final)
     */
    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        napLog(NAP_BLE_ADVERTISE_STARTED, "startAdvertising() llamado - delegando a startAdvertise()")
        startAdvertise(call)
    }
    
    /**
     * Alias de stopAdvertise() para compatibilidad con código que usa
     * el nombre stopAdvertising() (con 'g' al final)
     */
    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        napLog(NAP_BLE_INIT_006, "stopAdvertising() llamado - delegando a stopAdvertise()")
        stopAdvertise(call)
    }
    
    /**
     * NUEVO: Consulta si el advertising está activo actualmente
     * Resuelve el problema de "Visibilidad desactivada" cuando sí está activo
     */
    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val result = JSObject()
        result.put("isAdvertising", isAdvertising)
        result.put("timestamp", System.currentTimeMillis())
        result.put("nap_code", if (isAdvertising) "ADVERTISING_ACTIVE" else "ADVERTISING_INACTIVE")
        call.resolve(result)
    }

} // Cierre de clase
