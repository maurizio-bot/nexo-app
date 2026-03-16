/**
 * NEXO v9.0 - BLE Mesh v6.0 (Google Nearby Multipeer)
 * Plugin: @squareetlabs/capacitor-nearby-multipeer
 * FIX: Reemplaza BLE tradicional por Google Nearby Connections (WiFi + BLE hybrid)
 */

import { NearbyMultipeer } from '@squareetlabs/capacitor-nearby-multipeer';
import { Capacitor } from '@capacitor/core';

export class BleMesh {
  constructor(options = {}) {
    this.config = {
      serviceId: options.serviceUuid || 'com.nexo.mesh.v1', // Nearby usa serviceId string, no UUID
      deviceNamePrefix: options.deviceNamePrefix || 'NEXO',
      maxPeers: options.maxPeers || 8,
      scanTimeout: options.scanTimeout || 30000,
      strategy: options.strategy || 'P2P_STAR', // P2P_STAR o P2P_CLUSTER
      ...options
    };

    this.state = {
      isScanning: false,
      isAdvertising: false,
      isInitialized: false,
      peers: new Map(), // Nearby endpointId -> peer info
      localId: null, // Se obtiene del plugin
      platform: Capacitor.getPlatform(),
      isNative: Capacitor.isNativePlatform()
    };

    this._listeners = {
      message: [],
      peer: [],
      connect: [],
      disconnect: [],
      error: [],
      device: [] // Para compatibilidad: dispositivos descubiertos
    };

    this._discoveredEndpoints = new Map(); // Endpoints encontrados pero no conectados
    this.timers = { scan: null };
    this.destroyed = false;
  }

  /**
   * Inicializa el mesh y solicita permisos
   */
  async init() {
    if (this.destroyed) throw new Error('BleMesh destruido');
    if (this.state.isInitialized) return true;

    if (!this.state.isNative) {
      console.warn('[BleMesh] No es plataforma nativa - Nearby requiere Android/iOS');
      throw new Error('Capacitor Native Platform required for Nearby');
    }

    try {
      // Inicializar Nearby con el serviceId
      await NearbyMultipeer.initialize({ 
        serviceId: this.config.serviceId 
      });
      
      // Configurar estrategia (P2P_STAR = mesh, P2P_CLUSTER = star topology)
      await NearbyMultipeer.setStrategy({ 
        strategy: this.config.strategy 
      });

      // Configurar listeners de eventos
      this._setupNearbyListeners();

      this.state.isInitialized = true;
      this.state.localId = await this._getLocalEndpointId();
      
      console.log('[BleMesh] ✅ Google Nearby initialized', {
        serviceId: this.config.serviceId,
        strategy: this.config.strategy,
        localId: this.state.localId
      });
      
      // Iniciar advertising automáticamente (ser visible para otros)
      await this.startAdvertising();
      
      this._emit('ready');
      return true;
      
    } catch (err) {
      console.error('[BleMesh] ❌ Init error:', err);
      this._emit('error', err);
      throw err;
    }
  }

  /**
   * Configura los listeners del plugin Nearby
   */
  _setupNearbyListeners() {
    // Dispositivo encontrado durante descubrimiento
    NearbyMultipeer.addListener('onEndpointFound', (event) => {
      const { endpointId, endpointName, serviceId } = event;
      
      // Solo dispositivos de nuestro servicio
      if (serviceId !== this.config.serviceId) return;
      
      const device = {
        id: endpointId,
        name: endpointName || `NEXO-${endpointId.substr(0, 6)}`,
        endpointId: endpointId,
        serviceId: serviceId
      };

      this._discoveredEndpoints.set(endpointId, device);
      console.log(`[BleMesh] 📡 Encontrado: ${device.name} (${endpointId})`);
      
      // Emitir como 'device' para compatibilidad con UI anterior
      this._emit('device', {
        ...device,
        rssi: -50, // Simulado - Nearby no da RSSI pero da distancia aproximada
        txPower: 0
      });

      // Auto-conectar si es NEXO
      if (device.name.includes(this.config.deviceNamePrefix) && 
          !this.state.peers.has(endpointId) &&
          this.state.peers.size < this.config.maxPeers) {
        console.log(`[BleMesh] Auto-conectando a ${device.name}`);
        this.connect(endpointId);
      }
    });

    // Dispositivo perdido (se fue del rango)
    NearbyMultipeer.addListener('onEndpointLost', (event) => {
      const { endpointId } = event;
      this._discoveredEndpoints.delete(endpointId);
      console.log(`[BleMesh] 👋 Perdido: ${endpointId}`);
    });

    // Resultado de conexión (éxito o fallo)
    NearbyMultipeer.addListener('onConnectionResult', (event) => {
      const { endpointId, status, statusCode } = event;
      
      if (status === 'connected') {
        this._handleConnectionSuccess(endpointId);
      } else {
        console.error(`[BleMesh] ❌ Conexión fallida ${endpointId}: ${statusCode}`);
        this._emit('error', new Error(`Connection failed: ${statusCode}`));
      }
    });

    // Desconexión
    NearbyMultipeer.addListener('onDisconnected', (event) => {
      const { endpointId } = event;
      this._handleDisconnection(endpointId);
    });

    // Datos recibidos
    NearbyMultipeer.addListener('onReceiveData', (event) => {
      const { endpointId, data } = event; // data es string o bytes
      this._handleIncomingMessage(endpointId, data);
    });

    // Errores
    NearbyMultipeer.addListener('onError', (event) => {
      console.error('[BleMesh] Nearby error:', event);
      this._emit('error', new Error(event.errorMessage || 'Nearby error'));
    });
  }

  /**
   * Obtiene el ID local del endpoint
   */
  async _getLocalEndpointId() {
    // El plugin no expone directamente el ID local, pero podemos usar el device ID de Capacitor
    const { Device } = await import('@capacitor/device');
    const info = await Device.getId();
    return info.identifier || `nexo-${Date.now()}`;
  }

  /**
   * Inicia advertising (hace visible este dispositivo)
   */
  async startAdvertising() {
    if (!this.state.isInitialized) return;
    if (this.state.isAdvertising) return;

    try {
      await NearbyMultipeer.startAdvertising({
        endpointName: `${this.config.deviceNamePrefix}-${this.state.localId.substr(0, 6)}`
      });
      this.state.isAdvertising = true;
      console.log('[BleMesh] 📢 Advertising iniciado');
    } catch (err) {
      console.warn('[BleMesh] Advertising error:', err);
      // No es crítico, podemos funcionar solo como scanner
    }
  }

  /**
   * Detiene advertising
   */
  async stopAdvertising() {
    if (!this.state.isAdvertising) return;
    try {
      await NearbyMultipeer.stopAdvertising();
      this.state.isAdvertising = false;
      console.log('[BleMesh] 📢 Advertising detenido');
    } catch (e) {}
  }

  /**
   * Inicia descubrimiento de dispositivos (equivalente a startScan)
   */
  async startScan(duration = null) {
    if (this.destroyed) throw new Error('BleMesh destruido');
    if (!this.state.isInitialized) throw new Error('BleMesh no inicializado');
    if (this.state.isScanning) return;

    const scanDuration = duration || this.config.scanTimeout;

    try {
      this.state.isScanning = true;
      this._emit('scanning', true);
      
      console.log(`[BleMesh] 🔍 Iniciando discovery por ${scanDuration}ms...`);
      
      // Nearby usa startDiscovery en lugar de scan
      await NearbyMultipeer.startDiscovery();

      // Auto-stop después del timeout
      this.timers.scan = setTimeout(() => {
        this.stopScan();
      }, scanDuration);

    } catch (err) {
      console.error('[BleMesh] Discovery error:', err);
      this.state.isScanning = false;
      this._emit('error', err);
      throw err;
    }
  }

  /**
   * Detiene descubrimiento
   */
  async stopScan() {
    if (!this.state.isScanning) return;
    
    try {
      await NearbyMultipeer.stopDiscovery();
      if (this.timers.scan) {
        clearTimeout(this.timers.scan);
        this.timers.scan = null;
      }
      this.state.isScanning = false;
      this._emit('scanning', false);
      console.log('[BleMesh] ⏹️ Discovery detenido');
    } catch (err) {
      console.error('[BleMesh] Error deteniendo discovery:', err);
    }
  }

  /**
   * Conecta a un endpoint específico (deviceId = endpointId)
   */
  async connect(deviceId) {
    if (this.destroyed) throw new Error('BleMesh destruido');
    if (!this.state.isInitialized) throw new Error('BleMesh no inicializado');
    
    if (this.state.peers.has(deviceId)) {
      console.log(`[BleMesh] ${deviceId} ya conectado`);
      return;
    }

    if (this.state.peers.size >= this.config.maxPeers) {
      console.log(`[BleMesh] Max peers (${this.config.maxPeers}) alcanzado`);
      return;
    }

    try {
      console.log(`[BleMesh] 🔗 Conectando a ${deviceId}...`);
      
      // Nearby requiere que especifiquemos el endpointId
      await NearbyMultipeer.connect({
        endpointId: deviceId,
        displayName: `${this.config.deviceNamePrefix}-${this.state.localId.substr(0, 6)}`
      });

      // La confirmación de conexión vendrá por el evento onConnectionResult
      
    } catch (err) {
      console.error(`[BleMesh] ❌ Error conectando ${deviceId}:`, err);
      this._emit('error', err);
    }
  }

  /**
   * Maneja conexión exitosa (llamado por evento)
   */
  _handleConnectionSuccess(endpointId) {
    const discovered = this._discoveredEndpoints.get(endpointId);
    const peer = {
      id: endpointId,
      endpointId: endpointId,
      name: discovered?.name || `Peer-${endpointId.substr(0, 6)}`,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      type: 'nearby_p2p'
    };

    this.state.peers.set(endpointId, peer);
    this._emit('connect', endpointId);
    this._emit('peer', this.state.peers.size);
    
    console.log(`[BleMesh] ✅ Conectado: ${peer.name} (Total: ${this.state.peers.size})`);
  }

  /**
   * Desconecta un peer
   */
  async disconnect(deviceId) {
    const peer = this.state.peers.get(deviceId);
    if (!peer) return;

    try {
      await NearbyMultipeer.disconnect({ endpointId: deviceId });
    } catch (err) {
      console.warn(`[BleMesh] Error desconectando ${deviceId}:`, err);
    }
    
    this._handleDisconnection(deviceId);
  }

  /**
   * Maneja desconexión
   */
  _handleDisconnection(deviceId) {
    if (this.state.peers.has(deviceId)) {
      const peer = this.state.peers.get(deviceId);
      this.state.peers.delete(deviceId);
      this._emit('disconnect', deviceId);
      this._emit('peer', this.state.peers.size);
      console.log(`[BleMesh] 🔌 Desconectado: ${peer.name} (Restantes: ${this.state.peers.size})`);
    }
  }

  /**
   * Maneja mensajes entrantes
   */
  _handleIncomingMessage(deviceId, data) {
    try {
      // Nearby devuelve data como string o array de bytes
      let text = data;
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        text = new TextDecoder('utf-8').decode(data);
      }
      
      const message = JSON.parse(text);
      const peer = this.state.peers.get(deviceId);
      if (peer) peer.lastSeen = Date.now();

      this._emit('message', message, deviceId);
      
    } catch (err) {
      // Si no es JSON, enviar como raw
      let text = data;
      if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
        text = new TextDecoder('utf-8').decode(data);
      }
      this._emit('message', { type: 'raw', data: text }, deviceId);
    }
  }

  /**
   * Envía mensaje a un peer específico
   */
  async send(deviceId, message) {
    if (this.destroyed) throw new Error('BleMesh destruido');
    
    const peer = this.state.peers.get(deviceId);
    if (!peer) throw new Error(`Peer ${deviceId} no conectado`);

    try {
      const data = JSON.stringify(message);
      await NearbyMultipeer.sendData({
        endpointId: deviceId,
        data: data
      });
      return true;
    } catch (err) {
      console.error(`[BleMesh] Error enviando a ${deviceId}:`, err);
      return false;
    }
  }

  /**
   * Broadcast a todos los peers
   */
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

  // API pública de compatibilidad

  getPeerCount() {
    return this.state.peers.size;
  }

  getPeers() {
    return Array.from(this.state.peers.entries()).map(([id, peer]) => ({
      id,
      endpointId: peer.endpointId,
      name: peer.name,
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
      maxPeers: this.config.maxPeers,
      serviceId: this.config.serviceId
    };
  }

  // Event emitter básico
  on(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event].push(callback);
    }
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }
  }

  _emit(event, ...args) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => {
        try { cb(...args); } catch (e) {}
      });
    }
  }

  /**
   * Cleanup completo
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.stopScan();
    this.stopAdvertising();

    // Desconectar todos
    for (const [deviceId] of this.state.peers) {
      try {
        NearbyMultipeer.disconnect({ endpointId: deviceId });
      } catch (e) {}
    }
    this.state.peers.clear();

    Object.keys(this._listeners).forEach(key => {
      this._listeners[key] = [];
    });

    console.log('[BleMesh] 🗑️ Destruido');
  }
}

export default BleMesh;
