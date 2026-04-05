package com.nexo.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.ParcelUuid
import android.util.Log
import com.getcapacitor.JSObject
import com.nexo.ble.model.NexoGattService
import org.json.JSONArray
import java.util.*

class NexoBleServer(
    private val context: Context,
    private val notifyListeners: (String, JSObject) -> Unit
) {
    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val bluetoothAdapter = bluetoothManager.adapter
    private var gattServer: BluetoothGattServer? = null
    private var advertiser: BluetoothLeAdvertiser? = null
    private val connectedDevices = mutableMapOf<String, BluetoothDevice>()
    private val TAG = "NexoBle-Server"

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            super.onConnectionStateChange(device, status, newState)
            val id = device.address
            
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    connectedDevices[id] = device
                    val eventData = JSObject().apply {
                        put("deviceId", id)
                        put("state", "connected")
                        put("rssi", 0)
                    }
                    notifyEvent("onConnectionStateChanged", eventData)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedDevices.remove(id)
                    val eventData = JSObject().apply {
                        put("deviceId", id)
                        put("state", "disconnected")
                    }
                    notifyEvent("onConnectionStateChanged", eventData)
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
            super.onCharacteristicWriteRequest(device, requestId, characteristic, preparedWrite, responseNeeded, offset, value)
            
            value?.let {
                handleIncomingData(device.address, characteristic.uuid, it)
            }
            
            if (responseNeeded) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, null)
            }
        }
    }

    fun startAdvertising() {
        if (advertiser != null) return

        setupGattServer()

        advertiser = bluetoothAdapter.bluetoothLeAdvertiser
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .addServiceUuid(ParcelUuid(NexoGattService.SERVICE_UUID))
            .build()

        advertiser?.startAdvertising(settings, data, advertiseCallback)
        Log.i(TAG, "Started advertising with UUID: ${NexoGattService.SERVICE_UUID}")
    }

    fun stopAdvertising() {
        advertiser?.stopAdvertising(advertiseCallback)
        advertiser = null
        gattServer?.close()
        gattServer = null
    }

    private fun setupGattServer() {
        gattServer = bluetoothManager.openGattServer(context, gattServerCallback)
        
        val service = BluetoothGattService(
            NexoGattService.SERVICE_UUID,
            BluetoothGattService.SERVICE_TYPE_PRIMARY
        )

        // ✅ FIX: Nombres de UUID corregidos para coincidir con NexoGattService/NexoBlePlugin
        val announceChar = BluetoothGattCharacteristic(
            NexoGattService.CHAR_ANNOUNCE,  // Cambiado de ANNOUNCE_CHAR_UUID
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        
        val handshakeChar = BluetoothGattCharacteristic(
            NexoGattService.CHAR_HANDSHAKE,  // Cambiado de HANDSHAKE_CHAR_UUID
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        
        val payloadChar = BluetoothGattCharacteristic(
            NexoGattService.CHAR_PAYLOAD,  // Cambiado de PAYLOAD_CHAR_UUID
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        
        val controlChar = BluetoothGattCharacteristic(
            NexoGattService.CHAR_CONTROL,  // Cambiado de CONTROL_CHAR_UUID
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )

        service.addCharacteristic(announceChar)
        service.addCharacteristic(handshakeChar)
        service.addCharacteristic(payloadChar)
        service.addCharacteristic(controlChar)

        gattServer?.addService(service)
    }

    private fun handleIncomingData(deviceId: String, charUuid: UUID, data: ByteArray) {
        // ✅ FIX: Construcción correcta de JSONArray
        val jsonArray = JSONArray()
        data.forEach { byte ->
            jsonArray.put(byte.toInt() and 0xFF)  // Asegurar valor positivo 0-255
        }
        
        val eventData = JSObject().apply {
            put("deviceId", deviceId)
            put("characteristic", charUuid.toString())
            put("data", jsonArray)
        }

        // ✅ FIX: Usar los nombres correctos de constantes UUID
        when (charUuid) {
            NexoGattService.CHAR_HANDSHAKE -> notifyEvent("onHandshakeReceived", eventData)
            NexoGattService.CHAR_PAYLOAD -> notifyEvent("onMessageReceived", eventData)
            NexoGattService.CHAR_CONTROL -> notifyEvent("onControlReceived", eventData)
        }
    }

    private fun notifyEvent(eventName: String, data: JSObject) {
        notifyListeners(eventName, data)
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
            super.onStartSuccess(settingsInEffect)
            Log.i(TAG, "Advertising started successfully")
        }

        override fun onStartFailure(errorCode: Int) {
            super.onStartFailure(errorCode)
            Log.e(TAG, "Advertising failed with code: $errorCode")
        }
    }
}
