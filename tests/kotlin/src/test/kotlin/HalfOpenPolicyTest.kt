import com.nexo.ble.HalfOpenPolicy
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// 3262: enlace «a medias» en nuestro servidor GATT (el otro escribe sin estar suscrito: sobrevivió a un reinicio nuestro y no podemos
// contestarle). Se corta pasado un margen; un cliente sano (se suscribe antes de escribir) nunca; y nunca en bucle.
class HalfOpenPolicyTest {
    private val mac = "aabbccddeeff"

    @Test fun clienteSano_nuncaSeCorta() {
        val p = HalfOpenPolicy()
        for (t in 0L..60000L step 500L) assertFalse(p.onWrite(mac, subscribed = true, ownClient = false, now = t), "suscrito: jamás")
    }

    @Test fun conEnlaceDeClienteNuestro_noSeCorta() {
        val p = HalfOpenPolicy()
        for (t in 0L..60000L step 500L) assertFalse(p.onWrite(mac, subscribed = false, ownClient = true, now = t), "podemos contestarle por nuestro enlace de cliente")
    }

    @Test fun aMedias_seCortaPasadoElMargen_noAntes() {
        val p = HalfOpenPolicy()
        assertFalse(p.onWrite(mac, false, false, 1000), "primera escritura sin suscripción: empieza el margen")
        assertFalse(p.onWrite(mac, false, false, 1000 + HalfOpenPolicy.GRACE_MS - 1), "dentro del margen (un cliente lento aún puede suscribirse)")
        assertTrue(p.onWrite(mac, false, false, 1000 + HalfOpenPolicy.GRACE_MS), "pasado el margen y sigue sin suscribirse: se corta")
        assertTrue(HalfOpenPolicy.GRACE_MS > 4000, "el margen cubre los 4 s que un cliente NEXO puede escribir antes de suscribirse")
    }

    @Test fun siSeSuscribeATiempo_seOlvida() {
        val p = HalfOpenPolicy()
        assertFalse(p.onWrite(mac, false, false, 0))
        assertFalse(p.onWrite(mac, true, false, 3000), "se suscribió: enlace sano")
        assertFalse(p.onWrite(mac, false, false, 9000), "si más tarde vuelve a escribir sin suscripción, el margen empieza de nuevo")
        assertFalse(p.onWrite(mac, false, false, 9000 + HalfOpenPolicy.GRACE_MS - 1))
        assertTrue(p.onWrite(mac, false, false, 9000 + HalfOpenPolicy.GRACE_MS))
    }

    @Test fun trasCortar_noSeCortaEnBucle() {
        val p = HalfOpenPolicy()
        p.onWrite(mac, false, false, 0)
        assertTrue(p.onWrite(mac, false, false, HalfOpenPolicy.GRACE_MS))
        val t0 = HalfOpenPolicy.GRACE_MS
        for (t in t0 + 100..t0 + HalfOpenPolicy.COOLDOWN_MS - 1 step 1000L) assertFalse(p.onWrite(mac, false, false, t), "en el enfriamiento no se corta otra vez")
        assertFalse(p.onWrite(mac, false, false, t0 + HalfOpenPolicy.COOLDOWN_MS), "pasado el enfriamiento vuelve a contar el margen…")
        assertTrue(p.onWrite(mac, false, false, t0 + HalfOpenPolicy.COOLDOWN_MS + HalfOpenPolicy.GRACE_MS), "…y si sigue a medias se corta de nuevo")
    }

    @Test fun cadaDireccionPorSeparado_yCerrarOlvida() {
        val p = HalfOpenPolicy()
        p.onWrite("a1", false, false, 0); p.onWrite("b2", false, false, 5000)
        assertTrue(p.onWrite("a1", false, false, 6000))
        assertFalse(p.onWrite("b2", false, false, 6000), "b2 empezó más tarde")
        p.forget("b2")
        assertFalse(p.onWrite("b2", false, false, 11000), "tras cerrarse el enlace, la cuenta empieza de cero")
    }
}
