package com.nexo.ble

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI

// COLA 31 (decidido por el dueño 23-11): VISTA PREVIA REAL de los enlaces. La baja el teléfono que RECIBE, directo del sitio y POR TOR
// (el sitio no ve ni a quien manda ni a quien recibe); nada de lo que mande el emisor se usa como vista previa. Solo título + imagen
// (og: / oEmbed de YouTube), sin cookies (ni se mandan ni se guardan), sin ejecutar nada de la página (solo se leen las <meta> del
// texto), solo https (por http un nodo de salida de Tor podría falsificarla), redirección a OTRO dominio = no se sigue y se avisa.
// Si el sitio rechaza (403/429/503 o página de «comprobando que eres humano») se reintenta por OTRO circuito (otro usuario SOCKS:
// Tor aísla los circuitos por usuario/contraseña, IsolateSOCKSAuth); si vuelve a rechazar, la app pone la tarjeta segura.
// Sin Android (se prueba en la JVM: LinkPreviewTest). La recompresión de la imagen (Bitmap) está en PluginLinkPreview.kt.
object LinkPreview {
    const val MAX_URL = 2048
    const val MAX_HTML = 1_000_000        // se deja de leer al ver </head>; nunca más que esto
    const val MAX_IMG_BYTES = 4_000_000   // imagen original: más grande = sin imagen (solo título)
    const val MAX_IMG_PIXELS = 60_000_000L // ancho × alto declarado: más = sin imagen (bomba de descompresión)
    const val IMG_SIDE = 480              // lado mayor de la imagen recomprimida
    const val IMG_MAX_OUT = 64_000        // tope de la JPEG recomprimida (bytes)
    val QUALITIES = intArrayOf(72, 55, 40, 28)
    const val MAX_REDIRECTS = 5
    const val MAX_TITLE = 200
    // Igual para todos los teléfonos NEXO (no distingue a nadie); sin idioma, sin cookies
    const val UA = "Mozilla/5.0 (compatible; NEXO-preview/1.0)"

    // Estados que ve la app: ok | offline (sin internet) | tor (Tor no arrancó) | red (no se pudo llegar; se reintenta luego) |
    // rechaza (el sitio rechaza Tor tras 2 circuitos) | redirige (lleva a otro dominio: `to`) | sin_datos | invalido
    data class Result(val status: String, val title: String = "", val imageUrl: String = "", val host: String = "", val to: String = "")
    class Refused(msg: String) : Exception(msg)
    class SocksFail(val rep: Int) : java.io.IOException("SOCKS $rep")

    // Familias de dominios de un mismo sitio (un salto entre ellas no es «otro dominio»)
    private val FAMILIES = listOf(
        setOf("youtube.com", "youtu.be", "youtube-nocookie.com"),
        setOf("facebook.com", "fb.watch", "fb.com", "fb.me"),
        setOf("instagram.com", "instagr.am"),
        setOf("tiktok.com"))
    private val SLD = setOf("co", "com", "org", "net", "gob", "gov", "edu", "ac", "ne", "or", "go")
    private val BAD_SUFFIX = listOf(".local", ".onion", ".internal", ".lan", ".home", ".arpa", ".localhost", ".test", ".invalid")
    private val CHALLENGE = listOf("just a moment", "attention required", "access denied", "please wait", "are you a robot",
        "verify you are human", "security check", "captcha", "too many requests")

    /** ¿Nombre de un sitio público? Nada de IP, localhost, .onion/.local…, ni etiquetas raras. */
    fun isPublicHost(host: String?): Boolean {
        val h = (host ?: return false).lowercase().trimEnd('.')
        if (h.isEmpty() || h.length > 253 || !h.contains('.') || h == "localhost") return false
        if (h.contains(':') || Regex("^[0-9.]+$").matches(h)) return false
        if (BAD_SUFFIX.any { h.endsWith(it) }) return false
        return h.split('.').all { Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$").matches(it) }
    }

    /** La URL de inicio, válida: https, host público, sin usuario@, puerto 443 o ninguno, no demasiado larga. */
    fun startUri(url: String?): URI? {
        val s = url ?: return null
        if (s.length > MAX_URL || !s.startsWith("https://", ignoreCase = true)) return null
        val u = try { URI(s) } catch (e: Exception) { return null }
        if (!u.scheme.equals("https", true) || u.rawUserInfo != null || !isPublicHost(u.host)) return null
        if (u.port != -1 && u.port != 443) return null
        return u
    }

    fun registrable(host: String): String {
        val p = host.lowercase().trimEnd('.').split('.')
        if (p.size >= 3 && p.last().length == 2 && p[p.size - 2] in SLD) return p.takeLast(3).joinToString(".")
        return p.takeLast(2).joinToString(".")
    }
    private fun family(host: String): Int { val r = registrable(host); return FAMILIES.indexOfFirst { r in it } }
    fun sameSite(a: String, b: String): Boolean {
        if (registrable(a) == registrable(b)) return true
        val fa = family(a); return fa >= 0 && fa == family(b)
    }
    fun isYouTube(host: String) = registrable(host) in FAMILIES[0]

    /** oEmbed de YouTube (título + miniatura reales del vídeo) */
    fun oembedUrl(u: URI): URI = URI("https://www.youtube.com/oembed?format=json&url=" + java.net.URLEncoder.encode(u.toString(), "UTF-8"))

    // ===== Lectura de la página: solo texto; se quitan comentarios, scripts y estilos ANTES de buscar las <meta> =====
    private fun stripBlocks(html: String): String {
        val sb = StringBuilder(html.length)
        var i = 0
        val low = html.lowercase()
        while (i < html.length) {
            val lt = html.indexOf('<', i)
            if (lt < 0) { sb.append(html, i, html.length); break }
            sb.append(html, i, lt)
            if (low.startsWith("<!--", lt)) {
                val e = low.indexOf("-->", lt + 4); i = if (e < 0) html.length else e + 3; sb.append(' '); continue
            }
            val m = Regex("^<(script|style|noscript|template|textarea|iframe|svg)\\b").find(low.substring(lt, minOf(low.length, lt + 12)))
            if (m != null) {
                val e = low.indexOf("</" + m.groupValues[1], lt + 1)
                i = if (e < 0) html.length else { val g = low.indexOf('>', e); if (g < 0) html.length else g + 1 }
                sb.append(' '); continue
            }
            sb.append('<'); i = lt + 1
        }
        return sb.toString()
    }

    private val ATTR = Regex("([a-zA-Z_:.-]+)\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))")
    private val NAMED = mapOf("amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ", "#39" to "'")

    fun decodeEntities(s: String): String = Regex("&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8}|#39);").replace(s) { m ->
        val k = m.groupValues[1]
        val cp = when {
            k.startsWith("#x") || k.startsWith("#X") -> k.substring(2).toIntOrNull(16)
            k.startsWith("#") -> k.substring(1).toIntOrNull()
            else -> null
        }
        if (cp != null) { if (cp in 1..0x10FFFF && cp !in 0xD800..0xDFFF) String(Character.toChars(cp)) else "" }
        else NAMED[k.lowercase()] ?: m.value
    }

    /** Texto limpio para enseñar: sin controles, sin marcas de dirección (engaños de texto al revés) ni invisibles, ≤ MAX_TITLE. */
    fun cleanText(s: String?): String {
        if (s == null) return ""
        val sb = StringBuilder()
        var sp = false
        var n = 0
        var i = 0
        val d = decodeEntities(s)
        while (i < d.length && n < MAX_TITLE) {
            val cp = d.codePointAt(i); i += Character.charCount(cp)
            val bad = cp < 0x20 || cp == 0x7F || cp in 0x80..0x9F || cp in 0x200B..0x200F || cp in 0x202A..0x202E ||
                cp in 0x2066..0x2069 || cp == 0xFEFF || cp == 0x061C || cp in 0xFFF9..0xFFFB
            if (Character.isWhitespace(cp) || cp == 0xA0 || (bad && (cp == 9 || cp == 10 || cp == 13))) { sp = sb.isNotEmpty(); continue }
            if (bad) continue
            if (sp) { sb.append(' '); n++; sp = false }
            sb.appendCodePoint(cp); n++
        }
        return sb.toString().trim()
    }

    /** (título, imagen) de la cabecera de una página. Primera aparición de cada etiqueta; og: manda sobre twitter: y <title>. */
    fun parseHead(html: String): Pair<String, String> {
        val s = stripBlocks(html)
        val meta = HashMap<String, String>()
        Regex("<meta\\b([^>]*)>", RegexOption.IGNORE_CASE).findAll(s).take(400).forEach { m ->
            var key: String? = null; var content: String? = null
            ATTR.findAll(m.groupValues[1]).forEach { a ->
                val v = a.groups[3]?.value ?: a.groups[4]?.value ?: a.groups[5]?.value ?: ""
                when (a.groupValues[1].lowercase()) { "property", "name" -> if (key == null) key = v.trim().lowercase(); "content" -> content = v }
            }
            val k = key; val c = content
            if (k != null && c != null && !meta.containsKey(k)) meta[k] = c
        }
        val tt = Regex("<title\\b[^>]*>([\\s\\S]{0,2000}?)</title", RegexOption.IGNORE_CASE).find(s)?.groupValues?.get(1)
        val title = listOf(meta["og:title"], meta["twitter:title"], tt).map { cleanText(it) }.firstOrNull { it.isNotEmpty() } ?: ""
        val img = listOf(meta["og:image:secure_url"], meta["og:image"], meta["og:image:url"], meta["twitter:image"], meta["twitter:image:src"])
            .map { (it ?: "").trim() }.firstOrNull { it.isNotEmpty() } ?: ""
        return Pair(title, decodeEntities(img))
    }

    fun parseOembed(json: String): Pair<String, String> = try {
        val o = org.json.JSONObject(json)
        Pair(cleanText(o.optString("title", "")), o.optString("thumbnail_url", "").trim())
    } catch (e: Exception) { Pair("", "") }

    /** Página de «comprobando que eres humano» (cuenta como rechazo, nunca como vista previa) */
    fun isChallenge(title: String): Boolean { val t = title.lowercase(); return CHALLENGE.any { t.contains(it) } }

    /** URL de la imagen, resuelta contra la página y válida (https, host público) o null */
    fun imageUri(base: URI, ref: String): URI? {
        if (ref.isEmpty() || ref.length > MAX_URL) return null
        val u = try { base.resolve(URI(ref.replace(" ", "%20"))) } catch (e: Exception) { return null }
        return if (u.scheme.equals("https", true) && u.rawUserInfo == null && isPublicHost(u.host) && (u.port == -1 || u.port == 443)) u else null
    }

    // ===== Imagen: medidas =====
    fun imageDimsOk(w: Int, h: Int): Boolean = w in 1..40000 && h in 1..40000 && w.toLong() * h <= MAX_IMG_PIXELS
    /** inSampleSize (potencia de 2) para que el lado mayor quede ≥ side (y lo más cerca posible) */
    fun sampleSize(w: Int, h: Int, side: Int = IMG_SIDE): Int { var s = 1; while (maxOf(w, h) / (s * 2) >= side) s *= 2; return s }
    fun fitSize(w: Int, h: Int, side: Int = IMG_SIDE): Pair<Int, Int> {
        val m = maxOf(w, h); if (m <= side) return Pair(w, h)
        return Pair(maxOf(1, (w.toLong() * side / m).toInt()), maxOf(1, (h.toLong() * side / m).toInt()))
    }

    // ===== SOCKS5 con usuario/contraseña (circuito aislado) y el nombre SIN resolver (sin fuga de DNS) =====
    fun socks5(proxy: InetSocketAddress, host: String, port: Int, circuit: String, timeoutMs: Int): Socket {
        val s = Socket()
        try {
            s.connect(proxy, timeoutMs); s.soTimeout = timeoutMs
            val o = s.getOutputStream(); val i = s.getInputStream()
            o.write(byteArrayOf(5, 1, 2)); o.flush()
            val g = readN(i, 2); if (g[0].toInt() != 5 || g[1].toInt() != 2) throw java.io.IOException("SOCKS sin usuario")
            val u = circuit.toByteArray(Charsets.US_ASCII).copyOf(minOf(255, circuit.length))
            o.write(byteArrayOf(1, u.size.toByte()) + u + byteArrayOf(u.size.toByte()) + u); o.flush()
            val a = readN(i, 2); if (a[1].toInt() != 0) throw java.io.IOException("SOCKS usuario rechazado")
            val hb = host.toByteArray(Charsets.US_ASCII); require(hb.size in 1..255)
            o.write(byteArrayOf(5, 1, 0, 3, hb.size.toByte()) + hb + byteArrayOf((port shr 8).toByte(), port.toByte())); o.flush()
            val r = readN(i, 4); if (r[0].toInt() != 5) throw java.io.IOException("SOCKS respuesta rara")
            if (r[1].toInt() != 0) throw SocksFail(r[1].toInt())
            when (r[3].toInt()) { 1 -> readN(i, 6); 4 -> readN(i, 18); 3 -> readN(i, (readN(i, 1)[0].toInt() and 0xFF) + 2); else -> throw java.io.IOException("SOCKS") }
            return s
        } catch (e: Throwable) { try { s.close() } catch (x: Exception) { }; throw e }
    }
    private fun readN(i: InputStream, n: Int): ByteArray {
        val b = ByteArray(n); var o = 0
        while (o < n) { val r = i.read(b, o, n - o); if (r < 0) throw java.io.EOFException(); o += r }
        return b
    }

    // ===== GET mínimo (HTTP/1.1, sin cookies, sin seguir nada solo) =====
    class Resp(val code: Int, val headers: Map<String, String>, val body: ByteArray, val truncated: Boolean)

    class Fetcher(
        private val dial: (host: String, port: Int, circuit: String) -> Socket,
        private val tls: (raw: Socket, host: String, port: Int) -> Socket,
        private val timeoutMs: Int = 30000,
        private val newCircuit: () -> String = { "nexo-prev-" + java.util.UUID.randomUUID().toString().replace("-", "").take(16) }) {

        fun get(u: URI, circuit: String, accept: String, max: Int, stopAtHead: Boolean): Resp {
            val host = u.host; val port = if (u.port > 0) u.port else 443
            val raw = dial(host, port, circuit)
            val s = try { raw.soTimeout = timeoutMs; tls(raw, host, port) } catch (e: Throwable) { try { raw.close() } catch (x: Exception) { }; throw e }
            s.use {
                val path = (u.rawPath ?: "").ifEmpty { "/" } + (if (u.rawQuery != null) "?" + u.rawQuery else "")
                val req = "GET $path HTTP/1.1\r\nHost: $host\r\nUser-Agent: $UA\r\nAccept: $accept\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n"
                it.getOutputStream().apply { write(req.toByteArray(Charsets.UTF_8)); flush() }
                val inp = java.io.BufferedInputStream(it.getInputStream())
                val status = readLine(inp)
                val code = Regex("^HTTP/1\\.[01] (\\d{3})").find(status)?.groupValues?.get(1)?.toInt() ?: throw java.io.IOException("respuesta no válida")
                val h = HashMap<String, String>()
                for (n in 0 until 100) {
                    val l = readLine(inp); if (l.isEmpty()) break
                    val c = l.indexOf(':'); if (c > 0) { val k = l.substring(0, c).trim().lowercase(); if (!h.containsKey(k)) h[k] = l.substring(c + 1).trim() }
                }   // Set-Cookie se lee y se tira: nunca se guarda ni se manda
                if (code !in 200..299) return Resp(code, h, ByteArray(0), false)
                val chunked = h["transfer-encoding"]?.lowercase()?.contains("chunked") == true
                val len = h["content-length"]?.toLongOrNull()
                if (len != null && len > max && !stopAtHead) return Resp(code, h, ByteArray(0), true)
                val out = ByteArrayOutputStream()
                var trunc = false
                val sink: (ByteArray, Int) -> Boolean = { b, n ->   // true = parar
                    val room = max - out.size()
                    if (n > room) { out.write(b, 0, room); trunc = true; true }
                    else { out.write(b, 0, n); stopAtHead && headEnded(out) }
                }
                if (chunked) readChunked(inp, sink) else readPlain(inp, len, sink)
                return Resp(code, h, out.toByteArray(), trunc)
            }
        }
        private fun headEnded(o: ByteArrayOutputStream): Boolean {
            if (o.size() < 7) return false
            val tail = String(o.toByteArray(), maxOf(0, o.size() - 8192).let { it }, minOf(o.size(), 8192), Charsets.ISO_8859_1).lowercase()
            return tail.contains("</head") || tail.contains("<body")
        }
        private fun readPlain(i: InputStream, len: Long?, sink: (ByteArray, Int) -> Boolean) {
            val b = ByteArray(16384); var left = len ?: Long.MAX_VALUE
            while (left > 0) { val r = i.read(b, 0, minOf(b.size.toLong(), left).toInt()); if (r < 0) break; left -= r; if (sink(b, r)) break }
        }
        private fun readChunked(i: InputStream, sink: (ByteArray, Int) -> Boolean) {
            val b = ByteArray(16384)
            while (true) {
                val sz = readLine(i).substringBefore(';').trim().toLongOrNull(16) ?: throw java.io.IOException("trozo no válido")
                if (sz <= 0L) return
                var left = sz
                while (left > 0) { val r = i.read(b, 0, minOf(b.size.toLong(), left).toInt()); if (r < 0) return; left -= r; if (sink(b, r)) return }
                readLine(i)
            }
        }
        private fun readLine(i: InputStream): String {
            val sb = StringBuilder()
            while (sb.length < 8192) { val c = i.read(); if (c < 0 || c == '\n'.code) break; if (c != '\r'.code) sb.append(c.toChar()) }
            return sb.toString()
        }

        /** La vista previa de `url`: un circuito; si el sitio rechaza o no se llega, otro circuito. */
        fun preview(url: String): Result {
            val u0 = startUri(url) ?: return Result("invalido")
            var last: Throwable? = null
            for (n in 0 until 2) {
                try { return attempt(u0, newCircuit()) } catch (e: Refused) { last = e } catch (e: java.io.IOException) { last = e }
            }
            return Result(if (last is Refused) "rechaza" else "red", host = u0.host.lowercase())
        }

        private fun attempt(u0: URI, circuit: String): Result {
            val host0 = u0.host.lowercase()
            if (isYouTube(host0)) {
                val r = get(oembedUrl(u0), circuit, "application/json", 200_000, false)
                if (r.code == 403 || r.code == 429 || r.code == 503) throw Refused("oEmbed ${r.code}")
                if (r.code == 200) {
                    val (t, img) = parseOembed(String(r.body, Charsets.UTF_8))
                    if (t.isNotEmpty() && !isChallenge(t)) return Result("ok", t, imageUri(u0, img)?.toString() ?: "", host0)
                }
                return Result("sin_datos", host = host0)   // vídeo privado/borrado: sin vista previa (nunca una inventada)
            }
            var u = u0
            for (hop in 0..MAX_REDIRECTS) {
                val r = get(u, circuit, "text/html,application/xhtml+xml", MAX_HTML, true)
                when {
                    r.code in 300..399 -> {
                        val loc = r.headers["location"] ?: return Result("sin_datos", host = host0)
                        val next = try { u.resolve(URI(loc.trim().replace(" ", "%20"))) } catch (e: Exception) { return Result("sin_datos", host = host0) }
                        val nh = next.host?.lowercase() ?: return Result("sin_datos", host = host0)
                        if (!sameSite(host0, nh)) return Result("redirige", host = host0, to = if (isPublicHost(nh)) nh else "")
                        if (!next.scheme.equals("https", true) || next.rawUserInfo != null || !isPublicHost(nh) || (next.port != -1 && next.port != 443))
                            return Result("sin_datos", host = host0)
                        u = next
                    }
                    r.code == 403 || r.code == 429 || r.code == 503 -> throw Refused("HTTP ${r.code}")
                    r.code == 200 -> {
                        val ct = (r.headers["content-type"] ?: "").lowercase()
                        if (!ct.contains("html")) return Result("sin_datos", host = host0)
                        val cs = Regex("charset=([a-z0-9_-]+)").find(ct)?.groupValues?.get(1)
                        val html = try { String(r.body, if (cs != null) charset(cs) else Charsets.UTF_8) } catch (e: Exception) { String(r.body, Charsets.UTF_8) }
                        val (t, img) = parseHead(html)
                        if (t.isEmpty()) return Result("sin_datos", host = host0)
                        if (isChallenge(t)) throw Refused("comprobación anti-robot")
                        return Result("ok", t, imageUri(u, img)?.toString() ?: "", host0)
                    }
                    else -> return Result("sin_datos", host = host0)
                }
            }
            return Result("sin_datos", host = host0)
        }

        /** Bytes de la imagen (https, host público, ≤ MAX_IMG_BYTES, una imagen que no sea SVG) o null. Redirecciones: a cualquier
         *  host público https (las imágenes viven en CDN), máximo 3. */
        fun image(url: String): ByteArray? {
            var u = try { URI(url) } catch (e: Exception) { return null }
            val circuit = newCircuit()
            for (hop in 0..3) {
                if (!u.scheme.equals("https", true) || !isPublicHost(u.host) || u.rawUserInfo != null || (u.port != -1 && u.port != 443)) return null
                val r = try { get(u, circuit, "image/jpeg,image/png,image/webp,image/gif", MAX_IMG_BYTES, false) } catch (e: java.io.IOException) { return null }
                if (r.code in 300..399) { u = try { u.resolve(URI((r.headers["location"] ?: return null).trim())) } catch (e: Exception) { return null }; continue }
                val ct = (r.headers["content-type"] ?: "").lowercase()
                if (r.code != 200 || r.truncated || !ct.startsWith("image/") || ct.contains("svg") || r.body.isEmpty()) return null
                return r.body
            }
            return null
        }
    }
}
