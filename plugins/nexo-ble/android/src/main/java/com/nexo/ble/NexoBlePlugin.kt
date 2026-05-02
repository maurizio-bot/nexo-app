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
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * NexoBlePlugin v5.0.3-ARCH — BRIDGE PURO
 * FIX: isAdvertising() responde inmediato, load() inicia foreground service
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

        const val ACTION_SCAN_RESULT = "com.nexo.ble.SCAN_RESULT"
        const val ACTION_SCAN_FAILED = "com.nexo.ble.SCAN_FAILED"
        const val ACTION_SCAN_STOPPED = "com.nexo.ble.SCAN_STOPPED"
        const val ACTION_ADVERT_STATE = "com.nexo.ble.ADVERT_STATE"
        const val ACTION_MESSAGE_RECEIVED = "com.nexo.ble.MESSAGE_RECEIVED"
        const val ACTION_MESSAGE_SENT = "com.nexo.ble.MESSAGE_SENT"
        const val ACTION_DEVICE_CONNECTED = "com.nexo.ble.DEVICE_CONNECTED"
        const val ACTION_DEVICE_DISCONNECTED = "com.nexo.ble.DEVICE_DISCONNECTED"
        const val ACTION_CONNECTION_ERROR = "com.nexo.ble.CONNECTION_ERROR"
        const val ACTION_SERVICES_READY = "com.nexo.ble.SERVICES_READY"
        const val ACTION_NOTIFICATIONS_ENABLED = "com.nexo.ble.NOTIFICATIONS_ENABLED"
        const val ACTION_CONNECTION_FAILED = "com.nexo.ble.CONNECTION_FAILED"
        const val ACTION_RETRY_SCHEDULED = "com.nexo.ble.RETRY_SCHEDULED"
        const val ACTION_PAYLOAD_SENT = "com.nexo.ble.PAYLOAD_SENT"
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
            napLog("BRIDGE_BIND", "BleService vinculado", "INFO")
            pendingCalls.forEach { it.run() }
            pendingCalls.clear()
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            bleService = null
            serviceBound = false
            napLog("BRIDGE_UNBIND", "BleService desvinculado", "WARN")
        }
    }

    private val serviceEventReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                ACTION_SCAN_RESULT -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val name = intent.getStringExtra(EXTRA_DEVICE_NAME) ?: "NEXO Device"
                    val rssi = intent.getIntExtra(EXTRA_RSSI, 0)
                    notifyListeners("onDeviceFound", JSObject().apply {
                        put("deviceId", deviceId)
                        put("name", name)
                        put("rssi", rssi)
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
                ACTION_ADVERT_STATE -> {
                    val advertising = intent.getBooleanExtra(EXTRA_ADVERTISING, false)
                    val reason = intent.getStringExtra(EXTRA_REASON) ?: ""
                    if (advertising) {
                        notifyListeners("onAdvertiseStarted", JSObject().apply { put("success", true) })
                    } else {
                        notifyListeners("onAdvertiseFailed", JSObject().apply {
                            put("errorCode", 0)
                            put("reason", reason)
                        })
                    }
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
                    notifyListeners("onPayloadReceived", JSObject().apply {
                        put("deviceId", deviceId)
                        put("data", data)
                        put("content", content)
                        put("senderName", senderName)
                        put("messageId", messageId)
                        put("source", source)
                        put("timestamp", timestamp)
                    })
                }
                ACTION_PEER_INFO_RECEIVED -> {
                    val deviceId = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: return
                    val name = intent.getStringExtra(EXTRA_DEVICE_NAME) ?: "NEXO Peer"
                    val peerId = intent.getStringExtra(EXTRA_USER_ID) ?: ""
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
            }
        }
    }

    override fun load() {
        napLog("BRIDGE_LOAD", "NexoBlePlugin v5.0.3-ARCH bridge puro cargado", "INFO")

        // FIX v5.0.3: Iniciar foreground service ADEMÁS de bindService [^9^]
        val serviceIntent = Intent(context, BleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
        context.bindService(serviceIntent, serviceConnection, Context.BIND_AUTO_CREATE)

        val filter = IntentFilter().apply {
            addAction(ACTION_SCAN_RESULT)
            addAction(ACTION_SCAN_FAILED)
            addAction(ACTION_SCAN_STOPPED)
            addAction(ACTION_ADVERT_STATE)
            addAction(ACTION_MESSAGE_RECEIVED)
            addAction(ACTION_MESSAGE_SENT)
            addAction(ACTION_DEVICE_CONNECTED)
            addAction(ACTION_DEVICE_DISCONNECTED)
            addAction(ACTION_SERVICES_READY)
            addAction(ACTION_NOTIFICATIONS_ENABLED)
            addAction(ACTION_CONNECTION_FAILED)
            addAction(ACTION_RETRY_SCHEDULED)
            addAction(ACTION_PAYLOAD_SENT)
            addAction(ACTION_PEER_INFO_RECEIVED)
            addAction(ACTION_CLIENT_NOTIFICATION_STATE_CHANGED)
            addAction(ACTION_NAP_AUDIT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(serviceEventReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(serviceEventReceiver, filter)
        }
    }

    override fun handleOnDestroy() {
        try {
            if (serviceBound) {
                context.unbindService(serviceConnection)
                serviceBound = false
            }
            context.unregisterReceiver(serviceEventReceiver)
        } catch (e: Exception) { }
        super.handleOnDestroy()
    }

    private fun canAccessBluetooth(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun getBluetoothAdapter(): BluetoothAdapter? {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return manager?.adapter
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
            block(svc)
            return
        }
        val pending = Runnable {
            val svc2 = bleService
            if (svc2 != null) block(svc2)
            else call?.reject("BLE_203", "Servicio BLE no disponible")
        }
        pendingCalls.add(pending)
        handler.postDelayed({ pendingCalls.remove(pending) }, 5000)
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
        val result = buildPermissionsResult()
        if (result.getBoolean("allGranted", false) == true) call.resolve(result)
        else napError(call, "BLE_109", "Permisos incompletos")
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

    // FIX v5.0.3: Responder inmediatamente si no hay servicio bound. No encolar y olvidar.
    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val svc = bleService
        if (svc != null) {
            call.resolve(JSObject().apply {
                put("isAdvertising", svc.isAdvertising())
                put("timestamp", System.currentTimeMillis())
            })
            return
        }
        // Servicio no listo todavía — retornar false inmediato
        call.resolve(JSObject().apply {
            put("isAdvertising", false)
            put("timestamp", System.currentTimeMillis())
            put("pending", true)
        })
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
        else napError(call, "BLE_202", "Permisos requeridos no concedidos")
    }

    private fun performInitialization(call: PluginCall) {
        val adapter = getBluetoothAdapter() ?: return napError(call, "BLE_203", "Adapter nulo")
        if (!adapter.isEnabled) {
            saveCall(call)
            val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
            startActivityForResult(call, enableBtIntent, "enableBluetoothResult")
            return
        }

        userId = call.getString("userId") ?: ""
        userName = call.getString("userName") ?: "NEXO User"

        val serviceIntent = Intent(context, BleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(serviceIntent)
        else context.startService(serviceIntent)

        withService(call) { svc -> svc.setUserInfo(userId, userName) }
        call.resolve(JSObject().apply { put("initialized", true) })
    }

    @ActivityCallback
    private fun enableBluetoothResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) performInitialization(call)
        else napError(call, "BLE_201", "Bluetooth rechazado")
    }

    @PluginMethod fun startScan(call: PluginCall) { withService(call) { it.startScan(); call.resolve() } }
    @PluginMethod fun stopScan(call: PluginCall) { withService(call) { it.stopScan(); call.resolve() } }
    @PluginMethod fun startAdvertise(call: PluginCall) { withService(call) { it.startAdvertising(userName); call.resolve() } }
    @PluginMethod fun stopAdvertise(call: PluginCall) { withService(call) { it.stopAdvertising(); call.resolve() } }

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("Falta deviceId")
        withService(call) { svc ->
            if (svc.connectToDevice(deviceId)) call.resolve()
            else call.reject("Error de conexión inmediata")
        }
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("Falta deviceId")
        val content = call.getString("message") ?: call.getString("data") ?: ""
        withService(call) { svc ->
            if (svc.sendMessage(deviceId, content)) call.resolve()
            else call.reject("No enviado")
        }
    }
}
