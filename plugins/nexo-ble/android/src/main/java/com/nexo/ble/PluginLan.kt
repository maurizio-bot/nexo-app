package com.nexo.ble

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall

// Wi-Fi de la misma red (LanHub + NSD) y aviso de cambio de red (Wi-Fi ↔ datos).
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

// 3272 (COLA 3; «Sin Wi-Fi con X (este teléfono no tiene Wi-Fi)» siendo falso): la red Wi-Fi (o de cable) de este teléfono aunque NO sea
// la red por defecto. Con un Wi-Fi sin internet Android deja los datos móviles como red por defecto y el Wi-Fi sigue conectado (y desde
// la 3266 se lo pedimos antes): el Wi-Fi local con quien está en el mismo router sigue siendo un camino. No cuenta el grupo de Wi-Fi Direct.
private fun NexoBlePlugin.lanWifiNet(): android.net.Network? = try {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
    fun wifi(n: android.net.Network?): Boolean {
        val c = (if (n != null) cm.getNetworkCapabilities(n) else null) ?: return false
        // Auditoría 23-11 (punto 6): una VPN no es «la misma Wi-Fi» (su red puede llevar TRANSPORT_WIFI debajo): fuera; con la VPN como
        // red activa se busca la Wi-Fi de verdad entre todas (abajo)
        return (c.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET)) &&
            !c.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_WIFI_P2P) &&
            !c.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN) && c.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
    }
    val act = cm.activeNetwork
    @Suppress("DEPRECATION")
    if (wifi(act)) act else cm.allNetworks.firstOrNull { wifi(it) }
} catch (e: Exception) { null }
private fun NexoBlePlugin.lanOnWifi(): Boolean = lanWifiNet() != null

// 3266 (COLA 27; S24 y Motorola 20-11 14:07: 2 min 17 s con un Wi-Fi sin salida hasta que Android pasó solo a datos): la app ve que
// ningún relé abre estando en Wi-Fi y se lo dice a Android, que vuelve a comprobar esa red al momento y, si de verdad no da internet,
// pasa a datos móviles. No fuerza nada: si la red sí tiene internet, Android la deja como está. Como mucho una vez por minuto.
private var lastNoNetReportAt = 0L
internal fun NexoBlePlugin.reportNoInternetImpl(call: PluginCall) {
    try {
        val cm = (appCtx ?: context).getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val net = cm.activeNetwork
        val caps = if (net != null) cm.getNetworkCapabilities(net) else null
        val now = android.os.SystemClock.elapsedRealtime()
        if (net == null || caps == null || !caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)) { call.resolve(JSObject().put("reported", false).put("why", "sin Wi-Fi")); return }
        if (lastNoNetReportAt != 0L && now - lastNoNetReportAt < 60000L) { call.resolve(JSObject().put("reported", false).put("why", "ya avisado")); return }
        lastNoNetReportAt = now
        cm.reportNetworkConnectivity(net, false)
        remLog("INFO", "NET", "Wi-Fi sin internet (ningún relé abre): se pide a Android que lo compruebe (pasa a datos móviles si no hay)")
        call.resolve(JSObject().put("reported", true))
    } catch (e: Exception) { call.resolve(JSObject().put("reported", false).put("why", e.javaClass.simpleName)) }
}

internal fun NexoBlePlugin.lanStatusImpl(call: PluginCall) {
    // Calidad de cada conexión (latido nativo): ida y vuelta media y tiempo sin recibir
    val peers = JSArray()
    lanHub?.quality()?.forEach { (nx, rtt, idle) -> peers.put(JSObject().put("nx", nx).put("rtt", rtt).put("idle", idle)) }
    call.resolve(JSObject().put("supported", true).put("wifi", lanOnWifi()).put("running", lanHub != null).put("port", lanHub?.port ?: 0).put("peers", peers))
}

internal fun NexoBlePlugin.lanStartImpl(call: PluginCall) {
    val nx = call.getString("nexoId")?.lowercase() ?: run { call.reject("nexoId requerido"); return }
    val token = call.getString("token") ?: run { call.reject("token requerido"); return }
    try {
        lanMyId = nx
        // (ronda 2772: tiempos con elapsedRealtime, que cuenta con el teléfono dormido; ver LanHub.tick)
        val hub = lanHub ?: LanHub({ lanMyId }, object : LanHub.Listener {
            override fun onUp(nx: String) { remLog("INFO", "LAN", "Conectado con $nx por Wi-Fi"); notifyListeners("onLanUp", JSObject().put("nx", nx), true) }
            override fun onDown(nx: String) { remLog("INFO", "LAN", "Sin Wi-Fi con $nx"); notifyListeners("onLanDown", JSObject().put("nx", nx), true) }
            override fun onMessage(nx: String, text: String) { backgroundNotify(text, null, nx); notifyListeners("onLanMessage", JSObject().put("nx", nx).put("content", text), true) }
            override fun onLog(level: String, message: String) { remLog(level, "LAN", message) }
        }, clock = { android.os.SystemClock.elapsedRealtime() },
            // 3272: cada conexión sale por la red Wi-Fi aunque la red por defecto sean los datos (si no se puede atar, como siempre)
            prepare = { sock -> lanWifiNet()?.bindSocket(sock) },
            // 12A (23-11): contactos = los que tienen clave de pareja en el nativo; sin ninguna aún (recién abierta), no se sabe
            knows = { n -> if (NexoBlePlugin.ackKeys.isEmpty()) null else NexoBlePlugin.ackKeys.containsKey(n.lowercase()) }).also { lanHub = it }
        val port = hub.start()
        // Escaneo activo: pregunta a toda la red (difusión) y, de vez en cuando o al entrar en una red, una a una
        val beacon = lanBeacon ?: LanBeacon(object : LanBeacon.Listener {
            override fun onPeer(token: String, host: String, port: Int) {
                notifyListeners("onLanPeer", JSObject().put("token", token).put("host", host).put("port", port).put("src", "scan"))
            }
            override fun onLog(level: String, message: String) { remLog(level, "LAN", message) }
        }).also { lanBeacon = it }
        beacon.start(token, port)
        val now = System.currentTimeMillis()
        val sweep = call.getBoolean("sweep", false) == true || now - lanLastSweep > 300000L
        if (sweep) lanLastSweep = now
        if (lanOnWifi()) beacon.scan(sweep)
        lanWatchWifi()
        val nsd = nsdManager ?: (context.getSystemService(Context.NSD_SERVICE) as android.net.nsd.NsdManager).also { nsdManager = it }
        if (lanMcLock == null) {
            val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            lanMcLock = wm.createMulticastLock("nexo-lan").apply { setReferenceCounted(false); acquire() }
        }
        // Anuncio (se rehace si cambia la marca del día)
        if (nsdReg == null || token != lanToken) {
            nsdReg?.let { try { nsd.unregisterService(it) } catch (e: Exception) {} }
            lanToken = token
            lanServiceName = "NEXO-" + wdRandom(6)
            val info = android.net.nsd.NsdServiceInfo().apply {
                serviceName = lanServiceName; serviceType = "_nexo._tcp"; setPort(port); setAttribute("t", token)
            }
            val reg = object : android.net.nsd.NsdManager.RegistrationListener {
                override fun onServiceRegistered(si: android.net.nsd.NsdServiceInfo) { lanServiceName = si.serviceName; remLog("INFO", "LAN", "Anunciado en la red (puerto $port)") }
                override fun onRegistrationFailed(si: android.net.nsd.NsdServiceInfo, code: Int) { remLog("WARN", "LAN", "No se pudo anunciar ($code)"); if (nsdReg === this) nsdReg = null }
                override fun onServiceUnregistered(si: android.net.nsd.NsdServiceInfo) {}
                override fun onUnregistrationFailed(si: android.net.nsd.NsdServiceInfo, code: Int) {}
            }
            nsdReg = reg
            nsd.registerService(info, android.net.nsd.NsdManager.PROTOCOL_DNS_SD, reg)
        }
        // Búsqueda (se reinicia en cada llamada: Android a veces deja de informar)
        nsdDisc?.let { try { nsd.stopServiceDiscovery(it) } catch (e: Exception) {} }
        val disc = object : android.net.nsd.NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(t: String) {}
            override fun onDiscoveryStopped(t: String) {}
            override fun onStartDiscoveryFailed(t: String, code: Int) { remLog("WARN", "LAN", "Búsqueda fallida ($code)"); if (nsdDisc === this) nsdDisc = null }
            override fun onStopDiscoveryFailed(t: String, code: Int) {}
            override fun onServiceFound(si: android.net.nsd.NsdServiceInfo) {
                if (si.serviceName == lanServiceName) return
                nsdResolveQueue.add(si); lanResolveNext()
            }
            override fun onServiceLost(si: android.net.nsd.NsdServiceInfo) {}
        }
        nsdDisc = disc
        nsd.discoverServices("_nexo._tcp", android.net.nsd.NsdManager.PROTOCOL_DNS_SD, disc)
        call.resolve(JSObject().put("port", port).put("wifi", lanOnWifi()))
    } catch (e: Exception) {
        call.reject("Wi-Fi no disponible: ${e.message}", "LAN_UNAVAILABLE")
    }
}

// Android resuelve de uno en uno
@Suppress("DEPRECATION")
private fun NexoBlePlugin.lanResolveNext() {
    val nsd = nsdManager ?: return
    if (nsdResolving) return
    val si = nsdResolveQueue.poll() ?: return
    nsdResolving = true
    try {
        nsd.resolveService(si, object : android.net.nsd.NsdManager.ResolveListener {
            override fun onServiceResolved(info: android.net.nsd.NsdServiceInfo) {
                nsdResolving = false
                val host = info.host?.hostAddress
                val t = info.attributes["t"]?.let { String(it, Charsets.UTF_8) }
                if (host != null && t != null && t != lanToken) {
                    notifyListeners("onLanPeer", JSObject().put("token", t).put("host", host).put("port", info.port).put("src", "mdns"))
                }
                lanResolveNext()
            }
            override fun onResolveFailed(info: android.net.nsd.NsdServiceInfo, code: Int) {
                nsdResolving = false
                if (code == android.net.nsd.NsdManager.FAILURE_ALREADY_ACTIVE) { nsdResolveQueue.add(info); mainHandler.postDelayed({ lanResolveNext() }, 300) }
                else lanResolveNext()
            }
        })
    } catch (e: Exception) { nsdResolving = false; lanResolveNext() }
}

internal fun NexoBlePlugin.lanConnectImpl(call: PluginCall) {
    val host = call.getString("host") ?: run { call.reject("host requerido"); return }
    val port = call.getInt("port") ?: run { call.reject("port requerido"); return }
    val hub = lanHub ?: run { call.reject("Wi-Fi no iniciado", "LAN_UNAVAILABLE"); return }
    hub.connect(host, port)
    call.resolve(JSObject().put("connecting", true))
}

// Fuera del hilo de los plugins (un archivo grande tarda en escribirse) y en orden
// Auditoría 23-11 (T-D2): la app comprobó con el cifrado que la conexión es del contacto (lan.js, 'lw'): marcos grandes permitidos
internal fun NexoBlePlugin.lanVerifiedImpl(call: PluginCall) {
    val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
    lanHub?.markVerified(nx)
    call.resolve()
}

internal fun NexoBlePlugin.lanSendImpl(call: PluginCall) {
    val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
    val content = call.getString("content") ?: run { call.reject("content requerido"); return }
    val hub = lanHub ?: run { call.reject("Wi-Fi no iniciado", "LAN_DOWN"); return }
    lanSendExec.execute {
        if (hub.send(nx, content)) call.resolve(JSObject().put("sent", true))
        else call.reject("Sin conexión Wi-Fi con $nx", "LAN_DOWN")
    }
}

internal fun NexoBlePlugin.lanDropImpl(call: PluginCall) {
    val nx = call.getString("nx") ?: run { call.reject("nx requerido"); return }
    lanHub?.close(nx)
    call.resolve(JSObject().put("dropped", true))
}

internal fun NexoBlePlugin.lanStopImpl(call: PluginCall) {
    lanStopAll()
    call.resolve(JSObject().put("stopped", true))
}

internal fun NexoBlePlugin.watchDefaultNetwork() {
    if (defNetCb != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
    try {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val cb = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: android.net.Network, caps: android.net.NetworkCapabilities) {
                val t = NetChange.typeOf(
                    caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI),
                    caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR),
                    caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_ETHERNET),
                    caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN))
                mainHandler.post { reportNetType(t) }
            }
            override fun onLost(network: android.net.Network) {
                // Al cambiar de red Android puede avisar de la pérdida de la vieja DESPUÉS de dar la nueva: solo «sin red» si de verdad no hay
                mainHandler.post { try { if (cm.activeNetwork == null) reportNetType("none") } catch (e: Exception) { } }
            }
        }
        cm.registerDefaultNetworkCallback(cb)
        defNetCb = cb
    } catch (e: Exception) { remLog("WARN", "NET", "Sin aviso de cambio de red: ${e.message}") }
}
internal fun NexoBlePlugin.unwatchDefaultNetwork() {
    defNetCb?.let { cb -> try { (context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).unregisterNetworkCallback(cb) } catch (e: Exception) { } }
    defNetCb = null
}
private fun NexoBlePlugin.reportNetType(t: String) {
    val prev = netTracker.update(t) ?: return
    remLog("INFO", "NET", "Red por defecto: $prev → $t")
    notifyListeners("onNetChange", JSObject().put("type", t).put("prev", prev))
}

// Al conectarse a una red Wi-Fi: escanear ya (una a una) y avisar a la app (vuelve a anunciarse y buscar)
private fun NexoBlePlugin.lanWatchWifi() {
    if (lanNetCb != null) return
    try {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val req = android.net.NetworkRequest.Builder().addTransportType(android.net.NetworkCapabilities.TRANSPORT_WIFI).build()
        val cb = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) {
                mainHandler.postDelayed({
                    lanLastSweep = System.currentTimeMillis()
                    lanBeacon?.scan(true)
                    notifyListeners("onLanNet", JSObject().put("wifi", true))
                }, 1500)
            }
        }
        cm.registerNetworkCallback(req, cb)
        lanNetCb = cb
    } catch (e: Exception) { remLog("WARN", "LAN", "Sin aviso de red Wi-Fi: ${e.message}") }
}

internal fun NexoBlePlugin.lanStopAll() {
    lanNetCb?.let { cb -> try { (context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).unregisterNetworkCallback(cb) } catch (e: Exception) {} }
    lanNetCb = null
    lanBeacon?.stop(); lanBeacon = null
    val nsd = nsdManager
    nsdReg?.let { try { nsd?.unregisterService(it) } catch (e: Exception) {} }
    nsdDisc?.let { try { nsd?.stopServiceDiscovery(it) } catch (e: Exception) {} }
    nsdReg = null; nsdDisc = null
    try { lanMcLock?.release() } catch (e: Exception) {}
    lanMcLock = null
    lanHub?.stop(); lanHub = null
}
