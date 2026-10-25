import com.nexo.ble.BgInbox
import com.nexo.ble.SafeJson
import kotlin.test.*

// Auditoría (ronda 2774): un JSON ajeno muy anidado podía tumbar la app (el analizador del sistema es recursivo). El
// cribado lo rechaza antes de analizarlo. Aquí se comprueba el cribado y que un paquete así por Bluetooth/Wi-Fi se
// clasifica como "no hacer nada" (no revienta, no avisa, no confirma).
class SafeJsonTest {
    @Test fun rechazaLoMuyAnidado() {
        val hondo = "[".repeat(5000) + "]".repeat(5000)
        assertTrue(SafeJson.reject(hondo), "un JSON con 5000 niveles debe rechazarse")
        assertTrue(SafeJson.reject("{\"a\":".repeat(200) + "1" + "}".repeat(200)))
    }
    @Test fun aceptaLoNormal() {
        assertFalse(SafeJson.reject("""{"v":1,"type":"chat","from":"nx12345678","msgId":"x","payload":{"text":"hola","b2":{"a":{"b":{"c":1}}}}}"""))
        assertFalse(SafeJson.reject("[1,2,3,[4,5,[6]]]"))
        assertFalse(SafeJson.reject(""))
    }
    @Test fun lasLlavesDentroDeTextoNoCuentan() {
        // Mucho "{" pero dentro de una cadena: no es anidamiento real
        assertFalse(SafeJson.reject("{\"t\":\"" + "{".repeat(100000) + "\"}"))
    }
    @Test fun rechazaLoDescomunal() {
        assertTrue(SafeJson.reject("x".repeat(SafeJson.MAX_LEN + 1)))
    }
    @Test fun classifyIgnoraLoMuyAnidado() {
        val hondo = "[".repeat(5000) + "]".repeat(5000)
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify(hondo, "nx99999999").kind)
    }
}
