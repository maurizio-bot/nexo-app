package com.nexo.ble.model

import java.util.*

object NexoGattService {
    // ✅ UUIDs corregidos a hexadecimal válido (reemplazados g,h,i,j por hex válido)
    // Service UUID NEXO v1.0 (Base UUID personalizado válido)
    val SERVICE_UUID: UUID = UUID.fromString("a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d")
    
    // Characteristics - Generados nuevos UUIDs válidos basados en el patrón NEXO
    val ANNOUNCE_CHAR_UUID: UUID = UUID.fromString("b4c6d9e3-f2a5-5b8c-ad4e-7f9a2b3c6d8e")
    val HANDSHAKE_CHAR_UUID: UUID = UUID.fromString("c5d7eaf4-a3b6-6c9d-be5f-8a0b3c4d7e9f")
    val PAYLOAD_CHAR_UUID: UUID = UUID.fromString("d6e8fab5-c4d7-7d0e-cf6a-9b1d4e5f8a0b")
    val CONTROL_CHAR_UUID: UUID = UUID.fromString("e7f9acb6-d5e8-8e1f-da7b-0c2e5f6a9b1c")
    
    // CCCD Descriptor (Standard BLE UUID para notificaciones)
    val CLIENT_CONFIG_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    
    // ✅ Constantes útiles para MTU y timeout
    const val DEFAULT_MTU = 512
    const val GATT_TIMEOUT_MS = 5000L
}
