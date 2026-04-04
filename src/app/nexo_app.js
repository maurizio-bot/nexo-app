/**
 * NEXO App v3.3.0-NAP
 * Orquestador Principal - NAP 2.0 Certified
 * FIX: Build #457 - NordicMesh modo pasivo/autenticado
 */

import { GestureEngine as CoreGestureEngine } from '../core/gesture_engine.js';
import { CryptoVault } from '../vault/crypto_vault.js';
import { BLEInterface as HybridMesh } from '../mesh/hybrid_mesh.js';
import { NordicMesh } from '../mesh/nordic_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { TheStream } from '../stream/the_stream.js';
import { rem } from '../ui/rem.js';
import { initBLEInterface } from '../ui/ble_interface.js';

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

const DEBUG = {
  rem: rem,
  _logBuffer: [],
  log: (msg, type = 'info', code = null) => {
    const entry = { ts: Date.now(), time: new Date().toLocaleTimeString(), type, code, msg };
    DEBUG._logBuffer.push(entry);
    if (DEBUG._logBuffer.length > 1000) DEBUG._logBuffer.shift();
    
    console.log(`[${entry.time}] [${type.toUpperCase()}]${code ? `[${code}]` : ''} ${msg}`);
    
    const method = type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warn' ? 'warn' : 'info';
    if (code) rem[method](msg, code);
    else rem[method](msg);
  },
  error: (code, msg) => DEBUG.log(msg, 'error', code),
  success: (msg, code = null) => DEBUG.log(msg, 'success', code),
  warn: (msg, code = null) => DEBUG.log(msg, 'warn', code),
  setPhase: (p) => rem.updatePhase(p),
  setMode: (m) => rem.updateMode(m),
  setIdentity: (id) => id && rem.updateIdentity(id)
};

export class NexoApp {
  constructor(config = {}) {
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

    this._resources = { timers: new Set(), listeners: new Set(), handlers: new Set() };
    this._isInitializing = false;
    this._isDestroyed = false;

    this.vault = null;
    this.mesh = null;
    this.nordicMesh = null;
    this.blePeers = new Map();
    this.wsClient = null;
    this.bridge = null;
    this.gestures = null;
    this.stream = null;
    this.vaultSlider = null;
    this.bleInterface = null;
    this.initialized = false;

    DEBUG.log('🚀 [NEXO] v3.3.0-NAP iniciando...', 'info', 'APP_INIT');
  }

  async init() {
    if (this.initialized) {
      DEBUG.warn('Init called but already initialized', 'APP_SKIP');
      return this;
    }
    
    if (this._isInitializing) throw new Error('[APP_018] Initialization already in progress');
    if (this._isDestroyed) throw new Error('[APP_019] Cannot init destroyed instance');

    this._isInitializing = true;
    DEBUG.setPhase('INIT');

    try {
      // Paso 1: Crypto (Vault setup + unlock)
      await this._initPhase1_Crypto();
      
      // Paso 2: WebSocket
      await this._initPhase2_WebSocket();
      
      // FIX #457: Siempre inicializar Nordic (modo pasivo si vault locked, activo si unlocked)
      if (this.config.enableMesh && this.vault) {
        await this._initPhase3_NordicMesh();
        
        // FIX #457: Si vault quedó desbloqueado, activar NordicMesh real
        if (this.nordicMesh && !this.vault.isLocked()) {
          try {
            DEBUG.log('Activating NordicMesh with Vault identity...', 'info', 'NORDIC_AUTH');
            await this.nordicMesh.activateWithVault();
            DEBUG.success('NordicMesh authenticated', 'NORDIC_AUTH_OK');
            
            // Iniciar discovery ahora que está autenticado
            if (!this.wsClient?.isConnected?.()) {
              await this.nordicMesh.startDiscovery().catch(e => {
                DEBUG.warn(`Discovery start failed: ${e.message}`, 'NORDIC_DISC_WARN');
              });
            }
          } catch (e) {
            DEBUG.error('NORDIC_AUTH_FAIL', `Failed to activate: ${e.message}`);
          }
        }
        
        // HybridMesh solo si vault desbloqueado
        if (!this.vault.isLocked()) {
          await this._initPhase4_HybridMesh();
        }
      }
      
      await this._initPhase5_BLEUI();
      await this._initPhase6_Bridge();
      await this._initPhase7_UI();
      
      this.initialized = true;
      DEBUG.setPhase('READY');
      DEBUG.success('🎉 NEXO v3.3.0-NAP Ready', 'APP_READY');
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
   * Paso 1: Crypto Vault
   */
  async _initPhase1_Crypto() {
    DEBUG.setPhase('CRYPTO');
    DEBUG.log('🔐 [1/7] Initializing Crypto Vault...', 'info', 'CRYPTO_001');
    
    try {
      this.vault = new CryptoVault();
      await withTimeoutNAP(this.vault.init(), 5000, 'CryptoVault.init');
      
      if (typeof this.vault.isLocked === 'function' && this.vault.isLocked()) {
        DEBUG.log('Vault locked - waiting for user setup', 'info', 'CRYPTO_005');
        
        const password = await this._waitForVaultSetup();
        
        DEBUG.log('Unlocking vault with user password...', 'info', 'CRYPTO_006');
        await this.vault.initialize(password);
        
        if (this.vault.isLocked()) {
          throw new Error('[CRYPTO_007] Vault remained locked after initialize()');
        }
        DEBUG.success('Vault unlocked and provisioned', 'CRYPTO_UNLOCKED');
      }
      
      try {
        const identity = await this.vault.getIdentityKey();
        DEBUG.setIdentity(identity);
        DEBUG.success(`Vault ready [ID: ${identity.substring(0, 8)}...]`, 'CRYPTO_002');
      } catch (e) {
        throw new Error(`[CRYPTO_008] getIdentityKey() failed post-unlock: ${e.message}`);
      }
      
    } catch (err) {
      DEBUG.error('CRYPTO_004', `Vault init failed: ${err.message}`);
      this.vault = null;
      throw err;
    }
  }

  async _initPhase2_WebSocket() {
    DEBUG.setPhase('WEBSOCKET');
    if (this.config.relayUrls.length === 0) {
      DEBUG.warn('No relay URLs configured', 'WS_SKIP');
      return;
    }
    
    try {
      this.wsClient = new WebSocketClient(this.config.relayUrls[0]);
      this.wsClient.onMessage = (m) => this._handleMessage(m, 'relay');
      this.wsClient.onOpen = () => { DEBUG.setMode('RELAY'); };
      
      await withTimeoutNAP(this.wsClient.connect(), 8000, 'WebSocket.connect');
    } catch (err) {
      DEBUG.warn(`WebSocket unavailable: ${err.message}`, 'WS_004');
      this.wsClient = null;
    }
  }

  /**
   * Paso 3: NordicMesh - SIEMPRE inicia (modo pasivo si locked)
   */
  async _initPhase3_NordicMesh() {
    DEBUG.setPhase('NORDIC_MESH');
    DEBUG.log('📡 [3/7] Initializing Nordic Mesh BLE...', 'info', 'NORDIC_001');
    
    try {
      if (!this.vault) throw new Error('[NORDIC_012] Vault required for Nordic Mesh');
      
      // FIX #457: Usar getIdentity() (no requiere unlock) para modo pasivo inicial
      let provisionalId = 'temp';
      try {
        provisionalId = this.vault.getIdentity ? this.vault.getIdentity() : 'temp';
      } catch (e) {
        provisionalId = 'nexo_temp_' + Math.random().toString(36).substring(2, 10);
      }
      
      DEBUG.log(`Creating NordicMesh [Provisional: ${provisionalId.substring(0, 8)}...]`, 'info', 'NORDIC_015');
      
      this.nordicMesh = new NordicMesh(this.vault, {
        rssiThreshold: -85,
        chunkSize: 507,
        handshakeTimeout: 30000
      });
      
      const unsub1 = this.nordicMesh.on('peerDiscovered', (p) => this._handleNordicPeer(p));
      const unsub2 = this.nordicMesh.on('sessionEstablished', (d) => this._handleNordicSession(d));
      const unsub3 = this.nordicMesh.on('messageReceived', (m) => this._handleNordicMessage(m));
      const unsub4 = this.nordicMesh.on('stateChanged', ({ to }) => this._updateModeFromNordic(to));
      const unsub5 = this.nordicMesh.on('error', (err) => DEBUG.error('NORDIC_010', err.message));
      
      this._resources.handlers.add(unsub1, unsub2, unsub3, unsub4, unsub5);
      
      const result = await withTimeoutNAP(
        this.nordicMesh.init(),
        10000,
        'NordicMesh.init'
      );
      
      if (!result || !result.success) {
        throw new Error(result?.error?.message || 'Nordic init returned false');
      }
      
      const authStatus = result.authenticated ? 'autenticado' : 'pasivo (esperando Vault)';
      DEBUG.success(`Nordic Mesh active [${authStatus}]`, 'NORDIC_002');
      
    } catch (err) {
      DEBUG.error('NORDIC_005', `Nordic init failed: ${err.message}`);
      this.nordicMesh = null;
    }
  }

  async _initPhase4_HybridMesh() {
    DEBUG.setPhase('MESH');
    DEBUG.log('📡 [4/7] Initializing Hybrid Mesh...', 'info', 'MESH_001');
    
    try {
      this.mesh = new HybridMesh({
        onDeviceFound: (d) => {
          DEBUG.log(`Hybrid found: ${d.name}`, 'info', 'MESH_DEVICE');
          this._updateStatus();
        },
        onDeviceConnected: (d) => {
          DEBUG.success(`Hybrid connected: ${d.name}`, 'MESH_CONN');
          this._updateStatus();
        },
        onDeviceDisconnected: (d) => {
          DEBUG.log(`Hybrid disconnected`, 'warn', 'MESH_DISC');
          this._updateStatus();
        },
        onError: (code, msg) => DEBUG.error('MESH_006', msg)
      });

      if (this.mesh && typeof this.mesh.on === 'function') {
        const unsub = this.mesh.on('device', () => this._updateStatus());
        this._resources.handlers.add(unsub);
      }
      
      await withTimeoutNAP(this.mesh.initialize(), 15000, 'HybridMesh.initialize');
      DEBUG.success('Hybrid Mesh ready', 'MESH_002');
      
    } catch (err) {
      DEBUG.error('APP_016', `Hybrid Mesh: ${err.message}`);
      this.mesh = null;
    }
  }

  async _initPhase5_BLEUI() {
    DEBUG.setPhase('BLE_UI');
    DEBUG.log('📱 [5/7] Initializing BLE Interface...', 'info', 'UI_001');
    
    try {
      const meshInstance = this.nordicMesh || this.mesh || null;
      this.bleInterface = initBLEInterface(meshInstance);
      
      if (this.bleInterface) {
        const status = this.nordicMesh?.isAuthenticated?.() ? '' : ' (modo pasivo)';
        DEBUG.success(`BLE UI ready${status}`, 'UI_002');
      }
    } catch (err) {
      DEBUG.error('UI_004', `BLE UI init failed: ${err.message}`);
      this.bleInterface = null;
    }
  }

  async _initPhase6_Bridge() {
    DEBUG.setPhase('BRIDGE');
    try {
      if (!this.mesh && !this.nordicMesh && !this.wsClient) {
        DEBUG.warn('No transports available', 'BRIDGE_SKIP');
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
      
      await withTimeoutNAP(this.bridge.initialize(), 5000, 'Bridge.initialize');
      DEBUG.success('Bridge ready', 'BRIDGE_002');
      
    } catch (err) {
      DEBUG.warn(`Bridge init failed: ${err.message}`, 'BRIDGE_003');
      this.bridge = null;
    }
  }

  async _initPhase7_UI() {
    DEBUG.setPhase('GESTURES');
    if (this.config.enableGestures) {
      try {
        this.gestures = new GestureEngine({});
        this.gestures.init();
      } catch (e) {}
    }

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

  _waitForVaultSetup() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Vault setup timeout (60s) - Usuario no respondió'));
      }, 60000);
      
      this._showVaultSetupModal();
      
      const handler = (e) => {
        clearTimeout(timeout);
        window.removeEventListener('nexo:vault:password', handler);
        this._hideVaultSetupModal();
        
        const password = e.detail?.password;
        if (!password || password.length < 12) {
          reject(new Error('Contraseña inválida desde UI (mínimo 12 caracteres)'));
          return;
        }
        
        resolve(password);
      };
      
      window.addEventListener('nexo:vault:password', handler, { once: true });
    });
  }

  _showVaultSetupModal() {
    const modal = document.getElementById('vault-setup-modal');
    if (modal) {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
      DEBUG.log('Vault setup modal displayed', 'info', 'UI_VAULT_SETUP');
    } else {
      DEBUG.warn('Vault setup HTML not found, using fallback prompt', 'UI_FALLBACK');
      this._createFallbackPasswordInput();
    }
  }

  _hideVaultSetupModal() {
    const modal = document.getElementById('vault-setup-modal');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  _createFallbackPasswordInput() {
    setTimeout(() => {
      const password = prompt(
        '🔐 Configurar NEXO Vault\n\n' +
        'Crea una contraseña maestra:\n' +
        '- Mínimo 12 caracteres\n' +
        '- Al menos 1 número\n' + 
        '- Al menos 1 símbolo (!@#$%^&*)\n\n' +
        '⚠️  Esta contraseña no se puede recuperar si la olvidas.'
      );
      
      if (password && password.length >= 12) {
        window.dispatchEvent(new CustomEvent('nexo:vault:password', { 
          detail: { password } 
        }));
      } else if (password) {
        alert('❌ La contraseña debe tener al menos 12 caracteres.\nRecarga la app para intentar de nuevo.');
      }
    }, 500);
  }

  _handleNordicPeer(peer) {
    if (!peer?.id) {
      DEBUG.error('NORDIC_006', 'Invalid peer data');
      return;
    }
    DEBUG.log(`🔷 Nordic Peer: ${peer.name} (${peer.rssi}dBm)`, 'info', 'NORDIC_PEER');
    this.blePeers.set(peer.id, { ...peer, discoveredAt: Date.now() });
    if (this.bleInterface?.addPeer) this.bleInterface.addPeer(peer);
  }

  _handleNordicSession(data) {
    if (!data?.deviceId) {
      DEBUG.error('NORDIC_007', 'Invalid session data');
      return;
    }
    DEBUG.success(`🔐 Nordic Session: ${data.deviceId.substr(0,8)}`, 'NORDIC_SESS');
    this._updateMode('P2P_BLE');
  }

  _handleNordicMessage(msg) {
    if (!msg?.deviceId) {
      DEBUG.error('NORDIC_008', 'Invalid message structure');
      return;
    }
    this._handleMessage({
      content: msg.content,
      sender: msg.deviceId,
      source: 'ble_nordic',
      timestamp: msg.timestamp || Date.now()
    }, 'ble_nordic');
  }

  _updateModeFromNordic(state) {
    switch(state) {
      case 'messaging':
      case 'connected': this._updateMode('P2P_BLE'); break;
      case 'offline': 
        if (!this.mesh?.getPeerCount?.() && !this.wsClient?.isConnected?.()) {
          this._updateMode('OFFLINE');
        }
        break;
    }
  }

  _updateMode(mode) {
    DEBUG.setMode(mode);
    this.config.onStatusChange(mode);
    if (this.bleInterface?.updateStatus) {
      try { this.bleInterface.updateStatus(); } catch (e) {}
    }
  }

  _updateStatus() {}

  async sendMessage(msg) {
    if (!this.initialized || this._isDestroyed) {
      DEBUG.error(this._isDestroyed ? 'APP_022' : 'APP_021', 'Cannot send message');
      return false;
    }

    try {
      this._handleMessage({ ...msg, _own: true, timestamp: Date.now(), pending: true }, 'self');

      const content = msg.content || msg;
      
      const nordicPeers = this.nordicMesh?.getPeers?.() || [];
      if (nordicPeers.length > 0) {
        try {
          await this.nordicMesh.sendMessage(nordicPeers[0].id, content);
          DEBUG.success(`Sent via Nordic to ${nordicPeers[0].id.substr(0,8)}`, 'MSG_NORDIC');
          return true;
        } catch (e) {
          DEBUG.error('NORDIC_009', `Send failed: ${e.message}`);
        }
      }
      
      if (this.mesh?.getPeerCount?.() > 0) {
        try {
          await this.mesh.broadcast({ content });
          DEBUG.success('Sent via Hybrid', 'MSG_HYBRID');
          return true;
        } catch (e) {
          DEBUG.error('MESH_005', `Broadcast failed: ${e.message}`);
        }
      }
      
      if (this.bridge) {
        const result = await this.bridge.send({ content });
        if (result) {
          DEBUG.success('Sent via Bridge', 'MSG_BRIDGE');
          return true;
        }
      }
      
      if (this.wsClient?.isConnected?.()) {
        this.wsClient.send({ content });
        DEBUG.success('Sent via WebSocket', 'MSG_WS');
        return true;
      }
      
      DEBUG.warn('No transport available', 'MSG_FAIL');
      return false;
      
    } catch (err) {
      DEBUG.error('APP_008', `SendMessage critical: ${err.message}`);
      return false;
    }
  }

  _handleMessage(msg, source) {
    if (this._isDestroyed) return;
    try {
      const enriched = { ...msg, _source: source, _ts: Date.now(), _id: Math.random().toString(36).substr(2, 9) };
      this.config.onMessage(enriched);
      if (this.stream?.appendItems) this.stream.appendItems([enriched]);
    } catch (err) {
      DEBUG.error('APP_005', `Message handler: ${err.message}`);
    }
  }

  _logFinalStatus() {
    const hybridStatus = this.mesh?.getStatus?.();
    const nordicPeers = this.nordicMesh?.getPeers?.() || [];
    const nordicAuth = this.nordicMesh?.isAuthenticated?.() ? 'AUTH' : 'PASSIVE';
    
    DEBUG.log(
      `Status: Mode=${hybridStatus?.mode || 'N/A'} ` +
      `HybridPeers=${hybridStatus?.peerCount || 0} ` +
      `NordicPeers=${nordicPeers.length}[${nordicAuth}] ` +
      `WS=${this.wsClient?.isConnected ? 'ON' : 'OFF'}`,
      'info',
      'STATUS'
    );
  }

  async _partialCleanup() {
    DEBUG.log('Executing partial cleanup...', 'warn', 'CLEANUP');
    if (this.nordicMesh) { try { await this.nordicMesh.destroy?.(); } catch(e) {} this.nordicMesh = null; }
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { this.wsClient.disconnect?.(); } catch(e) {} this.wsClient = null; }
  }

  async destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    DEBUG.log('🧹 NAP 2.0 Cleanup...', 'info', 'DESTROY');

    if (this.bleInterface) { try { this.bleInterface.destroy(); } catch(e) {} this.bleInterface = null; }
    if (this.vaultSlider) { try { this.vaultSlider.destroy?.(); } catch(e) {} this.vaultSlider = null; }
    if (this.gestures) { try { this.gestures.destroy?.(); } catch(e) {} this.gestures = null; }
    if (this.stream) { try { this.stream.destroy?.(); } catch(e) {} this.stream = null; }
    if (this.bridge) { try { this.bridge.destroy?.(); } catch(e) {} this.bridge = null; }
    
    if (this.nordicMesh) {
      this._resources.handlers.forEach(unsub => { try { unsub(); } catch(e) {} });
      try { await this.nordicMesh.destroy?.(); } catch(e) {}
      this.nordicMesh = null;
    }
    
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { this.wsClient.disconnect?.(); } catch(e) {} this.wsClient = null; }
    if (this.vault) { try { this.vault.destroy?.(); } catch(e) {} this.vault = null; }
    
    this._resources.timers.forEach(t => clearTimeout(t));
    this._resources.timers.clear();
    this._resources.handlers.clear();

    DEBUG.success('Cleanup complete', 'DESTROY_OK');
  }

  getStatus() {
    return {
      initialized: this.initialized,
      destroyed: this._isDestroyed,
      mode: this.mesh?.getStatus?.().mode || (this.nordicMesh?.getState?.() === 'messaging' ? 'p2p_ble' : 'offline'),
      peers: this.mesh?.getPeerCount?.() || 0,
      nordicPeers: this.nordicMesh?.getPeers?.().length || 0,
      nordicAuthenticated: this.nordicMesh?.isAuthenticated?.() || false,
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
