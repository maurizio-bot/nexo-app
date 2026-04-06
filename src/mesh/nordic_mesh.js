/**
 * NordicMesh - Protocolo BLE NEXO v1.2-NAP
 * FIX: API on(event, callback) + Bluetooth validation
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
    if (!vault || typeof vault.getIdentityKey !== 'function') {
      throw new Error('[NORDIC_002] Vault must provide getIdentityKey()');
    }

    this.vault = vault;
    this.options = { chunkSize: 507, rssiThreshold: -85, handshakeTimeout: 30000, ...options };
    
    this.state = STATE.NONE;
    this.peers = new Map();
    this.sessions = new Map();
    this.eventListeners = new Map(); // FIX: Map por evento
    this.cleanupHandlers = new Set();
    this.initPromise = null;
    this.userId = null;
    this.isNative = false;
    this.NexoBLE = null;
    this.bluetoothEnabled = false; // FIX: Track Bluetooth state
  }

  async _detectPlugin() {
    try {
      if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.NexoBLE) {
        this.NexoBLE = window.Capacitor.Plugins.NexoBLE;
        this.isNative = true;
        console.log('[NordicMesh] ✅ Native plugin detected');
        return true;
      }
      
      // Web stub fallback
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
        isBluetoothEnabled: async () => false // FIX: Método para check Bluetooth
      };
      
      this.isNative = false;
      console.warn('[NordicMesh] ⚠️ Web stub mode - BLE limited');
      return false;
      
    } catch (error) {
      throw new Error(`[NORDIC_001] Plugin detection failed: ${error.message}`);
    }
  }

  // FIX: Verificar Bluetooth antes de inicializar
  async checkBluetooth() {
    try {
      if (this.NexoBLE?.isBluetoothEnabled) {
        this.bluetoothEnabled = await this.NexoBLE.isBluetoothEnabled();
      } else {
        this.bluetoothEnabled = false;
      }
      return this.bluetoothEnabled;
    } catch (e) {
      return false;
    }
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  async _doInit() {
    try {
      this._setState(STATE.INIT);
      
      await this._detectPlugin();
      
      // FIX: Verificar Bluetooth
      const btEnabled = await this.checkBluetooth();
      if (!btEnabled && this.isNative) {
        console.warn('[NordicMesh] ⚠️ Bluetooth apagado');
        // No lanzar error, dejar que la app maneje la UI
      }
      
      const identityKey = await this.vault.getIdentityKey();
      this.userId = identityKey;
      
      await this.NexoBLE.initialize({ userId: identityKey });
      await this._setupListeners();
      
      this._setState(STATE.OFFLINE);
      return { success: true, isNative: this.isNative, userId: this.userId, bluetooth: btEnabled };
      
    } catch (error) {
      this._setState(STATE.ERROR);
      return { success: false, error: error.message };
    }
  }

  async _setupListeners() {
    const events = ['peerDiscovered', 'connectionStateChanged', 'messageReceived'];
    
    for (const event of events) {
      try {
        await this.NexoBLE.addListener(event, (data) => this._emit(event, data));
      } catch (e) {
        console.warn(`[NordicMesh] Listener ${event} skipped:`, e.message);
      }
    }
  }

  // FIX #3: API on(event, callback) - Compatible con nexo_app.js
  on(event, callback) {
    if (typeof event !== 'string' || typeof callback !== 'function') {
      throw new Error('[NORDIC_005] on() requires (eventName, callback)');
    }
    
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    
    this.eventListeners.get(event).add(callback);
    
    // Return unsubscribe function
    return () => {
      this.eventListeners.get(event)?.delete(callback);
    };
  }

  _emit(event, data) {
    // Emitir a listeners específicos del evento
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).forEach(cb => {
        try { cb(data); } catch (e) { console.error(e); }
      });
    }
    
    // Emitir a listeners wildcard (*)
    if (this.eventListeners.has('*')) {
      this.eventListeners.get('*').forEach(cb => {
        try { cb(event, data); } catch (e) {}
      });
    }
  }

  async startDiscovery() {
    // FIX: Validar Bluetooth primero
    const btEnabled = await this.checkBluetooth();
    if (!btEnabled) {
      this._emit('error', { code: 'BLUETOOTH_DISABLED', message: 'Activa Bluetooth para buscar' });
      return false;
    }
    
    if (![STATE.OFFLINE, STATE.CONNECTED].includes(this.state)) {
      return false;
    }
    
    this._setState(STATE.DISCOVERING);
    
    try {
      await this.NexoBLE.startAdvertising();
      await this.NexoBLE.startScan();
      
      // Timeout auto-stop
      setTimeout(() => {
        if (this.state === STATE.DISCOVERING) {
          this.stopDiscovery();
          this._emit('scanTimeout', { duration: 10000 });
        }
      }, 10000);
      
      return true;
    } catch (error) {
      this._setState(STATE.ERROR);
      return false;
    }
  }

  async stopDiscovery() {
    try {
      await this.NexoBLE.stopScan();
      if (this.state === STATE.DISCOVERING) this._setState(STATE.OFFLINE);
      return true;
    } catch (e) { return false; }
  }

  async connect(deviceId) {
    try {
      this._setState(STATE.HANDSHAKING);
      await this.NexoBLE.connect({ deviceId });
      return true;
    } catch (error) {
      this._setState(STATE.ERROR);
      return false;
    }
  }

  async disconnect(deviceId) {
    try {
      await this.NexoBLE.disconnect({ deviceId });
      this.sessions.delete(deviceId);
      return true;
    } catch (e) { return false; }
  }

  async sendMessage(deviceId, plaintext) {
    try {
      const envelope = { payload: plaintext, timestamp: Date.now() };
      const bytes = new TextEncoder().encode(JSON.stringify(envelope));
      await this.NexoBLE.sendMessage({ deviceId, data: Array.from(bytes) });
      this._emit('messageSent', { deviceId });
      return true;
    } catch (error) {
      return false;
    }
  }

  _setState(newState) {
    const old = this.state;
    this.state = newState;
    this._emit('stateChanged', { from: old, to: newState });
  }

  getPeers() { return Array.from(this.peers.values()); }
  getState() { return this.state; }

  destroy() {
    this._setState(STATE.CLEANUP);
    this.cleanupHandlers.forEach(fn => { try { fn(); } catch(e) {} });
    this.NexoBLE?.stopAdvertising?.();
    this.NexoBLE?.stopScan?.();
    this.eventListeners.clear();
  }
}

export { NordicMesh, STATE, UUIDS };
export default NordicMesh;
