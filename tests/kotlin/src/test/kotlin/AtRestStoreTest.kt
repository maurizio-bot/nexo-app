import com.nexo.ble.AtRestStore
import java.io.File
import java.io.IOException
import java.nio.file.Files
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import kotlin.concurrent.thread
import kotlin.test.*

class AtRestStoreTest {
    private fun key(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private fun tmp(): File = Files.createTempDirectory("nexo-atrest").toFile()

    @Test fun escribeCifradoYLee() {
        val d = tmp(); val k = key(); val s = AtRestStore(d) { k }
        val txt = """{"nombre":"María ñ €","clave":"SECRETO-123"}"""
        s.write("nexo_e2e_identity.json", txt)
        val raw = File(d, "nexo_e2e_identity.json").readBytes()
        assertTrue(AtRestStore.isEncrypted(raw), "en disco debe estar cifrado")
        assertFalse(String(raw, Charsets.ISO_8859_1).contains("SECRETO"), "nada en claro en disco")
        assertEquals(txt, s.read("nexo_e2e_identity.json"))
        assertNull(s.read("no_existe.json"))
    }

    @Test fun leeArchivosAntiguosEnClaroYLosMigra() {
        val d = tmp(); val k = key(); val s = AtRestStore(d) { k }
        File(d, "nexo_vault_contacts.json").writeText("""[{"a":1}]""")
        File(d, "nexo_att_x.b64").writeText("QUJD")
        File(d, "sub").mkdirs(); File(d, "sub/nexo_otro.json").writeText("sub")
        File(d, "profileinstaller_profileWrittenFor_lastUpdateTime.dat").writeText("lib")
        File(d, "nexo_nxid_mac_map.json").writeText("""{"nx":"mac"}""")
        s.skip = setOf("nexo_nxid_mac_map.json")
        s.migrateOnly = { it.startsWith("nexo_") }
        assertEquals("""[{"a":1}]""", s.read("nexo_vault_contacts.json"))
        assertEquals(2, s.migrateAll())
        assertTrue(AtRestStore.isEncrypted(File(d, "nexo_vault_contacts.json").readBytes()))
        assertTrue(AtRestStore.isEncrypted(File(d, "nexo_att_x.b64").readBytes()))
        assertEquals("""{"nx":"mac"}""", File(d, "nexo_nxid_mac_map.json").readText(), "el mapa nativo queda en claro")
        assertEquals("lib", File(d, "profileinstaller_profileWrittenFor_lastUpdateTime.dat").readText(), "lo de librerías no se toca")
        assertEquals("sub", File(d, "sub/nexo_otro.json").readText(), "subcarpetas no se tocan")
        assertEquals("""[{"a":1}]""", s.read("nexo_vault_contacts.json"))
        assertEquals("QUJD", s.read("nexo_att_x.b64"))
        assertEquals(0, s.migrateAll(), "segunda vez: nada que migrar")
        assertTrue(d.walkTopDown().none { it.name.endsWith(".nxtmp") }, "sin temporales")
    }

    @Test fun sinClaveNoSeSobrescribeLoCifrado() {
        val d = tmp(); val k = key()
        AtRestStore(d) { k }.write("nexo_e2e_identity.json", "identidad")
        val sinClave = AtRestStore(d) { null }
        assertFailsWith<IOException> { sinClave.read("nexo_e2e_identity.json") }
        assertFailsWith<IOException> { sinClave.write("nexo_e2e_identity.json", "otra") }
        assertEquals("identidad", AtRestStore(d) { k }.read("nexo_e2e_identity.json"), "intacto")
        // Archivos nuevos o en claro sí (como antes)
        sinClave.write("nuevo.json", "x"); assertEquals("x", sinClave.read("nuevo.json"))
    }

    @Test fun otraClaveOManipuladoNoSeLee() {
        val d = tmp(); val k = key()
        AtRestStore(d) { k }.write("a.json", "hola")
        assertFailsWith<IOException> { AtRestStore(d) { key() }.read("a.json") }
        val f = File(d, "a.json"); val b = f.readBytes(); b[b.size - 1] = (b[b.size - 1].toInt() xor 1).toByte(); f.writeBytes(b)
        assertFailsWith<IOException> { AtRestStore(d) { k }.read("a.json") }
    }

    @Test fun rutasFueraDelDirectorioRechazadas() {
        val d = tmp(); val s = AtRestStore(d) { key() }
        assertFailsWith<IOException> { s.write("../fuera.json", "x") }
        assertFailsWith<IOException> { s.read("../../etc/passwd") }
    }

    @Test fun migrarMientrasSeGuardaNoPierdeNada() {
        val d = tmp(); val k = key(); val s = AtRestStore(d) { k }
        repeat(200) { File(d, "m$it.json").writeText("viejo $it") }
        val escritor = thread { repeat(200) { s.write("m$it.json", "nuevo $it") } }
        s.migrateAll()
        escritor.join()
        repeat(200) { assertEquals("nuevo $it", s.read("m$it.json"), "m$it: el guardado no se pierde") }
        assertTrue(d.listFiles()!!.all { AtRestStore.isEncrypted(it.readBytes()) })
    }

    @Test fun archivoGrande() {
        val d = tmp(); val k = key(); val s = AtRestStore(d) { k }
        val big = "A".repeat(30_000_000)
        val t0 = System.currentTimeMillis()
        s.write("grande.b64", big)
        val back = s.read("grande.b64")
        println("30 MB: guardar + leer en ${System.currentTimeMillis() - t0} ms")
        assertEquals(big.length, back!!.length); assertEquals(big, back)
    }
}
