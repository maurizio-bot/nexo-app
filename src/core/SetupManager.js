/**
 * NEXO Setup Manager v1.1
 * Onboarding obligatorio para BLE Android 14 (API 34+)
 * Persistencia: localStorage (nativo, sin plugins)
 */

import { Capacitor } from '@capacitor/core';

// Claves de persistencia
const STORAGE_KEYS = {
  SETUP_COMPLETED: 'nexo_setup_v1_completed',
  PERMISSION_DENIED_COUNT: 'nexo_perm_denied_count',
  LAST_CHECK: 'nexo_last_system_check'
};

// Helper: API Web Bluetooth para verificación inicial
async function checkWebBluetooth() {
  if (!navigator.bluetooth) {
    return { granted: false, error: 'Web Bluetooth not supported' };
  }
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true
    });
    return { granted: true, device };
  } catch (e) {
    return { granted: false, error: e.message };
  }
}

export class SetupManager {
  /**
   * Check completo del sistema (usado en main.js al inicio)
   */
  static async checkInitialStatus() {
    // Solo Android requiere wizard de permisos BLE
    if (Capacitor.getPlatform() !== 'android') {
      return { ready: true, reason: null, isFirstTime: false };
    }

    try {
      // 1. Verificar si ya completó setup antes
      const completedBefore = localStorage.getItem(STORAGE_KEYS.SETUP_COMPLETED) === 'true';
      
      // 2. Si es primera vez o no completó, requiere setup
      if (!completedBefore) {
        return { 
          ready: false, 
          reason: 'permissions',
          isFirstTime: true 
        };
      }

      // 3. Ya completado antes, verificar si sigue válido
      const lastCheck = parseInt(localStorage.getItem(STORAGE_KEYS.LAST_CHECK) || '0');
      const oneDayMs = 24 * 60 * 60 * 1000;
      
      // Si pasó más de 1 día, re-verificar silenciosamente
      if (Date.now() - lastCheck > oneDayMs) {
        // En Android real, el plugin nativo verificará permisos
        // Aquí asumimos que si completó antes, sigue válido hasta que falle
        localStorage.setItem(STORAGE_KEYS.LAST_CHECK, Date.now().toString());
      }

      return { ready: true, reason: null, isFirstTime: false };

    } catch (error) {
      console.error('[SetupManager] Error checking status:', error);
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
    localStorage.removeItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT);
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
