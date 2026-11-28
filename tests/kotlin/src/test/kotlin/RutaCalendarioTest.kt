import com.nexo.ble.RutaCalendario
import com.nexo.ble.RutaCalendario.Item
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.test.*

/**
 * Fase 1 del contrato de los caminos (28-11): las piezas mecánicas del calendario en la parte nativa (RutaCalendario.kt) dan EXACTAMENTE lo
 * mismo que las de la app (src/core/ruta/calendario.js, reles_puntos.js, contacto_ruta.js) con los vectores compartidos
 * tests/vectores/calendario.json (los mismos que usa tests/sim/calvectores.js). Si se cambia una sin la otra, falla.
 */
class RutaCalendarioTest {
    private val v = JSONObject(File("../vectores/calendario.json").readText())
    private fun longs(a: JSONArray) = (0 until a.length()).map { a.getLong(it) }

    @Test fun espera() { val a = v.getJSONArray("espera"); for (i in 0 until a.length()) { val c = a.getJSONArray(i); assertEquals(c.getLong(3), RutaCalendario.espera(c.getLong(0), c.getInt(1), c.getDouble(2)), c.toString()) } }
    @Test fun siguienteTrasFallo() {
        val a = v.getJSONArray("siguienteTrasFallo")
        for (i in 0 until a.length()) { val c = a.getJSONObject(i); val o = c.getJSONObject("out")
            assertEquals(RutaCalendario.Siguiente(o.getLong("at"), o.getBoolean("lento")), RutaCalendario.siguienteTrasFallo(c.getString("tipo"), c.getInt("n"), c.getInt("usados"), c.getLong("now"), c.getDouble("r")), c.toString()) }
    }
    @Test fun toqueAt() { val a = v.getJSONArray("toqueAt"); for (i in 0 until a.length()) { val c = a.getJSONArray(i); assertEquals(c.getLong(2), RutaCalendario.toqueAt(c.getLong(0), c.getInt(1)), c.toString()) } }
    @Test fun sinAckMs() { val a = v.getJSONArray("sinAckMs"); for (i in 0 until a.length()) { val c = a.getJSONArray(i); assertEquals(c.getLong(1), RutaCalendario.sinAckMs(c.getLong(0)), c.toString()) } }
    @Test fun cabeSobre() { val a = v.getJSONArray("cabeSobre"); for (i in 0 until a.length()) { val c = a.getJSONObject(i); assertEquals(c.getBoolean("out"), RutaCalendario.cabeSobre(longs(c.getJSONArray("salidas")), c.getLong("now")), c.toString()) } }
    @Test fun juntar() {
        val a = v.getJSONArray("juntar")
        for (i in 0 until a.length()) {
            val c = a.getJSONObject(i); val l = c.getJSONArray("lista")
            val items = (0 until l.length()).map { val o = l.getJSONObject(it); Item(o.getString("msgId"), o.getString("nx"), o.getString("carril"), o.getString("tipo"), o.getInt("chars")) }
            val o = c.getJSONArray("out"); val want = (0 until o.length()).map { j -> val g = o.getJSONArray(j); (0 until g.length()).map { g.getString(it) } }
            assertEquals(want, RutaCalendario.juntar(items), c.toString())
        }
    }
    @Test fun cupoPorMin() { val a = v.getJSONArray("cupoPorMin"); for (i in 0 until a.length()) { val c = a.getJSONArray(i); assertEquals(c.getInt(2), RutaCalendario.cupoPorMin(c.getLong(0), c.getLong(1)), c.toString()) } }
    @Test fun toqueDegradado() { val a = v.getJSONArray("toqueDegradado"); for (i in 0 until a.length()) { val c = a.getJSONArray(i); assertEquals(c.getBoolean(2), RutaCalendario.toqueDegradado(c.getInt(0), c.getInt(1)), c.toString()) } }
    @Test fun tocar() {
        val a = v.getJSONArray("tocar")
        for (i in 0 until a.length()) { val c = a.getJSONObject(i)
            assertEquals(c.getBoolean("out"), RutaCalendario.tocar(c.getBoolean("tiene"), c.getBoolean("degradado"), c.getString("despierto"), c.getString("tipo"), c.getBoolean("primero")), c.toString()) }
    }
    @Test fun degradadoVigente() {
        val now = 1_800_000_000_000L
        assertTrue(RutaCalendario.degradadoVigente(now - 1000, now - 5000, now))       // el último llegó degradado
        assertFalse(RutaCalendario.degradadoVigente(now - 5000, now - 1000, now))      // después llegó uno bien
        assertFalse(RutaCalendario.degradadoVigente(0L, 0L, now))                       // nunca
        assertFalse(RutaCalendario.degradadoVigente(now - 8L * 24 * 3_600_000, 0L, now)) // hace más de 7 días
    }
}
