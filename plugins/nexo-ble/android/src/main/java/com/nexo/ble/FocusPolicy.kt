package com.nexo.ble

/**
 * 3226 (dueño 17-11 22:41, S24 en videollamada con la S23: la puso en miniatura, abrió la cámara del chat, hizo zoom, volvió a la
 * llamada y «se trabó»): al perder el foco de audio la llamada NEXO se RETENÍA siempre, como si entrara una llamada telefónica
 * (#dueño 01-11). Pero una pérdida PERMANENTE (AUDIOFOCUS_LOSS, -1) no la devuelve el sistema: si no era una llamada telefónica
 * (la cámara del chat en vídeo, otra app de música…), la videollamada quedaba en pausa para siempre (diagnóstico: «Foco de audio:
 * -1» → «En pausa por llamada telefónica» y ni una estadística más de la llamada).
 * Ahora: llamada telefónica de verdad (modo del audio IN_CALL o RINGTONE) → retener, como antes; pérdida permanente SIN llamada
 * telefónica → volver a pedir el foco y seguir (una vez cada [REGRAB_GAP_MS]: si otra app lo vuelve a quitar enseguida, se retiene
 * en vez de pelear por el audio). Las pérdidas pasajeras (-2, -3) siguen igual: el sistema devuelve el foco y la llamada se reanuda.
 * Lógica pura (sin Android) para probarla en la JVM: tests/kotlin FocusPolicyTest.
 */
object FocusPolicy {
    const val HOLD = 1
    const val REGRAB = 2
    const val REGRAB_GAP_MS = 10_000L
    private const val AUDIOFOCUS_LOSS = -1
    // AudioManager.MODE_RINGTONE = 1, MODE_IN_CALL = 2 (MODE_IN_COMMUNICATION = 3 lo pone la propia llamada NEXO)
    fun phoneMode(mode: Int): Boolean = mode == 1 || mode == 2

    /** Qué hacer al perder el foco: [HOLD] (retener la llamada NEXO) o [REGRAB] (volver a pedirlo y seguir). */
    fun onLoss(change: Int, audioMode: Int, lastRegrabAt: Long, now: Long): Int =
        if (change == AUDIOFOCUS_LOSS && !phoneMode(audioMode) && now - lastRegrabAt >= REGRAB_GAP_MS) REGRAB else HOLD
}
