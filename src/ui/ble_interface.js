/**
 * BLE Interface v2.7.0-ROLE-SYNC
 * Sistema UI BLE con soporte Dual: NordicMesh + HybridMesh + Nativo Directo
 * + FIX v2.3.4: Escaneo conectado a plugin nativo NexoBLE directamente
 * + FIX v2.3.5: window.bleInterface asignado + listeners nativos de conexión
 * + FEATURE v2.4.0: Nombres de dispositivo + Sistema de Contactos Agregados
 * + FIX v2.4.1: Contactos integrados en el mismo archivo (sin import externo)
 * + FIX v2.4.2: Deduplicación robusta BLE Privacy (MAC rotativa) + fix clase CSS 'new'
 * + UX v2.4.3: Botón único mutante (Agregar → Escribir) + evento global openChat
 * + ROBUST v2.4.5: Filtrado dispositivo propio + eliminada pre-conexión duplicada
 * + RESEARCH v2.4.6: REM limpiados de funciones robustas; solo eventos nativos
 * + DUAL-ROLE v2.5.0: Listener onPayloadReceived nativo para mensajes entrantes BLE
 * + DUAL-ROLE v2.5.0: Auto-conexión en openChat para envío bidireccional
 * + FINAL v2.6.0: Máquina de estados BLE + onServicesReady + onNotificationsEnabled + onConnectionFailed + onBluetoothStackBroken
 * + ROLE-SYNC v2.7.0: Manejo transparente de roles server/client. Servidor espera peer entrante. Cliente inicia GATT.
 */

export function initBLEInterface(bleMesh) {
  const instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}

const UI_ERRORS = {
  UI_001: 'MESH_NOT_AVAILABLE',
  UI_002: 'SCAN_FAILED',
  UI_003: 'CONNECT_FAILED',
  UI_004: 'DISCONNECT_FAILED',
  UI_005: 'PERMISSION_DENIED',
  UI_006: 'TIMEOUT'
};

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

// ─── Estados de conexión BLE ───
const BLE_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  DISCOVERING_SERVICES: 'discovering_services',
  NOTIFICATIONS_READY: 'notifications_ready',
  READY_TO_CHAT: 'ready_to_chat',
  ERROR: 'error'
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
    this._incomingMessages = [];
    this._activeChatDeviceId = null;
    // ─── v2.6.0: Estados de conexión por dispositivo ───
    this._deviceStates = new Map(); // deviceId -> { state, attempt, lastError }
    // ─── v2.7.0: Roles por dispositivo (server/client) ───
    this._deviceRoles = new Map(); // deviceId -> 'server' | 'client'
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
      console.warn('[BLEInterface] Modo DUMMY - BLE no disponible');
      this.updateStatus('OFFLINE (Dummy)');
    } else {
      this.updateStatus();
      this._loadConnectedDevices();
      this._initVisibility();
      this._setupNativeScanListeners();
      this._setupNativeConnectionListeners();
      this._setupNativePayloadListener();
      this._setupNativeStateListeners(); // v2.6.0
      this._loadLocalDeviceInfo();
    }
    return this;
  }

  async _loadLocalDeviceInfo() {
    if (!this.nativePlugin || !this.nativePlugin.getLocalDeviceInfo) return;
    try {
      const info = await this.nativePlugin.getLocalDeviceInfo();
      this.localDeviceName = info.deviceName || 'NEXO Device';
      this.localDeviceAddress = (info.deviceAddress || '').toString().toLowerCase().trim();
      console.log('[BLEInterface] Info local:', this.localDeviceName, this.localDeviceAddress);
    } catch (e) {
      console.warn('[BLEInterface] No se pudo obtener info local:', e);
    }
  }

  _setupNativeScanListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeDeviceFoundListener) this._nativeDeviceFoundListener.remove();
    if (this._nativeScanFailedListener) this._nativeScanFailedListener.remove();
    
    this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', (data) => {
      console.log('[BLEInterface] Nativo: onDeviceFound', data);
      this.onDeviceFound({
        id: data.deviceId,
        address: data.deviceId,
        name: data.name || 'NEXO Device',
        rssi: data.rssi
      });
    });
    
    this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', (data) => {
      console.error('[BLEInterface] Nativo: onScanFailed', data);
      this.isScanning = false;
      this.onScanStateChanged(false);
      this.showToast('❌ Error al escanear: ' + (data.errorName || data.errorCode || 'Unknown'), 'error');
    });
    
    console.log('[BLEInterface] Listeners nativos de escaneo configurados');
  }

  _setupNativeConnectionListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeDeviceConnectedListener) this._nativeDeviceConnectedListener.remove();
    if (this._nativeDeviceDisconnectedListener) this._nativeDeviceDisconnectedListener.remove();
    
    this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', (data) => {
      console.log('[BLEInterface] Nativo: onDeviceConnected', data);
      const deviceId = data.deviceId;
      const attempt = data.attempt || 0;
      
      // v2.7.0: Manejo de dirección para determinar estado
      if (data.direction === 'incoming') {
        // Peer se conectó a nosotros (somos servidor) → canal listo inmediatamente
        this._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { 
          direction: 'incoming',
          attempt: attempt,
          role: 'server'
        });
        this._deviceRoles.set(deviceId, 'server');
        this.showToast(`✅ Peer conectado (entrante): ${this._formatId(deviceId)}`, 'success');
      } else if (data.direction === 'outgoing') {
        // Nos conectamos a peer (somos cliente) → seguir esperando servicios/notificaciones
        this._setDeviceState(deviceId, BLE_STATES.CONNECTING, { 
          direction: 'outgoing',
          attempt: attempt,
          role: 'client'
        });
        this._deviceRoles.set(deviceId, 'client');
        if (attempt > 0) {
          this.showToast(`🔄 Conectando... intento ${attempt}/3`, 'warning');
        }
      } else {
        // Dirección desconocida, fallback
        this._setDeviceState(deviceId, BLE_STATES.CONNECTING, { attempt: attempt });
      }
      
      this.onDeviceConnected({
        id: deviceId,
        address: deviceId,
        name: data.name || 'Unknown',
        direction: data.direction || 'unknown',
        servicesReady: data.servicesReady === true,
        attempt: attempt
      });
    });
    
    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', (data) => {
      console.log('[BLEInterface] Nativo: onDeviceDisconnected', data);
      const deviceId = data.deviceId;
      this._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
      this._deviceRoles.delete(deviceId);
      this.onDeviceDisconnected({
        id: deviceId,
        address: deviceId
      });
      // Si era el chat activo, limpiar
      if (this._activeChatDeviceId === deviceId) {
        this._activeChatDeviceId = null;
      }
    });
    
    console.log('[BLEInterface] Listeners nativos de conexión configurados');
  }

  // ─── v2.6.0 / v2.7.0: Nuevos listeners de estado ───
  _setupNativeStateListeners() {
    if (!this.nativePlugin) return;
    
    // onServicesReady: servicios descubiertos, habilitar chat
    this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', (data) => {
      console.log('[BLEInterface] Nativo: onServicesReady', data);
      const deviceId = data.deviceId;
      this._setDeviceState(deviceId, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
    });
    
    // onNotificationsEnabled: canal bidireccional confirmado
    this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', (data) => {
      console.log('[BLEInterface] Nativo: onNotificationsEnabled', data);
      const deviceId = data.deviceId;
      this._setDeviceState(deviceId, BLE_STATES.NOTIFICATIONS_READY, { notificationsEnabled: true });
      
      // v2.7.0: Si ya tenemos dirección (incoming/outgoing), marcar como listo para chat
      const currentState = this._getDeviceState(deviceId);
      if (currentState.direction === 'incoming') {
        // Servidor: ya estaba listo desde onDeviceConnected, confirmar
        this._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { 
          notificationsEnabled: true,
          direction: 'incoming',
          role: 'server'
        });
      } else if (currentState.direction === 'outgoing') {
        // Cliente: ahora sí está completamente listo
        this._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { 
          notificationsEnabled: true,
          direction: 'outgoing',
          role: 'client'
        });
      }
      
      if (this._activeChatDeviceId === deviceId) {
        this.showToast('✅ Canal BLE listo para mensajes', 'success');
      }
    });
    
    // onConnectionFailed: mostrar retry al usuario
    this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', (data) => {
      console.log('[BLEInterface] Nativo: onConnectionFailed', data);
      const deviceId = data.deviceId;
      const attempt = data.attempt || 0;
      const maxAttempts = data.maxAttempts || 3;
      const isRecoverable = data.recoverable !== false;
      
      if (isRecoverable && attempt < maxAttempts) {
        this._setDeviceState(deviceId, BLE_STATES.CONNECTING, { 
          attempt, 
          message: `Reintentando ${attempt + 1}/${maxAttempts}...`,
          lastError: data.reason 
        });
      } else {
        this._setDeviceState(deviceId, BLE_STATES.ERROR, { 
          lastError: data.reason,
          suggestion: data.suggestion 
        });
        this.showToast(`❌ Conexión fallida: ${data.reason}`, 'error');
      }
    });
    
    // onBluetoothStackBroken: Android 14 bug detectado
    this._nativeStackBrokenListener = this.nativePlugin.addListener('onBluetoothStackBroken', (data) => {
      console.error('[BLEInterface] Nativo: onBluetoothStackBroken', data);
      this.showToast('⚠️ Bluetooth necesita reiniciarse. Ve a Configuración > Bluetooth.', 'warning', 8000);
      // Emitir evento global para que la app muestre diálogo
      const event = new CustomEvent('nexo:ble:stackBroken', { detail: data });
      window.dispatchEvent(event);
    });
    
    console.log('[BLEInterface] Listeners nativos de estado configurados (v2.7.0)');
  }

  _setDeviceState(deviceId, state, meta = {}) {
    this._deviceStates.set(deviceId, { state, ...meta, timestamp: Date.now() });
    console.log(`[BLEInterface] Estado ${deviceId}: ${state}`, meta);
    this.renderConnectedList(); // Refrescar UI
  }

  _getDeviceState(deviceId) {
    return this._deviceStates.get(deviceId) || { state: BLE_STATES.DISCONNECTED };
  }

  _setupNativePayloadListener() {
    if (!this.nativePlugin) return;
    if (this._nativePayloadListener) this._nativePayloadListener.remove();
    
    this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', (data) => {
      console.log('[BLEInterface] Nativo: onPayloadReceived', data);
      const deviceId = data.deviceId;
      const messageText = data.data || '';
      const source = data.source || 'unknown';
      
      // Emitir evento global para nexo_app.js
      const event = new CustomEvent('nexo:ble:messageReceived', {
        detail: {
          deviceId: deviceId,
          content: messageText,
          source: source,
          timestamp: data.timestamp || Date.now()
        }
      });
      window.dispatchEvent(event);
      
      // Si el chat con este dispositivo está activo, mostrar toast silencioso
      if (this._activeChatDeviceId === deviceId) {
        console.log('[BLEInterface] Mensaje entrante en chat activo:', messageText);
      } else {
        this.showToast('📨 Mensaje BLE de ' + this._formatId(deviceId), 'info');
        this.newDevicesCount++;
        this.updateBadge();
      }
    });
    
    // v2.7.0: Eliminado listener duplicado de onNotificationsEnabled (ya está en _setupNativeStateListeners)
    
    console.log('[BLEInterface] Listener nativo de payload configurado (DUAL-ROLE)');
  }

  async _initVisibility() {
    if (this.isDummyMode) return;
    if (!this.nativePlugin) {
      console.warn('[BLEInterface] Plugin nativo NexoBLE no disponible, usando fallback bleMesh');
      await this._initVisibilityFallback();
      return;
    }
    
    try {
      const btState = await this.nativePlugin.isBluetoothEnabled();
      this.canAdvertise = btState.canAdvertise || false;
      
      if (!this.canAdvertise) {
        console.warn('[BLEInterface] Advertising no disponible según nativo. Permisos:', btState.health);
        this.isAdvertising = false;
        this.updateVisibilityButton();
        return;
      }
      
      const adState = await this.nativePlugin.isAdvertising();
      this.isAdvertising = adState.isAdvertising === true;
      console.log('[BLEInterface] Estado nativo - canAdvertise:', this.canAdvertise, 'isAdvertising:', this.isAdvertising);
      this.updateVisibilityButton();
      this._setupNativeAdvertisingListeners();
    } catch (err) {
      console.error('[BLEInterface] Error consultando estado nativo:', err);
      await this._initVisibilityFallback();
    }
  }
  
  _setupNativeAdvertisingListeners() {
    if (!this.nativePlugin) return;
    if (this._nativeAdStartedListener) this._nativeAdStartedListener.remove();
    if (this._nativeAdFailedListener) this._nativeAdFailedListener.remove();
    
    this._nativeAdStartedListener = this.nativePlugin.addListener('onAdvertiseStarted', (data) => {
      console.log('[BLEInterface] Nativo: onAdvertiseStarted', data);
      this.isAdvertising = true;
      this.updateVisibilityButton();
      this.showToast('👁️‍🗨️ Visibilidad activada - Ahora eres visible', 'success');
    });
    
    this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', (data) => {
      console.error('[BLEInterface] Nativo: onAdvertiseFailed', data);
      this.isAdvertising = false;
      this.updateVisibilityButton();
      this.showToast('❌ Error al activar visibilidad: ' + (data.errorCode || 'Unknown'), 'error');
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
      btn.title = 'Conceda permiso "Dispositivos cercanos" para activar visibilidad';
      btn.disabled = false;
    } else if (!this.isAdvertising) {
      btn.className = 'ble-btn-visibility btn-visibility-off';
      if (icon) icon.textContent = '👁️';
      if (text) text.textContent = 'Visibilidad';
      btn.title = `Pulse para hacerse visible como: ${this.localDeviceName}`;
      btn.disabled = false;
    } else {
      btn.className = 'ble-btn-visibility btn-visibility-on';
      if (icon) icon.textContent = '👁️‍🗨️';
      if (text) text.textContent = 'Visible';
      btn.title = `Visible como: ${this.localDeviceName}`;
      btn.disabled = false;
    }
  }

  async toggleVisibility() {
    if (this.isDummyMode) return;
    try {
      if (!this.canAdvertise) {
        this.showToast('⚠️ Sin permiso de advertising. Conceda permisos primero.', 'warning');
        return;
      }
      if (this.nativePlugin) {
        if (this.isAdvertising) {
          await this.nativePlugin.stopAdvertising();
          this.isAdvertising = false;
          this.updateVisibilityButton();
          this.showToast('👁️ Visibilidad desactivada', 'info');
        } else {
          const result = await this.nativePlugin.startAdvertising();
          console.log('[BLEInterface] startAdvertising() llamado nativamente:', result);
          setTimeout(async () => {
            try {
              const check = await this.nativePlugin.isAdvertising();
              if (!check.isAdvertising) {
                console.warn('[BLEInterface] Advertising no se activó después de llamar startAdvertising');
                this.showToast('⚠️ La visibilidad no pudo activarse. Verifique permisos.', 'warning');
              }
            } catch (e) {}
          }, 500);
        }
        return;
      }
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
    const tab = document.createElement('div');
    tab.id = 'ble-tab';
    tab.innerHTML = `
      <div class="ble-tab-icon">🔷</div>
      <div class="ble-tab-label">BLE</div>
      <div class="ble-tab-badge" id="ble-tab-badge" style="display: none;">0</div>
    `;
    document.body.appendChild(tab);
    this.elements.tab = tab;

    const panel = document.createElement('div');
    panel.id = 'ble-panel';
    panel.innerHTML = `
      <div class="ble-header">
        <h3>🔷 BLE Mesh</h3>
        <button id="ble-close">✕</button>
      </div>
      <div class="ble-tabs">
        <button class="ble-tab-btn active" data-tab="discovery">Descubrir</button>
        <button class="ble-tab-btn" data-tab="added">Agregados</button>
        <button class="ble-tab-btn" data-tab="connected">Conectados</button>
      </div>
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
        <button id="ble-refresh-btn" class="ble-btn secondary" style="display: none;">🔄 Actualizar Lista</button>
        <span id="ble-status" class="ble-status-offline">OFFLINE</span>
      </div>
      <div id="tab-discovery" class="ble-tab-content active">
        <div class="ble-list" id="ble-devices-list">
          <p class="ble-empty">${this.isDummyMode ? 'BLE Mesh no inicializado' : 'Presiona buscar para encontrar dispositivos cercanos'}</p>
        </div>
      </div>
      <div id="tab-added" class="ble-tab-content">
        <div class="ble-list" id="ble-added-list">
          <p class="ble-empty">No hay contactos agregados</p>
        </div>
      </div>
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
      #ble-tab { position: fixed; left: 0; top: 50%; transform: translateY(-50%); width: 44px; height: 100px; background: linear-gradient(180deg, #00d4ff, #0099cc); border-radius: 0 12px 12px 0; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; z-index: 2147483644; color: #000; font-weight: bold; box-shadow: 2px 0 10px rgba(0,212,255,0.3); }
      #ble-tab.hidden { transform: translateY(-50%) translateX(-100%); }
      .ble-tab-badge { position: absolute; top: 5px; right: -5px; background: #ff4444; color: white; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; animation: pulse 2s infinite; }
      @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
      #ble-panel { position: fixed; top: 0; left: 0; width: 85vw; max-width: 400px; height: 100vh; background: rgba(10,10,15,0.98); transform: translateX(-100%); transition: transform 0.3s ease; z-index: 2147483645; color: #fff; padding: 20px; overflow-y: auto; }
      #ble-panel.active { transform: translateX(0); }
      #ble-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.6); display: none; z-index: 2147483644; backdrop-filter: blur(4px); }
      #ble-overlay.active { display: block; }
      .ble-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px; }
      .ble-tabs { display: flex; gap: 8px; margin-bottom: 15px; }
      .ble-tab-btn { flex: 1; padding: 10px 4px; background: #222; border: 1px solid #333; border-radius: 6px; color: #888; cursor: pointer; font-size: 11px; }
      .ble-tab-btn.active { background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; font-weight: bold; border-color: #00d4ff; }
      .ble-tab-content { display: none; }
      .ble-tab-content.active { display: block; }
      .ble-main-controls { display: flex; gap: 12px; justify-content: center; align-items: center; margin-bottom: 10px; }
      .ble-secondary-controls { margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; }
      .ble-btn-visibility { flex: 1; max-width: 140px; height: 48px; border-radius: 12px; border: none; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.3s ease; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ble-btn-visibility.btn-visibility-warning { background: #4A3A00 !important; color: #FFCC00 !important; border: 1px solid #FFCC00 !important; cursor: pointer; }
      .ble-btn-visibility.btn-visibility-off { background: #3A3A3A; color: #888888; border: 1px solid transparent; }
      .ble-btn-visibility.btn-visibility-on { background: #00D9FF; color: #000000; border: 1px solid #00D9FF; box-shadow: 0 0 12px rgba(0, 217, 255, 0.4); }
      .ble-btn-visibility:disabled { background: #2A2A2A; color: #555555; cursor: not-allowed; opacity: 0.6; }
      .ble-btn-discover { flex: 1.2; height: 56px; border-radius: 14px; border: none; font-weight: 700; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #00d4ff, #0099cc); color: #000; box-shadow: 0 4px 15px rgba(0, 212, 255, 0.3); transition: all 0.3s ease; }
      .ble-btn-discover:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0, 212, 255, 0.4); }
      .ble-btn-discover:active:not(:disabled) { transform: translateY(0); }
      .ble-btn-discover:disabled { background: #2A2A2A; color: #555; cursor: not-allowed; opacity: 0.6; box-shadow: none; }
      .ble-btn-discover.scanning { background: linear-gradient(135deg, #ff4444, #cc0000); color: #fff; animation: pulse-red 1.5s infinite; }
      @keyframes pulse-red { 0%, 100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.4); } 50% { box-shadow: 0 0 0 10px rgba(255, 68, 68, 0); } }
      .ble-btn.secondary { padding: 8px 12px; background: #333; border: 1px solid #444; border-radius: 6px; color: #aaa; cursor: pointer; font-size: 12px; }
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
      .ble-btn-add { padding: 8px 16px; background: #00ff88; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; transition: all 0.2s ease; white-space: nowrap; }
      .ble-btn-add:hover { background: #00e67a; transform: scale(1.05); }
      .ble-btn-add:active { transform: scale(0.95); }
      .ble-btn-write { padding: 8px 16px; background: #00d4ff; color: #000; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold; transition: all 0.2s ease; white-space: nowrap; }
      .ble-btn-write:hover { background: #00b8e6; transform: scale(1.05); }
      .ble-btn-write:active { transform: scale(0.95); }
      .ble-btn-write:disabled { background: #555; color: #aaa; cursor: not-allowed; }
      .ble-added-badge { color: #00ff88; font-size: 12px; font-weight: bold; }
      .ble-btn-connect { padding: 6px 12px; background: #00d4ff; color: #000; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; }
      .ble-btn-disconnect { padding: 6px 12px; background: #ff4444; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
      .ble-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 12px 24px; border-radius: 8px; color: #fff; font-weight: bold; z-index: 2147483646; animation: fadeInUp 0.3s ease; }
      .ble-toast.success { background: #00d4ff; color: #000; }
      .ble-toast.error { background: #ff4444; }
      .ble-toast.warning { background: #ffaa00; color: #000; }
      .ble-toast.info { background: #444; }
      @keyframes fadeInUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
      /* v2.6.0: Estados de conexión */
      .ble-state-connecting { color: #ffaa00; font-size: 11px; }
      .ble-state-ready { color: #00ff88; font-size: 11px; }
      .ble-state-error { color: #ff4444; font-size: 11px; }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    this.elements.tab.addEventListener('click', () => this.togglePanel());
    this.elements.closeBtn.addEventListener('click', () => this.togglePanel());
    this.elements.overlay.addEventListener('click', () => this.togglePanel());
    this.elements.visibilityBtn.addEventListener('click', () => this.toggleVisibility());
    this.elements.scanBtn.addEventListener('click', () => this.toggleScan());
    this.elements.refreshBtn.addEventListener('click', () => this.refreshDevices());
    
    document.querySelectorAll('.ble-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });
    
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
      this.renderAddedList();
    }
  }

  switchTab(tabName) {
    document.querySelectorAll('.ble-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.ble-tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    if (tabName === 'added') this.renderAddedList();
  }

  async toggleScan() {
    if (this.isDummyMode) return;
    try {
      if (this.isScanning) {
        if (this.nativePlugin) await this.nativePlugin.stopScan();
        else if (this.meshType === 'nordic' && this.bleMesh.stopDiscovery) await this.bleMesh.stopDiscovery();
        else if (this.bleMesh && this.bleMesh.stopScan) await this.bleMesh.stopScan();
        this.isScanning = false;
        this.onScanStateChanged(false);
      } else {
        this.foundDevices.clear();
        this._renderedDeviceIds.clear();
        this.renderDevicesList();
        if (this.nativePlugin) await this.nativePlugin.startScan();
        else if (this.meshType === 'nordic' && this.bleMesh.startDiscovery) await this.bleMesh.startDiscovery();
        else if (this.bleMesh && this.bleMesh.startScan) await this.bleMesh.startScan();
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

  onDeviceFound(device) {
    let id = (device.id || device.address || '').toString().toLowerCase().trim();
    if (!id || id === 'null' || id === 'undefined') {
      console.warn('[BLEInterface] onDeviceFound: deviceId inválido, ignorando:', device);
      return;
    }
    
    if (this.localDeviceAddress && id === this.localDeviceAddress) {
      console.log('[BLEInterface] Ignorando dispositivo propio en descubrimiento:', id);
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
    const now = Date.now();
    const RSSI_THRESHOLD = 15;
    const TIME_WINDOW = 30000;
    for (const [existingId, existing] of this.foundDevices) {
      const sameName = existing.name && device.name && existing.name === device.name;
      const sameNameValid = sameName && device.name !== 'NEXO Device';
      const rssiClose = existing.rssi != null && device.rssi != null &&
                        Math.abs(existing.rssi - device.rssi) <= RSSI_THRESHOLD;
      const recent = existing.lastSeen && (now - existing.lastSeen) < TIME_WINDOW;
      if (sameNameValid && rssiClose && recent) {
        console.log(`[BLEInterface] BLE Privacy dedup: ${existingId} -> ${id} (${device.name})`);
        this.foundDevices.delete(existingId);
        device.lastSeen = now;
        device.addedAt = existing.addedAt;
        this.foundDevices.set(id, device);
        this._updateContactAddress(existingId, id);
        this.renderDevicesList();
        return;
      }
    }
    device.lastSeen = now;
    this.foundDevices.set(id, device);
    this.newDevicesCount++;
    this.updateBadge();
    this.renderDevicesList();
  }

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
    this.showToast('✅ Conectado: ' + (device.name || 'Dispositivo') + (device.direction ? ` [${device.direction}]` : ''), 'success');
  }

  onDeviceDisconnected(device) {
    this.connectedDevices.delete(device.id || device.address);
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

  async addContact(deviceId) {
    const device = this.foundDevices.get(deviceId) || this.connectedDevices.get(deviceId);
    if (!device) {
      this.showToast('❌ Dispositivo no encontrado', 'error');
      return;
    }
    const success = _addBLEContact(device);
    if (success) {
      this.showToast('✅ Agregado a contactos', 'success');
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

  async openChat(deviceId) {
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
    
    this._activeChatDeviceId = deviceId;
    console.log('[BLEInterface] Solicitando abrir chat con:', device);
    
    // v2.7.0: Verificar estado antes de conectar
    const state = this._getDeviceState(deviceId);
    const isConnected = this.connectedDevices.has(deviceId) && 
                        (state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.READY_TO_CHAT);
    
    if (!isConnected && this.nativePlugin) {
      try {
        console.log('[BLEInterface] Auto-conectando a', deviceId, 'antes de abrir chat...');
        const connResult = await this.nativePlugin.connectToDevice({ deviceId });
        console.log('[BLEInterface] connectToDevice result:', connResult);
        
        // v2.7.0: Guardar rol y manejar server vs client
        if (connResult && connResult.role) {
          this._deviceRoles.set(deviceId, connResult.role);
        }
        
        if (connResult && connResult.role === 'server') {
          // Somos servidor: no iniciamos GATT client. Esperamos que el peer se conecte a nosotros.
          this._setDeviceState(deviceId, BLE_STATES.CONNECTING, { 
            role: 'server', 
            message: 'Esperando que el peer se conecte...' 
          });
          this.showToast('🖥️ Modo Servidor: Esperando conexión entrante...', 'info');
          // No esperar onNotificationsEnabled aquí; el chat se abre en modo "esperando peer"
        } else {
          // Somos cliente: esperar canal listo normalmente
          this._setDeviceState(deviceId, BLE_STATES.CONNECTING, { role: 'client' });
          this.showToast('🔗 Conectando como Cliente...', 'info');
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout esperando canal BLE')), 8000);
            const checkReady = () => {
              const s = this._getDeviceState(deviceId);
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
        console.warn('[BLEInterface] Auto-conexión/timeout:', e.message);
        this.showToast('⚠️ Conexión iniciada pero canal aún no listo. Intente enviar en unos segundos.', 'warning');
      }
    }
    
    const appContainer = document.getElementById('app');
    if (appContainer) appContainer.classList.remove('hidden');
    
    const nameInput = document.getElementById('chat-contact-name');
    const subtitle = document.getElementById('chat-contact-subtitle');
    if (nameInput) nameInput.value = device.name || 'NEXO Device';
    if (subtitle) subtitle.textContent = 'BLUETOOTH';
    
    const event = new CustomEvent('nexo:ble:openChat', {
      detail: {
        contactId: device.id || device.address,
        name: device.name || 'NEXO Device',
        address: device.address || device.id,
        transport: 'ble',
        rssi: device.rssi,
        source: 'ble_interface',
        // v2.7.0: Incluir rol si está disponible
        role: this._deviceRoles.get(deviceId) || null
      }
    });
    window.dispatchEvent(event);
    this.togglePanel();
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
        <div class="ble-device-actions">
          ${actionHtml}
        </div>
      `;
      list.appendChild(item);
    });
  }

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
      const state = this._getDeviceState(id);
      const stateLabel = this._renderStateLabel(state);
      const isReady = state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.READY_TO_CHAT;
      
      const item = document.createElement('div');
      item.className = 'ble-device-item';
      item.innerHTML = `
        <div class="ble-device-info">
          <span class="ble-device-name">${device.name || 'Desconocido'}</span>
          <span class="ble-device-id">${this._formatId(id)}</span>
          <span class="ble-device-rssi" style="color: #00ff00;">● ${device.direction || 'Conectado'} ${stateLabel}</span>
        </div>
        <div class="ble-device-actions">
          <button class="ble-btn-write" onclick="bleInterface.openChat('${id}')" ${!isReady ? 'disabled title="Esperando canal listo..."' : ''}>✉️ Escribir</button>
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
      case BLE_STATES.READY_TO_CHAT: return `<span class="ble-state-ready">✅ Listo (${state.direction || 'chat'})</span>`;
      case BLE_STATES.ERROR: return `<span class="ble-state-error">❌ ${state.lastError || 'Error'}</span>`;
      default: return '';
    }
  }

  async connect(deviceId) {
    if (this.isDummyMode) return;
    try {
      const device = this.foundDevices.get(deviceId) || this.connectedDevices.get(deviceId);
      if (!device) {
        const contacts = _getBLEContacts();
        const contact = contacts.find(c => (c.id || c.address) === deviceId);
        if (!contact) {
          this.showToast('❌ Dispositivo no disponible', 'error');
          return;
        }
      }
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

  async disconnect(deviceId) {
    if (this.isDummyMode) return;
    try {
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
    const toast = document.querySelector('.ble-toast');
    if (toast) toast.remove();
    if (this._nativeAdStartedListener) this._nativeAdStartedListener.remove();
    if (this._nativeAdFailedListener) this._nativeAdFailedListener.remove();
    if (this._nativeDeviceFoundListener) this._nativeDeviceFoundListener.remove();
    if (this._nativeScanFailedListener) this._nativeScanFailedListener.remove();
    if (this._nativeDeviceConnectedListener) this._nativeDeviceConnectedListener.remove();
    if (this._nativeDeviceDisconnectedListener) this._nativeDeviceDisconnectedListener.remove();
    if (this._nativePayloadListener) this._nativePayloadListener.remove();
    // v2.7.0: Eliminado listener duplicado
    // if (this._nativeNotificationListener) this._nativeNotificationListener.remove();
    if (this._nativeServicesReadyListener) this._nativeServicesReadyListener.remove();
    if (this._nativeNotificationsListener) this._nativeNotificationsListener.remove();
    if (this._nativeConnectionFailedListener) this._nativeConnectionFailedListener.remove();
    if (this._nativeStackBrokenListener) this._nativeStackBrokenListener.remove();
    if (this.isScanning) this.toggleScan();
  }
}

window.bleInterface = null;
// Cache bust Wed Apr 22 14:30:00 UTC 2026
