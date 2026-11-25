package com.nexo.ble

import org.json.JSONArray
import org.json.JSONObject

/**
 * 3321 (dueño 24-11, prueba real: S24 solo con Bluetooth, la tablet con Wi-Fi y la app cerrada al lado, y el mensaje al S23 no salió:
 * «nx1e29ab2f no contesta en 5 s (dormido o sin servicio)»). El PUENTE A INTERNET (gw_link.js: un NEXO cercano presta su internet al que
 * no tiene) solo lo atendía la app: con la app dormida o cerrada nadie contestaba. Ahora el nativo hace de puente con la misma regla de
 * paquetes ({type:'ig', op…}) y los mismos topes: contesta «¿tienes internet?» con los relés que su escucha nativa (NetBg) tiene
 * abiertos, abre su propia conexión al relé elegido y pasa los frames NIP-01 en los dos sentidos. No lee nada: el sobre va cifrado para
 * el contacto. Lo que sube solo puede ser un evento de mensaje privado (1059) o un trozo del buzón de archivos (1064), una
 * suscripción a esos mensajes o por ids, AUTH (22242) y CLOSE. Con poca batería o sin internet propio contesta «no».
 *
 * Sin Android (JVM: GwServeTest): el enlace (OutboxBle.Link), la escucha nativa y el socket se inyectan.
 */
class GwServe(
    private val me: () -> String,
    private val urls: () -> List<String>,          // relés abiertos ahora por la escucha nativa
    private val wifi: () -> Boolean,
    private val link: OutboxBle.Link,
    private val relayOk: () -> Boolean = { true },
    private val wake: (String) -> Boolean = { false }, // «toque» FCM al token (el despertador del contacto)
    /** 3323 (reciprocidad, decisión B del dueño 24-11): ¿me ayudó en los últimos 30 días? Si no, solo textos. */
    private val helped: (String) -> Boolean = { true },
    /** Abre la conexión al relé (bloquea hasta abrirla; null o excepción = no se pudo). */
    private val sockOf: (url: String, onText: (String) -> Unit, onClose: () -> Unit) -> Sock? = { _, _, _ -> null },
    private val now: () -> Long = { System.currentTimeMillis() },
    private val async: (() -> Unit) -> Unit = { Thread(it, "nexo-gw").start() },
) {
    interface Sock { fun send(text: String): Boolean; fun close() }

    companion object {
        const val KIND_MSG = 1059
        const val KIND_BLOB = 1064
        const val KIND_AUTH = 22242
        const val SRV_MAX_SESSIONS = 4
        const val SRV_IDLE_MS = 10 * 60_000L
        const val SRV_EV_PER_MIN = 40
        const val SRV_EV_PER_DAY = 1500
        const val SRV_UP_MAX = 70_000
        const val SRV_DOWN_MAX = 200_000
        const val SRV_BYTES_MIN = 4096
        const val SRV_BLOB_PER_HOUR = 2L * 1024 * 1024
        const val SRV_BLOB_PER_DAY = 10L * 1024 * 1024
        const val SRV_WIFI_PER_HOUR = 20L * 1024 * 1024
        const val SRV_WIFI_PER_DAY = 100L * 1024 * 1024
        const val SRV_WAKE_MIN_MS = 8000L
        const val SRV_WAKE_PER_HOUR = 60
        const val IDS_MAX = 48
        const val TEXT_MAX = 16384 // 3323: lo que pasa para quien no me ha ayudado (un evento de texto, no un trozo de archivo)
        private val NX = Regex("^nx[0-9a-z]{8}$")
        private val HEX64 = Regex("^[0-9a-f]{64}$")
        private val HEX128 = Regex("^[0-9a-f]{128}$")
        private val SID = Regex("^[0-9a-f]{12}$")

        private fun evOk(ev: Any?, kinds: Set<Int>): Boolean {
            val e = ev as? JSONObject ?: return false
            return HEX64.matches(e.optString("id")) && HEX64.matches(e.optString("pubkey")) && HEX128.matches(e.optString("sig")) &&
                e.optInt("kind", -1) in kinds && e.opt("tags") is JSONArray && e.opt("content") is String && e.opt("created_at") is Number
        }

        /** Lo que se deja subir al relé (como gwAllowUp de la app): "EVENT", "BLOB", "AUTH", "CLOSE", "REQ" o "" (no). */
        fun allowUp(s: String): String {
            if (s.length > SRV_UP_MAX || !s.startsWith("[")) return ""
            val m = try { JSONArray(s) } catch (e: Exception) { return "" }
            val t = m.opt(0) as? String ?: return ""
            when (t) {
                "EVENT" -> {
                    if (m.length() != 2) return ""
                    val ev = m.opt(1)
                    if (evOk(ev, setOf(KIND_MSG))) return "EVENT"
                    if (evOk(ev, setOf(KIND_BLOB))) return "BLOB"
                    return ""
                }
                "AUTH" -> return if (m.length() == 2 && evOk(m.opt(1), setOf(KIND_AUTH))) "AUTH" else ""
                "CLOSE" -> return if (m.length() == 2 && (m.opt(1) as? String)?.let { it.length <= 64 } == true) "CLOSE" else ""
                "REQ" -> {
                    if (m.length() != 3 || (m.opt(1) as? String)?.let { it.length <= 64 } != true) return ""
                    val f = m.opt(2) as? JSONObject ?: return ""
                    for (k in f.keys()) {
                        val v = f.opt(k)
                        when (k) {
                            "kinds" -> { val a = v as? JSONArray ?: return ""; if (a.length() != 1 || a.optInt(0, -1) != KIND_MSG || a.opt(0) !is Number) return "" }
                            "#p" -> { val a = v as? JSONArray ?: return ""; if (a.length() > 400) return ""; for (i in 0 until a.length()) if (!HEX64.matches(a.opt(i) as? String ?: return "")) return "" }
                            "ids" -> { val a = v as? JSONArray ?: return ""; if (a.length() == 0 || a.length() > IDS_MAX) return ""; for (i in 0 until a.length()) if (!HEX64.matches(a.opt(i) as? String ?: return "")) return "" }
                            "since", "limit" -> { val n = v as? Number ?: return ""; if (n.toDouble() < 0 || n.toDouble().isNaN() || n.toDouble().isInfinite()) return "" }
                            else -> return ""
                        }
                    }
                    if (!((f.has("kinds") && f.has("#p")) || f.has("ids"))) return ""
                    return "REQ"
                }
            }
            return ""
        }
    }

    private class Sess(val from: String, val sid: String, val mac: String, val url: String) {
        var sock: Sock? = null
        @Volatile var open = false
        @Volatile var closed = false
        var rxAt = 0L
        val evMin = ArrayList<Long>()
    }
    private class Budget(var h0: Long, var h: Long, var day: Long, var d: Long)

    private val sess = LinkedHashMap<String, Sess>()            // from|sid → sesión
    private val daily = HashMap<String, Pair<Long, Int>>()     // from o enlace → (día, eventos)
    private val bytes = HashMap<String, Budget>()
    private val wakes = HashMap<String, ArrayList<Long>>()
    private val wakeAt = HashMap<String, Long>()
    private val totals = HashMap<String, Pair<Long, Long>>() // tope diario de todo lo que presta este teléfono: "ev", "blob", "wake"
    private fun totalLeft(k: String, n: Long, max: Long): Boolean {
        val dk = day(now()); val c = totals[k]?.takeIf { it.first == dk }?.second ?: 0L
        if (c + n > max) return false
        totals[k] = dk to c + n; return true
    }
    @Volatile var served = 0; private set                       // frames subidos (registro y pruebas)

    private fun day(t: Long) = t / 86_400_000L
    // EN ORDEN y sin perder por la cola llena (como _tx de la app): un EOSE no se adelanta a los trozos que bajan
    private val txq = HashMap<String, ArrayDeque<String>>()
    private val txBusy = HashSet<String>()
    private val txLock = Any()
    private fun tx(mac: String, o: JSONObject) {
        o.put("v", 1); o.put("type", "ig"); o.put("from", me())
        val str = o.toString()
        synchronized(txLock) {
            val q = txq.getOrPut(mac) { ArrayDeque() }
            if (q.size >= 400) return
            q.addLast(str)
            if (!txBusy.add(mac)) return
        }
        pumpTx(mac)
    }
    private fun pumpTx(mac: String) {
        while (true) {
            val head = synchronized(txLock) { txq[mac]?.firstOrNull() ?: run { txBusy.remove(mac); txq.remove(mac); null } } ?: return
            if (try { link.send(mac, head) } catch (e: Throwable) { false }) { synchronized(txLock) { txq[mac]?.removeFirstOrNull() }; continue }
            // cola llena: se reintenta en un hilo aparte (hasta 10 s el mismo frame; luego se suelta y sigue el siguiente)
            async {
                val t0 = now()
                var ok = false
                while (!ok && now() - t0 < 10_000L) { try { Thread.sleep(120) } catch (e: InterruptedException) { break }; ok = try { link.send(mac, head) } catch (e: Throwable) { false } }
                synchronized(txLock) { txq[mac]?.removeFirstOrNull() }
                pumpTx(mac)
            }
            return
        }
    }
    private fun canShare(): String = when {
        urls().isEmpty() -> "sin internet"
        !relayOk() -> "batería baja"
        else -> "ok"
    }

    /**
     * Un paquete 'ig' que llegó por un enlace con la app dormida o cerrada. true = lo atendió el nativo (no se le pasa a la app);
     * false = no es para el que presta, o es de una sesión que abrió la app (lo de siempre: lo ve la app).
     */
    @Synchronized fun handle(mac: String, json: String, ownedOnly: Boolean = false): Boolean {
        val o = try { JSONObject(json) } catch (e: Exception) { return false }
        if (o.optString("type") != "ig") return false
        val from = o.optString("from").trim().lowercase()
        val my = me().trim().lowercase()
        if (!NX.matches(from) || from == my) return false
        val t = now()
        tick(t)
        // ownedOnly (la app volvió a la vista): solo lo de las sesiones que abrió el nativo; lo nuevo ya lo atiende la app
        if (ownedOnly && o.optString("op") !in setOf("f", "c")) return false
        when (o.optString("op")) {
            "q" -> { ask(mac, from); return true }
            "o" -> { open(mac, from, o); return true }
            "f" -> { val s = sess["$from|${o.optString("s")}"] ?: return false; up(s, mac, o.optString("d"), t); return true }
            "c" -> { val k = "$from|${o.optString("s")}"; val s = sess[k] ?: return false; if (s.mac == mac) close(k, "el otro la cerró", true); return true }
            "w" -> { wakeTok(mac, from, o.optString("t"), t); return true }
        }
        return false
    }

    private fun ask(mac: String, from: String) {
        val ok = canShare() == "ok"
        val o = JSONObject().put("op", "a").put("u", JSONArray(if (ok) urls() else emptyList<String>())).put("wd", 0).put("w", if (ok && wifi()) 1 else 0)
            .put("f", if (ok && helped(from)) 1 else 0) // 3323: f:0 = solo textos
        link.log("Puente a internet sin la app: $from pregunta; " + (if (ok) "le ofrezco ${urls().size} relé(s)" else "no puedo (${canShare()})"))
        tx(mac, o)
    }

    private fun open(mac: String, from: String, p: JSONObject) {
        val sid = p.optString("s"); val url = p.optString("u")
        if (!SID.matches(sid)) return
        val no = { why: String -> tx(mac, JSONObject().put("op", "k").put("s", sid).put("ok", 0).put("why", why)) }
        val why = canShare()
        if (why != "ok") return no(why)
        if (url !in urls()) return no("relé desconocido")
        sess.entries.filter { it.value.mac == mac }.map { it.key }.forEach { close(it, "sesión nueva", false) } // una por enlace
        if (sess.size >= SRV_MAX_SESSIONS) return no("ocupado")
        val key = "$from|$sid"
        val s = Sess(from, sid, mac, url).also { it.rxAt = now() }
        sess[key] = s
        async {
            val sock = try {
                sockOf(url, { d -> down(key, s, d) }, {
                    synchronized(this) {
                        if (sess[key] === s) { sess.remove(key); tx(s.mac, JSONObject().put("op", if (s.open) "x" else "k").put("s", sid).put("ok", 0)) }
                        s.closed = true
                    }
                })
            } catch (e: Throwable) { null }
            synchronized(this) {
                if (sock == null) { if (sess[key] === s) { sess.remove(key); no("no conecta") }; return@synchronized }
                if (s.closed || sess[key] !== s) { try { sock.close() } catch (e: Throwable) { }; return@synchronized }
                s.sock = sock; s.open = true; s.rxAt = now()
                link.log("Puente a internet sin la app: presto internet a $from (relé ${NetBg.host(url)})")
                tx(mac, JSONObject().put("op", "k").put("s", sid).put("ok", 1).put("f", if (helped(from)) 1 else 0)) // 3323
            }
        }
    }

    private fun down(key: String, s: Sess, d: String) {
        synchronized(this) {
            if (sess[key] !== s || d.length > SRV_DOWN_MAX) return
            if (d.length > TEXT_MAX && !helped(s.from)) return // 3323: lo grande que baja, solo a quien me ayudó
            if (d.length > SRV_BYTES_MIN && !spend(s.from, s.mac, d.length.toLong())) return
            s.rxAt = now()
            tx(s.mac, JSONObject().put("op", "e").put("s", s.sid).put("d", d))
        }
    }

    private fun up(s: Sess, mac: String, d: String, t: Long) {
        if (!s.open || s.mac != mac) return
        s.rxAt = t
        val kind = allowUp(d)
        if (kind.isEmpty()) return
        val id = { try { JSONArray(d).optJSONObject(1)?.optString("id") ?: "" } catch (e: Exception) { "" } }
        val refuse = { why: String -> tx(s.mac, JSONObject().put("op", "e").put("s", s.sid).put("d", JSONArray().put("OK").put(id()).put(false).put(why).toString())) }
        if (!helped(s.from) && (kind == "BLOB" || (kind == "EVENT" && d.length > TEXT_MAX))) return refuse("restricted: solo textos (reciprocidad del puente)")
        if ((kind == "BLOB" || (kind == "EVENT" && d.length > SRV_BYTES_MIN)) && !spend(s.from, mac, d.length.toLong())) return refuse("rate-limited: tope de archivos del puente")
        if (kind == "EVENT") {
            s.evMin.removeAll { t - it >= 60_000L }
            val dk = day(t)
            val a = daily[s.from]?.takeIf { it.first == dk }?.second ?: 0
            val b = daily["l|$mac"]?.takeIf { it.first == dk }?.second ?: 0
            if (s.evMin.size >= SRV_EV_PER_MIN || a >= SRV_EV_PER_DAY || b >= SRV_EV_PER_DAY || !totalLeft("ev", 1, 4L * SRV_EV_PER_DAY)) return refuse("rate-limited: tope del puente")
            s.evMin.add(t); daily[s.from] = dk to a + 1; daily["l|$mac"] = dk to b + 1
            if (daily.size > 400) daily.remove(daily.keys.first())
        }
        val sock = s.sock ?: return
        if (try { sock.send(d) } catch (e: Throwable) { false }) served++
    }

    private fun spend(from: String, mac: String, n: Long): Boolean {
        val t = now(); val dk = day(t); val w = wifi()
        val bs = listOf(from, "link|$mac").map { k -> bytes.getOrPut(k) { Budget(t, 0, dk, 0) }.also { b -> if (t - b.h0 >= 3_600_000L) { b.h0 = t; b.h = 0 }; if (b.day != dk) { b.day = dk; b.d = 0 } } }
        val ph = if (w) SRV_WIFI_PER_HOUR else SRV_BLOB_PER_HOUR; val pd = if (w) SRV_WIFI_PER_DAY else SRV_BLOB_PER_DAY
        if (bs.any { it.h + n > ph || it.d + n > pd }) return false
        if (!totalLeft("blob", n, 4L * pd)) return false
        bs.forEach { it.h += n; it.d += n }
        if (bytes.size > 400) bytes.remove(bytes.keys.first())
        return true
    }

    private fun wakeTok(mac: String, from: String, tok: String, t: Long) {
        if (tok.length < 20 || tok.length > 4096 || canShare() != "ok") return
        if (t - (wakeAt[tok] ?: 0L) < SRV_WAKE_MIN_MS) return
        val lists = listOf("h|$from", "l|$mac").map { k -> wakes.getOrPut(k) { ArrayList() }.also { l -> l.removeAll { t - it >= 3_600_000L } } }
        if (lists.any { it.size >= SRV_WAKE_PER_HOUR } || !totalLeft("wake", 1, 500)) return
        lists.forEach { it.add(t) }; wakeAt[tok] = t
        if (wakeAt.size > 500) wakeAt.remove(wakeAt.keys.first())
        if (wakes.size > 500) wakes.remove(wakes.keys.first())
        try { wake(tok) } catch (e: Throwable) { }
    }

    private fun close(key: String, why: String, quiet: Boolean) {
        val s = sess.remove(key) ?: return
        s.closed = true
        try { s.sock?.close() } catch (e: Throwable) { }
        if (!quiet) tx(s.mac, JSONObject().put("op", "x").put("s", s.sid))
        link.log("Puente a internet sin la app: dejo de prestar internet a ${s.from} ($why)")
    }

    /** Repaso: sin internet o sin batería se cierran las sesiones; las calladas 10 min, también. */
    @Synchronized fun tick(t: Long = now()) {
        if (sess.isEmpty()) return
        val share = canShare()
        sess.entries.toList().forEach { (k, s) ->
            if (share != "ok") close(k, share, false)
            else if (t - s.rxAt > SRV_IDLE_MS) close(k, "sin actividad", false)
        }
    }

    /** El enlace se cerró: sus sesiones también. */
    @Synchronized fun linkClosed(mac: String) { sess.entries.filter { it.value.mac == mac }.map { it.key }.forEach { close(it, "se fue el enlace", true) } }

    @Synchronized fun sessions(): Int = sess.size
}
