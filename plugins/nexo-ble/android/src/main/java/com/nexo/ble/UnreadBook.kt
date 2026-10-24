package com.nexo.ble

// Cuenta de mensajes sin leer por chat para las notificaciones (sin Android: se prueba en JVM).
// - add: un mensaje nuevo (por la app o por la escucha de internet en segundo plano); el mismo msgId no cuenta dos
//   veces aunque lo avisen las dos partes.
// - sync: los contadores de la app mandan (al volver a la app o cuando cambian): lo que la app ya contó pasa a ser la
//   base y lo visto hasta ahora no vuelve a contar.
// - clear: chat abierto.
// - ronda 2760: el aviso nativo en segundo plano llega antes que el de la app y no sabe de grupos (avisa con quien lo
//   manda). hasMsg: ¿ya se avisó de este mensaje en algún chat?; takeFromOthers: la app lo avisa en otro chat (el grupo)
//   → se quita de donde estaba (no sale dos veces).
class UnreadBook(private val maxSeen: Int = 3000) {
    class Chat(var name: String) {
        var base = 0
        val ids = LinkedHashSet<String>()
        var last = ""
        val count get() = base + ids.size
    }
    private val chats = HashMap<String, Chat>()
    private val seen = object : LinkedHashMap<String, Boolean>(256, 0.75f, false) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Boolean>?) = size > maxSeen
    }
    private val msgChat = object : LinkedHashMap<String, String>(256, 0.75f, false) { // msgId → chat donde se avisó
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > maxSeen
    }

    // true si es nuevo (hay que avisar)
    @Synchronized fun add(chatId: String, name: String, msgId: String, text: String): Boolean {
        val id = chatId.lowercase()
        val key = "$id|$msgId"
        if (seen.containsKey(key)) return false
        seen[key] = true
        val c = chats.getOrPut(id) { Chat(name) }
        if (name.isNotBlank()) c.name = name
        c.ids.add(msgId)
        c.last = text
        msgChat[msgId] = id
        return true
    }

    @Synchronized fun hasMsg(msgId: String): Boolean = msgChat.containsKey(msgId)

    // Ronda 2763: el aviso nativo ya salió en este chat ("Mensaje nuevo") y la app sabe qué es (📷 Foto…): cambia el
    // texto sin contar otra vez. true si cambió (hay que actualizar el aviso, sin sonar)
    @Synchronized fun refreshText(chatId: String, msgId: String, text: String): Boolean {
        val id = chatId.lowercase()
        if (text.isBlank() || msgChat[msgId] != id) return false
        val c = chats[id] ?: return false
        if (!c.ids.contains(msgId) || c.last == text) return false
        c.last = text
        return true
    }

    // Quita el mensaje de los otros chats donde se avisó; devuelve esos chats (para actualizar o quitar su aviso)
    @Synchronized fun takeFromOthers(chatId: String, msgId: String): List<String> {
        val id = chatId.lowercase()
        val prev = msgChat[msgId] ?: return emptyList()
        if (prev == id) return emptyList()
        val c = chats[prev] ?: return emptyList()
        if (!c.ids.remove(msgId)) return emptyList()
        if (c.count <= 0) chats.remove(prev)
        return listOf(prev)
    }

    @Synchronized fun clear(chatId: String): Boolean = chats.remove(chatId.lowercase()) != null

    // Devuelve los chats cuya notificación hay que quitar (cuenta 0) y los que hay que actualizar
    @Synchronized fun sync(counts: Map<String, Int>): Pair<List<String>, List<String>> {
        val remove = ArrayList<String>(); val update = ArrayList<String>()
        val it = chats.entries.iterator()
        while (it.hasNext()) {
            val (id, c) = it.next()
            val k = counts[id] ?: 0
            if (k <= 0) { it.remove(); remove.add(id) }
            else if (k != c.count || c.ids.isNotEmpty()) { c.base = k; c.ids.clear(); update.add(id) }
        }
        return Pair(remove, update)
    }

    @Synchronized fun get(chatId: String): Chat? = chats[chatId.lowercase()]
    @Synchronized fun total(): Int = chats.values.sumOf { it.count }
    @Synchronized fun chatIds(): List<String> = chats.keys.toList()
}
