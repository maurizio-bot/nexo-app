package com.nexo.ble

import org.json.JSONArray
import org.json.JSONObject

/**
 * 3190 (dueño 17-11: «hay que poner esa notificación: hay un contacto que te quiere agregar»): el aviso del teléfono por una solicitud
 * de contacto que la escucha de internet en segundo plano (NetBg) oyó en mi buzón de solicitudes con la app en segundo plano o cerrada.
 * El NEXO ID es semipúblico (se pasa por WhatsApp): cualquiera que lo conozca puede dejar solicitudes, así que el aviso lleva FRENO:
 * como mucho UNO por remitente cada 24 h y TRES por hora en total; lo que pase de ahí va a un solo aviso agrupado y callado
 * («N personas más quieren agregarte»). La solicitud no se pierde: la app la pone en «Solicitudes para ti» al abrirse (con su propio
 * freno, _reqFlood). Y el texto: nombre saneado + NEXO ID completo (que nadie se haga pasar por otro) y, si el nombre es el de un
 * contacto que ya tengo con otro ID, la advertencia de posible impostor (como la bandeja de la app, 3135).
 * Parte pura (se prueba en JVM: tests/kotlin ReqNotifyPolicyTest).
 */
object ReqNotifyPolicy {
    const val PER_SENDER_MS = 24 * 3600_000L
    const val WINDOW_MS = 3600_000L
    const val MAX_PER_WINDOW = 3
    const val KEEP_SENDERS = 300

    enum class Verdict { NOTIFY, GROUP, SAME_SENDER }

    /** Lo que recuerda el freno (se guarda en las preferencias: sobrevive a un reinicio del proceso). */
    class State(
        val last: LinkedHashMap<String, Long> = LinkedHashMap(),   // remitente → cuándo se le avisó (o se agrupó)
        val recent: ArrayList<Long> = ArrayList(),                 // avisos sueltos de la última hora
        var groupN: Int = 0,                                       // personas en el aviso agrupado de esta hora
        var groupAt: Long = 0L,
    ) {
        fun toJson(): String {
            val l = JSONObject(); last.forEach { (k, v) -> l.put(k, v) }
            return JSONObject().put("l", l).put("r", JSONArray(recent)).put("g", groupN).put("ga", groupAt).toString()
        }
        companion object {
            fun fromJson(s: String?): State {
                if (s.isNullOrEmpty() || s.length > 200_000) return State()
                return try {
                    val o = JSONObject(s); val st = State()
                    val l = o.optJSONObject("l")
                    // org.json no guarda el orden: de más viejo a más nuevo (el tope KEEP_SENDERS suelta los más viejos)
                    l?.keys()?.asSequence()?.map { it to l.optLong(it) }?.sortedBy { it.second }?.forEach { st.last[it.first] = it.second }
                    val r = o.optJSONArray("r"); if (r != null) for (i in 0 until r.length()) st.recent.add(r.optLong(i))
                    st.groupN = o.optInt("g"); st.groupAt = o.optLong("ga")
                    st
                } catch (e: Exception) { State() }
            }
        }
    }

    /** ¿Aviso suelto, al agrupado o nada (ya se avisó de este remitente en 24 h)? Apunta la decisión en [st]. */
    fun decide(st: State, from: String, now: Long): Verdict {
        val f = from.trim().lowercase()
        // lo viejo fuera (y una hora del futuro —el reloj fue hacia atrás— no deja a nadie callado para siempre)
        st.last.entries.removeAll { now - it.value >= PER_SENDER_MS || it.value > now }
        st.recent.removeAll { now - it >= WINDOW_MS || it > now }
        if (st.groupAt > now || now - st.groupAt >= WINDOW_MS) { st.groupN = 0; st.groupAt = 0L }
        if (st.last.containsKey(f)) return Verdict.SAME_SENDER
        st.last[f] = now
        while (st.last.size > KEEP_SENDERS) st.last.remove(st.last.keys.first())
        if (st.recent.size < MAX_PER_WINDOW) { st.recent.add(now); return Verdict.NOTIFY }
        if (st.groupN == 0) st.groupAt = now
        st.groupN++
        return Verdict.GROUP
    }

    /** Nombre para el aviso: sin caracteres de control ni de formato (los que invierten el texto o son invisibles podrían
     *  disfrazar el NEXO ID que va al lado), espacios juntos, 40 como mucho. */
    fun cleanName(s: String): String {
        val b = StringBuilder(s.length)
        // control (saltos de línea, tabuladores) → espacio; formato (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF) y < > → fuera
        for (ch in s) if (Character.isISOControl(ch)) b.append(' ') else if (Character.getType(ch) != Character.FORMAT.toInt() && ch != '<' && ch != '>') b.append(ch)
        return b.toString().replace(Regex("\\s+"), " ").trim().take(40)
    }
    fun normName(s: String): String = cleanName(s).lowercase()

    /** Anti-suplantación (como _twinByName de la app, 3135): el nombre de un contacto que YA tengo con este mismo nombre y otro
     *  NEXO ID; "" si no hay. [known] = mis contactos (NEXO ID → nombre). */
    fun twinOf(name: String, from: String, known: Map<String, String>): String {
        val n = normName(name)
        if (n.isEmpty() || n == "nexo") return ""
        val f = from.trim().lowercase()
        for ((nx, nm) in known) if (nx.trim().lowercase() != f && normName(nm) == n) return cleanName(nm)
        return ""
    }

    /** Texto del aviso en [lang]: acc = aceptó una solicitud MÍA; twin = nombre del contacto al que se parece (o ""). */
    fun body(lang: String?, name: String, from: String, acc: Boolean, twin: String): String {
        val id = from.trim().uppercase()
        val nm = cleanName(name)
        val who = if (nm.isEmpty()) id else "$nm ($id)"
        return when {
            acc -> NativeText.t(lang, "req_acc", "who" to who)
            twin.isNotEmpty() -> NativeText.t(lang, "req_in_twin", "id" to id, "name" to twin)
            else -> NativeText.t(lang, "req_in", "who" to who)
        }
    }

    /** Texto del aviso agrupado (n personas más, sin nombres). */
    fun groupBody(lang: String?, n: Int): String = if (n <= 1) NativeText.t(lang, "req_more_1") else NativeText.t(lang, "req_more_n", "n" to n)
}
