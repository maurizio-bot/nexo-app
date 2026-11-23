package com.nexo.ble

import android.content.Context
import android.content.Intent

// N-D (auditoría 23-11): la pantalla principal está exportada (es el lanzador), así que otra app del teléfono puede abrirla con
// los extras de «abrir el chat X» (nexo_chat_device_id) o «despertar» (nexo_wake_tap). Solo se les hace caso si el intent trae
// este testigo, que va DENTRO de nuestros PendingIntent (MsgNotifier.notifLaunchIntent: todos los avisos lo usan) y otras apps
// no pueden leer. A diferencia del testigo de llamada (MsgNotifier.callIntentToken, nuevo en cada proceso: una llamada vive
// poco), este se GUARDA en las preferencias privadas: un aviso de mensaje sobrevive a que Android cierre la app, y al tocarlo
// después (otro proceso) tiene que seguir abriendo su chat.
object TapToken {
    const val EXTRA = "nexo_tap_token"
    private const val PREFS = "nexo_prefs"
    private const val KEY = "tap_token"
    @Volatile private var cached: String? = null

    @JvmStatic fun get(ctx: Context): String {
        cached?.let { return it }
        synchronized(this) {
            cached?.let { return it }
            val p = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            var t = p.getString(KEY, null)
            if (t == null || t.length < 32) {
                t = java.util.UUID.randomUUID().toString() + java.util.UUID.randomUUID().toString()
                p.edit().putString(KEY, t).commit()
            }
            cached = t
            return t
        }
    }

    /** Olvida el testigo en memoria (p. ej. tras borrar las preferencias al pasar la cuenta): el siguiente get crea uno nuevo. */
    @JvmStatic fun forget() { cached = null }

    @JvmStatic fun ok(ctx: Context, intent: Intent?): Boolean = same(intent?.getStringExtra(EXTRA), get(ctx))

    /** Comparación en tiempo constante (sin JVM-Android: se prueba en tests/kotlin). */
    @JvmStatic fun same(a: String?, b: String?): Boolean {
        if (a == null || b == null || a.isEmpty() || a.length != b.length) return false
        var d = 0
        for (i in a.indices) d = d or (a[i].code xor b[i].code)
        return d == 0
    }
}
