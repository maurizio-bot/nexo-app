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

    // #129 (dueño 08-11, diagnóstico del 2960): tras N mensajes SEGUIDOS descartados al mismo enlace (atasco real), se
    // suelta TODA la cola de ese MAC de una, en vez de moler cada mensaje ~6 s (el martilleo de ~2 min del diagnóstico).
    @Test fun noSueltaLaColaPorUnSoloDescarte() {
        // Un solo descarte es congestión transitoria normal de MTU 23 (el siguiente mensaje puede salir bien): NO vaciar.
        assertFalse(WriteRetry.shouldFlushStuckQueue(0), "sin descartes no se vacía")
        assertFalse(WriteRetry.shouldFlushStuckQueue(1), "con un solo descarte seguido no se vacía (podría ser transitorio)")
    }

    @Test fun sueltaLaColaConEnlaceAtascadoDeVerdad() {
        // Dos (o más) mensajes seguidos descartados sin ninguno que salga en medio = el enlace está atascado → vaciar la cola.
        assertTrue(WriteRetry.shouldFlushStuckQueue(WriteRetry.FLUSH_AFTER_DROPS), "en el tope de descartes seguidos se vacía")
        assertTrue(WriteRetry.shouldFlushStuckQueue(WriteRetry.FLUSH_AFTER_DROPS + 3), "por encima del tope también")
        assertEquals(2, WriteRetry.FLUSH_AFTER_DROPS, "el tope es 2 (no 1): no reaccionar a una congestión de un solo mensaje")
    }

    // 3059 (diagnóstico del Motorola 13-11 07:39): por el enlace CLIENTE no se escribe mientras se negocia el MTU (Android hace una
    // operación GATT a la vez: una escritura 19 ms después del MTU dejó el enlace «ocupado» 5 s y se cayó)
    @Test fun esperaAlMtuSoloPorElEnlaceCliente() {
        assertTrue(WriteRetry.waitForClientSetup(viaClient = true, setupDone = false, waitedMs = 0), "cliente sin MTU/notificaciones: espera")
        assertTrue(WriteRetry.waitForClientSetup(true, false, WriteRetry.SETUP_WAIT_MAX_MS - 1), "aún dentro del plazo: espera")
        assertFalse(WriteRetry.waitForClientSetup(true, true, 0), "ya hecho: escribe")
        assertFalse(WriteRetry.waitForClientSetup(false, false, 0), "por el lado servidor (notify) no espera")
        assertFalse(WriteRetry.waitForClientSetup(true, false, WriteRetry.SETUP_WAIT_MAX_MS), "pasado el plazo escribe igual (no se atasca)")
        assertTrue(WriteRetry.SETUP_WAIT_MAX_MS > 2000, "el plazo cubre los 2 s que el plugin espera al MTU antes de seguir")
    }

    // 3262 (COLA 15; Motorola→S24 20-11 14:09): con «ocupado» (201) no se prueba la escritura con respuesta (daría el mismo 201 y, si
    // entra, deja el enlace hasta 30 s esperando a una app que puede estar congelada); con otros fallos se mantiene como estaba
    @Test fun conOcupadoNoSePruebaDefault() {
        assertFalse(WriteRetry.fallbackToDefault(WriteRetry.GATT_BUSY), "201 = ocupado: se espera, no se prueba DEFAULT")
        assertEquals(201, WriteRetry.GATT_BUSY, "ERROR_GATT_WRITE_REQUEST_BUSY de Android")
        assertTrue(WriteRetry.fallbackToDefault(200), "otro fallo (200, no permitido): se prueba DEFAULT como antes")
        assertTrue(WriteRetry.fallbackToDefault(133), "error genérico: como antes")
    }

    // 3262 (COLA 15): el enlace por el que no sale nada en ~12 s (dos mensajes seguidos descartados) se cierra para rehacerlo;
    // una congestión de un solo mensaje NO lo cierra
    @Test fun enlaceAtascadoSeCierra_unaCongestionNo() {
        assertFalse(WriteRetry.shouldCloseStuckLink(0))
        assertFalse(WriteRetry.shouldCloseStuckLink(1), "un solo mensaje descartado puede ser congestión normal de MTU 23")
        assertTrue(WriteRetry.shouldCloseStuckLink(WriteRetry.FLUSH_AFTER_DROPS), "al soltar la cola por atasco se cierra el enlace")
        assertTrue(2 * WriteRetry.maxWaitMs() >= 10000, "son al menos ~10 s sin una sola escritura buena")
    }
}
