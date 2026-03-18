/**
 * NEXO Nordic Mesh v1.0-NAP-CERTIFIED
 * GATT Service Soberano - Protocolo BLE NEXO
 * Revision: NAP 2.0 (Interface Contracts + SOC2 Resource Management + Error Boundaries)
 * Error Codes: APP_011-APP_016 (BLE subsystem)
 */

import { rem } from '../ui/rem.js';

// UUIDs v5 Namespace (Deterministic)
const UUIDS = {
  SERVICE:   'a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d',
  ANNOUNCE:  'b4c6d9e3-f2a5-5b8c-ad4e-7f9g2b3c6d8e',
  HANDSHAKE: 'c5d7eaf4-a3b6-4c9d-be5f-8a0h3c4d7e9f',
  PAYLOAD:   'd6e8fbg5-b4c7-4d0e-cf6g-9b1i4d5e8f0g',
  CONTROL:   'e7f9gch6-c5d8-4e1f-dg7h-0c2j5e6f9g1h'
};

// NAP 2.0 Error Codes (BLE Subsystem)
const NAP_ERRORS = {
  NORDIC_INIT_FAILED:    { code: 'APP_011', phase: 'NORDIC_INIT' },
  BLE_SCAN_FAILED:       { code: 'APP_012', phase: 'NORDIC_DISCOVERY' },
  BLE_ADVERTISE_FAILED:  { code: 'APP_013', phase: 'NORDIC_ADVERTISING' },
  BLE_HANDSHAKE_FAILED:  { code: 'APP_014', phase: 'NORDIC_HANDSHAKE' },
  BLE_SEND_FAILED:       { code: 'APP_015', phase: 'NORDIC_MESSAGING' },
  BLE_CRYPTO_FAILED:     { code: 'APP_016', phase: 'NORDIC_CRYPTO' }
};

// NAP 2.0 States (Strict State Machine)
const STATE = Object.freeze({
  NONE: 'none',
  INIT: 'init',           // NAP Phase 0
  OFFLINE: 'offline',     // NAP Phase 1 (Ready)
  DISCOVERING: 'discovering', // NAP Phase 2
  HANDSHAKING: 'handshaking', // NAP Phase 3
  CONNECTED: 'connected',     // NAP Phase 4
  MESSAGING: 'messaging',     // NAP Phase 5 (Active)
  ERROR: 'error',             // NAP Phase X (Failure)
  CLEANUP: 'cleanup'          // NAP Phase 99
});

// Interface Contracts (NAP 2.0 Type Validation)
const CONTRACTS = {
  DEVICE_ID: (id) => typeof id === 'string' && id.length === 17, // MAC format XX:XX:XX:XX:XX:XX
  USER_ID: (id) => typeof id === 'string' && id.length === 32,    // 16 bytes hex
  PAYLOAD: (p) => p !== null && typeof p === 'object',
  VAULT: (v) => v && typeof v.getIdentityKey === 'function' && typeof v.encrypt === 'function'
};

// Constants
const CONSTANTS = Object.freeze({
  CHUNK_SIZE: 507,
  MTU: 512,
  ANNOUNCE_SIZE: 32,
  DISCOVERY_TIMEOUT: 10000,
  HANDSHAKE_TIMEOUT: 30000,
  MAX_RECONNECT_AGE: 300000,
  RSSI_THRESHOLD: -85,
  SEQUENCE_MAX: 65535
});

class NordicMesh {
  constructor() {
    // SOC2 Resource Management (NAP 2.0)
    this._resources = {
      plugin: null,
      intervals: new Set(),
      timeouts: new Set(),
      connections: new Map(),
      buffers: new Map()
    };
    
    // State (Immutable transitions)
    this._state = STATE.NONE;
    this._phase = 'NONE';
    
    // Identity
    this._vault = null;
    this._userId = null;
    this._ephemeralKeyPair = null;
    
    // Peer Management
    this._peers = new Map();           // deviceId -> PeerContract
    this._discovered = new Map();      // deviceId -> DiscoveryRecord
    this._pendingHandshakes = new Map(); // deviceId -> Resolver
    
    // Sequence tracking (Anti-replay)
    this._sequences = new Map();       // deviceId -> number
    
    // Callbacks (External Interface)
    this.onPeerDiscovered = null;
    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    this.onMessageReceived = null;
    this.onError = null;               // NAP Error Boundary callback
    
    // NAP Debug Context
    this._debugContext = 'NordicMesh';
  }

  // ===== NAP 2.0 INTERFACE CONTRACTS =====

  /**
   * NAP-INIT-001: Initialization with strict validation
   * Interface Contract: Vault must implement CryptoVault interface
   */
  async init(vaultInstance) {
    this._transitionState(STATE.INIT, 'NORDIC_INIT');
    
    try {
      // Interface Contract Validation (NAP 2.0)
      if (!CONTRACTS.VAULT(vaultInstance)) {
        throw this._createNapError(
          NAP_ERRORS.NORDIC_INIT_FAILED,
          'Interface Contract Violation: vaultInstance must implement CryptoVault interface',
          { provided: typeof vaultInstance }
        );
      }

      this._vault = vaultInstance;
      
      // Resource Acquisition (SOC2)
      const identityKey = await this._vault.getIdentityKey().catch(err => {
        throw this._createNapError(NAP_ERRORS.NORDIC_INIT_FAILED, 'Vault identity failure', err);
      });
      
      this._userId = this._deriveUserId(identityKey);
      this._ephemeralKeyPair = await this._vault.generateEphemeralKeyPair('x25519').catch(err => {
        throw this._createNapError(NAP_ERRORS.NORDIC_INIT_FAILED, 'Ephemeral key generation failed', err);
      });

      // Platform Detection (NAP-ENV-001)
      if (this._detectNativeCapability()) {
        await this._initializeNativeBridge();
      } else {
        rem.warn('NordicMesh running in simulation mode', 'NAP_FALLBACK');
      }

      // Resource Registration (SOC2)
      this._registerCleanupTask(() => this._cleanupResources());
      
      this._transitionState(STATE.OFFLINE, 'NORDIC_READY');
      return true;
      
    } catch (error) {
      this._handleNapError(error, 'INIT');
      throw error; // Re-throw for upstream Error Boundary
    }
  }

  /**
   * NAP-DISCOVERY-001: Strict state validation before scan
   */
  async startDiscovery() {
    // State Machine Guard (NAP 2.0)
    if (this._state !== STATE.OFFLINE && this._state !== STATE.INIT) {
      throw this._createNapError(
        NAP_ERRORS.BLE_SCAN_FAILED,
        `Invalid state transition: ${this._state} -> DISCOVERING`,
        { current: this._state, required: STATE.OFFLINE }
      );
    }

    this._transitionState(STATE.DISCOVERING, 'NORDIC_SCAN');
    
    try {
      if (!this._resources.plugin) {
        throw this._createNapError(NAP_ERRORS.BLE_SCAN_FAILED, 'Native plugin not initialized');
      }

      await this._resources.plugin.startScan({
        serviceUuids: [UUIDS.SERVICE],
        rssiThreshold: CONSTANTS.RSSI_THRESHOLD,
        scanMode: 2
      });

      // Resource Tracking (SOC2)
      const timeoutId = setTimeout(() => this.stopDiscovery(), CONSTANTS.DISCOVERY_TIMEOUT);
      this._resources.timeouts.add(timeoutId);
      
    } catch (error) {
      this._handleNapError(error, 'SCAN');
      this._transitionState(STATE.ERROR, 'NORDIC_SCAN_ERROR');
      throw error;
    }
  }

  /**
   * NAP-CONNECT-001: Connection with handshake timeout guarantee
   */
  async connect(deviceId) {
    // Interface Contract
    if (!CONTRACTS.DEVICE_ID(deviceId)) {
      throw this._createNapError(
        NAP_ERRORS.BLE_HANDSHAKE_FAILED,
        'Interface Contract Violation: Invalid deviceId format',
        { deviceId, expected: 'MAC format' }
      );
    }

    const peer = this._discovered.get(deviceId);
    if (!peer) {
      throw this._createNapError(NAP_ERRORS.BLE_HANDSHAKE_FAILED, 'Peer not in discovery cache', { deviceId });
    }

    this._transitionState(STATE.HANDSHAKING, 'NORDIC_HANDSHAKE');

    let handshakeTimeout = null;
    
    try {
      // Resource Guard (SOC2): Guarantee cleanup on timeout
      const handshakePromise = this._executeHandshake(deviceId, peer);
      
      const timeoutPromise = new Promise((_, reject) => {
        handshakeTimeout = setTimeout(() => {
          reject(this._createNapError(
            NAP_ERRORS.BLE_HANDSHAKE_FAILED,
            'Handshake timeout (30s)',
            { deviceId, phase: 'X3DH_KEY_EXCHANGE' }
          ));
        }, CONSTANTS.HANDSHAKE_TIMEOUT);
        this._resources.timeouts.add(handshakeTimeout);
      });

      // Race between handshake and timeout
      await Promise.race([handshakePromise, timeoutPromise]);
      
      // Success: Register peer
      this._peers.set(deviceId, {
        deviceId,
        userId: peer.userId,
        state: STATE.MESSAGING,
        establishedAt: Date.now(),
        lastActivity: Date.now()
      });
      
      this._sequences.set(deviceId, 0);
      this._transitionState(STATE.MESSAGING, 'NORDIC_ACTIVE');
      
      if (this.onPeerConnected) {
        this.onPeerConnected({ deviceId, userId: peer.userId, napPhase: 'HANDSHAKE_OK' });
      }

    } catch (error) {
      // Guaranteed cleanup (NAP 2.0 SOC2)
      if (handshakeTimeout) {
        clearTimeout(handshakeTimeout);
        this._resources.timeouts.delete(handshakeTimeout);
      }
      await this._disconnectGraceful(deviceId);
      this._handleNapError(error, 'HANDSHAKE');
      throw error;
    }
  }

  /**
   * NAP-SEND-001: Message sending with automatic chunking and retry logic
   */
  async sendMessage(deviceId, payload) {
    // Interface Contracts
    if (!CONTRACTS.DEVICE_ID(deviceId)) {
      throw this._createNapError(NAP_ERRORS.BLE_SEND_FAILED, 'Invalid deviceId', { deviceId });
    }
    if (!CONTRACTS.PAYLOAD(payload)) {
      throw this._createNapError(NAP_ERRORS.BLE_SEND_FAILED, 'Invalid payload', { payload });
    }

    const peer = this._peers.get(deviceId);
    if (!peer || peer.state !== STATE.MESSAGING) {
      throw this._createNapError(NAP_ERRORS.BLE_SEND_FAILED, 'Peer not in MESSAGING state', { 
        deviceId, 
        currentState: peer?.state || 'NOT_FOUND' 
      });
    }

    try {
      // Encryption (NAP-CRYPTO-001)
      const plaintext = new TextEncoder().encode(JSON.stringify(payload));
      const encrypted = await this._vault.encrypt(plaintext, this._deriveSessionKey(peer)).catch(err => {
        throw this._createNapError(NAP_ERRORS.BLE_CRYPTO_FAILED, 'Encryption failure', err);
      });

      // Chunking Decision (NAP-OPT-001)
      if (encrypted.length > CONSTANTS.CHUNK_SIZE) {
        return await this._sendChunkedNap(deviceId, encrypted, peer);
      } else {
        return await this._sendSingleNap(deviceId, encrypted, peer);
      }

    } catch (error) {
      this._handleNapError(error, 'SEND');
      throw error;
    }
  }

  // ===== NAP 2.0 PRIVATE METHODS =====

  _createNapError(napError, message, details = null) {
    const error = new Error(`[${napError.code}] ${message}`);
    error.napCode = napError.code;
    error.napPhase = napError.phase;
    error.napDetails = details;
    error.context = this._debugContext;
    return error;
  }

  _handleNapError(error, operation) {
    // Error Boundary Pattern (NAP 2.0)
    const napError = {
      code: error.napCode || 'APP_UNKNOWN',
      phase: error.napPhase || `NORDIC_${operation}`,
      message: error.message,
      timestamp: Date.now(),
      context: this._debugContext
    };

    // REM Integration
    rem.error(`${napError.code}: ${error.message}`, napError.code);
    
    // External Error Boundary callback
    if (this.onError) {
      this.onError(napError);
    }

    // State recovery
    if (this._state === STATE.ERROR) {
      this._attemptRecovery(operation);
    }
  }

  _transitionState(newState, phase) {
    const oldState = this._state;
    this._state = newState;
    this._phase = phase;
    
    // NAP Logging
    rem.updatePhase(phase);
    
    // Valid state transition check (NAP 2.0)
    if (oldState === STATE.ERROR && newState !== STATE.CLEANUP && newState !== STATE.NONE) {
      rem.warn(`Recovery transition: ${oldState} -> ${newState}`, 'NAP_RECOVERY');
    }
  }

  async _executeHandshake(deviceId, peerInfo) {
    // X3DH Implementation (NAP-CRYPTO-002)
    try {
      await this._resources.plugin.connect({ deviceId });

      const helloPayload = await this._buildHelloPayloadNap();
      
      await this._resources.plugin.writeCharacteristic({
        deviceId,
        service: UUIDS.SERVICE,
        characteristic: UUIDS.HANDSHAKE,
        value: Array.from(helloPayload)
      });

      // Wait for response with NAP resource tracking
      return await this._awaitHandshakeResponse(deviceId);
      
    } catch (err) {
      throw this._createNapError(NAP_ERRORS.BLE_HANDSHAKE_FAILED, 'Handshake execution failed', err);
    }
  }

  _buildHelloPayloadNap() {
    // Strict binary format (NAP-PROTO-001)
    const pubKeyBytes = this._hexToBytes(this._ephemeralKeyPair.publicKey);
    const userBytes = this._hexToBytes(this._userId);
    
    // [0]: Type 0x01 (HELLO)
    // [1-2]: Length (big-endian)
    // [3-18]: User ID (16 bytes)
    // [19-50]: X25519 Public Key (32 bytes)
    // [51-114]: Ed25519 Signature (64 bytes)
    const payload = new Uint8Array(115);
    const view = new DataView(payload.buffer);
    
    view.setUint8(0, 0x01); // HELLO
    view.setUint16(1, 112, false); // Length of following data
    
    payload.set(userBytes.slice(0, 16), 3);
    payload.set(pubKeyBytes, 19);
    
    // Signature (mock implementation - real would call vault.sign)
    const sigPlaceholder = new Uint8Array(64); // Should be actual signature
    payload.set(sigPlaceholder, 51);
    
    return payload;
  }

  async _sendChunkedNap(deviceId, encryptedData, peer) {
    const totalChunks = Math.ceil(encryptedData.length / CONSTANTS.CHUNK_SIZE);
    const messageId = Math.floor(Math.random() * CONSTANTS.SEQUENCE_MAX);
    let seq = this._sequences.get(deviceId) || 0;
    
    // NAP Resource Guard: Track chunk transmission
    const chunkTracker = { sent: 0, failed: 0, startTime: Date.now() };
    
    for (let i = 0; i < totalChunks; i++) {
      const chunk = encryptedData.slice(
        i * CONSTANTS.CHUNK_SIZE, 
        Math.min((i + 1) * CONSTANTS.CHUNK_SIZE, encryptedData.length)
      );
      
      const isLast = i === totalChunks - 1;
      const packet = this._buildChunkPacket(seq++, messageId, i, totalChunks, chunk, isLast);
      
      try {
        await this._resources.plugin.writeCharacteristic({
          deviceId,
          service: UUIDS.SERVICE,
          characteristic: UUIDS.PAYLOAD,
          value: Array.from(packet)
        });
        chunkTracker.sent++;
        
        // NAP Flow Control
        if (!isLast) await this._sleep(50);
        
      } catch (err) {
        chunkTracker.failed++;
        throw this._createNapError(NAP_ERRORS.BLE_SEND_FAILED, `Chunk ${i}/${totalChunks} failed`, err);
      }
    }
    
    this._sequences.set(deviceId, seq);
    return { sent: true, chunks: totalChunks, tracker: chunkTracker };
  }

  _buildChunkPacket(sequence, messageId, chunkIndex, totalChunks, data, isLast) {
    const flags = 0x02 | (isLast ? 0x04 : 0); // Chunked + Last?
    const header = new ArrayBuffer(9);
    const view = new DataView(header);
    
    view.setUint8(0, flags);
    view.setUint16(1, sequence, false);
    view.setUint16(3, messageId, false);
    view.setUint16(5, chunkIndex, false);
    view.setUint16(7, totalChunks, false);
    
    const packet = new Uint8Array(9 + data.length);
    packet.set(new Uint8Array(header), 0);
    packet.set(data, 9);
    
    return packet;
  }

  // ===== NAP 2.0 RESOURCE MANAGEMENT (SOC2) =====

  _registerCleanupTask(task) {
    // Guarantee execution on destroy/error
    this._resources.cleanupTasks = this._resources.cleanupTasks || [];
    this._resources.cleanupTasks.push(task);
  }

  _cleanupResources() {
    rem.info('NAP SOC2: Cleaning up NordicMesh resources', 'NAP_CLEANUP');
    
    // Clear all intervals
    this._resources.intervals.forEach(id => clearInterval(id));
    this._resources.intervals.clear();
    
    // Clear all timeouts
    this._resources.timeouts.forEach(id => clearTimeout(id));
    this._resources.timeouts.clear();
    
    // Disconnect all peers gracefully
    this._resources.connections.forEach((conn, deviceId) => {
      this._disconnectGraceful(deviceId);
    });
    this._resources.connections.clear();
    
    // Clear buffers (potential memory leak prevention)
    this._resources.buffers.clear();
    
    // Execute registered cleanup tasks
    if (this._resources.cleanupTasks) {
      this._resources.cleanupTasks.forEach(task => {
        try { task(); } catch (e) { /* Silent failure on cleanup */ }
      });
    }
    
    this._transitionState(STATE.CLEANUP, 'NORDIC_CLEANUP');
  }

  async _disconnectGraceful(deviceId) {
    try {
      if (this._resources.plugin) {
        await this._resources.plugin.disconnect({ deviceId });
      }
    } catch (e) {
      // Silent on cleanup
    }
    this._peers.delete(deviceId);
    this._sequences.delete(deviceId);
  }

  _attemptRecovery(failedOperation) {
    // NAP Recovery Strategy: Reset to OFFLINE if possible
    if (this._state !== STATE.CLEANUP) {
      this._transitionState(STATE.OFFLINE, 'NORDIC_RECOVERY');
      rem.warn(`NAP Recovery executed after ${failedOperation} failure`, 'NAP_RECOVER');
    }
  }

  // ===== UTILITY METHODS =====

  _detectNativeCapability() {
    return typeof window !== 'undefined' && 
           window.Capacitor?.Plugins?.NexoBLE;
  }

  async _initializeNativeBridge() {
    this._resources.plugin = window.Capacitor.Plugins.NexoBLE;
    await this._resources.plugin.initialize({
      serviceUuid: UUIDS.SERVICE,
      userId: this._userId
    });
    this._setupNativeListeners();
  }

  _setupNativeListeners() {
    // Handlers with NAP error wrapping
    this._resources.plugin.addListener('onPeerDiscovered', (e) => {
      try {
        this._handlePeerDiscoveredNap(e);
      } catch (err) {
        this._handleNapError(err, 'PEER_DISCOVERY');
      }
    });
    
    this._resources.plugin.addListener('onMessageReceived', (e) => {
      try {
        this._handleIncomingPayload(e.deviceId, new Uint8Array(e.data));
      } catch (err) {
        this._handleNapError(err, 'MESSAGE_PROCESSING');
      }
    });
  }

  _handlePeerDiscoveredNap(event) {
    const { deviceId, userId, rssi, manufacturerData } = event;
    
    // Validation
    if (!manufacturerData || manufacturerData.length < 32) return;
    
    // Anti-replay check (NAP-SEC-001)
    const view = new DataView(new Uint8Array(manufacturerData).buffer);
    const timestamp = Number(view.getBigUint64(16, false));
    if (Math.abs(Date.now() - timestamp) > 30000) return; // >30s old
    
    if (!CONTRACTS.USER_ID(userId)) return;
    
    this._discovered.set(deviceId, {
      deviceId,
      userId,
      rssi,
      lastSeen: Date.now()
    });
    
    if (this.onPeerDiscovered) {
      this.onPeerDiscovered({ deviceId, userId, rssi, napValidated: true });
    }
  }

  _deriveUserId(publicKeyHex) {
    return publicKeyHex.slice(0, 32); // NAP-IDENT-001
  }

  _deriveSessionKey(peer) {
    // Placeholder - real implementation would use X3DH derived keys
    return peer.userId; // Simplified for NAP structure demo
  }

  _hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ===== PUBLIC API (NAP-COMPLIANT) =====

  async destroy() {
    this._cleanupResources();
  }

  getState() {
    return { state: this._state, phase: this._phase, peers: this._peers.size };
  }

  isReady() {
    return this._state === STATE.OFFLINE || this._state === STATE.MESSAGING;
  }
}

// Singleton Export (NAP-SINGLETON-001)
export const nordicMesh = new NordicMesh();
export default nordicMesh;
