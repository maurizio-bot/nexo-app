package com.nexo.ble

// I-S1 + T-A1 (auditoría 23-11): al ABRIR un archivo recibido, quién decide el nombre en disco, si es una APK y con qué tipo
// se abre. Sin Android (se prueba en la JVM: tests/kotlin OpenTypeTest). La interfaz (src/ui/store_flag.js: openSafeName /
// isApkFile) aplica la MISMA regla, con los mismos casos de prueba, para que la tienda no deje pasar una APK disfrazada.
//  - Nombre: sin carpetas; FUERA los caracteres de control y de dirección (U+202A–202E, U+2066–2069, U+200E/F, U+061C, U+FEFF:
//    «fdp.apk» con un RTL se ve «kpa.pdf»); lo demás que no sea [A-Za-z0-9._ ()-] pasa a «_»; sin espacios a los lados ni
//    puntos delante; tope 80 conservando la extensión (antes un nombre largo perdía el «.apk» y se abría como otra cosa).
//  - APK = el nombre YA SANEADO termina en «.apk». Un tipo de APK con otro nombre NO instala: se abre como octet-stream.
//  - Tipo: text/html, xhtml, svg y xml nunca (octet-stream); si el remitente dice un tipo que no cuadra con la extensión,
//    octet-stream (misma familia image/audio/video/text = cuadra, y se usa el de la extensión: lo que el usuario ve).
object OpenType {
    const val APK = "application/vnd.android.package-archive"
    const val OCTET = "application/octet-stream"
    private val DANGER = setOf("text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml")
    private val SAME_FAMILY = setOf("image", "audio", "video", "text")
    private val INVISIBLE = Regex("[\\u0000-\\u001F\\u007F-\\u009F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]")

    fun safeName(name: String?): String {
        val clean = (name ?: "").substringAfterLast('/').substringAfterLast('\\')
            .replace(INVISIBLE, "")
            .replace(Regex("[^A-Za-z0-9._ ()\\-]"), "_").trim().trimStart('.')
        val n = if (clean.isEmpty()) "archivo" else clean
        if (n.length <= 80) return n
        val ext = n.substringAfterLast('.', "")
        return if (ext.length in 1..10 && ext.length < n.length - 1) n.take(80 - ext.length - 1).trimEnd() + "." + ext else n.take(80)
    }

    fun ext(safe: String): String = safe.substringAfterLast('.', "").lowercase()

    fun isApk(safe: String): Boolean = ext(safe) == "apk"

    /** Tipo con el que se abre. [byExt] = tipo que Android asocia a la extensión (MimeTypeMap) o null. */
    fun mimeFor(safe: String, claimed: String?, byExt: (String) -> String?): String {
        val e = ext(safe)
        if (e == "apk") return APK
        val c = (claimed ?: "").substringBefore(';').trim().lowercase()
        val em = if (e.isEmpty()) null else byExt(e)?.lowercase()
        if (c == APK || c in DANGER || em in DANGER) return OCTET
        if (!c.contains('/')) return em ?: OCTET
        if (em == null || c == em) return c
        val top = c.substringBefore('/')
        return if (top in SAME_FAMILY && top == em.substringBefore('/')) em else OCTET
    }
}
