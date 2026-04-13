/**
 * NEXO Setup Manager v1.0
 * Onboarding obligatorio para BLE Android 14 (API 34)
 * Persistencia: Capacitor Preferences
 * Integración: Extiende ble_permissions.js existente
 */

import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';
import { requestBLEPermissions, checkBLEStatus } from './ble_permissions.js';

// Claves de persistencia
const STORAGE_KEYS = {
  SETUP_COMPLETED: 'nexo_setup_v1_completed',
  PERMISSION_DENIED_COUNT: 'nexo_perm_denied_count',
  LAST_CHECK: 'nexo_last_system_check'
};

export class SetupManager {
  
  /**
   * Check completo del sistema (usado en main.js al inicio)
   * @returns {Promise<{ready: boolean, reason: string|null, isFirstTime: boolean}>}
   */
  static async checkInitialStatus() {
    // Solo Android requiere wizard de permisos BLE
    if (Capacitor.getPlatform() !== 'android') {
      return { ready: true, reason: null, isFirstTime: false };
    }

    try {
      // 1. Verificar permisos usando ble_permissions.js existente
      const permResult = await requestBLEPermissions();
      
      // 2. Verificar estado Bluetooth usando ble_permissions.js existente  
      const btStatus = await checkBLEStatus();
      
      // 3. Verificar si ya completó setup antes
      const { value: completedBefore } = await Preferences.get({ 
        key: STORAGE_KEYS.SETUP_COMPLETED 
      });
      
      const isFirstTime = !completedBefore;
      
      // 4. Evaluar readiness completo
      const permissionsGranted = permResult.granted === true;
      const bluetoothEnabled = btStatus.enabled === true;
      
      // Modo avión no está en ble_permissions.js original, lo chequeamos nativamente si es necesario
      // Por ahora asumimos que si BT está apagado, puede ser modo avión o simplemente apagado
      const ready = permissionsGranted && bluetoothEnabled;
      
      if (ready) {
        // Marcar como completado si todo está OK
        await Preferences.set({ 
          key: STORAGE_KEYS.SETUP_COMPLETED, 
          value: 'true' 
        });
        await Preferences.set({ 
          key: STORAGE_KEYS.LAST_CHECK, 
          value: Date.now().toString() 
        });
        
        return { ready: true, reason: null, isFirstTime: false };
      }

      // Determinar razón específica
      let reason = 'unknown';
      if (!permissionsGranted) reason = 'permissions';
      else if (!bluetoothEnabled) reason = 'bluetooth';

      return {
        ready: false,
        reason,
        isFirstTime,
        details: {
          permissions: permResult,
          bluetooth: btStatus
        }
      };

    } catch (error) {
      console.error('[SetupManager] Error en checkInitialStatus:', error);
      return { 
        ready: false, 
        reason: 'error', 
        isFirstTime: true,
        error: error.message 
      };
    }
  }

  /**
   * Marcar setup como completado manualmente
   */
  static async markCompleted() {
    await Preferences.set({ 
      key: STORAGE_KEYS.SETUP_COMPLETED, 
      value: 'true' 
    });
  }

  /**
   * Reset forzado (para testing o troubleshooting)
   */
  static async forceReset() {
    await Preferences.remove({ key: STORAGE_KEYS.SETUP_COMPLETED });
    await Preferences.remove({ key: STORAGE_KEYS.PERMISSION_DENIED_COUNT });
    await Preferences.remove({ key: STORAGE_KEYS.LAST_CHECK });
  }

  /**
   * Registrar denegación de permisos (para lógica de "ir a settings manual")
   */
  static async recordPermissionDenied() {
    const { value } = await Preferences.get({ 
      key: STORAGE_KEYS.PERMISSION_DENIED_COUNT 
    });
    const count = parseInt(value || '0') + 1;
    await Preferences.set({ 
      key: STORAGE_KEYS.PERMISSION_DENIED_COUNT, 
      value: count.toString() 
    });
    return count;
  }

  /**
   * Determinar si debe ir a settings manual tras múltiples denegaciones
   */
  static async shouldGoToSettings() {
    const { value } = await Preferences.get({ 
      key: STORAGE_KEYS.PERMISSION_DENIED_COUNT 
    });
    return parseInt(value || '0') >= 2;
  }

  /**
   * Verificar si setup fue completado alguna vez (check rápido sin permisos)
   */
  static async isCompleted() {
    const { value } = await Preferences.get({ 
      key: STORAGE_KEYS.SETUP_COMPLETED 
    });
    return value === 'true';
  }

  /**
   * Abrir Settings del sistema (Bluetooth)
   */
  static async openBluetoothSettings() {
    try {
      const { App } = await import('@capacitor/app');
      await App.openUrl({ url: 'intent://android.settings.BLUETOOTH_SETTINGS' });
    } catch (e) {
      console.warn('[SetupManager] No se pudo abrir settings BT:', e);
      // Fallback manual
      window.location.href = 'app-settings://';
    }
  }

  /**
   * Abrir Settings de la App (Permisos)
   */
  static async openAppSettings() {
    try {
      const { App } = await import('@capacitor/app');
      await App.openUrl({ url: 'app-settings://' });
    } catch (e) {
      console.warn('[SetupManager] No se pudo abrir app settings:', e);
    }
  }
}

// Export individual para imports desestructurados
export const { 
  checkInitialStatus, 
  markCompleted, 
  forceReset,
  openBluetoothSettings,
  openAppSettings 
} = SetupManager;
