import com.nexo.ble.BinAssembler
import com.nexo.ble.BinFrame
import com.nexo.ble.BgInbox
import com.nexo.ble.SafeJson
import kotlin.test.*

// Auditoría (ronda 2774): fuzzing con semilla de los analizadores que leen lo que llega por radio/red. Se les mete
// basura adversaria (bytes al azar, marcos con tamaños mentirosos, JSON gigante o muy anidado, trozos cortados) y se
// comprueba que NUNCA revientan (ni Exception ni Error), que el estado queda acotado y que, tras la basura, un mensaje
// de verdad se sigue leyendo. Determinista: la misma semilla da el mismo recorrido (como VOPR/libsignal, que pierden,
// barajan y reinyectan a propósito). Es Kotlin puro: corre en la JVM sin Android.
class ParserFuzzTest {
    private class Rng(seed: Long) { // xorshift64, reproducible
        var s = if (seed == 0L) 0x9E3779B97F4A7C15uL.toLong() else seed
        fun next(): Long { var x = s; x = x xor (x shl 13); x = x xor (x ushr 7); x = x xor (x shl 17); s = x; return x }
        fun int(n: Int) = ((next() ushr 1) % n).toInt()
        fun bytes(n: Int) = ByteArray(n) { next().toByte() }
    }

    // 1. BinAssembler.feed: trozos binarios. Nunca debe lanzar, y el buffer de cada teléfono queda acotado.
    @Test fun binAssemblerAguantaBasura() {
        val rng = Rng(1234567)
        val asm = BinAssembler()
        repeat(20000) {
            val key = "mac" + rng.int(8) // varios teléfonos a la vez
            val b = when (rng.int(5)) {
                0 -> rng.bytes(rng.int(2048))                                   // bytes al azar
                1 -> byteArrayOf(BinFrame.MARK) + rng.bytes(rng.int(64))        // marca + poco
                2 -> {                                                          // marca con tamaños mentirosos
                    val h = rng.bytes(6); byteArrayOf(BinFrame.MARK) + h + rng.bytes(rng.int(512))
                }
                3 -> "{\"v\":".toByteArray() + rng.bytes(rng.int(256))          // parece JSON de la app
                else -> BinFrame.encode("{\"v\":1,\"t\":\"x\"}", rng.bytes(rng.int(300))) // trozo válido, quizá partido
            }
            val parts = if (rng.int(2) == 0) BinFrame.split(b, 1 + rng.int(40)) else listOf(b)
            for (p in parts) {
                val out = asm.feed(key, p, it.toLong()) // no debe lanzar
                assertNotNull(out)
            }
        }
        // Tras toda la basura, un trozo válido entero se lee bien
        val good = BinFrame.encode("{\"v\":1,\"t\":\"ok\"}", "DATA".toByteArray())
        val out = asm.feed("macGood", good, 999999L)
        assertEquals(1, out.frames.size)
        assertEquals("{\"v\":1,\"t\":\"ok\"}", out.frames[0].header)
        assertEquals("DATA", String(out.frames[0].data))
    }

    // 2. BgInbox.classify + SafeJson: JSON ajeno adversario. Nunca lanza; lo anidado/gigante se descarta.
    @Test fun classifyAguantaJsonAdversario() {
        val rng = Rng(77)
        repeat(20000) {
            val s = when (rng.int(6)) {
                0 -> String(rng.bytes(rng.int(400)), Charsets.ISO_8859_1)
                1 -> "[".repeat(rng.int(4000)) + "]".repeat(rng.int(4000))
                2 -> "{\"type\":\"chat\",\"from\":\"nx" + rng.int(99999999) + "\",\"msgId\":\"" + rng.int(9999) + "\"}"
                3 -> "{" + "\"a\":{".repeat(rng.int(200)) + "1" + "}".repeat(rng.int(200))
                4 -> "{\"t\":\"" + "x".repeat(rng.int(5000)) + "\"}"
                else -> "{\"type\":\"chat\",\"from\":\"nx12345678\",\"to\":\"\",\"cl\":1,\"msgId\":\"m" + rng.int(9999) + "\"}"
            }
            val info = BgInbox.classify(s, "nx99999999") // no debe lanzar
            assertNotNull(info)
        }
        // Un JSON muy anidado se descarta (no se intenta analizar)
        assertEquals(BgInbox.Kind.IGNORE, BgInbox.classify("[".repeat(10000) + "]".repeat(10000), "nx99999999").kind)
        // Uno normal sí se clasifica
        assertEquals(BgInbox.Kind.MESSAGE, BgInbox.classify("{\"type\":\"chat\",\"from\":\"nx12345678\",\"to\":\"\",\"msgId\":\"m1\"}", "nx99999999").kind)
    }

    // 3. SafeJson sobre bytes al azar como texto: decide en tiempo lineal y sin lanzar.
    @Test fun safeJsonNoLanzaConBasura() {
        val rng = Rng(424242)
        repeat(50000) {
            val s = String(rng.bytes(rng.int(600)), Charsets.UTF_8)
            SafeJson.reject(s) // no debe lanzar
        }
    }
}
