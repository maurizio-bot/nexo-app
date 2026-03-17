/**
 * BLE Interface - UI con Pestaña Lateral (Tab) 
 * v1.3 - FIX: Permisos Android 12+ y null checks
 */

export class BLEInterface {
  constructor(bleMesh) {
    this.bleMesh = bleMesh;
    this.isScanning = false;
    this.foundDevices = new Map();
    this.pendingRequests = new Map();
    this.isVisible = false;
    this.elements = {};
    this.newDevicesCount = 0;
    this.permissionsGranted = false;
    
    this.onDeviceConnected = null;
    this.onDeviceDisconnected = null;
  }

  init() {
    this.createDOM();
    this.injectStyles();
    this.setupEventListeners();
    
    // FIX: Verificar que bleMesh existe antes de conectar callbacks
    if (this.bleMesh && this.bleMesh.callbacks) {
      const originalOnDeviceFound = this.bleMesh.callbacks.onDeviceFound;
      this.bleMesh.callbacks.onDeviceFound = (device) => {
        this.handleDeviceFound(device);
        if (originalOnDeviceFound) originalOnDeviceFound(device);
      };

      const originalOnConnected = this.bleMesh.callbacks.onDeviceConnected;
      this.bleMesh.callbacks.onDeviceConnected = (peer) => {
        this.handleDeviceConnected(peer);
        if (originalOnConnected) originalOnConnected(peer);
      };

      const originalOnDisconnected = this.bleMesh.callbacks.onDeviceDisconnected;
      this.bleMesh.callbacks.onDeviceDisconnected = (peer) => {
        this.handleDeviceDisconnected(peer);
        if (originalOnDisconnected) originalOnDisconnected(peer);
      };

      const originalOnError = this.bleMesh.callbacks.onError;
      this.bleMesh.callbacks.onError = (code, msg) => {
        this.showToast(`Error ${code}: ${msg}`, 'error');
        if (originalOnError) originalOnError(code, msg);
      };
    } else {
      console.warn('[BLEInterface] bleMesh no disponible en init, reintentando...');
      setTimeout(() => this.init(), 500);
      return;
    }
    
    return this;
  }

  async checkBLEPermissions() {
    if (this.permissionsGranted) return true;
    
    if (!navigator.userAgent.includes('Android')) {
      this.permissionsGranted = true;
      return true;
    }
    
    try {
      const { Permissions } = await import('@capacitor/core');
      
      const scan = await Permissions.request({ name: 'BLUETOOTH_SCAN' });
      const connect = await Permissions.request({ name: 'BLUETOOTH_CONNECT' });
      const location = await Permissions.request({ name: 'ACCESS_FINE_LOCATION' });
      
      this.permissionsGranted = scan.state === 'granted' && 
                               connect.state === 'granted' && 
                               location.state === 'granted';
      
      if (!this.permissionsGranted) {
        this.showToast('Permisos denegados. Activa Bluetooth y Ubicación', 'BLE_PERM');
      }
      
      return this.permissionsGranted;
    } catch (e) {
      console.warn('[BLE] Permisos no disponibles:', e);
      this.permissionsGranted = true;
      return true;
    }
  }

  createDOM() {
    const tab = document.createElement('div');
    tab.id = 'ble-tab';
    tab.innerHTML = `
      <div class="ble-tab-icon">🔷</div>
      <div class="ble-tab-label">BLE</div>
      <div class="ble-tab-badge" id="ble-tab-badge" style="display: none;">0</div>
      <div class="ble-tab-indicator" id="ble-tab-indicator"></div>
    `;
    document.body.appendChild(tab);
    this.elements.tab = tab;

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
        <h3 class="ble-section-title">Dispositivos Encontrados (<span id="ble-found-count">0</span>)</h3>
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

    const modal = document.createElement('div');
    modal.id = 'ble-request-modal';
    modal.className = 'ble-modal';
    modal.innerHTML = `
      <div class="ble-modal-content">
        <div class="ble-modal-header">
          <h3>📡 Solicitud de Conexión</h3>
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

    const overlay = document.createElement('div');
    overlay.id = 'ble-overlay';
    overlay.className = 'ble-overlay';
    document.body.appendChild(overlay);
    this.elements.overlay = overlay;

    this.elements.scanBtn = document.getElementById('ble-scan-toggle');
    this.elements.scanText = document.getElementById('ble-scan-text');
    this.elements.scanStatus = document.getElementById('ble-scan-status');
    this.elements.devicesList = document.getElementById('ble-devices-list');
    this.elements.connectedList = document.getElementById('ble-connected-list');
    this.elements.connectedCount = document.getElementById('ble-connected-count');
    this.elements.foundCount = document.getElementById('ble-found-count');
    this.elements.state = document.getElementById('ble-state');
    this.elements.peers = document.getElementById('ble-peers');
    this.elements.badge = document.getElementById('ble-tab-badge');
    this.elements.indicator = document.getElementById('ble-tab-indicator');
    this.elements.requestName = document.getElementById('ble-request-name');
    this.elements.requestId = document.getElementById('ble-request-id');
  }

  injectStyles() {
    if (document.getElementById('ble-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'ble-styles';
    styles.textContent = `
      #ble-tab {
        position: fixed;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 44px;
        height: 120px;
        background: linear-gradient(180deg, #00d4ff 0%, #0099cc 100%);
        border-radius: 0 12px 12px 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        cursor: pointer;
        z-index: 2147483644;
        box-shadow: 4px 0 15px rgba(0,212,255,0.4);
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        border: 1px solid rgba(255,255,255,0.2);
        border-left: none;
      }

      #ble-tab:hover { width: 52px; box-shadow: 6px 0 20px rgba(0,212,255,0.6); }
      #ble-tab:active { transform: translateY(-50%) scale(0.95); }
      #ble-tab.hidden { transform: translateY(-50%) translateX(-100%); opacity: 0; }

      .ble-tab-icon { font-size: 24px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); }
      .ble-tab-label {
        writing-mode: vertical-rl;
        text-orientation: mixed;
        color: #000;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 2px;
        text-transform: uppercase;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .ble-tab-badge {
        position: absolute;
        top: 8px;
        right: -6px;
        background: #ff4444;
        color: white;
        font-size: 10px;
        font-weight: bold;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(255,68,68,0.5);
        animation: ble-badge-pulse 2s infinite;
      }

      @keyframes ble-badge-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }

      .ble-tab-indicator {
        position: absolute;
        bottom: 8px;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #333;
        box-shadow: 0 0 8px currentColor;
        transition: all 0.3s;
      }

      .ble-tab-indicator.scanning { background: #00ff88; animation: ble-tab-blink 1s infinite; }
      .ble-tab-indicator.connected { background: #00ff88; box-shadow: 0 0 10px #00ff88; }

      @keyframes ble-tab-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }

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

      .ble-panel.active { transform: translateX(0); }

      .ble-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.6);
        backdrop-filter: blur(4px);
        z-index: 2147483644;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s;
      }

      .ble-overlay.active { opacity: 1; visibility: visible; }

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

      .ble-icon { font-size: 24px; filter: drop-shadow(0 0 10px rgba(0,255,255,0.5)); }

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

      .ble-btn-icon:hover { background: rgba(255,255,255,0.1); transform: rotate(90deg); }

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

      .ble-btn-primary:active { transform: translateY(0); }
      .ble-btn-primary.scanning {
        background: linear-gradient(135deg, #ff4444 0%, #ff0088 100%);
        animation: ble-pulse 1.5s infinite;
      }

      @keyframes ble-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.8; }
      }

      .ble-scan-icon { font-size: 18px; display: inline-block; }
      .ble-btn-primary.scanning .ble-scan-icon { animation: ble-rotate 2s linear infinite; }

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

      .ble-status-indicator.scanning { background: #00ff88; animation: ble-blink 1s infinite; }

      @keyframes ble-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }

      .ble-section {
        padding: 15px 20px;
        flex: 1;
        overflow-y: auto;
      }

      .ble-connected-section {
        border-top: 1px solid rgba(255,255,255,0.05);
        max-height: 35%;
        flex: 0 0 auto;
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

      .ble-device-card:hover::before { opacity: 1; }
      .ble-device-card.connecting {
        animation: ble-connecting 1s infinite;
        border-color: #ffaa00;
      }

      @keyframes ble-connecting {
        0%, 100% { border-color: #ffaa00; }
        50% { border-color: transparent; }
      }

      .ble-device-card.connected {
        border-left: 3px solid #00ff88;
        background: rgba(0,255,136,0.05);
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

      .ble-device-info { flex: 1; min-width: 0; }

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

      .ble-signal-bar span.active { opacity: 1; }
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

      .ble-btn-connect:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .ble-empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #666;
      }

      .ble-empty-icon { font-size: 48px; margin-bottom: 15px; opacity: 0.5; }
      .ble-empty-state p { font-size: 14px; line-height: 1.5; }

      .ble-info {
        padding: 15px 20px;
        border-top: 1px solid rgba(255,255,255,0.1);
        display: flex;
        justify-content: space-between;
        background: rgba(0,0,0,0.3);
        font-size: 12px;
      }

      .ble-info-item { display: flex; gap: 8px; }
      .ble-info-label { color: #666; }
      .ble-info-value { color: #00ffff; font-weight: 600; font-family: monospace; }
      .ble-state-offline { color: #ff4444; }
      .ble-state-scanning { color: #ffaa00; }
      .ble-state-connected { color: #00ff88; }

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

      .ble-modal.active { display: flex; opacity: 1; }

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

      .ble-modal.active .ble-modal-content { transform: scale(1); }

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

      .ble-modal-body { padding: 30px 20px; }
      
      .ble-modal .ble-device-info {
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

      .ble-device-details { width: 100%; }
      .ble-modal .ble-device-name { font-size: 20px; color: #fff; margin-bottom: 5px; }
      .ble-device-id { font-size: 12px; color: #888; font-family: monospace; margin-bottom: 10px; }

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

      @media (max-width: 480px) {
        .ble-panel { width: 90vw; }
        #ble-tab { width: 40px; height: 100px; }
        .ble-tab-label { font-size: 10px; }
      }
    `;
    document.head.appendChild(styles);
  }

  setupEventListeners() {
    this.elements.tab.addEventListener('click', () => this.show());
    document.getElementById('ble-close').addEventListener('click', () => this.hide());
    this.elements.overlay.addEventListener('click', () => this.hide());
    this.elements.scanBtn.addEventListener('click', () => this.toggleScan());

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        this.toggle();
      }
      if (e.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });

    document.getElementById('ble-accept-btn').addEventListener('click', () => this.acceptRequest());
    document.getElementById('ble-reject-btn').addEventListener('click', () => this.rejectRequest());
  }

  show() {
    this.isVisible = true;
    this.elements.panel.classList.add('active');
    this.elements.overlay.classList.add('active');
    this.elements.tab.classList.add('hidden');
    this.newDevicesCount = 0;
    this.updateBadge();
    this.updateStatus();
  }

  hide() {
    this.isVisible = false;
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
    this.elements.tab.classList.remove('hidden');
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
      await this.stopScan();
    } else {
      await this.startScan();
    }
  }

  async startScan() {
    // FIX: Verificar permisos primero
    if (!await this.checkBLEPermissions()) {
      return;
    }

    try {
      this.isScanning = true;
      this.foundDevices.clear();
      this.newDevicesCount = 0;
      this.updateBadge();
      this.renderDevicesList();
      this.startScanUI();
      
      await this.bleMesh.startScan(30000);
      console.log('[BLEInterface] Scan started');
    } catch (err) {
      console.error('[BLEInterface] Scan error:', err);
      this.stopScanUI();
      this.showToast('Error al iniciar scan: ' + err.message, 'error');
    }
  }

  async stopScan() {
    try {
      await this.bleMesh.stopScan();
    } catch (e) {
      console.warn('[BLEInterface] Error stopping scan:', e);
    }
    this.stopScanUI();
  }

  startScanUI() {
    this.elements.scanBtn.classList.add('scanning');
    this.elements.scanText.textContent = 'Detener Scan';
    this.elements.scanStatus.classList.add('scanning');
    this.elements.indicator.classList.add('scanning');
    this.updateStatus();
  }

  stopScanUI() {
    this.isScanning = false;
    this.elements.scanBtn.classList.remove('scanning');
    this.elements.scanText.textContent = 'Iniciar Scan';
    this.elements.scanStatus.classList.remove('scanning');
    this.elements.indicator.classList.remove('scanning');
    this.updateStatus();
  }

  handleDeviceFound(device) {
    const id = device.id || device.endpointId;
    if (!id || this.foundDevices.has(id)) return;
    
    const rssi = device.rssi || (device.distance ? -50 - (device.distance * 10) : -50);
    
    this.foundDevices.set(id, {
      ...device,
      id: id,
      timestamp: Date.now(),
      rssi: Math.round(rssi)
    });
    
    if (!this.isVisible) {
      this.newDevicesCount++;
      this.updateBadge();
    }
    
    this.renderDevicesList();
    this.updateCounters();
  }

  updateBadge() {
    if (this.newDevicesCount > 0 && !this.isVisible) {
      this.elements.badge.textContent = this.newDevicesCount > 9 ? '9+' : this.newDevicesCount;
      this.elements.badge.style.display = 'flex';
    } else {
      this.elements.badge.style.display = 'none';
    }
  }

  handleDeviceConnected(peer) {
    this.renderConnectedDevices();
    this.updateStatus();
    this.showToast(`Conectado: ${peer.name || 'dispositivo'}`, 'success');
    if (this.onDeviceConnected) this.onDeviceConnected(peer);
  }

  handleDeviceDisconnected(peer) {
    this.renderConnectedDevices();
    this.updateStatus();
    this.showToast(`Desconectado: ${peer.name || 'dispositivo'}`, 'info');
    if (this.onDeviceDisconnected) this.onDeviceDisconnected(peer);
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
      this.elements.foundCount.textContent = '0';
      return;
    }

    list.innerHTML = '';
    const sorted = Array.from(this.foundDevices.values()).sort((a, b) => b.timestamp - a.timestamp);
    
    sorted.forEach((device) => {
      const card = this.createDeviceCard(device);
      list.appendChild(card);
    });
    
    this.elements.foundCount.textContent = this.foundDevices.size;
  }

  createDeviceCard(device) {
    const div = document.createElement('div');
    div.className = 'ble-device-card';
    div.id = `ble-device-${device.id}`;
    
    const signalBars = Math.max(1, Math.min(4, Math.floor((device.rssi + 100) / 15)));
    
    div.innerHTML = `
      <div class="ble-device-icon">📱</div>
      <div class="ble-device-info">
        <div class="ble-device-name">${device.name || 'NEXO Device'}</div>
        <div class="ble-device-meta">
          <span class="ble-signal">
            <span class="ble-signal-bar">
              ${[1,2,3,4].map(i => `<span class="${i <= signalBars ? 'active' : ''}"></span>`).join('')}
            </span>
            ${device.rssi}dBm
          </span>
          <span>${device.id.substr(0, 8)}...</span>
        </div>
      </div>
      <button class="ble-btn-connect" data-id="${device.id}">
        Conectar
      </button>
    `;
    
    div.querySelector('.ble-btn-connect').addEventListener('click', () => {
      this.requestConnection(device.id);
    });
    
    return div;
  }

  async requestConnection(deviceId) {
    const device = this.foundDevices.get(deviceId);
    if (!device) return;

    const btn = document.querySelector(`button[data-id="${deviceId}"]`);
    if (btn) {
      btn.textContent = 'Conectando...';
      btn.disabled = true;
      btn.closest('.ble-device-card').classList.add('connecting');
    }

    try {
      await this.bleMesh.connect(deviceId);
    } catch (err) {
      this.showToast(`Error de conexión: ${err.message}`, 'error');
      this.renderDevicesList();
    }
  }

  handleConnectionRequest(device) {
    const requestId = device.id || device.endpointId;
    this.pendingRequests.set(requestId, device);
    
    this.elements.requestName.textContent = device.name || 'NEXO Device';
    this.elements.requestId.textContent = `ID: ${requestId.substr(0, 16)}...`;
    
    this.elements.modal.classList.add('active');
    
    setTimeout(() => {
      if (this.pendingRequests.has(requestId)) {
        this.rejectRequest(requestId);
      }
    }, 30000);
  }

  async acceptRequest(requestId) {
    const id = requestId || Array.from(this.pendingRequests.keys())[0];
    if (!id) {
      this.elements.modal.classList.remove('active');
      return;
    }

    const device = this.pendingRequests.get(id);
    this.pendingRequests.delete(id);
    this.elements.modal.classList.remove('active');
    
    try {
      if (this.bleMesh.acceptConnection) {
        await this.bleMesh.acceptConnection(id);
      } else {
        await this.bleMesh.connect(id);
      }
      this.showToast('Conexión aceptada', 'success');
    } catch (err) {
      this.showToast('Error al aceptar conexión', 'error');
    }
  }

  rejectRequest(requestId) {
    const id = requestId || Array.from(this.pendingRequests.keys())[0];
    if (!id) {
      this.elements.modal.classList.remove('active');
      return;
    }

    this.pendingRequests.delete(id);
    this.elements.modal.classList.remove('active');
    
    if (this.bleMesh.rejectConnection) {
      this.bleMesh.rejectConnection(id).catch(() => {});
    }
    
    this.showToast('Solicitud rechazada', 'info');
  }

  renderConnectedDevices() {
    const peers = this.bleMesh.getPeers ? this.bleMesh.getPeers() : [];
    this.elements.connectedCount.textContent = peers.length;
    
    const list = this.elements.connectedList;
    
    if (peers.length === 0) {
      list.innerHTML = '<div class="ble-empty-state" style="padding: 20px;"><p style="font-size: 13px;">No hay dispositivos conectados</p></div>';
      return;
    }

    list.innerHTML = '';
    peers.forEach(peer => {
      const div = document.createElement('div');
      div.className = 'ble-device-card connected';
      div.innerHTML = `
        <div class="ble-device-icon" style="background: rgba(0,255,136,0.1);">✓</div>
        <div class="ble-device-info">
          <div class="ble-device-name">${peer.name || 'Connected Device'}</div>
          <div class="ble-device-meta" style="color: #00ff88;">
            Conectado • ${peer.id.substr(0, 8)}...
          </div>
        </div>
        <button class="ble-btn-connect" style="color: #ff4444; border-color: rgba(255,68,68,0.5); background: rgba(255,68,68,0.1);">
          Desconectar
        </button>
      `;
      
      div.querySelector('.ble-btn-connect').addEventListener('click', () => {
        this.disconnect(peer.id);
      });
      
      list.appendChild(div);
    });
  }

  async disconnect(deviceId) {
    try {
      await this.bleMesh.disconnect(deviceId);
    } catch (err) {
      this.showToast('Error al desconectar', 'error');
    }
  }

  updateStatus() {
    if (!this.bleMesh) return;
    
    const status = this.bleMesh.getStatus ? this.bleMesh.getStatus() : {};
    const isScanning = status.scanning || this.isScanning;
    const peerCount = status.peers || 0;
    
    this.elements.peers.textContent = peerCount;
    
    this.elements.indicator.className = 'ble-tab-indicator';
    if (peerCount > 0) {
      this.elements.indicator.classList.add('connected');
      this.elements.state.textContent = 'CONNECTED';
      this.elements.state.className = 'ble-info-value ble-state-connected';
    } else if (isScanning) {
      this.elements.indicator.classList.add('scanning');
      this.elements.state.textContent = 'SCANNING';
      this.elements.state.className = 'ble-info-value ble-state-scanning';
    } else {
      this.elements.state.textContent = 'OFFLINE';
      this.elements.state.className = 'ble-info-value ble-state-offline';
    }
  }

  updateCounters() {
    this.elements.foundCount.textContent = this.foundDevices.size;
  }

  showToast(message, type = 'info') {
    if (window.rem) {
      const method = type === 'error' ? 'error' : type === 'success' ? 'success' : 'info';
      window.rem[method](message, `BLE_${type.toUpperCase()}`);
    } else {
      console.log(`[BLE ${type}] ${message}`);
    }
  }

  destroy() {
    this.hide();
    if (this.isScanning && this.bleMesh) {
      this.bleMesh.stopScan().catch(() => {});
    }
    this.elements.tab?.remove();
    this.elements.panel?.remove();
    this.elements.modal?.remove();
    this.elements.overlay?.remove();
    document.getElementById('ble-styles')?.remove();
  }
}

export let bleInterface = null;

export function initBLEInterface(bleMesh) {
  if (!bleMesh) {
    console.error('[BLEInterface] bleMesh es requerido');
    return null;
  }
  bleInterface = new BLEInterface(bleMesh);
  bleInterface.init();
  window.bleInterface = bleInterface;
  return bleInterface;
}
