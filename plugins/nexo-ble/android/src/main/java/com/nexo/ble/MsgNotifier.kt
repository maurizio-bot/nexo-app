package com.nexo.ble

import android.app.NotificationChannel
import android.app.NotificationManager
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
