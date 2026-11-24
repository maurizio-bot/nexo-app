import com.nexo.ble.GwServe
import com.nexo.ble.NetBg
import com.nexo.ble.OutboxBle
import org.json.JSONArray
import org.json.JSONObject
import kotlin.test.*

/**
 * 3321 (dueño 24-11: S24 solo con Bluetooth, la tablet con Wi-Fi y la app cerrada al lado: «nx1e29ab2f no contesta en 5 s»). El puente a
 * internet lo atiende el nativo con la app dormida o cerrada: contesta «¿tienes internet?», abre su conexión al relé y pasa los frames
 * en los dos sentidos, con los mismos límites que la app (solo mensajes privados, trozos de archivo, suscripciones a ellos, AUTH, CLOSE).
 */
class GwServeTest {
    private val T = "nxtttttttt" // la tablet (presta)
    private val A = "nxaaaaaaaa" // el S24 (sin internet)
    private val R = "wss://relay.example"

    private class Fake : OutboxBle.Link {
        val sent = ArrayList<Pair<String, JSONObject>>(); val logs = ArrayList<String>(); var full = 0
        override fun ready(mac: String) = true
        override fun send(mac: String, json: String): Boolean { if (full > 0) { full--; return false }; sent.add(mac to JSONObject(json)); return true }
        override fun log(msg: String) { logs.add(msg) }
    }
    private class Sock : GwServe.Sock {
        val up = ArrayList<String>(); var closed = false
        override fun send(text: String): Boolean { up.add(text); return true }
        override fun close() { closed = true }
    }
    private class Rig(urls: List<String> = listOf("wss://relay.example"), power: Boolean = true) {
        val f = Fake(); val socks = ArrayList<Sock>(); val down = ArrayList<(String) -> Unit>(); val later = ArrayList<() -> Unit>()
        var clock = 1_000_000_000L
        var wifi = true
        val urls = ArrayList(urls)
        val gw = GwServe({ "nxtttttttt" }, { this.urls }, { wifi }, f, { power }, { true },
            { _, onText, _ -> Sock().also { socks.add(it); down.add(onText) } }, { clock }, { later.add(it) })
        fun runLater() { while (later.isNotEmpty()) later.removeAt(0)() }
    }
    private fun ig(op: String, from: String = A, extra: (JSONObject) -> Unit = {}) = JSONObject().put("v", 1).put("type", "ig").put("op", op).put("from", from).also(extra).toString()
    private fun hex(n: Int, c: Char = 'a') = c.toString().repeat(n)
    private fun ev(kind: Int, id: String = hex(64)) = JSONObject().put("id", id).put("pubkey", hex(64, 'b')).put("sig", hex(128, 'c')).put("kind", kind)
        .put("created_at", 1700000000).put("tags", JSONArray()).put("content", "x")
    private fun evFrame(kind: Int, id: String = hex(64)) = JSONArray().put("EVENT").put(ev(kind, id)).toString()
    private fun opened(r: Rig, mac: String = "s24"): String {
        assertTrue(r.gw.handle(mac, ig("o") { it.put("s", "0123456789ab").put("u", R) }))
        r.runLater()
        return "0123456789ab"
    }

    @Test fun contestaQueSiConSusRelesAbiertos() {
        val r = Rig()
        assertTrue(r.gw.handle("s24", ig("q")), "lo atiende el nativo")
        val a = r.f.sent.single()
        assertEquals("s24", a.first); assertEquals("a", a.second.optString("op")); assertEquals(R, a.second.getJSONArray("u").getString(0))
        assertEquals(T, a.second.optString("from")); assertEquals(1, a.second.optInt("w"))
    }

    @Test fun sinInternetOSinBateriaDiceQueNo() {
        val r = Rig(urls = emptyList())
        r.gw.handle("s24", ig("q"))
        assertEquals(0, r.f.sent.single().second.getJSONArray("u").length())
        val r2 = Rig(power = false)
        r2.gw.handle("s24", ig("q"))
        assertEquals(0, r2.f.sent.single().second.getJSONArray("u").length())
    }

    @Test fun abreLaSesionYPasaLosFramesEnLosDosSentidos() {
        val r = Rig()
        val sid = opened(r)
        val k = r.f.sent.last().second
        assertEquals("k", k.optString("op")); assertEquals(1, k.optInt("ok")); assertEquals(sid, k.optString("s"))
        assertTrue(r.gw.handle("s24", ig("f") { it.put("s", sid).put("d", evFrame(1059)) }))
        assertEquals(1, r.socks.single().up.size, "el mensaje privado sube al relé")
        val req = JSONArray().put("REQ").put("sub1").put(JSONObject().put("kinds", JSONArray().put(1059)).put("#p", JSONArray().put(hex(64, 'd')))).toString()
        r.gw.handle("s24", ig("f") { it.put("s", sid).put("d", req) })
        assertEquals(2, r.socks.single().up.size, "la suscripción a mis mensajes también")
        r.down.single()("[\"EOSE\",\"sub1\"]")
        val e = r.f.sent.last().second
        assertEquals("e", e.optString("op")); assertEquals("[\"EOSE\",\"sub1\"]", e.optString("d"))
    }

    @Test fun noDejaSubirOtraCosa() {
        val r = Rig()
        val sid = opened(r)
        val bad = listOf(
            evFrame(1),                                                     // una nota pública
            JSONArray().put("REQ").put("s").put(JSONObject()).toString(),   // «tráeme todo»
            JSONArray().put("REQ").put("s").put(JSONObject().put("kinds", JSONArray().put(1))).toString(),
            JSONArray().put("EVENT").put(ev(1059).put("sig", "zz")).toString(),
            "[\"COUNT\",\"x\",{}]", "no json",
        )
        bad.forEach { r.gw.handle("s24", ig("f") { o -> o.put("s", sid).put("d", it) }) }
        assertEquals(0, r.socks.single().up.size)
        assertEquals("BLOB", GwServe.allowUp(evFrame(1064)))
        assertEquals("AUTH", GwServe.allowUp(JSONArray().put("AUTH").put(ev(22242)).toString()))
        assertEquals("CLOSE", GwServe.allowUp("[\"CLOSE\",\"sub1\"]"))
        assertEquals("REQ", GwServe.allowUp(JSONArray().put("REQ").put("c").put(JSONObject().put("ids", JSONArray().put(hex(64)))).toString()))
    }

    @Test fun porLaSesionSoloHablaSuEnlace() {
        val r = Rig()
        val sid = opened(r)
        r.gw.handle("otro", ig("f") { it.put("s", sid).put("d", evFrame(1059)) })
        r.gw.handle("otro", ig("c") { it.put("s", sid) })
        assertEquals(0, r.socks.single().up.size); assertFalse(r.socks.single().closed)
        r.gw.handle("s24", ig("c") { it.put("s", sid) })
        assertTrue(r.socks.single().closed)
        assertEquals(0, r.gw.sessions())
    }

    @Test fun releDesconocidoOSidMaloNoAbre() {
        val r = Rig()
        r.gw.handle("s24", ig("o") { it.put("s", "0123456789ab").put("u", "wss://otro.example") })
        r.runLater()
        assertEquals(0, r.socks.size); assertEquals(0, r.f.sent.single().second.optInt("ok", 9))
        r.gw.handle("s24", ig("o") { it.put("s", "nohex").put("u", R) }); r.runLater()
        assertEquals(0, r.socks.size)
    }

    @Test fun topeDeMensajesPorMinutoContestaComoUnRele() {
        val r = Rig()
        val sid = opened(r)
        for (i in 0 until 41) r.gw.handle("s24", ig("f") { it.put("s", sid).put("d", evFrame(1059, String.format("%064x", i))) })
        assertEquals(40, r.socks.single().up.size)
        val no = JSONArray(r.f.sent.last().second.optString("d"))
        assertEquals("OK", no.getString(0)); assertFalse(no.getBoolean(2))
        r.clock += 61_000
        r.gw.handle("s24", ig("f") { it.put("s", sid).put("d", evFrame(1059, hex(64, 'e'))) })
        assertEquals(41, r.socks.single().up.size)
    }

    @Test fun colaLlenaNoPierdeNiDesordena() {
        val r = Rig()
        val sid = opened(r)
        r.f.full = 1
        r.down.single()("[\"EVENT\",\"s\",{}]")
        r.down.single()("[\"EOSE\",\"s\"]")
        assertEquals("k", r.f.sent.last().second.optString("op"), "el EOSE no se adelanta")
        r.runLater()
        val ds = r.f.sent.filter { it.second.optString("op") == "e" }.map { it.second.optString("d") }
        assertEquals(listOf("[\"EVENT\",\"s\",{}]", "[\"EOSE\",\"s\"]"), ds)
        assertEquals(sid, r.f.sent.last().second.optString("s"))
    }

    @Test fun conLaAppALaVistaSoloSiguenSusSesiones() {
        val r = Rig()
        assertFalse(r.gw.handle("s24", ig("q"), ownedOnly = true), "lo nuevo ya lo atiende la app")
        val sid = opened(r)
        assertTrue(r.gw.handle("s24", ig("f") { it.put("s", sid).put("d", evFrame(1059)) }, ownedOnly = true))
        assertEquals(1, r.socks.single().up.size)
    }

    @Test fun sinInternetSeCierranLasSesiones() {
        val r = Rig()
        opened(r)
        r.urls.clear()
        r.gw.tick()
        assertTrue(r.socks.single().closed)
        assertEquals("x", r.f.sent.last().second.optString("op"))
    }

    @Test fun laBandejaNativaLoPasaAlPuenteYNoALaApp() {
        val f = Fake()
        val bg = NetBg({ _, _, _, _, _, _ -> }, { })
        val o = OutboxBle({ T }, { bg }, { null }, f)
        assertFalse(o.heard("s24", ig("q")), "sin puente: lo de siempre (lo ve la app)")
        o.gw = GwServe({ T }, { listOf(R) }, { false }, f)
        assertTrue(o.heard("s24", ig("q")))
        assertEquals("a", f.sent.last().second.optString("op"))
        assertFalse(o.heard("s24", ig("f") { it.put("s", "0123456789ab").put("d", evFrame(1059)) }), "una sesión que abrió la app: a la app")
    }
}
