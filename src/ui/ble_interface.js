/**
 * ble_interface.js v3.9-ARCH
 * 
 * FIXES:
 * - REM obsoletos eliminados (Vault, Setup, Init generales)
 * - REM nuevos para monitoreo completo de escaneo BLE
 * - Integración con onScanFailed para feedback de errores
 */

import { NexoBle } from '@capacitor-community/bluetooth-le'; // o tu import real

let _scanCallback = null;
let _scanResults = new Map();
let _isScanning = false;
let _lastScanError = null;

// ==================== REM LOGGER ====================

const REM = {
  // NUEVOS: Escaneo BLE (lo que pediste)
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
  
  // ELIMINADOS (obsoletos, ya funcionan estables):
  // [VAULT_INIT_START], [VAULT_INIT_SUCCESS], [CRYPTO_002]
  // [SETUP_CHECK], [SETUP_REQUIRED], [NEXO_INIT], [APP_INIT]
};

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
    // Registrar listeners nativos
    NexoBle.addListener('onScanResult', (result) => {
      const device = {
        address: result.address,
        name: result.name || 'Dispositivo desconocido',
        rssi: result.rssi
      };
      
      _scanResults.set(device.address, device);
      REM.scanResult(device);
      
      // Validar si es peer NEXO (puedes agregar lógica de filtro adicional aquí)
      if (isNexoPeer(device)) {
        REM.peerFound(device);
        onDeviceFound?.(device);
      }
    });

    NexoBle.addListener('onScanFailed', (error) => {
      _isScanning = false;
      _lastScanError = error;
      REM.scanFailed(error.errorCode, error.description);
      onError?.(error);
    });

    NexoBle.addListener('onScanStopped', (data) => {
      _isScanning = false;
      REM.scanStop(data.resultCount);
    });

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
  // Filtro adicional por software si es necesario
  // Por ahora, cualquier dispositivo con nuestro Service UUID ya pasó el filtro nativo
  return true;
}

// ==================== UI INTEGRATION ====================

export function renderBleMeshUI(containerId) {
  // Tu lógica de renderizado actual...
  // Asegúrate de mostrar _lastScanError en la UI si existe
  const container = document.getElementById(containerId);
  if (!container) return;
  
  // Ejemplo: mostrar error de scan en UI
  if (_lastScanError) {
    const errorEl = container.querySelector('.scan-error');
    if (errorEl) {
      errorEl.textContent = `Error de escaneo: ${_lastScanError.description} (code: ${_lastScanError.errorCode})`;
      errorEl.style.display = 'block';
    }
  }
}
