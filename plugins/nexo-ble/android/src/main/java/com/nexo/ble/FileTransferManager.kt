package com.nexo.ble

import android.bluetooth.BluetoothGatt
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlinx.coroutines.*
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * NEXO Turbo File Transfer Manager v2
 *
 * FIX base:
 * - Recepción directa a archivo temporal.
 * - Escritura por posición de chunk.
 * - Detección de chunks duplicados.
 * - Validación de índices.
 * - Validación de tamaño.
 * - SHA-256 antes de completar.
 *
 * Se conserva la API existente para no romper NexoBlePlugin.kt.
 */
enum class TransferState {
    PENDING,
    SENDING,
    RECEIVING,
    PAUSED,
    COMPLETED,
    CANCELLED,
    ERROR
}

class FileTransferManager(
    private val coroutineScope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
) {

    companion object {
        private const val TAG = "NexoFileTransfer"

        /*
         * IMPORTANTE:
         *
         * El paquete BLE tiene:
         * 1 byte header
         * 4 bytes chunkIndex
         *
         * Por tanto, con MTU 247 no podemos usar 243 bytes
         * de payload real.
         *
         * 247 - 3 ATT = 244 bytes disponibles
         * 244 - 5 NEXO = 239 bytes
         *
         * Usamos 239 aquí sin modificar todavía el protocolo global.
         */
        private const val CHUNK_SIZE = 239
        private const val BLOCK_SIZE = FileTransferProtocol.CHUNKS_PER_BLOCK
        private const val PARITY_CHUNKS = FileTransferProtocol.FEC_PARITY_CHUNKS
        private const val SEND_INTERVAL_MS = 5L
        private const val MAX_RETRIES = 3
        private const val MAX_FILE_SIZE = 50L * 1024L * 1024L
    }

    // ============================================================
    // CALLBACKS
    // ============================================================
    interface TransferCallbacks {
        fun onProgress(
            msgId: String,
            progressPercent: Int,
            bytesSent: Long,
            totalBytes: Long
        )

        fun onChunkSent(
            msgId: String,
            chunkIndex: Int
        )

        fun onTransferComplete(
            msgId: String,
            success: Boolean,
            error: String?
        )

        fun onTransferReceived(
            msgId: String,
            from: String,
            fileName: String,
            fileSize: Long,
            mimeType: String
        )

        fun onThumbnailReady(
            msgId: String,
            thumbnailData: ByteArray
        )

        fun onPreviewReady(
            msgId: String,
            previewData: ByteArray
        )

        fun onResumeRequest(
            msgId: String,
            lastChunkReceived: Int
        )

        fun onChunkAck(
            msgId: String,
            blockIndex: Int,
            missingChunks: List<Int>
        )
    }

    var callbacks: TransferCallbacks? = null

    // ============================================================
    // GATT
    // ============================================================
    interface GattWriter {
        fun writeChunk(
            deviceId: String,
            data: ByteArray
        ): Boolean

        fun writeControlMessage(
            deviceId: String,
            json: String
        ): Boolean

        fun requestConnectionPriority(
            deviceId: String,
            priority: Int
        ): Boolean

        fun requestMtu(
            deviceId: String,
            mtu: Int
        ): Boolean

        fun setPhy(
            deviceId: String,
            txPhy: Int,
            rxPhy: Int
        ): Boolean
    }

    var gattWriter: GattWriter? = null

    // ============================================================
    // TRANSFER
    // ============================================================
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
        /*
         * SEND:
         * contiene los bytes originales.
         *
         * RECEIVE:
         * permanece null.
         *
         * Esto evita duplicar un archivo recibido completo
         * en memoria.
         */
        var data: ByteArray? = null,
        val chunksSent: MutableSet<Int> = ConcurrentHashMap.newKeySet(),
        val chunksReceived: MutableSet<Int> = ConcurrentHashMap.newKeySet(),
        val parityChunks: MutableMap<Int, ByteArray> = ConcurrentHashMap(),
        val state: AtomicBoolean = AtomicBoolean(false),
        var currentState: TransferState = TransferState.PENDING,
        var lastActivity: Long = System.currentTimeMillis(),
        var retryCount: Int = 0,
        var thumbnailData: ByteArray? = null,
        var previewData: ByteArray? = null,
        /*
         * Archivo temporal de recepción.
         */
        var tempFile: File? = null,
        /*
         * Bytes realmente escritos.
         */
        val bytesReceived: AtomicLong = AtomicLong(0)
    ) {
        enum class Direction {
            SEND,
            RECEIVE
        }
    }

    private val activeTransfers = ConcurrentHashMap<String, ActiveTransfer>()

    /*
     * Se conserva la estructura existente.
     * Más adelante podremos sustituirla por una cola
     * concurrente/ventana de envío.
     */
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

    // ============================================================
    // SEND
    // ============================================================
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

        if (fileData.isEmpty()) {
            Log.e(TAG, "Archivo vacío")
            return false
        }

        if (fileData.size.toLong() > MAX_FILE_SIZE) {
            Log.e(TAG, "Archivo demasiado grande")
            return false
        }

        val totalChunks = FileTransferProtocol.calculateTotalChunks(
            fileData.size.toLong(),
            CHUNK_SIZE
        )

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

        optimizeConnection(deviceId)
        sendFileMeta(transfer)

        /*
         * Se conserva la funcionalidad existente.
         */
        if (hasThumb && thumbnailData != null) {
            sendThumbnail(transfer, thumbnailData)
        }

        if (hasPreview && previewData != null) {
            sendPreview(transfer, previewData)
        }

        transfer.currentState = TransferState.SENDING
        queueChunksForSend(transfer)
        processSendQueue()

        return true
    }

    // ============================================================
    // BLE OPTIMIZATION
    // ============================================================
    private fun optimizeConnection(
        deviceId: String
    ) {
        gattWriter?.let { writer ->
            writer.requestConnectionPriority(
                deviceId,
                BluetoothGatt.CONNECTION_PRIORITY_HIGH
            )
            writer.requestMtu(
                deviceId,
                247
            )

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                writer.setPhy(
                    deviceId,
                    2,
                    2
                )
            }
        }
    }

    // ============================================================
    // META
    // ============================================================
    private fun sendFileMeta(
        transfer: ActiveTransfer
    ) {
        val meta = FileTransferProtocol.FileMeta(
            msgId = transfer.msgId,
            from = "",
            fileName = transfer.fileName,
            fileSize = transfer.fileSize,
            mimeType = transfer.mimeType,
            totalChunks = transfer.totalChunks,
            hasThumbnail = transfer.hasThumbnail,
            hasPreview = transfer.hasPreview,
            checksum = transfer.checksum
        )

        gattWriter?.writeControlMessage(
            transfer.deviceId,
            meta.toJson().toString()
        )
    }

    // ============================================================
    // THUMBNAIL
    // ============================================================
    private fun sendThumbnail(
        transfer: ActiveTransfer,
        data: ByteArray
    ) {
        val chunks = splitIntoChunks(
            data,
            FileTransferProtocol.TYPE_THUMB
        )

        chunks.forEach { chunk ->
            sendQueue.add(
                ChunkJob(
                    transfer.msgId,
                    transfer.deviceId,
                    chunk.chunkIndex,
                    chunk.toBytes(),
                    FileTransferProtocol.TYPE_THUMB
                )
            )
        }
    }

    // ============================================================
    // PREVIEW
    // ============================================================
    private fun sendPreview(
        transfer: ActiveTransfer,
        data: ByteArray
    ) {
        val chunks = splitIntoChunks(
            data,
            FileTransferProtocol.TYPE_PREVIEW
        )

        chunks.forEach { chunk ->
            sendQueue.add(
                ChunkJob(
                    transfer.msgId,
                    transfer.deviceId,
                    chunk.chunkIndex,
                    chunk.toBytes(),
                    FileTransferProtocol.TYPE_PREVIEW
                )
            )
        }
    }

    // ============================================================
    // ORIGINAL CHUNKS
    // ============================================================
    private fun queueChunksForSend(
        transfer: ActiveTransfer
    ) {
        val data = transfer.data ?: return
        val chunks = splitIntoChunks(
            data,
            FileTransferProtocol.TYPE_ORIGINAL
        )

        var blockIndex = 0
        val blockChunks = mutableListOf<ByteArray>()

        chunks.forEachIndexed { index, chunk ->
            sendQueue.add(
                ChunkJob(
                    transfer.msgId,
                    transfer.deviceId,
                    chunk.chunkIndex,
                    chunk.toBytes(),
                    FileTransferProtocol.TYPE_ORIGINAL
                )
            )

            blockChunks.add(chunk.payload)

            if (blockChunks.size == BLOCK_SIZE || index == chunks.size - 1) {
                /*
                 * Se conserva FEC tal como estaba.
                 * No hacemos todavía recuperación automática.
                 */
                val parity = FileTransferProtocol.generateParityChunks(
                    blockChunks
                )

                parity.forEachIndexed { pIndex, pData ->
                    val parityChunkIndex = transfer.totalChunks + (blockIndex * PARITY_CHUNKS) + pIndex
                    val header = FileTransferProtocol.buildHeaderByte(
                        FileTransferProtocol.TYPE_ORIGINAL,
                        if (pIndex == parity.size - 1) {
                            FileTransferProtocol.POS_END
                        } else {
                            FileTransferProtocol.POS_MIDDLE
                        },
                        pIndex % 16
                    )

                    val packet = FileTransferProtocol.ChunkPacket(
                        header,
                        parityChunkIndex,
                        pData
                    )

                    sendQueue.add(
                        ChunkJob(
                            transfer.msgId,
                            transfer.deviceId,
                            parityChunkIndex,
                            packet.toBytes(),
                            FileTransferProtocol.TYPE_ORIGINAL
                        )
                    )
                }

                blockChunks.clear()
                blockIndex++
            }
        }
    }

    // ============================================================
    // SPLIT
    // ============================================================
    private fun splitIntoChunks(
        data: ByteArray,
        type: Int
    ): List<FileTransferProtocol.ChunkPacket> {
        val chunks = mutableListOf<FileTransferProtocol.ChunkPacket>()
        val totalChunks = FileTransferProtocol.calculateTotalChunks(
            data.size.toLong(),
            CHUNK_SIZE
        )

        for (i in 0 until totalChunks) {
            val start = i * CHUNK_SIZE
            val end = minOf(
                start + CHUNK_SIZE,
                data.size
            )
            val payload = data.copyOfRange(start, end)

            val position = when {
                totalChunks == 1 -> FileTransferProtocol.POS_SINGLE
                i == 0 -> FileTransferProtocol.POS_START
                i == totalChunks - 1 -> FileTransferProtocol.POS_END
                else -> FileTransferProtocol.POS_MIDDLE
            }

            val header = FileTransferProtocol.buildHeaderByte(
                type,
                position,
                i % 16
            )

            chunks.add(
                FileTransferProtocol.ChunkPacket(
                    header,
                    i,
                    payload
                )
            )
        }

        return chunks
    }

    // ============================================================
    // SEND QUEUE
    // ============================================================
    private fun processSendQueue() {
        if (isSending.get()) return
        isSending.set(true)

        currentJob = coroutineScope.launch {
            try {
                while (sendQueue.isNotEmpty() && isActive) {
                    val job = synchronized(sendQueue) {
                        if (sendQueue.isEmpty()) {
                            null
                        } else {
                            sendQueue.removeAt(0)
                        }
                    } ?: continue

                    val transfer = activeTransfers[job.msgId]
                    if (transfer == null || transfer.currentState == TransferState.CANCELLED) {
                        continue
                    }

                    if (transfer.currentState == TransferState.PAUSED) {
                        synchronized(sendQueue) {
                            sendQueue.add(job)
                        }
                        delay(50)
                        continue
                    }

                    val success = gattWriter?.writeChunk(
                        job.deviceId,
                        job.data
                    ) ?: false

                    if (success) {
                        transfer.chunksSent.add(
                            job.chunkIndex
                        )
                        transfer.lastActivity = System.currentTimeMillis()

                        handler.post {
                            callbacks?.onChunkSent(
                                job.msgId,
                                job.chunkIndex
                            )

                            if (job.type == FileTransferProtocol.TYPE_ORIGINAL) {
                                val originalSent = transfer.chunksSent
                                    .count { it < transfer.totalChunks }
                                val progress = if (transfer.totalChunks > 0) {
                                    (
                                        originalSent
                                            .toDouble() / transfer.totalChunks * 100
                                    ).toInt()
                                } else {
                                    0
                                }

                                val bytesSent = minOf(
                                    transfer.fileSize,
                                    originalSent
                                        .toLong() * CHUNK_SIZE
                                )

                                callbacks?.onProgress(
                                    job.msgId,
                                    progress,
                                    bytesSent,
                                    transfer.fileSize
                                )
                            }
                        }

                        /*
                         * El ACK de bloque se mantiene,
                         * pero el receptor será quien confirme
                         * qué recibió realmente.
                         */
                        if (
                            job.type == FileTransferProtocol.TYPE_ORIGINAL &&
                            job.chunkIndex > 0 &&
                            job.chunkIndex % BLOCK_SIZE == 0
                        ) {
                            requestBlockAck(
                                transfer,
                                job.chunkIndex / BLOCK_SIZE
                            )
                        }
                    } else {
                        if (job.retryCount < MAX_RETRIES) {
                            synchronized(sendQueue) {
                                sendQueue.add(
                                    0,
                                    job.copy(
                                        retryCount = job.retryCount + 1
                                    )
                                )
                            }
                        } else {
                            Log.e(
                                TAG,
                                "Max retries alcanzado para chunk " + job.chunkIndex
                            )
                            transfer.currentState = TransferState.ERROR

                            handler.post {
                                callbacks?.onTransferComplete(
                                    transfer.msgId,
                                    false,
                                    "Error enviando chunk " + job.chunkIndex
                                )
                            }
                            continue
                        }
                    }

                    delay(
                        SEND_INTERVAL_MS
                    )
                }
            } finally {
                isSending.set(false)
            }
        }
    }

    // ============================================================
    // ACK
    // ============================================================
    private fun requestBlockAck(
        transfer: ActiveTransfer,
        blockIndex: Int
    ) {
        val ack = FileTransferProtocol.FileAck(
            msgId = transfer.msgId,
            blockIndex = blockIndex,
            status = "ok"
        )

        gattWriter?.writeControlMessage(
            transfer.deviceId,
            ack.toJson().toString()
        )
    }

    // ============================================================
    // INCOMING CHUNK
    // ============================================================
    fun processIncomingChunk(
        deviceId: String,
        chunkData: ByteArray
    ) {
        if (!FileTransferProtocol.validateChunk(chunkData)) {
            Log.w(
                TAG,
                "Chunk inválido recibido"
            )
            return
        }

        val packet = FileTransferProtocol
            .ChunkPacket
            .fromBytes(chunkData) ?: return

        val (type, position, _) = FileTransferProtocol
            .parseHeaderByte(
                packet.header
            )

        /*
         * Solo permitimos tipos que pertenecen
         * al protocolo de archivos.
         */
        if (
            type != FileTransferProtocol.TYPE_THUMB &&
            type != FileTransferProtocol.TYPE_PREVIEW &&
            type != FileTransferProtocol.TYPE_ORIGINAL
        ) {
            Log.w(
                TAG,
                "Tipo de chunk no válido: $type"
            )
            return
        }

        val transfer = findTransferForIncomingChunk(
            deviceId,
            packet.chunkIndex,
            type
        )

        if (transfer == null) {
            Log.w(
                TAG,
                "Chunk recibido sin transferencia activa"
            )
            return
        }

        transfer.lastActivity = System.currentTimeMillis()

        // ========================================================
        // THUMBNAIL
        // ========================================================
        if (type == FileTransferProtocol.TYPE_THUMB) {
            /*
             * Todavía conservamos thumbnail/preview en memoria
             * porque son deliberadamente pequeños.
             */
            synchronized(transfer) {
                transfer.thumbnailData = (
                    transfer.thumbnailData ?: byteArrayOf()
                ) + packet.payload
            }

            if (
                position == FileTransferProtocol.POS_END ||
                position == FileTransferProtocol.POS_SINGLE
            ) {
                val data = transfer.thumbnailData
                if (data != null) {
                    handler.post {
                        callbacks?.onThumbnailReady(
                            transfer.msgId,
                            data
                        )
                    }
                }
            }
            return
        }

        // ========================================================
        // PREVIEW
        // ========================================================
        if (type == FileTransferProtocol.TYPE_PREVIEW) {
            synchronized(transfer) {
                transfer.previewData = (
                    transfer.previewData ?: byteArrayOf()
                ) + packet.payload
            }

            if (
                position == FileTransferProtocol.POS_END ||
                position == FileTransferProtocol.POS_SINGLE
            ) {
                val data = transfer.previewData
                if (data != null) {
                    handler.post {
                        callbacks?.onPreviewReady(
                            transfer.msgId,
                            data
                        )
                    }
                }
            }
            return
        }

        // ========================================================
        // ORIGINAL
        // ========================================================
        /*
         * Los índices de paridad no forman parte
         * de los chunks originales.
         */
        if (
            packet.chunkIndex < 0 ||
            packet.chunkIndex >= transfer.totalChunks
        ) {
            Log.d(
                TAG,
                "Ignorando chunk fuera de rango: " + packet.chunkIndex
            )
            return
        }

        /*
         * FIX: duplicados.
         *
         * No volvemos a escribir un chunk que ya
         * recibimos correctamente.
         */
        val isNew = transfer.chunksReceived.add(
            packet.chunkIndex
        )

        if (!isNew) {
            Log.d(
                TAG,
                "Chunk duplicado ignorado: " + packet.chunkIndex
            )
            return
        }

        /*
         * FIX: escritura directa en disco.
         */
        val written = appendChunkToFile(
            transfer,
            packet.chunkIndex,
            packet.payload
        )

        if (!written) {
            transfer.chunksReceived.remove(
                packet.chunkIndex
            )
            transfer.currentState = TransferState.ERROR

            handler.post {
                callbacks?.onTransferComplete(
                    transfer.msgId,
                    false,
                    "Error escribiendo archivo"
                )
            }
            return
        }

        transfer.bytesReceived.addAndGet(
            packet.payload.size.toLong()
        )

        // ========================================================
        // PROGRESS
        // ========================================================
        val received = transfer.chunksReceived.size
        val progress = if (transfer.totalChunks > 0) {
            (
                received.toDouble() / transfer.totalChunks * 100
            ).toInt().coerceIn(0, 100)
        } else {
            0
        }

        handler.post {
            callbacks?.onProgress(
                transfer.msgId,
                progress,
                minOf(
                    transfer.bytesReceived.get(),
                    transfer.fileSize
                ),
                transfer.fileSize
            )
        }

        /*
         * FIX: completar solamente cuando:
         *
         * 1. todos los chunks están presentes
         * 2. el tamaño recibido coincide
         * 3. SHA-256 coincide
         */
        if (transfer.chunksReceived.size >= transfer.totalChunks) {
            completeTransfer(
                transfer
            )
        }
    }

    // ============================================================
    // CONTROL MESSAGE
    // ============================================================
    fun processControlMessage(
        deviceId: String,
        jsonString: String
    ) {
        try {
            val json = org.json.JSONObject(
                jsonString
            )
            val type = json.optString(
                "type",
                ""
            )
            val msgId = json.optString(
                "msgId",
                ""
            )

            when (type) {
                FileTransferProtocol.MSG_FILE_META -> handleFileMeta(
                    deviceId,
                    json
                )
                FileTransferProtocol.MSG_FILE_PROGRESS -> handleFileProgress(
                    deviceId,
                    json
                )
                FileTransferProtocol.MSG_FILE_RESUME -> handleFileResume(
                    deviceId,
                    json
                )
                FileTransferProtocol.MSG_FILE_ACK -> handleFileAck(
                    deviceId,
                    json
                )
                FileTransferProtocol.MSG_FILE_COMPLETE -> handleFileComplete(
                    deviceId,
                    json
                )
                FileTransferProtocol.MSG_FILE_CANCEL -> handleFileCancel(
                    deviceId,
                    msgId
                )
            }
        } catch (e: Exception) {
            Log.e(
                TAG,
                "Error procesando mensaje de control",
                e
            )
        }
    }

    // ============================================================
    // FILE META
    // ============================================================
    private fun handleFileMeta(
        deviceId: String,
        json: org.json.JSONObject
    ) {
        val meta = FileTransferProtocol
            .FileMeta
            .fromJson(json)

        /*
         * Validaciones básicas antes de reservar
         * espacio o aceptar chunks.
         */
        if (
            meta.msgId.isBlank() ||
            meta.fileName.isBlank() ||
            meta.fileSize <= 0L ||
            meta.fileSize > MAX_FILE_SIZE ||
            meta.totalChunks <= 0
        ) {
            Log.e(
                TAG,
                "Metadata de archivo inválida"
            )
            return
        }

        val expectedChunks = FileTransferProtocol
            .calculateTotalChunks(
                meta.fileSize,
                CHUNK_SIZE
            )

        if (expectedChunks != meta.totalChunks) {
            Log.e(
                TAG,
                "totalChunks incorrecto. " +
                    "Esperado=$expectedChunks " +
                    "Recibido=${meta.totalChunks}"
            )
            return
        }

        /*
         * Si ya existe la transferencia,
         * no la reemplazamos ciegamente.
         */
        val existing = activeTransfers[meta.msgId]
        if (existing != null) {
            if (existing.direction == ActiveTransfer.Direction.RECEIVE) {
                Log.d(
                    TAG,
                    "Metadata duplicada para ${meta.msgId}"
                )
                return
            }
            Log.w(
                TAG,
                "msgId ocupado: ${meta.msgId}"
            )
            return
        }

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

        /*
         * Crear archivo temporal.
         *
         * File.createTempFile utiliza el directorio temporal
         * de la aplicación/runtime. En el siguiente paso,
         * cuando conectemos el manager con NexoBlePlugin,
         * lo cambiaremos a context.cacheDir/filesDir para
         * que quede totalmente controlado por NEXO.
         */
        try {
            val tempFile = File.createTempFile(
                "nexo_${meta.msgId}_",
                ".part"
            )

            /*
             * Preasignamos el tamaño esperado.
             * No cargamos el contenido en RAM.
             */
            RandomAccessFile(
                tempFile,
                "rw"
            ).use { raf ->
                raf.setLength(meta.fileSize)
            }

            transfer.tempFile = tempFile
        } catch (e: Exception) {
            Log.e(
                TAG,
                "No se pudo crear archivo temporal",
                e
            )

            handler.post {
                callbacks?.onTransferComplete(
                    meta.msgId,
                    false,
                    "No se pudo crear archivo temporal"
                )
            }
            return
        }

        activeTransfers[meta.msgId] = transfer

        /*
         * Mantener callback existente.
         *
         * Esto permite que la UI conozca inmediatamente
         * que comenzó una recepción.
         */
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

    // ============================================================
    // FILE PROGRESS
    // ============================================================
    private fun handleFileProgress(
        deviceId: String,
        json: org.json.JSONObject
    ) {
        val msgId = json.optString(
            "msgId",
            ""
        )
        val chunksReceived = json.optInt(
            "chunksReceived",
            0
        )
        val totalChunks = json.optInt(
            "totalChunks",
            0
        )

        val transfer = activeTransfers[msgId] ?: return

        if (totalChunks <= 0) {
            return
        }

        val progress = (
            chunksReceived.toDouble() / totalChunks * 100
        )
            .toInt()
            .coerceIn(0, 100)

        val bytesReceived = minOf(
            transfer.fileSize,
            chunksReceived.toLong() * CHUNK_SIZE
        )

        handler.post {
            callbacks?.onProgress(
                msgId,
                progress,
                bytesReceived,
                transfer.fileSize
            )
        }
    }

    // ============================================================
    // RESUME
    // ============================================================
    private fun handleFileResume(
        deviceId: String,
        json: org.json.JSONObject
    ) {
        val msgId = json.optString(
            "msgId",
            ""
        )
        val lastChunkReceived = json.optInt(
            "lastChunkReceived",
            -1
        )

        val transfer = activeTransfers[msgId] ?: return

        if (transfer.direction == ActiveTransfer.Direction.SEND) {
            handler.post {
                callbacks?.onResumeRequest(
                    msgId,
                    lastChunkReceived
                )
            }
            resumeSendFromChunk(
                transfer,
                lastChunkReceived + 1
            )
        }
    }

    // ============================================================
    // ACK
    // ============================================================
    private fun handleFileAck(
        deviceId: String,
        json: org.json.JSONObject
    ) {
        val msgId = json.optString(
            "msgId",
            ""
        )
        val blockIndex = json.optInt(
            "blockIndex",
            0
        )
        val status = json.optString(
            "status",
            "ok"
        )

        val transfer = activeTransfers[msgId] ?: return

        if (status != "missing") {
            return
        }

        val startChunk = blockIndex * BLOCK_SIZE
        val endChunk = minOf(
            startChunk + BLOCK_SIZE,
            transfer.totalChunks
        )

        val missingChunks = mutableListOf<Int>()
        for (i in startChunk until endChunk) {
            if (!transfer.chunksSent.contains(i)) {
                missingChunks.add(i)
            }
        }

        handler.post {
            callbacks?.onChunkAck(
                msgId,
                blockIndex,
                missingChunks
            )
        }

        /*
         * Reenviar chunks faltantes.
         */
        missingChunks.forEach { chunkIndex ->
            val data = transfer.data ?: return@forEach
            val start = chunkIndex * CHUNK_SIZE
            val end = minOf(
                start + CHUNK_SIZE,
                data.size
            )

            if (start >= data.size) {
                return@forEach
            }

            val payload = data.copyOfRange(start, end)
            val position = when {
                transfer.totalChunks == 1 -> FileTransferProtocol.POS_SINGLE
                chunkIndex == 0 -> FileTransferProtocol.POS_START
                chunkIndex == transfer.totalChunks - 1 -> FileTransferProtocol.POS_END
                else -> FileTransferProtocol.POS_MIDDLE
            }

            val header = FileTransferProtocol
                .buildHeaderByte(
                    FileTransferProtocol.TYPE_ORIGINAL,
                    position,
                    chunkIndex % 16
                )

            val packet = FileTransferProtocol.ChunkPacket(
                header,
                chunkIndex,
                payload
            )

            synchronized(sendQueue) {
                sendQueue.add(
                    ChunkJob(
                        msgId,
                        deviceId,
                        chunkIndex,
                        packet.toBytes(),
                        FileTransferProtocol.TYPE_ORIGINAL
                    )
                )
            }
        }

        processSendQueue()
    }

    // ============================================================
    // REMOTE COMPLETE
    // ============================================================
    private fun handleFileComplete(
        deviceId: String,
        json: org.json.JSONObject
    ) {
        val msgId = json.optString(
            "msgId",
            ""
        )
        val transfer = activeTransfers[msgId] ?: return
        /*
         * No marcamos COMPLETED aquí para un RECEIVE.
         *
         * La transferencia local solamente se completa
         * después de validar el archivo y checksum.
         */
        if (transfer.direction == ActiveTransfer.Direction.SEND) {
            transfer.currentState = TransferState.COMPLETED
            handler.post {
                callbacks?.onTransferComplete(
                    msgId,
                    true,
                    null
                )
            }
        }
    }
    // ============================================================
    // CANCEL
    // ============================================================
    private fun handleFileCancel(
        deviceId: String,
        msgId: String
    ) {
        val transfer = activeTransfers[msgId] ?: return
        transfer.currentState = TransferState.CANCELLED
        deleteTempFile(transfer)
        handler.post {
            callbacks?.onTransferComplete(
                msgId,
                false,
                "Cancelado por el remitente"
            )
        }
    }
    // ============================================================
    // RESUME SEND
    // ============================================================
    private fun resumeSendFromChunk(
        transfer: ActiveTransfer,
        fromChunk: Int
    ) {
        val data = transfer.data ?: return
        val startChunk = fromChunk.coerceAtLeast(0)
        val totalChunks = FileTransferProtocol
            .calculateTotalChunks(
                data.size.toLong(),
                CHUNK_SIZE
            )
        for (i in startChunk until totalChunks) {
            if (transfer.chunksSent.contains(i)) {
                continue
            }
            val start = i * CHUNK_SIZE
            val end = minOf(
                start + CHUNK_SIZE,
                data.size
            )
            val payload = data.copyOfRange(start, end)
            val position = when {
                totalChunks == 1 -> FileTransferProtocol.POS_SINGLE
                i == 0 -> FileTransferProtocol.POS_START
                i == totalChunks - 1 -> FileTransferProtocol.POS_END
                else -> FileTransferProtocol.POS_MIDDLE
            }
            val header = FileTransferProtocol
                .buildHeaderByte(
                    FileTransferProtocol.TYPE_ORIGINAL,
                    position,
                    i % 16
                )
            val packet = FileTransferProtocol.ChunkPacket(
                header,
                i,
                payload
            )
            synchronized(sendQueue) {
                sendQueue.add(
                    ChunkJob(
                        transfer.msgId,
                        transfer.deviceId,
                        i,
                        packet.toBytes(),
                        FileTransferProtocol.TYPE_ORIGINAL
                    )
                )
            }
        }
        transfer.currentState = TransferState.SENDING
        processSendQueue()
    }
    // ============================================================
    // COMPLETE LOCAL RECEIVE
    // ============================================================
    private fun completeTransfer(
        transfer: ActiveTransfer
    ) {
        if (transfer.currentState != TransferState.RECEIVING) {
            return
        }

        /*
         * Verificación 1:
         * todos los chunks originales.
         */
        if (transfer.chunksReceived.size != transfer.totalChunks) {
            return
        }
        /*
         * Verificación 2:
         * tamaño.
         */
        if (transfer.bytesReceived.get() != transfer.fileSize) {
            Log.e(
                TAG,
                "Tamaño incorrecto para ${transfer.msgId}: " +
                    "esperado=${transfer.fileSize} " +
                    "recibido=${transfer.bytesReceived.get()}"
            )
            transfer.currentState = TransferState.ERROR
            handler.post {
                callbacks?.onTransferComplete(
                    transfer.msgId,
                    false,
                    "Tamaño de archivo incorrecto"
                )
            }
            deleteTempFile(transfer)
            return
        }
        /*
         * Verificación 3:
         * SHA-256.
         */
        val tempFile = transfer.tempFile
        if (tempFile == null || !tempFile.exists()) {
            transfer.currentState = TransferState.ERROR

            handler.post {
                callbacks?.onTransferComplete(
                    transfer.msgId,
                    false,
                    "Archivo temporal no encontrado"
                )
            }
            return
        }
        val actualChecksum = try {
            calculateFileChecksum(tempFile)
        } catch (e: Exception) {
            Log.e(
                TAG,
                "Error calculando SHA-256",
                e
            )
            transfer.currentState = TransferState.ERROR

            handler.post {
                callbacks?.onTransferComplete(
                    transfer.msgId,
                    false,
                    "Error verificando archivo"
                )
            }
            deleteTempFile(transfer)
            return
        }
        /*
         * Si metadata no contiene checksum,
         * no inventamos uno.
         *
         * Para esta primera fase aceptamos el archivo,
         * pero dejamos constancia en log.
         */
        if (
            transfer.checksum.isNotBlank() &&
            !actualChecksum.equals(
                transfer.checksum,
                ignoreCase = true
            )
        ) {
            Log.e(
                TAG,
                "CHECKSUM INCORRECTO para " + transfer.msgId
            )
            transfer.currentState = TransferState.ERROR

            handler.post {
                callbacks?.onTransferComplete(
                    transfer.msgId,
                    false,
                    "SHA-256 no coincide"
                )
            }

            deleteTempFile(transfer)
            return
        }
        /*
         * Transferencia válida.
         */
        transfer.currentState = TransferState.COMPLETED
        /*
         * Confirmación al emisor.
         */
        val complete = org.json.JSONObject().apply {
            put("v", 1)
            put(
                "type",
                FileTransferProtocol
                    .MSG_FILE_COMPLETE
            )
            put("msgId", transfer.msgId)
            put("ts", System.currentTimeMillis())
        }

        gattWriter?.writeControlMessage(
            transfer.deviceId,
            complete.toString()
        )
        handler.post {
            callbacks?.onProgress(
                transfer.msgId,
                100,
                transfer.fileSize,
                transfer.fileSize
            )
            callbacks?.onTransferComplete(
                transfer.msgId,
                true,
                null
            )
        }
        Log.i(
            TAG,
            "Archivo recibido correctamente: " +
                transfer.fileName +
                " (" +
                transfer.fileSize +
                " bytes)"
        )
    }
    // ============================================================
    // FIND RECEIVE TRANSFER
    // ============================================================
    private fun findTransferForIncomingChunk(
        deviceId: String,
        chunkIndex: Int,
        type: Int
    ): ActiveTransfer? {
        /*
         * Primero buscamos por dispositivo.
         *
         * Para ORIGINAL solamente aceptamos un índice
         * dentro del rango de la transferencia.
         */
        return activeTransfers.values
            .firstOrNull { transfer ->
                transfer.deviceId == deviceId &&
                    transfer.currentState == TransferState.RECEIVING &&
                    when (type) {
                        FileTransferProtocol.TYPE_ORIGINAL ->
                            chunkIndex >= 0 && chunkIndex < transfer.totalChunks
                        FileTransferProtocol.TYPE_THUMB,
                        FileTransferProtocol.TYPE_PREVIEW ->
                            true
                        else ->
                            false
                    }
            }
    }
    private fun findTransferByDeviceId(
        deviceId: String
    ): ActiveTransfer? {
        return activeTransfers.values
            .find {
                it.deviceId == deviceId &&
                    it.currentState == TransferState.RECEIVING
            }
    }
    // ============================================================
    // WRITE CHUNK TO TEMP FILE
    // ============================================================
    private fun appendChunkToFile(
        transfer: ActiveTransfer,
        chunkIndex: Int,
        data: ByteArray
    ): Boolean {
        if (data.isEmpty()) {
            return false
        }
        val file = transfer.tempFile ?: return false

        /*
         * Posición exacta.
         *
         * Esto permite recibir chunks fuera de orden
         * sin tener que almacenarlos todos en RAM.
         */
        val offset = chunkIndex.toLong() * CHUNK_SIZE.toLong()

        /*
         * El último chunk puede ser menor.
         */
        if (offset < 0L || offset >= transfer.fileSize) {
            return false
        }

        if (offset + data.size > transfer.fileSize) {
            return false
        }
        return try {
            RandomAccessFile(
                file,
                "rw"
            ).use { raf ->
                raf.seek(offset)
                raf.write(data)
            }
            true
        } catch (e: Exception) {
            Log.e(
                TAG,
                "Error escribiendo chunk $chunkIndex",
                e
            )
            false
        }
    }
    // ============================================================
    // SHA-256 BYTE ARRAY
    // ============================================================
    private fun calculateChecksum(
        data: ByteArray
    ): String {
        val digest = MessageDigest.getInstance(
            "SHA-256"
        )
        val hash = digest.digest(data)
        return hash.joinToString("") {
            "%02x".format(it)
        }
    }
    // ============================================================
    // SHA-256 FILE
    // ============================================================
    private fun calculateFileChecksum(
        file: File
    ): String {
        val digest = MessageDigest.getInstance(
            "SHA-256"
        )
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) {
                    break
                }
                digest.update(
                    buffer,
                    0,
                    read
                )
            }
        }
        val hash = digest.digest()
        return hash.joinToString("") {
            "%02x".format(it)
        }
    }
    // ============================================================
    // DELETE TEMP
    // ============================================================
    private fun deleteTempFile(
        transfer: ActiveTransfer
    ) {
        try {
            transfer.tempFile?.let {
                if (it.exists()) {
                    it.delete()
                }
            }
            transfer.tempFile = null
        } catch (e: Exception) {
            Log.w(
                TAG,
                "No se pudo eliminar temporal",
                e
            )
        }
    }
    // ============================================================
    // PUBLIC PROGRESS
    // ============================================================
    fun getTransferProgress(
        msgId: String
    ): Int {
        val transfer = activeTransfers[msgId] ?: return 0
        return if (transfer.totalChunks > 0) {
            when (transfer.direction) {
                ActiveTransfer.Direction.SEND -> {
                    val sent = transfer.chunksSent
                        .count { it < transfer.totalChunks }
                    (
                        sent.toDouble() / transfer.totalChunks * 100
                    )
                        .toInt()
                        .coerceIn(0, 100)
                }
                ActiveTransfer.Direction.RECEIVE -> {
                    (
                        transfer.chunksReceived
                            .size
                            .toDouble() / transfer.totalChunks * 100
                    )
                        .toInt()
                        .coerceIn(0, 100)
                }
            }
        } else {
            0
        }
    }
    // ============================================================
    // CANCEL
    // ============================================================
    fun cancelTransfer(
        msgId: String
    ) {
        val transfer = activeTransfers[msgId] ?: return
        transfer.currentState = TransferState.CANCELLED
        val cancel = org.json.JSONObject().apply {
            put("v", 1)
            put(
                "type",
                FileTransferProtocol
                    .MSG_FILE_CANCEL
            )
            put("msgId", msgId)
            put("ts", System.currentTimeMillis())
        }
        gattWriter?.writeControlMessage(
            transfer.deviceId,
            cancel.toString()
        )
        synchronized(sendQueue) {
            sendQueue.removeAll {
                it.msgId == msgId
            }
        }
        deleteTempFile(transfer)
    }
    // ============================================================
    // PAUSE / RESUME
    // ============================================================
    fun pauseTransfer(
        msgId: String
    ) {
        val transfer = activeTransfers[msgId] ?: return
        if (transfer.currentState == TransferState.SENDING) {
            transfer.currentState = TransferState.PAUSED
        }
    }
    fun resumeTransfer(
        msgId: String
    ) {
        val transfer = activeTransfers[msgId] ?: return
        if (transfer.currentState == TransferState.PAUSED) {
            transfer.currentState = TransferState.SENDING
            processSendQueue()
        }
    }
    // ============================================================
    // CLEANUP
    // ============================================================
    fun cleanupTransfer(
        msgId: String
    ) {
        val transfer = activeTransfers.remove(msgId)
        transfer?.let {
            deleteTempFile(it)
        }
        synchronized(sendQueue) {
            sendQueue.removeAll {
                it.msgId == msgId
            }
        }
    }
    fun cleanupAll() {
        activeTransfers.values
            .forEach {
                deleteTempFile(it)
            }
        activeTransfers.clear()
        synchronized(sendQueue) {
            sendQueue.clear()
        }
        currentJob?.cancel()
        isSending.set(false)
    }
    fun destroy() {
        cleanupAll()
        callbacks = null
        gattWriter = null
        coroutineScope.cancel()
    }
}
