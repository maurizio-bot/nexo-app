package com.nexo.ble

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.nexo.ble.NexoBlePlugin.Companion.TAG

// 3129 — Enlace de invitación (PLAN etapa 2): compartir el texto de la invitación con WhatsApp, TikTok o el menú del teléfono, y
// avisar a la app cuando se abre con un enlace de invitación (InviteLink: solo nuestras direcciones).

/** shareText({ text, pkgs: [paquetes a probar en orden] }): abre la primera app instalada de la lista; si no hay, el menú del teléfono. */
internal fun NexoBlePlugin.shareTextImpl(call: PluginCall) {
    val text = call.getString("text")
    if (text.isNullOrEmpty() || text.length > 2000) { call.reject("texto vacío o demasiado largo"); return }
    val act = activity
    if (act == null) { call.reject("sin pantalla"); return }
    val pkgs = try { call.getArray("pkgs")?.toList<String>() ?: emptyList() } catch (e: Exception) { emptyList() }
    val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, text) }
    for (p in pkgs) {
        if (!Regex("^[a-z][a-z0-9_.]{2,80}$").matches(p)) continue
        try {
            act.startActivity(Intent(send).setPackage(p).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve(JSObject().put("via", p)); return
        } catch (e: ActivityNotFoundException) { /* no está instalada: la siguiente */ } catch (e: Exception) { Log.w(TAG, "Compartir con $p: ${e.message}") }
    }
    try {
        act.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve(JSObject().put("via", if (pkgs.isEmpty()) "menu" else "menu (no instalada)"))
    } catch (e: Exception) { call.reject("no se pudo compartir: ${e.message}") }
}

/** La app se abrió (o volvió) con un enlace de invitación nuestro → evento onInviteLink {id, code} (se guarda si la app aún no escucha). */
internal fun NexoBlePlugin.checkInviteIntent(given: Intent? = null) {
    try {
        val intent = given ?: activity?.intent ?: return
        if (intent.action != Intent.ACTION_VIEW) return
        val parsed = InviteLink.parse(intent.dataString) ?: return
        intent.data = null // que un giro o un «volver» no lo repita
        notifyListenersExt("onInviteLink", JSObject().put("id", parsed.first).put("code", parsed.second), true)
    } catch (e: Exception) { Log.w(TAG, "Enlace de invitación: ${e.message}") }
}

// 3161 (dueño 16-11): NEXO en el menú «Compartir» de Android (texto y enlaces) y enlaces del chat que se abren fuera (SharedText.kt).

/** La app se abrió (o volvió) desde «Compartir» con un texto → evento onSharedText {text} (retenido hasta que la app escucha). */
internal fun NexoBlePlugin.checkSharedTextIntent(given: Intent? = null) {
    try {
        val intent = given ?: activity?.intent ?: return
        if (intent.action != Intent.ACTION_SEND) return
        // Reabierta desde «Recientes» tras cerrarse: Android repite el intent con el que se abrió; no se vuelve a compartir
        if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
        val text = SharedText.clean(intent.type, try { intent.getCharSequenceExtra(Intent.EXTRA_TEXT) } catch (e: Exception) { null })
        intent.removeExtra(Intent.EXTRA_TEXT) // que un giro o un «volver» no lo repita
        if (text == null) return
        notifyListenersExt("onSharedText", JSObject().put("text", text), true)
    } catch (e: Exception) { Log.w(TAG, "Texto compartido: ${e.message}") }
}

/** openUrl({ url }): abre un enlace http/https FUERA de NEXO (la app de TikTok/Instagram/… si está instalada; si no, el navegador). */
internal fun NexoBlePlugin.openUrlImpl(call: PluginCall) {
    val url = SharedText.httpUrl(call.getString("url"))
    if (url == null) { call.reject("solo enlaces http/https"); return }
    val act = activity
    if (act == null) { call.reject("sin pantalla"); return }
    try {
        act.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve(JSObject().put("opened", true))
    } catch (e: ActivityNotFoundException) {
        call.resolve(JSObject().put("opened", false).put("reason", "no_app"))
    } catch (e: Exception) { call.reject("no se pudo abrir el enlace: ${e.message}") }
}
