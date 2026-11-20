package com.nexo.ble

import org.json.JSONObject

/**
 * 3254 (PRIORIDAD 1 del dueño, 19-11: «Bluetooth en el servicio nativo», fase 1; #87): recibir por Bluetooth SIN la app.
 *
 * Hasta ahora el servidor GATT vivía en el plugin (la app). Si Android mataba el proceso y NEXO volvía sola (3189: reinicio del
 * teléfono, actualización, alarma de vigilancia, toque FCM), el servicio estaba en marcha y escuchaba internet (3192), pero por
 * Bluetooth no anunciaba ni recibía nada hasta que alguien abría la app (Marcos 17-11: «Bluetooth muerto tras reiniciar»).
 *
 * Esta clase es lo que hace el servicio con lo que llega por su propio servidor GATT cuando no hay app en el proceso. Es lo MISMO
 * que la app cerrada con el proceso vivo (closedReceive, ronda 2758), sin depender del plugin:
 *  - junta los trozos de cada enlace (texto JSON y trozos binarios, como PluginRx);
 *  - contesta el ping del vigilante del otro (pong nativo, 3009) y «quién soy» (kx con rq:1 → tarjeta guardada, 3012);
 *  - un mensaje entero: al buzón (BgInbox, lo recoge la app al abrir), confirmación de entrega firmada (✓✓) y aviso;
 *  - confirmaciones: al buzón; primer trozo de algo largo o lo que llega por Jump para mí: solo aviso (el otro lo reenvía al abrir).
 * Sin Android: se prueba en JVM (SinAppCoreTest). El servidor GATT y los avisos de verdad están en BleSinApp.
 */
class SinAppCore(private val me: String, private val sink: Sink, private val now: () -> Long = { System.currentTimeMillis() }) {

    interface Sink {
        /** Manda un mensaje corto por el mismo enlace (pong, tarjeta, confirmación). */
        fun send(link: String, json: String)
        /** Guarda en el buzón; false = lleno. */
        fun store(link: String, json: String): Boolean
        /** Aviso al usuario. only = solo aviso (no quedó guardado: el otro lo reenvía). */
        fun notify(info: BgInbox.Info, only: Boolean)
        /** El que llamaba colgó: que deje de sonar. */
        fun callEnded(from: String, offer: String)
        /** La tarjeta «quién soy» que dejó la app (datos públicos) o null. */
        fun kxCard(): String?
        /** Firma de la confirmación de entrega para ese contacto, o null si no hay clave. */
        fun ackSign(from: String, fields: String): String?
        fun log(level: String, msg: String)
    }

    companion object {
        const val REASSEMBLY_TIMEOUT_MS = 5000L   // como PluginRx: sin trozos nuevos, lo pendiente se tira
        const val MAX_PENDING_MS = 10000L         // lo pendiente que no forma mensaje en 10 s era un mensaje cortado
        const val BUFFER_MAX_CHARS = 8 * 1024 * 1024
        const val KX_GAP_MS = 8000L

        /** Primer JSON completo del búfer (respeta cadenas y escapes) y lo que sobra; null si aún no hay ninguno. */
        fun extract(buffer: String): Pair<String, String>? {
            if (buffer.isBlank()) return null
            var i = 0
            while (i < buffer.length) {
                while (i < buffer.length && buffer[i] != '{') i++
                if (i >= buffer.length) return null
                val start = i
                var depth = 0; var inString = false; var esc = false
                var j = i
                var retry = false
                while (j < buffer.length) {
                    val c = buffer[j]
                    if (esc) { esc = false; j++; continue }
                    if (c == '\\') { esc = true; j++; continue }
                    if (c == '"') { inString = !inString; j++; continue }
                    if (!inString) {
                        if (c == '{') depth++
                        else if (c == '}') {
                            depth--
                            if (depth == 0) {
                                val cand = buffer.substring(start, j + 1)
                                val ok = !SafeJson.reject(cand) && try { JSONObject(cand); true } catch (e: Throwable) { false }
                                if (ok) return cand to buffer.substring(j + 1)
                                i = start + 1; retry = true
                                break
                            }
                        }
                    }
                    j++
                }
                if (!retry) return null
            }
            return null
        }
    }

    private val bin = BinAssembler()
    private val buffers = HashMap<String, StringBuilder>()
    private val since = HashMap<String, Long>()
    private val lastChunk = HashMap<String, Long>()
    private val kxSent = HashMap<String, Long>()
    /** Mensajes recibidos (para el registro: «N mensaje(s) por Bluetooth sin la app»). */
    @Volatile var received = 0
        private set

    /** El enlace se cerró: fuera lo pendiente suyo. */
    @Synchronized fun linkClosed(link: String) { buffers.remove(link); since.remove(link); lastChunk.remove(link); bin.reset(link) }

    /** Lo que llega por un enlace (una escritura GATT). */
    @Synchronized fun onBytes(link: String, value: ByteArray) {
        val out = bin.feed(link, value, now())
        out.frames.forEach { handle(link, it.header) }
        val text = out.text ?: return
        onChunk(link, String(text, Charsets.UTF_8))
    }

    private fun onChunk(link: String, chunk: String) {
        val t = now()
        val pend = buffers[link]
        if (pend != null && pend.isNotEmpty()) {
            val stale = t - (lastChunk[link] ?: t) > REASSEMBLY_TIMEOUT_MS || t - (since[link] ?: t) > MAX_PENDING_MS
            // 3059: si empieza un mensaje nuevo y con lo pendiente no se forma ninguno, lo pendiente era un resto cortado
            val cut = !stale && SafeJson.startsMessage(chunk) && extract(pend.toString() + chunk) == null
            if (stale || cut) { buffers.remove(link); since.remove(link) }
        }
        lastChunk[link] = t
        if (buffers[link].isNullOrEmpty()) since[link] = t
        val buf = buffers.getOrPut(link) { StringBuilder() }
        buf.append(chunk)
        if (buf.length > BUFFER_MAX_CHARS) { buffers.remove(link); since.remove(link); sink.log("WARN", "búfer de $link pasó el tope sin formar mensaje: descartado"); return }
        var rest = buf.toString()
        while (true) {
            val ex = extract(rest) ?: break
            try { handle(link, ex.first) } catch (e: Throwable) { sink.log("WARN", "mensaje de $link sin procesar (${e.javaClass.simpleName})") }
            rest = ex.second
            since[link] = t
        }
        if (rest.isEmpty()) { buffers.remove(link); since.remove(link) } else buffers[link] = StringBuilder(rest)
    }

    private fun handle(link: String, json: String) {
        if (json.length < 400 && json.contains("\"ping\"")) pong(link, json)
        if (json.length < 6000 && json.contains("\"type\":\"kx\"") && json.contains("\"rq\":1")) kx(link)
        val info = BgInbox.classify(json, me)
        when (info.kind) {
            BgInbox.Kind.MESSAGE -> {
                if (!sink.store(link, json)) { sink.log("WARN", "buzón lleno: mensaje de ${info.from} sin guardar"); return }
                received++
                sink.log("INFO", "llega por Bluetooth sin la app: mensaje de ${info.from} (msgId ${info.msgId})" + if (info.call) " [llamada]" else "")
                ack(link, info)
                if (info.callEnd.isNotEmpty()) sink.callEnded(info.from, info.callEnd)
                if (info.call || !info.quiet) sink.notify(info, false)
            }
            BgInbox.Kind.RECEIPT -> sink.store(link, json)
            BgInbox.Kind.NOTIFY_ONLY -> if (!info.quiet) sink.notify(info, true)
            BgInbox.Kind.IGNORE -> {}
        }
    }

    private fun pong(link: String, json: String) {
        try {
            val o = JSONObject(json)
            if (o.optString("type") != "ping") return
            val id = o.optString("pingId")
            if (id.isEmpty() || id.length > 80) return
            sink.send(link, JSONObject().put("v", 1).put("type", "pong").put("pingId", id).put("ts", now()).put("fromNexoId", me.lowercase()).put("nb", 1).toString())
        } catch (e: Exception) { }
    }

    private fun kx(link: String) {
        val t = now()
        if (t - (kxSent[link] ?: 0L) < KX_GAP_MS) return
        val card = sink.kxCard()
        if (card.isNullOrEmpty()) return
        kxSent[link] = t
        if (kxSent.size > 200) kxSent.clear()
        sink.send(link, card)
    }

    private fun ack(link: String, info: BgInbox.Info) {
        val my = me.lowercase()
        if (my.isEmpty() || info.from.isEmpty()) return
        val o = JSONObject().put("v", 1).put("type", "ack").put("msgId", info.msgId).put("from", my).put("ts", now())
        val a = sink.ackSign(info.from, "ack|${info.msgId}|$my|${info.from}")
        if (a != null) o.put("a", a)
        sink.send(link, o.toString())
    }
}
