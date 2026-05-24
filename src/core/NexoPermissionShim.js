/**
 * NEXO Permission Shim v2.0-ARCH
 * Traduce API granular de permisos (builds #1057+) a API nativa simple de build #961.
 * NO toca Kotlin. Singleton. Guard guards. Retry backoff 3x500ms. Anti-spam cache.
 * Compatible con: ble_permissions.js v6.2, main.js v9.0, ble_interface.js v3.5
 */

import { Capacitor } from '@capacitor/core';

// ─── Singleton ───
let _instance = null;
let _initLock = false;

// ─── Constants ───
const SHIM_VERSION = '2.0-ARCH';
const RETRY_DELAYS = [500, 500, 500]; // 3 retries, 500ms each
const CACHE_TTL = 2000; // ms
const STORAGE_KEY = 'nexo_shim_v2_state';

const NAP_CODES = {
  SHIM_INIT: '[NAP-SHIM-001]',
  SHIM_CHECK: '[NAP-SHIM-002]',
  SHIM_REQUEST: '[NAP-SHIM-003]',
  SHIM_GRANTED: '[NAP-SHIM-004]',
  SHIM_DENIED: '[NAP-SHIM-005]',
  SHIM_PERMANENT: '[NAP-SHIM-006]',
  SHIM_RETRY: '[NAP-SHIM-007]',
  SHIM_ERROR: '[NAP-SHIM-900]',
  SHIM_NATIVE_MISSING: '[NAP-SHIM-901]',
  SHIM_EVENT: '[NAP-SHIM-302]'
};

function _napLog(code, message, level = 'INFO', data = null) {
  const entry = `[${new Date().toISOString()}] ${code} ${message}`;
  switch (level) {
    case 'DEBUG':
      if (localStorage.getItem('nexo_verbose_logs') === 'true') console.debug(entry, data || '');
      break;
    case 'WARN': console.warn(entry, data || ''); break;
    case 'ERROR': console.error(entry, data || ''); break;
    default: console.log(entry, data || '');
  }
}

// ─── Anti-spam cache ───
class ResultCache {
  constructor() { this._map = new Map(); }
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) {
      this._map.delete(key);
      return null;
    }
    return entry.value;
  }
  set(key, value) { this._map.set(key, { value, ts: Date.now() }); }
  clear() { this._map.clear(); }
}

// ─── Permission Shim Class ───
class NexoPermissionShim {
  constructor() {
    if (_instance) return _instance;

    this.version = SHIM_VERSION;
    this.platform = Capacitor.getPlatform();
    this.nativePlugin = null;
    this._cache = new ResultCache();
    this._listeners = [];
    this._resumeHandler = null;
    this._isDestroyed = false;

    // State: simulamos granularidad sobre base simple
    this.state = {
      granted: false,
      checked: false,
      checking: false,
      isPermanentlyDenied: false,
      permissions: {
        scan: false,
        connect: false,
        advertise: false,
        location: false,
        notifications: false,
        foregroundConnected: false
      },
      nativeResult: null,
      lastCheck: 0
    };

    this._initNativePlugin();
    this._attachResumeListener();
    _instance = this;

    _napLog(NAP_CODES.SHIM_INIT, `NexoPermissionShim v${SHIM_VERSION} initialized`);
  }

  // ─── Native Plugin Resolution ───
  _initNativePlugin() {
    if (this.platform !== 'android') return;
    try {
      this.nativePlugin = window.Capacitor?.Plugins?.NexoBLE || null;
      if (!this.nativePlugin) {
        _napLog(NAP_CODES.SHIM_NATIVE_MISSING, 'NexoBLE plugin no disponible aún', 'WARN');
      }
    } catch (e) {
      _napLog(NAP_CODES.SHIM_NATIVE_MISSING, `Error accediendo plugin: ${e.message}`, 'ERROR');
    }
  }

  _ensureNativePlugin() {
    if (!this.nativePlugin) this._initNativePlugin();
    return !!this.nativePlugin;
  }

  // ─── Resume Listener ───
  _attachResumeListener() {
    if (this._resumeHandler) return;
    this._resumeHandler = async () => {
      _napLog(NAP_CODES.SHIM_EVENT, 'App resumed — re-verificando permisos...');
      await new Promise(r => setTimeout(r, 800));
      const granted = await this.check({ bypassCache: true });
      if (granted) {
        _napLog(NAP_CODES.SHIM_GRANTED, 'Permisos concedidos tras resume');
        this._dispatchGranted('resume');
      }
    };
    document.addEventListener('resume', this._resumeHandler);
    // Fallback visibilitychange para web/PWA
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => this._resumeHandler(), 500);
      }
    });
  }

  // ─── Event Dispatch ───
  _dispatchGranted(source) {
    const detail = { source, timestamp: Date.now(), shimVersion: this.version };
    // Evento moderno (usado por ble_permissions.js v6.2)
    window.dispatchEvent(new CustomEvent('nexo-permissions-granted', { detail }));
    // Evento legacy (usado por main.js v9.0 y SetupManager)
    window.dispatchEvent(new CustomEvent('blePermissionsGranted', { detail: { source } }));
  }

  _dispatchDenied(source, status) {
    window.dispatchEvent(new CustomEvent('nexo-permissions-denied', {
      detail: { source, timestamp: Date.now(), status }
    }));
  }

  _dispatchPermanentDenied() {
    window.dispatchEvent(new CustomEvent('blePermissionsPermanentlyDenied', {
      detail: { timestamp: Date.now() }
    }));
  }

  // ─── Core: check() ───
  async check(options = {}) {
    if (this._isDestroyed) return false;
    if (this.platform !== 'android') {
      this.state.granted = true;
      this.state.checked = true;
      return true;
    }

    // Anti-spam cache
    if (!options.bypassCache) {
      const cached = this._cache.get('check');
      if (cached !== null) return cached;
    }

    if (this.state.checking) {
      while (this.state.checking) await new Promise(r => setTimeout(r, 50));
      return this.state.granted;
    }

    this.state.checking = true;
    let finalResult = false;

    try {
      _napLog(NAP_CODES.SHIM_CHECK, 'Consultando estado BLE nativo...');

      if (!this._ensureNativePlugin()) {
        _napLog(NAP_CODES.SHIM_NATIVE_MISSING, 'Plugin nativo no disponible', 'WARN');
        this.state.granted = false;
        this.state.checked = true;
        return false;
      }

      // Build #961 API: checkBLEStatus() → { allGranted: boolean }
      const nativeResult = await this._callNativeWithRetry('checkBLEStatus', []);
      this.state.nativeResult = nativeResult;

      // Traducción: #961 solo devuelve allGranted. Simulamos granularidad.
      const allGranted = nativeResult?.allGranted === true;

      // Si allGranted=true, todos los permisos granular son true
      // Si allGranted=false, no sabemos cuál falló, marcamos todos false
      this.state.permissions = {
        scan: allGranted,
        connect: allGranted,
        advertise: allGranted,
        location: allGranted,
        notifications: allGranted,
        foregroundConnected: allGranted
      };

      this.state.granted = allGranted;
      this.state.isPermanentlyDenied = nativeResult?.isPermanentlyDenied === true;
      this.state.checked = true;
      this.state.lastCheck = Date.now();

      _napLog(NAP_CODES.SHIM_CHECK, 
        `checkBLEStatus: allGranted=${allGranted}, permanent=${this.state.isPermanentlyDenied}`,
        'DEBUG',
        nativeResult
      );

      finalResult = allGranted;

    } catch (e) {
      _napLog(NAP_CODES.SHIM_ERROR, `check failed: ${e.message}`, 'ERROR', e);
      this.state.granted = false;
      this.state.checked = true;
      finalResult = false;
    } finally {
      this.state.checking = false;
      this._cache.set('check', finalResult);
    }

    return finalResult;
  }

  // ─── Core: request() ───
  async request() {
    if (this._isDestroyed) return false;
    if (this.platform !== 'android') return true;

    if (this.state.checking) {
      while (this.state.checking) await new Promise(r => setTimeout(r, 100));
      if (this.state.granted) return true;
    }

    this.state.checking = true;
    let finalResult = false;

    try {
      _napLog(NAP_CODES.SHIM_REQUEST, 'Solicitando permisos via initializeBLE...');

      if (!this._ensureNativePlugin()) {
        _napLog(NAP_CODES.SHIM_NATIVE_MISSING, 'Plugin nativo no disponible para request', 'ERROR');
        return false;
      }

      // Build #961 API: initializeBLE() → { granted: boolean, isPermanentlyDenied: boolean }
      const nativeResult = await this._callNativeWithRetry('initializeBLE', []);

      const granted = nativeResult?.granted === true;
      const permanent = nativeResult?.isPermanentlyDenied === true;

      this.state.granted = granted;
      this.state.isPermanentlyDenied = permanent;
      this.state.checked = true;
      this.state.permissions = {
        scan: granted,
        connect: granted,
        advertise: granted,
        location: granted,
        notifications: granted,
        foregroundConnected: granted
      };
      this.state.lastCheck = Date.now();

      if (granted) {
        _napLog(NAP_CODES.SHIM_GRANTED, 'Permisos concedidos via initializeBLE');
        this._dispatchGranted('request');
      } else if (permanent) {
        _napLog(NAP_CODES.SHIM_PERMANENT, 'Denegación permanente detectada', 'WARN');
        this._dispatchPermanentDenied();
      } else {
        _napLog(NAP_CODES.SHIM_DENIED, 'Permisos denegados por usuario', 'WARN');
        this._dispatchDenied('request', this.state);
      }

      finalResult = granted;

    } catch (e) {
      _napLog(NAP_CODES.SHIM_ERROR, `request error: ${e.message}`, 'ERROR', e);
      // Fallback a check()
      try { finalResult = await this.check({ bypassCache: true }); } catch (_) { finalResult = false; }
    } finally {
      this.state.checking = false;
      this._cache.set('check', finalResult);
    }

    return finalResult;
  }

  // ─── Core: ensure() ───
  async ensure() {
    if (this.state.granted) return true;
    if (!this.state.checked) {
      const ok = await this.check();
      if (ok) return true;
    }
    if (this.state.isPermanentlyDenied) {
      _napLog(NAP_CODES.SHIM_PERMANENT, 'ensure() abortado: denegación permanente', 'WARN');
      return false;
    }
    return await this.request();
  }

  // ─── Retry Logic ───
  async _callNativeWithRetry(methodName, args) {
    let lastError = null;
    for (let i = 0; i <= RETRY_DELAYS.length; i++) {
      try {
        if (!this.nativePlugin[methodName]) {
          throw new Error(`Método nativo ${methodName} no existe en plugin`);
        }
        const result = await this.nativePlugin[methodName](...args);
        if (i > 0) {
          _napLog(NAP_CODES.SHIM_RETRY, `${methodName} exitoso tras ${i} reintentos`);
        }
        return result;
      } catch (e) {
        lastError = e;
        if (i < RETRY_DELAYS.length) {
          _napLog(NAP_CODES.SHIM_RETRY, 
            `${methodName} falló (intento ${i + 1}/${RETRY_DELAYS.length + 1}): ${e.message}. Reintentando en ${RETRY_DELAYS[i]}ms...`,
            'WARN'
          );
          await new Promise(r => setTimeout(r, RETRY_DELAYS[i]));
        }
      }
    }
    throw lastError || new Error(`${methodName} falló tras todos los reintentos`);
  }

  // ─── Public API ───
  isReady() { return this.state.granted; }

  getStatus() {
    return {
      ...this.state,
      shimVersion: this.version,
      platform: this.platform,
      nativeAvailable: !!this.nativePlugin
    };
  }

  getGranularPermissions() {
    // Devuelve la granularidad simulada para compatibilidad con ble_permissions.js
    return { ...this.state.permissions };
  }

  // ─── Cleanup ───
  destroy() {
    this._isDestroyed = true;
    if (this._resumeHandler) {
      document.removeEventListener('resume', this._resumeHandler);
      this._resumeHandler = null;
    }
    this._listeners.forEach(l => { try { l.remove(); } catch (e) {} });
    this._listeners = [];
    this._cache.clear();
    _instance = null;
    _napLog(NAP_CODES.SHIM_INIT, 'NexoPermissionShim destruido');
  }

  // ─── Persistence helpers ───
  _saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        granted: this.state.granted,
        checked: this.state.checked,
        isPermanentlyDenied: this.state.isPermanentlyDenied,
        lastCheck: this.state.lastCheck
      }));
    } catch (e) {}
  }

  _loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.lastCheck && Date.now() - saved.lastCheck < 300000) { // 5 min TTL
          this.state.granted = saved.granted;
          this.state.checked = saved.checked;
          this.state.isPermanentlyDenied = saved.isPermanentlyDenied;
        }
      }
    } catch (e) {}
  }
}

// ─── Factory / Singleton Export ───
export function getPermissionShim() {
  if (!_instance || _instance._isDestroyed) {
    _instance = new NexoPermissionShim();
  }
  return _instance;
}

// ─── Convenience exports (API compatible con ble_permissions.js) ───
export async function checkBLEStatus() {
  const shim = getPermissionShim();
  const granted = await shim.check();
  return {
    granted,
    allGranted: granted,
    scanGranted: shim.state.permissions.scan,
    connectGranted: shim.state.permissions.connect,
    advertiseGranted: shim.state.permissions.advertise,
    locationGranted: shim.state.permissions.location,
    notificationsGranted: shim.state.permissions.notifications,
    foregroundConnectedGranted: shim.state.permissions.foregroundConnected,
    isPermanentlyDenied: shim.state.isPermanentlyDenied,
    stateName: granted ? 'ALL_GRANTED' : (shim.state.isPermanentlyDenied ? 'PERMANENTLY_DENIED' : 'NO_PERMISSION'),
    shimVersion: shim.version
  };
}

export async function requestBLEPermissions() {
  const shim = getPermissionShim();
  const granted = await shim.request();
  return {
    granted,
    allGranted: granted,
    isPermanentlyDenied: shim.state.isPermanentlyDenied
  };
}

export async function ensureBLEPermissions() {
  const shim = getPermissionShim();
  return await shim.ensure();
}

export function isPermanentlyDenied() {
  return getPermissionShim().state.isPermanentlyDenied;
}

export function getShimStatus() {
  return getPermissionShim().getStatus();
}

// ─── Global registration ───
if (typeof window !== 'undefined') {
  window.NexoPermissionShim = NexoPermissionShim;
  window.getPermissionShim = getPermissionShim;
  window.checkBLEStatus = checkBLEStatus;
  window.requestBLEPermissions = requestBLEPermissions;
  window.ensureBLEPermissions = ensureBLEPermissions;
}

export default NexoPermissionShim;

