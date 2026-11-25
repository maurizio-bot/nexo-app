package com.nexo.ble

/**
 * Qué hace la llamada NEXO cuando otra cosa toma el audio del teléfono. Lógica pura (sin Android): tests/kotlin FocusPolicyTest.
 *
 * 3278 (dueño 22-11: «cuando pongo la videollamada en miniatura es porque quiero ocupar algo más: la misma app, otras apps, ver
 * vídeos en YouTube… la videollamada debe seguir, hablar y escuchar, y el vídeo no se debe interrumpir ni ir a pausa; las dos cosas
 * deben poder correr al mismo tiempo, cada una con su volumen de Android»). REGLA: SOLO una llamada TELEFÓNICA de verdad (el audio
 * del teléfono en modo «sonando» o «en llamada») RETIENE la llamada NEXO. Si es otra app la que toma el audio (un vídeo, música, la
 * cámara grabando, un aviso), la llamada NEXO SIGUE —voz e imagen— y suenan las dos; NEXO no le vuelve a quitar el audio.
 *
 * Historia: #dueño 01-11, toda pérdida del foco retenía la llamada (pensado para la llamada telefónica). 3226 (17-11), una pérdida
 * permanente sin llamada telefónica volvía a PEDIR el foco (eso pausaba el vídeo de la otra app) y, si la otra app insistía antes
 * de 10 s, la llamada quedaba retenida para siempre: ni se oía ni se veía al otro = «la miniatura se pausa al usar otras apps».
 */
object FocusPolicy {
    const val NONE = 0
    /** Retener la llamada NEXO (hay una llamada telefónica). */
    const val HOLD = 1
    /** Seguir: otra app tomó el audio; suenan las dos y no se le quita. */
    const val KEEP = 3
    /** Reanudar la llamada NEXO retenida (la llamada telefónica terminó). */
    const val RESUME = 4
    /** Cada cuánto se mira el modo del audio mientras la llamada NEXO está sin foco o retenida. */
    const val WATCH_MS = 1000L
    /** Repasos seguidos SIN llamada telefónica antes de reanudar (entre «sonando» y «en llamada» el modo puede pasar un instante por normal). */
    const val CALM_TICKS = 2

    // AudioManager.MODE_RINGTONE = 1, MODE_IN_CALL = 2 (MODE_IN_COMMUNICATION = 3 lo pone la propia llamada NEXO)
    fun phoneMode(mode: Int): Boolean = mode == 1 || mode == 2

    /** Al perder el foco (change < 0): [HOLD] si hay llamada telefónica; si no, [KEEP]. */
    fun onLoss(change: Int, audioMode: Int): Int = if (change < 0 && phoneMode(audioMode)) HOLD else KEEP

    /**
     * Repaso (cada [WATCH_MS]) mientras la llamada NEXO no tiene el foco o está retenida. El foco se pierde un instante ANTES de que
     * el teléfono pase a «sonando», y si otra app ya tenía el audio no llega ningún aviso de pérdida: por eso se mira el modo.
     * held = retenida ahora; calmTicks = repasos seguidos sin llamada telefónica (contando este).
     */
    fun onWatch(held: Boolean, audioMode: Int, calmTicks: Int): Int = when {
        phoneMode(audioMode) -> if (held) NONE else HOLD
        held && calmTicks >= CALM_TICKS -> RESUME
        else -> NONE
    }
}
