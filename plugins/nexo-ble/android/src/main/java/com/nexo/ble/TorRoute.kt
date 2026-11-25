package com.nexo.ble

import java.io.BufferedInputStream
import java.io.File
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket
import java.net.URI
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

// Decisión 13A del dueño (23-11, T-X1): con «Usar Tor siempre» activado, TODO lo de internet sale por Tor: los WebSocket a los relés
// (los de la app pasan por aquí con torConnect{url}; los de la escucha nativa, NetBg), el «toque» (wakePost) y las bajadas del buzón
// (van por esos mismos WebSocket). Si Tor aún no está listo se ESPERA: nunca se sale directo (eso delataría la IP justo cuando el
// usuario pidió ocultarla). Viene apagado de fábrica: con él apagado nada cambia (proxy = null → conexión directa como siempre).
// Sin Android (se prueba en la JVM: TorRouteTest).
object TorRoute {
    const val FILE = "nexo_tor_always"
    // Auditoría 23-11 (S-D5): el toque solo va a NUESTRO enviador (host fijo) y sin seguir redirecciones
    const val WAKE_HOST = "nexo-wake.maurizioamistani.workers.dev"

    @Volatile var always = false          // «Usar Tor siempre» (lo pone la app con torStart{always}/torStop; se guarda para sin la app)
    @Volatile var proxy: Proxy? = null    // el SOCKS de Tor cuando está listo (PluginTor); null = aún no

    fun load(dir: File) { always = try { File(dir, FILE).readText().trim() == "1" } catch (e: Exception) { false } }
    fun save(dir: File, on: Boolean) {
        always = on
        try { if (on) File(dir, FILE).writeText("1") else File(dir, FILE).delete() } catch (e: Exception) { }
    }

    // ¿Se puede salir a internet ahora? Con Tor siempre, solo con el SOCKS listo. Devuelve el proxy a usar (null = directo) o
    // lanza WaitTor si hay que esperar.
    class WaitTor : Exception("esperando a Tor (Usar Tor siempre)")
    fun route(): Proxy? { val p = proxy; if (always && p == null) throw WaitTor(); return if (always) p else null }

    // Espera (como mucho ms) a poder salir; null si hay que seguir esperando
    fun awaitRoute(ms: Long, now: () -> Long = System::currentTimeMillis): Result<Proxy?> {
        val until = now() + ms
        while (true) {
            try { return Result.success(route()) } catch (e: WaitTor) { if (now() >= until) return Result.failure(e) }
            try { Thread.sleep(250) } catch (e: InterruptedException) { return Result.failure(WaitTor()) }
        }
    }

    // Una conexión TCP a host:port, directa o por el SOCKS de Tor. Por Tor el nombre NO se resuelve aquí (createUnresolved): lo
    // resuelve Tor en la salida (sin fuga de DNS). Plazo de conexión connectMs.
    fun socket(host: String, port: Int, connectMs: Int, via: Proxy?): Socket {
        val s = if (via != null) Socket(via) else Socket()
        try {
            s.connect(if (via != null) InetSocketAddress.createUnresolved(host, port) else InetSocketAddress(host, port), connectMs)
        } catch (e: Throwable) { try { s.close() } catch (x: Exception) { }; throw e }
        return s
    }

    // TLS sobre una conexión ya abierta, con SNI y comprobación del nombre del certificado
    fun tls(raw: Socket, host: String, port: Int): SSLSocket {
        val ssl = (SSLSocketFactory.getDefault() as SSLSocketFactory).createSocket(raw, host, port, true) as SSLSocket
        val p = ssl.sslParameters; p.serverNames = listOf(SNIHostName(host)); p.endpointIdentificationAlgorithm = "HTTPS"; ssl.sslParameters = p
        ssl.startHandshake()
        return ssl
    }

    // S-D5: dirección del toque válida = https al enviador (o http a esta misma máquina, solo para las pruebas)
    fun wakeUrlOk(url: String): Boolean = try {
        val u = URI(url)
        (u.scheme == "https" && u.host == WAKE_HOST) || (u.scheme == "http" && (u.host == "127.0.0.1" || u.host == "localhost"))
    } catch (e: Exception) { false }

    // POST mínimo (HTTP/1.1, Connection: close) que NO sigue redirecciones: devuelve el código de respuesta. Plazo timeoutMs para
    // conectar, saludo TLS y respuesta.
    fun post(url: String, body: String, timeoutMs: Int, via: Proxy?): Int {
        val u = URI(url)
        val secure = u.scheme == "https"
        val host = u.host ?: throw IllegalArgumentException("sin host")
        val port = if (u.port > 0) u.port else if (secure) 443 else 80
        val raw = socket(host, port, timeoutMs, via)
        raw.soTimeout = timeoutMs
        val s: Socket = try { if (secure) tls(raw, host, port) else raw } catch (e: Throwable) { try { raw.close() } catch (x: Exception) { }; throw e }
        s.use {
            val b = body.toByteArray(Charsets.UTF_8)
            val path = (u.rawPath ?: "").ifEmpty { "/" } + (if (u.rawQuery != null) "?" + u.rawQuery else "")
            val req = "POST $path HTTP/1.1\r\nHost: $host${if (u.port > 0) ":$port" else ""}\r\nContent-Type: text/plain;charset=UTF-8\r\n" +
                "Content-Length: ${b.size}\r\nConnection: close\r\nUser-Agent: NEXO\r\n\r\n"
            val o = it.getOutputStream(); o.write(req.toByteArray(Charsets.US_ASCII)); o.write(b); o.flush()
            val inp = BufferedInputStream(it.getInputStream())
            val line = StringBuilder()
            while (line.length < 200) { val c = inp.read(); if (c < 0 || c == '\n'.code) break; if (c != '\r'.code) line.append(c.toChar()) }
            val m = Regex("^HTTP/1\\.[01] (\\d{3})").find(line) ?: throw IllegalStateException("respuesta no válida")
            return m.groupValues[1].toInt()
        }
    }
}
