import com.nexo.ble.NotifAvatars
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull

// 3094: la foto de cada contacto para sus avisos, solo en memoria (NotifAvatars)
class NotifAvatarsTest {
    @AfterTest fun limpiar() = NotifAvatars.clear()

    @Test fun guardaYDevuelveSinImportarMayusculas() {
        NotifAvatars.put("NX1N36C283", byteArrayOf(1, 2, 3))
        assertContentEquals(byteArrayOf(1, 2, 3), NotifAvatars.get("nx1n36c283"))
        assertContentEquals(byteArrayOf(1, 2, 3), NotifAvatars.get(" NX1N36C283 "))
    }

    @Test fun vaciaONullQuitaLaFoto() {
        NotifAvatars.put("nx1", byteArrayOf(9))
        NotifAvatars.put("nx1", ByteArray(0))
        assertNull(NotifAvatars.get("nx1"))
        NotifAvatars.put("nx2", byteArrayOf(9))
        NotifAvatars.put("nx2", null)
        assertNull(NotifAvatars.get("nx2"))
    }

    @Test fun demasiadoGrandeNoSeGuardaYQuitaLaAnterior() {
        NotifAvatars.put("nx3", byteArrayOf(7))
        NotifAvatars.put("nx3", ByteArray(NotifAvatars.MAX_BYTES + 1))
        assertNull(NotifAvatars.get("nx3"))
    }

    @Test fun comoMuchoMaxFotosYSaleLaMenosUsada() {
        for (i in 0 until NotifAvatars.MAX) NotifAvatars.put("nx$i", byteArrayOf(i.toByte()))
        NotifAvatars.get("nx0") // la más vieja se usa: no debe salir
        NotifAvatars.put("nxnueva", byteArrayOf(1))
        assertEquals(NotifAvatars.MAX, NotifAvatars.size())
        assertContentEquals(byteArrayOf(0), NotifAvatars.get("nx0"))
        assertNull(NotifAvatars.get("nx1"))
    }

    @Test fun parteBase64DeUnDataUrl() {
        assertEquals("QUJD", NotifAvatars.base64Part("data:image/jpeg;base64,QUJD"))
        assertEquals("QUJD", NotifAvatars.base64Part("QUJD"))
    }
}
