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
 * 3281 (remate de la fase 3): también FOTOS y notas de voz pequeñas (hasta 1 MB). La app las deja como las subiría ella al buzón de
 * archivos: el archivo cifrado UNA vez y partido en trozos, cada trozo ya firmado como evento del relé (Chunk), más el aviso para el
 * contacto (p: el puntero, cifrado de punta a punta). El nativo sube los trozos tal cual (no puede leerlos ni cambiarlos) y SOLO cuando
 * todos tienen al menos un relé que los guardó deja salir el aviso: quien lo reciba siempre encuentra el archivo entero.
 *
 * Esta clase es la lista y sus decisiones, sin Android ni red (se prueba en JVM: NetOutboxTest). Al registro va el msgId y el NEXO ID,
 * nunca el contenido.
 */
class NetOutbox {
    /** p = el paquete ya cifrado para el contacto (va tal cual en el sobre); wake = su token del «toque» (o vacío). */
    class Item(val id: String, val nx: String, val p: String, val addedAt: Long, val wake: String = "") {
        /** 3281: los trozos del archivo que hay que subir ANTES de que salga p (vacío = un texto). */
        var chunks: List<Chunk> = emptyList()
        /** La app dice «ya tienes sus N trozos» sin volver a mandarlos (solo vale si de verdad se tienen). */
        var stub = 0
        /** Hasta cuándo NO se empieza a subir (el margen para que lo termine la app si sigue despierta: FILE_GRACE_MS). */
        var holdUntil = 0L
        fun chunksLeft(): Int = chunks.count { !it.ok }
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

    /** 3281: un trozo de un archivo: el evento del relé ya firmado por la app (se sube tal cual) y su id. */
    class Chunk(val id: String, val ev: String) {
        var ok = false
        var sentAt = 0L
        var tries = 0
    }

    companion object {
        const val MAX_ITEMS = 100
        // 3281: archivos
        const val MAX_CHUNKS = 26               // 1 MB en trozos de 40 KB (como OUT_FILE_MAX_BYTES de la app)
        const val MAX_CHUNK_EV = 70_000         // un evento-trozo entero (40 KB en base64 + firma)
        const val MAX_FILE_ITEMS = 4
        const val CHUNK_KIND = 1064             // BLOB_KIND de la app
        const val CHUNK_WINDOW = 3              // trozos subiéndose a la vez (PUBLISH_PARALLEL de la app)
        const val CHUNK_MAX_TRIES = 10          // un trozo que ningún relé guarda tras 10 intentos: lo manda la app al abrirse
        /**
         * La app entrega el archivo al ocultarse aunque ella misma lo esté subiendo en ese momento (lo normal: mandar una foto y
         * bloquear el teléfono). Si sigue despierta lo termina ella y lo retira de aquí; si Android la durmió, a los 20 s empieza el
         * nativo. Así no se sube dos veces lo que la app iba a terminar sola.
         */
        const val FILE_GRACE_MS = 20_000L
        /** Cuánto esperar la respuesta del relé antes de volver a subir un trozo: 15 s, 30 s, 1 min, 2 min y luego cada 5 min. */
        fun chunkRetryMs(tries: Int): Long = when { tries <= 1 -> 15_000L; tries == 2 -> 30_000L; tries == 3 -> 60_000L; tries == 4 -> 120_000L; else -> 300_000L }
        private val HEX64 = Regex("^[0-9a-f]{64}$")
        private val HEX128 = Regex("^[0-9a-f]{128}$")
        /** El trozo que manda la app (nunca se confía): un evento de relé bien formado, del tipo de los trozos y dentro de los topes. */
        fun chunkOf(ev: String?): Chunk? {
            if (ev == null || ev.length < 100 || ev.length > MAX_CHUNK_EV || !ev.startsWith("{")) return null
            return try {
                val o = JSONObject(ev)
                val id = o.optString("id")
                val content = o.optString("content")
                if (!HEX64.matches(id) || !HEX64.matches(o.optString("pubkey")) || !HEX128.matches(o.optString("sig"))) null
                else if (o.optInt("kind") != CHUNK_KIND || content.isEmpty() || content.length > 60_000 || o.optLong("created_at") <= 0L) null
                else Chunk(id, ev)
            } catch (e: Exception) { null }
        }
        /** Los trozos de un archivo: todos válidos, sin repetidos y dentro del tope; null si algo no cuadra. */
        fun chunksOf(evs: List<String>?): List<Chunk>? {
            if (evs == null || evs.isEmpty() || evs.size > MAX_CHUNKS) return null
            val out = ArrayList<Chunk>()
            for (e in evs) out.add(chunkOf(e) ?: return null)
            return if (out.map { it.id }.toSet().size == out.size) out else null
        }

        /** Tope del paquete: con el sobre, el cifrado y el base64 tiene que entrar en un evento de relé (NetBg.MAX_CONTENT). */
        const val MAX_P = 40000
        const val MAX_AGE_MS = 7 * 86400_000L   // como el buzón de los relés (TTL_MSG): más viejo ya no se guarda allí
        private val NX = Regex("^nx[0-9a-z]{8}$")
        private val ID = Regex("^[A-Za-z0-9_.:-]{4,96}$")
        private val RID_KEY = Regex("^[0-9a-f]{64}$")

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
    /**
     * 3279: la clave de los códigos rotativos de cada contacto con algo pendiente (NEXO ID → hex 64) y lo que dura una época, para
     * reconocerlo en el aire al buscarlo por Bluetooth (OutboxRid). Solo de quien tiene algo en la bandeja.
     */
    private val rid = HashMap<String, String>()
    @Volatile var ridEpochS = 900L; private set
    @Synchronized fun ridKeys(): Map<String, String> { val nxs = items.values.map { it.nx }.toSet(); return rid.filterKeys { it in nxs } }

    @Synchronized fun size() = items.size
    @Synchronized fun ids(): List<String> = items.keys.toList()
    @Synchronized fun get(id: String): Item? = items[id]

    /**
     * La app da la lista ENTERA de lo pendiente (reemplaza a la anterior). Lo que ya estaba conserva su cuenta de intentos (no se vuelve
     * a subir en el acto lo recién subido). Devuelve si cambió algo que haya que guardar.
     */
    @Synchronized fun set(list: List<Item>, myToken: String = "", wakeUrl: String = "", ridKeys: Map<String, String>? = null, epochS: Long = 0L, t: Long = System.currentTimeMillis()): Boolean {
        val next = LinkedHashMap<String, Item>()
        var files = 0
        for (it in list) {
            if (next.size >= MAX_ITEMS) break
            if (!valid(it.id, it.nx, it.p) || next.containsKey(it.id)) continue
            val old = items[it.id]
            val x = if (old != null && old.nx == it.nx) old else it
            // 3281: un archivo. «Ya lo tienes» (stub) solo vale si de verdad se tiene; como mucho MAX_FILE_ITEMS a la vez
            if (x === it && it.stub > 0 && it.chunks.isEmpty()) continue
            if (x.chunks.isNotEmpty()) { if (x.chunks.size > MAX_CHUNKS || files >= MAX_FILE_ITEMS) continue; files++; if (x === it) x.holdUntil = t + FILE_GRACE_MS }
            next[it.id] = x
        }
        val tok = if (myToken.length in 20..4096) myToken else ""
        val url = if (wakeUrl.startsWith("https://") && wakeUrl.length <= 300) wakeUrl else ""
        // 3279: las claves de los códigos (ridKeys null = no se dijo nada: se conservan las de quien sigue en la lista)
        val nxs = next.values.map { it.nx }.toSet()
        val nextRid = (ridKeys ?: rid).filter { (nx, k) -> nx in nxs && RID_KEY.matches(k) }
        val ep = if (epochS > 0) epochS else ridEpochS
        val changed = next.keys.toList() != items.keys.toList() || tok != this.myToken || url != this.wakeUrl || nextRid != ridKeys() || ep != ridEpochS
        items.clear(); items.putAll(next)
        rid.clear(); rid.putAll(nextRid); ridEpochS = ep
        this.myToken = tok; this.wakeUrl = url
        return changed
    }

    /** La app lo retira (lo mandó ella, llegó su ✓✓ o se borró). */
    @Synchronized fun drop(id: String): Boolean = items.remove(id) != null

    @Synchronized fun clear(): Boolean { val had = items.isNotEmpty() || myToken.isNotEmpty(); items.clear(); rid.clear(); myToken = ""; wakeUrl = ""; return had }

    /** Lo que toca subir ahora. De paso tira lo caducado (más de 7 días: el buzón ya no lo guardaría); expired recibe sus ids. */
    @Synchronized fun due(t: Long, expired: ((String) -> Unit)? = null): List<Item> {
        val it = items.values.iterator()
        while (it.hasNext()) { val x = it.next(); if (t - x.addedAt > MAX_AGE_MS) { it.remove(); expired?.invoke(x.id) } }
        return items.values.filter { x -> x.nextAt <= t && x.chunksLeft() == 0 } // 3281: el aviso de un archivo, solo con todos sus trozos subidos
    }

    // ---------- 3281: los trozos de los archivos ----------
    /** Trozos que toca subir ahora (sin respuesta del relé y fuera de plazo), sin pasar de CHUNK_WINDOW en vuelo a la vez. */
    @Synchronized fun chunksDue(t: Long): List<Chunk> {
        var flying = 0
        val out = ArrayList<Chunk>()
        for (x in items.values) for (c in x.chunks) {
            if (c.ok || x.holdUntil > t) continue
            if (c.sentAt > 0L && t - c.sentAt < chunkRetryMs(c.tries)) { flying++; continue }
            if (c.tries < CHUNK_MAX_TRIES) out.add(c)
        }
        return out.take(maxOf(0, CHUNK_WINDOW - flying))
    }
    @Synchronized fun chunkSent(c: Chunk, t: Long) { c.sentAt = t; c.tries++ }
    /** Un relé guardó ese trozo. Devuelve su archivo si es la PRIMERA vez que se guarda ese trozo (para seguir con el siguiente). */
    @Synchronized fun chunkAccepted(evId: String): Item? {
        if (evId.isEmpty()) return null
        for (x in items.values) for (c in x.chunks) if (c.id == evId) { if (c.ok) return null; c.ok = true; if (x.chunksLeft() == 0) x.nextAt = 0L; return x }
        return null
    }
    /** Archivos con un trozo que ningún relé guardó tras todos los intentos: no pueden salir desde aquí (los manda la app al abrirse). */
    @Synchronized fun chunkStuck(t: Long): List<Item> = items.values.filter { x ->
        x.chunks.any { c -> !c.ok && c.tries >= CHUNK_MAX_TRIES && t - c.sentAt >= chunkRetryMs(c.tries) }
    }
    /** Lo que hay que tener guardado aparte (id del mensaje → sus eventos-trozo): son grandes y no van en el archivo de la lista. */
    @Synchronized fun chunkFiles(): Map<String, List<String>> = items.values.filter { it.chunks.isNotEmpty() }.associate { it.id to it.chunks.map { c -> c.ev } }
    /** Para la app: cuántos trozos tiene ese archivo y cuántos están ya en los relés. */
    @Synchronized fun chunkState(id: String): Pair<Int, Int> { val x = items[id] ?: return 0 to 0; return x.chunks.size to (x.chunks.size - x.chunksLeft()) }

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
    // (3281: un archivo que aún está subiendo sus trozos no cuenta para el Bluetooth: por ahí solo iría su aviso, y aún no puede salir)
    @Synchronized fun nxs(): Set<String> = items.values.filter { it.chunksLeft() == 0 }.map { it.nx }.toSet()
    /** 3280: contactos con algo que AÚN no aceptó ningún relé (no está a salvo en el buzón de internet): el Bluetooth es su único camino ahora. */
    @Synchronized fun unsentNxs(): Set<String> = items.values.filter { it.okAt == 0L && it.chunksLeft() == 0 }.map { it.nx }.toSet()
    /** ¿Hay algo pendiente para ese contacto? */
    @Synchronized fun hasFor(nx: String): Boolean = items.values.any { it.nx == nx && it.chunksLeft() == 0 }
    /** Lo que toca escribir ahora por un enlace Bluetooth de ese contacto. */
    @Synchronized fun bleDue(nx: String, t: Long): List<Item> = items.values.filter { it.nx == nx && it.bleNextAt <= t && it.chunksLeft() == 0 }
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
    @Synchronized fun toJson(): String = JSONObject().put("v", 1).put("f", myToken).put("url", wakeUrl).put("rk", JSONObject(ridKeys())).put("ep", ridEpochS)
        .put("items", JSONArray(items.values.map { x ->
            JSONObject().put("id", x.id).put("nx", x.nx).put("p", x.p).put("at", x.addedAt).put("wk", x.wake).put("ok", x.okAt).also { o ->
                // 3281: de un archivo, aquí solo qué trozos tiene y cuáles están ya subidos (los trozos en sí se guardan aparte: chunkFiles)
                if (x.chunks.isNotEmpty()) o.put("ck", JSONArray(x.chunks.map { c -> JSONArray().put(c.id).put(if (c.ok) 1 else 0) }))
            }
        })).toString()

    /** Lo guardado (al arrancar sin la app). Lo que no cuadra se salta; lo aceptado antes por un relé no se vuelve a subir en el acto. */
    @Synchronized fun load(text: String?, t: Long, chunkLoader: ((String) -> List<String>?)? = null): Int {
        items.clear(); rid.clear(); myToken = ""; wakeUrl = ""
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
                    // 3281: un archivo: sus trozos se leen de donde se guardaron; si faltan o no cuadran con lo apuntado, no se carga
                    // (lo manda la app al abrirse: nunca sale un aviso de un archivo que no se puede terminar de subir)
                    val ck = x.optJSONArray("ck")
                    if (ck != null && ck.length() > 0) {
                        val chunks = chunksOf(try { chunkLoader?.invoke(it.id) } catch (e: Exception) { null }) ?: continue
                        if (chunks.size != ck.length()) continue
                        var same = true
                        for (k in chunks.indices) { val c = ck.optJSONArray(k); if (c == null || c.optString(0) != chunks[k].id) { same = false; break }; chunks[k].ok = c.optInt(1) == 1 }
                        if (!same) continue
                        it.chunks = chunks
                    }
                    list.add(it)
                }
            }
            val keys = HashMap<String, String>()
            o.optJSONObject("rk")?.let { r -> r.keys().forEach { nx -> keys[nx.lowercase()] = r.optString(nx) } }
            set(list, o.optString("f"), o.optString("url"), keys, o.optLong("ep", 900L), t)
            items.values.forEach { it.holdUntil = 0L } // sin la app no hay a quién esperar: los trozos que falten salen ya
        } catch (e: Exception) { items.clear(); rid.clear() }
        return items.size
    }
}
