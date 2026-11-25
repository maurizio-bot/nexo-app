import com.nexo.ble.NetBg
import kotlin.test.*

// Auditoría 23-11 (S-A2): un evento fechado en el futuro no lleva el `since` de la escucha más allá de ahora
class NetBgSinceTest {
    @Test fun noPasaDeAhora() {
        val now = 1_800_000_000_000L
        assertEquals(now, NetBg.advanceSince(now - 60_000, now + 10L * 365 * 86_400_000, now))
    }
    @Test fun avanzaNormal() {
        val now = 1_800_000_000_000L
        assertEquals(now - 5_000, NetBg.advanceSince(now - 60_000, now - 5_000, now))
    }
    @Test fun noRetrocede() {
        val now = 1_800_000_000_000L
        assertEquals(now - 1_000, NetBg.advanceSince(now - 1_000, now - 90_000, now))
    }
}
