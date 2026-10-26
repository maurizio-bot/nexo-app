package com.nexo.ble

import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Registro nativo persistente (ronda 2785, #87). La parte nativa (NetBg por internet, Bluetooth con la app cerrada,
 * ciclo de vida, energía, WifiLock) deja constancia EN DISCO de lo que hace mientras la app está cerrada o en segundo
 * plano, cuando el WebView —y su registro de diagnóstico (diag.js)— ya no existe. Hasta ahora remLog solo iba a logcat
 * y, con la app abierta, cruzaba al WebView por el puente; con la app cerrada no había a quién avisar, así que el
 * diagnóstico del dueño no mostraba NADA del periodo cerrado y no se podía saber si NetBg siguió escuchando. Ahora sí.
 *
 * Al abrir la app, Perfil → Copiar diagnóstico lo incluye (NexoBlePlugin.readNativeLog + diag.js).
 *
 * Anillo por tamaño: se queda con las últimas líneas (tope de bytes) para no crecer sin fin. SOLO metadatos (igual que
 * remLog: nunca el contenido de un mensaje); el NEXO ID y el msgId que pueda aparecer ya salen en el diagnóstico que el
 * dueño copia. En el almacenamiento privado de la app (filesDir). Sin dependencias de Android: se prueba en JVM
 * (NativeLogTest).
 */
class NativeLog(private val file: File, private val maxBytes: Long = 48_000) {
    private val lock = Any()
    private val fmt = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US)

    fun add(level: String, tag: String, message: String, now: Long = System.currentTimeMillis()) {
        synchronized(lock) {
            try {
                val line = fmt.format(Date(now)) + " [" + level + "][" + tag + "] " + message.replace('\n', ' ').replace('\r', ' ')
                file.appendText(line + "\n")
                if (file.length() > maxBytes) trim()
            } catch (e: Exception) { }
        }
    }

    // Deja ~75% del tope (las líneas más recientes); si una sola línea pasara del tope, se recorta.
    private fun trim() {
        try {
            val target = maxBytes * 3 / 4
            val lines = file.readLines()
            val keep = ArrayDeque<String>()
            var bytes = 0L
            for (i in lines.indices.reversed()) {
                val l = lines[i]
                bytes += l.length + 1
                if (bytes > target && keep.isNotEmpty()) break
                keep.addFirst(l)
            }
            file.writeText(keep.joinToString("\n", postfix = "\n"))
        } catch (e: Exception) {
            try { file.delete() } catch (e2: Exception) { }
        }
    }

    fun read(): String = synchronized(lock) { try { if (file.exists()) file.readText() else "" } catch (e: Exception) { "" } }

    fun clear() { synchronized(lock) { try { file.delete() } catch (e: Exception) { } } }
}
