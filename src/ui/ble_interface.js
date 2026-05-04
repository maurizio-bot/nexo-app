/**
 * ble_interface.js v4.1.0-ARCH
 * Bridge robusto entre plugin nativo NexoBLE y UI.
 * FIX: Listener directo garantizado, fallback nativo si bridge falla.
 */

let plugin = null;
let scanListener = null;
let messageListener = null;
let deviceConnectedListener = null;
let deviceDisconnectedListener = null;
let isInitialized = false;

function getPlugin() {
  if (!plugin) {
    plugin = window.Capacitor?.Plugins?.NexoBLE || null;
  }
  return plugin;
}

function log(msg, type = 'info') {
  console.log(`[BLE_IF] ${msg}`);
  window.dispatchEvent(new CustomEvent('nexo:ble:log', { detail: { msg, type } }));
}

export async function initBLEInterface() {
  if (isInitialized) return true;
  const p = getPlugin();
  if (!p) {
    log('Plugin NexoBLE no disponible', 'error');
    return false;
  }

  log('Inicializando BLE interface...', 'info');

  // Inicializar BLE nativo
  try {
    const uuidResult = await p.getDeviceUUID();
    const deviceUUID = uuidResult?.deviceUUID || null;
    log(`DeviceUUID: ${deviceUUID?.substring(0, 8) || 'null'}`, 'info');

    const initResult = await p.initializeBLE({
      userId: deviceUUID || undefined,
      userName: 'NEXO User'
    });
    log('BLE nativo inicializado', 'success');

    // Iniciar advertising
    try {
      await p.startAdvertising({ deviceName: 'NEXO' });
      log('Advertising iniciado', 'success');
    } catch (e) {
      log(`Advertising warning: ${e.message}`, 'warn');
    }
  } catch (e) {
    log(`Init warning: ${e.message}`, 'warn');
  }

  // Registrar listeners permanentes
  registerListeners();

  isInitialized = true;
  log('BLE interface lista', 'success');
  return true;
}

function registerListeners() {
  const p = getPlugin();
  if (!p) return;

  // Limpiar listeners previos
  cleanupListeners();

  // Listener SCAN RESULT — CRÍTICO
  try {
    scanListener = p.addListener('onScanResult', (result) => {
      const addr = result?.address || result?.deviceId || result?.deviceAddress || 'unknown';
      const name = result?.name || result?.deviceName || 'NEXO Device';
      const rssi = result?.rssi || 0;
      log(`Scan result: ${name} (${addr.substring(0, 8)}...) rssi=${rssi}`, 'info');
      window.dispatchEvent(new CustomEvent('nexo:ble:deviceFound', {
        detail: { address: addr, name, rssi, deviceId: addr }
      }));
    });
    log('Listener onScanResult registrado', 'info');
  } catch (e) {
    log(`Error scan listener: ${e.message}`, 'error');
  }

  // Listener MESSAGE RECEIVED
  try {
    messageListener = p.addListener('onMessageReceived', (result) => {
      const deviceId = result?.address || result?.deviceId || 'unknown';
      const content = result?.content || result?.message || result?.data || '';
      const senderName = result?.senderName || 'NEXO Peer';
      const messageId = result?.messageId || '';
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: { deviceId, content, senderName, messageId, source: 'ble_direct', timestamp: Date.now() }
      }));
    });
  } catch (e) { log(`Error message listener: ${e.message}`, 'warn'); }

  // Listener DEVICE CONNECTED
  try {
    deviceConnectedListener = p.addListener('onDeviceConnected', (result) => {
      const deviceId = result?.address || result?.deviceId || 'unknown';
      window.dispatchEvent(new CustomEvent('nexo:ble:deviceConnected', {
        detail: { deviceId, name: result?.name || 'NEXO Peer' }
      }));
    });
  } catch (e) { log(`Error connect listener: ${e.message}`, 'warn'); }

  // Listener DEVICE DISCONNECTED
  try {
    deviceDisconnectedListener = p.addListener('onDeviceDisconnected', (result) => {
      const deviceId = result?.address || result?.deviceId || 'unknown';
      window.dispatchEvent(new CustomEvent('nexo:ble:deviceDisconnected', {
        detail: { deviceId }
      }));
    });
  } catch (e) { log(`Error disconnect listener: ${e.message}`, 'warn'); }

  // Listener SCAN FAILED
  try {
    p.addListener('onScanFailed', (result) => {
      log(`Scan failed: ${result?.description || result?.errorCode || 'unknown'}`, 'error');
    });
  } catch (e) { log(`Error scanFailed listener: ${e.message}`, 'warn'); }
}

export async function startBleScan(onDevice, onError) {
  const p = getPlugin();
  if (!p) {
    if (onError) onError({ description: 'Plugin no disponible' });
    return;
  }

  log('Solicitando startScan...', 'info');
  try {
    await p.startScan();
    log('startScan() OK', 'success');
  } catch (e) {
    log(`startScan() error: ${e.message}`, 'error');
    if (onError) onError({ description: e.message });
  }
}

export async function stopBleScan() {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.stopScan();
    log('stopScan() OK', 'info');
  } catch (e) {
    log(`stopScan() error: ${e.message}`, 'warn');
  }
}

export async function connectToDevice(deviceId) {
  const p = getPlugin();
  if (!p) return false;
  try {
    await p.connectToDevice({ deviceId });
    return true;
  } catch (e) {
    log(`connectToDevice error: ${e.message}`, 'error');
    return false;
  }
}

export async function sendMessage(deviceId, message) {
  const p = getPlugin();
  if (!p) return false;
  try {
    await p.sendMessage({ deviceId, message });
    return true;
  } catch (e) {
    log(`sendMessage error: ${e.message}`, 'error');
    return false;
  }
}

export function cleanupListeners() {
  [scanListener, messageListener, deviceConnectedListener, deviceDisconnectedListener].forEach(l => {
    if (l && typeof l.remove === 'function') {
      try { l.remove(); } catch (e) {}
    }
  });
  scanListener = null;
  messageListener = null;
  deviceConnectedListener = null;
  deviceDisconnectedListener = null;
}

export function destroyBLEInterface() {
  cleanupListeners();
  isInitialized = false;
  plugin = null;
  log('BLE interface destruida', 'info');
}

// Backwards compatibility
export const init = initBLEInterface;
export const destroy = destroyBLEInterface;
