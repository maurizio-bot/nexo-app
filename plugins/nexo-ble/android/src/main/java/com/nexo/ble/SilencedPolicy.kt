package com.nexo.ble

/**
 * COLA 22 (dueño 22-11) — «Tu teléfono silencia a NEXO»: la parte que no depende de Android (se prueba en JVM:
 * tests/kotlin SilencedPolicyTest). Dado cómo dejó el usuario cada canal de avisos y el «No molestar», dice qué hay que explicarle.
 * Los valores son los de NotificationManager (IMPORTANCE_* y INTERRUPTION_FILTER_*), fijos en Android.
 * Lo del interruptor general de avisos de la app (areNotificationsEnabled) ya lo cubre notif_banner.js; aquí solo los CANALES y el DND.
 */
object SilencedPolicy {
    const val IMP_NONE = 0     // el usuario apagó el canal
    const val IMP_LOW = 2      // sin sonido ni ventana (solo barra)
    const val IMP_DEFAULT = 3  // suena, sin ventana
    const val IMP_HIGH = 4     // suena y sale la ventana (lo que NEXO crea)

    const val FILTER_ALL = 1       // sin «No molestar»
    const val FILTER_PRIORITY = 2  // solo prioritarias
    const val FILTER_NONE = 3      // silencio total
    const val FILTER_ALARMS = 4    // solo alarmas

    const val OK = "ok"
    const val OFF = "off"      // canal apagado: no sale nada
    const val QUIET = "quiet"  // sale, pero sin sonido (o sin ventana en llamadas)

    /**
     * Estado de un canal. [importance] < 0 = el canal no existe todavía (nada que decir). [needsPopup]: las llamadas necesitan
     * IMPORTANCE_HIGH para que se vea la ventana de llamada; los mensajes con DEFAULT (suena) ya llegan bien. [hasSound]: tiene sonido.
     */
    fun channelState(importance: Int, hasSound: Boolean, groupBlocked: Boolean, needsPopup: Boolean): String {
        if (importance < 0) return OK
        if (groupBlocked || importance == IMP_NONE) return OFF
        if (importance < IMP_DEFAULT || !hasSound) return QUIET
        if (needsPopup && importance < IMP_HIGH) return QUIET
        return OK
    }

    /** ¿Hay «No molestar» activo? */
    fun dndActive(filter: Int): Boolean = filter > FILTER_ALL

    /** «total» (nada suena), «priority» (solo prioritarias: los avisos de apps normales se callan) o «none» (sin DND). */
    fun dndKind(filter: Int): String = when (filter) {
        FILTER_NONE, FILTER_ALARMS -> "total"
        FILTER_PRIORITY -> "priority"
        else -> "none"
    }

    /** Un canal que se salta el «No molestar» (lo puso así el usuario) no queda callado por él. */
    fun dndSilences(filter: Int, channelBypassesDnd: Boolean): Boolean = dndActive(filter) && !channelBypassesDnd

    /**
     * Lista de lo que hay que explicar, de lo más grave a lo menos: «msg_off», «call_off», «msg_quiet», «call_quiet», «dnd_total»,
     * «dnd_priority». Vacía = todo bien.
     */
    fun issues(msg: String, call: String, filter: Int, msgBypass: Boolean, callBypass: Boolean): List<String> {
        val out = ArrayList<String>()
        if (msg == OFF) out.add("msg_off")
        if (call == OFF) out.add("call_off")
        if (msg == QUIET) out.add("msg_quiet")
        if (call == QUIET) out.add("call_quiet")
        if (dndSilences(filter, msgBypass && callBypass)) out.add(if (dndKind(filter) == "total") "dnd_total" else "dnd_priority")
        return out
    }

    const val RINGER_SILENT = 0   // AudioManager.RINGER_MODE_SILENT
    const val RINGER_VIBRATE = 1  // AudioManager.RINGER_MODE_VIBRATE

    /**
     * 23-11 (COLA 23: «con la app cerrada y la pantalla apagada a veces no suena»): para el registro, cómo va a tratar el teléfono un
     * aviso de mensaje que NEXO acaba de publicar. «suena» o «NO suena: motivos» (todos los que apliquen). [active]: si el sistema lo
     * tiene de verdad publicado (null = no se pudo saber). Así un «no sonó» se explica solo en el diagnóstico.
     */
    fun alertVerdict(channel: String, filter: Int, bypassDnd: Boolean, ringerMode: Int, active: Boolean?): String {
        val why = ArrayList<String>()
        if (active == false) why.add("el sistema no lo dejó publicado")
        if (channel == OFF) why.add("el canal de mensajes está apagado en el teléfono")
        if (channel == QUIET) why.add("el canal de mensajes está sin sonido en el teléfono")
        if (dndSilences(filter, bypassDnd)) why.add(if (dndKind(filter) == "total") "«No molestar» total" else "«No molestar» (solo prioritarias)")
        if (ringerMode == RINGER_SILENT) why.add("el teléfono está en silencio")
        if (ringerMode == RINGER_VIBRATE) why.add("el teléfono está en vibración")
        return if (why.isEmpty()) "suena" else "NO suena: " + why.joinToString("; ")
    }
}
