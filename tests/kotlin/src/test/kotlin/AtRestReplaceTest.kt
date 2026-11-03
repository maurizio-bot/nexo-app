import com.nexo.ble.AtRestStore
import java.io.File
import java.io.IOException
import javax.crypto.KeyGenerator
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Auditoría #5: el reemplazo atómico de AtRestStore NUNCA debe perder el original. Antes, si el primer rename fallaba,
 * borraba el destino y reintentaba; con el disco lleno o un error de E/S el segundo rename también podía fallar y se
 * quedaba sin original Y sin nuevo. Ahora usa Files.move(ATOMIC_MOVE) y jamás borra el original.
 */
class AtRestReplaceTest {
    private fun tmpDir(): File { val d = File.createTempFile("artest", ""); d.delete(); d.mkdirs(); return d }
    private fun key() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    @Test fun sobrescribirConservaElContenidoNuevo() {
        val k = key(); val s = AtRestStore(tmpDir()) { k }
        s.write("nexo_a.json", "uno")
        s.write("nexo_a.json", "dos")
        assertEquals("dos", s.read("nexo_a.json"))
    }

    @Test fun siElReemplazoFallaElOriginalSigueIntacto() {
        val dir = tmpDir(); val k = key(); val s = AtRestStore(dir) { k }
        // El destino ya existe como DIRECTORIO no vacío: un rename de archivo sobre él falla → fuerza la rama de error.
        val victim = File(dir, "nexo_victim.json"); victim.mkdirs()
        File(victim, "marker").writeText("IMPORTANTE")
        assertFailsWith<IOException> { s.write("nexo_victim.json", "nuevo") }
        // El original (el dir + su contenido) sobrevive; no se perdió nada, y no queda basura .nxtmp
        assertTrue(victim.isDirectory, "el original no debe borrarse")
        assertEquals("IMPORTANTE", File(victim, "marker").readText())
        assertFalse(File(dir, "nexo_victim.json.nxtmp").exists())
    }
}
