package com.nexo.ble

import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.Intent
import android.util.Base64
import com.getcapacitor.JSObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import org.json.JSONObject
import com.nexo.ble.NexoBlePlugin.Companion.MESSAGE_REASSEMBLY_TIMEOUT_MS
import com.nexo.ble.NexoBlePlugin.Companion.MESSAGE_MAX_PENDING_MS
import com.nexo.ble.NexoBlePlugin.Companion.MESSAGE_BUFFER_MAX_CHARS
import com.nexo.ble.NexoBlePlugin.Companion.NXID_MAC_MAP_FILE
import com.nexo.ble.NexoBlePlugin.JsonExtraction

// Recibir por Bluetooth: juntar los trozos de cada mensaje y el mapa NEXO ID ↔ MAC.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

// FIX: Parser JSON que respeta strings y escapes (no cuenta {/} dentro de strings)
private fun NexoBlePlugin.tryExtractCompleteJson(buffer: String): JsonExtraction? {
    if (buffer.isBlank()) return null
    var i = 0
    while (i < buffer.length) {
        while (i < buffer.length && buffer[i] != '{') i++
        if (i >= buffer.length) return null
        val startIdx = i
        var braceCount = 0
        var inString = false
        var escapeNext = false
        var j = i
        while (j < buffer.length) {
            val c = buffer[j]
            if (escapeNext) {
                escapeNext = false
                j++
                continue
            }
            if (c == '\\') {
                escapeNext = true
                j++
                continue
            }
            if (c == '"') {
                inString = !inString
                j++
                continue
            }
            if (!inString) {
                if (c == '{') {
                    braceCount++
                } else if (c == '}') {
                    braceCount--
                    if (braceCount == 0) {
                        val candidate = buffer.substring(startIdx, j + 1)
                        // Auditoría: un JSON de fuera descomunal o demasiado anidado hace que el parser recursivo de
                        // org.json lance StackOverflowError (NO es Exception → mataba la app a distancia con un
                        // paquete). Se criba antes con SafeJson (O(n), sin recursión, ya probado en JVM) y además el
                        // catch pasa a Throwable (atrapa StackOverflowError/OutOfMemoryError y resincroniza).
                        if (SafeJson.reject(candidate)) { i = startIdx + 1; break }
                        return try {
                            JSONObject(candidate)
                            JsonExtraction(candidate, buffer.substring(j + 1))
                        } catch (e: Throwable) {
                            i = startIdx + 1
                            break
                        }
                    }
                }
            }
            j++
        }
        if (j >= buffer.length) return null
    }
    return null
}
// Ronda 2753: lo que llega por Bluetooth son bytes. Un trozo binario (BinFrame) se junta aparte y se entrega a la
// app como cabecera + datos en base64; lo demás es el texto de siempre (antes se convertía cada escritura a texto).
internal fun NexoBlePlugin.processReceivedBytes(deviceId: String, value: ByteArray, source: String) {
    val out = binAssembler.feed(normalizeMac(deviceId), value, System.currentTimeMillis())
    if (out.dropped > 0) btErr("bin_drop", "Trozo binario incompleto de ${normalizeMac(deviceId)} descartado")
    // 3203 (diagnóstico de Roberto, Motorola edge 40 neo 3087, 17-11): un trozo binario entero = un NEXO que habla: nunca se le frena
    if (out.frames.isNotEmpty()) serverFlap.spoke(normalizeMac(deviceId), System.currentTimeMillis())
    out.frames.forEach { f ->
        if (closedMode) { closedReceive(deviceId, f.header); return@forEach }
        backgroundNotify(f.header, deviceId)
        notifyListeners("onPayloadReceived", JSObject()
            .put("deviceId", deviceId)
            .put("content", f.header)
            .put("data", f.header)
            .put("bin", Base64.encodeToString(f.data, Base64.NO_WRAP))
            .put("source", source)
            .put("timestamp", System.currentTimeMillis())
            .put("reassembled", true),
            true
        )
    }
    out.text?.let { processReceivedChunk(deviceId, it.toString(Charsets.UTF_8), source) }
}

private fun NexoBlePlugin.processReceivedChunk(deviceId: String, chunk: String, source: String) {
    val macNorm = normalizeMac(deviceId)
    messageBufferTimers[macNorm]?.let { mainHandler.removeCallbacks(it) }
    // v2723: si lo pendiente lleva más de 10 s sin formar un mensaje, es un mensaje mutilado (se perdió un
    // trozo): fuera, y se sigue con lo que llega. Antes solo se limpiaba tras 5 s SIN trozos nuevos, y con
    // los reenvíos llegando sin parar nunca se limpiaba: todo lo siguiente quedaba tragado (foto parada).
    val pendingSince = messageBufferSince[macNorm]
    if (pendingSince != null && System.currentTimeMillis() - pendingSince > MESSAGE_MAX_PENDING_MS && messageBuffers[macNorm]?.isNotEmpty() == true) {
        remLog("WARN", "REASSEMBLY", "Mensaje incompleto de $macNorm descartado (resincronizado)")
        messageBuffers.remove(macNorm)
    }
    // 3059 (diagnóstico automático del Motorola 13-11 07:50): un mensaje quedó cortado (se perdió un trozo) y su resto se tragó
    // todo lo que llegó detrás —pings, acuses, el saludo— hasta vencer el plazo (6 s): el vivo parecía muerto y se cortó el
    // enlace. Si llega un trozo que EMPIEZA un mensaje (SafeJson.startsMessage) y con lo pendiente no se forma
    // ningún mensaje, lo pendiente era un resto cortado: fuera ya, y se sigue con lo nuevo. (Los mensajes de un enlace llegan
    // uno detrás de otro, nunca mezclados: si empieza uno nuevo, el anterior ya no se va a completar.)
    val pend = messageBuffers[macNorm]
    if (pend != null && pend.isNotEmpty() && SafeJson.startsMessage(chunk) && tryExtractCompleteJson(pend.toString() + chunk) == null) {
        remLog("WARN", "REASSEMBLY", "Mensaje cortado de $macNorm descartado al llegar otro entero (${pend.length} car.): resincronizado al momento")
        messageBuffers.remove(macNorm)
        messageBufferSince.remove(macNorm)
    }
    if (messageBuffers[macNorm].isNullOrEmpty()) messageBufferSince[macNorm] = System.currentTimeMillis()
    val buffer = messageBuffers.getOrPut(macNorm) { StringBuilder() }
    buffer.append(chunk)
    // Auditoría: tope de bytes por enlace (no solo por tiempo) — si el buffer crece sin formar un mensaje, se
    // descarta y se resincroniza (el emisor legítimo reenvía por la capa de ACK; un inundador no agota la memoria).
    if (buffer.length > MESSAGE_BUFFER_MAX_CHARS) {
        remLog("WARN", "REASSEMBLY", "Buffer de $macNorm pasó el tope (${buffer.length} chars) sin formar mensaje: descartado (posible inundación)")
        messageBuffers.remove(macNorm)
        messageBufferSince.remove(macNorm)
        messageBufferTimers[macNorm]?.let { mainHandler.removeCallbacks(it) }
        messageBufferTimers.remove(macNorm)
        return
    }
    var remaining = buffer.toString()
    var extractedCount = 0
    while (true) {
        val extraction = tryExtractCompleteJson(remaining)
        if (extraction != null) {
            remLog("INFO", "REASSEMBLY", "JSON extraído de $macNorm len=${extraction.json.length}")
            // 3203 (diagnóstico de Roberto, Motorola edge 40 neo 3087, 17-11): un mensaje completo (saludo, kx, ping…) = se identificó:
            // su dirección no se frena en el servidor GATT aunque luego entre y salga (ServerFlapPolicy)
            if (extractedCount == 0) serverFlap.spoke(macNorm, System.currentTimeMillis())
            // retainUntilConsumed=true: si el JS aún no escucha (app recién abierta, WebView
            // recargando), Capacitor guarda el mensaje y lo entrega al registrarse el listener.
            // Sin esto Capacitor lo DESCARTA (Plugin.notifyListeners) y el mensaje se perdía.
            // 3009: con la app en segundo plano o cerrada, el nativo contesta el ping del vigilante del otro (ver nativePong)
            if ((appInBackground || closedMode) && extraction.json.length < 400 && extraction.json.contains("\"ping\"")) nativePong(deviceId, extraction.json)
            // 3A (23-11): el reto de la bandeja del otro lo contesta siempre el nativo (app abierta, dormida o cerrada), con la firma de pareja
            if (extraction.json.length < 400 && extraction.json.contains("\"type\":\"oc\"")) nativeChallenge(deviceId, extraction.json)
            // 3269 (fase 3): con la app dormida o cerrada, lo pendiente de la bandeja de salida sale también por este enlace si es de su contacto
            // 3316: si el nativo lo reenvió para otro (puente dormido: paquete Jump o trozo de un flujo), no es para este teléfono
            val piped = if (appInBackground || closedMode) outboxHeard(macNorm, extraction.json)
                // 3321: con la app a la vista, los frames de una sesión del puente a internet que abrió el nativo siguen por él
                else extraction.json.contains("\"type\":\"ig\"") && try { outBle().gw?.handle(macNorm, extraction.json, ownedOnly = true) == true } catch (e: Throwable) { false }
            // 3012 (regla del dueño 11-11: «cualquiera que tiene NEXO debe aparecer al instante en un escaneo»): con la app en
            // segundo plano, dormida o cerrada, el nativo contesta «quién soy» a quien lo pregunta (ver nativeKx)
            if ((appInBackground || closedMode) && extraction.json.length < 6000 && extraction.json.contains("\"type\":\"kx\"") && extraction.json.contains("\"rq\":1") && kxFromContact(extraction.json)) nativeKx(deviceId)
            if (!piped && !closedMode) backgroundNotify(extraction.json, deviceId)
            if (piped) Unit
            else if (closedMode) closedReceive(deviceId, extraction.json)
            else notifyListeners("onPayloadReceived", JSObject()
                .put("deviceId", deviceId)
                .put("content", extraction.json)
                .put("data", extraction.json)
                .put("source", source)
                .put("timestamp", System.currentTimeMillis())
                .put("reassembled", true),
                true
            )
            remaining = extraction.remainder
            extractedCount++
            messageBufferSince[macNorm] = System.currentTimeMillis()
        } else {
            break
        }
    }
    if (remaining.isEmpty()) {
        messageBuffers.remove(macNorm)
        messageBufferTimers.remove(macNorm)
        messageBufferSince.remove(macNorm)
    } else {
        messageBuffers[macNorm] = StringBuilder(remaining)
        val timeoutRunnable = Runnable {
            remLog("WARN", "REASSEMBLY", "Timeout reensamblaje para $macNorm, descartando buffer")
            messageBuffers.remove(macNorm)
            messageBufferTimers.remove(macNorm)
        }
        messageBufferTimers[macNorm] = timeoutRunnable
        mainHandler.postDelayed(timeoutRunnable, MESSAGE_REASSEMBLY_TIMEOUT_MS)
    }
}
// === FIN FIX vFIX-3 ===
internal fun NexoBlePlugin.loadNexoMappings() {
    try {
        val file = File(activity.filesDir, NXID_MAC_MAP_FILE)
        if (!file.exists()) return
        val content = FileInputStream(file).use { fis ->
            InputStreamReader(fis, Charsets.UTF_8).use { it.readText() }
        }
        val json = JSONObject(content)
        val mapObj = json.optJSONObject("map") ?: return
        mapObj.keys().forEach { key ->
            val value = mapObj.optString(key, "")
            if (value.isNotEmpty()) {
                nxidToMacMap[key.lowercase()] = value.lowercase().replace(":", "").replace("-", "")
            }
        }
        remLog("INFO", "NXID_MAP", "Cargados ${nxidToMacMap.size} mapeos")
    } catch (e: Exception) {
        remLog("WARN", "NXID_MAP", "Error cargando mapeos: ${e.message}")
    }
}
internal fun NexoBlePlugin.saveNexoMappings() {
    try {
        val json = JSONObject()
        val mapObj = JSONObject()
        nxidToMacMap.forEach { (k, v) -> mapObj.put(k, v) }
        json.put("map", mapObj)
        json.put("savedAt", System.currentTimeMillis())
        val file = File(activity.filesDir, NXID_MAC_MAP_FILE)
        FileOutputStream(file).use { fos ->
            OutputStreamWriter(fos, Charsets.UTF_8).use { it.write(json.toString()) }
        }
    } catch (e: Exception) {
        remLog("WARN", "NXID_MAP", "Error guardando mapeos: ${e.message}")
    }
}
internal fun NexoBlePlugin.putRidExtras(intent: Intent) {
    intent.putExtra("rid_key", ridKey ?: "")
    intent.putExtra("visible_until", ridVisibleUntil)
    intent.putExtra("rid_epoch_s", ridEpochS)
}

internal fun NexoBlePlugin.registerNexoMapping(nexoId: String, mac: String) {
    val nid = nexoId.lowercase().trim()
    // Solo NEXO ID: los códigos rotativos ("R…") cambian cada 15 min y llenarían el archivo de mapeos
    if (!nid.startsWith("nx")) return
    val nmac = normalizeMac(mac)
    if (nid.isEmpty() || nmac.isEmpty()) return
    val existing = nxidToMacMap[nid]
    if (existing == nmac) return
    nxidToMacMap[nid] = nmac
    // 23-11 (multitud): con muchos NEXO con el ID a la vista el mapa no crece sin tope (se sueltan los que no están cerca ni
    // enlazados; se vuelven a apuntar solos al oírlos) ni se reescribe el archivo con cada uno (una vez cada 5 s)
    if (nxidToMacMap.size > NXID_MAP_MAX) {
        val it = nxidToMacMap.entries.iterator()
        while (it.hasNext()) {
            val en = it.next()
            if (en.key != nid && !scanBook.has(en.value) && !gattClients.containsKey(en.value) && !serverConnectedDevices.containsKey(en.value)) it.remove()
        }
    }
    if (!nxMapSaveScheduled) { nxMapSaveScheduled = true; mainHandler.postDelayed(nxMapSaveRunnable, 5000L) }
    if (nxidToMacMap.size <= 200) remLog("INFO", "NXID_MAP", "Registrado $nid ↔ $mac")
}
internal const val NXID_MAP_MAX = 1500
internal fun NexoBlePlugin.classifyDeviceId(id: String): String {
    val trimmed = id.trim()
    if (trimmed.isEmpty()) return "empty"
    if (trimmed.length == 10 && trimmed.startsWith("NX", ignoreCase = true) &&
        trimmed.substring(2).all { it.isLetterOrDigit() }) {
        return "nxid"
    }
    val clean = trimmed.replace(":", "").replace("-", "").replace(".", "").lowercase()
    if (clean.length == 12 && clean.all { it in '0'..'9' || it in 'a'..'f' }) {
        return "mac"
    }
    if (trimmed.matches(Regex("^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$"))) {
        return "mac"
    }
    return "invalid"
}
internal fun NexoBlePlugin.resolveMacForNexoId(nexoId: String): String? {
    val nid = nexoId.lowercase().trim()
    val cachedMac = nxidToMacMap[nid]
    remLog("INFO", "NXID_RESOLVE", "Buscando $nid en el aire...")
    val foundMac = quickScanForNexoId(nid, 5000)
    if (foundMac != null) {
        if (foundMac != cachedMac) {
            remLog("INFO", "NXID_RESOLVE", "MAC cambió para $nid: $cachedMac → $foundMac")
            registerNexoMapping(nid, foundMac)
        }
        return foundMac
    }
    if (cachedMac != null) {
        remLog("WARN", "NXID_RESOLVE", "$nid no encontrado en scan, usando caché: $cachedMac")
        return cachedMac
    }
    remLog("WARN", "NXID_RESOLVE", "$nid no resuelto")
    return null
}
private fun NexoBlePlugin.quickScanForNexoId(targetNexoId: String, timeoutMs: Long = 5000): String? {
    val ctx = activity.applicationContext
    val bluetoothManager = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val adapter = bluetoothManager.adapter ?: return null
    if (!adapter.isEnabled) return null
    val scanner = adapter.bluetoothLeScanner ?: return null
    quickScanResultMac = null
    quickScanLatch = java.util.concurrent.CountDownLatch(1)
    val callback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult?) {
            result?.device?.let { device ->
                val nexoId = extractNexoIdFromScanRecord(result.scanRecord)
                if (nexoId != null && nexoId.equals(targetNexoId, ignoreCase = true)) {
                    val macNorm = normalizeMac(device.address)
                    quickScanResultMac = macNorm
                    quickScanLatch?.countDown()
                    remLog("INFO", "QUICK_SCAN", "Encontrado $targetNexoId en ${device.address}")
                }
            }
        }
        override fun onScanFailed(errorCode: Int) {
            quickScanLatch?.countDown()
        }
    }
    try {
        val settings = scanSettings()
        scanner.startScan(emptyList(), settings, callback)
    } catch (e: SecurityException) {
        quickScanLatch?.countDown()
        return null
    }
    val found = try {
        quickScanLatch?.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS) ?: false
    } catch (e: InterruptedException) {
        false
    }
    try { scanner.stopScan(callback) } catch (e: Exception) { }
    quickScanLatch = null

    return if (found) quickScanResultMac else null
}
