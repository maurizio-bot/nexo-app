package com.nexo.ble.model

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.schedule
import java.util.Timer

class MessageChunker {
    private val chunkBuffers = ConcurrentHashMap<String, ChunkBuffer>()
    private val cleanupTimer = Timer("ChunkCleanup", true)
    
    companion object {
        const val MAX_CHUNK_SIZE = 507 // MTU BLE 512 - 5 bytes header
        const val HEADER_SIZE = 5
        const val MAX_MESSAGE_SIZE = 256 * 1024 // 256KB límite Fénix
        const val CHUNK_TIMEOUT_MS = 30000L // 30s TTL para reensamblado
    }

    data class ChunkBuffer(
        val messageId: Int,
        var totalChunks: Int,
        val chunks: ConcurrentHashMap<Int, ByteArray> = ConcurrentHashMap(), // ✅ Thread-safe
        val timestamp: Long = System.currentTimeMillis()
    )

    init {
        // ✅ Cleanup periódico de buffers huérfanos
        cleanupTimer.schedule(30000L, 30000L) {
            cleanupExpiredBuffers()
        }
    }

    fun createChunks(data: ByteArray, maxChunkSize: Int = MAX_CHUNK_SIZE): List<ByteArray> {
        // ✅ Validación límite Fénix
        if (data.size > MAX_MESSAGE_SIZE) {
            throw IllegalArgumentException("Mensaje excede 256KB límite Fénix: ${data.size}")
        }

        if (data.size <= maxChunkSize) {
            return listOf(createSingleChunk(data))
        }

        val chunks = mutableListOf<ByteArray>()
        val totalChunks = (data.size + maxChunkSize - 1) / maxChunkSize
        
        // ✅ Validación explícita
        if (totalChunks > 65535) throw IllegalStateException("Demasiados chunks: $totalChunks")
        
        val messageId = (System.currentTimeMillis() % 65536).toInt()

        var offset = 0
        var seqNum = 0

        while (offset < data.size) {
            val remaining = data.size - offset
            val currentChunkSize = if (remaining < maxChunkSize) remaining else maxChunkSize
            
            val chunkData = data.copyOfRange(offset, offset + currentChunkSize)
            
            val isLast = (seqNum == totalChunks - 1)
            val chunk = createChunkHeader(
                isChunked = true,
                isLast = isLast,
                seqNum = seqNum,
                msgId = messageId,
                totalChunks = totalChunks
            ) + chunkData
            
            chunks.add(chunk)
            offset += currentChunkSize
            seqNum++
        }

        return chunks
    }

    fun processChunk(deviceId: String, chunk: ByteArray): ByteArray? {
        if (chunk.size < HEADER_SIZE) return null

        // ✅ ByteOrder explícito BIG_ENDIAN (estándar BLE)
        val buffer = ByteBuffer.wrap(chunk).order(ByteOrder.BIG_ENDIAN)
        val flags = buffer.get().toInt()
        val isChunked = (flags and 0x02) != 0
        val isLast = (flags and 0x04) != 0
        val seqNum = buffer.short.toInt() and 0xFFFF
        val msgId = buffer.short.toInt() and 0xFFFF

        if (!isChunked) {
            return chunk.copyOfRange(HEADER_SIZE, chunk.size)
        }

        val key = "$deviceId-$msgId"
        val payload = chunk.copyOfRange(HEADER_SIZE, chunk.size)

        // ✅ Atomic operation - thread safe
        val chunkBuffer = chunkBuffers.computeIfAbsent(key) { _ ->
            ChunkBuffer(msgId, -1)
        }

        // Guardar chunk (ConcurrentHashMap es thread-safe)
        chunkBuffer.chunks[seqNum] = payload

        // Actualizar total si es el último chunk
        if (isLast) {
            chunkBuffer.totalChunks = seqNum + 1
        }

        // ✅ Validación de integridad antes de reensamblar
        if (chunkBuffer.totalChunks > 0 && chunkBuffer.chunks.size == chunkBuffer.totalChunks) {
            return reassembleMessage(key, chunkBuffer)
        }

        return null
    }

    private fun reassembleMessage(key: String, buffer: ChunkBuffer): ByteArray? {
        return try {
            val totalSize = buffer.chunks.values.sumOf { it.size }
            
            // ✅ Validación de seguridad
            if (totalSize > MAX_MESSAGE_SIZE) {
                chunkBuffers.remove(key)
                return null
            }

            val completeMessage = ByteArray(totalSize)
            var offset = 0
            
            for (i in 0 until buffer.totalChunks) {
                val chunkData = buffer.chunks[i] 
                    ?: run {
                        // Chunk faltante - inconsistencia
                        chunkBuffers.remove(key)
                        return null
                    }
                chunkData.copyInto(completeMessage, offset)
                offset += chunkData.size
            }

            chunkBuffers.remove(key)
            completeMessage
        } catch (e: Exception) {
            chunkBuffers.remove(key)
            null
        }
    }

    private fun cleanupExpiredBuffers() {
        val now = System.currentTimeMillis()
        val expiredKeys = chunkBuffers.filter { (_, buffer) ->
            (now - buffer.timestamp) > CHUNK_TIMEOUT_MS
        }.keys
        
        expiredKeys.forEach { chunkBuffers.remove(it) }
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
            (seqNum shr 8).toByte(), (seqNum and 0xFF).toByte(),
            (msgId shr 8).toByte(), (msgId and 0xFF).toByte()
        )
    }

    private fun buildFlags(isChunked: Boolean, isLast: Boolean): Int {
        var flags = 0
        if (isChunked) flags = flags or 0x02
        if (isLast) flags = flags or 0x04
        return flags
    }

    fun dispose() {
        cleanupTimer.cancel()
        chunkBuffers.clear()
    }
}
