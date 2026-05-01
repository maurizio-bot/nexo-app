package com.nexo.ble.model

import java.util.UUID

object NexoGattService {
    val SERVICE_UUID: UUID = UUID.fromString("0000abcd-0000-1000-8000-00805f9b34fb")
    val ANNOUNCE_CHAR_UUID: UUID = UUID.fromString("0000abce-0000-1000-8000-00805f9b34fb")
    val HANDSHAKE_CHAR_UUID: UUID = UUID.fromString("0000abcf-0000-1000-8000-00805f9b34fb")
    val PAYLOAD_CHAR_UUID: UUID = UUID.fromString("0000abd0-0000-1000-8000-00805f9b34fb")
    val CONTROL_CHAR_UUID: UUID = UUID.fromString("0000abd1-0000-1000-8000-00805f9b34fb")
}

