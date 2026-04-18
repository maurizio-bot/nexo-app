/**
 * BLE Permissions Manager v2.0-NAP-PROD
 * Android 14+ nativo | Web Bluetooth API fallback
 * NAP 2.0 Certified - Error Granularity & Recovery Flow
 * 
 * PRODUCCIÓN: Sistema de logging silencioso, sin alerts bloqueantes
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
  WEB_FALLBACK: '[NAP-BLE-100]',
  ANDROID_NATIVE: '[NAP-BLE-200]',
  ERROR_RECOVERY: '[NAP-BLE-900]'
};

/**
 * Sistema de logging NAP estructurado - Niveles:
 * DEBUG: Solo consola, verbose
 * INFO: Consola + listeners internos
 * WARN: Consola + notificación UI sutil si es crítico
 * ERROR: Consola + reject de promesa con datos estructurados
 */
function napLog(code, message, level = 'INFO', data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    code,
    message,
    level,
    timestamp,
    platform: Capacitor.getPlatform(),
    data
  };

  switch (level) {
    case 'DEBUG':
      // Solo en desarrollo o si explícitamente se habilita verbose
      if (window.NEXO_DEBUG || localStorage.getItem('nexo_verbose_logs') === 'true') {
        console.debug(`${code} ${message}`, data || '');
      }
      break;
    case 'WARN':
      console.warn(`${code} ${message}`, data || '');
      break;
    case 'ERROR':
      console.error(`${code} ${message}`, data || '');
      break;
    default:
      console.log(`${code} ${message}`, data || '');
  }

  // Emitir evento para diagnostico global si existe
  if (window.NEXO_DIAG && typeof window.NEXO_DIAG.log === 'function') {
    window.NEXO_DIAG.log(logEntry);
  }

  return logEntry;
}

export async function requestBLEPermissions() {
  const platform = Capacitor.getPlatform();
  napLog(NAP_CODES.INIT, `NAP Platform Detection: ${platform}`, 'DEBUG');
  
  if (platform === 'web' || platform === 'ios') {
    return requestWebBluetoothPermissions();
  }
  
  if (platform === 'android') {
    // Primero intentar método explícito nativo v2.5 (con detección de denegación permanente)
    const nativeResult = await requestNativeAndroidPermissionsExplicit();
    if (nativeResult.granted || nativeResult.isPermissionDenied || nativeResult.isPermanentDenial) {
      return nativeResult;
    }
    // Fallback al método implícito
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
  napLog(NAP_CODES.PERM_REQUEST, 'Solicitando permisos explícitos vía NexoBLE.requestBLEPermissions()...', 'INFO');
  
  try {
    const result = await NexoBLE.requestBLEPermissions();
    
    // Logging silencioso de diagnóstico (solo DEBUG level)
    napLog(NAP_CODES.ANDROID_NATIVE, 'Respuesta nativa recibida', 'DEBUG', result);
    
    // Si es modo DEBUG verbose, podemos verlo en consola pero nunca bloquear UI
    if (localStorage.getItem('nexo_verbose_logs') === 'true') {
      console.log('NEXO BLE DEBUG:', JSON.stringify(result, null, 2));
    }
    
    if (result.allGranted) {
      const btCheck = await NexoBLE.isBluetoothEnabled();
      napLog(NAP_CODES.ANDROID_NATIVE, `Post-perm check - BT State: ${btCheck.stateName}`, 'DEBUG');
      
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
        permissions: result.permissions,
        bluetoothEnabled: true,
        nap_code: 'PERM_GRANTED'
      };
    }
    
    // NUEVO v2.0: Detectar denegación permanente desde respuesta nativa
    if (result.isPermanentDenial === true) {
      napLog(NAP_CODES.PERM_PERMANENT, 'Denegación permanente detectada por nativo', 'WARN');
      return { 
        granted: false, 
        platform: 'android-native',
        isPermanentDenial: true,
        isPermissionDenied: true,
        permissions: result.permissions,
        canRetry: false,
        nap_code: 'PERM_PERMANENT_DENIED',
        requiresManualSettings: true
      };
    }
    
    return { 
      granted: false, 
      platform: 'android-native',
      isPermissionDenied: true,
      permissions: result.permissions,
      canRetry: true,
      nap_code: 'PERM_DENIED'
    };
    
  } catch (e) {
    const errorMsg = e.message || '';
    napLog(NAP_CODES.ERROR_RECOVERY, `requestBLEPermissions error: ${errorMsg}`, 'ERROR', { error: e });
    
    // Si el error contiene información de denegación permanente
    const isPermanentDenied = errorMsg.includes('PERMANENTLY_DENIED') ||
                              errorMsg.includes('never_ask_again') ||
                              (e.data && e.data.isPermanentDenial === true);
    
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
    
    // Fallback a método implícito
    return { granted: false, fallback: true };
  }
}

async function requestNativeAndroidPermissions() {
  napLog(NAP_CODES.PERM_REQUEST, 'Verificando estado vía NexoBLE.isBluetoothEnabled()...', 'INFO');
  
  try {
    const result = await NexoBLE.isBluetoothEnabled();
    napLog(NAP_CODES.ANDROID_NATIVE, 'Respuesta nativa (implícita)', 'DEBUG', result);
    
    const hasPermission = result.stateName !== 'NO_PERMISSION';
    const isEnabled = result.enabled === true;
    const isReady = hasPermission && isEnabled;
    
    if (isReady) {
      return { 
        granted: true, 
        platform: 'android-native',
        nap_verified: true,
        bluetoothState: result.stateName,
        nap_code: 'PERM_GRANTED'
      };
    }
    
    if (hasPermission && !isEnabled) {
      return { 
        granted: false, 
        platform: 'android-native',
        bluetoothState: result.stateName,
        isBluetoothOff: true,
        canRetry: true,
        nap_code: 'BT_DISABLED'
      };
    }
    
    return { 
      granted: false, 
      platform: 'android-native',
      bluetoothState: result.stateName,
      hasPermission: false,
      isPermissionDenied: true,
      canRetry: true,
      nap_code: 'PERM_DENIED'
    };
    
  } catch (e) {
    const errorMsg = e.message || '';
    napLog(NAP_CODES.PERM_ERROR, `Error nativo: ${errorMsg}`, 'ERROR', { error: e });
    
    const isUserCancelled = errorMsg.includes('cancelled') || 
                          errorMsg.includes('canceled') ||
                          errorMsg.includes('User rejected');
    
    const isPermanentDenied = errorMsg.includes('PERMANENTLY_DENIED') ||
                              errorMsg.includes('never_ask_again');
    
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
        error: 'User cancelled permission dialog',
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
      canRetry: false,
      nap_code: 'WEB_API_UNAVAILABLE'
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
    const status = await NexoBLE.isBluetoothEnabled();
    const isFullyReady = status.enabled === true && status.stateName === 'ON';
    
    return {
      granted: isFullyReady,
      bluetoothEnabled: status.enabled,
      stateName: status.stateName,
      platform: 'android-native',
      health: status.health || null,
      nap_code: isFullyReady ? 'NATIVE_READY' : `NATIVE_${status.stateName}`
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

/**
 * Activar/desactivar modo DEBUG verbose (solo para desarrollo)
 */
export function setVerboseLogging(enabled) {
  if (enabled) {
    localStorage.setItem('nexo_verbose_logs', 'true');
  } else {
    localStorage.removeItem('nexo_verbose_logs');
  }
}

window.NEXO_BLE_PERMISSIONS = {
  requestBLEPermissions,
  checkBLEStatus,
  setVerboseLogging,
  NAP_CODES
};
