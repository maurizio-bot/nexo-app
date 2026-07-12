package com.nexo.ble

import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlinx.coroutines.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * NEXO Turbo File Transfer Manager v2
 * Maneja chunking, envío GATT optimizado, ACK por bloque, reanudación y FEC
 * Integración con NexoBlePlugin.kt
 */
enum class TransferState { PENDING, SENDING, RECEIVING, PAUSED, COMPLETED, CANCELLED, ERROR }

class FileTransferManager(
    private val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
) {
    companion object {
        private const val TAG = "NexoFileTransfer"
        private const val CHUNK_SIZE = FileTransferProtocol.MAX_PAYLOAD_SIZE // 243 bytes
        private const val BLOCK_SIZE = FileTransferProtocol.CHUNKS_PER_BLOCK // 20 chunks
        private const val PARITY_CHUNKS = FileTransferProtocol.FEC_PARITY_CHUNKS // 2 chunks
        private const val ACK_TIMEOUT_MS = 5000L
        private const val SEND_INTERVAL_MS = 5L // 5ms entre chunks para no saturar
        private const val MAX_RETRIES = 3
    }

    // === CALLBACKS ===
    interface TransferCallbacks {
        fun onProgress(msgId: String, progressPercent: Int, bytesSent: Long, totalBytes: Long)
        fun onChunkSent(msgId: String, chunkIndex: Int)
        fun onTransferComplete(msgId: String, success: Boolean, error: String?)
        fun onTransferReceived(msgId: String, from: String, fileName: String, fileSize: Long, mimeType: String)
        fun onThumbnailReady(msgId: String, thumbnailData: ByteArray)
        fun onPreviewReady(msgId: String, previewData: ByteArray)
        fun onResumeRequest(msgId: String, lastChunkReceived: Int)
        fun onChunkAck(msgId: String, blockIndex: Int, missingChunks: List<Int>)
    }

    var callbacks: TransferCallbacks? = null

    // === INTERFAZ GATT ===
    interface GattWriter {
        fun writeChunk(deviceId: String, data: ByteArray): Boolean
        fun writeControlMessage(deviceId: String, json: String): Boolean
        fun requestConnectionPriority(deviceId: String, priority: Int): Boolean
        fun requestMtu(deviceId: String, mtu: Int): Boolean
        fun setPhy(deviceId: String, txPhy: Int, rxPhy: Int): Boolean
    }

    var gattWriter: GattWriter? = null

    // === ESTADOS ===

    data class ActiveTransfer(
        val msgId: String,
        val deviceId: String,
        val direction: Direction,
        val fileName: String,
        val fileSize: Long,
        val mimeType: String,
        val totalChunks: Int,
        val hasThumbnail: Boolean,
        val hasPreview: Boolean,
        val checksum: String,
        var data: ByteArray? = null, // <-- FIX: val → var
        val chunksSent: MutableSet<Int> = ConcurrentHashMap.newKeySet(),
        val chunksReceived: MutableSet<Int> = ConcurrentHashMap.newKeySet(),
        val parityChunks: MutableMap<Int, ByteArray> = ConcurrentHashMap(),
        val state: AtomicBoolean = AtomicBoolean(false),
        var currentState: TransferState = TransferState.PENDING,
        var lastActivity: Long = System.currentTimeMillis(),
        var retryCount: Int = 0,
        var thumbnailData: ByteArray? = null,
        var previewData: ByteArray? = null
    ) {
        enum class Direction { SEND, RECEIVE }
    }

    private val activeTransfers = ConcurrentHashMap<String, ActiveTransfer>()
    private val sendQueue = mutableListOf<ChunkJob>()
    private val isSending = AtomicBoolean(false)
    private val handler = Handler(Looper.getMainLooper())
    private var currentJob: Job? = null

    data class ChunkJob(
        val msgId: String,
        val deviceId: String,
        val chunkIndex: Int,
        val data: ByteArray,
        val type: Int,
        val retryCount: Int = 0
    )

    // === INICIALIZAR TRANSFERENCIA DE ENVIO ===
    fun startFileSend(
        deviceId: String,
        msgId: String,
        fileName: String,
        fileData: ByteArray,
        mimeType: String,
        thumbnailData: ByteArray? = null,
        previewData: ByteArray? = null
    ): Boolean {
        if (gattWriter == null) {
            Log.e(TAG, "GattWriter no configurado")
            return false
        }

        val totalChunks = FileTransferProtocol.calculateTotalChunks(fileData.size.toLong(), CHUNK_SIZE)
        val hasThumb = thumbnailData != null && thumbnailData.isNotEmpty()
        val hasPreview = previewData != null && previewData.isNotEmpty()

        val transfer = ActiveTransfer(
            msgId = msgId,
            deviceId = deviceId,
            direction = ActiveTransfer.Direction.SEND,
            fileName = fileName,
            fileSize = fileData.size.toLong(),
            mimeType = mimeType,
            totalChunks = totalChunks,
            hasThumbnail = hasThumb,
            hasPreview = hasPreview,
            checksum = calculateChecksum(fileData),
            data = fileData,
            currentState = TransferState.PENDING,
            thumbnailData = thumbnailData,
            previewData = previewData
        )

        activeTransfers[msgId] = transfer

        // Optimizar conexión BLE
        optimizeConnection(deviceId)

        // Enviar metadata primero
        sendFileMeta(transfer)

        // Enviar thumbnail inmediatamente si existe
        if (hasThumb && thumbnailData != null) {
            sendThumbnail(transfer, thumbnailData)
        }

        // Enviar preview si existe
        if (hasPreview && previewData != null) {
            sendPreview(transfer, previewData)
        }

        // Iniciar envío de chunks originales
        transfer.currentState = TransferState.SENDING
        queueChunksForSend(transfer)
        processSendQueue()

        return true
    }

    // === OPTIMIZAR CONEXION ===
    private fun optimizeConnection(deviceId: String) {
        gattWriter?.let { writer ->
            // Request high priority (11.25ms connection interval)
            writer.requestConnectionPriority(deviceId, BluetoothGatt.CONNECTION_PRIORITY_HIGH)
            // Request MTU 247
            writer.requestMtu(deviceId, 247)
            // Request 2M PHY si disponible
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                // FIX: usar valor literal 2 en lugar de BluetoothGatt.PHY_LE_2M
                writer.setPhy(deviceId, 2, 2)
            }
        }
    }

    // === ENVIAR METADATA ===
    private fun sendFileMeta(transfer: ActiveTransfer) {
        val meta = FileTransferProtocol.FileMeta(
            msgId = transfer.msgId,
            from = "", // Se llena en el plugin
            fileName = transfer.fileName,
            fileSize = transfer.fileSize,
            mimeType = transfer.mimeType,
            totalChunks = transfer.totalChunks,
            hasThumbnail = transfer.hasThumbnail,
            hasPreview = transfer.hasPreview,
            checksum = transfer.checksum
        )
        gattWriter?.writeControlMessage(transfer.deviceId, meta.toJson().toString())
    }

    // === ENVIAR THUMBNAIL ===
    private fun sendThumbnail(transfer: ActiveTransfer, data: ByteArray) {
        val chunks = splitIntoChunks(data, FileTransferProtocol.TYPE_THUMB)
        chunks.forEach { chunk ->
            sendQueue.add(ChunkJob(transfer.msgId, transfer.deviceId, chunk.chunkIndex, chunk.toBytes(), FileTransferProtocol.TYPE_THUMB))
        }
    }

    // === ENVIAR PREVIEW ===
    private fun sendPreview(transfer: ActiveTransfer, data: ByteArray) {
        val chunks = splitIntoChunks(data, FileTransferProtocol.TYPE_PREVIEW)
        chunks.forEach { chunk ->
            sendQueue.add(ChunkJob(transfer.msgId, transfer.deviceId, chunk.chunkIndex, chunk.toBytes(), FileTransferProtocol.TYPE_PREVIEW))
        }
    }

    // === QUEUE CHUNKS ===
    private fun queueChunksForSend(transfer: ActiveTransfer) {
        val data = transfer.data ?: return
        val chunks = splitIntoChunks(data, FileTransferProtocol.TYPE_ORIGINAL)

        // Agrupar en bloques para FEC
        var blockIndex = 0
        val blockChunks = mutableListOf<ByteArray>()

        chunks.forEachIndexed { index, chunk ->
            sendQueue.add(ChunkJob(transfer.msgId, transfer.deviceId, chunk.chunkIndex, chunk.toBytes(), FileTransferProtocol.TYPE_ORIGINAL))
            blockChunks.add(chunk.payload)

            // Cada BLOCK_SIZE chunks, generar paridad
            if (blockChunks.size == BLOCK_SIZE || index == chunks.size - 1) {
                val parity = FileTransferProtocol.generateParityChunks(blockChunks)
                parity.forEachIndexed { pIndex, pData ->
                    val parityChunkIndex = transfer.totalChunks + (blockIndex * PARITY_CHUNKS) + pIndex
                    val header = FileTransferProtocol.buildHeaderByte(
                        FileTransferProtocol.TYPE_ORIGINAL,
                        if (pIndex == parity.size - 1) FileTransferProtocol.POS_END else FileTransferProtocol.POS_MIDDLE,
                        pIndex % 16
                    )
                    val packet = FileTransferProtocol.ChunkPacket(header, parityChunkIndex, pData)
                    sendQueue.add(ChunkJob(transfer.msgId, transfer.deviceId, parityChunkIndex, packet.toBytes(), FileTransferProtocol.TYPE_ORIGINAL))
                }
                blockChunks.clear()
                blockIndex++
            }
        }
    }

    // === SPLIT EN CHUNKS ===
    private fun splitIntoChunks(data: ByteArray, type: Int): List<FileTransferProtocol.ChunkPacket> {
        val chunks = mutableListOf<FileTransferProtocol.ChunkPacket>()
        val totalChunks = FileTransferProtocol.calculateTotalChunks(data.size.toLong(), CHUNK_SIZE)

        for (i in 0 until totalChunks) {
            val start = i * CHUNK_SIZE
            val end = minOf(start + CHUNK_SIZE, data.size)
            val payload = data.copyOfRange(start, end)

            val position = when {
                totalChunks == 1 -> FileTransferProtocol.POS_SINGLE
                i == 0 -> FileTransferProtocol.POS_START
                i == totalChunks - 1 -> FileTransferProtocol.POS_END
                else -> FileTransferProtocol.POS_MIDDLE
            }

            val header = FileTransferProtocol.buildHeaderByte(type, position, i % 16)
            chunks.add(FileTransferProtocol.ChunkPacket(header, i, payload))
        }
        return chunks
    }

    // === PROCESAR COLA DE ENVIO ===
    private fun processSendQueue() {
        if (isSending.get()) return
        isSending.set(true)

        currentJob = coroutineScope.launch {
            while (sendQueue.isNotEmpty() && isActive) {
                val job = sendQueue.removeAt(0)
                val transfer = activeTransfers[job.msgId]

                if (transfer == null || transfer.currentState == TransferState.CANCELLED) {
                    continue
                }

                val success = gattWriter?.writeChunk(job.deviceId, job.data) ?: false

                if (success) {
                    transfer.chunksSent.add(job.chunkIndex)
                    transfer.lastActivity = System.currentTimeMillis()

                    // Reportar progreso cada 10 chunks
                    if (job.chunkIndex % 10 == 0) {
                        val progress = ((transfer.chunksSent.size.toDouble() / transfer.totalChunks) * 100).toInt()
                        val bytesSent = transfer.chunksSent.size.toLong() * CHUNK_SIZE
                        withContext(Dispatchers.Main) {
                            callbacks?.onProgress(job.msgId, progress, bytesSent, transfer.fileSize)
                        }
                    }

                    // Enviar ACK request cada BLOCK_SIZE chunks
                    if (job.chunkIndex > 0 && job.chunkIndex % BLOCK_SIZE == 0) {
                        requestBlockAck(transfer, job.chunkIndex / BLOCK_SIZE)
                    }
                } else {
                    // Reintentar
                    if (job.retryCount < MAX_RETRIES) {
                        sendQueue.add(0, job.copy(retryCount = job.retryCount + 1))
                    } else {
                        Log.e(TAG, "Max retries alcanzado para chunk ${job.chunkIndex}")
                    }
                }

                delay(SEND_INTERVAL_MS)
            }
            isSending.set(false)
        }
    }

    // === REQUEST BLOCK ACK ===
    private fun requestBlockAck(transfer: ActiveTransfer, blockIndex: Int) {
        val ack = FileTransferProtocol.FileAck(
            msgId = transfer.msgId,
            blockIndex = blockIndex,
            status = "ok"
        )
        gattWriter?.writeControlMessage(transfer.deviceId, ack.toJson().toString())
    }

    // === PROCESAR CHUNK ENTRANTE ===
    fun processIncomingChunk(deviceId: String, chunkData: ByteArray) {
        val packet = FileTransferProtocol.ChunkPacket.fromBytes(chunkData) ?: return
        val (type, position, _) = FileTransferProtocol.parseHeaderByte(packet.header)

        // Buscar transferencia activa o crear nueva
        var transfer = findTransferByDeviceId(deviceId)

        if (transfer == null) {
            // Es un chunk de thumbnail/preview sin metadata previa
            // Guardar en buffer temporal
            Log.w(TAG, "Chunk recibido sin metadata activa")
            return
        }

        transfer.chunksReceived.add(packet.chunkIndex)
        transfer.lastActivity = System.currentTimeMillis()

        // Guardar datos
        if (type == FileTransferProtocol.TYPE_THUMB) {
            transfer.thumbnailData = (transfer.thumbnailData ?: byteArrayOf()) + packet.payload
            if (position == FileTransferProtocol.POS_END || position == FileTransferProtocol.POS_SINGLE) {
                transfer.thumbnailData?.let { data ->
                    handler.post { callbacks?.onThumbnailReady(transfer.msgId, data) }
                }
            }
        } else if (type == FileTransferProtocol.TYPE_PREVIEW) {
            transfer.previewData = (transfer.previewData ?: byteArrayOf()) + packet.payload
            if (position == FileTransferProtocol.POS_END || position == FileTransferProtocol.POS_SINGLE) {
                transfer.previewData?.let { data ->
                    handler.post { callbacks?.onPreviewReady(transfer.msgId, data) }
                }
            }
        } else {
            // Original data - guardar en archivo temporal
            appendChunkToFile(transfer, packet.chunkIndex, packet.payload)

            // Reportar progreso cada 10 chunks
            if (packet.chunkIndex % 10 == 0) {
                val progress = ((transfer.chunksReceived.size.toDouble() / transfer.totalChunks) * 100).toInt()
                val bytesReceived = transfer.chunksReceived.size.toLong() * CHUNK_SIZE
                handler.post {
                    callbacks?.onProgress(transfer.msgId, progress, bytesReceived, transfer.fileSize)
                }
            }

            // Verificar si está completo
            if (transfer.chunksReceived.size >= transfer.totalChunks) {
                completeTransfer(transfer)
            }
        }
    }

    // === PROCESAR MENSAJE DE CONTROL ===
    fun processControlMessage(deviceId: String, jsonString: String) {
        try {
            val json = org.json.JSONObject(jsonString)
            val type = json.optString("type", "")
            val msgId = json.optString("msgId", "")

            when (type) {
                FileTransferProtocol.MSG_FILE_META -> handleFileMeta(deviceId, json)
                FileTransferProtocol.MSG_FILE_PROGRESS -> handleFileProgress(deviceId, json)
                FileTransferProtocol.MSG_FILE_RESUME -> handleFileResume(deviceId, json)
                FileTransferProtocol.MSG_FILE_ACK -> handleFileAck(deviceId, json)
                FileTransferProtocol.MSG_FILE_COMPLETE -> handleFileComplete(deviceId, json)
                FileTransferProtocol.MSG_FILE_CANCEL -> handleFileCancel(deviceId, msgId)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error procesando mensaje de control", e)
        }
    }

    // === HANDLE FILE META ===
    private fun handleFileMeta(deviceId: String, json: org.json.JSONObject) {
        val meta = FileTransferProtocol.FileMeta.fromJson(json)
        val transfer = ActiveTransfer(
            msgId = meta.msgId,
            deviceId = deviceId,
            direction = ActiveTransfer.Direction.RECEIVE,
            fileName = meta.fileName,
            fileSize = meta.fileSize,
            mimeType = meta.mimeType,
            totalChunks = meta.totalChunks,
            hasThumbnail = meta.hasThumbnail,
            hasPreview = meta.hasPreview,
            checksum = meta.checksum,
            currentState = TransferState.RECEIVING
        )
        activeTransfers[meta.msgId] = transfer

        handler.post {
            callbacks?.onTransferReceived(
                meta.msgId,
                meta.from,
                meta.fileName,
                meta.fileSize,
                meta.mimeType
            )
        }
    }

    // === HANDLE FILE PROGRESS ===
    private fun handleFileProgress(deviceId: String, json: org.json.JSONObject) {
        val msgId = json.optString("msgId", "")
        val chunksReceived = json.optInt("chunksReceived", 0)
        val totalChunks = json.optInt("totalChunks", 0)
        val lastChunkIndex = json.optInt("lastChunkIndex", 0)

        val transfer = activeTransfers[msgId] ?: return
        val progress = ((chunksReceived.toDouble() / totalChunks) * 100).toInt()
        val bytesReceived = chunksReceived.toLong() * CHUNK_SIZE

        handler.post {
            callbacks?.onProgress(msgId, progress, bytesReceived, transfer.fileSize)
        }
    }

    // === HANDLE FILE RESUME ===
    private fun handleFileResume(deviceId: String, json: org.json.JSONObject) {
        val msgId = json.optString("msgId", "")
        val lastChunkReceived = json.optInt("lastChunkReceived", 0)

        val transfer = activeTransfers[msgId] ?: return

        if (transfer.direction == ActiveTransfer.Direction.SEND) {
            // Reanudar envío desde el chunk siguiente
            handler.post {
                callbacks?.onResumeRequest(msgId, lastChunkReceived)
            }
            resumeSendFromChunk(transfer, lastChunkReceived + 1)
        }
    }

    // === HANDLE FILE ACK ===
    private fun handleFileAck(deviceId: String, json: org.json.JSONObject) {
        val msgId = json.optString("msgId", "")
        val blockIndex = json.optInt("blockIndex", 0)
        val status = json.optString("status", "ok")

        val transfer = activeTransfers[msgId] ?: return

        if (status == "missing") {
            // Reenviar chunks faltantes del bloque
            val startChunk = blockIndex * BLOCK_SIZE
            val endChunk = minOf(startChunk + BLOCK_SIZE, transfer.totalChunks)
            val missingChunks = mutableListOf<Int>()

            for (i in startChunk until endChunk) {
                if (!transfer.chunksSent.contains(i)) {
                    missingChunks.add(i)
                }
            }

            handler.post {
                callbacks?.onChunkAck(msgId, blockIndex, missingChunks)
            }

            // Reenviar chunks faltantes
            missingChunks.forEach { chunkIndex ->
                val data = transfer.data ?: return
                val start = chunkIndex * CHUNK_SIZE
                val end = minOf(start + CHUNK_SIZE, data.size)
                val payload = data.copyOfRange(start, end)
                val position = when {
                    transfer.totalChunks == 1 -> FileTransferProtocol.POS_SINGLE
                    chunkIndex == 0 -> FileTransferProtocol.POS_START
                    chunkIndex == transfer.totalChunks - 1 -> FileTransferProtocol.POS_END
                    else -> FileTransferProtocol.POS_MIDDLE
                }
                val header = FileTransferProtocol.buildHeaderByte(
                    FileTransferProtocol.TYPE_ORIGINAL,
                    position,
                    chunkIndex % 16
                )
                val packet = FileTransferProtocol.ChunkPacket(header, chunkIndex, payload)
                sendQueue.add(ChunkJob(msgId, deviceId, chunkIndex, packet.toBytes(), FileTransferProtocol.TYPE_ORIGINAL))
            }
            processSendQueue()
        }
    }

    // === HANDLE FILE COMPLETE ===
    private fun handleFileComplete(deviceId: String, json: org.json.JSONObject) {
        val msgId = json.optString("msgId", "")
        val transfer = activeTransfers[msgId] ?: return
        transfer.currentState = TransferState.COMPLETED
        handler.post { callbacks?.onTransferComplete(msgId, true, null) }
    }

    // === HANDLE FILE CANCEL ===
    private fun handleFileCancel(deviceId: String, msgId: String) {
        val transfer = activeTransfers[msgId] ?: return
        transfer.currentState = TransferState.CANCELLED
        handler.post { callbacks?.onTransferComplete(msgId, false, "Cancelado por el remitente") }
    }

    // === REANUDAR ENVIO ===
    private fun resumeSendFromChunk(transfer: ActiveTransfer, fromChunk: Int) {
        val data = transfer.data ?: return
        val totalChunks = FileTransferProtocol.calculateTotalChunks(data.size.toLong(), CHUNK_SIZE)

        for (i in fromChunk until totalChunks) {
            if (transfer.chunksSent.contains(i)) continue
            val start = i * CHUNK_SIZE
            val end = minOf(start + CHUNK_SIZE, data.size)
            val payload = data.copyOfRange(start, end)
            val position = when {
                totalChunks == 1 -> FileTransferProtocol.POS_SINGLE
                i == 0 -> FileTransferProtocol.POS_START
                i == totalChunks - 1 -> FileTransferProtocol.POS_END
                else -> FileTransferProtocol.POS_MIDDLE
            }
            val header = FileTransferProtocol.buildHeaderByte(
                FileTransferProtocol.TYPE_ORIGINAL,
                position,
                i % 16
            )
            val packet = FileTransferProtocol.ChunkPacket(header, i, payload)
            sendQueue.add(ChunkJob(transfer.msgId, transfer.deviceId, i, packet.toBytes(), FileTransferProtocol.TYPE_ORIGINAL))
        }

        transfer.currentState = TransferState.SENDING
        processSendQueue()
    }

    // === COMPLETAR TRANSFERENCIA ===
    private fun completeTransfer(transfer: ActiveTransfer) {
        transfer.currentState = TransferState.COMPLETED

        // Enviar confirmación
        val complete = org.json.JSONObject().apply {
            put("v", 1)
            put("type", FileTransferProtocol.MSG_FILE_COMPLETE)
            put("msgId", transfer.msgId)
            put("ts", System.currentTimeMillis())
        }
        gattWriter?.writeControlMessage(transfer.deviceId, complete.toString())

        handler.post { callbacks?.onTransferComplete(transfer.msgId, true, null) }
    }

    // === CANCELAR TRANSFERENCIA ===
    fun cancelTransfer(msgId: String) {
        val transfer = activeTransfers[msgId] ?: return
        transfer.currentState = TransferState.CANCELLED

        // Enviar cancelación
        val cancel = org.json.JSONObject().apply {
            put("v", 1)
            put("type", FileTransferProtocol.MSG_FILE_CANCEL)
            put("msgId", msgId)
            put("ts", System.currentTimeMillis())
        }
        gattWriter?.writeControlMessage(transfer.deviceId, cancel.toString())

        // Limpiar cola
        sendQueue.removeAll { it.msgId == msgId }
    }

    // === PAUSAR/REANUDAR ===
    fun pauseTransfer(msgId: String) {
        val transfer = activeTransfers[msgId] ?: return
        transfer.currentState = TransferState.PAUSED
    }

    fun resumeTransfer(msgId: String) {
        val transfer = activeTransfers[msgId] ?: return
        if (transfer.currentState == TransferState.PAUSED) {
            transfer.currentState = TransferState.SENDING
            processSendQueue()
        }
    }

    // === UTILIDADES ===
    private fun findTransferByDeviceId(deviceId: String): ActiveTransfer? {
        return activeTransfers.values.find { it.deviceId == deviceId && it.currentState == TransferState.RECEIVING }
    }

    private fun appendChunkToFile(transfer: ActiveTransfer, chunkIndex: Int, data: ByteArray) {
        // TODO: Implementar escritura en archivo temporal
        // Por ahora, acumulamos en memoria (para archivos < 5MB es viable)
        transfer.data = (transfer.data ?: byteArrayOf()) + data
    }

    private fun calculateChecksum(data: ByteArray): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(data)
        return hash.joinToString("") { "%02x".format(it) }
    }

    fun getTransferProgress(msgId: String): Int {
        val transfer = activeTransfers[msgId] ?: return 0
        return if (transfer.totalChunks > 0) {
            ((transfer.chunksSent.size.toDouble() / transfer.totalChunks) * 100).toInt()
        } else 0
    }

    fun cleanupTransfer(msgId: String) {
        activeTransfers.remove(msgId)
    }

    fun cleanupAll() {
        activeTransfers.clear()
        sendQueue.clear()
        currentJob?.cancel()
        isSending.set(false)
    }

    fun destroy() {
        cleanupAll()
        coroutineScope.cancel()
    }
}
