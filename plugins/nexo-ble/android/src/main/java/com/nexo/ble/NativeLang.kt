package com.nexo.ble

import android.content.Context
import java.util.Locale

/**
 * 3122 — El idioma de la app para los avisos del teléfono. La app lo manda al arrancar y al cambiarlo (setAppLang) y se guarda;
 * con la app cerrada (aviso de FCM, servicio) se lee de aquí. Sin guardar: el del teléfono si es uno de los nuestros, si no español.
 */
object NativeLang {
    private const val PREFS = "nexo_native_lang"
    @Volatile private var cached: String? = null

    @JvmStatic
    fun get(ctx: Context?): String {
        cached?.let { return it }
        val saved = try { ctx?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.getString("lang", null) } catch (e: Throwable) { null }
        val l = if (saved != null) NativeText.norm(saved) else NativeText.norm(Locale.getDefault().language)
        if (saved != null) cached = l
        return l
    }

    @JvmStatic
    fun set(ctx: Context?, lang: String?) {
        val l = NativeText.norm(lang)
        cached = l
        try { ctx?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.edit()?.putString("lang", l)?.apply() } catch (e: Throwable) {}
    }

    /** Atajo: el texto [key] en el idioma de la app. */
    @JvmStatic
    fun t(ctx: Context?, key: String, vararg args: Pair<String, Any?>): String = NativeText.t(get(ctx), key, *args)
}
