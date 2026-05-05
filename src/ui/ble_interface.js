/**
 * ble_interface.js v5.0.0-ARCH
 * Híbrido BLE nativo + Google Nearby Connections
 * Si BLE no detecta nada en 10s, activa Nearby automáticamente.
 */

let blePlugin = null;
let nearbyPlugin = null;
let scanListener = null;
let messageListener = null;
let deviceConnectedListener = null;
let deviceDisconnectedListener = null;
let nearbyListeners = [];
let isInitialized = false;
let nearbyActive = false;
let bleScanStarted = 0;
let fallbackTimer = null;

function getBlePlugin() {
  if (!blePlugin) blePlugin = window.Capacitor?.Plugins?.NexoBLE || null;
  return blePlugin;
}

function getNearbyPlugin() {
  if (!nearbyPlugin) nearbyPlugin = window.Capacitor?.Plugins?.NexoNearby || null;
  return nearbyPlugin;
}

function log(msg, type = 'info') {
  console.log(`[BLE_IF] ${msg}`);
  window.dispatchEvent(new CustomEvent('nexo:ble:log', { detail: { msg, type } }));
}

export async function initBLEInterface() {
  if (isInitialized) return true;
  const p = getBlePlugin();
  if (!p) {
    log('Plugin NexoBLE no disponible', 'error');
    return false;
  }

  log('Inicializando BLE interface híbrida...', 'info');

  // Inicializar BLE nativo
  try {
    const uuidResult = await p.getDeviceUUID();
    const deviceUUID = uuidResult?.deviceUUID || null;
    log(`DeviceUUID: ${deviceUUID?.substring(0, 8) || 'null'}`, 'info');

    await p.initializeBLE({ userId: deviceUUID || undefined, userName: 'NEXO User' });
    log('BLE nativo inicializado', 'success');

    try {
      await p.startAdvertising({ deviceName: 'NEXO' });
      log('BLE Advertising iniciado', 'success');
    } catch (e) {
      log(`BLE Advertising warning: ${e.message}`, 'warn');
    }
  } catch (e) {
    log(`BLE Init warning: ${e.message}`, 'warn');
  }

  // Inicializar Nearby (silencioso, no bloquea si falla)
  try {
    const np = getNearbyPlugin();
    if (np) {
      await np.startKeepAliveService();
      await np.startAdvertising({});
      log('Nearby KeepAlive + Advertising iniciado', 'success');
    }
  } catch (e) {
    log(`Nearby init warning: ${e.message}`, 'warn');
  }

  registerListeners();
  isInitialized = true;
  log('BLE interface híbrida lista', 'success');
  return true;
}

function registerListeners() {
  const p = getBlePlugin();
  if (!p) return;
  cleanupListeners();

  // BLE Listeners
  try {
    scanListener = p.addListener('onScanResult', (result) => {
      const addr = result?.address || result?.deviceId || 'unknown';
      const name = result?.name || result?.deviceName || 'NEXO Device';
      const rssi = result?.rssi || 0;
      log(`BLE Scan: ${name} (${addr.substring(0, 8)}) rssi=${rssi}`, 'info');
      window.dispatchEvent(new CustomEvent('nexo:ble:deviceFound', {
        detail: { address: addr, name, rssi, deviceId: addr, transport: 'ble' }
      }));
      // Si BLE funciona, pausar Nearby discovery para ahorrar batería
      if (nearbyActive) pauseNearby();
    });
  } catch (e) { log(`Error scan listener: ${e.message}`, 'error'); }

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

  try {
    deviceConnectedListener = p.addListener('onDeviceConnected', (result) => {
      const deviceId = result?.address || result?.deviceId || 'unknown';
      window.dispatchEvent(new CustomEvent('nexo:ble:deviceConnected', {
        detail: { deviceId, name: result?.name || 'NEXO Peer' }
      }));
    });
  } catch (e) { log(`Error connect listener: ${e.message}`, 'warn'); }

  try {
    deviceDisconnectedListener = p.addListener('onDeviceDisconnected', (result) => {
      const deviceId = result?.address || result?.deviceId || 'unknown';
      window.dispatchEvent(new CustomEvent('nexo:ble:deviceDisconnected', {
        detail: { deviceId }
      }));
    });
  } catch (e) { log(`Error disconnect listener: ${e.message}`, 'warn'); }

  // Nearby Listeners (si disponible)
  const np = getNearbyPlugin();
  if (np) {
    const events = [
      ['onEndpointFound', (data) => {
        window.dispatchEvent(new CustomEvent('nexo:ble:deviceFound', {
          detail: { address: data.endpointId, name: data.endpointName, rssi: 0, deviceId: data.endpointId, transport: 'nearby' }
        }));
      }],
      ['onPayloadReceived', (data) => {
        window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
          detail: { deviceId: data.endpointId, content: data.message, senderName: 'NEXO Peer', messageId: '', source: 'nearby', timestamp: Date.now() }
        }));
      }]
    ];
    events.forEach(([evt, handler]) => {
      try {
        nearbyListeners.push(np.addListener(evt, handler));
      } catch (e) {}
    });
  }
}

async function activateNearbyFallback() {
  if (nearbyActive) return;
  const np = getNearbyPlugin();
  if (!np) return;
  try {
    log('Activando Nearby fallback (BLE no detectó nada)', 'warn');
    await np.startDiscovery();
    nearbyActive = true;
  } catch (e) {
    log(`Nearby fallback error: ${e.message}`, 'error');
  }
}

async function pauseNearby() {
  if (!nearbyActive) return;
  const np = getNearbyPlugin();
  if (!np) return;
  try {
    await np.stopDiscovery();
    nearbyActive = false;
    log('Nearby pausado (BLE activo)', 'info');
  } catch (e) {}
}

export async function startBleScan(onDevice, onError) {
  const p = getBlePlugin();
  if (!p) {
    if (onError) onError({ description: 'Plugin no disponible' });
    return;
  }

  log('Solicitando startScan BLE...', 'info');
  bleScanStarted = Date.now();

  try {
    await p.startScan();
    log('BLE startScan() OK', 'success');
  } catch (e) {
    log(`BLE startScan() error: ${e.message}`, 'error');
    if (onError) onError({ description: e.message });
  }

  // Fallback: si en 10s no hay resultados BLE, activar Nearby
  fallbackTimer = setTimeout(() => {
    const elapsed = Date.now() - bleScanStarted;
    if (elapsed >= 10000) activateNearbyFallback();
  }, 10000);
}

export async function stopBleScan() {
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  const p = getBlePlugin();
  if (p) {
    try { await p.stopScan(); log('BLE stopScan() OK', 'info'); } catch (e) {}
  }
  if (nearbyActive) {
    const np = getNearbyPlugin();
    if (np) {
      try { await np.stopDiscovery(); nearbyActive = false; } catch (e) {}
    }
  }
}

export async function connectToDevice(deviceId) {
  const p = getBlePlugin();
  if (p) {
    try { await p.connectToDevice({ deviceId }); return true; } catch (e) {}
  }
  const np = getNearbyPlugin();
  if (np) {
    try { await np.acceptConnection({ endpointId: deviceId }); return true; } catch (e) {}
  }
  return false;
}

export async function sendMessage(deviceId, message) {
  const p = getBlePlugin();
  if (p) {
    try { await p.sendMessage({ deviceId, message }); return true; } catch (e) {}
  }
  const np = getNearbyPlugin();
  if (np) {
    try { await np.sendMessage({ endpointId: deviceId, message }); return true; } catch (e) {}
  }
  return false;
}

export function cleanupListeners() {
  [scanListener, messageListener, deviceConnectedListener, deviceDisconnectedListener].forEach(l => {
    if (l && typeof l.remove === 'function') { try { l.remove(); } catch (e) {} }
  });
  nearbyListeners.forEach(l => {
    if (l && typeof l.remove === 'function') { try { l.remove(); } catch (e) {} }
  });
  nearbyListeners = [];
  scanListener = null; messageListener = null;
  deviceConnectedListener = null; deviceDisconnectedListener = null;
}

export function destroyBLEInterface() {
  if (fallbackTimer) clearTimeout(fallbackTimer);
  cleanupListeners();
  isInitialized = false; nearbyActive = false;
  blePlugin = null; nearbyPlugin = null;
  log('BLE interface híbrida destruida', 'info');
}

export const init = initBLEInterface;
export const destroy = destroyBLEInterface;
