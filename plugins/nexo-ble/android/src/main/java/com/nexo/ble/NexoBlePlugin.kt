package com.nexo.ble

import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.UUID

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
        const val TAG = "NAP-BLE-Bridge"
        const val PREFS_NAME = "nexo_ble_prefs"
        const val PREF_DEVICE_UUID = "device_uuid"

        const val ACTION_SCAN_RESULT = "com.nexo.ble.SCAN_RESULT"
        const val ACTION_SCAN_FAILED = "com.nexo.ble.SCAN_FAILED"
        const val ACTION_SCAN_STOPPED = "com.nexo.ble.SCAN_STOPPED"
        const val ACTION_ADVERT_STATE = "com.nexo.ble.ADVERT_STATE"
        const val ACTION_MESSAGE_RECEIVED = "com.nexo.ble.MESSAGE_RECEIVED"
        const val ACTION_MESSAGE_SENT = "com.nexo.ble.MESSAGE_SENT"
        const val ACTION_DEVICE_CONNECTED = "com.nexo.ble.DEVICE_CONNECTED"
        const val ACTION_DEVICE_DISCONNECTED = "com.nexo.ble.DEVICE_DISCONNECTED"
        const val ACTION_SERVICES_READY = "com.nexo.ble.SERVICES_READY"
        const val ACTION_NOTIFICATIONS_ENABLED = "com.nexo.ble.NOTIFICATIONS_ENABLED"
        const val ACTION_CONNECTION_FAILED = "com.nexo.ble.CONNECTION_FAILED"
        const val ACTION_RETRY_SCHEDULED = "com.nexo.ble.RETRY_SCHEDULED"
        const val ACTION_PEER_INFO_RECEIVED = "com.nexo.ble.PEER_INFO_RECEIVED"
        const val ACTION_CLIENT_NOTIFICATION_STATE_CHANGED = "com.nexo.ble.CLIENT_NOTIFICATION_STATE_CHANGED"
        const val ACTION_NAP_AUDIT = "com.nexo.ble.NAP_AUDIT"

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
    }

    private val handler = Handler(Looper.getMainLooper())
    private var bleService: BleService? = null
    private var serviceBound = false
    private val pendingCalls = mutableListOf<Runnable>()
    private var userId: String = ""
    private var userName: String = "NEXO User"

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? BleService.LocalBinder
            bleService = binder?.getService()
            serviceBound = true
            napLog("REM-BRIDGE-001", "onServiceConnected — BleService vinculado OK bound=$serviceBound", "INFO")
            notifyListeners("bridgeReady", JSObject().apply {
                put("ready", true)
                put("timestamp", System.currentTimeMillis())
            })
            napLog("REM-BRIDGE-002", "Pending calls: ${pendingCalls.size}", "INFO")
            pendingCalls.forEach { it.run() }
            pendingCalls.clear()
            napLog("REM-BRIDGE-003", "Pending calls ejecutados y limpiados", "INFO")
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            bleService = null
            serviceBound = false
            napLog("REM-BRIDGE-004", "onServiceDisconnected — BleService desvinculado", "WARN")
        }
    }

    private val serviceEventReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val action = intent.action ?: "null"
            napLog("REM-BRIDGE-005", "Broadcast recibido: action=$action", "DEBUG")
            when (action) {
                ACTION_SCAN_RESULT -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: run {
                        napLog("REM-BRIDGE-006", "SCAN_RESULT sin device_address", "WARN")
                        return
                    }
                    val name = intent.getStringExtra(EXTRA_DEVICE_NAME) ?: "NEXO Device"
                    val rssi = intent.getIntExtra(EXTRA_RSSI, 0)
                    napLog("REM-BRIDGE-007", "SCAN_RESULT → JS: addr=${deviceId.take(8)} name=$name rssi=$rssi", "INFO")
                    notifyListeners("onScanResult", JSObject().apply {
                        put("address", deviceId)
                        put("deviceId", deviceId)
                        put("name", name)
                        put("rssi", rssi)
                    })
                }
                ACTION_SCAN_FAILED -> {
                    val code = intent.getIntExtra(EXTRA_ERROR_CODE, -1)
                    val desc = intent.getStringExtra(EXTRA_ERROR_DESC) ?: "Unknown"
                    napLog("REM-BRIDGE-008", "SCAN_FAILED → JS: code=$code desc=$desc", "ERROR")
                    notifyListeners("onScanFailed", JSObject().apply {
                        put("errorCode", code)
                        put("description", desc)
                    })
                }
                ACTION_SCAN_STOPPED -> {
                    val count = intent.getIntExtra("result_count", 0)
                    napLog("REM-BRIDGE-009", "SCAN_STOPPED → JS: count=$count", "INFO")
                    notifyListeners("onScanStopped", JSObject().apply {
                        put("resultCount", count)
                    })
                }
                ACTION_ADVERT_STATE -> {
                    val advertising = intent.getBooleanExtra(EXTRA_ADVERTISING, false)
                    val reason = intent.getStringExtra(EXTRA_REASON) ?: ""
                    napLog("REM-BRIDGE-010", "ADVERT_STATE → JS: advertising=$advertising reason=$reason", "INFO")
                    notifyListeners("onAdvertStateChange", JSObject().apply {
                        put("advertising", advertising)
                        if (reason.isNotEmpty()) put("reason", reason)
                    })
                }
                ACTION_DEVICE_CONNECTED -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val direction = intent.getStringExtra(EXTRA_DIRECTION) ?: "unknown"
                    val attempt = intent.getIntExtra(EXTRA_ATTEMPT, 0)
                    napLog("REM-BRIDGE-011", "DEVICE_CONNECTED → JS: addr=${deviceId.take(8)} dir=$direction attempt=$attempt", "INFO")
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceId", deviceId)
                        put("direction", direction)
                        put("attempt", attempt)
                    })
                }
                ACTION_DEVICE_DISCONNECTED -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val wasReady = intent.getBooleanExtra("wasReady", false)
                    napLog("REM-BRIDGE-012", "DEVICE_DISCONNECTED → JS: addr=${deviceId.take(8)} wasReady=$wasReady", "INFO")
                    notifyListeners("onDeviceDisconnected", JSObject().apply {
                        put("deviceId", deviceId)
                        put("wasReady", wasReady)
                    })
                }
                ACTION_SERVICES_READY -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val success = intent.getBooleanExtra(EXTRA_SUCCESS, false)
                    napLog("REM-BRIDGE-013", "SERVICES_READY → JS: addr=${deviceId.take(8)} success=$success", "INFO")
                    notifyListeners("onServicesReady", JSObject().apply {
                        put("deviceId", deviceId)
                        put("ready", success)
                    })
                }
                ACTION_NOTIFICATIONS_ENABLED -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val enabled = intent.getBooleanExtra(EXTRA_ENABLED, false)
                    napLog("REM-BRIDGE-014", "NOTIFICATIONS_ENABLED → JS: addr=${deviceId.take(8)} enabled=$enabled", "INFO")
                    notifyListeners("onNotificationsEnabled", JSObject().apply {
                        put("deviceId", deviceId)
                        put("enabled", enabled)
                    })
                }
                ACTION_CONNECTION_FAILED -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val reason = intent.getStringExtra(EXTRA_REASON) ?: "Unknown"
                    val attempt = intent.getIntExtra(EXTRA_ATTEMPT, 0)
                    val maxAttempts = intent.getIntExtra(EXTRA_MAX_ATTEMPTS, 3)
                    napLog("REM-BRIDGE-015", "CONNECTION_FAILED → JS: addr=${deviceId.take(8)} reason=$reason attempt=$attempt", "ERROR")
                    notifyListeners("onConnectionFailed", JSObject().apply {
                        put("deviceId", deviceId)
                        put("reason", reason)
                        put("attempt", attempt)
                        put("maxAttempts", maxAttempts)
                        put("recoverable", attempt < maxAttempts)
                    })
                }
                ACTION_MESSAGE_RECEIVED -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val senderName = intent.getStringExtra(EXTRA_SENDER_NAME) ?: "NEXO Peer"
                    val content = intent.getStringExtra(EXTRA_CONTENT) ?: ""
                    val data = intent.getStringExtra(EXTRA_DATA) ?: ""
                    val messageId = intent.getStringExtra(EXTRA_MESSAGE_ID) ?: ""
                    val source = intent.getStringExtra(EXTRA_SOURCE) ?: "unknown"
                    val timestamp = intent.getLongExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                    napLog("REM-BRIDGE-016", "MESSAGE_RECEIVED → JS: addr=${deviceId.take(8)} sender=$senderName mid=$messageId", "INFO")
                    notifyListeners("onMessageReceived", JSObject().apply {
                        put("address", deviceId)
                        put("deviceId", deviceId)
                        put("data", data)
                        put("message", data)
                        put("content", content)
                        put("senderName", senderName)
                        put("messageId", messageId)
                        put("source", source)
                        put("timestamp", timestamp)
                    })
                }
                ACTION_MESSAGE_SENT -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val mid = intent.getStringExtra(EXTRA_MESSAGE_ID) ?: ""
                    val ok = intent.getBooleanExtra(EXTRA_SUCCESS, false)
                    napLog("REM-BRIDGE-017", "MESSAGE_SENT → JS: addr=${deviceId.take(8)} mid=$mid success=$ok", "INFO")
                    notifyListeners("onMessageSent", JSObject().apply {
                        put("deviceId", deviceId)
                        put("messageId", mid)
                        put("success", ok)
                    })
                }
                ACTION_PEER_INFO_RECEIVED -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val name = intent.getStringExtra(EXTRA_DEVICE_NAME) ?: "NEXO Peer"
                    val peerId = intent.getStringExtra(EXTRA_USER_ID) ?: ""
                    napLog("REM-BRIDGE-018", "PEER_INFO → JS: addr=${deviceId.take(8)} name=$name", "INFO")
                    notifyListeners("onPeerInfoReceived", JSObject().apply {
                        put("deviceId", deviceId)
                        put("name", name)
                        put("userId", peerId)
                    })
                }
                ACTION_NAP_AUDIT -> {
                    val code = intent.getStringExtra(EXTRA_NAP_CODE) ?: ""
                    val message = intent.getStringExtra(EXTRA_NAP_MESSAGE) ?: ""
                    val level = intent.getStringExtra(EXTRA_NAP_LEVEL) ?: "INFO"
                    val ts = intent.getLongExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                    notifyListeners("napAuditEvent", JSObject().apply {
                        put("code", code)
                        put("message", message)
                        put("level", level)
                        put("timestamp", ts)
                        put("native", true)
                    })
                }
                else -> {
                    napLog("REM-BRIDGE-019", "Broadcast action desconocida: $action", "WARN")
                }
            }
        }
    }

    // FIX CRASH: No iniciar foreground service si no hay permisos
    override fun load() {
        napLog("REM-BRIDGE-020", "load() — INICIO v5.2.6-ARCH", "INFO")
        
        // CRITICAL FIX: Si no hay permisos, NO iniciar service (evita crash en solicitud)
        if (!canAccessBluetooth()) {
            napLog("REM-BRIDGE-020b", "Sin permisos al cargar, omitiendo startForegroundService", "WARN")
            registerReceiverOnly()
            return
        }
        
        startServiceAndBind()
        napLog("REM-BRIDGE-025", "load() — FIN (con permisos)", "INFO")
    }

    private fun registerReceiverOnly() {
        val filter = IntentFilter().apply {
            addAction(ACTION_SCAN_RESULT); addAction(ACTION_SCAN_FAILED); addAction(ACTION_SCAN_STOPPED)
            addAction(ACTION_ADVERT_STATE); addAction(ACTION_MESSAGE_RECEIVED); addAction(ACTION_MESSAGE_SENT)
            addAction(ACTION_DEVICE_CONNECTED); addAction(ACTION_DEVICE_DISCONNECTED); addAction(ACTION_SERVICES_READY)
            addAction(ACTION_NOTIFICATIONS_ENABLED); addAction(ACTION_CONNECTION_FAILED); addAction(ACTION_RETRY_SCHEDULED)
            addAction(ACTION_PEER_INFO_RECEIVED); addAction(ACTION_CLIENT_NOTIFICATION_STATE_CHANGED); addAction(ACTION_NAP_AUDIT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(serviceEventReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(serviceEventReceiver, filter)
        }
        napLog("REM-BRIDGE-024", "Receiver registrado (service NO iniciado aún)", "INFO")
    }

    private fun startServiceAndBind() {
        val serviceIntent = Intent(context, BleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            napLog("REM-BRIDGE-021", "startForegroundService() llamado", "INFO")
            context.startForegroundService(serviceIntent)
        } else {
            napLog("REM-BRIDGE-022", "startService() llamado", "INFO")
            context.startService(serviceIntent)
        }
        napLog("REM-BRIDGE-023", "bindService() llamado", "INFO")
        context.bindService(serviceIntent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    override fun handleOnDestroy() {
        napLog("REM-BRIDGE-026", "handleOnDestroy() — INICIO", "INFO")
        try {
            if (serviceBound) {
                context.unbindService(serviceConnection)
                serviceBound = false
            }
            context.unregisterReceiver(serviceEventReceiver)
        } catch (e: Exception) { napLog("REM-BRIDGE-027", "Error en destroy: ${e.message}", "WARN") }
        super.handleOnDestroy()
        napLog("REM-BRIDGE-028", "handleOnDestroy() — FIN", "INFO")
    }

    private fun getOrCreateDeviceUUID(): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var uuid = prefs.getString(PREF_DEVICE_UUID, null)
        if (uuid == null || uuid.isBlank()) {
            uuid = UUID.randomUUID().toString()
            prefs.edit().putString(PREF_DEVICE_UUID, uuid).apply()
            napLog("REM-UUID-001", "Nuevo deviceUUID generado: ${uuid.substring(0, 8)}...", "INFO")
        } else {
            napLog("REM-UUID-002", "deviceUUID existente leído: ${uuid.substring(0, 8)}...", "INFO")
        }
        return uuid
    }

    @PluginMethod
    fun getDeviceUUID(call: PluginCall) {
        napLog("REM-UUID-003", "getDeviceUUID() llamado", "INFO")
        val uuid = getOrCreateDeviceUUID()
        call.resolve(JSObject().apply {
            put("deviceUUID", uuid)
            put("shortUUID", uuid.substring(0, 8))
        })
        napLog("REM-UUID-004", "getDeviceUUID() resuelto: ${uuid.substring(0, 8)}...", "INFO")
    }

    private fun canAccessBluetooth(): Boolean {
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }
        napLog("REM-PERM-001", "canAccessBluetooth()=$result SDK=${Build.VERSION.SDK_INT}", "INFO")
        return result
    }

    private fun getBluetoothAdapter(): BluetoothAdapter? {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter
        napLog("REM-BT-001", "getBluetoothAdapter()=${adapter != null} enabled=${adapter?.isEnabled}", "INFO")
        return adapter
    }

    private fun napLog(code: String, message: String, level: String = "INFO") {
        val formatted = "[$code] $message [Bridge:true]"
        when (level) {
            "ERROR" -> Log.e(TAG, formatted)
            "WARN" -> Log.w(TAG, formatted)
            else -> Log.i(TAG, formatted)
        }
    }

    private fun napError(call: PluginCall?, code: String, message: String) {
        napLog(code, message, "ERROR")
        val errorData = JSObject()
        errorData.put("code", code)
        errorData.put("message", message)
        call?.reject(code, "[$code] $message", errorData)
    }

    private fun withService(call: PluginCall?, block: (BleService) -> Unit) {
        val svc = bleService
        if (svc != null) {
            napLog("REM-SVC-001", "withService: BleService disponible, ejecutando block", "INFO")
            block(svc)
            return
        }
        napLog("REM-SVC-002", "withService: BleService null, encolando pending call", "WARN")
        val pending = Runnable {
            val svc2 = bleService
            if (svc2 != null) {
                napLog("REM-SVC-003", "Pending call ejecutado: BleService ahora disponible", "INFO")
                block(svc2)
            } else {
                napLog("REM-SVC-004", "Pending call falló: BleService sigue null", "ERROR")
                call?.reject("BLE_203", "Servicio BLE no disponible")
            }
        }
        pendingCalls.add(pending)
        handler.postDelayed({ pendingCalls.remove(pending) }, 10000)
    }

    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        napLog("REM-PERM-002", "requestBLEPermissions() llamado", "INFO")
        if (canAccessBluetooth()) {
            napLog("REM-PERM-003", "Permisos ya concedidos, resolviendo inmediato", "INFO")
            call.resolve(buildPermissionsResult().apply { put("alreadyGranted", true) })
            return
        }
        saveCall(call)
        napLog("REM-PERM-004", "Solicitando permisos al sistema...", "INFO")
        requestAllPermissions(call, "requestPermissionsCallback")
    }

    // FIX CRASH: try-catch completo + iniciar service SOLO después de permisos
    @PermissionCallback
    private fun requestPermissionsCallback(call: PluginCall) {
        try {
            val result = buildPermissionsResult()
            val allGranted = result.getBoolean("allGranted", false) ?: false
            napLog("REM-PERM-005", "requestPermissionsCallback allGranted=$allGranted", "INFO")
            if (allGranted) {
                // CRITICAL FIX: Iniciar service AHORA que sí hay permisos
                startServiceAndBind()
                call.resolve(result)
            } else {
                napError(call, "BLE_109", "Permisos incompletos")
            }
        } catch (e: Exception) {
            napLog("REM-PERM-ERR", "requestPermissionsCallback CRASH: ${e.message}", "ERROR")
            call.reject("BLE_PERM_CRASH", "Error en callback: ${e.message}")
        }
    }

    private fun buildPermissionsResult(): JSObject {
        val result = JSObject()
        result.put("allGranted", canAccessBluetooth())
        result.put("androidVersion", Build.VERSION.SDK_INT)
        return result
    }

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        val adapter = getBluetoothAdapter()
        val enabled = adapter?.isEnabled == true
        napLog("REM-BT-002", "isBluetoothEnabled()=$enabled", "INFO")
        call.resolve(JSObject().apply {
            put("enabled", enabled)
            put("stateName", if (enabled) "ON" else "OFF")
        })
    }

    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val svc = bleService
        val isAd = svc?.isAdvertising() == true
        napLog("REM-ADVERT-API-001", "isAdvertising()=$isAd", "INFO")
        if (svc != null) {
            call.resolve(JSObject().apply {
                put("isAdvertising", isAd)
                put("timestamp", System.currentTimeMillis())
            })
            return
        }
        call.resolve(JSObject().apply {
            put("isAdvertising", false)
            put("timestamp", System.currentTimeMillis())
            put("pending", true)
        })
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        napLog("REM-INIT-001", "initializeBLE() llamado", "INFO")
        if (!canAccessBluetooth()) {
            napLog("REM-INIT-002", "Sin permisos, solicitando...", "INFO")
            saveCall(call)
            requestPermissionForAlias("bluetoothConnect", call, "initPermissionCallback")
            return
        }
        performInitialization(call)
    }

    @PermissionCallback
    private fun initPermissionCallback(call: PluginCall) {
        napLog("REM-INIT-003", "initPermissionCallback", "INFO")
        if (canAccessBluetooth()) performInitialization(call)
        else napError(call, "BLE_202", "Permisos requeridos no concedidos")
    }

    private fun performInitialization(call: PluginCall) {
        val adapter = getBluetoothAdapter() ?: return napError(call, "BLE_203", "Adapter nulo")

        val passedUserId = call.getString("userId") ?: ""
        userId = if (!passedUserId.isNullOrBlank()) passedUserId else getOrCreateDeviceUUID()
        userName = call.getString("userName") ?: "NEXO User"
        napLog("REM-INIT-004", "performInitialization: userId=${userId.take(8)} name=$userName", "INFO")

        // FIX: Asegurar que el service esté iniciado si no lo estaba
        if (!serviceBound) {
            startServiceAndBind()
        }

        withService(call) { svc -> svc.setUserInfo(userId, userName) }

        val btEnabled = adapter.isEnabled
        napLog("REM-INIT-005", "Resolviendo: initialized=true btEnabled=$btEnabled", "INFO")
        call.resolve(JSObject().apply {
            put("initialized", true)
            put("bluetoothEnabled", btEnabled)
            put("deviceUUID", userId)
            put("shortUUID", userId.substring(0, 8))
            if (!btEnabled) put("warning", "Bluetooth apagado — advertising comenzará al activarlo")
        })
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        napLog("REM-API-001", "startScan() llamado", "INFO")
        withService(call) { it.startScan(); call.resolve() }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        napLog("REM-API-002", "stopScan() llamado", "INFO")
        withService(call) { it.stopScan(); call.resolve() }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val name = call.getString("deviceName") ?: userName
        napLog("REM-API-003", "startAdvertising(name=$name) llamado", "INFO")
        withService(call) { it.startAdvertising(name); call.resolve() }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        napLog("REM-API-004", "stopAdvertising() llamado", "INFO")
        withService(call) { it.stopAdvertising(); call.resolve() }
    }

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("Falta deviceId")
        napLog("REM-API-005", "connectToDevice($deviceId) llamado", "INFO")
        withService(call) { svc ->
            if (svc.connectToDevice(deviceId)) call.resolve()
            else call.reject("Error de conexion inmediata")
        }
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("Falta deviceId")
        val content = call.getString("message") ?: call.getString("data") ?: ""
        napLog("REM-API-006", "sendMessage($deviceId) len=${content.length} llamado", "INFO")
        withService(call) { svc ->
            if (svc.sendMessage(deviceId, content)) call.resolve()
            else call.reject("No enviado")
        }
    }
}
