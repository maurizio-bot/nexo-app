package com.nexo.ble

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall

// COLA 31 (dueño 23-11): vista previa REAL de un enlace, bajada por ESTE teléfono (el que recibe) directo del sitio y POR TOR.
// La lógica (lectura de la página, redirecciones, otro circuito, topes) está en LinkPreview.kt (probada en la JVM); aquí solo:
//  - Tor BAJO DEMANDA: si Tor ya corre (torStart de la app) se usa su puerto SOCKS; si no, se enlaza TorService solo para esto
//    (su SOCKS, sin servicio oculto) y se suelta a los 5 min sin vistas previas. NO toca TorRoute.always («Usar Tor siempre») ni
//    TorRoute.proxy: el resto de lo de internet sale igual que antes. Cada vista previa usa su propio circuito (usuario SOCKS
//    distinto), así el sitio no puede juntar las vistas previas de un mismo teléfono.
//  - la imagen se DECODIFICA y se vuelve a comprimir aquí (JPEG ≤ 480 px, ≤ 64 KB): a la app nunca llegan los bytes del sitio.
// linkPreview({ url }) → { status, title?, image? (data:image/jpeg;base64), host, to? } (estados en LinkPreview.Result).

private val prevExec = java.util.concurrent.ThreadPoolExecutor(2, 2, 30L, java.util.concurrent.TimeUnit.SECONDS,
    java.util.concurrent.LinkedBlockingQueue(24)).apply { allowCoreThreadTimeOut(true) }
@Volatile private var prevSvc: org.torproject.jni.TorService? = null
@Volatile private var prevLastUse = 0L
private const val PREV_IDLE_MS = 5 * 60_000L

internal fun NexoBlePlugin.linkPreviewImpl(call: PluginCall) {
    val url = call.getString("url") ?: ""
    if (LinkPreview.startUri(url) == null) { call.resolve(JSObject().put("status", "invalido")); return }
    if (!prevHasInternet(context)) { call.resolve(JSObject().put("status", "offline")); return }
    try {
        prevExec.execute {
            val out = JSObject()
            try {
                val port = prevTorPort(this)
                if (port == null) { out.put("status", "tor") } else {
                    val socks = java.net.InetSocketAddress("127.0.0.1", port)
                    val f = LinkPreview.Fetcher({ h, p, c -> LinkPreview.socks5(socks, h, p, c, 30000) }, { s, h, p -> TorRoute.tls(s, h, p) }, 30000)
                    val r = f.preview(url)
                    out.put("status", r.status).put("host", r.host)
                    if (r.to.isNotEmpty()) out.put("to", r.to)
                    if (r.status == "ok") {
                        out.put("title", r.title)
                        if (r.imageUrl.isNotEmpty()) f.image(r.imageUrl)?.let { prevRecompress(it) }?.let {
                            out.put("image", "data:image/jpeg;base64," + android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP))
                        }
                    }
                }
            } catch (e: Throwable) { out.put("status", "red") }
            prevLastUse = System.currentTimeMillis()
            call.resolve(out)
        }
    } catch (e: java.util.concurrent.RejectedExecutionException) { call.resolve(JSObject().put("status", "red")) }   // cola llena: luego
}

private fun prevHasInternet(ctx: Context): Boolean = try {
    val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
    cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
} catch (e: Exception) { true }

private fun prevReady(s: org.torproject.jni.TorService?): Int? {
    if (s == null) return null
    val boot = try { s.torControlConnection?.getInfo("status/bootstrap-phase") ?: "" } catch (e: Exception) { "" }
    val port = try { s.getSocksPort() } catch (e: Exception) { -1 }
    return if (boot.contains("PROGRESS=100") && port > 0) port else null
}

// Puerto SOCKS de un Tor listo: el de la app si ya corre; si no, uno propio (se espera hasta 120 s a que arme circuito)
private fun prevTorPort(p: NexoBlePlugin): Int? {
    prevLastUse = System.currentTimeMillis()
    prevReady(p.torSvc)?.let { return it }
    // Revisión 23-11: dos vistas previas a la vez enlazaban el servicio DOS veces y una conexión quedaba sin soltar (Tor encendido para
    // siempre). Una sola a la vez enlaza; si no llega a conectar, se suelta igual.
    val s: org.torproject.jni.TorService = synchronized(prevLock) { prevSvc ?: prevBind(p) } ?: return null
    TorKeep.active()
    val t0 = System.currentTimeMillis()
    while (System.currentTimeMillis() - t0 < 120_000L) { prevReady(s)?.let { return it }; Thread.sleep(1000) }
    return null
}
private val prevLock = Any()
private fun prevBind(p: NexoBlePlugin): org.torproject.jni.TorService? {
    // 3324: la conexión con Tor es la de todo el proceso (TorKeep, nunca se suelta: soltarla tumbaba la app con SIGABRT a los 5 min)
    val s = TorKeep.bind(p.context) ?: return null
    prevSvc = s
    prevScheduleIdle(p)
    return s
}

// Tras PREV_IDLE_MS sin vistas previas, Tor se DUERME (no se apaga) si nadie más lo usa (la app con Tor o «Usar Tor siempre»)
private fun prevScheduleIdle(p: NexoBlePlugin) {
    p.mainHandler.postDelayed({
        if (System.currentTimeMillis() - prevLastUse < PREV_IDLE_MS || prevExec.activeCount > 0) { prevScheduleIdle(p); return@postDelayed }
        prevSvc = null
        if (p.torSvc == null && !TorRoute.always) TorKeep.dormant()
    }, PREV_IDLE_MS)
}

// La imagen del sitio → JPEG nuevo, pequeño. Medidas declaradas absurdas = sin imagen; se decodifica ya reducida (inSampleSize).
private fun prevRecompress(b: ByteArray): ByteArray? {
    var bm: Bitmap? = null; var sc: Bitmap? = null
    try {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(b, 0, b.size, o)
        if (!LinkPreview.imageDimsOk(o.outWidth, o.outHeight)) return null
        val o2 = BitmapFactory.Options().apply { inSampleSize = LinkPreview.sampleSize(o.outWidth, o.outHeight); inPreferredConfig = Bitmap.Config.ARGB_8888 }
        bm = BitmapFactory.decodeByteArray(b, 0, b.size, o2) ?: return null
        val (w, h) = LinkPreview.fitSize(bm.width, bm.height)
        // fondo blanco (un PNG transparente no sale negro en JPEG)
        sc = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val tmp = if (w != bm.width || h != bm.height) Bitmap.createScaledBitmap(bm, w, h, true) else bm
        Canvas(sc).apply { drawColor(Color.WHITE); drawBitmap(tmp, 0f, 0f, null) }
        if (tmp !== bm) tmp.recycle()
        for (q in LinkPreview.QUALITIES) {
            val bo = java.io.ByteArrayOutputStream()
            sc.compress(Bitmap.CompressFormat.JPEG, q, bo)
            if (bo.size() <= LinkPreview.IMG_MAX_OUT) return bo.toByteArray()
        }
        return null
    } catch (e: Throwable) { return null }   // OutOfMemory incluido: sin imagen, la vista previa sigue con el título
    finally { try { bm?.recycle() } catch (e: Exception) { }; try { sc?.recycle() } catch (e: Exception) { } }
}
