/**
 * BLE Permissions & Communication Manager v6.2-FIX
 * Fixes: Plugin name NexoBLE, method names aligned, no auto-start Service,
 * REM logs en pantalla via onRemLog listener
 * FIX v6.2-ARCH: UX permisos - contexto en reintentos, estado visual claro
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
    platform: Capacitor.getPlatform(),
    connectedDevice: null
  },

  async check() {
    if (this.state.platform !== 'android') return { granted: true };
    try {
      const status = await NexoBLE.checkBLEStatus();
      this.state.granted = status.scan === 'granted' && status.connect === 'granted';
      return status;
    } catch (e) {
      napLog(NAP_CODES.PERM_ERROR, `Error check: ${e.message}`, 'ERROR');
      return { bluetoothEnabled: false };
    }
  },

  async request() {
    if (this.state.platform !== 'android') return true;
    try {
      const result = await NexoBLE.requestPermissions();
      this.state.granted = result.scan === 'granted' && result.connect === 'granted';
      return this.state.granted;
    } catch (e) {
      napLog(NAP_CODES.PERM_ERROR, `Error request: ${e.message}`, 'ERROR');
      return false;
    }
  }
};

export async function sendMessage(message) {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  try {
    napLog(NAP_CODES.MESSAGE, `Enviando mensaje: ${message}`);
    const result = await NexoBLE.sendMessage({ deviceId: BLEPermissions.state.connectedDevice || '', message });
    return { success: true, mode: result?.mode || 'unknown', sent: result?.sent };
  } catch (e) { return { success: false, error: e.message, nap_code: 'SEND_ERROR' }; }
}

export async function checkBLEStatus() { return BLEPermissions.check(); }
export async function requestBLEPermissions() { return BLEPermissions.request(); }
export { BLEPermissions, NAP_CODES, napLog };
