import com.nexo.ble.FocusPolicy
import kotlin.test.*

/**
 * 3226 (dueño 17-11 22:41): la videollamada quedaba «en pausa» para siempre cuando algo que NO era una llamada telefónica le quitaba
 * el foco de audio de forma permanente (-1). Contraprueba: con la regla de antes (toda pérdida → retener) R1 falla.
 */
class FocusPolicyTest {
    private val now = 1_700_000_000_000L
    private val IN_COMMUNICATION = 3; private val IN_CALL = 2; private val RINGTONE = 1; private val NORMAL = 0

    @Test fun r1_perdidaPermanenteSinLlamadaTelefonica_vuelveAPedirElFoco() {
        assertEquals(FocusPolicy.REGRAB, FocusPolicy.onLoss(-1, IN_COMMUNICATION, 0L, now))
        assertEquals(FocusPolicy.REGRAB, FocusPolicy.onLoss(-1, NORMAL, 0L, now))
    }
    @Test fun r2_llamadaTelefonica_retiene() {
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onLoss(-1, IN_CALL, 0L, now))
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onLoss(-1, RINGTONE, 0L, now))
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onLoss(-2, IN_CALL, 0L, now))
    }
    @Test fun r3_perdidasPasajeras_siguenComoAntes() {
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onLoss(-2, IN_COMMUNICATION, 0L, now))
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onLoss(-3, IN_COMMUNICATION, 0L, now))
    }
    @Test fun r4_otraAppLoQuitaOtraVezEnseguida_retieneSinPelear() {
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onLoss(-1, IN_COMMUNICATION, now - 3_000L, now))
        assertEquals(FocusPolicy.REGRAB, FocusPolicy.onLoss(-1, IN_COMMUNICATION, now - FocusPolicy.REGRAB_GAP_MS, now))
    }
}
