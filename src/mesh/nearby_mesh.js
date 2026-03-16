/**
 * NEXO Nearby Mesh - Google Nearby Connections API
 * v1.0 - P2P sin internet
 */

export class NearbyMesh {
  constructor(options = {}) {
    this.config = {
      serviceId: options.serviceId || 'com.nexo.app.mesh',
      strategy: options.strategy || 'P2P_CLUSTER',
      ...options
    };
    this.state = {
      isInitialized: false,
      isScanning: false,
      peers: new Map(),
      endpointId: null
    };
    this.listeners = { device: [], connect: [], disconnect: [], message: [], error: [], scanning: [] };
    this.nearby = null;
  }

  on(event, handler) {
    this.listeners[event].push(handler);
    return this;
  }

  _emit(event, ...args) {
    this.listeners[event].forEach(h => {
      try { h(...args); } catch(e) {}
    });
  }

  async init() {
    if (typeof cordova === 'undefined' || !cordova.plugins || !cordova.plugins.nearby) {
      throw new Error('Nearby plugin no disponible');
    }
    
    this.nearby = cordova.plugins.nearby;
    this.state.endpointId = `nexo-${Math.random().toString(36).substr(2, 6)}`;
    
    this.nearby.onEndpointFound = (id, info) => {
      this._emit('device', { id, name: info.name || 'NEXO Device', rssi: -50 });
    };
    
    this.nearby.onEndpointLost = (id) => {};
    
    this.nearby.onConnectionInitiated = (id, info) => {
      this.nearby.acceptConnection(id);
    };
    
    this.nearby.onConnectionResult = (id, result) => {
      if (result.status === 'CONNECTED') {
        this.state.peers.set(id, { id, connectedAt: Date.now(), name: `Peer-${id.substr(0,4)}` });
        this._emit('connect', { id, name: `Peer-${id.substr(0,4)}` });
        this._emit('peer', this.state.peers.size);
      }
    };
    
    this.nearby.onDisconnected = (id) => {
      this.state.peers.delete(id);
      this._emit('disconnect', id);
      this._emit('peer', this.state.peers.size);
    };
    
    this.nearby.onReceive = (id, payload) => {
      try {
        const msg = JSON.parse(payload);
        this._emit('message', msg, id);
      } catch(e) {
        this._emit('message', { raw: payload }, id);
      }
    };

    this.state.isInitialized = true;
    this._emit('ready');
    return true;
  }

  async startScan() {
    if (!this.state.isInitialized) throw new Error('No inicializado');
    this.state.isScanning = true;
    this._emit('scanning', true);
    await this.nearby.startDiscovery(this.config.serviceId);
    await this.nearby.startAdvertising(this.state.endpointId, this.config.serviceId, { name: `NEXO-${this.state.endpointId.substr(0,4)}` });
  }

  async stopScan() {
    if (!this.state.isScanning) return;
    await this.nearby.stopDiscovery();
    await this.nearby.stopAdvertising();
    this.state.isScanning = false;
    this._emit('scanning', false);
  }

  async connect(endpointId) {
    if (this.state.peers.has(endpointId)) return;
    await this.nearby.requestConnection(this.state.endpointId, endpointId);
  }

  async send(endpointId, message) {
    if (!this.state.peers.has(endpointId)) return false;
    await this.nearby.sendPayload(endpointId, JSON.stringify(message));
    return true;
  }

  async broadcast(message) {
    if (this.state.peers.size === 0) return 0;
    let count = 0;
    for (const [id] of this.state.peers) {
      try { await this.send(id, message); count++; } catch(e) {}
    }
    return count;
  }

  getPeers() { return Array.from(this.state.peers.values()); }
  getPeerCount() { return this.state.peers.size; }
  getStatus() { return { initialized: this.state.isInitialized, scanning: this.state.isScanning, peerCount: this.state.peers.size }; }
  
  destroy() {
    this.stopScan();
    for (const [id] of this.state.peers) {
      try { this.nearby.disconnect(id); } catch(e) {}
    }
  }
}

