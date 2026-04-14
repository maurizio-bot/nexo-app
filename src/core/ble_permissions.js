/**
 * BLE Permissions Manager v1.3
 * Android 14+ nativo | Web Bluetooth API fallback
 * NAP 2.0 Certified - Platform Detection
 */

import { Capacitor } from '@capacitor/core';

/**
 * Solicitar permisos BLE - ROUTER PRINCIPAL
 * NAP: Detecta plataforma y usa método correcto
 */
export async function requestBLEPermissions() {
  const platform = Capacitor.getPlatform();
  
  // NAP: Web/PWA usa Web Bluetooth API
  if (platform === 'web' || platform === 'ios') {
    return requestWebBluetoothPermissions();
  }
  
  // NAP: Android nativo debe usar plugin Kotlin
  if (platform === 'android') {
    return requestNativeAndroidPermissions();
  }
  
  return { granted: false, error: 'Platform not supported' };
}

/**
 * Android Nativo: Usar NexoBlePlugin.kt (único que maneja BLUETOOTH_SCAN)
 * NAP: Este es el único método válido para Android 14+
 */
async function requestNativeAndroidPermissions() {
  try {
    console.log('[BLE-Permissions] NAP: Solicitando permisos nativos Android...');
    
    // Importar plugin nativo dinámicamente
    const { NexoBlePlugin } = await import('@capacitor/core').then(m => ({
      NexoBlePlugin: m.Capacitor.registerPlugin('NexoBlePlugin')
    }));
    
    // Llamar método nativo que implementaste en Kotlin
    const result = await NexoBlePlugin.requestPermissions({
      permissions: [
        'BLUETOOTH_SCAN',
        'BLUETOOTH_CONNECT',
        'ACCESS_FINE_LOCATION'
      ]
    });
    
    console.log('[BLE-Permissions] NAP: Respuesta nativa:', result);
    return { 
      granted: result.granted, 
      platform: 'android-native',
      nap_verified: true 
    };
    
  } catch (e) {
    console.error('[BLE-Permissions] NAP Error - Fallback a settings manual:', e);
    // NAP: No retornar granted=true en error real
    return { 
      granted: false, 
      needsManualSettings: true,
      error: e.message,
      nap_recovery: true 
    };
  }
}

/**
 * Web/PWA: Usar Web Bluetooth API
 * NAP: Solo para navegadores compatibles
 */
async function requestWebBluetoothPermissions() {
  if (!navigator.bluetooth) {
    return { granted: false, error: 'Web Bluetooth not supported' };
  }
  
  try {
    await navigator.bluetooth.getAvailability();
    return { granted: true, platform: 'web-bluetooth' };
  } catch (e) {
    return { granted: false, error: e.message };
  }
}

/**
 * Verificar estado BLE
 * NAP: Check real en nativo, no asumir
 */
export async function checkBLEStatus() {
  const platform = Capacitor.getPlatform();
  
  if (platform !== 'android') {
    // Web check
    const available = navigator.bluetooth ? await navigator.bluetooth.getAvailability() : false;
    return { granted: available, available };
  }
  
  // Android: Verificar vía plugin nativo
  try {
    const { NexoBlePlugin } = await import('@capacitor/core').then(m => ({
      NexoBlePlugin: m.Capacitor.registerPlugin('NexoBlePlugin')
    }));
    
    const status = await NexoBlePlugin.checkStatus();
    return {
      granted: status.permissionsGranted,
      bluetoothEnabled: status.bluetoothEnabled,
      platform: 'android-native'
    };
  } catch (e) {
    return { granted: false, error: e.message };
  }
}
