/**
 * FIX v1.5.2: Agregada verificación post-permisos de estado Bluetooth
 * Si permisos concedidos pero BT apagado, devuelve flag para mostrar pantalla BT
 */

// ... (todo el código existente hasta línea 64 se mantiene intacto) ...

    if (result.allGranted) {
      // FIX v1.5.2: Verificar estado Bluetooth tras conceder permisos
      const btCheck = await NexoBLE.isBluetoothEnabled();
      console.log(`${NAP_CODES.ANDROID_NATIVE} Post-perm check - BT State:`, btCheck.stateName);
      
      if (!btCheck.enabled) {
        return { 
          granted: true, // Permisos SÍ concedidos
          permissionsGranted: true,
          bluetoothEnabled: false,
          needsBluetoothOn: true, // ← Flag crítico para SetupWizard
          platform: 'android-native',
          nap_code: 'PERM_OK_BT_OFF'
        };
      }
      
      return { 
        granted: true, 
        platform: 'android-native',
        nap_verified: true,
        permissions: result.permissions,
        bluetoothEnabled: true,
        nap_code: 'PERM_GRANTED'
      };
    }

// ... (resto del archivo sin cambios) ...
