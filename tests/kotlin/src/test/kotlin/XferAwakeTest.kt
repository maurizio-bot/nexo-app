import com.nexo.ble.XferAwake
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse

// Lógica PURA de "mantener despierto al que RECIBE durante una transferencia GRANDE por internet" (paso 2b del envío
// de 25 MB a alguien lejos, #dueño 06-11). NO se activa todavía (es el andamiaje del paso 2b; el servicio en primer
// plano / wakelock REALES se compilan y validan en los teléfonos). Acá se prueba solo la LÓGICA de control.
class XferAwakeTest {

    @Test fun soloGrandePorInternet() {
        // grande + internet + archivo → sí
        assertTrue(XferAwake.isBigNetReceive(true, true, XferAwake.MIN_BIG_CHUNKS + 1))
        // chico (≤ umbral) → no (sigue por relés, no hace falta despertar)
        assertFalse(XferAwake.isBigNetReceive(true, true, XferAwake.MIN_BIG_CHUNKS))
        // no es por internet (Bluetooth) → no (otro camino)
        assertFalse(XferAwake.isBigNetReceive(false, true, XferAwake.MIN_BIG_CHUNKS + 1))
        // no es archivo (un texto) → no
        assertFalse(XferAwake.isBigNetReceive(true, false, XferAwake.MIN_BIG_CHUNKS + 1))
    }

    @Test fun tomarSoloSiHayGrandeYNoLoTenemos() {
        assertTrue(XferAwake.shouldAcquire(true, false))    // grande activa, no tomado → tomar
        assertFalse(XferAwake.shouldAcquire(true, true))    // ya tomado → no re-tomar
        assertFalse(XferAwake.shouldAcquire(false, false))  // nada grande → no tomar
    }

    @Test fun noSueltaSiNoLoTenemos() {
        assertFalse(XferAwake.shouldRelease(false, false, 0L, 0L, 999_999L))
    }

    @Test fun sueltaAlCompletarse() {
        // completa → soltar, aunque recién haya habido avance
        assertTrue(XferAwake.shouldRelease(true, true, 1000L, 1000L, 1500L))
    }

    @Test fun sueltaSiMurioPorInactividad() {
        val held = 1000L
        // sin avance durante el TTL → la transferencia murió, soltar
        assertTrue(XferAwake.shouldRelease(true, false, held, held, held + XferAwake.IDLE_TTL_MS))
        // un ms antes del TTL → todavía no
        assertFalse(XferAwake.shouldRelease(true, false, held, held, held + XferAwake.IDLE_TTL_MS - 1))
    }

    @Test fun sueltaPorTopeDuroAunqueSigaAvanzando() {
        // avanzando (lastProgress reciente) pero ya pasó el tope duro desde que se tomó → soltar igual (seguridad batería)
        val heldSince = 1000L
        val now = heldSince + XferAwake.MAX_HOLD_MS
        assertTrue(XferAwake.shouldRelease(true, false, now, heldSince, now))
        // un ms antes del tope duro, y con avance reciente → no soltar todavía
        assertFalse(XferAwake.shouldRelease(true, false, now - 1, heldSince, now - 1))
    }

    @Test fun chequeoAcotado() {
        // sin avance aún → espera el TTL, acotado a POLL
        assertEquals(XferAwake.POLL_MS, XferAwake.nextCheckMs(0L, 0L))
        // falta poco para el TTL (menos que POLL) → ese poco
        val now = 1000L + XferAwake.IDLE_TTL_MS - 2000L
        assertEquals(2000L, XferAwake.nextCheckMs(1000L, now))
        // ya pasó el TTL → 1 (nunca negativo ni 0)
        assertEquals(1L, XferAwake.nextCheckMs(1000L, 1000L + XferAwake.IDLE_TTL_MS + 50L))
    }
}
