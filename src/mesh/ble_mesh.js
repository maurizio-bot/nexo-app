/**
 * NEXO v9.0 - BLE Mesh v5.0 (Capacitor Native)
 * Reemplaza Web Bluetooth API por @capacitor-community/bluetooth-le
 * 
 * @version 5.0-native
 * @certified APK Android 12+
 */

import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';

export class BleMesh {
  constructor(options = {}) {
    this.config = {
      serviceUuid: options.serviceUuid || '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
      characteristicUuid: options.characteristicUuid || 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
      deviceNamePrefix: options.deviceNamePrefix || 'NEXO',
      maxPeers: options.maxPeers || 8,
      scanTimeout: options.scanTimeout || 15000,
      autoConnectRssi: options.autoConnectRssi || -70,
      ...options
    };

    this.state = {
      isScanning: false,
      isInitialized: false,
      peers: new Map(),
      localId: this._generateId(),
      platform: Capacitor.getPlatform(),
      isNative: Capacitor.isNativePlatform()
    };

    this._connectingDevices = new Set();
    this._listeners = {
      message: [],
      peer: [],
      connect: [],
      disconnect: [],
      error: [],
      device: []
    };

    this.timers = { scan: null };
    this.destroyed = false;
  }

  on(event, handler) {
    if (this.destroyed) throw new Error('BleMesh destruido');
    if (!this._listeners[event]) this._listeners[event] = [];
    if (typeof handler !== 'function') throw new Error('Handler debe ser función');
    this._listeners[event].push(handler);
    return this;
  }

  off(event, handler) {
    if (this.destroyed) return this;
    if (!this._listeners[event]) return this;
    const idx = this._listeners[event].indexOf(handler);
    if (idx > -1) this._listeners[event].splice(idx, 1);
    return this;
  }

  _emit(event, ...args) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(handler => {
      try {
        handler(...args);
      } catch (err) {
        console.error(`[BleMesh] Error en listener ${event}:`, err);
      }
    });
  }

  async init() {
    if (this.destroyed) throw new Error('BleMesh destruido');
    if (this.state.isInitialized) return true;

    if (!this.state.isNative) {
      console.warn('[BleMesh] No es plataforma nativa, BLE no disponible');
      throw new Error('Capacitor Native Platform required (Android/iOS)');
    }

    try {
      await BleClient.initialize({ androidNeverForLocation: false });
      this.state.isInitialized = true;
      console.log('[BleMesh] ✅ Native BLE initialized');
      this._emit('ready');
      return true;
    } catch (err) {
      console.error('[BleMesh] ❌ Init error:', err);
      this._emit('error', err);
      throw err;
    }
  }

  async startScan(duration = null) {
    if (this.destroyed) throw new Error('BleMesh destruido');
    if (!this.state.isInitialized) throw new Error('BleMesh no inicializado');
    if (this.state.isScanning) return;

    const scanDuration = duration || this.config.scanTimeout;

    try {
      this.state.isScanning = true;
      this._emit('scanning', true);
      console.log(`[BleMesh] 🔍 Iniciando scan por ${scanDuration}ms...`);

      await BleClient.requestLEScan(
        {
          services: [this.config.serviceUuid],
          allowDuplicates: false,
          scanMode: 2
        },
        (result) => {
          this._handleScanResult(result);
        }
      );

      this.timers.scan = setTimeout(() => {
        this.stopScan();
      }, scanDuration);

    } catch (err) {
      console.error('[BleMesh] Scan error:', err);
      this.state.isScanning = false;
      this._emit('error', err);
      throw err;
    }
  }

  async stopScan() {
    if (!this.state.isScanning) return;
    
    try {
      await BleClient.stopLEScan();
      if (this.timers.scan) {
        clearTimeout(this.timers.scan);
        this.timers.scan = null;
      }
      this.state.isScanning = false;
      this._emit('scanning', false);
      console.log('[BleMesh] ⏹️ Scan detenido');
    } catch (err) {
      console.error('[BleMesh] Error deteniendo scan:', err);
    }
  }

  _handleScanResult(result) {
    const device = {
      id: result.device.deviceId,
      name: result.device.name || 'NEXO Device',
      rssi: result.rssi,
      txPower: result.txPower,
      manufacturerData: result.manufacturerData
    };

    this._emit('device', device);

    if (device.rssi > this.config.autoConnectRssi && 
        !this._connectingDevices.has(device.id) &&
        !this.state.peers.has(device.id) &&
        this.state.peers.size < this.config.maxPeers) {
      
      console.log(`[BleMesh] Auto-conectando a ${device.name} (${device.rssi}dBm)`);
      this.connect(device.id);
    }
  }

  async connect(deviceId) {
    if (this.destroyed) throw new Error('BleMesh destruido');
    if (!this.state.isInitialized) throw new Error('BleMesh no inicializado');
    
    if (this.state.peers.has(deviceId)) {
      console.log(`[BleMesh] ${deviceId} ya conectado`);
      return;
    }
    
    if (this._connectingDevices.has(deviceId)) {
      console.log(`[BleMesh] Ya conectando ${deviceId}`);
      return;
    }

    if (this.state.peers.size >= this.config.maxPeers) {
      console.log(`[BleMesh] Max peers (${this.config.maxPeers}) alcanzado`);
      return;
    }

    this._connectingDevices.add(deviceId);

    try {
      console.log(`[BleMesh] 🔗 Conectando a ${deviceId}...`);
      
      await BleClient.connect(deviceId, (disconnectedId) => {
        console.log(`[BleMesh] 🔌 Desconectado: ${disconnectedId}`);
        this._handleDisconnection(disconnectedId);
      });

      await BleClient.discoverServices(deviceId);

      await BleClient.startNotifications(
        deviceId,
        this.config.serviceUuid,
        this.config.characteristicUuid,
        (value) => {
          this._handleIncomingMessage(deviceId, value);
        }
      );

      this.state.peers.set(deviceId, {
        id: deviceId,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        type: 'ble_native'
      });

      this._emit('connect', deviceId);
      this._emit('peer', this.state.peers.size);
      
      console.log(`[BleMesh] ✅ Conectado: ${deviceId} (Total: ${this.state.peers.size})`);

    } catch (err) {
      console.error(`[BleMesh] ❌ Error conectando ${deviceId}:`, err);
      this._emit('error', err);
    } finally {
      this._connectingDevices.delete(deviceId);
    }
  }

  async disconnect(deviceId) {
    const peer = this.state.peers.get(deviceId);
    if (!peer) return;

    try {
      await BleClient.disconnect(deviceId);
    } catch (err) {
      console.warn(`[BleMesh] Error desconectando ${deviceId}:`, err);
    }
    
    this._handleDisconnection(deviceId);
  }

  _handleDisconnection(deviceId) {
    if (this.state.peers.has(deviceId)) {
      this.state.peers.delete(deviceId);
      this._emit('disconnect', deviceId);
      this._emit('peer', this.state.peers.size);
      console.log(`[BleMesh] Peer removido: ${deviceId} (Restantes: ${this.state.peers.size})`);
    }
  }

  _handleIncomingMessage(deviceId, value) {
    try {
      const text = new TextDecoder('utf-8').decode(value);
      const message = JSON.parse(text);
      
      const peer = this.state.peers.get(deviceId);
      if (peer) peer.lastSeen = Date.now();

      this._emit('message', message, deviceId);
      
    } catch (err) {
      const text = new TextDecoder('utf-8').decode(value);
      this._emit('message', { type: 'raw', data: text }, deviceId);
    }
  }

  async send(deviceId, message) {
    if (this.destroyed) throw new Error('BleMesh destruido');
    
    const peer = this.state.peers.get(deviceId);
    if (!peer) throw new Error(`Peer ${deviceId} no conectado`);

    try {
      const data = new TextEncoder().encode(JSON.stringify(message));
      await BleClient.write(
        deviceId,
        this.config.serviceUuid,
        this.config.characteristicUuid,
        data,
        { timeout: 5000 }
      );
      return true;
    } catch (err) {
      console.error(`[BleMesh] Error enviando a ${deviceId}:`, err);
      return false;
    }
  }

  async broadcast(message) {
    if (this.destroyed) throw new Error('BleMesh destruido');
    if (this.state.peers.size === 0) {
      throw new Error('No peers connected');
    }

    const promises = [];
    
    for (const [deviceId] of this.state.peers) {
      promises.push(
        this.send(deviceId, message).catch(() => false)
      );
    }

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r).length;
    
    if (successCount === 0) {
      throw new Error('No se pudo enviar a ningún peer');
    }
    
    return successCount;
  }

  getPeerCount() {
    return this.state.peers.size;
  }

  getPeers() {
    return Array.from(this.state.peers.entries()).map(([id, peer]) => ({
      id,
      connectedAt: peer.connectedAt,
      lastSeen: peer.lastSeen,
      type: peer.type
    }));
  }

  getStatus() {
    return {
      initialized: this.state.isInitialized,
      scanning: this.state.isScanning,
      peerCount: this.state.peers.size,
      isNative: this.state.isNative,
      platform: this.state.platform,
      maxPeers: this.config.maxPeers
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.stopScan();

    for (const [deviceId] of this.state.peers) {
      try {
        BleClient.disconnect(deviceId);
      } catch (e) {}
    }
    this.state.peers.clear();

    Object.keys(this._listeners).forEach(key => {
      this._listeners[key] = [];
    });

    console.log('[BleMesh] 🗑️ Destruido');
  }

  _generateId() {
    return `nexo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default BleMesh;
