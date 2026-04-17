/**
 * NEXO Setup Manager v1.4-NAP
 * Onboarding para BLE Android 14 (API 34+)
 * Persistencia: localStorage (nativo, sin plugins externos)
 * NAP 2.0 Certified - Resource Management & Graceful Degradation
 */

import { Capacitor } from '@capacitor/core';
import { checkBLEStatus } from './ble_permissions.js';

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
      // NAP: Log diagnóstico
      console.log('[SetupManager] NAP 2.0 - Verificando estado de configu...');
      
      const completedBefore = localStorage.getItem(STORAGE_KEYS.SETUP_COMPLETED) === 'true';
      
      if (!completedBefore) {
        console.log('[SetupManager] NAP: Setup requerido - primera vez');
        return { 
          ready: false, 
          reason: 'permissions',
          isFirstTime: true 
        };
      }

      // NAP FIX v1.4: Verificación REAL del sistema aunque el flag exista
      // Esto detecta permisos revocados manualmente o BT apagado
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
        return { 
          ready: false, 
          reason: 'bluetooth',
          isFirstTime: false 
        };
      }
      
      // Si faltan permisos (revocados o denegados)
      if (bleStatus.stateName === 'NO_PERMISSION' || !bleStatus.granted) {
        console.log('[SetupManager] NAP: Permisos faltantes - requiere re-setup');
        return { 
          ready: false, 
          reason: 'permissions',
          isFirstTime: false 
        };
      }

      // Fallback seguro
      console.warn('[SetupManager] NAP: Estado indeterminado, requiere verificación');
      return { 
        ready: false, 
        reason: 'bluetooth',
        isFirstTime: false 
      };

    } catch (error) {
      // NAP: Error graceful
      console.error('[SetupManager] NAP Error Recovery:', error);
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
      console.log('[SetupManager] NAP: Setup completado');
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
   * NAP: Graceful fallback
   */
  static async openAppSettings() {
    try {
      const { App } = await import('@capacitor/app');
      await App.openUrl({ url: 'app-settings:' });
      console.log('[SetupManager] NAP: Configuración abierta');
    } catch (e) {
      // NAP Fallback
      console.warn('[SetupManager] NAP Fallback: Usando alert manual');
      alert('Ve a Configuración > Aplicaciones > NEXO > Permisos\nActiva "Dispositivos cercanos" y "Bluetooth"');
    }
  }

  /**
   * Abrir configuración de Bluetooth
   * NAP: Deep link con fallback
   */
  static async openBluetoothSettings() {
    try {
      const { App } = await import('@capacitor/app');
      
      if (Capacitor.getPlatform() === 'android') {
        await App.openUrl({ url: 'intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end' });
        console.log('[SetupManager] NAP: Bluetooth settings abierto');
      }
    } catch (e) {
      console.warn('[SetupManager] NAP Fallback:', e);
      alert('Por favor abre Configuración > Bluetooth y actívalo manualmente');
    }
  }
}
