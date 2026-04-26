package com.nexo.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

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
    }

    private var messageReceiver: BroadcastReceiver? = null
    private var connectionReceiver: BroadcastReceiver? = null

    @PluginMethod
    fun initializeBLE(call: PluginCall) {
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
        if (getPermissionState("bluetoothScan") == com.getcapacitor.PermissionState.GRANTED ||
            getPermissionState("location") == com.getcapacitor.PermissionState.GRANTED
        ) {
            call.resolve()
        } else {
            call.reject("Permisos BLE denegados")
        }
    }

    @PluginMethod
    fun startBLEAdvertising(call: PluginCall) {
        val context = activity.applicationContext
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        val adapter = bluetoothManager.adapter

        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth desactivado")
            return
        }

        // Iniciar Foreground Service con GATT Server (único dueño)
        val intent = Intent(context, BleService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }

        registerReceivers()
        call.resolve(JSObject().put("status", "advertising_started"))
    }

    @PluginMethod
    fun stopBLEAdvertising(call: PluginCall) {
        val context = activity.applicationContext
        context.stopService(Intent(context, BleService::class.java))
        unregisterReceivers()
        call.resolve(JSObject().put("status", "advertising_stopped"))
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val message = call.getString("message") ?: ""
        val context = activity.applicationContext
        val intent = Intent(NexoBleSpec.ACTION_BLE_SEND_MESSAGE).apply {
            putExtra(NexoBleSpec.EXTRA_MESSAGE_DATA, message)
            setPackage(context.packageName)
        }
        context.sendBroadcast(intent)
        call.resolve(JSObject().put("sent", true))
    }

    @PluginMethod
    fun startListeningMessages(call: PluginCall) {
        registerReceivers()
        call.resolve(JSObject().put("listening", true))
    }

    private fun registerReceivers() {
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

    private fun unregisterReceivers() {
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
        unregisterReceivers()
    }
}
