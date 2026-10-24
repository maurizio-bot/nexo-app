package com.nexo.ble

import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * Pasar la cuenta a un teléfono nuevo (ronda 2759, plan del dueño punto 15, opción A).
 * Todo lo de NEXO (archivos "nexo_*" de la app: NEXO ID, identidad y claves, sesiones de cifrado, contactos, historial,
 * adjuntos, grupos, Fénix…) y los archivos grandes ya cifrados (nexo_big/) se empaquetan, se cifran con una clave de un
 * solo uso que va en el QR (BigWriter: AES-GCM por trozos) y pasan de teléfono a teléfono por el Wi-Fi (BigNet).
 * El nuevo los guarda con SU cifrado en reposo; el viejo borra los suyos en cuanto el nuevo confirma (así la cuenta
 * nunca queda activa en los dos).
 * Paquete (en claro dentro del cifrado):  "NEXOMOVE1" { [1][nombre][largo 4 bytes][texto UTF-8] | [2][nombre][largo 8][bytes] }* [0]
 * Sin dependencias de Android: se prueba en JVM (AccountMoveTest).
 */
object AccountMove {
    const val MAGIC = "NEXOMOVE1"
    private val NAME = Regex("^nexo_[A-Za-z0-9_.:-]{1,200}$")
    private val BIG_NAME = Regex("^[A-Za-z0-9_-]{1,64}\\.enc$")

    /** Qué archivos de la carpeta de la app viajan (los propios del teléfono, no: buzón con la app cerrada, mapas de
     *  direcciones Bluetooth, registros de diagnóstico, temporales). */
    fun travels(name: String, skip: Set<String>): Boolean =
        NAME.matches(name) && !name.endsWith(".nxtmp") && name !in skip && !name.startsWith("nexo_diag") && !name.startsWith("nexo_bg_inbox")

    class Stats { var files = 0; var bigFiles = 0; var bytes = 0L }

    /** Empaqueta: read(nombre) da el texto descifrado (AtRestStore.read). */
    fun export(dir: File, skip: Set<String>, read: (String) -> String?, bigDir: File?, out: OutputStream): Stats {
        val st = Stats()
        val d = DataOutputStream(out)
        d.writeUTF(MAGIC)
        (dir.listFiles() ?: emptyArray()).filter { it.isFile && travels(it.name, skip) }.sortedBy { it.name }.forEach { f ->
            val text = read(f.name) ?: return@forEach
            val b = text.toByteArray(Charsets.UTF_8)
            d.writeByte(1); d.writeUTF(f.name); d.writeInt(b.size); d.write(b)
            st.files++; st.bytes += b.size
        }
        (bigDir?.listFiles() ?: emptyArray()).filter { it.isFile && BIG_NAME.matches(it.name) }.sortedBy { it.name }.forEach { f ->
            d.writeByte(2); d.writeUTF(f.name); d.writeLong(f.length())
            FileInputStream(f).use { it.copyTo(d, 1 shl 16) }
            st.bigFiles++; st.bytes += f.length()
        }
        d.writeByte(0)
        d.flush()
        return st
    }

    /** Desempaqueta: write(nombre, texto) guarda (AtRestStore.write); los archivos grandes se copian tal cual. */
    fun import(input: InputStream, skip: Set<String>, write: (String, String) -> Unit, bigDir: File): Stats {
        val st = Stats()
        val d = DataInputStream(input)
        if (d.readUTF() != MAGIC) throw IOException("no es una cuenta de NEXO")
        while (true) {
            when (d.readByte().toInt()) {
                0 -> return st
                1 -> {
                    val name = d.readUTF(); val len = d.readInt()
                    if (!travels(name, skip) || len < 0 || len > 512 * 1024 * 1024) throw IOException("archivo no válido: $name")
                    val b = ByteArray(len); d.readFully(b)
                    write(name, String(b, Charsets.UTF_8))
                    st.files++; st.bytes += len
                }
                2 -> {
                    val name = d.readUTF(); var left = d.readLong()
                    if (!BIG_NAME.matches(name) || left < 0) throw IOException("archivo grande no válido: $name")
                    bigDir.mkdirs()
                    val tmp = File(bigDir, "$name.part")
                    FileOutputStream(tmp).use { o ->
                        val buf = ByteArray(1 shl 16)
                        while (left > 0) {
                            val r = d.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                            if (r < 0) throw IOException("cortado en $name")
                            o.write(buf, 0, r); left -= r
                        }
                    }
                    val dest = File(bigDir, name)
                    if (!tmp.renameTo(dest)) { tmp.copyTo(dest, true); tmp.delete() }
                    st.bigFiles++; st.bytes += dest.length()
                }
                else -> throw IOException("paquete dañado")
            }
        }
    }

    /** Lo que había de NEXO en este teléfono fuera (antes de importar en el nuevo, o tras pasarla en el viejo). */
    fun wipe(dir: File, skip: Set<String>, bigDir: File?): Int {
        var n = 0
        (dir.listFiles() ?: emptyArray()).filter { it.isFile && travels(it.name, skip) }.forEach { if (it.delete()) n++ }
        bigDir?.listFiles()?.forEach { if (it.delete()) n++ }
        return n
    }
}

/** Escribe en un BigWriter por trozos de 512 KB (para empaquetar sin tener la cuenta entera en memoria). */
class BigWriterStream(private val w: BigWriter) : OutputStream() {
    private val buf = ByteArray(512 * 1024)
    private var n = 0
    override fun write(b: Int) { buf[n++] = b.toByte(); if (n == buf.size) { w.append(buf.copyOf(n), false); n = 0 } }
    override fun write(b: ByteArray, off: Int, len: Int) {
        var o = off; var l = len
        while (l > 0) {
            val k = minOf(l, buf.size - n)
            System.arraycopy(b, o, buf, n, k); n += k; o += k; l -= k
            if (n == buf.size) { w.append(buf.copyOf(n), false); n = 0 }
        }
    }
    override fun close() { w.append(buf.copyOf(n), true); n = 0 }
}
