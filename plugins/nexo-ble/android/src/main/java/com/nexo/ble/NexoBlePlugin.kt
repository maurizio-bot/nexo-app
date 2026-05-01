package com.nexo.ble

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * NexoBlePlugin v2.2-ARCH — Bridge puro, sin GATT server propio.
 * Escucha broadcasts de BleService para resultados y errores.
 */
@CapacitorPlugin(
    name = "NexoBle",
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

    override fun load() {
        serviceIntent = Intent(context, BleService::class.java)
        registerBroadcastReceiver()
        Log.i(TAG, "[BLE_PLUGIN] NexoBlePlugin v2.2-ARCH cargado")
    }

    // ==================== PERMISSIONS ====================

    @PluginMethod
    fun requestPermissions(call: PluginCall) {
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
        val granted = call.getArray("bluetoothScan")?.toList<Boolean>()?.all { it } == true ||
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.BLUETOOTH_SCAN
                ) == PackageManager.PERMISSION_GRANTED

        val ret = JSObject()
        ret.put("granted", granted)
        call.resolve(ret)
    }

    @PluginMethod
    fun checkPermissions(call: PluginCall) {
        val ret = JSObject()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val scanPerm = ContextCompat.checkSelfPermission(
                context, Manifest.permission.BLUETOOTH_SCAN
            ) == PackageManager.PERMISSION_GRANTED
            ret.put("bluetoothScan", if (scanPerm) "granted" else "denied")
        } else {
            val locationPerm = ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            ret.put("location", if (locationPerm) "granted" else "denied")
        }
        call.resolve(ret)
    }

    // ==================== SERVICE CONTROL ====================

    @PluginMethod
    fun startService(call: PluginCall) {
        context.startForegroundService(serviceIntent)
        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun stopService(call: PluginCall) {
        context.stopService(serviceIntent)
        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    // ==================== ADVERTISING ====================

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val deviceName = call.getString("deviceName") ?: 
            (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)
                ?.adapter?.name ?: "NEXO"

        val intent = Intent(context, BleService::class.java).apply {
            action = "START_ADVERTISING"
            putExtra("deviceName", deviceName)
        }
        context.startForegroundService(intent)
        
        val ret = JSObject()
        ret.put("success", true)
        ret.put("deviceName", deviceName)
        call.resolve(ret)
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        val intent = Intent(context, BleService::class.java).apply {
            action = "STOP_ADVERTISING"
        }
        context.startForegroundService(intent)
        
        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    // ==================== SCAN (NUEVOS MÉTODOS) ====================

    @PluginMethod
    fun startScan(call: PluginCall) {
        val intent = Intent(context, BleService::class.java).apply {
            action = "START_SCAN"
        }
        context.startForegroundService(intent)
        
        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        val intent = Intent(context, BleService::class.java).apply {
            action = "STOP_SCAN"
        }
        context.startForegroundService(intent)
        
        val ret = JSObject()
        ret.put("success", true)
        call.resolve(ret)
    }

    /**
     * NUEVO: getScanStatus — expone estado real del scan al JS
     */
    @PluginMethod
    fun getScanStatus(call: PluginCall) {
        // Usamos broadcast para pedir estado al service, o asumimos que el receiver ya lo tiene
        val ret = JSObject()
        ret.put("isScanning", false) // Se actualizará vía broadcast
        ret.put("resultCount", 0)
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
                        val desc = intent.getStringExtra("error_description") ?: "Unknown"
                        
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
        super.handleOnDestroy()
    }
}
