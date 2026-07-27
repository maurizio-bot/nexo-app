/**
 * autoscan.js - Re-scan cíclico para re-encontrar dispositivos tras desconexión
 * Item 13 de Fase 4
 */
export class AutoScanManager {
  constructor(bleInterface) {
    this.ble = bleInterface;
    this.isRunning = false;
    this.intervalMs = 15000;
    this.scanDurationMs = 8000;
    this.timer = null;
    this.knownDevices = new Map();
  }

  registerKnownDevice(deviceId, nexoId) {
    this.knownDevices.set(deviceId, { nexoId: nexoId || '', lastSeen: Date.now() });
  }

  unregisterDevice(deviceId) {
    this.knownDevices.delete(deviceId);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._tick();
  }

  stop() {
    this.isRunning = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  _tick() {
    var self = this;
    if (!self.isRunning) return;
    if (self.ble && typeof self.ble.startScan === 'function') {
      try {
        self.ble.startScan();
        setTimeout(function() {
          if (self.ble && typeof self.ble.stopScan === 'function') {
            self.ble.stopScan();
          }
        }, self.scanDurationMs);
      } catch (e) { console.warn('[AutoScan] scan error:', e); }
    }
    self.timer = setTimeout(function() { self._tick(); }, self.intervalMs);
  }
}

export function createAutoScan(bleInterface) {
  return new AutoScanManager(bleInterface);
}
