package com.nexo.ble

import java.math.BigInteger
import java.security.MessageDigest
import java.security.SecureRandom

// secp256k1 y firmas Schnorr (BIP-340), lo justo para la escucha de internet en segundo plano (NetBg):
// clave pública de las etiquetas del día y firma de la identificación NIP-42 ante los relés. Comprobado contra
// @noble/curves (la librería de la app) en tests/kotlin (Secp256k1Test).
object Secp256k1 {
    val P = BigInteger("fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f", 16)
    val N = BigInteger("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", 16)
    private val GX = BigInteger("79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", 16)
    private val GY = BigInteger("483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8", 16)
    private val TWO = BigInteger.valueOf(2); private val THREE = BigInteger.valueOf(3)

    // Punto en coordenadas jacobianas (x/z², y/z³); z = 0 es el infinito
    private class J(val x: BigInteger, val y: BigInteger, val z: BigInteger)
    private val INF = J(BigInteger.ONE, BigInteger.ONE, BigInteger.ZERO)
    private val G = J(GX, GY, BigInteger.ONE)

    private fun dbl(p: J): J {
        if (p.z.signum() == 0 || p.y.signum() == 0) return INF
        val ysq = p.y.multiply(p.y).mod(P)
        val s = BigInteger.valueOf(4).multiply(p.x).multiply(ysq).mod(P)
        val m = THREE.multiply(p.x).multiply(p.x).mod(P)
        val nx = m.multiply(m).subtract(TWO.multiply(s)).mod(P)
        val ny = m.multiply(s.subtract(nx)).subtract(BigInteger.valueOf(8).multiply(ysq).multiply(ysq)).mod(P)
        val nz = TWO.multiply(p.y).multiply(p.z).mod(P)
        return J(nx, ny, nz)
    }
    private fun add(p: J, q: J): J {
        if (p.z.signum() == 0) return q
        if (q.z.signum() == 0) return p
        val z1z1 = p.z.multiply(p.z).mod(P); val z2z2 = q.z.multiply(q.z).mod(P)
        val u1 = p.x.multiply(z2z2).mod(P); val u2 = q.x.multiply(z1z1).mod(P)
        val s1 = p.y.multiply(q.z).multiply(z2z2).mod(P); val s2 = q.y.multiply(p.z).multiply(z1z1).mod(P)
        if (u1 == u2) return if (s1 == s2) dbl(p) else INF
        val h = u2.subtract(u1).mod(P); val r = s2.subtract(s1).mod(P)
        val h2 = h.multiply(h).mod(P); val h3 = h2.multiply(h).mod(P); val u1h2 = u1.multiply(h2).mod(P)
        val nx = r.multiply(r).subtract(h3).subtract(TWO.multiply(u1h2)).mod(P)
        val ny = r.multiply(u1h2.subtract(nx)).subtract(s1.multiply(h3)).mod(P)
        val nz = h.multiply(p.z).multiply(q.z).mod(P)
        return J(nx, ny, nz)
    }
    private fun mul(k: BigInteger): Pair<BigInteger, BigInteger> {
        var r = INF; var a = G
        for (i in 0 until k.bitLength()) { if (k.testBit(i)) r = add(r, a); a = dbl(a) }
        require(r.z.signum() != 0) { "punto en el infinito" }
        val zi = r.z.modInverse(P); val zi2 = zi.multiply(zi).mod(P)
        return Pair(r.x.multiply(zi2).mod(P), r.y.multiply(zi2).multiply(zi).mod(P))
    }

    fun b32(x: BigInteger): ByteArray {
        val b = x.toByteArray()
        return when {
            b.size == 32 -> b
            b.size > 32 -> b.copyOfRange(b.size - 32, b.size)
            else -> ByteArray(32 - b.size) + b
        }
    }
    private fun int(b: ByteArray) = BigInteger(1, b)
    fun sha256(vararg parts: ByteArray): ByteArray { val md = MessageDigest.getInstance("SHA-256"); parts.forEach { md.update(it) }; return md.digest() }
    private fun tagged(tag: String, vararg parts: ByteArray): ByteArray { val t = sha256(tag.toByteArray()); return sha256(t, t, *parts) }

    // Clave pública x-only (32 bytes) de la clave privada sk
    fun xOnly(sk: ByteArray): ByteArray = b32(mul(int(sk)).first)

    // Firma BIP-340 (64 bytes) del mensaje de 32 bytes
    fun sign(msg: ByteArray, sk: ByteArray, aux: ByteArray = ByteArray(32).also { SecureRandom().nextBytes(it) }): ByteArray {
        val d0 = int(sk)
        require(d0.signum() > 0 && d0 < N) { "clave fuera de rango" }
        val (px, py) = mul(d0)
        val d = if (py.testBit(0)) N.subtract(d0) else d0
        val t = b32(d).also { val h = tagged("BIP0340/aux", aux); for (i in 0 until 32) it[i] = (it[i].toInt() xor h[i].toInt()).toByte() }
        val k0 = int(tagged("BIP0340/nonce", t, b32(px), msg)).mod(N)
        require(k0.signum() != 0)
        val (rx, ry) = mul(k0)
        val k = if (ry.testBit(0)) N.subtract(k0) else k0
        val e = int(tagged("BIP0340/challenge", b32(rx), b32(px), msg)).mod(N)
        return b32(rx) + b32(k.add(e.multiply(d)).mod(N))
    }

    fun hex(b: ByteArray): String { val sb = StringBuilder(b.size * 2); for (x in b) sb.append(String.format("%02x", x.toInt() and 0xff)); return sb.toString() }
    fun unhex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}
