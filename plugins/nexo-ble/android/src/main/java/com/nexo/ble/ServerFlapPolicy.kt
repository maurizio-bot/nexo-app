package com.nexo.ble

// 3203 (diagnóstico de Roberto, Motorola edge 40 neo 3087, 17-11 09:32): con NEXO en segundo plano, un teléfono SIN identificar
// (dirección …0da5, sin NEXO ID) entró y salió del servidor GATT cada ~36 s durante 14 min (09:18:58–09:32). Cada vuelta dejaba dos
// líneas en el registro («Connection … newState=0» y «Reanudando advertising tras desconexion»), relanzaba BleService
// (startForegroundService: despierta el proceso y vuelve a poner su aviso) y le dejaba a la app un aviso de conexión y otro de
// desconexión de un enlace que ya no existía (al volver a la app: «Enlace ? (0da5) desconectado ×21»).
// Freno: una dirección que entra y sale FLAPS_TO_BRAKE veces en WINDOW_MS SIN decir nada válido (ningún mensaje completo: ni saludo,
// ni kx, ni otro) queda frenada BRAKE_MS: sus conexiones se cierran al entrar, sin registro, sin aviso a la app y sin reanudar el
// anuncio. Si en cuanto caduca vuelve a entrar y salir sin decir nada, el freno se dobla (hasta BRAKE_MAX_MS). Una sola línea en el
// registro al frenar (brakeLine) en vez de dos cada 36 s.
// Nunca se frena a quien habló (un mensaje completo por esa dirección), a un contacto que el nativo conoce (mapa NEXO ID ↔ dirección)
// ni a una dirección con la que somos cliente (Android avisa también al servidor de esos enlaces): eso lo dice quien llama (trusted).
// Las direcciones Bluetooth rotan (privacidad): el freno caduca solo y una dirección que no se ve en FORGET_MS se olvida.
// Además, «reanudar el anuncio» tras la desconexión de quien no se identificó va agrupado: como mucho uno cada ADV_EVERY_MS; si se
// pide antes, se hace una vez al final del plazo (advDue): el último pedido no se pierde.
// Pura (sin Android): se prueba en JVM (ServerFlapPolicyTest). El servidor GATT avisa desde hilos del binder: todo sincronizado.
class ServerFlapPolicy(
    private val windowMs: Long = WINDOW_MS,
    private val flapsToBrake: Int = FLAPS_TO_BRAKE,
    private val brakeMs: Long = BRAKE_MS,
    private val brakeMaxMs: Long = BRAKE_MAX_MS,
    private val advEveryMs: Long = ADV_EVERY_MS,
    private val forgetMs: Long = FORGET_MS,
    private val maxEntries: Int = MAX_ENTRIES,
) {
    companion object {
        const val WINDOW_MS = 5 * 60_000L
        const val FLAPS_TO_BRAKE = 3
        const val BRAKE_MS = 5 * 60_000L
        const val BRAKE_MAX_MS = 20 * 60_000L
        const val ADV_EVERY_MS = 60_000L
        const val FORGET_MS = 30 * 60_000L
        const val MAX_ENTRIES = 64
        // Disc.adv: reanudar el anuncio ya / no reanudarlo; > 0 = dentro de esos ms (y entonces preguntar advDue)
        const val ADV_NOW = 0L
        const val ADV_NO = -1L
    }

    // Qué hacer con una desconexión del servidor GATT.
    //  quiet: era una conexión que cerró el freno → ni registro, ni aviso a la app, ni anuncio.
    //  brakeMs > 0: la dirección entra en el freno ahora (una línea: brakeLine); flaps/spanMs: cuántas vueltas y en cuánto tiempo;
    //  again: vuelve a frenarse en cuanto caducó el anterior (refusedBefore: conexiones que cerró ese freno).
    //  adv: ADV_NOW, ADV_NO o dentro de cuántos ms reanudar el anuncio.
    data class Disc(val quiet: Boolean, val adv: Long, val brakeMs: Long = 0L, val flaps: Int = 0, val spanMs: Long = 0L,
                    val again: Boolean = false, val refusedBefore: Int = 0)

    private class Entry {
        val flaps = ArrayDeque<Long>()  // horas de las salidas sin decir nada (dentro de la ventana)
        var spoke = false               // dijo algo válido por esta dirección: nunca se frena
        var brakeUntil = 0L
        var lastBrakeMs = 0L            // duración del último freno (para doblarlo si sigue igual)
        var refusing = false            // la conexión en curso la cerró el freno
        var refused = 0                 // conexiones cerradas en el freno en curso
        var connected = false
        var seen = 0L
    }
    // Orden de acceso: si se llena, se olvida la dirección vista hace más tiempo
    private val map = LinkedHashMap<String, Entry>(16, 0.75f, true)
    private var advLast: Long? = null
    private var advPending = false

    // Entra una conexión al servidor. true = está frenada: cerrarla ya (sin registro ni aviso a la app).
    @Synchronized fun onConnect(mac: String, now: Long, trusted: Boolean): Boolean {
        prune(now)
        if (trusted) { map[mac]?.let { it.refusing = false; it.connected = true; it.seen = now }; return false }
        val e = entry(mac, now)
        e.seen = now
        if (!e.spoke && now < e.brakeUntil) { e.refusing = true; e.refused++; return true }
        e.refusing = false; e.connected = true
        return false
    }

    // Llegó un mensaje completo por esta dirección (saludo, kx, ping, cualquier otro): se identificó; se le quita todo freno.
    @Synchronized fun spoke(mac: String, now: Long) {
        val e = entry(mac, now)
        e.spoke = true; e.seen = now
        e.flaps.clear(); e.brakeUntil = 0L; e.lastBrakeMs = 0L
    }

    @Synchronized fun onDisconnect(mac: String, now: Long, trusted: Boolean): Disc {
        prune(now)
        val e0 = map[mac]
        if (e0 != null) { e0.connected = false; e0.seen = now }
        if (e0 != null && e0.refusing) { e0.refusing = false; return Disc(quiet = true, adv = ADV_NO) }
        if (trusted || e0?.spoke == true) return Disc(quiet = false, adv = advNow(now))
        val e = e0 ?: entry(mac, now).also { it.seen = now }
        e.flaps.addLast(now)
        while (e.flaps.isNotEmpty() && now - e.flaps.first() > windowMs) e.flaps.removeAt(0)
        // Acaba de caducar su freno (hace menos de una ventana) y sigue entrando y saliendo sin decir nada: otra vez, el doble
        val again = e.lastBrakeMs > 0 && now >= e.brakeUntil && now - e.brakeUntil < windowMs
        if (!again && e.flaps.size < flapsToBrake) return Disc(quiet = false, adv = advCoalesced(now))
        val dur = if (again) minOf(e.lastBrakeMs * 2, brakeMaxMs) else brakeMs
        val d = Disc(quiet = false, adv = advCoalesced(now), brakeMs = dur, flaps = e.flaps.size, spanMs = now - e.flaps.first(),
            again = again, refusedBefore = e.refused)
        e.brakeUntil = now + dur; e.lastBrakeMs = dur; e.refused = 0; e.flaps.clear()
        return d
    }

    // Llegó la hora de un reinicio del anuncio aplazado: true = hacerlo ahora (false: ya se hizo otro entre tanto)
    @Synchronized fun advDue(now: Long): Boolean {
        if (!advPending) return false
        advPending = false
        val last = advLast
        if (last != null && now - last < advEveryMs) return false
        advLast = now
        return true
    }

    @Synchronized fun braked(mac: String, now: Long): Boolean { val e = map[mac] ?: return false; return !e.spoke && now < e.brakeUntil }

    @Synchronized fun size(): Int = map.size

    // La línea del registro al frenar (dirección abreviada: los 4 últimos caracteres, como el JS «Enlace ? (0da5)»)
    fun brakeLine(mac: String, d: Disc): String {
        val tail = mac.takeLast(4)
        val mins = (d.brakeMs + 59_999L) / 60_000L
        return if (d.again) "Teléfono sin identificar …$tail sigue entrando y saliendo (el freno anterior cerró ${d.refusedBefore} conexiones): lo freno $mins min"
        else "Teléfono sin identificar …$tail entra y sale (${d.flaps} veces en ${(d.spanMs + 500L) / 1000L} s, sin decir quién es): lo freno $mins min"
    }

    private fun advNow(now: Long): Long { advLast = now; advPending = false; return ADV_NOW }

    private fun advCoalesced(now: Long): Long {
        val last = advLast
        if (last == null || now - last >= advEveryMs) { advLast = now; return ADV_NOW }
        if (advPending) return ADV_NO
        advPending = true
        return last + advEveryMs - now
    }

    private fun entry(mac: String, now: Long): Entry {
        map[mac]?.let { return it }
        val e = Entry().also { it.seen = now }
        map[mac] = e
        // Tope de memoria: fuera la vista hace más tiempo (orden de acceso)
        while (map.size > maxEntries) { val k = map.keys.iterator().next(); map.remove(k) }
        return e
    }

    // Se olvida lo que no se ve hace FORGET_MS (salvo un freno en curso o un enlace abierto)
    private fun prune(now: Long) {
        val it = map.values.iterator()
        while (it.hasNext()) { val e = it.next(); if (!e.connected && !e.refusing && now >= e.brakeUntil && now - e.seen > forgetMs) it.remove() }
    }
}
