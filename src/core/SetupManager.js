/**
 * NEXO Setup Manager v2.0-NAP-PROD
 * Onboarding para BLE Android 14 (API 34+)
 * Persistencia: localStorage (nativo, sin plugins externos)
 * NAP 2.0 Certified - Resource Management & Graceful Degradation
 * 
 * v2.0: Agregado auto-verificación en resume + detección permisos en caliente
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { checkBLEStatus } from './ble_permissions.js';

// Import dinámico de App para listeners de ciclo de vida
let App = null;
if (Capacitor.getPlatform() === 'android') {
  try {
    App = (await import('@capacitor/app')).App;
  } catch (e) {
    console.warn('[SetupManager] NAP: @capacitor/app no disponible, modo degradado');
  }
}

const STORAGE_KEYS = {
  SETUP_COMPLETED: 'nexo_setup_v1_completed',
  PERMISSION_DENIED_COUNT: 'nexo_perm_denied_count',
  LAST_CHECK: 'nexo_last_system_check',
  AWAITING_SETTINGS_RETURN: 'nexo_awaiting_settings_return'
};

export class SetupManager {
  static resumeListener = null;
  static isAwaitingSettingsReturn = false;

  static async checkInitialStatus() {
    if (Capacitor.getPlatform() !== 'android') {
      return { ready: true, reason: null, isFirstTime: false };
    }

    try {
      console.log('[SetupManager] NAP 2.0 - Verificando estado de configuración...');
      
      const completedBefore = localStorage.getItem(STORAGE_KEYS.SETUP_COMPLETED) === 'true';
      
      if (!completedBefore) {
        console.log('[SetupManager] NAP: Setup requerido - primera vez');
        SetupManager.setupResumeListener();
        return { 
          ready: false, 
          reason: 'permissions',
          isFirstTime: true 
        };
      }

      // NAP FIX v2.0: Verificación REAL del sistema aunque el flag exista
      console.log('[SetupManager] NAP: Configuración ya completada - Verificando estado REAL...');
      const bleStatus = await checkBLEStatus();
      console.log('[SetupManager] NAP: Estado BLE real:', bleStatus.nap_code, bleStatus);
      
      // Si todo está realmente OK (permisos + BT encendido), proceder
      if (bleStatus.granted === true) {
        const lastCheck = parseInt(localStorage.getItem(STORAGE_KEYS.LAST_CHECK) || '0');
        const oneDayMs = 24 * 60 * 60 * 1000;
        
        if (Date.now() - lastCheck > oneDayMs) {
          localStorage.setItem(STORAGE_KEYS.LAST_CHECK, Date.now().toString());
          console.log('[SetupManager] NAP: Timestamp actualizado');
        }

        console.log('[SetupManager] NAP: Sistema validado');
        return { ready: true, reason: null, isFirstTime: false };
      }
      
      // Si BT está apagado pero permisos existen
      if (bleStatus.bluetoothEnabled === false || bleStatus.stateName === 'OFF') {
        console.log('[SetupManager] NAP: BT apagado detectado - requiere activación');
        SetupManager.setupResumeListener();
        return { 
          ready: false, 
          reason: 'bluetooth',
          isFirstTime: false 
        };
      }
      
      // Si faltan permisos (revocados o denegados)
      if (bleStatus.stateName === 'NO_PERMISSION' || !bleStatus.granted) {
        console.log('[SetupManager] NAP: Permisos faltantes - requiere re-setup');
        SetupManager.setupResumeListener();
        return { 
          ready: false, 
          reason: 'permissions',
          isFirstTime: false 
        };
      }

      // Fallback seguro
      console.warn('[SetupManager] NAP: Estado indeterminado, requiere verificación');
      SetupManager.setupResumeListener();
      return { 
        ready: false, 
        reason: 'bluetooth',
        isFirstTime: false 
      };

    } catch (error) {
      console.error('[SetupManager] NAP Error Recovery:', error);
      SetupManager.setupResumeListener();
      return { 
        ready: false, 
        reason: 'error',
        isFirstTime: true,
        error: error.message 
      };
    }
  }

  /**
   * NUEVO v2.0: Configurar listener de resume para auto-verificación
   * Se activa cuando el usuario regresa de Settings manuales
   */
  static setupResumeListener() {
    if (!App || SetupManager.resumeListener) return;
    
    SetupManager.resumeListener = App.addListener('resume', async () => {
      console.log('[SetupManager] NAP: App resumida - verificando si venimos de Settings...');
      
      const wasAwaiting = localStorage.getItem(STORAGE_KEYS.AWAITING_SETTINGS_RETURN) === 'true';
      const deniedCount = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
      
      if (wasAwaiting || deniedCount > 0) {
        // Limpiar flag de espera
        localStorage.removeItem(STORAGE_KEYS.AWAITING_SETTINGS_RETURN);
        SetupManager.isAwaitingSettingsReturn = false;
        
        // Verificar estado actual REAL
        console.log('[SetupManager] NAP: Re-verificando permisos post-Settings...');
        const currentStatus = await SetupManager.checkPermissionsRealtime();
        
        if (currentStatus.granted) {
          console.log('[SetupManager] NAP: Permisos concedidos desde Settings!');
          // Notificar a la UI mediante evento global
          window.dispatchEvent(new CustomEvent('nexo-permissions-granted', {
            detail: { source: 'settings_return', timestamp: Date.now() }
          }));
        } else {
          console.log('[SetupManager] NAP: Permisos aún faltantes post-Settings');
          window.dispatchEvent(new CustomEvent('nexo-permissions-denied', {
            detail: { source: 'settings_return', timestamp: Date.now() }
          }));
        }
      }
    });
    
    console.log('[SetupManager] NAP: Resume listener activado');
  }

  /**
   * NUEVO v2.0: Verificación REAL de permisos sin cache
   * Usa el plugin nativo directamente para evitar falsos positivos
   */
  static async checkPermissionsRealtime() {
    try {
      const { NexoBLE } = window.Capacitor.Plugins;
      if (!NexoBLE) {
        return { granted: false, error: 'Plugin no disponible' };
      }
      
      const result = await NexoBLE.isBluetoothEnabled();
      
      // Verificación estricta: necesitamos ENABLED + Permisos
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
      console.error('[SetupManager] NAP Error en checkPermissionsRealtime:', e);
      return { granted: false, error: e.message };
    }
  }

  /**
   * NUEVO v2.0: Marcar que estamos esperando retorno de Settings
   */
  static async markAwaitingSettingsReturn() {
    localStorage.setItem(STORAGE_KEYS.AWAITING_SETTINGS_RETURN, 'true');
    SetupManager.isAwaitingSettingsReturn = true;
    SetupManager.setupResumeListener(); // Asegurar que el listener está activo
    console.log('[SetupManager] NAP: Marcado AWAITING_SETTINGS_RETURN');
  }

  static async markCompleted() {
    try {
      localStorage.setItem(STORAGE_KEYS.SETUP_COMPLETED, 'true');
      localStorage.setItem(STORAGE_KEYS.LAST_CHECK, Date.now().toString());
      localStorage.removeItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT);
      localStorage.removeItem(STORAGE_KEYS.AWAITING_SETTINGS_RETURN);
      console.log('[SetupManager] NAP: Setup completado y limpiado');
      return true;
    } catch (e) {
      console.error('[SetupManager] NAP Error:', e);
      return false;
    }
  }

  static async shouldGoToSettings() {
    try {
      const deniedCount = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
      console.log(`[SetupManager] NAP: Intentos fallidos = ${deniedCount}`);
      return deniedCount >= 2;
    } catch (e) {
      console.error('[SetupManager] NAP Error:', e);
      return false;
    }
  }

  static async recordPermissionDenied() {
    try {
      const current = parseInt(localStorage.getItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT) || '0');
      const newCount = current + 1;
      localStorage.setItem(STORAGE_KEYS.PERMISSION_DENIED_COUNT, newCount.toString());
      console.log(`[SetupManager] NAP: Denegación registrada (total ${newCount})`);
      return newCount;
    } catch (e) {
      console.error('[SetupManager] NAP Error:', e);
      return 1;
    }
  }

  /**
   * Abrir configuración de la app
   * NAP: Ahora marca el estado de espera para detección automática al volver
   */
  static async openAppSettings() {
    try {
      await SetupManager.markAwaitingSettingsReturn();
      
      const { App } = await import('@capacitor/app');
      await App.openUrl({ url: 'app-settings:' });
      console.log('[SetupManager] NAP: Configuración abierta, modo awaiting activo');
    } catch (e) {
      console.warn('[SetupManager] NAP Fallback: Usando alert manual');
      alert('Ve a Configuración > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
    }
  }

  /**
   * Abrir configuración de Bluetooth
   * NAP: Deep link con fallback y marca de espera
   */
  static async openBluetoothSettings() {
    try {
      await SetupManager.markAwaitingSettingsReturn();
      
      const { App } = await import('@capacitor/app');
      
      if (Capacitor.getPlatform() === 'android') {
        await App.openUrl({ url: 'intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end' });
        console.log('[SetupManager] NAP: Bluetooth settings abierto, modo awaiting activo');
      }
    } catch (e) {
      console.warn('[SetupManager] NAP Fallback:', e);
      alert('Por favor abre Configuración > Bluetooth y actívalo manualmente');
    }
  }

  /**
   * Cleanup: Remover listeners cuando ya no se necesiten
   */
  static cleanup() {
    if (SetupManager.resumeListener) {
      SetupManager.resumeListener.remove();
      SetupManager.resumeListener = null;
      console.log('[SetupManager] NAP: Resume listener removido');
    }
  }
}

window.NEXO_SetupManager = SetupManager;
