package com.nexo.ble

import java.io.File
import java.io.IOException
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Cifrado en reposo de los archivos de la app (seguridad fase 3). Sin dependencias de Android: se prueba en
 * JVM (tests/kotlin). La clave la da quien lo usa (NexoBlePlugin: clave de datos envuelta por una del Android
 * Keystore, no extraíble).
 *
 * Formato: "NXE1" + iv (12 bytes) + AES-256-GCM(contenido UTF-8). Lo que no empieza por "NXE1" es un archivo
 * antiguo en claro: se lee tal cual y migrateAll() lo cifra (comprobando que se descifra igual antes de
 * sustituirlo). Escrituras atómicas (archivo temporal + renombrar) y un solo cerrojo para leer, escribir y
 * migrar (una migración no pisa un guardado). Sin clave no se sobrescribe nunca un archivo cifrado.
 */
class AtRestStore(private val dir: File, private val keyProvider: () -> SecretKey?) {
    companion object {
        val MAGIC = byteArrayOf(0x4E, 0x58, 0x45, 0x31) // "NXE1"
        private const val IV_LEN = 12
        private const val TAG_BITS = 128
        private val rnd = SecureRandom()

        fun isEncrypted(b: ByteArray): Boolean =
            b.size >= MAGIC.size + IV_LEN && b[0] == MAGIC[0] && b[1] == MAGIC[1] && b[2] == MAGIC[2] && b[3] == MAGIC[3]

        fun encrypt(key: SecretKey, plain: ByteArray): ByteArray {
            val iv = ByteArray(IV_LEN).also { rnd.nextBytes(it) }
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
            c.updateAAD(MAGIC)
            val ct = c.doFinal(plain)
            val out = ByteArray(MAGIC.size + IV_LEN + ct.size)
            System.arraycopy(MAGIC, 0, out, 0, MAGIC.size)
            System.arraycopy(iv, 0, out, MAGIC.size, IV_LEN)
            System.arraycopy(ct, 0, out, MAGIC.size + IV_LEN, ct.size)
            return out
        }

        fun decrypt(key: SecretKey, data: ByteArray): ByteArray {
            if (!isEncrypted(data)) throw IOException("no es un archivo cifrado")
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, data, MAGIC.size, IV_LEN))
            c.updateAAD(MAGIC)
            return c.doFinal(data, MAGIC.size + IV_LEN, data.size - MAGIC.size - IV_LEN)
        }
    }

    private val lock = Any()
    /** Archivos que el código nativo lee directamente (no pasan por aquí): se dejan en claro. */
    var skip: Set<String> = emptySet()
    /** Qué archivos en claro migra migrateAll() (solo los de la carpeta, no subcarpetas). Por defecto, todos. */
    var migrateOnly: (String) -> Boolean = { true }

    private fun file(name: String): File {
        val f = File(dir, name)
        // Solo dentro del directorio de la app
        if (!f.canonicalPath.startsWith(dir.canonicalPath + File.separator)) throw IOException("ruta no válida")
        return f
    }

    private fun writeAtomic(f: File, bytes: ByteArray) {
        f.parentFile?.mkdirs()
        val tmp = File(f.parentFile, f.name + ".nxtmp")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(f)) {
            f.delete()
            if (!tmp.renameTo(f)) { tmp.delete(); throw IOException("no se pudo guardar ${f.name}") }
        }
    }

    private fun headIsEncrypted(f: File): Boolean {
        if (!f.exists() || f.length() < MAGIC.size + IV_LEN) return false
        val head = ByteArray(MAGIC.size + IV_LEN)
        f.inputStream().use { var n = 0; while (n < head.size) { val r = it.read(head, n, head.size - n); if (r < 0) break; n += r } }
        return isEncrypted(head)
    }

    /** Guarda texto (cifrado si hay clave). */
    fun write(name: String, text: String) {
        synchronized(lock) {
            val f = file(name)
            val key = keyProvider()
            if (key == null || name in skip) {
                if (key == null && headIsEncrypted(f)) throw IOException("cifrado no disponible: no se sobrescribe $name")
                writeAtomic(f, text.toByteArray(Charsets.UTF_8))
            } else {
                writeAtomic(f, encrypt(key, text.toByteArray(Charsets.UTF_8)))
            }
        }
    }

    /** Lee texto (null si no existe). Un archivo cifrado sin clave, o manipulado, lanza IOException. */
    fun read(name: String): String? {
        synchronized(lock) {
            val f = file(name)
            if (!f.exists()) return null
            val b = f.readBytes()
            if (!isEncrypted(b)) return String(b, Charsets.UTF_8)
            val key = keyProvider() ?: throw IOException("cifrado no disponible")
            return try { String(decrypt(key, b), Charsets.UTF_8) } catch (e: Exception) { throw IOException("no se pudo descifrar $name: ${e.message}") }
        }
    }

    fun delete(name: String): Boolean = synchronized(lock) { file(name).delete() }

    /** Cifra los archivos que aún están en claro. Devuelve cuántos. Cada uno se comprueba antes de sustituirlo. */
    fun migrateAll(): Int {
        val key = keyProvider() ?: return 0
        var n = 0
        (dir.listFiles() ?: emptyArray()).filter { it.isFile && !it.name.endsWith(".nxtmp") && it.name !in skip && migrateOnly(it.name) }.forEach { f ->
            synchronized(lock) {
                if (!f.exists()) return@synchronized
                val b = f.readBytes()
                if (isEncrypted(b)) return@synchronized
                val enc = encrypt(key, b)
                if (!decrypt(key, enc).contentEquals(b)) throw IOException("comprobación fallida en ${f.name}")
                writeAtomic(f, enc)
                n++
            }
        }
        return n
    }
}
