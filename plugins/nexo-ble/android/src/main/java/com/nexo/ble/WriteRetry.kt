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
    const val MAX_ATTEMPTS = 80           // ~9 s de reintentos antes de rendirse (antes 40 ≈ 1,8 s)

    data class Decision(val drop: Boolean, val delayMs: Long)

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
