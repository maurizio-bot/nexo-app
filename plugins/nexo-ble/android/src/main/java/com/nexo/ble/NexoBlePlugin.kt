package com.nexo.ble

import android.app.ActivityManager
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.BluetoothLeAdvertiser
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
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.nio.charset.Charset
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

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
        private const val RECONNECT_DELAY_MS = 3000L
        private const val MAX_RECONNECT_ATTEMPTS = 10
        private const val MESSAGE_REASSEMBLY_TIMEOUT_MS = 5000L
        private const val KEEPALIVE_INTERVAL_MS = 10000L
        private const val MTU_REQUEST = 512
    }

    private var bluetoothGattServer: BluetoothGattServer? = null
    private var serverTxCharacteristic: BluetoothGattCharacteristic? = null
    private var serverRxCharacteristic: BluetoothGattCharacteristic? = null
    private val serverConnectedDevices = ConcurrentHashMap<String, BluetoothDevice>()

    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val clientRxCharacteristics = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
    private val clientTxCharacteristics = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
    private val clientConnectionStates = ConcurrentHashMap<String, Int>()

    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null

    private var bluetoothScanner: BluetoothLeScanner? = null
    private val scanResults = mutableListOf<JSObject>()

    private val scannedDevices = ConcurrentHashMap<String, BluetoothDevice>()

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scanTimeoutRunnable = Runnable { stopScanInternal() }
    private val reconnectTimers = ConcurrentHashMap<String, Runnable>()
    private val reconnectAttempts = ConcurrentHashMap<String, Int>()
    private val keepAliveTimers = ConcurrentHashMap<String, Runnable>()
    private val pendingMessageQueue = ConcurrentHashMap<String, MutableList<String>>()

    private val pendingCalls = ConcurrentHashMap<String, PluginCall>()

    private var messageReceiver: BroadcastReceiver? = null
    private var isAdvertisingActive = false

    private val messageBuffers = ConcurrentHashMap<String, StringBuilder>()
    private val messageBufferTimers = ConcurrentHashMap<String, Runnable>()

    private fun remLog(level: String, tag: String, message: String) {
        Log.i("NEXO_REM", "[$level][$tag] $message")
        try {
            notifyListeners("onRemLog", JSObject()
                .put("level", level)
                .put("tag", tag)
                .put("message", message)
                .put("timestamp", System.currentTimeMillis())
            )
        } catch (e: Exception) { }
    }

    private fun processReceivedChunk(deviceId: String, chunk: String, source: String) {
        val macNorm = normalizeMac(deviceId)
        messageBufferTimers[macNorm]?.let { mainHandler.removeCallbacks(it) }
        val buffer = messageBuffers.getOrPut(macNorm) { StringBuilder() }
        buffer.append(chunk)
        val accumulated = buffer.toString()
        remLog("DEBUG", "REASSEMBLY", "Buffer for $macNorm: len=${accumulated.length}, content=${accumulated.take(60)}...")
        val completeMessage = tryExtractCompleteJson(accumulated)
        if (completeMessage != null) {
            remLog("INFO", "REASSEMBLY", "Mensaje completo reensamblado de $macNorm")
            messageBuffers.remove(macNorm)
            messageBufferTimers.remove(macNorm)
            notifyListeners("onPayloadReceived", JSObject()
                .put("deviceId", deviceId)
                .put("content", completeMessage)
                .put("data", completeMessage)
                .put("source", source)
                .put("timestamp", System.currentTimeMillis())
                .put("reassembled", true)
            )
        } else {
            val timeoutRunnable = Runnable {
                remLog("WARN", "REASSEMBLY", "Timeout reensamblaje para $macNorm, descartando buffer")
                messageBuffers.remove(macNorm)
                messageBufferTimers.remove(macNorm)
            }
            messageBufferTimers[macNorm] = timeoutRunnable
            mainHandler.postDelayed(timeoutRunnable, MESSAGE_REASSEMBLY_TIMEOUT_MS)
        }
    }

    private fun tryExtractCompleteJson(buffer: String): String? {
        if (buffer.isBlank()) return null
        var braceCount = 0
        var startIdx = -1
        var endIdx = -1
        for (i in buffer.indices) {
            val c = buffer[i]
            if (c == '{') {
                if (braceCount == 0) startIdx = i
                braceCount++
            } else if (c == '}') {
                braceCount--
                if (braceCount == 0 && startIdx >= 0) {
                    endIdx = i
                    break
                }
            }
        }
        if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) return null
        val candidate = buffer.substring(startIdx, endIdx + 1)
        return try {
            JSONObject(candidate)
            candidate
        } catch (e: Exception) {
            null
        }
    }

    override fun load() {
        super.load()
        remLog("INFO", "LIFECYCLE", "load - auto-starting GATT server")
        autoStartGattServerAndAdvertising()
    }

    override fun handleOnResume() {
        super.handleOnResume()
        remLog("INFO", "LIFECYCLE", "handleOnResume")
        autoStartGattServerAndAdvertising()
        val ctx = activity.applicationContext
        val granted = checkCoreBLEPermissions(ctx)
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
        remLog("INFO", "LIFECYCLE", "handleOnDestroy - limpiando DUAL GATT")
        cleanupAllConnections()
        try { unregisterServerReceivers() } catch (e: Exception) { }
        try { stopScanInternal() } catch (e: Exception) { }
        try { stopGattServer() } catch (e: Exception) { }
        isAdvertisingActive = false
        try { stopAdvertisingInternal() } catch (e: Exception) { }
        messageBuffers.clear()
        messageBufferTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        messageBufferTimers.clear()
    }

    private fun autoStartGattServerAndAdvertising() {
        val ctx = activity.applicationContext
        if (!checkCoreBLEPermissions(ctx)) {
            remLog("WARN", "AUTO_START", "Permisos no concedidos, no se puede auto-start")
            return
        }
        if (bluetoothGattServer == null) {
            startGattServer()
        }
        if (!isAdvertisingActive) {
            try {
                val intent = Intent(ctx, BleService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
                registerServerReceivers()
                isAdvertisingActive = true
                notifyListeners("onAdvertiseStarted", JSObject().put("started", true).put("source", "auto_start"))
                remLog("INFO", "AUTO_START", "Advertising auto-iniciado")
            } catch (e: Exception) {
                remLog("WARN", "AUTO_START", "Fallo auto-start advertising: ${e.message}")
            }
        }
    }

    private fun cleanupAllConnections() {
        gattClients.forEach { (mac, gatt) ->
            try {
                gatt.disconnect()
                gatt.close()
                remLog("INFO", "CLEANUP", "GATT client cerrado: $mac")
            } catch (e: Exception) {
                remLog("WARN", "CLEANUP", "Error cerrando GATT client $mac: ${e.message}")
            }
        }
        gattClients.clear()
        clientRxCharacteristics.clear()
        clientTxCharacteristics.clear()
        clientConnectionStates.clear()
        reconnectTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        reconnectTimers.clear()
        reconnectAttempts.clear()
        keepAliveTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        keepAliveTimers.clear()
        pendingMessageQueue.clear()
        messageBuffers.clear()
        messageBufferTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        messageBufferTimers.clear()
    }

    @PluginMethod
    fun checkBLEStatus(call: PluginCall) {
        remLog("INFO", "PERMISSIONS", "checkBLEStatus")
        val ctx = activity.applicationContext
        val result = JSObject()
        val scanGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN)
        val connectGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT)
        val advertiseGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE)
        val locationGranted = isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
        val notificationsGranted = isGranted(ctx, android.Manifest.permission.POST_NOTIFICATIONS)
        val foregroundConnectedGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            isGranted(ctx, android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE)
        } else true
        val allGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            scanGranted && connectGranted && advertiseGranted && foregroundConnectedGranted
        } else locationGranted
        result.put("scanGranted", scanGranted)
        result.put("connectGranted", connectGranted)
        result.put("advertiseGranted", advertiseGranted)
        result.put("locationGranted", locationGranted)
        result.put("notificationsGranted", notificationsGranted)
        result.put("foregroundConnectedGranted", foregroundConnectedGranted)
        result.put("allGranted", allGranted)
        result.put("serverReady", bluetoothGattServer != null)
        call.resolve(result)
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        remLog("INFO", "PERMISSIONS", "initializeBLE")
        val ctx = activity.applicationContext
        if (checkCoreBLEPermissions(ctx)) {
            startGattServer()
            autoStartGattServerAndAdvertising()
            notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "permissions_already_granted"))
            call.resolve(JSObject().put("granted", true))
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

    @PermissionCallback
    fun permissionsCallback(call: PluginCall) {
        val ctx = activity.applicationContext
        val granted = checkCoreBLEPermissions(ctx)
        if (granted) {
            startGattServer()
            autoStartGattServerAndAdvertising()
            notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "permissions_callback"))
        }
        call.resolve(JSObject().put("granted", granted))
    }

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
        } else isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
    }

    private fun normalizeMac(mac: String): String {
        return mac.replace(":", "").replace("-", "").replace(".", "").lowercase()
    }

    private fun formatMacForAndroid(mac: String): String? {
        val clean = mac.replace(":", "").replace("-", "").replace(".", "").lowercase()
        if (clean.length != 12 || !clean.all { it in '0'..'9' || it in 'a'..'f' }) {
            return null
        }
        return clean.chunked(2).joinToString(":")
    }

    private fun startGattServer() {
        if (bluetoothGattServer != null) {
            remLog("INFO", "GATT_SERVER", "Ya iniciado")
            return
        }
        try {
            val ctx = activity.applicationContext
            val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            if (adapter == null || !adapter.isEnabled) {
                remLog("ERROR", "GATT_SERVER", "Bluetooth no disponible")
                return
            }
            bluetoothGattServer = bluetoothManager.openGattServer(ctx, gattServerCallback)
            val service = android.bluetooth.BluetoothGattService(
                NexoBleSpec.NEXO_SERVICE_UUID,
                android.bluetooth.BluetoothGattService.SERVICE_TYPE_PRIMARY
            )
            serverTxCharacteristic = BluetoothGattCharacteristic(
                NexoBleSpec.TX_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
                BluetoothGattCharacteristic.PERMISSION_READ
            ).apply {
                addDescriptor(BluetoothGattDescriptor(
                    NexoBleSpec.CCCD_UUID,
                    BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
                ))
            }
            serverRxCharacteristic = BluetoothGattCharacteristic(
                NexoBleSpec.RX_CHARACTERISTIC_UUID,
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
                BluetoothGattCharacteristic.PERMISSION_WRITE
            )
            service.addCharacteristic(serverTxCharacteristic)
            service.addCharacteristic(serverRxCharacteristic)
            val success = bluetoothGattServer?.addService(service) ?: false
            remLog("INFO", "GATT_SERVER", "Iniciado: addService=$success")
            if (success) {
                notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "gatt_server_started"))
            }
        } catch (e: Exception) {
            remLog("ERROR", "GATT_SERVER", "Error: ${e.message}")
        }
    }

    private fun stopGattServer() {
        try {
            bluetoothGattServer?.close()
            bluetoothGattServer = null
            serverConnectedDevices.clear()
            remLog("INFO", "GATT_SERVER", "Detenido")
        } catch (e: Exception) {
            remLog("WARN", "GATT_SERVER", "Error deteniendo: ${e.message}")
        }
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val mac = normalizeMac(device.address)
            remLog("INFO", "GATT_SERVER", "Connection $mac status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                serverConnectedDevices[mac] = device
                notifyListeners("onDeviceConnected", JSObject()
                    .put("deviceId", device.address)
                    .put("direction", "incoming")
                    .put("role", "server")
                    .put("servicesReady", true)
                )
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                serverConnectedDevices.remove(mac)
                messageBuffers.remove(mac)
                messageBufferTimers.remove(mac)?.let { mainHandler.removeCallbacks(it) }
                notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", device.address))
                if (isAdvertisingActive) {
                    remLog("INFO", "GATT_SERVER", "Reanudando advertising tras desconexion")
                    try {
                        val ctx = activity.applicationContext
                        val intent = Intent(ctx, BleService::class.java)
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            ctx.startForegroundService(intent)
                        } else {
                            ctx.startService(intent)
                        }
                    } catch (e: Exception) {
                        remLog("WARN", "GATT_SERVER", "No se pudo reanudar advertising: ${e.message}")
                    }
                }
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            if (characteristic.uuid == NexoBleSpec.RX_CHARACTERISTIC_UUID) {
                val chunk = value?.toString(Charset.defaultCharset()) ?: ""
                val mac = device.address
                remLog("INFO", "GATT_SERVER", "RX chunk from $mac: len=${chunk.length}")
                processReceivedChunk(mac, chunk, "gatt_server")
                if (responseNeeded) {
                    bluetoothGattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            if (descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                descriptor.value = value
                if (responseNeeded) {
                    bluetoothGattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
                remLog("INFO", "GATT_SERVER", "CCCD escrito por ${device.address}")
            }
        }
    }

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        try {
            val rawDeviceId = call.getString("deviceId") ?: call.getString("address") ?: ""
            remLog("INFO", "GATT_CLIENT", "connectToDevice raw='$rawDeviceId'")

            if (rawDeviceId.isEmpty()) {
                call.reject("deviceId requerido", "INVALID_DEVICE_ID")
                return
            }

            val macNorm = normalizeMac(rawDeviceId)
            remLog("INFO", "GATT_CLIENT", "connectToDevice norm='$macNorm'")

            if (gattClients.containsKey(macNorm) && clientConnectionStates[macNorm] == BluetoothProfile.STATE_CONNECTED) {
                remLog("INFO", "GATT_CLIENT", "Ya conectado a $macNorm")
                call.resolve(JSObject()
                    .put("connected", true)
                    .put("alreadyConnected", true)
                    .put("deviceId", rawDeviceId)
                )
                return
            }

            val ctx = activity.applicationContext
            val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            if (adapter == null || !adapter.isEnabled) {
                call.reject("Bluetooth no disponible", "BLUETOOTH_UNAVAILABLE")
                return
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT)) {
                call.reject("BLUETOOTH_CONNECT no concedido", "PERMISSION_DENIED")
                return
            }

            val device: BluetoothDevice = scannedDevices[macNorm] ?: run {
                remLog("WARN", "GATT_CLIENT", "Device no en cache, intentando getRemoteDevice para $macNorm")
                val macFormatted = formatMacForAndroid(rawDeviceId)
                if (macFormatted == null) {
                    call.reject("MAC invalida: $rawDeviceId", "INVALID_MAC")
                    return
                }
                try {
                    adapter.getRemoteDevice(macFormatted)
                } catch (e: IllegalArgumentException) {
                    call.reject("MAC invalida para Bluetooth API: $macFormatted", "INVALID_MAC")
                    return
                } catch (e: SecurityException) {
                    call.reject("Permiso BLUETOOTH_CONNECT requerido para conectar", "PERMISSION_DENIED")
                    return
                }
            }

            remLog("INFO", "GATT_CLIENT", "Usando device: ${device.address} (cache=${scannedDevices.containsKey(macNorm)})")

            gattClients[macNorm]?.let { oldGatt ->
                try { oldGatt.disconnect(); oldGatt.close() } catch (e: Exception) { }
            }

            pendingCalls[macNorm] = call
            call.setKeepAlive(true)

            val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                device.connectGatt(ctx, false, createGattClientCallback(macNorm), BluetoothDevice.TRANSPORT_LE)
            } else {
                device.connectGatt(ctx, false, createGattClientCallback(macNorm))
            }

            if (gatt == null) {
                pendingCalls.remove(macNorm)
                call.reject("No se pudo iniciar GATT", "GATT_NULL")
                return
            }

            gattClients[macNorm] = gatt
            clientConnectionStates[macNorm] = BluetoothProfile.STATE_CONNECTING
            remLog("INFO", "GATT_CLIENT", "Conexion iniciada a $macNorm")

            mainHandler.postDelayed({
                if (pendingCalls.containsKey(macNorm)) {
                    remLog("WARN", "GATT_CLIENT", "Timeout conectando a $macNorm")
                    pendingCalls.remove(macNorm)
                    gattClients[macNorm]?.let { g -> try { g.disconnect(); g.close() } catch (e: Exception) { } }
                    gattClients.remove(macNorm)
                    clientConnectionStates.remove(macNorm)
                    notifyListeners("onConnectionFailed", JSObject()
                        .put("deviceId", rawDeviceId)
                        .put("reason", "Connection timeout")
                        .put("recoverable", true)
                    )
                }
            }, 15000)

        } catch (e: Exception) {
            remLog("ERROR", "GATT_CLIENT", "Fatal connectToDevice: ${e.message}")
            call.reject("Error interno: ${e.message}", "INTERNAL_ERROR")
        }
    }

    private fun createGattClientCallback(macNorm: String): BluetoothGattCallback {
        return object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                val address = gatt.device?.address ?: ""
                remLog("INFO", "GATT_CLIENT_CB", "onConnectionStateChange $address status=$status newState=$newState")
                clientConnectionStates[macNorm] = newState
                val pendingCall = pendingCalls[macNorm]

                if (status != BluetoothGatt.GATT_SUCCESS && newState != BluetoothProfile.STATE_CONNECTED) {
                    remLog("WARN", "GATT_CLIENT_CB", "Error de conexion status=$status, forzando reconexion")
                    pendingCall?.let {
                        it.resolve(JSObject().put("connected", false).put("deviceId", address).put("error", "Connection error $status"))
                        pendingCalls.remove(macNorm)
                    }
                    gattClients.remove(macNorm)
                    clientConnectionStates.remove(macNorm)
                    try { gatt.close() } catch (e: Exception) { }
                    startAutoReconnect(macNorm)
                    return
                }

                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    reconnectAttempts[macNorm] = 0
                    pendingCall?.let {
                        it.resolve(JSObject().put("connected", true).put("alreadyConnected", false).put("deviceId", address))
                        pendingCalls.remove(macNorm)
                    }
                    notifyListeners("onDeviceConnected", JSObject()
                        .put("deviceId", address)
                        .put("direction", "outgoing")
                        .put("role", "client")
                        .put("servicesReady", false)
                    )
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            gatt.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                            remLog("INFO", "GATT_CLIENT_CB", "ConnectionPriority HIGH set para $address")
                        }
                    } catch (e: Exception) {
                        remLog("WARN", "GATT_CLIENT_CB", "No se pudo setear priority: ${e.message}")
                    }
                    try { gatt.discoverServices() } catch (e: SecurityException) {
                        remLog("ERROR", "GATT_CLIENT_CB", "SecurityException discoverServices: ${e.message}")
                    }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    pendingCall?.let {
                        it.resolve(JSObject().put("connected", false).put("deviceId", address).put("error", "Disconnected"))
                        pendingCalls.remove(macNorm)
                    }
                    notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", address))
                    stopKeepAlive(macNorm)
                    gattClients.remove(macNorm)
                    clientRxCharacteristics.remove(macNorm)
                    clientTxCharacteristics.remove(macNorm)
                    clientConnectionStates.remove(macNorm)
                    messageBuffers.remove(macNorm)
                    messageBufferTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
                    try { gatt.close() } catch (e: Exception) { }
                    startAutoReconnect(macNorm)
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                val address = gatt.device?.address ?: ""
                remLog("INFO", "GATT_CLIENT_CB", "onServicesDiscovered $address status=$status")
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    notifyListeners("onConnectionFailed", JSObject().put("deviceId", address).put("reason", "Service discovery failed"))
                    return
                }
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        gatt.requestMtu(MTU_REQUEST)
                        remLog("INFO", "GATT_CLIENT_CB", "MTU request $MTU_REQUEST para $address")
                    }
                } catch (e: Exception) {
                    remLog("WARN", "GATT_CLIENT_CB", "No se pudo request MTU: ${e.message}")
                }
                val service = gatt.getService(NexoBleSpec.NEXO_SERVICE_UUID) ?: run {
                    notifyListeners("onConnectionFailed", JSObject().put("deviceId", address).put("reason", "NEXO service not found"))
                    return
                }
                val txChar = service.getCharacteristic(NexoBleSpec.TX_CHARACTERISTIC_UUID)
                val rxChar = service.getCharacteristic(NexoBleSpec.RX_CHARACTERISTIC_UUID)
                clientTxCharacteristics[macNorm] = txChar
                clientRxCharacteristics[macNorm] = rxChar
                txChar?.let { characteristic ->
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
                        remLog("ERROR", "GATT_CLIENT_CB", "SecurityException notifications: ${e.message}")
                    }
                }
                notifyListeners("onServicesReady", JSObject().put("deviceId", address).put("servicesReady", true))
                processPendingMessages(macNorm)
            }

            override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                val address = gatt.device?.address ?: ""
                remLog("INFO", "GATT_CLIENT_CB", "MTU changed $address mtu=$mtu status=$status")
            }

            override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                val address = gatt.device?.address ?: ""
                if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                    notifyListeners("onNotificationsEnabled", JSObject().put("deviceId", address).put("notificationsEnabled", true))
                    startKeepAlive(macNorm)
                }
            }

            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                    val chunk = characteristic.value?.toString(Charset.defaultCharset()) ?: ""
                    val address = gatt.device?.address ?: ""
                    remLog("INFO", "GATT_CLIENT_CB", "Received chunk (legacy) from $address: len=${chunk.length}")
                    processReceivedChunk(address, chunk, "gatt_client")
                }
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
                if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                    val chunk = value.toString(Charset.defaultCharset())
                    val address = gatt.device?.address ?: ""
                    remLog("INFO", "GATT_CLIENT_CB", "Received chunk (API33+) from $address: len=${chunk.length}")
                    processReceivedChunk(address, chunk, "gatt_client")
                }
            }
        }
    }

    private fun startKeepAlive(macNorm: String) {
        stopKeepAlive(macNorm)
        val runnable = object : Runnable {
            override fun run() {
                val gatt = gattClients[macNorm]
                val state = clientConnectionStates[macNorm]
                if (gatt != null && state == BluetoothProfile.STATE_CONNECTED) {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            gatt.readRemoteRssi()
                        }
                    } catch (e: Exception) {
                        remLog("WARN", "KEEPALIVE", "Error keep-alive $macNorm: ${e.message}")
                    }
                    mainHandler.postDelayed(this, KEEPALIVE_INTERVAL_MS)
                }
            }
        }
        keepAliveTimers[macNorm] = runnable
        mainHandler.postDelayed(runnable, KEEPALIVE_INTERVAL_MS)
        remLog("INFO", "KEEPALIVE", "Iniciado para $macNorm")
    }

    private fun stopKeepAlive(macNorm: String) {
        keepAliveTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    }

    private fun processPendingMessages(macNorm: String) {
        val queue = pendingMessageQueue.remove(macNorm) ?: return
        val gatt = gattClients[macNorm]
        val rxChar = clientRxCharacteristics[macNorm]
        if (gatt != null && rxChar != null && clientConnectionStates[macNorm] == BluetoothProfile.STATE_CONNECTED) {
            queue.forEach { msg ->
                try {
                    val data = msg.toByteArray(Charset.defaultCharset())
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gatt.writeCharacteristic(rxChar, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                    } else {
                        @Suppress("DEPRECATION")
                        rxChar.value = data
                        @Suppress("DEPRECATION")
                        gatt.writeCharacteristic(rxChar)
                    }
                    remLog("INFO", "PENDING_QUEUE", "Mensaje encolado enviado a $macNorm")
                } catch (e: Exception) {
                    remLog("WARN", "PENDING_QUEUE", "Fallo enviando mensaje encolado: ${e.message}")
                }
            }
        } else {
            remLog("WARN", "PENDING_QUEUE", "No se pudieron enviar ${queue.size} mensajes encolados, conexion no lista")
        }
    }

    private fun startAutoReconnect(macNorm: String) {
        val currentAttempts = reconnectAttempts[macNorm] ?: 0
        if (currentAttempts >= MAX_RECONNECT_ATTEMPTS) {
            remLog("WARN", "RECONNECT", "Max reintentos alcanzado para $macNorm")
            return
        }
        reconnectAttempts[macNorm] = currentAttempts + 1

        reconnectTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }

        val runnable = Runnable {
            remLog("INFO", "RECONNECT", "Intentando reconectar a $macNorm (intento ${reconnectAttempts[macNorm]})")
            val ctx = activity.applicationContext
            val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            if (adapter == null || !adapter.isEnabled) return@Runnable

            val device = scannedDevices[macNorm]
            if (device == null) {
                remLog("WARN", "RECONNECT", "No hay device cacheado para $macNorm, no se puede reconectar")
                return@Runnable
            }

            try {
                val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    device.connectGatt(ctx, false, createGattClientCallback(macNorm), BluetoothDevice.TRANSPORT_LE)
                } else {
                    device.connectGatt(ctx, false, createGattClientCallback(macNorm))
                }
                if (gatt != null) {
                    gattClients[macNorm] = gatt
                    clientConnectionStates[macNorm] = BluetoothProfile.STATE_CONNECTING
                }
            } catch (e: Exception) {
                remLog("ERROR", "RECONNECT", "Fallo reconexion $macNorm: ${e.message}")
            }
        }
        reconnectTimers[macNorm] = runnable
        mainHandler.postDelayed(runnable, RECONNECT_DELAY_MS)
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: ""
        val macNorm = normalizeMac(rawDeviceId)
        remLog("INFO", "GATT_CLIENT", "disconnectDevice $rawDeviceId")
        reconnectTimers[macNorm]?.let { mainHandler.removeCallbacks(it) }
        reconnectTimers.remove(macNorm)
        reconnectAttempts.remove(macNorm)
        stopKeepAlive(macNorm)
        gattClients[macNorm]?.let { gatt -> try { gatt.disconnect(); gatt.close() } catch (e: Exception) { } }
        gattClients.remove(macNorm)
        clientRxCharacteristics.remove(macNorm)
        clientTxCharacteristics.remove(macNorm)
        clientConnectionStates.remove(macNorm)
        messageBuffers.remove(macNorm)
        messageBufferTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
        pendingCalls.remove(macNorm)
        pendingMessageQueue.remove(macNorm)
        notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", rawDeviceId))
        call.resolve(JSObject().put("disconnected", true))
    }

    @PluginMethod
    fun forceReconnect(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: ""
        val macNorm = normalizeMac(rawDeviceId)
        remLog("INFO", "GATT_CLIENT", "forceReconnect $rawDeviceId")
        reconnectAttempts[macNorm] = 0
        stopKeepAlive(macNorm)
        gattClients[macNorm]?.let { gatt -> try { gatt.disconnect(); gatt.close() } catch (e: Exception) { } }
        gattClients.remove(macNorm)
        clientConnectionStates.remove(macNorm)
        messageBuffers.remove(macNorm)
        messageBufferTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
        mainHandler.postDelayed({ startAutoReconnect(macNorm) }, 500)
        call.resolve(JSObject().put("reconnecting", true))
    }

    @PluginMethod
    fun reconnectDevice(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: ""
        val macNorm = normalizeMac(rawDeviceId)
        remLog("INFO", "GATT_CLIENT", "reconnectDevice manual $rawDeviceId")
        reconnectAttempts[macNorm] = 0
        startAutoReconnect(macNorm)
        call.resolve(JSObject().put("reconnecting", true))
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: ""
        val message = call.getString("message") ?: ""
        val macNorm = normalizeMac(rawDeviceId)
        remLog("INFO", "SEND", "sendMessage to=$rawDeviceId len=${message.length}")
        if (rawDeviceId.isEmpty()) {
            call.reject("deviceId requerido")
            return
        }

        var sent = false
        var mode = ""

        val rxChar = clientRxCharacteristics[macNorm]
        val gatt = gattClients[macNorm]
        if (gatt != null && rxChar != null && clientConnectionStates[macNorm] == BluetoothProfile.STATE_CONNECTED) {
            try {
                val data = message.toByteArray(Charset.defaultCharset())
                val success = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    gatt.writeCharacteristic(rxChar, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
                } else {
                    @Suppress("DEPRECATION")
                    rxChar.value = data
                    @Suppress("DEPRECATION")
                    gatt.writeCharacteristic(rxChar) ?: false
                }
                remLog("INFO", "SEND", "GATT Client write success=$success")
                if (success) {
                    sent = true
                    mode = "gatt_client"
                }
            } catch (e: Exception) {
                remLog("WARN", "SEND", "GATT Client write exception: ${e.message}")
            }
        }

        if (!sent) {
            val remoteDevice = serverConnectedDevices[macNorm]
            val srvTx = serverTxCharacteristic
            val srv = bluetoothGattServer
            if (remoteDevice != null && srv != null && srvTx != null) {
                try {
                    val data = message.toByteArray(Charset.defaultCharset())
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        srv.notifyCharacteristicChanged(remoteDevice, srvTx, false, data)
                    } else {
                        @Suppress("DEPRECATION")
                        srvTx.value = data
                        @Suppress("DEPRECATION")
                        srv.notifyCharacteristicChanged(remoteDevice, srvTx, false)
                    }
                    remLog("INFO", "SEND", "GATT Server notify success to $macNorm")
                    sent = true
                    mode = "gatt_server"
                } catch (e: Exception) {
                    remLog("WARN", "SEND", "GATT Server notify exception: ${e.message}")
                }
            }
        }

        if (sent) {
            call.resolve(JSObject().put("sent", true).put("mode", mode).put("deviceId", rawDeviceId))
            return
        }

        remLog("WARN", "SEND", "No GATT client ni server para $macNorm, encolando mensaje")
        val queue = pendingMessageQueue.getOrPut(macNorm) { mutableListOf() }
        queue.add(message)
        call.resolve(JSObject().put("sent", false).put("queued", true).put("mode", "pending").put("deviceId", rawDeviceId))
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        remLog("INFO", "ADVERTISING", "startAdvertising")
        val ctx = activity.applicationContext
        val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth desactivado")
            return
        }
        if (!checkCoreBLEPermissions(ctx)) {
            call.reject("Permisos BLE no concedidos")
            return
        }
        autoStartGattServerAndAdvertising()
        call.resolve(JSObject().put("started", true))
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        remLog("INFO", "SCAN", "startScan")
        val ctx = activity.applicationContext
        val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth desactivado")
            return
        }
        if (!isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN)) {
            call.reject("BLUETOOTH_SCAN no concedido")
            return
        }
        autoStartGattServerAndAdvertising()
        bluetoothScanner = adapter.bluetoothLeScanner
        scanResults.clear()
        scannedDevices.clear()
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(NexoBleSpec.NEXO_SERVICE_UUID)).build()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        try {
            bluetoothScanner?.startScan(listOf(filter), settings, scanCallback)
            mainHandler.removeCallbacks(scanTimeoutRunnable)
            mainHandler.postDelayed(scanTimeoutRunnable, SCAN_TIMEOUT_MS)
            call.resolve(JSObject().put("started", true))
        } catch (e: SecurityException) {
            call.reject("Permiso BLUETOOTH_SCAN no concedido")
        }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        stopScanInternal()
        call.resolve(JSObject().put("stopped", true))
    }

    private fun stopScanInternal() {
        mainHandler.removeCallbacks(scanTimeoutRunnable)
        try { bluetoothScanner?.stopScan(scanCallback) } catch (e: Exception) { }
        bluetoothScanner = null
        scannedDevices.clear()
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.device?.let { device ->
                val name = try { device.name } catch (e: SecurityException) { null } ?: "Unknown"
                val addr = device.address
                val macNorm = normalizeMac(addr)
                scannedDevices[macNorm] = device
                remLog("INFO", "SCAN", "Device found: $name ($addr) - cacheado")
                if (scanResults.none { it.getString("deviceId") == addr }) {
                    val item = JSObject().apply {
                        put("deviceId", addr)
                        put("name", name)
                        put("rssi", result.rssi)
                    }
                    scanResults.add(item)
                    notifyListeners("onDeviceFound", item)
                }
            }
        }
        override fun onScanFailed(errorCode: Int) {
            notifyListeners("onScanFailed", JSObject().put("errorCode", errorCode))
        }
    }

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        val ctx = activity.applicationContext
        val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        val enabled = adapter != null && adapter.isEnabled
        call.resolve(JSObject()
            .put("enabled", enabled)
            .put("canAdvertise", enabled && isAdvertisingActive)
            .put("serverReady", bluetoothGattServer != null)
        )
    }

    @PluginMethod
    fun getLocalDeviceInfo(call: PluginCall) {
        val ctx = activity.applicationContext
        val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        call.resolve(JSObject()
            .put("deviceName", adapter?.name ?: "NEXO Device")
            .put("deviceAddress", try { adapter?.address ?: "" } catch (e: SecurityException) { "" })
        )
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val devices = JSArray()
        gattClients.forEach { (mac, gatt) ->
            val state = clientConnectionStates[mac] ?: BluetoothProfile.STATE_DISCONNECTED
            if (state == BluetoothProfile.STATE_CONNECTED) {
                val device = JSObject()
                    .put("id", mac.chunked(2).joinToString(":"))
                    .put("address", mac.chunked(2).joinToString(":"))
                    .put("name", gatt.device?.name ?: "NEXO Peer")
                    .put("direction", "outgoing")
                devices.put(device)
            }
        }
        serverConnectedDevices.forEach { (mac, device) ->
            val item = JSObject()
                .put("id", device.address)
                .put("address", device.address)
                .put("name", device.name ?: "NEXO Peer")
                .put("direction", "incoming")
            devices.put(item)
        }
        call.resolve(JSObject().put("devices", devices))
    }

    private fun registerServerReceivers() {
        if (messageReceiver != null) return
        messageReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED -> {
                        val msg = intent.getStringExtra(NexoBleSpec.EXTRA_MESSAGE_DATA) ?: ""
                        val device = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                        notifyListeners("onPayloadReceived", JSObject()
                            .put("deviceId", device)
                            .put("content", msg)
                            .put("data", msg)
                            .put("source", "broadcast")
                            .put("timestamp", System.currentTimeMillis())
                        )
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED -> {
                        val addr = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                        notifyListeners("onDeviceConnected", JSObject()
                            .put("deviceId", addr)
                            .put("direction", "incoming")
                            .put("role", "server")
                        )
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED -> {
                        val addr = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
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
        } catch (e: Exception) { }
    }

    private fun unregisterServerReceivers() {
        messageReceiver?.let {
            try { activity.unregisterReceiver(it) } catch (e: Exception) { }
            messageReceiver = null
        }
    }

    private fun stopAdvertisingInternal() {
        isAdvertisingActive = false
        try { bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback) } catch (e: Exception) { }
    }

    private val advertiseCallback = object : android.bluetooth.le.AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: android.bluetooth.le.AdvertiseSettings?) {
            isAdvertisingActive = true
            remLog("INFO", "ADVERTISING", "Started")
        }
        override fun onStartFailure(errorCode: Int) {
            isAdvertisingActive = false
            remLog("ERROR", "ADVERTISING", "Failed: $errorCode")
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        val ctx = activity.applicationContext
        try {
            isAdvertisingActive = false
            ctx.stopService(Intent(ctx, BleService::class.java))
            unregisterServerReceivers()
            call.resolve(JSObject().put("stopped", true))
        } catch (e: Exception) {
            call.reject("Error: ${e.message}")
        }
    }

    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val ctx = activity.applicationContext
        val manager = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val running = manager.getRunningServices(Integer.MAX_VALUE).any { it.service.className == BleService::class.java.name }
        call.resolve(JSObject().put("isAdvertising", running))
    }

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

    @PluginMethod
    fun saveToFile(call: PluginCall) {
        val filename = call.getString("filename") ?: run {
            call.reject("filename requerido")
            return
        }
        val content = call.getString("content") ?: run {
            call.reject("content requerido")
            return
        }
        try {
            val file = File(activity.filesDir, filename)
            file.parentFile?.mkdirs()
            FileOutputStream(file).use { fos ->
                OutputStreamWriter(fos, Charsets.UTF_8).use { writer ->
                    writer.write(content)
                }
            }
            call.resolve(JSObject().put("success", true).put("path", file.absolutePath))
        } catch (e: Exception) {
            call.reject("Error guardando archivo: ${e.message}")
        }
    }

    @PluginMethod
    fun loadFromFile(call: PluginCall) {
        val filename = call.getString("filename") ?: run {
            call.reject("filename requerido")
            return
        }
        try {
            val file = File(activity.filesDir, filename)
            if (!file.exists()) {
                call.resolve(JSObject().put("exists", false).put("content", ""))
                return
            }
            val content = FileInputStream(file).use { fis ->
                InputStreamReader(fis, Charsets.UTF_8).use { reader ->
                    reader.readText()
                }
            }
            call.resolve(JSObject().put("exists", true).put("content", content).put("path", file.absolutePath))
        } catch (e: Exception) {
            call.reject("Error leyendo archivo: ${e.message}")
        }
    }

    @PluginMethod
    fun deleteFile(call: PluginCall) {
        val filename = call.getString("filename") ?: run {
            call.reject("filename requerido")
            return
        }
        try {
            val file = File(activity.filesDir, filename)
            val deleted = file.delete()
            call.resolve(JSObject().put("deleted", deleted))
        } catch (e: Exception) {
            call.reject("Error borrando archivo: ${e.message}")
        }
    }

    @PluginMethod
    fun listFiles(call: PluginCall) {
        try {
            val dir = activity.filesDir
            val files = dir.listFiles()?.map { it.name } ?: emptyList()
            val arr = JSArray()
            files.forEach { arr.put(it) }
            call.resolve(JSObject().put("files", arr))
        } catch (e: Exception) {
            call.reject("Error listando archivos: ${e.message}")
        }
    }
}
