import com.nexo.ble.WriteRetry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * B1 (dueño 03-11): una escritura BLE rechazada por el stack (congestión de MTU 23) se reintenta más tiempo que los
 * ~1,8 s de antes (que perdían el mensaje). Dueño 04-11: se bajó de ~9 s a ~6 s («bajá los 9 s al tiempo real del BT»);
 * rendirse ya NO pierde, porque la capa de arriba re-rutea a internet (onWriteDropped). Prueba la decisión PURA
 * (WriteRetry); el resto de processWriteQueue es Android y se comprueba compilando el APK + prueba del dueño.
 */
class WriteRetryTest {
    @Test fun noSeRindeAntesDeTiempo() {
        // Antes se descartaba a los 40 intentos (~1,8 s). Ahora al intento 40 TODAVÍA reintenta (no descarta): sin regresión B1.
        assertFalse(WriteRetry.decide(40).drop, "al intento 40 no debe descartar (antes sí: regresión B1)")
        assertFalse(WriteRetry.decide(WriteRetry.MAX_ATTEMPTS - 1).drop, "justo antes del tope sigue reintentando")
    }

    @Test fun seRindeEnElTope() {
        assertTrue(WriteRetry.decide(WriteRetry.MAX_ATTEMPTS).drop, "en el tope descarta el mensaje entero")
        assertTrue(WriteRetry.decide(WriteRetry.MAX_ATTEMPTS + 5).drop)
    }

    @Test fun elRitmoSeEspacia() {
        // Primeros muy seguidos, luego medio, luego lento (menos radio/batería en la cola larga)
        assertEquals(WriteRetry.FAST_DELAY_MS, WriteRetry.decide(1).delayMs)
        assertEquals(WriteRetry.FAST_DELAY_MS, WriteRetry.decide(4).delayMs)
        assertEquals(WriteRetry.MID_DELAY_MS, WriteRetry.decide(5).delayMs)
        assertEquals(WriteRetry.MID_DELAY_MS, WriteRetry.decide(24).delayMs)
        assertEquals(WriteRetry.SLOW_DELAY_MS, WriteRetry.decide(25).delayMs)
        assertEquals(WriteRetry.SLOW_DELAY_MS, WriteRetry.decide(WriteRetry.MAX_ATTEMPTS - 1).delayMs)
    }

    @Test fun elPresupuestoEsMuchoMasQueAntes() {
        // El fallo original: se rendía a ~1,8 s. Ahora el presupuesto ronda ~6 s (dueño 04-11): mucho más que 1,8 s
        // (aguanta una ráfaga de congestión de MTU 23 sin perder) pero sin esperar los ~9 s de antes; y rendirse re-rutea.
        val wait = WriteRetry.maxWaitMs()
        assertTrue(wait in 5000..7500, "el presupuesto de reintentos debe rondar ~6 s, fue $wait ms")
        assertTrue(wait > 3 * 1800, "debe ser mucho mayor que los ~1,8 s de antes")
    }
}
