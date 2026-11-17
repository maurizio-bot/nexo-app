import com.nexo.ble.NetBg
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.*

/**
 * 3190 (dueño 17-11): suscripción de NetBg a MI buzón de solicitudes, con la API de siempre (configure de 4 parámetros, drainForApp),
 * para poder correrla también contra el NetBg de antes (contraprueba: ahí NetBg no escucha el buzón y, sin contactos por internet, ni
 * arranca). Un relé local que exige identificarse (NIP-42); la solicitud la hace el código REAL de la app (netbg_helper.mjs).
 *  - sin contactos por internet (alguien nuevo que espera solicitudes): NetBg arranca y la solicitud queda guardada para la app;
 *  - con un contacto: lo mismo (antes solo oía las etiquetas de sus contactos).
 */
class NetBgReqSubTest {
    private val helper = File("netbg_helper.mjs").absoluteFile

    private fun keptAfterRequest(contacts: List<NetBg.Contact>): List<JSONObject> {
        val p = ProcessBuilder(listOf("node", helper.path, "relay")).redirectError(ProcessBuilder.Redirect.INHERIT).start()
        val rd = BufferedReader(InputStreamReader(p.inputStream))
        val url = rd.readLine().removePrefix("URL ").trim()
        val lines = CopyOnWriteArrayList<String>()
        Thread { try { while (true) { val l = rd.readLine() ?: break; lines.add(l) } } catch (e: Exception) { } }.apply { isDaemon = true; start() }
        val w = p.outputStream.bufferedWriter()
        try {
            val bg = NetBg({ _, _, _, _, _, _ -> })
            bg.configure("nxbbbbbbbb", listOf(url), System.currentTimeMillis() - 600_000, contacts)
            bg.start()
            Thread.sleep(1500)
            w.write("{\"req\":{\"from\":\"nxaaaaaaaa\",\"to\":\"nxbbbbbbbb\",\"t\":\"req\",\"name\":\"Luis\"}}\n"); w.flush()
            val t0 = System.currentTimeMillis()
            while (lines.none { it.startsWith("PUBLISHED ") } && System.currentTimeMillis() - t0 < 10000) Thread.sleep(100)
            assertTrue(lines.any { it.startsWith("PUBLISHED ") }, "el relé no guardó la solicitud: $lines")
            Thread.sleep(1500)
            val kept = bg.drainForApp().map { JSONObject(it) }
            bg.stop()
            return kept
        } finally { try { w.close() } catch (e: Exception) { }; p.destroy() }
    }

    @Test fun sinContactosPorInternetEscuchaElBuzon() {
        val kept = keptAfterRequest(emptyList())
        assertEquals(1, kept.size, "la solicitud queda para la app (NetBg escuchó el buzón sin contactos)")
    }

    @Test fun conUnContactoTambienEscuchaElBuzon() {
        val kept = keptAfterRequest(listOf(NetBg.Contact("nxcccccccc", "Ana", ByteArray(32) { (it * 3 + 1).toByte() })))
        assertEquals(1, kept.size, "la solicitud queda para la app")
        assertEquals(1059, kept[0].getInt("kind"))
    }
}
