package com.nexo.ble

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.util.Log
import java.io.File

/**
 * 3192 (#87, dueño 17-11 «Ok» a guardar cifrada la configuración): la escucha de internet (NetBg) es UNA por proceso y vive aquí, no en
 * el plugin: así puede arrancar SIN la app (proceso nuevo, sin WebView ni plugin) desde lo que la app dejó guardado y cifrado
 * (NetBgSaved): al volver NEXO sola (3189: reinicio, actualización, alarma de vigilancia), con un toque FCM o cuando Android reinicia el
 * servicio. Antes, en un proceso así el servicio estaba en marcha pero no recibía nada por internet ni avisaba.
 *
 * Relevo con la app (comprobado en NetBgSinAppTest con la misma NetBg):
 *  - La app (NexoBlePlugin.netBg) usa ESTA misma instancia: nunca hay dos escuchando. Al cargar el plugin (load) se suelta el WifiLock
 *    de aquí (appTookOver); la app para la escucha al ponerse a la vista (handleOnResume) y la vuelve a arrancar al ocultarse, como
 *    siempre. Lo recibido sin la app queda en la misma NetBg (keepForApp) y la app lo recoge con netBgDrain.
 *  - Lo que la escucha oye va a la app si su plugin vive (live u orphan: sus reglas de chat abierto, su despertar), y si no, aquí, con
 *    las MISMAS reglas y textos que la app cerrada con el proceso vivo (notifyMessage, requestNotify, nombres de contactos y grupos).
 * Registro nativo (el del diagnóstico, sin datos sensibles): «Internet sin la app: escuchando N contacto(s) en M relé(s) (tras <motivo>)»
 * y, si no se puede, por qué (sin configuración guardada, de otra cuenta, no se pudo leer o arrancar: solo el tipo de error).
 */
object NetBgHome {
    // Extra del intent a BleService del toque FCM (para el motivo en el registro)
    const val EXTRA_FCM = "nexo_netbg_fcm"
    private const val TAG = "NEXO_NET"
    private const val RX_WAKE_MS = 15000L // como NexoBlePlugin.rxWake

    @Volatile private var shared: NetBg? = null
    // La escucha corre sin la app (la arrancó startWithoutApp) y con el WifiLock de aquí
    @Volatile private var withoutApp = false
    private val writer = NetBgSaved.Writer()
    @Volatile private var saveFailLogged = false
    private var atRest: AtRestStore? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var rxLock: PowerManager.WakeLock? = null
    @Volatile private var groups: Pair<Long, Map<String, String>>? = null
    // El mismo «no se puede» seguido (el toque FCM y el servicio que arranca lo intentan los dos) va una sola vez al registro
    private var lastNo: Pair<String, Long>? = null
    private fun logNo(ctx: Context, msg: String) {
        val now = System.currentTimeMillis(); val l = lastNo
        if (l != null && l.first == msg && now - l.second < 60_000) return
        lastNo = msg to now
        log(ctx, msg, "WARN")
    }

    fun peek(): NetBg? = shared
    fun get(ctx: Context): NetBg = shared ?: synchronized(this) { shared ?: create(ctx.applicationContext ?: ctx).also { shared = it } }

    // El plugin que vive en este proceso (la app abierta o en segundo plano; o cerrada con el proceso vivo, ronda 2758)
    private fun host(): NexoBlePlugin? = NexoBlePlugin.live ?: NexoBlePlugin.orphan

    private fun create(app: Context): NetBg = NetBg({ nx, name, msgId, isCall, group, video ->
        val p = host()
        if (p != null) p.netBgOnMessage(nx, name, msgId, isCall, group, video)
        else {
            rxWake(app) // como la app en segundo plano (ronda 2774): despierto 15 s para avisar antes de que el teléfono vuelva a dormir
            notifyMessage(app, nx, name, msgId, isCall, group, video, false) { groupName(app, it) } // sin la app no hay chat abierto
        }
    }, { log(app, it) }, { nx, offer ->
        // 3087: el que llama colgó (sobre con ce, por internet) → deja de sonar ya
        if (MsgNotifier.get(app).cancelCallFor(nx, offer)) log(app, "$nx colgó: la llamada deja de sonar")
    }, { req -> requestNotify(app, req) }, { ts -> NetBgSaved.callTooOld(ts, System.currentTimeMillis()) },
        { json -> saveOutbox(app, json) }, { url, token -> wakePost(app, url, token) }, { reportNoInternet(app) },
        { id, json -> saveBlob(app, id, json) }).also { watchNet(app, it) }

    // 3270 (COLA 27 sin la app; como PluginLan.reportNoInternetImpl con la app): el Wi-Fi no da internet → se le dice a Android para que
    // lo compruebe y pase a datos móviles. Solo con Wi-Fi como red activa; la escucha ya lo frena a una vez por minuto.
    private fun reportNoInternet(ctx: Context) {
        try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val net = cm.activeNetwork ?: return
            val caps = cm.getNetworkCapabilities(net) ?: return
            if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return
            cm.reportNetworkConnectivity(net, false)
        } catch (e: Throwable) { log(ctx, "Internet en segundo plano: no se pudo avisar del Wi-Fi sin internet (${e.javaClass.simpleName})", "WARN") }
    }

    // ===== 3268 (PRIORIDAD 1, fase 3; COLA 29): bandeja de salida =====
    // Se guarda cifrada en reposo cada vez que cambia (algo salió, llegó su ✓✓, la app dio otra lista): así sigue saliendo aunque
    // Android mate el proceso y NEXO vuelva sola. Con la app viva en el proceso, con SU almacén (el mismo cerrojo que sus archivos).
    // Pasando la cuenta a otro teléfono no se escribe nada (moveFrozen, como la configuración).
    private val outLock = Any()
    internal fun saveOutbox(ctx: Context, json: String) {
        val p = host()
        if (p != null && p.moveFrozen) return
        save(ctx) { synchronized(outLock) { NetBgSaved.saveOut(p?.atRest() ?: store(ctx), writer, json) } }
    }

    // 3281: los trozos de un archivo de la bandeja (ya cifrados y firmados por la app), cifrados en reposo como la lista; json null = borrar
    internal fun saveBlob(ctx: Context, id: String, json: String?) {
        val p = host()
        if (p != null && p.moveFrozen) return
        save(ctx) {
            synchronized(outLock) {
                val st = p?.atRest() ?: store(ctx); val name = NetBgSaved.blobFile(id)
                if (json == null) st.delete(name) else { st.write(name, json); true }
            }
        }
    }
    /** Trozos guardados que ya no son de nada de la bandeja (el proceso murió entre un paso y otro): fuera. */
    internal fun sweepBlobs(ctx: Context, keepIds: Set<String>) {
        val keep = keepIds.map { NetBgSaved.blobFile(it) }.toSet()
        save(ctx) {
            synchronized(outLock) {
                var n = 0
                try { (ctx.filesDir.listFiles() ?: emptyArray()).forEach { f -> if (f.isFile && f.name.startsWith(NetBgSaved.BLOB_PREFIX) && f.name.removeSuffix(".nxtmp") !in keep && f.delete()) n++ } } catch (e: Throwable) { }
                n > 0
            }
        }
    }

    // El «toque» que despierta al otro teléfono tras subir un mensaje de la bandeja: lo MISMO que hace la app (wake_post.js): un POST
    // con solo el token del otro (nunca el contenido) al enviador. En un hilo aparte (no se frena la escucha) y sin reintentos.
    private fun wakePost(ctx: Context, url: String, token: String) {
        if (!url.startsWith("https://") || token.length < 20) return
        Thread({
            var c: java.net.HttpURLConnection? = null
            try {
                c = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                    requestMethod = "POST"; connectTimeout = 10000; readTimeout = 10000; doOutput = true
                    setRequestProperty("Content-Type", "text/plain;charset=UTF-8")
                }
                c.outputStream.use { it.write(org.json.JSONObject().put("to", token).toString().toByteArray(Charsets.UTF_8)) }
                log(ctx, "Bandeja de salida: toque al otro teléfono: el enviador contestó ${c.responseCode}")
            } catch (e: Throwable) {
                log(ctx, "Bandeja de salida: el toque no salió (${e.javaClass.simpleName})", "WARN")
            } finally { try { c?.disconnect() } catch (e: Throwable) { } }
        }, "nexo-toque").apply { isDaemon = true }.start()
    }

    // 3204 (dueño 17-11 «Ok» a 2 conexiones con datos móviles; parte nativa de la 3193): la escucha ve ELLA el tipo de la red por defecto
    // (también sin la app, cuando no hay plugin que avise): con datos móviles escucha solo 2 relés (NetBg.listenPlan). Se mira ya (para
    // que la primera vuelta no abra todos para soltarlos enseguida) y se sigue con el aviso de Android de cambio de red por defecto (el
    // mismo tipo que NetChange da a la app). Una por proceso, como la escucha. Si no se puede, NetBg escucha todos, como siempre.
    private var netCb: ConnectivityManager.NetworkCallback? = null
    private fun netType(caps: NetworkCapabilities?): String = if (caps == null) "none" else NetChange.typeOf(
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI), caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR),
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET), caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN))
    @Synchronized private fun watchNet(ctx: Context, bg: NetBg) {
        try {
            val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val n = cm.activeNetwork
            bg.setNet(if (n == null) "none" else netType(cm.getNetworkCapabilities(n)))
            if (netCb != null) return
            val cb = object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) { bg.setNet(netType(caps)) }
                // Al cambiar de red Android puede dar por perdida la vieja DESPUÉS de dar la nueva: «sin red» solo si de verdad no hay
                override fun onLost(network: Network) { try { if (cm.activeNetwork == null) bg.setNet("none") } catch (e: Exception) { } }
            }
            cm.registerDefaultNetworkCallback(cb)
            netCb = cb
        } catch (e: Throwable) { log(ctx, "Internet en segundo plano: sin aviso del tipo de red (${e.javaClass.simpleName}): escucho todos los relés", "WARN") }
    }

    // Al registro nativo (el MISMO archivo que lee el diagnóstico, compartido con el plugin) y a logcat
    internal fun log(ctx: Context, msg: String, level: String = "INFO") {
        Log.i(TAG, msg)
        try {
            val l = NexoBlePlugin.nativeLogShared ?: synchronized(NexoBlePlugin::class.java) {
                NexoBlePlugin.nativeLogShared ?: NativeLog(File(ctx.filesDir, NexoBlePlugin.NATIVE_LOG_FILE)).also { NexoBlePlugin.nativeLogShared = it }
            }
            l.add(level, "NET", msg)
        } catch (e: Throwable) { }
    }

    // ===== Aviso de un sobre con un mensaje nuevo (antes dentro de NexoBlePlugin.netBg: las mismas reglas con y sin la app) =====
    // silent = su chat está abierto en un parpadeo a segundo plano (3172, lo decide la app viva); sin la app, false.
    // 3254: how = por dónde llegó (para el registro): «por internet» o «por Bluetooth sin la app» (BleSinApp)
    fun notifyMessage(ctx: Context, nx: String, name: String, msgId: String, isCall: Boolean, group: String, video: Boolean, silent: Boolean,
                      how: String = "por internet", groupName: (String) -> String?) {
        val seen = !isCall && SeenMsgs.has(ctx, msgId)
        val gname = if (isCall || seen || silent) null else groupName(group)
        // 3219: chat o grupo silenciado (la lista la da la app; sin la app, la de lo guardado)
        if (!isCall) MutedChats.ensureLoaded({ store(ctx).read(MutedChats.FILE) })
        val muted = !isCall && !seen && !silent && MutedChats.silences(false, nx, group, gname != null)
        when (NetBgSaved.notice(isCall, seen, silent, gname != null, muted)) {
            // #130b (dueño 31-10): una oferta de llamada/videollamada que llega por internet con la app en segundo plano o
            // congelada tiene que salir a PANTALLA COMPLETA (enciende el teléfono, Contestar/Rechazar), como la 1-a-1 por
            // Bluetooth y como las llamadas de grupo. Antes salía como «mensaje nuevo» porque NetBg solo miraba el msgId.
            NetBgSaved.Notice.CALL -> {
                log(ctx, "oferta de llamada de $nx por internet (msgId $msgId): pantalla de llamada")
                MsgNotifier.get(ctx).incomingCall(nx, name, video, msgId) // 3089: «Videollamada entrante» si lo es
            }
            // 3008: reenvío de un mensaje que este teléfono ya tiene → sin «Mensaje nuevo» (la ✓✓ sí se devuelve, para que el otro pare)
            NetBgSaved.Notice.OLD -> log(ctx, "sobre de $nx (msgId $msgId): ese mensaje ya estaba en el teléfono (reenvío): sin aviso")
            NetBgSaved.Notice.OPEN_CHAT -> log(ctx, "sobre de $nx (msgId $msgId): su chat está abierto (parpadeo a segundo plano): sin aviso")
            NetBgSaved.Notice.MUTED -> log(ctx, "sobre de $nx (msgId $msgId): chat silenciado: sin aviso")
            // 3076: un mensaje de GRUPO avisa en el grupo, con su nombre y quién lo manda (como por Bluetooth: notifyMessage)
            NetBgSaved.Notice.GROUP -> {
                log(ctx, "sobre de $nx (msgId $msgId): aviso de mensaje nuevo $how (grupo $group)")
                MsgNotifier.get(ctx).message(group, gname!!, msgId, "$name: " + NativeLang.t(ctx, "msg_new"), true)
            }
            NetBgSaved.Notice.CHAT -> {
                log(ctx, "sobre de $nx (msgId $msgId): aviso de mensaje nuevo $how")
                MsgNotifier.get(ctx).message(nx, name, msgId, "", true)
            }
        }
    }

    // 3190 (dueño 17-11: «hay que poner esa notificación: hay un contacto que te quiere agregar»): NetBg oyó una solicitud de contacto en
    // mi buzón con la app en segundo plano o cerrada → aviso del teléfono («Ana (NX…) quiere agregarte en NEXO»), con freno anti-spam
    // (ReqNotifyPolicy: 1 por remitente cada 24 h, 3 por hora; el resto, en un aviso agrupado y callado). El freno se guarda en las
    // preferencias (sobrevive a un reinicio del proceso). Con la app a la vista no: ahí basta el aviso de dentro de la app. La
    // solicitud la guarda la app en «Solicitudes para ti» al abrirse (NetBg se la pasa con netBgDrain). Al registro: el NEXO ID, no el contenido.
    // 3192: movido tal cual desde PluginBackground.requestNotify (solo necesita Context: también sin la app).
    private const val PREF_REQ_NOTIFY = "req_notify_state"
    fun requestNotify(ctx: Context, req: NetBg.Req) {
        val lv = NexoBlePlugin.live
        if (lv != null && !lv.appInBackground && !lv.closedMode) { log(ctx, "Solicitud de ${req.from}: la app está a la vista: sin aviso del teléfono"); return }
        val now = System.currentTimeMillis()
        val (verdict, grouped) = synchronized(ReqNotifyPolicy) {
            val prefs = ctx.getSharedPreferences(MsgNotifier.PREFS, Context.MODE_PRIVATE)
            val st = ReqNotifyPolicy.State.fromJson(prefs.getString(PREF_REQ_NOTIFY, null))
            val v = ReqNotifyPolicy.decide(st, req.from, now)
            prefs.edit().putString(PREF_REQ_NOTIFY, st.toJson()).apply()
            v to st.groupN
        }
        val what = if (req.kind == "acc") "aceptación" else "solicitud"
        when (verdict) {
            ReqNotifyPolicy.Verdict.NOTIFY -> {
                val ok = MsgNotifier.get(ctx).contactRequest(req.from, ReqNotifyPolicy.body(NativeLang.get(ctx), req.name, req.from, req.kind == "acc", req.twin))
                log(ctx, "Solicitud de ${req.from} ($what${if (req.twin.isNotEmpty()) ", nombre de otro contacto" else ""}): " + if (ok) "aviso puesto" else "sin aviso (notificaciones desactivadas)")
            }
            ReqNotifyPolicy.Verdict.GROUP -> {
                MsgNotifier.get(ctx).contactRequestsGrouped(ReqNotifyPolicy.groupBody(NativeLang.get(ctx), grouped))
                log(ctx, "Solicitud de ${req.from} ($what): frenado (tope de ${ReqNotifyPolicy.MAX_PER_WINDOW} por hora): va en el aviso agrupado ($grouped)")
            }
            ReqNotifyPolicy.Verdict.SAME_SENDER -> log(ctx, "Solicitud de ${req.from} ($what): frenado (ya hubo aviso suyo en las últimas 24 h)")
        }
    }

    // ===== Guardar (lo llama la app: netBgConfigImpl / setAckKeysImpl, con SU AtRestStore: el mismo cerrojo que su migración) =====
    fun saveConfig(ctx: Context, st: AtRestStore, cfg: NetBgSaved.Config) = save(ctx) { NetBgSaved.saveConfig(st, writer, cfg) }
    fun saveAck(ctx: Context, st: AtRestStore, keys: Map<String, ByteArray>) = save(ctx) { NetBgSaved.saveAck(st, writer, keys) }
    fun saveMute(ctx: Context, st: AtRestStore, m: Map<String, Long>) = save(ctx) { MutedChats.save(st, writer, m) } // 3219
    private fun save(ctx: Context, op: () -> Boolean) {
        try { op() } catch (e: Throwable) {
            // Sin datos: solo el tipo de error, y una vez por proceso (la app la manda cada vez que se oculta)
            if (!saveFailLogged) { saveFailLogged = true; log(ctx, "Internet sin la app: no se pudo guardar la configuración (${e.javaClass.simpleName})", "WARN") }
        }
    }

    // Lo de NEXO de este proceso, cifrado en reposo con la clave que ya creó la app (AtRestKey, sin crear otra). Solo se lee.
    @Synchronized private fun store(ctx: Context): AtRestStore = atRest ?: AtRestStore(ctx.filesDir) {
        try { AtRestKey.get(ctx, create = false) } catch (e: Throwable) { null }
    }.also { it.skip = setOf(NexoBlePlugin.NXID_MAC_MAP_FILE, NexoBlePlugin.NATIVE_LOG_FILE); atRest = it }

    // ===== Sin la app =====
    /** ¿Hace falta intentarlo? (barato, para no abrir un hilo en cada arranque del servicio con la app viva) */
    fun mayStart(): Boolean = host() == null && shared?.running != true

    /**
     * Arranca la escucha desde lo guardado si no hay app viva en este proceso. Devuelve si alguien escucha internet tras esto (la app,
     * la escucha que ya estaba o la nueva): el toque FCM pone el aviso genérico si no. Lee archivos y el Keystore: fuera del hilo principal.
     */
    @Synchronized
    fun startWithoutApp(ctx: Context, why: String): Boolean {
        val app = ctx.applicationContext ?: ctx
        var saved: NetBgSaved.Saved? = null
        val step = try {
            NetBgSaved.startStep(host() != null, shared?.running == true,
                { NetBgSaved.load(store(app)).also { saved = it }?.cfg },
                { NetBgSaved.accountIdOf(store(app).read(RestartPolicy.NEXO_ID_FILE)) })
        } catch (e: Throwable) {
            logNo(app, "Internet sin la app: no se pudo leer lo guardado (tras $why; ${e.javaClass.simpleName}): no se escucha hasta abrir NEXO")
            return false
        }
        when (step) {
            NetBgSaved.Start.APP_ALIVE -> return true
            NetBgSaved.Start.ALREADY -> { if (withoutApp) wifiHold(app, true); return true }
            NetBgSaved.Start.NO_CONFIG -> { logNo(app, "Internet sin la app: no hay configuración guardada (tras $why): no se escucha hasta abrir NEXO"); return false }
            NetBgSaved.Start.OTHER_ACCOUNT -> { logNo(app, "Internet sin la app: lo guardado no es de la cuenta de este teléfono (tras $why): no se escucha"); return false }
            NetBgSaved.Start.START -> {}
        }
        val s = saved ?: return false
        return try {
            val bg = get(app)
            NetBgSaved.apply(bg, s) { id -> NetBgSaved.blobFrom(store(app).read(NetBgSaved.blobFile(id))) }
            // Las claves del ✓✓ también para el plugin si carga después en este proceso (la app las vuelve a dar al arrancar)
            if (NexoBlePlugin.ackKeys.isEmpty()) NexoBlePlugin.ackKeys.putAll(s.ack)
            withoutApp = true
            wifiHold(app, true) // como la app en segundo plano (ronda 2785): la Wi-Fi despierta para que llegue lo del relé
            bg.start()
            if (!bg.running) throw IllegalStateException("no arrancó")
            log(app, NetBgSaved.startLine(s.cfg.contacts.size, s.cfg.relays.size, why))
            true
        } catch (e: Throwable) {
            withoutApp = false
            wifiHold(app, false)
            logNo(app, "Internet sin la app: no se pudo arrancar (tras $why; ${e.javaClass.simpleName})")
            false
        }
    }

    /** La app cargó en este proceso (NexoBlePlugin.load): la escucha sigue siendo esta misma, pero ahora la maneja ella. */
    @Synchronized
    fun appTookOver(ctx: Context) {
        if (!withoutApp) return
        withoutApp = false
        wifiHold(ctx, false)
        log(ctx, "Internet sin la app: NEXO se abrió y la app toma el relevo (la misma escucha: lo recibido queda para la app)")
    }

    /** El servicio se paró o no pudo quedar en primer plano: sin él el proceso se congela; no se deja la Wi-Fi despierta. */
    @Synchronized
    fun stopWithoutApp(ctx: Context, why: String) {
        if (!withoutApp || host() != null) return
        withoutApp = false
        try { shared?.stop() } catch (e: Throwable) { }
        wifiHold(ctx, false)
        log(ctx, "Internet sin la app: parado ($why)")
    }

    /** La cuenta se borró de este teléfono (AccountMove.wipe al pasarla a otro): fuera la escucha y lo que recordaba de ella. */
    @Synchronized
    fun forget(ctx: Context) {
        writer.forget()
        shared?.let { bg -> try { bg.stop(); bg.configure("", emptyList(), 0L, emptyList()); bg.setAckKeys(emptyMap()); bg.outbox.clear() } catch (e: Throwable) { } }
        NexoBlePlugin.ackKeys.clear()
        MutedChats.clear() // 3219
        if (withoutApp) { withoutApp = false; wifiHold(ctx, false) }
    }

    // Nombre de un grupo (nexo_groups.json, cifrado en reposo) para el aviso sin la app; un minuto en memoria, como en la app
    fun groupNameOf(ctx: Context, gid: String): String? = groupName(ctx, gid) // 3254: para BleSinApp
    private fun groupName(ctx: Context, gid: String): String? {
        if (gid.isEmpty()) return null
        val now = System.currentTimeMillis()
        val cached = groups
        val map = if (cached != null && now - cached.first < 60000) cached.second else try {
            NetBgSaved.groupNames(store(ctx).read("nexo_groups.json")).also { groups = now to it }
        } catch (e: Exception) { emptyMap() }
        return map[gid.lowercase()]
    }

    @Synchronized private fun rxWake(ctx: Context) {
        try {
            val wl = rxLock ?: (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nexo:recibir").also { it.setReferenceCounted(false); rxLock = it }
            wl.acquire(RX_WAKE_MS)
        } catch (e: Exception) { Log.w(TAG, "Despertar al recibir: ${e.message}") }
    }

    @Synchronized private fun wifiHold(ctx: Context, on: Boolean) {
        try {
            if (on) {
                val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
                @Suppress("DEPRECATION")
                val wl = wifiLock ?: wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "nexo:net").also { it.setReferenceCounted(false); wifiLock = it }
                if (!wl.isHeld) { wl.acquire(); log(ctx, "WifiLock tomado (Wi-Fi despierta para recibir por internet sin la app)") }
            } else {
                wifiLock?.let { if (it.isHeld) { it.release(); log(ctx, "WifiLock soltado (la escucha sin la app deja de encargarse)") } }
            }
        } catch (e: Exception) { Log.w(TAG, "WifiLock: ${e.message}") }
    }
}
