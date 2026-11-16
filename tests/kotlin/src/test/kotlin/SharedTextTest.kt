import com.nexo.ble.SharedText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// 3161: lo que se comparte CON NEXO (solo texto, sin caracteres de control, tope de 4000) y los enlaces que se abren FUERA (solo http/https)
class SharedTextTest {
    @Test fun aceptaTextoYLoCorta() {
        assertEquals("mira https://vm.tiktok.com/ZMabc123/", SharedText.clean("text/plain", "  mira https://vm.tiktok.com/ZMabc123/\n"))
        assertEquals("hola\nmundo", SharedText.clean("TEXT/PLAIN; charset=utf-8", "hola\r\nmundo\u0000\u0007"))
        assertEquals(SharedText.MAX_CHARS, SharedText.clean("text/plain", "x".repeat(50000))!!.length)
        val emoji = "a".repeat(SharedText.MAX_CHARS - 1) + "😀"  // el emoji quedaría partido en el carácter 4000
        assertEquals(SharedText.MAX_CHARS - 1, SharedText.clean("text/plain", emoji)!!.length)
    }
    @Test fun rechazaLoQueNoEsTexto() {
        assertNull(SharedText.clean("image/png", "https://x.com"))
        assertNull(SharedText.clean("text/*", "https://x.com"))
        assertNull(SharedText.clean("text/html", "<b>x</b>"))
        assertNull(SharedText.clean(null, "hola"))
        assertNull(SharedText.clean("text/plain", null))
        assertNull(SharedText.clean("text/plain", "  \u0001 "))
    }
    @Test fun soloEnlacesHttp() {
        assertEquals("https://vm.tiktok.com/ZMabc123/", SharedText.httpUrl("https://vm.tiktok.com/ZMabc123/"))
        assertEquals("http://ejemplo.com/a?b=1#c", SharedText.httpUrl("http://ejemplo.com/a?b=1#c"))
        assertEquals("HTTPS://youtu.be/x", SharedText.httpUrl("HTTPS://youtu.be/x"))
        assertNull(SharedText.httpUrl("javascript:alert(1)"))
        assertNull(SharedText.httpUrl("intent://scan/#Intent;scheme=zxing;end"))
        assertNull(SharedText.httpUrl("file:///sdcard/x"))
        assertNull(SharedText.httpUrl("content://com.nexo.app.fileprovider/x"))
        assertNull(SharedText.httpUrl("https://www.tiktok.com@malo.com/"))
        assertNull(SharedText.httpUrl("https://malo.com\\@tiktok.com/"))
        assertNull(SharedText.httpUrl("https://x.com/a b"))
        assertNull(SharedText.httpUrl("https:///solo-ruta"))
        assertNull(SharedText.httpUrl("https://x.com/" + "a".repeat(3000)))
        assertNull(SharedText.httpUrl(null))
    }
}
