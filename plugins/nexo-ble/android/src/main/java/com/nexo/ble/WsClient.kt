package com.nexo.ble

import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.security.SecureRandom
import java.util.Base64
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

// Cliente WebSocket mínimo (RFC 6455) para hablar con los relés desde la parte nativa (NetBg): conectar (wss://; ws:// solo a
// esta misma máquina, para las pruebas), mandar texto, recibir texto, contestar pings. Un hilo lector por conexión; los avisos
// llegan en ese hilo.
// Auditoría 23-11 (S-A3, T-S1, S-D5): plazo de HANDSHAKE_MS en el TLS y el saludo HTTP (antes un relé colgado dejaba el hilo de la
// escucha parado para siempre), tope a las líneas de cabecera y al mensaje que se junta con tramas de continuación (antes sin tope:
// OutOfMemory), se captura Throwable en el hilo lector, close() cierra también el socket que está conectando, y nada en claro
// (ws://) hacia fuera. proxy (decisión 13A): el SOCKS de Tor con «Usar Tor siempre» (TorRoute); null = directo.
class WsClient(
    private val url: String,
    private val onText: (String) -> Unit,
    private val onClose: (String) -> Unit,
    private val connectTimeoutMs: Int = 15000,
    private val proxy: java.net.Proxy? = null,
) {
    companion object {
        const val HANDSHAKE_MS = 15000
        const val MAX_LINE = 8192             // una línea de la respuesta HTTP
        const val MAX_HEADERS = 100           // líneas de cabecera
        const val MAX_MESSAGE = 4_000_000     // un mensaje entero (todas sus tramas): lo mismo que una trama sola
        fun urlOk(url: String): Boolean = try {
            val u = URI(url)
            u.scheme == "wss" || (u.scheme == "ws" && (u.host == "127.0.0.1" || u.host == "localhost" || u.host == "[::1]"))
        } catch (e: Exception) { false }
    }
    @Volatile private var sock: Socket? = null
    @Volatile private var connecting: Socket? = null
    @Volatile private var closed = false
    @Volatile private var out: OutputStream? = null
    @Volatile var open = false; private set
    private val rnd = SecureRandom()
    private val wlock = Any()

    fun connect() {
        if (!urlOk(url)) throw IllegalArgumentException("solo wss:// (relé en claro rechazado)")
        val u = URI(url)
        val secure = u.scheme == "wss"
        val host = u.host
        val port = if (u.port > 0) u.port else if (secure) 443 else 80
        val raw = if (proxy != null) Socket(proxy) else Socket()
        connecting = raw
        if (closed) { try { raw.close() } catch (e: Exception) { }; throw IllegalStateException("cerrada") }
        try { connectOn(raw, u, secure, host, port) } catch (e: Throwable) { try { raw.close() } catch (x: Exception) { }; connecting = null; throw e }
    }

    private fun connectOn(raw: Socket, u: URI, secure: Boolean, host: String, port: Int) {
        // Por Tor el nombre lo resuelve Tor (sin fuga de DNS)
        raw.connect(if (proxy != null) InetSocketAddress.createUnresolved(host, port) else InetSocketAddress(host, port), connectTimeoutMs)
        raw.soTimeout = HANDSHAKE_MS   // S-A3: TLS y saludo con plazo
        val s: Socket = if (secure) {
            (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(raw, host, port, true).also {
                connecting = it
                val ssl = it as SSLSocket
                val p = ssl.sslParameters; p.serverNames = listOf(SNIHostName(host)); p.endpointIdentificationAlgorithm = "HTTPS"; ssl.sslParameters = p
                ssl.soTimeout = HANDSHAKE_MS
                ssl.startHandshake()
            }
        } else raw
        val key = ByteArray(16).also { rnd.nextBytes(it) }.let { Base64.getEncoder().encodeToString(it) }
        val path = (u.rawPath ?: "").ifEmpty { "/" } + (if (u.rawQuery != null) "?" + u.rawQuery else "")
        val req = "GET $path HTTP/1.1\r\nHost: $host${if (u.port > 0) ":$port" else ""}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\nUser-Agent: NEXO\r\n\r\n"
        val o = s.getOutputStream(); o.write(req.toByteArray()); o.flush()
        val inp = BufferedInputStream(s.getInputStream())
        val status = readLine(inp)
        if (!status.startsWith("HTTP/1.1 101")) { try { s.close() } catch (e: Exception) { }; throw IllegalStateException("el relé no aceptó: ${status.take(80)}") }
        var n = 0
        while (readLine(inp).isNotEmpty()) { if (++n > MAX_HEADERS) throw IllegalStateException("demasiadas cabeceras") }
        s.soTimeout = 0
        if (closed) { try { s.close() } catch (e: Exception) { }; throw IllegalStateException("cerrada") }
        sock = s; out = o; open = true; connecting = null
        Thread({ readLoop(inp) }, "nexo-ws").apply { isDaemon = true }.start()
    }

    private fun readLine(i: InputStream): String {
        val b = ByteArrayOutputStream()
        while (true) {
            val c = i.read()
            if (c < 0) throw IllegalStateException("conexión cerrada")
            if (c == '\n'.code) break
            if (c != '\r'.code) b.write(c)
            if (b.size() > MAX_LINE) throw IllegalStateException("línea de cabecera demasiado larga")
        }
        return b.toString("UTF-8")
    }

    private fun readFully(i: InputStream, n: Int): ByteArray {
        val b = ByteArray(n); var off = 0
        while (off < n) { val r = i.read(b, off, n - off); if (r < 0) throw IllegalStateException("conexión cerrada"); off += r }
        return b
    }

    private fun readLoop(i: InputStream) {
        var why = "cerrada"
        val msg = ByteArrayOutputStream()
        try {
            while (open) {
                val h0 = i.read(); if (h0 < 0) break
                val h1 = i.read(); if (h1 < 0) break
                val fin = (h0 and 0x80) != 0; val op = h0 and 0x0f
                var len = (h1 and 0x7f).toLong()
                if (len == 126L) { val e = readFully(i, 2); len = ((e[0].toInt() and 0xff) shl 8 or (e[1].toInt() and 0xff)).toLong() }
                else if (len == 127L) { val e = readFully(i, 8); len = 0; for (x in e) len = (len shl 8) or (x.toLong() and 0xff) }
                if (len > 4_000_000) throw IllegalStateException("trama demasiado grande")
                val mask = if ((h1 and 0x80) != 0) readFully(i, 4) else null
                val data = readFully(i, len.toInt())
                if (mask != null) for (k in data.indices) data[k] = (data[k].toInt() xor mask[k % 4].toInt()).toByte()
                when (op) {
                    0x1, 0x0 -> { if (msg.size() + data.size > MAX_MESSAGE) throw IllegalStateException("mensaje demasiado grande"); msg.write(data); if (fin) { val t = msg.toString("UTF-8"); msg.reset(); try { onText(t) } catch (e: Exception) { } } }
                    0x8 -> { why = "el relé cerró"; break }
                    0x9 -> frame(0xA, data)
                    else -> { }
                }
            }
        } catch (e: Throwable) { why = e.message ?: e.javaClass.simpleName }   // también OutOfMemoryError: el hilo no muere sin avisar
        close()
        onClose(why)
    }

    private fun frame(op: Int, payload: ByteArray): Boolean {
        val o = out ?: return false
        synchronized(wlock) {
            try {
                val hdr = ByteArrayOutputStream()
                hdr.write(0x80 or op)
                val n = payload.size
                when {
                    n < 126 -> hdr.write(0x80 or n)
                    n < 65536 -> { hdr.write(0x80 or 126); hdr.write(n shr 8); hdr.write(n and 0xff) }
                    else -> { hdr.write(0x80 or 127); for (k in 7 downTo 0) hdr.write(((n.toLong() shr (8 * k)) and 0xff).toInt()) }
                }
                val mask = ByteArray(4).also { rnd.nextBytes(it) }
                hdr.write(mask)
                val body = ByteArray(n) { (payload[it].toInt() xor mask[it % 4].toInt()).toByte() }
                o.write(hdr.toByteArray()); o.write(body); o.flush()
                return true
            } catch (e: Exception) { return false }
        }
    }

    fun send(text: String): Boolean = open && frame(0x1, text.toByteArray(Charsets.UTF_8))
    fun ping(): Boolean = open && frame(0x9, ByteArray(0))

    fun close() {
        closed = true
        connecting?.let { try { it.close() } catch (e: Exception) { } }   // S-A3: el que está conectando también (parar no espera 15 s)
        connecting = null
        if (!open && sock == null) return
        open = false
        try { frame(0x8, ByteArray(0)) } catch (e: Exception) { }
        try { sock?.close() } catch (e: Exception) { }
        sock = null; out = null
    }
}
