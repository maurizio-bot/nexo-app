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
 * sustituirlo). Escrituras atómicas (archivo temporal + renombrar) y un cerrojo por archivo para leer, escribir
 * y migrar (una migración no pisa un guardado, y un archivo grande no hace esperar a los demás). Sin clave no
 * se sobrescribe nunca un archivo cifrado.
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

    // Un cerrojo por archivo: guardar las claves antes de un envío no espera a que se lea, guarde o migre un vídeo
    private val locks = java.util.concurrent.ConcurrentHashMap<String, Any>()
    private fun lockFor(f: File): Any = locks.computeIfAbsent(f.canonicalPath) { Any() }
    /** Archivos que el código nativo lee directamente (no pasan por aquí): se dejan en claro. */
    var skip: Set<String> = emptySet()
    /** Qué archivos en claro migra migrateAll() (solo los de la carpeta, no subcarpetas). Por defecto, todos. */
    var migrateOnly: (String) -> Boolean = { true }
    /** Para medir (pruebas): bytes leídos del disco. */
    var onRead: (Long) -> Unit = {}

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
        replace(tmp, f)
    }

    private fun replace(tmp: File, f: File) {
        if (!tmp.renameTo(f)) {
            f.delete()
            if (!tmp.renameTo(f)) { tmp.delete(); throw IOException("no se pudo guardar ${f.name}") }
        }
    }

    private fun headIsEncrypted(f: File): Boolean {
        if (!f.exists() || f.length() < MAGIC.size + IV_LEN) return false
        val head = ByteArray(MAGIC.size + IV_LEN)
        var n = 0
        f.inputStream().use { while (n < head.size) { val r = it.read(head, n, head.size - n); if (r < 0) break; n += r } }
        onRead(n.toLong())
        return isEncrypted(head)
    }

    /** Guarda texto (cifrado si hay clave). */
    fun write(name: String, text: String) {
        val f = file(name)
        val key = keyProvider()
        synchronized(lockFor(f)) {
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
        val f = file(name)
        val b = synchronized(lockFor(f)) {
            if (!f.exists()) return null
            f.readBytes()
        }
        onRead(b.size.toLong())
        if (!isEncrypted(b)) return String(b, Charsets.UTF_8)
        val key = keyProvider() ?: throw IOException("cifrado no disponible")
        return try { String(decrypt(key, b), Charsets.UTF_8) } catch (e: Exception) { throw IOException("no se pudo descifrar $name: ${e.message}") }
    }

    fun delete(name: String): Boolean { val f = file(name); return synchronized(lockFor(f)) { f.delete() } }

    /**
     * Cifra los archivos que aún están en claro. Devuelve cuántos. Se llama en cada arranque: de los ya cifrados
     * solo lee la cabecera. Los grandes se cifran por trozos (sin cargarlos enteros en memoria) y se comprueban
     * (descifrado = original) antes de sustituirlos. Un archivo que falle se salta (queda en claro y legible).
     */
    fun migrateAll(): Int {
        val key = keyProvider() ?: return 0
        var n = 0
        (dir.listFiles() ?: emptyArray()).filter { it.isFile && !it.name.endsWith(".nxtmp") && it.name !in skip && migrateOnly(it.name) }.forEach { f ->
            try {
                synchronized(lockFor(f)) {
                    if (!f.exists()) return@synchronized
                    if (headIsEncrypted(f)) return@synchronized
                    val tmp = File(f.parentFile, f.name + ".nxtmp")
                    val hash = encryptFile(key, f, tmp)
                    if (!hash.contentEquals(decryptedHash(key, tmp))) { tmp.delete(); throw IOException("comprobación fallida en ${f.name}") }
                    replace(tmp, f)
                    n++
                }
            } catch (t: Throwable) {
                // Sin memoria, disco lleno…: se queda en claro (se lee igual) y se intenta en el próximo arranque
                File(f.parentFile, f.name + ".nxtmp").delete()
            }
        }
        return n
    }

    private fun sha256() = java.security.MessageDigest.getInstance("SHA-256")

    // Cifra src en dst por trozos de 64 KB. Devuelve el SHA-256 del original.
    private fun encryptFile(key: SecretKey, src: File, dst: File): ByteArray {
        val iv = ByteArray(IV_LEN).also { rnd.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        c.updateAAD(MAGIC)
        val md = sha256()
        val buf = ByteArray(65536)
        src.inputStream().use { inp ->
            dst.outputStream().use { out ->
                out.write(MAGIC); out.write(iv)
                while (true) {
                    val r = inp.read(buf); if (r < 0) break
                    onRead(r.toLong())
                    md.update(buf, 0, r)
                    c.update(buf, 0, r)?.let { out.write(it) }
                }
                out.write(c.doFinal())
            }
        }
        return md.digest()
    }

    // SHA-256 de lo que se obtiene al descifrar el archivo (GCM comprueba la etiqueta al final)
    private fun decryptedHash(key: SecretKey, f: File): ByteArray {
        val head = ByteArray(MAGIC.size + IV_LEN)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        val md = sha256()
        val buf = ByteArray(65536)
        f.inputStream().use { inp ->
            var n = 0
            while (n < head.size) { val r = inp.read(head, n, head.size - n); if (r < 0) throw IOException("corto"); n += r }
            if (!isEncrypted(head)) throw IOException("no cifrado")
            c.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, head, MAGIC.size, IV_LEN))
            c.updateAAD(MAGIC)
            while (true) {
                val r = inp.read(buf); if (r < 0) break
                c.update(buf, 0, r)?.let { md.update(it) }
            }
            md.update(c.doFinal())
        }
        return md.digest()
    }
}
