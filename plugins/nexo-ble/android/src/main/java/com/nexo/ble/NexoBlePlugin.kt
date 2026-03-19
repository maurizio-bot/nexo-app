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
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.*
import java.util.concurrent.ConcurrentHashMap

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
        
        // UUIDs NEXO Protocol v1.0
        val SERVICE_UUID = UUID.fromString("a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d")
        val CHAR_ANNOUNCE = UUID.fromString("b4c6d9e3-f2a5-5b8c-ad4e-7f9g2b3c6d8e")
        val CHAR_HANDSHAKE = UUID.fromString("c5d7eaf4-g3b6-6c9d-be5f-8a0h3c4d7e9f")
        val CHAR_PAYLOAD = UUID.fromString("d6e8fbg5-h4c7-7d0e-cf6g-9b1i4d5e8f0g")
        val CHAR_CONTROL = UUID.fromString("e7f9gch6-i5d8-8e1f-dg7h-0c2j5e6f9g1h")
        
        const val MTU_DEFAULT = 512
        const val CHUNK_SIZE = 507 // 512 - 5 bytes header
    }

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var gattServer: BluetoothGattServer? = null
    private var gattClient: BluetoothGatt? = null
    
    private val connectedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val pendingChunks = ConcurrentHashMap<String, MutableList<ByteArray>>()
    private val messageBuffers = ConcurrentHashMap<String, ByteArrayOutputStream>()
    
    private var isAdvertising = false
    private var isScanning = false
    private var advertiseCallback: AdvertiseCallback? = null
    private var scanCallback: ScanCallback? = null
    
    private val handler = Handler(Looper.getMainLooper())
    private var userId: String = ""

    override fun load() {
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
    }

    @PluginMethod
    fun initialize(call: PluginCall) {
        userId = call.getString("userId") ?: generateUserId()
        
        if (bluetoothAdapter == null) {
            call.reject("BLUETOOTH_NOT_SUPPORTED", "Device does not support Bluetooth")
            return
        }
        
        if (!bluetoothAdapter!!.isEnabled) {
            call.reject("BLUETOOTH_DISABLED", "Bluetooth is disabled")
            return
        }
        
        setupGattServer()
        call.resolve(JSObject().put("userId", userId))
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
            call.reject("PERMISSION_DENIED", "Bluetooth advertise permission required")
        }
    }

    private fun startAdvertisingInternal(call: PluginCall) {
        val advertiser = bluetoothAdapter?.bluetoothLeAdvertiser ?: run {
            call.reject("ADVERTISER_UNAVAILABLE")
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
            .build()

        advertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                call.resolve()
            }

            override fun onStartFailure(errorCode: Int) {
                call.reject("ADVERTISE_FAILED", "Error code: $errorCode")
            }
        }

        advertiser.startAdvertising(settings, data, advertiseCallback)
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        isAdvertising = false
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
            call.reject("PERMISSION_DENIED")
        }
    }

    private fun startScanInternal(call: PluginCall) {
        val scanner = bluetoothAdapter?.bluetoothLeScanner ?: run {
            call.reject("SCANNER_UNAVAILABLE")
            return
        }

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(SERVICE_UUID))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
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

        scanner.startScan(listOf(filter), settings, scanCallback)
        isScanning = true
        call.resolve()
    }

    private fun processScanResult(result: ScanResult) {
        val device = result.device
        val rssi = result.rssi
        
        // Filtrar dispositivos lejanos (< -85 dBm)
        if (rssi < -85) return

        val data = JSObject().apply {
            put("id", device.address)
            put("rssi", rssi)
            put("name", device.name ?: "NEXO-${device.address.takeLast(4)}")
            // Extraer User ID del manufacturer data si está disponible
            result.scanRecord?.manufacturerSpecificData?.let { map ->
                if (map.size() > 0) {
                    put("userId", bytesToHex(map.valueAt(0)))
                }
            }
        }
        
        notifyListeners("onPeerDiscovered", data)
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
        isScanning = false
        call.resolve()
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("MISSING_DEVICE_ID")
            return
        }

        val device = bluetoothAdapter?.getRemoteDevice(deviceId) ?: run {
            call.reject("DEVICE_NOT_FOUND")
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
                        connectedDevices.remove(deviceId)
                        notifyConnectionState(deviceId, "disconnected")
                    }
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt?, mtu: Int, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    gatt?.discoverServices()
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
                // Suscribirse a características notify
                gatt?.getService(SERVICE_UUID)?.getCharacteristic(CHAR_ANNOUNCE)?.let { char ->
                    gatt.setCharacteristicNotification(char, true)
                }
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?) {
                characteristic?.value?.let { value ->
                    when (characteristic.uuid) {
                        CHAR_PAYLOAD -> processPayloadChunk(deviceId, value)
                        CHAR_HANDSHAKE -> processHandshake(deviceId, value)
                        CHAR_CONTROL -> processControl(deviceId, value)
                    }
                }
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, gattCallback)
        }
        
        call.resolve()
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("MISSING_DEVICE_ID")
            return
        }
        
        connectedDevices[deviceId]?.let { device ->
            // Encontrar el Gatt y cerrarlo
        }
        
        connectedDevices.remove(deviceId)
        call.resolve()
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("MISSING_DEVICE_ID")
            return
        }
        
        val data = call.getArray("data") ?: run {
            call.reject("MISSING_DATA")
            return
        }

        val bytes = ByteArray(data.length())
        for (i in 0 until data.length()) {
            bytes[i] = (data.getInt(i) and 0xFF).toByte()
        }

        sendChunkedMessage(deviceId, bytes)
        call.resolve()
    }

    private fun sendChunkedMessage(deviceId: String, data: ByteArray) {
        val chunks = (data.size + CHUNK_SIZE - 1) / CHUNK_SIZE
        val messageId = (Math.random() * 65535).toInt()
        
        data.toList().chunked(CHUNK_SIZE).forEachIndexed { index, chunk ->
            val buffer = ByteBuffer.allocate(5 + chunk.size).apply {
                order(ByteOrder.BIG_ENDIAN)
                put(0) // Flags: chunked
                putShort(messageId.toShort())
                putShort(index.toShort())
                putShort(chunks.toShort())
                chunk.forEach { put(it) }
            }
            
            writeCharacteristic(deviceId, CHAR_PAYLOAD, buffer.array())
        }
    }

    private fun processPayloadChunk(deviceId: String, data: ByteArray) {
        if (data.size < 5) return
        
        val buffer = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN)
        val flags = buffer.get()
        val messageId = buffer.short.toInt() and 0xFFFF
        val chunkIndex = buffer.short.toInt() and 0xFFFF
        val totalChunks = buffer.short.toInt() and 0xFFFF
        
        val payload = data.copyOfRange(7, data.size)
        val key = "$deviceId:$messageId"
        
        if (!pendingChunks.containsKey(key)) {
            pendingChunks[key] = MutableList(totalChunks) { ByteArray(0) }
        }
        
        pendingChunks[key]?.set(chunkIndex, payload)
        
        // Verificar si tenemos todos los chunks
        if (pendingChunks[key]?.all { it.isNotEmpty() } == true) {
            val completeMessage = pendingChunks[key]!!.reduce { acc, bytes -> acc + bytes }
            pendingChunks.remove(key)
            
            val eventData = JSObject().apply {
                put("deviceId", deviceId)
                put("data", JSONArray(completeMessage.map { it.toInt() and 0xFF }))
            }
            notifyListeners("onMessageReceived", eventData)
        }
    }

    private fun processHandshake(deviceId: String, data: ByteArray) {
        // Implementar lógica X3DH aquí
        val eventData = JSObject().apply {
            put("deviceId", deviceId)
            put("type", data[0].toInt())
            put("payload", JSONArray(data.map { it.toInt() and 0xFF }))
        }
        notifyListeners("onHandshakeReceived", eventData)
    }

    private fun processControl(deviceId: String, data: ByteArray) {
        // ACK, MTU requests, etc.
    }

    private fun writeCharacteristic(deviceId: String, uuid: UUID, data: ByteArray) {
        // Implementar escritura GATT
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
                device: BluetoothDevice?,
                requestId: Int,
                offset: Int,
                characteristic: BluetoothGattCharacteristic?
            ) {
                if (characteristic?.uuid == CHAR_ANNOUNCE) {
                    // Responder con beacon de presencia
                    val response = createAnnounceBeacon()
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, response)
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
                value?.let {
                    when (characteristic?.uuid) {
                        CHAR_PAYLOAD -> device?.address?.let { addr -> processPayloadChunk(addr, it) }
                        CHAR_HANDSHAKE -> device?.address?.let { addr -> processHandshake(addr, it) }
                    }
                }
                
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
                }
            }
        }

        gattServer = bluetoothManager?.openGattServer(context, serverCallback)
        
        // Añadir servicio NEXO
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
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_WRITE or BluetoothGattCharacteristic.PERMISSION_READ
        )
        
        service.addCharacteristic(announceChar)
        service.addCharacteristic(handshakeChar)
        service.addCharacteristic(payloadChar)
        service.addCharacteristic(controlChar)
        
        gattServer?.addService(service)
    }

    private fun createAnnounceBeacon(): ByteArray {
        val buffer = ByteBuffer.allocate(32).apply {
            order(ByteOrder.BIG_ENDIAN)
            // User ID (16 bytes)
            put(hexToBytes(userId))
            // Timestamp (8 bytes)
            putLong(System.currentTimeMillis() / 1000)
            // Nonce (8 bytes)
            putLong((Math.random() * Long.MAX_VALUE).toLong())
        }
        return buffer.array()
    }

    private fun notifyConnectionState(deviceId: String, state: String) {
        val data = JSObject().apply {
            put("deviceId", deviceId)
            put("state", state)
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
        return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }
    
    override fun handleOnDestroy() {
        stopAdvertising(null)
        stopScan(null)
        gattServer?.close()
        super.handleOnDestroy()
    }
}
