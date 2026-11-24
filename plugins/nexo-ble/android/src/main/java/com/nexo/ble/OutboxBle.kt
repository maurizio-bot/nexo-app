package com.nexo.ble

import org.json.JSONObject

/**
 * 3269 (PRIORIDAD 1 del dueño, «Bluetooth entero en el servicio nativo», FASE 3; COLA 29): la BANDEJA DE SALIDA también por Bluetooth.
 *
 * La bandeja (NetOutbox) sube por internet lo que la app dejó pendiente. Pero NEXO es no quedarse sin camino: sin internet (el metro,
 * una multitud) el otro puede aparecer por Bluetooth cuando la app ya está dormida o cerrada. Entonces lo pendiente para él sale por
 * ese enlace, escrito por el nativo: es el MISMO paquete que mandaría la app (ya cifrado de punta a punta) y el otro lo confirma igual.
 *
 * De quién es cada enlace: lo que dijo la app al ocultarse (sus enlaces listos) y lo que el propio enlace dice después (el ping del
 * vigilante o el «quién soy» del otro traen su NEXO ID), igual que lo identifica la app. La confirmación (✓✓) que llega por Bluetooth
 * solo retira el mensaje si viene firmada con la clave de la pareja (si no, se sigue insistiendo y decide la app al volver).
 *
 * Sin Android (JVM: OutboxBleTest). La usan el plugin (app dormida o cerrada con el proceso vivo) y BleSinApp (sin la app).
 *
 * 3315 (COLA 1, puente nativo con la app dormida; dueño 13-11 «cualquier NEXO, esté dormido o no, tiene que servir de puente»): un paquete
 * Jump para OTRO teléfono ('to' ≠ yo) que llega con la app dormida o cerrada se quedaba aquí: nadie lo reenviaba, el que lo mandó reintentaba
 * ×8 y quedaba ⏳ (vivo nx09acdb61, 14-11). Ahora el nativo lo REENVÍA tal cual (ya va cifrado para el destino; solo sube 'hp') por el enlace
 * de ese destino si lo tiene, y si aún no, lo guarda unos minutos y sale en cuanto ese enlace hable. La ✓✓ del destino de vuelta al que lo
 * mandó viaja igual. SIN custodia ('rk'): el que lo mandó conserva su copia y sus otros caminos (internet, otro puente) hasta la ✓✓ de punta a
 * punta; en el peor caso queda como antes, nunca peor. Con poca batería no reenvía mensajes (la misma regla que el puente de la app).
 */
class OutboxBle(
    private val me: () -> String,
    private val bg: () -> NetBg?,
    private val keyOf: (String) -> ByteArray?,
    private val link: Link,
    /** 3315: ¿hay batería para hacer de puente? (como canRelay de la app: cargando, ≥ 15 % o ≥ 30 % en ahorro) */
    private val relayOk: () -> Boolean = { true },
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    interface Link {
        /** ¿Se puede escribir ya por ese enlace? (conectado y, si es entrante, suscrito) */
        fun ready(mac: String): Boolean
        /** Escribe el paquete por ese enlace (lo parte según su MTU). false = cola llena: más tarde. */
        fun send(mac: String, json: String): Boolean
        fun log(msg: String)
    }

    companion object {
        const val MAX_LINKS = 64
        // 3315: el puente nativo (Jump con la app dormida)
        const val RELAY_MAX_HOPS = 8            // MAX_HOPS de la app
        const val RELAY_HOLD_MS = 10 * 60_000L  // sin enlace con el destino: se guarda 10 min (luego decide el que lo mandó, que lo sigue teniendo)
        const val RELAY_HOLD_MAX = 32
        const val RELAY_AGAIN_MS = 30_000L      // el que lo mandó lo repite (no tiene custodia): reenviarlo otra vez solo pasados 30 s
        private val RELAY_TYPES = setOf("chat", "sx", "ack", "read_receipt")
        private val RELAY_ID = Regex("^[A-Za-z0-9_.:-]{4,96}$")
        /** Tope de lo que el puente sostiene de un mismo enlace a la vez (que uno solo no llene lo guardado). */
        const val RELAY_HOLD_PER_LINK = 8
        const val RQ_PER_LINK_MIN = 30          // como la app: búsquedas por minuto que se atienden de un mismo enlace
        /** 3315 (paso 2): una búsqueda 'rq' bien formada: (id, quién busca, a quién) o null. */
        fun rqOf(json: String): Triple<String, String, String>? = try {
            val o = JSONObject(json)
            val id = o.optString("id"); val from = o.optString("from").trim().lowercase(); val dst = o.optString("dst").trim().lowercase()
            val nx = Regex("^nx[0-9a-z]{8}$")
            if (o.optString("type") != "rq" || id.isEmpty() || id.length > 96 || !nx.matches(from) || !nx.matches(dst)) null else Triple(id, from, dst)
        } catch (e: Exception) { null }
        /**
         * 3315: ¿es un paquete Jump para otro teléfono que el nativo puede reenviar? (destino, clave para no repetir, el paquete con 'hp'+1, ¿es
         * un mensaje? —para la regla de batería—) o null. Nunca se confía en lo que llega: tipos, ids, destino y saltos se comprueban.
         */
        fun relayOf(json: String, me: String): Relay? {
            if (json.length > 6000 || !json.startsWith("{") || !json.contains("\"to\"")) return null
            return try {
                val o = JSONObject(json)
                val type = o.optString("type")
                val to = o.optString("to").trim().lowercase()
                val id = o.optString("msgId")
                val my = me.trim().lowercase()
                if (type !in RELAY_TYPES || my.isEmpty() || to == my || !Regex("^nx[0-9a-z]{8}$").matches(to) || !RELAY_ID.matches(id)) return null
                val hp = maxOf(0, o.optInt("hp", 0)) + 1
                if (hp > RELAY_MAX_HOPS) return null
                o.put("hp", hp)
                // primer salto de un mensaje no sellado: el enlace es de quien lo escribió (para devolverle su ✓✓ por aquí)
                val origin = if (hp == 1 && type != "sx") (o.optString("from").ifEmpty { o.optString("fromNexoId") }).trim().lowercase() else ""
                Relay(to, "$type:$id:$to", o.toString(), type == "chat" || type == "sx", hp, if (origin != my && Regex("^nx[0-9a-z]{8}$").matches(origin)) origin else "")
            } catch (e: Exception) { null }
        }
        const val CHALLENGE_RETRY_MS = 4000L
        private val rnd = java.security.SecureRandom()
        fun randomHex(bytes: Int): String { val b = ByteArray(bytes); rnd.nextBytes(b); return b.joinToString("") { "%02x".format(it) } }
        /** 3A: ¿la respuesta al reto es del contacto? (firma de la pareja de «or|reto|él|yo») */
        fun answerValid(json: String, n: String, nx: String, me: String, key: ByteArray?): Boolean {
            if (key == null) return false
            return try {
                val o = JSONObject(json)
                if (o.optString("type") != "or" || o.optString("n") != n || o.optString("from").trim().lowercase() != nx) return false
                val exp = NetBg.ackMac(key, "or|$n|$nx|${me.lowercase()}")
                java.security.MessageDigest.isEqual(exp.toByteArray(Charsets.UTF_8), o.optString("a").toByteArray(Charsets.UTF_8))
            } catch (e: Exception) { false }
        }
        /**
         * La confirmación (✓✓ o leído) que llegó por Bluetooth, si vale para retirar el mensaje: (quién confirma, msgId). Solo con la
         * firma de la pareja (la misma regla que la app con un contacto moderno: «type|msgId|quien confirma|yo»).
         */
        fun signedReceipt(json: String, me: String, keyOf: (String) -> ByteArray?): Pair<String, String>? {
            val mid = NetOutbox.receiptOf(json) ?: return null
            return try {
                val o = JSONObject(json)
                val from = o.optString("from").trim().lowercase()
                val a = o.optString("a")
                val key = keyOf(from) ?: return null
                if (a.isEmpty() || me.isEmpty()) return null
                val exp = NetBg.ackMac(key, "${o.optString("type")}|$mid|$from|${me.lowercase()}")
                if (java.security.MessageDigest.isEqual(exp.toByteArray(Charsets.UTF_8), a.toByteArray(Charsets.UTF_8))) from to mid else null
            } catch (e: Exception) { null }
        }
    }

    /** 3315: un paquete Jump que el nativo reenvía (o guarda hasta que el enlace del destino hable). */
    class Relay(val to: String, val key: String, val json: String, val msg: Boolean, val hp: Int, val origin: String = "") {
        var from = ""      // enlace por el que llegó (no se le devuelve)
        var at = 0L        // cuándo llegó
    }
    private val held = LinkedHashMap<String, Relay>()   // clave → paquete esperando el enlace de su destino
    private val relayed = LinkedHashMap<String, Long>() // clave → cuándo se reenvió (para no repetirlo en cada reintento del que lo mandó)
    /** Cuántos paquetes de otros reenvió el nativo (para el registro y las pruebas). */
    @Volatile var relayedCount = 0
        private set

    private val linkNx = LinkedHashMap<String, String>() // enlace (dirección normalizada) → NEXO ID
    // Decisión del dueño 23-11 (3A, auditoría puntos 3/4/8 y S-B4): antes de escribir lo pendiente por un enlace que no identificó la app,
    // un RETO: el enlace tiene que contestar con la firma de la pareja (solo el contacto de verdad la tiene). Antes bastaba con que el
    // enlace DIJERA ser el contacto (o copiara su código del aire) para recibir el paquete cifrado y ver el sobre (de quién, para quién).
    private val proven = HashMap<String, String>()                 // enlace → NEXO ID ya comprobado (la app o el reto)
    private val asked = HashMap<String, Pair<String, Long>>()      // enlace → (reto, cuándo se mandó)

    /** La app dice de quién es un enlace listo (al ocultarse): la app ya lo comprobó con el cifrado. */
    @Synchronized fun seed(mac: String, nx: String) { val n = nx.trim().lowercase(); learn(mac, n); if (linkNx[mac] == n) proven[mac] = n }
    /** El enlace se cerró. */
    @Synchronized fun closed(mac: String) { linkNx.remove(mac); proven.remove(mac); asked.remove(mac) }
    @Synchronized fun nxOf(mac: String): String? = linkNx[mac]

    private fun learn(mac: String, nx: String): Boolean {
        if (mac.isEmpty() || !Regex("^nx[0-9a-z]{8}$").matches(nx)) return false
        if (linkNx[mac] == nx) return false
        linkNx.remove(mac); linkNx[mac] = nx
        while (linkNx.size > MAX_LINKS) linkNx.remove(linkNx.keys.first())
        return true
    }

    /** Lo que llega por un enlace con la app dormida, cerrada o sin la app (un mensaje corto entero). */
    @Synchronized fun heard(mac: String, json: String) {
        val said = NetOutbox.linkNxOf(json)
        val fresh = said != null && learn(mac, said)
        if (json.length < 600 && json.contains("\"type\":\"or\"")) { onAnswer(mac, json); return } // 3A: respuesta al reto
        // 3315 (paso 2): «¿quién llega a X?» de un contacto: si X tiene enlace conmigo, «yo» (así se elige un puente dormido sin ruta previa)
        if (json.length < 2000 && json.contains("\"rq\"")) rqOf(json)?.let { onRq(mac, it); return }
        // 3315: un paquete Jump para otro: a su destino (o a esperar su enlace)
        relayOf(json, me())?.let { r -> if (r.origin.isNotEmpty() && said == null) learn(mac, r.origin); onRelay(mac, r); return }
        // 3315: este enlace habló: lo que se guardó para su NEXO sale ya por él
        if (held.isNotEmpty()) linkNx[mac]?.let { flushHeld(mac, it) }
        val b = bg() ?: return
        if (b.outbox.size() == 0) return
        signedReceipt(json, me(), keyOf)?.let { (from, mid) -> b.outboxConfirmed(from, mid, "por Bluetooth") }
        val nx = linkNx[mac] ?: return
        if (!b.outbox.hasFor(nx)) return
        if (fresh) b.outbox.bleFresh(nx) // enlace nuevo con él: lo suyo sale ya (sin esperar el plazo del enlace anterior)
        sendVia(b, mac, nx, now())       // por ESTE enlace, que acaba de hablar (está vivo)
    }

    private fun sendVia(b: NetBg, mac: String, nx: String, t: Long): Int {
        if (!link.ready(mac)) return 0
        if (proven[mac] != nx && !challenge(mac, nx, t)) return 0
        var n = 0
        for (x in b.outbox.bleDue(nx, t)) {
            if (!link.send(mac, x.p)) break // cola llena: en el próximo repaso
            b.outbox.bleSent(x.id, t)
            n++
            link.log("Bandeja de salida: ${x.id} para $nx sale por Bluetooth sin la app" + if (x.bleTries > 1) " (intento nº ${x.bleTries})" else "")
        }
        return n
    }

    /** Repaso periódico: escribe lo que toca por los enlaces listos, el más reciente de cada contacto primero. Devuelve cuántos salieron. */
    @Synchronized fun pump(): Int {
        val b = bg() ?: return 0
        if (b.outbox.size() == 0) return 0
        val t = now()
        var n = 0
        for ((mac, nx) in linkNx.entries.toList().asReversed()) n += sendVia(b, mac, nx, t)
        return n
    }

    // ---------- 3315: el puente nativo ----------
    private fun onRelay(mac: String, r: Relay) {
        val t = now()
        expireRelay(t)
        if (r.msg && !relayOk()) { link.log("Puente sin la app: batería baja: no hago de puente para ${r.key.substringBeforeLast(':')}"); return }
        val last = relayed[r.key]
        if (last != null && t - last < RELAY_AGAIN_MS) return // ya salió hace poco: el reintento del que lo mandó no se reenvía otra vez
        r.from = mac; r.at = t
        val to = relayLink(r.to, mac, t)
        if (to != null && relaySend(to, r, t)) return // si el envío falla (enlace ocupado), se guarda y sale cuando ese enlace hable
        if (held.containsKey(r.key)) return
        // tope por enlace y total: sale lo más viejo (quien llena lo guardado se estorba a sí mismo)
        val mine = held.values.filter { it.from == mac }
        if (mine.size >= RELAY_HOLD_PER_LINK) held.remove(mine.first().key)
        while (held.size >= RELAY_HOLD_MAX) held.remove(held.keys.first())
        held[r.key] = r
        link.log("Puente sin la app: ${r.key.substringBeforeLast(':')} para ${r.to}: sin enlace con él ahora, espera a que aparezca (salto ${r.hp})")
    }

    private val rqSeen = LinkedHashMap<String, Long>()          // id de búsqueda → cuándo (se contesta una vez)
    private val rqRate = HashMap<String, ArrayList<Long>>()     // enlace → búsquedas del último minuto
    /**
     * 3315 (paso 2): la app del que busca camino pregunta a sus vecinos «¿quién llega a X?» ('rq'); un puente con la app dormida no
     * contestaba y nunca se le elegía. Ahora el nativo contesta «yo, a 1 salto» ('rp', lo mismo que la app) si X tiene un enlace listo con
     * él. Solo a quien es mi contacto (el 'rp' lleva mi NEXO ID: la misma regla que el pong y el «quién soy», decisión 12A) y con batería.
     * No sigue preguntando más allá (eso necesita la app): solo el último salto.
     */
    private fun onRq(mac: String, rq: Triple<String, String, String>) {
        val (id, from, dst) = rq
        val my = me().trim().lowercase()
        if (my.isEmpty() || from == my || dst == my || b2Key(from) == null || !relayOk()) return
        val t = now()
        if (rqSeen.containsKey(id)) return
        rqSeen[id] = t; while (rqSeen.size > 256) rqSeen.remove(rqSeen.keys.first())
        val l = rqRate.getOrPut(mac) { ArrayList() }; l.removeAll { t - it >= 60_000L }
        if (l.size >= RQ_PER_LINK_MIN) return
        l.add(t); if (rqRate.size > MAX_LINKS) rqRate.remove(rqRate.keys.first())
        val reach = linkNx.entries.any { it.value == dst && it.key != mac && link.ready(it.key) }
        if (!reach) return
        if (link.send(mac, JSONObject().put("v", 1).put("type", "rp").put("id", id).put("from", my).put("dst", dst).put("hops", 1).toString()))
            link.log("Puente sin la app: $from busca camino a $dst y tengo enlace con él: le contesto que por mí")
    }

    /** El enlace por el que se puede reenviar a ese NEXO (el más reciente, listo, que no es por donde llegó). A un contacto mío, solo comprobado. */
    private fun relayLink(nx: String, from: String, t: Long): String? {
        val contact = b2Key(nx) != null
        for ((mac, n) in linkNx.entries.toList().asReversed()) {
            if (n != nx || mac == from || !link.ready(mac)) continue
            if (contact && proven[mac] != nx) { challenge(mac, nx, t); continue } // 3A: que demuestre que es él (al contestar sale: flushHeld)
            return mac
        }
        return null
    }

    private fun relaySend(mac: String, r: Relay, t: Long): Boolean {
        if (!link.send(mac, r.json)) return false
        held.remove(r.key)
        relayed.remove(r.key); relayed[r.key] = t
        while (relayed.size > 256) relayed.remove(relayed.keys.first())
        relayedCount++
        link.log("Puente sin la app: ${r.key.substringBeforeLast(':')} para ${r.to} sale por $mac (salto ${r.hp})")
        return true
    }

    private fun flushHeld(mac: String, nx: String) {
        val t = now()
        expireRelay(t)
        if (!link.ready(mac) || (b2Key(nx) != null && proven[mac] != nx)) {
            if (held.values.any { it.to == nx } && link.ready(mac)) challenge(mac, nx, t)
            return
        }
        for (r in held.values.filter { it.to == nx && it.from != mac }) if (!relaySend(mac, r, t)) break
    }

    private fun expireRelay(t: Long) {
        val it = held.values.iterator()
        while (it.hasNext()) if (t - it.next().at > RELAY_HOLD_MS) it.remove()
    }

    /** 3315: lo que espera el enlace de su destino (para el registro y las pruebas). */
    @Synchronized fun heldCount(): Int { expireRelay(now()); return held.size }

    /** 3271: contactos con algo pendiente y SIN enlace listo: a esos hay que buscarlos y conectar (OutboxDial). */
    @Synchronized fun wanting(): Set<String> {
        val b = bg() ?: return emptySet()
        if (b.outbox.size() == 0) return emptySet()
        // 3A (auditoría S-B3/S-B4): solo cuenta un enlace COMPROBADO (la app o el reto); uno que solo dice ser él no frena la búsqueda del de verdad
        val linked = linkNx.entries.filter { link.ready(it.key) && proven[it.key] == it.value }.map { it.value }.toSet()
        return b.outbox.nxs().filter { it !in linked }.toSet()
    }

    /**
     * 3280: ¿corre prisa buscar a alguno de esos? Sí si algo suyo aún no lo aceptó ningún relé (sin internet: metro, multitud): entonces
     * el Bluetooth es el único camino y se le busca seguido y con despertador. Si ya está a salvo en el buzón de internet se le busca
     * igual, pero más espaciado (OutboxDial).
     */
    fun urgent(want: Set<String>): Boolean = want.isNotEmpty() && bg()?.outbox?.unsentNxs()?.any { it in want } == true

    /** ¿Queda algo que podría salir por Bluetooth? (para el repaso periódico) */
    fun pending(): Boolean = (bg()?.outbox?.size() ?: 0) > 0

    // 3A: ¿se puede escribir ya? true = sin clave de ese contacto no hay con qué comprobar (como antes); false = se mandó (o espera) el reto
    private fun challenge(mac: String, nx: String, t: Long): Boolean {
        if (b2Key(nx) == null) { proven[mac] = nx; return true }
        val a = asked[mac]
        if (a != null && t - a.second < CHALLENGE_RETRY_MS) return false
        val n = randomHex(16)
        asked[mac] = n to t
        while (asked.size > MAX_LINKS) asked.remove(asked.keys.first())
        if (link.send(mac, JSONObject().put("v", 1).put("type", "oc").put("n", n).put("from", me().lowercase()).toString()))
            link.log("Bandeja de salida: reto a $mac (dice ser $nx) antes de mandarle lo suyo")
        return false
    }
    private fun b2Key(nx: String): ByteArray? = try { keyOf(nx) } catch (e: Exception) { null }
    private fun onAnswer(mac: String, json: String) {
        val nx = linkNx[mac] ?: return
        val a = asked[mac] ?: return
        val ok = answerValid(json, a.first, nx, me(), b2Key(nx))
        if (!ok) { link.log("Bandeja de salida: $mac no supo contestar el reto de $nx: no se le manda nada"); return }
        asked.remove(mac); proven[mac] = nx
        link.log("Bandeja de salida: $mac es $nx (reto contestado)")
        flushHeld(mac, nx) // 3315
        val b = bg() ?: return
        sendVia(b, mac, nx, now())
    }
}

/** 3A: el reto antes de entregar sin la app (lo que se firma y quién contesta). */
object OutboxChallenge {
    /** La respuesta a un reto {type:'oc', n, from}: la manda quien lo recibe si el que pregunta es su contacto (sign = firma de pareja). */
    fun answer(json: String, me: String, sign: (String, String) -> String?): String? = try {
        val o = JSONObject(json)
        val n = o.optString("n"); val from = o.optString("from").trim().lowercase()
        if (o.optString("type") != "oc" || !Regex("^[0-9a-f]{16,64}$").matches(n) || !Regex("^nx[0-9a-z]{8}$").matches(from)) null
        else sign(from, "or|$n|${me.lowercase()}|$from")?.let { JSONObject().put("v", 1).put("type", "or").put("n", n).put("from", me.lowercase()).put("a", it).toString() }
    } catch (e: Exception) { null }
}
