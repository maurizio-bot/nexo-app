package com.nexo.ble

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 3120 — Cierres de la app en el diagnóstico (pendiente desde el 11-11, la «build forense» del bucle del APK de 25 MB; el dueño vio el
 * 15-11 en su S24 «NEXO se bloqueó más de 10 veces en la última semana» y no había forma de saber el motivo de cada cierre).
 * Android guarda desde la versión 11 los últimos cierres del proceso con su motivo (ActivityManager.getHistoricalProcessExitReasons);
 * para un fallo de Java/Kotlin no guarda el error, así que CrashLog lo escribe al caer (las primeras líneas, en un archivo propio).
 * Aquí, la parte que no depende de Android (se prueba en JVM: tests/kotlin ExitReasonsTest): textos de cada motivo, cuáles son un
 * problema, el hilo principal de un ANR y el texto de un fallo.
 */
object ExitReasons {
    // Valores de ApplicationExitInfo.REASON_* (fijos en Android: 0–13 desde la 11, 14 desde la 13, 15–16 desde la 14)
    const val CRASH = 4
    const val CRASH_NATIVE = 5
    const val ANR = 6
    const val LOW_MEMORY = 3
    const val INITIALIZATION_FAILURE = 7
    const val EXCESSIVE_RESOURCE_USAGE = 9
    const val FILE = "nexo_last_crash.txt"   // en filesDir: los últimos fallos guardados por CrashLog
    const val MAX_FILE_CHARS = 8000

    fun label(reason: Int): String = when (reason) {
        0 -> "motivo desconocido"
        1 -> "la app terminó sola"
        2 -> "terminada por el sistema"
        3 -> "sin memoria: Android la cerró"
        4 -> "FALLO (error en la app)"
        5 -> "FALLO nativo"
        6 -> "CONGELADA (no respondía)"
        7 -> "FALLO al arrancar"
        8 -> "cambio de permisos"
        9 -> "uso excesivo de recursos"
        10 -> "cerrada por el usuario (forzar cierre o recientes)"
        11 -> "detenida por el usuario"
        12 -> "murió algo de lo que dependía"
        13 -> "otro motivo del sistema"
        14 -> "congelada por el sistema"
        15 -> "cambio de estado de la app"
        16 -> "actualización de la app"
        else -> "motivo $reason"
    }

    /** Los que hay que mirar: fallos, congelamientos y falta de memoria (el resto es normal: actualizar, cerrar, el sistema). */
    fun isProblem(reason: Int): Boolean =
        reason == CRASH || reason == CRASH_NATIVE || reason == ANR || reason == LOW_MEMORY ||
        reason == INITIALIZATION_FAILURE || reason == EXCESSIVE_RESOURCE_USAGE

    fun clip(s: String?, max: Int): String {
        val t = (s ?: "").replace('\n', ' ').trim()
        return if (t.length <= max) t else t.substring(0, max) + "…"
    }

    /**
     * 3232 (S23 17-11 22:48: «FALLO nativo» al terminar una videollamada, sin más datos): de la «lápida» de un fallo NATIVO
     * (desde Android 12 es binaria) se sacan los textos legibles que dicen qué pasó: el mensaje de aborto, la señal y las
     * librerías .so que aparecen (las primeras de la pila). Sin repetir y como mucho [max] pistas.
     */
    fun nativeHints(bytes: ByteArray, max: Int = 8): String {
        val runs = ArrayList<String>()
        val sb = StringBuilder()
        fun flush() { if (sb.length >= 6) runs.add(sb.toString()); sb.setLength(0) }
        for (b in bytes) { val c = b.toInt() and 0xff; if (c in 32..126) sb.append(c.toChar()) else flush() }
        flush()
        val out = LinkedHashSet<String>()
        val keys = Regex("(?i)abort|SIG[A-Z]{3,5}|fatal|\\.so\\b|assert|check failed")
        for (r in runs) {
            if (!keys.containsMatchIn(r)) continue
            val t = clip(r, 160)
            if (t.endsWith(".so") || t.contains(".so ")) out.add(t.substringAfterLast('/')) else out.add(t)
            if (out.size >= max) break
        }
        return out.joinToString("\n")
    }

    /** Del volcado de un ANR (todos los hilos), solo el hilo principal: la cabecera «"main"» y hasta [maxLines] líneas. */
    fun anrMain(trace: String, maxLines: Int = 25): String {
        val lines = trace.lines()
        val i = lines.indexOfFirst { it.startsWith("\"main\"") }
        if (i < 0) return lines.take(maxLines).joinToString("\n")
        val out = ArrayList<String>()
        for (j in i until lines.size) {
            if (j > i && lines[j].isBlank()) break
            out.add(lines[j])
            if (out.size >= maxLines) break
        }
        return out.joinToString("\n")
    }

    private fun stamp(now: Long): String = SimpleDateFormat("dd-MM HH:mm:ss", Locale.US).format(Date(now))

    /** Texto de un fallo: hora, hilo, error (recortado), hasta [maxFrames] líneas «at …» y hasta 2 causas con 4 líneas. */
    fun crashText(t: Throwable, thread: String, now: Long, maxFrames: Int = 12): String {
        val sb = StringBuilder()
        sb.append(stamp(now)).append(" hilo ").append(clip(thread, 40)).append(": ")
            .append(t.javaClass.name).append(": ").append(clip(t.message, 300)).append('\n')
        t.stackTrace.take(maxFrames).forEach { sb.append("    at ").append(it.toString()).append('\n') }
        var c = t.cause; var n = 0
        while (c != null && c !== t && n < 2) {
            sb.append("  Causa: ").append(c.javaClass.name).append(": ").append(clip(c.message, 200)).append('\n')
            c.stackTrace.take(4).forEach { sb.append("    at ").append(it.toString()).append('\n') }
            c = c.cause; n++
        }
        return sb.toString()
    }

    /** Añade un fallo nuevo al principio y recorta a [max] caracteres (se quedan los más recientes enteros). */
    fun appendCrash(existing: String?, entry: String, max: Int = MAX_FILE_CHARS): String {
        val all = entry + "\n" + (existing ?: "")
        if (all.length <= max) return all
        val cut = all.lastIndexOf("\n\n", max)
        return if (cut > entry.length) all.substring(0, cut + 1) else all.substring(0, max)
    }
}
