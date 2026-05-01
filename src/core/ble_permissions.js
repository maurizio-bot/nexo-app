/**
 * BLE Permissions Manager v3.2.0-ARCH (Híbrido Final)
 * Usa requestBLEPermissions() nativo (existe en plugin v4.0.1)
 * Dispara blePermissionsGranted (esperado por SetupWizard v3.0.6)
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

// ==================== PUBLIC API ====================

export async function requestBLEPermissions() {
  const platform = Capacitor.getPlatform();
  napLog(NAP_CODES.INIT, `Platform: ${platform}`, 'DEBUG');

  if (platform === 'web' || platform === 'ios') {
    return { granted: false, platform, nap_code: 'UNSUPPORTED' };
  }

  if (platform === 'android') {
    return requestNativeAndroidPermissions();
  }

  return { granted: false, error: 'Platform not supported', canRetry: false };
}

async function requestNativeAndroidPermissions() {
  napLog(NAP_CODES.PERM_REQUEST, 'Solicitando permisos via requestBLEPermissions() nativo...', 'INFO');
  
  try {
    // USA el método nativo que SÍ existe en NexoBlePlugin.kt v4.0.1
    const result = await NexoBLE.requestBLEPermissions();
    napLog(NAP_CODES.ANDROID_NATIVE, 'Respuesta nativa', 'DEBUG', result);

    const allGranted = result.allGranted === true;
    const alreadyGranted = result.alreadyGranted === true;

    if (allGranted || alreadyGranted) {
      // DISPARA el evento que SetupWizard v3.0.6 espera
      window.dispatchEvent(new CustomEvent('blePermissionsGranted', { 
        detail: { source: 'request', granted: true } 
      }));
      
      return {
        granted: true,
        platform: 'android-native',
        nap_verified: true,
        nap_code: 'PERM_GRANTED'
      };
    }

    // Si no concedió, verificar si es denegación permanente
    const permissions = result.permissions || {};
    const hasAnyDenied = Object.values(permissions).some(v => v === false);
    
    if (hasAnyDenied) {
      // Verificar si es permanente (no hay forma directa, asumimos que sí si ya se pidió antes)
      window.dispatchEvent(new CustomEvent('blePermissionsPermanentlyDenied', { 
        detail: { source: 'request', permissions } 
      }));
      
      return {
        granted: false,
        isPermanentDenial: true,
        isPermissionDenied: true,
        permissions,
        canRetry: false,
        nap_code: 'PERM_PERMANENT_DENIED',
        requiresManualSettings: true
      };
    }

    return {
      granted: false,
      isPermissionDenied: true,
      permissions,
      canRetry: true,
      nap_code: 'PERM_DENIED'
    };

  } catch (e) {
    napLog(NAP_CODES.ERROR_RECOVERY, `Error: ${e.message}`, 'ERROR', { error: e });
    
    // Fallback: verificar directamente
    try {
      const status = await checkBLEStatus();
      if (status.granted) {
        window.dispatchEvent(new CustomEvent('blePermissionsGranted', { 
          detail: { source: 'fallback', granted: true } 
        }));
        return { granted: true, nap_code: 'PERM_GRANTED_FALLBACK' };
      }
    } catch (_) {}

    return {
      granted: false,
      isPermissionDenied: true,
      error: e.message,
      canRetry: true,
      nap_code: 'PERM_ERROR'
    };
  }
}

export async function checkBLEStatus() {
  const platform = Capacitor.getPlatform();
  if (platform !== 'android') {
    return { granted: false, platform: 'web' };
  }
  
  try {
    // Usar isBluetoothEnabled() nativo que SÍ existe
    const status = await NexoBLE.isBluetoothEnabled();
    const isEnabled = status.enabled === true;
    
    // Verificar permisos también
    let hasPerms = false;
    try {
      const permStatus = await NexoBLE.requestBLEPermissions();
      hasPerms = permStatus.allGranted === true || permStatus.alreadyGranted === true;
    } catch (e) {
      // Si falla, asumimos que no tenemos permisos
      hasPerms = false;
    }

    const fullyReady = isEnabled && hasPerms;

    return {
      granted: fullyReady,
      bluetoothEnabled: isEnabled,
      permissionsGranted: hasPerms,
      stateName: isEnabled ? 'ON' : 'OFF',
      platform: 'android-native',
      nap_code: fullyReady ? 'NATIVE_READY' : 'NATIVE_NOT_READY'
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

export async function startBLEAdvertising() {
  const platform = Capacitor.getPlatform();
  if (platform !== 'android') return { success: false, nap_code: 'NOT_ANDROID' };
  try {
    const result = await NexoBLE.startAdvertising();
    return { success: true, result: result || {}, nap_code: 'ADVERTISING_STARTED' };
  } catch (e) {
    return { success: false, error: e.message, nap_code: 'ADVERTISING_FAILED' };
  }
}

export async function stopBLEAdvertising() {
  const platform = Capacitor.getPlatform();
  if (platform !== 'android') return { success: true };
  try {
    await NexoBLE.stopAdvertising();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function scanForDevices() {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  try {
    const result = await NexoBLE.startScan();
    return { success: true, result };
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
    const result = await NexoBLE.connectToDevice({ deviceId: address });
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message, nap_code: 'CONNECT_ERROR' };
  }
}

export async function disconnectDevice() {
  if (Capacitor.getPlatform() !== 'android') return { success: true };
  try {
    await NexoBLE.disconnectDevice({ deviceId: '' });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function sendMessage(message, deviceId) {
  if (Capacitor.getPlatform() !== 'android') return { success: false, error: 'Solo Android' };
  try {
    const result = await NexoBLE.sendMessage({ deviceId: deviceId || '', message });
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message, nap_code: 'SEND_ERROR' };
  }
}

export function setVerboseLogging(enabled) {
  if (enabled) localStorage.setItem('nexo_verbose_logs', 'true');
  else localStorage.removeItem('nexo_verbose_logs');
}

window.NEXO_BLE_PERMISSIONS = {
  requestBLEPermissions,
  checkBLEStatus,
  startBLEAdvertising,
  stopBLEAdvertising,
  scanForDevices,
  stopScan,
  connectToDevice,
  disconnectDevice,
  sendMessage,
  setVerboseLogging,
  NAP_CODES
};
