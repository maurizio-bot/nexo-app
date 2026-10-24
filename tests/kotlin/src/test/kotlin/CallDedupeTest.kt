import com.nexo.ble.CallDedupe
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// Ronda 2768: un aviso de llamada por oferta (CallDedupe.kt)
class CallDedupeTest {
    @Test fun unAvisoPorOferta() {
        val d = CallDedupe(120_000)
        assertTrue(d.first("NX12345678", "cs0123456789ab", 1_000), "primera vez: suena")
        // El que llama reenvía el primer trozo cada ~4 s durante 45 s: ninguno vuelve a sonar (tampoco tras "Rechazar")
        for (t in 5_000L..45_000L step 4_000L) assertFalse(d.first("nx12345678", "cs0123456789ab", t), "reenvío a los $t ms")
        assertTrue(d.first("nx12345678", "cs0000000000ff", 50_000), "otra llamada del mismo contacto: suena")
        assertTrue(d.first("nx87654321", "cs0123456789ab", 50_000), "otro contacto: suena")
    }

    @Test fun ventana() {
        val d = CallDedupe(120_000)
        assertTrue(d.first("nx12345678", "cs1", 0))
        assertFalse(d.first("nx12345678", "cs1", 100_000), "dentro de la ventana")
        assertFalse(d.first("nx12345678", "cs1", 219_000), "cada reenvío alarga la ventana")
        assertTrue(d.first("nx12345678", "cs1", 340_000), "pasada la ventana se olvida")
    }

    @Test fun sinOferta() {
        val d = CallDedupe()
        assertTrue(d.first("nx12345678", "", 0))
        assertTrue(d.first("nx12345678", "", 1), "una build anterior de la app no dice la oferta: siempre suena")
    }
}
