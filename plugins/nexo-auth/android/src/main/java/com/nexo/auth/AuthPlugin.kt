  package com.nexo.auth

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.IvParameterSpec

@CapacitorPlugin(name = "NexoAuth")
class AuthPlugin : Plugin() {
    private val PREFS_NAME = "nexo_secure_identity"
    private val KEY_ALIAS = "nexo_identity_key"
    private val ANDROID_KEYSTORE = "AndroidKeyStore"
    private val IDENTITY_KEY = "encrypted_identity"
    private val IV_KEY = "identity_iv"

    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val biometricManager = BiometricManager.from(context)
        
        val canAuth = biometricManager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG or 
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
        )
        
        val ret = JSObject()
        ret.put("available", canAuth == BiometricManager.BIOMETRIC_SUCCESS)
        ret.put("biometric", canAuth == BiometricManager.BIOMETRIC_SUCCESS)
        ret.put("deviceCredential", true) // Siempre disponible como fallback
        
        call.resolve(ret)
    }

    @PluginMethod
    fun authenticate(call: PluginCall) {
        val title = call.getString("title", "Desbloquear NEXO")
        val subtitle = call.getString("subtitle", "Verifica tu identidad")

        // Verificar si tenemos identidad configurada
        if (!prefs.contains(IDENTITY_KEY)) {
            call.reject("NO_IDENTITY_CONFIGURED", "No hay identidad guardada. Configura primero.")
            return
        }

        val activity = activity as? FragmentActivity
        if (activity == null) {
            call.reject("NO_ACTIVITY", "No se pudo obtener FragmentActivity")
            return
        }

        val executor = ContextCompat.getMainExecutor(context)
        
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                try {
                    val identity = decryptIdentity(result.cryptoObject?.cipher)
                    val ret = JSObject()
                    ret.put("success", true)
                    ret.put("identity", identity)
                    ret.put("method", if (result.authenticationType == BiometricPrompt.AUTHENTICATION_RESULT_TYPE_BIOMETRIC) 
                        "biometric" else "device_credential")
                    call.resolve(ret)
                } catch (e: Exception) {
                    call.reject("DECRYPTION_ERROR", e.message)
                }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                when (errorCode) {
                    BiometricPrompt.ERROR_USER_CANCELED,
                    BiometricPrompt.ERROR_NEGATIVE_BUTTON -> {
                        call.reject("CANCELLED", "Usuario canceló la autenticación")
                    }
                    BiometricPrompt.ERROR_NO_BIOMETRICS,
                    BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL -> {
                        call.reject("NO_CREDENTIALS", "No hay biometría ni PIN configurados")
                    }
                    else -> {
                        call.reject("AUTH_ERROR_$errorCode", errString.toString())
                    }
                }
            }

            override fun onAuthenticationFailed() {
                // Intento fallido (huella no reconocida), pero no error crítico
                // Android reintentará automáticamente
            }
        }

        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title!!)
            .setSubtitle(subtitle!!)
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or 
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
            )
            .setConfirmationRequired(false) // Más rápido para UX
            .build()

        try {
            val cipher = getDecryptCipher()
            val cryptoObject = BiometricPrompt.CryptoObject(cipher)
            val prompt = BiometricPrompt(activity, executor, callback)
            
            prompt.authenticate(promptInfo, cryptoObject)
        } catch (e: Exception) {
            call.reject("CRYPTO_ERROR", "Error al preparar cifrado: ${e.message}")
        }
    }

    @PluginMethod
    fun setupIdentity(call: PluginCall) {
        val identityId = call.getString("identityId")
        if (identityId.isNullOrEmpty()) {
            call.reject("NO_IDENTITY_ID", "Se requiere identityId")
            return
        }

        try {
            // Generar clave protegida por biometría
            generateKey()
            
            // Encriptar y guardar
            val cipher = getEncryptCipher()
            val encrypted = cipher.doFinal(identityId.toByteArray(Charsets.UTF_8))
            
            prefs.edit()
                .putString(IDENTITY_KEY, Base64.encodeToString(encrypted, Base64.DEFAULT))
                .putString(IV_KEY, Base64.encodeToString(cipher.iv, Base64.DEFAULT))
                .apply()
            
            val ret = JSObject()
            ret.put("success", true)
            ret.put("configured", true)
            call.resolve(ret)
            
        } catch (e: Exception) {
            call.reject("SETUP_ERROR", e.message)
        }
    }

    @PluginMethod
    fun clearIdentity(call: PluginCall) {
        prefs.edit().clear().apply()
        
        // Eliminar clave del Keystore
        try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
            keyStore.load(null)
            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS)
            }
        } catch (e: Exception) {
            // Ignorar errores de limpieza
        }
        
        call.resolve()
    }

    private fun generateKey() {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        
        // Eliminar clave anterior si existe
        if (keyStore.containsAlias(KEY_ALIAS)) {
            keyStore.deleteEntry(KEY_ALIAS)
        }
        
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE
        )
        
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_CBC)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_PKCS7)
            .setKeySize(256)
            .setUserAuthenticationRequired(true) // CRÍTICO: Requiere auth biométrico/PIN
            .setInvalidatedByBiometricEnrollment(true)
            .build()
        
        keyGenerator.init(spec)
        keyGenerator.generateKey()
    }

    private fun getEncryptCipher(): Cipher {
        val cipher = Cipher.getInstance("AES/CBC/PKCS7Padding")
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        val key = keyStore.getKey(KEY_ALIAS, null) as SecretKey
        cipher.init(Cipher.ENCRYPT_MODE, key)
        return cipher
    }

    private fun getDecryptCipher(): Cipher {
        val cipher = Cipher.getInstance("AES/CBC/PKCS7Padding")
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        val key = keyStore.getKey(KEY_ALIAS, null) as SecretKey
        
        val ivString = prefs.getString(IV_KEY, null)
            ?: throw IllegalStateException("No IV found")
        val iv = Base64.decode(ivString, Base64.DEFAULT)
        
        cipher.init(Cipher.DECRYPT_MODE, key, IvParameterSpec(iv))
        return cipher
    }

    private fun decryptIdentity(cipher: Cipher?): String {
        if (cipher == null) throw IllegalStateException("No cipher provided")
        
        val encryptedString = prefs.getString(IDENTITY_KEY, null)
            ?: throw IllegalStateException("No identity stored")
        
        val encrypted = Base64.decode(encryptedString, Base64.DEFAULT)
        val decrypted = cipher.doFinal(encrypted)
        
        return String(decrypted, Charsets.UTF_8)
    }
}
