/**
 * ble_interface.js v5.3.1-ARCH
 * REM v2.1: Agregado listener napAuditEvent para visibilidad scan en UI
 */

let blePlugin = null;
let nearbyPlugin = null;
let scanListener = null;
let messageListener = null;
let deviceConnectedListener = null;
let deviceDisconnectedListener = null;
let peerInfoListener = null;
let napAuditListener = null;
let nearbyListeners = [];
let isInitialized = false;
let nearbyActive = false;

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

  log('Inicializando BLE interface hibrida...', 'info');

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

    try {
      await p.startScan();
      log('BLE Scan iniciado', 'success');
    } catch (e) {
      log(`BLE Scan warning: ${e.message}`, 'warn');
    }
  } catch (e) {
    log(`BLE Init warning: ${e.message}`, 'warn');
  }

  const np = getNearbyPlugin();
  if (np) {
    try {
      await np.startKeepAliveService();
      log('Nearby KeepAlive iniciado', 'success');
    } catch (e) {
      log(`Nearby KeepAlive warning: ${e.message}`, 'warn');
    }

    try {
      await np.startAdvertising({});
      log('Nearby Advertising iniciado', 'success');
    } catch (e) {
      log(`Nearby Advertising error: ${e.message}`, 'error');
    }

    try {
      await np.startDiscovery();
      nearbyActive = true;
      log('Nearby Discovery iniciado', 'success');
    } catch (e) {
      log(`Nearby Discovery error: ${e.message}`, 'error');
    }
  } else {
    log('Plugin NexoNearby no disponible', 'warn');
  }

  registerListeners();
  isInitialized = true;
  log('BLE interface hibrida lista', 'success');
  return true;
}

function registerListeners() {
  const p = getBlePlugin();
  if (p) {
    cleanupListeners();

    // REM v2.1: Listener para audit events nativos (scan, advert, gatt)
    try {
      napAuditListener = p.addListener('napAuditEvent', (result) => {
        const { code, message, level, timestamp } = result;
        log(`[NAP] ${level}: [${code}] ${message}`, level.toLowerCase());
        window.dispatchEvent(new CustomEvent('nexo:nap:audit', {
          detail: { code, message, level, timestamp }
        }));
      });
    } catch (e) {
      log(`Error napAudit listener: ${e.message}`, 'error');
    }

    try {
      scanListener = p.addListener('onScanResult', (result) => {
        const addr = result?.address || 'unknown';
        const name = result?.name || 'NEXO Device';
        const rssi = result?.rssi || 0;
        log(`BLE Scan: ${name} (${addr.substring(0, 8)}) rssi=${rssi}`, 'info');
        window.dispatchEvent(new CustomEvent('nexo:ble:deviceFound', {
          detail: { address: addr, name, rssi, deviceId: addr, transport: 'ble' }
        }));
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

    try {
      peerInfoListener = p.addListener('onPeerInfoReceived', (result) => {
        const deviceId = result?.deviceId || 'unknown';
        const peerUserId = result?.userId || '';
        const peerName = result?.name || 'NEXO Peer';
        const peerTs = result?.timestamp || Date.now();
        log(`BLE PeerInfo: ${peerName} (uid=${peerUserId?.substring(0, 8)})`, 'info');
        window.dispatchEvent(new CustomEvent('nexo:ble:peerInfo', {
          detail: { deviceId, peerUserId, peerName, peerTs, transport: 'ble' }
        }));
      });
    } catch (e) { log(`Error peerInfo listener: ${e.message}`, 'warn'); }
  }

  const np = getNearbyPlugin();
  if (np) {
    const events = [
      ['onEndpointFound', (data) => {
        log(`Nearby found: ${data.endpointName} (${data.endpointId.substring(0, 8)})`, 'success');
        window.dispatchEvent(new CustomEvent('nexo:ble:deviceFound', {
          detail: { address: data.endpointId, name: data.endpointName, rssi: 0, deviceId: data.endpointId, transport: 'nearby' }
        }));
      }],
      ['onEndpointLost', (data) => {
        window.dispatchEvent(new CustomEvent('nexo:ble:deviceLost', {
          detail: { deviceId: data.endpointId }
        }));
      }],
      ['onPayloadReceived', (data) => {
        window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
          detail: { deviceId: data.endpointId, content: data.message, senderName: 'NEXO Peer', messageId: '', source: 'nearby', timestamp: Date.now() }
        }));
      }],
      ['onConnected', (data) => {
        window.dispatchEvent(new CustomEvent('nexo:ble:deviceConnected', {
          detail: { deviceId: data.endpointId, name: data.endpointName || 'NEXO Peer' }
        }));
      }],
      ['onDisconnected', (data) => {
        window.dispatchEvent(new CustomEvent('nexo:ble:deviceDisconnected', {
          detail: { deviceId: data.endpointId }
        }));
      }],
      ['onConnectionFailed', (data) => {
        log(`Nearby connection failed: ${data.endpointId} code=${data.statusCode}`, 'error');
      }]
    ];
    events.forEach(([evt, handler]) => {
      try {
        nearbyListeners.push(np.addListener(evt, handler));
      } catch (e) { log(`Error Nearby listener ${evt}: ${e.message}`, 'warn'); }
    });
  }
}

export async function startBleScan(onDevice, onError) {
  const p = getBlePlugin();
  if (!p) {
    if (onError) onError({ description: 'Plugin no disponible' });
    return;
  }
  log('Solicitando startScan BLE...', 'info');
  try {
    await p.startScan();
    log('BLE startScan() OK', 'success');
  } catch (e) {
    log(`BLE startScan() error: ${e.message}`, 'error');
    if (onError) onError({ description: e.message });
  }
}

export async function stopBleScan() {
  const p = getBlePlugin();
  if (p) {
    try { await p.stopScan(); log('BLE stopScan() OK', 'info'); } catch (e) {}
  }
  const np = getNearbyPlugin();
  if (np && nearbyActive) {
    try { await np.stopDiscovery(); nearbyActive = false; log('Nearby discovery detenido', 'info'); } catch (e) {}
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
  [scanListener, messageListener, deviceConnectedListener, deviceDisconnectedListener, peerInfoListener, napAuditListener].forEach(l => {
    if (l && typeof l.remove === 'function') { try { l.remove(); } catch (e) {} }
  });
  nearbyListeners.forEach(l => {
    if (l && typeof l.remove === 'function') { try { l.remove(); } catch (e) {} }
  });
  nearbyListeners = [];
  scanListener = null; messageListener = null;
  deviceConnectedListener = null; deviceDisconnectedListener = null;
  peerInfoListener = null; napAuditListener = null;
}

export function destroyBLEInterface() {
  cleanupListeners();
  isInitialized = false; nearbyActive = false;
  blePlugin = null; nearbyPlugin = null;
  log('BLE interface hibrida destruida', 'info');
}

export const init = initBLEInterface;
export const destroy = destroyBLEInterface;
