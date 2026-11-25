import com.nexo.ble.AtRestStore
import com.nexo.ble.BgInbox
import com.nexo.ble.MutedChats
import com.nexo.ble.NetBgSaved
import org.json.JSONArray
import java.io.File
import java.nio.file.Files
import javax.crypto.KeyGenerator
import kotlin.test.*

/**
 * Bloqueo (dueño 24-11, como WhatsApp): con la app cerrada o congelada, lo que manda un contacto BLOQUEADO fuera de un grupo se ignora
 * (BgInbox.classify → IGNORE: ni buzón, ni aviso, ni llamada, ni ✓✓). Lo de un grupo sigue. Se guarda cifrado con los silenciados.
 */
class BlockedContactsTest {
    private val A = "nxaaaaaaaa"; private val B = "nxbbbbbbbb"; private val G = "gr12345678"
    private val now = 1_700_000_000_000L
    private val dirs = mutableListOf<File>()
    @AfterTest fun limpiar() { dirs.forEach { try { it.deleteRecursively() } catch (e: Exception) { } }; dirs.clear(); MutedChats.clear() }
    private fun chatFrom(nx: String, extra: String = "") = """{"v":1,"type":"chat","from":"${nx.uppercase()}","to":"","ts":1,"seq":3,"msgId":"msg_1","payload":{"text":"E2:abc"},"ss":1,"nt":1$extra}"""

    @Test fun bloqueadoNoEntraNiSuena() {
        MutedChats.set(emptyMap(), MutedChats.blockedFromApp(JSONArray(listOf("NXAAAAAAAA", "nx123", "<b>"))))
        assertEquals(setOf(A), MutedChats.blocked(), "solo NEXO ID válidos, en minúsculas")
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify(chatFrom(A)).kind, "mensaje: ni buzón ni ✓✓")
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify(chatFrom(A, ",\"cl\":1")).kind, "llamada: no suena")
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify("""{"type":"nexo_call","op":"offer","from":"$A","id":"cs0123456789ab"}""").kind, "oferta cruda: no suena")
        assertEquals(BgInbox.Kind.MESSAGE, BgInbox.classify(chatFrom(B)).kind, "otro contacto: como siempre")
        assertEquals(BgInbox.Kind.MESSAGE, BgInbox.classify(chatFrom(A, ",\"g\":\"$G\"")).kind, "en un grupo se le sigue viendo")
        assertEquals(BgInbox.Kind.NOTIFY_ONLY, BgInbox.classify("""{"type":"nexo_gcall","op":"invite","from":"$A","gid":"abcdef123"}""").kind, "llamada de grupo: sigue")
        assertEquals(BgInbox.Kind.RECEIPT, BgInbox.classify("""{"type":"ack","msgId":"m1","from":"$A"}""").kind, "el ✓✓ de lo mío se guarda")
        MutedChats.set(emptyMap(), emptySet())
        assertEquals(BgInbox.Kind.MESSAGE, BgInbox.classify(chatFrom(A)).kind, "desbloqueado: entra otra vez")
    }

    @Test fun guardadoCifradoConLosSilenciados() {
        val d = Files.createTempDirectory("nexo-blk").toFile().also { dirs.add(it) }
        val k = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val st = AtRestStore(d) { k }; val w = NetBgSaved.Writer()
        val m = mapOf(G to 0L)
        assertTrue(MutedChats.save(st, w, m, setOf(A)))
        val raw = String(File(d, MutedChats.FILE).readBytes(), Charsets.ISO_8859_1)
        assertFalse(raw.contains(A), "el bloqueado no está en claro")
        MutedChats.clear()
        MutedChats.ensureLoaded({ AtRestStore(d) { k }.read(MutedChats.FILE) }, now)
        assertEquals(m, MutedChats.all()); assertEquals(setOf(A), MutedChats.blocked())
        assertTrue(MutedChats.isBlocked("NXAAAAAAAA"))
        // un archivo viejo (sin «blocked»): nadie bloqueado
        assertTrue(MutedChats.blockedFrom("""{"v":1,"chats":[]}""").isEmpty())
        assertTrue(MutedChats.blockedFrom("no es json").isEmpty())
    }
}
