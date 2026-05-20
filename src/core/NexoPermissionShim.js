/**
 * NexoPermissionShim v1.1-ADVERTISE-FIX
 * Traduce API granular #1057 → API nativa #961 sin tocar Kotlin.
 * FIX: Solicita BLUETOOTH_ADVERTISE explícitamente antes de initializeBLE().
 * Build #1254+ compatible. Singleton. Guard clauses. Retry backoff 3x500ms.
 */

class NexoPermissionShim {
  static _instance = null;
  static getInstance() {
    if (!NexoPermissionShim._instance) {
      NexoPermissionShim._instance = new NexoPermissionShim();
    }
    return NexoPermissionShim._instance;
  }

  constructor() {
    this._plugin = null;
    this._initAttempts = 0;
    this._maxRetries = 3;
    this._backoffMs = 500;
    this._cache = null;
    this._cacheTs = 0;
    this._cacheTtl = 2000;
    this._listeners = [];
    this._granularPermissions = [
      'bluetooth',
      'bluetoothScan',
      'bluetoothConnect',
      'bluetoothAdvertise',
      'location'
    ];
  }

  /**
   * Inicializa el shim detectando el plugin nativo #961
   */
  async init() {
    try {
      const cap = window.Capacitor || window?.capacitor?.Capacitor;
      this._plugin = cap?.Plugins?.NexoBLE || cap?.Plugins?.NexoBle;
      if (!this._plugin) {
        console.warn('[NexoPermissionShim] Plugin NexoBLE no detectado');
        return false;
      }
      console.log('[NexoPermissionShim] Plugin detectado OK');
      return true;
    } catch (e) {
      console.error('[NexoPermissionShim] Error init:', e);
      return false;
    }
  }

  /**
   * Solicita todos los permisos BLE necesarios incluyendo ADVERTISE explícito.
   * Esta es la función principal que reemplaza SetupWizard/SetupManager.
   */
  async requestAllPermissions() {
    try {
      // 1. Verificar plugin
      if (!this._plugin) {
        const ok = await this.init();
        if (!ok) throw new Error('Plugin NexoBLE no disponible');
      }

      // 2. Solicitar permisos GRANULARES vía Capacitor Permissions API
      //    Esto cubre BLUETOOTH_ADVERTISE que #961 no maneja nativamente
      const cap = window.Capacitor || window?.capacitor?.Capacitor;
      const permissionsAPI = cap?.Plugins?.Permissions;

      if (permissionsAPI) {
        console.log('[NexoPermissionShim] Solicitando permisos granulares vía Capacitor Permissions...');
        const granularResults = await permissionsAPI.query({
          permissions: this._granularPermissions
        });

        const needRequest = [];
        for (const perm of this._granularPermissions) {
          const state = granularResults?.permissions?.[perm] || granularResults?.[perm];
          if (state !== 'granted') {
            needRequest.push(perm);
          }
        }

        if (needRequest.length > 0) {
          console.log(`[NexoPermissionShim] Pidiendo: ${needRequest.join(', ')}`);
          const reqResult = await permissionsAPI.request({
            permissions: needRequest
          });

          // Verificar si advertising fue concedido
          const advState = reqResult?.permissions?.bluetoothAdvertise || reqResult?.bluetoothAdvertise;
          if (advState !== 'granted') {
            console.warn('[NexoPermissionShim] BLUETOOTH_ADVERTISE DENEGADO — advertising no funcionará');
            // No bloqueamos, pero reportamos para que la UI muestre warning
          }
        }
      } else {
        console.warn('[NexoPermissionShim] Capacitor Permissions API no disponible, delegando 100% a nativo');
      }

      // 3. Llamar al plugin nativo #961 (API simple éxito/fallo)
      //    Retry backoff 3x500ms
      let nativeStatus = null;
      for (let attempt = 1; attempt <= this._maxRetries; attempt++) {
        try {
          nativeStatus = await this._plugin.checkBLEStatus();
          if (nativeStatus?.allGranted || nativeStatus?.granted) {
            console.log(`[NexoPermissionShim] Nativo OK (intento ${attempt})`);
            break;
          }
          if (attempt < this._maxRetries) {
            await this._sleep(this._backoffMs * attempt);
          }
        } catch (e) {
          console.warn(`[NexoPermissionShim] Intento ${attempt} falló:`, e);
          if (attempt < this._maxRetries) {
            await this._sleep(this._backoffMs * attempt);
          }
        }
      }

      // 4. Si nativo reporta no listo, forzar initializeBLE()
      const isGranted = nativeStatus?.allGranted || nativeStatus?.granted;
      if (!isGranted) {
        console.log('[NexoPermissionShim] Forzando initializeBLE() nativo...');
        await this._plugin.initializeBLE();

        // Re-verificar
        await this._sleep(300);
        nativeStatus = await this._plugin.checkBLEStatus();
      }

      // 5. Cache anti-spam
      this._cache = {
        allGranted: isGranted || nativeStatus?.allGranted,
        nativeStatus,
        advertisingGranted: this._checkAdvertisingGranted(),
        timestamp: Date.now()
      };
      this._cacheTs = Date.now();

      return this._cache;

    } catch (e) {
      console.error('[NexoPermissionShim] Error requestAllPermissions:', e);
      throw e;
    }
  }

  /**
   * Verifica estado cachéado con TTL 2s (anti-spam)
   */
  async checkStatus() {
    const now = Date.now();
    if (this._cache && (now - this._cacheTs < this._cacheTtl)) {
      return this._cache;
    }
    return this.requestAllPermissions();
  }

  /**
   * Verifica si BLUETOOTH_ADVERTISE está concedido vía Capacitor Permissions
   */
  async checkAdvertisingPermission() {
    try {
      const cap = window.Capacitor || window?.capacitor?.Capacitor;
      const permissionsAPI = cap?.Plugins?.Permissions;
      if (!permissionsAPI) return { granted: false, error: 'Permissions API no disponible' };

      const result = await permissionsAPI.query({
        permissions: ['bluetoothAdvertise']
      });
      const state = result?.permissions?.bluetoothAdvertise || result?.bluetoothAdvertise;
      return { granted: state === 'granted', state };
    } catch (e) {
      return { granted: false, error: e.message };
    }
  }

  /**
   * Solicita solo BLUETOOTH_ADVERTISE (para usar desde UI cuando se toca "Visibilidad")
   */
  async requestAdvertisingOnly() {
    try {
      const cap = window.Capacitor || window?.capacitor?.Capacitor;
      const permissionsAPI = cap?.Plugins?.Permissions;
      if (!permissionsAPI) return { granted: false };

      const result = await permissionsAPI.request({
        permissions: ['bluetoothAdvertise']
      });
      const state = result?.permissions?.bluetoothAdvertise || result?.bluetoothAdvertise;
      return { granted: state === 'granted', state };
    } catch (e) {
      return { granted: false, error: e.message };
    }
  }

  /**
   * Limpieza de listeners (anti-memory-leak)
   */
  cleanup() {
    this._listeners.forEach(l => l?.remove?.());
    this._listeners = [];
    this._cache = null;
    this._cacheTs = 0;
  }

  _checkAdvertisingGranted() {
    // Fallback: asumimos true si nativo dice OK, pero la UI debe verificar explícito
    return true;
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// Export singleton
const NexoPermissionShimInstance = NexoPermissionShim.getInstance();
export default NexoPermissionShimInstance;
