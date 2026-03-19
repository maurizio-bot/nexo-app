package com.nexo.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import com.getcapacitor.JSObject
import com.nexo.ble.model.NexoGattService
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
    private val messageChunker = MessageChunker()
    private val TAG = "NexoBle-Client"
    private val mainHandler = Handler(Looper.getMainLooper())

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            super.onScanResult(callbackType, result)
            result?.let {
                if (it.device.name != null) {
                    val id = it.device.address
                    val rssi = it.rssi
                    
                    notifyEvent("onPeerDiscovered", JSObject().apply {
                        put("id", id)
                        put("name", it.device.name)
                        put("rssi", rssi)
                    })
                }
            }
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            super.onBatchScanResults(results)
        }

        override fun onScanFailed(errorCode: Int) {
            super.onScanFailed(errorCode)
            Log.e(TAG, "Scan failed with code: $errorCode")
        }
    }

    private fun createGattCallback(deviceId: String) = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            super.onConnectionStateChange(gatt, status, newState)
            
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    gatt.discoverServices()
                    connections[deviceId] = gatt
                    notifyEvent("onConnectionStateChanged", JSObject().apply {
                        put("deviceId", deviceId)
                        put("state", "connected")
                    })
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connections.remove(deviceId)
                    notifyEvent("onConnectionStateChanged", JSObject().apply {
                        put("deviceId", deviceId)
                        put("state", "disconnected")
                    })
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            super.onServicesDiscovered(gatt, status)
            Log.i(TAG, "Services discovered for $status")
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray
        ) {
            super.onCharacteristicChanged(gatt, characteristic, value)
            handleCharacteristicValue(gatt.device.address, characteristic.uuid, value)
        }

        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            super.onCharacteristicChanged(gatt, characteristic)
            handleCharacteristicValue(
                gatt.device.address, 
                characteristic.uuid, 
                characteristic.value
            )
        }

        private fun handleCharacteristicValue(deviceId: String, uuid: UUID, value: ByteArray) {
            when (uuid) {
                NexoGattService.PAYLOAD_CHAR_UUID -> {
                    val completeMessage = messageChunker.processChunk(deviceId, value)
                    completeMessage?.let {
                        notifyEvent("onMessageReceived", JSObject().apply {
                            put("deviceId", deviceId)
                            put("data", JSONArray(it.map { b -> b.toInt() }))
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
    }

    fun startScan() {
        if (scanner == null) {
            scanner = bluetoothAdapter.bluetoothLeScanner
        }

        val filter = ScanFilter.Builder()
            .setServiceUuid(ParcelUuid(NexoGattService.SERVICE_UUID))
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .build()

        scanner?.startScan(listOf(filter), settings, scanCallback)
        Log.i(TAG, "Started scanning for NEXO devices")
    }

    fun stopScan() {
        scanner?.stopScan(scanCallback)
        scanner = null
    }

    fun connect(deviceId: String) {
        val device = bluetoothAdapter.getRemoteDevice(deviceId)
        device.connectGatt(context, false, createGattCallback(deviceId))
    }

    fun disconnect(deviceId: String) {
        connections[deviceId]?.disconnect()
        connections.remove(deviceId)
    }

    fun sendMessage(deviceId: String, data: ByteArray) {
        val gatt = connections[deviceId] ?: return
        val service = gatt.getService(NexoGattService.SERVICE_UUID) ?: return
        val characteristic = service.getCharacteristic(NexoGattService.PAYLOAD_CHAR_UUID) ?: return

        // Si el mensaje es grande, fragmentarlo
        val chunks = messageChunker.createChunks(data)
        
        chunks.forEach { chunk ->
            characteristic.value = chunk
            gatt.writeCharacteristic(characteristic)
        }
    }

    private fun notifyEvent(eventName: String, data: JSObject) {
        mainHandler.post {
            notifyListeners(eventName, data)
        }
    }
}
