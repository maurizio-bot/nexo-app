/**
 * BLE Permissions & Communication Manager v6.6-ARCH
 * FIX v6.6-ARCH:
 *   1) Recheck post-diálogo: 3 intentos con delay creciente (400/800/1200ms)
 *   2) Fallback directo en requestBLEPermissions si BLEPermissions.request() retorna false
 *   3) Evento blePermissionsGranted SIEMPRE disparado si check() confirma permisos
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
      window.dispatchEvent(new CustomEvent('blePermissionsStatusChanged', {
        detail: { granted, source: 'resume_check', state: { ...this.state } }
      }));
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
        foregroundConnected: !!result.foregroundConnectedGranted
      };

      this.state.granted = result.allGranted === true;
      this.state.isPermanentlyDenied = result.isPermanentlyDenied === true;
      this.state.checked = true;

      napLog(NAP_CODES.ANDROID_NATIVE,
        `checkBLEStatus: allGranted=${this.state.granted}, ` +
        `scan=${this.state.permissions.scan}, connect=${this.state.permissions.connect}, ` +
        `advertise=${this.state.permissions.advertise}, location=${this.state.permissions.location}`,
        'DEBUG', this.state.permissions);
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
    let eventAlreadyFired = false;

    try {
      napLog(NAP_CODES.PERM_REQUEST, 'Solicitando permisos nativos...');

      const result = await NexoBLE.initializeBLE();

      if (result?.granted !== undefined) {
        this.state.granted = !!result.granted;
        this.state.isPermanentlyDenied = !!result.isPermanentlyDenied;
        this.state.checked = true;
        napLog(NAP_CODES.ANDROID_NATIVE, `initializeBLE callback: granted=${this.state.granted}`, 'DEBUG', result);
      } else {
        await this.check();
      }

      // FIX v6.6: Recheck robusto con 3 intentos y delay creciente
      if (!this.state.granted && !this.state.isPermanentlyDenied) {
        napLog(NAP_CODES.PERM_REQUEST, 'Granted=false tras diálogo. Iniciando recheck robusto...', 'WARN');
        for (let attempt = 1; attempt <= 3; attempt++) {
          const delayMs = 400 * attempt;
          napLog(NAP_CODES.PERM_REQUEST, `Recheck #${attempt}/3 en ${delayMs}ms...`, 'DEBUG');
          await new Promise(r => setTimeout(r, delayMs));
          const recheck = await this.check();
          if (recheck) {
            napLog(NAP_CODES.PERM_GRANTED, `Permisos confirmados en re-verificación #${attempt}`, 'DEBUG');
            this.state.granted = true;
            window.dispatchEvent(new CustomEvent('blePermissionsStatusChanged', {
              detail: { granted: true, source: 'request_recheck', state: { ...this.state } }
            }));
            window.dispatchEvent(new CustomEvent('blePermissionsGranted', { detail: { source: 'request_recheck' } }));
            eventAlreadyFired = true;
            break;
          }
        }
        if (!this.state.granted) {
          napLog(NAP_CODES.PERM_DENIED, 'Recheck robusto falló — permisos realmente denegados', 'WARN');
        }
      }

      window.dispatchEvent(new CustomEvent('blePermissionsStatusChanged', {
        detail: { granted: this.state.granted, source: 'request', state: { ...this.state } }
      }));

      if (this.state.granted && !eventAlreadyFired) {
        napLog(NAP_CODES.PERM_GRANTED, 'Permisos concedidos');
        window.dispatchEvent(new CustomEvent('blePermissionsGranted', { detail: { source: 'request' } }));
      } else if (this.state.isPermanentlyDenied) {
        napLog(NAP_CODES.PERM_PERMANENT, 'Denegación permanente detectada', 'WARN');
        window.dispatchEvent(new CustomEvent('blePermissionsPermanentlyDenied'));
      } else if (!eventAlreadyFired) {
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

    let ok = await this.request();
    if (ok) return true;

    for (let i = 1; i <= 2; i++) {
      if (this.state.isPermanentlyDenied) break;
      napLog(NAP_CODES.PERM_REQUEST, `Reintento ${i}/2 en ensure()...`, 'WARN');
      await new Promise(r => setTimeout(r, 500 * i));
      ok = await this.check();
      if (ok) {
        this.state.granted = true;
        window.dispatchEvent(new CustomEvent('blePermissionsGranted', { detail: { source: 'ensure_retry' } }));
        window.dispatchEvent(new CustomEvent('blePermissionsStatusChanged', {
          detail: { granted: true, source: 'ensure_retry', state: { ...this.state } }
        }));
        return true;
      }
    }

    return false;
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
    const result = await NexoBLE.startAdvertising();
    return { success: true, result: result || {} };
  } catch (e) { return { success: false, error: e.message, nap_code: 'ADVERTISE_ERROR' }; }
}

export async function stopBLEAdvertising() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try {
    const result = await NexoBLE.stopAdvertising();
    return { success: true, result: result || {} };
  } catch (e) { return { success: false, error: e.message, nap_code: 'ADVERTISE_STOP_ERROR' }; }
}

// ==================== CLIENT ====================
export async function scanForDevices() {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  try {
    napLog(NAP_CODES.SCAN_START, 'Iniciando escaneo BLE...');
    const result = await NexoBLE.startScan();
    napLog(NAP_CODES.SCAN_RESULT, 'Scan iniciado', 'INFO', result);
    return { success: true, result };
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
    const result = await NexoBLE.connectToDevice({ deviceId: address });
    BLEPermissions.state.connectedDevice = address;
    BLEPermissions.state.isClient = true;
    return { success: true, result };
  } catch (e) { return { success: false, error: e.message, nap_code: 'CONNECT_ERROR' }; }
}

export async function disconnectDevice() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try {
    await NexoBLE.disconnectDevice({ deviceId: BLEPermissions.state.connectedDevice || '' });
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
    const result = await NexoBLE.sendMessage({ deviceId: BLEPermissions.state.connectedDevice || '', message });
    return { success: true, mode: result?.mode || 'unknown', sent: result?.sent };
  } catch (e) { return { success: false, error: e.message, nap_code: 'SEND_ERROR' }; }
}

export async function startListeningMessages(callback) {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  napLog(NAP_CODES.INIT, 'Listeners nativos se registran automáticamente via addListener');
  return { success: true, listening: true };
}

// ==================== LEGACY / PUBLIC API ====================
export async function requestBLEPermissions() {
  const granted = await BLEPermissions.request();
  
  // FIX v6.6: Fallback directo si el callback nativo tuvo race condition
  if (!granted && !BLEPermissions.state.isPermanentlyDenied) {
    napLog(NAP_CODES.PERM_REQUEST, 'Fallback: recheck directo post-request...', 'WARN');
    await new Promise(r => setTimeout(r, 600));
    const fallback = await BLEPermissions.check();
    if (fallback) {
      napLog(NAP_CODES.PERM_GRANTED, 'Fallback recheck exitoso', 'DEBUG');
      return {
        granted: true,
        isPermanentDenial: false,
        isUserCancelled: false
      };
    }
  }
  
  return {
    granted: granted,
    isPermanentDenial: BLEPermissions.state.isPermanentlyDenied,
    isUserCancelled: false
  };
}

export async function requestBLEPermissionsLegacy() {
  return BLEPermissions.request();
}

export async function checkBLEStatus() { return BLEPermissions.check(); }
export function isPermanentlyDenied() { return BLEPermissions.state.isPermanentlyDenied; }
export { BLEPermissions, NAP_CODES, napLog };

if (typeof window !== 'undefined') { window.BLEPermissions = BLEPermissions; }
