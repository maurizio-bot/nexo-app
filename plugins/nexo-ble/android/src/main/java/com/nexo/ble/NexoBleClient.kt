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
import com.nexo.ble.model.MessageChunker // ✅ Import explícito
import org.json.JSONArray
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

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
    
    // ✅ Control de escritura secuencial para BLE (no saturar GATT)
    private val pendingWrites = ConcurrentHashMap<String, Queue<ByteArray>>()
    private val writeInProgress = ConcurrentHashMap<String, Boolean>()

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            super.onScanResult(callbackType, result)
            result?.let { scanResult ->
                if (scanResult.device.name != null) {
                    val id = scanResult.device.address
                    val rssi = scanResult.rssi
                    
                    notifyEvent("onPeerDiscovered", JSObject().apply {
                        put("id", id)
                        put("name", scanResult.device.name)
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
                    pendingWrites.remove(deviceId)
                    writeInProgress.remove(deviceId)
                    notifyEvent("onConnectionStateChanged", JSObject().apply {
                        put("deviceId", deviceId)
                        put("state", "disconnected")
                    })
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            super.onServicesDiscovered(gatt, status)
            Log.i(TAG, "Services discovered for $deviceId: status=$status")
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
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic
        ) {
            super.onCharacteristicChanged(gatt, characteristic)
            val value = characteristic.value ?: return
            handleCharacteristicValue(
                gatt.device.address, 
                characteristic.uuid, 
                value
            )
        }

        override fun onCharacteristicWrite(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int
        ) {
            super.onCharacteristicWrite(gatt, characteristic, status)
            val deviceId = gatt.device.address
            
            if (status == BluetoothGatt.GATT_SUCCESS) {
                processNextWrite(deviceId)
            } else {
                Log.e(TAG, "Write failed for $deviceId: status $status")
                writeInProgress[deviceId] = false
            }
        }

        private fun handleCharacteristicValue(deviceId: String, uuid: UUID, value: ByteArray) {
            when (uuid) {
                NexoGattService.PAYLOAD_CHAR_UUID -> {
                    val completeMessage = messageChunker.processChunk(deviceId, value)
                    // ✅ FIX LÍNEA 118: Nombre explícito 'message' en vez de 'it' anidado
                    completeMessage?.let { message ->
                        notifyEvent("onMessageReceived", JSObject().apply {
                            put("deviceId", deviceId)
                            // ✅ FIX: Mapeo explícito sin shadowing
                            val jsonArray = JSONArray()
                            message.forEach { byte -> 
                                jsonArray.put(byte.toInt() and 0xFF) // unsigned
                            }
                            put("data", jsonArray)
                        })
                    }
                }
                else -> {
                    notifyEvent("onCharacteristicChanged", JSObject().apply {
                        put("deviceId", deviceId)
                        put("characteristic", uuid.toString())
                        val jsonArray = JSONArray()
                        value.forEach { byte ->
                            jsonArray.put(byte.toInt() and 0xFF)
                        }
                        put("data", jsonArray)
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
        pendingWrites.remove(deviceId)
        writeInProgress.remove(deviceId)
    }

    fun sendMessage(deviceId: String, data: ByteArray) {
        val gatt = connections[deviceId] ?: run {
            Log.e(TAG, "No connection for $deviceId")
            return
        }
        val service = gatt.getService(NexoGattService.SERVICE_UUID) ?: run {
            Log.e(TAG, "Service not found for $deviceId")
            return
        }
        val characteristic = service.getCharacteristic(NexoGattService.PAYLOAD_CHAR_UUID) ?: run {
            Log.e(TAG, "Characteristic not found for $deviceId")
            return
        }

        val chunks = messageChunker.createChunks(data)
        
        // ✅ FIX CRÍTICO: Encolar chunks y procesar secuencialmente
        val queue = pendingWrites.getOrPut(deviceId) { LinkedList() }
        queue.addAll(chunks)
        
        // Iniciar escritura si no hay una en progreso
        if (writeInProgress[deviceId] != true) {
            processNextWrite(deviceId)
        }
    }

    private fun processNextWrite(deviceId: String) {
        val queue = pendingWrites[deviceId]
        val gatt = connections[deviceId]
        
        if (queue == null || queue.isEmpty() || gatt == null) {
            writeInProgress[deviceId] = false
            return
        }

        val chunk = queue.poll() ?: return
        val service = gatt.getService(NexoGattService.SERVICE_UUID) ?: return
        val characteristic = service.getCharacteristic(NexoGattService.PAYLOAD_CHAR_UUID) ?: return

        writeInProgress[deviceId] = true
        
        // ✅ FIX LÍNEA 174: Usar property .value en lugar de setValue() ambiguo
        characteristic.value = chunk
        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        
        val success = gatt.writeCharacteristic(characteristic)
        if (!success) {
            Log.e(TAG, "Failed to initiate write for $deviceId")
            writeInProgress[deviceId] = false
            // Reintentar con delay
            mainHandler.postDelayed({ processNextWrite(deviceId) }, 100)
        }
    }

    private fun notifyEvent(eventName: String, data: JSObject) {
        mainHandler.post {
            notifyListeners(eventName, data)
        }
    }
}
