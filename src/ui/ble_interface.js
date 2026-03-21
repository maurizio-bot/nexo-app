/**
 * BLE Interface v2.2-NAP
 * Sistema UI BLE con soporte Dual: NordicMesh + HybridMesh
 * 
 * FIXES NAP 2.0:
 * - Soporte API NordicMesh (startDiscovery) y HybridMesh (startScan)
 * - getState() vs getStatus() unificado
 * - Integración getConnectedDevices() para lista real
 * - NAP Error Codes UI_001-006
 */

// NAP 2.0 Error Codes UI
const UI_ERRORS = {
  UI_001: 'MESH_NOT_AVAILABLE',
  UI_002: 'SCAN_FAILED',
  UI_003: 'CONNECT_FAILED',
  UI_004: 'DISCONNECT_FAILED',
  UI_005: 'PERMISSION_DENIED',
  UI_006: 'TIMEOUT'
};

export class BLEInterface {
  constructor(bleMesh) {
    this.bleMesh = bleMesh;
    this.isScanning = false;
    this.foundDevices = new Map();
    this.connectedDevices = new Map(); // FIX: Track dispositivos conectados
    this.isVisible = false;
    this.elements = {};
    this.newDevicesCount = 0;
    this.isDummyMode = !bleMesh;
    this.meshType = this._detectMeshType(); // 'nordic' | 'hybrid' | 'none'
  }

  /**
   * NAP 2.0: Detectar tipo de mesh para API correcta
   */
  _detectMeshType() {
    if (!this.bleMesh) return 'none';
    // NordicMesh tiene getState, HybridMesh tiene getStatus
    if (typeof this.bleMesh.getState === 'function') return 'nordic';
    if (typeof this.bleMesh.getStatus === 'function') return 'hybrid';
    return 'unknown';
  }

  init() {
    this.createDOM();
    this.injectStyles();
    this.setupEventListeners();
    
    if (this.isDummyMode) {
      console.warn('[BLEInterface] Modo DUMMY - BLE no disponible');
      this.updateStatus('OFFLINE (Dummy)');
    } else {
      this.updateStatus();
      // FIX: Cargar dispositivos ya conectados al iniciar
      this._loadConnectedDevices();
    }
    
    return this;
  }

  createDOM() {
    // Tab - SIEMPRE visible
    const tab = document.createElement('div');
    tab.id = 'ble-tab';
    tab.innerHTML = `
      <div class="ble-tab-icon">🔷</div>
      <div class="ble-tab-label">BLE</div>
      <div class="ble-tab-badge" id="ble-tab-badge" style="display: none;">0</div>
    `;
    document.body.appendChild(tab);
    this.elements.tab = tab;

    // Panel con tabs para Discovery / Connected
    const panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML = `
      <div class="ble-header">
        <h3>🔷 BLE Mesh</h3>
        <button id="ble-close">✕</button>
      </div>
      
      <!-- Tabs -->
      <div class="ble-tabs">
        <button class="ble-tab-btn active" data-tab="discovery">Descubrir</button>
        <button class="ble-tab-btn" data-tab="connected">Conectados</button>
      </div>
      
      <div class="ble-controls">
        <button id="ble-scan-btn" class="ble-btn" ${this.isDummyMode ? 'disabled' : ''}>
          ${this.isDummyMode ? '⚠️ BLE No Disponible' : '📡 Buscar Dispositivos'}
        </button>
        <button id="ble-refresh-btn" class="ble-btn secondary" style="display: none;">
          🔄 Actualizar Lista
        </button>
        <span id="ble-status" class="ble-status-offline">OFFLINE</span>
      </div>
      
      <!-- Discovery Tab -->
      <div id="tab-discovery" class="ble-tab-content active">
        <div class="ble-list" id="ble-devices-list">
          <p class="ble-empty">${this.isDummyMode ? 'BLE Mesh no inicializado' : 'Presiona buscar para encontrar dispositivos cercanos'}</p>
        </div>
      </div>
      
      <!-- Connected Tab -->
      <div id="tab-connected" class="ble-tab-content">
        <div class="ble-list" id="ble-connected-list">
          <p class="ble-empty">No hay dispositivos conectados</p>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    this.elements.panel = panel;

    const overlay = document.createElement('div');
    overlay.id = 'ble-overlay';
    document.body.appendChild(overlay);
    this.elements.overlay = overlay;

    // Referencias
    this.elements.scanBtn = document.getElementById('ble-scan-btn');
    this.elements.refreshBtn = document.getElementById('ble-refresh-btn');
    this.elements.closeBtn = document.getElementById('ble-close');
    this.elements.devicesList = document.getElementById('ble-devices-list');
    this.elements.connectedList = document.getElementById('ble-connected-list');
    this.elements.status = document.getElementById('ble-status');
    this.elements.badge = document.getElementById('ble-tab-badge');
  }

  injectStyles() {
    if (document.getElementById('ble-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'ble-styles';
    style.textContent = `
      #ble-tab {
        position: fixed;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 44px;
        height: 100px;
        background: linear-gradient(180deg, #00d4ff, #0099cc);
        border-radius: 0 12px 12px 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 2147483644;
        color: #000;
        font-weight: bold;
        box-shadow: 2px 0 10px rgba(0,212,255,0.3);
      }
      #ble-tab.hidden { transform: translateY(-50%) translateX(-100%); }
      .ble-tab-badge {
        position: absolute;
        top: 5px;
        right: -5px;
        background: #ff4444;
        color: white;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        animation: pulse 2s infinite;
      }
      @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
      
      #ble-panel {
        position: fixed;
        top: 0;
        left: 0;
        width: 85vw;
        max-width: 400px;
        height: 100vh;
        background: rgba(10,10,15,0.98);
        transform: translateX(-100%);
        transition: transform 0.3s ease;
        z-index: 2147483645;
        color: #fff;
        padding: 20px;
        overflow-y: auto;
      }
      #ble-panel.active { transform: translateX(0); }
      
      #ble-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.6);
        display: none;
        z-index: 2147483644;
        backdrop-filter: blur(4px);
      }
      #ble-overlay.active { display: block; }
      
      .ble-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
        border-bottom: 1px solid #333;
        padding-bottom: 10px;
      }
      
      /* Tabs */
      .ble-tabs {
        display: flex;
        gap: 10px;
        margin-bottom: 15px;
      }
      .ble-tab-btn {
        flex: 1;
        padding: 10px;
        background: #222;
        border: 1px solid #333;
        border-radius: 6px;
        color: #888;
        cursor: pointer;
        font-size: 12px;
      }
      .ble-tab-btn.active {
        background: linear-gradient(135deg, #00d4ff, #0099cc);
        color: #000;
        font-weight: bold;
        border-color: #00d4ff;
      }
      .ble-tab-content { display: none; }
      .ble-tab-content.active { display: block; }
      
      .ble-btn {
        width: 100%;
        padding: 15px;
        background: linear-gradient(135deg, #00d4ff, #0088ff);
        border: none;
        border-radius: 8px;
        color: #000;
        font-weight: bold;
        cursor: pointer;
        margin-bottom: 10px;
        transition: all 0.2s;
      }
      .ble-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,212,255,0.4); }
      .ble-btn:disabled {
        background: #333;
        color: #666;
        cursor: not-allowed;
      }
      .ble-btn.secondary {
        background: #222;
        border: 1px solid #444;
        color: #fff;
      }
      .ble-btn.scanning {
        background: linear-gradient(135deg, #ff4444, #ff0088);
        animation: scanning 1.5s ease-in-out infinite;
      }
      @keyframes scanning { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
      
      .ble-status-offline { color: #ff4444; font-weight: bold; }
      .ble-status-scanning { color: #ffaa00; font-weight: bold; }
      .ble-status-connected { color: #00ff88; font-weight: bold; }
      .ble-status-p2p { color: #00d4ff; font-weight: bold; }
      
      .ble-list {
        margin-top: 15px;
        max-height: 50vh;
        overflow-y: auto;
      }
      
      .ble-device-item {
        padding: 15px;
        background: rgba(255,255,255,0.05);
        border: 1px solid #333;
        border-radius: 8px;
        margin-bottom: 10px;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
      }
      .ble-device-item:hover {
        border-color: #00d4ff;
        background: rgba(0,212,255,0.1);
        transform: translateX(4px);
      }
      .ble-device-item.connected {
        border-color: #00ff88;
        background: rgba(0,255,136,0.1);
      }
      .ble-device-item.connected::after {
        content: "✓ CONECTADO";
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 10px;
        color: #00ff88;
        font-weight: bold;
      }
      
      .ble-empty { color: #666; text-align: center; padding: 40px 0; font-style: italic; }
      
      .device-rssi { color: #888; font-size: 12px; }
      .device-rssi strong { color: #00d4ff; }
      .device-actions {
        margin-top: 10px;
        display: flex;
        gap: 8px;
      }
      .device-actions button {
        flex: 1;
        padding: 8px;
        background: #222;
        border: 1px solid #444;
        color: #fff;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      .device-actions button.connect {
        background: linear-gradient(135deg, #00d4ff, #0088ff);
        color: #000;
        border: none;
      }
      .device-actions button.disconnect {
        background: linear-gradient(135deg, #ff4444, #cc0000);
        border: none;
      }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    this.elements.tab.addEventListener('click', () => this.show());
    this.elements.closeBtn.addEventListener('click', () => this.hide());
    this.elements.overlay.addEventListener('click', () => this.hide());
    
    if (!this.isDummyMode) {
      this.elements.scanBtn.addEventListener('click', () => this.toggleScan());
      this.elements.refreshBtn.addEventListener('click', () => this._loadConnectedDevices());
      
      // Tab switching
      document.querySelectorAll('.ble-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const tabName = e.target.dataset.tab;
          this._switchTab(tabName);
          if (tabName === 'connected') {
            this._loadConnectedDevices();
          }
        });
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        this.toggle();
      }
    });
    
    // Auto-refresh connected list cada 5s si está visible
    setInterval(() => {
      if (this.isVisible && document.querySelector('#tab-connected.active')) {
        this._loadConnectedDevices();
      }
    }, 5000);
  }

  _switchTab(tabName) {
    document.querySelectorAll('.ble-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.ble-tab-content').forEach(c => c.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
  }

  show() {
    this.isVisible = true;
    this.elements.panel.classList.add('active');
    this.elements.overlay.classList.add('active');
    this.elements.tab.classList.add('hidden');
    this.newDevicesCount = 0;
    this.updateBadge();
  }

  hide() {
    this.isVisible = false;
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
    this.elements.tab.classList.remove('hidden');
  }

  toggle() {
    this.isVisible ? this.hide() : this.show();
  }

  /**
   * FIX NAP 2.0: Detectar método correcto según tipo de mesh
   */
  async toggleScan() {
    if (this.isDummyMode || !this.bleMesh) {
      this.showToast('BLE no disponible', 'error', UI_ERRORS.UI_001);
      return;
    }

    if (this.isScanning) {
      await this.stopScan();
    } else {
      await this.startScan();
    }
  }

  async startScan() {
    try {
      this.isScanning = true;
      this.foundDevices.clear();
      this.newDevicesCount = 0;
      this.updateBadge();
      this.renderEmpty('Buscando dispositivos NEXO cercanos...');
      this.startScanUI();

      // FIX: Usar método correcto según tipo de mesh
      if (this.meshType === 'nordic' && this.bleMesh.startDiscovery) {
        await this.bleMesh.startDiscovery();
      } else if (this.meshType === 'hybrid' && this.bleMesh.startScan) {
        await this.bleMesh.startScan();
      } else {
        throw new Error('Método de scan no disponible');
      }
      
    } catch (err) {
      this.stopScanUI();
      this.showToast(`Error: ${err.message}`, 'error', UI_ERRORS.UI_002);
      this.renderEmpty('Error al iniciar búsqueda');
    }
  }

  async stopScan() {
    try {
      if (this.bleMesh?.stopScan) {
        await this.bleMesh.stopScan();
      } else if (this.bleMesh?.stopDiscovery) {
        await this.bleMesh.stopDiscovery();
      }
    } catch(e) {}
    this.stopScanUI();
  }

  startScanUI() {
    this.elements.scanBtn.textContent = '⏹ Detener Búsqueda';
    this.elements.scanBtn.classList.add('scanning');
    this.elements.status.textContent = 'BUSCANDO...';
    this.elements.status.className = 'ble-status-scanning';
  }

  stopScanUI() {
    this.isScanning = false;
    this.elements.scanBtn.textContent = '📡 Buscar Dispositivos';
    this.elements.scanBtn.classList.remove('scanning');
    this.updateStatus();
  }

  /**
   * FIX NAP 2.0: Cargar dispositivos conectados desde plugin nativo
   */
  async _loadConnectedDevices() {
    if (this.isDummyMode || !this.bleMesh) return;
    
    try {
      // Intentar obtener lista de conectados (NordicMesh o plugin nativo)
      let devices = [];
      
      if (this.bleMesh.getConnectedDevices) {
        // Método directo del plugin
        const result = await this.bleMesh.getConnectedDevices();
        devices = result || [];
      } else if (this.meshType === 'nordic') {
        // NordicMesh tiene getPeers()
        devices = this.bleMesh.getPeers() || [];
      } else if (this.meshType === 'hybrid') {
        // HybridMesh tiene getStatus().peerCount pero no lista directa
        const status = this.bleMesh.getStatus();
        // No hay lista detallada en HybridMesh legacy
        devices = [];
      }
      
      this.renderConnectedDevices(devices);
      
    } catch (err) {
      console.warn('[BLEInterface] Error loading connected devices:', err);
    }
  }

  renderConnectedDevices(devices) {
    if (!devices || devices.length === 0) {
      this.elements.connectedList.innerHTML = `
        <p class="ble-empty">
          No hay dispositivos conectados<br>
          <small style="color: #444;">Los dispositivos aparecerán aquí cuando se conecten</small>
        </p>
      `;
      return;
    }

    let html = '';
    devices.forEach(device => {
      const id = device.id || device.address || 'unknown';
      const name = device.name || `NEXO-${id.substr(-4)}`;
      const isConnected = device.connected || device.state === 'connected';
      
      html += `
        <div class="ble-device-item ${isConnected ? 'connected' : ''}">
          <strong>${name}</strong><br>
          <small style="color: #888;">${id}</small>
          <div class="device-actions">
            ${isConnected ? 
              `<button class="disconnect" onclick="window.bleInterface.disconnect('${id}')">Desconectar</button>` :
              `<button class="connect" onclick="window.bleInterface.connect('${id}')">Conectar</button>`
            }
          </div>
        </div>
      `;
    });
    this.elements.connectedList.innerHTML = html;
  }

  /**
   * Handlers de eventos del mesh
   */
  handleDeviceFound(device) {
    const id = device.id || device.endpointId || device.deviceId;
    if (!id || this.foundDevices.has(id)) return;

    this.foundDevices.set(id, {
      ...device,
      id: id,
      timestamp: Date.now()
    });

    if (!this.isVisible) {
      this.newDevicesCount++;
      this.updateBadge();
    }

    this.renderDiscovery();
  }

  handleDeviceConnected(peer) {
    this.showToast(`✓ Conectado: ${peer.name || 'dispositivo'}`, 'success');
    this.connectedDevices.set(peer.id || peer.deviceId, peer);
    this.renderDiscovery();
    this._loadConnectedDevices(); // Refresh connected tab
    this.updateStatus();
  }

  handleDeviceDisconnected(peer) {
    this.showToast(`Desconectado`, 'info');
    this.connectedDevices.delete(peer.id || peer.deviceId);
    this.renderDiscovery();
    this._loadConnectedDevices();
    this.updateStatus();
  }

  updateBadge() {
    if (this.newDevicesCount > 0 && !this.isVisible) {
      this.elements.badge.textContent = this.newDevicesCount > 9 ? '9+' : this.newDevicesCount;
      this.elements.badge.style.display = 'flex';
    } else {
      this.elements.badge.style.display = 'none';
    }
  }

  /**
   * FIX NAP 2.0: Unificar getStatus() y getState()
   */
  updateStatus(statusText) {
    if (statusText) {
      this.elements.status.textContent = statusText;
      return;
    }
    
    if (!this.bleMesh) return;
    
    let peers = 0;
    let mode = 'OFFLINE';
    
    // Unificar APIs
    if (this.meshType === 'nordic') {
      const state = this.bleMesh.getState ? this.bleMesh.getState() : 'offline';
      const peerList = this.bleMesh.getPeers ? this.bleMesh.getPeers() : [];
      peers = peerList.length;
      mode = state.toUpperCase();
    } else if (this.meshType === 'hybrid') {
      const status = this.bleMesh.getStatus ? this.bleMesh.getStatus() : {};
      peers = status.peerCount || 0;
      mode = (status.mode || 'OFFLINE').toUpperCase();
    }
    
    if (peers > 0) {
      this.elements.status.textContent = `P2P BLE (${peers})`;
      this.elements.status.className = 'ble-status-p2p';
    } else if (this.isScanning) {
      this.elements.status.textContent = 'BUSCANDO...';
      this.elements.status.className = 'ble-status-scanning';
    } else if (mode === 'MESSAGING' || mode === 'CONNECTED') {
      this.elements.status.textContent = 'P2P BLE';
      this.elements.status.className = 'ble-status-p2p';
    } else {
      this.elements.status.textContent = mode;
      this.elements.status.className = 'ble-status-offline';
    }
  }

  renderEmpty(msg) {
    this.elements.devicesList.innerHTML = `<p class="ble-empty">${msg}</p>`;
  }

  renderDiscovery() {
    if (this.foundDevices.size === 0) {
      this.renderEmpty(this.isScanning ? 'Buscando...' : 'No hay dispositivos encontrados');
      return;
    }

    let html = '';
    this.foundDevices.forEach(device => {
      const id = device.id || device.endpointId;
      const name = device.name || `NEXO-${id.substr(-4)}`;
      const rssi = device.rssi || '?';
      const userId = device.userId ? `ID: ${device.userId.substr(0,8)}...` : '';
      
      html += `
        <div class="ble-device-item" onclick="window.bleInterface.connect('${id}')">
          <strong>${name}</strong><br>
          <span class="device-rssi">Señal: <strong>${rssi} dBm</strong></span><br>
          <small style="color: #666;">${userId}</small>
        </div>
      `;
    });
    this.elements.devicesList.innerHTML = html;
  }

  async connect(deviceId) {
    if (this.isDummyMode || !this.bleMesh) {
      this.showToast('BLE no disponible', 'error', UI_ERRORS.UI_001);
      return;
    }
    try {
      this.showToast(`Conectando a ${deviceId.substr(0,8)}...`, 'info');
      await this.bleMesh.connect(deviceId);
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error', UI_ERRORS.UI_003);
    }
  }

  async disconnect(deviceId) {
    if (!this.bleMesh) return;
    try {
      await this.bleMesh.disconnect(deviceId);
      this.showToast('Desconectado', 'info');
    } catch (err) {
      this.showToast(`Error: ${err.message}`, 'error', UI_ERRORS.UI_004);
    }
  }

  showToast(message, type, code = null) {
    if (window.rem) {
      const method = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
      window.rem[method](message, code || 'BLE');
    } else {
      console.log(`[BLE ${type.toUpperCase()}] ${message}`);
    }
  }

  destroy() {
    this.hide();
    this.elements.tab?.remove();
    this.elements.panel?.remove();
    this.elements.overlay?.remove();
    document.getElementById('ble-styles')?.remove();
    this.foundDevices.clear();
    this.connectedDevices.clear();
  }
}

export let bleInterface = null;

export function initBLEInterface(bleMesh) {
  // Crear UI siempre, incluso si bleMesh es null (modo dummy)
  bleInterface = new BLEInterface(bleMesh);
  bleInterface.init();
  window.bleInterface = bleInterface;
  return bleInterface;
}
