/**
 * hybrid_mesh.js - NEXO Hybrid Mesh v2.1 (FIX #6 - Callbacks Constructor)
 * Sistema de mesh híbrido: BLE + WebSocket + LAN
 * FIX: Procesa callbacks onDeviceFound/onDeviceConnected/onDeviceDisconnected/onError en constructor
 */

export class HybridMesh {
  constructor(options = {}) {
    this._listeners = new Map();
    this.peers = new Map();
    this.isInitialized = false;
    this.isScanning = false;
    this.config = {};
    this.nordicMesh = null;
    this.wsConnection = null;
    this.status = 'offline';
    
    // FIX: Guardar callbacks del constructor y registrarlos tras inicialización
    this._callbacks = {
      onDeviceFound: options.onDeviceFound || (() => {}),
      onDeviceConnected: options.onDeviceConnected || (() => {}),
      onDeviceDisconnected: options.onDeviceDisconnected || (() => {}),
      onError: options.onError || (() => {})
    };
  }

  /**
   * Inicializa el sistema de mesh híbrido
   */
  async initialize(config = {}) {
    console.log('[MESH_001] Initializing Hybrid Mesh...');
    this.config = {
      enableBLE: true,
      enableWebSocket: true,
      enableLAN: false,
      scanTimeout: 30000,
      ...config
    };

    try {
      // Registrar callbacks del constructor como listeners
      this.on('device', (data) => this._callbacks.onDeviceFound(data));
      this.on('connected', (data) => this._callbacks.onDeviceConnected(data));
      this.on('disconnected', (data) => this._callbacks.onDeviceDisconnected(data));
      this.on('error', (data) => this._callbacks.onError(data.code || 'MESH_ERR', data.message || String(data)));

      // Inicializar Nordic Mesh (BLE) si está disponible
      if (this.config.enableBLE && window.NordicMesh) {
        this.nordicMesh = window.NordicMesh;
        this.nordicMesh.setListener(this._handleNordicEvent.bind(this));
        console.log('[MESH_002] Nordic Mesh registered');
      }

      // Inicializar WebSocket si está configurado
      if (this.config.enableWebSocket && window.WebSocketManager) {
        this.wsConnection = window.WebSocketManager;
        this.wsConnection.onMessage(this._handleWSMessage.bind(this));
      }

      this.isInitialized = true;
      this.status = 'ready';
      this._emit('initialized', { status: 'ready', timestamp: Date.now() });
      this._emit('ready', {});
      
      console.log('[MESH_003] Hybrid Mesh initialized successfully');
      return true;
      
    } catch (error) {
      console.error('[MESH_ERROR] Initialization failed:', error);
      this._emit('error', { code: 'INIT_FAILED', message: error.message });
      throw error;
    }
  }

  /**
   * Sistema de eventos: Registra callback
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    
    return () => {
      this._listeners.get(event)?.delete(callback);
    };
  }

  off(event, callback) {
    if (!this._listeners.has(event)) return;
    this._listeners.get(event).delete(callback);
  }

  _emit(event, data) {
    if (!this._listeners.has(event)) return;
    this._listeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        console.error(`[MESH_EVENT_ERROR] ${event}:`, e);
      }
    });
  }

  /**
   * FIX: Método explícito requerido por nexo_app.js línea 312
   */
  getPeerCount() {
    return this.peers.size;
  }

  /**
   * FIX: Alias para broadcast (nexo_app.js línea 315 usa broadcast)
   */
  broadcast(data) {
    return this.send(data, null);
  }

  /**
   * Inicia escaneo de dispositivos BLE y WebSocket
   */
  async startScan() {
    if (!this.isInitialized) {
      throw new Error('[APP_016] Hybrid Mesh not initialized. Call initialize() first');
    }

    console.log('[MESH_SCAN] Starting scan...');
    this.isScanning = true;
    this.status = 'scanning';
    this._emit('scanning', { active: true });

    try {
      if (this.nordicMesh && this.nordicMesh.startScan) {
        await this.nordicMesh.startScan();
      }

      if (this.wsConnection && this.wsConnection.connect) {
        this.wsConnection.connect();
      }

      setTimeout(() => {
        if (this.isScanning) this.stopScan();
      }, this.config.scanTimeout);

    } catch (error) {
      console.error('[MESH_SCAN_ERROR]', error);
      this.isScanning = false;
      throw error;
    }
  }

  async stopScan() {
    console.log('[MESH_SCAN] Stopping scan...');
    this.isScanning = false;
    this.status = 'ready';
    
    if (this.nordicMesh && this.nordicMesh.stopScan) {
      await this.nordicMesh.stopScan();
    }
    
    this._emit('scanning', { active: false });
  }

  async connect(peerId) {
    console.log(`[MESH_CONNECT] Connecting to ${peerId}...`);
    
    try {
      if (this.nordicMesh && this.nordicMesh.connect) {
        await this.nordicMesh.connect(peerId);
        this._registerPeer(peerId, { type: 'ble', status: 'connecting' });
        return;
      }

      if (this.wsConnection) {
        this._registerPeer(peerId, { type: 'ws', status: 'connecting' });
        this.wsConnection.send({ type: 'connect', target: peerId });
      }

    } catch (error) {
      console.error(`[MESH_CONNECT_ERROR] ${peerId}:`, error);
      this._emit('error', { code: 'CONNECT_FAILED', peerId, message: error.message });
      throw error;
    }
  }

  async disconnect(peerId) {
    console.log(`[MESH_DISCONNECT] ${peerId}`);
    
    if (this.nordicMesh && this.nordicMesh.disconnect) {
      await this.nordicMesh.disconnect(peerId);
    }
    
    this.peers.delete(peerId);
    this._emit('disconnected', { peerId });
  }

  /**
   * Envía mensaje a un peer específico o broadcast (peerId = null)
   */
  send(data, peerId = null) {
    const payload = {
      id: this._generateId(),
      timestamp: Date.now(),
      data: data
    };

    if (peerId) {
      const peer = this.peers.get(peerId);
      if (!peer) throw new Error(`Peer ${peerId} not found`);

      if (peer.type === 'ble' && this.nordicMesh) {
        this.nordicMesh.send(peerId, JSON.stringify(payload));
      } else if (peer.type === 'ws' && this.wsConnection) {
        this.wsConnection.send({ ...payload, target: peerId });
      }
    } else {
      // Broadcast a todos los peers
      this.peers.forEach((peer, id) => {
        this.send(data, id);
      });
    }
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      scanning: this.isScanning,
      status: this.status,
      peerCount: this.peers.size,
      peers: Array.from(this.peers.keys()),
      mode: this.status // Compatibilidad con nexo_app.js
    };
  }

  _registerPeer(peerId, info) {
    this.peers.set(peerId, {
      id: peerId,
      connectedAt: Date.now(),
      ...info
    });
    this._emit('peer_connected', { peerId, ...info });
    this._emit('connected', { peerId, ...info });
  }

  _handleNordicEvent(event) {
    console.log('[NORDIC_EVENT]', event);
    
    switch(event.type) {
      case 'device_found':
        this._emit('device', event.data);
        break;
      case 'connected':
        this._registerPeer(event.peerId, { type: 'ble', rssi: event.rssi });
        break;
      case 'disconnected':
        this.peers.delete(event.peerId);
        this._emit('disconnected', { peerId: event.peerId });
        break;
      case 'data':
        this._emit('message', {
          peerId: event.peerId,
          data: event.data
        });
        break;
      case 'error':
        this._emit('error', { code: 'NORDIC_ERROR', ...event });
        break;
    }
  }

  _handleWSMessage(message) {
    if (message.type === 'peer_discovery') {
      this._emit('device', {
        id: message.peerId,
        name: message.name,
        type: 'ws',
        endpointId: message.peerId
      });
    } else if (message.type === 'data') {
      this._emit('message', message);
    }
  }

  _generateId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  destroy() {
    this.stopScan();
    this._listeners.clear();
    this.peers.clear();
    this.isInitialized = false;
    this.status = 'offline';
    console.log('[MESH] Destroyed');
  }
}

// Exports compatibles
export const hybridMesh = new HybridMesh();
export default HybridMesh;
export { HybridMesh as BLEInterface };
export const BLEInterface = HybridMesh;

// Globals
window.HybridMesh = HybridMesh;
window.hybridMesh = hybridMesh;
window.BLEInterface = HybridMesh;
