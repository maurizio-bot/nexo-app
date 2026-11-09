import com.nexo.ble.HapticKinds
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * NEXO Touch (build 2968): el mapa puro sensación → constante del sistema por nivel de API. El performHapticFeedback
 * real es Android (compila el APK + prueba del dueño: «¿se siente nítido o zumba?»).
 */
class HapticKindsTest {
    @Test fun tickSiempreEsTeclaVirtual() {
        for (sdk in listOf(26, 29, 30, 33, 34, 35)) assertEquals(HapticKinds.VIRTUAL_KEY, HapticKinds.constantFor("tick", sdk))
    }
    @Test fun confirmYRejectDesdeAndroid11ConFallback() {
        assertEquals(HapticKinds.CONFIRM, HapticKinds.constantFor("confirm", 30))
        assertEquals(HapticKinds.REJECT, HapticKinds.constantFor("reject", 34))
        assertEquals(HapticKinds.CONTEXT_CLICK, HapticKinds.constantFor("confirm", 29))
        assertEquals(HapticKinds.LONG_PRESS, HapticKinds.constantFor("reject", 29))
    }
    @Test fun gestosConFallbackPorApi() {
        assertEquals(HapticKinds.GESTURE_THRESHOLD_ACTIVATE, HapticKinds.constantFor("gesture", 34))
        assertEquals(HapticKinds.CONTEXT_CLICK, HapticKinds.constantFor("gesture", 30))
        assertEquals(HapticKinds.SEGMENT_TICK, HapticKinds.constantFor("segment", 34))
        assertEquals(HapticKinds.CLOCK_TICK, HapticKinds.constantFor("segment", 26))
        assertEquals(HapticKinds.LONG_PRESS, HapticKinds.constantFor("long", 26))
    }
    @Test fun desconocidoNoVibra() {
        assertEquals(HapticKinds.NONE, HapticKinds.constantFor("zumbido", 34))
        assertEquals(HapticKinds.NONE, HapticKinds.constantFor("", 34))
    }
    @Test fun modoSiempreSoloConVibratorDesde29() {
        assertTrue(HapticKinds.usesVibrator("on", 29))
        assertFalse(HapticKinds.usesVibrator("on", 28))
        assertFalse(HapticKinds.usesVibrator("system", 34))
        assertFalse(HapticKinds.usesVibrator("off", 34))
        assertEquals(HapticKinds.EFFECT_CLICK, HapticKinds.predefinedFor("tick"))
        assertEquals(HapticKinds.EFFECT_HEAVY_CLICK, HapticKinds.predefinedFor("confirm"))
        assertEquals(HapticKinds.EFFECT_DOUBLE_CLICK, HapticKinds.predefinedFor("reject"))
        assertEquals(HapticKinds.EFFECT_TICK, HapticKinds.predefinedFor("gesture"))
    }
    @Test fun lasSeisSensacionesTienenConstante() {
        for (k in HapticKinds.KINDS) assertTrue(HapticKinds.constantFor(k, 34) != HapticKinds.NONE, k)
    }
}
