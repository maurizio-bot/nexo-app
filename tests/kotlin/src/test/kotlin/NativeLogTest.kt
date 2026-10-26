import com.nexo.ble.NativeLog
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse

// Registro nativo persistente (#87, ronda 2785): deja constancia en disco de lo que hace la parte nativa con la app
// cerrada, para que el diagnóstico del dueño lo muestre. Anillo por tamaño: no crece sin fin y conserva lo reciente.
class NativeLogTest {
    private fun tmp(): File = File.createTempFile("nativelog", ".txt").also { it.delete() }

    @Test fun guardaYLee() {
        val f = tmp()
        val log = NativeLog(f)
        log.add("INFO", "NET", "escuchando 2 relés")
        log.add("WARN", "WIFI", "WifiLock tomado")
        val txt = log.read()
        assertTrue(txt.contains("[INFO][NET] escuchando 2 relés"), "guarda la línea con nivel y etiqueta")
        assertTrue(txt.contains("[WARN][WIFI] WifiLock tomado"))
        assertEquals(2, txt.trim().lines().size, "una línea por evento")
    }

    @Test fun sinSaltosDeLinea() {
        val f = tmp()
        val log = NativeLog(f)
        log.add("INFO", "NET", "linea1\nlinea2\r\nlinea3")
        assertEquals(1, log.read().trim().lines().size, "un evento = una sola línea (no rompe el anillo)")
    }

    @Test fun anilloPorTamano() {
        val f = tmp()
        val log = NativeLog(f, maxBytes = 2000)
        for (i in 0 until 500) log.add("INFO", "NET", "evento numero $i con algo de relleno para ocupar")
        val txt = log.read()
        assertTrue(f.length() <= 2000, "no pasa del tope (${f.length()})")
        assertTrue(txt.contains("evento numero 499"), "conserva lo más reciente")
        assertFalse(txt.contains("evento numero 0 "), "tira lo más viejo")
        assertTrue(txt.trim().lines().all { it.contains("[INFO][NET]") }, "ninguna línea queda partida")
    }

    @Test fun lineaSueltaEnormeNoRompe() {
        val f = tmp()
        val log = NativeLog(f, maxBytes = 200)
        log.add("INFO", "NET", "x".repeat(5000))
        log.add("INFO", "NET", "ultima")
        assertTrue(log.read().contains("[INFO][NET] ultima"), "tras una línea gigante sigue registrando")
    }

    @Test fun limpia() {
        val f = tmp()
        val log = NativeLog(f)
        log.add("INFO", "NET", "algo")
        log.clear()
        assertEquals("", log.read(), "vacío tras limpiar")
    }
}
