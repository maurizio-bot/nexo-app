package com.nexo.ble

import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.view.WindowManager
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import androidx.activity.result.ActivityResult
import com.nexo.ble.NexoBlePlugin.Companion.netBgShared
import com.nexo.ble.NexoBlePlugin.Companion.TAG

// Avisos: tocar una notificación, llamada entrante, pantalla de bloqueo, tonos y notificaciones de mensajes.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

internal fun NexoBlePlugin.checkNotificationIntent(given: Intent? = null) {
    try {
        val intent = given ?: activity.intent
        if (intent != null) {
            // Auditoría (ronda 2774): la pantalla principal está exportada; solo hacemos caso a "contestar"/"abrir
            // llamada" si el intent trae nuestro testigo (va dentro del PendingIntent del aviso, que otras apps no
            // pueden leer). Sin esto, otra app del teléfono podía descolgar sola una llamada que estuviera sonando.
            val callTokenOk = intent.getStringExtra(MsgNotifier.EXTRA_CALL_TOKEN) == MsgNotifier.callIntentToken
            // Ronda 2765: abierta por una llamada (pantalla completa, tocar el aviso o Contestar): se ve encima de la
            // pantalla de bloqueo y la enciende, hasta que acaba la llamada (callScreenDone)
            if (callTokenOk && (intent.getStringExtra(MsgNotifier.EXTRA_ANSWER) != null || intent.getStringExtra(MsgNotifier.EXTRA_CALL_FROM) != null)) showOverLock(true)
            // Ronda 2763: "Contestar" en el aviso de llamada (ronda 2768: solo para esa oferta)
            val answer = if (callTokenOk) intent.getStringExtra(MsgNotifier.EXTRA_ANSWER) else null
            if (answer != null) {
                val offer = intent.getStringExtra(MsgNotifier.EXTRA_CALL_OFFER) ?: ""
                MsgNotifier.pendingAnswer = CallTap(answer.lowercase(), System.currentTimeMillis(), offer)
                MsgNotifier.get(activity.applicationContext).cancelCall()
                notifyListeners("onCallAction", JSObject().put("answer", answer.lowercase()).put("answerOffer", offer), true)
                intent.removeExtra(MsgNotifier.EXTRA_ANSWER)
                intent.removeExtra(MsgNotifier.EXTRA_CALL_OFFER)
            }
            // 2994: botón «Actualizar» del aviso de versión nueva (mismo testigo): la app baja e instala
            if (callTokenOk && intent.hasExtra(MsgNotifier.EXTRA_UPDATE_INSTALL)) {
                val ub = intent.getIntExtra(MsgNotifier.EXTRA_UPDATE_INSTALL, 0)
                MsgNotifier.get(activity.applicationContext).cancelUpdate()
                notifyListeners("onUpdateAction", JSObject().put("install", true).put("build", ub), true)
                intent.removeExtra(MsgNotifier.EXTRA_UPDATE_INSTALL)
            }
            // 2995: el aviso genérico «Mensaje nuevo» (despertar por FCM) no trae chat: la app decide con sus no leídos
            if (intent.hasExtra(MsgNotifier.EXTRA_WAKE_TAP)) {
                remLog("INFO", "NOTIF", "Aviso genérico «Mensaje nuevo» tocado: la app abre el chat del último mensaje sin leer")
                notifyListeners("onNotificationOpened", JSObject().put("deviceId", "").put("source", "wake"), true)
                intent.removeExtra(MsgNotifier.EXTRA_WAKE_TAP)
            }
            val deviceId = intent.getStringExtra("nexo_chat_device_id")
            if (deviceId != null) {
                remLog("INFO", "NOTIF", "Aviso de mensaje tocado: abre el chat " + deviceId)
                // 2995: con la app CERRADA este aviso sale al cargar el plugin, antes de que exista el JS; sin «retener» se
                // perdía (y el extra se borra justo después). Retenido hasta que el JS escuche.
                notifyListeners("onNotificationOpened", JSObject()
                    .put("deviceId", deviceId)
                    .put("source", "notification")
                , true)
                intent.removeExtra("nexo_chat_device_id")
            }
        }
    } catch (e: Exception) { }
}

// ===== Ronda 2763: llamada entrante como una llamada del teléfono (calls_ui.js) =====
internal fun NexoBlePlugin.notifyCallImpl(call: PluginCall) {
    val from = (call.getString("chatId") ?: "").lowercase()
    if (from.isEmpty()) { call.reject("chatId requerido"); return }
    MsgNotifier.get(context).incomingCall(from, call.getString("name") ?: "NEXO", call.getBoolean("video", false) == true, call.getString("offerId") ?: "")
    call.resolve()
}
// Ronda 2768: "Rechazar" tocado con la app viva (ver declinedFromNotification). Sigue apuntado (pendingDecline): si la
// app aún no tenía la llamada sonando (oferta a medias, app congelada), lo recoge al sonar; va atado a esa oferta
internal fun NexoBlePlugin.onDeclineTapped(tap: CallTap) {
    if (closedMode) return
    notifyListeners("onCallAction", JSObject().put("declined", tap.from).put("declinedOffer", tap.offer), true)
}
// Build 2882 (parte 2): el sistema pidió colgar la llamada activa/saliente (ver telecomEnded). El JS (ble_interface)
// cuelga la llamada NEXO en curso si es de ese contacto.
internal fun NexoBlePlugin.onTelecomEnded(from: String) {
    if (closedMode) return
    notifyListeners("onTelecomEnd", JSObject().put("nx", from), true)
}

// Build 2882 (parte 2): puente del ciclo de vida de la llamada SALIENTE con Telecom (self-managed). Lo llama calls.js:
//   op="out"    al empezar a llamar  → placeCall (la llamada aparece como real: coche/auriculares/foco de audio)
//   op="active" cuando el otro contesta → la conexión Telecom pasa a activa
//   op="end"    al colgar/terminar     → se cierra la conexión Telecom
// Best-effort y aditivo: si Telecom no está o falla, NEXO llama EXACTAMENTE como hasta ahora. Nunca rechaza (el JS no
// depende del resultado). La entrante (parte 1) NO pasa por aquí: se registra sola al llegar la oferta.
internal fun NexoBlePlugin.telecomImpl(call: PluginCall) {
    val op = call.getString("op") ?: ""
    var ok = false
    try {
        when (op) {
            "out" -> {
                val to = (call.getString("to") ?: "").lowercase()
                if (to.isNotEmpty()) {
                    val name = netBgShared?.nameOf(to) ?: "NEXO"
                    ok = CallTelecom.startOutgoing(context, to, name, call.getBoolean("video", false) == true)
                }
            }
            "active" -> { CallTelecom.setActive(); ok = true }
            "end" -> { CallTelecom.endActive(); ok = true }
        }
    } catch (e: Throwable) { Log.w(TAG, "telecom($op): ${e.message}") }
    call.resolve(JSObject().put("ok", ok))
}

// ===== Ronda 2765: avisos con la pantalla apagada =====
internal fun NexoBlePlugin.showOverLock(on: Boolean) {
    val act = activity ?: return
    act.runOnUiThread {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) { act.setShowWhenLocked(on); act.setTurnScreenOn(on) }
            else {
                @Suppress("DEPRECATION")
                val f = android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                if (on) act.window.addFlags(f) else act.window.clearFlags(f)
            }
        } catch (e: Exception) { Log.w(TAG, "Pantalla de bloqueo: ${e.message}") }
    }
}

// Tono de llamada/videollamada (ronda 2774, pedido del dueño): el actual (nombre y uri). Por defecto es el tono de
// llamada del propio teléfono; vale para llamadas y videollamadas (mismo canal de avisos).
internal fun NexoBlePlugin.getCallRingtoneImpl(call: PluginCall) {
    val ctx = context
    call.resolve(JSObject().put("title", MsgNotifier.get(ctx).callRingtoneTitle(ctx)).put("uri", MsgNotifier.get(ctx).callRingtoneUri(ctx).toString()))
}

// Abre el selector de tonos del teléfono (los guardados en el dispositivo) con el actual marcado; "Predeterminado"
// vuelve al tono de llamada del teléfono. Lo elegido se aplica recreando el canal (ringtonePicked).
internal fun NexoBlePlugin.pickCallRingtoneImpl(call: PluginCall) {
    val ctx = context
    val current = MsgNotifier.get(ctx).callRingtoneUri(ctx)
    val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_RINGTONE)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Tono de llamada de NEXO")
        .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
        .putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
        .putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, current)
    try { startActivityForResult(call, intent, "ringtonePicked") }
    catch (e: Exception) { call.reject("No se pudo abrir el selector de tonos: ${e.message}") }
}

@Suppress("DEPRECATION") // getParcelableExtra(name) está obsoleto en API 33+ pero sigue funcionando en todas
internal fun NexoBlePlugin.ringtonePickedImpl(call: PluginCall?, result: ActivityResult) {
    if (call == null) return
    if (result.resultCode != android.app.Activity.RESULT_OK) { call.resolve(JSObject().put("changed", false)); return }
    val ctx = context
    // EXTRA_RINGTONE_PICKED_URI: null = "Predeterminado" (el del teléfono) o silencio; se guarda "" para volver al del teléfono
    val picked = result.data?.getParcelableExtra<android.net.Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
    MsgNotifier.get(ctx).setCallRingtone(ctx, picked?.toString() ?: "")
    call.resolve(JSObject().put("changed", true).put("title", MsgNotifier.get(ctx).callRingtoneTitle(ctx)).put("uri", MsgNotifier.get(ctx).callRingtoneUri(ctx).toString()))
}

// Qué falta para que los avisos y las llamadas lleguen con la pantalla apagada (Perfil)
internal fun NexoBlePlugin.alertSettingsImpl(call: PluginCall) {
    val ctx = context
    val notif = androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    val full = if (Build.VERSION.SDK_INT >= 34) (ctx.getSystemService(android.app.NotificationManager::class.java)?.canUseFullScreenIntent() ?: true) else true
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
    val battery = pm.isIgnoringBatteryOptimizations(ctx.packageName)
    call.resolve(JSObject().put("notifications", notif).put("fullScreen", full).put("battery", battery)
        .put("wakeOnMessage", MsgNotifier.get(ctx).wakeOnMsg()).put("vendor", Build.MANUFACTURER.lowercase()))
}

// Abre el ajuste del sistema que falta: what = notifications | fullScreen | battery | vendor | app
internal fun NexoBlePlugin.openAlertSettingImpl(call: PluginCall) {
    val ctx = context
    val pkg = android.net.Uri.parse("package:" + ctx.packageName)
    // Ronda 2772: ajustes propios del fabricante para dejar a NEXO en segundo plano (Vivo: inicio automático y alto
    // consumo en segundo plano; Samsung: batería; Xiaomi, Oppo, Huawei: inicio automático). Cada fabricante los
    // esconde en un sitio; si ninguno abre, la ficha de la app
    if (call.getString("what") == "vendor") {
        val m = Build.MANUFACTURER.lowercase()
        val comps = when {
            m.contains("vivo") || m.contains("iqoo") -> listOf("com.vivo.permissionmanager/.activity.BgStartUpManagerActivity",
                "com.iqoo.secure/.ui.phoneoptimize.AddWhiteListActivity", "com.iqoo.secure/.ui.phoneoptimize.BgStartUpManager")
            m.contains("samsung") -> listOf("com.samsung.android.lool/com.samsung.android.sm.ui.battery.BatteryActivity")
            m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") -> listOf("com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity")
            m.contains("oppo") || m.contains("realme") || m.contains("oneplus") -> listOf("com.coloros.safecenter/.permission.startup.StartupAppListActivity")
            m.contains("huawei") || m.contains("honor") -> listOf("com.huawei.systemmanager/.startupmgr.ui.StartupNormalAppListActivity")
            else -> emptyList()
        }
        for (cn in comps) {
            try {
                activity.startActivity(Intent().setComponent(android.content.ComponentName.unflattenFromString(cn)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                call.resolve(JSObject().put("opened", true).put("screen", cn)); return
            } catch (e: Exception) { }
        }
        try { activity.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); call.resolve(JSObject().put("opened", true).put("fallback", true)) }
        catch (e: Exception) { call.resolve(JSObject().put("opened", false)) }
        return
    }
    val i = when (call.getString("what")) {
        "battery" -> Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, pkg)
        // 3098: la ficha de la app (Permisos: cámara bloqueada en una videollamada)
        "app" -> Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg)
        "fullScreen" -> if (Build.VERSION.SDK_INT >= 34) Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg) else null
        else -> Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.packageName)
    }
    if (i == null) { call.resolve(JSObject().put("opened", false)); return }
    try { activity.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); call.resolve(JSObject().put("opened", true)) }
    catch (e: Exception) {
        // Algunos fabricantes no tienen esa pantalla: la de la app
        try { activity.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); call.resolve(JSObject().put("opened", true).put("fallback", true)) }
        catch (e2: Exception) { call.resolve(JSObject().put("opened", false)) }
    }
}
// Lo que se tocó en el aviso (Contestar / Rechazar) en los últimos 90 s; se entrega una vez
internal fun NexoBlePlugin.callActionImpl(call: PluginCall) {
    val now = System.currentTimeMillis()
    val a = MsgNotifier.pendingAnswer?.takeIf { now - it.at < 90000 }
    val d = MsgNotifier.pendingDecline?.takeIf { now - it.at < 90000 }
    MsgNotifier.pendingAnswer = null; MsgNotifier.pendingDecline = null
    val out = JSObject()
    if (a != null) out.put("answer", a.from).put("answerOffer", a.offer)
    if (d != null) out.put("declined", d.from).put("declinedOffer", d.offer)
    call.resolve(out)
}

// 3008: la app avisa de los mensajes que YA recibió (con la app abierta), para que un reenvío de alguno con la app cerrada no
// salga como «Mensaje nuevo» (ver SeenMsgs)
internal fun NexoBlePlugin.markMsgsSeenImpl(call: PluginCall) {
    val ids = ArrayList<String>()
    try { call.getArray("ids")?.let { for (i in 0 until it.length()) { val v = it.optString(i); if (v.isNotEmpty()) ids.add(v) } } } catch (e: Exception) {}
    if (ids.isNotEmpty()) SeenMsgs.add(context, ids)
    call.resolve(JSObject().put("count", ids.size))
}

// ===== Notificaciones de mensajes (MsgNotifier): las pide notify.js con la app en segundo plano =====
internal fun NexoBlePlugin.setNotifAvatarImpl(call: PluginCall) {
    // 3094: la foto que la app MUESTRA de este contacto, para sus avisos (solo en memoria; img vacía = quitarla)
    val chatId = call.getString("chatId") ?: run { call.reject("falta chatId"); return }
    val img = call.getString("img") ?: ""
    val bytes = if (img.isEmpty()) null else try {
        android.util.Base64.decode(NotifAvatars.base64Part(img), android.util.Base64.DEFAULT)
    } catch (e: IllegalArgumentException) { null }
    NotifAvatars.put(chatId, bytes)
    call.resolve()
}

internal fun NexoBlePlugin.notifyMessageImpl(call: PluginCall) {
    val chatId = call.getString("chatId") ?: run { call.reject("falta chatId"); return }
    val count = MsgNotifier.get(context).message(chatId, call.getString("name") ?: "NEXO", call.getString("msgId") ?: System.currentTimeMillis().toString(), call.getString("text") ?: "")
    call.resolve(JSObject().put("count", count))
}

internal fun NexoBlePlugin.notificationPermCallbackImpl(call: PluginCall) {
    val ok = getPermissionState("postNotifications") == com.getcapacitor.PermissionState.GRANTED
    remLog("INFO", "PERMISSIONS", "Notificaciones: " + if (ok) "permitidas" else "denegadas")
    call.resolve(JSObject().put("granted", ok))
}

internal fun NexoBlePlugin.setActiveChatImpl(call: PluginCall) {
    activeChatNx = (call.getString("chatId") ?: "").lowercase().trim()
    call.resolve()
}

internal fun NexoBlePlugin.clearChatNotificationImpl(call: PluginCall) {
    val chatId = call.getString("chatId") ?: run { call.reject("falta chatId"); return }
    MsgNotifier.get(context).clear(chatId)
    call.resolve()
}

// Los contadores de la app mandan: ajusta o quita las notificaciones puestas (también las de segundo plano)
internal fun NexoBlePlugin.syncUnreadImpl(call: PluginCall) {
    val counts = HashMap<String, Int>()
    try {
        val arr = call.getArray("chats")
        if (arr != null) for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            counts[o.optString("chatId").lowercase()] = o.optInt("count", 0)
        }
    } catch (e: Exception) { }
    MsgNotifier.get(context).sync(counts)
    call.resolve()
}
