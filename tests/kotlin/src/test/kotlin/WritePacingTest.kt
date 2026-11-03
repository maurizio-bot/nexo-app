import com.nexo.ble.WritePacing
import org.junit.Test
import org.junit.Assert.assertEquals

// Prueba de WritePacing.insertIndex (pacing 2b, #141): texto/control (ALTA) salta delante de los trozos de archivo
// (BAJA) en la cola de escritura BLE, sin mover el item en vuelo (índice 0) y manteniendo FIFO entre iguales.
class WritePacingTest {
    private val H = true   // ALTA: texto / control / ack
    private val L = false  // BAJA: trozo de archivo

    @Test fun colaVacia() {
        assertEquals(0, WritePacing.insertIndex(listOf(), true))
        assertEquals(0, WritePacing.insertIndex(listOf(), false))
    }

    @Test fun archivoVaAlFinal() {
        assertEquals(3, WritePacing.insertIndex(listOf(H, L, L), false))
        assertEquals(2, WritePacing.insertIndex(listOf(L, L), false))
        assertEquals(1, WritePacing.insertIndex(listOf(H), false))
    }

    @Test fun textoSaltaDelanteDeLosArchivos() {
        // [archivo(en vuelo), archivo, archivo] + texto -> índice 1: tras el que está saliendo, delante del resto
        assertEquals(1, WritePacing.insertIndex(listOf(L, L, L), true))
    }

    @Test fun textoRespetaFifoEntreAltas() {
        // [ALTA(en vuelo), ALTA, archivo] + texto -> 2: detrás de los dos textos, delante del archivo
        assertEquals(2, WritePacing.insertIndex(listOf(H, H, L), true))
    }

    @Test fun nuncaDesplazaElItemEnVuelo() {
        // Con cola no vacía, un ALTA nunca va al índice 0 (ese puede estar escribiéndose)
        assertEquals(1, WritePacing.insertIndex(listOf(L), true))
        assertEquals(1, WritePacing.insertIndex(listOf(H), true))
    }

    @Test fun todoAltaValAlFinal() {
        assertEquals(3, WritePacing.insertIndex(listOf(H, H, H), true))
    }

    @Test fun variosArchivosTrasUnTextoYaEncolado() {
        // [ALTA(en vuelo), archivo, archivo] + texto -> 1 (delante de los archivos, tras el en vuelo)
        assertEquals(1, WritePacing.insertIndex(listOf(H, L, L), true))
    }
}
