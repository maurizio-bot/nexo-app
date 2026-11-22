package com.nexo.ble

import android.content.Context
import android.util.Base64
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.io.File
import org.json.JSONObject
import com.nexo.ble.NexoBlePlugin.Companion.orphan
import com.nexo.ble.NexoBlePlugin.Companion.netBgShared
import com.nexo.ble.NexoBlePlugin.Companion.ackKeys
import com.nexo.ble.NexoBlePlugin.Companion.ackTag
import com.nexo.ble.NexoBlePlugin.Companion.BG_NOTIFY_DELAY_MS

// App cerrada y segundo plano: recibir con la app cerrada, avisos de respaldo, ✓✓ y saludo nativos, FCM e internet en segundo plano (NetBg).
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

private fun NexoBlePlugin.inbox(): BgInbox = BgInbox(File((appCtx ?: activity.applicationContext).filesDir, "nexo_bg_inbox.jsonl"))

// Lo llama el JS (ble_ack.js) al recibir bloques de un archivo GRANDE por internet (tomar) y al completarlo (soltar).
internal fun NexoBlePlugin.xferKeepAwakeImpl(call: PluginCall) {
    xferAwakeHold(call.getBoolean("on") ?: false)
    call.resolve()
}

internal fun NexoBlePlugin.groupName(gid: String): String? {
    if (gid.isEmpty()) return null
    val now = System.currentTimeMillis()
    val cached = groupNames
    val map = if (cached != null && now - cached.first < 60000) cached.second else try {
        val m = NetBgSaved.groupNames(atRest().read("nexo_groups.json")) // 3192: el mismo análisis que el aviso sin la app (NetBgHome)
        groupNames = now to m; m
    } catch (e: Exception) { emptyMap() }
    return map[gid.lowercase()]
}

// Aviso de "solo notificación" (BgInbox.Kind.NOTIFY_ONLY): sin remitente (Jump con remitente oculto) va a un chat
// aparte que la app quita al abrirse (no es un contacto)
private fun NexoBlePlugin.notifyOnly(ctx: Context, info: BgInbox.Info) {
    if (info.quiet) return
    if (info.what == "call") { MsgNotifier.get(ctx).incomingCall(info.from, netBgShared?.nameOf(info.from) ?: "NEXO", info.video, info.msgId); return }
    if (mutedNotice(info, groupName(info.group) != null)) return // 3219: chat o grupo silenciado: sin aviso
    val chat = info.from.ifEmpty { "nexo_jump" }
    val what = when (info.what) { "image" -> NativeLang.t(ctx, "msg_photo"); "video" -> NativeLang.t(ctx, "msg_video"); "audio" -> NativeLang.t(ctx, "msg_voice"); "call" -> NativeLang.t(ctx, "call_in"); "text" -> ""; else -> NativeLang.t(ctx, "msg_file") } // 3122: en el idioma de la app
    val gname = groupName(info.group) // ronda 2763: de un grupo, en el chat del grupo con su nombre
    if (gname != null) { val who = netBgShared?.nameOf(info.from); MsgNotifier.get(ctx).message(info.group, gname, info.msgId, if (who != null) "$who: ${what.ifEmpty { NativeLang.t(ctx, "msg_new") }}" else what, true); return }
    MsgNotifier.get(ctx).message(chat, if (info.from.isEmpty()) "NEXO" else netBgShared?.nameOf(info.from) ?: "NEXO", info.msgId, what, true)
}

// Ronda 2760: con la app en segundo plano el aviso lo da la app (notify.js), pero algunos teléfonos (Vivo del dueño)
// congelan la app en segundo plano y no avisaba nadie. Ahora el nativo mira lo que llega (Bluetooth o Wi-Fi) y, si
// a los 4 s la app no ha avisado de ese mensaje, avisa él (sin texto: va cifrado). Mismo msgId = un solo aviso.
// 3016: lanNx = llegó por Wi-Fi local desde ese NEXO ID (la confirmación vuelve por esa misma conexión)
internal fun NexoBlePlugin.backgroundNotify(json: String, deviceId: String? = null, lanNx: String? = null) {
    if (!appInBackground || closedMode) return
    val ctx = appCtx ?: return
    val info = BgInbox.classify(json, nexoAdvertisingId ?: "")
    if (info.msgId.isEmpty()) return
    // 3034 (diagnóstico S24 12-11 17:54, «reenvio_sin_fin» con …db61): una acción OCULTA (estado, foto de perfil, me gusta;
    // marca q:1) que llega con la app en segundo plano/congelada no se avisa, pero tampoco se CONFIRMABA (solo los textos,
    // al avisar, desde 2833) → el otro la reenviaba sin fin hasta que esta app volviera. Ahora se confirma igual, sin aviso
    // (como con la app cerrada, closedReceive).
    if (info.quiet) {
        // 3087: el que llama colgó (la app dormida no lo puede leer) → deja de sonar ya
        if (info.kind == BgInbox.Kind.MESSAGE && info.callEnd.isNotEmpty()) MsgNotifier.get(ctx).cancelCallFor(info.from, info.callEnd)
        if (info.kind == BgInbox.Kind.MESSAGE && !info.call) mainHandler.postDelayed({
            if (!appInBackground) return@postDelayed
            if (deviceId != null) sendDeliveredAck(deviceId, info)
            else if (lanNx != null) sendDeliveredAckLan(lanNx, info)
        }, BG_NOTIFY_DELAY_MS)
        return
    }
    // #dueño 08-11: si tenés ABIERTO el chat de este remitente (o grupo), NO avisar: lo estás leyendo. Solo acá (aviso de
    // respaldo de 2.º plano); con la app CERRADA (closedReceive) sí se avisa, porque ahí no hay un chat abierto a la vista.
    // 3086 (diagnósticos S24 08:09 y vivo 08:49 del 14-11): solo en un parpadeo a segundo plano (BgNotifyPolicy) y solo el AVISO:
    // la confirmación de entrega sale siempre (antes se saltaba todo, para siempre, y el otro reenviaba sin fin).
    val silent = BgNotifyPolicy.silentFor(activeChatNx, info.from, info.group, System.currentTimeMillis() - bgSinceMs)
    if (info.kind != BgInbox.Kind.MESSAGE && info.kind != BgInbox.Kind.NOTIFY_ONLY) return
    // Llamada: suena ya (si la app está viva también la avisa: es el mismo aviso, no sale dos veces)
    if (info.call || info.what == "call") { if (!silent) MsgNotifier.get(ctx).incomingCall(info.from, netBgShared?.nameOf(info.from) ?: "NEXO", info.video, info.msgId); return }
    mainHandler.postDelayed({
        if (!appInBackground || MsgNotifier.get(ctx).book.hasMsg(info.msgId)) return@postDelayed
        if (info.kind == BgInbox.Kind.MESSAGE) {
            if (!silent) notifyMessage(ctx, info)
            // #87 / dueño 29-10 (2833): el JS no confirmó en 4 s (lo normal: lo confirma él, pero algunos teléfonos —
            // el Vivo del dueño— congelan la app y el JS no corre). Al avisar, mandar también la confirmación de
            // ENTREGA firmada por Bluetooth, para que el emisor vea el ✓✓ sin esperar a que la app vuelva.
            // 3016 (diagnóstico S23 del dueño 12-11): por Wi-Fi local NO se confirmaba («esa vía confirma por su cuenta»
            // era falso con el JS congelado) y el emisor reenviaba sin fin; ahora vuelve por la misma conexión Wi-Fi.
            if (deviceId != null) sendDeliveredAck(deviceId, info)
            else if (lanNx != null) sendDeliveredAckLan(lanNx, info)
        } else if (!silent) notifyOnly(ctx, info)
    }, BG_NOTIFY_DELAY_MS)
}

// Lo que llega con la app cerrada: al buzón, confirmación de entrega y notificación (ver BgInbox)
internal fun NexoBlePlugin.closedReceive(deviceId: String, json: String) {
    val info = BgInbox.classify(json, nexoAdvertisingId ?: "")
    val ctx = appCtx ?: return
    // Ronda 2785 (#87): dejar constancia en el registro nativo (persiste con la app cerrada; sin contenido)
    nlog()?.add("INFO", "BT_CERRADA", "llega por Bluetooth: ${info.kind} de ${info.from.ifEmpty { "?" }}${if (info.msgId.isNotEmpty()) " (msgId ${info.msgId})" else ""}${if (info.call) " [llamada]" else ""}")
    when (info.kind) {
        BgInbox.Kind.MESSAGE -> {
            if (!inbox().add(deviceId, json)) { Log.w("NEXO_REM", "Buzón lleno: mensaje de ${info.from} sin guardar"); return }
            sendDeliveredAck(deviceId, info)
            // 3087: el que llama colgó → deja de sonar ya
            if (info.callEnd.isNotEmpty() && MsgNotifier.get(ctx).cancelCallFor(info.from, info.callEnd)) nlog()?.add("INFO", "BT_CERRADA", "${info.from} colgó: la llamada deja de sonar")
            // Ronda 2763: una llamada suena como una llamada del teléfono (aviso con tono, Contestar / Rechazar)
            if (info.call) MsgNotifier.get(ctx).incomingCall(info.from, netBgShared?.nameOf(info.from) ?: "NEXO", info.video, info.msgId)
            else if (!info.quiet) notifyMessage(ctx, info)
        }
        BgInbox.Kind.RECEIPT -> inbox().add(deviceId, json)
        BgInbox.Kind.NOTIFY_ONLY -> notifyOnly(ctx, info)
        BgInbox.Kind.IGNORE -> {}
    }
}

// #87 (C1, ronda 2777): confirmación de ENTREGA firmada al emisor (el mensaje ya está a salvo en este teléfono). La
// usan el modo cerrado (closedReceive) y, desde 2833, el aviso de respaldo en segundo plano (backgroundNotify) cuando
// el teléfono congela la app (p. ej. el Vivo del dueño) y el JS no pudo confirmar: así el emisor ve el ✓✓ aunque el
// JS no corra. Se firma con la clave de la pareja (si la app nos la dio) para que el emisor sepa que es de verdad y no
// de un tercero que espió el msgId. El emisor deduplica por tipo+id (un ack doble es inofensivo); sin la clave va sin
// firma y el emisor proto-2 lo ignora (se recupera al reabrir, cuando el JS manda el ack firmado del buzón).
// 3009 (PENDIENTES 12a, «zombi» falso: 3 de 7 síntomas del canal de diagnósticos): con la app en segundo plano o cerrada el
// JS puede estar dormido y no contestar el ping del vigilante del otro teléfono → «sin respuesta a 2 pings» → el otro tiraba
// un enlace Bluetooth SANO y lo rehacía en bucle. Si llega un ping por un enlace vivo, contesta el nativo con el mismo
// pong que el JS (ble_messages.js). El otro resuelve con el primero; uno repetido (si el JS también contesta) se ignora.
internal fun NexoBlePlugin.nativePong(deviceId: String, json: String) {
    try {
        val o = JSONObject(json)
        if (o.optString("type") != "ping") return
        val pingId = o.optString("pingId")
        if (pingId.isEmpty() || pingId.length > 80) return
        val me = (nexoAdvertisingId ?: "").lowercase()
        val pong = JSONObject().put("v", 1).put("type", "pong").put("pingId", pingId).put("ts", System.currentTimeMillis()).put("fromNexoId", me).put("nb", 1)
        sendChunkedOrSingle(normalizeMac(deviceId), deviceId, pong.toString())
    } catch (e: Exception) { }
}

private fun NexoBlePlugin.kxCardPrefs() = (appCtx ?: context).getSharedPreferences("nexo_ble_prefs", Context.MODE_PRIVATE)
internal fun NexoBlePlugin.nativeKx(deviceId: String) {
    try {
        val mac = normalizeMac(deviceId)
        val now = System.currentTimeMillis()
        if (now - (kxCardSentAt[mac] ?: 0L) < 8000) return
        val card = kxCard ?: try { kxCardPrefs().getString("kx_card", null) } catch (e: Exception) { null }
        if (card.isNullOrEmpty()) return
        kxCardSentAt[mac] = now
        if (kxCardSentAt.size > 200) kxCardSentAt.clear()
        sendChunkedOrSingle(mac, deviceId, card)
        remLog("INFO", "SEND", "kx nativo (app dormida o cerrada) a $mac")
    } catch (e: Exception) { }
}

internal fun NexoBlePlugin.setKxCardImpl(call: PluginCall) {
    val card = call.getString("card") ?: ""
    // Solo un kx bien formado y corto (datos públicos); nada más se guarda ni se contesta
    val ok = card.length in 40..1500 && try { val o = JSONObject(card); o.optString("type") == "kx" && o.optString("from").length == 10 && o.optString("pk").isNotEmpty() && !o.has("rq") } catch (e: Exception) { false }
    if (!ok) { call.reject("tarjeta no válida"); return }
    kxCard = card
    try { kxCardPrefs().edit().putString("kx_card", card).apply() } catch (e: Exception) { }
    call.resolve(JSObject().put("ok", true))
}

private fun NexoBlePlugin.deliveredAckJson(info: BgInbox.Info): String? {
    val me = (nexoAdvertisingId ?: "").lowercase()
    if (me.isEmpty() || info.from.isEmpty()) return null
    val ackObj = JSONObject().put("v", 1).put("type", "ack").put("msgId", info.msgId).put("from", me).put("ts", System.currentTimeMillis())
    val k = ackKeys[info.from]
    if (k != null) ackObj.put("a", ackTag(k, "ack|${info.msgId}|$me|${info.from}"))
    return ackObj.toString()
}

private fun NexoBlePlugin.sendDeliveredAck(deviceId: String, info: BgInbox.Info) {
    val json = deliveredAckJson(info) ?: return
    sendChunkedOrSingle(normalizeMac(deviceId), deviceId, json)
}

// 3016: confirmación de entrega por Wi-Fi local, solo al mismo NEXO que lo mandó por esa conexión (remitente = par)
private fun NexoBlePlugin.sendDeliveredAckLan(nx: String, info: BgInbox.Info) {
    val peer = nx.lowercase()
    if (peer.isEmpty() || info.from.lowercase() != peer) return
    val json = deliveredAckJson(info) ?: return
    val hub = lanHub ?: return
    lanSendExec.execute { try { hub.send(peer, json) } catch (e: Exception) { } }
}

// La app se abre: la instancia anterior (si siguió recibiendo) se retira y lo guardado se entrega a la app
internal fun NexoBlePlugin.takeOverFromClosed() {
    // 3254: si el servicio recibía por Bluetooth sin la app (BleSinApp), deja de atender; lo que guardó en el buzón se entrega aquí abajo
    try { BleSinApp.stopForApp() } catch (e: Throwable) { }
    val old = orphan
    if (old != null && old !== this) {
        orphan = null
        try { old.endClosedMode() } catch (e: Exception) { }
    }
    // 3263 (fase 2): el servidor GATT que ya estuviera abierto (el del servicio sin la app o el de la instancia anterior) pasa a esta
    // instancia SIN cerrarse y con sus enlaces: antes se cerraba y se abría otro, y cada vez que el usuario abría NEXO se cortaba el
    // Bluetooth con todos sus contactos cercanos (o quedaban enlaces a medias)
    try { if (bluetoothGattServer != null) adoptGattServer("la app se abre") } catch (e: Throwable) { }
    val list = try { inbox().drain() } catch (e: Exception) { emptyList() }
    if (list.isNotEmpty()) remLog("INFO", "FILE_IO", "Con la app cerrada llegaron ${list.size} mensaje(s)/confirmación(es) por Bluetooth")
    val now = System.currentTimeMillis()
    list.forEach { item ->
        notifyListeners("onPayloadReceived", JSObject().put("deviceId", item.deviceId).put("content", item.json).put("data", item.json)
            .put("source", "closed").put("timestamp", if (item.ts in 1..now) item.ts else now).put("reassembled", true), true)
    }
}

// La instancia vieja deja el Bluetooth a la nueva (cierra sus conexiones de cliente; el servidor y el anuncio siguen en el proceso)
private fun NexoBlePlugin.endClosedMode() {
    closedMode = false
    cleanupAllConnections()
    try { unregisterServerReceivers() } catch (e: Exception) { }
    try { unregisterBluetoothStateReceiver() } catch (e: Exception) { }
    // 3263 (fase 2): el servidor GATT NO se cierra ni se cortan sus enlaces (antes 3251 los cortaba para que reconectaran al servidor
    // nuevo): esta instancia solo deja de atender y la nueva se engancha al mismo servidor (GattServerHost). Sus enlaces de CLIENTE sí se
    // cerraron arriba (sus avisos llegan a esta instancia, que se va).
    GattServerHost.detach(gattServerCallback)
    writeQueues.clear(); writeQueueProcessing.clear()
    writeQueueTimeouts.forEach { (_, r) -> mainHandler.removeCallbacks(r) }; writeQueueTimeouts.clear()
}

// FCM «despertador» (#87): apunta en el diagnóstico el token de este teléfono (su "dirección" para despertarlo; NO
// es secreto). Fase 1: sirve para mandarle un "toque" de prueba desde la consola de Firebase/el enviador y ver que
// NEXO cerrada despierta. Defensivo: si Firebase/Play Services no está, solo deja un aviso (no afecta al resto).
internal fun NexoBlePlugin.logFcmToken() {
    try {
        com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            // SEC-3 (03-11): el token COMPLETO ya no va al diagnóstico. Es la «dirección» para despertar este
            // teléfono; un diagnóstico compartido (con soporte, un foro…) lo filtraría y cualquiera podría despertarlo
            // (gasto de batería). Solo un prefijo + largo, para confirmar que hay token sin que sea usable.
            if (task.isSuccessful) remLog("INFO", "FCM", "Token FCM: ${task.result?.take(12)}... (${task.result?.length} car.)")
            else remLog("WARN", "FCM", "Token FCM no disponible: ${task.exception?.message}")
        }
    } catch (e: Throwable) { remLog("WARN", "FCM", "FCM no inicializado (¿sin Play Services?): ${e.message}") }
}

// FCM «despertador» (#87, Fase 2): la app (net_link.js) pide el token de ESTE teléfono para compartirlo con sus
// contactos (en el saludo cifrado) y que puedan despertarlo con el app cerrada. El token NO es secreto. Se da el
// fresco de FirebaseMessaging; si no hay (sin Play Services), el guardado por onNewToken, o vacío.
internal fun NexoBlePlugin.getFcmTokenImpl(call: PluginCall) {
    val prefs = try { context.getSharedPreferences(NexoFcmService.PREFS, Context.MODE_PRIVATE) } catch (e: Exception) { null }
    try {
        com.google.firebase.messaging.FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            val tok = if (task.isSuccessful) (task.result ?: "") else ""
            if (tok.isNotEmpty()) {
                try { prefs?.edit()?.putString(NexoFcmService.PREF_TOKEN, tok)?.apply() } catch (e: Exception) {}
                call.resolve(JSObject().put("token", tok))
            } else {
                val saved = try { prefs?.getString(NexoFcmService.PREF_TOKEN, "") ?: "" } catch (e: Exception) { "" }
                call.resolve(JSObject().put("token", saved).put("error", task.exception?.message ?: "sin token"))
            }
        }
    } catch (e: Throwable) {
        val saved = try { prefs?.getString(NexoFcmService.PREF_TOKEN, "") ?: "" } catch (e2: Exception) { "" }
        call.resolve(JSObject().put("token", saved).put("error", e.message ?: "FCM no disponible"))
    }
}

// ===== Internet en segundo plano (NetBg): escucha los relés mientras la app no está a la vista =====
// Una por proceso: sigue aunque se cierre la actividad mientras el servicio de Bluetooth mantiene el proceso.
// 3192 (#87): vive en NetBgHome (no en el plugin) para poder arrancar también SIN la app desde lo guardado (servicio o toque FCM en un
// proceso nuevo); la app usa esa misma instancia (nunca dos escuchando) y lo que oye llega aquí si el plugin vive (netBgOnMessage).
internal fun NexoBlePlugin.netBg(): NetBg = NetBgHome.get(appCtx ?: context)

// Lo que NetBg oyó con la app viva (abierta, en segundo plano o cerrada con el proceso vivo). El aviso, con las mismas reglas y textos
// que sin la app: NetBgHome.notifyMessage (antes estaba aquí dentro).
internal fun NexoBlePlugin.netBgOnMessage(nx: String, name: String, msgId: String, isCall: Boolean, group: String, video: Boolean) {
    // Ronda 2774 (el dueño: con la pantalla apagada no llegan por Wi-Fi/internet): al recibir por internet en segundo
    // plano se renueva el wakelock (rxWake), igual que por Bluetooth y Wi-Fi, para que dé tiempo a avisar antes de que
    // el teléfono vuelva a dormir.
    if (appInBackground) rxWake()
    // 3172 (dueño 17-11): como por Bluetooth (backgroundNotify), el chat ABIERTO no avisa en un parpadeo a segundo plano (< 15 s,
    // BgNotifyPolicy): lo está leyendo y la app lo muestra al volver. Pasado ese margen (pantalla apagada) avisa como siempre.
    // Las llamadas suenan igual (perder una es peor que un aviso de más; la app no la duplica).
    val silent = !closedMode && BgNotifyPolicy.silentFor(activeChatNx, nx, group, System.currentTimeMillis() - bgSinceMs)
    NetBgHome.notifyMessage(appCtx ?: context, nx, name, msgId, isCall, group, video, silent) { groupName(it) }
}

// 3190: el aviso de una solicitud de contacto (con su freno) está en NetBgHome.requestNotify (3192: también sin la app)

internal fun NexoBlePlugin.netBgConfigImpl(call: PluginCall) {
    // 3192: se lee con NetBgSaved.fromApp (lo mismo que se leía aquí: «falta me» / «configuración ilegible»). 3190: para el aviso de una
    // solicitud de contacto (NetBg.onReqEvent): todos mis contactos (NEXO ID → nombre: «ya es contacto» y el aviso de posible impostor),
    // a quién mandé yo una solicitud y desde cuándo la app ya no escucha su buzón
    val cfg = try { NetBgSaved.fromApp(call.data) } catch (e: NetBgSaved.BadConfig) { call.reject(e.message); return }
    netBg().configure(cfg.me, cfg.relays, cfg.since, cfg.contacts, cfg.known, cfg.reqOut, cfg.reqSince)
    netBg().setAckKeys(HashMap(ackKeys))   // #87: para confirmar la ENTREGA (✓✓) con la app cerrada
    // 3192 (#87, dueño 17-11 «Ok»): y se guarda CIFRADA en el teléfono (solo si cambió) para que la escucha arranque aunque Android haya
    // cerrado NEXO (NetBgHome.startWithoutApp). Pasando la cuenta a otro teléfono no se escribe nada (moveFrozen, como saveToFile).
    if (!moveFrozen) NetBgHome.saveConfig(appCtx ?: context, atRest(), cfg)
    // 3190: también sin contactos por internet (escucha mi buzón de solicitudes): basta con mi ID y los relés
    if (appInBackground && netBg().configured()) { wifiLockHold(true); netBg().start() }
    call.resolve(JSObject().put("contacts", cfg.contacts.size).put("running", netBg().running))
}

// 3033: lo que la escucha de internet en segundo plano recibió (eventos del relé, cifrados) para que la app lo procese
// al volver sin esperar a los relés (ver NetBg.drainForApp)
internal fun NexoBlePlugin.netBgDrainImpl(call: PluginCall) {
    val list = try { netBgShared?.drainForApp() ?: emptyList() } catch (e: Exception) { emptyList<String>() }
    val arr = JSArray()
    for (s in list) arr.put(s)
    // 3205: y los relés que soltó con datos móviles sin pedirles aún lo suyo (url → desde cuándo, ms): se lo pide la app (net_relays._bgGaps)
    val gaps = JSObject()
    try { netBgShared?.drainGapsForApp()?.forEach { (u, at) -> gaps.put(u, at) } } catch (e: Exception) { }
    call.resolve(JSObject().put("events", arr).put("gaps", gaps))
}

// 3268 (PRIORIDAD 1, fase 3; COLA 29): la app da la lista ENTERA de sus textos pendientes ya cifrados de punta a punta
// ({items:[{id, nx, p, wk}], f, url}; reemplaza a la anterior) para que la escucha de internet los suba aunque la app se duerma, se
// cierre o Android mate el proceso (NetOutbox). items vacío = nada pendiente. Devuelve cuántos quedaron (n) y cuáles ya aceptó un relé.
internal fun NexoBlePlugin.netOutboxSetImpl(call: PluginCall) {
    val list = ArrayList<NetOutbox.Item>()
    val now = System.currentTimeMillis()
    try {
        call.data.optJSONArray("items")?.let { a ->
            for (i in 0 until a.length()) {
                val o = a.optJSONObject(i) ?: continue
                val id = o.optString("id"); val nx = o.optString("nx").lowercase(); val p = o.optString("p")
                if (!NetOutbox.valid(id, nx, p)) continue
                val at = o.optLong("at", now).let { if (it in 1..now) it else now }
                list.add(NetOutbox.Item(id, nx, p, at, o.optString("wk")))
            }
        }
    } catch (e: Exception) { call.reject("bandeja ilegible"); return }
    val bg = netBg()
    val n = bg.outboxSet(list, call.data.optString("f"), call.data.optString("url"))
    // 3269: los enlaces Bluetooth listos de esos contactos (los identificó la app): por ellos también sale lo pendiente
    try {
        call.data.optJSONArray("links")?.let { a ->
            for (i in 0 until minOf(a.length(), OutboxBle.MAX_LINKS)) { val o = a.optJSONObject(i) ?: continue; outBle().seed(normalizeMac(o.optString("mac")), o.optString("nx")) }
        }
    } catch (e: Exception) { }
    if (n > 0 && (appInBackground || closedMode)) outboxBleTick()
    val sent = JSArray()
    bg.outbox.ids().forEach { id -> if ((bg.outbox.get(id)?.okAt ?: 0L) > 0) sent.put(id) }
    call.resolve(JSObject().put("n", n).put("sent", sent))
}

// 3269: la bandeja de salida también por Bluetooth (OutboxBle), con los enlaces de la app (dormida o cerrada con el proceso vivo)
internal fun NexoBlePlugin.outBle(): OutboxBle = outBleRef ?: synchronized(this) {
    outBleRef ?: OutboxBle({ nexoAdvertisingId ?: "" }, { netBgShared }, { NexoBlePlugin.ackKeys[it] }, object : OutboxBle.Link {
        override fun ready(mac: String) = (serverConnectedDevices[mac] != null && serverNotificationEnabled.getOrDefault(mac, false)) || clientRxCharacteristics[mac] != null
        override fun send(mac: String, json: String) = sendChunkedOrSingle(mac, mac, json).sent
        override fun log(msg: String) { nlog()?.add("INFO", "BANDEJA", msg) }
    }).also { outBleRef = it }
}
// Repaso cada 10 s mientras la app no está a la vista y queda algo en la bandeja (los enlaces que hablan la mueven al momento: outboxHeard)
internal fun NexoBlePlugin.outboxBleTick() {
    if (outTickOn) return
    outTickOn = true
    val run = object : Runnable {
        override fun run() {
            if (!(appInBackground || closedMode) || !outBle().pending()) { outTickOn = false; return }
            try { outBle().pump() } catch (e: Throwable) { }
            try { outboxDialStep() } catch (e: Throwable) { } // 3271: y si su contacto no tiene enlace, se le busca y se conecta
            mainHandler.postDelayed(this, 10_000L)
        }
    }
    mainHandler.postDelayed(run, 2_000L)
}
// 3271 (fase 3: conexiones salientes): para quien tiene algo pendiente y ningún enlace listo, el nativo lo busca (escaneo corto y
// filtrado, lo único que Android entrega con la pantalla apagada) y conecta él. El plan (cuándo, a quién, tope) es OutboxDial (JVM).
internal fun NexoBlePlugin.outboxDialStep() {
    if (!(appInBackground || closedMode)) return
    val want = outBle().wanting()
    if (want.isEmpty()) { outDial.scanDue(want); return }
    val ctx = appCtx ?: return
    val adapter = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? android.bluetooth.BluetoothManager)?.adapter ?: return
    if (!adapter.isEnabled) return
    val busy = { mac: String -> gattClients.containsKey(mac) || clientConnectionStates.containsKey(mac) || serverConnectedDevices.containsKey(mac) }
    for ((nx, mac) in outDial.pick(want, HashMap(outSeen), gattClients.size, busy)) {
        val device = scannedDevices[mac] ?: continue
        try {
            outDialNx[mac] = nx
            if (outDialNx.size > 64) outDialNx.clear()
            val gatt = connectLe(ctx, device, mac) ?: continue
            gattClients[mac] = gatt
            clientConnectionStates[mac] = android.bluetooth.BluetoothProfile.STATE_CONNECTING
            nlog()?.add("INFO", "BANDEJA", "hay mensajes pendientes para $nx y está cerca: el teléfono abre el enlace Bluetooth sin la app")
        } catch (e: Throwable) { nlog()?.add("WARN", "BANDEJA", "no se pudo abrir el enlace con $nx (${e.javaClass.simpleName})") }
    }
    val now = System.currentTimeMillis()
    if (now < outScanUntil || !outDial.scanDue(want)) return
    val granted = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) isGranted(ctx, android.Manifest.permission.BLUETOOTH_SCAN)
        else isGranted(ctx, android.Manifest.permission.ACCESS_FINE_LOCATION)
    if (!granted || bluetoothScanner != null) return // sin permiso, o ya hay un escaneo en marcha (el de la app): sus resultados valen igual
    try {
        val scanner = adapter.bluetoothLeScanner ?: return
        val filters = listOf(android.bluetooth.le.ScanFilter.Builder()
            .setManufacturerData(NexoBlePlugin.MANUFACTURER_ID, byteArrayOf(NexoBlePlugin.NEXO_MAGIC_HIGH, NexoBlePlugin.NEXO_MAGIC_LOW), byteArrayOf(0xFF.toByte(), 0xFF.toByte())).build())
        scanner.startScan(filters, scanSettings(), scanCallback)
        outScanUntil = now + OutboxDial.SCAN_MS
        mainHandler.postDelayed({
            try { scanner.stopScan(scanCallback) } catch (e: Throwable) { }
            try { outboxDialStep() } catch (e: Throwable) { } // lo que se vio en este escaneo: a conectar
        }, OutboxDial.SCAN_MS)
    } catch (e: Throwable) { nlog()?.add("WARN", "BANDEJA", "no se pudo buscar por Bluetooth (${e.javaClass.simpleName})") }
}
// El enlace de cliente quedó listo (MTU y notificaciones): si lo abrió la bandeja, es de ese contacto y lo suyo sale ya
internal fun NexoBlePlugin.outboxDialed(macNorm: String) {
    val nx = outDialNx.remove(macNorm) ?: return
    try { outBle().seed(macNorm, nx); mainHandler.post { try { outBle().pump() } catch (e: Throwable) { } } } catch (e: Throwable) { }
}

// Lo que llega por un enlace Bluetooth con la app dormida o cerrada (PluginRx): de quién es el enlace, ✓✓ de lo de la bandeja y a escribir
internal fun NexoBlePlugin.outboxHeard(macNorm: String, json: String) {
    if (json.length > 6000) return
    try { outBle().heard(macNorm, json) } catch (e: Throwable) { }
}

// Lo que el nativo tiene a su cargo (al arrancar la app: para ponerse de acuerdo con lo guardado de la sesión anterior)
internal fun NexoBlePlugin.netOutboxListImpl(call: PluginCall) {
    val arr = JSArray()
    try { val o = netBg().outbox; o.ids().forEach { id -> o.get(id)?.let { arr.put(JSObject().put("id", it.id).put("nx", it.nx).put("ok", it.okAt > 0)) } } } catch (e: Exception) { }
    call.resolve(JSObject().put("items", arr))
}

// La app retira uno (lo mandó ella, llegó su ✓✓ o se borró)
internal fun NexoBlePlugin.netOutboxDropImpl(call: PluginCall) {
    val id = call.getString("id") ?: ""
    if (id.isNotEmpty()) netBg().outboxDrop(id)
    call.resolve()
}

// 3219 (dueño 17-11, funciones de WhatsApp): ¿se calla el aviso de este mensaje porque su chat (o su grupo, si se conoce) está
// SILENCIADO? Las llamadas nunca. Queda en el registro nativo (sin contenido) para el diagnóstico.
internal fun NexoBlePlugin.mutedNotice(info: BgInbox.Info, groupKnown: Boolean): Boolean {
    MutedChats.ensureLoaded({ atRest().read(MutedChats.FILE) })
    if (!MutedChats.silences(info.call || info.what == "call", info.from, info.group, groupKnown)) return false
    nlog()?.add("INFO", "AVISO", "mensaje de ${info.from.ifEmpty { "?" }}${if (info.msgId.isNotEmpty()) " (msgId ${info.msgId})" else ""}: chat silenciado, sin aviso")
    return true
}

// 3219: la app da los chats silenciados [{id, until}] (until en ms; 0 = siempre), al arrancar y cada vez que cambian: en memoria del
// proceso (la usa el aviso con la app cerrada o congelada) y cifrada en el teléfono (para la escucha de internet sin la app). Se
// reemplaza la lista entera en cada llamada. Pasando la cuenta a otro teléfono no se escribe nada (moveFrozen, como setAckKeys).
internal fun NexoBlePlugin.setMutedChatsImpl(call: PluginCall) {
    try {
        val m = MutedChats.fromApp(call.getArray("chats"), System.currentTimeMillis())
        MutedChats.set(m)
        if (!moveFrozen) NetBgHome.saveMute(appCtx ?: context, atRest(), m)
        call.resolve(JSObject().put("chats", m.size))
    } catch (e: Exception) { call.reject("lista de silenciados ilegible") }
}

// Auditoría C1 (ronda 2777): la app nos da, por contacto, la clave con la que firmar la confirmación (✓✓) del modo
// cerrado (ver closedReceive). La clave (base64) la deriva la app del secreto de la pareja; aquí se guarda en memoria del
// proceso (y, desde la 3192, cifrada en el teléfono para la escucha sin la app). Se reemplaza el conjunto en cada llamada.
internal fun NexoBlePlugin.setAckKeysImpl(call: PluginCall) {
    try {
        val arr = call.getArray("keys")
        ackKeys.clear()
        if (arr != null) for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val nx = o.getString("nx").lowercase()
            val key = Base64.decode(o.getString("key"), Base64.NO_WRAP)
            if (Regex("^nx[0-9a-z]{8}$").matches(nx) && key.isNotEmpty()) ackKeys[nx] = key
        }
        netBgShared?.setAckKeys(HashMap(ackKeys))   // #87: que el modo cerrado por internet también pueda firmar el ✓✓
        // 3192 (#87, dueño 17-11 «Ok»): y cifradas en el teléfono (solo si cambiaron), para el ✓✓ de la escucha sin la app
        if (!moveFrozen) NetBgHome.saveAck(appCtx ?: context, atRest(), HashMap(ackKeys))
        call.resolve(JSObject().put("keys", ackKeys.size))
    } catch (e: Exception) { call.reject("claves de confirmación ilegibles") }
}
