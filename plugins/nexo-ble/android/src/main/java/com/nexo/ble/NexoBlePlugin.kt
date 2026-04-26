package com.nexo.ble

import android.bluetooth.BluetoothAdapter
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
    name = "NexoBle",
    permissions = [
        Permission(
            strings = [android.Manifest.permission.BLUETOOTH_SCAN],
            alias = "bluetoothScan"
        ),
        Permission(
            strings = [android.Manifest.permission.BLUETOOTH_CONNECT],
            alias = "bluetoothConnect"
        ),
        Permission(
            strings = [android.Manifest.permission.BLUETOOTH_ADVERTISE],
            alias = "bluetoothAdvertise"
        ),
        Permission(
            strings = [android.Manifest.permission.ACCESS_FINE_LOCATION],
            alias = "location"
        ),
        Permission(
            strings = [android.Manifest.permission.POST_NOTIFICATIONS],
            alias = "postNotifications"
        ),
        Permission(
            strings = [android.Manifest.permission.FOREGROUND_SERVICE],
            alias = "foregroundService"
        ),
        Permission(
            strings = [android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE],
            alias = "foregroundServiceConnectedDevice"
        )
    ]
)
class NexoBlePlugin : Plugin() {

    companion object {
        private const val TAG = "NexoBlePlugin"
        private const val SCAN_TIMEOUT_MS = 15000L
    }

    // ========== SERVER (GATT + Advertising) ==========
    private var messageReceiver: BroadcastReceiver? = null

    // ========== CLIENT (Scan + GATT Connection) ==========
    private var bluetoothScanner: BluetoothLeScanner? = null
    private var bluetoothGatt: BluetoothGatt? = null
    private var clientTxCharacteristic: BluetoothGattCharacteristic? = null
    private var clientRxCharacteristic: BluetoothGattCharacteristic? = null
    private val scanResults = mutableListOf<JSObject>()
    private var scanCall: PluginCall? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val scanTimeoutRunnable = Runnable { stopScanInternal() }

    // ====================================================

    /**
     * Lee el estado REAL de los permisos directamente del sistema operativo.
     * NO usa el cache de Capacitor porque en Android 14+ queda desactualizado tras el diálogo nativo.
     */
    @PluginMethod
    fun checkBLEStatus(call: PluginCall) {
        val ctx = activity.applicationContext
        val result = JSObject()

        val scanGranted = ContextCompat.checkSelfPermission(
            ctx, android.Manifest.permission.BLUETOOTH_SCAN
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        val connectGranted = ContextCompat.checkSelfPermission(
            ctx, android.Manifest.permission.BLUETOOTH_CONNECT
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        val advertiseGranted = ContextCompat.checkSelfPermission(
            ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        val locationGranted = ContextCompat.checkSelfPermission(
            ctx, android.Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        val notificationsGranted = ContextCompat.checkSelfPermission(
            ctx, android.Manifest.permission.POST_NOTIFICATIONS
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        val allGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            scanGranted && connectGranted && advertiseGranted && notificationsGranted
        } else {
            locationGranted && notificationsGranted
        }

        // Detectar denegación permanente: si no está concedido Y no debemos mostrar rationale
        var isPermanentlyDenied = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!scanGranted && !ActivityCompat.shouldShowRequestPermissionRationale(
                    activity, android.Manifest.permission.BLUETOOTH_SCAN
                )
            ) {
                isPermanentlyDenied = true
            }
        } else {
            if (!locationGranted && !ActivityCompat.shouldShowRequestPermissionRationale(
                    activity, android.Manifest.permission.ACCESS_FINE_LOCATION
                )
            ) {
                isPermanentlyDenied = true
            }
        }

        result.put("scanGranted", scanGranted)
        result.put("connectGranted", connectGranted)
        result.put("advertiseGranted", advertiseGranted)
        result.put("locationGranted", locationGranted)
        result.put("notificationsGranted", notificationsGranted)
        result.put("allGranted", allGranted)
        result.put("isPermanentlyDenied", isPermanentlyDenied)

        Log.i(TAG, "checkBLEStatus REAL: allGranted=$allGranted, permanentlyDenied=$isPermanentlyDenied")
        call.resolve(result)
    }

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        // Verificar estado REAL antes de mostrar diálogo
        val ctx = activity.applicationContext
        val alreadyGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.BLUETOOTH_SCAN) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED &&
                    ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.BLUETOOTH_CONNECT) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED &&
                    ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.BLUETOOTH_ADVERTISE) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED &&
                    ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED &&
                    ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.POST_NOTIFICATIONS) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
        }

        if (alreadyGranted) {
            Log.i(TAG, "initializeBLE: permisos ya concedidos, saltando diálogo")
            call.resolve()
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAliases(
                arrayOf("bluetoothScan", "bluetoothConnect", "bluetoothAdvertise", "postNotifications"),
                call,
                "permissionsCallback"
            )
        } else {
            requestPermissionForAliases(
                arrayOf("location", "postNotifications"),
                call,
                "permissionsCallback"
            )
        }
    }

    @PermissionCallback
    fun permissionsCallback(call: PluginCall) {
        // Usar lectura REAL del sistema, no getPermissionState()
        val ctx = activity.applicationContext
        val scanGranted = ContextCompat.checkSelfPermission(
            ctx, android.Manifest.permission.BLUETOOTH_SCAN
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        val locationGranted = ContextCompat.checkSelfPermission(
            ctx, android.Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        val granted = scanGranted || locationGranted
        Log.i(TAG, "permissionsCallback REAL: granted=$granted")

        if (granted) {
            call.resolve()
        } else {
            call.reject("Permisos BLE denegados")
        }
    }

    // ==================== SERVER METHODS ====================

    @PluginMethod
    fun startBLEAdvertising(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter

        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth desactivado")
            return
        }

        val intent = Intent(context, BleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }

        registerServerReceivers()
        call.resolve(JSObject().put("status", "advertising_started"))
    }

    @PluginMethod
    fun stopBLEAdvertising(call: PluginCall) {
        val context = activity.applicationContext
        context.stopService(Intent(context, BleService::class.java))
        unregisterServerReceivers()
        call.resolve(JSObject().put("status", "advertising_stopped"))
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val message = call.getString("message") ?: ""

        if (bluetoothGatt != null && clientRxCharacteristic != null) {
            val data = message.toByteArray(Charset.defaultCharset())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val success = bluetoothGatt?.writeCharacteristic(
                    clientRxCharacteristic!!,
                    data,
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                ) == BluetoothGatt.GATT_SUCCESS
                call.resolve(JSObject().put("sent", success).put("mode", "client"))
            } else {
                clientRxCharacteristic?.value = data
                val success = bluetoothGatt?.writeCharacteristic(clientRxCharacteristic) ?: false
                call.resolve(JSObject().put("sent", success).put("mode", "client"))
            }
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

    @PluginMethod
    fun startListeningMessages(call: PluginCall) {
        registerServerReceivers()
        call.resolve(JSObject().put("listening", true))
    }

    // ==================== CLIENT METHODS ====================

    @PluginMethod
    fun scanForDevices(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter

        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth desactivado")
            return
        }

        bluetoothScanner = adapter.bluetoothLeScanner
        scanResults.clear()
        scanCall = call

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(NexoBleSpec.NEXO_SERVICE_UUID))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        try {
            bluetoothScanner?.startScan(listOf(filter), settings, scanCallback)
            mainHandler.postDelayed(scanTimeoutRunnable, SCAN_TIMEOUT_MS)
        } catch (e: SecurityException) {
            call.reject("Permiso BLUETOOTH_SCAN no concedido: ${e.message}")
        }
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        stopScanInternal()
        call.resolve(JSObject().put("stopped", true))
    }

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val address = call.getString("address") ?: ""
        if (address.isEmpty()) {
            call.reject("Dirección MAC requerida")
            return
        }

        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter
        val device = adapter.getRemoteDevice(address)

        bluetoothGatt?.close()
        bluetoothGatt = null
        clientTxCharacteristic = null
        clientRxCharacteristic = null

        bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            device.connectGatt(context, false, gattClientCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
            device.connectGatt(context, false, gattClientCallback)
        }

        call.resolve(JSObject().put("connecting", true).put("address", address))
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        bluetoothGatt?.disconnect()
        bluetoothGatt?.close()
        bluetoothGatt = null
        clientTxCharacteristic = null
        clientRxCharacteristic = null
        call.resolve(JSObject().put("disconnected", true))
    }

    // ==================== SCAN CALLBACK ====================

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.device?.let { device ->
                val name = device.name ?: "Unknown"
                val addr = device.address
                if (scanResults.none { it.getString("address") == addr }) {
                    val item = JSObject()
                    item.put("name", name)
                    item.put("address", addr)
                    item.put("rssi", result.rssi)
                    scanResults.add(item)

                    val ret = JSObject()
                    ret.put("event", "deviceFound")
                    ret.put("device", item)
                    notifyListeners("bleDeviceFound", ret)
                }
            }
        }

        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "Scan failed with error: $errorCode")
            val ret = JSObject()
            ret.put("event", "scanFailed")
            ret.put("errorCode", errorCode)
            notifyListeners("bleScanFailed", ret)
        }
    }

    private fun stopScanInternal() {
        mainHandler.removeCallbacks(scanTimeoutRunnable)
        try {
            bluetoothScanner?.stopScan(scanCallback)
        } catch (e: Exception) {
            Log.w(TAG, "Error stopping scan", e)
        }
        bluetoothScanner = null

        scanCall?.let { call ->
            if (call.isKeptAlive) {
                val result = JSObject()
                result.put("devices", JSArray(scanResults))
                call.resolve(result)
            }
            scanCall = null
        }
    }

    // ==================== GATT CLIENT CALLBACK ====================

    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val address = gatt.device?.address ?: ""
            Log.i(TAG, "Client onConnectionStateChange $address status=$status newState=$newState")

            if (newState == BluetoothProfile.STATE_CONNECTED) {
                val ret = JSObject()
                ret.put("event", "clientConnected")
                ret.put("address", address)
                notifyListeners("bleClientConnected", ret)
                gatt.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                val ret = JSObject()
                ret.put("event", "clientDisconnected")
                ret.put("address", address)
                notifyListeners("bleClientDisconnected", ret)

                bluetoothGatt?.close()
                bluetoothGatt = null
                clientTxCharacteristic = null
                clientRxCharacteristic = null
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.e(TAG, "Service discovery failed: $status")
                return
            }

            val service = gatt.getService(NexoBleSpec.NEXO_SERVICE_UUID)
            if (service == null) {
                Log.e(TAG, "NEXO service not found on remote device")
                return
            }

            clientTxCharacteristic = service.getCharacteristic(NexoBleSpec.TX_CHARACTERISTIC_UUID)
            clientRxCharacteristic = service.getCharacteristic(NexoBleSpec.RX_CHARACTERISTIC_UUID)

            clientTxCharacteristic?.let { characteristic ->
                val success = gatt.setCharacteristicNotification(characteristic, true)
                Log.i(TAG, "setCharacteristicNotification success=$success")

                val descriptor = characteristic.getDescriptor(NexoBleSpec.CCCD_UUID)
                if (descriptor != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        gatt.writeDescriptor(
                            descriptor,
                            BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        )
                    } else {
                        descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        gatt.writeDescriptor(descriptor)
                    }
                }
            }

            val ret = JSObject()
            ret.put("event", "servicesDiscovered")
            ret.put("ready", true)
            notifyListeners("bleClientReady", ret)
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            if (characteristic.uuid == NexoBleSpec.TX_CHARACTERISTIC_UUID) {
                val message = characteristic.value?.toString(Charset.defaultCharset()) ?: ""
                val address = gatt.device?.address ?: ""
                Log.i(TAG, "Client received message from $address: $message")

                val ret = JSObject()
                ret.put("event", "messageReceived")
                ret.put("message", message)
                ret.put("device", address)
                notifyListeners("bleMessageReceived", ret)
            }
        }

        override fun onDescriptorWrite(
            gatt: BluetoothGatt,
            descriptor: BluetoothGattDescriptor,
            status: Int
        ) {
            Log.i(TAG, "onDescriptorWrite ${descriptor.uuid} status=$status")
        }
    }

    // ==================== SERVER RECEIVERS ====================

    private fun registerServerReceivers() {
        if (messageReceiver != null) return

        messageReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED -> {
                        val msg = intent.getStringExtra(NexoBleSpec.EXTRA_MESSAGE_DATA) ?: ""
                        val device = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                        val ret = JSObject()
                        ret.put("event", "messageReceived")
                        ret.put("message", msg)
                        ret.put("device", device)
                        notifyListeners("bleMessageReceived", ret)
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED -> {
                        val ret = JSObject()
                        ret.put("event", "deviceConnected")
                        ret.put("device", intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS))
                        notifyListeners("bleDeviceConnected", ret)
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_DISCONNECTED -> {
                        val ret = JSObject()
                        ret.put("event", "deviceDisconnected")
                        ret.put("device", intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS))
                        notifyListeners("bleDeviceDisconnected", ret)
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
            try {
                activity.unregisterReceiver(it)
            } catch (e: IllegalArgumentException) {
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
