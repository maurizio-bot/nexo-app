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
import com.nexo.ble.model.MessageChunker  // ✅ FIX: Import correcto de MessageChunker
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
    private val messageChunker = MessageChunker()  // ✅ FIX: Usar import, no referencia completa
    private val TAG = "NexoBle-Client"
    private val mainHandler = Handler(Looper.getMainLooper())

    // ... resto del código igual ...
}
