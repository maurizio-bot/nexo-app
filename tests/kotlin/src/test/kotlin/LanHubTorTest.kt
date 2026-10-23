import com.nexo.ble.LanHub
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

// LanHub por Tor: conecta a una dirección .onion a través de un proxy SOCKS5 (aquí uno mínimo que hace de Tor y
// lleva "<algo>.onion" al puerto del otro LanHub) y el servidor escucha solo en 127.0.0.1
class LanHubTorTest {
    class Rec : LanHub.Listener {
        val up = CopyOnWriteArrayList<String>(); val msgs = CopyOnWriteArrayList<Pair<String, String>>()
        override fun onUp(nx: String) { up.add(nx) }
        override fun onDown(nx: String) {}
        override fun onMessage(nx: String, text: String) { msgs.add(nx to text) }
    }
    private fun waitFor(ms: Long = 5000, f: () -> Boolean): Boolean { val t0 = System.currentTimeMillis(); while (System.currentTimeMillis() - t0 < ms) { if (f()) return true; Thread.sleep(10) }; return f() }

    // SOCKS5 sin autenticación, solo CONNECT por nombre (como Tor con .onion)
    class FakeTor(private val onions: Map<String, Int>) {
        val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val asked = CopyOnWriteArrayList<String>()
        init { Thread { while (!server.isClosed) try { val c = server.accept(); Thread { handle(c) }.start() } catch (e: Exception) {} }.apply { isDaemon = true }.start() }
        private fun handle(c: Socket) {
            val i = DataInputStream(c.getInputStream()); val o = DataOutputStream(c.getOutputStream())
            i.readByte(); val n = i.readByte().toInt(); repeat(n) { i.readByte() }; o.write(byteArrayOf(5, 0))
            i.readByte(); i.readByte(); i.readByte(); val atyp = i.readByte().toInt()
            assertEquals(3, atyp, "debe pedir por nombre (no resolver el .onion fuera de Tor)")
            val len = i.readByte().toInt(); val name = String(ByteArray(len).also { i.readFully(it) }); val port = i.readUnsignedShort()
            asked.add("$name:$port")
            val target = onions[name] ?: run { o.write(byteArrayOf(5, 4, 0, 1, 0, 0, 0, 0, 0, 0)); c.close(); return }
            val t = Socket("127.0.0.1", target)
            o.write(byteArrayOf(5, 0, 0, 1, 127, 0, 0, 1, 0, 0)); o.flush()
            Thread { try { t.getInputStream().copyTo(c.getOutputStream()) } catch (e: Exception) {} }.start()
            try { c.getInputStream().copyTo(t.getOutputStream()) } catch (e: Exception) {}
        }
    }

    @Test fun conectaPorSocksAUnOnionYSeHablan() {
        val lo = InetAddress.getByName("127.0.0.1")
        val rb = Rec(); val b = LanHub({ "nxbbbbbbbb" }, rb, bindHost = lo)
        val pb = b.start()
        val tor = FakeTor(mapOf("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.onion" to pb))
        val ra = Rec(); val a = LanHub({ "nxaaaaaaaa" }, ra, proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress(lo, tor.server.localPort)))
        a.start()
        a.connect("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.onion", 9878)
        assertTrue(waitFor { a.isUp("nxbbbbbbbbb".dropLast(1)) && b.isUp("nxaaaaaaaa") })
        assertEquals(listOf("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.onion:9878"), tor.asked.toList())
        assertTrue(a.send("nxbbbbbbbb", "hola por tor")); assertTrue(b.send("nxaaaaaaaa", "respuesta"))
        assertTrue(waitFor { rb.msgs.size == 1 && ra.msgs.size == 1 })
        assertEquals("nxaaaaaaaa" to "hola por tor", rb.msgs[0])
        a.stop(); b.stop(); tor.server.close()
    }

    @Test fun servidorDeTorSoloEnLocal() {
        val lo = InetAddress.getByName("127.0.0.1")
        val b = LanHub({ "nxbbbbbbbb" }, Rec(), bindHost = lo)
        b.start()
        val f = LanHub::class.java.getDeclaredField("server").apply { isAccessible = true }
        val ss = f.get(b) as ServerSocket
        assertEquals(lo, ss.inetAddress)
        b.stop()
    }
}
