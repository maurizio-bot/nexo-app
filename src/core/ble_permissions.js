/**
 * BLE Permissions Manager v1.5.2-NAP
 * Android 14+ nativo | Web Bluetooth API fallback
 * NAP 2.0 Certified
 * 
 * Estado: FUNCIONAL - Build #669 confirmada
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
    return requestNativeAndroidPermissions();
  }
  
  return { 
    granted: false, 
    error: 'Platform not supported',
    nap_code: 'UNSUPPORTED_PLATFORM',
    canRetry: false
  };
}

async function requestNativeAndroidPermissions() {
  console.log(`${NAP_CODES.PERM_REQUEST} Solicitando permisos vía NexoBLE.requestPermission()...`);
  
  try {
    // Método directo del plugin nativo
    const result = await NexoBLE.requestPermission();
    console.log(`${NAP_CODES.ANDROID_NATIVE} Respuesta nativa:`, JSON.stringify(result));
    
    if (result.granted) {
      // Verificar estado del Bluetooth después de permisos
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
        bluetoothEnabled: true,
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
    console.error(`${NAP_CODES.PERM_ERROR} Error nativo:`, errorMsg);
    
    // Detectar cancelación por usuario
    const isUserCancelled = errorMsg.includes('cancelled') || 
                          errorMsg.includes('canceled') ||
                          errorMsg.includes('User rejected');
    
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
