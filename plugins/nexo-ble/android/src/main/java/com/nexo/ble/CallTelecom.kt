package com.nexo.ble

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log

/**
 * Build 2880 (#dueño: ConnectionService «tipo WhatsApp»). Presenta las llamadas entrantes de NEXO como llamadas de
 * VERDAD a través de la API Telecom de Android en modo AUTOGESTIONADO (self-managed), como WhatsApp/Signal/Telegram.
 *
 * Qué aporta: el sistema trata la llamada como real → mejor foco de audio, convivencia con una llamada del teléfono,
 * auriculares/coche Bluetooth, y más prioridad con la pantalla apagada/Doze. Es GRATIS (parte de Android) y privado
 * (self-managed NO entra en el registro de llamadas del sistema ni pasa por la operadora).
 *
 * MUY IMPORTANTE (diseño conservador): NO sustituye al aviso CallStyle. El aviso de siempre se sigue mostrando igual
 * (MsgNotifier.postCallNotification), así que si Telecom no está, falla o el fabricante lo trata raro, la llamada
 * SUENA exactamente como hasta ahora (cero regresión). Esto es puramente ADITIVO y todo va envuelto en try/catch.
 *
 * minSdk del proyecto = 26, justo el mínimo del modo self-managed, así que no hacen falta guardas de versión.
 */
object CallTelecom {
    private const val TAG = "NexoCallTelecom"
    const val EX_FROM = "nx_from"
    const val EX_NAME = "nx_name"
    const val EX_VIDEO = "nx_video"
    const val EX_OFFER = "nx_offer"
    private const val RING_MS = 46000L  // red de seguridad: cerrar la llamada Telecom si nadie la atiende (> timbre 45 s)

    @Volatile var active: NexoConnection? = null
    @Volatile private var registered = false
    private val main = Handler(Looper.getMainLooper())
    private var endTimer: Runnable? = null

    private fun handle(ctx: Context): PhoneAccountHandle =
        PhoneAccountHandle(ComponentName(ctx.applicationContext, NexoConnectionService::class.java), "nexo_self")

    /** Registra la cuenta de llamada autogestionada una sola vez. Devuelve false si no se pudo (→ respaldo). */
    private fun ensureAccount(ctx: Context): Boolean {
        if (registered) return true
        return try {
            val tm = ctx.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager ?: return false
            val acc = PhoneAccount.builder(handle(ctx), "NEXO")
                .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
                .build()
            tm.registerPhoneAccount(acc)
            registered = true
            Log.i(TAG, "Cuenta de llamada NEXO (self-managed) registrada")
            true
        } catch (e: Throwable) { Log.w(TAG, "No se pudo registrar la cuenta de llamada: ${e.message}"); false }
    }

    /**
     * Intenta registrar la llamada entrante en Telecom. Best-effort: devuelve true si el sistema la aceptó (entonces
     * el framework llamará a NexoConnection.onShowIncomingCallUi). Cualquier fallo → false y el llamador ya tiene el
     * aviso de siempre puesto. NO lanza.
     */
    fun startIncoming(ctx: Context, from: String, name: String, video: Boolean, offer: String): Boolean {
        return try {
            if (!ensureAccount(ctx)) return false
            val tm = ctx.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager ?: return false
            val h = handle(ctx)
            if (!tm.isIncomingCallPermitted(h)) { Log.i(TAG, "Telecom no permite la llamada entrante ahora"); return false }
            val inner = Bundle().apply {
                putString(EX_FROM, from); putString(EX_NAME, name); putBoolean(EX_VIDEO, video); putString(EX_OFFER, offer)
            }
            val extras = Bundle().apply {
                putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, Uri.fromParts("nexo", from, null))
                putBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS, inner)
            }
            tm.addNewIncomingCall(h, extras)
            armEndTimer()
            true
        } catch (e: Throwable) { Log.w(TAG, "addNewIncomingCall falló (sigue el aviso normal): ${e.message}"); false }
    }

    private fun armEndTimer() {
        cancelEndTimer()
        val r = Runnable { endActive() }
        endTimer = r
        main.postDelayed(r, RING_MS)
    }
    private fun cancelEndTimer() { endTimer?.let { try { main.removeCallbacks(it) } catch (e: Throwable) {} }; endTimer = null }

    /** Cierra la llamada Telecom activa (al colgar/rechazar/caducar o cuando NEXO cierra la llamada). Idempotente. */
    fun endActive() {
        cancelEndTimer()
        val c = active
        active = null
        if (c != null) try { c.closeCall() } catch (e: Throwable) {}
    }
}
