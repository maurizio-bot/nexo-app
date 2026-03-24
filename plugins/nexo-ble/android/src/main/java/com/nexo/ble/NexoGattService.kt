package com.nexo.ble.model

import java.util.*

object NexoGattService {
    // Service UUID NEXO v1.0 (Namespace: com.nexo.app.ble.protocol.v1)
    val SERVICE_UUID: UUID = UUID.fromString("a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d")
    
    // Characteristics
    val ANNOUNCE_CHAR_UUID: UUID = UUID.fromString("b4c6d9e3-f2a5-5b8c-ad4e-7f9g2b3c6d8e")
    val HANDSHAKE_CHAR_UUID: UUID = UUID.fromString("c5d7eaf4-g3b6-6c9d-be5f-8a0h3c4d7e9f")
    val PAYLOAD_CHAR_UUID: UUID = UUID.fromString("d6e8fbg5-h4c7-7d0e-cf6g-9b1i4d5e8f0g")
    val CONTROL_CHAR_UUID: UUID = UUID.fromString("e7f9gch6-i5d8-8e1f-dg7h-0c2j5e6f9g1h")
    
    // Descriptors
    val CLIENT_CONFIG_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
}
