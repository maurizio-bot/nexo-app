/**
 * NEXO App v6.0.1-FIX
 * FIX: Anti-eco por messageId (no por fingerprint de contenido)
 * FIX: Eliminar dedup duplicado en _bleMessageHandler y _handleMessage
 * Coordinado con main.js v10.0-IDENTITY + ble_interface.js v3.7.2
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
  setPhase: (p) => rem.updatePhase(p),
  setMode: (m) => rem.updateMode(m),
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

    // FIX v6.0.1: Set de messageIds propios para anti-eco REAL
    this._ownMessageIds = new Set();
    this._maxOwnMessageIds = 200;

    // Dedup general por messageId visto (cualquier origen)
    this._seenMessageIds = new Set();
    this._maxSeenMessageIds = 500;

    // Anti-bounce envio
    this._isSendingMessage = false;

    DEBUG.log('NEXO v6.0.1-FIX iniciando...', 'info', 'APP_INIT');
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
      const nativeAvailable = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE);
      if (this.config.enableMesh && !nativeAvailable) await this._initPhase3_NordicMesh();
      if (this.config.enableMesh && !nativeAvailable) await this._initPhase4_HybridMesh();
      await this._initPhase5_BLEUI();
      await this._initPhase6_Bridge();
      await this._initPhase7_UI();
      this.initialized = true;
      DEBUG.setPhase('READY');
      DEBUG.success('NEXO v6.0.1-FIX Ready', 'APP_READY');
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
      const identity = this.vault.getIdentity ? this.vault.getIdentity() : undefined;
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
      if (!result.success) throw new Error((result.error && result.error.message) || 'Nordic init returned false');
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
      if (this.bleInterface) DEBUG.success('BLE UI ready' + (meshInstance ? '' : ' (native)'), 'UI_002');

      this._bleChatHandler = (e) => {
        const { contactId, name, address, transport } = e.detail;
        this.activeContact = { id: contactId, name, address, transport };
        const appContainer = document.getElementById('app');
        if (appContainer) appContainer.classList.remove('hidden');
        const nameInput = document.getElementById('chat-contact-name');
        const subtitle = document.getElementById('chat-contact-subtitle');
        if (nameInput) nameInput.value = name || 'NEXO Device';
        if (subtitle) subtitle.textContent = transport === 'ble' ? 'BLUETOOTH' : 'NEXO MESH';
        DEBUG.success(`Chat activo: ${name} [${transport.toUpperCase()}]`, 'BLE_CHAT');
        this._updateMode('P2P_BLE');
        this.config.onStatusChange(`CHAT:${name}`);
      };
      window.addEventListener('nexo:ble:openChat', this._bleChatHandler);

      this._bleMessageHandler = (e) => {
        const { deviceId, content, senderName, messageId, source, timestamp, conversationId } = e.detail;
        const contentPreview = (content && content.substring) ? content.substring(0, 30) : '';
        console.log('[BLE_RECV] Mensaje de ' + senderName + ': ' + contentPreview + '...');

        const nid = this._normalizeId(deviceId);
        const convId = conversationId || nid;

        // Resolver nombre (sin cambios)
        let resolvedName = senderName;
        const isGeneric = !resolvedName || resolvedName === 'NEXO Peer' || resolvedName === 'Unknown';
        if (isGeneric) {
          if (this.bleInterface && this.bleInterface._peerNames && this.bleInterface._peerNames[convId]) {
            resolvedName = this.bleInterface._peerNames[convId];
          }
          if (!resolvedName || resolvedName === 'NEXO Peer' || resolvedName === 'Unknown') {
            if (this.activeContact && this._normalizeId(this.activeContact.id) === convId) {
              resolvedName = this.activeContact.name || resolvedName;
            }
          }
          if (!resolvedName || resolvedName === 'NEXO Peer' || resolvedName === 'Unknown') {
            try {
              const contacts = JSON.parse(localStorage.getItem('nexo_ble_contacts_v1') || '[]');
              const contact = contacts.find(c => this._normalizeId(c.id || c.address) === convId);
              if (contact && contact.name) resolvedName = contact.name;
            } catch (e) {}
          }
          if (!resolvedName || resolvedName === 'NEXO Peer' || resolvedName === 'Unknown') {
            const connDev = this.bleInterface && this.bleInterface.connectedDevices ? this.bleInterface.connectedDevices.get(convId) : null;
            const foundDev = this.bleInterface && this.bleInterface.foundDevices ? this.bleInterface.foundDevices.get(convId) : null;
            resolvedName = (connDev && connDev.name) || (foundDev && foundDev.name) || senderName || 'NEXO Peer';
          }
        }

        // FIX v6.0.1: Anti-eco por messageId propio (NO por fingerprint de contenido)
        if (messageId && this._ownMessageIds.has(messageId)) {
          console.log(`[BLE_RECV] ECO REAL filtrado (messageId propio): ${messageId}`);
          return;
        }

        this._handleMessage({
          content,
          sender: deviceId,
          senderName: resolvedName,
          conversationId: convId,
          source: 'ble_direct',
          timestamp: timestamp || Date.now(),
          messageId,
          _own: false
        }, 'ble_direct');
      };
      window.addEventListener('nexo:ble:messageReceived', this._bleMessageHandler);

    } catch (err) { DEBUG.error('UI_004', `BLE UI init failed: ${err.message}`); this.bleInterface = null; }
  }

  _normalizeId(id) {
    if (!id) return '';
    return id.toString().toLowerCase().replace(/[:-]/g, '').trim();
  }

  async _initPhase6_Bridge() {
    DEBUG.setPhase('BRIDGE');
    try {
      if (!this.mesh && !this.nordicMesh && !this.wsClient && !(this.bleInterface && this.bleInterface.nativePlugin)) {
        DEBUG.warn('No transports', 'BRIDGE_SKIP');
        return;
      }
      this.bridge = new MeshRelayBridge({ mesh: this.mesh, nordicMesh: this.nordicMesh, relay: this.wsClient, onModeChange: (mode) => { DEBUG.setMode(mode); this.config.onStatusChange(mode); } });
      await withTimeoutNAP(this.bridge.initialize(), 5000, 'Bridge.initialize');
      DEBUG.success('Bridge ready', 'BRIDGE_002');
    } catch (err) { DEBUG.warn(`Bridge init failed: ${err.message}`, 'BRIDGE_003'); this.bridge = null; }
  }

  async _initPhase7_UI() {
    DEBUG.setPhase('GESTURES');
    if (this.config.enableGestures) { try { this.gestures = new GestureEngine({}); this.gestures.init(); } catch (e) {} }
    DEBUG.setPhase('VAULT_SLIDER');
    const streamEl = document.getElementById('nexo-stream');
    const vaultEl = document.getElementById('nexo-vault');
    if (streamEl && vaultEl) { try { this.vaultSlider = new CoreGestureEngine(streamEl, vaultEl); } catch (e) {} }
    DEBUG.setPhase('STREAM');
    const container = document.getElementById('messages-container');
    if (container) { try { this.stream = new TheStream(container, {}); } catch (e) {} }
  }

  _handleNordicPeer(peer) { if (!peer || !peer.id) return; this.blePeers.set(peer.id, Object.assign({}, peer, {discoveredAt: Date.now()})); }
  _handleNordicSession(data) { if (!data || !data.deviceId) return; this._updateMode('P2P_BLE'); }
  _handleNordicMessage(msg) { if (!msg || !msg.deviceId) return; this._handleMessage({ content: msg.content, sender: msg.deviceId, source: 'ble_nordic', timestamp: msg.timestamp || Date.now() }, 'ble_nordic'); }
  _updateModeFromNordic(state) {
    switch(state) {
      case 'messaging': case 'connected': this._updateMode('P2P_BLE'); break;
      case 'offline': var meshPeers = this.mesh && this.mesh.getPeerCount ? this.mesh.getPeerCount() : 0; var wsConnected = this.wsClient && this.wsClient.isConnected ? this.wsClient.isConnected() : false; if (!meshPeers && !wsConnected) this._updateMode('OFFLINE'); break;
    }
  }
  _updateMode(mode) { DEBUG.setMode(mode); this.config.onStatusChange(mode); }

  async _sendViaBLE(deviceId, content, conversationId) {
    if (this.bleInterface && this.bleInterface.sendMessage) {
      const devIdShort = deviceId ? (deviceId.substring ? deviceId.substring(0,8) : String(deviceId).substring(0,8)) : 'unknown';
      console.log('[BLE_SEND] Enviando via bleInterface a ' + devIdShort + '...');
      try {
        await this.bleInterface.sendMessage(deviceId, content);
        DEBUG.success('Enviado via BLE a ' + devIdShort, 'MSG_BLE');
        return;
      } catch (e) {
        DEBUG.warn('bleInterface.sendMessage fallo, fallback: ' + (e && e.message ? e.message : String(e)), 'MSG_BLE_FALLBACK');
      }
    }
    const plugin = this.bleInterface && this.bleInterface.nativePlugin ? this.bleInterface.nativePlugin : null;
    if (!plugin) throw new Error('Plugin no disponible');
    try {
      await plugin.sendMessage({ deviceId: deviceId, message: content });
      DEBUG.success('Enviado via BLE directo', 'MSG_BLE');
    } catch (e) {
      DEBUG.error('BLE_SEND_FAIL', 'Envio fallo: ' + (e && e.message ? e.message : String(e)));
      throw e;
    }
  }

  async sendMessage(msg) {
    if (!this.initialized || this._isDestroyed) {
      DEBUG.error(this._isDestroyed ? 'APP_022' : 'APP_021', 'Cannot send');
      return false;
    }
    if (this._isSendingMessage) {
      DEBUG.warn('Envio ya en progreso, ignorando bounce', 'MSG_SEND_BOUNCE');
      return false;
    }
    this._isSendingMessage = true;
    try {
      const isObject = msg && typeof msg === 'object';
      const content = isObject ? (msg.content || msg) : msg;
      const recipient = isObject ? msg.recipient : null;
      const conversationId = isObject ? (msg.conversationId || recipient) : null;
      const activeId = this.activeContact && this.activeContact.id ? this.activeContact.id : 'self';
      const convId = this._normalizeId(conversationId || activeId);

      // FIX v6.0.1: Generar messageId y guardar en _ownMessageIds ANTES de enviar
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this._ownMessageIds.add(messageId);
      if (this._ownMessageIds.size > this._maxOwnMessageIds) {
        const first = this._ownMessageIds.values().next().value;
        this._ownMessageIds.delete(first);
      }

      const ownMessage = { 
        content, 
        _own: true, 
        isMe: true,
        timestamp: Date.now(), 
        pending: false, 
        messageId,
        sender: 'Tu',
        senderName: 'Tu',
        conversationId: convId
      };

      // Notificar via onMessage — main.js renderiza en TheStream
      this.config.onMessage(ownMessage);

      // Enviar por transporte
      const targetId = recipient || (this.activeContact && this.activeContact.id);
      const targetTransport = this.activeContact && this.activeContact.transport;

      if (targetId && targetTransport === 'ble' && this.bleInterface && this.bleInterface.nativePlugin) {
        try { await this._sendViaBLE(targetId, content, convId); return true; }
        catch (e) { DEBUG.warn(`BLE directo fallo: ${e.message}`, 'MSG_BLE_FAIL'); }
      }

      if (this.bleInterface && this.bleInterface.nativePlugin) {
        try {
          const connectedResult = await this.bleInterface.nativePlugin.getConnectedDevices();
          const bleDevices = (connectedResult && connectedResult.devices) || [];
          if (bleDevices.length > 0) {
            await this._sendViaBLE(bleDevices[0].deviceId || bleDevices[0].id, content, convId);
            return true;
          }
        } catch (e) { DEBUG.log(`[BLE_SEND] Fallback fallo: ${e.message}`, 'warn', 'BLE_PEER_FAIL'); }
      }

      const nordicPeers = (this.nordicMesh && this.nordicMesh.getPeers) ? this.nordicMesh.getPeers() : [];
      if (nordicPeers.length > 0) {
        try { await this.nordicMesh.sendMessage(nordicPeers[0].id, content); DEBUG.success('Sent via Nordic', 'MSG_NORDIC'); return true; }
        catch (e) { DEBUG.error('NORDIC_009', `Send failed: ${e.message}`); }
      }

      if (this.mesh && this.mesh.getPeerCount && this.mesh.getPeerCount() > 0) {
        try { await this.mesh.broadcast({ content }); DEBUG.success('Sent via Hybrid', 'MSG_HYBRID'); return true; }
        catch (e) { DEBUG.error('MESH_005', `Broadcast failed: ${e.message}`); }
      }

      if (this.bridge) { const result = await this.bridge.send({ content }); if (result) { DEBUG.success('Sent via Bridge', 'MSG_BRIDGE'); return true; } }

      if (this.wsClient && this.wsClient.isConnected && this.wsClient.isConnected()) { this.wsClient.send({ content }); DEBUG.success('Sent via WebSocket', 'MSG_WS'); return true; }

      DEBUG.warn('No hay dispositivos NEXO disponibles.', 'MSG_FAIL');
      return false;
    } catch (err) { DEBUG.error('APP_008', `SendMessage critical: ${err.message}`); return false; }
    finally { this._isSendingMessage = false; }
  }

  // FIX v6.0.1: DEDUP UNIFICADO — un solo punto de entrada, por messageId
  _handleMessage(msg, source) {
    if (this._isDestroyed) return;
    try {
      // Filtrar mensajes propios (marcados como _own o isMe)
      if (msg._own === true || msg.isMe === true) return;

      const messageId = msg.messageId;

      // FIX v6.0.1: Dedup por messageId (único y confiable)
      if (messageId && this._seenMessageIds.has(messageId)) {
        DEBUG.log(`Deduplicado por messageId: ${messageId}`, 'debug', 'DEDUP_ID');
        return;
      }

      if (messageId) {
        this._seenMessageIds.add(messageId);
        if (this._seenMessageIds.size > this._maxSeenMessageIds) {
          const first = this._seenMessageIds.values().next().value;
          this._seenMessageIds.delete(first);
        }
      }

      const convId = this._normalizeId(msg.conversationId || msg.sender || msg.senderName || msg.deviceId || 'unknown');
      const enriched = { 
        ...msg, 
        _source: source, 
        _ts: Date.now(), 
        _id: Math.random().toString(36).substr(2, 9),
        conversationId: msg.conversationId || convId
      };

      this.config.onMessage(enriched);

    } catch (err) { DEBUG.error('APP_005', `Message handler: ${err.message}`); }
  }

  async _partialCleanup() {
    if (this.nordicMesh) { try { if (this.nordicMesh.destroy) await this.nordicMesh.destroy(); } catch(e) {} this.nordicMesh = null; }
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { if (this.wsClient.disconnect) this.wsClient.disconnect(); } catch(e) {} this.wsClient = null; }
  }

  async destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    DEBUG.log('Cleanup...', 'info', 'DESTROY');
    if (this._bleChatHandler) { window.removeEventListener('nexo:ble:openChat', this._bleChatHandler); this._bleChatHandler = null; }
    if (this._bleMessageHandler) { window.removeEventListener('nexo:ble:messageReceived', this._bleMessageHandler); this._bleMessageHandler = null; }
    if (this.bleInterface) { try { this.bleInterface.destroy(); } catch(e) {} this.bleInterface = null; }
    if (this.nordicMesh) { this._resources.handlers.forEach(function(unsub) { try { unsub(); } catch(e) {} }); try { if (this.nordicMesh.destroy) await this.nordicMesh.destroy(); } catch(e) {} this.nordicMesh = null; }
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { if (this.wsClient.disconnect) this.wsClient.disconnect(); } catch(e) {} this.wsClient = null; }
    if (this.vault) { try { if (this.vault.destroy) this.vault.destroy(); } catch(e) {} this.vault = null; }
    this._resources.timers.forEach(t => clearTimeout(t));
    this._ownMessageIds.clear();
    this._seenMessageIds.clear();
    DEBUG.success('Cleanup complete', 'DESTROY_OK');
  }

  getStatus() {
    return {
      initialized: this.initialized,
      mode: (this.mesh && this.mesh.getStatus && this.mesh.getStatus().mode) || (this.nordicMesh && this.nordicMesh.getState && this.nordicMesh.getState() === 'messaging' ? 'p2p_ble' : 'offline'),
      hasBLEInterface: !!this.bleInterface,
      activeContact: this.activeContact ? { name: this.activeContact.name, transport: this.activeContact.transport } : null
    };
  }
}

export default NexoApp;
export { DEBUG };
