import com.nexo.ble.LanHub
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

// Auditoría (ronda 2774): endurecer el Wi-Fi ante alguien de la misma red que no es contacto. En una red compartida
// (un bar, un hotel, una oficina) cualquiera puede abrir conexiones TCP al puerto de NEXO: el saludo todavía no lleva
// clave (la app lo comprueba después con el cifrado). Lo que el hub NO debe permitir, aunque el saludo sea falso:
//  - que un saludo diga que mide mucho y el hub reserve esa memoria de golpe (con varios así, la app se queda sin
//    memoria y Android la cierra);
//  - que una avalancha de conexiones que no saludan deje sin servicio a los contactos de verdad o cree hilos sin fin.
// En las dos, un contacto legítimo tiene que poder conectarse igual.
class LanHubAttackTest {
    class Rec : LanHub.Listener {
        val up = CopyOnWriteArrayList<String>(); val down = CopyOnWriteArrayList<String>(); val msgs = CopyOnWriteArrayList<Pair<String, String>>()
        override fun onUp(nx: String) { up.add(nx) }
        override fun onDown(nx: String) { down.add(nx) }
        override fun onMessage(nx: String, text: String) { msgs.add(nx to text) }
    }
    private fun waitFor(ms: Long = 5000, f: () -> Boolean): Boolean { val t0 = System.currentTimeMillis(); while (System.currentTimeMillis() - t0 < ms) { if (f()) return true; Thread.sleep(10) }; return f() }
    private fun readerThreads() = Thread.getAllStackTraces().keys.count { it.isAlive && it.name == "nexo-lan-read" }
    // Abre una conexión cruda y lee el saludo que manda el hub (lo manda él primero)
    private fun raw(port: Int): Pair<Socket, DataInputStream> {
        val s = Socket("127.0.0.1", port); s.soTimeout = 15000
        val inp = DataInputStream(s.getInputStream()); val n = inp.readInt(); inp.readFully(ByteArray(n))
        return s to inp
    }
    // ¿El hub cerró la conexión dentro de `ms`? (una lectura que termina en fin de flujo o error = cerrada)
    private fun closedWithin(s: Socket, inp: DataInputStream, ms: Long): Boolean {
        s.soTimeout = ms.toInt()
        return try { val buf = ByteArray(256); while (inp.read(buf) >= 0) { }; true } catch (e: java.net.SocketTimeoutException) { false } catch (e: Exception) { true }
    }
    private fun usedMb(): Long { val r = Runtime.getRuntime(); return (r.totalMemory() - r.freeMemory()) / (1024 * 1024) }

    // 1. Saludo que dice medir casi 48 MB y no manda nada más. El hub debe rechazar el primer marco por pasarse del
    //    tamaño de un saludo (unas decenas de bytes) y cerrar, sin reservar esos megas. Antes reservaba ByteArray(len)
    //    nada más leer el tamaño: con 6 conexiones así eran ~288 MB de golpe.
    @Test fun saludoGiganteSeRechazaSinReservarMemoria() {
        val rb = Rec(); val b = LanHub({ "nxbbbbbbbb" }, rb, autoPing = false); val pb = b.start()
        System.gc(); Thread.sleep(150); val before = usedMb()
        val socks = (1..6).map { raw(pb) }
        socks.forEach { (s, _) -> DataOutputStream(s.getOutputStream()).apply { writeInt(LanHub.MAX_FRAME - 1); flush() } }
        // Ninguna reserva de 48 MB: 6 saludos gigantes no pueden crecer cientos de MB
        Thread.sleep(300)
        val grew = usedMb() - before
        assertTrue(grew < 60, "el hub reservó ~${grew} MB con 6 saludos gigantes (antes del arreglo: cientos)")
        socks.forEach { (s, inp) -> assertTrue(closedWithin(s, inp, 2500), "el hub no cerró un saludo gigante"); s.close() }
        assertTrue(rb.up.isEmpty(), "un saludo gigante no debe quedar como contacto conectado")
        b.stop()
    }

    // 2. Saludo con basura (ni JSON ni NEXO ID): se cierra, no queda conexión.
    @Test fun saludoBasuraSeCierra() {
        val rb = Rec(); val b = LanHub({ "nxbbbbbbbb" }, rb, autoPing = false); val pb = b.start()
        val (s, inp) = raw(pb)
        val junk = ByteArray(40) { 0x41 }
        DataOutputStream(s.getOutputStream()).apply { writeInt(junk.size); write(junk); flush() }
        assertTrue(closedWithin(s, inp, 2500), "el hub no cerró un saludo con basura")
        assertTrue(rb.up.isEmpty()); s.close(); b.stop()
    }

    // 3. Avalancha: muchas conexiones que no saludan (ocupan sitio). El hub debe seguir atendiendo a un contacto de
    //    verdad y no crear hilos de lectura sin límite. Antes: un hilo "nexo-lan-read" por conexión, sin tope.
    @Test fun avalanchaNoDejaSinServicioNiCreaHilosSinFin() {
        val rb = Rec(); val b = LanHub({ "nxbbbbbbbb" }, rb, autoPing = false); val pb = b.start()
        val base = readerThreads()
        val flood = CopyOnWriteArrayList<Socket>()
        // 150 conexiones que se quedan calladas tras recibir el saludo del hub
        repeat(150) { try { flood.add(raw(pb).first) } catch (e: Exception) {} }
        Thread.sleep(600)
        val peak = readerThreads() - base
        assertTrue(peak <= 64, "hilos de lectura sin tope: $peak abiertos a la vez por conexiones que no saludan")
        // Un contacto de verdad se conecta igual, pese a la avalancha
        val ra = Rec(); val a = LanHub({ "nxaaaaaaaa" }, ra, autoPing = false); a.start()
        a.connect("127.0.0.1", pb)
        assertTrue(waitFor(6000) { a.isUp("nxbbbbbbbb") && b.isUp("nxaaaaaaaa") }, "un contacto de verdad no pudo conectarse durante la avalancha")
        assertTrue(a.send("nxbbbbbbbb", "hola"))
        assertTrue(waitFor { rb.msgs.any { it.second == "hola" } })
        flood.forEach { try { it.close() } catch (e: Exception) {} }
        a.stop(); b.stop()
    }
}
