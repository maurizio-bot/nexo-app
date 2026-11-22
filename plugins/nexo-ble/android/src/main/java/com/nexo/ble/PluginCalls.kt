package com.nexo.ble

import android.content.Context
import android.content.Intent
import android.os.Build
import android.view.WindowManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import androidx.activity.result.ActivityResult
import com.nexo.ble.NexoBlePlugin.Companion.live
import com.nexo.ble.NexoBlePlugin.Companion.TAG

// Llamadas: modo de sonido, audio en llamada, foco, pantalla compartida y PiP.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

// Ronda 2770: modo del timbre (normal / vibrar / silencio) y "No molestar": el tono de llamada de la app lo respeta
// (antes sonaba como multimedia aunque el teléfono estuviera en silencio)
internal fun NexoBlePlugin.ringerModeImpl(call: PluginCall) {
    try {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        val mode = when (am.ringerMode) {
            android.media.AudioManager.RINGER_MODE_SILENT -> "silent"
            android.media.AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
            else -> "normal"
        }
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        val dnd = nm.currentInterruptionFilter > android.app.NotificationManager.INTERRUPTION_FILTER_ALL
        call.resolve(JSObject().put("mode", mode).put("dnd", dnd))
    } catch (e: Exception) { call.reject("Timbre: ${e.message}") }
}

// ===== Llamadas de voz (ronda 2758, calls.js): audio en modo llamada (auricular y cancelación de eco del sistema) =====
// Ronda 2761 (informe del dueño: en una videollamada el Samsung no oía nada): en Android 12+ la salida se elige con
// setCommunicationDevice (isSpeakerphoneOn está obsoleto y algunos fabricantes lo ignoran); se devuelve por dónde
// sale y los volúmenes (llamada y multimedia: el audio de la app sale como multimedia) para el diagnóstico.
internal fun NexoBlePlugin.callAudioImpl(call: PluginCall) {
    try {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        val on = call.getBoolean("on", false) == true
        val speaker = on && call.getBoolean("speaker", false) == true
        if (on) {
            am.mode = android.media.AudioManager.MODE_IN_COMMUNICATION
            if (Build.VERSION.SDK_INT >= 31) {
                val want = if (speaker) android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                val dev = am.availableCommunicationDevices.firstOrNull { it.type == want }
                if (dev != null) am.setCommunicationDevice(dev)
            }
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = speaker
            callScreen(true, !speaker)
            callFgs = callForeground(true)
            callFocus(am, true)
        } else {
            if (Build.VERSION.SDK_INT >= 31) try { am.clearCommunicationDevice() } catch (e: Exception) { }
            am.mode = android.media.AudioManager.MODE_NORMAL
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = false
            callScreen(false, false)
            callFgs = callForeground(false)
            callFocus(am, false)
            // 3282: sin audio de llamada no hay videollamada: la marca «al irse, pasar a miniatura» se quita aquí aunque la página no lo
            // haya pedido (un aviso perdido o tardío la dejaba puesta y el gesto de irse metía el chat en la ventanita)
            if (BleService.pipVideo) { BleService.pipVideo = false; pipAutoEnter(false); remLog("WARN", "PIP", "terminó el audio de la llamada con la marca de miniatura puesta: se quita") }
        }
        val out = JSObject().put("mode", am.mode).put("fgs", callFgs).put("focus", callFocusState)
        @Suppress("DEPRECATION")
        out.put("speakerOn", am.isSpeakerphoneOn)
        if (Build.VERSION.SDK_INT >= 31) out.put("device", when (am.communicationDevice?.type) {
            android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "altavoz"; android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "auricular"
            android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO, android.media.AudioDeviceInfo.TYPE_BLE_HEADSET -> "Bluetooth"
            android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET, android.media.AudioDeviceInfo.TYPE_WIRED_HEADPHONES, android.media.AudioDeviceInfo.TYPE_USB_HEADSET -> "cascos"
            null -> "ninguno"; else -> "otro (${am.communicationDevice?.type})" })
        val vc = android.media.AudioManager.STREAM_VOICE_CALL; val mu = android.media.AudioManager.STREAM_MUSIC
        out.put("volCall", "${am.getStreamVolume(vc)}/${am.getStreamMaxVolume(vc)}").put("volMedia", "${am.getStreamVolume(mu)}/${am.getStreamMaxVolume(mu)}")
        call.resolve(out)
    } catch (e: Exception) { call.reject("Audio de llamada: ${e.message}") }
}

internal fun NexoBlePlugin.callForeground(on: Boolean): String {
    BleService.inCall = on
    val svc = BleService.live ?: return if (on) "sin servicio" else ""
    return try { svc.foreground() } catch (e: Exception) { Log.w(TAG, "Servicio en llamada: ${e.message}"); "error (${e.javaClass.simpleName})" }
}

// 13-11 (dueño): COMPARTIR PANTALLA en la videollamada. Pide el permiso de Android (aviso del sistema, cada vez) y, si
// el usuario acepta, ScreenShareService captura la pantalla y cada imagen llega a la app como onScreenFrame {d: JPEG en
// base64, w, h}; si Android corta la captura, onScreenShareStopped. Resuelve { granted }.
internal fun NexoBlePlugin.screenShareStartImpl(call: PluginCall) {
    if (ScreenShareService.running) { call.resolve(JSObject().put("granted", true)); return }
    try {
        val mpm = context.getSystemService(android.media.projection.MediaProjectionManager::class.java)
        if (mpm == null) { call.reject("Este teléfono no puede compartir la pantalla", "SCREEN_NA"); return }
        startActivityForResult(call, mpm.createScreenCaptureIntent(), "screenSharePicked")
    } catch (e: Exception) { call.reject("No se pudo pedir el permiso de pantalla: ${e.message}", "SCREEN_NA") }
}

internal fun NexoBlePlugin.screenSharePickedImpl(call: PluginCall?, result: ActivityResult) {
    if (call == null) return
    val data = result.data
    if (result.resultCode != android.app.Activity.RESULT_OK || data == null) { call.resolve(JSObject().put("granted", false)); return }
    ScreenShareService.listener = { d, w, h -> notifyListeners("onScreenFrame", JSObject().put("d", d).put("w", w).put("h", h)) }
    ScreenShareService.onStopped = { notifyListeners("onScreenShareStopped", JSObject()) }
    val i = Intent(context, ScreenShareService::class.java)
        .putExtra("code", result.resultCode).putExtra("data", data)
        .putExtra("maxLong", call.getInt("maxLong", 960) ?: 960).putExtra("fps", call.getInt("fps", 5) ?: 5)
    try {
        ContextCompat.startForegroundService(context, i)
        call.resolve(JSObject().put("granted", true))
    } catch (e: Exception) { call.reject("No se pudo empezar a compartir la pantalla: ${e.message}", "SCREEN_NA") }
}

internal fun NexoBlePlugin.screenShareStopImpl(call: PluginCall) {
    ScreenShareService.stop(context)
    call.resolve()
}

// #dueño 01-11: la VIDEOLLAMADA marca pipVideo mientras está activa; así, al irse de la app con el gesto de inicio
// (deslizar hacia arriba), MainActivity entra en Picture-in-Picture (miniatura flotante) y el audio/vídeo no se cortan
// (ya corre el servicio en primer plano de la llamada). Al colgar, el JS lo apaga.
internal fun NexoBlePlugin.setPipActiveImpl(call: PluginCall) {
    val on = call.getBoolean("on", false) ?: false
    if (on != BleService.pipVideo) remLog("INFO", "PIP", "marca «al irse, pasar a miniatura»: " + (if (on) "puesta" else "quitada") + (if (on && !BleService.inCall) " (aún sin audio de llamada)" else ""))
    BleService.pipVideo = on
    pipAutoEnter(on)
    // 3227 (dueño 17-11 22:49, captura: «colgó la S23 y quedó la miniatura así»): al terminar la videollamada con la ventanita
    // abierta, la ventanita se quedaba enseñando la app (el chat en miniatura). Ahora se cierra (la app va atrás, como al salir
    // de una llamada en WhatsApp: el usuario sigue en la app donde estaba).
    if (!on && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        val act = activity
        try {
            if (act != null) act.runOnUiThread {
                try {
                    if (act.isInPictureInPictureMode) { remLog("INFO", "PIP", "La llamada terminó con la ventanita abierta: se cierra"); act.moveTaskToBack(true) }
                } catch (e: Exception) { remLog("WARN", "PIP", "cerrar ventanita: ${e.message}") }
            }
        } catch (e: Exception) {}
    }
    call.resolve()
}

// 3273: con los gestos de Android 12+ el aviso «el usuario se va» (onUserLeaveHint) no siempre llega y la videollamada se quedaba
// atrás, pausada, en vez de pasar a la miniatura. Se le dice a Android que entre SOLO en la miniatura al irse (y se quita al colgar).
internal fun NexoBlePlugin.pipAutoEnter(on: Boolean) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val a0 = activity
    try {
        a0?.runOnUiThread {
            try {
                a0.setPictureInPictureParams(android.app.PictureInPictureParams.Builder()
                    .setAspectRatio(android.util.Rational(9, 16)).setAutoEnterEnabled(on).setSeamlessResizeEnabled(false).build())
            } catch (e: Exception) { remLog("WARN", "PIP", "miniatura automática: ${e.message}") }
        }
    } catch (e: Exception) {}
}

// 3277: la VERDAD sobre la miniatura, para la app (call_pip.js): si la ventana está ahora en miniatura (pip) y si está puesta la marca
// «pasar a miniatura al irse» (wanted). La app pregunta al cambiar de tamaño y al volver, por si el aviso de Android no llegó.
internal fun NexoBlePlugin.pipStateImpl(call: PluginCall) {
    val pip = try { Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity?.isInPictureInPictureMode == true } catch (e: Exception) { false }
    call.resolve(JSObject().put("pip", pip).put("wanted", BleService.pipVideo))
}

// Entrar YA en miniatura (PiP), p. ej. desde un botón «minimizar» de la pantalla de llamada.
internal fun NexoBlePlugin.enterPipImpl(call: PluginCall) {
    var ok = false
    try {
        val act = activity
        if (act != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ok = true
            act.runOnUiThread {
                try {
                    val params = android.app.PictureInPictureParams.Builder()
                        .setAspectRatio(android.util.Rational(9, 16)).build()
                    act.enterPictureInPictureMode(params)
                } catch (e: Exception) { remLog("WARN", "PIP", "enterPip: ${e.message}") }
            }
        }
    } catch (e: Exception) { remLog("WARN", "PIP", "enterPip: ${e.message}") }
    call.resolve(JSObject().put("ok", ok))
}

internal fun NexoBlePlugin.callFocus(am: android.media.AudioManager, on: Boolean) {
    try {
        if (on) {
            if (focusReq != null) return
            val attrs = android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build()
            val req = android.media.AudioFocusRequest.Builder(android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attrs)
                // #dueño 02-11 (diagnóstico: «foco de audio: no (0)» → Spotify volvía a sonar al CONTESTAR): aceptar la
                // concesión diferida para que, si el stack de audio no está listo al contestar (Bluetooth SCO/Telecom
                // asentándose), el sistema conceda el foco en cuanto pueda en vez de FALLAR y dejar que la música vuelva.
                .setAcceptsDelayedFocusGain(true)
                .setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener { change ->
                    val mode = try { am.mode } catch (e: Exception) { 0 }
                    remLog("INFO", "CALL", "Foco de audio: $change (modo $mode)")
                    // 3278 (dueño 22-11): SOLO una llamada telefónica retiene la llamada NEXO (FocusPolicy). Si otra app toma el
                    // audio (un vídeo, música, la cámara grabando), la llamada sigue y suenan las dos; no se le vuelve a quitar.
                    if (change > 0) { focusLost = false; callHold(false, "el foco de audio volvió") }
                    else {
                        focusLost = true
                        if (FocusPolicy.onLoss(change, mode) == FocusPolicy.HOLD) callHold(true, "llamada telefónica (modo $mode)")
                        else remLog("INFO", "CALL", "Otra app tomó el audio (foco $change): la llamada NEXO sigue, suenan las dos")
                        focusWatch(am)
                    }
                }.build()
            focusReq = req
            focusTries = 0
            requestFocusWithRetry(am)
        } else {
            focusHandler.removeCallbacksAndMessages(null)
            focusReq?.let { am.abandonAudioFocusRequest(it) }
            focusReq = null
            callFocusState = ""
            focusLost = false; callHeld = false; focusWatchOn = false; focusCalm = 0
        }
    } catch (e: Exception) { callFocusState = "error (${e.javaClass.simpleName})"; Log.w(TAG, "Foco de audio: ${e.message}") }
}
// 3278: retener / reanudar la llamada NEXO por una llamada telefónica (la app: calls._onInterruption). Sin repetir avisos.
internal fun NexoBlePlugin.callHold(on: Boolean, why: String) {
    if (callHeld == on) return
    callHeld = on
    remLog("INFO", "CALL", (if (on) "Llamada NEXO retenida: " else "Llamada NEXO reanudada: ") + why)
    try { notifyListeners("onCallInterruption", JSObject().put("paused", on).put("why", why)) } catch (e: Exception) {}
}
// 3278: mientras la llamada NEXO está sin foco o retenida se mira el modo del audio (FocusPolicy.onWatch): una llamada telefónica
// que entra con otra app dueña del audio no avisa por el foco, y al terminar tampoco lo devuelve si la pérdida fue permanente.
internal fun NexoBlePlugin.focusWatch(am: android.media.AudioManager) {
    if (focusWatchOn) return
    focusWatchOn = true; focusCalm = 0
    val req = focusReq
    val tick = object : Runnable {
        override fun run() {
            if (focusReq !== req || req == null || !BleService.inCall || !(focusLost || callHeld)) { focusWatchOn = false; return }
            val mode = try { am.mode } catch (e: Exception) { 0 }
            focusCalm = if (FocusPolicy.phoneMode(mode)) 0 else focusCalm + 1
            when (FocusPolicy.onWatch(callHeld, mode, focusCalm)) {
                FocusPolicy.HOLD -> callHold(true, "llamada telefónica (modo $mode)")
                FocusPolicy.RESUME -> callHold(false, "la llamada telefónica terminó (modo $mode)")
            }
            focusHandler.postDelayed(this, FocusPolicy.WATCH_MS)
        }
    }
    focusHandler.postDelayed(tick, 400L)
}
// 3278: por dónde suena de verdad la llamada (para el diagnóstico; dueño 22-11: la voz se regula con «volumen de llamada» y lo de la
// otra app con «multimedia»). Android dice el USO de cada sonido activo del teléfono (de todas las apps, sin decir de cuál):
// «llamada» = se regula con el volumen de llamada; «multimedia» = con el de multimedia.
internal fun NexoBlePlugin.callOutImpl(call: PluginCall) {
    val out = JSObject()
    try {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
        var voice = 0; var media = 0; var other = 0
        if (Build.VERSION.SDK_INT >= 26) for (c in am.activePlaybackConfigurations) when (c.audioAttributes.usage) {
            android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION, android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING -> voice++
            android.media.AudioAttributes.USAGE_MEDIA, android.media.AudioAttributes.USAGE_GAME, android.media.AudioAttributes.USAGE_UNKNOWN -> media++
            else -> other++
        }
        val vc = android.media.AudioManager.STREAM_VOICE_CALL; val mu = android.media.AudioManager.STREAM_MUSIC
        out.put("voice", voice).put("media", media).put("other", other).put("mode", am.mode)
            .put("volCall", "${am.getStreamVolume(vc)}/${am.getStreamMaxVolume(vc)}").put("volMedia", "${am.getStreamVolume(mu)}/${am.getStreamMaxVolume(mu)}")
            .put("focus", if (focusReq == null) "" else if (focusLost) "lo tiene otra app" else callFocusState).put("held", callHeld)
    } catch (e: Exception) { out.put("error", e.javaClass.simpleName) }
    call.resolve(out)
}

// #dueño 02-11: pedir el foco y, si FALLA (0), reintentar un par de veces mientras siga la llamada (el fallo al
// contestar era transitorio). GRANTED/DELAYED → NEXO retiene el audio y la música vuelve solo al colgar (abandon).
private fun NexoBlePlugin.requestFocusWithRetry(am: android.media.AudioManager) {
    val req = focusReq ?: return
    val r = try { am.requestAudioFocus(req) } catch (e: Exception) { android.media.AudioManager.AUDIOFOCUS_REQUEST_FAILED }
    callFocusState = when (r) {
        android.media.AudioManager.AUDIOFOCUS_REQUEST_GRANTED -> "sí"
        android.media.AudioManager.AUDIOFOCUS_REQUEST_DELAYED -> "diferido"
        else -> "no ($r)"
    }
    if (r == android.media.AudioManager.AUDIOFOCUS_REQUEST_FAILED && focusReq === req && focusTries < 3) {
        val delay = longArrayOf(250L, 700L, 1500L)[focusTries]
        focusTries++
        focusHandler.postDelayed({ if (focusReq === req && BleService.inCall) requestFocusWithRetry(am) }, delay)
    }
}

internal fun NexoBlePlugin.callScreen(on: Boolean, earpiece: Boolean) {
    val act = activity
    act?.runOnUiThread {
        try {
            val f = android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            if (on) act.window.addFlags(f) else act.window.clearFlags(f)
        } catch (e: Exception) { Log.w(TAG, "Pantalla en llamada: ${e.message}") }
    }
    try {
        val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        if (on && earpiece) {
            if (proximityLock == null && pm.isWakeLockLevelSupported(android.os.PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
                val wl = pm.newWakeLock(android.os.PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "nexo:llamada")
                wl.setReferenceCounted(false)
                wl.acquire(4 * 60 * 60 * 1000L)
                proximityLock = wl
            }
        } else {
            val wl = proximityLock
            proximityLock = null
            if (wl != null && wl.isHeld) wl.release(android.os.PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY)
        }
    } catch (e: Exception) { Log.w(TAG, "Sensor de proximidad: ${e.message}") }
}

// 3134 (dueño 15-11: «cuando marco a un contacto no escucho el clásico sonido del tuuu… tuuu…»): tono de llamada SALIENTE del
// sistema (ToneGenerator TONE_SUP_RINGTONE, el «está sonando» del país) por el canal de llamada: sale por el auricular, el altavoz o
// el manos libres Bluetooth, como en una llamada normal (el pitido de la app iba como multimedia y con la llamada en el modo de
// llamada del sistema no se oía). La app lo para al contestar o colgar; por si la app se cae, se para solo a los 70 s.
private val ringbackLock = Any()
private var ringbackGen: android.media.ToneGenerator? = null
private val ringbackMain = android.os.Handler(android.os.Looper.getMainLooper())
private val ringbackStop = Runnable { ringbackOff() }

private fun ringbackOff() {
    synchronized(ringbackLock) {
        ringbackMain.removeCallbacks(ringbackStop)
        val g = ringbackGen ?: return
        ringbackGen = null
        try { g.stopTone() } catch (e: Exception) { }
        try { g.release() } catch (e: Exception) { }
    }
}

internal fun NexoBlePlugin.ringbackImpl(call: PluginCall) {
    try {
        val on = call.getBoolean("on", false) == true
        ringbackOff()
        if (on) {
            val g = android.media.ToneGenerator(android.media.AudioManager.STREAM_VOICE_CALL, 80)
            if (!g.startTone(android.media.ToneGenerator.TONE_SUP_RINGTONE)) {
                try { g.release() } catch (e: Exception) { }
                call.reject("el tono no arrancó"); return
            }
            synchronized(ringbackLock) { ringbackGen = g }
            ringbackMain.postDelayed(ringbackStop, 70_000L)
        }
        call.resolve(JSObject().put("on", on))
    } catch (e: Exception) { ringbackOff(); call.reject("Tono de llamada: ${e.message}") }
}
