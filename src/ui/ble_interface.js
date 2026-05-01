/**
 * ble_interface.js v3.9.1-ARCH
 * 
 * FIX: Import corregido a @capacitor/core registerPlugin
 * FIX: Export agregado initBLEInterface (nexo_app.js lo importa)
 */

import { registerPlugin } from '@capacitor/core';

const NexoBle = registerPlugin('NexoBle');

let _scanCallback = null;
let _scanResults = new Map();
let _isScanning = false;
let _lastScanError = null;

const REM = {
  scanStart: (settings) => console.log(`[BLE_SCAN_START] Modo: ${settings.mode}, Filter: ${settings.filter}`),
  scanResult: (device) => console.log(`[BLE_SCAN_RESULT] ${device.name} [${device.address}] RSSI: ${device.rssi}`),
  scanFailed: (code, desc) => console.error(`[BLE_SCAN_FAILED] Code: ${code}, Desc: ${desc}`),
  scanStop: (count) => console.log(`[BLE_SCAN_STOP] Total encontrados: ${count}`),
  peerFound: (device) => console.log(`[BLE_PEER_FOUND] Peer validado: ${device.name} [${device.address}]`),
  advertState: (active) => console.log(`[BLE_ADVERT_STATE] Advertising: ${active}`),
  rateLimit: (waitMs) => console.warn(`[BLE_RATE_LIMIT] Throttle activo. Esperar: ${waitMs}ms`),
  serviceInit: (ver) => console.log(`[BLE_INIT] BleService ${ver} creado`),
  serviceDestroy: () => console.log(`[BLE_DESTROY] BleService destruido`),
  gattInit: (uuid) => console.log(`[BLE_GATT] GATT Server iniciado: ${uuid}`),
  messageReceived: (addr, msg) => console.log(`[BLE_MSG_RX] De ${addr}: ${msg.substring(0, 50)}...`),
};

export async function initBLEInterface() {
  console.log('[BLE_INIT] Inicializando BLE Interface v3.9.1-ARCH');
  
  NexoBle.addListener('onScanResult', (result) => {
    const device = {
      address: result.address,
      name: result.name || 'Dispositivo desconocido',
      rssi: result.rssi
    };
    _scanResults.set(device.address, device);
    REM.scanResult(device);
    if (_scanCallback) _scanCallback(device);
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

  return true;
}

export async function startBleScan(onDeviceFound, onError) {
  if (_isScanning) {
    console.warn('[BLE_SCAN] Ya escaneando.');
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

export async function startBleAdvertising(deviceName) {
  try {
    await NexoBle.startAdvertising({ deviceName });
    REM.advertState(true);
  } catch (err) {
    console.error('[BLE_ADVERT] Error:', err);
  }
}

export async function stopBleAdvertising() {
  try {
    await NexoBle.stopAdvertising();
    REM.advertState(false);
  } catch (err) {
    console.error('[BLE_ADVERT] Error:', err);
  }
}

export function renderBleMeshUI(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (_lastScanError) {
    const errorEl = container.querySelector('.scan-error');
    if (errorEl) {
      errorEl.textContent = `Error: ${_lastScanError.description} (code: ${_lastScanError.errorCode})`;
      errorEl.style.display = 'block';
    }
  }
}
