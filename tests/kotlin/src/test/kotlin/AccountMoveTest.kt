import com.nexo.ble.AccountMove
import com.nexo.ble.AtRestStore
import com.nexo.ble.BigFile
import com.nexo.ble.BigNet
import com.nexo.ble.BigReader
import com.nexo.ble.BigWriter
import com.nexo.ble.BigWriterStream
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.file.Files
import javax.crypto.KeyGenerator
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.json.JSONObject

// Pasar la cuenta a un teléfono nuevo (AccountMove.kt): paquete cifrado con la clave del QR, por socket, y en el nuevo
// con su propio cifrado en reposo; si el nuevo no la guarda, no confirma (el viejo no borra nada)
class AccountMoveTest {
    private fun key() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val skip = setOf("nexo_nxid_mac_map.json")

    private fun phone(): Triple<File, AtRestStore, File> {
        val dir = Files.createTempDirectory("nexo_move").toFile().also { it.deleteOnExit() }
        val k = key()
        return Triple(dir, AtRestStore(dir) { k }, File(dir, "nexo_big"))
    }

    private fun fill(dir: File, st: AtRestStore, big: File): ByteArray {
        st.write("nexo_advertising_id.json", "{\"id\":\"NX12345678\"}")
        st.write("nexo_e2e_identity.json", "{\"pub\":\"PUB\",\"priv\":\"PRIV\"}")
        st.write("nexo_vault_msgs_v2_nx87654321.json", "{\"messages\":[{\"content\":\"hola ñ 😀\"}]}" + "x".repeat(700_000))
        st.write("nexo_groups.json", "{\"groups\":{}}")
        // P0-1: el ratchet lleva SESIONES vivas (clave de cadena); al pasar la cuenta deben importarse VACÍAS
        st.write("nexo_ratchet.json", "{\"v\":1,\"ik\":\"MYIK\",\"sign\":{\"priv\":\"S\"},\"spks\":[{\"id\":1}],\"peers\":{\"nxaaaa1111\":{\"ik\":\"PK\"}},\"sessions\":{\"nxaaaa1111\":[{\"cks\":\"LIVECHAINKEY\",\"ns\":9}]},\"seenEk\":{\"EKZ\":1}}")
        st.write("nexo_nxid_mac_map.json", "{}")           // propio de este teléfono: no viaja
        File(dir, "nexo_bg_inbox.jsonl").writeText("{}\n") // tampoco
        File(dir, "otra_libreria.xml").writeText("<x/>")   // ni lo que no es de NEXO
        big.mkdirs()
        val raw = Random(7).nextBytes(300_000)
        File(big, "msg1.enc").writeBytes(raw)
        return raw
    }

    private fun pack(dir: File, st: AtRestStore, big: File, moveKey: ByteArray, id: String): File {
        val enc = File.createTempFile("move", ".enc").also { it.deleteOnExit() }
        val w = BigWriter(enc, moveKey, id)
        BigWriterStream(w).use { AccountMove.export(dir, skip, { st.read(it) }, big, it) }
        return enc
    }

    @Test fun pasaLaCuentaEntera() {
        val (dA, sA, bA) = phone(); val raw = fill(dA, sA, bA)
        val (dB, sB, bB) = phone()
        sB.write("nexo_advertising_id.json", "{\"id\":\"NXNUEVO000\"}") // el nuevo tenía su propia cuenta vacía
        sB.write("nexo_e2e_identity.json", "{\"pub\":\"OTRA\"}")
        val moveKey = BigFile.key(BigFile.token() + BigFile.token())
        val id = "move" + BigFile.token().take(8); val token = BigFile.token()
        val enc = pack(dA, sA, bA, moveKey, id)
        assertFalse(String(enc.readBytes(), Charsets.ISO_8859_1).contains("PRIV"), "el paquete va cifrado")
        val server = ServerSocket(0, 5, InetAddress.getLoopbackAddress())
        val recv = File.createTempFile("recv", ".enc").also { it.delete(); it.deleteOnExit() }
        var imported: AccountMove.Stats? = null
        val t = Thread {
            BigNet.serve(server, id, token, recv, BigFile.MAX_BYTES) {
                AccountMove.wipe(dB, skip, bB)
                val pin = java.io.PipedInputStream(1 shl 16); val pout = java.io.PipedOutputStream(pin)
                val dec = Thread { pout.use { BigReader.decrypt(recv, moveKey, id, it) } }; dec.start()
                imported = pin.use { AccountMove.import(it, skip, { n, txt -> sB.write(n, txt) }, bB) }
                dec.join()
            }
        }
        t.start()
        Socket(InetAddress.getLoopbackAddress(), server.localPort).use { s -> BigNet.send(s, id, token, enc) }
        t.join(20000); server.close()
        assertEquals(5, imported!!.files); assertEquals(1, imported!!.bigFiles)
        // P0-1: el ratchet llegó, pero con las SESIONES y el anti-replay VACÍOS (identidad/firma/prekeys/peers conservados)
        val rat = JSONObject(sB.read("nexo_ratchet.json")!!)
        assertEquals(0, rat.getJSONObject("sessions").length(), "las sesiones del cifrado NO se clonan al pasar la cuenta")
        assertEquals(0, rat.getJSONObject("seenEk").length(), "el anti-replay se reinicia")
        assertEquals("MYIK", rat.getString("ik"), "la identidad sí se conserva")
        assertEquals(1, rat.getJSONArray("spks").length(), "las prekeys se conservan")
        assertEquals(1, rat.getJSONObject("peers").length(), "los paquetes de claves de contactos se conservan")
        assertFalse(sB.read("nexo_ratchet.json")!!.contains("LIVECHAINKEY"), "la clave de cadena viva NO viaja")
        assertEquals("{\"id\":\"NX12345678\"}", sB.read("nexo_advertising_id.json"))
        assertEquals("{\"pub\":\"PUB\",\"priv\":\"PRIV\"}", sB.read("nexo_e2e_identity.json"))
        assertTrue(sB.read("nexo_vault_msgs_v2_nx87654321.json")!!.contains("hola ñ 😀"))
        assertContentEquals(raw, File(bB, "msg1.enc").readBytes())
        assertEquals(null, sB.read("nexo_nxid_mac_map.json"), "lo propio del teléfono no viaja")
        assertFalse(File(dB, "nexo_bg_inbox.jsonl").exists())
        assertFalse(String(File(dB, "nexo_e2e_identity.json").readBytes(), Charsets.ISO_8859_1).contains("PRIV"), "en el nuevo, cifrado en reposo")
    }

    @Test fun sinGuardarNoConfirma() {
        val (dA, sA, bA) = phone(); fill(dA, sA, bA)
        val moveKey = BigFile.key(BigFile.token() + BigFile.token()); val id = "move1"; val token = BigFile.token()
        val enc = pack(dA, sA, bA, moveKey, id)
        val server = ServerSocket(0, 5, InetAddress.getLoopbackAddress())
        val recv = File.createTempFile("recv2", ".enc").also { it.delete(); it.deleteOnExit() }
        val t = Thread { try { BigNet.serve(server, id, token, recv, BigFile.MAX_BYTES) { throw java.io.IOException("disco lleno") } } catch (e: Exception) {} }
        t.start()
        assertFailsWith<Exception> { Socket(InetAddress.getLoopbackAddress(), server.localPort).use { s -> s.soTimeout = 10000; BigNet.send(s, id, token, enc) } }
        t.join(10000); server.close()
        assertTrue(sA.read("nexo_e2e_identity.json") != null, "el viejo conserva la cuenta")
    }

    @Test fun nombresRaros() {
        assertFalse(AccountMove.travels("../nexo_x", skip))
        assertFalse(AccountMove.travels("nexo_a/b", skip))
        assertFalse(AccountMove.travels("nexo_diag_log1.txt", skip))
        assertTrue(AccountMove.travels("nexo_vault_msgs_v2_grabc12345.json", skip))
    }

    // P0-1 (07-11): sanitizeImport vacía las sesiones vivas del ratchet (clave de cadena) al pasar la cuenta, pero conserva
    // identidad/firma/prekeys/peers; cualquier otro archivo pasa igual; un ratchet ilegible se descarta (null → se regenera).
    @Test fun elPaseDeCuentaNoClonaLasSesionesDelCifrado() {
        val full = "{\"v\":1,\"ik\":\"IK\",\"sign\":{\"priv\":\"P\"},\"spks\":[{\"id\":1}],\"peers\":{\"nxaaaa1111\":{\"ik\":\"K\"}},\"sessions\":{\"nxaaaa1111\":[{\"cks\":\"CHAINKEY\",\"ns\":5}]},\"seenEk\":{\"EK\":1}}"
        val out = AccountMove.sanitizeImport("nexo_ratchet.json", full)!!
        val o = JSONObject(out)
        assertEquals(0, o.getJSONObject("sessions").length(), "las sesiones NO se copian")
        assertEquals(0, o.getJSONObject("seenEk").length(), "el anti-replay se reinicia")
        assertEquals("IK", o.getString("ik"), "la identidad se conserva")
        assertEquals(1, o.getJSONArray("spks").length(), "las prekeys se conservan")
        assertEquals(1, o.getJSONObject("peers").length(), "los paquetes de claves de contactos se conservan")
        assertFalse(out.contains("CHAINKEY"), "la clave de cadena viva NO viaja")
        assertEquals("{\"x\":1}", AccountMove.sanitizeImport("nexo_groups.json", "{\"x\":1}"), "otros archivos pasan igual")
        assertEquals(null, AccountMove.sanitizeImport("nexo_ratchet.json", "no es json {{{"), "ratchet ilegible: no se escribe")
    }
}
