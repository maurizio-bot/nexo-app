package com.nexo.ble

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.json.JSONArray

// COLA 22 (22-11): «tu teléfono silencia a NEXO». Estado de los canales de avisos (mensajes y llamadas) y del «No molestar», y
// abrir el ajuste exacto. La decisión está en SilencedPolicy (JVM). Extensiones de NexoBlePlugin; los @PluginMethod, en la clase.

private fun NexoBlePlugin.channelOf(nm: NotificationManager?, id: String): NotificationChannel? =
    if (Build.VERSION.SDK_INT >= 26) try { nm?.getNotificationChannel(id) } catch (e: Exception) { null } else null

private fun NexoBlePlugin.stateOf(nm: NotificationManager?, ch: NotificationChannel?, needsPopup: Boolean): String {
    if (ch == null || Build.VERSION.SDK_INT < 26) return SilencedPolicy.OK
    val groupBlocked = try { Build.VERSION.SDK_INT >= 28 && ch.group != null && nm?.getNotificationChannelGroup(ch.group)?.isBlocked == true } catch (e: Exception) { false }
    return SilencedPolicy.channelState(ch.importance, ch.sound != null, groupBlocked, needsPopup)
}

internal fun NexoBlePlugin.silencedStateImpl(call: PluginCall) {
    try {
        val ctx = context
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        val mch = channelOf(nm, MsgNotifier.CHANNEL_ID)
        val cch = channelOf(nm, MsgNotifier.CALL_CHANNEL_ID)
        val msg = stateOf(nm, mch, false)
        val callS = stateOf(nm, cch, true)
        val filter = try { nm?.currentInterruptionFilter ?: SilencedPolicy.FILTER_ALL } catch (e: Exception) { SilencedPolicy.FILTER_ALL }
        val mb = mch?.canBypassDnd() == true
        val cb = cch?.canBypassDnd() == true
        val issues = JSONArray(SilencedPolicy.issues(msg, callS, filter, mb, cb))
        call.resolve(JSObject().put("messages", msg).put("calls", callS).put("dnd", SilencedPolicy.dndActive(filter))
            .put("dndKind", SilencedPolicy.dndKind(filter)).put("issues", issues)
            .put("appEnabled", androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled()))
    } catch (e: Exception) { call.resolve(JSObject().put("issues", JSONArray()).put("error", e.message ?: "")) }
}

// what = messages | calls (ajustes de ESE canal) | dnd (ajustes de «No molestar»). Sin pantalla propia: los avisos de la app.
internal fun NexoBlePlugin.silencedOpenImpl(call: PluginCall) {
    val ctx = context
    val what = call.getString("what") ?: "messages"
    val app = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
    val i = when (what) {
        "messages", "calls" -> if (Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, if (what == "calls") MsgNotifier.CALL_CHANNEL_ID else MsgNotifier.CHANNEL_ID) else app
        "dnd" -> Intent("android.settings.ZEN_MODE_SETTINGS")
        else -> app
    }
    for (cand in listOf(i, app)) {
        try { activity.startActivity(cand.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); call.resolve(JSObject().put("opened", true).put("fallback", cand !== i)); return } catch (e: Exception) { }
    }
    call.resolve(JSObject().put("opened", false))
}
