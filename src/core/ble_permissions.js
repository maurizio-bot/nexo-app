/**
 * BLE Permissions & Communication Manager v6.0-FIX
 * Fixes: Bug1 (aliases juntos), Bug2 (callback ciego), Bug3 (isPermanentlyDenied),
 *        Bug4 (allGranted sin notificaciones), Bug5 (FOREGROUND_SERVICE_CONNECTED_DEVICE),
 *        Bug6 (JS lee resultado de initializeBLE), Bug7 (isPermanentlyDenied del nativo)
 * Ubicación: src/core/ble_permissions.js
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
      await new Promise(r => setTimeout(r, 1000));
      const granted = await this.check();
      if (granted) {
        napLog(NAP_CODES.SETTINGS_RETURN, 'Permisos concedidos tras regreso de Settings');
        window.dispatchEvent(new CustomEvent('blePermissionsGranted', { detail: { source: 'resume_check' } }));
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
        notifications: !!result.notificationsGranted,
        // FIX Bug 5: foregroundConnected viene del nativo
        foregroundConnected: !!result.foregroundConnectedGranted
      };

      // FIX Bug 4: allGranted ya no exige notificaciones (el nativo lo calcula bien)
      this.state.granted = result.allGranted === true;

      // FIX Bug 7: isPermanentlyDenied viene del nativo que ya usa wasEverAsked
      this.state.isPermanentlyDenied = result.isPermanentlyDenied === true;
      this.state.checked = true;

      napLog(NAP_CODES.ANDROID_NATIVE, 'checkBLEStatus', 'DEBUG', this.state.permissions);
      napLog(
        NAP_CODES.ANDROID_NATIVE,
        `allGranted=${this.state.granted}, permanentlyDenied=${this.state.isPermanentlyDenied}, wasAsked=${result.wasEverAsked}`,
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

      // FIX Bug 6: Leer el resultado del callback directamente.
      // El nativo ahora devuelve { dialogResponded, granted, isPermanentlyDenied }
      const result = await NexoBLE.initializeBLE();

      if (result?.granted !== undefined) {
        // El nativo respondió con datos del callback (usuario interactuó con el diálogo)
        this.state.granted = !!result.granted;
        // FIX Bug 7: isPermanentlyDenied viene del nativo (no re-calculado en JS)
        this.state.isPermanentlyDenied = !!result.isPermanentlyDenied;
        this.state.checked = true;
        napLog(NAP_CODES.ANDROID_NATIVE, `initializeBLE callback: granted=${this.state.granted}`, 'DEBUG', result);
      } else {
        // Ya tenía permisos (el nativo resolvió sin mostrar diálogo)
        // Hacer check para confirmar estado
        await this.check();
      }

      if (this.state.granted) {
        napLog(NAP_CODES.PERM_GRANTED, 'Permisos concedidos');
      } else if (this.state.isPermanentlyDenied) {
        napLog(NAP_CODES.PERM_PERMANENT, 'Denegación permanente detectada', 'WARN');
        window.dispatchEvent(new CustomEvent('blePermissionsPermanentlyDenied'));
      } else {
        napLog(NAP_CODES.PERM_DENIED, 'Permisos denegados por el usuario', 'WARN');
      }

      return this.state.granted;
    } catch (e) {
      napLog(NAP_CODES.ERROR_RECOVERY, `request error: ${e.message}`, 'ERROR');
      try { await this.check(); } catch (_) { /* ignore */ }
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

  isReady() { return this.state.granted; },
  getStatus() { return { ...this.state }; },

  setVerboseLogging(enabled) {
    if (enabled) localStorage.setItem('nexo_verbose_logs', 'true');
    else localStorage.removeItem('nexo_verbose_logs');
  }
};

// ==================== SERVER ====================
export async function startBLEAdvertising() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try {
    const result = await NexoBLE.startBLEAdvertising();
    return { success: true, result: result || {} };
  } catch (e) { return { success: false, error: e.message, nap_code: 'ADVERTISE_ERROR' }; }
}

export async function stopBLEAdvertising() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try {
    const result = await NexoBLE.stopBLEAdvertising();
    return { success: true, result: result || {} };
  } catch (e) { return { success: false, error: e.message, nap_code: 'ADVERTISE_STOP_ERROR' }; }
}

// ==================== CLIENT ====================
export async function scanForDevices() {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  try {
    napLog(NAP_CODES.SCAN_START, 'Iniciando escaneo BLE...');
    const result = await NexoBLE.scanForDevices();
    napLog(NAP_CODES.SCAN_RESULT, `Dispositivos encontrados: ${result?.devices?.length || 0}`, 'INFO', result);
    return { success: true, devices: result?.devices || [] };
  } catch (e) { return { success: false, error: e.message, nap_code: 'SCAN_ERROR' }; }
}

export async function stopScan() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try { await NexoBLE.stopScan(); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
}

export async function connectToDevice(address) {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  try {
    napLog(NAP_CODES.CONNECT, `Conectando a ${address}...`);
    const result = await NexoBLE.connectToDevice({ address });
    BLEPermissions.state.connectedDevice = address;
    BLEPermissions.state.isClient = true;
    return { success: true, result };
  } catch (e) { return { success: false, error: e.message, nap_code: 'CONNECT_ERROR' }; }
}

export async function disconnectDevice() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try {
    await NexoBLE.disconnectDevice();
    BLEPermissions.state.connectedDevice = null;
    BLEPermissions.state.isClient = false;
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

// ==================== MESSAGING ====================
export async function sendMessage(message) {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  try {
    napLog(NAP_CODES.MESSAGE, `Enviando mensaje: ${message}`);
    const result = await NexoBLE.sendMessage({ message });
    return { success: true, mode: result?.mode || 'unknown', sent: result?.sent };
  } catch (e) { return { success: false, error: e.message, nap_code: 'SEND_ERROR' }; }
}

export async function startListeningMessages(callback) {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  await NexoBLE.startListeningMessages();
  const handler = (event) => { if (event?.detail) callback(event.detail); };
  window.addEventListener('bleMessageReceived', handler);
  window.addEventListener('bleDeviceConnected', handler);
  window.addEventListener('bleDeviceDisconnected', handler);
  window.addEventListener('bleClientConnected', handler);
  window.addEventListener('bleClientDisconnected', handler);
  window.addEventListener('bleClientReady', handler);
  window.addEventListener('bleDeviceFound', handler);
  return { success: true, listening: true };
}

// ==================== LEGACY ====================
export async function checkBLEStatus() { return BLEPermissions.check(); }
export async function requestBLEPermissions() { return BLEPermissions.request(); }
export function isPermanentlyDenied() { return BLEPermissions.state.isPermanentlyDenied; }
export { BLEPermissions, NAP_CODES, napLog };

if (typeof window !== 'undefined') { window.BLEPermissions = BLEPermissions; }
