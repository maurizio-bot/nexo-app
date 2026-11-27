import com.nexo.ble.RelayPolicy
import com.nexo.ble.RelayPolicy.Pause
import com.nexo.ble.RelayPolicy.View
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.test.*

/**
 * Fase 1 (internet) del contrato de los caminos (28-11): la política de relés de la parte nativa (RelayPolicy.kt) da EXACTAMENTE lo mismo que
 * la de la app (src/core/ruta/politica_reles.js) con los vectores compartidos tests/vectores/politica_reles.json (los mismos que usa
 * tests/sim/politicareles.js). Si se cambia una sin la otra, falla.
 */
class RelayPolicyTest {
    private val v = JSONObject(File("../vectores/politica_reles.json").readText())
    private fun pause(o: JSONObject?): Pause? = o?.let { Pause(it.getString("kind"), it.getInt("n"), it.getLong("at"), it.getLong("hasta")) }
    private fun pauses(o: JSONObject?): Map<String, Pause> { val m = LinkedHashMap<String, Pause>(); o?.keys()?.forEach { m[it] = pause(o.getJSONObject(it))!! }; return m }
    private fun strs(a: JSONArray?): List<String>? = a?.let { (0 until it.length()).map { i -> it.getString(i) } }

    @Test fun tipoLimite() { val a = v.getJSONArray("tipoLimite"); for (i in 0 until a.length()) { val c = a.getJSONArray(i); assertEquals(c.getString(1), RelayPolicy.limitKind(c.getString(0)), c.getString(0)) } }
    @Test fun pausaMs() { val a = v.getJSONArray("pausaMs"); for (i in 0 until a.length()) { val c = a.getJSONArray(i); assertEquals(c.getLong(2), RelayPolicy.coolMs(c.getString(0), c.getInt(1)), c.toString()) } }
    @Test fun anotarLimite() {
        val a = v.getJSONArray("anotarLimite")
        for (i in 0 until a.length()) { val c = a.getJSONObject(i); assertEquals(pause(c.optJSONObject("out")), RelayPolicy.note(pause(c.optJSONObject("prev")), c.getString("msg"), c.getLong("now")), c.toString()) }
    }
    @Test fun juntarPausas() {
        val a = v.getJSONArray("juntarPausas")
        for (i in 0 until a.length()) { val c = a.getJSONObject(i); assertEquals(pauses(c.getJSONObject("out")), RelayPolicy.merge(pauses(c.optJSONObject("a")), pauses(c.optJSONObject("b")), c.getLong("now")), c.toString()) }
    }
    @Test fun lecturasDe() {
        val a = v.getJSONArray("lecturasDe")
        for (i in 0 until a.length()) {
            val c = a.getJSONObject(i); val an = c.optJSONObject("anuncio")
            val got = if (an == null || an.optJSONArray("lee") == null || !an.has("at")) null else RelayPolicy.readsOf(strs(an.getJSONArray("lee")), an.getLong("at"), strs(c.getJSONArray("pool"))!!, c.getLong("now"))
            assertEquals(strs(c.optJSONArray("out")), got, c.toString())
        }
    }
    @Test fun destinos() {
        val a = v.getJSONArray("destinos")
        for (i in 0 until a.length()) {
            val c = a.getJSONObject(i); val rs = c.getJSONArray("relays")
            val views = (0 until rs.length()).map { val r = rs.getJSONObject(it); View(r.getString("url"), r.optBoolean("abierto"), r.optLong("hasta", 0L), r.optBoolean("soloLeer"), r.optBoolean("puente")) }
            val t = RelayPolicy.targets(views, strs(c.optJSONArray("lee")), c.getLong("now")); val o = c.getJSONObject("out")
            assertEquals(strs(o.getJSONArray("publicar")), t.publicar, c.optString("_")); assertEquals(strs(o.getJSONArray("pausados")), t.pausados, c.optString("_")); assertEquals(o.getString("motivo"), t.motivo, c.optString("_"))
        }
    }
    @Test fun daGuardado() { val a = v.getJSONArray("daGuardado"); for (i in 0 until a.length()) { val c = a.getJSONArray(i); assertEquals(c.getBoolean(2), RelayPolicy.givesSaved(c.getString(0), strs(c.optJSONArray(1))), c.toString()) } }
}
