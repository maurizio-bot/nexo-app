import com.nexo.ble.LanBeacon
import com.nexo.ble.NetBg
import com.nexo.ble.Secp256k1
import com.nexo.ble.TorRoute
import com.nexo.ble.WsClient
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

// Auditoría 23-11: decisión 13A («Usar Tor siempre» = relés, toque y buzón por Tor; si Tor no está, se espera), S-A3/T-S1 (WsClient
// con plazos y topes), S-D5 (toque solo al enviador y sin redirecciones; trozo de la bandeja revalidado; nativo solo wss://) y punto 6
// (LanBeacon no barre el grupo de Wi-Fi Direct).
class TorRouteTest {
    // SOCKS5 mínimo: CONNECT por nombre (como Tor) a puertos de esta máquina; apunta qué nombre le pidieron
    class FakeTor {
        val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val asked = CopyOnWriteArrayList<String>()
        val proxy = Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", server.localPort))
        init { Thread { while (!server.isClosed) try { val c = server.accept(); Thread { handle(c) }.start() } catch (e: Exception) {} }.apply { isDaemon = true }.start() }
        private fun handle(c: Socket) {
            val i = DataInputStream(c.getInputStream()); val o = DataOutputStream(c.getOutputStream())
            i.readByte(); val n = i.readByte().toInt(); repeat(n) { i.readByte() }; o.write(byteArrayOf(5, 0))
            i.readByte(); i.readByte(); i.readByte(); val atyp = i.readByte().toInt()
            if (atyp != 3) { asked.add("IP!"); c.close(); return }   // resolvió el nombre fuera de Tor: fuga de DNS
            val len = i.readByte().toInt(); val name = String(ByteArray(len).also { i.readFully(it) }); val port = i.readUnsignedShort()
            asked.add("$name:$port")
            val t = Socket("127.0.0.1", port)
            o.write(byteArrayOf(5, 0, 0, 1, 127, 0, 0, 1, 0, 0)); o.flush()
            Thread { try { t.getInputStream().copyTo(c.getOutputStream()) } catch (e: Exception) {} }.start()
            try { c.getInputStream().copyTo(t.getOutputStream()) } catch (e: Exception) {}
        }
    }
    private fun httpServer(reply: String): ServerSocket {
        val s = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        Thread { while (!s.isClosed) try { val c = s.accept(); Thread { c.use { x -> val i = x.getInputStream().bufferedReader(); while (i.readLine()?.isNotEmpty() == true) {}; x.getOutputStream().write(reply.toByteArray()); x.getOutputStream().flush() } }.start() } catch (e: Exception) {} }.apply { isDaemon = true }.start()
        return s
    }

    @Test fun conTorSiempreNuncaDirecto() {
        TorRoute.always = false; TorRoute.proxy = null
        assertNull(TorRoute.route(), "apagado (de fábrica): directo como siempre")
        TorRoute.always = true
        assertFailsWith<TorRoute.WaitTor> { TorRoute.route() }
        assertTrue(TorRoute.awaitRoute(300).isFailure, "sin Tor listo: se espera, no se sale directo")
        val tor = FakeTor(); TorRoute.proxy = tor.proxy
        assertSame(tor.proxy, TorRoute.route())
        // el toque por Tor: el nombre lo resuelve Tor y NO se siguen redirecciones
        val h = httpServer("HTTP/1.1 302 Found\r\nLocation: https://otro.example/\r\nContent-Length: 0\r\n\r\n")
        assertEquals(302, TorRoute.post("http://localhost:${h.localPort}/wake", "{\"to\":\"x\"}", 5000, TorRoute.route()))
        assertEquals(listOf("localhost:${h.localPort}"), tor.asked.toList())
        TorRoute.always = false; TorRoute.proxy = null
        h.close(); tor.server.close()
    }

    @Test fun toqueSoloAlEnviador() {
        assertTrue(TorRoute.wakeUrlOk("https://${TorRoute.WAKE_HOST}"))
        assertTrue(TorRoute.wakeUrlOk("https://${TorRoute.WAKE_HOST}/wake"))
        assertFalse(TorRoute.wakeUrlOk("https://evil.example/wake"))
        assertFalse(TorRoute.wakeUrlOk("http://${TorRoute.WAKE_HOST}/"))
        assertFalse(TorRoute.wakeUrlOk("https://${TorRoute.WAKE_HOST}.evil.example/"))
    }

    @Test fun wsSoloSeguroYPorTor() {
        assertTrue(WsClient.urlOk("wss://relay.example"))
        assertTrue(WsClient.urlOk("ws://127.0.0.1:7000"))
        assertFalse(WsClient.urlOk("ws://relay.example"), "en claro hacia fuera: no")
        assertFailsWith<IllegalArgumentException> { WsClient("ws://1.2.3.4:80", {}, {}).connect() }
    }

    @Test fun pararCortaLaConexionQueEsperaElSaludo() {
        val silent = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        Thread { try { while (true) silent.accept() } catch (e: Exception) {} }.apply { isDaemon = true }.start()
        val ws = WsClient("ws://127.0.0.1:${silent.localPort}", {}, {})
        var err: Throwable? = null
        val t = Thread { try { ws.connect() } catch (e: Throwable) { err = e } }; t.start()
        Thread.sleep(300)
        val t0 = System.currentTimeMillis(); ws.close(); t.join(3000)
        assertFalse(t.isAlive, "close() corta la espera del saludo"); assertNotNull(err); assertTrue(System.currentTimeMillis() - t0 < 3000)
        silent.close()
    }

    @Test fun cabeceraYMensajeConTope() {
        // una línea de cabecera de 20 KB: error, no se junta sin fin
        val big = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        Thread { try { val c = big.accept(); c.getInputStream().bufferedReader().let { r -> while (r.readLine()?.isNotEmpty() == true) {} }; c.getOutputStream().write(("HTTP/1.1 101 OK\r\nX: " + "a".repeat(20000) + "\r\n\r\n").toByteArray()) } catch (e: Exception) {} }.start()
        val e = assertFails { WsClient("ws://127.0.0.1:${big.localPort}", {}, {}).connect() }
        assertTrue(e.message!!.contains("demasiado larga"), e.message)
        big.close()
        // tramas de continuación que suman más de 4 MB: se corta la conexión (antes se juntaba hasta quedarse sin memoria)
        val cont = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        Thread { try { val c = cont.accept(); c.getInputStream().bufferedReader().let { r -> while (r.readLine()?.isNotEmpty() == true) {} }
            val o = c.getOutputStream(); o.write("HTTP/1.1 101 OK\r\n\r\n".toByteArray())
            val chunk = ByteArray(60000) { 'a'.code.toByte() }
            for (k in 0 until 80) { o.write(byteArrayOf((if (k == 0) 0x01 else 0x00).toByte(), 126.toByte(), (60000 shr 8).toByte(), (60000 and 0xff).toByte())); o.write(chunk) }
            o.flush(); Thread.sleep(2000) } catch (e: Exception) {} }.start()
        var why = ""; val got = CopyOnWriteArrayList<String>()
        val ws = WsClient("ws://127.0.0.1:${cont.localPort}", { got.add(it) }, { why = it })
        ws.connect()
        val t0 = System.currentTimeMillis(); while (why.isEmpty() && System.currentTimeMillis() - t0 < 5000) Thread.sleep(20)
        assertTrue(why.contains("demasiado grande"), why); assertTrue(got.isEmpty())
        cont.close()
    }

    @Test fun trozoDeLaBandejaRevalidado() {
        val sk = Secp256k1.sha256("clave-de-prueba".toByteArray())
        val ev = NetBg.event(sk, 1064, listOf(listOf("expiration", "1900000000")), "QUJDRA==")
        val id = ev.getString("id")
        assertTrue(NetBg.blobChunkOk(ev.toString(), id))
        assertFalse(NetBg.blobChunkOk(ev.toString(), "0".repeat(64)), "otro id del que espera la bandeja")
        val tocado = org.json.JSONObject(ev.toString()).put("content", "QUJDRQ==")
        assertFalse(NetBg.blobChunkOk(tocado.toString(), id), "contenido cambiado: la huella no cuadra")
        val otroTipo = NetBg.event(sk, 1059, listOf(), "x")
        assertFalse(NetBg.blobChunkOk(otroTipo.toString(), otroTipo.getString("id")), "solo trozos (1064)")
    }

    @Test fun noSeBarreElGrupoDeWifiDirect() {
        assertTrue(LanBeacon.skipInterface("p2p-wlan0-0"))
        assertTrue(LanBeacon.skipInterface("p2p0"))
        assertTrue(LanBeacon.skipInterface("tun0"))
        assertFalse(LanBeacon.skipInterface("wlan0"))
        assertFalse(LanBeacon.skipInterface("eth0"))
    }
}
