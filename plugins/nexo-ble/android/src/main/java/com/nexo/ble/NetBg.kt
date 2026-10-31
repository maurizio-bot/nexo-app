package com.nexo.ble

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Base64
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// Escucha de internet con la app en segundo plano (o cerrada mientras el proceso vive con el servicio de Bluetooth).
// La app (net_link.js) le da: su NEXO ID, los relés, desde cuándo leer y, por contacto, el secreto de la pareja
// (kraw). Con eso calcula las etiquetas del día (igual que la app), se suscribe en los relés, se identifica (NIP-42)
// y abre solo el sobre de la pareja: si el emisor marcó "mensaje nuevo" (n = msgId) avisa con onMessage. El mensaje
// sigue cifrado de extremo a extremo; lo descifra la app al abrirse (lo recoge de los relés como siempre).
class NetBg(
    // #130b (dueño 31-10): isCall = el sobre venía marcado como oferta de llamada (cl:1). Con la app en segundo plano o
    // congelada, el que escucha (NexoBlePlugin) saca la LLAMADA a pantalla completa en vez del aviso de mensaje normal.
    private val onMessage: (nx: String, name: String, msgId: String, isCall: Boolean) -> Unit,
    private val log: (String) -> Unit = {},
) {
    class Contact(val nx: String, val name: String, val kraw: ByteArray)
    private class Relay(val url: String) { var ws: WsClient? = null; var retryAt = 0L; var fails = 0; var authed = false }

    companion object {
        const val KIND = 1059
        private val SUB = "nexobg"
        fun day(offsetDays: Int, now: Long = System.currentTimeMillis()): String {
            val f = SimpleDateFormat("yyyy-MM-dd", Locale.US); f.timeZone = TimeZone.getTimeZone("UTC")
            return f.format(Date(now + offsetDays * 86400000L))
        }
        // Clave de la etiqueta de lo que va para `to` en el día `day` (igual que NetLink._tag)
        fun tagKey(kraw: ByteArray, to: String, day: String): ByteArray {
            val mac = Mac.getInstance("HmacSHA256"); mac.init(SecretKeySpec(kraw, "HmacSHA256"))
            val h = java.math.BigInteger(1, mac.doFinal("tag|$to|$day".toByteArray()))
            return Secp256k1.b32(h.mod(Secp256k1.N.subtract(java.math.BigInteger.ONE)).add(java.math.BigInteger.ONE))
        }
        // Sobre de la pareja: base64(iv[12] + AES-GCM), datos asociados "NEXO-NET|de|para"
        fun open(kraw: ByteArray, from: String, me: String, b64: String): JSONObject? = try {
            val raw = Base64.getDecoder().decode(b64)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(kraw, "AES"), GCMParameterSpec(128, raw, 0, 12))
            c.updateAAD("NEXO-NET|$from|$me".toByteArray())
            val s = String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
            if (SafeJson.reject(s)) null else JSONObject(s) // ni un contacto puede tumbar la app con un sobre muy anidado
        } catch (e: Exception) { null }
        // Sella como la app (NetLink.send): base64(iv[12] + AES-GCM), datos asociados "NEXO-NET|de|para"
        fun seal(kraw: ByteArray, from: String, to: String, plain: String): String {
            val iv = ByteArray(12); java.security.SecureRandom().nextBytes(iv)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(kraw, "AES"), GCMParameterSpec(128, iv))
            c.updateAAD("NEXO-NET|$from|$to".toByteArray())
            val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8))
            val all = ByteArray(iv.size + ct.size); System.arraycopy(iv, 0, all, 0, iv.size); System.arraycopy(ct, 0, all, iv.size, ct.size)
            return Base64.getEncoder().encodeToString(all)
        }
        // MAC corto (base64 de 12 bytes) de una confirmación, igual que e2eAckTag en la app (y ackTag en el plugin para
        // el ✓✓ del modo cerrado por Bluetooth): HMAC-SHA256 de "nexo-ack|<campos>" con la clave de la pareja.
        fun ackMac(key: ByteArray, fields: String): String {
            val mac = Mac.getInstance("HmacSHA256"); mac.init(SecretKeySpec(key, "HmacSHA256"))
            return Base64.getEncoder().encodeToString(mac.doFinal("nexo-ack|$fields".toByteArray(Charsets.UTF_8)).copyOf(12))
        }
        // Clave privada efímera válida para firmar un evento Nostr (como schnorr.utils.randomSecretKey en la app)
        fun randomSk(): ByteArray {
            val b = ByteArray(32); java.security.SecureRandom().nextBytes(b)
            return Secp256k1.b32(java.math.BigInteger(1, b).mod(Secp256k1.N.subtract(java.math.BigInteger.ONE)).add(java.math.BigInteger.ONE))
        }
        // Cadena JSON como la escribe JSON.stringify (org.json escapa "/" y el id del evento no coincidiría)
        fun q(s: String): String {
            val b = StringBuilder(s.length + 2); b.append('"')
            for (ch in s) when (ch) {
                '"' -> b.append("\\\""); '\\' -> b.append("\\\\")
                '\b' -> b.append("\\b"); '\u000C' -> b.append("\\f"); '\n' -> b.append("\\n"); '\r' -> b.append("\\r"); '\t' -> b.append("\\t")
                else -> if (ch < ' ') b.append(String.format("\\u%04x", ch.code)) else b.append(ch)
            }
            return b.append('"').toString()
        }
        // Evento Nostr firmado (NIP-01); el id es el sha256 de [0,pubkey,created_at,kind,tags,content] como lo escribe JSON.stringify
        fun event(sk: ByteArray, kind: Int, tags: List<List<String>>, content: String, createdAt: Long = System.currentTimeMillis() / 1000): JSONObject {
            val pub = Secp256k1.hex(Secp256k1.xOnly(sk))
            val tagsJson = tags.joinToString(",", "[", "]") { t -> t.joinToString(",", "[", "]") { q(it) } }
            val ser = "[0,${q(pub)},$createdAt,$kind,$tagsJson,${q(content)}]"
            val id = Secp256k1.sha256(ser.toByteArray(Charsets.UTF_8))
            val ev = JSONObject()
            ev.put("id", Secp256k1.hex(id)); ev.put("pubkey", pub); ev.put("created_at", createdAt); ev.put("kind", kind)
            ev.put("tags", JSONArray(tags.map { JSONArray(it) })); ev.put("content", content)
            ev.put("sig", Secp256k1.hex(Secp256k1.sign(id, sk)))
            return ev
        }
    }

    @Volatile private var me = ""
    @Volatile private var contacts: List<Contact> = emptyList()
    @Volatile private var since = 0L
    private val relays = LinkedHashMap<String, Relay>()
    private var tags = HashMap<String, Contact>()   // pub de la etiqueta → contacto
    private var tagKeys = ArrayList<ByteArray>()
    private var tagDay = ""
    @Volatile var running = false; private set
    private var thread: Thread? = null
    private val seen = LinkedHashSet<String>()
    private val lock = Object()
    // Auditoría C1 / #87: por contacto, la clave para FIRMAR la confirmación de entrega (✓✓) que mandamos con la app
    // cerrada (la misma que ackKeys del plugin para el modo Bluetooth). La pone la app; vacío = se manda sin firma (un
    // contacto antiguo la ignora, igual que hoy).
    @Volatile private var ackKeys: Map<String, ByteArray> = emptyMap()

    fun configure(me: String, relayUrls: List<String>, since: Long, list: List<Contact>) {
        synchronized(lock) {
            this.me = me.lowercase(); this.contacts = list
            if (since > this.since) this.since = since
            relayUrls.forEach { if (!relays.containsKey(it)) relays[it] = Relay(it) }
            relays.keys.filter { it !in relayUrls }.forEach { relays.remove(it)?.ws?.close() }
            tagDay = ""
        }
        if (running) synchronized(lock) { lock.notifyAll() }
    }
    fun configured() = me.isNotEmpty() && contacts.isNotEmpty() && relays.isNotEmpty()
    // Nombre de un contacto (para la notificación de lo que llega por Bluetooth con la app cerrada)
    fun nameOf(nx: String): String? = contacts.firstOrNull { it.nx == nx.lowercase() }?.name?.takeIf { it.isNotEmpty() }
    // La app nos pasa, por contacto, la clave con la que firmar la confirmación de entrega del modo cerrado (igual que
    // al plugin). Se reemplaza el conjunto entero en cada llamada.
    fun setAckKeys(m: Map<String, ByteArray>) { ackKeys = m }

    fun start() {
        if (running || !configured()) return
        running = true
        thread = Thread({ loop() }, "nexo-netbg").apply { isDaemon = true; start() }
        log("Internet en segundo plano: escuchando ${contacts.size} contacto(s) en ${relays.size} relé(s)")
    }
    fun stop() {
        if (!running) return
        running = false
        synchronized(lock) { lock.notifyAll(); relays.values.forEach { it.ws?.close(); it.ws = null; it.authed = false } }
        log("Internet en segundo plano: parado (la app vuelve a encargarse)")
    }
    fun lastSeen() = since

    private fun refreshTags(): Boolean {
        val d0 = day(0)
        if (d0 == tagDay) return false
        val t = HashMap<String, Contact>(); val keys = ArrayList<ByteArray>()
        for (c in contacts) for (o in intArrayOf(0, -1)) {
            val sk = tagKey(c.kraw, me, day(o))
            t[Secp256k1.hex(Secp256k1.xOnly(sk))] = c; keys.add(sk)
        }
        tags = t; tagKeys = keys; tagDay = d0
        return true
    }

    private fun loop() {
        var lastPing = System.currentTimeMillis()
        while (running) {
            val changed = synchronized(lock) { refreshTags() }
            val now = System.currentTimeMillis()
            for (r in synchronized(lock) { relays.values.toList() }) {
                val ws = r.ws
                if (ws == null || !ws.open) {
                    if (now >= r.retryAt) connect(r)
                } else if (changed) subscribe(r)
            }
            if (now - lastPing > 60000) { relays.values.forEach { it.ws?.ping() }; lastPing = now }
            synchronized(lock) { try { lock.wait(5000) } catch (e: InterruptedException) { } }
        }
    }

    private fun connect(r: Relay) {
        try {
            r.authed = false
            val ws = WsClient(r.url, { onRelayText(r, it) }, { why ->
                r.ws = null; r.fails++
                r.retryAt = System.currentTimeMillis() + minOf(300000L, 5000L * (1L shl minOf(r.fails, 6)))
                if (running) log("Relé ${r.url}: $why")
            })
            r.ws = ws
            ws.connect()
            r.fails = 0
            subscribe(r)
        } catch (e: Exception) {
            r.ws = null; r.fails++
            r.retryAt = System.currentTimeMillis() + minOf(300000L, 5000L * (1L shl minOf(r.fails, 6)))
        }
    }

    private fun subscribe(r: Relay) {
        val pubs = synchronized(lock) { tags.keys.toList() }
        if (pubs.isEmpty()) return
        val f = JSONObject().put("kinds", JSONArray(listOf(KIND))).put("#p", JSONArray(pubs)).put("since", since / 1000)
        r.ws?.send(JSONArray(listOf("REQ", SUB, f)).toString())
    }

    private fun onRelayText(r: Relay, text: String) {
        // Auditoría (ronda 2774): un relé (o un intermediario) no puede tumbar la app con un evento JSON gigantesco o
        // muy anidado; se descarta antes de analizarlo.
        if (SafeJson.reject(text)) return
        val m = try { JSONArray(text) } catch (e: Exception) { return }
        when (m.optString(0)) {
            "AUTH" -> auth(r, m.optString(1))
            "CLOSED" -> if (m.optString(2).startsWith("auth-required")) { /* se resuscribe tras identificarse */ }
            "OK" -> if (!r.authed && m.optBoolean(2)) { r.authed = true; subscribe(r) }
            "EVENT" -> if (m.optString(1) == SUB) onEvent(m.optJSONObject(2) ?: return)
        }
    }

    // NIP-42: se firma el reto del relé con las claves de mis etiquetas (no con el NEXO ID)
    private fun auth(r: Relay, challenge: String) {
        if (challenge.isEmpty()) return
        val keys = synchronized(lock) { tagKeys.take(40) }
        for (sk in keys) {
            val ev = event(sk, 22242, listOf(listOf("relay", r.url), listOf("challenge", challenge)), "")
            r.ws?.send(JSONArray(listOf("AUTH", ev)).toString())
        }
    }

    private fun onEvent(ev: JSONObject) {
        val id = ev.optString("id")
        synchronized(seen) { if (!seen.add(id)) return; if (seen.size > 3000) seen.remove(seen.first()) }
        val ts = ev.optLong("created_at") * 1000
        if (ts > since) since = ts
        val tgs = ev.optJSONArray("tags") ?: return
        var c: Contact? = null
        for (i in 0 until tgs.length()) {
            val t = tgs.optJSONArray(i) ?: continue
            if (t.optString(0) == "p") { c = synchronized(lock) { tags[t.optString(1)] }; if (c != null) break }
        }
        if (c == null) return
        val o = open(c.kraw, c.nx, me, ev.optString("content")) ?: return
        if (o.optInt("h") == 1) return
        val n = o.optString("n")
        // #130b: cl:1 = oferta de llamada (1-a-1 o invitación de grupo) → pantalla de llamada, no aviso de mensaje
        if (n.isNotEmpty()) { onMessage(c.nx, c.name, n, o.optInt("cl") == 1); publishDeliveryAck(c, n) }
    }

    // #87 (entrega con la app CERRADA): al reconocer un sobre con un mensaje NUEVO de la pareja, devolvemos su
    // confirmación de ENTREGA (✓✓) por el mismo buzón de relés, igual que haría la app abierta (ble_ack._sendReceipt →
    // net.send): sobre {t,w,p} con p = {v:1,type:"ack",msgId,from,ts,a}, firmado con la clave de la pareja si la
    // tenemos (un contacto antiguo la ignora). Así el emisor pasa de ✓ a ✓✓ aunque este teléfono tenga la app cerrada.
    // El «leído» sigue siendo cosa de la app (al abrir el chat), como pidió el dueño.
    private fun publishDeliveryAck(c: Contact, msgId: String) {
        try {
            val open = synchronized(lock) { relays.values.mapNotNull { it.ws }.filter { it.open } }
            if (open.isEmpty()) return
            val now = System.currentTimeMillis()
            val ack = JSONObject().put("v", 1).put("type", "ack").put("msgId", msgId).put("from", me).put("ts", now)
            ackKeys[c.nx]?.let { ack.put("a", ackMac(it, "ack|$msgId|$me|${c.nx}")) }
            val body = JSONObject().put("t", now).put("w", 0).put("p", ack.toString())
            val b64 = seal(c.kraw, me, c.nx, body.toString())
            val tagPub = Secp256k1.hex(Secp256k1.xOnly(tagKey(c.kraw, c.nx, day(0))))
            val ttl = now / 1000 + 7 * 86400   // TTL_MSG en la app (net_link._ttlFor de un ack)
            val ev = event(randomSk(), KIND, listOf(listOf("p", tagPub), listOf("expiration", ttl.toString())), b64)
            val frame = JSONArray(listOf("EVENT", ev)).toString()
            for (ws in open) try { ws.send(frame) } catch (e: Exception) {}
            log("Internet en segundo plano: confirmación de entrega (✓✓) a $msgId de ${c.nx}")
        } catch (e: Exception) { log("Internet en segundo plano: no se pudo confirmar la entrega ($e)") }
    }
}
