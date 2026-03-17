/**
 * BLE Permissions Manager para Android 12+
 * Solicita permisos en tiempo de ejecución
 */

export async function requestBLEPermissions() {
  if (typeof navigator === 'undefined' || !navigator.permissions) {
    return { granted: true, platform: 'web' };
  }

  const requiredPermissions = [];
  
  // Android 12+ (API 31+) requiere estos permisos específicos
  if (navigator.userAgent.includes('Android')) {
    try {
      // Verificar si tenemos el plugin de Capacitor
      const { Permissions } = await import('@capacitor/core');
      
      const permissions = [
        'BLUETOOTH_SCAN',
        'BLUETOOTH_CONNECT', 
        'ACCESS_FINE_LOCATION'
      ];
      
      for (const permission of permissions) {
        const result = await Permissions.query({ name: permission });
        if (result.state !== 'granted') {
          requiredPermissions.push(permission);
        }
      }
      
      if (requiredPermissions.length > 0) {
        // Solicitar permisos faltantes
        const results = await Promise.all(
          requiredPermissions.map(p => Permissions.request({ name: p }))
        );
        
        const allGranted = results.every(r => r.state === 'granted');
        return { 
          granted: allGranted, 
          permissions: requiredPermissions,
          results 
        };
      }
      
      return { granted: true, alreadyHad: true };
      
    } catch (e) {
      console.warn('[BLE-Permissions] Plugin Capacitor no disponible:', e);
      // Fallback: asumir concedido en web
      return { granted: true, fallback: true };
    }
  }
  
  return { granted: true, platform: 'desktop' };
}

export async function checkBLEStatus() {
  try {
    const { BluetoothLe } = await import('@capacitor-community/bluetooth-le');
    const isEnabled = await BluetoothLe.isEnabled();
    return { available: true, enabled: isEnabled.value };
  } catch (e) {
    return { available: false, error: e.message };
  }
}
