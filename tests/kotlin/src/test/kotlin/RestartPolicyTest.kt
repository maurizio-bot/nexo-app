import com.nexo.ble.NetBg
import com.nexo.ble.RestartPolicy
import com.nexo.ble.RestartPolicy.Reason
import com.nexo.ble.RestartPolicy.Step
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// 3189 (diagnósticos tableta SM-T220 y S24 17-11 04:46, #87): la tableta del dueño tenía NEXO en segundo plano; a las 23:56 Google
// Play actualizó Android System WebView, Android mató el proceso y NEXO no volvió hasta que el dueño la abrió a mano a las 04:46
// (casi 5 h sin recibir). Ahora vuelve sola (NexoRestartReceiver) tras una actualización de NEXO, un reinicio o la alarma de vigilancia.
class RestartPolicyTest {
    private val ns = "http://schemas.android.com/apk/res/android"

    private fun repo(): File {
        var d: File? = File(System.getProperty("user.dir")).absoluteFile
        while (d != null && !File(d, "android/app/src/main/AndroidManifest.xml").isFile) d = d.parentFile
        return assertNotNull(d, "no encuentro la raíz del repositorio desde ${System.getProperty("user.dir")}")
    }

    @Test fun queAvisosLaHacenVolver() {
        assertEquals(Reason.UPDATE, RestartPolicy.reasonOf("android.intent.action.MY_PACKAGE_REPLACED"), "actualización de NEXO sin abrirla")
        assertEquals(Reason.BOOT, RestartPolicy.reasonOf("android.intent.action.BOOT_COMPLETED"), "reinicio (tras desbloquear)")
        assertEquals(Reason.WATCHDOG, RestartPolicy.reasonOf(RestartPolicy.ACTION_WATCHDOG), "la alarma de vigilancia")
        assertNull(RestartPolicy.reasonOf("android.intent.action.LOCKED_BOOT_COMPLETED"), "antes de desbloquear los datos siguen cifrados: no")
        assertNull(RestartPolicy.reasonOf("android.intent.action.PACKAGE_REPLACED"), "la actualización de OTRA app no")
        assertNull(RestartPolicy.reasonOf(null))
        assertNull(RestartPolicy.reasonOf(""))
        // el motivo viaja al servicio por su nombre
        for (r in Reason.values()) assertEquals(r, RestartPolicy.reasonByName(r.name))
        assertNull(RestartPolicy.reasonByName(null), "arranque normal (la app o el toque FCM): sin motivo")
        assertNull(RestartPolicy.reasonByName("boot"))
    }

    @Test fun soloConNexoConfiguradaYSoloSiEstabaMuerta() {
        assertEquals(Step.START, RestartPolicy.step(configured = true, alive = false), "la tableta a las 23:56: proceso muerto → arrancar")
        assertEquals(Step.REARM, RestartPolicy.step(configured = true, alive = true), "servicio o app vivos: solo la próxima alarma")
        assertEquals(Step.STOP, RestartPolicy.step(configured = false, alive = false), "recién instalada, sin cuenta: nada (y se cancela)")
        assertEquals(Step.STOP, RestartPolicy.step(configured = false, alive = true), "cuenta pasada a otro teléfono: se cancela")
        assertTrue(RestartPolicy.configured(true, 120))
        assertFalse(RestartPolicy.configured(false, 0), "sin NEXO ID guardado")
        assertFalse(RestartPolicy.configured(true, 0), "archivo vacío: no hay cuenta")
    }

    @Test fun alarmaInexactaCadaQuinceMinutos() {
        assertEquals(15 * 60_000L, RestartPolicy.INTERVAL_MS)
        assertEquals(1_000L + 15 * 60_000L, RestartPolicy.nextAt(1_000L))
        // un día entero sin poder volver (p. ej. sin la exención de batería): 96 alarmas, solo 7 líneas en el registro (1, 2, 4… 64)
        val alarmas = (24 * 60 * 60_000L / RestartPolicy.INTERVAL_MS).toInt()
        assertEquals(96, alarmas)
        assertEquals(listOf(1, 2, 4, 8, 16, 32, 64), (1..alarmas).filter { NetBg.logFailedTry(it) })
    }

    @Test fun alVolverSoloDispositivoConectado() {
        // Android 15: un servicio arrancado por BOOT_COMPLETED no puede ser de micrófono (ni dataSync, camera, mediaPlayback,
        // phoneCall, mediaProjection); el micrófono lo añade la llamada cuando hace falta
        for (r in Reason.values()) {
            assertEquals(setOf("connectedDevice"), RestartPolicy.fgsTypes(r), r.name)
            assertTrue((RestartPolicy.fgsTypes(r) intersect RestartPolicy.BOOT_FORBIDDEN_TYPES).isEmpty(), r.name)
            assertFalse(RestartPolicy.micAllowed(r), r.name)
        }
        assertTrue(RestartPolicy.micAllowed(null), "arranque normal: la llamada sigue pudiendo pedir micrófono")
        assertTrue("microphone" in RestartPolicy.BOOT_FORBIDDEN_TYPES)
    }

    // Contraprueba (con el código de antes falla: no había receptor ni permiso de arranque)
    @Test fun elManifiestoRegistraElReceptor() {
        val doc = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }.newDocumentBuilder()
            .parse(File(repo(), "android/app/src/main/AndroidManifest.xml"))
        val perms = doc.getElementsByTagName("uses-permission").let { l -> (0 until l.length).map { (l.item(it) as org.w3c.dom.Element).getAttributeNS(ns, "name") } }
        assertTrue("android.permission.RECEIVE_BOOT_COMPLETED" in perms, "falta el permiso de arranque")
        assertFalse(perms.any { it.endsWith(".SCHEDULE_EXACT_ALARM") || it.endsWith(".USE_EXACT_ALARM") }, "la alarma es inexacta: sin permiso de alarmas exactas")
        val receivers = doc.getElementsByTagName("receiver").let { l -> (0 until l.length).map { l.item(it) as org.w3c.dom.Element } }
        val rx = receivers.firstOrNull { it.getAttributeNS(ns, "name") == "com.nexo.ble.NexoRestartReceiver" }
        assertNotNull(rx, "falta el receptor NexoRestartReceiver")
        assertEquals("false", rx.getAttributeNS(ns, "exported"), "no exportado: lo llaman el sistema y la alarma de NEXO")
        assertFalse(rx.getAttributeNS(ns, "directBootAware") == "true", "antes de desbloquear los datos siguen cifrados")
        val actions = rx.getElementsByTagName("action").let { l -> (0 until l.length).map { (l.item(it) as org.w3c.dom.Element).getAttributeNS(ns, "name") } }
        assertEquals(setOf("android.intent.action.BOOT_COMPLETED", "android.intent.action.MY_PACKAGE_REPLACED"), actions.toSet())
        for (a in actions) assertNotNull(RestartPolicy.reasonOf(a), "el receptor atiende $a")
        // el servicio al que vuelve puede ser de «dispositivo conectado» (lo único que pide al volver)
        val svc = doc.getElementsByTagName("service").let { l -> (0 until l.length).map { l.item(it) as org.w3c.dom.Element } }
            .first { it.getAttributeNS(ns, "name") == "com.nexo.ble.BleService" }
        assertTrue("connectedDevice" in svc.getAttributeNS(ns, "foregroundServiceType").split("|"))
        // la clase existe en el plugin y usa la alarma inexacta
        val src = File(repo(), "plugins/nexo-ble/android/src/main/java/com/nexo/ble/NexoRestartReceiver.kt").readText()
        assertTrue("setAndAllowWhileIdle" in src && "setExact" !in src)
    }

    // «Configurada» mira el MISMO archivo en el que la app guarda el NEXO ID (si alguien lo renombra en la app, esto avisa)
    @Test fun elArchivoDelNexoIdEsElDeLaApp() {
        val name = RestartPolicy.NEXO_ID_FILE
        assertTrue(File(repo(), "src/ui/ble_helpers.js").readText().contains("BLE_NEXO_ID_VAULT_FILE = '$name'"), "ble_helpers.js")
        assertTrue(File(repo(), "src/fenix/fenix.js").readText().contains("NEXO_ID_FILE = '$name'"), "fenix.js (cuenta recuperada)")
    }
}
