package com.nexo.ble

/**
 * Enlace «a medias» en NUESTRO servidor GATT (patrón «enlace que sobrevive al reinicio», visto 3 veces en los diagnósticos del 19 y
 * 20-11: «Conexión existente recuperada al arrancar», entra sin MTU y sin poder contestarle).
 *
 * Cuando NEXO se cierra o se reinicia (la app, el proceso o el servidor GATT), un enlace que el OTRO teléfono abrió puede seguir vivo:
 * el otro sigue escribiendo por él convencido de que está suscrito a nuestras notificaciones, pero el servidor nuevo no tiene esa
 * suscripción (ni el MTU): recibimos lo suyo y no podemos contestarle nada (ni pong, ni ✓✓). Él nos ve «zombi» y tarda ~30 s en
 * cortar por su cuenta. Un cliente NEXO sano se suscribe SIEMPRE antes de escribir (PluginGatt: MTU → notificaciones → cola), así que
 * «escribe y sigue sin suscribirse pasado un margen» = a medias: se corta para que reconecte limpio (1–3 s).
 *
 * Decisión PURA (sin Android) para probarla en JVM (HalfOpenPolicyTest). No se aplica si por esa misma dirección tenemos un enlace
 * de CLIENTE nuestro (entonces sí podemos contestarle por ahí).
 */
class HalfOpenPolicy(private val graceMs: Long = GRACE_MS, private val cooldownMs: Long = COOLDOWN_MS) {
    companion object {
        const val GRACE_MS = 6000L      // > 4 s (WriteRetry.SETUP_WAIT_MAX_MS: lo más que un cliente NEXO escribe antes de suscribirse)
        const val COOLDOWN_MS = 30000L  // tras cortar una dirección, no volver a cortarla enseguida (nunca un bucle)
        private const val MAX = 200
    }
    private val first = HashMap<String, Long>()
    private val cutAt = HashMap<String, Long>()

    /** Llega una escritura del otro por nuestro servidor. Devuelve true si hay que CORTAR ese enlace ahora. */
    @Synchronized fun onWrite(mac: String, subscribed: Boolean, ownClient: Boolean, now: Long): Boolean {
        if (subscribed || ownClient) { first.remove(mac); return false }
        val last = cutAt[mac]
        if (last != null && now - last < cooldownMs) return false
        val f = first[mac]
        if (f == null) { if (first.size >= MAX) first.clear(); first[mac] = now; return false }
        if (now - f < graceMs) return false
        first.remove(mac)
        if (cutAt.size >= MAX) cutAt.clear()
        cutAt[mac] = now
        return true
    }

    /** Se suscribió (o el enlace se cerró): fuera la cuenta de esa dirección. */
    @Synchronized fun forget(mac: String) { first.remove(mac) }
}
