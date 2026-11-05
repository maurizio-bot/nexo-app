import com.nexo.ble.WdWarm
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse

// Lógica PURA del «grupo Wi-Fi Direct caliente» (política de caminos, paso 2, #dueño 04-11): mantener el grupo armado
// entre transferencias y soltarlo por inactividad. Esto NO se activa todavía (es el andamiaje del paso 2; el I/O real
// —sockets/WifiP2p— se valida en los teléfonos). Acá se prueba solo la LÓGICA de control.
class WdWarmTest {

    @Test fun noSueltaConTransferenciaEnCurso() {
        // inFlight>0 → NO soltar aunque ya haya pasado el TTL (una transferencia está usando el grupo)
        assertFalse(WdWarm.shouldRelease(1000L, 1000L + 100_000L, 1))
    }

    @Test fun noSueltaReciénArmado() {
        // lastActivity<=0: el grupo se armó pero todavía no se usó → no soltar por inactividad
        assertFalse(WdWarm.shouldRelease(0L, 999_999L, 0))
    }

    @Test fun sueltaJustoAlCumplirseElTtl() {
        assertTrue(WdWarm.shouldRelease(1000L, 1000L + WdWarm.IDLE_TTL_MS, 0))
        assertFalse(WdWarm.shouldRelease(1000L, 1000L + WdWarm.IDLE_TTL_MS - 1, 0)) // un ms antes, no
    }

    @Test fun timeoutDeAcceptAcotado() {
        // recién armado: espera el TTL pero acotado a ACCEPT_POLL para poder revisar
        assertEquals(WdWarm.ACCEPT_POLL_MS, WdWarm.nextAcceptTimeoutMs(0L, 0L))
        // falta poco para el TTL → ese poco (menor que ACCEPT_POLL)
        val now = 1000L + WdWarm.IDLE_TTL_MS - 2000L
        assertEquals(2000L, WdWarm.nextAcceptTimeoutMs(1000L, now))
        // ya pasó el TTL → 1 (nunca negativo)
        assertEquals(1L, WdWarm.nextAcceptTimeoutMs(1000L, 1000L + WdWarm.IDLE_TTL_MS + 50L))
    }

    @Test fun cabeceraValida() {
        assertEquals(500L, WdWarm.acceptedLen(true, 500L))
        assertEquals(-1L, WdWarm.acceptedLen(false, 500L))                 // el id no coincide
        assertEquals(-1L, WdWarm.acceptedLen(true, 0L))                    // len 0
        assertEquals(-1L, WdWarm.acceptedLen(true, WdWarm.MAX_BYTES + 1))  // excede el tope
    }

    @Test fun decisionDeArmar() {
        assertTrue(WdWarm.shouldArm(true, false, false))    // BT directo, no vivo, no montando → sí
        assertFalse(WdWarm.shouldArm(false, false, false))  // sin BT directo → no (WD se arma sobre el BT)
        assertFalse(WdWarm.shouldArm(true, true, false))    // ya vivo → no re-armar
        assertFalse(WdWarm.shouldArm(true, false, true))    // ya montando → no duplicar
    }
}
