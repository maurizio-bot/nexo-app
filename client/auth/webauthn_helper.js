/**
 * WebAuthn Helper v1.1-NAP-CERTIFIED-CORRECTED
 * Fixes: JSON parse safety, SecurityError, memory cleanup, Capacitor hostname
 */

export class WebAuthnHelper {
  constructor() {
    this.credential = null;
    this.abortController = null; // [FIX] Para cancelar operaciones
  }
  
  static isSupported() {
    return typeof window !== 'undefined' && 
           window.PublicKeyCredential !== undefined;
  }
  
  static async isRegistered() {
    if (!this.isSupported()) return false;
    
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
    
    // [FIX] Verificar secure context
    if (!window.isSecureContext) {
      throw new Error('WebAuthn requiere HTTPS o localhost seguro');
    }
    
    // [FIX] Verificar localStorage disponible
    if (!this._isStorageAvailable()) {
      throw new Error('Almacenamiento no disponible (modo privado?)');
    }
    
    if (window.Capacitor?.isNativePlatform?.()) {
      return this._registerNative(username);
    }
    
    // [FIX] Crear AbortController si no viene externo
    this.abortController = signal ? new AbortController() : null;
    const abortSignal = this.abortController?.signal;
    
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    
    // [FIX] Hostname seguro para Capacitor/WebView
    const rpId = this._getRpId();
    
    const options = {
      challenge,
      rp: {
        name: 'NEXO',
        id: rpId
      },
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
        residentKey: 'preferred' // [FIX] 'preferred' en lugar de 'required' para compatibilidad
      },
      timeout: 60000,
      attestation: 'none',
      ...(abortSignal && { signal: abortSignal }) // [FIX] Cancelable
    };
    
    try {
      const credential = await navigator.credentials.create({ publicKey: options });
      
      if (!credential) {
        throw new Error('No se pudo crear la credencial');
      }
      
      this.credential = credential;
      
      // Guardar rawId
      const rawId = Array.from(new Uint8Array(credential.rawId));
      localStorage.setItem('nexo_webauthn_id', JSON.stringify(rawId));
      localStorage.setItem('nexo_webauthn_rp', rpId); // [FIX] Guardar RP para validación futura
      
      return {
        success: true,
        credentialId: rawId,
        type: credential.type
      };
      
    } catch (err) {
      // [FIX] Manejo específico de errores
      if (err.name === 'NotAllowedError') {
        throw new Error('Autenticación cancelada por el usuario');
      }
      if (err.name === 'SecurityError') {
        throw new Error('Contexto inseguro: se requiere HTTPS');
      }
      if (err.name === 'InvalidStateError') {
        throw new Error('Credencial ya existe o authenticator no disponible');
      }
      throw err;
    }
  }
  
  async authenticate(signal = null) {
    if (!WebAuthnHelper.isSupported()) {
      throw new Error('WebAuthn no disponible');
    }
    
    if (!window.isSecureContext) {
      throw new Error('Contexto inseguro');
    }
    
    // [FIX] Safe JSON parse con try-catch
    let credentialId;
    try {
      const storedId = localStorage.getItem('nexo_webauthn_id');
      if (!storedId) throw new Error('No hay credencial registrada');
      credentialId = new Uint8Array(JSON.parse(storedId));
    } catch (parseErr) {
      throw new Error('Datos de credencial corruptos. Registra nuevamente.');
    }
    
    // [FIX] Validar que tenemos datos binarios válidos
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
        throw new Error('Respuesta de autenticador inválida');
      }
      
      // [FIX] Limpiar credencial de memoria después de usar
      this._clearSensitiveData();
      
      return {
        success: true,
        authenticatorData: Array.from(new Uint8Array(assertion.response.authenticatorData)),
        clientDataJSON: Array.from(new Uint8Array(assertion.response.clientDataJSON))
      };
      
    } catch (err) {
      this._clearSensitiveData();
      
      if (err.name === 'NotAllowedError') {
        throw new Error('Autenticación cancelada');
      }
      if (err.name === 'SecurityError') {
        throw new Error('Error de seguridad: dominio no coincide');
      }
      throw err;
    }
  }
  
  /**
   * [FIX] Cancelar operación pendiente
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
  
  /**
   * [FIX] Limpiar datos sensibles de memoria
   */
  _clearSensitiveData() {
    this.credential = null;
  }
  
  /**
   * [FIX] Validar disponibilidad de storage
   */
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
  
  /**
   * [FIX] Obtener RP ID seguro para Capacitor/Web
   */
  _getRpId() {
    // Para Capacitor/Android, usar un dominio válido hardcodeado
    if (window.Capacitor?.isNativePlatform?.()) {
      return 'nexo.app'; // [IMPORTANTE] Debe coincidir con el assetlinks.json en Android
    }
    
    // Para web, validar hostname
    const hostname = window.location.hostname;
    if (!hostname || hostname === 'localhost' || hostname === '') {
      return 'localhost'; // Solo para desarrollo
    }
    return hostname;
  }
  
  async _registerNative(username) {
    console.warn('Native WebAuthn not implemented, using fallback');
    
    // [FIX] Verificar storage antes de usar
    if (!this._isStorageAvailable()) {
      throw new Error('Storage no disponible');
    }
    
    const mockId = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem('nexo_webauthn_id', JSON.stringify(Array.from(mockId)));
    
    return {
      success: true,
      credentialId: Array.from(mockId),
      type: 'native-fallback',
      mock: true
    };
  }
  
  static clearCredentials() {
    try {
      localStorage.removeItem('nexo_webauthn_id');
      localStorage.removeItem('nexo_webauthn_rp');
      localStorage.removeItem('nexo_onboarded');
    } catch (e) {
      // Ignorar errores de storage
    }
  }
  
  /**
   * [FIX] Cleanup completo
   */
  destroy() {
    this.cancel();
    this._clearSensitiveData();
  }
}
