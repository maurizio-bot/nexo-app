import com.nexo.ble.AtRestStore
import com.nexo.ble.NetBg
import com.nexo.ble.NetBgSaved
import com.nexo.ble.NetOutbox
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.io.InputStreamReader
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import javax.crypto.KeyGenerator
import kotlin.test.*

/**
 * 3268 (PRIORIDAD 1 del dueño, «Bluetooth entero en el servicio nativo», FASE 3; COLA 29): BANDEJA DE SALIDA nativa.
 * Diagnósticos «pendiente_viejo» (20 y 21-11): un texto que se quedó ⏳ sin camino no salía hasta volver a abrir NEXO.
 *  - NetOutbox (la lista y sus decisiones): reemplazo, validación, reintentos, confirmación, caducidad, guardado.
 *  - De punta a punta con un relé que exige identificarse y la app REAL del otro lado (netbg_helper.mjs): la escucha nativa sube lo de
 *    la bandeja sin la app, la app real lo recibe tal cual, llega su ✓✓ y la bandeja se vacía; y arranca desde lo guardado cifrado.
 */
class NetOutboxTest {
    private val A = "nxaaaaaaaa"
    private fun item(id: String, nx: String = A, at: Long = 1_000L, wake: String = "") =
        NetOutbox.Item(id, nx, "{\"v\":1,\"type\":\"chat\",\"msgId\":\"$id\",\"payload\":{\"text\":\"e2:cifrado\"}}", at, wake)

    @Test fun laListaSeReemplazaYLoQueSigueConservaSusIntentos() {
        val o = NetOutbox()
        assertTrue(o.set(listOf(item("msg_1"), item("msg_2"))), "cambió")
        o.published("msg_1", "ev1", 5_000L)
        assertEquals(1, o.get("msg_1")!!.tries)
        assertFalse(o.set(listOf(item("msg_1"), item("msg_2"))), "la misma lista: nada que guardar")
        assertTrue(o.set(listOf(item("msg_1"), item("msg_3"))), "otra lista")
        assertEquals(listOf("msg_1", "msg_3"), o.ids())
        assertEquals(1, o.get("msg_1")!!.tries, "lo que seguía conserva su cuenta (no se vuelve a subir en el acto)")
        assertEquals("ev1", o.get("msg_1")!!.evId)
        assertTrue(o.set(emptyList())); assertEquals(0, o.size())
    }

    @Test fun loQueNoCuadraSeSalta() {
        val o = NetOutbox()
        val malos = listOf(
            NetOutbox.Item("x", A, "{}", 1L), NetOutbox.Item("id con espacio", A, "{}", 1L), NetOutbox.Item("msg_ok", "NXAAAAAAAA", "{}", 1L),
            NetOutbox.Item("msg_ok", "nx123", "{}", 1L), NetOutbox.Item("msg_ok", A, "", 1L), NetOutbox.Item("msg_ok", A, "x".repeat(NetOutbox.MAX_P + 1), 1L))
        o.set(malos + item("msg_bueno") + item("msg_bueno"))
        assertEquals(listOf("msg_bueno"), o.ids(), "solo lo válido y sin repetir")
        o.set((1..150).map { item("msg_$it") })
        assertEquals(NetOutbox.MAX_ITEMS, o.size(), "tope de la bandeja")
        // token y dirección del toque: solo con forma válida
        o.set(listOf(item("msg_1")), "corto", "http://sin-tls.example/x")
        assertEquals("", o.myToken); assertEquals("", o.wakeUrl)
        o.set(listOf(item("msg_1")), "t".repeat(140), "https://toque.example/x")
        assertEquals(140, o.myToken.length); assertEquals("https://toque.example/x", o.wakeUrl)
    }

    @Test fun insisteRapidoHastaQueUnReleLoAceptaYLuegoDeTardeEnTarde() {
        assertEquals(20_000L, NetOutbox.retryMs(1, false)); assertEquals(40_000L, NetOutbox.retryMs(2, false))
        assertEquals(160_000L, NetOutbox.retryMs(4, false)); assertEquals(300_000L, NetOutbox.retryMs(5, false)); assertEquals(300_000L, NetOutbox.retryMs(40, false))
        assertEquals(15 * 60_000L, NetOutbox.retryMs(1, true)); assertEquals(3_600_000L, NetOutbox.retryMs(2, true)); assertEquals(6 * 3_600_000L, NetOutbox.retryMs(9, true))
        val o = NetOutbox()
        o.set(listOf(item("msg_1")))
        assertEquals(listOf("msg_1"), o.due(2_000L).map { it.id }, "recién puesto: toca ya")
        o.published("msg_1", "ev1", 2_000L)
        assertTrue(o.due(2_000L + 19_999L).isEmpty(), "subido y sin respuesta: espera 20 s")
        assertEquals(1, o.due(2_000L + 20_000L).size, "sin OK del relé: se sube otra vez")
        o.published("msg_1", "ev2", 22_000L)
        assertNull(o.accepted("ev1", 23_000L), "el OK de un intento anterior ya no cuenta (otro evento)")
        val x = o.accepted("ev2", 23_000L)
        assertEquals("msg_1", x?.id, "primera vez que un relé lo acepta")
        assertNull(o.accepted("ev2", 23_500L), "el OK de otro relé al mismo evento no repite el toque ni el registro")
        assertTrue(o.due(23_000L + 15 * 60_000L - 1).isEmpty(), "a salvo en el buzón: no se insiste enseguida")
        assertEquals(1, o.due(23_000L + 15 * 60_000L).size, "sin ✓✓ a los 15 min: otra vez (por si el relé lo perdió)")
        assertNull(o.accepted("", 1L)); assertNull(o.accepted("otro", 1L))
    }

    @Test fun laConfirmacionLoRetiraSoloSiEsDeSuContacto() {
        val o = NetOutbox()
        o.set(listOf(item("msg_1"), item("msg_2", "nxbbbbbbbb")))
        assertFalse(o.confirmed("nxcccccccc", "msg_1"), "otro contacto no puede dar por entregado lo de A")
        assertFalse(o.confirmed(A, "msg_9"))
        assertTrue(o.confirmed(A, "msg_1")); assertTrue(o.confirmed("NXBBBBBBBB", "msg_2"))
        assertEquals(0, o.size())
        assertEquals("msg_1", NetOutbox.receiptOf("""{"v":1,"type":"ack","msgId":"msg_1","from":"nxaaaaaaaa","ts":1}"""))
        assertEquals("msg_1", NetOutbox.receiptOf("""{"v":1,"type":"read_receipt","msgId":"msg_1","from":"nxaaaaaaaa"}"""))
        assertNull(NetOutbox.receiptOf("""{"v":1,"type":"chat","msgId":"msg_1"}"""), "un mensaje no es una confirmación")
        assertNull(NetOutbox.receiptOf("no es json")); assertNull(NetOutbox.receiptOf("""{"type":"ack"}""")); assertNull(NetOutbox.receiptOf(""))
    }

    @Test fun caducaALosSieteDiasYLaAppPuedeRetirarlo() {
        val o = NetOutbox()
        o.set(listOf(item("msg_viejo", at = 0L), item("msg_nuevo", at = NetOutbox.MAX_AGE_MS)))
        val idos = ArrayList<String>()
        val due = o.due(NetOutbox.MAX_AGE_MS + 1) { idos.add(it) }
        assertEquals(listOf("msg_viejo"), idos); assertEquals(listOf("msg_nuevo"), due.map { it.id })
        assertTrue(o.drop("msg_nuevo")); assertFalse(o.drop("msg_nuevo")); assertEquals(0, o.size())
    }

    @Test fun elToqueSaleUnaVezPorMensajeYComoMuchoCadaOchoSegundosPorContacto() {
        val o = NetOutbox()
        o.set(listOf(item("msg_1", wake = "tok-de-a".repeat(4)), item("msg_2", wake = "tok-de-a".repeat(4)), item("msg_3")), "", "https://toque.example/x")
        assertTrue(o.wakeDue(o.get("msg_1")!!, 100_000L))
        assertFalse(o.wakeDue(o.get("msg_1")!!, 200_000L), "uno por mensaje")
        assertFalse(o.wakeDue(o.get("msg_2")!!, 103_000L), "una ráfaga despierta una vez")
        assertFalse(o.wakeDue(o.get("msg_3")!!, 300_000L), "sin token del otro no hay toque")
        val sinUrl = NetOutbox(); sinUrl.set(listOf(item("msg_1", wake = "tok-de-a".repeat(4))))
        assertFalse(sinUrl.wakeDue(sinUrl.get("msg_1")!!, 1L), "sin enviador no hay toque")
    }

    @Test fun seGuardaYSeCargaSinVolverASubirEnElActoLoQueYaEstabaEnElBuzon() {
        val o = NetOutbox()
        o.set(listOf(item("msg_1", wake = "w".repeat(30)), item("msg_2")), "t".repeat(40), "https://toque.example/x")
        o.published("msg_1", "ev1", 10_000L); o.accepted("ev1", 11_000L)
        val json = o.toJson()
        val n = NetOutbox()
        assertEquals(2, n.load(json, 12_000L))
        assertEquals(listOf("msg_1", "msg_2"), n.ids()); assertEquals(40, n.myToken.length); assertEquals("https://toque.example/x", n.wakeUrl)
        assertEquals(o.get("msg_1")!!.p, n.get("msg_1")!!.p); assertEquals("w".repeat(30), n.get("msg_1")!!.wake)
        assertEquals(listOf("msg_2"), n.due(12_000L).map { it.id }, "lo que ya aceptó un relé espera su plazo; lo que no, sale ya")
        assertEquals(2, n.due(11_000L + 15 * 60_000L).size)
        assertEquals(0, NetOutbox().load(null, 1L)); assertEquals(0, NetOutbox().load("basura", 1L)); assertEquals(0, NetOutbox().load("{\"items\":[{\"id\":\"x\"}]}", 1L))
    }

    // 3270 (COLA 27 sin la app): con Wi-Fi y ningún relé abierto, a los 12 s se avisa al teléfono y luego como mucho una vez por minuto
    @Test fun wifiSinInternetAvisaAlTelefonoALosDoceSegundosYUnaVezPorMinuto() {
        assertFalse(NetBg.noNetDue(0L, 0L, 99_000L), "hay relé abierto o no es Wi-Fi")
        assertFalse(NetBg.noNetDue(1_000L, 0L, 1_000L + NetBg.NO_NET_AFTER_MS - 1))
        assertTrue(NetBg.noNetDue(1_000L, 0L, 1_000L + NetBg.NO_NET_AFTER_MS))
        assertFalse(NetBg.noNetDue(1_000L, 13_000L, 13_000L + NetBg.NO_NET_EVERY_MS - 1), "ya avisado: no se repite enseguida")
        assertTrue(NetBg.noNetDue(1_000L, 13_000L, 13_000L + NetBg.NO_NET_EVERY_MS))
        // la escucha de verdad: Wi-Fi, un relé que no existe → avisa (una vez) pasado el plazo; con datos móviles, nunca
        for ((type, quiere) in listOf("wifi" to true, "cell" to false)) {
            val avisos = CopyOnWriteArrayList<Long>(); val logs = CopyOnWriteArrayList<String>()
            val bg = NetBg({ _, _, _, _, _, _ -> }, { logs.add(it) }, onNoInternet = { avisos.add(System.currentTimeMillis()) })
            bg.configure("nxbbbbbbbb", listOf("ws://127.0.0.1:9"), 0L, emptyList())
            bg.setNet(type); bg.start()
            try {
                val t0 = System.currentTimeMillis()
                Thread.sleep(NetBg.NO_NET_AFTER_MS - 3_000L)
                assertTrue(avisos.isEmpty(), "$type: antes del plazo no")
                Thread.sleep(9_500L)
                assertEquals(if (quiere) 1 else 0, avisos.size, "$type a los ${System.currentTimeMillis() - t0} ms: $logs")
                assertEquals(quiere, logs.any { it.contains("Wi-Fi sin internet") })
            } finally { bg.stop() }
        }
    }

    // ===== de punta a punta: relé que exige identificarse + la app REAL del otro lado =====
    private val helper = File("netbg_helper.mjs").absoluteFile
    private val dirs = ArrayList<File>()
    @AfterTest fun limpiar() { dirs.forEach { try { it.deleteRecursively() } catch (e: Exception) { } }; dirs.clear() }
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
        fun close() { try { w.close() } catch (e: Exception) { }; p.destroy() }
    }
    private fun node(mode: String) = Proc(ProcessBuilder(listOf("node", helper.path, mode)).redirectError(ProcessBuilder.Redirect.INHERIT).start())
    private fun until(ms: Long, f: () -> Boolean): Boolean { val t0 = System.currentTimeMillis(); while (System.currentTimeMillis() - t0 < ms) { if (f()) return true; Thread.sleep(100) }; return f() }

    @Test fun laEscuchaSubeLoPendienteSinLaAppLaAppRealLoRecibeYSuConfirmacionVaciaLaBandeja() {
        val relay = node("relay"); val peer = node("peer")
        var bg: NetBg? = null; var bg2: NetBg? = null
        try {
            val url = relay.await("URL ")
            relay.send("PK"); val pkA = relay.await("PK ")
            val pkB = peer.await("PK ")
            val B = "nxbbbbbbbb"
            // La app B (real) da la configuración de la escucha, como al ocultarse
            val n0 = peer.lines.size
            peer.send(JSONObject().put("cfg", JSONObject().put("me", B).put("relays", JSONArray(listOf(url))).put("lastSeen", System.currentTimeMillis() - 60_000)
                .put("contacts", JSONArray().put(JSONObject().put("nx", A).put("name", "Ana").put("pk", pkA)))).toString())
            val cfg = NetBgSaved.fromApp(JSONObject(peer.await("CFG ", n0)))
            val logs = CopyOnWriteArrayList<String>(); val saved = CopyOnWriteArrayList<String>(); val wakes = CopyOnWriteArrayList<String>()
            bg = NetBg({ _, _, _, _, _, _ -> }, { logs.add(it) }, onOutbox = { saved.add(it) }, wake = { u, t -> wakes.add("$u|$t") })
            bg.configure(cfg.me, cfg.relays, cfg.since, cfg.contacts)
            // Lo que deja la app al ocultarse: dos textos ya cifrados de punta a punta (aquí, el paquete tal cual: el nativo no lo abre)
            val p1 = """{"v":1,"type":"chat","from":"$B","to":"","ts":1,"seq":7,"msgId":"msg_out_1","payload":{"text":"e2:AAAA"},"ss":1,"nt":1,"dn":"$A"}"""
            val p2 = """{"v":1,"type":"chat","from":"$B","to":"","ts":2,"seq":8,"msgId":"msg_out_2","payload":{"text":"e2:${"B".repeat(9000)}"},"ss":1,"nt":1,"dn":"$A"}"""
            val tokA = "token-de-ana-".repeat(4); val tokB = "token-de-este-telefono-".repeat(3)
            val now = System.currentTimeMillis()
            assertEquals(2, bg.outboxSet(listOf(NetOutbox.Item("msg_out_1", A, p1, now, tokA), NetOutbox.Item("msg_out_2", A, p2, now, tokA)), tokB, "https://toque.example/despierta"))
            assertEquals(1, saved.size, "la bandeja se guarda al cambiar")
            assertFalse(logs.any { it.contains("AAAA") }, "el contenido nunca va al registro")
            // Sin la app: la escucha arranca y, en cuanto hay relé, sube lo de la bandeja
            bg.start()
            assertTrue(until(15000) { bg.outbox.get("msg_out_1")?.okAt ?: 0L > 0 && bg.outbox.get("msg_out_2")?.okAt ?: 0L > 0 }, "el relé aceptó los dos: $logs")
            assertTrue(logs.any { it.contains("msg_out_1 para $A sale por internet sin la app") } && logs.any { it.contains("msg_out_1 para $A quedó en el buzón") }, "registro: $logs")
            assertEquals(listOf("https://toque.example/despierta|$tokA"), wakes.toList(), "un toque (la ráfaga despierta una vez), solo con el token del otro")
            // La app REAL de A lee el relé: le llegan los dos paquetes TAL CUAL y el token del toque de B
            var r0 = relay.lines.size
            relay.send(JSONObject().put("inbox", JSONObject().put("me", A).put("peer", B).put("peerPk", pkB)).toString())
            val inbox = JSONObject(relay.await("INBOX ", r0))
            val got = inbox.getJSONArray("got").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
            assertEquals(listOf(p1, p2), got.filter { it.getString("nx") == B }.map { it.getString("p") }, "la app real recibe los paquetes sin tocar")
            assertEquals(tokB, inbox.getString("f"), "y el token del toque de este teléfono (como cuando lo manda la app)")
            // Nada más se sube mientras no toque (ni repetidos al momento)
            relay.send("STATS"); val pub0 = JSONObject(relay.await("STATS ", relay.lines.size - 1)).getInt("published")
            Thread.sleep(6500) // una vuelta entera del bucle
            r0 = relay.lines.size; relay.send("STATS")
            assertEquals(pub0, JSONObject(relay.await("STATS ", r0)).getInt("published"), "aceptado: no se vuelve a subir en la vuelta siguiente")

            // Proceso nuevo (Android mató a NEXO): la bandeja guardada cifrada vuelve a estar a cargo de la escucha
            val dir = Files.createTempDirectory("nexo-bandeja").toFile().also { dirs.add(it) }
            val k = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
            val st = AtRestStore(dir) { k }; val w = NetBgSaved.Writer()
            NetBgSaved.saveConfig(st, w, cfg); assertTrue(NetBgSaved.saveOut(st, w, saved.last()))
            assertFalse(NetBgSaved.saveOut(st, w, saved.last()), "igual que lo guardado: no se reescribe")
            val raw = String(File(dir, NetBgSaved.OUT_FILE).readBytes(), Charsets.ISO_8859_1)
            for (s in listOf("msg_out_1", "e2:AAAA", tokA, A)) assertFalse(raw.contains(s), "«$s» no está en claro en el teléfono")
            assertTrue(NetBgSaved.isFile(NetBgSaved.OUT_FILE), "se borra con la cuenta y no viaja al pasarla a otro teléfono")
            val s2 = NetBgSaved.load(AtRestStore(dir) { k })!!
            val logs2 = CopyOnWriteArrayList<String>(); val saved2 = CopyOnWriteArrayList<String>()
            bg2 = NetBg({ _, _, _, _, _, _ -> }, { logs2.add(it) }, onOutbox = { saved2.add(it) })
            NetBgSaved.apply(bg2, s2)
            assertEquals(listOf("msg_out_1", "msg_out_2"), bg2.outbox.ids(), "lo pendiente sigue ahí sin la app")
            assertTrue((bg2.outbox.get("msg_out_1")?.okAt ?: 0L) > 0, "y recuerda que ya estaba en el buzón (no lo repite al arrancar)")
            bg.stop(); bg2.start()
            Thread.sleep(2500)

            // A (real) confirma la entrega del primero: la escucha lo retira y lo guarda
            r0 = relay.lines.size
            relay.send(JSONObject().put("send", JSONObject().put("from", A).put("to", B).put("toPk", pkB)
                .put("p", JSONObject().put("v", 1).put("type", "ack").put("msgId", "msg_out_1").put("from", A).put("ts", System.currentTimeMillis()).toString())).toString())
            relay.await("PUBLISHED ", r0)
            assertTrue(until(10000) { bg2.outbox.ids() == listOf("msg_out_2") }, "la ✓✓ de A retira el primero: ${bg2.outbox.ids()} $logs2")
            assertTrue(logs2.any { it.contains("msg_out_1 confirmado por $A") }, "registro: $logs2")
            assertTrue(until(3000) { saved2.isNotEmpty() && !saved2.last().contains("msg_out_1") && saved2.last().contains("msg_out_2") }, "y queda guardado sin él")
            // y la confirmación sigue llegando a la app al volver (como siempre)
            assertTrue(bg2.drainForApp().isNotEmpty(), "el evento de la ✓✓ queda para la app")
            // La app vuelve y retira el otro (lo mandó ella): bandeja vacía
            bg2.outboxDrop("msg_out_2")
            assertEquals(0, bg2.outbox.size()); assertTrue(saved2.last().contains("\"items\":[]"))
        } finally { try { bg?.stop() } catch (e: Exception) { }; try { bg2?.stop() } catch (e: Exception) { }; relay.close(); peer.close() }
    }
}
