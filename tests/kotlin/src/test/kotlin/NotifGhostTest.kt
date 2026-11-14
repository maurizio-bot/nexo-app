import com.nexo.ble.FcmWakePolicy
import com.nexo.ble.NetBg
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// 3076 (dueño 14-11: «notificaciones fantasmas… mensaje que llegue, notificación que llegue, que no se repita»)
class NotifGhostTest {
    // El toque FCM no trae contenido: no pone «Mensaje nuevo». Solo si el servicio no arrancó queda un aviso neutro.
    @Test fun toqueSinAvisoSalvoQueNoArranqueElServicio() {
        assertFalse(FcmWakePolicy.noticeAfterWake(true), "con el servicio arrancado, el aviso lo pone el mensaje al llegar")
        assertTrue(FcmWakePolicy.noticeAfterWake(false), "sin servicio no baja nada: aviso neutro para abrir NEXO")
    }

    // El aviso de internet en segundo plano de un mensaje de GRUPO cae en el grupo (env.g), no en el chat 1-a-1 del que lo manda
    @Test fun grupoDelSobre() {
        assertEquals("grabcdefgh", NetBg.groupOf("{\"type\":\"chat\",\"msgId\":\"gm1_ab\",\"g\":\"grabcdefgh\"}"))
        assertEquals("grabcdefgh", NetBg.groupOf("{\"type\":\"chat\",\"g\":\"GRABCDEFGH\"}"), "mayúsculas")
        assertEquals("", NetBg.groupOf("{\"type\":\"chat\",\"msgId\":\"m1\"}"), "1-a-1")
        assertEquals("", NetBg.groupOf("{\"type\":\"chat\",\"g\":\"nxabcdefgh\"}"), "un NEXO ID no es un grupo")
        assertEquals("", NetBg.groupOf("{\"g\":\"gr../../x\"}"), "basura")
        assertEquals("", NetBg.groupOf("x"), "no es JSON")
        assertEquals("", NetBg.groupOf(""), "vacío")
        assertEquals("", NetBg.groupOf("{" + "[".repeat(5000)), "JSON descomunal/anidado: ni se analiza")
    }
}
