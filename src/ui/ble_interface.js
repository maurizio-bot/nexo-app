// BLE Interface v3.5.3-FIX
// Ubicacion: src/ui/ble_interface.js
// FIX v3.5.3: CSS como string concatenado (evita template literals corruptos por cat << EOF)

export function initBLEInterface(bleMesh) {
  const instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}

const BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v1';

function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
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
      this.showToast('Error al escanear', 'error');
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
        this.showToast('Peer conectado: ' + this._formatId(deviceId), 'success');
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
        this.showToast('Conexion BLE perdida. Reconectando...', 'warning');
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
        console.warn('[BLEInterface] Force reconnect fallo:', e.message);
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
        this._setDeviceState(deviceId, BLE_STATES.CONNECTING, { attempt: data.attempt, message: 'Reintentando...' });
      } else {
        this._setDeviceState(deviceId, BLE_STATES.ERROR, { lastError: data.reason });
        this.showToast('Conexion fallada: ' + data.reason, 'error');
      }
    });
    this._nativeStackBrokenListener = this.nativePlugin.addListener('onBluetoothStackBroken', (data) => {
      this.showToast('Bluetooth necesita reiniciarse', 'warning', 8000);
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
        this.showToast('Permisos BLE requeridos. Concede los permisos en Ajustes.', 'warning', 5000);
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
      let messageId = null;
      let senderName = data.senderName || null;
      let content = data.content || data.data || '';
      try {
        const json = JSON.parse(data.data || '{}');
        if (json.messageId) messageId = json.messageId;
        if (json.senderName && !senderName) senderName = json.senderName;
        if (json.content) content = json.content;
      } catch (e) {}

      if (!senderName || senderName === 'NEXO Peer') {
        senderName = _getContactName(deviceId)
          || this.connectedDevices.get(deviceId)?.name
          || this.foundDevices.get(deviceId)?.name
          || 'NEXO Peer';
      }

      if (!_isBLEContact(deviceId) && senderName && senderName !== 'NEXO Peer') {
        _addBLEContact({ id: deviceId, address: deviceId, name: senderName });
      }

      if (messageId && this._receivedMessageIds.has(messageId)) return;
      if (messageId) {
        this._receivedMessageIds.add(messageId);
        if (this._receivedMessageIds.size > this._maxMessageIds) {
          const first = this._receivedMessageIds.values().next().value;
          this._receivedMessageIds.delete(first);
        }
      }

      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: { deviceId, content, senderName, messageId, source: data.source || 'unknown', timestamp: data.timestamp || Date.now() }
      }));

      const activeId = _normId(this._activeChatDeviceId);
      if (activeId && activeId === deviceId) {
        return;
      }

      this.showToast('Mensaje de ' + senderName, 'info');
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
      this.showToast('Visibilidad activada', 'success');
    });
    this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', () => {
      this.isAdvertising = false;
      this.updateVisibilityButton();
      this.showToast('Error al activar visibilidad', 'error');
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
      if (icon) icon.textContent = '👁';
      if (text) text.textContent = 'Visibilidad';
    } else {
      btn.className = 'ble-btn-visibility btn-visibility-on';
      if (icon) icon.textContent = '👁️‍🗨️';
      if (text) text.textContent = 'Visible';
    }
  }

  async _ensurePermissions() {
    try {
      if (window.permissionShim && typeof window.permissionShim.ensurePermissions === 'function') {
        const result = await window.permissionShim.ensurePermissions();
        if (result && (result.success || result.allGranted)) return { success: true };
      }
      if (this.nativePlugin && this.nativePlugin.checkBLEStatus) {
        const status = await this.nativePlugin.checkBLEStatus();
        if (status && (status.allGranted || status.granted)) return { success: true };
        if (this.nativePlugin.initializeBLE) {
          await this.nativePlugin.initializeBLE();
          await new Promise(r => setTimeout(r, 800));
          const final = await this.nativePlugin.checkBLEStatus();
          if (final && (final.allGranted || final.granted)) return { success: true };
        }
      }
      return { success: false };
    } catch (e) {
      console.warn('[BLEInterface] _ensurePermissions error:', e.message);
      return { success: false };
    }
  }

  async toggleVisibility() {
    if (this.isDummyMode) return;

    const permsResult = await this._ensurePermissions();
    if (!permsResult?.success) {
      this.showToast('Permisos BLE requeridos. Concede los permisos en Ajustes.', 'warning', 5000);
      return;
    }

    if (!this._serverReady) {
      try {
        this.showToast('Inicializando servidor BLE...', 'info');
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
        this.showToast('No se pudo inicializar servidor BLE: ' + e.message, 'error', 5000);
        return;
      }
    }

    try {
      const btState = await this.nativePlugin.isBluetoothEnabled();
      this.canAdvertise = btState.canAdvertise || false;
    } catch (e) {}

    if (!this.canAdvertise) {
      this.showToast('Sin permiso de advertising', 'warning');
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
      this.showToast('Error: ' + err.message, 'error');
    }
  }

  createDOM() {
    const tab = document.createElement('div');
    tab.id = 'ble-tab';
    tab.innerHTML = '<div style="writing-mode: vertical-rl; text-orientation: mixed; font-size: 11px; letter-spacing: 2px;">🔷 BLE</div><div id="ble-tab-badge" class="ble-tab-badge" style="display:none">0</div>';
    document.body.appendChild(tab);
    this.elements.tab = tab;

    const panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML = [
      '<div class="ble-header">',
      '  <h3>BLE Mesh</h3>',
      '  <button id="ble-close" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;">✕</button>',
      '</div>',
      '<div class="ble-main-controls">',
      '  <button id="ble-visibility-btn" class="ble-btn-visibility btn-visibility-off">',
      '    <span class="btn-icon">👁</span><span>Visibilidad</span>',
      '  </button>',
      '  <button id="ble-scan-btn" class="ble-btn-discover">',
      '    <span id="text-discover">Descubrir</span>',
      '  </button>',
      '</div>',
      '<div class="ble-tabs">',
      '  <button class="ble-tab-btn active" data-tab="devices">Cercanos</button>',
      '  <button class="ble-tab-btn" data-tab="added">Agregados</button>',
      '  <button class="ble-tab-btn" data-tab="connected">Conectados</button>',
      '</div>',
      '<div id="tab-devices" class="ble-tab-content active">',
      '  <div id="ble-devices-list" class="ble-list"></div>',
      '</div>',
      '<div id="tab-added" class="ble-tab-content">',
      '  <div id="ble-added-list" class="ble-list"></div>',
      '</div>',
      '<div id="tab-connected" class="ble-tab-content">',
      '  <div id="ble-connected-list" class="ble-list"></div>',
      '</div>',
      '<div id="ble-status" class="ble-status-offline">OFFLINE</div>'
    ].join('');
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
    // FIX v3.5.3: CSS como string concatenado (evita template literals corruptos)
    style.textContent = [
      '#ble-tab { position: fixed; left: 0; top: 50%; transform: translateY(-50%); width: 44px; height: 100px; background: linear-gradient(180deg, #00d4ff, #0099cc); border-radius: 0 12px 12px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483644; color: #000; font-weight: bold; }',
      '.ble-tab-badge { position: absolute; top: 5px; right: -5px; background: #ff4444; color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; animation: pulse 2s infinite; }',
      '@keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }',
      '#ble-panel { position: fixed; top: 0; left: 0; width: 85vw; max-width: 400px; height: 100vh; background: rgba(10,10,15,0.98); transform: translateX(-100%); transition: transform 0.3s ease; z-index: 2147483645; color: #fff; padding: 20px; overflow-y: auto; }',
      '#ble-panel.active { transform: translateX(0); }',
      '#ble-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; z-index: 2147483644; backdrop-filter: blur(4px); }',
      '#ble-overlay.active { display: block; }',
      '.ble-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px; }',
      '.ble-tabs { display: flex; gap: 8px; margin-bottom: 15px; }',
      '.ble-tab-btn { flex: 1; padding: 10px 4px; background: #222; border: 1px solid #333; border-radius: 6px; color: #888; cursor: pointer; font-size: 11px; }',
      '.ble-tab-btn.active { background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; font-weight: bold; border-color: #00d4ff; }',
      '.ble-tab-content { display: none; }',
      '.ble-tab-content.active { display: block; }',
      '.ble-main-controls { display: flex; gap: 12px; justify-content: center; align-items: center; margin-bottom: 10px; }',
      '.ble-secondary-controls { margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; }',
      '.ble-btn-visibility { flex: 1; max-width: 140px; height: 48px; border-radius: 12px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.3s ease; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
