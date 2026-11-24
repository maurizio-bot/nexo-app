import com.nexo.ble.NetBg
import com.nexo.ble.OutboxBle
import org.json.JSONObject
import kotlin.test.*

/**
 * 3316 (COLA 1, lo que faltaba del puente nativo): un texto largo o un archivo por Jump (trozos 'c'/'f', el 0 con el destino 'dt') que
 * llega al nativo con la app dormida o cerrada pasa por una TUBERÍA hacia el enlace del destino, y sus confirmaciones ('ba', 'n') vuelven
 * al que lo manda. Lo que salió por la tubería no se le pasa a la app (heard → true). Antes: el flujo se quedaba en el puente dormido,
 * el que lo mandaba no recibía confirmación y quedaba «enviando».
 */
class JumpPipeTest {
    private val V = "nxvvvvvvvv" // el puente (la app dormida)
    private val S = "nxssssssss" // el que manda
    private val C = "nxcccccccc" // el destino
    private val keyC = ByteArray(32) { (it + 3).toByte() }

    private class Fake(var clock: Long = 1_000_000L) : OutboxBle.Link {
        val ready = HashSet<String>(); val sent = ArrayList<Pair<String, JSONObject>>(); val logs = ArrayList<String>(); var full = false
        override fun ready(mac: String) = mac in ready
        override fun send(mac: String, json: String): Boolean { if (full) return false; sent.add(mac to JSONObject(json)); return true }
        override fun log(msg: String) { logs.add(msg) }
    }
    private fun rig(power: () -> Boolean = { true }, contactC: Boolean = false): Pair<Fake, OutboxBle> {
        val f = Fake()
        val bg = NetBg({ _, _, _, _, _, _ -> }, { })
        return f to OutboxBle({ V }, { bg }, { if (contactC && it == C) keyC else null }, f, power) { f.clock }
    }
    private fun chunk(i: Int, n: Int = 3, m: String = "big_1", dt: String = C, t: String = "f") = JSONObject().put("v", 3).put("t", t).put("m", m)
        .put("i", i).put("n", n).put("d", "cifrado$i").put("a", "").also { if (i == 0) { it.put("fr", S).put("fn", "foto.jpg").put("dt", dt) } }
        .put("k", "kk$i").toString()
    private fun ba(r: String, n: Int = 3, fin: Boolean = false, m: String = "big_1") =
        JSONObject().put("v", 3).put("t", "ba").put("m", m).put("r", r).put("n", n).put("bf", 1).also { if (fin) it.put("f", 1) }.toString()
    private fun ping(from: String) = """{"v":1,"type":"ping","pingId":"p1","ts":1,"fromNexoId":"$from","bf":1}"""

    @Test fun elFlujoPasaEnteroPorLaTuberiaYLasConfirmacionesVuelven() {
        val (f, o) = rig()
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C))
        assertTrue(o.heard("s24", chunk(0)), "el trozo 0 abre la tubería y no es para la app")
        assertTrue(o.heard("s24", chunk(1)))
        assertTrue(o.heard("c01", ba("0-1")), "la confirmación del destino vuelve al que lo manda")
        assertTrue(o.heard("s24", chunk(2)))
        assertTrue(o.heard("c01", ba("0-2", fin = true)))
        val toC = f.sent.filter { it.first == "c01" }.map { it.second }
        assertEquals(listOf(0, 1, 2), toC.map { it.getInt("i") })
        assertEquals(1, toC[0].getInt("hp"), "sube el salto en el trozo 0")
        assertEquals("kk0", toC[0].getString("k"), "la comprobación del trozo va intacta ('hp' no entra en ella)")
        assertEquals("cifrado1", toC[1].getString("d"), "el contenido cifrado va igual")
        assertFalse(toC[1].has("hp"), "los demás trozos tal cual")
        val toS = f.sent.filter { it.first == "s24" }.map { it.second }
        assertEquals(listOf("0-1", "0-2"), toS.map { it.getString("r") })
        assertEquals(1, toS[1].getInt("f"))
        assertEquals(1, o.pipeCount())
        f.clock += 31_000L
        assertEquals(0, o.pipeCount(), "confirmado entero: se cierra a los 30 s")
    }

    @Test fun lasPeticionesDeLoQueFaltaTambienVuelvenYLoRepetidoSigue() {
        val (f, o) = rig()
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C))
        o.heard("s24", chunk(0)); o.heard("s24", chunk(2))
        assertTrue(o.heard("c01", """{"v":3,"t":"n","m":"big_1","r":"1","bf":1}"""))
        assertEquals("n", f.sent.last().second.getString("t")); assertEquals("s24", f.sent.last().first)
        assertTrue(o.heard("s24", chunk(1)), "el que faltaba, repetido, sigue por la tubería")
        assertTrue(o.heard("s24", chunk(0)), "el trozo 0 repetido también")
        assertEquals(4, f.sent.count { it.first == "c01" })
    }

    @Test fun soloLasConfirmacionesDelDestinoYSoloLosTrozosDeQuienAbrio() {
        val (f, o) = rig()
        f.ready.addAll(listOf("s24", "c01", "x99"))
        o.heard("c01", ping(C))
        o.heard("s24", chunk(0))
        val n = f.sent.size
        assertFalse(o.heard("x99", ba("0-2", fin = true)), "una confirmación de otro enlace no pasa (y la ve la app)")
        assertFalse(o.heard("x99", chunk(1)), "un trozo del mismo id por otro enlace no se cuela")
        assertFalse(o.heard("s24", chunk(1, n = 7)), "otro troceado del mismo id no se cuela")
        assertEquals(n, f.sent.size)
    }

    @Test fun loQueEsParaMiODirectoNoTocaLaTuberia() {
        val (f, o) = rig()
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C))
        assertFalse(o.heard("s24", chunk(0, dt = V)), "para mí: lo de siempre")
        val direct = JSONObject(chunk(0)).also { it.remove("dt") }.toString()
        assertFalse(o.heard("s24", direct), "directo (sin 'dt'): lo de siempre")
        assertTrue(f.sent.isEmpty()); assertEquals(0, o.pipeCount())
    }

    @Test fun sinEnlaceConElDestinoNoSeAbreYLaAppLoVe() {
        val (f, o) = rig()
        f.ready.add("s24")
        assertFalse(o.heard("s24", chunk(0)))
        assertFalse(o.heard("s24", chunk(1)))
        assertTrue(f.sent.isEmpty()); assertEquals(0, o.pipeCount())
        assertTrue(f.logs.any { it.contains("flujo big_1 para $C: sin enlace comprobado") })
    }

    @Test fun conPocaBateriaNoHaceDeTuberia() {
        val (f, o) = rig(power = { false })
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C))
        assertFalse(o.heard("s24", chunk(0)))
        assertTrue(f.sent.isEmpty())
    }

    @Test fun aUnContactoMioSoloPorEnlaceComprobado() {
        val (f, o) = rig(contactC = true)
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C))
        assertFalse(o.heard("s24", chunk(0)), "aún sin comprobar: no se abre")
        assertTrue(f.sent.none { it.second.optString("t") == "f" })
        assertTrue(f.sent.any { it.first == "c01" && it.second.optString("type") == "oc" }, "se le manda el reto")
    }

    @Test fun siSeCaeElEnlaceDelDestinoSeCierraYSiLaColaEstaLlenaSigue() {
        val (f, o) = rig()
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C))
        o.heard("s24", chunk(0))
        f.full = true
        assertTrue(o.heard("s24", chunk(1)), "cola llena: se pierde como en el aire, la tubería sigue")
        f.full = false
        assertEquals(1, o.pipeCount())
        f.ready.remove("c01")
        assertFalse(o.heard("s24", chunk(2)), "enlace caído: se cierra")
        assertEquals(0, o.pipeCount())
    }

    @Test fun unaConfirmacionDeDosSaltosNoEnsenaDeQuienEsElEnlace() {
        val (f, o) = rig()
        f.ready.addAll(listOf("s24", "c01", "j77"))
        o.heard("c01", ping(C))
        // por j77 (un puente despierto) llega la ✓✓ de C para S que ya dio un salto: j77 NO es C
        o.heard("j77", JSONObject().put("v", 1).put("type", "ack").put("msgId", "m9").put("from", C).put("to", S).put("hp", 1).toString())
        o.heard("s24", chunk(0))
        assertEquals("c01", f.sent.last().first, "el flujo para C sale por el enlace de C, no por j77")
    }

    @Test fun elPaqueteCortoReenviadoNoEsParaLaAppElGuardadoSi() {
        val (f, o) = rig()
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C))
        val chat = { id: String, to: String -> JSONObject().put("v", 1).put("type", "chat").put("from", S).put("to", to).put("msgId", id).toString() }
        assertTrue(o.heard("s24", chat("msg_1", C)), "salió: no se le pasa a la app")
        assertFalse(o.heard("s24", chat("msg_2", "nxdddddddd")), "guardado (sin enlace con el destino): la app también lo ve")
    }
}

class JumpRelayRateTest {
    @Test fun unMismoEnlaceNoPuedeHacerReenviarSinFin() {
        val sent = ArrayList<String>()
        val link = object : OutboxBle.Link {
            override fun ready(mac: String) = true
            override fun send(mac: String, json: String): Boolean { sent.add(mac); return true }
            override fun log(msg: String) {}
        }
        var clock = 1_000_000L
        val o = OutboxBle({ "nxvvvvvvvv" }, { null }, { null }, link, { true }) { clock }
        o.heard("c01", """{"v":1,"type":"ping","pingId":"p1","ts":1,"fromNexoId":"nxcccccccc"}""")
        for (i in 0 until 200) o.heard("s24", org.json.JSONObject().put("v", 1).put("type", "chat").put("from", "nxssssssss").put("to", "nxcccccccc").put("msgId", "msg_$i").toString())
        assertEquals(OutboxBle.RELAY_PER_LINK_MIN, sent.count { it == "c01" }, "como mucho 120 por minuto de un mismo enlace")
        clock += 61_000L
        o.heard("s24", org.json.JSONObject().put("v", 1).put("type", "chat").put("from", "nxssssssss").put("to", "nxcccccccc").put("msgId", "msg_x").toString())
        assertEquals(OutboxBle.RELAY_PER_LINK_MIN + 1, sent.count { it == "c01" }, "pasado el minuto, otra vez")
    }
}
