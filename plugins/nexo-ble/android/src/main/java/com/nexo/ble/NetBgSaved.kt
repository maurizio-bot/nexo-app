package com.nexo.ble

import org.json.JSONArray
import org.json.JSONObject

// 3192 (#87, dueño 17-11 «Ok» a guardar cifrada la configuración): NEXO recibe por internet aunque Android la haya cerrado.
// Una actualización de Android System WebView mató a NEXO en la tableta del dueño a las 23:56 y no volvió hasta que la abrió a las
// 04:46. Desde la 3189 vuelve sola (BleService), pero en un proceso nuevo, sin la app, la escucha de internet (NetBg) no tenía qué
// escuchar: su configuración (mi NEXO ID, los relés y, por contacto, el secreto de la pareja) y las claves del ✓✓ solo vivían en la
// memoria del proceso. Ahora se guardan en el teléfono con el MISMO cifrado en reposo que los contactos y el ratchet (AtRestStore:
// clave de datos envuelta por una del Android Keystore; sin Keystore, en claro como los demás archivos) y NetBgHome arranca la
// escucha desde aquí sin la app (vuelta sola 3189, toque FCM, reinicio del servicio).
// Aquí, sin Android, lo que se guarda, cómo se lee y lo que se decide (se prueba en JVM: NetBgSavedTest, NetBgSinAppTest).
//  - Dos archivos (cada llamada de la app escribe el suyo, sin leer el otro): nexo_netbg_cfg.json (netBgConfig) y nexo_netbg_ack.json
//    (setAckKeys). Empiezan por «nexo_»: los cifra también la migración (AtRestStore.migrateAll) si se escribieron sin clave.
//  - No viajan al pasar la cuenta a otro teléfono (AccountMove.travels: la app del nuevo los vuelve a escribir al abrirse) y se
//    borran con la cuenta (AccountMove.wipe).
object NetBgSaved {
    const val CFG_FILE = "nexo_netbg_cfg.json"
    const val ACK_FILE = "nexo_netbg_ack.json"
    /** 3268 (fase 3): la bandeja de salida (NetOutbox.toJson): textos pendientes ya cifrados de punta a punta, para subirlos sin la app. */
    const val OUT_FILE = "nexo_netbg_out.json"
    private const val PREFIX = "nexo_netbg_"
    /** ¿Es uno de los archivos de la escucha sin la app? (también su temporal .nxtmp) */
    fun isFile(name: String): Boolean = name.startsWith(PREFIX)

    private val NX = Regex("^nx[0-9a-z]{8}$")
    private val HEX = Regex("^(?:[0-9a-f]{2}){1,64}$")

    class Config(val me: String, val relays: List<String>, val since: Long, val contacts: List<NetBg.Contact>,
                 val known: Map<String, String> = emptyMap(), val reqOut: Set<String> = emptySet(), val reqSince: Long = 0L)
    class Saved(val cfg: Config, val ack: Map<String, ByteArray>, val out: String? = null)
    class BadConfig(msg: String) : Exception(msg)

    // Lo que manda la app (net_link.js _bgConfig → netBgConfig), leído como lo leía netBgConfigImpl hasta la 3191: sin mi ID,
    // «falta me»; relés o contactos que no se entienden, «configuración ilegible»; known/reqOut (3190) mal formados se ignoran.
    fun fromApp(o: JSONObject): Config {
        val me = o.optString("me", "")
        if (!o.has("me") || o.isNull("me") || me.isEmpty()) throw BadConfig("falta me")
        val relays = ArrayList<String>(); val list = ArrayList<NetBg.Contact>()
        try {
            o.optJSONArray("relays")?.let { for (i in 0 until it.length()) relays.add(it.getString(i)) }
            o.optJSONArray("contacts")?.let {
                for (i in 0 until it.length()) {
                    val c = it.getJSONObject(i)
                    val nx = c.optString("nx", ""); val kraw = c.optString("kraw", "")
                    if (nx.isEmpty() || kraw.isEmpty()) throw BadConfig("configuración ilegible")
                    list.add(NetBg.Contact(nx.lowercase(), c.optString("name"), Secp256k1.unhex(kraw)))
                }
            }
        } catch (e: Exception) { throw BadConfig("configuración ilegible") }
        val known = HashMap<String, String>(); val reqOut = HashSet<String>()
        try {
            o.optJSONArray("known")?.let { for (i in 0 until it.length()) { val k = it.optJSONObject(i) ?: continue; val nx = k.optString("nx").lowercase(); if (nx.isNotEmpty()) known[nx] = k.optString("name") } }
            o.optJSONArray("reqOut")?.let { for (i in 0 until it.length()) { val nx = it.optString(i).lowercase(); if (nx.isNotEmpty()) reqOut.add(nx) } }
        } catch (e: Exception) { }
        return Config(me, relays, o.optLong("since", 0L), list, known, reqOut, o.optLong("reqSince", 0L))
    }

    // ---------- en disco (el texto que se cifra) ----------
    fun configJson(c: Config): String = JSONObject()
        .put("v", 1).put("me", c.me.lowercase()).put("relays", JSONArray(c.relays)).put("since", c.since).put("reqSince", c.reqSince)
        .put("contacts", JSONArray(c.contacts.map { JSONObject().put("nx", it.nx).put("name", it.name).put("kraw", Secp256k1.hex(it.kraw)) }))
        .put("known", JSONArray(c.known.entries.sortedBy { it.key }.map { JSONObject().put("nx", it.key).put("name", it.value) }))
        .put("reqOut", JSONArray(c.reqOut.sorted()))
        .toString()

    // null si no se entiende (o le falta mi ID o los relés): sin configuración, la escucha sin la app no arranca. Lo que no cuadra se salta.
    fun configFrom(text: String): Config? = try {
        if (SafeJson.reject(text)) null else {
            val o = JSONObject(text)
            val me = o.optString("me").lowercase()
            val relays = ArrayList<String>()
            o.optJSONArray("relays")?.let { for (i in 0 until it.length()) { val u = it.optString(i); if (u.startsWith("wss://") || u.startsWith("ws://")) relays.add(u) } }
            val list = ArrayList<NetBg.Contact>()
            o.optJSONArray("contacts")?.let {
                for (i in 0 until it.length()) {
                    val c = it.optJSONObject(i) ?: continue
                    val nx = c.optString("nx").lowercase(); val k = c.optString("kraw").lowercase()
                    if (NX.matches(nx) && HEX.matches(k)) list.add(NetBg.Contact(nx, c.optString("name"), Secp256k1.unhex(k)))
                }
            }
            val known = HashMap<String, String>()
            o.optJSONArray("known")?.let { for (i in 0 until it.length()) { val k = it.optJSONObject(i) ?: continue; val nx = k.optString("nx").lowercase(); if (NX.matches(nx)) known[nx] = k.optString("name") } }
            val reqOut = HashSet<String>()
            o.optJSONArray("reqOut")?.let { for (i in 0 until it.length()) { val nx = it.optString(i).lowercase(); if (NX.matches(nx)) reqOut.add(nx) } }
            if (!NX.matches(me) || relays.isEmpty()) null
            else Config(me, relays, o.optLong("since", 0L), list, known, reqOut, o.optLong("reqSince", 0L))
        }
    } catch (e: Exception) { null }

    fun ackJson(m: Map<String, ByteArray>): String = JSONObject().put("v", 1)
        .put("keys", JSONArray(m.entries.sortedBy { it.key }.map { JSONObject().put("nx", it.key).put("key", Secp256k1.hex(it.value)) })).toString()

    fun ackFrom(text: String): Map<String, ByteArray> = try {
        val m = HashMap<String, ByteArray>()
        if (!SafeJson.reject(text)) JSONObject(text).optJSONArray("keys")?.let {
            for (i in 0 until it.length()) {
                val k = it.optJSONObject(i) ?: continue
                val nx = k.optString("nx").lowercase(); val key = k.optString("key").lowercase()
                if (NX.matches(nx) && HEX.matches(key)) m[nx] = Secp256k1.unhex(key)
            }
        }
        m
    } catch (e: Exception) { emptyMap() }

    // Solo se escribe si cambió (por proceso): la app manda la configuración cada vez que se oculta (since nuevo) y al cambiar
    // contactos o relés, y las claves al arrancar. Devuelve si escribió. forget() tras borrar la cuenta (la próxima se escribe).
    class Writer {
        private val last = HashMap<String, String>()
        @Synchronized fun write(st: AtRestStore, name: String, text: String): Boolean {
            if (last[name] == text) return false
            st.write(name, text)
            last[name] = text
            return true
        }
        @Synchronized fun forget() { last.clear() }
    }
    fun saveConfig(st: AtRestStore, w: Writer, c: Config): Boolean = w.write(st, CFG_FILE, configJson(c))
    fun saveAck(st: AtRestStore, w: Writer, m: Map<String, ByteArray>): Boolean = w.write(st, ACK_FILE, ackJson(m))
    fun saveOut(st: AtRestStore, w: Writer, json: String): Boolean = w.write(st, OUT_FILE, json)

    /** Lo guardado (null = no hay configuración o no se entiende). Un archivo cifrado sin clave lanza IOException (AtRestStore). */
    fun load(st: AtRestStore): Saved? {
        val cfg = st.read(CFG_FILE)?.let { configFrom(it) } ?: return null
        val ack = try { st.read(ACK_FILE)?.let { ackFrom(it) } } catch (e: Exception) { null } ?: emptyMap()
        val out = try { st.read(OUT_FILE) } catch (e: Exception) { null }
        return Saved(cfg, ack, out)
    }

    /** La escucha con lo guardado, igual que netBgConfigImpl + setAckKeysImpl con la app (sin arrancarla). */
    fun apply(bg: NetBg, s: Saved) {
        val c = s.cfg
        bg.configure(c.me, c.relays, c.since, c.contacts, c.known, c.reqOut, c.reqSince)
        bg.setAckKeys(s.ack)
        bg.outboxLoad(s.out) // 3268: lo que quedó pendiente de salir (se sube en cuanto haya un relé abierto)
    }

    // ---------- decisiones ----------
    // La cuenta de este teléfono: el NEXO ID guardado por la app (nexo_advertising_id.json: {"nexoId":…}). Lo guardado de la escucha
    // tiene que ser de ESA cuenta (p. ej. tras recuperar otra cuenta con Fénix sin que la app llegara a guardar la nueva configuración).
    fun accountIdOf(idFile: String?): String? = try {
        if (idFile == null || SafeJson.reject(idFile)) null else JSONObject(idFile).optString("nexoId").trim().lowercase().takeIf { NX.matches(it) }
    } catch (e: Exception) { null }
    fun sameAccount(me: String, accountId: String?): Boolean = accountId != null && NX.matches(me.lowercase()) && me.lowercase() == accountId.lowercase()

    // Qué hacer al arrancar el servicio o al llegar un toque FCM. appAlive = el plugin vive en este proceso (la app abierta, en segundo
    // plano o cerrada con el proceso vivo, ronda 2758): la escucha la maneja ella. running = la escucha ya está en marcha en este proceso
    // (una sola por proceso: NetBgHome). Lo guardado se lee solo si hace falta (lazy).
    enum class Start { APP_ALIVE, ALREADY, NO_CONFIG, OTHER_ACCOUNT, START }
    fun startStep(appAlive: Boolean, running: Boolean, saved: () -> Config?, accountId: () -> String?): Start {
        if (appAlive) return Start.APP_ALIVE
        if (running) return Start.ALREADY
        val c = saved() ?: return Start.NO_CONFIG
        return if (sameAccount(c.me, accountId())) Start.START else Start.OTHER_ACCOUNT
    }
    /** ¿Alguien escucha internet tras esto? (la app, la escucha que ya estaba o la que acaba de arrancar) */
    fun listening(step: Start, started: Boolean): Boolean = step == Start.APP_ALIVE || step == Start.ALREADY || (step == Start.START && started)

    // Por qué arrancó (para el registro nativo): la vuelta sola de la 3189 trae su motivo; el toque FCM, su marca; sin intent, Android
    // reinició el servicio (START_STICKY) tras matar el proceso.
    fun why(restartWhy: String?, fcm: Boolean, noIntent: Boolean): String = restartWhy
        ?: if (fcm) "un toque FCM" else if (noIntent) "un reinicio del servicio por Android" else "un arranque del servicio"
    fun startLine(contacts: Int, relays: Int, why: String): String = "Internet sin la app: escuchando $contacts contacto(s) en $relays relé(s) (tras $why)"

    // Lo que se avisa de un sobre con un mensaje nuevo (las MISMAS reglas con la app viva y sin ella: NetBgHome.notifyMessage).
    //  CALL: oferta de llamada → pantalla de llamada (#130b); OLD: ese mensaje ya estaba en el teléfono (reenvío, 3008): sin aviso;
    //  OPEN_CHAT: su chat está abierto en un parpadeo a segundo plano (3172, BgNotifyPolicy): sin aviso; MUTED: el chat (o el grupo) está
    //  SILENCIADO (3219, MutedChats): sin aviso, pero una llamada suena igual; GROUP / CHAT: aviso (3076).
    enum class Notice { CALL, OLD, OPEN_CHAT, MUTED, GROUP, CHAT }
    fun notice(isCall: Boolean, alreadyHere: Boolean, silent: Boolean, inGroup: Boolean, muted: Boolean = false): Notice = when {
        isCall -> Notice.CALL
        alreadyHere -> Notice.OLD
        silent -> Notice.OPEN_CHAT
        muted -> Notice.MUTED
        inGroup -> Notice.GROUP
        else -> Notice.CHAT
    }

    // Una oferta de llamada vieja ya no suena: sin la app, la escucha nueva vuelve a leer lo del relé desde lo último que vio la app
    // (las ofertas que sonaron en el proceso de antes también). El mismo margen que la app (calls.js OFFER_MAX_AGE_MS = 10 min:
    // tolera relojes desfasados); ella la apunta como perdida al abrirse. tsMs = created_at del evento (0 = sin fecha: suena).
    const val CALL_MAX_AGE_MS = 600_000L
    fun callTooOld(tsMs: Long, nowMs: Long): Boolean = tsMs > 0 && nowMs - tsMs > CALL_MAX_AGE_MS

    // Nombres de los grupos (nexo_groups.json: {"groups":{gid:{name}}}) para el aviso de un mensaje de grupo (ronda 2763). Lanza si
    // no se entiende (quien llama no lo guarda en caché).
    fun groupNames(json: String?): Map<String, String> {
        val g = JSONObject(json ?: "{}").optJSONObject("groups")
        val m = HashMap<String, String>()
        g?.keys()?.forEach { k -> g.optJSONObject(k)?.optString("name")?.takeIf { it.isNotEmpty() }?.let { m[k.lowercase()] = it } }
        return m
    }
}
