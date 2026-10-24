import com.nexo.ble.UnreadBook
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Cuentas de las notificaciones de mensajes (MsgNotifier)
class UnreadBookTest {
    @Test fun cuentaPorChatSinRepetidos() {
        val b = UnreadBook()
        assertTrue(b.add("NXAAAAAAAA", "Ana", "m1", "hola"))
        assertTrue(b.add("nxaaaaaaaa", "Ana", "m2", "¿qué tal?"))
        assertFalse(b.add("nxaaaaaaaa", "Ana", "m1", "hola"), "el mismo mensaje avisado por la app y por segundo plano cuenta una vez")
        assertTrue(b.add("nxbbbbbbbb", "Beto", "m1", ""))
        assertEquals(2, b.get("nxaaaaaaaa")!!.count)
        assertEquals("¿qué tal?", b.get("nxaaaaaaaa")!!.last)
        assertEquals(3, b.total())
    }

    @Test fun laAppMandaAlSincronizar() {
        val b = UnreadBook()
        b.add("nxaaaaaaaa", "Ana", "m1", ""); b.add("nxaaaaaaaa", "Ana", "m2", ""); b.add("nxbbbbbbbb", "Beto", "m9", "")
        val (remove, update) = b.sync(mapOf("nxaaaaaaaa" to 5))
        assertEquals(listOf("nxbbbbbbbb"), remove)
        assertEquals(listOf("nxaaaaaaaa"), update)
        assertEquals(5, b.get("nxaaaaaaaa")!!.count)
        assertNull(b.get("nxbbbbbbbb"))
        assertFalse(b.add("nxaaaaaaaa", "Ana", "m2", ""), "lo ya contado no vuelve a contar tras sincronizar")
        assertTrue(b.add("nxaaaaaaaa", "Ana", "m3", ""))
        assertEquals(6, b.get("nxaaaaaaaa")!!.count)
        val (r2, u2) = b.sync(mapOf("nxaaaaaaaa" to 6))
        assertTrue(r2.isEmpty()); assertEquals(listOf("nxaaaaaaaa"), u2)
    }

    @Test fun abrirElChatLoQuita() {
        val b = UnreadBook()
        b.add("nxaaaaaaaa", "Ana", "m1", "")
        assertTrue(b.clear("NXAAAAAAAA"))
        assertNull(b.get("nxaaaaaaaa"))
        assertEquals(0, b.total())
        assertFalse(b.clear("nxaaaaaaaa"))
    }

    // Ronda 2760: el nativo avisa en segundo plano con quien lo manda; la app, en el grupo: un solo aviso
    @Test fun pasaDeChatSinRepetir() {
        val b = UnreadBook()
        b.add("nxaaaaaaaa", "Ana", "g1", ""); b.add("nxaaaaaaaa", "Ana", "m2", "")
        assertTrue(b.hasMsg("g1")); assertFalse(b.hasMsg("zz"))
        assertEquals(listOf("nxaaaaaaaa"), b.takeFromOthers("grabcdefgh", "g1"))
        assertTrue(b.add("grabcdefgh", "Familia", "g1", "Ana: hola"))
        assertEquals(1, b.get("nxaaaaaaaa")!!.count, "en el chat de Ana queda solo m2")
        assertEquals(1, b.get("grabcdefgh")!!.count)
        assertTrue(b.takeFromOthers("grabcdefgh", "g1").isEmpty(), "ya está en el grupo")
        b.add("nxbbbbbbbb", "Beto", "g2", "")
        assertEquals(listOf("nxbbbbbbbb"), b.takeFromOthers("grabcdefgh", "g2"))
        assertNull(b.get("nxbbbbbbbb"), "sin nada más: fuera (se quita su aviso)")
    }

    @Test fun losRecordadosTienenLimite() {
        val b = UnreadBook(maxSeen = 10)
        for (i in 0 until 20) b.add("nxaaaaaaaa", "Ana", "m$i", "")
        assertTrue(b.add("nxaaaaaaaa", "Ana", "m0", ""), "el más antiguo se olvidó (memoria acotada)")
    }
}
