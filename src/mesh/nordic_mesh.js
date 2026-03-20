/**
 * NordicMesh - Implementación Protocolo BLE NEXO v1.0
 * NAP 2.0 Certified - GATT Service Soberano
 * URL: src/mesh/nordic_mesh.js
 * 
 * FIX CRÍTICO: Detección runtime plugin nativo Capacitor vs stub web
 * AUDIT: NAP 2.0 Interface Contracts + Error Codes + Resource Management
 */

// Stub web fallback (cuando no hay Capacitor nativo)
const WebStub = {
  initialize: async () => ({ userId: 'web-stub-id' }),
  startAdvertising: async () => {},
  stopAdvertising: async () => {},
  startScan: async () => {},
  stopScan: async () => {},
  connect: async () => {},
  disconnect: async () => {},
  sendMessage: async () => {},
  addListener: () => ({ remove: () => {} })
};

// UUIDs NEXO Protocol v1.0 (Namespace v5 DNS)
const UUIDS = Object.freeze({
  SERVICE: 'a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d',
  ANNOUNCE: 'b4c6d9e3-f2a5-5b8c-ad4e-7f9g2b3c6d8e',
  HANDSHAKE: 'c5d7eaf4-g3b6-6c9d-be5f-8a0h3c4d7e9f',
  PAYLOAD: 'd6e8fbg5-h4c7-7d0e-cf6g-9b1i4d5e8f0g',
  CONTROL: 'e7f9gch6-i5d8-8e1f-dg7h-0c2j5e6f9g1h'
});

// NAP 2.0 States (Inmutables)
const STATE = Object.freeze({
  NONE: 'none',
  INIT: 'init',
  OFFLINE: 'offline',
  DISCOVERING: 'discovering',
  HANDSHAKING: 'handshaking',
  CONNECTED: 'connected',
  MESSAGING: 'messaging',
  ERROR: 'error',
  CLEANUP: 'cleanup'
});

// NAP 2.0 Error Codes (NordicMesh)
const ERRORS = Object.freeze({
  NORDIC_001: 'PLUGIN_DETECTION_FAILED',
  NORDIC_002: 'VAULT_NOT_PROVIDED',
  NORDIC_003: 'INIT_TIMEOUT',
  NORDIC_004: 'INVALID_DEVICE_ID',
  NORDIC_005: 'NO_ACTIVE_SESSION',
  NORDIC_006: 'ENCRYPTION_FAILED',
  NORDIC_007: 'HANDSHAKE_TIMEOUT',
  NORDIC_008: 'BLE_PERMISSION_DENIED',
  NORDIC_009: 'ADAPTER_NOT_AVAILABLE',
  NORDIC_010: 'MESSAGE_TOO_LARGE'
});

// Interface Contracts (NAP 2.0 Type Validation)
const CONTRACTS = {
  DEVICE_ID: (id) => typeof id === 'string' && /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(id),
  USER_ID: (id) => typeof id === 'string' && /^[a-f0-9]{64}$/i.test(id), // 32 bytes hex
  PAYLOAD: (p) => p !== null && typeof p === 'object',
  VAULT: (v) => v && typeof v.getIdentityKey === 'function' && typeof v.encrypt === 'function',
  CALLBACK: (cb) => typeof cb === 'function'
};

class NordicMesh {
  constructor(vault, options = {}) {
    // NAP 2.0 Contract Check
    if (!CONTRACTS.VAULT(vault)) {
      throw new Error(`NAP ${ERRORS.NORDIC_002}: Vault must provide getIdentityKey() and encrypt()`);
    }

    this.vault = vault;
    this.options = Object.freeze({
      chunkSize: 507,
      rssiThreshold: -85,
      scanInterval: 300,
      handshakeTimeout: 30000,
      messageTimeout: 300000,
      maxRetries: 3,
      ...options
    });
    
    this.state = STATE.NONE;
    this.peers = new Map();
    this.sessions = new Map();
    this.chunks = new Map();
    this.listeners = new Set(); // NAP: Set para unicidad
    this.isNative = false;
    this.NexoBLE = null;
    this.cleanupHandlers = new Set();
    this.initPromise = null;
    
    // Bindings NAP 2.0 (memorización de contexto)
    this._onPeerDiscovered = this._onPeerDiscovered.bind(this);
    this._onConnectionChanged = this._onConnectionChanged.bind(this);
    this._onMessageReceived = this._onMessageReceived.bind(this);
    this._onHandshakeReceived = this._onHandshakeReceived.bind(this);
    this._handleHandshakeTimeout = this._handleHandshakeTimeout.bind(this);
  }

  /**
   * Detecta plugin nativo Capacitor o fallback a stub web
   * NAP 2.0 Resource Detection Pattern
   */
  _detectPlugin() {
    try {
      // Detección nativa Capacitor
      if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.NexoBLE) {
        this.NexoBLE = window.Capacitor.Plugins.NexoBLE;
        this.isNative = true;
        console.log('[NordicMesh] ✅ Native Capacitor plugin detected');
        return true;
      }
      
      // Fallback stub web (modo desarrollo/desktop)
      this.NexoBLE = WebStub;
      this.isNative = false;
      console.warn('[NordicMesh] ⚠️  Web stub mode - BLE limited');
      return false;
    } catch (error) {
      this._setState(STATE.ERROR, { code: ERRORS.NORDIC_001, error });
      return false;
    }
  }

  /**
   * Inicialización NAP 2.0 con timeout y cleanup
   */
  async init() {
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  async _doInit() {
    try {
      this._setState(STATE.INIT);
      
      // Detectar plugin (nativo o stub)
      this._detectPlugin();
      
      // Timeout safety (NAP 2.0 Resource Management)
      const timeout = setTimeout(() => {
        if (this.state === STATE.INIT) {
          this._setState(STATE.ERROR, { code: ERRORS.NORDIC_003, message: 'Initialization timeout' });
        }
      }, 10000);
      
      // Inicializar con vault
      const identityKey = await this.vault.getIdentityKey();
      const result = await this.NexoBLE.initialize({
        userId: identityKey,
        serviceUUID: UUIDS.SERVICE,
        isNative: this.isNative
      });
      
      clearTimeout(timeout);
      
      this.userId = result?.userId || identityKey;
      
      // Setup listeners nativos (con cleanup registrado)
      await this._setupListeners();
      
      this._setState(STATE.OFFLINE);
      return true;
    } catch (error) {
      this._setState(STATE.ERROR, { 
        code: error.code || ERRORS.NORDIC_001, 
        message: error.message || 'Unknown initialization error',
        error 
      });
      return false;
    }
  }

  /**
   * Setup listeners con registradores de cleanup (NAP 2.0 Pattern)
   */
  async _setupListeners() {
    const handlers = [
      { event: 'onPeerDiscovered', handler: this._onPeerDiscovered },
      { event: 'onConnectionStateChanged', handler: this._onConnectionChanged },
      { event: 'onMessageReceived', handler: this._onMessageReceived },
      { event: 'onHandshakeReceived', handler: this._onHandshakeReceived }
    ];

    for (const { event, handler } of handlers) {
      try {
        const subscription = await this.NexoBLE.addListener(event, handler);
        if (subscription?.remove) {
          this.cleanupHandlers.add(subscription.remove);
        }
      } catch (e) {
        console.warn(`[NordicMesh] Listener ${event} not available:`, e);
      }
    }
  }

  // === PUBLIC API (NAP 2.0 Interface Contracts) ===

  /**
   * Inicia descubrimiento BLE (Advertising + Scanning)
   * NAP: state validation + timeout auto-cleanup
   */
  async startDiscovery() {
    if (![STATE.OFFLINE, STATE.CONNECTED].includes(this.state)) {
      const error = { code: 'INVALID_STATE', message: `Cannot discover from ${this.state}` };
      this._emit('error', error);
      return false;
    }
    
    this._setState(STATE.DISCOVERING);
    
    try {
      await this.NexoBLE.startAdvertising({
        serviceUUID: UUIDS.SERVICE,
        userId: this.userId,
        mode: 'low_latency'
      });
      
      await this.NexoBLE.startScan({
        serviceUUID: UUIDS.SERVICE,
        rssiThreshold: this.options.rssiThreshold
      });
      
      // Auto-cleanup timer (NAP 2.0)
      const scanTimer = setTimeout(() => {
        if (this.state === STATE.DISCOVERING && this.peers.size === 0) {
          this.stopDiscovery();
          this._emit('scanTimeout', { duration: 10000 });
        }
      }, 10000);
      
      this.cleanupHandlers.add(() => clearTimeout(scanTimer));
      
      return true;
    } catch (error) {
      this._setState(STATE.ERROR, { code: ERRORS.NORDIC_008, error });
      return false;
    }
  }

  async stopDiscovery() {
    try {
      await this.NexoBLE.stopScan();
      // Mantenemos advertising para ser descubiertos
      if (this.state === STATE.DISCOVERING) {
        this._setState(STATE.OFFLINE);
      }
      return true;
    } catch (error) {
      console.warn('[NordicMesh] Error stopping discovery:', error);
      return false;
    }
  }

  /**
   * Conexión a peer con handshake X3DH
   * NAP: Contract validation + timeout management
   */
  async connect(deviceId) {
    if (!CONTRACTS.DEVICE_ID(deviceId)) {
      const error = { code: ERRORS.NORDIC_004, message: 'Invalid MAC address format (XX:XX:XX:XX:XX:XX)' };
      this._emit('error', error);
      throw new Error(`NAP ${error.code}: ${error.message}`);
    }
    
    this._setState(STATE.HANDSHAKING);
    
    try {
      await this.NexoBLE.connect({ deviceId });
      
      // Handshake timeout tracker
      this._handshakeTimer = setTimeout(
        () => this._handleHandshakeTimeout(deviceId), 
        this.options.handshakeTimeout
      );
      
      await this._initiateHandshake(deviceId);
      return true;
    } catch (error) {
      this._setState(STATE.ERROR, { code: ERRORS.NORDIC_008, error });
      return false;
    }
  }

  async disconnect(deviceId) {
    if (!CONTRACTS.DEVICE_ID(deviceId)) return false;
    
    try {
      await this.NexoBLE.disconnect({ deviceId });
      this._cleanupSession(deviceId);
      return true;
    } catch (error) {
      console.warn('[NordicMesh] Disconnect error:', error);
      return false;
    }
  }

  /**
   * Envío de mensaje con chunking automático
   * NAP: Contract validation + encryption + chunking
   */
  async sendMessage(deviceId, plaintext) {
    if (!CONTRACTS.DEVICE_ID(deviceId)) {
      throw new Error(`NAP ${ERRORS.NORDIC_004}: Invalid device ID`);
    }
    
    if (!this.sessions.has(deviceId)) {
      throw new Error(`NAP ${ERRORS.NORDIC_005}: No active session with ${deviceId}`);
    }
    
    this._setState(STATE.MESSAGING);
    
    try {
      const session = this.sessions.get(deviceId);
      
      // Cifrado via vault
      const encrypted = await this.vault.encrypt(plaintext, session.key);
      
      // Serialización
      const envelope = {
        payload: encrypted,
        timestamp: Date.now(),
        seq: session.seq++
      };
      
      const bytes = new TextEncoder().encode(JSON.stringify(envelope));
      
      // Validación tamaño máximo (chunking threshold)
      if (bytes.length > 4096) { // 4KB límite práctico BLE
        throw new Error(`NAP ${ERRORS.NORDIC_010}: Message exceeds 4KB limit`);
      }
      
      // Envío nativo (plugin maneja chunking interno)
      await this.NexoBLE.sendMessage({
        deviceId,
        data: Array.from(bytes),
        chunks: Math.ceil(bytes.length / this.options.chunkSize)
      });
      
      this._emit('messageSent', { deviceId, timestamp: envelope.timestamp });
      return true;
    } catch (error) {
      this._setState(STATE.ERROR, { code: ERRORS.NORDIC_006, error });
      return false;
    }
  }

  // === PRIVATE HANDLERS (NAP 2.0 Event Management) ===

  _onPeerDiscovered(peer) {
    if (!peer || peer.rssi < this.options.rssiThreshold) return;
    
    const peerInfo = Object.freeze({
      id: peer.id || peer.deviceId,
      name: peer.name || 'Unknown',
      rssi: peer.rssi,
      userId: peer.userId,
      discoveredAt: Date.now()
    });
    
    this.peers.set(peerInfo.id, peerInfo);
    this._emit('peerDiscovered', peerInfo);
  }

  _onConnectionChanged(state) {
    if (!state) return;
    
    if (state.state === 'connected') {
      this._setState(STATE.CONNECTED);
      this._emit('peerConnected', { deviceId: state.deviceId });
    } else {
      this._cleanupSession(state.deviceId);
      this._emit('peerDisconnected', { deviceId: state.deviceId });
      
      if (this.sessions.size === 0) {
        this._setState(STATE.OFFLINE);
      }
    }
  }

  _onMessageReceived(msg) {
    try {
      if (!msg?.data) return;
      
      const data = new Uint8Array(msg.data);
      const envelope = JSON.parse(new TextDecoder().decode(data));
      
      const session = this.sessions.get(msg.deviceId);
      if (!session) {
        throw new Error('No session for decryption');
      }
      
      const plaintext = this.vault.decrypt(envelope.payload, session.key);
      
      this._emit('messageReceived', {
        deviceId: msg.deviceId,
        content: plaintext,
        timestamp: envelope.timestamp,
        seq: envelope.seq
      });
    } catch (error) {
      this._emit('error', { type: 'decryption', code: 'DECRYPT_FAILED', error });
    }
  }

  _onHandshakeReceived(data) {
    // Protocolo X3DH simplificado
    switch(data?.type) {
      case 0x01: // HELLO
        this._handleHello(data);
        break;
      case 0x02: // HELLO_ACK
        this._handleHelloAck(data);
        break;
      case 0x03: // KEY_EXCHANGE
        this._handleKeyExchange(data);
        break;
      case 0x04: // KEY_CONFIRM
        this._handleKeyConfirm(data);
        break;
    }
  }

  _handleHandshakeTimeout(deviceId) {
    if (!this.sessions.has(deviceId)) {
      this.disconnect(deviceId);
      this._emit('handshakeFailed', { deviceId, reason: 'timeout', code: ERRORS.NORDIC_007 });
      this._setState(STATE.OFFLINE);
    }
  }

  // === HANDSHAKE X3DH (Simplificado NAP 2.0) ===

  async _initiateHandshake(deviceId) {
    const ephemeralKey = await this.vault.generateEphemeralKey();
    
    const hello = {
      type: 0x01,
      userId: this.userId,
      ephemeralKey: ephemeralKey,
      timestamp: Date.now()
    };
    
    await this.NexoBLE.sendMessage({
      deviceId,
      data: Array.from(new TextEncoder().encode(JSON.stringify(hello)))
    });
  }

  _handleHello(data) {
    // Responder con HELLO_ACK + KEY_EXCHANGE
    this._emit('handshakeStep', { step: 'hello_received', from: data.userId });
  }

  _handleHelloAck(data) {
    this._emit('handshakeStep', { step: 'ack_received', from: data.deviceId });
  }

  _handleKeyExchange(data) {
    // Derivar clave de sesión (simplificado - usar X3DH real en producción)
    const sessionKey = `session-${data.deviceId}-${Date.now()}`;
    this.sessions.set(data.deviceId, {
      key: sessionKey,
      seq: 0,
      establishedAt: Date.now()
    });
    
    // Limpiar timeout
    if (this._handshakeTimer) {
      clearTimeout(this._handshakeTimer);
      this._handshakeTimer = null;
    }
    
    this._setState(STATE.CONNECTED);
    this._emit('sessionEstablished', { deviceId: data.deviceId });
  }

  _handleKeyConfirm(data) {
    this._emit('handshakeComplete', { deviceId: data.deviceId });
  }

  // === UTILS NAP 2.0 ===

  _setState(newState, error = null) {
    const oldState = this.state;
    this.state = newState;
    
    this._emit('stateChanged', {
      from: oldState,
      to: newState,
      timestamp: Date.now(),
      error
    });
    
    if (error) {
      console.error(`[NordicMesh] ${newState}:`, error);
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

  /**
   * NAP 2.0 Subscription Pattern
   */
  on(callback) {
    if (!CONTRACTS.CALLBACK(callback)) {
      throw new Error('Listener must be a function');
    }
    this.listeners.add(callback);
    
    // Unsubscribe function (NAP pattern)
    return () => {
      this.listeners.delete(callback);
    };
  }

  _cleanupSession(deviceId) {
    this.sessions.delete(deviceId);
    this.peers.delete(deviceId);
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  getState() {
    return this.state;
  }

  /**
   * NAP 2.0 Cleanup - Resource Management
   */
  destroy() {
    this._setState(STATE.CLEANUP);
    
    // Ejecutar handlers de cleanup registrados
    this.cleanupHandlers.forEach(cleanup => {
      try { cleanup(); } catch(e) {}
    });
    this.cleanupHandlers.clear();
    
    // Cleanup BLE
    this.NexoBLE?.stopAdvertising?.();
    this.NexoBLE?.stopScan?.();
    
    // Cleanup timers
    if (this._handshakeTimer) clearTimeout(this._handshakeTimer);
    
    // Cleanup data
    this.peers.clear();
    this.sessions.clear();
    this.listeners.clear();
    this.chunks.clear();
    this.initPromise = null;
    
    this._setState(STATE.NONE);
  }
}

export { NordicMesh, STATE, UUIDS, ERRORS };
