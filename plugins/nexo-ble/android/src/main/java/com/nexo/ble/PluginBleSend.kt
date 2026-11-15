package com.nexo.ble

import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothProfile
import android.os.Build
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.util.Collections
import com.nexo.ble.NexoBlePlugin.Companion.MAX_QUEUE_SIZE
import com.nexo.ble.NexoBlePlugin.Companion.CLIENT_WRITE_TIMEOUT_MS
import com.nexo.ble.NexoBlePlugin.Companion.SERVER_NOTIFY_TIMEOUT_MS
import com.nexo.ble.NexoBlePlugin.WriteQueueItem
import com.nexo.ble.NexoBlePlugin.SendResult

// Bluetooth: enviar (cola de escrituras, trozos y ritmo).
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

// Ronda 2753: un trozo de archivo en binario (BinFrame): cabecera JSON + datos (llegan en base64 por el puente de
// la app, pero por la radio van como bytes). La app solo lo usa si el otro teléfono avisó de que lo entiende.
internal fun NexoBlePlugin.sendBinaryImpl(call: PluginCall) {
    val rawDeviceId = call.getString("deviceId") ?: ""
    val header = call.getString("header") ?: ""
    val data = try { Base64.decode(call.getString("data") ?: "", Base64.NO_WRAP) } catch (e: Exception) { null }
    if (rawDeviceId.isEmpty() || header.isEmpty() || data == null) { call.reject("deviceId, header y data requeridos"); return }
    if (classifyDeviceId(rawDeviceId) == "invalid") { call.reject("ID invalido: no es NXID ni MAC", "INVALID_DEVICE_ID"); return }
    mainHandler.post {
        val macNorm = if (classifyDeviceId(rawDeviceId) == "nxid") resolveMacForNexoId(rawDeviceId.trim()) else normalizeMac(rawDeviceId)
        if (macNorm == null) { call.reject("NXID no resuelto a MAC: $rawDeviceId", "NXID_UNRESOLVED"); return@post }
        val frame = try { BinFrame.encode(header, data) } catch (e: Exception) { call.reject(e.message ?: "trozo binario no válido"); return@post }
        val mtu = negotiatedMtu[macNorm] ?: 23
        val writes = BinFrame.split(frame, (mtu - 3).coerceIn(20, 512))
        val queue = writeQueues.getOrPut(macNorm) { java.util.Collections.synchronizedList(mutableListOf()) }
        val msgId = writeMsgCounter.incrementAndGet()
        val ok = synchronized(queue) {
            if (queue.isNotEmpty() && queue.size + writes.size > MAX_QUEUE_SIZE) false
            // pacing 2b (#141): trozo de archivo = BAJA prioridad (isHigh=false) → al final de la cola (texto/ack lo adelanta)
            else { writes.forEach { queue.add(WriteQueueItem(macNorm, rawDeviceId, "", msgId, it, false)) }; true }
        }
        if (!ok) { call.reject("Cola de escritura llena para $macNorm", "BLE_BUSY"); return@post }
        remLog("INFO", "SEND", "sendBinary MAC='$macNorm' bytes=${frame.size} writes=${writes.size}")
        processWriteQueue(macNorm)
        call.resolve(JSObject().put("sent", true).put("mode", "queued").put("deviceId", rawDeviceId).put("mtu", mtu))
    }
}

// === FIX vFIX-3: sendMessage corre SIEMPRE en mainHandler (single-threaded) ===
internal fun NexoBlePlugin.sendMessageImpl(call: PluginCall) {
    val rawDeviceId = call.getString("deviceId") ?: ""
    val message = call.getString("message") ?: call.getString("content") ?: ""

    if (rawDeviceId.isEmpty()) {
        call.reject("deviceId requerido")
        return
    }
    val idType = classifyDeviceId(rawDeviceId)
    if (idType == "invalid") {
        call.reject("ID invalido: no es NXID ni MAC", "INVALID_DEVICE_ID")
        return
    }

    mainHandler.post {
        val macNorm: String
        if (idType == "nxid") {
            val resolvedMac = resolveMacForNexoId(rawDeviceId.trim())
            if (resolvedMac == null) {
                call.reject("NXID no resuelto a MAC: $rawDeviceId", "NXID_UNRESOLVED")
                return@post
            }
            macNorm = resolvedMac
            remLog("INFO", "SEND", "sendMessage NXID='$rawDeviceId' → MAC='$macNorm' len=${message.length}")
        } else {
            macNorm = normalizeMac(rawDeviceId)
            remLog("INFO", "SEND", "sendMessage MAC='$macNorm' len=${message.length}")
        }

        val result = sendChunkedOrSingle(macNorm, rawDeviceId, message)
        // MTU negociado: el JS ajusta el tamaño de los trozos de archivos (ble_ack.js)
        val mtu = negotiatedMtu[macNorm] ?: 23
        if (result.sent) {
            call.resolve(JSObject().put("sent", true).put("mode", result.mode).put("deviceId", rawDeviceId).put("mtu", mtu))
        } else {
            // v2729: solo pasa con la cola de escritura llena (el mensaje entero no cabe). "Ocupado": la app lo
            // reintenta en un momento. Antes se aparcaba en la cola de pendientes (solo se vaciaba al reconectar)
            // y la app lo daba por enviado: el último trozo de cada ventana esperaba a que venciera su espera.
            call.reject("Cola de escritura llena para $macNorm", "BLE_BUSY")
        }
    }
}

// v2723: un mensaje entra entero en la cola o no entra (antes, con la cola llena se descartaban trozos del
// medio y el otro teléfono recibía un mensaje mutilado: "mensaje de código" en el chat y foto parada)
internal fun NexoBlePlugin.sendChunkedOrSingle(macNorm: String, rawDeviceId: String, message: String): SendResult {
    // 3059 (diagnóstico automático del S24 13-11 07:51, tablet recién conectada): un mensaje que llega mientras el enlace CLIENTE
    // aún negocia el MTU se partía en trozos de 20 bytes (70 escrituras para 1,4 KB) aunque segundos después el MTU fuera 512.
    // Ahora espera entero en la cola de pendientes y se parte al terminar la puesta en marcha (startNotifications), con el MTU real.
    val srvReadyNow = serverConnectedDevices[macNorm] != null && serverNotificationEnabled.getOrDefault(macNorm, false)
    if (!srvReadyNow && clientRxCharacteristics[macNorm] != null && clientSetupDone[macNorm] == false) {
        pendingMessageQueue.getOrPut(macNorm) { mutableListOf() }.add(message)
        return SendResult(true, "queued")
    }
    // Ronda 2757: por bytes reales (MTU - 3, máx. 512 por atributo), sin cortar caracteres (Utf8Split, BinFrame.kt)
    val maxBytes = ((negotiatedMtu[macNorm] ?: 23) - 3).coerceIn(20, 512)
    val chunks = Utf8Split.split(message, maxBytes)
    val queue = writeQueues.getOrPut(macNorm) { java.util.Collections.synchronizedList(mutableListOf()) }
    val msgId = writeMsgCounter.incrementAndGet()
    synchronized(queue) {
        // (un mensaje más grande que la cola entera entra cuando está vacía: si no, esperaría para siempre)
        if (queue.isNotEmpty() && queue.size + chunks.size > MAX_QUEUE_SIZE) {
            remLog("WARN", "SEND", "Cola llena para $macNorm: el mensaje espera (no se parte)")
            return SendResult(false, "")
        }
        // pacing 2b (#141): texto/control/ack = ALTA prioridad → se inserta DELANTE de los trozos de archivo ya
        // encolados (sin mover el item en vuelo, índice 0), para no esperar a que termine un archivo lento (MTU 23).
        var at = WritePacing.insertIndex(queue.map { it.isHigh }, true)
        chunks.forEach { queue.add(at, WriteQueueItem(macNorm, rawDeviceId, it, msgId)); at++ }
    }
    // La cola se procesa solo en el hilo principal (los callbacks de Android también llegan ahí)
    mainHandler.post { processWriteQueue(macNorm) }
    return SendResult(true, "queued")
}

// === FIX F0: Pacing diferenciado server vs client ===
// Control de flujo por callback (v2): una escritura en vuelo por dispositivo; la siguiente sale en
// cuanto Android confirma la anterior (onCharacteristicWrite como cliente, onNotificationSent como
// servidor), con un timeout de respaldo. Antes: esperas fijas de 40/80 ms y reintentos con
// Thread.sleep en el hilo principal (congelaban la interfaz).
internal fun NexoBlePlugin.processWriteQueue(macNorm: String) {
    if (writeQueueProcessing[macNorm] == true) return
    val queue = writeQueues[macNorm] ?: return
    val item = synchronized(queue) { if (queue.isEmpty()) null else queue[0] } ?: return
    // 3059: por el enlace CLIENTE no se escribe mientras se negocia el MTU / se activan las notificaciones (WriteRetry.waitForClientSetup)
    val srvReady = serverConnectedDevices[item.macNorm] != null && serverNotificationEnabled.getOrDefault(item.macNorm, false)
    val viaClient = !srvReady && clientRxCharacteristics[item.macNorm] != null
    if (viaClient && clientSetupDone[item.macNorm] != true) {
        val now = System.currentTimeMillis()
        val since = clientSetupWaitSince.getOrPut(macNorm) { now }
        if (WriteRetry.waitForClientSetup(true, false, now - since)) {
            writeQueueProcessing[macNorm] = true
            mainHandler.postDelayed({
                writeQueueProcessing.remove(macNorm)
                processWriteQueue(macNorm)
            }, WriteRetry.SETUP_WAIT_STEP_MS)
            return
        }
        clientSetupDone[item.macNorm] = true // pasado el plazo se da por hecho (una vez): no se vuelve a esperar ni a avisar
        remLog("WARN", "SEND", "Enlace $macNorm sin terminar MTU/notificaciones en ${WriteRetry.SETUP_WAIT_MAX_MS / 1000} s: se escribe igual")
    }
    clientSetupWaitSince.remove(macNorm)
    val result = sendSingleChunk(item.macNorm, item.rawDeviceId, item.chunk, item.bytes)
    if (!result.sent) {
        // Android rechaza la escritura si aún está ocupado con la anterior (muy frecuente con la radio
        // cargada, MTU 23). B1 (dueño 03-11): el rechazo es TRANSITORIO (la escritura sale en cuanto el stack
        // drena), así que se reintenta el MISMO trozo hasta ~9 s con un ritmo que se va espaciando (WriteRetry,
        // puro y probado en JVM; menos radio/batería en la cola larga); solo si ni así se puede, fuera el RESTO
        // DE ESE MENSAJE entero (no mutilado). Antes se rendía a los ~1,8 s y una congestión normal de MTU 23
        // perdía el mensaje. En una desconexión REAL la cola se vacía sola (manejador de desconexión) y esto ni
        // corre, así que no se espera 9 s con el enlace caído.
        val attempts = (writeRetryCount[macNorm] ?: 0) + 1
        val decision = WriteRetry.decide(attempts)
        val delay = decision.delayMs
        if (!decision.drop) {
            writeRetryCount[macNorm] = attempts
        } else {
            writeRetryCount.remove(macNorm)
            val dropped = synchronized(queue) { val before = queue.size; queue.removeAll { it.msgId == item.msgId }; before - queue.size }
            btErr("drop", "Write fallo para $macNorm durante ~${WriteRetry.maxWaitMs() / 1000} s (enlace congestionado/atascado): mensaje descartado entero ($dropped trozos" + (if (item.bytes != null) ", binario ${item.bytes.size} B" else "") + ")")
            // #dueño 04-11: avisar a la capa de arriba que este enlace BT soltó un mensaje (muerto/atascado) → re-rutea
            // por internet/Wi-Fi al toque en vez de seguir martillando el Bluetooth («internet antes que un BT muerto»).
            notifyListeners("onWriteDropped", JSObject().put("mac", macNorm))
            // #129 (dueño 08-11): tras N mensajes SEGUIDOS descartados al mismo enlace, está atascado de verdad → soltar
            // TODA la cola de ese MAC de una, en vez de moler cada mensaje ~6 s (el martilleo de ~2 min del diagnóstico).
            // La capa de arriba ya re-rutea/reintenta por otro camino (onWriteDropped + resume). El streak se reinicia
            // en cuanto una escritura sale bien (onWriteDone) o al limpiar la cola (desconexión).
            val streak = (writeDropStreak[macNorm] ?: 0) + 1
            writeDropStreak[macNorm] = streak
            if (WriteRetry.shouldFlushStuckQueue(streak)) {
                writeDropStreak.remove(macNorm)
                val restantes = synchronized(queue) { val n = queue.size; queue.clear(); n }
                if (restantes > 0) btErr("flush", "Enlace $macNorm atascado ($streak mensajes seguidos sin salir): suelto $restantes trozo(s) más en cola para no martillarlo (se reintentan por otro camino)")
            }
        }
        // Bloquear la cola durante la espera: otras llamadas no deben gastar los reintentos de golpe
        writeQueueProcessing[macNorm] = true
        mainHandler.postDelayed({
            writeQueueProcessing.remove(macNorm)
            processWriteQueue(macNorm)
        }, delay)
        return
    }
    writeRetryCount.remove(macNorm)
    writeDropStreak.remove(macNorm) // #129: salió una escritura → el enlace NO está atascado, reiniciar el conteo de atasco
    removeHead(queue, item)
    writeQueueProcessing[macNorm] = true
    val timeoutMs = if (result.mode == "gatt_server") SERVER_NOTIFY_TIMEOUT_MS else CLIENT_WRITE_TIMEOUT_MS
    val timeoutRunnable = Runnable {
        writeQueueTimeouts.remove(macNorm)
        onWriteDone(macNorm)
    }
    writeQueueTimeouts.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    writeQueueTimeouts[macNorm] = timeoutRunnable
    mainHandler.postDelayed(timeoutRunnable, timeoutMs)
}

private fun NexoBlePlugin.removeHead(queue: MutableList<WriteQueueItem>, item: WriteQueueItem) {
    synchronized(queue) { if (queue.isNotEmpty() && queue[0] === item) queue.removeAt(0) }
}

// Llamado (en el hilo principal) cuando Android confirma la escritura/notificación o vence el timeout
internal fun NexoBlePlugin.onWriteDone(macNorm: String) {
    writeQueueTimeouts.remove(macNorm)?.let { mainHandler.removeCallbacks(it) }
    writeQueueProcessing.remove(macNorm)
    processWriteQueue(macNorm)
}
// === FIN FIX F0 ===

// === FIX F0: Timeout de client write reducido y chunk size con margen ===
private fun NexoBlePlugin.sendSingleChunk(macNorm: String, rawDeviceId: String, chunk: String, bytes: ByteArray? = null): SendResult {
    val data = bytes ?: chunk.toByteArray(Charsets.UTF_8)

    val remoteDevice = serverConnectedDevices[macNorm]
    val srvTx = serverTxCharacteristic
    val srv = bluetoothGattServer
    val srvEnabled = serverNotificationEnabled.getOrDefault(macNorm, false)

    if (remoteDevice != null && srv != null && srvTx != null && srvEnabled) {
        try {
            val success = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                srv.notifyCharacteristicChanged(remoteDevice, srvTx, false, data) == BluetoothGatt.GATT_SUCCESS
            } else {
                @Suppress("DEPRECATION")
                srvTx.value = data
                @Suppress("DEPRECATION")
                srv.notifyCharacteristicChanged(remoteDevice, srvTx, false)
            }
            if (success) {
                remLog("INFO", "SEND", "GATT Server chunk sent to $macNorm len=${chunk.length}")
                return SendResult(true, "gatt_server")
            }
        } catch (e: Exception) {
            btErr("notify_ex", "Server notify failed for $macNorm (${data.size} B): ${e.message}")
        }
    }

    val rxChar = clientRxCharacteristics[macNorm]
    val gatt = gattClients[macNorm]

    if (gatt != null && rxChar != null && clientConnectionStates[macNorm] == BluetoothProfile.STATE_CONNECTED) {
        try {
            var writeInitiated = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val status = gatt.writeCharacteristic(rxChar, data, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE)
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    writeInitiated = true
                    remLog("INFO", "SEND", "GATT Client chunk sent (NO_RESPONSE) to $macNorm len=${chunk.length}")
                } else {
                    remLog("WARN", "SEND", "NO_RESPONSE fallo status=$status, intentando DEFAULT para $macNorm")
                    val fallbackStatus = gatt.writeCharacteristic(rxChar, data, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                    if (fallbackStatus == BluetoothGatt.GATT_SUCCESS) {
                        writeInitiated = true
                        remLog("INFO", "SEND", "GATT Client chunk sent (DEFAULT fallback) to $macNorm len=${chunk.length}")
                    }
                }
            } else {
                @Suppress("DEPRECATION")
                rxChar.value = data
                @Suppress("DEPRECATION")
                rxChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                @Suppress("DEPRECATION")
                writeInitiated = gatt.writeCharacteristic(rxChar)
                if (!writeInitiated) {
                    remLog("WARN", "SEND", "NO_RESPONSE fallo (legacy), intentando DEFAULT para $macNorm")
                    @Suppress("DEPRECATION")
                    rxChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                    @Suppress("DEPRECATION")
                    writeInitiated = gatt.writeCharacteristic(rxChar)
                    if (writeInitiated) {
                        remLog("INFO", "SEND", "GATT Client chunk sent (DEFAULT fallback legacy) to $macNorm len=${chunk.length}")
                    }
                } else {
                    remLog("INFO", "SEND", "GATT Client chunk sent (NO_RESPONSE legacy) to $macNorm len=${chunk.length}")
                }
            }
            if (writeInitiated) {
                return SendResult(true, "gatt_client")
            }
        } catch (e: Exception) {
            btErr("write_ex", "GATT Client write exception (${data.size} B): ${e.message}")
        }
    }

    return SendResult(false, "")
}
// === FIN FIX F0 ===

internal fun NexoBlePlugin.processPendingMessages(macNorm: String) {
    val queue = pendingMessageQueue.remove(macNorm) ?: return
    val gatt = gattClients[macNorm]
    val rxChar = clientRxCharacteristics[macNorm]
    if (gatt != null && rxChar != null && clientConnectionStates[macNorm] == BluetoothProfile.STATE_CONNECTED) {
        queue.forEachIndexed { index, msg ->
            mainHandler.postDelayed({
                val result = sendChunkedOrSingle(macNorm, "", msg)
                if (result.sent) {
                    remLog("INFO", "PENDING_QUEUE", "Mensaje encolado enviado a $macNorm")
                } else {
                    remLog("WARN", "PENDING_QUEUE", "Fallo enviando mensaje encolado a $macNorm")
                }
            }, index * 200L)
        }
    } else {
        remLog("WARN", "PENDING_QUEUE", "No se pudieron enviar ${queue.size} mensajes encolados, conexion no lista")
        queue.forEach { msg ->
            val q = pendingMessageQueue.getOrPut(macNorm) { mutableListOf() }
            q.add(msg)
        }
    }
}
