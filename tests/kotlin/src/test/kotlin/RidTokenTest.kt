import com.nexo.ble.RidToken
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// ID Bluetooth rotativo: el código nativo debe ser idéntico al de la app (src/ui/ble_rid.js, vectores sacados de él)
class RidTokenTest {
    private val k1 = "05e17562415085791aa48291135ac6b28dea5a6632803c87598b013b5ffbebe7"
    private val k2 = "dc48dfa7dd918f245e6da2b56faac89b94239713ddac95a684172c4f968d602c"

    @Test fun igualQueLaApp() {
        val v = listOf(
            Triple(k1, 0L, "R2az5pypqz"), Triple(k1, 1L, "Rzefmalks2"), Triple(k1, 1999999L, "Rktjuf2tqz"),
            Triple(k1, 2147483647L, "Rlnnhd6tlr"), Triple(k1, 99999999999L, "Rao4a4pdb4"),
            Triple(k2, 0L, "Rmz7zsjvgh"), Triple(k2, 1L, "R4m6saijie"), Triple(k2, 1999999L, "Rwbrzlvlea"),
            Triple(k2, 2147483647L, "Rbnhxqszd4"), Triple(k2, 99999999999L, "Rhslde4vop"))
        v.forEach { (k, e, t) -> assertEquals(t, RidToken.token(k, e), "época $e") }
    }

    @Test fun visibleOCodigo() {
        val now = 1_800_000_000_000L
        assertEquals("NX12345678", RidToken.advertised("NX12345678", k1, now + 1000, now, 900))
        assertEquals("NX12345678", RidToken.advertised("NX12345678", null, 0, now, 900), "sin clave: el NEXO ID como antes")
        val t = RidToken.advertised("NX12345678", k1, 0, now, 900)
        assertEquals(RidToken.token(k1, now / 1000 / 900), t)
        assertTrue(t.startsWith("R") && t.length == 10, "no empieza por NX: las builds anteriores lo ignoran")
    }

    @Test fun cuandoCambia() {
        val epochS = 900L
        val now = 1_800_000_123_456L
        assertEquals(5000L, RidToken.nextChangeMs(k1, now + 5000, now, epochS), "al terminar la visibilidad")
        val next = RidToken.nextChangeMs(k1, 0, now, epochS)
        assertTrue(next in 1..epochS * 1000)
        assertEquals(RidToken.epoch(now, epochS) + 1, RidToken.epoch(now + next, epochS))
        assertEquals(-1L, RidToken.nextChangeMs(null, 0, now, epochS))
    }
}
