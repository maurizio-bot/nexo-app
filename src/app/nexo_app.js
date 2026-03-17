/**
 * NEXO App v2.8-HYBRID (FIXED)
 * Integra HybridMesh (Nearby/BLE/Offline) + BLE Interface UI
 * FIX: Orden de inicialización y verificación de callbacks
 */

import { GestureEngine as CoreGestureEngine } from '../core/gesture_engine.js';
import { CryptoVault } from '../vault/crypto_vault.js';
import { HybridMesh } from '../mesh/hybrid_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { TheStream } from '../stream/the_stream.js';
import { rem } from '../ui/rem.js';
import { initBLEInterface } from '../ui/ble_interface.js';

const DEBUG = {
  rem: rem,
  log: (msg, type = 'info') => {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
    const method = type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warn' ? 'warn' : 'info';
    rem[method](msg, type === 'error' ? 'APP_ERR' : undefined);
    if (window.NEXO_DIAG?.log) window.NEXO_DIAG.log(msg, type);
  },
  error: (code, msg) => DEBUG.log(`[${code}] ${msg}`, 'error'),
  success: (msg) => DEBUG.log(msg, 'success'),
  warn: (msg) => DEBUG.log(msg, 'warn'),
  setPhase: (p) => rem.updatePhase(p),
  setMode: (m) => rem.updateMode(m),
  setIdentity: (id) => id && rem.updateIdentity(id)
};

async function withTimeout(promise, ms, errMsg) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errMsg)), ms))
  ]);
}

export class NexoApp {
  constructor(config = {}) {
    this.config = {
      relayUrls: config.relayUrls || [],
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      onMessage: config.onMessage || (() => {}),
      onStatusChange: config.onStatusChange || (() => {}),
      onError: config.onError || console.error,
      ...config
    };
    
    this.vault = null;
    this.mesh = null;
    this.wsClient = null;
    this.bridge = null;
    this.gestures = null;
    this.stream = null;
    this.vaultSlider = null;
    this.bleInterface = null;
    this.initialized = false;
    this.destroyed = false;
    
    DEBUG.log('🚀 [NEXO] App v2.8-HYBRID iniciando...');
  }
  
  async init() {
    if (this.initialized) return this;
    
    try {
      // FASE 1: CRYPTO
      DEBUG.setPhase('CRYPTO');
      DEBUG.log('🔐 [1/6] CryptoVault...');
      this.vault = new CryptoVault();
      await withTimeout(this.vault.init(), 5000, 'Crypto timeout');
      const identity = this.vault.getIdentity?.();
      if (identity) DEBUG.setIdentity(identity);
      DEBUG.log('✅ Vault listo', 'success');
    } catch (err) {
      DEBUG.warn(`⚠️ Vault: ${err.message}`);
    }
    
    // FASE 2: WEBSOCKET  
    try {
      DEBUG.setPhase('WEBSOCKET');
      DEBUG.log('🌐 [2/6] WebSocket...');
      if (this.config.relayUrls.length > 0) {
        this.wsClient = new WebSocketClient(this.config.relayUrls[0]);
        this.wsClient.onMessage = (m) => this._handleMessage(m, 'relay');
        this.wsClient.onOpen = () => {
          DEBUG.setMode('RELAY');
          DEBUG.log('🌐 WS Conectado', 'success');
        };
        await withTimeout(this.wsClient.connect(), 5000, 'WS timeout');
      }
    } catch (err) {
      DEBUG.warn(`⚠️ WebSocket: ${err.message}`);
    }
    
    // FASE 3: HYBRID MESH (FIX: Agregar callbacks antes de init)
    if (this.config.enableMesh) {
      try {
        DEBUG.setPhase('MESH');
        DEBUG.log('📡 [3/6] Hybrid Mesh (Nearby/BLE)...');
        
        // FIX: Crear mesh con callbacks inicializados
        this.mesh = new HybridMesh({
          serviceId: 'com.nexo.mesh.v1',
          deviceName: 'NEXO',
          maxPeers: 8,
          // FIX: Inicializar callbacks vacíos para compatibilidad con BLEInterface
          callbacks: {
            onDeviceFound: () => {},
            onDeviceConnected: () => {},
            onDeviceDisconnected: () => {},
            onError: () => {},
            onConnectionRequest: () => {}
          }
        });
        
        // FIX: Asegurar que callbacks existe después de crear instancia
        if (!this.mesh.callbacks) {
          this.mesh.callbacks = {
            onDeviceFound: () => {},
            onDeviceConnected: () => {},
            onDeviceDisconnected: () => {},
            onError: () => {}
          };
        }
        
        // Eventos del mesh (HybridMesh usa eventos, no callbacks directos)
        this.mesh.on('device', (device) => {
          DEBUG.log(`📡 Encontrado: ${device.name} [${device.mode || 'N/A'}]`);
          if (this.bleInterface?.handleDeviceFound) {
            this.bleInterface.handleDeviceFound(device);
          }
          this._updateStatus();
        });
        
        this.mesh.on('connect', (device) => {
          DEBUG.log(`🔗 Conectado: ${device.name} [${device.mode || 'N/A'}]`, 'success');
          DEBUG.setMode('P2P');
          if (this.bleInterface?.handleDeviceConnected) {
            this.bleInterface.handleDeviceConnected(device);
          }
          this._updateStatus();
        });
        
        this.mesh.on('disconnect', (id) => {
          DEBUG.log(`❌ Desconectado: ${id?.substr(0,8) || 'unknown'}`);
          if (this.bleInterface?.handleDeviceDisconnected) {
            this.bleInterface.handleDeviceDisconnected({ id });
          }
          this._updateStatus();
        });
        
        this.mesh.on('message', (msg, id) => this._handleMessage(msg, 'p2p'));
        this.mesh.on('error', (err) => DEBUG.warn(`Mesh error: ${err.message}`));
        this.mesh.on('scanning', (isScanning) => {
          if (this.bleInterface) {
            this.bleInterface.isScanning = isScanning;
            if (isScanning) this.bleInterface.startScanUI?.();
            else this.bleInterface.stopScanUI?.();
          }
        });
        
        await withTimeout(this.mesh.init(), 10000, 'Mesh init timeout');
        
        const status = this.mesh.getStatus();
        DEBUG.log(`✅ Mesh listo [Modo: ${status.mode.toUpperCase()}]`, 'success');
        
        if (status.mode !== 'offline') {
          this.mesh.startScan().catch(() => {});
        }
        
      } catch (err) {
        DEBUG.error('APP_016', `Mesh failed: ${err.message}`);
        this.mesh = null;
      }
    }
    
    // FASE 3.5: BLE INTERFACE UI (FIX: Verificar mesh y callbacks antes de inicializar)
    try {
      DEBUG.log('📱 [3.5/6] BLE Interface...');
      
      // FIX: Verificar que mesh existe y tiene la estructura necesaria
      if (this.mesh) {
        // FIX: Si mesh no tiene callbacks, crearlo
        if (!this.mesh.callbacks) {
          this.mesh.callbacks = {
            onDeviceFound: () => {},
            onDeviceConnected: () => {},
            onDeviceDisconnected: () => {},
            onError: () => {}
          };
        }
        
        // FIX: Pequeño delay para asegurar que mesh está completamente inicializado
        await new Promise(resolve => setTimeout(resolve, 100));
        
        this.bleInterface = initBLEInterface(this.mesh);
        
        if (this.bleInterface) {
          this.bleInterface.onDeviceConnected = (device) => {
            DEBUG.log(`UI: Conectado ${device.name}`, 'success');
          };
          
          this.bleInterface.onDeviceDisconnected = (device) => {
            DEBUG.log(`UI: Desconectado ${device.id?.substr(0,8)}`);
          };
          
          DEBUG.log('✅ Interface UI lista', 'success');
        } else {
          DEBUG.warn('⚠️ No se pudo inicializar BLE Interface');
        }
      } else {
        DEBUG.warn('⚠️ Mesh no disponible, UI BLE no inicializada');
      }
    } catch (err) {
      DEBUG.warn(`⚠️ Interface: ${err.message}`);
      console.error('[BLEInterface] Error:', err);
    }
    
    // FASE 4: BRIDGE
    try {
      DEBUG.setPhase('BRIDGE');
      DEBUG.log('🌉 [4/6] Bridge...');
      if (this.mesh || this.wsClient) {
        this.bridge = new MeshRelayBridge({
          mesh: this.mesh,
          relay: this.wsClient,
          onModeChange: (mode) => {
            DEBUG.setMode(mode);
            this.config.onStatusChange(mode);
          }
        });
        await this.bridge.init();
        DEBUG.log('✅ Bridge listo', 'success');
      }
    } catch (err) {
      DEBUG.warn(`⚠️ Bridge: ${err.message}`);
    }
    
    // FASE 5: GESTURES
    DEBUG.setPhase('GESTURES');
    DEBUG.log('👆 [5/6] Gestures...');
    if (this.config.enableGestures) {
      this.gestures = new GestureEngine({});
      this.gestures.init();
    }
    
    // FASE 5.5: VAULT SLIDER
    DEBUG.setPhase('VAULT_SLIDER');
    DEBUG.log('👆 [5.5/6] Vault Slider...');
    const streamEl = document.getElementById('nexo-stream');
    const vaultEl = document.getElementById('nexo-vault');
    if (streamEl && vaultEl) {
      this.vaultSlider = new CoreGestureEngine(streamEl, vaultEl);
      
      window.addEventListener('nexo:vault:opened', () => {
        DEBUG.log('[VAULT] Abierto', 'success');
        if (this.gestures?.disable) this.gestures.disable();
      });
      
      window.addEventListener('nexo:vault:closed', () => {
        DEBUG.log('[VAULT] Cerrado');
        if (this.gestures?.enable) this.gestures.enable();
      });
      
      document.addEventListener('nexo:ui:pauseGestures', () => {
        if (this.vaultSlider?.disable) this.vaultSlider.disable();
      });
      
      document.addEventListener('nexo:ui:resumeGestures', () => {
        if (this.vaultSlider?.enable) this.vaultSlider.enable();
      });
    }
    
    // FASE 6: STREAM
    DEBUG.setPhase('STREAM');
    DEBUG.log('📰 [6/6] Stream...');
    const container = document.getElementById('messages-container');
    if (container) {
      this.stream = new TheStream(container, {});
      DEBUG.log('✅ Stream listo', 'success');
    }
    
    this.initialized = true;
    DEBUG.setPhase('READY');
    DEBUG.log('🎉 NEXO v2.8-HYBRID Listo', 'success');
    
    const meshStatus = this.mesh?.getStatus();
    DEBUG.log(`Modo: ${meshStatus?.mode || 'N/A'} | Peers: ${meshStatus?.peerCount || 0}`);
    
    return this;
  }
  
  _handleMessage(msg, source) {
    if (this.destroyed) return;
    try {
      const enriched = { ...msg, _source: source, _ts: Date.now() };
      this.config.onMessage(enriched);
      if (this.stream) this.stream.appendItems([enriched]);
    } catch (err) {
      DEBUG.error('APP_005', err.message);
    }
  }
  
  _updateStatus() {
    if (!this.mesh) return;
    const status = this.mesh.getStatus();
    let mode = 'OFFLINE';
    if (status.peerCount > 0) mode = 'P2P';
    else if (this.wsClient?.isConnected?.()) mode = 'RELAY';
    
    DEBUG.setMode(mode);
    this.config.onStatusChange(mode);
    
    if (this.bleInterface?.updateStatus) {
      this.bleInterface.updateStatus();
    }
  }
  
  async sendMessage(msg) {
    if (!this.initialized || this.destroyed) return false;
    try {
      this._handleMessage({ ...msg, _own: true }, 'self');
      
      if (this.mesh?.getPeerCount() > 0) {
        await this.mesh.broadcast(msg);
        return true;
      }
      
      if (this.bridge) return await this.bridge.send(msg);
      if (this.wsClient) return this.wsClient.send(msg);
      
      return false;
    } catch (err) {
      DEBUG.error('APP_008', `Send: ${err.message}`);
      return false;
    }
  }
  
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    
    if (this.bleInterface) {
      try {
        this.bleInterface.destroy();
        DEBUG.log('🧹 BLE Interface destroyed');
      } catch (e) {
        console.error('Error destroying BLE Interface:', e);
      }
    }
    
    if (this.vaultSlider) this.vaultSlider.destroy?.();
    if (this.gestures) this.gestures.destroy?.();
    if (this.stream) this.stream.destroy?.();
    if (this.bridge) this.bridge.destroy?.();
    if (this.mesh) this.mesh.destroy();
    if (this.wsClient) this.wsClient.disconnect?.();
    if (this.vault) this.vault.destroy?.();
    
    DEBUG.log('🧹 Cleanup complete', 'success');
  }
  
  getStatus() {
    return {
      initialized: this.initialized,
      mode: this.mesh?.getStatus().mode || 'offline',
      peers: this.mesh?.getPeerCount() || 0,
      hasVault: !!this.vault,
      hasStream: !!this.stream,
      hasBLEInterface: !!this.bleInterface
    };
  }
}

export default NexoApp;
export { DEBUG };
