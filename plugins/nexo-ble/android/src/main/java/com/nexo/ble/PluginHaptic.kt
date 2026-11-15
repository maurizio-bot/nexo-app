package com.nexo.ble

import android.content.Context
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall

// NEXO Touch: háptica del sistema.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

// ===== NEXO Touch (build 2968, dueño 09-11): háptica del SISTEMA =====
// kind: tick|confirm|reject|long|gesture|segment · mode: 'system' (View.performHapticFeedback: la misma sensación que
// el teclado de Android, respeta «Vibración al tocar» del teléfono, sin permiso) | 'on' (siempre: efecto predefinido
// vía Vibrator; VIBRATE ya está declarado). El mapa sensación→constante es puro (HapticKinds, probado en JVM).
private fun NexoBlePlugin.vibratorOf(): android.os.Vibrator? = try {
    if (Build.VERSION.SDK_INT >= 31) (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? android.os.VibratorManager)?.defaultVibrator
    else context.getSystemService(Context.VIBRATOR_SERVICE) as? android.os.Vibrator
} catch (e: Exception) { null }

internal fun NexoBlePlugin.hapticImpl(call: PluginCall) {
    val kind = call.getString("kind") ?: "tick"
    val mode = call.getString("mode") ?: "system"
    val sdk = Build.VERSION.SDK_INT
    try {
        val run = Runnable {
            try {
                if (HapticKinds.usesVibrator(mode, sdk)) {
                    val vib = vibratorOf()
                    if (vib != null && vib.hasVibrator()) vib.vibrate(android.os.VibrationEffect.createPredefined(HapticKinds.predefinedFor(kind)))
                } else {
                    val c = HapticKinds.constantFor(kind, sdk)
                    val v = bridge?.webView
                    if (v != null && c != HapticKinds.NONE) v.performHapticFeedback(c)
                }
            } catch (e: Exception) {}
        }
        val act = activity
        if (act != null) act.runOnUiThread(run) else run.run()
    } catch (e: Exception) {}
    call.resolve()
}

// Capacidades del motor háptico (para el diagnóstico y para afinar con el dueño: ¿amplitud? ¿primitivas?)
internal fun NexoBlePlugin.hapticCapsImpl(call: PluginCall) {
    val r = JSObject()
    try {
        val vib = vibratorOf()
        r.put("sdk", Build.VERSION.SDK_INT)
        r.put("hasVibrator", vib?.hasVibrator() ?: false)
        r.put("amplitude", vib != null && vib.hasAmplitudeControl())
        r.put("primitives", vib != null && Build.VERSION.SDK_INT >= 31 && vib.areAllPrimitivesSupported(android.os.VibrationEffect.Composition.PRIMITIVE_CLICK, android.os.VibrationEffect.Composition.PRIMITIVE_TICK))
    } catch (e: Exception) {}
    call.resolve(r)
}
