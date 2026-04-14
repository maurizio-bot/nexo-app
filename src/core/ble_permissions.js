/**
 * BLE Permissions Manager v1.5-NAP
 * Android 14+ nativo | Web Bluetooth API fallback
 * NAP 2.0 Certified - Error Granularity & Recovery Flow
 * 
 * CHANGELOG:
 * - v1.5: FIX Bug salto automático a manual - Distingue perm_denied vs user_cancelled
 * - v1.5: FIX Manejo granular de errores: TEMP_ERROR vs PERM_DENIED vs PERMANENT_DENIED
 * - v1.5: FIX Evitar needsManualSettings en primer fallo o cancelación
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

const NexoBLE = registerPlugin('NexoBLE');

const NAP_CODES = {
  INIT: '[NAP-BLE-001]',
  PERM_REQUEST: '[NAP-BLE-002]',
  PERM_GRANTED: '[NAP-BLE-003]',
  PERM_DENIED: '[NAP-BLE-004]',
  PERM_ERROR: '[NAP-BLE-005]',
  WEB_FALLBACK: '[NAP-BLE-100]',
  ANDROID_NATIVE: '[NAP-BLE-200]',
  ERROR_RECOVERY: '[NAP-BLE-900]'
};

/**
 * Solicitar permisos BLE con manejo granular de errores
 * FIX v1.5: No saltar a manual inmediatamente, permitir reintentos
 */
export async function requestBLEPermissions() {
  const platform = Capacitor.getPlatform();
  console.log(`${NAP_CODES.INIT} NAP Platform Detection: ${platform}`);
  
  if (platform === 'web' || platform === 'ios') {
    return requestWebBluetoothPermissions();
  }
  
  if (platform === 'android') {
    return requestNativeAndroidPermissions();
  }
  
  return { 
    granted: false, 
    error: 'Platform not supported',
    nap_code: 'UNSUPPORTED_PLATFORM',
    canRetry: false
  };
}

/**
 * Android Nativo: Solicitud con granularidad de errores
 * FIX v1.5: Separar casos: user_cancelled vs denied vs error técnico
 */
async function requestNativeAndroidPermissions() {
  console.log(`${NAP_CODES.PERM_REQUEST} Solicitando permisos vía NexoBLE...`);
  
  try {
    const result = await NexoBLE.isBluetoothEnabled();
    
    console.log(`${NAP_CODES.ANDROID_NATIVE} Respuesta nativa:`, JSON.stringify(result));
    
    // Análisis de estado
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
    
    // Tiene permiso pero BT apagado - no es error de permisos
    if (hasPermission && !isEnabled) {
      return { 
        granted: false, 
        platform: 'android-native',
        bluetoothState: result.stateName,
        isBluetoothOff: true,
        canRetry: true,  // ← Puede reintentar después de encender BT
        nap_code: 'BT_DISABLED'
      };
    }
    
    // No tiene permiso - fue denegado en el diálogo nativo
    // FIX v1.5: NO marcar como needsManualSettings inmediatamente
    return { 
      granted: false, 
      platform: 'android-native',
      bluetoothState: result.stateName,
      hasPermission: false,
      isPermissionDenied: true,
      canRetry: true,  // ← Permitir reintento, no forzar manual aún
      nap_code: 'PERM_DENIED'
    };
    
  } catch (e) {
    // FIX v1.5: Análisis granular del error
    const errorMsg = e.message || '';
    console.error(`${NAP_CODES.PERM_ERROR} Error nativo:`, errorMsg);
    
    // Determinar si es cancelación por usuario vs error técnico vs denegación permanente
    const isUserCancelled = errorMsg.includes('cancelled') || 
                          errorMsg.includes('canceled') ||
                          errorMsg.includes('User rejected');
    
    const isPermanentDenied = errorMsg.includes('PERMANENTLY_DENIED') ||
                              errorMsg.includes('never_ask_again');
    
    const isSecurityException = errorMsg.includes('SecurityException') ||
                                errorMsg.includes('Permission denial');
    
    // FIX v1.5: Solo ir a manual si es denegación permanente o error de seguridad confirmado
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
    
    // FIX v1.5: Cancelación por usuario o error temporal = permitir reintento
    if (isUserCancelled) {
      return { 
        granted: false, 
        isUserCancelled: true,
        error: 'User cancelled permission dialog',
        platform: 'android-native',
        canRetry: true,  // ← Puede tocar de nuevo el botón azul
        nap_code: 'USER_CANCELLED'
      };
    }
    
    // Error técnico (timeout, etc) - permitir reintento
    return { 
      granted: false, 
      isTechnicalError: true,
      error: errorMsg,
      platform: 'android-native',
      canRetry: true,  // ← No saltar a manual por error técnico
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
      canRetry: isCancelled,  // ← Si canceló, puede reintentar
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

window.NEXO_BLE_PERMISSIONS = {
  requestBLEPermissions,
  checkBLEStatus,
  NAP_CODES
};
