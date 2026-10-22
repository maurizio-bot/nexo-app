package com.nexo.ble

import android.app.ActivityManager
import android.bluetooth.BluetoothAdapter
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
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.net.wifi.WifiManager
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.ParcelUuid
import android.provider.Settings
import android.util.Base64
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.nio.charset.Charset
import java.util.Collections
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
        Permission(strings = [android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE], alias = "foregroundServiceConnectedDevice"),
        Permission(strings = ["android.permission.NEARBY_WIFI_DEVICES"], alias = "nearbyWifi")
    ]
)
class NexoBlePlugin : Plugin() {

    companion object {
        private const val TAG = "NexoBlePlugin"
        private const val SCAN_TIMEOUT_MS = 15000L
        private const val RECONNECT_DELAY_MS = 3000L
        private const val MAX_RECONNECT_DELAY_MS = 30000L
        private const val MAX_RECONNECT_ATTEMPTS = 10
        private const val MESSAGE_REASSEMBLY_TIMEOUT_MS = 5000L
        private const val KEEPALIVE_INTERVAL_MS = 10000L
        private const val MTU_REQUEST = 512
        private const val MAX_QUEUE_SIZE = 500
        // === FIX F0: Pacing conservador para evitar saturación del stack BLE nativo ===
        private const val WRITE_DELAY_MS = 40L               // Client writes: 40ms entre operaciones
        private const val SERVER_NOTIFY_DELAY_MS = 80L       // Server notifications: 80ms entre notifies
        private const val CLIENT_WRITE_TIMEOUT_MS = 300L     // Timeout de respaldo si no llega onCharacteristicWrite
        private const val SERVER_NOTIFY_TIMEOUT_MS = 200L    // Timeout de respaldo si no llega onNotificationSent
        private const val WRITE_RETRY_DELAY_MS = 15L         // Reintento si el stack está ocupado (sin bloquear)
        // === FIN FIX F0 ===
        private const val MANUFACTURER_ID = 0xFFFF
        private const val NEXO_MAGIC_HIGH: Byte = 0x4E
        private const val NEXO_MAGIC_LOW: Byte = 0x58
        private const val SCAN_DEBOUNCE_MS = 1000L
        private const val MIN_RSSI = -95
        private const val NXID_MAC_MAP_FILE = "nexo_nxid_mac_map.json"
    }
    private var bluetoothGattServer: BluetoothGattServer? = null
    private var serverTxCharacteristic: BluetoothGattCharacteristic? = null
    private var serverRxCharacteristic: BluetoothGattCharacteristic? = null
    private val serverConnectedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val serverNotificationEnabled = ConcurrentHashMap<String, Boolean>()
    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val clientRxCharacteristics = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
    private val clientTxCharacteristics = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
    private val clientConnectionStates = ConcurrentHashMap<String, Int>()
    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null
    private var bluetoothScanner: BluetoothLeScanner? = null
    private val scanResults = Collections.synchronizedList(mutableListOf<JSObject>())
    private val scannedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scanTimeoutRunnable = Runnable { stopScanInternal() }
    private val reconnectTimers = ConcurrentHashMap<String, Runnable>()
    private val reconnectAttempts = ConcurrentHashMap<String, Int>()
    private val reconnectDelays = ConcurrentHashMap<String, Long>()
    private val keepAliveTimers = ConcurrentHashMap<String, Runnable>()
    private val pendingMessageQueue = ConcurrentHashMap<String, MutableList<String>>()
    private val pendingCalls = ConcurrentHashMap<String, PluginCall>()
    private var messageReceiver: BroadcastReceiver? = null
    private var bluetoothStateReceiver: BroadcastReceiver? = null
    private var isAdvertisingActive = false
    private var nexoAdvertisingId: String? = null
    private val messageBuffers = ConcurrentHashMap<String, StringBuilder>()
    private val messageBufferTimers = ConcurrentHashMap<String, Runnable>()
    private val lastScanNotifyTime = ConcurrentHashMap<String, Long>()
    private val negotiatedMtu = ConcurrentHashMap<String, Int>()
    private val writeQueues = ConcurrentHashMap<String, MutableList<WriteQueueItem>>()
    private val writeQueueProcessing = ConcurrentHashMap<String, Boolean>()
    private val writeQueueTimeouts = ConcurrentHashMap<String, Runnable>()
    private val writeRetryCount = ConcurrentHashMap<String, Int>()
    private val nxidToMacMap = ConcurrentHashMap<String, String>()
    private var quickScanLatch: java.util.concurrent.CountDownLatch? = null
    private var quickScanResultMac: String? = null
    private data class WriteQueueItem(val macNorm: String, val rawDeviceId: String, val chunk: String)
    private data class JsonExtraction(val json: String, val remainder: String)
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
    private fun checkNotificationIntent() {
        try {
            val intent = activity.intent
            if (intent != null) {
                val deviceId = intent.getStringExtra("nexo_chat_device_id")
                if (deviceId != null) {
                    notifyListeners("onNotificationOpened", JSObject()
                        .put("deviceId", deviceId)
                        .put("source", "notification")
                    )
                    intent.removeExtra("nexo_chat_device_id")
                }
            }
        } catch (e: Exception) { }
    }
    // FIX: Parser JSON que respeta strings y escapes (no cuenta {/} dentro de strings)
    private fun tryExtractCompleteJson(buffer: String): JsonExtraction? {
        if (buffer.isBlank()) return null
        var i = 0
        while (i < buffer.length) {
            while (i < buffer.length && buffer[i] != '{') i++
            if (i >= buffer.length) return null
            val startIdx = i
            var braceCount = 0
            var inString = false
            var escapeNext = false
            var j = i
            while (j < buffer.length) {
                val c = buffer[j]
                if (escapeNext) {
                    escapeNext = false
                    j++
                    continue
                }
                if (c == '\\') {
                    escapeNext = true
                    j++
                    continue
                }
                if (c == '"') {
                    inString = !inString
                    j++
                    continue
                }
                if (!inString) {
                    if (c == '{') {
                        braceCount++
                    } else if (c == '}') {
                        braceCount--
                        if (braceCount == 0) {
                            val candidate = buffer.substring(startIdx, j + 1)
                            return try {
                                JSONObject(candidate)
                                JsonExtraction(candidate, buffer.substring(j + 1))
                            } catch (e: Exception) {
                                i = startIdx + 1
                                break
                            }
                        }
                    }
                }
                j++
            }
            if (j >= buffer.length) return null
        }
        return null
    }
    private fun processReceivedChunk(deviceId: String, chunk: String, source: String) {
        val macNorm = normalizeMac(deviceId)
        messageBufferTimers[macNorm]?.let { mainHandler.removeCallbacks(it) }
        val buffer = messageBuffers.getOrPut(macNorm) { StringBuilder() }
        buffer.append(chunk)
        var remaining = buffer.toString()
        var extractedCount = 0
        while (true) {
            val extraction = tryExtractCompleteJson(remaining)
            if (extraction != null) {
                remLog("INFO", "REASSEMBLY", "JSON extraído de $macNorm len=${extraction.json.length}")
                // retainUntilConsumed=true: si el JS aún no escucha (app recién abierta, WebView
                // recargando), Capacitor guarda el mensaje y lo entrega al registrarse el listener.
                // Sin esto Capacitor lo DESCARTA (Plugin.notifyListeners) y el mensaje se perdía.
                notifyListeners("onPayloadReceived", JSObject()
                    .put("deviceId", deviceId)
                    .put("content", extraction.json)
                    .put("data", extraction.json)
                    .put("source", source)
                    .put("timestamp", System.currentTimeMillis())
                    .put("reassembled", true),
                    true
                )
                remaining = extraction.remainder
                extractedCount++
            } else {
                break
            }
        }
        if (remaining.isEmpty()) {
            messageBuffers.remove(macNorm)
            messageBufferTimers.remove(macNorm)
        } else {
            messageBuffers[macNorm] = StringBuilder(remaining)
            val timeoutRunnable = Runnable {
                remLog("WARN", "REASSEMBLY", "Timeout reensamblaje para $macNorm, descartando buffer")
                messageBuffers.remove(macNorm)
                messageBufferTimers.remove(macNorm)
            }
            messageBufferTimers[macNorm] = timeoutRunnable
            mainHandler.postDelayed(timeoutRunnable, MESSAGE_REASSEMBLY_TIMEOUT_MS)
        }
    }
    // === FIN FIX vFIX-3 ===
    private fun loadNexoMappings() {
        try {
            val file = File(activity.filesDir, NXID_MAC_MAP_FILE)
            if (!file.exists()) return
            val content = FileInputStream(file).use { fis ->
                InputStreamReader(fis, Charsets.UTF_8).use { it.readText() }
            }
            val json = JSONObject(content)
            val mapObj = json.optJSONObject("map") ?: return
            mapObj.keys().forEach { key ->
                val value = mapObj.optString(key, "")
                if (value.isNotEmpty()) {
                    nxidToMacMap[key.lowercase()] = value.lowercase().replace(":", "").replace("-", "")
                }
            }
            remLog("INFO", "NXID_MAP", "Cargados ${nxidToMacMap.size} mapeos")
        } catch (e: Exception) {
            remLog("WARN", "NXID_MAP", "Error cargando mapeos: ${e.message}")
        }
    }
    private fun saveNexoMappings() {
        try {
            val json = JSONObject()
            val mapObj = JSONObject()
            nxidToMacMap.forEach { (k, v) -> mapObj.put(k, v) }
            json.put("map", mapObj)
            json.put("savedAt", System.currentTimeMillis())
            val file = File(activity.filesDir, NXID_MAC_MAP_FILE)
            FileOutputStream(file).use { fos ->
                OutputStreamWriter(fos, Charsets.UTF_8).use { it.write(json.toString()) }
            }
        } catch (e: Exception) {
            remLog("WARN", "NXID_MAP", "Error guardando mapeos: ${e.message}")
        }
    }
    private fun registerNexoMapping(nexoId: String, mac: String) {
        val nid = nexoId.lowercase().trim()
        val nmac = normalizeMac(mac)
        if (nid.isEmpty() || nmac.isEmpty()) return
        val existing = nxidToMacMap[nid]
        if (existing == nmac) return
        nxidToMacMap[nid] = nmac
        saveNexoMappings()
        remLog("INFO", "NXID_MAP", "Registrado $nid ↔ $mac")
    }
    private fun classifyDeviceId(id: String): String {
        val trimmed = id.trim()
        if (trimmed.isEmpty()) return "empty"
        if (trimmed.length == 10 && trimmed.startsWith("NX", ignoreCase = true) &&
            trimmed.substring(2).all { it.isLetterOrDigit() }) {
            return "nxid"
        }
        val clean = trimmed.replace(":", "").replace("-", "").replace(".", "").lowercase()
        if (clean.length == 12 && clean.all { it in '0'..'9' || it in 'a'..'f' }) {
            return "mac"
        }
        if (trimmed.matches(Regex("^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$"))) {
            return "mac"
        }
        return "invalid"
    }
    private fun resolveMacForNexoId(nexoId: String): String? {
        val nid = nexoId.lowercase().trim()
        val cachedMac = nxidToMacMap[nid]
        remLog("INFO", "NXID_RESOLVE", "Buscando $nid en el aire...")
        val foundMac = quickScanForNexoId(nid, 5000)
        if (foundMac != null) {
            if (foundMac != cachedMac) {
                remLog("INFO", "NXID_RESOLVE", "MAC cambió para $nid: $cachedMac → $foundMac")
                registerNexoMapping(nid, foundMac)
            }
            return foundMac
        }
        if (cachedMac != null) {
            remLog("WARN", "NXID_RESOLVE", "$nid no encontrado en scan, usando caché: $cachedMac")
            return cachedMac
        }
        remLog("WARN", "NXID_RESOLVE", "$nid no resuelto")
        return null
    }
    private fun quickScanForNexoId(targetNexoId: String, timeoutMs: Long = 5000): String? {
        val ctx = activity.applicationContext
        val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter ?: return null
        if (!adapter.isEnabled) return null
        val scanner = adapter.bluetoothLeScanner ?: return null
        quickScanResultMac = null
        quickScanLatch = java.util.concurrent.CountDownLatch(1)
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                result?.device?.let { device ->
                    val nexoId = extractNexoIdFromScanRecord(result.scanRecord)
                    if (nexoId != null && nexoId.equals(targetNexoId, ignoreCase = true)) {
                        val macNorm = normalizeMac(device.address)
                        quickScanResultMac = macNorm
                        quickScanLatch?.countDown()
                        remLog("INFO", "QUICK_SCAN", "Encontrado $targetNexoId en ${device.address}")
                    }
                }
            }
            override fun onScanFailed(errorCode: Int) {
                quickScanLatch?.countDown()
            }
        }
        try {
            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build()
            scanner.startScan(emptyList(), settings, callback)
        } catch (e: SecurityException) {
            quickScanLatch?.countDown()
            return null
        }
        val found = try {
            quickScanLatch?.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS) ?: false
        } catch (e: InterruptedException) {
            false
        }
        try { scanner.stopScan(callback) } catch (e: Exception) { }
        quickScanLatch = null

        return if (found) quickScanResultMac else null
    }
    override fun load() {
        super.load()
        checkNotificationIntent()
        loadNexoMappings()
        remLog("INFO", "LIFECYCLE", "load - auto-starting GATT server, ${nxidToMacMap.size} mapeos cargados")
        registerBluetoothStateReceiver()
        autoStartGattServerAndAdvertising()
    }
    override fun handleOnResume() {
        super.handleOnResume()
        checkNotificationIntent()
        remLog("INFO", "LIFECYCLE", "handleOnResume")
        val ctx = activity.applicationContext
        val granted = checkCoreBLEPermissions(ctx)
        if (granted) {
            notifyListeners("onPermissionStatusChanged", JSObject()
                .put("granted", true)
                .put("source", "onResume")
            )
            autoStartGattServerAndAdvertising()
        }
        // El JS no tiene @capacitor/app: se le avisa desde aquí para reconectar y vaciar la cola
        notifyListeners("onAppStateChange", JSObject().put("isActive", true))
    }
    override fun handleOnPause() {
        super.handleOnPause()
        remLog("INFO", "LIFECYCLE", "handleOnPause")
        notifyListeners("onAppStateChange", JSObject().put("isActive", false))
    }
    override fun handleOnDestroy() {
        super.handleOnDestroy()
        remLog("INFO", "LIFECYCLE", "handleOnDestroy - limpiando DUAL GATT")
        cleanupAllConnections()
        try { unregisterServerReceivers() } catch (e: Exception) { }
        try { unregisterBluetoothStateReceiver() } catch (e: Exception) { }
        try { stopScanInternal() } catch (e: Exception) { }
        try { stopGattServer() } catch (e: Exception) { }
        isAdvertisingActive = false
        try { stopAdvertisingInternal() } catch (e: Exception) { }
        messageBuffers.clear()
        messageBufferTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        messageBufferTimers.clear()
        lastScanNotifyTime.clear()
        writeQueues.clear()
        writeQueueProcessing.clear()
        writeQueueTimeouts.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        writeQueueTimeouts.clear()
        negotiatedMtu.clear()
    }
    private fun isScanning(): Boolean {
        return bluetoothScanner != null
    }
    private fun reconnectKnownDevices() {
        val ctx = activity.applicationContext
        val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        if (adapter == null || !adapter.isEnabled) return
        gattClients.forEach { (macNorm, gatt) ->
            val state = clientConnectionStates[macNorm] ?: BluetoothProfile.STATE_DISCONNECTED
            if (state != BluetoothProfile.STATE_CONNECTED && state != BluetoothProfile.STATE_CONNECTING) {
                remLog("INFO", "FOREGROUND", "Auto-reconnect a $macNorm al volver de background")
                reconnectAttempts[macNorm] = 0
                reconnectDelays.remove(macNorm)
                startAutoReconnect(macNorm)
            }
        }
    }
    private fun registerBluetoothStateReceiver() {
        if (bluetoothStateReceiver != null) return
        bluetoothStateReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
                val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                when (state) {
                    BluetoothAdapter.STATE_OFF -> {
                        remLog("WARN", "BT_STATE", "Bluetooth apagado")
                        isAdvertisingActive = false
                        stopScanInternal()
                        cleanupAllConnections()
                        notifyListeners("onBluetoothStateChanged", JSObject()
                            .put("state", "off")
                            .put("enabled", false)
                        )
                    }
                    BluetoothAdapter.STATE_ON -> {
                        remLog("INFO", "BT_STATE", "Bluetooth encendido")
                        notifyListeners("onBluetoothStateChanged", JSObject()
                            .put("state", "on")
                            .put("enabled", true)
                        )
                        autoStartGattServerAndAdvertising()
                    }
                }
            }
        }
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.registerReceiver(bluetoothStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                activity.registerReceiver(bluetoothStateReceiver, filter)
            }
        } catch (e: Exception) {
            remLog("WARN", "BT_STATE", "No se pudo registrar receiver: ${e.message}")
        }
    }
    private fun unregisterBluetoothStateReceiver() {
        bluetoothStateReceiver?.let {
            try { activity.unregisterReceiver(it) } catch (e: Exception) { }
            bluetoothStateReceiver = null
        }
    }
    private fun autoStartGattServerAndAdvertising() {
        val ctx = activity.applicationContext
        if (!checkCoreBLEPermissions(ctx)) {
            remLog("WARN", "AUTO_START", "Permisos no concedidos, no se puede auto-start")
            return
        }
        val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        if (adapter == null || !adapter.isEnabled) {
            remLog("WARN", "AUTO_START", "Bluetooth no disponible")
            return
        }
        if (bluetoothGattServer == null) {
            startGattServer()
        }
        if (!isAdvertisingActive) {
            try {
                val intent = Intent(ctx, BleService::class.java)
                nexoAdvertisingId?.let { id ->
                    intent.putExtra("nexo_advertising_id", id)
                }
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
        reconnectDelays.clear()
        keepAliveTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        keepAliveTimers.clear()
        pendingMessageQueue.clear()
        messageBuffers.clear()
        messageBufferTimers.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        messageBufferTimers.clear()
        lastScanNotifyTime.clear()
        writeQueues.clear()
        writeQueueProcessing.clear()
        writeQueueTimeouts.forEach { (_, runnable) -> mainHandler.removeCallbacks(runnable) }
        writeQueueTimeouts.clear()
        negotiatedMtu.clear()
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
                serverNotificationEnabled.remove(mac)
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
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            if (characteristic.uuid == NexoBleSpec.RX_CHARACTERISTIC_UUID) {
                val chunk = value?.toString(Charsets.UTF_8) ?: ""
                val mac = device.address
                remLog("INFO", "GATT_SERVER", "RX chunk from $mac: len=${chunk.length}")
                processReceivedChunk(mac, chunk, "gatt_server")
                if (responseNeeded) {
                    bluetoothGattServer?.sendResponse(
                        device,
                        requestId,
                        BluetoothGatt.GATT_SUCCESS,
                        offset,
                        value
                    )
                }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            if (descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                val macNorm = normalizeMac(device.address)
                val enabled = value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true ||
                              value?.contentEquals(BluetoothGattDescriptor.ENABLE_INDICATION_VALUE) == true
                serverNotificationEnabled[macNorm] = enabled
                descriptor.value = value
                if (responseNeeded) {
                    bluetoothGattServer?.sendResponse(
                        device,
                        requestId,
                        BluetoothGatt.GATT_SUCCESS,
                        offset,
                        value
                    )
                }
                remLog("INFO", "GATT_SERVER", "CCCD escrito por ${device.address} enabled=$enabled")
            }
        }

        // Android confirma que la notificación salió: enviar la siguiente de la cola
        override fun onNotificationSent(device: BluetoothDevice, status: Int) {
            val macNorm = normalizeMac(device.address)
            mainHandler.post { onWriteDone(macNorm) }
        }

        // FIX: Registrar MTU negociado cuando actuamos como servidor (Android 12+)
        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            val macNorm = normalizeMac(device.address)
            val effectiveMtu = if (mtu > 23) mtu else 23
            negotiatedMtu[macNorm] = effectiveMtu
            remLog("INFO", "GATT_SERVER", "MTU changed $macNorm mtu=$effectiveMtu")
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

            val idType = classifyDeviceId(rawDeviceId)
            if (idType == "invalid") {
                call.reject("ID invalido: no es NXID ni MAC", "INVALID_DEVICE_ID")
                return
            }

            val macNorm: String
            val resolvedNexoId: String?
            if (idType == "nxid") {
                resolvedNexoId = rawDeviceId.trim()
                val resolvedMac = resolveMacForNexoId(resolvedNexoId)
                if (resolvedMac == null) {
                    call.reject("NXID no resuelto a MAC: $rawDeviceId. Intenta escanear primero.", "NXID_UNRESOLVED")
                    return
                }
                macNorm = resolvedMac
                remLog("INFO", "GATT_CLIENT", "connectToDevice NXID='$resolvedNexoId' → MAC='$macNorm'")
            } else {
                macNorm = normalizeMac(rawDeviceId)
                resolvedNexoId = null
                remLog("INFO", "GATT_CLIENT", "connectToDevice MAC='$macNorm'")
            }

            val existingState = clientConnectionStates[macNorm]
            if (existingState == BluetoothProfile.STATE_CONNECTING) {
                remLog("WARN", "GATT_CLIENT", "Conexion ya en progreso para $macNorm")
                call.resolve(JSObject().put("connected", false).put("error", "Connection already in progress").put("deviceId", rawDeviceId))
                return
            }
            if (gattClients.containsKey(macNorm) && existingState == BluetoothProfile.STATE_CONNECTED) {
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
            reconnectAttempts[macNorm] = 0
            reconnectDelays.remove(macNorm)
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
                    reconnectDelays.remove(macNorm)
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
                        // PHY 2M (2 Mbps) si ambos lo soportan; si no, Android se queda en 1M
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                            gatt.setPreferredPhy(BluetoothDevice.PHY_LE_2M_MASK, BluetoothDevice.PHY_LE_2M_MASK, BluetoothDevice.PHY_OPTION_NO_PREFERRED)
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
                    closeClientWithoutService(gatt, macNorm, address)
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
                    // El otro teléfono tiene la app cerrada (su servidor GATT no está). Antes la conexión
                    // quedaba abierta sin servicio y "ya conectado" impedía reconectar al reabrir.
                    notifyListeners("onConnectionFailed", JSObject().put("deviceId", address).put("reason", "NEXO service not found"))
                    closeClientWithoutService(gatt, macNorm, address)
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
                val effectiveMtu = if (status == BluetoothGatt.GATT_SUCCESS && mtu > 23) mtu else 23
                negotiatedMtu[macNorm] = effectiveMtu
                remLog("INFO", "GATT_CLIENT_CB", "MTU changed $address mtu=$effectiveMtu status=$status")
            }

            override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                val address = gatt.device?.address ?: ""
                if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                    notifyListeners("onNotificationsEnabled", JSObject().put("deviceId", address).put("notificationsEnabled", true))
                    startKeepAlive(macNorm)
                }
            }

            @Suppress("DEPRECATION")
            override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
                val address = gatt.device?.address ?: ""
                val macNormLocal = normalizeMac(address)
                if (characteristic.uuid == NexoBleSpec.RX_CHARACTERISTIC_UUID) {
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        remLog("WARN", "GATT_CLIENT_CB", "onCharacteristicWrite FAILED $address status=$status")
                    }
                    mainHandler.post { onWriteDone(macNormLocal) }
                }
            }

            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                    val chunk = characteristic.value?.toString(Charsets.UTF_8) ?: ""
                    val address = gatt.device?.address ?: ""
                    remLog("INFO", "GATT_CLIENT_CB", "Received chunk (legacy) from $address: len=${chunk.length}")
                    processReceivedChunk(address, chunk, "gatt_client")
                }
            }

            // NUEVO: Soporte para Android 13+ onCharacteristicChanged con payload directo
            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
                if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                    val chunk = value.toString(Charsets.UTF_8)
                    val address = gatt.device?.address ?: ""
                    remLog("INFO", "GATT_CLIENT_CB", "Received chunk (API 33+) from $address: len=${chunk.length}")
                    processReceivedChunk(address, chunk, "gatt_client")
                }
            }
        }
    }

    private fun closeClientWithoutService(gatt: BluetoothGatt, macNorm: String, address: String) {
        try { gatt.disconnect(); gatt.close() } catch (e: Exception) { }
        gattClients.remove(macNorm)
        clientRxCharacteristics.remove(macNorm)
        clientTxCharacteristics.remove(macNorm)
        clientConnectionStates.remove(macNorm)
        notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", address).put("reason", "no_service"))
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
                        stopKeepAlive(macNorm)
                        return
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

    private fun getReconnectDelay(macNorm: String): Long {
        val attempts = reconnectAttempts[macNorm] ?: 0
        val delay = RECONNECT_DELAY_MS * (1L shl attempts.coerceAtMost(4))
        return delay.coerceAtMost(MAX_RECONNECT_DELAY_MS)
    }

    private fun startAutoReconnect(macNorm: String) {
        val currentAttempts = reconnectAttempts[macNorm] ?: 0
        if (currentAttempts >= MAX_RECONNECT_ATTEMPTS) {
            remLog("WARN", "RECONNECT", "Max reintentos alcanzado para $macNorm")
            return
        }
        reconnectAttempts[macNorm] = currentAttempts + 1
        val delayMs = getReconnectDelay(macNorm)
        reconnectDelays[macNorm] = delayMs
        reconnectTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
        val runnable = Runnable {
            remLog("INFO", "RECONNECT", "Intentando reconectar a $macNorm (intento ${reconnectAttempts[macNorm]}, delay=${delayMs}ms)")
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
                gattClients[macNorm]?.let { old ->
                    try { old.disconnect(); old.close() } catch (e: Exception) { }
                }
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
        mainHandler.postDelayed(runnable, delayMs)
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: ""
        if (rawDeviceId.isEmpty()) {
            call.reject("deviceId requerido")
            return
        }
        val idType = classifyDeviceId(rawDeviceId)
        val macNorm = if (idType == "nxid") {
            resolveMacForNexoId(rawDeviceId.trim()) ?: rawDeviceId.trim().lowercase()
        } else {
            normalizeMac(rawDeviceId)
        }
        remLog("INFO", "GATT_CLIENT", "disconnectDevice raw=$rawDeviceId resolved=$macNorm")
        reconnectTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
        reconnectAttempts.remove(macNorm)
        reconnectDelays.remove(macNorm)
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
        writeQueues.remove(macNorm)
        writeQueueProcessing.remove(macNorm)
        writeQueueTimeouts.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
        negotiatedMtu.remove(macNorm)
        notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", rawDeviceId))
        call.resolve(JSObject().put("disconnected", true))
    }

    @PluginMethod
    fun forceReconnect(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: ""
        if (rawDeviceId.isEmpty()) {
            call.reject("deviceId requerido")
            return
        }
        val idType = classifyDeviceId(rawDeviceId)
        val macNorm = if (idType == "nxid") {
            resolveMacForNexoId(rawDeviceId.trim()) ?: rawDeviceId.trim().lowercase()
        } else {
            normalizeMac(rawDeviceId)
        }
        remLog("INFO", "GATT_CLIENT", "forceReconnect raw=$rawDeviceId resolved=$macNorm")
        reconnectAttempts[macNorm] = 0
        reconnectDelays.remove(macNorm)
        stopKeepAlive(macNorm)
        gattClients[macNorm]?.let { gatt -> try { gatt.disconnect(); gatt.close() } catch (e: Exception) { } }
        gattClients.remove(macNorm)
        clientConnectionStates.remove(macNorm)
        messageBuffers.remove(macNorm)
        messageBufferTimers.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
        writeQueues.remove(macNorm)
        writeQueueProcessing.remove(macNorm)
        writeQueueTimeouts.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
        negotiatedMtu.remove(macNorm)
        mainHandler.postDelayed({ startAutoReconnect(macNorm) }, 500)
        call.resolve(JSObject().put("reconnecting", true))
    }

    @PluginMethod
    fun reconnectDevice(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: ""
        if (rawDeviceId.isEmpty()) {
            call.reject("deviceId requerido")
            return
        }
        val idType = classifyDeviceId(rawDeviceId)
        val macNorm = if (idType == "nxid") {
            resolveMacForNexoId(rawDeviceId.trim()) ?: rawDeviceId.trim().lowercase()
        } else {
            normalizeMac(rawDeviceId)
        }
        remLog("INFO", "GATT_CLIENT", "reconnectDevice manual raw=$rawDeviceId resolved=$macNorm")
        reconnectAttempts[macNorm] = 0
        reconnectDelays.remove(macNorm)
        startAutoReconnect(macNorm)
        call.resolve(JSObject().put("reconnecting", true))
    }

    // === FIX vFIX-3: sendMessage corre SIEMPRE en mainHandler (single-threaded) ===
    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: ""
        val message = call.getString("message") ?: call.getString("content") ?: ""

        if (rawDeviceId.isEmpty()) {
            call.reject("deviceId requerido")
            return
        }
        val idType = classifyDeviceId(rawDeviceId)
        if (idType == "invalid") {
            call.reject("ID invalido: no es NXID ni MAC", "INVALID_DEVICE_ID")
            return
        }

        mainHandler.post {
            val macNorm: String
            if (idType == "nxid") {
                val resolvedMac = resolveMacForNexoId(rawDeviceId.trim())
                if (resolvedMac == null) {
                    call.reject("NXID no resuelto a MAC: $rawDeviceId", "NXID_UNRESOLVED")
                    return@post
                }
                macNorm = resolvedMac
                remLog("INFO", "SEND", "sendMessage NXID='$rawDeviceId' → MAC='$macNorm' len=${message.length}")
            } else {
                macNorm = normalizeMac(rawDeviceId)
                remLog("INFO", "SEND", "sendMessage MAC='$macNorm' len=${message.length}")
            }

            val result = sendChunkedOrSingle(macNorm, rawDeviceId, message)
            // MTU negociado: el JS ajusta el tamaño de los trozos de archivos (ble_ack.js)
            val mtu = negotiatedMtu[macNorm] ?: 23
            if (result.sent) {
                call.resolve(JSObject().put("sent", true).put("mode", result.mode).put("deviceId", rawDeviceId).put("mtu", mtu))
            } else {
                val queue = pendingMessageQueue.getOrPut(macNorm) { mutableListOf() }
                queue.add(message)
                call.resolve(JSObject().put("sent", false).put("queued", true).put("mode", "pending").put("deviceId", rawDeviceId).put("mtu", mtu))
            }
        }
    }


    private data class SendResult(val sent: Boolean, val mode: String)

    // === FIX F0: Margen de seguridad para UTF-8 multibyte ===
    private fun getChunkSize(macNorm: String): Int {
        val mtu = negotiatedMtu[macNorm] ?: 23
        // Margen de 10 bytes para overhead JSON + acentos UTF-8 (2 bytes) + emojis (4 bytes)
        return (mtu - 3 - 10).coerceAtLeast(20)
    }
    // === FIN FIX F0 ===

    // FIX: Chunking que respeta surrogate pairs UTF-16 (no parte emojis)
    private fun safeChunkString(str: String, chunkSize: Int): List<String> {
        val result = mutableListOf<String>()
        var i = 0
        while (i < str.length) {
            var end = minOf(i + chunkSize, str.length)
            if (end < str.length && Character.isHighSurrogate(str[end - 1]) && Character.isLowSurrogate(str[end])) {
                end--
            }
            result.add(str.substring(i, end))
            i = end
        }
        return result
    }

    private fun sendChunkedOrSingle(macNorm: String, rawDeviceId: String, message: String): SendResult {
        val chunkSize = getChunkSize(macNorm)
        if (message.length <= chunkSize) {
            return enqueueWrite(macNorm, rawDeviceId, message)
        }
        val chunks = safeChunkString(message, chunkSize)
        val firstResult = enqueueWrite(macNorm, rawDeviceId, chunks[0])
        if (!firstResult.sent) {
            return SendResult(false, "")
        }
        for (i in 1 until chunks.size) {
            val item = WriteQueueItem(macNorm, rawDeviceId, chunks[i])
            val queue = writeQueues.getOrPut(macNorm) { java.util.Collections.synchronizedList(mutableListOf()) }
            if (queue.size >= MAX_QUEUE_SIZE) {
                remLog("WARN", "SEND", "Cola llena para $macNorm, descartando chunk $i")
                continue
            }
            queue.add(item)
        }
        remLog("INFO", "SEND", "Mensaje fragmentado en ${chunks.size} chunks (size=$chunkSize) para $macNorm")
        return SendResult(true, firstResult.mode)
    }

    private fun enqueueWrite(macNorm: String, rawDeviceId: String, chunk: String): SendResult {
        val item = WriteQueueItem(macNorm, rawDeviceId, chunk)
        val queue = writeQueues.getOrPut(macNorm) { java.util.Collections.synchronizedList(mutableListOf()) }
        if (queue.size >= MAX_QUEUE_SIZE) {
            remLog("WARN", "SEND", "Cola llena para $macNorm, descartando chunk")
            return SendResult(false, "")
        }
        queue.add(item)
        // La cola se procesa solo en el hilo principal (los callbacks de Android también llegan ahí)
        mainHandler.post { processWriteQueue(macNorm) }
        return SendResult(true, "queued")
    }

    // === FIX F0: Pacing diferenciado server vs client ===
    // Control de flujo por callback (v2): una escritura en vuelo por dispositivo; la siguiente sale en
    // cuanto Android confirma la anterior (onCharacteristicWrite como cliente, onNotificationSent como
    // servidor), con un timeout de respaldo. Antes: esperas fijas de 40/80 ms y reintentos con
    // Thread.sleep en el hilo principal (congelaban la interfaz).
    private fun processWriteQueue(macNorm: String) {
        if (writeQueueProcessing[macNorm] == true) return
        val queue = writeQueues[macNorm] ?: return
        val item = synchronized(queue) { if (queue.isEmpty()) null else queue[0] } ?: return
        val result = sendSingleChunk(item.macNorm, item.rawDeviceId, item.chunk)
        if (!result.sent) {
            val attempts = (writeRetryCount[macNorm] ?: 0) + 1
            if (attempts < 3) {
                writeRetryCount[macNorm] = attempts
            } else {
                remLog("WARN", "SEND", "Write fallo para $macNorm tras 3 intentos, descartando chunk")
                writeRetryCount.remove(macNorm)
                removeHead(queue, item)
            }
            // Bloquear la cola durante la espera: otras llamadas no deben gastar los reintentos de golpe
            writeQueueProcessing[macNorm] = true
            mainHandler.postDelayed({
                writeQueueProcessing.remove(macNorm)
                processWriteQueue(macNorm)
            }, WRITE_RETRY_DELAY_MS)
            return
        }
        writeRetryCount.remove(macNorm)
        removeHead(queue, item)
        writeQueueProcessing[macNorm] = true
        val timeoutMs = if (result.mode == "gatt_server") SERVER_NOTIFY_TIMEOUT_MS else CLIENT_WRITE_TIMEOUT_MS
        val timeoutRunnable = Runnable {
            writeQueueTimeouts.remove(macNorm)
            onWriteDone(macNorm)
        }
        writeQueueTimeouts.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
        writeQueueTimeouts[macNorm] = timeoutRunnable
        mainHandler.postDelayed(timeoutRunnable, timeoutMs)
    }

    private fun removeHead(queue: MutableList<WriteQueueItem>, item: WriteQueueItem) {
        synchronized(queue) { if (queue.isNotEmpty() && queue[0] === item) queue.removeAt(0) }
    }

    // Llamado (en el hilo principal) cuando Android confirma la escritura/notificación o vence el timeout
    private fun onWriteDone(macNorm: String) {
        writeQueueTimeouts.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
        writeQueueProcessing.remove(macNorm)
        processWriteQueue(macNorm)
    }
    // === FIN FIX F0 ===

    // === FIX F0: Timeout de client write reducido y chunk size con margen ===
    private fun sendSingleChunk(macNorm: String, rawDeviceId: String, chunk: String): SendResult {
        val data = chunk.toByteArray(Charsets.UTF_8)

        val remoteDevice = serverConnectedDevices[macNorm]
        val srvTx = serverTxCharacteristic
        val srv = bluetoothGattServer
        val srvEnabled = serverNotificationEnabled.getOrDefault(macNorm, false)

        if (remoteDevice != null && srv != null && srvTx != null && srvEnabled) {
            try {
                val success = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    srv.notifyCharacteristicChanged(remoteDevice, srvTx, false, data) == BluetoothGatt.GATT_SUCCESS
                } else {
                    @Suppress("DEPRECATION")
                    srvTx.value = data
                    @Suppress("DEPRECATION")
                    srv.notifyCharacteristicChanged(remoteDevice, srvTx, false)
                }
                if (success) {
                    remLog("INFO", "SEND", "GATT Server chunk sent to $macNorm len=${chunk.length}")
                    return SendResult(true, "gatt_server")
                }
            } catch (e: Exception) {
                remLog("WARN", "SEND", "Server notify failed for $macNorm: ${e.message}")
            }
        }

        val rxChar = clientRxCharacteristics[macNorm]
        val gatt = gattClients[macNorm]

        if (gatt != null && rxChar != null && clientConnectionStates[macNorm] == BluetoothProfile.STATE_CONNECTED) {
            try {
                var writeInitiated = false
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    val status = gatt.writeCharacteristic(rxChar, data, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE)
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        writeInitiated = true
                        remLog("INFO", "SEND", "GATT Client chunk sent (NO_RESPONSE) to $macNorm len=${chunk.length}")
                    } else {
                        remLog("WARN", "SEND", "NO_RESPONSE fallo status=$status, intentando DEFAULT para $macNorm")
                        val fallbackStatus = gatt.writeCharacteristic(rxChar, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                        if (fallbackStatus == BluetoothGatt.GATT_SUCCESS) {
                            writeInitiated = true
                            remLog("INFO", "SEND", "GATT Client chunk sent (DEFAULT fallback) to $macNorm len=${chunk.length}")
                        }
                    }
                } else {
                    @Suppress("DEPRECATION")
                    rxChar.value = data
                    @Suppress("DEPRECATION")
                    rxChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                    @Suppress("DEPRECATION")
                    writeInitiated = gatt.writeCharacteristic(rxChar)
                    if (!writeInitiated) {
                        remLog("WARN", "SEND", "NO_RESPONSE fallo (legacy), intentando DEFAULT para $macNorm")
                        @Suppress("DEPRECATION")
                        rxChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                        @Suppress("DEPRECATION")
                        writeInitiated = gatt.writeCharacteristic(rxChar)
                        if (writeInitiated) {
                            remLog("INFO", "SEND", "GATT Client chunk sent (DEFAULT fallback legacy) to $macNorm len=${chunk.length}")
                        }
                    } else {
                        remLog("INFO", "SEND", "GATT Client chunk sent (NO_RESPONSE legacy) to $macNorm len=${chunk.length}")
                    }
                }
                if (writeInitiated) {
                    return SendResult(true, "gatt_client")
                }
            } catch (e: Exception) {
                remLog("WARN", "SEND", "GATT Client write exception: ${e.message}")
            }
        }

        return SendResult(false, "")
    }
    // === FIN FIX F0 ===

    private fun processPendingMessages(macNorm: String) {
        val queue = pendingMessageQueue.remove(macNorm) ?: return
        val gatt = gattClients[macNorm]
        val rxChar = clientRxCharacteristics[macNorm]
        if (gatt != null && rxChar != null && clientConnectionStates[macNorm] == BluetoothProfile.STATE_CONNECTED) {
            queue.forEachIndexed { index, msg ->
                mainHandler.postDelayed({
                    val result = sendChunkedOrSingle(macNorm, "", msg)
                    if (result.sent) {
                        remLog("INFO", "PENDING_QUEUE", "Mensaje encolado enviado a $macNorm")
                    } else {
                        remLog("WARN", "PENDING_QUEUE", "Fallo enviando mensaje encolado a $macNorm")
                    }
                }, index * 200L)
            }
        } else {
            remLog("WARN", "PENDING_QUEUE", "No se pudieron enviar ${queue.size} mensajes encolados, conexion no lista")
            queue.forEach { msg ->
                val q = pendingMessageQueue.getOrPut(macNorm) { mutableListOf() }
                q.add(msg)
            }
        }
    }

    @PluginMethod
    fun setAdvertisingData(call: PluginCall) {
        val nexoId = call.getString("nexoId") ?: run {
            call.reject("nexoId requerido")
            return
        }
        nexoAdvertisingId = nexoId
        remLog("INFO", "ADVERTISING", "NEXO ID set: $nexoId")
        val ctx = activity.applicationContext
        val intent = Intent(ctx, BleService::class.java)
        intent.putExtra("nexo_advertising_id", nexoId)
        intent.putExtra("action", "UPDATE_ADVERTISING_DATA")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent)
        } else {
            ctx.startService(intent)
        }
        call.resolve(JSObject().put("set", true).put("nexoId", nexoId))
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
        val hasScanPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN)
        } else {
            isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
        }
        if (!hasScanPermission) {
            call.reject("BLUETOOTH_SCAN/LOCATION no concedido")
            return
        }
        autoStartGattServerAndAdvertising()
        bluetoothScanner = adapter.bluetoothLeScanner
        scanResults.clear()
        scannedDevices.clear()
        lastScanNotifyTime.clear()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        // filtered=true (re-búsqueda con la app oculta): solo anuncios NEXO. Sin filtro Android no
        // entrega resultados con la pantalla apagada.
        val filters = if (call.getBoolean("filtered", false) == true) listOf(
            ScanFilter.Builder()
                .setManufacturerData(MANUFACTURER_ID, byteArrayOf(NEXO_MAGIC_HIGH, NEXO_MAGIC_LOW), byteArrayOf(0xFF.toByte(), 0xFF.toByte()))
                .build()
        ) else emptyList()
        try {
            bluetoothScanner?.startScan(filters, settings, scanCallback)
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

    private fun extractNexoIdFromScanRecord(scanRecord: android.bluetooth.le.ScanRecord?): String? {
        if (scanRecord == null) return null
        val manufacturerData = scanRecord.manufacturerSpecificData ?: return null
        if (manufacturerData.size() == 0) return null
        for (i in 0 until manufacturerData.size()) {
            val key = manufacturerData.keyAt(i)
            val data = manufacturerData.get(key) ?: continue
            if (data.size >= 4) {
                val b0 = data[0].toInt() and 0xFF
                val b1 = data[1].toInt() and 0xFF
                if (b0 == 0x4E && b1 == 0x58) {
                    val nexoId = String(data, 2, data.size - 2, Charsets.UTF_8)
                    remLog("INFO", "SCAN", "NEXO ID found in manufacturer ID 0x${key.toString(16)}: $nexoId")
                    return nexoId
                }
            }
        }
        return null
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.device?.let { device ->
                val name = result.scanRecord?.deviceName ?: try { device.name } catch (e: SecurityException) { null } ?: "Unknown"
                val addr = device.address
                val macNorm = normalizeMac(addr)
                val rssi = result.rssi

                if (rssi < MIN_RSSI) {
                    return@let
                }

                scannedDevices[macNorm] = device

                val nexoId = extractNexoIdFromScanRecord(result.scanRecord)

                if (nexoId != null) {
                    registerNexoMapping(nexoId, addr)
                }

                remLog("INFO", "SCAN", "Device found: $name ($addr) NEXO=$nexoId rssi=$rssi - cacheado")

                val item = JSObject().apply {
                    put("deviceId", addr)
                    put("name", name)
                    put("rssi", rssi)
                    if (nexoId != null) {
                        put("nexoId", nexoId)
                    }
                }

                synchronized(scanResults) {
                    if (scanResults.none { normalizeMac(it.getString("deviceId") ?: "") == macNorm }) {
                        scanResults.add(item)
                    }
                }

                val now = System.currentTimeMillis()
                val lastNotify = lastScanNotifyTime[macNorm]
                if (lastNotify == null || (now - lastNotify) >= SCAN_DEBOUNCE_MS) {
                    lastScanNotifyTime[macNorm] = now
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
                val addr = gatt.device?.address ?: mac.chunked(2).joinToString(":").uppercase()
                val device = JSObject()
                    .put("id", addr)
                    .put("address", addr)
                    .put("name", try { gatt.device?.name } catch (e: SecurityException) { null } ?: "NEXO Peer")
                    .put("direction", "outgoing")
                    .put("role", "client")
                    .put("ready", clientRxCharacteristics.containsKey(mac))
                devices.put(device)
            }
        }
        serverConnectedDevices.forEach { (mac, device) ->
            val item = JSObject()
                .put("id", device.address)
                .put("address", device.address)
                .put("name", try { device.name } catch (e: SecurityException) { null } ?: "NEXO Peer")
                .put("direction", "incoming")
                .put("role", "server")
                .put("ready", serverNotificationEnabled.getOrDefault(mac, false))
            devices.put(item)
        }
        call.resolve(JSObject().put("devices", devices))
    }

    private fun registerServerReceivers() {
        if (messageReceiver != null) return
        messageReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
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
            val dir: File = activity.filesDir
            val fileArray: Array<File>? = dir.listFiles()
            val fileNames: List<String> = if (fileArray != null) {
                fileArray.map { file: File -> file.name }
            } else {
                emptyList<String>()
            }
            val arr = JSArray()
            for (name in fileNames) {
                arr.put(name)
            }
            call.resolve(JSObject().put("files", arr))
        } catch (e: Exception) {
            call.reject("Error listando archivos: ${e.message}")
        }
    }

    // ===== Archivos recibidos: abrir con otra app y miniatura de PDF =====

    // Nombre seguro para un archivo en la caché (llega del otro teléfono)
    private fun safeFileName(name: String?): String {
        val clean = (name ?: "").substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[^A-Za-z0-9._ ()\\-]"), "_").trim().trimStart('.')
        return (if (clean.isEmpty()) "archivo" else clean).take(80)
    }

    private fun writeCacheFile(dirName: String, name: String, b64: String): File {
        val dir = File(activity.cacheDir, dirName)
        dir.mkdirs()
        // Los abiertos hace más de un día ya no hacen falta
        val old = System.currentTimeMillis() - 86400000L
        dir.listFiles()?.forEach { if (it.lastModified() < old) it.delete() }
        val file = File(dir, name)
        FileOutputStream(file).use { it.write(Base64.decode(b64, Base64.DEFAULT)) }
        return file
    }

    // Escribe el archivo en la caché y lo abre con la app que corresponda (lector de PDF, instalador
    // de APK…) mediante el FileProvider de la app. Devuelve opened=false con reason si no se puede.
    @PluginMethod
    fun openFile(call: PluginCall) {
        val b64 = call.getString("base64") ?: run { call.reject("base64 requerido"); return }
        val name = safeFileName(call.getString("name"))
        var mime = call.getString("mime") ?: ""
        if (!mime.contains('/')) {
            mime = android.webkit.MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
        }
        try {
            val isApk = mime == "application/vnd.android.package-archive" || name.lowercase().endsWith(".apk")
            if (isApk) mime = "application/vnd.android.package-archive"
            if (isApk && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                !context.packageManager.canRequestPackageInstalls()) {
                // Android pide permitir a NEXO instalar apps (una sola vez)
                val s = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(s)
                call.resolve(JSObject().put("opened", false).put("reason", "install_permission"))
                return
            }
            val file = writeCacheFile("nexo_open", name, b64)
            val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            remLog("INFO", "FILE", "Abriendo archivo ($mime, ${file.length()} bytes)")
            call.resolve(JSObject().put("opened", true))
        } catch (e: ActivityNotFoundException) {
            call.resolve(JSObject().put("opened", false).put("reason", "no_app"))
        } catch (e: Exception) {
            remLog("WARN", "FILE", "No se pudo abrir el archivo: ${e.message}")
            call.reject("Error abriendo archivo: ${e.message}")
        }
    }

    // Primera página de un PDF como JPEG (base64) con el lector de PDF de Android, y número de páginas
    @PluginMethod
    fun pdfThumbnail(call: PluginCall) {
        val b64 = call.getString("base64") ?: run { call.reject("base64 requerido"); return }
        val width = (call.getInt("width") ?: 320).coerceIn(64, 1024)
        var tmp: File? = null
        var pfd: ParcelFileDescriptor? = null
        var renderer: PdfRenderer? = null
        try {
            tmp = writeCacheFile("nexo_pdf", "thumb_" + System.nanoTime() + ".pdf", b64)
            pfd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY)
            renderer = PdfRenderer(pfd)
            val pages = renderer.pageCount
            if (pages < 1) { call.reject("PDF sin páginas"); return }
            val page = renderer.openPage(0)
            val h = (width.toFloat() * page.height / page.width.coerceAtLeast(1)).toInt().coerceIn(1, width * 2)
            val bmp = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888)
            bmp.eraseColor(Color.WHITE)
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            page.close()
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, 70, out)
            bmp.recycle()
            call.resolve(JSObject().put("thumb", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)).put("pages", pages))
        } catch (e: Exception) {
            call.reject("PDF no legible: ${e.message}")
        } finally {
            try { renderer?.close() } catch (e: Exception) {}
            try { pfd?.close() } catch (e: Exception) {}
            tmp?.delete()
        }
    }

    // Jump: nivel de batería, si está cargando y si está en ahorro de energía (con poca batería el
    // teléfono deja de hacer de puente para otros)
    @PluginMethod
    fun getPowerStatus(call: PluginCall) {
        try {
            val bm = context.getSystemService(Context.BATTERY_SERVICE) as android.os.BatteryManager
            val level = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
            val charging = bm.isCharging
            val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            call.resolve(JSObject().put("level", level).put("charging", charging).put("powerSave", pm.isPowerSaveMode))
        } catch (e: Exception) {
            call.reject("Estado de batería no disponible: ${e.message}")
        }
    }

    // ===== Wi-Fi Direct: fotos, vídeos y archivos con el contacto a alcance (mucho más rápido que BLE) =====
    // El que recibe crea un grupo con nombre y contraseña aleatorios (Android 10+: el otro se une sin aviso
    // del sistema) y abre un socket; el que envía se une, manda el contenido (ya cifrado de extremo a
    // extremo) y espera la confirmación. El grupo se cierra al terminar. Bluetooth sigue siendo el canal de
    // control (por ahí viajan las credenciales, cifradas).
    private var p2pManager: WifiP2pManager? = null
    private var p2pChannel: WifiP2pManager.Channel? = null
    private var wdServer: java.net.ServerSocket? = null
    private val WD_MAX_BYTES = 40_000_000L

    private fun p2pInit(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_DIRECT)) return false
        if (p2pManager == null) {
            p2pManager = context.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager
            p2pChannel = p2pManager?.initialize(context, Looper.getMainLooper(), null)
        }
        return p2pManager != null && p2pChannel != null
    }

    private fun wdPermissionGranted(): Boolean =
        if (Build.VERSION.SDK_INT >= 33) isGranted(context, "android.permission.NEARBY_WIFI_DEVICES")
        else isGranted(context, android.Manifest.permission.ACCESS_FINE_LOCATION)

    private fun wdRandom(n: Int): String {
        val chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
        val rnd = java.security.SecureRandom()
        return (1..n).map { chars[rnd.nextInt(chars.length)] }.joinToString("")
    }

    private fun wdTearDown() {
        mainHandler.post {
            val m = p2pManager
            val ch = p2pChannel
            if (m != null && ch != null) {
                try { m.removeGroup(ch, null) } catch (e: Exception) {}
                try { m.cancelConnect(ch, null) } catch (e: Exception) {}
            }
        }
    }

    @PluginMethod
    fun wifiDirectStatus(call: PluginCall) {
        val supported = p2pInit()
        val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        call.resolve(JSObject().put("supported", supported).put("granted", wdPermissionGranted()).put("wifiOn", wm?.isWifiEnabled ?: false))
    }

    @PluginMethod
    fun requestWifiDirectPermission(call: PluginCall) {
        if (wdPermissionGranted()) { call.resolve(JSObject().put("granted", true)); return }
        requestPermissionForAlias(if (Build.VERSION.SDK_INT >= 33) "nearbyWifi" else "location", call, "wifiDirectPermCallback")
    }

    @PermissionCallback
    fun wifiDirectPermCallback(call: PluginCall) {
        call.resolve(JSObject().put("granted", wdPermissionGranted()))
    }

    @android.annotation.SuppressLint("MissingPermission")
    @PluginMethod
    fun wifiDirectHost(call: PluginCall) {
        val transferId = call.getString("transferId") ?: run { call.reject("transferId requerido"); return }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !p2pInit() || !wdPermissionGranted()) {
            call.reject("Wi-Fi Direct no disponible", "WD_UNAVAILABLE"); return
        }
        val m = p2pManager!!
        val ch = p2pChannel!!
        val name = "DIRECT-" + wdRandom(2) + "-NEXO"
        val pass = wdRandom(16)
        val cfg = WifiP2pConfig.Builder().setNetworkName(name).setPassphrase(pass)
            .enablePersistentMode(false).setGroupOperatingBand(WifiP2pConfig.GROUP_OWNER_BAND_AUTO).build()
        fun create() {
            m.createGroup(ch, cfg, object : WifiP2pManager.ActionListener {
                override fun onSuccess() {
                    try {
                        try { wdServer?.close() } catch (e: Exception) {}
                        val server = java.net.ServerSocket(0)
                        server.soTimeout = 90000
                        wdServer = server
                        remLog("INFO", "WIFI_DIRECT", "Grupo creado para $transferId, puerto ${server.localPort}")
                        call.resolve(JSObject().put("ssid", name).put("passphrase", pass).put("port", server.localPort))
                        Thread { wdReceive(server, transferId) }.start()
                    } catch (e: Exception) {
                        wdTearDown()
                        call.reject("Socket no disponible: ${e.message}", "WD_SOCKET")
                    }
                }
                override fun onFailure(reason: Int) { call.reject("No se pudo crear el grupo ($reason)", "WD_GROUP") }
            })
        }
        mainHandler.post {
            m.removeGroup(ch, object : WifiP2pManager.ActionListener {
                override fun onSuccess() { create() }
                override fun onFailure(reason: Int) { create() }
            })
        }
    }

    private fun wdReceive(server: java.net.ServerSocket, transferId: String) {
        try {
            server.accept().use { sock ->
                sock.soTimeout = 30000
                val tRead = System.currentTimeMillis()
                val input = java.io.DataInputStream(java.io.BufferedInputStream(sock.getInputStream()))
                val h = JSONObject(input.readUTF())
                if (h.optString("id") != transferId) throw Exception("transferencia distinta")
                val len = h.optLong("len")
                if (len <= 0 || len > WD_MAX_BYTES) throw Exception("tamaño no válido")
                val buf = ByteArray(len.toInt())
                input.readFully(buf)
                sock.getOutputStream().apply { write(1); flush() }
                val readMs = System.currentTimeMillis() - tRead
                remLog("INFO", "WIFI_DIRECT", "Recibido $transferId ($len bytes) en $readMs ms")
                notifyListeners("onWifiDirectReceived", JSObject().put("transferId", transferId).put("data", String(buf, Charsets.UTF_8)).put("bytes", len)
                    .put("readMs", readMs).put("ts", System.currentTimeMillis()), true)
            }
        } catch (e: Exception) {
            remLog("WARN", "WIFI_DIRECT", "Recepción fallida $transferId: ${e.message}")
            notifyListeners("onWifiDirectReceived", JSObject().put("transferId", transferId).put("error", e.message ?: "error"), true)
        } finally {
            try { server.close() } catch (e: Exception) {}
            if (wdServer === server) wdServer = null
            wdTearDown()
        }
    }

    @android.annotation.SuppressLint("MissingPermission")
    @PluginMethod
    fun wifiDirectSend(call: PluginCall) {
        val ssid = call.getString("ssid") ?: run { call.reject("ssid requerido"); return }
        val pass = call.getString("passphrase") ?: run { call.reject("passphrase requerido"); return }
        val port = call.getInt("port") ?: run { call.reject("port requerido"); return }
        val transferId = call.getString("transferId") ?: run { call.reject("transferId requerido"); return }
        val data = call.getString("data") ?: run { call.reject("data requerido"); return }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !p2pInit() || !wdPermissionGranted()) {
            call.reject("Wi-Fi Direct no disponible", "WD_UNAVAILABLE"); return
        }
        val m = p2pManager!!
        val ch = p2pChannel!!
        val t0 = System.currentTimeMillis()
        // Tiempo que tardó el contenido en pasar de la app (WebView) a Android
        val jsTs = call.getLong("jsTs") ?: t0
        val bridgeMs = (t0 - jsTs).coerceAtLeast(0)
        val cfg = WifiP2pConfig.Builder().setNetworkName(ssid).setPassphrase(pass).build()
        fun push(addr: java.net.InetAddress) {
            val tJoined = System.currentTimeMillis()
            Thread {
                try {
                    val bytes = data.toByteArray(Charsets.UTF_8)
                    java.net.Socket().use { s ->
                        s.connect(java.net.InetSocketAddress(addr, port), 10000)
                        s.soTimeout = 60000
                        val out = java.io.DataOutputStream(java.io.BufferedOutputStream(s.getOutputStream()))
                        out.writeUTF(JSONObject().put("id", transferId).put("len", bytes.size).toString())
                        out.write(bytes)
                        out.flush()
                        if (s.getInputStream().read() != 1) throw Exception("sin confirmación")
                    }
                    val now = System.currentTimeMillis()
                    val ms = now - t0
                    remLog("INFO", "WIFI_DIRECT", "Enviado $transferId (${bytes.size} bytes) en $ms ms (unirse ${tJoined - t0} ms, envío ${now - tJoined} ms, de la app a Android $bridgeMs ms)")
                    call.resolve(JSObject().put("ok", true).put("ms", ms).put("bytes", bytes.size)
                        .put("joinMs", tJoined - t0).put("xferMs", now - tJoined).put("bridgeMs", bridgeMs))
                } catch (e: Exception) {
                    call.reject("Envío fallido: ${e.message}", "WD_SEND")
                } finally {
                    wdTearDown()
                }
            }.start()
        }
        fun waitGroup(attempt: Int) {
            m.requestConnectionInfo(ch) { info ->
                val addr = info?.groupOwnerAddress
                if (info != null && info.groupFormed && addr != null) push(addr)
                else if (attempt < 80) mainHandler.postDelayed({ waitGroup(attempt + 1) }, 250)
                else { wdTearDown(); call.reject("El grupo no se formó", "WD_TIMEOUT") }
            }
        }
        mainHandler.post {
            m.connect(ch, cfg, object : WifiP2pManager.ActionListener {
                override fun onSuccess() { waitGroup(0) }
                override fun onFailure(reason: Int) { call.reject("No se pudo conectar ($reason)", "WD_CONNECT") }
            })
        }
    }
}
