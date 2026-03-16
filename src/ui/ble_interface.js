/**
 * BLE Interface - UI para descubrimiento y conexión BLE
 * v1.0 - Integrado con BleMesh v5.0
 */

export class BLEInterface {
  constructor(bleMesh) {
    this.bleMesh = bleMesh;
    this.isScanning = false;
    this.foundDevices = new Map();
    this.pendingRequests = new Map();
    this.isVisible = false;
    this.elements = {};
    
    // Callbacks para NexoApp
    this.onDeviceConnected = null;
    this.onDeviceDisconnected = null;
  }

  init() {
    this.createDOM();
    this.injectStyles();
    this.setupEventListeners();
    return this;
  }

  createDOM() {
    // Panel principal desde la izquierda
    const panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.className = 'ble-panel';
    panel.innerHTML = `
      <div class="ble-panel-header">
        <div class="ble-panel-title">
          <span class="ble-icon">🔷</span>
          <span>BLE Mesh Network</span>
        </div>
        <button id="ble-close" class="ble-btn-icon">✕</button>
      </div>
      
      <div class="ble-controls">
        <button id="ble-scan-toggle" class="ble-btn-primary">
          <span class="ble-scan-icon">📡</span>
          <span id="ble-scan-text">Iniciar Scan</span>
        </button>
        <div id="ble-scan-status" class="ble-status-indicator"></div>
      </div>

      <div class="ble-section">
        <h3 class="ble-section-title">Dispositivos Encontrados</h3>
        <div id="ble-devices-list" class="ble-devices-list">
          <div class="ble-empty-state">
            <div class="ble-empty-icon">📡</div>
            <p>Presiona scan para buscar dispositivos NEXO cercanos</p>
          </div>
        </div>
      </div>

      <div class="ble-section ble-connected-section">
        <h3 class="ble-section-title">Conectados (<span id="ble-connected-count">0</span>)</h3>
        <div id="ble-connected-list" class="ble-devices-list"></div>
      </div>

      <div class="ble-info">
        <div class="ble-info-item">
          <span class="ble-info-label">Estado:</span>
          <span id="ble-state" class="ble-info-value ble-state-offline">OFFLINE</span>
        </div>
        <div class="ble-info-item">
          <span class="ble-info-label">Peers:</span>
          <span id="ble-peers" class="ble-info-value">0</span>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    this.elements.panel = panel;

    // Modal de solicitud de conexión
    const modal = document.createElement('div');
    modal.id = 'ble-request-modal';
    modal.className = 'ble-modal';
    modal.innerHTML = `
      <div class="ble-modal-content">
        <div class="ble-modal-header">
          <h3>📡 Solicitud de Conexión BLE</h3>
        </div>
        <div class="ble-modal-body">
          <div class="ble-device-info">
            <div class="ble-device-icon">📱</div>
            <div class="ble-device-details">
              <div id="ble-request-name" class="ble-device-name">Dispositivo Desconocido</div>
              <div id="ble-request-id" class="ble-device-id">ID: --</div>
              <div class="ble-request-message">Quiere conectarse a tu red NEXO</div>
            </div>
          </div>
          <div class="ble-request-timeout">
            <div class="ble-timeout-bar"></div>
            <span class="ble-timeout-text">30s</span>
          </div>
        </div>
        <div class="ble-modal-actions">
          <button id="ble-reject-btn" class="ble-btn-secondary ble-btn-danger">
            <span>✕</span> Rechazar
          </button>
          <button id="ble-accept-btn" class="ble-btn-secondary ble-btn-success">
            <span>✓</span> Aceptar
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    this.elements.modal = modal;

    // Botón flotante para abrir panel (alternativa al gesture)
    const fab = document.createElement('button');
    fab.id = 'ble-fab';
    fab.className = 'ble-fab';
    fab.innerHTML = '🔷';
    fab.title = 'BLE Network (Ctrl+Shift+B)';
    document.body.appendChild(fab);
    this.elements.fab = fab;

    // Guardar referencias
    this.elements.scanBtn = document.getElementById('ble-scan-toggle');
    this.elements.scanText = document.getElementById('ble-scan-text');
    this.elements.scanStatus = document.getElementById('ble-scan-status');
    this.elements.devicesList = document.getElementById('ble-devices-list');
    this.elements.connectedList = document.getElementById('ble-connected-list');
    this.elements.connectedCount = document.getElementById('ble-connected-count');
    this.elements.state = document.getElementById('ble-state');
    this.elements.peers = document.getElementById('ble-peers');
    this.elements.requestName = document.getElementById('ble-request-name');
    this.elements.requestId = document.getElementById('ble-request-id');
  }

  injectStyles() {
    if (document.getElementById('ble-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'ble-styles';
    styles.textContent = `
      /* Panel Principal */
      .ble-panel {
        position: fixed;
        top: 0;
        left: 0;
        width: 85vw;
        max-width: 400px;
        height: 100vh;
        background: rgba(15, 15, 20, 0.98);
        backdrop-filter: blur(20px);
        border-right: 1px solid rgba(0, 255, 255, 0.2);
        transform: translateX(-100%);
        transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 2147483645;
        display: flex;
        flex-direction: column;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
        box-shadow: 10px 0 30px rgba(0,0,0,0.5);
      }

      .ble-panel.active {
        transform: translateX(0);
      }

      .ble-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        background: rgba(0,0,0,0.3);
      }

      .ble-panel-title {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 18px;
        font-weight: 600;
        color: #00ffff;
      }

      .ble-icon {
        font-size: 24px;
        filter: drop-shadow(0 0 10px rgba(0,255,255,0.5));
      }

      .ble-btn-icon {
        background: none;
        border: none;
        color: #fff;
        font-size: 20px;
        cursor: pointer;
        padding: 5px;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: all 0.2s;
      }

      .ble-btn-icon:hover {
        background: rgba(255,255,255,0.1);
        transform: rotate(90deg);
      }

      /* Controles */
      .ble-controls {
        padding: 20px;
        display: flex;
        align-items: center;
        gap: 15px;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }

      .ble-btn-primary {
        flex: 1;
        background: linear-gradient(135deg, #00ffff 0%, #0088ff 100%);
        border: none;
        color: #000;
        padding: 14px 20px;
        border-radius: 12px;
        font-weight: 600;
        font-size: 15px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s;
        box-shadow: 0 4px 15px rgba(0,255,255,0.3);
      }

      .ble-btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0,255,255,0.4);
      }

      .ble-btn-primary:active {
        transform: translateY(0);
      }

      .ble-btn-primary.scanning {
        background: linear-gradient(135deg, #ff4444 0%, #ff0088 100%);
        animation: ble-pulse 1.5s infinite;
      }

      @keyframes ble-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.8; }
      }

      .ble-scan-icon {
        font-size: 18px;
        display: inline-block;
      }

      .ble-btn-primary.scanning .ble-scan-icon {
        animation: ble-rotate 2s linear infinite;
      }

      @keyframes ble-rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .ble-status-indicator {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #333;
        box-shadow: 0 0 10px currentColor;
        transition: all 0.3s;
      }

      .ble-status-indicator.scanning {
        background: #00ff88;
        animation: ble-blink 1s infinite;
      }

      @keyframes ble-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }

      /* Secciones */
      .ble-section {
        padding: 15px 20px;
        flex: 1;
        overflow-y: auto;
      }

      .ble-connected-section {
        border-top: 1px solid rgba(255,255,255,0.05);
        max-height: 30%;
      }

      .ble-section-title {
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #888;
        margin-bottom: 12px;
        font-weight: 600;
      }

      .ble-devices-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .ble-device-card {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 15px;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        transition: all 0.2s;
        position: relative;
        overflow: hidden;
      }

      .ble-device-card:hover {
        background: rgba(255,255,255,0.1);
        border-color: rgba(0,255,255,0.3);
        transform: translateX(5px);
      }

      .ble-device-card::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: #00ffff;
        opacity: 0;
        transition: opacity 0.2s;
      }

      .ble-device-card:hover::before {
        opacity: 1;
      }

      .ble-device-card.connecting {
        animation: ble-connecting 1s infinite;
        border-color: #ffaa00;
      }

      @keyframes ble-connecting {
        0%, 100% { border-color: #ffaa00; }
        50% { border-color: transparent; }
      }

      .ble-device-icon {
        width: 40px;
        height: 40px;
        background: rgba(0,255,255,0.1);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        flex-shrink: 0;
      }

      .ble-device-info {
        flex: 1;
        min-width: 0;
      }

      .ble-device-name {
        font-weight: 600;
        font-size: 15px;
        color: #fff;
        margin-bottom: 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ble-device-meta {
        font-size: 12px;
        color: #888;
        display: flex;
        gap: 10px;
      }

      .ble-signal {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .ble-signal-bar {
        display: flex;
        align-items: flex-end;
        gap: 2px;
        height: 12px;
      }

      .ble-signal-bar span {
        width: 3px;
        background: #00ff88;
        border-radius: 1px;
        opacity: 0.3;
        transition: opacity 0.2s;
      }

      .ble-signal-bar span.active {
        opacity: 1;
      }

      .ble-signal-bar span:nth-child(1) { height: 4px; }
      .ble-signal-bar span:nth-child(2) { height: 6px; }
      .ble-signal-bar span:nth-child(3) { height: 8px; }
      .ble-signal-bar span:nth-child(4) { height: 10px; }

      .ble-btn-connect {
        background: rgba(0,255,255,0.2);
        border: 1px solid rgba(0,255,255,0.3);
        color: #00ffff;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }

      .ble-btn-connect:hover {
        background: rgba(0,255,255,0.3);
        transform: scale(1.05);
      }

      .ble-empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #666;
      }

      .ble-empty-icon {
        font-size: 48px;
        margin-bottom: 15px;
        opacity: 0.5;
      }

      .ble-empty-state p {
        font-size: 14px;
        line-height: 1.5;
      }

      /* Info Footer */
      .ble-info {
        padding: 15px 20px;
        border-top: 1px solid rgba(255,255,255,0.1);
        display: flex;
        justify-content: space-between;
        background: rgba(0,0,0,0.3);
        font-size: 12px;
      }

      .ble-info-item {
        display: flex;
        gap: 8px;
      }

      .ble-info-label {
        color: #666;
      }

      .ble-info-value {
        color: #00ffff;
        font-weight: 600;
        font-family: monospace;
      }

      .ble-state-offline { color: #ff4444; }
      .ble-state-scanning { color: #ffaa00; }
      .ble-state-connected { color: #00ff88; }

      /* Modal de Solicitud */
      .ble-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.8);
        backdrop-filter: blur(10px);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 2147483647;
        padding: 20px;
        opacity: 0;
        transition: opacity 0.3s;
      }

      .ble-modal.active {
        display: flex;
        opacity: 1;
      }

      .ble-modal-content {
        background: linear-gradient(135deg, rgba(30,30,40,0.95) 0%, rgba(20,20,30,0.95) 100%);
        border: 1px solid rgba(0,255,255,0.2);
        border-radius: 20px;
        width: 100%;
        max-width: 380px;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(0,255,255,0.1);
        transform: scale(0.9);
        transition: transform 0.3s;
      }

      .ble-modal.active .ble-modal-content {
        transform: scale(1);
      }

      .ble-modal-header {
        padding: 20px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        text-align: center;
      }

      .ble-modal-header h3 {
        margin: 0;
        color: #00ffff;
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }

      .ble-modal-body {
        padding: 30px 20px;
      }

      .ble-device-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 15px;
      }

      .ble-modal .ble-device-icon {
        width: 70px;
        height: 70px;
        font-size: 36px;
        background: rgba(0,255,255,0.1);
        box-shadow: 0 0 30px rgba(0,255,255,0.2);
        animation: ble-float 3s ease-in-out infinite;
      }

      @keyframes ble-float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-5px); }
      }

      .ble-device-details {
        width: 100%;
      }

      .ble-device-name {
        font-size: 20px;
        color: #fff;
        margin-bottom: 5px;
      }

      .ble-device-id {
        font-size: 12px;
        color: #888;
        font-family: monospace;
        margin-bottom: 10px;
      }

      .ble-request-message {
        color: #aaa;
        font-size: 14px;
        padding: 10px;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
      }

      .ble-request-timeout {
        margin-top: 25px;
        position: relative;
        height: 4px;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        overflow: hidden;
      }

      .ble-timeout-bar {
        height: 100%;
        background: linear-gradient(90deg, #00ffff, #0088ff);
        width: 100%;
        transform-origin: left;
        animation: ble-timeout 30s linear forwards;
      }

      @keyframes ble-timeout {
        to { transform: scaleX(0); }
      }

      .ble-timeout-text {
        position: absolute;
        right: 0;
        top: -20px;
        font-size: 12px;
        color: #888;
        font-family: monospace;
      }

      .ble-modal-actions {
        display: flex;
        gap: 15px;
        padding: 20px;
        border-top: 1px solid rgba(255,255,255,0.1);
      }

      .ble-btn-secondary {
        flex: 1;
        padding: 15px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        transition: all 0.2s;
        border: none;
      }

      .ble-btn-danger {
        background: rgba(255,68,68,0.2);
        color: #ff4444;
        border: 1px solid rgba(255,68,68,0.3);
      }

      .ble-btn-danger:hover {
        background: rgba(255,68,68,0.3);
        transform: translateY(-2px);
      }

      .ble-btn-success {
        background: rgba(0,255,136,0.2);
        color: #00ff88;
        border: 1px solid rgba(0,255,136,0.3);
      }

      .ble-btn-success:hover {
        background: rgba(0,255,136,0.3);
        transform: translateY(-2px);
        box-shadow: 0 5px 20px rgba(0,255,136,0.2);
      }

      /* FAB Button */
      .ble-fab {
        position: fixed;
        bottom: 100px;
        left: 20px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: linear-gradient(135deg, #00ffff 0%, #0088ff 100%);
        border: none;
        color: #000;
        font-size: 24px;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(0,255,255,0.4);
        z-index: 2147483644;
        transition: all 0.3s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .ble-fab:hover {
        transform: scale(1.1) rotate(10deg);
        box-shadow: 0 6px 25px rgba(0,255,255,0.5);
      }

      .ble-fab.hidden {
        transform: scale(0) rotate(-180deg);
      }

      /* Overlay para cerrar al tocar fuera */
      .ble-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 2147483644;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s;
      }

      .ble-overlay.active {
        opacity: 1;
        visibility: visible;
      }

      /* Responsive */
      @media (max-width: 480px) {
        .ble-panel {
          width: 90vw;
        }
      }
    `;
    document.head.appendChild(styles);
  }

  setupEventListeners() {
    // Toggle scan
    this.elements.scanBtn.addEventListener('click', () => this.toggleScan());

    // Cerrar panel
    document.getElementById('ble-close').addEventListener('click', () => this.hide());
    
    // FAB
    this.elements.fab.addEventListener('click', () => this.show());

    // Overlay para cerrar al tocar fuera
    const overlay = document.createElement('div');
    overlay.className = 'ble-overlay';
    overlay.addEventListener('click', () => this.hide());
    document.body.insertBefore(overlay, this.elements.panel);
    this.elements.overlay = overlay;

    // Atajo de teclado
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        this.toggle();
      }
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });

    // Callbacks de BleMesh
    if (this.bleMesh) {
      this.bleMesh.onDeviceFound = (device) => this.handleDeviceFound(device);
      this.bleMesh.onConnectionRequest = (device) => this.handleConnectionRequest(device);
      this.bleMesh.onStatusChange = (status) => this.handleStatusChange(status);
    }

    // Modal buttons
    document.getElementById('ble-accept-btn').addEventListener('click', () => this.acceptRequest());
    document.getElementById('ble-reject-btn').addEventListener('click', () => this.rejectRequest());
  }

  show() {
    this.isVisible = true;
    this.elements.panel.classList.add('active');
    this.elements.overlay.classList.add('active');
    this.elements.fab.classList.add('hidden');
    
    // Pausar Vault Slider si está activo para evitar conflictos
    document.dispatchEvent(new CustomEvent('nexo:ui:pauseGestures'));
  }

  hide() {
    this.isVisible = false;
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
    this.elements.fab.classList.remove('hidden');
    
    // Reanudar gestos
    document.dispatchEvent(new CustomEvent('nexo:ui:resumeGestures'));
  }

  toggle() {
    if (this.isVisible) this.hide();
    else this.show();
  }

  async toggleScan() {
    if (!this.bleMesh) {
      this.showToast('BLE Mesh no disponible', 'error');
      return;
    }

    if (this.isScanning) {
      await this.bleMesh.stopScan();
      this.stopScanUI();
    } else {
      this.foundDevices.clear();
      this.renderDevicesList();
      await this.bleMesh.startScan();
      this.startScanUI();
    }
  }

  startScanUI() {
    this.isScanning = true;
    this.elements.scanBtn.classList.add('scanning');
    this.elements.scanText.textContent = 'Detener Scan';
    this.elements.scanStatus.classList.add('scanning');
    this.elements.state.textContent = 'SCANNING';
    this.elements.state.className = 'ble-info-value ble-state-scanning';
  }

  stopScanUI() {
    this.isScanning = false;
    this.elements.scanBtn.classList.remove('scanning');
    this.elements.scanText.textContent = 'Iniciar Scan';
    this.elements.scanStatus.classList.remove('scanning');
    this.updateState();
  }

  handleDeviceFound(device) {
    const id = device.id || device.address;
    if (!this.foundDevices.has(id)) {
      this.foundDevices.set(id, {
        ...device,
        timestamp: Date.now(),
        rssi: device.rssi || -50
      });
      this.renderDevicesList();
    }
  }

  renderDevicesList() {
    const list = this.elements.devicesList;
    
    if (this.foundDevices.size === 0) {
      list.innerHTML = `
        <div class="ble-empty-state">
          <div class="ble-empty-icon">📡</div>
          <p>${this.isScanning ? 'Buscando dispositivos...' : 'Presiona scan para buscar dispositivos NEXO cercanos'}</p>
        </div>
      `;
      return;
    }

    list.innerHTML = '';
    this.foundDevices.forEach((device, id) => {
      const card = this.createDeviceCard(device);
      list.appendChild(card);
    });
  }

  createDeviceCard(device) {
    const div = document.createElement('div');
    div.className = 'ble-device-card';
    div.innerHTML = `
      <div class="ble-device-icon">📱</div>
      <div class="ble-device-info">
        <div class="ble-device-name">${device.name || 'NEXO Device'}</div>
        <div class="ble-device-meta">
          <span class="ble-signal">
            <span class="ble-signal-bar">
              <span class="${device.rssi > -90 ? 'active' : ''}"></span>
              <span class="${device.rssi > -70 ? 'active' : ''}"></span>
              <span class="${device.rssi > -50 ? 'active' : ''}"></span>
              <span class="${device.rssi > -30 ? 'active' : ''}"></span>
            </span>
            ${device.rssi}dBm
          </span>
          <span>${device.address?.substr(0, 8)}...</span>
        </div>
      </div>
      <button class="ble-btn-connect" onclick="bleInterface.requestConnection('${device.id || device.address}')">
        Conectar
      </button>
    `;
    return div;
  }

  async requestConnection(deviceId) {
    const device = this.foundDevices.get(deviceId);
    if (!device) return;

    // Marcar como conectando
    const cards = document.querySelectorAll('.ble-device-card');
    cards.forEach(card => {
      if (card.innerHTML.includes(deviceId.substr(0, 8))) {
        card.classList.add('connecting');
        const btn = card.querySelector('.ble-btn-connect');
        btn.textContent = 'Conectando...';
        btn.disabled = true;
      }
    });

    try {
      await this.bleMesh.connect(deviceId);
      this.showToast(`Conectado a ${device.name || 'dispositivo'}`, 'success');
      this.renderConnectedDevices();
    } catch (err) {
      this.showToast(`Error de conexión: ${err.message}`, 'error');
      this.renderDevicesList(); // Reset UI
    }
  }

  handleConnectionRequest(device) {
    const requestId = device.id || device.address;
    this.pendingRequests.set(requestId, device);
    
    this.elements.requestName.textContent = device.name || 'NEXO Device';
    this.elements.requestId.textContent = `ID: ${requestId.substr(0, 16)}...`;
    
    this.elements.modal.classList.add('active');
    
    // Auto-rechazar después de 30s
    setTimeout(() => {
      if (this.pendingRequests.has(requestId)) {
        this.rejectRequest(requestId);
      }
    }, 30000);
  }

  async acceptRequest(requestId) {
    const device = this.pendingRequests.get(requestId);
    if (!device) return;

    this.pendingRequests.delete(requestId);
    this.elements.modal.classList.remove('active');
    
    try {
      await this.bleMesh.acceptConnection(requestId);
      this.showToast('Conexión aceptada', 'success');
      this.renderConnectedDevices();
    } catch (err) {
      this.showToast('Error al aceptar conexión', 'error');
    }
  }

  async rejectRequest(requestId) {
    const id = requestId || Array.from(this.pendingRequests.keys())[0];
    if (!id) {
      this.elements.modal.classList.remove('active');
      return;
    }

    const device = this.pendingRequests.get(id);
    this.pendingRequests.delete(id);
    this.elements.modal.classList.remove('active');
    
    try {
      await this.bleMesh.rejectConnection(id);
      this.showToast('Solicitud rechazada', 'info');
    } catch (err) {
      console.error('Error rechazando:', err);
    }
  }

  renderConnectedDevices() {
    if (!this.bleMesh) return;
    
    const connected = this.bleMesh.getConnectedDevices?.() || [];
    this.elements.connectedCount.textContent = connected.length;
    
    const list = this.elements.connectedList;
    if (connected.length === 0) {
      list.innerHTML = '<div class="ble-empty-state" style="padding: 20px;"><p style="font-size: 13px;">No hay dispositivos conectados</p></div>';
      return;
    }

    list.innerHTML = '';
    connected.forEach(device => {
      const div = document.createElement('div');
      div.className = 'ble-device-card';
      div.style.borderLeft = '3px solid #00ff88';
      div.innerHTML = `
        <div class="ble-device-icon" style="background: rgba(0,255,136,0.1);">✓</div>
        <div class="ble-device-info">
          <div class="ble-device-name">${device.name || 'Connected Device'}</div>
          <div class="ble-device-meta" style="color: #00ff88;">Conectado • ${device.address?.substr(0, 8)}...</div>
        </div>
        <button class="ble-btn-connect" style="color: #ff4444; border-color: #ff4444;" 
                onclick="bleInterface.disconnect('${device.id}')">
          Desconectar
        </button>
      `;
      list.appendChild(div);
    });
  }

  async disconnect(deviceId) {
    try {
      await this.bleMesh.disconnect(deviceId);
      this.showToast('Dispositivo desconectado', 'info');
      this.renderConnectedDevices();
    } catch (err) {
      this.showToast('Error al desconectar', 'error');
    }
  }

  handleStatusChange(status) {
    this.updateState();
    this.renderConnectedDevices();
    
    // Actualizar status bar de REM si existe
    if (window.NEXO_REM) {
      window.NEXO_REM.updateStatus(null, status.meshReady ? 'P2P' : 'OFFLINE');
    }
  }

  updateState() {
    if (!this.bleMesh) return;
    
    const state = this.bleMesh.getState?.() || {};
    const isConnected = state.isConnected || false;
    const peerCount = state.peerCount || 0;
    
    this.elements.state.textContent = isConnected ? 'CONNECTED' : (this.isScanning ? 'SCANNING' : 'OFFLINE');
    this.elements.state.className = `ble-info-value ble-state-${isConnected ? 'connected' : (this.isScanning ? 'scanning' : 'offline')}`;
    this.elements.peers.textContent = peerCount;
  }

  showToast(message, type = 'info') {
    // Usar REM si está disponible
    if (window.NEXO_REM) {
      const method = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
      window.NEXO_REM[method](message, `BLE_${type.toUpperCase()}`);
    } else {
      console.log(`[BLE ${type}] ${message}`);
    }
  }

  destroy() {
    this.hide();
    if (this.isScanning && this.bleMesh) {
      this.bleMesh.stopScan();
    }
    this.elements.panel?.remove();
    this.elements.modal?.remove();
    this.elements.fab?.remove();
    this.elements.overlay?.remove();
    document.getElementById('ble-styles')?.remove();
  }
}

// Singleton para acceso global
export let bleInterface = null;

export function initBLEInterface(bleMesh) {
  bleInterface = new BLEInterface(bleMesh);
  bleInterface.init();
  window.bleInterface = bleInterface; // Para acceso desde HTML
  return bleInterface;
}
