package com.nexo.ble

// 3094 (cola del dueño 14-11: «sin la foto del contacto en sus notificaciones»): la foto de cada contacto para sus avisos,
// SOLO EN MEMORIA (la app la pasa con setNotifAvatar al abrirse y cada vez que cambia; nunca se escribe en el teléfono, así
// que no toca el cifrado en reposo). Con el proceso muerto no hay foto: el aviso sale como antes. Como mucho MAX fotos
// (las menos usadas salen primero) y ninguna de más de MAX_BYTES. Pura (sin Android): prueba NotifAvatarsTest.
object NotifAvatars {
    const val MAX = 64
    const val MAX_BYTES = 64 * 1024
    private val map = object : LinkedHashMap<String, ByteArray>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?): Boolean = size > MAX
    }

    // bytes vacíos o null = quitar la foto; demasiado grande = no se guarda (y se quita la anterior)
    @Synchronized fun put(chatId: String, bytes: ByteArray?) {
        val k = chatId.trim().lowercase()
        if (k.isEmpty()) return
        if (bytes == null || bytes.isEmpty() || bytes.size > MAX_BYTES) map.remove(k) else map[k] = bytes
    }

    @Synchronized fun get(chatId: String): ByteArray? = map[chatId.trim().lowercase()]

    @Synchronized fun size(): Int = map.size

    @Synchronized fun clear() = map.clear()

    // «data:image/jpeg;base64,AAAA» o solo el base64 → lo que va detrás de la coma
    fun base64Part(img: String): String { val i = img.indexOf("base64,"); return if (i >= 0) img.substring(i + 7) else img }
}
