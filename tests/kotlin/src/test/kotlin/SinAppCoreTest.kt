import com.nexo.ble.BgInbox
import com.nexo.ble.SinAppCore
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// 3254 (Bluetooth en el servicio, fase 1): lo que hace el servicio con lo que llega por Bluetooth SIN la app (SinAppCore.kt)
class SinAppCoreTest {
    private val chat = """{"v":1,"type":"chat","from":"NX12345678","to":"","ts":1,"seq":3,"msgId":"msg_1","payload":{"text":"E2:abc"},"ss":1,"nt":1,"sl":"firma(msg|msg_1|nx12345678|nx00000001)"}"""

    private class Sink : SinAppCore.Sink {
        val sent = mutableListOf<Pair<String, String>>(); val stored = mutableListOf<String>(); val notes = mutableListOf<Pair<String, Boolean>>()
        val ended = mutableListOf<String>(); var full = false; var card: String? = null; var key = true
        override fun send(link: String, json: String) { sent.add(link to json) }
        override fun store(link: String, json: String): Boolean { if (full) return false; stored.add(json); return true }
        override fun notify(info: BgInbox.Info, only: Boolean) { notes.add(info.msgId to only) }
        override fun callEnded(from: String, offer: String) { ended.add("$from|$offer") }
        override fun kxCard(): String? = card
        override fun ackSign(from: String, fields: String): String? = if (key) "firma($fields)" else null
        override fun log(level: String, msg: String) {}
    }
    private var t = 1_000_000L
    private fun core(s: Sink) = SinAppCore("NX00000001", s) { t }
    private fun bytes(x: String) = x.toByteArray(Charsets.UTF_8)

    @Test fun mensajeEntero_alBuzon_confirmaFirmado_yAvisa() {
        val s = Sink(); val c = core(s)
        c.onBytes("aa", bytes(chat))
        assertEquals(listOf(chat), s.stored)
        assertEquals(1, s.sent.size)
        val ack = JSONObject(s.sent[0].second)
        assertEquals("ack", ack.getString("type")); assertEquals("msg_1", ack.getString("msgId")); assertEquals("nx00000001", ack.getString("from"))
        assertEquals("firma(ack|msg_1|nx00000001|nx12345678)", ack.getString("a"))
        assertEquals(listOf("msg_1" to false), s.notes)
        assertEquals(1, c.received)
    }

    @Test fun trozos_seJuntan_porEnlace_sinMezclarse() {
        val s = Sink(); val c = core(s)
        val other = chat.replace("msg_1", "msg_2")
        c.onBytes("aa", bytes(chat.substring(0, 40)))
        c.onBytes("bb", bytes(other.substring(0, 60)))
        c.onBytes("aa", bytes(chat.substring(40)))
        c.onBytes("bb", bytes(other.substring(60)))
        assertEquals(listOf(chat, other), s.stored)
        assertEquals(listOf("aa", "bb"), s.sent.map { it.first })
    }

    @Test fun dosMensajesEnUnaEscritura_yRestoCortadoSeDescarta() {
        val s = Sink(); val c = core(s)
        c.onBytes("aa", bytes(chat + chat.replace("msg_1", "msg_2")))
        assertEquals(2, s.stored.size)
        // un mensaje cortado (se perdió el final) no se traga el siguiente entero (3059)
        c.onBytes("aa", bytes(chat.replace("msg_1", "msg_3").substring(0, 50)))
        c.onBytes("aa", bytes(chat.replace("msg_1", "msg_4")))
        assertEquals(3, s.stored.size); assertTrue(s.stored[2].contains("msg_4"))
        // lo pendiente sin trozos nuevos en 5 s se tira
        c.onBytes("aa", bytes(chat.replace("msg_1", "msg_5").substring(0, 50)))
        t += 6000
        c.onBytes("aa", bytes(chat.replace("msg_1", "msg_6").substring(50)))
        assertEquals(3, s.stored.size)
    }

    @Test fun accionOculta_seGuardaYConfirma_sinAviso_yLlamadaSuena() {
        val s = Sink(); val c = core(s)
        c.onBytes("aa", bytes(chat.replace("\"nt\":1", "\"nt\":1,\"q\":1")))
        assertEquals(1, s.stored.size); assertEquals(1, s.sent.size); assertTrue(s.notes.isEmpty())
        c.onBytes("aa", bytes(chat.replace("msg_1", "msg_c").replace("\"nt\":1", "\"nt\":1,\"cl\":1,\"q\":1")))
        assertEquals(listOf("msg_c" to false), s.notes)
        c.onBytes("aa", bytes(chat.replace("msg_1", "msg_e").replace("\"nt\":1", "\"nt\":1,\"q\":1,\"ce\":\"cs0123456789ab\"")))
        assertEquals(listOf("nx12345678|cs0123456789ab"), s.ended)
    }

    @Test fun buzonLleno_niConfirmaNiAvisa() {
        val s = Sink(); s.full = true; val c = core(s)
        c.onBytes("aa", bytes(chat))
        assertTrue(s.sent.isEmpty()); assertTrue(s.notes.isEmpty()); assertEquals(0, c.received)
    }

    @Test fun sinClave_confirmaSinFirma() {
        val s = Sink(); s.key = false; val c = core(s)
        c.onBytes("aa", bytes(chat))
        assertFalse(JSONObject(s.sent[0].second).has("a"))
    }

    @Test fun ping_contestaPong_yKxConTarjeta_conFreno() {
        val s = Sink(); val c = core(s)
        c.onBytes("aa", bytes("""{"v":1,"type":"ping","pingId":"p1","ts":5}"""))
        val pong = JSONObject(s.sent[0].second)
        assertEquals("pong", pong.getString("type")); assertEquals("p1", pong.getString("pingId")); assertEquals("nx00000001", pong.getString("fromNexoId"))
        val ask = """{"v":1,"type":"kx","from":"nx12345678","pk":"x","rq":1}"""
        c.onBytes("aa", bytes(ask))
        assertEquals(1, s.sent.size, "sin tarjeta guardada no se contesta")
        s.card = """{"type":"kx","from":"nx00000001","pk":"y"}"""
        c.onBytes("aa", bytes(ask)); c.onBytes("aa", bytes(ask))
        assertEquals(2, s.sent.size, "una tarjeta cada 8 s por enlace")
        t += 9000
        c.onBytes("aa", bytes(ask))
        assertEquals(3, s.sent.size)
        assertTrue(s.stored.isEmpty())
    }

    @Test fun confirmaciones_alBuzon_yPrimerTrozoLargo_soloAviso() {
        val s = Sink(); val c = core(s)
        c.onBytes("aa", bytes("""{"v":1,"type":"ack","msgId":"m9","from":"nx12345678","ts":1}"""))
        assertEquals(1, s.stored.size); assertTrue(s.sent.isEmpty()); assertTrue(s.notes.isEmpty())
        c.onBytes("aa", bytes("""{"v":2,"t":"f","m":"f1","i":0,"n":9,"d":"x","fr":"NX12345678","tp":"image","k":"a","sl":"firma(msg|f1|nx12345678|nx00000001)"}"""))
        assertEquals(listOf("f1" to true), s.notes); assertEquals(1, s.stored.size)
        // para otro NEXO (Jump de paso): nada
        c.onBytes("aa", bytes(chat.replace("\"to\":\"\"", "\"to\":\"nx99999999\"")))
        assertEquals(1, s.stored.size); assertEquals(1, s.notes.size)
    }

    @Test fun basura_noRompe_yEnlaceCerradoOlvidaLoPendiente() {
        val s = Sink(); val c = core(s)
        c.onBytes("aa", bytes("no es json }}}{{{ \"\\"))
        c.onBytes("aa", ByteArray(300) { 0x7B })
        c.linkClosed("aa")
        c.onBytes("aa", bytes(chat))
        assertEquals(1, s.stored.size)
        c.onBytes("bb", bytes(chat.substring(0, 30)))
        c.linkClosed("bb")
        c.onBytes("bb", bytes(chat.substring(30)))
        assertEquals(1, s.stored.size)
        assertNull(SinAppCore.extract("   "))
        assertEquals("""{"a":"}{"}""" to "resto", SinAppCore.extract("""xx{"a":"}{"}resto"""))
    }

    // 2A (23-11, auditoría S-A1): de un contacto cuya clave tenemos, un mensaje SIN sello de pareja (o con otro) no entra al buzón, no
    // avisa y no recibe ✓✓ firmada (antes cualquiera cerca pedía la ✓✓ de un msgId visto en el aire y el mensaje se perdía con ✓✓)
    @Test fun sinSello_niBuzonNiAvisoNiConfirmacion() {
        val s = Sink(); val c = core(s)
        val noSeal = chat.replace(""","sl":"firma(msg|msg_1|nx12345678|nx00000001)"""", "")
        c.onBytes("aa", bytes(noSeal))
        val badSeal = chat.replace("firma(msg|msg_1|", "firma(msg|msg_9|")
        c.onBytes("bb", bytes(badSeal))
        assertTrue(s.stored.isEmpty()); assertTrue(s.sent.isEmpty()); assertTrue(s.notes.isEmpty())
    }

    // Sin la clave de ese contacto no se puede comprobar: como antes (buzón y aviso; la ✓✓ va sin firma y el emisor moderno la ignora)
    @Test fun sinClave_comoAntes() {
        val s = Sink(); s.key = false; val c = core(s)
        c.onBytes("aa", bytes(chat.replace(""","sl":"firma(msg|msg_1|nx12345678|nx00000001)"""", "")))
        assertEquals(1, s.stored.size); assertEquals(1, s.notes.size)
    }

    @Test fun sealCheck_casos() {
        val sign = { f: String -> "firma($f)" }
        assertEquals(true, BgInbox.sealCheck(chat, "NX00000001", sign))
        assertEquals(false, BgInbox.sealCheck(chat, "NX00000002", sign))   // para otro
        assertEquals(null, BgInbox.sealCheck(chat, "NX00000001") { null })   // sin clave
        // primer trozo de un texto largo (m / fr)
        val chunk = """{"t":"c","m":"msg_5","i":0,"n":3,"fr":"NX12345678","d":"x","sl":"firma(msg|msg_5|nx12345678|nx00000001)"}"""
        assertEquals(true, BgInbox.sealCheck(chunk, "NX00000001", sign))
    }
}
