/**
 * BLE Permissions Manager v1.4 - CORREGIDO
 * Android 14+ nativo | Web Bluetooth API fallback
 * NAP 2.0 Certified - Platform Detection
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

// CORRECCIÓN CRÍTICA: Nombre exacto del plugin Kotlin (@CapacitorPlugin(name = "NexoBLE"))
// Fuente: Capacitor Plugin API - https://capacitorjs.com/docs/plugins/creating-plugins
const NexoBLE = registerPlugin('NexoBLE');

/**
 * Solicitar permisos BLE - Punto de entrada único
 * NAP: Detecta plataforma y usa método correcto
 */
export async function requestBLEPermissions() {
  const platform = Capacitor.getPlatform();
  
  // NAP: Web/PWA usa Web Bluetooth API
  if (platform === 'web' || platform === 'ios') {
    return requestWebBluetoothPermissions();
  }
  
  // NAP: Android nativo usa NexoBLE.isBluetoothEnabled()
  // Este método ya solicita permisos automáticamente si faltan (lógica nativa Kotlin)
  if (platform === 'android') {
    return requestNativeAndroidPermissions();
  }
  
  return { granted: false, error: 'Platform not supported' };
}

/**
 * Android Nativo: Usar NexoBLE.isBluetoothEnabled()
 * El plugin Kotlin verifica permisos y solicita runtime si es necesario
 * vía requestPermissionForAlias() -> btStatePermissionCallback
 */
async function requestNativeAndroidPermissions() {
  try {
    console.log('[BLE-Permissions] NAP: Solicitando verificación de permisos vía isBluetoothEnabled()...');
    
    // Llamar al método nativo. Si no hay permisos, Kotlin solicita automáticamente.
    const result = await NexoBLE.isBluetoothEnabled();
    
    console.log('[BLE-Permissions] NAP: Respuesta nativa:', result);
    
    // Determinar estado de permisos basado en la respuesta nativa
    const hasPermission = result.stateName !== 'NO_PERMISSION';
    const isEnabled = result.enabled === true;
    
    return { 
      granted: hasPermission && isEnabled, 
      platform: 'android-native',
      nap_verified: true,
      bluetoothState: result.stateName,
      health: result.health || null
    };
    
  } catch (e) {
    console.error('[BLE-Permissions] NAP Error:', e);
    return { 
      granted: false, 
      needsManualSettings: true,
      error: e.message || 'Error desconocido en permisos BLE',
      nap_recovery: true 
    };
  }
}

/**
 * Web/PWA: Usar Web Bluetooth API
 */
async function requestWebBluetoothPermissions() {
  if (!navigator.bluetooth) {
    return { granted: false, error: 'Web Bluetooth API no soportada' };
  }
  
  try {
    // Web Bluetooth requiere user gesture. Solicitar dispositivo fuerza el diálogo de permisos.
    await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['battery_service']
    });
    return { granted: true, platform: 'web-bluetooth' };
  } catch (e) {
    return { granted: false, error: e.message };
  }
}

/**
 * Verificar estado BLE actual
 */
export async function checkBLEStatus() {
  const platform = Capacitor.getPlatform();
  
  if (platform !== 'android') {
    const available = navigator.bluetooth ? await navigator.bluetooth.getAvailability() : false;
    return { granted: available, available, platform: 'web' };
  }
  
  try {
    const status = await NexoBLE.isBluetoothEnabled();
    return {
      granted: status.enabled === true && status.stateName === 'ON',
      bluetoothEnabled: status.enabled,
      stateName: status.stateName,
      platform: 'android-native',
      health: status.health
    };
  } catch (e) {
    return { granted: false, error: e.message, platform: 'android-native' };
  }
}
