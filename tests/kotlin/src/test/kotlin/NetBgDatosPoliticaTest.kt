import com.nexo.ble.NetBg
import com.nexo.ble.NetBg.RelayView
import kotlin.test.*

/**
 * 3204 (dueño 17-11 «Ok» a 2 conexiones y 2 copias con datos móviles; parte nativa de la 3193): qué relés escucha NetBg (con la app en
 * segundo plano o sin la app) según la red y los caídos, sin red de verdad. tryOpen = «conectar ya» (true si abre). Lo mismo que la app
 * (net_relays.js _cellReaders): con datos, los 2 primeros sanos en el orden de la lista; con Wi-Fi, todos.
 */
class NetBgDatosPoliticaTest {
    private val open = RelayView(open = true, due = false)
    private val idle = RelayView(open = false, due = true)    // sin conexión, se puede intentar ya (p. ej. soltado o recién configurado)
    private val waiting = RelayView(open = false, due = false) // caído: espera su reintento

    private fun plan(cell: Boolean, rs: List<RelayView>, opens: Set<Int> = rs.indices.toSet()): Triple<List<Int>, List<Int>, List<Int>> {
        val tried = ArrayList<Int>()
        val p = NetBg.listenPlan(cell, rs, { i -> tried.add(i); i in opens })
        return Triple(p.listen, p.park, tried)
    }

    @Test fun conWifiEscuchaTodos() {
        val (listen, park, tried) = plan(false, listOf(open, idle, open, idle))
        assertEquals(listOf(0, 1, 2, 3), listen); assertEquals(emptyList(), park); assertEquals(listOf(1, 3), tried)
        // un caído sigue esperando su reintento, como siempre
        val (l2, p2, t2) = plan(false, listOf(waiting, open, open, open))
        assertEquals(listOf(1, 2, 3), l2); assertEquals(emptyList(), p2); assertEquals(emptyList(), t2)
    }

    @Test fun conDatosSoloLosDosPrimeros() {
        // los 4 abiertos (venía del Wi-Fi): se escuchan los 2 primeros y se sueltan los otros
        val (listen, park, tried) = plan(true, listOf(open, open, open, open))
        assertEquals(listOf(0, 1), listen); assertEquals(listOf(2, 3), park); assertEquals(emptyList(), tried)
        // arranque con datos: solo se intenta abrir los 2 primeros; los otros ni se abren
        val (l2, p2, t2) = plan(true, listOf(idle, idle, idle, idle))
        assertEquals(listOf(0, 1), l2); assertEquals(listOf(2, 3), p2); assertEquals(listOf(0, 1), t2)
    }

    @Test fun conDatosSaltaLosCaidos() {
        // el primero espera su reintento: se escucha el 2.º y el 3.º
        val (listen, park, tried) = plan(true, listOf(waiting, open, idle, idle))
        assertEquals(listOf(1, 2), listen); assertEquals(listOf(3), park); assertEquals(listOf(2), tried)
        // el primero se puede intentar pero no abre: cuenta como caído y entra el 3.º
        val (l2, p2, t2) = plan(true, listOf(idle, open, idle, idle), opens = setOf(2, 3))
        assertEquals(listOf(1, 2), l2); assertEquals(listOf(3), p2); assertEquals(listOf(0, 2), t2)
        // los dos primeros caídos: el 3.º y el 4.º
        val (l3, p3, _) = plan(true, listOf(waiting, waiting, idle, idle))
        assertEquals(listOf(2, 3), l3); assertEquals(emptyList(), p3)
        // ninguno abre: ninguno se escucha (y no se suelta nada: se siguen intentando)
        val (l4, p4, t4) = plan(true, listOf(idle, waiting, idle, idle), opens = emptySet())
        assertEquals(emptyList(), l4); assertEquals(emptyList(), p4); assertEquals(listOf(0, 2, 3), t4)
        // solo uno sano: ese
        val (l5, _, _) = plan(true, listOf(waiting, waiting, waiting, open))
        assertEquals(listOf(3), l5)
    }

    @Test fun conDatosVuelveAlPreferido() {
        // el 1.º se cayó y lo reemplazó el 3.º; pasó su espera y vuelve a abrir: se escucha otra vez el 1.º y se suelta el 3.º
        val (listen, park, tried) = plan(true, listOf(idle, open, open, RelayView(false, false)))
        assertEquals(listOf(0, 1), listen); assertEquals(listOf(2, 3), park); assertEquals(listOf(0), tried)
    }

    @Test fun tipoDeRed() {
        assertTrue(NetBg.cellAfter(false, "cell"))
        for (t in listOf("wifi", "eth", "vpn", "other")) { assertFalse(NetBg.cellAfter(true, t), t); assertFalse(NetBg.cellAfter(false, t), t) }
        // sin red o sin saberlo: lo que había
        assertTrue(NetBg.cellAfter(true, "none")); assertFalse(NetBg.cellAfter(false, "none"))
        assertTrue(NetBg.cellAfter(true, "")); assertFalse(NetBg.cellAfter(false, ""))
        // la NetBg: sin aviso, como siempre (todos); con aviso, lo que diga la red
        val bg = NetBg({ _, _, _, _, _, _ -> })
        assertFalse(bg.cellMode())
        bg.setNet("cell"); assertTrue(bg.cellMode())
        bg.setNet("none"); assertTrue(bg.cellMode(), "un túnel sin cobertura no vuelve a abrir todos")
        bg.setNet("wifi"); assertFalse(bg.cellMode())
    }

    @Test fun desdeCuandoPedirAlVolverAlWifi() {
        val now = 1_800_000_000_000L
        val since = now - 60_000L
        assertEquals(since, NetBg.subSince(since, -1L, false, now), "nada pendiente: el since común")
        assertEquals(now - 3_600_000L, NetBg.subSince(since, now - 3_600_000L, false, now), "con Wi-Fi: desde que se soltó")
        assertEquals(since, NetBg.subSince(since, now - 3_600_000L, true, now), "con datos lo pendiente espera al Wi-Fi")
        assertEquals(since, NetBg.subSince(since, now - 10_000L, false, now), "nunca más tarde que el since común")
        assertEquals(now - NetBg.TTL_MSG_MS, NetBg.subSince(since, now - 30L * 86_400_000L, false, now), "no más atrás de lo que dura un mensaje")
        assertEquals("relay.damus.io", NetBg.host("wss://relay.damus.io/"))
        assertEquals("127.0.0.1:4567", NetBg.host("ws://127.0.0.1:4567"))
    }
}
