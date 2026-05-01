package com.nexo.ble

import java.util.UUID

/**
 * UUIDs centralizados NEXO BLE v1.0
 * Patrón: nRF Blinky :spec module
 */
object NexoBleSpec {
    val NEXO_SERVICE_UUID: UUID = UUID.fromString("0000abcd-0000-1000-8000-00805f9b34fb")

    // RX: El Central (otro teléfono) escribe aquí para enviarnos mensajes
    val RX_CHARACTERISTIC_UUID: UUID = UUID.fromString("0000abce-0000-1000-8000-00805f9b34fb")

    // TX: Nosotros enviamos notificaciones aquí hacia el Central
    val TX_CHARACTERISTIC_UUID: UUID = UUID.fromString("0000abcf-0000-1000-8000-00805f9b34fb")

    // CCCD descriptor obligatorio para NOTIFY/INDICATE
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    // Broadcast actions contract (patrón nRF Toolbox)
    const val ACTION_BLE_MESSAGE_RECEIVED = "com.nexo.ble.ACTION_MESSAGE_RECEIVED"
    const val ACTION_BLE_DEVICE_CONNECTED = "com.nexo.ble.ACTION_DEVICE_CONNECTED"
    const val ACTION_BLE_DEVICE_DISCONNECTED = "com.nexo.ble.ACTION_DEVICE_DISCONNECTED"
    const val ACTION_BLE_SEND_MESSAGE = "com.nexo.ble.ACTION_SEND_MESSAGE"
    const val EXTRA_MESSAGE_DATA = "com.nexo.ble.EXTRA_MESSAGE_DATA"
    const val EXTRA_DEVICE_ADDRESS = "com.nexo.ble.EXTRA_DEVICE_ADDRESS"
}
