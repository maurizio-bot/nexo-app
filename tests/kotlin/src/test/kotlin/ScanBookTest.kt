import com.nexo.ble.ScanBook
import kotlin.test.*

// MULTITUD / EDC (docs/EDC_LIMITES.md, cambios 4 y 5; 23-11): el libro del escaneo. Con pocos teléfonos cerca todo sigue igual
// (cada aviso sale al momento); con cientos, los avisos a la app salen en tandas, los más cercanos primero, un contacto con algo
// esperando no espera nunca, y lo recordado no crece sin tope.
class ScanBookTest {
    private fun mac(i: Int) = "aa%010x".format(i)

    @Test fun unaDireccionSeAvisaUnaVezPorSegundo() {
        val b = ScanBook<String>()
        b.seen("m1", false, 1000)
        assertTrue(b.due("m1", 1000))
        b.seen("m1", false, 1300); assertFalse(b.due("m1", 1300))   // el mismo anuncio 300 ms después: nada
        b.seen("m1", false, 2000); assertTrue(b.due("m1", 2000))
        assertFalse(b.due("nunca-oido", 2000))
    }
    @Test fun elRegistroUnaVezCadaVeinteSegundos() {
        val b = ScanBook<String>()
        b.seen("m1", false, 1000)
        assertTrue(b.shouldLog("m1", 1000)); assertFalse(b.shouldLog("m1", 15000)); assertTrue(b.shouldLog("m1", 21000))
    }
    @Test fun conPocosCercaCadaAvisoSaleAlMomento() {
        val b = ScanBook<String>()
        for (i in 0 until 8) { b.seen(mac(i), false, 1000L + i); assertTrue(b.due(mac(i), 1000L + i)); assertTrue(b.offer(mac(i), "d$i", -60, false, 1000L + i)) }
        assertFalse(b.hasPending()); assertTrue(b.flush().isEmpty())
    }
    @Test fun conMuchosCercaSalenEnTandaLosMasCercanosPrimero() {
        val b = ScanBook<String>()
        var sueltos = 0
        for (i in 0 until 300) {
            b.seen(mac(i), false, 1000L + i); assertTrue(b.due(mac(i), 1000L + i))
            if (b.offer(mac(i), "d$i", -90 + (i % 50), false, 1000L + i)) sueltos++
        }
        assertEquals(12, sueltos)                    // los primeros del segundo, sueltos; el resto, a la tanda
        assertTrue(b.hasPending())
        val t = b.flush()
        assertEquals(288, t.size)
        assertEquals("d49", t[0])                    // el de mejor señal (−41) va el primero
        assertFalse(b.hasPending()); assertTrue(b.flush().isEmpty())
    }
    @Test fun mientrasHayTandaEsperandoNadaSeAdelanta() {
        val b = ScanBook<String>()
        for (i in 0 until 20) { b.seen(mac(i), false, 1000); b.due(mac(i), 1000); b.offer(mac(i), "d$i", -70, false, 1000) }
        assertTrue(b.hasPending())
        // un segundo después llega uno solo: como hay tanda esperando, va a ella (no adelanta a los que esperan)
        b.seen(mac(99), false, 2100); assertTrue(b.due(mac(99), 2100)); assertFalse(b.offer(mac(99), "d99", -50, false, 2100))
        assertEquals("d99", b.flush()[0])
        // con la tanda ya entregada y pocos alrededor, vuelve a salir al momento
        b.seen(mac(98), false, 3200); b.due(mac(98), 3200); assertTrue(b.offer(mac(98), "d98", -50, false, 3200))
    }
    @Test fun elContactoConAlgoEsperandoNoEsperaNunca() {
        val b = ScanBook<String>()
        for (i in 0 until 200) { b.seen(mac(i), false, 1000); b.due(mac(i), 1000); b.offer(mac(i), "d$i", -60, false, 1000) }
        b.seen("contacto", false, 1001); assertTrue(b.due("contacto", 1001))
        assertTrue(b.offer("contacto", "c", -92, true, 1001))        // lejos y en plena multitud: sale ya
        assertFalse(b.flush().contains("c"))                          // y no se repite en la tanda
    }
    @Test fun loRecordadoTieneTopeYSeOlvidaLoMenosReciente() {
        val b = ScanBook<String>(cap = 100)
        var gone = emptyList<String>()
        for (i in 0 until 101) { val g = b.seen(mac(i), false, 1000L + i); if (g.isNotEmpty()) gone = g }
        assertEquals(75, b.size())
        assertEquals(26, gone.size)
        assertTrue(gone.contains(mac(0))); assertFalse(b.has(mac(0)))   // el más viejo se fue
        assertTrue(b.has(mac(100)))                                      // el recién oído sigue
        for (i in 0 until 5000) b.seen(mac(1000 + i), i % 2 == 0, 5000L + i)
        assertTrue(b.size() <= 100)
    }
    @Test fun largoAlcanceYNormalPorSeparado() {
        val b = ScanBook<String>()
        b.seen("m1", true, 1000); b.seen("m1", false, 4000)
        assertEquals(1000L, b.seenCoded("m1")); assertEquals(4000L, b.seen1M("m1")); assertEquals(0L, b.seenCoded("otro"))
    }
    @Test fun alVolverABuscarTodoSePuedeAvisarDeNuevo() {
        val b = ScanBook<String>()
        b.seen("m1", false, 1000); assertTrue(b.due("m1", 1000)); assertFalse(b.due("m1", 1100))
        for (i in 0 until 30) { b.seen(mac(i), false, 1000); b.due(mac(i), 1000); b.offer(mac(i), "d$i", -60, false, 1000) }
        b.resetNotify()
        assertFalse(b.hasPending())
        assertTrue(b.due("m1", 1100))                 // sin esperar al segundo
        assertTrue(b.has("m1"))                       // y lo oído no se olvidó (la reconexión lo necesita)
    }
}
