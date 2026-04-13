package com.nexo.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.nexo.ble.model.NexoGattService
import com.nexo.ble.model.MessageChunker
import org.json.JSONArray
import java.util.*
import java.util.concurrent.ConcurrentHashMap

// ==========================================
// NAP-BLE Client v2.3 - Android 14 Compliant
// Wrapper de conexiones GATT con auditoría
// ==========================================

class NexoBleClient(
    private val context: Context,
    private val notifyListeners: (String, JSObject) -> Unit
) {
    // NAP Logging
    companion object {
        private const val TAG_NAP = "NAP-BLE-CLIENT"
        
        // NAP Códigos Cliente (300-399 para subsistema Client)
        const val NAP_CLIENT_INIT = "BLE_CLIENT_300"
        const val NAP_CLIENT_INIT_FAIL = "BLE_CLIENT_301"
        const val NAP_CLIENT_SCAN_START = "BLE_CLIENT_302"
        const val NAP_CLIENT_SCAN_STOP = "BLE_CLIENT_303"
        const val NAP_CLIENT_CONNECT = "BLE_CLIENT_304"
        const val NAP_CLIENT_DISCONNECT = "BLE_CLIENT_305"
        const val NAP_CLIENT_MESSAGE_SENT = "BLE_CLIENT_306"
        const val NAP_CLIENT_MESSAGE_RECV = "BLE_CLIENT_307"
        const val NAP_CLIENT_ERROR_SECURITY = "BLE_CLIENT_308"
        const val NAP_CLIENT_ERROR_PERMISSION = "BLE_CLIENT_309"
        const val NAP_CLIENT_ERROR_ADAPTER = "BLE_CLIENT_310"
    }

    // FIX: Inicialización lazy para evitar SecurityException en constructor
    private val bluetoothManager: BluetoothManager? by lazy {
        try {
            context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        } catch (e: SecurityException) {
            napLog(NAP_CLIENT_ERROR_SECURITY, "No se puede acceder a BluetoothManager: permisos no concedidos", "ERROR")
            null
        }
    }
    
    private val bluetoothAdapter: BluetoothAdapter? by lazy {
        try {
            bluetoothManager?.adapter
        } catch (e: SecurityException) {
            napLog(NAP_CLIENT_ERROR_SECURITY, "No se puede acceder a BluetoothAdapter", "ERROR")
            null
        }
    }
    
    private var scanner: BluetoothLeScanner? = null
    private val connections = ConcurrentHashMap<String, BluetoothGatt>()
    private val messageChunker = MessageChunker()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var isScanning = false

    private fun napLog(code: String, message: String, level: String = "INFO") {
        val formatted = "[$code] $message [Native:true]"
        when (level) {
            "ERROR" -> Log.e(TAG_NAP, formatted)
            "WARN" -> Log.w(TAG_NAP, formatted)
            else -> Log.i(TAG_NAP, formatted)
        }
    }

    private fun canAccessBluetooth(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) == 
                PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_SCAN) == 
                PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH) == 
                PackageManager.PERMISSION_GRANTED
        }
    }

    init {
        // NAP: Verificación lazy segura
        if (canAccessBluetooth()) {
            napLog(NAP_CLIENT_INIT, "Nex oBleClient inicializado [Native:true]")
        } else {
            napLog(NAP_CLIENT_INIT_FAIL, "NexoBleClient creado sin acceso a BT (esperando permisos)", "WARN")
        }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.let {
                val device = it.device
                val uuids = it.scanRecord?.serviceUuids?.map { uuid -> uuid.uuid.toString() } ?: listOf()
                
                val eventData = JSObject()
                eventData.put("deviceId", device.address)
                eventData.put("name", device.name ?: "Unknown")
                eventData.put("rssi", it.rssi)
                eventData.put("uuids", JSONArray(uuids))
                notifyEvent("onScanResult", eventData)
            }
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>?) {
            results?.forEach { onScanResult(0, it) }
        }

        override fun onScanFailed(errorCode: Int) {
            napLog(NAP_CLIENT_ERROR_ADAPTER, "Scan falló con código: $errorCode", "ERROR")
            val eventData = JSObject()
            eventData.put("errorCode", errorCode)
            eventData.put("napCode", NAP_CLIENT_ERROR_ADAPTER)
            notifyEvent("onScanFailed", eventData)
        }
    }

    private fun handleCharacteristicValue(deviceId: String, uuid: UUID, value: ByteArray) {
        when (uuid) {
            NexoGattService.PAYLOAD_CHAR_UUID -> {
                val completeMessage = messageChunker.processChunk(deviceId, value)
                completeMessage?.let { msg ->
                    val dataArray = JSONArray()
                    for (i in 0 until msg.size) {
                        dataArray.put(msg[i].toInt() and 0xFF)
                    }
                    val eventData = JSObject()
                    eventData.put("deviceId", deviceId)
                    eventData.put("data", dataArray)
                    napLog(NAP_CLIENT_MESSAGE_RECV, "Mensaje recibido de $deviceId: ${msg.size} bytes")
                    notifyEvent("onMessageReceived", eventData)
                }
            }
            else -> {
                val dataArray = JSONArray()
                for (i in 0 until value.size) {
                    dataArray.put(value[i].toInt() and 0xFF)
                }
                val eventData = JSObject()
                eventData.put("deviceId", deviceId)
                eventData.put("characteristic", uuid.toString())
                eventData.put("data", dataArray)
                notifyEvent("onCharacteristicChanged", eventData)
            }
        }
    }

    // NAP: Verificación de permisos antes de escanear
    fun startScan() {
        if (!canAccessBluetooth()) {
            napLog(NAP_CLIENT_ERROR_PERMISSION, "startScan() bloqueado: sin permisos BLUETOOTH_SCAN/CONNECT", "ERROR")
            return
        }
        
        if (isScanning) {
            napLog(NAP_CLIENT_SCAN_START, "Scan ya activo, ignorando solicitud duplicada", "WARN")
            return
        }

        try {
            scanner = bluetoothAdapter?.bluetoothLeScanner
            val scanFilter = ScanFilter.Builder()
                .setServiceUuid(ParcelUuid(NexoGattService.SERVICE_UUID))
                .build()
            
            val scanSettings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .build()

            scanner?.startScan(listOf(scanFilter), scanSettings, scanCallback)
            isScanning = true
            napLog(NAP_CLIENT_SCAN_START, "Scan iniciado para servicio: ${NexoGattService.SERVICE_UUID}")
        } catch (e: SecurityException) {
            napLog(NAP_CLIENT_ERROR_SECURITY, "SecurityException al iniciar scan: ${e.message}", "ERROR")
            isScanning = false
        }
    }

    fun stopScan() {
        if (!canAccessBluetooth()) {
            napLog(NAP_CLIENT_ERROR_PERMISSION, "stopScan() sin permisos", "WARN")
            return
        }
        
        try {
            scanner?.stopScan(scanCallback)
            isScanning = false
            napLog(NAP_CLIENT_SCAN_STOP, "Scan detenido [Native:true]")
        } catch (e: SecurityException) {
            napLog(NAP_CLIENT_ERROR_SECURITY, "Error deteniendo scan: ${e.message}", "ERROR")
        }
    }

    fun connect(deviceId: String) {
        if (!canAccessBluetooth()) {
            napLog(NAP_CLIENT_ERROR_PERMISSION, "connect() bloqueado: sin permisos", "ERROR")
            return
        }

        val device = try {
            bluetoothAdapter?.getRemoteDevice(deviceId)
        } catch (e: IllegalArgumentException) {
            napLog(NAP_CLIENT_ERROR_ADAPTER, "MAC address inválido: $deviceId", "ERROR")
            null
        } catch (e: SecurityException) {
            napLog(NAP_CLIENT_ERROR_SECURITY, "No se puede obtener dispositivo remoto", "ERROR")
            null
        } ?: run {
            Log.e(TAG_NAP, "Device not found: $deviceId")
            return
        }
        
        napLog(NAP_CLIENT_CONNECT, "Conectando a $deviceId...")
        
        val gattCallback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> {
                        connections[deviceId] = gatt
                        gatt.discoverServices()
                        val eventData = JSObject()
                        eventData.put("deviceId", deviceId)
                        napLog(NAP_CLIENT_CONNECT, "Conectado a $deviceId [Native:true]")
                        notifyEvent("onConnected", eventData)
                    }
                    BluetoothProfile.STATE_DISCONNECTED -> {
                        connections.remove(deviceId)
                        val eventData = JSObject()
                        eventData.put("deviceId", deviceId)
                        napLog(NAP_CLIENT_DISCONNECT, "Desconectado de $deviceId")
                        notifyEvent("onDisconnected", eventData)
                    }
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    val servicesArray = JSONArray()
                    for (service in gatt.services) {
                        servicesArray.put(service.uuid.toString())
                    }
                    val eventData = JSObject()
                    eventData.put("deviceId", deviceId)
                    eventData.put("services", servicesArray)
                    notifyEvent("onServicesDiscovered", eventData)
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

        try {
            device.connectGatt(context, false, gattCallback)
        } catch (e: SecurityException) {
            napLog(NAP_CLIENT_ERROR_SECURITY, "No se pudo crear GATT connection", "ERROR")
        }
    }

    fun disconnect(deviceId: String) {
        try {
            connections[deviceId]?.disconnect()
            connections.remove(deviceId)
            napLog(NAP_CLIENT_DISCONNECT, "Desconexión solicitada para $deviceId")
        } catch (e: SecurityException) {
            napLog(NAP_CLIENT_ERROR_SECURITY, "Error en disconnect: ${e.message}", "ERROR")
        }
    }

    fun sendMessage(deviceId: String, data: ByteArray) {
        if (!canAccessBluetooth()) {
            napLog(NAP_CLIENT_ERROR_PERMISSION, "sendMessage() bloqueado: sin permisos", "ERROR")
            return
        }

        val gatt = connections[deviceId] ?: run {
            Log.e(TAG_NAP, "No connection for device: $deviceId")
            return
        }
        val service = gatt.getService(NexoGattService.SERVICE_UUID) ?: run {
            Log.e(TAG_NAP, "Service not found")
            return
        }
        val characteristic = service.getCharacteristic(NexoGattService.PAYLOAD_CHAR_UUID) ?: run {
            Log.e(TAG_NAP, "Characteristic not found")
            return
        }

        val chunks = messageChunker.createChunks(data)
        
        try {
            for (i in 0 until chunks.size) {
                val chunk = chunks[i]
                characteristic.setValue(chunk)
                val success = gatt.writeCharacteristic(characteristic)
                if (!success) {
                    Log.e(TAG_NAP, "Failed to write chunk $i")
                }
            }
            napLog(NAP_CLIENT_MESSAGE_SENT, "Mensaje enviado a $deviceId: ${data.size} bytes en ${chunks.size} chunks")
        } catch (e: SecurityException) {
            napLog(NAP_CLIENT_ERROR_SECURITY, "Error enviando mensaje: ${e.message}", "ERROR")
        }
    }

    private fun notifyEvent(eventName: String, data: JSObject) {
        mainHandler.post {
            notifyListeners(eventName, data)
        }
    }
}
