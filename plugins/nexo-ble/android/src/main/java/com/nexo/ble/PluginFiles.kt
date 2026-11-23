package com.nexo.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.provider.Settings
import android.util.Base64
import android.content.ContentValues
import android.media.MediaScannerConnection
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream

// Archivos recibidos (abrir, galería, miniatura de PDF) y archivos grandes (BigFile, red local y L2CAP).
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

// ===== Archivos recibidos: abrir con otra app y miniatura de PDF =====

// Nombre seguro para un archivo en la caché (llega del otro teléfono)
private fun NexoBlePlugin.safeFileName(name: String?): String {
    val clean = (name ?: "").substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[^A-Za-z0-9._ ()\\-]"), "_").trim().trimStart('.')
    return (if (clean.isEmpty()) "archivo" else clean).take(80)
}

private fun NexoBlePlugin.writeCacheFile(dirName: String, name: String, b64: String): File {
    val dir = File(activity.cacheDir, dirName)
    dir.mkdirs()
    // Los abiertos hace más de un día ya no hacen falta
    val old = System.currentTimeMillis() - 86400000L
    dir.listFiles()?.forEach { if (it.lastModified() < old) it.delete() }
    val file = File(dir, name)
    FileOutputStream(file).use { it.write(Base64.decode(b64, Base64.DEFAULT)) }
    return file
}

// Escribe el archivo en la caché y lo abre con la app que corresponda (lector de PDF, instalador
// de APK…) mediante el FileProvider de la app. Devuelve opened=false con reason si no se puede.
internal fun NexoBlePlugin.openFileImpl(call: PluginCall) {
    val b64 = call.getString("base64") ?: run { call.reject("base64 requerido"); return }
    val name = safeFileName(call.getString("name"))
    var mime = call.getString("mime") ?: ""
    if (!mime.contains('/')) {
        mime = android.webkit.MimeTypeMap.getSingleton()
            .getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
    }
    try {
        val isApk = mime == "application/vnd.android.package-archive" || name.lowercase().endsWith(".apk")
        if (isApk) mime = "application/vnd.android.package-archive"
        if (isApk && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()) {
            // Android pide permitir a NEXO instalar apps (una sola vez)
            val s = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(s)
            call.resolve(JSObject().put("opened", false).put("reason", "install_permission"))
            return
        }
        val file = writeCacheFile("nexo_open", name, b64)
        launchView(file, mime)
        call.resolve(JSObject().put("opened", true))
    } catch (e: ActivityNotFoundException) {
        call.resolve(JSObject().put("opened", false).put("reason", "no_app"))
    } catch (e: Exception) {
        remLog("WARN", "FILE", "No se pudo abrir el archivo: ${e.message}")
        call.reject("Error abriendo archivo: ${e.message}")
    }
}

internal fun NexoBlePlugin.launchView(file: File, mime: String) {
    val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
    val intent = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, mime)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    activity.startActivity(intent)
    remLog("INFO", "FILE", "Abriendo archivo ($mime, ${file.length()} bytes)")
}

// Ronda 2801 (pedido del dueño #92): guardar una foto/vídeo del chat en la GALERÍA del teléfono.
// API 29+ (lo normal): MediaStore con RELATIVE_PATH e IS_PENDING, sin pedir permiso (almacenamiento acotado).
// API 26-28: carpeta pública clásica + MediaScanner (usa WRITE_EXTERNAL_STORAGE, declarado hasta API 29).
// Devuelve { saved:true } o { saved:false, reason } (nunca lanza; la interfaz muestra un aviso claro).
internal fun NexoBlePlugin.saveToGalleryImpl(call: PluginCall) {
    val b64 = call.getString("base64") ?: run { call.reject("base64 requerido"); return }
    val reqName = safeFileName(call.getString("name"))
    var mime = call.getString("mime") ?: ""
    if (!mime.contains('/')) {
        mime = android.webkit.MimeTypeMap.getSingleton()
            .getMimeTypeFromExtension(reqName.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
    }
    val isVideo = mime.startsWith("video")
    val isImage = mime.startsWith("image")
    val name = if (reqName.contains('.')) reqName
        else reqName + "." + (android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: if (isVideo) "mp4" else "jpg")
    try {
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        val resolver = context.contentResolver
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val collection = when {
                isVideo -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                isImage -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            }
            val relDir = (when {
                isVideo -> Environment.DIRECTORY_MOVIES
                isImage -> Environment.DIRECTORY_PICTURES
                else -> Environment.DIRECTORY_DOWNLOADS
            }) + "/NEXO"
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, relDir)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = resolver.insert(collection, values)
                ?: run { call.resolve(JSObject().put("saved", false).put("reason", "no_uri")); return }
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw java.io.IOException("sin stream")
            val done = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            resolver.update(uri, done, null, null)
            remLog("INFO", "FILE", "Guardado en galería ($mime, ${bytes.size} bytes)")
            call.resolve(JSObject().put("saved", true))
        } else {
            val baseDir = Environment.getExternalStoragePublicDirectory(when {
                isVideo -> Environment.DIRECTORY_MOVIES
                isImage -> Environment.DIRECTORY_PICTURES
                else -> Environment.DIRECTORY_DOWNLOADS
            })
            val dir = File(baseDir, "NEXO").also { it.mkdirs() }
            val outFile = File(dir, name)
            FileOutputStream(outFile).use { it.write(bytes) }
            MediaScannerConnection.scanFile(context, arrayOf(outFile.absolutePath), arrayOf(mime), null)
            remLog("INFO", "FILE", "Guardado en galería (legacy, ${bytes.size} bytes)")
            call.resolve(JSObject().put("saved", true))
        }
    } catch (e: SecurityException) {
        call.resolve(JSObject().put("saved", false).put("reason", "permiso"))
    } catch (e: Exception) {
        remLog("WARN", "FILE", "No se pudo guardar en galería: ${e.message}")
        call.resolve(JSObject().put("saved", false).put("reason", "error"))
    }
}

internal fun NexoBlePlugin.bigDir() = File(context.filesDir, "nexo_big").also { it.mkdirs() }
internal fun NexoBlePlugin.bigProgress(id: String, dir: String): BigNet.Progress {
    var last = 0L
    return BigNet.Progress { b, t ->
        val now = System.currentTimeMillis()
        if (now - last >= 400 || b >= t) { last = now; notifyListeners("onBigProgress", JSObject().put("id", id).put("dir", dir).put("bytes", b).put("total", t)) }
    }
}
internal fun NexoBlePlugin.bigDone(id: String, dir: String, error: String?) {
    if (error != null) remLog("WARN", "FILE_IO", "Archivo grande $id ($dir): $error")
    else remLog("INFO", "FILE_IO", "Archivo grande $id ($dir): completo")
    notifyListeners("onBigDone", JSObject().put("id", id).put("dir", dir).put("ok", error == null).put("error", error ?: ""), true)
}

// Emisor: la app pasa el archivo a trozos (base64) y aquí se cifra a disco con la clave del archivo
internal fun NexoBlePlugin.bigBeginImpl(call: PluginCall) {
    val id = BigFile.safeId(call.getString("id") ?: "")
    val key = try { BigFile.key(call.getString("key") ?: "") } catch (e: Exception) { call.reject("clave no válida"); return }
    if (id.isEmpty()) { call.reject("id requerido"); return }
    bigWriters.remove(id)?.abort()
    bigWriters[id] = BigWriter(BigFile.encFile(bigDir(), id), key, id)
    call.resolve(JSObject().put("ok", true))
}

internal fun NexoBlePlugin.bigAppendImpl(call: PluginCall) {
    val id = BigFile.safeId(call.getString("id") ?: "")
    val w = bigWriters[id] ?: run { call.reject("sin preparar", "BIG_NONE"); return }
    try {
        val last = call.getBoolean("last", false) == true
        w.append(Base64.decode(call.getString("data") ?: "", Base64.NO_WRAP), last)
        if (last) bigWriters.remove(id)
        call.resolve(JSObject().put("bytes", w.plainBytes).put("enc", w.file.length()))
    } catch (e: Exception) {
        bigWriters.remove(id); w.abort()
        call.reject("No se pudo preparar: ${e.message}", "BIG_WRITE")
    }
}

internal fun NexoBlePlugin.bigStatusImpl(call: PluginCall) {
    val f = BigFile.encFile(bigDir(), call.getString("id") ?: "")
    call.resolve(JSObject().put("have", f.exists() && !bigWriters.containsKey(BigFile.safeId(call.getString("id") ?: ""))).put("bytes", if (f.exists()) f.length() else 0))
}

internal fun NexoBlePlugin.bigDeleteImpl(call: PluginCall) {
    val id = BigFile.safeId(call.getString("id") ?: "")
    bigWriters.remove(id)?.abort()
    BigFile.encFile(bigDir(), id).delete()
    call.resolve(JSObject().put("ok", true))
}

// Receptor por el mismo Wi-Fi: abre un puerto para esta transferencia (solo acepta id + token) y devuelve el puerto
internal fun NexoBlePlugin.bigServeImpl(call: PluginCall) {
    val id = BigFile.safeId(call.getString("id") ?: "")
    val token = call.getString("token") ?: ""
    if (id.isEmpty() || token.length < 16) { call.reject("id y token requeridos"); return }
    try {
        val server = java.net.ServerSocket(0)
        server.soTimeout = 60000
        call.resolve(JSObject().put("port", server.localPort))
        Thread {
            try { BigNet.serve(server, id, token, BigFile.encFile(bigDir(), id), BigFile.MAX_BYTES * 11 / 10, bigProgress(id, "in")); bigDone(id, "in", null) }
            catch (e: Exception) { bigDone(id, "in", e.message ?: "error") }
            finally { try { server.close() } catch (e: Exception) {} }
        }.start()
    } catch (e: Exception) { call.reject("Puerto no disponible: ${e.message}", "BIG_SOCKET") }
}

// Emisor por el mismo Wi-Fi: a la dirección del contacto en la conexión Wi-Fi (LanHub) y al puerto que abrió
internal fun NexoBlePlugin.bigSendLanImpl(call: PluginCall) {
    val id = BigFile.safeId(call.getString("id") ?: "")
    val nx = (call.getString("nx") ?: "").lowercase()
    val port = call.getInt("port") ?: 0
    val token = call.getString("token") ?: ""
    val file = BigFile.encFile(bigDir(), id)
    val addr = lanHub?.address(nx) ?: run { call.reject("Sin Wi-Fi con $nx", "LAN_DOWN"); return }
    if (!file.exists() || port <= 0) { call.reject("Nada que enviar", "BIG_NONE"); return }
    Thread {
        try {
            java.net.Socket().use { s ->
                s.connect(java.net.InetSocketAddress(addr, port), 10000)
                s.soTimeout = 60000
                BigNet.send(s, id, token, file, bigProgress(id, "out"))
            }
            bigDone(id, "out", null)
            call.resolve(JSObject().put("ok", true).put("bytes", file.length()))
        } catch (e: Exception) {
            bigDone(id, "out", e.message ?: "error")
            call.reject("Envío fallido: ${e.message}", "BIG_SEND")
        }
    }.start()
}

// ===== Archivos grandes por Bluetooth L2CAP (ronda 2758, plan del dueño punto 13) =====
// Canal de flujo directo sobre la conexión Bluetooth (Android 10+): sin GATT, sin trozos con confirmación ni
// base64; lo mismo que por el Wi-Fi (BigNet), con un canal L2CAP en vez de un puerto. Más lento que el Wi-Fi.
private fun NexoBlePlugin.l2Adapter(): android.bluetooth.BluetoothAdapter? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    val ctx = appCtx ?: activity.applicationContext
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !isGranted(ctx, android.Manifest.permission.BLUETOOTH_CONNECT)) return null
    val a = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    return if (a != null && a.isEnabled) a else null
}

internal fun NexoBlePlugin.l2InfoImpl(call: PluginCall) {
    call.resolve(JSObject().put("ok", l2Adapter() != null).put("sdk", Build.VERSION.SDK_INT).put("payload", true)) // payload (3288): también lo mediano
}

// Receptor: abre un canal L2CAP para esta transferencia (solo acepta id + token) y devuelve su número (PSM)
@android.annotation.SuppressLint("MissingPermission", "NewApi") // comprobados en l2Adapter()
internal fun NexoBlePlugin.bigServeL2Impl(call: PluginCall) {
    val id = BigFile.safeId(call.getString("id") ?: "")
    val token = call.getString("token") ?: ""
    if (id.isEmpty() || token.length < 16) { call.reject("id y token requeridos"); return }
    val adapter = l2Adapter() ?: run { call.reject("L2CAP no disponible (Android 10+ y Bluetooth activo)", "L2_NONE"); return }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    try {
        val server = adapter.listenUsingInsecureL2capChannel()
        val psm = server.psm
        call.resolve(JSObject().put("psm", psm))
        remLog("INFO", "FILE_IO", "[L2CAP] Esperando $id en el canal $psm")
        Thread {
            val until = System.currentTimeMillis() + 60000
            try {
                while (true) {
                    val left = until - System.currentTimeMillis()
                    if (left <= 0) throw Exception("Accept timed out")
                    val sock = server.accept(left.toInt())
                    // Auditoría 23-11 (T-L1): como BigNet.serve, una conexión ajena (basura, otra cabecera, callada) se descarta y se sigue
                    // esperando la buena. Antes su error salía del bucle y la espera moría; y una callada lo bloqueaba para siempre (un
                    // canal Bluetooth no tiene plazo propio): ahora tiene PayloadNet.HEADER_MS para empezar y 60 s sin avanzar después.
                    val pr = bigProgress(id, "in")
                    val lastAt = java.util.concurrent.atomic.AtomicLong(0L)   // 0 = aún sin la cabecera buena
                    val guard = object : Runnable { override fun run() {
                        if (System.currentTimeMillis() - lastAt.get() > 60000) { try { sock.close() } catch (e: Exception) {} } else mainHandler.postDelayed(this, 5000)
                    } }
                    val headGuard = Runnable { if (lastAt.get() == 0L) try { sock.close() } catch (e: Exception) {} }
                    mainHandler.postDelayed(headGuard, PayloadNet.HEADER_MS.toLong())
                    val ok = try {
                        BigNet.receive(sock.inputStream, sock.outputStream, id, token, BigFile.encFile(bigDir(), id), BigFile.MAX_BYTES * 11 / 10, BigNet.Progress { done, total ->
                            if (lastAt.getAndSet(System.currentTimeMillis()) == 0L) { mainHandler.removeCallbacks(headGuard); mainHandler.postDelayed(guard, 5000) }
                            pr.on(done, total)
                        })
                    } catch (e: Exception) {
                        if (lastAt.get() != 0L) throw e   // ya era la buena (tenía el token) y se cortó: eso sí termina la espera
                        false
                    } finally { mainHandler.removeCallbacks(headGuard); mainHandler.removeCallbacks(guard); try { sock.close() } catch (e: Exception) {} }
                    if (ok) break
                }
                bigDone(id, "in", null)
            } catch (e: Exception) { bigDone(id, "in", "L2CAP: " + (e.message ?: "error")) }
            finally { try { server.close() } catch (e: Exception) {} }
        }.start()
    } catch (e: Exception) { call.reject("Canal L2CAP no disponible: ${e.message}", "L2_SOCKET") }
}

// Emisor: al teléfono de esa conexión Bluetooth, al canal que abrió
@android.annotation.SuppressLint("MissingPermission", "NewApi") // comprobados en l2Adapter()
// ===== 3288 (23-11, COLA 14): archivos MEDIANOS por el canal L2CAP =====
// Los grandes ya iban por aquí de disco a disco (bigServeL2 / bigSendL2). Lo mediano (una foto, una nota de voz, un PDF: lo que la
// app tiene en memoria, ya cifrado de punta a punta) iba en trozos por el enlace normal a ~17 KB/s. Mismo canal, mismo formato que
// la recepción por Wi-Fi Direct (cabecera { id, len } + contenido + un byte de «recibido»). Si algo falla, la app sigue en trozos.
internal const val L2_PAYLOAD_MAX = 4L * 1024 * 1024

internal fun NexoBlePlugin.l2PayloadHostImpl(call: PluginCall) {
    val id = call.getString("transferId") ?: run { call.reject("transferId requerido"); return }
    val expect = (call.getInt("size") ?: 0).toLong()
    // Auditoría 23-11 (T-L1): token de esta transferencia (lo pone la app y viaja en «la» por el enlace del contacto)
    val token = call.getString("token") ?: ""
    if (token.length < 16 || expect <= 0) { call.reject("token y tamaño requeridos", "L2_NONE"); return }
    val adapter = l2Adapter() ?: run { call.reject("L2CAP no disponible (Android 10+ y Bluetooth activo)", "L2_NONE"); return }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("L2CAP no disponible", "L2_NONE"); return }
    try {
        try { l2PayloadServer?.close() } catch (e: Exception) {}
        val server = adapter.listenUsingInsecureL2capChannel()
        l2PayloadServer = server
        l2PayloadFor = id
        call.resolve(JSObject().put("psm", server.psm))
        remLog("INFO", "FILE_IO", "[L2CAP] Esperando el archivo mediano $id en el canal ${server.psm}")
        Thread {
            // T-L1: se aceptan conexiones hasta la buena (id + token + el tamaño anunciado); una ajena se cierra y se sigue esperando.
            // T-E1: el byte de «recibido» sale cuando la app confirma que lo descifró (l2PayloadCancel con ack), no al tener los bytes.
            try {
                val res = PayloadNet.serve({ left -> l2Conn(server.accept(left.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())) }, 15000, id, token, expect, L2_PAYLOAD_MAX,
                    60000 + (expect / 20).toInt(), { buf, readMs ->
                        remLog("INFO", "FILE_IO", "[L2CAP] Recibido $id (${buf.size} bytes) en $readMs ms: la app lo descifra antes de confirmar")
                        notifyListeners("onL2PayloadReceived", JSObject().put("transferId", id).put("data", String(buf, Charsets.UTF_8)).put("bytes", buf.size).put("readMs", readMs), true)
                    })
                remLog(if (res.delivered) "INFO" else "WARN", "FILE_IO", "[L2CAP] $id " + (if (res.delivered) "confirmado" else "SIN confirmar (la app no lo pudo leer): quien envía sigue en trozos") +
                    (if (res.rejected > 0) " (${res.rejected} conexiones ajenas descartadas)" else ""))
            } catch (e: Exception) {
                remLog("WARN", "FILE_IO", "[L2CAP] Recepción fallida de $id: ${e.message}")
                notifyListeners("onL2PayloadReceived", JSObject().put("transferId", id).put("error", e.message ?: "error"), true)
            } finally {
                try { server.close() } catch (e: Exception) {}
                if (l2PayloadServer === server) { l2PayloadServer = null; l2PayloadFor = null }
            }
        }.start()
    } catch (e: Exception) { call.reject("Canal L2CAP no disponible: ${e.message}", "L2_SOCKET") }
}

// Un canal L2CAP aceptado como PayloadNet.Conn: un BluetoothSocket no tiene plazo de lectura propio, así que el plazo es un
// vigilante que cierra el canal (eso desbloquea la lectura con error)
private fun NexoBlePlugin.l2Conn(sock: android.bluetooth.BluetoothSocket): PayloadNet.Conn = object : PayloadNet.Conn {
    private var guard: Runnable? = null
    override val input: java.io.InputStream = java.io.BufferedInputStream(sock.inputStream)
    override val output: java.io.OutputStream = sock.outputStream
    override fun limit(ms: Int) {
        guard?.let { mainHandler.removeCallbacks(it) }
        val g = Runnable { try { sock.close() } catch (e: Exception) {} }
        guard = g
        mainHandler.postDelayed(g, ms.toLong())
    }
    override fun close() { guard?.let { mainHandler.removeCallbacks(it) }; try { sock.close() } catch (e: Exception) {} }
}

internal fun NexoBlePlugin.l2PayloadSendImpl(call: PluginCall) {
    val id = call.getString("transferId") ?: run { call.reject("transferId requerido"); return }
    val raw = call.getString("deviceId") ?: ""
    val psm = call.getInt("psm") ?: 0
    val data = call.getString("data") ?: ""
    val token = call.getString("token") ?: ""   // T-L1: el que puso quien recibe (en «la»)
    val adapter = l2Adapter() ?: run { call.reject("L2CAP no disponible", "L2_NONE"); return }
    if (psm <= 0 || data.isEmpty() || token.length < 16) { call.reject("Nada que enviar", "L2_NONE"); return }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("L2CAP no disponible", "L2_NONE"); return }
    val mac = normalizeMac(raw)
    val device = gattClients[mac]?.device ?: serverConnectedDevices[mac] ?: scannedDevices[mac]
        ?: formatMacForAndroid(raw)?.let { try { adapter.getRemoteDevice(it.uppercase()) } catch (e: Exception) { null } }
        ?: run { call.reject("Dirección no válida: $raw", "INVALID_MAC"); return }
    Thread {
        var s: android.bluetooth.BluetoothSocket? = null
        // Abrir el canal puede colgarse si el otro ya no está: a los 10 s se corta (cerrar el canal desde otro hilo lo desbloquea)
        val guard = Runnable { try { s?.close() } catch (e: Exception) {} }
        try {
            val t0 = System.currentTimeMillis()
            val bytes = data.toByteArray(Charsets.UTF_8)
            s = device.createInsecureL2capChannel(psm)
            mainHandler.postDelayed(guard, 10000)
            s.connect()
            mainHandler.removeCallbacks(guard)
            val connectMs = System.currentTimeMillis() - t0
            // contenido a 20 KB/s como mínimo + lo que el otro tarda en descifrarlo antes de confirmar (T-E1)
            mainHandler.postDelayed(guard, 15000L + PayloadNet.ACK_WAIT_MS + bytes.size / 20)
            val out = java.io.DataOutputStream(java.io.BufferedOutputStream(s.outputStream))
            out.writeUTF(PayloadNet.headerJson(id, token, bytes.size))
            out.write(bytes)
            out.flush()
            if (s.inputStream.read() != 1) throw Exception("sin confirmación")
            val ms = System.currentTimeMillis() - t0
            remLog("INFO", "FILE_IO", "[L2CAP] $id: ${bytes.size / 1024} KB en $ms ms (abrir el canal $connectMs ms)")
            call.resolve(JSObject().put("ok", true).put("bytes", bytes.size).put("ms", ms).put("connectMs", connectMs))
        } catch (e: Exception) {
            remLog("WARN", "FILE_IO", "[L2CAP] Envío fallido de $id: ${e.message}")
            call.reject("Envío fallido: ${e.message}", "L2_SEND")
        } finally {
            mainHandler.removeCallbacks(guard)
            try { s?.close() } catch (e: Exception) {}
        }
    }.start()
}

// Quien iba a mandar se rindió: se cierra el canal que lo esperaba (la espera termina con error y avisa a la app)
// T-E1: con `ack` (1 / 0) no cancela: es la app diciendo si pudo descifrar lo recibido (manda o no el byte de «recibido»)
internal fun NexoBlePlugin.l2PayloadCancelImpl(call: PluginCall) {
    val id = call.getString("transferId") ?: run { call.reject("transferId requerido"); return }
    val ack = call.getInt("ack")
    if (ack == 0 || ack == 1) { call.resolve(JSObject().put("acked", PayloadNet.ack(id, ack == 1))); return }
    val server = l2PayloadServer
    if (server == null || l2PayloadFor != id) { call.resolve(JSObject().put("cancelled", false)); return }
    try { server.close() } catch (e: Exception) {}
    call.resolve(JSObject().put("cancelled", true))
}

internal fun NexoBlePlugin.bigSendL2Impl(call: PluginCall) {
    val id = BigFile.safeId(call.getString("id") ?: "")
    val raw = call.getString("deviceId") ?: ""
    val psm = call.getInt("psm") ?: 0
    val token = call.getString("token") ?: ""
    val file = BigFile.encFile(bigDir(), id)
    val adapter = l2Adapter() ?: run { call.reject("L2CAP no disponible", "L2_NONE"); return }
    if (!file.exists() || psm <= 0) { call.reject("Nada que enviar", "BIG_NONE"); return }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    val mac = normalizeMac(raw)
    val device = gattClients[mac]?.device ?: serverConnectedDevices[mac] ?: scannedDevices[mac]
        ?: formatMacForAndroid(raw)?.let { try { adapter.getRemoteDevice(it.uppercase()) } catch (e: Exception) { null } }
        ?: run { call.reject("Dirección no válida: $raw", "INVALID_MAC"); return }
    Thread {
        try {
            val t0 = System.currentTimeMillis()
            device.createInsecureL2capChannel(psm).use { s ->
                s.connect()
                remLog("INFO", "FILE_IO", "[L2CAP] Canal abierto con $mac en ${System.currentTimeMillis() - t0} ms")
                BigNet.send(s.inputStream, s.outputStream, id, token, file, bigProgress(id, "out"))
            }
            val ms = System.currentTimeMillis() - t0
            remLog("INFO", "FILE_IO", "[L2CAP] $id: ${file.length() / 1024} KB en ${ms / 1000} s (${if (ms > 0) file.length() / ms else 0} KB/s)")
            bigDone(id, "out", null)
            call.resolve(JSObject().put("ok", true).put("bytes", file.length()).put("ms", ms))
        } catch (e: Exception) {
            bigDone(id, "out", "L2CAP: " + (e.message ?: "error"))
            call.reject("Envío fallido: ${e.message}", "BIG_SEND")
        }
    }.start()
}

// Abrir: se descifra a la caché y se abre como cualquier archivo (instalador de APK, lector de PDF…)
internal fun NexoBlePlugin.bigOpenImpl(call: PluginCall) {
    val id = BigFile.safeId(call.getString("id") ?: "")
    val name = safeFileName(call.getString("name"))
    var mime = call.getString("mime") ?: ""
    if (!mime.contains('/')) mime = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: "application/octet-stream"
    val enc = BigFile.encFile(bigDir(), id)
    if (!enc.exists()) { call.resolve(JSObject().put("opened", false).put("reason", "missing")); return }
    val key = try { BigFile.key(call.getString("key") ?: "") } catch (e: Exception) { call.reject("clave no válida"); return }
    val isApk = mime == "application/vnd.android.package-archive" || name.lowercase().endsWith(".apk")
    if (isApk) mime = "application/vnd.android.package-archive"
    if (isApk && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve(JSObject().put("opened", false).put("reason", "install_permission")); return
    }
    Thread {
        try {
            val dir = File(activity.cacheDir, "nexo_open").also { it.mkdirs() }
            val old = System.currentTimeMillis() - 86400000L
            dir.listFiles()?.forEach { if (it.lastModified() < old) it.delete() }
            val out = File(dir, name)
            FileOutputStream(out).use { BigReader.decrypt(enc, key, id, it) }
            mainHandler.post {
                try { launchView(out, mime); call.resolve(JSObject().put("opened", true)) }
                catch (e: ActivityNotFoundException) { call.resolve(JSObject().put("opened", false).put("reason", "no_app")) }
                catch (e: Exception) { call.reject("Error abriendo archivo: ${e.message}") }
            }
        } catch (e: Exception) {
            remLog("WARN", "FILE_IO", "Archivo grande $id no se pudo abrir: ${e.message}")
            call.reject("No se pudo abrir: ${e.message}", "BIG_OPEN")
        }
    }.start()
}

// Primera página de un PDF como JPEG (base64) con el lector de PDF de Android, y número de páginas
internal fun NexoBlePlugin.pdfThumbnailImpl(call: PluginCall) {
    val b64 = call.getString("base64") ?: run { call.reject("base64 requerido"); return }
    val width = (call.getInt("width") ?: 320).coerceIn(64, 1024)
    var tmp: File? = null
    var pfd: ParcelFileDescriptor? = null
    var renderer: PdfRenderer? = null
    try {
        tmp = writeCacheFile("nexo_pdf", "thumb_" + System.nanoTime() + ".pdf", b64)
        pfd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY)
        renderer = PdfRenderer(pfd)
        val pages = renderer.pageCount
        if (pages < 1) { call.reject("PDF sin páginas"); return }
        val page = renderer.openPage(0)
        val h = (width.toFloat() * page.height / page.width.coerceAtLeast(1)).toInt().coerceIn(1, width * 2)
        val bmp = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888)
        bmp.eraseColor(Color.WHITE)
        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        page.close()
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 70, out)
        bmp.recycle()
        call.resolve(JSObject().put("thumb", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)).put("pages", pages))
    } catch (e: Exception) {
        call.reject("PDF no legible: ${e.message}")
    } finally {
        try { renderer?.close() } catch (e: Exception) {}
        try { pfd?.close() } catch (e: Exception) {}
        tmp?.delete()
    }
}
