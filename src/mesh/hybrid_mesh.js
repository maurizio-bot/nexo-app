/**
 * NEXO Hybrid Mesh v1.0
 * Estrategia: Nearby → BLE → WebRTC → Offline
 * API unificada compatible con BLEInterface
 */

import { Capacitor } from '@capacitor/core';
import { BleClient, BleDevice } from '@capacitor-community/bluetooth-le';

// Constantes de servicio BLE NEXO (fallback)
const NEXO_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NEXO_CHAR_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NEXO_CHAR_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export class HybridMesh {
  constructor(options = {}) {
    this.config = {
      serviceId: options.serviceId || 'com.nexo.mesh.v1',
      bleTimeout: options.bleTimeout || 30000,
      fallbackChain: options.fallbackChain || ['nearby', 'ble', 'webrtc'],
      ...options
    };
    
    this.state = {
      mode: null, // 'nearby', 'ble', 'webrtc', 'offline'
      isScanning: false,
      isInitialized: false,
      peers: new Map(),
      discovered: new Map(),
      localId: null
    };
    
    this.adapters = {
      nearby: null,
      ble: null,
      webrtc: null
    };
    
    this.listeners = {
      device: [],
      connect: [],
      disconnect: [],
      message: [],
      error: [],
      scanning: [],
      modeChange: []
    };
  }

  on(event, handler) {
    if (this.listeners[event]) this.listeners[event].push(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(h => h !== handler);
    }
  }

  _emit(event, ...args) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(h => {
        try { h(...args); } catch(e) {}
      });
    }
  }

  /**
   * Inicialización con fallback automático
   */
  async init() {
    if (this.state.isInitialized) return true;
    
    console.log('[HybridMesh] Iniciando detección de capacidades...');
    
    // Intentar cada modo en orden
    for (const mode of this.config.fallbackChain) {
      try {
        const success = await this._tryInitMode(mode);
        if (success) {
          this.state.mode = mode;
          this.state.isInitialized = true;
          this.state.localId = await this._generateDeviceId();
          this._emit('ready');
          this._emit('modeChange', mode);
          console.log(`[HybridMesh] ✅ Modo activo: ${mode.toUpperCase()}`);
          return true;
        }
      } catch (err) {
        console.warn(`[HybridMesh] ${mode} falló:`, err.message);
      }
    }
    
    // Fallback final: modo offline (solo local)
    this.state.mode = 'offline';
    this.state.isInitialized = true;
    this._emit('modeChange', 'offline');
    console.warn('[HybridMesh] ⚠️ Modo OFFLINE - Sin conectividad P2P');
    return true;
  }

  /**
   * Intenta inicializar un modo específico
   */
  async _tryInitMode(mode) {
    if (!Capacitor.isNativePlatform() && mode !== 'webrtc') {
      throw new Error('Requiere plataforma nativa');
    }

    switch(mode) {
      case 'nearby':
        return await this._initNearby();
      case 'ble':
        return await this._initBLE();
      case 'webrtc':
        return await this._initWebRTC();
      default:
        return false;
    }
  }

  /**
   * NEARBY: Google Nearby Connections
   */
  async _initNearby() {
    // Verificar si el plugin está disponible
    if (typeof window === 'undefined' || !window.cordova?.plugins?.nearby) {
      // Intentar importar dinámicamente el plugin de Capacitor
      try {
        const { NearbyMultipeer } = await import('@squareetlabs/capacitor-nearby-multipeer');
        this.adapters.nearby = { plugin: NearbyMultipeer, type: 'capacitor' };
      } catch {
        throw new Error('Plugin Nearby no disponible');
      }
    } else {
      this.adapters.nearby = { plugin: window.cordova.plugins.nearby, type: 'cordova' };
    }
    
    const adapter = this.adapters.nearby;
    
    // Inicializar
    if (adapter.type === 'capacitor') {
      await adapter.plugin.initialize({ serviceId: this.config.serviceId });
      await adapter.plugin.setStrategy({ strategy: 'P2P_STAR' });
    }
    
    // Setup listeners
    this._setupNearbyListeners(adapter);
    
    // Iniciar advertising (hacernos visibles)
    await this._startNearbyAdvertising(adapter);
    
    return true;
  }

  _setupNearbyListeners(adapter) {
    if (adapter.type === 'cordova') {
      // API Cordova (vieja)
      adapter.plugin.onEndpointFound = (id, info) => {
        this._handleDeviceFound({ id, name: info.name, rssi: -50, mode: 'nearby' });
      };
      
      adapter.plugin.onConnectionResult = (id, result) => {
        if (result.status === 'CONNECTED') {
          this._handleConnect({ id, name: `Peer-${id.substr(0,4)}`, mode: 'nearby' });
        }
      };
      
      adapter.plugin.onDisconnected = (id) => {
        this._handleDisconnect(id);
      };
      
      adapter.plugin.onReceive = (id, payload) => {
        this._handleMessage(id, payload);
      };
    } else {
      // API Capacitor (nueva)
      adapter.plugin.addListener('onEndpointFound', (event) => {
        const { endpointId, endpointName } = event;
        this._handleDeviceFound({ 
          id: endpointId, 
          name: endpointName, 
          rssi: -50, 
          mode: 'nearby' 
        });
      });
      
      adapter.plugin.addListener('onConnectionResult', (event) => {
        if (event.status === 'connected') {
          this._handleConnect({ 
            id: event.endpointId, 
            name: `Peer-${event.endpointId.substr(0,4)}`,
            mode: 'nearby'
          });
        }
      });
      
      adapter.plugin.addListener('onDisconnected', (event) => {
        this._handleDisconnect(event.endpointId);
      });
      
      adapter.plugin.addListener('onReceiveData', (event) => {
        this._handleMessage(event.endpointId, event.data);
      });
    }
  }

  async _startNearbyAdvertising(adapter) {
    const deviceName = `NEXO-${this._generateShortId()}`;
    
    if (adapter.type === 'cordova') {
      await adapter.plugin.startAdvertising(deviceName, this.config.serviceId, { name: deviceName });
    } else {
      await adapter.plugin.startAdvertising({ endpointName: deviceName });
    }
  }

  /**
   * BLE: Bluetooth Low Energy tradicional (fallback)
   */
  async _initBLE() {
    if (!Capacitor.isNativePlatform()) {
      throw new Error('BLE requiere plataforma nativa');
    }
    
    // Inicializar BLE
    await BleClient.initialize();
    
    this.adapters.ble = {
      device: null,
      server: null,
      characteristics: new Map()
    };
    
    return true;
  }

  /**
   * WEBRTC: Fallback para web/navegador
   */
  async _initWebRTC() {
    // Simple WebRTC data channel para P2P por internet
    // Usando simple-peer o implementación básica con WebSocket signaling
    this.adapters.webrtc = {
      peers: new Map(),
      signaling: null
    };
    
    // Por ahora, WebRTC requiere un servidor signaling
    // Si no hay conectividad, fallará gracefully
    throw new Error('WebRTC no implementado completamente - usar servidor relay');
  }

  /**
   * API PÚBLICA: Start Scan (funciona en cualquier modo)
   */
  async startScan() {
    if (!this.state.isInitialized) throw new Error('No inicializado');
    
    this.state.isScanning = true;
    this._emit('scanning', true);
    
    switch(this.state.mode) {
      case 'nearby':
        await this._startNearbyScan();
        break;
      case 'ble':
        await this._startBLEScan();
        break;
      case 'webrtc':
        await this._startWebRTCScan();
        break;
      default:
        // Offline: no escaneamos
        this._emit('scanning', false);
    }
    
    return true;
  }

  async stopScan() {
    if (!this.state.isScanning) return;
    
    this.state.isScanning = false;
    this._emit('scanning', false);
    
    try {
      switch(this.state.mode) {
        case 'nearby':
          await this._stopNearbyScan();
          break;
        case 'ble':
          await this._stopBLEScan();
          break;
      }
    } catch(e) {
      console.warn('[HybridMesh] Error stopping scan:', e);
    }
  }

  async _startNearbyScan() {
    const adapter = this.adapters.nearby;
    if (adapter.type === 'cordova') {
      await adapter.plugin.startDiscovery(this.config.serviceId);
    } else {
      await adapter.plugin.startDiscovery();
    }
  }

  async _stopNearbyScan() {
    const adapter = this.adapters.nearby;
    if (adapter.type === 'cordova') {
      await adapter.plugin.stopDiscovery();
    } else {
      await adapter.plugin.stopDiscovery();
    }
  }

  async _startBLEScan() {
    await BleClient.requestLEScan({ services: [NEXO_SERVICE_UUID] }, (result) => {
      this._handleDeviceFound({
        id: result.device.deviceId,
        name: result.device.name || `NEXO-${result.device.deviceId.substr(0,6)}`,
        rssi: result.rssi,
        mode: 'ble'
      });
    });
  }

  async _stopBLEScan() {
    await BleClient.stopLEScan();
  }

  /**
   * Conexión a dispositivo (modo-agnóstico)
   */
  async connect(deviceId) {
    const device = this.state.discovered.get(deviceId);
    if (!device) throw new Error('Dispositivo no encontrado');
    
    switch(device.mode) {
      case 'nearby':
        return await this._connectNearby(deviceId);
      case 'ble':
        return await this._connectBLE(deviceId);
      default:
        throw new Error('Modo no soportado');
    }
  }

  async _connectNearby(deviceId) {
    const adapter = this.adapters.nearby;
    if (adapter.type === 'cordova') {
      await adapter.plugin.requestConnection(this.state.localId, deviceId);
    } else {
      await adapter.plugin.connect({ endpointId: deviceId });
    }
  }

  async _connectBLE(deviceId) {
    await BleClient.connect(deviceId);
    const services = await BleClient.getServices(deviceId);
    
    // Guardar referencia
    this.state.peers.set(deviceId, {
      id: deviceId,
      mode: 'ble',
      connectedAt: Date.now(),
      services
    });
    
    // Start notifications
    await BleClient.startNotifications(deviceId, NEXO_SERVICE_UUID, NEXO_CHAR_RX, (value) => {
      const text = new TextDecoder().decode(value);
      this._handleMessage(deviceId, text);
    });
    
    this._handleConnect({ id: deviceId, mode: 'ble' });
  }

  /**
   * Envío de mensajes (broadcast o unicast)
   */
  async broadcast(message) {
    if (this.state.peers.size === 0) return 0;
    
    let sent = 0;
    for (const [peerId, peer] of this.state.peers) {
      try {
        await this.send(peerId, message);
        sent++;
      } catch(e) {
        console.warn(`[HybridMesh] Error enviando a ${peerId}:`, e);
      }
    }
    return sent;
  }

  async send(deviceId, message) {
    const peer = this.state.peers.get(deviceId);
    if (!peer) throw new Error('Peer no conectado');
    
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    
    if (peer.mode === 'nearby') {
      await this._sendNearby(deviceId, data);
    } else if (peer.mode === 'ble') {
      await this._sendBLE(deviceId, data);
    }
  }

  async _sendNearby(deviceId, data) {
    const adapter = this.adapters.nearby;
    if (adapter.type === 'cordova') {
      await adapter.plugin.sendPayload(deviceId, data);
    } else {
      await adapter.plugin.sendData({ endpointId: deviceId, data });
    }
  }

  async _sendBLE(deviceId, data) {
    const encoded = new TextEncoder().encode(data);
    await BleClient.write(deviceId, NEXO_SERVICE_UUID, NEXO_CHAR_TX, encoded);
  }

  /**
   * Handlers de eventos
   */
  _handleDeviceFound(device) {
    device.timestamp = Date.now();
    this.state.discovered.set(device.id, device);
    this._emit('device', device);
  }

  _handleConnect(device) {
    this.state.peers.set(device.id, device);
    this._emit('connect', device);
    this._emit('peer', this.state.peers.size);
  }

  _handleDisconnect(deviceId) {
    if (this.state.peers.has(deviceId)) {
      const peer = this.state.peers.get(deviceId);
      this.state.peers.delete(deviceId);
      this._emit('disconnect', deviceId);
      this._emit('peer', this.state.peers.size);
    }
  }

  _handleMessage(deviceId, payload) {
    try {
      let data = payload;
      if (typeof payload === 'string') {
        try { data = JSON.parse(payload); } catch(e) {}
      }
      this._emit('message', data, deviceId);
    } catch(e) {
      console.error('[HybridMesh] Error parsing message:', e);
    }
  }

  /**
   * Utilidades
   */
  async _generateDeviceId() {
    const { Device } = await import('@capacitor/device');
    const info = await Device.getId();
    return info.identifier || `nexo-${Date.now()}`;
  }

  _generateShortId() {
    return Math.random().toString(36).substr(2, 6);
  }

  getPeers() {
    return Array.from(this.state.peers.values());
  }

  getPeerCount() {
    return this.state.peers.size;
  }

  getStatus() {
    return {
      mode: this.state.mode,
      initialized: this.state.isInitialized,
      scanning: this.state.isScanning,
      peerCount: this.state.peers.size,
      discoveredCount: this.state.discovered.size
    };
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stopScan();
    for (const [peerId] of this.state.peers) {
      try {
        if (this.state.mode === 'ble') {
          BleClient.disconnect(peerId);
        }
      } catch(e) {}
    }
    this.state.peers.clear();
    this.state.discovered.clear();
  }
}

export default HybridMesh;

