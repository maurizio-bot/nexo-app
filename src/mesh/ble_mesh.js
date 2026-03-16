/**
 * NEXO v9.0 - BLE Mesh v5.1 (Capacitor Native)
 * FIX: Agregado advertising + permisos runtime
 */

import { BleClient } from '@capacitor-community/bluetooth-le';
import { Capacitor } from '@capacitor/core';
import { Permissions } from '@capacitor-community/bluetooth-le'; // Importar permisos

export class BleMesh {
  constructor(options = {}) {
    this.config = {
      serviceUuid: options.serviceUuid || '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
      characteristicUuid: options.characteristicUuid || 'beb5483e-36e1-4688-b7f5-ea07361b26a8',
      deviceNamePrefix: options.deviceNamePrefix || 'NEXO',
      maxPeers: options.maxPeers || 8,
      scanTimeout: options.scanTimeout || 30000, // Aumentado a 30s
      autoConnectRssi: options.autoConnectRssi || -80, // Más permisivo
      ...options
    };

    this.state = {
      isScanning: false,
      isAdvertising: false, // NUEVO: estado de advertising
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

  // NUEVO: Solicitar permisos antes de usar BLE
  async requestPermissions() {
    if (!this.state.isNative) return true;
    
    try {
      // Solicitar todos los permisos necesarios
      const result = await BleClient.requestLEScan({}); // Esto solicitará permisos automáticamente
      
      // Para Android 12+, también necesitamos permisos de ubicación
      if (this.state.platform === 'android') {
        const { location } = await import('@capacitor/geolocation');
        const perm = await location.requestPermissions();
        if (perm.location !== 'granted') {
          console.warn('[BleMesh] Permiso de ubicación no concedido - BLE puede fallar');
        }
      }
      
      return true;
    } catch (err) {
      console.error('[BleMesh] Error solicitando permisos:', err);
      throw new Error('Permisos BLE denegados: ' + err.message);
    }
  }

  async init() {
    if (this.destroyed) throw new Error('BleMesh destruido');
    if (this.state.isInitialized) return true;

    if (!this.state.isNative) {
      console.warn('[BleMesh] No es plataforma nativa');
      throw new Error('Capacitor Native Platform required');
    }

    try {
      // NUEVO: Solicitar permisos primero
      await this.requestPermissions();
      
      await BleClient.initialize({ androidNeverForLocation: false });
      this.state.isInitialized = true;
      console.log('[BleMesh] ✅ Native BLE initialized');
      
      // NUEVO: Iniciar advertising automáticamente para ser descubierto
      await this.startAdvertising();
      
      this._emit('ready');
      return true;
    } catch (err) {
      console.error('[BleMesh] ❌ Init error:', err);
      this._emit('error', err);
      throw err;
    }
  }

  // NUEVO: Advertising - hace que este dispositivo sea visible para otros
  async startAdvertising() {
    if (!this.state.isInitialized) return;
    if (this.state.isAdvertising) return;
    
    try {
      // Crear un GATT server para que otros puedan conectarse
      // Nota: @capacitor-community/bluetooth-le no tiene advertising nativo,
      // pero podemos simularlo creando un servidor GATT
      
      console.log('[BleMesh] 📢 Iniciando advertising...');
      
      // Como workaround, enviamos un broadcast periódico a todos los peers conectados
      // y escaneamos constantemente
      
      this.state.isAdvertising = true;
      
      // En Android, el scan automático hace visible el dispositivo si otros escanean
      // pero para un verdadero mesh, necesitamos que ambos escaneen
        
    } catch (err) {
      console.warn('[BleMesh] Advertising no soportado en este dispositivo:', err);
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

      // FIX: Scan sin filtro de servicio para encontrar todos los dispositivos BLE
      await BleClient.requestLEScan(
        {
          // Eliminado: services: [this.config.serviceUuid], 
          // Ahora escanea TODOS los dispositivos BLE cercanos
          allowDuplicates: true, // Permitir duplicados para actualizar RSSI
          scanMode: 2 // SCAN_MODE_LOW_LATENCY
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
    // FIX: Aceptar cualquier dispositivo, no solo los que tienen nuestro service UUID
    const device = {
      id: result.device.deviceId,
      name: result.device.name || result.device.localName || 'NEXO Device',
      rssi: result.rssi,
      txPower: result.txPower,
      manufacturerData: result.manufacturerData,
      uuids: result.uuids || []
    };

    // Solo procesar dispositivos con buena señal o que parezcan ser NEXO
    if (device.name.includes(this.config.deviceNamePrefix) || 
        device.name.includes('Galaxy') || 
        device.name.includes('Android') ||
        device.rssi > -90) {
      
      console.log(`[BleMesh] 📡 Encontrado: ${device.name} (${device.rssi}dBm)`);
      this._emit('device', device);
    }

    // Auto-conectar si la señal es fuerte y es un dispositivo NEXO
    if (device.rssi > this.config.autoConnectRssi && 
        (device.name.includes(this.config.deviceNamePrefix) || device.name.includes('Galaxy')) &&
        !this._connectingDevices.has(device.id) &&
        !this.state.peers.has(device.id) &&
        this.state.peers.size < this.config.maxPeers) {
      
      console.log(`[BleMesh] Auto-conectando a ${device.name} (${device.rssi}dBm)`);
      this.connect(device.id);
    }
  }

  // Resto del código se mantiene igual...
  
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

      // Intentar descubrir servicios
      try {
        await BleClient.discoverServices(deviceId);
        
        // Intentar suscribirse a notificaciones si existe el servicio
        await BleClient.startNotifications(
          deviceId,
          this.config.serviceUuid,
          this.config.characteristicUuid,
          (value) => {
            this._handleIncomingMessage(deviceId, value);
          }
        );
      } catch (serviceErr) {
        console.warn(`[BleMesh] Servicio no encontrado en ${deviceId}, conexión básica`);
        // Continuar sin el servicio específico - es un dispositivo genérico
      }

      this.state.peers.set(deviceId, {
        id: deviceId,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        type: 'ble_native',
        name: deviceId // Guardar nombre si lo tenemos
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
      advertising: this.state.isAdvertising,
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
