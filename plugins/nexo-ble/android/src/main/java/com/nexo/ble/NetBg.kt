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
// 3264 (diagnósticos de J Manuel 21-11 17:56/18:46/21:11 y del HONOR de Austin 20-11): «no se pudo abrir otra vez (… IllegalStateException)»
// no decía nada: es el relé que CONTESTA y no acepta (WsClient «el relé no aceptó: HTTP/1.1 429 …», típico de relay.damus.io al
// reconectar tras un corte de red). Al registro va el código que contestó; el resto de fallos, su clase como antes. Pura (JVM).
internal fun failWhy(e: Throwable): String {
    val m = e.message ?: ""
    if (e is IllegalStateException) {
        val code = Regex("^el relé no aceptó: HTTP/\\d(?:\\.\\d)? (\\d{3})").find(m)?.groupValues?.get(1)
        if (code != null) return "el relé contestó $code y no aceptó"
        if (m == "conexión cerrada") return "el relé cerró al saludar"
    }
    return e.javaClass.simpleName
}

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
    // 3192 (#87): ¿esta oferta de llamada ya es vieja? (created_at del evento en ms). Sin la app, una escucha nueva vuelve a leer lo
    // del relé desde lo último que vio la app y no debe hacer sonar ofertas de hace horas (NetBgSaved.callTooOld, el margen de la app).
    // Ni avisa ni suena; la confirmación de entrega sí sale y el evento queda para la app (lo apunta como perdida). Por defecto, nunca.
    private val staleCall: (tsMs: Long) -> Boolean = { false },
    // 3268 (fase 3, COLA 29): la bandeja de salida cambió (algo salió, se confirmó o caducó): quien escucha la guarda cifrada en reposo
    private val onOutbox: (json: String) -> Unit = { },
    // 3268: el «toque» que despierta al otro teléfono tras subir un mensaje nuevo (dirección del enviador y token del otro; como la app)
    private val wake: (url: String, token: String) -> Unit = { _, _ -> },
    // 3270 (COLA 27 sin la app): con Wi-Fi y ningún relé abierto un rato, el Wi-Fi no da internet: quien escucha se lo dice a Android
    // (reportNetworkConnectivity) para que lo compruebe y pase a datos móviles sin esperar sus ~2 min
    private val onNoInternet: () -> Unit = { },
    // 3281: los trozos de un archivo de la bandeja se guardan aparte (son grandes): json = sus eventos, o null = borrarlos (ya salió)
    private val onBlob: (id: String, json: String?) -> Unit = { _, _ -> },
) {
    class Contact(val nx: String, val name: String, val kraw: ByteArray)
    // 3190: solicitud de contacto de mi buzón. kind = "req" (me quieren agregar) o "acc" (aceptó una solicitud MÍA); twin = nombre del
    // contacto que ya tengo con ese mismo nombre y otro NEXO ID (posible impostor), o ""
    class Req(val from: String, val name: String, val kind: String, val twin: String = "")
    // 3204: gapSince = desde cuándo hay que pedirle lo suyo a este relé al volver al Wi-Fi (se dejó de escuchar con datos móviles; -1 =
    // nada pendiente; vale mientras escucha esta NetBg: se olvida al pararse); gapAsked = ya se le pidió por esta conexión y se espera su
    // EOSE (con él queda al día)
    private class Relay(val url: String) { var ws: WsClient? = null; var retryAt = 0L; var fails = 0; var authed = false; var openedAt = 0L; var closedAt = 0L
        @Volatile var gapSince = -1L; @Volatile var gapAsked = false }
    // 3204: lo que la política de escucha necesita saber de cada relé (en el orden de la lista): abierto, o se puede intentar ya (pasó su espera)
    class RelayView(val open: Boolean, val due: Boolean)
    // listen = los que se escuchan (abiertos o recién abiertos), park = los que se sueltan (con datos, de los 2 escuchados en adelante)
    class ListenPlan(val listen: List<Int>, val park: List<Int>)

    companion object {
        const val FOR_APP_MAX = 500                    // 3033: eventos guardados para la app como mucho
        const val FOR_APP_MAX_CHARS = 4_000_000L       // y como mucho ~4 MB (lo más viejo sale primero)
        const val KIND = 1059
        const val MAX_CONTENT = 60000                  // 3268: tope de un evento en los relés habituales (como MAX_CONTENT de la app)
        const val TTL_MSG_S = 7 * 86400L               // caducidad de un mensaje en el buzón de los relés (TTL_MSG de la app)
        // 3270 (COLA 27 sin la app; como noNetStep de la app, net_link_shared.js): con Wi-Fi y sin ningún relé abierto desde `since`,
        // ¿toca avisar al teléfono? A los 12 s y luego como mucho una vez por minuto. since = 0: hay relé abierto o no es Wi-Fi.
        const val NO_NET_AFTER_MS = 12_000L
        const val NO_NET_EVERY_MS = 60_000L
        fun noNetDue(since: Long, saidAt: Long, now: Long): Boolean =
            since > 0 && now - since >= NO_NET_AFTER_MS && (saidAt == 0L || now - saidAt >= NO_NET_EVERY_MS)
        // 3234: ¿contesta este saludo? Solo uno reciente (como UP_MS de la app: uno viejo no dice que esté en línea), que no sea ya una
        // respuesta (r:1: si no, dos teléfonos dormidos se saludarían sin fin) y como mucho uno cada 20 s por contacto (como la app).
        const val HELLO_FRESH_MS = 150_000L
        const val HELLO_GAP_MS = 20_000L
        fun helloReplyDue(now: Long, t: Long, lastReplyAt: Long, isReply: Boolean): Boolean =
            !isReply && t > 0 && now - t < HELLO_FRESH_MS && now - lastReplyAt >= HELLO_GAP_MS
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
        // 3204 (dueño 17-11 «Ok» a 2 conexiones y 2 copias con datos móviles; parte nativa de la 3193): con la app en segundo plano o
        // cerrada escucha esta NetBg, que se suscribía a TODOS los relés: con datos móviles cada evento bajaba una vez por relé (S24 17-11:
        // en 116 min, 1723 de 1896 eventos eran «ya vistos»). Ahora, como la app (net_relays.js _cellReaders): con datos móviles se
        // conecta y se escucha SOLO a los CELL_READ_RELAYS primeros sanos en el orden de la lista (el que manda la app, el mismo en los
        // dos teléfonos), saltando los caídos (los que esperan su reintento); los demás se sueltan. El ✓✓ sale por los escuchados (son
        // los únicos abiertos). Con Wi-Fi o cable, todos, como siempre; y a cada relé soltado se le pide desde que se soltó (gapSince):
        // el `since` común ya va por delante y saltaría lo que un contacto dejó solo en él mientras tanto.
        const val CELL_READ_RELAYS = 2
        const val TTL_MSG_MS = 7 * 86_400_000L // caducidad de un mensaje en los relés (TTL_MSG de la app): más atrás no hay nada que pedir
        // ¿Con datos móviles tras este aviso del tipo de red (NetChange.typeOf)? Celular sin Wi-Fi ni cable: sí. Wi-Fi, cable, VPN sola u
        // otra: no (como siempre). Sin red o sin saberlo: lo que había (un túnel sin cobertura no vuelve a abrir todos los relés).
        fun cellAfter(prev: Boolean, type: String): Boolean = when (type) { "cell" -> true; "", "none" -> prev; else -> false }
        // Qué relés escuchar, en el orden de la lista. Sin datos: todos los abiertos y los que se pueden intentar ya. Con datos: los n
        // primeros sanos: abiertos, o que se pueden intentar ya y abren (tryOpen conecta de verdad: si falla, cuenta como caído y se pasa
        // al siguiente); el que espera su reintento se salta. Del n-ésimo escuchado en adelante, todos se sueltan (sin intentar abrirlos).
        // Si vuelve uno de los primeros, el que lo reemplazaba se suelta en la misma vuelta.
        fun listenPlan(cell: Boolean, rs: List<RelayView>, tryOpen: (Int) -> Boolean, n: Int = CELL_READ_RELAYS): ListenPlan {
            val listen = ArrayList<Int>(); val park = ArrayList<Int>()
            for ((i, r) in rs.withIndex()) {
                if (cell && listen.size >= n) { park.add(i); continue }
                if (r.open || (r.due && tryOpen(i))) listen.add(i)
            }
            return ListenPlan(listen, park)
        }
        // Desde cuándo pedir a un relé (ms): el `since` común, o con Wi-Fi, si quedó algo pendiente de cuando se soltó, desde entonces
        // (no más atrás que lo que dura un mensaje en el relé). Con datos lo pendiente se guarda para el Wi-Fi.
        fun subSince(since: Long, gapSince: Long, cell: Boolean, now: Long): Long =
            if (gapSince < 0 || cell) since else minOf(since, maxOf(gapSince, now - TTL_MSG_MS))
        // Nombre corto del relé para el registro (como _relayHost de la app)
        fun host(url: String): String = url.replace(Regex("^wss?://"), "").replace(Regex("/.*$"), "")
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
    // 3204: vuelta del bucle en marcha (un bucle viejo, aún atascado conectando tras stop/start, se retira solo: nunca dos decidiendo)
    @Volatile private var gen = 0
    // 3204: ¿con datos móviles? Lo dice quien escucha la red del teléfono (NetBgHome, ConnectivityManager) con setNet. Sin aviso (pruebas,
    // o sin poder escuchar la red), como siempre: todos los relés.
    @Volatile private var cell = false
    @Volatile private var netType = ""               // 3270: "wifi", "cell", "none"… (lo último que dijo el teléfono)
    private var noNetSince = 0L                      // solo el hilo del bucle
    private var noNetSaidAt = 0L
    private var modeKey = "" // lo último anotado en el registro sobre el modo (solo el hilo del bucle)
    private val seen = LinkedHashSet<String>()
    private val helloAt = HashMap<String, Long>()   // 3234: cuándo contesté el último saludo de cada contacto
    // 3033 (dueño 12-11: «si me llega un mensaje ya debe quedarse en el chat, no cargarse cuando abro el chat»): lo que se
    // recibió y se avisó en segundo plano se GUARDA aquí (el evento del relé tal cual, cifrado) y la app lo recoge al volver
    // (drainForApp → netBgDrain) en vez de esperar a reconectar con los relés y pedirlo otra vez (tardaba 17 s o más).
    private val forApp = ArrayList<String>()
    private var forAppChars = 0L
    fun drainForApp(): List<String> = synchronized(forApp) { val l = ArrayList(forApp); forApp.clear(); forAppChars = 0; l }
    // 3205: los relés soltados con datos a los que aún no se les pidió lo suyo (url → desde cuándo, ms) pasan a la app al volver ella
    // (netBgDrain): stop() los guarda aquí antes de olvidarlos, y los que sigan pendientes al recoger (si recoge antes de parar) también.
    private val gapsForApp = HashMap<String, Long>()
    fun drainGapsForApp(): Map<String, Long> {
        val out = HashMap<String, Long>()
        synchronized(lock) {
            out.putAll(gapsForApp); gapsForApp.clear()
            relays.values.forEach { if (it.gapSince >= 0) out[it.url] = minOf(out[it.url] ?: Long.MAX_VALUE, it.gapSince) }
        }
        return out
    }
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
            // 3204: otra cuenta: lo pendiente de pedir a los relés soltados era de la anterior
            if (me.lowercase() != this.me) { relays.values.forEach { it.gapSince = -1L; it.gapAsked = false }; gapsForApp.clear() }
            this.me = me.lowercase(); this.contacts = list
            this.known = known; this.reqOut = reqOut; this.reqSince = reqSince
            if (since > this.since) this.since = since
            // 3204: en el ORDEN que manda la app (con datos se escuchan los primeros sanos de la lista): se rehace el mapa en ese orden,
            // con los mismos relés (conexión, esperas y lo pendiente); los que ya no están se cierran
            val old = LinkedHashMap(relays); relays.clear()
            relayUrls.forEach { if (!relays.containsKey(it)) relays[it] = old.remove(it) ?: Relay(it) }
            old.values.forEach { val ws = it.ws; it.ws = null; ws?.close() }
            tagDay = ""
        }
        if (running) synchronized(lock) { lock.notifyAll() }
    }
    // 3204: el tipo de la red por defecto del teléfono (NetChange.typeOf, o "none"): con datos móviles se escuchan solo 2 relés
    fun setNet(type: String) {
        netType = type
        val now = cellAfter(cell, type)
        if (now == cell) return
        cell = now
        if (running) synchronized(lock) { lock.notifyAll() }
    }
    fun cellMode() = cell
    // 3190: también sin contactos por internet (alguien nuevo que espera solicitudes): con mi ID ya se escucha mi buzón de solicitudes
    fun configured() = me.isNotEmpty() && relays.isNotEmpty()
    // Nombre de un contacto (para la notificación de lo que llega por Bluetooth con la app cerrada)
    fun nameOf(nx: String): String? = contacts.firstOrNull { it.nx == nx.lowercase() }?.name?.takeIf { it.isNotEmpty() }
    // La app nos pasa, por contacto, la clave con la que firmar la confirmación de entrega del modo cerrado (igual que
    // al plugin). Se reemplaza el conjunto entero en cada llamada.
    fun setAckKeys(m: Map<String, ByteArray>) { ackKeys = m }

    // ===== 3268 (PRIORIDAD 1, fase 3; COLA 29): BANDEJA DE SALIDA (ver NetOutbox) =====
    // La app deja aquí los textos pendientes ya cifrados de punta a punta; esta escucha los sube en cuanto hay un relé abierto (con la
    // app dormida, cerrada o sin la app) e insiste hasta la ✓✓ del otro. La app la reemplaza entera cada vez que se oculta.
    val outbox = NetOutbox()
    private fun outboxChanged() { try { onOutbox(outbox.toJson()) } catch (e: Throwable) { }; syncBlobs() }
    // 3281: los trozos de cada archivo se guardan UNA vez al entrar y se borran al salir de la bandeja (confirmado, retirado, caducado)
    private var blobSaved: Set<String> = emptySet()
    private val blobLock = Any()
    private fun syncBlobs() = synchronized(blobLock) {
        try {
            val now = outbox.chunkFiles()
            for (id in blobSaved) if (id !in now) onBlob(id, null)
            for ((id, evs) in now) if (id !in blobSaved) onBlob(id, JSONArray(evs).toString())
            blobSaved = now.keys.toSet()
        } catch (e: Throwable) { }
    }
    /** La lista entera de lo pendiente (reemplaza). Devuelve cuántos quedan. */
    fun outboxSet(list: List<NetOutbox.Item>, myToken: String, wakeUrl: String, ridKeys: Map<String, String>? = null, epochS: Long = 0L): Int {
        val before = outbox.size()
        if (outbox.set(list, myToken, wakeUrl, ridKeys, epochS)) {
            outboxChanged()
            val n = outbox.size()
            if (n > 0 || before > 0) log("Bandeja de salida: $n mensaje(s) pendiente(s) quedan a cargo del teléfono (salen por internet aunque NEXO se duerma)")
        }
        if (running) synchronized(lock) { lock.notifyAll() }
        return outbox.size()
    }
    fun outboxDrop(id: String) { if (outbox.drop(id)) outboxChanged() }
    // 3269: la confirmación (✓✓ o leído) llegó por otro camino (Bluetooth, con la app dormida o cerrada): fuera de la bandeja
    fun outboxConfirmed(nx: String, msgId: String, how: String): Boolean {
        if (!outbox.confirmed(nx, msgId)) return false
        log("Bandeja de salida: $msgId confirmado por $nx (✓✓) $how")
        outboxChanged()
        return true
    }
    /** Lo guardado (arranque sin la app). */
    fun outboxLoad(text: String?, chunkLoader: ((String) -> List<String>?)? = null): Int {
        val n = outbox.load(text, System.currentTimeMillis(), chunkLoader)
        synchronized(blobLock) { blobSaved = outbox.chunkFiles().keys.toSet() } // lo cargado ya está guardado
        return n
    }
    fun outboxClear() { if (outbox.clear()) outboxChanged() }

    // 3281: un relé guardó un trozo de un archivo de la bandeja: se sigue con los siguientes y, con todos subidos, sale su aviso
    private fun outboxChunkAccepted(evId: String) {
        val x = outbox.chunkAccepted(evId) ?: return
        val (n, done) = outbox.chunkState(x.id)
        if (done == n) log("Bandeja de salida: ${x.id} para ${x.nx}: sus $n trozo(s) ya están en los relés sin la app; sale el aviso para que lo baje")
        outboxChanged()
        try { pumpOutbox(System.currentTimeMillis()) } catch (e: Throwable) { }
    }
    // El evento ya viene firmado por la app: va tal cual, a 3 relés abiertos como mucho (la réplica de la app)
    private fun publishRaw(ev: String): Boolean {
        val open = synchronized(lock) { relays.values.mapNotNull { it.ws }.filter { it.open } }.take(3)
        if (open.isEmpty()) return false
        val frame = "[\"EVENT\",$ev]"
        var sent = false
        for (ws in open) try { if (ws.send(frame)) sent = true } catch (e: Exception) {}
        return sent
    }

    // Sube lo que toca (solo el hilo del bucle). Sin relé abierto no cuenta como intento: se mira otra vez en la próxima vuelta (5 s).
    private val pumpLock = Any() // 3281: lo llaman el repaso de la escucha y el hilo que lee del relé (al guardarse un trozo): de a uno
    private fun pumpOutbox(now: Long) = synchronized(pumpLock) { pumpOutboxLocked(now) }
    private fun pumpOutboxLocked(now: Long) {
        if (outbox.size() == 0) return
        var changed = false
        // 3281: primero los trozos de los archivos (de a CHUNK_WINDOW; el siguiente sale cuando un relé contesta: outboxChunkAccepted)
        for (c in outbox.chunksDue(now)) { if (!running || !publishRaw(c.ev)) break; outbox.chunkSent(c, now) }
        for (x in outbox.chunkStuck(now)) {
            outbox.drop(x.id); changed = true
            log("Bandeja de salida: ${x.id} para ${x.nx}: ningún relé guardó uno de sus trozos: lo manda la app al abrirse")
        }
        val due = outbox.due(now) { id -> changed = true; log("Bandeja de salida: $id lleva más de 7 días sin poder salir: se deja (sigue ⏳ en la app)") }
        if (due.isNotEmpty() && synchronized(lock) { relays.values.any { it.ws?.open == true } }) {
            val byNx = contacts.associateBy { it.nx }
            for (x in due) {
                if (!running) break
                val c = byNx[x.nx] ?: continue // aún no es contacto por internet (sin clave de pareja): espera
                try {
                    val body = JSONObject().put("t", now).put("w", 0).put("p", x.p).put("n", x.id)
                    val tok = outbox.myToken
                    if (tok.isNotEmpty()) body.put("f", tok) // como la app (2967): el sobre de un mensaje nuevo lleva mi token del toque
                    var ev = sealedEvent(c, body, TTL_MSG_S)
                    if (ev.optString("content").length > MAX_CONTENT && tok.isNotEmpty()) { body.remove("f"); ev = sealedEvent(c, body, TTL_MSG_S) }
                    if (ev.optString("content").length > MAX_CONTENT) {
                        outbox.drop(x.id); changed = true
                        log("Bandeja de salida: ${x.id} para ${x.nx} es demasiado grande para internet: lo manda la app al abrirse")
                        continue
                    }
                    if (!publishEvent(ev)) break // se cerraron los relés mientras tanto
                    outbox.published(x.id, ev.optString("id"), now)
                    log("Bandeja de salida: ${x.id} para ${x.nx} sale por internet sin la app" + if (x.tries > 1) " (intento nº ${x.tries})" else "")
                } catch (e: Exception) { log("Bandeja de salida: ${x.id} no se pudo subir (${e.javaClass.simpleName})") }
            }
        }
        if (changed) outboxChanged()
    }

    // Un relé contestó OK a un evento: si es uno de la bandeja, queda a salvo en el buzón (✓) y sale el toque al otro teléfono
    private fun outboxAccepted(evId: String) {
        val now = System.currentTimeMillis()
        val x = outbox.accepted(evId, now) ?: return
        log("Bandeja de salida: ${x.id} para ${x.nx} quedó en el buzón del relé (✓); falta su ✓✓")
        if (outbox.wakeDue(x, now)) try { wake(outbox.wakeUrl, x.wake) } catch (e: Throwable) { }
        outboxChanged()
    }

    // 3192: start/stop sincronizados: la escucha es una por proceso (NetBgHome) y la pueden arrancar a la vez el toque FCM (su hilo),
    // el servicio y la app; así nunca quedan dos hilos escuchando
    @Synchronized fun start() {
        if (running || !configured()) return
        running = true
        val g = ++gen
        thread = Thread({ loop(g) }, "nexo-netbg").apply { isDaemon = true; start() }
        log("Internet en segundo plano: escuchando ${contacts.size} contacto(s) y el buzón de solicitudes en ${relays.size} relé(s)")
    }
    @Synchronized fun stop() {
        if (!running) return
        running = false
        // 3204: la conexión se suelta ANTES de cerrarla: su aviso de cierre ya no es de este relé (no cuenta como caída; ver connect). Y
        // lo pendiente de los relés soltados se olvida: escucha la app (con su propio orden de datos móviles) y, al volver a segundo plano,
        // se empieza desde lo último que ella vio (si no, se volverían a bajar y confirmar horas de mensajes que ella ya recibió)
        // 3205: …pero antes se le pasan a la app (drainGapsForApp → netBgDrain): lo que quedó solo en ellos se lo pide ella desde ahí
        synchronized(lock) { lock.notifyAll(); relays.values.forEach { if (it.gapSince >= 0) gapsForApp[it.url] = minOf(gapsForApp[it.url] ?: Long.MAX_VALUE, it.gapSince); val ws = it.ws; it.ws = null; it.authed = false; it.closedAt = 0L; it.gapSince = -1L; it.gapAsked = false; ws?.close() } }
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

    private fun loop(g: Int) {
        var lastPing = System.currentTimeMillis()
        modeKey = ""
        while (running && g == gen) {
            val changed = synchronized(lock) { refreshTags() }
            val now = System.currentTimeMillis()
            val list = synchronized(lock) { relays.values.toList() }
            // 3204: con datos móviles solo los 2 primeros sanos de la lista (listenPlan); con Wi-Fi, todos (como siempre)
            val c = cell
            val fresh = HashSet<Int>()
            val plan = listenPlan(c, list.map { RelayView(it.ws?.open == true, now >= it.retryAt) }, { i ->
                if (!running || g != gen) false else { fresh.add(i); connect(list[i]); list[i].ws?.open == true }
            })
            if (!running || g != gen) break // se paró (o arrancó otra vuelta) mientras conectaba: no se toca nada más
            for (i in plan.listen) {
                if (i in fresh) continue // recién abierto: ya se suscribió
                val r = list[i]
                // tras el cambio de día, o (con Wi-Fi) si se le debe lo de cuando estuvo soltado: se vuelve a pedir (mismo id: reemplaza)
                if (changed || (!c && r.gapSince >= 0 && !r.gapAsked)) subscribe(r)
            }
            for (i in plan.park) park(list[i])
            noteMode(c, plan.listen.map { list[it] }.filter { it.ws?.open == true })
            try { pumpOutbox(System.currentTimeMillis()) } catch (e: Throwable) { } // 3268: la bandeja de salida
            // 3270 (COLA 27 sin la app): Wi-Fi sin salida a internet → que Android lo compruebe ya
            if (netType != "wifi" || list.any { it.ws?.open == true }) noNetSince = 0L
            else {
                val t = System.currentTimeMillis()
                if (noNetSince == 0L) noNetSince = t
                if (noNetDue(noNetSince, noNetSaidAt, t)) {
                    noNetSaidAt = t
                    log("Internet en segundo plano: Wi-Fi sin internet (ningún relé abre): aviso al teléfono para que lo compruebe y pase a datos móviles")
                    try { onNoInternet() } catch (e: Throwable) { }
                }
            }
            if (now - lastPing > 60000) { list.forEach { it.ws?.ping() }; lastPing = now }
            synchronized(lock) { if (running && g == gen) try { lock.wait(5000) } catch (e: InterruptedException) { } }
        }
    }

    // 3204: con datos móviles, un relé que no es de los 2 escuchados se suelta: se cierra su conexión (sin contar como caída: ya no es la
    // suya, ver connect) y se apunta desde cuándo no se le escucha, para pedírselo al volver al Wi-Fi
    private fun park(r: Relay) {
        if (r.gapSince < 0) r.gapSince = since
        r.gapAsked = false
        val ws = r.ws ?: return
        r.ws = null; r.authed = false; r.openedAt = 0L; r.closedAt = 0L
        try { ws.close() } catch (e: Exception) { }
    }

    // 3204: una línea al registro al cambiar de modo o de relés escuchados (con datos) y otra al volver al Wi-Fi
    private fun noteMode(c: Boolean, listening: List<Relay>) {
        if (!running) return
        if (c) {
            if (listening.isEmpty()) return // ninguno abierto: ya lo dicen las líneas de cada relé
            val key = "cell:" + listening.joinToString(",") { it.url }
            if (key == modeKey) return
            modeKey = key
            val rest = synchronized(lock) { relays.size } - listening.size
            log("Internet en segundo plano: datos móviles, escucho ${listening.size} relé${if (listening.size > 1) "s" else ""} (${listening.joinToString(", ") { host(it.url) }}) y el ✓✓ sale por ${if (listening.size > 1) "ellos" else "él"}" +
                (if (rest > 0) "; a los otros $rest, al volver al Wi-Fi" else ""))
        } else if (modeKey.startsWith("cell:")) {
            modeKey = "wifi"
            val all = synchronized(lock) { relays.values.toList() }
            val owed = all.count { it.gapSince >= 0 }
            log("Internet en segundo plano: Wi-Fi, escucho todos los relés (${all.size})" + when {
                owed > 1 -> " y a los $owed que solté les pido desde que los solté"
                owed == 1 -> " y al que solté le pido desde que lo solté"
                else -> ""
            })
        }
    }

    private fun connect(r: Relay) {
        try {
            r.authed = false
            r.gapAsked = false
            r.openedAt = 0L // si se cierra sin llegar a abrir, no cuenta el tiempo de la conexión anterior
            var self: WsClient? = null
            val ws = WsClient(r.url, { onRelayText(r, it) }, { why ->
                // 3204: una conexión que ya no es la de este relé (la cerramos nosotros: parar, soltarlo con datos, relé quitado) no es una
                // caída: ni cuenta fallos ni retrasa el siguiente intento ni va al registro
                if (self == null || r.ws !== self) return@WsClient
                val now = System.currentTimeMillis()
                r.ws = null
                r.gapAsked = false // si se pedía lo de cuando estuvo soltado y no llegó al final (EOSE), se vuelve a pedir
                if (r.openedAt > 0 && running) r.closedAt = now // al pararse NetBg (vuelve la app) no cuenta como caída
                r.fails = failsAfterClose(r.fails, if (r.openedAt > 0) now - r.openedAt else 0L)
                r.retryAt = now + retryDelayMs(r.fails)
                if (running) log("Relé ${r.url}: $why" + (if (r.fails > 1) " (intento nº ${r.fails}: el siguiente en ${retryDelayMs(r.fails) / 1000} s)" else ""))
                // 3204: con datos móviles, el siguiente de la lista entra ya (sin esperar a la vuelta del bucle)
                if (running && cell) synchronized(lock) { lock.notifyAll() }
            })
            self = ws
            r.ws = ws
            ws.connect()
            // 3204: mientras conectaba se paró NetBg o se quitó/soltó este relé: no se deja una conexión abierta sin dueño
            if (!running || r.ws !== ws) { try { ws.close() } catch (e: Exception) { }; return }
            r.openedAt = System.currentTimeMillis() // 3069: abrir no basta para dar el relé por bueno (ver RELAY_STABLE_MS)
            val note = reopenNote(r.closedAt, r.openedAt)
            r.closedAt = 0L
            if (note != null && running) log("Relé ${r.url}: $note")
            subscribe(r)
        } catch (e: Exception) {
            r.ws = null
            r.fails = failsAfterClose(r.fails, 0L)
            r.retryAt = System.currentTimeMillis() + retryDelayMs(r.fails)
            if (running && r.closedAt > 0 && logFailedTry(r.fails)) log("Relé ${r.url}: no se pudo abrir otra vez (intento nº ${r.fails}: el siguiente en ${retryDelayMs(r.fails) / 1000} s; ${failWhy(e)})")
        }
    }

    private fun subscribe(r: Relay) {
        val pubs = synchronized(lock) { tags.keys.toList() + reqTags }
        if (pubs.isEmpty()) return
        // 3204: con Wi-Fi, a un relé que se soltó con datos móviles, desde que se soltó (lo pendiente se da por recibido con su EOSE)
        val c = cell
        val from = subSince(since, r.gapSince, c, System.currentTimeMillis())
        val f = JSONObject().put("kinds", JSONArray(listOf(KIND))).put("#p", JSONArray(pubs)).put("since", from / 1000)
        if (r.ws?.send(JSONArray(listOf("REQ", SUB, f)).toString()) == true && !c && r.gapSince >= 0) r.gapAsked = true
    }

    private fun onRelayText(r: Relay, text: String) {
        // Auditoría (ronda 2774): un relé (o un intermediario) no puede tumbar la app con un evento JSON gigantesco o
        // muy anidado; se descarta antes de analizarlo.
        if (SafeJson.reject(text)) return
        val m = try { JSONArray(text) } catch (e: Exception) { return }
        when (m.optString(0)) {
            "AUTH" -> auth(r, m.optString(1))
            "CLOSED" -> if (m.optString(2).startsWith("auth-required")) { /* se resuscribe tras identificarse */ }
            "OK" -> {
                if (m.optBoolean(2)) { outboxAccepted(m.optString(1)); outboxChunkAccepted(m.optString(1)) } // 3268: ¿era uno de la bandeja de salida? 3281: ¿o un trozo de un archivo suyo?
                if (!r.authed && m.optBoolean(2)) { r.authed = true; subscribe(r) }
            }
            "EVENT" -> if (m.optString(1) == SUB) onEvent(m.optJSONObject(2) ?: return)
            // 3204: el relé ya mandó todo lo guardado desde el `since` pedido: si era lo de cuando estuvo soltado, queda al día
            "EOSE" -> if (m.optString(1) == SUB && r.gapAsked && r.ws != null) { r.gapAsked = false; r.gapSince = -1L }
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
        if (o.optInt("h") == 1) {
            // 3234: el saludo de «abrir el chat» lo contesta ya este nativo (la app dormida tardaba 5–33 s en despertar para contestar)
            val now = System.currentTimeMillis()
            if (helloReplyDue(now, o.optLong("t"), synchronized(helloAt) { helloAt[c.nx] ?: 0L }, o.optInt("r") == 1)) {
                synchronized(helloAt) { helloAt[c.nx] = now }
                publishHelloReply(c)
            }
            return
        }
        keepForApp(ev.toString())   // 3033: para la app al volver (mensajes, confirmaciones, acciones: lo procesa como si llegara)
        // 3268: ¿es la confirmación (✓✓ o leído) de algo de la bandeja de salida? Ya llegó: se deja de insistir (la app lo marca al volver)
        if (outbox.size() > 0) NetOutbox.receiptOf(o.optString("p"))?.let { mid ->
            if (outbox.confirmed(c.nx, mid)) { log("Bandeja de salida: $mid confirmado por ${c.nx} (✓✓)"); outboxChanged() }
        }
        val n = o.optString("n")
        val ce = o.optString("ce")
        if (BgInbox.CALL_ID.matches(ce)) onCallEnd(c.nx, ce)
        // #130b: cl:1 = oferta de llamada (1-a-1 o invitación de grupo) → pantalla de llamada, no aviso de mensaje
        if (n.isNotEmpty()) {
            val isCall = o.optInt("cl") == 1
            // 3192: una oferta vieja (p. ej. leída otra vez por la escucha sin la app tras morir el proceso) ya no suena
            if (isCall && staleCall(ts)) log("Internet en segundo plano: oferta de llamada de ${c.nx} (msgId $n) de hace ${(System.currentTimeMillis() - ts) / 60000} min: ya no suena (la app la verá como perdida)")
            else onMessage(c.nx, c.name, n, isCall, groupOf(o.optString("p")), o.optInt("cv") == 1)
            publishDeliveryAck(c, n)
        }
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
    // 3204: por las conexiones abiertas: con datos móviles son solo los 2 relés escuchados (los demás están soltados, sin conexión), los
    // mismos primeros sanos de la lista que escucha el otro teléfono si también va con datos
    private fun publishDeliveryAck(c: Contact, msgId: String) {
        try {
            val now = System.currentTimeMillis()
            val ack = JSONObject().put("v", 1).put("type", "ack").put("msgId", msgId).put("from", me).put("ts", now)
            ackKeys[c.nx]?.let { ack.put("a", ackMac(it, "ack|$msgId|$me|${c.nx}")) }
            val body = JSONObject().put("t", now).put("w", 0).put("p", ack.toString())
            if (publishSealed(c, body, 7 * 86400L))   // TTL_MSG en la app (net_link._ttlFor de un ack)
                log("Internet en segundo plano: confirmación de entrega (✓✓) a $msgId de ${c.nx}")
        } catch (e: Exception) { log("Internet en segundo plano: no se pudo confirmar la entrega ($e)") }
    }

    // 3234: contesta el saludo con otro saludo (h:1) marcado como respuesta (r:1: nadie lo vuelve a contestar). Es lo mismo que haría la
    // app abierta (net_link._hello), sin token ni datos de relé propio (esos los manda la app al despertar). TTL_HELLO = 600 s.
    private fun publishHelloReply(c: Contact) {
        try {
            val body = JSONObject().put("t", System.currentTimeMillis()).put("w", 0).put("h", 1).put("r", 1)
            if (publishSealed(c, body, 600L)) log("Internet en segundo plano: saludo de ${c.nx} contestado (su app no hace falta despierta)")
        } catch (e: Exception) { log("Internet en segundo plano: no se pudo contestar el saludo ($e)") }
    }

    // Sella `body` para la pareja y lo sube a los relés abiertos (misma etiqueta y sobre que NetLink.send). false si no hay relé abierto.
    private fun publishSealed(c: Contact, body: JSONObject, ttlSecs: Long): Boolean {
        if (synchronized(lock) { relays.values.none { it.ws?.open == true } }) return false
        return publishEvent(sealedEvent(c, body, ttlSecs))
    }
    private fun sealedEvent(c: Contact, body: JSONObject, ttlSecs: Long): JSONObject {
        val b64 = seal(c.kraw, me, c.nx, body.toString())
        val tagPub = Secp256k1.hex(Secp256k1.xOnly(tagKey(c.kraw, c.nx, day(0))))
        return event(randomSk(), KIND, listOf(listOf("p", tagPub), listOf("expiration", (System.currentTimeMillis() / 1000 + ttlSecs).toString())), b64)
    }
    private fun publishEvent(ev: JSONObject): Boolean {
        val open = synchronized(lock) { relays.values.mapNotNull { it.ws }.filter { it.open } }
        if (open.isEmpty()) return false
        val frame = JSONArray(listOf("EVENT", ev)).toString()
        var sent = false
        for (ws in open) try { if (ws.send(frame)) sent = true } catch (e: Exception) {}
        return sent
    }
}
