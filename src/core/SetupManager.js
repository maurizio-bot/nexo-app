/**
 * NEXO Setup Manager v1.3
 * Onboarding para BLE Android 14 (API 34+)
 * Persistencia: localStorage (nativo, sin plugins externos)
 */

import { Capacitor } from '@capacitor/core';

const STORAGE_KEYS = {
  SETUP_COMPLETED: 'nexo_setup_v1_completed',
  PERMISSION_DENIED_COUNT: 'nexo_perm_denied_count',
  LAST_CHECK: 'nexo_last_system_check'
};

export class SetupManager {
  static async checkInitialStatus() {
    if (Capacitor.getPlatform() !== 'android') {
      return { ready: true, reason: null, isFirstTime: false };
    }

    try {
      console.log('[SetupManager] Verificando estado BLE...');
      
      const completedBefore = localStorage.getItem(STORAGE_KEYS.SETUP_COMPLETED) === 'true';
      
      if (!completedBefore) {
        console.log('[SetupManager] Setup requerido: primera vez o incompleto');
        return { 
          ready: false, 
          reason: 'permissions',
          isFirstTime: true 
        };
      }

      const lastCheck = parseInt(localStorage.getItem(STORAGE_KEYS.LAST_CHECK) || '0');
      const oneDayMs = 24 * 60 * 60 * 1000;
      
      if (Date.now() - lastCheck > oneDayMs) {
        localStorage.setItem(STORAGE_KEYS.LAST_CHECK, Date.now().toString());
        console.log('[SetupManager] Último check >24h, actualizando timestamp');
      }

      console.log('[SetupManager] Sistema validado');
      return { ready: true, reason: null, isFirstTime: false };

    } catch (error) {
      console.error('[SetupManager] Error Recovery:', error);
      return { 
        ready: false, 
        reason: 'error',
        isFirstTime: true,
        error: error.message 
      };
    }
  }

  static async markCompleted() {
    try {
      localStorage.setItem(STORAGE_KEYS.SETUP_COMPLETED, 'true');
      localStorage.setItem(STORAGE_KEYS.LAST_CHECK, Date.now().toString());
      localStorage.removeItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT);
      console.log('[SetupManager] Setup marcado como completado');
      return true;
    } catch (e) {
      console.error('[SetupManager] Error persistiendo estado:', e);
      return false;
    }
  }

  static async shouldGoToSettings() {
    try {
      const deniedCount = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
      console.log(`[SetupManager] Intentos fallidos: ${deniedCount}`);
      return deniedCount >= 2;
    } catch (e) {
      console.error('[SetupManager] Error:', e);
      return false;
    }
  }

  static async recordPermissionDenied() {
    try {
      const current = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
      const newCount = current + 1;
      localStorage.setItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT, newCount.toString());
      console.log(`[SetupManager] Permiso denegado registrado (total: ${newCount})`);
      return newCount;
    } catch (e) {
      console.error('[SetupManager] Error:', e);
      return 1;
    }
  }

  static async openAppSettings() {
    try {
      const { App } = await import('@capacitor/app');
      await App.openUrl({ url: 'app-settings:' });
      console.log('[SetupManager] Abierta configuración de app');
    } catch (e) {
      console.warn('[SetupManager] Fallback: App plugin no disponible');
      alert('Ve a Configuración > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
    }
  }

  static async openBluetoothSettings() {
    try {
      const { App } = await import('@capacitor/app');
      
      if (Capacitor.getPlatform() === 'android') {
        await App.openUrl({ url: 'intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end' });
        console.log('[SetupManager] Abierta configuración Bluetooth');
      }
    } catch (e) {
      console.warn('[SetupManager] No se pudo abrir Bluetooth settings:', e);
      alert('Por favor abre Configuración > Bluetooth y actívalo manualmente');
    }
  }
}
