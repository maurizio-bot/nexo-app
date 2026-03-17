/**
 * NEXO Hybrid Mesh v2.0 
 * Basado en documentación oficial @capacitor-community/bluetooth-le
 * FIX: Flujo correcto de permisos Android 12+
 */

import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';

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
      mode: null,
      initialized: false,
      scanning: false,
      peers: new Map(),
      discovered: new Map(),
      localId: null,
      permissionsGranted: false
    };

    this.listeners = {
      device: [], connect: [], disconnect: [],
      message: [], error: [], scanning: [], ready: []
    };

    // Callbacks para BLEInterface
    this.callbacks = {
      onDeviceFound: () => {},
      onDeviceConnected: () => {},
      onDeviceDisconnected: () => {},
      onError: () => {}
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
    if (event === 'device') this.callbacks.onDeviceFound(args[0]);
    if (event === 'connect') this.callbacks.onDeviceConnected(args[0]);
    if (event === 'disconnect') this.callbacks.onDeviceDisconnected(args[0]);
    if (event === 'error') this.callbacks.onError('MESH_ERROR', args[0]?.message || args[0]);
  }

  /**
   * Inicialización con flujo correcto de permisos según documentación
   */
  async init() {
    if (this.state.initialized) return true;
    
    console.log('[HybridMesh] Iniciando...');

    if (!Capacitor.isNativePlatform()) {
      this.state.mode = 'offline';
      this.state.initialized = true;
      this._emit('ready');
      return true;
    }

    try {
      // PASO 1: Verificar ubicación GPS activada (CRÍTICO para Android)
      if (Capacitor.getPlatform() === 'android') {
        const isLocationEnabled = await BleClient.isLocationEnabled();
        console.log('[HybridMesh] Ubicación activada:', isLocationEnabled);
        
        if (!isLocationEnabled) {
          // Abrir settings de ubicación - el usuario debe activarla manualmente
          console.log('[HybridMesh] Abriendo settings de ubicación...');
          await BleClient.openLocationSettings();
          
          // Verificar de nuevo después de un delay
          await new Promise(r => setTimeout(r, 2000));
          const stillDisabled = !(await BleClient.isLocationEnabled());
          if (stillDisabled) {
            console.warn('[HybridMesh] ⚠️ Ubicación sigue desactivada - el scan no funcionará');
            this._emit('error', new Error('GPS_DESACTIVADO: Activa ubicación para escanear BLE'));
          }
        }
      }

      // PASO 2: Inicializar BLE (esto solicita permisos automáticamente en Android 12+)
      console.log('[HybridMesh] Inicializando BLE...');
      await BleClient.initialize({ 
        androidNeverForLocation: false // Requerimos ubicación para scan preciso
      });
      
      this.state.permissionsGranted = true;
      console.log('[HybridMesh] ✅ BLE inicializado');

      // PASO 3: Verificar Bluetooth activado
      const isEnabled = await BleClient.isEnabled();
      if (!isEnabled) {
        console.log('[HybridMesh] Bluetooth apagado, solicitando activación...');
        await BleClient.requestEnable();
      }

      // PASO 4: Modo BLE activo
      this.state.mode = 'ble';
      this.state.initialized = true;
      this.state.localId = `nexo-${Math.random().toString(36).substr(2, 8)}`;
      
      console.log('[HybridMesh] ✅ Listo. ID:', this.state.localId);
      this._emit('ready');
      return true;

    } catch (err) {
      console.error('[HybridMesh] ❌ Error:', err.message);
      this._emit('error', err);
      
      // Si es error de permisos, informar claramente
      if (err.message?.includes('permission') || err.message?.includes('Permission')) {
        this.callbacks.onError('PERMISOS', 'Debes aceptar permisos Bluetooth en Configuración → Apps → NEXO');
      }
      
      // Fallback a offline
      this.state.mode = 'offline';
      this.state.initialized = true;
      this._emit('ready');
      return true;
    }
  }

  /**
   * Scan según documentación oficial
   */
  async startScan() {
    if (!this.state.initialized) throw new Error('No inicializado');
    if (this.state.mode === 'offline') {
      console.warn('[HybridMesh] Modo offline - no se puede escanear');
      return false;
    }
    if (this.state.scanning) return true;

    // Verificar ubicación de nuevo (puede cambiar durante la ejecución)
    if (Capacitor.getPlatform() === 'android') {
      const isLocationEnabled = await BleClient.isLocationEnabled();
      if (!isLocationEnabled) {
        throw new Error('UBICACION_APAGADA: Activa el GPS para escanear');
      }
    }

    this.state.scanning = true;
    this._emit('scanning', true);

    try {
      console.log('[HybridMesh] 🔍 Iniciando scan...');
      
      // Usar requestLEScan con callback según documentación
      await BleClient.requestLEScan(
        { 
          services: [NEXO_SERVICE], // Filtrar por servicio NEXO
          allowDuplicates: false 
        },
        (result) => {
          // Callback por cada dispositivo encontrado
          console.log('[HybridMesh] Dispositivo encontrado:', result.device.name, result.device.deviceId);
          this._handleDeviceFound({
            id: result.device.deviceId,
            name: result.device.name || `NEXO-${result.device.deviceId.substr(0,6)}`,
            rssi: result.rssi,
            mode: 'ble'
          });
        }
      );

      // Auto-stop después de 30 segundos
      setTimeout(() => this.stopScan(), 30000);
      return true;

    } catch (err) {
      console.error('[HybridMesh] Error scan:', err);
      this.state.scanning = false;
      this._emit('scanning', false);
      throw err;
    }
  }

  async stopScan() {
    if (!this.state.scanning) return;
    
    try {
      await BleClient.stopLEScan();
    } catch(e) {}
    
    this.state.scanning = false;
    this._emit('scanning', false);
    console.log('[HybridMesh] Scan detenido');
  }

  /**
   * Conexión BLE
   */
  async connect(deviceId) {
    try {
      await BleClient.connect(deviceId);
      
      const peer = {
        id: deviceId,
        name: this.state.discovered.get(deviceId)?.name || 'Peer',
        mode: 'ble',
        connectedAt: Date.now()
      };
      
      this.state.peers.set(deviceId, peer);
      this.state.discovered.delete(deviceId);
      this._emit('connect', peer);

      // Setup notificaciones RX
      await BleClient.startNotifications(deviceId, NEXO_SERVICE, NEXO_RX, (value) => {
        const text = new TextDecoder().decode(value);
        this._handleMessage(deviceId, text);
      });

    } catch (err) {
      console.error('[HybridMesh] Error conectando:', err);
      throw err;
    }
  }

  async disconnect(deviceId) {
    try {
      await BleClient.disconnect(deviceId);
      this._handleDisconnect(deviceId);
    } catch(e) {}
  }

  /**
   * Enviar mensaje
   */
  async broadcast(message) {
    if (this.state.peers.size === 0) return 0;
    
    let count = 0;
    const data = JSON.stringify(message);
    
    for (const [peerId, peer] of this.state.peers) {
      try {
        const encoded = new TextEncoder().encode(data);
        await BleClient.write(peerId, NEXO_SERVICE, NEXO_TX, encoded);
        count++;
      } catch(e) {
        console.warn(`[HybridMesh] Error enviando a ${peerId}:`, e);
      }
    }
    return count;
  }

  _handleDeviceFound(device) {
    if (this.state.peers.has(device.id)) return;
    device.timestamp = Date.now();
    this.state.discovered.set(device.id, device);
    this._emit('device', device);
  }

  _handleConnect(device) {
    this.state.peers.set(device.id, device);
    this._emit('connect', device);
  }

  _handleDisconnect(deviceId) {
    if (this.state.peers.has(deviceId)) {
      this.state.peers.delete(deviceId);
      this._emit('disconnect', deviceId);
    }
  }

  _handleMessage(deviceId, payload) {
    try {
      let data = payload;
      if (typeof payload === 'string') {
        try { data = JSON.parse(payload); } catch(e) {}
      }
      this._emit('message', data, deviceId);
    } catch(e) {}
  }

  getPeers() { return Array.from(this.state.peers.values()); }
  getPeerCount() { return this.state.peers.size; }
  
  getStatus() {
    return {
      mode: this.state.mode,
      initialized: this.state.initialized,
      scanning: this.state.scanning,
      peerCount: this.state.peers.size,
      discoveredCount: this.state.discovered.size,
      localId: this.state.localId,
      permissionsGranted: this.state.permissionsGranted
    };
  }

  destroy() {
    this.stopScan();
    this.state.peers.forEach((peer, id) => {
      try { BleClient.disconnect(id); } catch(e) {}
    });
  }
}

export default HybridMesh;
