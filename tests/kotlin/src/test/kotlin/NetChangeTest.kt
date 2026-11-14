import com.nexo.ble.NetChange
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// 3085 (dueño 14-11: «el S24 cambia de Wi-Fi a datos muy rápido, ¿por qué nosotros somos lentos?»)
class NetChangeTest {
    @Test fun tipoDeRed() {
        assertEquals("wifi", NetChange.typeOf(true, false, false, false))
        assertEquals("cell", NetChange.typeOf(false, true, false, false))
        assertEquals("wifi", NetChange.typeOf(true, true, false, false), "con los dos, manda el Wi-Fi")
        assertEquals("eth", NetChange.typeOf(false, false, true, false))
        assertEquals("vpn", NetChange.typeOf(false, false, false, true))
        assertEquals("other", NetChange.typeOf(false, false, false, false))
    }

    @Test fun soloAvisaEnUnCambioDeTipo() {
        val t = NetChange.Tracker()
        assertNull(t.update("wifi"), "lo primero que se ve no es un cambio")
        assertNull(t.update("wifi"), "Android repite el aviso con cada cambio de señal: no es un cambio")
        assertEquals("wifi", t.update("cell"), "Wi-Fi → datos")
        assertNull(t.update("cell"))
        assertEquals("cell", t.update("none"), "datos → sin red")
        assertEquals("none", t.update("wifi"), "sin red → Wi-Fi")
        assertNull(t.update(""), "vacío: nada")
        assertEquals("wifi", t.last)
    }
}
