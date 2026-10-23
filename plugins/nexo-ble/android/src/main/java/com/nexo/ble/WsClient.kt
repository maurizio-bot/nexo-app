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

// Cliente WebSocket mínimo (RFC 6455) para hablar con los relés desde la parte nativa (NetBg): conectar (ws:// o
// wss://), mandar texto, recibir texto, contestar pings. Un hilo lector por conexión; los avisos llegan en ese hilo.
class WsClient(
    private val url: String,
    private val onText: (String) -> Unit,
    private val onClose: (String) -> Unit,
    private val connectTimeoutMs: Int = 15000,
) {
    @Volatile private var sock: Socket? = null
    @Volatile private var out: OutputStream? = null
    @Volatile var open = false; private set
    private val rnd = SecureRandom()
    private val wlock = Any()

    fun connect() {
        val u = URI(url)
        val secure = u.scheme == "wss"
        val host = u.host
        val port = if (u.port > 0) u.port else if (secure) 443 else 80
        val raw = Socket()
        raw.connect(InetSocketAddress(host, port), connectTimeoutMs)
        val s: Socket = if (secure) {
            (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(raw, host, port, true).also {
                val ssl = it as SSLSocket
                val p = ssl.sslParameters; p.serverNames = listOf(SNIHostName(host)); p.endpointIdentificationAlgorithm = "HTTPS"; ssl.sslParameters = p
                ssl.startHandshake()
            }
        } else raw
        s.soTimeout = 0
        val key = ByteArray(16).also { rnd.nextBytes(it) }.let { Base64.getEncoder().encodeToString(it) }
        val path = (u.rawPath ?: "").ifEmpty { "/" } + (if (u.rawQuery != null) "?" + u.rawQuery else "")
        val req = "GET $path HTTP/1.1\r\nHost: $host${if (u.port > 0) ":$port" else ""}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            "Sec-WebSocket-Key: $key\r\nSec-WebSocket-Version: 13\r\nUser-Agent: NEXO\r\n\r\n"
        val o = s.getOutputStream(); o.write(req.toByteArray()); o.flush()
        val inp = BufferedInputStream(s.getInputStream())
        val status = readLine(inp)
        if (!status.startsWith("HTTP/1.1 101")) { try { s.close() } catch (e: Exception) { }; throw IllegalStateException("el relé no aceptó: $status") }
        while (readLine(inp).isNotEmpty()) { }
        sock = s; out = o; open = true
        Thread({ readLoop(inp) }, "nexo-ws").apply { isDaemon = true }.start()
    }

    private fun readLine(i: InputStream): String {
        val b = ByteArrayOutputStream()
        while (true) {
            val c = i.read()
            if (c < 0) throw IllegalStateException("conexión cerrada")
            if (c == '\n'.code) break
            if (c != '\r'.code) b.write(c)
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
                    0x1, 0x0 -> { msg.write(data); if (fin) { val t = msg.toString("UTF-8"); msg.reset(); try { onText(t) } catch (e: Exception) { } } }
                    0x8 -> { why = "el relé cerró"; break }
                    0x9 -> frame(0xA, data)
                    else -> { }
                }
            }
        } catch (e: Exception) { why = e.message ?: "error" }
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
        if (!open && sock == null) return
        open = false
        try { frame(0x8, ByteArray(0)) } catch (e: Exception) { }
        try { sock?.close() } catch (e: Exception) { }
        sock = null; out = null
    }
}
