/**
 * NEXO Setup Manager v2.1-HOTFIX
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

// Variable para cachear el App plugin si está disponible
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
      console.log('[SetupManager] v2.1-HOTFIX - Verificando estado...');
      
      // Cargar App plugin dinámicamente si existe
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
      console.log('[SetupManager] Estado BLE:', bleStatus.nap_code);
      
      if (bleStatus.granted === true) {
        console.log('[SetupManager] Sistema validado');
        return { ready: true, reason: null, isFirstTime: false };
      }
      
      if (bleStatus.bluetoothEnabled === false || bleStatus.stateName === 'OFF') {
        console.log('[SetupManager] BT apagado detectado');
        SetupManager.setupResumeDetection();
        return { 
          ready: false, 
          reason: 'bluetooth',
          isFirstTime: false 
        };
      }
      
      if (bleStatus.stateName === 'NO_PERMISSION' || !bleStatus.granted) {
        console.log('[SetupManager] Permisos faltantes');
        SetupManager.setupResumeDetection();
        return { 
          ready: false, 
          reason: 'permissions',
          isFirstTime: false 
        };
      }

      console.warn('[SetupManager] Estado indeterminado');
      SetupManager.setupResumeDetection();
      return { 
        ready: false, 
        reason: 'bluetooth',
        isFirstTime: false 
      };

    } catch (error) {
      console.error('[SetupManager] Error:', error);
      SetupManager.setupResumeDetection();
      return { 
        ready: false, 
        reason: 'error',
        isFirstTime: true,
        error: error.message 
      };
    }
  }

  /**
   * Configurar detección de retorno - usa App plugin si existe, o fallback visibilitychange
   */
  static setupResumeDetection() {
    // Limpiar listeners previos
    SetupManager.cleanup();

    if (AppPlugin) {
      // Método robusto con App plugin
      SetupManager.resumeListener = AppPlugin.addListener('resume', async () => {
        console.log('[SetupManager] App resumida (App plugin)');
        await SetupManager.handleAppResume();
      });
      console.log('[SetupManager] Resume listener (App plugin) activado');
    } else {
      // Fallback: visibilitychange API
      SetupManager.visibilityHandler = async () => {
        if (document.visibilityState === 'visible') {
          console.log('[SetupManager] App visible (visibilitychange fallback)');
          // Pequeño delay para asegurar que la app está completamente activa
          setTimeout(() => SetupManager.handleAppResume(), 500);
        }
      };
      document.addEventListener('visibilitychange', SetupManager.visibilityHandler);
      console.log('[SetupManager] Visibility listener (fallback) activado');
    }

    // Polling de seguridad: verificar cada 2 segundos si estamos awaiting
    SetupManager.checkInterval = setInterval(async () => {
      const wasAwaiting = localStorage.getItem(STORAGE_KEYS.AWAITING_SETTINGS_RETURN) === 'true';
      if (wasAwaiting && SetupManager.isAwaitingSettingsReturn) {
        // Verificar si ya tenemos permisos (usuario pudo haberlos concedido sin salir de app)
        const status = await SetupManager.checkPermissionsRealtime();
        if (status.granted) {
          console.log('[SetupManager] Permisos detectados vía polling');
          SetupManager.handleAppResume();
        }
      }
    }, 2000);
  }

  static async handleAppResume() {
    const wasAwaiting = localStorage.getItem(STORAGE_KEYS.AWAITING_SETTINGS_RETURN) === 'true';
    const deniedCount = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
    
    if (wasAwaiting || deniedCount > 0) {
      localStorage.removeItem(STORAGE_KEYS.AWAITING_SETTINGS_RETURN);
      SetupManager.isAwaitingSettingsReturn = false;
      
      console.log('[SetupManager] Re-verificando post-Settings...');
      const currentStatus = await SetupManager.checkPermissionsRealtime();
      
      if (currentStatus.granted) {
        console.log('[SetupManager] Permisos concedidos!');
        window.dispatchEvent(new CustomEvent('nexo-permissions-granted', {
          detail: { source: 'resume', timestamp: Date.now() }
        }));
      } else {
        console.log('[SetupManager] Permisos aún faltantes');
        window.dispatchEvent(new CustomEvent('nexo-permissions-denied', {
          detail: { source: 'resume', timestamp: Date.now(), status: currentStatus }
        }));
      }
    }
  }

  static async checkPermissionsRealtime() {
    try {
      const { NexoBLE } = window.Capacitor.Plugins;
      if (!NexoBLE) {
        return { granted: false, error: 'Plugin no disponible' };
      }
      
      const result = await NexoBLE.isBluetoothEnabled();
      const hasPermission = result.stateName !== 'NO_PERMISSION';
      const isEnabled = result.enabled === true;
      
      return {
        granted: hasPermission && isEnabled,
        bluetoothEnabled: isEnabled,
        hasPermission: hasPermission,
        stateName: result.stateName,
        timestamp: Date.now()
      };
      
    } catch (e) {
      console.error('[SetupManager] Error checkPermissionsRealtime:', e);
      return { granted: false, error: e.message };
    }
  }

  static async markAwaitingSettingsReturn() {
    localStorage.setItem(STORAGE_KEYS.AWAITING_SETTINGS_RETURN, 'true');
    SetupManager.isAwaitingSettingsReturn = true;
    console.log('[SetupManager] Marcado AWAITING_SETTINGS_RETURN');
  }

  static async markCompleted() {
    try {
      localStorage.setItem(STORAGE_KEYS.SETUP_COMPLETED, 'true');
      localStorage.setItem(STORAGE_KEYS.LAST_CHECK, Date.now().toString());
      localStorage.removeItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT);
      localStorage.removeItem(STORAGE_KEYS.AWAITING_SETTINGS_RETURN);
      SetupManager.cleanup(); // Limpiar listeners cuando termina
      console.log('[SetupManager] Setup completado');
      return true;
    } catch (e) {
      console.error('[SetupManager] Error:', e);
      return false;
    }
  }

  static async shouldGoToSettings() {
    try {
      const deniedCount = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
      console.log(`[SetupManager] Intentos fallidos: ${deniedCount}`);
      return deniedCount >= 2;
    } catch (e) {
      return false;
    }
  }

  static async recordPermissionDenied() {
    try {
      const current = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
      const newCount = current + 1;
      localStorage.setItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT, newCount.toString());
      console.log(`[SetupManager] Denegación registrada (total ${newCount})`);
      return newCount;
    } catch (e) {
      return 1;
    }
  }

  static async openAppSettings() {
    try {
      await SetupManager.markAwaitingSettingsReturn();
      
      // Intentar con App plugin primero, luego fallback
      if (AppPlugin) {
        await AppPlugin.openUrl({ url: 'app-settings:' });
      } else {
        // Fallback: intentar abrir con window.location (puede no funcionar en Android WebView)
        window.location.href = 'app-settings:';
        // O mostrar instrucciones
        setTimeout(() => {
          alert('Ve a Configuración > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
        }, 500);
      }
      console.log('[SetupManager] Configuración abierta');
    } catch (e) {
      console.warn('[SetupManager] Error abriendo settings:', e);
      alert('Ve a Configuración > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
    }
  }

  static async openBluetoothSettings() {
    try {
      await SetupManager.markAwaitingSettingsReturn();
      
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
    if (SetupManager.resumeListener) {
      SetupManager.resumeListener.remove();
      SetupManager.resumeListener = null;
      console.log('[SetupManager] Resume listener removido');
    }
    
    if (SetupManager.visibilityHandler) {
      document.removeEventListener('visibilitychange', SetupManager.visibilityHandler);
      SetupManager.visibilityHandler = null;
      console.log('[SetupManager] Visibility listener removido');
    }
    
    if (SetupManager.checkInterval) {
      clearInterval(SetupManager.checkInterval);
      SetupManager.checkInterval = null;
      console.log('[SetupManager] Polling interval removido');
    }
  }
}

window.NEXO_SetupManager = SetupManager;
