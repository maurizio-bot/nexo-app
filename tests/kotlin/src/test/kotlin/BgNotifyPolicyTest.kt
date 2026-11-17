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

    // 3172 (dueño 17-11, S24 19:57: avisos del chat abierto que llegaban por internet en un parpadeo a segundo plano)
    @Test fun chatAbiertoPorInternetTambienCalla() {
        assertTrue(BgNotifyPolicy.silentFor("nx1e50c95d", "NX1E50C95D", "", 800), "el S23 escribe con su chat abierto y la barra bajada: sin aviso")
        assertTrue(BgNotifyPolicy.silentFor("grp_familia", "nx09acdb61", "grp_familia", 800), "mensaje del grupo abierto: sin aviso")
        assertFalse(BgNotifyPolicy.silentFor("nx1e50c95d", "nx09acdb61", "", 800), "otro chat: se avisa")
        assertFalse(BgNotifyPolicy.silentFor("grp_familia", "nx09acdb61", "grp_trabajo", 800), "otro grupo: se avisa")
        assertFalse(BgNotifyPolicy.silentFor("", "nx1e50c95d", "", 800), "ningún chat abierto: se avisa")
        assertFalse(BgNotifyPolicy.silentFor("nx1e50c95d", "nx1e50c95d", "", 60000), "pantalla apagada un minuto: se avisa")
        assertFalse(BgNotifyPolicy.silentFor("nx1e50c95d", "", "", 800), "remitente vacío no coincide con nada")
    }
}
