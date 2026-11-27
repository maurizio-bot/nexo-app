import com.nexo.ble.NetBg
import com.nexo.ble.NetBgSaved
import com.nexo.ble.RelayPolicy
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
 * Fase 1 (internet) del contrato de los caminos, 28-11 (docs/CONTRATO_CAMINOS_28-11.md §B.5), parte nativa de punta a punta: 4 relés locales
 * y DOS apps REALES (netbg_helper.mjs). La NetBg de B (app oculta) usa la MISMA política que la app (RelayPolicy = politica_reles.js):
 *  1. Sabe dónde lee A (relés 1.º y 2.º, lo da la app): el ✓✓ de un mensaje de A sale SOLO por esos 2, no por los 4.
 *  2. El 1.º dice «rate-limited»: queda en pausa (antes el nativo ignoraba el «OK false» y le seguía mandando todo → «banned»): el ✓✓
 *     siguiente ya no le llega; y la pausa pasa a la app al volver (pausesForApp).
 *  3. La app dejó en pausa el 2.º (cool): con los dos de A en pausa, el ✓✓ espera SIN mandar nada a ningún relé (ni a los que A no lee).
 */
class NetBgRelesTest {
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

    private fun pubs(relay: Proc): List<Pair<Int, Int>> = JSONArray(relay.ask("PUBS", "PUBS ")).let { a -> (0 until a.length()).map { a.getJSONObject(it).let { o -> Pair(o.getInt("ok"), o.getInt("no")) } } }

    @Test fun publicaDondeLeeElOtroYRespetaLosNoDeLosReles() {
        val relay = node("multi", "4"); val peer = node("peer")
        var bg: NetBg? = null
        try {
            val urls = JSONArray(relay.await("URLS ")).let { a -> (0 until a.length()).map { a.getString(it) } }
            val pkA = relay.ask("PK", "PK ")
            val pkB = peer.await("PK ")
            val A = "nxaaaaaaaa"; val B = "nxbbbbbbbb"
            val n0 = peer.lines.size
            peer.send(JSONObject().put("cfg", JSONObject().put("me", B).put("relays", JSONArray(urls)).put("lastSeen", System.currentTimeMillis() - 3_600_000)
                .put("contacts", JSONArray().put(JSONObject().put("nx", A).put("name", "Ana").put("pk", pkA)))).toString())
            val cfg0 = NetBgSaved.fromApp(JSONObject(peer.await("CFG ", n0)))
            val ackApp = JSONObject(peer.await("ACK ", n0))
            val ack = HashMap<String, ByteArray>()
            val ka = ackApp.getJSONArray("keys"); for (i in 0 until ka.length()) ka.getJSONObject(i).let { ack[it.getString("nx")] = Base64.getDecoder().decode(it.getString("key")) }
            val leeA = listOf(urls[0], urls[1])
            val cfg = NetBgSaved.Config(cfg0.me, cfg0.relays, cfg0.since, cfg0.contacts.map { NetBg.Contact(it.nx, it.name, it.kraw, leeA) }, cfg0.known, cfg0.reqOut, cfg0.reqSince, cfg0.gwHelp)
            // lo que se guarda en disco conserva dónde lee cada contacto
            assertEquals(leeA, NetBgSaved.configFrom(NetBgSaved.configJson(cfg))!!.contacts[0].lee, "en disco")

            val got = CopyOnWriteArrayList<String>(); val logs = CopyOnWriteArrayList<String>()
            val b = NetBg({ _, _, msgId, _, _, _ -> got.add(msgId) }, { logs.add(it) })
            bg = b
            NetBgSaved.apply(b, NetBgSaved.Saved(cfg, ack))
            setNet(b, "cell")
            b.start()
            waitStats(relay, 10000) { st -> st.all { it.subs == 1 } }
            val send = { id: String, only: List<Int>? ->
                val o = JSONObject().put("from", A).put("to", B).put("toPk", pkB).put("ago", 0)
                    .put("p", JSONObject().put("type", "chat").put("msgId", id).put("content", "hola $id").toString())
                if (only != null) o.put("only", JSONArray(only))
                JSONArray(relay.ask(JSONObject().put("send", o).toString(), "PUBLISHED "))
            }
            val acksOf = { id: String ->
                val acks = JSONArray(relay.ask(JSONObject().put("acks", JSONObject().put("me", A).put("peer", B).put("peerPk", pkB)).toString(), "ACKS "))
                (0 until acks.length()).map { acks.getJSONObject(it) }.filter { it.getString("msgId") == id }
            }

            // 1. El ✓✓ solo por los 2 relés que lee A
            send("dm1", null)
            assertTrue(waitFor(10000) { "dm1" in got }, "llegó: $got")
            Thread.sleep(800)
            val a1 = acksOf("dm1")
            assertEquals(1, a1.size, "un ✓✓: $a1"); assertTrue(a1[0].getBoolean("ok"))
            assertEquals(listOf(0, 1), a1[0].getJSONArray("on").let { a -> (0 until a.length()).map { a.getInt(it) } }, "el ✓✓ solo donde lee A")

            // 2. El 1.º dice que limita: en pausa; el siguiente ✓✓ ya no le llega
            relay.ask(JSONObject().put("refuse", 0).put("msg", "rate-limited: too many gift wraps from this address").toString(), "REFUSE ")
            send("dm2", listOf(1, 2, 3))
            assertTrue(waitFor(10000) { "dm2" in got }, "llegó: $got")
            assertTrue(waitFor(5000) { logs.any { it.contains("limita") && it.contains("en pausa 20 s") } }, "en pausa: $logs")
            val p0 = pubs(relay)[0]
            send("dm3", listOf(1, 2, 3))
            assertTrue(waitFor(10000) { "dm3" in got }, "llegó: $got")
            Thread.sleep(800)
            assertEquals(p0, pubs(relay)[0], "al relé en pausa no le llega nada más")
            assertEquals(listOf(1), acksOf("dm3").flatMap { x -> x.getJSONArray("on").let { a -> (0 until a.length()).map { a.getInt(it) } } }, "el ✓✓ de dm3 solo en el 2.º")
            val pa = b.pausesForApp()
            assertEquals("rate", pa[urls[0]]?.kind, "la pausa pasa a la app: $pa")

            // 3. La app dejó en pausa el 2.º: con los dos de A en pausa, nada sale (ni a los que A no lee)
            val now = System.currentTimeMillis()
            b.configure(cfg.me, cfg.relays, cfg.since, cfg.contacts, cfg.known, cfg.reqOut, cfg.reqSince, emptyList(), mapOf(urls[1] to RelayPolicy.Pause("ban", 1, now, now + 600_000)))
            relay.ask(JSONObject().put("refuse", 0).put("msg", JSONObject.NULL).toString(), "REFUSE ")
            val before = pubs(relay)
            send("dm4", listOf(2, 3))
            assertTrue(waitFor(10000) { "dm4" in got }, "llegó: $got")
            Thread.sleep(1200)
            val after = pubs(relay)
            assertEquals(before[0], after[0], "nada al 1.º (en pausa)"); assertEquals(before[1], after[1], "nada al 2.º (pausa de la app)")
            assertTrue(acksOf("dm4").isEmpty(), "el ✓✓ de dm4 espera")
            assertTrue(logs.any { it.contains("[RUTA]") && it.contains("en pausa") }, "registro [RUTA]: $logs")
            println("Registro de la NetBg:\n  " + logs.joinToString("\n  "))
        } finally { try { bg?.stop() } catch (e: Exception) { }; relay.close(); peer.close() }
    }
}
