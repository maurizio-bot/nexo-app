/**
 * BLE Permissions & Communication Manager v5.2-ARCH
 * Fix: Retry con delay post-diálogo nativo para race condition Android 14+
 * Ubicación: src/core/ble_permissions.js
 * Coordinado con NexoBlePlugin.kt v6.2-ARCH-FIX (Servidor + Cliente)
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

const NexoBLE = registerPlugin('NexoBle');

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
  RESUME_CHECK: '[NAP-BLE-303]',
  SCAN_START: '[NAP-BLE-400]',
  SCAN_RESULT: '[NAP-BLE-401]',
  CONNECT: '[NAP-BLE-500]',
  MESSAGE: '[NAP-BLE-600]'
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
    platform: Capacitor.getPlatform(),
    connectedDevice: null,
    isClient: false,
    resumeListenerAttached: false
  },

  _attachResumeListener() {
    if (this.state.resumeListenerAttached) return;
    this.state.resumeListenerAttached = true;

    document.addEventListener('resume', async () => {
      napLog(NAP_CODES.RESUME_CHECK, 'App resumed — re-verificando permisos...');
      await new Promise(r => setTimeout(r, 800));
      const granted = await this.check();
      if (granted) {
        napLog(NAP_CODES.SETTINGS_RETURN, 'Permisos concedidos tras regreso de Settings');
        window.dispatchEvent(new CustomEvent('blePermissionsGranted', {
          detail: { source: 'resume_check' }
        }));
      } else {
        napLog(NAP_CODES.SETTINGS_RETURN, 'Permisos aún denegados tras regreso de Settings', 'WARN');
      }
    });
  },

  async check() {
    if (this.state.platform !== 'android') {
      this.state.granted = true;
      this.state.checked = true;
      return true;
    }

    this._attachResumeListener();

    try {
      const result = await NexoBLE.checkBLEStatus();
      this.state.permissions = {
        scan: !!result.scanGranted,
        connect: !!result.connectGranted,
        advertise: !!result.advertiseGranted,
        location: !!result.locationGranted,
        notifications: !!result.notificationsGranted
      };
      this.state.granted = result.allGranted === true;
      this.state.isPermanentlyDenied = result.isPermanentlyDenied === true;
      this.state.checked = true;

      napLog(NAP_CODES.ANDROID_NATIVE, 'checkBLEStatus', 'DEBUG', this.state.permissions);
      napLog(
        NAP_CODES.ANDROID_NATIVE,
        `allGranted=${this.state.granted}, permanentlyDenied=${this.state.isPermanentlyDenied}`,
        'DEBUG'
      );
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

      await NexoBLE.initializeBLE();

      // CRITICAL FIX: Android 14+ no actualiza el estado de permisos instantáneamente
      // tras el diálogo nativo. Esperamos 600ms y reintentamos check() hasta 3 veces.
      let granted = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        await new Promise(r => setTimeout(r, 600));
        granted = await this.check();
        napLog(NAP_CODES.PERM_REQUEST, `Post-dialogo check intento ${attempt}: granted=${granted}`, 'DEBUG');
        if (granted) break;
      }

      if (granted) {
        napLog(NAP_CODES.PERM_GRANTED, 'Permisos concedidos');
      } else if (this.state.isPermanentlyDenied) {
        napLog(NAP_CODES.PERM_PERMANENT, 'Denegación permanente detectada', 'WARN');
      } else {
        napLog(NAP_CODES.PERM_DENIED, 'Permisos denegados tras 3 intentos', 'WARN');
      }
      return granted;
    } catch (e) {
      napLog(NAP_CODES.ERROR_RECOVERY, `request error: ${e.message}`, 'ERROR');
      try {
        await this.check();
      } catch (_) { /* ignore */ }
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

  setVerboseLogging(enabled) {
    if (enabled) localStorage.setItem('nexo_verbose_logs', 'true');
    else localStorage.removeItem('nexo_verbose_logs');
  }
};

// ==================== SERVER FUNCTIONS ====================

export async function startBLEAdvertising() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try {
    const result = await NexoBLE.startBLEAdvertising();
    return { success: true, result: result || {} };
  } catch (e) {
    return { success: false, error: e.message, nap_code: 'ADVERTISE_ERROR' };
  }
}

export async function stopBLEAdvertising() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try {
    const result = await NexoBLE.stopBLEAdvertising();
    return { success: true, result: result || {} };
  } catch (e) {
    return { success: false, error: e.message, nap_code: 'ADVERTISE_STOP_ERROR' };
  }
}

// ==================== CLIENT FUNCTIONS ====================

export async function scanForDevices() {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  try {
    napLog(NAP_CODES.SCAN_START, 'Iniciando escaneo BLE...');
    const result = await NexoBLE.scanForDevices();
    napLog(NAP_CODES.SCAN_RESULT, `Dispositivos encontrados: ${result?.devices?.length || 0}`, 'INFO', result);
    return { success: true, devices: result?.devices || [] };
  } catch (e) {
    return { success: false, error: e.message, nap_code: 'SCAN_ERROR' };
  }
}

export async function stopScan() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try {
    await NexoBLE.stopScan();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function connectToDevice(address) {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  try {
    napLog(NAP_CODES.CONNECT, `Conectando a ${address}...`);
    const result = await NexoBLE.connectToDevice({ address });
    BLEPermissions.state.connectedDevice = address;
    BLEPermissions.state.isClient = true;
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message, nap_code: 'CONNECT_ERROR' };
  }
}

export async function disconnectDevice() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try {
    await NexoBLE.disconnectDevice();
    BLEPermissions.state.connectedDevice = null;
    BLEPermissions.state.isClient = false;
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ==================== UNIFIED MESSAGING ====================

export async function sendMessage(message) {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  try {
    napLog(NAP_CODES.MESSAGE, `Enviando mensaje: ${message}`);
    const result = await NexoBLE.sendMessage({ message });
    return { success: true, mode: result?.mode || 'unknown', sent: result?.sent };
  } catch (e) {
    return { success: false, error: e.message, nap_code: 'SEND_ERROR' };
  }
}

export async function startListeningMessages(callback) {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };

  await NexoBLE.startListeningMessages();

  const handler = (event) => {
    if (event?.detail) callback(event.detail);
  };

  window.addEventListener('bleMessageReceived', handler);
  window.addEventListener('bleDeviceConnected', handler);
  window.addEventListener('bleDeviceDisconnected', handler);
  window.addEventListener('bleClientConnected', handler);
  window.addEventListener('bleClientDisconnected', handler);
  window.addEventListener('bleClientReady', handler);
  window.addEventListener('bleDeviceFound', handler);

  return { success: true, listening: true };
}

// ==================== LEGACY COMPATIBILITY ====================

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
