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

    /** La app dice de quién es un enlace listo (al ocultarse). */
    @Synchronized fun seed(mac: String, nx: String) { learn(mac, nx.trim().lowercase()) }
    /** El enlace se cerró. */
    @Synchronized fun closed(mac: String) { linkNx.remove(mac) }
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
        signedReceipt(json, me(), keyOf)?.let { (from, mid) -> b.outboxConfirmed(from, mid, "por Bluetooth") }
        val nx = linkNx[mac] ?: return
        if (!b.outbox.hasFor(nx)) return
        if (fresh) b.outbox.bleFresh(nx) // enlace nuevo con él: lo suyo sale ya (sin esperar el plazo del enlace anterior)
        sendVia(b, mac, nx, now())       // por ESTE enlace, que acaba de hablar (está vivo)
    }

    private fun sendVia(b: NetBg, mac: String, nx: String, t: Long): Int {
        if (!link.ready(mac)) return 0
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
        val linked = linkNx.entries.filter { link.ready(it.key) }.map { it.value }.toSet()
        return b.outbox.nxs().filter { it !in linked }.toSet()
    }

    /** ¿Queda algo que podría salir por Bluetooth? (para el repaso periódico) */
    fun pending(): Boolean = (bg()?.outbox?.size() ?: 0) > 0
}
