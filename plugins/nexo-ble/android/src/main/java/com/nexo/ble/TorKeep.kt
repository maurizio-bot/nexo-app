package com.nexo.ble

import android.content.Context
import android.content.Intent

/**
 * 3324 (cierres nativos del S24 23-11 18:24, 21:26 y 24-11 06:01, SIGABRT; el volcado de la 3142 lo dijo: hilo «tor», «FORTIFY:
 * pthread_mutex_lock called on a destroyed mutex» en tor_cond_wait). Tor (tor-android) NO se puede apagar dentro del proceso: al soltar la
 * última conexión con TorService, Android lo destruye, tor libera sus cerrojos y uno de sus hilos sigue esperando en uno → el proceso
 * entero cae. Pasaba sobre todo con la vista previa de enlaces (desde la 3125: suelta su Tor a los 5 min sin uso, con la app detrás) y al
 * apagar «Usar Tor». Ahora hay UNA sola conexión con TorService que dura lo que el proceso: nunca se suelta. Cuando nadie lo usa, Tor se
 * DUERME (señal DORMANT: sin circuitos ni tráfico, casi sin batería) y se despierta (ACTIVE) al volver a necesitarlo.
 */
object TorKeep {
    @Volatile var svc: org.torproject.jni.TorService? = null
        private set
    @Volatile private var conn: android.content.ServiceConnection? = null
    private val lock = Any()
    @Volatile private var asleep = false

    /** El servicio de Tor (lo arranca y se queda enlazado para siempre). null si no llegó a conectar en 60 s. */
    fun bind(ctx: Context): org.torproject.jni.TorService? {
        svc?.let { return it }
        synchronized(lock) {
            svc?.let { return it }
            if (conn == null) {
                val latch = java.util.concurrent.CountDownLatch(1)
                val c = object : android.content.ServiceConnection {
                    override fun onServiceConnected(name: android.content.ComponentName?, binder: android.os.IBinder?) {
                        svc = (binder as? org.torproject.jni.TorService.LocalBinder)?.service; latch.countDown()
                    }
                    override fun onServiceDisconnected(name: android.content.ComponentName?) { svc = null; TorRoute.proxy = null }
                }
                conn = c
                val app = ctx.applicationContext ?: ctx
                android.os.Handler(android.os.Looper.getMainLooper()).post { app.bindService(Intent(app, org.torproject.jni.TorService::class.java), c, Context.BIND_AUTO_CREATE) }
                latch.await(60, java.util.concurrent.TimeUnit.SECONDS)
            } else {
                // ya se pidió (otra llamada lo está esperando, o Android lo reinicia): se espera a que aparezca
                val t0 = System.currentTimeMillis()
                while (svc == null && System.currentTimeMillis() - t0 < 60_000L) Thread.sleep(200)
            }
            return svc
        }
    }

    /** Despierta a Tor (si estaba dormido) antes de usarlo. */
    fun active() {
        val s = svc ?: return
        if (!asleep) return
        try { s.torControlConnection?.signal("ACTIVE"); asleep = false } catch (e: Exception) { }
    }

    /** Nadie lo usa: a dormir (nunca se apaga: apagarlo tumba el proceso). */
    fun dormant(): Boolean {
        val s = svc ?: return false
        if (asleep) return true
        return try { s.torControlConnection?.signal("DORMANT"); asleep = true; true } catch (e: Exception) { false }
    }
}
