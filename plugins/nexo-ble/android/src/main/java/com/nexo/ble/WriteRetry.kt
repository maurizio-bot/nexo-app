package com.nexo.ble

/**
 * WriteRetry (B1, pedido del dueño 03-11) — decisión de reintento de una escritura BLE rechazada por el stack
 * («cola de escritura llena», muy frecuente con MTU 23 y la radio cargada).
 *
 * ANTES (v2723): a los ~40 intentos (~1,8 s) se descartaba el MENSAJE ENTERO. Una congestión normal de MTU 23
 * (ráfagas de rechazos) dura más de 1,8 s → el mensaje se perdía (el dueño lo vio: trozos que no salían).
 *
 * AHORA: el rechazo es TRANSITORIO — Android acepta la escritura en cuanto drena su cola; así que se reintenta
 * el MISMO trozo mucho más tiempo (~9 s) con un ritmo que se va espaciando (no martillar la radio/batería), y
 * solo se descarta si ni en ~9 s se pudo (enlace realmente atascado). En una desconexión REAL no hay que esperar:
 * el manejador de desconexión vacía la cola de escritura y processWriteQueue ni corre.
 *
 * Es una decisión PURA (sin Android) para poder probarla en JVM (tests/kotlin). processWriteQueue la usa con el
 * contador de intentos por enlace (writeRetryCount), que se reinicia en cuanto una escritura sale bien.
 */
object WriteRetry {
    const val FIRST_FAST_ATTEMPTS = 5     // los primeros, muy seguidos (el stack acaba de ocuparse)
    const val MID_ATTEMPTS = 25           // luego un ritmo medio
    const val FAST_DELAY_MS = 15L
    const val MID_DELAY_MS = 50L
    const val SLOW_DELAY_MS = 150L        // la cola larga, espaciada (menos radio/batería)
    const val MAX_ATTEMPTS = 58           // ~6 s de reintentos antes de rendirse (dueño 04-11: «bajá los 9 s al tiempo real
                                          // del BT»; ~6 s ≈ el supervision timeout de Android +margen; antes 80 ≈ 9 s, y 40 ≈ 1,8 s
                                          // perdía mensajes). Rendirse ya NO pierde: la capa de arriba re-rutea a internet (onWriteDropped).

    // #129 (dueño 08-11, diagnóstico del 2960): cuando un enlace está ATASCADO DE VERDAD, descartar UN mensaje (~6 s) y
    // pasar al siguiente de la cola — que también grinda ~6 s y se descarta, y así — martillaba el enlace muerto minutos
    // (en el diagnóstico, un Fénix a 6a14d9595cff: «Write fallo … 15 trozos» cada ~6 s durante ~2 min). Tras N mensajes
    // SEGUIDOS descartados al MISMO enlace (sin ninguna escritura que salga en medio), el enlace está atascado: se suelta
    // TODA la cola de ese MAC de una, en vez de molerla mensaje a mensaje. La capa de arriba ya re-rutea por onWriteDropped.
    // N=2 (no 1) para no soltar la cola por una congestión transitoria de un solo mensaje (lo normal con MTU 23).
    const val FLUSH_AFTER_DROPS = 2

    data class Decision(val drop: Boolean, val delayMs: Long)

    /** streak = cuántos mensajes SEGUIDOS se descartaron a este enlace (se reinicia en cuanto una escritura sale bien). */
    fun shouldFlushStuckQueue(consecutiveDrops: Int): Boolean = consecutiveDrops >= FLUSH_AFTER_DROPS

    /** attempts = número de ESTE intento fallido (1 = el primero que falla). */
    fun decide(attempts: Int): Decision {
        if (attempts >= MAX_ATTEMPTS) return Decision(true, FAST_DELAY_MS)
        val delay = when {
            attempts < FIRST_FAST_ATTEMPTS -> FAST_DELAY_MS
            attempts < MID_ATTEMPTS -> MID_DELAY_MS
            else -> SLOW_DELAY_MS
        }
        return Decision(false, delay)
    }

    /** Tiempo aproximado total de reintentos hasta rendirse (para el aviso y las pruebas). */
    fun maxWaitMs(): Long {
        var t = 0L
        for (a in 1 until MAX_ATTEMPTS) t += decide(a).delayMs
        return t
    }
}
