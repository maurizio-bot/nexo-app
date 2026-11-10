package com.nexo.ble

import org.json.JSONArray
import org.json.JSONObject

/**
 * UpdateSpec — lógica PURA del actualizador automático del APK de probadores (pedido del dueño 10-11: «las actualizaciones
 * automáticas»), SIN nada de Android (se prueba en JVM: tests/kotlin/UpdateSpecTest.kt).
 *
 * La app consulta los lanzamientos públicos del repositorio en GitHub (`nightly-N`, uno por cada compilación) y, si hay uno más
 * nuevo que su propio número de build, ofrece descargar el APK y abrirlo en el instalador del sistema. Android exige además que la
 * firma coincida con la de la app instalada, así que un APK de otra llave no se puede instalar encima aunque llegara aquí.
 * Defensas de ESTA capa: solo https, solo los hosts de GitHub, solo la ruta de este repositorio, tope de tamaño.
 */
object UpdateSpec {
    const val REPO_PATH_PREFIX = "/maurizio-bot/nexo-app/releases/download/nightly-"
    const val MAX_APK_BYTES = 150L * 1024 * 1024   // ~6 veces un APK actual (25 MB): más que eso no es nuestro APK
    const val MAX_JSON_BYTES = 1_000_000           // la lista de lanzamientos no pasa de unos cientos de KB

    data class Latest(val build: Int, val tag: String, val url: String, val size: Long)

    /** «nightly-2984» → 2984; cualquier otra cosa → null. */
    fun parseBuild(tag: String?): Int? {
        if (tag == null) return null
        val m = Regex("^nightly-(\\d{1,7})$").find(tag) ?: return null
        return m.groupValues[1].toIntOrNull()
    }

    /** ¿Hay que ofrecer la actualización? Solo con número propio conocido (builds de la fábrica, no «dev») y uno ESTRICTAMENTE mayor. */
    fun isNewer(current: Int?, latest: Int?): Boolean = current != null && latest != null && latest > current

    /** URL de partida (la que se descarga primero): https + github.com + ruta de ESTE repositorio + .apk. */
    fun isAllowedStartUrl(url: String?): Boolean {
        val u = parse(url) ?: return false
        return u.scheme == "https" && u.host == "github.com" && u.path.startsWith(REPO_PATH_PREFIX) && u.path.endsWith(".apk") && !u.path.contains("..")
    }

    /** Redirecciones de la descarga: GitHub manda al CDN de sus lanzamientos; solo https y esos hosts. */
    fun isAllowedRedirect(url: String?): Boolean {
        val u = parse(url) ?: return false
        if (u.scheme != "https") return false
        return u.host == "github.com" || u.host == "objects.githubusercontent.com" || u.host == "release-assets.githubusercontent.com"
    }

    /** De la respuesta de `GET /repos/…/releases` toma el nightly de número más alto que traiga un .apk; null si no hay. */
    fun pickLatest(json: String?): Latest? {
        if (json == null || json.length > MAX_JSON_BYTES) return null
        val arr = try { JSONArray(json) } catch (e: Exception) { return null }
        var best: Latest? = null
        for (i in 0 until arr.length()) {
            val rel = arr.optJSONObject(i) ?: continue
            if (rel.optBoolean("draft", false)) continue
            val tag = rel.optString("tag_name", "")
            val b = parseBuild(tag) ?: continue
            if (best != null && b <= best.build) continue
            val asset = firstApk(rel.optJSONArray("assets")) ?: continue
            val url = asset.optString("browser_download_url", "")
            if (!isAllowedStartUrl(url)) continue
            val size = asset.optLong("size", 0L)
            if (size <= 0L || size > MAX_APK_BYTES) continue
            best = Latest(b, tag, url, size)
        }
        return best
    }

    private fun firstApk(assets: JSONArray?): JSONObject? {
        if (assets == null) return null
        for (i in 0 until assets.length()) {
            val a = assets.optJSONObject(i) ?: continue
            if (a.optString("name", "").lowercase().endsWith(".apk")) return a
        }
        return null
    }

    private data class Parts(val scheme: String, val host: String, val path: String)

    private fun parse(url: String?): Parts? {
        if (url == null || url.length > 2048) return null
        return try {
            val u = java.net.URI(url)
            val s = u.scheme ?: return null
            val h = u.host ?: return null
            if (u.userInfo != null || u.port != -1) return null   // sin usuario ni puerto raro
            Parts(s.lowercase(), h.lowercase(), u.rawPath ?: "")
        } catch (e: Exception) { null }
    }
}
