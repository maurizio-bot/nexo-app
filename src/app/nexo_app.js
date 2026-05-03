/**
 * NEXO App v5.3.0-ARCH — FASE 1: UUID persistente integration
 * ADD: Lee deviceUUID del nativo, lo muestra en status bar, lo usa en init
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
    timer = setTimeout(() => reject(new Error(`[NAP_TIMEOUT] ${context}`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => { if (timer) clearTimeout(timer); });
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
    if (code) rem[method](msg, code); else rem[method](msg);
  },
  error: (code, msg) => DEBUG.log(msg, 'error', code),
  success: (msg, code = null) => DEBUG.log(msg, 'success', code),
  warn: (msg, code = null) => DEBUG.log(msg, 'warn', code),
  setPhase: (p) => { rem.updatePhase(p); if (window._nexoApp?.bleInterface?.updateStatus) window._nexoApp.bleInterface.updateStatus(p, null, null); },
  setMode: (m) => { rem.updateMode(m); if (window._nexoApp?.bleInterface?.updateStatus) window._nexoApp.bleInterface.updateStatus(null, m, null); },
  setIdentity: (id) => id && rem.updateIdentity(id)
};

export class NexoApp {
  constructor(config = {}) {
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
    this._bleSendHandler = null;
    this._messageDedupMap = new Map();
    this._maxProcessedIds = 1000;
    this._dedupTTL = 300000;
    this._contentFpMap = new Map();
    this._contentFpTTL = 15000;
    this._contentFpMax = 500;
    this._deviceUUID = null; // FASE 1
    DEBUG.log('🚀 [NEXO] v5.3.0-ARCH iniciando...', 'info', 'APP_INIT');
  }

  _hashContent(str) {
    let h = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(36).padStart(8, '0');
  }

  async init() {
    if (this.initialized) { DEBUG.warn('Already initialized', 'APP_SKIP'); return this; }
    if (this._isInitializing) throw new Error('[APP_018] Initialization in progress');
    if (this._isDestroyed) throw new Error('[APP_019] Cannot init destroyed');
    this._isInitializing = true;
    DEBUG.setPhase('INIT');
    try {
      await this._initPhase1_Crypto();
      await this._initPhase2_WebSocket();
      const nativeAvailable = !!(window.Capacitor?.Plugins?.NexoBLE);
      if (this.config.enableMesh && !nativeAvailable) await this._initPhase3_NordicMesh();
      if (this.config.enableMesh && !nativeAvailable) await this._initPhase4_HybridMesh();
      await this._initPhase5_BLEUI();
      await this._initPhase6_Bridge();
      await this._initPhase7_UI();
      this.initialized = true;
      DEBUG.setPhase('READY');
      DEBUG.success('🎉 NEXO v5.3.0-ARCH Ready', 'APP_READY');
      if (this.bleInterface && this.bleInterface.showMainScreen) {
        this.bleInterface.showMainScreen();
      }
    } catch (err) {
      DEBUG.error('APP_020', `Init failed: ${err.message}`);
      await this._partialCleanup();
      throw err;
    } finally { this._isInitializing = false; }
    return this;
  }

  async _initPhase1_Crypto() {
    DEBUG.setPhase('CRYPTO');
    try {
      this.vault = new CryptoVault();
      await withTimeoutNAP(this.vault.init(), 5000, 'CryptoVault.init');
      const identity = this.vault.getIdentity?.();
      if (identity) { DEBUG.setIdentity(identity); DEBUG.success('Vault initialized', 'CRYPTO_002'); }
    } catch (err) { DEBUG.error('CRYPTO_004', `Vault init failed: ${err.message}`); this.vault = null; }
  }

  async _initPhase2_WebSocket() {
    DEBUG.setPhase('WEBSOCKET');
    if (this.config.relayUrls.length === 0) { DEBUG.warn('No relay URLs', 'WS_SKIP'); return; }
    try {
      this.wsClient = new WebSocketClient(this.config.relayUrls[0]);
      this.wsClient.onMessage = (m) => this._handleMessage(m, 'relay');
      this.wsClient.onOpen = () => DEBUG.setMode('RELAY');
      await withTimeoutNAP(this.wsClient.connect(), 8000, 'WebSocket.connect');
    } catch (err) { DEBUG.warn(`WebSocket unavailable: ${err.message}`, 'WS_004'); this.wsClient = null; }
  }

  async _initPhase3_NordicMesh() {
    DEBUG.setPhase('NORDIC_MESH');
    try {
      if (!this.vault) throw new Error('Vault required');
      this.nordicMesh = new NordicMesh(this.vault, { rssiThreshold: -85, chunkSize: 507, handshakeTimeout: 30000 });
      const unsub1 = this.nordicMesh.on('peerDiscovered', (p) => this._handleNordicPeer(p));
      const unsub2 = this.nordicMesh.on('sessionEstablished', (d) => this._handleNordicSession(d));
      const unsub3 = this.nordicMesh.on('messageReceived', (m) => this._handleNordicMessage(m));
      const unsub4 = this.nordicMesh.on('stateChanged', ({ to }) => this._updateModeFromNordic(to));
      const unsub5 = this.nordicMesh.on('error', (err) => DEBUG.error('NORDIC_010', err.message));
      this._resources.handlers.add(unsub1, unsub2, unsub3, unsub4, unsub5);
      const result = await withTimeoutNAP(this.nordicMesh.init(), 10000, 'NordicMesh.init');
      if (!result.success) throw new Error(result.error?.message || 'Nordic init returned false');
      DEBUG.success(`Nordic Mesh active [Native:${result.isNative}]`, 'NORDIC_002');
    } catch (err) { DEBUG.error('NORDIC_005', `Nordic init failed: ${err.message}`); this.nordicMesh = null; }
  }

  async _initPhase4_HybridMesh() {
    DEBUG.setPhase('MESH');
    try {
      this.mesh = new HybridMesh({
        onDeviceFound: (d) => { DEBUG.log(`Hybrid found: ${d.name}`, 'info', 'MESH_DEVICE'); },
        onDeviceConnected: (d) => { DEBUG.success(`Hybrid connected: ${d.name}`, 'MESH_CONN'); },
        onDeviceDisconnected: (d) => { DEBUG.log(`Hybrid disconnected`, 'warn', 'MESH_DISC'); },
        onError: (code, msg) => DEBUG.error('MESH_006', msg)
      });
      await withTimeoutNAP(this.mesh.initialize(), 15000, 'HybridMesh.initialize');
      DEBUG.success('Hybrid Mesh ready', 'MESH_002');
    } catch (err) { DEBUG.error('APP_016', `Hybrid Mesh: ${err.message}`); this.mesh = null; }
  }

  async _initPhase5_BLEUI() {
    DEBUG.setPhase('BLE_UI');
    try {
      const meshInstance = this.nordicMesh || this.mesh || null;
      this.bleInterface = initBLEInterface(meshInstance);
      if (this.bleInterface) {
        DEBUG.success('BLE UI ready' + (meshInstance ? '' : ' (native)'), 'UI_002');
      }

      // FASE 1: Obtener UUID persistente del nativo
      const nativePlugin = window.Capacitor?.Plugins?.NexoBLE;
      if (nativePlugin?.getDeviceUUID) {
        try {
          const uuidResult = await nativePlugin.getDeviceUUID();
          this._deviceUUID = uuidResult?.deviceUUID || null;
          if (this._deviceUUID) {
            DEBUG.success(`DeviceUUID: ${this._deviceUUID.substring(0, 8)}...`, 'UUID_OK');
          }
        } catch (e) {
          DEBUG.warn(`getDeviceUUID fallo: ${e.message}`, 'UUID_WARN');
        }
      }

      // FASE 1: Inicializar BLE con UUID persistente
      if (nativePlugin?.initializeBLE) {
        try {
          const initResult = await nativePlugin.initializeBLE({
            userId: this._deviceUUID || undefined,
            userName: 'NEXO User'
          });
          // Si el nativo genero/retorno un UUID, usarlo
          if (initResult?.deviceUUID && !this._deviceUUID) {
            this._deviceUUID = initResult.deviceUUID;
          }
          DEBUG.success('BLE nativo inicializado', 'BLE_INIT');
          if (nativePlugin.startAdvertising) {
            await nativePlugin.startAdvertising({ deviceName: 'NEXO' });
            DEBUG.success('Advertising iniciado', 'BLE_ADVERT');
          }
        } catch (e) {
          DEBUG.warn(`BLE nativo init: ${e.message}`, 'BLE_INIT_WARN');
        }
      }

      // FASE 1: Mostrar UUID en status bar
      const displayId = this._deviceUUID || this.vault?.getIdentity?.()?.id || this.bleInterface?.localDeviceAddress || '--';
      this.bleInterface.updateStatus('INIT', 'OFFLINE', displayId);

      this._bleChatHandler = (e) => {
        const { contactId, name, address, transport } = e.detail;
        this.activeContact = { id: contactId, name, address, transport };
        DEBUG.success(`💬 Chat activo: ${name} [${transport.toUpperCase()}]`, 'BLE_CHAT');
        this._updateMode('P2P_BLE');
        this.config.onStatusChange(`CHAT:${name}`);
      };
      window.addEventListener('nexo:ble:openChat', this._bleChatHandler);

      this._bleMessageHandler = (e) => {
        const { deviceId, content, senderName, messageId, source, timestamp } = e.detail;
        const nid = (deviceId || '').toString().toLowerCase().trim().replace(/[^a-f0-9]/g, '');
        if (this.bleInterface?.localDeviceAddress && nid === this.bleInterface.localDeviceAddress) {
          DEBUG.log(`Eco propio ignorado de ${nid.substring(0,8)}`, 'debug', 'DEDUP_ECHO');
          return;
        }
        let resolvedName = senderName;
        if (this.bleInterface && typeof this.bleInterface.getContactName === 'function') {
          const persisted = this.bleInterface.getContactName(nid);
          if (persisted) resolvedName = persisted;
        }
        if (!resolvedName || resolvedName === 'NEXO Peer') {
          resolvedName = `NEXO-${nid.substring(0, 6).toUpperCase()}`;
        }
        this._handleMessage({ content, sender: nid, senderName: resolvedName, source: source || 'ble_direct', timestamp: timestamp || Date.now(), messageId: messageId || null, _own: false }, 'ble_direct');
      };
      window.addEventListener('nexo:ble:messageReceived', this._bleMessageHandler);

      this._bleSendHandler = (e) => {
        const { content, deviceId, messageId } = e.detail;
        this.sendMessage({ content, recipient: deviceId, messageId, transport: 'ble' });
      };
      window.addEventListener('nexo:ble:sendMessage', this._bleSendHandler);

    } catch (err) { DEBUG.error('UI_004', `BLE UI init failed: ${err.message}`); this.bleInterface = null; }
  }

  async _initPhase6_Bridge() {
    DEBUG.setPhase('BRIDGE');
    try {
      if (!this.mesh && !this.nordicMesh && !this.wsClient && !this.bleInterface?.nativePlugin) {
        DEBUG.warn('No transports', 'BRIDGE_SKIP');
        return;
      }
      this.bridge = new MeshRelayBridge({ mesh: this.mesh, nordicMesh: this.nordicMesh, relay: this.wsClient, onModeChange: (mode) => { DEBUG.setMode(mode); this.config.onStatusChange(mode
