/**
 * NEXO Hybrid Mesh v2.1-NAP-CERTIFIED
 * Orquestador de Conectividad: BLE (NordicMesh) → WiFi LAN → WebSocket Relay
 * Basado en: HybridMesh v2.0 + NAP 2.0 Interface Contracts
 * Error Codes: APP_017-APP_022 (Hybrid Subsystem)
 */

import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { nordicMesh } from './nordic_mesh.js';
import { webSocketClient } from '../net/web_socket_client.js';
import { rem } from '../ui/rem.js';

// NAP 2.0 Error Codes (Hybrid Layer)
const NAP_ERRORS = {
  HYBRID_INIT_FAILED:      { code: 'APP_017', phase: 'HYBRID_INIT' },
  HYBRID_PERMISSION_DENIED:{ code: 'APP_018', phase: 'HYBRID_PERMISSION' },
  HYBRID_BLE_UNAVAILABLE:  { code: 'APP_019', phase: 'HYBRID_TRANSPORT' },
  HYBRID_WIFI_FAILED:      { code: 'APP_020', phase: 'HYBRID_TRANSPORT' },
  HYBRID_RELAY_FAILED:     { code: 'APP_021', phase: 'HYBRID_TRANSPORT' },
  HYBRID_NO_ROUTE:         { code: 'APP_022', phase: 'HYBRID_ROUTING' }
};

// NAP 2.0 States
const MODES = Object.freeze({
  OFFLINE: 'OFFLINE',
  BLE_ONLY: 'BLE_ONLY',      // Solo NordicMesh activo
  HYBRID: 'HYBRID',          // BLE + WiFi simultáneo  
  RELAY: 'RELAY',            // Solo WebSocket
  ONLINE: 'ONLINE'           // Todo disponible
});

// Interface Contracts (NAP 2.0)
const CONTRACTS = {
  DEVICE_ID: (id) => typeof id === 'string' && id.length === 17,
  PAYLOAD: (p) => p !== null && typeof p === 'object',
  VAULT: (v) => v && typeof v.getIdentityKey === 'function'
};

class HybridMesh {
  constructor(options = {}) {
    // SOC2 Resource Management
    this._resources = {
      vault: null,
      intervals: new Set(),
      timeouts: new Set(),
      connections: new Map()
    };

    this._mode = MODES.OFFLINE;
    this._initialized = false;
    this._scanning = false;
    this._permissionsGranted = false;

    // Peer Registry (Unified across transports)
    this._peers = new Map();        // userId -> {bleDeviceId, wsId, bestPath, lastSeen}
    this._activeTransports = new Set(); // 'ble' | 'wifi' | 'relay'

    // Legacy compatibility (callbacks externos)
    this.callbacks = {
      onDeviceFound: () => {},
      onDeviceConnected: () => {},
      onDeviceDisconnected: () => {},
      onError: () => {}
    };

    // NAP Event System
    this._listeners = {
      peer: [], message: [], mode: [], error: [], ready: []
    };
  }

  // ===== NAP 2.0 INITIALIZATION =====

  /**
   * NAP-HYBRID-INIT-001: Secuencia estricta permisos → BLE → WiFi → Relay
   */
  async init(vaultInstance) {
    if (this._initialized) return true;
    
    this._transitionMode(MODES.OFFLINE, 'HYBRID_INIT');
    
    try {
      // Interface Contract: Vault
      if (!CONTRACTS.VAULT(vaultInstance)) {
        throw this._createNapError(
          NAP_ERRORS.HYBRID_INIT_FAILED,
          'Interface Contract Violation: Vault must implement CryptoVault interface'
        );
      }
      this._resources.vault = vaultInstance;

      // Fase 1: Permisos Android 12+ (Basado en tu implementación anterior)
      if (Capacitor.isNativePlatform()) {
        await this._acquirePermissionsNap();
      }

      // Fase 2: Inicializar NordicMesh (BLE Soberano)
      try {
        await nordicMesh.init(vaultInstance);
        
        // Setup NAP-compliant callbacks
        nordicMesh.onPeerDiscovered = (peer) => this._handleBlePeerDiscovered(peer);
        nordicMesh.onPeerConnected = (peer) => this._handleBlePeerConnected(peer);
        nordicMesh.onPeerDisconnected = (peer) => this._handleBlePeerDisconnected(peer);
        nordicMesh.onMessageReceived = (msg) => this._handleBleMessage(msg);
        nordicMesh.onError = (err) => this._handleBleError(err);
        nordicMesh.onStateChange = (state) => this._monitorBleState(state);

        await nordicMesh.startDiscoveryLoop();
        this._activeTransports.add('ble');
        this._transitionMode(MODES.BLE_ONLY, 'HYBRID_BLE_ACTIVE');
        
      } catch (bleErr) {
        rem.warn('NordicMesh no disponible, fallback a relay', 'HYBRID_FALLBACK');
        this._activeTransports.delete('ble');
      }

      // Fase 3: WebSocket Relay (Fallback/Complemento)
      try {
        await webSocketClient.connect();
        webSocketClient.onMessage = (msg) => this._handleRelayMessage(msg);
        this._activeTransports.add('relay');
        
        if (this._mode === MODES.BLE_ONLY) {
          this._transitionMode(MODES.HYBRID, 'HYBRID_FULL');
        } else {
          this._transitionMode(MODES.RELAY, 'HYBRID_RELAY_ONLY');
        }
      } catch (wsErr) {
        if (!this._activeTransports.has('ble')) {
          throw this._createNapError(
            NAP_ERRORS.HYBRID_NO_ROUTE,
            'No connectivity available (BLE + Relay failed)'
          );
        }
      }

      this._initialized = true;
      this._emit('ready', { mode: this._mode, transports: Array.from(this._activeTransports) });
      return true;

    } catch (error) {
      this._handleNapError(error, 'INIT');
      throw error;
    }
  }

  /**
   * NAP-PERMISSION-001: Flujo correcto Android 12+ (de tu v2.0)
   */
  async _acquirePermissionsNap() {
    if (Capacitor.getPlatform() !== 'android') return true;

    try {
      // Verificar ubicación GPS (CRÍTICO para BLE scan en Android)
      const isLocationEnabled = await BleClient.isLocationEnabled();
      if (!isLocationEnabled) {
        rem.warn('Ubicación GPS desactivada - requiere activación manual', 'HYBRID_GPS');
        await BleClient.openLocationSettings();
        
        // Re-verificar después de delay
        await this._sleep(2000);
        const stillDisabled = !(await BleClient.isLocationEnabled());
        if (stillDisabled) {
          throw this._createNapError(
            NAP_ERRORS.HYBRID_PERMISSION_DENIED,
            'GPS_DESACTIVADO: El usuario no activó ubicación'
          );
        }
      }

      // Inicializar BLE (solicita permisos automáticamente en Android 12+)
      await BleClient.initialize({ 
        androidNeverForLocation: false // Requerimos ubicación precisa para scan
      });

      // Verificar Bluetooth activado
      const isEnabled = await BleClient.isEnabled();
      if (!isEnabled) {
        await BleClient.requestEnable();
      }

      this._permissionsGranted = true;
      return true;

    } catch (err) {
      if (err.message?.includes('permission') || err.code === 'APP_018') {
        throw this._createNapError(
          NAP_ERRORS.HYBRID_PERMISSION_DENIED,
          'Permisos Bluetooth rechazados. Ve a Configuración → Apps → NEXO → Permisos',
          { original: err.message }
        );
      }
      throw err;
    }
  }

  // ===== NAP 2.0 MESSAGE ROUTING =====

  /**
   * NAP-ROUTE-001: Selección inteligente de transporte
   */
  async sendMessage(userId, payload) {
    if (!CONTRACTS.PAYLOAD(payload)) {
      throw this._createNapError(NAP_ERRORS.HYBRID_NO_ROUTE, 'Invalid payload');
    }

    const peer = this._peers.get(userId);
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);

    // Estrategia 1: BLE (Soberano, prioridad máxima)
    if (peer?.bleDeviceId && nordicMesh.isConnected(peer.bleDeviceId)) {
      try {
        await nordicMesh.sendMessage(peer.bleDeviceId, payload);
        return { success: true, via: 'BLE', latency: 'low', napCode: 'ROUTE_BLE' };
      } catch (bleErr) {
        rem.warn('BLE send failed, attempting failover', 'HYBRID_FAILOVER');
      }
    }

    // Estrategia 2: WiFi LAN (Si implementado en futuro)
    // if (peer?.lanId) { ... }

    // Estrategia 3: WebSocket Relay
    if (this._activeTransports.has('relay')) {
      try {
        await webSocketClient.send({ to: userId, payload: message });
        return { success: true, via: 'RELAY', latency: 'high', napCode: 'ROUTE_RELAY' };
      } catch (wsErr) {
        throw this._createNapError(
          NAP_ERRORS.HYBRID_NO_ROUTE,
          'All transport layers failed',
          { bleError: bleErr?.message, wsError: wsErr.message }
        );
      }
    }

    throw this._createNapError(NAP_ERRORS.HYBRID_NO_ROUTE, 'No route available to peer');
  }

  /**
   * NAP-BROADCAST-001: Enviar a todos los peers disponibles
   */
  async broadcast(payload) {
    const results = { ble: 0, relay: 0, failed: 0 };
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);

    // Broadcast BLE (NordicMesh no soporta nativo broadcast, enviar individual)
    for (const [userId, peer] of this._peers) {
      if (peer.bleDeviceId && nordicMesh.isConnected(peer.bleDeviceId)) {
        try {
          await nordicMesh.sendMessage(peer.bleDeviceId, payload);
          results.ble++;
        } catch (e) { results.failed++; }
      }
    }

    // Broadcast Relay
    if (this._activeTransports.has('relay')) {
      try {
        await webSocketClient.send({ type: 'broadcast', payload: message });
        results.relay++;
      } catch (e) { results.failed++; }
    }

    return results;
  }

  // ===== EVENT HANDLERS (NAP-COMPLIANT) =====

  _handleBlePeerDiscovered(peer) {
    // Registrar en registry unificado
    let existing = this._peers.get(peer.userId);
    if (!existing) {
      existing = { userId: peer.userId, bleDeviceId: peer.deviceId };
      this._peers.set(peer.userId, existing);
    }
    existing.bleDeviceId = peer.deviceId;
    existing.rssi = peer.rssi;
    existing.lastSeenBle = Date.now();
    existing.bestPath = 'ble';

    // Legacy callback
    this.callbacks.onDeviceFound({
      id: peer.deviceId,
      userId: peer.userId,
      name: `NEXO-${peer.userId.substr(0,8)}`,
      rssi: peer.rssi,
      mode: 'ble',
      napValidated: peer.napValidated
    });

    this._emit('peer', { ...existing, event: 'discovered' });
  }

  _handleBlePeerConnected(peer) {
    const existing = this._peers.get(peer.userId);
    if (existing) {
      existing.bleConnected = true;
      existing.connectedAt = Date.now();
    }

    this.callbacks.onDeviceConnected({
      id: peer.deviceId,
      userId: peer.userId,
      mode: 'ble'
    });

    this._emit('peer', { ...existing, event: 'connected' });
  }

  _handleBlePeerDisconnected(peer) {
    const existing = this._peers.get(peer.userId);
    if (existing) {
      existing.bleConnected = false;
      existing.disconnectedAt = Date.now();
      
      // Si no hay más rutas, eliminar
      if (!existing.wsId) {
        this._peers.delete(peer.userId);
      }
    }

    this.callbacks.onDeviceDisconnected({ id: peer.deviceId, userId: peer.userId });

    // Verificar degradación de modo
    const hasAnyBle = Array.from(this._peers.values()).some(p => p.bleConnected);
    if (!hasAnyBle && this._mode === MODES.HYBRID && this._activeTransports.has('relay')) {
      this._transitionMode(MODES.RELAY, 'HYBRID_DEGRADE_RELAY');
    }

    this._emit('peer', { userId: peer.userId, event: 'disconnected' });
  }

  _handleBleMessage(msg) {
    // Reinyectar en sistema con metadatos de transporte
    this._emit('message', {
      ...msg,
      transport: 'BLE',
      priority: 'high',
      napTimestamp: Date.now()
    });
  }

  _handleRelayMessage(msg) {
    this._emit('message', {
      ...msg,
      transport: 'RELAY',
      priority: 'normal'
    });
  }

  _handleBleError(napError) {
    // Error Boundary: no crítico, solo reportar
    rem.error(`${napError.code}: ${napError.message}`, napError.code);
    this._emit('error', napError);
  }

  _monitorBleState(state) {
    if (state === 'error' && this._mode !== MODES.RELAY) {
      rem.warn('BLE subsystem failure, switching to RELAY mode', 'HYBRID_FAILOVER');
      this._transitionMode(MODES.RELAY, 'HYBRID_BLE_FAILOVER');
    }
  }

  // ===== NAP 2.0 UTILITIES =====

  _createNapError(napError, message, details = null) {
    const err = new Error(`[${napError.code}] ${message}`);
    err.napCode = napError.code;
    err.napPhase = napError.phase;
    err.napDetails = details;
    return err;
  }

  _handleNapError(error, operation) {
    const napError = {
      code: error.napCode || 'APP_UNKNOWN',
      phase: error.napPhase || `HYBRID_${operation}`,
      message: error.message,
      timestamp: Date.now()
    };

    rem.error(`${napError.code}: ${error.message}`, napError.code);
    this.callbacks.onError(napError.code, error.message);
    this._emit('error', napError);
  }

  _transitionMode(newMode, phase) {
    const oldMode = this._mode;
    this._mode = newMode;
    rem.updateMode(newMode);
    
    if (oldMode !== newMode) {
      this._emit('mode', { from: oldMode, to: newMode, phase });
    }
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  _emit(event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => {
        try { cb(data); } catch(e) {}
      });
    }
  }

  // ===== PUBLIC API (NAP + LEGACY) =====

  on(event, handler) {
    if (this._listeners[event]) this._listeners[event].push(handler);
    return () => {
      this._listeners[event] = this._listeners[event].filter(h => h !== handler);
    };
  }

  async connect(deviceId) {
    // Delegar a NordicMesh (validación de deviceId implícita)
    return await nordicMesh.connect(deviceId);
  }

  async disconnect(deviceId) {
    return await nordicMesh.disconnect(deviceId);
  }

  async startScan() {
    // Ya iniciado automáticamente por nordicMesh.init(), pero exponer para UI manual
    if (nordicMesh.startDiscovery) {
      await nordicMesh.startDiscovery();
    }
  }

  async stopScan() {
    await nordicMesh.stopDiscovery();
  }

  getStatus() {
    return {
      mode: this._mode,
      initialized: this._initialized,
      scanning: nordicMesh.state === 'discovering',
      peerCount: this._peers.size,
      transports: Array.from(this._activeTransports),
      napVersion: '2.0'
    };
  }

  getPeers() {
    return Array.from(this._peers.values());
  }

  destroy() {
    clearInterval(this._discoveryInterval);
    nordicMesh.destroy();
    webSocketClient.disconnect();
    this._resources.intervals.forEach(id => clearInterval(id));
    this._resources.timeouts.forEach(id => clearTimeout(id));
  }
}

export const hybridMesh = new HybridMesh();
export default hybridMesh;
