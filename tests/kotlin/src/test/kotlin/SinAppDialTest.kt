import com.nexo.ble.AdvertisedId
import com.nexo.ble.BgInbox
import com.nexo.ble.NetBg
import com.nexo.ble.NetOutbox
import com.nexo.ble.OutboxBle
import com.nexo.ble.OutboxDial
import com.nexo.ble.OutboxRid
import com.nexo.ble.RidToken
import com.nexo.ble.SinAppCore
import org.json.JSONObject
import kotlin.test.*

/**
 * 3280 (remate de la fase 3): el servicio SIN la app también abre enlaces. NEXO volvió sola (Android la cerró, reinicio, actualización)
 * con mensajes en la bandeja y los dos teléfonos duermen: antes nadie conectaba. Aquí, las piezas sin Android unidas como en BleSinApp:
 * bandeja guardada → a quién buscar → lo anunciado (código rotativo) → a quién conectar → escribir → su ✓✓ firmada lo retira.
 */
class SinAppDialTest {
    private val ME = "nxbbbbbbbb"; private val A = "nxaaaaaaaa"
    private val keyA = ByteArray(32) { (it + 1).toByte() }
    private val ridA = "ab".repeat(32)
    private fun p(id: String) = """{"v":1,"type":"chat","from":"$ME","msgId":"$id","payload":{"text":"e2:cifrado"},"ss":1,"dn":"$A"}"""
    private fun adv(s: String) = byteArrayOf(0x4E, 0x58) + s.toByteArray(Charsets.UTF_8)

    @Test fun elServicioSinLaAppBuscaConectaEscribeYLaConfirmacionLoRetira() {
        var t = 1_700_000_000_000L
        // lo que dejó la app antes de morir: la bandeja con la clave de los códigos de A (cifrada en reposo en el teléfono)
        val saved = NetOutbox().also { it.set(listOf(NetOutbox.Item("msg_1", A, p("msg_1"), t)), ridKeys = mapOf(A to ridA), epochS = 900) }.toJson()
        // NEXO vuelve sola: la escucha carga lo guardado (NetBgSaved.apply → outboxLoad)
        val bg = NetBg({ _, _, _, _, _, _ -> }, { })
        assertEquals(1, bg.outboxLoad(saved))
        val ready = HashSet<String>(); val written = ArrayList<String>()
        val out = OutboxBle({ ME }, { bg }, { if (it == A) keyA else null }, object : OutboxBle.Link {
            override fun ready(mac: String) = mac in ready
            override fun send(mac: String, json: String): Boolean { written.add("$mac|" + JSONObject(json).optString("msgId")); return true }
            override fun log(msg: String) {}
        }) { t }
        val dial = OutboxDial { t }; val rid = OutboxRid { t }
        val core = SinAppCore(ME, object : SinAppCore.Sink {
            override fun send(link: String, json: String) {}
            override fun store(link: String, json: String) = true
            override fun notify(info: BgInbox.Info, only: Boolean) {}
            override fun callEnded(from: String, offer: String) {}
            override fun kxCard(): String? = null
            override fun ackSign(from: String, fields: String): String? = null
            override fun log(level: String, msg: String) {}
            override fun heard(link: String, json: String) { out.heard(link, json) }
        }) { t }

        // 1) a quién buscar: A tiene algo y ningún enlace; corre prisa (ningún relé lo aceptó: el Bluetooth es su único camino)
        val want = out.wanting()
        assertEquals(setOf(A), want)
        assertTrue(out.urgent(want))
        assertFalse(dial.scanDue(want, true)); t += OutboxDial.FIRST_MS
        assertEquals(OutboxDial.WAKE_MIN_MS, dial.wakeInMs(want, true).also { assertTrue(it > 0) }, "el despertador, para el próximo repaso")
        assertTrue(dial.scanDue(want, true), "primer escaneo")

        // 2) lo que se ve en el aire: A anuncia su código rotativo (no su NEXO ID); un extraño, el suyo; y basura
        val seen = HashMap<String, Pair<String, Long>>()
        val tokA = RidToken.token(ridA, RidToken.epoch(t, 900))
        fun onScan(mac: String, data: ByteArray) {
            val said = AdvertisedId.fromManufacturerData(data) ?: return
            val nx = rid.resolve(said, bg.outbox.ridKeys(), bg.outbox.ridEpochS) ?: return
            seen[nx] = mac to t
        }
        onScan("aa0000000001", adv(RidToken.token("cd".repeat(32), RidToken.epoch(t, 900)))) // otro NEXO que no es contacto con pendientes
        onScan("aa0000000002", byteArrayOf(0x4E, 0x58, 0x01, 0x02))                         // basura con la marca de NEXO
        onScan("aa0000000003", byteArrayOf(0x01, 0x02, 0x03, 0x04, 0x05))                   // otro fabricante
        assertTrue(seen.isEmpty())
        onScan("aa00000000aa", adv(tokA))
        assertEquals("aa00000000aa", seen[A]?.first)

        // 3) a conectar: solo A, por la dirección en que se le vio
        t += OutboxDial.SCAN_MS
        val picks = dial.pick(want, seen, 0) { false }
        assertEquals(listOf(A to "aa00000000aa"), picks)
        assertTrue(dial.pick(want, seen, 0) { false }.isEmpty(), "no se insiste en la misma dirección antes de 30 s")

        // 4) el enlace de cliente queda listo (MTU y notificaciones): es de A y lo suyo sale ya
        val link = "out:aa00000000aa"
        ready.add(link); out.seed(link, A)
        assertEquals(1, out.pump())
        assertEquals(listOf("$link|msg_1"), written)
        assertTrue(out.wanting().isEmpty(), "ya tiene enlace: no se le busca más")

        // 5) A (dormido) guarda, avisa y confirma con su ✓✓ firmada, que llega por el mismo enlace (una notificación)
        val ack = JSONObject().put("v", 1).put("type", "ack").put("msgId", "msg_1").put("from", A).put("ts", 1).put("a", NetBg.ackMac(keyA, "ack|msg_1|$A|$ME")).toString()
        core.onBytes(link, ack.toByteArray(Charsets.UTF_8))
        assertEquals(0, bg.outbox.size(), "confirmado: fuera de la bandeja")
        assertTrue(bg.outbox.ridKeys().isEmpty(), "y la clave de sus códigos ya no se guarda")
        assertFalse(out.pending())
        assertEquals(-1L, dial.wakeInMs(out.wanting(), false), "sin nada que buscar no hay despertador")
    }

    @Test fun loQueYaEstaEnElBuzonDeInternetSeBuscaConCalmaYSinDespertador() {
        var t = 1_000_000L
        val bg = NetBg({ _, _, _, _, _, _ -> }, { })
        bg.outboxSet(listOf(NetOutbox.Item("msg_1", A, p("msg_1"), t)), "", "", mapOf(A to ridA), 900)
        val out = OutboxBle({ ME }, { bg }, { null }, object : OutboxBle.Link {
            override fun ready(mac: String) = false
            override fun send(mac: String, json: String) = false
            override fun log(msg: String) {}
        }) { t }
        val want = out.wanting()
        assertTrue(out.urgent(want), "sin aceptar por ningún relé: corre prisa")
        // un relé lo acepta: a salvo en el buzón (solo falta que el otro lo baje)
        bg.outbox.published("msg_1", "ev1", t); assertNotNull(bg.outbox.accepted("ev1", t))
        assertEquals(setOf(A), out.wanting(), "se le sigue buscando por Bluetooth (puede estar al lado y sin internet)")
        assertFalse(out.urgent(out.wanting()))
        val d = OutboxDial { t }
        assertEquals(-1L, d.wakeInMs(want, false), "sin despertador propio: lo repasa la alarma de vigilancia")
        assertFalse(d.scanDue(want, false)); t += OutboxDial.FIRST_MS
        assertTrue(d.scanDue(want, false))
        t += OutboxDial.SCAN_MS + 60_000L - 1; assertFalse(d.scanDue(want, false))
        t += 1; assertTrue(d.scanDue(want, false), "el segundo al minuto (con prisa serían 20 s)")
        assertEquals(listOf(60_000L, 120_000L, 240_000L, 480_000L, 900_000L, 900_000L), (1..6).map { OutboxDial.calmGapMs(it) }, "tope: cada 15 min")
        // con prisa: el despertador apunta al próximo escaneo, entre 15 s y 5 min
        val d2 = OutboxDial { t }
        assertFalse(d2.scanDue(want, true)); t += OutboxDial.FIRST_MS; assertTrue(d2.scanDue(want, true))
        assertEquals(OutboxDial.SCAN_MS + 20_000L, d2.wakeInMs(want, true))
        repeat(6) { t += 400_000L; assertTrue(d2.scanDue(want, true)) }
        assertEquals(OutboxDial.WAKE_MAX_MS, d2.wakeInMs(want, true))
        assertEquals(-1L, d2.wakeInMs(emptySet(), true))
    }

    @Test fun loAnunciadoSaleDeLosDatosDeFabricanteSoloSiEsDeNexoYBienFormado() {
        assertEquals("NXAB12CD34", AdvertisedId.fromManufacturerData(adv("NXAB12CD34")))
        assertEquals("Rabcdefghi", AdvertisedId.fromManufacturerData(adv("Rabcdefghi")))
        assertNull(AdvertisedId.fromManufacturerData(null))
        assertNull(AdvertisedId.fromManufacturerData(byteArrayOf(0x4E, 0x58)))
        assertNull(AdvertisedId.fromManufacturerData(byteArrayOf(0x4E, 0x59) + "NXAB12CD34".toByteArray()), "otra marca")
        assertNull(AdvertisedId.fromManufacturerData(adv("NX<script>")), "mal formado")
        assertNull(AdvertisedId.fromManufacturerData(adv("R".repeat(60))), "demasiado largo")
    }
}
