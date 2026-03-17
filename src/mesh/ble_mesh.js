/**
 * NEXO v9.0 - BLE Mesh v6.1 (Google Nearby Multipeer)
 * Plugin: @squareetlabs/capacitor-nearby-multipeer
 * Docs: https://github.com/squareetlabs/capacitor-nearby-multipeer
 */

import { NearbyMultipeer } from '@squareetlabs/capacitor-nearby-multipeer';
import { Capacitor } from '@capacitor/core';

export class BleMesh {
  constructor(options = {}) {
    this.config = {
      serviceId: options.serviceUuid || 'com.nexo.mesh.v1',
      deviceNamePrefix: options.deviceNamePrefix || 'NEXO',
      maxPeers: options.maxPeers || 8,
      scanTimeout: options.scanTimeout || 30000,
      strategy: options.strategy || 'P2P_STAR',
      ...options
    };

    this.state = {
      isScanning: false,
      isAdvertising: false,
      isInitialized: false,
      peers: new Map(),
      discovered: new Map(),
      localId: null,
      platform: Capacitor.getPlatform(),
      isNative: Capacitor.isNativePlatform()
    };

    this.callbacks = {
      onDeviceFound: options.onDeviceFound || (() => {}),
      onDeviceConnected: options.onDeviceConnected || (() => {}),
      onDeviceDisconnected: options.onDeviceDisconnected || (() => {}),
      onError: options.onError || (() => {}),
      onConnectionRequest: options.onConnectionRequest || (() => {}),
      onMessage: options.onMessage || (() => {})
    };

    this.timers = {};
    this.destroyed = false;
  }

  async init() {
    if (this.destroyed) throw new Error('BleMesh destroyed');
    if (this.state.isInitialized) return true;

    if (!this.state.isNative) {
      throw new Error('Nearby requires native platform (Android/iOS)');
    }

    try {
      console.log('[BleMesh] 🚀 Initializing...', this.config.serviceId);
      
      await NearbyMultipeer.initialize({ 
        serviceId: this.config.serviceId 
      });
      
      await NearbyMultipeer.setStrategy({ 
        strategy: this.config.strategy 
      });

      this._setupListeners();
      this.state.isInitialized = true;
      this.state.localId = `nexo-${Date.now().toString(36)}`;
      
      console.log('[BleMesh] ✅ Ready. ID:', this.state.localId);
      await this.startAdvertising();
      
      return true;
    } catch (err) {
      console.error('[BleMesh] ❌ Init failed:', err);
      this.callbacks.onError('INIT_FAILED', err.message);
      throw err;
    }
  }

  _setupListeners() {
    NearbyMultipeer.addListener('onEndpointFound', (event) => {
      console.log('[BleMesh] 📡 Found:', event.endpointId);
      const { endpointId, endpointName, serviceId } = event;
      
      if (serviceId !== this.config.serviceId) return;

      const device = {
        id: endpointId,
        name: endpointName || `NEXO-${endpointId.substr(0, 6)}`,
        endpointId: endpointId,
        serviceId: serviceId,
        timestamp: Date.now()
      };

      this.state.discovered.set(endpointId, device);
      this.callbacks.onDeviceFound(device);
    });

    NearbyMultipeer.addListener('onEndpointLost', (event) => {
      this.state.discovered.delete(event.endpointId);
    });

    NearbyMultipeer.addListener('onConnectionResult', (event) => {
      if (event.status === 'connected') {
        this._handleConnectionSuccess(event.endpointId);
      } else {
        this.callbacks.onError('CONNECTION_FAILED', event.statusCode);
      }
    });

    NearbyMultipeer.addListener('onDisconnected', (event) => {
      this._handleDisconnection(event.endpointId);
    });

    NearbyMultipeer.addListener('onReceiveData', (event) => {
      this.callbacks.onMessage(event.data, event.endpointId);
    });

    NearbyMultipeer.addListener('onError', (event) => {
      this.callbacks.onError('NEARBY_ERROR', event.errorMessage);
    });
  }

  async startAdvertising() {
    if (!this.state.isInitialized || this.state.isAdvertising) return;
    
    try {
      const name = `${this.config.deviceNamePrefix}-${this.state.localId.substr(-6)}`;
      await NearbyMultipeer.startAdvertising({ endpointName: name });
      this.state.isAdvertising = true;
      console.log('[BleMesh] 📢 Advertising:', name);
    } catch (err) {
      console.error('[BleMesh] Advertise error:', err);
    }
  }

  async stopAdvertising() {
    if (!this.state.isAdvertising) return;
    try {
      await NearbyMultipeer.stopAdvertising();
      this.state.isAdvertising = false;
    } catch (e) {}
  }

  async startScan(duration = null) {
    if (this.destroyed) throw new Error('Destroyed');
    if (!this.state.isInitialized) throw new Error('Call init() first');
    if (this.state.isScanning) return;

    const timeout = duration || this.config.scanTimeout;
    
    try {
      console.log('[BleMesh] 🔍 Scanning...');
      this.state.isScanning = true;
      await NearbyMultipeer.startDiscovery();
      
      this.timers.scan = setTimeout(() => this.stopScan(), timeout);
    } catch (err) {
      this.state.isScanning = false;
      this.callbacks.onError('SCAN_ERROR', err.message);
      throw err;
    }
  }

  async stopScan() {
    if (!this.state.isScanning) return;
    if (this.timers.scan) clearTimeout(this.timers.scan);
    
    try {
      await NearbyMultipeer.stopDiscovery();
      this.state.isScanning = false;
      console.log('[BleMesh] ⏹️ Scan stopped');
    } catch (e) {}
  }

  async connect(deviceId) {
    if (!this.state.peers.has(deviceId) && this.state.peers.size < this.config.maxPeers) {
      try {
        await NearbyMultipeer.connect({
          endpointId: deviceId,
          displayName: `${this.config.deviceNamePrefix}-${this.state.localId.substr(-6)}`
        });
      } catch (err) {
        this.callbacks.onError('CONNECT_ERROR', err.message);
      }
    }
  }

  _handleConnectionSuccess(endpointId) {
    const discovered = this.state.discovered.get(endpointId);
    const peer = {
      id: endpointId,
      name: discovered?.name || `Peer-${endpointId.substr(0, 6)}`,
      connectedAt: Date.now()
    };
    
    this.state.peers.set(endpointId, peer);
    this.callbacks.onDeviceConnected(peer);
  }

  async disconnect(deviceId) {
    try {
      await NearbyMultipeer.disconnect({ endpointId: deviceId });
    } catch (e) {}
    this._handleDisconnection(deviceId);
  }

  _handleDisconnection(deviceId) {
    if (this.state.peers.has(deviceId)) {
      const peer = this.state.peers.get(deviceId);
      this.state.peers.delete(deviceId);
      this.callbacks.onDeviceDisconnected(peer);
    }
  }

  async send(deviceId, message) {
    if (!this.state.peers.has(deviceId)) return false;
    try {
      const data = typeof message === 'string' ? message : JSON.stringify(message);
      await NearbyMultipeer.sendData({ endpointId: deviceId, data });
      return true;
    } catch (e) {
      return false;
    }
  }

  async broadcast(message) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    for (const [deviceId] of this.state.peers) {
      try {
        await NearbyMultipeer.sendData({ endpointId: deviceId, data });
      } catch (e) {}
    }
  }

  getStatus() {
    return {
      initialized: this.state.isInitialized,
      scanning: this.state.isScanning,
      advertising: this.state.isAdvertising,
      peers: this.state.peers.size,
      discovered: this.state.discovered.size
    };
  }

  getPeers() {
    return Array.from(this.state.peers.values());
  }

  getDiscovered() {
    return Array.from(this.state.discovered.values());
  }

  destroy() {
    this.destroyed = true;
    this.stopScan();
    this.stopAdvertising();
    for (const [deviceId] of this.state.peers) {
      try {
        NearbyMultipeer.disconnect({ endpointId: deviceId });
      } catch (e) {}
    }
  }
}

export default BleMesh;
