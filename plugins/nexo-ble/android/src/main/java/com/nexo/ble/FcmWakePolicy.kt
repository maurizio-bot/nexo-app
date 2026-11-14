package com.nexo.ble

// 3076 (dueño 14-11: «notificaciones fantasmas»): qué hacer tras un toque FCM. El toque no trae contenido (solo despierta), así que
// no puede prometer un mensaje: el aviso lo pone el mensaje de verdad al llegar (NetBg / Bluetooth). Solo si el servicio no pudo
// arrancar —sin él no se baja nada— se deja un aviso neutro para que la persona abra NEXO. Sin Android: se prueba en JVM.
object FcmWakePolicy {
    fun noticeAfterWake(serviceStarted: Boolean): Boolean = !serviceStarted
}
