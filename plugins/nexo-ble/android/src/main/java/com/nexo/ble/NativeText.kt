package com.nexo.ble

/**
 * 3122 — Los avisos del teléfono en el idioma de la app (PLAN etapa 1; antes salían siempre en español aunque la app estuviera en
 * italiano o inglés). Los textos que pone el nativo (avisos de mensajes con la app cerrada, llamadas, actualizaciones, el aviso fijo
 * del servicio y los nombres de los canales) en los 5 idiomas de la app. El idioma lo dice la app (setAppLang, se guarda con
 * NativeLang); sin él, el del teléfono si es uno de los nuestros, y si no, español (el mismo criterio que i18n.js).
 * Parte pura (se prueba en JVM: tests/kotlin NativeTextTest): cada texto en los 5 idiomas, {marcas} reemplazadas.
 */
object NativeText {
    val LANGS = listOf("es", "it", "en", "pt", "fr")

    private val T: Map<String, Array<String>> = mapOf(
        //                       es                                  it                                      en                                   pt                                        fr
        "msg_new" to arrayOf("Mensaje nuevo", "Nuovo messaggio", "New message", "Nova mensagem", "Nouveau message"),
        "msg_new_n" to arrayOf("{n} mensajes nuevos", "{n} nuovi messaggi", "{n} new messages", "{n} novas mensagens", "{n} nouveaux messages"),
        "msg_photo" to arrayOf("📷 Foto", "📷 Foto", "📷 Photo", "📷 Foto", "📷 Photo"),
        "msg_video" to arrayOf("🎥 Vídeo", "🎥 Video", "🎥 Video", "🎥 Vídeo", "🎥 Vidéo"),
        "msg_voice" to arrayOf("🎤 Nota de voz", "🎤 Messaggio vocale", "🎤 Voice message", "🎤 Mensagem de voz", "🎤 Message vocal"),
        "msg_file" to arrayOf("📎 Archivo", "📎 File", "📎 File", "📎 Arquivo", "📎 Fichier"),
        "call_in" to arrayOf("📞 Llamada entrante", "📞 Chiamata in arrivo", "📞 Incoming call", "📞 Chamada recebida", "📞 Appel entrant"),
        "call_in_nexo" to arrayOf("Llamada entrante · NEXO", "Chiamata in arrivo · NEXO", "Incoming call · NEXO", "Chamada recebida · NEXO", "Appel entrant · NEXO"),
        "vcall_in_nexo" to arrayOf("Videollamada entrante · NEXO", "Videochiamata in arrivo · NEXO", "Incoming video call · NEXO", "Videochamada recebida · NEXO", "Appel vidéo entrant · NEXO"),
        "call_answer" to arrayOf("Contestar", "Rispondi", "Answer", "Atender", "Répondre"),
        "call_decline" to arrayOf("Rechazar", "Rifiuta", "Decline", "Recusar", "Refuser"),
        "fcm_maybe" to arrayOf("Puede haber mensajes nuevos: abre NEXO", "Potrebbero esserci nuovi messaggi: apri NEXO", "There may be new messages: open NEXO", "Pode haver novas mensagens: abra o NEXO", "Vous avez peut-être de nouveaux messages : ouvrez NEXO"),
        "upd_title" to arrayOf("Hay una versión nueva de NEXO ({b})", "C'è una nuova versione di NEXO ({b})", "A new version of NEXO is available ({b})", "Há uma nova versão do NEXO ({b})", "Une nouvelle version de NEXO est disponible ({b})"),
        "upd_text" to arrayOf("Toca «Actualizar» para instalarla{mb}", "Tocca «Aggiorna» per installarla{mb}", "Tap «Update» to install it{mb}", "Toque em «Atualizar» para instalá-la{mb}", "Touchez «Mettre à jour» pour l'installer{mb}"),
        "upd_action" to arrayOf("Actualizar", "Aggiorna", "Update", "Atualizar", "Mettre à jour"),
        "upd_ready_title" to arrayOf("NEXO {b} descargada", "NEXO {b} scaricata", "NEXO {b} downloaded", "NEXO {b} baixada", "NEXO {b} téléchargée"),
        "upd_ready_text" to arrayOf("Toca «Instalar» para actualizar", "Tocca «Installa» per aggiornare", "Tap «Install» to update", "Toque em «Instalar» para atualizar", "Touchez «Installer» pour mettre à jour"),
        "upd_install" to arrayOf("Instalar", "Installa", "Install", "Instalar", "Installer"),
        "ch_messages" to arrayOf("Mensajes", "Messaggi", "Messages", "Mensagens", "Messages"),
        "ch_messages_desc" to arrayOf("Mensajes nuevos de tus contactos", "Nuovi messaggi dai tuoi contatti", "New messages from your contacts", "Novas mensagens dos seus contatos", "Nouveaux messages de vos contacts"),
        "ch_calls" to arrayOf("Llamadas", "Chiamate", "Calls", "Chamadas", "Appels"),
        "ch_calls_desc" to arrayOf("Llamadas y videollamadas entrantes", "Chiamate e videochiamate in arrivo", "Incoming calls and video calls", "Chamadas e videochamadas recebidas", "Appels et appels vidéo entrants"),
        "ch_updates_desc" to arrayOf("Avisa cuando hay una versión nueva de NEXO", "Avvisa quando c'è una nuova versione di NEXO", "Lets you know when a new version of NEXO is available", "Avisa quando há uma nova versão do NEXO", "Vous avertit quand une nouvelle version de NEXO est disponible"),
        "ch_updates" to arrayOf("Actualizaciones", "Aggiornamenti", "Updates", "Atualizações", "Mises à jour"),
        "ch_screen" to arrayOf("Compartir pantalla", "Condivisione schermo", "Screen sharing", "Compartilhar tela", "Partage d'écran"),
        "screen_sharing" to arrayOf("Compartiendo tu pantalla en la videollamada", "Stai condividendo lo schermo nella videochiamata", "Sharing your screen in the video call", "Compartilhando sua tela na videochamada", "Partage de votre écran dans l'appel vidéo"),
        "svc_channel" to arrayOf("NEXO BLE Service", "NEXO BLE Service", "NEXO BLE Service", "NEXO BLE Service", "NEXO BLE Service"),
        "svc_channel_desc" to arrayOf("Servicio BLE en segundo plano", "Servizio BLE in background", "BLE service in the background", "Serviço BLE em segundo plano", "Service BLE en arrière-plan"),
        "svc_title" to arrayOf("NEXO BLE", "NEXO BLE", "NEXO BLE", "NEXO BLE", "NEXO BLE"),
        "svc_text" to arrayOf("Anunciando dispositivo NEXO...", "Annuncio del dispositivo NEXO...", "Announcing NEXO device...", "Anunciando o dispositivo NEXO...", "Annonce de l'appareil NEXO...")
    )

    fun keys(): Set<String> = T.keys

    /** Idioma de la app reducido a uno de los nuestros (dos letras); cualquier otro → español. */
    fun norm(lang: String?): String { val l = (lang ?: "").lowercase().take(2); return if (l in LANGS) l else "es" }

    /** Texto [key] en [lang] con las {marcas} de [args] reemplazadas; una clave desconocida devuelve la propia clave. */
    fun t(lang: String?, key: String, vararg args: Pair<String, Any?>): String {
        val row = T[key] ?: return key
        var s = row[LANGS.indexOf(norm(lang))]
        for ((k, v) in args) s = s.replace("{$k}", v?.toString() ?: "")
        return s
    }
}
