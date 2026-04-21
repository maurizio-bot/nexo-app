/**
 * BLE Interface v2.4.3-NAP
 * Sistema UI BLE con soporte Dual: NordicMesh + HybridMesh + Nativo Directo
 * + FIX v2.3.4: Escaneo conectado a plugin nativo NexoBLE directamente
 * + FIX v2.3.5: window.bleInterface asignado + listeners nativos de conexión
 * + FEATURE v2.4.0: Nombres de dispositivo + Sistema de Contactos Agregados
 * + FIX v2.4.1: Contactos integrados en el mismo archivo (sin import externo)
 * + FIX v2.4.2: Deduplicación robusta BLE Privacy (MAC rotativa) + fix clase CSS 'new'
 * + UX v2.4.3: Botón único mutante (Agregar → Escribir) + evento global openChat
 * 
 * FIXES NAP 2.0:
 * - Advertising via plugin nativo directo
 * - Scan via plugin nativo directo
 * - Estado real nativo en UI
 * - NAP Error Codes UI_001-006
 */

// NUEVO: Función inicializadora exportada para NexoApp v3.3.1
export function initBLEInterface(bleMesh) {
  const instance = new BLEInterface(bleMesh).init();
  // [NORDIC_010] FIX v2.3.5: Asignar instancia real a window para onclick handlers
  window.bleInterface = instance;
  return instance;
}

// NAP 2.0 Error Codes UI
const UI_ERRORS = {
  UI_001: 'MESH_NOT_AVAILABLE',
  UI_002: 'SCAN_FAILED',
  UI_003: 'CONNECT_FAILED',
  UI_004: 'DISCONNECT_FAILED',
  UI_005: 'PERMISSION_DENIED',
  UI_006: 'TIMEOUT'
};

// ============================================================
// [NORDIC_010] FEATURE v2.4.1: SISTEMA DE CONTACTOS BLE (INTEGRADO)
// ============================================================
const BLE_CONTACTS_STORAGE_KEY = 'nexo_ble_contacts_v1';

function _getBLEContacts() {
  try {
    const raw = localStorage.getItem(BLE_CONTACTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('[BLEInterface] Error leyendo contactos:', e);
    return [];
  }
}

function _addBLEContact(device) {
  const contacts = _getBLEContacts();
  const id = device.id || device.address;
  if (!id) {
    console.warn('[BLEInterface] No se puede agregar: sin ID');
    return false;
  }
  if (contacts.some(c => (c.id || c.address) === id)) {
    console.log('[BLEInterface] Ya existe:', id);
    return false;
  }
  contacts.push({
    id: id,
    address: device.address || device.id,
    name: device.name || 'NEXO Device',
    rssi: device.rssi || null,
    addedAt: Date.now()
  });
  try {
    localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
    return true;
  } catch (e) {
    console.error('[BLEInterface] Error guardando:', e);
    return false;
  }
}

function _removeBLEContact(deviceId) {
  const contacts = _getBLEContacts().filter(c => (c.id || c.address) !== deviceId);
  localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
}

function _isBLEContact(deviceId) {
  return _getBLEContacts().some(c => (c.id || c.address) === deviceId);
}

export class BLEInterface {
  constructor(bleMesh) {
    this.bleMesh = bleMesh;
    this.isScanning = false;
    this.foundDevices = new Map();
    this.connectedDevices = new Map();
    this.isVisible = false;
    this.elements = {};
    this.newDevicesCount = 0;
    // [NORDIC_010] FIX v2.4.2: Set para trackear IDs ya renderizados (clase CSS 'new')
    this._renderedDeviceIds = new Set();
    // [NORDIC_010] FIX v2.3.4: Detectar plugin nativo temprano
    this.nativePlugin = window.Capacitor?.Plugins?.NexoBLE || null;
    // Dummy mode SOLO si no hay bleMesh Y no hay plugin nativo
    this.isDummyMode = !bleMesh && !this.nativePlugin;
    this.meshType = this._detectMeshType();
    
    // [NORDIC_010] FIX v3.0.3: Estado nativo real
    this.isAdvertising = false;
    this.canAdvertise = false;
    
    // [NORDIC_010] FEATURE v2.4.0: Nombre local del dispositivo
    this.localDeviceName = 'NEXO Device';
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
    
    // Confirmar plugin nativo (por si Capacitor no estaba listo en constructor)
    if (!this.nativePlugin) {
      this.nativePlugin = window.Capacitor?.Plugins?.NexoBLE || null;
      // Re-evaluar dummy mode si descubrimos nativo tarde
      if (this.nativePlugin) {
        this.isDummyMode = !this.bleMesh && !this.nativePlugin;
      }
    }
    
    if (this.isDummyMode) {
      console.warn('[BLEInterface] Modo DUMMY - BLE no disponible');
      this.updateStatus('OFFLINE (Dummy)');
    } else {
      this.updateStatus();
      this._loadConnectedDevices();
      this._initVisibility();
      // [NORDIC_010] FIX v2.3.4: Inicializar listeners de escaneo nativo
      this._setupNativeScanListeners();
      // [NORDIC_010] FIX v2.3.5: Inicializar listeners de conexión nativo
      this._setupNativeConnectionListeners();
      // [NORDIC_010] FEATURE v2.4.0: Cargar nombre local del dispositivo
      this._loadLocalDeviceName();
    }
    
    return this;
  }

  // ============================================================
  // [NORDIC_010] FEATURE v2.4.0: OBTENER NOMBRE LOCAL DEL DISPOSITIVO
  // ============================================================
  async _loadLocalDeviceName() {
    if (!this.nativePlugin || !this.nativePlugin.getLocalDeviceInfo) return;
    try {
      const info = await this.nativePlugin.getLocalDeviceInfo();
      this.localDeviceName = info.deviceName || 'NEXO Device';
      console.log('[BLEInterface] Nombre local:', this.localDeviceName);
    } catch (e) {
      console.warn('[BLEInterface] No se pudo obtener nombre local:', e);
    }
  }

  // ============================================================
  // [NORDIC_010] FIX v2.3.4: LISTENERS NATIVOS PARA ESCANEO
  // ============================================================
  _setupNativeScanListeners() {
    if (!this.nativePlugin) return;
    
    // Limpiar listeners previos si existen (evitar duplicados)
    if (this._nativeDeviceFoundListener) {
      this._nativeDeviceFoundListener.remove();
    }
    if (this._nativeScanFailedListener) {
      this._nativeScanFailedListener.remove();
    }
    
    // Listener: Dispositivo encontrado durante escaneo nativo
    this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', (data) => {
      console.log('[BLEInterface] Nativo: onDeviceFound', data);
      // Mapear formato nativo (deviceId) -> formato interno (id/address)
      const device = {
        id: data.deviceId,
        address: data.deviceId,
        name: data.name || 'NEXO Device',
        rssi: data.rssi
      };
      this.onDeviceFound(device);
    });
    
    // Listener: Error de escaneo nativo
    this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', (data) => {
      console.error('[BLEInterface] Nativo: onScanFailed', data);
      this.isScanning = false;
      this.onScanStateChanged(false);
      this.showToast('❌ Error al escanear: ' + (data.errorName || data.errorCode || 'Unknown'), 'error');
    });
    
    console.log('[BLEInterface] Listeners nativos de escaneo configurados');
  }

  // ============================================================
  // [NORDIC_010] FIX v2.3.5: LISTENERS NATIVOS PARA CONEXIÓN
  // ============================================================
  _setupNativeConnectionListeners() {
    if (!this.nativePlugin) return;
    
    // Limpiar listeners previos si existen
    if (this._nativeDeviceConnectedListener) {
      this._nativeDeviceConnectedListener.remove();
    }
    if (this._nativeDeviceDisconnectedListener) {
      this._nativeDeviceDisconnectedListener.remove();
    }
    
    // Listener: Dispositivo conectado exitosamente
    this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', (data) => {
      console.log('[BLEInterface] Nativo: onDeviceConnected', data);
      const device = {
        id: data.deviceId,
        address: data.deviceId,
        name: data.name || 'Unknown'
      };
      this.onDeviceConnected(device);
    });
    
    // Listener: Dispositivo desconectado
    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', (data) => {
      console.log('[BLEInterface] Nativo: onDeviceDisconnected', data);
      const device = {
        id: data.deviceId,
        address: data.deviceId
      };
      this.onDeviceDisconnected(device);
    });
    
    console.log('[BLEInterface] Listeners nativos de conexión configurados');
  }

  // ============================================================
  // [NORDIC_010] FIX v2.3.3: VISIBILITY AUTÓNOMO - Nativo directo
  // ============================================================
  async _initVisibility() {
    if (this.isDummyMode) return;
    
    // Si no hay plugin nativo, fallback a bleMesh (limitado)
    if (!this.nativePlugin) {
      console.warn('[BLEInterface] Plugin nativo NexoBLE no disponible, usando fallback bleMesh');
      await this._initVisibilityFallback();
      return;
    }
    
    try {
      // 1. Verificar si Bluetooth está activado y tenemos permisos
      const btState = await this.nativePlugin.isBluetoothEnabled();
      
      // [NORDIC_010] Verificar canAdvertise desde el health report nativo
      this.canAdvertise = btState.canAdvertise || false;
      
      if (!this.canAdvertise) {
        console.warn('[BLEInterface] Advertising no disponible según nativo. Permisos:', btState.health);
        this.isAdvertising = false;
        this.updateVisibilityButton();
        return;
      }
      
      // 2. Verificar estado actual de advertising nativo
      const adState = await this.nativePlugin.isAdvertising();
      this.isAdvertising = adState.isAdvertising === true;
      
      console.log('[BLEInterface] Estado nativo - canAdvertise:', this.canAdvertise, 'isAdvertising:', this.isAdvertising);
      
      this.updateVisibilityButton();
      
      // 3. Escuchar eventos nativos de advertising (CRÍTICO)
      this._setupNativeAdvertisingListeners();
      
    } catch (err) {
      console.error('[BLEInterface] Error consultando estado nativo:', err);
      // Fallback al comportamiento anterior
      await this._initVisibilityFallback();
    }
  }
  
  // [NORDIC_010] FIX v2.3.3: Listeners nativos para eventos de advertising
  _setupNativeAdvertisingListeners() {
    if (!this.nativePlugin) return;
    
    // Limpiar listeners anteriores si existen (evitar duplicados)
    if (this._nativeAdStartedListener) {
      this._nativeAdStartedListener.remove();
    }
    if (this._nativeAdFailedListener) {
      this._nativeAdFailedListener.remove();
    }
    
    // Listener: Advertising iniciado exitosamente
    this._nativeAdStartedListener = this.nativePlugin.addListener('onAdvertiseStarted', (data) => {
      console.log('[BLEInterface] Nativo: onAdvertiseStarted', data);
      this.isAdvertising = true;
      this.updateVisibilityButton();
      this.showToast('👁️‍🗨️ Visibilidad activada - Ahora eres visible', 'success');
    });
    
    // Listener: Advertising falló
    this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', (data) => {
      console.error('[BLEInterface] Nativo: onAdvertiseFailed', data);
      this.isAdvertising = false;
      this.updateVisibilityButton();
      this.showToast('❌ Error al activar visibilidad: ' + (data.errorCode || 'Unknown'), 'error');
    });
  }

  // Fallback al comportamiento anterior (cuando nativo no está disponible)
  async _initVisibilityFallback() {
    try {
      if (this.bleMesh && this.bleMesh.getCapabilities) {
        const caps = await this.bleMesh.getCapabilities();
        this.canAdvertise = caps.canAdvertise || false;
      }
      
      if (this.bleMesh && this.bleMesh.getVisibilityState) {
        const state = await this.bleMesh.getVisibilityState();
        this.isAdvertising = state.isAdvertising || false;
      }
      
      this.updateVisibilityButton();
      
      if (this.bleMesh && this.bleMesh.on) {
        this.bleMesh.on('visibilityChanged', (data) => {
          this.isAdvertising = data.visible || false;
          this.updateVisibilityButton();
        });
      }
    } catch (err) {
      console.warn('[BLEInterface] Error fallback visibility:', err);
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
      // ESTADO ADVERTENCIA: Sin permiso ADVERTISE
      btn.className = 'ble-btn-visibility btn-visibility-warning';
      if (icon) icon.textContent = '⚠️';
      if (text) text.textContent = 'Visibilidad desactivada';
      btn.title = 'Conceda permiso "Dispositivos cercanos" para activar visibilidad';
      btn.disabled = false;
    } else if (!this.isAdvertising) {
      // ESTADO APAGADO: Con permiso pero desactivado
      btn.className = 'ble-btn-visibility btn-visibility-off';
      if (icon) icon.textContent = '👁️';
      if (text) text.textContent = 'Visibilidad';
      btn.title = `Pulse para hacerse visible como: ${this.localDeviceName}`;
      btn.disabled = false;
    } else {
      // ESTADO ENCENDIDO: Visible activo
      btn.className = 'ble-btn-visibility btn-visibility-on';
      if (icon) icon.textContent = '👁️‍🗨️';
      if (text) text.textContent = 'Visible';
      btn.title = `Visible como: ${this.localDeviceName}`;
      btn.disabled = false;
    }
  }

  // ============================================================
  // [NORDIC_010] FIX v2.3.3: TOGGLE VISIBILITY - Nativo directo
  // ============================================================
  async toggleVisibility() {
    // [NORDIC_010] FIX v2.3.4: Permitir toggle si hay plugin nativo
    if (this.isDummyMode) return;
    
    try {
      // Si no tenemos permiso, mostrar advertencia
      if (!this.canAdvertise) {
        this.showToast('⚠️ Sin permiso de advertising. Conceda permisos primero.', 'warning');
        return;
      }
      
      // [NORDIC_010] FIX v2.3.3: Usar plugin nativo DIRECTAMENTE
      if (this.nativePlugin) {
        if (this.isAdvertising) {
          // Detener advertising nativo
          await this.nativePlugin.stopAdvertising();
          this.isAdvertising = false;
          this.updateVisibilityButton();
          this.showToast('👁️ Visibilidad desactivada', 'info');
        } else {
          // Iniciar advertising nativo
          const result = await this.nativePlugin.startAdvertising();
          console.log('[BLEInterface] startAdvertising() llamado nativamente:', result);
          
          // Verificación de seguridad después de 500ms
          setTimeout(async () => {
            try {
              const check = await this.nativePlugin.isAdvertising();
              if (!check.isAdvertising) {
                console.warn('[BLEInterface] Advertising no se activó después de llamar startAdvertising');
                this.showToast('⚠️ La visibilidad no pudo activarse. Verifique permisos.', 'warning');
              }
            } catch (e) {
              // Ignorar error de verificación
            }
          }, 500);
        }
        return;
      }
      
      // Fallback al bleMesh si no hay plugin nativo
      if (this.bleMesh && this.bleMesh.toggleVisibility) {
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
      this.showToast('❌ Error al cambiar visibilidad: ' + err.message, 'error');
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

    // Panel con tabs para Discovery / Added / Connected
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
        <button class="ble-tab-btn" data-tab="added">Agregados</button>
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
      
      <!-- Added Tab -->
      <div id="tab-added" class="ble-tab-content">
        <div class="ble-list" id="ble-added-list">
          <p class="ble-empty">No hay contactos agregados</p>
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
        gap: 8px;
        margin-bottom: 15px;
      }
      .ble-tab-btn {
        flex: 1;
        padding: 10px 4px;
        background: #222;
        border: 1px solid #333;
        border-radius: 6px;
        color: #888;
        cursor: pointer;
        font-size: 11px;
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
        flex: 1;
        min-width: 0;
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
        align-items: center;
        flex-shrink: 0;
      }
      
      /* [UX v2.4.3] BOTÓN AGREGAR - Verde */
      .ble-btn-add {
        padding: 8px 16px;
        background: #00ff88;
        color: #000;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
        transition: all 0.2s ease;
        white-space: nowrap;
      }
      
      .ble-btn-add:hover {
        background: #00e67a;
        transform: scale(1.05);
      }
      
      .ble-btn-add:active {
        transform: scale(0.95);
      }
      
      /* [UX v2.4.3] BOTÓN ESCRIBIR - Azul (reemplaza a Conectar) */
      .ble-btn-write {
        padding: 8px 16px;
        background: #00d4ff;
        color: #000;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
        transition: all 0.2s ease;
        white-space: nowrap;
      }
      
      .ble-btn-write:hover {
        background: #00b8e6;
        transform: scale(1.05);
      }
      
      .ble-btn-write:active {
        transform: scale(0.95);
      }
      
      /* Badge de agregado (ya no se usa como botón principal, pero se mantiene para info) */
      .ble-added-badge {
        color: #00ff88;
        font-size: 12px;
        font-weight: bold;
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
    
    // Visibilidad button
    this.elements.visibilityBtn.addEventListener('click', () => this.toggleVisibility());
    
    // Scan button
    this.elements.scanBtn.addEventListener('click', () => this.toggleScan());
    
    // Refresh button
    this.elements.refreshBtn.addEventListener('click', () => this.refreshDevices());
    
    // Tabs
    document.querySelectorAll('.ble-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });
    
    // Eventos del mesh (solo como fallback si NO hay plugin nativo)
    if (!this.isDummyMode && this.bleMesh && !this.nativePlugin) {
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
      this._loadConnectedDevices();
      // [NORDIC_010] FEATURE v2.4.0: Renderizar lista de agregados al abrir panel
      this.renderAddedList();
    }
  }

  switchTab(tabName) {
    document.querySelectorAll('.ble-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.ble-tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    
    // [NORDIC_010] FEATURE v2.4.0: Renderizar agregados si se selecciona esa pestaña
    if (tabName === 'added') {
      this.renderAddedList();
    }
  }

  // ============================================================
  // [NORDIC_010] FIX v2.3.4: TOGGLE SCAN - Nativo directo
  // ============================================================
  async toggleScan() {
    // [NORDIC_010] FIX v2.3.4: Permitir escaneo si hay plugin nativo
    if (this.isDummyMode) return;
    
    try {
      if (this.isScanning) {
        // [NORDIC_010] FIX: Usar plugin nativo directamente
        if (this.nativePlugin) {
          await this.nativePlugin.stopScan();
        } else if (this.meshType === 'nordic' && this.bleMesh.stopDiscovery) {
          await this.bleMesh.stopDiscovery();
        } else if (this.bleMesh && this.bleMesh.stopScan) {
          await this.bleMesh.stopScan();
        }
        this.isScanning = false;
        this.onScanStateChanged(false);
      } else {
        this.foundDevices.clear();
        // [NORDIC_010] FIX v2.4.2: Limpiar IDs renderizados al iniciar escaneo nuevo
        this._renderedDeviceIds.clear();
        this.renderDevicesList();
        
        // [NORDIC_010] FIX: Usar plugin nativo directamente
        if (this.nativePlugin) {
          await this.nativePlugin.startScan();
        } else if (this.meshType === 'nordic' && this.bleMesh.startDiscovery) {
          await this.bleMesh.startDiscovery();
        } else if (this.bleMesh && this.bleMesh.startScan) {
          await this.bleMesh.startScan();
        }
        this.isScanning = true;
        this.onScanStateChanged(true);
      }
    } catch (err) {
      console.error('[BLEInterface] Error toggling scan:', err);
      this.isScanning = false;
      this.onScanStateChanged(false);
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

  // ============================================================
  // [NORDIC_010] FIX v2.4.2: DEDUPLICACIÓN ROBUSTA BLE PRIVACY
  // Android 8+ rota direcciones MAC (Random Private Address). Si el plugin
  // nativo reporta MACs diferentes para el mismo dispositivo, esta lógica
  // detecta el duplicado por nombre + RSSI similar y actualiza la MAC.
  // ============================================================
  onDeviceFound(device) {
    // Normalizar ID: lowercase, trim, quitar guiones/espacios
    let id = (device.id || device.address || '').toString().toLowerCase().trim();
    
    // Fallback si no hay ID válido (no debería pasar)
    if (!id || id === 'null' || id === 'undefined') {
      console.warn('[BLEInterface] onDeviceFound: deviceId inválido, ignorando:', device);
      return;
    }
    
    // 1. Deduplicación exacta por ID (MAC estable / Public Address)
    if (this.foundDevices.has(id)) {
      const existing = this.foundDevices.get(id);
      existing.rssi = device.rssi;
      existing.name = device.name || existing.name;
      existing.lastSeen = Date.now();
      this.foundDevices.set(id, existing);
      this.renderDevicesList();
      return;
    }
    
    // 2. Deduplicación por BLE Privacy (MAC rotativa)
    // Si la MAC cambió entre advertisement packets pero es el mismo dispositivo,
    // lo detectamos por nombre idéntico + RSSI similar dentro de una ventana de tiempo.
    const now = Date.now();
    const RSSI_THRESHOLD = 15;      // ±15 dBm de margen
    const TIME_WINDOW = 30000;      // 30 segundos
    
    for (const [existingId, existing] of this.foundDevices) {
      const sameName = existing.name && device.name && existing.name === device.name;
      const sameNameValid = sameName && device.name !== 'NEXO Device'; // Evitar dedup por nombre genérico
      const rssiClose = existing.rssi != null && device.rssi != null &&
                        Math.abs(existing.rssi - device.rssi) <= RSSI_THRESHOLD;
      const recent = existing.lastSeen && (now - existing.lastSeen) < TIME_WINDOW;
      
      if (sameNameValid && rssiClose && recent) {
        // Mismo dispositivo físico, MAC rotó. Actualizar entrada existente con nueva MAC.
        console.log(`[BLEInterface] BLE Privacy dedup: ${existingId} -> ${id} (${device.name})`);
        this.foundDevices.delete(existingId);
        // Transferir estado interno
        device.lastSeen = now;
        device.addedAt = existing.addedAt; // preservar si existe
        this.foundDevices.set(id, device);
        // Actualizar referencias en contactos si la MAC cambió
        this._updateContactAddress(existingId, id);
        this.renderDevicesList();
        return;
      }
    }
    
    // 3. Nuevo dispositivo real
    device.lastSeen = now;
    this.foundDevices.set(id, device);
    this.newDevicesCount++;
    this.updateBadge();
    this.renderDevicesList();
  }

  // [NORDIC_010] FIX v2.4.2: Actualizar dirección en contactos si la MAC BLE rotó
  _updateContactAddress(oldId, newId) {
    const contacts = _getBLEContacts();
    const idx = contacts.findIndex(c => (c.id || c.address) === oldId);
    if (idx >= 0) {
      contacts[idx].id = newId;
      contacts[idx].address = newId;
      localStorage.setItem(BLE_CONTACTS_STORAGE_KEY, JSON.stringify(contacts));
      console.log('[BLEInterface] Contacto actualizado por MAC rotativa:', oldId, '->', newId);
    }
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

  // ============================================================
  // [NORDIC_010] FIX v2.3.4: LOAD CONNECTED DEVICES - Nativo directo
  // ============================================================
  async _loadConnectedDevices() {
    if (this.isDummyMode) return;
    
    try {
      let devices = [];
      
      // [NORDIC_010] FIX: Usar plugin nativo directamente
      if (this.nativePlugin && this.nativePlugin.getConnectedDevices) {
        const result = await this.nativePlugin.getConnectedDevices();
        devices = result.devices || [];
      } else if (this.bleMesh && this.bleMesh.getConnectedDevices) {
        devices = await this.bleMesh.getConnectedDevices();
      }
      
      this.connectedDevices.clear();
      devices.forEach(d => {
        this.connectedDevices.set(d.id || d.address || d.deviceId, d);
      });
      this.renderConnectedList();
    } catch (err) {
      console.warn('[BLEInterface] Error loading connected devices:', err);
    }
  }

  // ============================================================
  // [NORDIC_010] FEATURE v2.4.0: CONTACTOS AGREGADOS
  // [UX v2.4.3] MODIFICADO: addContact ahora re-renderiza para mutar botón
  // ============================================================
  async addContact(deviceId) {
    const device = this.foundDevices.get(deviceId) || this.connectedDevices.get(deviceId);
    if (!device) {
      this.showToast('❌ Dispositivo no encontrado', 'error');
      return;
    }
    
    const success = _addBLEContact(device);
    if (success) {
      this.showToast('✅ Agregado a contactos', 'success');
      // [UX v2.4.3] Re-renderizar para que el botón cambie de "Agregar" a "Escribir"
      this.renderDevicesList();
      if (document.querySelector('.ble-tab-btn[data-tab="added"]')?.classList.contains('active')) {
        this.renderAddedList();
      }
    } else {
      this.showToast('⚠️ Ya está en contactos', 'warning');
    }
  }

  async removeContact(deviceId) {
    _removeBLEContact(deviceId);
    this.showToast('❌ Eliminado de contactos', 'info');
    this.renderAddedList();
    this.renderDevicesList();
  }

  // ============================================================
  // [UX v2.4.3] NUEVO: openChat - Emite evento global para el core de NEXO
  // El core escucha 'nexo:ble:openChat' y abre la ventana de chat.
  // FIX VISTAS: Ahora también muestra el contenedor #app explícitamente
  // ============================================================
  openChat(deviceId) {
    // Buscar en dispositivos encontrados, conectados, o contactos agregados
    let device = this.foundDevices.get(deviceId) || this.connectedDevices.get(deviceId);
    
    if (!device) {
      const contacts = _getBLEContacts();
      const contact = contacts.find(c => (c.id || c.address) === deviceId);
      if (contact) {
        device = {
          id: contact.id || contact.address,
          address: contact.address,
          name: contact.name || 'NEXO Device',
          rssi: contact.rssi
        };
      }
    }
    
    if (!device) {
      this.showToast('❌ Contacto no disponible', 'error');
      return;
    }
    
    console.log('[BLEInterface] Solicitando abrir chat con:', device);
    
    // FIX VISTAS: Mostrar contenedor de chat antes de emitir evento
    const appContainer = document.getElementById('app');
    if (appContainer) {
      appContainer.classList.remove('hidden');
    }
    
    // Emitir evento global para que el core de NEXO capture y abra el chat
    const event = new CustomEvent('nexo:ble:openChat', {
      detail: {
        contactId: device.id || device.address,
        name: device.name || 'NEXO Device',
        address: device.address || device.id,
        transport: 'ble',
        rssi: device.rssi,
        // [FUTURO] El core de NEXO usará Vault para obtener datos completos
        source: 'ble_interface'
      }
    });
    window.dispatchEvent(event);
    
    // Cerrar panel BLE para mostrar el chat (el core manejará la navegación)
    this.togglePanel();
  }

  // ============================================================
  // [NORDIC_010] FIX v2.4.2: RENDER - Clase 'new' solo para dispositivos realmente nuevos
  // [UX v2.4.3] MODIFICADO: Botón único mutante (Agregar → Escribir)
  // ============================================================
  renderDevicesList() {
    const list = this.elements.devicesList;
    if (this.foundDevices.size === 0) {
      list.innerHTML = '<p class="ble-empty">Presiona buscar para encontrar dispositivos cercanos</p>';
      return;
    }
    
    list.innerHTML = '';
    this.foundDevices.forEach((device, id) => {
      const isAdded = _isBLEContact(id);
      // FIX v2.4.2: Solo marcar 'new' si este ID nunca ha sido renderizado antes
      const isNew = !this._renderedDeviceIds.has(id);
      if (isNew) {
        this._renderedDeviceIds.add(id);
      }
      
      const item = document.createElement('div');
      item.className = 'ble-device-item' + (isNew ? ' new' : '');
      
      // [UX v2.4.3] Botón único: Agregar (verde) si no está agregado, Escribir (azul) si ya está
      const actionHtml = isAdded
        ? `<button class="ble-btn-write" onclick="bleInterface.openChat('${id}')">✉️ Escribir</button>`
        : `<button class="ble-btn-add" onclick="bleInterface.addContact('${id}')">+ Agregar</button>`;
      
      item.innerHTML = `
        <div class="ble-device-info">
          <span class="ble-device-name">${device.name || 'NEXO Device'}</span>
          <span class="ble-device-id">${this._formatId(id)}</span>
          <span class="ble-device-rssi">📶 ${device.rssi || '?'} dBm</span>
        </div>
        <div class="ble-device-actions">
          ${actionHtml}
        </div>
      `;
      list.appendChild(item);
    });
  }

  // ============================================================
  // [UX v2.4.3] MODIFICADO: Agregados usan "Escribir" en lugar de "Conectar"
  // ============================================================
  renderAddedList() {
    const list = this.elements.addedList;
    const contacts = _getBLEContacts();
    
    if (contacts.length === 0) {
      list.innerHTML = '<p class="ble-empty">No hay contactos agregados. Descubre dispositivos y agrégalos.</p>';
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
          <span class="ble-device-rssi" style="color: #888; font-size: 11px;">Agregado el ${new Date(contact.addedAt).toLocaleDateString()}</span>
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
      const item = document.createElement('div');
      item.className = 'ble-device-item';
      item.innerHTML = `
        <div class="ble-device-info">
          <span class="ble-device-name">${device.name || 'Desconocido'}</span>
          <span class="ble-device-id">${this._formatId(id)}</span>
          <span class="ble-device-rssi" style="color: #00ff00;">● Conectado</span>
        </div>
        <div class="ble-device-actions">
          <button class="ble-btn-write" onclick="bleInterface.openChat('${id}')">✉️ Escribir</button>
          <button class="ble-btn-disconnect" onclick="bleInterface.disconnect('${id}')">
            Desconectar
          </button>
        </div>
      `;
      list.appendChild(item);
    });
  }

  // ============================================================
  // [NORDIC_010] FIX v2.3.4: CONNECT - Nativo directo
  // [UX v2.4.3] NOTA: connect() se mantiene para uso interno/legacy,
  // pero la UI ya no expone botón "Conectar". El chat dispara connect
  // automáticamente si es necesario.
  // ============================================================
  async connect(deviceId) {
    if (this.isDummyMode) return;
    
    try {
      const device = this.foundDevices.get(deviceId) || this.connectedDevices.get(deviceId);
      if (!device) {
        // [NORDIC_010] FEATURE v2.4.0: Buscar también en contactos agregados
        const contacts = _getBLEContacts();
        const contact = contacts.find(c => (c.id || c.address) === deviceId);
        if (!contact) {
          this.showToast('❌ Dispositivo no disponible', 'error');
          return;
        }
      }
      
      // [NORDIC_010] FIX: Usar plugin nativo directamente
      if (this.nativePlugin && this.nativePlugin.connectToDevice) {
        await this.nativePlugin.connectToDevice({ deviceId });
      } else if (this.bleMesh && this.bleMesh.connect) {
        await this.bleMesh.connect(deviceId);
      }
    } catch (err) {
      console.error('[BLEInterface] Error connecting:', err);
      this.showToast('Error al conectar', 'error');
    }
  }

  // ============================================================
  // [NORDIC_010] FIX v2.3.4: DISCONNECT - Nativo directo
  // ============================================================
  async disconnect(deviceId) {
    if (this.isDummyMode) return;
    
    try {
      // [NORDIC_010] FIX: Usar plugin nativo directamente
      if (this.nativePlugin && this.nativePlugin.disconnectDevice) {
        await this.nativePlugin.disconnectDevice({ deviceId });
      } else if (this.bleMesh && this.bleMesh.disconnect) {
        await this.bleMesh.disconnect(deviceId);
      }
    } catch (err) {
      console.error('[BLEInterface] Error disconnecting:', err);
    }
  }

  refreshDevices() {
    this._loadConnectedDevices();
    this.renderAddedList();
    this.showToast('Listas actualizadas', 'success');
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

  // ============================================================
  // [NORDIC_010] FIX v2.3.4: UPDATE STATUS - Nativo directo
  // ============================================================
  async updateStatus(customStatus) {
    if (customStatus) {
      this.elements.status.textContent = customStatus;
      this.elements.status.className = 'ble-status-offline';
      return;
    }
    
    if (this.isDummyMode) return;
    
    try {
      let state = 'UNKNOWN';
      
      // [NORDIC_010] FIX: Usar plugin nativo directamente
      if (this.nativePlugin && this.nativePlugin.isBluetoothEnabled) {
        const btState = await this.nativePlugin.isBluetoothEnabled();
        state = btState.enabled ? 'poweredOn' : 'poweredOff';
      } else if (this.meshType === 'nordic' && this.bleMesh.getState) {
        state = await this.bleMesh.getState();
      } else if (this.bleMesh && this.bleMesh.getStatus) {
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
    const styles = document.getElementById('ble-styles');
    if (styles) styles.remove();
    
    const toast = document.querySelector('.ble-toast');
    if (toast) toast.remove();
    
    // [NORDIC_010] Limpiar listeners nativos de advertising
    if (this._nativeAdStartedListener) {
      this._nativeAdStartedListener.remove();
    }
    if (this._nativeAdFailedListener) {
      this._nativeAdFailedListener.remove();
    }
    // [NORDIC_010] FIX v2.3.4: Limpiar listeners nativos de escaneo
    if (this._nativeDeviceFoundListener) {
      this._nativeDeviceFoundListener.remove();
    }
    if (this._nativeScanFailedListener) {
      this._nativeScanFailedListener.remove();
    }
    // [NORDIC_010] FIX v2.3.5: Limpiar listeners nativos de conexión
    if (this._nativeDeviceConnectedListener) {
      this._nativeDeviceConnectedListener.remove();
    }
    if (this._nativeDeviceDisconnectedListener) {
      this._nativeDeviceDisconnectedListener.remove();
    }
    
    if (this.isScanning) {
      this.toggleScan();
    }
  }
}

// Variable global para acceso desde los onclick
// [NORDIC_010] FIX v2.3.5: Se asigna la instancia real en initBLEInterface()
window.bleInterface = null;
