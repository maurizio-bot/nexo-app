package com.nexo.ble

/**
 * WdWarm — lógica PURA del «grupo Wi-Fi Direct CALIENTE» (política de caminos, paso 2, dueño 04-11), SIN nada de Android.
 *
 * Idea: hoy NexoBlePlugin monta el grupo Wi-Fi Direct, manda UNA transferencia y lo desarma (wifiDirectHost/wdReceive/
 * wdTearDown) → cada envío paga ~5 s de montaje. El «grupo caliente» lo MANTIENE armado entre transferencias (acepta
 * varias) y lo SUELTA solo por inactividad / a pedido, para no tener la radio Wi-Fi tomada de más ni gastar batería.
 *
 * Acá vive solo la LÓGICA de control (decisiones), testeable en JVM (tests/kotlin/WdWarmTest.kt), al igual que
 * WritePacing/WriteRetry. El plugin usará estas decisiones + los sockets / WifiP2p reales (eso se valida en los
 * teléfonos). Nada de esto se activa todavía: es el andamiaje del paso 2.
 */
object WdWarm {
    const val IDLE_TTL_MS = 45_000L          // sin usarse este rato → soltar el grupo (batería / liberar el Wi-Fi)
    const val MAX_BYTES = 40_000_000L        // tope por transferencia (igual que WD_MAX_BYTES del plugin)
    const val ACCEPT_POLL_MS = 5_000L        // cada cuánto el accept se despierta para revisar el TTL aunque no llegue nadie

    /** ¿Soltar el grupo por inactividad? Nunca mientras haya una transferencia en curso; tampoco si recién se armó y aún
     *  no se usó (lastActivityMs<=0). Si no, cuando pasó el TTL desde la última actividad. */
    fun shouldRelease(lastActivityMs: Long, nowMs: Long, inFlight: Int, ttlMs: Long = IDLE_TTL_MS): Boolean {
        if (inFlight > 0) return false
        if (lastActivityMs <= 0L) return false
        return nowMs - lastActivityMs >= ttlMs
    }

    /** Timeout (ms) del próximo accept: lo que falte para el TTL, acotado a [1, ACCEPT_POLL_MS] para poder revisar el TTL
     *  periódicamente aunque no se conecte nadie. */
    fun nextAcceptTimeoutMs(lastActivityMs: Long, nowMs: Long, ttlMs: Long = IDLE_TTL_MS): Long {
        val base = if (lastActivityMs <= 0L) ttlMs else (lastActivityMs + ttlMs - nowMs)
        val clamped = if (base < 1L) 1L else base
        return if (clamped > ACCEPT_POLL_MS) ACCEPT_POLL_MS else clamped
    }

    /** Validar la cabecera {id, len} de una transferencia entrante. Devuelve len si es válida; -1 si no. */
    fun acceptedLen(idMatches: Boolean, len: Long, maxBytes: Long = MAX_BYTES): Long {
        if (!idMatches) return -1L
        if (len <= 0L || len > maxBytes) return -1L
        return len
    }

    /** ¿Armar el grupo ahora? Solo si hay Bluetooth directo (WD se arma SOBRE el BT; no rescata un BT muerto), no está ya
     *  vivo y no se está montando otro. El gate de «no tocar el Wi-Fi/internet normal» lo decide el JS antes de pedir esto. */
    fun shouldArm(btDirect: Boolean, alreadyLive: Boolean, arming: Boolean): Boolean {
        return btDirect && !alreadyLive && !arming
    }
}
