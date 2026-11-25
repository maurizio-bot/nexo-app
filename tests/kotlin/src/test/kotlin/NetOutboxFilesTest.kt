import com.nexo.ble.NetBgSaved
import com.nexo.ble.NetOutbox
import kotlin.test.*

/**
 * 3281 (remate de la fase 3; dueño 21-11: una foto de 201 KB estuvo 4,5 h ⏳ con internet en el servicio y llegó en 44 s al reabrir):
 * la bandeja de salida también lleva FOTOS y notas de voz pequeñas. La app las deja cifradas y partidas en trozos ya firmados; el
 * nativo sube los trozos y solo con TODOS guardados deja salir el aviso para el contacto.
 */
class NetOutboxFilesTest {
    private val A = "nxaaaaaaaa"
    private fun hex(c: Char, n: Int) = c.toString().repeat(n)
    private fun ev(i: Int, kind: Int = 1064, content: String = "QUJD".repeat(50)) =
        """{"id":"${String.format("%064x", i + 1)}","pubkey":"${hex('b', 64)}","created_at":1700000000,"kind":$kind,"tags":[["expiration","1700600000"]],"content":"$content","sig":"${hex('c', 128)}"}"""
    private fun file(id: String, n: Int, t: Long = 1_000L) = NetOutbox.Item(id, A, """{"v":1,"type":"chat","msgId":"$id","payload":{"text":"e2:puntero"}}""", t).also { it.chunks = NetOutbox.chunksOf((0 until n).map { ev(it) })!! }
    private fun text(id: String, t: Long = 1_000L) = NetOutbox.Item(id, A, """{"v":1,"type":"chat","msgId":"$id"}""", t)

    @Test fun elAvisoSoloSaleConTodosLosTrozosSubidosYDeATresALaVez() {
        val o = NetOutbox(); var t = 10_000L
        assertTrue(o.set(listOf(text("txt_1"), file("foto_1", 5)), t = t))
        assertEquals(listOf("txt_1"), o.due(t).map { it.id }, "el texto sale ya; el aviso de la foto espera a sus trozos")
        assertTrue(o.chunksDue(t).isEmpty(), "recién entregado: 20 s de margen por si la app sigue despierta y lo termina ella")
        t += NetOutbox.FILE_GRACE_MS
        val first = o.chunksDue(t)
        assertEquals(3, first.size, "de a tres")
        first.forEach { o.chunkSent(it, t) }
        assertTrue(o.chunksDue(t).isEmpty(), "con tres en vuelo no sale otro")
        // un relé guarda el primero: sale el siguiente
        assertNotNull(o.chunkAccepted(first[0].id)); assertNull(o.chunkAccepted(first[0].id), "repetido (otro relé): no cuenta dos veces")
        assertEquals(1, o.chunksDue(t).size)
        assertEquals(5 to 1, o.chunkState("foto_1"))
        // el resto
        o.chunksDue(t).forEach { o.chunkSent(it, t) }
        o.chunkAccepted(first[1].id); o.chunkAccepted(first[2].id)
        val rest = o.chunksDue(t); rest.forEach { o.chunkSent(it, t) }
        o.get("foto_1")!!.chunks.filter { !it.ok }.dropLast(1).forEach { o.chunkAccepted(it.id) }
        assertEquals(listOf("txt_1"), o.due(t).map { it.id }, "falta UN trozo: el aviso aún no sale")
        assertFalse(o.hasFor(A).not(), "(el texto sí cuenta para el Bluetooth)")
        assertEquals(listOf("txt_1"), o.bleDue(A, t).map { it.id }, "por Bluetooth tampoco sale el aviso de un archivo a medio subir")
        o.chunkAccepted(o.get("foto_1")!!.chunks.first { !it.ok }.id)
        assertEquals(listOf("txt_1", "foto_1"), o.due(t).map { it.id }, "todos guardados: ahora sí")
        assertEquals(listOf("txt_1", "foto_1"), o.bleDue(A, t).map { it.id })
    }

    @Test fun unTrozoSinRespuestaSeVuelveASubirYSiNingunReleLoGuardaSeDejaALaApp() {
        val o = NetOutbox(); var t = 10_000L
        o.set(listOf(file("foto_1", 1)), t = t - NetOutbox.FILE_GRACE_MS)
        val c = o.chunksDue(t).single(); o.chunkSent(c, t)
        t += 14_999L; assertTrue(o.chunksDue(t).isEmpty())
        t += 1L; assertEquals(1, o.chunksDue(t).size, "a los 15 s sin respuesta: otra vez")
        repeat(NetOutbox.CHUNK_MAX_TRIES - 1) { o.chunkSent(c, t); t += NetOutbox.chunkRetryMs(c.tries) }
        assertTrue(o.chunksDue(t).isEmpty(), "agotados los intentos no se insiste")
        assertEquals(listOf("foto_1"), o.chunkStuck(t).map { it.id }, "se deja para la app")
        assertEquals(listOf(15_000L, 30_000L, 60_000L, 120_000L, 300_000L), (1..5).map { NetOutbox.chunkRetryMs(it) })
    }

    @Test fun loQueMandaLaAppNuncaSeConfia() {
        assertNotNull(NetOutbox.chunkOf(ev(1)))
        assertNull(NetOutbox.chunkOf(ev(1, kind = 1059)), "solo eventos-trozo (no puede colar un mensaje a otro buzón)")
        assertNull(NetOutbox.chunkOf(ev(1, content = "")), "vacío")
        assertNull(NetOutbox.chunkOf(ev(1, content = "A".repeat(60_001))), "demasiado grande para un relé")
        assertNull(NetOutbox.chunkOf(ev(1).replace(hex('c', 128), "zz")), "sin firma")
        assertNull(NetOutbox.chunkOf("no es json")); assertNull(NetOutbox.chunkOf(null))
        assertNull(NetOutbox.chunksOf(emptyList()))
        assertNull(NetOutbox.chunksOf((0..NetOutbox.MAX_CHUNKS).map { ev(it) }), "más de 1 MB: lo manda la app")
        assertNull(NetOutbox.chunksOf(listOf(ev(1), ev(1))), "trozo repetido")
        assertNull(NetOutbox.chunksOf(listOf(ev(1), "{}")), "uno malo invalida el archivo entero")
        // como mucho 4 archivos a la vez; los textos no cuentan
        val o = NetOutbox()
        o.set((1..6).map { file("foto_$it", 1) } + text("txt_1"))
        assertEquals(listOf("foto_1", "foto_2", "foto_3", "foto_4", "txt_1"), o.ids())
    }

    @Test fun yaLoTienesSoloValeSiDeVerdadLoTiene() {
        val o = NetOutbox()
        o.set(listOf(file("foto_1", 2)))
        val c0 = o.get("foto_1")!!.chunks[0]; o.chunkSent(c0, 5_000L); o.chunkAccepted(c0.id)
        // la app vuelve a dar la lista sin repetir los trozos (stub): se conserva lo que había, con su avance
        val stub = NetOutbox.Item("foto_1", A, "{\"x\":1}", 1_000L).also { it.stub = 2 }
        o.set(listOf(stub, text("txt_1")))
        assertEquals(2 to 1, o.chunkState("foto_1"))
        // un stub de algo que NO se tiene (el proceso murió): no entra (la app lo vuelve a dar entero)
        val o2 = NetOutbox()
        o2.set(listOf(NetOutbox.Item("foto_9", A, "{\"x\":1}", 1_000L).also { it.stub = 2 }, text("txt_1")))
        assertEquals(listOf("txt_1"), o2.ids())
    }

    @Test fun seGuardaAparteYAlVolverSinLaAppSigueDondeIba() {
        val o = NetOutbox(); val t = 10_000L
        o.set(listOf(file("foto_1", 3), text("txt_1")))
        val c1 = o.get("foto_1")!!.chunks[1]; o.chunkSent(c1, t); o.chunkAccepted(c1.id)
        val json = o.toJson()
        assertFalse(json.contains("QUJD"), "los trozos no van en el archivo de la lista (son grandes)")
        val disk = o.chunkFiles().mapKeys { NetBgSaved.blobFile(it.key) }
        assertEquals(1, disk.size); assertTrue(disk.keys.single().matches(Regex("^nexo_netbg_blob_[0-9a-f]{24}\\.json$")))
        assertTrue(NetBgSaved.isFile(disk.keys.single()), "no viaja a otro teléfono y se borra con la cuenta")
        val stored = org.json.JSONArray(disk.values.single()).toString()
        // NEXO vuelve sola: lista + trozos guardados
        val o2 = NetOutbox()
        assertEquals(2, o2.load(json, t) { id -> NetBgSaved.blobFrom(if (NetBgSaved.blobFile(id) in disk) stored else null) })
        assertEquals(3 to 1, o2.chunkState("foto_1"))
        assertEquals(2, o2.chunksDue(t).size, "solo los dos que faltan")
        // sin sus trozos (archivo perdido o dañado) el archivo NO se carga: nunca saldría un aviso de algo que no se puede terminar
        val o3 = NetOutbox()
        assertEquals(1, o3.load(json, t) { null }); assertEquals(listOf("txt_1"), o3.ids())
        val o4 = NetOutbox()
        assertEquals(1, o4.load(json, t) { listOf(ev(7), ev(8), ev(9)) }, "trozos de otro archivo: tampoco")
        assertNull(NetBgSaved.blobFrom("basura")); assertNull(NetBgSaved.blobFrom(null))
    }
}
