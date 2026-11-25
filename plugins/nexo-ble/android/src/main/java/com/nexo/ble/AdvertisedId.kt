package com.nexo.ble

// Formato de lo que un teléfono NEXO anuncia por Bluetooth (manufacturer data, tras los bytes 0x4E 0x58):
//  - el NEXO ID: "NX" + 8 (lo genera _generateNexoId en MAYÚSCULAS: NX + 2 base36 + 6 hex), o
//  - el código rotativo: "R" + 9 en base32 (minúsculas a-z y 2-7), ver RidToken.
// El escaneo valida con esto antes de aceptar un anuncio, para no meter basura en la lista ni en el mapa NEXO ID→MAC.
// Se compara sin distinguir mayúsculas/minúsculas (el resto de la app pasa el ID a minúsculas). Es Kotlin puro: se
// prueba en JVM (AdvertisedIdTest). OJO: tiene que aceptar el ID real EN MAYÚSCULAS; si no, el escaneo no reconoce
// ningún anuncio (eso fue la regresión de la ronda 2774).
object AdvertisedId {
    private val RE = Regex("^(nx[0-9a-z]{8}|r[a-z2-7]{9})$", RegexOption.IGNORE_CASE)
    fun valid(s: String): Boolean = RE.matches(s)

    /**
     * 3280: lo anunciado, sacado de los datos de fabricante de un anuncio (0x4E 0x58 + el ID en texto); null si no es de NEXO o viene
     * mal formado. Lo usa el escaneo del servicio sin la app (BleSinApp); el de la app tiene el suyo (PluginScan), con la misma regla.
     */
    fun fromManufacturerData(data: ByteArray?): String? {
        if (data == null || data.size < 4 || data.size > 40) return null
        if ((data[0].toInt() and 0xFF) != 0x4E || (data[1].toInt() and 0xFF) != 0x58) return null
        val id = try { String(data, 2, data.size - 2, Charsets.UTF_8) } catch (e: Exception) { return null }
        return if (valid(id)) id else null
    }
}
