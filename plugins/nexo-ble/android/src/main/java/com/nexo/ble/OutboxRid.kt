package com.nexo.ble

/**
 * 3279 (remate de la FASE 3, «el nativo abre el enlace», 3271): reconocer en el aire al contacto que tiene algo pendiente.
 *
 * Lo que fallaba: la bandeja de salida busca a su contacto escaneando, y lo comparaba con su NEXO ID. Pero un teléfono con contactos
 * NO anuncia su NEXO ID: anuncia un código que cambia cada 15 min (RidToken; el NEXO ID solo sale con «Agregar» abierto o sin
 * contactos). El escaneo veía «R…», la bandeja esperaba «nx…» y nunca conectaba: en teléfonos reales el nativo no abría el enlace
 * (en la simulación sí, porque el modelo comparaba el NEXO ID; ya compara lo anunciado).
 *
 * Ahora la app deja, con la bandeja, la clave de los códigos de cada contacto con algo pendiente (la misma que ya usa ella para
 * reconocerlos: SHA-256 de su clave PÚBLICA; no es un secreto del chat) y aquí se calcula su código de la época anterior, la actual y
 * la siguiente (relojes algo desfasados). Se guarda con la bandeja, cifrada en reposo, y se borra cuando ya no hay nada para él.
 *
 * Sin Android (JVM: OutboxRidTest). La usan el plugin (app dormida o cerrada) y BleSinApp (sin la app).
 */
class OutboxRid(private val now: () -> Long = { System.currentTimeMillis() }) {
    companion object {
        private val NX = Regex("^nx[0-9a-z]{8}$")
        private val TOKEN = Regex("^r[a-z2-7]{9}$")
        private val KEY = Regex("^[0-9a-f]{64}$")
    }

    private var sig = ""
    private var epoch = Long.MIN_VALUE
    private var byToken: Map<String, String> = emptyMap()

    /**
     * De lo anunciado (NEXO ID o código rotativo) al NEXO ID del contacto. keys = NEXO ID → clave de sus códigos (hex 64).
     * null = no es de ninguno de ellos (o un anuncio que no es de NEXO).
     */
    @Synchronized fun resolve(advertised: String, keys: Map<String, String>, epochS: Long): String? {
        val adv = advertised.trim().lowercase()
        if (NX.matches(adv)) return adv
        if (!TOKEN.matches(adv) || keys.isEmpty()) return null
        val ep = if (epochS > 0) epochS else 900L
        val e = RidToken.epoch(now(), ep)
        val s = keys.entries.sortedBy { it.key }.joinToString(",") { it.key + ":" + it.value } + "|" + ep
        if (e != epoch || s != sig) {
            val m = HashMap<String, String>()
            for ((nx, key) in keys) {
                if (!NX.matches(nx) || !KEY.matches(key)) continue
                for (d in -1L..1L) try { m[RidToken.token(key, e + d).lowercase()] = nx } catch (ex: Exception) { }
            }
            byToken = m; epoch = e; sig = s
        }
        return byToken[adv]
    }
}
