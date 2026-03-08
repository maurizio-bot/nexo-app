/**
 * NEXO App v2.2-NAP
 * Orquestador principal - FIXES APLICADOS (2 bugs mínimos)
 */

import { CryptoVault } from '../core/crypto_vault.js';
import { FenixBackup } from '../fenix/fenix_backup.js';
import { BleMesh } from '../mesh/ble_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { VirtualEngine } from '../perf/virtual_engine.js';
import { TheStream } from '../stream/the_stream.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { PulseAlgorithm } from '../stream/pulse_algorithm.js';


class NexoApp {
  constructor(config = {}) {
    this.config = {
      relayUrls: config.relayUrls || ['wss://relay.nexo.app/ws'],
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      enableFenix: config.enableFenix !== false,
      onStatusChange: config.onStatusChange || (() => {}),
      onMessage: config.onMessage || (() => {}),
      onError: config.onError || (() => {}),
      container: config.container || document.body
    };

    this.state = {
      initialized: false,
      destroyed: false,
      connectionMode: 'OFFLINE',
      identity: null,
      stats: {
        messagesSent: 0,
        messagesReceived: 0,
        bytesTransferred: 0
      }
    };

    this.modules = {
      vault: null,
      fenix: null,
      mesh: null,
      relay: null,
      bridge: null,
      virtualEngine: null,
      stream: null,
      gestures: null,
      pulse: null
    };
  }

  async init() {
    if (this.state.initialized) {
      throw new Error('NAP-ERROR: App ya inicializada');
    }
    if (this.state.destroyed) {
      throw new Error('NAP-ERROR: App destruida');
    }

    try {
      console.log('[NexoApp] 🚀 Iniciando...');
      await this._initCrypto();
      if (this.config.enableFenix) await this._initFenix();
      await this._initNetwork();
      await this._initUI();
      
      this.state.initialized = true;
      console.log('[NexoApp] ✅ Listo');
      return true;
    } catch (error) {
      console.error('[NexoApp] ❌ Error:', error);
      this.config.onError(error);
      await this.destroy();
      throw error;
    }
  }

  async _initCrypto() {
    console.log('[NexoApp] 🔐 CryptoVault...');
    this.modules.vault = new CryptoVault({
      dbName: 'nexo_vault_v2',
      onError: (e) => this.config.onError(e)
    });
    await this.modules.vault.init();
    this.state.identity = await this.modules.vault.getIdentity();
    console.log('[NexoApp] 🔐 OK:', this.state.identity?.publicKey?.slice(0, 8) + '...');
  }

  async _initFenix() {
    console.log('[NexoApp] 🦅 Fénix...');
    this.modules.fenix = new FenixBackup({
      vault: this.modules.vault,
      shardCount: 5,
      threshold: 3
    });
    const hasBackup = await this.modules.fenix.checkExistingBackup();
    if (!hasBackup) await this.modules.fenix.createBackup();
  }

  async _initNetwork() {
    console.log('[NexoApp] 🌐 Red...');
    
    this.modules.relay = new WebSocketClient({
      urls: this.config.relayUrls,
      onConnect: () => this._updateConnectionMode(),
      onDisconnect: () => this._updateConnectionMode(),
      onError: (e) => this.config.onError(e)
    });

    try {
      await this.modules.relay.connect();
    } catch (e) {
      console.warn('[NexoApp] Relay inicial falló, reintentará...');
    }

    if (this.config.enableMesh && 'bluetooth' in navigator) {
      try {
        this.modules.mesh = new BleMesh({
          serviceUUID: '0x1812',
          onPeerConnect: (peer) => {
            console.log('[Mesh] Peer:', peer.id);
            this._updateConnectionMode();
          },
          onPeerDisconnect: (peer) => {
            console.log('[Mesh] Desconectado:', peer.id);
            this._updateConnectionMode();
          },
          onMessage: (msg, peer) => this._handleIncomingMessage(msg, 'ble', peer)
        });
        await this.modules.mesh.init();
      } catch (e) {
        console.warn('[NexoApp] BLE no disponible:', e.message);
        this.modules.mesh = null;
      }
    }

    this.modules.bridge = new MeshRelayBridge({
      mesh: this.modules.mesh,
      relay: this.modules.relay,
      onModeChange: (mode) => {
        this.state.connectionMode = mode;
        this.config.onStatusChange(mode);
        console.log('[NexoApp] 🔄 Modo:', mode);
      },
      onMessage: (msg) => this._handleIncomingMessage(msg, 'bridge')
    });
    
    // FIX 2.2: Bridge init con manejo de error aislado (no afecta init general)
    try {
      this.modules.bridge.init();
    } catch (e) {
      console.warn('[NexoApp] Bridge init warning:', e.message);
      // Continuar sin bridge es aceptable, relay sigue funcionando
    }
  }

  async _initUI() {
    console.log('[NexoApp] 🎨 UI...');
    const container = this.config.container.querySelector('#stream-container') || this.config.container;
    
    this.modules.virtualEngine = new VirtualEngine(container, {
      itemHeight: 120,
      bufferSize: 3,
      renderItem: (index) => this._renderStreamItem(index)
    });
    
    this.modules.pulse = new PulseAlgorithm({
      decayFactor: 0.95,
      proximityWeight: 0.3,
      engagementWeight: 0.7
    });
    
    this.modules.stream = new TheStream({
      virtualEngine: this.modules.virtualEngine,
      pulse: this.modules.pulse,
      onItemTap: (item) => this._handleItemTap(item),
      onItemLongPress: (item) => this._handleItemLongPress(item)
    });
    
    if (this.config.enableGestures) {
      this.modules.gestures = new GestureEngine(this.config.container, {
        onSwipeLeft: () => this._navigate('next'),
        onSwipeRight: () => this._navigate('prev'),
        onSwipeUp: () => this._openMenu(),
        onSwipeDown: () => this._refresh(),
        edgeThreshold: 20
      });
    }
  }

  _handleIncomingMessage(msg, source, peer = null) {
    if (!msg || typeof msg !== 'object') {
      console.warn('[NexoApp] Mensaje inválido');
      return;
    }
    msg._source = source;
    msg._receivedAt = Date.now();
    msg._peerId = peer?.id || null;
    
    this.state.stats.messagesReceived++;
    this.state.stats.bytesTransferred += JSON.stringify(msg).length;
    
    switch (msg.type) {
      case 'chat':
      case 'text':
        this.modules.stream?.addMessage(msg);
        break;
      case 'signal':
        this.modules.mesh?.handleSignal(msg);
        break;
      case 'pulse':
        this.modules.pulse?.updateEngagement(msg.payload);
        break;
      default:
        this.config.onMessage(msg);
    }
  }

  async sendMessage(data) {
    if (!this.state.initialized || this.state.destroyed) {
      throw new Error('NAP-ERROR: App no inicializada');
    }
    if (!this.modules.bridge) {
      throw new Error('NAP-ERROR: Bridge no disponible');
    }
    
    const enriched = {
      ...data,
      _senderId: this.state.identity?.publicKey,
      _timestamp: Date.now(),
      _version: '2.2'
    };
    
    try {
      const routes = await this.modules.bridge.send(enriched);
      this.state.stats.messagesSent++;
      return { success: true, routes };
    } catch (error) {
      console.warn('[NexoApp] Sin conexión, encolando...');
      if (this.modules.stream?.addToOfflineQueue) {
        this.modules.stream.addToOfflineQueue(enriched);
      }
      throw error;
    }
  }

  _updateConnectionMode() {
    const hasMesh = this.modules.mesh && this.modules.mesh.peers && this.modules.mesh.peers.size > 0;
    const hasRelay = this.modules.relay && this.modules.relay.connected;
    
    let mode = 'OFFLINE';
    if (hasMesh && hasRelay) mode = 'HYBRID';
    else if (hasMesh) mode = 'BLE';
    else if (hasRelay) mode = 'RELAY';
    
    if (mode !== this.state.connectionMode) {
      this.state.connectionMode = mode;
      this.config.onStatusChange(mode);
    }
  }

  _renderStreamItem(index) { 
    return `<div class="item-${index}">Item ${index}</div>`; 
  }
  _handleItemTap(item) { console.log('Tap:', item); }
  _handleItemLongPress(item) { console.log('LongPress:', item); }
  _navigate(direction) { console.log('Nav:', direction); }
  _openMenu() { console.log('Menu'); }
  _refresh() { this.modules.stream?.refresh(); }

  getStatus() {
    return {
      initialized: this.state.initialized,
      mode: this.state.connectionMode,
      identity: this.state.identity?.publicKey,
      stats: { ...this.state.stats },
      modules: {
        vault: !!this.modules.vault,
        mesh: !!this.modules.mesh,
        relay: this.modules.relay?.connected || false,
        bridge: this.modules.bridge?.mode || 'OFFLINE'
      }
    };
  }

  async destroy() {
    if (this.state.destroyed) return;
    console.log('[NexoApp] 💀 Destruyendo...');
    this.state.destroyed = true;
    
    if (this.modules.gestures) {
      this.modules.gestures.destroy?.();
      this.modules.gestures = null;
    }
    if (this.modules.stream) {
      this.modules.stream.destroy?.();
      this.modules.stream = null;
    }
    if (this.modules.virtualEngine) {
      this.modules.virtualEngine.destroy?.();
      this.modules.virtualEngine = null;
    }
    if (this.modules.bridge) {
      this.modules.bridge.destroy?.();
      this.modules.bridge = null;
    }
    if (this.modules.mesh) {
      this.modules.mesh.destroy?.();
      this.modules.mesh = null;
    }
    if (this.modules.relay) {
      this.modules.relay.disconnect?.();
      this.modules.relay = null;
    }
    if (this.modules.fenix) {
      this.modules.fenix.destroy?.();
      this.modules.fenix = null;
    }
    
    // FIX 2.3: Limpiar identidad ANTES del await de vault.destroy (seguridad)
    // y capturar error de vault.destroy sin afectar el resto del cleanup
    if (this.modules.vault) {
      const vaultRef = this.modules.vault;
      this.modules.vault = null; // Limpiar referencia primero
      this.state.identity = null; // Limpiar identidad inmediatamente
      
      try {
        await vaultRef.destroy?.();
      } catch (e) {
        console.warn('[NexoApp] Vault destroy warning:', e.message);
        // Continuar limpieza de todas formas
      }
    }
    
    this.state.identity = null; // Doble seguridad
  }
}

export default NexoApp;
if (typeof window !== 'undefined') window.NexoApp = NexoApp;
