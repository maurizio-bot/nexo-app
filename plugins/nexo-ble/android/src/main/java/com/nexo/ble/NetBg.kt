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
    // 3076 (dueño 14-11, notificaciones «sincronizadas»): group = id del grupo si el mensaje es de un GRUPO (lo lleva el sobre
    // por fuera, env.g, igual que por Bluetooth); vacío si es 1-a-1. Así el aviso cae en el grupo y no en el chat del que lo manda
    // (al tocarlo se abría el chat 1-a-1 y no había nada nuevo).
    // 3089: video = la oferta es de VIDEOllamada (cv:1 por fuera del sobre)
    private val onMessage: (nx: String, name: String, msgId: String, isCall: Boolean, group: String, video: Boolean) -> Unit,
    private val log: (String) -> Unit = {},
    // 3087: el que llama colgó (el sobre lleva ce = id de su oferta): la llamada que suena se quita al momento
    private val onCallEnd: (nx: String, offerId: String) -> Unit = { _, _ -> },
    // 3190 (dueño 17-11: «hay que poner esa notificación: hay un contacto que te quiere agregar»): llegó una solicitud de contacto a
    // MI buzón de solicitudes (descifrada y validada como en la app, de alguien que no es contacto): el que escucha pone el aviso
    // del teléfono (con su freno, ReqNotifyPolicy). La solicitud no se consume: queda guardada para la app (drainForApp).
    private val onRequest: (req: Req) -> Unit = { },
) {
    class Contact(val nx: String, val name: String, val kraw: ByteArray)
    // 3190: solicitud de contacto de mi buzón. kind = "req" (me quieren agregar) o "acc" (aceptó una solicitud MÍA); twin = nombre del
    // contacto que ya tengo con ese mismo nombre y otro NEXO ID (posible impostor), o ""
    class Req(val from: String, val name: String, val kind: String, val twin: String = "")
    private class Relay(val url: String) { var ws: WsClient? = null; var retryAt = 0L; var fails = 0; var authed = false; var openedAt = 0L; var closedAt = 0L }

    companion object {
        const val FOR_APP_MAX = 500                    // 3033: eventos guardados para la app como mucho
        const val FOR_APP_MAX_CHARS = 4_000_000L       // y como mucho ~4 MB (lo más viejo sale primero)
        const val KIND = 1059
        private val SUB = "nexobg"
        // 3069 (diagnóstico automático del Motorola 13-11 14:42, app en segundo plano): relay.damus.io se cerraba cada 25–100 s
        // durante casi una hora y se volvía a abrir a los ~10 s. Abrir la conexión ponía los fallos a cero, aunque el relé la
        // cortara enseguida: la espera nunca crecía (batería). Como en la app (net_link P5): solo una conexión que DURÓ al menos
        // RELAY_STABLE_MS cuenta como buena; una que se cae antes suma un fallo y la espera crece (10 s, 20 s, 40 s… hasta 5 min).
        const val RELAY_STABLE_MS = 60_000L
        // Fallos tras cerrarse una conexión que duró `livedMs` (0 = no llegó a abrir)
        fun failsAfterClose(fails: Int, livedMs: Long): Int = (if (livedMs >= RELAY_STABLE_MS) 0 else fails) + 1
        fun retryDelayMs(fails: Int): Long = minOf(300000L, 5000L * (1L shl minOf(fails, 6)))
        // 3188 (diagnóstico automático S24 3082 17-11 04:04): de noche se cerraron 3 de los 4 relés (00:14, 00:14, 01:43) y el registro
        // no decía si volvían: solo se anotaba el cierre (abrir de nuevo y los intentos fallidos eran mudos). Ahora se anota la vuelta
        // («abierta otra vez tras N min») y los intentos fallidos 1, 2, 4, 8, 16… (una noche con la red caída: ~7 líneas por relé).
        fun logFailedTry(fails: Int): Boolean = fails > 0 && (fails <= 2 || (fails and (fails - 1)) == 0)
        fun reopenNote(closedAt: Long, now: Long): String? {
            if (closedAt <= 0L || now < closedAt) return null
            val s = (now - closedAt) / 1000
            return if (s < 120) "abierta otra vez tras $s s" else "abierta otra vez tras ${s / 60} min"
        }
        private val GID = Regex("^gr[0-9a-z]{8}$")
        // 3076: id del grupo del mensaje que va dentro del sobre (p = sobre type:'chat' con g), o "" (1-a-1, o no se entiende)
        fun groupOf(p: String): String {
            if (p.isEmpty() || p[0] != '{' || SafeJson.reject(p)) return ""
            return try { JSONObject(p).optString("g").lowercase().takeIf { GID.matches(it) } ?: "" } catch (e: Exception) { "" }
        }
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
        // 3190: mi buzón de solicitudes de contacto (alta por ID, ronda 2779), igual que _reqScalar/_reqAesKey de net_link_shared.js: se
        // deriva SOLO de mi NEXO ID y el día (no hace falta guardar ningún secreto nuevo). Clave de la etiqueta del día (p del evento)
        fun reqKey(me: String, day: String): ByteArray {
            val h = java.math.BigInteger(1, Secp256k1.sha256("NEXO-REQ-v1|${me.trim().lowercase()}|$day".toByteArray(Charsets.UTF_8)))
            return Secp256k1.b32(h.mod(Secp256k1.N.subtract(java.math.BigInteger.ONE)).add(java.math.BigInteger.ONE))
        }
        // Clave AES del contenido de lo que llega a ese buzón
        fun reqAesKey(me: String): ByteArray = Secp256k1.sha256("NEXO-REQ-ENC-v1|${me.trim().lowercase()}".toByteArray(Charsets.UTF_8))
        private val NXID = Regex("^nx[0-9a-z]{8}$")
        private val REQ_PK = Regex("^[A-Za-z0-9+/=]{80,100}$")
        // Abre una solicitud como NetLink._onReq: base64(iv[12] + AES-GCM, sin datos asociados) con la clave de MI ID. null si no se
        // descifra o no vale (tipo req/acc, remitente nx + 8, que no sea yo, clave pública); el nombre, saneado como en la app.
        fun openReq(me: String, b64: String): Req? = try {
            val raw = Base64.getDecoder().decode(b64)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(reqAesKey(me), "AES"), GCMParameterSpec(128, raw, 0, 12))
            val s = String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
            val o = if (SafeJson.reject(s)) null else JSONObject(s)
            val t = o?.optString("t") ?: ""
            val from = (o?.optString("from") ?: "").lowercase().trim()
            if (o == null || (t != "req" && t != "acc") || !NXID.matches(from) || from == me.trim().lowercase() || !REQ_PK.matches(o.optString("pk"))) null
            else Req(from, o.optString("name").replace(Regex("[<>]"), "").take(40), t)
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
    // 3190: para el aviso de una solicitud: todos mis contactos (NEXO ID → nombre; también los que no van por internet), los IDs a
    // los que YO mandé una solicitud (su «acc» es «aceptó tu solicitud») y desde cuándo la app ya no escucha su buzón (lo de antes
    // lo recibió ella con la app a la vista: sin aviso doble)
    @Volatile private var known: Map<String, String> = emptyMap()
    @Volatile private var reqOut: Set<String> = emptySet()
    @Volatile private var reqSince = 0L
    private val relays = LinkedHashMap<String, Relay>()
    private var tags = HashMap<String, Contact>()   // pub de la etiqueta → contacto
    private var reqTags = HashSet<String>()         // 3190: pub de las etiquetas de MI buzón de solicitudes (hoy y ayer)
    private var tagKeys = ArrayList<ByteArray>()
    private var tagDay = ""
    @Volatile var running = false; private set
    private var thread: Thread? = null
    private val seen = LinkedHashSet<String>()
    // 3033 (dueño 12-11: «si me llega un mensaje ya debe quedarse en el chat, no cargarse cuando abro el chat»): lo que se
    // recibió y se avisó en segundo plano se GUARDA aquí (el evento del relé tal cual, cifrado) y la app lo recoge al volver
    // (drainForApp → netBgDrain) en vez de esperar a reconectar con los relés y pedirlo otra vez (tardaba 17 s o más).
    private val forApp = ArrayList<String>()
    private var forAppChars = 0L
    fun drainForApp(): List<String> = synchronized(forApp) { val l = ArrayList(forApp); forApp.clear(); forAppChars = 0; l }
    private fun keepForApp(ev: String) = synchronized(forApp) {
        forApp.add(ev); forAppChars += ev.length
        while (forApp.size > FOR_APP_MAX || forAppChars > FOR_APP_MAX_CHARS) { forAppChars -= forApp.removeAt(0).length }
    }
    private val lock = Object()
    // Auditoría C1 / #87: por contacto, la clave para FIRMAR la confirmación de entrega (✓✓) que mandamos con la app
    // cerrada (la misma que ackKeys del plugin para el modo Bluetooth). La pone la app; vacío = se manda sin firma (un
    // contacto antiguo la ignora, igual que hoy).
    @Volatile private var ackKeys: Map<String, ByteArray> = emptyMap()

    fun configure(me: String, relayUrls: List<String>, since: Long, list: List<Contact>, known: Map<String, String> = emptyMap(), reqOut: Set<String> = emptySet(), reqSince: Long = 0L) {
        synchronized(lock) {
            this.me = me.lowercase(); this.contacts = list
            this.known = known; this.reqOut = reqOut; this.reqSince = reqSince
            if (since > this.since) this.since = since
            relayUrls.forEach { if (!relays.containsKey(it)) relays[it] = Relay(it) }
            relays.keys.filter { it !in relayUrls }.forEach { relays.remove(it)?.ws?.close() }
            tagDay = ""
        }
        if (running) synchronized(lock) { lock.notifyAll() }
    }
    // 3190: también sin contactos por internet (alguien nuevo que espera solicitudes): con mi ID ya se escucha mi buzón de solicitudes
    fun configured() = me.isNotEmpty() && relays.isNotEmpty()
    // Nombre de un contacto (para la notificación de lo que llega por Bluetooth con la app cerrada)
    fun nameOf(nx: String): String? = contacts.firstOrNull { it.nx == nx.lowercase() }?.name?.takeIf { it.isNotEmpty() }
    // La app nos pasa, por contacto, la clave con la que firmar la confirmación de entrega del modo cerrado (igual que
    // al plugin). Se reemplaza el conjunto entero en cada llamada.
    fun setAckKeys(m: Map<String, ByteArray>) { ackKeys = m }

    fun start() {
        if (running || !configured()) return
        running = true
        thread = Thread({ loop() }, "nexo-netbg").apply { isDaemon = true; start() }
        log("Internet en segundo plano: escuchando ${contacts.size} contacto(s) y el buzón de solicitudes en ${relays.size} relé(s)")
    }
    fun stop() {
        if (!running) return
        running = false
        synchronized(lock) { lock.notifyAll(); relays.values.forEach { it.ws?.close(); it.ws = null; it.authed = false; it.closedAt = 0L } }
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
        // 3190: y mi buzón de solicitudes (hoy y ayer), en la misma suscripción y en las claves de identificación (NIP-42), como la app
        val rt = HashSet<String>()
        if (me.isNotEmpty()) for (o in intArrayOf(0, -1)) { val sk = reqKey(me, day(o)); rt.add(Secp256k1.hex(Secp256k1.xOnly(sk))); keys.add(sk) }
        tags = t; reqTags = rt; tagKeys = keys; tagDay = d0
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
            r.openedAt = 0L // si se cierra sin llegar a abrir, no cuenta el tiempo de la conexión anterior
            val ws = WsClient(r.url, { onRelayText(r, it) }, { why ->
                val now = System.currentTimeMillis()
                r.ws = null
                if (r.openedAt > 0 && running) r.closedAt = now // al pararse NetBg (vuelve la app) no cuenta como caída
                r.fails = failsAfterClose(r.fails, if (r.openedAt > 0) now - r.openedAt else 0L)
                r.retryAt = now + retryDelayMs(r.fails)
                if (running) log("Relé ${r.url}: $why" + (if (r.fails > 1) " (intento nº ${r.fails}: el siguiente en ${retryDelayMs(r.fails) / 1000} s)" else ""))
            })
            r.ws = ws
            ws.connect()
            r.openedAt = System.currentTimeMillis() // 3069: abrir no basta para dar el relé por bueno (ver RELAY_STABLE_MS)
            val note = reopenNote(r.closedAt, r.openedAt)
            r.closedAt = 0L
            if (note != null && running) log("Relé ${r.url}: $note")
            subscribe(r)
        } catch (e: Exception) {
            r.ws = null
            r.fails = failsAfterClose(r.fails, 0L)
            r.retryAt = System.currentTimeMillis() + retryDelayMs(r.fails)
            if (running && r.closedAt > 0 && logFailedTry(r.fails)) log("Relé ${r.url}: no se pudo abrir otra vez (intento nº ${r.fails}: el siguiente en ${retryDelayMs(r.fails) / 1000} s; ${e.javaClass.simpleName})")
        }
    }

    private fun subscribe(r: Relay) {
        val pubs = synchronized(lock) { tags.keys.toList() + reqTags }
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
        var toReq = false
        for (i in 0 until tgs.length()) {
            val t = tgs.optJSONArray(i) ?: continue
            if (t.optString(0) == "p") {
                val p = t.optString(1)
                c = synchronized(lock) { tags[p] }
                if (c != null) break
                if (synchronized(lock) { reqTags.contains(p) }) toReq = true
            }
        }
        if (c == null) { if (toReq) onReqEvent(ev, ts); return }
        val o = open(c.kraw, c.nx, me, ev.optString("content")) ?: return
        if (o.optInt("h") == 1) return
        keepForApp(ev.toString())   // 3033: para la app al volver (mensajes, confirmaciones, acciones: lo procesa como si llegara)
        val n = o.optString("n")
        val ce = o.optString("ce")
        if (BgInbox.CALL_ID.matches(ce)) onCallEnd(c.nx, ce)
        // #130b: cl:1 = oferta de llamada (1-a-1 o invitación de grupo) → pantalla de llamada, no aviso de mensaje
        if (n.isNotEmpty()) { onMessage(c.nx, c.name, n, o.optInt("cl") == 1, groupOf(o.optString("p")), o.optInt("cv") == 1); publishDeliveryAck(c, n) }
    }

    // 3190: llegó algo a MI buzón de solicitudes. Se abre como en la app (_onReq) y queda guardado para la app: la solicitud NO se
    // consume aquí, entra en su bandeja al volver (drainForApp). Lo que la app recibió ella misma (a la vista y escuchando su buzón:
    // antes de reqSince) no vuelve a avisar; de un contacto, tampoco. El resto se avisa (el que escucha pone el aviso con su freno).
    // Al registro: el NEXO ID, nunca el contenido.
    private fun onReqEvent(ev: JSONObject, ts: Long) {
        val r = openReq(me, ev.optString("content")) ?: return
        keepForApp(ev.toString())
        if (ts < reqSince) return
        if (known.containsKey(r.from) || contacts.any { it.nx == r.from }) { log("Solicitud de ${r.from}: ya es contacto: sin aviso"); return }
        val mine = r.kind == "acc" && reqOut.contains(r.from)
        val all = HashMap<String, String>(known); contacts.forEach { if (!all.containsKey(it.nx)) all[it.nx] = it.name }
        onRequest(Req(r.from, r.name, if (mine) "acc" else "req", if (mine) "" else ReqNotifyPolicy.twinOf(r.name, r.from, all)))
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
