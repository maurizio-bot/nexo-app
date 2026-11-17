package com.nexo.ble

// 3189 (diagnósticos tableta SM-T220 y S24 17-11 04:46, #87): «NEXO vuelve sola». La tableta tenía NEXO en segundo plano con la
// pantalla apagada; a las 23:56 Google Play actualizó Android System WebView y Android mató el proceso («stop
// com.google.android.webview due to installPackageLI»). BleService es START_STICKY, pero Android NO reinicia los servicios de un
// proceso matado así (ni tras actualizar la propia NEXO sin abrirla, ni tras reiniciar el teléfono): no volvió hasta que el dueño la
// abrió a mano a las 04:46, casi 5 h sin recibir nada. Lo único que la revivía era un toque FCM, y solo si alguien tenía algo pendiente
// para ella. Ahora vuelve sola (NexoRestartReceiver, por el MISMO camino que el toque FCM: arrancar BleService) tras:
//  - MY_PACKAGE_REPLACED: actualización de NEXO sin abrirla,
//  - BOOT_COMPLETED: reinicio (llega después de desbloquear, cuando los datos ya no están cifrados; por eso NO LOCKED_BOOT_COMPLETED),
//  - la alarma de vigilancia propia, inexacta, cada ~15 min: cubre la actualización del WebView y cualquier otra muerte del proceso.
// Aquí, sin Android, lo que se decide (se prueba en JVM: RestartPolicyTest).
object RestartPolicy {
    const val ACTION_BOOT = "android.intent.action.BOOT_COMPLETED"
    const val ACTION_UPDATED = "android.intent.action.MY_PACKAGE_REPLACED"
    // La alarma de vigilancia (intent explícito al receptor, que no está exportado: solo la puede mandar NEXO o el sistema)
    const val ACTION_WATCHDOG = "com.nexo.ble.action.VUELVE_SOLA"
    // Extra del intent a BleService: por qué vuelve (nombre de Reason). Sin él, es un arranque normal (la app o el toque FCM).
    const val EXTRA_REASON = "nexo_restart_reason"

    enum class Reason(val why: String) {
        BOOT("un reinicio del teléfono"),
        UPDATE("una actualización de NEXO"),
        WATCHDOG("un cierre del sistema (alarma de vigilancia)"),
    }

    fun reasonOf(action: String?): Reason? = when (action) {
        ACTION_BOOT -> Reason.BOOT
        ACTION_UPDATED -> Reason.UPDATE
        ACTION_WATCHDOG -> Reason.WATCHDOG
        else -> null
    }
    fun reasonByName(name: String?): Reason? = Reason.values().firstOrNull { it.name == name }

    // Batería: cada ~15 min y INEXACTA (setAndAllowWhileIdle, sin permiso de alarmas exactas): Android la junta con otras alarmas y
    // despertares y, en reposo profundo (Doze), la deja para su ventana de mantenimiento. Con NEXO viva solo se reprograma
    // (mirar si existe un archivo y volver a poner la alarma): casi gratis. Solo hace trabajo de verdad cuando NEXO estaba muerta.
    const val INTERVAL_MS = 15 * 60_000L
    fun nextAt(nowElapsedMs: Long): Long = nowElapsedMs + INTERVAL_MS

    // Solo con NEXO configurada en el teléfono: hay NEXO ID guardado. Es el archivo que escribe la app al crear o recuperar la
    // cuenta (ble_helpers.js _saveNexoIdToVault, fenix.js; cifrado en reposo: aquí solo se mira que exista y no esté vacío). Ni el
    // servicio ni el toque FCM lo miraban: arrancaban siempre. Recién instalada sin cuenta, o tras pasar la cuenta a otro teléfono
    // (AccountMove.wipe lo borra), no hace nada y la alarma se cancela.
    const val NEXO_ID_FILE = "nexo_advertising_id.json"
    fun configured(idFileExists: Boolean, idFileBytes: Long): Boolean = idFileExists && idFileBytes > 0

    // Qué hacer cuando llega uno de los tres avisos. NEXO no tiene «cerrar sesión»: sin cuenta en el teléfono, STOP (cancela la alarma).
    // alive = en este proceso sigue el servicio, o la app (el plugin, también con la app cerrada y el proceso vivo, ronda 2758). Con
    // la app viva, el servicio lo maneja ella (lo para a propósito al ocultarse o con la cámara): la alarma no se mete.
    enum class Step { STOP, REARM, START }
    fun step(configured: Boolean, alive: Boolean): Step = when {
        !configured -> Step.STOP
        alive -> Step.REARM   // NEXO sigue viva: solo la próxima alarma, sin escribir en el registro
        else -> Step.START    // NEXO estaba muerta: arrancar el servicio (y la próxima alarma)
    }

    // Tipos del servicio en primer plano al volver: SOLO «dispositivo conectado». Desde Android 15 un servicio arrancado por
    // BOOT_COMPLETED no puede ser de micrófono (ni dataSync, camera, mediaPlayback, phoneCall, mediaProjection), y el de micrófono
    // tampoco se puede pedir desde segundo plano. El micrófono lo añade la llamada cuando hace falta (BleService.foreground).
    val BOOT_FORBIDDEN_TYPES = setOf("dataSync", "camera", "mediaPlayback", "phoneCall", "mediaProjection", "microphone")
    fun fgsTypes(reason: Reason): Set<String> = setOf("connectedDevice")
    fun micAllowed(reason: Reason?): Boolean = reason == null
}
