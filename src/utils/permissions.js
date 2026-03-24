/**
 * Permisos Service - Solicitud runtime de permisos BLE y Ubicación
 * v1.1 - Android 12+ compatible con mejor manejo de errores
 */

import { Capacitor } from '@capacitor/core';

export class PermissionsService {
  constructor() {
    this.platform = Capacitor.getPlatform();
    this.isNative = Capacitor.isNativePlatform();
    this.permissionStatus = {};
  }

  /**
   * Solicita todos los permisos necesarios para BLE/Nearby
   * Solo solicita si no están ya concedidos
   */
  async requestBLEPermissions() {
    if (!this.isNative) {
      console.log('[Permissions] Web platform - no runtime permissions needed');
      return true;
    }

    if (this.platform !== 'android') {
      // iOS maneja permisos BLE diferente (solicita automáticamente al usar BLE)
      return true;
    }

    try {
      console.log('[Permissions] Verificando estado de permisos...');
      
      // Primero verificar sin solicitar
      const currentStatus = await this.checkPermissions();
      
      // Si ya tenemos todos los críticos, no molestar al usuario
      if (currentStatus && 
          currentStatus.scan === 'granted' && 
          currentStatus.connect === 'granted' && 
          currentStatus.location === 'granted') {
        console.log('[Permissions] ✅ Permisos ya concedidos');
        return true;
      }

      // Importar dinámicamente el plugin de permisos
      const { Permissions } = await import('@capacitor/core');
      
      console.log('[Permissions] Solicitando permisos BLE...');

      const results = [];

      // Android 12+ (API 31+) permisos - Solicitar uno por uno para mejor UX
      
      // 1. BLUETOOTH_SCAN (crítico)
      if (currentStatus?.scan !== 'granted') {
        try {
          const scan = await Permissions.request({ name: 'BLUETOOTH_SCAN' });
          results.push({ name: 'BLUETOOTH_SCAN', state: scan.state });
          console.log('[Permissions] BLUETOOTH_SCAN:', scan.state);
        } catch (e) {
          console.warn('[Permissions] BLUETOOTH_SCAN error:', e);
          results.push({ name: 'BLUETOOTH_SCAN', state: 'denied' });
        }
      }

      // 2. BLUETOOTH_CONNECT (crítico)
      if (currentStatus?.connect !== 'granted') {
        try {
          const connect = await Permissions.request({ name: 'BLUETOOTH_CONNECT' });
          results.push({ name: 'BLUETOOTH_CONNECT', state: connect.state });
          console.log('[Permissions] BLUETOOTH_CONNECT:', connect.state);
        } catch (e) {
          console.warn('[Permissions] BLUETOOTH_CONNECT error:', e);
          results.push({ name: 'BLUETOOTH_CONNECT', state: 'denied' });
        }
      }

      // 3. ACCESS_FINE_LOCATION (siempre necesario para BLE en Android)
      if (currentStatus?.location !== 'granted') {
        try {
          const location = await Permissions.request({ name: 'ACCESS_FINE_LOCATION' });
          results.push({ name: 'ACCESS_FINE_LOCATION', state: location.state });
          console.log('[Permissions] LOCATION:', location.state);
        } catch (e) {
          console.warn('[Permissions] LOCATION error:', e);
          results.push({ name: 'ACCESS_FINE_LOCATION', state: 'denied' });
        }
      }

      // 4. BLUETOOTH_ADVERTISE (opcional pero recomendado)
      try {
        const advertise = await Permissions.request({ name: 'BLUETOOTH_ADVERTISE' });
        results.push({ name: 'BLUETOOTH_ADVERTISE', state: advertise.state });
        console.log('[Permissions] BLUETOOTH_ADVERTISE:', advertise.state);
      } catch (e) {
        console.warn('[Permissions] BLUETOOTH_ADVERTISE error:', e);
      }

      // 5. NEARBY_WIFI_DEVICES (para Nearby Connections - opcional)
      try {
        const wifi = await Permissions.request({ name: 'NEARBY_WIFI_DEVICES' });
        results.push({ name: 'NEARBY_WIFI_DEVICES', state: wifi.state });
        console.log('[Permissions] NEARBY_WIFI:', wifi.state);
      } catch (e) {
        console.warn('[Permissions] NEARBY_WIFI error:', e);
      }

      // Verificar si los críticos fueron concedidos
      const criticalResults = results.filter(r => 
        ['BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT', 'ACCESS_FINE_LOCATION'].includes(r.name)
      );
      
      const allCriticalGranted = criticalResults.length > 0 && criticalResults.every(r => r.state === 'granted');
      
      // Guardar estado
      this.permissionStatus = results.reduce((acc, r) => {
        acc[r.name] = r.state;
        return acc;
      }, {});

      if (!allCriticalGranted) {
        console.warn('[Permissions] ❌ Algunos permisos críticos fueron denegados:', results);
        return false;
      }

      console.log('[Permissions] ✅ Todos los permisos críticos concedidos');
      return true;

    } catch (err) {
      console.error('[Permissions] Error fatal solicitando permisos:', err);
      return false;
    }
  }

  /**
   * Verifica el estado actual de los permisos sin solicitarlos
   */
  async checkPermissions() {
    if (!this.isNative || this.platform !== 'android') {
      return {
        scan: 'granted',
        connect: 'granted',
        advertise: 'granted',
        location: 'granted'
      };
    }

    try {
      const { Permissions } = await import('@capacitor/core');
      
      const [scan, connect, advertise, location] = await Promise.all([
        Permissions.query({ name: 'BLUETOOTH_SCAN' }).catch(() => ({ state: 'denied' })),
        Permissions.query({ name: 'BLUETOOTH_CONNECT' }).catch(() => ({ state: 'denied' })),
        Permissions.query({ name: 'BLUETOOTH_ADVERTISE' }).catch(() => ({ state: 'denied' })),
        Permissions.query({ name: 'ACCESS_FINE_LOCATION' }).catch(() => ({ state: 'denied' }))
      ]);

      const status = {
        scan: scan.state,
        connect: connect.state,
        advertise: advertise.state,
        location: location.state
      };

      this.permissionStatus = status;
      console.log('[Permissions] Estado:', status);
      return status;

    } catch (err) {
      console.error('[Permissions] Error verificando:', err);
      return {
        scan: 'denied',
        connect: 'denied',
        advertise: 'denied',
        location: 'denied'
      };
    }
  }

  /**
   * Verifica si la ubicación está activada (requerido para BLE en Android)
   */
  async checkLocationEnabled() {
    if (!this.isNative || this.platform !== 'android') return true;

    try {
      // Intentar obtener posición - si falla, ubicación está apagada
      const { Geolocation } = await import('@capacitor/geolocation');
      await Geolocation.getCurrentPosition({ 
        enableHighAccuracy: false, 
        timeout: 3000 
      });
      return true;
    } catch (err) {
      console.warn('[Permissions] Ubicación desactivada o sin permiso:', err.message);
      return false;
    }
  }

  /**
   * Muestra diálogo nativo para activar ubicación (requiere plugin adicional)
   */
  async requestEnableLocation() {
    if (!this.isNative || this.platform !== 'android') return true;
    
    try {
      // Intentar abrir settings de ubicación
      const { App } = await import('@capacitor/app');
      console.log('[Permissions] Solicitando a usuario que active ubicación...');
      return false; // No podemos forzar, solo informar
    } catch (e) {
      return false;
    }
  }
}

export const permissionsService = new PermissionsService();
export default permissionsService;
