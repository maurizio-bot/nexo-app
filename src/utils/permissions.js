/**
 * Permisos Service - Solicitud runtime de permisos BLE y Ubicación
 * v1.0 - Android 12+ compatible
 */

import { Capacitor } from '@capacitor/core';

export class PermissionsService {
  constructor() {
    this.platform = Capacitor.getPlatform();
    this.isNative = Capacitor.isNativePlatform();
    this.cachedPermissions = {};
  }

  /**
   * Solicita todos los permisos necesarios para BLE/Nearby
   */
  async requestBLEPermissions() {
    if (!this.isNative) {
      console.log('[Permissions] Web platform - no runtime permissions needed');
      return true;
    }

    try {
      // Importar dinámicamente el plugin de permisos
      const { Permissions } = await import('@capacitor/core');
      
      console.log('[Permissions] Solicitando permisos BLE...');

      const results = [];

      // Android 12+ (API 31+) permisos
      if (this.platform === 'android') {
        // 1. BLUETOOTH_SCAN
        try {
          const scan = await Permissions.request({ name: 'BLUETOOTH_SCAN' });
          results.push({ name: 'BLUETOOTH_SCAN', state: scan.state });
          console.log('[Permissions] BLUETOOTH_SCAN:', scan.state);
        } catch (e) {
          console.warn('[Permissions] BLUETOOTH_SCAN error:', e);
        }

        // 2. BLUETOOTH_CONNECT
        try {
          const connect = await Permissions.request({ name: 'BLUETOOTH_CONNECT' });
          results.push({ name: 'BLUETOOTH_CONNECT', state: connect.state });
          console.log('[Permissions] BLUETOOTH_CONNECT:', connect.state);
        } catch (e) {
          console.warn('[Permissions] BLUETOOTH_CONNECT error:', e);
        }

        // 3. BLUETOOTH_ADVERTISE
        try {
          const advertise = await Permissions.request({ name: 'BLUETOOTH_ADVERTISE' });
          results.push({ name: 'BLUETOOTH_ADVERTISE', state: advertise.state });
          console.log('[Permissions] BLUETOOTH_ADVERTISE:', advertise.state);
        } catch (e) {
          console.warn('[Permissions] BLUETOOTH_ADVERTISE error:', e);
        }

        // 4. ACCESS_FINE_LOCATION (siempre necesario para BLE)
        try {
          const location = await Permissions.request({ name: 'ACCESS_FINE_LOCATION' });
          results.push({ name: 'ACCESS_FINE_LOCATION', state: location.state });
          console.log('[Permissions] LOCATION:', location.state);
        } catch (e) {
          console.warn('[Permissions] LOCATION error:', e);
        }

        // 5. NEARBY_WIFI_DEVICES (para Nearby Connections)
        try {
          const wifi = await Permissions.request({ name: 'NEARBY_WIFI_DEVICES' });
          results.push({ name: 'NEARBY_WIFI_DEVICES', state: wifi.state });
          console.log('[Permissions] NEARBY_WIFI:', wifi.state);
        } catch (e) {
          console.warn('[Permissions] NEARBY_WIFI error:', e);
        }
      }

      // Verificar si los críticos fueron concedidos
      const criticalGranted = results.filter(r => 
        ['BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT', 'ACCESS_FINE_LOCATION'].includes(r.name)
      ).every(r => r.state === 'granted');

      if (!criticalGranted) {
        console.warn('[Permissions] ALGUNOS PERMISOS FUERON DENEGADOS:', results);
        return false;
      }

      console.log('[Permissions] ✅ Todos los permisos concedidos');
      return true;

    } catch (err) {
      console.error('[Permissions] Error solicitando permisos:', err);
      return false;
    }
  }

  /**
   * Verifica el estado actual de los permisos sin solicitarlos
   */
  async checkPermissions() {
    if (!this.isNative) return true;

    try {
      const { Permissions } = await import('@capacitor/core');
      
      const results = await Promise.allSettled([
        Permissions.query({ name: 'BLUETOOTH_SCAN' }),
        Permissions.query({ name: 'BLUETOOTH_CONNECT' }),
        Permissions.query({ name: 'BLUETOOTH_ADVERTISE' }),
        Permissions.query({ name: 'ACCESS_FINE_LOCATION' })
      ]);

      const status = {
        scan: results[0].value?.state || 'denied',
        connect: results[1].value?.state || 'denied',
        advertise: results[2].value?.state || 'denied',
        location: results[3].value?.state || 'denied'
      };

      console.log('[Permissions] Estado actual:', status);
      return status;

    } catch (err) {
      console.error('[Permissions] Error verificando:', err);
      return null;
    }
  }

  /**
   * Verifica si la ubicación está activada (requerido para BLE en Android)
   */
  async checkLocationEnabled() {
    if (!this.isNative || this.platform !== 'android') return true;

    try {
      // Intentar importar el plugin de geolocalización
      const { Geolocation } = await import('@capacitor/geolocation');
      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 5000 });
      return true;
    } catch (err) {
      console.warn('[Permissions] Ubicación puede estar desactivada:', err.message);
      return false;
    }
  }
}

export const permissionsService = new PermissionsService();
export default permissionsService;

