/**
 * NexoPermissionShim.js v1.0-ARCH
 * Permission Shim JS blindado para NEXO App
 * Traduce API granular #1057 a API nativa #961 sin tocar Kotlin
 * 
 * Características:
 * - Guard clauses en cada método
 * - Retry backoff 3x500ms
 * - Anti-spam caché (5s TTL)
 * - Singleton pattern
 * - Cleanup automático de listeners
 * - Compatible con main.js v9.0-NAP
 */

const SHIM_VERSION = '1.0-ARCH';
const RETRY_MAX = 3;
const RETRY_DELAY = 500;
const CACHE_TTL = 5000;

class NexoPermissionShim {
  constructor() {
    if (NexoPermissionShim._instance) {
      return NexoPermissionShim._instance;
    }
    
    this._cache = new Map();
    this._listeners = [];
    this._initialized = false;
    this._plugin = null;
    this._logPrefix = '[PermissionShim]';
    
    NexoPermissionShim._instance = this;
  }

  static getInstance() {
    if (!NexoPermissionShim._instance) {
      NexoPermissionShim._instance = new NexoPermissionShim();
    }
    return NexoPermissionShim._instance;
  }

  /**
   * Inicializa el Shim y detecta el plugin nativo
   */
  async init() {
    if (this._initialized) {
      this._log('Ya inicializado, ignorando');
      return { success: true, cached: true };
    }

    try {
      // Guard: Capacitor disponible
      if (typeof Capacitor === 'undefined' || !Capacitor.Plugins) {
        throw new Error('Capacitor no disponible');
      }

      // Guard: Plugin NexoBLE existe
      this._plugin = Capacitor.Plugins.NexoBLE;
      if (!this._plugin) {
        throw new Error('Plugin NexoBLE no encontrado');
      }

      this._log(`Shim v${SHIM_VERSION} inicializado`);
      this._initialized = true;
      
      return { success: true, plugin: 'NexoBLE' };
    } catch (error) {
      this._error('Error inicializando Shim:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Verifica estado de permisos BLE (API #961 compatible)
   * Retorna éxito/fallo global (granularidad genérica, aceptable para MVP)
   */
  async checkBLEStatus() {
    const cacheKey = 'checkBLEStatus';
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    // Guard: plugin inicializado
    if (!this._plugin) {
      const initResult = await this.init();
      if (!initResult.success) {
        return { allGranted: false, error: initResult.error };
      }
    }

    try {
      // Guard: método existe en plugin
      if (typeof this._plugin.checkBLEStatus !== 'function') {
        throw new Error('Método checkBLEStatus no disponible en plugin nativo');
      }

      const result = await this._plugin.checkBLEStatus();
      this._log('checkBLEStatus:', result);
      
      // Normalizar respuesta #961 (puede venir en diferentes formatos)
      const normalized = this._normalizeStatus(result);
      this._setCache(cacheKey, normalized);
      
      return normalized;
    } catch (error) {
      this._error('Error en checkBLEStatus:', error);
      return { allGranted: false, error: error.message };
    }
  }

  /**
   * Solicita permisos BLE (API #961 compatible)
   * Con retry backoff automático
   */
  async requestBLEPermissions() {
    const cacheKey = 'requestBLEPermissions';
    
    // Guard: plugin inicializado
    if (!this._plugin) {
      const initResult = await this.init();
      if (!initResult.success) {
        return { granted: false, error: initResult.error };
      }
    }

    // Intentar con retry
    for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
      try {
        this._log(`Solicitando permisos (intento ${attempt}/${RETRY_MAX})`);

        // Guard: método existe
        if (typeof this._plugin.initializeBLE !== 'function') {
          throw new Error('Método initializeBLE no disponible en plugin nativo');
        }

        const result = await this._plugin.initializeBLE();
        this._log('initializeBLE resultado:', result);

        // Normalizar respuesta
        const normalized = this._normalizePermissionResult(result);
        
        if (normalized.granted) {
          this._setCache(cacheKey, normalized);
          this._clearCache('checkBLEStatus'); // Invalidar caché de status
          return normalized;
        }

        // Si no concedió y no es el último intento, esperar
        if (attempt < RETRY_MAX) {
          this._log(`Reintentando en ${RETRY_DELAY}ms...`);
          await this._sleep(RETRY_DELAY * attempt); // Backoff exponencial
        }

      } catch (error) {
        this._error(`Error en intento ${attempt}:`, error);
        if (attempt === RETRY_MAX) {
          return { granted: false, error: error.message, attempts: RETRY_MAX };
        }
        await this._sleep(RETRY_DELAY * attempt);
      }
    }

    return { granted: false, error: 'Máximo de intentos alcanzado', attempts: RETRY_MAX };
  }

  /**
   * Verifica si todos los permisos están concedidos
   * Wrapper conveniente para main.js
   */
  async arePermissionsGranted() {
    const status = await this.checkBLEStatus();
    return status.allGranted === true;
  }

  /**
   * Flujo completo: verificar → solicitar si es necesario
   * Retorna true solo si todos los permisos están OK
   */
  async ensurePermissions() {
    // Paso 1: Verificar estado actual
    const status = await this.checkBLEStatus();
    if (status.allGranted) {
      this._log('Permisos ya concedidos');
      return { success: true, alreadyGranted: true };
    }

    // Paso 2: Solicitar permisos
    this._log('Permisos pendientes, solicitando...');
    const request = await this.requestBLEPermissions();
    
    if (request.granted) {
      return { success: true, alreadyGranted: false };
    }

    return { 
      success: false, 
      error: request.error,
      attempts: request.attempts 
    };
  }

  /**
   * Registra listener para cambios de estado de permisos
   * Cleanup automático al destruir
   */
  onPermissionStatusChange(callback) {
    if (!this._plugin) {
      this._error('Plugin no inicializado, no se puede registrar listener');
      return () => {}; // No-op cleanup
    }

    try {
      if (typeof this._plugin.addListener !== 'function') {
        this._warn('addListener no disponible en plugin');
        return () => {};
      }

      const listener = this._plugin.addListener('onPermissionStatusChanged', (data) => {
        this._log('Cambio de estado de permisos:', data);
        this._clearCache('checkBLEStatus');
        callback(data);
      });

      this._listeners.push(listener);
      return () => this._removeListener(listener);
    } catch (error) {
      this._error('Error registrando listener:', error);
      return () => {};
    }
  }

  /**
   * Destruye el Shim y limpia todos los recursos
   */
  destroy() {
    this._log('Destruyendo Shim...');
    
    // Limpiar listeners
    this._listeners.forEach(listener => {
      try {
        if (listener && typeof listener.remove === 'function') {
          listener.remove();
        }
      } catch (e) {
        // Ignorar errores de cleanup
      }
    });
    this._listeners = [];
    
    // Limpiar caché
    this._cache.clear();
    
    this._initialized = false;
    this._plugin = null;
    
    NexoPermissionShim._instance = null;
    this._log('Shim destruido');
  }

  // ============ MÉTODOS PRIVADOS ============

  _normalizeStatus(result) {
    // API #961 puede retornar: boolean, {allGranted: bool}, {granted: bool}, etc.
    if (typeof result === 'boolean') {
      return { allGranted: result };
    }
    if (result && typeof result === 'object') {
      return {
        allGranted: result.allGranted === true || result.granted === true,
        raw: result
      };
    }
    return { allGranted: false, raw: result };
  }

  _normalizePermissionResult(result) {
    if (typeof result === 'boolean') {
      return { granted: result };
    }
    if (result && typeof result === 'object') {
      return {
        granted: result.granted === true || result.success === true,
        raw: result
      };
    }
    return { granted: false, raw: result };
  }

  _getCache(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this._cache.delete(key);
      return null;
    }
    return entry.value;
  }

  _setCache(key, value) {
    this._cache.set(key, { value, timestamp: Date.now() });
  }

  _clearCache(key) {
    this._cache.delete(key);
  }

  _removeListener(listener) {
    const idx = this._listeners.indexOf(listener);
    if (idx >= 0) {
      this._listeners.splice(idx, 1);
    }
    try {
      if (listener && typeof listener.remove === 'function') {
        listener.remove();
      }
    } catch (e) {
      // Ignorar
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _log(...args) {
    console.log(this._logPrefix, ...args);
  }

  _warn(...args) {
    console.warn(this._logPrefix, ...args);
  }

  _error(...args) {
    console.error(this._logPrefix, ...args);
  }
}

// Singleton export
export const permissionShim = NexoPermissionShim.getInstance();
export default NexoPermissionShim;
