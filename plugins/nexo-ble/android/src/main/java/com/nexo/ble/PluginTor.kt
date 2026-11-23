package com.nexo.ble

import android.content.Context
import android.content.Intent
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.json.JSONObject

// Tor: TorService, servicio oculto y LanHub por SOCKS.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

internal fun NexoBlePlugin.torStatusImpl(call: PluginCall) {
    val peers = JSArray()
    torHub?.quality()?.forEach { (nx, rtt, idle) -> peers.put(JSObject().put("nx", nx).put("rtt", rtt).put("idle", idle)) }
    call.resolve(JSObject().put("supported", true).put("running", torSvc != null).put("onion", torOnion).put("port", TOR_PORT)
        .put("starting", torStarting).put("peers", peers))
}

internal fun NexoBlePlugin.torStartImpl(call: PluginCall) {
    val nx = call.getString("nexoId")?.lowercase() ?: run { call.reject("nexoId requerido"); return }
    // Decisión 13A: la app dice si es «Usar Tor siempre» (se guarda: la escucha sin la app también espera a Tor y sale por él)
    call.getBoolean("always")?.let { TorRoute.save(context.filesDir, it) }
    if (torOnion.isNotEmpty() && torHub != null) { call.resolve(JSObject().put("onion", torOnion).put("port", TOR_PORT)); return }
    if (torStarting) { call.resolve(JSObject().put("starting", true)); return }
    torStarting = true
    call.resolve(JSObject().put("starting", true))
    torExec.execute {
        try {
            remLog("INFO", "TOR", "Arrancando Tor…")
            val svc = torBindService() ?: throw Exception("no arranca el servicio de Tor")
            // Esperar a Tor listo (circuito armado) y a su puerto SOCKS
            val t0 = System.currentTimeMillis()
            var ctl = svc.torControlConnection
            while (System.currentTimeMillis() - t0 < 180000L) {
                ctl = svc.torControlConnection
                val boot = try { ctl?.getInfo("status/bootstrap-phase") ?: "" } catch (e: Exception) { "" }
                if (ctl != null && boot.contains("PROGRESS=100") && svc.getSocksPort() > 0) break
                Thread.sleep(1000)
            }
            if (ctl == null || svc.getSocksPort() <= 0) throw Exception("Tor no terminó de arrancar")
            val proxy = java.net.Proxy(java.net.Proxy.Type.SOCKS, java.net.InetSocketAddress("127.0.0.1", svc.getSocksPort()))
            TorRoute.proxy = proxy   // 13A: desde aquí lo de internet puede salir por Tor (relés de la app y nativos, toque)
            val hub = torHub ?: LanHub({ nx }, object : LanHub.Listener {
                override fun onUp(nx: String) { remLog("INFO", "TOR", "Conectado con $nx por Tor"); notifyListeners("onTorUp", JSObject().put("nx", nx), true) }
                override fun onDown(nx: String) { notifyListeners("onTorDown", JSObject().put("nx", nx), true) }
                override fun onMessage(nx: String, text: String) { notifyListeners("onTorMessage", JSObject().put("nx", nx).put("content", text), true) }
                override fun onLog(level: String, message: String) { remLog(level, "TOR", message) }
            }, 15000L, 90000L, proxy, java.net.InetAddress.getByName("127.0.0.1"), { android.os.SystemClock.elapsedRealtime() }).also { torHub = it }
            val port = hub.start()
            // Servicio oculto: misma dirección siempre (clave guardada cifrada)
            val saved = try { atRest().read(TOR_KEY_FILE)?.let { org.json.JSONObject(it).optString("k") } } catch (e: Exception) { null }
            val res = ctl.addOnion(if (saved.isNullOrEmpty()) "NEW:ED25519-V3" else saved, mapOf(TOR_PORT to "127.0.0.1:$port"))
            // Ronda 2765: jtorctl devuelve "onionAddress"/"onionPrivKey" (TorOnion.kt); antes se leía ServiceID y nunca
            // se encontraba la dirección ("sin dirección .onion" en los teléfonos)
            TorOnion.privateKey(res)?.let { atRest().write(TOR_KEY_FILE, org.json.JSONObject().put("k", it).toString()) }
            torOnion = TorOnion.address(res) ?: throw Exception("sin dirección .onion (respuesta: " + res.keys.joinToString() + ")")
            remLog("INFO", "TOR", "Tor listo en " + (System.currentTimeMillis() - t0) / 1000 + " s")
            notifyListeners("onTorReady", JSObject().put("onion", torOnion).put("port", TOR_PORT), true)
        } catch (e: Exception) {
            remLog("WARN", "TOR", "Tor no disponible: ${e.message}")
            notifyListeners("onTorReady", JSObject().put("error", e.message ?: "error"), true)
        } finally { torStarting = false }
    }
}

// Enlazar con TorService (en este proceso) y esperar a tenerlo
private fun NexoBlePlugin.torBindService(): org.torproject.jni.TorService? {
    torSvc?.let { return it }
    val latch = java.util.concurrent.CountDownLatch(1)
    val conn = object : android.content.ServiceConnection {
        override fun onServiceConnected(name: android.content.ComponentName?, binder: android.os.IBinder?) {
            torSvc = (binder as? org.torproject.jni.TorService.LocalBinder)?.service
            latch.countDown()
        }
        override fun onServiceDisconnected(name: android.content.ComponentName?) { torSvc = null; torOnion = "" }
    }
    torBind = conn
    mainHandler.post { context.bindService(Intent(context, org.torproject.jni.TorService::class.java), conn, Context.BIND_AUTO_CREATE) }
    latch.await(60, java.util.concurrent.TimeUnit.SECONDS)
    return torSvc
}

internal fun NexoBlePlugin.torConnectImpl(call: PluginCall) {
    // Decisión 13A: con `url` es un WebSocket a un relé (wss://) por el SOCKS de Tor para la app (el WebView no sabe usar un SOCKS);
    // con `post`, el toque (POST al enviador) por Tor. Lo de siempre (.onion de un contacto) sigue abajo.
    call.getString("url")?.let { torWsOpen(call, it); return }
    call.getString("post")?.let { torPost(call, it); return }
    val host = call.getString("host") ?: run { call.reject("host requerido"); return }
    val port = call.getInt("port") ?: TOR_PORT
    val hub = torHub ?: run { call.reject("Tor no listo", "TOR_DOWN"); return }
    if (!host.endsWith(".onion")) { call.reject("solo direcciones .onion"); return }
    hub.connect(host, port)
    call.resolve(JSObject().put("connecting", true))
}

internal fun NexoBlePlugin.torSendImpl(call: PluginCall) {
    call.getString("ws")?.let { id -> val w = torWs[id] ?: run { call.reject("sin conexión", "TOR_DOWN"); return }; val c = call.getString("content") ?: ""
        torSendExec.execute { if (w.send(c)) call.resolve(JSObject().put("sent", true)) else call.reject("sin conexión", "TOR_DOWN") }; return }
    val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
    val content = call.getString("content") ?: run { call.reject("content requerido"); return }
    val hub = torHub ?: run { call.reject("Tor no listo", "TOR_DOWN"); return }
    torSendExec.execute {
        if (hub.send(nx, content)) call.resolve(JSObject().put("sent", true))
        else call.reject("Sin conexión Tor con $nx", "TOR_DOWN")
    }
}

internal fun NexoBlePlugin.torDropImpl(call: PluginCall) {
    call.getString("ws")?.let { id -> torWs.remove(id)?.close(); call.resolve(JSObject().put("dropped", true)); return }
    val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
    torHub?.close(nx)
    call.resolve(JSObject().put("dropped", true))
}

internal fun NexoBlePlugin.torStopImpl(call: PluginCall) {
    TorRoute.save(context.filesDir, false)   // 13A: el usuario apagó Tor: todo vuelve a salir directo
    torStopAll()
    call.resolve(JSObject().put("stopped", true))
}

internal fun NexoBlePlugin.torStopAll() {
    TorRoute.proxy = null
    torWs.values.forEach { try { it.close() } catch (e: Exception) {} }; torWs.clear()
    torHub?.stop(); torHub = null
    torOnion = ""
    torBind?.let { try { context.unbindService(it) } catch (e: Exception) {} }
    torBind = null; torSvc = null
}

// ===== Decisión 13A (23-11): los WebSocket de la app a los relés por Tor =====
// El WebView no puede usar un SOCKS: con «Usar Tor siempre» la app abre cada relé por aquí (net_tor.js TorWs) y el nativo lo conecta con
// WsClient por el SOCKS de Tor. Avisos a la app: onTorWs { ws, ev: 'open' | 'msg' | 'close', data }.
internal val torWs = java.util.concurrent.ConcurrentHashMap<String, WsClient>()
private val torWsExec = java.util.concurrent.Executors.newCachedThreadPool()

private fun NexoBlePlugin.torWsOpen(call: PluginCall, url: String) {
    val id = call.getString("ws") ?: run { call.reject("ws requerido"); return }
    val via = TorRoute.proxy ?: run { call.reject("Tor no listo", "TOR_DOWN"); return }   // nunca directo
    if (!WsClient.urlOk(url) || torWs.size >= 24) { call.reject("relé no válido", "TOR_WS"); return }
    var self: WsClient? = null
    val ws = WsClient(url, { t -> notifyListeners("onTorWs", JSObject().put("ws", id).put("ev", "msg").put("data", t)) }, { why ->
        if (self != null && torWs.remove(id, self)) notifyListeners("onTorWs", JSObject().put("ws", id).put("ev", "close").put("data", why))
    }, 30000, via)
    self = ws
    torWs[id] = ws
    call.resolve(JSObject().put("connecting", true))
    torWsExec.execute {
        try { ws.connect(); if (torWs[id] === ws) notifyListeners("onTorWs", JSObject().put("ws", id).put("ev", "open")) else ws.close() }
        catch (e: Throwable) { if (torWs.remove(id, ws)) notifyListeners("onTorWs", JSObject().put("ws", id).put("ev", "close").put("data", e.message ?: "error")) }
    }
}

// El toque por Tor: solo a nuestro enviador (S-D5) y sin seguir redirecciones
private fun NexoBlePlugin.torPost(call: PluginCall, url: String) {
    val body = call.getString("body") ?: ""
    if (!TorRoute.wakeUrlOk(url) || body.length > 8192) { call.reject("dirección no válida", "TOR_POST"); return }
    val via = TorRoute.proxy ?: run { call.reject("Tor no listo", "TOR_DOWN"); return }
    torWsExec.execute {
        try { call.resolve(JSObject().put("status", TorRoute.post(url, body, 30000, via))) }
        catch (e: Throwable) { call.reject("toque por Tor fallido: ${e.message}", "TOR_POST") }
    }
}

// Sin la app (NetBgHome): con «Usar Tor siempre» la escucha espera a Tor; aquí se arranca Tor en este proceso (sin servicio oculto:
// solo hace falta su SOCKS) y se apunta el proxy. Si la app carga después, usa el mismo TorService.
@Volatile private var torBgStarting = false
internal fun torEnsureForBg(ctx: Context, log: (String) -> Unit) {
    if (!TorRoute.always || TorRoute.proxy != null || torBgStarting) return
    torBgStarting = true
    Thread({
        try {
            val t0 = System.currentTimeMillis()
            val latch = java.util.concurrent.CountDownLatch(1)
            var svc: org.torproject.jni.TorService? = null
            val conn = object : android.content.ServiceConnection {
                override fun onServiceConnected(name: android.content.ComponentName?, binder: android.os.IBinder?) { svc = (binder as? org.torproject.jni.TorService.LocalBinder)?.service; latch.countDown() }
                override fun onServiceDisconnected(name: android.content.ComponentName?) { TorRoute.proxy = null }
            }
            val app = ctx.applicationContext ?: ctx
            android.os.Handler(android.os.Looper.getMainLooper()).post { app.bindService(Intent(app, org.torproject.jni.TorService::class.java), conn, Context.BIND_AUTO_CREATE) }
            latch.await(60, java.util.concurrent.TimeUnit.SECONDS)
            val s = svc ?: throw Exception("no arranca el servicio de Tor")
            while (System.currentTimeMillis() - t0 < 180000L) {
                val boot = try { s.torControlConnection?.getInfo("status/bootstrap-phase") ?: "" } catch (e: Exception) { "" }
                if (boot.contains("PROGRESS=100") && s.getSocksPort() > 0) break
                Thread.sleep(1000)
            }
            if (s.getSocksPort() <= 0) throw Exception("Tor no terminó de arrancar")
            TorRoute.proxy = java.net.Proxy(java.net.Proxy.Type.SOCKS, java.net.InetSocketAddress("127.0.0.1", s.getSocksPort()))
            log("Usar Tor siempre: Tor listo sin la app en " + (System.currentTimeMillis() - t0) / 1000 + " s")
        } catch (e: Throwable) { log("Usar Tor siempre: Tor no arrancó sin la app (${e.message}): no se sale a internet hasta tenerlo") }
        finally { torBgStarting = false }
    }, "nexo-tor-bg").apply { isDaemon = true }.start()
}
