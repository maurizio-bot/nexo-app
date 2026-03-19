package com.nexo.ble.model

import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap

class MessageChunker {
    private val chunkBuffers = ConcurrentHashMap<String, ChunkBuffer>()
    private val MAX_CHUNK_SIZE = 512 // MTU típico BLE menos overhead
    private val HEADER_SIZE = 5 // Flags(1) + Seq(2) + MsgId(2)

    data class ChunkBuffer(
        val messageId: Int,
        val totalChunks: Int,
        val chunks: MutableMap<Int, ByteArray> = mutableMapOf()
    )

    fun createChunks(data: ByteArray, maxChunkSize: Int = MAX_CHUNK_SIZE - HEADER_SIZE): List<ByteArray> {
        if (data.size <= maxChunkSize) {
            // Mensaje cabe en un solo chunk
            return listOf(createSingleChunk(data))
        }

        // Fragmentar en múltiples chunks
        val chunks = mutableListOf<ByteArray>()
        val totalChunks = (data.size + maxChunkSize - 1) / maxChunkSize
        val messageId = (System.currentTimeMillis() % 65536).toInt()

        var offset = 0
        var chunkIndex = 0

        while (offset < data.size) {
            val chunkSize = minOf(maxChunkSize, data.size - offset)
            val chunkData = data.copyOfRange(offset, offset + chunkSize)
            
            val chunk = createChunkHeader(
                isChunked = true,
                isLast = (chunkIndex == totalChunks - 1),
                seqNum = chunkIndex,
                msgId = messageId,
                totalChunks = totalChunks
            ) + chunkData
            
            chunks.add(chunk)
            offset += chunkSize
            chunkIndex++
        }

        return chunks
    }

    fun processChunk(deviceId: String, chunk: ByteArray): ByteArray? {
        if (chunk.size < HEADER_SIZE) return null

        val flags = chunk[0].toInt()
        val isChunked = (flags and 0x02) != 0
        val isLast = (flags and 0x04) != 0
        val seqNum = ByteBuffer.wrap(chunk, 1, 2).short.toInt()
        val msgId = ByteBuffer.wrap(chunk, 3, 2).short.toInt()

        if (!isChunked) {
            // Mensaje simple, no chunked
            return chunk.copyOfRange(HEADER_SIZE, chunk.size)
        }

        val key = "$deviceId-$msgId"
        val payload = chunk.copyOfRange(HEADER_SIZE, chunk.size)

        val buffer = chunkBuffers.getOrPut(key) {
            ChunkBuffer(msgId, if (isLast) seqNum + 1 else -1)
        }

        buffer.chunks[seqNum] = payload

        // Verificar si tenemos todos los chunks
        if (isLast) {
            buffer.totalChunks = seqNum + 1
        }

        if (buffer.totalChunks > 0 && buffer.chunks.size == buffer.totalChunks) {
            // Reensamblar mensaje completo
            val completeMessage = ByteArray(buffer.chunks.values.sumOf { it.size })
            var offset = 0
            
            for (i in 0 until buffer.totalChunks) {
                val chunkData = buffer.chunks[i] ?: return null
                chunkData.copyInto(completeMessage, offset)
                offset += chunkData.size
            }

            chunkBuffers.remove(key)
            return completeMessage
        }

        return null
    }

    private fun createSingleChunk(data: ByteArray): ByteArray {
        return createChunkHeader(
            isChunked = false,
            isLast = true,
            seqNum = 0,
            msgId = 0,
            totalChunks = 1
        ) + data
    }

    private fun createChunkHeader(
        isChunked: Boolean,
        isLast: Boolean,
        seqNum: Int,
        msgId: Int,
        totalChunks: Int
    ): ByteArray {
        val flags = buildFlags(isChunked, isLast)
        return byteArrayOf(
            flags.toByte(),
            (seqNum shr 8).toByte(), seqNum.toByte(),
            (msgId shr 8).toByte(), msgId.toByte()
        )
    }

    private fun buildFlags(isChunked: Boolean, isLast: Boolean): Int {
        var flags = 0
        if (isChunked) flags = flags or 0x02
        if (isLast) flags = flags or 0x04
        return flags
    }
}
