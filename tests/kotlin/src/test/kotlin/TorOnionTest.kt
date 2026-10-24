import com.nexo.ble.TorOnion
import net.freehaven.tor.control.TorControlConnection
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.ServerSocket
import java.net.Socket
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// Ronda 2765 (diagnóstico del Vivo: "Tor no disponible: sin dirección .onion"): la respuesta de ADD_ONION se lee con la
// jtorctl de verdad (la que trae tor-android) contra un puerto de control que contesta como Tor.
class TorOnionTest {
    private val sid = "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx"

    // Puerto de control falso: AUTHENTICATE → 250 OK; ADD_ONION → ServiceID (+ PrivateKey si la clave es nueva)
    private fun fakeTor(): ServerSocket {
        val ss = ServerSocket(0)
        thread(isDaemon = true) {
            while (true) {
                val c = try { ss.accept() } catch (e: Exception) { return@thread }
                thread(isDaemon = true) {
                    val rd = BufferedReader(InputStreamReader(c.getInputStream())); val w = c.getOutputStream()
                    while (true) {
                        val line = rd.readLine() ?: break
                        val out = when {
                            line.startsWith("AUTHENTICATE") -> "250 OK\r\n"
                            line.startsWith("ADD_ONION NEW:") -> "250-ServiceID=$sid\r\n250-PrivateKey=ED25519-V3:Q2xhdmVTZWNyZXRh\r\n250 OK\r\n"
                            line.startsWith("ADD_ONION ") -> "250-ServiceID=$sid\r\n250 OK\r\n"
                            else -> "510 Unrecognized command\r\n"
                        }
                        w.write(out.toByteArray()); w.flush()
                    }
                }
            }
        }
        return ss
    }

    private fun addOnion(port: Int, key: String): Map<String, String> {
        val conn = TorControlConnection(Socket("127.0.0.1", port))
        conn.launchThread(true)
        conn.authenticate(ByteArray(0))
        return conn.addOnion(key, mapOf(9878 to "127.0.0.1:1234"))
    }

    @Test fun direccionYClaveConLaLibreriaDeVerdad() {
        val ss = fakeTor()
        val res = addOnion(ss.localPort, "NEW:ED25519-V3")
        println("jtorctl devuelve: " + res.keys)
        assertNull(res["ServiceID"], "jtorctl no usa los nombres del protocolo (por eso fallaba)")
        assertEquals("$sid.onion", TorOnion.address(res))
        assertEquals("ED25519-V3:Q2xhdmVTZWNyZXRh", TorOnion.privateKey(res))
        // Con la clave guardada: misma dirección y sin clave nueva que guardar
        val again = addOnion(ss.localPort, "ED25519-V3:Q2xhdmVTZWNyZXRh")
        assertEquals("$sid.onion", TorOnion.address(again))
        assertNull(TorOnion.privateKey(again))
        ss.close()
    }

    @Test fun nombresDelProtocoloTambien() {
        assertEquals("$sid.onion", TorOnion.address(mapOf("ServiceID" to sid)))
        assertEquals("$sid.onion", TorOnion.address(mapOf("onionAddress" to "$sid.onion")))
        assertNull(TorOnion.address(mapOf("otra" to "x")))
        assertNull(TorOnion.privateKey(mapOf("onionPrivKey" to "sin-dos-puntos")))
    }
}
