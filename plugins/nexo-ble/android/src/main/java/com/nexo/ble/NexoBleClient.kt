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
import org.json.JSONArray  // ✅ FALTABA ESTO
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

    // ... (scanCallback sin cambios) ...

    private fun handleCharacteristicValue(deviceId: String, uuid: UUID, value: ByteArray) {
        when (uuid) {
            NexoGattService.PAYLOAD_CHAR_UUID -> {
                val completeMessage = messageChunker.processChunk(deviceId, value)
                completeMessage?.let {
                    notifyEvent("onMessageReceived", JSObject().apply {
                        put("deviceId", deviceId)
                        put("data", JSONArray(it.map { b -> b.toInt() }))  // ✅ Ahora funciona
                    })
                }
            }
            else -> {
                notifyEvent("onCharacteristicChanged", JSObject().apply {
                    put("deviceId", deviceId)
                    put("characteristic", uuid.toString())
                    put("data", JSONArray(value.map { b -> b.toInt() }))  // ✅ Ahora funciona
                })
            }
        }
    }

    // ... (startScan, stopScan, connect, disconnect sin cambios) ...

    fun sendMessage(deviceId: String, data: ByteArray) {
        val gatt = connections[deviceId] ?: return
        val service = gatt.getService(NexoGattService.SERVICE_UUID) ?: return
        val characteristic = service.getCharacteristic(NexoGattService.PAYLOAD_CHAR_UUID) ?: return

        val chunks = messageChunker.createChunks(data)
        
        chunks.forEach { chunk ->
            // ✅ FIX: Usar setValue() en lugar de asignación directa
            characteristic.setValue(chunk)
            gatt.writeCharacteristic(characteristic)
        }
    }

    private fun notifyEvent(eventName: String, data: JSObject) {
        mainHandler.post {
            notifyListeners(eventName, data)
        }
    }
}
