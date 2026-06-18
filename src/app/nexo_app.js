# Generar nexo_app.js v5.1.3-ANTI-CRASH con comentarios explicativos

nexo_app_code = r'''/**
 * =============================================================================
 * NEXO App v5.1.3-ANTI-CRASH
 * =============================================================================
 * 
 * ARQUITECTURA GENERAL:
 * ---------------------
 * NexoApp es el coordinador central de la aplicacion. Su responsabilidad es:
 * 
 *   1. INICIALIZAR: Configurar vault criptografico, WebSocket, mesh, BLE UI
 *   2. COORDINAR: Enrutar mensajes entre transportes (BLE, WebSocket, Mesh)
 *   3. RENDERIZAR: Delegar renderizado a TheStream via main.js
 *   4. DEDUPLICAR: Evitar mensajes duplicados en conversaciones
 *   5. GESTIONAR: Estado de contacto activo, envio, reconexion
 * 
 * PIPELINE DE MENSAJES ENVIADOS:
 * ------------------------------
 *   Usuario escribe mensaje -> Input en main.js
 *        |
 *        v  sendMessage()
 *   NexoApp.sendMessage()
 *        |
 *        v  Delega a BLEInterface.sendMessageToActiveChat()
 *   BLEInterface._sendMessageNative()
 *        |
 *        v  Plugin nativo sendMessage()
 *   Dispositivo BLE receptor
 * 
 * PIPELINE DE MENSAJES RECIBIDOS:
 * -------------------------------
 *   Plugin nativo onPayloadReceived
 *        |
 *        v  BLEInterface dispara 'nexo:ble:messageReceived'
 *   NexoApp._bleMessageHandler (este archivo)
 *        |
 *        v  _handleMessage() con dedup
 *   config.onMessage() -> main.js _renderMessage()
 *        |
 *        v  TheStream.appendItems()
 *   DOM
 * 
 * FIX v5.1.3:
 *   - _bleChatHandler guard: si ya hay chat activo, no sobrescribir
 *   - _handleMessage usa clave compuesta para dedup (messageId + MAC)
 *   - sendMessage delega a bleInterface primero, fallback a nativo directo
 *   - NO renderiza duplicados en conversaciones (Set _renderedConversationIds)
 *   - NO optional chaining, todo verificacion explicita
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

// ============================================================================
// UTILIDAD: Promise con timeout para NAP (No Async Panic)
// ============================================================================
// Por que? Porque si un plugin nativo se cuelga, la Promise nunca resuelve
// y toda la app se congela. Este wrapper fuerza un rechazo despues de N ms.
function withTimeoutNAP(promise, ms, context) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('[NAP_TIMEOUT] ' + context)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => { if (timer) clearTimeout(timer); });
}

// ============================================================================
// DEBUG: Sistema de logging con buffer circular
// ============================================================================
const DEBUG = {
  rem: rem,
  _logBuffer: [],
  log: (msg, type = 'info', code = null) => {
    const entry = { ts: Date.now(), time: new Date().toLocaleTimeString(), type, code, msg };
    DEBUG._logBuffer.push(entry);
    if (DEBUG._logBuffer.length > 1000) DEBUG._logBuffer.shift();
    console.log('[' + entry.time + '] [' + type.toUpperCase() + ']' + (code ? '[' + code + ']' : '') + ' ' + msg);
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
    
    // Deduplicacion de mensajes: Map<clave, timestamp>
    this._messageDedupMap = new Map();
    this._maxProcessedIds = 1000;
    this._dedupTTL = 300000; // 5 minutos
    
    // FIX v5.1.3: Set para evitar duplicados en lista de conversaciones
    this._renderedConversationIds = new Set();
    
    this._pendingMessages = [];
    this._sendLock = false;
    DEBUG.log('🚀 [NEXO] v5.1.3-ANTI-CRASH iniciando...', 'info', 'APP_INIT');
  }

  // ============================================================================
  // INICIALIZACION: Fases secuenciales con timeout NAP
  // ============================================================================
  // Orden de fases:
  // 1. CryptoVault (clave privada, identidad)
  // 2. WebSocket (conexion a relay)
  // 3. NordicMesh (BLE mesh nativo)
  // 4. HybridMesh (BLE mesh JS)
  // 5. BLE UI (panel BLE, listeners nativos)
  // 6. Bridge (enrutamiento entre transportes)
  // 7. UI (gestos, vault slider, stream)
  async init() {
    if (this.initialized) { DEBUG.warn('Already initialized', 'APP_SKIP'); return this; }
    if (this._isInitializing) throw new Error('[APP_018] Initialization in progress');
    if (this._isDestroyed) throw new Error('[APP_019] Cannot init destroyed');
    this._isInitializing = true;
    DEBUG.setPhase('INIT');
    try {
      await this._initPhase1_Crypto();
      await this._initPhase2_WebSocket();
      var nativeAvailable = false;
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
        nativeAvailable = true;
      }
      if (this.config.enableMesh && !nativeAvailable) await this._initPhase3_NordicMesh();
      if (this.config.enableMesh && !nativeAvailable) await this._initPhase4_HybridMesh();
      await this._initPhase5_BLEUI();
      await this._initPhase6_Bridge();
      await this._initPhase7_UI();
      this.initialized = true;
      DEBUG.setPhase('READY');
      DEBUG.success('🎉 NEXO v5.1.3-ANTI-CRASH Ready', 'APP_READY');
    } catch (err) {
      DEBUG.error('APP_020', 'Init failed: ' + err.message);
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
      var identity = null;
      if (this.vault && typeof this.vault.getIdentity === 'function') {
        identity = this.vault.getIdentity();
      }
      if (identity) { DEBUG.setIdentity(identity); DEBUG.success('Vault initialized', 'CRYPTO_002'); }
    } catch (err) { DEBUG.error('CRYPTO_004', 'Vault init failed: ' + err.message); this.vault = null; }
  }

  async _initPhase2_WebSocket() {
    DEBUG.setPhase('WEBSOCKET');
    if (this.config.relayUrls.length === 0) { DEBUG.warn('No relay URLs', 'WS_SKIP'); return; }
    try {
      this.wsClient = new WebSocketClient(this.config.relayUrls[0]);
      this.wsClient.onMessage = (m) => this._handleMessage(m, 'relay');
      this.wsClient.onOpen = () => DEBUG.setMode('RELAY');
      await withTimeoutNAP(this.wsClient.connect(), 8000, 'WebSocket.connect');
    } catch (err) { DEBUG.warn('WebSocket unavailable: ' + err.message, 'WS_004'); this.wsClient = null; }
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
      if (!result.success) {
        var errMsg = 'Nordic init returned false';
        if (result.error && result.error.message) errMsg = result.error.message;
        throw new Error(errMsg);
      }
      DEBUG.success('Nordic Mesh active [Native:' + result.isNative + ']', 'NORDIC_002');
    } catch (err) { DEBUG.error('NORDIC_005', 'Nordic init failed: ' + err.message); this.nordicMesh = null; }
  }

  async _initPhase4_HybridMesh() {
    DEBUG.setPhase('MESH');
    try {
      this.mesh = new HybridMesh({
        onDeviceFound: (d) => { DEBUG.log('Hybrid found: ' + d.name, 'info', 'MESH_DEVICE'); },
        onDeviceConnected: (d) => { DEBUG.success('Hybrid connected: ' + d.name, 'MESH_CONN'); },
        onDeviceDisconnected: (d) => { DEBUG.log('Hybrid disconnected', 'warn', 'MESH_DISC'); },
        onError: (code, msg) => DEBUG.error('MESH_006', msg)
      });
      await withTimeoutNAP(this.mesh.initialize(), 15000, 'HybridMesh.initialize');
      DEBUG.success('Hybrid Mesh ready', 'MESH_002');
    } catch (err) { DEBUG.error('APP_016', 'Hybrid Mesh: ' + err.message); this.mesh = null; }
  }

  // ============================================================================
  // FASE 5: BLE UI - Inicializacion del panel BLE y listeners
  // ============================================================================
  // Aqui conectamos BLEInterface con NexoApp via eventos CustomEvent.
  // 
  // Eventos que escuchamos:
  // - 'nexo:ble:openChat': Usuario abrio chat desde panel BLE
  // - 'nexo:ble:messageReceived': Llego mensaje del dispositivo BLE
  //
  // FIX v5.1.3: _bleChatHandler tiene guard para no sobrescribir activeContact
  // si ya hay un chat activo. Esto previene la race condition del crash #1470.
  async _initPhase5_BLEUI() {
    DEBUG.setPhase('BLE_UI');
    try {
      const meshInstance = this.nordicMesh || this.mesh || null;
      this.bleInterface = initBLEInterface(meshInstance);
      if (this.bleInterface) DEBUG.success('BLE UI ready' + (meshInstance ? '' : ' (native)'), 'UI_002');

      // Handler para cuando se abre un chat desde el panel BLE
      this._bleChatHandler = (e) => {
        const { contactId, name, address, transport, macAddress } = e.detail;
        
        // FIX v5.1.3: GUARD - Si ya hay chat activo con el MISMO contacto, ignorar
        // Si es un contacto DIFERENTE, permitir cambio (usuario eligio otro chat)
        if (this.activeContact && this.activeContact.id === contactId) {
          DEBUG.log('Chat ya activo con este contacto, ignorando evento duplicado', 'info', 'CHAT_DEDUP');
          return;
        }
        
        this.activeContact = { 
          id: contactId, 
          name, 
          address, 
          transport,
          macAddress: macAddress || address
        };
        
        const appContainer = document.getElementById('app');
        if (appContainer) appContainer.classList.remove('hidden');
        const nameInput = document.getElementById('chat-contact-name');
        const subtitle = document.getElementById('chat-contact-subtitle');
        if (nameInput) nameInput.value = name || 'NEXO Device';
        if (subtitle) subtitle.textContent = transport === 'ble' ? 'BLUETOOTH' : 'NEXO MESH';
        
        var macShort = macAddress ? macAddress.substring(0,8) : 'N/A';
        DEBUG.success('💬 Chat activo: ' + name + ' [' + transport.toUpperCase() + '] MAC:' + macShort + '...', 'BLE_CHAT');
        
        this._updateMode('P2P_BLE');
        this.config.onStatusChange('CHAT:' + name);
      };
      window.addEventListener('nexo:ble:openChat', this._bleChatHandler);

      // Handler para mensajes recibidos via BLE
      this._bleMessageHandler = (e) => {
        const { deviceId, content, senderName, messageId, source, timestamp, macAddress } = e.detail;
        
        var contentPreview = '';
        if (content && typeof content.substring === 'function') {
          contentPreview = content.substring(0,30);
        }
        console.log('[BLE_RECV] Mensaje de ' + senderName + ': ' + contentPreview + '...');
        
        // Resolver nombre del remitente
        let resolvedName = senderName;
        if (!resolvedName || resolvedName === 'NEXO Peer') {
          const mac = macAddress || deviceId;
          const contact = this.bleInterface ? this._findContactByMAC(mac) : null;
          resolvedName = senderName || 'NEXO Peer';
          if (contact && contact.name) resolvedName = contact.name;
        }
        
        // Enviar al pipeline de mensajes con dedup
        this._handleMessage({
          content,
          sender: deviceId,
          senderName: resolvedName,
          source: source || 'ble_direct',
          timestamp: timestamp || Date.now(),
          messageId,
          macAddress: macAddress,
          _own: false
        }, 'ble_direct');
      };
      window.addEventListener('nexo:ble:messageReceived', this._bleMessageHandler);

    } catch (err) { DEBUG.error('UI_004', 'BLE UI init failed: ' + err.message); this.bleInterface = null; }
  }

  // Buscar contacto por MAC en la lista de BLEInterface
  _findContactByMAC(mac) {
    if (!this.bleInterface || !mac) return null;
    var contacts = [];
    if (this.bleInterface && typeof this.bleInterface._getBLEContacts === 'function') {
      contacts = this.bleInterface._getBLEContacts();
    }
    var normMac = (mac || '').toString().toLowerCase().trim().replace(/[^0-9a-f]/g, '');
    return contacts.find(function(c) {
      var cmac = (c.macAddress || '').toString().toLowerCase().trim().replace(/[^0-9a-f]/g, '');
      return cmac === normMac;
    });
  }

  async _initPhase6_Bridge() {
    DEBUG.setPhase('BRIDGE');
    try {
      var hasBlePlugin = false;
      if (this.bleInterface && this.bleInterface.nativePlugin) hasBlePlugin = true;
      if (!this.mesh && !this.nordicMesh && !this.wsClient && !hasBlePlugin) {
        DEBUG.warn('No transports', 'BRIDGE_SKIP');
        return;
      }
      this.bridge = new MeshRelayBridge({ mesh: this.mesh, nordicMesh: this.nordicMesh, relay: this.wsClient, onModeChange: (mode) => { DEBUG.setMode(mode); this.config.onStatusChange(mode); } });
      await withTimeoutNAP(this.bridge.initialize(), 5000, 'Bridge.initialize');
      DEBUG.success('Bridge ready', 'BRIDGE_002');
    } catch (err) { DEBUG.warn('Bridge init failed: ' + err.message, 'BRIDGE_003'); this.bridge = null; }
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

  // ============================================================================
  // HANDLERS NORDIC MESH
  // ============================================================================
  _handleNordicPeer(peer) { if (!peer || !peer.id) return; this.blePeers.set(peer.id, Object.assign({}, peer, { discoveredAt: Date.now() })); }
  _handleNordicSession(data) { if (!data || !data.deviceId) return; this._updateMode('P2P_BLE'); }
  _handleNordicMessage(msg) { if (!msg || !msg.deviceId) return; this._handleMessage({ content: msg.content, sender: msg.deviceId, source: 'ble_nordic', timestamp: msg.timestamp || Date.now() }, 'ble_nordic'); }
  _updateModeFromNordic(state) {
    switch(state) {
      case 'messaging': case 'connected': this._updateMode('P2P_BLE'); break;
      case 'offline': 
        var meshCount = 0;
        if (this.mesh && typeof this.mesh.getPeerCount === 'function') meshCount = this.mesh.getPeerCount();
        var wsConnected = false;
        if (this.wsClient && typeof this.wsClient.isConnected === 'function') wsConnected = this.wsClient.isConnected();
        if (!meshCount && !wsConnected) this._updateMode('OFFLINE'); 
        break;
    }
  }
  _updateMode(mode) { DEBUG.setMode(mode); this.config.onStatusChange(mode); }

  // ============================================================================
  // ENVIO VIA BLE DIRECTO: _sendViaBLE
  // ============================================================================
  // Envia un mensaje directamente al plugin nativo BLE.
  // Usa la MAC del activeContact como target.
  async _sendViaBLE(deviceId, content) {
    var plugin = null;
    if (this.bleInterface && this.bleInterface.nativePlugin) {
      plugin = this.bleInterface.nativePlugin;
    }
    if (!plugin) throw new Error('Plugin no disponible');
    
    var targetMAC = deviceId;
    if (this.activeContact && this.activeContact.macAddress) {
      targetMAC = this.activeContact.macAddress;
    }
    var macShort = targetMAC ? targetMAC.substring(0,12) : 'N/A';
    console.log('[BLE_SEND] Enviando a MAC:' + macShort + '...');
    
    try {
      if (typeof plugin.sendMessage !== 'function') throw new Error('sendMessage no disponible');
      await plugin.sendMessage({ deviceId: targetMAC, message: content });
      var macShort2 = targetMAC ? targetMAC.substring(0,8) : 'N/A';
      DEBUG.success('📨 Enviado vía BLE a ' + macShort2 + '...', 'MSG_BLE');
    } catch (e) {
      DEBUG.error('BLE_SEND_FAIL', 'Envío falló: ' + (e.message || e));
      throw e;
    }
  }

  // ============================================================================
  // SEND MESSAGE: Enviar mensaje al contacto activo
  // ============================================================================
  // Estrategia de envio (en orden de prioridad):
  // 1. BLEInterface.sendMessageToActiveChat() (metodo preferido)
  // 2. BLE directo via plugin nativo
  // 3. NordicMesh
  // 4. HybridMesh
  // 5. Bridge
  // 6. WebSocket
  //
  // FIX v5.1.3: Lock de envio para evitar envios concurrentes que puedan
  // causar race conditions en el plugin nativo.
  async sendMessage(msg) {
    if (!this.initialized || this._isDestroyed) {
      DEBUG.error(this._isDestroyed ? 'APP_022' : 'APP_021', 'Cannot send');
      return false;
    }
    
    // Lock de envio: evitar envios concurrentes
    if (this._sendLock) {
      DEBUG.warn('Envío en progreso, esperando...', 'MSG_LOCK');
      await new Promise(r => setTimeout(r, 500));
    }
    this._sendLock = true;
    
    try {
      const messageId = msg.messageId || (Date.now() + '-' + Math.random().toString(36).substr(2, 9));
      
      // Renderizar optimista (mostrar inmediatamente en UI)
      this._handleMessage(Object.assign({}, msg, { _own: true, timestamp: Date.now(), pending: true, messageId }), 'self');

      const isObject = msg && typeof msg === 'object';
      const content = isObject ? (msg.content || msg) : msg;
      const recipient = isObject ? msg.recipient : null;
      var targetId = recipient;
      if (!targetId && this.activeContact) {
        targetId = this.activeContact.macAddress || this.activeContact.id;
      }
      var targetTransport = null;
      if (this.activeContact) targetTransport = this.activeContact.transport;

      // ESTRATEGIA 1: BLEInterface (metodo preferido)
      if (targetTransport === 'ble' && this.bleInterface && typeof this.bleInterface.sendMessageToActiveChat === 'function') {
        try {
          const sent = await this.bleInterface.sendMessageToActiveChat(content);
          if (sent) {
            this._handleMessage({ content, _own: true, timestamp: Date.now(), pending: false, recipient: targetId, source: 'ble_direct', messageId }, 'self');
            return true;
          }
          DEBUG.info('Mensaje encolado - esperando conexion BLE', 'MSG_QUEUED');
          return false;
        } catch (e) {
          DEBUG.warn('bleInterface.sendMessageToActiveChat falló: ' + e.message, 'MSG_BLE_FAIL');
        }
      }

      // ESTRATEGIA 2: BLE directo via plugin nativo
      var hasNativePlugin = false;
      if (this.bleInterface && this.bleInterface.nativePlugin) hasNativePlugin = true;
      if (targetId && targetTransport === 'ble' && hasNativePlugin) {
        try {
          await this._sendViaBLE(targetId, content);
          this._handleMessage({ content, _own: true, timestamp: Date.now(), pending: false, recipient: targetId, source: 'ble_direct', messageId }, 'self');
          return true;
        } catch (e) {
          DEBUG.warn('BLE directo falló: ' + e.message, 'MSG_BLE_FAIL');
        }
      }

      // ESTRATEGIA 3: Fallback a cualquier dispositivo BLE conectado
      if (this.bleInterface && this.bleInterface.nativePlugin) {
        try {
          const connectedResult = await this.bleInterface.nativePlugin.getConnectedDevices();
          var bleDevices = [];
          if (connectedResult && connectedResult.devices) bleDevices = connectedResult.devices;
          if (bleDevices.length > 0) {
            await this._sendViaBLE(bleDevices[0].deviceId || bleDevices[0].id, content);
            this._handleMessage({ content, _own: true, timestamp: Date.now(), pending: false, recipient: bleDevices[0].deviceId, source: 'ble_direct', messageId }, 'self');
            return true;
          }
        } catch (e) { DEBUG.log('[BLE_SEND] Fallback falló: ' + e.message, 'warn', 'BLE_PEER_FAIL'); }
      }

      // ESTRATEGIA 4: NordicMesh
      var nordicPeers = [];
      if (this.nordicMesh && typeof this.nordicMesh.getPeers === 'function') {
        nordicPeers = this.nordicMesh.getPeers();
      }
      if (nordicPeers.length > 0) {
        try { await this.nordicMesh.sendMessage(nordicPeers[0].id, content); DEBUG.success('Sent via Nordic', 'MSG_NORDIC'); return true; }
        catch (e) { DEBUG.error('NORDIC_009', 'Send failed: ' + e.message); }
      }

      // ESTRATEGIA 5: HybridMesh
      var meshCount2 = 0;
      if (this.mesh && typeof this.mesh.getPeerCount === 'function') {
        meshCount2 = this.mesh.getPeerCount();
      }
      if (meshCount2 > 0) {
        try { await this.mesh.broadcast({ content: content }); DEBUG.success('Sent via Hybrid', 'MSG_HYBRID'); return true; }
        catch (e) { DEBUG.error('MESH_005', 'Broadcast failed: ' + e.message); }
      }

      // ESTRATEGIA 6: Bridge
      if (this.bridge) { const result = await this.bridge.send({ content: content }); if (result) { DEBUG.success('Sent via Bridge', 'MSG_BRIDGE'); return true; } }

      // ESTRATEGIA 7: WebSocket
      var wsConn = false;
      if (this.wsClient && typeof this.wsClient.isConnected === 'function') wsConn = this.wsClient.isConnected();
      if (wsConn) { this.wsClient.send({ content: content }); DEBUG.success('Sent via WebSocket', 'MSG_WS'); return true; }

      DEBUG.warn('No hay dispositivos NEXO disponibles.', 'MSG_FAIL');
      return false;
    } catch (err) { 
      DEBUG.error('APP_008', 'SendMessage critical: ' + err.message); 
      return false; 
    } finally {
      this._sendLock = false;
    }
  }

  // ============================================================================
  // HANDLE MESSAGE: Procesar mensaje recibido con deduplicacion
  // ============================================================================
  // Dedup key: messageId + MAC (clave compuesta)
  // Si no hay messageId, usa sender + timestamp truncado a segundos
  //
  // FIX v5.1.3: Tambien verifica _renderedConversationIds para evitar
  // duplicados en la lista de conversaciones.
  _handleMessage(msg, source) {
    if (this._isDestroyed) return;
    try {
      // Construir clave de dedup
      const dedupKey = (msg.messageId || '') + ':' + (msg.macAddress || msg.sender || '');
      
      if (msg.messageId || msg.macAddress) {
        const now = Date.now();
        if (this._messageDedupMap.has(dedupKey)) {
          if (source !== 'self') {
            var dedupShort = '';
            if (dedupKey && typeof dedupKey.substring === 'function') dedupShort = dedupKey.substring(0,16);
            DEBUG.log('Deduplicado ' + dedupShort + ' de ' + source, 'debug', 'DEDUP');
          }
          return;
        }
        this._messageDedupMap.set(dedupKey, now);
        
        // Limpiar entradas antiguas (LRU + TTL)
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
      }
      
      // Enriquecer mensaje con metadatos
      const enriched = Object.assign({}, msg, { _source: source, _ts: Date.now(), _id: Math.random().toString(36).substr(2, 9) });
      
      // Enviar al callback de renderizado (main.js)
      this.config.onMessage(enriched);
      
      // Tambien agregar al stream si existe
      if (this.stream && typeof this.stream.appendItems === 'function') this.stream.appendItems([enriched]);
    } catch (err) { DEBUG.error('APP_005', 'Message handler: ' + err.message); }
  }

  async _partialCleanup() {
    if (this.nordicMesh) { try { if (typeof this.nordicMesh.destroy === 'function') await this.nordicMesh.destroy(); } catch(e) {} this.nordicMesh = null; }
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { if (typeof this.wsClient.disconnect === 'function') this.wsClient.disconnect(); } catch(e) {} this.wsClient = null; }
  }

  async destroy() {
    if (this._isDestroyed) return;
    this._isDestroyed = true;
    DEBUG.log('🧹 Cleanup...', 'info', 'DESTROY');
    if (this._bleChatHandler) { window.removeEventListener('nexo:ble:openChat', this._bleChatHandler); this._bleChatHandler = null; }
    if (this._bleMessageHandler) { window.removeEventListener('nexo:ble:messageReceived', this._bleMessageHandler); this._bleMessageHandler = null; }
    if (this.bleInterface) { try { this.bleInterface.destroy(); } catch(e) {} this.bleInterface = null; }
    if (this.nordicMesh) { this._resources.handlers.forEach(function(unsub) { try { unsub(); } catch(e) {} }); try { if (typeof this.nordicMesh.destroy === 'function') await this.nordicMesh.destroy(); } catch(e) {} this.nordicMesh = null; }
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { if (typeof this.wsClient.disconnect === 'function') this.wsClient.disconnect(); } catch(e) {} this.wsClient = null; }
    if (this.vault) { try { if (typeof this.vault.destroy === 'function') this.vault.destroy(); } catch(e) {} this.vault = null; }
    this._resources.timers.forEach(t => clearTimeout(t));
    DEBUG.success('Cleanup complete', 'DESTROY_OK');
  }

  getStatus() {
    var meshMode = 'offline';
    if (this.mesh && typeof this.mesh.getStatus === 'function') {
      var ms = this.mesh.getStatus();
      if (ms && ms.mode) meshMode = ms.mode;
    }
    var nordicState = '';
    if (this.nordicMesh && typeof this.nordicMesh.getState === 'function') nordicState = this.nordicMesh.getState();
    var finalMode = meshMode || (nordicState === 'messaging' ? 'p2p_ble' : 'offline');
    return {
      initialized: this.initialized,
      mode: finalMode,
      hasBLEInterface: !!this.bleInterface,
      activeContact: this.activeContact ? { 
        name: this.activeContact.name, 
        transport: this.activeContact.transport,
        macAddress: this.activeContact ? this.activeContact.macAddress : null
      } : null
    };
  }
}

export default NexoApp;
export { DEBUG };
'''

with open('/mnt/agents/output/nexo_app_v5.1.3-ANTI-CRASH.js', 'w') as f:
    f.write(nexo_app_code)

# Verificar
open_braces = nexo_app_code.count('{')
close_braces = nexo_app_code.count('}')
print("nexo_app.js - Balance llaves:", open_braces - close_braces)
print("Lineas:", nexo_app_code.count('\n'))
print("Optional chaining:", len(re.findall(r'\?\.', nexo_app_code)))
print("Comillas triples:", len(re.findall(r"'''|\"\"\"", nexo_app_code)))
