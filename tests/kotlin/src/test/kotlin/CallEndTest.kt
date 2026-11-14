import com.nexo.ble.BgInbox
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// 3087 (punto débil de llamadas: «con la app cerrada, si el que llama cuelga, sigue sonando hasta 45 s»)
class CallEndTest {
    private val me = "nxbbbbbbbb"
    private fun env(extra: String) = "{\"v\":1,\"type\":\"chat\",\"from\":\"nxaaaaaaaa\",\"msgId\":\"cs111111111111\",\"q\":1,\"payload\":{\"text\":\"x\"}$extra}"

    @Test fun laMarcaDeColgarSeLeeSinDescifrar() {
        assertEquals("cs0123456789ab", BgInbox.classify(env(",\"ce\":\"cs0123456789ab\""), me).callEnd)
        assertEquals("", BgInbox.classify(env(""), me).callEnd, "un mensaje normal no cuelga nada")
        assertEquals("", BgInbox.classify(env(",\"ce\":\"basura\""), me).callEnd, "marca mal formada: nada")
        assertEquals("", BgInbox.classify(env(",\"ce\":\"CS0123456789AB\""), me).callEnd, "solo minúsculas, como las crea la app")
    }

    // 3089: la oferta de VIDEOllamada se reconoce sin descifrar (cv:1 en el sobre; v:1 en la señal cruda)
    @Test fun videollamadaSeReconoce() {
        val o = "{\"v\":1,\"type\":\"chat\",\"from\":\"nxaaaaaaaa\",\"msgId\":\"cs222222222222\",\"cl\":1,\"payload\":{\"text\":\"x\"}"
        assertTrue(BgInbox.classify("$o,\"cv\":1}", me).video, "oferta con cv:1 = videollamada")
        assertTrue(BgInbox.classify("$o,\"cv\":1}", me).call)
        assertFalse(BgInbox.classify("$o}", me).video, "sin cv: llamada de voz")
        assertTrue(BgInbox.classify("{\"type\":\"nexo_call\",\"op\":\"offer\",\"from\":\"nxaaaaaaaa\",\"id\":\"cl1\",\"v\":1}", me).video, "señal cruda con v:1")
        // la oferta es larga (clave + códecs) y viaja en trozos: la marca va en la cabecera del primer trozo (t:"c", i:0)
        assertTrue(BgInbox.classify("{\"t\":\"c\",\"i\":0,\"from\":\"nxaaaaaaaa\",\"m\":\"cs333333333333\",\"cl\":1,\"cv\":1}", me).video, "trozo 0 de una videollamada")
        assertFalse(BgInbox.classify("{\"t\":\"c\",\"i\":0,\"from\":\"nxaaaaaaaa\",\"m\":\"cs333333333333\",\"cl\":1}", me).video, "trozo 0 de una llamada de voz")
    }

    @Test fun soloQuitaLaLlamadaQueSuena() {
        assertTrue(BgInbox.endsRinging("nxaaaaaaaa", "cs0123456789ab", "NXAAAAAAAA", "cs0123456789ab"), "el mismo que llama, la misma oferta")
        assertTrue(BgInbox.endsRinging("nxaaaaaaaa", "", "nxaaaaaaaa", "cs0123456789ab"), "sonaba sin id de oferta: basta el remitente")
        assertFalse(BgInbox.endsRinging("nxaaaaaaaa", "cs0123456789ab", "nxaaaaaaaa", "cs9999999999ff"), "otra llamada suya (más nueva) sigue sonando")
        assertFalse(BgInbox.endsRinging("nxaaaaaaaa", "cs0123456789ab", "nxcccccccc", "cs0123456789ab"), "otro contacto no puede colgar esta")
        assertFalse(BgInbox.endsRinging("", "", "nxaaaaaaaa", "cs0123456789ab"), "no suena nada")
        assertFalse(BgInbox.endsRinging("nxaaaaaaaa", "", "nxaaaaaaaa", "x"), "marca mal formada")
    }
}
