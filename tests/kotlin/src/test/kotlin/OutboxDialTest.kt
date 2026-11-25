import com.nexo.ble.NetBg
import com.nexo.ble.NetOutbox
import com.nexo.ble.OutboxBle
import com.nexo.ble.OutboxDial
import kotlin.test.*

/**
 * 3271 (PRIORIDAD 1 del dueño, fase 3: conexiones salientes desde el servicio; COLA 29): con los DOS teléfonos dormidos nadie abría el
 * enlace Bluetooth. El nativo busca a quien tiene algo pendiente (escaneo corto y filtrado, cada vez más espaciado) y conecta él.
 */
class OutboxDialTest {
    private val A = "nxaaaaaaaa"; private val C = "nxcccccccc"

    @Test fun escaneaEnseguidaYLuegoCadaVezMasEspaciado() {
        var t = 1_000_000L
        val d = OutboxDial { t }
        assertFalse(d.scanDue(emptySet()), "nada pendiente: no se escanea")
        assertFalse(d.scanDue(setOf(A)), "recién aparece: a los 3 s (la app aún puede estar despierta)")
        t += OutboxDial.FIRST_MS - 1; assertFalse(d.scanDue(setOf(A)))
        t += 1; assertTrue(d.scanDue(setOf(A)), "primer escaneo")
        assertFalse(d.scanDue(setOf(A)), "en marcha: no se pide otro")
        t += OutboxDial.SCAN_MS + 20_000L - 1; assertFalse(d.scanDue(setOf(A)))
        t += 1; assertTrue(d.scanDue(setOf(A)), "el segundo, 20 s después de terminar el primero")
        t += OutboxDial.SCAN_MS + 40_000L; assertTrue(d.scanDue(setOf(A)), "luego 40 s")
        t += OutboxDial.SCAN_MS + 80_000L; assertTrue(d.scanDue(setOf(A)))
        assertEquals(listOf(20_000L, 40_000L, 80_000L, 160_000L, 300_000L, 300_000L), (1..6).map { OutboxDial.gapMs(it) }, "tope: cada 5 min")
        // alguien nuevo a quien buscar: se empieza de cero (enseguida)
        assertFalse(d.scanDue(setOf(A, C)))
        t += OutboxDial.FIRST_MS; assertTrue(d.scanDue(setOf(A, C)))
        // ya no hay a quién buscar: el plan se olvida
        assertFalse(d.scanDue(emptySet()))
        assertFalse(d.scanDue(setOf(A))); t += OutboxDial.FIRST_MS; assertTrue(d.scanDue(setOf(A)))
    }

    @Test fun conectaSoloConQuienTieneAlgoPendienteVistoHacePocoYConSitio() {
        var t = 1_000_000L
        val d = OutboxDial { t }
        val seen = mapOf(A to ("aa01" to t - 5_000L), C to ("cc03" to t - 5_000L), "nxdddddddd" to ("dd04" to t - 5_000L))
        assertEquals(listOf(A to "aa01"), d.pick(setOf(A), seen, 0) { false }, "solo a quien se busca")
        assertTrue(d.pick(setOf(A), seen, 0) { false }.isEmpty(), "sin insistir en la misma dirección antes de 30 s")
        t += OutboxDial.RETRY_MAC_MS
        assertEquals(listOf(A to "aa01"), d.pick(setOf(A), mapOf(A to ("aa01" to t - 1_000L)), 0) { false })
        assertTrue(d.pick(setOf(C), mapOf(C to ("cc03" to t - OutboxDial.SEEN_FRESH_MS - 1)), 0) { false }.isEmpty(), "visto hace más de 1 min: ya no dice que esté cerca")
        assertTrue(d.pick(setOf(C), mapOf(C to ("cc03" to t)), 0) { it == "cc03" }.isEmpty(), "ya hay enlace o conexión en curso con esa dirección")
        assertTrue(d.pick(setOf(C), mapOf(C to ("cc03" to t)), OutboxDial.MAX_CLIENT_LINKS) { false }.isEmpty(), "tope de enlaces: no se abre otro")
        assertEquals(listOf(C to "cc03"), d.pick(setOf(C), mapOf(C to ("cc03" to t)), OutboxDial.MAX_CLIENT_LINKS - 1) { false })
        // varios a la vez: hasta llenar el tope
        val d2 = OutboxDial { t }
        val many = (1..9).associate { "nxbbbbbbb$it" to ("m$it" to t) }
        assertEquals(3, d2.pick(many.keys, many, OutboxDial.MAX_CLIENT_LINKS - 3) { false }.size)
    }

    @Test fun aQuienHayQueBuscarEsQuienTieneAlgoPendienteYNingunEnlaceListo() {
        val bg = NetBg({ _, _, _, _, _, _ -> }, { })
        val ready = HashSet<String>()
        val o = OutboxBle({ "nxbbbbbbbb" }, { bg }, { null }, object : OutboxBle.Link {
            override fun ready(mac: String) = mac in ready
            override fun send(mac: String, json: String) = true
            override fun log(msg: String) {}
        })
        assertTrue(o.wanting().isEmpty(), "bandeja vacía")
        bg.outboxSet(listOf(NetOutbox.Item("msg_1", A, "{\"msgId\":\"msg_1\"}", 1L), NetOutbox.Item("msg_2", C, "{\"msgId\":\"msg_2\"}", 1L)), "", "")
        assertEquals(setOf(A, C), o.wanting())
        o.seed("aa01", A)
        assertEquals(setOf(A, C), o.wanting(), "el enlace de A existe pero no está listo")
        ready.add("aa01")
        assertEquals(setOf(C), o.wanting(), "A ya tiene enlace: no se le busca")
        bg.outboxDrop("msg_2")
        assertTrue(o.wanting().isEmpty())
    }
}
