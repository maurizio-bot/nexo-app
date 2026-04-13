/**
 * NEXO Setup Manager v1.1
 * Onboarding obligatorio para BLE Android 14 (API 34+)
 * Persistencia: LocalStorage (fallback nativo, sin plugins)
 */

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
      // 1. Verificar si ya completó setup antes
      const completedBefore = localStorage.getItem(STORAGE_KEYS.SETUP_COMPLETED) === 'true';
      
      if (completedBefore) {
        // Ya completado, verificar que permisos sigan vigentes
        const btStatus = await checkBLEStatus();
        if (btStatus.granted) {
          return { ready: true, reason: null, isFirstTime: false };
        }
        // Permisos revocados - requiere setup nuevamente
        localStorage.removeItem(STORAGE_KEYS.SETUP_COMPLETED);
      }

      // 2. Verificar permisos actuales
      const permResult = await requestBLEPermissions();
      const btStatus = await checkBLEStatus();

      // 3. Si todo está OK, marcar como completado
      if (permResult.granted && btStatus.granted) {
        localStorage.setItem(STORAGE_KEYS.SETUP_COMPLETED, 'true');
        localStorage.setItem(STORAGE_KEYS.LAST_CHECK, Date.now().toString());
        return { ready: true, reason: null, isFirstTime: !completedBefore };
      }

      // 4. Requiere wizard
      return { 
        ready: false, 
        reason: 'permissions',
        isFirstTime: !completedBefore 
      };

    } catch (error) {
      console.error('[SetupManager] Error checking status:', error);
      // En caso de error, asumir que requiere setup
      return { 
        ready: false, 
        reason: 'error',
        isFirstTime: true 
      };
    }
  }

  /**
   * Marcar setup como completado
   */
  static async markCompleted() {
    localStorage.setItem(STORAGE_KEYS.SETUP_COMPLETED, 'true');
    localStorage.setItem(STORAGE_KEYS.LAST_CHECK, Date.now().toString());
  }

  /**
   * Determinar si mostrar opción manual
   */
  static async shouldShowManualOption() {
    const deniedCount = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
    return deniedCount >= 2;
  }

  /**
   * Incrementar contador de denegaciones
   */
  static incrementDeniedCount() {
    const current = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
    localStorage.setItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT, (current + 1).toString());
  }

  /**
   * Resetear contador
   */
  static resetDeniedCount() {
    localStorage.removeItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT);
  }
}
