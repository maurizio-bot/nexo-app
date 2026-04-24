package com.nexo.ble

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.*
import android.content.pm.PackageManager
import android.os.*
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.*
import com.getcapacitor.annotation.ActivityCallback
import org.json.JSONArray
import org.json.JSONObject
import java.util.*
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.schedule

/**
 * NexoBlePlugin.kt v5.0.0-ARCH
 * Capacitor BLE Plugin - Robust GATT Server + Client
 * Anti-race: synchronized GATT ops | LRU dedup | Auto-restart server | Forced disconnect 2s
 * Based on Nordic Android-BLE-Library v2.11.0 patterns
 */

@CapacitorPlugin(name = "NexoBLE")
class NexoBlePlugin : Plugin() {

    companion object {
        private const val TAG = "NexoBLE"
        private const val NEXO_SERVICE_UUID = "0000feed-0000-1000-8000-00805f9b34fb"
        private const val NEXO_CHAR_RX = "0000feed-0001-1000-8000-00805f9b34fb"
        private const val NEXO_CHAR_TX = "0000feed-0002-1000-8000-00805f9b34fb"
        private const val NEXO_CHAR_PEER = "0000feed-0003-1000-8000-00805f9b34fb"
        private const val CCCD_UUID = "00002902-0000-1000-8000-00805f9b34fb"
        private const val GATT_TIMEOUT_MS = 10000L
        private const val RECONNECT_DELAY_MS = 2000L
        private const val MAX_RECONNECT_ATTEMPTS = 5
        private const val SERVER_RESTART_DELAY_MS = 3000L
        private const val FORCED_DISCONNECT_DELAY_MS = 2000L
        private const val MESSAGE_DEDUP_MAX = 1000
        private const val BLE_PERMISSIONS_REQUEST_CODE = 9001
    }

    private var bluetoothAdapter: BluetoothAdapter? = null
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothLeScanner: BluetoothLeScanner? = null
    private var bluetoothLeAdvertiser: BluetoothLeAdvertiser? = null

    private var gattServer: BluetoothGattServer? = null
    private val serverReady = AtomicBoolean(false)
    private var serverRestartScheduled = AtomicBoolean(false)

    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val gattOperationQueues = ConcurrentHashMap<String, BlockingQueue<GattOperation>>()
    private val gattOperationWorkers = ConcurrentHashMap<String, Thread>()
    private val deviceConnectionStates = ConcurrentHashMap<String, ConnectionState>()

    private var rxCharacteristic: BluetoothGattCharacteristic? = null
    private var txCharacteristic: BluetoothGattCharacteristic? = null
    private var peerInfoCharacteristic: BluetoothGattCharacteristic? = null

    private var isScanning = AtomicBoolean(false)
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result ?: return
            val device = result.device
            val name = result.scanRecord?.deviceName ?: device.name ?: "NEXO Device"
            val rssi = result.rssi
            val data = JSObject().apply {
                put("deviceId", device.address)
                put("name", name)
                put("rssi", rssi)
            }
            notifyListeners("onDeviceFound", data)
        }
        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "Scan failed: $errorCode")
            notifyListeners("onScanFailed", JSObject().put("errorCode", errorCode))
            isScanning.set(false)
        }
    }

    private var isAdvertising = AtomicBoolean(false)
    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            Log.i(TAG, "Advertising started")
            isAdvertising.set(true)
            notifyListeners("onAdvertiseStarted", JSObject())
        }
        override fun onStartFailure(errorCode: Int) {
            Log.e(TAG, "Advertising failed: $errorCode")
            isAdvertising.set(false)
            notifyListeners("onAdvertiseFailed", JSObject().put("errorCode", errorCode))
        }
    }

    private val messageDedupLru = Collections.synchronizedMap(
        object : LinkedHashMap<String, Long>(MESSAGE_DEDUP_MAX, 0.75f, true) {
            override fun removeEldestEntry(eldest: Map.Entry<String, Long>?): Boolean {
                return size > MESSAGE_DEDUP_MAX
            }
        }
    )

    private var localUserId: String = ""
    private var localUserName: String = "NEXO User"

    private var bleService: BleServiceInterface? = null
    private var serviceBound = AtomicBoolean(false)
    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            bleService = (service as? BleServiceInterface.LocalBinder)?.getService()
            serviceBound.set(true)
            Log.i(TAG, "BleService bound")
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            bleService = null
            serviceBound.set(false)
            Log.w(TAG, "BleService unbound")
        }
    }

    override fun load() {
        super.load()
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        bluetoothLeScanner = bluetoothAdapter?.bluetoothLeScanner
        bluetoothLeAdvertiser = bluetoothAdapter?.bluetoothLeAdvertiser
        bindBleService()
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        stopAdvertisingInternal()
        stopScanInternal()
        disconnectAllDevices()
        closeGattServer()
        if (serviceBound.get()) {
            context.unbindService(serviceConnection)
        }
    }

    private fun bindBleService() {
        try {
            val intent = Intent(context, BleService::class.java)
            context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
        } catch (e: Exception) {
            Log.w(TAG, "BleService not available, running without foreground service: ${e.message}")
        }
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        localUserId = call.getString("userId", "")
        localUserName = call.getString("userName", "NEXO User")
        if (!checkBluetoothAdapter(call)) return
        try {
            startGattServer()
            val ret = JSObject()
            ret.put("success", true)
            ret.put("serverReady", serverReady.get())
            call.resolve(ret)
        } catch (e: Exception) {
            Log.e(TAG, "initializeBLE error", e)
            call.reject("Failed to initialize BLE: ${e.message}")
        }
    }

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        val ret = JSObject()
        val adapter = bluetoothAdapter
        val enabled = adapter?.isEnabled == true
        ret.put("enabled", enabled)
        ret.put("canAdvertise", enabled && bluetoothLeAdvertiser != null)
        ret.put("canScan", enabled && bluetoothLeScanner != null)
        ret.put("serverReady", serverReady.get())
        call.resolve(ret)
    }

    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val ret = JSObject()
        ret.put("isAdvertising", isAdvertising.get())
        call.resolve(ret)
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        if (!checkBluetoothAdapter(call)) return
        if (!checkPermission(Manifest.permission.BLUETOOTH_ADVERTISE, call)) return
        try {
            startAdvertisingInternal()
            call.resolve(JSObject().put("success", true))
        } catch (e: Exception) {
            call.reject("Advertising failed: ${e.message}")
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        stopAdvertisingInternal()
        call.resolve(JSObject().put("success", true))
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (!checkBluetoothAdapter(call)) return
        if (!checkPermission(Manifest.permission.BLUETOOTH_SCAN, call)) return
        if (isScanning.get()) {
            call.resolve(JSObject().put("success", true))
            return
        }
        try {
            val filters = listOf<ScanFilter>()
            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build()
            bluetoothLeScanner?.startScan(filters, settings, scanCallback)
            isScanning.set(true)
            call.resolve(JSObject().put("success", true))
        } catch (e: Exception) {
            Log.e(TAG, "startScan error", e)
            call.reject("Scan failed: ${e.message}")
        }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        stopScanInternal()
        call.resolve(JSObject().put("success", true))
    }

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("deviceId required"); return
        }
        if (!checkBluetoothAdapter(call)) return
        if (!checkPermission(Manifest.permission.BLUETOOTH_CONNECT, call)) return
        val device = bluetoothAdapter?.getRemoteDevice(deviceId)
        if (device == null) {
            call.reject("Device not found")
            return
        }
        val currentState = deviceConnectionStates[deviceId]
        if (currentState == ConnectionState.CONNECTING || currentState == ConnectionState.READY) {
            val ret = JSObject()
            ret.put("connected", true)
            ret.put("alreadyConnected", true)
            call.resolve(ret)
            return
        }
        deviceConnectionStates[deviceId] = ConnectionState.CONNECTING
        val attempt = call.getInt("attempt", 0)
        try {
            connectGatt(device)
            val ret = JSObject()
            ret.put("connected", true)
            ret.put("alreadyConnected", false)
            ret.put("attempt", attempt)
            call.resolve(ret)
        } catch (e: Exception) {
            deviceConnectionStates[deviceId] = ConnectionState.ERROR
            notifyListeners("onConnectionFailed", JSObject().apply {
                put("deviceId", deviceId)
                put("reason", e.message)
                put("attempt", attempt)
                put("recoverable", true)
                put("maxAttempts", MAX_RECONNECT_ATTEMPTS)
            })
            call.reject("Connection failed: ${e.message}")
        }
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("deviceId required"); return
        }
        disconnectDeviceInternal(deviceId)
        call.resolve(JSObject().put("success", true))
    }

    @PluginMethod
    fun forceReconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("deviceId required"); return
        }
        disconnectDeviceInternal(deviceId)
        Handler(Looper.getMainLooper()).postDelayed({
            val device = bluetoothAdapter?.getRemoteDevice(deviceId)
            if (device != null) {
                connectGatt(device)
            }
        }, RECONNECT_DELAY_MS)
        call.resolve(JSObject().put("success", true))
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("deviceId required"); return
        }
        val message = call.getString("message") ?: run {
            call.reject("message required"); return
        }
        if (!serverReady.get()) {
            call.reject("GATT server not ready")
            return
        }
        try {
            val payload = JSONObject().apply {
                put("messageId", UUID.randomUUID().toString())
                put("senderName", localUserName)
                put("content", message)
                put("timestamp", System.currentTimeMillis())
            }.toString()
            val op = GattOperation.Write(deviceId, NEXO_CHAR_TX, payload.toByteArray())
            queueGattOperation(deviceId, op)
            call.resolve(JSObject().put("success", true))
        } catch (e: Exception) {
            Log.e(TAG, "sendMessage error", e)
            call.reject("Send failed: ${e.message}")
        }
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val devices = JSONArray()
        gattClients.forEach { (id, _) ->
            val state = deviceConnectionStates[id]
            val obj = JSObject()
            obj.put("id", id)
            obj.put("address", id)
            obj.put("state", state?.name ?: "UNKNOWN")
            devices.put(obj)
        }
        val ret = JSObject()
        ret.put("devices", devices)
        call.resolve(ret)
    }

    @PluginMethod
    fun getLocalDeviceInfo(call: PluginCall) {
        val ret = JSObject()
        ret.put("deviceName", bluetoothAdapter?.name ?: "NEXO Device")
        ret.put("deviceAddress", bluetoothAdapter?.address ?: "")
        ret.put("userId", localUserId)
        ret.put("userName", localUserName)
        call.resolve(ret)
    }

    @PluginMethod
    fun checkBLEStatus(call: PluginCall) {
        val ret = JSObject()
        val scanPerm = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        val connectPerm = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        val advertisePerm = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
        val locationPerm = if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        } else true
        ret.put("scanGranted", scanPerm)
        ret.put("connectGranted", connectPerm)
        ret.put("advertiseGranted", advertisePerm)
        ret.put("locationGranted", locationPerm)
        ret.put("allGranted", scanPerm && connectPerm && advertisePerm && locationPerm)
        ret.put("isPermanentlyDenied", !scanPerm && !ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.BLUETOOTH_SCAN))
        call.resolve(ret)
    }

    @PluginMethod
    fun requestPermissions(call: PluginCall) {
        val permissions = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.BLUETOOTH_SCAN)
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
            permissions.add(Manifest.permission.BLUETOOTH_ADVERTISE)
        }
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        requestPermissionForAliases(permissions.toTypedArray(), call, "permissionsCallback")
    }

    @PermissionCallback
    fun permissionsCallback(call: PluginCall) {
        checkBLEStatus(call)
    }

    @Synchronized
    private fun startGattServer() {
        if (serverReady.get() && gattServer != null) return
        val manager = bluetoothManager ?: return
        val service = BluetoothGattService(
            UUID.fromString(NEXO_SERVICE_UUID),
            BluetoothGattService.SERVICE_TYPE_PRIMARY
        )
        rxCharacteristic = BluetoothGattCharacteristic(
            UUID.fromString(NEXO_CHAR_RX),
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        txCharacteristic = BluetoothGattCharacteristic(
            UUID.fromString(NEXO_CHAR_TX),
            BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ
        ).apply {
            val cccd = BluetoothGattDescriptor(
                UUID.fromString(CCCD_UUID),
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
            cccd.value = BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            addDescriptor(cccd)
        }
        peerInfoCharacteristic = BluetoothGattCharacteristic(
            UUID.fromString(NEXO_CHAR_PEER),
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        ).apply {
            val cccd = BluetoothGattDescriptor(
                UUID.fromString(CCCD_UUID),
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            )
            addDescriptor(cccd)
        }
        service.addCharacteristic(rxCharacteristic)
        service.addCharacteristic(txCharacteristic)
        service.addCharacteristic(peerInfoCharacteristic)
        gattServer = manager.openGattServer(context, gattServerCallback)
        gattServer?.addService(service)
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice?, status: Int, newState: Int) {
            device ?: return
            val id = device.address
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "Server connection from $id")
                    deviceConnectionStates[id] = ConnectionState.CONNECTED
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceId", id)
                        put("name", device.name ?: "NEXO Peer")
                        put("direction", "incoming")
                        put("servicesReady", true)
                    })
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "Server disconnection from $id")
                    deviceConnectionStates[id] = ConnectionState.DISCONNECTED
                    notifyListeners("onDeviceDisconnected", JSObject().apply {
                        put("deviceId", id)
                        put("reason", "Server disconnected")
                    })
                }
            }
        }
        override fun onServiceAdded(status: Int, service: BluetoothGattService?) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                serverReady.set(true)
                Log.i(TAG, "GATT server ready")
                notifyListeners("onServerReady", JSObject().put("ready", true))
            } else {
                Log.e(TAG, "Failed to add service: $status")
                scheduleServerRestart()
            }
        }
        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice?, requestId: Int, characteristic: BluetoothGattCharacteristic?,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            device ?: return
            val id = device.address
            val data = value ?: return
            if (characteristic?.uuid.toString().equals(NEXO_CHAR_RX, ignoreCase = true)) {
                val payload = String(data, Charsets.UTF_8)
                Log.d(TAG, "RX from $id: $payload")
                val json = try { JSONObject(payload) } catch (e: Exception) { null }
                val messageId = json?.optString("messageId")
                if (messageId != null && messageId.isNotEmpty()) {
                    val now = System.currentTimeMillis()
                    synchronized(messageDedupLru) {
                        if (messageDedupLru.containsKey(messageId)) {
                            Log.d(TAG, "Duplicate message dropped: $messageId")
                            if (responseNeeded) gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
                            return
                        }
                        messageDedupLru[messageId] = now
                    }
                }
                notifyListeners("onPayloadReceived", JSObject().apply {
                    put("deviceId", id)
                    put("data", payload)
                    put("source", "gatt_server")
                    put("timestamp", System.currentTimeMillis())
                })
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
                }
            }
        }
        override fun onDescriptorWriteRequest(
            device: BluetoothDevice?, requestId: Int, descriptor: BluetoothGattDescriptor?,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?
        ) {
            device ?: return
            if (descriptor?.uuid.toString().equals(CCCD_UUID, ignoreCase = true)) {
                descriptor.value = value
                if (responseNeeded) {
                    gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, value)
                }
                val id = device.address
                deviceConnectionStates[id] = ConnectionState.READY
                notifyListeners("onNotificationsEnabled", JSObject().apply {
                    put("deviceId", id)
                    put("notificationsEnabled", true)
                })
                notifyListeners("onServicesReady", JSObject().apply {
                    put("deviceId", id)
                    put("servicesReady", true)
                })
            }
        }
        override fun onMtuChanged(device: BluetoothDevice?, mtu: Int) {
            Log.i(TAG, "MTU changed for ${device?.address}: $mtu")
        }
    }

    private fun closeGattServer() {
        try {
            gattServer?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Error closing GATT server", e)
        }
        gattServer = null
        serverReady.set(false)
    }

    private fun scheduleServerRestart() {
        if (serverRestartScheduled.getAndSet(true)) return
        Handler(Looper.getMainLooper()).postDelayed({
            serverRestartScheduled.set(false)
            Log.w(TAG, "Restarting GATT server...")
            closeGattServer()
            startGattServer()
        }, SERVER_RESTART_DELAY_MS)
    }

    private fun connectGatt(device: BluetoothDevice) {
        val id = device.address
        gattClients[id]?.let { oldGatt ->
            safeCloseGatt(oldGatt)
        }
        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, gattClientCallback)
        }
        gattClients[id] = gatt
        startGattOperationWorker(id)
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
            gatt ?: return
            val id = gatt.device?.address ?: return
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "Client connected to $id")
                    deviceConnectionStates[id] = ConnectionState.CONNECTED
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceId", id)
                        put("name", gatt.device?.name ?: "NEXO Peer")
                        put("direction", "outgoing")
                        put("servicesReady", false)
                        put("attempt", 0)
                    })
                    gatt.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "Client disconnected from $id")
                    deviceConnectionStates[id] = ConnectionState.DISCONNECTED
                    notifyListeners("onDeviceDisconnected", JSObject().apply {
                        put("deviceId", id)
                        put("reason", if (status == BluetoothGatt.GATT_SUCCESS) "User disconnected" else "Error $status")
                    })
                    safeCloseGatt(gatt)
                    gattClients.remove(id)
                    stopGattOperationWorker(id)
                }
            }
        }
        override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
            gatt ?: return
            val id = gatt.device?.address ?: return
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.i(TAG, "Services discovered for $id")
                deviceConnectionStates[id] = ConnectionState.DISCOVERING
                notifyListeners("onServicesReady", JSObject().apply {
                    put("deviceId", id)
                    put("servicesReady", true)
                })
                val service = gatt.getService(UUID.fromString(NEXO_SERVICE_UUID))
                val txChar = service?.getCharacteristic(UUID.fromString(NEXO_CHAR_TX))
                if (txChar != null) {
                    gatt.setCharacteristicNotification(txChar, true)
                    val cccd = txChar.getDescriptor(UUID.fromString(CCCD_UUID))
                    if (cccd != null) {
                        cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        val op = GattOperation.WriteDescriptor(id, CCCD_UUID, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                        queueGattOperation(id, op)
                    }
                }
            } else {
                Log.e(TAG, "Service discovery failed for $id: $status")
            }
        }
        override fun onCharacteristicChanged(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?, value: ByteArray?) {
            gatt ?: return
            val id = gatt.device?.address ?: return
            val data = value ?: characteristic?.value ?: return
            val payload = String(data, Charsets.UTF_8)
            Log.d(TAG, "Notification from $id: $payload")
            val json = try { JSONObject(payload) } catch (e: Exception) { null }
            val messageId = json?.optString("messageId")
            if (messageId != null && messageId.isNotEmpty()) {
                val now = System.currentTimeMillis()
                synchronized(messageDedupLru) {
                    if (messageDedupLru.containsKey(messageId)) return
                    messageDedupLru[messageId] = now
                }
            }
            notifyListeners("onPayloadReceived", JSObject().apply {
                put("deviceId", id)
                put("data", payload)
                put("source", "gatt_client_notification")
                put("timestamp", System.currentTimeMillis())
            })
        }
        override fun onCharacteristicWrite(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?, status: Int) {
            gatt ?: return
            val id = gatt.device?.address ?: return
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "Write success to $id")
            } else {
                Log.e(TAG, "Write failed to $id: $status")
            }
            signalOperationComplete(id)
        }
        override fun onDescriptorWrite(gatt: BluetoothGatt?, descriptor: BluetoothGattDescriptor?, status: Int) {
            gatt ?: return
            val id = gatt.device?.address ?: return
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.i(TAG, "Descriptor write success for $id")
                deviceConnectionStates[id] = ConnectionState.READY
                notifyListeners("onNotificationsEnabled", JSObject().apply {
                    put("deviceId", id)
                    put("notificationsEnabled", true)
                })
            }
            signalOperationComplete(id)
        }
        override fun onMtuChanged(gatt: BluetoothGatt?, mtu: Int, status: Int) {
            signalOperationComplete(gatt?.device?.address ?: return)
        }
    }

    private fun disconnectDeviceInternal(deviceId: String) {
        val gatt = gattClients[deviceId] ?: return
        deviceConnectionStates[deviceId] = ConnectionState.DISCONNECTING
        try {
            gatt.disconnect()
        } catch (e: Exception) {
            Log.w(TAG, "disconnect error", e)
        }
        Handler(Looper.getMainLooper()).postDelayed({
            safeCloseGatt(gatt)
            gattClients.remove(deviceId)
            stopGattOperationWorker(deviceId)
        }, FORCED_DISCONNECT_DELAY_MS)
    }

    private fun disconnectAllDevices() {
        gattClients.keys.toList().forEach { disconnectDeviceInternal(it) }
    }

    private fun safeCloseGatt(gatt: BluetoothGatt?) {
        gatt ?: return
        try {
            gatt.close()
        } catch (e: Exception) {
            Log.w(TAG, "safeCloseGatt error", e)
        }
    }

    private sealed class GattOperation {
        data class Write(val deviceId: String, val charUuid: String, val value: ByteArray) : GattOperation()
        data class WriteDescriptor(val deviceId: String, val descUuid: String, val value: ByteArray) : GattOperation()
        data class Read(val deviceId: String, val charUuid: String) : GattOperation()
        data class RequestMtu(val deviceId: String, val mtu: Int) : GattOperation()
    }

    private val operationLocks = ConcurrentHashMap<String, Any>()
    private val operationSignals = ConcurrentHashMap<String, CountDownLatch>()

    private fun queueGattOperation(deviceId: String, operation: GattOperation) {
        val queue = gattOperationQueues.getOrPut(deviceId) { LinkedBlockingQueue() }
        queue.put(operation)
    }

    private fun startGattOperationWorker(deviceId: String) {
        if (gattOperationWorkers.containsKey(deviceId)) return
        val thread = Thread({
            val queue = gattOperationQueues.getOrPut(deviceId) { LinkedBlockingQueue() }
            while (!Thread.currentThread().isInterrupted) {
                try {
                    val op = queue.poll(500, TimeUnit.MILLISECONDS) ?: continue
                    executeOperation(deviceId, op)
                } catch (e: InterruptedException) {
                    break
                } catch (e: Exception) {
                    Log.e(TAG, "Operation worker error for $deviceId", e)
                }
            }
        }, "GattOpWorker-$deviceId")
        thread.isDaemon = true
        thread.start()
        gattOperationWorkers[deviceId] = thread
    }

    private fun stopGattOperationWorker(deviceId: String) {
        gattOperationWorkers.remove(deviceId)?.interrupt()
        gattOperationQueues.remove(deviceId)
    }

    private fun executeOperation(deviceId: String, operation: GattOperation) {
        val gatt = gattClients[deviceId] ?: return
        val lock = operationLocks.getOrPut(deviceId) { Object() }
        val signal = CountDownLatch(1)
        operationSignals[deviceId] = signal
        synchronized(lock) {
            val success = when (operation) {
                is GattOperation.Write -> {
                    val service = gatt.getService(UUID.fromString(NEXO_SERVICE_UUID))
                    val char = service?.getCharacteristic(UUID.fromString(operation.charUuid))
                    if (char != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            gatt.writeCharacteristic(char, operation.value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothStatusCodes.SUCCESS
                        } else {
                            char.value = operation.value
                            gatt.writeCharacteristic(char)
                        }
                    } else false
                }
                is GattOperation.WriteDescriptor -> {
                    val service = gatt.getService(UUID.fromString(NEXO_SERVICE_UUID))
                    val char = service?.characteristics?.find { it.descriptors.any { d -> d.uuid.toString().equals(operation.descUuid, ignoreCase = true) } }
                    val desc = char?.getDescriptor(UUID.fromString(operation.descUuid))
                    if (desc != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            gatt.writeDescriptor(desc, operation.value) == BluetoothStatusCodes.SUCCESS
                        } else {
                            desc.value = operation.value
                            gatt.writeDescriptor(desc)
                        }
                    } else false
                }
                is GattOperation.Read -> {
                    val service = gatt.getService(UUID.fromString(NEXO_SERVICE_UUID))
                    val char = service?.getCharacteristic(UUID.fromString(operation.charUuid))
                    if (char != null) gatt.readCharacteristic(char) else false
                }
                is GattOperation.RequestMtu -> {
                    gatt.requestMtu(operation.mtu)
                }
            }
            if (success) {
                signal.await(GATT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            }
        }
        operationSignals.remove(deviceId)
    }

    private fun signalOperationComplete(deviceId: String) {
        operationSignals[deviceId]?.countDown()
    }

    private fun startAdvertisingInternal() {
        if (isAdvertising.get()) return
        val advertiser = bluetoothLeAdvertiser ?: return
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()
        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(UUID.fromString(NEXO_SERVICE_UUID)))
            .build()
        val scanResponse = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .build()
        advertiser.startAdvertising(settings, data, scanResponse, advertiseCallback)
    }

    private fun stopAdvertisingInternal() {
        if (!isAdvertising.get()) return
        bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback)
        isAdvertising.set(false)
    }

    private fun stopScanInternal() {
        if (!isScanning.get()) return
        try {
            bluetoothLeScanner?.stopScan(scanCallback)
        } catch (e: Exception) {
            Log.w(TAG, "stopScan error", e)
        }
        isScanning.set(false)
    }

    private fun checkBluetoothAdapter(call: PluginCall): Boolean {
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth not supported")
            return false
        }
        if (bluetoothAdapter?.isEnabled != true) {
            call.reject("Bluetooth is disabled")
            return false
        }
        return true
    }

    private fun checkPermission(permission: String, call: PluginCall): Boolean {
        return if (ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED) {
            true
        } else {
            call.reject("Permission not granted: $permission")
            false
        }
    }

    private enum class ConnectionState {
        DISCONNECTED, CONNECTING, CONNECTED, DISCOVERING, READY, DISCONNECTING, ERROR
    }

    interface BleServiceInterface {
        fun sendNotification(deviceId: String, data: ByteArray): Boolean
        fun getConnectedDeviceIds(): List<String>
        class LocalBinder(val service: BleServiceInterface) : android.os.Binder()
    }
}
