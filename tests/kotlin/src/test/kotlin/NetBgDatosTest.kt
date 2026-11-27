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
 *  FASE 1 (28-11): ya no se escuchan solo 2 con datos (se quitó, contrato B.5.5): la NetBg escucha los 4, como la app.
 *  1. (3204, hasta la 3167) Con «datos» la NetBg de B solo abría y se suscribía a los 2 primeros relés.
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

            // Fase 1 (28-11, contrato B.5.5): con datos móviles la NetBg escucha los 4 (la MISMA lista que la app, que ya escuchaba todos):
            // lo que un contacto deja solo en el 3.º y el 4.º llega también con datos (caso S23 27-11 21:53). Antes (3204–3167): solo 2.
            // 1. Con datos: suscripción en los 4
            var s = waitStats(relay, 10000) { st -> st.all { it.subs == 1 } }
            assertEquals(listOf(1, 1, 1, 1), subs(s), "con datos móviles, suscripción en los 4 relés (como la app)")
            assertFalse(logs.any { it.contains("datos móviles, escucho 2 relés") }, "ya no se sueltan relés con datos: $logs")

            // 2. Un mensaje de A (por todos los relés) llega; el ✓✓ sale por los relés abiertos y A (real) lo acepta
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

            // 3. Se cae el 1.º: los otros 3 siguen escuchando y lo siguiente llega
            relay.ask("{\"down\":0}", "DOWN ")
            send("dm2", null, 0)
            assertTrue(waitFor(10000) { "dm2" in got }, "llegó con el 1.º caído: $got")
            relay.ask("{\"up\":0}", "UP ")
            s = waitStats(relay, 25000) { st -> st.all { it.subs == 1 } }
            assertEquals(listOf(1, 1, 1, 1), subs(s), "volvió el 1.º: otra vez los 4")

            // 4. Un mensaje queda SOLO en el 3.º y el 4.º: con datos llega igual (antes había que esperar al Wi-Fi)
            assertEquals(listOf(2, 3), send("dm3", listOf(2, 3), 0).let { a -> (0 until a.length()).map { a.getInt(it) } })
            assertTrue(waitFor(10000) { "dm3" in got }, "con datos llegó lo que quedó solo en los relés 3.º y 4.º: $got")
            send("dm4", null, 0)
            assertTrue(waitFor(10000) { "dm4" in got }, "llegó el nuevo: $got")
            setNet(b, "wifi")
            Thread.sleep(1500)
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
            // Fase 1 (28-11): con datos ya no se suelta ningún relé (la misma escucha que la app): no queda nada que pasar a la app
            val s = waitStats(relay, 10000) { st -> st.all { it.subs == 1 } }
            assertEquals(listOf(1, 1, 1, 1), subs(s), "con datos móviles, los 4")
            assertEquals(emptyMap(), gaps(b), "ningún relé soltado")
            b.stop()
            assertEquals(emptyMap(), gaps(b), "parada la escucha, tampoco")
        } finally { try { bg?.stop() } catch (e: Exception) { }; relay.close(); peer.close() }
    }
}
