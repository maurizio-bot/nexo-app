/**
 * NEXO v9.0 - BLE Mesh v6.1 (Google Nearby Multipeer) 
 * FIX: Permisos, error handling, y debug logging mejorado
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

  /**
   * Initialize con verbose logging
   */
  async init() {
    if (this.destroyed) throw new Error('BleMesh destroyed');
    if (this.state.isInitialized) {
      console.log('[BleMesh] Already initialized');
      return true;
    }

    if (!this.state.isNative) {
      const err = new Error('Nearby requires native platform (Android/iOS)');
      console.error('[BleMesh]', err);
      throw err;
    }

    try {
      console.log('[BleMesh] 🚀 Initializing Nearby Multipeer...');
      console.log('[BleMesh] Platform:', this.state.platform);
      console.log('[BleMesh] Service ID:', this.config.serviceId);

      // CRÍTICO: Inicializar el plugin
      await NearbyMultipeer.initialize({ 
        serviceId: this.config.serviceId 
      });
      console.log('[BleMesh] ✅ Plugin initialized');

      // Configurar estrategia
      await NearbyMultipeer.setStrategy({ 
        strategy: this.config.strategy 
      });
      console.log('[BleMesh] ✅ Strategy set:', this.config.strategy);

      // Setup listeners ANTES de empezar
      this._setupListeners();

      this.state.isInitialized = true;
      this.state.localId = `nexo-${Date.now().toString(36)}`;
      
      console.log('[BleMesh] ✅ Initialization complete. Local ID:', this.state.localId);
      
      // Auto-start advertising para ser visible
      await this.startAdvertising();
      
      return true;
      
    } catch (err) {
      console.error('[BleMesh] ❌ Init failed:', err);
      console.error('[BleMesh] Error details:', JSON.stringify(err));
      this.callbacks.onError('INIT_FAILED', err.message || 'Unknown error');
      throw err;
    }
  }

  /**
   * Setup Nearby listeners con logging detallado
   */
  _setupListeners() {
    console.log('[BleMesh] Setting up event listeners...');

    // Endpoint encontrado durante discovery
    NearbyMultipeer.addListener('onEndpointFound', (event) => {
      console.log('[BleMesh] 📡 onEndpointFound:', JSON.stringify(event));
      const { endpointId, endpointName, serviceId } = event;
      
      if (serviceId !== this.config.serviceId) {
        console.log('[BleMesh] Ignoring foreign service:', serviceId);
        return;
      }

      const device = {
        id: endpointId,
        name: endpointName || `NEXO-${endpointId.substr(0, 6)}`,
        endpointId: endpointId,
        serviceId: serviceId,
        timestamp: Date.now()
      };

      this.state.discovered.set(endpointId, device);
      
      // Notificar a UI
      this.callbacks.onDeviceFound(device);
      console.log(`[BleMesh] Device found: ${device.name} (${endpointId})`);
    });

    // Endpoint perdido
    NearbyMultipeer.addListener('onEndpointLost', (event) => {
      console.log('[BleMesh] 👋 onEndpointLost:', event.endpointId);
      this.state.discovered.delete(event.endpointId);
    });

    // Resultado de conexión
    NearbyMultipeer.addListener('onConnectionResult', (event) => {
      console.log('[BleMesh] 🔌 onConnectionResult:', JSON.stringify(event));
      const { endpointId, status, statusCode } = event;
      
      if (status === 'connected') {
        this._handleConnectionSuccess(endpointId);
      } else {
        console.error(`[BleMesh] Connection failed: ${statusCode}`);
        this.callbacks.onError('CONNECTION_FAILED', statusCode);
      }
    });

    // Desconexión
    NearbyMultipeer.addListener('onDisconnected', (event) => {
      console.log('[BleMesh] 🔌 onDisconnected:', event.endpointId);
      this._handleDisconnection(event.endpointId);
    });

    // Datos recibidos
    NearbyMultipeer.addListener('onReceiveData', (event) => {
      console.log('[BleMesh] 📨 Data received from:', event.endpointId);
      this.callbacks.onMessage(event.data, event.endpointId);
    });

    // Errores
    NearbyMultipeer.addListener('onError', (event) => {
      console.error('[BleMesh] ❌ Nearby error:', JSON.stringify(event));
      this.callbacks.onError('NEARBY_ERROR', event.errorMessage || 'Unknown');
    });
  }

  /**
   * Start advertising (hacer visible este dispositivo)
   */
  async startAdvertising() {
    if (!this.state.isInitialized) {
      console.warn('[BleMesh] Cannot advertise: not initialized');
      return;
    }
    if (this.state.isAdvertising) return;

    try {
      const endpointName = `${this.config.deviceNamePrefix}-${this.state.localId.substr(-6)}`;
      console.log('[BleMesh] 📢 Starting advertising as:', endpointName);
      
      await NearbyMultipeer.startAdvertising({ endpointName });
      
      this.state.isAdvertising = true;
      console.log('[BleMesh] ✅ Advertising started');
      
    } catch (err) {
      console.error('[BleMesh] ❌ Advertising error:', err);
      // No es crítico, podemos funcionar como scanner
      this.callbacks.onError('ADVERTISE_ERROR', err.message);
    }
  }

  async stopAdvertising() {
    if (!this.state.isAdvertising) return;
    try {
      await NearbyMultipeer.stopAdvertising();
      this.state.isAdvertising = false;
      console.log('[BleMesh] Advertising stopped');
    } catch (e) {
      console.error('[BleMesh] Error stopping advertise:', e);
    }
  }

  /**
   * Start discovery (equivalente a scan)
   */
  async startScan(duration = null) {
    if (this.destroyed) throw new Error('BleMesh destroyed');
    if (!this.state.isInitialized) throw new Error('Not initialized. Call init() first');
    if (this.state.isScanning) return;

    const scanDuration = duration || this.config.scanTimeout;

    try {
      console.log(`[BleMesh] 🔍 Starting discovery for ${scanDuration}ms...`);
      this.state.isScanning = true;
      
      await NearbyMultipeer.startDiscovery();
      console.log('[BleMesh] ✅ Discovery started');

      // Auto-stop
      this.timers.scan = setTimeout(() => {
        console.log('[BleMesh] Auto-stopping scan...');
        this.stopScan();
      }, scanDuration);

    } catch (err) {
      this.state.isScanning = false;
      console.error('[BleMesh] ❌ Discovery error:', err);
      this.callbacks.onError('SCAN_ERROR', err.message);
      throw err;
    }
  }

  async stopScan() {
    if (!this.state.isScanning) return;
    
    try {
      if (this.timers.scan) {
        clearTimeout(this.timers.scan);
        this.timers.scan = null;
      }
      
      await NearbyMultipeer.stopDiscovery();
      this.state.isScanning = false;
      console.log('[BleMesh] ⏹️ Discovery stopped');
      
    } catch (err) {
      console.error('[BleMesh] Error stopping discovery:', err);
    }
  }

  /**
   * Conectar a un endpoint específico
   */
  async connect(deviceId) {
    if (this.destroyed) throw new Error('BleMesh destroyed');
    if (!this.state.isInitialized) throw new Error('Not initialized');

    if (this.state.peers.has(deviceId)) {
      console.log(`[BleMesh] Already connected to ${deviceId}`);
      return;
    }

    if (this.state.peers.size >= this.config.maxPeers) {
      throw new Error(`Max peers (${this.config.maxPeers}) reached`);
    }

    try {
      console.log(`[BleMesh] 🔗 Connecting to ${deviceId}...`);
      
      await NearbyMultipeer.connect({
        endpointId: deviceId,
        displayName: `${this.config.deviceNamePrefix}-${this.state.localId.substr(-6)}`
      });

      console.log(`[BleMesh] Connection request sent to ${deviceId}`);
      // La confirmación viene por onConnectionResult
      
    } catch (err) {
      console.error(`[BleMesh] ❌ Connect error:`, err);
      this.callbacks.onError('CONNECT_ERROR', err.message);
      throw err;
    }
  }

  _handleConnectionSuccess(endpointId) {
    const discovered = this.state.discovered.get(endpointId);
    const peer = {
      id: endpointId,
      endpointId: endpointId,
      name: discovered?.name || `Peer-${endpointId.substr(0, 6)}`,
      connectedAt: Date.now(),
      lastSeen: Date.now()
    };

    this.state.peers.set(endpointId, peer);
    this.callbacks.onDeviceConnected(peer);
    console.log(`[BleMesh] ✅ Connected: ${peer.name} (Total: ${this.state.peers.size})`);
  }

  async disconnect(deviceId) {
    if (!this.state.peers.has(deviceId)) return;
    
    try {
      await NearbyMultipeer.disconnect({ endpointId: deviceId });
    } catch (e) {
      console.warn('[BleMesh] Disconnect error:', e);
    }
    this._handleDisconnection(deviceId);
  }

  _handleDisconnection(deviceId) {
    if (this.state.peers.has(deviceId)) {
      const peer = this.state.peers.get(deviceId);
      this.state.peers.delete(deviceId);
      this.callbacks.onDeviceDisconnected(peer);
      console.log(`[BleMesh] 🔌 Disconnected: ${peer.name}`);
    }
  }

  /**
   * Enviar mensaje a un peer
   */
  async send(deviceId, message) {
    if (!this.state.peers.has(deviceId)) {
      throw new Error(`Peer ${deviceId} not connected`);
    }

    try {
      const data = typeof message === 'string' ? message : JSON.stringify(message);
      await NearbyMultipeer.sendData({
        endpointId: deviceId,
        data: data
      });
      return true;
    } catch (err) {
      console.error(`[BleMesh] Send error to ${deviceId}:`, err);
      return false;
    }
  }

  /**
   * Broadcast a todos los peers conectados
   */
  async broadcast(message) {
    if (this.state.peers.size === 0) {
      console.warn('[BleMesh] No peers to broadcast to');
      return 0;
    }

    const data = typeof message === 'string' ? message : JSON.stringify(message);
    let successCount = 0;

    for (const [deviceId] of this.state.peers) {
      try {
        await NearbyMultipeer.sendData({ endpointId: deviceId, data });
        successCount++;
      } catch (e) {
        console.warn(`[BleMesh] Failed to send to ${deviceId}`);
      }
    }

    return successCount;
  }

  getStatus() {
    return {
      initialized: this.state.isInitialized,
      scanning: this.state.isScanning,
      advertising: this.state.isAdvertising,
      peerCount: this.state.peers.size,
      discoveredCount: this.state.discovered.size,
      platform: this.state.platform,
      serviceId: this.config.serviceId
    };
  }

  getPeers() {
    return Array.from(this.state.peers.values());
  }

  getDiscovered() {
    return Array.from(this.state.discovered.values());
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    console.log('[BleMesh] 🧹 Destroying...');
    
    this.stopScan();
    this.stopAdvertising();

    for (const [deviceId] of this.state.peers) {
      try {
        NearbyMultipeer.disconnect({ endpointId: deviceId });
      } catch (e) {}
    }
    
    this.state.peers.clear();
    this.state.discovered.clear();
  }
}

export default BleMesh;
