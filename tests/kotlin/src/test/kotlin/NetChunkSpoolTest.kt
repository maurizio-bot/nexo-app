import com.nexo.ble.NetBg
import com.nexo.ble.NetChunkSpool
import com.nexo.ble.Secp256k1
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

// 3336 (diag. vivo 24-11 22:27, adjunto de 23,5 MB atorado en 589/601): con la app congelada, la escucha nativa de internet guarda en
// DISCO los trozos de archivo de un contacto y confirma (acuse de bloque 'ba', como la app) SOLO lo guardado; la app lo recoge al volver.
class NetChunkSpoolTest {
    private fun tmp(): File = Files.createTempDirectory("spool").toFile()
    private fun f(i: Int, n: Int, m: String = "msg123abc") = "{\"v\":1,\"t\":\"f\",\"m\":\"$m\",\"i\":$i,\"n\":$n,\"d\":\"QUJD\"}"

    @Test fun reconoceSoloTrozosDeArchivo() {
        assertEquals(NetChunkSpool.Frame("msg123abc", 3, 10), NetChunkSpool.frameOf(f(3, 10)))
        assertNull(NetChunkSpool.frameOf("{\"v\":1,\"t\":\"c\",\"m\":\"msg123abc\",\"i\":0,\"n\":2}"), "un texto largo no")
        assertNull(NetChunkSpool.frameOf(f(10, 10)), "índice fuera del total")
        assertNull(NetChunkSpool.frameOf(f(0, 30000)), "total desmedido")
        assertNull(NetChunkSpool.frameOf(f(0, 5, "../x")), "id raro")
        assertNull(NetChunkSpool.frameOf("{\"type\":\"chat\"}"))
    }

    @Test fun tramosComoLaApp() {
        assertEquals("0-5,7,9-10", NetChunkSpool.ranges(listOf(9, 0, 1, 2, 3, 4, 5, 7, 10)))
        assertEquals("", NetChunkSpool.ranges(emptyList()))
    }

    @Test fun guardaConfirmaYEntrega() {
        val d = tmp(); val s = NetChunkSpool(d)
        val acks = (0 until 6).map { s.add("nxaaaaaaaa", NetChunkSpool.frameOf(f(it, 6))!!, "EV$it") }
        assertEquals(listOf("", "", "", "0-3", "", "0-5"), acks.map { if (it.isNullOrEmpty()) "" else JSONObject(it).getString("r") }, "cada 4 y al llegar el último")
        val a = JSONObject(acks[5]!!); assertEquals("ba", a.getString("t")); assertEquals("msg123abc", a.getString("m")); assertEquals(6, a.getInt("n"))
        // repetido: se vuelve a confirmar (el que envía no vio el acuse)
        assertEquals("0-5", JSONObject(s.add("nxaaaaaaaa", NetChunkSpool.frameOf(f(2, 6))!!, "EV2")!!).getString("r"))
        // otro proceso (la app murió) ve lo guardado en disco
        val s2 = NetChunkSpool(d)
        assertEquals("0-5", JSONObject(s2.add("nxaaaaaaaa", NetChunkSpool.frameOf(f(5, 6))!!, "EV5")!!).getString("r"))
        assertEquals((0 until 6).map { "EV$it" }, s2.drain(), "en orden de trozo")
        assertTrue(s2.drain().isEmpty() && (d.listFiles()?.isEmpty() ?: true), "al recogerlo se borra")
    }

    @Test fun sinSitioNoConfirma() {
        val s = NetChunkSpool(tmp(), maxBytes = 10)
        assertNull(s.add("nxaaaaaaaa", NetChunkSpool.frameOf(f(0, 2))!!, "x".repeat(50)), "lleno: no se guarda ni se confirma")
        assertNull(s.add("nx!!", NetChunkSpool.frameOf(f(0, 2))!!, "x"), "remitente raro")
    }

    @Test fun pendientesEnElRepaso() {
        val s = NetChunkSpool(tmp())
        s.add("nxaaaaaaaa", NetChunkSpool.frameOf(f(0, 9))!!, "a"); s.add("nxaaaaaaaa", NetChunkSpool.frameOf(f(1, 9))!!, "b")
        val p = s.pendingAcks()
        assertEquals(1, p.size); assertEquals("nxaaaaaaaa", p[0].first); assertEquals("0-1", JSONObject(p[0].second).getString("r"))
        assertTrue(s.pendingAcks().isEmpty(), "una vez")
    }

    // De punta a punta con el relé local (el mismo ayudante que NetBgTest): llegan 6 trozos de Ana; NetBg los guarda, los confirma por
    // el buzón de Ana (sellado para ella) y la app los recoge primero con netBgDrain
    @Test fun dePuntaAPunta() {
        val p = ProcessBuilder(listOf("node", File("netbg_helper.mjs").absoluteFile.path, "relay")).start()
        val rd = BufferedReader(InputStreamReader(p.inputStream))
        val url = rd.readLine().removePrefix("URL ").trim()
        val lines = CopyOnWriteArrayList<String>()
        Thread { try { while (true) { val l = rd.readLine() ?: break; lines.add(l) } } catch (e: Exception) { } }.apply { isDaemon = true; start() }
        val w = p.outputStream.bufferedWriter()
        try {
            val kraw = ByteArray(32) { (it * 7 + 3).toByte() }
            val bg = NetBg({ _, _, _, _, _, _ -> })
            bg.spool = NetChunkSpool(tmp())
            bg.configure("nxbbbbbbbb", listOf(url), System.currentTimeMillis() - 60000, listOf(NetBg.Contact("nxaaaaaaaa", "Ana", kraw)))
            bg.start(); Thread.sleep(1500)
            for (i in 0 until 6) {
                val pj = JSONObject.quote(f(i, 6))
                w.write("{\"kraw\":\"${Secp256k1.hex(kraw)}\",\"from\":\"nxaaaaaaaa\",\"to\":\"nxbbbbbbbb\",\"body\":{\"t\":1,\"p\":$pj}}\n"); w.flush()
            }
            val t0 = System.currentTimeMillis()
            while (bg.spool!!.count() < 6 && System.currentTimeMillis() - t0 < 10000) Thread.sleep(100)
            Thread.sleep(800)
            w.write("DUMP\n"); w.flush()
            var dump: String? = null
            val td = System.currentTimeMillis()
            while (dump == null && System.currentTimeMillis() - td < 5000) { dump = lines.lastOrNull { it.startsWith("EVENTS ") }; if (dump == null) Thread.sleep(100) }
            val events = JSONArray(dump!!.removePrefix("EVENTS "))
            val tagAna = Secp256k1.hex(Secp256k1.xOnly(NetBg.tagKey(kraw, "nxaaaaaaaa", NetBg.day(0))))
            val ranges = ArrayList<String>()
            for (i in 0 until events.length()) {
                val e = events.getJSONObject(i); val tgs = e.getJSONArray("tags")
                if ((0 until tgs.length()).none { tgs.getJSONArray(it).getString(1) == tagAna }) continue
                val body = NetBg.open(kraw, "nxbbbbbbbb", "nxaaaaaaaa", e.getString("content")) ?: continue
                val a = JSONObject(body.getString("p")); if (a.optString("t") == "ba") ranges.add(a.getString("r"))
            }
            assertEquals(listOf("0-3", "0-5"), ranges, "acuses de bloque sellados para Ana")
            val kept = bg.drainForApp()
            assertEquals(6, kept.size, "los 6 trozos para la app (y nada en la lista de memoria)")
            kept.forEach { assertTrue(JSONObject(it).has("sig"), "evento del relé tal cual") }
            bg.stop()
        } finally { try { w.close() } catch (e: Exception) { }; p.destroy() }
    }
}
