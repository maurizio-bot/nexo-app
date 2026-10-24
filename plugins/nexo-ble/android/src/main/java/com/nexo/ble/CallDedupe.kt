package com.nexo.ble

/**
 * Ronda 2768 (revisión de llamadas): un aviso por oferta de llamada. Con la app cerrada o congelada nadie confirma los
 * trozos de la oferta y el que llama reenvía el primero cada ~4 s: cada reenvío volvía a poner el aviso (9 avisos en
 * una sola llamada) y, tras tocar "Rechazar", volvía a sonar. La oferta se reconoce por el id de su mensaje, que es el
 * mismo para el nativo (primer trozo) y para la app (mensaje completo).
 * Sin dependencias de Android: se prueba en JVM (CallDedupeTest).
 */
class CallDedupe(private val windowMs: Long = 120_000) {
    private val seen = HashMap<String, Long>()

    // ¿Es la primera vez (en la ventana) que se avisa de esta oferta de este remitente? Sin id de oferta (una build
    // anterior de la app), siempre sí. Cada reenvío alarga la ventana.
    @Synchronized fun first(from: String, offer: String, now: Long = System.currentTimeMillis()): Boolean {
        val it = seen.values.iterator()
        while (it.hasNext()) if (now - it.next() > windowMs) it.remove()
        if (offer.isEmpty()) return true
        return seen.put(from.lowercase() + "|" + offer, now) == null
    }
}
