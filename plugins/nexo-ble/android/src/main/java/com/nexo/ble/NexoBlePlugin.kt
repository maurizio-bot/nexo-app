package com.nexo.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray
import org.json.JSONException
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

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
        const val TAG = "NexoBLE"
        
        // ✅ UUIDs válidos hexadecimales
        val SERVICE_UUID = UUID.fromString("a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d")
        val CHAR_ANNOUNCE = UUID.fromString("b4c6d9e3-f2a5-4b8c-ad4e-7f9a2b3c6d8e")
        val CHAR_HANDSHAKE = UUID.fromString("c5d7eaf4-a3b6-4c9d-be5f-8a0c3d4e7f9a")
        val CHAR_PAYLOAD = UUID.fromString("d6e8f0a5-b4c7-4d0e-cf6a-9b1e4f5a8b0c")
        val CHAR_CONTROL = UUID.fromString("e7f9a0b6-c5d8-4e1f-da7b-0c2f5e6a9b1d")
        
        const val MTU_DEFAULT = 512
        const val CHUNK_SIZE = 507
        const val CHUNK_TIMEOUT_MS = 30000L // 30s TTL para reensamblado
        
        // Error codes
        const val ERR_BLUETOOTH_NOT_SUPPORTED = "BLE_001"
        const val ERR_BLUETOOTH_DISABLED = "BLE_002"
        const val ERR_PERMISSION_DENIED = "BLE_003"
        const val ERR_DEVICE_NOT_FOUND = "BLE_006"
        const val ERR_MESSAGE_TOO_LARGE = "BLE_008"
        const val ERR_INVALID_PARAMS = "BLE_019"
        const val ERR_NOT_CONNECTED = "BLE_011"
    }

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var gattServer: BluetoothGattServer? = null
    
    // ✅ FIX: Estructura thread-safe para chunks
    private data class ChunkAssembly(
        val chunks: ConcurrentHashMap<Int, ByteArray> = ConcurrentHashMap(),
        val totalChunks: Int,
        val timestamp: Long = System.currentTimeMillis(),
        val deviceId: String
    )
    
    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val connectedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val pendingAssemblies = ConcurrentHashMap<String, ChunkAssembly>()
    private val activeCalls = ConcurrentHashMap<String, PluginCall>() // Para cancelación
    
    private var isAdvertising = false
    private var isScanning = false
    private var advertiseCallback: AdvertiseCallback? = null
    private var scanCallback: ScanCallback? = null
    
    private val handler = Handler(Looper.getMainLooper())
    private val cleanupRunnable = Runnable { cleanupExpiredAssemblies() }
    private var userId: String = ""
    private val messageIdCounter = AtomicInteger(0)

    override fun load() {
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        startCleanupTimer()
        Log.d(TAG, "NexoBLE Plugin v1.3 loaded")
    }

    @PluginMethod
    fun initialize(call: PluginCall) {
        userId = call.getString("userId") ?: generateUserId()
        
        if (bluetoothAdapter == null) {
            call.reject(ERR_BLUETOOTH_NOT_SUPPORTED, "Device does not support Bluetooth")
            return
        }
        
        if (!bluetoothAdapter!!.isEnabled) {
            call.reject(ERR_BLUETOOTH_DISABLED, "Bluetooth is disabled")
            return
        }
        
        try {
            setupGattServer()
            call.resolve(JSObject().apply {
                put("userId", userId)
                put("status", "initialized")
                put("version", "1.3")
            })
        } catch (e: Exception) {
            Log.e(TAG, "Initialize failed", e)
            call.reject("INIT_FAILED", e.message)
        }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        if (hasPermission("bluetoothAdvertise")) {
            startAdvertisingInternal(call)
        } else {
            requestPermissionForAlias("bluetoothAdvertise", call, "advertisePermissionCallback")
        }
    }

    @PermissionCallback
    private fun advertisePermissionCallback(call: PluginCall) {
        if (hasPermission("bluetoothAdvertise")) {
            startAdvertisingInternal(call)
        } else {
            call.reject(ERR_PERMISSION_DENIED, "Bluetooth advertise permission required")
        }
    }

    private fun startAdvertisingInternal(call: PluginCall) {
        val advertiser = bluetoothAdapter?.bluetoothLeAdvertiser ?: run {
            call.reject("ADVERTISER_UNAVAILABLE", "BLE Advertising not supported")
            return
        }

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
            .addManufacturerData(0x4E58, hexToBytes(userId.take(8)))
            .build()

        advertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                call.resolve(JSObject().put("active", true))
            }

            override fun onStartFailure(errorCode: Int) {
                isAdvertising = false
                call.reject("ADVERTISE_FAILED", "Code: $errorCode")
            }
        }

        advertiser.startAdvertising(settings, data, advertiseCallback)
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        isAdvertising = false
        advertiseCallback = null
        call.resolve()
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (hasPermission("bluetoothScan")) {
            startScanInternal(call)
        } else {
            requestPermissionForAlias("bluetoothScan", call, "scanPermissionCallback")
        }
    }

    @PermissionCallback
    private fun scanPermissionCallback(call: PluginCall) {
        if (hasPermission("bluetoothScan")) {
            startScanInternal(call)
        } else {
            call.reject(ERR_PERMISSION_DENIED, "Bluetooth scan permission required")
        }
    }

    private fun startScanInternal(call: PluginCall) {
        val scanner = bluetoothAdapter?.bluetoothLeScanner ?: run {
            call.reject("SCANNER_UNAVAILABLE", "BLE Scanner not available")
            return
        }

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
            .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
            .build()

        scanCallback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                result?.let { processScanResult(it) }
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>?) {
                results?.forEach { processScanResult(it) }
            }

            override fun onScanFailed(errorCode: Int) {
                notifyListeners("onScanFailed", JSObject().put("error", errorCode))
            }
        }

        try {
            scanner.startScan(listOf(filter), settings, scanCallback)
            isScanning = true
            call.resolve()
        } catch (e: Exception) {
            call.reject("SCAN_FAILED", e.message)
        }
    }

    private fun processScanResult(result: ScanResult) {
        if (result.rssi < -85) return // Filtrar lejanos

        val device = result.device
        val data = JSObject().apply {
            put("id", device.address)
            put("rssi", result.rssi)
            put("name", device.name ?: "NEXO-${device.address.takeLast(4)}")
            result.scanRecord?.manufacturerSpecificData?.let { map ->
                if (map.size() > 0) put("userId", bytesToHex(map.valueAt(0)))
            }
        }
        notifyListeners("onPeerDiscovered", data)
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
        isScanning = false
        scanCallback = null
        call.resolve()
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject(ERR_INVALID_PARAMS, "deviceId required")
            return
        }

        if (!deviceId.matches(Regex("([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}"))) {
            call.reject(ERR_INVALID_PARAMS, "Invalid MAC format")
            return
        }

        if (connectedDevices.containsKey(deviceId)) {
            call.reject("ALREADY_CONNECTED", "Device already connected")
            return
        }

        val device = bluetoothAdapter?.getRemoteDevice(deviceId) ?: run {
            call.reject(ERR_DEVICE_NOT_FOUND, "Device not found")
            return
        }

        val gattCallback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> {
                        gatt?.requestMtu(MTU_DEFAULT)
                        connectedDevices[deviceId] = device
                        notifyConnectionState(deviceId, "connected")
                    }
                    BluetoothProfile.STATE_DISCONNECTED -> {
                        cleanupConnection(deviceId)
                        notifyConnectionState(deviceId, "disconnected")
                    }
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt?, mtu: Int, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) gatt?.discoverServices()
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    gatt?.getService(SERVICE_UUID)?.getCharacteristic(CHAR_PAYLOAD)?.let { char ->
                        val desc = char.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
                        desc?.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        gatt.writeDescriptor(desc)
                        gatt.setCharacteristicNotification(char, true)
                    }
                }
            }

            @Suppress("DEPRECATION")
            override fun onCharacteristicChanged(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?) {
                characteristic?.let { char ->
                    val value = char.value ?: return
                    val addr = gatt?.device?.address ?: return
                    
                    when (char.uuid) {
                        CHAR_PAYLOAD -> processPayloadChunk(addr, value)
                        CHAR_HANDSHAKE -> processHandshake(addr, value)
                        CHAR_CONTROL -> processControl(addr, value)
                    }
                }
            }
        }

        val gatt = device.connectGatt(context, false, gattCallback)
        gattClients[deviceId] = gatt
        call.resolve(JSObject().put("deviceId", deviceId))
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val list = JSONArray()
        connectedDevices.keys.forEach { addr ->
            list.put(JSObject().apply {
                put("id", addr)
                put("connected", true)
            })
        }
        call.resolve(JSObject().put("devices", list))
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject(ERR_INVALID_PARAMS, "deviceId required")
            return
        }
        cleanupConnection(deviceId)
        call.resolve()
    }
    
    private fun cleanupConnection(deviceId: String) {
        // Cancelar envíos pendientes
        activeCalls.remove(deviceId)?.reject("DISCONNECTED", "Device disconnected")
        
        gattClients[deviceId]?.let { gatt ->
            try {
                gatt.disconnect()
                gatt.close()
            } catch (e: Exception) {
                Log.e(TAG, "Error closing GATT", e)
            }
        }
        gattClients.remove(deviceId)
        connectedDevices.remove(deviceId)
        
        // Limpiar assemblies huérfanos de este device
        val keysToRemove = pendingAssemblies.filter { it.value.deviceId == deviceId }.keys
        keysToRemove.forEach { pendingAssemblies.remove(it) }
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject(ERR_INVALID_PARAMS, "deviceId required")
            return
        }
        
        if (!connectedDevices.containsKey(deviceId)) {
            call.reject(ERR_NOT_CONNECTED, "Device not connected")
            return
        }
        
        // ✅ FIX: Validación robusta de JSONArray
        val dataArray = try {
            call.getArray("data")
        } catch (e: JSONException) {
            call.reject(ERR_INVALID_PARAMS, "Invalid data format")
            return
        } ?: run {
            call.reject(ERR_INVALID_PARAMS, "data array required")
            return
        }

        val bytes = try {
            ByteArray(dataArray.length()) { i ->
                when (val value = dataArray.opt(i)) {
                    is Int -> {
                        if (value < 0 || value > 255) throw IllegalArgumentException("Byte out of range at $i")
                        value.toByte()
                    }
                    is Number -> value.toInt().toByte()
                    else -> throw IllegalArgumentException("Non-numeric value at $i")
                }
            }
        } catch (e: Exception) {
            call.reject(ERR_INVALID_PARAMS, "Invalid data: ${e.message}")
            return
        }

        if (bytes.size > 65535) {
            call.reject(ERR_MESSAGE_TOO_LARGE, "Max 64KB allowed")
            return
        }

        // ✅ FIX: Guardar call para posible cancelación
        val callId = "${deviceId}_${System.currentTimeMillis()}"
        activeCalls[callId] = call
        
        sendChunkedMessage(deviceId, bytes, callId)
    }

    private fun sendChunkedMessage(deviceId: String, data: ByteArray, callId: String) {
        val call = activeCalls[callId] ?: return // Call cancelado
        
        val totalChunks = (data.size + CHUNK_SIZE - 1) / CHUNK_SIZE
        val messageId = messageIdCounter.incrementAndGet() and 0xFFFF
        
        val chunksList = data.toList().chunked(CHUNK_SIZE)
        val currentChunk = AtomicInteger(0)
        
        fun sendNext() {
            if (!activeCalls.containsKey(callId)) return // Cancelado
            
            val idx = currentChunk.getAndIncrement()
            if (idx >= chunksList.size) {
                // Éxito
                activeCalls.remove(callId)
                call.resolve(JSObject().apply {
                    put("success", true)
                    put("bytesSent", data.size)
                    put("chunks", chunksList.size)
                })
                return
            }
            
            val chunk = chunksList[idx]
            val isLast = idx == chunksList.size - 1
            val flags = if (isLast) 0x03 else 0x01
            
            val buffer = ByteBuffer.allocate(7 + chunk.size).apply {
                order(ByteOrder.BIG_ENDIAN)
                put(flags.toByte())
                putShort(messageId.toShort())
                putShort(idx.toShort())
                putShort(chunksList.size.toShort())
                chunk.forEach { put(it) }
            }
            
            if (!writeCharacteristic(deviceId, CHAR_PAYLOAD, buffer.array())) {
                activeCalls.remove(callId)
                call.reject("SEND_FAILED", "Failed at chunk $idx")
                return
            }
            
            if (!isLast) {
                handler.postDelayed({ sendNext() }, 10)
            } else {
                sendNext() // Verificar finalización
            }
        }
        
        sendNext()
    }

    private fun processPayloadChunk(deviceId: String, data: ByteArray) {
        if (data.size < 7) return
        
        val buffer = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN)
        val flags = buffer.get().toInt() and 0xFF
        val messageId = buffer.short.toInt() and 0xFFFF
        val chunkIndex = buffer.short.toInt() and 0xFFFF
        val totalChunks = buffer.short.toInt() and 0xFFFF
        
        if (totalChunks <= 0 || totalChunks > 1000) return // Validación anti-spam
        
        val isLast = (flags and 0x02) != 0
        val payload = data.copyOfRange(7, data.size)
        val key = "$deviceId:$messageId"
        
        // ✅ FIX: Thread-safe assembly
        val assembly = pendingAssemblies.computeIfAbsent(key) { 
            ChunkAssembly(totalChunks = totalChunks, deviceId = deviceId) 
        }
        
        assembly.chunks[chunkIndex] = payload
        
        if (assembly.chunks.size == totalChunks) {
            // Reensamblar
            val baos = ByteArrayOutputStream()
            for (i in 0 until totalChunks) {
                assembly.chunks[i]?.let { baos.write(it) } ?: return // Faltante
            }
            
            pendingAssemblies.remove(key)
            
            notifyListeners("onMessageReceived", JSObject().apply {
                put("deviceId", deviceId)
                put("messageId", messageId)
                put("data", JSONArray(baos.toByteArray().map { it.toInt() and 0xFF }))
                put("size", baos.size())
            })
        }
    }

    private fun processHandshake(deviceId: String, data: ByteArray) {
        notifyListeners("onHandshakeReceived", JSObject().apply {
            put("deviceId", deviceId)
            put("type", if (data.isNotEmpty()) data[0].toInt() and 0xFF else 0)
            put("payload", data)
        })
    }

    private fun processControl(deviceId: String, data: ByteArray) {
        if (data.isNotEmpty() && data[0].toInt() == 0x04) {
            writeCharacteristic(deviceId, CHAR_CONTROL, byteArrayOf(0x05))
        }
    }

    private fun writeCharacteristic(deviceId: String, uuid: UUID, data: ByteArray): Boolean {
        val gatt = gattClients[deviceId] ?: return false
        val char = gatt.getService(SERVICE_UUID)?.getCharacteristic(uuid) ?: return false
        
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(char, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == 0
        } else {
            char.value = data
            gatt.writeCharacteristic(char)
        }
    }

    private fun setupGattServer() {
        val serverCallback = object : BluetoothGattServerCallback() {
            override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
                device?.address?.let { addr ->
                    when (newState) {
                        BluetoothProfile.STATE_CONNECTED -> {
                            connectedDevices[addr] = device
                            notifyConnectionState(addr, "connected")
                        }
                        BluetoothProfile.STATE_DISCONNECTED -> {
                            connectedDevices.remove(addr)
                            notifyConnectionState(addr, "disconnected")
                        }
                    }
                }
            }

            override fun onCharacteristicReadRequest(
                device: BluetoothDevice?, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic?
            ) {
                if (characteristic?.uuid == CHAR_ANNOUNCE) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, 
                        hexToBytes(userId).copyOf(16))
                } else {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, 0, null)
                }
            }

            override fun onCharacteristicWriteRequest(
                device: BluetoothDevice?, requestId: Int, characteristic: BluetoothGattCharacteristic?,
                preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
            ) {
                val addr = device?.address ?: return
                value?.let {
                    when (characteristic?.uuid) {
                        CHAR_PAYLOAD -> processPayloadChunk(addr, it)
                        CHAR_HANDSHAKE -> processHandshake(addr, it)
                        CHAR_CONTROL -> processControl(addr, it)
                    }
                }
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
            }
        }

        gattServer = bluetoothManager?.openGattServer(context, serverCallback)
        
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_ANNOUNCE,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        ))
        
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_HANDSHAKE,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ))
        
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_PAYLOAD,
            BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ))
        
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_CONTROL,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ
        ))
        
        gattServer?.addService(service)
    }

    private fun startCleanupTimer() {
        handler.postDelayed(cleanupRunnable, CHUNK_TIMEOUT_MS)
    }

    private fun cleanupExpiredAssemblies() {
        val now = System.currentTimeMillis()
        val expired = pendingAssemblies.filter { 
            (now - it.value.timestamp) > CHUNK_TIMEOUT_MS 
        }.keys
        expired.forEach { pendingAssemblies.remove(it) }
        handler.postDelayed(cleanupRunnable, CHUNK_TIMEOUT_MS)
    }

    private fun notifyConnectionState(deviceId: String, state: String) {
        notifyListeners("onConnectionStateChanged", JSObject().apply {
            put("deviceId", deviceId)
            put("state", state)
        })
    }

    private fun generateUserId(): String = UUID.randomUUID().toString().replace("-", "").take(32)
    private fun bytesToHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
    private fun hexToBytes(hex: String): ByteArray = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    override fun handleOnDestroy() {
        handler.removeCallbacks(cleanupRunnable)
        bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
        
        activeCalls.values.forEach { it.reject("DESTROYED", "Plugin destroyed") }
        activeCalls.clear()
        
        gattClients.forEach { (_, gatt) -> 
            try { gatt.disconnect(); gatt.close() } catch (_: Exception) {} 
        }
        gattServer?.close()
        pendingAssemblies.clear()
        super.handleOnDestroy()
    }
}
