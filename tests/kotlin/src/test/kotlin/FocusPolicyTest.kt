import com.nexo.ble.FocusPolicy
import kotlin.test.*

/**
 * 3278 (dueño 22-11: en miniatura «la videollamada debe seguir… el vídeo no se debe interrumpir ni ir a pausa; las dos cosas deben
 * poder correr al mismo tiempo»): SOLO una llamada telefónica retiene la llamada NEXO; otra app que toma el audio, no.
 * Contraprueba: con la regla anterior (3226: pérdida pasajera → retener; permanente → volver a pedir el foco y, si la otra app
 * insiste antes de 10 s, retener) fallan r1, r3 y r4.
 */
class FocusPolicyTest {
    private val IN_COMMUNICATION = 3; private val IN_CALL = 2; private val RINGTONE = 1; private val NORMAL = 0

    @Test fun r1_otraAppTomaElAudioParaSiempre_laLlamadaSigue_sinQuitarselo() {
        assertEquals(FocusPolicy.KEEP, FocusPolicy.onLoss(-1, IN_COMMUNICATION))
        assertEquals(FocusPolicy.KEEP, FocusPolicy.onLoss(-1, NORMAL))
    }
    @Test fun r2_llamadaTelefonica_retiene() {
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onLoss(-1, IN_CALL))
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onLoss(-1, RINGTONE))
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onLoss(-2, IN_CALL))
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onLoss(-2, RINGTONE))
    }
    @Test fun r3_perdidaPasajeraDeOtraApp_unAvisoUnVideoCorto_laLlamadaSigue() {
        assertEquals(FocusPolicy.KEEP, FocusPolicy.onLoss(-2, IN_COMMUNICATION))
        assertEquals(FocusPolicy.KEEP, FocusPolicy.onLoss(-3, IN_COMMUNICATION))
    }
    @Test fun r4_laOtraAppInsisteUnaYOtraVez_nuncaSeRetiene() {
        repeat(5) { assertEquals(FocusPolicy.KEEP, FocusPolicy.onLoss(-1, IN_COMMUNICATION)) }
    }
    // El foco se pierde un instante ANTES de que el teléfono pase a «sonando»: el repaso lo ve y retiene
    @Test fun r5_repaso_laLlamadaTelefonicaQueEntraDespuesDeLaPerdida_retiene() {
        assertEquals(FocusPolicy.KEEP, FocusPolicy.onLoss(-2, IN_COMMUNICATION))          // aún sin «sonando»
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onWatch(false, RINGTONE, 0))
        assertEquals(FocusPolicy.NONE, FocusPolicy.onWatch(true, RINGTONE, 0))            // ya retenida: sin repetir
        assertEquals(FocusPolicy.NONE, FocusPolicy.onWatch(true, IN_CALL, 0))
    }
    // Otra app tenía el audio (NEXO sin foco) y entra una llamada telefónica: no hay aviso de pérdida; el repaso retiene
    @Test fun r6_repaso_sinFocoYEntraLlamadaTelefonica_retiene() {
        assertEquals(FocusPolicy.NONE, FocusPolicy.onWatch(false, IN_COMMUNICATION, 5))   // solo otra app sonando: nada
        assertEquals(FocusPolicy.HOLD, FocusPolicy.onWatch(false, IN_CALL, 0))
    }
    // Al terminar la telefónica se reanuda, pero no en el instante entre «sonando» y «en llamada» (el modo pasa un momento por normal)
    @Test fun r7_repaso_reanudaAlTerminarLaTelefonica_sinParpadeo() {
        assertEquals(FocusPolicy.NONE, FocusPolicy.onWatch(true, NORMAL, 1))
        assertEquals(FocusPolicy.RESUME, FocusPolicy.onWatch(true, NORMAL, FocusPolicy.CALM_TICKS))
        assertEquals(FocusPolicy.RESUME, FocusPolicy.onWatch(true, IN_COMMUNICATION, FocusPolicy.CALM_TICKS))
        assertEquals(FocusPolicy.NONE, FocusPolicy.onWatch(false, IN_COMMUNICATION, FocusPolicy.CALM_TICKS)) // no retenida: nada que reanudar
    }
}
