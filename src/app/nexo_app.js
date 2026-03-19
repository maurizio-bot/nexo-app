/**
 * NEXO App v3.2 - Con NordicMesh BLE Protocol
 */

import { GestureEngine as CoreGestureEngine } from '../core/gesture_engine.js';
import { CryptoVault } from '../vault/crypto_vault.js';
import { HybridMesh } from '../mesh/hybrid_mesh.js';
import { NordicMesh } from '../mesh/nordic_mesh.js'; // NUEVO
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
    this.nordicMesh = null; // NUEVO: NordicMesh BLE
    this.blePeers = new Map(); // NUEVO: peers Nordic descubiertos
    this.wsClient = null;
    this.bridge = null;
    this.gestures = null;
    this.stream = null;
    this.vaultSlider = null;
    this.bleInterface = null;
    this.initialized = false;
    this.destroyed = false;

    DEBUG.log('🚀 [NEXO] v3.2 iniciando...');
  }

  async init() {
    if (this.initialized) return this;

    // FASE 1: CRYPTO
    try {
      DEBUG.setPhase('CRYPTO');
      DEBUG.log('🔐 [1/7] Vault...');
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
      DEBUG.log('🌐 [2/7] WebSocket...');
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

    // FASE 3: NORDIC MESH (NUEVO - BLE Protocol v1.0)
    if (this.config.enableMesh) {
      try {
        DEBUG.setPhase('NORDIC_MESH');
        DEBUG.log('📡 [3/7] Nordic Mesh BLE...');
        
        this.nordicMesh = new NordicMesh(this.vault, {
          rssiThreshold: -85,
          chunkSize: 507,
          handshakeTimeout: 30000,
          messageTimeout: 300000
        });
        
        // Event listeners Nordic
        this.nordicMesh.on((event, data) => {
          switch(event) {
            case 'peerDiscovered':
              this._handleNordicPeer(data);
              break;
            case 'sessionEstablished':
              this._handleNordicSession(data);
              break;
            case 'messageReceived':
              this._handleNordicMessage(data);
              break;
            case 'stateChanged':
              this._updateModeFromNordic(data.to);
              break;
            case 'error':
              DEBUG.error('NORDIC_ERR', data.error?.message || 'Unknown');
              break;
          }
        });
        
        const success = await this.nordicMesh.init();
        if (success) {
          // Auto-discovery si estamos offline
          if (!this.wsClient?.isConnected?.()) {
            await this.nordicMesh.startDiscovery();
          }
          DEBUG.log('✅ Nordic Mesh activo', 'success');
        } else {
          DEBUG.warn('⚠️ Nordic Mesh no inicializó');
        }
      } catch (err) {
        DEBUG.warn(`⚠️ Nordic Mesh: ${err.message}`);
        // No fallar - continuar con HybridMesh como fallback
      }
    }

    // FASE 4: HYBRID MESH (Legacy - como fallback)
    if (this.config.enableMesh) {
      try {
        DEBUG.setPhase('MESH');
        DEBUG.log('📡 [4/7] Hybrid Mesh...');

        this.mesh = new HybridMesh({
          serviceId: 'com.nexo.mesh.v1',
          deviceName: 'NEXO',
          maxPeers: 8,
          callbacks: {
            onDeviceFound: () => {},
            onDeviceConnected: () => {},
            onDeviceDisconnected: () => {},
            onError: (code, msg) => {
              if (code === 'PERMISOS' || msg?.includes('GPS')) {
                DEBUG.error('BLE_PERM', msg);
              }
            }
          }
        });

        this.mesh.on('device', (device) => {
          DEBUG.log(`📡 Encontrado: ${device.name}`);
          if (this.bleInterface?.handleDeviceFound) {
            this.bleInterface.handleDeviceFound(device);
          }
          this._updateStatus();
        });

        this.mesh.on('connect', (device) => {
          DEBUG.log(`🔗 Conectado: ${device.name}`, 'success');
          DEBUG.setMode('P2P');
          if (this.bleInterface?.handleDeviceConnected) {
            this.bleInterface.handleDeviceConnected(device);
          }
          this._updateStatus();
        });

        this.mesh.on('disconnect', (id) => {
          DEBUG.log(`❌ Desconectado: ${id?.substr(0,8)}`);
          if (this.bleInterface?.handleDeviceDisconnected) {
            this.bleInterface.handleDeviceDisconnected({ id });
          }
          this._updateStatus();
        });

        this.mesh.on('error', (err) => {
          DEBUG.error('MESH_ERR', err.message);
        });

        await withTimeout(this.mesh.init(), 15000, 'Mesh init timeout');
        
        const status = this.mesh.getStatus();
        DEBUG.log(`✅ Hybrid Mesh [${status.mode.toUpperCase()}]`, 'success');

        if (status.mode === 'offline') {
          DEBUG.warn('⚠️ BLE no disponible. Verifica GPS y Permisos');
        }

      } catch (err) {
        DEBUG.error('APP_016', `Mesh: ${err.message}`);
      }
    }

    // FASE 5: BLE INTERFACE
    try {
      DEBUG.log('📱 [5/7] BLE UI...');
      if (this.mesh || this.nordicMesh) {
        this.bleInterface = initBLEInterface(this.mesh || this.nordicMesh);
        if (this.bleInterface) {
          DEBUG.log('✅ UI lista', 'success');
        }
      }
    } catch (err) {
      DEBUG.warn(`⚠️ UI: ${err.message}`);
    }

    // FASE 6: BRIDGE
    try {
      DEBUG.setPhase('BRIDGE');
      DEBUG.log('🌉 [6/7] Bridge...');
      if (this.mesh || this.wsClient || this.nordicMesh) {
        this.bridge = new MeshRelayBridge({
          mesh: this.mesh,
          nordicMesh: this.nordicMesh, // Pasar nordic al bridge
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

    // FASE 7: GESTURES + VAULT + STREAM
    DEBUG.setPhase('GESTURES');
    if (this.config.enableGestures) {
      this.gestures = new GestureEngine({});
      this.gestures.init();
    }

    DEBUG.setPhase('VAULT_SLIDER');
    const streamEl = document.getElementById('nexo-stream');
    const vaultEl = document.getElementById('nexo-vault');
    if (streamEl && vaultEl) {
      this.vaultSlider = new CoreGestureEngine(streamEl, vaultEl);
    }

    DEBUG.setPhase('STREAM');
    const container = document.getElementById('messages-container');
    if (container) {
      this.stream = new TheStream(container, {});
    }

    this.initialized = true;
    DEBUG.setPhase('READY');
    DEBUG.log('🎉 NEXO v3.2 Listo', 'success');

    const status = this.mesh?.getStatus();
    const nordicStatus = this.nordicMesh?.getState?.();
    DEBUG.log(`Modo: ${status?.mode || nordicStatus || 'N/A'} | Peers: ${status?.peerCount || 0} | Nordic: ${this.nordicMesh?.getPeers?.().length || 0}`);

    return this;
  }

  // NUEVOS HANDLERS NORDIC
  _handleNordicPeer(peer) {
    DEBUG.log(`🔷 Nordic Peer: ${peer.name} (${peer.rssi}dBm)`, 'info');
    this.blePeers.set(peer.id, peer);
    
    // Actualizar UI si existe
    if (this.bleInterface?.addPeer) {
      this.bleInterface.addPeer(peer);
    }
    
    // Auto-conectar si es un peer conocido? (opcional)
    // this.nordicMesh.connect(peer.id);
  }

  _handleNordicSession(data) {
    DEBUG.success(`🔐 Sesión BLE: ${data.deviceId.substr(0,8)}`);
    this._updateMode('P2P_BLE');
    
    // Notificar a UI
    if (this.bleInterface?.onSessionEstablished) {
      this.bleInterface.onSessionEstablished(data);
    }
  }

  _handleNordicMessage(msg) {
    DEBUG.log(`📨 BLE msg from ${msg.deviceId.substr(0,8)}`);
    
    // Enrutar al stream como mensaje normal
    this._handleMessage({
      content: msg.content,
      sender: msg.deviceId,
      source: 'ble_nordic',
      timestamp: msg.timestamp
    }, 'ble_nordic');
  }

  _updateModeFromNordic(state) {
    switch(state) {
      case 'messaging':
        this._updateMode('P2P_BLE');
        break;
      case 'connected':
        this._updateMode('P2P_BLE');
        break;
      case 'offline':
        // Solo volver a offline si no hay otros modos activos
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
      this.bleInterface.updateStatus();
    }
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
    if (!this.mesh && !this.nordicMesh) return;
    
    const hybridStatus = this.mesh?.getStatus?.();
    const nordicPeers = this.nordicMesh?.getPeers?.() || [];
    
    let mode = 'OFFLINE';
    if ((hybridStatus?.peerCount || 0) > 0 || nordicPeers.length > 0) {
      mode = 'P2P';
    } else if (this.wsClient?.isConnected?.()) {
      mode = 'RELAY';
    }
    
    if (nordicPeers.length > 0 && !hybridStatus?.peerCount) {
      mode = 'P2P_BLE'; // Específico Nordic
    }

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
      
      // Prioridad 1: NordicMesh si hay peers
      if (this.nordicMesh?.getPeers?.().length > 0) {
        // Enviar al último peer conectado o broadcast
        const lastPeer = this.nordicMesh.getPeers()[0];
        await this.nordicMesh.sendMessage(lastPeer.id, msg.content || msg);
        return true;
      }
      
      // Prioridad 2: HybridMesh
      if (this.mesh?.getPeerCount?.() > 0) {
        await this.mesh.broadcast(msg);
        return true;
      }
      
      // Prioridad 3: Bridge o WebSocket
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
    
    if (this.bleInterface) this.bleInterface.destroy();
    if (this.vaultSlider) this.vaultSlider.destroy?.();
    if (this.gestures) this.gestures.destroy?.();
    if (this.stream) this.stream.destroy?.();
    if (this.bridge) this.bridge.destroy?.();
    if (this.nordicMesh) this.nordicMesh.destroy?.(); // NUEVO
    if (this.mesh) this.mesh.destroy();
    if (this.wsClient) this.wsClient.disconnect?.();
    if (this.vault) this.vault.destroy?.();
    
    DEBUG.log('🧹 Cleanup complete', 'success');
  }

  getStatus() {
    return {
      initialized: this.initialized,
      mode: this.mesh?.getStatus().mode || this.nordicMesh?.getState() || 'offline',
      peers: this.mesh?.getPeerCount?.() || 0,
      nordicPeers: this.nordicMesh?.getPeers?.().length || 0,
      hasBLEInterface: !!this.bleInterface,
      hasNordic: !!this.nordicMesh
    };
  }
}

export default NexoApp;
export { DEBUG };
