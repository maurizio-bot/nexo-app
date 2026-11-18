import com.nexo.ble.NetBg
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// 3234 (diagnóstico del dueño 17-11: «internet al abrir el chat» 20 s de media, de 5 a 33 s): el saludo que se manda al abrir un chat
// lo contestaba solo la app del otro teléfono, y dormida tardaba en despertar. Ahora lo contesta ya su parte nativa (NetBg).
class NetBgSaludoTest {
    private val now = 1_000_000_000L

    @Test fun contestaUnSaludoRecienteDeUnContactoNuevo() {
        assertTrue(NetBg.helloReplyDue(now, now - 2_000, 0L, false))
    }

    @Test fun noContestaUnaRespuesta() {
        // dos teléfonos dormidos no se saludan sin fin: lo marcado como respuesta (r:1) no se contesta
        assertFalse(NetBg.helloReplyDue(now, now - 2_000, 0L, true))
    }

    @Test fun noContestaUnSaludoViejo() {
        // lo guardado en el relé de hace rato no dice que esté en línea (como UP_MS de la app)
        assertFalse(NetBg.helloReplyDue(now, now - 200_000, 0L, false))
        assertFalse(NetBg.helloReplyDue(now, 0L, 0L, false))
    }

    @Test fun comoMuchoUnaRespuestaCada20Segundos() {
        assertFalse(NetBg.helloReplyDue(now, now - 1_000, now - 5_000, false))
        assertTrue(NetBg.helloReplyDue(now, now - 1_000, now - 20_000, false))
    }

    @Test fun relojAdelantadoDelOtroNoLoImpide() {
        // la app compara igual (now - t < UP_MS): un reloj unos segundos adelantado no tira el saludo
        assertTrue(NetBg.helloReplyDue(now, now + 4_000, 0L, false))
    }
}
