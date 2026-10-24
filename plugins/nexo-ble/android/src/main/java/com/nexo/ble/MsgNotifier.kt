package com.nexo.ble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

// Notificaciones de mensajes: una por chat con el número de mensajes sin leer (el icono de la app muestra la suma
// en los lanzadores que lo admiten). Tocarla abre ese chat (extra nexo_chat_device_id). En la pantalla de bloqueo
// solo se ve "Mensaje nuevo"; sin texto (bloqueo de la app activado o contenido aún cifrado) dice "Mensaje nuevo".
class MsgNotifier(private val ctx: Context) {
    companion object {
        const val CHANNEL_ID = "nexo_messages"
        const val EXTRA_CHAT = "nexo_chat_device_id"
        // Ronda 2763: llamada entrante como una llamada del teléfono (tono, pantalla completa, Contestar / Rechazar)
        const val CALL_CHANNEL_ID = "nexo_calls"
        const val EXTRA_ANSWER = "nexo_call_answer"
        const val EXTRA_CALL_FROM = "nexo_call_from"
        private const val CALL_NOTIF_ID = 3999
        // Lo que el dueño tocó en el aviso; la app lo recoge al abrirse (NexoBlePlugin.callAction)
        @Volatile var pendingAnswer: Pair<String, Long>? = null
        @Volatile var pendingDecline: Pair<String, Long>? = null
        private const val GROUP = "nexo_msgs"
        private const val TAG = "NexoMsgNotifier"
        @Volatile private var shared: MsgNotifier? = null
        // Una sola instancia por proceso (la usan el plugin y la escucha de internet en segundo plano)
        fun get(ctx: Context): MsgNotifier = shared ?: synchronized(this) { shared ?: MsgNotifier(ctx.applicationContext).also { shared = it } }
    }

    val book = UnreadBook()

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Mensajes", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Mensajes nuevos de tus contactos"
            ch.setShowBadge(true)
            ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(ch)
            val cc = NotificationChannel(CALL_CHANNEL_ID, "Llamadas", NotificationManager.IMPORTANCE_HIGH)
            cc.description = "Llamadas y videollamadas entrantes"
            cc.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            cc.enableVibration(true); cc.vibrationPattern = longArrayOf(0, 900, 700, 900)
            cc.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(cc)
        }
    }

    private fun notifId(chatId: String) = 4000 + (chatId.hashCode() and 0x7ffff)

    fun message(chatId: String, name: String, msgId: String, text: String): Int {
        // Ronda 2760: si ya se avisó en otro chat (el nativo, con quien lo manda), pasa a este (el grupo)
        book.takeFromOthers(chatId, msgId).forEach { other ->
            if (book.get(other) == null) try { NotificationManagerCompat.from(ctx).cancel(notifId(other)) } catch (e: Exception) { }
            else post(other, alert = false)
        }
        if (!book.add(chatId, name, msgId, text)) return book.get(chatId)?.count ?: 0
        post(chatId.lowercase(), alert = true)
        return book.get(chatId)?.count ?: 0
    }

    // Llamada entrante: suena con el tono de llamada hasta contestar, rechazar o 45 s; a pantalla completa si el sistema
    // lo permite (si no, aviso grande arriba). Contestar abre NEXO y contesta; Rechazar quita el aviso y, al abrirse
    // NEXO, la llamada se rechaza.
    fun incomingCall(from: String, name: String, video: Boolean) {
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) { Log.w(TAG, "Notificaciones desactivadas: llamada sin aviso"); return }
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
        val fl = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        val pf = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val openPi = PendingIntent.getActivity(ctx, 3990, Intent(launch).putExtra(EXTRA_CALL_FROM, from).addFlags(fl), pf)
        val answerPi = PendingIntent.getActivity(ctx, 3991, Intent(launch).putExtra(EXTRA_ANSWER, from).addFlags(fl), pf)
        val declinePi = PendingIntent.getBroadcast(ctx, 3992, Intent(ctx, CallDeclineReceiver::class.java).putExtra(EXTRA_CALL_FROM, from), pf)
        val n = NotificationCompat.Builder(ctx, CALL_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle(name.ifBlank { "NEXO" })
            .setContentText(if (video) "Videollamada entrante · NEXO" else "Llamada entrante · NEXO")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(45000)
            .setContentIntent(openPi)
            .setFullScreenIntent(openPi, true)
            .addAction(0, "Rechazar", declinePi)
            .addAction(0, "Contestar", answerPi)
            .build()
        n.flags = n.flags or Notification.FLAG_INSISTENT // el tono se repite hasta que se atiende
        try { nm.notify(CALL_NOTIF_ID, n) } catch (e: SecurityException) { Log.w(TAG, "Sin permiso de notificaciones") }
    }

    fun cancelCall() { try { NotificationManagerCompat.from(ctx).cancel(CALL_NOTIF_ID) } catch (e: Exception) { } }

    fun clear(chatId: String) {
        book.clear(chatId)
        try { NotificationManagerCompat.from(ctx).cancel(notifId(chatId.lowercase())) } catch (e: Exception) { }
    }

    fun sync(counts: Map<String, Int>) {
        val (remove, update) = book.sync(counts)
        val nm = NotificationManagerCompat.from(ctx)
        remove.forEach { try { nm.cancel(notifId(it)) } catch (e: Exception) { } }
        update.forEach { post(it, alert = false) }
    }

    private fun post(chatId: String, alert: Boolean) {
        val c = book.get(chatId) ?: return
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) { Log.w(TAG, "Notificaciones desactivadas por el usuario"); return }
        val n = c.count
        val text = if (n > 1) "$n mensajes nuevos" else c.last.ifBlank { "Mensaje nuevo" }
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
        launch.putExtra(EXTRA_CHAT, chatId)
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(ctx, notifId(chatId), launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val pub = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("NEXO")
            .setContentText(if (n > 1) "$n mensajes nuevos" else "Mensaje nuevo")
            .build()
        val b = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(c.name.ifBlank { "NEXO" })
            .setContentText(text)
            .setNumber(n)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(pub)
            .setGroup(GROUP)
            .setAutoCancel(true)
            .setOnlyAlertOnce(!alert)
            .setContentIntent(pi)
        try { nm.notify(notifId(chatId), b.build()) } catch (e: SecurityException) { Log.w(TAG, "Sin permiso de notificaciones") }
    }
}

// "Rechazar" en el aviso de llamada (sin abrir la app): se quita el aviso y se apunta para rechazarla al abrir NEXO
class CallDeclineReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val from = intent.getStringExtra(MsgNotifier.EXTRA_CALL_FROM) ?: return
        MsgNotifier.pendingDecline = from.lowercase() to System.currentTimeMillis()
        MsgNotifier.get(ctx).cancelCall()
    }
}
