package com.nexo.ble

import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.util.Log

/**
 * Build 2880: servicio Telecom autogestionado de NEXO. El sistema lo invoca cuando CallTelecom.startIncoming registra
 * una llamada entrante; aquí se crea la NexoConnection (que muestra el aviso CallStyle y enruta contestar/rechazar al
 * mismo flujo de siempre). Declarado en AndroidManifest con BIND_TELECOM_CONNECTION_SERVICE.
 */
class NexoConnectionService : ConnectionService() {

    override fun onCreateIncomingConnection(handle: PhoneAccountHandle?, request: ConnectionRequest?): Connection {
        val ctx = applicationContext
        val inner = request?.extras?.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS)
        val from = inner?.getString(CallTelecom.EX_FROM) ?: ""
        val name = inner?.getString(CallTelecom.EX_NAME) ?: "NEXO"
        val video = inner?.getBoolean(CallTelecom.EX_VIDEO) ?: false
        val offer = inner?.getString(CallTelecom.EX_OFFER) ?: ""
        val conn = NexoConnection(ctx, from, name, video, offer)
        try {
            conn.connectionProperties = Connection.PROPERTY_SELF_MANAGED
            conn.audioModeIsVoip = true
            conn.setCallerDisplayName(name.ifBlank { "NEXO" }, TelecomManager.PRESENTATION_ALLOWED)
            conn.setRinging()
        } catch (e: Throwable) { Log.w("NexoConnSvc", "config conn: ${e.message}") }
        CallTelecom.active = conn
        Log.i("NexoConnSvc", "Conexión entrante creada")
        return conn
    }

    override fun onCreateIncomingConnectionFailed(handle: PhoneAccountHandle?, request: ConnectionRequest?) {
        // Telecom rechazó la llamada: respaldo = el aviso de siempre (si no se mostró ya).
        try {
            val inner = request?.extras?.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS) ?: return
            val from = inner.getString(CallTelecom.EX_FROM) ?: return
            MsgNotifier.get(applicationContext).postCallNotification(
                from, inner.getString(CallTelecom.EX_NAME) ?: "NEXO",
                inner.getBoolean(CallTelecom.EX_VIDEO), inner.getString(CallTelecom.EX_OFFER) ?: ""
            )
        } catch (e: Throwable) {}
        CallTelecom.active = null
    }
}
