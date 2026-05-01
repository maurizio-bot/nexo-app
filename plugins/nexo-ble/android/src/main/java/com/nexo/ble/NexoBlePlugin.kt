package com.nexo.ble

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * NexoBlePlugin v2.3.2-ARCH — FIX: Callbacks usan checkSelfPermission directo
 * 
 * Correcciones:
 * 1. permissionsCallback/initializeBLECallback usan ContextCompat.checkSelfPermission()
 *    en lugar de getPermissionState() (evita race condition Android 14+ Samsung)
 * 2. Smart cast imposible en var → uso de val local
 * 3. PermissionState enum vs String
 */
@CapacitorPlugin(
    name = "NexoBLE",
    permissions = [
        Permission(
            strings = [Manifest.permission.BLUETOOTH_SCAN],
            alias = "bluetoothScan"
        ),
        Permission(
            strings = [Manifest.permission.BLUETOOTH_ADVERTISE],
            alias = "bluetoothAdvertise"
        ),
        Permission(
            strings = [Manifest.permission.BLUETOOTH_CONNECT],
            alias = "bluetoothConnect"
        ),
        Permission(
            strings = [Manifest.permission.ACCESS_FINE_LOCATION],
            alias = "location"
        )
    ]
)
class NexoBlePlugin : Plugin() {

    companion object {
        private const val TAG = "NexoBlePlugin"
    }

    private var serviceIntent: Intent? = null
    private var broadcastReceiver: BroadcastReceiver? = null
    private var bleService: BleService? = null
    private var serviceBound = false

    private val serviceConnection = object : android.content.ServiceConnection {
        override fun onServiceConnected(name: android.content.ComponentName?, service: android.os.IBinder?) {
            val binder = service as BleService.LocalBinder
            bleService = binder.getService()
            serviceBound = true
            Log.i(TAG, "[BLE_PLUGIN] Servicio vinculado")
        }

        override fun onServiceDisconnected(name: android.content.ComponentName?) {
            bleService = null
            serviceBound = false
            Log.i(TAG, "[BLE_PLUGIN] Servicio desvinculado")
        }
    }

    override fun load() {
        val intent = Intent(context, BleService::class.java)
        serviceIntent = intent
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
        
        registerBroadcastReceiver()
        Log.i(TAG, "[BLE_PLUGIN] NexoBlePlugin v2.3.2-ARCH cargado")
    }

    // ==================== PERMISSIONS ====================

    override fun requestPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAliases(
                arrayOf("bluetoothScan", "bluetoothAdvertise", "bluetoothConnect", "location"),
                call,
                "permissionsCallback"
            )
        } else {
            requestPermissionForAlias("location", call, "permissionsCallback")
        }
    }

    @PermissionCallback
    fun permissionsCallback(call: PluginCall) {
        // FIX v2.3.2: Usar checkSelfPermission directo (evita race condition getPermissionState)
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }

        val ret = JSObject()
        ret.put("granted", granted)
        call.resolve(ret)
    }

    override fun checkPermissions(call: PluginCall) {
        val ret = JSObject()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ret.put("bluetoothScan", getPermissionState("bluetoothScan").name)
            ret.put("bluetoothAdvertise", getPermissionState("bluetoothAdvertise").name)
            ret.put("bluetoothConnect", getPermissionState("bluetoothConnect").name)
            ret.put("location", getPermissionState("location").name)
        } else {
            ret.put("location", getPermissionState("location").name)
        }
        call.resolve(ret)
    }

    // ==================== initializeBLE ====================

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val aliases = arrayOf("bluetoothScan", "bluetoothAdvertise", "bluetoothConnect", "location")
            val allGranted = aliases.all {
                ContextCompat.checkSelfPermission(context, when(it) {
                    "bluetoothScan" -> Manifest.permission.BLUETOOTH_SCAN
                    "bluetoothAdvertise" -> Manifest.permission.BLUETOOTH_ADVERTISE
                    "bluetoothConnect" -> Manifest.permission.BLUETOOTH_CONNECT
                    "location" -> Manifest.permission.ACCESS_FINE_LOCATION
                    else -> Manifest.permission.ACCESS_FINE_LOCATION
                }) == PackageManager.PERMISSION_GRANTED
            }
            
            if (allGranted) {
                val ret = JSObject()
                ret.put("granted", true)
                ret.put("isPermanentlyDenied", false)
                call.resolve(ret)
            } else {
                requestPermissionForAliases(aliases, call, "initializeBLECallback")
            }
        } else {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                val ret = JSObject()
                ret.put("granted", true)
                ret.put("isPermanentlyDenied", false)
                call.resolve(ret)
            } else {
                requestPermissionForAlias("location", call, "initializeBLECallback")
            }
        }
    }

    @PermissionCallback
    fun initializeBLECallback(call: PluginCall) {
        // FIX v2.3.2: Usar checkSelfPermission directo (evita race condition getPermissionState)
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }

        val ret = JSObject()
        ret.put("granted", granted)
        ret.put("isPermanentlyDenied", false)
        call.resolve(ret)
    }

    // ==================== checkBLEStatus ====================

    @PluginMethod
    fun checkBLEStatus(call: PluginCall) {
        val ret = JSObject()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val scanGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
            val advGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
            val connGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
            val locGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

            ret.put("scanGranted", scanGranted)
            ret.put("connectGranted", connGranted)
            ret.put("advertiseGranted", advGranted)
            ret.put("locationGranted", locGranted)
            ret.put("notificationsGranted", true)
            ret.put("foregroundConnectedGranted", true)
            ret.put("allGranted", scanGranted && advGranted && connGranted && locGranted)
            ret.put("isPermanentlyDenied", false)
        } else {
            val locGranted = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            ret.put("scanGranted", locGranted)
            ret.put("connectGranted", locGranted)
            ret.put("advertiseGranted", locGranted)
            ret.put("locationGranted", locGranted)
            ret.put("notificationsGranted", true)
            ret.put("foregroundConnectedGranted", true)
            ret.put("allGranted", locGranted)
            ret.put("isPermanentlyDenied", false)
        }

        call.resolve(ret)
    }

    // ==================== isBluetoothEnabled ====================

    @PluginMethod
    fun isBluetoothEnabled(call: PluginCall) {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter
        val ret = JSObject()
        ret.put("enabled", adapter?.isEnabled == true)
        call.resolve(ret)
    }

    // ==================== SERVICE CONTROL ====================

    @PluginMethod
    fun startService(call: PluginCall) {
        serviceIntent?.let {
            context.startForegroundService(it)
        }
        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun stopService(call: PluginCall) {
        serviceIntent?.let {
            context.stopService(it)
        }
        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    // ==================== ADVERTISING ====================

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val deviceName = call.getString("deviceName")
            ?: (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)
                ?.adapter?.name ?: "NEXO"

        bleService?.startAdvertising(deviceName) ?: run {
            val intent = Intent(context, BleService::class.java).apply {
                action = "START_ADVERTISING"
                putExtra("deviceName", deviceName)
            }
            context.startForegroundService(intent)
        }

        val ret = JSObject()
        ret.put("success", true)
        ret.put("deviceName", deviceName)
        call.resolve(ret)
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        bleService?.stopAdvertising() ?: run {
            val intent = Intent(context, BleService::class.java).apply {
                action = "STOP_ADVERTISING"
            }
            context.startForegroundService(intent)
        }

        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    // ==================== SCAN ====================

    @PluginMethod
    fun startScan(call: PluginCall) {
        bleService?.startScan() ?: run {
            val intent = Intent(context, BleService::class.java).apply {
                action = "START_SCAN"
            }
            context.startForegroundService(intent)
        }

        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        bleService?.stopScan() ?: run {
            val intent = Intent(context, BleService::class.java).apply {
                action = "STOP_SCAN"
            }
            context.startForegroundService(intent)
        }

        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun getScanStatus(call: PluginCall) {
        val ret = JSObject()
        ret.put("isScanning", bleService?.isScanning() ?: false)
        ret.put("resultCount", bleService?.getScanResultCount() ?: 0)
        call.resolve(ret)
    }

    // ==================== CONNECTION & MESSAGING ====================

    @PluginMethod
    fun connectToDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("deviceId requerido")
            return
        }

        val success = bleService?.connectToDevice(deviceId) ?: false
        val ret = JSObject()
        ret.put("success", success)
        call.resolve(ret)
    }

    @PluginMethod
    fun disconnectDevice(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("deviceId requerido")
            return
        }

        bleService?.disconnectDevice(deviceId)
        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("deviceId requerido")
            return
        }
        val message = call.getString("message") ?: run {
            call.reject("message requerido")
            return
        }

        val success = bleService?.sendMessage(deviceId, message) ?: false
        val ret = JSObject()
        ret.put("success", success)
        ret.put("sent", success)
        call.resolve(ret)
    }

    @PluginMethod
    fun getConnectedDevices(call: PluginCall) {
        val devices = bleService?.getConnectedDevices() ?: emptyList()
        val jsArray = JSArray()
        devices.forEach { device ->
            val obj = JSObject()
            obj.put("deviceId", device["deviceId"])
            obj.put("address", device["address"])
            obj.put("name", device["name"])
            jsArray.put(obj)
        }
        val ret = JSObject()
        ret.put("devices", jsArray)
        call.resolve(ret)
    }

    // ==================== BROADCAST RECEIVER ====================

    private fun registerBroadcastReceiver() {
        broadcastReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                when (intent?.action) {
                    BleService.ACTION_SCAN_RESULT -> {
                        val address = intent.getStringExtra(BleService.EXTRA_DEVICE_ADDRESS) ?: return
                        val name = intent.getStringExtra(BleService.EXTRA_DEVICE_NAME) ?: "Unknown"
                        val rssi = intent.getIntExtra(BleService.EXTRA_RSSI, 0)

                        Log.d(TAG, "[BLE_PEER_FOUND] $name [$address] RSSI=$rssi")

                        notifyListeners("onScanResult", JSObject().apply {
                            put("address", address)
                            put("name", name)
                            put("rssi", rssi)
                        })
                    }

                    BleService.ACTION_SCAN_FAILED -> {
                        val errorCode = intent.getIntExtra(BleService.EXTRA_ERROR_CODE, -1)
                        val desc = intent.getStringExtra(BleService.EXTRA_ERROR_DESC) ?: "Unknown"

                        Log.e(TAG, "[BLE_SCAN_FAILED_JS] code=$errorCode, desc=$desc")

                        notifyListeners("onScanFailed", JSObject().apply {
                            put("errorCode", errorCode)
                            put("description", desc)
                        })
                    }

                    BleService.ACTION_SCAN_STOPPED -> {
                        val count = intent.getIntExtra("result_count", 0)
                        Log.i(TAG, "[BLE_SCAN_STOP_JS] Resultados totales: $count")

                        notifyListeners("onScanStopped", JSObject().apply {
                            put("resultCount", count)
                        })
                    }

                    BleService.ACTION_ADVERT_STATE -> {
                        val advertising = intent.getBooleanExtra(BleService.EXTRA_ADVERTISING, false)
                        notifyListeners("onAdvertStateChange", JSObject().apply {
                            put("advertising", advertising)
                        })
                    }

                    BleService.ACTION_MESSAGE_RECEIVED -> {
                        val address = intent.getStringExtra(BleService.EXTRA_DEVICE_ADDRESS) ?: return
                        val message = intent.getStringExtra(BleService.EXTRA_MESSAGE) ?: return

                        notifyListeners("onMessageReceived", JSObject().apply {
                            put("address", address)
                            put("message", message)
                        })
                    }

                    BleService.ACTION_DEVICE_CONNECTED -> {
                        val address = intent.getStringExtra(BleService.EXTRA_DEVICE_ADDRESS) ?: return
                        notifyListeners("onDeviceConnected", JSObject().apply {
                            put("address", address)
                            put("name", intent.getStringExtra(BleService.EXTRA_DEVICE_NAME) ?: "Unknown")
                        })
                    }

                    BleService.ACTION_DEVICE_DISCONNECTED -> {
                        val address = intent.getStringExtra(BleService.EXTRA_DEVICE_ADDRESS) ?: return
                        notifyListeners("onDeviceDisconnected", JSObject().apply {
                            put("address", address)
                        })
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(BleService.ACTION_SCAN_RESULT)
            addAction(BleService.ACTION_SCAN_FAILED)
            addAction(BleService.ACTION_SCAN_STOPPED)
            addAction(BleService.ACTION_ADVERT_STATE)
            addAction(BleService.ACTION_MESSAGE_RECEIVED)
            addAction(BleService.ACTION_DEVICE_CONNECTED)
            addAction(BleService.ACTION_DEVICE_DISCONNECTED)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(broadcastReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(broadcastReceiver, filter)
        }
    }

    override fun handleOnDestroy() {
        broadcastReceiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (e: IllegalArgumentException) {
                // Already unregistered
            }
        }
        if (serviceBound) {
            context.unbindService(serviceConnection)
            serviceBound = false
        }
        super.handleOnDestroy()
    }
}
