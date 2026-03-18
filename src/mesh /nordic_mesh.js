/**
 * NEXO Nordic Mesh v1.0
 * Implementación BLE Soberana - GATT Service Propio
 * Reemplaza nearby_mesh.js (Google Nearby)
 * 
 * Protocolo: BLE → WiFi LAN → Relay (auto-escalado)
 */

import { CryptoVault } from '../vault/crypto_vault.js';

// UUIDs GATT Service NEXO v1.0 (UUIDv5 namespace)
const NEXO_BLE_SERVICE = 'a3b5c8d2-e1f4-5a8b-bc3d-7f9e2a4c6d8e';
const CHAR_ANNOUNCE = 'b4c6d9e3-f2a5-6b9c-cd4e-8f0f3b5d7e9f';
const CHAR_HANDSHAKE = 'c5d7eaf4-a3b6-7c0e-df6f-9a2f5d7e9f1h';
const CHAR_PAYLOAD = 'd6e8fbg5-b4c7-7d0e-cf6g-9b1i4d5e8f0g';
const CHAR_CONTROL = 'e7f9gch6-c5d8-8e1f-dg7h-0c2j5e6f9g1h';

// Estados de conexión
const STATE = {
  OFFLINE: 'offline',
  DISCOVERING: 'discovering',
  HANDSHAKING: 'handshaking',
  CONNECTED: 'connected',
  MESSAGING: 'messaging'
};

// Timeouts (ms)
const TIMEOUTS = {
  DISCOVERY: 10000,
  HANDSHAKE: 30000,
  MESSAGE: 300000, // 5 min inactividad
  CHUNK_ACK: 5000
};

class NordicMesh {
  constructor(options = {}) {
    this.vault = options.vault || new CryptoVault();
    this.userId = null; // 16 bytes hash de clave pública
    
    // Estado
    this.state = STATE.OFFLINE;
    this.peers = new Map(); // deviceId -> {id, rssi, state, sessionKeys, lastSeen}
    this.connections = new Map(); // deviceId -> BluetoothDevice
    
    // Chunking
    this.pendingChunks = new Map(); // messageId -> {chunks[], total, received}
    this.outgoingChunks = new Map(); // messageId -> {chunks[], sent[], timeout}
    
    // Callbacks
    this.onPeerDiscovered = null;
    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    this.onMessageReceived = null;
    this.onStateChange = null;
    
    this._scanInterval = null;
    this._advertising = false;
    this._initialized = false;
    
    // Plugin nativo (se inyectará después)
    this._plugin = null;
  }

  /**
   * Inicializa el mesh BLE
   */
  async init() {
    if (this._initialized) return true;
    
    try {
      // Obtener ID único del vault (hash de clave pública)
      const identityKey = await this.vault.getIdentityKey();
      this.userId = this._deriveUserId(identityKey);
      
      // Detectar si estamos en Capacitor (nativo) o Web
      if (window.Capacitor && window.Capacitor.Plugins.NexoBle) {
        this._plugin = window.Capacitor.Plugins.NexoBle;
        await this._plugin.initialize({
          serviceUuid: NEXO_BLE_SERVICE,
          userId: this.userId
        });
        
        // Setup listeners nativos
        this._setupNativeListeners();
      } else {
        console.warn('[NordicMesh] Plugin nativo no disponible, modo simulación');
      }
      
      this._initialized = true;
      this._setState(STATE.OFFLINE);
      return true;
      
    } catch (error) {
      console.error('[NordicMesh] Init error:', error);
      throw new Error(`NORDIC_INIT_FAILED: ${error.message}`);
    }
  }

  /**
   * Inicia descubrimiento + advertising simultáneo
   */
  async startDiscovery() {
    if (!this._initialized) await this.init();
    
    try {
      this._setState(STATE.DISCOVERING);
      
      if (this._plugin) {
        // Nativo: scan filtrado por UUID NEXO
        await this._plugin.startScan({
          serviceUuid: NEXO_BLE_SERVICE,
          rssiThreshold: -85 // dBm
        });
        
        // Iniciar advertising simultáneo
        await this._plugin.startAdvertising({
          serviceUuid: NEXO_BLE_SERVICE,
          userId: this.userId,
          timeout: TIMEOUTS.DISCOVERY
        });
      } else {
        // Simulación Web Bluetooth (limitada)
        await this._webBluetoothScan();
      }
      
      // Timeout auto-stop
      setTimeout(() => this.stopDiscovery(), TIMEOUTS.DISCOVERY);
      
      return true;
    } catch (error) {
      this._setState(STATE.OFFLINE);
      throw new Error(`DISCOVERY_START_FAILED: ${error.message}`);
    }
  }

  /**
   * Detiene descubrimiento
   */
  async stopDiscovery() {
    if (this._plugin) {
      await this._plugin.stopScan();
      await this._plugin.stopAdvertising();
    }
    
    if (this.state === STATE.DISCOVERING) {
      this._setState(STATE.OFFLINE);
    }
  }

  /**
   * Conecta a un peer descubierto
   */
  async connect(deviceId) {
    if (this.peers.has(deviceId)) {
      const peer = this.peers.get(deviceId);
      
      if (peer.state === STATE.CONNECTED || peer.state === STATE.MESSAGING) {
        return true; // Ya conectado
      }
      
      try {
        this._setState(STATE.HANDSHAKING);
        peer.state = STATE.HANDSHAKING;
        
        if (this._plugin) {
          await this._plugin.connect(deviceId);
          
          // Enviar HELLO (X3DH)
          const helloPayload = await this._createHelloPayload();
          await this._plugin.writeCharacteristic(
            deviceId, 
            CHAR_HANDSHAKE, 
            helloPayload
          );
          
          // Esperar HELLO_ACK
          const response = await this._waitForHandshakeResponse(deviceId);
          await this._processHandshakeAck(deviceId, response);
        }
        
        peer.state = STATE.CONNECTED;
        peer.lastSeen = Date.now();
        this.connections.set(deviceId, true);
        
        if (this.onPeerConnected) {
          this.onPeerConnected({ deviceId, userId: peer.userId });
        }
        
        return true;
        
      } catch (error) {
        peer.state = STATE.OFFLINE;
        throw new Error(`CONNECT_FAILED: ${error.message}`);
      }
    }
    
    throw new Error('PEER_NOT_FOUND');
  }

  /**
   * Desconecta peer
   */
  async disconnect(deviceId) {
    if (this._plugin) {
      await this._plugin.disconnect(deviceId);
    }
    
    if (this.peers.has(deviceId)) {
      this.peers.get(deviceId).state = STATE.OFFLINE;
      this.connections.delete(deviceId);
      
      if (this.onPeerDisconnected) {
        this.onPeerDisconnected({ deviceId });
      }
    }
  }

  /**
   * Envía mensaje cifrado (con chunking automático)
   */
  async sendMessage(deviceId, message) {
    if (!this.connections.has(deviceId)) {
      throw new Error('NOT_CONNECTED');
    }
    
    const peer = this.peers.get(deviceId);
    if (!peer.sessionKeys) {
      throw new Error('SESSION_NOT_ESTABLISHED');
    }
    
    try {
      // Cifrar mensaje
      const encrypted = await this._encryptMessage(message, peer.sessionKeys);
      
      // Chunking si es necesario (> 507 bytes)
      if (encrypted.length > 507) {
        return await this._sendChunkedMessage(deviceId, encrypted);
      } else {
        // Mensaje único
        const payload = this._buildPayloadPacket({
          type: 0, // mensaje
          chunked: 0,
          sequence: peer.sequence++,
          data: encrypted
        });
        
        await this._plugin.writeCharacteristic(deviceId, CHAR_PAYLOAD, payload);
        return true;
      }
      
    } catch (error) {
      throw new Error(`SEND_FAILED: ${error.message}`);
    }
  }

  /**
   * Procesa mensaje recibido (chunked o completo)
   */
  async _handleIncomingPayload(deviceId, payload) {
    const flags = payload[0];
    const isChunked = (flags & 0x02) !== 0;
    const isLastChunk = (flags & 0x04) !== 0;
    const sequence = (payload[1] << 8) | payload[2];
    const messageId = (payload[3] << 8) | payload[4];
    
    if (isChunked) {
      const chunkIndex = (payload[5] << 8) | payload[6];
      const totalChunks = (payload[7] << 8) | payload[8];
      const data = payload.slice(9);
      
      await this._processChunk(deviceId, messageId, chunkIndex, totalChunks, data, isLastChunk);
    } else {
      // Mensaje completo
      const encrypted = payload.slice(5);
      await this._decryptAndDeliver(deviceId, encrypted);
    }
  }

  /**
   * Reensambla chunks
   */
  async _processChunk(deviceId, messageId, index, total, data, isLast) {
    const key = `${deviceId}_${messageId}`;
    
    if (!this.pendingChunks.has(key)) {
      this.pendingChunks.set(key, {
        chunks: new Array(total).fill(null),
        received: 0,
        total,
        timestamp: Date.now()
      });
    }
    
    const pending = this.pendingChunks.get(key);
    pending.chunks[index] = data;
    pending.received++;
    
    if (isLast || pending.received === total) {
      // Reensamblar
      const fullMessage = new Uint8Array(
        pending.chunks.reduce((acc, chunk) => {
          if (!chunk) throw new Error('MISSING_CHUNK');
          const tmp = new Uint8Array(acc.length + chunk.length);
          tmp.set(acc);
          tmp.set(chunk, acc.length);
          return tmp;
        }, new Uint8Array(0))
      );
      
      this.pendingChunks.delete(key);
      await this._decryptAndDeliver(deviceId, fullMessage);
    }
  }

  /**
   * Envía mensaje chunkificado
   */
  async _sendChunkedMessage(deviceId, encryptedData) {
    const messageId = Math.floor(Math.random() * 65535);
    const totalChunks = Math.ceil(encryptedData.length / 507);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * 507;
      const end = Math.min(start + 507, encryptedData.length);
      const chunk = encryptedData.slice(start, end);
      
      const isLast = i === totalChunks - 1;
      const header = new Uint8Array(9);
      header[0] = 0x03 | (isLast ? 0x04 : 0); // chunked + last?
      header[1] = (i >> 8) & 0xFF; // sequence high
      header[2] = i & 0xFF; // sequence low
      header[3] = (messageId >> 8) & 0xFF;
      header[4] = messageId & 0xFF;
      header[5] = (i >> 8) & 0xFF; // chunk index high
      header[6] = i & 0xFF; // chunk index low
      header[7] = (totalChunks >> 8) & 0xFF;
      header[8] = totalChunks & 0xFF;
      
      const payload = new Uint8Array(header.length + chunk.length);
      payload.set(header);
      payload.set(chunk, header.length);
      
      await this._plugin.writeCharacteristic(deviceId, CHAR_PAYLOAD, payload);
      
      // Pequeño delay entre chunks para no saturar BLE
      if (!isLast) await new Promise(r => setTimeout(r, 50));
    }
    
    return true;
  }

  /**
   * Cifrado X3DH + Double Ratchet (simplificado)
   */
  async _encryptMessage(plaintext, sessionKeys) {
    // Usar CryptoVault para cifrado AEAD
    const data = new TextEncoder().encode(JSON.stringify(plaintext));
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    
    // Aquí integraríamos con crypto_vault.js para cifrado real
    // Por ahora: mock
    const encrypted = await this.vault.encrypt(data, sessionKeys.sending);
    
    const result = new Uint8Array(nonce.length + encrypted.length);
    result.set(nonce);
    result.set(encrypted, nonce.length);
    
    return result;
  }

  async _decryptAndDeliver(deviceId, encryptedData) {
    try {
      const peer = this.peers.get(deviceId);
      const decrypted = await this.vault.decrypt(encryptedData, peer.sessionKeys.receiving);
      const message = JSON.parse(new TextDecoder().decode(decrypted));
      
      peer.lastSeen = Date.now();
      
      if (this.onMessageReceived) {
        this.onMessageReceived({
          deviceId,
          userId: peer.userId,
          message,
          timestamp: Date.now(),
          via: 'BLE'
        });
      }
    } catch (error) {
      console.error('[NordicMesh] Decrypt error:', error);
    }
  }

  /**
   * Helpers y utilidades
   */
  _deriveUserId(publicKey) {
    // Hash truncado de clave pública (16 bytes)
    return publicKey.slice(0, 32); // Simplificado
  }

  _setState(newState) {
    this.state = newState;
    if (this.onStateChange) this.onStateChange(newState);
  }

  _setupNativeListeners() {
    if (!this._plugin) return;
    
    // Peer descubierto
    this._plugin.addListener('onPeerDiscovered', (event) => {
      const { deviceId, userId, rssi } = event;
      
      this.peers.set(deviceId, {
        id: deviceId,
        userId,
        rssi,
        state: STATE.DISCOVERING,
        lastSeen: Date.now(),
        sequence: 0
      });
      
      if (this.onPeerDiscovered) {
        this.onPeerDiscovered({ deviceId, userId, rssi });
      }
    });
    
    // Conexión establecida
    this._plugin.addListener('onConnectionStateChanged', (event) => {
      const { deviceId, state } = event;
      if (state === 'connected') {
        // Handshake completado por el nativo
      } else if (state === 'disconnected') {
        this.disconnect(deviceId);
      }
    });
    
    // Mensaje recibido
    this._plugin.addListener('onMessageReceived', (event) => {
      const { deviceId, data } = event;
      this._handleIncomingPayload(deviceId, new Uint8Array(data));
    });
  }

  getPeers() {
    return Array.from(this.peers.values()).map(p => ({
      id: p.id,
      userId: p.userId,
      rssi: p.rssi,
      state: p.state,
      lastSeen: p.lastSeen
    }));
  }

  isConnected(deviceId) {
    return this.connections.has(deviceId);
  }
}

// Singleton export
export const nordicMesh = new NordicMesh();
export default NordicMesh;
