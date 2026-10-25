import com.nexo.ble.LanHub
import java.net.Socket
import java.io.DataOutputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.CountDownLatch
import kotlin.test.*

class LanHubTest {
    class Rec : LanHub.Listener {
        val up = CopyOnWriteArrayList<String>(); val down = CopyOnWriteArrayList<String>(); val msgs = CopyOnWriteArrayList<Pair<String, String>>()
        override fun onUp(nx: String) { up.add(nx) }
        override fun onDown(nx: String) { down.add(nx) }
        override fun onMessage(nx: String, text: String) { msgs.add(nx to text) }
    }
    private fun waitFor(ms: Long = 5000, f: () -> Boolean): Boolean { val t0 = System.currentTimeMillis(); while (System.currentTimeMillis() - t0 < ms) { if (f()) return true; Thread.sleep(10) }; return f() }

    @Test fun conectaSaludaYMandaEnLosDosSentidos() {
        val ra = Rec(); val rb = Rec()
        val a = LanHub({ "nxaaaaaaaa" }, ra); val b = LanHub({ "nxbbbbbbbb" }, rb)
        a.start(); val pb = b.start()
        a.connect("127.0.0.1", pb)
        assertTrue(waitFor { a.isUp("nxbbbbbbbb") && b.isUp("nxaaaaaaaa") })
        assertEquals(listOf("nxbbbbbbbb"), ra.up); assertEquals(listOf("nxaaaaaaaa"), rb.up)
        assertTrue(a.send("nxbbbbbbbb", """{"v":1,"t":"x","d":"hola ñ €"}"""))
        assertTrue(b.send("nxaaaaaaaa", "respuesta"))
        assertTrue(waitFor { rb.msgs.size == 1 && ra.msgs.size == 1 })
        assertEquals("nxaaaaaaaa" to """{"v":1,"t":"x","d":"hola ñ €"}""", rb.msgs[0])
        assertEquals("nxbbbbbbbb" to "respuesta", ra.msgs[0])
        a.stop(); b.stop()
    }

    @Test fun mensajesGrandesYMuchosEnOrden() {
        val ra = Rec(); val rb = Rec()
        val a = LanHub({ "nxaaaaaaaa" }, ra); val b = LanHub({ "nxbbbbbbbb" }, rb)
        a.start(); a.connect("127.0.0.1", b.start())
        assertTrue(waitFor { a.isUp("nxbbbbbbbb") })
        val big = "B".repeat(8_000_000)
        val t0 = System.currentTimeMillis()
        assertTrue(a.send("nxbbbbbbbb", big))
        repeat(500) { assertTrue(a.send("nxbbbbbbbb", "m$it")) }
        assertTrue(waitFor(20000) { rb.msgs.size == 501 })
        println("8 MB + 500 mensajes por Wi-Fi (local) en ${System.currentTimeMillis() - t0} ms")
        assertEquals(big, rb.msgs[0].second)
        assertEquals((0 until 500).map { "m$it" }, rb.msgs.drop(1).map { it.second })
        a.stop(); b.stop()
    }

    @Test fun conexionSimultaneaQuedaUna() {
        repeat(5) {
            val ra = Rec(); val rb = Rec()
            val a = LanHub({ "nxaaaaaaaa" }, ra); val b = LanHub({ "nxbbbbbbbb" }, rb)
            val pa = a.start(); val pb = b.start()
            a.connect("127.0.0.1", pb); b.connect("127.0.0.1", pa)
            assertTrue(waitFor { a.isUp("nxbbbbbbbb") && b.isUp("nxaaaaaaaa") })
            Thread.sleep(300)
            // Sigue habiendo una conexión que funciona en los dos sentidos
            assertTrue(a.send("nxbbbbbbbb", "x$it")); assertTrue(b.send("nxaaaaaaaa", "y$it"))
            assertTrue(waitFor { rb.msgs.any { m -> m.second == "x$it" } && ra.msgs.any { m -> m.second == "y$it" } }, "intento $it")
            assertTrue(a.isUp("nxbbbbbbbb") && b.isUp("nxaaaaaaaa"))
            a.stop(); b.stop()
        }
    }

    @Test fun caidaAvisaYEnviarDevuelveFalse() {
        val ra = Rec(); val rb = Rec()
        val a = LanHub({ "nxaaaaaaaa" }, ra); val b = LanHub({ "nxbbbbbbbb" }, rb)
        a.start(); a.connect("127.0.0.1", b.start())
        assertTrue(waitFor { a.isUp("nxbbbbbbbb") })
        b.stop()
        assertTrue(waitFor { ra.down.contains("nxbbbbbbbb") }, "A se entera de que B se fue")
        assertFalse(a.send("nxbbbbbbbb", "nadie"))
        a.stop()
    }

    @Test fun cerrarUnContactoAvisaALosDos() {
        val ra = Rec(); val rb = Rec()
        val a = LanHub({ "nxaaaaaaaa" }, ra); val b = LanHub({ "nxbbbbbbbb" }, rb)
        a.start(); a.connect("127.0.0.1", b.start())
        assertTrue(waitFor { a.isUp("nxbbbbbbbb") && b.isUp("nxaaaaaaaa") })
        a.close("nxbbbbbbbb")
        assertTrue(waitFor { ra.down.contains("nxbbbbbbbb") && rb.down.contains("nxaaaaaaaa") })
        assertFalse(a.isUp("nxbbbbbbbb"))
        a.stop(); b.stop()
    }

    // La app en segundo plano no manda nada: el latido nativo mantiene la conexión y mide la calidad
    @Test fun latidoNativoMantieneLaConexionSinMensajesDeLaApp() {
        val ra = Rec(); val rb = Rec()
        val a = LanHub({ "nxaaaaaaaa" }, ra, pingMs = 100, deadMs = 600); val b = LanHub({ "nxbbbbbbbb" }, rb, pingMs = 100, deadMs = 600)
        a.start(); a.connect("127.0.0.1", b.start())
        assertTrue(waitFor { a.isUp("nxbbbbbbbb") && b.isUp("nxaaaaaaaa") })
        Thread.sleep(2500) // 4 veces el tiempo de corte, sin ningún mensaje de la app
        assertTrue(a.isUp("nxbbbbbbbb") && b.isUp("nxaaaaaaaa"), "sigue conectado")
        assertTrue(ra.down.isEmpty() && rb.down.isEmpty())
        assertTrue(ra.msgs.isEmpty() && rb.msgs.isEmpty(), "los latidos no llegan a la app")
        val q = a.quality().single()
        println("calidad: ${q.first} ida y vuelta ${q.second} ms, sin recibir ${q.third} ms")
        assertEquals("nxbbbbbbbb", q.first); assertTrue(q.second in 0..200); assertTrue(q.third < 600)
        a.stop(); b.stop()
    }

    // El otro deja de contestar sin cerrar (Wi-Fi perdido): se detecta por el latido
    @Test fun otroMudoSeDetecta() {
        val ra = Rec()
        val a = LanHub({ "nxaaaaaaaa" }, ra, pingMs = 100, deadMs = 600)
        val pa = a.start()
        val s = Socket("127.0.0.1", pa)
        val out = DataOutputStream(s.getOutputStream()); val h = """{"h":1,"nx":"nxcccccccc"}""".toByteArray(); out.writeInt(h.size); out.write(h); out.flush()
        assertTrue(waitFor { a.isUp("nxcccccccc") })
        assertTrue(waitFor(3000) { ra.down.contains("nxcccccccc") }, "detectado sin respuesta")
        s.close(); a.stop()
    }

    // Ronda 2772 (pantalla apagada): el teléfono durmió más que el tiempo de corte (el hilo del latido no corrió, el reloj
    // sí). Al despertar no cierra un enlace sano sin preguntar: manda un ping y, si el otro contesta, sigue
    @Test fun alDespertarPreguntaAntesDeCerrar() {
        var t = 1_000_000L
        val ra = Rec(); val rb = Rec()
        val a = LanHub({ "nxaaaaaaaa" }, ra, pingMs = 4_000L, deadMs = 30_000L, clock = { t }, autoPing = false)
        val b = LanHub({ "nxbbbbbbbb" }, rb, pingMs = 4_000L, deadMs = 30_000L, autoPing = false)
        a.start(); a.connect("127.0.0.1", b.start())
        assertTrue(waitFor { a.isUp("nxbbbbbbbb") && b.isUp("nxaaaaaaaa") })
        t += 60_000 // A durmió 60 s sin recibir nada
        a.tick(t, 60_000)
        assertTrue(a.isUp("nxbbbbbbbb"), "no cierra sin preguntar")
        assertTrue(waitFor { a.quality().single().third < 1000 }, "el otro contesta al ping")
        t += 4_000; a.tick(t, 4_000)
        assertTrue(a.isUp("nxbbbbbbbb") && ra.down.isEmpty(), "sigue conectado")
        a.stop(); b.stop()
    }

    // Ronda 2772: al despertar, si el otro no contesta dentro del margen, se cierra
    @Test fun alDespertarSiNoContestaCierra() {
        var t = 1_000_000L
        val ra = Rec()
        val a = LanHub({ "nxaaaaaaaa" }, ra, pingMs = 4_000L, deadMs = 30_000L, clock = { t }, autoPing = false)
        val pa = a.start()
        val s = Socket("127.0.0.1", pa) // saluda y no contesta nada más
        val out = DataOutputStream(s.getOutputStream()); val h = """{"h":1,"nx":"nxcccccccc"}""".toByteArray(); out.writeInt(h.size); out.write(h); out.flush()
        assertTrue(waitFor { a.isUp("nxcccccccc") })
        t += 60_000; a.tick(t, 60_000)
        assertTrue(a.isUp("nxcccccccc"), "primero pregunta")
        t += 4_000; a.tick(t, 4_000)
        assertTrue(a.isUp("nxcccccccc"), "dentro del margen sigue")
        t += 5_000; a.tick(t, 4_000)
        assertTrue(waitFor { ra.down.contains("nxcccccccc") }, "sin respuesta tras el margen: se cierra")
        s.close(); a.stop()
    }

    // Despierto (sin dormir), lo de antes: el que no contesta en deadMs se cierra en la primera vuelta que lo ve
    @Test fun despiertoSinRespuestaCierraEnSeguida() {
        var t = 1_000_000L
        val ra = Rec()
        val a = LanHub({ "nxaaaaaaaa" }, ra, pingMs = 4_000L, deadMs = 30_000L, clock = { t }, autoPing = false)
        val pa = a.start()
        val s = Socket("127.0.0.1", pa)
        val out = DataOutputStream(s.getOutputStream()); val h = """{"h":1,"nx":"nxdddddddd"}""".toByteArray(); out.writeInt(h.size); out.write(h); out.flush()
        assertTrue(waitFor { a.isUp("nxdddddddd") })
        repeat(8) { t += 4_000; a.tick(t, 4_000) } // 32 s despierto, cada 4 s, sin respuesta
        assertTrue(waitFor { ra.down.contains("nxdddddddd") }, "cerrado sin margen")
        s.close(); a.stop()
    }

    @Test fun saludoFalsoOPropioSeRechaza() {
        val ra = Rec()
        val a = LanHub({ "nxaaaaaaaa" }, ra)
        val pa = a.start()
        for (hello in listOf("""{"h":1,"nx":"nxaaaaaaaa"}""", """{"h":1,"nx":"pepe"}""", """{"x":1}""")) {
            Socket("127.0.0.1", pa).use { s ->
                val out = DataOutputStream(s.getOutputStream()); val b = hello.toByteArray(); out.writeInt(b.size); out.write(b); out.flush()
                Thread.sleep(300)
            }
        }
        // Basura: longitud absurda
        Socket("127.0.0.1", pa).use { s -> DataOutputStream(s.getOutputStream()).apply { writeInt(Int.MAX_VALUE); flush() }; Thread.sleep(200) }
        assertTrue(ra.up.isEmpty(), "ninguna conexión aceptada: ${ra.up}")
        a.stop()
    }
}
