package com.nexo.ble

import java.util.UUID

object NexoBleSpec {
    // UUIDs del servicio NEXO (16-bit base + 128-bit compatible)
    val NEXO_SERVICE_UUID: UUID = UUID.fromString("0000abcd-0000-1000-8000-00805f9b34fb")
    val TX_CHARACTERISTIC_UUID: UUID = UUID.fromString("0000abce-0000-1000-8000-00805f9b34fb")
    val RX_CHARACTERISTIC_UUID: UUID = UUID.fromString("0000abcf-0000-1000-8000-00805f9b34fb")
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    // Acciones Broadcast internas (Service → Plugin)
    const val ACTION_BLE_MESSAGE_RECEIVED = "com.nexo.ble.ACTION_MESSAGE_RECEIVED"
    const val ACTION_BLE_DEVICE_CONNECTED = "com.nexo.ble.ACTION_DEVICE_CONNECTED"
    const val ACTION_BLE_DEVICE_DISCONNECTED = "com.nexo.ble.ACTION_DEVICE_DISCONNECTED"
    const val ACTION_BLE_SEND_MESSAGE = "com.nexo.ble.ACTION_SEND_MESSAGE"

    // Extras
    const val EXTRA_MESSAGE_DATA = "com.nexo.ble.EXTRA_MESSAGE_DATA"
    const val EXTRA_DEVICE_ADDRESS = "com.nexo.ble.EXTRA_DEVICE_ADDRESS"
}
