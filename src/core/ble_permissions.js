/**
 * BLE Permissions Manager para Android 12+
 * Solicita permisos en tiempo de ejecución
 * v1.1 - Sin dependencias externas, usa Web Bluetooth API nativa
 */

import { Capacitor } from '@capacitor/core';

export async function requestBLEPermissions() {
  // Si no es Android (web/desktop), asumir concedido
  if (Capacitor.getPlatform() !== 'android') {
    return { granted: true, platform: Capacitor.getPlatform() };
  }

  try {
    // En Android nativo, los permisos se manejan por el plugin nexo-ble nativo (Kotlin)
    // Esta función es para verificación en capa web/JS
    // Verificamos disponibilidad de Web Bluetooth
    if (typeof navigator !== 'undefined' && navigator.bluetooth) {
      try {
        // Intentar acceder a Bluetooth para verificar permisos
        await navigator.bluetooth.getAvailability();
        return { granted: true, available: true, native: false };
      } catch (e) {
        return { granted: false, error: 'Bluetooth not available', details: e.message };
      }
    }
    
    // Fallback si no hay Web Bluetooth API
    return { granted: true, fallback: true, reason: 'no-web-bluetooth-api' };
    
  } catch (e) {
    console.warn('[BLE-Permissions] Error:', e);
    return { granted: false, error: e.message };
  }
}

export async function checkBLEStatus() {
  try {
    // Verificar si Web Bluetooth está disponible
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      return { granted: false, available: false, error: 'Web Bluetooth not supported' };
    }

    // Verificar disponibilidad de Bluetooth
    const available = await navigator.bluetooth.getAvailability();
    
    if (!available) {
      return { granted: false, available: false, error: 'Bluetooth adapter not available' };
    }

    // En web, no podemos verificar directamente si está "encendido" sin intentar conectar
    // Asumimos que si está disponible, está listo
    return { 
      granted: true, 
      available: true, 
      enabled: true,
      platform: Capacitor.getPlatform()
    };
    
  } catch (e) {
    console.error('[BLE-Status] Error checking Bluetooth:', e);
    return { granted: false, available: false, error: e.message };
  }
}

/**
 * Solicitar dispositivo BLE (para pairing inicial)
 * Usa Web Bluetooth API nativa
 */
export async function requestBLEDevice() {
  try {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth API not available');
    }

    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['battery_service'] // Servicio genérico
    });

    return { success: true, device };
  } catch (e) {
    console.error('[BLE-Request] Failed:', e);
    return { success: false, error: e.message };
  }
}
