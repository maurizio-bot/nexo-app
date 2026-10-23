package com.nexo.ble

// Cuenta de mensajes sin leer por chat para las notificaciones (sin Android: se prueba en JVM).
// - add: un mensaje nuevo (por la app o por la escucha de internet en segundo plano); el mismo msgId no cuenta dos
//   veces aunque lo avisen las dos partes.
// - sync: los contadores de la app mandan (al volver a la app o cuando cambian): lo que la app ya contó pasa a ser la
//   base y lo visto hasta ahora no vuelve a contar.
// - clear: chat abierto.
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
        return true
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
