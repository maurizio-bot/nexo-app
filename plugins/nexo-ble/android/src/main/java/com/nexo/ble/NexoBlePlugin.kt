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
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
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

/**
 * NexoBlePlugin v6.0-PROD
 * Bridge puro entre BleService y JS.
 * Basado en investigacion de Bridgefy SDK y Android BLE docs 2025-2026.
 */
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

        // Actions BleService
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

        // Extras
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
        const val EXTRA_DELAY_MS = "delay_ms"
        const val EXTRA_ENABLED = "enabled"
        const val EXTRA_USER_ID = "user_id"
        const val EXTRA_USER_NAME = "user_name"
        const val EXTRA_TIMESTAMP = "timestamp"
        const val EXTRA_DIRECTION = "direction"
        const val EXTRA_SOURCE = "source"
        const val EXTRA_CONTENT = "content"
        const val EXTRA_DATA = "data"
        const val EXTRA_SENDER_NAME = "sender_name"
        const val EXTRA_NAP_CODE = "nap_code"
        const val EXTRA_NAP_MESSAGE = "nap_message"
        const val EXTRA_NAP_LEVEL = "nap_level"

        fun normalizeMacAddress(addr: String): String {
            return if (addr.contains(":")) addr.uppercase()
            else addr.chunked(2).joinToString(":").uppercase()
        }
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
            napLog("PROD-BRIDGE-001", "BleService v6.0-PROD vinculado OK", "INFO")
            notifyListeners("bridgeReady", JSObject().apply {
                put("ready", true)
                put("timestamp", System.currentTimeMillis())
            })
            pendingCalls.forEach { it.run() }
            pendingCalls.clear()
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            bleService = null
            serviceBound = false
            napLog("PROD-BRIDGE-002", "BleService desvinculado", "WARN")
        }
    }

    private val serviceEventReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val action = intent.action ?: "null"
            when (action) {
                ACTION_SCAN_RESULT -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val broadcastName = intent.getStringExtra(EXTRA_DEVICE_NAME) ?: ""
                    val realName = getBluetoothRealNameSafe(deviceId) ?: broadcastName
                    val name = realName.ifBlank { "NEXO Device" }
                    val rssi = intent.getIntExtra(EXTRA_RSSI, 0)
                    val isNexo = intent.getBooleanExtra("isNexo", false)
                    val advertUserId = intent.getStringExtra(EXTRA_USER_ID) ?: ""
                    napLog("PROD-BRIDGE-003", "SCAN_RESULT -> JS: ${deviceId.take(8)} name=$name rssi=$rssi isNexo=$isNexo", "INFO")
                    notifyListeners("onScanResult", JSObject().apply {
                        put("address", deviceId)
                        put("deviceId", deviceId)
                        put("name", name)
                        put("rssi", rssi)
                        put("isNexo", isNexo)
                        put("userId", advertUserId)
                    })
                }
                ACTION_SCAN_FAILED -> {
                    val code = intent.getIntExtra(EXTRA_ERROR_CODE, -1)
                    val desc = intent.getStringExtra(EXTRA_ERROR_DESC) ?: "Unknown"
                    notifyListeners("onScanFailed", JSObject().apply {
                        put("errorCode", code)
                        put("description", desc)
                    })
                }
                ACTION_SCAN_STOPPED -> {
                    val count = intent.getIntExtra("result_count", 0)
                    notifyListeners("onScanStopped", JSObject().apply { put("resultCount", count) })
                }
                ACTION_ADVERT_STATE -> {
                    val advertising = intent.getBooleanExtra(EXTRA_ADVERTISING, false)
                    val reason = intent.getStringExtra(EXTRA_REASON) ?: ""
                    notifyListeners("onAdvertStateChange", JSObject().apply {
                        put("advertising", advertising)
                        if (reason.isNotEmpty()) put("reason", reason)
                    })
                }
                ACTION_DEVICE_CONNECTED -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val direction = intent.getStringExtra(EXTRA_DIRECTION) ?: "unknown"
                    val attempt = intent.getIntExtra(EXTRA_ATTEMPT, 0)
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceId", deviceId)
                        put("direction", direction)
                        put("attempt", attempt)
                    })
                }
                ACTION_DEVICE_DISCONNECTED -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val wasReady = intent.getBooleanExtra("wasReady", false)
                    notifyListeners("onDeviceDisconnected", JSObject().apply {
                        put("deviceId", deviceId)
                        put("wasReady", wasReady)
                    })
                }
                ACTION_SERVICES_READY -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val success = intent.getBooleanExtra(EXTRA_SUCCESS, false)
                    notifyListeners("onServicesReady", JSObject().apply {
                        put("deviceId", deviceId)
                        put("ready", success)
                    })
                }
                ACTION_NOTIFICATIONS_ENABLED -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val enabled = intent.getBooleanExtra(EXTRA_ENABLED, false)
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
                    val peerTs = intent.getLongExtra(EXTRA_TIMESTAMP, System.currentTimeMillis())
                    notifyListeners("onPeerInfoReceived", JSObject().apply {
                        put("deviceId", deviceId)
                        put("name", name)
                        put("userId", peerId)
                        put("timestamp", peerTs)
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
                "com.nexo.ble.LOCATION_DISABLED" -> {
                    notifyListeners("systemWarning", JSObject().apply {
                        put("type", "LOCATION_DISABLED")
                        put("message", "Location services desactivados - activalos para scan BLE")
                        put("severity", "WARNING")
                    })
                }
                "com.nexo.ble.BATTERY_NOT_EXEMPT" -> {
                    notifyListeners("systemWarning", JSObject().apply {
                        put("type", "BATTERY_NOT_EXEMPT")
                        put("message", "Battery optimization activa - solicita exencion")
                        put("severity", "WARNING")
                    })
                }
            }
        }
    }

    override fun load() {
        napLog("PROD-BRIDGE-010", "load() INICIO v6.0-PROD", "INFO")
        registerReceiverOnly()
        if (!canAccessBluetooth()) {
            napLog("PROD-BRIDGE-011", "Sin permisos al cargar - esperando requestBLEPermissions()", "WARN")
            return
        }
        startServiceAndBind()
        napLog("PROD-BRIDGE-012", "load() FIN", "INFO")
    }

    private fun registerReceiverOnly() {
        val filter = IntentFilter().apply {
            addAction(ACTION_SCAN_RESULT); addAction(ACTION_SCAN_FAILED); addAction(ACTION_SCAN_STOPPED)
            addAction(ACTION_ADVERT_STATE); addAction(ACTION_MESSAGE_RECEIVED); addAction(ACTION_MESSAGE_SENT)
            addAction(ACTION_DEVICE_CONNECTED); addAction(ACTION_DEVICE_DISCONNECTED); addAction(ACTION_SERVICES_READY)
            addAction(ACTION_NOTIFICATIONS_ENABLED); addAction(ACTION_CONNECTION_FAILED); addAction(ACTION_RETRY_SCHEDULED)
            addAction(ACTION_PEER_INFO_RECEIVED); addAction(ACTION_CLIENT_NOTIFICATION_STATE_CHANGED); addAction(ACTION_NAP_AUDIT)
            addAction("com.nexo.ble.LOCATION_DISABLED"); addAction("com.nexo.ble.BATTERY_NOT_EXEMPT")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(serviceEventReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(serviceEventReceiver, filter)
        }
        napLog("PROD-BRIDGE-013", "Receiver registrado", "INFO")
    }

    private fun startServiceAndBind() {
        val serviceIntent = Intent(context, BleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
        context.bindService(serviceIntent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    override fun handleOnDestroy() {
        try {
            if (serviceBound) {
                context.unbindService(serviceConnection)
                serviceBound = false
            }
            context.unregisterReceiver(serviceEventReceiver)
        } catch (e: Exception) {}
        super.handleOnDestroy()
    }

    private fun getOrCreateDeviceUUID(): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var uuid = prefs.getString(PREF_DEVICE_UUID, null)
        if (uuid == null || uuid.isBlank()) {
            uuid = UUID.randomUUID().toString()
            prefs.edit().putString(PREF_DEVICE_UUID, uuid).apply()
        }
        return uuid
    }

    @PluginMethod
    fun getDeviceUUID(call: PluginCall) {
        val uuid = getOrCreateDeviceUUID()
        call.resolve(JSObject().apply {
            put("deviceUUID", uuid)
            put("shortUUID", uuid.substring(0, 8))
        })
    }

    @PluginMethod
    fun requestBatteryOptimizationExemption(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            if (pm != null && !pm.isIgnoringBatteryOptimizations(context.packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:${context.packageName}")
                }
                try {
                    context.startActivity(intent)
                    call.resolve(JSObject().apply { put("requested", true) })
                } catch (e: Exception) {
                    call.reject("BATT_ERR", "No se pudo abrir dialogo: ${e.message}")
                }
            } else {
                call.resolve(JSObject().apply { put("requested", false); put("alreadyExempt", true) })
            }
        } else {
            call.resolve(JSObject().apply { put("requested", false); put("message", "No requerido") })
        }
    }

    @PluginMethod
    fun openLocationSettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            context.startActivity(intent)
            call.resolve(JSObject().apply { put("opened", true) })
        } catch (e: Exception) {
            call.reject("LOC_ERR", "No se pudo abrir: ${e.message}")
        }
    }

    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)
            context.startActivity(intent)
            call.resolve(JSObject().apply { put("opened", true) })
        } catch (e: Exception) {
            call.reject("BATT_ERR", "No se pudo abrir: ${e.message}")
        }
    }

    @PluginMethod
    fun toggleBluetooth(call: PluginCall) {
        val adapter = getBluetoothAdapter()
        if (adapter == null) {
            call.reject("BT_NULL", "Adapter nulo")
            return
        }
        try {
            if (adapter.isEnabled) {
                adapter.disable()
                call.resolve(JSObject().apply { put("action", "disabling"); put("previousState", true) })
            } else {
                adapter.enable()
                call.resolve(JSObject().apply { put("action", "enabling"); put("previousState", false) })
            }
        } catch (e: SecurityException) {
            call.reject("BT_SEC", "SecurityException: ${e.message}")
        }
    }

    private fun canAccessBluetooth(): Boolean {
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }
        return result
    }

    private fun getBluetoothAdapter(): BluetoothAdapter? {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return manager?.adapter
    }

    // FIX: getBluetoothRealName con try-catch completo (SecurityException + IllegalArgumentException)
    private fun getBluetoothRealNameSafe(addr: String): String? {
        return try {
            val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val adapter = manager?.adapter ?: return null
            val dev = adapter.getRemoteDevice(addr)
            dev?.name
        } catch (e: SecurityException) { null }
        catch (e: IllegalArgumentException) { null }
        catch (e: Exception) { null }
    }

    private fun napLog(code: String, message: String, level: String = "INFO") {
        val formatted = "[$code] $message [Bridge:true]"
        when (level) {
            "ERROR" -> Log.e(TAG, formatted)
            "WARN" -> Log.w(TAG, formatted)
            else -> Log.i(TAG, formatted)
        }
    }

    private fun withService(call: PluginCall?, block: (BleService) -> Unit) {
        val svc = bleService
        if (svc != null) { block(svc); return }
        val pending = Runnable {
            val svc2 = bleService
            if (svc2 != null) { block(svc2) } else { call?.reject("BLE_203", "Servicio BLE no disponible") }
        }
        pendingCalls.add(pending)
        handler.postDelayed({ pendingCalls.remove(pending) }, 10000)
    }

    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        if (canAccessBluetooth()) {
            call.resolve(buildPermissionsResult().apply { put("alreadyGranted", true) })
            return
        }
        saveCall(call)
        requestAllPermissions(call, "requestPermissionsCallback")
    }

    @PermissionCallback
    private fun requestPermissionsCallback(call: PluginCall) {
        try {
            val result = buildPermissionsResult()
            val allGranted = result.getBoolean("allGranted", false)
            if (allGranted) {
                startServiceAndBind()
                call.resolve(result)
            } else {
                call.reject("BLE_109", "Permisos incompletos")
            }
        } catch (e: Exception) {
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
        call.resolve(JSObject().apply {
            put("enabled", enabled)
            put("stateName", if (enabled) "ON" else "OFF")
        })
    }

    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val svc = bleService
        val isAd = svc?.isAdvertising() == true
        if (svc != null) {
            call.resolve(JSObject().apply { put("isAdvertising", isAd); put("timestamp", System.currentTimeMillis()) })
            return
        }
        call.resolve(JSObject().apply { put("isAdvertising", false); put("pending", true) })
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        if (!canAccessBluetooth()) {
            saveCall(call)
            requestPermissionForAlias("bluetoothConnect", call, "initPermissionCallback")
            return
        }
        performInitialization(call)
    }

    @PermissionCallback
    private fun initPermissionCallback(call: PluginCall) {
        if (canAccessBluetooth()) performInitialization(call)
        else call.reject("BLE_202", "Permisos requeridos no concedidos")
    }

    private fun performInitialization(call: PluginCall) {
        val adapter = getBluetoothAdapter() ?: return call.reject("BLE_203", "Adapter nulo")
        val passedUserId = call.getString("userId") ?: ""
        userId = if (!passedUserId.isNullOrBlank()) passedUserId else getOrCreateDeviceUUID()
        userName = call.getString("userName") ?: "NEXO User"
        if (!serviceBound) { startServiceAndBind() }
        withService(call) { svc -> svc.setUserInfo(userId, userName) }
        val btEnabled = adapter.isEnabled
        call.resolve(JSObject().apply {
            put("initialized", true)
            put("bluetoothEnabled", btEnabled)
            put("deviceUUID", userId)
            put("shortUUID", userId.substring(0, 8))
            if (!btEnabled) put("warning", "Bluetooth apagado")
        })
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        napLog("PROD-BRIDGE-SCAN", "JS solicita startScan()", "INFO")
        withService(call) { 
            it.startScan()
            call.resolve(JSObject().apply { put("started", true) })
        }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        withService(call) { it.stopScan(); call.resolve() }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val name = call.getString("deviceName") ?: userName
        napLog("PROD-BRIDGE-ADVERT", "JS solicita startAdvertising(name=$name)", "INFO")
        withService(call) { 
            it.startAdvertising(name)
            call.resolve(JSObject().apply { put("started", true) })
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        withService(call) { it.stopAdvertising(); call.resolve() }
    }

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: return call.reject("Falta deviceId")
        val deviceId = normalizeMacAddress(rawDeviceId)
        withService(call) { svc ->
            if (svc.connectToDevice(deviceId)) call.resolve()
            else call.reject("Error de conexion inmediata")
        }
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: return call.reject("Falta deviceId")
        val deviceId = normalizeMacAddress(rawDeviceId)
        val content = call.getString("message") ?: call.getString("data") ?: ""
        withService(call) { svc ->
            if (svc.sendMessage(deviceId, content)) call.resolve()
            else call.reject("No enviado")
        }
    }
}
