/**
 * NexoBLE Plugin - Stub Web
 * v1.1-NAP - Capacitor Plugin Bridge (Web Fallback)
 * NAP 2.0 Certified: Interface Contracts + Error Codes + SOC2 Cleanup
 */

// NAP 2.0 Error Codes BLE
const BLEErrorCodes = {
  BLE_001: 'PLUGIN_NOT_INITIALIZED',
  BLE_005: 'UNSUPPORTED_PLATFORM',
  BLE_006: 'SCAN_FAILED',
  BLE_011: 'CONNECTION_FAILED',
  BLE_016: 'MESSAGE_SEND_FAILED',
  BLE_019: 'INVALID_PAYLOAD'
};

class NexoBLEStub {
  constructor() {
    this.listeners = new Map();
    this.isDestroyed = false;
    this.version = '1.1-NAP';
    
    console.warn(`[NexoBLE v${this.version}] Web stub initialized - BLE not available in browser`);
  }

  /**
   * NAP 2.0 Interface Contract: initialize
   * @param {Object} options - { userId: string }
   * @returns {Promise<{userId: string}>}
   */
  async initialize(options = {}) {
    if (this.isDestroyed) throw new Error('BLE_001: Plugin destroyed');
    
    // Interface Contract: Validar userId
    if (options.userId && typeof options.userId !== 'string') {
      throw new Error('BLE_019: userId must be string');
    }
    
    console.warn('[NexoBLE] Web stub: initialize');
    return { userId: options.userId || 'web-stub-nap' };
  }

  /**
   * NAP 2.0: Advertising no soportado en web
   */
  async startAdvertising() {
    if (this.isDestroyed) throw new Error('BLE_001: Plugin destroyed');
    console.warn('[NexoBLE] Web stub: startAdvertising not supported');
    return Promise.resolve();
  }

  async stopAdvertising() {
    if (this.isDestroyed) return Promise.resolve();
    console.warn('[NexoBLE] Web stub: stopAdvertising');
    return Promise.resolve();
  }

  /**
   * NAP 2.0: Scan no soportado en web
   */
  async startScan() {
    if (this.isDestroyed) throw new Error('BLE_001: Plugin destroyed');
    console.warn('[NexoBLE] Web stub: startScan not supported (use native Android build)');
    return Promise.resolve();
  }

  async stopScan() {
    if (this.isDestroyed) return Promise.resolve();
    console.warn('[NexoBLE] Web stub: stopScan');
    return Promise.resolve();
  }

  /**
   * NAP 2.0 Interface Contract: connect
   * @param {Object} options - { deviceId: string }
   */
  async connect(options = {}) {
    if (this.isDestroyed) throw new Error('BLE_001: Plugin destroyed');
    
    // Interface Contract: Validar deviceId
    if (!options.deviceId || typeof options.deviceId !== 'string') {
      throw new Error('BLE_019: deviceId required (string)');
    }
    
    console.warn('[NexoBLE] Web stub: connect rejected', options.deviceId);
    return Promise.reject(new Error(`BLE_005: BLE connections not supported in web environment (device: ${options.deviceId})`));
  }

  async disconnect(options = {}) {
    if (this.isDestroyed) return Promise.resolve();
    console.warn('[NexoBLE] Web stub: disconnect', options?.deviceId);
    return Promise.resolve();
  }

  /**
   * NAP 2.0 Interface Contract: sendMessage
   * @param {Object} options - { deviceId: string, data: string }
   */
  async sendMessage(options = {}) {
    if (this.isDestroyed) throw new Error('BLE_001: Plugin destroyed');
    
    // Interface Contract: Validar parámetros
    if (!options.deviceId) throw new Error('BLE_019: deviceId required');
    if (!options.data || typeof options.data !== 'string') {
      throw new Error('BLE_019: data must be base64 string');
    }
    
    console.warn('[NexoBLE] Web stub: sendMessage rejected', options.deviceId);
    return Promise.reject(new Error('BLE_005: BLE messaging requires native Android build'));
  }

  /**
   * NAP 2.0: Event System con SOC2 Cleanup
   * @param {string} eventName - Nombre del evento
   * @param {Function} callback - Handler
   * @returns {{remove: Function}} - Unsubscribe function
   */
  addListener(eventName, callback) {
    if (this.isDestroyed) throw new Error('BLE_001: Plugin destroyed');
    
    // Interface Contract: Validar parámetros
    if (typeof eventName !== 'string' || typeof callback !== 'function') {
      throw new Error('BLE_019: eventName (string) and callback (function) required');
    }
    
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set()); // NAP 2.0: Set para evitar duplicados
    }
    
    this.listeners.get(eventName).add(callback);
    console.warn(`[NexoBLE] Web stub: listener added for ${eventName}`);
    
    // SOC2: Return unsubscribe function
    return {
      remove: () => {
        if (this.listeners.has(eventName)) {
          this.listeners.get(eventName).delete(callback);
          console.warn(`[NexoBLE] Web stub: listener removed for ${eventName}`);
        }
      }
    };
  }

  /**
   * NAP 2.0 SOC2: Cleanup completo
   */
  removeAllListeners() {
    this.listeners.clear();
    console.warn('[NexoBLE] Web stub: all listeners removed');
  }

  /**
   * NAP 2.0 SOC2: Destrucción segura
   */
  destroy() {
    this.removeAllListeners();
    this.isDestroyed = true;
    console.warn('[NexoBLE] Web stub: destroyed');
  }

  /**
   * NAP 2.0: Emular eventos (para testing)
   * @param {string} eventName 
   * @param {*} data 
   */
  _emit(eventName, data) {
    if (this.listeners.has(eventName)) {
      this.listeners.get(eventName).forEach(cb => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[NexoBLE] Listener error for ${eventName}:`, err);
        }
      });
    }
  }
}

// Singleton export NAP 2.0
const NexoBLE = new NexoBLEStub();
export { NexoBLE, BLEErrorCodes };
export default NexoBLE;
