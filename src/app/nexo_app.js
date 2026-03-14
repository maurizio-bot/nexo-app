/**
 * NEXO App v2.5-NAP-CERTIFIED (Migrado a src/)
 * Orquestador principal con sistema NAP-APP-XXX Error Codes
 * Pattern: NAP 2.0 + Interface Contract + SOC2 Resource Management
 */

import { CryptoVault } from '../vault/crypto_vault.js';
import { BleMesh } from '../mesh/ble_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { VirtualEngine } from '../perf/virtual_engine.js';
import { TheStream } from '../stream/the_stream.js';

// NAP: Sistema de error codes únicos para debugging físico
const NAP_APP_ERRORS = {
  APP_001: 'STREAM_APPEND_FAILED',
  APP_002: 'STREAM_INIT_FAILED',
  APP_003: 'BRIDGE_INTERFACE_MISMATCH',
  APP_004: 'VAULT_NOT_INITIALIZED',
  APP_005: 'MESSAGE_HANDLER_ERROR',
  APP_006: 'VIRTUAL_ENGINE_INIT_FAILED',
  APP_007: 'STATUS_UPDATE_FAILED',
  APP_008: 'SEND_MESSAGE_FAILED',
  APP_009: 'GESTURE_INIT_FAILED',
  APP_010: 'CLEANUP_ERROR'
};

const DEBUG = {
  log: (msg, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${msg}`);
    if (typeof window !== 'undefined' && window.NEXO_DIAG?.log) {
      window.NEXO_DIAG.log(msg, type);
    }
  },
  error: (code, msg) => DEBUG.log(`[${code}] ${msg}`, 'error'),
  success: (msg) => DEBUG.log(msg, 'success'),
  warn: (msg) => DEBUG.log(msg, 'warn')
};

export class NexoApp {
  constructor(config = {}) {
    // NAP: Configuración completa incluyendo callbacks para TheStream
    this.config = {
      relayUrls: config.relayUrls || [],
      bleTimeout: config.bleTimeout || 5000,
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      onMessage: config.onMessage || (() => {}),
      onStatusChange: config.onStatusChange || (() => {}),
      onError: config.onError || ((err) => console.error('NexoApp Error:', err)),
      // NAP: Action callbacks para TheStream (react, reply, forward)
      actionCallbacks: config.actionCallbacks || {}
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
    
    DEBUG.log('🚀 [NEXO] App instance created v2.5-NAP (src/ structure)');
  }
  
  async init() {
    if (this.initialized) {
      DEBUG.warn('⚠️ App already initialized');
      return this;
    }
    
    if (this.destroyed) {
      throw new Error('APP-002: App was destroyed, create new instance');
    }
    
    DEBUG.log('🚀 [init] ===== INICIANDO NEXO APP v2.5-NAP (src/) =====');
    
    try {
      // FASE 1: CRYPTO
      this.currentPhase = 'CRYPTO';
      DEBUG.log('🔐 [init] Fase 1/6: CryptoVault...');
      this.vault = new CryptoVault();
      await this.vault.init();
      const identity = this.vault.getIdentity?.();
      if (identity) DEBUG.log(`✓ Identity: ${identity.substring(0, 8)}...`);
      
      // FASE 2: WEBSOCKET
      this.currentPhase = 'WEBSOCKET';
      DEBUG.log('🌐 [init] Fase 2/6: WebSocketClient...');
      if (this.config.relayUrls.length > 0) {
        this.wsClient = new WebSocketClient(this.config.relayUrls[0]);
        this.wsClient.onOpen = () => {
          DEBUG.log('🌐 WebSocket connected');
          this._updateStatus();
        };
        this.wsClient.onClose = () => {
          DEBUG.log('🌐 WebSocket disconnected');
          this._updateStatus();
        };
        this.wsClient.onError = (err, code, details) => {
          DEBUG.error(err?.message || 'WS_ERROR', `WebSocket error: ${code || 'unknown'}`);
        };
        this.wsClient.onMessage = (msg) => this._handleMessage(msg, 'relay');
        try {
          await this.wsClient.connect();
        } catch (wsErr) {
          DEBUG.warn(`⚠️ WebSocket failed: ${wsErr.message}`);
        }
      }
      
      // FASE 3: MESH
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
      
      // FASE 4: BRIDGE
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
      
      // FASE 5: GESTURES
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
          DEBUG.error(NAP_APP_ERRORS.APP_009, `Gestures failed: ${gestureErr.message}`);
          this.gestures = null;
        }
      }
      
      // FASE 6: STREAM (NAP-CERTIFIED INTERFACE)
      this.currentPhase = 'STREAM';
      DEBUG.log('📰 [init] Fase 6/6: TheStream...');
      try {
        const container = document.getElementById('messages-container');
        if (!container) throw new Error('Elemento #messages-container no encontrado');
        
        // NAP: VirtualEngine con error handling
        try {
          this.virtualEngine = new VirtualEngine(container, {
            itemHeight: 80,
            overscan: 3,
            poolSize: 15
          });
        } catch (veErr) {
          DEBUG.error(NAP_APP_ERRORS.APP_006, `VirtualEngine init failed: ${veErr.message}`);
          this.virtualEngine = null;
        }
        
        // NAP: TheStream con Interface Contract correcto (actionCallbacks)
        this.stream = new TheStream(container, {
          actionCallbacks: {
            onReact: (id) => {
              DEBUG.log(`⚡ React: ${id?.substr?.(0,8) || 'unknown'}`);
              this.config.actionCallbacks.onReact?.(id);
            },
            onReply: (id) => {
              DEBUG.log(`↩️ Reply: ${id?.substr?.(0,8) || 'unknown'}`);
              this.config.actionCallbacks.onReply?.(id);
            },
            onForward: (id) => {
              DEBUG.log(`↗️ Forward: ${id?.substr?.(0,8) || 'unknown'}`);
              this.config.actionCallbacks.onForward?.(id);
            }
          }
        });
        
        // NAP: Inicialización segura
        this.stream.appendItems([]);
        DEBUG.log('✅ TheStream initialized correctamente');
      } catch (streamErr) {
        DEBUG.error(NAP_APP_ERRORS.APP_002, `Stream init failed: ${streamErr.message}`);
        // NAP: Cleanup parcial completo para evitar memory leaks
        if (this.virtualEngine?.destroy) {
          try { this.virtualEngine.destroy(); } catch (e) {}
        }
        this.stream = null;
        this.virtualEngine = null;
      }
      
      this.initialized = true;
      this.currentPhase = 'READY';
      DEBUG.log('🎉 [init] ===== INICIALIZACIÓN COMPLETADA (src/) =====');
      DEBUG.log(`📊 Status: ${this._getStatusString()}`);
      this._updateStatus();
      return this;
      
    } catch (error) {
      this.initError = error;
      this.currentPhase = 'ERROR';
      DEBUG.error(NAP_APP_ERRORS.APP_002, `CRÍTICO: ${error.message}`);
      await this._partialCleanup();
      throw error;
    }
  }
  
  /**
   * NAP: Message handler con Error Boundary (IAST)
   */
  _handleMessage(msg, source) {
    if (this.destroyed) return;
    try {
      const enriched = {
        ...msg,
        _source: source,
        _receivedAt: Date.now(),
        _id: msg._id || Math.random().toString(36).substr(2, 9)
      };
      
      // NAP: Safe Stream Operation con try-catch aislado
      if (this.stream?.appendItems) {
        try {
          const streamItem = {
            id: enriched._id,
            type: 'message',
            content: msg.text || msg.data || msg.content || '',
            sender: msg._sender?.substring?.(0,8) || 'Unknown',
            timestamp: msg.timestamp || Date.now(),
            isMe: msg._own || false
          };
          this.stream.appendItems([streamItem]);
        } catch (streamErr) {
          DEBUG.error(NAP_APP_ERRORS.APP_001, `Stream append failed: ${streamErr.message}`);
          // Continuar sin crash - mensaje va al callback aunque no al stream
        }
      }
      
      this.config.onMessage(enriched);
    } catch (err) {
      DEBUG.error(NAP_APP_ERRORS.APP_005, `Error handling message: ${err.message}`);
    }
  }
  
  /**
   * NAP: Status update con defensive programming
   */
  _updateStatus() {
    if (this.destroyed) return;
    try {
      let mode = 'OFFLINE';
      
      // NAP: Defensive check de bridge interface
      if (this.bridge?.getMode) {
        try {
          mode = this.bridge.getMode();
        } catch (bridgeErr) {
          DEBUG.warn(`Bridge getMode failed: ${bridgeErr.message}`);
          mode = this.bridge ? 'HYBRID' : 'OFFLINE';
        }
      } else if (this.wsClient?.isConnected?.()) {
        mode = 'RELAY';
      } else if (this.mesh?.hasPeers?.()) {
        mode = 'P2P';
      }
      
      this.config.onStatusChange(mode);
    } catch (err) {
      DEBUG.error(NAP_APP_ERRORS.APP_007, `Error updating status: ${err.message}`);
    }
  }
  
  _getStatusString() {
    const parts = [];
    if (this.vault) parts.push('Vault:OK');
    if (this.wsClient?.isConnected?.()) parts.push('WS:OK');
    if (this.mesh?.hasPeers?.()) parts.push('Mesh:OK');
    if (this.bridge) parts.push('Bridge:OK');
    if (this.stream) parts.push('Stream:OK');
    return parts.join(' | ') || 'No connections';
  }
  
  /**
   * NAP: Send message con error handling completo
   */
  async sendMessage(msg) {
    if (!this.initialized || this.destroyed) {
      DEBUG.error(NAP_APP_ERRORS.APP_008, 'Cannot send: App not initialized or destroyed');
      return false;
    }
    
    try {
      const enriched = {
        ...msg,
        _own: true,
        _sender: this.vault?.getIdentity?.() || 'unknown',
        _timestamp: Date.now()
      };
      
      // Optimistic UI
      this._handleMessage(enriched, 'self');
      
      let sent = false;
      
      // Intentar bridge primero
      if (this.bridge?.send) {
        try {
          sent = await Promise.resolve(this.bridge.send(enriched));
        } catch (bridgeErr) {
          DEBUG.warn(`Bridge send failed: ${bridgeErr.message}`);
          sent = false;
        }
      }
      
      // Fallback a WebSocket
      if (!sent && this.wsClient) {
        try {
          sent = this.wsClient.send(enriched);
        } catch (wsErr) {
          DEBUG.warn(`WebSocket send failed: ${wsErr.message}`);
          sent = false;
        }
      }
      
      if (!sent) DEBUG.warn('Message queued (offline mode)');
      return sent;
      
    } catch (err) {
      DEBUG.error(NAP_APP_ERRORS.APP_008, `Error sending message: ${err.message}`);
      return false;
    }
  }
  
  // UI Navigation (placeholders)
  _navigate(direction) { DEBUG.log(`Navigate: ${direction}`); }
  _showMenu() { DEBUG.log('Show menu'); }
  _refresh() { 
    DEBUG.log('Refresh');
    try {
      this.stream?.refresh?.();
    } catch (e) {
      DEBUG.warn(`Refresh failed: ${e.message}`);
    }
  }
  
  /**
   * NAP: Partial Cleanup (uso en errores de init)
   * Incluye TODOS los recursos, incluso stream y virtualEngine
   */
  async _partialCleanup() {
    DEBUG.log('🧹 [NAP-CLEANUP] Limpiando recursos parciales...');
    
    const cleanupOrder = [
      { name: 'gestures', ref: 'gestures', method: 'destroy' },
      { name: 'stream', ref: 'stream', method: 'destroy' },
      { name: 'virtualEngine', ref: 'virtualEngine', method: 'destroy' },
      { name: 'bridge', ref: 'bridge', method: 'destroy', async: true },
      { name: 'mesh', ref: 'mesh', method: 'destroy', async: true },
      { name: 'wsClient', ref: 'wsClient', method: 'disconnect', async: true }
    ];
    
    for (const item of cleanupOrder) {
      const obj = this[item.ref];
      if (obj?.[item.method]) {
        try {
          if (item.async) {
            await obj[item.method]();
          } else {
            obj[item.method]();
          }
        } catch (e) {
          DEBUG.warn(`Cleanup ${item.name} failed: ${e.message}`);
        }
        this[item.ref] = null;
      }
    }
    
    DEBUG.log('✅ [NAP-CLEANUP] Recursos parciales liberados');
  }
  
  /**
   * NAP: Destroy completo (uso explícito o garbage collection)
   */
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    
    DEBUG.log('🧹 [NAP-DESTROY] Limpiando todos los recursos...');
    
    try {
      await this._partialCleanup();
      
      // Vault al final (encripta datos sensibles antes de morir)
      if (this.vault?.destroy) {
        try { await this.vault.destroy(); } catch (e) {}
        this.vault = null;
      }
      
      this.initialized = false;
      DEBUG.log('✅ [NAP-DESTROY] Recursos liberados completamente');
    } catch (err) {
      DEBUG.error(NAP_APP_ERRORS.APP_010, `Error en destroy: ${err.message}`);
    }
  }
  
  /**
   * NAP: Status report para debugging
   */
  getStatus() {
    return {
      initialized: this.initialized,
      destroyed: this.destroyed,
      currentPhase: this.currentPhase,
      hasVault: !!this.vault,
      hasMesh: !!this.mesh,
      hasWebSocket: !!this.wsClient,
      hasBridge: !!this.bridge,
      hasStream: !!this.stream,
      hasVirtualEngine: !!this.virtualEngine,
      identity: this.vault?.getIdentity?.() || null,
      lastError: this.initError?.message || null
    };
  }
}

export default NexoApp;
export { NAP_APP_ERRORS };
