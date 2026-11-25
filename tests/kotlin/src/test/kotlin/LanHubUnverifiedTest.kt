import com.nexo.ble.LanHub
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

// Auditoría 23-11 (T-D2): tras un saludo inventado, alguien de la misma red no puede hacer reservar marcos grandes ni abrir
// conexiones sin comprobar sin límite. Cuando la app comprueba la conexión (markVerified), los marcos grandes vuelven a valer.
class LanHubUnverifiedTest {
    class Rec : LanHub.Listener {
        val up = CopyOnWriteArrayList<String>(); val msgs = CopyOnWriteArrayList<Pair<String, String>>()
        override fun onUp(nx: String) { up.add(nx) }
        override fun onDown(nx: String) {}
        override fun onMessage(nx: String, text: String) { msgs.add(nx to text) }
    }
    private fun waitFor(ms: Long = 5000, f: () -> Boolean): Boolean { val t0 = System.currentTimeMillis(); while (System.currentTimeMillis() - t0 < ms) { if (f()) return true; Thread.sleep(10) }; return f() }
    private fun hello(port: Int, nx: String): Pair<Socket, DataOutputStream> {
        val s = Socket("127.0.0.1", port); s.soTimeout = 15000
        val out = DataOutputStream(s.getOutputStream())
        val h = "{\"h\":1,\"nx\":\"$nx\"}".toByteArray(); out.writeInt(h.size); out.write(h); out.flush()
        val inp = DataInputStream(s.getInputStream()); val n = inp.readInt(); inp.readFully(ByteArray(n)) // su saludo, tras el mío
        return s to out
    }
    private fun closed(s: Socket, ms: Int): Boolean {
        s.soTimeout = ms
        return try { val b = ByteArray(256); val i = s.getInputStream(); while (i.read(b) >= 0) { }; true } catch (e: java.net.SocketTimeoutException) { false } catch (e: Exception) { true }
    }

    // Un marco que DICE medir 48 MB y no manda nada: no se reserva (antes ByteArray(48 MB) al leer el tamaño)
    @Test fun marcoGrandeSinComprobarNoReserva() {
        val r = Rec(); val hub = LanHub({ "nxbbbbbbbb" }, r, autoPing = false); val p = hub.start()
        System.gc(); Thread.sleep(150)
        val rt = Runtime.getRuntime(); val before = (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024)
        val socks = (1..6).map { i -> hello(p, "nxa000000$i").also { (_, out) -> out.writeInt(LanHub.MAX_FRAME - 1); out.flush() } }
        Thread.sleep(400)
        val grew = (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024) - before
        assertTrue(grew < 60, "reservó ~$grew MB con 6 marcos gigantes sin comprobar")
        socks.forEach { it.first.close() }; hub.stop()
    }

    // Un marco grande de verdad antes de comprobar se tira sin cortar: lo siguiente llega
    @Test fun marcoGrandeSinComprobarSeTiraYSigue() {
        val r = Rec(); val hub = LanHub({ "nxbbbbbbbb" }, r, autoPing = false); val p = hub.start()
        val (s, out) = hello(p, "nxaaaaaaaa")
        val big = ByteArray(LanHub.UNVERIFIED_FRAME + 5000) { 0x62 }
        out.writeInt(big.size); out.write(big)
        val m = "{\"v\":1,\"type\":\"lv\"}".toByteArray(); out.writeInt(m.size); out.write(m); out.flush()
        assertTrue(waitFor { r.msgs.any { it.second.contains("lv") } }, "tras el marco grande descartado, lo siguiente debe llegar")
        assertFalse(r.msgs.any { it.second.length == big.size })
        s.close(); hub.stop()
    }

    @Test fun mensajeNormalSinComprobarLlega() {
        val r = Rec(); val hub = LanHub({ "nxbbbbbbbb" }, r, autoPing = false); val p = hub.start()
        val (s, out) = hello(p, "nxaaaaaaaa")
        val m = "{\"v\":1,\"type\":\"lv\"}".toByteArray(); out.writeInt(m.size); out.write(m); out.flush()
        assertTrue(waitFor { r.msgs.any { it.second.contains("lv") } })
        s.close(); hub.stop()
    }

    @Test fun comprobadaAdmiteMarcoGrande() {
        val r = Rec(); val hub = LanHub({ "nxbbbbbbbb" }, r, autoPing = false); val p = hub.start()
        val (s, out) = hello(p, "nxaaaaaaaa")
        assertTrue(waitFor { r.up.contains("nxaaaaaaaa") })
        hub.markVerified("nxaaaaaaaa")
        assertTrue(hub.isVerified("nxaaaaaaaa"))
        val big = ByteArray(LanHub.UNVERIFIED_FRAME + 1000) { 0x61 }
        out.writeInt(big.size); out.write(big); out.flush()
        assertTrue(waitFor { r.msgs.any { it.second.length == big.size } }, "un contacto comprobado puede mandar marcos grandes")
        s.close(); hub.stop()
    }

    @Test fun topeDeConexionesSinComprobar() {
        val r = Rec(); val hub = LanHub({ "nxbbbbbbbb" }, r, autoPing = false); val p = hub.start()
        val socks = (0 until LanHub.MAX_UNVERIFIED + 6).map { i -> hello(p, "nxf" + i.toString().padStart(7, '0')).first.also { Thread.sleep(15) } }
        assertTrue(waitFor { hub.peers().size <= LanHub.MAX_UNVERIFIED && r.up.size >= LanHub.MAX_UNVERIFIED + 6 })
        Thread.sleep(300)
        assertTrue(hub.peers().size <= LanHub.MAX_UNVERIFIED, "como mucho ${LanHub.MAX_UNVERIFIED} sin comprobar, hay ${hub.peers().size}")
        // la más nueva sigue
        assertTrue(hub.isUp("nxf" + (LanHub.MAX_UNVERIFIED + 5).toString().padStart(7, '0')))
        socks.forEach { it.close() }; hub.stop()
    }

    // 12A (23-11): a una conexión entrante el hub no le da su NEXO ID hasta que diga quién es; y si no es contacto, ni eso
    @Test fun entranteNoRecibeMiIdSinSaludar_niSiNoEsContacto() {
        val r = Rec(); val hub = LanHub({ "nxbbbbbbbb" }, r, autoPing = false, knows = { n -> n == "nxaaaaaaaa" }); val p = hub.start()
        val s1 = Socket("127.0.0.1", p); s1.soTimeout = 800
        val got = try { DataInputStream(s1.getInputStream()).readInt(); true } catch (e: java.net.SocketTimeoutException) { false }
        assertFalse(got, "el hub saludó (con su NEXO ID) a una conexión entrante que no dijo quién es")
        s1.close()
        val s2 = Socket("127.0.0.1", p); s2.soTimeout = 3000
        val o2 = DataOutputStream(s2.getOutputStream()); val h = "{\"h\":1,\"nx\":\"nxcccccccc\"}".toByteArray(); o2.writeInt(h.size); o2.write(h); o2.flush()
        assertTrue(closed(s2, 3000), "un desconocido no debe recibir el saludo")
        val (s3, _) = hello(p, "nxaaaaaaaa")   // el contacto sí
        assertTrue(waitFor { r.up.contains("nxaaaaaaaa") }); assertFalse(r.up.contains("nxcccccccc"))
        s3.close(); hub.stop()
    }
}
