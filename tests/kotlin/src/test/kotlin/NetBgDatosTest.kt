import com.nexo.ble.NetBg
import com.nexo.ble.NetBgSaved
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.io.InputStreamReader
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

/**
 * 3204 (dueño 17-11 «Ok» a 2 conexiones y 2 copias con datos móviles; parte nativa de la 3193), de punta a punta con 4 relés locales que
 * exigen identificarse (NIP-42) y DOS apps REALES (el código de la app compilado, netbg_helper.mjs): A manda con su NetLink.send real y
 * comprueba los ✓✓ con su NetLink real; B da la configuración de la escucha con su _bgConfig real (los relés en el orden común).
 *  1. Con «datos» la NetBg de B solo abre y se suscribe a los 2 primeros relés (REQ contados por relé: los otros 2, ninguno ni conexión).
 *  2. Un mensaje de A llega y el ✓✓ (aceptado por la app real de A) sale solo por esos 2.
 *  3. Se cae el 1.º: entra el 3.º (y llega lo siguiente); vuelve el 1.º: se suelta el 3.º.
 *  4. Un mensaje queda solo en los relés 3.º y 4.º (y luego llega otro, más nuevo, por todos): con datos no se ve; al pasar a «Wi-Fi»
 *     se escucha a los 4 y a los soltados se les pide desde que se soltaron: llega y se confirma.
 * Usa solo la API de antes más setNet (por reflexión): contraprueba con el NetBg de antes (sin setNet), que se suscribe a los 4.
 */
class NetBgDatosTest {
    private val helper = File("netbg_helper.mjs").absoluteFile

    private class Proc(val p: Process) {
        val lines = CopyOnWriteArrayList<String>()
        private val w: BufferedWriter = p.outputStream.bufferedWriter()
        init {
            val rd = BufferedReader(InputStreamReader(p.inputStream))
            Thread { try { while (true) { val l = rd.readLine() ?: break; lines.add(l) } } catch (e: Exception) { } }.apply { isDaemon = true; start() }
        }
        fun send(s: String) { w.write(s + "\n"); w.flush() }
        fun await(prefix: String, from: Int = 0, ms: Long = 20000): String {
            val t0 = System.currentTimeMillis()
            while (System.currentTimeMillis() - t0 < ms) {
                for (i in from until lines.size) { val l = lines[i]; if (l.startsWith(prefix)) return l.removePrefix(prefix).trim() }
                lines.drop(from).firstOrNull { it.startsWith("ERROR ") }?.let { fail("el ayudante falló: $it") }
                Thread.sleep(50)
            }
            fail("no llegó «$prefix»: $lines")
        }
        fun ask(cmd: String, prefix: String): String { val n = lines.size; send(cmd); return await(prefix, n) }
        fun close() { try { w.close() } catch (e: Exception) { }; p.destroy() }
    }
    private fun node(vararg args: String) = Proc(ProcessBuilder(listOf("node", helper.path) + args).redirectError(ProcessBuilder.Redirect.INHERIT).start())

    // La red del teléfono (3204: NetBg.setNet). Por reflexión: con el NetBg de antes no existe (escucha siempre todos)
    private fun host(u: String) = u.removePrefix("ws://").removePrefix("wss://").substringBefore('/')
    private fun setNet(bg: NetBg, type: String) { bg.javaClass.methods.firstOrNull { it.name == "setNet" }?.invoke(bg, type) }

    private class St(val reqs: Int, val subs: Int, val open: Int)
    private fun stats(relay: Proc): List<St> {
        val a = JSONArray(relay.ask("STATS", "STATS "))
        return (0 until a.length()).map { a.getJSONObject(it).let { o -> St(o.getInt("reqs"), o.getInt("subs"), o.getInt("open")) } }
    }
    // Espera a que los relés queden como se pide (y sigan así medio segundo: sin conexiones que se abren para soltarse enseguida)
    private fun waitStats(relay: Proc, ms: Long, ok: (List<St>) -> Boolean): List<St> {
        val t0 = System.currentTimeMillis()
        var s = stats(relay)
        while (System.currentTimeMillis() - t0 < ms) {
            if (ok(s)) { Thread.sleep(500); val s2 = stats(relay); if (ok(s2)) return s2; s = s2 } else { Thread.sleep(200); s = stats(relay) }
        }
        return s
    }
    private fun subs(s: List<St>) = s.map { it.subs }
    private fun opens(s: List<St>) = s.map { it.open }
    private fun waitFor(ms: Long, ok: () -> Boolean): Boolean { val t0 = System.currentTimeMillis(); while (!ok() && System.currentTimeMillis() - t0 < ms) Thread.sleep(100); return ok() }

    @Test fun conDatosEscuchaDosRelesYAlVolverAlWifiRecogeLoDeLosOtros() {
        val relay = node("multi", "4"); val peer = node("peer")
        var bg: NetBg? = null
        try {
            val urls = JSONArray(relay.await("URLS ")).let { a -> (0 until a.length()).map { a.getString(it) } }
            val pkA = relay.ask("PK", "PK ")
            val pkB = peer.await("PK ")
            val A = "nxaaaaaaaa"; val B = "nxbbbbbbbb"
            // La app B (real) da la configuración de la escucha: los relés en el orden común
            val n0 = peer.lines.size
            peer.send(JSONObject().put("cfg", JSONObject().put("me", B).put("relays", JSONArray(urls)).put("lastSeen", System.currentTimeMillis() - 3_600_000)
                .put("contacts", JSONArray().put(JSONObject().put("nx", A).put("name", "Ana").put("pk", pkA)))).toString())
            val cfg = NetBgSaved.fromApp(JSONObject(peer.await("CFG ", n0)))
            val ackApp = JSONObject(peer.await("ACK ", n0))
            assertEquals(urls, cfg.relays, "la app manda los relés en el orden común")
            val ack = HashMap<String, ByteArray>()
            val ka = ackApp.getJSONArray("keys"); for (i in 0 until ka.length()) ka.getJSONObject(i).let { ack[it.getString("nx")] = Base64.getDecoder().decode(it.getString("key")) }

            val got = CopyOnWriteArrayList<String>(); val logs = CopyOnWriteArrayList<String>()
            val b = NetBg({ _, _, msgId, _, _, _ -> got.add(msgId) }, { logs.add(it) })
            bg = b
            NetBgSaved.apply(b, NetBgSaved.Saved(cfg, ack))
            setNet(b, "cell")
            b.start()
            assertTrue(b.running)

            // 1. Con datos: suscripción solo en los 2 primeros; a los otros 2 ni se conecta
            var s = waitStats(relay, 10000) { st -> st[0].subs == 1 && st[1].subs == 1 }
            assertEquals(listOf(1, 1, 0, 0), subs(s), "con datos móviles, suscripción solo en los 2 primeros relés")
            assertEquals(0, s[2].reqs + s[3].reqs, "a los relés 3.º y 4.º no les llega ni un REQ")
            assertEquals(listOf(1, 1, 0, 0), opens(s), "ni se conecta a los otros 2")
            assertTrue(logs.any { it.contains("datos móviles, escucho 2 relés (${host(urls[0])}, ${host(urls[1])})") }, "registro: $logs")

            // 2. Un mensaje de A (por todos los relés) llega; el ✓✓ sale solo por los 2 escuchados y A (real) lo acepta
            val send = { id: String, only: List<Int>?, ago: Int ->
                val o = JSONObject().put("from", A).put("to", B).put("toPk", pkB).put("ago", ago)
                    .put("p", JSONObject().put("type", "chat").put("msgId", id).put("content", "hola $id").toString())
                if (only != null) o.put("only", JSONArray(only))
                JSONArray(relay.ask(JSONObject().put("send", o).toString(), "PUBLISHED "))
            }
            assertEquals(4, send("dm1", null, 0).length())
            assertTrue(waitFor(10000) { "dm1" in got }, "llegó el mensaje: $got")
            Thread.sleep(800)
            var acks = JSONArray(relay.ask(JSONObject().put("acks", JSONObject().put("me", A).put("peer", B).put("peerPk", pkB)).toString(), "ACKS "))
            val a1 = (0 until acks.length()).map { acks.getJSONObject(it) }.filter { it.getString("msgId") == "dm1" }
            assertEquals(1, a1.size, "un ✓✓ de dm1: $acks")
            assertTrue(a1[0].getBoolean("ok"), "✓✓ firmado y aceptado por la app real de A")
            assertEquals(listOf(0, 1), a1[0].getJSONArray("on").let { a -> (0 until a.length()).map { a.getInt(it) } }, "el ✓✓ sale por los 2 relés escuchados")

            // 3. Se cae el 1.º: entra el 3.º (el 4.º sigue sin conexión) y lo siguiente llega
            relay.ask("{\"down\":0}", "DOWN ")
            s = waitStats(relay, 10000) { st -> st[1].subs == 1 && st[2].subs == 1 }
            assertEquals(listOf(0, 1, 1, 0), subs(s), "cayó el 1.º: se escucha el 2.º y el 3.º")
            assertEquals(0, s[3].reqs + s[3].open, "el 4.º, nada")
            send("dm2", null, 0)
            assertTrue(waitFor(10000) { "dm2" in got }, "llegó con el 1.º caído: $got")
            // vuelve el 1.º (pasada su espera de reintento): se escucha otra vez y se suelta el 3.º
            relay.ask("{\"up\":0}", "UP ")
            s = waitStats(relay, 25000) { st -> st[0].subs == 1 && st[2].open == 0 }
            assertEquals(listOf(1, 1, 0, 0), subs(s), "volvió el 1.º: otra vez el 1.º y el 2.º")
            assertEquals(listOf(1, 1, 0, 0), opens(s), "el 3.º se soltó")

            // 4. Un mensaje queda SOLO en el 3.º y el 4.º (de hace 3 s); luego otro, nuevo, por todos: el since común lo deja atrás
            assertEquals(listOf(2, 3), send("dm3", listOf(2, 3), 3).let { a -> (0 until a.length()).map { a.getInt(it) } })
            send("dm4", null, 0)
            assertTrue(waitFor(10000) { "dm4" in got }, "llegó el nuevo: $got")
            Thread.sleep(1500)
            assertFalse("dm3" in got, "con datos, lo que quedó solo en los relés no escuchados no se ve todavía")
            // al Wi-Fi: los 4, y a los soltados se les pide desde que se soltaron
            setNet(b, "wifi")
            assertTrue(waitFor(15000) { "dm3" in got }, "al volver al Wi-Fi llegó lo que quedó solo en los otros relés: $got")
            s = waitStats(relay, 10000) { st -> st.all { it.subs == 1 } }
            assertEquals(listOf(1, 1, 1, 1), subs(s), "con Wi-Fi, suscripción en los 4")
            assertTrue(logs.any { it.contains("Wi-Fi, escucho todos los relés (4)") }, "registro: $logs")
            Thread.sleep(800)
            acks = JSONArray(relay.ask(JSONObject().put("acks", JSONObject().put("me", A).put("peer", B).put("peerPk", pkB)).toString(), "ACKS "))
            val ok = (0 until acks.length()).map { acks.getJSONObject(it) }.filter { it.getBoolean("ok") && it.getString("from") == B }.map { it.getString("msgId") }.toSet()
            assertEquals(setOf("dm1", "dm2", "dm3", "dm4"), ok, "✓✓ de todos, aceptados por la app real de A: $acks")
            assertEquals(1, got.count { it == "dm3" }, "una sola vez: $got")
            println("Registro de la NetBg:\n  " + logs.joinToString("\n  "))
        } finally { try { bg?.stop() } catch (e: Exception) { }; relay.close(); peer.close() }
    }

    // 3205 (hueco de la 3204): al volver la app, la NetBg se para y olvidaba desde cuándo soltó cada relé con datos: la app (que pide desde
    // lo último que vio − 10 min) no recogía lo que quedó solo en ellos. Ahora stop() se los guarda y netBgDrain se los pasa (una vez).
    // Por reflexión (drainGapsForApp): contraprueba con el NetBg de antes, que no lo tiene.
    @Suppress("UNCHECKED_CAST")
    private fun gaps(bg: NetBg): Map<String, Long>? = bg.javaClass.methods.firstOrNull { it.name == "drainGapsForApp" }?.invoke(bg) as Map<String, Long>?

    @Test fun alVolverLaAppLePasaLosRelesSoltadosConDatos() {
        val relay = node("multi", "4"); val peer = node("peer")
        var bg: NetBg? = null
        try {
            val urls = JSONArray(relay.await("URLS ")).let { a -> (0 until a.length()).map { a.getString(it) } }
            val pkA = relay.ask("PK", "PK ")
            peer.await("PK ")
            val A = "nxaaaaaaaa"; val B = "nxbbbbbbbb"
            val n0 = peer.lines.size
            peer.send(JSONObject().put("cfg", JSONObject().put("me", B).put("relays", JSONArray(urls)).put("lastSeen", System.currentTimeMillis() - 3_600_000)
                .put("contacts", JSONArray().put(JSONObject().put("nx", A).put("name", "Ana").put("pk", pkA)))).toString())
            val cfg = NetBgSaved.fromApp(JSONObject(peer.await("CFG ", n0)))
            peer.await("ACK ", n0)
            val b = NetBg({ _, _, _, _, _, _ -> }, { })
            bg = b
            NetBgSaved.apply(b, NetBgSaved.Saved(cfg, HashMap()))
            setNet(b, "cell")
            b.start()
            val s = waitStats(relay, 10000) { st -> st[0].subs == 1 && st[1].subs == 1 }
            assertEquals(listOf(1, 1, 0, 0), subs(s), "con datos móviles, solo los 2 primeros")
            val since = b.lastSeen()
            // la app recoge antes de que se pare la escucha: ya le toca (y no se repite en la siguiente recogida)
            val g1 = gaps(b)
            assertNotNull(g1, "netBgDrain pasa los relés soltados (drainGapsForApp)")
            assertEquals(mapOf(urls[2] to since, urls[3] to since), g1, "los 2 soltados, desde lo último visto al soltarlos")
            // vuelve la app: se para la escucha (antes: lo pendiente se olvidaba aquí) y la app lo recoge después
            b.stop()
            assertEquals(mapOf(urls[2] to since, urls[3] to since), gaps(b), "parada la escucha, la app aún los recibe")
            assertEquals(emptyMap(), gaps(b), "una sola vez")
            // otra vez con datos (soltados de nuevo) y luego el Wi-Fi con la escucha en marcha: ella misma les pide lo suyo, y al pararse
            // ya no queda nada que pasar a la app
            b.start()
            assertEquals(listOf(1, 1, 0, 0), subs(waitStats(relay, 10000) { st -> st[0].subs == 1 && st[1].subs == 1 && st[2].subs == 0 }), "otra vez con datos")
            setNet(b, "wifi")
            assertTrue(waitFor(15000) { stats(relay).all { it.subs == 1 } }, "con Wi-Fi, los 4")
            Thread.sleep(1500)
            b.stop()
            assertEquals(emptyMap(), gaps(b), "ya pedido a todos (EOSE): nada pendiente")
        } finally { try { bg?.stop() } catch (e: Exception) { }; relay.close(); peer.close() }
    }
}
