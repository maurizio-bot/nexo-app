/**
 * BLE Permissions Manager v2.1-HOTFIX
 * Sin alerts bloqueantes - Solo console logging
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';

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
  ERROR_RECOVERY: '[NAP-BLE-900]',
  SETTINGS_TIMEOUT: '[NAP-BLE-301]',
  SETTINGS_RETURN: '[NAP-BLE-302]',
  POLLING_CHECK: '[NAP-BLE-303]'
};

function napLog(code, message, level = 'INFO', data = null) {
  const logEntry = { code, message, level, timestamp: new Date().toISOString(), platform: Capacitor.getPlatform(), data };
  
  switch (level) {
    case 'DEBUG':
      if (localStorage.getItem('nexo_verbose_logs') === 'true') {
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
}

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
  napLog(NAP_CODES.PERM_REQUEST, 'Solicitando permisos...', 'INFO');
  
  try {
    const result = await NexoBLE.requestBLEPermissions();
    
    napLog(NAP_CODES.ANDROID_NATIVE, 'Respuesta nativa', 'DEBUG', result);
    
    if (result.allGranted) {
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
        permissions: result.permissions,
        bluetoothEnabled: true,
        nap_code: 'PERM_GRANTED'
      };
    }
    
    if (result.isPermanentDenial === true) {
      napLog(NAP_CODES.PERM_PERMANENT, 'Denegación permanente detectada', 'WARN');
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
    napLog(NAP_CODES.ERROR_RECOVERY, `Error: ${e.message}`, 'ERROR', { error: e });
    
    const isPermanentDenied = e.message?.includes('PERMANENTLY_DENIED') || e.data?.isPermanentDenial;
    
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
    const result = await NexoBLE.isBluetoothEnabled();
    
    const hasPermission = result.stateName !== 'NO_PERMISSION';
    const isEnabled = result.enabled === true;
    
    if (hasPermission && isEnabled) {
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
    napLog(NAP_CODES.PERM_ERROR, `Error: ${errorMsg}`, 'ERROR');
    
    const isUserCancelled = errorMsg.includes('cancelled') || errorMsg.includes('canceled');
    const isPermanentDenied = errorMsg.includes('PERMANENTLY_DENIED') || errorMsg.includes('never_ask_again');
    
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

export function setVerboseLogging(enabled) {
  if (enabled) {
    localStorage.setItem('nexo_verbose_logs', 'true');
  } else {
    localStorage.removeItem('nexo_verbose_logs');
  }
}

/**
 * NUEVO: Espera a que el usuario regrese de la configuración del sistema
 * con timeout y verificación periódica del estado BLE
 * @param {Object} options - Configuración del watcher
 * @param {number} options.timeoutMs - Timeout en ms (default: 30000)
 * @param {number} options.pollingIntervalMs - Intervalo de polling en ms (default: 2000)
 * @returns {Promise} - Resuelve con el estado BLE cuando regresa o rechaza si timeout
 */
export function waitForSettingsReturn(options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  const pollingIntervalMs = options.pollingIntervalMs || 2000;
  
  return new Promise((resolve, reject) => {
    let resumeListener = null;
    let pollingInterval = null;
    let timeoutId = null;
    let isResolved = false;
    
    const cleanup = () => {
      if (resumeListener) {
        resumeListener.remove();
        resumeListener = null;
      }
      if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    
    const checkAndResolve = async (source) => {
      if (isResolved) return;
      
      napLog(NAP_CODES.POLLING_CHECK, `Verificando estado post-configuración (source: ${source})`, 'DEBUG');
      
      try {
        const status = await checkBLEStatus();
        
        if (status.granted || status.bluetoothEnabled) {
          isResolved = true;
          cleanup();
          napLog(NAP_CODES.SETTINGS_RETURN, 'Usuario regresó con Bluetooth habilitado', 'INFO', status);
          resolve({
            success: true,
            status: status,
            source: source,
            nap_code: 'SETTINGS_RETURN_SUCCESS'
          });
        }
      } catch (e) {
        napLog(NAP_CODES.ERROR_RECOVERY, `Error en verificación: ${e.message}`, 'ERROR');
      }
    };
    
    // Listener nativo de resume (cuando vuelve de la configuración del sistema)
    resumeListener = App.addListener('resume', () => {
      napLog(NAP_CODES.SETTINGS_RETURN, 'App resumida desde configuración sistema', 'INFO');
      checkAndResolve('resume');
    });
    
    // Polling cada 2 segundos por si el resume no dispara (edge cases)
    pollingInterval = setInterval(() => {
      checkAndResolve('polling');
    }, pollingIntervalMs);
    
    // Timeout de seguridad (30s default)
    timeoutId = setTimeout(() => {
      if (!isResolved) {
        cleanup();
        napLog(NAP_CODES.SETTINGS_TIMEOUT, `Timeout después de ${timeoutMs}ms esperando retorno`, 'WARN');
        reject({
          success: false,
          error: 'Timeout waiting for user to return from settings',
          nap_code: 'SETTINGS_TIMEOUT',
          canRetry: true
        });
      }
    }, timeoutMs);
    
    // Verificación inmediata (por si ya volvió antes de que se registrara el listener)
    checkAndResolve('immediate');
  });
}

/**
 * NUEVO: Cancela un watcher activo de settings return
 * (Útil si el usuario cancela manualmente antes del timeout)
 */
export function cancelSettingsWatcher(watcherPromise) {
  // Nota: Como no retornamos el cleanup directamente, 
  // el usuario debe manejar el reject del promise para limpiar
  napLog(NAP_CODES.INIT, 'Cancelando settings watcher (si implementado)', 'DEBUG');
}

/**
 * NUEVO: Wrapper completo que abre configuración y espera el retorno
 * @param {Function} openSettingsFn - Función que abre la configuración (debe ser llamada externamente)
 * @param {Object} options - Opciones para waitForSettingsReturn
 */
export async function requestAndWaitForSettings(openSettingsFn, options = {}) {
  const platform = Capacitor.getPlatform();
  
  if (platform !== 'android') {
    return { success: false, error: 'Solo disponible en Android', nap_code: 'NOT_ANDROID' };
  }
  
  try {
    // Iniciar el watcher ANTES de abrir configuración (race condition prevention)
    const waitPromise = waitForSettingsReturn(options);
    
    // Abrir configuración (llamada externa)
    if (typeof openSettingsFn === 'function') {
      await openSettingsFn();
    }
    
    // Esperar resultado
    return await waitPromise;
    
  } catch (error) {
    return {
      success: false,
      error: error.error || error.message || 'Unknown error',
      nap_code: error.nap_code || 'SETTINGS_WAIT_FAILED',
      canRetry: true
    };
  }
}

window.NEXO_BLE_PERMISSIONS = {
  requestBLEPermissions,
  checkBLEStatus,
  setVerboseLogging,
  NAP_CODES,
  // NUEVAS FUNCIONES EXPORTADAS:
  waitForSettingsReturn,
  cancelSettingsWatcher,
  requestAndWaitForSettings
};
