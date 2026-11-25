package com.nexo.ble

/**
 * ScanBook (23-11, MULTITUD / EDC: docs/EDC_LIMITES.md, cambios 4 y 5) — Lo que el escaneo recuerda de cada dirección que oye y
 * cómo se avisa a la app, pensado para cientos de NEXO alrededor (un vagón, un festival).
 *
 * Antes, con CADA anuncio (miles por segundo en una multitud): dos líneas a logcat, cuatro mapas que crecían sin tope
 * (seen1M, seenCoded, scanLogLast, lastScanNotifyTime), una lista (`scanResults`) recorrida ENTERA para ver si la dirección ya
 * estaba (y que nadie leía), un objeto para la app aunque no tocara avisar, y un aviso a la app POR dirección cada segundo
 * (500 teléfonos = 500 cruces del puente por segundo).
 *
 * Ahora:
 *  - UN mapa por dirección con TOPE: al pasarlo se olvidan las que hace más que no se oyen (`seen` devuelve cuáles, para que el
 *    plugin suelte también lo suyo).
 *  - AVISOS AGRUPADOS: con pocos teléfonos cerca cada uno se avisa al momento, como siempre (en casa no cambia nada). Con muchos
 *    (más de `directPerS` avisos en el último segundo) se juntan y salen en UNA tanda cada `batchMs`, primero los prioritarios y
 *    después por señal (los más cercanos antes). Un PRIORITARIO (un contacto con algo esperando para él) sale siempre al momento:
 *    la multitud no retrasa el mensaje que está esperando.
 *
 * Puro (sin Android): se prueba en JVM (ScanBookTest). El plugin pone el reloj y manda lo que sale de aquí.
 */
class ScanBook<T>(
    private val debounceMs: Long = 1000L,   // una dirección no se avisa a la app más de una vez por segundo
    private val logMinMs: Long = 20000L,    // ni se apunta en el registro más de una vez cada 20 s
    private val cap: Int = 1200,            // direcciones recordadas como mucho
    private val directPerS: Int = 12,       // hasta estos avisos por segundo van sueltos; a partir de ahí, en tandas
    val batchMs: Long = 500L                // cada cuánto sale una tanda
) {
    private class E { var seen = 0L; var notify = 0L; var log = 0L; var s1m = 0L; var coded = 0L }
    private class P<T>(val item: T, val rssi: Int, val n: Int)

    private val m = HashMap<String, E>()
    private val pending = LinkedHashMap<String, P<T>>()
    private var winStart = 0L
    private var winCount = 0
    private var seq = 0

    /** Se oyó un anuncio de `mac` (por largo alcance o normal). Devuelve las direcciones que se olvidan por el tope (casi siempre, ninguna). */
    @Synchronized fun seen(mac: String, coded: Boolean, now: Long): List<String> {
        val e = m.getOrPut(mac) { E() }
        e.seen = now
        if (coded) e.coded = now else e.s1m = now
        return if (m.size > cap) prune() else emptyList()
    }
    @Synchronized fun seen1M(mac: String): Long = m[mac]?.s1m ?: 0L
    @Synchronized fun seenCoded(mac: String): Long = m[mac]?.coded ?: 0L
    @Synchronized fun has(mac: String): Boolean = m.containsKey(mac)
    @Synchronized fun size(): Int = m.size

    /** ¿Toca apuntar esta dirección en el registro? (una vez cada logMinMs) */
    @Synchronized fun shouldLog(mac: String, now: Long): Boolean {
        val e = m[mac] ?: return false
        if (e.log != 0L && now - e.log < logMinMs) return false
        e.log = now
        return true
    }
    /** ¿Toca avisar a la app de esta dirección? (una vez cada debounceMs). Solo entonces se arma el aviso. */
    @Synchronized fun due(mac: String, now: Long): Boolean {
        val e = m[mac] ?: return false
        if (e.notify != 0L && now - e.notify < debounceMs) return false
        e.notify = now
        return true
    }
    /**
     * El aviso de `mac` ya armado. true = mandarlo YA, suelto (pocos alrededor, o prioritario); false = quedó en la tanda
     * (sale con `flush`). Mientras haya una tanda esperando, lo no prioritario va a ella (se conserva el orden de llegada a la app).
     */
    @Synchronized fun offer(mac: String, item: T, rssi: Int, prio: Boolean, now: Long): Boolean {
        if (now - winStart >= 1000L || now < winStart) { winStart = now; winCount = 0 }
        winCount++
        if (prio) { pending.remove(mac); return true }
        if (winCount <= directPerS && pending.isEmpty()) return true
        pending[mac] = P(item, rssi, seq++)
        return false
    }
    @Synchronized fun hasPending(): Boolean = pending.isNotEmpty()
    /** La tanda: los más cercanos primero (a igual señal, por orden de llegada). Vacía la espera. */
    @Synchronized fun flush(): List<T> {
        if (pending.isEmpty()) return emptyList()
        val l = pending.values.sortedWith(compareByDescending<P<T>> { it.rssi }.thenBy { it.n }).map { it.item }
        pending.clear()
        return l
    }
    /** Al empezar a buscar o al apagarse/encenderse el Bluetooth: todo se puede avisar de nuevo (lo oído no se olvida). */
    @Synchronized fun resetNotify() {
        m.values.forEach { it.notify = 0L }
        pending.clear()
        winStart = 0L; winCount = 0
    }

    // Se quedan las 3/4 partes oídas más recientemente
    private fun prune(): List<String> {
        val keep = cap * 3 / 4
        val times = m.values.map { it.seen }.sorted()
        val cut = times[times.size - keep]
        val gone = ArrayList<String>()
        val it = m.entries.iterator()
        while (it.hasNext()) { val en = it.next(); if (en.value.seen < cut) { gone.add(en.key); it.remove() } }
        gone.forEach { pending.remove(it) }
        return gone
    }
}
