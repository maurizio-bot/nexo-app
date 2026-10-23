import com.nexo.ble.BinAssembler
import com.nexo.ble.BinFrame
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Trozos binarios por Bluetooth (BinFrame): partir en escrituras, juntar y convivir con los mensajes de texto
class BinFrameTest {
    private val header = """{"v":2,"t":"f","m":"f_1","i":3,"n":9,"k":"abc"}"""

    @Test fun idaYVueltaConCualquierMtu() {
        val rnd = Random(7)
        for (mtu in listOf(23, 27, 100, 185, 247, 512)) {
            val data = rnd.nextBytes(rnd.nextInt(1, 600))
            val a = BinAssembler()
            val writes = BinFrame.split(BinFrame.encode(header, data), mtu - 3)
            assertTrue(writes.all { it.size <= mtu - 3 })
            val got = writes.flatMap { a.feed("m", it, 0).frames }
            assertEquals(1, got.size, "MTU $mtu")
            assertEquals(header, got[0].header)
            assertContentEquals(data, got[0].data)
            assertFalse(a.pending("m"))
        }
    }

    @Test fun elTextoDeSiemprePasaTalCual() {
        val a = BinAssembler()
        val txt = """{"v":1,"type":"ping"}""".toByteArray()
        val out = a.feed("m", txt, 0)
        assertTrue(out.frames.isEmpty())
        assertContentEquals(txt, out.text)
        // Texto después de un trozo binario completo
        BinFrame.split(BinFrame.encode(header, ByteArray(300) { it.toByte() }), 100).forEach { a.feed("m", it, 0) }
        assertContentEquals(txt, a.feed("m", txt, 0).text)
    }

    @Test fun datosQueParecenJsonNoConfunden() {
        // Los datos binarios pueden llevar '{' y comillas: dentro de un trozo no se leen como texto
        val data = """{"type":"chat","x":"}}}""".toByteArray() + ByteArray(200) { 0x7b }
        val a = BinAssembler()
        val outs = BinFrame.split(BinFrame.encode(header, data), 20).map { a.feed("m", it, 0) }
        assertTrue(outs.all { it.text == null })
        assertContentEquals(data, outs.flatMap { it.frames }.single().data)
    }

    @Test fun cadaTelefonoPorSeparado() {
        val a = BinAssembler()
        val w1 = BinFrame.split(BinFrame.encode(header, ByteArray(100) { 1 }), 30)
        val w2 = BinFrame.split(BinFrame.encode(header, ByteArray(100) { 2 }), 30)
        val got = mutableListOf<Pair<String, BinAssembler.Frame>>()
        for (k in 0 until maxOf(w1.size, w2.size)) {
            if (k < w1.size) a.feed("aa", w1[k], 0).frames.forEach { got.add("aa" to it) }
            if (k < w2.size) a.feed("bb", w2[k], 0).frames.forEach { got.add("bb" to it) }
        }
        assertEquals(2, got.size)
        assertTrue(got.first { it.first == "aa" }.second.data.all { it == 1.toByte() })
        assertTrue(got.first { it.first == "bb" }.second.data.all { it == 2.toByte() })
    }

    @Test fun unTrozoCortadoSeDescartaYLoSiguienteLlega() {
        val a = BinAssembler(timeoutMs = 4000)
        val w = BinFrame.split(BinFrame.encode(header, ByteArray(300)), 100)
        a.feed("m", w[0], 1000)
        assertTrue(a.pending("m"))
        // Desconexión: el resto no llega. 5 s después llega otro trozo entero
        val data = Random(1).nextBytes(250)
        val outs = BinFrame.split(BinFrame.encode(header, data), 100).map { a.feed("m", it, 6000) }
        assertEquals(1, outs[0].dropped)
        assertContentEquals(data, outs.flatMap { it.frames }.single().data)
        // Y un texto tras un corte también pasa
        a.feed("m", w[0], 7000)
        val t = a.feed("m", "{}".toByteArray(), 20000)
        assertContentEquals("{}".toByteArray(), t.text)
    }

    @Test fun trozoSinFinalNoArrastraLoSiguiente() {
        // El emisor descartó el resto de un trozo (no pudo escribir): llega otro trozo entero y luego un texto
        val a = BinAssembler()
        val roto = BinFrame.split(BinFrame.encode(header, ByteArray(400) { 9 }), 100)
        a.feed("m", roto[0], 0); a.feed("m", roto[1], 0)
        val data = Random(3).nextBytes(300)
        val outs = BinFrame.split(BinFrame.encode(header, data), 100).map { a.feed("m", it, 10) }
        assertEquals(1, outs[0].dropped)
        assertContentEquals(data, outs.flatMap { it.frames }.single().data)
        a.feed("m", roto[0], 20)
        val t = """{"v":2,"t":"ba","m":"x"}""".toByteArray()
        val out = a.feed("m", t, 30)
        assertEquals(1, out.dropped)
        assertContentEquals(t, out.text)
        // Datos que empiezan por 0x01 en mitad de un trozo no lo cortan
        val raro = ByteArray(300) { if (it % 100 == 0) 1 else 5 }
        assertContentEquals(raro, BinFrame.split(BinFrame.encode(header, raro), 100).flatMap { a.feed("q", it, 0).frames }.single().data)
    }

    @Test fun cabeceraRotaNoBloquea() {
        val a = BinAssembler()
        val bad = byteArrayOf(1, 0x7f, 0x7f, 0, 0, 0, 1)
        val out = a.feed("m", bad, 0)
        assertEquals(1, out.dropped)
        assertFalse(a.pending("m"))
        assertNull(a.feed("m", BinFrame.encode(header, ByteArray(5)), 0).text)
    }

    @Test fun cabeceraConAcentos() {
        val h = """{"fn":"canción ñ 📷.jpg","i":0}"""
        val a = BinAssembler()
        val got = BinFrame.split(BinFrame.encode(h, ByteArray(10)), 20).flatMap { a.feed("m", it, 0).frames }
        assertEquals(h, got.single().header)
    }
}
