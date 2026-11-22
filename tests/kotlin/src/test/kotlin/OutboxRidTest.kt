import com.nexo.ble.NetOutbox
import com.nexo.ble.OutboxRid
import com.nexo.ble.RidToken
import kotlin.test.*

/**
 * 3279 (remate de la fase 3): la bandeja de salida busca a su contacto escaneando, pero un teléfono con contactos anuncia un código que
 * cambia cada 15 min, no su NEXO ID. Sin reconocerlo, el nativo no abría nunca el enlace en teléfonos reales (3271).
 */
class OutboxRidTest {
    private val A = "nxaaaaaaaa"; private val C = "nxcccccccc"
    private val kA = "11".repeat(32); private val kC = "22".repeat(32)

    @Test fun reconoceElCodigoRotativoDelContacto() {
        var t = 1_700_000_000_000L
        val r = OutboxRid { t }
        val keys = mapOf(A to kA, C to kC)
        val e = RidToken.epoch(t, 900)
        assertEquals(A, r.resolve(RidToken.token(kA, e), keys, 900), "el código de ahora")
        assertEquals(A, r.resolve(RidToken.token(kA, e - 1), keys, 900), "el de la época anterior (su reloj va atrasado)")
        assertEquals(A, r.resolve(RidToken.token(kA, e + 1), keys, 900), "el de la siguiente (su reloj va adelantado)")
        assertEquals(C, r.resolve(RidToken.token(kC, e), keys, 900))
        assertNull(r.resolve(RidToken.token(kA, e + 2), keys, 900), "uno de otra época no vale")
        assertNull(r.resolve(RidToken.token("33".repeat(32), e), keys, 900), "el código de un extraño no es de nadie")
        // pasan 15 min: el código viejo sigue valiendo una época; a los 30 min ya no
        val old = RidToken.token(kA, e)
        t += 900_000L; assertEquals(A, r.resolve(old, keys, 900))
        t += 900_000L; assertNull(r.resolve(old, keys, 900))
        assertEquals(A, r.resolve(RidToken.token(kA, RidToken.epoch(t, 900)), keys, 900), "y reconoce el nuevo")
    }

    @Test fun elNexoIdVisibleTambienYLaBasuraNo() {
        val r = OutboxRid { 1_700_000_000_000L }
        assertEquals(A, r.resolve("NXAAAAAAAA", emptyMap(), 900), "con «Agregar» abierto anuncia su NEXO ID (en mayúsculas)")
        assertNull(r.resolve("Rabcdefghi", emptyMap(), 900), "sin claves no se reconoce ningún código")
        assertNull(r.resolve("", mapOf(A to kA), 900))
        assertNull(r.resolve("R123", mapOf(A to kA), 900))
        // claves mal formadas (nunca se confía en lo que llega): se saltan sin romper
        assertNull(r.resolve(RidToken.token(kA, RidToken.epoch(1_700_000_000_000L, 900)), mapOf(A to "zz", "x" to kA), 900))
        // época 0 o negativa: la normal (900 s)
        assertEquals(A, r.resolve(RidToken.token(kA, RidToken.epoch(1_700_000_000_000L, 900)), mapOf(A to kA), 0))
    }

    @Test fun laBandejaGuardaLasClavesSoloDeQuienTieneAlgoPendiente() {
        val o = NetOutbox()
        val t = 1_700_000_000_000L
        o.set(listOf(NetOutbox.Item("msg-1", A, "{\"x\":1}", t), NetOutbox.Item("msg-2", C, "{\"x\":2}", t)), ridKeys = mapOf(A to kA, C to kC, "nxzzzzzzzz" to kA, "nxbbbbbbbb" to "mal"), epochS = 900)
        assertEquals(mapOf(A to kA, C to kC), o.ridKeys(), "solo las de contactos con algo en la bandeja y bien formadas")
        // se guarda con la bandeja y vuelve al arrancar sin la app
        val o2 = NetOutbox()
        assertEquals(2, o2.load(o.toJson(), t))
        assertEquals(mapOf(A to kA, C to kC), o2.ridKeys())
        assertEquals(900L, o2.ridEpochS)
        // confirmado lo de A: su clave ya no se da ni se guarda
        assertTrue(o2.confirmed(A, "msg-1"))
        assertEquals(mapOf(C to kC), o2.ridKeys())
        assertFalse(o2.toJson().contains(kA))
        // una puesta al día sin claves (app anterior) conserva la de quien sigue
        assertFalse(o2.set(listOf(NetOutbox.Item("msg-2", C, "{\"x\":2}", t))), "nada cambió")
        assertEquals(mapOf(C to kC), o2.ridKeys())
        // cambia la clave de C (reinstaló): cuenta como cambio que hay que guardar
        assertTrue(o2.set(listOf(NetOutbox.Item("msg-2", C, "{\"x\":2}", t)), ridKeys = mapOf(C to kA)))
        assertEquals(mapOf(C to kA), o2.ridKeys())
        o2.clear(); assertTrue(o2.ridKeys().isEmpty())
    }
}
