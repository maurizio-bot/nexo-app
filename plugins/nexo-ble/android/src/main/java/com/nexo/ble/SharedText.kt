package com.nexo.ble

/**
 * 3161 — Texto y enlaces compartidos CON NEXO y enlaces abiertos FUERA de NEXO (dueño 16-11: «compartir de forma práctica vídeos de
 * TikTok, Facebook, Instagram (y YouTube) en el chat»).
 *  - NEXO sale en el menú «Compartir» de Android (intent-filter SEND text/plain de MainActivity). La pantalla principal está exportada:
 *    cualquier app puede mandarle algo, así que solo se acepta texto (text/plain) y como mucho MAX_CHARS (sin caracteres de control).
 *  - openUrl: la app abre un enlace del chat con Intent.ACTION_VIEW (la app de TikTok/Instagram/… si está instalada; si no, el
 *    navegador). Solo http/https bien formados: nunca javascript:, intent:, file:, content:…, ni «usuario@» en la dirección.
 * Parte pura (se prueba en JVM: tests/kotlin SharedTextTest); lo de Android está en PluginShare.kt.
 */
object SharedText {
    const val MAX_CHARS = 4000
    const val MAX_URL = 2048
    private val CONTROL = Regex("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]")

    /** El texto compartido limpio y cortado a MAX_CHARS; null si no es texto o viene vacío. */
    fun clean(mimeType: String?, text: CharSequence?): String? {
        val type = mimeType?.trim()?.lowercase() ?: return null
        if (type != "text/plain" && !type.startsWith("text/plain;")) return null
        if (text == null) return null
        // no se procesa un texto enorme entero: con el doble del tope basta para limpiar y cortar
        var s = (if (text.length > MAX_CHARS * 2) text.subSequence(0, MAX_CHARS * 2) else text).toString()
        s = s.replace("\r\n", "\n").replace('\r', '\n').replace(CONTROL, "").trim()
        if (s.isEmpty()) return null
        if (s.length > MAX_CHARS) {
            var cut = MAX_CHARS
            if (Character.isHighSurrogate(s[cut - 1])) cut-- // no partir un emoji por la mitad
            s = s.substring(0, cut)
        }
        return s
    }

    /** La URL si es un enlace http/https que se puede abrir fuera; null si no. */
    fun httpUrl(url: String?): String? {
        if (url == null || url.isEmpty() || url.length > MAX_URL) return null
        val scheme = url.substringBefore("://", "").lowercase()
        if (scheme != "http" && scheme != "https") return null
        if (url.any { it.isWhitespace() || it.code < 0x20 || it.code == 0x7F || it == '\\' }) return null
        val authority = url.substring(scheme.length + 3).substringBefore('/').substringBefore('?').substringBefore('#')
        if (authority.isEmpty() || authority.contains('@')) return null
        val host = authority.substringBeforeLast(':').removePrefix("[").removeSuffix("]")
        if (host.isEmpty()) return null
        return url
    }
}
