import com.nexo.ble.BgNotifyPolicy
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// 3086 (diagnósticos S24 08:09 y vivo 08:49 del 14-11: dos textos sin confirmar 40 min con el chat abierto y la app dormida)
class BgNotifyPolicyTest {
    @Test fun chatAbiertoSoloCallaEnUnParpadeo() {
        assertTrue(BgNotifyPolicy.silentForOpenChat(true, 0), "recién a segundo plano con su chat abierto: no se avisa")
        assertTrue(BgNotifyPolicy.silentForOpenChat(true, 14999))
        assertFalse(BgNotifyPolicy.silentForOpenChat(true, 15000), "pasado el parpadeo, nadie lo está leyendo: se avisa")
        assertFalse(BgNotifyPolicy.silentForOpenChat(true, 40 * 60 * 1000L), "el vivo: 40 min dormido con el chat abierto")
        assertFalse(BgNotifyPolicy.silentForOpenChat(false, 0), "otro chat: se avisa siempre")
        assertFalse(BgNotifyPolicy.silentForOpenChat(true, -5), "reloj raro: mejor avisar")
    }
}
