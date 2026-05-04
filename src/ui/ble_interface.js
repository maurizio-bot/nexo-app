/**
 * ble_interface.js v4.0.0-ARCH
 *
 * FIX BUG-003: Plugin name unificado a 'NexoBLE' (mayúsculas)
 * FIX BUG-002: Eventos DOM disparados para nexo_app.js
 * FIX BUG-004: Listeners de conexión agregados
 * FIX BUG-007: initBLEInterface sin parámetro confuso
 */

import { registerPlugin } from '@capacitor/core';

// FIX BUG-003: Unificado a 'NexoBLE' para coincidir con @CapacitorPlugin(name = "NexoBLE")
const NexoBLE = registerPlugin('NexoBLE');

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

// FIX BUG-007: Sin parámetro confuso. La app llama initBLEInterface() sin argumentos.
export async function initBLEInterface() {
  console.log('[BLE_INIT] Inicializando BLE Interface v4.0.0-ARCH');

  NexoBLE.addListener('onScanResult', (result) => {
    const device = {
      address: result.address || result.deviceId,
      name: result.name || 'Dispositivo desconocido',
      rssi: result.rssi
    };
    _scanResults.set(device.address, device);
    REM.scanResult(device);
    if (_scanCallback) _scanCallback(device);
  });

  NexoBLE.addListener('onScanFailed', (error) => {
    _isScanning = false;
    _lastScanError = error;
    REM.scanFailed(error.errorCode, error.description);
  });

  NexoBLE.addListener('onScanStopped', (data) => {
    _isScanning = false;
    REM.scanStop(data.resultCount);
  });

  NexoBLE.addListener('onAdvertStateChange', (data) => {
    REM.advertState(data.advertising);
  });

  // FIX BUG-002: Disparar evento DOM para que nexo_app.js reciba mensajes BLE
  NexoBLE.addListener('onMessageReceived', (data) => {
    REM.messageReceived(data.address, data.message);

    window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
      detail: {
        deviceId: data.address || data.deviceId,
        content: data.content || data.message || data.data || '',
        senderName: data.senderName || 'NEXO Peer',
        messageId: data.messageId || null,
        source: data.source || 'ble_direct',
        timestamp: data.timestamp || Date.now()
      }
    }));
  });

  // FIX BUG-004: Listeners de conexión para feedback visual
  NexoBLE.addListener('onDeviceConnected', (data) => {
    console.log('[BLE_CONN] Device connected:', data.deviceId, data.direction);
    window.dispatchEvent(new CustomEvent('nexo:ble:deviceConnected', {
      detail: {
        deviceId: data.deviceId,
        direction: data.direction || 'unknown'
      }
    }));
  });

  NexoBLE.addListener('onDeviceDisconnected', (data) => {
    console.log('[BLE_CONN] Device disconnected:', data.deviceId);
    window.dispatchEvent(new CustomEvent('nexo:ble:deviceDisconnected', {
      detail: {
        deviceId: data.deviceId,
        wasReady: data.wasReady || false
      }
    }));
  });

  NexoBLE.addListener('onServicesReady', (data) => {
    console.log('[BLE_CONN] Services ready:', data.deviceId);
    window.dispatchEvent(new CustomEvent('nexo:ble:servicesReady', {
      detail: {
        deviceId: data.deviceId,
        ready: data.ready || false
      }
    }));
  });

  NexoBLE.addListener('onConnectionFailed', (data) => {
    console.error('[BLE_CONN] Connection failed:', data.deviceId, data.reason);
    window.dispatchEvent(new CustomEvent('nexo:ble:connectionFailed', {
      detail: {
        deviceId: data.deviceId,
        reason: data.reason || 'Unknown',
        attempt: data.attempt || 0
      }
    }));
  });

  NexoBLE.addListener('onMessageSent', (data) => {
    console.log('[BLE_MSG] Message sent:', data.messageId, data.success);
    window.dispatchEvent(new CustomEvent('nexo:ble:messageSent', {
      detail: {
        deviceId: data.deviceId,
        messageId: data.messageId,
        success: data.success || false
      }
    }));
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
    await NexoBLE.startScan();
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
    await NexoBLE.stopScan();
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
    await NexoBLE.startAdvertising({ deviceName });
    REM.advertState(true);
  } catch (err) {
    console.error('[BLE_ADVERT] Error:', err);
  }
}

export async function stopBleAdvertising() {
  try {
    await NexoBLE.stopAdvertising();
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
