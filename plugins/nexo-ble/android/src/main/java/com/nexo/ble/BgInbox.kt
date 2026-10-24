package com.nexo.ble

import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * Recibir por Bluetooth con la app cerrada (ronda 2758, plan del dueño punto 12). Al cerrar la app el servidor GATT
 * sigue (el proceso vive por el BleService) pero no hay app que procese lo que llega. Lo que llega se clasifica aquí:
 *  - mensaje ('chat' con msgId y remitente; ronda 2763: si es de un grupo, con su id 'g'): al buzón (disco), confirmación de entrega al emisor (✓✓: ya está a salvo
 *    en este teléfono) y notificación "Mensaje nuevo" (sin texto: va cifrado; no si viene marcado q:1 = acción oculta)
 *  - confirmaciones ('ack', 'read_receipt'): al buzón
 *  - primer trozo de un texto largo o de un archivo de un NEXO ID conocido: solo notificación (el emisor lo tiene
 *    pendiente y lo manda al abrir la app: sin la app no se pueden confirmar trozos)
 *  - oferta de llamada (marca cl:1, ronda 2759): como un mensaje, pero el aviso dice "📞 Llamada entrante" (al abrir la
 *    app en menos de 60 s suena)
 *  - ronda 2760: lo que llega por Jump para este teléfono (sobre sellado 'sx', mensaje o primer trozo con destino = mi
 *    NEXO ID): solo notificación (el puente lo guarda y lo vuelve a mandar; con remitente oculto, sin nombre)
 *  - lo demás (control, trozos, rutas…): nada (al abrir la app se rehace)
 * Al abrir la app, el buzón se entrega en orden como si acabara de llegar (la app descifra y quita repetidos).
 * Sin dependencias de Android: se prueba en JVM (BgInboxTest).
 */
class BgInbox(private val file: File, private val maxBytes: Long = 3_000_000) {
    enum class Kind { MESSAGE, RECEIPT, NOTIFY_ONLY, IGNORE }
    class Info(val kind: Kind, val from: String, val msgId: String, val quiet: Boolean, val what: String, val call: Boolean = false, val group: String = "")

    companion object {
        private val NX = Regex("^nx[0-9a-z]{8}$")
        private val GID = Regex("^gr[0-9a-z]{8}$")
        // me: mi NEXO ID (para reconocer lo que llega por Jump); vacío = no se mira
        fun classify(json: String, me: String = ""): Info {
            val o = try { JSONObject(json) } catch (e: Exception) { return Info(Kind.IGNORE, "", "", false, "") }
            val type = o.optString("type"); val t = o.optString("t")
            val from = (o.optString("from").ifEmpty { o.optString("fr") }).lowercase()
            val mine = me.isNotEmpty() && NX.matches(me.lowercase())
            if (type == "chat" && o.optString("msgId").isNotEmpty() && NX.matches(from)) {
                val to = o.optString("to").lowercase()
                // ronda 2763: mensaje de grupo directo: el id del grupo (para el nombre en el aviso)
                if (to.isEmpty()) return Info(Kind.MESSAGE, from, o.optString("msgId"), o.optInt("q") == 1, "text", o.optInt("cl") == 1,
                    o.optString("g").lowercase().takeIf { GID.matches(it) } ?: "")
                if (mine && to == me.lowercase()) return Info(Kind.NOTIFY_ONLY, from, o.optString("msgId"), o.optInt("q") == 1, "text")
            }
            if (mine && type == "sx" && o.optString("to").lowercase() == me.lowercase() && o.optString("msgId").isNotEmpty())
                return Info(Kind.NOTIFY_ONLY, "", o.optString("msgId"), false, "text")
            if (mine && (t == "c" || t == "f") && o.optInt("i", -1) == 0 && o.optString("dt").lowercase() == me.lowercase())
                return Info(Kind.NOTIFY_ONLY, if (NX.matches(from)) from else "", o.optString("m"), o.optInt("q") == 1, if (t == "c") "text" else o.optString("tp").ifEmpty { "file" })
            if ((type == "ack" || type == "read_receipt") && o.optString("msgId").isNotEmpty() && o.optString("to").isEmpty())
                return Info(Kind.RECEIPT, from, o.optString("msgId"), true, type)
            if ((t == "c" || t == "f") && o.optInt("i", -1) == 0 && NX.matches(from) && o.optString("dt").isEmpty())
                return Info(Kind.NOTIFY_ONLY, from, o.optString("m"), o.optInt("q") == 1, if (t == "c") (if (o.optInt("cl") == 1) "call" else "text") else o.optString("tp").ifEmpty { "file" },
                    group = o.optString("g").lowercase().takeIf { GID.matches(it) } ?: "")
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
