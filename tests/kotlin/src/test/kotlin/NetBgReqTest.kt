import com.nexo.ble.NetBg
import com.nexo.ble.ReqNotifyPolicy
import com.nexo.ble.Secp256k1
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

/**
 * 3190 (dueño 17-11: «hay que poner esa notificación: hay un contacto que te quiere agregar»): la escucha de internet en segundo plano
 * (NetBg) también oye MI buzón de solicitudes de contacto (alta por ID, ronda 2779) y decide avisar. Contra el código REAL de la app
 * (net_link.js del bundle compilado, vía netbg_helper.mjs): (a) una solicitud cifrada por NetLink.sendRequest la abre NetBg con el
 * mismo remitente, tipo y nombre que saca NetLink._onReq; (b) las etiquetas de hoy y ayer son las de _reqTagPub; (d) de punta a punta
 * con un relé local que exige identificarse (NIP-42): sin contactos por internet, NetBg recibe las solicitudes publicadas por la app,
 * no avisa de un contacto ni de lo que la app ya recibió, marca la aceptación de una solicitud MÍA y el nombre de un contacto con otro
 * ID, frena con ReqNotifyPolicy y guarda todo para la app (no consume la solicitud). El freno puro está en ReqNotifyPolicyTest.
 */
class NetBgReqTest {
    private val helper = File("netbg_helper.mjs").absoluteFile
    private fun node(vararg args: String): Process =
        ProcessBuilder(listOf("node", helper.path) + args).redirectError(ProcessBuilder.Redirect.INHERIT).start()

    private val vectors: JSONObject by lazy {
        val p = node("reqvectors"); val out = p.inputStream.bufferedReader().readText(); p.waitFor()
        JSONObject(out)
    }

    @Test fun etiquetasDelBuzonIgualesQueLaApp() {
        assertEquals(vectors.getString("today"), NetBg.day(0))
        val tags = vectors.getJSONArray("tags")
        assertEquals(9, tags.length())
        for (i in 0 until tags.length()) {
            val v = tags.getJSONObject(i)
            assertEquals(v.getString("pub"), Secp256k1.hex(Secp256k1.xOnly(NetBg.reqKey(v.getString("id"), v.getString("day")))), "etiqueta de ${v.getString("id")} el ${v.getString("day")}")
        }
    }

    @Test fun abreLaSolicitudCifradaPorLaAppComoLaApp() {
        val reqs = vectors.getJSONArray("reqs")
        assertEquals(3, reqs.length())
        for (i in 0 until reqs.length()) {
            val v = reqs.getJSONObject(i); val ev = v.getJSONObject("ev"); val app = v.getJSONObject("app")
            val to = v.getString("to")
            // la etiqueta del evento (p) es la de hoy del buzón del destino
            assertEquals(Secp256k1.hex(Secp256k1.xOnly(NetBg.reqKey(to, NetBg.day(0)))), ev.getJSONArray("tags").getJSONArray(0).getString(1))
            val r = NetBg.openReq(to, ev.getString("content"))
            assertNotNull(r, "NetBg no abre la solicitud $i de la app")
            assertEquals(app.getString("id"), r.from, "mismo remitente que la app")
            assertEquals(app.getString("kind"), r.kind, "mismo tipo que la app")
            assertEquals(app.getString("name"), r.name, "mismo nombre (saneado) que la app")
            assertNull(NetBg.openReq("nxzzzzzzzz", ev.getString("content")), "con otro ID no se abre")
            assertNull(NetBg.openReq(v.getString("from"), ev.getString("content")), "ni con el del remitente")
        }
        assertEquals("Ana bMaría/b con un nombre larguísimo qu", reqs.getJSONObject(1).getJSONObject("app").getString("name"))
        // contenido tocado (AES-GCM autenticado) o basura: nada
        val c = reqs.getJSONObject(0).getJSONObject("ev").getString("content")
        val raw = java.util.Base64.getDecoder().decode(c); raw[raw.size - 1] = (raw[raw.size - 1].toInt() xor 1).toByte()
        assertNull(NetBg.openReq("nxbbbbbbbb", java.util.Base64.getEncoder().encodeToString(raw)))
        for (bad in listOf("", "%%%", "AAAA", "x".repeat(5000))) assertNull(NetBg.openReq("nxbbbbbbbb", bad))
    }

    @Test fun dePuntaAPuntaSolicitudesDeLaAppReal() {
        val p = node("relay")
        val rd = BufferedReader(InputStreamReader(p.inputStream))
        val url = rd.readLine().removePrefix("URL ").trim()
        val lines = CopyOnWriteArrayList<String>()
        Thread { try { while (true) { val l = rd.readLine() ?: break; lines.add(l) } } catch (e: Exception) { } }.apply { isDaemon = true; start() }
        val w = p.outputStream.bufferedWriter()
        try {
            val got = CopyOnWriteArrayList<String>()
            val logs = CopyOnWriteArrayList<String>()
            val st = ReqNotifyPolicy.State()
            // como PluginBackground.requestNotify: el freno decide (aviso suelto, agrupado o nada) y el texto en español
            val bg = NetBg({ _, _, _, _, _, _ -> fail("una solicitud no es un mensaje") }, { logs.add(it) }, { _, _ -> }, { r ->
                val v = ReqNotifyPolicy.decide(st, r.from, System.currentTimeMillis())
                got.add("${r.from}|${r.kind}|${r.name}|${r.twin}|$v|" + ReqNotifyPolicy.body("es", r.name, r.from, r.kind == "acc", r.twin))
            })
            val now = System.currentTimeMillis()
            // sin contactos por internet (alguien nuevo); mis contactos (Bluetooth) Ana López y Beto; mandé yo una solicitud a nxdddddddd;
            // la app dejó de escuchar su buzón hace 2 min
            bg.configure("nxbbbbbbbb", listOf(url), now - 600_000, emptyList(), mapOf("nxcccccccc" to "Ana López", "nxgggggggg" to "Beto"), setOf("nxdddddddd"), now - 120_000)
            assertTrue(bg.configured(), "sin contactos por internet también escucha (mi buzón de solicitudes)")
            bg.start()
            assertTrue(bg.running)
            Thread.sleep(1500)
            fun req(from: String, t: String, name: String, to: String = "nxbbbbbbbb", ago: Int = 0) {
                w.write(JSONObject().put("req", JSONObject().put("from", from).put("to", to).put("t", t).put("name", name).put("ago", ago)).toString() + "\n"); w.flush()
            }
            req("nxaaaaaaaa", "req", "Luis")                     // aviso
            req("nxeeeeeeee", "req", "ana  lópez")               // aviso con advertencia: se llama como mi contacto Ana López
            req("nxcccccccc", "req", "Ana López")                // ya es contacto: sin aviso
            req("nxhhhhhhhh", "req", "Vieja", ago = 300)         // de antes de que la app dejara de escuchar: la tiene ella, sin aviso
            req("nxdddddddd", "acc", "Dora")                     // aceptó MI solicitud
            req("nxaaaaaaaa", "req", "Luis", to = "nxzzzzzzzz")  // buzón de otro: no se ve
            w.write(JSONObject().put("raw", JSONObject().put("to", "nxbbbbbbbb").put("content", "basura")).toString() + "\n"); w.flush()
            req("nxffffffff", "acc", "Fito")                     // «acc» sin solicitud mía: como una solicitud normal (y ya van 3: agrupada)
            req("nxaaaaaaaa", "req", "Luis")                     // Luis insiste: ya hubo aviso suyo
            val t0 = System.currentTimeMillis()
            while (got.size < 5 && System.currentTimeMillis() - t0 < 15000) Thread.sleep(100)
            Thread.sleep(1000)
            assertEquals(listOf(
                "nxaaaaaaaa|req|Luis||NOTIFY|Luis (NXAAAAAAAA) quiere agregarte en NEXO",
                "nxeeeeeeee|req|ana  lópez|Ana López|NOTIFY|⚠ NXEEEEEEEE usa el nombre de tu contacto Ana López y quiere agregarte: puede ser un impostor",
                "nxdddddddd|acc|Dora||NOTIFY|Dora (NXDDDDDDDD) aceptó tu solicitud: confírmala en NEXO",
                "nxffffffff|req|Fito||GROUP|Fito (NXFFFFFFFF) quiere agregarte en NEXO",
                "nxaaaaaaaa|req|Luis||SAME_SENDER|Luis (NXAAAAAAAA) quiere agregarte en NEXO",
            ), got.toList())
            assertTrue(logs.any { it == "Solicitud de nxcccccccc: ya es contacto: sin aviso" }, "registro: $logs")
            assertFalse(logs.any { it.contains("Luis") || it.contains("Dora") }, "el registro no lleva el contenido (nombres)")
            // NO se consume: todo lo que llegó a mi buzón (y se abre) queda para la app, que lo pone en su bandeja al volver
            val kept = bg.drainForApp().map { JSONObject(it) }
            assertEquals(7, kept.size, "para la app: Luis, ana, Ana (contacto), Vieja, Dora, Fito, Luis otra vez; ni la basura ni lo de otro buzón")
            val myTag = Secp256k1.hex(Secp256k1.xOnly(NetBg.reqKey("nxbbbbbbbb", NetBg.day(0))))
            kept.forEach { e -> assertTrue(e.has("id") && e.has("sig") && e.getJSONArray("tags").getJSONArray(0).getString(1) == myTag, "evento completo del relé (la app comprueba la firma)") }
            w.write("STATS\n"); w.flush(); Thread.sleep(500)
            val stats = lines.lastOrNull { it.startsWith("STATS ") }
            assertNotNull(stats); assertTrue(JSONObject(stats.removePrefix("STATS ")).getInt("auths") >= 2, "se identificó con las claves del buzón (NIP-42): $stats")
            bg.stop()
        } finally { try { w.close() } catch (e: Exception) { }; p.destroy() }
    }
}
