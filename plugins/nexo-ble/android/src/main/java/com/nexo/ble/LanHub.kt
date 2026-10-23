package com.nexo.ble

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

/**
 * Wi-Fi normal (misma red): conexiones TCP entre teléfonos NEXO. Sin dependencias de Android (se prueba en JVM,
 * tests/kotlin); el descubrimiento (NSD) y los avisos a la app los pone NexoBlePlugin.
 *
 * Cada mensaje es un marco [longitud int32][texto UTF-8] con el mismo JSON que viaja por Bluetooth (ya cifrado de
 * extremo a extremo por la app). El primer marco de cada lado es el saludo {"h":1,"nx":"<NEXO ID>"}: la conexión
 * queda asociada a ese NEXO ID. La app no la usa hasta comprobarla con el cifrado (solo el contacto de verdad puede
 * responder), así que un saludo falso no sirve para leer ni para suplantar.
 * Si los dos se conectan a la vez queda una sola conexión: la que abrió el de NEXO ID menor.
 */
class LanHub(private val myId: () -> String, private val listener: Listener) {
    interface Listener {
        fun onUp(nx: String)
        fun onDown(nx: String)
        fun onMessage(nx: String, text: String)
        fun onLog(level: String, message: String) {}
    }

    companion object {
        const val MAX_FRAME = 48 * 1024 * 1024
        const val CONNECT_TIMEOUT_MS = 5000
        const val HELLO_TIMEOUT_MS = 8000
    }

    private class Conn(val socket: Socket, val outbound: Boolean) {
        val out = DataOutputStream(BufferedOutputStream(socket.getOutputStream(), 65536))
        @Volatile var nx: String? = null
        fun write(text: String) {
            val b = text.toByteArray(Charsets.UTF_8)
            synchronized(out) { out.writeInt(b.size); out.write(b); out.flush() }
        }
        fun close() { try { socket.close() } catch (e: Exception) {} }
    }

    private var server: ServerSocket? = null
    private val conns = ConcurrentHashMap<String, Conn>() // NEXO ID → conexión en uso
    @Volatile private var running = false

    val port: Int get() = server?.localPort ?: 0

    @Synchronized
    fun start(): Int {
        server?.let { return it.localPort }
        val s = ServerSocket(0)
        server = s
        running = true
        Thread({
            while (running && !s.isClosed) {
                try { val sock = s.accept(); handle(Conn(sock, false)) } catch (e: Exception) { if (running) listener.onLog("WARN", "accept: ${e.message}") }
            }
        }, "nexo-lan-accept").apply { isDaemon = true }.start()
        return s.localPort
    }

    fun connect(host: String, port: Int) {
        Thread({
            try {
                val sock = Socket()
                sock.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)
                handle(Conn(sock, true))
            } catch (e: Exception) { listener.onLog("WARN", "conectar $host:$port: ${e.message}") }
        }, "nexo-lan-connect").apply { isDaemon = true }.start()
    }

    /** Manda un mensaje al contacto. false si no hay conexión (o se acaba de caer). */
    fun send(nx: String, text: String): Boolean {
        val c = conns[nx.lowercase()] ?: return false
        return try { c.write(text); true } catch (e: Exception) { drop(c); false }
    }

    /** Cierra la conexión con ese contacto (la app dejó de recibir de él: Wi-Fi caído sin aviso). */
    fun close(nx: String) { conns[nx.lowercase()]?.let { drop(it) } }

    fun isUp(nx: String): Boolean = conns.containsKey(nx.lowercase())
    fun peers(): List<String> = conns.keys().toList()

    @Synchronized
    fun stop() {
        running = false
        try { server?.close() } catch (e: Exception) {}
        server = null
        conns.values.toList().forEach { drop(it) }
    }

    private fun handle(c: Conn) {
        Thread({
            try {
                c.socket.tcpNoDelay = true
                c.socket.soTimeout = HELLO_TIMEOUT_MS
                c.write(JSONObject().put("h", 1).put("nx", myId()).toString())
                val input = DataInputStream(BufferedInputStream(c.socket.getInputStream(), 65536))
                val hello = JSONObject(readFrame(input))
                val nx = hello.optString("nx").lowercase()
                if (hello.optInt("h") != 1 || !Regex("^nx[0-9a-z]{8}$").matches(nx) || nx == myId().lowercase()) throw Exception("saludo no válido")
                c.nx = nx
                c.socket.soTimeout = 0
                if (!adopt(nx, c)) { c.close(); return@Thread }
                listener.onUp(nx)
                while (true) listener.onMessage(nx, readFrame(input))
            } catch (e: Exception) {
                if (c.nx != null) listener.onLog("INFO", "conexión con ${c.nx} cerrada: ${e.message}")
            } finally {
                drop(c)
            }
        }, "nexo-lan-read").apply { isDaemon = true }.start()
    }

    // ¿Esta conexión es la que se queda? Con dos a la vez, la que abrió el de NEXO ID menor
    @Synchronized
    private fun adopt(nx: String, c: Conn): Boolean {
        val old = conns[nx]
        if (old != null && old !== c && !old.socket.isClosed) {
            val keepNew = (c.outbound == (myId().lowercase() < nx))
            if (!keepNew) return false
            conns[nx] = c
            old.close()
            return true
        }
        conns[nx] = c
        return true
    }

    private fun drop(c: Conn) {
        c.close()
        val nx = c.nx ?: return
        val removed = synchronized(this) { if (conns[nx] === c) { conns.remove(nx); true } else false }
        if (removed) listener.onDown(nx)
    }

    private fun readFrame(input: DataInputStream): String {
        val len = input.readInt()
        if (len < 0 || len > MAX_FRAME) throw Exception("marco de $len bytes")
        val b = ByteArray(len)
        input.readFully(b)
        return String(b, Charsets.UTF_8)
    }
}
