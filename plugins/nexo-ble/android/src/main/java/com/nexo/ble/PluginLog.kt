package com.nexo.ble

import android.app.ActivityManager
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import java.io.File
import com.nexo.ble.NexoBlePlugin.Companion.nativeLogShared
import com.nexo.ble.NexoBlePlugin.Companion.NATIVE_LOG_FILE

// Registros y diagnóstico: errores de Bluetooth, registro nativo (NativeLog), energía y estado de batería.
// 3118 (reestructuración 15-11): código movido TAL CUAL desde NexoBlePlugin.kt, sin cambiar lo que hace. Son extensiones
// de NexoBlePlugin (el mismo objeto y los mismos campos, que siguen en la clase); los @PluginMethod siguen declarados
// en la clase (Capacitor los busca allí) y solo llaman a su «…Impl» de aquí.

internal fun NexoBlePlugin.btErr(kind: String, message: String) {
    val now = System.currentTimeMillis()
    if (now - (btErrLast[kind] ?: 0L) < 5000) { Log.w("NEXO_REM", "[WARN][SEND] $message"); return }
    btErrLast[kind] = now
    remLog("WARN", "BT_ERR", message)
}
// Ronda 2785 (#87): registro nativo persistente (NativeLog.kt). Compartido por el proceso: lo usan el plugin y la
// escucha de internet (NetBg), también con la app cerrada (cuando el WebView —y diag.js— ya no existe).
internal fun NexoBlePlugin.nlog(): NativeLog? {
    val ctx = appCtx ?: return null
    return nativeLogShared ?: synchronized(NexoBlePlugin::class.java) {
        nativeLogShared ?: NativeLog(File(ctx.filesDir, NATIVE_LOG_FILE)).also { nativeLogShared = it }
    }
}
internal fun NexoBlePlugin.remLog(level: String, tag: String, message: String) {
    Log.i("NEXO_REM", "[$level][$tag] $message")
    // A disco (persiste con la app cerrada); no el detalle por trozo (ese va solo a logcat, no pasa por remLog)
    try { nlog()?.add(level, tag, message) } catch (e: Exception) { }
    if (tag !in remLogToJs) return
    try {
        notifyListeners("onRemLog", JSObject()
            .put("level", level)
            .put("tag", tag)
            .put("message", message)
            .put("timestamp", System.currentTimeMillis())
        )
    } catch (e: Exception) { }
}

// Ronda 2772: estado de energía para el diagnóstico (lo que puede impedir recibir con la pantalla apagada)
internal fun NexoBlePlugin.energyLog(why: String) {
    try {
        val ctx = appCtx ?: return
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        val sb = StringBuilder("$why: segundo plano permitido ").append(if (pm.isIgnoringBatteryOptimizations(ctx.packageName)) "sí" else "NO")
            .append(", reposo del sistema ").append(if (pm.isDeviceIdleMode) "sí" else "no")
        if (Build.VERSION.SDK_INT >= 28) {
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
            val b = (ctx.getSystemService(Context.USAGE_STATS_SERVICE) as android.app.usage.UsageStatsManager).appStandbyBucket
            sb.append(", restringida por el sistema ").append(if (am.isBackgroundRestricted) "SÍ" else "no")
                .append(", grupo ").append(when (b) { 5 -> "exenta"; 10 -> "activa"; 20 -> "de uso"; 30 -> "frecuente"; 40 -> "rara"; 45 -> "RESTRINGIDA"; else -> "$b" })
        }
        sb.append(", despertares por mensajes ").append(rxWakes).append(", fabricante ").append(Build.MANUFACTURER)
        remLog("INFO", "ENERGIA", sb.toString())
    } catch (e: Exception) { }
}

// Ronda 2785 (#87): registro nativo persistente (NativeLog.kt) para el diagnóstico. Aparte de loadFromFile porque
// ese pasa por el cifrado en reposo (AtRestStore) y este se escribe en claro —append desde varios hilos, también con
// la app cerrada o bloqueada—. Solo metadatos (nunca el contenido de un mensaje). Al abrir la app, diag.js lo mete en
// Perfil → Copiar diagnóstico para ver qué hizo el nativo mientras la app estaba cerrada.
internal fun NexoBlePlugin.readNativeLogImpl(call: PluginCall) {
    try {
        val log = nlog()
        val content = log?.read() ?: ""
        if (call.getData().optBoolean("clear", false)) log?.clear()
        call.resolve(JSObject().put("content", content))
    } catch (e: Exception) { call.resolve(JSObject().put("content", "")) }
}

// Jump: nivel de batería, si está cargando y si está en ahorro de energía (con poca batería el
// teléfono deja de hacer de puente para otros)
internal fun NexoBlePlugin.getPowerStatusImpl(call: PluginCall) {
    try {
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as android.os.BatteryManager
        val level = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val charging = bm.isCharging
        val pm = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
        val out = JSObject().put("level", level).put("charging", charging).put("powerSave", pm.isPowerSaveMode)
        // 3020 (diagnóstico más claro, dueño 12-11): Doze, pantalla, optimización de batería, red activa y punto de acceso.
        // Cada dato por separado: si uno falla en algún modelo, los demás siguen.
        // 3256 (dueño 20-11: «el diagnóstico debe medir la temperatura y los tiempos él solo»): temperatura de la batería (°C, con un decimal;
        // Android la da en décimas) y estado térmico del teléfono (API 29+: 0 normal … 6 apagado). Cada dato por separado.
        try {
            val st = context.registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
            val t = st?.getIntExtra(android.os.BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE) ?: Int.MIN_VALUE
            if (t != Int.MIN_VALUE && t > -500 && t < 1500) out.put("temp", t / 10.0)
        } catch (e: Throwable) {}
        try { if (android.os.Build.VERSION.SDK_INT >= 29) out.put("thermal", pm.currentThermalStatus) } catch (e: Throwable) {}
        try { out.put("idle", pm.isDeviceIdleMode) } catch (e: Exception) {}
        try { out.put("interactive", pm.isInteractive) } catch (e: Exception) {}
        try { out.put("ignoringOpt", pm.isIgnoringBatteryOptimizations(context.packageName)) } catch (e: Exception) {}
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val caps = cm.getNetworkCapabilities(cm.activeNetwork)
            val net = when {
                caps == null -> "ninguna"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) -> "datos móviles"
                caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
                else -> "otra"
            }
            out.put("net", net)
        } catch (e: Exception) {}
        // 3120: bytes que NEXO recibió y mandó desde que se encendió el teléfono (cuenta de Android de la propia app; el JS
        // resta entre muestras para los datos del día). -1 = el teléfono no lo da.
        try {
            val uid = android.os.Process.myUid()
            val rx = android.net.TrafficStats.getUidRxBytes(uid); val tx = android.net.TrafficStats.getUidTxBytes(uid)
            if (rx >= 0 && tx >= 0) out.put("rx", rx).put("tx", tx)
        } catch (e: Throwable) {}
        try {
            val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as android.net.wifi.WifiManager
            val m = wm.javaClass.getDeclaredMethod("isWifiApEnabled")
            m.isAccessible = true
            out.put("hotspot", m.invoke(wm) as Boolean)
        } catch (e: Throwable) {}
        call.resolve(out)
    } catch (e: Exception) {
        call.reject("Estado de batería no disponible: ${e.message}")
    }
}

// 3120: cierres de la app de los últimos 7 días con su motivo (Android 11+), el hilo principal de un ANR y los fallos guardados
// por CrashLog. Lo pide el diagnóstico una vez al arrancar (los cierres solo cambian cuando el proceso muere).
internal fun NexoBlePlugin.getExitReasonsImpl(call: PluginCall) {
    val out = JSObject()
    val arr = JSArray()
    out.put("sdk", Build.VERSION.SDK_INT)
    try {
        if (Build.VERSION.SDK_INT >= 30) {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val since = System.currentTimeMillis() - 7L * 24 * 3600 * 1000
            for (e in am.getHistoricalProcessExitReasons(context.packageName, 0, 20)) {
                if (e.timestamp < since) continue
                val o = JSObject().put("t", e.timestamp).put("reason", e.reason).put("label", ExitReasons.label(e.reason))
                    .put("problem", ExitReasons.isProblem(e.reason))
                    .put("fg", e.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND)
                    .put("pssKb", e.pss).put("rssKb", e.rss)
                if (!e.description.isNullOrBlank()) o.put("desc", ExitReasons.clip(e.description, 200))
                if (e.reason == ExitReasons.CRASH_NATIVE && Build.VERSION.SDK_INT >= 31) {   // 3232: pistas del fallo nativo
                    try { e.traceInputStream?.use { ins -> val h = ExitReasons.nativeHints(ins.readBytes()); if (h.isNotBlank()) o.put("trace", h) } } catch (t: Throwable) {}
                }
                if (e.reason == ExitReasons.ANR) {
                    try {
                        e.traceInputStream?.use { ins ->
                            val buf = CharArray(200000)
                            val n = ins.bufferedReader().read(buf)
                            if (n > 0) o.put("trace", ExitReasons.anrMain(String(buf, 0, n)))
                        }
                    } catch (t: Throwable) {}
                }
                arr.put(o)
            }
        }
    } catch (e: Throwable) {
        out.put("error", ExitReasons.clip(e.message, 120))
    }
    out.put("exits", arr)
    try { val f = File(context.filesDir, ExitReasons.FILE); if (f.exists()) out.put("crashes", f.readText().take(ExitReasons.MAX_FILE_CHARS)) } catch (e: Throwable) {}
    try { out.put("maxMemMb", Runtime.getRuntime().maxMemory() / 1048576) } catch (e: Throwable) {}
    call.resolve(out)
}
