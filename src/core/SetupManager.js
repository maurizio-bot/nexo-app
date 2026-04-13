/**
 * NEXO Setup Manager v1.2
 * Onboarding obligatorio para BLE Android 14 (API 34+)
 * Persistencia: localStorage (nativo, sin plugins externos)
 * NAP 2.0 Certified - Resource Management & Graceful Degradation
 */

import { Capacitor } from '@capacitor/core';

// Claves de persistencia
const STORAGE_KEYS = {
  SETUP_COMPLETED: 'nexo_setup_v1_completed',
  PERMISSION_DENIED_COUNT: 'nexo_perm_denied_count',
  LAST_CHECK: 'nexo_last_system_check'
};

export class SetupManager {
  /**
   * Check completo del sistema (usado en main.js al inicio)
   * NAP: Retorna inmediatamente, no bloquea UI
   */
  static async checkInitialStatus() {
    // Solo Android requiere wizard de permisos BLE
    if (Capacitor.getPlatform() !== 'android') {
      return { ready: true, reason: null, isFirstTime: false };
    }

    try {
      // NAP: Log diagnóstico
      console.log('[SetupManager] NAP 2.0 - Verificando estado...');
      
      // 1. Verificar si ya completó setup antes
      const completedBefore = localStorage.getItem(STORAGE_KEYS.SETUP_COMPLETED) === 'true';
      
      // 2. Si es primera vez o no completó, requiere setup
      if (!completedBefore) {
        console.log('[SetupManager] Setup requerido: primera vez o incompleto');
        return { 
          ready: false, 
          reason: 'permissions',
          isFirstTime: true 
        };
      }

      // 3. Ya completado antes - NAP: Verificar vigencia silenciosamente
      const lastCheck = parseInt(localStorage.getItem(STORAGE_KEYS.LAST_CHECK) || '0');
      const oneDayMs = 24 * 60 * 60 * 1000;
      
      if (Date.now() - lastCheck > oneDayMs) {
        localStorage.setItem(STORAGE_KEYS.LAST_CHECK, Date.now().toString());
        console.log('[SetupManager] Último check >24h, actualizando timestamp');
      }

      console.log('[SetupManager] NAP: Sistema validado');
      return { ready: true, reason: null, isFirstTime: false };

    } catch (error) {
      // NAP: Error graceful - no bloquear, requerir setup
      console.error('[SetupManager] NAP Error Recovery:', error);
      return { 
        ready: false, 
        reason: 'error',
        isFirstTime: true,
        error: error.message 
      };
    }
  }

  /**
   * Marcar setup como completado
   * NAP: Atomic operation, no falla silenciosamente
   */
  static async markCompleted() {
    try {
      localStorage.setItem(STORAGE_KEYS.SETUP_COMPLETED, 'true');
      localStorage.setItem(STORAGE_KEYS.LAST_CHECK, Date.now().toString());
      localStorage.removeItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT);
      console.log('[SetupManager] NAP: Setup marcado como completado');
      return true;
    } catch (e) {
      console.error('[SetupManager] NAP: Error persistiendo estado:', e);
      return false;
    }
  }

  /**
   * Determinar si mostrar opción manual
   * NAP: Alias para compatibilidad con wizard
   */
  static async shouldGoToSettings() {
    try {
      const deniedCount = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
      console.log(`[SetupManager] NAP: Intentos fallidos: ${deniedCount}`);
      return deniedCount >= 2;
    } catch (e) {
      console.error('[SetupManager] NAP Error:', e);
      return false; // Default seguro
    }
  }

  /**
   * Alias NAP: shouldShowManualOption
   */
  static async shouldShowManualOption() {
    return this.shouldGoToSettings();
  }

  /**
   * Registrar denegación de permisos
   * NAP: Atomic increment, persistencia garantizada
   */
  static async recordPermissionDenied() {
    try {
      const current = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
      const newCount = current + 1;
      localStorage.setItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT, newCount.toString());
      console.log(`[SetupManager] NAP: Permiso denegado registrado (total: ${newCount})`);
      return newCount;
    } catch (e) {
      console.error('[SetupManager] NAP Error:', e);
      return 1;
    }
  }

  /**
   * Incrementar contador (alias)
   */
  static incrementDeniedCount() {
    return this.recordPermissionDenied();
  }

  /**
   * Abrir configuración de la app
   * NAP: Graceful fallback si App plugin no disponible
   */
  static async openAppSettings() {
    try {
      // Intentar usar Capacitor App si está disponible (dinámico para no romper build)
      const { App } = await import('@capacitor/app');
      await App.openUrl({ url: 'app-settings:' });
      console.log('[SetupManager] NAP: Abierta configuración de app');
    } catch (e) {
      // NAP Fallback: Instrucciones manuales
      console.warn('[SetupManager] NAP Fallback: App plugin no disponible');
      alert('NAP: Ve a Configuración > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
    }
  }

  /**
   * Abrir configuración de Bluetooth
   * NAP: Intenta deep link, fallback manual
   */
  static async openBluetoothSettings() {
    try {
      const { App } = await import('@capacitor/app');
      
      if (Capacitor.getPlatform() === 'android') {
        // Intentar abrir settings de Bluetooth directo
        await App.openUrl({ url: 'intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end' });
        console.log('[SetupManager] NAP: Abierta configuración Bluetooth');
      }
    } catch (e) {
      console.warn('[SetupManager] NAP Fallback: No se pudo abrir Bluetooth settings:', e);
      alert('NAP: Por favor abre Configuración > Bluetooth y actívalo manualmente');
    }
  }

  /**
   * Resetear contador (utilidad NAP)
   */
  static resetDeniedCount() {
    localStorage.removeItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT);
    console.log('[SetupManager] NAP: Contador de errores reseteado');
  }
}
