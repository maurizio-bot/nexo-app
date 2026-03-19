/**
 * NexoBLE Plugin - Stub Web
 * v1.0 - Capacitor Plugin Bridge (Web Fallback)
 */

class NexoBLEStub {
  constructor() {
    this.listeners = new Map();
    console.warn('[NexoBLE] Web stub initialized - BLE not available in browser');
  }

  async initialize(options) {
    console.warn('[NexoBLE] Web stub: initialize called');
    return { userId: options?.userId || 'web-stub' };
  }

  async startAdvertising() {
    console.warn('[NexoBLE] Web stub: startAdvertising not supported');
    return Promise.resolve();
  }

  async stopAdvertising() {
    console.warn('[NexoBLE] Web stub: stopAdvertising');
    return Promise.resolve();
  }

  async startScan() {
    console.warn('[NexoBLE] Web stub: startScan not supported');
    return Promise.resolve();
  }

  async stopScan() {
    console.warn('[NexoBLE] Web stub: stopScan');
    return Promise.resolve();
  }

  async connect(options) {
    console.warn('[NexoBLE] Web stub: connect not supported', options);
    return Promise.reject(new Error('BLE connections not supported in web'));
  }

  async disconnect(options) {
    console.warn('[NexoBLE] Web stub: disconnect', options);
    return Promise.resolve();
  }

  async sendMessage(options) {
    console.warn('[NexoBLE] Web stub: sendMessage not supported', options);
    return Promise.reject(new Error('BLE messaging not supported in web'));
  }

  addListener(eventName, callback) {
    console.warn(`[NexoBLE] Web stub: addListener ${eventName}`);
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);
    
    // Return remove function
    return {
      remove: () => {
        const callbacks = this.listeners.get(eventName) || [];
        const idx = callbacks.indexOf(callback);
        if (idx > -1) callbacks.splice(idx, 1);
      }
    };
  }

  removeAllListeners() {
    this.listeners.clear();
  }
}

// Export singleton
const NexoBLE = new NexoBLEStub();
export { NexoBLE };
export default NexoBLE;
