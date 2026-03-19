/**
 * NordicMesh - Implementación Protocolo BLE NEXO v1.0
 * NAP 2.0 Certified - GATT Service Soberano
 */

import { NexoBLE } from '../../plugins/nexo-ble/src/index.js';

// UUIDs NEXO Protocol v1.0
const UUIDS = {
  SERVICE: 'a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d',
  ANNOUNCE: 'b4c6d9e3-f2a5-5b8c-ad4e-7f9g2b3c6d8e',
  HANDSHAKE: 'c5d7eaf4-g3b6-6c9d-be5f-8a0h3c4d7e9f',
  PAYLOAD: 'd6e8fbg5-h4c7-7d0e-cf6g-9b1i4d5e8f0g',
  CONTROL: 'e7f9gch6-i5d8-8e1f-dg7h-0c2j5e6f9g1h'
};

// NAP 2.0 States
const STATE = Object.freeze({
  NONE: 'none',
  INIT: 'init',                    // NAP Phase 0
  OFFLINE: 'offline',              // NAP Phase 1 (Ready)
  DISCOVERING: 'discovering',      // NAP Phase 2
  HANDSHAKING: 'handshaking',      // NAP Phase 3
  CONNECTED: 'connected',          // NAP Phase 4
  MESSAGING: 'messaging',          // NAP Phase 5 (Active)
  ERROR: 'error',                  // NAP Phase X (Failure)
  CLEANUP: 'cleanup'               // NAP Phase 99
});

// Interface Contracts (NAP 2.0 Type Validation)
const CONTRACTS = {
  DEVICE_ID: (id) => typeof id === 'string' && id.length === 17, // MAC format XX:XX:XX:XX:XX:XX
  USER_ID: (id) => typeof id === 'string' && id.length === 32,   // 16 bytes hex
  PAYLOAD: (p) => p !== null && typeof p === 'object',
  VAULT: (v) => v && typeof v.getIdentityKey === 'function' && typeof v.encrypt === 'function'
};

class NordicMesh {
  constructor(vault, options = {}) {
    this.vault = vault;
    this.options = {
      chunkSize: 507,              // 512 MTU - 5 bytes header
      rssiThreshold: -85,          // dBm
      scanInterval: 300,           // ms
      handshakeTimeout: 30000,     // 30s
      messageTimeout: 300000,      // 5min
      ...options
    };
    
    this.state = STATE.NONE;
    this.peers = new Map();        // deviceId -> PeerInfo
    this.sessions = new Map();     // deviceId -> SessionKeys
    this.chunks = new Map();       // messageId -> chunks[]
    this.listeners = [];
    this.isNative = false;
    
    // Bindings
    this._onPeerDiscovered = this._onPeerDiscovered.bind(this);
    this._onConnectionChanged = this._onConnectionChanged.bind(this);
    this._onMessageReceived = this._onMessageReceived.bind(this);
    this._onHandshakeReceived = this._onHandshakeReceived.bind(this);
  }

  async init() {
    try {
      this._setState(STATE.INIT);
      
      // Inicializar plugin nativo
      const result = await NexoBLE.initialize({
        userId: await this.vault.getIdentityKey()
      });
      
      this.userId = result.userId;
      this.isNative = true;
      
      // Setup listeners
      await this._setupListeners();
      
      this._setState(STATE.OFFLINE);
      return true;
    } catch (error) {
      this._setState(STATE.ERROR, error);
      return false;
    }
  }

  async _setupListeners() {
    // Peer discovery
    NexoBLE.addListener('onPeerDiscovered', this._onPeerDiscovered);
    
    // Connection state
    NexoBLE.addListener('onConnectionStateChanged', this._onConnectionChanged);
    
    // Messages
    NexoBLE.addListener('onMessageReceived', this._onMessageReceived);
    
    // Handshake
    NexoBLE.addListener('onHandshakeReceived', this._onHandshakeReceived);
  }

  // === PUBLIC API ===

  async startDiscovery() {
    if (this.state !== STATE.OFFLINE && this.state !== STATE.CONNECTED) {
      throw new Error(`Cannot start discovery from state: ${this.state}`);
    }
    
    this._setState(STATE.DISCOVERING);
    
    try {
      // Iniciar advertising (somos visibles)
      await NexoBLE.startAdvertising();
      
      // Iniciar scanning (buscamos otros)
      await NexoBLE.startScan();
      
      // Auto-stop después de 10s si no encontramos nada
      setTimeout(() => {
        if (this.state === STATE.DISCOVERING && this.peers.size === 0) {
          this.stopDiscovery();
        }
      }, 10000);
      
      return true;
    } catch (error) {
      this._setState(STATE.ERROR, error);
      return false;
    }
  }

  async stopDiscovery() {
    try {
      await NexoBLE.stopScan();
      // Mantenemos advertising activo para que otros nos encuentren
      this._setState(STATE.OFFLINE);
    } catch (error) {
      console.warn('[NordicMesh] Error stopping discovery:', error);
    }
  }

  async connect(deviceId) {
    if (!CONTRACTS.DEVICE_ID(deviceId)) {
      throw new Error('Invalid device ID format');
    }
    
    this._setState(STATE.HANDSHAKING);
    
    try {
      await NexoBLE.connect({ deviceId });
      
      // Iniciar X3DH handshake
      await this._initiateHandshake(deviceId);
      
      // Timeout de handshake
      setTimeout(() => {
        if (!this.sessions.has(deviceId)) {
          this.disconnect(deviceId);
          this._emit('handshakeFailed', { deviceId, reason: 'timeout' });
        }
      }, this.options.handshakeTimeout);
      
      return true;
    } catch (error) {
      this._setState(STATE.ERROR, error);
      return false;
    }
  }

  async disconnect(deviceId) {
    try {
      await NexoBLE.disconnect({ deviceId });
      this.sessions.delete(deviceId);
      this.peers.delete(deviceId);
    } catch (error) {
      console.warn('[NordicMesh] Error disconnecting:', error);
    }
  }

  async sendMessage(deviceId, plaintext) {
    if (!this.sessions.has(deviceId)) {
      throw new Error('No active session with device');
    }
    
    this._setState(STATE.MESSAGING);
    
    try {
      // Cifrar con Double Ratchet o AES-GCM
      const session = this.sessions.get(deviceId);
      const encrypted = await this.vault.encrypt(plaintext, session.key);
      
      // Convertir a array de bytes
      const bytes = new TextEncoder().encode(JSON.stringify({
        payload: encrypted,
        timestamp: Date.now(),
        seq: session.seq++
      }));
      
      // Enviar vía BLE (con chunking automático)
      await NexoBLE.sendMessage({
        deviceId,
        data: Array.from(bytes)
      });
      
      return true;
    } catch (error) {
      this._setState(STATE.ERROR, error);
      return false;
    }
  }

  // === PRIVATE HANDLERS ===

  _onPeerDiscovered(peer) {
    if (peer.rssi < this.options.rssiThreshold) return;
    
    const peerInfo = {
      id: peer.id,
      name: peer.name,
      rssi: peer.rssi,
      userId: peer.userId,
      discoveredAt: Date.now()
    };
    
    this.peers.set(peer.id, peerInfo);
    this._emit('peerDiscovered', peerInfo);
    
    // Auto-conectar si es un peer conocido?
    // Por ahora requiere interacción manual
  }

  _onConnectionChanged(state) {
    if (state.state === 'connected') {
      this._setState(STATE.CONNECTED);
      this._emit('peerConnected', { deviceId: state.deviceId });
    } else {
      this.sessions.delete(state.deviceId);
      this._emit('peerDisconnected', { deviceId: state.deviceId });
      
      if (this.sessions.size === 0) {
        this._setState(STATE.OFFLINE);
      }
    }
  }

  _onMessageReceived(msg) {
    try {
      // Reconstruir chunks si es necesario
      const data = new Uint8Array(msg.data);
      
      // Parsear mensaje
      const envelope = JSON.parse(new TextDecoder().decode(data));
      
      // Descifrar
      const session = this.sessions.get(msg.deviceId);
      if (!session) throw new Error('No session for message');
      
      const plaintext = this.vault.decrypt(envelope.payload, session.key);
      
      this._emit('messageReceived', {
        deviceId: msg.deviceId,
        content: plaintext,
        timestamp: envelope.timestamp
      });
    } catch (error) {
      this._emit('error', { type: 'decryption', error });
    }
  }

  _onHandshakeReceived(data) {
    // Implementar X3DH
    // 0x01 = HELLO, 0x02 = HELLO_ACK, 0x03 = KEY_EXCHANGE, 0x04 = KEY_CONFIRM
    switch(data.type) {
      case 0x01:
        this._handleHello(data);
        break;
      case 0x03:
        this._handleKeyExchange(data);
        break;
    }
  }

  // === HANDSHAKE X3DH ===

  async _initiateHandshake(deviceId) {
    // Generar clave efímera X25519
    const ephemeralKey = await this.vault.generateEphemeralKey();
    
    // Enviar HELLO
    const hello = new Uint8Array(82);
    hello[0] = 0x01; // Type HELLO
    // ... poblar con userId + ephemeralKey + signature
    
    await NexoBLE.sendMessage({
      deviceId,
      data: Array.from(hello)
    });
  }

  _handleHello(data) {
    // Responder con HELLO_ACK + KEY_EXCHANGE
  }

  _handleKeyExchange(data) {
    // Completar handshake y establecer session key
    const sessionKey = 'derived-key-here'; // Derivar de X3DH
    this.sessions.set(data.deviceId, {
      key: sessionKey,
      seq: 0,
      establishedAt: Date.now()
    });
    
    this._setState(STATE.CONNECTED);
    this._emit('sessionEstablished', { deviceId: data.deviceId });
  }

  // === UTILS ===

  _setState(newState, error = null) {
    const oldState = this.state;
    this.state = newState;
    
    this._emit('stateChanged', {
      from: oldState,
      to: newState,
      error
    });
    
    if (error) {
      console.error(`[NordicMesh] State ${newState}:`, error);
    }
  }

  _emit(event, data) {
    this.listeners.forEach(cb => {
      try {
        cb(event, data);
      } catch (e) {
        console.error('[NordicMesh] Listener error:', e);
      }
    });
  }

  on(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  getState() {
    return this.state;
  }
}

export { NordicMesh, STATE, UUIDS };
