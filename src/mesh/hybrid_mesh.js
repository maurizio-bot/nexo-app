/**
 * NEXO Hybrid Mesh v1.1 
 * Fallback automático: Nearby → BLE → Offline
 * FIX: Solicitud de permisos Android 12+ en runtime
 */

import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { permissionsService } from '../utils/permissions.js';

// UUIDs servicio NEXO BLE
const NEXO_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NEXO_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; 
const NEXO_RX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export class HybridMesh {
  constructor(options = {}) {
    this.config = {
      serviceId: options.serviceId || 'com.nexo.mesh',
      deviceName: options.deviceName || 'NEXO',
      maxPeers: options.maxPeers || 8,
      ...options
    };
    
    this.state = {
      mode: null, // 'nearby', 'ble', 'offline'
      initialized: false,
      scanning: false,
      peers: new Map(),
      discovered: new Map(),
      localId: null
    };
    
    this.adapters = {};
    this.listeners = {
      device: [], connect: [], disconnect: [], 
      message: [], error: [], scanning: [], ready: []
    };
    
    this.nearbyModule = null;
    
    // FIX: Inicializar callbacks para compatibilidad con BLEInterface
    this.callbacks = {
      onDeviceFound: options.callbacks?.onDeviceFound || (() => {}),
      onDeviceConnected: options.callbacks?.onDeviceConnected || (() => {}),
      onDeviceDisconnected: options.callbacks?.onDeviceDisconnected || (() => {}),
      onError: options.callbacks?.onError || (() => {}),
      onConnectionRequest: options.callbacks?.onConnectionRequest || (() => {})
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
      this.listeners[event].forEach(cb => {
        try { cb(...args); } catch(e) {}
      });
    }
    
    // FIX: También llamar callbacks para compatibilidad con BLEInterface
    if (event === 'device' && this.callbacks.onDeviceFound) {
      try { this.callbacks.onDeviceFound(args[0]); } catch(e) {}
    }
    if (event === 'connect' && this.callbacks.onDeviceConnected) {
      try { this.callbacks.onDeviceConnected(args[0]); } catch(e) {}
    }
    if (event === 'disconnect' && this.callbacks.onDeviceDisconnected) {
      try { this.callbacks.onDeviceDisconnected(args[0]); } catch(e) {}
    }
    if (event === 'error' && this.callbacks.onError) {
      try { this.callbacks.onError('MESH_ERROR', args[0]?.message || args[0]); } catch(e) {}
    }
  }

  /**
   * Inicialización con fallback automático + Permisos
   */
  async init() {
    if (this.state.initialized) return true;
    
    console.log('[HybridMesh] Detectando mejor modo de conexión...');
    
    // FIX: Solicitar permisos antes de cualquier operación BLE/Nearby
    if (Capacitor.isNativePlatform()) {
      console.log('[HybridMesh] Solicitando permisos...');
      const hasPermissions = await permissionsService.requestBLEPermissions();
      
      if (!hasPermissions) {
        console.error('[HybridMesh] ❌ Permisos denegados');
        this.state.mode = 'offline';
        this.state.initialized = true;
        this.callbacks.onError('PERMISSIONS_DENIED', 'Permisos BLE denegados');
        this._emit('ready');
        return true;
      }
      
      // FIX: Verificar ubicación activada (requerido para BLE)
      const locationEnabled = await permissionsService.checkLocationEnabled();
      if (!locationEnabled) {
        console.warn('[HybridMesh] ⚠️ Ubicación desactivada - BLE puede fallar');
        this.callbacks.onError('LOCATION_DISABLED', 'Activa la ubicación/GPS para usar BLE');
      }
    }
    
    // 1. Intentar Nearby (Google Play Services)
    try {
      if (Capacitor.isNativePlatform()) {
        await this._initNearby();
        this.state.mode = 'nearby';
        console.log('[HybridMesh] ✅ Modo NEARBY activo');
      } else {
        throw new Error('No es nativo');
      }
    } catch (nearbyErr) {
      console.warn('[HybridMesh] Nearby no disponible:', nearbyErr.message);
      
      // 2. Intentar BLE tradicional
      try {
        if (Capacitor.isNativePlatform()) {
          await this._initBLE();
          this.state.mode = 'ble';
          console.log('[HybridMesh] ✅ Modo BLE activo (fallback)');
        } else {
          throw new Error('No es nativo');
        }
      } catch (bleErr) {
        console.warn('[HybridMesh] BLE no disponible:', bleErr.message);
        
        // 3. Modo offline (solo local)
        this.state.mode = 'offline';
        console.log('[HybridMesh] ⚠️ Modo OFFLINE activo');
      }
    }
    
    this.state.initialized = true;
    this.state.localId = `nexo-${Math.random().toString(36).substr(2, 8)}`;
    this._emit('ready');
    return true;
  }

  /**
   * NEARBY: Google Nearby Connections
   */
  async _initNearby() {
    // Intentar importar plugin Capacitor
    try {
      const module = await import('@squareetlabs/capacitor-nearby-multipeer');
      this.nearbyModule = module.NearbyMultipeer;
    } catch {
      // Fallback a cordova si existe
      if (typeof cordova !== 'undefined' && cordova.plugins?.nearby) {
        this.nearbyModule = cordova.plugins.nearby;
        this._setupCordovaNearby();
      } else {
        throw new Error('Plugin Nearby no instalado');
      }
      return;
    }
    
    // Inicializar plugin Capacitor
    await this.nearbyModule.initialize({ serviceId: this.config.serviceId });
    await this.nearbyModule.setStrategy({ strategy: 'P2P_STAR' });
    
    // Listeners
    this.nearbyModule.addListener('onEndpointFound', (e) => {
      this._handleDeviceFound({
        id: e.endpointId,
        name: e.endpointName || `NEXO-${e.endpointId.substr(0,6)}`,
        rssi: -50,
        mode: 'nearby'
      });
    });
    
    this.nearbyModule.addListener('onConnectionResult', (e) => {
      if (e.status === 'connected') {
        this._handleConnect({ id: e.endpointId, name: `Peer-${e.endpointId.substr(0,4)}`, mode: 'nearby' });
      }
    });
    
    this.nearbyModule.addListener('onDisconnected', (e) => {
      this._handleDisconnect(e.endpointId);
    });
    
    this.nearbyModule.addListener('onReceiveData', (e) => {
      this._handleMessage(e.endpointId, e.data);
    });
    
    // Iniciar advertising
    await this.nearbyModule.startAdvertising({ 
      endpointName: `${this.config.deviceName}-${this.state.localId?.substr(0,4) || 'node'}` 
    });
  }

  _setupCordovaNearby() {
    // API Cordova legacy
    this.nearbyModule.onEndpointFound = (id, info) => {
      this._handleDeviceFound({ id, name: info.name, rssi: -50, mode: 'nearby' });
    };
    
    this.nearbyModule.onConnectionResult = (id, result) => {
      if (result.status === 'CONNECTED') {
        this._handleConnect({ id, name: `Peer-${id.substr(0,4)}`, mode: 'nearby' });
      }
    };
    
    this.nearbyModule.onDisconnected = (id) => this._handleDisconnect(id);
    this.nearbyModule.onReceive = (id, payload) => this._handleMessage(id, payload);
  }

  /**
   * BLE: Bluetooth Low Energy tradicional
   */
  async _initBLE() {
    await BleClient.initialize();
    
    this.adapters.ble = {
      scanResults: new Map(),
      connections: new Map()
    };
  }

  /**
   * Start Scan (modo-agnóstico) + Verificación permisos
   */
  async startScan() {
    if (!this.state.initialized) throw new Error('No inicializado');
    
    // FIX: Re-verificar permisos antes de scan
    if (Capacitor.isNativePlatform()) {
      const permStatus = await permissionsService.checkPermissions();
      if (permStatus && permStatus.scan !== 'granted') {
        console.warn('[HybridMesh] Re-solicitando permisos de scan...');
        await permissionsService.requestBLEPermissions();
      }
    }
    
    this.state.scanning = true;
    this._emit('scanning', true);
    
    try {
      if (this.state.mode === 'nearby') {
        await this.nearbyModule.startDiscovery();
      } else if (this.state.mode === 'ble') {
        await BleClient.requestLEScan(
          { services: [NEXO_SERVICE], allowDuplicates: false },
          (result) => {
            this._handleDeviceFound({
              id: result.device.deviceId,
              name: result.device.name || `NEXO-${result.device.deviceId.substr(0,6)}`,
              rssi: result.rssi,
              mode: 'ble'
            });
          }
        );
      } else {
        console.warn('[HybridMesh] Modo offline - no se puede scanear');
      }
    } catch (err) {
      console.error('[HybridMesh] Scan error:', err);
      this.state.scanning = false;
      this._emit('scanning', false);
      this.callbacks.onError('SCAN_ERROR', err.message);
      throw err;
    }
    
    // Auto-stop después de 30s
    setTimeout(() => this.stopScan(), 30000);
    return true;
  }

  async stopScan() {
    if (!this.state.scanning) return;
    
    try {
      if (this.state.mode === 'nearby') {
        await this.nearbyModule.stopDiscovery();
      } else if (this.state.mode === 'ble') {
        await BleClient.stopLEScan();
      }
    } catch(e) {}
    
    this.state.scanning = false;
    this._emit('scanning', false);
  }

  /**
   * Conexión a dispositivo
   */
  async connect(deviceId) {
    const device = this.state.discovered.get(deviceId);
    if (!device) throw new Error('Dispositivo no encontrado');
    
    if (device.mode === 'nearby') {
      await this.nearbyModule.connect({ endpointId: deviceId });
      // La confirmación viene por evento onConnectionResult
    } else if (device.mode === 'ble') {
      await BleClient.connect(deviceId);
      const services = await BleClient.getServices(deviceId);
      
      // Guardar peer
      this.state.peers.set(deviceId, {
        id: deviceId,
        mode: 'ble',
        name: device.name,
        connectedAt: Date.now(),
        services
      });
      
      // Setup notificaciones RX
      await BleClient.startNotifications(deviceId, NEXO_SERVICE, NEXO_RX, (value) => {
        const text = new TextDecoder().decode(value);
        this._handleMessage(deviceId, text);
      });
      
      this._handleConnect(device);
    }
  }

  /**
   * Envío de mensajes
   */
  async broadcast(message) {
    if (this.state.peers.size === 0) return 0;
    
    let count = 0;
    const data = JSON.stringify(message);
    
    for (const [peerId, peer] of this.state.peers) {
      try {
        if (peer.mode === 'nearby') {
          await this.nearbyModule.sendData({ endpointId: peerId, data });
        } else if (peer.mode === 'ble') {
          const encoded = new TextEncoder().encode(data);
          await BleClient.write(peerId, NEXO_SERVICE, NEXO_TX, encoded);
        }
        count++;
      } catch(e) {
        console.warn(`[HybridMesh] Error enviando a ${peerId}:`, e);
      }
    }
    return count;
  }

  async send(deviceId, message) {
    const peer = this.state.peers.get(deviceId);
    if (!peer) throw new Error('Peer no conectado');
    
    const data = JSON.stringify(message);
    
    if (peer.mode === 'nearby') {
      await this.nearbyModule.sendData({ endpointId: deviceId, data });
    } else if (peer.mode === 'ble') {
      const encoded = new TextEncoder().encode(data);
      await BleClient.write(deviceId, NEXO_SERVICE, NEXO_TX, encoded);
    }
  }

  /**
   * Handlers
   */
  _handleDeviceFound(device) {
    if (this.state.peers.has(device.id)) return; // Ya conectado
    
    device.timestamp = Date.now();
    this.state.discovered.set(device.id, device);
    this._emit('device', device);
  }

  _handleConnect(device) {
    this.state.peers.set(device.id, device);
    this.state.discovered.delete(device.id); // Mover de descubiertos a conectados
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
   * API Pública
   */
  getPeers() {
    return Array.from(this.state.peers.values());
  }

  getPeerCount() {
    return this.state.peers.size;
  }

  getStatus() {
    return {
      mode: this.state.mode,
      initialized: this.state.initialized,
      scanning: this.state.scanning,
      peerCount: this.state.peers.size,
      discoveredCount: this.state.discovered.size
    };
  }

  destroy() {
    this.stopScan();
    this.state.peers.forEach((peer, id) => {
      try {
        if (peer.mode === 'ble') BleClient.disconnect(id);
        if (peer.mode === 'nearby') this.nearbyModule?.disconnect({ endpointId: id });
      } catch(e) {}
    });
    this.state.peers.clear();
    this.state.discovered.clear();
  }
}

export default HybridMesh;
