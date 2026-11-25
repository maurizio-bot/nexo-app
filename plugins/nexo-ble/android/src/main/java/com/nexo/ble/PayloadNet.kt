package com.nexo.ble

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import org.json.JSONObject

// Auditoría 23-11 (T-L1, T-F8, T-E1): recepción de lo MEDIANO (lo que la app tiene en memoria, ya cifrado de punta a punta) por
// el canal rápido del Bluetooth (L2CAP, PluginFiles.l2PayloadHost) y por Wi-Fi Direct (PluginWifiDirect.wdReceive). Sin Android:
// se prueba en la JVM (tests/kotlin PayloadNetTest).
//  - Se aceptan conexiones EN BUCLE hasta la buena (como BigNet.serve): una conexión ajena (sin el token, otro id, otro tamaño,
//    basura o nada en HEADER_MS) se cierra y se sigue esperando. Antes la primera conexión, fuera de quien fuera, se llevaba la
//    espera: alguien cerca hacía caer el archivo a trozos.
//  - Cabecera { id, tk, len }: el token (16 bytes al azar, nuevo en cada archivo) lo pone quien recibe y viaja en la respuesta
//    («la», o cifrado en las credenciales de Wi-Fi Direct); `len` tiene que ser EXACTAMENTE el tamaño que se anunció en la oferta.
//  - El contenido se lee por partes (el búfer crece con lo que llega): nada de reservar 40 MB por una cabecera de 4 bytes.
//  - El byte de «recibido» (la entrega para quien envía) sale SOLO cuando la app confirma que lo pudo descifrar (Acks.put), como
//    los trozos desde la 2767. Si no lo confirma a tiempo o dice que no, se cierra sin él: quien envía sigue por el camino de siempre.
object PayloadNet {
    const val HEADER_MS = 5000          // una conexión tiene esto para mandar su cabecera
    const val ACK_WAIT_MS = 20000L      // lo que se espera a que la app lo descifre (JS: l2_fast ACK_WAIT_MS / WD_ACK_WAIT_MS)

    // Una conexión aceptada (socket TCP o canal L2CAP): `limit` pone el plazo de lectura (TCP: soTimeout; L2CAP: un vigilante
    // que cierra el canal, porque un BluetoothSocket no tiene plazo propio)
    interface Conn {
        val input: InputStream
        val output: OutputStream
        fun limit(ms: Int)
        fun close()
    }

    // La cabecera de una conexión: el tamaño si es la esperada; null si no (otra transferencia, sin token, tamaño distinto, basura)
    fun header(input: DataInputStream, id: String, token: String, expect: Long, max: Long): Long? {
        val h = try { JSONObject(input.readUTF()) } catch (e: Exception) { return null }
        if (id.isEmpty() || h.optString("id") != id) return null
        if (token.length < 16 || h.optString("tk") != token) return null
        val len = h.optLong("len", -1)
        if (len <= 0 || len > max) return null
        if (expect > 0 && len != expect) return null
        return len
    }

    // Lee exactamente `len` bytes por partes
    fun readBody(input: InputStream, len: Long): ByteArray {
        val out = ByteArrayOutputStream(minOf(len, 1L shl 20).toInt())
        val buf = ByteArray(1 shl 16)
        var got = 0L
        while (got < len) {
            val r = input.read(buf, 0, minOf(buf.size.toLong(), len - got).toInt())
            if (r < 0) throw java.io.IOException("conexión cortada ($got de $len bytes)")
            out.write(buf, 0, r); got += r
        }
        return out.toByteArray()
    }

    // Confirmaciones de la app (transferId → buzón de un solo uso)
    class AckBox {
        private val q = ArrayBlockingQueue<Boolean>(1)
        fun put(ok: Boolean) { q.offer(ok) }
        fun await(ms: Long): Boolean = try { q.poll(ms, TimeUnit.MILLISECONDS) ?: false } catch (e: InterruptedException) { false }
    }
    val acks = ConcurrentHashMap<String, AckBox>()
    // La app dice si lo pudo leer; false si no había nada esperando esa confirmación
    fun ack(id: String, ok: Boolean): Boolean { val b = acks[id] ?: return false; b.put(ok); return true }

    class Result(val delivered: Boolean, val bytes: Long, val readMs: Long, val rejected: Int)

    // Espera la conexión buena. accept(msQueQuedan) da la siguiente conexión (o lanza al vencer el plazo / cerrarse la espera).
    // deliver(datos, msDeLectura) pasa el contenido a la app; luego se espera su confirmación. Lanza si no llegó ninguna buena.
    fun serve(accept: (Long) -> Conn, windowMs: Long, id: String, token: String, expect: Long, max: Long, bodyMs: Int,
              deliver: (ByteArray, Long) -> Unit, ackWaitMs: Long = ACK_WAIT_MS, now: () -> Long = System::currentTimeMillis): Result {
        val until = now() + windowMs
        var rejected = 0
        while (true) {
            val left = until - now()
            if (left <= 0) throw java.io.IOException("Accept timed out ($rejected conexiones ajenas)")
            val c = accept(left)
            var len: Long? = null
            try {
                c.limit(HEADER_MS)
                len = header(DataInputStream(c.input), id, token, expect, max)
            } catch (e: Exception) { len = null }
            if (len == null) { rejected++; try { c.close() } catch (e: Exception) {}; continue }
            // Desde aquí es quien tiene el token: lo que pase con esta conexión decide
            val box = AckBox()
            acks[id] = box
            try {
                c.limit(bodyMs)
                val t0 = now()
                val data = readBody(c.input, len)
                val readMs = now() - t0
                deliver(data, readMs)
                val ok = box.await(ackWaitMs)
                if (ok) c.output.apply { write(1); flush() }
                return Result(ok, len, readMs, rejected)
            } finally {
                acks.remove(id, box)
                try { c.close() } catch (e: Exception) {}
            }
        }
    }

    // La cabecera que manda quien envía
    fun headerJson(id: String, token: String, len: Int): String = JSONObject().put("id", id).put("tk", token).put("len", len).toString()
}
