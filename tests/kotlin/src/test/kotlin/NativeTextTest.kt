import com.nexo.ble.NativeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * 3122 — Avisos del teléfono en el idioma de la app. La parte pura: cada texto en los 5 idiomas, las {marcas} reemplazadas, un idioma
 * desconocido cae al español y el español queda IGUAL que antes (los avisos de siempre no cambian para quien usa la app en español).
 */
class NativeTextTest {
    @Test fun cincoIdiomasYMarcas() {
        val marca = Regex("\\{[a-z]+\\}")
        for (k in NativeText.keys()) {
            val es = NativeText.t("es", k)
            val esMarcas = marca.findAll(es).map { it.value }.toSet()
            for (l in NativeText.LANGS) {
                val s = NativeText.t(l, k)
                assertTrue(s.isNotBlank(), "$k:$l vacío")
                assertEquals(esMarcas, marca.findAll(s).map { it.value }.toSet(), "$k:$l marcas")
            }
        }
    }

    @Test fun espanolComoAntes() {
        assertEquals("Mensaje nuevo", NativeText.t("es", "msg_new"))
        assertEquals("3 mensajes nuevos", NativeText.t("es", "msg_new_n", "n" to 3))
        assertEquals("Hay una versión nueva de NEXO (3064)", NativeText.t("es", "upd_title", "b" to 3064))
        assertEquals("Toca «Actualizar» para instalarla (25 MB)", NativeText.t("es", "upd_text", "mb" to " (25 MB)"))
        assertEquals("Toca «Actualizar» para instalarla", NativeText.t("es", "upd_text", "mb" to ""))
        assertEquals("Videollamada entrante · NEXO", NativeText.t("es", "vcall_in_nexo"))
        assertEquals("Puede haber mensajes nuevos: abre NEXO", NativeText.t("es", "fcm_maybe"))
        assertEquals("📎 Archivo", NativeText.t("es", "msg_file"))
    }

    @Test fun otrosIdiomasYRespaldo() {
        assertEquals("Nuovo messaggio", NativeText.t("it", "msg_new"))
        assertEquals("New message", NativeText.t("en-US", "msg_new"))
        assertEquals("2 novas mensagens", NativeText.t("pt", "msg_new_n", "n" to 2))
        assertEquals("Appel vidéo entrant · NEXO", NativeText.t("fr", "vcall_in_nexo"))
        assertEquals("Mensaje nuevo", NativeText.t("de", "msg_new"))
        assertEquals("Mensaje nuevo", NativeText.t(null, "msg_new"))
        assertEquals("clave_que_no_existe", NativeText.t("it", "clave_que_no_existe"))
    }
}
