package com.nexo.ble

// 3086 (diagnósticos S24 08:09 y vivo 08:49 del 14-11): el aviso de respaldo en segundo plano (backgroundNotify, cuando el sistema
// congela la app y el JS no puede avisar ni confirmar) se saltaba ENTERO si al irse a segundo plano estaba abierto el chat de ese
// remitente (regla del dueño 08-11: no avisar de la persona que tenés en pantalla). Pero también se saltaba la confirmación de
// ENTREGA, y para siempre: el vivo, con el chat del S24 abierto y la app dormida 40 min, recibió dos textos y nunca los confirmó (el
// S24 los reenvió sin fin, «reenvio_sin_fin»). Ahora: la confirmación sale siempre; el aviso solo se calla en un parpadeo a segundo
// plano (menos de OPEN_CHAT_GRACE_MS); pasado eso, nadie está leyendo ese chat y se avisa como a cualquier otro.
object BgNotifyPolicy {
    const val OPEN_CHAT_GRACE_MS = 15000L

    fun silentForOpenChat(chatOpen: Boolean, bgForMs: Long): Boolean = chatOpen && bgForMs >= 0 && bgForMs < OPEN_CHAT_GRACE_MS
}
