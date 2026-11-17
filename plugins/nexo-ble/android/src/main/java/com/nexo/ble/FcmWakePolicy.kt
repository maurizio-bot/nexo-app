package com.nexo.ble

// 3076 (dueño 14-11: «notificaciones fantasmas»): qué hacer tras un toque FCM. El toque no trae contenido (solo despierta), así que
// no puede prometer un mensaje: el aviso lo pone el mensaje de verdad al llegar (NetBg / Bluetooth). Solo si el servicio no pudo
// arrancar —sin él no se baja nada— se deja un aviso neutro para que la persona abra NEXO. Sin Android: se prueba en JVM.
// 3192 (#87): «el servicio arrancó» no bastaba: con el proceso muerto (la app cerrada del todo, p. ej. tras actualizarse el WebView) el
// servicio solo no escuchaba internet y el toque no dejaba aviso: no bajaba nada y nadie se enteraba. Ahora el toque arranca la escucha
// desde lo guardado (NetBgHome.startWithoutApp); canListen = alguien escucha internet tras el toque (la app viva, la escucha que ya
// estaba o la que acaba de arrancar). Sin servicio, o sin escucha (no hay configuración guardada o no pudo arrancar): el aviso neutro.
object FcmWakePolicy {
    fun noticeAfterWake(serviceStarted: Boolean, canListen: Boolean): Boolean = !serviceStarted || !canListen
}
