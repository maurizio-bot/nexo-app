/**
 * BLE Permissions Manager v1.7-NAP PRODUCTION
 * Android 14+ nativo | Web Bluetooth API fallback
 * NAP 2.0 Certified - Error Granularity & Recovery Flow
 * 
 * CHANGELOG:
 * - v1.7: PRODUCTION READY - Race condition fixes en callback nativo
 * - v1.7: Detección robusta de BT apagado vs Permisos denegados
 * - v1.7: Manejo explícito de never_ask_again
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
 * Solicita permisos BLE según la plataforma
 * Returns: { granted: boolean, bluetoothEnabled: boolean, ... }
 */
export async function requestBLEPermissions() {
  const platform = Capacitor.getPlatform();
  console.log(`${NAP_CODES.INIT} NAP Platform Detection: ${platform}`);
  
  if (platform === 'web' || platform === 'ios') {
    return requestWebBluetoothPermissions();
  }
  
  if (platform === 'android') {
    // Android 14+ usa diálogo nativo explícito
    return requestNativeAndroidPermissionsExplicit();
  }
  
  return { 
    granted: false, 
    error: 'Platform not supported',
    nap_code: 'UNSUPPORTED_PLATFORM',
    canRetry: false
  };
}

/**
 * Android 14+ - Solicitud explícita de permisos via plugin nativo
 */
async function requestNativeAndroidPermissionsExplicit() {
  console.log(`${NAP_CODES.PERM_REQUEST} Solicitando permisos explícitos vía NexoBLE.requestBLEPermissions()...`);
  
  try {
    const result = await NexoBLE.requestBLEPermissions();
    
    console.log(`${NAP_CODES.ANDROID_NATIVE} Respuesta nativa explícita:`, JSON.stringify(result));
    
    // CASO ÉXITO: Todos los permisos concedidos
    if (result.allGranted === true) {
      // Verificar estado del Bluetooth después de permisos
      const btCheck = await NexoBLE.isBluetoothEnabled();
      console.log(`${NAP_CODES.ANDROID_NATIVE} Post-perm check - BT State:`, btCheck.stateName);
      
      // Si BT está apagado, informar para que el wizard muestre pantalla de BT
      if (btCheck.enabled === false) {
        return { 
          granted: true,           // Permisos SÍ concedidos
          permissionsGranted: true,
          bluetoothEnabled: false, // Pero BT apagado
          needsBluetoothOn: true,  // Flag para redirigir a pantalla BT
          platform: 'android-native',
          nap_code: 'PERM_OK_BT_OFF'
        };
      }
      
      // Todo listo: Permisos + BT encendido
      return { 
        granted: true, 
        platform: 'android-native',
        nap_verified: true,
        permissions: result.permissions,
        bluetoothEnabled: true,
        nap_code: 'PERM_GRANTED'
      };
    }
    
    // CASO PARCIAL: Algunos permisos denegados
    return { 
      granted: false, 
      platform: 'android-native',
      isPermissionDenied: true,
      isPartial: true,
      permissions: result.permissions || {},
      canRetry: true,
      nap_code: 'PERM_PARTIAL_DENIED'
    };
    
  } catch (e) {
    console.error(`${NAP_CODES.ERROR_RECOVERY} Error en requestBLEPermissions:`, e.message);
    
    const errorMsg = e.message || '';
    
    // Detectar denegación permanente (never ask again)
    if (errorMsg.includes('PERMANENTLY_DENIED') || 
        errorMsg.includes('never_ask_again') ||
        errorMsg.includes('PERM_PERMANENT') ||
        errorMsg.includes('PERM_MANUAL_SETTINGS')) {
      return { 
        granted: false, 
        needsManualSettings: true,
        isPermanentDenial: true,
        platform: 'android-native',
        canRetry: false,
        nap_code: 'PERM_PERMANENT_DENIED'
      };
    }
    
    // Detectar cancelación por usuario
    if (errorMsg.includes('cancelled') || 
        errorMsg.includes('canceled') ||
        errorMsg.includes('timeout')) {
      return {
        granted: false,
        isUserCancelled: true,
        platform: 'android-native',
        canRetry: true,
        nap_code: 'USER_CANCELLED'
      };
    }
    
    // Fallback a verificación manual si el método nuevo falló
    console.log(`${NAP_CODES.ERROR_RECOVERY} Fallback a verificación manual de estado...`);
    return requestNativeAndroidPermissionsFallback();
  }
}

/**
 * Fallback para verificación de permisos si el método explícito falla
 */
async function requestNativeAndroidPermissionsFallback() {
  console.log(`${NAP_CODES.PERM_REQUEST} Verificando estado vía NexoBLE.isBluetoothEnabled()...`);
  
  try {
    const result = await NexoBLE.isBluetoothEnabled();
    console.log(`${NAP_CODES.ANDROID_NATIVE} Respuesta nativa fallback:`, JSON.stringify(result));
    
    const hasPermission = result.stateName !== 'NO_PERMISSION';
    const isEnabled = result.enabled === true;
    const isPermanentlyDenied = result.isPermanentlyDenied === true;
    
    // Caso: Denegación permanente detectada
    if (isPermanentlyDenied) {
      return {
        granted: false,
        platform: 'android-native',
        isPermanentDenial: true,
        needsManualSettings: true,
        canRetry: false,
        nap_code: 'PERM_PERMANENT_DENIED'
      };
    }
    
    // Caso: Todo listo
    if (hasPermission && isEnabled) {
      return { 
        granted: true, 
        platform: 'android-native',
        nap_verified: true,
        bluetoothState: result.stateName,
        bluetoothEnabled: true,
        nap_code: 'PERM_GRANTED'
      };
    }
    
    // Caso: Permisos OK pero BT apagado
    if (hasPermission && !isEnabled) {
      return { 
        granted: true,          // Permisos sí
        permissionsGranted: true,
        bluetoothEnabled: false,
        needsBluetoothOn: true,
        platform: 'android-native',
        bluetoothState: result.stateName,
        canRetry: true,
        nap_code: 'BT_DISABLED'
      };
    }
    
    // Caso: Sin permisos
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
    console.error(`${NAP_CODES.PERM_ERROR} Error nativo fallback:`, errorMsg);
    
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

/**
 * Web Bluetooth API para PWA/Desktop
 */
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

/**
 * Verificación de estado actual BLE sin solicitar permisos
 */
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
      isPermanentlyDenied: status.isPermanentlyDenied === true,
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

// Exposición global para debugging
window.NEXO_BLE_PERMISSIONS = {
  requestBLEPermissions,
  checkBLEStatus,
  NAP_CODES
};
