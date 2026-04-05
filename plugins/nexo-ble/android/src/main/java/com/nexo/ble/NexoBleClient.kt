package com.nexo.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import com.getcapacitor.JSObject
import com.nexo.ble.model.NexoGattService
import org.json.JSONArray
import java.util.*
import java.util.concurrent.ConcurrentHashMap

class NexoBleClient(
    private val context: Context,
    private val notifyListeners: (String, JSObject) -> Unit
) {
    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val bluetoothAdapter = bluetoothManager.adapter
    private var scanner: BluetoothLeScanner? = null
    private val connections = ConcurrentHashMap<String, BluetoothGatt>()
    private val messageChunker = com.nexo.ble.MessageChunker()  // ✅ Referencia completa
    private val TAG = "NexoBle-Client"
    private val mainHandler = Handler(Looper.getMainLooper())

    // ✅ ScanCallback completo (no omitido)
    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.let {
                val device = it.device
                val uuids = it.scanRecord?.serviceUuids?.map { uuid -> uuid.uuid.toString() } ?: listOf()
                
                val eventData = JSObject().apply {
                    put("deviceId", device.address)
                    put("name", device.name ?: "Unknown")
                    put("rssi", it.rssi)
                    put("uuids", JSONArray(uuids))
                }
                notifyEvent("onScanResult", eventData)
            }
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            results?.forEach { onScanResult(0, it) }
        }

        override fun onScanFailed(errorCode: Int) {
            notifyEvent("onScanFailed", JSObject().apply {
                put("errorCode", errorCode)
            })
        }
    }

    private fun handleCharacteristicValue(deviceId: String, uuid: UUID, value: ByteArray) {
        when (uuid) {
            NexoGattService.PAYLOAD_CHAR_UUID -> {
                val completeMessage = messageChunker.processChunk(deviceId, value)
                completeMessage?.let { msg ->
                    notifyEvent("onMessageReceived", JSObject().apply {
                        put("deviceId", deviceId)
                        put("data", JSONArray(msg.map { b -> b.toInt() }))
                    })
                }
            }
            else -> {
                notifyEvent("onCharacteristicChanged", JSObject().apply {
                    put("deviceId", deviceId)
                    put("characteristic", uuid.toString())
                    put("data", JSONArray(value.map { b -> b.toInt() }))
                })
            }
        }
    }

    fun startScan() {
        scanner = bluetoothAdapter?.bluetoothLeScanner
        val scanFilter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(NexoGattService.SERVICE_UUID))
            .build()
        
        val scanSettings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        scanner?.startScan(listOf(scanFilter), scanSettings, scanCallback)
        Log.i(TAG, "Scanning started for service: ${NexoGattService.SERVICE_UUID}")
    }

    fun stopScan() {
        scanner?.stopScan(scanCallback)
        Log.i(TAG, "Scanning stopped")
    }

    fun connect(deviceId: String) {
        val device = bluetoothAdapter?.getRemoteDevice(deviceId) ?: run {
            Log.e(TAG, "Device not found: $deviceId")
            return
        }
        
        val gattCallback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> {
                        connections[deviceId] = gatt
                        gatt.discoverServices()
                        notifyEvent("onConnected", JSObject().apply {
                            put("deviceId", deviceId)
                        })
                    }
                    BluetoothProfile.STATE_DISCONNECTED -> {
                        connections.remove(deviceId)
                        notifyEvent("onDisconnected", JSObject().apply {
                            put("deviceId", deviceId)
                        })
                    }
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    notifyEvent("onServicesDiscovered", JSObject().apply {
                        put("deviceId", deviceId)
                        put("services", JSONArray(gatt.services.map { it.uuid.toString() }))
                    })
                }
            }

            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic
            ) {
                handleCharacteristicValue(deviceId, characteristic.uuid, characteristic.value)
            }

            override fun onCharacteristicRead(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                status: Int
            ) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    handleCharacteristicValue(deviceId, characteristic.uuid, characteristic.value)
                }
            }
        }

        device.connectGatt(context, false, gattCallback)
    }

    fun disconnect(deviceId: String) {
        connections[deviceId]?.disconnect()
        connections.remove(deviceId)
    }

    fun sendMessage(deviceId: String, data: ByteArray) {
        val gatt = connections[deviceId] ?: run {
            Log.e(TAG, "No connection for device: $deviceId")
            return
        }
        val service = gatt.getService(NexoGattService.SERVICE_UUID) ?: run {
            Log.e(TAG, "Service not found")
            return
        }
        val characteristic = service.getCharacteristic(NexoGattService.PAYLOAD_CHAR_UUID) ?: run {
            Log.e(TAG, "Characteristic not found")
            return
        }

        val chunks = messageChunker.createChunks(data)
        
        // ✅ FIX: Usar setValue() y tipos explícitos
        chunks.forEachIndexed { index: Int, chunk: ByteArray ->
            characteristic.setValue(chunk)
            val success = gatt.writeCharacteristic(characteristic)
            if (!success) {
                Log.e(TAG, "Failed to write chunk $index")
            }
        }
    }

    private fun notifyEvent(eventName: String, data: JSObject) {
        mainHandler.post {
            notifyListeners(eventName, data)
        }
    }
}
