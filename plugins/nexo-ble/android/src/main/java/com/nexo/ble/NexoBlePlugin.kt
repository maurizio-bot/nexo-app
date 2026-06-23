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
import java.nio.charset.Charset
import java.util.concurrent.ConcurrentHashMap

/**
 * NEXO BLE Plugin v6.1 - DUAL GATT ARCHITECTURE
 * 
 * Cada dispositivo es simultaneamente:
 * - GATT Server (recibe mensajes de otros)
 * - GATT Client (envia mensajes a otros)
 * 
 * Conexiones:
 * - Conexion A: Este dispositivo (Client) -> Remoto (Server) [para ENVIAR]
 * - Conexion B: Remoto (Client) -> Este dispositivo (Server) [para RECIBIR]
 */
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
    }

    // ==================== DUAL GATT: GATT SERVER (RECEPCION) ====================
    private var bluetoothGattServer: BluetoothGattServer? = null
    private var serverTxCharacteristic: BluetoothGattCharacteristic? = null
    private var serverRxCharacteristic: BluetoothGattCharacteristic? = null
    private val serverConnectedDevices = ConcurrentHashMap<String, BluetoothDevice>()

    // ==================== DUAL GATT: GATT CLIENTS (ENVIO) ====================
    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val clientRxCharacteristics = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
    private val clientTxCharacteristics = ConcurrentHashMap<String, BluetoothGattCharacteristic>()
    private val clientConnectionStates = ConcurrentHashMap<String, Int>()

    // ==================== ADVERTISING ====================
    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null

    // ==================== SCANNING ====================
    private var bluetoothScanner: BluetoothLeScanner? = null
    private val scanResults = mutableListOf<JSObject>()

    // ==================== CALLBACKS Y TIMERS ====================
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scanTimeoutRunnable = Runnable { stopScanInternal() }
    private val reconnectTimers = ConcurrentHashMap<String, Runnable>()
    private val reconnectAttempts = ConcurrentHashMap<String, Int>()

    // ==================== PENDING CALLS ====================
    private val pendingCalls = ConcurrentHashMap<String, PluginCall>()

    // ==================== RECEIVERS ====================
    private var messageReceiver: BroadcastReceiver? = null

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
        } catch (e: Exception) { }
    }

    // ==================== LIFECYCLE ====================
    override fun handleOnResume() {
        super.handleOnResume()
        remLog("INFO", "LIFECYCLE", "handleOnResume")
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
        try { stopAdvertisingInternal() } catch (e: Exception) { }
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
    }

    // ==================== PERMISSIONS ====================
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
            notifyListeners("onServerReady", JSObject().put("ready", true).put("source", "permissions_callback"))
        }
        call.resolve(JSObject().put("granted", granted))
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
        } else isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
    }

    /**
     * Normaliza MAC a formato sin separadores, lowercase (para usar como key interna)
     */
    private fun normalizeMac(mac: String): String {
        return mac.replace(":", "").replace("-", "").replace(".", "").lowercase()
    }

    /**
     * Formatea MAC para Android Bluetooth API (requiere XX:XX:XX:XX:XX:XX)
     */
    private fun formatMacForAndroid(mac: String): String? {
        val clean = mac.replace(":", "").replace("-", "").replace(".", "").lowercase()
        if (clean.length != 12 || !clean.all { it in '0'..'9' || it in 'a'..'f' }) {
            return null
        }
        return clean.chunked(2).joinToString(":")
    }

    // ==================== DUAL GATT: GATT SERVER (RECEPCION) ====================
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
                notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", device.address))
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            if (characteristic.uuid == NexoBleSpec.RX_CHARACTERISTIC_UUID) {
                val message = value?.toString(Charset.defaultCharset()) ?: ""
                val mac = device.address
                remLog("INFO", "GATT_SERVER", "RX from $mac: $message")
                notifyListeners("onPayloadReceived", JSObject()
                    .put("deviceId", mac)
                    .put("content", message)
                    .put("data", message)
                    .put("source", "gatt_server")
                    .put("timestamp", System.currentTimeMillis())
                )
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

    // ==================== DUAL GATT: GATT CLIENT (ENVIO) ====================
    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        try {
            val rawDeviceId = call.getString("deviceId") ?: call.getString("address") ?: ""
            remLog("INFO", "GATT_CLIENT", "connectToDevice raw='$rawDeviceId'")

            if (rawDeviceId.isEmpty()) {
                call.reject("deviceId requerido", "INVALID_DEVICE_ID")
                return
            }

            // Formatear MAC para Android API (requiere XX:XX:XX:XX:XX:XX)
            val macFormatted = formatMacForAndroid(rawDeviceId)
            if (macFormatted == null) {
                call.reject("MAC invalida: $rawDeviceId", "INVALID_MAC")
                return
            }

            val macNorm = normalizeMac(rawDeviceId)
            remLog("INFO", "GATT_CLIENT", "connectToDevice formatted='$macFormatted' norm='$macNorm'")

            if (gattClients.containsKey(macNorm) && clientConnectionStates[macNorm] == BluetoothProfile.STATE_CONNECTED) {
                remLog("INFO", "GATT_CLIENT", "Ya conectado a $macNorm")
                call.resolve(JSObject()
                    .put("connected", true)
                    .put("alreadyConnected", true)
                    .put("deviceId", macFormatted)
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

            val device: BluetoothDevice
            try {
                device = adapter.getRemoteDevice(macFormatted)
            } catch (e: IllegalArgumentException) {
                call.reject("MAC invalida para Bluetooth API: $macFormatted", "INVALID_MAC")
                return
            } catch (e: SecurityException) {
                call.reject("Permiso BLUETOOTH_CONNECT requerido para conectar", "PERMISSION_DENIED")
                return
            }

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

            // Timeout de conexion
            mainHandler.postDelayed({
                if (pendingCalls.containsKey(macNorm)) {
                    remLog("WARN", "GATT_CLIENT", "Timeout conectando a $macNorm")
                    pendingCalls.remove(macNorm)
                    gattClients[macNorm]?.let { g -> try { g.disconnect(); g.close() } catch (e: Exception) { } }
                    gattClients.remove(macNorm)
                    clientConnectionStates.remove(macNorm)
                    notifyListeners("onConnectionFailed", JSObject()
                        .put("deviceId", macFormatted)
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
                if (newState == BluetoothProfile.STATE_CONNECTED) {
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
                    try { gatt.discoverServices() } catch (e: SecurityException) {
                        remLog("ERROR", "GATT_CLIENT_CB", "SecurityException discoverServices: ${e.message}")
                    }
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    pendingCall?.let {
                        it.resolve(JSObject().put("connected", false).put("deviceId", address).put("error", "Disconnected"))
                        pendingCalls.remove(macNorm)
                    }
                    notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", address))
                    gattClients.remove(macNorm)
                    clientRxCharacteristics.remove(macNorm)
                    clientTxCharacteristics.remove(macNorm)
                    clientConnectionStates.remove(macNorm)
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
            }

            override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                val address = gatt.device?.address ?: ""
                if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                    notifyListeners("onNotificationsEnabled", JSObject().put("deviceId", address).put("notificationsEnabled", true))
                }
            }

            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                    val message = characteristic.value?.toString(Charset.defaultCharset()) ?: ""
                    val address = gatt.device?.address ?: ""
                    remLog("INFO", "GATT_CLIENT_CB", "Received (legacy) from $address: $message")
                    notifyListeners("onPayloadReceived", JSObject()
                        .put("deviceId", address)
                        .put("content", message)
                        .put("data", message)
                        .put("source", "gatt_client")
                        .put("timestamp", System.currentTimeMillis())
                    )
                }
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
                if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                    val message = value.toString(Charset.defaultCharset())
                    val address = gatt.device?.address ?: ""
                    remLog("INFO", "GATT_CLIENT_CB", "Received (API33+) from $address: $message")
                    notifyListeners("onPayloadReceived", JSObject()
                        .put("deviceId", address)
                        .put("content", message)
                        .put("data", message)
                        .put("source", "gatt_client")
                        .put("timestamp", System.currentTimeMillis())
                    )
                }
            }
        }
    }

    // ==================== AUTO-RECONNECT ====================
    private fun startAutoReconnect(macNorm: String) {
        val currentAttempts = reconnectAttempts[macNorm] ?: 0
        if (currentAttempts >= MAX_RECONNECT_ATTEMPTS) {
            remLog("WARN", "RECONNECT", "Max reintentos alcanzado para $macNorm")
            return
        }
        reconnectAttempts[macNorm] = currentAttempts + 1
        val runnable = Runnable {
            remLog("INFO", "RECONNECT", "Intentando reconectar a $macNorm (intento ${reconnectAttempts[macNorm]})")
            val ctx = activity.applicationContext
            val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val adapter = bluetoothManager.adapter
            if (adapter == null || !adapter.isEnabled) return@Runnable
            try {
                val macFormatted = macNorm.chunked(2).joinToString(":")
                val device = adapter.getRemoteDevice(macFormatted)
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
        gattClients[macNorm]?.let { gatt -> try { gatt.disconnect(); gatt.close() } catch (e: Exception) { } }
        gattClients.remove(macNorm)
        clientRxCharacteristics.remove(macNorm)
        clientTxCharacteristics.remove(macNorm)
        clientConnectionStates.remove(macNorm)
        pendingCalls.remove(macNorm)
        notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", rawDeviceId))
        call.resolve(JSObject().put("disconnected", true))
    }

    @PluginMethod
    fun forceReconnect(call: PluginCall) {
        val rawDeviceId = call.getString("deviceId") ?: ""
        val macNorm = normalizeMac(rawDeviceId)
        remLog("INFO", "GATT_CLIENT", "forceReconnect $rawDeviceId")
        reconnectAttempts[macNorm] = 0
        gattClients[macNorm]?.let { gatt -> try { gatt.disconnect(); gatt.close() } catch (e: Exception) { } }
        gattClients.remove(macNorm)
        clientConnectionStates.remove(macNorm)
        mainHandler.postDelayed({ startAutoReconnect(macNorm) }, 500)
        call.resolve(JSObject().put("reconnecting", true))
    }

    // ==================== DUAL GATT: ENVIO DE MENSAJES ====================
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
        val rxChar = clientRxCharacteristics[macNorm]
        val gatt = gattClients[macNorm]
        if (gatt != null && rxChar != null && clientConnectionStates[macNorm] == BluetoothProfile.STATE_CONNECTED) {
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
            call.resolve(JSObject().put("sent", success).put("mode", "gatt_client").put("deviceId", rawDeviceId))
            return
        }
        remLog("WARN", "SEND", "No GATT client para $macNorm, usando broadcast fallback")
        val ctx = activity.applicationContext
        val intent = Intent(NexoBleSpec.ACTION_BLE_SEND_MESSAGE).apply {
            putExtra(NexoBleSpec.EXTRA_MESSAGE_DATA, message)
            setPackage(ctx.packageName)
        }
        ctx.sendBroadcast(intent)
        call.resolve(JSObject().put("sent", true).put("mode", "broadcast").put("deviceId", rawDeviceId))
    }

    // ==================== ADVERTISING ====================
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
        if (bluetoothGattServer == null) startGattServer()
        try {
            val intent = Intent(ctx, BleService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
            registerServerReceivers()
            notifyListeners("onAdvertiseStarted", JSObject().put("started", true))
            call.resolve(JSObject().put("started", true))
        } catch (e: Exception) {
            call.reject("Error: ${e.message}")
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        val ctx = activity.applicationContext
        try {
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

    private fun stopAdvertisingInternal() {
        try { bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback) } catch (e: Exception) { }
    }

    private val advertiseCallback = object : android.bluetooth.le.AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: android.bluetooth.le.AdvertiseSettings?) {
            remLog("INFO", "ADVERTISING", "Started")
        }
        override fun onStartFailure(errorCode: Int) {
            remLog("ERROR", "ADVERTISING", "Failed: $errorCode")
        }
    }

    // ==================== SCANNING ====================
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
        bluetoothScanner = adapter.bluetoothLeScanner
        scanResults.clear()
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(NexoBleSpec.NEXO_SERVICE_UUID)).build()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        try {
            bluetoothScanner?.startScan(listOf(filter), settings, scanCallback)
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
    }

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
                    notifyListeners("onDeviceFound", item)
                }
            }
        }
        override fun onScanFailed(errorCode: Int) {
            notifyListeners("onScanFailed", JSObject().put("errorCode", errorCode))
        }
    }

    // ==================== BLUETOOTH STATE ====================
    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        val ctx = activity.applicationContext
        val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        val enabled = adapter != null && adapter.isEnabled
        call.resolve(JSObject()
            .put("enabled", enabled)
            .put("canAdvertise", enabled && bluetoothGattServer != null)
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

    // ==================== RECEIVERS ====================
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

    // ==================== ALIAS PARA COMPATIBILIDAD ====================
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
