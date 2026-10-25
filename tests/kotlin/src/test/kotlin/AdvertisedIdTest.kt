import com.nexo.ble.AdvertisedId
import kotlin.test.*

// Regresión de la ronda 2774: la validación del anuncio solo aceptaba "nx" en minúsculas, pero _generateNexoId hace
// el NEXO ID en MAYÚSCULAS ("NX"+8) → el escaneo no reconocía ningún anuncio y no encontraba a nadie. Esta prueba fija
// que se aceptan los formatos reales (ID en mayúsculas y código rotativo) y se rechaza la basura.
class AdvertisedIdTest {
    @Test fun aceptaElNexoIdEnMayusculas() {
        assertTrue(AdvertisedId.valid("NX0AB12C3D"))   // como lo hace _generateNexoId (NX + 2 base36 + 6 hex)
        assertTrue(AdvertisedId.valid("NXZZ9F0A1B"))
        assertTrue(AdvertisedId.valid("nx0ab12c3d"))   // y en minúsculas (como lo guarda el resto de la app)
    }
    @Test fun aceptaElCodigoRotativo() {
        assertTrue(AdvertisedId.valid("Rabcde234f")) // R + 9 en base32 (a-z, 2-7)
        assertTrue(AdvertisedId.valid("rzzzzzzz7z"))
    }
    @Test fun rechazaBasura() {
        assertFalse(AdvertisedId.valid(""))
        assertFalse(AdvertisedId.valid("NX0AB12C3"))     // corto
        assertFalse(AdvertisedId.valid("NX0AB12C3DE"))    // largo
        assertFalse(AdvertisedId.valid("ZZ0AB12C3D"))     // no empieza por NX/R
        assertFalse(AdvertisedId.valid("R12345678"))      // R + 8 (y 1 no es base32)
        assertFalse(AdvertisedId.valid("NX0AB!2C3D"))     // carácter raro
        assertFalse(AdvertisedId.valid("x".repeat(5000))) // descomunal
    }
}
