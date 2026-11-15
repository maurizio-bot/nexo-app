package com.nexo.ble

import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

// Wi-Fi Direct: fotos, vídeos y archivos con el contacto a alcance.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

private fun NexoBlePlugin.p2pInit(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_DIRECT)) return false
    if (p2pManager == null) {
        p2pManager = context.getSystemService(Context.WIFI_P2P_SERVICE) as? WifiP2pManager
        p2pChannel = p2pManager?.initialize(context, Looper.getMainLooper(), null)
    }
    return p2pManager != null && p2pChannel != null
}

internal fun NexoBlePlugin.wdPermissionGranted(): Boolean =
    if (Build.VERSION.SDK_INT >= 33) isGranted(context, "android.permission.NEARBY_WIFI_DEVICES")
    else isGranted(context, android.Manifest.permission.ACCESS_FINE_LOCATION)

internal fun NexoBlePlugin.wdRandom(n: Int): String {
    val chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    val rnd = java.security.SecureRandom()
    return (1..n).map { chars[rnd.nextInt(chars.length)] }.joinToString("")
}

// 3013 (dueño 11-11: «no veo que funcione Wi-Fi Direct»; diagnósticos 08 y 10-11: «No se pudo crear el grupo (2)» en los dos
// teléfonos): el 2 es «ocupado», que Android contesta cuando no puede levantar Wi-Fi Direct en ese momento (Wi-Fi apagado,
// interfaz ocupada, operación en curso). Antes se rendía al primer fallo y el diagnóstico no decía por qué.
private fun NexoBlePlugin.wdWifiOn(): Boolean = try {
    (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.isWifiEnabled ?: false
} catch (e: Exception) { false }

// Canal nuevo con el servicio de Wi-Fi Direct (el anterior puede haberse quedado sin servicio)
private fun NexoBlePlugin.p2pReset() {
    try { if (Build.VERSION.SDK_INT >= 27) p2pChannel?.close() } catch (e: Exception) {}
    p2pManager = null
    p2pChannel = null
    p2pInit()
}

// Estado de Wi-Fi Direct en una línea, para el diagnóstico (no espera más de 1,5 s)
@android.annotation.SuppressLint("MissingPermission")
private fun NexoBlePlugin.wdState(cb: (String) -> Unit) {
    val parts = java.util.concurrent.ConcurrentHashMap<String, String>()
    val done = java.util.concurrent.atomic.AtomicBoolean(false)
    fun finish() {
        if (!done.compareAndSet(false, true)) return
        cb("Wi-Fi " + (if (wdWifiOn()) "encendido" else "APAGADO") + ", Wi-Fi Direct " + (parts["p2p"] ?: "?") +
            ", grupo " + (parts["grupo"] ?: "?") + ", app " + (if (appInBackground) "en segundo plano" else "en primer plano"))
    }
    try {
        val m = p2pManager
        val ch = p2pChannel
        if (m == null || ch == null) { parts["p2p"] = "sin canal"; finish(); return }
        mainHandler.postDelayed({ finish() }, 1500)
        if (Build.VERSION.SDK_INT >= 29) m.requestP2pState(ch) { st ->
            parts["p2p"] = if (st == WifiP2pManager.WIFI_P2P_STATE_ENABLED) "activo" else "inactivo"
            if (parts.containsKey("grupo")) finish()
        }
        m.requestGroupInfo(ch) { g ->
            parts["grupo"] = if (g == null) "ninguno" else if ((g.networkName ?: "").endsWith("-NEXO")) "propio" else "de otra app"
            if (parts.containsKey("p2p") || Build.VERSION.SDK_INT < 29) finish()
        }
    } catch (e: Exception) { parts["p2p"] = "error ${e.message}"; finish() }
}

private fun NexoBlePlugin.wdTearDown() {
    mainHandler.post {
        val m = p2pManager
        val ch = p2pChannel
        if (m != null && ch != null) {
            try { m.removeGroup(ch, null) } catch (e: Exception) {}
            try { m.cancelConnect(ch, null) } catch (e: Exception) {}
        }
    }
}

internal fun NexoBlePlugin.wifiDirectStatusImpl(call: PluginCall) {
    val supported = p2pInit()
    val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    call.resolve(JSObject().put("supported", supported).put("granted", wdPermissionGranted()).put("wifiOn", wm?.isWifiEnabled ?: false))
}

internal fun NexoBlePlugin.wifiDirectPermCallbackImpl(call: PluginCall) {
    call.resolve(JSObject().put("granted", wdPermissionGranted()))
}

@android.annotation.SuppressLint("MissingPermission")
internal fun NexoBlePlugin.wifiDirectHostImpl(call: PluginCall) {
    val transferId = call.getString("transferId") ?: run { call.reject("transferId requerido"); return }
    val bigToken = call.getString("bigToken")?.takeIf { it.length >= 16 }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !p2pInit() || !wdPermissionGranted()) {
        call.reject("Wi-Fi Direct no disponible", "WD_UNAVAILABLE"); return
    }
    if (!wdWifiOn()) {
        remLog("WARN", "WIFI_DIRECT", "No se monta el grupo para $transferId: Wi-Fi APAGADO (Wi-Fi Direct lo necesita encendido, aunque no haya red)")
        call.reject("Wi-Fi apagado", "WD_WIFI_OFF"); return
    }
    val name = "DIRECT-" + wdRandom(2) + "-NEXO"
    val pass = wdRandom(16)
    val cfg = WifiP2pConfig.Builder().setNetworkName(name).setPassphrase(pass)
        .enablePersistentMode(false).setGroupOperatingBand(WifiP2pConfig.GROUP_OWNER_BAND_AUTO).build()
    // Esperas antes de cada reintento (en total ~5 s; la oferta del otro espera 25 s)
    val retryMs = longArrayOf(700, 1500, 2500)
    var start: (Int) -> Unit = { _ -> }
    fun create(attempt: Int) {
        val m = p2pManager
        val ch = p2pChannel
        if (m == null || ch == null) { call.reject("Wi-Fi Direct no disponible", "WD_UNAVAILABLE"); return }
        m.createGroup(ch, cfg, object : WifiP2pManager.ActionListener {
            override fun onSuccess() {
                try {
                    try { wdServer?.close() } catch (e: Exception) {}
                    val server = java.net.ServerSocket(0)
                    server.soTimeout = 90000
                    wdServer = server
                    remLog("INFO", "WIFI_DIRECT", "Grupo creado para $transferId, puerto ${server.localPort}")
                    call.resolve(JSObject().put("ssid", name).put("passphrase", pass).put("port", server.localPort))
                    // Archivo grande (ronda 2756): del socket al disco, sin pasar por la app
                    if (bigToken != null) Thread {
                        try { BigNet.serve(server, BigFile.safeId(transferId), bigToken, BigFile.encFile(bigDir(), transferId), BigFile.MAX_BYTES * 11 / 10, bigProgress(BigFile.safeId(transferId), "in")); bigDone(BigFile.safeId(transferId), "in", null) }
                        catch (e: Exception) { bigDone(BigFile.safeId(transferId), "in", e.message ?: "error") }
                        finally { try { server.close() } catch (e: Exception) {}; if (wdServer === server) wdServer = null; wdTearDown() }
                    }.start()
                    else Thread { wdReceive(server, transferId) }.start()
                } catch (e: Exception) {
                    wdTearDown()
                    call.reject("Socket no disponible: ${e.message}", "WD_SOCKET")
                }
            }
            override fun onFailure(reason: Int) {
                if (!wdWifiOn()) {
                    remLog("WARN", "WIFI_DIRECT", "Crear grupo para $transferId falló ($reason): Wi-Fi APAGADO")
                    call.reject("Wi-Fi apagado", "WD_WIFI_OFF")
                } else if (attempt < retryMs.size) {
                    remLog("WARN", "WIFI_DIRECT", "Crear grupo para $transferId falló ($reason), intento ${attempt + 1}: se reintenta en ${retryMs[attempt]} ms")
                    mainHandler.postDelayed({
                        if (attempt == 1) p2pReset()   // al segundo reintento, canal nuevo
                        start(attempt + 1)
                    }, retryMs[attempt])
                } else wdState { st ->
                    remLog("WARN", "WIFI_DIRECT", "No se pudo crear el grupo para $transferId ($reason) tras ${attempt + 1} intentos. Estado: $st")
                    call.reject("No se pudo crear el grupo ($reason; $st)", "WD_GROUP")
                }
            }
        })
    }
    start = { attempt ->
        val m = p2pManager
        val ch = p2pChannel
        if (m == null || ch == null) call.reject("Wi-Fi Direct no disponible", "WD_UNAVAILABLE")
        else m.removeGroup(ch, object : WifiP2pManager.ActionListener {
            override fun onSuccess() { create(attempt) }
            override fun onFailure(reason: Int) { create(attempt) }
        })
    }
    mainHandler.post { start(0) }
}

private fun NexoBlePlugin.wdReceive(server: java.net.ServerSocket, transferId: String) {
    try {
        server.accept().use { sock ->
            sock.soTimeout = 30000
            val tRead = System.currentTimeMillis()
            val input = java.io.DataInputStream(java.io.BufferedInputStream(sock.getInputStream()))
            val h = JSONObject(input.readUTF())
            if (h.optString("id") != transferId) throw Exception("transferencia distinta")
            val len = h.optLong("len")
            if (len <= 0 || len > WD_MAX_BYTES) throw Exception("tamaño no válido")
            val buf = ByteArray(len.toInt())
            input.readFully(buf)
            sock.getOutputStream().apply { write(1); flush() }
            val readMs = System.currentTimeMillis() - tRead
            remLog("INFO", "WIFI_DIRECT", "Recibido $transferId ($len bytes) en $readMs ms")
            notifyListeners("onWifiDirectReceived", JSObject().put("transferId", transferId).put("data", String(buf, Charsets.UTF_8)).put("bytes", len)
                .put("readMs", readMs).put("ts", System.currentTimeMillis()), true)
        }
    } catch (e: Exception) {
        remLog("WARN", "WIFI_DIRECT", "Recepción fallida $transferId: ${e.message}")
        notifyListeners("onWifiDirectReceived", JSObject().put("transferId", transferId).put("error", e.message ?: "error"), true)
    } finally {
        try { server.close() } catch (e: Exception) {}
        if (wdServer === server) wdServer = null
        wdTearDown()
    }
}

@android.annotation.SuppressLint("MissingPermission")
internal fun NexoBlePlugin.wifiDirectSendImpl(call: PluginCall) {
    val ssid = call.getString("ssid") ?: run { call.reject("ssid requerido"); return }
    val pass = call.getString("passphrase") ?: run { call.reject("passphrase requerido"); return }
    val port = call.getInt("port") ?: run { call.reject("port requerido"); return }
    val transferId = call.getString("transferId") ?: run { call.reject("transferId requerido"); return }
    // Archivo grande (ronda 2756): se manda el archivo cifrado del disco (bigToken) en vez de "data"
    val bigToken = call.getString("bigToken")?.takeIf { it.length >= 16 }
    val bigFile = if (bigToken != null) BigFile.encFile(bigDir(), transferId) else null
    if (bigFile != null && !bigFile.exists()) { call.reject("Nada que enviar", "BIG_NONE"); return }
    val data = if (bigFile != null) "" else (call.getString("data") ?: run { call.reject("data requerido"); return })
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !p2pInit() || !wdPermissionGranted()) {
        call.reject("Wi-Fi Direct no disponible", "WD_UNAVAILABLE"); return
    }
    if (!wdWifiOn()) {
        remLog("WARN", "WIFI_DIRECT", "No se envía $transferId por Wi-Fi Direct: Wi-Fi APAGADO")
        call.reject("Wi-Fi apagado", "WD_WIFI_OFF"); return
    }
    val m = p2pManager!!
    val ch = p2pChannel!!
    val t0 = System.currentTimeMillis()
    // Tiempo que tardó el contenido en pasar de la app (WebView) a Android
    val jsTs = call.getLong("jsTs") ?: t0
    val bridgeMs = (t0 - jsTs).coerceAtLeast(0)
    val cfg = WifiP2pConfig.Builder().setNetworkName(ssid).setPassphrase(pass).build()
    fun push(addr: java.net.InetAddress) {
        val tJoined = System.currentTimeMillis()
        Thread {
            if (bigFile != null) {
                try {
                    java.net.Socket().use { s ->
                        s.connect(java.net.InetSocketAddress(addr, port), 10000)
                        s.soTimeout = 60000
                        BigNet.send(s, BigFile.safeId(transferId), bigToken!!, bigFile, bigProgress(BigFile.safeId(transferId), "out"))
                    }
                    bigDone(BigFile.safeId(transferId), "out", null)
                    call.resolve(JSObject().put("ok", true).put("bytes", bigFile.length()).put("joinMs", tJoined - t0).put("xferMs", System.currentTimeMillis() - tJoined))
                } catch (e: Exception) {
                    bigDone(BigFile.safeId(transferId), "out", e.message ?: "error")
                    call.reject("Envío fallido: ${e.message}", "WD_SEND")
                } finally { wdTearDown() }
            } else try {
                val bytes = data.toByteArray(Charsets.UTF_8)
                java.net.Socket().use { s ->
                    s.connect(java.net.InetSocketAddress(addr, port), 10000)
                    s.soTimeout = 60000
                    val out = java.io.DataOutputStream(java.io.BufferedOutputStream(s.getOutputStream()))
                    out.writeUTF(JSONObject().put("id", transferId).put("len", bytes.size).toString())
                    out.write(bytes)
                    out.flush()
                    if (s.getInputStream().read() != 1) throw Exception("sin confirmación")
                }
                val now = System.currentTimeMillis()
                val ms = now - t0
                remLog("INFO", "WIFI_DIRECT", "Enviado $transferId (${bytes.size} bytes) en $ms ms (unirse ${tJoined - t0} ms, envío ${now - tJoined} ms, de la app a Android $bridgeMs ms)")
                call.resolve(JSObject().put("ok", true).put("ms", ms).put("bytes", bytes.size)
                    .put("joinMs", tJoined - t0).put("xferMs", now - tJoined).put("bridgeMs", bridgeMs))
            } catch (e: Exception) {
                call.reject("Envío fallido: ${e.message}", "WD_SEND")
            } finally {
                wdTearDown()
            }
        }.start()
    }
    fun waitGroup(attempt: Int) {
        m.requestConnectionInfo(ch) { info ->
            val addr = info?.groupOwnerAddress
            if (info != null && info.groupFormed && addr != null) push(addr)
            else if (attempt < 80) mainHandler.postDelayed({ waitGroup(attempt + 1) }, 250)
            else wdState { st ->
                remLog("WARN", "WIFI_DIRECT", "No se pudo entrar al grupo del otro para $transferId en 20 s. Estado: $st")
                wdTearDown(); call.reject("El grupo no se formó ($st)", "WD_TIMEOUT")
            }
        }
    }
    mainHandler.post {
        m.connect(ch, cfg, object : WifiP2pManager.ActionListener {
            override fun onSuccess() { waitGroup(0) }
            override fun onFailure(reason: Int) {
                wdState { st ->
                    remLog("WARN", "WIFI_DIRECT", "No se pudo conectar al grupo del otro para $transferId ($reason). Estado: $st")
                    call.reject("No se pudo conectar ($reason; $st)", "WD_CONNECT")
                }
            }
        })
    }
}
