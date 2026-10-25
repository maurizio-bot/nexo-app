package com.nexo.ble

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

/**
 * Archivos grandes (ronda 2756, pedido del dueño: un APK de 24 MB no salía). Como Signal/WhatsApp: el archivo nunca
 * está entero en la memoria de la app. La app lo lee a trozos y aquí se cifra a disco con una clave al azar propia del
 * archivo (la clave viaja en el mensaje, cifrado de extremo a extremo); el archivo cifrado va de teléfono a teléfono por
 * un socket (mismo Wi-Fi o Wi-Fi Direct) leyendo y escribiendo en disco; al abrirlo se descifra a un archivo temporal.
 * Formato del cifrado: registros [largo int32][último 0/1][iv 12][AES-GCM(trozo)], con datos asociados
 * "nexo-big|<id>|<n.º de registro>|<último>": no se pueden quitar, reordenar ni cortar registros sin que se note.
 * Sin dependencias de Android: se prueba en JVM (tests/kotlin, BigFileTest).
 */
object BigFile {
    const val MAX_BYTES = 1L shl 30            // 1 GB de archivo
    const val MAX_RECORD = (2 shl 20) + 64     // un trozo cifrado (la app manda de 512 KB)
    private val rnd = SecureRandom()

    fun safeId(id: String) = id.filter { it.isLetterOrDigit() || it == '_' || it == '-' }.take(64)
    fun encFile(dir: File, id: String) = File(dir, safeId(id) + ".enc")
    fun key(hex: String): ByteArray {
        require(hex.length == 64 && hex.all { it in '0'..'9' || it in 'a'..'f' }) { "clave no válida" }
        return ByteArray(32) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
    fun token(): String { val b = ByteArray(16); rnd.nextBytes(b); return b.joinToString("") { "%02x".format(it) } }
    internal fun ad(id: String, n: Int, last: Boolean) = "nexo-big|$id|$n|${if (last) 1 else 0}".toByteArray(Charsets.UTF_8)
    internal fun gcm(mode: Int, key: ByteArray, iv: ByteArray, ad: ByteArray): Cipher =
        Cipher.getInstance("AES/GCM/NoPadding").apply { init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv)); updateAAD(ad) }
    internal fun randomIv(): ByteArray { val b = ByteArray(12); rnd.nextBytes(b); return b }
}

class BigWriter(val file: File, private val key: ByteArray, private val id: String) {
    private val out = DataOutputStream(FileOutputStream(file).buffered(1 shl 16))
    private var n = 0
    var plainBytes = 0L; private set
    var closed = false; private set

    fun append(plain: ByteArray, last: Boolean) {
        check(!closed) { "ya terminado" }
        plainBytes += plain.size
        require(plainBytes <= BigFile.MAX_BYTES) { "archivo demasiado grande" }
        val iv = BigFile.randomIv()
        val ct = BigFile.gcm(Cipher.ENCRYPT_MODE, key, iv, BigFile.ad(id, n, last)).doFinal(plain)
        out.writeInt(1 + iv.size + ct.size); out.writeByte(if (last) 1 else 0); out.write(iv); out.write(ct)
        n++
        if (last) { out.close(); closed = true }
    }

    fun abort() { try { out.close() } catch (e: Exception) {}; closed = true; file.delete() }
}

object BigReader {
    // Descifra a out; devuelve los bytes del archivo. Error si falta algo, sobra algo o se tocó.
    fun decrypt(file: File, key: ByteArray, id: String, out: OutputStream): Long {
        var total = 0L
        DataInputStream(FileInputStream(file).buffered(1 shl 16)).use { input ->
            var n = 0
            while (true) {
                val len = try { input.readInt() } catch (e: java.io.EOFException) { throw Exception("archivo incompleto") }
                if (len < 1 + 12 + 16 || len > BigFile.MAX_RECORD) throw Exception("registro no válido")
                val last = input.readByte().toInt() == 1
                val iv = ByteArray(12).also { input.readFully(it) }
                val ct = ByteArray(len - 13).also { input.readFully(it) }
                val plain = try { BigFile.gcm(Cipher.DECRYPT_MODE, key, iv, BigFile.ad(id, n, last)).doFinal(ct) } catch (e: Exception) { throw Exception("archivo dañado o clave incorrecta") }
                out.write(plain); total += plain.size; n++
                if (last) { if (input.read() != -1) throw Exception("datos de más"); return total }
            }
        }
    }
}

// Paso de un archivo cifrado de teléfono a teléfono: cabecera {id, token, len}, el archivo y un byte de confirmación
object BigNet {
    fun interface Progress { fun on(bytes: Long, total: Long) }

    fun send(sock: Socket, id: String, token: String, file: File, progress: Progress? = null) =
        send(sock.getInputStream(), sock.getOutputStream(), id, token, file, progress)

    // Ronda 2758: con flujos, para el socket del Wi-Fi y para el canal L2CAP del Bluetooth (BluetoothSocket)
    fun send(rawIn: InputStream, rawOut: OutputStream, id: String, token: String, file: File, progress: Progress? = null) {
        val total = file.length()
        val out = DataOutputStream(rawOut.buffered(1 shl 16))
        out.writeUTF(JSONObject().put("big", 1).put("id", id).put("token", token).put("len", total).toString())
        val buf = ByteArray(1 shl 16)
        var sent = 0L
        FileInputStream(file).use { input ->
            while (true) {
                val r = input.read(buf); if (r < 0) break
                out.write(buf, 0, r); sent += r
                progress?.on(sent, total)
            }
        }
        out.flush()
        if (rawIn.read() != 1) throw Exception("sin confirmación")
    }

    // Lee una conexión: si la cabecera no es la esperada (id/token) devuelve false sin escribir nada
    fun receive(sock: Socket, id: String, token: String, dest: File, maxLen: Long, progress: Progress? = null, beforeAck: (() -> Unit)? = null): Boolean =
        receive(sock.getInputStream(), sock.getOutputStream(), id, token, dest, maxLen, progress, beforeAck)

    // beforeAck (ronda 2759, pasar la cuenta): se hace antes de confirmar; si falla, no se confirma (el emisor no borra nada)
    fun receive(rawIn: InputStream, rawOut: OutputStream, id: String, token: String, dest: File, maxLen: Long, progress: Progress? = null, beforeAck: (() -> Unit)? = null): Boolean {
        val input = DataInputStream(rawIn.buffered(1 shl 16))
        val h = JSONObject(input.readUTF())
        if (h.optInt("big") != 1 || h.optString("id") != id || h.optString("token") != token) return false
        val len = h.optLong("len")
        if (len <= 0 || len > maxLen) throw Exception("tamaño no válido")
        val tmp = File(dest.path + ".part")
        val buf = ByteArray(1 shl 16)
        var got = 0L
        FileOutputStream(tmp).use { out ->
            while (got < len) {
                val r = input.read(buf, 0, minOf(buf.size.toLong(), len - got).toInt())
                if (r < 0) throw Exception("conexión cortada (${got} de ${len} bytes)")
                out.write(buf, 0, r); got += r
                progress?.on(got, len)
            }
        }
        if (!tmp.renameTo(dest)) { tmp.copyTo(dest, true); tmp.delete() }
        beforeAck?.invoke()
        rawOut.apply { write(1); flush() }
        return true
    }

    // Servidor de una sola recepción: acepta hasta que llega la buena. Auditoría (ronda 2774): cada conexión se atiende
    // por separado y, si da error (otra persona de la misma red manda basura, una cabecera ajena o no manda nada hasta
    // que vence soTimeoutMs), se descarta y se sigue esperando la del contacto. Antes una sola conexión ajena lanzaba la
    // excepción fuera de serve y la espera del archivo moría: el archivo legítimo nunca llegaba.
    fun serve(server: ServerSocket, id: String, token: String, dest: File, maxLen: Long, progress: Progress? = null, soTimeoutMs: Int = 30000, beforeAck: (() -> Unit)? = null) {
        while (true) {
            val s = server.accept()
            val done = try {
                s.soTimeout = soTimeoutMs
                receive(s, id, token, dest, maxLen, progress, beforeAck)
            } catch (e: Exception) {
                false
            } finally {
                try { s.close() } catch (e: Exception) {}
            }
            if (done) return
        }
    }
}
