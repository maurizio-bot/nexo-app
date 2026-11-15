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
    val host = call.getString("host") ?: run { call.reject("host requerido"); return }
    val port = call.getInt("port") ?: TOR_PORT
    val hub = torHub ?: run { call.reject("Tor no listo", "TOR_DOWN"); return }
    if (!host.endsWith(".onion")) { call.reject("solo direcciones .onion"); return }
    hub.connect(host, port)
    call.resolve(JSObject().put("connecting", true))
}

internal fun NexoBlePlugin.torSendImpl(call: PluginCall) {
    val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
    val content = call.getString("content") ?: run { call.reject("content requerido"); return }
    val hub = torHub ?: run { call.reject("Tor no listo", "TOR_DOWN"); return }
    torSendExec.execute {
        if (hub.send(nx, content)) call.resolve(JSObject().put("sent", true))
        else call.reject("Sin conexión Tor con $nx", "TOR_DOWN")
    }
}

internal fun NexoBlePlugin.torDropImpl(call: PluginCall) {
    val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
    torHub?.close(nx)
    call.resolve(JSObject().put("dropped", true))
}

internal fun NexoBlePlugin.torStopImpl(call: PluginCall) {
    torStopAll()
    call.resolve(JSObject().put("stopped", true))
}

internal fun NexoBlePlugin.torStopAll() {
    torHub?.stop(); torHub = null
    torOnion = ""
    torBind?.let { try { context.unbindService(it) } catch (e: Exception) {} }
    torBind = null; torSvc = null
}
