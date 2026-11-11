# PENDIENTE (no aplicado): parte NATIVA de Wi-Fi Direct preparada el 11-11 (ver docs/PENDIENTES.md, «Wi-Fi Direct»).
# Reintenta ~5 s el montaje del grupo cuando Android contesta «ocupado», usa un canal nuevo al 2.º reintento, dice «Wi-Fi apagado»
# con su propio código (WD_WIFI_OFF) y deja en el diagnóstico el estado (Wi-Fi, Wi-Fi Direct, grupo, primer/segundo plano).
# Solo se revisó la sintaxis (aquí no se puede compilar Android): aplicarlo en un build propio y probarlo en teléfonos.
# Uso: python3 patch_kt.py <ruta NexoBlePlugin.kt>
import sys
p = sys.argv[1]; s = open(p, encoding='utf8').read()
def rep(a, b):
    global s
    assert s.count(a) == 1, (s.count(a), a[:80])
    s = s.replace(a, b)

# 1) ayudas: Wi-Fi encendido, canal nuevo, foto del estado
rep("""    private fun wdTearDown() {
""", """    // 3013 (dueño 11-11: «no veo que funcione Wi-Fi Direct»; diagnósticos 08 y 10-11: «No se pudo crear el grupo (2)» en los dos
    // teléfonos): el 2 es «ocupado», que Android contesta cuando no puede levantar Wi-Fi Direct en ese momento (Wi-Fi apagado,
    // interfaz ocupada, operación en curso). Antes se rendía al primer fallo y el diagnóstico no decía por qué.
    private fun wdWifiOn(): Boolean = try {
        (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.isWifiEnabled ?: false
    } catch (e: Exception) { false }

    // Canal nuevo con el servicio de Wi-Fi Direct (el anterior puede haberse quedado sin servicio)
    private fun p2pReset() {
        try { if (Build.VERSION.SDK_INT >= 27) p2pChannel?.close() } catch (e: Exception) {}
        p2pManager = null
        p2pChannel = null
        p2pInit()
    }

    // Estado de Wi-Fi Direct en una línea, para el diagnóstico (no espera más de 1,5 s)
    @android.annotation.SuppressLint("MissingPermission")
    private fun wdState(cb: (String) -> Unit) {
        val parts = java.util.concurrent.ConcurrentHashMap<String, String>()
        val done = java.util.concurrent.atomic.AtomicBoolean(false)
        fun finish() {
            if (!done.compareAndSet(false, true)) return
            cb("Wi-Fi " + (if (wdWifiOn()) "encendido" else "APAGADO") + ", Wi-Fi Direct " + (parts["p2p"] ?: "?") +
                ", grupo " + (parts["grupo"] ?: "?") + ", app " + (if (appInBackground) "en segundo plano" else "en primer plano"))
        }
        try {
            val m = p2pManager
            val ch = p2pChannel
            if (m == null || ch == null) { parts["p2p"] = "sin canal"; finish(); return }
            mainHandler.postDelayed({ finish() }, 1500)
            if (Build.VERSION.SDK_INT >= 29) m.requestP2pState(ch) { st ->
                parts["p2p"] = if (st == WifiP2pManager.WIFI_P2P_STATE_ENABLED) "activo" else "inactivo"
                if (parts.containsKey("grupo")) finish()
            }
            m.requestGroupInfo(ch) { g ->
                parts["grupo"] = if (g == null) "ninguno" else if ((g.networkName ?: "").endsWith("-NEXO")) "propio" else "de otra app"
                if (parts.containsKey("p2p") || Build.VERSION.SDK_INT < 29) finish()
            }
        } catch (e: Exception) { parts["p2p"] = "error ${e.message}"; finish() }
    }

    private fun wdTearDown() {
""")

# 2) anfitrión: Wi-Fi apagado dicho claro; reintentos con espera y canal nuevo; estado en el fallo
rep("""        val m = p2pManager!!
        val ch = p2pChannel!!
        val name = "DIRECT-" + wdRandom(2) + "-NEXO"
        val pass = wdRandom(16)
""", """        if (!wdWifiOn()) {
            remLog("WARN", "WIFI_DIRECT", "No se monta el grupo para $transferId: Wi-Fi APAGADO (Wi-Fi Direct lo necesita encendido, aunque no haya red)")
            call.reject("Wi-Fi apagado", "WD_WIFI_OFF"); return
        }
        val name = "DIRECT-" + wdRandom(2) + "-NEXO"
        val pass = wdRandom(16)
""")
rep("""        fun create() {
            m.createGroup(ch, cfg, object : WifiP2pManager.ActionListener {
                override fun onSuccess() {
""", """        // Esperas antes de cada reintento (en total ~5 s; la oferta del otro espera 25 s)
        val retryMs = longArrayOf(700, 1500, 2500)
        var start: (Int) -> Unit = { _ -> }
        fun create(attempt: Int) {
            val m = p2pManager
            val ch = p2pChannel
            if (m == null || ch == null) { call.reject("Wi-Fi Direct no disponible", "WD_UNAVAILABLE"); return }
            m.createGroup(ch, cfg, object : WifiP2pManager.ActionListener {
                override fun onSuccess() {
""")
rep("""                override fun onFailure(reason: Int) { call.reject("No se pudo crear el grupo ($reason)", "WD_GROUP") }
            })
        }
        mainHandler.post {
            m.removeGroup(ch, object : WifiP2pManager.ActionListener {
                override fun onSuccess() { create() }
                override fun onFailure(reason: Int) { create() }
            })
        }
    }
""", """                override fun onFailure(reason: Int) {
                    if (!wdWifiOn()) {
                        remLog("WARN", "WIFI_DIRECT", "Crear grupo para $transferId falló ($reason): Wi-Fi APAGADO")
                        call.reject("Wi-Fi apagado", "WD_WIFI_OFF")
                    } else if (attempt < retryMs.size) {
                        remLog("WARN", "WIFI_DIRECT", "Crear grupo para $transferId falló ($reason), intento ${attempt + 1}: se reintenta en ${retryMs[attempt]} ms")
                        mainHandler.postDelayed({
                            if (attempt == 1) p2pReset()   // al segundo reintento, canal nuevo
                            start(attempt + 1)
                        }, retryMs[attempt])
                    } else wdState { st ->
                        remLog("WARN", "WIFI_DIRECT", "No se pudo crear el grupo para $transferId ($reason) tras ${attempt + 1} intentos. Estado: $st")
                        call.reject("No se pudo crear el grupo ($reason; $st)", "WD_GROUP")
                    }
                }
            })
        }
        start = { attempt ->
            val m = p2pManager
            val ch = p2pChannel
            if (m == null || ch == null) call.reject("Wi-Fi Direct no disponible", "WD_UNAVAILABLE")
            else m.removeGroup(ch, object : WifiP2pManager.ActionListener {
                override fun onSuccess() { create(attempt) }
                override fun onFailure(reason: Int) { create(attempt) }
            })
        }
        mainHandler.post { start(0) }
    }
""")

# 3) el que envía: Wi-Fi apagado dicho claro; estado si no conecta
rep("""        val m = p2pManager!!
        val ch = p2pChannel!!
        val t0 = System.currentTimeMillis()
""", """        if (!wdWifiOn()) {
            remLog("WARN", "WIFI_DIRECT", "No se envía $transferId por Wi-Fi Direct: Wi-Fi APAGADO")
            call.reject("Wi-Fi apagado", "WD_WIFI_OFF"); return
        }
        val m = p2pManager!!
        val ch = p2pChannel!!
        val t0 = System.currentTimeMillis()
""")
rep("""                else { wdTearDown(); call.reject("El grupo no se formó", "WD_TIMEOUT") }
""", """                else wdState { st ->
                    remLog("WARN", "WIFI_DIRECT", "No se pudo entrar al grupo del otro para $transferId en 20 s. Estado: $st")
                    wdTearDown(); call.reject("El grupo no se formó ($st)", "WD_TIMEOUT")
                }
""")
rep("""                override fun onFailure(reason: Int) { call.reject("No se pudo conectar ($reason)", "WD_CONNECT") }
""", """                override fun onFailure(reason: Int) {
                    wdState { st ->
                        remLog("WARN", "WIFI_DIRECT", "No se pudo conectar al grupo del otro para $transferId ($reason). Estado: $st")
                        call.reject("No se pudo conectar ($reason; $st)", "WD_CONNECT")
                    }
                }
""")
open(p, 'w', encoding='utf8').write(s)
print('kt ok')
