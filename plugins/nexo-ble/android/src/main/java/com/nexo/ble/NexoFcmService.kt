package com.nexo.ble

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.io.File

/**
 * FCM «despertador» tipo WhatsApp (#87). Google (FCM) despierta NEXO aunque esté CERRADA o el fabricante (Vivo,
 * Samsung…) la congele, igual que a WhatsApp. Por Google SOLO pasa un "toque" (unos bytes, sin contenido); el mensaje
 * sigue por el camino normal de NEXO (Bluetooth/Wi-Fi o el buzón del relé), cifrado de punta a punta. Ver docs/FCM.md.
 *
 * Fase 1 (esto): RECIBIR.
 *  - onNewToken: guarda el token de este teléfono (su "dirección" para despertarlo) y lo deja en el diagnóstico.
 *  - onMessageReceived: al llegar un "toque", arranca el servicio de NEXO (que ya baja el buzón por NetBg) y deja un
 *    aviso para que se vea que despertó.
 * La Fase 2 (enviar) comparte el token cifrado con los contactos y dispara el "toque" al mandar a uno que no está
 * en línea (el enviador —Cloud Function— guarda la llave de Google y llama a la API de FCM).
 *
 * Todo defensivo: si Firebase/Play Services no está o algo falla, no se cae; solo deja constancia en el registro nativo.
 */
class NexoFcmService : FirebaseMessagingService() {

    companion object {
        const val PREFS = "nexo_fcm"
        const val PREF_TOKEN = "token"
        const val WAKE_NOTIF_ID = 4600
        private const val TAG = "NEXO_FCM"
    }

    // Registro nativo persistente (NativeLog.kt), el MISMO archivo que lee el diagnóstico (NexoBlePlugin.readNativeLog).
    // Este servicio puede correr con la app cerrada, sin el WebView; así el dueño ve en el diagnóstico que FCM despertó.
    private fun nlog(message: String, level: String = "INFO") {
        try { NativeLog(File(filesDir, "nexo_native_log.txt")).add(level, "FCM", message) } catch (e: Exception) { }
        Log.i(TAG, message)
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        try { getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_TOKEN, token).apply() } catch (e: Exception) { }
        // SEC-3 (03-11): el token es la "dirección" para despertar ESTE teléfono. La Fase 1 ya se probó, así que al
        // diagnóstico va SOLO un prefijo + largo (no el token entero), para que un diagnóstico compartido no deje a nadie
        // despertar este teléfono. El token completo sí se comparte con los contactos, cifrado, por el camino normal.
        nlog("Token FCM nuevo: ${token.take(12)}... (${token.length} car.)")
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        nlog("Despierta recibido (data=${message.data.size}, prio=${message.priority}/${message.originalPriority})")

        // 1) Arrancar el servicio de NEXO para que empiece a bajar el buzón (NetBg) y el Bluetooth. Un "toque" de ALTA
        //    prioridad de FCM da permiso temporal para arrancar un servicio en primer plano desde segundo plano (como
        //    WhatsApp). Defensivo: si el sistema no lo permite, el aviso de abajo igual despierta al dueño.
        var started = false
        try {
            val svc = Intent(this, BleService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(svc) else startService(svc)
            started = true
        } catch (e: Throwable) { nlog("No se pudo arrancar el servicio al despertar: ${e.message}", "WARN") }

        // 2) 3076 (dueño 14-11: «notificaciones fantasmas… la de cuando recibo un diagnóstico me aparece como notificación»): ANTES
        //    cada toque ponía un aviso «NEXO · Mensaje nuevo», hubiera o no un mensaje: el toque no dice nada (solo despierta) y
        //    se manda también por cosas que no se leen (diagnósticos, estados) o al abrir un chat (3073). Ahora el toque solo
        //    despierta; el aviso lo pone el mensaje DE VERDAD cuando llega (NetBg/Bluetooth: uno por mensaje, sin repetir).
        //    Solo si el servicio no pudo arrancar (sin él no baja nada) queda un aviso que no promete un mensaje.
        if (FcmWakePolicy.noticeAfterWake(started)) try { wakeNotice() } catch (e: Throwable) { nlog("Aviso de despertar: ${e.message}", "WARN") }
        else nlog("Despierto: sin aviso (lo pone el mensaje cuando llegue)")
    }

    private fun wakeNotice() {
        // MsgNotifier.get crea los canales si no existen (init): reutilizamos el canal de mensajes, no uno nuevo.
        val mn = MsgNotifier.get(this)
        val nm = NotificationManagerCompat.from(this)
        if (!nm.areNotificationsEnabled()) { nlog("Avisos desactivados: despertó sin aviso", "WARN"); return }
        // 2995: acción propia (llega siempre al plugin) + marca «despertar»: la app abre el chat si solo hay uno con mensajes sin leer
        val launch = MsgNotifier.notifLaunchIntent(this)?.putExtra(MsgNotifier.EXTRA_WAKE_TAP, "1")
        val pi = if (launch != null) PendingIntent.getActivity(
            this, WAKE_NOTIF_ID,
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        ) else null
        val b = NotificationCompat.Builder(this, MsgNotifier.CHANNEL_ID)
            .setSmallIcon(MsgNotifier.msgIcon(this))
            .setContentTitle("NEXO")
            .setContentText("Puede haber mensajes nuevos: abre NEXO")
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
        if (pi != null) b.setContentIntent(pi)
        try { nm.notify(WAKE_NOTIF_ID, b.build()) } catch (e: SecurityException) { nlog("Sin permiso de avisos", "WARN") }
        // Encender la pantalla unos segundos solo si el dueño lo pidió (Perfil → Avisos con la pantalla apagada).
        try { if (mn.wakeOnMsg()) mn.wakeScreen(5000) } catch (e: Throwable) { }
    }
}
