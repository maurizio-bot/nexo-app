package com.nexo.ble

import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * Recibir por Bluetooth con la app cerrada (ronda 2758, plan del dueño punto 12). Al cerrar la app el servidor GATT
 * sigue (el proceso vive por el BleService) pero no hay app que procese lo que llega. Lo que llega se clasifica aquí:
 *  - mensaje ('chat' con msgId y remitente): al buzón (disco), confirmación de entrega al emisor (✓✓: ya está a salvo
 *    en este teléfono) y notificación "Mensaje nuevo" (sin texto: va cifrado; no si viene marcado q:1 = acción oculta)
 *  - confirmaciones ('ack', 'read_receipt'): al buzón
 *  - primer trozo de un texto largo o de un archivo de un NEXO ID conocido: solo notificación (el emisor lo tiene
 *    pendiente y lo manda al abrir la app: sin la app no se pueden confirmar trozos)
 *  - oferta de llamada (marca cl:1, ronda 2759): como un mensaje, pero el aviso dice "📞 Llamada entrante" (al abrir la
 *    app en menos de 60 s suena)
 *  - lo demás (control, trozos, rutas…): nada (al abrir la app se rehace)
 * Al abrir la app, el buzón se entrega en orden como si acabara de llegar (la app descifra y quita repetidos).
 * Sin dependencias de Android: se prueba en JVM (BgInboxTest).
 */
class BgInbox(private val file: File, private val maxBytes: Long = 3_000_000) {
    enum class Kind { MESSAGE, RECEIPT, NOTIFY_ONLY, IGNORE }
    class Info(val kind: Kind, val from: String, val msgId: String, val quiet: Boolean, val what: String, val call: Boolean = false)

    companion object {
        private val NX = Regex("^nx[0-9a-z]{8}$")
        fun classify(json: String): Info {
            val o = try { JSONObject(json) } catch (e: Exception) { return Info(Kind.IGNORE, "", "", false, "") }
            val type = o.optString("type"); val t = o.optString("t")
            val from = (o.optString("from").ifEmpty { o.optString("fr") }).lowercase()
            if (type == "chat" && o.optString("msgId").isNotEmpty() && NX.matches(from)) {
                val toMe = o.optString("to").isEmpty()
                if (toMe) return Info(Kind.MESSAGE, from, o.optString("msgId"), o.optInt("q") == 1, "text", o.optInt("cl") == 1)
            }
            if ((type == "ack" || type == "read_receipt") && o.optString("msgId").isNotEmpty() && o.optString("to").isEmpty())
                return Info(Kind.RECEIPT, from, o.optString("msgId"), true, type)
            if ((t == "c" || t == "f") && o.optInt("i", -1) == 0 && NX.matches(from) && o.optString("dt").isEmpty())
                return Info(Kind.NOTIFY_ONLY, from, o.optString("m"), false, if (t == "c") (if (o.optInt("cl") == 1) "call" else "text") else o.optString("tp").ifEmpty { "file" })
            return Info(Kind.IGNORE, from, "", false, "")
        }
    }

    @Synchronized fun add(deviceId: String, json: String): Boolean {
        if (file.exists() && file.length() + json.length > maxBytes) return false
        file.appendText(JSONObject().put("d", deviceId).put("c", json).put("ts", System.currentTimeMillis()).toString() + "\n")
        return true
    }

    // Todo lo guardado, en orden, y el buzón queda vacío
    @Synchronized fun drain(): List<Pair<String, String>> {
        if (!file.exists()) return emptyList()
        val out = mutableListOf<Pair<String, String>>()
        file.readLines().forEach { line -> try { val o = JSONObject(line); out.add(o.getString("d") to o.getString("c")) } catch (e: Exception) {} }
        file.delete()
        return out
    }

    @Synchronized fun size(): Int = if (file.exists()) file.readLines().count { it.isNotBlank() } else 0
}
