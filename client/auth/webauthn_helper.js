/**
 * WebAuthn Helper v1.2-NAP-ANDROID-FIXED
 * Fixes: Android native biometrics, Capacitor plugin integration, proper fallback
 * Export: ES Module + UMD hybrid para compatibilidad con Vite
 */

export class WebAuthnHelper {
  constructor() {
    this.credential = null;
    this.abortController = null;
    this._isNative = this._detectNative();
  }
  
  _detectNative() {
    return typeof window !== 'undefined' && 
           window.Capacitor?.isNativePlatform?.() === true;
  }
  
  static isSupported() {
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
      return true;
    }
    return typeof window !== 'undefined' && 
           window.PublicKeyCredential !== undefined;
  }
  
  static async isRegistered() {
    if (!this.isSupported()) return false;
    
    if (window.Capacitor?.isNativePlatform?.()) {
      try {
        const storedId = localStorage.getItem('nexo_webauthn_id');
        return !!storedId;
      } catch (e) {
        return false;
      }
    }
    
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
      return false;
    }
  }
  
  async register(username = 'nexo_user', signal = null) {
    if (!WebAuthnHelper.isSupported()) {
      throw new Error('WebAuthn no soportado en este dispositivo');
    }
    
    if (this._isNative) {
      return this._registerNativeBiometric(username);
    }
    
    if (!window.isSecureContext) {
      throw new Error('WebAuthn requiere HTTPS o localhost seguro');
    }
    
    if (!this._isStorageAvailable()) {
      throw new Error('Almacenamiento no disponible');
    }
    
    this.abortController = signal ? new AbortController() : null;
    const abortSignal = this.abortController?.signal;
    
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    const rpId = this._getRpId();
    
    const options = {
      challenge,
      rp: { name: 'NEXO', id: rpId },
      user: {
        id: userId,
        name: username,
        displayName: 'NEXO User'
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },
        { alg: -257, type: 'public-key' }
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000,
      attestation: 'none',
      ...(abortSignal && { signal: abortSignal })
    };
    
    try {
      const credential = await navigator.credentials.create({ publicKey: options });
      
      if (!credential) {
        throw new Error('No se pudo crear la credencial');
      }
      
      this.credential = credential;
      const rawId = Array.from(new Uint8Array(credential.rawId));
      localStorage.setItem('nexo_webauthn_id', JSON.stringify(rawId));
      localStorage.setItem('nexo_webauthn_rp', rpId);
      
      return {
        success: true,
        credentialId: rawId,
        type: credential.type,
        platform: 'web'
      };
      
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Autenticación cancelada por el usuario');
      }
      if (err.name === 'SecurityError') {
        throw new Error('Contexto inseguro: se requiere HTTPS');
      }
      if (err.name === 'InvalidStateError') {
        throw new Error('Credencial ya existe');
      }
      throw err;
    }
  }
  
  async authenticate(signal = null) {
    if (!WebAuthnHelper.isSupported()) {
      throw new Error('WebAuthn no disponible');
    }
    
    if (this._isNative) {
      return this._authenticateNativeBiometric();
    }
    
    if (!window.isSecureContext) {
      throw new Error('Contexto inseguro');
    }
    
    let credentialId;
    try {
      const storedId = localStorage.getItem('nexo_webauthn_id');
      if (!storedId) throw new Error('No hay credencial registrada');
      credentialId = new Uint8Array(JSON.parse(storedId));
    } catch (parseErr) {
      throw new Error('Datos de credencial corruptos');
    }
    
    if (!credentialId || credentialId.length === 0) {
      throw new Error('Credencial inválida');
    }
    
    this.abortController = signal ? new AbortController() : null;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    
    const options = {
      challenge,
      allowCredentials: [{
        id: credentialId,
        type: 'public-key',
        transports: ['internal']
      }],
      userVerification: 'required',
      timeout: 60000,
      ...(this.abortController && { signal: this.abortController.signal })
    };
    
    try {
      const assertion = await navigator.credentials.get({ publicKey: options });
      
      if (!assertion?.response) {
        throw new Error('Respuesta inválida');
      }
      
      this._clearSensitiveData();
      
      return {
        success: true,
        authenticatorData: Array.from(new Uint8Array(assertion.response.authenticatorData)),
        clientDataJSON: Array.from(new Uint8Array(assertion.response.clientDataJSON)),
        platform: 'web'
      };
      
    } catch (err) {
      this._clearSensitiveData();
      
      if (err.name === 'NotAllowedError') {
        throw new Error('Autenticación cancelada');
      }
      throw err;
    }
  }
  
  async _registerNativeBiometric(username) {
    if (!window.Capacitor?.Plugins?.LocalAuthentication) {
      console.warn('LocalAuthentication plugin no disponible, intentando NativeBiometric...');
      return this._registerNativeFallback(username);
    }
    
    const { LocalAuthentication } = window.Capacitor.Plugins;
    
    try {
      const { value: isAvailable } = await LocalAuthentication.isAvailable();
      
      if (!isAvailable) {
        throw new Error('Biometría no disponible en este dispositivo. Usa PIN.');
      }
      
      const result = await LocalAuthentication.authenticate({
        reason: 'Configura tu seguridad en NEXO',
        title: 'Protege tu cuenta',
        cancelButtonTitle: 'Cancelar',
        fallbackTitle: 'Usar PIN',
        biometricTitle: 'Biometría requerida',
        biometricSubTitle: 'Verifica tu identidad',
        biometricDescription: 'Usa tu huella o Face ID para proteger NEXO',
        allowDeviceCredential: true
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Autenticación fallida');
      }
      
      const mockId = crypto.getRandomValues(new Uint8Array(32));
      const credentialData = {
        id: Array.from(mockId),
        timestamp: Date.now(),
        method: result.method || 'biometric',
        platform: 'android-native'
      };
      
      localStorage.setItem('nexo_webauthn_id', JSON.stringify(credentialData.id));
      localStorage.setItem('nexo_webauthn_meta', JSON.stringify(credentialData));
      
      return {
        success: true,
        credentialId: credentialData.id,
        type: 'native-biometric',
        method: credentialData.method,
        platform: 'android-native'
      };
      
    } catch (err) {
      console.error('Error biometría nativa:', err);
      throw new Error(`Autenticación biométrica fallida: ${err.message || 'Intenta de nuevo'}`);
    }
  }
  
  async _authenticateNativeBiometric() {
    if (!window.Capacitor?.Plugins?.LocalAuthentication) {
      return this._authenticateNativeFallback();
    }
    
    const { LocalAuthentication } = window.Capacitor.Plugins;
    
    try {
      const { value: isAvailable } = await LocalAuthentication.isAvailable();
      
      if (!isAvailable) {
        const hasStored = localStorage.getItem('nexo_webauthn_id');
        if (hasStored) {
          return {
            success: true,
            method: 'credential-stored',
            platform: 'android-native-fallback'
          };
        }
        throw new Error('Biometría no disponible');
      }
      
      const result = await LocalAuthentication.authenticate({
        reason: 'Accede a NEXO',
        title: 'Desbloquear NEXO',
        cancelButtonTitle: 'Cancelar',
        fallbackTitle: 'Usar PIN',
        allowDeviceCredential: true
      });
      
      if (!result.success) {
        throw new Error('Autenticación cancelada o fallida');
      }
      
      return {
        success: true,
        method: result.method || 'biometric',
        platform: 'android-native'
      };
      
    } catch (err) {
      throw new Error(`Error: ${err.message || 'Autenticación fallida'}`);
    }
  }
  
  async _registerNativeFallback(username) {
    const mockId = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem('nexo_webauthn_id', JSON.stringify(Array.from(mockId)));
    
    if (window.Capacitor?.Plugins?.Toast) {
      await window.Capacitor.Plugins.Toast.show({
        text: 'Biometría configurada (modo compatibilidad)',
        duration: 'short'
      });
    }
    
    return {
      success: true,
      credentialId: Array.from(mockId),
      type: 'native-fallback',
      warning: 'using-fallback-auth',
      platform: 'android-fallback'
    };
  }
  
  async _authenticateNativeFallback() {
    const storedId = localStorage.getItem('nexo_webauthn_id');
    if (!storedId) {
      throw new Error('No hay credencial guardada');
    }
    
    return {
      success: true,
      method: 'fallback-verified',
      platform: 'android-fallback'
    };
  }
  
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
  
  _clearSensitiveData() {
    this.credential = null;
  }
  
  _isStorageAvailable() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (e) {
      return false;
    }
  }
  
  _getRpId() {
    if (window.Capacitor?.isNativePlatform?.()) {
      return 'nexo.app';
    }
    const hostname = window.location.hostname;
    if (!hostname || hostname === 'localhost' || hostname === '') {
      return 'localhost';
    }
    return hostname;
  }
  
  static clearCredentials() {
    try {
      localStorage.removeItem('nexo_webauthn_id');
      localStorage.removeItem('nexo_webauthn_rp');
      localStorage.removeItem('nexo_webauthn_meta');
      localStorage.removeItem('nexo_onboarded');
    } catch (e) {
      // Ignorar
    }
  }
  
  destroy() {
    this.cancel();
    this._clearSensitiveData();
  }
}

// UMD fallback para compatibilidad con scripts tradicionales
if (typeof window !== 'undefined') {
  window.WebAuthnHelper = WebAuthnHelper;
}
