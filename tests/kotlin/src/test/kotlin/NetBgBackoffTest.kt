import com.nexo.ble.NetBg
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// 3069 (diagnóstico automático del Motorola 13-11 14:42): con la app en segundo plano, relay.damus.io abría y se cerraba a los
// pocos segundos, una y otra vez, y el nativo volvía a abrirlo a los ~10 s durante casi una hora (abrir ponía los fallos a cero).
class NetBgBackoffTest {
    // Simula N vueltas «abre, el relé la corta a los `lived` ms»: devuelve las esperas hasta el siguiente intento
    private fun waits(n: Int, lived: Long): List<Long> {
        var fails = 0
        val out = ArrayList<Long>()
        repeat(n) { fails = NetBg.failsAfterClose(fails, lived); out.add(NetBg.retryDelayMs(fails)) }
        return out
    }

    @Test fun releQueSeCaeEnseguidaEspaciaLosIntentos() {
        val w = waits(8, 15_000L)
        // antes: 10 s siempre; ahora crece hasta 5 min
        assertEquals(listOf(10_000L, 20_000L, 40_000L, 80_000L, 160_000L, 300_000L, 300_000L, 300_000L), w)
        // en una hora: antes ~144 reconexiones (cada ~25 s); ahora como mucho ~15
        var t = 0L; var n = 0; var fails = 0
        while (t < 3_600_000L) { fails = NetBg.failsAfterClose(fails, 15_000L); t += 15_000L + NetBg.retryDelayMs(fails); n++ }
        assertTrue(n <= 16, "reconexiones en 1 h: $n")
    }

    @Test fun releEstableNoSeCastiga() {
        // Una conexión que duró ≥ 1 min y luego se cayó: se vuelve a intentar pronto (10 s), sin arrastrar fallos viejos
        var fails = 5
        fails = NetBg.failsAfterClose(fails, 120_000L)
        assertEquals(1, fails)
        assertEquals(10_000L, NetBg.retryDelayMs(fails))
    }

    @Test fun sinRedNoLlegaAAbrir() {
        // Si ni siquiera abre (sin red), también crece la espera
        assertEquals(listOf(10_000L, 20_000L, 40_000L), waits(3, 0L))
    }
}
