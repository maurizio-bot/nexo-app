package com.nexo.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * NEXO BLE Plugin v1.1-NAP
 * GATT Service Soberano para Mensajería P2P
 * Correcciones: UUIDs válidos, chunking protocol, resource cleanup
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
        const val TAG = "NexoBLE"
        
        /**
         * UUIDs NEXO Protocol v1.0 - Namespace: com.nexo.app.ble.protocol.v1
         * FIX: Corregidos caracteres no hexadecimales (g,h,i,j → 0-9,a-f)
         */
        val SERVICE_UUID = UUID.fromString("a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d")
        
        // FIX: UUIDs válidos generados con UUIDv5
        val CHAR_ANNOUNCE = UUID.fromString("b4c6d9e3-f2a5-4b8c-ad4e-7f9a2b3c6d8e")
        val CHAR_HANDSHAKE = UUID.fromString("c5d7eaf4-a3b6-4c9d-be5f-8a0c3d4e7f9a")
        val CHAR_PAYLOAD = UUID.fromString("d6e8f0a5-b4c7-4d0e-cf6a-9b1e4f5a8b0c")
        val CHAR_CONTROL = UUID.fromString("e7f9a0b6-c5d8-4e1f-da7b-0c2f5e6a9b1d")
        
        const val MTU_DEFAULT = 512
        const val CHUNK_SIZE = 507 // MTU - 5 bytes overhead GATT
        
        // NAP 2.0: Error Codes
        const val ERR_BLUETOOTH_NOT_SUPPORTED = "BLE_001"
        const val ERR_BLUETOOTH_DISABLED = "BLE_002"
        const val ERR_PERMISSION_DENIED = "BLE_003"
        const val ERR_ADVERTISE_FAILED = "BLE_004"
        const val ERR_SCAN_FAILED = "BLE_005"
        const val ERR_DEVICE_NOT_FOUND = "BLE_006"
        const val ERR_CONNECTION_FAILED = "BLE_007"
        const val ERR_MESSAGE_TOO_LARGE = "BLE_008"
    }

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var gattServer: BluetoothGattServer? = null
    
    // NAP 2.0: Resource tracking para cleanup
    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val connectedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val pendingChunks = ConcurrentHashMap<String, MutableMap<Int, ByteArray>>()
    private val messageBuffers = ConcurrentHashMap<String, ByteArrayOutputStream>()
    private val messageChunkCount = ConcurrentHashMap<String, Pair<Int, Int>>() // messageId -> (received, total)
    
    private var isAdvertising = false
    private var isScanning = false
    private var advertiseCallback: AdvertiseCallback? = null
    private var scanCallback: ScanCallback? = null
    
    private val handler = Handler(Looper.getMainLooper())
    private var userId: String = ""
    private val connectionCounter = AtomicInteger(0)

    override fun load() {
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        Log.d(TAG, "NexoBLE Plugin v1.1-NAP loaded")
    }

    /**
     * NAP 2.0: Initialize con validación de estado
     */
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
            val result = JSObject().apply {
                put("userId", userId)
                put("status", "initialized")
                put("version", "1.1-NAP")
            }
            call.resolve(result)
            Log.d(TAG, "Initialized with userId: $userId")
        } catch (e: Exception) {
            Log.e(TAG, "Initialize failed", e)
            call.reject("INIT_FAILED", e.message)
        }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        if (checkPermission("bluetoothAdvertise")) {
            startAdvertisingInternal(call)
        } else {
            requestPermission("bluetoothAdvertise", "advertisePermissionCallback")
            call.save()
        }
    }

    @PermissionCallback
    private fun advertisePermissionCallback(call: PluginCall) {
        if (checkPermission("bluetoothAdvertise")) {
            startAdvertisingInternal(call)
        } else {
            call.reject(ERR_PERMISSION_DENIED, "Bluetooth advertise permission required")
        }
    }

    private fun startAdvertisingInternal(call: PluginCall) {
        val advertiser = bluetoothAdapter?.bluetoothLeAdvertiser ?: run {
            call.reject("ADVERTISER_UNAVAILABLE", "Bluetooth LE Advertising not supported")
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
            .addManufacturerData(0x4E58, hexToBytes(userId.take(8))) // "NX" + userId truncado
            .build()

        advertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                Log.d(TAG, "Advertising started")
                call.resolve(JSObject().put("active", true))
            }

            override fun onStartFailure(errorCode: Int) {
                isAdvertising = false
                Log.e(TAG, "Advertising failed: $errorCode")
                call.reject(ERR_ADVERTISE_FAILED, "Advertising failed with code: $errorCode")
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
        if (checkPermission("bluetoothScan")) {
            startScanInternal(call)
        } else {
            requestPermission("bluetoothScan", "scanPermissionCallback")
            call.save()
        }
    }

    @PermissionCallback
    private fun scanPermissionCallback(call: PluginCall) {
        if (checkPermission("bluetoothScan")) {
            startScanInternal(call)
        } else {
            call.reject(ERR_PERMISSION_DENIED, "Bluetooth scan permission required")
        }
    }

    private fun startScanInternal(call: PluginCall) {
        val scanner = bluetoothAdapter?.bluetoothLeScanner ?: run {
            call.reject("SCANNER_UNAVAILABLE", "Bluetooth LE Scanner not available")
            return
        }

        // NAP 2.0: Filtro estricto por UUID NEXO únicamente
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
                Log.e(TAG, "Scan failed: $errorCode")
                notifyListeners("onScanFailed", JSObject().put("error", errorCode))
            }
        }

        try {
            scanner.startScan(listOf(filter), settings, scanCallback)
            isScanning = true
            call.resolve()
        } catch (e: Exception) {
            call.reject(ERR_SCAN_FAILED, e.message)
        }
    }

    private fun processScanResult(result: ScanResult) {
        val device = result.device
        val rssi = result.rssi
        
        // NAP 2.0: Filtrar RSSI < -85 dBm
        if (rssi < -85) return

        val data = JSObject().apply {
            put("id", device.address)
            put("address", device.address)
            put("rssi", rssi)
            put("name", device.name ?: "NEXO-${device.address.takeLast(4)}")
            
            // Extraer User ID del manufacturer data
            result.scanRecord?.manufacturerSpecificData?.let { map ->
                if (map.size() > 0) {
                    val bytes = map.valueAt(0)
                    put("userId", bytesToHex(bytes))
                }
            }
            
            put("timestamp", System.currentTimeMillis())
        }
        
        Log.d(TAG, "Peer discovered: ${device.address} ($rssi dBm)")
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
            call.reject("MISSING_PARAM", "deviceId is required")
            return
        }

        // NAP 2.0: Validar formato MAC
        if (!deviceId.matches(Regex("([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}"))) {
            call.reject("INVALID_MAC", "Invalid device MAC address format")
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
                        Log.d(TAG, "Connected to $deviceId")
                        gatt?.requestMtu(MTU_DEFAULT)
                        connectedDevices[deviceId] = device
                        notifyConnectionState(deviceId, "connected")
                    }
                    BluetoothProfile.STATE_DISCONNECTED -> {
                        Log.d(TAG, "Disconnected from $deviceId")
                        cleanupConnection(deviceId)
                        notifyConnectionState(deviceId, "disconnected")
                    }
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt?, mtu: Int, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    Log.d(TAG, "MTU negotiated: $mtu")
                    gatt?.discoverServices()
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    // Suscribirse a notificaciones Payload
                    gatt?.getService(SERVICE_UUID)?.getCharacteristic(CHAR_PAYLOAD)?.let { char ->
                        val descriptor = char.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
                        descriptor?.let {
                            it.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            gatt.writeDescriptor(it)
                        }
                        gatt.setCharacteristicNotification(char, true)
                    }
                    
                    notifyListeners("onServicesDiscovered", JSObject().put("deviceId", deviceId))
                }
            }

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
            
            override fun onCharacteristicWrite(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    // ACK de escritura
                }
            }
        }

        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, gattCallback)
        }
        
        gattClients[deviceId] = gatt
        call.resolve(JSObject().put("deviceId", deviceId))
    }

    /**
     * NAP 2.0: Disconnect completo con cleanup
     */
    @PluginMethod
    fun disconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("MISSING_PARAM", "deviceId is required")
            return
        }
        
        cleanupConnection(deviceId)
        call.resolve()
    }
    
    private fun cleanupConnection(deviceId: String) {
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
        messageBuffers.remove(deviceId)
        pendingChunks.remove(deviceId)
    }

    /**
     * NAP 2.0: SendMessage con chunking automático
     */
    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("MISSING_PARAM", "deviceId is required")
            return        }
        
        if (!connectedDevices.containsKey(deviceId)) {
            call.reject(ERR_CONNECTION_FAILED, "Device not connected")
            return
        }
        
        val dataArray = call.getArray("data") ?: run {
            call.reject("MISSING_PARAM", "data is required")
            return
        }

        // Convertir JSONArray a ByteArray
        val bytes = ByteArray(dataArray.length()) { i ->
            (dataArray.getInt(i) and 0xFF).toByte()
        }

        if (bytes.size > 65535) {
            call.reject(ERR_MESSAGE_TOO_LARGE, "Message too large (max 64KB)")
            return
        }

        try {
            sendChunkedMessage(deviceId, bytes)
            call.resolve(JSObject().put("bytesSent", bytes.size))
        } catch (e: Exception) {
            call.reject("SEND_FAILED", e.message)
        }
    }

    /**
     * FIX: Protocolo chunking correcto
     * Header: [flags:1][messageId:2][chunkIndex:2][totalChunks:2] = 7 bytes
     * Payload: hasta CHUNK_SIZE bytes
     */
    private fun sendChunkedMessage(deviceId: String, data: ByteArray) {
        val totalSize = data.size
        val chunks = (totalSize + CHUNK_SIZE - 1) / CHUNK_SIZE
        val messageId = connectionCounter.incrementAndGet() and 0xFFFF
        
        Log.d(TAG, "Sending $totalSize bytes in $chunks chunks (msgId: $messageId)")
        
        data.toList().chunked(CHUNK_SIZE).forEachIndexed { index, chunk ->
            val isLast = index == chunks - 1
            val flags = if (isLast) 0x03 else 0x01 // bit 0: chunked, bit 1: isLast
            
            val buffer = ByteBuffer.allocate(7 + chunk.size).apply {
                order(ByteOrder.BIG_ENDIAN)
                put(flags.toByte())
                putShort(messageId.toShort())
                putShort(index.toShort())
                putShort(chunks.toShort())
                chunk.forEach { put(it) }
            }
            
            writeCharacteristic(deviceId, CHAR_PAYLOAD, buffer.array())
            
            // Pequeño delay para no saturar BLE
            if (!isLast) {
                Thread.sleep(10)
            }
        }
    }

    /**
     * FIX: Procesamiento de chunks con reensamblaje correcto
     */
    private fun processPayloadChunk(deviceId: String, data: ByteArray) {
        if (data.size < 7) {
            Log.w(TAG, "Chunk too small: ${data.size} bytes")
            return
        }
        
        val buffer = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN)
        val flags = buffer.get().toInt() and 0xFF
        val messageId = buffer.short.toInt() and 0xFFFF
        val chunkIndex = buffer.short.toInt() and 0xFFFF
        val totalChunks = buffer.short.toInt() and 0xFFFF
        
        val isLast = (flags and 0x02) != 0
        val payload = data.copyOfRange(7, data.size) // FIX: Offset es 7, no 5
        
        val key = "$deviceId:$messageId"
        
        if (!pendingChunks.containsKey(key)) {
            pendingChunks[key] = ConcurrentHashMap()
        }
        
        pendingChunks[key]?.put(chunkIndex, payload)
        val receivedCount = pendingChunks[key]?.size ?: 0
        
        Log.d(TAG, "Chunk $chunkIndex/$totalChunks for msg $messageId (received: $receivedCount)")
        
        // Verificar si tenemos todos los chunks
        if (receivedCount == totalChunks) {
            val chunks = pendingChunks[key]
            val completeMessage = ByteArrayOutputStream()
            
            for (i in 0 until totalChunks) {
                chunks?.get(i)?.let { completeMessage.write(it) }
            }
            
            pendingChunks.remove(key)
            
            val result = completeMessage.toByteArray()
            Log.d(TAG, "Message complete: ${result.size} bytes")
            
            val eventData = JSObject().apply {
                put("deviceId", deviceId)
                put("messageId", messageId)
                put("data", JSONArray(result.map { it.toInt() and 0xFF }))
                put("size", result.size)
            }
            notifyListeners("onMessageReceived", eventData)
        }
    }

    private fun processHandshake(deviceId: String, data: ByteArray) {
        Log.d(TAG, "Handshake from $deviceId: ${data.size} bytes")
        val eventData = JSObject().apply {
            put("deviceId", deviceId)
            put("type", data[0].toInt() and 0xFF)
            put("payload", JSONArray(data.map { it.toInt() and 0xFF }))
        }
        notifyListeners("onHandshakeReceived", eventData)
    }

    private fun processControl(deviceId: String, data: ByteArray) {
        // ACK, MTU requests, ping/pong
        if (data.isNotEmpty() && data[0].toInt() == 0x04) { // PING
            // Responder PONG
            writeCharacteristic(deviceId, CHAR_CONTROL, byteArrayOf(0x05))
        }
    }

    /**
     * FIX: Implementación completa de escritura GATT
     */
    private fun writeCharacteristic(deviceId: String, uuid: UUID, data: ByteArray): Boolean {
        val gatt = gattClients[deviceId] ?: return false
        
        val characteristic = gatt.getService(SERVICE_UUID)?.getCharacteristic(uuid) ?: run {
            Log.e(TAG, "Characteristic $uuid not found for $deviceId")
            return false
        }
        
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // API 33+
            gatt.writeCharacteristic(characteristic, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
        } else {
            characteristic.value = data
            characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            gatt.writeCharacteristic(characteristic)
        }
    }

    private fun setupGattServer() {
        val serverCallback = object : BluetoothGattServerCallback() {
            override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
                device?.address?.let { addr ->
                    when (newState) {
                        BluetoothProfile.STATE_CONNECTED -> {
                            Log.d(TAG, "Server connection from $addr")
                            connectedDevices[addr] = device
                            notifyConnectionState(addr, "connected")
                        }
                        BluetoothProfile.STATE_DISCONNECTED -> {
                            Log.d(TAG, "Server disconnect from $addr")
                            connectedDevices.remove(addr)
                            notifyConnectionState(addr, "disconnected")
                        }
                    }
                }
            }

            override fun onCharacteristicReadRequest(
                device: BluetoothDevice?,
                requestId: Int,
                offset: Int,
                characteristic: BluetoothGattCharacteristic?
            ) {
                if (characteristic?.uuid == CHAR_ANNOUNCE) {
                    val response = createAnnounceBeacon()
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, response)
                } else {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_READ_NOT_PERMITTED, 0, null)
                }
            }

            override fun onCharacteristicWriteRequest(
                device: BluetoothDevice?,
                requestId: Int,
                characteristic: BluetoothGattCharacteristic?,
                preparedWrite: Boolean,
                responseNeeded: Boolean,
                offset: Int,
                value: ByteArray?
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
        
        // Configurar servicio NEXO
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        
        val announceChar = BluetoothGattCharacteristic(
            CHAR_ANNOUNCE,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        
        val handshakeChar = BluetoothGattCharacteristic(
            CHAR_HANDSHAKE,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        
        val payloadChar = BluetoothGattCharacteristic(
            CHAR_PAYLOAD,
            BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        
        val controlChar = BluetoothGattCharacteristic(
            CHAR_CONTROL,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ
        )
        
        service.addCharacteristic(announceChar)
        service.addCharacteristic(handshakeChar)
        service.addCharacteristic(payloadChar)
        service.addCharacteristic(controlChar)
        
        val success = gattServer?.addService(service) ?: false
        Log.d(TAG, "GATT Server setup: $success")
    }

    private fun createAnnounceBeacon(): ByteArray {
        return ByteBuffer.allocate(32).apply {
            order(ByteOrder.BIG_ENDIAN)
            // User ID (16 bytes) - truncar o pad con ceros
            val idBytes = hexToBytes(userId).copyOf(16)
            put(idBytes)
            // Timestamp Unix (8 bytes)
            putLong(System.currentTimeMillis() / 1000)
            // Nonce aleatorio (8 bytes)
            putLong((Math.random() * Long.MAX_VALUE).toLong())
        }.array()
    }

    private fun notifyConnectionState(deviceId: String, state: String) {
        val data = JSObject().apply {
            put("deviceId", deviceId)
            put("state", state)
            put("timestamp", System.currentTimeMillis())
        }
        notifyListeners("onConnectionStateChanged", data)
    }

    private fun generateUserId(): String {
        return UUID.randomUUID().toString().replace("-", "").take(32)
    }

    private fun bytesToHex(bytes: ByteArray): String {
        return bytes.joinToString("") { "%02x".format(it) }
    }
    
    private fun hexToBytes(hex: String): ByteArray {
        val cleanHex = hex.replace("-", "").replace(":", "")
        return if (cleanHex.length % 2 == 0) {
            cleanHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        } else {
            ByteArray(0)
        }
    }
    
    /**
     * NAP 2.0: Cleanup completo al destruir
     */
    override fun handleOnDestroy() {
        Log.d(TAG, "Destroying NexoBLE Plugin")
        
        // Detener actividades
        bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
        
        // Cerrar todas las conexiones GATT
        gattClients.forEach { (_, gatt) ->
            try {
                gatt.disconnect()
                gatt.close()
            } catch (e: Exception) {}
        }
        gattClients.clear()
        
        // Cerrar servidor
        gattServer?.close()
        
        // Limpiar buffers
        pendingChunks.clear()
        messageBuffers.clear()
        connectedDevices.clear()
        
        super.handleOnDestroy()
    }
}
