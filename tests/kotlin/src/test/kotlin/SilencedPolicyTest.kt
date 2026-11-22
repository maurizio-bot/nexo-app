import com.nexo.ble.SilencedPolicy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// COLA 22 (22-11): «tu teléfono silencia a NEXO»: canales de avisos apagados o sin sonido y «No molestar»
class SilencedPolicyTest {
    @Test fun canalSanoNoDiceNada() {
        assertEquals("ok", SilencedPolicy.channelState(4, true, false, false))
        assertEquals("ok", SilencedPolicy.channelState(4, true, false, true))
        assertEquals("ok", SilencedPolicy.channelState(3, true, false, false), "mensajes con sonido sin ventana: llegan bien")
        assertEquals("ok", SilencedPolicy.channelState(-1, false, false, false), "canal que aún no existe")
    }
    @Test fun canalApagadoOSilenciado() {
        assertEquals("off", SilencedPolicy.channelState(0, true, false, false))
        assertEquals("off", SilencedPolicy.channelState(4, true, true, false), "el grupo del canal bloqueado")
        assertEquals("quiet", SilencedPolicy.channelState(2, true, false, false), "importancia baja: sin sonido")
        assertEquals("quiet", SilencedPolicy.channelState(4, false, false, false), "sin sonido elegido")
        assertEquals("quiet", SilencedPolicy.channelState(3, true, false, true), "llamadas sin ventana")
    }
    @Test fun noMolestar() {
        assertTrue(!SilencedPolicy.dndActive(1)); assertTrue(!SilencedPolicy.dndActive(0))
        assertTrue(SilencedPolicy.dndActive(2)); assertTrue(SilencedPolicy.dndActive(3)); assertTrue(SilencedPolicy.dndActive(4))
        assertEquals("total", SilencedPolicy.dndKind(3)); assertEquals("total", SilencedPolicy.dndKind(4))
        assertEquals("priority", SilencedPolicy.dndKind(2)); assertEquals("none", SilencedPolicy.dndKind(1))
        assertTrue(!SilencedPolicy.dndSilences(3, true), "canal que se salta el DND")
    }
    @Test fun listaDeProblemas() {
        assertEquals(emptyList(), SilencedPolicy.issues("ok", "ok", 1, false, false))
        assertEquals(listOf("msg_off", "call_quiet", "dnd_priority"), SilencedPolicy.issues("off", "quiet", 2, false, false))
        assertEquals(listOf("dnd_total"), SilencedPolicy.issues("ok", "ok", 4, false, false))
        assertEquals(emptyList(), SilencedPolicy.issues("ok", "ok", 3, true, true), "ambos canales saltan el DND")
        assertEquals(listOf("dnd_total"), SilencedPolicy.issues("ok", "ok", 3, true, false), "solo uno salta el DND: se avisa")
    }
}
