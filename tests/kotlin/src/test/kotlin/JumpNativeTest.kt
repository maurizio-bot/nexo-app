import com.nexo.ble.NetBg
import com.nexo.ble.OutboxBle
import org.json.JSONObject
import kotlin.test.*

/**
 * 3315 (COLA 1, puente nativo con la app dormida): un paquete Jump para OTRO teléfono que llega al nativo con la app dormida o cerrada
 * se reenvía tal cual (solo sube 'hp') por el enlace de su destino; si aún no lo hay, espera unos minutos a que ese enlace hable. La ✓✓
 * de vuelta viaja igual. Sin custodia ('rk'): el que lo mandó conserva su copia y sus otros caminos.
 * Caso real: vivo nx09acdb61 (14-11) con la app dormida: el S24 le pasaba textos para otros, nadie los reenviaba, ×8 y ⏳.
 */
class JumpNativeTest {
    private val V = "nxvvvvvvvv" // el puente (la app dormida)
    private val S = "nxssssssss" // el que manda (S24)
    private val C = "nxcccccccc" // el destino
    private val keyC = ByteArray(32) { (it + 3).toByte() }

    private class Fake(var clock: Long = 1_000_000L) : OutboxBle.Link {
        val ready = HashSet<String>(); val sent = ArrayList<Pair<String, JSONObject>>(); val logs = ArrayList<String>(); var full = false
        override fun ready(mac: String) = mac in ready
        override fun send(mac: String, json: String): Boolean { if (full) return false; sent.add(mac to JSONObject(json)); return true }
        override fun log(msg: String) { logs.add(msg) }
        fun of(type: String) = sent.filter { it.second.optString("type") == type }
    }
    private fun rig(power: () -> Boolean = { true }, contactC: Boolean = false): Pair<Fake, OutboxBle> {
        val f = Fake()
        val bg = NetBg({ _, _, _, _, _, _ -> }, { })
        return f to OutboxBle({ V }, { bg }, { if (contactC && it == C) keyC else null }, f, power) { f.clock }
    }
    private fun chat(id: String, to: String = C, hp: Int? = null) = JSONObject().put("v", 1).put("type", "chat").put("from", S).put("to", to)
        .put("msgId", id).put("payload", JSONObject().put("text", "e2:cifrado")).also { if (hp != null) it.put("hp", hp) }.toString()
    private fun sx(id: String) = JSONObject().put("v", 1).put("type", "sx").put("to", C).put("msgId", id).put("x", "sellado").toString()
    private fun ack(id: String) = JSONObject().put("v", 1).put("type", "ack").put("msgId", id).put("from", C).put("to", S).put("ts", 1).put("a", "firma").toString()
    private fun ping(from: String) = """{"v":1,"type":"ping","pingId":"p1","ts":1,"fromNexoId":"$from","bf":1}"""

    @Test fun elPaqueteParaOtroSaleTalCualPorElEnlaceDelDestinoSinCustodia() {
        val (f, o) = rig()
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C))
        o.heard("s24", chat("msg_1"))
        assertEquals(1, f.sent.size)
        val (mac, p) = f.sent[0]
        assertEquals("c01", mac)
        assertEquals(1, p.getInt("hp"), "sube el salto")
        assertEquals("e2:cifrado", p.getJSONObject("payload").getString("text"), "el contenido cifrado va igual")
        assertEquals(S, p.getString("from")); assertEquals(C, p.getString("to"))
        assertTrue(f.of("rk").isEmpty(), "sin custodia: el que lo mandó sigue a cargo")
        assertEquals(1, o.relayedCount)
        assertTrue(f.logs.any { it.contains("chat:msg_1 para $C sale por c01 (salto 1)") })
    }

    @Test fun elReintentoDelQueLoMandoNoSeReenviaEnSeguidaPeroSiPasados30s() {
        val (f, o) = rig()
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C))
        o.heard("s24", chat("msg_1"))
        f.clock += 5_000L; o.heard("s24", chat("msg_1"))
        assertEquals(1, f.sent.size)
        f.clock += 25_000L; o.heard("s24", chat("msg_1"))
        assertEquals(2, f.sent.size, "sin ✓✓ a los 30 s el que lo mandó insiste: otra vez (el destino descarta el repetido)")
    }

    @Test fun laConfirmacionDelDestinoVuelvePorElEnlaceDeQuienLoEscribio() {
        val (f, o) = rig()
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C))
        o.heard("s24", chat("msg_1")) // primer salto: el enlace s24 es de S
        o.heard("c01", ack("msg_1"))
        val a = f.of("ack")
        assertEquals(1, a.size)
        assertEquals("s24", a[0].first)
        assertEquals("firma", a[0].second.getString("a"), "la firma de punta a punta va intacta")
    }

    @Test fun sinEnlaceConElDestinoEsperaYSaleEnCuantoHabla() {
        val (f, o) = rig()
        f.ready.add("s24")
        o.heard("s24", chat("msg_1"))
        o.heard("s24", sx("msg_2")) // sellado: tampoco se sabe de quién, igual se reenvía
        assertTrue(f.sent.isEmpty()); assertEquals(2, o.heldCount())
        f.ready.add("c01")
        o.heard("c01", ping(C))
        assertEquals(listOf("c01", "c01"), f.sent.map { it.first })
        assertEquals(setOf("msg_1", "msg_2"), f.sent.map { it.second.getString("msgId") }.toSet())
        assertEquals(0, o.heldCount())
    }

    @Test fun loGuardadoCaducaALos10MinYNoVuelvePorDondeLlego() {
        val (f, o) = rig()
        f.ready.add("s24")
        o.heard("s24", ping(C)) // el único enlace «de C» es el mismo por el que llega: no se devuelve
        o.heard("s24", chat("msg_1"))
        assertTrue(f.sent.isEmpty()); assertEquals(1, o.heldCount())
        f.clock += OutboxBle.RELAY_HOLD_MS + 1
        assertEquals(0, o.heldCount(), "pasados 10 min decide el que lo mandó (lo sigue teniendo)")
    }

    @Test fun conPocaBateriaNoHaceDePuenteDeMensajesPeroLaConfirmacionSiPasa() {
        var ok = false
        val (f, o) = rig({ ok })
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C)); o.heard("s24", ping(S))
        o.heard("s24", chat("msg_1"))
        assertTrue(f.sent.isEmpty()); assertEquals(0, o.heldCount())
        assertTrue(f.logs.any { it.contains("batería baja") })
        o.heard("c01", ack("msg_0"))
        assertEquals(1, f.of("ack").size)
        ok = true; o.heard("s24", chat("msg_1"))
        assertEquals(1, f.of("chat").size)
    }

    @Test fun nadaQueNoSeaUnPaqueteJumpValido() {
        val me = V
        assertNull(OutboxBle.relayOf(chat("msg_1", to = V), me), "para mí: lo atiende el buzón, no el puente")
        assertNull(OutboxBle.relayOf(chat("msg_1", to = "nada"), me))
        assertNull(OutboxBle.relayOf(chat("msg_1", hp = 8), me), "pasó de 8 saltos")
        assertNotNull(OutboxBle.relayOf(chat("msg_1", hp = 7), me))
        assertEquals(1, OutboxBle.relayOf(chat("msg_1", hp = -5), me)!!.hp, "un salto negativo no da saltos sin fin")
        assertNull(OutboxBle.relayOf(chat("x"), me), "id inválido")
        assertNull(OutboxBle.relayOf("""{"type":"rt","to":"$C","msgId":"msg_1"}""", me), "otros tipos no")
        assertNull(OutboxBle.relayOf("{" + "\"to\":\"$C\",".repeat(10) + "\"x\":\"" + "a".repeat(6000) + "\"}", me), "lo grande no")
        assertNull(OutboxBle.relayOf(chat("msg_1"), ""), "sin saber quién soy, nada")
    }

    @Test fun aUnContactoMioSoloPorUnEnlaceQueDemuestraSerEl() {
        val (f, o) = rig(contactC = true)
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("c01", ping(C)) // dice ser C: aún sin comprobar
        o.heard("s24", chat("msg_1"))
        assertTrue(f.of("chat").isEmpty(), "sin comprobar no se le escribe")
        val reto = f.of("oc").last { it.first == "c01" }.second.getString("n")
        o.heard("c01", JSONObject().put("v", 1).put("type", "or").put("n", reto).put("from", C).put("a", "mala").toString())
        assertTrue(f.of("chat").isEmpty(), "con la firma mala, nada")
        f.clock += 5_000L
        o.heard("c01", ping(C)) // vuelve a hablar: otro reto
        val reto2 = f.of("oc").last { it.first == "c01" }.second.getString("n")
        o.heard("c01", JSONObject().put("v", 1).put("type", "or").put("n", reto2).put("from", C).put("a", NetBg.ackMac(keyC, "or|$reto2|$C|$V")).toString())
        assertEquals(listOf("c01"), f.of("chat").map { it.first }, "comprobado: sale lo que esperaba")
    }

    private fun rq(id: String, from: String = S, dst: String = C) = JSONObject().put("v", 1).put("type", "rq").put("id", id).put("from", from).put("dst", dst).put("ttl", 3).put("path", org.json.JSONArray()).toString()
    private fun rigS(power: () -> Boolean = { true }): Pair<Fake, OutboxBle> { // S es contacto mío (el que busca)
        val f = Fake()
        val bg = NetBg({ _, _, _, _, _, _ -> }, { })
        return f to OutboxBle({ V }, { bg }, { if (it == S) keyC else null }, f, power) { f.clock }
    }

    @Test fun aLaBusquedaDeUnContactoContestaQueLlegaSiTieneEnlaceConElDestino() {
        val (f, o) = rigS()
        f.ready.addAll(listOf("s24", "c01"))
        o.heard("s24", rq("rq_1"))
        assertTrue(f.of("rp").isEmpty(), "sin enlace con C: callado (no sigue preguntando: eso es de la app)")
        o.heard("c01", ping(C))
        o.heard("s24", rq("rq_2"))
        val rp = f.of("rp")
        assertEquals(1, rp.size); assertEquals("s24", rp[0].first)
        assertEquals("rq_2", rp[0].second.getString("id")); assertEquals(V, rp[0].second.getString("from"))
        assertEquals(C, rp[0].second.getString("dst")); assertEquals(1, rp[0].second.getInt("hops"))
        o.heard("s24", rq("rq_2")); assertEquals(1, f.of("rp").size, "la misma búsqueda, una vez")
        // y lo que manda después sale por el enlace de C
        o.heard("s24", chat("msg_1"))
        assertEquals(listOf("c01"), f.of("chat").map { it.first })
    }

    @Test fun aQuienNoEsContactoOConPocaBateriaNoSeContesta() {
        val (f, o) = rig() // S no es contacto: el 'rp' lleva mi NEXO ID (regla 12A)
        f.ready.addAll(listOf("s24", "c01")); o.heard("c01", ping(C))
        o.heard("s24", rq("rq_1"))
        assertTrue(f.of("rp").isEmpty())
        var ok = false
        val (f2, o2) = rigS({ ok })
        f2.ready.addAll(listOf("s24", "c01")); o2.heard("c01", ping(C))
        o2.heard("s24", rq("rq_1")); assertTrue(f2.of("rp").isEmpty(), "batería baja")
        o2.heard("c01", rq("rq_2", dst = C)); assertTrue(f2.of("rp").isEmpty(), "por el mismo enlace del destino no")
        ok = true; o2.heard("s24", rq("rq_3")); assertEquals(1, f2.of("rp").size)
        for (i in 4..40) o2.heard("s24", rq("rq_$i"))
        assertEquals(OutboxBle.RQ_PER_LINK_MIN, f2.of("rp").size, "tope de búsquedas por minuto de un enlace")
        assertNull(OutboxBle.rqOf("""{"type":"kx","rq":1,"from":"$S"}"""), "el «quién soy» con rq:1 no es una búsqueda")
    }

    @Test fun unEnlaceNoLlenaLoGuardado() {
        val (f, o) = rig()
        f.ready.add("s24")
        for (i in 1..20) o.heard("s24", chat("msg_$i"))
        assertEquals(OutboxBle.RELAY_HOLD_PER_LINK, o.heldCount())
        f.ready.add("c01"); o.heard("c01", ping(C))
        assertEquals((13..20).map { "msg_$it" }, f.sent.map { it.second.getString("msgId") }, "se quedan los más nuevos")
    }
}
