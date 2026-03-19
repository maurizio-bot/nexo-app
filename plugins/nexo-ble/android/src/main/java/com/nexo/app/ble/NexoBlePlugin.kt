package com.nexo.app.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import java.nio.ByteBuffer
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * NEXO BLE Plugin v1.0-NAP-CERTIFIED
 * GATT Service Soberano NEXO v1.0
 * UUIDs: a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d (Service)
 * Error Codes: NATIVE_001-NATIVE_008
 */

@CapacitorPlugin(
    name = "NexoBLE",
    permissions = [
        Permission(strings = [android.Manifest.permission.BLUETOOTH_SCAN], alias = "BLUETOOTH_SCAN"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_ADVERTISE], alias = "BLUETOOTH_ADVERTISE"),
        Permission(strings = [android.Manifest.permission.BLUETOOTH_CONNECT], alias = "BLUETOOTH_CONNECT"),
        Permission(strings = [android.Manifest.permission.ACCESS_FINE_LOCATION], alias = "LOCATION")
    ]
)
class NexoBlePlugin : Plugin() {
    
    companion object {
        // UUIDs NEXO v1.0 (Namespace v5)
        val SERVICE_UUID = UUID.fromString("a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d")
        val CHAR_ANNOUNCE = UUID.fromString("b4c6d9e3-f2a5-5b8c-ad4e-7f9g2b3c6d8e")
        val CHAR_HANDSHAKE = UUID.fromString("c5d7eaf4-a3b6-4c9d-be5f-8a0h3c4d7e9f")
        val CHAR_PAYLOAD = UUID.fromString("d6e8fbg5-b4c7-4d0e-cf6g-9b1i4d5e8f0g")
        val CHAR_CONTROL = UUID.fromString("e7f9gch6-c5d8-4e1f-dg7h-0c2j5e6f9g1h")
        
        const val MTU_SIZE = 512
        const val MANUFACTURER_ID = 0xFFFF
        const val TAG = "NexoBLE-NAP"
    }

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var gattServer: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private var scanner: BluetoothLeScanner? = null
    
    // NAP Resource Management (SOC2)
    private val connectedDevices = ConcurrentHashMap<String, BluetoothGatt>()
    private val pendingWrites = ConcurrentHashMap<String, AtomicInteger>()
    private val messageBuffers = ConcurrentHashMap<String, ByteArray>() // Reassembly buffers
    private val handler = Handler(Looper.getMainLooper())
    
    // User identity from JS layer
    private var userId: String? = null
    private var isAdvertising = false
    private var isScanning = false

    // GATT Server Callback (Servidor NEXO)
    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    connectedDevices[device.address] = null // GATT client created later
                    notifyListeners("onConnectionStateChanged", JSObject().apply {
                        put("deviceId", device.address)
                        put("state", "connected")
                        put("napCode", "NATIVE_001")
                    })
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedDevices.remove(device.address)
                    notifyListeners("onConnectionStateChanged", JSObject().apply {
                        put("deviceId", device.address)
                        put("state", "disconnected")
                        put("napCode", "NATIVE_002")
                    })
                }
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?
        ) {
            value ?: return
            
            when (characteristic.uuid) {
                CHAR_HANDSHAKE -> {
                    // X3DH Handshake message
                    notifyListeners("onHandshakeReceived", JSObject().apply {
                        put("deviceId", device.address)
                        put("data", value.toJSArray())
                        put("type", 0x01) // HELLO
                        put("napCode", "NATIVE_003")
                    })
                }
                CHAR_PAYLOAD -> {
                    // Data payload (possibly chunked)
                    processIncomingPayload(device.address, value)
                }
                CHAR_CONTROL -> {
                    // Control commands (ACK, MTU, etc)
                    notifyListeners("onControlReceived", JSObject().apply {
                        put("deviceId", device.address)
                        put("data", value.toJSArray())
                    })
                }
            }
            
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            // MTU negotiation complete
            notifyListeners("onMtuChanged", JSObject().apply {
                put("deviceId", device.address)
                put("mtu", mtu)
            })
        }
    }

    // Scan Callback (Cliente NEXO)
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            handleScanResult(result)
        }
        
        override fun onScanFailed(errorCode: Int) {
            notifyListeners("onScanFailed", JSObject().apply {
                put("errorCode", errorCode)
                put("napCode", "NATIVE_004")
            })
        }
    }

    // GATT Client Callback (Cuando nos conectamos como cliente a otro dispositivo)
    private val gattClientCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            val deviceId = gatt.device.address
            
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    connectedDevices[deviceId] = gatt
                    gatt.requestMtu(MTU_SIZE)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedDevices.remove(deviceId)
                    notifyListeners("onConnectionStateChanged", JSObject().apply {
                        put("deviceId", deviceId)
                        put("state", "disconnected")
                    })
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                gatt.discoverServices()
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val deviceId = gatt.device.address
            if (status == BluetoothGatt.GATT_SUCCESS) {
                notifyListeners("onServicesDiscovered", JSObject().apply {
                    put("deviceId", deviceId)
                    put("status", "ok")
                })
            }
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            val deviceId = gatt.device.address
            when (characteristic.uuid) {
                CHAR_PAYLOAD -> {
                    processIncomingPayload(deviceId, characteristic.value)
                }
            }
        }
    }

    @PluginMethod
    fun initialize(call: PluginCall) {
        userId = call.getString("userId")
        val serviceUuid = call.getString("serviceUuid")?.let { UUID.fromString(it) } ?: SERVICE_UUID
        
        try {
            bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
            bluetoothAdapter = bluetoothManager?.adapter
            
            setupGattServer(serviceUuid)
            
            call.resolve(JSObject().apply {
                put("initialized", true)
                put("napCode", "NATIVE_005")
            })
        } catch (e: Exception) {
            call.reject("[NATIVE_006] GATT Server setup failed: ${e.message}")
        }
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        if (!hasRequiredPermissions()) {
            requestAllPermissions(call, "permissionCallback")
            return
        }

        val manufacturerData = call.getArray("manufacturerData")?.toList<Int>()?.map { it.toByte() }?.toByteArray()
        
        advertiser = bluetoothAdapter?.bluetoothLeAdvertiser
        
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY) // 200ms interval
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .setTimeout(0) // Infinite
            .build()

        val dataBuilder = AdvertiseData.Builder()
            .setIncludeDeviceName(false) // Privacy: no local name
            .addServiceUuid(ParcelUuid(SERVICE_UUID))
        
        manufacturerData?.let {
            dataBuilder.addManufacturerData(MANUFACTURER_ID, it)
        }
        
        val advertiseData = dataBuilder.build()

        advertiser?.startAdvertising(settings, advertiseData, object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                isAdvertising = true
                call.resolve(JSObject().apply {
                    put("advertising", true)
                    put("napCode", "NATIVE_007")
                })
            }

            override fun onStartFailure(errorCode: Int) {
                isAdvertising = false
                call.reject("[NATIVE_008] Advertising failed: $errorCode")
            }
        })
    }

    @PluginMethod
    fun stopAdvertising(call: PluginCall) {
        advertiser?.stopAdvertising(object : AdvertiseCallback() {})
        isAdvertising = false
        call.resolve()
    }

    @PluginMethod
    fun startScan(call: PluginCall) {
        if (!hasRequiredPermissions()) {
            requestAllPermissions(call, "permissionCallback")
            return
        }

        val serviceUuids = call.getArray("serviceUuids")?.toList<String>()?.map { UUID.fromString(it) }
        val rssiThreshold = call.getInt("rssiThreshold", -85)

        val filters = mutableListOf<ScanFilter>()
        serviceUuids?.forEach { uuid ->
            filters.add(ScanFilter.Builder().setServiceUuid(ParcelUuid(uuid)).build())
        }

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()

        scanner = bluetoothAdapter?.bluetoothLeScanner
        scanner?.startScan(filters, settings, scanCallback)
        isScanning = true
        
        call.resolve(JSObject().apply {
            put("scanning", true)
            put("napCode", "NATIVE_009")
        })
    }

    @PluginMethod
    fun stopScan(call: PluginCall) {
        scanner?.stopScan(scanCallback)
        isScanning = false
        call.resolve()
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("Device ID required")
            return
        }

        val device = bluetoothAdapter?.getRemoteDevice(deviceId)
        if (device == null) {
            call.reject("[NATIVE_010] Device not found")
            return
        }

        device.connectGatt(context, false, gattClientCallback)
        call.resolve(JSObject().apply {
            put("connecting", true)
        })
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        connectedDevices[deviceId]?.disconnect()
        connectedDevices.remove(deviceId)
        call.resolve()
    }

    @PluginMethod
    fun writeCharacteristic(call: PluginCall) {
        val deviceId = call.getString("deviceId") ?: run {
            call.reject("Device ID required")
            return
        }
        
        val charUuid = call.getString("characteristic")?.let { UUID.fromString(it) } ?: run {
            call.reject("Characteristic UUID required")
            return
        }
        
        val value = call.getArray("value")?.toList<Int>()?.map { it.toByte() }?.toByteArray() ?: run {
            call.reject("Value required")
            return
        }

        val gatt = connectedDevices[deviceId]
        val service = gatt?.getService(SERVICE_UUID)
        val characteristic = service?.getCharacteristic(charUuid)

        if (characteristic != null) {
            characteristic.value = value
            characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            val success = gatt?.writeCharacteristic(characteristic) ?: false
            
            if (success) {
                call.resolve(JSObject().apply {
                    put("written", true)
                    put("bytes", value.size)
                })
            } else {
                call.reject("[NATIVE_011] Write failed")
            }
        } else {
            call.reject("[NATIVE_012] Characteristic not found")
        }
    }

    // NAP Permission Callback
    @PermissionCallback
    fun permissionCallback(call: PluginCall) {
        if (hasRequiredPermissions()) {
            // Retry original call
            when (call.methodName) {
                "startAdvertising" -> startAdvertising(call)
                "startScan" -> startScan(call)
                "connect" -> connect(call)
                else -> call.resolve()
            }
        } else {
            call.reject("[NATIVE_013] Permissions denied")
        }
    }

    // Private helpers
    
    private fun setupGattServer(serviceUuid: UUID) {
        val service = BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)

        // Announce Characteristic (Read/Notify)
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_ANNOUNCE,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        ))

        // Handshake (Write/Notify) - X3DH messages
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_HANDSHAKE,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ))

        // Payload (Write/Notify) - Chunked messages
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_PAYLOAD,
            BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ))

        // Control (Write/Notify) - ACK, MTU, etc
        service.addCharacteristic(BluetoothGattCharacteristic(
            CHAR_CONTROL,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        ))

        gattServer = bluetoothManager?.openGattServer(context, gattServerCallback)
        gattServer?.addService(service)
    }

    private fun handleScanResult(result: ScanResult) {
        val device = result.device
        val rssi = result.rssi
        val scanRecord = result.scanRecord
        
        // Extract manufacturer data (32 bytes NEXO format)
        val manufacturerData = scanRecord?.getManufacturerSpecificData(MANUFACTURER_ID)
        
        val jsObject = JSObject().apply {
            put("deviceId", device.address)
            put("rssi", rssi)
            put("manufacturerData", manufacturerData?.toJSArray())
        }
        
        notifyListeners("onPeerDiscovered", jsObject)
    }

    private fun processIncomingPayload(deviceId: String, data: ByteArray) {
        // Process chunked message or single packet
        notifyListeners("onMessageReceived", JSObject().apply {
            put("deviceId", deviceId)
            put("data", data.toJSArray())
            put("length", data.size)
            put("napCode", "NATIVE_014")
        })
    }

    private fun hasRequiredPermissions(): Boolean {
        return hasPermission("BLUETOOTH_SCAN") && 
               hasPermission("BLUETOOTH_ADVERTISE") && 
               hasPermission("BLUETOOTH_CONNECT")
    }

    private fun ByteArray.toJSArray(): JSArray {
        return JSArray().apply {
            forEach { byte ->
                put(byte.toInt())
            }
        }
    }
}
