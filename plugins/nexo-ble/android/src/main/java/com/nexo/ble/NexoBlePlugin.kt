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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import java.util.regex.Pattern

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
        private val MAC_PATTERN = Pattern.compile("^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")

        // HEALTH MONITOR: Intervalos de limpieza
        private const val HEALTH_CHECK_INTERVAL_MS = 300000L // 5 minutos
        private const val AUTO_CLEANUP_INTERVAL_MS = 1800000L // 30 minutos
        private const val MAX_SCAN_RESULTS = 50 // Limitar acumulación
        private const val MAX_CONNECTED_DEVICES = 10 // Limitar conexiones
        private const val MEMORY_PRESSURE_THRESHOLD_MB = 150 // Si app usa >150MB, forzar cleanup
    }

    // ─── Thread-safe collections ───
    private val scanResults = CopyOnWriteArrayList<JSObject>()
    private val connectedDevicesMap = ConcurrentHashMap<String, JSObject>()

    // ─── Thread-safe GATT state ───
    private val gattLock = ReentrantLock()
    private var bluetoothGatt: BluetoothGatt? = null
    private var clientTxCharacteristic: BluetoothGattCharacteristic? = null
    private var clientRxCharacteristic: BluetoothGattCharacteristic? = null

    // ─── Receiver state ───
    private val receiverLock = Object()
    private var messageReceiver: BroadcastReceiver? = null
    private val receiverRegistered = AtomicBoolean(false)

    // ─── Scan state ───
    private var bluetoothScanner: BluetoothLeScanner? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scanTimeoutRunnable = Runnable { stopScanInternal() }

    // ─── Reconnect state ───
    private val reconnectCallbacks = mutableMapOf<String, Runnable>()

    // ─── HEALTH MONITOR ───
    private val healthHandler = Handler(Looper.getMainLooper())
    private var healthCheckRunnable: Runnable? = null
    private var autoCleanupRunnable: Runnable? = null
    private var operationCount = 0 // Contador de operaciones para detectar degradación
    private var lastHealthCheck = 0L
    private val isHealthy = AtomicBoolean(true)

    // ==================== REM LOGGING ====================

    private fun remLog(level: String, tag: String, message: String) {
        Log.i("NEXO_REM", "[$level][$tag] $message")
        try {
            notifyListenersSafe("onRemLog", JSObject()
                .put("level", level)
                .put("tag", tag)
                .put("message", message)
                .put("timestamp", System.currentTimeMillis())
            )
        } catch (e: Exception) { }
    }

    private fun notifyListenersSafe(eventName: String, data: JSObject) {
        try {
            notifyListeners(eventName, data)
        } catch (e: Exception) {
            remLog("WARN", "NOTIFY", "notifyListenersSafe($eventName) failed: ${e.message}")
        }
    }

    // ==================== HEALTH MONITOR ====================

    private fun startHealthMonitor() {
        remLog("INFO", "HEALTH", "Iniciando Health Monitor")

        // Health check cada 5 minutos
        healthCheckRunnable = Runnable {
            performHealthCheck()
            healthHandler.postDelayed(healthCheckRunnable!!, HEALTH_CHECK_INTERVAL_MS)
        }
        healthHandler.postDelayed(healthCheckRunnable!!, HEALTH_CHECK_INTERVAL_MS)

        // Auto-cleanup cada 30 minutos
        autoCleanupRunnable = Runnable {
            performAutoCleanup()
            healthHandler.postDelayed(autoCleanupRunnable!!, AUTO_CLEANUP_INTERVAL_MS)
        }
        healthHandler.postDelayed(autoCleanupRunnable!!, AUTO_CLEANUP_INTERVAL_MS)
    }

    private fun stopHealthMonitor() {
        remLog("INFO", "HEALTH", "Deteniendo Health Monitor")
        healthCheckRunnable?.let { healthHandler.removeCallbacks(it) }
        autoCleanupRunnable?.let { healthHandler.removeCallbacks(it) }
        healthCheckRunnable = null
        autoCleanupRunnable = null
    }

    private fun performHealthCheck() {
        try {
            val ctx = activity.applicationContext
            val runtime = Runtime.getRuntime()
            val usedMemoryMB = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
            val maxMemoryMB = runtime.maxMemory() / (1024 * 1024)

            remLog("INFO", "HEALTH", "Memory: ${usedMemoryMB}MB/${maxMemoryMB}MB, Ops: $operationCount, ScanResults: ${scanResults.size}, Connected: ${connectedDevicesMap.size}")

            // Detectar memory pressure
            if (usedMemoryMB > MEMORY_PRESSURE_THRESHOLD_MB) {
                remLog("WARN", "HEALTH", "MEMORY PRESSURE detected: ${usedMemoryMB}MB > ${MEMORY_PRESSURE_THRESHOLD_MB}MB")
                notifyListenersSafe("onRemLog", JSObject()
                    .put("level", "WARN")
                    .put("tag", "HEALTH")
                    .put("message", "Memory pressure: ${usedMemoryMB}MB")
                    .put("timestamp", System.currentTimeMillis())
                )
            }

            // Detectar degradación por operaciones acumuladas
            if (operationCount > 1000) {
                remLog("WARN", "HEALTH", "High operation count: $operationCount, suggesting cleanup")
            }

            lastHealthCheck = System.currentTimeMillis()
            isHealthy.set(true)

        } catch (e: Exception) {
            remLog("ERROR", "HEALTH", "Health check failed: ${e.message}")
        }
    }

    private fun performAutoCleanup() {
        try {
            remLog("INFO", "HEALTH", "Auto-cleanup iniciado")

            // 1. Limpiar scan results antiguos (mantener solo los 20 más recientes)
            if (scanResults.size > MAX_SCAN_RESULTS) {
                val toRemove = scanResults.size - MAX_SCAN_RESULTS
                for (i in 0 until toRemove) {
                    if (scanResults.isNotEmpty()) scanResults.removeAt(0)
                }
                remLog("INFO", "HEALTH", "Cleaned $toRemove old scan results")
            }

            // 2. Limpiar dispositivos conectados "zombie" (sin actividad >10min)
            val now = System.currentTimeMillis()
            val zombieDevices = connectedDevicesMap.filter { entry ->
                val lastActivity = entry.value.optLong("lastActivity", 0)
                lastActivity > 0 && (now - lastActivity) > 600000
            }.keys

            zombieDevices.forEach { addr ->
                connectedDevicesMap.remove(addr)
                remLog("INFO", "HEALTH", "Removed zombie device: $addr")
            }

            // 3. Reset contador de operaciones
            operationCount = 0

            // 4. Forzar garbage collection suave
            System.gc()

            remLog("INFO", "HEALTH", "Auto-cleanup completado. ScanResults: ${scanResults.size}, Connected: ${connectedDevicesMap.size}")

        } catch (e: Exception) {
            remLog("ERROR", "HEALTH", "Auto-cleanup failed: ${e.message}")
        }
    }

    @PluginMethod
    fun getHealthStatus(call: PluginCall) {
        try {
            val runtime = Runtime.getRuntime()
            val usedMemoryMB = (runtime.totalMemory() - runtime.freeMemory()) / (1024 * 1024)
            val maxMemoryMB = runtime.maxMemory() / (1024 * 1024)

            val result = JSObject()
                .put("isHealthy", isHealthy.get())
                .put("usedMemoryMB", usedMemoryMB)
                .put("maxMemoryMB", maxMemoryMB)
                .put("scanResultsCount", scanResults.size)
                .put("connectedDevicesCount", connectedDevicesMap.size)
                .put("operationCount", operationCount)
                .put("lastHealthCheck", lastHealthCheck)
                .put("receiverRegistered", receiverRegistered.get())
                .put("gattConnected", bluetoothGatt != null)

            call.resolve(result)
        } catch (e: Exception) {
            call.reject("HEALTH_STATUS_EXCEPTION", e.message)
        }
    }

    @PluginMethod
    fun forceCleanup(call: PluginCall) {
        try {
            remLog("INFO", "HEALTH", "Force cleanup solicitado desde JS")
            performAutoCleanup()

            // Forzar cierre de GATT si está stale
            gattLock.lock()
            try {
                bluetoothGatt?.let { gatt ->
                    try {
                        gatt.disconnect()
                        gatt.close()
                    } catch (e: Exception) { }
                }
                bluetoothGatt = null
                clientTxCharacteristic = null
                clientRxCharacteristic = null
            } finally {
                gattLock.unlock()
            }

            // Limpiar todos los reconnects
            reconnectCallbacks.values.forEach { mainHandler.removeCallbacks(it) }
            reconnectCallbacks.clear()

            // Forzar GC
            System.gc()

            call.resolve(JSObject().put("cleaned", true))
        } catch (e: Exception) {
            call.reject("FORCE_CLEANUP_EXCEPTION", e.message)
        }
    }

    // ==================== LIFECYCLE ====================

    override fun load() {
        super.load()
        startHealthMonitor()
    }

    override fun handleOnResume() {
        super.handleOnResume()
        remLog("INFO", "LIFECYCLE", "handleOnResume - verificando permisos post-Settings")
        val ctx = activity.applicationContext
        val granted = checkCoreBLEPermissions(ctx)
        remLog("INFO", "PERMISSIONS", "Post-Settings check: granted=$granted")

        if (granted) {
            notifyListenersSafe("onPermissionStatusChanged", JSObject()
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

        stopHealthMonitor()

        reconnectCallbacks.values.forEach { mainHandler.removeCallbacks(it) }
        reconnectCallbacks.clear()

        try { stopScanInternal() } catch (e: Exception) { remLog("WARN", "LIFECYCLE", "Error stopping scan: ${e.message}") }

        gattLock.lock()
        try {
            bluetoothGatt?.disconnect()
            bluetoothGatt?.close()
            bluetoothGatt = null
            clientTxCharacteristic = null
            clientRxCharacteristic = null
        } catch (e: Exception) { remLog("WARN", "LIFECYCLE", "Error closing GATT: ${e.message}") } finally {
            gattLock.unlock()
        }

        try { unregisterServerReceivers() } catch (e: Exception) { remLog("WARN", "LIFECYCLE", "Error unregistering: ${e.message}") }
    }

    // ==================== PERMISSIONS ====================

    @PluginMethod
    fun checkBLEStatus(call: PluginCall) {
        operationCount++
        try {
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
        } catch (e: Exception) {
            remLog("ERROR", "PERMISSIONS", "checkBLEStatus crash: ${e.message}")
            call.reject("CHECK_EXCEPTION", e.message)
        }
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        operationCount++
        try {
            remLog("INFO", "PERMISSIONS", "initializeBLE invoked")
            val ctx = activity.applicationContext
            val alreadyGranted = checkCoreBLEPermissions(ctx)

            if (alreadyGranted) {
                remLog("INFO", "PERMISSIONS", "Permisos ya concedidos.")
                notifyListenersSafe("onServerReady", JSObject().put("ready", true).put("source", "permissions_already_granted"))
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
        } catch (e: Exception) {
            remLog("ERROR", "PERMISSIONS", "initializeBLE crash: ${e.message}")
            call.reject("INIT_EXCEPTION", e.message)
        }
    }

    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        initializeBLE(call)
    }

    @PermissionCallback
    fun permissionsCallback(call: PluginCall) {
        operationCount++
        try {
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
                notifyListenersSafe("onServerReady", JSObject().put("ready", true).put("source", "permissions_callback"))
            }

            call.resolve(JSObject().put("dialogResponded", true).put("granted", granted).put("isPermanentlyDenied", isPermanent))
        } catch (e: Exception) {
            remLog("ERROR", "PERMISSIONS", "permissionsCallback crash: ${e.message}")
            call.reject("CALLBACK_EXCEPTION", e.message)
        }
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
        operationCount++
        try {
            remLog("INFO", "ADVERTISING", "startAdvertising invoked")
            val context = activity.applicationContext
            val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter

            if (adapter == null || !adapter.isEnabled) {
                remLog("ERROR", "ADVERTISING", "Bluetooth desactivado")
                notifyListenersSafe("onAdvertiseFailed", JSObject().put("error", "Bluetooth desactivado"))
                call.reject("Bluetooth desactivado")
                return
            }

            if (!checkCoreBLEPermissions(context)) {
                remLog("ERROR", "ADVERTISING", "Permisos no concedidos")
                notifyListenersSafe("onAdvertiseFailed", JSObject().put("error", "Permisos BLE no concedidos"))
                call.reject("Permisos BLE no concedidos")
                return
            }

            val intent = Intent(context, BleService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            registerServerReceivers()
            remLog("INFO", "ADVERTISING", "Service started OK")
            notifyListenersSafe("onAdvertiseStarted", JSObject().put("started", true))
            call.resolve(JSObject().put("started", true))
        } catch (e: Exception) {
            remLog("ERROR", "ADVERTISING", "Crash iniciando Service: ${e.message}")
            notifyListenersSafe("onAdvertiseFailed", JSObject().put("error", e.message))
            call.reject("Error iniciando advertising: ${e.message}")
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        operationCount++
        try {
            remLog("INFO", "ADVERTISING", "stopAdvertising invoked")
            val context = activity.applicationContext
            try {
                context.stopService(Intent(context, BleService::class.java))
            } catch (e: Exception) {
                remLog("WARN", "ADVERTISING", "stopService warning: ${e.message}")
            }
            unregisterServerReceivers()
            call.resolve(JSObject().put("stopped", true))
        } catch (e: Exception) {
            remLog("ERROR", "ADVERTISING", "Error stopping: ${e.message}")
            call.reject("Error deteniendo advertising: ${e.message}")
        }
    }

    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        try {
            val ctx = activity.applicationContext
            val running = isServiceRunning(ctx, BleService::class.java)
            call.resolve(JSObject().put("isAdvertising", running))
        } catch (e: Exception) {
            call.reject("IS_ADVERTISING_EXCEPTION", e.message)
        }
    }

    // ==================== BLUETOOTH STATE ====================

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        operationCount++
        try {
            remLog("INFO", "STATE", "isBluetoothEnabled invoked")
            val context = activity.applicationContext
            val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            val enabled = adapter != null && adapter.isEnabled
            val canAdvertise = enabled && (adapter?.bluetoothLeAdvertiser != null)
            val permsOk = checkCoreBLEPermissions(context)
            val serverRunning = isServiceRunning(context, BleService::class.java)
            remLog("INFO", "STATE", "enabled=$enabled, canAdvertise=$canAdvertise, permsOk=$permsOk, serverRunning=$serverRunning")
            call.resolve(JSObject()
                .put("enabled", enabled)
                .put("canAdvertise", canAdvertise && permsOk)
                .put("serverReady", serverRunning)
            )
        } catch (e: Exception) {
            call.reject("STATE_EXCEPTION", e.message)
        }
    }

    @PluginMethod
    fun getLocalDeviceInfo(call: PluginCall) {
        try {
            val context = activity.applicationContext
            val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            val name = adapter?.name ?: "NEXO Device"
            val address = try { adapter?.address ?: "" } catch (e: SecurityException) { "" }
            call.resolve(JSObject().put("deviceName", name).put("deviceAddress", address))
        } catch (e: Exception) {
            call.reject("DEVICE_INFO_EXCEPTION", e.message)
        }
    }

    // ==================== MESSAGING ====================

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        operationCount++
        try {
            val deviceId = call.getString("deviceId") ?: ""
            val message = call.getString("message") ?: ""
            remLog("INFO", "MESSAGE", "sendMessage to=$deviceId len=${message.length}")

            if (message.isEmpty()) {
                call.reject("PAYLOAD_EMPTY", "El mensaje no puede estar vacío")
                return
            }

            gattLock.lock()
            try {
                val gatt = bluetoothGatt
                val rxChar = clientRxCharacteristic

                if (deviceId.isNotEmpty() && gatt != null && rxChar != null) {
                    val isConnected = try {
                        gatt.device != null
                    } catch (e: Exception) { false }

                    if (!isConnected) {
                        remLog("WARN", "MESSAGE", "GATT no conectado, fallback a broadcast")
                    } else {
                        val data = message.toByteArray(Charset.defaultCharset())
                        val success = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            gatt.writeCharacteristic(
                                rxChar,
                                data,
                                BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                            ) == BluetoothGatt.GATT_SUCCESS
                        } else {
                            @Suppress("DEPRECATION")
                            rxChar.value = data
                            @Suppress("DEPRECATION")
                            gatt.writeCharacteristic(rxChar) ?: false
                        }
                        remLog("INFO", "MESSAGE", "Client write success=$success")
                        call.resolve(JSObject().put("sent", success).put("mode", "client"))
                        return
                    }
                }
            } finally {
                gattLock.unlock()
            }

            val context = activity.applicationContext
            val intent = Intent(NexoBleSpec.ACTION_BLE_SEND_MESSAGE).apply {
                putExtra(NexoBleSpec.EXTRA_MESSAGE_DATA, message)
                setPackage(context.packageName)
            }
            context.sendBroadcast(intent)
            remLog("INFO", "MESSAGE", "Broadcasted to server mode")
            call.resolve(JSObject().put("sent", true).put("mode", "server"))
        } catch (e: Exception) {
            remLog("ERROR", "MESSAGE", "sendMessage crash: ${e.message}")
            call.reject("SEND_EXCEPTION", e.message)
        }
    }

    // ==================== SCANNING ====================

    @PluginMethod
    fun startScan(call: PluginCall) {
        operationCount++
        try {
            remLog("INFO", "SCAN", "startScan invoked")
            val context = activity.applicationContext
            val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter

            if (adapter == null || !adapter.isEnabled) {
                remLog("ERROR", "SCAN", "Bluetooth desactivado")
                notifyListenersSafe("onScanFailed", JSObject().put("error", "Bluetooth desactivado"))
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
                notifyListenersSafe("onScanFailed", JSObject().put("error", e.message))
                call.reject("Permiso BLUETOOTH_SCAN no concedido: ${e.message}")
            }
        } catch (e: Exception) {
            remLog("ERROR", "SCAN", "startScan crash: ${e.message}")
            call.reject("SCAN_EXCEPTION", e.message)
        }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        operationCount++
        try {
            remLog("INFO", "SCAN", "stopScan invoked")
            stopScanInternal()
            call.resolve(JSObject().put("stopped", true))
        } catch (e: Exception) {
            call.reject("STOP_SCAN_EXCEPTION", e.message)
        }
    }

    // ==================== CONNECTION ====================

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        operationCount++
        try {
            val deviceId = call.getString("deviceId") ?: call.getString("address") ?: ""
            remLog("INFO", "CONNECT", "connectToDevice deviceId=$deviceId")

            if (deviceId.isEmpty()) {
                call.reject("deviceId requerido")
                return
            }

            if (!MAC_PATTERN.matcher(deviceId).matches()) {
                remLog("ERROR", "CONNECT", "deviceId no es MAC válida: $deviceId")
                call.reject("INVALID_MAC", "La dirección no es una MAC válida: $deviceId")
                return
            }

            val context = activity.applicationContext
            val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager

            val device = try {
                bluetoothManager.adapter.getRemoteDevice(deviceId)
            } catch (e: IllegalArgumentException) {
                remLog("ERROR", "CONNECT", "MAC inválida: ${e.message}")
                call.reject("INVALID_MAC", "Dirección MAC inválida: ${e.message}")
                return
            }

            gattLock.lock()
            try {
                bluetoothGatt?.close()
                bluetoothGatt = null
                clientTxCharacteristic = null
                clientRxCharacteristic = null
            } finally {
                gattLock.unlock()
            }

            val newGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
            } else {
                device.connectGatt(context, false, gattClientCallback)
            }

            gattLock.lock()
            try {
                bluetoothGatt = newGatt
            } finally {
                gattLock.unlock()
            }

            notifyListenersSafe("onDeviceConnected", JSObject()
                .put("deviceId", deviceId)
                .put("direction", "outgoing")
                .put("attempt", 0)
                .put("servicesReady", false)
            )
            call.resolve(JSObject().put("connecting", true).put("connected", false).put("alreadyConnected", false).put("deviceId", deviceId))
        } catch (e: Exception) {
            remLog("ERROR", "CONNECT", "connectToDevice crash: ${e.message}")
            call.reject("CONNECT_EXCEPTION", e.message)
        }
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        operationCount++
        try {
            val deviceId = call.getString("deviceId") ?: ""
            remLog("INFO", "CONNECT", "disconnectDevice deviceId=$deviceId")

            reconnectCallbacks[deviceId]?.let { mainHandler.removeCallbacks(it) }
            reconnectCallbacks.remove(deviceId)

            gattLock.lock()
            try {
                bluetoothGatt?.disconnect()
                bluetoothGatt?.close()
                bluetoothGatt = null
                clientTxCharacteristic = null
                clientRxCharacteristic = null
            } finally {
                gattLock.unlock()
            }

            connectedDevicesMap.remove(deviceId)
            notifyListenersSafe("onDeviceDisconnected", JSObject().put("deviceId", deviceId))
            call.resolve(JSObject().put("disconnected", true).put("deviceId", deviceId))
        } catch (e: Exception) {
            call.reject("DISCONNECT_EXCEPTION", e.message)
        }
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        try {
            val devices = JSArray()
            connectedDevicesMap.values.forEach { devices.put(it) }
            call.resolve(JSObject().put("devices", devices))
        } catch (e: Exception) {
            call.reject("GET_DEVICES_EXCEPTION", e.message)
        }
    }

    @PluginMethod
    fun forceReconnect(call: PluginCall) {
        operationCount++
        try {
            val deviceId = call.getString("deviceId") ?: ""
            remLog("INFO", "CONNECT", "forceReconnect deviceId=$deviceId")
            if (deviceId.isEmpty()) {
                call.reject("deviceId requerido")
                return
            }

            if (!MAC_PATTERN.matcher(deviceId).matches()) {
                call.reject("INVALID_MAC", "Dirección MAC inválida")
                return
            }

            gattLock.lock()
            try {
                bluetoothGatt?.disconnect()
                bluetoothGatt?.close()
                bluetoothGatt = null
                clientTxCharacteristic = null
                clientRxCharacteristic = null
            } finally {
                gattLock.unlock()
            }

            reconnectCallbacks[deviceId]?.let { mainHandler.removeCallbacks(it) }

            val reconnectRunnable = Runnable {
                val context = activity.applicationContext
                val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
                val device = try {
                    bluetoothManager.adapter.getRemoteDevice(deviceId)
                } catch (e: Exception) {
                    remLog("ERROR", "CONNECT", "forceReconnect MAC inválida: ${e.message}")
                    return@Runnable
                }

                val newGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
                } else {
                    device.connectGatt(context, false, gattClientCallback)
                }

                gattLock.lock()
                try {
                    bluetoothGatt = newGatt
                } finally {
                    gattLock.unlock()
                }

                notifyListenersSafe("onDeviceConnected", JSObject()
                    .put("deviceId", deviceId)
                    .put("direction", "outgoing")
                    .put("attempt", 1)
                    .put("servicesReady", false)
                )
            }

            reconnectCallbacks[deviceId] = reconnectRunnable
            mainHandler.postDelayed(reconnectRunnable, 500)

            call.resolve(JSObject().put("reconnecting", true).put("deviceId", deviceId))
        } catch (e: Exception) {
            call.reject("RECONNECT_EXCEPTION", e.message)
        }
    }

    // ==================== CALLBACKS ====================

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.device?.let { device ->
                try {
                    val name = try { device.name } catch (e: SecurityException) { null } ?: "Unknown"
                    val addr = device.address
                    if (scanResults.none { it.getString("deviceId") == addr }) {
                        // HEALTH: Limitar acumulación
                        if (scanResults.size >= MAX_SCAN_RESULTS) {
                            scanResults.removeAt(0)
                        }
                        val item = JSObject().apply {
                            put("deviceId", addr)
                            put("name", name)
                            put("rssi", result.rssi)
                        }
                        scanResults.add(item)
                        remLog("INFO", "SCAN", "Device found: $name ($addr)")
                        notifyListenersSafe("onDeviceFound", item)
                    }
                } catch (e: Exception) {
                    remLog("WARN", "SCAN", "Error en onScanResult: ${e.message}")
                }
            }
        }

        override fun onScanFailed(errorCode: Int) {
            remLog("ERROR", "SCAN", "Scan failed: errorCode=$errorCode")
            notifyListenersSafe("onScanFailed", JSObject().put("errorCode", errorCode))
        }
    }

    private fun stopScanInternal() {
        mainHandler.removeCallbacks(scanTimeoutRunnable)
        try { bluetoothScanner?.stopScan(scanCallback) } catch (e: Exception) { remLog("WARN", "SCAN", "Error stopping scan: ${e.message}") }
        bluetoothScanner = null
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            try {
                val address = gatt.device?.address ?: ""
                remLog("INFO", "GATT", "onConnectionStateChange $address status=$status newState=$newState")

                if (status != BluetoothGatt.GATT_SUCCESS && newState != BluetoothProfile.STATE_DISCONNECTED) {
                    remLog("WARN", "GATT", "Connection error status=$status, disconnecting")
                    try { gatt.disconnect() } catch (e: Exception) { }
                    return
                }

                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    connectedDevicesMap[address] = JSObject()
                        .put("id", address).put("address", address)
                        .put("name", gatt.device?.name ?: "NEXO Peer")
                        .put("direction", "outgoing")
                        .put("lastActivity", System.currentTimeMillis())
                    notifyListenersSafe("onDeviceConnected", JSObject()
                        .put("deviceId", address)
                        .put("direction", "outgoing")
                        .put("attempt", 0)
                        .put("servicesReady", false)
                    )
                    gatt.discoverServices()
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    connectedDevicesMap.remove(address)
                    notifyListenersSafe("onDeviceDisconnected", JSObject().put("deviceId", address))

                    gattLock.lock()
                    try {
                        if (bluetoothGatt == gatt) {
                            bluetoothGatt?.close()
                            bluetoothGatt = null
                            clientTxCharacteristic = null
                            clientRxCharacteristic = null
                        }
                    } finally {
                        gattLock.unlock()
                    }
                }
            } catch (e: Exception) {
                remLog("ERROR", "GATT", "onConnectionStateChange crash: ${e.message}")
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            try {
                val address = gatt.device?.address ?: ""
                remLog("INFO", "GATT", "onServicesDiscovered $address status=$status")
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    notifyListenersSafe("onConnectionFailed", JSObject()
                        .put("deviceId", address)
                        .put("reason", "Service discovery failed")
                        .put("recoverable", true)
                        .put("attempt", 0)
                        .put("maxAttempts", 3)
                    )
                    return
                }
                val service = gatt.getService(NexoBleSpec.NEXO_SERVICE_UUID) ?: run {
                    notifyListenersSafe("onConnectionFailed", JSObject()
                        .put("deviceId", address)
                        .put("reason", "NEXO service not found")
                        .put("recoverable", false)
                    )
                    return
                }

                gattLock.lock()
                try {
                    clientTxCharacteristic = service.getCharacteristic(NexoBleSpec.TX_CHARACTERISTIC_UUID)
                    clientRxCharacteristic = service.getCharacteristic(NexoBleSpec.RX_CHARACTERISTIC_UUID)
                } finally {
                    gattLock.unlock()
                }

                clientTxCharacteristic?.let { characteristic ->
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
                }
                notifyListenersSafe("onServicesReady", JSObject().put("deviceId", address).put("servicesReady", true))
            } catch (e: Exception) {
                remLog("ERROR", "GATT", "onServicesDiscovered crash: ${e.message}")
            }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            try {
                val address = gatt.device?.address ?: ""
                remLog("INFO", "GATT", "onDescriptorWrite $address uuid=${descriptor.uuid} status=$status")
                if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                    notifyListenersSafe("onNotificationsEnabled", JSObject()
                        .put("deviceId", address)
                        .put("notificationsEnabled", true)
                    )
                }
            } catch (e: Exception) {
                remLog("ERROR", "GATT", "onDescriptorWrite crash: ${e.message}")
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            try {
                if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                    val message = characteristic.value?.toString(Charset.defaultCharset()) ?: ""
                    val address = gatt.device?.address ?: ""
                    remLog("INFO", "GATT", "Received (legacy) from $address: $message")
                    notifyListenersSafe("onPayloadReceived", JSObject()
                        .put("deviceId", address)
                        .put("content", message)
                        .put("data", message)
                        .put("senderName", null)
                        .put("source", "ble")
                        .put("timestamp", System.currentTimeMillis())
                    )
                }
            } catch (e: Exception) {
                remLog("ERROR", "GATT", "onCharacteristicChanged legacy crash: ${e.message}")
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            try {
                if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                    val message = value.toString(Charset.defaultCharset())
                    val address = gatt.device?.address ?: ""
                    remLog("INFO", "GATT", "Received (API33+) from $address: $message")
                    notifyListenersSafe("onPayloadReceived", JSObject()
                        .put("deviceId", address)
                        .put("content", message)
                        .put("data", message)
                        .put("senderName", null)
                        .put("source", "ble")
                        .put("timestamp", System.currentTimeMillis())
                    )
                }
            } catch (e: Exception) {
                remLog("ERROR", "GATT", "onCharacteristicChanged API33+ crash: ${e.message}")
            }
        }
    }

    // ==================== RECEIVERS ====================

    private fun registerServerReceivers() {
        synchronized(receiverLock) {
            if (receiverRegistered.get()) {
                remLog("WARN", "RECEIVER", "Receiver ya registrado, omitiendo")
                return
            }
            messageReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    try {
                        when (intent.action) {
                            NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED -> {
                                val msg = intent.getStringExtra(NexoBleSpec.EXTRA_MESSAGE_DATA) ?: ""
                                val device = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                                remLog("INFO", "RECEIVER", "MSG from $device: $msg")
                                notifyListenersSafe("onPayloadReceived", JSObject()
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
                                    .put("lastActivity", System.currentTimeMillis())
                                notifyListenersSafe("onDeviceConnected", JSObject()
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
                                notifyListenersSafe("onDeviceDisconnected", JSObject().put("deviceId", addr))
                            }
                        }
                    } catch (e: Exception) {
                        remLog("ERROR", "RECEIVER", "onReceive crash: ${e.message}")
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
                receiverRegistered.set(true)
                remLog("INFO", "RECEIVER", "Receiver registrado OK")
            } catch (e: Exception) {
                remLog("ERROR", "RECEIVER", "Error registrando receiver: ${e.message}")
                receiverRegistered.set(false)
            }
        }
    }

    private fun unregisterServerReceivers() {
        synchronized(receiverLock) {
            if (!receiverRegistered.get() || messageReceiver == null) {
                return
            }
            try {
                activity.unregisterReceiver(messageReceiver)
                remLog("INFO", "RECEIVER", "Receiver desregistrado OK")
            } catch (e: IllegalArgumentException) {
                remLog("WARN", "RECEIVER", "Receiver ya estaba desregistrado")
            } catch (e: Exception) {
                remLog("ERROR", "RECEIVER", "Error desregistrando: ${e.message}")
            } finally {
                receiverRegistered.set(false)
                messageReceiver = null
            }
        }
    }

    // ==================== ALIAS PARA COMPATIBILIDAD v6.1 ====================

    @PluginMethod
    fun startBLEAdvertising(call: PluginCall) = startAdvertising(call)

    @PluginMethod
    fun stopBLEAdvertising(call: PluginCall) = stopAdvertising(call)

    @PluginMethod
    fun scanForDevices(call: PluginCall) = startScan(call)

    @PluginMethod
    fun startListeningMessages(call: PluginCall) {
        try {
            registerServerReceivers()
            call.resolve(JSObject().put("listening", true))
        } catch (e: Exception) {
            call.reject("LISTEN_EXCEPTION", e.message)
        }
    }
}
