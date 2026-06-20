package com.nexo.ble.model

import java.util.*

object NexoGattService {
    val SERVICE_UUID: UUID = UUID.fromString("a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d")
    val ANNOUNCE_CHAR_UUID: UUID = UUID.fromString("b4c6d9e3-f2a5-4b8c-ad4e-7f9a2b3c6d8e")
    val HANDSHAKE_CHAR_UUID: UUID = UUID.fromString("c5d7eaf4-a3b6-4c9d-be5f-8a0c3d4e7f9a")
    val PAYLOAD_CHAR_UUID: UUID = UUID.fromString("d6e8f0a5-b4c7-4d0e-cf6a-9b1e4f5a8b0c")
    val CONTROL_CHAR_UUID: UUID = UUID.fromString("e7f9a0b6-c5d8-4e1f-da7b-0c2f5e6a9b1d")
    val CLIENT_CONFIG_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
}
