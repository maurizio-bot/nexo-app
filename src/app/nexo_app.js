/**
 * NEXO App v3.3.3-NAP
 * Orquestador Principal - NAP 2.0 Certified
 * FIXES: 
 * - CryptoVault.init() (no initialize())
 * - HybridMesh.on() defensive check
 * - Interface Contract NordicMesh
 * + INTEGRATION v3.3.2: BLE Chat directo (activeContact + _sendViaBLE)
 * + v3.3.3-NAP: MessageTracker + ACK automático + Read receipts #00e676 + Conexión BLE robusta
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

// v3.3.3-NAP: Message Tracker + Read Receipts
const MESSAGE_STATES = {
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read'
};

class MessageTracker {
  constructor() {
    this.messages = new Map();
  }
  
  track(id, state = MESSAGE_STATES.PENDING, meta = {}) {
    this.messages.set(id, { state, timestamp: Date.now(), ...meta });
  }
  
  update(id, state) {
    const msg = this.messages.get(id);
    if (msg) {
      msg.state = state;
      msg[`${state}At`] = Date.now();
      this.messages.set(id, msg);
      return msg;
    }
    return null;
  }
  
  get(id) {
    return this.messages.get(id);
  }
}

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
    
    // v3.3.3-NAP
    this.messageTracker = new MessageTracker();
    this.receivedMessages = new Map(); // contactId -> Array<{msgId, timestamp, read}>
    this._receiptObserver = null;
    
    DEBUG.log('🚀 [NEXO] v3.3.3-NAP iniciando...', 'info', 'APP_INIT');
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
      DEBUG.success('🎉 NEXO v3.3.3-NAP Ready', 'APP_READY');
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
      this._bleChatHandler = (e) => {
        const { contactId, name, address, transport } = e.detail;
        this.activeContact = { id: contactId, name, address, transport };
        const appContainer = document.getElementById('app');
        if (appContainer) appContainer.classList.remove('hidden');
        const nameInput = document.getElementById('chat-contact-name');
        const subtitle = document.getElementById('chat-contact-subtitle');
        if (nameInput) nameInput.value = name || 'NEXO Device';
        if (subtitle) subtitle.textContent = transport === 'ble' ? 'BLUETOOTH' : 'NEXO MESH';
        DEBUG.success(`💬 Chat activo: ${name} [${transport.toUpperCase()}]`, 'BLE_CHAT');
        this.config.onStatusChange(`CHAT:${name}`);
        
        // v3.3.3-NAP: Enviar read ACKs para mensajes recibidos de este contacto
        setTimeout(() => this._sendPendingReadAcks(contactId), 600);
      };
      window.addEventListener('nexo:ble:openChat', this._bleChatHandler);
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
    
    // v3.3.3-NAP: Inyectar CSS de read receipts y observer
    this._injectReceiptStyles();
    this._initReceiptObserver();
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

  // v3.3.3-NAP: Conexión BLE robusta con verificación + tracking
  async _sendViaBLE(deviceId, content, msgId) {
    const plugin = this.bleInterface?.nativePlugin;
    if (!plugin) throw new Error('Plugin NexoBLE no disponible');
    
    this.messageTracker.track(msgId, MESSAGE_STATES.PENDING, { deviceId, content });
    
    // Verificar conexión existente
    let isConnected = false;
    try {
      const result = await plugin.getConnectedDevices?.();
      isConnected = result?.devices?.some(d => 
        d.deviceId === deviceId || d.id === deviceId || d.address === deviceId
      );
    } catch (e) {
      console.warn('[NexoApp] Error checking connected devices:', e);
    }
    
    // Conectar si es necesario con retry y delay de descubrimiento GATT
    if (!isConnected) {
      console.log('[NexoApp] BLE no conectado, iniciando conexión robusta...');
      try {
        await withTimeoutNAP(plugin.connectToDevice({ deviceId }), 15000, 'BLE.connect');
        // CRÍTICO: esperar descubrimiento GATT + MTU negotiation
        await new Promise(r => setTimeout(r, 1200));
      } catch (e) {
        throw new Error(`BLE_011: Connection failed - ${e.message}`);
      }
      
      // Verificar que realmente esté conectado
      try {
        const verify = await plugin.getConnectedDevices?.();
        isConnected = verify?.devices?.some(d => 
          d.deviceId === deviceId || d.id === deviceId || d.address === deviceId
        );
      } catch (e) {}
      
      if (!isConnected) {
        throw new Error('BLE_011: Race condition - device not in connected list after connect');
      }
    }
    
    // Enviar con timeout
    await withTimeoutNAP(plugin.sendMessage({ deviceId, message: content }), 10000, 'BLE.send');
    this.messageTracker.update(msgId, MESSAGE_STATES.SENT);
  }

  async sendMessage(msg) {
    if (!this.initialized || this._isDestroyed) {
      DEBUG.error(this._isDestroyed ? 'APP_022' : 'APP_021', 'Cannot send message');
      return false;
    }
    try {
      const isObject = msg && typeof msg === 'object';
      const content = isObject ? (msg.content || msg) : msg;
      const recipient = isObject ? msg.recipient : null;
      const targetId = recipient || this.activeContact?.id;
      const targetTransport = this.activeContact?.transport;
      
      // v3.3.3-NAP: Generar ID único y trackear desde pending
      const msgId = 'msg_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
      this.messageTracker.track(msgId, MESSAGE_STATES.PENDING, { 
        content, recipient: targetId, transport: targetTransport, timestamp: Date.now() 
      });
      
      // Renderizar inmediatamente como pending
      this._handleMessage({ 
        content, 
        _own: true, 
        timestamp: Date.now(), 
        pending: true, 
        msgId, 
        state: MESSAGE_STATES.PENDING,
        recipient: targetId,
        source: 'self'
      }, 'self');

      // Intentar BLE directo primero si hay contacto activo BLE
      if (targetId && targetTransport === 'ble' && this.bleInterface?.nativePlugin) {
        try {
          await this._sendViaBLE(targetId, content, msgId);
          this.messageTracker.update(msgId, MESSAGE_STATES.SENT);
          this._updateMessageReceiptUI(msgId);
          return true;
        } catch (e) {
          DEBUG.warn(`BLE directo falló: ${e.message}`, 'MSG_BLE_FAIL');
        }
      }

      // Fallback Nordic
      const nordicPeers = this.nordicMesh?.getPeers?.() || [];
      if (nordicPeers.length > 0) {
        try {
          await this.nordicMesh.sendMessage(nordicPeers[0].id, content);
          this.messageTracker.update(msgId, MESSAGE_STATES.SENT);
          this._updateMessageReceiptUI(msgId);
          DEBUG.success(`Sent via Nordic to ${nordicPeers[0].id.substr(0,8)}`, 'MSG_NORDIC');
          return true;
        } catch (e) {
          DEBUG.error('NORDIC_009', `Send failed: ${e.message}`);
        }
      }
      
      // Fallback Hybrid
      if (this.mesh?.getPeerCount?.() > 0) {
        try {
          await this.mesh.broadcast({ content });
          this.messageTracker.update(msgId, MESSAGE_STATES.SENT);
          this._updateMessageReceiptUI(msgId);
          DEBUG.success('Sent via Hybrid', 'MSG_HYBRID');
          return true;
        } catch (e) {
          DEBUG.error('MESH_005', `Broadcast failed: ${e.message}`);
        }
      }
      
      // Fallback Bridge
      if (this.bridge) {
        const result = await this.bridge.send({ content });
        if (result) {
          this.messageTracker.update(msgId, MESSAGE_STATES.SENT);
          this._updateMessageReceiptUI(msgId);
          DEBUG.success('Sent via Bridge', 'MSG_BRIDGE');
          return true;
        }
      }
      
      // Fallback WebSocket
      if (this.wsClient?.isConnected?.()) {
        this.wsClient.send({ content });
        this.messageTracker.update(msgId, MESSAGE_STATES.SENT);
        this._updateMessageReceiptUI(msgId);
        DEBUG.success('Sent via WebSocket', 'MSG_WS');
        return true;
      }
      
      DEBUG.warn('No transport available', 'MSG_FAIL');
      return false;
    } catch (err) {
      DEBUG.error('APP_008', `SendMessage critical: ${err.message}`);
      return false;
    }
  }

  _handleMessage(msg, source) {
    if (this._isDestroyed) return;
    try {
      // v3.3.3-NAP: Detectar ACKs entrantes
      if (msg.content && typeof msg.content === 'string') {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed && parsed.type === 'nexo_ack' && parsed.msgId) {
            const newState = parsed.ackType === 'read' ? MESSAGE_STATES.READ : MESSAGE_STATES.DELIVERED;
            this.messageTracker.update(parsed.msgId, newState);
            this._updateMessageReceiptUI(parsed.msgId);
            DEBUG.log(`ACK ${parsed.ackType} recibido para ${parsed.msgId}`, 'info', 'ACK_RX');
            return;
          }
        } catch (e) {
          // No es JSON, mensaje normal
        }
      }
      
      const enriched = { 
        ...msg, 
        _source: source, 
        _ts: Date.now(), 
        _id: msg.msgId || Math.random().toString(36).substr(2, 9) 
      };
      
      // v3.3.3-NAP: Auto-ACK delivered para mensajes BLE recibidos
      if (!msg._own && (source === 'ble_nordic' || source === 'ble_direct')) {
        const senderId = msg.sender || msg.deviceId;
        const originalMsgId = msg.msgId || msg._id;
        if (senderId && originalMsgId) {
          // Guardar en receivedMessages para posible read ACK posterior
          const list = this.receivedMessages.get(senderId) || [];
          if (!list.some(m => m.msgId === originalMsgId)) {
            list.push({ msgId: originalMsgId, timestamp: msg.timestamp || Date.now(), read: false });
            this.receivedMessages.set(senderId, list);
          }
          // Enviar ACK delivered con pequeño delay para no saturar
          setTimeout(() => this._sendBleAck(originalMsgId, 'delivered', senderId), 400);
        }
      }
      
      this.config.onMessage(enriched);
      if (this.stream?.appendItems) this.stream.appendItems([enriched]);
      
      // Actualizar UI para mensajes propios
      if (msg._own && msg.msgId) {
        setTimeout(() => this._updateMessageReceiptUI(msg.msgId), 150);
      }
    } catch (err) {
      DEBUG.error('APP_005', `Message handler: ${err.message}`);
    }
  }

  // v3.3.3-NAP: Enviar ACK por BLE (sin tracking, para evitar loops)
  async _sendBleAck(originalMsgId, ackType, recipientId) {
    if (!recipientId || !this.bleInterface?.nativePlugin) return;
    try {
      const ackPayload = JSON.stringify({ 
        type: 'nexo_ack', 
        ackType, 
        msgId: originalMsgId,
        timestamp: Date.now() 
      });
      await this.bleInterface.nativePlugin.sendMessage({ 
        deviceId: recipientId, 
        message: ackPayload 
      });
      DEBUG.log(`ACK ${ackType} enviado → ${recipientId.substr(0,8)}`, 'info', 'ACK_TX');
    } catch (e) {
      console.warn('[NexoApp] ACK send failed:', e);
    }
  }

  // v3.3.3-NAP: Enviar read ACKs pendientes al abrir chat con un contacto
  _sendPendingReadAcks(contactId) {
    const list = this.receivedMessages.get(contactId) || [];
    let sentCount = 0;
    list.forEach(m => {
      if (!m.read) {
        this._sendBleAck(m.msgId, 'read', contactId);
        m.read = true;
        sentCount++;
      }
    });
    if (sentCount > 0) {
      DEBUG.log(`${sentCount} read ACKs sent to ${contactId.substr(0,8)}`, 'info', 'ACK_READ');
    }
  }

  // v3.3.3-NAP: CSS inyectado para read receipts #00e676
  _injectReceiptStyles() {
    if (document.getElementById('nexo-receipt-styles')) return;
    const style = document.createElement('style');
    style.id = 'nexo-receipt-styles';
    style.textContent = `
      .msg-receipt { display: inline-block; margin-left: 4px; font-size: 13px; font-weight: bold; transition: all 0.3s ease; line-height: 1; }
      .msg-receipt.state-pending { color: #888; opacity: 0.5; font-size: 10px; }
      .msg-receipt.state-sent { color: #bbbbbb; }
      .msg-receipt.state-delivered { color: #00d4ff; letter-spacing: -1px; }
      .msg-receipt.state-read { color: #00e676 !important; letter-spacing: -1px; }
      .message-bubble[data-state="read"] .msg-receipt, .msg-sent[data-state="read"] .msg-receipt { color: #00e676 !important; }
    `;
    document.head.appendChild(style);
  }

  // v3.3.3-NAP: Observer para inyectar receipts en burbujas nuevas
  _initReceiptObserver() {
    const container = document.getElementById('messages-container');
    if (!container || this._receiptObserver) return;
    
    this._receiptObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            const bubbles = node.matches?.('.message-bubble, .msg-sent, .message-own, [data-msg-id]') 
              ? [node] 
              : node.querySelectorAll?.('.message-bubble, .msg-sent, .message-own, [data-msg-id]');
            if (bubbles) {
              bubbles.forEach(bubble => this._injectReceiptToBubble(bubble));
            }
          }
        });
      });
    });
    
    this._receiptObserver.observe(container, { childList: true, subtree: true });
  }

  _injectReceiptToBubble(bubble) {
    if (bubble.querySelector('.msg-receipt')) return;
    
    const msgId = bubble.getAttribute('data-msg-id');
    let state = MESSAGE_STATES.PENDING;
    if (msgId && this.messageTracker) {
      const tracked = this.messageTracker.get(msgId);
      if (tracked) state = tracked.state;
    }
    
    const receipt = document.createElement('span');
    receipt.className = `msg-receipt state-${state}`;
    receipt.textContent = this._getReceiptIcon(state);
    receipt.style.marginLeft = '6px';
    
    const timeEl = bubble.querySelector('.message-time, .msg-time, .timestamp, [class*="time"]');
    if (timeEl) {
      timeEl.appendChild(receipt);
    } else {
      bubble.appendChild(receipt);
    }
    
    bubble.setAttribute('data-state', state);
  }

  _updateMessageReceiptUI(msgId) {
    const bubbles = document.querySelectorAll(`[data-msg-id="${msgId}"]`);
    bubbles.forEach(bubble => {
      const receipt = bubble.querySelector('.msg-receipt');
      const state = this.messageTracker.get(msgId)?.state || MESSAGE_STATES.PENDING;
      bubble.setAttribute('data-state', state);
      if (receipt) {
        receipt.className = `msg-receipt state-${state}`;
        receipt.textContent = this._getReceiptIcon(state);
      } else {
        this._injectReceiptToBubble(bubble);
      }
    });
  }

  _getReceiptIcon(state) {
    switch(state) {
      case MESSAGE_STATES.PENDING: return '⏳';
      case MESSAGE_STATES.SENT: return '✓';
      case MESSAGE_STATES.DELIVERED: return '✓✓';
      case MESSAGE_STATES.READ: return '✓✓';
      default: return '';
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
    if (this._receiptObserver) {
      this._receiptObserver.disconnect();
      this._receiptObserver = null;
    }
    if (this._bleChatHandler) {
      window.removeEventListener('nexo:ble:openChat', this._bleChatHandler);
      this._bleChatHandler = null;
    }
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
      activeContact: this.activeContact ? { name: this.activeContact.name, transport: this.activeContact.transport } : null
    };
  }
}

export default NexoApp;
export { DEBUG };
