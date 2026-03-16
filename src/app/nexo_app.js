/**
 * NEXO App v2.5-NAP-CERTIFIED (FIX: Timeouts por fase)
 * Cada fase tiene timeout individual para evitar bloqueos totales
 */

// IMPORTS CORE
import { GestureEngine as CoreGestureEngine } from '../core/gesture_engine.js';
import { CryptoVault } from '../vault/crypto_vault.js';
import { BleMesh } from '../mesh/ble_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { VirtualEngine } from '../perf/virtual_engine.js';
import { TheStream } from '../stream/the_stream.js';
import { rem } from '../ui/rem.js';

const NAP_APP_ERRORS = {
  APP_001: 'STREAM_APPEND_FAILED',
  APP_002: 'STREAM_INIT_FAILED',
  // ... (mantén todos los demás errores que ya tenías)
  APP_013: 'CRYPTO_INIT_TIMEOUT',
  APP_014: 'WEBSOCKET_INIT_TIMEOUT',
  APP_015: 'PHASE_TIMEOUT'
};

const DEBUG = {
  rem: rem,
  log: (msg, type = 'info') => {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (type === 'error') {
      const codeMatch = msg.match(/\[(APP_\d{3}|HTML_\d{3})\]/);
      rem.error(msg.replace(/\[APP_\d{3}\]\s*/, ''), codeMatch?.[1]);
    } else if (type === 'warn') rem.warn(msg);
    else if (type === 'success') rem.success(msg);
    else rem.info(msg);
    
    if (window.NEXO_DIAG?.log) window.NEXO_DIAG.log(msg, type);
  },
  error: (code, msg) => DEBUG.log(`[${code}] ${msg}`, 'error'),
  success: (msg) => DEBUG.log(msg, 'success'),
  warn: (msg) => DEBUG.log(msg, 'warn'),
  setPhase: (phase) => rem.updatePhase(phase),
  setMode: (mode) => rem.updateMode(mode),
  setIdentity: (id) => id && rem.updateIdentity(id)
};

// Helper: Ejecutar con timeout
async function withTimeout(promise, ms, errorMsg) {
  const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(errorMsg)), ms)
  );
  return Promise.race([promise, timeout]);
}

export class NexoApp {
  constructor(config = {}) {
    this.config = {
      relayUrls: config.relayUrls || [],
      bleTimeout: config.bleTimeout || 3000,
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      onMessage: config.onMessage || (() => {}),
      onStatusChange: config.onStatusChange || (() => {}),
      onError: config.onError || console.error,
      onVaultStateChange: config.onVaultStateChange || (() => {}),
      actionCallbacks: config.actionCallbacks || {}
    };
    
    this.vault = null;
    this.mesh = null;
    this.wsClient = null;
    this.bridge = null;
    this.gestures = null;
    this.stream = null;
    this.virtualEngine = null;
    this.vaultSlider = null;
    this.isVaultOpen = false;
    this.initialized = false;
    this.destroyed = false;
    this.initError = null;
    this.currentPhase = 'NONE';
    
    DEBUG.log('🚀 [NEXO] App instance created v2.5-NAP');
  }
  
  async init() {
    if (this.initialized) return this;
    if (this.destroyed) throw new Error('APP-002: App was destroyed');
    
    DEBUG.log('🚀 [init] ===== INICIANDO FASES NEXO =====');
    
    // FASE 1: CRYPTO (Timeout 3s)
    try {
      this.currentPhase = 'CRYPTO';
      DEBUG.setPhase('CRYPTO');
      DEBUG.log('🔐 [1/6] CryptoVault...');
      
      this.vault = new CryptoVault();
      await withTimeout(this.vault.init(), 3000, 'Crypto init timeout');
      
      const identity = this.vault.getIdentity?.();
      if (identity) {
        DEBUG.log(`✓ Identity: ${identity.substring(0, 8)}...`);
        DEBUG.setIdentity(identity);
      }
    } catch (err) {
      DEBUG.warn(`⚠️ CryptoVault failed: ${err.message}`);
      this.vault = null; // Continuar sin vault
    }
    
    // FASE 2: WEBSOCKET (Timeout 3s)
    try {
      this.currentPhase = 'WEBSOCKET';
      DEBUG.setPhase('WEBSOCKET');
      DEBUG.log('🌐 [2/6] WebSocketClient...');
      
      if (this.config.relayUrls.length > 0) {
        this.wsClient = new WebSocketClient(this.config.relayUrls[0]);
        this.wsClient.onOpen = () => {
          DEBUG.log('🌐 WebSocket connected', 'success');
          DEBUG.setMode('RELAY');
          this._updateStatus();
        };
        this.wsClient.onClose = () => this._updateStatus();
        this.wsClient.onError = (err) => DEBUG.error('WS_ERR', err?.message || 'WS Error');
        this.wsClient.onMessage = (msg) => this._handleMessage(msg, 'relay');
        
        await withTimeout(this.wsClient.connect(), 3000, 'WS connect timeout');
      }
    } catch (err) {
      DEBUG.warn(`⚠️ WebSocket failed: ${err.message}`);
      this.wsClient = null;
    }
    
    // FASE 3: MESH (Timeout 3s)
    try {
      this.currentPhase = 'MESH';
      DEBUG.setPhase('MESH');
      DEBUG.log('📡 [3/6] BleMesh...');
      
      if (this.config.enableMesh && navigator?.bluetooth) {
        this.mesh = new BleMesh({
          onPeer: (peer) => {
            DEBUG.log(`📡 Peer: ${peer.id || 'unknown'}`);
            this._updateStatus();
          },
          onMessage: (msg, peer) => this._handleMessage(msg, 'ble'),
          onDisconnect: () => this._updateStatus()
        });
        await withTimeout(this.mesh.init(), 3000, 'BLE init timeout');
        DEBUG.log('✓ BleMesh ready', 'success');
      } else {
        DEBUG.log('ℹ️ BLE disabled or unavailable');
      }
    } catch (err) {
      DEBUG.warn(`⚠️ BLE Mesh failed: ${err.message}`);
      this.mesh = null;
    }
    
    // FASE 4: BRIDGE (Timeout 3s)
    try {
      this.currentPhase = 'BRIDGE';
      DEBUG.setPhase('BRIDGE');
      DEBUG.log('🌉 [4/6] MeshRelayBridge...');
      
      if (this.mesh || this.wsClient) {
        this.bridge = new MeshRelayBridge({
          mesh: this.mesh,
          relay: this.wsClient,
          onModeChange: (mode) => {
            DEBUG.log(`🌉 Mode: ${mode}`);
            DEBUG.setMode(mode);
            this.config.onStatusChange(mode);
          },
          onMessage: (msg) => this._handleMessage(msg, 'bridge')
        });
        await withTimeout(this.bridge.init(), 3000, 'Bridge init timeout');
        DEBUG.log('✓ Bridge ready', 'success');
      }
    } catch (err) {
      DEBUG.warn(`⚠️ Bridge failed: ${err.message}`);
      this.bridge = null;
    }
    
    // FASE 5: UI GESTURES (Timeout 2s)
    try {
      this.currentPhase = 'GESTURES';
      DEBUG.setPhase('GESTURES');
      DEBUG.log('👆 [5/6] GestureEngine (UI)...');
      
      if (this.config.enableGestures) {
        this.gestures = new GestureEngine({
          onSwipeLeft: () => {},
          onSwipeRight: () => {},
          onSwipeUp: () => {},
          onSwipeDown: () => {}
        });
        this.gestures.init();
      }
    } catch (err) {
      DEBUG.warn(`⚠️ UI Gestures failed: ${err.message}`);
      this.gestures = null;
    }
    
    // FASE 5.5: VAULT SLIDER (Timeout 2s)
    try {
      this.currentPhase = 'VAULT_SLIDER';
      DEBUG.setPhase('VAULT_SLIDER');
      DEBUG.log('👆 [5.5/6] Vault Slider...');
      
      const streamEl = document.getElementById('nexo-stream') || document.querySelector('.stream-container');
      const vaultEl = document.getElementById('nexo-vault') || document.getElementById('vault-panel');
      
      if (streamEl && vaultEl) {
        this.vaultSlider = new CoreGestureEngine(streamEl, vaultEl);
        
        window.addEventListener('nexo:vault:opened', () => {
          this.isVaultOpen = true;
          DEBUG.log('[VAULT] Abierto', 'success');
          if (this.gestures?.disable) this.gestures.disable();
          this.config.onVaultStateChange(true);
        });
        
        window.addEventListener('nexo:vault:closed', () => {
          this.isVaultOpen = false;
          DEBUG.log('[VAULT] Cerrado');
          if (this.gestures?.enable) this.gestures.enable();
          this.config.onVaultStateChange(false);
        });
        
        DEBUG.log('✓ Vault Slider activo', 'success');
      }
    } catch (err) {
      DEBUG.warn(`⚠️ Vault Slider failed: ${err.message}`);
      this.vaultSlider = null;
    }
    
    // FASE 6: STREAM (Timeout 3s)
    try {
      this.currentPhase = 'STREAM';
      DEBUG.setPhase('STREAM');
      DEBUG.log('📰 [6/6] TheStream...');
      
      const container = document.getElementById('messages-container');
      if (!container) throw new Error('No messages-container');
      
      try {
        this.virtualEngine = new VirtualEngine(container, {
          itemHeight: 80,
          overscan: 3,
          poolSize: 15
        });
      } catch (e) {
        DEBUG.warn(`VirtualEngine skipped: ${e.message}`);
      }
      
      this.stream = new TheStream(container, {
        actionCallbacks: this.config.actionCallbacks
      });
      this.stream.appendItems([]);
      DEBUG.log('✅ Stream ready', 'success');
      
    } catch (err) {
      DEBUG.error('APP_002', `Stream failed: ${err.message}`);
      this.stream = null;
    }
    
    // COMPLETADO
    this.initialized = true;
    this.currentPhase = 'READY';
    DEBUG.setPhase('READY');
    DEBUG.log('🎉 ===== INICIALIZACIÓN COMPLETADA =====', 'success');
    DEBUG.log(`Status: ${this._getStatusString()}`);
    
    return this;
  }
  
  _getStatusString() {
    const parts = [];
    if (this.vault) parts.push('Vault');
    if (this.wsClient) parts.push('WS');
    if (this.mesh) parts.push('Mesh');
    if (this.bridge) parts.push('Bridge');
    if (this.stream) parts.push('Stream');
    return parts.join('+') || 'Basic';
  }
  
  _handleMessage(msg, source) {
    if (this.destroyed || !this.stream) return;
    try {
      const enriched = { ...msg, _source: source, _receivedAt: Date.now() };
      this.config.onMessage(enriched);
    } catch (err) {
      DEBUG.error('APP_005', `Msg handler: ${err.message}`);
    }
  }
  
  _updateStatus() {
    if (this.destroyed) return;
    try {
      let mode = 'OFFLINE';
      if (this.bridge?.getMode) mode = this.bridge.getMode();
      else if (this.wsClient?.isConnected?.()) mode = 'RELAY';
      else if (this.mesh?.hasPeers?.()) mode = 'P2P';
      
      DEBUG.setMode(mode);
      this.config.onStatusChange(mode);
    } catch (err) {
      DEBUG.error('APP_007', `Status update: ${err.message}`);
    }
  }
  
  async sendMessage(msg) {
    if (!this.initialized || this.destroyed) return false;
    try {
      const enriched = { ...msg, _own: true, _timestamp: Date.now() };
      this._handleMessage(enriched, 'self');
      
      if (this.bridge?.send) return await this.bridge.send(enriched);
      if (this.wsClient?.send) return this.wsClient.send(enriched);
      
      return false;
    } catch (err) {
      DEBUG.error('APP_008', `Send failed: ${err.message}`);
      return false;
    }
  }
  
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    
    const resources = ['vaultSlider', 'gestures', 'stream', 'virtualEngine', 'bridge', 'mesh', 'wsClient', 'vault'];
    for (const name of resources) {
      try {
        if (this[name]?.destroy || this[name]?.disconnect) {
          await (this[name].destroy?.() || this[name].disconnect?.());
        }
      } catch (e) {}
      this[name] = null;
    }
    
    this.initialized = false;
    DEBUG.log('🧹 Destroy complete', 'success');
  }
  
  getStatus() {
    return {
      initialized: this.initialized,
      currentPhase: this.currentPhase,
      hasVault: !!this.vault,
      hasStream: !!this.stream,
      isVaultOpen: this.isVaultOpen
    };
  }
}

export default NexoApp;
export { NAP_APP_ERRORS, DEBUG };
