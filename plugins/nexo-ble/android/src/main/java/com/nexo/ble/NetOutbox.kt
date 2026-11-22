package com.nexo.ble

import org.json.JSONArray
import org.json.JSONObject

/**
 * 3268 (PRIORIDAD 1 del dueño, «Bluetooth entero en el servicio nativo», FASE 3; COLA 29): BANDEJA DE SALIDA nativa.
 *
 * Lo que fallaba (diagnósticos «pendiente_viejo» del 20 y 21-11): un mensaje que se quedó ⏳ porque en ese momento no había camino (sin
 * señal, relés reconectando) no salía hasta que el usuario volvía a ABRIR NEXO. Reenviar era cosa de la app (la página), y Android la
 * duerme a los pocos segundos de bloquear el teléfono, o la cierra. El servicio nativo seguía vivo y con internet, pero no sabía qué
 * había pendiente.
 *
 * Ahora la app le entrega al nativo los TEXTOS pendientes ya cifrados de punta a punta (el mismo paquete que ella subiría al buzón de
 * los relés: el nativo no ve el contenido ni tiene las claves del mensaje) y la escucha de internet (NetBg) los sube en cuanto hay un
 * relé abierto: con la app dormida, cerrada o sin la app (quedan guardados cifrados en reposo: nexo_netbg_out.json). Insiste hasta que
 * llega la ✓✓ del otro (su confirmación entra por la misma escucha) o la app lo retira (lo mandó ella, se borró).
 * Un repetido no hace daño: el que recibe descarta por msgId y vuelve a confirmar.
 *
 * Esta clase es la lista y sus decisiones, sin Android ni red (se prueba en JVM: NetOutboxTest). Al registro va el msgId y el NEXO ID,
 * nunca el contenido.
 */
class NetOutbox {
    /** p = el paquete ya cifrado para el contacto (va tal cual en el sobre); wake = su token del «toque» (o vacío). */
    class Item(val id: String, val nx: String, val p: String, val addedAt: Long, val wake: String = "") {
        var tries = 0
        var nextAt = 0L
        /** Cuándo lo aceptó un relé (0 = aún no): desde ahí está a salvo en el buzón y solo se insiste de tarde en tarde. */
        var okAt = 0L
        var evId = ""
        var woke = false
        /** 3269: por Bluetooth (aparte de internet): cuántas veces se escribió por un enlace y cuándo toca otra vez. */
        var bleTries = 0
        var bleNextAt = 0L
    }

    companion object {
        const val MAX_ITEMS = 100
        /** Tope del paquete: con el sobre, el cifrado y el base64 tiene que entrar en un evento de relé (NetBg.MAX_CONTENT). */
        const val MAX_P = 40000
        const val MAX_AGE_MS = 7 * 86400_000L   // como el buzón de los relés (TTL_MSG): más viejo ya no se guarda allí
        private val NX = Regex("^nx[0-9a-z]{8}$")
        private val ID = Regex("^[A-Za-z0-9_.:-]{4,96}$")

        /**
         * Cuánto esperar para volver a subirlo. Sin aceptar por ningún relé: 20 s, 40 s… hasta 5 min. Aceptado (a salvo en el buzón) pero
         * sin ✓✓: a los 15 min, a la hora y luego cada 6 h (por si el relé lo perdió; el otro descarta el repetido).
         */
        fun retryMs(tries: Int, accepted: Boolean): Long = if (accepted) when {
            tries <= 1 -> 15 * 60_000L
            tries == 2 -> 60 * 60_000L
            else -> 6 * 3600_000L
        } else minOf(300_000L, 20_000L * (1L shl minOf(maxOf(tries - 1, 0), 4)))

        /**
         * 3269: cuánto esperar para volver a escribirlo por Bluetooth si no llega su ✓✓ por ese enlace: 8 s, 16 s, 32 s, 1 min, 2 min y
         * luego cada 5 min (el enlace puede estar a medias; no se martilla).
         */
        fun bleRetryMs(tries: Int): Long = when {
            tries <= 1 -> 8_000L
            tries == 2 -> 16_000L
            tries == 3 -> 32_000L
            tries == 4 -> 60_000L
            tries == 5 -> 120_000L
            else -> 300_000L
        }

        /**
         * 3269: de quién es el enlace por el que llegó este mensaje corto (ping del vigilante: fromNexoId; «quién soy» o confirmación:
         * from). Es lo mismo que cree la app al identificar un enlace; lo que se manda por él ya va cifrado para su destinatario.
         */
        fun linkNxOf(json: String): String? {
            if (json.length > 6000 || !json.startsWith("{")) return null
            return try {
                val o = JSONObject(json)
                val nx = when (o.optString("type")) {
                    "ping", "pong" -> o.optString("fromNexoId")
                    "kx", "ack", "read_receipt" -> o.optString("from")
                    else -> ""
                }.trim().lowercase()
                if (NX.matches(nx)) nx else null
            } catch (e: Exception) { null }
        }

        /** ¿Vale como elemento de la bandeja? (lo que manda la app o lo leído del disco: nunca se confía) */
        fun valid(id: String, nx: String, p: String): Boolean = ID.matches(id) && NX.matches(nx) && p.isNotEmpty() && p.length <= MAX_P

        /** msgId que confirma este paquete si es una confirmación de entrega o de lectura (✓✓); null si es otra cosa. */
        fun receiptOf(p: String): String? {
            if (p.length > 2000 || !p.startsWith("{") || !p.contains("\"msgId\"")) return null
            return try {
                val o = JSONObject(p)
                val type = o.optString("type")
                if (type == "ack" || type == "read_receipt") o.optString("msgId").takeIf { it.isNotEmpty() } else null
            } catch (e: Exception) { null }
        }
    }

    private val items = LinkedHashMap<String, Item>()
    /** Mi token del «toque» (va en el sobre de un mensaje nuevo, como hace la app) y la dirección del enviador de toques. */
    @Volatile var myToken = ""; private set
    @Volatile var wakeUrl = ""; private set

    @Synchronized fun size() = items.size
    @Synchronized fun ids(): List<String> = items.keys.toList()
    @Synchronized fun get(id: String): Item? = items[id]

    /**
     * La app da la lista ENTERA de lo pendiente (reemplaza a la anterior). Lo que ya estaba conserva su cuenta de intentos (no se vuelve
     * a subir en el acto lo recién subido). Devuelve si cambió algo que haya que guardar.
     */
    @Synchronized fun set(list: List<Item>, myToken: String = "", wakeUrl: String = ""): Boolean {
        val next = LinkedHashMap<String, Item>()
        for (it in list) {
            if (next.size >= MAX_ITEMS) break
            if (!valid(it.id, it.nx, it.p) || next.containsKey(it.id)) continue
            val old = items[it.id]
            next[it.id] = if (old != null && old.nx == it.nx) old else it
        }
        val tok = if (myToken.length in 20..4096) myToken else ""
        val url = if (wakeUrl.startsWith("https://") && wakeUrl.length <= 300) wakeUrl else ""
        val changed = next.keys.toList() != items.keys.toList() || tok != this.myToken || url != this.wakeUrl
        items.clear(); items.putAll(next)
        this.myToken = tok; this.wakeUrl = url
        return changed
    }

    /** La app lo retira (lo mandó ella, llegó su ✓✓ o se borró). */
    @Synchronized fun drop(id: String): Boolean = items.remove(id) != null

    @Synchronized fun clear(): Boolean { val had = items.isNotEmpty() || myToken.isNotEmpty(); items.clear(); myToken = ""; wakeUrl = ""; return had }

    /** Lo que toca subir ahora. De paso tira lo caducado (más de 7 días: el buzón ya no lo guardaría); expired recibe sus ids. */
    @Synchronized fun due(t: Long, expired: ((String) -> Unit)? = null): List<Item> {
        val it = items.values.iterator()
        while (it.hasNext()) { val x = it.next(); if (t - x.addedAt > MAX_AGE_MS) { it.remove(); expired?.invoke(x.id) } }
        return items.values.filter { x -> x.nextAt <= t }
    }

    /** Se subió a los relés abiertos (aún sin saber si lo aceptaron). */
    @Synchronized fun published(id: String, evId: String, t: Long) {
        val x = items[id] ?: return
        x.tries++
        x.evId = evId
        x.nextAt = t + retryMs(x.tries, x.okAt > 0)
    }

    /** Un relé aceptó el evento evId. Devuelve el elemento si es la PRIMERA vez que un relé lo acepta (para el toque y el registro). */
    @Synchronized fun accepted(evId: String, t: Long): Item? {
        if (evId.isEmpty()) return null
        val x = items.values.firstOrNull { it.evId == evId } ?: return null
        if (x.okAt > 0) return null
        x.okAt = t
        x.nextAt = t + retryMs(1, true)
        return x
    }

    /** Llegó la confirmación (✓✓ o leído) de ese contacto para ese mensaje: fuera. */
    @Synchronized fun confirmed(nx: String, msgId: String): Boolean {
        val x = items[msgId] ?: return false
        if (x.nx != nx.lowercase()) return false
        items.remove(msgId)
        return true
    }

    // ---------- 3269: por Bluetooth ----------
    @Synchronized fun nxs(): Set<String> = items.values.map { it.nx }.toSet()
    /** ¿Hay algo pendiente para ese contacto? */
    @Synchronized fun hasFor(nx: String): Boolean = items.values.any { it.nx == nx }
    /** Lo que toca escribir ahora por un enlace Bluetooth de ese contacto. */
    @Synchronized fun bleDue(nx: String, t: Long): List<Item> = items.values.filter { it.nx == nx && it.bleNextAt <= t }
    /** Se escribió por Bluetooth (aún sin su ✓✓). */
    @Synchronized fun bleSent(id: String, t: Long) {
        val x = items[id] ?: return
        x.bleTries++
        x.bleNextAt = t + bleRetryMs(x.bleTries)
    }
    /** El enlace con ese contacto se rehízo: lo suyo puede salir ya por el nuevo (sin esperar el plazo del anterior). */
    @Synchronized fun bleFresh(nx: String) { items.values.forEach { if (it.nx == nx) it.bleNextAt = 0L } }

    /** ¿Puede mandarse ya el toque a ese contacto? (uno por mensaje y, por contacto, como mucho cada 8 s: igual que la app) */
    private val wokeAt = HashMap<String, Long>()
    @Synchronized fun wakeDue(x: Item, t: Long): Boolean {
        if (x.woke || x.wake.isEmpty() || wakeUrl.isEmpty()) return false
        x.woke = true
        if (t - (wokeAt[x.nx] ?: 0L) < 8000L) return false
        wokeAt[x.nx] = t
        return true
    }

    // ---------- en disco (el texto que se cifra en reposo) ----------
    @Synchronized fun toJson(): String = JSONObject().put("v", 1).put("f", myToken).put("url", wakeUrl)
        .put("items", JSONArray(items.values.map { JSONObject().put("id", it.id).put("nx", it.nx).put("p", it.p).put("at", it.addedAt).put("wk", it.wake).put("ok", it.okAt) })).toString()

    /** Lo guardado (al arrancar sin la app). Lo que no cuadra se salta; lo aceptado antes por un relé no se vuelve a subir en el acto. */
    @Synchronized fun load(text: String?, t: Long): Int {
        items.clear(); myToken = ""; wakeUrl = ""
        if (text.isNullOrEmpty()) return 0
        try {
            val o = JSONObject(text)
            val list = ArrayList<Item>()
            o.optJSONArray("items")?.let { a ->
                for (i in 0 until a.length()) {
                    val x = a.optJSONObject(i) ?: continue
                    val it = Item(x.optString("id"), x.optString("nx").lowercase(), x.optString("p"), x.optLong("at", t), x.optString("wk"))
                    val ok = x.optLong("ok", 0L)
                    if (ok > 0) { it.okAt = ok; it.tries = 1; it.woke = true; it.nextAt = maxOf(t, ok + retryMs(1, true)) }
                    list.add(it)
                }
            }
            set(list, o.optString("f"), o.optString("url"))
        } catch (e: Exception) { items.clear() }
        return items.size
    }
}
