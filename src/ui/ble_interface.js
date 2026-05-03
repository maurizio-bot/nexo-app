/**
 * BLE Interface v4.0.0-ARCH
 * UX1+UX2: Bottom bar CHAT/BLE/CONFIG + Header NEXO + Panel BLE overlay
 * NO se toca lógica nativa BLE, permisos, scan, GATT, ni contactos.
 */

export function initBLEInterface(bleMesh) {
  const instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}

const BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v2';

function _getBLEContacts() {
  try {
    const raw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function _normalizeId(id) {
  return (id || '').toString().toLowerCase().trim();
}

function _addBLEContact(device) {
  const contacts = _getBLEContacts();
  const id = _normalizeId(device.id || device.address);
  if (!id) return false;
  
  const existingIndex = contacts.findIndex(c => _normalizeId(c.id || c.address) === id);
  const newContact = { 
    id, 
    address: _normalizeId(device.address || device.id), 
    name: device.name || 'NEXO Device', 
    rssi: device.rssi || null, 
    addedAt: Date.now() 
  };
  
  if (existingIndex >= 0) {
    contacts[existingIndex] = { ...contacts[existingIndex], ...newContact, addedAt: Date.now() };
  } else {
    contacts.push(newContact);
  }
  
  localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
  return true;
}

function _removeBLEContact(deviceId) {
  const normalizedId = _normalizeId(deviceId);
  const contacts = _getBLEContacts().filter(c => _normalizeId(c.id || c.address) !== normalizedId);
  localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}

function _isBLEContact(deviceId) {
  const normalizedId = _normalizeId(deviceId);
  return _getBLEContacts().some(c => _normalizeId(c.id || c.address) === normalizedId);
}

function _getContactName(deviceId) {
  const normalizedId = _normalizeId(deviceId);
  const c = _getBLEContacts().find(c => _normalizeId(c.id || c.address) === normalizedId);
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
    this._scanTimeout = null;
    this._currentTab = 'main'; // UX1 FIX: tracking de tab activo
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
      this._loadLocalDeviceInfo();
    }
    return this;
  }

  async _loadLocalDeviceInfo() {
    if (!this.nativePlugin || !this.nativePlugin.getLocalDeviceInfo) return;
    try {
      const info = await this.nativePlugin.getLocalDeviceInfo();
      this.localDeviceName = info.deviceName || 'NEXO Device';
      this.localDeviceAddress = _normalizeId(info.deviceAddress);
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
      const deviceId = _normalizeId(data.deviceId);
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
      const deviceId = _normalizeId(data.deviceId);
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
      const deviceId = _normalizeId(data.deviceId);
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
        await this.nativePlugin.forceReconnect({ deviceId });
      } catch (e) {
        const timer = setTimeout(attemptReconnect, 3000);
        this._reconnectTimers.set(deviceId, timer);
      }
    };
    attemptReconnect();
  }

  _cancelReconnect(deviceId) {
    const timer = this._reconnectTimers.get(deviceId);
    if (timer) { clearTimeout(timer); this._reconnectTimers.delete(deviceId); }
  }

  _setupNativeStateListeners() {
    if (!this.nativePlugin) return;
    this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', (data) => {
      const deviceId = _normalizeId(data.deviceId);
      this._setDeviceState(deviceId, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
      const device = this.connectedDevices.get(deviceId);
      if (device) { device.servicesReady = true; this.connectedDevices.set(deviceId, device); }
    });
    this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', (data) => {
      const deviceId = _normalizeId(data.deviceId);
      this._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, direction: this._getDeviceState(deviceId).direction || 'unknown' });
      this._processPendingMessages(deviceId);
    });
    this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', (data) => {
      const deviceId = _normalizeId(data.deviceId);
      if (data.recoverable !== false && data.attempt < (data.maxAttempts || 3)) {
        this._setDeviceState(deviceId, BLE_STATES.CONNECTING, { attempt: data.attempt, message: `Reintentando...` });
      } else {
        this._setDeviceState(deviceId, BLE_STATES.ERROR, { lastError: data.reason });
        this.showToast(`❌ Conexión fallida: ${data.reason}`, 'error');
      }
    });
    this._nativeStackBrokenListener = this.nativePlugin.addListener('onBluetoothStackBroken', (data) => {
      this.showToast('⚠️ Bluetooth necesita reiniciarse', 'warning', 8000);
    });
  }

  _setDeviceState(deviceId, state, meta = {}) {
    this._deviceStates.set(deviceId, { state, ...meta, timestamp: Date.now() });
    this.renderConnectedList();
  }

  _getDeviceState(deviceId) {
    return this._deviceStates.get(deviceId) || { state: BLE_STATES.DISCONNECTED };
  }

  _setupNativePayloadListener() {
    if (!this.nativePlugin) return;
    if (this._nativePayloadListener) this._nativePayloadListener.remove();
    this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', (data) => {
      const deviceId = _normalizeId(data.deviceId);
      let messageId = null;
      let senderName = data.senderName || null;
      let content = data.content || data.data || '';
      try {
        const json = JSON.parse(data.data || '{}');
        if (json.messageId) messageId = json.messageId;
        if (json.senderName && !senderName) senderName = json.senderName;
        if (json.content) content = json.content;
      } catch (e) {}
      if (!senderName) senderName = _getContactName(deviceId) || 'NEXO Peer';
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
      if (this._activeChatDeviceId !== deviceId) {
        this.showToast('📨 Mensaje de ' + senderName, 'info');
        this.newDevicesCount++;
        this.updateBadge();
      }
    });
  }

  async _processPendingMessages(deviceId) {
    const queue = this._pendingMessageQueue.get(deviceId);
    if (!queue || queue.length === 0) return;
    this._pendingMessageQueue.delete(deviceId);
    for (const item of queue) {
      try { await this._sendMessageNative(deviceId, item.content); item.resolve(); }
      catch (e) { item.reject(e); }
    }
  }

  async _sendMessageNative(deviceId, content) {
    if (!this.nativePlugin) throw new Error('Plugin no disponible');
    await this.nativePlugin.sendMessage({ deviceId, message: content });
  }

  // ==================== FIX v3.0.1: Visibilidad ====================

  async _initVisibility() {
    if (this.isDummyMode) return;
    try {
      const btState = await this.nativePlugin.isBluetoothEnabled();
      this.canAdvertise = btState.enabled === true;
      
      const adState = await this.nativePlugin.isAdvertising();
      this.isAdvertising = adState.isAdvertising === true;
      this.updateVisibilityButton();
      this._setupNativeAdvertisingListeners();
    } catch (err) {
      console.warn('[BLEInterface] _initVisibility error:', err);
      this.canAdvertise = false;
      this.isAdvertising = false;
      this.updateVisibilityButton();
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
    this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', (data) => {
      this.isAdvertising = false;
      this.updateVisibilityButton();
      const reason = data?.reason || '';
      if (reason === 'Advertiser null') {
        this.showToast('⚠️ Advertising no soportado en este dispositivo', 'warning', 5000);
      } else {
        this.showToast('❌ Error al activar visibilidad: ' + reason, 'error');
      }
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

  // ==================== Fin FIX ====================

  // ==================== UX1+UX2 FIX: DOM completamente nuevo ====================

  createDOM() {
    // Eliminar elementos viejos si existen (por si hay duplicados)
    const oldTab = document.getElementById('ble-tab');
    if (oldTab) oldTab.remove();
    const oldOverlay = document.getElementById('ble-overlay');
    if (oldOverlay) oldOverlay.remove();

    // 1. Header NEXO
    const header = document.createElement('div');
    header.id = 'nexo-header';
    header.innerHTML = `<h1>NEXO</h1>`;
    document.body.appendChild(header);
    this.elements.header = header;

    // 2. Bottom bar: CHAT | BLE | CONFIG
    const bottomBar = document.createElement('div');
    bottomBar.id = 'nexo-bottom-bar';
    bottomBar.innerHTML = `
      <button id="nexo-btn-chat" class="nexo-nav-btn" data-nav="chat">
        <span class="nav-icon">💬</span>
        <span class="nav-label">CHAT</span>
      </button>
      <button id="nexo-btn-ble" class="nexo-nav-btn active" data-nav="ble">
        <span class="nav-icon">🔷</span>
        <span class="nav-label">BLE</span>
      </button>
      <button id="nexo-btn-config" class="nexo-nav-btn" data-nav="config">
        <span class="nav-icon">⚙️</span>
        <span class="nav-label">CONFIG</span>
      </button>
    `;
    document.body.appendChild(bottomBar);
    this.elements.bottomBar = bottomBar;

    // 3. Badge sobre botón BLE
    const bleBtn = bottomBar.querySelector('#nexo-btn-ble');
    const badge = document.createElement('div');
    badge.id = 'ble-tab-badge';
    badge.className = 'ble-tab-badge';
    badge.style.display = 'none';
    bleBtn.appendChild(badge);
    this.elements.badge = badge;

    // 4. Panel BLE — overlay completo entre header y bottom bar
    const panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML = `
      <div class="ble-header"><h3>🔷 BLE Mesh</h3><button id="ble-close">✕</button></div>
      <div class="ble-tabs">
        <button class="ble-tab-btn active" data-tab="discovery">Descubrir</button>
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
        <div class="ble-list" id="ble-devices-list"><p class="ble-empty">Presiona buscar para encontrar dispositivos cercanos</p></div>
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

    // 5. Placeholder CONFIG
    const configPanel = document.createElement('div');
    configPanel.id = 'nexo-config-panel';
    configPanel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:16px;">
        <span style="font-size:48px;">⚙️</span>
        <p style="color:#666;font-size:16px;">Configuración próximamente</p>
      </div>
    `;
    document.body.appendChild(configPanel);
    this.elements.configPanel = configPanel;

    // Referencias internas
    this.elements.visibilityBtn = document.getElementById('ble-visibility-btn');
    this.elements.scanBtn = document.getElementById('ble-scan-btn');
    this.elements.closeBtn = document.getElementById('ble-close');
    this.elements.devicesList = document.getElementById('ble-devices-list');
    this.elements.addedList = document.getElementById('ble-added-list');
    this.elements.connectedList = document.getElementById('ble-connected-list');
    this.elements.status = document.getElementById('ble-status');
  }

  injectStyles() {
    if (document.getElementById('ble-styles')) return;
    const style = document.createElement('style');
    style.id = 'ble-styles';
    style.textContent = `
      /* ===== UX1+UX2: Ocultar elementos viejos ===== */
      #ble-tab { display: none !important; }
      #ble-overlay { display: none !important; }

      /* ===== Header NEXO ===== */
      #nexo-header {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 56px;
        background: #000000;
        border-bottom: 1px solid #222222;
        display: flex;
        align-items: center;
        padding: 0 16px;
        z-index: 2147483640;
      }
      #nexo-header h1 {
        color: #ffffff;
        font-size: 20px;
        font-weight: 700;
        letter-spacing: 1px;
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      /* ===== Bottom bar ===== */
      #nexo-bottom-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 56px;
        background: #0a0a0a;
        border-top: 1px solid #222222;
        display: flex;
        z-index: 2147483640;
      }
      .nexo-nav-btn {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        color: #888888;
        font-size: 10px;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .nexo-nav-btn .nav-icon {
        font-size: 20px;
        margin-bottom: 2px;
        transition: transform 0.2s ease;
      }
      .nexo-nav-btn.active {
        color: #00d4ff;
      }
      .nexo-nav-btn.active .nav-icon {
        transform: scale(1.1);
      }
      .nexo-nav-btn:active {
        transform: scale(0.95);
      }

      /* ===== Badge en bottom bar ===== */
      .ble-tab-badge {
        position: absolute;
        top: 2px;
        right: calc(50% - 20px);
        background: #ff4444;
        color: white;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
        animation: pulse 2s infinite;
        z-index: 10;
      }
      @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }

      /* ===== Panel BLE — overlay completo ===== */
      #ble-panel {
        position: fixed;
        top: 56px;
        left: 0;
        right: 0;
        bottom: 56px;
        background: rgba(10, 10, 15, 0.98);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
        z-index: 2147483645;
        color: #fff;
        padding: 16px 16px 24px 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
      }
      #ble-panel.active {
        opacity: 1;
        pointer-events: auto;
      }

      /* ===== Config panel ===== */
      #nexo-config-panel {
        position: fixed;
        top: 56px;
        left: 0;
        right: 0;
        bottom: 56px;
        background: #000000;
        display: none;
        z-index: 2147483635;
        color: #fff;
      }

      /* ===== Estilos internos BLE (sin cambios funcionales) ===== */
      .ble-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px; }
      .ble-tabs { display: flex; gap: 8px; margin-bottom: 15px; }
      .ble-tab-btn { flex: 1; padding: 10px 4px; background: #222; border: 1px solid #333; border-radius: 6px; color: #888; cursor: pointer; font-size: 11px; font-family: inherit; }
      .ble-tab-btn.active { background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; font-weight: bold; border-color: #00d4ff; }
      .ble-tab-content { display: none; }
      .ble-tab-content.active { display: block; }
      .ble-main-controls { display: flex; gap: 12px; justify-content: center; align-items: center; margin-bottom: 10px; }
      .ble-secondary-controls { margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; }
      .ble-btn-visibility { flex: 1; max-width: 140px; height: 48px; border-radius: 12px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.3s ease; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: inherit; }
      .ble-btn-visibility.btn-visibility-warning { background: #4A3A00 !important; color: #FFCC00 !important; border: 1px solid #FFCC00 !important; }
      .ble-btn-visibility.btn-visibility-off { background: #3A3A3A; color: #888888; }
      .ble-btn-visibility.btn-visibility-on { background: #00D9FF; color: #000000; box-shadow: 0 0 12px rgba(0, 217, 255, 0.4); }
      .ble-btn-discover { flex: 1.2; height: 56px; border-radius: 14px; border: none; font-weight: 700; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3); transition: all 0.3s ease; font-family: inherit; }
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
      .ble-btn-add { padding: 8px 16px; background: #00ff88; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; font-family: inherit; }
      .ble-btn-write { padding: 8px 16px; background: #00d4ff; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; font-family: inherit; }
      .ble-btn-write:disabled { background: #555; color: #aaa; cursor: not-allowed; }
      .ble-btn-disconnect { padding: 6px 12px; background: #ff4444; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-family: inherit; }
      .ble-toast { position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: #fff; font-weight: bold; z-index: 2147483646; animation: fadeInUp 0.3s ease; }
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
    // UX2 FIX: Bottom bar navigation
    document.getElementById('nexo-btn-chat').addEventListener('click', () => this.switchToTab('chat'));
    document.getElementById('nexo-btn-ble').addEventListener('click', () => this.switchToTab('ble'));
    document.getElementById('nexo-btn-config').addEventListener('click', () => this.switchToTab('config'));

    // BLE panel close → volver a pantalla limpia
    this.elements.closeBtn.addEventListener('click', () => this.switchToTab('main'));

    // BLE controls (sin cambios)
    this.elements.visibilityBtn.addEventListener('click', () => this.toggleVisibility());
    this.elements.scanBtn.addEventListener('click', () => this.toggleScan());
    document.querySelectorAll('.ble-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });
  }

  // UX1 FIX: Pantalla limpia inicial
  showMainScreen() {
    this._currentTab = 'main';
    
    // Ocultar chat para pantalla limpia
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) messagesContainer.style.display = 'none';
    
    // Asegurar header y bottom bar visibles
    if (this.elements.header) this.elements.header.style.display = 'flex';
    if (this.elements.bottomBar) this.elements.bottomBar.style.display = 'flex';
    
    // Ocultar todos los paneles
    if (this.elements.panel) this.elements.panel.classList.remove('active');
    if (this.elements.configPanel) this.elements.configPanel.style.display = 'none';
    
    // Reset botones
    document.querySelectorAll('.nexo-nav-btn').forEach(b => b.classList.remove('active'));
    
    // Fondo negro absoluto
    document.body.style.background = '#000000';
    const app = document.getElementById('app');
    if (app) {
      app.style.background = '#000000';
      app.classList.remove('hidden');
    }
  }

  // UX2 FIX: Cambiar entre tabs
  switchToTab(tab) {
    this._currentTab = tab;
    
    // Ocultar todo primero
    if (this.elements.panel) this.elements.panel.classList.remove('active');
    if (this.elements.configPanel) this.elements.configPanel.style.display = 'none';
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) messagesContainer.style.display = 'none';
    
    // Reset botones
    document.querySelectorAll('.nexo-nav-btn').forEach(b => b.classList.remove('active'));
    
    if (tab === 'ble') {
      document.getElementById('nexo-btn-ble').classList.add('active');
      this.elements.panel.classList.add('active');
      this._loadConnectedDevices();
      this.renderAddedList();
    } else if (tab === 'chat') {
      document.getElementById('nexo-btn-chat').classList.add('active');
      if (messagesContainer) messagesContainer.style.display = 'block';
    } else if (tab === 'config') {
      document.getElementById('nexo-btn-config').classList.add('active');
      if (this.elements.configPanel) this.elements.configPanel.style.display = 'block';
    } else if (tab === 'main') {
      // Pantalla limpia, ningún botón activo
    }
  }

  // Legacy: redirigir a switchToTab
  togglePanel() {
    if (this._currentTab === 'ble') {
      this.switchToTab('main');
    } else {
      this.switchToTab('ble');
    }
  }

  switchTab(tabName) {
    document.querySelectorAll('.ble-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.ble-tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    if (tabName === 'added') this.renderAddedList();
    if (tabName === 'discovery' && !this.isScanning && !this.isDummyMode) {
      this.toggleScan();
    }
  }

  // ==================== Fin UX1+UX2 FIX ====================

  async toggleScan() {
    if (this.isDummyMode) return;
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
        this._scanTimeout = setTimeout(() => {
          if (this.isScanning) this.toggleScan();
        }, 15000);
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
      if (this._scanTimeout) { clearTimeout(this._scanTimeout); this._scanTimeout = null; }
    }
  }

  onDeviceFound(device) {
    let id = _normalizeId(device.id || device.address);
    if (!id || id === 'null' || id === 'undefined') return;
    if (this.localDeviceAddress && id === this.localDeviceAddress) return;
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
    const id = _normalizeId(device.id || device.address);
    this.connectedDevices.set(id, device);
    this.renderConnectedList();
    this.showToast('✅ Conectado: ' + (device.name || 'Dispositivo'), 'success');
  }

  onDeviceDisconnected(device) {
    const id = _normalizeId(device.id || device.address);
    this.connectedDevices.delete(id);
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
      devices.forEach(d => this.connectedDevices.set(_normalizeId(d.id || d.address || d.deviceId), d));
      this.renderConnectedList();
    } catch (err) {}
  }

  async addContact(deviceId) {
    const normalizedId = _normalizeId(deviceId);
    console.log('[BLEInterface] addContact llamado con ID:', normalizedId);
    
    const device = this.foundDevices.get(normalizedId) || this.connectedDevices.get(normalizedId);
    if (!device) { 
      this.showToast('❌ Dispositivo no encontrado: ' + this._formatId(normalizedId), 'error'); 
      return; 
    }
    
    const success = _addBLEContact(device);
    if (success) {
      this.showToast('✅ Agregado a contactos', 'success');
      this.renderDevicesList();
      this.renderAddedList();
    } else {
      this.showToast('⚠️ No se pudo agregar (ID inválido o error)', 'warning');
    }
  }

  async removeContact(deviceId) {
    _removeBLEContact(deviceId);
    this.showToast('❌ Eliminado', 'info');
    this.renderAddedList();
    this.renderDevicesList();
  }

  async openChat(deviceId) {
    const normalizedId = _normalizeId(deviceId);
    let device = this.foundDevices.get(normalizedId) || this.connectedDevices.get(normalizedId);
    const contact = _getBLEContacts().find(c => _normalizeId(c.id || c.address) === normalizedId);
    if (!device && contact) device = { id: contact.id || contact.address, address: contact.address, name: contact.name || 'NEXO Device', rssi: contact.rssi };
    if (!device) { this.showToast('❌ Contacto no disponible', 'error'); return; }
    
    this._activeChatDeviceId = normalizedId;
    const displayName = contact?.name || device.name || 'NEXO Peer';
    
    const state = this._getDeviceState(normalizedId);
    const isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
    
    if (!isFullyReady && this.nativePlugin) {
      try {
        const connResult = await this.nativePlugin.connectToDevice({ deviceId: normalizedId });
        if (connResult && connResult.connected && !connResult.alreadyConnected) {
          this.showToast('🔗 Conectando canal BLE...', 'info');
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
            const checkReady = () => {
              const s = this._getDeviceState(normalizedId);
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
    
    // UX2 FIX: Al abrir chat desde BLE, cambiar a tab CHAT automáticamente
    this.switchToTab('chat');
  }

  renderDevicesList() {
    const list = this.elements.devicesList;
    if (this.foundDevices.size === 0) {
      list.innerHTML = '<p class="ble-empty">Presiona buscar para encontrar dispositivos cercanos</p>';
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
      const id = contact.id || contact.address;
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
      if (this.nativePlugin) await this.nativePlugin.connectToDevice({ deviceId: _normalizeId(deviceId) });
    } catch (err) { this.showToast('Error al conectar', 'error'); }
  }

  async disconnect(deviceId) {
    if (this.isDummyMode) return;
    try {
      const normalizedId = _normalizeId(deviceId);
      this._cancelReconnect(normalizedId);
      if (this.nativePlugin) await this.nativePlugin.disconnectDevice({ deviceId: normalizedId });
      if (this._activeChatDeviceId === normalizedId) this._activeChatDeviceId = null;
    } catch (err) {}
  }

  updateBadge() {
    const badge = this.elements.badge;
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
      }
      this.elements.status.textContent = state.toUpperCase();
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
    if (this._scanTimeout) clearTimeout(this._scanTimeout);
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
    if (this.isScanning) this.toggleScan();
    
    // UX1+UX2 FIX: Limpiar nuevos elementos
    if (this.elements.header) this.elements.header.remove();
    if (this.elements.bottomBar) this.elements.bottomBar.remove();
    if (this.elements.configPanel) this.elements.configPanel.remove();
  }
}

window.bleInterface = null;
