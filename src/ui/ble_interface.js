/**
 * BLE Interface v4.2.0-ARCH
 * Simplificado: BLE tab = solo scan + lista devices. Sin advertising manual.
 * Advertising automático en nativo (BleService v3.0.2).
 * Tap device → auto-guarda contacto → abre CHAT.
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
    this.elements = {};
    this.newDevicesCount = 0;
    this._renderedDeviceIds = new Set();
    this.nativePlugin = window.Capacitor?.Plugins?.NexoBLE || null;
    this.isDummyMode = !bleMesh && !this.nativePlugin;
    this.meshType = this._detectMeshType();
    this.localDeviceName = 'NEXO Device';
    this.localDeviceAddress = null;
    this._activeChatDeviceId = null;
    this._deviceStates = new Map();
    this._receivedMessageIds = new Set();
    this._maxMessageIds = 1000;
    this._pendingMessageQueue = new Map();
    this._reconnectTimers = new Map();
    this._scanTimeout = null;
    this._timerInterval = null;
    this._currentTab = 'main';
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
      this._cancelReconnect(deviceId);
      const contactName = _getContactName(deviceId);
      const displayName = data.name || contactName || 'NEXO Peer';
      this.connectedDevices.set(deviceId, { id: deviceId, address: deviceId, name: displayName, direction: data.direction || 'unknown', servicesReady: data.servicesReady === true });
      if (data.direction === 'incoming') {
        this.showToast(`✅ Peer conectado: ${this._formatId(deviceId)}`, 'success');
      }
    });
    
    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', (data) => {
      const deviceId = _normalizeId(data.deviceId);
      this.connectedDevices.delete(deviceId);
      if (this._activeChatDeviceId === deviceId) {
        this.showToast('⚠️ Conexión BLE perdida', 'warning');
        this._startReconnect(deviceId);
      }
    });
  }

  _startReconnect(deviceId) {
    this._cancelReconnect(deviceId);
    this._setDeviceState(deviceId, BLE_STATES.RECONNECTING, { message: 'Reconectando...' });
    const attemptReconnect = async () => {
      if (this._activeChatDeviceId !== deviceId) return;
      try { await this.nativePlugin.forceReconnect({ deviceId }); }
      catch (e) {
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
      this._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true });
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

  createDOM() {
    const oldTab = document.getElementById('ble-tab');
    if (oldTab) oldTab.remove();
    const oldOverlay = document.getElementById('ble-overlay');
    if (oldOverlay) oldOverlay.remove();

    const header = document.createElement('div');
    header.id = 'nexo-header';
    header.innerHTML = `<h1>NEXO</h1>`;
    document.body.appendChild(header);
    this.elements.header = header;

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

    const bleBtn = bottomBar.querySelector('#nexo-btn-ble');
    const badge = document.createElement('div');
    badge.id = 'ble-tab-badge';
    badge.className = 'ble-tab-badge';
    badge.style.display = 'none';
    bleBtn.appendChild(badge);
    this.elements.badge = badge;

    // Panel BLE simplificado: solo scan + lista de devices
    const panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML = `
      <div class="ble-header">
        <h3>🔷 BLE Mesh</h3>
        <button id="ble-close">✕</button>
      </div>
      <div class="ble-scan-status">
        <span id="ble-status" class="ble-status-offline">OFFLINE</span>
        <span id="ble-scan-timer"></span>
      </div>
      <div class="ble-list" id="ble-devices-list">
        <p class="ble-empty">Buscando dispositivos cercanos...</p>
      </div>
    `;
    document.body.appendChild(panel);
    this.elements.panel = panel;

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

    this.elements.devicesList = document.getElementById('ble-devices-list');
    this.elements.status = document.getElementById('ble-status');
    this.elements.scanTimer = document.getElementById('ble-scan-timer');
    this.elements.closeBtn = document.getElementById('ble-close');
  }

  injectStyles() {
    if (document.getElementById('ble-styles')) return;
    const style = document.createElement('style');
    style.id = 'ble-styles';
    style.textContent = `
      #ble-tab { display: none !important; }
      #ble-overlay { display: none !important; }

      #nexo-header {
        position: fixed;
        top: 0; left: 0; right: 0;
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

      #nexo-bottom-bar {
        position: fixed;
        bottom: 0; left: 0; right: 0;
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

      .ble-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        border-bottom: 1px solid #333;
        padding-bottom: 10px;
      }
      .ble-header h3 {
        margin: 0;
        font-size: 18px;
      }
      .ble-scan-status {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
      }
      #ble-status {
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .ble-status-offline { background: #333; color: #888; }
      .ble-status-online { background: #00d4ff; color: #000; }
      .ble-status-scanning { background: #ffaa00; color: #000; animation: blink 1s infinite; }
      @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.7; } }
      
      .ble-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        overflow-y: auto;
      }
      .ble-empty {
        text-align: center;
        color: #666;
        padding: 40px 20px;
        font-style: italic;
        font-size: 14px;
      }
      .ble-device-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px;
        background: rgba(255,255,255,0.05);
        border: 1px solid #333;
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .ble-device-item:hover {
        background: rgba(0,212,255,0.1);
        border-color: #00d4ff;
      }
      .ble-device-item.new {
        border-left: 3px solid #00d4ff;
        animation: slideIn 0.3s ease;
      }
      @keyframes slideIn {
        from { opacity: 0; transform: translateX(-10px); }
        to { opacity: 1; transform: translateX(0); }
      }
      .ble-device-info {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
      }
      .ble-device-name {
        font-weight: bold;
        color: #fff;
        font-size: 15px;
      }
      .ble-device-id {
        font-size: 11px;
        color: #888;
        margin-top: 2px;
      }
      .ble-device-rssi {
        font-size: 12px;
        color: #00d4ff;
        margin-top: 4px;
      }
      .ble-device-actions {
        display: flex;
        align-items: center;
        flex-shrink: 0;
      }
      .ble-btn-chat {
        padding: 10px 18px;
        background: #00d4ff;
        color: #000;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: bold;
        font-family: inherit;
      }
      .ble-toast {
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        padding: 12px 24px;
        border-radius: 8px;
        color: #fff;
        font-weight: bold;
        z-index: 2147483646;
        animation: fadeInUp 0.3s ease;
      }
      .ble-toast.success { background: #00d4ff; color: #000; }
      .ble-toast.error { background: #ff4444; }
      .ble-toast.warning { background: #ffaa00; color: #000; }
      .ble-toast.info { background: #444; }
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    document.getElementById('nexo-btn-chat').addEventListener('click', () => this.switchToTab('chat'));
    document.getElementById('nexo-btn-ble').addEventListener('click', () => this.switchToTab('ble'));
    document.getElementById('nexo-btn-config').addEventListener('click', () => this.switchToTab('config'));
    this.elements.closeBtn.addEventListener('click', () => this.switchToTab('main'));
  }

  showMainScreen() {
    this._currentTab = 'main';
    document.body.classList.remove('chat-active');
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) messagesContainer.style.display = 'none';
    if (this.elements.header) this.elements.header.style.display = 'flex';
    if (this.elements.bottomBar) this.elements.bottomBar.style.display = 'flex';
    if (this.elements.panel) this.elements.panel.classList.remove('active');
    if (this.elements.configPanel) this.elements.configPanel.style.display = 'none';
    document.querySelectorAll('.nexo-nav-btn').forEach(b => b.classList.remove('active'));
    document.body.style.background = '#000000';
    const app = document.getElementById('app');
    if (app) {
      app.style.background = '#000000';
      app.classList.remove('hidden');
    }
  }

  switchToTab(tab) {
    this._currentTab = tab;
    if (this.elements.panel) this.elements.panel.classList.remove('active');
    if (this.elements.configPanel) this.elements.configPanel.style.display = 'none';
    const messagesContainer = document.getElementById('messages-container');
    if (messagesContainer) messagesContainer.style.display = 'none';
    document.querySelectorAll('.nexo-nav-btn').forEach(b => b.classList.remove('active'));

    if (tab === 'ble') {
      document.body.classList.remove('chat-active');
      document.getElementById('nexo-btn-ble').classList.add('active');
      this.elements.panel.classList.add('active');
      this.startAutoScan();
    } else if (tab === 'chat') {
      document.body.classList.add('chat-active');
      document.getElementById('nexo-btn-chat').classList.add('active');
      if (messagesContainer) messagesContainer.style.display = 'block';
    } else if (tab === 'config') {
      document.body.classList.remove('chat-active');
      document.getElementById('nexo-btn-config').classList.add('active');
      if (this.elements.configPanel) this.elements.configPanel.style.display = 'block';
    } else if (tab === 'main') {
      document.body.classList.remove('chat-active');
    }
  }

  // Scan automático al entrar a BLE tab
  async startAutoScan() {
    if (this.isDummyMode) return;
    this.foundDevices.clear();
    this._renderedDeviceIds.clear();
    this.renderDevicesList();
    try {
      if (this.nativePlugin) await this.nativePlugin.startScan();
      this.isScanning = true;
      this.onScanStateChanged(true);
      this._scanTimeout = setTimeout(() => {
        if (this.isScanning) this.stopScan();
      }, 10000);
    } catch (err) {
      this.isScanning = false;
      this.showToast('❌ Error al iniciar scan', 'error');
    }
  }

  async stopScan() {
    if (!this.isScanning) return;
    try {
      if (this.nativePlugin) await this.nativePlugin.stopScan();
    } catch (e) {}
    this.isScanning = false;
    this.onScanStateChanged(false);
  }

  onScanStateChanged(isScanning) {
    this.isScanning = isScanning;
    if (isScanning) {
      this.elements.status.textContent = 'ESCANEANDO...';
      this.elements.status.className = 'ble-status-scanning';
      this.elements.scanTimer.textContent = '10s';
      let remaining = 10;
      this._timerInterval = setInterval(() => {
        remaining--;
        if (this.elements.scanTimer) this.elements.scanTimer.textContent = remaining + 's';
        if (remaining <= 0) clearInterval(this._timerInterval);
      }, 1000);
    } else {
      this.elements.status.textContent = 'POWEREDON';
      this.elements.status.className = 'ble-status-online';
      if (this.elements.scanTimer) this.elements.scanTimer.textContent = '';
      if (this._timerInterval) clearInterval(this._timerInterval);
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

  // Tap en device → auto-guarda contacto → abre CHAT
  async openDeviceChat(deviceId) {
    const normalizedId = _normalizeId(deviceId);
    const device = this.foundDevices.get(normalizedId) || this.connectedDevices.get(normalizedId);
    if (!device) {
      this.showToast('❌ Dispositivo no encontrado', 'error');
      return;
    }

    // Auto-guardar contacto
    _addBLEContact(device);
    this.showToast(`✅ ${device.name || 'NEXO Device'} agregado`, 'success');

    this._activeChatDeviceId = normalizedId;
    const displayName = device.name || 'NEXO Peer';

    // Abrir chat
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.classList.remove('hidden');
    const nameInput = document.getElementById('chat-contact-name');
    const subtitle = document.getElementById('chat-contact-subtitle');
    if (nameInput) nameInput.value = displayName;
    if (subtitle) subtitle.textContent = 'BLUETOOTH';

    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', {
      detail: { contactId: device.id || device.address, name: displayName, address: device.address || device.id, transport: 'ble', rssi: device.rssi, source: 'ble_interface' }
    }));

    this.switchToTab('chat');
  }

  renderDevicesList() {
    const list = this.elements.devicesList;
    if (this.foundDevices.size === 0) {
      list.innerHTML = '<p class="ble-empty">Buscando dispositivos cercanos...</p>';
      return;
    }
    list.innerHTML = '';
    this.foundDevices.forEach((device, id) => {
      const isNew = !this._renderedDeviceIds.has(id);
      if (isNew) this._renderedDeviceIds.add(id);
      const item = document.createElement('div');
      item.className = 'ble-device-item' + (isNew ? ' new' : '');
      item.onclick = () => this.openDeviceChat(id);
      item.innerHTML = `
        <div class="ble-device-info">
          <span class="ble-device-name">${device.name || 'NEXO Device'}</span>
          <span class="ble-device-id">${this._formatId(id)}</span>
          <span class="ble-device-rssi">📶 ${device.rssi || '?'} dBm</span>
        </div>
        <div class="ble-device-actions">
          <button class="ble-btn-chat" onclick="event.stopPropagation(); bleInterface.openDeviceChat('${id}')">💬 Chat</button>
        </div>
      `;
      list.appendChild(item);
    });
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
    if (this._timerInterval) clearInterval(this._timerInterval);
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
    if (this.isScanning) this.stopScan();
    if (this.elements.header) this.elements.header.remove();
    if (this.elements.bottomBar) this.elements.bottomBar.remove();
    if (this.elements.configPanel) this.elements.configPanel.remove();
  }
}

window.bleInterface = null;
