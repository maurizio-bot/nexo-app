import com.nexo.ble.AtRestStore
import com.nexo.ble.BgInbox
import com.nexo.ble.MutedChats
import com.nexo.ble.NetBgSaved
import com.nexo.ble.NetBgSaved.Notice
import org.json.JSONArray
import java.io.File
import java.io.IOException
import java.nio.file.Files
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import kotlin.test.*

/**
 * 3219 (dueño 17-11, funciones de WhatsApp dentro del chat): chats y grupos SILENCIADOS con la app cerrada o congelada. La app da la
 * lista con el fin de cada uno (setMutedChats); el aviso nativo de un mensaje de ese chat se calla — por Bluetooth (closedReceive →
 * notifyMessage / notifyOnly, la misma clasificación BgInbox) y por internet (NetBgHome.notifyMessage → NetBgSaved.notice) —, pero las
 * LLAMADAS suenan igual. Se guarda cifrada (AtRestStore) para la escucha de internet sin la app, que la lee la primera vez.
 */
class MutedChatsTest {
    private val A = "nxaaaaaaaa"; private val B = "nxbbbbbbbb"; private val G = "gr12345678"
    private val now = 1_700_000_000_000L
    private val h8 = 8 * 3600_000L
    private fun key(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val dirs = mutableListOf<File>()
    private fun tmp(): File = Files.createTempDirectory("nexo-mute").toFile().also { dirs.add(it) }
    @AfterTest fun limpiar() { dirs.forEach { try { it.deleteRecursively() } catch (e: Exception) { } }; dirs.clear(); MutedChats.clear() }
    private fun app(vararg p: Pair<String, Long>) = JSONArray(p.map { org.json.JSONObject().put("id", it.first).put("until", it.second) })

    // Un mensaje 1-a-1 de A que llega con la app CERRADA (el mismo sobre que clasifica closedReceive)
    private fun chatFrom(nx: String, extra: String = "") = """{"v":1,"type":"chat","from":"${nx.uppercase()}","to":"","ts":1,"seq":3,"msgId":"msg_1","payload":{"text":"E2:abc"},"ss":1,"nt":1$extra}"""
    // La decisión de closedReceive/backgroundNotify: notifyMessage y notifyOnly preguntan esto (PluginBackground.mutedNotice)
    private fun calla(info: BgInbox.Info, groupKnown: Boolean, t: Long = now) = MutedChats.silences(info.call || info.what == "call", info.from, info.group, groupKnown, t)

    // (a) Lo que manda la app: ids de chat válidos, «siempre» = 0, sin los ya vencidos ni lo que no es un chat
    @Test fun loQueMandaLaApp() {
        val m = MutedChats.fromApp(app(A to now + h8, G to 0L, "NXCCCCCCCC" to now + 1, B to now - 1, "nx123" to 0L, "<script>" to 0L, "nxdddddddd" to -5L), now)
        assertEquals(mapOf(A to now + h8, G to 0L, "nxcccccccc" to now + 1), m, "válidos (en minúsculas), sin vencidos ni ids raros")
        assertTrue(MutedChats.fromApp(null, now).isEmpty())
        val muchos = JSONArray((0 until 900).map { org.json.JSONObject().put("id", "nx" + it.toString().padStart(8, '0')).put("until", 0) })
        assertEquals(MutedChats.MAX, MutedChats.fromApp(muchos, now).size, "como mucho MAX")
    }

    // (b) 8 horas / 1 semana vencen solas; «siempre» no
    @Test fun venceSola() {
        MutedChats.set(MutedChats.fromApp(app(A to now + h8, G to 0L), now))
        assertTrue(MutedChats.isMuted(A, now)); assertTrue(MutedChats.isMuted("NXAAAAAAAA", now + h8 - 1))
        assertFalse(MutedChats.isMuted(A, now + h8), "pasadas las 8 horas vuelve a avisar")
        assertTrue(MutedChats.isMuted(G, now + 10 * 365 * 24 * 3600_000L), "siempre")
        assertFalse(MutedChats.isMuted(B, now))
    }

    // (c) Silenciado → SIN aviso con la app cerrada (Bluetooth: la clasificación de BgInbox y la decisión del aviso); la llamada suena
    @Test fun silenciadoSinAvisoConLaAppCerrada() {
        MutedChats.set(MutedChats.fromApp(app(A to now + h8), now))
        val msg = BgInbox.classify(chatFrom(A))
        assertEquals(BgInbox.Kind.MESSAGE, msg.kind); assertEquals(A, msg.from)
        assertTrue(calla(msg, false), "mensaje de A silenciado: sin «Mensaje nuevo»")
        assertFalse(calla(BgInbox.classify(chatFrom(B)), false), "B no está silenciado: avisa")
        val llamada = BgInbox.classify(chatFrom(A, ",\"cl\":1"))
        assertTrue(llamada.call); assertFalse(calla(llamada, false), "la LLAMADA de A suena aunque esté silenciado")
        val trozo = BgInbox.classify("""{"v":2,"t":"f","m":"f1","i":0,"n":9,"d":"x","fr":"NXAAAAAAAA","tp":"image","k":"a"}""")
        assertEquals(BgInbox.Kind.NOTIFY_ONLY, trozo.kind); assertTrue(calla(trozo, false), "una foto de A (primer trozo): sin aviso")
        val trozoLlamada = BgInbox.classify("""{"v":2,"t":"c","m":"cs1","i":0,"n":3,"d":"x","fr":"NXAAAAAAAA","cl":1,"k":"a"}""")
        assertEquals("call", trozoLlamada.what); assertFalse(calla(trozoLlamada, false), "oferta de llamada troceada: suena")
        assertFalse(calla(msg, false, now + h8), "vencido: vuelve a avisar")
        MutedChats.set(emptyMap())
        assertFalse(calla(msg, false), "«Activar sonido»: avisa")
    }

    // (d) Grupos: el aviso sale en el grupo si se conoce su nombre → manda el silencio del GRUPO (no el de quien escribe)
    @Test fun grupos() {
        val enGrupo = BgInbox.classify(chatFrom(A, ",\"g\":\"$G\""))
        assertEquals(G, enGrupo.group)
        MutedChats.set(MutedChats.fromApp(app(G to 0L), now))
        assertTrue(calla(enGrupo, true), "grupo silenciado: sin aviso")
        assertFalse(calla(BgInbox.classify(chatFrom(A)), false), "el 1-a-1 de A sigue avisando")
        MutedChats.set(MutedChats.fromApp(app(A to 0L), now))
        assertFalse(calla(enGrupo, true), "A silenciado no calla un grupo que no lo está (como WhatsApp)")
        assertTrue(calla(enGrupo, false), "sin el nombre del grupo el aviso sale en el chat de A: callado")
    }

    // (e) Internet (NetBgHome.notifyMessage): MUTED sin aviso; la llamada (CALL) va antes y suena
    @Test fun internet() {
        assertEquals(Notice.MUTED, NetBgSaved.notice(false, false, false, false, true))
        assertEquals(Notice.MUTED, NetBgSaved.notice(false, false, false, true, true), "grupo silenciado")
        assertEquals(Notice.CALL, NetBgSaved.notice(true, false, false, false, true), "la llamada suena aunque esté silenciado")
        assertEquals(Notice.OLD, NetBgSaved.notice(false, true, false, false, true))
        assertEquals(Notice.CHAT, NetBgSaved.notice(false, false, false, false), "sin silencio, como siempre (llamada de antes, sin el parámetro)")
        MutedChats.set(MutedChats.fromApp(app(A to now + h8), now))
        assertTrue(MutedChats.silences(false, A, "", false, now)); assertFalse(MutedChats.silences(true, A, "", false, now))
    }

    // (f) Guardado CIFRADO; la escucha sin la app (proceso nuevo) lo lee la primera vez (ensureLoaded); sin archivo: nadie silenciado;
    // un error de lectura (Keystore) no lo da por sabido
    @Test fun guardadoCifradoYSinLaApp() {
        val d = tmp(); val k = key()
        val st = AtRestStore(d) { k }; val w = NetBgSaved.Writer()
        val m = MutedChats.fromApp(app(A to now + h8, G to 0L), now)
        assertTrue(MutedChats.save(st, w, m)); assertFalse(MutedChats.save(st, w, m), "igual: no se reescribe")
        assertTrue(NetBgSaved.isFile(MutedChats.FILE), "como la config de NetBg: no viaja al pasar la cuenta y se borra con ella")
        val f = File(d, MutedChats.FILE)
        assertTrue(AtRestStore.isEncrypted(f.readBytes()), "cifrado en disco")
        val raw = String(f.readBytes(), Charsets.ISO_8859_1)
        for (s in listOf(A, G, "until")) assertFalse(raw.contains(s), "«$s» no está en claro")
        // proceso nuevo, sin la app
        MutedChats.clear(); assertFalse(MutedChats.loaded)
        MutedChats.ensureLoaded({ throw IOException("Keystore no disponible") }, now)
        assertFalse(MutedChats.loaded, "error al leer: se vuelve a intentar")
        MutedChats.ensureLoaded({ AtRestStore(d) { k }.read(MutedChats.FILE) }, now)
        assertTrue(MutedChats.loaded); assertEquals(m, MutedChats.all())
        assertTrue(calla(BgInbox.classify(chatFrom(A)), false), "sin la app también se calla")
        MutedChats.ensureLoaded({ error("no debe volver a leer") }, now)
        // vencidos al leer: fuera
        MutedChats.clear(); MutedChats.ensureLoaded({ AtRestStore(d) { k }.read(MutedChats.FILE) }, now + h8 + 1)
        assertEquals(mapOf(G to 0L), MutedChats.all())
        // sin archivo: nadie silenciado (y ya no se vuelve a leer en cada aviso)
        MutedChats.clear(); MutedChats.ensureLoaded({ AtRestStore(tmp()) { k }.read(MutedChats.FILE) }, now)
        assertTrue(MutedChats.loaded); assertTrue(MutedChats.all().isEmpty())
        assertNull(MutedChats.from("no es json", now)); assertNull(MutedChats.from("{" + "[".repeat(5000), now))
    }
}
