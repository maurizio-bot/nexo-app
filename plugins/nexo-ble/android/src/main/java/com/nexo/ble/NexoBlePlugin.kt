package com.nexo.ble

import android.app.Activity
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.nexo.ble.model.NexoGattService
import org.json.JSONArray
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
        val SERVICE_UUID = NexoGattService.SERVICE_UUID
        val CHAR_ANNOUNCE = NexoGattService.ANNOUNCE_CHAR_UUID
        val CHAR_HANDSHAKE = NexoGattService.HANDSHAKE_CHAR_UUID
        val CHAR_PAYLOAD = NexoGattService.PAYLOAD_CHAR_UUID
        val CHAR_CONTROL = NexoGattService.CONTROL_CHAR_UUID
        
        const val MTU_DEFAULT = 512
        const val CHUNK_SIZE = 507
        const val ERR_BLUETOOTH_NOT_SUPPORTED = "BLE_001"
        const val ERR_BLUETOOTH_DISABLED = "BLE_002"
        const val ERR_PERMISSION_DENIED = "BLE_003"
        const val ERR_ADVERTISE_FAILED = "BLE_004"
        const val ERR_SCAN_FAILED = "BLE_005"
        const val ERR_DEVICE_NOT_FOUND = "BLE_006"
        const val ERR_CONNECTION_FAILED = "BLE_007"
        const val ERR_MESSAGE_TOO_LARGE = "BLE_008"
        const val ERR_INVALID_PARAMS = "BLE_019"
        const val ERR_NOT_CONNECTED = "BLE_011"
        
        const val REQUEST_ENABLE_BT = 1001
    }

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var gattServer: BluetoothGattServer? = null
    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val connectedDevices = ConcurrentHashMap<String, BluetoothDevice>()
    private val pendingChunks = ConcurrentHashMap<String, MutableMap<Int, ByteArray>>()
    private val messageBuffers = ConcurrentHashMap<String, ByteArrayOutputStream>()
    private var isAdvertising = false
    private var isScanning = false
    private var advertiseCallback: AdvertiseCallback? = null
    private var scanCallback: ScanCallback? = null
    private val handler = Handler(Looper.getMainLooper())
    private var userId: String = ""
    private val connectionCounter = AtomicInteger(0)
    private var pendingInitializeCall: PluginCall? = null

    // ✅ FIX CRÍTICO: No obtener adapter en load(), esperar a initialize()
    override fun load() {
        Log.d(TAG, "NexoBLE Plugin v2.0-NAP loaded (waiting for permissions)")
    }

    /**
     * ✅ FIX: Obtener adapter solo cuando tenemos permisos verificados
     */
    private fun initializeAdapter(): Boolean {
        if (bluetoothManager == null) {
            bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        }
        
        // En Android 12+, necesitamos BLUETOOTH_CONNECT para acceder al adapter
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) 
                != PackageManager.PERMISSION_GRANTED) {
                Log.e(TAG, "BLUETOOTH_CONNECT permission not granted")
                return false
            }
        }
        
        bluetoothAdapter = bluetoothManager?.adapter
        return bluetoothAdapter != null
    }

    /**
     * FIX CRÍTICO [NORDIC_010]: Método requerido por nordic_mesh.js
     * ✅ FIX: Ahora verifica permisos antes de acceder al adapter
     */
    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        if (!checkAndRequestPermissions(call, "isBtEnabledCallback")) {
            return
        }
        
        val result = JSObject()
        val adapter = bluetoothAdapter
        val state = adapter?.state ?: BluetoothAdapter.STATE_OFF
        
        result.put("enabled", adapter?.isEnabled == true)
        result.put("state", state)
        result.put("stateName", when(state) {
            BluetoothAdapter.STATE_OFF -> "OFF"
            BluetoothAdapter.STATE_ON -> "ON"
            BluetoothAdapter.STATE_TURNING_ON -> "TURNING_ON"
            BluetoothAdapter.STATE_TURNING_OFF -> "TURNING_OFF"
            else -> "UNKNOWN"
        } as Any)
        
        Log.d(TAG, "isBluetoothEnabled: enabled=${adapter?.isEnabled}, state=$state")
        call.resolve(result)
    }

    @PermissionCallback
    private fun isBtEnabledCallback(call: PluginCall) {
        if (hasRequiredPermissions()) {
            initializeAdapter()
            isBluetoothEnabled(call)
        } else {
            call.reject(ERR_PERMISSION_DENIED, "Bluetooth permissions required")
        }
    }

    /**
     * ✅ FIX: Manejo robusto de permisos y estado
     */
    @PluginMethod
    fun initialize(call: PluginCall) {
        userId = call.getString("userId") ?: generateUserId()
        
        // Primero verificar permisos
        if (!checkAndRequestPermissions(call, "initializePermissionCallback")) {
            pendingInitializeCall = call
            return
        }
        
        performInitialization(call)
    }

    @PermissionCallback
    private fun initializePermissionCallback(call: PluginCall) {
        if (hasRequiredPermissions()) {
            performInitialization(call)
        } else {
            call.reject(ERR_PERMISSION_DENIED, "Bluetooth permissions required for initialization")
        }
    }

    private fun performInitialization(call: PluginCall) {
        // Ahora sí inicializamos el adapter con permisos concedidos
        if (!initializeAdapter()) {
            call.reject(ERR_BLUETOOTH_NOT_SUPPORTED, "Cannot access Bluetooth adapter (permissions denied or not supported)")
            return
        }
        
        val adapter = bluetoothAdapter
        if (adapter == null) {
            call.reject(ERR_BLUETOOTH_NOT_SUPPORTED, "Device does not support Bluetooth")
            return
        }
        
        val initialState = adapter.state
        Log.d(TAG, "Initialize: BT state=$initialState (10=OFF, 11=TURNING_ON, 12=ON)")
        
        if (initialState == BluetoothAdapter.STATE_OFF) {
            // ✅ FIX: En lugar de rechazar, solicitar activación
            pendingInitializeCall = call
            requestBluetoothActivation()
            return
        }
        
        if (initialState == BluetoothAdapter.STATE_TURNING_ON) {
            Log.d(TAG, "Waiting for BT to turn on...")
            handler.postDelayed({
                performInitialization(call)
            }, 500)
            return
        }
        
        if (initialState != BluetoothAdapter.STATE_ON) {
            call.reject(ERR_BLUETOOTH_DISABLED, "Bluetooth is not available (state: $initialState)")
            return
        }
        
        try {
            setupGattServer()
            val result = JSObject()
            result.put("userId", userId as Any)
            result.put("status", "initialized" as Any)
            result.put("version", "2.0-NAP" as Any)
            result.put("bluetoothState", adapter.state as Any)
            result.put("native", true as Any) // ✅ FIX: Indicar que es nativo real
            call.resolve(result)
            Log.d(TAG, "Initialized successfully with userId: $userId")
        } catch (e: Exception) {
            Log.e(TAG, "Initialize failed", e)
            call.reject("INIT_FAILED", e.message)
        }
    }

    /**
     * ✅ FIX: Solicitar activación de Bluetooth al sistema
     */
    private fun requestBluetoothActivation() {
        val enableBtIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
        try {
            startActivityForResult(null, enableBtIntent, REQUEST_ENABLE_BT)
        } catch (e: Exception) {
            Log.e(TAG, "Cannot request BT activation", e)
            pendingInitializeCall?.reject(ERR_BLUETOOTH_DISABLED, "Cannot activate Bluetooth: ${e.message}")
            pendingInitializeCall = null
        }
    }

    override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.handleOnActivityResult(requestCode, resultCode, data)
        
        if (requestCode == REQUEST_ENABLE_BT) {
            if (resultCode == Activity.RESULT_OK) {
                Log.d(TAG, "Bluetooth enabled by user")
                handler.postDelayed({
                    pendingInitializeCall?.let { call ->
                        performInitialization(call)
                        pendingInitializeCall = null
                    }
                }, 500) // Esperar a que se estabilice
            } else {
                Log.w(TAG, "User denied Bluetooth activation")
                pendingInitializeCall?.reject(ERR_BLUETOOTH_DISABLED, "Bluetooth activation denied by user")
                pendingInitializeCall = null
            }
        }
    }

    /**
     * ✅ FIX: Verificación centralizada de permisos
     */
    private fun checkAndRequestPermissions(call: PluginCall, callback: String): Boolean {
        if (hasRequiredPermissions()) {
            return true
        }
        
        // Solicitar todos los permisos necesarios
        val permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            arrayOf(
                android.Manifest.permission.BLUETOOTH_SCAN,
                android.Manifest.permission.BLUETOOTH_CONNECT,
                android.Manifest.permission.BLUETOOTH_ADVERTISE
            )
        } else {
            arrayOf(
                android.Manifest.permission.BLUETOOTH,
                android.Manifest.permission.BLUETOOTH_ADMIN,
                android.Manifest.permission.ACCESS_FINE_LOCATION
            )
        }
        
        requestPermissionForAliases(permissions, call, callback)
        return false
    }

    private fun hasRequiredPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            hasPermission("bluetoothScan") && hasPermission("bluetoothConnect") && hasPermission("bluetoothAdvertise")
        } else {
            hasPermission("location")
        }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        if (!ensureInitialized(call)) return
        
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
            .addManufacturerData(0x4E58, hexToBytes(userId.take(8)))
            .build()

        advertiseCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                Log.d(TAG, "Advertising started")
                val result = JSObject()
                result.put("active", true as Any)
                call.resolve(result)
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
        if (!ensureInitialized(call)) return
        bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        isAdvertising = false
        advertiseCallback = null
        call.resolve()
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (!ensureInitialized(call)) return
        
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
            call.reject("SCANNER_UNAVAILABLE", "Bluetooth LE Scanner not available")
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
                Log.e(TAG, "Scan failed: $errorCode")
                val eventData = JSObject()
                eventData.put("error", errorCode as Any)
                notifyListeners("onScanFailed", eventData)
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
        
        if (rssi < -85) return

        val manufacturerData = result.scanRecord?.manufacturerSpecificData
        val userIdFromData = if (manufacturerData != null && manufacturerData.size() > 0) {
            bytesToHex(manufacturerData.valueAt(0))
        } else {
            null
        }

        val data = JSObject()
        data.put("id", device.address as Any)
        data.put("address", device.address as Any)
        data.put("rssi", rssi as Any)
        data.put("name", (device.name ?: "NEXO-${device.address.takeLast(4)}") as Any)
        data.put("userId", (userIdFromData ?: "") as Any)
        data.put("timestamp", System.currentTimeMillis() as Any)
        
        Log.d(TAG, "Peer discovered: ${device.address} ($rssi dBm)")
        notifyListeners("onPeerDiscovered", data)
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        if (!ensureInitialized(call)) return
        bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
        isScanning = false
        scanCallback = null
        call.resolve()
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        if (!ensureInitialized(call)) return
        
        val deviceId = call.getString("deviceId") ?: run {
            call.reject(ERR_INVALID_PARAMS, "deviceId is required")
            return
        }

        if (!deviceId.matches(Regex("([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}"))) {
            call.reject(ERR_INVALID_PARAMS, "Invalid device MAC address format")
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
                    gatt?.getService(SERVICE_UUID)?.getCharacteristic(CHAR_PAYLOAD)?.let { char ->
                        val descriptor = char.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"))
                        descriptor?.let {
                            it.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            gatt.writeDescriptor(it)
                        }
                        gatt.setCharacteristicNotification(char, true)
                    }
                    
                    val servicesArray = JSONArray()
                    gatt?.services?.forEach { service ->
                        servicesArray.put(service.uuid.toString())
                    }
                    
                    val eventData = JSObject()
                    eventData.put("deviceId", deviceId as Any)
                    eventData.put("services", servicesArray as Any)
                    notifyListeners("onServicesDiscovered", eventData)
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
        }

        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, gattCallback)
        }
        
        gattClients[deviceId] = gatt
        val result = JSObject()
        result.put("deviceId", deviceId as Any)
        call.resolve(result)
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val list = JSONArray()
        connectedDevices.keys.forEach { addr ->
            val deviceObj = JSObject()
            deviceObj.put("id", addr as Any)
            deviceObj.put("address", addr as Any)
            deviceObj.put("connected", true as Any)
            list.put(deviceObj)
        }
        val result = JSObject()
        result.put("devices", list as Any)
        call.resolve(result)
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject(ERR_INVALID_PARAMS, "deviceId is required")
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

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        if (!ensureInitialized(call)) return
        
        val deviceId = call.getString("deviceId") ?: run {
            call.reject(ERR_INVALID_PARAMS, "deviceId is required")
            return
        }
        
        if (!connectedDevices.containsKey(deviceId)) {
            call.reject(ERR_NOT_CONNECTED, "Device not connected")
            return
        }
        
        val dataArray = call.getArray("data") ?: run {
            call.reject(ERR_INVALID_PARAMS, "data array is required")
            return
        }

        val bytes = try {
            ByteArray(dataArray.length()) { i ->
                val value = dataArray.getInt(i)
                if (value < 0 || value > 255) {
                    throw IllegalArgumentException("Byte value out of range at index $i: $value")
                }
                (value and 0xFF).toByte()
            }
        } catch (e: Exception) {
            call.reject(ERR_INVALID_PARAMS, "Invalid data array: ${e.message}")
            return
        }

        if (bytes.size > 65535) {
            call.reject(ERR_MESSAGE_TOO_LARGE, "Message too large (max 64KB)")
            return
        }

        try {
            sendChunkedMessage(deviceId, bytes)
            val result = JSObject()
            result.put("success", true as Any)
            result.put("bytesSent", bytes.size as Any)
            result.put("chunks", ((bytes.size + CHUNK_SIZE - 1) / CHUNK_SIZE) as Any)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("SEND_FAILED", e.message)
        }
    }

    private fun sendChunkedMessage(deviceId: String, data: ByteArray) {
        val totalSize = data.size
        val chunks = (totalSize + CHUNK_SIZE - 1) / CHUNK_SIZE
        val messageId = connectionCounter.incrementAndGet() and 0xFFFF
        
        Log.d(TAG, "Sending $totalSize bytes in $chunks chunks (msgId: $messageId)")
        
        val chunkedData = data.toList().chunked(CHUNK_SIZE)
        for (index in chunkedData.indices) {
            val chunk = chunkedData[index]
            val isLast = index == chunks - 1
            val flags = if (isLast) 0x03 else 0x01
            
            val buffer = ByteBuffer.allocate(7 + chunk.size)
            buffer.order(ByteOrder.BIG_ENDIAN)
            buffer.put(flags.toByte())
            buffer.putShort(messageId.toShort())
            buffer.putShort(index.toShort())
            buffer.putShort(chunks.toShort())
            chunk.forEach { byte -> buffer.put(byte) }
            
            writeCharacteristic(deviceId, CHAR_PAYLOAD, buffer.array())
            
            if (!isLast) {
                Thread.sleep(10)
            }
        }
    }

    private fun processPayloadChunk(deviceId: String, data: ByteArray) {
        if (data.size < 7) {
            Log.w(TAG, "Chunk too small: ${data.size} bytes")
            return
        }
        
        val buffer = ByteBuffer.wrap(data)
        buffer.order(ByteOrder.BIG_ENDIAN)
        val flags = buffer.get().toInt() and 0xFF
        val messageId = buffer.short.toInt() and 0xFFFF
        val chunkIndex = buffer.short.toInt() and 0xFFFF
        val totalChunks = buffer.short.toInt() and 0xFFFF
        
        val isLast = (flags and 0x02) != 0
        val payload = data.copyOfRange(7, data.size)
        
        val key = "$deviceId:$messageId"
        
        if (!pendingChunks.containsKey(key)) {
            pendingChunks[key] = ConcurrentHashMap()
        }
        
        pendingChunks[key]?.put(chunkIndex, payload)
        val receivedCount = pendingChunks[key]?.size ?: 0
        
        Log.d(TAG, "Chunk $chunkIndex/$totalChunks for msg $messageId (received: $receivedCount)")
        
        if (receivedCount == totalChunks) {
            val chunks = pendingChunks[key]
            val completeMessage = ByteArrayOutputStream()
            
            for (i in 0 until totalChunks) {
                chunks?.get(i)?.let { completeMessage.write(it) }
            }
            
            pendingChunks.remove(key)
            
            val result = completeMessage.toByteArray()
            Log.d(TAG, "Message complete: ${result.size} bytes")
            
            val dataArray = JSONArray()
            for (i in result.indices) {
                dataArray.put(result[i].toInt() and 0xFF)
            }
            
            val eventData = JSObject()
            eventData.put("deviceId", deviceId as Any)
            eventData.put("from", deviceId as Any)
            eventData.put("messageId", messageId as Any)
            eventData.put("data", dataArray as Any)
            eventData.put("size", result.size as Any)
            eventData.put("timestamp", System.currentTimeMillis() as Any)
            notifyListeners("onMessageReceived", eventData)
        }
    }

    private fun processHandshake(deviceId: String, data: ByteArray) {
        Log.d(TAG, "Handshake from $deviceId: ${data.size} bytes")
        
        val payloadArray = JSONArray()
        for (i in data.indices) {
            payloadArray.put(data[i].toInt() and 0xFF)
        }
        
        val eventData = JSObject()
        eventData.put("deviceId", deviceId as Any)
        eventData.put("type", (data[0].toInt() and 0xFF) as Any)
        eventData.put("payload", payloadArray as Any)
        notifyListeners("onHandshakeReceived", eventData)
    }

    private fun processControl(deviceId: String, data: ByteArray) {
        if (data.isNotEmpty() && data[0].toInt() == 0x04) {
            writeCharacteristic(deviceId, CHAR_CONTROL, byteArrayOf(0x05))
        }
    }

    private fun writeCharacteristic(deviceId: String, uuid: UUID, data: ByteArray): Boolean {
        val gatt = gattClients[deviceId] ?: return false
        
        val characteristic = gatt.getService(SERVICE_UUID)?.getCharacteristic(uuid) ?: run {
            Log.e(TAG, "Characteristic $uuid not found for $deviceId")
            return false
        }
        
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                val result = gatt.writeCharacteristic(characteristic, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                result == BluetoothGatt.GATT_SUCCESS
            } catch (e: Exception) {
                false
            }
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
        val buffer = ByteBuffer.allocate(32)
        buffer.order(ByteOrder.BIG_ENDIAN)
        val idBytes = hexToBytes(userId).copyOf(16)
        buffer.put(idBytes)
        buffer.putLong(System.currentTimeMillis() / 1000)
        buffer.putLong((Math.random() * Long.MAX_VALUE).toLong())
        return buffer.array()
    }

    private fun notifyConnectionState(deviceId: String, state: String) {
        val data = JSObject()
        data.put("deviceId", deviceId as Any)
        data.put("state", state as Any)
        data.put("timestamp", System.currentTimeMillis() as Any)
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
     * ✅ FIX: Verificar que el plugin esté inicializado antes de operaciones
     */
    private fun ensureInitialized(call: PluginCall): Boolean {
        if (bluetoothAdapter == null) {
            call.reject(ERR_BLUETOOTH_NOT_SUPPORTED, "Bluetooth not initialized. Call initialize() first.")
            return false
        }
        if (!bluetoothAdapter!!.isEnabled) {
            call.reject(ERR_BLUETOOTH_DISABLED, "Bluetooth is disabled")
            return false
        }
        return true
    }
    
    override fun handleOnDestroy() {
        Log.d(TAG, "Destroying NexoBLE Plugin - NAP 2.0 Cleanup")
        
        bluetoothAdapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
        
        gattClients.values.forEach { gatt ->
            try {
                gatt.disconnect()
                gatt.close()
            } catch (e: Exception) {}
        }
        gattClients.clear()
        
        gattServer?.close()
        pendingChunks.clear()
        messageBuffers.clear()
        connectedDevices.clear()
        
        super.handleOnDestroy()
    }
}

