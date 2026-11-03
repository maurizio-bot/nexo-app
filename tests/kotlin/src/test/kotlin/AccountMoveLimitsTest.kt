import com.nexo.ble.AccountMove
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * Auditoría #11 (F8): traer la cuenta reservaba ByteArray(len) con len hasta 512 MB por archivo de texto → riesgo de
 * OOM. Ahora hay tope por archivo de texto y tope agregado, comprobados ANTES de reservar memoria. Los archivos grandes
 * (fotos/vídeos) no son de texto: van en streaming (no entran aquí).
 */
class AccountMoveLimitsTest {
    private fun tmpDir(): File { val d = File.createTempFile("amtest", ""); d.delete(); d.mkdirs(); return d }

    private fun pkg(entries: List<Pair<String, ByteArray>>): ByteArray {
        val bos = ByteArrayOutputStream(); val d = DataOutputStream(bos)
        d.writeUTF(AccountMove.MAGIC)
        for ((name, bytes) in entries) { d.writeByte(1); d.writeUTF(name); d.writeInt(bytes.size); d.write(bytes) }
        d.writeByte(0); d.flush()
        return bos.toByteArray()
    }

    @Test fun importNormalFunciona() {
        val got = HashMap<String, String>()
        val st = AccountMove.import(ByteArrayInputStream(pkg(listOf("nexo_a.json" to "hola".toByteArray()))),
            emptySet(), { n, t -> got[n] = t }, tmpDir())
        assertEquals(1, st.files); assertEquals("hola", got["nexo_a.json"])
    }

    @Test fun rechazaUnTextoEnormeSinReservarMemoria() {
        // len declarado > maxTextFile: debe lanzar ANTES de reservar (no hace falta dar los 5 MB → no hay OOM)
        val bos = ByteArrayOutputStream(); val d = DataOutputStream(bos)
        d.writeUTF(AccountMove.MAGIC); d.writeByte(1); d.writeUTF("nexo_big.json"); d.writeInt(5_000_000); d.flush()
        assertFailsWith<IOException> {
            AccountMove.import(ByteArrayInputStream(bos.toByteArray()), emptySet(), { _, _ -> }, tmpDir(), maxTextFile = 1_000_000)
        }
    }

    @Test fun rechazaLaSumaDeTextoDemasiadoGrande() {
        // dos archivos que pasan el tope por-archivo pero cuya SUMA pasa el agregado → lanza en el segundo
        val entries = listOf("nexo_a.json" to ByteArray(600), "nexo_b.json" to ByteArray(600))
        assertFailsWith<IOException> {
            AccountMove.import(ByteArrayInputStream(pkg(entries)), emptySet(), { _, _ -> }, tmpDir(),
                maxTextFile = 1000, maxTextTotal = 1000L)
        }
    }
}
