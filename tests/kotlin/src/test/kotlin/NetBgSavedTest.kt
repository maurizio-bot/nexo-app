import com.nexo.ble.AccountMove
import com.nexo.ble.AtRestStore
import com.nexo.ble.FcmWakePolicy
import com.nexo.ble.NetBg
import com.nexo.ble.NetBgSaved
import com.nexo.ble.NetBgSaved.Notice
import com.nexo.ble.NetBgSaved.Start
import com.nexo.ble.Secp256k1
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import java.nio.file.Files
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import kotlin.test.*

/**
 * 3192 (#87, dueño 17-11 «Ok» a guardar cifrada la configuración): lo que la escucha de internet necesita para arrancar SIN la app
 * (NetBgSaved) se guarda con el cifrado en reposo de siempre (AtRestStore), no viaja al pasar la cuenta y se borra con ella; y las
 * decisiones: cuándo arranca sin la app, qué avisa, el aviso genérico del toque FCM.
 */
class NetBgSavedTest {
    private fun key(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val dirs = mutableListOf<File>()
    private fun tmp(): File = Files.createTempDirectory("nexo-netbg").toFile().also { dirs.add(it) }
    @AfterTest fun limpiar() { dirs.forEach { try { it.deleteRecursively() } catch (e: Exception) { } }; dirs.clear() }

    private val krawA = ByteArray(32) { (it * 7 + 3).toByte() }
    private val krawC = ByteArray(32) { (it * 11 + 5).toByte() }
    private val ackA = ByteArray(32) { (it * 5 + 1).toByte() }
    private fun cfg(since: Long = 1_700_000_000_000L) = NetBgSaved.Config("nxbbbbbbbb", listOf("wss://relay.uno.example/x", "wss://relay.dos.example"), since,
        listOf(NetBg.Contact("nxaaaaaaaa", "Ana María", krawA), NetBg.Contact("nxcccccccc", "Carlos", krawC)),
        mapOf("nxaaaaaaaa" to "Ana María", "nxdddddddd" to "Diego"), setOf("nxeeeeeeee"), 1_700_000_100_000L)
    private fun contains(f: File, s: String) = String(f.readBytes(), Charsets.ISO_8859_1).contains(s)

    // (a) Ida y vuelta por AtRestStore: en disco cifrado (ni mi ID, ni los relés, ni ningún secreto de pareja ni clave del ✓✓ en claro)
    @Test fun idaYVueltaCifradaSinNadaEnClaro() {
        val d = tmp(); val k = key()
        val st = AtRestStore(d) { k }; val w = NetBgSaved.Writer()
        assertTrue(NetBgSaved.saveConfig(st, w, cfg()))
        assertTrue(NetBgSaved.saveAck(st, w, mapOf("nxaaaaaaaa" to ackA)))
        for (name in listOf(NetBgSaved.CFG_FILE, NetBgSaved.ACK_FILE)) {
            val f = File(d, name)
            assertTrue(AtRestStore.isEncrypted(f.readBytes()), "$name cifrado en disco")
            for (s in listOf("nxbbbbbbbb", "nxaaaaaaaa", "nxcccccccc", "relay.uno", "relay.dos", "wss://", Secp256k1.hex(krawA), Secp256k1.hex(krawC),
                    Secp256k1.hex(ackA), "Ana", "Carlos", "Diego", "nxeeeeeeee")) assertFalse(contains(f, s), "«$s» no está en claro en $name")
        }
        // Otro proceso (otra instancia del almacén, la misma clave): lo lee entero
        val s = assertNotNull(NetBgSaved.load(AtRestStore(d) { k }))
        assertEquals("nxbbbbbbbb", s.cfg.me)
        assertEquals(listOf("wss://relay.uno.example/x", "wss://relay.dos.example"), s.cfg.relays)
        assertEquals(1_700_000_000_000L, s.cfg.since); assertEquals(1_700_000_100_000L, s.cfg.reqSince)
        assertEquals(listOf("nxaaaaaaaa", "nxcccccccc"), s.cfg.contacts.map { it.nx })
        assertEquals(listOf("Ana María", "Carlos"), s.cfg.contacts.map { it.name })
        assertContentEquals(krawA, s.cfg.contacts[0].kraw); assertContentEquals(krawC, s.cfg.contacts[1].kraw)
        assertEquals(mapOf("nxaaaaaaaa" to "Ana María", "nxdddddddd" to "Diego"), s.cfg.known)
        assertEquals(setOf("nxeeeeeeee"), s.cfg.reqOut)
        assertEquals(setOf("nxaaaaaaaa"), s.ack.keys); assertContentEquals(ackA, s.ack["nxaaaaaaaa"])
        // Con otra clave (otro teléfono / Keystore borrado) no se lee: lanza (NetBgHome: «no se pudo leer lo guardado»)
        assertFailsWith<IOException> { NetBgSaved.load(AtRestStore(d) { key() }) }
        // Sin configuración guardada: nada que arrancar
        assertNull(NetBgSaved.load(AtRestStore(tmp()) { k }))
    }

    // Solo se escribe si cambió (la app la manda cada vez que se oculta): el mismo texto no toca el disco
    @Test fun soloSiCambio() {
        val d = tmp(); val k = key(); val st = AtRestStore(d) { k }; val w = NetBgSaved.Writer()
        assertTrue(NetBgSaved.saveConfig(st, w, cfg()))
        val before = File(d, NetBgSaved.CFG_FILE).readBytes()
        assertFalse(NetBgSaved.saveConfig(st, w, cfg()), "lo mismo: no se escribe")
        assertContentEquals(before, File(d, NetBgSaved.CFG_FILE).readBytes(), "el archivo no cambió (cada escritura lleva un IV nuevo)")
        assertTrue(NetBgSaved.saveConfig(st, w, cfg(since = 1_700_000_500_000L)), "otro «desde cuándo»: se escribe")
        assertEquals(1_700_000_500_000L, NetBgSaved.load(st)!!.cfg.since)
        assertTrue(NetBgSaved.saveAck(st, w, mapOf("nxaaaaaaaa" to ackA)))
        assertFalse(NetBgSaved.saveAck(st, w, mapOf("nxaaaaaaaa" to ackA.copyOf())), "mismas claves: no se escribe")
        w.forget()
        assertTrue(NetBgSaved.saveAck(st, w, mapOf("nxaaaaaaaa" to ackA)), "tras borrar la cuenta (forget) la próxima se escribe")
    }

    // Sin cifrado en reposo en ese teléfono (sin Keystore): lo mismo que los demás archivos de NEXO (en claro), y la migración lo cifra
    // en cuanto hay clave (empieza por «nexo_»); un archivo cifrado sin clave no se sobrescribe ni se lee
    @Test fun sinClaveComoLosDemasArchivos() {
        val d = tmp(); var k: SecretKey? = null
        val st = AtRestStore(d) { k }.apply { migrateOnly = { it.startsWith("nexo_") } }
        NetBgSaved.saveConfig(st, NetBgSaved.Writer(), cfg())
        assertFalse(AtRestStore.isEncrypted(File(d, NetBgSaved.CFG_FILE).readBytes()), "sin clave, en claro (como contactos y ratchet)")
        assertEquals("nxbbbbbbbb", NetBgSaved.load(st)!!.cfg.me)
        k = key()
        assertEquals(1, st.migrateAll(), "la migración de siempre lo cifra")
        assertTrue(AtRestStore.isEncrypted(File(d, NetBgSaved.CFG_FILE).readBytes()))
        assertEquals("nxbbbbbbbb", NetBgSaved.load(st)!!.cfg.me)
        k = null
        assertFailsWith<IOException> { NetBgSaved.saveConfig(st, NetBgSaved.Writer(), cfg(5L)) }
        assertFailsWith<IOException> { NetBgSaved.load(st) }
    }

    // Lo que manda la app se lee como lo leía netBgConfigImpl (falta me / configuración ilegible; known y reqOut mal formados se ignoran)
    @Test fun loQueMandaLaAppComoAntes() {
        val o = JSONObject("""{"me":"nxbbbbbbbb","relays":["wss://r.example"],"since":123,"reqSince":45,
            "contacts":[{"nx":"NXAAAAAAAA","name":"Ana","kraw":"${Secp256k1.hex(krawA)}"}],
            "known":[{"nx":"nxaaaaaaaa","name":"Ana"},5,{"nx":""}],"reqOut":["NXEEEEEEEE",""]}""")
        val c = NetBgSaved.fromApp(o)
        assertEquals("nxbbbbbbbb", c.me); assertEquals(listOf("wss://r.example"), c.relays); assertEquals(123L, c.since); assertEquals(45L, c.reqSince)
        assertEquals("nxaaaaaaaa", c.contacts.single().nx); assertContentEquals(krawA, c.contacts.single().kraw)
        assertEquals(mapOf("nxaaaaaaaa" to "Ana"), c.known); assertEquals(setOf("nxeeeeeeee"), c.reqOut)
        assertEquals("falta me", assertFailsWith<NetBgSaved.BadConfig> { NetBgSaved.fromApp(JSONObject("""{"relays":[]}""")) }.message)
        assertEquals("configuración ilegible", assertFailsWith<NetBgSaved.BadConfig> { NetBgSaved.fromApp(JSONObject("""{"me":"nxbbbbbbbb","contacts":[{"nx":"nxaaaaaaaa","kraw":"zz"}]}""")) }.message)
        assertEquals("configuración ilegible", assertFailsWith<NetBgSaved.BadConfig> { NetBgSaved.fromApp(JSONObject("""{"me":"nxbbbbbbbb","contacts":[{"nx":"nxaaaaaaaa"}]}""")) }.message)
    }

    // Lo guardado que no cuadra no arranca nada (o se salta esa parte)
    @Test fun loGuardadoRaroNoArranca() {
        assertNull(NetBgSaved.configFrom("no es json"))
        assertNull(NetBgSaved.configFrom("""{"me":"nxbbbbbbbb","relays":[]}"""), "sin relés")
        assertNull(NetBgSaved.configFrom("""{"me":"yo","relays":["wss://r"]}"""), "sin mi ID")
        assertNull(NetBgSaved.configFrom("{" + "[".repeat(5000)), "JSON descomunal/anidado")
        val c = assertNotNull(NetBgSaved.configFrom("""{"me":"nxbbbbbbbb","relays":["wss://r","http://x","ws://127.0.0.1:1"],"contacts":[{"nx":"nxaaaaaaaa","kraw":"0g"},{"nx":"x","kraw":"00"},{"nx":"nxcccccccc","kraw":"${Secp256k1.hex(krawC)}"}]}"""))
        assertEquals(listOf("wss://r", "ws://127.0.0.1:1"), c.relays)
        assertEquals(listOf("nxcccccccc"), c.contacts.map { it.nx }, "un contacto con el secreto roto se salta")
        assertTrue(NetBgSaved.ackFrom("""{"keys":[{"nx":"nxaaaaaaaa","key":"xyz"}]}""").isEmpty())
        assertTrue(NetBgSaved.ackFrom("basura").isEmpty())
    }

    // (b) Se borra con la cuenta y no viaja al pasarla a otro teléfono (la app del nuevo la escribe al abrirse)
    @Test fun seBorraConLaCuentaYNoViaja() {
        val skip = setOf("nexo_nxid_mac_map.json")
        for (n in listOf(NetBgSaved.CFG_FILE, NetBgSaved.ACK_FILE, NetBgSaved.CFG_FILE + ".nxtmp")) assertFalse(AccountMove.travels(n, skip), "$n no viaja")
        assertTrue(AccountMove.travels("nexo_vault_contacts.json", skip))
        // Teléfono viejo: la cuenta con lo de la escucha sin la app
        val dA = tmp(); val kA = key(); val sA = AtRestStore(dA) { kA }
        sA.write("nexo_advertising_id.json", "{\"nexoId\":\"nxbbbbbbbb\"}")
        sA.write("nexo_vault_contacts.json", "[]")
        NetBgSaved.saveConfig(sA, NetBgSaved.Writer(), cfg()); NetBgSaved.saveAck(sA, NetBgSaved.Writer(), mapOf("nxaaaaaaaa" to ackA))
        val pack = ByteArrayOutputStream()
        val st = AccountMove.export(dA, skip, { sA.read(it) }, null, pack)
        assertEquals(2, st.files, "viajan el NEXO ID y los contactos; lo de la escucha, no")
        assertFalse(String(pack.toByteArray(), Charsets.ISO_8859_1).contains(Secp256k1.hex(krawA)), "ningún secreto de pareja en el paquete")
        // Teléfono nuevo: tenía lo suyo de antes (otra cuenta); wipe lo borra (también lo de la escucha) y la importación no lo trae
        val dB = tmp(); val kB = key(); val sB = AtRestStore(dB) { kB }
        NetBgSaved.saveConfig(sB, NetBgSaved.Writer(), cfg()); NetBgSaved.saveAck(sB, NetBgSaved.Writer(), mapOf("nxaaaaaaaa" to ackA))
        File(dB, NetBgSaved.CFG_FILE + ".nxtmp").writeText("x")
        AccountMove.wipe(dB, skip, null)
        assertTrue(dB.listFiles()!!.none { NetBgSaved.isFile(it.name) }, "wipe borra la configuración guardada (y su temporal)")
        AccountMove.import(ByteArrayInputStream(pack.toByteArray()), skip, { n, txt -> sB.write(n, txt) }, File(dB, "nexo_big"))
        assertNull(NetBgSaved.load(sB), "no llega del teléfono viejo: la escribe la app del nuevo")
        // El viejo, tras pasarla, la borra (con la escucha guardada incluida)
        AccountMove.wipe(dA, skip, null)
        assertNull(NetBgSaved.load(sA)); assertNull(sA.read(NetBgSaved.ACK_FILE))
        // Un paquete con la configuración de la escucha dentro (alguien que lo fabrica) se rechaza entero
        val evil = ByteArrayOutputStream(); DataOutputStream(evil).apply {
            writeUTF(AccountMove.MAGIC); val b = NetBgSaved.configJson(cfg()).toByteArray()
            writeByte(1); writeUTF(NetBgSaved.CFG_FILE); writeInt(b.size); write(b); writeByte(0); flush()
        }
        assertFailsWith<IOException> { AccountMove.import(ByteArrayInputStream(evil.toByteArray()), skip, { n, txt -> sB.write(n, txt) }, File(dB, "nexo_big")) }
        assertNull(NetBgSaved.load(sB))
    }

    // Cuándo arranca la escucha sin la app (servicio o toque FCM). Lo guardado solo se lee si hace falta.
    @Test fun cuandoArrancaSinLaApp() {
        var reads = 0
        val c = cfg()
        fun saved(x: NetBgSaved.Config?) = { reads++; x }
        val me = { "nxbbbbbbbb" as String? }
        assertEquals(Start.APP_ALIVE, NetBgSaved.startStep(true, false, saved(c), me), "con la app viva la maneja ella")
        assertEquals(Start.ALREADY, NetBgSaved.startStep(false, true, saved(c), me), "ya escucha (una por proceso): no otra")
        assertEquals(0, reads, "sin leer el disco")
        assertEquals(Start.NO_CONFIG, NetBgSaved.startStep(false, false, saved(null), me), "sin nada guardado (como hasta la 3191)")
        assertEquals(Start.OTHER_ACCOUNT, NetBgSaved.startStep(false, false, saved(c), { "nxzzzzzzzz" }), "guardado de otra cuenta")
        assertEquals(Start.OTHER_ACCOUNT, NetBgSaved.startStep(false, false, saved(c), { null }), "sin cuenta en el teléfono")
        assertEquals(Start.START, NetBgSaved.startStep(false, false, saved(c), me))
        assertEquals("nxbbbbbbbb", NetBgSaved.accountIdOf("{\"nexoId\":\"NXBBBBBBBB\",\"createdAt\":1}"))
        assertNull(NetBgSaved.accountIdOf("{\"id\":\"nxbbbbbbbb\"}")); assertNull(NetBgSaved.accountIdOf("x")); assertNull(NetBgSaved.accountIdOf(null))
        assertTrue(NetBgSaved.listening(Start.APP_ALIVE, false)); assertTrue(NetBgSaved.listening(Start.ALREADY, false))
        assertTrue(NetBgSaved.listening(Start.START, true)); assertFalse(NetBgSaved.listening(Start.START, false))
        assertFalse(NetBgSaved.listening(Start.NO_CONFIG, false)); assertFalse(NetBgSaved.listening(Start.OTHER_ACCOUNT, false))
        assertEquals("un reinicio del teléfono", NetBgSaved.why("un reinicio del teléfono", true, false), "la vuelta sola (3189) trae su motivo")
        assertEquals("un toque FCM", NetBgSaved.why(null, true, false))
        assertEquals("un reinicio del servicio por Android", NetBgSaved.why(null, false, true))
        assertEquals("Internet sin la app: escuchando 2 contacto(s) en 3 relé(s) (tras un toque FCM)", NetBgSaved.startLine(2, 3, "un toque FCM"))
    }

    // (d) El toque FCM: sin servicio, o sin nadie que escuche internet (nada guardado / no arrancó), el aviso genérico; si escucha, no
    @Test fun avisoDelToqueFcm() {
        assertFalse(FcmWakePolicy.noticeAfterWake(true, true), "escucha: el aviso lo pone el mensaje al llegar")
        assertTrue(FcmWakePolicy.noticeAfterWake(true, false), "proceso nuevo sin configuración guardada: aviso genérico")
        assertTrue(FcmWakePolicy.noticeAfterWake(false, true), "sin servicio no baja nada")
        assertTrue(FcmWakePolicy.noticeAfterWake(false, false))
        // Los casos tal como los decide NexoFcmService
        fun toque(started: Boolean, step: Start, ok: Boolean) = FcmWakePolicy.noticeAfterWake(started, started && NetBgSaved.listening(step, ok))
        assertFalse(toque(true, Start.APP_ALIVE, false), "app viva (como siempre): sin aviso")
        assertFalse(toque(true, Start.START, true), "proceso muerto con lo guardado: escucha, sin aviso")
        assertTrue(toque(true, Start.START, false), "no pudo arrancar: aviso")
        assertTrue(toque(true, Start.NO_CONFIG, false), "nada guardado (antes: sin aviso y sin escuchar)")
        assertTrue(toque(true, Start.OTHER_ACCOUNT, false))
    }

    // Lo que se avisa de un sobre nuevo: las mismas reglas con la app viva y sin ella; las ofertas viejas ya no suenan
    @Test fun queSeAvisa() {
        assertEquals(Notice.CALL, NetBgSaved.notice(true, false, true, true), "una llamada suena aunque el chat esté abierto")
        assertEquals(Notice.OLD, NetBgSaved.notice(false, true, false, false), "reenvío de algo que ya está: sin aviso (3008)")
        assertEquals(Notice.OPEN_CHAT, NetBgSaved.notice(false, false, true, true), "chat abierto en un parpadeo (3172)")
        assertEquals(Notice.GROUP, NetBgSaved.notice(false, false, false, true))
        assertEquals(Notice.CHAT, NetBgSaved.notice(false, false, false, false))
        val now = 1_800_000_000_000L
        assertFalse(NetBgSaved.callTooOld(now - 30_000, now)); assertFalse(NetBgSaved.callTooOld(now - 600_000, now))
        assertTrue(NetBgSaved.callTooOld(now - 600_001, now), "más de 10 min (calls.js OFFER_MAX_AGE_MS)")
        assertFalse(NetBgSaved.callTooOld(now + 120_000, now), "reloj del otro adelantado: suena")
        assertFalse(NetBgSaved.callTooOld(0, now), "sin fecha: suena")
        assertEquals(mapOf("grabcdefgh" to "Familia"), NetBgSaved.groupNames("""{"groups":{"GRABCDEFGH":{"name":"Familia"},"gr00000000":{"name":""}}}"""))
        assertTrue(NetBgSaved.groupNames(null).isEmpty())
        assertFailsWith<Exception> { NetBgSaved.groupNames("no") }
    }

    // El cableado en el código de Android (sin SDK aquí: se mira el fuente, como RestartPolicyTest mira el manifiesto)
    @Test fun cableadoEnAndroid() {
        var d: File? = File(System.getProperty("user.dir")).absoluteFile
        while (d != null && !File(d, "plugins/nexo-ble/android/src/main/java/com/nexo/ble").isDirectory) d = d.parentFile
        val src = File(assertNotNull(d), "plugins/nexo-ble/android/src/main/java/com/nexo/ble")
        fun code(f: String) = File(src, f).readText().lines().filter { !it.trim().startsWith("//") }.joinToString("\n")
        val svc = code("BleService.kt"); val fcm = code("NexoFcmService.kt"); val bg = code("PluginBackground.kt"); val pl = code("NexoBlePlugin.kt")
        assertTrue(svc.contains("NetBgHome.startWithoutApp(") && svc.contains("NetBgHome.stopWithoutApp("), "el servicio arranca la escucha sin la app (y la para)")
        assertTrue(fcm.contains("NetBgHome.startWithoutApp(") && fcm.contains("FcmWakePolicy.noticeAfterWake(started, canListen)"), "el toque FCM")
        assertTrue(bg.contains("NetBgHome.get(") && !bg.contains("NetBg({"), "la app usa la MISMA escucha (no crea otra)")
        assertTrue(bg.contains("NetBgHome.saveConfig(") && bg.contains("NetBgHome.saveAck("), "se guarda lo que manda la app")
        assertTrue(pl.contains("NetBgHome.appTookOver(") && pl.contains("NetBgHome.peek()"), "relevo al cargar la app")
        assertTrue(code("PluginMove.kt").split("NetBgHome.forget(").size == 3, "tras cada borrado de la cuenta al pasarla")
        assertFalse(code("NetBgHome.kt").contains("kraw") || code("NetBgSaved.kt").contains("log("), "ningún secreto al registro")
    }
}
