package com.nexo.ble

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import java.util.UUID

@CapacitorPlugin(
    name = "NexoBLE",
    permissions = [
        Permission(
            strings = [
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT
            ],
            alias = "blePermissions"
        )
    ]
)
class NexoBlePlugin : Plugin() {

    private val SERVICE_UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
    private val CHAR_TX = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")
    private val CHAR_RX = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")

    private lateinit var bluetoothManager: BluetoothManager
    private val scope = CoroutineScope(Dispatchers.Main)
    
    private var serverManager: NexoBleServer? = null
    private val clientManagers = mutableMapOf<String, NexoBleManager>()
    private val discoveredDevices = mutableMapOf<String, BluetoothDevice>()

    @PluginMethod
    fun initialize(call: PluginCall) {
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        
        if (bluetoothManager.adapter == null) {
            call.reject("Bluetooth no disponible")
            return
        }
        
        call.resolve()
    }

    @PluginMethod
    fun checkPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val scan = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
            val advertise = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED
            val connect = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
            
            val ret = JSObject()
            ret.put("scan", scan)
            ret.put("advertise", advertise)
            ret.put("connect", connect)
            ret.put("granted", scan && advertise && connect)
            call.resolve(ret)
        } else {
            call.resolve(JSObject().put("granted", true))
        }
    }

    @PluginMethod
    fun requestPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAliases(arrayOf("blePermissions"), call, "permissionCallback")
        } else {
            call.resolve()
        }
    }

    @PermissionCallback
    private fun permissionCallback(call: PluginCall) {
        if (getPermissionState("blePermissions") == PermissionState.GRANTED) {
            call.resolve()
        } else {
            call.reject("Permisos denegados")
        }
    }

    // ==================== PERIPHERAL ====================

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) != PackageManager.PERMISSION_GRANTED) {
                call.reject("Sin permiso BLUETOOTH_ADVERTISE")
                return
            }
        }

        val deviceName = call.getString("deviceName", "NEXO")

        serverManager = NexoBleServer(
            context = context,
            serviceUuid = SERVICE_UUID,
            charTxUuid = CHAR_TX,
            charRxUuid = CHAR_RX,
            onDeviceConnected = { device ->
                val data = JSObject()
                data.put("deviceId", device.address)
                data.put("name", device.name ?: "NEXO")
                notifyListeners("peerConnected", data)
            },
            onDeviceDisconnected = { device ->
                notifyListeners("peerDisconnected", JSObject().put("deviceId", device.address))
            },
            onMessageReceived = { device, bytes ->
                val data = JSObject()
                data.put("deviceId", device.address)
                data.put("data", JSArray(bytes.toList()))
                notifyListeners("messageReceived", data)
            }
        )

        serverManager?.startAdvertising(deviceName) { success, error ->
            if (success) {
                notifyListeners("advertisingStarted", null)
                call.resolve()
            } else {
                call.reject(error ?: "Error advertising")
            }
        }
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        serverManager?.stopAdvertising()
        serverManager = null
        call.resolve()
    }

    // ==================== CENTRAL ====================

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                call.reject("Sin permiso BLUETOOTH_SCAN")
                return
            }
        }

        val manager = NexoBleManager(context)
        
        manager.scanForNexo(SERVICE_UUID) { result ->
            val device = result.device
            discoveredDevices[device.address] = device
            
            val data = JSObject()
            data.put("deviceId", device.address)
            data.put("name", device.name ?: "NEXO-${device.address.takeLast(4)}")
            data.put("rssi", result.rssi)
            notifyListeners("deviceFound", data)
        }

        call.resolve()
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId requerido")
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                call.reject("Sin permiso BLUETOOTH_CONNECT")
                return
            }
        }

        val device = discoveredDevices[deviceId] ?: bluetoothManager.adapter.getRemoteDevice(deviceId)
        val manager = NexoBleManager(context)
        clientManagers[deviceId] = manager
        
        manager.connectToNexo(device, SERVICE_UUID, CHAR_TX, CHAR_RX,
            onConnected = {
                notifyListeners("connected", JSObject().put("deviceId", deviceId))
            },
            onFailed = { reason ->
                call.reject("Fallo: $reason")
            },
            onMessageReceived = { bytes ->
                val data = JSObject()
                data.put("deviceId", deviceId)
                data.put("data", JSArray(bytes.toList()))
                notifyListeners("messageReceived", data)
            }
        )

        call.resolve()
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId requerido")
        clientManagers[deviceId]?.disconnect()?.enqueue()
        clientManagers.remove(deviceId)
        call.resolve()
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: return call.reject("deviceId requerido")
        val text = call.getString("text") ?: return call.reject("texto requerido")
        
        clientManagers[deviceId]?.sendMessage(text.toByteArray(Charsets.UTF_8))
        call.resolve()
    }

    @PluginMethod
    fun broadcast(call: PluginCall) {
        val text = call.getString("text") ?: return call.reject("texto requerido")
        val bytes = text.toByteArray(Charsets.UTF_8)
        
        var count = 0
        clientManagers.forEach { (_, manager) ->
            manager.sendMessage(bytes)
            count++
        }
        
        val ret = JSObject()
        ret.put("count", count)
        call.resolve(ret)
    }
}

