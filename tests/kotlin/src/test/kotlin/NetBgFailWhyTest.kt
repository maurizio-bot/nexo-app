import com.nexo.ble.failWhy
import kotlin.test.Test
import kotlin.test.assertEquals

// 3264 (J Manuel 21-11 y Austin 20-11): «no se pudo abrir otra vez (… IllegalStateException)» no decía por qué. Al registro va lo que
// contestó el relé (solo el código), sin texto libre del servidor.
class NetBgFailWhyTest {
    @Test fun elReleContestaUnCodigo() {
        assertEquals("el relé contestó 429 y no aceptó", failWhy(IllegalStateException("el relé no aceptó: HTTP/1.1 429 Too Many Requests")))
        assertEquals("el relé contestó 503 y no aceptó", failWhy(IllegalStateException("el relé no aceptó: HTTP/1.1 503 Service Unavailable")))
        assertEquals("el relé contestó 403 y no aceptó", failWhy(IllegalStateException("el relé no aceptó: HTTP/2 403")))
    }
    @Test fun cierreAlSaludar_yLoDemasComoAntes() {
        assertEquals("el relé cerró al saludar", failWhy(IllegalStateException("conexión cerrada")))
        assertEquals("IllegalStateException", failWhy(IllegalStateException("el relé no aceptó: <html>basura</html>")), "sin código reconocible: la clase, nunca texto del servidor")
        assertEquals("UnknownHostException", failWhy(java.net.UnknownHostException("nos.lol")))
        assertEquals("SocketTimeoutException", failWhy(java.net.SocketTimeoutException()))
    }
}
