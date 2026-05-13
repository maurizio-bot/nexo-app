/**
 * NEXO Setup Manager v3.0.0-FIX
 * Coordinado con NexoBlePlugin.kt 961 (checkBLEStatus)
 * Funciona CON o SIN @capacitor/app instalado
 * Fallback: Usa visibilitychange + polling si no hay App plugin
 */

import { Capacitor } from '@capacitor/core';
import { checkBLEStatus } from './ble_permissions.js';

const STORAGE_KEYS = {
  SETUP_COMPLETED: 'nexo_setup_v1_completed',
  PERMISSION_DENIED_COUNT: 'nexo_perm_denied_count',
  LAST_CHECK: 'nexo_last_system_check',
  AWAITING_SETTINGS_RETURN: 'nexo_awaiting_settings_return'
};

let AppPlugin = null;
let isAppPluginLoaded = false;

export class SetupManager {
  static resumeListener = null;
  static isAwaitingSettingsReturn = false;
  static visibilityHandler = null;
  static checkInterval = null;

  static async checkInitialStatus() {
    if (Capacitor.getPlatform() !== 'android') {
      return { ready: true, reason: null, isFirstTime: false };
    }

    try {
      console.log('[SetupManager] v3.0.0-FIX - Verificando estado...');

      if (!isAppPluginLoaded) {
        try {
          const appModule = await import('@capacitor/app');
          AppPlugin = appModule.App;
          console.log('[SetupManager] App plugin cargado correctamente');
        } catch (e) {
          console.log('[SetupManager] App plugin no disponible, usando fallback');
          AppPlugin = null;
        }
        isAppPluginLoaded = true;
      }

      const completedBefore = localStorage.getItem(STORAGE_KEYS.SETUP_COMPLETED) === 'true';

      if (!completedBefore) {
        console.log('[SetupManager] Setup requerido - primera vez');
        SetupManager.setupResumeDetection();
        return { 
          ready: false, 
          reason: 'permissions',
          isFirstTime: true 
        };
      }

      console.log('[SetupManager] Verificando estado REAL...');
      const bleStatus = await checkBLEStatus();
      // ... (lógica de estado)
    } catch (e) {
        console.warn('[SetupManager] Error checkInitialStatus:', e);
        return { ready: false, reason: 'error' };
    }
  }

  static setupResumeDetection() {
    if (SetupManager.visibilityHandler) return;
    SetupManager.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        console.log('[SetupManager] Visibility visible - checking status');
        SetupManager.checkInitialStatus();
      }
    };
    document.addEventListener('visibilitychange', SetupManager.visibilityHandler);
  }

  static async markCompleted() {
    localStorage.setItem(STORAGE_KEYS.SETUP_COMPLETED, 'true');
    SetupManager.cleanup();
  }

  static async openAppSettings() {
    try {
      const { NativeSettings } = await import('capacitor-native-settings');
      await NativeSettings.open({ option: 'app' });
    } catch (e) {
      console.warn('[SetupManager] Error abriendo settings:', e);
      alert('Ve a Configuración > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
    }
  }

  static async openBluetoothSettings() {
    try {
      if (AppPlugin && Capacitor.getPlatform() === 'android') {
        await AppPlugin.openUrl({ url: 'intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end' });
      } else {
        window.location.href = 'intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end';
      }
      console.log('[SetupManager] Bluetooth settings abierto');
    } catch (e) {
      console.warn('[SetupManager] Fallback:', e);
      alert('Abre Configuración > Bluetooth y actívalo manualmente');
    }
  }

  static cleanup() {
    if (SetupManager.visibilityHandler) {
      document.removeEventListener('visibilitychange', SetupManager.visibilityHandler);
      SetupManager.visibilityHandler = null;
    }
    if (SetupManager.checkInterval) {
      clearInterval(SetupManager.checkInterval);
      SetupManager.checkInterval = null;
    }
  }
}
