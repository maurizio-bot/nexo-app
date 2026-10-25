package com.nexo.ble

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
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
 * Latido nativo (v2728+1): cada pingMs un {"h":0,"ts":…} que el otro contesta {"h":2,"ts":…} desde su hilo nativo
 * (no depende de que la app esté en primer plano: en segundo plano Android no ejecuta su JavaScript). Mide el tiempo
 * de ida y vuelta (calidad del Wi-Fi) y cierra la conexión si en deadMs no llega nada.
 * Tor (ronda 2735): la misma pieza sirve para hablar por Tor: proxy = el SOCKS de Tor (las direcciones .onion se
 * resuelven dentro de Tor) y bindHost = 127.0.0.1 (solo Tor entra por el servicio oculto).
 * Ronda 2772 (pantalla apagada): los tiempos se miden con clock (en Android, elapsedRealtime: sigue contando con el
 * teléfono dormido y no salta si se cambia la hora) y el latido sabe que el teléfono durmió (ver tick).
 */
class LanHub(private val myId: () -> String, private val listener: Listener,
             private val pingMs: Long = 4000L, private val deadMs: Long = 30000L,
             private val proxy: Proxy? = null, private val bindHost: InetAddress? = null,
             private val clock: () -> Long = { System.nanoTime() / 1_000_000L },
             private val autoPing: Boolean = true) { // (autoPing = false: sin hilo del latido; las pruebas llaman a tick)
    interface Listener {
        fun onUp(nx: String)
        fun onDown(nx: String)
        fun onMessage(nx: String, text: String)
        fun onLog(level: String, message: String) {}
    }

    companion object {
        const val MAX_FRAME = 48 * 1024 * 1024
        // Auditoría (ronda 2774): el saludo es un JSON diminuto ({"h":1,"nx":"nx········"}, unas decenas de bytes). Se
        // lee con este tope, no con MAX_FRAME: así alguien de la misma red no puede decir que su saludo mide 48 MB para
        // que el teléfono reserve esa memoria de golpe (con varias conexiones así, la app se quedaba sin memoria).
        const val HELLO_MAX = 8192
        // Tope de conexiones a medio saludar (aún sin comprobar quién es). Más de esto = avalancha: se cierra la más
        // vieja sin saludar para dejar sitio (un contacto de verdad saluda en el acto y no se queda en esta cola).
        const val MAX_PREAUTH = 64
        const val CONNECT_TIMEOUT_MS = 5000
        const val TOR_CONNECT_TIMEOUT_MS = 90000 // un circuito hasta un .onion puede tardar
        const val HELLO_TIMEOUT_MS = 8000
        const val WAKE_GRACE_MS = 8000L // ronda 2772: al despertar, margen para que el otro conteste antes de cerrar
    }

    private class Conn(val socket: Socket, val outbound: Boolean) {
        val out = DataOutputStream(BufferedOutputStream(socket.getOutputStream(), 65536))
        @Volatile var nx: String? = null
        @Volatile var lastRx = 0L
        @Volatile var graceUntil = 0L
        @Volatile var rtt = -1L
        fun write(text: String) {
            val b = text.toByteArray(Charsets.UTF_8)
            synchronized(out) { out.writeInt(b.size); out.write(b); out.flush() }
        }
        fun close() { try { socket.close() } catch (e: Exception) {} }
    }

    private var server: ServerSocket? = null
    private val conns = ConcurrentHashMap<String, Conn>() // NEXO ID → conexión en uso
    private val preAuth = java.util.concurrent.ConcurrentLinkedQueue<Conn>() // a medio saludar (aún sin NEXO ID); se acota
    @Volatile private var running = false

    val port: Int get() = server?.localPort ?: 0

    @Synchronized
    fun start(): Int {
        server?.let { return it.localPort }
        val s = if (bindHost != null) ServerSocket(0, 50, bindHost) else ServerSocket(0)
        server = s
        running = true
        if (autoPing) Thread({
            var last = clock()
            while (running) {
                try { Thread.sleep(pingMs) } catch (e: InterruptedException) { break }
                val now = clock()
                tick(now, now - last)
                last = now
            }
        }, "nexo-lan-ping").apply { isDaemon = true }.start()
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
                // Por Tor: la dirección no se resuelve aquí (createUnresolved): el SOCKS de Tor la lleva al .onion
                val sock = if (proxy != null) Socket(proxy) else Socket()
                val addr = if (proxy != null) InetSocketAddress.createUnresolved(host, port) else InetSocketAddress(host, port)
                sock.connect(addr, if (proxy != null) TOR_CONNECT_TIMEOUT_MS else CONNECT_TIMEOUT_MS)
                handle(Conn(sock, true))
            } catch (e: Exception) { listener.onLog("WARN", "conectar $host:$port: ${e.message}") }
        }, "nexo-lan-connect").apply { isDaemon = true }.start()
    }

    /**
     * Una vuelta del latido (la hace el hilo del latido cada pingMs; las pruebas la llaman con horas simuladas): cierra lo
     * que lleva deadMs sin recibir nada y manda un ping a lo demás. Ronda 2772: con la pantalla apagada el teléfono
     * duerme y este hilo no corre (Thread.sleep no avanza dormido), pero clock sí; la vuelta llega mucho más tarde de lo
     * normal (gap) y el silencio puede ser solo eso: antes de cerrar se manda un ping y se espera un margen a que el otro
     * conteste. Antes se cerraban enlaces sanos al despertar.
     */
    fun tick(now: Long, gap: Long) {
        val slept = gap > pingMs * 3
        val grace = maxOf(WAKE_GRACE_MS, pingMs * 2)
        conns.values.toList().forEach { c ->
            val quiet = now - c.lastRx
            if (slept && quiet > deadMs - grace) c.graceUntil = maxOf(c.graceUntil, now + grace)
            if (quiet > deadMs && now >= c.graceUntil) { listener.onLog("INFO", "${c.nx} sin respuesta en ${quiet / 1000} s: se cierra"); drop(c) }
            else try { c.write("{\"h\":0,\"ts\":$now}") } catch (e: Exception) { drop(c) }
        }
    }

    /** Manda un mensaje al contacto. false si no hay conexión (o se acaba de caer). */
    fun send(nx: String, text: String): Boolean {
        val c = conns[nx.lowercase()] ?: return false
        return try { c.write(text); true } catch (e: Exception) { drop(c); false }
    }

    /** Cierra la conexión con ese contacto (la app dejó de recibir de él: Wi-Fi caído sin aviso). */
    fun close(nx: String) { conns[nx.lowercase()]?.let { drop(it) } }

    fun isUp(nx: String): Boolean = conns.containsKey(nx.lowercase())

    /** Calidad de cada conexión: NEXO ID, tiempo de ida y vuelta medio (ms, -1 si aún no hay) y ms sin recibir nada. */
    fun quality(): List<Triple<String, Long, Long>> {
        val now = clock()
        return conns.entries.map { Triple(it.key, it.value.rtt, now - it.value.lastRx) }
    }
    fun peers(): List<String> = conns.keys().toList()
    // Dirección del contacto en la red (archivos grandes: BigFile va por un socket aparte, no por esta conexión)
    fun address(nx: String): InetAddress? = conns[nx.lowercase()]?.socket?.inetAddress

    @Synchronized
    fun stop() {
        running = false
        try { server?.close() } catch (e: Exception) {}
        server = null
        // Se vacía con poll() (no iterando): los hilos de lectura pueden quitar de la cola a la vez y un iterador
        // sobre ella lanzaría NoSuchElementException (visto en CI).
        while (true) { (preAuth.poll() ?: break).close() }
        conns.values.toList().forEach { drop(it) }
    }

    private fun handle(c: Conn) {
        c.lastRx = clock()
        // Mientras no haya saludado va a esta cola acotada. Una avalancha de conexiones que no saludan cierra a las más
        // viejas (antes había un hilo de lectura por conexión, sin tope: miles de conexiones = la app sin memoria).
        preAuth.add(c)
        var evicted = 0
        while (preAuth.size > MAX_PREAUTH) {
            val old = preAuth.poll() ?: break
            if (old === c) { preAuth.add(c); break }
            old.close(); evicted++
        }
        if (evicted > 0) listener.onLog("WARN", "Wi-Fi: $evicted conexión(es) sin saludar cerradas (tope $MAX_PREAUTH)")
        Thread({
            try {
                c.socket.tcpNoDelay = true
                c.socket.soTimeout = if (proxy != null || bindHost != null) HELLO_TIMEOUT_MS * 6 else HELLO_TIMEOUT_MS
                c.write(JSONObject().put("h", 1).put("nx", myId()).toString())
                val input = DataInputStream(BufferedInputStream(c.socket.getInputStream(), 65536))
                val helloStr = readFrame(input, HELLO_MAX)
                if (SafeJson.reject(helloStr)) throw Exception("saludo descomunal") // no dejar que un saludo muy anidado tumbe el analizador
                val hello = JSONObject(helloStr)
                val nx = hello.optString("nx").lowercase()
                if (hello.optInt("h") != 1 || !Regex("^nx[0-9a-z]{8}$").matches(nx) || nx == myId().lowercase()) throw Exception("saludo no válido")
                c.nx = nx
                c.socket.soTimeout = 0
                preAuth.remove(c)
                if (!adopt(nx, c)) { c.close(); return@Thread }
                listener.onUp(nx)
                while (true) {
                    val f = readFrame(input)
                    c.lastRx = clock()
                    if (f.startsWith("{\"h\":0,")) { c.write("{\"h\":2," + f.substring(7)); continue }
                    if (f.startsWith("{\"h\":2,")) {
                        val ts = f.substringAfter("\"ts\":").trimEnd('}').toLongOrNull()
                        if (ts != null) { val r = c.lastRx - ts; c.rtt = if (c.rtt < 0) r else (c.rtt * 3 + r) / 4 }
                        continue
                    }
                    listener.onMessage(nx, f)
                }
            } catch (e: Exception) {
                if (c.nx != null) listener.onLog("INFO", "conexión con ${c.nx} cerrada: ${e.message}")
            } catch (t: Throwable) {
                // Auditoría (ronda 2774): un fallo grave al leer (p. ej. StackOverflowError por un JSON muy anidado que se
                // colara) cierra solo esta conexión; antes mataba toda la app (un Error se escapa de catch(Exception)).
                listener.onLog("WARN", "conexión cerrada por un fallo grave: ${t.message}")
            } finally {
                preAuth.remove(c)
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

    private fun readFrame(input: DataInputStream, max: Int = MAX_FRAME): String {
        val len = input.readInt()
        if (len < 0 || len > max) throw Exception("marco de $len bytes")
        val b = ByteArray(len)
        input.readFully(b)
        return String(b, Charsets.UTF_8)
    }
}
