/**
 * NEXO App v3.2.1-NAP
 * Orquestador Principal - NAP 2.0 Certified
 * Auditoría: Corrección API NordicMesh, Resource Management, Interface Contracts
 */

import { GestureEngine as CoreGestureEngine } from '../core/gesture_engine.js';
import { CryptoVault } from '../vault/crypto_vault.js';
import { HybridMesh } from '../mesh/hybrid_mesh.js';
import { NordicMesh } from '../mesh/nordic_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { TheStream } from '../stream/the_stream.js';
import { rem } from '../ui/rem.js';
import { initBLEInterface } from '../ui/ble_interface.js';

/**
 * Helper NAP 2.0: Timeout con cleanup garantizado
 */
function withTimeoutNAP(promise, ms, context) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[NAP_TIMEOUT] ${context} exceeded ${ms}ms`));
    }, ms);
  });
  
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * DEBUG System NAP 2.0 - Interface Contract: DEBUG_Iface_v2
 */
const DEBUG = {
  rem: rem,
  _logBuffer: [],
  log: (msg, type = 'info', code = null) => {
    const entry = {
      ts: Date.now(),
      time: new Date().toLocaleTimeString(),
      type,
      code,
      msg
    };
    DEBUG._logBuffer.push(entry);
    if (DEBUG._logBuffer.length > 1000) DEBUG._logBuffer.shift();
    
    console.log(`[${entry.time}] [${type.toUpperCase()}]${code ? `[${code}]` : ''} ${msg}`);
    
    const method = type === 'error' ? 'error' 
                 : type === 'success' ? 'success' 
                 : type === 'warn' ? 'warn' 
                 : 'info';
                 
    if (code) {
      rem[method](msg, code);
    } else {
      rem[method](msg);
    }
    
    if (window.NEXO_DIAG?.log) window.NEXO_DIAG.log(msg, type);
  },
  error: (code, msg) => DEBUG.log(msg, 'error', code),
  success: (msg, code = null) => DEBUG.log(msg, 'success', code),
  warn: (msg, code = null) => DEBUG.log(msg, 'warn', code),
  setPhase: (p) => rem.updatePhase(p),
  setMode: (m) => rem.updateMode(m),
  setIdentity: (id) => id && rem.updateIdentity(id)
};

export class NexoApp {
  /**
   * Interface Contract: Config must satisfy SOC2 requirements
   */
  constructor(config = {}) {
    // NAP 2.0: Validación de config
    if (config && typeof config !== 'object') {
      throw new Error('[APP_017] Config must be object');
    }
    
    this.config = {
      relayUrls: Array.isArray(config.relayUrls) ? config.relayUrls : [],
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      onMessage: typeof config.onMessage === 'function' ? config.onMessage : () => {},
      onStatusChange: typeof config.onStatusChange === 'function' ? config.onStatusChange : () => {},
      onError: typeof config.onError === 'function' ? config.onError : (e) => console.error(e),
      ...config
    };

    // NAP 2.0: Resource tracking
    this._resources = {
      timers: new Set(),
      listeners: new Set(),
      handlers: new Set()
    };
    
    this._isInitializing = false;
    this._isDestroyed = false;

    this.vault = null;
    this.mesh = null;
    this.nordicMesh = null;
    this.blePeers = new Map(); // Nordic peers registry
    this.wsClient = null;
    this.bridge = null;
    this.gestures = null;
    this.stream = null;
    this.vaultSlider = null;
    this.bleInterface = null;
    this.initialized = false;

    DEBUG.log('🚀 [NEXO] v3.2.1-NAP iniciando...', 'info', 'APP_INIT');
  }

  /**
   * Fase de inicialización NAP 2.0 - Secuencia atómica con rollback
   */
  async init() {
    if (this.initialized) {
      DEBUG.warn('Init called but already initialized', 'APP_SKIP');
      return this;
    }
    
    if (this._isInitializing) {
      throw new Error('[APP_018] Initialization already in progress');
    }
    
    if (this._isDestroyed) {
      throw new Error('[APP_019] Cannot init destroyed instance');
    }

    this._isInitializing = true;
    DEBUG.setPhase('INIT');

    try {
      // FASE 1: CRYPTO - Fundamento de seguridad
      await this._initPhase1_Crypto();
      
      // FASE 2: WEBSOCKET - Conectividad relay
      await this._initPhase2_WebSocket();
      
      // FASE 3: NORDIC MESH - BLE Protocol v1.0 (NAP Certified)
      if (this.config.enableMesh) {
        await this._initPhase3_NordicMesh();
      }
      
      // FASE 4: HYBRID MESH - Fallback legacy
      if (this.config.enableMesh) {
        await this._initPhase4_HybridMesh();
      }
      
      // FASE 5: BLE INTERFACE - UI siempre disponible (modo dummy si es necesario)
      await this._initPhase5_BLEUI();
      
      // FASE 6: BRIDGE - Unificación de transportes
      await this._initPhase6_Bridge();
      
      // FASE 7: UI/UX - Gestures, Vault Slider, Stream
      await this._initPhase7_UI();
      
      this.initialized = true;
      DEBUG.setPhase('READY');
      DEBUG.success('🎉 NEXO v3.2.1-NAP Ready', 'APP_READY');
      
      this._logFinalStatus();
      
    } catch (err) {
      DEBUG.error('APP_020', `Init failed: ${err.message}`);
      await this._partialCleanup();
      throw err;
    } finally {
      this._isInitializing = false;
    }

    return this;
  }

  /**
   * FASE 1: CRYPTO (NAP 2.0: CRYPTO_001-003)
   */
  async _initPhase1_Crypto() {
    DEBUG.setPhase('CRYPTO');
    DEBUG.log('🔐 [1/7] Initializing Crypto Vault...', 'info', 'CRYPTO_001');
    
    try {
      this.vault = new CryptoVault();
      
      // Interface Contract: CryptoVault.initialize() con timeout 5s
      await withTimeoutNAP(
        this.vault.initialize(), 
        5000, 
        'CryptoVault.initialize'
      );
      
      const identity = this.vault.getIdentity?.();
      if (identity) {
        DEBUG.setIdentity(identity);
        DEBUG.success('Vault initialized', 'CRYPTO_002');
      } else {
        DEBUG.warn('Vault initialized but no identity returned', 'CRYPTO_003');
      }
    } catch (err) {
      DEBUG.error('CRYPTO_004', `Vault init failed: ${err.message}`);
      // NAP 2.0: Graceful degradation, app puede funcionar en modo offline sin vault
      this.vault = null;
    }
  }

  /**
   * FASE 2: WEBSOCKET (NAP 2.0: WS_001-004)
   */
  async _initPhase2_WebSocket() {
    DEBUG.setPhase('WEBSOCKET');
    
    if (this.config.relayUrls.length === 0) {
      DEBUG.warn('No relay URLs configured, skipping WebSocket', 'WS_SKIP');
      return;
    }
    
    DEBUG.log('🌐 [2/7] Initializing WebSocket...', 'info', 'WS_001');
    
    try {
      this.wsClient = new WebSocketClient(this.config.relayUrls[0]);
      
      // Interface Contract: Callbacks antes de connect
      this.wsClient.onMessage = (m) => this._handleMessage(m, 'relay');
      this.wsClient.onOpen = () => {
        DEBUG.setMode('RELAY');
        DEBUG.success('WebSocket connected', 'WS_002');
      };
      this.wsClient.onError = (e) => {
        DEBUG.error('WS_003', `WebSocket error: ${e.message}`);
      };
      
      await withTimeoutNAP(
        this.wsClient.connect(),
        8000, // Timeout generoso para TLS handshake
        'WebSocket.connect'
      );
      
    } catch (err) {
      DEBUG.warn(`WebSocket unavailable: ${err.message}`, 'WS_004');
      // NAP 2.0: Continuar en modo offline, no es crítico
      this.wsClient = null;
    }
  }

  /**
   * FASE 3: NORDIC MESH BLE (NAP 2.0: NORDIC_001-010)
   * Corrección crítica: API de eventos individuales, no callback genérico
   */
  async _initPhase3_NordicMesh() {
    DEBUG.setPhase('NORDIC_MESH');
    DEBUG.log('📡 [3/7] Initializing Nordic Mesh BLE...', 'info', 'NORDIC_001');
    
    try {
      if (!this.vault) {
        throw new Error('Vault required for Nordic Mesh key derivation');
      }
      
      this.nordicMesh = new NordicMesh(this.vault, {
        rssiThreshold: -85,
        chunkSize: 507,
        handshakeTimeout: 30000,
        messageTimeout: 300000
      });
      
      // NAP 2.0: Registro de eventos individuales (Interface Contract)
      const unsub1 = this.nordicMesh.on('peerDiscovered', (peer) => {
        this._handleNordicPeer(peer);
      });
      
      const unsub2 = this.nordicMesh.on('sessionEstablished', (data) => {
        this._handleNordicSession(data);
      });
      
      const unsub3 = this.nordicMesh.on('messageReceived', (msg) => {
        this._handleNordicMessage(msg);
      });
      
      const unsub4 = this.nordicMesh.on('stateChanged', ({ from, to }) => {
        DEBUG.log(`Nordic state: ${from} → ${to}`, 'info', 'NORDIC_STATE');
        this._updateModeFromNordic(to);
      });
      
      const unsub5 = this.nordicMesh.on('error', (err) => {
        DEBUG.error('NORDIC_010', err.message || 'Nordic Mesh error');
      });
      
      // NAP 2.0: Tracking de handlers para cleanup
      this._resources.handlers.add(unsub1);
      this._resources.handlers.add(unsub2);
      this._resources.handlers.add(unsub3);
      this._resources.handlers.add(unsub4);
      this._resources.handlers.add(unsub5);
      
      // Interface Contract: initialize() retorna Promise<boolean>
      const success = await withTimeoutNAP(
        this.nordicMesh.initialize(),
        10000,
        'NordicMesh.initialize'
      );
      
      if (success) {
        DEBUG.success('Nordic Mesh active', 'NORDIC_002');
        
        // Auto-start discovery si no hay relay
        if (!this.wsClient?.isConnected?.()) {
          await this.nordicMesh.startDiscovery().catch(e => {
            DEBUG.warn(`Discovery start delayed: ${e.message}`, 'NORDIC_003');
          });
        }
      } else {
        DEBUG.warn('Nordic Mesh initialized but inactive', 'NORDIC_004');
        this.nordicMesh = null;
      }
      
    } catch (err) {
      DEBUG.error('NORDIC_005', `Nordic init failed: ${err.message}`);
      this.nordicMesh = null;
      // NAP 2.0: No bloquear app, continuar con HybridMesh
    }
  }

  /**
   * FASE 4: HYBRID MESH (Fallback) (NAP 2.0: MESH_001-006)
   */
  async _initPhase4_HybridMesh() {
    DEBUG.setPhase('MESH');
    DEBUG.log('📡 [4/7] Initializing Hybrid Mesh (Fallback)...', 'info', 'MESH_001');
    
    try {
      this.mesh = new HybridMesh({
        serviceId: 'com.nexo.mesh.v1',
        deviceName: 'NEXO',
        maxPeers: 8,
        // NAP 2.0: Callbacks legacy compatibles
        onDeviceFound: (device) => {
          DEBUG.log(`Hybrid found: ${device.name}`, 'info', 'MESH_DEVICE');
          if (this.bleInterface?.handleDeviceFound) {
            this.bleInterface.handleDeviceFound(device);
          }
          this._updateStatus();
        },
        onDeviceConnected: (device) => {
          DEBUG.success(`Hybrid connected: ${device.name}`, 'MESH_CONN');
          if (this.bleInterface?.handleDeviceConnected) {
            this.bleInterface.handleDeviceConnected(device);
          }
          this._updateStatus();
        },
        onDeviceDisconnected: (device) => {
          DEBUG.log(`Hybrid disconnected: ${device.id?.substr(0,8)}`, 'warn', 'MESH_DISC');
          if (this.bleInterface?.handleDeviceDisconnected) {
            this.bleInterface.handleDeviceDisconnected(device);
          }
          this._updateStatus();
        },
        onError: (code, msg) => {
          if (code === 'PERMISOS' || msg?.includes('GPS')) {
            DEBUG.error('BLE_PERM', msg);
          } else {
            DEBUG.error('MESH_006', msg);
          }
        }
      });

      // NAP 2.0: Event system moderno + legacy callbacks
      const unsub1 = this.mesh.on('device', (d) => {
        // Redundante con callback legacy pero necesario para consistencia
        this._updateStatus();
      });
      
      this._resources.handlers.add(unsub1);
      
      await withTimeoutNAP(
        this.mesh.initialize(),
        15000,
        'HybridMesh.initialize'
      );
      
      const status = this.mesh.getStatus();
      DEBUG.success(`Hybrid Mesh ready [${status.mode.toUpperCase()}]`, 'MESH_002');
      
      if (status.mode === 'offline') {
        DEBUG.warn('BLE in offline mode - check permissions', 'MESH_003');
      }
      
    } catch (err) {
      DEBUG.error('APP_016', `Hybrid Mesh: ${err.message}`);
      this.mesh = null;
    }
  }

  /**
   * FASE 5: BLE UI (NAP 2.0: UI_001) - Siempre visible
   */
  async _initPhase5_BLEUI() {
    DEBUG.setPhase('BLE_UI');
    DEBUG.log('📱 [5/7] Initializing BLE Interface...', 'info', 'UI_001');
    
    try {
      // NAP 2.0: UI siempre se crea, incluso sin mesh (modo dummy)
      const meshInstance = this.nordicMesh || this.mesh || null;
      
      this.bleInterface = initBLEInterface(meshInstance);
      
      if (this.bleInterface) {
        DEBUG.success('BLE UI ready' + (meshInstance ? '' : ' (dummy mode)'), 'UI_002');
      } else {
        DEBUG.warn('BLE UI returned null', 'UI_003');
      }
    } catch (err) {
      DEBUG.error('UI_004', `BLE UI init failed: ${err.message}`);
      // NAP 2.0: No crítico, app funciona sin panel BLE
      this.bleInterface = null;
    }
  }

  /**
   * FASE 6: BRIDGE (NAP 2.0: BRIDGE_001)
   */
  async _initPhase6_Bridge() {
    DEBUG.setPhase('BRIDGE');
    DEBUG.log('🌉 [6/7] Initializing MeshRelayBridge...', 'info', 'BRIDGE_001');
    
    try {
      // NAP 2.0: Verificar que al menos un transporte existe
      if (!this.mesh && !this.nordicMesh && !this.wsClient) {
        DEBUG.warn('No transports available, skipping bridge', 'BRIDGE_SKIP');
        return;
      }
      
      this.bridge = new MeshRelayBridge({
        mesh: this.mesh,
        nordicMesh: this.nordicMesh,
        relay: this.wsClient,
        onModeChange: (mode) => {
          DEBUG.setMode(mode);
          this.config.onStatusChange(mode);
        }
      });
      
      await withTimeoutNAP(
        this.bridge.initialize(),
        5000,
        'MeshRelayBridge.initialize'
      );
      
      DEBUG.success('Bridge ready', 'BRIDGE_002');
      
    } catch (err) {
      DEBUG.warn(`Bridge init failed: ${err.message}`, 'BRIDGE_003');
      this.bridge = null;
    }
  }

  /**
   * FASE 7: UI Components (NAP 2.0: UX_001)
   */
  async _initPhase7_UI() {
    DEBUG.setPhase('GESTURES');
    DEBUG.log('🎮 [7/7] Initializing UI Components...', 'info', 'UX_001');
    
    // Gesture Engine (UI)
    if (this.config.enableGestures) {
      try {
        this.gestures = new GestureEngine({});
        this.gestures.init();
      } catch (e) {
        DEBUG.warn(`GestureEngine: ${e.message}`, 'UX_002');
      }
    }

    // Vault Slider (Core GestureEngine)
    DEBUG.setPhase('VAULT_SLIDER');
    const streamEl = document.getElementById('nexo-stream');
    const vaultEl = document.getElementById('nexo-vault');
    if (streamEl && vaultEl) {
      try {
        this.vaultSlider = new CoreGestureEngine(streamEl, vaultEl);
      } catch (e) {
        DEBUG.error('UX_003', `Vault Slider: ${e.message}`);
      }
    }

    // Message Stream
    DEBUG.setPhase('STREAM');
    const container = document.getElementById('messages-container');
    if (container) {
      try {
        this.stream = new TheStream(container, {});
      } catch (e) {
        DEBUG.error('UX_004', `TheStream: ${e.message}`);
      }
    }
  }

  /**
   * Handlers NAP 2.0 para Nordic Mesh
   */
  _handleNordicPeer(peer) {
    if (!peer || !peer.id) {
      DEBUG.error('NORDIC_006', 'Invalid peer data received');
      return;
    }
    
    DEBUG.log(`🔷 Nordic Peer: ${peer.name} (${peer.rssi}dBm)`, 'info', 'NORDIC_PEER');
    this.blePeers.set(peer.id, {
      ...peer,
      discoveredAt: Date.now()
    });
    
    if (this.bleInterface?.addPeer) {
      this.bleInterface.addPeer(peer);
    }
  }

  _handleNordicSession(data) {
    if (!data || !data.deviceId) {
      DEBUG.error('NORDIC_007', 'Invalid session data');
      return;
    }
    
    DEBUG.success(`🔐 Nordic Session: ${data.deviceId.substr(0,8)}`, 'NORDIC_SESS');
    this._updateMode('P2P_BLE');
    
    if (this.bleInterface?.onSessionEstablished) {
      this.bleInterface.onSessionEstablished(data);
    }
  }

  _handleNordicMessage(msg) {
    if (!msg || !msg.deviceId) {
      DEBUG.error('NORDIC_008', 'Invalid message structure');
      return;
    }
    
    DEBUG.log(`📨 Nordic msg from ${msg.deviceId.substr(0,8)}`, 'info', 'NORDIC_MSG');
    
    this._handleMessage({
      content: msg.content,
      sender: msg.deviceId,
      source: 'ble_nordic',
      timestamp: msg.timestamp || Date.now(),
      _protocol: 'nordic_v1'
    }, 'ble_nordic');
  }

  _updateModeFromNordic(state) {
    switch(state) {
      case 'messaging':
      case 'connected':
        this._updateMode('P2P_BLE');
        break;
      case 'offline':
        if (!this.mesh?.getPeerCount?.() && !this.wsClient?.isConnected?.()) {
          this._updateMode('OFFLINE');
        }
        break;
      case 'error':
        // Mantener modo actual pero loggear
        break;
    }
  }

  _updateMode(mode) {
    DEBUG.setMode(mode);
    this.config.onStatusChange(mode);
    
    if (this.bleInterface?.updateStatus) {
      try {
        this.bleInterface.updateStatus();
      } catch (e) {
        DEBUG.warn(`UI update failed: ${e.message}`, 'UI_WARN');
      }
    }
  }

  /**
   * Message Router NAP 2.0 (Prioridad: Nordic > Hybrid > Bridge > WS)
   */
  async sendMessage(msg) {
    if (!this.initialized) {
      DEBUG.error('APP_021', 'Cannot send: App not initialized');
      return false;
    }
    
    if (this._isDestroyed) {
      DEBUG.error('APP_022', 'Cannot send: App destroyed');
      return false;
    }

    try {
      // Optimistic UI update
      this._handleMessage({ 
        ...msg, 
        _own: true,
        timestamp: Date.now(),
        pending: true 
      }, 'self');

      const content = msg.content || msg;
      
      // Prioridad 1: NordicMesh (más eficiente, cifrado moderno)
      if (this.nordicMesh?.getPeers?.().length > 0) {
        const peers = this.nordicMesh.getPeers();
        const targetPeer = peers[0]; // O lógica de selección por ID
        
        try {
          await this.nordicMesh.sendMessage(targetPeer.id, content);
          DEBUG.success(`Sent via Nordic to ${targetPeer.id.substr(0,8)}`, 'MSG_NORDIC');
          return true;
        } catch (e) {
          DEBUG.error('NORDIC_009', `Send failed: ${e.message}`);
          // Fallthrough a siguiente prioridad
        }
      }
      
      // Prioridad 2: HybridMesh (legacy BLE/WiFi)
      if (this.mesh?.getPeerCount?.() > 0) {
        try {
          await this.mesh.broadcast({ content });
          DEBUG.success('Sent via Hybrid broadcast', 'MSG_HYBRID');
          return true;
        } catch (e) {
          DEBUG.error('MESH_005', `Broadcast failed: ${e.message}`);
        }
      }
      
      // Prioridad 3: Bridge (unificado)
      if (this.bridge) {
        const result = await this.bridge.send({ content });
        if (result) {
          DEBUG.success('Sent via Bridge', 'MSG_BRIDGE');
          return true;
        }
      }
      
      // Prioridad 4: WebSocket directo
      if (this.wsClient?.isConnected?.()) {
        this.wsClient.send({ content });
        DEBUG.success('Sent via WebSocket', 'MSG_WS');
        return true;
      }
      
      DEBUG.warn('No transport available for message', 'MSG_FAIL');
      return false;
      
    } catch (err) {
      DEBUG.error('APP_008', `SendMessage critical: ${err.message}`);
      return false;
    }
  }

  _handleMessage(msg, source) {
    if (this._isDestroyed) return;
    
    try {
      const enriched = { 
        ...msg, 
        _source: source, 
        _ts: Date.now(),
        _id: Math.random().toString(36).substr(2, 9)
      };
      
      this.config.onMessage(enriched);
      
      if (this.stream?.appendItems) {
        this.stream.appendItems([enriched]);
      }
    } catch (err) {
      DEBUG.error('APP_005', `Message handler: ${err.message}`);
    }
  }

  _logFinalStatus() {
    const hybridStatus = this.mesh?.getStatus?.();
    const nordicPeers = this.nordicMesh?.getPeers?.() || [];
    
    DEBUG.log(
      `Status: Mode=${hybridStatus?.mode || 'N/A'} ` +
      `HybridPeers=${hybridStatus?.peerCount || 0} ` +
      `NordicPeers=${nordicPeers.length} ` +
      `WS=${this.wsClient?.isConnected ? 'ON' : 'OFF'} ` +
      `Vault=${this.vault ? 'OK' : 'NO'}`,
      'info',
      'STATUS'
    );
  }

  /**
   * NAP 2.0 SOC2: Cleanup parcial en caso de fallo init
   */
  async _partialCleanup() {
    DEBUG.log('Executing partial cleanup after init failure...', 'warn', 'CLEANUP');
    
    if (this.nordicMesh) {
      try { await this.nordicMesh.destroy?.(); } catch(e) {}
      this.nordicMesh = null;
    }
    if (this.mesh) {
      try { this.mesh.destroy(); } catch(e) {}
      this.mesh = null;
    }
    if (this.wsClient) {
      try { this.wsClient.disconnect?.(); } catch(e) {}
      this.wsClient = null;
    }
  }

  /**
   * NAP 2.0 SOC2: Destrucción completa de recursos
   */
  async destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    
    DEBUG.log('🧹 NAP 2.0 Cleanup initiated...', 'info', 'DESTROY');

    // 1. UI components (no dependen de red)
    if (this.bleInterface) {
      try { this.bleInterface.destroy(); } catch(e) {}
      this.bleInterface = null;
    }
    
    if (this.vaultSlider) {
      try { this.vaultSlider.destroy?.(); } catch(e) {}
      this.vaultSlider = null;
    }
    
    if (this.gestures) {
      try { this.gestures.destroy?.(); } catch(e) {}
      this.gestures = null;
    }
    
    if (this.stream) {
      try { this.stream.destroy?.(); } catch(e) {}
      this.stream = null;
    }

    // 2. Bridge (depende de mesh/relay)
    if (this.bridge) {
      try { this.bridge.destroy?.(); } catch(e) {}
      this.bridge = null;
    }

    // 3. Nordic Mesh (con handlers unregister)
    if (this.nordicMesh) {
      try {
        // NAP 2.0: Unsubscribe all listeners
        this._resources.handlers.forEach(unsub => {
          try { unsub(); } catch(e) {}
        });
        await this.nordicMesh.destroy?.();
      } catch(e) {}
      this.nordicMesh = null;
    }

    // 4. Hybrid Mesh
    if (this.mesh) {
      try { this.mesh.destroy(); } catch(e) {}
      this.mesh = null;
    }

    // 5. WebSocket
    if (this.wsClient) {
      try { this.wsClient.disconnect?.(); } catch(e) {}
      this.wsClient = null;
    }

    // 6. Vault (seguridad)
    if (this.vault) {
      try { this.vault.destroy?.(); } catch(e) {}
      this.vault = null;
    }

    // 7. Native timers cleanup
    this._resources.timers.forEach(timer => clearTimeout(timer));
    this._resources.timers.clear();
    this._resources.handlers.clear();

    DEBUG.success('Cleanup complete', 'DESTROY_OK');
  }

  /**
   * NAP 2.0: Status Interface Contract
   */
  getStatus() {
    return {
      initialized: this.initialized,
      destroyed: this._isDestroyed,
      initializing: this._isInitializing,
      mode: this.mesh?.getStatus?.().mode || 
            (this.nordicMesh?.getState?.() === 'messaging' ? 'p2p_ble' : 'offline'),
      peers: this.mesh?.getPeerCount?.() || 0,
      nordicPeers: this.nordicMesh?.getPeers?.().length || 0,
      hasBLEInterface: !!this.bleInterface,
      hasNordic: !!this.nordicMesh,
      hasHybrid: !!this.mesh,
      hasWebSocket: !!this.wsClient?.isConnected?.(),
      hasVault: !!this.vault
    };
  }
}

export default NexoApp;
export { DEBUG };
