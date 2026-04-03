package com.nexo.ble

import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.os.ParcelUuid
import android.util.Log
import com.getcapacitor.JSObject  // ← AGREGADO
import org.json.JSONArray         // ← AGREGADO
import java.util.*

/**
 * NexoGattService - Constantes UUID compartidas
 * NOTA: Si tienes un archivo model/NexoGattService.kt separado, 
 * asegúrate de que estos UUIDs coincidan exactamente con los de NexoBlePlugin
 */
object NexoGattService {
    val SERVICE_UUID = UUID.fromString("a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d")
    val ANNOUNCE_CHAR_UUID = UUID.fromString("b4c6d9e3-f2a5-4b8c-ad4e-7f9a2b3c6d8e")
    val HANDSHAKE_CHAR_UUID = UUID.fromString("c5d7eaf4-a3b6-4c9d-be5f-8a0c3d4e7f9a")
    val PAYLOAD_CHAR_UUID = UUID.fromString("d6e8f0a5-b4c7-4d0e-cf6a-9b1e4f5a8b0c")
    val CONTROL_CHAR_UUID = UUID.fromString("e7f9a0b6-c5d8-4e1f-da7b-0c2f5e6a9b1d")
}

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

    // Callback para el GATT Server
    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            super.onConnectionStateChange(device, status, newState)
            val id = device.address
            
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    connectedDevices[id] = device
                    notifyEvent("onConnectionStateChanged", JSObject().apply {
                        put("deviceId", id)
                        put("state", "connected")
                        put("rssi", 0)
                    })
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedDevices.remove(id)
                    notifyEvent("onConnectionStateChanged", JSObject().apply {
                        put("deviceId", id)
                        put("state", "disconnected")
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

        // Característica Announce (Read/Notify)
        val announceChar = BluetoothGattCharacteristic(
            NexoGattService.ANNOUNCE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ
        )
        
        // Característica Handshake (Write/Notify)
        val handshakeChar = BluetoothGattCharacteristic(
            NexoGattService.HANDSHAKE_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        
        // Característica Payload (Write/Notify)
        val payloadChar = BluetoothGattCharacteristic(
            NexoGattService.PAYLOAD_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        
        // Característica Control (Write/Notify)
        val controlChar = BluetoothGattCharacteristic(
            NexoGattService.CONTROL_CHAR_UUID,
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
        val eventData = JSObject().apply {
            put("deviceId", deviceId)
            put("characteristic", charUuid.toString())
            put("data", JSONArray(data.map { it.toInt() }))
        }

        when (charUuid) {
            NexoGattService.HANDSHAKE_CHAR_UUID -> notifyEvent("onHandshakeReceived", eventData)
            NexoGattService.PAYLOAD_CHAR_UUID -> notifyEvent("onMessageReceived", eventData)
            NexoGattService.CONTROL_CHAR_UUID -> notifyEvent("onControlReceived", eventData)
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
