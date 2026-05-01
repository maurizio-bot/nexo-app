/**
 * BLE Permissions Manager v3.1.0-ARCH (Híbrido)
 * Compatible con NexoBlePlugin.kt v2.3.2-ARCH
 * Usa initializeBLE() y checkBLEStatus() nativos
 * Mantiene interfaz pública de v3.0.0 para SetupWizard + ble_interface
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
  ERROR_RECOVERY: '[NAP-BLE-900]'
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
    permissions: {},
    androidVersion: 0,
    isPermanentlyDenied: false
  },

  async checkBLEStatus() {
    if (this.state.checking) {
      while (this.state.checking) await new Promise(r => setTimeout(r, 100));
      return this.state.granted;
    }

    this.state.checking = true;
    try {
      // FIX v3.1: Usar checkBLEStatus() nativo (no isBluetoothEnabled)
      const result = await NexoBLE.checkBLEStatus();

      this.state.permissions = {
        scan: !!result.scanGranted,
        connect: !!result.connectGranted,
        advertise: !!result.advertiseGranted,
        location: !!result.locationGranted
      };
      this.state.granted = result.allGranted === true;
      this.state.isPermanentlyDenied = result.isPermanentlyDenied === true;
      this.state.checked = true;

      if (this.state.granted) {
        console.log('[BLE-PERM] Permisos concedidos/confirmados');
      } else {
        console.warn('[BLE-PERM] Permisos DENEGADOS:', this.state.permissions);
      }

      return this.state.granted;
    } catch (err) {
      console.error('[BLE-PERM] Error checkBLEStatus:', err);
      this.state.granted = false;
      this.state.checked = true;
      return false;
    } finally {
      this.state.checking = false;
    }
  },

  async ensure() {
    if (this.state.granted) return true;
    if (!this.state.checked) return await this.checkBLEStatus();
    return false;
  },

  isReady() { return this.state.granted; },
  getStatus() { return { ...this.state }; }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BLEPermissions;
} else {
  window.BLEPermissions = BLEPermissions;
}

// ==================== PUBLIC API ====================

export async function requestBLEPermissions() {
  const platform = Capacitor.getPlatform();
  napLog(NAP_CODES.INIT, `Platform: ${platform}`, 'DEBUG');

  if (platform === 'web' || platform === 'ios') {
    return requestWebBluetoothPermissions();
  }

  if (platform === 'android') {
    const nativeResult = await requestNativeAndroidPermissionsExplicit();
    if (nativeResult.granted || nativeResult.isPermissionDenied || nativeResult.isPermanentDenial) {
      return nativeResult;
    }
    return requestNativeAndroidPermissions();
  }

  return {
    granted: false,
    error: 'Platform not supported',
    nap_code: 'UNSUPPORTED_PLATFORM',
    canRetry: false
  };
}

async function requestNativeAndroidPermissionsExplicit() {
  napLog(NAP_CODES.PERM_REQUEST, 'Solicitando permisos via initializeBLE...', 'INFO');
  try {
    // FIX v3.1: Usar initializeBLE() nativo (no requestBLEPermissions)
    const result = await NexoBLE.initializeBLE();
    napLog(NAP_CODES.ANDROID_NATIVE, 'Respuesta initializeBLE', 'DEBUG', result);

    if (result.granted === true) {
      // Verificar Bluetooth está encendido
      const btCheck = await NexoBLE.isBluetoothEnabled();
      if (!btCheck.enabled) {
        return {
          granted: true,
          permissionsGranted: true,
          bluetoothEnabled: false,
          needsBluetoothOn: true,
          platform: 'android-native',
          nap_code: 'PERM_OK_BT_OFF'
        };
      }
      return {
        granted: true,
        platform: 'android-native',
        nap_verified: true,
        bluetoothEnabled: true,
        nap_code: 'PERM_GRANTED'
      };
    }

    if (result.isPermanentlyDenied === true) {
      napLog(NAP_CODES.PERM_PERMANENT, 'Denegación permanente detectada', 'WARN');
      return {
        granted: false,
        platform: 'android-native',
        isPermanentDenial: true,
        isPermissionDenied: true,
        canRetry: false,
        nap_code: 'PERM_PERMANENT_DENIED',
        requiresManualSettings: true
      };
    }

    return {
      granted: false,
      platform: 'android-native',
      isPermissionDenied: true,
      canRetry: true,
      nap_code: 'PERM_DENIED'
    };
  } catch (e) {
    napLog(NAP_CODES.ERROR_RECOVERY, `Error: ${e.message}`, 'ERROR', { error: e });
    const isPermanentDenied = e.message?.includes('PERMANENTLY_DENIED');
    if (isPermanentDenied) {
      return {
        granted: false,
        needsManualSettings: true,
        isPermanentDenial: true,
        error: e.message,
        platform: 'android-native',
        canRetry: false,
        nap_code: 'PERM_PERMANENT_DENIED'
      };
    }
    return { granted: false, fallback: true };
  }
}

async function requestNativeAndroidPermissions() {
  napLog(NAP_CODES.PERM_REQUEST, 'Verificando estado...', 'INFO');
  try {
    // FIX v3.1: Usar checkBLEStatus() nativo para verificar
    const result = await NexoBLE.checkBLEStatus();
    const allGranted = result.allGranted === true;

    if (allGranted) {
      const btCheck = await NexoBLE.isBluetoothEnabled();
      return {
        granted: true,
        platform: 'android-native',
        nap_verified: true,
        bluetoothEnabled: btCheck.enabled,
        nap_code: 'PERM_GRANTED'
      };
    }

    return {
      granted: false,
      platform: 'android-native',
      isPermissionDenied: true,
      canRetry: true,
      nap_code: 'PERM_DENIED'
    };
  } catch (e) {
    const errorMsg = e.message || '';
    napLog(NAP_CODES.PERM_ERROR, `Error: ${errorMsg}`, 'ERROR');
    const isUserCancelled = errorMsg.includes('cancelled') || errorMsg.includes('canceled');
    const isPermanentDenied = errorMsg.includes('PERMANENTLY_DENIED');
    if (isPermanentDenied) {
      return {
        granted: false,
        needsManualSettings: true,
        isPermanentDenial: true,
        error: errorMsg,
        platform: 'android-native',
        canRetry: false,
        nap_code: 'PERM_PERMANENT_DENIED'
      };
    }
    if (isUserCancelled) {
      return {
        granted: false,
        isUserCancelled: true,
        error: 'User cancelled',
        platform: 'android-native',
        canRetry: true,
        nap_code: 'USER_CANCELLED'
      };
    }
    return {
      granted: false,
      isTechnicalError: true,
      error: errorMsg,
      platform: 'android-native',
      canRetry: true,
      nap_code: 'TECH_ERROR'
    };
  }
}

async function requestWebBluetoothPermissions() {
  if (!navigator.bluetooth) {
    return {
      granted: false,
      error: 'Web Bluetooth API no soportada',
      platform: 'web',
      canRetry: false
    };
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['battery_service']
    });
    return {
      granted: true,
      platform: 'web-bluetooth',
      deviceName: device.name,
      nap_code: 'WEB_PERM_GRANTED'
    };
  } catch (e) {
    const isCancelled = e.message?.includes('cancelled') || e.name === 'NotFoundError';
    return {
      granted: false,
      isUserCancelled: isCancelled,
      error: e.message,
      platform: 'web-bluetooth',
      canRetry: isCancelled,
      nap_code: isCancelled ? 'WEB_USER_CANCELLED' : 'WEB_PERM_DENIED'
    };
  }
}

export async function checkBLEStatus() {
  const platform = Capacitor.getPlatform();
  if (platform !== 'android') {
    const available = navigator.bluetooth ? await navigator.bluetooth.getAvailability() : false;
    return {
      granted: available,
      available,
      platform: 'web',
      nap_code: available ? 'WEB_AVAILABLE' : 'WEB_UNAVAILABLE'
    };
  }
  try {
    // FIX v3.1: Usar checkBLEStatus() nativo (no isBluetoothEnabled)
    const status = await NexoBLE.checkBLEStatus();
    const isFullyReady = status.allGranted === true;

    return {
      granted: isFullyReady,
      bluetoothEnabled: isFullyReady,
      stateName: isFullyReady ? 'ON' : 'OFF',
      platform: 'android-native',
      nap_code: isFullyReady ? 'NATIVE_READY' : 'NATIVE_NOT_READY'
    };
  } catch (e) {
    return {
      granted: false,
      error: e.message,
      platform: 'android-native',
      nap_code: 'CHECK_ERROR'
    };
  }
}

export function setVerboseLogging(enabled) {
  if (enabled) localStorage.setItem('nexo_verbose_logs', 'true');
  else localStorage.removeItem('nexo_verbose_logs');
}

export async function startBLEAdvertising() {
  const platform = Capacitor.getPlatform();
  if (platform !== 'android') return { success: false, error: 'Solo Android', nap_code: 'NOT_ANDROID' };
  try {
    const result = await NexoBLE.startAdvertising();
    napLog(NAP_CODES.ANDROID_NATIVE, 'Advertising iniciado', 'INFO', result);
    return { success: true, isAdvertising: true, platform: 'android-native', nap_code: 'ADVERTISING_STARTED' };
  } catch (e) {
    napLog(NAP_CODES.ERROR_RECOVERY, `Error iniciando advertising: ${e.message}`, 'ERROR');
    return { success: false, error: e.message, nap_code: 'ADVERTISING_FAILED' };
  }
}

export async function checkAdvertisingStatus() {
  const platform = Capacitor.getPlatform();
  if (platform !== 'android') return { isAdvertising: false, platform: 'web' };
  try {
    const result = await NexoBLE.isAdvertising();
    return {
      isAdvertising: result.isAdvertising === true,
      timestamp: result.timestamp,
      platform: 'android-native',
      nap_code: result.isAdvertising ? 'ADVERTISING_ACTIVE' : 'ADVERTISING_INACTIVE'
    };
  } catch (e) {
    return { isAdvertising: false, error: e.message, nap_code: 'CHECK_FAILED' };
  }
}

window.NEXO_BLE_PERMISSIONS = {
  requestBLEPermissions,
  checkBLEStatus,
  setVerboseLogging,
  NAP_CODES,
  startBLEAdvertising,
  checkAdvertisingStatus
};
