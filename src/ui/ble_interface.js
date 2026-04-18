/**
 * BLE Interface v2.3-NAP
 * Sistema UI BLE con soporte Dual: NordicMesh + HybridMesh
 * + FEATURE: Botón Visibilidad (Advertising toggle)
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
    
    // NUEVO: Estado de visibilidad (advertising)
    this.isAdvertising = false;
    this.canAdvertise = false;
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
      // NUEVO: Inicializar estado de visibilidad
      this._initVisibility();
    }
    
    return this;
  }

  // NUEVO: Inicializar estado de visibilidad desde el mesh
  async _initVisibility() {
    if (this.isDummyMode || !this.bleMesh) return;
    
    try {
      // Obtener capacidades si el método existe
      if (this.bleMesh.getVisibilityState) {
        const state = this.bleMesh.getVisibilityState();
        this.canAdvertise = state.canAdvertise;
        this.isAdvertising = state.isAdvertising;
        this.updateVisibilityButton();
        
        // Escuchar cambios de visibilidad
        if (this.bleMesh.on) {
          this.bleMesh.on('visibilityChanged', (data) => {
            this.isAdvertising = data.visible;
            this.updateVisibilityButton();
          });
        }
      }
    } catch (err) {
      console.warn('[BLEInterface] Error initializing visibility:', err);
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
      
      <!-- NUEVO: Contenedor de botones principales (Visibilidad + Descubrir) -->
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
    this.elements.visibilityBtn = document.getElementById('ble-visibility-btn');  // NUEVO
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
      
      /* NUEVO: Contenedor de controles principales (Visibilidad + Descubrir) */
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
       
