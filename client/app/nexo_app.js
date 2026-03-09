/**
 * NEXO App v2.3-debug-certified
 * Orquestador principal que une todos los módulos
 * 
 * FIXES:
 * - Optional chaining en getIdentity para evitar crashes
 * - Defaults en todos los callbacks
 * - Sistema de checkpoints visuales para debug Android
 * - Manejo de errores por fase (no bloquea todo si falla uno)
 * - Destroy completo con protección double-call
 */

import { CryptoVault } from '../core/crypto_vault.js';
import { BleMesh } from '../mesh/ble_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { VirtualEngine } from '../perf/virtual_engine.js';
import { TheStream } from '../stream/the_stream.js';

// Helper global para debug visual
const DEBUG = {
  log: (msg, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${msg}`);
    
    // Si existe el sistema de diagnóstico visual, usarlo
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
    // Configuración con defaults defensivos
    this.config = {
      relayUrls: config.relayUrls || [],
      bleTimeout: config.bleTimeout || 5000,
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      onMessage: config.onMessage || (() => {}),
      onStatusChange: config.onStatusChange || (() => {}),
      onError: config.onError || ((err) => console.error('NexoApp Error:', err))
    };
    
    // Referencias a módulos
    this.vault = null;
    this.mesh = null;
    this.wsClient = null;
    this.bridge = null;
    this.gestures = null;
    this.stream = null;
    this.virtualEngine = null;
    
    // Estado
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
      // FASE 1: CryptoVault (bloqueante - sin esto no hay app)
      this.currentPhase = 'CRYPTO';
      DEBUG.log('🔐 [init] Fase 1/6: CryptoVault...');
      
      this.vault = new CryptoVault();
      DEBUG.log('✓ CryptoVault instanciado');
      
      await this.vault.init();
      DEBUG.log('✓ CryptoVault.init() completado');
      
      // Verificar que getIdentity existe y funciona
      const identity = this.vault.getIdentity?.();
      if (!identity) {
        DEBUG.warn('⚠️ No se pudo obtener identidad, usando fallback');
      } else {
        DEBUG.log(`✓ Identity: ${identity.substring(0, 8)}...`);
      }
      
      // FASE 2: WebSocket Client (fallback siempre disponible)
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
        
        // Conectar pero no bloquear si falla
        try {
          await this.wsClient.connect();
          DEBUG.log('✓ WebSocketClient connected');
        } catch (wsErr) {
          DEBUG.warn(`⚠️ WebSocket failed: ${wsErr.message}`);
          // No es crítico, tenemos BLE mesh como alternativa
        }
      } else {
        DEBUG.log('⚠️ No relay URLs configured, skipping WebSocket');
      }
      
      // FASE 3: BLE Mesh (timeout controlado)
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
            },
            onError: (err) => {
              DEBUG.error(`Mesh error: ${err.message}`);
              this.config.onError(err);
            }
          });
          
          // Timeout para BLE (no bloquear app si no hay dispositivos cerca)
          const meshTimeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('BLE timeout')), this.config.bleTimeout)
          );
          
          await Promise.race([this.mesh.init(), meshTimeout]);
          DEBUG.log('✓ BleMesh initialized');
          
        } catch (meshErr) {
          DEBUG.warn(`⚠️ BLE Mesh failed: ${meshErr.message}`);
          this.mesh = null;
          // No es crítico, seguimos con WebSocket
        }
      } else {
        DEBUG.log('⚠️ BLE not available or disabled');
        this.mesh = null;
      }
      
      // FASE 4: Bridge (gestiona P2P vs Relay)
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
          onMessage: (msg) => this._handleMessage(msg, 'bridge'),
          onError: (err) => {
            DEBUG.error(`Bridge error: ${err.message}`);
          }
        });
        
        await this.bridge.init();
        DEBUG.log('✓ MeshRelayBridge initialized');
        
      } catch (bridgeErr) {
        DEBUG.warn(`⚠️ Bridge failed: ${bridgeErr.message}`);
        // No es crítico, seguimos funcionando sin bridge
        this.bridge = null;
      }
      
      // FASE 5: Gestures (UI táctil)
      this.currentPhase = 'GESTURES';
      DEBUG.log('👆 [init] Fase 5/6: GestureEngine...');
      
      if (this.config.enableGestures) {
        try {
          this.gestures = new GestureEngine({
            onSwipeLeft: () => this._navigate('back'),
            onSwipeRight: () => this._navigate('forward'),
            onSwipeUp: () => this._showMenu(),
            onSwipeDown: () => this._refresh(),
            onQuickAction: (action) => this._handleQuickAction(action)
          });
          
          this.gestures.init();
          DEBUG.log('✓ GestureEngine initialized');
          
        } catch (gestureErr) {
          DEBUG.warn(`⚠️ Gestures failed: ${gestureErr.message}`);
          this.gestures = null;
        }
      }
      
      // FASE 6: Stream (UI de mensajes)
      this.currentPhase = 'STREAM';
      DEBUG.log('📰 [init] Fase 6/6: TheStream...');
      
      try {
        const container = document.getElementById('messages-container');
        if (!container) {
          throw new Error('messages-container not found in DOM');
        }
        
        this.virtualEngine = new VirtualEngine({
          container: container,
          itemHeight: 80,
          bufferSize: 5
        });
        
        this.stream = new TheStream({
          container: container,
          virtualEngine: this.virtualEngine
        });
        
        DEBUG.log('✓ TheStream initialized');
        
      } catch (streamErr) {
        DEBUG.warn(`⚠️ Stream failed: ${streamErr.message}`);
        this.stream = null;
        this.virtualEngine = null;
      }
      
      this.initialized = true;
      this.currentPhase = 'READY';
      DEBUG.log('🎉 [init] ===== INICIALIZACIÓN COMPLETADA =====');
      DEBUG.log(`📊 Status: ${this._getStatusString()}`);
      
      // Notificar estado inicial
      this._updateStatus();
      
      return this;
      
    } catch (error) {
      this.initError = error;
      this.currentPhase = 'ERROR';
      DEBUG.error(`💥 [init] ERROR CRÍTICO: ${error.message}`);
      
      // Intentar cleanup parcial
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
        _id: (typeof crypto !== 'undefined' && crypto.randomUUID) 
          ? crypto.randomUUID() 
          : Math.random().toString(36).substr(2, 9)
      };
      
      // Agregar a stream si existe
      if (this.stream && this.stream.addItem) {
        this.stream.addItem(enriched);
      }
      
      // Notificar a callback
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
      
      // Enviar por bridge si existe
      let sent = false;
      if (this.bridge && typeof this.bridge.send === 'function') {
        sent = this.bridge.send(enriched);
      }
      
      // Fallback directo a WebSocket si bridge no existe o falló
      if (!sent && this.wsClient?.send) {
        sent = this.wsClient.send(enriched);
      }
      
      // Agregar a stream local
      this._handleMessage(enriched, 'self');
      
      return sent;
      
    } catch (err) {
      DEBUG.error(`Error sending message: ${err.message}`);
      return false;
    }
  }
  
  _navigate(direction) {
    DEBUG.log(`Navigate: ${direction}`);
    // Implementar navegación entre vistas aquí
    if (direction === 'back' && typeof history !== 'undefined') {
      history.back();
    }
  }
  
  _showMenu() {
    DEBUG.log('Show menu');
    // Implementar menú contextual aquí
    // Por ejemplo: mostrar modal de opciones
  }
  
  _refresh() {
    DEBUG.log('Refresh');
    if (this.stream && typeof this.stream.refresh === 'function') {
      this.stream.refresh();
    }
  }
  
  _handleQuickAction(action) {
    DEBUG.log(`Quick action: ${action}`);
    // Implementar acciones rápidas aquí
  }
  
  // Cleanup parcial en caso de error durante init
  async _partialCleanup() {
    DEBUG.log('🧹 [cleanup] Limpiando recursos parciales...');
    
    if (this.gestures && typeof this.gestures.destroy === 'function') {
      try { this.gestures.destroy(); } catch (e) {}
      this.gestures = null;
    }
    
    if (this.bridge && typeof this.bridge.destroy === 'function') {
      try { await this.bridge.destroy(); } catch (e) {}
      this.bridge = null;
    }
    
    if (this.mesh && typeof this.mesh.destroy === 'function') {
      try { await this.mesh.destroy(); } catch (e) {}
      this.mesh = null;
    }
    
    if (this.wsClient && typeof this.wsClient.disconnect === 'function') {
      try { await this.wsClient.disconnect(); } catch (e) {}
      this.wsClient = null;
    }
  }
  
  async destroy() {
    if (this.destroyed) {
      DEBUG.log('Already destroyed');
      return;
    }
    
    this.destroyed = true;
    DEBUG.log('🧹 [destroy] Limpiando recursos...');
    
    // Limpiar en orden inverso
    if (this.gestures && typeof this.gestures.destroy === 'function') {
      try { this.gestures.destroy(); } catch (e) {}
      this.gestures = null;
      DEBUG.log('✓ Gestures destroyed');
    }
    
    if (this.stream && typeof this.stream.destroy === 'function') {
      try { this.stream.destroy(); } catch (e) {}
      this.stream = null;
      DEBUG.log('✓ Stream destroyed');
    }
    
    if (this.virtualEngine && typeof this.virtualEngine.destroy === 'function') {
      try { this.virtualEngine.destroy(); } catch (e) {}
      this.virtualEngine = null;
    }
    
    if (this.bridge && typeof this.bridge.destroy === 'function') {
      try { await this.bridge.destroy(); } catch (e) {}
      this.bridge = null;
      DEBUG.log('✓ Bridge destroyed');
    }
    
    if (this.mesh && typeof this.mesh.destroy === 'function') {
      try { await this.mesh.destroy(); } catch (e) {}
      this.mesh = null;
      DEBUG.log('✓ Mesh destroyed');
    }
    
    if (this.wsClient && typeof this.wsClient.disconnect === 'function') {
      try { await this.wsClient.disconnect(); } catch (e) {}
      this.wsClient = null;
      DEBUG.log('✓ WebSocket disconnected');
    }
    
    if (this.vault && typeof this.vault.destroy === 'function') {
      try { 
        // FIX: Limpiar identity antes de await para evitar race condition
        if (this.vault.identity) {
          this.vault.identity = null;
        }
        await this.vault.destroy(); 
      } catch (e) {}
      this.vault = null;
      DEBUG.log('✓ Vault destroyed');
    }
    
    this.initialized = false;
    DEBUG.log('✅ [destroy] Recursos liberados');
  }
  
  // Getters útiles para debug
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

// Export default también para compatibilidad
export default NexoApp;
