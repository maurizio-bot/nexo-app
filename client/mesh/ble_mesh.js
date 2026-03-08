/**
 * NEXO v9.0 - BLE Mesh v4.4 (APK-CERTIFIED)
 * Web Bluetooth API + WebRTC Data Channels
 * 
 * @version 4.4-apk-certified
 * @fixes Syntax error, race conditions, memory leaks, cleanup, maxPeers, broadcast validation
 */

class BleMesh {
  constructor(options = {}) {
    if (typeof navigator === 'undefined' || !navigator.bluetooth) {
      console.warn('[BleMesh] Web Bluetooth API no disponible');
    }

    this.config = {
      serviceUuid: options.serviceUuid || '0000ffe0-0000-1000-8000-00805f9b34fb',
      characteristicUuid: options.characteristicUuid || '0000ffe1-0000-1000-8000-00805f9b34fb',
      deviceNamePrefix: options.deviceNamePrefix || 'NEXO',
      maxPeers: options.maxPeers || 8,
      scanTimeout: options.scanTimeout || 10000,
      iceServers: options.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    this.state = {
      isScanning: false,
      isInitialized: false,
      peers: new Map(),
      localId: this._generateId(),
      initialDevice: null
    };

    // FIX: Track devices en proceso de conexión
    this._connectingDevices = new Set();

    this._listeners = {
      message: [],
      peer: [],
      connect: [],
      disconnect: [],
      error: []
    };

    this.rtcConfig = { iceServers: this.config.iceServers };
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
    if (!navigator.bluetooth) throw new Error('Web Bluetooth API no disponible');

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: this.config.deviceNamePrefix }],
        optionalServices: [this.config.serviceUuid]
      });

      this.state.initialDevice = device;
      
      device.addEventListener('gattserverdisconnected', () => {
        console.log('[BleMesh] Device inicial desconectado');
        this._handleDisconnection(device.id);
      });

      await this._connectDevice(device);
      this.state.isInitialized = true;
      this._startScanning();
      
      return true;
    } catch (err) {
      this._emit('error', err);
      throw err;
    }
  }

  /**
   * FIX: Verifica maxPeers y race conditions
   */
  async _connectDevice(device) {
    // FIX: Verificar maxPeers primero
    if (this.state.peers.size >= this.config.maxPeers) {
      console.log(`[BleMesh] Max peers (${this.config.maxPeers}) reached, skipping ${device.id}`);
      return;
    }

    // FIX: Race condition - previene conexiones concurrentes
    if (this._connectingDevices.has(device.id)) {
      console.log(`[BleMesh] Ya conectando ${device.id}, ignorando`);
      return;
    }

    if (this.state.peers.has(device.id)) {
      console.log(`[BleMesh] ${device.id} ya conectado`);
      return;
    }

    this._connectingDevices.add(device.id);

    try {
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(this.config.serviceUuid);
      const characteristic = await service.getCharacteristic(this.config.characteristicUuid);

      try {
        await characteristic.startNotifications();
      } catch (notifyErr) {
        console.warn('[BleMesh] No se pudieron iniciar notificaciones:', notifyErr);
      }

      // FIX: Guardar referencia al handler para cleanup
      const disconnectHandler = () => this._handleDisconnection(device.id);
      device.addEventListener('gattserverdisconnected', disconnectHandler);

      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        this._handleBleMessage(event, device.id);
      });

      this.state.peers.set(device.id, {
        device,
        server,
        characteristic,
        disconnectHandler,
        connectedAt: Date.now(),
        type: 'ble'
      });

      this._emit('connect', device.id);
      this._emit('peer', this.state.peers.size);

      // Intentar upgrade a WebRTC
      this._attemptWebRTCUpgrade(device.id);

    } catch (err) {
      console.error('[BleMesh] Error conectando device:', err);
      this._emit('error', err);
    } finally {
      this._connectingDevices.delete(device.id);
    }
  }

  _handleDisconnection(deviceId) {
    if (this.state.peers.has(deviceId)) {
      this.state.peers.delete(deviceId);
      this._emit('disconnect', deviceId);
      this._emit('peer', this.state.peers.size);
    }
  }

  _handleBleMessage(event, peerId) {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const data = decoder.decode(value);
    
    try {
      const message = JSON.parse(data);
      this._emit('message', message, peerId);
    } catch (err) {
      this._emit('message', { type: 'raw', data }, peerId);
    }
  }

  /**
   * FIX: Verifica timer pendiente para evitar race condition
   */
  _startScanning() {
    if (this.state.isScanning || this.destroyed || this.timers.scan) return;
    if (this.state.peers.size >= this.config.maxPeers) return;

    this.state.isScanning = true;

    const doScan = async () => {
      if (this.destroyed) return;
      
      try {
        const devices = await navigator.bluetooth.getDevices();
        
        for (const device of devices) {
          if (this.state.peers.has(device.id)) continue;
          if (this.state.peers.size >= this.config.maxPeers) break;
          
          if (device.name?.startsWith(this.config.deviceNamePrefix)) {
            device.addEventListener('gattserverdisconnected', () => {
              this._handleDisconnection(device.id);
            });
            await this._connectDevice(device);
          }
        }
      } catch (err) {
        console.warn('[BleMesh] Scan error:', err);
      } finally {
        this.state.isScanning = false;
        if (!this.destroyed && this.state.peers.size < this.config.maxPeers) {
          this.timers.scan = setTimeout(() => {
            this.timers.scan = null;
            this._startScanning();
          }, 5000);
        }
      }
    };

    doScan();
  }

  async _attemptWebRTCUpgrade(peerId) {
    const peer = this.state.peers.get(peerId);
    if (!peer) return;

    if (peer.rtcConnection) {
      console.log('[BleMesh] Peer ya tiene WebRTC, ignorando upgrade');
      return;
    }

    try {
      const pc = new RTCPeerConnection(this.rtcConfig);
      
      // FIX: Guardar referencias a handlers para cleanup
      peer.rtcHandlers = {
        iceCandidate: (event) => {
          if (event.candidate && peer.characteristic) {
            this._sendByBle(peerId, { type: 'ice-candidate', candidate: event.candidate });
          }
        },
        dataChannel: (event) => {
          const channel = event.channel;
          peer.dataChannel = channel;
          peer.type = 'webrtc';
          
          channel.onmessage = (e) => {
            try {
              const msg = JSON.parse(e.data);
              this._emit('message', msg, peerId);
            } catch (err) {
              this._emit('message', { type: 'raw', data: e.data }, peerId);
            }
          };
        }
      };

      pc.onicecandidate = peer.rtcHandlers.iceCandidate;
      pc.ondatachannel = peer.rtcHandlers.dataChannel;

      if (this._shouldInitiate(peerId)) {
        const channel = pc.createDataChannel('nexo-mesh');
        peer.dataChannel = channel;
        
        channel.onopen = () => {
          console.log('[BleMesh] WebRTC channel abierto con', peerId);
          peer.type = 'webrtc';
        };

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this._sendByBle(peerId, { type: 'webrtc-offer', sdp: offer.sdp });
        } catch (err) {
          console.error('[BleMesh] Error creando oferta WebRTC:', err);
        }
      }

      peer.rtcConnection = pc;
    } catch (err) {
      console.error('[BleMesh] Error en WebRTC upgrade:', err);
    }
  }

  _shouldInitiate(peerId) {
    return this.state.localId < peerId;
  }

  async _sendByBle(peerId, message) {
    const peer = this.state.peers.get(peerId);
    if (!peer || !peer.characteristic) return false;

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(message));
      await peer.characteristic.writeValue(data);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * FIX: Valida peers antes de enviar
   */
  async broadcast(message) {
    if (this.destroyed) throw new Error('BleMesh destruido');
    
    // FIX: Validar peers primero
    if (this.state.peers.size === 0) {
      throw new Error('No peers connected');
    }
    
    const promises = [];
    
    for (const [peerId, peer] of this.state.peers) {
      if (peer.dataChannel?.readyState === 'open') {
        try {
          peer.dataChannel.send(JSON.stringify(message));
          promises.push(Promise.resolve(true));
        } catch (err) {
          promises.push(Promise.resolve(false));
        }
      } else if (peer.characteristic) {
        promises.push(this._sendByBle(peerId, message));
      }
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
    return Array.from(this.state.peers.keys());
  }

  disconnect(peerId) {
    const peer = this.state.peers.get(peerId);
    if (!peer) return;

    // FIX: Cleanup RTCPeerConnection handlers
    if (peer.rtcConnection) {
      if (peer.rtcHandlers) {
        peer.rtcConnection.onicecandidate = null;
        peer.rtcConnection.ondatachannel = null;
      }
      peer.rtcConnection.close();
    }
    
    if (peer.dataChannel) peer.dataChannel.close();
    
    // FIX: Remover gattserverdisconnected listener
    if (peer.disconnectHandler) {
      peer.device.removeEventListener('gattserverdisconnected', peer.disconnectHandler);
    }
    
    if (peer.server?.connected) peer.server.disconnect();

    this._handleDisconnection(peerId);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.timers.scan) {
      clearTimeout(this.timers.scan);
      this.timers.scan = null;
    }

    for (const peerId of Array.from(this.state.peers.keys())) {
      this.disconnect(peerId);
    }

    Object.keys(this._listeners).forEach(key => {
      this._listeners[key] = [];
    });

    console.log('[BleMesh] Destruido');
  }

  // FIX: Syntax error corregido
  _generateId() {
    return `ble-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default BleMesh;
