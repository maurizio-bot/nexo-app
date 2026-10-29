import com.nexo.ble.NetBg
import com.nexo.ble.Secp256k1
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

// Escucha de internet en segundo plano (NetBg) contra lo que hace la app (net_link.js con noble y WebCrypto):
// mismas firmas Schnorr, mismas etiquetas del día, mismos sobres y mismos ids de evento; y de punta a punta con un
// relé Nostr local que exige identificación (NIP-42).
class NetBgTest {
    private val helper = File("netbg_helper.mjs").absoluteFile
    private fun node(vararg args: String): Process = ProcessBuilder(listOf("node", helper.path) + args).redirectErrorStream(false).start()

    private val vectors: JSONObject by lazy {
        val p = node("vectors"); val out = p.inputStream.bufferedReader().readText(); p.waitFor()
        JSONObject(out)
    }

    @Test fun firmasSchnorrIgualesQueNoble() {
        val sigs = vectors.getJSONArray("sigs")
        for (i in 0 until sigs.length()) {
            val v = sigs.getJSONObject(i)
            val sk = Secp256k1.unhex(v.getString("sk"))
            assertEquals(v.getString("pub"), Secp256k1.hex(Secp256k1.xOnly(sk)))
            assertEquals(v.getString("sig"), Secp256k1.hex(Secp256k1.sign(Secp256k1.unhex(v.getString("msg")), sk, Secp256k1.unhex(v.getString("aux")))))
        }
    }

    @Test fun etiquetasDelDiaIgualesQueLaApp() {
        assertEquals(vectors.getString("today"), NetBg.day(0))
        val tags = vectors.getJSONArray("tags")
        for (i in 0 until tags.length()) {
            val v = tags.getJSONObject(i)
            val sk = NetBg.tagKey(Secp256k1.unhex(v.getString("kraw")), v.getString("to"), v.getString("day"))
            assertEquals(v.getString("sk"), Secp256k1.hex(sk))
            assertEquals(v.getString("pub"), Secp256k1.hex(Secp256k1.xOnly(sk)))
        }
    }

    @Test fun abreElSobreDeLaParejaYSoloEse() {
        val v = vectors.getJSONArray("seals").getJSONObject(0)
        val kraw = Secp256k1.unhex(v.getString("kraw"))
        val o = NetBg.open(kraw, v.getString("from"), v.getString("to"), v.getString("b64"))
        assertNotNull(o); assertEquals("m1", o.getString("n"))
        assertNull(NetBg.open(kraw, "nxcccccccc", v.getString("to"), v.getString("b64")), "otro remitente: no se abre")
        assertNull(NetBg.open(ByteArray(32), v.getString("from"), v.getString("to"), v.getString("b64")), "otra pareja: no se abre")
    }

    @Test fun idDeEventoComoJsonStringify() {
        val v = vectors.getJSONArray("ids").getJSONObject(0)
        val tags = v.getJSONArray("tags"); val list = (0 until tags.length()).map { i -> val t = tags.getJSONArray(i); (0 until t.length()).map { t.getString(it) } }
        val ev = NetBg.event(Secp256k1.unhex(v.getString("sk")), 22242, list, v.getString("content"), v.getLong("created_at"))
        assertEquals(v.getString("id"), ev.getString("id"))
    }

    @Test fun dePuntaAPuntaConUnReleQueExigeIdentificarse() {
        val p = node("relay")
        val rd = BufferedReader(InputStreamReader(p.inputStream))
        val url = rd.readLine().removePrefix("URL ").trim()
        val lines = CopyOnWriteArrayList<String>()
        Thread { try { while (true) { val l = rd.readLine() ?: break; lines.add(l) } } catch (e: Exception) { } }.apply { isDaemon = true; start() }
        val w = p.outputStream.bufferedWriter()
        try {
            val kraw = ByteArray(32) { (it * 7 + 3).toByte() }
            val ackKey = ByteArray(32) { (it * 5 + 1).toByte() }   // #87: la clave con la que se firma la confirmación de entrega
            val got = CopyOnWriteArrayList<String>()
            val bg = NetBg({ nx, name, msgId -> got.add("$nx|$name|$msgId") })
            bg.configure("nxbbbbbbbb", listOf(url), System.currentTimeMillis() - 60000, listOf(NetBg.Contact("nxaaaaaaaa", "Ana", kraw)))
            bg.setAckKeys(mapOf("nxaaaaaaaa" to ackKey))
            bg.start()
            Thread.sleep(1500)
            fun send(body: String) { w.write("{\"kraw\":\"${Secp256k1.hex(kraw)}\",\"from\":\"nxaaaaaaaa\",\"to\":\"nxbbbbbbbb\",\"body\":$body}\n"); w.flush() }
            send("{\"t\":1,\"h\":1}")                                                     // saludo: no avisa
            send("{\"t\":1,\"p\":\"{\\\"t\\\":\\\"a\\\"}\"}")                              // confirmación: no avisa
            send("{\"t\":1,\"p\":\"{\\\"type\\\":\\\"chat\\\",\\\"msgId\\\":\\\"m1\\\"}\",\"n\":\"m1\"}")  // mensaje: avisa
            send("{\"t\":1,\"p\":\"x\",\"n\":\"m2\"}")
            // Para otro contacto (otra pareja): no se ve
            w.write("{\"kraw\":\"${Secp256k1.hex(ByteArray(32))}\",\"from\":\"nxcccccccc\",\"to\":\"nxbbbbbbbb\",\"body\":{\"t\":1,\"p\":\"x\",\"n\":\"m9\"}}\n"); w.flush()
            val t0 = System.currentTimeMillis()
            while (got.size < 2 && System.currentTimeMillis() - t0 < 10000) Thread.sleep(100)
            Thread.sleep(800)
            assertEquals(listOf("nxaaaaaaaa|Ana|m1", "nxaaaaaaaa|Ana|m2"), got.toList())
            // #87: NetBg devolvió la confirmación de ENTREGA (✓✓) de cada mensaje NUEVO, por el buzón del EMISOR (su
            // etiqueta del día), sellada para que solo él la abra y firmada con la clave de la pareja. Ni el saludo ni la
            // confirmación entrante ni el mensaje de otro contacto generan confirmación (solo los que traen msgId).
            w.write("DUMP\n"); w.flush()
            var dump: String? = null
            val td = System.currentTimeMillis()
            while (dump == null && System.currentTimeMillis() - td < 5000) { dump = lines.lastOrNull { it.startsWith("EVENTS ") }; if (dump == null) Thread.sleep(100) }
            assertNotNull(dump, "el relé no devolvió sus eventos (DUMP)")
            val events = JSONArray(dump!!.removePrefix("EVENTS "))
            val ackTagPub = Secp256k1.hex(Secp256k1.xOnly(NetBg.tagKey(kraw, "nxaaaaaaaa", NetBg.day(0))))
            val acks = HashMap<String, JSONObject>()
            for (i in 0 until events.length()) {
                val e = events.getJSONObject(i); val tgs = e.getJSONArray("tags")
                var toEmisor = false
                for (j in 0 until tgs.length()) { val t = tgs.getJSONArray(j); if (t.getString(0) == "p" && t.getString(1) == ackTagPub) toEmisor = true }
                if (!toEmisor) continue
                val body = NetBg.open(kraw, "nxbbbbbbbb", "nxaaaaaaaa", e.getString("content"))
                assertNotNull(body, "la confirmación de entrega no se abre con la clave de la pareja")
                val a = JSONObject(body!!.getString("p")); acks[a.getString("msgId")] = a
            }
            assertEquals(setOf("m1", "m2"), acks.keys, "una confirmación de entrega por cada mensaje nuevo (y solo por esos)")
            for ((msgId, a) in acks) {
                assertEquals("ack", a.getString("type"))
                assertEquals("nxbbbbbbbb", a.getString("from"))
                assertEquals(NetBg.ackMac(ackKey, "ack|$msgId|nxbbbbbbbb|nxaaaaaaaa"), a.getString("a"), "la confirmación va firmada con la clave de la pareja")
            }
            w.write("STATS\n"); w.flush(); Thread.sleep(500)
            val stats = lines.lastOrNull { it.startsWith("STATS ") }
            assertNotNull(stats); assertTrue(JSONObject(stats.removePrefix("STATS ")).getInt("auths") >= 1, "se identificó ante el relé (NIP-42): $stats")
            bg.stop()
        } finally { try { w.close() } catch (e: Exception) { }; p.destroy() }
    }
}
