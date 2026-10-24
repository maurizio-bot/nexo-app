import com.nexo.ble.BgInbox
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// Recibir con la app cerrada: qué se guarda, qué se confirma y qué se avisa (BgInbox.kt)
class BgInboxTest {
    private val chat = """{"v":1,"type":"chat","from":"NX12345678","to":"","ts":1,"seq":3,"msgId":"msg_1","payload":{"text":"E2:abc"},"ss":1,"nt":1}"""

    @Test fun clasifica() {
        val m = BgInbox.classify(chat)
        assertEquals(BgInbox.Kind.MESSAGE, m.kind); assertEquals("nx12345678", m.from); assertEquals("msg_1", m.msgId); assertFalse(m.quiet)
        assertTrue(BgInbox.classify(chat.replace("\"nt\":1", "\"nt\":1,\"q\":1")).quiet, "acción oculta: sin aviso")
        assertTrue(BgInbox.classify(chat.replace("\"nt\":1", "\"nt\":1,\"cl\":1")).call, "oferta de llamada: aviso de llamada")
        assertFalse(m.call)
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify(chat.replace("\"to\":\"\"", "\"to\":\"nx99999999\"")).kind, "de paso para otro (Jump): no")
        assertEquals(BgInbox.Kind.RECEIPT, BgInbox.classify("""{"v":1,"type":"ack","msgId":"m9","from":"nx12345678","ts":1}""").kind)
        assertEquals(BgInbox.Kind.RECEIPT, BgInbox.classify("""{"v":1,"type":"read_receipt","msgId":"m9","from":"nx12345678"}""").kind)
        val c0 = BgInbox.classify("""{"v":2,"t":"f","m":"f1","i":0,"n":9,"d":"x","fr":"NX12345678","tp":"image","k":"a"}""")
        assertEquals(BgInbox.Kind.NOTIFY_ONLY, c0.kind); assertEquals("image", c0.what)
        assertEquals("call", BgInbox.classify("""{"v":2,"t":"c","m":"cs1","i":0,"n":3,"d":"x","fr":"NX12345678","cl":1,"k":"a"}""").what, "oferta de llamada troceada")
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify("""{"v":2,"t":"f","m":"f1","i":3,"n":9,"d":"x","k":"a"}""").kind, "trozo intermedio")
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify("""{"v":2,"t":"c","m":"c1","i":0,"n":2,"d":"x","fr":"sx:abc","k":"a"}""").kind, "remitente sellado")
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify("""{"v":1,"type":"kx","from":"nx12345678","pk":"x"}""").kind)
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify("no es json").kind)
    }

    // Ronda 2764 (informe del dueño: lo de la tablet para el S24 sonaba y avisaba en el Vivo): lo que dice ir a otro
    // ('dn') no avisa, no suena y no va al buzón (ni ✓✓)
    @Test fun paraOtroTelefonoNada() {
        val me = "NX99999999"
        val paraMi = chat.replace("\"to\":\"\"", "\"to\":\"\",\"dn\":\"nx99999999\"")
        assertEquals(BgInbox.Kind.MESSAGE, BgInbox.classify(paraMi, me).kind, "para mí: como siempre")
        val otro = chat.replace("\"to\":\"\"", "\"to\":\"\",\"dn\":\"nx88888888\",\"cl\":1")
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify(otro, me).kind, "llamada para otro: nada")
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify("""{"v":2,"t":"f","m":"f2","i":0,"n":9,"d":"x","fr":"NX12345678","dn":"nx88888888","tp":"image","k":"a"}""", me).kind, "archivo para otro: nada")
        assertEquals(BgInbox.Kind.NOTIFY_ONLY, BgInbox.classify("""{"v":2,"t":"f","m":"f2","i":0,"n":9,"d":"x","fr":"NX12345678","dn":"nx99999999","tp":"image","k":"a"}""", me).kind)
        assertEquals(BgInbox.Kind.MESSAGE, BgInbox.classify(otro).kind, "sin saber mi NEXO ID: como antes")
    }

    // Ronda 2760: lo que llega por Jump para mí (el puente lo guarda y lo vuelve a mandar): solo aviso
    @Test fun jumpParaMi() {
        val me = "NX99999999"
        val j = BgInbox.classify(chat.replace("\"to\":\"\"", "\"to\":\"nx99999999\""), me)
        assertEquals(BgInbox.Kind.NOTIFY_ONLY, j.kind); assertEquals("nx12345678", j.from); assertEquals("msg_1", j.msgId)
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify(chat.replace("\"to\":\"\"", "\"to\":\"nx88888888\""), me).kind, "para otro: nada")
        val sx = BgInbox.classify("""{"v":1,"type":"sx","to":"nx99999999","msgId":"msg_7","c":"S1:abc"}""", me)
        assertEquals(BgInbox.Kind.NOTIFY_ONLY, sx.kind); assertEquals("", sx.from, "remitente oculto"); assertEquals("msg_7", sx.msgId)
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify("""{"v":1,"type":"sx","to":"nx88888888","msgId":"msg_7","c":"S1:abc"}""", me).kind)
        val f0 = BgInbox.classify("""{"v":2,"t":"f","m":"f2","i":0,"n":9,"d":"x","fr":"sx:abc","dt":"nx99999999","tp":"image","k":"a"}""", me)
        assertEquals(BgInbox.Kind.NOTIFY_ONLY, f0.kind); assertEquals("", f0.from); assertEquals("image", f0.what)
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify("""{"v":2,"t":"f","m":"f2","i":0,"n":9,"d":"x","fr":"sx:abc","dt":"nx99999999","k":"a"}""").kind, "sin mi NEXO ID: como antes")
        // Texto largo oculto (señal de llamada, acción): el primer trozo lleva q:1
        assertTrue(BgInbox.classify("""{"v":2,"t":"c","m":"cs1","i":0,"n":3,"d":"x","fr":"NX12345678","q":1,"k":"a"}""").quiet)
    }

    // Ronda 2763: mensaje de grupo directo: el id del grupo (para poner su nombre en el aviso)
    @Test fun grupo() {
        assertEquals("grabcd1234", BgInbox.classify(chat.replace("\"nt\":1", "\"nt\":1,\"g\":\"grABCD1234\"")).group)
        assertEquals("", BgInbox.classify(chat).group)
        assertEquals("", BgInbox.classify(chat.replace("\"nt\":1", "\"nt\":1,\"g\":\"../x\"")).group, "id raro: no")
    }

    @Test fun guardaYEntregaEnOrden() {
        val f = File.createTempFile("inbox", ".jsonl"); f.delete()
        val box = BgInbox(f)
        val t0 = System.currentTimeMillis()
        assertTrue(box.add("AA:BB", chat))
        assertTrue(box.add("CC:DD", """{"type":"ack","msgId":"m9"}"""))
        val t1 = System.currentTimeMillis()
        assertEquals(2, box.size())
        val got = box.drain()
        assertEquals(listOf("AA:BB" to chat, "CC:DD" to """{"type":"ack","msgId":"m9"}"""), got.map { it.deviceId to it.json })
        assertTrue(got.all { it.ts in t0..t1 }, "con la hora a la que llegó (ronda 2767)")
        assertEquals(0, box.size()); assertTrue(box.drain().isEmpty())
    }

    @Test fun limiteDeTamano() {
        val f = File.createTempFile("inbox", ".jsonl"); f.delete()
        val box = BgInbox(f, maxBytes = 1000)
        var n = 0
        while (box.add("AA", chat)) n++
        assertTrue(n in 2..6, "se para al llenarse ($n)")
        assertTrue(f.length() <= 1000 + chat.length + 64)
    }
}
