import com.nexo.ble.LanBeacon
import com.nexo.ble.LanHub
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

// Escaneo activo de la red (LanBeacon) con sockets UDP reales en 127.0.0.1 (puertos distintos por "teléfono")
class LanBeaconTest {
    class Rec : LanBeacon.Listener {
        val peers = CopyOnWriteArrayList<Triple<String, String, Int>>()
        override fun onPeer(token: String, host: String, port: Int) { peers.add(Triple(token, host, port)) }
    }
    private fun waitFor(ms: Long = 3000, f: () -> Boolean): Boolean { val t0 = System.currentTimeMillis(); while (System.currentTimeMillis() - t0 < ms) { if (f()) return true; Thread.sleep(10) }; return f() }
    private val lo = InetAddress.getByName("127.0.0.1")
    private val tA = "0123456789abcdef"; private val tB = "fedcba9876543210"

    @Test fun preguntaYRespuestaSeEncuentranLosDos() {
        val ra = Rec(); val rb = Rec()
        val a = LanBeacon(ra, 47901); val b = LanBeacon(rb, 47902)
        a.start(tA, 5001); b.start(tB, 5002)
        a.probe(listOf(InetSocketAddress(lo, 47902)))
        assertTrue(waitFor { rb.peers.isNotEmpty() && ra.peers.isNotEmpty() })
        assertEquals(Triple(tA, "127.0.0.1", 5001), rb.peers[0]) // B sabe de A por la pregunta
        assertEquals(Triple(tB, "127.0.0.1", 5002), ra.peers[0]) // A sabe de B por la respuesta
        a.stop(); b.stop()
    }

    @Test fun ignoraLoPropioLaBasuraYNoRepite() {
        val ra = Rec()
        val a = LanBeacon(ra, 47903); a.start(tA, 5001)
        val s = DatagramSocket()
        fun send(t: String) { val b = t.toByteArray(); s.send(DatagramPacket(b, b.size, lo, 47903)) }
        send("NXQ1|$tA|5001")            // su propia marca (difusión que vuelve)
        send("hola")                      // basura
        send("NXQ1|<script>|80")          // marca no válida
        send("NXQ1|$tB|99999")            // puerto no válido
        send("NXA1|$tB|5002"); send("NXA1|$tB|5002") // repetida: un solo aviso
        Thread.sleep(400)
        assertEquals(listOf(Triple(tB, "127.0.0.1", 5002)), ra.peers.toList())
        // Contesta a una pregunta ajena con su marca
        send("NXQ1|$tB|5002")
        val buf = ByteArray(100); val p = DatagramPacket(buf, buf.size); s.soTimeout = 2000; s.receive(p)
        assertEquals("NXA1|$tA|5001", String(p.data, 0, p.length))
        s.close(); a.stop()
    }

    @Test fun direccionesDeLaRed() {
        val a = LanBeacon(Rec(), 47904)
        val h24 = a.hostsOf(InetAddress.getByName("192.168.1.37") as Inet4Address, 24)
        assertEquals(253, h24.size) // 254 menos la propia
        assertEquals("192.168.1.1", h24.first().hostAddress); assertEquals("192.168.1.254", h24.last().hostAddress)
        assertFalse(h24.any { it.hostAddress == "192.168.1.37" || it.hostAddress == "192.168.1.255" || it.hostAddress == "192.168.1.0" })
        assertEquals(1021, a.hostsOf(InetAddress.getByName("10.0.5.9") as Inet4Address, 22).size)
    }

    @Test fun deLaRespuestaALaConexionWifi() {
        // Escaneo → dirección y puerto del otro → LanHub conecta: el camino completo sin mDNS
        class H : LanHub.Listener { val up = CopyOnWriteArrayList<String>(); override fun onUp(nx: String) { up.add(nx) }; override fun onDown(nx: String) {}; override fun onMessage(nx: String, text: String) {} }
        val ha = H(); val hb = H()
        val hubA = LanHub({ "nxaaaaaaaa" }, ha); val hubB = LanHub({ "nxbbbbbbbb" }, hb)
        val pa = hubA.start(); val pb = hubB.start()
        val ra = Rec(); val rb = Rec()
        val a = LanBeacon(ra, 47905); val b = LanBeacon(rb, 47906)
        a.start(tA, pa); b.start(tB, pb)
        a.probe(listOf(InetSocketAddress(lo, 47906)))
        assertTrue(waitFor { ra.peers.isNotEmpty() })
        val (_, host, port) = ra.peers[0]
        hubA.connect(host, port)
        assertTrue(waitFor { hubA.isUp("nxbbbbbbbb") && hubB.isUp("nxaaaaaaaa") })
        a.stop(); b.stop(); hubA.stop(); hubB.stop()
    }
}
