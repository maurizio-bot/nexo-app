package com.nexo.ble

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "NexoBLE",
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN], alias = "bluetoothScan"),
        Permission(strings = [Manifest.permission.BLUETOOTH_CONNECT], alias = "bluetoothConnect"),
        Permission(strings = [Manifest.permission.BLUETOOTH_ADVERTISE], alias = "bluetoothAdvertise"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "location")
    ]
)
class NexoBlePlugin : Plugin() {

    private val broadcastReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                BleService.ACTION_DATA_RECEIVED -> {
                    val address = intent.getStringExtra(BleService.EXTRA_DEVICE_ADDRESS) ?: ""
                    val data = intent.getStringExtra(BleService.EXTRA_DATA) ?: ""
                    val type = intent.getStringExtra(BleService.EXTRA_CHAR_TYPE) ?: "payload"
                    notifyListeners("onDataReceived", JSObject().apply {
                        put("deviceAddress", address)
                        put("data", data)
                        put("type", type)
                    })
                }
                BleService.ACTION_DEVICE_CONNECTED -> {
                    val address = intent.getStringExtra(BleService.EXTRA_DEVICE_ADDRESS) ?: ""
                    notifyListeners("onDeviceConnected", JSObject().apply {
                        put("deviceAddress", address)
                        put("status", "connected")
                    })
                }
                BleService.ACTION_DEVICE_DISCONNECTED -> {
                    val address = intent.getStringExtra(BleService.EXTRA_DEVICE_ADDRESS) ?: ""
                    notifyListeners("onDeviceDisconnected", JSObject().apply {
                        put("deviceAddress", address)
                        put("status", "disconnected")
                    })
                }
            }
        }
    }

    override fun load() {
        val filter = IntentFilter().apply {
            addAction(BleService.ACTION_DATA_RECEIVED)
            addAction(BleService.ACTION_DEVICE_CONNECTED)
            addAction(BleService.ACTION_DEVICE_DISCONNECTED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(broadcastReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(broadcastReceiver, filter)
        }
    }

    @PluginMethod
    fun requestPermissions(call: PluginCall) {
        requestAllPermissions(call, "permissionCallback")
    }

    @PermissionCallback
    fun permissionCallback(call: PluginCall) {
        if (getPermissionState("bluetoothConnect") == "granted" &&
            getPermissionState("bluetoothScan") == "granted") {
            call.resolve(JSObject().put("granted", true))
        } else {
            call.reject("Permisos BLE requeridos no concedidos")
        }
    }

    @PluginMethod
    fun startBLEAdvertising(call: PluginCall) {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
        if (adapter == null) {
            call.reject("Bluetooth no disponible")
            return
        }
        if (!adapter.isEnabled) {
            call.reject("Bluetooth está apagado")
            return
        }

        val intent = Intent(context, BleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve(JSObject().put("started", true))
    }

    @PluginMethod
    fun stopBLEAdvertising(call: PluginCall) {
        context.stopService(Intent(context, BleService::class.java))
        context.sendBroadcast(Intent(BleService.ACTION_STOP_SERVICE))
        call.resolve(JSObject().put("stopped", true))
    }

    @PluginMethod
    fun sendData(call: PluginCall) {
        val address = call.getString("deviceAddress")
        val data = call.getString("data")
        val type = call.getString("type") ?: "payload"

        if (address.isNullOrEmpty() || data.isNullOrEmpty()) {
            call.reject("Se requiere deviceAddress y data")
            return
        }

        val intent = Intent(BleService.ACTION_SEND_DATA).apply {
            putExtra(BleService.EXTRA_DEVICE_ADDRESS, address)
            putExtra(BleService.EXTRA_DATA, data)
            putExtra(BleService.EXTRA_CHAR_TYPE, type)
        }
        context.sendBroadcast(intent)
        call.resolve(JSObject().put("sent", true))
    }

    @PluginMethod
    fun isConnected(call: PluginCall) {
        call.resolve(JSObject().put("connected", false))
    }

    override fun handleOnDestroy() {
        try { context.unregisterReceiver(broadcastReceiver) } catch (e: IllegalArgumentException) {}
        super.handleOnDestroy()
    }
}
