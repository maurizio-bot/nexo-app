package com.nexo.ble

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.*
import android.content.pm.PackageManager
import android.os.*
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.getcapacitor.annotation.PluginMethod
import com.nexo.ble.model.NexoGattService
import org.json.JSONArray
import org.json.JSONObject
import java.util.*
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean

@CapacitorPlugin(
    name = "NexoBLE",
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN], alias = "bleScan"),
        Permission(strings = [Manifest.permission.BLUETOOTH_CONNECT], alias = "bleConnect"),
        Permission(strings = [Manifest.permission.BLUETOOTH_ADVERTISE], alias = "bleAdvertise"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "bleLocation")
    ]
)
class NexoBlePlugin : Plugin() {

    companion object {
        private const val TAG = "NexoBLE"
        private const val GATT_TIMEOUT_MS = 10000L
        private const val RECONNECT_DELAY_MS = 2000L
        private const val MAX_RECONNECT_ATTEMPTS = 5
        private const val FORCED_DISCONNECT_DELAY_MS = 2000L
        private const val MESSAGE_DEDUP_MAX = 1000
    }

    private var bluetoothAdapter: BluetoothAdapter? = null
    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothLeScanner: BluetoothLeScanner? = null

    private val gattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val gattOperationQueues = ConcurrentHashMap<String, BlockingQueue<GattOperation>>()
    private val gattOperationWorkers = ConcurrentHashMap<String, Thread>()
    private val deviceConnectionStates = ConcurrentHashMap<String, ConnectionState>()

    private var isScanning = AtomicBoolean(false)
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result ?: return
            val device = result.device
            val name = result.scanRecord?.deviceName ?: device.name ?: "NEXO Device"
            val data = JSObject()
            data.put("deviceId", device.address.orEmpty())
            data.put("name", name)
            data.put("rssi", result.rssi)
            notifyListeners("onDeviceFound", data)
        }
        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "Scan failed: $errorCode")
            val err = JSObject()
            err.put("errorCode", errorCode)
            notifyListeners("onScanFailed", err)
            isScanning.set(false)
        }
    }

    private var localUserId: String = ""
    private var localUserName: String = "NEXO User"
    private var serviceBound = AtomicBoolean(false)
    private var bleService: BleService.ServiceInterface? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? BleService.LocalBinder
            bleService = binder?.getService()
            serviceBound.set(true)
            Log.i(TAG, "BleService bound")
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            bleService = null
            serviceBound.set(false)
            Log.w(TAG, "BleService unbound")
        }
    }

    private val serviceBroadcastReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                "com.nexo.ble.PAYLOAD_RECEIVED" -> {
                    val deviceId = intent.getStringExtra("deviceId") ?: return
                    val data = intent.getStringExtra("data") ?: return
                    val evt = JSObject()
                    evt.put("deviceId", deviceId)
                    evt.put("data", data)
                    evt.put("source", "gatt_server")
                    evt.put("timestamp", System.currentTimeMillis())
                    notifyListeners("onPayloadReceived", evt)
                }
                "com.nexo.ble.DEVICE_CONNECTED" -> {
                    val deviceId = intent.getStringExtra("deviceId") ?: return
                    val direction = intent.getStringExtra("direction") ?: "incoming"
                    val name = intent.getStringExtra("name") ?: "NEXO Peer"
                    val data = JSObject()
                    data.put("deviceId", deviceId)
                    data.put("name", name)
                    data.put("direction", direction)
                    data.put("servicesReady", true)
                    notifyListeners("onDeviceConnected", data)
                }
                "com.nexo.ble.DEVICE_DISCONNECTED" -> {
                    val deviceId = intent.getStringExtra("deviceId") ?: return
                    val reason = intent.getStringExtra("reason") ?: "Disconnected"
                    val data = JSObject()
                    data.put("deviceId", deviceId)
                    data.put("reason", reason)
                    notifyListeners("onDeviceDisconnected", data)
                }
                "com.nexo.ble.SERVER_READY" -> {
                    val ready = intent.getBooleanExtra("ready", false)
                    notifyListeners("onServerReady", JSObject().put("ready", ready))
                }
                "com.nexo.ble.NOTIFICATION_STATE" -> {
                    val deviceId = intent.getStringExtra("deviceId") ?: return
                    val enabled = intent.getBooleanExtra("enabled", false)
                    if (enabled) {
                        deviceConnectionStates[deviceId] = ConnectionState.READY
                        val evt = JSObject()
                        evt.put("deviceId", deviceId)
                        evt.put("notificationsEnabled", true)
                        notifyListeners("onNotificationsEnabled", evt)
                        val evt2 = JSObject()
                        evt2.put("deviceId", deviceId)
                        evt2.put("servicesReady", true)
                        notifyListeners("onServicesReady", evt2)
                    }
                }
                "com.nexo.ble.ADVERTISE_STARTED" -> {
                    notifyListeners("onAdvertiseStarted", JSObject().put("success", true))
                }
                "com.nexo.ble.ADVERTISE_FAILED" -> {
                    val err = JSObject()
                    err.put("errorCode", intent.getIntExtra("errorCode", -1))
                    notifyListeners("onAdvertiseFailed", err)
                }
            }
        }
    }

    override fun load() {
        super.load()
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        bluetoothLeScanner = bluetoothAdapter?.bluetoothLeScanner

        val filter = IntentFilter().apply {
            addAction("com.nexo.ble.PAYLOAD_RECEIVED")
            addAction("com.nexo.ble.DEVICE_CONNECTED")
            addAction("com.nexo.ble.DEVICE_DISCONNECTED")
            addAction("com.nexo.ble.SERVER_READY")
            addAction("com.nexo.ble.NOTIFICATION_STATE")
            addAction("com.nexo.ble.ADVERTISE_STARTED")
            addAction("com.nexo.ble.ADVERTISE_FAILED")
        }
        ContextCompat.registerReceiver(context, serviceBroadcastReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)

        bindBleService()
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        stopScanInternal()
        disconnectAllDevices()
        try {
            ContextCompat.unregisterReceiver(context, serviceBroadcastReceiver)
        } catch (e: Exception) {
            Log.w(TAG, "unregisterReceiver error: ${e.message}")
        }
        if (serviceBound.get()) {
            try {
                context.unbindService(serviceConnection)
            } catch (e: Exception) {
                Log.w(TAG, "unbind error: ${e.message}")
            }
        }
    }

    private fun bindBleService() {
        try {
            val intent = Intent(context, BleService::class.java)
            context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
        } catch (e: Exception) {
            Log.w(TAG, "BleService not available: ${e.message}")
        }
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        localUserId = call.getString("userId") ?: ""
        localUserName = call.getString("userName") ?: "NEXO User"
        if (!checkBluetoothAdapter(call)) return

        try {
            val intent = Intent(context, BleService::class.java).apply {
                putExtra("userId", localUserId)
                putExtra("userName", localUserName)
            }
            context.startForegroundService(intent)
            bindBleService()

            val ret = JSObject()
            ret.put("success", true)
            ret.put("serverReady", bleService?.isServerReady() ?: false)
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
        ret.put("canAdvertise", enabled && bluetoothAdapter?.bluetoothLeAdvertiser != null)
        ret.put("canScan", enabled && bluetoothLeScanner != null)
        ret.put("serverReady", bleService?.isServerReady() ?: false)
        call.resolve(ret)
    }

    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val ret = JSObject()
        ret.put("isAdvertising", bleService?.isAdvertising() ?: false)
        call.resolve(ret)
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        if (!checkBluetoothAdapter(call)) return
        if (!checkPermission(Manifest.permission.BLUETOOTH_ADVERTISE, call)) return
        val success = bleService?.startAdvertising() ?: false
        if (success) {
            call.resolve(JSObject().put("success", true))
        } else {
            call.reject("Advertising failed: server not ready or missing permissions")
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        bleService?.stopAdvertising()
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
            val filter = ScanFilter.Builder()
                .setServiceUuid(ParcelUuid(NexoGattService.SERVICE_UUID))
                .build()
            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build()
            bluetoothLeScanner?.startScan(listOf(filter), settings, scanCallback)
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
        val deviceId = call.getString("deviceId") ?: ""
        if (deviceId.isEmpty()) {
            call.reject("deviceId required")
            return
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
        try {
            connectGatt(device)
            val ret = JSObject()
            ret.put("connected", true)
            ret.put("alreadyConnected", false)
            call.resolve(ret)
        } catch (e: Exception) {
            deviceConnectionStates[deviceId] = ConnectionState.ERROR
            call.reject("Connection failed: ${e.message}")
        }
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: ""
        if (deviceId.isEmpty()) {
            call.reject("deviceId required")
            return
        }
        disconnectDeviceInternal(deviceId)
        call.resolve(JSObject().put("success", true))
    }

    @PluginMethod
    fun forceReconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: ""
        if (deviceId.isEmpty()) {
            call.reject("deviceId required")
            return
        }
        disconnectDeviceInternal(deviceId)
        Handler(Looper.getMainLooper()).postDelayed({
            val device = bluetoothAdapter?.getRemoteDevice(deviceId)
            if (device != null) connectGatt(device)
        }, RECONNECT_DELAY_MS)
        call.resolve(JSObject().put("success", true))
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: ""
        val message = call.getString("message") ?: ""
        if (deviceId.isEmpty() || message.isEmpty()) {
            call.reject("deviceId and message required")
            return
        }

        val payload = JSONObject().apply {
            put("messageId", UUID.randomUUID().toString())
            put("senderName", localUserName)
            put("content", message)
            put("timestamp", System.currentTimeMillis())
        }.toString().toByteArray(Charsets.UTF_8)

        if (bleService?.getConnectedDeviceIds()?.contains(deviceId) == true) {
            val success = bleService?.sendNotification(deviceId, payload) ?: false
            if (success) {
                call.resolve(JSObject().put("success", true).put("via", "server_notification"))
            } else {
                call.reject("Failed to send via server notification (not subscribed?)")
            }
            return
        }

        if (gattClients.containsKey(deviceId)) {
            val op = GattOperation.Write(
                deviceId,
                NexoGattService.PAYLOAD_CHAR_UUID.toString(),
                payload
            )
            queueGattOperation(deviceId, op)
            call.resolve(JSObject().put("success", true).put("via", "client_write"))
            return
        }

        call.reject("Device not connected")
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val devices = JSONArray()
        gattClients.forEach { (id, _) ->
            val obj = JSObject()
            obj.put("id", id)
            obj.put("address", id)
            obj.put("state", deviceConnectionStates[id]?.name ?: "UNKNOWN")
            obj.put("direction", "outgoing")
            devices.put(obj)
        }
        bleService?.getConnectedDeviceIds()?.forEach { id ->
            val obj = JSObject()
            obj.put("id", id)
            obj.put("address", id)
            obj.put("state", "READY")
            obj.put("direction", "incoming")
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

        val act = activity
        val permanentlyDenied = if (act != null) {
            !scanPerm && !androidx.core.app.ActivityCompat.shouldShowRequestPermissionRationale(act, Manifest.permission.BLUETOOTH_SCAN)
        } else false
        ret.put("isPermanentlyDenied", permanentlyDenied)
        call.resolve(ret)
    }

    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAlias("bleScan", call, "bleScanCallback")
        } else {
            requestPermissionForAlias("bleLocation", call, "bleLocationCallback")
        }
    }

    @PermissionCallback
    fun bleScanCallback(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAlias("bleConnect", call, "bleConnectCallback")
        } else {
            checkBLEStatus(call)
        }
    }

    @PermissionCallback
    fun bleConnectCallback(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAlias("bleAdvertise", call, "bleAdvertiseCallback")
        } else {
            checkBLEStatus(call)
        }
    }

    @PermissionCallback
    fun bleAdvertiseCallback(call: PluginCall) {
        checkBLEStatus(call)
    }

    @PermissionCallback
    fun bleLocationCallback(call: PluginCall) {
        checkBLEStatus(call)
    }

    private fun connectGatt(device: BluetoothDevice) {
        val id = device.address ?: return
        gattClients[id]?.let { safeCloseGatt(it) }
        val gatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            @Suppress("DEPRECATION")
            device.connectGatt(context, false, gattClientCallback)
        }
        if (gatt != null) {
            gattClients[id] = gatt
            startGattOperationWorker(id)
        }
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
            val g = gatt ?: return
            val dev = g.device ?: return
            val id = dev.address ?: return
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "Client connected to $id")
                    deviceConnectionStates[id] = ConnectionState.CONNECTED
                    val data = JSObject()
                    data.put("deviceId", id)
                    data.put("name", dev.name ?: "NEXO Peer")
                    data.put("direction", "outgoing")
                    data.put("servicesReady", false)
                    notifyListeners("onDeviceConnected", data)
                    g.requestMtu(517)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    Log.i(TAG, "Client disconnected from $id")
                    deviceConnectionStates[id] = ConnectionState.DISCONNECTED
                    val data = JSObject()
                    data.put("deviceId", id)
                    data.put("reason", if (status == BluetoothGatt.GATT_SUCCESS) "User disconnected" else "Error $status")
                    notifyListeners("onDeviceDisconnected", data)
                    safeCloseGatt(g)
                    gattClients.remove(id)
                    stopGattOperationWorker(id)
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt?, mtu: Int, status: Int) {
            val g = gatt ?: return
            val dev = g.device ?: return
            val id = dev.address ?: return
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.i(TAG, "MTU negotiated for $id: $mtu")
            }
            signalOperationComplete(id)
            g.discoverServices()
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
            val g = gatt ?: return
            val dev = g.device ?: return
            val id = dev.address ?: return
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.i(TAG, "Services discovered for $id")
                val service = g.getService(NexoGattService.SERVICE_UUID)
                if (service == null) {
                    Log.e(TAG, "NEXO service not found on $id")
                    return
                }
                val payloadChar = service.getCharacteristic(NexoGattService.PAYLOAD_CHAR_UUID)
                if (payloadChar != null) {
                    g.setCharacteristicNotification(payloadChar, true)
                    val cccd = payloadChar.getDescriptor(NexoGattService.CLIENT_CONFIG_UUID)
                    if (cccd != null) {
                        val op = GattOperation.WriteDescriptor(
                            id,
                            NexoGattService.CLIENT_CONFIG_UUID.toString(),
                            BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        )
                        queueGattOperation(id, op)
                    }
                }
                val announceChar = service.getCharacteristic(NexoGattService.ANNOUNCE_CHAR_UUID)
                if (announceChar != null) {
                    val op = GattOperation.Read(id, NexoGattService.ANNOUNCE_CHAR_UUID.toString())
                    queueGattOperation(id, op)
                }
                deviceConnectionStates[id] = ConnectionState.DISCOVERING
                val evt = JSObject()
                evt.put("deviceId", id)
                evt.put("servicesReady", true)
                notifyListeners("onServicesReady", evt)
            } else {
                Log.e(TAG, "Service discovery failed for $id: $status")
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?) {
            val g = gatt ?: return
            val dev = g.device ?: return
            val id = dev.address ?: return
            val data = characteristic?.value ?: return
            val payload = String(data, Charsets.UTF_8)
            Log.d(TAG, "Notification from $id: ${payload.take(200)}")

            if (characteristic.uuid == NexoGattService.ANNOUNCE_CHAR_UUID) {
                val evt = JSObject()
                evt.put("deviceId", id)
                evt.put("peerInfo", payload)
                evt.put("source", "peer_announce")
                notifyListeners("onPeerInfoReceived", evt)
                return
            }

            val json = try { JSONObject(payload) } catch (e: Exception) { null }
            val messageId = json?.optString("messageId")
            if (!messageId.isNullOrEmpty()) {
                val now = System.currentTimeMillis()
                synchronized(messageDedupLru) {
                    if (messageDedupLru.containsKey(messageId)) return
                    messageDedupLru[messageId] = now
                }
            }
            val evt = JSObject()
            evt.put("deviceId", id)
            evt.put("data", payload)
            evt.put("source", "gatt_client_notification")
            evt.put("timestamp", System.currentTimeMillis())
            notifyListeners("onPayloadReceived", evt)
        }

        override fun onCharacteristicRead(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?, status: Int) {
            val g = gatt ?: return
            val dev = g.device ?: return
            val id = dev.address ?: return
            if (status == BluetoothGatt.GATT_SUCCESS && characteristic != null) {
                if (characteristic.uuid == NexoGattService.ANNOUNCE_CHAR_UUID) {
                    val payload = String(characteristic.value ?: byteArrayOf(), Charsets.UTF_8)
                    val evt = JSObject()
                    evt.put("deviceId", id)
                    evt.put("peerInfo", payload)
                    evt.put("source", "peer_announce_read")
                    notifyListeners("onPeerInfoReceived", evt)
                }
            }
            signalOperationComplete(id)
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?, status: Int) {
            val g = gatt ?: return
            val dev = g.device ?: return
            val id = dev.address ?: return
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "Write success to $id")
            } else {
                Log.e(TAG, "Write failed to $id: $status")
            }
            signalOperationComplete(id)
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt?, descriptor: BluetoothGattDescriptor?, status: Int) {
            val g = gatt ?: return
            val dev = g.device ?: return
            val id = dev.address ?: return
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.i(TAG, "Descriptor write success for $id")
                deviceConnectionStates[id] = ConnectionState.READY
                val evt = JSObject()
                evt.put("deviceId", id)
                evt.put("notificationsEnabled", true)
                notifyListeners("onNotificationsEnabled", evt)
            }
            signalOperationComplete(id)
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

    private val messageDedupLru = Collections.synchronizedMap(
        object : LinkedHashMap<String, Long>(MESSAGE_DEDUP_MAX, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean {
                return size > MESSAGE_DEDUP_MAX
            }
        }
    )

    private sealed class GattOperation {
        data class Write(val deviceId: String, val charUuid: String, val value: ByteArray) : GattOperation()
        data class WriteDescriptor(val deviceId: String, val descUuid: String, val value: ByteArray) : GattOperation()
        data class Read(val deviceId: String, val charUuid: String) : GattOperation()
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
                    val service = gatt.getService(NexoGattService.SERVICE_UUID)
                    val char = service?.getCharacteristic(UUID.fromString(operation.charUuid))
                    if (char != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            val result = gatt.writeCharacteristic(char, operation.value, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                            result == BluetoothGatt.GATT_SUCCESS
                        } else {
                            @Suppress("DEPRECATION")
                            char.value = operation.value
                            gatt.writeCharacteristic(char)
                        }
                    } else false
                }
                is GattOperation.WriteDescriptor -> {
                    val service = gatt.getService(NexoGattService.SERVICE_UUID)
                    val char = service?.characteristics?.find {
                        it.descriptors.any { d -> d.uuid.toString().equals(operation.descUuid, ignoreCase = true) }
                    }
                    val desc = char?.getDescriptor(UUID.fromString(operation.descUuid))
                    if (desc != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            val result = gatt.writeDescriptor(desc, operation.value)
                            result == BluetoothGatt.GATT_SUCCESS
                        } else {
                            @Suppress("DEPRECATION")
                            desc.value = operation.value
                            gatt.writeDescriptor(desc)
                        }
                    } else false
                }
                is GattOperation.Read -> {
                    val service = gatt.getService(NexoGattService.SERVICE_UUID)
                    val char = service?.getCharacteristic(UUID.fromString(operation.charUuid))
                    if (char != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            val result = gatt.readCharacteristic(char)
                            result == BluetoothGatt.GATT_SUCCESS
                        } else {
                            @Suppress("DEPRECATION")
                            gatt.readCharacteristic(char)
                        }
                    } else false
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
}
