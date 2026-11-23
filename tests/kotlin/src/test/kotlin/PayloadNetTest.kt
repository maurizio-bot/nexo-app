import com.nexo.ble.PayloadNet
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.ServerSocket
import java.net.Socket
import kotlin.test.*

// Auditoría 23-11 (T-L1, T-F8, T-E1): recepción de lo MEDIANO por Wi-Fi Direct y por el canal rápido (PayloadNet.serve).
// - Una conexión ajena (basura, sin token, otro tamaño, callada) no se lleva la espera: se sigue hasta la buena.
// - Una cabecera que dice 40 MB no reserva 40 MB: el tamaño tiene que ser el anunciado y se lee por partes.
// - El byte de «recibido» sale solo si la app confirma (ack true); con ack false o sin respuesta, nunca.
class PayloadNetTest {
    private val id = "msg123"; private val tok = "0123456789abcdef0123456789abcdef"

    private fun serveOn(server: ServerSocket, expect: Long, ackOk: Boolean?, ackWait: Long = 3000, got: MutableList<ByteArray>): Thread {
        return Thread {
            try {
                val r = PayloadNet.serve({ left ->
                    server.soTimeout = left.toInt()
                    val s = server.accept()
                    object : PayloadNet.Conn {
                        override val input = s.getInputStream()
                        override val output = s.getOutputStream()
                        override fun limit(ms: Int) { s.soTimeout = ms }
                        override fun close() { s.close() }
                    }
                }, 8000, id, tok, expect, 40_000_000L, 5000, { b, _ ->
                    got.add(b)
                    if (ackOk != null) Thread { Thread.sleep(100); PayloadNet.ack(id, ackOk) }.start()
                }, ackWait)
                got.add(byteArrayOf(if (r.delivered) 1 else 0, r.rejected.toByte()))
            } catch (e: Exception) {}
        }
    }

    private fun send(port: Int, token: String, data: ByteArray, len: Int = data.size): Int {
        Socket("127.0.0.1", port).use { s ->
            s.soTimeout = 6000
            val out = DataOutputStream(s.getOutputStream())
            try { out.writeUTF(PayloadNet.headerJson(id, token, len)); out.write(data); out.flush() } catch (e: Exception) { return -1 } // cerrado por el otro
            return try { s.getInputStream().read() } catch (e: Exception) { -1 }
        }
    }

    @Test fun ajenasNoSeLlevanLaEsperaYConfirmaTrasDescifrar() {
        val data = ByteArray(300_000) { (it % 61 + 40).toByte() }
        val server = ServerSocket(0); val got = mutableListOf<ByteArray>()
        val t = serveOn(server, data.size.toLong(), true, got = got); t.start()
        Socket("127.0.0.1", server.localPort).use { s -> DataOutputStream(s.getOutputStream()).apply { writeUTF("basura"); flush() }; Thread.sleep(100) }
        assertEquals(-1, send(server.localPort, "otro-token-que-no-es-el-bueno!!", data), "sin el token: ni confirmación")
        assertEquals(-1, send(server.localPort, tok, data.copyOf(1000), 1000), "otro tamaño: ni confirmación")
        assertEquals(1, send(server.localPort, tok, data), "la buena llega y se confirma")
        t.join(8000); server.close()
        assertContentEquals(data, got[0])
        assertEquals(1, got[1][0].toInt()); assertEquals(3, got[1][1].toInt())
    }

    @Test fun sinDescifrarNoHayByteDeRecibido() {
        val data = ByteArray(5000) { 65 }
        for (ack in listOf(false, null)) {
            val server = ServerSocket(0); val got = mutableListOf<ByteArray>()
            val t = serveOn(server, data.size.toLong(), ack, ackWait = 600, got = got); t.start()
            assertEquals(-1, send(server.localPort, tok, data), "ack=$ack: el que envía no lo da por entregado")
            t.join(5000); server.close()
            assertEquals(0, got.last()[0].toInt())
        }
    }

    @Test fun cabeceraDeCuarentaMegasNoReservaNada() {
        val h = DataInputStream(java.io.ByteArrayInputStream(java.io.ByteArrayOutputStream().also { DataOutputStream(it).writeUTF(PayloadNet.headerJson(id, tok, 40_000_000)) }.toByteArray()))
        assertNull(PayloadNet.header(h, id, tok, 300_000, 40_000_000L), "40 MB cuando se anunciaron 300 KB: fuera")
        // y la lectura es por partes: si se corta, error sin haber reservado el total
        val e = assertFailsWith<java.io.IOException> { PayloadNet.readBody(java.io.ByteArrayInputStream(ByteArray(10)), 40_000_000L) }
        assertTrue(e.message!!.contains("10 de 40000000"))
    }
}
