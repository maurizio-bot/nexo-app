package com.nexo.ble

/**
 * XferAwake — lógica PURA de "mantener DESPIERTO al que RECIBE durante una transferencia GRANDE por internet"
 * (envío de ~25 MB a alguien lejos, paso 2b, idea/pedido del dueño 06-11), SIN nada de Android.
 *
 * Contexto: el lado JS ya quedó cerrado (2929 ruteo a internet antes que Bluetooth, 2930/2931 latido MUTUO del
 * despertador, 2933 Tor DIRECTO para el archivo grande). Pero con la app en segundo plano o congelada, Android (Doze /
 * ahorro del fabricante) puede dormir el proceso a mitad de un envío largo. Falta que, cuando entra una transferencia
 * GRANDE por internet, el que RECIBE sostenga un servicio en primer plano (y/o un wakelock) para no dormirse, y lo
 * SUELTE al terminar o si la transferencia murió (sin tener la radio/CPU tomadas de más ni gastar batería).
 *
 * Acá vive solo la LÓGICA de control (decisiones), testeable en JVM (tests/kotlin/XferAwakeTest.kt), igual que
 * WdWarm / WritePacing / WriteRetry. El plugin usará estas decisiones + el servicio en primer plano / PowerManager
 * REALES (eso se compila y se valida en los teléfonos). Nada de esto se activa todavía: es el andamiaje del paso 2b.
 */
object XferAwake {
    const val MIN_BIG_CHUNKS = 1000L        // "grande" = NET_TOR_PREFER_CHUNKS del JS (ble_ack.js): ~ > 12 MB
    const val IDLE_TTL_MS = 60_000L         // sin AVANCE este rato → la transferencia murió, soltar (el latido es cada 15 s)
    const val MAX_HOLD_MS = 20 * 60_000L    // tope DURO: nunca tener el servicio tomado más de 20 min (seguridad batería)
    const val POLL_MS = 5_000L              // cada cuánto revisar si hay que soltar, aunque no llegue nada

    /** ¿Es una transferencia que justifica mantener despierto al que recibe? SOLO archivos GRANDES por internet.
     *  Los chicos/medianos (fotos) y los textos NO; el Bluetooth NO (ese es otro camino, no se duerme igual). */
    fun isBigNetReceive(isNet: Boolean, isFile: Boolean, totalChunks: Long, minChunks: Long = MIN_BIG_CHUNKS): Boolean {
        return isNet && isFile && totalChunks > minChunks
    }

    /** ¿TOMAR el servicio en primer plano ahora? Solo si hay una transferencia grande activa y aún no lo tenemos. */
    fun shouldAcquire(bigActive: Boolean, alreadyHeld: Boolean): Boolean = bigActive && !alreadyHeld

    /** ¿SOLTAR el servicio? Nunca si no lo tenemos. Sí al completarse la transferencia; sí si pasó el TTL sin avance
     *  (la transferencia murió: el que envía ya no manda ni el latido despierta); sí si se superó el tope DURO desde
     *  que se tomó (seguridad: una transferencia atascada no tiene la radio tomada para siempre). */
    fun shouldRelease(
        held: Boolean, complete: Boolean,
        lastProgressMs: Long, heldSinceMs: Long, nowMs: Long,
        idleTtlMs: Long = IDLE_TTL_MS, maxHoldMs: Long = MAX_HOLD_MS,
    ): Boolean {
        if (!held) return false
        if (complete) return true
        if (lastProgressMs > 0L && nowMs - lastProgressMs >= idleTtlMs) return true
        if (heldSinceMs > 0L && nowMs - heldSinceMs >= maxHoldMs) return true
        return false
    }

    /** Timeout (ms) del próximo chequeo de "¿soltar?": lo que falte para el TTL de inactividad, acotado a [1, POLL_MS]
     *  para poder revisar periódicamente aunque no llegue ningún bloque. */
    fun nextCheckMs(lastProgressMs: Long, nowMs: Long, idleTtlMs: Long = IDLE_TTL_MS): Long {
        val base = if (lastProgressMs <= 0L) idleTtlMs else (lastProgressMs + idleTtlMs - nowMs)
        val clamped = if (base < 1L) 1L else base
        return if (clamped > POLL_MS) POLL_MS else clamped
    }
}
