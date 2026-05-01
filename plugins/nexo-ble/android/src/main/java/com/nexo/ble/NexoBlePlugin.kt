// ============================================================
// NexoBlePlugin.kt v4 — SCAN DIAGNÓSTICO + anti-throttle
// plugins/nexo-ble/android/.../NexoBlePlugin.kt
// FIX: Guardia anti-throttling, REMs quirúrgicos solo en scan.
//      No se modifica advertising, GATT, permisos, ni mensajes.
// ============================================================
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
import java.util.UUID

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
        private const val SCAN_TIMEOUT_MS = 15000L
        private const val BLE_SERVICE_CLASS = "com.nexo.ble.BleService"

        private val NEXO_SERVICE_UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
        private val TX_CHARACTERISTIC_UUID = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")
        private val RX_CHARACTERISTIC_UUID = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")
        private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val ACTION_BLE_SEND_MESSAGE = "com.nexo.ble.ACTION_BLE_SEND_MESSAGE"
        private const val ACTION_BLE_MESSAGE_RECEIVED = "com.nexo.ble.ACTION_BLE_MESSAGE_RECEIVED"
        private const val ACTION_BLE_DEVICE_CONNECTED = "com.nexo.ble.ACTION_BLE_DEVICE_CONNECTED"
        private const val ACTION_BLE_DEVICE_DISCONNECTED = "com.nexo.ble.ACTION_BLE_DEVICE_DISCONNECTED"
        private const val EXTRA_MESSAGE_DATA = "message_data"
        private const val EXTRA_DEVICE_ADDRESS = "device_address"
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
    private var isScanning = false // Guardia anti-throttle

    private fun getBleServiceClass(): Class<*> = Class.forName(BLE_SERVICE_CLASS)

    private fun remLog(level: String, tag: String, message: String) {
        Log.i("NEXO_REM", "[$level][$tag] $message")
        try {
            notifyListeners("onRemLog", JSObject()
                .put("level", level).put("tag", tag)
                .put("message", message)
                .put("timestamp", System.currentTimeMillis())
            )
        } catch (e: Exception) { }
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        try { unregisterServerReceivers() } catch (e: Exception) { }
        try { stopScanInternal() } catch (e: Exception) { }
        try {
            bluetoothGatt?.disconnect()
            bluetoothGatt?.close()
        } catch (e: Exception) { }
    }

    @PluginMethod
    fun checkBLEStatus(call: PluginCall) {
        val ctx = activity.applicationContext
        val prefs = ctx.getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE)
        val result = JSObject()

        val scanGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN)
        val connectGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT)
        val advertiseGranted = isGranted(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE)
        val locationGranted = isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
        val foregroundConnectedGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            isGranted(ctx, android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE)
        } else true

        val allGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            scanGranted && connectGranted && advertiseGranted && foregroundConnectedGranted
        } else {
            locationGranted
        }

        val wasEverAsked = prefs.getBoolean("ble_permissions_asked", false)
        val isPermanentlyDenied = if (!allGranted && wasEverAsked) {
            val key = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                android.Manifest.permission.BLUETOOTH_SCAN
            else
                android.Manifest.permission.ACCESS_FINE_LOCATION
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, key)
        } else false

        result.put("scanGranted", scanGranted)
        result.put("connectGranted", connectGranted)
        result.put("advertiseGranted", advertiseGranted)
        result.put("locationGranted", locationGranted)
        result.put("foregroundConnectedGranted", foregroundConnectedGranted)
        result.put("allGranted", allGranted)
        result.put("isPermanentlyDenied", isPermanentlyDenied)
        result.put("wasEverAsked", wasEverAsked)

        remLog("INFO", "PERMISSIONS", "allGranted=$allGranted permanent=$isPermanentlyDenied")
        call.resolve(result)
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        val ctx = activity.applicationContext
        val alreadyGranted = checkCoreBLEPermissions(ctx)

        if (alreadyGranted) {
            notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "already_granted"))
            call.resolve(JSObject().put("granted", true).put("isPermanentlyDenied", false))
            return
        }

        ctx.getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE)
            .edit().putBoolean("ble_permissions_asked", true).apply()

        val aliases = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            arrayOf("bluetoothScan", "bluetoothConnect", "bluetoothAdvertise", "postNotifications", "foregroundServiceConnectedDevice")
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf("bluetoothScan", "bluetoothConnect", "bluetoothAdvertise", "postNotifications")
        } else {
            arrayOf("location", "postNotifications")
        }
        requestPermissionForAliases(aliases, call, "permissionsCallback")
    }

    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) = initializeBLE(call)

    @PermissionCallback
    fun permissionsCallback(call: PluginCall) {
        val ctx = activity.applicationContext
        val granted = checkCoreBLEPermissions(ctx)
        val isPermanent = if (!granted) {
            val key = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                android.Manifest.permission.BLUETOOTH_SCAN
            else
                android.Manifest.permission.ACCESS_FINE_LOCATION
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, key)
        } else false

        remLog("INFO", "PERMISSIONS", "callback: granted=$granted permanent=$isPermanent")
        if (granted) {
            notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "callback"))
        }
        call.resolve(JSObject().put("dialogResponded", true).put("granted", granted).put("isPermanentlyDenied", isPermanent))
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
        } else {
            isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    private fun isServiceRunning(ctx: Context, serviceClassName: String): Boolean {
        val manager = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return manager.getRunningServices(Integer.MAX_VALUE).any { it.service.className == serviceClassName }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val context = activity.applicationContext
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter

        if (adapter == null || !adapter.isEnabled) {
            remLog("ERROR", "ADVERTISING", "Bluetooth desactivado")
            call.reject("Bluetooth desactivado")
            return
        }
        if (!checkCoreBLEPermissions(context)) {
            remLog("ERROR", "ADVERTISING", "Permisos faltantes")
            call.reject("Permisos BLE no concedidos")
            return
        }

        try {
            val intent = Intent(context, getBleServiceClass())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            registerServerReceivers()
            remLog("INFO", "ADVERTISING", "Service iniciado OK")
            notifyListeners("onAdvertiseStarted", JSObject().put("started", true))
            call.resolve(JSObject().put("started", true))
        } catch (e: Exception) {
            remLog("ERROR", "ADVERTISING", "Crash: ${e.message}")
            call.reject("Error iniciando advertising: ${e.message}")
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        val context = activity.applicationContext
        try {
            context.stopService(Intent(context, getBleServiceClass()))
            unregisterServerReceivers()
            call.resolve(JSObject().put("stopped", true))
        } catch (e: Exception) {
            call.reject("Error deteniendo: ${e.message}")
        }
    }

    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val ctx = activity.applicationContext
        val running = isServiceRunning(ctx, BLE_SERVICE_CLASS)
        remLog("INFO", "STATE", "isAdvertising=$running")
        call.resolve(JSObject().put("isAdvertising", running))
    }

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        val context = activity.applicationContext
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        val enabled = adapter != null && adapter.isEnabled
        val permsOk = checkCoreBLEPermissions(context)
        call.resolve(JSObject()
            .put("enabled", enabled)
            .put("canAdvertise", enabled && (adapter?.bluetoothLeAdvertiser != null) && permsOk)
            .put("serverReady", isServiceRunning(context, BLE_SERVICE_CLASS))
        )
    }

    @PluginMethod
    fun getLocalDeviceInfo(call: PluginCall) {
        val adapter = (activity.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        val name = adapter?.name ?: "NEXO Device"
        val address = try { adapter?.address ?: "" } catch (e: SecurityException) { "" }
        call.resolve(JSObject().put("deviceName", name).put("deviceAddress", address))
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: ""
        val message = call.getString("message") ?: ""

        if (deviceId.isNotEmpty() && bluetoothGatt != null && clientRxCharacteristic != null) {
            val data = message.toByteArray(Charset.defaultCharset())
            val success = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                bluetoothGatt?.writeCharacteristic(
                    clientRxCharacteristic!!, data,
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                ) == BluetoothGatt.GATT_SUCCESS
            } else {
                @Suppress("DEPRECATION")
                clientRxCharacteristic?.value = data
                @Suppress("DEPRECATION")
                bluetoothGatt?.writeCharacteristic(clientRxCharacteristic) ?: false
            }
            remLog("INFO", "MESSAGE", "Client write to $deviceId: success=$success")
            call.resolve(JSObject().put("sent", success).put("mode", "client"))
            return
        }

        val intent = Intent(ACTION_BLE_SEND_MESSAGE).apply {
            putExtra(EXTRA_MESSAGE_DATA, message)
            setPackage(activity.applicationContext.packageName)
        }
        activity.applicationContext.sendBroadcast(intent)
        remLog("INFO", "MESSAGE", "Broadcasted to server")
        call.resolve(JSObject().put("sent", true).put("mode", "server"))
    }

    // ============================================================
    // SCAN v4: DIAGNÓSTICO COMPLETO + anti-throttle + sin filter
    // ============================================================
    @PluginMethod
    fun startScan(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter

        // --- REMs de diagnóstico previo ---
        remLog("DEBUG", "SCAN_DIAG", "=== startScan iniciado ===")
        remLog("DEBUG", "SCAN_DIAG", "adapter null=${adapter == null}, enabled=${adapter?.isEnabled ?: false}")
        remLog("DEBUG", "SCAN_DIAG", "bluetoothScanner null=${bluetoothManager.adapter?.bluetoothLeScanner == null}")
        remLog("DEBUG", "SCAN_DIAG", "BLUETOOTH_SCAN granted=${isGranted(context, android.Manifest.permission.BLUETOOTH_SCAN)}")
        remLog("DEBUG", "SCAN_DIAG", "isScanning flag=$isScanning")

        if (adapter == null || !adapter.isEnabled) {
            remLog("ERROR", "SCAN", "Bluetooth desactivado o adapter null")
            call.reject("Bluetooth desactivado")
            return
        }
        if (!isGranted(context, android.Manifest.permission.BLUETOOTH_SCAN)) {
            remLog("ERROR", "SCAN", "BLUETOOTH_SCAN no concedido")
            call.reject("BLUETOOTH_SCAN no concedido")
            return
        }

        // Anti-throttle: si ya hay scan activo, detener primero
        if (isScanning) {
            remLog("WARN", "SCAN", "Scan ya activo, deteniendo primero...")
            stopScanInternal()
            mainHandler.postDelayed({
                startScanAfterStop(call, adapter)
            }, 300)
            return
        }

        startScanAfterStop(call, adapter)
    }

    private fun startScanAfterStop(call: PluginCall, adapter: android.bluetooth.BluetoothAdapter) {
        bluetoothScanner = adapter.bluetoothLeScanner
        scanResults.clear()

        if (bluetoothScanner == null) {
            remLog("ERROR", "SCAN", "bluetoothLeScanner es NULL aunque adapter está enabled")
            call.reject("BluetoothLeScanner null")
            return
        }

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        try {
            bluetoothScanner?.startScan(null, settings, scanCallback) // null = sin hardware filter
            isScanning = true
            mainHandler.postDelayed(scanTimeoutRunnable, SCAN_TIMEOUT_MS)
            remLog("INFO", "SCAN", "✅ Scan iniciado SIN filter (anti-throttle activo)")
            call.resolve(JSObject().put("started", true))
        } catch (e: SecurityException) {
            remLog("ERROR", "SCAN", "❌ SecurityException: ${e.message}")
            call.reject("Permiso faltante: ${e.message}")
        } catch (e: IllegalArgumentException) {
            remLog("ERROR", "SCAN", "❌ IllegalArgumentException: ${e.message}")
            call.reject("Argumento inválido: ${e.message}")
        }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        remLog("INFO", "SCAN", "stopScan llamado desde JS")
        stopScanInternal()
        call.resolve(JSObject().put("stopped", true))
    }

    private fun stopScanInternal() {
        remLog("DEBUG", "SCAN_DIAG", "stopScanInternal ejecutándose...")
        mainHandler.removeCallbacks(scanTimeoutRunnable)
        try {
            bluetoothScanner?.stopScan(scanCallback)
            remLog("INFO", "SCAN", "Scan detenido OK")
        } catch (e: Exception) {
            remLog("WARN", "SCAN", "Error deteniendo scan: ${e.message}")
        }
        bluetoothScanner = null
        isScanning = false
    }

    // ============================================================
    // SCAN CALLBACK: Log de TODO para diagnóstico
    // ============================================================
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.device?.let { device ->
                val addr = device.address
                val name = try { device.name } catch (e: SecurityException) { null } ?: "Unknown"
                val rssi = result.rssi

                // REM CRÍTICO: log de todo lo que ve el scanner (sin filtrar)
                val uuids = result.scanRecord?.serviceUuids?.joinToString(",") ?: "none"
                val rawBytes = result.scanRecord?.bytes?.let { bytes ->
                    bytes.take(20).joinToString(" ") { "%02X".format(it) }
                } ?: "no bytes"
                remLog("DEBUG", "SCAN_RAW", "📡 Visto: name=$name addr=$addr RSSI=$rssi UUIDs=$uuids raw=$rawBytes...")

                // FILTRO POR SOFTWARE: solo NEXO
                val hasNexoUuid = result.scanRecord?.serviceUuids?.any { it.uuid == NEXO_SERVICE_UUID } ?: false
                val isNexoDevice = hasNexoUuid || name.contains("NEXO", ignoreCase = true)

                if (!isNexoDevice) {
                    // No es NEXO, ignorar silenciosamente (ya loggeado arriba)
                    return@let
                }

                // Deduplicación por MAC
                if (scanResults.none { it.getString("deviceId") == addr }) {
                    val item = JSObject().apply {
                        put("deviceId", addr)
                        put("name", name)
                        put("rssi", rssi)
                    }
                    scanResults.add(item)
                    remLog("INFO", "SCAN", "✅ NEXO encontrado: $name ($addr) RSSI=$rssi")
                    notifyListeners("onDeviceFound", item)
                }
            }
        }

        override fun onScanFailed(errorCode: Int) {
            val errorMsg = when (errorCode) {
                ScanCallback.SCAN_FAILED_ALREADY_STARTED -> "ALREADY_STARTED"
                ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "APPLICATION_REGISTRATION_FAILED"
                ScanCallback.SCAN_FAILED_INTERNAL_ERROR -> "INTERNAL_ERROR"
                ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED -> "FEATURE_UNSUPPORTED"
                ScanCallback.SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES -> "OUT_OF_HARDWARE_RESOURCES"
                ScanCallback.SCAN_FAILED_SCANNING_TOO_FREQUENTLY -> "SCANNING_TOO_FREQUENTLY"
                else -> "UNKNOWN($errorCode)"
            }
            remLog("ERROR", "SCAN", "❌ onScanFailed: $errorMsg (code=$errorCode)")
            notifyListeners("onScanFailed", JSObject().put("errorCode", errorCode).put("errorMsg", errorMsg))
        }
    }

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: call.getString("address") ?: ""
        if (deviceId.isEmpty()) {
            call.reject("deviceId requerido")
            return
        }

        remLog("INFO", "CONNECT", "Conectando a $deviceId")
        val context = activity.applicationContext
        val device = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
            .adapter.getRemoteDevice(deviceId)

        bluetoothGatt?.close()
        bluetoothGatt = null
        clientTxCharacteristic = null
        clientRxCharacteristic = null

        bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, gattClientCallback)
        }

        notifyListeners("onDeviceConnected", JSObject()
            .put("deviceId", deviceId)
            .put("direction", "outgoing")
            .put("servicesReady", false)
        )
        call.resolve(JSObject().put("connecting", true).put("deviceId", deviceId))
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: ""
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
        clientTxCharacteristic = null
        clientRxCharacteristic = null
        connectedDevicesMap.remove(deviceId)
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
        if (deviceId.isEmpty()) {
            call.reject("deviceId requerido")
            return
        }
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
        clientTxCharacteristic = null
        clientRxCharacteristic = null

        mainHandler.postDelayed({
            val context = activity.applicationContext
            val device = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager)
                .adapter.getRemoteDevice(deviceId)
            bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
            } else {
                device.connectGatt(context, false, gattClientCallback)
            }
            notifyListeners("onDeviceConnected", JSObject()
                .put("deviceId", deviceId).put("direction", "outgoing").put("servicesReady", false)
            )
        }, 500)
        call.resolve(JSObject().put("reconnecting", true).put("deviceId", deviceId))
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val address = gatt.device?.address ?: ""
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                remLog("INFO", "GATT", "✅ Conectado a $address")
                connectedDevicesMap[address] = JSObject()
                    .put("id", address).put("address", address)
                    .put("name", gatt.device?.name ?: "NEXO Peer")
                    .put("direction", "outgoing")
                notifyListeners("onDeviceConnected", JSObject()
                    .put("deviceId", address).put("direction", "outgoing").put("servicesReady", false)
                )
                gatt.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                remLog("INFO", "GATT", "❌ Desconectado $address")
                connectedDevicesMap.remove(address)
                notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", address))
                bluetoothGatt?.close()
                bluetoothGatt = null
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val address = gatt.device?.address ?: ""
            if (status != BluetoothGatt.GATT_SUCCESS) {
                remLog("ERROR", "GATT", "Service discovery failed $address")
                notifyListeners("onConnectionFailed", JSObject()
                    .put("deviceId", address).put("reason", "Service discovery failed").put("recoverable", true)
                )
                return
            }
            val service = gatt.getService(NEXO_SERVICE_UUID) ?: run {
                remLog("ERROR", "GATT", "NEXO service no encontrado en $address")
                notifyListeners("onConnectionFailed", JSObject()
                    .put("deviceId", address).put("reason", "NEXO service not found").put("recoverable", false)
                )
                return
            }

            clientTxCharacteristic = service.getCharacteristic(TX_CHARACTERISTIC_UUID)
            clientRxCharacteristic = service.getCharacteristic(RX_CHARACTERISTIC_UUID)

            clientTxCharacteristic?.let { characteristic ->
                gatt.setCharacteristicNotification(characteristic, true)
                val descriptor = characteristic.getDescriptor(CCCD_UUID)
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
            remLog("INFO", "GATT", "✅ Services ready: $address")
            notifyListeners("onServicesReady", JSObject().put("deviceId", address).put("servicesReady", true))
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            val address = gatt.device?.address ?: ""
            if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == CCCD_UUID) {
                notifyListeners("onNotificationsEnabled", JSObject()
                    .put("deviceId", address).put("notificationsEnabled", true)
                )
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid == TX_CHARACTERISTIC_UUID) {
                val message = characteristic.value?.toString(Charset.defaultCharset()) ?: ""
                val address = gatt.device?.address ?: ""
                remLog("INFO", "MSG", "📨 RX (legacy) from $address: ${message.take(50)}")
                notifyListeners("onPayloadReceived", JSObject()
                    .put("deviceId", address).put("content", message).put("data", message)
                    .put("source", "ble").put("timestamp", System.currentTimeMillis())
                )
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            if (characteristic.uuid == TX_CHARACTERISTIC_UUID) {
                val message = value.toString(Charset.defaultCharset())
                val address = gatt.device?.address ?: ""
                remLog("INFO", "MSG", "📨 RX (API33+) from $address: ${message.take(50)}")
                notifyListeners("onPayloadReceived", JSObject()
                    .put("deviceId", address).put("content", message).put("data", message)
                    .put("source", "ble").put("timestamp", System.currentTimeMillis())
                )
            }
        }
    }

    private fun registerServerReceivers() {
        if (messageReceiver != null) return
        messageReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    ACTION_BLE_MESSAGE_RECEIVED -> {
                        val msg = intent.getStringExtra(EXTRA_MESSAGE_DATA) ?: ""
                        val device = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: ""
                        remLog("INFO", "MSG", "📨 Broadcast RX from $device: ${msg.take(50)}")
                        notifyListeners("onPayloadReceived", JSObject()
                            .put("deviceId", device).put("content", msg).put("data", msg)
                            .put("source", "ble").put("timestamp", System.currentTimeMillis())
                        )
                    }
                    ACTION_BLE_DEVICE_CONNECTED -> {
                        val addr = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: ""
                        remLog("INFO", "CONNECT", "✅ Incoming device: $addr")
                        connectedDevicesMap[addr] = JSObject()
                            .put("id", addr).put("address", addr)
                            .put("name", "NEXO Peer").put("direction", "incoming")
                        notifyListeners("onDeviceConnected", JSObject()
                            .put("deviceId", addr).put("direction", "incoming").put("servicesReady", true)
                        )
                    }
                    ACTION_BLE_DEVICE_DISCONNECTED -> {
                        val addr = intent.getStringExtra(EXTRA_DEVICE_ADDRESS) ?: ""
                        remLog("INFO", "CONNECT", "❌ Disconnected: $addr")
                        connectedDevicesMap.remove(addr)
                        notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", addr))
                    }
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(ACTION_BLE_MESSAGE_RECEIVED)
            addAction(ACTION_BLE_DEVICE_CONNECTED)
            addAction(ACTION_BLE_DEVICE_DISCONNECTED)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.registerReceiver(messageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                activity.registerReceiver(messageReceiver, filter)
            }
        } catch (e: Exception) {
            remLog("ERROR", "RECEIVER", "Error registrando: ${e.message}")
        }
    }

    private fun unregisterServerReceivers() {
        messageReceiver?.let {
            try { activity.unregisterReceiver(it) } catch (e: IllegalArgumentException) { }
            messageReceiver = null
        }
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
}
