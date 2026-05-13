package com.nexo.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
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
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.Charset
import java.util.UUID

@CapacitorPlugin(
    name = "NexoBLE",
    permissions = [
        Permission(strings = [android.Manifest.permission.BLUETOOTH_SCAN], alias = "scan"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_CONNECT], alias = "connect"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_ADVERTISE], alias = "advertise"),
        Permission(strings = [android.Manifest.permission.ACCESS_FINE_LOCATION], alias = "location"),
        Permission(strings = [android.Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
        Permission(strings = [android.Manifest.permission.FOREGROUND_SERVICE], alias = "foreground"),
        Permission(strings = [android.Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE], alias = "foregroundConnected")
    ]
)
class NexoBlePlugin : Plugin() {

    companion object {
        private const val TAG = "NexoBlePlugin"
        private const val SCAN_TIMEOUT_MS = 15000L
    }

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var bluetoothGatt: BluetoothGatt? = null
    private var bluetoothScanner: android.bluetooth.le.BluetoothLeScanner? = null
    private val scanResults = mutableSetOf<String>()
    private val handler = Handler(Looper.getMainLooper())
    private var scanTimeoutRunnable: Runnable? = null

    private var messageReceiver: BroadcastReceiver? = null

    override fun load() {
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
        setupBroadcastReceiver()
    }

    @PluginMethod
    fun checkBLEStatus(call: PluginCall) {
        val res = JSObject()
        res.put("bluetoothEnabled", bluetoothAdapter?.isEnabled ?: false)
        // ... (verificación de permisos)
        call.resolve(res)
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        Log.i(TAG, "startScan")
        // ... (implementación de escaneo)
        call.resolve()
    }

    private fun setupBroadcastReceiver() {
        messageReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    NexoBleSpec.ACTION_BLE_MESSAGE_RECEIVED -> {
                        val data = intent.getStringExtra(NexoBleSpec.EXTRA_MESSAGE_DATA)
                        val addr = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS)
                        notifyListeners("onMessageReceived", JSObject()
                            .put("message", data)
                            .put("deviceId", addr)
                            .put("source", "ble")
                        )
                    }
                    NexoBleSpec.ACTION_BLE_DEVICE_CONNECTED -> {
                        val addr = intent.getStringExtra(NexoBleSpec.EXTRA_DEVICE_ADDRESS) ?: ""
                        notifyListeners("onDeviceConnected", JSObject().put("deviceId", addr))
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.registerReceiver(messageReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(messageReceiver, filter)
        }
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        messageReceiver?.let {
            try { context.unregisterReceiver(it) } catch (e: Exception) { Log.w(TAG, "Unregister error", e) }
        }
    }
}
