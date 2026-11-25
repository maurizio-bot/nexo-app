import com.nexo.ble.OpenType
import org.json.JSONObject
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// I-S1 + T-A1 (auditoría 23-11): nombre saneado, «es APK» y tipo al abrir. Los casos son los MISMOS que comprueba la
// interfaz (tests/sim/abrirtipo.js con store_flag.js), así el nativo y la tienda deciden igual.
class OpenTypeTest {
    private val vec = JSONObject(File("../sim/opentype_vectors.json").readText())
    private val byExt = vec.getJSONObject("byExt")

    @Test fun casosCompartidos() {
        val casos = vec.getJSONArray("casos")
        assertTrue(casos.length() >= 20)
        for (i in 0 until casos.length()) {
            val c = casos.getJSONObject(i)
            val safe = OpenType.safeName(c.getString("name"))
            val tag = "caso $i (" + c.getString("name").take(30) + ")"
            assertEquals(c.getString("safe"), safe, "$tag nombre")
            assertTrue(safe.length <= 80, "$tag largo")
            assertEquals(c.getBoolean("apk"), OpenType.isApk(safe), "$tag apk")
            val open = OpenType.mimeFor(safe, c.getString("mime")) { e -> if (byExt.has(e)) byExt.getString(e) else null }
            assertEquals(c.getString("open"), open, "$tag tipo")
            // Solo una APK de nombre llega al instalador
            assertEquals(OpenType.isApk(safe), open == OpenType.APK, "$tag instalador")
        }
    }
}
