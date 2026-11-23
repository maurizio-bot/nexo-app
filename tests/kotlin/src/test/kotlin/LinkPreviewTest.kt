import com.nexo.ble.LinkPreview
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

// COLA 31 (dueño 23-11): vista previa REAL de enlaces bajada por quien recibe, por Tor. Lo puro: lectura de la página (og:, comentarios,
// scripts, entidades, marcas de dirección), validación de URL y redirecciones, otro circuito si el sitio rechaza, topes de imagen,
// SOCKS5 con usuario (circuito aislado) y el nombre sin resolver (sin fuga de DNS), sin cookies.
class LinkPreviewTest {
    // «Internet» de mentira: un servidor HTTP que responde según Host + ruta; apunta cada petición (cabeceras incluidas)
    class Web {
        val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val routes = HashMap<String, MutableList<String>>()   // "host/ruta" → respuestas (se van gastando; la última se repite)
        val reqs = CopyOnWriteArrayList<String>()
        init { Thread { while (!server.isClosed) try { val c = server.accept(); Thread { handle(c) }.start() } catch (e: Exception) {} }.apply { isDaemon = true }.start() }
        fun on(key: String, vararg resp: String) { routes[key] = resp.toMutableList() }
        private fun handle(c: Socket) = c.use {
            val i = c.getInputStream().bufferedReader(Charsets.ISO_8859_1)
            val first = i.readLine() ?: return
            val head = StringBuilder(first)
            var host = ""
            while (true) { val l = i.readLine() ?: break; if (l.isEmpty()) break; head.append("\n").append(l); if (l.lowercase().startsWith("host:")) host = l.substring(5).trim() }
            reqs.add(head.toString())
            val path = first.split(" ")[1]
            val list = routes["$host$path"]
            val resp = if (list == null) "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n" else if (list.size > 1) list.removeAt(0) else list[0]
            c.getOutputStream().write(resp.toByteArray(Charsets.UTF_8)); c.getOutputStream().flush()
        }
    }
    // SOCKS5 como Tor: exige usuario/contraseña (circuito), CONNECT por NOMBRE; todo va al servidor Web de arriba
    class FakeTor(private val web: Web) {
        val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
        val asked = CopyOnWriteArrayList<String>()   // "usuario|nombre:puerto"
        val addr = InetSocketAddress("127.0.0.1", server.localPort)
        init { Thread { while (!server.isClosed) try { val c = server.accept(); Thread { handle(c) }.start() } catch (e: Exception) {} }.apply { isDaemon = true }.start() }
        private fun handle(c: Socket) {
            val i = DataInputStream(c.getInputStream()); val o = DataOutputStream(c.getOutputStream())
            i.readByte(); val n = i.readByte().toInt(); val m = ByteArray(n).also { i.readFully(it) }
            if (!m.contains(2)) { o.write(byteArrayOf(5, 0xFF.toByte())); c.close(); return }
            o.write(byteArrayOf(5, 2))
            i.readByte(); val ul = i.readUnsignedByte(); val user = String(ByteArray(ul).also { i.readFully(it) }); val pl = i.readUnsignedByte(); i.readFully(ByteArray(pl))
            o.write(byteArrayOf(1, 0))
            i.readByte(); i.readByte(); i.readByte(); val atyp = i.readByte().toInt()
            if (atyp != 3) { asked.add("$user|IP!"); c.close(); return }
            val len = i.readUnsignedByte(); val name = String(ByteArray(len).also { i.readFully(it) }); val port = i.readUnsignedShort()
            asked.add("$user|$name:$port")
            if (name == "caido.example") { o.write(byteArrayOf(5, 4, 0, 1, 0, 0, 0, 0, 0, 0)); c.close(); return }
            val t = Socket("127.0.0.1", web.server.localPort)
            o.write(byteArrayOf(5, 0, 0, 1, 127, 0, 0, 1, 0, 0)); o.flush()
            Thread { try { t.getInputStream().copyTo(c.getOutputStream()) } catch (e: Exception) {}; try { c.close() } catch (e: Exception) {} }.start()
            try { c.getInputStream().copyTo(t.getOutputStream()) } catch (e: Exception) {}
        }
    }
    private fun html(body: String, extra: String = "") = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n${extra}Content-Length: ${body.toByteArray().size}\r\nConnection: close\r\n\r\n$body"
    private fun fetcher(tor: FakeTor) = LinkPreview.Fetcher({ h, p, c -> LinkPreview.socks5(tor.addr, h, p, c, 5000) }, { s, _, _ -> s }, 5000)

    @Test fun lecturaDeLaPagina() {
        val page = """<html><head>
            <!-- <meta property="og:title" content="FALSO EN COMENTARIO"> -->
            <script>document.write('<meta property="og:title" content="FALSO EN SCRIPT">')</script>
            <style>meta{}</style>
            <title>Título de respaldo</title>
            <meta content='https://cdn.example.com/i.jpg?a=1&amp;b=2' property='og:image'>
            <meta property="og:title" content="Gato &amp; perro &#8212; &#x1F431; &quot;real&quot; &#x202E;gnp.exe">
            <meta property="og:title" content="segundo (se ignora)">
            </head><body></body></html>"""
        val (t, img) = LinkPreview.parseHead(page)
        assertEquals("Gato & perro — 🐱 \"real\" gnp.exe", t)   // sin la marca U+202E (texto al revés)
        assertEquals("https://cdn.example.com/i.jpg?a=1&b=2", img)
        assertEquals(Pair("Título de respaldo", ""), LinkPreview.parseHead("<head><title>\n  Título   de\trespaldo </title></head>"))
        assertEquals(Pair("", ""), LinkPreview.parseHead("<script><meta property=\"og:title\" content=\"x\"></script><!-- sin cerrar <title>y</title>"))
        assertEquals(Pair("", ""), LinkPreview.parseHead("<head><meta property=\"og:title\" content=\"​‮ \"></head>"))
        assertEquals(LinkPreview.MAX_TITLE, LinkPreview.cleanText("a".repeat(5000)).length)
        assertTrue(LinkPreview.isChallenge("Just a moment..."))
        assertEquals(Pair("Mi vídeo", "https://i.ytimg.com/vi/x/hq.jpg"), LinkPreview.parseOembed("{\"title\":\"Mi vídeo\",\"thumbnail_url\":\"https://i.ytimg.com/vi/x/hq.jpg\"}"))
        assertEquals(Pair("", ""), LinkPreview.parseOembed("<html>no json"))
    }

    @Test fun direccionesYDominios() {
        assertNotNull(LinkPreview.startUri("https://vm.tiktok.com/ZMabc/"))
        for (bad in listOf("http://tiktok.com/", "https://127.0.0.1/", "https://localhost/", "https://[::1]/", "https://abc.onion/", "https://router.local/",
            "https://www.tiktok.com@malo.com/", "https://tiktok.com:8443/", "javascript:alert(1)", "https://x/", "https://" + "a".repeat(2100) + ".com/"))
            assertNull(LinkPreview.startUri(bad), bad)
        assertTrue(LinkPreview.sameSite("vm.tiktok.com", "www.tiktok.com"))
        assertTrue(LinkPreview.sameSite("youtu.be", "www.youtube.com"))
        assertTrue(LinkPreview.sameSite("fb.watch", "m.facebook.com"))
        assertFalse(LinkPreview.sameSite("bit.ly", "malo.com"))
        assertFalse(LinkPreview.sameSite("tiktok.com", "tiktok.com.malo.com"))
        assertFalse(LinkPreview.sameSite("a.co.uk", "b.co.uk"))
        assertTrue(LinkPreview.sameSite("www.ejemplo.com.mx", "ejemplo.com.mx"))
        assertNull(LinkPreview.imageUri(URI("https://a.com/p"), "http://a.com/i.jpg"))
        assertNull(LinkPreview.imageUri(URI("https://a.com/p"), "https://10.0.0.1/i.jpg"))
        assertEquals("https://a.com/img/i.jpg", LinkPreview.imageUri(URI("https://a.com/p/x"), "/img/i.jpg").toString())
    }

    @Test fun medidasDeImagen() {
        assertFalse(LinkPreview.imageDimsOk(20000, 20000))   // 400 Mpx declarados: bomba
        assertFalse(LinkPreview.imageDimsOk(0, 10))
        assertTrue(LinkPreview.imageDimsOk(4000, 3000))
        assertEquals(8, LinkPreview.sampleSize(4000, 3000))   // 4000/8 = 500 ≥ 480
        assertEquals(1, LinkPreview.sampleSize(300, 200))
        assertEquals(Pair(480, 360), LinkPreview.fitSize(500, 375))
        assertEquals(Pair(300, 200), LinkPreview.fitSize(300, 200))
    }

    @Test fun vistaPreviaPorTor() {
        val web = Web(); val tor = FakeTor(web)
        web.on("vm.tiktok.com/ZMabc/", "HTTP/1.1 301 Moved\r\nLocation: https://www.tiktok.com/@ana/video/1\r\nSet-Cookie: id=secreto\r\nContent-Length: 0\r\n\r\n")
        web.on("www.tiktok.com/@ana/video/1", html("<head><meta property=\"og:title\" content=\"Baile de Ana\"><meta property=\"og:image\" content=\"/i/1.jpg\"></head>"))
        val r = fetcher(tor).preview("https://vm.tiktok.com/ZMabc/")
        assertEquals("ok", r.status); assertEquals("Baile de Ana", r.title); assertEquals("https://www.tiktok.com/i/1.jpg", r.imageUrl); assertEquals("vm.tiktok.com", r.host)
        assertTrue(tor.asked.all { it.startsWith("nexo-prev-") && !it.contains("IP!") }, tor.asked.toString())   // por nombre: sin fuga de DNS
        assertTrue(tor.asked.map { it.substringBefore('|') }.toSet().size == 1)   // mismo circuito en la misma vista previa
        assertTrue(web.reqs.none { it.lowercase().contains("cookie") }, "nunca se manda una cookie")
        assertTrue(web.reqs.all { it.contains("User-Agent: ${LinkPreview.UA}") && !it.lowercase().contains("accept-language") })
    }

    @Test fun redireccionAOtroDominio() {
        val web = Web(); val tor = FakeTor(web)
        web.on("bit.ly/x", "HTTP/1.1 302 Found\r\nLocation: https://malo.example.net/robar\r\nContent-Length: 0\r\n\r\n")
        web.on("malo.example.net/robar", html("<head><meta property=\"og:title\" content=\"NO DEBE LEERSE\"></head>"))
        val r = fetcher(tor).preview("https://bit.ly/x")
        assertEquals("redirige", r.status); assertEquals("malo.example.net", r.to); assertEquals("", r.title)
        assertTrue(web.reqs.none { it.contains("Host: malo.example.net") }, "el otro dominio ni se visita")
        web.on("www.tiktok.com/b", "HTTP/1.1 302 Found\r\nLocation: http://www.tiktok.com/c\r\nContent-Length: 0\r\n\r\n")
        assertEquals("sin_datos", fetcher(tor).preview("https://www.tiktok.com/b").status)   // bajar a http: no
    }

    @Test fun rechazaYOtroCircuito() {
        val web = Web(); val tor = FakeTor(web)
        web.on("www.instagram.com/reel/1/", "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n", html("<head><meta property=\"og:title\" content=\"Reel\"></head>"))
        val r = fetcher(tor).preview("https://www.instagram.com/reel/1/")
        assertEquals("ok", r.status); assertEquals("Reel", r.title)
        assertEquals(2, tor.asked.map { it.substringBefore('|') }.toSet().size, "el reintento va por OTRO circuito")
        web.on("www.facebook.com/v", "HTTP/1.1 429 Too Many\r\nContent-Length: 0\r\n\r\n")
        assertEquals("rechaza", fetcher(tor).preview("https://www.facebook.com/v").status)
        web.on("www.facebook.com/c", html("<head><title>Just a moment...</title></head>"))
        assertEquals("rechaza", fetcher(tor).preview("https://www.facebook.com/c").status)   // anti-robot: nunca como vista previa
        assertEquals("red", fetcher(tor).preview("https://caido.example/x").status)
        web.on("www.tiktok.com/vacio", html("<head></head><body>sin título</body>"))
        assertEquals("sin_datos", fetcher(tor).preview("https://www.tiktok.com/vacio").status)
    }

    @Test fun troceadoYYouTube() {
        val web = Web(); val tor = FakeTor(web)
        val body = "<head><meta property=\"og:title\" content=\"Troceado\"></head>"
        web.on("ejemplo.com/t", "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nTransfer-Encoding: chunked\r\n\r\n" +
            Integer.toHexString(10) + "\r\n" + body.substring(0, 10) + "\r\n" + Integer.toHexString(body.length - 10) + "\r\n" + body.substring(10) + "\r\n0\r\n\r\n")
        assertEquals("Troceado", fetcher(tor).preview("https://ejemplo.com/t").title)
        val oe = "/oembed?format=json&url=" + java.net.URLEncoder.encode("https://youtu.be/dQw4w9WgXcQ", "UTF-8")
        val json = "{\"title\":\"Canción\",\"thumbnail_url\":\"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg\"}"
        web.on("www.youtube.com$oe", "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${json.toByteArray().size}\r\n\r\n$json")
        val y = fetcher(tor).preview("https://youtu.be/dQw4w9WgXcQ")
        assertEquals("ok", y.status); assertEquals("Canción", y.title); assertEquals("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", y.imageUrl); assertEquals("youtu.be", y.host)
        web.on("www.youtube.com" + "/oembed?format=json&url=" + java.net.URLEncoder.encode("https://youtu.be/borrado", "UTF-8"), "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
        assertEquals("sin_datos", fetcher(tor).preview("https://youtu.be/borrado").status)
    }

    @Test fun topesDeImagen() {
        val web = Web(); val tor = FakeTor(web)
        web.on("cdn.example.com/ok.jpg", "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: 4\r\n\r\nJPEG")
        web.on("cdn.example.com/enorme.jpg", "HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Length: 999999999\r\n\r\nJPEG")
        web.on("cdn.example.com/x.svg", "HTTP/1.1 200 OK\r\nContent-Type: image/svg+xml\r\nContent-Length: 6\r\n\r\n<svg/>")
        web.on("cdn.example.com/html", html("<script>alert(1)</script>"))
        web.on("cdn.example.com/r", "HTTP/1.1 302 Found\r\nLocation: https://otro-cdn.example.org/ok.jpg\r\nContent-Length: 0\r\n\r\n")
        web.on("otro-cdn.example.org/ok.jpg", "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\nPNG")
        val f = fetcher(tor)
        assertEquals("JPEG", String(f.image("https://cdn.example.com/ok.jpg")!!))
        assertNull(f.image("https://cdn.example.com/enorme.jpg"))
        assertNull(f.image("https://cdn.example.com/x.svg"))
        assertNull(f.image("https://cdn.example.com/html"))
        assertNull(f.image("http://cdn.example.com/ok.jpg"))
        assertNull(f.image("https://192.168.1.1/ok.jpg"))
        assertEquals("PNG", String(f.image("https://cdn.example.com/r")!!))   // las imágenes pueden vivir en otro CDN
    }
}
