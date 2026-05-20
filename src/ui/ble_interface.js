// BLE Interface v3.5.4-FIX
// Ubicacion: src/ui/ble_interface.js
// FIX v3.5.4: CSS movido a archivo separado ble_interface.css
//             para evitar corrupcion por cat << EOF en workflow

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
    this.loadCSS();
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

  loadCSS() {
    if (document.getElementById('ble-styles-link')) return;
    const link = document.createElement('link');
    link.id = 'ble-styles-link';
    link.rel = 'stylesheet';
    link.href = 'assets/css/ble_interface.css';
    document.head.appendChild(link);
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
    document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');
    if (tabName === 'added') this.renderAddedList();
  }

  async toggleScan() {
    if (this.isDummyMode) return;

    const permsResult = await this._ensurePermissions();
    if (!permsResult?.success) {
      this.showToast('Permisos BLE requeridos. Concede los permisos en Ajustes.', 'warning', 5000);
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
      this.showToast('Buscando dispositivos...', 'info');
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
    this.showToast('Conectado: ' + (device.name || 'Dispositivo'), 'success');
  }

  onDeviceDisconnected(device) {
    const nid = _normId(device.id || device.address);
    this.connectedDevices.delete(nid);
    this.renderConnectedList();
    this.showToast('Desconectado', 'info');
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
    if (!device) { this.showToast('Dispositivo no encontrado', 'error'); return; }
    if (_addBLEContact(device)) {
      this.showToast('Agregado a contactos', 'success');
      this.renderDevicesList();
    } else {
      this.showToast('Ya esta en contactos', 'warning');
    }
  }

  async removeContact(deviceId) {
    _removeBLEContact(deviceId);
    this.showToast('Eliminado', 'info');
    this.renderAddedList();
    this.renderDevicesList();
  }

  async openChat(deviceId) {
    const nid = _normId(deviceId);
    let device = this.foundDevices.get(nid) || this.connectedDevices.get(nid);
    const contact = _getBLEContacts().find(c => _normId(c.id || c.address) === nid);
    if (!device && contact) device = { id: contact.id || contact.address, address: contact.address, name: contact.name || 'NEXO Device', rssi: contact.rssi };
    if (!device) { this.showToast('Contacto no disponible', 'error'); return; }

    this._activeChatDeviceId = nid;
    this.newDevicesCount = 0;
    this.updateBadge();

    const displayName = contact?.name || device.name || 'NEXO Peer';
    const state = this._getDeviceState(nid);
    const isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
    const isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;

    if (!isFullyReady && isConnecting && this.nativePlugin) {
      this.showToast('Conexion en progreso, esperando canal...', 'info');
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
        this.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
      }
    }

    if (!isFullyReady && !isConnecting && this.nativePlugin) {
      const permsResult = await this._ensurePermissions();
      if (!permsResult?.success) {
        this.showToast('Permisos BLE requeridos para conectar', 'warning', 5000);
        return;
      }

      try {
        console.log('[BLEInterface] Conectando a', nid, '...');
        const connResult = await this.nativePlugin.connectToDevice({ deviceId: device.id || device.address || nid });
        console.log('[BLEInterface] connectToDevice result:', connResult);
        if (connResult && connResult.connected && !connResult.alreadyConnected) {
          this.showToast('Conectando canal BLE...', 'info');
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
        console.warn('[BLEInterface] Conexion/timeout:', e.message);
        this.showToast('Canal aun no listo. Intente enviar en unos segundos.', 'warning');
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
      list.innerHTML = '<div class="ble-empty">Presiona Descubrir para encontrar dispositivos cercanos</div>';
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
        ? '<button class="ble-btn-write" onclick="window.bleInterface.openChat(\'' + id + '\')">Chat</button>'
        : '<button class="ble-btn-add" onclick="window.bleInterface.addContact(\'' + id + '\')">Agregar</button>';
      item.innerHTML = [
        '<div class="ble-device-info">',
        '  <div class="ble-device-name">' + (device.name || 'NEXO Device') + '</div>',
        '  <div class="ble-device-id">' + this._formatId(id) + '</div>',
        '  <div class="ble-device-rssi">' + (device.rssi || '?') + ' dBm</div>',
        '</div>',
        '<div class="ble-device-actions">' + actionHtml + '</div>'
      ].join('');
      list.appendChild(item);
    });
  }

  renderAddedList() {
    const list = this.elements.addedList;
    const contacts = _getBLEContacts();
    if (contacts.length === 0) {
      list.innerHTML = '<div class="ble-empty">No hay contactos agregados</div>';
      return;
    }
    list.innerHTML = '';
    contacts.forEach((contact) => {
      const id = _normId(contact.id || contact.address);
      const item = document.createElement('div');
      item.className = 'ble-device-item';
      item.innerHTML = [
        '<div class="ble-device-info">',
        '  <div class="ble-device-name">' + (contact.name || 'NEXO Device') + '</div>',
        '  <div class="ble-device-id">' + this._formatId(id) + '</div>',
        '</div>',
        '<div class="ble-device-actions">',
        '  <button class="ble-btn-write" onclick="window.bleInterface.openChat(\'' + id + '\')">Chat</button>',
        '  <button class="ble-btn-disconnect" onclick="window.bleInterface.removeContact(\'' + id + '\')">🗑️</button>',
        '</div>'
      ].join('');
      list.appendChild(item);
    });
  }

  renderConnectedList() {
    const list = this.elements.connectedList;
    if (this.connectedDevices.size === 0) {
      list.innerHTML = '<div class="ble-empty">No hay dispositivos conectados</div>';
      return;
    }
    list.innerHTML = '';
    this.connectedDevices.forEach((device, id) => {
      const state = this._getDeviceState(id);
      const stateLabel = this._renderStateLabel(state);
      const isReady = state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.READY_TO_CHAT;
      const item = document.createElement('div');
      item.className = 'ble-device-item';
      item.innerHTML = [
        '<div class="ble-device-info">',
        '  <div class="ble-device-name">' + (device.name || 'NEXO Peer') + '</div>',
        '  <div class="ble-device-id">' + this._formatId(id) + '</div>',
        '  <div class="ble-state-' + state.state + '">● ' + (device.direction || 'Conectado') + ' ' + stateLabel + '</div>',
        '</div>',
        '<div class="ble-device-actions">',
        '  <button class="ble-btn-write" onclick="window.bleInterface.openChat(\'' + id + '\')"' + (!isReady ? ' disabled' : '') + '>Chat</button>',
        '  <button class="ble-btn-disconnect" onclick="window.bleInterface.disconnect(\'' + id + '\')">❌</button>',
        '</div>'
      ].join('');
      list.appendChild(item);
    });
  }

  _renderStateLabel(state) {
    if (!state || !state.state) return '';
    switch (state.state) {
      case BLE_STATES.CONNECTING: return '⏳ ' + (state.message || 'Conectando...');
      case BLE_STATES.DISCOVERING_SERVICES: return '🔍 Descubriendo...';
      case BLE_STATES.NOTIFICATIONS_READY: return '✅ Canal listo';
      case BLE_STATES.READY_TO_CHAT: return '✅ Listo';
      case BLE_STATES.ERROR: return '❌ ' + (state.lastError || 'Error');
      case BLE_STATES.RECONNECTING: return '🔄 ' + (state.message || 'Reconectando...');
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
    toast.className = 'ble-toast ' + type;
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
    const styles = document.getElementById('ble-styles-link');
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
