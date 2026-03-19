/**
 * NexoBLE Plugin - Punto de entrada web
 * v1.0 - Capacitor Plugin Bridge
 */

export const NexoBLE = {
  async initialize(options) {
    console.warn('[NexoBLE] Web stub - initialize called', options);
    return { userId: options.userId || 'web-stub' };
  },

  async startAdvertising() {
    console.warn('[NexoBLE] Web stub - advertising not supported');
    throw new Error('BLE advertising not supported in web');
  },

  async stopAdvertising() {
    return;
  },

  async startScan() {
    console.warn('[NexoBLE] Web stub - scanning not supported');
    throw new Error('BLE scanning not supported in web');
  },

  async stopScan() {
    return;
  },

  async connect(options) {
    console.warn('[NexoBLE] Web stub - connect not supported', options);
    throw new Error('BLE connection not supported in web');
  },

  async disconnect(options) {
    console.warn('[NexoBLE] Web stub - disconnect not supported', options);
    return;
  },

  async sendMessage(options) {
    console.warn('[NexoBLE] Web stub - sendMessage not supported', options);
    throw new Error('BLE messaging not supported in web');
  },

  addListener(eventName, callback) {
    console.warn(`[NexoBLE] Web stub - addListener ${eventName}`);
    return {
      remove: () => {
        console.warn(`[NexoBLE] Web stub - removeListener ${eventName}`);
      }
    };
  }
};

export default NexoBLE;
