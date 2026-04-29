/**
 * BLE Interface v3.6-ARCH
 * Ubicación: src/ui/ble_interface.js
 * FIX v3.6-ARCH:
 *   1) _normId normaliza MAC addresses a hex puro (evita desfase por : o -)
 *   2) _setupNativePayloadListener deduplica por fingerprint si no hay messageId
 *   3) Comparación chat activo robusta con IDs normalizados a hex puro
 *   4) Auto-registro de contacto al recibir primer mensaje
 *   5) Toast suprimido cuando chat está activo con el mismo peer
 */

export function initBLEInterface(bleMesh) {
  const instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}

const BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v1';

function _normId(id) {
  if (!id) return '';
  const s = id.toString().toLowerCase().trim();
  // Si parece MAC address (patrón XX:XX... o XX-XX...), normalizar a hex puro
  // para evitar desfase por formato de separadores entre plugin nativo y UI
  if (/^[0-9a-f]{2}([:-][0-9a-f]{2}){5,}$/i.test(s)) {
    return s.replace(/[^a-f0-9]/g, '');
  }
  return s;
}

function _getBLEContacts() {
  try {
    const raw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function _addBLEContact(device) {
  const contacts = _getBLEContacts();
  const id = _normId(device.id || device.address);
  if (!id) return false;
  const existingByName = contacts.find(c => c.name && device.name && c.name === device.name);
  if (existingByName) {
    existingByName.id = id;
    existingByName.address = _normId(device.address || device.id);
    existingByName.rssi = device.rssi || existingByName.rssi;
    existingByName.updatedAt = Date.now();
    localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
    return true;
  }
  if (contacts.some(c => _normId(c.id || c.address) === id)) return false;
  contacts.push({ id, address: _normId(device.address || device.id), name: device.name || 'NEXO Device', rssi: device.rssi || null, addedAt: Date.now() });
  localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  return true;
}

function _removeBLEContact(deviceId) {
  const nid = _normId(deviceId);
  const contacts = _getBLEContacts().filter(c => _normId(c.id || c.address) !== nid);
  localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}

function _isBLEContact(deviceId) {
  return _getBLEContacts().some(c => _normId(c.id || c.address) === _normId(deviceId));
}

function _getContactName(deviceId) {
  const nid = _normId(deviceId);
  const c = _getBLEContacts().find(c => _normId(c.id || c.address) === nid);
  return c?.name || null;
}

const BLE_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  DISCOVERING_SERVICES: 'discovering_services',
  NOTIFICATIONS_READY: 'notifications_ready',
  READY_TO_CHAT: 'ready_to_chat',
  ERROR: 'error',
  RECONNECTING: 'reconnecting'
};

export class BLEInterface {
  constructor(bleMesh) {
    this.bleMesh = bleMesh;
    this.isScanning = false;
    this.foundDevices = new Map();
    this.connectedDevices = new Map();
    this.isVisible = false;
    this.elements = {};
    this.newDevicesCount = 0;
    this._renderedDeviceIds = new Set();
    this.nativePlugin = window.Capacitor?.Plugins?.NexoBLE || null;
    this.isDummyMode = !bleMesh && !this.nativePlugin;
    this.meshType = this._detectMeshType();
    this.isAdvertising = false;
    this.canAdvertise = false;
    this.localDeviceName = 'NEXO Device';
    this.localDeviceAddress = null;
    this._activeChatDeviceId = null;
    this._deviceStates = new Map();
    this._receivedMessageIds = new Set();
    this._maxMessageIds = 1000;
    this._pendingMessageQueue = new Map();
    this._reconnectTimers = new Map();
    this._serverReady = false;
    this._serverError = null;
  }

  _detectMeshType() {
    if (!this.bleMesh) return 'none';
    if (typeof this.bleMesh.getState === 'function') return 'nordic';
    if (typeof this.bleMesh.getStatus === 'function') return 'hybrid';
    return 'unknown';
  }

  init() {
    this.createDOM();
    this.injectStyles();
    this.setupEventListeners();
    if (!this.nativePlugin) {
      this.nativePlugin = window.Capacitor?.Plugins?.NexoBLE || null;
      if (this.nativePlugin) this.isDummyMode = !this.bleMesh && !this.nativePlugin;
    }
    if (this.isDummyMode) {
      this.updateStatus('OFFLINE (Dummy)');
    } else {
      this.updateStatus();
      this._loadConnectedDevices();
      this._initVisibility();
      this._setupNativeScanListeners();
      this._setupNativeConnectionListeners();
      this._setupNativePayloadListener();
      this._setupNativeStateListeners();
      this._setupNativePeerInfoListener();
      this._setupNativeServerReadyListener();
      this._setupNativeServerErrorListener();
      this._loadLocalDeviceInfo();
    }
    return this;
  }

  async _loadLocalDeviceInfo() {
    if (!this.nativePlugin || !this.nativePlugin.getLocalDeviceInfo) return;
    try {
      const info = await this.nativePlugin.getLocalDeviceInfo();
      this.localDeviceName = info.deviceName || 'NEXO Device';
      this.localDeviceAddress = _normId(info.deviceAddress || '');
    } catch (e) {}
  }

  _setupNativeScanListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeDeviceFoundListener) this._nativeDeviceFoundListener.remove();
    if (this._nativeScanFailedListener) this._nativeScanFailedListener.remove();
    this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', (data) => {
      this.onDeviceFound({ id: data.deviceId, address: data.deviceId, name: data.name || 'NEXO Device', rssi: data.rssi });
    });
    this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', (data) => {
      this.isScanning = false;
      this.onScanStateChanged(false);
      this.showToast('❌ Error al escanear', 'error');
    });
  }

  _setupNativePeerInfoListener() {
    if (!this.nativePlugin) return;
    if (this._nativePeerInfoListener) this._nativePeerInfoListener.remove();
    this._nativePeerInfoListener = this.nativePlugin.addListener('onPeerInfoReceived', (data) => {
      const deviceId = _normId(data.deviceId);
      const device = this.connectedDevices.get(deviceId);
      if (device) {
        device.name = data.name || device.name || 'NEXO Peer';
        this.connectedDevices.set(deviceId, device);
        this.renderConnectedList();
        if (this._activeChatDeviceId === deviceId) {
          const nameInput = document.getElementById('chat-contact-name');
          if (nameInput) nameInput.value = device.name;
        }
      }
    });
  }

  _setupNativeConnectionListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeDeviceConnectedListener) this._nativeDeviceConnectedListener.remove();
    if (this._nativeDeviceDisconnectedListener) this._nativeDeviceDisconnectedListener.remove();
    
    this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', (data) => {
      const deviceId = _normId(data.deviceId);
      const attempt = data.attempt || 0;
      this._cancelReconnect(deviceId);
      const contactName = _getContactName(deviceId);
      const displayName = data.name || contactName || 'NEXO Peer';
      
      if (data.direction === 'incoming') {
        this._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { direction: 'incoming', role: 'peer_connected' });
        this.connectedDevices.set(deviceId, { id: deviceId, address: deviceId, name: displayName, direction: 'incoming', servicesReady: true });
        this.showToast(`✅ Peer conectado: ${this._formatId(deviceId)}`, 'success');
      } else {
        this._setDeviceState(deviceId, BLE_STATES.CONNECTING, { direction: 'outgoing', attempt, role: 'client' });
        this.connectedDevices.set(deviceId, { id: deviceId, address: deviceId, name: displayName, direction: 'outgoing', servicesReady: false });
      }
      this.onDeviceConnected({ id: deviceId, address: deviceId, name: displayName, direction: data.direction || 'unknown', servicesReady: data.servicesReady === true, attempt });
    });
    
    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', (data) => {
      const deviceId = _normId(data.deviceId);
      this._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
      this.connectedDevices.delete(deviceId);
      this.onDeviceDisconnected({ id: deviceId, address: deviceId });
      if (this._activeChatDeviceId === deviceId) {
        this.showToast('⚠️ Conexión BLE perdida. Reconectando...', 'warning');
        this._startReconnect(deviceId);
      }
    });
  }

  _startReconnect(deviceId) {
    this._cancelReconnect(deviceId);
    this._setDeviceState(deviceId, BLE_STATES.RECONNECTING, { message: 'Reconectando...' });
    const attemptReconnect = async () => {
      if (this._activeChatDeviceId !== deviceId) return;
      try {
        console.log('[BLEInterface] Force reconnect a', deviceId, '...');
        await this.nativePlugin.forceReconnect({ deviceId });
      } catch (e) {
        console.warn('[BLEInterface] Force reconnect falló:', e.message);
        const timer = setTimeout(attemptReconnect, 3000);
        this._reconnectTimers.set(deviceId, timer);
      }
    };
    attemptReconnect();
  }

  _cancelReconnect(deviceId) {
    const timer = this._reconnectTimers.get(deviceId);
    if (timer) {
      clearTimeout(timer);
      this._reconnectTimers.delete(deviceId);
    }
  }

  _setupNativeStateListeners() {
    if (!this.nativePlugin) return;
    this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', (data) => {
      const deviceId = _normId(data.deviceId);
      this._setDeviceState(deviceId, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
      const device = this.connectedDevices.get(deviceId);
      if (device) { device.servicesReady = true; this.connectedDevices.set(deviceId, device); }
    });
    this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', (data) => {
      const deviceId = _normId(data.deviceId);
      this._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, direction: this._getDeviceState(deviceId).direction || 'unknown' });
      this._processPendingMessages(deviceId);
    });
    this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', (data) => {
      const deviceId = _normId(data.deviceId);
      if (data.recoverable !== false && data.attempt < (data.maxAttempts || 3)) {
        this._setDeviceState(deviceId, BLE_STATES.CONNECTING, { attempt: data.attempt, message: `Reintentando...` });
      } else {
        this._setDeviceState(deviceId, BLE_STATES.ERROR, { lastError: data.reason });
        this.showToast(`❌ Conexión fallada: ${data.reason}`, 'error');
      }
    });
    this._nativeStackBrokenListener = this.nativePlugin.addListener('onBluetoothStackBroken', (data) => {
      this.showToast('⚠️ Bluetooth necesita reiniciarse', 'warning', 8000);
    });
  }

  _setupNativeServerReadyListener() {
    if (!this.nativePlugin) return;
    if (this._nativeServerReadyListener) this._nativeServerReadyListener.remove();
    this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', (data) => {
      this._serverReady = data.ready === true;
      this._serverError = null;
      console.log('[BLEInterface] Server ready:', this._serverReady);
    });
  }

  _setupNativeServerErrorListener() {
    if (!this.nativePlugin) return;
    if (this._nativeServerErrorListener) this._nativeServerErrorListener.remove();
    this._nativeServerErrorListener = this.nativePlugin.addListener('onServerError', (data) => {
      this._serverReady = false;
      this._serverError = { code: data.code, message: data.message };
      console.error('[BLEInterface] Server error:', data.code, data.message);
      if (data.code === 'BLE_202') {
        this.showToast('⚠️ Permisos BLE requeridos. Concede los permisos en Ajustes.', 'warning', 5000);
      }
    });
  }

  _setDeviceState(deviceId, state, meta = {}) {
    const nid = _normId(deviceId);
    this._deviceStates.set(nid, { state, ...meta, timestamp: Date.now() });
    this.renderConnectedList();
  }

  _getDeviceState(deviceId) {
    return this._deviceStates.get(_normId(deviceId)) || { state: BLE_STATES.DISCONNECTED };
  }

  _setupNativePayloadListener() {
    if (!this.nativePlugin) return;
    if (this._nativePayloadListener) this._nativePayloadListener.remove();
    this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', (data) => {
      const deviceId = _normId(data.deviceId);
      let messageId = data.messageId || null;
      let senderName = data.senderName || null;
      let content = data.content || data.data || '';
      let timestamp = data.timestamp || Date.now();
      try {
        const json = JSON.parse(data.data || '{}');
        if (json.messageId) messageId = json.messageId;
        if (json.senderName && !senderName) senderName = json.senderName;
        if (json.content) content = json.content;
        if (json.timestamp) timestamp = json.timestamp;
      } catch (e) {}
      
      // Resolver senderName de forma robusta (contactos > conectados > found > default)
      if (!senderName || senderName === 'NEXO Peer') {
        senderName = _getContactName(deviceId) 
          || this.connectedDevices.get(deviceId)?.name 
          || this.foundDevices.get(deviceId)?.name 
          || 'NEXO Peer';
      }
      
      // Auto-registrar contacto al recibir primer mensaje para que aparezca con nombre en lista
      if (!_isBLEContact(deviceId) && senderName && senderName !== 'NEXO Peer') {
        _addBLEContact({ id: deviceId, address: deviceId, name: senderName });
      }
      
      // FIX v3.6-ARCH: Deduplicación robusta por messageId o fingerprint de contenido
      const dedupKey = messageId || `ble_${deviceId}_${(content || '').length}_${timestamp}`;
      if (this._receivedMessageIds.has(dedupKey)) return;
      this._receivedMessageIds.add(dedupKey);
      if (this._receivedMessageIds.size > this._maxMessageIds) {
        const first = this._receivedMessageIds.values().next().value;
        this._receivedMessageIds.delete(first);
      }
      
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: { deviceId, content, senderName, messageId, source: data.source || 'unknown', timestamp }
      }));
      
      // FIX v3.6-ARCH: Comparación robusta de chat activo normalizando ambos IDs a hex puro
      // Esto evita que 47:a5:00...7:9a y 47a500...79a se traten como dispositivos distintos
      const activeId = (this._activeChatDeviceId || '').toString().toLowerCase().replace(/[^a-f0-9]/g, '');
      const msgDeviceId = deviceId.toString().toLowerCase().replace(/[^a-f0-9]/g, '');
      if (activeId && activeId === msgDeviceId) {
        return; // Silencioso: ya estamos en chat con este dispositivo
      }
      
      this.showToast('📨 Mensaje de ' + senderName, 'info');
      this.newDevicesCount++;
      this.updateBadge();
    });
  }

  async _processPendingMessages(deviceId) {
    const nid = _normId(deviceId);
    const queue = this._pendingMessageQueue.get(nid);
    if (!queue || queue.length === 0) return;
    this._pendingMessageQueue.delete(nid);
    for (const item of queue) {
      try { await this._sendMessageNative(nid, item.content); item.resolve(); }
      catch (e) { item.reject(e); }
    }
  }

  async _sendMessageNative(deviceId, content) {
    if (!this.nativePlugin) throw new Error('Plugin no disponible');
    const device = this.connectedDevices.get(_normId(deviceId));
    const targetId = device?.id || device?.address || deviceId;
    await this.nativePlugin.sendMessage({ deviceId: targetId, message: content });
  }

  async _initVisibility() {
    if (this.isDummyMode) return;
    try {
      const btState = await this.nativePlugin.isBluetoothEnabled();
      this.canAdvertise = btState.canAdvertise || false;
      this._serverReady = btState.serverReady || false;
      const adState = await this.nativePlugin.isAdvertising();
      this.isAdvertising = adState.isAdvertising === true;
      this.updateVisibilityButton();
      this._setupNativeAdvertisingListeners();
    } catch (err) {
      console.error('[BLEInterface] Error consultando estado:', err);
    }
  }
  
  _setupNativeAdvertisingListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeAdStartedListener) this._nativeAdStartedListener.remove();
    if (this._nativeAdFailedListener) this._nativeAdFailedListener.remove();
    this._nativeAdStartedListener = this.nativePlugin.addListener('onAdvertiseStarted', () => {
      this.isAdvertising = true;
      this.updateVisibilityButton();
      this.showToast('👁️‍🗨️ Visibilidad activada', 'success');
    });
    this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', () => {
      this.isAdvertising = false;
      this.updateVisibilityButton();
      this.showToast('❌ Error al activar visibilidad', 'error');
    });
  }

  updateVisibilityButton() {
    const btn = this.elements.visibilityBtn;
    if (!btn) return;
    const icon = btn.querySelector('.btn-icon');
    const text = btn.querySelector('span:last-child');
    if (!this.canAdvertise) {
      btn.className = 'ble-btn-visibility btn-visibility-warning';
      if (icon) icon.textContent = '⚠️';
      if (text) text.textContent = 'Visibilidad desactivada';
    } else if (!this.isAdvertising) {
      btn.className = 'ble-btn-visibility btn-visibility-off';
      if (icon) icon.textContent = '👁️';
      if (text) text.textContent = 'Visibilidad';
    } else {
      btn.className = 'ble-btn-visibility btn-visibility-on';
      if (icon) icon.textContent = '👁️‍🗨️';
      if (text) text.textContent = 'Visible';
    }
  }

  async toggleVisibility() {
    if (this.isDummyMode) return;

    const permsReady = await window.BLEPermissions.ensure();
    if (!permsReady) {
      this.showToast('⚠️ Permisos BLE requeridos. Concede los permisos en Ajustes.', 'warning', 5000);
      return;
    }

    if (!this._serverReady) {
      try {
        this.showToast('⏳ Inicializando servidor BLE...', 'info');
        await this.nativePlugin.initializeBLE({
          userId: window.currentUser?.id || '',
          userName: window.currentUser?.name || 'NEXO User'
        });
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (this._serverError) {
              reject(new Error(this._serverError.message));
            } else {
              reject(new Error('Timeout esperando servidor BLE'));
            }
          }, 8000);
          const check = () => {
            if (this._serverReady) { clearTimeout(timeout); resolve(); }
            else if (this._serverError) { clearTimeout(timeout); reject(new Error(this._serverError.message)); }
            else setTimeout(check, 200);
          };
          check();
        });
      } catch (e) {
        console.error('[BLEInterface] Error inicializando servidor:', e.message);
        this.showToast('❌ No se pudo inicializar servidor BLE: ' + e.message, 'error', 5000);
        return;
      }
    }

    try {
      const btState = await this.nativePlugin.isBluetoothEnabled();
      this.canAdvertise = btState.canAdvertise || false;
    } catch (e) {}

    if (!this.canAdvertise) {
      this.showToast('⚠️ Sin permiso de advertising', 'warning');
      return;
    }

    try {
      if (this.isAdvertising) {
        await this.nativePlugin.stopAdvertising();
        this.isAdvertising = false;
      } else {
        await this.nativePlugin.startAdvertising();
      }
      this.updateVisibilityButton();
    } catch (err) {
      this.showToast('❌ Error: ' + err.message, 'error');
    }
  }

  createDOM() {
    const tab = document.createElement('div');
    tab.id = 'ble-tab';
    tab.innerHTML = `<div class="ble-tab-icon">🔷</div><div class="ble-tab-label">BLE</div><div class="ble-tab-badge" id="ble-tab-badge" style="display: none;">0</div>`;
    document.body.appendChild(tab);
    this.elements.tab = tab;

    const panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML = `
      <div class="ble-header"><h3>🔷 BLE Mesh</h3><button id="ble-close">✕</button></div>
      <div class="ble-tabs">
        <button class="ble-tab-btn active" data-tab="discovery">Cercanos</button>
        <button class="ble-tab-btn" data-tab="added">Agregados</button>
        <button class="ble-tab-btn" data-tab="connected">Conectados</button>
      </div>
      <div class="ble-main-controls">
        <button id="ble-visibility-btn" class="ble-btn-visibility btn-visibility-off" ${this.isDummyMode ? 'disabled' : ''}>
          <span class="btn-icon">🚫</span><span>Visibilidad desactivada</span>
        </button>
        <button id="ble-scan-btn" class="ble-btn-discover" ${this.isDummyMode ? 'disabled' : ''}>
          <span class="btn-icon">🔍</span><span id="text-discover">Descubrir</span>
        </button>
      </div>
      <div class="ble-secondary-controls">
        <span id="ble-status" class="ble-status-offline">OFFLINE</span>
      </div>
      <div id="tab-discovery" class="ble-tab-content active">
        <div class="ble-list" id="ble-devices-list"><p class="ble-empty">Presiona Descubrir para encontrar dispositivos cercanos</p></div>
      </div>
      <div id="tab-added" class="ble-tab-content">
        <div class="ble-list" id="ble-added-list"><p class="ble-empty">No hay contactos agregados</p></div>
      </div>
      <div id="tab-connected" class="ble-tab-content">
        <div class="ble-list" id="ble-connected-list"><p class="ble-empty">No hay dispositivos conectados</p></div>
      </div>
    `;
    document.body.appendChild(panel);
    this.elements.panel = panel;

    const overlay = document.createElement('div');
    overlay.id = 'ble-overlay';
    document.body.appendChild(overlay);
    this.elements.overlay = overlay;

    this.elements.visibilityBtn = document.getElementById('ble-visibility-btn');
    this.elements.scanBtn = document.getElementById('ble-scan-btn');
    this.elements.closeBtn = document.getElementById('ble-close');
    this.elements.devicesList = document.getElementById('ble-devices-list');
    this.elements.addedList = document.getElementById('ble-added-list');
    this.elements.connectedList = document.getElementById('ble-connected-list');
    this.elements.status = document.getElementById('ble-status');
    this.elements.badge = document.getElementById('ble-tab-badge');
  }

  injectStyles() {
    if (document.getElementById('ble-styles')) return;
    const style = document.createElement('style');
    style.id = 'ble-styles';
    style.textContent = `
      #ble-tab { position: fixed; left: 0; top: 50%; transform: translateY(-50%); width: 44px; height: 100px; background: linear-gradient(180deg, #00d4ff, #0099cc); border-radius: 0 12px 12px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483644; color: #000; font-weight: bold; }
      .ble-tab-badge { position: absolute; top: 5px; right: -5px; background: #ff4444; color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; animation: pulse 2s infinite; }
      @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
      #ble-panel { position: fixed; top: 0; left: 0; width: 85vw; max-width: 400px; height: 100vh; background: rgba(10,10,15,0.98); transform: translateX(-100%); transition: transform 0.3s ease; z-index: 2147483645; color: #fff; padding: 20px; overflow-y: auto; }
      #ble-panel.active { transform: translateX(0); }
      #ble-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; z-index: 2147483644; backdrop-filter: blur(4px); }
      #ble-overlay.active { display: block; }
      .ble-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px; }
      .ble-tabs { display: flex; gap: 8px; margin-bottom: 15px; }
      .ble-tab-btn { flex: 1; padding: 10px 4px; background: #222; border: 1px solid #333; border-radius: 6px; color: #888; cursor: pointer; font-size: 11px; }
      .ble-tab-btn.active { background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; font-weight: bold; border-color: #00d4ff; }
      .ble-tab-content { display: none; }
      .ble-tab-content.active { display: block; }
      .ble-main-controls { display: flex; gap: 12px; justify-content: center; align-items: center; margin-bottom: 10px; }
      .ble-secondary-controls { margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; }
      .ble-btn-visibility { flex: 1; max-width: 140px; height: 48px; border-radius: 12px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.3s ease; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ble-btn-visibility.btn-visibility-warning { background: #4A3A00 !important; color: #FFCC00 !important; border: 1px solid #FFCC00 !important; }
      .ble-btn-visibility.btn-visibility-off { background: #3A3A3A; color: #888888; }
      .ble-btn-visibility.btn-visibility-on { background: #00D9FF; color: #000000; box-shadow: 0 0 12px rgba(0, 217, 255, 0.4); }
      .ble-btn-discover { flex: 1.2; height: 56px; border-radius: 14px; border: none; font-weight: 700; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3); transition: all 0.3s ease; }
      .ble-btn-discover.scanning { background: linear-gradient(135deg, #ff4444, #cc0000); color: #fff; animation: pulse-red 1.5s infinite; }
      @keyframes pulse-red { 0%, 100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.4); } 50% { box-shadow: 0 0 0 10px rgba(255, 68, 68, 0); } }
      #ble-status { font-size: 12px; padding: 4px 8px; border-radius: 4px; }
      .ble-status-offline { background: #333; color: #888; }
      .ble-status-online { background: #00d4ff; color: #000; }
      .ble-status-scanning { background: #ffaa00; color: #000; animation: blink 1s infinite; }
      @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.7; } }
      .ble-list { display: flex; flex-direction: column; gap: 8px; max-height: calc(100vh - 300px); overflow-y: auto; }
      .ble-empty { text-align: center; color: #666; padding: 20px; font-style: italic; }
      .ble-device-item { display: flex; align-items: center; justify-content: space-between; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid #333; border-radius: 8px; cursor: pointer; transition: all 0.2s; }
      .ble-device-item:hover { background: rgba(0,212,255,0.1); border-color: #00d4ff; }
      .ble-device-item.new { border-left: 3px solid #00d4ff; animation: slideIn 0.3s ease; }
      @keyframes slideIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
      .ble-device-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .ble-device-name { font-weight: bold; color: #fff; }
      .ble-device-id { font-size: 11px; color: #888; }
      .ble-device-rssi { font-size: 12px; color: #00d4ff; }
      .ble-device-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
      .ble-btn-add { padding: 8px 16px; background: #00ff88; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; }
      .ble-btn-write { padding: 8px 16px; background: #00d4ff; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; }
      .ble-btn-write:disabled { background: #555; color: #aaa; cursor: not-allowed; }
      .ble-btn-disconnect { padding: 6px 12px; background: #ff4444; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
      .ble-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: #fff; font-weight: bold; z-index: 2147483646; animation: fadeInUp 0.3s ease; }
      .ble-toast.success { background: #00d4ff; color: #000; }
      .ble-toast.error { background: #ff4444; }
      .ble-toast.warning { background: #ffaa00; color: #000; }
      .ble-toast.info { background: #444; }
      @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      .ble-state-connecting { color: #ffaa00; font-size: 11px; }
      .ble-state-ready { color: #00ff88; font-size: 11px; }
      .ble-state-error { color: #ff4444; font-size: 11px; }
      .ble-state-reconnecting { color: #ffaa00; font-size: 11px; animation: blink 1s infinite; }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    this.elements.tab.addEventListener('click', () => this.togglePanel());
    this.elements.closeBtn.addEventListener('click', () => this.togglePanel());
    this.elements.overlay.addEventListener('click', () => this.togglePanel());
    this.elements.visibilityBtn.addEventListener('click', () => this.toggleVisibility());
    this.elements.scanBtn.addEventListener('click', () => this.toggleScan());
    document.querySelectorAll('.ble-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });
    window.addEventListener('nexo:ble:closeChat', () => {
      this._activeChatDeviceId = null;
      this.updateBadge();
    });
  }

  togglePanel() {
    this.elements.panel.classList.toggle('active');
    this.elements.overlay.classList.toggle('active');
    if (this.elements.panel.classList.contains('active')) {
      this.newDevicesCount = 0;
      this.updateBadge();
      this._loadConnectedDevices();
      this.renderAddedList();
    }
  }

  switchTab(tabName) {
    document.querySelectorAll('.ble-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.ble-tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    if (tabName === 'added') this.renderAddedList();
  }

  async toggleScan() {
    if (this.isDummyMode) return;

    const permsReady = await window.BLEPermissions.ensure();
    if (!permsReady) {
      this.showToast('⚠️ Permisos BLE requeridos. Concede los permisos en Ajustes.', 'warning', 5000);
      return;
    }

    try {
      if (this.isScanning) {
        if (this.nativePlugin) await this.nativePlugin.stopScan();
        this.isScanning = false;
        this.onScanStateChanged(false);
      } else {
        this.foundDevices.clear();
        this._renderedDeviceIds.clear();
        this.renderDevicesList();
        if (this.nativePlugin) await this.nativePlugin.startScan();
        this.isScanning = true;
        this.onScanStateChanged(true);
      }
    } catch (err) {
      this.isScanning = false;
      this.onScanStateChanged(false);
    }
  }

  onScanStateChanged(isScanning) {
    this.isScanning = isScanning;
    const btn = this.elements.scanBtn;
    const text = document.getElementById('text-discover');
    if (isScanning) {
      btn.classList.add('scanning');
      if (text) text.textContent = 'Detener';
      this.elements.status.textContent = 'ESCANEANDO...';
      this.elements.status.className = 'ble-status-scanning';
      this.showToast('🔍 Buscando dispositivos...', 'info');
    } else {
      btn.classList.remove('scanning');
      if (text) text.textContent = 'Descubrir';
      this.updateStatus();
    }
  }

  onDeviceFound(device) {
    let id = _normId(device.id || device.address);
    if (!id || id === 'null' || id === 'undefined') return;
    if (this.localDeviceAddress && id === this.localDeviceAddress) return;
    
    if (this._activeChatDeviceId) {
      if (this.foundDevices.has(id)) {
        const existing = this.foundDevices.get(id);
        existing.rssi = device.rssi;
        existing.name = device.name || existing.name;
        existing.lastSeen = Date.now();
        this.foundDevices.set(id, existing);
        this.renderDevicesList();
        return;
      }
      device.lastSeen = Date.now();
      this.foundDevices.set(id, device);
      this.renderDevicesList();
      return;
    }
    
    if (this.foundDevices.has(id)) {
      const existing = this.foundDevices.get(id);
      existing.rssi = device.rssi;
      existing.name = device.name || existing.name;
      existing.lastSeen = Date.now();
      this.foundDevices.set(id, existing);
      this.renderDevicesList();
      return;
    }
    device.lastSeen = Date.now();
    this.foundDevices.set(id, device);
    this.newDevicesCount++;
    this.updateBadge();
    this.renderDevicesList();
  }

  onDeviceConnected(device) {
    const nid = _normId(device.id || device.address);
    this.connectedDevices.set(nid, device);
    this.renderConnectedList();
    this.showToast('✅ Conectado: ' + (device.name || 'Dispositivo'), 'success');
  }

  onDeviceDisconnected(device) {
    const nid = _normId(device.id || device.address);
    this.connectedDevices.delete(nid);
    this.renderConnectedList();
    this.showToast('❌ Desconectado', 'info');
  }

  async _loadConnectedDevices() {
    if (this.isDummyMode) return;
    try {
      let devices = [];
      if (this.nativePlugin && this.nativePlugin.getConnectedDevices) {
        const result = await this.nativePlugin.getConnectedDevices();
        devices = result.devices || [];
      }
      this.connectedDevices.clear();
      devices.forEach(d => {
        const nid = _normId(d.id || d.address || d.deviceId);
        this.connectedDevices.set(nid, { ...d, id: nid, address: nid });
      });
      this.renderConnectedList();
    } catch (err) {}
  }

  async addContact(deviceId) {
    const nid = _normId(deviceId);
    const device = this.foundDevices.get(nid) || this.connectedDevices.get(nid);
    if (!device) { this.showToast('❌ Dispositivo no encontrado', 'error'); return; }
    if (_addBLEContact(device)) {
      this.showToast('✅ Agregado a contactos', 'success');
      this.renderDevicesList();
    } else {
      this.showToast('⚠️ Ya está en contactos', 'warning');
    }
  }

  async removeContact(deviceId) {
    _removeBLEContact(deviceId);
    this.showToast('❌ Eliminado', 'info');
    this.renderAddedList();
    this.renderDevicesList();
  }

  async openChat(deviceId) {
    const nid = _normId(deviceId);
    let device = this.foundDevices.get(nid) || this.connectedDevices.get(nid);
    const contact = _getBLEContacts().find(c => _normId(c.id || c.address) === nid);
    if (!device && contact) device = { id: contact.id || contact.address, address: contact.address, name: contact.name || 'NEXO Device', rssi: contact.rssi };
    if (!device) { this.showToast('❌ Contacto no disponible', 'error'); return; }
    
    this._activeChatDeviceId = nid;
    this.newDevicesCount = 0;
    this.updateBadge();
    
    const displayName = contact?.name || device.name || 'NEXO Peer';
    const state = this._getDeviceState(nid);
    const isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
    const isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;
    
    if (!isFullyReady && isConnecting && this.nativePlugin) {
      this.showToast('⏳ Conexión en progreso, esperando canal...', 'info');
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
          const checkReady = () => {
            const s = this._getDeviceState(nid);
            if (s.state === BLE_STATES.NOTIFICATIONS_READY || s.state === BLE_STATES.READY_TO_CHAT) {
              clearTimeout(timeout);
              resolve();
            } else {
              setTimeout(checkReady, 300);
            }
          };
          checkReady();
        });
      } catch (e) {
        this.showToast('⚠️ Canal aún no listo. Intente enviar en unos segundos.', 'warning');
      }
    }
    
    if (!isFullyReady && !isConnecting && this.nativePlugin) {
      const permsReady = await window.BLEPermissions.ensure();
      if (!permsReady) {
        this.showToast('⚠️ Permisos BLE requeridos para conectar', 'warning', 5000);
        return;
      }

      try {
        console.log('[BLEInterface] Conectando a', nid, '...');
        const connResult = await this.nativePlugin.connectToDevice({ deviceId: device.id || device.address || nid });
        console.log('[BLEInterface] connectToDevice result:', connResult);
        if (connResult && connResult.connected && !connResult.alreadyConnected) {
          this.showToast('🔗 Conectando canal BLE...', 'info');
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
            const checkReady = () => {
              const s = this._getDeviceState(nid);
              if (s.state === BLE_STATES.NOTIFICATIONS_READY || s.state === BLE_STATES.READY_TO_CHAT) {
                clearTimeout(timeout);
                resolve();
              } else {
                setTimeout(checkReady, 300);
              }
            };
            checkReady();
          });
        }
      } catch (e) {
        console.warn('[BLEInterface] Conexión/timeout:', e.message);
        this.showToast('⚠️ Canal aún no listo. Intente enviar en unos segundos.', 'warning');
      }
    }
    
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.classList.remove('hidden');
    const nameInput = document.getElementById('chat-contact-name');
    const subtitle = document.getElementById('chat-contact-subtitle');
    if (nameInput) nameInput.value = displayName;
    if (subtitle) subtitle.textContent = 'BLUETOOTH';
    
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
      detail: { contactId: device.id || device.address, name: displayName, address: device.address || device.id, transport: 'ble', rssi: device.rssi, source: 'ble_interface' }
    }));
    
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
  }

  renderDevicesList() {
    const list = this.elements.devicesList;
    if (this.foundDevices.size === 0) {
      list.innerHTML = '<p class="ble-empty">Presiona Descubrir para encontrar dispositivos cercanos</p>';
      return;
    }
    list.innerHTML = '';
    this.foundDevices.forEach((device, id) => {
      const isAdded = _isBLEContact(id);
      const isNew = !this._renderedDeviceIds.has(id);
      if (isNew) this._renderedDeviceIds.add(id);
      const item = document.createElement('div');
      item.className = 'ble-device-item' + (isNew ? ' new' : '');
      const actionHtml = isAdded
        ? `<button class="ble-btn-write" onclick="bleInterface.openChat('${id}')">✉️ Escribir</button>`
        : `<button class="ble-btn-add" onclick="bleInterface.addContact('${id}')">+ Agregar</button>`;
      item.innerHTML = `
        <div class="ble-device-info">
          <span class="ble-device-name">${device.name || 'NEXO Device'}</span>
          <span class="ble-device-id">${this._formatId(id)}</span>
          <span class="ble-device-rssi">📶 ${device.rssi || '?'} dBm</span>
        </div>
        <div class="ble-device-actions">${actionHtml}</div>
      `;
      list.appendChild(item);
    });
  }

  renderAddedList() {
    const list = this.elements.addedList;
    const contacts = _getBLEContacts();
    if (contacts.length === 0) {
      list.innerHTML = '<p class="ble-empty">No hay contactos agregados</p>';
      return;
    }
    list.innerHTML = '';
    contacts.forEach((contact) => {
      const id = _normId(contact.id || contact.address);
      const item = document.createElement('div');
      item.className = 'ble-device-item';
      item.innerHTML = `
        <div class="ble-device-info">
          <span class="ble-device-name">${contact.name || 'NEXO Device'}</span>
          <span class="ble-device-id">${this._formatId(id)}</span>
        </div>
        <div class="ble-device-actions">
          <button class="ble-btn-write" onclick="bleInterface.openChat('${id}')">✉️ Escribir</button>
          <button class="ble-btn-disconnect" onclick="bleInterface.removeContact('${id}')">Eliminar</button>
        </div>
      `;
      list.appendChild(item);
    });
  }

  renderConnectedList() {
    const list = this.elements.connectedList;
    if (this.connectedDevices.size === 0) {
      list.innerHTML = '<p class="ble-empty">No hay dispositivos conectados</p>';
      return;
    }
    list.innerHTML = '';
    this.connectedDevices.forEach((device, id) => {
      const state = this._getDeviceState(id);
      const stateLabel = this._renderStateLabel(state);
      const isReady = state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.READY_TO_CHAT;
      const item = document.createElement('div');
      item.className = 'ble-device-item';
      item.innerHTML = `
        <div class="ble-device-info">
          <span class="ble-device-name">${device.name || 'NEXO Peer'}</span>
          <span class="ble-device-id">${this._formatId(id)}</span>
          <span class="ble-device-rssi" style="color: #00ff00;">● ${device.direction || 'Conectado'} ${stateLabel}</span>
        </div>
        <div class="ble-device-actions">
          <button class="ble-btn-write" onclick="bleInterface.openChat('${id}')" ${!isReady ? 'disabled title="Esperando canal..."' : ''}>✉️ Escribir</button>
          <button class="ble-btn-disconnect" onclick="bleInterface.disconnect('${id}')">Desconectar</button>
        </div>
      `;
      list.appendChild(item);
    });
  }

  _renderStateLabel(state) {
    if (!state || !state.state) return '';
    switch (state.state) {
      case BLE_STATES.CONNECTING: return `<span class="ble-state-connecting">⏳ ${state.message || 'Conectando...'}</span>`;
      case BLE_STATES.DISCOVERING_SERVICES: return `<span class="ble-state-connecting">🔍 Descubriendo...</span>`;
      case BLE_STATES.NOTIFICATIONS_READY: return `<span class="ble-state-ready">✅ Canal listo</span>`;
      case BLE_STATES.READY_TO_CHAT: return `<span class="ble-state-ready">✅ Listo</span>`;
      case BLE_STATES.ERROR: return `<span class="ble-state-error">❌ ${state.lastError || 'Error'}</span>`;
      case BLE_STATES.RECONNECTING: return `<span class="ble-state-reconnecting">🔄 ${state.message || 'Reconectando...'}</span>`;
      default: return '';
    }
  }

  async connect(deviceId) {
    if (this.isDummyMode) return;
    try {
      if (this.nativePlugin) await this.nativePlugin.connectToDevice({ deviceId });
    } catch (err) { this.showToast('Error al conectar', 'error'); }
  }

  async disconnect(deviceId) {
    if (this.isDummyMode) return;
    const nid = _normId(deviceId);
    try {
      this._cancelReconnect(nid);
      const device = this.connectedDevices.get(nid);
      const targetId = device?.id || device?.address || deviceId;
      if (this.nativePlugin) await this.nativePlugin.disconnectDevice({ deviceId: targetId });
      if (this._activeChatDeviceId === nid) {
        this._activeChatDeviceId = null;
        this.updateBadge();
      }
    } catch (err) {}
  }

  updateBadge() {
    const badge = this.elements.badge;
    if (this._activeChatDeviceId) {
      badge.style.display = 'none';
      return;
    }
    if (this.newDevicesCount > 0) {
      badge.textContent = this.newDevicesCount;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  async updateStatus(customStatus) {
    if (customStatus) {
      this.elements.status.textContent = customStatus;
      this.elements.status.className = 'ble-status-offline';
      return;
    }
    if (this.isDummyMode) return;
    try {
      let state = 'UNKNOWN';
      if (this.nativePlugin && this.nativePlugin.isBluetoothEnabled) {
        const btState = await this.nativePlugin.isBluetoothEnabled();
        state = btState.enabled ? 'poweredOn' : 'poweredOff';
        this._serverReady = btState.serverReady || false;
      }
      const stateMap = {
        'poweredon': 'ENCENDIDO',
        'poweredoff': 'APAGADO',
        'unknown': 'DESCONOCIDO'
      };
      const normalizedState = (state || '').toString().toLowerCase();
      this.elements.status.textContent = stateMap[normalizedState] || state.toUpperCase();
      this.elements.status.className = state === 'poweredOn' ? 'ble-status-online' : 'ble-status-offline';
    } catch (err) {
      this.elements.status.textContent = 'ERROR';
    }
  }

  showToast(message, type = 'info', duration = 3000) {
    const existing = document.querySelector('.ble-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `ble-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  _formatId(id) {
    if (!id) return '??';
    return id.substring(0, 8) + '...' + id.substring(id.length - 4);
  }

  destroy() {
    const styles = document.getElementById('ble-styles');
    if (styles) styles.remove();
    this._reconnectTimers.forEach((timer) => clearTimeout(timer));
    this._reconnectTimers.clear();
    if (this._nativeAdStartedListener) this._nativeAdStartedListener.remove();
    if (this._nativeAdFailedListener) this._nativeAdFailedListener.remove();
    if (this._nativeDeviceFoundListener) this._nativeDeviceFoundListener.remove();
    if (this._nativeScanFailedListener) this._nativeScanFailedListener.remove();
    if (this._nativeDeviceConnectedListener) this._nativeDeviceConnectedListener.remove();
    if (this._nativeDeviceDisconnectedListener) this._nativeDeviceDisconnectedListener.remove();
    if (this._nativePayloadListener) this._nativePayloadListener.remove();
    if (this._nativeServicesReadyListener) this._nativeServicesReadyListener.remove();
    if (this._nativeNotificationsListener) this._nativeNotificationsListener.remove();
    if (this._nativeConnectionFailedListener) this._nativeConnectionFailedListener.remove();
    if (this._nativeStackBrokenListener) this._nativeStackBrokenListener.remove();
    if (this._nativePeerInfoListener) this._nativePeerInfoListener.remove();
    if (this._nativeServerReadyListener) this._nativeServerReadyListener.remove();
    if (this._nativeServerErrorListener) this._nativeServerErrorListener.remove();
    if (this.isScanning) this.toggleScan();
  }
}

window.bleInterface = null;
