/**
 * NEXO App v2.3.1-export-fixed
 * Orquestador principal - Export ES6 corregido para Vite
 */

import { CryptoVault } from '../core/crypto_vault.js';
import { BleMesh } from '../mesh/ble_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { VirtualEngine } from '../perf/virtual_engine.js';
import { TheStream } from '../stream/the_stream.js';

const DEBUG = {
  log: (msg, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${msg}`);
    if (typeof window !== 'undefined' && window.NEXO_DIAG && window.NEXO_DIAG.log) {
      window.NEXO_DIAG.log(msg, type);
    }
  },
  error: (msg) => DEBUG.log(msg, 'error'),
  success: (msg) => DEBUG.log(msg, 'success'),
  warn: (msg) => DEBUG.log(msg, 'warn')
};

export class NexoApp {
  constructor(config = {}) {
    this.config = {
      relayUrls: config.relayUrls || [],
      bleTimeout: config.bleTimeout || 5000,
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      onMessage: config.onMessage || (() => {}),
      onStatusChange: config.onStatusChange || (() => {}),
      onError: config.onError || ((err) => console.error('NexoApp Error:', err))
    };
    
    this.vault = null;
    this.mesh = null;
    this.wsClient = null;
    this.bridge = null;
    this.gestures = null;
    this.stream = null;
    this.virtualEngine = null;
    
    this.initialized = false;
    this.destroyed = false;
    this.initError = null;
    this.currentPhase = 'NONE';
  }
  
  async init() {
    if (this.initialized) {
      DEBUG.log('⚠️ App already initialized', 'warn');
      return this;
    }
    
    if (this.destroyed) {
      throw new Error('App was destroyed, create new instance');
    }
    
    DEBUG.log('🚀 [init] ===== INICIANDO NEXO APP =====');
    
    try {
      // FASE 1: CryptoVault
      this.currentPhase = 'CRYPTO';
      DEBUG.log('🔐 [init] Fase 1/6: CryptoVault...');
      
      this.vault = new CryptoVault();
      await this.vault.init();
      
      const identity = this.vault.getIdentity?.();
      if (identity) {
        DEBUG.log(`✓ Identity: ${identity.substring(0, 8)}...`);
      }
      
      // FASE 2: WebSocket
      this.currentPhase = 'WEBSOCKET';
      DEBUG.log('🌐 [init] Fase 2/6: WebSocketClient...');
      
      if (this.config.relayUrls.length > 0) {
        this.wsClient = new WebSocketClient({
          urls: this.config.relayUrls,
          onMessage: (msg) => this._handleMessage(msg, 'relay'),
          onConnect: () => {
            DEBUG.log('🌐 WebSocket connected');
            this._updateStatus();
          },
          onDisconnect: () => {
            DEBUG.log('🌐 WebSocket disconnected');
            this._updateStatus();
          },
          onError: (err) => {
            DEBUG.error(`WebSocket error: ${err.message}`);
            this.config.onError(err);
          }
        });
        
        try {
          await this.wsClient.connect();
          DEBUG.log('✓ WebSocketClient connected');
        } catch (wsErr) {
          DEBUG.warn(`⚠️ WebSocket failed: ${wsErr.message}`);
        }
      }
      
      // FASE 3: BLE Mesh
      this.currentPhase = 'MESH';
      DEBUG.log('📡 [init] Fase 3/6: BleMesh...');
      
      if (this.config.enableMesh && typeof navigator !== 'undefined' && navigator.bluetooth) {
        try {
          this.mesh = new BleMesh({
            onPeer: (peer) => {
              DEBUG.log(`📡 New peer: ${peer.id || 'unknown'}`);
              this._updateStatus();
            },
            onMessage: (msg, peer) => this._handleMessage(msg, 'ble'),
            onDisconnect: () => {
              DEBUG.log('📡 Mesh peer disconnected');
              this._updateStatus();
            }
          });
          
          const meshTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('BLE timeout')), this.config.bleTimeout)
          );
          
          await Promise.race([this.mesh.init(), meshTimeout]);
          DEBUG.log('✓ BleMesh initialized');
          
        } catch (meshErr) {
          DEBUG.warn(`⚠️ BLE Mesh failed: ${meshErr.message}`);
          this.mesh = null;
        }
      } else {
        DEBUG.log('⚠️ BLE not available or disabled');
        this.mesh = null;
      }
      
      // FASE 4: Bridge
      this.currentPhase = 'BRIDGE';
      DEBUG.log('🌉 [init] Fase 4/6: MeshRelayBridge...');
      
      try {
        this.bridge = new MeshRelayBridge({
          mesh: this.mesh,
          relay: this.wsClient,
          onModeChange: (mode) => {
            DEBUG.log(`🌉 Mode changed: ${mode}`);
            this.config.onStatusChange(mode);
          },
          onMessage: (msg) => this._handleMessage(msg, 'bridge')
        });
        
        await this.bridge.init();
        DEBUG.log('✓ MeshRelayBridge initialized');
        
      } catch (bridgeErr) {
        DEBUG.warn(`⚠️ Bridge failed: ${bridgeErr.message}`);
        this.bridge = null;
      }
      
      // FASE 5: Gestures
      this.currentPhase = 'GESTURES';
      DEBUG.log('👆 [init] Fase 5/6: GestureEngine...');
      
      if (this.config.enableGestures) {
        try {
          this.gestures = new GestureEngine({
            onSwipeLeft: () => this._navigate('back'),
            onSwipeRight: () => this._navigate('forward'),
            onSwipeUp: () => this._showMenu(),
            onSwipeDown: () => this._refresh()
          });
          
          this.gestures.init();
          DEBUG.log('✓ GestureEngine initialized');
          
        } catch (gestureErr) {
          DEBUG.warn(`⚠️ Gestures failed: ${gestureErr.message}`);
          this.gestures = null;
        }
      }
      
      // FASE 6: Stream (CORREGIDO)
      this.currentPhase = 'STREAM';
      DEBUG.log('📰 [init] Fase 6/6: TheStream...');

      try {
        const container = document.getElementById('messages-container');
        
        if (!container) {
          throw new Error('Elemento #messages-container no encontrado en DOM');
        }
        
        if (!(container instanceof Element)) {
          throw new Error('Container no es un Elemento DOM válido');
        }

        this.virtualEngine = new VirtualEngine(container, {
          itemHeight: 80,
          overscan: 3,
          poolSize: 15
        });
        
        this.stream = new TheStream(container, {
          onItemTap: (item) => {
            DEBUG.log(`Tap en: ${item.id?.substr(0,8) || 'unknown'}`);
          },
          onItemSwipe: (item, action) => {
            DEBUG.log(`Swipe ${action} en mensaje`);
          },
          onLoadMore: async () => {
            DEBUG.log('Cargando más mensajes...');
          }
        });
        
        this.stream.setData([]);
        
        DEBUG.log('✅ TheStream initialized correctamente');

      } catch (streamErr) {
        DEBUG.error(`⚠️ Stream failed: ${streamErr.message}`);
        this.stream = null;
        this.virtualEngine = null;
      }
      
      this.initialized = true;
      this.currentPhase = 'READY';
      DEBUG.log('🎉 [init] ===== INICIALIZACIÓN COMPLETADA =====');
      DEBUG.log(`📊 Status: ${this._getStatusString()}`);
      
      this._updateStatus();
      
      return this;
      
    } catch (error) {
      this.initError = error;
      this.currentPhase = 'ERROR';
      DEBUG.error(`💥 [init] ERROR CRÍTICO: ${error.message}`);
      await this._partialCleanup();
      throw error;
    }
  }
  
  _handleMessage(msg, source) {
    if (this.destroyed) return;
    
    try {
      const enriched = {
        ...msg,
        _source: source,
        _receivedAt: Date.now(),
        _id: msg._id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2, 9))
      };
      
      if (this.stream && this.stream.appendItems) {
        // Formato para TheStream
        const streamItem = {
          id: enriched._id,
          type: 'message',
          content: msg.text || msg.data,
          author: { name: msg._sender?.substring(0,8) || 'Unknown', avatar: '/avatar.png' },
          timestamp: msg.timestamp || Date.now(),
          pulseScore: 0.5
        };
        this.stream.appendItems([streamItem]);
      }
      
      this.config.onMessage(enriched);
      
    } catch (err) {
      DEBUG.error(`Error handling message: ${err.message}`);
    }
  }
  
  _updateStatus() {
    if (this.destroyed) return;
    
    try {
      let mode = 'OFFLINE';
      
      if (this.bridge && typeof this.bridge.getMode === 'function') {
        mode = this.bridge.getMode();
      } else if (this.wsClient?.isConnected?.()) {
        mode = 'RELAY';
      } else if (this.mesh?.hasPeers?.()) {
        mode = 'P2P';
      }
      
      this.config.onStatusChange(mode);
      
    } catch (err) {
      DEBUG.error(`Error updating status: ${err.message}`);
    }
  }
  
  _getStatusString() {
    const parts = [];
    if (this.vault) parts.push('Vault:OK');
    if (this.wsClient?.isConnected?.()) parts.push('WS:OK');
    if (this.mesh?.hasPeers?.()) parts.push('Mesh:OK');
    if (this.bridge) parts.push('Bridge:OK');
    return parts.join(' | ') || 'No connections';
  }
  
  sendMessage(msg) {
    if (!this.initialized || this.destroyed) {
      DEBUG.error('Cannot send: App not initialized or destroyed');
      return false;
    }
    
    try {
      const enriched = {
        ...msg,
        _own: true,
        _sender: this.vault?.getIdentity?.() || 'unknown',
        _timestamp: Date.now()
      };
      
      let sent = false;
      if (this.bridge && typeof this.bridge.send === 'function') {
        sent = this.bridge.send(enriched);
      }
      
      if (!sent && this.wsClient?.send) {
        sent = this.wsClient.send(enriched);
      }
      
      this._handleMessage(enriched, 'self');
      
      return sent;
      
    } catch (err) {
      DEBUG.error(`Error sending message: ${err.message}`);
      return false;
    }
  }
  
  _navigate(direction) { DEBUG.log(`Navigate: ${direction}`); }
  _showMenu() { DEBUG.log('Show menu'); }
  _refresh() { 
    DEBUG.log('Refresh');
    if (this.stream?.refresh) this.stream.refresh();
  }
  
  async _partialCleanup() {
    DEBUG.log('🧹 [cleanup] Limpiando recursos parciales...');
    if (this.gestures?.destroy) { try { this.gestures.destroy(); } catch (e) {} this.gestures = null; }
    if (this.bridge?.destroy) { try { await this.bridge.destroy(); } catch (e) {} this.bridge = null; }
    if (this.mesh?.destroy) { try { await this.mesh.destroy(); } catch (e) {} this.mesh = null; }
    if (this.wsClient?.disconnect) { try { await this.wsClient.disconnect(); } catch (e) {} this.wsClient = null; }
  }
  
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    DEBUG.log('🧹 [destroy] Limpiando recursos...');
    
    if (this.gestures?.destroy) { try { this.gestures.destroy(); } catch (e) {} this.gestures = null; }
    if (this.stream?.destroy) { try { this.stream.destroy(); } catch (e) {} this.stream = null; }
    if (this.virtualEngine?.destroy) { try { this.virtualEngine.destroy(); } catch (e) {} this.virtualEngine = null; }
    if (this.bridge?.destroy) { try { await this.bridge.destroy(); } catch (e) {} this.bridge = null; }
    if (this.mesh?.destroy) { try { await this.mesh.destroy(); } catch (e) {} this.mesh = null; }
    if (this.wsClient?.disconnect) { try { await this.wsClient.disconnect(); } catch (e) {} this.wsClient = null; }
    if (this.vault?.destroy) { try { await this.vault.destroy(); } catch (e) {} this.vault = null; }
    
    this.initialized = false;
    DEBUG.log('✅ [destroy] Recursos liberados');
  }
  
  getStatus() {
    return {
      initialized: this.initialized,
      destroyed: this.destroyed,
      currentPhase: this.currentPhase,
      hasVault: !!this.vault,
      hasMesh: !!this.mesh,
      hasWebSocket: !!this.wsClient,
      hasBridge: !!this.bridge,
      identity: this.vault?.getIdentity?.() || null
    };
  }
}

// [FIX CRÍTICO] Export ES6 explícito para Vite/Rollup
export default NexoApp;
