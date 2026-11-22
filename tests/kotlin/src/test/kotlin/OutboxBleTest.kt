import com.nexo.ble.NetBg
import com.nexo.ble.NetOutbox
import com.nexo.ble.OutboxBle
import org.json.JSONObject
import kotlin.test.*

/**
 * 3269 (PRIORIDAD 1 del dueño, fase 3; COLA 29): la bandeja de salida TAMBIÉN por Bluetooth, con la app dormida, cerrada o sin la app.
 * Sin internet (el metro) el otro aparece por Bluetooth cuando la app ya no corre: lo pendiente para él sale por ese enlace, escrito
 * por el nativo, y su ✓✓ firmada lo retira.
 */
class OutboxBleTest {
    private val A = "nxaaaaaaaa"; private val B = "nxbbbbbbbb"; private val C = "nxcccccccc"
    private val keyA = ByteArray(32) { (it + 1).toByte() }; private val keyC = ByteArray(32) { (it + 7).toByte() }
    private fun p(id: String) = """{"v":1,"type":"chat","from":"$B","msgId":"$id","payload":{"text":"e2:cifrado"},"ss":1,"dn":"$A"}"""
    private class Fake(var clock: Long = 100_000L) : OutboxBle.Link {
        val ready = HashSet<String>(); val sent = ArrayList<String>(); val logs = ArrayList<String>(); var full = false
        override fun ready(mac: String) = mac in ready
        override fun send(mac: String, json: String): Boolean { if (full) return false; sent.add("$mac|" + JSONObject(json).getString("msgId")); return true }
        override fun log(msg: String) { logs.add(msg) }
    }
    private fun rig(vararg ids: String): Triple<NetBg, Fake, OutboxBle> {
        val logs = ArrayList<String>()
        val bg = NetBg({ _, _, _, _, _, _ -> }, { logs.add(it) })
        bg.outboxSet(ids.map { NetOutbox.Item(it, A, p(it), 1_000L) }, "", "")
        val f = Fake()
        return Triple(bg, f, OutboxBle({ B }, { bg }, { if (it == A) keyA else if (it == C) keyC else null }, f) { f.clock })
    }
    private fun ack(id: String, from: String, key: ByteArray?, type: String = "ack") = JSONObject().put("v", 1).put("type", type).put("msgId", id).put("from", from).put("ts", 1)
        .also { if (key != null) it.put("a", NetBg.ackMac(key, "$type|$id|$from|$B")) }.toString()
    private fun ping(from: String) = """{"v":1,"type":"ping","pingId":"p1","ts":1,"fromNexoId":"$from","bf":1}"""

    @Test fun saleLoPendientePorElEnlaceQueLaAppIdentificoYNoSeMartilla() {
        val (bg, f, o) = rig("msg_1", "msg_2")
        o.seed("aa01", A); f.ready.add("aa01")
        assertEquals(2, o.pump())
        assertEquals(listOf("aa01|msg_1", "aa01|msg_2"), f.sent)
        assertTrue(f.logs.any { it.contains("msg_1 para $A sale por Bluetooth sin la app") })
        assertEquals(0, o.pump(), "recién escrito: espera su ✓✓")
        f.clock += 7_999L; assertEquals(0, o.pump())
        f.clock += 1L; assertEquals(2, o.pump(), "sin ✓✓ a los 8 s: otra vez")
        f.clock += 15_999L; assertEquals(0, o.pump()); f.clock += 1L; assertEquals(2, o.pump(), "luego a los 16 s")
        assertEquals(3, bg.outbox.get("msg_1")!!.bleTries)
        assertEquals(8_000L, NetOutbox.bleRetryMs(1)); assertEquals(60_000L, NetOutbox.bleRetryMs(4)); assertEquals(300_000L, NetOutbox.bleRetryMs(30))
    }

    @Test fun sinEnlaceListoNoSeEscribeYConLaColaLlenaSeDejaParaElRepaso() {
        val (bg, f, o) = rig("msg_1")
        o.seed("aa01", A)
        assertEquals(0, o.pump(), "el enlace aún no está listo (sin suscripción)")
        f.ready.add("aa01"); f.full = true
        assertEquals(0, o.pump(), "cola llena: no cuenta como intento")
        assertEquals(0, bg.outbox.get("msg_1")!!.bleTries)
        f.full = false
        assertEquals(1, o.pump())
        o.seed("zz", "no-es-un-id"); o.seed("", A); assertNull(o.nxOf("zz"))
    }

    @Test fun elOtroApareceConLaAppDormidaSuPingDiceQuienEsYSaleYa() {
        val (bg, f, o) = rig("msg_1")
        f.ready.add("bb02")
        assertEquals(0, o.pump(), "enlace de nadie conocido: no se escribe")
        o.heard("bb02", ping(C))
        assertTrue(f.sent.isEmpty(), "el enlace es de C: lo de A no sale por él")
        o.heard("bb03", ping(A)) // aún no listo (sin suscribir)
        assertTrue(f.sent.isEmpty())
        f.ready.add("bb03")
        o.heard("bb03", ping(A))
        assertEquals(listOf("bb03|msg_1"), f.sent, "por el enlace de A, que acaba de hablar")
        // se rehace el enlace (otra dirección): lo suyo sale ya por el nuevo, sin esperar el plazo del anterior
        f.ready.add("bb04")
        o.heard("bb04", """{"v":1,"type":"kx","from":"$A","pk":"x","j":1}""")
        assertEquals(listOf("bb03|msg_1", "bb04|msg_1"), f.sent)
        o.heard("bb04", ping(A))
        assertEquals(2, f.sent.size, "el mismo enlace hablando otra vez no adelanta el reintento")
        // el repaso prefiere el enlace más reciente de ese contacto
        f.clock += 20_000L
        assertEquals(1, o.pump()); assertEquals("bb04|msg_1", f.sent.last())
        o.closed("bb04"); f.clock += 40_000L
        assertEquals(1, o.pump()); assertEquals("bb03|msg_1", f.sent.last(), "cerrado el nuevo, queda el otro")
        assertEquals(A, o.nxOf("bb03")); assertNull(o.nxOf("bb04"))
    }

    @Test fun soloLaConfirmacionFirmadaDeSuContactoLoRetira() {
        val (bg, f, o) = rig("msg_1", "msg_2")
        o.seed("aa01", A); f.ready.add("aa01"); o.pump()
        o.heard("aa01", ack("msg_1", A, null)); assertEquals(2, bg.outbox.size(), "sin firma: no")
        o.heard("aa01", ack("msg_1", A, keyC)); assertEquals(2, bg.outbox.size(), "firmada con otra clave: no")
        o.heard("aa01", ack("msg_1", C, keyC)); assertEquals(2, bg.outbox.size(), "otro contacto no confirma lo de A")
        o.heard("aa01", ack("msg_1", A, keyA))
        assertEquals(listOf("msg_2"), bg.outbox.ids(), "✓✓ firmada de A: fuera")
        o.heard("aa01", ack("msg_2", A, keyA, "read_receipt"))
        assertEquals(0, bg.outbox.size(), "el «leído» firmado también")
        assertNull(OutboxBle.signedReceipt(ack("msg_1", "nxdddddddd", null), B) { null }, "contacto sin clave: decide la app al volver")
        assertNull(OutboxBle.signedReceipt(ack("msg_1", A, keyA), "") { keyA }, "sin mi ID no se puede comprobar")
        assertEquals(A to "msg_1", OutboxBle.signedReceipt(ack("msg_1", A, keyA), B) { keyA })
    }

    @Test fun deQuienEsElEnlace() {
        assertEquals(A, NetOutbox.linkNxOf(ping(A))); assertEquals(A, NetOutbox.linkNxOf("""{"type":"pong","fromNexoId":"${A.uppercase()}"}"""))
        assertEquals(A, NetOutbox.linkNxOf("""{"v":1,"type":"kx","from":"$A","pk":"x"}""")); assertEquals(A, NetOutbox.linkNxOf(ack("m", A, null)))
        assertNull(NetOutbox.linkNxOf("""{"type":"chat","from":"$A","msgId":"m"}"""), "un mensaje puede venir de paso por un puente: no identifica el enlace")
        assertNull(NetOutbox.linkNxOf("""{"type":"ping","fromNexoId":"alguien"}""")); assertNull(NetOutbox.linkNxOf("basura")); assertNull(NetOutbox.linkNxOf("{" + "x".repeat(7000)))
    }
}
