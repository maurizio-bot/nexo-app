package com.nexo.ble

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

// ID Bluetooth rotativo (ronda 2755): el mismo código que src/ui/ble_rid.js. La app da la clave (hex) y aquí se
// calcula el código de cada época, también con la app cerrada (BleService lo cambia al empezar cada época).
object RidToken {
    private const val B32 = "abcdefghijklmnopqrstuvwxyz234567"

    fun epoch(nowMs: Long, epochS: Long) = nowMs / 1000 / epochS

    fun token(keyHex: String, epoch: Long): String {
        val key = ByteArray(keyHex.length / 2) { keyHex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        val h = mac.doFinal("nexo-rid|$epoch".toByteArray(Charsets.UTF_8))
        val out = StringBuilder("R")
        var acc = 0
        var bits = 0
        var i = 0
        while (out.length < 10) {
            acc = (acc shl 8) or (h[i++].toInt() and 0xff); bits += 8
            while (bits >= 5 && out.length < 10) { bits -= 5; out.append(B32[(acc shr bits) and 31]) }
            acc = acc and ((1 shl bits) - 1)
        }
        return out.toString()
    }

    // Lo que se anuncia ahora: el NEXO ID mientras se es visible (o sin clave); si no, el código de la época
    fun advertised(nexoId: String, keyHex: String?, visibleUntil: Long, nowMs: Long, epochS: Long): String =
        if (keyHex.isNullOrEmpty() || keyHex.length != 64 || nowMs < visibleUntil) nexoId else token(keyHex, epoch(nowMs, epochS))

    // Cuándo hay que volver a anunciar (fin de la visibilidad o de la época)
    fun nextChangeMs(keyHex: String?, visibleUntil: Long, nowMs: Long, epochS: Long): Long {
        if (keyHex.isNullOrEmpty() || keyHex.length != 64) return -1
        if (nowMs < visibleUntil) return visibleUntil - nowMs
        return (epoch(nowMs, epochS) + 1) * epochS * 1000 - nowMs
    }
}
