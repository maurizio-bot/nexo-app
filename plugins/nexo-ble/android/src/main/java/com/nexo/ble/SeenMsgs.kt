package com.nexo.ble

import android.content.Context

// 3008 (dueño 11-11: «me llegan notificaciones y luego entro y no hay mensajes nuevos»): ids de los mensajes que este teléfono
// YA tiene (recibidos con la app abierta, o ya avisados). Con la app cerrada, el aviso nativo (internet o Bluetooth) solo miraba
// si ese mismo SOBRE ya había llegado, no si el MENSAJE ya estaba: cuando el otro teléfono reenviaba algo que ya tenías (un envío
// que en su lado seguía pendiente), salía «Mensaje nuevo» y al entrar no había nada. Ahora, si el id ya está aquí, no se avisa.
// Persistente (sobrevive a cerrar la app); se guardan los últimos MAX ids.
object SeenMsgs {
    private const val PREFS = "nexo_seen_msgs"
    private const val KEY = "ids"
    private const val MAX = 3000
    private var cache: LinkedHashSet<String>? = null

    @Synchronized
    private fun load(ctx: Context): LinkedHashSet<String> {
        val c = cache
        if (c != null) return c
        val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "") ?: ""
        val s = LinkedHashSet<String>()
        if (raw.isNotEmpty()) raw.split('\n').forEach { if (it.isNotEmpty()) s.add(it) }
        cache = s
        return s
    }

    @Synchronized
    fun has(ctx: Context, id: String): Boolean = id.isNotEmpty() && load(ctx).contains(id)

    @Synchronized
    fun add(ctx: Context, ids: Collection<String>) {
        val s = load(ctx)
        var changed = false
        for (id in ids) { if (id.isNotEmpty() && id.length <= 200 && s.add(id)) changed = true }
        if (!changed) return
        while (s.size > MAX) { val it = s.iterator(); it.next(); it.remove() }
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, s.joinToString("\n")).apply()
    }
}
