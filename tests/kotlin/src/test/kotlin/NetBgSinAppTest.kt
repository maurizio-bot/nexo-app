import com.nexo.ble.AtRestStore
import com.nexo.ble.FcmWakePolicy
import com.nexo.ble.NetBg
import com.nexo.ble.NetBgSaved
import com.nexo.ble.NetBgSaved.Notice
import com.nexo.ble.NetBgSaved.Start
import com.nexo.ble.Secp256k1
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.io.InputStreamReader
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import javax.crypto.KeyGenerator
import kotlin.test.*

/**
 * 3192 (#87, dueño 17-11 «Ok» a guardar cifrada la configuración), (c) de punta a punta con un relé local que exige identificarse
 * (NIP-42), como NetBgTest, pero con DOS apps REALES (el código de la app compilado, netbg_helper.mjs): A (emisor) y B (este teléfono).
 *  1. La app B, con su NetLink real, da la configuración de la escucha (_bgConfig → netBgConfig) y las claves del ✓✓ (e2eAckKey): se
 *     leen como en netBgConfigImpl (NetBgSaved.fromApp) y se GUARDAN cifradas (AtRestStore).
 *  2. «Android cerró NEXO»: sin la app ni nada en memoria, una NetBg NUEVA se crea SOLO desde lo guardado (otra instancia del almacén).
 *  3. A manda con su NetLink.send real un mensaje y dos ofertas de llamada (una de hace 30 min, que sonó en el proceso de antes): la
 *     NetBg lo recibe, decide avisar del mensaje y de la llamada nueva (no de la vieja) y devuelve el ✓✓ firmado de los tres; A lo
 *     lee con su NetLink real y lo comprueba como BleAckSystem.processIncomingAck (e2eAckTag).
 *  4. Relevo: la app B se abre en ese mismo proceso → usa la MISMA NetBg (vuelve a configurarla y arrancarla: sin una segunda
 *     conexión), la para al ponerse a la vista y recoge lo recibido (netBgDrain → NetLink._drainBg real): el mensaje entra al chat.
 *  Contraprueba: como hasta la 3191 (todo solo en memoria) una NetBg nueva no tiene qué escuchar: no arranca y no recibe nada.
 */
class NetBgSinAppTest {
    private val helper = File("netbg_helper.mjs").absoluteFile
    private val dirs = mutableListOf<File>()
    @AfterTest fun limpiar() { dirs.forEach { try { it.deleteRecursively() } catch (e: Exception) { } }; dirs.clear() }

    private class Proc(val p: Process) {
        val lines = CopyOnWriteArrayList<String>()
        private val w: BufferedWriter = p.outputStream.bufferedWriter()
        init {
            val rd = BufferedReader(InputStreamReader(p.inputStream))
            Thread { try { while (true) { val l = rd.readLine() ?: break; lines.add(l) } } catch (e: Exception) { } }.apply { isDaemon = true; start() }
        }
        fun send(s: String) { w.write(s + "\n"); w.flush() }
        // La primera línea con ese prefijo que llegue después de `from` (índice en lines)
        fun await(prefix: String, from: Int = 0, ms: Long = 20000): String {
            val t0 = System.currentTimeMillis()
            while (System.currentTimeMillis() - t0 < ms) {
                for (i in from until lines.size) { val l = lines[i]; if (l.startsWith(prefix)) return l.removePrefix(prefix).trim() }
                lines.drop(from).firstOrNull { it.startsWith("ERROR ") }?.let { fail("el ayudante falló: $it") }
                Thread.sleep(50)
            }
            fail("no llegó «$prefix»: $lines")
        }
        fun close() { try { w.close() } catch (e: Exception) { }; p.destroy() }
    }
    private fun node(mode: String) = Proc(ProcessBuilder(listOf("node", helper.path, mode)).redirectError(ProcessBuilder.Redirect.INHERIT).start())

    @Test fun recibeSinLaAppDesdeLoGuardadoYConfirmaConElCodigoRealDeLaApp() {
        val relay = node("relay"); val peer = node("peer")
        try {
            val url = relay.await("URL ")
            relay.send("PK"); val pkA = relay.await("PK ")
            val pkB = peer.await("PK ")
            val A = "nxaaaaaaaa"; val B = "nxbbbbbbbb"
            // 1. La app B (real) configura la escucha y da las claves del ✓✓. La app vio lo último hace una hora (lastSeen).
            val n0 = peer.lines.size
            peer.send(JSONObject().put("cfg", JSONObject().put("me", B).put("relays", JSONArray(listOf(url))).put("lastSeen", System.currentTimeMillis() - 3_600_000)
                .put("contacts", JSONArray().put(JSONObject().put("nx", A).put("name", "Ana").put("pk", pkA)))).toString())
            val fromApp = JSONObject(peer.await("CFG ", n0))
            val ackApp = JSONObject(peer.await("ACK ", n0))
            val cfg = NetBgSaved.fromApp(fromApp)   // como netBgConfigImpl
            assertEquals(B, cfg.me); assertEquals(listOf(url), cfg.relays); assertEquals(A, cfg.contacts.single().nx)
            val ack = HashMap<String, ByteArray>()  // como setAckKeysImpl (base64 de la app)
            val ka = ackApp.getJSONArray("keys"); for (i in 0 until ka.length()) ka.getJSONObject(i).let { ack[it.getString("nx")] = Base64.getDecoder().decode(it.getString("key")) }
            assertEquals(setOf(A), ack.keys)
            val dir = Files.createTempDirectory("nexo-sinapp").toFile().also { dirs.add(it) }
            val k = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
            val st = AtRestStore(dir) { k }
            st.write("nexo_advertising_id.json", JSONObject().put("nexoId", B).put("createdAt", 1).toString()) // la cuenta del teléfono
            val w = NetBgSaved.Writer()
            assertTrue(NetBgSaved.saveConfig(st, w, cfg)); assertTrue(NetBgSaved.saveAck(st, w, ack))
            val kraw = Secp256k1.hex(cfg.contacts.single().kraw)
            for (f in dir.listFiles()!!.filter { NetBgSaved.isFile(it.name) }) {
                val raw = String(f.readBytes(), Charsets.ISO_8859_1)
                for (s in listOf(kraw, B, A, url, Secp256k1.hex(ack[A]!!))) assertFalse(raw.contains(s), "${f.name}: «$s» no está en claro")
            }

            // 2. Proceso nuevo, sin la app: solo lo guardado
            val st2 = AtRestStore(dir) { k }
            var saved: NetBgSaved.Saved? = null
            val step = NetBgSaved.startStep(appAlive = false, running = false, { NetBgSaved.load(st2).also { saved = it }?.cfg },
                { NetBgSaved.accountIdOf(st2.read("nexo_advertising_id.json")) })
            assertEquals(Start.START, step)
            val notices = CopyOnWriteArrayList<String>(); val logs = CopyOnWriteArrayList<String>()
            // Las decisiones de NetBgHome sin la app: chat abierto no hay (silent = false); ningún mensaje estaba ya en el teléfono
            val bg = NetBg({ nx, name, msgId, isCall, group, video ->
                notices.add("$nx|$name|$msgId|" + NetBgSaved.notice(isCall, false, false, group.isNotEmpty()) + if (video) "|VIDEO" else "")
            }, { logs.add(it) }, staleCall = { NetBgSaved.callTooOld(it, System.currentTimeMillis()) })
            NetBgSaved.apply(bg, saved!!)
            bg.start()
            assertTrue(bg.running, "arrancó solo con lo guardado")
            assertFalse(FcmWakePolicy.noticeAfterWake(true, NetBgSaved.listening(step, bg.running)), "toque FCM: escucha, sin aviso genérico")
            Thread.sleep(1500)

            // 3. A (real) manda: un mensaje, una oferta de llamada de hace 30 min y una nueva
            var r0 = relay.lines.size
            relay.send(JSONObject().put("send", JSONObject().put("from", A).put("to", B).put("toPk", pkB)
                .put("p", JSONObject().put("type", "chat").put("msgId", "mreal1").put("content", "hola").toString())).toString())
            relay.await("PUBLISHED ", r0); r0 = relay.lines.size
            relay.send(JSONObject().put("send", JSONObject().put("from", A).put("to", B).put("toPk", pkB).put("ago", 1800)
                .put("p", JSONObject().put("type", "nexo_call").put("op", "offer").put("id", "cold1").put("v", 0).toString())).toString())
            relay.await("PUBLISHED ", r0); r0 = relay.lines.size
            relay.send(JSONObject().put("send", JSONObject().put("from", A).put("to", B).put("toPk", pkB)
                .put("p", JSONObject().put("type", "nexo_call").put("op", "offer").put("id", "cnew1").put("v", 1).toString())).toString())
            relay.await("PUBLISHED ", r0)
            val t0 = System.currentTimeMillis()
            while (notices.size < 2 && System.currentTimeMillis() - t0 < 10000) Thread.sleep(100)
            Thread.sleep(1500)
            assertEquals(listOf("$A|Ana|mreal1|${Notice.CHAT}", "$A|Ana|cnew1|${Notice.CALL}|VIDEO"), notices.toList(), "avisa del mensaje y de la llamada nueva")
            assertTrue(logs.any { it.contains("cold1") && it.contains("ya no suena") }, "la oferta vieja no suena: $logs")
            // El ✓✓ de los tres, comprobado por la app REAL del emisor
            r0 = relay.lines.size
            relay.send(JSONObject().put("acks", JSONObject().put("me", A).put("peer", B).put("peerPk", pkB)).toString())
            val acks = JSONArray(relay.await("ACKS ", r0))
            val ok = (0 until acks.length()).map { acks.getJSONObject(it) }.filter { it.getBoolean("ok") && it.getString("from") == B }.map { it.getString("msgId") }.toSet()
            assertEquals(setOf("mreal1", "cold1", "cnew1"), ok, "✓✓ firmado y aceptado por el emisor: $acks")

            // 4. Relevo: la app B se abre en este proceso → la MISMA NetBg (la reconfigura y la arranca otra vez: sin otra conexión)
            r0 = relay.lines.size; relay.send("STATS"); val s1 = JSONObject(relay.await("STATS ", r0))
            bg.configure(cfg.me, cfg.relays, cfg.since, cfg.contacts, cfg.known, cfg.reqOut, cfg.reqSince); bg.setAckKeys(ack)
            bg.start()
            Thread.sleep(800)
            r0 = relay.lines.size; relay.send("STATS"); val s2 = JSONObject(relay.await("STATS ", r0))
            assertEquals(s1.getInt("conns"), s2.getInt("conns"), "sin una segunda conexión al relé")
            assertEquals(1, s2.getInt("open"), "una sola escucha abierta")
            bg.stop() // la app a la vista: escucha ella
            val kept = bg.drainForApp()
            assertEquals(3, kept.size, "lo recibido sin la app queda para la app")
            val n1 = peer.lines.size
            peer.send(JSONObject().put("drain", JSONObject().put("me", B).put("events", JSONArray(kept))
                .put("contacts", JSONArray().put(JSONObject().put("nx", A).put("name", "Ana").put("pk", pkA)))).toString())
            val drained = JSONObject(peer.await("DRAINED ", n1))
            assertEquals(3, drained.getInt("n"), "la app real acepta los tres (firma, etiqueta, sobre)")
            val got = drained.getJSONArray("got")
            assertTrue((0 until got.length()).any { got.getJSONObject(it).getString("nx") == A && JSONObject(got.getJSONObject(it).getString("p")).optString("msgId") == "mreal1" },
                "el mensaje entra al chat de la app: $got")

            // Contraprueba: como hasta la 3191 (sin guardar): una NetBg nueva no tiene qué escuchar
            val empty = Files.createTempDirectory("nexo-sinapp0").toFile().also { dirs.add(it) }
            assertEquals(Start.NO_CONFIG, NetBgSaved.startStep(false, false, { NetBgSaved.load(AtRestStore(empty) { k })?.cfg }, { B }))
            val got0 = CopyOnWriteArrayList<String>()
            val old = NetBg({ _, _, msgId, _, _, _ -> got0.add(msgId) })
            old.start()
            assertFalse(old.running, "sin configuración no arranca")
            assertTrue(FcmWakePolicy.noticeAfterWake(true, NetBgSaved.listening(Start.NO_CONFIG, false)), "el toque FCM deja el aviso genérico")
            r0 = relay.lines.size
            relay.send(JSONObject().put("send", JSONObject().put("from", A).put("to", B).put("toPk", pkB)
                .put("p", JSONObject().put("type", "chat").put("msgId", "mreal2").toString())).toString())
            relay.await("PUBLISHED ", r0)
            Thread.sleep(1500)
            assertTrue(got0.isEmpty(), "nada recibido sin lo guardado")
        } finally { relay.close(); peer.close() }
    }
}
