package com.nexo.ble

import android.app.Activity
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
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
        const val TAG = "NexoBLE"
        val SERVICE_UUID = NexoGattService.SERVICE_UUID
        val CHAR_ANNOUNCE = NexoGattService.ANNOUNCE_CHAR_UUID
        val CHAR_HANDSHAKE = NexoGattService.HANDSHAKE_CHAR_UUID
        val CHAR_PAYLOAD = NexoGattService.PAYLOAD_CHAR_UUID
        val CHAR_CONTROL = NexoGattService.CONTROL_CHAR_UUID
        
        const val MTU_DEFAULT = 512
        const val CHUNK_SIZE = 507
        const val ERR_BLUETOOTH_NOT_SUPPORTED = "BLE_001"
        const val ERR_BLUETOOTH_DISABLED = "BLE_002"
        const val ERR_PERMISSION_DENIED = "BLE_003"
        const val ERR_ADVERTISE_FAILED = "BLE_004"
        const val ERR_SCAN_FAILED = "BLE_005"
        const val ERR_DEVICE_NOT_FOUND = "BLE_006"
        const val ERR_CONNECTION_FAILED = "BLE_007"
        const val ERR_MESSAGE_TOO_LARGE = "BLE_008"
        const val ERR_INVALID_PARAMS = "BLE_019"
        const val ERR_NOT_CONNECTED = "BLE_011"
        const val ERR_PERMISSIONS_PENDING = "BLE_012"
        
        const val REQUEST_ENABLE_BT = 1001
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
    private var pendingInitializeCall: PluginCall? = null
    private var pendingPermissionCall: PluginCall? = null
    private var pendingAction: String? = null

    override fun load() {
        Log.d(TAG, "NexoBLE Plugin v2.2-Android14-Fixed loaded")
    }

    // ==================== PERMISOS MEJORADOS ====================

    @PluginMethod
    fun checkPermissions(call: PluginCall) {
        val result = JSObject()
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            result.put("bluetoothScan", hasPermission("bluetoothScan") as Any)
            result.put("bluetoothConnect", hasPermission("bluetoothConnect") as Any)
            result.put("bluetoothAdvertise", hasPermission("bluetoothAdvertise") as Any)
            
            val allGranted = hasPermission("bluetoothScan") && 
                           hasPermission("bluetoothConnect") && 
                           hasPermission("bluetoothAdvertise")
            result.put("allGranted", allGranted as Any)
            
            if (!allGranted) {
                val missing = JSONArray()
                if (!hasPermission("bluetoothScan")) missing.put("BLUETOOTH_SCAN")
                if (!hasPermission("bluetoothConnect")) missing.put("BLUETOOTH_CONNECT")
                if (!hasPermission("bluetoothAdvertise")) missing.put("BLUETOOTH_ADVERTISE")
                result.put("missing", missing as Any)
            }
        } else {
            val locationGranted = hasPermission("location")
            result.put("location", locationGranted as Any)
            result.put("allGranted", locationGranted as Any)
        }
        
        call.resolve(result)
    }

    @PluginMethod
    fun requestPermissions(call: PluginCall) {
        pendingPermissionCall = call
        pendingAction = call.getString("forAction") ?: "general"
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // FIX: Solicitar todos los permisos faltantes, no solo el primero
            val missingPerms = mutableListOf<String>()
            if (!hasPermission("bluetoothConnect")) missingPerms.add("bluetoothConnect")
            if (!hasPermission("bluetoothScan")) missingPerms.add("bluetoothScan")
            if (!hasPermission("bluetoothAdvertise")) missingPerms.add("bluetoothAdvertise")
            
            if (missingPerms.isEmpty()) {
                val result = JSObject()
                result.put("granted", true as Any)
                result.put("message", "All permissions already granted" as Any)
                call.resolve(result)
                return
            }
            
            // Solicitar el primero, los demás se encadenan en el callback
            requestPermissionForAlias(missingPerms.first(), call, "multiPermissionCallback")
        } else {
            if (!hasPermission("location")) {
                requestPermissionForAlias("location", call, "locationPermissionCallback")
            } else {
                call.resolve(JSObject().put("granted", true))
            }
        }
    }

    @PermissionCallback
    private fun multiPermissionCallback(call: PluginCall) {
        // Verificar qué permisos aún faltan y solicitar el siguiente
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            when {
                !hasPermission("bluetoothConnect") -> {
                    requestPermissionForAlias("bluetoothConnect", call, "multiPermissionCallback")
                    return
                }
                !hasPermission("bluetoothScan") -> {
                    requestPermissionForAlias("bluetoothScan", call, "multiPermissionCallback")
                    return
                }
                !hasPermission("bluetoothAdvertise") -> {
                    requestPermissionForAlias("bluetoothAdvertise", call, "multiPermissionCallback")
                    return
                }
            }
        }
        
        // Todos los permisos procesados
        val allGranted = hasRequiredPermissions()
        val result = JSObject()
        result.put("granted", allGranted as Any)
        result.put("message", if (allGranted) "All permissions granted" else "Some permissions denied" as Any)
        
        notifyListeners("onPermissionsChanged", result)
        call.resolve(result)
        
        // Si había una acción pendiente, notificar
        pendingPermissionCall?.let {
            it.resolve(result)
            pendingPermissionCall = null
        }
    }

    @PermissionCallback
    private fun locationPermissionCallback(call: PluginCall) {
        val granted = hasPermission("location")
        val result = JSObject()
        result.put("granted", granted as Any)
        call.resolve(result)
        notifyListeners("onPermissionsChanged", result)
    }

    // ==================== INICIALIZACIÓN CORREGIDA ====================

    @PluginMethod
    fun initialize(call: PluginCall) {
        userId = call.getString("userId") ?: generateUserId()
        
        // FIX: Siempre verificar permisos primero explícitamente
        if (!hasRequiredPermissions()) {
            pendingInitializeCall = call
            Log.d(TAG, "Initialize: Permissions missing, requesting...")
            
            // Notificar al frontend que estamos esperando permisos
            val status = JSObject()
            status.put("status", "awaiting_permissions" as Any)
            status.put("message", "Bluetooth permissions required for Android 14+" as Any)
            notifyListeners("onInitializationStatus", status)
            
            requestAllPermissionsSequentially(call)
            return
        }
        
        performInitialization(call)
    }

    private fun requestAllPermissionsSequentially(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!hasPermission("bluetoothConnect")) {
                requestPermissionForAlias("bluetoothConnect", call, "initPermissionCallback")
                return
            }
            if (!hasPermission("bluetoothScan")) {
                requestPermissionForAlias("bluetoothScan", call, "initPermissionCallback")
                return
            }
            if (!hasPermission("bluetoothAdvertise")) {
                requestPermissionForAlias("bluetoothAdvertise", call, "initPermissionCallback")
                return
            }
        } else {
            if (!hasPermission("location")) {
                requestPermissionForAlias("location", call, "initPermissionCallback")
                return
            }
        }
        
        // Si llegamos aquí, tenemos todos los permisos
        pendingInitializeCall?.let {
            performInitialization(it)
            pendingInitializeCall = null
        }
    }

    @PermissionCallback
    private fun initPermissionCallback(call: PluginCall) {
        if (hasRequiredPermissions()) {
            pendingInitializeCall?.let {
                performInitialization(it)
                pendingInitializeCall = null
            } ?: call.resolve(JSObject().put("status", "permissions_granted"))
        } else {
            // Aún faltan permisos, continuar solicitando
            requestAllPermissionsSequentially(call)
        }
    }

    private fun performInitialization(call: PluginCall) {
        if (!initializeAdapter()) {
            val error = JSObject()
            error.put("error", "Cannot access Bluetooth adapter" as Any)
            error.put("code", ERR_BLUETOOTH_NOT_SUPPORTED as Any)
            error.put("details", "Check if Bluetooth is enabled and permissions are granted" as Any)
            call.reject(ERR_BLUETOOTH_NOT_SUPPORTED, error.toString())
            return
        }
        
        val adapter = bluetoothAdapter
        if (adapter == null) {
            call.reject(ERR_BLUETOOTH_NOT_SUPPORTED, "Device does not support Bluetooth")
            return
        }
        
        // FIX: Verificar estado exacto del adapter
        if (!adapter.isEnabled) {
            Log.d(TAG, "Bluetooth disabled, requesting activation...")
            pendingInitializeCall = call
            requestBluetoothActivation()
            return
        }
        
        try {
            setupGattServer()
            val result = JSObject()
            result.put("userId", userId as Any)
            result.put("status", "initialized" as Any)
            result.put("version", "2.2-Android14-Fixed" as Any)
            result.put("bluetoothState", "ON" as Any)
            result.put("native", true as Any)
            result.put("permissions", true as Any)
            call.resolve(result)
            Log.d(TAG, "Initialized successfully with userId: $userId")
            
            // Notificar éxito
            notifyListeners("onReady", result)
        } catch (e: Exception) {
            Log.e(TAG, "Initialize failed", e)
            call.reject("INIT_FAILED", e.message)
        }
    }

    private fun canAccessBluetooth(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) == 
                PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    private fun initializeAdapter(): Boolean {
        if (!canAccessBluetooth()) {
            Log.e(TAG, "BLUETOOTH_CONNECT permission not granted")
            return false
        }

        if (bluetoothManager == null) {
            bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        }
        
        bluetoothAdapter = bluetoothManager?.adapter
        return bluetoothAdapter != null
    }

    private fun hasRequiredPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            hasPermission("bluetoothScan") && hasPermission("bluetoothConnect") && hasPermission("bluetoothAdvertise")
        } else {
            hasPermission("location")
        }
    }

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        if (!hasRequiredPermissions()) {
            val result = JSObject()
            result.put("enabled", false as Any)
            result.put("state", "NO_PERMISSION" as Any)
            result.put("error", "Permissions not granted" as Any)
            call.resolve(result)
            return
        }
        
        if (!initializeAdapter()) {
            val result = JSObject()
            result.put("enabled", false as Any)
            result.put("state", "ERROR" as Any)
            call.resolve(result)
            return
        }
        
        val result = JSObject()
        val adapter = bluetoothAdapter
        val state = adapter?.state ?: BluetoothAdapter.STATE_OFF
        
        result.put("enabled", adapter?.isEnabled == true as Any)
        result.put("state", when(state) {
            BluetoothAdapter.STATE_OFF -> "OFF"
            BluetoothAdapter.STATE_ON -> "ON"
            BluetoothAdapter.STATE_TURNING_ON -> "TURNING_ON"
            BluetoothAdapter.STATE_TURNING_OFF -> "TURNING_OFF"
            else -> "UNKNOWN"
        } as Any)
        
        call.resolve(result)
    }

    // ==================== MÉTODOS BLE CON VALIDACIÓN ESTRICTA ====================

    @PluginMethod
    fun startScan(call: PluginCall) {
        // FIX: Verificación estricta de permisos antes de operar
        if (!hasRequiredPermissions()) {
            val error = JSObject()
            error.put("code", ERR_PERMISSION_DENIED as Any)
            error.put("message", "BLUETOOTH_SCAN permission required. Call requestPermissions() first." as Any)
            error.put("action", "requestPermissions" as Any)
            call.reject(ERR_PERMISSION_DENIED, error.toString())
            return
        }
        
        if (!ensureReady(call)) return
        
        startScanInternal(call)
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        if (!hasRequiredPermissions()) {
            call.reject(ERR_PERMISSION_DENIED, "BLUETOOTH_ADVERTISE permission required")
            return
        }
        if (!ensureReady(call)) return
        startAdvertisingInternal(call)
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        if (!hasRequiredPermissions()) {
            call.reject(ERR_PERMISSION_DENIED, "BLUETOOTH_CONNECT permission required")
            return
        }
        if (!ensureReady(call)) return
        
        val deviceId = call.getString("deviceId") ?: run {
            call.reject(ERR_INVALID_PARAMS, "deviceId is required")
            return
        }
        
        // ... resto del código de connect igual ...
        connectInternal(call, deviceId)
    }

    // ==================== MÉTODOS INTERNOS (sin cambios mayores) ====================

    private fun ensureReady(call: PluginCall): Boolean {
        if (!initializeAdapter()) {
            call.reject(ERR_BLUETOOTH_NOT_SUPPORTED, "Cannot initialize Bluetooth adapter")
            return false
        }
        
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            call.reject(ERR_BLUETOOTH_DISABLED, "Bluetooth is disabled")
            return false
        }
        
        return true
    }

    private fun startScanInternal(call: PluginCall) {
        val scanner = bluetoothAdapter?.bluetoothLeScanner ?: run {
            call.reject("SCANNER_UNAVAILABLE", "Bluetooth LE Scanner not available. Is Bluetooth enabled?")
            return
        }

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .build()

        scanCallback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                result?.let { processScanResult(it) }
            }
            override fun onScanFailed(errorCode: Int) {
                val eventData = JSObject()
                eventData.put("error", errorCode as Any)
                notifyListeners("onScanFailed", eventData)
            }
        }

        try {
            scanner.startScan(listOf(filter), settings, scanCallback)
            isScanning = true
            call.resolve(JSObject().put("scanning", true as Any))
        } catch (e: Exception) {
            call.reject(ERR_SCAN_FAILED, e.message)
        }
    }

    private fun startAdvertisingInternal(call: PluginCall) {
        // ... igual que antes ...
    }

    private fun connectInternal(call: PluginCall, deviceId: String) {
        // ... código de connect igual ...
    }

    private fun processScanResult(result: ScanResult) {
        // ... igual ...
    }

    private fun setupGattServer() {
        // ... igual ...
    }

    private fun requestBluetoothActivation() {
        val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
        try {
            startActivityForResult(null, enableBtIntent, REQUEST_ENABLE_BT)
        } catch (e: Exception) {
            Log.e(TAG, "Cannot request BT activation", e)
        }
    }

    override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.handleOnActivityResult(requestCode, resultCode, data)
        
        if (requestCode == REQUEST_ENABLE_BT) {
            if (resultCode == Activity.RESULT_OK) {
                Log.d(TAG, "Bluetooth enabled by user")
                handler.postDelayed({
                    pendingInitializeCall?.let { call ->
                        performInitialization(call)
                        pendingInitializeCall = null
                    }
                }, 800)
            } else {
                pendingInitializeCall?.reject(ERR_BLUETOOTH_DISABLED, "Bluetooth activation denied")
                pendingInitializeCall = null
            }
        }
    }

    // ... helpers generateUserId, bytesToHex, hexToBytes, etc. igual que antes ...
    private fun generateUserId(): String = UUID.randomUUID().toString().replace("-", "").take(32)
    private fun bytesToHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
    private fun hexToBytes(hex: String): ByteArray {
        val cleanHex = hex.replace("-", "").replace(":", "")
        return if (cleanHex.length % 2 == 0) {
            cleanHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        } else ByteArray(0)
    }
}
