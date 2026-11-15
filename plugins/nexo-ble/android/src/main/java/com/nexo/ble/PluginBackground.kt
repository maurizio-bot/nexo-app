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
        val g = JSONObject(atRest().read("nexo_groups.json") ?: "{}").optJSONObject("groups")
        val m = HashMap<String, String>()
        g?.keys()?.forEach { k -> g.optJSONObject(k)?.optString("name")?.takeIf { it.isNotEmpty() }?.let { m[k.lowercase()] = it } }
        groupNames = now to m; m
    } catch (e: Exception) { emptyMap() }
    return map[gid.lowercase()]
}

// Aviso de "solo notificación" (BgInbox.Kind.NOTIFY_ONLY): sin remitente (Jump con remitente oculto) va a un chat
// aparte que la app quita al abrirse (no es un contacto)
private fun NexoBlePlugin.notifyOnly(ctx: Context, info: BgInbox.Info) {
    if (info.quiet) return
    if (info.what == "call") { MsgNotifier.get(ctx).incomingCall(info.from, netBgShared?.nameOf(info.from) ?: "NEXO", info.video, info.msgId); return }
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
    val chatOpen = activeChatNx.isNotEmpty() && (info.from.lowercase() == activeChatNx || info.group.lowercase() == activeChatNx)
    val silent = BgNotifyPolicy.silentForOpenChat(chatOpen, System.currentTimeMillis() - bgSinceMs)
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
    val old = orphan
    if (old != null && old !== this) {
        orphan = null
        try { old.endClosedMode() } catch (e: Exception) { }
    }
    val list = try { inbox().drain() } catch (e: Exception) { emptyList() }
    if (list.isNotEmpty()) remLog("INFO", "FILE_IO", "Con la app cerrada llegaron ${list.size} mensaje(s)/confirmación(es) por Bluetooth")
    val now = System.currentTimeMillis()
    list.forEach { item ->
        notifyListeners("onPayloadReceived", JSObject().put("deviceId", item.deviceId).put("content", item.json).put("data", item.json)
            .put("source", "closed").put("timestamp", if (item.ts in 1..now) item.ts else now).put("reassembled", true), true)
    }
}

// La instancia vieja deja el Bluetooth a la nueva (cierra sus conexiones y su servidor; el anuncio sigue en el servicio)
private fun NexoBlePlugin.endClosedMode() {
    closedMode = false
    cleanupAllConnections()
    try { unregisterServerReceivers() } catch (e: Exception) { }
    try { unregisterBluetoothStateReceiver() } catch (e: Exception) { }
    try { stopGattServer() } catch (e: Exception) { }
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
// Una por proceso: sigue aunque se cierre la actividad mientras el servicio de Bluetooth mantiene el proceso
internal fun NexoBlePlugin.netBg(): NetBg = netBgShared ?: synchronized(NexoBlePlugin::class.java) {
    // Ronda 2774 (el dueño: con la pantalla apagada no llegan por Wi-Fi/internet): al recibir por internet en segundo
    // plano se renueva el wakelock (rxWake), igual que por Bluetooth y Wi-Fi, para que dé tiempo a avisar antes de que
    // el teléfono vuelva a dormir.
    netBgShared ?: NetBg({ nx, name, msgId, isCall, group, video ->
        if (appInBackground) rxWake()
        // #130b (dueño 31-10): una oferta de llamada/videollamada que llega por internet con la app en segundo plano o
        // congelada tiene que salir a PANTALLA COMPLETA (enciende el teléfono, Contestar/Rechazar), como la 1-a-1 por
        // Bluetooth y como las llamadas de grupo. Antes salía como «mensaje nuevo» porque NetBg solo miraba el msgId.
        if (isCall) {
            nlog()?.add("INFO", "NET", "oferta de llamada de $nx por internet (msgId $msgId): pantalla de llamada")
            MsgNotifier.get(context).incomingCall(nx, name, video, msgId) // 3089: «Videollamada entrante» si lo es
        } else if (SeenMsgs.has(context, msgId)) {
            // 3008: reenvío de un mensaje que este teléfono ya tiene → sin «Mensaje nuevo» (la ✓✓ sí se devuelve, para que el otro pare)
            nlog()?.add("INFO", "NET", "sobre de $nx (msgId $msgId): ese mensaje ya estaba en el teléfono (reenvío): sin aviso")
        } else {
            // 3076: un mensaje de GRUPO avisa en el grupo, con su nombre y quién lo manda (como por Bluetooth: notifyMessage)
            val gname = groupName(group)
            nlog()?.add("INFO", "NET", "sobre de $nx (msgId $msgId): aviso de mensaje nuevo por internet" + if (gname != null) " (grupo $group)" else "")
            if (gname != null) MsgNotifier.get(context).message(group, gname, msgId, "$name: " + NativeLang.t(context, "msg_new"), true)
            else MsgNotifier.get(context).message(nx, name, msgId, "", true)
        }
    }, { nlog()?.add("INFO", "NET", it); Log.i("NEXO_NET", it) }, { nx, offer ->
        // 3087: el que llama colgó (sobre con ce, por internet) → deja de sonar ya
        if (MsgNotifier.get(context).cancelCallFor(nx, offer)) nlog()?.add("INFO", "NET", "$nx colgó: la llamada deja de sonar")
    }).also { netBgShared = it }
}

internal fun NexoBlePlugin.netBgConfigImpl(call: PluginCall) {
    val me = call.getString("me") ?: run { call.reject("falta me"); return }
    val relays = ArrayList<String>(); val list = ArrayList<NetBg.Contact>()
    try {
        call.getArray("relays")?.let { for (i in 0 until it.length()) relays.add(it.getString(i)) }
        call.getArray("contacts")?.let { for (i in 0 until it.length()) { val o = it.getJSONObject(i); list.add(NetBg.Contact(o.getString("nx").lowercase(), o.optString("name"), Secp256k1.unhex(o.getString("kraw")))) } }
    } catch (e: Exception) { call.reject("configuración ilegible"); return }
    val since = (call.getData().optLong("since", 0L))
    netBg().configure(me, relays, since, list)
    netBg().setAckKeys(HashMap(ackKeys))   // #87: para confirmar la ENTREGA (✓✓) con la app cerrada
    if (appInBackground && list.isNotEmpty()) { wifiLockHold(true); netBg().start() }
    call.resolve(JSObject().put("contacts", list.size).put("running", netBg().running))
}

// 3033: lo que la escucha de internet en segundo plano recibió (eventos del relé, cifrados) para que la app lo procese
// al volver sin esperar a los relés (ver NetBg.drainForApp)
internal fun NexoBlePlugin.netBgDrainImpl(call: PluginCall) {
    val list = try { netBgShared?.drainForApp() ?: emptyList() } catch (e: Exception) { emptyList<String>() }
    val arr = JSArray()
    for (s in list) arr.put(s)
    call.resolve(JSObject().put("events", arr))
}

// Auditoría C1 (ronda 2777): la app nos da, por contacto, la clave con la que firmar la confirmación (✓✓) del modo
// cerrado (ver closedReceive). La clave (base64) la deriva la app del secreto de la pareja; aquí solo se guarda en
// memoria del proceso. Se reemplaza el conjunto en cada llamada.
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
        call.resolve(JSObject().put("keys", ackKeys.size))
    } catch (e: Exception) { call.reject("claves de confirmación ilegibles") }
}
