/**
 * NEXO App v5.0.7-ARCH-FIX
 * Coordinado con NexoBlePlugin.kt v5.0.0-ARCH + ble_interface.js v3.7.6-HEALTH-FIX
 * FIX v5.0.7: Guard en stream + sendMessage no doble-render + targetTransport default 'ble'
 * FIX v5.0.7: activeContact siempre seteado, fallback a connectedDevices[0]
 * FIX v5.0.7: _handleMessage guard robusto, dedup por fingerprint + messageId
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
    this._messageDedupMap = new Map();
    this._maxProcessedIds = 1000;
    this._dedupTTL = 300000;
    DEBUG.log('🚀 [NEXO] v5.0.7-ARCH-FIX iniciando...', 'info', 'APP_INIT');
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
      DEBUG.success('🎉 NEXO v5.0.7-ARCH-FIX Ready', 'APP_READY');
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
      const plugin = window.Capacitor?.Plugins?.NexoBLE;
      if (plugin && plugin.checkBLEStatus) {
        try {
          const status = await plugin.checkBLEStatus();
          if (!status || !status.allGranted) {
            DEBUG.log('[BLE] Permisos pendientes, solicitando...', 'info', 'BLE_PERM_INIT');
            await plugin.initializeBLE();
          } else {
            DEBUG.log('[BLE] Permisos ya concedidos', 'info', 'BLE_PERM_OK');
          }
        } catch (permErr) {
          DEBUG.warn(`BLE perm check failed: ${permErr.message}`, 'BLE_PERM_WARN');
        }
      }

      const nativePlugin = window.Capacitor?.Plugins?.NexoBLE;
      let meshInstance = this.nordicMesh || this.mesh || null;

      if (!meshInstance && nativePlugin) {
        meshInstance = { 
          nativePlugin: nativePlugin,
          isNativeWrapper: true,
          getConnectedDevices: () => nativePlugin.getConnectedDevices?.() || Promise.resolve({ devices: [] })
        };
      }

      this.bleInterface = initBLEInterface(meshInstance);
      if (this.bleInterface) {
        if (nativePlugin && !this.bleInterface.nativePlugin) {
          this.bleInterface.nativePlugin = nativePlugin;
        }
        DEBUG.success('BLE UI ready' + (meshInstance?.isNativeWrapper ? ' (native)' : ''), 'UI_002');
      }

      this._bleChatHandler = (e) => {
        const { contactId, name, address, transport } = e.detail;
        this.activeContact = { id: contactId, name, address, transport: transport || 'ble' };
        const appContainer = document.getElementById('app');
        if (appContainer) appContainer.classList.remove('hidden');
        const nameInput = document.getElementById('chat-contact-name');
        const subtitle = document.getElementById('chat-contact-subtitle');
        if (nameInput) nameInput.value = name || 'NEXO Device';
        if (subtitle) subtitle.textContent = transport === 'ble' ? 'BLUETOOTH' : 'NEXO MESH';
        DEBUG.success(`💬 Chat activo: ${name} [${(transport || 'ble').toUpperCase()}]`, 'BLE_CHAT');
        this._updateMode('P2P_BLE');
        this.config.onStatusChange(`CHAT:${name}`);
      };
      window.addEventListener('nexo:ble:openChat', this._bleChatHandler);

      this._bleMessageHandler = (e) => {
        const { deviceId, content, senderName, messageId, source, timestamp } = e.detail;
        console.log(`[BLE_RECV] Mensaje de ${senderName}: ${content?.substring?.(0,30) || ''}...`);

        let resolvedName = senderName;
        if (!resolvedName || resolvedName === 'NEXO Peer') {
          const nid = (deviceId || '').toString().toLowerCase().trim();
          resolvedName = this.bleInterface?.connectedDevices?.get(nid)?.name
            || this.bleInterface?.foundDevices?.get(nid)?.name
            || senderName
            || 'NEXO Peer';
        }

        this._handleMessage({
          content,
          sender: deviceId,
          senderName: resolvedName,
          source: source || 'ble_direct',
          timestamp: timestamp || Date.now(),
          messageId,
          _own: false
        }, 'ble_direct');
      };
      window.addEventListener('nexo:ble:messageReceived', this._bleMessageHandler);

    } catch (err) { DEBUG.error('UI_004', `BLE UI init failed: ${err.message}`); this.bleInterface = null; }
  }

  async _initPhase6_Bridge() {
    DEBUG.setPhase('BRIDGE');
    try {
      if (!this.mesh && !this.nordicMesh && !this.wsClient && !this.bleInterface?.nativePlugin) {
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
    if (container) { 
      try { 
        this.stream = new TheStream(container, {}); 
      } catch (e) {
        DEBUG.warn(`TheStream init failed: ${e.message}`, 'STREAM_WARN');
        this.stream = null;
      }
    }
  }

  _handleNordicPeer(peer) { if (!peer?.id) return; this.blePeers.set(peer.id, { ...peer, discoveredAt: Date.now() }); }
  _handleNordicSession(data) { if (!data?.deviceId) return; this._updateMode('P2P_BLE'); }
  _handleNordicMessage(msg) { if (!msg?.deviceId) return; this._handleMessage({ content: msg.content, sender: msg.deviceId, source: 'ble_nordic', timestamp: msg.timestamp || Date.now() }, 'ble_nordic'); }
  _updateModeFromNordic(state) {
    switch(state) {
      case 'messaging': case 'connected': this._updateMode('P2P_BLE'); break;
      case 'offline': if (!this.mesh?.getPeerCount?.() && !this.wsClient?.isConnected?.()) this._updateMode('OFFLINE'); break;
    }
  }
  _updateMode(mode) { DEBUG.setMode(mode); this.config.onStatusChange(mode); }

  async _sendViaBLE(deviceId, content) {
    const plugin = this.bleInterface?.nativePlugin;
    if (!plugin) throw new Error('Plugin no disponible');
    const messageStr = typeof content === 'string' ? content : JSON.stringify(content);
    console.log(`[BLE_SEND] Enviando a ${deviceId?.substring?.(0,8)}...`);
    try {
      await plugin.sendMessage({ deviceId, message: messageStr });
      DEBUG.success(`📨 Enviado vía BLE a ${deviceId?.substring?.(0,8)}`, 'MSG_BLE');
    } catch (e) {
      DEBUG.error('BLE_SEND_FAIL', `Envío falló: ${e.message}`);
      throw e;
    }
  }

  async sendMessage(msg) {
    if (!this.initialized || this._isDestroyed) {
      DEBUG.error(this._isDestroyed ? 'APP_022' : 'APP_021', 'Cannot send');
      return false;
    }
    try {
      const messageId = msg.messageId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      let content = '';
      if (typeof msg === 'string') {
        content = msg;
      } else if (msg && typeof msg === 'object') {
        content = msg.content || msg.text || msg.message || '';
        if (typeof content !== 'string') {
          content = String(content);
        }
      }

      const recipient = msg && typeof msg === 'object' ? msg.recipient : null;
      const convId = msg && typeof msg === 'object' ? msg.conversationId : null;

      // FIX v5.0.7: Usar activeContact como fuente principal + default transport 'ble'
      let targetId = recipient || this.activeContact?.id || convId;
      let targetTransport = this.activeContact?.transport || 'ble';

      console.log('[SEND] targetId:', targetId, 'targetTransport:', targetTransport, 'activeContact:', this.activeContact);

      // FIX v5.0.7: Si no hay targetId pero hay bleInterface con dispositivos conectados, usar el primero
      if (!targetId && this.bleInterface) {
        try {
          const connectedResult = await this.bleInterface.nativePlugin?.getConnectedDevices?.() || { devices: [] };
          const bleDevices = connectedResult?.devices || [];
          if (bleDevices.length > 0) {
            targetId = bleDevices[0].deviceId || bleDevices[0].id;
            targetTransport = 'ble';
            console.log('[SEND] Fallback a connected device:', targetId);
          }
        } catch (e) { console.log('[SEND] Fallback connected failed:', e.message); }
      }

      // FIX v5.0.7: Si aun no hay targetId, buscar en foundDevices
      if (!targetId && this.bleInterface?.foundDevices) {
        const firstFound = this.bleInterface.foundDevices.values().next().value;
        if (firstFound) {
          targetId = firstFound.id || firstFound.address;
          targetTransport = 'ble';
          console.log('[SEND] Fallback a found device:', targetId);
        }
      }

      // Renderizar UNA SOLA VEZ como pending
      const pendingMsg = {
        content,
        _own: true,
        timestamp: Date.now(),
        pending: true,
        recipient: targetId,
        messageId,
        source: 'self'
      };
      this._handleMessage(pendingMsg, 'self');

      let sent = false;

      // Si hay targetId y transport BLE, enviar por BLE
      if (targetId && targetTransport === 'ble' && this.bleInterface?.nativePlugin) {
        try {
          await this._sendViaBLE(targetId, content);
          sent = true;
        } catch (e) {
          DEBUG.warn(`BLE directo falló: ${e.message}`, 'MSG_BLE_FAIL');
        }
      }

      // Fallback: Si no hay activeContact pero hay dispositivos BLE conectados, usar el primero
      if (!sent && this.bleInterface?.nativePlugin) {
        try {
          const connectedResult = await this.bleInterface.nativePlugin.getConnectedDevices();
          const bleDevices = connectedResult?.devices || [];
          if (bleDevices.length > 0) {
            const device = bleDevices[0];
            const deviceId = device.deviceId || device.id;
            await this._sendViaBLE(deviceId, content);
            targetId = deviceId;
            sent = true;
          }
        } catch (e) { DEBUG.log(`[BLE_SEND] Fallback falló: ${e.message}`, 'warn', 'BLE_PEER_FAIL'); }
      }

      if (!sent) {
        const nordicPeers = this.nordicMesh?.getPeers?.() || [];
        if (nordicPeers.length > 0) {
          try { await this.nordicMesh.sendMessage(nordicPeers[0].id, content); DEBUG.success(`Sent via Nordic`, 'MSG_NORDIC'); sent = true; }
          catch (e) { DEBUG.error('NORDIC_009', `Send failed: ${e.message}`); }
        }
      }

      if (!sent) {
        if (this.mesh?.getPeerCount?.() > 0) {
          try { await this.mesh.broadcast({ content }); DEBUG.success('Sent via Hybrid', 'MSG_HYBRID'); sent = true; }
          catch (e) { DEBUG.error('MESH_005', `Broadcast failed: ${e.message}`); }
        }
      }

      if (!sent && this.bridge) { 
        const result = await this.bridge.send({ content }); 
        if (result) { DEBUG.success('Sent via Bridge', 'MSG_BRIDGE'); sent = true; } 
      }

      if (!sent && this.wsClient?.isConnected?.()) { 
        this.wsClient.send({ content }); 
        DEBUG.success('Sent via WebSocket', 'MSG_WS'); 
        sent = true; 
      }

      // FIX v5.0.7: Actualizar estado del mensaje existente, NO doble-render
      const finalSource = sent ? 'ble_direct' : 'self';
      if (this.stream && typeof this.stream.updateMessage === 'function') {
        try {
          this.stream.updateMessage(messageId, { pending: !sent, source: finalSource });
        } catch (e) {
          DEBUG.warn(`updateMessage failed: ${e.message}`, 'STREAM_UPDATE_WARN');
        }
      } else {
        // Fallback: re-render con mismo ID (TheStream deduplicará por cache)
        const finalMsg = {
          content,
          _own: true,
          timestamp: Date.now(),
          pending: !sent,
          recipient: targetId,
          source: finalSource,
          messageId
        };
        this._handleMessage(finalMsg, 'self');
      }

      if (!sent) {
        DEBUG.warn('No hay dispositivos NEXO disponibles.', 'MSG_FAIL');
      }
      return sent;
    } catch (err) { 
      DEBUG.error('APP_008', `SendMessage critical: ${err.message}`); 
      return false; 
    }
  }

  _handleMessage(msg, source) {
    if (this._isDestroyed) return;
    try {
      // FIX v5.0.7: Deduplicacion por messageId + fingerprint
      const dedupKey = msg.messageId || msg.fingerprint || `${msg.sender}-${msg.timestamp}-${(msg.content || '').substring(0, 20)}`;
      const now = Date.now();

      if (this._messageDedupMap.has(dedupKey)) {
        const existing = this._messageDedupMap.get(dedupKey);
        // Permitir update de estado (pending -> sent) pero no nuevo render
        if (source === 'self' && msg.pending !== undefined && existing.pending !== msg.pending) {
          // continuar para actualizar
        } else if (source !== 'self') {
          if (source !== 'self') {
            DEBUG.log(`Deduplicado ${dedupKey?.substring?.(0,8)} de ${source}`, 'debug', 'DEDUP');
          }
          return;
        }
      }

      this._messageDedupMap.set(dedupKey, { timestamp: now, pending: msg.pending });

      // Cleanup dedup map
      if (this._messageDedupMap.size > this._maxProcessedIds) {
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [k, v] of this._messageDedupMap) {
          if (v.timestamp < oldestTime) { oldestTime = v.timestamp; oldestKey = k; }
        }
        if (oldestKey) this._messageDedupMap.delete(oldestKey);
      }
      for (const [k, v] of this._messageDedupMap) {
        if (now - v.timestamp > this._dedupTTL) this._messageDedupMap.delete(k);
      }

      const enriched = { ...msg, _source: source, _ts: Date.now(), _id: Math.random().toString(36).substr(2, 9) };
      this.config.onMessage(enriched);

      // FIX v5.0.7: Guard robusto en stream.appendItems
      if (this.stream && typeof this.stream.appendItems === 'function') {
        try {
          this.stream.appendItems([enriched]);
        } catch (streamErr) {
          DEBUG.warn(`Stream append failed: ${streamErr.message}`, 'STREAM_APPEND_WARN');
        }
      }
    } catch (err) { DEBUG.error('APP_005', `Message handler: ${err.message}`); }
  }

  async _partialCleanup() {
    if (this.nordicMesh) { try { await this.nordicMesh.destroy?.(); } catch(e) {} this.nordicMesh = null; }
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { this.wsClient.disconnect?.(); } catch(e) {} this.wsClient = null; }
  }

  async destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    DEBUG.log('🧹 Cleanup...', 'info', 'DESTROY');
    if (this._bleChatHandler) { window.removeEventListener('nexo:ble:openChat', this._bleChatHandler); this._bleChatHandler = null; }
    if (this._bleMessageHandler) { window.removeEventListener('nexo:ble:messageReceived', this._bleMessageHandler); this._bleMessageHandler = null; }
    if (this.bleInterface) { try { this.bleInterface.destroy(); } catch(e) {} this.bleInterface = null; }
    if (this.nordicMesh) { this._resources.handlers.forEach(unsub => { try { unsub(); } catch(e) {} }); try { await this.nordicMesh.destroy?.(); } catch(e) {} this.nordicMesh = null; }
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { this.wsClient.disconnect?.(); } catch(e) {} this.wsClient = null; }
    if (this.vault) { try { this.vault.destroy?.(); } catch(e) {} this.vault = null; }
    this._resources.timers.forEach(t => clearTimeout(t));
    DEBUG.success('Cleanup complete', 'DESTROY_OK');
  }

  getStatus() {
    return {
      initialized: this.initialized,
      mode: this.mesh?.getStatus?.().mode || (this.nordicMesh?.getState?.() === 'messaging' ? 'p2p_ble' : 'offline'),
      hasBLEInterface: !!this.bleInterface,
      activeContact: this.activeContact ? { name: this.activeContact.name, transport: this.activeContact.transport } : null
    };
  }
}

export default NexoApp;
export { DEBUG };
