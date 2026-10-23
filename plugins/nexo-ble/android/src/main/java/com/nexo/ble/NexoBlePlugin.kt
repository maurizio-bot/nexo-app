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
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
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
        @Volatile private var netBgShared: NetBg? = null
        private const val TAG = "NexoBlePlugin"
        private const val SCAN_TIMEOUT_MS = 15000L
        private const val RECONNECT_DELAY_MS = 3000L
        private const val MAX_RECONNECT_DELAY_MS = 30000L
        private const val MAX_RECONNECT_ATTEMPTS = 10
        private const val MESSAGE_REASSEMBLY_TIMEOUT_MS = 5000L
        private const val MESSAGE_MAX_PENDING_MS = 10000L
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
    // Largo alcance (LE Coded PHY): cuándo se vio por última vez cada dispositivo en 1M y en Coded
    private val seen1M = ConcurrentHashMap<String, Long>()
    private val seenCoded = ConcurrentHashMap<String, Long>()
    private val codedLinks = ConcurrentHashMap.newKeySet<String>()
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
    private val messageBufferSince = ConcurrentHashMap<String, Long>() // desde cuándo hay algo pendiente
    private val lastScanNotifyTime = ConcurrentHashMap<String, Long>()
    private val negotiatedMtu = ConcurrentHashMap<String, Int>()
    private val writeQueues = ConcurrentHashMap<String, MutableList<WriteQueueItem>>()
    private val writeQueueProcessing = ConcurrentHashMap<String, Boolean>()
    private val writeQueueTimeouts = ConcurrentHashMap<String, Runnable>()
    private val writeRetryCount = ConcurrentHashMap<String, Int>()
    private val nxidToMacMap = ConcurrentHashMap<String, String>()
    private var quickScanLatch: java.util.concurrent.CountDownLatch? = null
    private var quickScanResultMac: String? = null
    // msgId: de qué mensaje es el trozo (un mensaje nunca se parte: o salen todos sus trozos o ninguno más)
    private data class WriteQueueItem(val macNorm: String, val rawDeviceId: String, val chunk: String, val msgId: Long = 0L)
    private val writeMsgCounter = java.util.concurrent.atomic.AtomicLong()
    private data class JsonExtraction(val json: String, val remainder: String)
    // Solo estas etiquetas cruzan a la app (diagnóstico). El resto (uno por cada trozo enviado o recibido) solo
    // va a logcat: la 2722 los escuchaba todos y miles de avisos por foto saturaban el puente (fotos paradas).
    private val remLogToJs = setOf("AT_REST", "FILE_IO")
    private fun remLog(level: String, tag: String, message: String) {
        Log.i("NEXO_REM", "[$level][$tag] $message")
        if (tag !in remLogToJs) return
        try {
            notifyListeners("onRemLog", JSObject()
                .put("level", level)
                .put("tag", tag)
                .put("message", message)
                .put("timestamp", System.currentTimeMillis())
            )
        } catch (e: Exception) { }
    }
    // La actividad es singleTask: tocar una notificación con la app abierta llega aquí
    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        checkNotificationIntent(intent)
    }
    private fun checkNotificationIntent(given: Intent? = null) {
        try {
            val intent = given ?: activity.intent
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
        // v2723: si lo pendiente lleva más de 10 s sin formar un mensaje, es un mensaje mutilado (se perdió un
        // trozo): fuera, y se sigue con lo que llega. Antes solo se limpiaba tras 5 s SIN trozos nuevos, y con
        // los reenvíos llegando sin parar nunca se limpiaba: todo lo siguiente quedaba tragado (foto parada).
        val pendingSince = messageBufferSince[macNorm]
        if (pendingSince != null && System.currentTimeMillis() - pendingSince > MESSAGE_MAX_PENDING_MS && messageBuffers[macNorm]?.isNotEmpty() == true) {
            remLog("WARN", "REASSEMBLY", "Mensaje incompleto de $macNorm descartado (resincronizado)")
            messageBuffers.remove(macNorm)
        }
        if (messageBuffers[macNorm].isNullOrEmpty()) messageBufferSince[macNorm] = System.currentTimeMillis()
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
                messageBufferSince[macNorm] = System.currentTimeMillis()
            } else {
                break
            }
        }
        if (remaining.isEmpty()) {
            messageBuffers.remove(macNorm)
            messageBufferTimers.remove(macNorm)
            messageBufferSince.remove(macNorm)
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
            val settings = scanSettings()
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
        // Seguridad fase 3: cifrar en segundo plano lo que aún esté en claro (archivos de versiones anteriores)
        // (prioridad baja; de lo ya cifrado solo se lee la cabecera)
        Thread {
            try {
                val t0 = System.currentTimeMillis()
                val n = atRest().migrateAll()
                atRestMigration = if (atRestDataKey() != null) "$n archivo(s) cifrados ahora (${System.currentTimeMillis() - t0} ms)" else "sin clave"
                remLog("INFO", "AT_REST", if (atRestDataKey() != null) "Cifrado en reposo activo; $atRestMigration" else "Cifrado en reposo NO disponible")
            } catch (e: Throwable) { remLog("WARN", "AT_REST", "Migración: ${e.message}") }
        }.apply { priority = Thread.MIN_PRIORITY }.start()
        checkNotificationIntent()
        loadNexoMappings()
        remLog("INFO", "LIFECYCLE", "load - auto-starting GATT server, ${nxidToMacMap.size} mapeos cargados")
        registerBluetoothStateReceiver()
        autoStartGattServerAndAdvertising()
    }
    override fun handleOnResume() {
        super.handleOnResume()
        appInBackground = false
        try { netBgShared?.stop() } catch (e: Exception) { }
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
        appInBackground = true
        // La app deja de estar a la vista: la escucha nativa de internet toma el relevo (la app la reconfigura al
        // ocultarse con lo último que vio)
        mainHandler.postDelayed({ if (appInBackground) try { netBg().start() } catch (e: Exception) { } }, 3000)
        notifyListeners("onAppStateChange", JSObject().put("isActive", false))
    }
    override fun handleOnDestroy() {
        super.handleOnDestroy()
        try { lanStopAll() } catch (e: Exception) {}
        try { torStopAll() } catch (e: Exception) {}
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
                connectLe(ctx, device, macNorm)
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
                        // (no con un enlace de largo alcance: 2M tiene menos alcance y se cortaría)
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !codedLinks.contains(normalizeMac(address))) {
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
                    connectLe(ctx, device, macNorm)
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
                // v2729: solo pasa con la cola de escritura llena (el mensaje entero no cabe). "Ocupado": la app lo
                // reintenta en un momento. Antes se aparcaba en la cola de pendientes (solo se vaciaba al reconectar)
                // y la app lo daba por enviado: el último trozo de cada ventana esperaba a que venciera su espera.
                call.reject("Cola de escritura llena para $macNorm", "BLE_BUSY")
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

    // v2723: un mensaje entra entero en la cola o no entra (antes, con la cola llena se descartaban trozos del
    // medio y el otro teléfono recibía un mensaje mutilado: "mensaje de código" en el chat y foto parada)
    private fun sendChunkedOrSingle(macNorm: String, rawDeviceId: String, message: String): SendResult {
        val chunkSize = getChunkSize(macNorm)
        val chunks = if (message.length <= chunkSize) listOf(message) else safeChunkString(message, chunkSize)
        val queue = writeQueues.getOrPut(macNorm) { java.util.Collections.synchronizedList(mutableListOf()) }
        val msgId = writeMsgCounter.incrementAndGet()
        synchronized(queue) {
            // (un mensaje más grande que la cola entera entra cuando está vacía: si no, esperaría para siempre)
            if (queue.isNotEmpty() && queue.size + chunks.size > MAX_QUEUE_SIZE) {
                remLog("WARN", "SEND", "Cola llena para $macNorm: el mensaje espera (no se parte)")
                return SendResult(false, "")
            }
            chunks.forEach { queue.add(WriteQueueItem(macNorm, rawDeviceId, it, msgId)) }
        }
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
            // Android rechaza la escritura si aún está ocupado con la anterior (muy frecuente con la radio
            // cargada). v2723: se reintenta (15 ms las primeras veces, luego 50 ms) hasta ~1,8 s; si no se puede,
            // fuera el RESTO DE ESE MENSAJE entero. Antes: 3 intentos y se descartaba ese trozo suelto (mensaje
            // mutilado en el otro teléfono).
            val attempts = (writeRetryCount[macNorm] ?: 0) + 1
            var delay = if (attempts < 5) WRITE_RETRY_DELAY_MS else 50L
            if (attempts < 40) {
                writeRetryCount[macNorm] = attempts
            } else {
                writeRetryCount.remove(macNorm)
                val dropped = synchronized(queue) { val before = queue.size; queue.removeAll { it.msgId == item.msgId }; before - queue.size }
                remLog("WARN", "SEND", "Write fallo para $macNorm durante ~1,8 s: mensaje descartado entero ($dropped trozos)")
                delay = WRITE_RETRY_DELAY_MS
            }
            // Bloquear la cola durante la espera: otras llamadas no deben gastar los reintentos de golpe
            writeQueueProcessing[macNorm] = true
            mainHandler.postDelayed({
                writeQueueProcessing.remove(macNorm)
                processWriteQueue(macNorm)
            }, delay)
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
        val settings = scanSettings()
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

    private fun codedSupported(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        return try {
            val bm = activity.applicationContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            bm.adapter?.isLeCodedPhySupported == true
        } catch (e: Exception) { false }
    }

    // Escaneo: con largo alcance también los anuncios extendidos en LE Coded (setLegacy(false) entrega los dos)
    private fun scanSettings(): ScanSettings {
        val b = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        if (codedSupported()) b.setLegacy(false).setPhy(ScanSettings.PHY_LE_ALL_SUPPORTED)
        return b.build()
    }

    // Conectar: en LE Coded solo si ese teléfono solo se ve por largo alcance (en 1M es más rápido)
    private fun connectLe(ctx: Context, device: BluetoothDevice, macNorm: String): BluetoothGatt? {
        val now = System.currentTimeMillis()
        val coded = codedSupported() && now - (seenCoded[macNorm] ?: 0L) < 60000L && now - (seen1M[macNorm] ?: 0L) > 10000L
        if (coded) codedLinks.add(macNorm) else codedLinks.remove(macNorm)
        if (coded && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            remLog("INFO", "GATT_CLIENT", "Conectando a $macNorm por largo alcance (LE Coded)")
            return device.connectGatt(ctx, false, createGattClientCallback(macNorm), BluetoothDevice.TRANSPORT_LE,
                BluetoothDevice.PHY_LE_1M_MASK or BluetoothDevice.PHY_LE_CODED_MASK)
        }
        return device.connectGatt(ctx, false, createGattClientCallback(macNorm), BluetoothDevice.TRANSPORT_LE)
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
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && result.primaryPhy == BluetoothDevice.PHY_LE_CODED) seenCoded[macNorm] = System.currentTimeMillis()
                else seen1M[macNorm] = System.currentTimeMillis()

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
            .put("codedPhy", codedSupported()) // largo alcance (LE Coded PHY)
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

    // Los archivos se leen y guardan fuera del hilo de los plugins (Capacitor los ejecuta todos en uno, en fila):
    // así guardar o leer un vídeo no hace esperar a sendMessage ni a los guardados pequeños (claves, historial).
    // Cada archivo va siempre al mismo hilo (el orden de guardar/leer un mismo archivo se mantiene); los grandes
    // (adjuntos, HD y cola de Jump) tienen el suyo.
    private val ioSmall = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val ioBig = java.util.concurrent.Executors.newSingleThreadExecutor()
    private fun ioFor(name: String) = if (name.startsWith("nexo_att_") || name.startsWith("nexo_relay_")) ioBig else ioSmall
    private fun ioRun(name: String, op: String, call: PluginCall, block: () -> Unit) {
        ioFor(name).execute {
            val t0 = System.currentTimeMillis()
            try { block() } catch (e: Throwable) { call.reject("Error $op archivo: ${e.message}") }
            val ms = System.currentTimeMillis() - t0
            // Sin el nombre (puede llevar el NEXO ID de un contacto): solo el tipo
            if (ms > 300) remLog("WARN", "FILE_IO", "$op lento: ${ms} ms (${if (ioFor(name) === ioBig) "adjunto" else name.substringBefore("_nx").substringBefore(".")})")
        }
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
        val path = File(context.filesDir, filename).absolutePath
        ioRun(filename, "guardando", call) {
            atRest().write(filename, content) // cifrado en reposo (AtRestStore)
            call.resolve(JSObject().put("success", true).put("path", path))
        }
    }

    @PluginMethod
    fun loadFromFile(call: PluginCall) {
        val filename = call.getString("filename") ?: run {
            call.reject("filename requerido")
            return
        }
        val path = File(context.filesDir, filename).absolutePath
        ioRun(filename, "leyendo", call) {
            val content = atRest().read(filename)
            if (content == null) call.resolve(JSObject().put("exists", false).put("content", ""))
            else call.resolve(JSObject().put("exists", true).put("content", content).put("path", path))
        }
    }

    @PluginMethod
    fun deleteFile(call: PluginCall) {
        val filename = call.getString("filename") ?: run {
            call.reject("filename requerido")
            return
        }
        ioRun(filename, "borrando", call) {
            call.resolve(JSObject().put("deleted", atRest().delete(filename)))
        }
    }

    // ===== Seguridad fase 3: cifrado en reposo, huella y capturas =====
    // Clave de datos (AES-256) aleatoria, guardada envuelta (AES-GCM) con una clave del Android Keystore que no
    // sale del chip; en memoria solo mientras la app corre. Sin requisito de huella: los mensajes deben poder
    // guardarse con la app bloqueada o en segundo plano.
    private val atRestAlias = "nexo_at_rest_wrap_v1"
    @Volatile private var atRestKey: SecretKey? = null
    @Volatile private var atRestFailed = false
    @Volatile private var atRestMigration = "en curso"
    private var atRestStore: AtRestStore? = null

    @Synchronized
    private fun atRest(): AtRestStore {
        atRestStore?.let { return it }
        val st = AtRestStore(context.filesDir) { atRestDataKey() }
        st.skip = setOf(NXID_MAC_MAP_FILE) // lo lee y escribe el propio Kotlin
        st.migrateOnly = { it.startsWith("nexo_") } // solo lo de NEXO (no los archivos de librerías de Android)
        atRestStore = st
        return st
    }

    @Synchronized
    private fun atRestDataKey(): SecretKey? {
        atRestKey?.let { return it }
        if (atRestFailed) return null
        return try {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val wrap = (ks.getKey(atRestAlias, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(KeyGenParameterSpec.Builder(atRestAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build())
                generateKey()
            }
            val prefs = context.getSharedPreferences("nexo_at_rest", Context.MODE_PRIVATE)
            val stored = prefs.getString("dek", null)
            val dek: ByteArray = if (stored == null) {
                val k = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.ENCRYPT_MODE, wrap)
                val blob = c.iv + c.doFinal(k)
                if (!prefs.edit().putString("dek", Base64.encodeToString(blob, Base64.NO_WRAP)).commit()) throw Exception("no se pudo guardar la clave")
                k
            } else {
                val blob = Base64.decode(stored, Base64.NO_WRAP)
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, wrap, GCMParameterSpec(128, blob, 0, 12))
                c.doFinal(blob, 12, blob.size - 12)
            }
            val key = SecretKeySpec(dek, "AES")
            // Autoprueba antes de usarla
            val probe = "nexo-at-rest-probe".toByteArray()
            if (!AtRestStore.decrypt(key, AtRestStore.encrypt(key, probe)).contentEquals(probe)) throw Exception("autoprueba fallida")
            atRestKey = key
            key
        } catch (e: Exception) {
            atRestFailed = true
            remLog("WARN", "AT_REST", "Clave de cifrado en reposo no disponible: ${e.message}")
            null
        }
    }

    @PluginMethod
    fun atRestStatus(call: PluginCall) {
        call.resolve(JSObject().put("active", atRestDataKey() != null).put("migration", atRestMigration))
    }

    private fun biometricAuthenticators(): Int =
        if (Build.VERSION.SDK_INT >= 30) BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        else BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL

    @PluginMethod
    fun biometricStatus(call: PluginCall) {
        val r = BiometricManager.from(context).canAuthenticate(biometricAuthenticators())
        call.resolve(JSObject().put("available", r == BiometricManager.BIOMETRIC_SUCCESS).put("code", r))
    }

    // Huella / cara / PIN del teléfono. Resuelve { ok: true } o { ok: false, reason }
    @PluginMethod
    fun biometricAuth(call: PluginCall) {
        val act = activity as? FragmentActivity ?: run { call.resolve(JSObject().put("ok", false).put("reason", "sin actividad")); return }
        val title = call.getString("title") ?: "Desbloquear NEXO"
        val subtitle = call.getString("subtitle") ?: ""
        act.runOnUiThread {
            try {
                val prompt = BiometricPrompt(act, ContextCompat.getMainExecutor(context), object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { call.resolve(JSObject().put("ok", true)) }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { call.resolve(JSObject().put("ok", false).put("reason", errString.toString()).put("code", errorCode)) }
                })
                val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle(subtitle).setAllowedAuthenticators(biometricAuthenticators()).build()
                prompt.authenticate(info)
            } catch (e: Exception) {
                call.resolve(JSObject().put("ok", false).put("reason", e.message ?: "error"))
            }
        }
    }

    // ===== Internet en segundo plano (NetBg): escucha los relés mientras la app no está a la vista =====
    // Una por proceso: sigue aunque se cierre la actividad mientras el servicio de Bluetooth mantiene el proceso
    private fun netBg(): NetBg = netBgShared ?: synchronized(NexoBlePlugin::class.java) {
        netBgShared ?: NetBg({ nx, name, msgId -> MsgNotifier.get(context).message(nx, name, msgId, "") }, { Log.i("NEXO_NET", it) }).also { netBgShared = it }
    }

    @PluginMethod
    fun netBgConfig(call: PluginCall) {
        val me = call.getString("me") ?: run { call.reject("falta me"); return }
        val relays = ArrayList<String>(); val list = ArrayList<NetBg.Contact>()
        try {
            call.getArray("relays")?.let { for (i in 0 until it.length()) relays.add(it.getString(i)) }
            call.getArray("contacts")?.let { for (i in 0 until it.length()) { val o = it.getJSONObject(i); list.add(NetBg.Contact(o.getString("nx").lowercase(), o.optString("name"), Secp256k1.unhex(o.getString("kraw")))) } }
        } catch (e: Exception) { call.reject("configuración ilegible"); return }
        val since = (call.getData().optLong("since", 0L))
        netBg().configure(me, relays, since, list)
        if (appInBackground && list.isNotEmpty()) netBg().start()
        call.resolve(JSObject().put("contacts", list.size).put("running", netBg().running))
    }

    // ===== Notificaciones de mensajes (MsgNotifier): las pide notify.js con la app en segundo plano =====
    @PluginMethod
    fun notifyMessage(call: PluginCall) {
        val chatId = call.getString("chatId") ?: run { call.reject("falta chatId"); return }
        val count = MsgNotifier.get(context).message(chatId, call.getString("name") ?: "NEXO", call.getString("msgId") ?: System.currentTimeMillis().toString(), call.getString("text") ?: "")
        call.resolve(JSObject().put("count", count))
    }

    @PluginMethod
    fun clearChatNotification(call: PluginCall) {
        val chatId = call.getString("chatId") ?: run { call.reject("falta chatId"); return }
        MsgNotifier.get(context).clear(chatId)
        call.resolve()
    }

    // Los contadores de la app mandan: ajusta o quita las notificaciones puestas (también las de segundo plano)
    @PluginMethod
    fun syncUnread(call: PluginCall) {
        val counts = HashMap<String, Int>()
        try {
            val arr = call.getArray("chats")
            if (arr != null) for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                counts[o.optString("chatId").lowercase()] = o.optInt("count", 0)
            }
        } catch (e: Exception) { }
        MsgNotifier.get(context).sync(counts)
        call.resolve()
    }

    // Bloquear capturas y grabación de pantalla (y ocultar NEXO en "recientes")
    @PluginMethod
    fun setSecureScreen(call: PluginCall) {
        val on = call.getBoolean("on") ?: false
        val act = activity ?: run { call.reject("sin actividad"); return }
        act.runOnUiThread {
            if (on) act.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else act.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            call.resolve(JSObject().put("on", on))
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

    // ===== Wi-Fi normal (misma red): LanHub (TCP) + NSD (mDNS, como Bonjour en iPhone) =====
    // Cada teléfono se anuncia como "_nexo._tcp" con una marca del día (t) que solo sus contactos saben calcular
    // (sin NEXO ID a la vista). Al encontrar la marca de un contacto, la app pide conectar; los mensajes son los
    // mismos JSON que por Bluetooth (ya cifrados). La app comprueba cada conexión con el cifrado antes de usarla.
    private var lanHub: LanHub? = null
    private var nsdManager: android.net.nsd.NsdManager? = null
    private var nsdReg: android.net.nsd.NsdManager.RegistrationListener? = null
    private var nsdDisc: android.net.nsd.NsdManager.DiscoveryListener? = null
    private var lanMcLock: WifiManager.MulticastLock? = null
    // Escaneo activo de la red (LanBeacon): por si el router no deja pasar el anuncio mDNS
    private var lanBeacon: LanBeacon? = null
    private var lanNetCb: android.net.ConnectivityManager.NetworkCallback? = null
    @Volatile private var lanLastSweep = 0L
    @Volatile private var lanMyId = ""
    private var lanToken = ""
    private var lanServiceName = ""
    private val nsdResolveQueue = java.util.concurrent.ConcurrentLinkedQueue<android.net.nsd.NsdServiceInfo>()
    @Volatile private var nsdResolving = false
    private val lanSendExec = java.util.concurrent.Executors.newSingleThreadExecutor()

    private fun lanOnWifi(): Boolean = try {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        caps != null && (caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET))
    } catch (e: Exception) { false }

    @PluginMethod
    fun lanStatus(call: PluginCall) {
        // Calidad de cada conexión (latido nativo): ida y vuelta media y tiempo sin recibir
        val peers = JSArray()
        lanHub?.quality()?.forEach { (nx, rtt, idle) -> peers.put(JSObject().put("nx", nx).put("rtt", rtt).put("idle", idle)) }
        call.resolve(JSObject().put("supported", true).put("wifi", lanOnWifi()).put("running", lanHub != null).put("port", lanHub?.port ?: 0).put("peers", peers))
    }

    @PluginMethod
    fun lanStart(call: PluginCall) {
        val nx = call.getString("nexoId")?.lowercase() ?: run { call.reject("nexoId requerido"); return }
        val token = call.getString("token") ?: run { call.reject("token requerido"); return }
        try {
            lanMyId = nx
            val hub = lanHub ?: LanHub({ lanMyId }, object : LanHub.Listener {
                override fun onUp(nx: String) { remLog("INFO", "LAN", "Conectado con $nx por Wi-Fi"); notifyListeners("onLanUp", JSObject().put("nx", nx), true) }
                override fun onDown(nx: String) { remLog("INFO", "LAN", "Sin Wi-Fi con $nx"); notifyListeners("onLanDown", JSObject().put("nx", nx), true) }
                override fun onMessage(nx: String, text: String) { notifyListeners("onLanMessage", JSObject().put("nx", nx).put("content", text), true) }
                override fun onLog(level: String, message: String) { remLog(level, "LAN", message) }
            }).also { lanHub = it }
            val port = hub.start()
            // Escaneo activo: pregunta a toda la red (difusión) y, de vez en cuando o al entrar en una red, una a una
            val beacon = lanBeacon ?: LanBeacon(object : LanBeacon.Listener {
                override fun onPeer(token: String, host: String, port: Int) {
                    notifyListeners("onLanPeer", JSObject().put("token", token).put("host", host).put("port", port).put("src", "scan"))
                }
                override fun onLog(level: String, message: String) { remLog(level, "LAN", message) }
            }).also { lanBeacon = it }
            beacon.start(token, port)
            val now = System.currentTimeMillis()
            val sweep = call.getBoolean("sweep", false) == true || now - lanLastSweep > 300000L
            if (sweep) lanLastSweep = now
            if (lanOnWifi()) beacon.scan(sweep)
            lanWatchWifi()
            val nsd = nsdManager ?: (context.getSystemService(Context.NSD_SERVICE) as android.net.nsd.NsdManager).also { nsdManager = it }
            if (lanMcLock == null) {
                val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                lanMcLock = wm.createMulticastLock("nexo-lan").apply { setReferenceCounted(false); acquire() }
            }
            // Anuncio (se rehace si cambia la marca del día)
            if (nsdReg == null || token != lanToken) {
                nsdReg?.let { try { nsd.unregisterService(it) } catch (e: Exception) {} }
                lanToken = token
                lanServiceName = "NEXO-" + wdRandom(6)
                val info = android.net.nsd.NsdServiceInfo().apply {
                    serviceName = lanServiceName; serviceType = "_nexo._tcp"; setPort(port); setAttribute("t", token)
                }
                val reg = object : android.net.nsd.NsdManager.RegistrationListener {
                    override fun onServiceRegistered(si: android.net.nsd.NsdServiceInfo) { lanServiceName = si.serviceName; remLog("INFO", "LAN", "Anunciado en la red (puerto $port)") }
                    override fun onRegistrationFailed(si: android.net.nsd.NsdServiceInfo, code: Int) { remLog("WARN", "LAN", "No se pudo anunciar ($code)"); if (nsdReg === this) nsdReg = null }
                    override fun onServiceUnregistered(si: android.net.nsd.NsdServiceInfo) {}
                    override fun onUnregistrationFailed(si: android.net.nsd.NsdServiceInfo, code: Int) {}
                }
                nsdReg = reg
                nsd.registerService(info, android.net.nsd.NsdManager.PROTOCOL_DNS_SD, reg)
            }
            // Búsqueda (se reinicia en cada llamada: Android a veces deja de informar)
            nsdDisc?.let { try { nsd.stopServiceDiscovery(it) } catch (e: Exception) {} }
            val disc = object : android.net.nsd.NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(t: String) {}
                override fun onDiscoveryStopped(t: String) {}
                override fun onStartDiscoveryFailed(t: String, code: Int) { remLog("WARN", "LAN", "Búsqueda fallida ($code)"); if (nsdDisc === this) nsdDisc = null }
                override fun onStopDiscoveryFailed(t: String, code: Int) {}
                override fun onServiceFound(si: android.net.nsd.NsdServiceInfo) {
                    if (si.serviceName == lanServiceName) return
                    nsdResolveQueue.add(si); lanResolveNext()
                }
                override fun onServiceLost(si: android.net.nsd.NsdServiceInfo) {}
            }
            nsdDisc = disc
            nsd.discoverServices("_nexo._tcp", android.net.nsd.NsdManager.PROTOCOL_DNS_SD, disc)
            call.resolve(JSObject().put("port", port).put("wifi", lanOnWifi()))
        } catch (e: Exception) {
            call.reject("Wi-Fi no disponible: ${e.message}", "LAN_UNAVAILABLE")
        }
    }

    // Android resuelve de uno en uno
    @Suppress("DEPRECATION")
    private fun lanResolveNext() {
        val nsd = nsdManager ?: return
        if (nsdResolving) return
        val si = nsdResolveQueue.poll() ?: return
        nsdResolving = true
        try {
            nsd.resolveService(si, object : android.net.nsd.NsdManager.ResolveListener {
                override fun onServiceResolved(info: android.net.nsd.NsdServiceInfo) {
                    nsdResolving = false
                    val host = info.host?.hostAddress
                    val t = info.attributes["t"]?.let { String(it, Charsets.UTF_8) }
                    if (host != null && t != null && t != lanToken) {
                        notifyListeners("onLanPeer", JSObject().put("token", t).put("host", host).put("port", info.port).put("src", "mdns"))
                    }
                    lanResolveNext()
                }
                override fun onResolveFailed(info: android.net.nsd.NsdServiceInfo, code: Int) {
                    nsdResolving = false
                    if (code == android.net.nsd.NsdManager.FAILURE_ALREADY_ACTIVE) { nsdResolveQueue.add(info); mainHandler.postDelayed({ lanResolveNext() }, 300) }
                    else lanResolveNext()
                }
            })
        } catch (e: Exception) { nsdResolving = false; lanResolveNext() }
    }

    @PluginMethod
    fun lanConnect(call: PluginCall) {
        val host = call.getString("host") ?: run { call.reject("host requerido"); return }
        val port = call.getInt("port") ?: run { call.reject("port requerido"); return }
        val hub = lanHub ?: run { call.reject("Wi-Fi no iniciado", "LAN_UNAVAILABLE"); return }
        hub.connect(host, port)
        call.resolve(JSObject().put("connecting", true))
    }

    // Fuera del hilo de los plugins (un archivo grande tarda en escribirse) y en orden
    @PluginMethod
    fun lanSend(call: PluginCall) {
        val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
        val content = call.getString("content") ?: run { call.reject("content requerido"); return }
        val hub = lanHub ?: run { call.reject("Wi-Fi no iniciado", "LAN_DOWN"); return }
        lanSendExec.execute {
            if (hub.send(nx, content)) call.resolve(JSObject().put("sent", true))
            else call.reject("Sin conexión Wi-Fi con $nx", "LAN_DOWN")
        }
    }

    @PluginMethod
    fun lanDrop(call: PluginCall) {
        val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
        lanHub?.close(nx)
        call.resolve(JSObject().put("dropped", true))
    }

    @PluginMethod
    fun lanStop(call: PluginCall) {
        lanStopAll()
        call.resolve(JSObject().put("stopped", true))
    }

    // Al conectarse a una red Wi-Fi: escanear ya (una a una) y avisar a la app (vuelve a anunciarse y buscar)
    private fun lanWatchWifi() {
        if (lanNetCb != null) return
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val req = android.net.NetworkRequest.Builder().addTransportType(android.net.NetworkCapabilities.TRANSPORT_WIFI).build()
            val cb = object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) {
                    mainHandler.postDelayed({
                        lanLastSweep = System.currentTimeMillis()
                        lanBeacon?.scan(true)
                        notifyListeners("onLanNet", JSObject().put("wifi", true))
                    }, 1500)
                }
            }
            cm.registerNetworkCallback(req, cb)
            lanNetCb = cb
        } catch (e: Exception) { remLog("WARN", "LAN", "Sin aviso de red Wi-Fi: ${e.message}") }
    }

    private fun lanStopAll() {
        lanNetCb?.let { cb -> try { (context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).unregisterNetworkCallback(cb) } catch (e: Exception) {} }
        lanNetCb = null
        lanBeacon?.stop(); lanBeacon = null
        val nsd = nsdManager
        nsdReg?.let { try { nsd?.unregisterService(it) } catch (e: Exception) {} }
        nsdDisc?.let { try { nsd?.stopServiceDiscovery(it) } catch (e: Exception) {} }
        nsdReg = null; nsdDisc = null
        try { lanMcLock?.release() } catch (e: Exception) {}
        lanMcLock = null
        lanHub?.stop(); lanHub = null
    }

    // ===== Tor (internet sin relés, sin que nadie vea la IP): TorService + servicio oculto + LanHub por SOCKS =====
    // La app (net_link.js) pide torStart con su NEXO ID; aquí se arranca Tor (librería oficial tor-android), se crea
    // el servicio oculto (.onion, clave guardada cifrada en nexo_tor_key.json: la dirección no cambia) que lleva al
    // LanHub de Tor (solo escucha en 127.0.0.1) y se avisa con onTorReady { onion }. torConnect conecta a la .onion
    // de un contacto por el SOCKS de Tor. Lo que viaja ya va cifrado por la app (sobre de pareja + E2E).
    private var torSvc: org.torproject.jni.TorService? = null
    @Volatile private var appInBackground = false
    private var torBind: android.content.ServiceConnection? = null
    private var torHub: LanHub? = null
    @Volatile private var torOnion = ""
    @Volatile private var torStarting = false
    private val torExec = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val torSendExec = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val TOR_PORT = 9878
    private val TOR_KEY_FILE = "nexo_tor_key.json"

    @PluginMethod
    fun torStatus(call: PluginCall) {
        val peers = JSArray()
        torHub?.quality()?.forEach { (nx, rtt, idle) -> peers.put(JSObject().put("nx", nx).put("rtt", rtt).put("idle", idle)) }
        call.resolve(JSObject().put("supported", true).put("running", torSvc != null).put("onion", torOnion).put("port", TOR_PORT)
            .put("starting", torStarting).put("peers", peers))
    }

    @PluginMethod
    fun torStart(call: PluginCall) {
        val nx = call.getString("nexoId")?.lowercase() ?: run { call.reject("nexoId requerido"); return }
        if (torOnion.isNotEmpty() && torHub != null) { call.resolve(JSObject().put("onion", torOnion).put("port", TOR_PORT)); return }
        if (torStarting) { call.resolve(JSObject().put("starting", true)); return }
        torStarting = true
        call.resolve(JSObject().put("starting", true))
        torExec.execute {
            try {
                remLog("INFO", "TOR", "Arrancando Tor…")
                val svc = torBindService() ?: throw Exception("no arranca el servicio de Tor")
                // Esperar a Tor listo (circuito armado) y a su puerto SOCKS
                val t0 = System.currentTimeMillis()
                var ctl = svc.torControlConnection
                while (System.currentTimeMillis() - t0 < 180000L) {
                    ctl = svc.torControlConnection
                    val boot = try { ctl?.getInfo("status/bootstrap-phase") ?: "" } catch (e: Exception) { "" }
                    if (ctl != null && boot.contains("PROGRESS=100") && svc.getSocksPort() > 0) break
                    Thread.sleep(1000)
                }
                if (ctl == null || svc.getSocksPort() <= 0) throw Exception("Tor no terminó de arrancar")
                val proxy = java.net.Proxy(java.net.Proxy.Type.SOCKS, java.net.InetSocketAddress("127.0.0.1", svc.getSocksPort()))
                val hub = torHub ?: LanHub({ nx }, object : LanHub.Listener {
                    override fun onUp(nx: String) { remLog("INFO", "TOR", "Conectado con $nx por Tor"); notifyListeners("onTorUp", JSObject().put("nx", nx), true) }
                    override fun onDown(nx: String) { notifyListeners("onTorDown", JSObject().put("nx", nx), true) }
                    override fun onMessage(nx: String, text: String) { notifyListeners("onTorMessage", JSObject().put("nx", nx).put("content", text), true) }
                    override fun onLog(level: String, message: String) { remLog(level, "TOR", message) }
                }, 15000L, 90000L, proxy, java.net.InetAddress.getByName("127.0.0.1")).also { torHub = it }
                val port = hub.start()
                // Servicio oculto: misma dirección siempre (clave guardada cifrada)
                val saved = try { atRest().read(TOR_KEY_FILE)?.let { org.json.JSONObject(it).optString("k") } } catch (e: Exception) { null }
                val res = ctl.addOnion(if (saved.isNullOrEmpty()) "NEW:ED25519-V3" else saved, mapOf(TOR_PORT to "127.0.0.1:$port"))
                res["PrivateKey"]?.let { atRest().write(TOR_KEY_FILE, org.json.JSONObject().put("k", it).toString()) }
                torOnion = (res["ServiceID"] ?: throw Exception("sin dirección .onion")) + ".onion"
                remLog("INFO", "TOR", "Tor listo en " + (System.currentTimeMillis() - t0) / 1000 + " s")
                notifyListeners("onTorReady", JSObject().put("onion", torOnion).put("port", TOR_PORT), true)
            } catch (e: Exception) {
                remLog("WARN", "TOR", "Tor no disponible: ${e.message}")
                notifyListeners("onTorReady", JSObject().put("error", e.message ?: "error"), true)
            } finally { torStarting = false }
        }
    }

    // Enlazar con TorService (en este proceso) y esperar a tenerlo
    private fun torBindService(): org.torproject.jni.TorService? {
        torSvc?.let { return it }
        val latch = java.util.concurrent.CountDownLatch(1)
        val conn = object : android.content.ServiceConnection {
            override fun onServiceConnected(name: android.content.ComponentName?, binder: android.os.IBinder?) {
                torSvc = (binder as? org.torproject.jni.TorService.LocalBinder)?.service
                latch.countDown()
            }
            override fun onServiceDisconnected(name: android.content.ComponentName?) { torSvc = null; torOnion = "" }
        }
        torBind = conn
        mainHandler.post { context.bindService(Intent(context, org.torproject.jni.TorService::class.java), conn, Context.BIND_AUTO_CREATE) }
        latch.await(60, java.util.concurrent.TimeUnit.SECONDS)
        return torSvc
    }

    @PluginMethod
    fun torConnect(call: PluginCall) {
        val host = call.getString("host") ?: run { call.reject("host requerido"); return }
        val port = call.getInt("port") ?: TOR_PORT
        val hub = torHub ?: run { call.reject("Tor no listo", "TOR_DOWN"); return }
        if (!host.endsWith(".onion")) { call.reject("solo direcciones .onion"); return }
        hub.connect(host, port)
        call.resolve(JSObject().put("connecting", true))
    }

    @PluginMethod
    fun torSend(call: PluginCall) {
        val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
        val content = call.getString("content") ?: run { call.reject("content requerido"); return }
        val hub = torHub ?: run { call.reject("Tor no listo", "TOR_DOWN"); return }
        torSendExec.execute {
            if (hub.send(nx, content)) call.resolve(JSObject().put("sent", true))
            else call.reject("Sin conexión Tor con $nx", "TOR_DOWN")
        }
    }

    @PluginMethod
    fun torDrop(call: PluginCall) {
        val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
        torHub?.close(nx)
        call.resolve(JSObject().put("dropped", true))
    }

    @PluginMethod
    fun torStop(call: PluginCall) {
        torStopAll()
        call.resolve(JSObject().put("stopped", true))
    }

    private fun torStopAll() {
        torHub?.stop(); torHub = null
        torOnion = ""
        torBind?.let { try { context.unbindService(it) } catch (e: Exception) {} }
        torBind = null; torSvc = null
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
