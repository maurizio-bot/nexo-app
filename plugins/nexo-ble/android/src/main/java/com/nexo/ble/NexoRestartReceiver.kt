package com.nexo.ble

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import java.io.File

/**
 * 3189 (diagnósticos tableta SM-T220 y S24 17-11 04:46, #87): «NEXO vuelve sola» tras una actualización de NEXO sin abrirla
 * (MY_PACKAGE_REPLACED), un reinicio (BOOT_COMPLETED) o si el sistema la mata (alarma de vigilancia cada ~15 min: p. ej. al
 * actualizarse Android System WebView). Lo que se decide está en RestartPolicy (probado en JVM).
 *
 * Vuelve por el MISMO camino que el toque FCM (NexoFcmService.onMessageReceived): arrancar BleService en primer plano. Con la
 * exención de la optimización de batería (la que NEXO pide al usuario), con BOOT_COMPLETED y con MY_PACKAGE_REPLACED Android 12+
 * deja arrancarlo desde segundo plano; sin ella, la alarma no puede y queda anotado en el registro nativo.
 *
 * Registro nativo (el del diagnóstico): «NEXO vuelve sola tras <motivo>» o «No se pudo volver sola tras <motivo>: <error>» (lo
 * escribe noteOutcome: aquí si Android no deja arrancar el servicio, y BleService si arrancó pero no pudo ponerse en primer plano).
 * La alarma que encuentra NEXO viva (el servicio, o la app que lo maneja) solo se reprograma y no escribe nada.
 */
class NexoRestartReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "NexoRestart"
        private const val PREFS = "nexo_restart"
        private const val KEY_FAILS = "fails"   // fallos seguidos (para no llenar el registro)
        private const val REQ_WATCHDOG = 4700

        private fun configured(ctx: Context): Boolean {
            val f = File(ctx.filesDir, RestartPolicy.NEXO_ID_FILE)
            return RestartPolicy.configured(f.exists(), f.length())
        }

        private fun watchdogIntent(ctx: Context, flags: Int): PendingIntent? {
            val i = Intent(ctx, NexoRestartReceiver::class.java).setAction(RestartPolicy.ACTION_WATCHDOG)
            return PendingIntent.getBroadcast(ctx, REQ_WATCHDOG, i, flags or PendingIntent.FLAG_IMMUTABLE)
        }

        // La próxima alarma de vigilancia (reemplaza la anterior: mismo PendingIntent). Inexacta y que despierta: ver RestartPolicy.
        private fun schedule(ctx: Context) {
            try {
                val am = ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
                val pi = watchdogIntent(ctx, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, RestartPolicy.nextAt(SystemClock.elapsedRealtime()), pi)
            } catch (e: Throwable) { Log.w(TAG, "No se pudo programar la alarma de vigilancia: ${e.message}") }
        }

        private fun cancel(ctx: Context) {
            try {
                val pi = watchdogIntent(ctx, PendingIntent.FLAG_NO_CREATE) ?: return
                (ctx.getSystemService(Context.ALARM_SERVICE) as? AlarmManager)?.cancel(pi)
                pi.cancel()
            } catch (e: Throwable) { Log.w(TAG, "No se pudo cancelar la alarma de vigilancia: ${e.message}") }
        }

        // Lo llama BleService al arrancar: con NEXO configurada programa la alarma de vigilancia (true); sin cuenta, la cancela.
        fun arm(ctx: Context): Boolean {
            if (!configured(ctx)) { cancel(ctx); return false }
            schedule(ctx)
            return true
        }

        // Resultado de una vuelta: al registro nativo (el MISMO archivo que lee el diagnóstico, compartido con el plugin como en
        // NexoConnection). Una vuelta buena se anota siempre (es una vuelta de verdad) y pone a cero la racha de fallos; un fallo
        // seguido (p. ej. sin la exención de batería, cada 15 min) solo el 1.º, 2.º, 4.º, 8.º… (NetBg.logFailedTry).
        fun noteOutcome(ctx: Context, reason: RestartPolicy.Reason, error: String?) {
            try {
                val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                if (error == null) {
                    prefs.edit().putInt(KEY_FAILS, 0).apply()
                    nlog(ctx, "INFO", "NEXO vuelve sola tras ${reason.why}")
                } else {
                    val n = prefs.getInt(KEY_FAILS, 0) + 1
                    prefs.edit().putInt(KEY_FAILS, n).apply()
                    if (NetBg.logFailedTry(n)) nlog(ctx, "WARN", "No se pudo volver sola tras ${reason.why}: $error" + if (n > 1) " ($n fallos seguidos)" else "")
                }
            } catch (e: Throwable) { }
        }

        private fun nlog(ctx: Context, level: String, msg: String) {
            Log.i(TAG, msg)
            try {
                val l = NexoBlePlugin.nativeLogShared ?: synchronized(NexoBlePlugin::class.java) {
                    NexoBlePlugin.nativeLogShared ?: NativeLog(File(ctx.filesDir, NexoBlePlugin.NATIVE_LOG_FILE)).also { NexoBlePlugin.nativeLogShared = it }
                }
                l.add(level, "VUELVE", msg)
            } catch (e: Throwable) { }
        }
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val reason = RestartPolicy.reasonOf(intent?.action) ?: return
        val ctx = context.applicationContext ?: context
        CrashLog.install(ctx) // como el toque FCM: el proceso puede nacer aquí, sin pantalla ni servicio
        val alive = BleService.live != null || NexoBlePlugin.live != null || NexoBlePlugin.orphan != null
        when (RestartPolicy.step(configured(ctx), alive)) {
            RestartPolicy.Step.STOP -> cancel(ctx)
            RestartPolicy.Step.REARM -> schedule(ctx)
            RestartPolicy.Step.START -> { schedule(ctx); start(ctx, reason) }
        }
    }

    // Igual que el toque FCM: startForegroundService(BleService), con el motivo para que solo pida «dispositivo conectado».
    private fun start(ctx: Context, reason: RestartPolicy.Reason) {
        try {
            val svc = Intent(ctx, BleService::class.java).putExtra(RestartPolicy.EXTRA_REASON, reason.name)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(svc) else ctx.startService(svc)
        } catch (e: Throwable) {
            // Android 12+ sin exención: ForegroundServiceStartNotAllowedException
            noteOutcome(ctx, reason, "${e.javaClass.simpleName}: ${e.message}")
            return
        }
        // El teléfono despierto unos segundos (solo al arrancar, no al reprogramar): el servicio corre DESPUÉS de onReceive (en este
        // mismo hilo) y, con la pantalla apagada, el teléfono podría volver a dormir antes. Se suelta solo a los 10 s.
        try {
            (ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager)?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "nexo:vuelve")
                ?.apply { setReferenceCounted(false) }?.acquire(10_000L)
        } catch (e: Throwable) { }
    }
}
