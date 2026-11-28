package com.nexo.ble

// Fase 1 del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §B.4, §B.5.4, §B.5.6 y §A.7.2): las piezas MECÁNICAS del calendario
// por mensaje, el cupo por relé y los toques degradados, copiadas línea a línea de la app (src/core/ruta/calendario.js, reles_puntos.js,
// contacto_ruta.js). Puras: sin red ni reloj propio. Se prueban con los mismos vectores (tests/vectores/calendario.json;
// RutaCalendarioTest.kt y tests/sim/calvectores.js). PORQUÉ (contrato A.7.2 [RIESGO]): si la app y el nativo usan números distintos
// volvemos a «el nativo le sigue mandando al relé que ya limitaba» (auditoría 28-11 §6). El nativo hoy usa `toqueDegradado`
// (NexoFcmService); el resto queda listo para cuando el nativo sea el ejecutor del calendario (contrato A.7.3).
object RutaCalendario {
    const val BASE_TEXTO_MS = 2_000L; const val BASE_ARCH_MS = 15_000L; const val TECHO_MS = 600_000L
    const val TOPE_HORA = 3; const val LENTO_MS = 30 * 60_000L
    val TOQUES_MS = longArrayOf(0L, 120_000L, 600_000L, 1_800_000L, 7_200_000L)
    const val SIN_ACK_MIN_MS = 8_000L; const val SIN_ACK_MAX_MS = 60_000L
    const val SOBRES_MIN = 6
    const val MAX_CONTENT = 60_000
    // Cupo de lo pesado por relé (reles_puntos.js PUNTOS)
    const val CUPO_MIN = 600; const val CUPO_CALMA = 30
    const val CALMA_MS = 300_000L; const val MITAD_MS = 3_600_000L; const val SUBIDA_MS = 3_600_000L

    data class Siguiente(val at: Long, val lento: Boolean)
    data class Item(val msgId: String, val nx: String, val carril: String, val tipo: String, val chars: Int)

    fun espera(base: Long, n: Int, r: Double): Long = Math.floor(r * Math.min(TECHO_MS.toDouble(), base * Math.pow(2.0, Math.max(0, n).toDouble()))).toLong()
    fun esArchivo(tipo: String): Boolean = tipo.startsWith("ARCH_") || tipo == "NOTA_VOZ"
    fun sinAckMs(p90: Long): Long = Math.min(SIN_ACK_MAX_MS, Math.max(SIN_ACK_MIN_MS, 3 * p90))
    fun siguienteTrasFallo(tipo: String, n: Int, usados: Int, now: Long, r: Double): Siguiente =
        if (usados >= TOPE_HORA) Siguiente(now + LENTO_MS, true) else Siguiente(now + espera(if (esArchivo(tipo)) BASE_ARCH_MS else BASE_TEXTO_MS, n, r), false)
    // -1 = ya no hay más toques
    fun toqueAt(guardadoAt: Long, i: Int): Long = if (i < TOQUES_MS.size) guardadoAt + TOQUES_MS[i] else -1L
    fun cabeSobre(salidas: List<Long>, now: Long): Boolean = salidas.count { now - it < 60_000L } < SOBRES_MIN
    fun juntar(lista: List<Item>): List<List<String>> {
        val out = ArrayList<MutableList<String>>(); val abiertos = HashMap<String, Pair<MutableList<String>, IntArray>>()
        for (m in lista) {
            if (m.tipo != "TEXTO" && m.tipo != "ACUSE") { out.add(mutableListOf(m.msgId)); continue }
            val k = m.nx + "|" + m.carril; val g = abiertos[k]
            if (g != null && g.second[0] + m.chars <= MAX_CONTENT) { g.first.add(m.msgId); g.second[0] += m.chars; continue }
            val ids = mutableListOf(m.msgId); abiertos[k] = Pair(ids, intArrayOf(m.chars)); out.add(ids)
        }
        return out
    }
    // Sobres pesados por minuto tras un límite a las `limitAt` (0 = nunca): 30 los 5 primeros min, la mitad 1 h, y vuelve en otra hora
    fun cupoPorMin(limitAt: Long, now: Long): Int {
        val b = CUPO_MIN
        if (limitAt == 0L || now < limitAt) return b
        val d = now - limitAt
        if (d < CALMA_MS) return CUPO_CALMA
        if (d < CALMA_MS + MITAD_MS) return Math.floor(b / 2.0).toInt()
        if (d < CALMA_MS + MITAD_MS + SUBIDA_MS) return Math.floor(b / 2.0 + (b / 2.0) * (d - CALMA_MS - MITAD_MS) / SUBIDA_MS).toInt()
        return b
    }
    // B.5.6: el toque llegó con prioridad NORMAL (2) habiéndose pedido ALTA (1): Android lo degradó (RemoteMessage.PRIORITY_*)
    fun toqueDegradado(prio: Int, original: Int): Boolean = original == 1 && prio == 2
    // ¿Sigue vigente? El último toque de alta llegó degradado (después del último que llegó bien) y hace < 7 días
    const val DEGRADADO_VIGENCIA_MS = 7 * 24 * 3_600_000L
    fun degradadoVigente(degAt: Long, okAt: Long, now: Long): Boolean = degAt > 0L && degAt > okAt && now - degAt < DEGRADADO_VIGENCIA_MS
    // ¿Tocar? Con toques degradados solo las llamadas y el primer pendiente
    fun tocar(tiene: Boolean, degradado: Boolean, despierto: String, tipo: String, primeroPendiente: Boolean): Boolean {
        if (!tiene) return false
        if (tipo == "llamada") return true
        if (despierto == "APP") return false
        return if (degradado) primeroPendiente else true
    }
}
