package com.nexo.ble

/**
 * 3129 — Enlace de invitación (PLAN etapa 2; dueño 15-11: «WhatsApp y TikTok»; la página va en su GitHub). El que invita comparte
 * https://maurizio-bot.github.io/nexo-app/i#NX12345678-ABCDEFGH (su NEXO ID y un código de un uso que caduca a los 7 días; el ID y
 * el código van después de «#», que el navegador no manda a ningún servidor). Al tocarlo con NEXO instalado se abre la app
 * (intent-filter de MainActivity, también nexo://i/NX…-…) y la app pone ese ID en «Agregar por NEXO ID».
 * Parte pura (se prueba en JVM: tests/kotlin InviteLinkTest): solo acepta NUESTRAS direcciones y un ID/código bien formados; la
 * pantalla principal está exportada y cualquier app podría mandarle un enlace, así que todo lo demás se ignora.
 */
object InviteLink {
    const val HTTPS_HOST = "maurizio-bot.github.io"
    const val HTTPS_PATH = "/nexo-app/i"
    private val ID_CODE = Regex("^(NX[0-9A-Z]{8})(?:-([2-9A-HJ-NP-Z]{8}))?$")

    /** «nx12345678» y el código («» si no trae) de un enlace de invitación nuestro; null si no lo es. */
    fun parse(url: String?): Pair<String, String>? {
        if (url == null || url.length > 300) return null
        val u = url.trim()
        val tail = when {
            u.startsWith("nexo://i/", ignoreCase = true) -> u.substring(9)
            u.startsWith("nexo://i#", ignoreCase = true) -> u.substring(9)
            u.startsWith("https://", ignoreCase = true) -> {
                val rest = u.substring(8)
                val hostEnd = rest.indexOfFirst { it == '/' || it == '#' || it == '?' }
                if (hostEnd < 0 || !rest.substring(0, hostEnd).equals(HTTPS_HOST, ignoreCase = true)) return null
                val afterHost = rest.substring(hostEnd)
                val hash = afterHost.indexOf('#')
                if (hash < 0) return null
                val path = afterHost.substring(0, hash).substringBefore('?').removeSuffix("/").removeSuffix(".html")
                if (path != HTTPS_PATH) return null
                afterHost.substring(hash + 1)
            }
            else -> return null
        }
        val m = ID_CODE.matchEntire(tail.trim().uppercase()) ?: return null
        return Pair(m.groupValues[1].lowercase(), m.groupValues[2])
    }
}
