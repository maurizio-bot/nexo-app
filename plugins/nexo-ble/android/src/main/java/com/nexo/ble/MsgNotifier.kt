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
        // Ronda 2765: encender la pantalla con un mensaje nuevo (Perfil → Avisos con la pantalla apagada)
        const val PREFS = "nexo_prefs"
        const val PREF_WAKE = "wake_on_msg"
        const val PREF_RINGTONE = "call_ringtone" // URI del tono de llamada/videollamada elegido ("" = el del teléfono)
        // Ronda 2763: llamada entrante como una llamada del teléfono (tono, pantalla completa, Contestar / Rechazar)
        const val CALL_CHANNEL_ID = "nexo_calls"
        const val EXTRA_ANSWER = "nexo_call_answer"
        const val EXTRA_CALL_FROM = "nexo_call_from"
        const val EXTRA_CALL_OFFER = "nexo_call_offer"
        // Auditoría (ronda 2774): la pantalla principal está exportada (es el lanzador). Sin esto, otra app del teléfono
        // podía abrirla con el extra "contestar" y descolgar sola una llamada que estuviera sonando (micrófono/cámara
        // abiertos sin tocar nada). Este testigo va solo dentro de nuestros PendingIntent (otras apps no pueden leerlo);
        // al abrir por el aviso se comprueba que coincide antes de hacer caso a "contestar"/"abrir llamada".
        const val EXTRA_CALL_TOKEN = "nexo_call_token"
        @JvmStatic val callIntentToken: String = java.util.UUID.randomUUID().toString()
        private const val CALL_NOTIF_ID = 3999
        // Lo que el dueño tocó en el aviso; la app lo recoge al abrirse (NexoBlePlugin.callAction). Ronda 2768: con la
        // oferta a la que se refiere (si no, valía para la siguiente llamada de ese contacto y se contestaba sola)
        @Volatile var pendingAnswer: CallTap? = null
        @Volatile var pendingDecline: CallTap? = null
        private const val GROUP = "nexo_msgs"
        private const val TAG = "NexoMsgNotifier"
        @Volatile private var shared: MsgNotifier? = null
        // Una sola instancia por proceso (la usan el plugin y la escucha de internet en segundo plano)
        fun get(ctx: Context): MsgNotifier = shared ?: synchronized(this) { shared ?: MsgNotifier(ctx.applicationContext).also { shared = it } }
    }

    val book = UnreadBook()
    private val calls = CallDedupe()

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Mensajes", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Mensajes nuevos de tus contactos"
            ch.setShowBadge(true)
            ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(ch)
            createCallChannel(ctx)
        }
    }

    // Canal de llamadas y videollamadas (mismo canal para las dos: el tono vale para ambas). El tono es el que el dueño
    // haya elegido (Perfil) o, por defecto, el tono de llamada actual del teléfono. Android fija el sonido al CREAR el
    // canal y no deja cambiarlo luego, así que para cambiar el tono se borra y se vuelve a crear (setCallRingtone).
    private fun createCallChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val cc = NotificationChannel(CALL_CHANNEL_ID, "Llamadas", NotificationManager.IMPORTANCE_HIGH)
        cc.description = "Llamadas y videollamadas entrantes"
        cc.setSound(callRingtoneUri(ctx),
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        cc.enableVibration(true); cc.vibrationPattern = longArrayOf(0, 900, 700, 900)
        cc.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(cc)
    }

    // Tono guardado (Perfil) o, si no hay, el de llamada actual del teléfono
    fun callRingtoneUri(ctx: Context): android.net.Uri {
        val saved = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_RINGTONE, null)
        if (!saved.isNullOrEmpty()) { try { return android.net.Uri.parse(saved) } catch (e: Exception) {} }
        return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
    }
    // Nombre del tono actual (para enseñarlo en Perfil)
    fun callRingtoneTitle(ctx: Context): String = try {
        RingtoneManager.getRingtone(ctx, callRingtoneUri(ctx))?.getTitle(ctx) ?: "Tono del teléfono"
    } catch (e: Exception) { "Tono del teléfono" }
    // El dueño eligió un tono (uri null/"" = volver al del teléfono): se guarda y se recrea el canal para que valga ya
    fun setCallRingtone(ctx: Context, uri: String?) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_RINGTONE, uri ?: "").apply()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try { ctx.getSystemService(NotificationManager::class.java)?.deleteNotificationChannel(CALL_CHANNEL_ID) } catch (e: Exception) {}
            createCallChannel(ctx)
        }
    }

    private fun notifId(chatId: String) = 4000 + (chatId.hashCode() and 0x7ffff)

    fun message(chatId: String, name: String, msgId: String, text: String): Int {
        // Ronda 2760: si ya se avisó en otro chat (el nativo, con quien lo manda), pasa a este (el grupo)
        book.takeFromOthers(chatId, msgId).forEach { other ->
            if (book.get(other) == null) try { NotificationManagerCompat.from(ctx).cancel(notifId(other)) } catch (e: Exception) { }
            else post(other, alert = false)
        }
        if (!book.add(chatId, name, msgId, text)) {
            if (book.refreshText(chatId, msgId, text)) post(chatId.lowercase(), alert = false)
            return book.get(chatId)?.count ?: 0
        }
        post(chatId.lowercase(), alert = true)
        return book.get(chatId)?.count ?: 0
    }

    // Llamada entrante: suena con el tono de llamada hasta contestar, rechazar o 45 s; a pantalla completa si el sistema
    // lo permite (si no, aviso grande arriba). Contestar abre NEXO y contesta; Rechazar quita el aviso y, al abrirse
    // NEXO, la llamada se rechaza. Ronda 2768: offerId = id del mensaje de la oferta; un aviso por oferta (CallDedupe).
    fun incomingCall(from: String, name: String, video: Boolean, offerId: String = "") {
        if (!calls.first(from, offerId)) { Log.i(TAG, "Oferta de llamada ya avisada: sin aviso nuevo"); return }
        val nm = NotificationManagerCompat.from(ctx)
        if (!nm.areNotificationsEnabled()) { Log.w(TAG, "Notificaciones desactivadas: llamada sin aviso"); return }
        val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
        val fl = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        val pf = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val openPi = PendingIntent.getActivity(ctx, 3990, Intent(launch).putExtra(EXTRA_CALL_FROM, from).putExtra(EXTRA_CALL_OFFER, offerId).putExtra(EXTRA_CALL_TOKEN, callIntentToken).addFlags(fl), pf)
        val answerPi = PendingIntent.getActivity(ctx, 3991, Intent(launch).putExtra(EXTRA_ANSWER, from).putExtra(EXTRA_CALL_OFFER, offerId).putExtra(EXTRA_CALL_TOKEN, callIntentToken).addFlags(fl), pf)
        val declinePi = PendingIntent.getBroadcast(ctx, 3992, Intent(ctx, CallDeclineReceiver::class.java).putExtra(EXTRA_CALL_FROM, from).putExtra(EXTRA_CALL_OFFER, offerId), pf)
        // Ronda 2785 (#1 del dueño: "solo aparece la notificación, no la pantalla completa con Contestar/Rechazar"):
        // estilo de LLAMADA (CallStyle). Antes era un aviso normal con dos botones; el sistema (sobre todo Samsung One UI
        // y Android 14) no lo trataba como llamada y lo bajaba a aviso pequeño. CallStyle.forIncomingCall lo pinta como la
        // pantalla de llamada real (Contestar/Rechazar grandes) y, con la pantalla bloqueada y el permiso de pantalla
        // completa concedido (Perfil → Avisos lo pide, #81), sale a pantalla completa. androidx.core 1.12 lo admite.
        // Si por lo que sea CallStyle fallara en algún teléfono, se cae a un aviso de llamada normal con los dos botones
        // (no se pierde la llamada ni se cierra el hilo de fondo).
        val n: Notification = try {
            val person = androidx.core.app.Person.Builder().setName(name.ifBlank { "NEXO" }).setImportant(true).build()
            NotificationCompat.Builder(ctx, CALL_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setContentText(if (video) "Videollamada entrante · NEXO" else "Llamada entrante · NEXO")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setTimeoutAfter(45000)
                .setContentIntent(openPi)
                .setFullScreenIntent(openPi, true)
                .setStyle(NotificationCompat.CallStyle.forIncomingCall(person, declinePi, answerPi))
                .build()
        } catch (e: Throwable) {
            Log.w(TAG, "CallStyle no disponible, aviso de llamada normal: ${e.message}")
            NotificationCompat.Builder(ctx, CALL_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setContentTitle(name.ifBlank { "NEXO" })
                .setContentText(if (video) "Videollamada entrante · NEXO" else "Llamada entrante · NEXO")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setTimeoutAfter(45000)
                .setContentIntent(openPi)
                .setFullScreenIntent(openPi, true)
                .addAction(0, "Rechazar", declinePi)
                .addAction(0, "Contestar", answerPi)
                .build()
        }
        n.flags = n.flags or Notification.FLAG_INSISTENT // el tono se repite hasta que se atiende
        try { nm.notify(CALL_NOTIF_ID, n) } catch (e: SecurityException) { Log.w(TAG, "Sin permiso de notificaciones") }
        wakeScreen(20000) // por si el sistema no deja la pantalla completa (Android 14: permiso aparte)
    }

    fun cancelCall() { try { NotificationManagerCompat.from(ctx).cancel(CALL_NOTIF_ID) } catch (e: Exception) { } }

    // Ronda 2765 (pedido del dueño: con la pantalla apagada, que llegue y se encienda): Android no enciende la pantalla
    // por un aviso; se enciende unos segundos (un mensaje: si no se quitó en Perfil; una llamada: siempre)
    // Ronda 2789 (informe del dueño: "al llegar un mensaje se prende toda la pantalla; solo debería aparecer la
    // notificación"). Por defecto AHORA es NO encender la pantalla con un mensaje: solo se postea la notificación y la
    // muestra el sistema (pantalla ambiente/bloqueo) sin forzar el brillo. Quien quiera que se encienda, lo activa en
    // Perfil (setWakeOnMessage). Las LLAMADAS siguen encendiendo la pantalla siempre (es otro camino, incomingCall).
    fun wakeOnMsg(): Boolean = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(PREF_WAKE, false)
    fun setWakeOnMsg(on: Boolean) { ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(PREF_WAKE, on).apply() }
    fun wakeScreen(ms: Long) {
        try {
            val pm = ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            if (pm.isInteractive) return
            @Suppress("DEPRECATION")
            val wl = pm.newWakeLock(android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK or android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP or
                android.os.PowerManager.ON_AFTER_RELEASE, "nexo:aviso")
            wl.acquire(ms)
            Log.i(TAG, "Pantalla encendida por un aviso")
        } catch (e: Exception) { Log.w(TAG, "No se pudo encender la pantalla: ${e.message}") }
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
        try { nm.notify(notifId(chatId), b.build()) } catch (e: SecurityException) { Log.w(TAG, "Sin permiso de notificaciones"); return }
        if (alert && wakeOnMsg()) wakeScreen(5000)
    }
}

// Lo tocado en el aviso de llamada: de quién, cuándo y de qué oferta (vacío: build anterior de la app)
class CallTap(val from: String, val at: Long, val offer: String)

// "Rechazar" en el aviso de llamada (sin abrir la app): se quita el aviso y se apunta para rechazarla al abrir NEXO.
// Ronda 2768: si la app sigue viva en segundo plano, se le dice ya (rechaza cifrado y el que llama lo ve al momento).
class CallDeclineReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val from = intent.getStringExtra(MsgNotifier.EXTRA_CALL_FROM) ?: return
        val tap = CallTap(from.lowercase(), System.currentTimeMillis(), intent.getStringExtra(MsgNotifier.EXTRA_CALL_OFFER) ?: "")
        MsgNotifier.pendingDecline = tap
        MsgNotifier.get(ctx).cancelCall()
        NexoBlePlugin.declinedFromNotification(tap)
    }
}
