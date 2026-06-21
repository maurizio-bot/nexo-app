package com.nexo.ble

import android.app.ActivityManager
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.nio.charset.Charset

@CapacitorPlugin(
    name = "NexoBLE",
    permissions = [
        Permission(strings = [android.Manifest.permission.BLUETOOTH_SCAN], alias = "bluetoothScan"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetoothConnect"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_ADVERTISE], alias = "bluetoothAdvertise"),
        Permission(strings = [android.Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
        Permission(strings = [android.Manifest.permission.POST_NOTIFICATIONS], alias = "postNotifications"),
        Permission(strings = [android.Manifest.permission.FOREGROUND_SERVICE], alias = "foregroundService"),
        Permission(strings = [android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE], alias = "foregroundServiceConnectedDevice")
    ]
)
class NexoBlePlugin : Plugin() {

    companion object {
        private const val TAG = "NexoBlePlugin"
        private const val SCAN_TIMEOUT_MS = 15000L
    }

    private var messageReceiver: BroadcastReceiver? = null
    private var bluetoothScanner: BluetoothLeScanner? = null
    private var bluetoothGatt: BluetoothGatt? = null
    private var clientTxCharacteristic: BluetoothGattCharacteristic? = null
    private var clientRxCharacteristic: BluetoothGattCharacteristic? = null
    private val scanResults = mutableListOf<JSObject>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scanTimeoutRunnable = Runnable { stopScanInternal() }
    private val connectedDevicesMap = mutableMapOf<String, JSObject>()
    // Mapa de MAC -> PluginCall pendiente para callbacks asíncronos
    private val pendingCalls = mutableMapOf<String, PluginCall>()

    // ==================== REM LOGGING ====================

    private fun remLog(level: String, tag: String, message: String) {
        Log.i("NEXO_REM", "[$level][$tag] $message")
        try {
            notifyListeners("onRemLog", JSObject()
                .put("level", level)
                .put("tag", tag)
                .put("message", message)
                .put("timestamp", System.currentTimeMillis())
            )
        } catch (e: Exception) { /* evitar loop si notify falla */ }
    }

    // ==================== LIFECYCLE ====================

    override fun handleOnResume() {
        super.handleOnResume()
        remLog("INFO", "LIFECYCLE", "handleOnResume - verificando permisos post-Settings")
        val ctx = activity.applicationContext
        val granted = checkCoreBLEPermissions(ctx)
        remLog("INFO", "PERMISSIONS", "Post-Settings check: granted=$granted")

        if (granted) {
            notifyListeners("onPermissionStatusChanged", JSObject()
                .put("granted", true)
                .put("source", "onResume")
            )
        }
    }

    override fun handleOnPause() {
        super.handleOnPause()
        remLog("INFO", "LIFECYCLE", "handleOnPause")
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        remLog("INFO", "LIFECYCLE", "handleOnDestroy - limpiando recursos")
        try { unregisterServerReceivers() } catch (e: Exception) { remLog("WARN", "LIFECYCLE", "Error unregistering: ${e.message}") }
        try { stopScanInternal() } catch (e: Exception) { remLog("WARN", "LIFECYCLE", "Error stopping scan: ${e.message}") }
        try {
            bluetoothGatt?.disconnect()
            bluetoothGatt?.close()
        } catch (e: Exception) { remLog("WARN", "LIFECYCLE", "Error closing GATT: ${e.message}") }
    }

    // ==================== PERMISSIONS ====================

    @PluginMethod
    fun checkBLEStatus(call: PluginCall) {
        remLog("INFO", "PERMISSIONS", "checkBLEStatus invoked")
        val ctx = activity.applicationContext
        val prefs = ctx.getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE)
        val result = JSObject()

        val scanGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN)
        val connectGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT)
        val advertiseGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE)
        val locationGranted = isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
        val notificationsGranted = isGranted(ctx, android.Manifest.permission.POST_NOTIFICATIONS)

        val foregroundConnectedGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            isGranted(ctx, android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE)
        } else {
            true
        }

        val allGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            scanGranted && connectGranted && advertiseGranted && foregroundConnectedGranted
        } else {
            locationGranted
        }

        val wasEverAsked = prefs.getBoolean("ble_permissions_asked", false)
        val isPermanentlyDenied = if (!allGranted && wasEverAsked) {
            val keyPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                android.Manifest.permission.BLUETOOTH_SCAN
            else
                android.Manifest.permission.ACCESS_FINE_LOCATION
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, keyPermission)
        } else {
            false
        }

        result.put("scanGranted", scanGranted)
        result.put("connectGranted", connectGranted)
        result.put("advertiseGranted", advertiseGranted)
        result.put("locationGranted", locationGranted)
        result.put("notificationsGranted", notificationsGranted)
        result.put("foregroundConnectedGranted", foregroundConnectedGranted)
        result.put("allGranted", allGranted)
        result.put("isPermanentlyDenied", isPermanentlyDenied)
        result.put("wasEverAsked", wasEverAsked)

        remLog("INFO", "PERMISSIONS", "Result: allGranted=$allGranted, permanent=$isPermanentlyDenied, wasAsked=$wasEverAsked")
        call.resolve(result)
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        remLog("INFO", "PERMISSIONS", "initializeBLE invoked")
        val ctx = activity.applicationContext
        val alreadyGranted = checkCoreBLEPermissions(ctx)

        if (alreadyGranted) {
            remLog("INFO", "PERMISSIONS", "Permisos ya concedidos.")
            notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "permissions_already_granted"))
            call.resolve(JSObject().put("granted", true).put("isPermanentlyDenied", false))
            return
        }

        ctx.getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE)
            .edit().putBoolean("ble_permissions_asked", true).apply()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            requestPermissionForAliases(
                arrayOf("bluetoothScan", "bluetoothConnect", "bluetoothAdvertise", "postNotifications", "foregroundServiceConnectedDevice"),
                call, "permissionsCallback"
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAliases(
                arrayOf("bluetoothScan", "bluetoothConnect", "bluetoothAdvertise", "postNotifications"),
                call, "permissionsCallback"
            )
        } else {
            requestPermissionForAliases(arrayOf("location", "postNotifications"), call, "permissionsCallback")
        }
    }

    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        initializeBLE(call)
    }

    @PermissionCallback
    fun permissionsCallback(call: PluginCall) {
        remLog("INFO", "PERMISSIONS", "permissionsCallback invoked")
        val ctx = activity.applicationContext
        val granted = checkCoreBLEPermissions(ctx)

        val isPermanent = if (!granted) {
            val key = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                android.Manifest.permission.BLUETOOTH_SCAN
            else
                android.Manifest.permission.ACCESS_FINE_LOCATION
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, key)
        } else {
            false
        }

        remLog("INFO", "PERMISSIONS", "Callback result: granted=$granted, isPermanentlyDenied=$isPermanent")

        if (granted) {
            notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "permissions_callback"))
        }

        call.resolve(JSObject().put("dialogResponded", true).put("granted", granted).put("isPermanentlyDenied", isPermanent))
    }

    // ==================== HELPERS ====================

    private fun isGranted(ctx: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(ctx, permission) == PackageManager.PERMISSION_GRANTED

    private fun checkCoreBLEPermissions(ctx: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN) &&
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT) &&
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE) &&
            isGranted(ctx, android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN) &&
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT) &&
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE)
        } else {
            isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    private fun isServiceRunning(ctx: Context, serviceClass: Class<*>): Boolean {
        val manager = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return manager.getRunningServices(Integer.MAX_VALUE).any { it.service.className == serviceClass.name }
    }

    // ==================== ADVERTISING / SERVICE ====================

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        remLog("INFO", "ADVERTISING", "startAdvertising invoked")
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter

        if (adapter == null || !adapter.isEnabled) {
            remLog("ERROR", "ADVERTISING", "Bluetooth desactivado")
            notifyListeners("onAdvertiseFailed", JSObject().put("error", "Bluetooth desactivado"))
            call.reject("Bluetooth desactivado")
            return
        }

        if (!checkCoreBLEPermissions(context)) {
            remLog("ERROR", "ADVERTISING", "Permisos no concedidos")
            notifyListeners("onAdvertiseFailed", JSObject().put("error", "Permisos BLE no concedidos"))
            call.reject("Permisos BLE no concedidos")
            return
        }

        try {
            val intent = Intent(context, BleService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            registerServerReceivers()
            remLog("INFO", "ADVERTISING", "Service started OK")
            notifyListeners("onAdvertiseStarted", JSObject().put("started", true))
            call.resolve(JSObject().put("started", true))
        } catch (e: Exception) {
            remLog("ERROR", "ADVERTISING", "Crash iniciando Service: ${e.message}")
            notifyListeners("onAdvertiseFailed", JSObject().put("error", e.message))
            call.reject("Error iniciando advertising: ${e.message}")
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        remLog("INFO", "ADVERTISING", "stopAdvertising invoked")
        val context = activity.applicationContext
        try {
            context.stopService(Intent(context, BleService::class.java))
            unregisterServerReceivers()
            call.resolve(JSObject().put("stopped", true))
        } catch (e: Exception) {
            remLog("ERROR", "ADVERTISING", "Error stopping: ${e.message}")
            call.reject("Error deteniendo advertising: ${e.message}")
        }
    }

    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val ctx = activity.applicationContext
        val running = isServiceRunning(ctx, BleService::class.java)
        call.resolve(JSObject().put("isAdvertising", running))
    }

    // ==================== BLUETOOTH STATE ====================

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        remLog("INFO", "STATE", "isBluetoothEnabled invoked")
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        val enabled = adapter != null && adapter.isEnabled
        val canAdvertise = enabled && (adapter?.bluetoothLeAdvertiser != null)
        val ctx = activity.applicationContext
        val permsOk = checkCoreBLEPermissions(ctx)
        remLog("INFO", "STATE", "enabled=$enabled, canAdvertise=$canAdvertise, permsOk=$permsOk")
        call.resolve(JSObject()
            .put("enabled", enabled)
            .put("canAdvertise", canAdvertise && permsOk)
            .put("serverReady", isServiceRunning(ctx, BleService::class.java))
        )
    }

    @PluginMethod
    fun getLocalDeviceInfo(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        val name = adapter?.name ?: "NEXO Device"
        val address = try { adapter?.address ?: "" } catch (e: SecurityException) { "" }
        call.resolve(JSObject().put("deviceName", name).put("deviceAddress", address))
    }

    // ==================== MESSAGING ====================

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: ""
        val message = call.getString("message") ?: ""
        remLog("INFO", "MESSAGE", "sendMessage to=$deviceId len=${message.length}")

        if (deviceId.isEmpty()) {
            call.reject("deviceId requerido")
            return
        }

        if (bluetoothGatt != null && clientRxCharacteristic != null) {
            val data = message.toByteArray(Charset.defaultCharset())
            val success = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                bluetoothGatt?.writeCharacteristic(
                    clientRxCharacteristic!!,
                    data,
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                ) == BluetoothGatt.GATT_SUCCESS
            } else {
                @Suppress("DEPRECATION")
                clientRxCharacteristic?.value = data
                @Suppress("DEPRECATION")
                bluetoothGatt?.writeCharacteristic(clientRxCharacteristic) ?: false
            }
            remLog("INFO", "MESSAGE", "Client write success=$success")
            call.resolve(JSObject().put("sent", success).put("mode", "client"))
            return
        }

        val context = activity.applicationContext
        val intent = Intent(NexoBleSpec.ACTION_BLE_SEND_MESSAGE).apply {
            putExtra(NexoBleSpec.EXTRA_MESSAGE_DATA, message)
            setPackage(context.packageName)
        }
        context.sendBroadcast(intent)
        remLog("INFO", "MESSAGE", "Broadcasted to server mode")
        call.resolve(JSObject().put("sent", true).put("mode", "server"))
    }

    // ==================== SCANNING ====================

    @PluginMethod
    fun startScan(call: PluginCall) {
        remLog("INFO", "SCAN", "startScan invoked")
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter

        if (adapter == null || !adapter.isEnabled) {
            remLog("ERROR", "SCAN", "Bluetooth desactivado")
            notifyListeners("onScanFailed", JSObject().put("error", "Bluetooth desactivado"))
            call.reject("Bluetooth desactivado")
            return
        }

        if (!isGranted(context, android.Manifest.permission.BLUETOOTH_SCAN)) {
            remLog("ERROR", "SCAN", "BLUETOOTH_SCAN no concedido")
            call.reject("BLUETOOTH_SCAN no concedido")
            return
        }

        bluetoothScanner = adapter.bluetoothLeScanner
        scanResults.clear()

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(NexoBleSpec.NEXO_SERVICE_UUID))
            .build()
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        try {
            bluetoothScanner?.startScan(listOf(filter), settings, scanCallback)
            mainHandler.postDelayed(scanTimeoutRunnable, SCAN_TIMEOUT_MS)
            remLog("INFO", "SCAN", "Scan started OK")
            call.resolve(JSObject().put("started", true))
        } catch (e: SecurityException) {
            remLog("ERROR", "SCAN", "SecurityException: ${e.message}")
            notifyListeners("onScanFailed", JSObject().put("error", e.message))
            call.reject("Permiso BLUETOOTH_SCAN no concedido: ${e.message}")
        }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        remLog("INFO", "SCAN", "stopScan invoked")
        stopScanInternal()
        call.resolve(JSObject().put("stopped", true))
    }

    // ==================== CONNECTION - ANTI-CRASH ARMORED ====================

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        try {
            // FIX CRASH #1: Validar deviceId antes de usarlo
            val deviceId = call.getString("deviceId") ?: call.getString("address") ?: ""
            remLog("INFO", "CONNECT", "connectToDevice deviceId=$deviceId")

            if (deviceId.isEmpty()) {
                remLog("ERROR", "CONNECT", "deviceId vacío - rechazando")
                call.reject("deviceId requerido", "INVALID_DEVICE_ID")
                return
            }

            // FIX CRASH #2: Validar formato MAC
            val macRegex = Regex("^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$")
            if (!macRegex.matches(deviceId)) {
                remLog("WARN", "CONNECT", "deviceId no parece MAC válida: $deviceId - intentando igualmente")
                // No rechazamos, algunos IDs pueden ser UUIDs u otros formatos
            }

            val context = activity.applicationContext
            val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter

            if (adapter == null) {
                remLog("ERROR", "CONNECT", "BluetoothAdapter es null")
                call.reject("Bluetooth no disponible", "BLUETOOTH_UNAVAILABLE")
                return
            }

            if (!adapter.isEnabled) {
                remLog("ERROR", "CONNECT", "Bluetooth desactivado")
                call.reject("Bluetooth desactivado", "BLUETOOTH_DISABLED")
                return
            }

            // FIX CRASH #3: Verificar permiso BLUETOOTH_CONNECT antes de getRemoteDevice
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (!isGranted(context, android.Manifest.permission.BLUETOOTH_CONNECT)) {
                    remLog("ERROR", "CONNECT", "BLUETOOTH_CONNECT no concedido")
                    call.reject("BLUETOOTH_CONNECT no concedido", "PERMISSION_DENIED")
                    return
                }
            }

            // FIX CRASH #4: getRemoteDevice puede lanzar IllegalArgumentException
            val device: BluetoothDevice
            try {
                device = adapter.getRemoteDevice(deviceId)
            } catch (e: IllegalArgumentException) {
                remLog("ERROR", "CONNECT", "MAC inválida: $deviceId - ${e.message}")
                call.reject("MAC de dispositivo inválida: $deviceId", "INVALID_MAC")
                return
            } catch (e: SecurityException) {
                remLog("ERROR", "CONNECT", "SecurityException getRemoteDevice: ${e.message}")
                call.reject("Permiso BLUETOOTH_CONNECT requerido", "PERMISSION_DENIED")
                return
            }

            // FIX CRASH #5: Cerrar GATT anterior de forma segura
            try {
                bluetoothGatt?.disconnect()
                bluetoothGatt?.close()
            } catch (e: Exception) {
                remLog("WARN", "CONNECT", "Error cerrando GATT anterior: ${e.message}")
            }
            bluetoothGatt = null
            clientTxCharacteristic = null
            clientRxCharacteristic = null

            // FIX CRASH #6: Guardar call para resolver después (callback async)
            pendingCalls[deviceId] = call
            call.setKeepAlive(true)

            // FIX CRASH #7: connectGatt con try-catch
            try {
                bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
                } else {
                    device.connectGatt(context, false, gattClientCallback)
                }
            } catch (e: SecurityException) {
                remLog("ERROR", "CONNECT", "SecurityException connectGatt: ${e.message}")
                pendingCalls.remove(deviceId)
                call.reject("Permiso BLUETOOTH_CONNECT requerido para conectar", "PERMISSION_DENIED")
                return
            } catch (e: Exception) {
                remLog("ERROR", "CONNECT", "Exception connectGatt: ${e.message}")
                pendingCalls.remove(deviceId)
                call.reject("Error conectando GATT: ${e.message}", "GATT_CONNECT_ERROR")
                return
            }

            if (bluetoothGatt == null) {
                remLog("ERROR", "CONNECT", "connectGatt retornó null")
                pendingCalls.remove(deviceId)
                call.reject("No se pudo iniciar conexión GATT", "GATT_NULL")
                return
            }

            remLog("INFO", "CONNECT", "GATT connect iniciado para $deviceId")
            // No resolvemos aquí - esperamos callback onConnectionStateChange
            // Timeout de seguridad para no dejar call colgado
            mainHandler.postDelayed({
                if (pendingCalls.containsKey(deviceId)) {
                    remLog("WARN", "CONNECT", "Timeout conectando a $deviceId")
                    pendingCalls.remove(deviceId)
                    try {
                        bluetoothGatt?.disconnect()
                        bluetoothGatt?.close()
                    } catch (e: Exception) {}
                    bluetoothGatt = null
                    // Notificamos al JS que falló
                    notifyListeners("onConnectionFailed", JSObject()
                        .put("deviceId", deviceId)
                        .put("reason", "Connection timeout")
                        .put("recoverable", true)
                        .put("attempt", 0)
                        .put("maxAttempts", 3)
                    )
                }
            }, 15000)

        } catch (e: Exception) {
            remLog("ERROR", "CONNECT", "Exception fatal en connectToDevice: ${e.message}")
            call.reject("Error interno: ${e.message}", "INTERNAL_ERROR")
        }
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: ""
        remLog("INFO", "CONNECT", "disconnectDevice deviceId=$deviceId")
        try {
            bluetoothGatt?.disconnect()
            bluetoothGatt?.close()
        } catch (e: Exception) {
            remLog("WARN", "CONNECT", "Error cerrando GATT: ${e.message}")
        }
        bluetoothGatt = null
        clientTxCharacteristic = null
        clientRxCharacteristic = null
        connectedDevicesMap.remove(deviceId)
        pendingCalls.remove(deviceId)
        notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", deviceId))
        call.resolve(JSObject().put("disconnected", true).put("deviceId", deviceId))
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val devices = JSArray()
        connectedDevicesMap.values.forEach { devices.put(it) }
        call.resolve(JSObject().put("devices", devices))
    }

    @PluginMethod
    fun forceReconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: ""
        remLog("INFO", "CONNECT", "forceReconnect deviceId=$deviceId")
        if (deviceId.isEmpty()) {
            call.reject("deviceId requerido", "INVALID_DEVICE_ID")
            return
        }

        try {
            bluetoothGatt?.disconnect()
            bluetoothGatt?.close()
        } catch (e: Exception) {
            remLog("WARN", "CONNECT", "Error cerrando GATT: ${e.message}")
        }
        bluetoothGatt = null
        clientTxCharacteristic = null
        clientRxCharacteristic = null

        mainHandler.postDelayed({
            try {
                val context = activity.applicationContext
                val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
                val adapter = bluetoothManager.adapter
                if (adapter == null || !adapter.isEnabled) {
                    remLog("ERROR", "CONNECT", "Bluetooth no disponible en reconnect")
                    notifyListeners("onConnectionFailed", JSObject()
                        .put("deviceId", deviceId)
                        .put("reason", "Bluetooth unavailable")
                        .put("recoverable", false)
                    )
                    return@postDelayed
                }
                val device = adapter.getRemoteDevice(deviceId)
                bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
                } else {
                    device.connectGatt(context, false, gattClientCallback)
                }
                notifyListeners("onDeviceConnected", JSObject()
                    .put("deviceId", deviceId)
                    .put("direction", "outgoing")
                    .put("attempt", 1)
                    .put("servicesReady", false)
                )
            } catch (e: Exception) {
                remLog("ERROR", "CONNECT", "Error en forceReconnect: ${e.message}")
                notifyListeners("onConnectionFailed", JSObject()
                    .put("deviceId", deviceId)
                    .put("reason", e.message)
                    .put("recoverable", true)
                    .put("attempt", 1)
                    .put("maxAttempts", 3)
                )
            }
        }, 500)

        call.resolve(JSObject().put("reconnecting", true).put("deviceId", deviceId))
    }

    // ==================== CALLBACKS ====================

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.device?.let { device ->
                val name = try { device.name } catch (e: SecurityException) { null } ?: "Unknown"
                val addr = device.address
                if (scanResults.none { it.getString("deviceId") == addr }) {
                    val item = JSObject().apply {
                        put("deviceId", addr)
                        put("name", name)
                        put("rssi", result.rssi)
                    }
                    scanResults.add(item)
                    remLog("INFO", "SCAN", "Device found: $name ($addr)")
                    notifyListeners("onDeviceFound", item)
                }
            }
        }

        override fun onScanFailed(errorCode: Int) {
            remLog("ERROR", "SCAN", "Scan failed: errorCode=$errorCode")
            notifyListeners("onScanFailed", JSObject().put("errorCode", errorCode))
        }
    }

    private fun stopScanInternal() {
        mainHandler.removeCallbacks(scanTimeoutRunnable)
        try { bluetoothScanner?.stopScan(scanCallback) } catch (e: Exception) { remLog("WARN", "SCAN", "Error stopping scan: ${e.message}") }
        bluetoothScanner = null
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val address = gatt.device?.address ?: ""
            remLog("INFO", "GATT", "onConnectionStateChange $address status=$status newState=$newState")

            // FIX CRASH: Resolver call pendiente si existe
            val pendingCall = pendingCalls[address]

            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connectedDevicesMap[address] = JSObject()
                    .put("id", address).put("address", address)
                    .put("name", gatt.device?.name ?: "NEXO Peer")
                    .put("direction", "outgoing")

                // Resolver call pendiente con éxito
                pendingCall?.let {
                    it.resolve(JSObject()
                        .put("connected", true)
                        .put("alreadyConnected", false)
                        .put("deviceId", address)
                    )
                    pendingCalls.remove(address)
                }

                notifyListeners("onDeviceConnected", JSObject()
                    .put("deviceId", address)
                    .put("direction", "outgoing")
                    .put("attempt", 0)
                    .put("servicesReady", false)
                )

                try {
                    gatt.discoverServices()
                } catch (e: SecurityException) {
                    remLog("ERROR", "GATT", "SecurityException discoverServices: ${e.message}")
                    notifyListeners("onConnectionFailed", JSObject()
                        .put("deviceId", address)
                        .put("reason", "SecurityException discoverServices: ${e.message}")
                        .put("recoverable", true)
                        .put("attempt", 0)
                        .put("maxAttempts", 3)
                    )
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connectedDevicesMap.remove(address)

                // Resolver call pendiente con fallo si aún existe
                pendingCall?.let {
                    it.resolve(JSObject()
                        .put("connected", false)
                        .put("alreadyConnected", false)
                        .put("deviceId", address)
                        .put("error", "Disconnected")
                    )
                    pendingCalls.remove(address)
                }

                notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", address))
                try {
                    bluetoothGatt?.close()
                } catch (e: Exception) {
                    remLog("WARN", "GATT", "Error closing GATT: ${e.message}")
                }
                bluetoothGatt = null
                clientTxCharacteristic = null
                clientRxCharacteristic = null
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val address = gatt.device?.address ?: ""
            remLog("INFO", "GATT", "onServicesDiscovered $address status=$status")
            if (status != BluetoothGatt.GATT_SUCCESS) {
                notifyListeners("onConnectionFailed", JSObject()
                    .put("deviceId", address)
                    .put("reason", "Service discovery failed")
                    .put("recoverable", true)
                    .put("attempt", 0)
                    .put("maxAttempts", 3)
                )
                return
            }
            val service = gatt.getService(NexoBleSpec.NEXO_SERVICE_UUID) ?: run {
                notifyListeners("onConnectionFailed", JSObject()
                    .put("deviceId", address)
                    .put("reason", "NEXO service not found")
                    .put("recoverable", false)
                )
                return
            }

            clientTxCharacteristic = service.getCharacteristic(NexoBleSpec.TX_CHARACTERISTIC_UUID)
            clientRxCharacteristic = service.getCharacteristic(NexoBleSpec.RX_CHARACTERISTIC_UUID)

            clientTxCharacteristic?.let { characteristic ->
                try {
                    gatt.setCharacteristicNotification(characteristic, true)
                    val descriptor = characteristic.getDescriptor(NexoBleSpec.CCCD_UUID)
                    if (descriptor != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                        } else {
                            @Suppress("DEPRECATION")
                            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            @Suppress("DEPRECATION")
                            gatt.writeDescriptor(descriptor)
                        }
                    }
                } catch (e: SecurityException) {
                    remLog("ERROR", "GATT", "SecurityException enabling notifications: ${e.message}")
                    notifyListeners("onConnectionFailed", JSObject()
                        .put("deviceId", address)
                        .put("reason", "SecurityException notifications: ${e.message}")
                        .put("recoverable", true)
                        .put("attempt", 0)
                        .put("maxAttempts", 3)
                    )
                }
            }
            notifyListeners("onServicesReady", JSObject().put("deviceId", address).put("servicesReady", true))
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            val address = gatt.device?.address ?: ""
            remLog("INFO", "GATT", "onDescriptorWrite $address uuid=${descriptor.uuid} status=$status")
            if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                notifyListeners("onNotificationsEnabled", JSObject()
                    .put("deviceId", address)
                    .put("notificationsEnabled", true)
                )
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                val message = characteristic.value?.toString(Charset.defaultCharset()) ?: ""
                val address = gatt.device?.address ?: ""
                remLog("INFO", "GATT", "Received (legacy) from $address: $message")
                notifyListeners("onPayloadReceived", JSObject()
                    .put("deviceId", address)
                    .put("content", message)
                    .put("data", message)
                    .put("senderName", null)
                    .put("source", "ble")
                    .put("timestamp", System.currentTimeMillis())
                )
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                val message = value.toString(Charset.defaultCharset())
                val address = gatt.device?.address ?: ""
                remLog("INFO", "GATT", "Received (API33+) from $address: $message")
                notifyListeners("onPayloadReceived", JSObject()
                    .put("deviceId", address)
                    .put("content", message)
                    .put("data", message)
                    .put("senderName", null)
                    .put("source", "ble")
                    .put("timestamp", System.currentTimeMillis())
                )
            }
        }
    }

    // ==================== RECEIVERS ====================

    private fun registerServerReceivers() {
        if (messageReceiver != null) {
            remLog("WARN", "RECEIVER", "Receiver ya registrado, omitiendo")
            return
        }
        messageReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED -> {
                        val msg = intent.getStringExtra(NexoBleSpec.EXTRA_MESSAGE_DATA) ?: ""
                        val device = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                        remLog("INFO", "RECEIVER", "MSG from $device: $msg")
                        notifyListeners("onPayloadReceived", JSObject()
                            .put("deviceId", device)
                            .put("content", msg)
                            .put("data", msg)
                            .put("senderName", null)
                            .put("source", "ble")
                            .put("timestamp", System.currentTimeMillis())
                        )
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED -> {
                        val addr = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                        remLog("INFO", "RECEIVER", "Device connected: $addr")
                        connectedDevicesMap[addr] = JSObject()
                            .put("id", addr).put("address", addr)
                            .put("name", "NEXO Peer").put("direction", "incoming")
                        notifyListeners("onDeviceConnected", JSObject()
                            .put("deviceId", addr)
                            .put("direction", "incoming")
                            .put("attempt", 0)
                            .put("servicesReady", true)
                        )
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED -> {
                        val addr = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                        remLog("INFO", "RECEIVER", "Device disconnected: $addr")
                        connectedDevicesMap.remove(addr)
                        notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", addr))
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED)
            addAction(NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED)
            addAction(NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED)
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.registerReceiver(messageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                activity.registerReceiver(messageReceiver, filter)
            }
            remLog("INFO", "RECEIVER", "Receiver registrado OK")
        } catch (e: Exception) {
            remLog("ERROR", "RECEIVER", "Error registrando receiver: ${e.message}")
        }
    }

    private fun unregisterServerReceivers() {
        messageReceiver?.let {
            try {
                activity.unregisterReceiver(it)
                remLog("INFO", "RECEIVER", "Receiver desregistrado OK")
            } catch (e: IllegalArgumentException) {
                remLog("WARN", "RECEIVER", "Receiver ya estaba desregistrado")
            } catch (e: Exception) {
                remLog("ERROR", "RECEIVER", "Error desregistrando: ${e.message}")
            }
            messageReceiver = null
        }
    }

    // ==================== ALIAS PARA COMPATIBILIDAD v6.2 ====================

    @PluginMethod
    fun startBLEAdvertising(call: PluginCall) = startAdvertising(call)

    @PluginMethod
    fun stopBLEAdvertising(call: PluginCall) = stopAdvertising(call)

    @PluginMethod
    fun scanForDevices(call: PluginCall) = startScan(call)

    @PluginMethod
    fun startListeningMessages(call: PluginCall) {
        registerServerReceivers()
        call.resolve(JSObject().put("listening", true))
    }
}
