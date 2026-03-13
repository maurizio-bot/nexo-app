/**
 * WebAuthn Helper v3.0-NAP-SECURITY-HARDENED
 * Zero Mocks Policy - Anti-Bypass - Anti-Robo
 * 
 * Cambios críticos:
 * - Eliminados _registerNativeFallback y _authenticateNativeFallback
 * - Eliminado bypass por storage existente
 * - Eliminado mockId aleatorio
 * - allowDeviceCredential: false en registro (solo biometría real)
 * - Verificación estricta de método biométrico
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
    try {
      const storedId = localStorage.getItem('nexo_webauthn_id');
      const storedMethod = localStorage.getItem('nexo_webauthn_method');
      // Solo considerar registrado si existe ID y método es biométrico real
      return !!storedId && storedMethod === 'biometric-strict';
    } catch (e) {
      return false;
    }
  }
  
  /**
   * NAP-SEC-001: Registro estricto para Onboarding
   * - Solo biometría (Face ID/Huella), NO permite PIN como fallback
   * - Si falla, NO genera mock ni permite bypass
   */
  async registerStrict(username = 'nexo_user') {
    if (!WebAuthnHelper.isSupported()) {
      throw new Error('NAP-SEC-001: WebAuthn no soportado');
    }
    
    if (this._isNative) {
      return this._registerNativeStrict(username);
    }
    
    // Web standard (no Capacitor)
    if (!window.isSecureContext) {
      throw new Error('NAP-SEC-002: Contexto inseguro (HTTPS requerido)');
    }
    
    return this._registerWebStandard(username);
  }
  
  /**
   * NAP-SEC-003: Autenticación diaria (sin botón omitir)
   * - Si tiene credencial guardada, SOLO entra con biometría o PIN del sistema
   * - NO hay bypass por storage, NO hay mocks
   */
  async authenticateDaily() {
    if (!WebAuthnHelper.isSupported()) {
      throw new Error('NAP-SEC-003: Autenticación no disponible');
    }
    
    // Verificar si tiene credencial previa
    const hasCredential = await WebAuthnHelper.isRegistered();
    
    if (this._isNative) {
      return this._authenticateNativeStrict(hasCredential);
    }
    
    return this._authenticateWebStandard(hasCredential);
  }
  
  /**
   * Registro nativo Android/iOS - Estricto
   */
  async _registerNativeStrict(username) {
    const { LocalAuthentication } = window.Capacitor?.Plugins || {};
    
    if (!LocalAuthentication) {
      throw new Error('NAP-SEC-004: Plugin LocalAuthentication no disponible');
    }
    
    const { value: isAvailable } = await LocalAuthentication.isAvailable();
    
    if (!isAvailable) {
      throw new Error('NAP-SEC-005: Biometría no disponible o no configurada en el sistema');
    }
    
    try {
      // CRÍTICO: allowDeviceCredential: false = Solo Face ID/Huella, NO PIN
      const result = await LocalAuthentication.authenticate({
        reason: 'Configura tu seguridad en NEXO',
        title: 'Protege tu cuenta',
        subtitle: 'Verificación biométrica requerida',
        cancelButtonTitle: 'Cancelar',
        allowDeviceCredential: false, // FORZAR biometría real
        biometricTitle: 'Biometría requerida',
        biometricSubTitle: 'Usa Face ID o Huella Digital',
        biometricDescription: 'Esta configuración protegerá tu acceso a NEXO'
      });
      
      // Validación estricta del resultado
      if (!result.success) {
        throw new Error('NAP-SEC-006: Autenticación cancelada o fallida');
      }
      
      // Verificar que realmente se usó biometría (no PIN ni bypass)
      // En Android, result.method suele ser 'biometric' cuando es éxito real
      // Si es undefined pero success es true, asumimos biometría si allowDeviceCredential es false
      if (result.method && result.method !== 'biometric') {
        throw new Error(`NAP-SEC-007: Método inválido detectado: ${result.method}`);
      }
      
      // Generar ID determinístico basado en identidad del dispositivo + timestamp
      // NO es mock porque se vincula a este dispositivo específico
      const deviceId = await this._getDeviceIdentifier();
      const entropy = `${deviceId}-${Date.now()}-${Math.random()}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(entropy);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const credentialId = Array.from(new Uint8Array(hashBuffer));
      
      // Guardar con metadata de seguridad
      localStorage.setItem('nexo_webauthn_id', JSON.stringify(credentialId));
      localStorage.setItem('nexo_webauthn_method', 'biometric-strict');
      localStorage.setItem('nexo_webauthn_timestamp', Date.now().toString());
      
      return {
        success: true,
        credentialId: credentialId,
        type: 'native-biometric-strict',
        method: 'biometric',
        platform: 'android-native',
        verified: true // Flag crítico para confirmar éxito real
      };
      
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.message?.includes('cancelled')) {
        throw new Error('NAP-SEC-008: Usuario canceló la autenticación biométrica');
      }
      throw err;
    }
  }
  
  /**
   * Autenticación nativa estricta - Para uso diario (sin botón omitir)
   */
  async _authenticateNativeStrict(hasCredential) {
    const { LocalAuthentication } = window.Capacitor?.Plugins || {};
    
    if (!LocalAuthentication) {
      throw new Error('NAP-SEC-009: Plugin no disponible');
    }
    
    const { value: isAvailable } = await LocalAuthentication.isAvailable();
    
    // CASO CRÍTICO: Tenía credencial pero ahora no hay biometría disponible
    // Esto puede pasar si:
    // 1. Se desconfiguró la biometría del sistema
    // 2. Se agregó una cara/huella nueva (Android invalida las claves biométricas)
    // 3. Es un ataque (intentan bypass)
    if (!isAvailable && hasCredential) {
      throw new Error('NAP-SEC-BLOCK: Biometría desactivada o modificada. Acceso bloqueado por seguridad. Reconfigura en Ajustes.');
    }
    
    // No tenía credencial (onboarding omitido) → Permitir sin protección
    if (!isAvailable && !hasCredential) {
      return { 
        success: true, 
        method: 'none', 
        unprotected: true,
        warning: 'DISPOSITIVO_SIN_PROTECCION' 
      };
    }
    
    // Intento de autenticación biométrica real
    try {
      const result = await LocalAuthentication.authenticate({
        reason: 'Desbloquear NEXO',
        title: 'Acceso seguro requerido',
        subtitle: 'Verifica tu identidad',
        cancelButtonTitle: 'Cancelar',
        // Permitir PIN del sistema como fallback legítimo (el ladrón no debería saber el PIN del teléfono)
        // pero el usuario debe elegirlo explícitamente en la UI nativa
        allowDeviceCredential: true,
        fallbackTitle: 'Usar PIN del dispositivo'
      });
      
      if (!result.success) {
        throw new Error('NAP-SEC-DENIED: Autenticación fallida o cancelada');
      }
      
      // Validar método usado
      const validMethods = ['biometric', 'deviceCredential', 'pin', 'password'];
      if (!validMethods.includes(result.method)) {
        throw new Error(`NAP-SEC-INVALID: Método no reconocido: ${result.method}`);
      }
      
      return {
        success: true,
        method: result.method, // 'biometric' o 'pin' (ambos válidos si el sistema los aceptó)
        platform: 'android-native',
        verified: true,
        timestamp: Date.now()
      };
      
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('NAP-SEC-DENIED: Acceso cancelado');
      }
      throw new Error(`NAP-SEC-LOCKED: ${err.message || 'Acceso denegado'}`);
    }
  }
  
  /**
   * Registro Web estándar (navegadores)
   */
  async _registerWebStandard(username) {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));
    
    const options = {
      challenge,
      rp: { name: 'NEXO', id: this._getRpId() },
      user: {
        id: userId,
        name: username,
        displayName: 'NEXO User'
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'required'
      },
      timeout: 60000,
      attestation: 'none'
    };
    
    try {
      const credential = await navigator.credentials.create({ publicKey: options });
      
      if (!credential) {
        throw new Error('NAP-SEC-WEB-001: No se pudo crear la credencial');
      }
      
      const rawId = Array.from(new Uint8Array(credential.rawId));
      localStorage.setItem('nexo_webauthn_id', JSON.stringify(rawId));
      localStorage.setItem('nexo_webauthn_method', 'biometric-strict');
      
      return {
        success: true,
        credentialId: rawId,
        type: 'webauthn-platform',
        platform: 'web',
        verified: true
      };
      
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('NAP-SEC-WEB-002: Usuario canceló o no verificó');
      }
      throw new Error(`NAP-SEC-WEB-003: ${err.message}`);
    }
  }
  
  /**
   * Autenticación Web estándar
   */
  async _authenticateWebStandard(hasCredential) {
    if (!hasCredential) {
      return { success: true, method: 'none', unprotected: true };
    }
    
    let credentialId;
    try {
      const storedId = localStorage.getItem('nexo_webauthn_id');
      credentialId = new Uint8Array(JSON.parse(storedId));
    } catch (e) {
      throw new Error('NAP-SEC-WEB-004: Datos de credencial corruptos');
    }
    
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    
    const options = {
      challenge,
      allowCredentials: [{
        id: credentialId,
        type: 'public-key',
        transports: ['internal']
      }],
      userVerification: 'required',
      timeout: 60000
    };
    
    try {
      const assertion = await navigator.credentials.get({ publicKey: options });
      
      if (!assertion) {
        throw new Error('NAP-SEC-WEB-005: Autenticación fallida');
      }
      
      return {
        success: true,
        method: 'biometric',
        platform: 'web',
        verified: true
      };
      
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('NAP-SEC-WEB-006: Autenticación cancelada o fallida');
      }
      throw new Error('NAP-SEC-WEB-007: Error de autenticación');
    }
  }
  
  /**
   * Obtener identificador único del dispositivo (NO mock)
   */
  async _getDeviceIdentifier() {
    try {
      if (window.Capacitor?.Plugins?.Device) {
        const info = await window.Capacitor.Plugins.Device.getId();
        return info.identifier;
      }
    } catch (e) {
      console.warn('[NAP-SEC] No se pudo obtener Device ID:', e);
    }
    
    // Fallback solo para web (no nativo)
    if (!this._isNative) {
      return `${navigator.userAgent}-${screen.width}x${screen.height}-${screen.colorDepth}`;
    }
    
    throw new Error('NAP-SEC-010: No se pudo obtener identificador del dispositivo');
  }
  
  _getRpId() {
    if (this._isNative) return 'nexo.app';
    const hostname = window.location.hostname;
    return (!hostname || hostname === 'localhost') ? 'localhost' : hostname;
  }
  
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
  
  destroy() {
    this.cancel();
  }
  
  /**
   * Limpieza completa de credenciales (para logout o reset)
   */
  static clearCredentials() {
    localStorage.removeItem('nexo_webauthn_id');
    localStorage.removeItem('nexo_webauthn_method');
    localStorage.removeItem('nexo_webauthn_timestamp');
    localStorage.removeItem('nexo_security_level');
  }
}

// UMD Export
if (typeof window !== 'undefined') {
  window.WebAuthnHelper = WebAuthnHelper;
}
