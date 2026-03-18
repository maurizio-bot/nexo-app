package com.nexo.ble

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.os.ParcelUuid
import no.nordicsemi.android.ble.BleServerManager
import java.util.UUID

class NexoBleServer(
    context: Context,
    private val serviceUuid: UUID,
    private val charTxUuid: UUID,
    private val charRxUuid: UUID,
    private val onDeviceConnected: (BluetoothDevice) -> Unit,
    private val onDeviceDisconnected: (BluetoothDevice) -> Unit,
    private val onMessageReceived: (BluetoothDevice, ByteArray) -> Unit
) : BleServerManager(context) {

    private val clients = mutableMapOf<String, BluetoothDevice>()
    private var advertisingCallback: AdvertiseCallback? = null

    override fun initializeServer(): List<BluetoothGattService> {
        val service = BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        
        val charTx = BluetoothGattCharacteristic(
            charTxUuid,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            0
        ).apply {
            addDescriptor(BluetoothGattDescriptor(
                UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),
                BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE
            ))
        }
        
        val charRx = BluetoothGattCharacteristic(
            charRxUuid,
            BluetoothGattCharacteristic.PROPERTY_WRITE,
            BluetoothGattCharacteristic.PERMISSION_WRITE
        )
        
        service.addCharacteristic(charTx)
        service.addCharacteristic(charRx)
        
        return listOf(service)
    }

    override fun onDeviceConnectedToServer(device: BluetoothDevice) {
        super.onDeviceConnectedToServer(device)
        clients[device.address] = device
        onDeviceConnected(device)
    }

    override fun onDeviceDisconnectedFromServer(device: BluetoothDevice) {
        super.onDeviceDisconnectedFromServer(device)
        clients.remove(device.address)
        onDeviceDisconnected(device)
    }

    override fun onCharacteristicWrite(device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic, preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray?) {
        super.onCharacteristicWrite(device, requestId, characteristic, preparedWrite, responseNeeded, offset, value)
        
        if (characteristic.uuid == charRxUuid && value != null) {
            onMessageReceived(device, value)
        }
        
        if (responseNeeded) {
            sendResponse(device, requestId, android.bluetooth.BluetoothGatt.GATT_SUCCESS, 0, null)
        }
    }

    fun startAdvertising(deviceName: String, callback: (Boolean, String?) -> Unit) {
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setConnectable(true)
            .setTimeout(0)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .build()

        val data = AdvertiseData.Builder()
            .setIncludeDeviceName(true)
            .addServiceUuid(ParcelUuid(serviceUuid))
            .build()

        advertisingCallback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                callback(true, null)
            }

            override fun onStartFailure(errorCode: Int) {
                val error = when(errorCode) {
                    ADVERTISE_FAILED_DATA_TOO_LARGE -> "Datos muy grandes"
                    ADVERTISE_FAILED_TOO_MANY_ADVERTISERS -> "Demasiados anunciantes"
                    ADVERTISE_FAILED_ALREADY_STARTED -> "Ya iniciado"
                    ADVERTISE_FAILED_INTERNAL_ERROR -> "Error interno"
                    ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> "No soportado"
                    else -> "Error: $errorCode"
                }
                callback(false, error)
            }
        }

        startAdvertising(settings, data, advertisingCallback!!)
    }

    fun stopAdvertising() {
        advertisingCallback?.let { stopAdvertising(it) }
    }
}
