package com.nexo.ble

import android.util.Base64
import org.json.JSONObject

/**
 * NEXO Turbo File Transfer Protocol v2
 * Header byte: tipo(2bits) + posicion(2bits) + secuencia(4bits)
 * Payload: 243 bytes max (MTU 247 - 4 bytes ATT header)
 */
object FileTransferProtocol {

    // === HEADER BYTE ===
    // Bits 0-1: Tipo de dato
    const val TYPE_DATA = 0x00
    const val TYPE_THUMB = 0x01
    const val TYPE_PREVIEW = 0x02
    const val TYPE_ORIGINAL = 0x03

    // Bits 2-3: Posicion en el stream
    const val POS_START = 0x00
    const val POS_MIDDLE = 0x01
    const val POS_END = 0x02
    const val POS_SINGLE = 0x03

    // Mascaras
    const val MASK_TYPE = 0x03       // 00000011
    const val MASK_POSITION = 0x0C   // 00001100
    const val MASK_SEQUENCE = 0xF0   // 11110000

    const val MAX_PAYLOAD_SIZE = 243
    const val CHUNKS_PER_BLOCK = 20
    const val FEC_PARITY_CHUNKS = 2  // 10% overhead

    // === TIPOS DE MENSAJE JSON (control) ===
    const val MSG_FILE_META = "file_meta"
    const val MSG_FILE_PROGRESS = "file_progress"
    const val MSG_FILE_RESUME = "file_resume"
    const val MSG_FILE_ACK = "file_ack"
    const val MSG_FILE_COMPLETE = "file_complete"
    const val MSG_FILE_CANCEL = "file_cancel"

    // === ESTRUCTURAS DE DATOS ===
    data class FileMeta(
        val msgId: String,
        val from: String,
        val fileName: String,
        val fileSize: Long,
        val mimeType: String,
        val totalChunks: Int,
        val hasThumbnail: Boolean,
        val hasPreview: Boolean,
        val checksum: String,
        val compression: String = "none",
        val timestamp: Long = System.currentTimeMillis()
    ) {
        fun toJson(): JSONObject {
            return JSONObject().apply {
                put("v", 1)
                put("type", MSG_FILE_META)
                put("msgId", msgId)
                put("from", from)
                put("ts", timestamp)
                put("payload", JSONObject().apply {
                    put("fileName", fileName)
                    put("fileSize", fileSize)
                    put("mimeType", mimeType)
                    put("totalChunks", totalChunks)
                    put("hasThumbnail", hasThumbnail)
                    put("hasPreview", hasPreview)
                    put("checksum", checksum)
                    put("compression", compression)
                })
            }
        }

        companion object {
            fun fromJson(json: JSONObject): FileMeta {
                val payload = json.optJSONObject("payload") ?: JSONObject()
                return FileMeta(
                    msgId = json.optString("msgId", ""),
                    from = json.optString("from", ""),
                    fileName = payload.optString("fileName", ""),
                    fileSize = payload.optLong("fileSize", 0),
                    mimeType = payload.optString("mimeType", ""),
                    totalChunks = payload.optInt("totalChunks", 0),
                    hasThumbnail = payload.optBoolean("hasThumbnail", false),
                    hasPreview = payload.optBoolean("hasPreview", false),
                    checksum = payload.optString("checksum", ""),
                    compression = payload.optString("compression", "none"),
                    timestamp = json.optLong("ts", System.currentTimeMillis())
                )
            }
        }
    }

    data class FileProgress(
        val msgId: String,
        val chunksReceived: Int,
        val totalChunks: Int,
        val lastChunkIndex: Int
    ) {
        fun toJson(): JSONObject {
            return JSONObject().apply {
                put("v", 1)
                put("type", MSG_FILE_PROGRESS)
                put("msgId", msgId)
                put("chunksReceived", chunksReceived)
                put("totalChunks", totalChunks)
                put("lastChunkIndex", lastChunkIndex)
                put("ts", System.currentTimeMillis())
            }
        }
    }

    data class FileResume(
        val msgId: String,
        val lastChunkReceived: Int
    ) {
        fun toJson(): JSONObject {
            return JSONObject().apply {
                put("v", 1)
                put("type", MSG_FILE_RESUME)
                put("msgId", msgId)
                put("lastChunkReceived", lastChunkReceived)
                put("ts", System.currentTimeMillis())
            }
        }
    }

    data class FileAck(
        val msgId: String,
        val blockIndex: Int,
        val status: String  // "ok" | "missing"
    ) {
        fun toJson(): JSONObject {
            return JSONObject().apply {
                put("v", 1)
                put("type", MSG_FILE_ACK)
                put("msgId", msgId)
                put("blockIndex", blockIndex)
                put("status", status)
                put("ts", System.currentTimeMillis())
            }
        }
    }

    // === HEADER BYTE OPERATIONS ===
    fun buildHeaderByte(type: Int, position: Int, sequence: Int): Byte {
        val typeBits = (type and MASK_TYPE)
        val posBits = (position shl 2) and MASK_POSITION
        val seqBits = (sequence shl 4) and MASK_SEQUENCE
        return (typeBits or posBits or seqBits).toByte()
    }

    fun parseHeaderByte(header: Byte): Triple<Int, Int, Int> {
        val intVal = header.toInt() and 0xFF
        val type = intVal and MASK_TYPE
        val position = (intVal and MASK_POSITION) shr 2
        val sequence = (intVal and MASK_SEQUENCE) shr 4
        return Triple(type, position, sequence)
    }

    // === CHUNK BUILDER ===
    data class ChunkPacket(
        val header: Byte,
        val chunkIndex: Int,
        val payload: ByteArray
    ) {
        fun toBytes(): ByteArray {
            val indexBytes = intToBytes(chunkIndex)
            return byteArrayOf(header, indexBytes[0], indexBytes[1], indexBytes[2], indexBytes[3]) + payload
        }

        companion object {
            fun fromBytes(bytes: ByteArray): ChunkPacket? {
                if (bytes.size < 5) return null
                val header = bytes[0]
                val chunkIndex = bytesToInt(bytes.sliceArray(1..4))
                val payload = bytes.sliceArray(5 until bytes.size)
                return ChunkPacket(header, chunkIndex, payload)
            }
        }
    }

    // === UTILIDADES ===
    private fun intToBytes(value: Int): ByteArray {
        return byteArrayOf(
            (value shr 24).toByte(),
            (value shr 16).toByte(),
            (value shr 8).toByte(),
            value.toByte()
        )
    }

    private fun bytesToInt(bytes: ByteArray): Int {
        if (bytes.size < 4) return 0
        return ((bytes[0].toInt() and 0xFF) shl 24) or
               ((bytes[1].toInt() and 0xFF) shl 16) or
               ((bytes[2].toInt() and 0xFF) shl 8) or
               (bytes[3].toInt() and 0xFF)
    }

    // === FEC REED-SOLOMON (simplificado para BLE) ===
    // Genera 2 chunks de paridad por cada 20 chunks de datos
    // Usando XOR simple (equivalente a Reed-Solomon con 1 grado de libertad)
    fun generateParityChunks(dataChunks: List<ByteArray>): List<ByteArray> {
        if (dataChunks.isEmpty()) return emptyList()
        val chunkSize = dataChunks[0].size
        val parity1 = ByteArray(chunkSize) { i ->
            var xor: Byte = 0
            dataChunks.forEach { chunk ->
                if (i < chunk.size) xor = (xor.toInt() xor chunk[i].toInt()).toByte()
            }
            xor
        }
        val parity2 = ByteArray(chunkSize) { i ->
            var xor: Byte = 0
            dataChunks.forEachIndexed { index, chunk ->
                if (i < chunk.size) {
                    val weighted = (chunk[i].toInt() * (index + 1)) and 0xFF
                    xor = (xor.toInt() xor weighted).toByte()
                }
            }
            xor
        }
        return listOf(parity1, parity2)
    }

    // Intenta reconstruir chunks faltantes usando paridad
    fun recoverMissingChunks(
        receivedChunks: Map<Int, ByteArray>,
        parityChunks: List<ByteArray>,
        missingIndices: List<Int>
    ): Map<Int, ByteArray> {
        if (missingIndices.size > parityChunks.size) return emptyMap()
        val result = mutableMapOf<Int, ByteArray>()
        // Para 1 chunk faltante: XOR inverso con parity1
        if (missingIndices.size == 1 && parityChunks.isNotEmpty()) {
            val missingIndex = missingIndices[0]
            val chunkSize = parityChunks[0].size
            val recovered = ByteArray(chunkSize) { i ->
                var xor = parityChunks[0][i]
                receivedChunks.forEach { (_, chunk) ->
                    if (i < chunk.size) xor = (xor.toInt() xor chunk[i].toInt()).toByte()
                }
                xor
            }
            result[missingIndex] = recovered
        }
        return result
    }

    // === CALCULO DE CHUNKS ===
    fun calculateTotalChunks(dataSize: Long, payloadSize: Int = MAX_PAYLOAD_SIZE): Int {
        return ((dataSize + payloadSize - 1) / payloadSize).toInt()
    }

    // === COMPRESION DE INDICES ===
    // Para ACK de bloque: comprime lista de indices recibidos en rangos
    fun compressIndices(indices: List<Int>): String {
        if (indices.isEmpty()) return ""
        val sorted = indices.sorted()
        val sb = StringBuilder()
        var start = sorted[0]
        var prev = sorted[0]
        for (i in 1 until sorted.size) {
            if (sorted[i] != prev + 1) {
                if (start == prev) sb.append("$start,") else sb.append("$start-$prev,")
                start = sorted[i]
            }
            prev = sorted[i]
        }
        if (start == prev) sb.append(start) else sb.append("$start-$prev")
        return sb.toString()
    }

    fun decompressIndices(compressed: String): List<Int> {
        if (compressed.isBlank()) return emptyList()
        val result = mutableListOf<Int>()
        compressed.split(",").forEach { part ->
            if (part.contains("-")) {
                val (start, end) = part.split("-").map { it.toInt() }
                result.addAll(start..end)
            } else {
                result.add(part.toInt())
            }
        }
        return result
    }

    // === VALIDACION ===
    fun validateChunk(chunk: ByteArray): Boolean {
        if (chunk.size < 5) return false
        val (type, position, _) = parseHeaderByte(chunk[0])
        return type in 0..3 && position in 0..3
    }

    fun isStartChunk(chunk: ByteArray): Boolean {
        if (chunk.isEmpty()) return false
        val (_, position, _) = parseHeaderByte(chunk[0])
        return position == POS_START || position == POS_SINGLE
    }

    fun isEndChunk(chunk: ByteArray): Boolean {
        if (chunk.isEmpty()) return false
        val (_, position, _) = parseHeaderByte(chunk[0])
        return position == POS_END || position == POS_SINGLE
    }
}
