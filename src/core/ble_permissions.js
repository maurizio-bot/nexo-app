/**
 * BLE Permissions Manager v1.4-NAP
 * Android 14+ nativo | Web Bluetooth API fallback
 * NAP 2.0 Certified - Resource Management & Graceful Degradation
 * 
 * CHANGELOG:
 * - v1.4: Fix nombre plugin NexoBLE (case-sensitive)
 * - v1.4: Usar isBluetoothEnabled() como entry point permisos
 * - v1.4: NAP logging completo
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

// NAP: Registro correcto del plugin nativo
// El nombre debe coincidir EXACTO con @CapacitorPlugin(name = "NexoBLE")
const NexoBLE = registerPlugin('NexoBLE');

// NAP Códigos de estado
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
 * Solicitar permisos BLE - ROUTER PRINCIPAL NAP
 * Detecta plataforma y usa método correcto con graceful degradation
 */
export async function requestBLEPermissions() {
  const platform = Capacitor.getPlatform();
  console.log(`${NAP_CODES.INIT} NAP Platform Detection: ${platform}`);
  
  // NAP: Web/PWA usa Web Bluetooth API (fallback graceful)
  if (platform === 'web' || platform === 'ios') {
    console.log(`${NAP_CODES.WEB_FALLBACK} Usando Web Bluetooth API`);
    return requestWebBluetoothPermissions();
  }
  
  // NAP: Android nativo - único método válido para BLUETOOTH_SCAN (API 31+)
  if (platform === 'android') {
    console.log(`${NAP_CODES.ANDROID_NATIVE} Usando NexoBLE nativo`);
    return requestNativeAndroidPermissions();
  }
  
  // NAP: Plataforma no soportada - degradado controlado
  console.warn(`${NAP_CODES.ERROR_RECOVERY} Plataforma no soportada: ${platform}`);
  return { 
    granted: false, 
    error: 'Platform not supported',
    nap_code: 'UNSUPPORTED_PLATFORM'
  };
}

/**
 * Android Nativo: Usar NexoBLE.isBluetoothEnabled()
 * NAP: Este método ya solicita permisos automáticamente si faltan
 * vía requestPermissionForAlias() -> btStatePermissionCallback (Kotlin)
 */
async function requestNativeAndroidPermissions() {
  console.log(`${NAP_CODES.PERM_REQUEST} Solicitando permisos vía isBluetoothEnabled()...`);
  
  try {
    // Llamar al método nativo. Si no hay permisos, Kotlin solicita automáticamente.
    const result = await NexoBLE.isBluetoothEnabled();
    
    console.log(`${NAP_CODES.ANDROID_NATIVE} Respuesta nativa:`, JSON.stringify(result));
    
    // NAP: Análisis de estado de permisos basado en respuesta Kotlin
    const hasPermission = result.stateName !== 'NO_PERMISSION';
    const isEnabled = result.enabled === true;
    const isReady = hasPermission && isEnabled;
    
    if (isReady) {
      console.log(`${NAP_CODES.PERM_GRANTED} Permisos concedidos y BT activo`);
    } else if (!hasPermission) {
      console.warn(`${NAP_CODES.PERM_DENIED} Permisos no concedidos (stateName: ${result.stateName})`);
    } else if (!isEnabled) {
      console.warn(`${NAP_CODES.PERM_DENIED} BT desactivado (requiere activación manual)`);
    }
    
    return { 
      granted: isReady, 
      platform: 'android-native',
      nap_verified: true,
      bluetoothState: result.stateName,
      hasPermission: hasPermission,
      isEnabled: isEnabled,
      health: result.health || null,
      nap_code: isReady ? 'PERM_GRANTED' : (hasPermission ? 'BT_DISABLED' : 'PERM_DENIED')
    };
    
  } catch (e) {
    // NAP: Error handling con información de recuperación
    console.error(`${NAP_CODES.PERM_ERROR} Error en solicitud nativa:`, e.message);
    
    return { 
      granted: false, 
      needsManualSettings: true,
      error: e.message || 'Error desconocido en permisos BLE',
      platform: 'android-native',
      nap_recovery: true,
      nap_code: 'PERM_ERROR',
      suggestion: 'Ir a Configuración > Apps > NEXO > Permisos > Activar Bluetooth'
    };
  }
}

/**
 * Web/PWA: Usar Web Bluetooth API
 * NAP: Solo para navegadores compatibles (Chrome, Edge)
 */
async function requestWebBluetoothPermissions() {
  if (!navigator.bluetooth) {
    console.warn(`${NAP_CODES.WEB_FALLBACK} Web Bluetooth API no disponible`);
    return { 
      granted: false, 
      error: 'Web Bluetooth API no soportada en este navegador',
      platform: 'web',
      nap_code: 'WEB_API_UNAVAILABLE'
    };
  }
  
  try {
    console.log(`${NAP_CODES.WEB_FALLBACK} Solicitando dispositivo Web BT...`);
    
    // Web Bluetooth requiere user gesture (click)
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['battery_service'] // Servicio mínimo para activar permiso
    });
    
    console.log(`${NAP_CODES.WEB_FALLBACK} Dispositivo seleccionado: ${device.name}`);
    
    return { 
      granted: true, 
      platform: 'web-bluetooth',
      deviceName: device.name,
      nap_code: 'WEB_PERM_GRANTED'
    };
    
  } catch (e) {
    console.warn(`${NAP_CODES.WEB_FALLBACK} Usuario canceló o error Web BT:`, e.message);
    return { 
      granted: false, 
      error: e.message,
      platform: 'web-bluetooth',
      nap_code: 'WEB_PERM_DENIED'
    };
  }
}

/**
 * Verificar estado BLE actual
 * NAP: Check real en nativo, no asumir estado
 */
export async function checkBLEStatus() {
  const platform = Capacitor.getPlatform();
  console.log(`${NAP_CODES.INIT} Verificando estado BLE en ${platform}`);
  
  if (platform !== 'android') {
    // Web check básico
    const available = navigator.bluetooth ? await navigator.bluetooth.getAvailability() : false;
    return { 
      granted: available, 
      available,
      platform: 'web',
      nap_code: available ? 'WEB_AVAILABLE' : 'WEB_UNAVAILABLE'
    };
  }
  
  // Android: Verificación nativa completa
  try {
    const status = await NexoBLE.isBluetoothEnabled();
    
    const isFullyReady = status.enabled === true && status.stateName === 'ON';
    
    console.log(`${NAP_CODES.ANDROID_NATIVE} Estado: ${status.stateName}, Enabled: ${status.enabled}`);
    
    return {
      granted: isFullyReady,
      bluetoothEnabled: status.enabled,
      stateName: status.stateName,
      platform: 'android-native',
      health: status.health,
      nap_code: isFullyReady ? 'NATIVE_READY' : `NATIVE_${status.stateName}`
    };
    
  } catch (e) {
    console.error(`${NAP_CODES.ERROR_RECOVERY} Error verificando estado:`, e.message);
    return { 
      granted: false, 
      error: e.message,
      platform: 'android-native',
      nap_code: 'CHECK_ERROR',
      nap_recovery: true
    };
  }
}

// Export para debug global
window.NEXO_BLE_PERMISSIONS = {
  requestBLEPermissions,
  checkBLEStatus,
  NAP_CODES
};
