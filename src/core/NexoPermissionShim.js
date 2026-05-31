/**
 * NEXO Permission Shim v2.1.0-HEALTH
 * Traduce API granular de permisos (builds #1057+) a API nativa simple de build #961.
 * NO toca Kotlin. Singleton. Guard guards. Retry backoff 3x500ms. Anti-spam cache.
 * 
 * FIXES v2.1.0-HEALTH:
 * 1) Health check: verifica estado cada 2 minutos
 * 2) Auto-cleanup de cache cada 10 minutos
 * 3) State freshness: invalida estado si >1h sin check
 * 4) Memory leak prevention: limpia listeners y callbacks
 * 5) getHealthStatus() para diagnóstico desde JS
 */

import { Capacitor } from '@capacitor/core';

// ─── Singleton ───
let _instance = null;
let _initLock = false;

// ─── Constants ───
const SHIM_VERSION = '2.1.0-HEALTH';
const RETRY_DELAYS = [500, 500, 500];
const CACHE_TTL = 2000;
const STORAGE_KEY = 'nexo_shim_v2_state';
const STATE_MAX_AGE_MS = 3600000; // 1 hora

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
  SHIM_EVENT: '[NAP-SHIM-302]',
  SHIM_HEALTH: '[NAP-SHIM-100]'
};

function _napLog(code, message, level, data) {
  level = level || 'INFO';
  const entry = '[' + new Date().toISOString() + '] ' + code + ' ' + message;
  if (level === 'DEBUG') {
    if (localStorage.getItem('nexo_verbose_logs') === 'true') console.debug(entry, data || '');
  } else if (level === 'WARN') {
    console.warn(entry, data || '');
  } else if (level === 'ERROR') {
    console.error(entry, data || '');
  } else {
    console.log(entry, data || '');
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
  set(key, value) { this._map.set(key, { value: value, ts: Date.now() }); }
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
    this._lastEventTime = 0;
    this._healthCheckInterval = null;
    this._autoCleanupInterval = null;
    this._totalChecks = 0;
    this._totalRequests = 0;
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
    this._loadState();
    this._startHealthMonitor();
    _instance = this;
    _napLog(NAP_CODES.SHIM_INIT, 'NexoPermissionShim v' + SHIM_VERSION + ' initialized');
  }

  _initNativePlugin() {
    if (this.platform !== 'android') return;
    try {
      this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
      if (!this.nativePlugin) {
        _napLog(NAP_CODES.SHIM_NATIVE_MISSING, 'NexoBLE plugin no disponible aun', 'WARN');
      }
    } catch (e) {
      _napLog(NAP_CODES.SHIM_NATIVE_MISSING, 'Error accediendo plugin: ' + e.message, 'ERROR');
    }
  }

  _ensureNativePlugin() {
    if (!this.nativePlugin) this._initNativePlugin();
    return !!this.nativePlugin;
  }

  _attachResumeListener() {
    if (this._resumeHandler) return;
    var self = this;

    this._resumeHandler = async function() {
      var now = Date.now();
      if (now - self._lastEventTime < 2000) return;
      self._lastEventTime = now;

      _napLog(NAP_CODES.SHIM_EVENT, 'App resumed - re-verificando permisos...');
      await new Promise(function(r) { setTimeout(r, 800); });
      var granted = await self.check({ bypassCache: true });
      if (granted) {
        _napLog(NAP_CODES.SHIM_GRANTED, 'Permisos concedidos tras resume');
        self._dispatchGranted('resume');
      }
    };

    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('appStateChange', function(state) {
        if (state.isActive) {
          self._resumeHandler();
        }
      });
    } else {
      document.addEventListener('resume', this._resumeHandler);
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
          setTimeout(function() { self._resumeHandler(); }, 500);
        }
      });
    }
  }

  // ==================== HEALTH MONITOR ====================

  _startHealthMonitor() {
    var self = this;

    // Health check cada 2 minutos
    this._healthCheckInterval = setInterval(function() {
      self._performHealthCheck();
    }, 120000);

    // Auto-cleanup cada 10 minutos
    this._autoCleanupInterval = setInterval(function() {
      self._performAutoCleanup();
    }, 600000);
  }

  _stopHealthMonitor() {
    if (this._healthCheckInterval) clearInterval(this._healthCheckInterval);
    if (this._autoCleanupInterval) clearInterval(this._autoCleanupInterval);
    this._healthCheckInterval = null;
    this._autoCleanupInterval = null;
  }

  _performHealthCheck() {
    try {
      // Verificar si el estado es "stale" (>1h sin check)
      if (this.state.lastCheck > 0 && (Date.now() - this.state.lastCheck) > STATE_MAX_AGE_MS) {
        _napLog(NAP_CODES.SHIM_HEALTH, 'State stale detected (>1h), invalidating cache');
        this.state.checked = false;
        this.state.granted = false;
        this._cache.clear();
      }

      _napLog(NAP_CODES.SHIM_HEALTH, 'Health OK. Checks: ' + this._totalChecks + ', Requests: ' + this._totalRequests + ', LastCheck: ' + (this.state.lastCheck > 0 ? Math.round((Date.now() - this.state.lastCheck)/1000) + 's ago' : 'never'));

    } catch (e) {
      console.error('[SHIM HEALTH] Error:', e);
    }
  }

  _performAutoCleanup() {
    try {
      this._cache.clear();
      _napLog(NAP_CODES.SHIM_HEALTH, 'Cache auto-cleared');
    } catch (e) {
      console.error('[SHIM HEALTH] Cleanup error:', e);
    }
  }

  _dispatchGranted(source) {
    var detail = { source: source, timestamp: Date.now(), shimVersion: this.version };
    window.dispatchEvent(new CustomEvent('nexo-permissions-granted', { detail: detail }));
    window.dispatchEvent(new CustomEvent('blePermissionsGranted', { detail: { source: source } }));
  }

  _dispatchDenied(source, status) {
    window.dispatchEvent(new CustomEvent('nexo-permissions-denied', {
      detail: { source: source, timestamp: Date.now(), status: status }
    }));
  }

  _dispatchPermanentDenied() {
    window.dispatchEvent(new CustomEvent('blePermissionsPermanentlyDenied', {
      detail: { timestamp: Date.now() }
    }));
  }

  async check(options) {
    options = options || {};
    if (this._isDestroyed) return false;
    if (this.platform !== 'android') {
      this.state.granted = true;
      this.state.checked = true;
      return true;
    }
    if (!options.bypassCache) {
      var cached = this._cache.get('check');
      if (cached !== null) return cached;
    }
    if (this.state.checking) {
      while (this.state.checking) await new Promise(function(r) { setTimeout(r, 50); });
      return this.state.granted;
    }
    this.state.checking = true;
    this._totalChecks++;
    var finalResult = false;
    try {
      _napLog(NAP_CODES.SHIM_CHECK, 'Consultando estado BLE nativo...');
      if (!this._ensureNativePlugin()) {
        _napLog(NAP_CODES.SHIM_NATIVE_MISSING, 'Plugin nativo no disponible', 'WARN');
        this.state.granted = false;
        this.state.checked = true;
        return false;
      }

      var nativeResult = await this._callNativeWithRetry('checkBLEStatus', [], 10000);
      this.state.nativeResult = nativeResult;
      var allGranted = nativeResult && nativeResult.allGranted === true;
      this.state.permissions = {
        scan: allGranted,
        connect: allGranted,
        advertise: allGranted,
        location: allGranted,
        notifications: allGranted,
        foregroundConnected: allGranted
      };
      this.state.granted = allGranted;
      this.state.isPermanentlyDenied = nativeResult && nativeResult.isPermanentlyDenied === true;
      this.state.checked = true;
      this.state.lastCheck = Date.now();
      _napLog(NAP_CODES.SHIM_CHECK, 'checkBLEStatus: allGranted=' + allGranted + ', permanent=' + this.state.isPermanentlyDenied, 'DEBUG', nativeResult);
      finalResult = allGranted;
      this._saveState();
    } catch (e) {
      _napLog(NAP_CODES.SHIM_ERROR, 'check failed: ' + e.message, 'ERROR', e);
      this.state.granted = false;
      this.state.checked = true;
      finalResult = false;
    } finally {
      this.state.checking = false;
      this._cache.set('check', finalResult);
    }
    return finalResult;
  }

  async request() {
    if (this._isDestroyed) return false;
    if (this.platform !== 'android') return true;
    if (this.state.checking) {
      while (this.state.checking) await new Promise(function(r) { setTimeout(r, 100); });
      if (this.state.granted) return true;
    }
    this.state.checking = true;
    this._totalRequests++;
    var finalResult = false;
    try {
      _napLog(NAP_CODES.SHIM_REQUEST, 'Solicitando permisos via initializeBLE...');
      if (!this._ensureNativePlugin()) {
        _napLog(NAP_CODES.SHIM_NATIVE_MISSING, 'Plugin nativo no disponible para request', 'ERROR');
        return false;
      }

      var nativeResult = await this._callNativeWithRetry('initializeBLE', [], 15000);
      var granted = nativeResult && nativeResult.granted === true;
      var permanent = nativeResult && nativeResult.isPermanentlyDenied === true;
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
        _napLog(NAP_CODES.SHIM_PERMANENT, 'Denegacion permanente detectada', 'WARN');
        this._dispatchPermanentDenied();
      } else {
        _napLog(NAP_CODES.SHIM_DENIED, 'Permisos denegados por usuario', 'WARN');
        this._dispatchDenied('request', this.state);
      }
      finalResult = granted;
      this._saveState();
    } catch (e) {
      _napLog(NAP_CODES.SHIM_ERROR, 'request error: ' + e.message, 'ERROR', e);
      try { finalResult = await this.check({ bypassCache: true }); } catch (_) { finalResult = false; }
    } finally {
      this.state.checking = false;
      this._cache.set('check', finalResult);
    }
    return finalResult;
  }

  async ensure() {
    if (this.state.granted) return true;
    if (!this.state.checked) {
      var ok = await this.check();
      if (ok) return true;
    }
    if (this.state.isPermanentlyDenied) {
      _napLog(NAP_CODES.SHIM_PERMANENT, 'ensure() abortado: denegacion permanente', 'WARN');
      return false;
    }
    return await this.request();
  }

  async _callNativeWithRetry(methodName, args, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    var lastError = null;
    for (var i = 0; i <= RETRY_DELAYS.length; i++) {
      try {
        if (!this.nativePlugin[methodName]) {
          throw new Error('Metodo nativo ' + methodName + ' no existe en plugin');
        }

        var result = await Promise.race([
          this.nativePlugin[methodName].apply(this.nativePlugin, args),
          new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error('TIMEOUT: ' + methodName)); }, timeoutMs);
          })
        ]);

        if (i > 0) {
          _napLog(NAP_CODES.SHIM_RETRY, methodName + ' exitoso tras ' + i + ' reintentos');
        }
        return result;
      } catch (e) {
        lastError = e;
        if (i < RETRY_DELAYS.length) {
          _napLog(NAP_CODES.SHIM_RETRY, methodName + ' fallo (intento ' + (i + 1) + '/' + (RETRY_DELAYS.length + 1) + '): ' + e.message + '. Reintentando en ' + RETRY_DELAYS[i] + 'ms...', 'WARN');
          await new Promise(function(r) { setTimeout(r, RETRY_DELAYS[i]); });
        }
      }
    }
    throw lastError || new Error(methodName + ' fallo tras todos los reintentos');
  }

  isReady() { return this.state.granted; }

  getStatus() {
    return {
      granted: this.state.granted,
      checked: this.state.checked,
      checking: this.state.checking,
      isPermanentlyDenied: this.state.isPermanentlyDenied,
      permissions: this.state.permissions,
      nativeResult: this.state.nativeResult,
      lastCheck: this.state.lastCheck,
      shimVersion: this.version,
      platform: this.platform,
      nativeAvailable: !!this.nativePlugin
    };
  }

  getHealthStatus() {
    return {
      totalChecks: this._totalChecks,
      totalRequests: this._totalRequests,
      stateAge: this.state.lastCheck > 0 ? Date.now() - this.state.lastCheck : null,
      isStale: this.state.lastCheck > 0 && (Date.now() - this.state.lastCheck) > STATE_MAX_AGE_MS,
      cacheSize: this._cache._map ? this._cache._map.size : 0,
      isDestroyed: this._isDestroyed
    };
  }

  getGranularPermissions() {
    return {
      scan: this.state.permissions.scan,
      connect: this.state.permissions.connect,
      advertise: this.state.permissions.advertise,
      location: this.state.permissions.location,
      notifications: this.state.permissions.notifications,
      foregroundConnected: this.state.permissions.foregroundConnected
    };
  }

  destroy() {
    this._isDestroyed = true;
    this._stopHealthMonitor();
    if (this._resumeHandler) {
      document.removeEventListener('resume', this._resumeHandler);
      this._resumeHandler = null;
    }
    this._listeners.forEach(function(l) { try { l.remove(); } catch (e) {} });
    this._listeners = [];
    this._cache.clear();
    _instance = null;
    _napLog(NAP_CODES.SHIM_INIT, 'NexoPermissionShim destruido');
  }

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
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved.lastCheck && Date.now() - saved.lastCheck < 300000) {
          this.state.granted = saved.granted;
          this.state.checked = saved.checked;
          this.state.isPermanentlyDenied = saved.isPermanentlyDenied;
          _napLog(NAP_CODES.SHIM_INIT, 'Estado cargado desde localStorage: granted=' + saved.granted);
        }
      }
    } catch (e) {}
  }
}

// ─── Factory ───
function getPermissionShim() {
  if (!_instance || _instance._isDestroyed) {
    _instance = new NexoPermissionShim();
  }
  return _instance;
}

// ─── Convenience functions ───
async function checkBLEStatus() {
  var shim = getPermissionShim();
  var granted = await shim.check();
  return {
    granted: granted,
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

async function requestBLEPermissions() {
  var shim = getPermissionShim();
  var granted = await shim.request();
  return {
    granted: granted,
    allGranted: granted,
    isPermanentlyDenied: shim.state.isPermanentlyDenied
  };
}

async function ensureBLEPermissions() {
  var shim = getPermissionShim();
  return await shim.ensure();
}

function isPermanentlyDenied() {
  return getPermissionShim().state.isPermanentlyDenied;
}

function getShimStatus() {
  return getPermissionShim().getStatus();
}

function getShimHealth() {
  return getPermissionShim().getHealthStatus();
}

// ─── Object export for compatibility ───
var permissionShim = {
  getPermissionShim: getPermissionShim,
  checkBLEStatus: checkBLEStatus,
  requestBLEPermissions: requestBLEPermissions,
  ensureBLEPermissions: ensureBLEPermissions,
  isPermanentlyDenied: isPermanentlyDenied,
  getShimStatus: getShimStatus,
  getShimHealth: getShimHealth,
  NexoPermissionShim: NexoPermissionShim
};

// ─── Named exports (webpack 5 compatible) ───
export { NexoPermissionShim, getPermissionShim, checkBLEStatus, requestBLEPermissions, ensureBLEPermissions, isPermanentlyDenied, getShimStatus, getShimHealth, permissionShim };
export default NexoPermissionShim;

// ─── Global registration ───
if (typeof window !== 'undefined') {
  window.NexoPermissionShim = NexoPermissionShim;
  window.getPermissionShim = getPermissionShim;
  window.checkBLEStatus = checkBLEStatus;
  window.requestBLEPermissions = requestBLEPermissions;
  window.ensureBLEPermissions = ensureBLEPermissions;
  window.getShimHealth = getShimHealth;
  window.permissionShim = permissionShim;
}
