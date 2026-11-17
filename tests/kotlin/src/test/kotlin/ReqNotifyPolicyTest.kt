import com.nexo.ble.ReqNotifyPolicy
import com.nexo.ble.ReqNotifyPolicy.Verdict
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * 3190 (dueño 17-11: «hay que poner esa notificación: hay un contacto que te quiere agregar»): el freno del aviso del teléfono por una
 * solicitud de contacto (1 por remitente cada 24 h, 3 por hora; el resto en un aviso agrupado) y su texto (nombre saneado, NEXO ID
 * completo, advertencia si el nombre es el de un contacto que ya tengo con otro ID) en los 5 idiomas, sin voseo.
 */
class ReqNotifyPolicyTest {
    private val H = 3600_000L
    private val t0 = 1_790_000_000_000L

    @Test fun unAvisoPorRemitenteCada24h() {
        val st = ReqNotifyPolicy.State()
        assertEquals(Verdict.NOTIFY, ReqNotifyPolicy.decide(st, "nxaaaaaaaa", t0))
        assertEquals(Verdict.SAME_SENDER, ReqNotifyPolicy.decide(st, "nxaaaaaaaa", t0 + 60_000), "la misma persona insiste al minuto: sin otro aviso")
        assertEquals(Verdict.SAME_SENDER, ReqNotifyPolicy.decide(st, " NXAAAAAAAA ", t0 + 23 * H), "mayúsculas o espacios no la hacen otra")
        assertEquals(Verdict.NOTIFY, ReqNotifyPolicy.decide(st, "nxaaaaaaaa", t0 + 24 * H), "pasadas 24 h vuelve a avisar")
    }

    @Test fun tresPorHoraYElRestoAgrupado() {
        val st = ReqNotifyPolicy.State()
        val v = (1..6).map { ReqNotifyPolicy.decide(st, "nx0000000$it", t0 + it * 1000L) }
        assertEquals(listOf(Verdict.NOTIFY, Verdict.NOTIFY, Verdict.NOTIFY, Verdict.GROUP, Verdict.GROUP, Verdict.GROUP), v)
        assertEquals(3, st.groupN, "el agrupado cuenta 3 personas más")
        assertEquals(Verdict.SAME_SENDER, ReqNotifyPolicy.decide(st, "nx00000005", t0 + 10_000), "una del agrupado que insiste no suma")
        assertEquals(3, st.groupN)
        // pasada la hora, vuelve a haber avisos sueltos y el agrupado empieza de cero
        assertEquals(Verdict.NOTIFY, ReqNotifyPolicy.decide(st, "nx00000009", t0 + H + 7000))
        assertEquals(0, st.groupN)
    }

    @Test fun inundacionDeMilRemitentes() {
        val st = ReqNotifyPolicy.State()
        var sueltos = 0; var agrupados = 0
        for (i in 0 until 1000) when (ReqNotifyPolicy.decide(st, "nx" + i.toString().padStart(8, '0'), t0 + i * 100L)) {
            Verdict.NOTIFY -> sueltos++; Verdict.GROUP -> agrupados++; Verdict.SAME_SENDER -> {}
        }
        assertEquals(3, sueltos, "un bot con mil IDs en 100 s: solo 3 avisos que suenan")
        assertEquals(997, agrupados)
        assertTrue(st.last.size <= ReqNotifyPolicy.KEEP_SENDERS, "lo recordado tiene tope: ${st.last.size}")
    }

    @Test fun relojHaciaAtrasNoCallaParaSiempre() {
        val st = ReqNotifyPolicy.State()
        assertEquals(Verdict.NOTIFY, ReqNotifyPolicy.decide(st, "nxaaaaaaaa", t0 + 48 * H)) // reloj adelantado
        assertEquals(Verdict.NOTIFY, ReqNotifyPolicy.decide(st, "nxaaaaaaaa", t0), "el reloj volvió a su hora: no queda callado 2 días")
    }

    @Test fun seGuardaYSeRecupera() {
        val st = ReqNotifyPolicy.State()
        (1..4).forEach { ReqNotifyPolicy.decide(st, "nx0000000$it", t0 + it) }
        val back = ReqNotifyPolicy.State.fromJson(st.toJson())
        assertEquals(Verdict.SAME_SENDER, ReqNotifyPolicy.decide(back, "nx00000002", t0 + 10), "tras reiniciar el proceso recuerda a quién avisó")
        assertEquals(Verdict.GROUP, ReqNotifyPolicy.decide(back, "nx00000007", t0 + 11), "y el tope de la hora")
        assertEquals(2, back.groupN)
        for (bad in listOf(null, "", "{", "[]", "{\"l\":5}", "x".repeat(300_000))) assertEquals(Verdict.NOTIFY, ReqNotifyPolicy.decide(ReqNotifyPolicy.State.fromJson(bad), "nxaaaaaaaa", t0), "estado ilegible → de cero: $bad")
    }

    @Test fun textoConIdCompletoEnCincoIdiomasSinVoseo() {
        assertEquals("Ana (NX1A2B3C4D) quiere agregarte en NEXO", ReqNotifyPolicy.body("es", "Ana", "nx1a2b3c4d", false, ""))
        assertEquals("Ana (NX1A2B3C4D) vuole aggiungerti su NEXO", ReqNotifyPolicy.body("it", "Ana", "nx1a2b3c4d", false, ""))
        assertEquals("Ana (NX1A2B3C4D) wants to add you on NEXO", ReqNotifyPolicy.body("en", "Ana", "nx1a2b3c4d", false, ""))
        assertEquals("Ana (NX1A2B3C4D) quer adicionar você no NEXO", ReqNotifyPolicy.body("pt", "Ana", "nx1a2b3c4d", false, ""))
        assertEquals("Ana (NX1A2B3C4D) veut vous ajouter sur NEXO", ReqNotifyPolicy.body("fr", "Ana", "nx1a2b3c4d", false, ""))
        assertEquals("NX1A2B3C4D quiere agregarte en NEXO", ReqNotifyPolicy.body("es", "  ", "nx1a2b3c4d", false, ""), "sin nombre: solo el ID")
        assertEquals("Ana (NX1A2B3C4D) aceptó tu solicitud: confírmala en NEXO", ReqNotifyPolicy.body("es", "Ana", "nx1a2b3c4d", true, ""))
        assertEquals("Ana (NX1A2B3C4D) accepted your request: confirm it in NEXO", ReqNotifyPolicy.body("en", "Ana", "nx1a2b3c4d", true, ""))
        assertEquals("⚠ NX1A2B3C4D usa el nombre de tu contacto Ana y quiere agregarte: puede ser un impostor", ReqNotifyPolicy.body("es", "Ana", "nx1a2b3c4d", false, "Ana"))
        assertEquals("⚠ NX1A2B3C4D is using the name of your contact Ana and wants to add you: it may be an impostor", ReqNotifyPolicy.body("en", "Ana", "nx1a2b3c4d", false, "Ana"))
        assertEquals("Otra persona quiere agregarte en NEXO", ReqNotifyPolicy.groupBody("es", 1))
        assertEquals("4 personas más quieren agregarte en NEXO", ReqNotifyPolicy.groupBody("es", 4))
        assertEquals("Altre 4 persone vogliono aggiungerti su NEXO", ReqNotifyPolicy.groupBody("it", 4))
        // sin voseo (la interfaz va en «tú»: mira, confírmala; nunca mirá, confirmá, tocá…)
        val voseo = Regex("(?<!\\p{L})(mirá|confirmá|tocá|aceptá|abrí|podés|tenés|querés|vos)(?!\\p{L})", RegexOption.IGNORE_CASE)
        assertTrue(voseo.containsMatchIn("confirmá en NEXO") && !voseo.containsMatchIn("confírmala en NEXO"), "la búsqueda de voseo funciona")
        for (acc in listOf(false, true)) for (twin in listOf("", "Ana")) assertFalse(voseo.containsMatchIn(ReqNotifyPolicy.body("es", "Ana", "nx1a2b3c4d", acc, twin)))
        for (n in listOf(1, 5)) assertFalse(voseo.containsMatchIn(ReqNotifyPolicy.groupBody("es", n)))
    }

    @Test fun nombreSaneadoNoDisfrazaElId() {
        // U+202E invierte lo que sigue (el ID se leería al revés); U+200B y U+FEFF son invisibles; saltos de línea y < > fuera
        val raro = "Ana‮​﻿\n<b>  López\t</b>"
        assertEquals("Ana b López /b", ReqNotifyPolicy.cleanName(raro))
        assertEquals("Ana b López /b (NX1A2B3C4D) quiere agregarte en NEXO", ReqNotifyPolicy.body("es", raro, "nx1a2b3c4d", false, ""))
        assertEquals(40, ReqNotifyPolicy.cleanName("x".repeat(500)).length)
    }

    @Test fun avisoDeImpostorPorElNombre() {
        val known = mapOf("nxcccccccc" to "Ana López", "nxgggggggg" to "NEXO")
        assertEquals("Ana López", ReqNotifyPolicy.twinOf("ana   LÓPEZ", "nxeeeeeeee", known), "mismo nombre (mayúsculas y espacios aparte), otro ID")
        assertEquals("Ana López", ReqNotifyPolicy.twinOf("Ana​ López", "nxeeeeeeee", known), "un carácter invisible no lo esconde")
        assertEquals("", ReqNotifyPolicy.twinOf("Ana López", "nxcccccccc", known), "es el mismo contacto (mismo ID): no es gemelo")
        assertEquals("", ReqNotifyPolicy.twinOf("NEXO", "nxeeeeeeee", known), "el nombre por defecto no cuenta")
        assertEquals("", ReqNotifyPolicy.twinOf("", "nxeeeeeeee", known))
        assertEquals("", ReqNotifyPolicy.twinOf("Luis", "nxeeeeeeee", known))
    }
}
