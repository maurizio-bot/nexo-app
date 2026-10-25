import com.nexo.ble.LanBeacon
import java.net.InetAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.*

// Auditoría (ronda 2774): alguien de la misma red puede mandar preguntas de escaneo (NXQ1) sin ser contacto. Con una
// marca distinta en cada paquete se saltaba el "no repetir": el mapa de vistos crecía sin fin (memoria) y cada paquete
// disparaba un aviso a la app. Ahora el mapa está acotado y hay un presupuesto por ventana.
class LanBeaconAttackTest {
    private fun beacon(onPeer: AtomicInteger) = LanBeacon(object : LanBeacon.Listener {
        override fun onPeer(token: String, host: String, port: Int) { onPeer.incrementAndGet() }
    })

    @Test fun inundacionDeMarcasNoCreceSinLimiteNiAvisaSinFin() {
        val peers = AtomicInteger()
        val b = beacon(peers)
        val from = InetAddress.getByName("10.1.2.3")
        val now = 1_000_000L
        // 20 000 preguntas con marca distinta, todas en la misma ventana de tiempo
        repeat(20000) { i -> b.handle("NXQ1|%016x".format(i.toLong())+ "|4000", from, 50000, now) }
        assertTrue(peers.get() <= LanBeacon.MAX_PER_WINDOW, "avisos sin acotar: ${peers.get()}")
        assertTrue(b.seenSize() <= LanBeacon.MAX_SEEN, "mapa de vistos sin acotar: ${b.seenSize()}")
    }

    @Test fun preguntaNormalSiAvisa() {
        val peers = AtomicInteger()
        val b = beacon(peers)
        val from = InetAddress.getByName("10.1.2.9")
        b.handle("NXQ1|00112233aabbccdd|4000", from, 50000, 2_000_000L)
        assertEquals(1, peers.get())
        // La misma marca y dirección dentro de 10 s no repite el aviso
        b.handle("NXQ1|00112233aabbccdd|4000", from, 50000, 2_000_500L)
        assertEquals(1, peers.get())
        // Pasados 10 s, vuelve a avisar (sigue en la misma ventana de presupuesto)
        b.handle("NXQ1|00112233aabbccdd|4000", from, 50000, 2_011_000L)
        assertEquals(2, peers.get())
    }

    @Test fun ventanaSeReiniciaYVuelveAAtender() {
        val peers = AtomicInteger()
        val b = beacon(peers)
        val from = InetAddress.getByName("10.1.2.4")
        repeat(20000) { i -> b.handle("NXQ1|%016x".format(i.toLong()) + "|4000", from, 50000, 3_000_000L) }
        val tras1aVentana = peers.get()
        // Nueva ventana (más de WINDOW_MS después): se vuelve a atender
        b.handle("NXQ1|ffffffffffffffff|4000", from, 50000, 3_000_000L + LanBeacon.WINDOW_MS + 1)
        assertEquals(tras1aVentana + 1, peers.get())
    }
}
