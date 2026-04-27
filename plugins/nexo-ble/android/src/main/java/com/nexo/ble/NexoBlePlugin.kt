package com.nexo.ble

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

    // ==================== PERMISSIONS ====================

    @PluginMethod
    fun checkBLEStatus(call: PluginCall) {
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

        Log.i(TAG, "checkBLEStatus: allGranted=$allGranted, permanent=$isPermanentlyDenied, wasAsked=$wasEverAsked")
        call.resolve(result)
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        val ctx = activity.applicationContext
        val alreadyGranted = checkCoreBLEPermissions(ctx)

        if (alreadyGranted) {
            Log.i(TAG, "initializeBLE: permisos OK, iniciando servidor")
            startBleService(ctx)
            notifyListeners("onServerReady", JSObject().put("ready", true))
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
    }

    @PluginMethod
    fun requestBLEPermissions(call: PluginCall) {
        initializeBLE(call)
    }

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
        } else {
            false
        }

        Log.i(TAG, "permissionsCallback: granted=$granted, isPermanentlyDenied=$isPermanent")
        if (granted) {
            startBleService(ctx)
            notifyListeners("onServerReady", JSObject().put("ready", true))
        }
        call.resolve(JSObject().put("dialogResponded", true).put("granted", granted).put("isPermanentlyDenied", isPermanent))
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

    private fun startBleService(ctx: Context) {
        val intent = Intent(ctx, BleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent)
        } else {
            ctx.startService(intent)
        }
        registerServerReceivers()
    }

    // ==================== ADVERTISING ====================

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter

        if (adapter == null || !adapter.isEnabled) {
            notifyListeners("onAdvertiseFailed", JSObject().put("error", "Bluetooth desactivado"))
            call.reject("Bluetooth desactivado")
            return
        }

        startBleService(context)
        notifyListeners("onAdvertiseStarted", JSObject().put("started", true))
        call.resolve(JSObject().put("started", true))
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        val context = activity.applicationContext
        context.stopService(Intent(context, BleService::class.java))
        unregisterServerReceivers()
        call.resolve(JSObject().put("stopped", true))
    }

    @PluginMethod
    fun isAdvertising(call: PluginCall) {
        val isRunning = messageReceiver != null
        call.resolve(JSObject().put("isAdvertising", isRunning))
    }

    // ==================== BLUETOOTH STATE ====================

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        val enabled = adapter != null && adapter.isEnabled
        val canAdvertise = enabled && (adapter?.bluetoothLeAdvertiser != null)
        val isRunning = messageReceiver != null
        call.resolve(JSObject()
            .put("enabled", enabled)
            .put("canAdvertise", canAdvertise)
            .put("serverReady", isRunning)
        )
    }

    @PluginMethod
    fun getLocalDeviceInfo(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        val name = adapter?.name ?: "NEXO Device"
        val address = try { adapter?.address ?: "" } catch (e: SecurityException) { "" }
        call.resolve(JSObject().put("deviceName", name).put("deviceAddress", address))
    }

    // ==================== MESSAGING ====================

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: ""
        val message = call.getString("message") ?: ""

        if (deviceId.isNotEmpty() && bluetoothGatt != null && clientRxCharacteristic != null) {
            val data = message.toByteArray(Charset.defaultCharset())
            val success = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                bluetoothGatt?.writeCharacteristic(
                    clientRxCharacteristic!!,
                    data,
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                ) == BluetoothGatt.GATT_SUCCESS
            } else {
                @Suppress("DEPRECATION")
                clientRxCharacteristic?.value = data
                @Suppress("DEPRECATION")
                bluetoothGatt?.writeCharacteristic(clientRxCharacteristic) ?: false
            }
            call.resolve(JSObject().put("sent", success).put("mode", "client"))
            return
        }

        val context = activity.applicationContext
        val intent = Intent(NexoBleSpec.ACTION_BLE_SEND_MESSAGE).apply {
            putExtra(NexoBleSpec.EXTRA_MESSAGE_DATA, message)
            setPackage(context.packageName)
        }
        context.sendBroadcast(intent)
        call.resolve(JSObject().put("sent", true).put("mode", "server"))
    }

    // ==================== SCANNING ====================

    @PluginMethod
    fun startScan(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter

        if (adapter == null || !adapter.isEnabled) {
            notifyListeners("onScanFailed", JSObject().put("error", "Bluetooth desactivado"))
            call.reject("Bluetooth desactivado")
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
            call.resolve(JSObject().put("started", true))
        } catch (e: SecurityException) {
            notifyListeners("onScanFailed", JSObject().put("error", e.message))
            call.reject("Permiso BLUETOOTH_SCAN no concedido: ${e.message}")
        }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        stopScanInternal()
        call.resolve(JSObject().put("stopped", true))
    }

    // ==================== CONNECTION ====================

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: call.getString("address") ?: ""
        if (deviceId.isEmpty()) {
            call.reject("deviceId requerido")
            return
        }

        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val device = bluetoothManager.adapter.getRemoteDevice(deviceId)

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
            .put("attempt", 0)
            .put("servicesReady", false)
        )
        call.resolve(JSObject().put("connecting", true).put("connected", false).put("alreadyConnected", false).put("deviceId", deviceId))
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
            val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            val device = bluetoothManager.adapter.getRemoteDevice(deviceId)
            bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
            } else {
                device.connectGatt(context, false, gattClientCallback)
            }
            notifyListeners("onDeviceConnected", JSObject()
                .put("deviceId", deviceId)
                .put("direction", "outgoing")
                .put("attempt", 1)
                .put("servicesReady", false)
            )
        }, 500)

        call.resolve(JSObject().put("reconnecting", true).put("deviceId", deviceId))
    }

    // ==================== CALLBACKS ====================

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
            Log.e(TAG, "Scan failed: $errorCode")
            notifyListeners("onScanFailed", JSObject().put("errorCode", errorCode))
        }
    }

    private fun stopScanInternal() {
        mainHandler.removeCallbacks(scanTimeoutRunnable)
        try { bluetoothScanner?.stopScan(scanCallback) } catch (e: Exception) { Log.w(TAG, "Error stopping scan", e) }
        bluetoothScanner = null
    }

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val address = gatt.device?.address ?: ""
            Log.i(TAG, "Client connection $address status=$status newState=$newState")
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                connectedDevicesMap[address] = JSObject()
                    .put("id", address).put("address", address)
                    .put("name", gatt.device?.name ?: "NEXO Peer")
                    .put("direction", "outgoing")
                notifyListeners("onDeviceConnected", JSObject()
                    .put("deviceId", address)
                    .put("direction", "outgoing")
                    .put("attempt", 0)
                    .put("servicesReady", false)
                )
                gatt.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                connectedDevicesMap.remove(address)
                notifyListeners("onDeviceDisconnected", JSObject().put("deviceId", address))
                bluetoothGatt?.close()
                bluetoothGatt = null
                clientTxCharacteristic = null
                clientRxCharacteristic = null
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val address = gatt.device?.address ?: ""
            if (status != BluetoothGatt.GATT_SUCCESS) {
                notifyListeners("onConnectionFailed", JSObject()
                    .put("deviceId", address)
                    .put("reason", "Service discovery failed")
                    .put("recoverable", true)
                    .put("attempt", 0)
                    .put("maxAttempts", 3)
                )
                return
            }
            val service = gatt.getService(NexoBleSpec.NEXO_SERVICE_UUID) ?: run {
                notifyListeners("onConnectionFailed", JSObject()
                    .put("deviceId", address)
                    .put("reason", "NEXO service not found")
                    .put("recoverable", false)
                )
                return
            }

            clientTxCharacteristic = service.getCharacteristic(NexoBleSpec.TX_CHARACTERISTIC_UUID)
            clientRxCharacteristic = service.getCharacteristic(NexoBleSpec.RX_CHARACTERISTIC_UUID)

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
            notifyListeners("onServicesReady", JSObject().put("deviceId", address).put("servicesReady", true))
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            val address = gatt.device?.address ?: ""
            if (status == BluetoothGatt.GATT_SUCCESS && descriptor.uuid == NexoBleSpec.CCCD_UUID) {
                notifyListeners("onNotificationsEnabled", JSObject()
                    .put("deviceId", address)
                    .put("notificationsEnabled", true)
                )
            }
        }

        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                val message = characteristic.value?.toString(Charset.defaultCharset()) ?: ""
                val address = gatt.device?.address ?: ""
                notifyListeners("onPayloadReceived", JSObject()
                    .put("deviceId", address)
                    .put("content", message)
                    .put("data", message)
                    .put("senderName", null)
                    .put("source", "ble")
                    .put("timestamp", System.currentTimeMillis())
                )
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                val message = value.toString(Charset.defaultCharset())
                val address = gatt.device?.address ?: ""
                notifyListeners("onPayloadReceived", JSObject()
                    .put("deviceId", address)
                    .put("content", message)
                    .put("data", message)
                    .put("senderName", null)
                    .put("source", "ble")
                    .put("timestamp", System.currentTimeMillis())
                )
            }
        }
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
                            .put("senderName", null)
                            .put("source", "ble")
                            .put("timestamp", System.currentTimeMillis())
                        )
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED -> {
                        val addr = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                        connectedDevicesMap[addr] = JSObject()
                            .put("id", addr).put("address", addr)
                            .put("name", "NEXO Peer").put("direction", "incoming")
                        notifyListeners("onDeviceConnected", JSObject()
                            .put("deviceId", addr)
                            .put("direction", "incoming")
                            .put("attempt", 0)
                            .put("servicesReady", true)
                        )
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED -> {
                        val addr = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                        connectedDevicesMap.remove(addr)
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

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(messageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            activity.registerReceiver(messageReceiver, filter)
        }
    }

    private fun unregisterServerReceivers() {
        messageReceiver?.let {
            try { activity.unregisterReceiver(it) } catch (e: IllegalArgumentException) {
                Log.w(TAG, "Receiver ya desregistrado")
            }
            messageReceiver = null
        }
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        unregisterServerReceivers()
        stopScanInternal()
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
    }
}
