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

    // Cada arranque llama a migrateAll(). Con todo ya cifrado no debe leer los archivos enteros (fotos y vídeos
    // de muchos MB) ni hacer esperar a los guardados pequeños (claves del protocolo 2: van antes de cada envío).
    @Test fun arranqueConTodoCifradoNoBloquea() {
        val d = tmp(); val k = key(); val s = AtRestStore(d) { k }
        val video = "V".repeat(8_000_000)
        repeat(30) { s.write("nexo_att_$it.b64", video) }
        val clave = "R".repeat(70_000)
        s.write("nexo_ratchet.json", clave)
        val lecturas = java.util.concurrent.atomic.AtomicLong()
        s.onRead = { lecturas.addAndGet(it) }
        var esperaMax = 0L
        val t0 = System.nanoTime()
        val mig = thread { s.migrateAll() }
        val guardados = thread { repeat(40) { val a = System.nanoTime(); s.write("nexo_ratchet.json", clave); esperaMax = maxOf(esperaMax, (System.nanoTime() - a) / 1_000_000) } }
        mig.join(); val migMs = (System.nanoTime() - t0) / 1_000_000
        guardados.join()
        println("Arranque con 30 x 8 MB cifrados: migración ${migMs} ms, ${lecturas.get() / 1_000_000} MB leídos; guardado pequeño: espera máx. ${esperaMax} ms")
        assertTrue(lecturas.get() < 1_000_000, "con todo cifrado solo se leen las cabeceras (leídos ${lecturas.get()} bytes)")
        assertEquals(clave, s.read("nexo_ratchet.json"))
    }

    // Migrar un archivo grande no debe hacer esperar a los guardados de otros archivos
    @Test fun migrarArchivoGrandeNoBloqueaOtros() {
        val d = tmp(); val k = key(); val s = AtRestStore(d) { k }
        repeat(6) { File(d, "nexo_att_$it.b64").writeText("V".repeat(20_000_000)) }
        val clave = "R".repeat(70_000)
        var esperaMax = 0L
        val mig = thread { s.migrateAll() }
        Thread.sleep(50)
        val guardados = thread { repeat(40) { val a = System.nanoTime(); s.write("nexo_ratchet.json", clave); esperaMax = maxOf(esperaMax, (System.nanoTime() - a) / 1_000_000); Thread.sleep(5) } }
        guardados.join(); mig.join()
        println("Migrando 6 x 20 MB: guardado pequeño, espera máx. ${esperaMax} ms")
        assertTrue(esperaMax < 100, "un guardado pequeño no espera a la migración de otro archivo (${esperaMax} ms)")
        repeat(6) { assertEquals(20_000_000, s.read("nexo_att_$it.b64")!!.length) }
    }

    // Coste del cifrado frente a guardar en claro como antes de la 2720 (mismo tamaño que un vídeo HD en base64)
    @Test fun costeFrenteAEnClaro() {
        val d = tmp(); val k = key(); val s = AtRestStore(d) { k }
        val big = "A".repeat(20_000_000)
        fun plain() { val f = File(d, "p.b64"); java.io.FileOutputStream(f).use { java.io.OutputStreamWriter(it, Charsets.UTF_8).use { w -> w.write(big) } }; java.io.FileInputStream(f).use { java.io.InputStreamReader(it, Charsets.UTF_8).use { r -> r.readText() } } }
        fun enc() { s.write("e.b64", big); s.read("e.b64") }
        repeat(3) { plain(); enc() }
        val t1 = System.nanoTime(); repeat(5) { plain() }; val p = (System.nanoTime() - t1) / 5_000_000
        val t2 = System.nanoTime(); repeat(5) { enc() }; val e = (System.nanoTime() - t2) / 5_000_000
        println("20 MB guardar + leer: en claro (antes) ${p} ms, cifrado ${e} ms")
    }

    @Test fun costeDesglose() {
        val k = key(); val big = "A".repeat(20_000_000)
        repeat(3) { AtRestStore.decrypt(k, AtRestStore.encrypt(k, big.toByteArray())) }
        var t = System.nanoTime(); val b = big.toByteArray(Charsets.UTF_8); val tb = (System.nanoTime() - t) / 1_000_000
        t = System.nanoTime(); val e = AtRestStore.encrypt(k, b); val te = (System.nanoTime() - t) / 1_000_000
        t = System.nanoTime(); val dd = AtRestStore.decrypt(k, e); val td = (System.nanoTime() - t) / 1_000_000
        t = System.nanoTime(); String(dd, Charsets.UTF_8); val ts = (System.nanoTime() - t) / 1_000_000
        println("20 MB: a bytes ${tb} ms, cifrar ${te} ms, descifrar ${td} ms, a texto ${ts} ms")
    }
}
