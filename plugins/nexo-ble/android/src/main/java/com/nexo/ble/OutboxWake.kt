package com.nexo.ble

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log

/**
 * 3280 (remate de la FASE 3; faltaba desde la 3271): el DESPERTADOR de la bandeja de salida por Bluetooth.
 *
 * El nativo busca a quien tiene algo pendiente con escaneos cortos cada cierto tiempo (OutboxDial). Pero con la pantalla apagada el
 * teléfono se duerme del todo a los pocos segundos y esos repasos no corren (solo cuando otra cosa lo despierta): dos teléfonos
 * dormidos en el bolsillo, sin internet, podían tardar muchísimo en encontrarse. Ahora, mientras haya algo que NO tiene otro camino
 * (ningún relé lo aceptó), se pone una alarma para el próximo escaneo: despierta el teléfono unos segundos, busca, conecta y escribe.
 *
 * Es inexacta (setAndAllowWhileIdle, sin permiso de alarmas exactas): Android la junta con otros despertares y en reposo profundo la
 * espacia a su ritmo (~9 min). Va al mismo receptor que la alarma de vigilancia (no exportado). Sin nada urgente no hay alarma: lo
 * que ya está a salvo en el buzón de internet se repasa con la de vigilancia (cada ~15 min), que ya existía.
 */
internal object OutboxWake {
    const val ACTION = "com.nexo.ble.action.BANDEJA"
    private const val TAG = "NEXO_BANDEJA"
    private const val REQ = 4701
    private const val KICK_MS = 2_000L   // despierto lo justo para que corra el repaso (que decide si toca buscar)
    private const val AWAKE_MS = 12_000L // si toca: escaneo (4 s) + conectar + escribir + su ✓✓
    @Volatile private var armedFor = 0L

    private fun intent(ctx: Context, flags: Int): PendingIntent? {
        val i = Intent(ctx, NexoRestartReceiver::class.java).setAction(ACTION)
        return PendingIntent.getBroadcast(ctx, REQ, i, flags or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Pone (o mueve) la alarma para dentro de inMs; inMs < 0 la quita. Si ya hay una para casi el mismo momento, no se toca. */
    fun set(ctx: Context, inMs: Long) {
        if (inMs < 0) { cancel(ctx); return }
        val at = SystemClock.elapsedRealtime() + inMs
        val cur = armedFor
        if (cur > SystemClock.elapsedRealtime() && Math.abs(cur - at) < 5_000L) return
        try {
            val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val pi = intent(ctx, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
            armedFor = at
        } catch (e: Throwable) { Log.w(TAG, "no se pudo poner el despertador: ${e.message}") }
    }

    fun cancel(ctx: Context) {
        if (armedFor == 0L) return
        armedFor = 0L
        try {
            val pi = intent(ctx, PendingIntent.FLAG_NO_CREATE) ?: return
            (ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager)?.cancel(pi)
            pi.cancel()
        } catch (e: Throwable) { }
    }

    private fun awake(ctx: Context, ms: Long) {
        try {
            (ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nexo:bandeja")
                ?.apply { setReferenceCounted(false) }?.acquire(ms)
        } catch (e: Throwable) { }
    }
    /** Empieza un escaneo o una conexión para la bandeja: el teléfono despierto lo que dura (si no, se dormiría a medias). */
    fun busy(ctx: Context) = awake(ctx, AWAKE_MS)

    /**
     * Sonó el despertador (o la alarma de vigilancia con NEXO viva): si queda algo en la bandeja, el teléfono despierto unos segundos y
     * un repaso YA de quien lleve el Bluetooth (la app dormida o cerrada, o el servicio sin la app). Devuelve si había algo.
     */
    fun fired(ctx: Context): Boolean {
        armedFor = 0L
        val pending = try { (NetBgHome.peek()?.outbox?.size() ?: 0) > 0 } catch (e: Throwable) { false }
        if (!pending) return false
        awake(ctx, KICK_MS)
        Handler(Looper.getMainLooper()).post {
            try {
                val p = NexoBlePlugin.live ?: NexoBlePlugin.orphan
                if (p != null) p.outboxKick() else BleSinApp.current?.outboxKick()
            } catch (e: Throwable) { Log.w(TAG, "repaso sin hacer: ${e.javaClass.simpleName}") }
        }
        return true
    }
}
