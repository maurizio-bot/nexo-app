import com.nexo.ble.ServerFlapPolicy
import com.nexo.ble.ServerFlapPolicy.Companion.ADV_NO
import com.nexo.ble.ServerFlapPolicy.Companion.ADV_NOW
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// 3203 (diagnóstico de Roberto, Motorola edge 40 neo 3087, 17-11 09:32): con NEXO en segundo plano, un teléfono sin identificar
// (…0da5) entró y salió del servidor GATT cada ~36 s de 09:18:58 a 09:32: por vuelta, «Connection … newState=…» en el registro,
// «Reanudando advertising tras desconexion» (BleService relanzado) y dos avisos a la app («Enlace ? (0da5) desconectado ×21»).
// Freno (ServerFlapPolicy): 3 vueltas sin decir nada en 5 min → sus conexiones se cierran al entrar, en silencio, 5 min (el doble si
// sigue igual, hasta 20); nunca a un contacto, a quien habla ni a un enlace nuestro de cliente; el anuncio, agrupado.
class ServerFlapPolicyTest {
    private val MAC = "4bf17f560da5"
    private val CONTACT = "6c0a9e11beef"

    // Lo que hace el pegamento de PluginBtState.kt (onConnectionStateChange) con cada aviso del servidor GATT, contado.
    // p == null: el código de antes (HEAD cc2fc9d6, PluginBtState.kt:282-312): registra cada cambio, avisa a la app de todo y relanza
    // BleService («Reanudando advertising…») en CADA desconexión (con el anuncio activo, como en el diagnóstico).
    private class Glue(val p: ServerFlapPolicy?) {
        var lines = 0; var restarts = 0; var refused = 0; var jsEvents = 0
        val refusedAt = mutableListOf<Long>()
        val brakeLines = mutableListOf<String>()
        val restartAt = mutableListOf<Long>()
        private val timers = mutableListOf<Long>() // mainHandler.postDelayed del reinicio aplazado
        fun tick(now: Long) {
            val due = timers.filter { it <= now }.sorted()
            timers.removeAll(due)
            for (t in due) if (p!!.advDue(t)) { restarts++; restartAt += t; lines++ }
        }
        fun connect(mac: String, now: Long, trusted: Boolean = false) {
            tick(now)
            if (p != null && p.onConnect(mac, now, trusted)) { refused++; refusedAt += now; return } // cancelConnection, sin registro ni aviso
            lines++; jsEvents++
        }
        fun disconnect(mac: String, now: Long, trusted: Boolean = false) {
            tick(now)
            if (p == null) { lines++; jsEvents++; restarts++; restartAt += now; lines++; return }
            val d = p.onDisconnect(mac, now, trusted)
            if (d.quiet) return
            lines++; jsEvents++
            if (d.brakeMs > 0) { lines++; brakeLines += p.brakeLine(mac, d) }
            if (d.adv == ADV_NOW) { restarts++; restartAt += now; lines++ } else if (d.adv > 0) timers += now + d.adv
        }
    }

    // Un teléfono que entra (t) y sale (t + stayMs) cada periodMs, de fromMs a toMs. speak: dice algo en cada conexión.
    private fun flap(g: Glue, mac: String, fromMs: Long, toMs: Long, periodMs: Long = 36_000L, stayMs: Long = 6_000L,
                     trusted: Boolean = false, speak: (Int) -> Boolean = { false }): Int {
        var t = fromMs; var n = 0
        while (t < toMs) {
            g.connect(mac, t, trusted)
            if (speak(n)) g.p?.spoke(mac, t + 500)
            g.disconnect(mac, t + stayMs, trusted)
            t += periodMs; n++
        }
        g.tick(toMs + 120_000L)
        return n
    }

    @Test fun desconocidoCada36sDiezMinutos() {
        val antes = Glue(null); val vueltas = flap(antes, MAC, 0, 600_000L)
        val g = Glue(ServerFlapPolicy()); flap(g, MAC, 0, 600_000L)
        println("FLAP10MIN vueltas=$vueltas antes{reinicios=${antes.restarts} lineas=${antes.lines} avisos_app=${antes.jsEvents}} " +
            "despues{reinicios=${g.restarts} en=${g.restartAt} lineas=${g.lines} avisos_app=${g.jsEvents} cerradas=${g.refused} frenos=${g.brakeLines}}")
        assertEquals(17, vueltas)
        assertEquals(vueltas, antes.restarts, "antes: un reinicio del anuncio por vuelta")
        // Entra en el freno en la 3.ª salida (78 s); hasta caducar (378 s) ninguna conexión pasa y ningún reinicio más que el de la
        // entrada (aplazado al final de su plazo de 60 s: 126 s)
        assertTrue(g.brakeLines.size >= 1 && g.brakeLines[0].contains("…0da5") && g.brakeLines[0].contains("lo freno 5 min"), "${g.brakeLines}")
        assertEquals(listOf(6_000L, 66_000L, 126_000L), g.restartAt.filter { it < 378_000L }, "uno al entrar en el freno y ninguno más hasta que caduque")
        assertEquals(0, g.restartAt.count { it in 126_001L until 378_000L })
        assertEquals(listOf(108_000L, 144_000L, 180_000L, 216_000L, 252_000L, 288_000L, 324_000L, 360_000L), g.refusedAt.filter { it < 378_000L }, "las 8 conexiones del primer freno, cerradas al entrar")
        // A los 396 s (ya caducado) vuelve a entrar y salir sin decir nada: otro freno, de 10 min (una línea, un reinicio)
        assertEquals(2, g.brakeLines.size, "${g.brakeLines}")
        assertTrue(g.brakeLines[1].contains("sigue entrando y saliendo") && g.brakeLines[1].contains("lo freno 10 min"), g.brakeLines[1])
        assertEquals(4, g.restarts, "antes 17")
        assertTrue(g.lines <= 14, "líneas antes ${antes.lines}, después ${g.lines}")
        assertEquals(8, g.jsEvents, "a la app solo las 4 conexiones que pasaron (antes ${antes.jsEvents})")
    }

    @Test fun diagnosticoDeRoberto() {
        // 09:18:58 → 09:32:04 (vuelta a la app), una vuelta cada 36 s
        val dur = (13 * 60 + 6) * 1000L
        val antes = Glue(null); val vueltas = flap(antes, MAC, 0, dur)
        val g = Glue(ServerFlapPolicy()); flap(g, MAC, 0, dur)
        println("ROBERTO vueltas=$vueltas antes{reinicios=${antes.restarts} lineas=${antes.lines} avisos_app=${antes.jsEvents}} " +
            "despues{reinicios=${g.restarts} lineas=${g.lines} avisos_app=${g.jsEvents} cerradas=${g.refused} frenos=${g.brakeLines.size}}")
        assertEquals(22, vueltas)
        assertEquals(22, antes.restarts); assertEquals(44, antes.jsEvents)
        assertEquals(4, g.restarts)
        assertEquals(8, g.jsEvents, "al volver a la app: 4 desconexiones de …0da5 en vez de 22")
        assertEquals(18, g.refused)
        assertEquals(2, g.brakeLines.size)
    }

    @Test fun contactoNoSeFrena() {
        // Un contacto (el nativo lo conoce) o un enlace nuestro de cliente que entra y sale igual: todo como antes
        val g = Glue(ServerFlapPolicy()); val n = flap(g, CONTACT, 0, 600_000L, trusted = true)
        assertEquals(0, g.refused); assertTrue(g.brakeLines.isEmpty())
        assertEquals(n, g.restarts, "cada salida de un contacto reanuda el anuncio al momento, como antes")
        assertEquals(2 * n, g.jsEvents)
    }

    @Test fun quienHablaNoSeFrena() {
        val g = Glue(ServerFlapPolicy()); val n = flap(g, MAC, 0, 600_000L, speak = { true })
        assertEquals(0, g.refused); assertTrue(g.brakeLines.isEmpty()); assertEquals(n, g.restarts)
        // y basta con que haya hablado una vez (mientras se recuerde la dirección)
        val g2 = Glue(ServerFlapPolicy()); flap(g2, MAC, 0, 600_000L, speak = { it == 0 })
        assertEquals(0, g2.refused); assertTrue(g2.brakeLines.isEmpty())
        // si habla en plena racha, se le quita el freno
        val p = ServerFlapPolicy(); val g3 = Glue(p)
        flap(g3, MAC, 0, 100_000L)
        assertTrue(p.braked(MAC, 100_000L))
        p.spoke(MAC, 100_500L)
        assertFalse(p.braked(MAC, 100_500L))
        assertFalse(p.onConnect(MAC, 101_000L, false))
    }

    @Test fun elFrenoCaducaSolo() {
        val p = ServerFlapPolicy(); val g = Glue(p)
        flap(g, MAC, 0, 100_000L) // 3 vueltas: frenado de 78 s a 378 s
        assertTrue(p.braked(MAC, 377_999L))
        assertFalse(p.braked(MAC, 378_000L), "caduca solo")
        assertFalse(p.onConnect(MAC, 378_000L, false), "y su conexión vuelve a pasar")
        // si entonces habla (era un NEXO), no vuelve a frenarse
        p.spoke(MAC, 378_500L)
        assertFalse(p.onDisconnect(MAC, 380_000L, false).quiet)
        assertEquals(0, p.onDisconnect(MAC, 380_000L, false).brakeMs)
        // un enlace nuestro de cliente con esa dirección durante el freno: nunca se cierra
        val p2 = ServerFlapPolicy(); flap(Glue(p2), MAC, 0, 100_000L)
        assertFalse(p2.onConnect(MAC, 120_000L, trusted = true))
        assertFalse(p2.onDisconnect(MAC, 125_000L, trusted = true).quiet)
    }

    @Test fun elFrenoSeDoblaHastaElTope() {
        val g = Glue(ServerFlapPolicy()); flap(g, MAC, 0, 3 * 3600_000L)
        val mins = g.brakeLines.map { Regex("lo freno (\\d+) min").find(it)!!.groupValues[1].toInt() }
        println("FLAP3H frenos=$mins reinicios=${g.restarts} avisos_app=${g.jsEvents} cerradas=${g.refused}")
        assertEquals(listOf(5, 10, 20), mins.take(3))
        assertTrue(mins.all { it <= 20 }, "tope 20 min: $mins")
        assertTrue(g.restarts <= mins.size + 2, "${g.restarts} reinicios en 3 h (antes ${3 * 3600 / 36})")
    }

    @Test fun direccionesQueRotanSeOlvidan() {
        val p = ServerFlapPolicy()
        // 200 direcciones distintas (rotan), una vuelta cada una: ninguna se frena y la memoria no pasa del tope
        for (i in 0 until 200) { val m = "aa%010x".format(i); assertFalse(p.onConnect(m, i * 1000L, false)); assertEquals(0, p.onDisconnect(m, i * 1000L + 500, false).brakeMs) }
        assertTrue(p.size() <= ServerFlapPolicy.MAX_ENTRIES, "${p.size()}")
        // una dirección nueva empieza de cero (2 vueltas no frenan)
        val g = Glue(p); flap(g, "bb0000000001", 300_000L, 372_000L)
        assertTrue(g.brakeLines.isEmpty())
        // lo que no se ve en 30 min se olvida
        p.onConnect("cc0000000001", 400_000L, false); p.onDisconnect("cc0000000001", 401_000L, false)
        p.onConnect("cc0000000002", 400_000L + ServerFlapPolicy.FORGET_MS + 2_000L, false)
        assertEquals(1, p.size())
    }

    @Test fun anuncioAgrupadoSinPerderElUltimo() {
        val p = ServerFlapPolicy()
        assertEquals(ADV_NOW, p.onDisconnect("dd0000000001", 0L, false).adv)
        val d = p.onDisconnect("dd0000000002", 10_000L, false)
        assertEquals(50_000L, d.adv, "pedido a los 10 s: sale al final del plazo (60 s)")
        assertEquals(ADV_NO, p.onDisconnect("dd0000000003", 20_000L, false).adv, "ya hay uno aplazado: no se duplica")
        assertTrue(p.advDue(60_000L), "el último pedido no se pierde")
        assertFalse(p.advDue(60_001L))
        // una ráfaga de 24 salidas sin identificar en el mismo instante: 1 ahora + 1 al final del plazo
        val q = ServerFlapPolicy(); var now = 0; var later = 0
        for (i in 0 until 24) { val a = q.onDisconnect("ee%010x".format(i), 1_000L, false).adv; if (a == ADV_NOW) now++ else if (a > 0) later++ }
        assertEquals(1, now); assertEquals(1, later)
        // un contacto que sale entre medias ya reanudó: el aplazado no se repite
        val r = ServerFlapPolicy()
        r.onDisconnect("ff0000000001", 0L, false)
        assertTrue(r.onDisconnect("ff0000000002", 5_000L, false).adv > 0)
        assertEquals(ADV_NOW, r.onDisconnect(CONTACT, 30_000L, trusted = true).adv, "un contacto: al momento, como antes")
        assertFalse(r.advDue(60_000L), "ya se reanudó a los 30 s")
    }

    @Test fun lineaDelRegistro() {
        val p = ServerFlapPolicy(); val g = Glue(p)
        flap(g, MAC, 0, 100_000L)
        assertEquals("Teléfono sin identificar …0da5 entra y sale (3 veces en 72 s, sin decir quién es): lo freno 5 min", g.brakeLines.single())
        val d = ServerFlapPolicy.Disc(quiet = false, adv = ADV_NOW, brakeMs = 600_000L, again = true, refusedBefore = 8)
        assertEquals("Teléfono sin identificar …0da5 sigue entrando y saliendo (el freno anterior cerró 8 conexiones): lo freno 10 min", p.brakeLine(MAC, d))
    }

    // El pegamento (que en JVM no compila: usa Android) pasa por el freno: contraprueba con HEAD cc2fc9d6, donde no existía
    @Test fun elServidorGattUsaElFreno() {
        var d: File? = File(System.getProperty("user.dir")).absoluteFile
        while (d != null && !File(d, "plugins/nexo-ble/android/src/main/java/com/nexo/ble/PluginBtState.kt").isFile) d = d.parentFile
        val dir = File(assertNotNull(d, "no encuentro la raíz del repositorio"), "plugins/nexo-ble/android/src/main/java/com/nexo/ble")
        val bt = File(dir, "PluginBtState.kt").readText(); val rx = File(dir, "PluginRx.kt").readText()
        assertTrue(bt.contains("serverFlap.onConnect(mac, now, serverPeerTrusted(mac))") && bt.contains("cancelConnection(device)"), "la conexión frenada se cierra al entrar")
        assertTrue(bt.contains("serverFlap.onDisconnect(mac, now, serverPeerTrusted(mac))") && bt.contains("serverFlap.advDue("), "la salida pasa por el freno y el anuncio va agrupado")
        assertEquals(1, Regex("Reanudando advertising tras desconexion").findAll(bt).count(), "un solo sitio relanza BleService tras una desconexión")
        assertEquals(2, Regex("serverFlap\\.spoke\\(").findAll(rx).count(), "un mensaje completo (texto o binario) marca que habló")
    }
}
