package com.nexo.ble

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// Seguridad fase 3: la clave de datos (AES-256) del cifrado en reposo (AtRestStore), aleatoria y guardada envuelta (AES-GCM) con una
// clave del Android Keystore que no sale del chip. Sin requisito de huella: los mensajes deben poder guardarse con la app bloqueada o en
// segundo plano.
// 3192 (#87, dueño 17-11 «Ok» a guardar cifrada la configuración): movida TAL CUAL desde NexoBlePlugin.atRestDataKey (mismo alias, mismas
// preferencias, misma autoprueba) para que la escucha de internet SIN la app (NetBgHome: servicio o toque FCM en un proceso nuevo, sin
// plugin) lea con la MISMA clave lo que guardó la app. Una por proceso y con un solo cerrojo: el plugin y el servicio nunca crean dos
// claves a la vez (dos claves distintas = archivos que ya no se descifran).
object AtRestKey {
    private const val ALIAS = "nexo_at_rest_wrap_v1"
    private const val PREFS = "nexo_at_rest"
    @Volatile private var cached: SecretKey? = null

    /**
     * La clave de datos. create = true (la app): la crea si aún no existe. create = false (sin la app): solo usa una que ya existe;
     * si no hay, null (en ese teléfono el cifrado en reposo no está activo: los archivos se leen en claro, como en la app).
     * Lanza si el Keystore falla o la autoprueba no pasa (quien llama lo apunta).
     */
    @Synchronized
    fun get(ctx: Context, create: Boolean): SecretKey? {
        cached?.let { return it }
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val stored = prefs.getString("dek", null)
        if (stored == null && !create) return null
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val wrap = (ks.getKey(ALIAS, null) as? SecretKey) ?: run {
            if (!create) return null
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build())
                generateKey()
            }
        }
        val dek: ByteArray = if (stored == null) {
            val k = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, wrap)
            val blob = c.iv + c.doFinal(k)
            if (!prefs.edit().putString("dek", Base64.encodeToString(blob, Base64.NO_WRAP)).commit()) throw Exception("no se pudo guardar la clave")
            k
        } else {
            val blob = Base64.decode(stored, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, wrap, GCMParameterSpec(128, blob, 0, 12))
            c.doFinal(blob, 12, blob.size - 12)
        }
        val key = SecretKeySpec(dek, "AES")
        // Autoprueba antes de usarla
        val probe = "nexo-at-rest-probe".toByteArray()
        if (!AtRestStore.decrypt(key, AtRestStore.encrypt(key, probe)).contentEquals(probe)) throw Exception("autoprueba fallida")
        cached = key
        return key
    }
}
