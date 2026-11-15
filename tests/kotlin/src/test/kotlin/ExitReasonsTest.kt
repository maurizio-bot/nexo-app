import com.nexo.ble.ExitReasons
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 3120 — Cierres de la app en el diagnóstico (la parte que no depende de Android). La lectura real de
 * getHistoricalProcessExitReasons y el manejador de fallos son Android: compila el APK y lo confirma el diagnóstico del teléfono.
 */
class ExitReasonsTest {
    @Test fun motivosConocidos() {
        assertEquals("FALLO (error en la app)", ExitReasons.label(4))
        assertEquals("CONGELADA (no respondía)", ExitReasons.label(6))
        assertEquals("sin memoria: Android la cerró", ExitReasons.label(3))
        assertEquals("actualización de la app", ExitReasons.label(16))
        assertEquals("cerrada por el usuario (forzar cierre o recientes)", ExitReasons.label(10))
        assertEquals("motivo 99", ExitReasons.label(99))
    }

    @Test fun soloLosFallosSonProblema() {
        listOf(3, 4, 5, 6, 7, 9).forEach { assertTrue(ExitReasons.isProblem(it), "motivo $it") }
        listOf(0, 1, 2, 8, 10, 11, 12, 13, 14, 15, 16).forEach { assertFalse(ExitReasons.isProblem(it), "motivo $it") }
    }

    @Test fun anrSoloElHiloPrincipal() {
        val trace = "----- pid 123 -----\nCmd line: com.nexo.app\n\n\"Signal Catcher\" daemon prio=10\n  at x.y\n\n" +
            "\"main\" prio=5 tid=1 Blocked\n  at com.nexo.ble.PluginGatt.foo(PluginGatt.kt:10)\n  - waiting to lock <0x1>\n" +
            "  at android.os.Handler.dispatch\n\n\"BleWorker\" prio=5\n  at z.w\n"
        val m = ExitReasons.anrMain(trace)
        assertTrue(m.startsWith("\"main\""))
        assertTrue(m.contains("PluginGatt.foo"))
        assertFalse(m.contains("BleWorker"))
        assertFalse(m.contains("Signal Catcher"))
        val corto = ExitReasons.anrMain((1..100).joinToString("\n") { "\"main\" $it" }.let { "\"main\"\n" + (1..100).joinToString("\n") { "  at f$it" } }, 5)
        assertEquals(5, corto.lines().size)
    }

    @Test fun textoDeUnFallo() {
        val ex = IllegalStateException("cola llena " + "x".repeat(500), OutOfMemoryError("Failed to allocate 35 MB"))
        val t = ExitReasons.crashText(ex, "main", 0L)
        assertTrue(t.contains("hilo main: java.lang.IllegalStateException: cola llena"))
        assertTrue(t.contains("…"), "el mensaje largo se recorta")
        assertTrue(t.contains("  Causa: java.lang.OutOfMemoryError: Failed to allocate 35 MB"))
        assertTrue(t.lines().count { it.startsWith("    at ") } <= 12 + 4)
        assertTrue(t.length < 3000)
    }

    @Test fun archivoDeFallosGuardaLosMasRecientes() {
        var file: String? = null
        for (i in 1..40) file = ExitReasons.appendCrash(file, "fallo $i\n" + "    at a.b(c.kt:$i)\n".repeat(10), 2000)
        val f = file!!
        assertTrue(f.length <= 2000)
        assertTrue(f.startsWith("fallo 40\n"), "el más reciente va primero")
        assertTrue(f.contains("fallo 39\n"))
        assertFalse(f.contains("fallo 1\n"))
        assertTrue(f.endsWith("\n"), "se corta entre fallos, no a la mitad de uno")
    }
}
