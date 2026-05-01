package com.nexo.ble.model

import java.util.UUID

object NexoGattService {
    // UUIDs sincronizados con BleService.kt v2.3.1
    val SERVICE_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6")
    val MESSAGE_CHAR_UUID: UUID = UUID.fromString("a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c7")
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    
    // Aliases legacy para compatibilidad con NexoBlePlugin.kt
    val ANNOUNCE_CHAR_UUID: UUID = MESSAGE_CHAR_UUID
    val HANDSHAKE_CHAR_UUID: UUID = MESSAGE_CHAR_UUID
    val PAYLOAD_CHAR_UUID: UUID = MESSAGE_CHAR_UUID
    val CONTROL_CHAR_UUID: UUID = MESSAGE_CHAR_UUID
}
