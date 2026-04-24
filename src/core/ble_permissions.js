/**
 * BLE Permissions Manager v4.1-ARCH
 * Ubicación: src/core/ble_permissions.js
 * FIX: API unificada + exports compatibles legacy (checkBLEStatus, requestBLEPermissions)
 * Coordinado con NexoBlePlugin.kt v5.0.1-ARCH + ble_interface.js v4.0-ARCH
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

const NexoBLE = registerPlugin('NexoBLE');

const NAP_CODES = {
  INIT: '[NAP-BLE-001]',
  PERM_REQUEST: '[NAP-BLE-002]',
  PERM_GRANTED: '[NAP-BLE-003]',
  PERM_DENIED: '[NAP-BLE-004]',
  PERM_ERROR: '[NAP-BLE-005]',
  PERM_PERMANENT: '[NAP-BLE-006]',
  ANDROID_NATIVE: '[NAP-BLE-200]',
  ERROR_RECOVERY: '[NAP-BLE-900]',
  SETTINGS_RETURN: '[NAP-BLE-302]',
  RESUME_CHECK: '[NAP-BLE-303]'
};

function napLog(code, message, level = 'INFO', data = null) {
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

const BLEPermissions = {
  state: {
    granted: false,
    checked: false,
    checking: false,
    isPermanentlyDenied: false,
    permissions: {},
    platform: Capacitor.getPlatform()
  },

  async check() {
    if (this.state.platform !== 'android') {
      this.state.granted = true;
      this.state.checked = true;
      return true;
    }
    try {
      const result = await NexoBLE.checkBLEStatus();
      this.state.permissions = {
        scan: result.scanGranted,
        connect: result.connectGranted,
        advertise: result.advertiseGranted,
        location: result.locationGranted
      };
      this.state.granted = result.allGranted === true;
      this.state.isPermanentlyDenied = result.isPermanentlyDenied === true;
      this.state.checked = true;
      napLog(NAP_CODES.ANDROID_NATIVE, 'checkBLEStatus', 'DEBUG', this.state.permissions);
      return this.state.granted;
    } catch (e) {
      napLog(NAP_CODES.PERM_ERROR, `check failed: ${e.message}`, 'ERROR');
      this.state.granted = false;
      this.state.checked = true;
      return false;
    }
  },

  async request() {
    if (this.state.platform !== 'android') return true;
    if (this.state.checking) {
      while (this.state.checking) await new Promise(r => setTimeout(r, 100));
      return this.state.granted;
    }
    this.state.checking = true;
    try {
      napLog(NAP_CODES.PERM_REQUEST, 'Solicitando permisos nativos...');
      await NexoBLE.requestPermissions();
      const granted = await this.check();
      if (granted) {
        napLog(NAP_CODES.PERM_GRANTED, 'Permisos concedidos');
      } else if (this.state.isPermanentlyDenied) {
        napLog(NAP_CODES.PERM_PERMANENT, 'Denegación permanente detectada', 'WARN');
      } else {
        napLog(NAP_CODES.PERM_DENIED, 'Permisos denegados', 'WARN');
      }
      return granted;
    } catch (e) {
      napLog(NAP_CODES.ERROR_RECOVERY, `request error: ${e.message}`, 'ERROR');
      this.state.granted = false;
      return false;
    } finally {
      this.state.checking = false;
    }
  },

  async ensure() {
    if (this.state.granted) return true;
    if (!this.state.checked) {
      const ok = await this.check();
      if (ok) return true;
    }
    if (this.state.isPermanentlyDenied) {
      napLog(NAP_CODES.PERM_PERMANENT, 'ensure() abortado: denegación permanente', 'WARN');
      return false;
    }
    return await this.request();
  },

  isReady() {
    return this.state.granted;
  },

  getStatus() {
    return { ...this.state };
  },

  async waitForSettingsReturn(options = {}) {
    const timeoutMs = options.timeoutMs || 30000;
    if (this.state.platform !== 'android') {
      return { success: false, error: 'Solo Android', nap_code: 'NOT_ANDROID' };
    }
    return new Promise((resolve, reject) => {
      let isResolved = false;
      let removeListener = null;
      const cleanup = () => {
        if (removeListener) { removeListener(); removeListener = null; }
      };
      const onResume = async () => {
        if (isResolved) return;
        napLog(NAP_CODES.RESUME_CHECK, 'App resumed, re-checking permissions');
        try {
          const granted = await this.check();
          if (granted) {
            isResolved = true;
            cleanup();
            napLog(NAP_CODES.SETTINGS_RETURN, 'Permisos concedidos tras regreso de ajustes');
            resolve({ success: true, granted: true, nap_code: 'SETTINGS_RETURN_SUCCESS' });
          }
        } catch (e) {
          napLog(NAP_CODES.ERROR_RECOVERY, `Resume check error: ${e.message}`, 'ERROR');
        }
      };
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        const App = window.Capacitor.Plugins.App;
        const handler = () => onResume();
        App.addListener('resume', handler);
        removeListener = () => App.removeListener('resume', handler);
      } else {
        const handler = () => { if (!document.hidden) onResume(); };
        document.addEventListener('visibilitychange', handler);
        removeListener = () => document.removeEventListener('visibilitychange', handler);
      }
      setTimeout(() => {
        if (!isResolved) {
          cleanup();
          napLog(NAP_CODES.PERM_ERROR, `Timeout esperando regreso de ajustes (${timeoutMs}ms)`, 'WARN');
          reject({ success: false, error: 'Timeout', nap_code: 'SETTINGS_TIMEOUT', canRetry: true });
        }
      }, timeoutMs);
      onResume();
    });
  },

  async requestAndWaitForSettings(options = {}) {
    if (this.state.platform !== 'android') {
      return { success: false, error: 'Solo Android', nap_code: 'NOT_ANDROID' };
    }
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        await window.Capacitor.Plugins.App.openUrl({ url: 'app-settings:' });
      }
      return await this.waitForSettingsReturn(options);
    } catch (error) {
      return { success: false, error: error.message || 'Unknown', canRetry: true };
    }
  },

  setVerboseLogging(enabled) {
    if (enabled) localStorage.setItem('nexo_verbose_logs', 'true');
    else localStorage.removeItem('nexo_verbose_logs');
  }
};

// EXPORTS COMPATIBLES LEGACY (SetupManager.js / SetupWizard.js)

export async function checkBLEStatus() {
  return BLEPermissions.check();
}

export async function requestBLEPermissions() {
  return BLEPermissions.request();
}

export function isPermanentlyDenied() {
  return BLEPermissions.state.isPermanentlyDenied;
}

export { BLEPermissions, NAP_CODES, napLog };

if (typeof window !== 'undefined') {
  window.BLEPermissions = BLEPermissions;
}
