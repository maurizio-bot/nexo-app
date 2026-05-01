/**
<<<<<<< HEAD
 * BLE Permissions Manager v3.0.0-ARCH
 * Coordinado con NexoBlePlugin.kt v4.0.0-ARCH
 * Sin alerts bloqueantes - Solo console logging
=======
 * BLE Permissions & Communication Manager v6.6-ARCH
 * FIX v6.6-ARCH:
 *   1) Recheck post-diálogo: 3 intentos con delay creciente (400/800/1200ms)
 *   2) Fallback directo en requestBLEPermissions si BLEPermissions.request() retorna false
 *   3) Evento blePermissionsGranted SIEMPRE disparado si check() confirma permisos
>>>>>>> 779164983726436346bec7d6f4004dc3df682f85
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

const NexoBLE = registerPlugin('NexoBLE');

/**
 * NAP-BLE Permissions Manager v2.0-ARCH
 * Ubicación: src/core/ble_permissions.js
 * 
 * Flujo:
 * 1. checkBLEStatus() → solicita permisos nativos si faltan
 * 2. isReady() → true si todos los permisos concedidos
 * 3. ensure() → promesa que resuelve cuando los permisos están listos
 */

const BLEPermissions = {
  state: {
    granted: false,
    checked: false,
    checking: false,
    permissions: {},
    androidVersion: 0
  },

  /**
   * Verifica y solicita permisos BLE nativos.
   * Llama esto al inicio de la app, antes de cualquier operación BLE.
   */
  async checkBLEStatus() {
    if (this.state.checking) {
      // Esperar si ya hay un check en curso
      while (this.state.checking) {
        await new Promise(r => setTimeout(r, 100));
      }
      return this.state.granted;
    }

    this.state.checking = true;
    try {
      const result = await NexoBLE.requestBLEPermissions();
      
      this.state.permissions = result.permissions || {};
      this.state.androidVersion = result.androidVersion || 0;
      this.state.granted = result.allGranted === true;
      this.state.checked = true;

      if (result.alreadyGranted) {
        console.log('[BLE-PERM] Permisos ya concedidos previamente');
      } else if (this.state.granted) {
        console.log('[BLE-PERM] Permisos concedidos por el usuario');
      } else {
        console.warn('[BLE-PERM] Permisos DENEGADOS:', this.state.permissions);
      }

      return this.state.granted;
    } catch (err) {
      console.error('[BLE-PERM] Error solicitando permisos:', err);
      this.state.granted = false;
      this.state.checked = true;
      return false;
    } finally {
      this.state.checking = false;
    }
  },

  /**
   * Verifica si los permisos están listos. Si no, los solicita.
   */
  async ensure() {
    if (this.state.granted) return true;
    if (!this.state.checked) return await this.checkBLEStatus();
    return false;
  },

  /**
   * Estado actual sin solicitar de nuevo.
   */
  isReady() {
    return this.state.granted;
  },

  /**
   * Estado detallado para debugging.
   */
  getStatus() {
    return { ...this.state };
  }
};

// Exportar para sistemas modulares o asignar global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BLEPermissions;
} else {
  window.BLEPermissions = BLEPermissions;
}


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
<<<<<<< HEAD
  POLLING_CHECK: '[NAP-BLE-303]'
=======
  RESUME_CHECK: '[NAP-BLE-303]',
  SCAN_START: '[NAP-BLE-400]',
  SCAN_RESULT: '[NAP-BLE-401]',
  CONNECT: '[NAP-BLE-500]',
  MESSAGE: '[NAP-BLE-600]'
>>>>>>> 779164983726436346bec7d6f4004dc3df682f85
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

<<<<<<< HEAD
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

export function waitForSettingsReturn(options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  const pollingIntervalMs = options.pollingIntervalMs || 2000;
  
  return new Promise((resolve, reject) => {
    let pollingInterval = null;
    let timeoutId = null;
    let isResolved = false;
    let visibilityHandler = null;
    let focusHandler = null;
    
    const cleanup = () => {
      if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
      if (focusHandler) { window.removeEventListener('focus', focusHandler); focusHandler = null; }
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
    
    visibilityHandler = () => {
      if (!document.hidden) {
        napLog(NAP_CODES.SETTINGS_RETURN, 'App visible nuevamente (visibilitychange)', 'INFO');
        setTimeout(() => checkAndResolve('visibility'), 500);
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    
    focusHandler = () => {
      napLog(NAP_CODES.SETTINGS_RETURN, 'Ventana enfocada (focus)', 'DEBUG');
      checkAndResolve('focus');
    };
    window.addEventListener('focus', focusHandler);
    
    pollingInterval = setInterval(() => {
      checkAndResolve('polling');
    }, pollingIntervalMs);
    
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
    
    checkAndResolve('immediate');
  });
}

export function cancelSettingsWatcher() {
  napLog(NAP_CODES.INIT, 'Settings watcher cancelado (si había uno activo)', 'DEBUG');
}

export async function requestAndWaitForSettings(openSettingsFn, options = {}) {
  const platform = Capacitor.getPlatform();
  
  if (platform !== 'android') {
    return { success: false, error: 'Solo disponible en Android', nap_code: 'NOT_ANDROID' };
  }
  
  try {
    const waitPromise = waitForSettingsReturn(options);
    
    if (typeof openSettingsFn === 'function') {
      await openSettingsFn();
    }
    
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

=======
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
>>>>>>> 779164983726436346bec7d6f4004dc3df682f85
export async function startBLEAdvertising() {
  const platform = Capacitor.getPlatform();
  if (platform !== 'android') {
    return { success: false, error: 'Solo Android', nap_code: 'NOT_ANDROID' };
  }
  
  try {
    const result = await NexoBLE.startAdvertising();
<<<<<<< HEAD
    napLog(NAP_CODES.ANDROID_NATIVE, 'Advertising iniciado', 'INFO', result);
    return { 
      success: true, 
      isAdvertising: true,
      platform: 'android-native',
      nap_code: 'ADVERTISING_STARTED'
    };
  } catch (e) {
    napLog(NAP_CODES.ERROR_RECOVERY, `Error iniciando advertising: ${e.message}`, 'ERROR');
    return { 
      success: false, 
      error: e.message,
      nap_code: 'ADVERTISING_FAILED'
    };
  }
=======
    return { success: true, result: result || {} };
  } catch (e) { return { success: false, error: e.message, nap_code: 'ADVERTISE_ERROR' }; }
>>>>>>> 779164983726436346bec7d6f4004dc3df682f85
}

export async function checkAdvertisingStatus() {
  const platform = Capacitor.getPlatform();
  if (platform !== 'android') {
    return { isAdvertising: false, platform: 'web' };
  }
  
  try {
<<<<<<< HEAD
    const result = await NexoBLE.isAdvertising();
    return {
      isAdvertising: result.isAdvertising === true,
      timestamp: result.timestamp,
      platform: 'android-native',
      nap_code: result.isAdvertising ? 'ADVERTISING_ACTIVE' : 'ADVERTISING_INACTIVE'
    };
  } catch (e) {
    return { 
      isAdvertising: false, 
      error: e.message,
      nap_code: 'CHECK_FAILED'
    };
  }
}

window.NEXO_BLE_PERMISSIONS = {
  requestBLEPermissions,
  checkBLEStatus,
  setVerboseLogging,
  NAP_CODES,
  waitForSettingsReturn,
  cancelSettingsWatcher,
  requestAndWaitForSettings,
  startBLEAdvertising,
  checkAdvertisingStatus
};
=======
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
>>>>>>> 779164983726436346bec7d6f4004dc3df682f85
