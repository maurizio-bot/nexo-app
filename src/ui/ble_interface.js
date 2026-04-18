/**
 * BLE Interface v2.3-NAP
 * Sistema UI BLE con soporte Dual: NordicMesh + HybridMesh
 * + FEATURE: Botón Visibilidad (Advertising toggle) - Build #694
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
    this.connectedDevices = new Map();
    this.isVisible = false;
    this.elements = {};
    this.newDevicesCount = 0;
    this.isDummyMode = !bleMesh;
    this.meshType = this._detectMeshType();
    
    // NUEVO: Estado de visibilidad (advertising)
    this.isAdvertising = false;
    this.canAdvertise = false;
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
    
    if (this.isDummyMode) {
      console.warn('[BLEInterface] Modo DUMMY - BLE no disponible');
      this.updateStatus('OFFLINE (Dummy)');
    } else {
      this.updateStatus();
      this._loadConnectedDevices();
      this._initVisibility();
    }
    
    return this;
  }

  async _initVisibility() {
    if (this.isDummyMode || !this.bleMesh) return;
    
    try {
      // Obtener capacidades del mesh
      if (this.bleMesh.getCapabilities) {
        const caps = await this.bleMesh.getCapabilities();
        this.canAdvertise = caps.canAdvertise || false;
      }
      
      // Obtener estado actual de visibilidad
      if (this.bleMesh.getVisibilityState) {
        const state = await this.bleMesh.getVisibilityState();
        this.isAdvertising = state.isAdvertising || false;
      }
      
      this.updateVisibilityButton();
      
      // Escuchar cambios de visibilidad
      if (this.bleMesh.on) {
        this.bleMesh.on('visibilityChanged', (data) => {
          this.isAdvertising = data.visible || false;
          this.updateVisibilityButton();
        });
        
        // Escuchar advertencias de permisos (Build #694)
        this.bleMesh.on('advertiseWarning', (data) => {
          console.warn('[BLEInterface] Advertise Warning:', data.message);
          this.canAdvertise = false;
          this.updateVisibilityButton();
        });
      }
    } catch (err) {
      console.warn('[BLEInterface] Error initializing visibility:', err);
      this.canAdvertise = false;
      this.updateVisibilityButton();
    }
  }

  updateVisibilityButton() {
    const btn = this.elements.visibilityBtn;
    if (!btn) return;
    
    const icon = btn.querySelector('.btn-icon');
    const text = btn.querySelector('span:last-child');
    
    if (!this.canAdvertise) {
      // ESTADO ADVERTENCIA (Build #694): Sin permiso ADVERTISE
      btn.className = 'ble-btn-visibility btn-visibility-warning';
      if (icon) icon.textContent = '⚠️';
      if (text) text.textContent = 'Visibilidad desactivada';
      btn.title = 'Conceda permiso "Dispositivos cercanos" para activar visibilidad';
      btn.disabled = false; // Permitir click para intentar solicitar permiso
    } else if (!this.isAdvertising) {
      // ESTADO APAGADO: Con permiso pero desactivado
      btn.className = 'ble-btn-visibility btn-visibility-off';
      if (icon) icon.textContent = '👁️';
      if (text) text.textContent = 'Visibilidad';
      btn.title = 'Pulse para hacerse visible a otros dispositivos';
      btn.disabled = false;
    } else {
      // ESTADO ENCENDIDO: Visible activo
      btn.className = 'ble-btn-visibility btn-visibility-on';
      if (icon) icon.textContent = '👁️‍🗨️';
      if (text) text.textContent = 'Visible';
      btn.title = 'Pulse para dejar de ser visible';
      btn.disabled = false;
    }
  }

  async toggleVisibility() {
    if (this.isDummyMode || !this.bleMesh) return;
    
    try {
      if (!this.canAdvertise) {
        // Intentar solicitar permiso primero si no lo tiene
        console.log('[BLEInterface] Solicitando permiso de visibilidad...');
        if (this.bleMesh.requestAdvertisePermission) {
          const granted = await this.bleMesh.requestAdvertisePermission();
          if (granted) {
            this.canAdvertise = true;
          } else {
            // Mostrar advertencia al usuario
            this.showToast('⚠️ Permiso de visibilidad denegado. La app funciona como cliente solo.', 'warning');
            return;
          }
        }
      }
      
      // Toggle visibilidad
      if (this.bleMesh.toggleVisibility) {
        const result = await this.bleMesh.toggleVisibility();
        this.isAdvertising = result.isAdvertising || false;
        this.updateVisibilityButton();
        
        this.showToast(
          this.isAdvertising ? '✅ Ahora eres visible para otros dispositivos' : '👁️ Visibilidad desactivada',
          this.isAdvertising ? 'success' : 'info'
        );
      }
    } catch (err) {
      console.error('[BLEInterface] Error toggling visibility:', err);
      this.showToast('❌ Error al cambiar visibilidad', 'error');
    }
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
      
      <!-- NUEVO: Contenedor de botones principales -->
      <div class="ble-main-controls">
        <button id="ble-visibility-btn" class="ble-btn-visibility btn-visibility-off" ${this.isDummyMode ? 'disabled' : ''}>
          <span class="btn-icon">🚫</span>
          <span>Visibilidad desactivada</span>
        </button>
        
        <button id="ble-scan-btn" class="ble-btn-discover" ${this.isDummyMode ? 'disabled' : ''}>
          <span class="btn-icon">🔍</span>
          <span id="text-discover">Descubrir</span>
        </button>
      </div>
      
      <div class="ble-secondary-controls">
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
    this.elements.visibilityBtn = document.getElementById('ble-visibility-btn');
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
      
      /* Contenedor de controles principales */
      .ble-main-controls {
        display: flex;
        gap: 12px;
        justify-content: center;
        align-items: center;
        margin-bottom: 10px;
      }
      
      .ble-secondary-controls {
        margin-bottom: 15px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      /* BOTÓN VISIBILIDAD - Izquierda */
      .ble-btn-visibility {
        flex: 1;
        max-width: 140px;
        height: 48px;
        border-radius: 12px;
        border: none;
        font-weight: 600;
        font-size: 13px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.3s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      /* Estado: Sin permiso (advertencia amarilla) */
      .ble-btn-visibility.btn-visibility-warning {
        background: #4A3A00 !important;
        color: #FFCC00 !important;
        border: 1px solid #FFCC00 !important;
        cursor: pointer;
      }
      
      /* Estado: Con permiso, apagado (gris) */
      .ble-btn-visibility.btn-visibility-off {
        background: #3A3A3A;
        color: #888888;
        border: 1px solid transparent;
      }
      
      /* Estado: Con permiso, encendido (azul) */
      .ble-btn-visibility.btn-visibility-on {
        background: #00D9FF;
        color: #000000;
        border: 1px solid #00D9FF;
        box-shadow: 0 0 12px rgba(0, 217, 255, 0.4);
      }
      
      .ble-btn-visibility:disabled {
        background: #2A2A2A;
        color: #555555;
        cursor: not-allowed;
        opacity: 0.6;
      }
      
      /* BOTÓN DESCUBRIR - Centro (más prominente) */
      .ble-btn-discover {
        flex: 1.2;
        height: 56px;
        border-radius: 14px;
        border: none;
        font-weight: 700;
        font-size: 15px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: linear-gradient(135deg, #00d4ff, #0099cc);
        color: #000;
        box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3);
        transition: all 0.3s ease;
      }
      
      .ble-btn-discover:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 212, 255, 0.4);
      }
      
      .ble-btn-discover:active:not(:disabled) {
        transform: translateY(0);
      }
      
      .ble-btn-discover:disabled {
        background: #2A2A2A;
        color: #555;
        cursor: not-allowed;
        opacity: 0.6;
        box-shadow: none;
      }
      
      .ble-btn-discover.scanning {
        background: linear-gradient(135deg, #ff4444, #cc0000);
        color: #fff;
        animation: pulse-red 1.5s infinite;
      }
      
      @keyframes pulse-red {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.4); }
        50% { box-shadow: 0 0 0 10px rgba(255, 68, 68, 0); }
      }
      
      /* Botón secundario */
      .ble-btn.secondary {
        padding: 8px 12px;
        background: #333;
        border: 1px solid #444;
        border-radius: 6px;
        color: #aaa;
        cursor: pointer;
        font-size: 12px;
      }
      
      /* Estado BLE */
      #ble-status {
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .ble-status-offline { background: #333; color: #888; }
      .ble-status-online { background: #00d4ff; color: #000; }
      .ble-status-scanning { background: #ffaa00; color: #000; animation: blink 1s infinite; }
      
      @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.7; } }
      
      /* Lista de dispositivos */
      .ble-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: calc(100vh - 300px);
        overflow-y: auto;
      }
      
      .ble-empty {
        text-align: center;
        color: #666;
        padding: 20px;
        font-style: italic;
      }
      
      .ble-device-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        background: rgba(255,255,255,0.05);
        border: 1px solid #333;
        border-radius: 8px;
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
      }
      
      .ble-device-name {
        font-weight: bold;
        color: #fff;
      }
      
      .ble-device-id {
        font-size: 11px;
        color: #888;
      }
      
      .ble-device-rssi {
        font-size: 12px;
        color: #00d4ff;
      }
      
      .ble-device-actions {
        display: flex;
        gap: 8px;
      }
      
      .ble-btn-connect {
        padding: 6px 12px;
        background: #00d4ff;
        color: #000;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
      }
      
      .ble-btn-disconnect {
        padding: 6px 12px;
        background: #ff4444;
        color: #fff;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }
      
      /* Toast notifications */
      .ble-toast {
        position: fixed;
        bottom: 20px;
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
    // Tab click
    this.elements.tab.addEventListener('click', () => this.togglePanel());
    
    // Close button
    this.elements.closeBtn.addEventListener('click', () => this.togglePanel());
    
    // Overlay click
    this.elements.overlay.addEventListener('click', () => this.togglePanel());
    
    // NUEVO: Visibilidad button (Build #694)
    this.elements.visibilityBtn.addEventListener('click', () => this.toggleVisibility());
    
    // Scan button
    this.elements.scanBtn.addEventListener('click', () => this.toggleScan());
    
    // Refresh button
    this.elements.refreshBtn.addEventListener('click', () => this.refreshDevices());
    
    // Tabs
    document.querySelectorAll('.ble-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });
    
    // Eventos del mesh
    if (!this.isDummyMode && this.bleMesh) {
      // Escuchar dispositivos encontrados
      if (this.bleMesh.on) {
        this.bleMesh.on('deviceFound', (device) => this.onDeviceFound(device));
        this.bleMesh.on('deviceConnected', (device) => this.onDeviceConnected(device));
        this.bleMesh.on('deviceDisconnected', (device) => this.onDeviceDisconnected(device));
        this.bleMesh.on('scanStarted', () => this.onScanStateChanged(true));
        this.bleMesh.on('scanStopped', () => this.onScanStateChanged(false));
      }
    }
  }

  togglePanel() {
    this.elements.panel.classList.toggle('active');
    this.elements.overlay.classList.toggle('active');
    
    if (this.elements.panel.classList.contains('active')) {
      this.newDevicesCount = 0;
      this.updateBadge();
      // Recargar dispositivos conectados al abrir
      this._loadConnectedDevices();
    }
  }

  switchTab(tabName) {
    document.querySelectorAll('.ble-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.ble-tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
  }

  async toggleScan() {
    if (this.isDummyMode) return;
    
    try {
      if (this.isScanning) {
        // Detener scan
        if (this.meshType === 'nordic' && this.bleMesh.stopDiscovery) {
          await this.bleMesh.stopDiscovery();
        } else if (this.bleMesh.stopScan) {
          await this.bleMesh.stopScan();
        }
        this.isScanning = false;
        this.onScanStateChanged(false);
      } else {
        // Iniciar scan
        this.foundDevices.clear();
        this.renderDevicesList();
        
        if (this.meshType === 'nordic' && this.bleMesh.startDiscovery) {
          await this.bleMesh.startDiscovery();
        } else if (this.bleMesh.startScan) {
          await this.bleMesh.startScan();
        }
        this.isScanning = true;
        this.onScanStateChanged(true);
      }
    } catch (err) {
      console.error('[BLEInterface] Error toggling scan:', err);
      this.showToast('Error al escanear: ' + err.message, 'error');
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
    const id = device.id || device.address;
    const isNew = !this.foundDevices.has(id);
    this.foundDevices.set(id, device);
    
    if (isNew) {
      this.newDevicesCount++;
      this.updateBadge();
    }
    
    this.renderDevicesList();
  }

  onDeviceConnected(device) {
    this.connectedDevices.set(device.id || device.address, device);
    this.renderConnectedList();
    this.showToast('✅ Conectado: ' + (device.name || 'Dispositivo'), 'success');
  }

  onDeviceDisconnected(device) {
    this.connectedDevices.delete(device.id || device.address);
    this.renderConnectedList();
    this.showToast('❌ Desconectado', 'info');
  }

  async _loadConnectedDevices() {
    if (this.isDummyMode || !this.bleMesh) return;
    
    try {
      if (this.bleMesh.getConnectedDevices) {
        const devices = await this.bleMesh.getConnectedDevices();
        this.connectedDevices.clear();
        devices.forEach(d => {
          this.connectedDevices.set(d.id || d.address, d);
        });
        this.renderConnectedList();
      }
    } catch (err) {
      console.warn('[BLEInterface] Error loading connected devices:', err);
    }
  }

  renderDevicesList() {
    const list = this.elements.devicesList;
    if (this.foundDevices.size === 0) {
      list.innerHTML = '<p class="ble-empty">Presiona buscar para encontrar dispositivos cercanos</p>';
      return;
    }
    
    list.innerHTML = '';
    this.foundDevices.forEach((device, id) => {
      const item = document.createElement('div');
      item.className = 'ble-device-item' + (this.newDevicesCount > 0 ? ' new' : '');
      item.innerHTML = `
        <div class="ble-device-info">
          <span class="ble-device-name">${device.name || 'Desconocido'}</span>
          <span class="ble-device-id">${this._formatId(id)}</span>
          <span class="ble-device-rssi">📶 ${device.rssi || '?'} dBm</span>
        </div>
        <div class="ble-device-actions">
          <button class="ble-btn-connect" onclick="bleInterface.connect('${id}')">
            Conectar
          </button>
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
      const item = document.createElement('div');
      item.className = 'ble-device-item';
      item.innerHTML = `
        <div class="ble-device-info">
          <span class="ble-device-name">${device.name || 'Desconocido'}</span>
          <span class="ble-device-id">${this._formatId(id)}</span>
          <span class="ble-device-rssi" style="color: #00ff00;">● Conectado</span>
        </div>
        <div class="ble-device-actions">
          <button class="ble-btn-disconnect" onclick="bleInterface.disconnect('${id}')">
            Desconectar
          </button>
        </div>
      `;
      list.appendChild(item);
    });
  }

  async connect(deviceId) {
    if (this.isDummyMode) return;
    
    try {
      const device = this.foundDevices.get(deviceId);
      if (!device) return;
      
      if (this.bleMesh.connect) {
        await this.bleMesh.connect(deviceId);
      }
    } catch (err) {
      console.error('[BLEInterface] Error connecting:', err);
      this.showToast('Error al conectar', 'error');
    }
  }

  async disconnect(deviceId) {
    if (this.isDummyMode) return;
    
    try {
      if (this.bleMesh.disconnect) {
        await this.bleMesh.disconnect(deviceId);
      }
    } catch (err) {
      console.error('[BLEInterface] Error disconnecting:', err);
    }
  }

  refreshDevices() {
    this._loadConnectedDevices();
    this.showToast('Lista actualizada', 'success');
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
      if (this.meshType === 'nordic' && this.bleMesh.getState) {
        state = await this.bleMesh.getState();
      } else if (this.bleMesh.getStatus) {
        state = await this.bleMesh.getStatus();
      }
      
      this.elements.status.textContent = state.toUpperCase();
      this.elements.status.className = state === 'poweredOn' ? 'ble-status-online' : 'ble-status-offline';
    } catch (err) {
      this.elements.status.textContent = 'ERROR';
      this.elements.status.className = 'ble-status-offline';
    }
  }

  showToast(message, type = 'info') {
    // Remover toast anterior si existe
    const existing = document.querySelector('.ble-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `ble-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  _formatId(id) {
    if (!id) return '??';
    return id.substring(0, 8) + '...' + id.substring(id.length - 4);
  }

  destroy() {
    // Limpiar
    const styles = document.getElementById('ble-styles');
    if (styles) styles.remove();
    
    const toast = document.querySelector('.ble-toast');
    if (toast) toast.remove();
    
    // Detener scan si está activo
    if (this.isScanning) {
      this.toggleScan();
    }
  }
}

// Variable global para acceso desde los onclick
window.bleInterface = null;
