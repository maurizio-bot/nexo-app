package com.nexo.ble

import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

// 3336 (diag. vivo 24-11 22:27, adjunto de 23,5 MB atorado en 589/601 ~43 min): con la pantalla apagada el Vivo congela TODA la app
// (ni una línea de la página en 42 min) y la escucha nativa de internet (NetBg), que sí seguía viva, dejaba los trozos de archivo en
// una lista en memoria con tope (500 eventos / 4 MB: se perdían) y NO los confirmaba: el que envía se quedaba esperando su acuse de
// bloque ('ba') y el envío se paraba hasta que el otro encendía la pantalla. Ahora los trozos ('f') que llegan de un contacto se guardan
// en DISCO tal cual (el evento del relé, cifrado: el nativo no lo abre más allá del sobre de pareja) y se confirma SOLO lo guardado,
// con el mismo acuse que la app. La app los recoge al volver (netBgDrain) y los procesa como si llegaran; lo que faltara lo vuelve a
// pedir (NACK) como siempre. Sin la página no se arma el archivo: eso lo hace la app al volver (y manda la confirmación final).
class NetChunkSpool(private val dir: File, private val maxBytes: Long = 48L * 1024 * 1024) {
    data class Frame(val msgId: String, val idx: Int, val total: Int)
    private class Tx(val nx: String, val msgId: String, val total: Int) {
        val have = java.util.TreeSet<Int>()
        var unacked = 0
    }
    private val txs = HashMap<String, Tx>()
    private var bytes = -1L

    companion object {
        const val ACK_EVERY = 4                 // como la app (ble_ack_shared ACK_EVERY)
        const val MAX_TOTAL = 20000             // trozos por archivo como mucho (un 1 GB a 64 KB son ~16 000)
        private val MSG_ID = Regex("^[A-Za-z0-9_-]{4,80}$")
        private val NX = Regex("^nx[0-9a-z]{8}$")

        // Un trozo de archivo de la app: {"v":…,"t":"f","m":id,"i":n,"n":total,…}. Los textos largos ('c') no: son pocos y la app
        // los confirma al volver; solo archivos, que es lo que se atasca.
        fun frameOf(p: String): Frame? {
            if (p.length < 20 || !p.startsWith("{") || !p.contains("\"t\":\"f\"")) return null
            return try {
                val o = JSONObject(p)
                if (o.optString("t") != "f") return null
                val m = o.optString("m"); val i = o.optInt("i", -1); val n = o.optInt("n", -1)
                if (!MSG_ID.matches(m) || n < 1 || n > MAX_TOTAL || i < 0 || i >= n) null else Frame(m, i, n)
            } catch (e: Exception) { null }
        }

        // Los índices en tramos, igual que la app (_compressRanges): «0-5,7,9-10»
        fun ranges(s: Collection<Int>): String {
            val l = s.sorted(); if (l.isEmpty()) return ""
            val out = ArrayList<String>(); var a = l[0]; var b = l[0]
            for (k in 1..l.size) {
                if (k < l.size && l[k] == b + 1) { b = l[k]; continue }
                out.add(if (a == b) "$a" else "$a-$b")
                if (k < l.size) { a = l[k]; b = l[k] }
            }
            return out.joinToString(",")
        }

        fun ackJson(msgId: String, ranges: String, total: Int): String =
            JSONObject().put("v", 2).put("t", "ba").put("m", msgId).put("r", ranges).put("n", total).put("bf", 1).toString()

        private fun key(nx: String, m: String): String =
            MessageDigest.getInstance("SHA-256").digest("$nx|$m".toByteArray()).joinToString("") { "%02x".format(it) }.substring(0, 24)
    }

    private fun used(): Long {
        if (bytes < 0) bytes = try { dir.walkTopDown().filter { it.isFile }.sumOf { it.length() } } catch (e: Exception) { 0L }
        return bytes
    }

    // Guarda el evento del trozo. Devuelve el acuse a mandar (o "" si aún no toca), o null si NO se guardó (lleno, raro, de otro troceado):
    // entonces el evento sigue el camino de antes (lista en memoria) y no se confirma.
    @Synchronized fun add(nx: String, f: Frame, ev: String, now: Long = System.currentTimeMillis()): String? {
        if (!NX.matches(nx)) return null
        val k = key(nx, f.msgId)
        var tx = txs[k]
        if (tx != null && tx.total != f.total) return null      // otro troceado del mismo mensaje (cambió de camino): lo ve la app
        val d = File(dir, k)
        if (tx == null) {
            tx = Tx(nx, f.msgId, f.total)
            // si ya había trozos guardados (proceso nuevo), se cuentan
            d.listFiles()?.forEach { it.name.toIntOrNull()?.let { i -> if (i in 0 until f.total) tx.have.add(i) } }
            txs[k] = tx
        }
        if (!tx.have.contains(f.idx)) {
            if (used() + ev.length > maxBytes) return null
            try {
                d.mkdirs()
                val tmp = File(d, "${f.idx}.tmp"); tmp.writeText(ev); if (!tmp.renameTo(File(d, "${f.idx}"))) { tmp.delete(); return null }
            } catch (e: Exception) { return null }
            bytes = used() + ev.length
            tx.have.add(f.idx); tx.unacked++
        }
        // como la app: cada ACK_EVERY trozos nuevos, al llegar el último o si llega uno repetido (el que envía no vio el acuse)
        val due = tx.unacked >= ACK_EVERY || f.idx == f.total - 1 || tx.unacked == 0
        if (!due) return ""
        tx.unacked = 0
        return ackJson(f.msgId, ranges(tx.have), f.total)
    }

    // Lo pendiente de confirmar (trozos guardados sin acuse aún): para el repaso de la escucha, así no espera al siguiente trozo
    @Synchronized fun pendingAcks(): List<Pair<String, String>> = txs.values.filter { it.unacked > 0 }.map { it.unacked = 0; it.nx to ackJson(it.msgId, ranges(it.have), it.total) }

    // Todo lo guardado para la app (eventos del relé tal cual, en orden de trozo) y se borra
    @Synchronized fun drain(): List<String> {
        val out = ArrayList<String>()
        dir.listFiles()?.filter { it.isDirectory }?.forEach { d ->
            d.listFiles()?.mapNotNull { f -> f.name.toIntOrNull()?.let { it to f } }?.sortedBy { it.first }?.forEach { (_, f) -> try { out.add(f.readText()) } catch (e: Exception) { } }
            d.deleteRecursively()
        }
        txs.clear(); bytes = 0
        return out
    }

    @Synchronized fun count(): Int = txs.values.sumOf { it.have.size }
}
