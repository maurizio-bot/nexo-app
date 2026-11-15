package com.nexo.ble

import android.content.Context
import java.io.File

/**
 * 3120 — Guarda las primeras líneas de un fallo de Java/Kotlin al caer (Android no lo guarda para la app: solo dice «fallo»).
 * Se instala una vez por proceso desde donde puede arrancar NEXO (pantalla, servicio en primer plano, aviso de FCM, plugin) y
 * después llama al manejador de siempre, así Android sigue registrando el cierre como hasta ahora. Sin contenido de mensajes:
 * solo el tipo de error, su texto recortado y dónde ocurrió. Lo lee el diagnóstico (getExitReasons).
 */
object CrashLog {
    @Volatile private var installed = false

    @JvmStatic
    fun install(ctx: Context?) {
        if (installed || ctx == null) return
        synchronized(this) {
            if (installed) return
            installed = true
            val app = ctx.applicationContext ?: ctx
            val prev = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { th, ex ->
                try {
                    val f = File(app.filesDir, ExitReasons.FILE)
                    val old = try { if (f.exists()) f.readText() else null } catch (e: Throwable) { null }
                    val txt = ExitReasons.appendCrash(old, ExitReasons.crashText(ex, th.name, System.currentTimeMillis()))
                    val tmp = File(app.filesDir, ExitReasons.FILE + ".tmp")
                    tmp.writeText(txt)
                    if (!tmp.renameTo(f)) { f.writeText(txt); tmp.delete() }
                } catch (e: Throwable) {}
                if (prev != null) prev.uncaughtException(th, ex)
            }
        }
    }
}
