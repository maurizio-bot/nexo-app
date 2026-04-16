/**
 * NordicMesh - Protocolo BLE NEXO v1.3-NAP
 * FIX: Permitir re-intento de inicialización si falló previamente
 */

const UUIDS = Object.freeze({
  SERVICE: 'a3b5c8d2-e1f4-4a7b-9c3d-6e8f1a2b5c7d',
  ANNOUNCE: 'b4c6d9e3-f2a5-4b8c-ad4e-7f9a2b3c6d8e',
  HANDSHAKE: 'c5d7eaf4-a3b6-4c9d-be5f-8a0c3d4e7f9a',
  PAYLOAD: 'd6e8f0a5-b4c7-4d0e-cf6a-9b1e4f5a8b0c',
  CONTROL: 'e7f9a0b6-c5d8-4e1f-da7b-0c2f5e6a9b1d'
});

const STATE = Object.freeze({
  NONE: 'none', INIT: 'init', OFFLINE: 'offline',
  DISCOVERING: 'discovering', HANDSHAKING: 'handshaking',
  CONNECTED: 'connected', MESSAGING: 'messaging',
  ERROR: 'error', CLEANUP: 'cleanup'
});

class NordicMesh {
  constructor(vault, options = {}) {
<<<<<<< HEAD
    if (!vault) throw new Error('[NORDIC_002] Vault is required');
=======
    if (!vault) {
      throw new Error('[NORDIC_002] Vault is required');
    }
    
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
    this.vault = vault;
    this._vaultReady = typeof vault.getIdentityKey === 'function';
    this.options = { chunkSize: 507, rssiThreshold: -85, handshakeTimeout: 30000, ...options };
    this.state = STATE.NONE;
    this.peers = new Map();
    this.sessions = new Map();
    this.eventListeners = new Map();
    this.cleanupHandlers = new Set();
    this.initPromise = null;
    this.userId = null;
    this.isNative = false;
    this.NexoBLE = null;
    this.bluetoothEnabled = false;
  }

  async _detectPlugin() {
    try {
      if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.NexoBLE) {
        this.NexoBLE = window.Capacitor.Plugins.NexoBLE;
        this.isNative = true;
        console.log('[NordicMesh] ✅ Native plugin detected');
        return true;
      }
      this.NexoBLE = {
        initialize: async () => ({ userId: 'web-stub', status: 'initialized' }),
        startAdvertising: async () => {}, stopAdvertising: async () => {},
        startScan: async () => {}, stopScan: async () => {},
        connect: async () => {}, disconnect: async () => {},
        getConnectedDevices: async () => ({ devices: [] }),
        sendMessage: async () => { throw new Error('BLE not available'); },
        addListener: () => ({ remove: () => {} }),
        isBluetoothEnabled: async () => false
      };
      this.isNative = false;
      console.warn('[NordicMesh] ⚠️ Web stub mode');
      return false;
    } catch (error) {
      throw new Error(`[NORDIC_001] Plugin detection failed: ${error.message}`);
    }
  }

  async checkBluetooth() {
    try {
      if (this.NexoBLE?.isBluetoothEnabled) {
        this.bluetoothEnabled = await this.NexoBLE.isBluetoothEnabled();
      }
      return this.bluetoothEnabled;
    } catch (e) { return false; }
  }

  _getIdentitySafely() {
    try {
<<<<<<< HEAD
      if (!this._vaultReady) return this._generateTempId();
=======
      if (!this._vaultReady) {
        return this._generateTempId();
      }
      
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
      const id = this.vault.getIdentityKey();
      if (!id) throw new Error('Empty identity');
      return id;
    } catch (err) {
      return this._generateTempId();
    }
  }

  _generateTempId() {
    return 'nexo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

<<<<<<< HEAD
  // FIX v1.3-NAP: Permitir re-intento si falló
  async init() {
    if (this.initPromise) {
      try {
        const result = await this.initPromise;
        if (result.success) return result;
        this.initPromise = null; // Falló, reintentar
      } catch (e) {
        this.initPromise = null; // Excepción, reintentar
      }
    }
=======
  // ============================================
  // FIX v1.3-NAP: Permitir re-intento si falló
  // ============================================
  async init() {
    // Si hay una promesa previa, verificar si fue exitosa o fallida
    if (this.initPromise) {
      try {
        const result = await this.initPromise;
        if (result.success) {
          console.log('[NordicMesh] Init cache hit (success)');
          return result; // Fue exitosa, retornar cache
        }
        // Falló anteriormente, limpiar para re-intento
        console.log('[NordicMesh] Previous init failed, retrying...');
        this.initPromise = null;
      } catch (e) {
        // Hubo excepción, limpiar para re-intento
        console.log('[NordicMesh] Previous init threw exception, retrying...');
        this.initPromise = null;
      }
    }
    
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  async _doInit() {
    try {
      this._setState(STATE.INIT);
      await this._detectPlugin();
<<<<<<< HEAD
      const btEnabled = await this.checkBluetooth();
      const identityKey = this._getIdentitySafely();
      this.userId = identityKey;
      
=======
      
      const btEnabled = await this.checkBluetooth();
      if (!btEnabled && this.isNative) {
        console.warn('[NordicMesh] ⚠️ Bluetooth apagado - modo offline');
      }
      
      const identityKey = this._getIdentitySafely();
      this.userId = identityKey;
      
      console.log('[NordicMesh] Initializing with userId:', identityKey.substring(0, 8) + '...');
      
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
      let initResult;
      try {
        initResult = await this.NexoBLE.initialize({ userId: identityKey });
      } catch (bleError) {
<<<<<<< HEAD
=======
        console.error('[NordicMesh] BLE initialize failed:', bleError.message);
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
        if (this.isNative) {
          this.isNative = false;
          initResult = { userId: identityKey, status: 'stub-fallback' };
        } else throw bleError;
      }
      
      await this._setupListeners();
      this._setState(STATE.OFFLINE);
      return { success: true, isNative: this.isNative, userId: this.userId, bluetooth: btEnabled };
    } catch (error) {
      this._setState(STATE.ERROR);
      return { success: false, error: { message: error.message, code: 'NORDIC_INIT_FAILED' }};
    }
  }

  async _setupListeners() {
    const events = ['onPeerDiscovered', 'onConnectionStateChanged', 'onMessageReceived'];
    for (const event of events) {
      try {
<<<<<<< HEAD
        const mapped = event.replace('on', '').toLowerCase();
        await this.NexoBLE.addListener(mapped, (data) => {
          this._emit(this._mapEventName(mapped), data);
=======
        const nativeEvent = event.replace('on', '').toLowerCase();
        const mappedEvent = nativeEvent === 'peerdiscovered' ? 'onPeerDiscovered' :
                          nativeEvent === 'connectionstatechanged' ? 'onConnectionStateChanged' :
                          nativeEvent === 'messagereceived' ? 'onMessageReceived' : event;
        
        await this.NexoBLE.addListener(mappedEvent, (data) => {
          const transformed = this._transformEventData(mappedEvent, data);
          this._emit(this._mapEventName(mappedEvent), transformed);
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
        });
      } catch (e) {}
    }
  }

<<<<<<< HEAD
  _mapEventName(n) {
    const map = { 'peerdiscovered': 'peerDiscovered', 'connectionstatechanged': 'connectionStateChanged', 'messagereceived': 'messageReceived' };
    return map[n] || n;
=======
  _mapEventName(nativeEvent) {
    const mapping = {
      'onPeerDiscovered': 'peerDiscovered',
      'onConnectionStateChanged': 'connectionStateChanged',
      'onMessageReceived': 'messageReceived'
    };
    return mapping[nativeEvent] || nativeEvent;
  }

  _transformEventData(event, data) {
    if (event === 'onPeerDiscovered') {
      return {
        id: data.id || data.address,
        name: data.name || `NEXO-${(data.address || '').slice(-4)}`,
        rssi: data.rssi || -80,
        userId: data.userId || '',
        timestamp: Date.now()
      };
    }
    return data;
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
  }

  on(event, callback) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, new Set());
    this.eventListeners.get(event).add(callback);
    return () => this.eventListeners.get(event)?.delete(callback);
  }

  _emit(event, data) {
    this.eventListeners.get(event)?.forEach(cb => { try { cb(data); } catch (e) {} });
    this.eventListeners.get('*')?.forEach(cb => { try { cb(event, data); } catch (e) {} });
  }

  async startDiscovery() {
<<<<<<< HEAD
    if (this.state === STATE.ERROR) return false;
=======
    if (this.state === STATE.ERROR) {
      console.warn('[NordicMesh] Cannot start discovery in error state');
      return false;
    }
    
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
    const btEnabled = await this.checkBluetooth();
    if (!btEnabled) {
      this._emit('error', { code: 'BLUETOOTH_DISABLED', message: 'Activa Bluetooth' });
      return false;
    }
    this._setState(STATE.DISCOVERING);
    try {
      await this.NexoBLE.startAdvertising();
      await this.NexoBLE.startScan();
<<<<<<< HEAD
      setTimeout(() => { if (this.state === STATE.DISCOVERING) this.stopDiscovery(); }, 10000);
=======
      
      setTimeout(() => {
        if (this.state === STATE.DISCOVERING) {
          this.stopDiscovery();
          this._emit('scanTimeout', { duration: 10000 });
        }
      }, 10000);
      
>>>>>>> a44e1379fb9ce2ad3285ab1b364b7976a1d47129
      return true;
    } catch (error) {
      this._setState(STATE.ERROR);
      return false;
    }
  }

  async stopDiscovery() {
    try { await this.NexoBLE.stopScan(); } catch (e) {}
    if (this.state === STATE.DISCOVERING) this._setState(STATE.OFFLINE);
  }

  _setState(s) { this.state = s; this._emit('stateChanged', s); }
  getPeers() { return Array.from(this.peers.values()); }
  getState() { return this.state; }
  destroy() {
    this._setState(STATE.CLEANUP);
    this.NexoBLE?.stopAdvertising?.();
    this.NexoBLE?.stopScan?.();
  }
}

export { NordicMesh, STATE, UUIDS };
export default NordicMesh;
