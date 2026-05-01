/**
 * ble_interface.js v3.9.1-ARCH — FIX BUILD #1015
 * 
 * FIXES:
 * 1. Agregado export initBLEInterface (nexo_app.js lo importa)
 * 2. Import corregido: registerPlugin('NexoBle') desde @capacitor/core
 *    (eliminado @capacitor-community/bluetooth-le que no existe)
 */

import { registerPlugin } from '@capacitor/core';

// Plugin BLE propio de NEXO
const NexoBle = registerPlugin('NexoBle');

let _scanCallback = null;
let _scanResults = new Map();
let _isScanning = false;
let _lastScanError = null;

// ==================== REM LOGGER ====================

const REM = {
  // NUEVOS: Escaneo BLE
  scanStart: (settings) => console.log(`[BLE_SCAN_START] Modo: ${settings.mode}, Filter: ${settings.filter}`),
  scanResult: (device) => console.log(`[BLE_SCAN_RESULT] ${device.name} [${device.address}] RSSI: ${device.rssi}`),
  scanFailed: (code, desc) => console.error(`[BLE_SCAN_FAILED] Code: ${code}, Desc: ${desc}`),
  scanStop: (count) => console.log(`[BLE_SCAN_STOP] Total encontrados: ${count}`),
  peerFound: (device) => console.log(`[BLE_PEER_FOUND] Peer validado: ${device.name} [${device.address}]`),
  advertState: (active) => console.log(`[BLE_ADVERT_STATE] Advertising: ${active}`),
  rateLimit: (waitMs) => console.warn(`[BLE_RATE_LIMIT] Throttle activo. Esperar: ${waitMs}ms`),
  
  // Mantenidos: Estados críticos de BLE
  serviceInit: (ver) => console.log(`[BLE_INIT] BleService ${ver} creado`),
  serviceDestroy: () => console.log(`[BLE_DESTROY] BleService destruido`),
  gattInit: (uuid) => console.log(`[BLE_GATT] GATT Server iniciado: ${uuid}`),
  messageReceived: (addr, msg) => console.log(`[BLE_MSG_RX] De ${addr}: ${msg.substring(0, 50)}...`),
};

// ==================== INIT (FIX BUILD #1015) ====================

/**
 * FIX BUILD #1015: nexo_app.js importa esta función.
 * Inicializa el módulo BLE y registra listeners nativos.
 */
export async function initBLEInterface() {
  console.log('[BLE_INIT] Inicializando BLE Interface v3.9.1-ARCH');
  
  // Registrar listeners nativos del plugin
  NexoBle.addListener('onScanResult', (result) => {
    const device = {
      address: result.address,
      name: result.name || 'Dispositivo desconocido',
      rssi: result.rssi
    };
    
    _scanResults.set(device.address, device);
    REM.scanResult(device);
    
    if (isNexoPeer(device)) {
      REM.peerFound(device);
      _scanCallback?.(device);
    }
  });

  NexoBle.addListener('onScanFailed', (error) => {
    _isScanning = false;
    _lastScanError = error;
    REM.scanFailed(error.errorCode, error.description);
  });

  NexoBle.addListener('onScanStopped', (data) => {
    _isScanning = false;
    REM.scanStop(data.resultCount);
  });

  NexoBle.addListener('onAdvertStateChange', (data) => {
    REM.advertState(data.advertising);
  });

  NexoBle.addListener('onMessageReceived', (data) => {
    REM.messageReceived(data.address, data.message);
  });

  console.log('[BLE_INIT] Listeners nativos registrados');
  return true;
}

// ==================== SCAN CONTROL ====================

export async function startBleScan(onDeviceFound, onError) {
  if (_isScanning) {
    console.warn('[BLE_SCAN] Ya escaneando. Ignorando solicitud duplicada.');
    return;
  }

  _scanResults.clear();
  _lastScanError = null;
  _scanCallback = onDeviceFound;
  
  try {
    await NexoBle.startScan();
    _isScanning = true;
    REM.scanStart({ mode: 'LOW_LATENCY', filter: 'SERVICE_UUID' });
    
  } catch (err) {
    _isScanning = false;
    REM.scanFailed(-999, err.message);
    onError?.({ errorCode: -999, description: err.message });
  }
}

export async function stopBleScan() {
  if (!_isScanning) return;
  
  try {
    await NexoBle.stopScan();
    // _isScanning se pone false en el listener onScanStopped
  } catch (err) {
    console.error('[BLE_SCAN_STOP] Error:', err);
  }
}

export function isScanning() {
  return _isScanning;
}

export function getLastScanError() {
  return _lastScanError;
}

export function getScanResults() {
  return Array.from(_scanResults.values());
}

// ==================== ADVERTISING ====================

export async function startBleAdvertising(deviceName) {
  try {
    await NexoBle.startAdvertising({ deviceName });
    REM.advertState(true);
  } catch (err) {
    console.error('[BLE_ADVERT] Error iniciando advertising:', err);
  }
}

export async function stopBleAdvertising() {
  try {
    await NexoBle.stopAdvertising();
    REM.advertState(false);
  } catch (err) {
    console.error('[BLE_ADVERT] Error deteniendo advertising:', err);
  }
}

// ==================== UTILS ====================

function isNexoPeer(device) {
  return true;
}

// ==================== UI INTEGRATION ====================

export function renderBleMeshUI(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (_lastScanError) {
    const errorEl = container.querySelector('.scan-error');
    if (errorEl) {
      errorEl.textContent = `Error de escaneo: ${_lastScanError.description} (code: ${_lastScanError.errorCode})`;
      errorEl.style.display = 'block';
    }
  }
}
