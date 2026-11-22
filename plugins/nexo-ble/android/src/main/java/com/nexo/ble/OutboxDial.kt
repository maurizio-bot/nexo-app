package com.nexo.ble

/**
 * 3271 (PRIORIDAD 1 del dueño, FASE 3: «conexiones salientes desde el servicio»; COLA 29): la bandeja de salida ABRE ella el enlace.
 *
 * Con 3269 el nativo escribe lo pendiente por un enlace que ya había o que abre el OTRO teléfono. Pero si los DOS tienen la app dormida
 * (lo normal: dos teléfonos en el bolsillo, en el metro, sin internet), ninguno abre nada: los dos anuncian y nadie conecta. Ahora,
 * mientras haya algo pendiente para un contacto sin enlace, el nativo lo BUSCA (escaneo corto y filtrado: solo anuncios de NEXO, que es
 * lo único que Android entrega con la pantalla apagada) y, si lo ve, CONECTA; al quedar listo el enlace, la bandeja escribe por él.
 *
 * Aquí, sin Android, el plan (JVM: OutboxDialTest): cuándo escanear (enseguida y luego cada vez más espaciado: la batería manda cuando
 * el otro no está), a quién conectar (visto hace poco, sin intento reciente) y el tope de enlaces de cliente abiertos por el nativo.
 */
class OutboxDial(private val now: () -> Long = { System.currentTimeMillis() }) {
    companion object {
        const val SCAN_MS = 4_000L          // lo que dura cada escaneo
        const val FIRST_MS = 3_000L         // el primero, a los 3 s de haber algo que buscar (la app aún puede estar despierta)
        const val SEEN_FRESH_MS = 60_000L   // un anuncio de hace más de 1 min ya no dice que esté cerca
        const val RETRY_MAC_MS = 30_000L    // no se insiste en la misma dirección antes de 30 s
        const val MAX_CLIENT_LINKS = 7      // Android atiende ~7 enlaces: no se abre otro por encima de eso
        /** Espera entre escaneos: 20 s, 40 s, 80 s, 160 s y luego cada 5 min (n = escaneos ya hechos para lo que se busca ahora). */
        fun gapMs(n: Int): Long = minOf(300_000L, 20_000L * (1L shl minOf(maxOf(n - 1, 0), 4)))
    }

    private var sig = ""
    private var scans = 0
    private var nextAt = 0L
    private val tried = HashMap<String, Long>()

    /** want = contactos con algo pendiente y sin enlace listo. ¿Toca escanear ahora? (si devuelve true, se da por empezado) */
    @Synchronized fun scanDue(want: Set<String>): Boolean {
        if (want.isEmpty()) { sig = ""; scans = 0; nextAt = 0L; return false }
        val t = now()
        val s = want.sorted().joinToString(",")
        if (s != sig) { sig = s; scans = 0; nextAt = t + FIRST_MS } // a alguien nuevo se le busca enseguida
        if (t < nextAt) return false
        scans++
        nextAt = t + SCAN_MS + gapMs(scans)
        return true
    }

    /**
     * De lo visto en el aire (NEXO ID → dirección y cuándo), a quién conectar ahora: (NEXO ID, dirección). Solo quien tiene algo
     * pendiente, visto hace poco, sin enlace ni conexión en curso a esa dirección (busy), sin intento reciente y mientras haya sitio.
     */
    @Synchronized fun pick(want: Set<String>, seen: Map<String, Pair<String, Long>>, clientLinks: Int, busy: (String) -> Boolean): List<Pair<String, String>> {
        val t = now()
        val out = ArrayList<Pair<String, String>>()
        var links = clientLinks
        for (nx in want.sorted()) {
            if (links >= MAX_CLIENT_LINKS) break
            val (mac, at) = seen[nx] ?: continue
            if (t - at > SEEN_FRESH_MS || busy(mac)) continue
            if (t - (tried[mac] ?: 0L) < RETRY_MAC_MS) continue
            tried[mac] = t
            if (tried.size > 200) tried.clear()
            out.add(nx to mac); links++
        }
        return out
    }
}
