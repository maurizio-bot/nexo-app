package com.nexo.ble

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import org.json.JSONObject

// Actualizador del APK de probadores (UpdateSpec): buscar, avisar, bajar e instalar.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

// 3008: número de la actualización que se está bajando ahora (0 = ninguna). Fuera del plugin: si la pantalla se rehace (y con ella el
// plugin), la descarga en curso sigue en su hilo y no se empieza otra.
internal object UpdDownload { @Volatile var build: Int = 0 }

// 2985 (pedido del dueño 10-11: «actualizaciones automáticas»). Solo para el APK de probadores (la versión de Google Play se
// actualiza por Play). La lógica de decisión vive en UpdateSpec (pura, probada en JVM). updateCheck consulta los lanzamientos
// públicos del repositorio; updateInstall descarga el APK (solo https y hosts de GitHub, con tope de tamaño) y lo abre en el
// instalador del sistema, que pide su confirmación y exige la misma firma que la app instalada.
internal fun NexoBlePlugin.updateCheckImpl(call: PluginCall) {
    val current = call.getInt("current")   // 3105: la versión instalada, para devolver también sus novedades
    Thread {
        var c: java.net.HttpURLConnection? = null
        try {
            c = (java.net.URL("https://api.github.com/repos/maurizio-bot/nexo-app/releases?per_page=8").openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 10_000; readTimeout = 15_000
                setRequestProperty("Accept", "application/vnd.github+json")
                setRequestProperty("User-Agent", "NEXO-updater")
            }
            if (c.responseCode != 200) { call.resolve(JSObject().put("build", JSONObject.NULL).put("reason", "http_" + c.responseCode)); return@Thread }
            val buf = ByteArrayOutputStream()
            c.inputStream.use { ins ->
                val chunk = ByteArray(8192)
                while (true) {
                    val n = ins.read(chunk); if (n < 0) break
                    buf.write(chunk, 0, n)
                    if (buf.size() > UpdateSpec.MAX_JSON_BYTES) { call.resolve(JSObject().put("build", JSONObject.NULL).put("reason", "too_big")); return@Thread }
                }
            }
            val json = buf.toString("UTF-8")
            val l = UpdateSpec.pickLatest(json)
            val cur = UpdateSpec.notesOf(json, current)
            if (l == null) call.resolve(JSObject().put("build", JSONObject.NULL).put("reason", "none").put("curNotes", cur))
            else call.resolve(JSObject().put("build", l.build).put("tag", l.tag).put("url", l.url).put("size", l.size).put("notes", l.notes).put("curNotes", cur))
        } catch (e: Exception) {
            call.resolve(JSObject().put("build", JSONObject.NULL).put("reason", "net"))
        } finally { try { c?.disconnect() } catch (e: Exception) {} }
    }.start()
}

// 2994: aviso del sistema «Hay una versión nueva» con botón «Actualizar» (lo pide la parte web al encontrar una más nueva)
internal fun NexoBlePlugin.updateNotifyImpl(call: PluginCall) {
    val b = call.getInt("build") ?: 0
    val size = (call.getDouble("size") ?: 0.0).toLong()
    val notes = call.getString("notes") ?: ""   // 3107: novedades de esa versión (texto)
    if (b > 0) MsgNotifier.get(context).updateAvailable(b, size, notes)
    call.resolve()
}

// 3008 (dueño 11-11: «si pulso afuera mientras descargo y luego vuelvo me hace volver a descargar»): descarga y apertura SEPARADAS.
// mode = "download": solo baja (sigue aunque se cierre la ventana o se salga de la app), a nexo-update-<build>.apk; al terminar avisa
//   (evento onUpdateReady + aviso del sistema «Instalar»). Si ya está bajado no vuelve a bajar; si ya se está bajando, no empieza otra.
// mode = "open": abre el instalador con lo YA bajado (sin descargar). mode = "status": ¿bajado? ¿bajando?
// Sin mode: como antes (baja y abre).
internal fun NexoBlePlugin.updateInstallImpl(call: PluginCall) {
    val url0 = call.getString("url")
    val mode = call.getString("mode") ?: ""
    val build = call.getInt("build") ?: 0
    // Auditoría 23-11 (I-U1): la actualización baja a una subcarpeta propia (nexo_open/upd). Antes iba a nexo_open, donde también caen
    // los archivos del chat con su nombre: un contacto podía mandar «nexo-update-<N>.apk» y el botón «Instalar» abría el suyo. Un
    // archivo del chat no puede llegar aquí (su nombre saneado no lleva «/»); el FileProvider ya cubre nexo_open y lo que cuelga de ella.
    val updDir = File(File(activity.cacheDir, "nexo_open"), "upd").also { it.mkdirs() }
    try { File(activity.cacheDir, "nexo_open").listFiles()?.forEach { if (it.isFile && it.name.startsWith("nexo-update")) it.delete() } } catch (e: Exception) {}
    val readyFile: File? = if (build > 0) File(updDir, "nexo-update-$build.apk") else null
    val isReady = readyFile != null && readyFile.isFile && readyFile.length() > 0L
    if (mode == "status") {
        call.resolve(JSObject().put("ready", isReady).put("downloading", build > 0 && UpdDownload.build == build)); return
    }
    if (mode == "open") {
        if (readyFile == null || !isReady) { call.resolve(JSObject().put("opened", false).put("reason", "missing")); return }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            call.resolve(JSObject().put("opened", false).put("reason", "install_permission")); return
        }
        val bad = apkNotOurs(readyFile)
        if (bad != null) { readyFile.delete(); remLog("WARN", "UPDATE", "La actualización $build no es de NEXO ($bad): borrada"); call.resolve(JSObject().put("opened", false).put("reason", "not_ours")); return }
        try { launchView(readyFile, "application/vnd.android.package-archive"); MsgNotifier.get(context).cancelUpdate(); call.resolve(JSObject().put("opened", true)) }
        catch (e: ActivityNotFoundException) { call.resolve(JSObject().put("opened", false).put("reason", "no_app")) }
        catch (e: Exception) { call.resolve(JSObject().put("opened", false).put("reason", "launch")) }
        return
    }
    if (!UpdateSpec.isAllowedStartUrl(url0)) { call.resolve(JSObject().put("opened", false).put("reason", "bad_url")); return }
    val dlOnly = mode == "download" && readyFile != null
    if (dlOnly) {
        if (isReady) { call.resolve(JSObject().put("ready", true)); return }
        if (UpdDownload.build == build) { call.resolve(JSObject().put("downloading", true)); return }
        UpdDownload.build = build
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
        // Android pide permitir a NEXO instalar apps (una sola vez); al volver, el usuario toca «Actualizar» otra vez
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve(JSObject().put("opened", false).put("reason", "install_permission")); return
    }
    Thread {
        var c: java.net.HttpURLConnection? = null
        try {
            var url = url0 as String
            var hops = 0
            while (true) {
                c = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                    connectTimeout = 15_000; readTimeout = 30_000; instanceFollowRedirects = false
                    setRequestProperty("User-Agent", "NEXO-updater")
                }
                val code = c.responseCode
                if (code in 300..399) {
                    val loc = c.getHeaderField("Location")
                    val next = try { java.net.URL(java.net.URL(url), loc ?: "").toString() } catch (e: Exception) { "" }
                    c.disconnect()
                    if (++hops > 5 || !UpdateSpec.isAllowedRedirect(next)) { call.resolve(JSObject().put("opened", false).put("reason", "bad_redirect")); return@Thread }
                    url = next; continue
                }
                if (code != 200) { call.resolve(JSObject().put("opened", false).put("reason", "http_$code")); return@Thread }
                break
            }
            val total = c!!.contentLengthLong
            if (total > UpdateSpec.MAX_APK_BYTES) { call.resolve(JSObject().put("opened", false).put("reason", "too_big")); return@Thread }
            val dir = updDir
            dir.listFiles()?.forEach { if (it.name.startsWith("nexo-update")) it.delete() }
            val out = if (dlOnly) File(dir, "nexo-update-$build.part") else File(dir, "nexo-update.apk")
            var done = 0L; var lastPct = -1
            FileOutputStream(out).use { os ->
                c!!.inputStream.use { ins ->
                    val chunk = ByteArray(64 * 1024)
                    while (true) {
                        val n = ins.read(chunk); if (n < 0) break
                        done += n
                        if (done > UpdateSpec.MAX_APK_BYTES) throw java.io.IOException("demasiado grande")
                        os.write(chunk, 0, n)
                        val pct = if (total > 0) (done * 100 / total).toInt() else -1
                        if (pct >= 0 && pct != lastPct && pct % 5 == 0) {
                            lastPct = pct
                            mainHandler.post { try { notifyListeners("onUpdateProgress", JSObject().put("pct", pct).put("done", done).put("total", total)) } catch (e: Exception) {} }
                        }
                    }
                }
            }
            if (total > 0 && done != total) { out.delete(); call.resolve(JSObject().put("opened", false).put("reason", "incomplete")); return@Thread }
            if (dlOnly && readyFile != null) {
                apkNotOurs(out)?.let { bad -> out.delete(); UpdDownload.build = 0; remLog("WARN", "UPDATE", "La actualización $build no es de NEXO ($bad): borrada"); call.resolve(JSObject().put("opened", false).put("reason", "not_ours")); return@Thread }
                if (!out.renameTo(readyFile)) { out.delete(); call.resolve(JSObject().put("opened", false).put("reason", "rename")); return@Thread }
                UpdDownload.build = 0
                remLog("INFO", "UPDATE", "Actualización $build descargada (${readyFile.length()} bytes): lista para instalar")
                try { MsgNotifier.get(context).updateReady(build) } catch (e: Exception) {}
                mainHandler.post { try { notifyListeners("onUpdateReady", JSObject().put("build", build)) } catch (e: Exception) {} }
                call.resolve(JSObject().put("ready", true))
                return@Thread
            }
            apkNotOurs(out)?.let { bad -> out.delete(); remLog("WARN", "UPDATE", "La actualización bajada no es de NEXO ($bad): borrada"); call.resolve(JSObject().put("opened", false).put("reason", "not_ours")); return@Thread }
            mainHandler.post {
                try { launchView(out, "application/vnd.android.package-archive"); call.resolve(JSObject().put("opened", true)) }
                catch (e: ActivityNotFoundException) { call.resolve(JSObject().put("opened", false).put("reason", "no_app")) }
                catch (e: Exception) { call.resolve(JSObject().put("opened", false).put("reason", "launch")) }
            }
        } catch (e: Exception) {
            remLog("WARN", "UPDATE", "No se pudo bajar la actualización: ${e.message}")
            call.resolve(JSObject().put("opened", false).put("reason", "net"))
        } finally {
            try { c?.disconnect() } catch (e: Exception) {}
            if (dlOnly && UpdDownload.build == build) UpdDownload.build = 0
        }
    }.start()
}

// Auditoría 23-11 (I-U1): antes de abrir el instalador se comprueba que el APK es de NEXO: mismo paquete y misma firma que la app
// instalada. null = es nuestro; si no, el motivo. (Android también exige la misma firma para actualizar, pero un APK con OTRO paquete
// y el nombre «NEXO» se instalaría como app nueva.)
@Suppress("DEPRECATION")
internal fun NexoBlePlugin.apkNotOurs(apk: File): String? {
    return try {
        val pm = context.packageManager
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES else android.content.pm.PackageManager.GET_SIGNATURES
        val info = pm.getPackageArchiveInfo(apk.path, flags) ?: return "no se puede leer"
        if (info.packageName != context.packageName) return "otro paquete: ${info.packageName}"
        val mine = pm.getPackageInfo(context.packageName, flags)
        val sigOf = { pi: android.content.pm.PackageInfo ->
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pi.signingInfo?.apkContentsSigners else pi.signatures)
                ?.map { java.security.MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { b -> "%02x".format(b) } }?.toSet() ?: emptySet()
        }
        val a = sigOf(info); val b = sigOf(mine)
        // Con el MISMO paquete, Android ya exige la misma firma para instalar encima; si alguna versión de Android no deja leer la
        // firma del archivo, no se bloquea por eso (lo importante es que no sea otro paquete). Firmas leídas y distintas = fuera.
        if (a.isNotEmpty() && b.isNotEmpty() && a != b) "otra firma" else null
    } catch (e: Exception) { "error al comprobar: ${e.message}" }
}
