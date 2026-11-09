package com.nexo.ble

/**
 * NEXO Touch (build 2968, dueño 09-11) — mapa PURO de la sensación háptica pedida por la app → constante del sistema.
 * Tres sensaciones (tick / confirm / reject) + tres de gesto (long / gesture / segment). Se usan las constantes de
 * View.HapticFeedbackConstants (lo mismo que el teclado y los botones de Android): respetan el ajuste «Vibración al tocar»
 * del teléfono, no piden permiso y el fabricante las afina. Fallback por nivel de API (minSdk 26; CONFIRM/REJECT 30+;
 * GESTURE_THRESHOLD_ACTIVATE/SEGMENT_TICK 34+). Modo «siempre» (ignora el ajuste del sistema): efectos predefinidos de
 * VibrationEffect (29+). Sin imports de Android: este archivo se prueba en JVM pura (tests/kotlin/HapticKindsTest).
 */
object HapticKinds {
    const val NONE = -1
    // Valores de android.view.HapticFeedbackConstants (copiados para no depender de Android en la JVM)
    const val LONG_PRESS = 0
    const val VIRTUAL_KEY = 1
    const val KEYBOARD_TAP = 3
    const val CLOCK_TICK = 4
    const val CONTEXT_CLICK = 6
    const val CONFIRM = 16
    const val REJECT = 17
    const val GESTURE_THRESHOLD_ACTIVATE = 23
    const val SEGMENT_TICK = 26
    // Valores de android.os.VibrationEffect.EFFECT_* (29+)
    const val EFFECT_CLICK = 0
    const val EFFECT_DOUBLE_CLICK = 1
    const val EFFECT_TICK = 2
    const val EFFECT_HEAVY_CLICK = 5

    val KINDS = listOf("tick", "confirm", "reject", "long", "gesture", "segment")

    /** Constante para View.performHapticFeedback según el nivel de API; NONE si no hay nada razonable. */
    fun constantFor(kind: String, sdk: Int): Int = when (kind) {
        "tick" -> VIRTUAL_KEY
        "confirm" -> if (sdk >= 30) CONFIRM else if (sdk >= 23) CONTEXT_CLICK else KEYBOARD_TAP
        "reject" -> if (sdk >= 30) REJECT else LONG_PRESS // antes de 11: lo más distinto/fuerte que hay
        "long" -> LONG_PRESS
        "gesture" -> if (sdk >= 34) GESTURE_THRESHOLD_ACTIVATE else if (sdk >= 23) CONTEXT_CLICK else KEYBOARD_TAP
        "segment" -> if (sdk >= 34) SEGMENT_TICK else if (sdk >= 21) CLOCK_TICK else NONE
        else -> NONE
    }

    /** Efecto predefinido (VibrationEffect.createPredefined) para el modo «siempre». */
    fun predefinedFor(kind: String): Int = when (kind) {
        "confirm", "long" -> EFFECT_HEAVY_CLICK
        "reject" -> EFFECT_DOUBLE_CLICK
        "gesture", "segment" -> EFFECT_TICK
        else -> EFFECT_CLICK
    }

    /** ¿El modo pedido por la app usa el Vibrator directo (ignora el ajuste del sistema)? Solo «on» y con 29+. */
    fun usesVibrator(mode: String, sdk: Int): Boolean = mode == "on" && sdk >= 29
}
