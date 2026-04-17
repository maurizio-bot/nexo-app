/**
 * BLE Permissions Manager v1.6-NAP
 * Android 14+ nativo | Web Bluetooth API fallback
 * NAP 2.0 Certified - Error Granularity & Recovery Flow
 
 * 
 * CHANGELOG:
 * - v1.5: FIX Bug salto automático a manual - Distingue perm_denied vs user_cancelled
 * - v1.5: FIX Manejo granular de errores: TEMP_ERROR vs PERM_DENIED vs PERMANENT_DENIED
 * - v1.5: FIX Evitar needsManualSettings en primer fallo o cancelación
 * - v1.5.1: FIX Agregado requestBLEPermissionsNative() para diálogo explícito Android 14
 * - v1.5.2: FIX Verificación post-permisos de estado Bluetooth
 * - v1.6-NAP: FIX Agregado isPermanentlyDenied en checkBLEStatus() para detección inmediata vía plugin nativo
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

export async function requestBLEPermissions() {
  const platform = Capacitor.getPlatform();
  console.log(`${NAP_CODES.INIT} NAP Platform Detection: ${platform}`);
  
  if (platform === 'web' || platform === 'ios') {
    return requestWebBluetoothPermissions();
  }
  
  if (platform === 'android') {
    const nativeResult = await requestNativeAndroidPermissionsExplicit();
    if (nativeResult.granted || nativeResult.isPermissionDenied) {
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
  console.log(`${NAP_CODES.PERM_REQUEST} Solicitando permisos explícitos vía NexoBLE.requestBLEPermissions()...`);
  
  try {
    const result = await NexoBLE.requestBLEPermissions();
    
    console.log(`${NAP_CODES.ANDROID_NATIVE} Respuesta nativa explícita:`, JSON.stringify(result));
    
    if (result.allGranted) {
      const btCheck = await NexoBLE.isBluetoothEnabled();
      console.log(`${NAP_CODES.ANDROID_NATIVE} Post-perm check - BT State:`, btCheck.stateName);
      
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
    
    return { 
      granted: false, 
      platform: 'android-native',
      isPermissionDenied: true,
      permissions: result.permissions,
      canRetry: true,
      nap_code: 'PERM_DENIED'
    };
    
  } catch (e) {
    console.log(`${NAP_CODES.ERROR_RECOVERY} requestBLEPermissions no disponible, fallback a isBluetoothEnabled`);
    return { granted: false, fallback: true };
  }
}

async function requestNativeAndroidPermissions() {
  console.log(`${NAP_CODES.PERM_REQUEST} Verificando estado vía NexoBLE.isBluetoothEnabled()...`);
  
  try {
    const result = await NexoBLE.isBluetoothEnabled();
    console.log(`${NAP_CODES.ANDROID_NATIVE} Respuesta nativa:`, JSON.stringify(result));
    
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
    console.error(`${NAP_CODES.PERM_ERROR} Error nativo:`, errorMsg);
    
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
      isPermanentlyDenied: status.isPermanentlyDenied,  // NUEVO v1.6-NAP: Exponer flag del plugin
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
// NAP v1.6 Commit Final - Fri Apr 17 17:58:03 UTC 2026
// NAP-FORCE-1776453587
