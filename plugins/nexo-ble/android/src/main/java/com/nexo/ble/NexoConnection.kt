package com.nexo.ble

import android.content.Context
import android.content.Intent
import android.telecom.Connection
import android.telecom.DisconnectCause
import android.util.Log

/**
 * Build 2880: una llamada entrante de NEXO vista por Telecom (self-managed). Reutiliza EXACTAMENTE el mismo camino que
 * el aviso CallStyle: «Contestar» apunta la oferta y abre NEXO (MsgNotifier.pendingAnswer); «Rechazar/Colgar» avisa a
 * la lógica de llamadas (NexoBlePlugin.declinedFromNotification). Así el estado nunca se desincroniza del de siempre.
 */
class NexoConnection(
    private val ctx: Context,
    private val from: String,
    private val name: String,
    private val video: Boolean,
    private val offer: String
) : Connection() {

    // self-managed: la app pone su propia UI de llamada entrante → el aviso CallStyle probado.
    override fun onShowIncomingCallUi() {
        try { MsgNotifier.get(ctx).postCallNotification(from, name, video, offer) } catch (e: Throwable) {}
    }

    override fun onAnswer() {
        try {
            setActive()
            // Igual que tocar «Contestar» en el aviso (MsgNotifier.incomingCall / checkNotificationIntent).
            MsgNotifier.pendingAnswer = CallTap(from.lowercase(), System.currentTimeMillis(), offer)
            val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            if (launch != null) {
                launch.putExtra(MsgNotifier.EXTRA_ANSWER, from)
                    .putExtra(MsgNotifier.EXTRA_CALL_OFFER, offer)
                    .putExtra(MsgNotifier.EXTRA_CALL_TOKEN, MsgNotifier.callIntentToken)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                ctx.startActivity(launch)
            }
            try { MsgNotifier.get(ctx).cancelCall() } catch (e: Throwable) {}
        } catch (e: Throwable) { Log.w("NexoConnection", "onAnswer: ${e.message}") }
    }

    override fun onReject() { declineAndClose() }
    override fun onReject(replyMessage: String?) { declineAndClose() }
    override fun onDisconnect() { declineAndClose() }
    override fun onAbort() { closeCall() }

    private fun declineAndClose() {
        try {
            val tap = CallTap(from.lowercase(), System.currentTimeMillis(), offer)
            MsgNotifier.pendingDecline = tap
            NexoBlePlugin.declinedFromNotification(tap)
            try { MsgNotifier.get(ctx).cancelCall() } catch (e: Throwable) {}
        } catch (e: Throwable) {}
        closeCall()
    }

    /** Cerrar la llamada Telecom (colgar/rechazar/caducar, o cuando NEXO termina la llamada). Idempotente. */
    fun closeCall() {
        try { setDisconnected(DisconnectCause(DisconnectCause.LOCAL)); destroy() } catch (e: Throwable) {}
        if (CallTelecom.active === this) CallTelecom.active = null
    }
}
