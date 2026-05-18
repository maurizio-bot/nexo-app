/**
 * main.js v9.1-961-FIX
 * Ultra-defensivo. Compatible con NEXO build #961 nativo.
 * NO importa SetupManager, SetupWizard, ni ble_permissions.js.
 * Habla DIRECTAMENTE con NexoBLE plugin nativo.
 */

(function() {
  'use strict';

  const TAG = '[NEXO-main]';
  const LOG_MAX = 100;
  const logs = [];

  function screenLog(msg) {
    const line = `${new Date().toLocaleTimeString()} ${msg}`;
    logs.push(line);
    if (logs.length > LOG_MAX) logs.shift();
    console.log(TAG, line);
    
    const el = document.getElementById('screen-log');
    if (el) {
      el.textContent = logs.join('\n');
      el.scrollTop = el.scrollHeight;
    }
  }

  async function initNexo() {
    screenLog('=== NEXO iniciando ===');

    // 1. Verificar Capacitor nativo
    const hasCapacitor = (
      typeof window !== 'undefined' && 
      window.Capacitor && 
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform()
    );
    
    if (!hasCapacitor) {
      screenLog('Modo web/browser. BLE no disponible.');
      initUI();
      return;
    }

    // 2. Obtener plugin nativo (defensivo: puede no existir si build falló)
    const plugin = window.Capacitor.Plugins?.NexoBLE;
    if (!plugin) {
      screenLog('FATAL: Plugin NexoBLE no cargado. ¿Build nativo correcto?');
      initUI();
      return;
    }

    screenLog('Plugin NexoBLE detectado.');

    // 3. Verificar estado de permisos (con timeout de seguridad 5s)
    let status = { allGranted: false, scan: 'unknown', connect: 'unknown', advertise: 'unknown' };
    try {
      const statusPromise = plugin.checkBLEStatus();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout checkBLEStatus')), 5000)
      );
      status = await Promise.race([statusPromise, timeoutPromise]);
      screenLog('BLE status: ' + JSON.stringify(status));
    } catch (e) {
      screenLog('Error checkBLEStatus: ' + e.message);
      status = { allGranted: false };
    }

    // 4. Si no tiene permisos, solicitar via plugin nativo
    if (!status.allGranted) {
      screenLog('Permisos pendientes. Solicitando...');
      try {
        await plugin.initializeBLE();
        screenLog('initializeBLE() ejecutado. Esperando respuesta usuario...');
      } catch (e) {
        screenLog('Error initializeBLE: ' + e.message);
      }
    } else {
      screenLog('Permisos BLE OK. Iniciando stack...');
      startBleStack(plugin);
    }

    // 5. Escuchar evento nativo de cambio de permisos
    try {
      plugin.addListener('onPermissionStatusChanged', (result) => {
        screenLog('onPermissionStatusChanged: ' + JSON.stringify(result));
        if (result && result.allGranted === true) {
          screenLog('Permisos concedidos. Arrancando BLE...');
          startBleStack(plugin);
        } else if (result && result.allGranted === false) {
          screenLog('Permisos DENEGADOS. BLE no funcionara.');
        }
      });
    } catch (e) {
      screenLog('Error listener onPermissionStatusChanged: ' + e.message);
    }

    // 6. Diagnostico: escuchar eventos nativos de #961
    const diagEvents = [
      'onAdvertiseStarted', 'onServerReady', 'onScanFailed', 
      'onAdvertiseFailed', 'onDeviceConnected', 'onDeviceDisconnected'
    ];
    diagEvents.forEach(evt => {
      try {
        plugin.addListener(evt, (data) => {
          screenLog(`${evt}: ${JSON.stringify(data || {})}`);
        });
      } catch (e) { /* Silencioso: evento puede no existir en version menor */ }
    });

    // 7. UI siempre inicializada, independiente de BLE
    initUI();
  }

  function startBleStack(plugin) {
    screenLog('startBleStack()');
    
    // Conectar con nexo_app.js
    if (window.NexoApp && typeof window.NexoApp.init === 'function') {
      try {
        window.NexoApp.init(plugin);
        screenLog('NexoApp.init() OK');
      } catch (e) {
        screenLog('Error NexoApp.init(): ' + e.message);
      }
    } else {
      screenLog('NexoApp no disponible. Fallback directo a plugin.');
      try {
        plugin.addListener('onDeviceFound', (device) => {
          screenLog(`Device: ${device.name || 'SinNombre'} [${device.address}] RSSI:${device.rssi || 0}`);
        });
      } catch (e) {
        screenLog('Error fallback onDeviceFound: ' + e.message);
      }
    }
  }

  function initUI() {
    screenLog('UI inicializada.');
    // Tu logica de UI aqui
  }

  // Arrancar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNexo);
  } else {
    initNexo();
  }
})();
