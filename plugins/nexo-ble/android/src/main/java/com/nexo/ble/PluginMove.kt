package com.nexo.ble

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.io.File

// Pasar la cuenta a un teléfono nuevo (AccountMove).
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

private fun NexoBlePlugin.moveRestart() = mainHandler.postDelayed({ try { activity.recreate() } catch (e: Exception) {} }, 1500)
private fun NexoBlePlugin.moveEvent(name: String, o: JSObject) = notifyListeners(name, o, name == "onMoveDone")

// IP de este teléfono en el Wi-Fi (o en su punto de acceso)
private fun NexoBlePlugin.wifiIp(): String? = try {
    java.net.NetworkInterface.getNetworkInterfaces().toList()
        .filter { it.isUp && !it.isLoopback }
        .sortedBy { if (it.name.startsWith("wlan")) 0 else if (it.name.startsWith("ap") || it.name.startsWith("swlan")) 1 else 2 }
        .flatMap { it.inetAddresses.toList() }
        .firstOrNull { it is java.net.Inet4Address && it.isSiteLocalAddress }?.hostAddress
} catch (e: Exception) { null }

// Teléfono NUEVO: abre un puerto y espera la cuenta; antes de confirmar la guarda (si falla, el viejo no borra nada)
internal fun NexoBlePlugin.moveReceiveImpl(call: PluginCall) {
    val ip = wifiIp() ?: run { call.reject("Conecta este teléfono a un Wi-Fi (el mismo que el otro)", "NO_WIFI"); return }
    try {
        val id = "move" + BigFile.token().take(12)
        val token = BigFile.token()
        val keyHex = BigFile.token() + BigFile.token()
        val server = java.net.ServerSocket(0)
        server.soTimeout = 10 * 60000
        call.resolve(JSObject().put("ip", ip).put("port", server.localPort).put("id", id).put("token", token).put("key", keyHex))
        remLog("INFO", "FILE_IO", "[MOVE] Esperando la cuenta en $ip:${server.localPort}")
        Thread {
            val recv = File(context.cacheDir, "$id.enc")
            try {
                var stats: AccountMove.Stats? = null
                BigNet.serve(server, id, token, recv, BigFile.MAX_BYTES * 11 / 10, BigNet.Progress { b, t ->
                    moveEvent("onMoveProgress", JSObject().put("dir", "in").put("bytes", b).put("total", t))
                }) {
                    val key = BigFile.key(keyHex)
                    // Primero comprobar que se descifra entero; luego fuera lo de antes y dentro lo nuevo
                    BigReader.decrypt(recv, key, id, object : java.io.OutputStream() { override fun write(b: Int) {}; override fun write(b: ByteArray, off: Int, len: Int) {} })
                    moveFrozen = true
                    AccountMove.wipe(context.filesDir, moveSkip, bigDir())
                    NetBgHome.forget(context) // 3192: la escucha de internet de la cuenta de antes, fuera (la nueva la configura la app)
                    val pin = java.io.PipedInputStream(1 shl 16); val pout = java.io.PipedOutputStream(pin)
                    var decErr: Throwable? = null
                    val dec = Thread { try { pout.use { BigReader.decrypt(recv, key, id, it) } } catch (e: Throwable) { decErr = e } }
                    dec.start()
                    stats = pin.use { AccountMove.import(it, moveSkip, { n, txt -> atRest().write(n, txt) }, bigDir()) }
                    dec.join(); decErr?.let { throw it }
                }
                remLog("INFO", "FILE_IO", "[MOVE] Cuenta recibida: ${stats?.files} archivos, ${stats?.bigFiles} grandes, ${(stats?.bytes ?: 0) / 1024} KB")
                moveEvent("onMoveDone", JSObject().put("dir", "in").put("ok", true).put("files", stats?.files ?: 0).put("bytes", stats?.bytes ?: 0))
                moveRestart() // la app arranca de nuevo, ya con la cuenta
            } catch (e: Exception) {
                remLog("WARN", "FILE_IO", "[MOVE] No se recibió la cuenta: ${e.message}")
                moveEvent("onMoveDone", JSObject().put("dir", "in").put("ok", false).put("error", e.message ?: "error"))
                if (moveFrozen) { moveFrozen = false; moveRestart() } // se borró lo (vacío) de antes: arrancar limpio
            } finally { try { server.close() } catch (e: Exception) {}; recv.delete() }
        }.start()
    } catch (e: Exception) { call.reject("No se pudo abrir el puerto: ${e.message}", "MOVE_SOCKET") }
}

// Teléfono VIEJO: empaqueta y manda la cuenta; con la confirmación del nuevo, la borra de aquí y deja de anunciarse
internal fun NexoBlePlugin.moveSendImpl(call: PluginCall) {
    val ip = call.getString("ip") ?: ""; val port = call.getInt("port") ?: 0
    val id = call.getString("id") ?: ""; val token = call.getString("token") ?: ""; val keyHex = call.getString("key") ?: ""
    val key = try { BigFile.key(keyHex) } catch (e: Exception) { call.reject("Código no válido", "MOVE_QR"); return }
    if (ip.isEmpty() || port <= 0 || !id.startsWith("move") || token.length < 16) { call.reject("Código no válido", "MOVE_QR"); return }
    moveFrozen = true
    Thread {
        val enc = File(context.cacheDir, "$id.out.enc")
        try {
            val w = BigWriter(enc, key, id)
            val st = BigWriterStream(w).use { AccountMove.export(context.filesDir, moveSkip, { n -> atRest().read(n) }, bigDir(), it) }
            remLog("INFO", "FILE_IO", "[MOVE] Cuenta empaquetada: ${st.files} archivos, ${st.bigFiles} grandes, ${st.bytes / 1024} KB")
            java.net.Socket().use { s ->
                s.connect(java.net.InetSocketAddress(ip, port), 10000)
                s.soTimeout = 10 * 60000 // el nuevo la guarda antes de confirmar
                BigNet.send(s, id, token, enc, BigNet.Progress { b, t -> moveEvent("onMoveProgress", JSObject().put("dir", "out").put("bytes", b).put("total", t)) })
            }
            // Confirmado: la cuenta ya está en el otro teléfono. Aquí deja de existir (nada de recibir ni enviar con ella)
            mainHandler.post {
                try { cleanupAllConnections() } catch (e: Exception) {}
                try { stopAdvertisingInternal() } catch (e: Exception) {}
                try { stopGattServer() } catch (e: Exception) {}
            }
            val n = AccountMove.wipe(context.filesDir, moveSkip, bigDir())
            NetBgHome.forget(context) // 3192: la cuenta ya no está aquí: fuera su escucha de internet (también la de sin la app)
            remLog("INFO", "FILE_IO", "[MOVE] Cuenta pasada al otro teléfono; $n archivos borrados aquí")
            moveEvent("onMoveDone", JSObject().put("dir", "out").put("ok", true).put("files", st.files).put("bytes", st.bytes))
            call.resolve(JSObject().put("ok", true).put("files", st.files).put("bytes", st.bytes))
            moveRestart() // arranca vacía, como recién instalada
        } catch (e: Exception) {
            moveFrozen = false // aquí sigue todo como estaba
            remLog("WARN", "FILE_IO", "[MOVE] No se pasó la cuenta: ${e.message}")
            moveEvent("onMoveDone", JSObject().put("dir", "out").put("ok", false).put("error", e.message ?: "error"))
            call.reject("No se pudo pasar la cuenta: ${e.message}", "MOVE_SEND")
        } finally { enc.delete() }
    }.start()
}
