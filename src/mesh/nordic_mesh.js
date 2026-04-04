/**
 * NordicMesh - Protocolo BLE NEXO v1.0
 * v1.3-NAP - FIX: Modo Pasivo/Autenticado (Build #457)
 * 
 * CAMBIOS:
 * - Inicia en modo pasivo (sin Vault unlock)
 * - Se autentica realmente tras Vault unlock
 * - Operaciones sensibles protegidas
 */

const UUIDS = Object.freeze({
  SERVICE: 'a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d',
  ANNOUNCE: 'b4c6d9e3-f2a5-4b8c-ad4e-7f9a2b3c6d8e',
  HANDSHAKE: 'c5d7eaf4-a3b6-4c9d-be5f-8a0c3d4e7f9a',
  PAYLOAD: 'd6e8f0a5-b4c7-4d0e-cf6a-9b1e4f5a8b0c',
  CONTROL: 'e7f9a0b6-c5d8-4e1f-da7b-0c2f5e6a9b1d'
});

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
  NORDIC_010: 'MESSAGE_TOO_LARGE',
  NORDIC_011: 'PLUGIN_NOT_INITIALIZED',
  NORDIC_012: 'VAULT_LOCKED_AT_CONSTRUCTION',
  NORDIC_013: 'IDENTITY_UNAVAILABLE',
  NORDIC_014: 'VAULT_NOT_AUTHENTICATED' // NUEVO
});

const CONTRACTS = {
  DEVICE_ID: (id) => typeof id === 'string' && /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(id),
  USER_ID: (id) => typeof id === 'string' && /^[a-f0-9]{32,64}$/i.test(id),
  VAULT: (v) => v && typeof v.getIdentityKey === 'function' && typeof v.getIdentity === 'function',
  CALLBACK: (cb) => typeof cb === 'function'
};

class NordicMesh {
  constructor(vault, options = {}) {
    if (!CONTRACTS.VAULT(vault)) {
      throw new Error(`[NAP ${ERRORS.NORDIC_002}] Vault must provide getIdentityKey() and getIdentity()`);
    }

    this.vault = vault;
    this.options = Object.freeze({
      chunkSize: 507,
      rssiThreshold: -85,
      handshakeTimeout: 30000,
      maxRetries: 3,
      ...options
    });
    
    this.state = STATE.NONE;
    this.peers = new Map();
    this.sessions = new Map();
    this.listeners = new Set();
    this.cleanupHandlers = new Set();
    this.initPromise = null;
    this.userId = null;
    this.isNative = false;
    this.NexoBLE = null;
    
    // NUEVO: Flag de autenticación
    this._authenticated = false;
    
    this._onPeerDiscovered = this._onPeerDiscovered.bind(this);
    this._onConnectionChanged = this._onConnectionChanged.bind(this);
    this._onMessageReceived = this._onMessageReceived.bind(this);
  }

  async _detectPlugin() {
    try {
      if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.NexoBLE) {
        this.NexoBLE = window.Capacitor.Plugins.NexoBLE;
        this.isNative = true;
        console.log('[NordicMesh] ✅ Native plugin via Capacitor.Plugins');
        return true;
      }
      
      try {
        const module = await import('../../plugins/nexo-ble/src/index.js');
        if (module.NexoBLE) {
          this.NexoBLE = module.NexoBLE;
          this.isNative = false;
          console.log('[NordicMesh] ⚠️  Web stub via import');
          return false;
        }
      } catch (e) {}
      
      this.NexoBLE = {
        initialize: async () => ({ userId: 'web-stub' }),
        startAdvertising: async () => {},
        stopAdvertising: async () => {},
        startScan: async () => {},
        stopScan: async () => {},
        connect: async () => {},
        disconnect: async () => {},
        getConnectedDevices: async () => ({ devices: [] }),
        sendMessage: async () => { throw new Error('BLE not available in web'); },
        addListener: () => ({ remove: () => {} }),
        updateIdentity: async () => {} // NUEVO: Para actualización post-unlock
      };
      
      this.isNative = false;
      console.warn('[NordicMesh] ⚠️  Inline web stub activated');
      return false;
      
    } catch (error) {
      this._setState(STATE.ERROR, { code: ERRORS.NORDIC_001, error });
      throw error;
    }
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  /**
   * FIX #457: Inicia en modo pasivo (sin requerir Vault unlock)
   */
  async _doInit() {
    try {
      this._setState(STATE.INIT);
      await this._detectPlugin();
      
      const timeout = setTimeout(() => {
        if (this.state === STATE.INIT) {
          this._setState(STATE.ERROR, { code: ERRORS.NORDIC_003 });
        }
      }, 10000);
      
      // FIX: Usar getIdentity() (no requiere unlock) para modo pasivo inicial
      let provisionalId = this.vault.getIdentity ? this.vault.getIdentity() : null;
      
      if (!provisionalId) {
        // Fallback a ID temporal si no hay identidad en Vault
        provisionalId = 'nexo_temp_' + Math.random().toString(36).substring(2, 10);
        console.warn('[NordicMesh] Usando ID temporal hasta Vault unlock:', provisionalId);
      }
      
      this.userId = provisionalId;
      this._authenticated = false; // Inicia no autenticado
      
      // Inicializar plugin con ID provisional (escaneo pasivo funciona)
      await this.NexoBLE.initialize({ userId: this.userId });
      await this._setupListeners();
      
      clearTimeout(timeout);
      this._setState(STATE.OFFLINE);
      
      // Si Vault ya está desbloqueado (caso edge), autenticar inmediato
      if (!this.vault.isLocked()) {
        await this._activateAuthenticatedMode();
      }
      
      return { 
        success: true, 
        isNative: this.isNative, 
        userId: this.userId, 
        authenticated: this._authenticated 
      };
      
    } catch (error) {
      const errorCode = error.message?.includes('CRYPTO_') ? 
        ERRORS.NORDIC_013 : (error.code || ERRORS.NORDIC_001);
      
      this._setState(STATE.ERROR, { 
        code: errorCode, 
        error: error.message,
        source: 'vault'
      });
      return { success: false, error };
    }
  }

  /**
   * NUEVO: Activar modo autenticado (llamar tras [CRYPTO_002])
   */
  async activateWithVault() {
    if (this._authenticated) {
      return { success: true, alreadyActive: true };
    }
    
    try {
      console.log('[NordicMesh] Activando con Vault...');
      
      // Ahora sí obtenemos identidad criptográfica real (requiere unlock)
      const realIdentity = await this.vault.getIdentityKey();
      
      // Actualizar en plugin nativo si soporta updateIdentity
      if (this.NexoBLE.updateIdentity) {
        await this.NexoBLE.updateIdentity({ userId: realIdentity });
      }
      
      this.userId = realIdentity;
      this._authenticated = true;
      
      console.log('[NordicMesh] ✅ Autenticado:', realIdentity.substring(0, 8) + '...');
      this._emit('authenticated', { userId: realIdentity });
      
      return { success: true };
      
    } catch (error) {
      console.error('[NordicMesh] ❌ Fallo autenticación:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * NUEVO: Verificación interna de autenticación
   */
  _checkAuth() {
    if (!this._authenticated) {
      throw new Error(`[NAP ${ERRORS.NORDIC_014}] Vault not authenticated - call activateWithVault() first`);
    }
  }

  async _setupListeners() {
    const handlers = [
      { event: 'onPeerDiscovered', handler: this._onPeerDiscovered },
      { event: 'onConnectionStateChanged', handler: this._onConnectionChanged },
      { event: 'onMessageReceived', handler: this._onMessageReceived }
    ];

    for (const { event, handler } of handlers) {
      try {
        const sub = await this.NexoBLE.addListener(event, handler);
        if (sub?.remove) this.cleanupHandlers.add(sub.remove);
      } catch (e) {
        console.warn(`[NordicMesh] Listener ${event} skipped:`, e.message);
      }
    }
  }

  // === API PÚBLICA ===

  async startDiscovery() {
    // FIX: Permitir descubrimiento pasivo sin autenticación
    if (![STATE.OFFLINE, STATE.CONNECTED].includes(this.state)) {
      this._emit('error', { code: 'INVALID_STATE', currentState: this.state });
      return false;
    }
    
    this._setState(STATE.DISCOVERING);
    
    try {
      await this.NexoBLE.startAdvertising();
      await this.NexoBLE.startScan();
      
      const timer = setTimeout(() => {
        if (this.state === STATE.DISCOVERING) {
          this.stopDiscovery();
          this._emit('scanTimeout', { duration: 10000 });
        }
      }, 10000);
      
      this.cleanupHandlers.add(() => clearTimeout(timer));
      return true;
      
    } catch (error) {
      this._setState(STATE.ERROR, { code: ERRORS.NORDIC_008, error });
      return false;
    }
  }

  async stopDiscovery() {
    try {
      await this.NexoBLE.stopScan();
      if (this.state === STATE.DISCOVERING) {
        this._setState(STATE.OFFLINE);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async connect(deviceId) {
    // FIX: Requiere autenticación para conectar (operación sensible)
    this._checkAuth();
    
    if (!CONTRACTS.DEVICE_ID(deviceId)) {
      const err = { code: ERRORS.NORDIC_004, message: 'Invalid MAC format' };
      this._emit('error', err);
      throw new Error(`[NAP ${err.code}]`);
    }
    
    this._setState(STATE.HANDSHAKING);
    
    try {
      await this.NexoBLE.connect({ deviceId });
      
      const timer = setTimeout(() => {
        if (!this.sessions.has(deviceId)) {
          this.disconnect(deviceId);
          this._emit('handshakeFailed', { deviceId, code: ERRORS.NORDIC_007 });
        }
      }, this.options.handshakeTimeout);
      
      this.cleanupHandlers.add(() => clearTimeout(timer));
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
      this.sessions.delete(deviceId);
      return true;
    } catch (e) {
      return false;
    }
  }

  async getConnectedDevices() {
    try {
      const result = await this.NexoBLE.getConnectedDevices();
      return result?.devices || [];
    } catch (error) {
      console.warn('[NordicMesh] getConnectedDevices failed:', error);
      return [];
    }
  }

  async sendMessage(deviceId, plaintext) {
    // FIX: Requiere autenticación para enviar mensajes
    this._checkAuth();
    
    if (!CONTRACTS.DEVICE_ID(deviceId)) {
      throw new Error(`[NAP ${ERRORS.NORDIC_004}]`);
    }
    
    if (!this.sessions.has(deviceId)) {
      throw new Error(`[NAP ${ERRORS.NORDIC_005}]`);
    }
    
    this._setState(STATE.MESSAGING);
    
    try {
      const session = this.sessions.get(deviceId);
      const encrypted = await this.vault.encrypt(plaintext, session.key);
      
      const envelope = {
        payload: encrypted,
        timestamp: Date.now(),
        seq: session.seq++
      };
      
      const bytes = new TextEncoder().encode(JSON.stringify(envelope));
      
      if (bytes.length > 65535) {
        throw new Error(`[NAP ${ERRORS.NORDIC_010}]`);
      }
      
      await this.NexoBLE.sendMessage({
        deviceId,
        data: Array.from(bytes)
      });
      
      this._emit('messageSent', { deviceId });
      return true;
      
    } catch (error) {
      this._setState(STATE.ERROR, { code: ERRORS.NORDIC_006, error });
      return false;
    }
  }

  // === HANDLERS ===

  _onPeerDiscovered(peer) {
    if (!peer || peer.rssi < this.options.rssiThreshold) return;
    
    const peerInfo = Object.freeze({
      id: peer.id || peer.address,
      name: peer.name || 'NEXO-Peer',
      rssi: peer.rssi,
      userId: peer.userId,
      timestamp: Date.now(),
      authenticated: this._authenticated // Indicar si estamos autenticados
    });
    
    this.peers.set(peerInfo.id, peerInfo);
    this._emit('peerDiscovered', peerInfo);
  }

  _onConnectionChanged(state) {
    if (state.state === 'connected') {
      this._setState(STATE.CONNECTED);
      this._emit('peerConnected', { deviceId: state.deviceId });
    } else {
      this.sessions.delete(state.deviceId);
      this._emit('peerDisconnected', { deviceId: state.deviceId });
      if (this.sessions.size === 0) this._setState(STATE.OFFLINE);
    }
  }

  _onMessageReceived(msg) {
    try {
      if (!msg?.data) return;
      const data = new Uint8Array(msg.data);
      const envelope = JSON.parse(new TextDecoder().decode(data));
      
      this._emit('messageReceived', {
        deviceId: msg.deviceId,
        content: envelope.payload,
        timestamp: envelope.timestamp
      });
    } catch (error) {
      this._emit('error', { type: 'decryption', error });
    }
  }

  // === UTILS ===

  _setState(newState, error = null) {
    const old = this.state;
    this.state = newState;
    this._emit('stateChanged', { from: old, to: newState, error });
  }

  _emit(event, data) {
    this.listeners.forEach(cb => {
      try { cb(event, data); } catch (e) {}
    });
  }

  on(callback) {
    if (!CONTRACTS.CALLBACK(callback)) {
      throw new Error('Listener must be function');
    }
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getPeers() {
    return Array.from(this.peers.values());
  }

  getState() {
    return {
      state: this.state,
      authenticated: this._authenticated,
      userId: this.userId
    };
  }

  isAuthenticated() {
    return this._authenticated;
  }

  destroy() {
    this._setState(STATE.CLEANUP);
    this.cleanupHandlers.forEach(fn => { try { fn(); } catch(e) {} });
    this.cleanupHandlers.clear();
    this.NexoBLE?.stopAdvertising?.();
    this.NexoBLE?.stopScan?.();
    this.peers.clear();
    this.sessions.clear();
    this.listeners.clear();
    this.initPromise = null;
    this._authenticated = false;
    this._setState(STATE.NONE);
  }
}

export { NordicMesh, STATE, UUIDS, ERRORS };
export default NordicMesh;
