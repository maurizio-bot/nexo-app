/**
 * NEXO App v5.0.8-ARCH
 * FIX v5.0.8-ARCH:
 *   1) Dedup GLOBAL por contenido+sender (ignora fuente: Nordic/Native/Hybrid)
 *   2) Mapa persistente _contactNameMap con localStorage: MAC → nombre
 *   3) _bleMessageHandler y _handleNordicMessage usan el mismo nombre anclado
 *   4) TTL de 10s para dedup por contenido (permite reenvío intencional después)
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
    this._bleFpSet = new Set();
    this._bleFpMax = 500;
    
    // FIX v5.0.8: Dedup global por contenido+sender (cualquier fuente)
    this._contentFpMap = new Map();
    this._contentFpTTL = 10000; // 10 segundos
    this._contentFpMax = 500;
    
    // FIX v5.0.8: Mapa persistente MAC → nombre
    this._contactNameMap = new Map();
    this._loadContactNames();
    
    DEBUG.log('🚀 [NEXO] v5.0.8-ARCH iniciando...', 'info', 'APP_INIT');
  }

  // FIX v5.0.8: Cargar nombres de contacto desde localStorage
  _loadContactNames() {
    try {
      const saved = localStorage.getItem('nexo_contact_names');
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.entries(parsed).forEach(([k, v]) => this._contactNameMap.set(k, v));
        DEBUG.log(`Nombres cargados: ${this._contactNameMap.size}`, 'info', 'CONTACT_LOAD');
      }
    } catch (e) {
      DEBUG.warn('No se pudieron cargar nombres de contacto', 'CONTACT_LOAD_FAIL');
    }
  }

  // FIX v5.0.8: Guardar nombres de contacto en localStorage
  _saveContactNames() {
    try {
      const obj = Object.fromEntries(this._contactNameMap);
      localStorage.setItem('nexo_contact_names', JSON.stringify(obj));
    } catch (e) {
      DEBUG.warn('No se pudieron guardar nombres', 'CONTACT_SAVE_FAIL');
    }
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
      DEBUG.success('🎉 NEXO v5.0.8-ARCH Ready', 'APP_READY');
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
      if (this.bleInterface) DEBUG.success('BLE UI ready' + (meshInstance ? '' : ' (native)'), 'UI_002');

      this._bleChatHandler = (e) => {
        const { contactId, name, address, transport } = e.detail;
        this.activeContact = { id: contactId, name, address, transport };
        
        // FIX v5.0.8: Guardar nombre al abrir chat
        const nid = (contactId || '').toString().toLowerCase().trim().replace(/[^a-f0-9]/g, '');
        if (nid && name && name !== 'NEXO Peer') {
          this._contactNameMap.set(nid, name);
          this._saveContactNames();
        }
        
        const appContainer = document.getElementById('app');
        if (appContainer) appContainer.classList.remove('hidden');
        const nameInput = document.getElementById('chat-contact-name');
        const subtitle = document.getElementById('chat-contact-subtitle');
        if (nameInput) nameInput.value = name || 'NEXO Device';
        if (subtitle) subtitle.textContent = transport === 'ble' ? 'BLUETOOTH' : 'NEXO MESH';
        DEBUG.success(`💬 Chat activo: ${name} [${transport.toUpperCase()}]`, 'BLE_CHAT');
        this._updateMode('P2P_BLE');
        this.config.onStatusChange(`CHAT:${name}`);
        if (this.stream) {
          this.stream.scrollToBottom();
        }
      };
      window.addEventListener('nexo:ble:openChat', this._bleChatHandler);

      this._bleMessageHandler = (e) => {
        const { deviceId, content, senderName, messageId, source, timestamp } = e.detail;
        const nid = (deviceId || '').toString().toLowerCase().trim().replace(/[^a-f0-9]/g, '');
        
        // FIX v5.0.8: Fingerprint BLE nativo
        const contentSnippet = (content || '').substring(0, 32);
        const fp = `ble_${nid}_${(content || '').length}_${contentSnippet}`;
        
        if (this._bleFpSet.has(fp)) return;
        this._bleFpSet.add(fp);
        if (this._bleFpSet.size > this._bleFpMax) {
          const first = this._bleFpSet.values().next().value;
          this._bleFpSet.delete(first);
        }
        
        console.log(`[BLE_RECV] Mensaje de ${senderName}: ${content?.substring?.(0,30) || ''}...`);
        
        // FIX v5.0.8: Resolver nombre con prioridad: mapa persistente > bleInterface > fallback
        let resolvedName = senderName;
        
        // 1. Mapa persistente local (más confiable)
        if (this._contactNameMap.has(nid)) {
          resolvedName = this._contactNameMap.get(nid);
        }
        // 2. bleInterface si existe
        else if (this.bleInterface && typeof this.bleInterface.getContactName === 'function') {
          const persisted = this.bleInterface.getContactName(nid);
          if (persisted) resolvedName = persisted;
        }
        // 3. Maps de dispositivos conectados/encontrados
        if (!resolvedName || resolvedName === 'NEXO Peer') {
          const mapName = (dev) => dev?.name;
          resolvedName = mapName(this.bleInterface?.connectedDevices?.get(nid))
            || mapName(this.bleInterface?.foundDevices?.get(nid))
            || senderName
            || 'NEXO Peer';
        }
        // 4. Fallback generado
        if (!resolvedName || resolvedName === 'NEXO Peer') {
          resolvedName = `NEXO-${nid.substring(0, 6).toUpperCase()}`;
        }
        
        // FIX v5.0.8: Guardar nombre la primera vez que lo vemos
        if (!this._contactNameMap.has(nid) && resolvedName && resolvedName !== 'NEXO Peer') {
          this._contactNameMap.set(nid, resolvedName);
          this._saveContactNames();
        }
        
        this._handleMessage({
          content,
          sender: nid,
          senderName: resolvedName,
          source: source || 'ble_direct',
          timestamp: timestamp || Date.now(),
          messageId: messageId || fp,
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
    if (container) { try { this.stream = new TheStream(container, {}); } catch (e) {} }
  }

  _handleNordicPeer(peer) { if (!peer?.id) return; this.blePeers.set(peer.id, { ...peer, discoveredAt: Date.now() }); }
  _handleNordicSession(data) { if (!data?.deviceId) return; this._updateMode('P2P_BLE'); }
  
  // FIX v5.0.8: NordicMessage ahora también usa _contactNameMap y dedup global
  _handleNordicMessage(msg) {
    if (!msg?.deviceId) return;
    const nid = (msg.deviceId || '').toString().toLowerCase().trim().replace(/[^a-f0-9]/g, '');
    
    // Resolver nombre anclado
    let resolvedName = this._contactNameMap.get(nid);
    if (!resolvedName) {
      resolvedName = msg.senderName || `NEXO-${nid.substring(0, 6).toUpperCase()}`;
      if (resolvedName && resolvedName !== 'NEXO Peer') {
        this._contactNameMap.set(nid, resolvedName);
        this._saveContactNames();
      }
    }
    
    this._handleMessage({
      content: msg.content,
      sender: nid,
      senderName: resolvedName,
      source: 'ble_nordic',
      timestamp: msg.timestamp || Date.now(),
      messageId: msg.messageId || null,
      _own: false
    }, 'ble_nordic');
  }
  
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
    console.log(`[BLE_SEND] Enviando a ${deviceId?.substring?.(0,8)}...`);
    try {
      await plugin.sendMessage({ deviceId, message: content });
      DEBUG.success(`📨 Enviado via BLE a ${deviceId?.substring?.(0,8)}`, 'MSG_BLE');
    } catch (e) {
      DEBUG.error('BLE_SEND_FAIL', `Envio fallo: ${e.message}`);
      throw e;
    }
  }

  async sendMessage(msg) {
    if (!this.initialized || this._isDestroyed) {
      DEBUG.error(this._isDestroyed ? 'APP_022' : 'APP_021', 'Cannot send');
      return false;
    }
    try {
      const myIdentity = this.vault?.getIdentity?.();
      const myName = myIdentity?.name || myIdentity?.displayName || 'NEXO Peer';
      const messageId = msg.messageId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this._handleMessage({ ...msg, senderName: myName, _own: true, timestamp: Date.now(), pending: true, messageId }, 'self');

      const isObject = msg && typeof msg === 'object';
      const content = isObject ? (msg.content || msg) : msg;
      const recipient = isObject ? msg.recipient : null;
      const targetId = recipient || this.activeContact?.id;
      const targetTransport = this.activeContact?.transport;

      if (targetId && targetTransport === 'ble' && this.bleInterface?.nativePlugin) {
        try {
          await this._sendViaBLE(targetId, content);
          this._handleMessage({ content, senderName: myName, _own: true, timestamp: Date.now(), pending: false, recipient: targetId, source: 'ble_direct', messageId }, 'self');
          return true;
        } catch (e) {
          DEBUG.warn(`BLE directo fallo: ${e.message}`, 'MSG_BLE_FAIL');
        }
      }

      if (this.bleInterface?.nativePlugin) {
        try {
          const connectedResult = await this.bleInterface.nativePlugin.getConnectedDevices();
          const bleDevices = connectedResult?.devices || [];
          if (bleDevices.length > 0) {
            await this._sendViaBLE(bleDevices[0].deviceId || bleDevices[0].id, content);
            this._handleMessage({ content, senderName: myName, _own: true, timestamp: Date.now(), pending: false, recipient: bleDevices[0].deviceId, source: 'ble_direct', messageId }, 'self');
            return true;
          }
        } catch (e) { DEBUG.log(`[BLE_SEND] Fallback fallo: ${e.message}`, 'warn', 'BLE_PEER_FAIL'); }
      }

      const nordicPeers = this.nordicMesh?.getPeers?.() || [];
      if (nordicPeers.length > 0) {
        try { await this.nordicMesh.sendMessage(nordicPeers[0].id, content); DEBUG.success(`Sent via Nordic`, 'MSG_NORDIC'); return true; }
        catch (e) { DEBUG.error('NORDIC_009', `Send failed: ${e.message}`); }
      }

      if (this.mesh?.getPeerCount?.() > 0) {
        try { await this.mesh.broadcast({ content }); DEBUG.success('Sent via Hybrid', 'MSG_HYBRID'); return true; }
        catch (e) { DEBUG.error('MESH_005', `Broadcast failed: ${e.message}`); }
      }

      if (this.bridge) { const result = await this.bridge.send({ content }); if (result) { DEBUG.success('Sent via Bridge', 'MSG_BRIDGE'); return true; } }

      if (this.wsClient?.isConnected?.()) { this.wsClient.send({ content }); DEBUG.success('Sent via WebSocket', 'MSG_WS'); return true; }

      DEBUG.warn('No hay dispositivos NEXO disponibles.', 'MSG_FAIL');
      return false;
    } catch (err) { DEBUG.error('APP_008', `SendMessage critical: ${err.message}`); return false; }
  }

  _handleMessage(msg, source) {
    if (this._isDestroyed) return;
    try {
      const dedupId = msg.messageId || `gen_${msg.sender}_${(msg.content || '').length}_${(msg.content || '').substring(0, 32)}`;
      const now = Date.now();
      
      // FIX v5.0.8: Dedup GLOBAL por contenido+sender (cualquier fuente: Nordic/Native/Hybrid)
      if (!msg._own) {
        const contentFp = `${msg.sender}_${(msg.content || '').length}_${(msg.content || '').substring(0, 32)}`;
        const lastSeen = this._contentFpMap.get(contentFp);
        if (lastSeen && (now - lastSeen < this._contentFpTTL)) {
          DEBUG.log(`Deduplicado por contenido ${contentFp.substring(0,20)} de ${source}`, 'debug', 'DEDUP_CONTENT');
          return;
        }
        this._contentFpMap.set(contentFp, now);
        // Limpiar antiguos
        if (this._contentFpMap.size > this._contentFpMax) {
          let oldestKey = null;
          let oldestTime = Infinity;
          for (const [k, v] of this._contentFpMap) {
            if (v < oldestTime) { oldestTime = v; oldestKey = k; }
          }
          if (oldestKey) this._contentFpMap.delete(oldestKey);
        }
        for (const [k, v] of this._contentFpMap) {
          if (now - v > this._contentFpTTL * 3) this._contentFpMap.delete(k);
        }
      }
      
      if (this._messageDedupMap.has(dedupId)) {
        if (msg._own && msg.pending === false) {
          const existingMsg = document.querySelector(`[data-message-id="${dedupId}"]`);
          if (existingMsg) {
            existingMsg.classList.remove('pending');
            existingMsg.classList.add('confirmed');
            const pendingIndicator = existingMsg.querySelector('.pending-indicator');
            if (pendingIndicator) pendingIndicator.remove();
          }
          this._messageDedupMap.set(dedupId, now);
          return;
        }
        
        if (source !== 'self') {
          DEBUG.log(`Deduplicado ${dedupId.substring(0,8)} de ${source}`, 'debug', 'DEDUP');
        }
        return;
      }
      
      this._messageDedupMap.set(dedupId, now);
      if (this._messageDedupMap.size > this._maxProcessedIds) {
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [k, v] of this._messageDedupMap) {
          if (v < oldestTime) { oldestTime = v; oldestKey = k; }
        }
        if (oldestKey) this._messageDedupMap.delete(oldestKey);
      }
      for (const [k, v] of this._messageDedupMap) {
        if (now - v > this._dedupTTL) this._messageDedupMap.delete(k);
      }
      
      const enriched = { ...msg, _source: source, _ts: Date.now(), _id: Math.random().toString(36).substr(2, 9) };
      this.config.onMessage(enriched);
      
      if (this.stream?.appendItems) {
        this.stream.appendItems([enriched], { forceScroll: true });
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
