/**
 * hybrid_mesh.js - NEXO Hybrid Mesh v2.1 (FIX #4)
 * Sistema de mesh híbrido: BLE + WebSocket + LAN
 * FIX: Agregado initialize(), métodos de control, y sistema de eventos completo
 */

export class HybridMesh {
  constructor() {
    this._listeners = new Map();
    this.peers = new Map();
    this.isInitialized = false;
    this.isScanning = false;
    this.config = {};
    this.nordicMesh = null;
    this.wsConnection = null;
    this.status = 'offline';
  }

  /**
   * FIX CRÍTICO: Método initialize requerido por NexoApp v3.3.1
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
      // Inicializar Nordic Mesh (BLE) si está disponible
      if (this.config.enableBLE && window.NordicMesh) {
        this.nordicMesh = window.NordicMesh;
        // FIX [NORDIC_005]: Pasar listener obligatorio
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
    
    // Retornar función de unsubscribe
    return () => {
      this._listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Sistema de eventos: Elimina callback
   */
  off(event, callback) {
    if (!this._listeners.has(event)) return;
    this._listeners.get(event).delete(callback);
  }

  /**
   * Emite eventos a los listeners registrados
   */
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
      // Escanear Nordic/BLE
      if (this.nordicMesh && this.nordicMesh.startScan) {
        await this.nordicMesh.startScan();
      }

      // Anunciar en WebSocket/LAN si está disponible
      if (this.wsConnection && this.wsConnection.connect) {
        this.wsConnection.connect();
      }

      // Timeout automático
      setTimeout(() => {
        if (this.isScanning) this.stopScan();
      }, this.config.scanTimeout);

    } catch (error) {
      console.error('[MESH_SCAN_ERROR]', error);
      this.isScanning = false;
      throw error;
    }
  }

  /**
   * Detiene el escaneo
   */
  async stopScan() {
    console.log('[MESH_SCAN] Stopping scan...');
    this.isScanning = false;
    this.status = 'ready';
    
    if (this.nordicMesh && this.nordicMesh.stopScan) {
      await this.nordicMesh.stopScan();
    }
    
    this._emit('scanning', { active: false });
  }

  /**
   * Conecta a un dispositivo peer por ID
   */
  async connect(peerId) {
    console.log(`[MESH_CONNECT] Connecting to ${peerId}...`);
    
    try {
      // Intentar Nordic primero (BLE directo)
      if (this.nordicMesh && this.nordicMesh.connect) {
        await this.nordicMesh.connect(peerId);
        this._registerPeer(peerId, { type: 'ble', status: 'connecting' });
        return;
      }

      // Fallback a WebSocket
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

  /**
   * Desconecta un peer
   */
  async disconnect(peerId) {
    console.log(`[MESH_DISCONNECT] ${peerId}`);
    
    if (this.nordicMesh && this.nordicMesh.disconnect) {
      await this.nordicMesh.disconnect(peerId);
    }
    
    this.peers.delete(peerId);
    this._emit('disconnected', { peerId });
  }

  /**
   * Envía mensaje a un peer específico o broadcast
   */
  send(data, peerId = null) {
    const payload = {
      id: this._generateId(),
      timestamp: Date.now(),
      data: data
    };

    if (peerId) {
      // Mensaje directo
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

  /**
   * Obtiene estado actual del mesh
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      scanning: this.isScanning,
      status: this.status,
      peerCount: this.peers.size,
      peers: Array.from(this.peers.keys())
    };
  }

  /**
   * Registra un nuevo peer
   */
  _registerPeer(peerId, info) {
    this.peers.set(peerId, {
      id: peerId,
      connectedAt: Date.now(),
      ...info
    });
    this._emit('peer_connected', { peerId, ...info });
    this._emit('connected', { peerId, ...info }); // Alias para compatibilidad
  }

  /**
   * Maneja eventos de Nordic Mesh (BLE nativo)
   */
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

  /**
   * Maneja mensajes WebSocket
   */
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

  /**
   * Genera ID único para mensajes
   */
  _generateId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  /**
   * Limpieza y destrucción
   */
  destroy() {
    this.stopScan();
    this._listeners.clear();
    this.peers.clear();
    this.isInitialized = false;
    this.status = 'offline';
    console.log('[MESH] Destroyed');
  }
}

// Exportar instancia singleton para NexoApp
export const hybridMesh = new HybridMesh();
export default HybridMesh;

// Global para debugging
window.HybridMesh = HybridMesh;
window.hybridMesh = hybridMesh;
