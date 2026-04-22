/**
 * NEXO App v3.4.1-ROLE-SYNC
 * Orquestador Principal - NAP 2.0 Certified
 * FIXES: 
 * - CryptoVault.init() (no initialize())
 * - HybridMesh.on() defensive check
 * - Interface Contract NordicMesh
 * + INTEGRATION v3.3.2: BLE Chat directo (activeContact + _sendViaBLE)
 * + FIX v3.3.3: _sendViaBLE siempre fuerza conexión cliente para evitar falso positivo servidor.
 * + RESEARCH v3.3.4: 600ms pause + gatt.close() on failure + WRITE_TYPE_DEFAULT + REM focused
 * + DUAL-ROLE v3.3.5: Listener nexo:ble:messageReceived para mensajes entrantes BLE nativos
 * + DUAL-ROLE v3.3.5: Integración bidireccional confirmada (cliente write + servidor notify)
 * + FINAL v3.4.0: Listeners nativos directos (onPayloadReceived, onDeviceDisconnected, onBluetoothStackBroken)
 * + FINAL v3.4.0: sendMessage prioriza BLE activo, maneja onServicesReady/onNotificationsEnabled
 * + ROLE-SYNC v3.4.1: Manejo de roles server/client en _sendViaBLE. Servidor no intenta conectar GATT client.
 * + ROLE-SYNC v3.4.1: Listener onDeviceConnected en NexoApp para trackear peers entrantes.
 */

import { GestureEngine as CoreGestureEngine } from '../core/gesture_engine.js';
import { CryptoVault } from '../vault/crypto_vault.js';
import { BLEInterface as HybridMesh } from '../mesh/hybrid_mesh.js';
import { NordicMesh } from '../mesh/nordic_mesh.js';
import { WebSocketClient } from '../net/web_socket_client.js';
import { MeshRelayBridge } from '../net/mesh_relay_bridge.js';
import { GestureEngine } from '../ui/gesture_engine.js';
import { TheStream } from '../stream/the_stream.js';
import { rem } from '../ui/rem.js';
import { initBLEInterface } from '../ui/ble_interface.js';

function withTimeoutNAP(promise, ms, context) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[NAP_TIMEOUT] ${context} exceeded ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const DEBUG = {
  rem: rem,
  _logBuffer: [],
  log: (msg, type = 'info', code = null) => {
    const entry = { ts: Date.now(), time: new Date().toLocaleTimeString(), type, code, msg };
    DEBUG._logBuffer.push(entry);
    if (DEBUG._logBuffer.length > 1000) DEBUG._logBuffer.shift();
    console.log(`[${entry.time}] [${type.toUpperCase()}]${code ? `[${code}]` : ''} ${msg}`);
    const method = type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warn' ? 'warn' : 'info';
    if (code) rem[method](msg, code);
    else rem[method](msg);
  },
  error: (code, msg) => DEBUG.log(msg, 'error', code),
  success: (msg, code = null) => DEBUG.log(msg, 'success', code),
  warn: (msg, code = null) => DEBUG.log(msg, 'warn', code),
  setPhase: (p) => rem.updatePhase(p),
  setMode: (m) => rem.updateMode(m),
  setIdentity: (id) => id && rem.updateIdentity(id)
};

export class NexoApp {
  constructor(config = {}) {
    if (config && typeof config !== 'object') {
      throw new Error('[APP_017] Config must be object');
    }
    this.config = {
      relayUrls: Array.isArray(config.relayUrls) ? config.relayUrls : [],
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      onMessage: typeof config.onMessage === 'function' ? config.onMessage : () => {},
      onStatusChange: typeof config.onStatusChange === 'function' ? config.onStatusChange : () => {},
      onError: typeof config.onError === 'function' ? config.onError : (e) => console.error(e),
      ...config
    };
    this._resources = { timers: new Set(), listeners: new Set(), handlers: new Set() };
    this._isInitializing = false;
    this._isDestroyed = false;
    this.vault = null;
    this.mesh = null;
    this.nordicMesh = null;
    this.blePeers = new Map();
    this.wsClient = null;
    this.bridge = null;
    this.gestures = null;
    this.stream = null;
    this.vaultSlider = null;
    this.bleInterface = null;
    this.initialized = false;
    this.activeContact = null;
    this._bleChatHandler = null;
    this._bleMessageHandler = null;
    // ─── v3.4.0: Referencias a listeners nativos directos ───
    this._nativePayloadListener = null;
    this._nativeDeviceConnectedListener = null; // v3.4.1
    this._nativeDeviceDisconnectedListener = null;
    this._nativeStackBrokenListener = null;
    this._nativeNotificationsListener = null;
    DEBUG.log('🚀 [NEXO] v3.4.1-ROLE-SYNC iniciando...', 'info', 'APP_INIT');
  }

  async init() {
    if (this.initialized) {
      DEBUG.warn('Init called but already initialized', 'APP_SKIP');
      return this;
    }
    if (this._isInitializing) throw new Error('[APP_018] Initialization already in progress');
    if (this._isDestroyed) throw new Error('[APP_019] Cannot init destroyed instance');
    this._isInitializing = true;
    DEBUG.setPhase('INIT');
    try {
      await this._initPhase1_Crypto();
      await this._initPhase2_WebSocket();
      if (this.config.enableMesh) await this._initPhase3_NordicMesh();
      if (this.config.enableMesh) await this._initPhase4_HybridMesh();
      await this._initPhase5_BLEUI();
      await this._initPhase6_Bridge();
      await this._initPhase7_UI();
      this.initialized = true;
      DEBUG.setPhase('READY');
      DEBUG.success('🎉 NEXO v3.4.1-ROLE-SYNC Ready', 'APP_READY');
      this._logFinalStatus();
    } catch (err) {
      DEBUG.error('APP_020', `Init failed: ${err.message}`);
      await this._partialCleanup();
      throw err;
    } finally {
      this._isInitializing = false;
    }
    return this;
  }

  async _initPhase1_Crypto() {
    DEBUG.setPhase('CRYPTO');
    DEBUG.log('🔐 [1/7] Initializing Crypto Vault...', 'info', 'CRYPTO_001');
    try {
      this.vault = new CryptoVault();
      await withTimeoutNAP(this.vault.init(), 5000, 'CryptoVault.init');
      const identity = this.vault.getIdentity?.();
      if (identity) {
        DEBUG.setIdentity(identity);
        DEBUG.success('Vault initialized', 'CRYPTO_002');
      }
    } catch (err) {
      DEBUG.error('CRYPTO_004', `Vault init failed: ${err.message}`);
      this.vault = null;
    }
  }

  async _initPhase2_WebSocket() {
    DEBUG.setPhase('WEBSOCKET');
    if (this.config.relayUrls.length === 0) {
      DEBUG.warn('No relay URLs configured', 'WS_SKIP');
      return;
    }
    try {
      this.wsClient = new WebSocketClient(this.config.relayUrls[0]);
      this.wsClient.onMessage = (m) => this._handleMessage(m, 'relay');
      this.wsClient.onOpen = () => { DEBUG.setMode('RELAY'); };
      await withTimeoutNAP(this.wsClient.connect(), 8000, 'WebSocket.connect');
    } catch (err) {
      DEBUG.warn(`WebSocket unavailable: ${err.message}`, 'WS_004');
      this.wsClient = null;
    }
  }

  async _initPhase3_NordicMesh() {
    DEBUG.setPhase('NORDIC_MESH');
    DEBUG.log('📡 [3/7] Initializing Nordic Mesh BLE...', 'info', 'NORDIC_001');
    try {
      if (!this.vault) throw new Error('Vault required for Nordic Mesh');
      this.nordicMesh = new NordicMesh(this.vault, {
        rssiThreshold: -85,
        chunkSize: 507,
        handshakeTimeout: 30000
      });
      const unsub1 = this.nordicMesh.on('peerDiscovered', (p) => this._handleNordicPeer(p));
      const unsub2 = this.nordicMesh.on('sessionEstablished', (d) => this._handleNordicSession(d));
      const unsub3 = this.nordicMesh.on('messageReceived', (m) => this._handleNordicMessage(m));
      const unsub4 = this.nordicMesh.on('stateChanged', ({ to }) => this._updateModeFromNordic(to));
      const unsub5 = this.nordicMesh.on('error', (err) => DEBUG.error('NORDIC_010', err.message));
      this._resources.handlers.add(unsub1, unsub2, unsub3, unsub4, unsub5);
      const result = await withTimeoutNAP(this.nordicMesh.init(), 10000, 'NordicMesh.init');
      if (!result.success) {
        throw new Error(result.error?.message || 'Nordic init returned false');
      }
      DEBUG.success(`Nordic Mesh active [Native:${result.isNative}]`, 'NORDIC_002');
      if (!this.wsClient?.isConnected?.()) {
        await this.nordicMesh.startDiscovery().catch(e => {
          DEBUG.warn(`Discovery delayed: ${e.message}`, 'NORDIC_003');
        });
      }
    } catch (err) {
      DEBUG.error('NORDIC_005', `Nordic init failed: ${err.message}`);
      this.nordicMesh = null;
    }
  }

  async _initPhase4_HybridMesh() {
    DEBUG.setPhase('MESH');
    DEBUG.log('📡 [4/7] Initializing Hybrid Mesh...', 'info', 'MESH_001');
    try {
      this.mesh = new HybridMesh({
        onDeviceFound: (d) => {
          DEBUG.log(`Hybrid found: ${d.name}`, 'info', 'MESH_DEVICE');
          this._updateStatus();
        },
        onDeviceConnected: (d) => {
          DEBUG.success(`Hybrid connected: ${d.name}`, 'MESH_CONN');
          this._updateStatus();
        },
        onDeviceDisconnected: (d) => {
          DEBUG.log(`Hybrid disconnected`, 'warn', 'MESH_DISC');
          this._updateStatus();
        },
        onError: (code, msg) => DEBUG.error('MESH_006', msg)
      });
      if (typeof this.mesh.on === 'function') {
        const unsub = this.mesh.on('device', () => this._updateStatus());
        this._resources.handlers.add(unsub);
      } else {
        DEBUG.warn('HybridMesh no implementa .on(), usando callbacks directos', 'MESH_WARN');
      }
      await withTimeoutNAP(this.mesh.initialize(), 15000, 'HybridMesh.initialize');
      DEBUG.success('Hybrid Mesh ready', 'MESH_002');
    } catch (err) {
      DEBUG.error('APP_016', `Hybrid Mesh: ${err.message}`);
      this.mesh = null;
    }
  }

  async _initPhase5_BLEUI() {
    DEBUG.setPhase('BLE_UI');
    DEBUG.log('📱 [5/7] Initializing BLE Interface...', 'info', 'UI_001');
    try {
      const meshInstance = this.nordicMesh || this.mesh || null;
      this.bleInterface = initBLEInterface(meshInstance);
      if (this.bleInterface) {
        DEBUG.success('BLE UI ready' + (meshInstance ? '' : ' (dummy)'), 'UI_002');
      }
      
      // Handler para abrir chat desde BLE Interface
      this._bleChatHandler = (e) => {
        const { contactId, name, address, transport, role } = e.detail;
        this.activeContact = { id: contactId, name, address, transport, role };
        const appContainer = document.getElementById('app');
        if (appContainer) appContainer.classList.remove('hidden');
        const nameInput = document.getElementById('chat-contact-name');
        const subtitle = document.getElementById('chat-contact-subtitle');
        if (nameInput) nameInput.value = name || 'NEXO Device';
        if (subtitle) subtitle.textContent = transport === 'ble' ? 'BLUETOOTH' : 'NEXO MESH';
        DEBUG.success(`💬 Chat activo: ${name} [${transport.toUpperCase()}]${role ? ` [${role.toUpperCase()}]` : ''}`, 'BLE_CHAT');
        this.config.onStatusChange(`CHAT:${name}`);
      };
      window.addEventListener('nexo:ble:openChat', this._bleChatHandler);
      
      // ─── v3.4.1: Listeners nativos DIRECTOS desde el plugin ───
      const plugin = this.bleInterface?.nativePlugin;
      if (plugin) {
        // onPayloadReceived: mensajes entrantes BLE
        this._nativePayloadListener = plugin.addListener('onPayloadReceived', (data) => {
          DEBUG.log(`📨 BLE mensaje entrante de ${data.deviceId?.substr(0,8)}: ${data.data?.substr(0,30)}...`, 'info', 'BLE_RECV');
          this._handleMessage({
            content: data.data,
            sender: data.deviceId,
            source: 'ble_direct',
            timestamp: data.timestamp || Date.now(),
            _own: false
          }, 'ble_direct');
        });
        
        // v3.4.1: onDeviceConnected: peer conectado (entrante o saliente)
        this._nativeDeviceConnectedListener = plugin.addListener('onDeviceConnected', (data) => {
          DEBUG.log(`🔌 BLE conectado: ${data.deviceId?.substr(0,8)} [${data.direction}]`, 'info', 'BLE_CONN_OK');
          if (data.direction === 'incoming' && this.activeContact && this.activeContact.id === data.deviceId) {
            DEBUG.success(`Peer conectado al servidor. Canal listo.`, 'BLE_PEER_IN');
          }
        });
        
        // onDeviceDisconnected: limpiar peer activo
        this._nativeDeviceDisconnectedListener = plugin.addListener('onDeviceDisconnected', (data) => {
          DEBUG.log(`🔌 BLE desconectado: ${data.deviceId?.substr(0,8)}`, 'warn', 'BLE_DISC');
          if (this.activeContact && this.activeContact.id === data.deviceId) {
            this.activeContact = null;
            DEBUG.log('Chat activo limpiado por desconexión BLE', 'info', 'BLE_CHAT_CLEAR');
          }
        });
        
        // onBluetoothStackBroken: Android 14 bug
        this._nativeStackBrokenListener = plugin.addListener('onBluetoothStackBroken', (data) => {
          DEBUG.error('BLE_STACK_BROKEN', `Stack Bluetooth corrupto detectado. ${data.suggestion}`);
          // Emitir evento para UI
          const event = new CustomEvent('nexo:ble:stackBroken', { detail: data });
          window.dispatchEvent(event);
        });
        
        // onNotificationsEnabled: confirmar canal bidireccional
        this._nativeNotificationsListener = plugin.addListener('onNotificationsEnabled', (data) => {
          DEBUG.log(`🔔 Notificaciones BLE activadas para ${data.deviceId?.substr(0,8)}`, 'info', 'BLE_NOTIFY_OK');
        });
        
        DEBUG.log('Listeners nativos DIRECTOS registrados en NexoApp', 'info', 'BLE_LISTENER_OK');
      }
      
    } catch (err) {
      DEBUG.error('UI_004', `BLE UI init failed: ${err.message}`);
      this.bleInterface = null;
    }
  }

  async _initPhase6_Bridge() {
    DEBUG.setPhase('BRIDGE');
    try {
      if (!this.mesh && !this.nordicMesh && !this.wsClient) {
        DEBUG.warn('No transports available', 'BRIDGE_SKIP');
        return;
      }
      this.bridge = new MeshRelayBridge({
        mesh: this.mesh,
        nordicMesh: this.nordicMesh,
        relay: this.wsClient,
        onModeChange: (mode) => {
          DEBUG.setMode(mode);
          this.config.onStatusChange(mode);
        }
      });
      await withTimeoutNAP(this.bridge.initialize(), 5000, 'Bridge.initialize');
      DEBUG.success('Bridge ready', 'BRIDGE_002');
    } catch (err) {
      DEBUG.warn(`Bridge init failed: ${err.message}`, 'BRIDGE_003');
      this.bridge = null;
    }
  }

  async _initPhase7_UI() {
    DEBUG.setPhase('GESTURES');
    if (this.config.enableGestures) {
      try {
        this.gestures = new GestureEngine({});
        this.gestures.init();
      } catch (e) {}
    }
    DEBUG.setPhase('VAULT_SLIDER');
    const streamEl = document.getElementById('nexo-stream');
    const vaultEl = document.getElementById('nexo-vault');
    if (streamEl && vaultEl) {
      try {
        this.vaultSlider = new CoreGestureEngine(streamEl, vaultEl);
      } catch (e) {
        DEBUG.error('UX_003', `Vault Slider: ${e.message}`);
      }
    }
    DEBUG.setPhase('STREAM');
    const container = document.getElementById('messages-container');
    if (container) {
      try {
        this.stream = new TheStream(container, {});
      } catch (e) {
        DEBUG.error('UX_004', `TheStream: ${e.message}`);
      }
    }
  }

  _handleNordicPeer(peer) {
    if (!peer?.id) {
      DEBUG.error('NORDIC_006', 'Invalid peer data');
      return;
    }
    DEBUG.log(`🔷 Nordic Peer: ${peer.name} (${peer.rssi}dBm)`, 'info', 'NORDIC_PEER');
    this.blePeers.set(peer.id, { ...peer, discoveredAt: Date.now() });
    if (this.bleInterface?.addPeer) this.bleInterface.addPeer(peer);
  }

  _handleNordicSession(data) {
    if (!data?.deviceId) {
      DEBUG.error('NORDIC_007', 'Invalid session data');
      return;
    }
    DEBUG.success(`🔐 Nordic Session: ${data.deviceId.substr(0,8)}`, 'NORDIC_SESS');
    this._updateMode('P2P_BLE');
  }

  _handleNordicMessage(msg) {
    if (!msg?.deviceId) {
      DEBUG.error('NORDIC_008', 'Invalid message structure');
      return;
    }
    this._handleMessage({
      content: msg.content,
      sender: msg.deviceId,
      source: 'ble_nordic',
      timestamp: msg.timestamp || Date.now()
    }, 'ble_nordic');
  }

  _updateModeFromNordic(state) {
    switch(state) {
      case 'messaging':
      case 'connected': this._updateMode('P2P_BLE'); break;
      case 'offline': 
        if (!this.mesh?.getPeerCount?.() && !this.wsClient?.isConnected?.()) {
          this._updateMode('OFFLINE');
        }
        break;
    }
  }

  _updateMode(mode) {
    DEBUG.setMode(mode);
    this.config.onStatusChange(mode);
    if (this.bleInterface?.updateStatus) {
      try { this.bleInterface.updateStatus(); } catch (e) {}
    }
  }

  _updateStatus() {}

  // [v3.4.1] _sendViaBLE: conexión + envío con manejo de dirección dual y roles
  async _sendViaBLE(deviceId, content, attempt = 0) {
    const plugin = this.bleInterface?.nativePlugin;
    if (!plugin) throw new Error('Plugin NexoBLE no disponible');
    
    DEBUG.log(`[BLE_SEND] Preparando envío a ${deviceId.substr(0,8)}... (attempt ${attempt + 1})`, 'info', 'BLE_PREPARE');
    
    // v3.4.1: Verificar si ya hay conexión activa antes de intentar conectar
    try {
      const connectedResult = await plugin.getConnectedDevices();
      const alreadyConnected = connectedResult?.devices?.some(d => d.deviceId === deviceId);
      if (alreadyConnected) {
        DEBUG.log(`[BLE_SEND] Dispositivo ya conectado, enviando directamente...`, 'info', 'BLE_ALREADY_CONN');
        await plugin.sendMessage({ deviceId, message: content });
        DEBUG.success(`📨 Enviado vía BLE a ${deviceId.substr(0,8)}`, 'MSG_BLE');
        return;
      }
    } catch (e) {
      DEBUG.log(`[BLE_SEND] getConnectedDevices check failed: ${e.message}`, 'warn', 'BLE_CONN_CHECK');
    }
    
    // Si no conectado, intentar conectar y determinar rol
    try {
      const connResult = await plugin.connectToDevice({ deviceId });
      DEBUG.log(`[BLE_SEND] connectToDevice result: ${JSON.stringify(connResult)}`, 'info', 'BLE_CONN_RESULT');
      
      // v3.4.1: Manejo de rol server/client
      if (connResult && connResult.role === 'server') {
        DEBUG.log(`[BLE_SEND] Rol SERVIDOR detectado para ${deviceId}. No se inicia GATT client.`, 'info', 'BLE_SERVER_ROLE');
        // Guardar rol en bleInterface para referencia
        if (this.bleInterface && this.bleInterface._deviceRoles) {
          this.bleInterface._deviceRoles.set(deviceId, 'server');
        }
        throw new Error('BLE_011: Modo Servidor - Esperando que el peer cliente se conecte a este dispositivo.');
      }
      
      if (connResult && connResult.role === 'client') {
        if (this.bleInterface && this.bleInterface._deviceRoles) {
          this.bleInterface._deviceRoles.set(deviceId, 'client');
        }
      }
      
      // Pequeña pausa para estabilizar la conexión GATT antes de write
      await new Promise(r => setTimeout(r, 300));
      
    } catch (e) {
      DEBUG.log(`[BLE_SEND] connectToDevice falló: ${e.message}`, 'warn', 'BLE_CONN_FAIL');
      // No reintentar si es error de rol servidor (es un estado esperado, no un fallo de conexión)
      if (e.message.includes('BLE_011')) {
        throw e;
      }
      if (attempt === 0) {
        DEBUG.log(`[BLE_SEND] Pausa 600ms antes de reintento...`, 'info', 'BLE_PAUSE');
        await new Promise(r => setTimeout(r, 600));
        return this._sendViaBLE(deviceId, content, 1);
      }
      throw e;
    }
    
    try {
      await plugin.sendMessage({ deviceId, message: content });
      DEBUG.success(`📨 Enviado vía BLE a ${deviceId.substr(0,8)}`, 'MSG_BLE');
    } catch (e) {
      DEBUG.log(`[BLE_SEND] sendMessage falló: ${e.message}`, 'warn', 'BLE_SEND_FAIL');
      throw e;
    }
  }

  async sendMessage(msg) {
    if (!this.initialized || this._isDestroyed) {
      DEBUG.error(this._isDestroyed ? 'APP_022' : 'APP_021', 'Cannot send message');
      return false;
    }
    try {
      this._handleMessage({ ...msg, _own: true, timestamp: Date.now(), pending: true }, 'self');
      const isObject = msg && typeof msg === 'object';
      const content = isObject ? (msg.content || msg) : msg;
      const recipient = isObject ? msg.recipient : null;
      const targetId = recipient || this.activeContact?.id;
      const targetTransport = this.activeContact?.transport;

      // ─── v3.4.1: PRIORIZAR BLE si hay contacto activo ───
      if (targetId && targetTransport === 'ble' && this.bleInterface?.nativePlugin) {
        try {
          await this._sendViaBLE(targetId, content);
          this._handleMessage({ content, _own: true, timestamp: Date.now(), pending: false, recipient: targetId, source: 'ble_direct' }, 'self');
          return true;
        } catch (e) {
          if (e.message.includes('BLE_011')) {
            // Modo servidor: no es error, es estado esperado
            DEBUG.warn(`BLE modo servidor: ${e.message}`, 'MSG_BLE_SERVER');
          } else {
            DEBUG.warn(`BLE directo falló: ${e.message}`, 'MSG_BLE_FAIL');
          }
        }
      }
      
      // ─── v3.4.1: Si no hay contacto activo BLE pero hay peers BLE conectados, usar el primero ───
      if (this.bleInterface?.nativePlugin) {
        try {
          const connectedResult = await this.bleInterface.nativePlugin.getConnectedDevices();
          const bleDevices = connectedResult?.devices || [];
          if (bleDevices.length > 0) {
            const firstPeer = bleDevices[0];
            DEBUG.log(`[BLE_SEND] Enviando a peer conectado ${firstPeer.deviceId?.substr(0,8)} (sin contacto activo)`, 'info', 'BLE_PEER_SEND');
            await this._sendViaBLE(firstPeer.deviceId, content);
            this._handleMessage({ content, _own: true, timestamp: Date.now(), pending: false, recipient: firstPeer.deviceId, source: 'ble_direct' }, 'self');
            return true;
          }
        } catch (e) {
          DEBUG.log(`[BLE_SEND] Fallback a peer conectado falló: ${e.message}`, 'warn', 'BLE_PEER_FAIL');
        }
      }

      const nordicPeers = this.nordicMesh?.getPeers?.() || [];
      if (nordicPeers.length > 0) {
        try {
          await this.nordicMesh.sendMessage(nordicPeers[0].id, content);
          DEBUG.success(`Sent via Nordic to ${nordicPeers[0].id.substr(0,8)}`, 'MSG_NORDIC');
          return true;
        } catch (e) {
          DEBUG.error('NORDIC_009', `Send failed: ${e.message}`);
        }
      }
      
      if (this.mesh?.getPeerCount?.() > 0) {
        try {
          await this.mesh.broadcast({ content });
          DEBUG.success('Sent via Hybrid', 'MSG_HYBRID');
          return true;
        } catch (e) {
          DEBUG.error('MESH_005', `Broadcast failed: ${e.message}`);
        }
      }
      
      if (this.bridge) {
        const result = await this.bridge.send({ content });
        if (result) {
          DEBUG.success('Sent via Bridge', 'MSG_BRIDGE');
          return true;
        }
      }
      
      if (this.wsClient?.isConnected?.()) {
        this.wsClient.send({ content });
        DEBUG.success('Sent via WebSocket', 'MSG_WS');
        return true;
      }
      
      DEBUG.warn('No hay dispositivos NEXO disponibles. Asegúrate de que el otro dispositivo tenga NEXO abierto, Bluetooth activado y visibilidad encendida.', 'MSG_FAIL');
      return false;
    } catch (err) {
      DEBUG.error('APP_008', `SendMessage critical: ${err.message}`);
      return false;
    }
  }

  _handleMessage(msg, source) {
    if (this._isDestroyed) return;
    try {
      const enriched = { ...msg, _source: source, _ts: Date.now(), _id: Math.random().toString(36).substr(2, 9) };
      this.config.onMessage(enriched);
      if (this.stream?.appendItems) this.stream.appendItems([enriched]);
    } catch (err) {
      DEBUG.error('APP_005', `Message handler: ${err.message}`);
    }
  }

  _logFinalStatus() {
    const hybridStatus = this.mesh?.getStatus?.();
    const nordicPeers = this.nordicMesh?.getPeers?.() || [];
    DEBUG.log(
      `Status: Mode=${hybridStatus?.mode || 'N/A'} ` +
      `HybridPeers=${hybridStatus?.peerCount || 0} ` +
      `NordicPeers=${nordicPeers.length} ` +
      `WS=${this.wsClient?.isConnected ? 'ON' : 'OFF'}`,
      'info',
      'STATUS'
    );
  }

  async _partialCleanup() {
    DEBUG.log('Executing partial cleanup...', 'warn', 'CLEANUP');
    if (this.nordicMesh) { try { await this.nordicMesh.destroy?.(); } catch(e) {} this.nordicMesh = null; }
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { this.wsClient.disconnect?.(); } catch(e) {} this.wsClient = null; }
  }

  async destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    DEBUG.log('🧹 NAP 2.0 Cleanup...', 'info', 'DESTROY');
    if (this._bleChatHandler) {
      window.removeEventListener('nexo:ble:openChat', this._bleChatHandler);
      this._bleChatHandler = null;
    }
    if (this._bleMessageHandler) {
      window.removeEventListener('nexo:ble:messageReceived', this._bleMessageHandler);
      this._bleMessageHandler = null;
    }
    // ─── v3.4.1: Remover listeners nativos directos ───
    if (this._nativePayloadListener) { try { this._nativePayloadListener.remove(); } catch(e) {} this._nativePayloadListener = null; }
    if (this._nativeDeviceConnectedListener) { try { this._nativeDeviceConnectedListener.remove(); } catch(e) {} this._nativeDeviceConnectedListener = null; }
    if (this._nativeDeviceDisconnectedListener) { try { this._nativeDeviceDisconnectedListener.remove(); } catch(e) {} this._nativeDeviceDisconnectedListener = null; }
    if (this._nativeStackBrokenListener) { try { this._nativeStackBrokenListener.remove(); } catch(e) {} this._nativeStackBrokenListener = null; }
    if (this._nativeNotificationsListener) { try { this._nativeNotificationsListener.remove(); } catch(e) {} this._nativeNotificationsListener = null; }
    
    if (this.bleInterface) { try { this.bleInterface.destroy(); } catch(e) {} this.bleInterface = null; }
    if (this.vaultSlider) { try { this.vaultSlider.destroy?.(); } catch(e) {} this.vaultSlider = null; }
    if (this.gestures) { try { this.gestures.destroy?.(); } catch(e) {} this.gestures = null; }
    if (this.stream) { try { this.stream.destroy?.(); } catch(e) {} this.stream = null; }
    if (this.bridge) { try { this.bridge.destroy?.(); } catch(e) {} this.bridge = null; }
    if (this.nordicMesh) {
      this._resources.handlers.forEach(unsub => { try { unsub(); } catch(e) {} });
      try { await this.nordicMesh.destroy?.(); } catch(e) {}
      this.nordicMesh = null;
    }
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { this.wsClient.disconnect?.(); } catch(e) {} this.wsClient = null; }
    if (this.vault) { try { this.vault.destroy?.(); } catch(e) {} this.vault = null; }
    this._resources.timers.forEach(t => clearTimeout(t));
    this._resources.timers.clear();
    this._resources.handlers.clear();
    DEBUG.success('Cleanup complete', 'DESTROY_OK');
  }

  getStatus() {
    return {
      initialized: this.initialized,
      destroyed: this._isDestroyed,
      mode: this.mesh?.getStatus?.().mode || (this.nordicMesh?.getState?.() === 'messaging' ? 'p2p_ble' : 'offline'),
      peers: this.mesh?.getPeerCount?.() || 0,
      nordicPeers: this.nordicMesh?.getPeers?.().length || 0,
      hasBLEInterface: !!this.bleInterface,
      hasNordic: !!this.nordicMesh,
      hasHybrid: !!this.mesh,
      hasWebSocket: !!this.wsClient?.isConnected?.(),
      hasVault: !!this.vault,
      activeContact: this.activeContact ? { name: this.activeContact.name, transport: this.activeContact.transport, role: this.activeContact.role } : null
    };
  }
}

export default NexoApp;
export { DEBUG };
