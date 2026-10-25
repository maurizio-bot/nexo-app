package com.nexo.ble

// Auditoría (ronda 2774): antes de analizar un JSON que llega de fuera (Bluetooth, Wi-Fi, relés de internet) se mira
// que no sea descomunal ni esté demasiado anidado. El analizador de JSON de Android (org.json del sistema) es
// recursivo y no tiene tope de profundidad: un paquete con miles de "[[[[…" provoca un StackOverflowError, que NO es
// una Exception y se escapa de los try/catch normales → el sistema mata la app (DoS a distancia con un solo paquete).
// Este cribado es O(n), sin recursión y sin dependencias de Android (se prueba en JVM, SafeJsonTest).
object SafeJson {
    const val MAX_LEN = 16 * 1024 * 1024 // ningún control/aviso legítimo se acerca a esto
    const val MAX_DEPTH = 48             // el JSON de NEXO anida como mucho ~6 niveles; 48 es muchísimo margen

    // true = hay que rechazarlo antes de analizarlo (demasiado grande o demasiado anidado)
    fun reject(s: String, maxLen: Int = MAX_LEN, maxDepth: Int = MAX_DEPTH): Boolean {
        if (s.length > maxLen) return true
        var depth = 0
        var inStr = false
        var esc = false
        for (c in s) {
            if (inStr) {
                when {
                    esc -> esc = false
                    c == '\\' -> esc = true
                    c == '"' -> inStr = false
                }
                continue
            }
            when (c) {
                '"' -> inStr = true
                '{', '[' -> { depth++; if (depth > maxDepth) return true }
                '}', ']' -> if (depth > 0) depth--
            }
        }
        return false
    }
}
