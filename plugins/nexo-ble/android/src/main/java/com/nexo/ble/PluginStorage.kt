package com.nexo.ble

import android.os.Build
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.io.File

// Archivos de la app, cifrado en reposo, huella y pantalla segura.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

private fun NexoBlePlugin.ioFor(name: String) = if (name.startsWith("nexo_att_") || name.startsWith("nexo_relay_")) ioBig else ioSmall
private fun NexoBlePlugin.ioRun(name: String, op: String, call: PluginCall, block: () -> Unit) {
    ioFor(name).execute {
        val t0 = System.currentTimeMillis()
        try { block() } catch (e: Throwable) { call.reject("Error $op archivo: ${e.message}") }
        val ms = System.currentTimeMillis() - t0
        // Sin el nombre (puede llevar el NEXO ID de un contacto): solo el tipo
        if (ms > 300) remLog("WARN", "FILE_IO", "$op lento: ${ms} ms (${if (ioFor(name) === ioBig) "adjunto" else name.substringBefore("_nx").substringBefore(".")})")
    }
}

internal fun NexoBlePlugin.saveToFileImpl(call: PluginCall) {
    val filename = call.getString("filename") ?: run {
        call.reject("filename requerido")
        return
    }
    if (moveFrozen) { call.resolve(JSObject().put("success", true).put("frozen", true)); return } // pasando la cuenta
    val content = call.getString("content") ?: run {
        call.reject("content requerido")
        return
    }
    val path = File(context.filesDir, filename).absolutePath
    ioRun(filename, "guardando", call) {
        atRest().write(filename, content) // cifrado en reposo (AtRestStore)
        call.resolve(JSObject().put("success", true).put("path", path))
    }
}

internal fun NexoBlePlugin.loadFromFileImpl(call: PluginCall) {
    val filename = call.getString("filename") ?: run {
        call.reject("filename requerido")
        return
    }
    val path = File(context.filesDir, filename).absolutePath
    ioRun(filename, "leyendo", call) {
        val content = atRest().read(filename)
        if (content == null) call.resolve(JSObject().put("exists", false).put("content", ""))
        else call.resolve(JSObject().put("exists", true).put("content", content).put("path", path))
    }
}

internal fun NexoBlePlugin.deleteFileImpl(call: PluginCall) {
    val filename = call.getString("filename") ?: run {
        call.reject("filename requerido")
        return
    }
    if (moveFrozen) { call.resolve(JSObject().put("deleted", false).put("frozen", true)); return }
    ioRun(filename, "borrando", call) {
        call.resolve(JSObject().put("deleted", atRest().delete(filename)))
    }
}

internal fun NexoBlePlugin.atRestStatusImpl(call: PluginCall) {
    call.resolve(JSObject().put("active", atRestDataKey() != null).put("migration", atRestMigration))
}

// Ronda 2803 (pedido del dueño #103): «Face ID opcional». Por defecto exige biometría FUERTE (Clase 3) en API 30+,
// que en muchos teléfonos deja fuera el ROSTRO (es Clase 2/débil, se engaña con una foto) y solo ofrece la huella.
// Si el usuario activa el «desbloqueo rápido por rostro (menos seguro)», se permite BIOMETRIC_WEAK y entonces el
// rostro Clase 2 también desbloquea. Es solo una puerta de presencia (no cifra nada), así que el cambio es seguro;
// el aviso de «menos seguro» es honesto. En API <30 ya se usaba WEAK (STRONG+credential daba problemas ahí).
private fun NexoBlePlugin.biometricAuthenticators(allowWeak: Boolean): Int =
    if (allowWeak || Build.VERSION.SDK_INT < 30) BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL
    else BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL

internal fun NexoBlePlugin.biometricStatusImpl(call: PluginCall) {
    val r = BiometricManager.from(context).canAuthenticate(biometricAuthenticators(call.getBoolean("allowWeak", false) == true))
    call.resolve(JSObject().put("available", r == BiometricManager.BIOMETRIC_SUCCESS).put("code", r))
}

// Huella / cara / PIN del teléfono. Resuelve { ok: true } o { ok: false, reason }
internal fun NexoBlePlugin.biometricAuthImpl(call: PluginCall) {
    val act = activity as? FragmentActivity ?: run { call.resolve(JSObject().put("ok", false).put("reason", "sin actividad")); return }
    val title = call.getString("title") ?: "Desbloquear NEXO"
    val subtitle = call.getString("subtitle") ?: ""
    val allowWeak = call.getBoolean("allowWeak", false) == true   // #103: desbloqueo rápido por rostro (opcional)
    act.runOnUiThread {
        try {
            val prompt = BiometricPrompt(act, ContextCompat.getMainExecutor(context), object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { call.resolve(JSObject().put("ok", true)) }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) { call.resolve(JSObject().put("ok", false).put("reason", errString.toString()).put("code", errorCode)) }
            })
            val info = BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle(subtitle).setAllowedAuthenticators(biometricAuthenticators(allowWeak)).build()
            prompt.authenticate(info)
        } catch (e: Exception) {
            call.resolve(JSObject().put("ok", false).put("reason", e.message ?: "error"))
        }
    }
}

// Bloquear capturas y grabación de pantalla (y ocultar NEXO en "recientes")
internal fun NexoBlePlugin.setSecureScreenImpl(call: PluginCall) {
    val on = call.getBoolean("on") ?: false
    val act = activity ?: run { call.reject("sin actividad"); return }
    act.runOnUiThread {
        if (on) act.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else act.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        call.resolve(JSObject().put("on", on))
    }
}

internal fun NexoBlePlugin.listFilesImpl(call: PluginCall) {
    try {
        val dir: File = activity.filesDir
        val fileArray: Array<File>? = dir.listFiles()
        val fileNames: List<String> = if (fileArray != null) {
            fileArray.map { file: File -> file.name }
        } else {
            emptyList<String>()
        }
        val arr = JSArray()
        for (name in fileNames) {
            arr.put(name)
        }
        call.resolve(JSObject().put("files", arr))
    } catch (e: Exception) {
        call.reject("Error listando archivos: ${e.message}")
    }
}
