package com.nexo.ble

import org.json.JSONArray
import org.json.JSONObject

/**
 * 3219 (dueño 17-11: las funciones de WhatsApp dentro del chat): chats y grupos SILENCIADOS (8 horas, 1 semana o siempre). La app
 * (chat_mute.js) da la lista con el fin de cada uno (setMutedChats: [{id, until}], until en ms; 0 = siempre) cada vez que cambia y al
 * arrancar, igual que da las claves del ✓✓ (setAckKeys). Aquí se decide que sus MENSAJES no avisen (ni suenen, ni vibren, ni enciendan
 * la pantalla) con la app congelada en segundo plano o CERRADA: por Bluetooth (PluginBackground: backgroundNotify, closedReceive,
 * notifyOnly) y por internet (NetBgHome.notifyMessage, también sin la app). Las LLAMADAS suenan igual, como en WhatsApp.
 * Vive en memoria del proceso (sobrevive con la app cerrada) y se guarda CIFRADA en el teléfono (AtRestStore, nexo_netbg_mute.json:
 * empieza por «nexo_netbg_», así que no viaja al pasar la cuenta y se borra con ella, como la configuración de NetBg) para la escucha
 * de internet sin la app (NetBgHome), que la lee la primera vez que la necesita.
 * Sin Android: se prueba en JVM (MutedChatsTest).
 */
object MutedChats {
    const val FILE = "nexo_netbg_mute.json"
    const val MAX = 500
    private val ID = Regex("^(nx|gr)[0-9a-z]{8}$")

    @Volatile private var map: Map<String, Long> = emptyMap()
    /** ¿Ya se sabe la lista en este proceso? (la dio la app o se leyó de lo guardado) */
    @Volatile var loaded = false
        private set

    fun set(m: Map<String, Long>) { map = HashMap(m); loaded = true }
    fun all(): Map<String, Long> = map
    /** La cuenta se borró del teléfono (NetBgHome.forget): se olvida. */
    fun clear() { map = emptyMap(); loaded = false }

    /** ¿Ese silencio sigue en pie a esta hora? (0 = siempre) */
    fun alive(until: Long, now: Long): Boolean = until == 0L || until > now

    fun isMuted(m: Map<String, Long>, chatId: String, now: Long): Boolean {
        val until = m[chatId.lowercase()] ?: return false
        return alive(until, now)
    }
    fun isMuted(chatId: String, now: Long = System.currentTimeMillis()): Boolean = isMuted(map, chatId, now)

    /**
     * ¿Se calla el aviso de este mensaje? El chat del aviso es el del grupo si se conoce su nombre (el aviso sale en el grupo) y, si no,
     * el de quien lo manda (como notifyMessage). Una llamada nunca se calla.
     */
    fun silences(m: Map<String, Long>, isCall: Boolean, from: String, group: String, groupKnown: Boolean, now: Long): Boolean {
        if (isCall) return false
        val chat = if (group.isNotEmpty() && groupKnown) group else from
        return chat.isNotEmpty() && isMuted(m, chat, now)
    }
    fun silences(isCall: Boolean, from: String, group: String, groupKnown: Boolean, now: Long = System.currentTimeMillis()): Boolean =
        silences(map, isCall, from, group, groupKnown, now)

    // ---------- lo que manda la app y lo guardado ----------
    // [{id, until}]: ids que no son de un chat (NEXO ID o grupo) se saltan, y los ya vencidos; como mucho MAX
    fun fromApp(arr: JSONArray?, now: Long): Map<String, Long> {
        val m = HashMap<String, Long>()
        if (arr == null) return m
        for (i in 0 until arr.length()) {
            if (m.size >= MAX) break
            val o = arr.optJSONObject(i) ?: continue
            val id = o.optString("id").lowercase()
            val until = o.optLong("until", -1L)
            if (ID.matches(id) && until >= 0L && alive(until, now)) m[id] = until
        }
        return m
    }

    fun json(m: Map<String, Long>): String = JSONObject().put("v", 1)
        .put("chats", JSONArray(m.entries.sortedBy { it.key }.map { JSONObject().put("id", it.key).put("until", it.value) })).toString()

    // null si no se entiende
    fun from(text: String?, now: Long): Map<String, Long>? = try {
        if (text == null || SafeJson.reject(text)) null else fromApp(JSONObject(text).optJSONArray("chats"), now)
    } catch (e: Exception) { null }

    fun save(st: AtRestStore, w: NetBgSaved.Writer, m: Map<String, Long>): Boolean = w.write(st, FILE, json(m))

    /**
     * Si este proceso aún no la sabe (la escucha de internet sin la app), la lee de lo guardado: sin archivo (o ilegible), ninguno
     * silenciado. Un error al leer (p. ej. el Keystore un instante no disponible): sigue sin saberla y se vuelve a intentar.
     */
    fun ensureLoaded(read: () -> String?, now: Long = System.currentTimeMillis()) {
        if (loaded) return
        val text = try { read() } catch (e: Exception) { return }
        val m = if (text == null) emptyMap() else from(text, now) ?: emptyMap()
        if (!loaded) set(m)
    }
}
