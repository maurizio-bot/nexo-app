import com.nexo.ble.BigFile
import com.nexo.ble.BigNet
import com.nexo.ble.BigReader
import com.nexo.ble.BigWriter
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

// Archivos grandes: cifrado a disco por trozos, paso por socket y descifrado (BigFile.kt)
class BigFileTest {
    private val keyHex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
    private fun tmp(name: String) = File.createTempFile("big_$name", ".bin").also { it.deleteOnExit() }

    private fun write(file: File, data: ByteArray, slice: Int = 512 * 1024, id: String = "msg1") {
        val w = BigWriter(file, BigFile.key(keyHex), id)
        var i = 0
        while (i < data.size) { val e = minOf(i + slice, data.size); w.append(data.copyOfRange(i, e), e == data.size); i = e }
    }

    @Test fun cifraYDescifraIgual() {
        val data = Random(1).nextBytes(3 * 1024 * 1024 + 123)
        val f = tmp("a"); write(f, data)
        assertTrue(f.length() > data.size, "lleva iv y etiqueta por trozo")
        val out = ByteArrayOutputStream()
        assertEquals(data.size.toLong(), BigReader.decrypt(f, BigFile.key(keyHex), "msg1", out))
        assertContentEquals(data, out.toByteArray())
    }

    @Test fun otraClaveOOtroIdNoAbre() {
        val f = tmp("b"); write(f, Random(2).nextBytes(100000))
        assertFailsWith<Exception> { BigReader.decrypt(f, BigFile.key("f" + keyHex.substring(1)), "msg1", ByteArrayOutputStream()) }
        assertFailsWith<Exception> { BigReader.decrypt(f, BigFile.key(keyHex), "otro", ByteArrayOutputStream()) }
    }

    @Test fun cortadoOTocadoSeNota() {
        val data = Random(3).nextBytes(2 * 1024 * 1024)
        val f = tmp("c"); write(f, data)
        // Cortado al final de un registro (falta el último)
        val cut = tmp("c2"); f.copyTo(cut, true)
        RandomAccessFile(cut, "rw").use { it.setLength(4 + 1 + 12 + 512 * 1024 + 16L) }
        val e1 = assertFailsWith<Exception> { BigReader.decrypt(cut, BigFile.key(keyHex), "msg1", ByteArrayOutputStream()) }
        assertTrue(e1.message!!.contains("incompleto"))
        // Un byte cambiado
        val bad = tmp("c3"); f.copyTo(bad, true)
        RandomAccessFile(bad, "rw").use { it.seek(5000); val b = it.read(); it.seek(5000); it.write(b xor 1) }
        assertFailsWith<Exception> { BigReader.decrypt(bad, BigFile.key(keyHex), "msg1", ByteArrayOutputStream()) }
    }

    @Test fun porSocketDeDiscoADisco() {
        val data = Random(4).nextBytes(5 * 1024 * 1024 + 7)
        val src = tmp("s"); write(src, data)
        val dest = tmp("d"); dest.delete()
        val token = BigFile.token()
        val server = ServerSocket(0, 5, InetAddress.getLoopbackAddress())
        var lastIn = 0L
        val t = Thread { BigNet.serve(server, "msg1", token, dest, BigFile.MAX_BYTES * 2) { b, _ -> lastIn = b } }
        t.start()
        // Alguien en la misma red se conecta antes con un token falso: se le ignora y se sigue esperando
        Socket(InetAddress.getLoopbackAddress(), server.localPort).use { s ->
            val o = java.io.DataOutputStream(s.getOutputStream()); o.writeUTF("""{"big":1,"id":"msg1","token":"malo","len":10}"""); o.flush()
            assertEquals(-1, s.getInputStream().read())
        }
        var lastOut = 0L
        Socket(InetAddress.getLoopbackAddress(), server.localPort).use { s -> BigNet.send(s, "msg1", token, src) { b, _ -> lastOut = b } }
        t.join(10000)
        server.close()
        assertEquals(src.length(), lastOut)
        assertEquals(src.length(), lastIn)
        assertContentEquals(src.readBytes(), dest.readBytes())
        val out = ByteArrayOutputStream()
        BigReader.decrypt(dest, BigFile.key(keyHex), "msg1", out)
        assertContentEquals(data, out.toByteArray())
    }

    // Ronda 2758: por flujos (como el canal L2CAP del Bluetooth, BluetoothSocket): igual que por socket
    @Test fun porFlujosComoL2cap() {
        val data = Random(5).nextBytes(1024 * 1024 + 5)
        val src = tmp("l"); write(src, data)
        val dest = tmp("ld"); dest.delete()
        val token = BigFile.token()
        val aToB = java.io.PipedInputStream(1 shl 16); val aOut = java.io.PipedOutputStream(aToB)
        val bToA = java.io.PipedInputStream(1 shl 16); val bOut = java.io.PipedOutputStream(bToA)
        var ok = false
        val t = Thread { ok = BigNet.receive(aToB, bOut, "msg1", token, dest, BigFile.MAX_BYTES * 2) }
        t.start()
        BigNet.send(bToA, aOut, "msg1", token, src)
        t.join(10000)
        assertTrue(ok)
        val out = ByteArrayOutputStream()
        BigReader.decrypt(dest, BigFile.key(keyHex), "msg1", out)
        assertContentEquals(data, out.toByteArray())
        // Otro token: no se escribe nada
        val d2 = tmp("ld2"); d2.delete()
        val i2 = java.io.PipedInputStream(1 shl 16); val o2 = java.io.PipedOutputStream(i2)
        java.io.DataOutputStream(o2).apply { writeUTF("""{"big":1,"id":"msg1","token":"malo","len":10}"""); flush() }
        assertEquals(false, BigNet.receive(i2, ByteArrayOutputStream(), "msg1", token, d2, 100))
        assertTrue(!d2.exists())
    }

    @Test fun limitesYNombres() {
        assertFailsWith<IllegalArgumentException> { BigFile.key("abc") }
        assertEquals("msg_12-ab", BigFile.safeId("msg_12-ab/../x".substring(0, 9)))
        assertEquals("msg1x", BigFile.safeId("msg1/../x".replace("/..", "").replace("/", "")))
        assertEquals(32, BigFile.token().length)
    }
}
