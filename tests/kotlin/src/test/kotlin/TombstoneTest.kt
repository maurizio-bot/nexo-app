import com.nexo.ble.ExitReasons
import kotlin.test.*

/** Dueño 23-11: del volcado protobuf de un fallo nativo, el hilo que cayó, el mensaje del abort y sus primeras funciones. */
class TombstoneTest {
    private fun varint(v: Long): ByteArray { val o = java.io.ByteArrayOutputStream(); var x = v; while (true) { if (x and 0x7fL.inv() == 0L) { o.write(x.toInt()); break }; o.write(((x and 0x7f) or 0x80).toInt()); x = x ushr 7 }; return o.toByteArray() }
    private fun num(f: Int, v: Long) = varint((f.toLong() shl 3) or 0) + varint(v)
    private fun bytes(f: Int, b: ByteArray) = varint((f.toLong() shl 3) or 2) + varint(b.size.toLong()) + b
    private fun str(f: Int, s: String) = bytes(f, s.toByteArray())
    private fun frame(fn: String, file: String) = num(1, 1234) + num(2, 5678) + str(4, fn) + num(5, 12) + str(6, file)
    private fun thread(id: Long, name: String, vararg fr: ByteArray) = num(1, id) + str(2, name) + fr.fold(ByteArray(0)) { a, f -> a + bytes(4, f) }
    private fun entry(id: Long, t: ByteArray) = num(1, id) + bytes(2, t)

    @Test fun elHiloQueCayoYElAbort() {
        val tomb = num(1, 3) + str(2, "samsung/x") + num(5, 100) + num(6, 222) +
            bytes(10, num(1, 6) + str(2, "SIGABRT")) + str(14, "JNI DETECTED ERROR IN APPLICATION: use of deleted global reference") +
            bytes(16, entry(100, thread(100, "main", frame("art::Unsafe_park", "/apex/libart.so")))) +
            bytes(16, entry(222, thread(222, "NexoGatt", frame("abort", "/apex/libc.so"), frame("art::JavaVMExt::JniAbort", "/apex/libart.so"))))
        val s = ExitReasons.tombstoneSummary(tomb)
        assertTrue(s.contains("señal SIGABRT"), s)
        assertTrue(s.contains("abort: JNI DETECTED ERROR"), s)
        assertTrue(s.contains("hilo que cayó: NexoGatt (tid 222)"), s)
        assertTrue(s.contains("art::JavaVMExt::JniAbort (libart.so)"), s)
        assertFalse(s.contains("Unsafe_park"), "el hilo dormido (main) no es el que cayó")
    }

    @Test fun basuraOTextoNoRevientan() {
        assertEquals("", ExitReasons.tombstoneSummary(ByteArray(0)))
        assertEquals("", ExitReasons.tombstoneSummary("*** *** *** SIGABRT texto plano".toByteArray()))
        assertEquals("", ExitReasons.tombstoneSummary(byteArrayOf(0x0a, 0x7f, 0x01)))
    }
}
