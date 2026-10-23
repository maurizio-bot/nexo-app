package com.nexo.ble

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap

/**
 * Wi-Fi normal: escaneo activo de la red local (idea del dueño, ronda 2733). Sin dependencias de Android (se prueba
 * en JVM, tests/kotlin); lo arranca NexoBlePlugin junto a LanHub.
 *
 * El anuncio NSD/mDNS (Bonjour) no siempre llega: muchos routers, repetidores y redes en malla filtran el tráfico
 * multicast entre teléfonos. Por eso, al conectarse al Wi-Fi (y cada vez que la app vuelve a buscar), el teléfono
 * pregunta a toda la red "¿hay algún NEXO?":
 *  - un paquete UDP a la dirección de difusión de la red (y a 255.255.255.255), y
 *  - uno a cada dirección de la red (hasta /22, 1022 direcciones), por si el router filtra también la difusión.
 * Pregunta: "NXQ1|<marca del día>|<puerto TCP>"; quien la recibe contesta a quien preguntó "NXA1|<marca>|<puerto>".
 * Los dos avisan a la app (onPeer) con la marca, la dirección y el puerto: la app solo conecta si la marca es de un
 * contacto (la misma marca del día que en NSD) y comprueba la conexión con el cifrado. Nadie más sabe quién es.
 */
class LanBeacon(private val listener: Listener, private val udpPort: Int = PORT) {
    interface Listener {
        fun onPeer(token: String, host: String, port: Int)
        fun onLog(level: String, message: String) {}
    }

    companion object {
        const val PORT = 47824
        const val MAX_SWEEP_PREFIX = 22
        private val TOKEN_RE = Regex("^[0-9a-f]{16}$")
    }

    @Volatile private var token = ""
    @Volatile private var tcpPort = 0
    private var socket: DatagramSocket? = null
    @Volatile private var running = false
    private val lastSeen = ConcurrentHashMap<String, Long>() // "marca|host|puerto" → cuándo se avisó (no repetir)

    val localPort: Int get() = socket?.localPort ?: 0

    @Synchronized
    fun start(token: String, tcpPort: Int) {
        this.token = token
        this.tcpPort = tcpPort
        if (socket != null) return
        val s = try { DatagramSocket(null).apply { reuseAddress = true; broadcast = true; bind(InetSocketAddress(udpPort)) } }
            catch (e: Exception) { listener.onLog("WARN", "escaneo: puerto $udpPort ocupado (${e.message})"); return }
        socket = s
        running = true
        Thread({
            val buf = ByteArray(256)
            while (running && !s.isClosed) {
                try {
                    val p = DatagramPacket(buf, buf.size)
                    s.receive(p)
                    handle(String(p.data, 0, p.length, Charsets.UTF_8), p.address, p.port)
                } catch (e: Exception) { if (running) listener.onLog("WARN", "escaneo: ${e.message}") }
            }
        }, "nexo-lan-beacon").apply { isDaemon = true }.start()
    }

    @Synchronized
    fun stop() {
        running = false
        try { socket?.close() } catch (e: Exception) {}
        socket = null
    }

    /** Pregunta a la red. sweep: también una a una a cada dirección (al unirse a una red o al volver a la app). */
    fun scan(sweep: Boolean) {
        val s = socket ?: return
        if (token.isEmpty()) return
        val msg = "NXQ1|$token|$tcpPort".toByteArray(Charsets.UTF_8)
        Thread({
            val targets = LinkedHashSet<InetAddress>()
            targets.add(InetAddress.getByName("255.255.255.255"))
            val nets = localNets()
            nets.forEach { (addr, prefix, bcast) ->
                bcast?.let { targets.add(it) }
                if (sweep && prefix >= MAX_SWEEP_PREFIX && prefix <= 30) targets.addAll(hostsOf(addr, prefix))
            }
            var n = 0
            targets.forEach { t ->
                try { s.send(DatagramPacket(msg, msg.size, t, udpPort)); n++ } catch (e: Exception) {}
                if (n % 64 == 0) try { Thread.sleep(5) } catch (e: InterruptedException) {}
            }
            listener.onLog("INFO", "escaneo de la red: $n preguntas (${nets.size} red(es)${if (sweep) ", una a una" else ""})")
        }, "nexo-lan-scan").apply { isDaemon = true }.start()
    }

    /** Pregunta a direcciones concretas (pruebas; o una dirección conocida). */
    fun probe(targets: List<InetSocketAddress>) {
        val s = socket ?: return
        val msg = "NXQ1|$token|$tcpPort".toByteArray(Charsets.UTF_8)
        targets.forEach { t -> try { s.send(DatagramPacket(msg, msg.size, t)) } catch (e: Exception) {} }
    }

    internal fun handle(text: String, from: InetAddress, fromPort: Int) {
        val f = text.split('|')
        if (f.size != 3 || (f[0] != "NXQ1" && f[0] != "NXA1")) return
        val t = f[1]
        val port = f[2].toIntOrNull() ?: return
        if (!TOKEN_RE.matches(t) || t == token || port !in 1..65535) return
        val host = from.hostAddress ?: return
        // Contestar a una pregunta (aunque ya lo conozcamos: el otro puede haberse reiniciado)
        if (f[0] == "NXQ1" && token.isNotEmpty()) {
            val reply = "NXA1|$token|$tcpPort".toByteArray(Charsets.UTF_8)
            try { socket?.send(DatagramPacket(reply, reply.size, from, fromPort)) } catch (e: Exception) {}
        }
        val key = "$t|$host|$port"
        val now = System.currentTimeMillis()
        if (now - (lastSeen[key] ?: 0L) < 10000L) return
        lastSeen[key] = now
        if (lastSeen.size > 500) lastSeen.entries.removeIf { now - it.value > 60000L }
        listener.onPeer(t, host, port)
    }

    // Redes IPv4 locales (Wi-Fi): dirección, prefijo y difusión. Sin las de loopback ni las de datos móviles
    private fun localNets(): List<Triple<Inet4Address, Int, InetAddress?>> {
        val out = ArrayList<Triple<Inet4Address, Int, InetAddress?>>()
        try {
            NetworkInterface.getNetworkInterfaces()?.toList()?.forEach { ni ->
                if (!ni.isUp || ni.isLoopback || ni.isVirtual) return@forEach
                val name = ni.name.lowercase()
                if (name.startsWith("rmnet") || name.startsWith("ccmni") || name.startsWith("tun") || name.startsWith("dummy")) return@forEach
                ni.interfaceAddresses.forEach { ia ->
                    val a = ia.address
                    if (a is Inet4Address && a.isSiteLocalAddress) out.add(Triple(a, ia.networkPrefixLength.toInt(), ia.broadcast))
                }
            }
        } catch (e: Exception) {}
        return out
    }

    internal fun hostsOf(addr: Inet4Address, prefix: Int): List<InetAddress> {
        val b = addr.address
        val ip = ((b[0].toInt() and 255) shl 24) or ((b[1].toInt() and 255) shl 16) or ((b[2].toInt() and 255) shl 8) or (b[3].toInt() and 255)
        val mask = if (prefix == 0) 0 else (-1 shl (32 - prefix))
        val net = ip and mask
        val count = (1 shl (32 - prefix)) - 2
        val out = ArrayList<InetAddress>(maxOf(0, count))
        for (i in 1..count) {
            val h = net + i
            if (h == ip) continue
            out.add(InetAddress.getByAddress(byteArrayOf((h ushr 24).toByte(), (h ushr 16).toByte(), (h ushr 8).toByte(), h.toByte())))
        }
        return out
    }
}
