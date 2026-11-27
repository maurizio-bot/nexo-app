package com.nexo.ble

// Fase 1 (internet) del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §B.5, decisión del dueño 28-11): la MISMA política de relés
// que la app (src/core/ruta/politica_reles.js), copiada línea a línea. Pura: sin red ni reloj propio. Las dos se prueban con los mismos
// vectores (tests/vectores/politica_reles.json; RelayPolicyTest.kt y tests/sim/politicareles.js): si una se separa, fallan las dos.
// PORQUÉ: hasta la 3167 esta parte nativa (app oculta o cerrada) ignoraba el «OK false» de un relé y le seguía mandando todo al que ya
// limitaba o castigaba (cada sobre más es otra infracción → «banned»), y publicaba en todos los relés aunque el otro no leyera ahí.
object RelayPolicy {
    const val RATE_COOL_MS = 20_000L; const val RATE_COOL_MAX_MS = 600_000L
    const val BAN_COOL_MS = 600_000L; const val BAN_COOL_MAX_MS = 7_200_000L
    const val POLICY_COOL_MS = 6 * 3_600_000L
    const val LIMIT_FORGET_MS = 1_800_000L
    const val LIMIT_BURST_MS = 5_000L // los «no» de una misma ráfaga cuentan como UNO (diag. 28-11: «37.ª vez» por ×35 sobres en camino)
    const val LECTURAS_VIGENCIA_MS = 24 * 3_600_000L
    const val LECTURAS_MAX = 12

    // La pausa de un relé para publicar: tipo de «no», cuántos seguidos, cuándo fue el último y hasta cuándo dura (ms)
    data class Pause(val kind: String, val n: Int, val at: Long, val hasta: Long)
    // Lo que la política necesita de cada relé (en el orden de mi lista)
    data class View(val url: String, val abierto: Boolean, val hasta: Long = 0L, val soloLeer: Boolean = false, val puente: Boolean = false)
    data class Targets(val publicar: List<String>, val pausados: List<String>, val motivo: String)

    private val NOT_LIMIT = Regex("^(duplicate|invalid|auth-required|error):", RegexOption.IGNORE_CASE)
    private val POLICY = Regex("web of trust|not in our|policy|pubkey is not|whitelist|allowlist|paid|payment|^pow:", RegexOption.IGNORE_CASE)
    private val BAN = Regex("banned|^restricted:|^blocked:", RegexOption.IGNORE_CASE)
    private val RATE = Regex("rate.?limit|slow down|too many|too fast", RegexOption.IGNORE_CASE)

    fun limitKind(msg: String?): String {
        val m = msg ?: ""
        if (NOT_LIMIT.containsMatchIn(m)) return ""
        if (POLICY.containsMatchIn(m)) return "policy"
        if (BAN.containsMatchIn(m)) return "ban"
        if (RATE.containsMatchIn(m)) return "rate"
        return ""
    }

    fun coolMs(kind: String, n0: Int): Long {
        val n = maxOf(1, n0)
        val f = 1L shl minOf(n - 1, 30)
        return when (kind) {
            "policy" -> POLICY_COOL_MS
            "ban" -> minOf(BAN_COOL_MS * f, BAN_COOL_MAX_MS)
            "rate" -> minOf(RATE_COOL_MS * f, RATE_COOL_MAX_MS)
            else -> 0L
        }
    }

    // Un relé dijo «no» (msg) a las `now`: su pausa tras ese «no», o null si no es un límite (queda como estaba)
    fun note(prev: Pause?, msg: String?, now: Long): Pause? {
        val kind = limitKind(msg); if (kind.isEmpty()) return null
        if (prev != null && prev.kind == kind && now >= prev.at && now < prev.hasta && now - prev.at < LIMIT_BURST_MS) return prev // misma ráfaga: sin doblar
        val n = if (prev != null && prev.kind == kind && now - prev.at < LIMIT_FORGET_MS) prev.n + 1 else 1
        return Pause(kind, n, now, now + coolMs(kind, n))
    }

    // Juntar las pausas de la app y del nativo: por relé, la que dure más (nunca se acorta). Las vencidas hace más de 30 min se olvidan.
    fun merge(a: Map<String, Pause>?, b: Map<String, Pause>?, now: Long): Map<String, Pause> {
        val out = LinkedHashMap<String, Pause>()
        for (m in listOf(a ?: emptyMap(), b ?: emptyMap())) for ((u, x) in m) {
            if (now - maxOf(x.hasta, x.at) > LIMIT_FORGET_MS) continue
            val y = out[u]
            if (y == null || x.hasta > y.hasta || (x.hasta == y.hasta && x.n > y.n)) out[u] = x
        }
        return out
    }

    // Dónde lee un contacto según su anuncio, solo con los relés que conozco (pool); caducado, del futuro o sin cruce: null (= no lo sé)
    fun readsOf(lee: List<String>?, at: Long, pool: Collection<String>, now: Long): List<String>? {
        if (lee == null) return null
        if (now - at > LECTURAS_VIGENCIA_MS || at - now > 600_000L) return null
        val out = ArrayList<String>()
        for (u in lee.take(LECTURAS_MAX)) if (u in pool && u !in out) out.add(u)
        return out.ifEmpty { null }
    }

    // A qué relés publicar un sobre para un contacto (lee = sus lecturas o null). Igual que destinos() de la app.
    fun targets(relays: List<View>, lee: List<String>?, now: Long): Targets {
        val abiertos = relays.filter { it.abierto && !it.puente }
        if (abiertos.isEmpty()) return Targets(emptyList(), emptyList(), "sin_reles")
        val cand = if (lee != null) abiertos.filter { it.url in lee } else abiertos.filter { !it.soloLeer }
        val libres = cand.filter { !(it.hasta > now) }
        val pausados = cand.filter { it.hasta > now }.map { it.url }
        if (libres.isNotEmpty()) return Targets(libres.map { it.url }, pausados, if (lee != null) "suyos" else "sin_anuncio")
        if (pausados.isNotEmpty()) return Targets(emptyList(), pausados, "en_pausa")
        return Targets(emptyList(), emptyList(), if (lee != null) "ninguno_suyo" else "sin_reles")
    }

    fun givesSaved(url: String, lee: List<String>?): Boolean = lee == null || url in lee
}
