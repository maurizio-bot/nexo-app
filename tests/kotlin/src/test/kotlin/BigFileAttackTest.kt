import com.nexo.ble.BigNet
import java.io.DataOutputStream
import java.net.ServerSocket
import java.net.Socket
import java.nio.file.Files
import kotlin.test.*

// Auditoría (ronda 2774): recibir un archivo grande abre un socket en la red. El emisor de verdad manda una cabecera
// con el id y un token al azar; quien no lo tiene no puede mandar el archivo. Pero antes bastaba con que alguien de la
// misma red abriera una conexión con basura (o se quedara callado) para que `serve` lanzara una excepción y la espera
// del archivo del contacto muriera: el archivo legítimo ya no llegaba. Ahora cada conexión ajena se descarta y se sigue
// esperando la buena.
class BigFileAttackTest {
    @Test fun servidorSobreviveAConexionesAjenas() {
        val dir = Files.createTempDirectory("bigf").toFile()
        val src = java.io.File(dir, "src").apply { writeBytes(ByteArray(200_000) { (it % 251).toByte() }) }
        val dest = java.io.File(dir, "dest")
        val server = ServerSocket(0); val port = server.localPort
        val id = "file1"; val token = "tok-secreto-123"
        val t = Thread { try { BigNet.serve(server, id, token, dest, 10_000_000L, null, 800) } catch (e: Exception) {} }
        t.start()
        // 1) Alguien de la red manda basura (UTF válido, pero no es la cabecera): antes tumbaba la espera.
        Socket("127.0.0.1", port).use { s -> DataOutputStream(s.getOutputStream()).apply { writeUTF("no soy la cabecera"); flush() }; Thread.sleep(120) }
        // 2) Otro se conecta y no manda nada (ocupa la espera hasta que vence el tiempo de la conexión).
        val silent = Socket("127.0.0.1", port); Thread.sleep(60)
        // 3) El emisor de verdad: tiene el id y el token.
        Socket("127.0.0.1", port).use { s -> BigNet.send(s, id, token, src) }
        t.join(12000)
        try { silent.close() } catch (e: Exception) {}
        server.close()
        assertFalse(t.isAlive, "la espera del archivo murió por una conexión ajena")
        assertTrue(dest.exists(), "el archivo del contacto no llegó")
        assertTrue(dest.readBytes().contentEquals(src.readBytes()), "el archivo llegó distinto")
        dir.deleteRecursively()
    }

    // Una cabecera con el token equivocado se rechaza limpiamente (como siempre) y la espera sigue para la buena.
    @Test fun tokenEquivocadoNoRecibe() {
        val dir = Files.createTempDirectory("bigf2").toFile()
        val src = java.io.File(dir, "src").apply { writeBytes(ByteArray(50_000) { 7 }) }
        val dest = java.io.File(dir, "dest")
        val server = ServerSocket(0); val port = server.localPort
        val t = Thread { try { BigNet.serve(server, "fileX", "bueno", dest, 10_000_000L, null, 800) } catch (e: Exception) {} }
        t.start()
        try { Socket("127.0.0.1", port).use { s -> BigNet.send(s, "fileX", "malo", src) } } catch (e: Exception) {} // el emisor con token malo no recibe confirmación
        Thread.sleep(200)
        Socket("127.0.0.1", port).use { s -> BigNet.send(s, "fileX", "bueno", src) }
        t.join(12000); try { server.close() } catch (e: Exception) {}
        assertTrue(dest.exists() && dest.readBytes().contentEquals(src.readBytes()))
        dir.deleteRecursively()
    }
}
