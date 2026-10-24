package com.nexo.ble

// Trozos binarios por Bluetooth (ronda 2753): los datos de un archivo viajan como bytes y no como texto base64
// (un 33 % menos por la radio). Formato de un trozo:
//   0x01 | largo de la cabecera (2 bytes) | largo de los datos (4 bytes) | cabecera JSON (UTF-8) | datos
// Un mensaje de texto (JSON) nunca empieza por 0x01, así que los dos formatos conviven en el mismo canal.
// Al llegar, el plugin devuelve la cabecera y los datos en base64 a la app (el JS rehace el trozo de siempre).
object BinFrame {
    const val MARK: Byte = 0x01
    const val HEAD = 7
    const val MAX_HEADER = 4096
    const val MAX_DATA = 65536

    fun encode(header: String, data: ByteArray): ByteArray {
        val h = header.toByteArray(Charsets.UTF_8)
        require(h.size <= MAX_HEADER && data.size <= MAX_DATA) { "trozo binario demasiado grande" }
        val out = ByteArray(HEAD + h.size + data.size)
        out[0] = MARK
        out[1] = (h.size shr 8).toByte(); out[2] = h.size.toByte()
        out[3] = (data.size shr 24).toByte(); out[4] = (data.size shr 16).toByte(); out[5] = (data.size shr 8).toByte(); out[6] = data.size.toByte()
        System.arraycopy(h, 0, out, HEAD, h.size)
        System.arraycopy(data, 0, out, HEAD + h.size, data.size)
        return out
    }

    // Partir en escrituras de como mucho `size` bytes (el receptor junta por el largo de la cabecera)
    fun split(frame: ByteArray, size: Int): List<ByteArray> {
        val n = size.coerceAtLeast(HEAD)
        val out = mutableListOf<ByteArray>()
        var i = 0
        while (i < frame.size) { val e = minOf(i + n, frame.size); out.add(frame.copyOfRange(i, e)); i = e }
        return out
    }
}

// Ronda 2757 (plan punto 8): trozos de texto por bytes reales (UTF-8) y no por caracteres con 10 de margen: con MTU 23
// se usaban 10 de los 20 bytes de cada escritura. Nunca se corta un carácter (ni un emoji): cada escritura es UTF-8
// válido por sí sola (las builds anteriores convierten cada escritura a texto por separado).
object Utf8Split {
    fun bytesOf(c: Char, next: Char?): Int = when {
        Character.isHighSurrogate(c) && next != null && Character.isLowSurrogate(next) -> 4
        c.code < 0x80 -> 1
        c.code < 0x800 -> 2
        else -> 3
    }

    fun split(str: String, maxBytes: Int): List<String> {
        val max = maxBytes.coerceAtLeast(4)
        val out = mutableListOf<String>()
        var start = 0; var bytes = 0; var i = 0
        while (i < str.length) {
            val next = if (i + 1 < str.length) str[i + 1] else null
            val len = bytesOf(str[i], next)
            val chars = if (len == 4) 2 else 1
            if (bytes + len > max && i > start) { out.add(str.substring(start, i)); start = i; bytes = 0 }
            bytes += len; i += chars
        }
        if (start < str.length) out.add(str.substring(start))
        return out
    }
}

// Junta las escrituras de cada teléfono. Lo que no es un trozo binario se devuelve tal cual (texto de siempre).
class BinAssembler(private val timeoutMs: Long = 4000) {
    class Frame(val header: String, val data: ByteArray)
    class Out(val frames: List<Frame>, val text: ByteArray?, val dropped: Int)
    private class State(val hLen: Int, val total: Int) { val buf = ByteArray(total); var got = 0; var last = 0L }
    private val states = HashMap<String, State>()

    @Synchronized fun pending(key: String) = states.containsKey(key)

    private fun has(b: ByteArray, at: Int, p: String): Boolean {
        val pb = p.toByteArray(Charsets.UTF_8)
        if (b.size < at + pb.size) return false
        for (i in pb.indices) if (b[at + i] != pb[i]) return false
        return true
    }
    // Comienzo de un trozo binario (cabecera JSON '{"v":' tras los 7 bytes) o de un mensaje JSON de la app
    private fun startsNew(b: ByteArray) =
        (b.isNotEmpty() && b[0] == BinFrame.MARK && has(b, BinFrame.HEAD, "{\"v\":")) || has(b, 0, "{\"v\":") || has(b, 0, "{\"type\":")
    @Synchronized fun reset(key: String) { states.remove(key) }
    @Synchronized fun clearAll() { states.clear() }

    @Synchronized fun feed(key: String, bytes: ByteArray, now: Long): Out {
        val frames = mutableListOf<Frame>()
        var dropped = 0
        var st = states[key]
        // Un trozo a medias que lleva tiempo parado se perdió (desconexión): fuera, y lo nuevo se lee desde cero
        if (st != null && now - st.last > timeoutMs) { states.remove(key); st = null; dropped++ }
        // Se perdió el final de un trozo (el emisor descartó el resto tras no poder escribir): lo que llega ahora
        // empieza otro trozo o un mensaje de texto. Sin esto se pegaba al trozo roto y arrastraba lo siguiente.
        if (st != null && startsNew(bytes)) { states.remove(key); st = null; dropped++ }
        var b = bytes
        while (b.isNotEmpty()) {
            if (st == null) {
                if (b[0] != BinFrame.MARK) return Out(frames, b, dropped)
                if (b.size < BinFrame.HEAD) { dropped++; break }
                val h = ((b[1].toInt() and 0xff) shl 8) or (b[2].toInt() and 0xff)
                val d = ((b[3].toInt() and 0xff) shl 24) or ((b[4].toInt() and 0xff) shl 16) or ((b[5].toInt() and 0xff) shl 8) or (b[6].toInt() and 0xff)
                if (h <= 0 || h > BinFrame.MAX_HEADER || d < 0 || d > BinFrame.MAX_DATA) { dropped++; break }
                st = State(h, BinFrame.HEAD + h + d)
                states[key] = st
            }
            val take = minOf(st.total - st.got, b.size)
            System.arraycopy(b, 0, st.buf, st.got, take)
            st.got += take
            st.last = now
            b = b.copyOfRange(take, b.size)
            if (st.got == st.total) {
                states.remove(key)
                val header = String(st.buf, BinFrame.HEAD, st.hLen, Charsets.UTF_8)
                frames.add(Frame(header, st.buf.copyOfRange(BinFrame.HEAD + st.hLen, st.total)))
                st = null
            }
        }
        return Out(frames, null, dropped)
    }
}
