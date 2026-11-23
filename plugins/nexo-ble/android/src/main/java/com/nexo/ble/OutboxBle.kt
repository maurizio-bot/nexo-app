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
 */
class OutboxBle(
    private val me: () -> String,
    private val bg: () -> NetBg?,
    private val keyOf: (String) -> ByteArray?,
    private val link: Link,
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
        val b = bg() ?: return
        val said = NetOutbox.linkNxOf(json)
        val fresh = said != null && learn(mac, said)
        if (b.outbox.size() == 0) return
        if (json.length < 600 && json.contains("\"type\":\"or\"")) { onAnswer(mac, json); return } // 3A: respuesta al reto
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
