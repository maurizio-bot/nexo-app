/**
 * NEXO App v5.0.22-FASE4-FIXED
 * FIX: _bleMessageHandler maneja payload como objeto nativo (plugin puede pasar objeto, no string)
 * FIX: Filtro mensaje propio usa localNexoId en vez de localDeviceUUID
 * FIX: Timeout sendChatMessage 15s -> 25s
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
  if (!ms || ms <= 0) ms = 5000;
  var timer;
  var timeoutPromise = new Promise(function(_, reject) {
    timer = setTimeout(function() { reject(new Error('[NAP_TIMEOUT] ' + context)); }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(function() { if (timer) clearTimeout(timer); });
}

var DEBUG = {
  silent: false,
  rem: rem,
  _logBuffer: [],
  log: function(msg, type, code) {
    if (this.silent) return;
    type = type || 'info';
    var entry = { ts: Date.now(), time: new Date().toLocaleTimeString(), type: type, code: code, msg: msg };
    DEBUG._logBuffer.push(entry);
    if (DEBUG._logBuffer.length > 1000) DEBUG._logBuffer.shift();
    console.log('[' + entry.time + '] [' + type.toUpperCase() + ']' + (code ? '[' + code + ']' : '') + ' ' + msg);
  },
  error: function(code, msg) { DEBUG.log(msg, 'error', code); },
  success: function(msg, code) { DEBUG.log(msg, 'success', code); },
  warn: function(msg, code) { DEBUG.log(msg, 'warn', code); },
  setPhase: function(p) { rem.updatePhase(p); },
  setMode: function(m) { rem.updateMode(m); },
  setIdentity: function(id) { if (id) rem.updateIdentity(id); },
  toggleSilent: function() { this.silent = !this.silent; console.log('[DEBUG] Silent mode:', this.silent); }
};

function _safeCall(obj, method, args, fallback) {
  try {
    if (obj && typeof obj[method] === 'function') {
      return obj[method].apply(obj, args || []);
    }
  } catch (e) {
    console.warn('[NexoApp] SafeCall fallo ' + method + ':', e.message);
  }
  return fallback;
}

function _safeJSONParse(str, fallback) {
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

function _safeJSONStringify(obj) {
  try { return JSON.stringify(obj); } catch (e) { return '{}'; }
}

function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}

class NexoApp {
  constructor(config) {
    config = config || {};
    this.config = {
      relayUrls: Array.isArray(config.relayUrls) ? config.relayUrls : [],
      enableGestures: config.enableGestures !== false,
      enableMesh: config.enableMesh !== false,
      onMessage: typeof config.onMessage === 'function' ? config.onMessage : function() {},
      onStatusChange: typeof config.onStatusChange === 'function' ? config.onStatusChange : function() {},
      onError: typeof config.onError === 'function' ? config.onError : function(e) { console.error(e); },
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
    this._pendingMessages = new Map();
    DEBUG.log('NEXO v5.0.22-FASE4-FIXED iniciando...', 'info', 'APP_INIT');
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
      var nativeAvailable = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE);
      if (this.config.enableMesh && !nativeAvailable) await this._initPhase3_NordicMesh();
      if (this.config.enableMesh && !nativeAvailable) await this._initPhase4_HybridMesh();
      await this._initPhase5_BLEUI();
      await this._initPhase6_Bridge();
      await this._initPhase7_UI();
      this.initialized = true;
      DEBUG.setPhase('READY');
      DEBUG.success('NEXO v5.0.22-FASE4-FIXED Ready', 'APP_READY');
    } catch (err) {
      DEBUG.error('APP_020', 'Init failed: ' + (err.message || 'unknown'));
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
      var identity = this.vault.getIdentity ? this.vault.getIdentity() : null;
      if (identity) { DEBUG.setIdentity(identity); DEBUG.success('Vault initialized', 'CRYPTO_002'); }
    } catch (err) { DEBUG.error('CRYPTO_004', 'Vault init failed: ' + (err.message || 'unknown')); this.vault = null; }
  }

  async _initPhase2_WebSocket() {
    DEBUG.setPhase('WEBSOCKET');
    if (this.config.relayUrls.length === 0) { DEBUG.warn('No relay URLs', 'WS_SKIP'); return; }
    try {
      this.wsClient = new WebSocketClient(this.config.relayUrls[0]);
      var self = this;
      this.wsClient.onMessage = function(m) { self._handleMessage(m, 'relay'); };
      this.wsClient.onOpen = function() { DEBUG.setMode('RELAY'); };
      await withTimeoutNAP(this.wsClient.connect(), 8000, 'WebSocket.connect');
    } catch (err) { DEBUG.warn('WebSocket unavailable: ' + (err.message || 'unknown'), 'WS_004'); this.wsClient = null; }
  }

  async _initPhase3_NordicMesh() {
    DEBUG.setPhase('NORDIC_MESH');
    try {
      if (!this.vault) throw new Error('Vault required');
      this.nordicMesh = new NordicMesh(this.vault, { rssiThreshold: -85, chunkSize: 507, handshakeTimeout: 30000 });
      var self = this;
      var unsub1 = this.nordicMesh.on('peerDiscovered', function(p) { self._handleNordicPeer(p); });
      var unsub2 = this.nordicMesh.on('sessionEstablished', function(d) { self._handleNordicSession(d); });
      var unsub3 = this.nordicMesh.on('messageReceived', function(m) { self._handleNordicMessage(m); });
      var unsub4 = this.nordicMesh.on('stateChanged', function(s) { self._updateModeFromNordic(s.to); });
      var unsub5 = this.nordicMesh.on('error', function(err) { DEBUG.error('NORDIC_010', err.message); });
      this._resources.handlers.add(unsub1);
      this._resources.handlers.add(unsub2);
      this._resources.handlers.add(unsub3);
      this._resources.handlers.add(unsub4);
      this._resources.handlers.add(unsub5);
      var result = await withTimeoutNAP(this.nordicMesh.init(), 10000, 'NordicMesh.init');
      if (!result.success) throw new Error(result.error ? result.error.message : 'Nordic init returned false');
      DEBUG.success('Nordic Mesh active [Native:' + result.isNative + ']', 'NORDIC_002');
    } catch (err) { DEBUG.error('NORDIC_005', 'Nordic init failed: ' + (err.message || 'unknown')); this.nordicMesh = null; }
  }

  async _initPhase4_HybridMesh() {
    DEBUG.setPhase('MESH');
    try {
      var self = this;
      this.mesh = new HybridMesh({
        onDeviceFound: function(d) { DEBUG.log('Hybrid found: ' + (d.name || 'unknown'), 'info', 'MESH_DEVICE'); },
        onDeviceConnected: function(d) { DEBUG.success('Hybrid connected: ' + (d.name || 'unknown'), 'MESH_CONN'); },
        onDeviceDisconnected: function(d) { DEBUG.log('Hybrid disconnected', 'warn', 'MESH_DISC'); },
        onError: function(code, msg) { DEBUG.error('MESH_006', msg); }
      });
      await withTimeoutNAP(this.mesh.initialize(), 15000, 'HybridMesh.initialize');
      DEBUG.success('Hybrid Mesh ready', 'MESH_002');
    } catch (err) { DEBUG.error('APP_016', 'Hybrid Mesh: ' + (err.message || 'unknown')); this.mesh = null; }
  }

  async _initPhase5_BLEUI() {
    DEBUG.setPhase('BLE_UI');
    try {
      var meshInstance = this.nordicMesh || this.mesh || null;
      this.bleInterface = initBLEInterface(meshInstance);
      if (this.bleInterface) DEBUG.success('BLE UI ready' + (meshInstance ? '' : ' (native)'), 'UI_002');
      var self = this;

      this._bleChatHandler = async function(e) {
        try {
          var detail = e.detail || {};
          var contact = detail.contact || {};
          if (!contact.id && detail.contactId) contact.id = detail.contactId;
          if (!contact.name && detail.name) contact.name = detail.name;
          if (!contact.nexoId && detail.contactId) contact.nexoId = detail.contactId;
          if (!contact.transport && detail.transport) contact.transport = detail.transport;

          if (contact.nexoId && window.vaultFindContactByNexoId) {
            try {
              var vaultContact = window.vaultFindContactByNexoId(contact.nexoId);
              if (vaultContact) {
                contact = Object.assign({}, vaultContact, contact);
              } else if (window.vaultSaveContact) {
                window.vaultSaveContact(contact);
              }
            } catch(vcErr) {}
          }

          self.activeContact = contact;
          var appContainer = document.getElementById('app');
          if (appContainer) appContainer.classList.remove('hidden');
          document.body.classList.add('chat-view-active');
          var backBtn = document.getElementById('chat-back-btn');
          if (backBtn) backBtn.classList.add('visible');
          var nameInput = document.getElementById('chat-contact-name');
          var subtitle = document.getElementById('chat-contact-subtitle');
          if (nameInput) nameInput.value = contact.name || contact.displayName || '';
          if (subtitle) subtitle.textContent = '';
          DEBUG.success('Chat activo: ' + (contact.name || '') + ' [' + (contact.transport || 'unknown').toUpperCase() + ']', 'BLE_CHAT');
          try {
            var loadId = contact.nexoId || contact.id;
            var storedMessages = await self._loadMessagesFromVault(loadId);
            storedMessages.sort(function(a, b) { return (a._ts || 0) - (b._ts || 0); });
            storedMessages.forEach(function(m) { self.config.onMessage(m); });
          } catch (e) {}
          self._updateMode('P2P_BLE');
          self.config.onStatusChange('CHAT:' + (contact.name || ''));
          var bottomNav = document.getElementById('ble-bottom-nav');
          if (bottomNav) {
            var navItems = bottomNav.querySelectorAll('.ble-nav-item');
            navItems.forEach(function(n) { n.classList.remove('active'); });
            var chatsTab = bottomNav.querySelector('[data-tab="chats"]');
            if (chatsTab) chatsTab.classList.add('active');
          }
          if (self.bleInterface) {
            self.bleInterface._activeChatDeviceId = contact.nexoId || contact.id || null;
          }
        } catch (handlerErr) {
          console.error('[NexoApp] Error en _bleChatHandler:', handlerErr);
          DEBUG.error('BLE_UI_001', 'Error en chat handler: ' + (handlerErr.message || 'unknown'));
        }
      };
      window.addEventListener('nexo:ble:openChat', this._bleChatHandler);
      this._resources.listeners.add({ target: window, event: 'nexo:ble:openChat', handler: this._bleChatHandler });

      this._chatBackHandler = function() {
        try {
          document.body.classList.remove('chat-view-active');
          var backBtn = document.getElementById('chat-back-btn');
          if (backBtn) backBtn.classList.remove('visible');
          self.activeContact = null;
          try { window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} })); } catch(e) {}
          var blePanel = document.getElementById('ble-panel');
          var bleOverlay = document.getElementById('ble-overlay');
          if (blePanel) blePanel.classList.remove('active');
          if (bleOverlay) bleOverlay.classList.remove('active');
          var bottomNav = document.getElementById('ble-bottom-nav');
          if (bottomNav) {
            var navItems = bottomNav.querySelectorAll('.ble-nav-item');
            navItems.forEach(function(n) { n.classList.remove('active'); });
            var chatsTab = bottomNav.querySelector('[data-tab="chats"]');
            if (chatsTab) chatsTab.classList.add('active');
          }
          self._updateMode('OFFLINE');
          self.config.onStatusChange('OFFLINE');
        } catch (err) { console.warn('[NexoApp] Error en back handler:', err); }
      };
      var chatBackBtn = document.getElementById('chat-back-btn');
      if (chatBackBtn) chatBackBtn.addEventListener('click', this._chatBackHandler);
      this._resources.listeners.add({ target: chatBackBtn, event: 'click', handler: this._chatBackHandler });

      this._nativeDeviceConnectedHandler = function(e) {
        try {
          var detail = e.detail || {};
          self._updateMode('P2P_BLE');
          self.config.onStatusChange('CONECTADO:' + (detail.name || ''));
        } catch (err) {
          console.warn('[NexoApp] Error en _nativeDeviceConnectedHandler:', err);
        }
      };
      window.addEventListener('nexo:ble:deviceConnected', this._nativeDeviceConnectedHandler);
      this._resources.listeners.add({ target: window, event: 'nexo:ble:deviceConnected', handler: this._nativeDeviceConnectedHandler });

      this._nativeDeviceDisconnectedHandler = function(e) {
        try {
          self._updateMode('OFFLINE');
          self.config.onStatusChange('OFFLINE');
        } catch (err) {
          console.warn('[NexoApp] Error en _nativeDeviceDisconnectedHandler:', err);
        }
      };
      window.addEventListener('nexo:ble:deviceDisconnected', this._nativeDeviceDisconnectedHandler);
      this._resources.listeners.add({ target: window, event: 'nexo:ble:deviceDisconnected', handler: this._nativeDeviceDisconnectedHandler });

      this._bleMessageHandler = function(e) {
        try {
          var detail = e.detail || {};
          // FIX: Usar localNexoId en vez de localDeviceUUID para filtrar mensajes propios
          var localUUID = self.bleInterface && self.bleInterface.localNexoId ? self.bleInterface.localNexoId : '';
          var senderUUID = detail.senderNexoId || detail.deviceUUID || '';
          if (senderUUID && localUUID && _normId(senderUUID) === _normId(localUUID)) {
            console.log('[BLE_RECV] Mensaje propio ignorado por NXID');
            return;
          }
          console.log('[BLE_RECV] Mensaje de ' + (detail.senderName || '') + ': ' + (detail.content ? (typeof detail.content === 'string' ? detail.content.substring(0, 30) : '[obj]') : '') + '...');
          var resolvedName = detail.senderName;
          var messageId = null;
          // FIX: Manejar content como string o objeto nativo
          var content = detail.content || detail.data || '';
          var parsedPayload = null;
          if (typeof content === 'object' && content !== null) {
            parsedPayload = content;
            if (content.msgId) messageId = content.msgId;
            if (content.messageId) messageId = content.messageId;
            if (content.payload) {
              if (content.payload.senderName) resolvedName = content.payload.senderName;
              if (content.payload.text) content = content.payload.text;
              if (content.payload.senderNexoId) senderUUID = content.payload.senderNexoId;
            }
            if (content.senderName) resolvedName = content.senderName;
            if (content.deviceName) resolvedName = content.deviceName;
            if (content.deviceUUID) senderUUID = content.deviceUUID;
            if (content.content) content = content.content;
            if (content.from && !senderUUID) senderUUID = content.from;
          } else if (typeof content === 'string' && content.charAt(0) === '{') {
            try {
              parsedPayload = JSON.parse(content);
              if (parsedPayload.msgId) messageId = parsedPayload.msgId;
              if (parsedPayload.messageId) messageId = parsedPayload.messageId;
              if (parsedPayload.payload) {
                if (parsedPayload.payload.senderName) resolvedName = parsedPayload.payload.senderName;
                if (parsedPayload.payload.text) content = parsedPayload.payload.text;
                if (parsedPayload.payload.senderNexoId) senderUUID = parsedPayload.payload.senderNexoId;
              }
              if (parsedPayload.senderName) resolvedName = parsedPayload.senderName;
              if (parsedPayload.deviceName) resolvedName = parsedPayload.deviceName;
              if (parsedPayload.deviceUUID) senderUUID = parsedPayload.deviceUUID;
              if (parsedPayload.content) content = parsedPayload.content;
              if (parsedPayload.from && !senderUUID) senderUUID = parsedPayload.from;
            } catch (e) {}
          }
          if (!resolvedName || resolvedName === 'NEXO Peer') {
            var contactByUUID = window.bleInterface && window.bleInterface.getContactByUUID ? window.bleInterface.getContactByUUID(senderUUID) : null;
            resolvedName = (contactByUUID && contactByUUID.name) || detail.senderName || '';
          }
          if (content && typeof content === 'string' && content.charAt(0) === '{') {
            try {
              var ctrl = JSON.parse(content);
              if (ctrl.type === 'ack') {
                self._handleACK(ctrl.messageId, ctrl.ackType || 'delivered');
                return;
              }
              if (ctrl.type === 'read_receipt') {
                self._handleACK(ctrl.messageId, 'read');
                return;
              }
            } catch (ackErr) {}
          }
          if (senderUUID && window.vaultGetOrCreateContact) {
            try { window.vaultGetOrCreateContact(senderUUID, resolvedName || 'NEXO'); } catch(vcErr) {}
          }
          self._handleMessage({
            content: content,
            sender: senderUUID,
            senderName: resolvedName,
            source: detail.source || 'ble_direct',
            timestamp: detail.timestamp || Date.now(),
            messageId: detail.messageId || messageId,
            deviceUUID: senderUUID,
            senderNexoId: senderUUID,
            _own: false
          }, 'ble_direct');
          if (senderUUID && (detail.messageId || messageId)) {
            setTimeout(function() { self._sendACK(senderUUID, detail.messageId || messageId); }, 100);
          }
        } catch (handlerErr) {
          console.error('[NexoApp] Error en _bleMessageHandler:', handlerErr);
          DEBUG.error('BLE_UI_002', 'Error en message handler: ' + (handlerErr.message || 'unknown'));
        }
      };
      window.addEventListener('nexo:ble:messageReceived', this._bleMessageHandler);
      this._resources.listeners.add({ target: window, event: 'nexo:ble:messageReceived', handler: this._bleMessageHandler });
    } catch (err) { DEBUG.error('UI_004', 'BLE UI init failed: ' + (err.message || 'unknown')); this.bleInterface = null; }
  }
  async _initPhase6_Bridge() {
    DEBUG.setPhase('BRIDGE');
    try {
      if (!this.mesh && !this.nordicMesh && !this.wsClient && !(this.bleInterface && this.bleInterface.nativePlugin)) {
        DEBUG.warn('No transports', 'BRIDGE_SKIP');
        return;
      }
      var self = this;
      this.bridge = new MeshRelayBridge({
        mesh: this.mesh,
        nordicMesh: this.nordicMesh,
        relay: this.wsClient,
        onModeChange: function(mode) { DEBUG.setMode(mode); self.config.onStatusChange(mode); }
      });
      await withTimeoutNAP(this.bridge.initialize(), 5000, 'Bridge.initialize');
      DEBUG.success('Bridge ready', 'BRIDGE_002');
    } catch (err) { DEBUG.warn('Bridge init failed: ' + (err.message || 'unknown'), 'BRIDGE_003'); this.bridge = null; }
  }
 async _initPhase7_UI() {
   DEBUG.setPhase('GESTURES');
   var self = this;
   if (this.config.enableGestures) { try { this.gestures = new GestureEngine({}); this.gestures.init(); } catch (e) {} }
   DEBUG.setPhase('VAULT_SLIDER');
   var streamEl = document.getElementById('nexo-stream');
   var vaultEl = document.getElementById('nexo-vault');
   if (streamEl && vaultEl) { try { this.vaultSlider = new CoreGestureEngine(streamEl, vaultEl); } catch (e) {} }
   DEBUG.setPhase('STREAM');
   var container = document.getElementById('messages-container');
   if (container) { try { this.stream = new TheStream(container, {}); } catch (e) {} }
   var jumpBtn = document.getElementById('jump-to-bottom');
   if (jumpBtn && container) {
     container.addEventListener('scroll', function() {
       var nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
       if (nearBottom) jumpBtn.classList.remove('visible');
       else jumpBtn.classList.add('visible');
     });
     jumpBtn.addEventListener('click', function() {
       container.scrollTop = container.scrollHeight;
       jumpBtn.classList.remove('visible');
     });
   }
   self._initKeyboardScrollFix();
   self._initInputBarV2();
 }

 _initInputBarV2() {
   var self = this;
   var input = document.getElementById('message-input');
   var sendBtn = document.getElementById('send-btn');
   var attachBtn = document.getElementById('attach-menu');

   if (!input || !sendBtn) return;

   function updateSendButton() {
     var text = (input.value || '').trim();
     if (text.length > 0) {
       sendBtn.classList.remove('mic-mode');
     } else {
       sendBtn.classList.add('mic-mode');
     }
   }
   input.addEventListener('input', updateSendButton);
   updateSendButton();

   // FIX: Menu clip y adjuntos lo maneja main.js (_bindAttachmentHandlers)
   // No registramos listeners duplicados aqui

   sendBtn.addEventListener('click', function(e) {
     if (sendBtn.classList.contains('mic-mode')) {
       e.preventDefault();
       e.stopPropagation();
       console.log('[NEXO] Mic presionado — placeholder');
       return;
     }
   });
 }

 _initKeyboardScrollFix() {
   var self = this;
   var container = document.getElementById('messages-container');
   var input = document.getElementById('message-input');
   if (!container || !input) return;
   if (window.visualViewport) {
     window.visualViewport.addEventListener('resize', function() {
       var vv = window.visualViewport;
       var layoutH = window.innerHeight;
       var visibleH = vv.height;
       var kbHeight = Math.max(0, layoutH - visibleH);
       if (kbHeight > 100) {
         document.body.classList.add('keyboard-open');
         setTimeout(function() {
           container.scrollTop = container.scrollHeight;
         }, 100);
       } else {
         document.body.classList.remove('keyboard-open');
       }
     });
   }
   if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
     var Keyboard = window.Capacitor.Plugins.Keyboard;
     Keyboard.addListener('keyboardWillShow', function(info) {
       document.body.classList.add('keyboard-open');
       setTimeout(function() {
         container.scrollTop = container.scrollHeight;
         input.scrollIntoView({ behavior: 'smooth', block: 'end' });
       }, 50);
     });
     Keyboard.addListener('keyboardWillHide', function() {
       document.body.classList.remove('keyboard-open');
     });
   } else if (!window.visualViewport) {
     var originalHeight = window.innerHeight;
     window.addEventListener('resize', function() {
       var newHeight = window.innerHeight;
       if (newHeight < originalHeight - 100) {
         document.body.classList.add('keyboard-open');
         setTimeout(function() {
           container.scrollTop = container.scrollHeight;
         }, 100);
       } else {
         document.body.classList.remove('keyboard-open');
       }
     });
   }
   input.addEventListener('focus', function() {
     setTimeout(function() {
       container.scrollTop = container.scrollHeight;
       input.scrollIntoView({ behavior: 'smooth', block: 'end' });
     }, 300);
   });
 }

 _handleNordicPeer(peer) { if (!peer || !peer.id) return; this.blePeers.set(peer.id, Object.assign({}, peer, { discoveredAt: Date.now() })); }
 _handleNordicSession(data) { if (!data || !data.deviceId) return; this._updateMode('P2P_BLE'); }
 _handleNordicMessage(msg) { if (!msg || !msg.deviceId) return; this._handleMessage({ content: msg.content, sender: msg.deviceId, source: 'ble_nordic', timestamp: msg.timestamp || Date.now() }, 'ble_nordic'); }
 _updateModeFromNordic(state) {
   switch(state) {
     case 'messaging': case 'connected': this._updateMode('P2P_BLE'); break;
     case 'offline': if ((!this.mesh || !this.mesh.getPeerCount || this.mesh.getPeerCount() === 0) && (!this.wsClient || !this.wsClient.isConnected || !this.wsClient.isConnected())) this._updateMode('OFFLINE'); break;
   }
 }
 _updateMode(mode) { DEBUG.setMode(mode); this.config.onStatusChange(mode); }

 async _saveMessageToVault(contactId, message) {
   var cid = _normId(contactId);
   if (!cid) return;
   try {
     if (window.vaultAppendMessage && typeof window.vaultAppendMessage === 'function') {
       await window.vaultAppendMessage(cid, {
         content: message.content,
         sender: message.sender,
         senderName: message.senderName,
         _own: !!message._own,
         _source: message._source,
         _ts: message._ts || Date.now(),
         messageId: message.messageId,
         deviceUUID: message.deviceUUID,
         recipient: message.recipient,
         status: message.status || 'pending'
       });
     }
   } catch (e) {
     console.warn('[NexoApp] Error guardando mensaje:', e.message);
   }
 }

 async _loadMessagesFromVault(contactId) {
   try {
     var cid = _normId(contactId);
     if (!cid) return [];
     var raw = [];
     if (window.vaultLoadMessages && typeof window.vaultLoadMessages === 'function') {
       raw = await window.vaultLoadMessages(cid);
     }
     return raw.map(function(m) {
       return {
         content: m.text || m.content || '',
         sender: m.senderNexoId || m.sender || '',
         senderName: m.senderName || '',
         _own: !!m._own,
         _source: 'vault',
         _ts: m.timestamp || m._ts || Date.now(),
         messageId: m.msgId || m.messageId || '',
         status: m.status || 'pending',
         deviceUUID: m.senderNexoId || m.sender || ''
       };
     });
   } catch (e) { return []; }
 }

 async _updateMessageStatusInVault(contactId, messageId, status) {
   var cid = _normId(contactId);
   if (!cid || !messageId) return;
   try {
     if (window.vaultUpdateMessageStatus && typeof window.vaultUpdateMessageStatus === 'function') {
       await window.vaultUpdateMessageStatus(cid, messageId, status);
     }
   } catch (e) {
     console.warn('[NexoApp] Error actualizando estado:', e.message);
   }
 }
 async sendMessage(msg) {
   if (!this.initialized || this._isDestroyed) {
     DEBUG.error(this._isDestroyed ? 'APP_022' : 'APP_021', 'Cannot send');
     return false;
   }
   try {
     var messageId = msg.messageId || (Date.now() + '-' + Math.random().toString(36).substr(2, 9));
     var isObject = msg && typeof msg === 'object';
     var content = isObject ? (msg.content || msg) : msg;
     var recipient = isObject ? msg.recipient : null;
     // FIX: NXID estricto. Sin fallback a deviceId nativo.
     var targetId = recipient || (this.activeContact ? (this.activeContact.nexoId || this.activeContact.id) : null);
     var targetTransport = this.activeContact ? this.activeContact.transport : null;
     if (!content || (typeof content === 'string' && content.trim() === '')) {
       return false;
     }
     this._cleanupPendingMessages();
     this._pendingMessages.set(messageId, { status: 'pending', timestamp: Date.now(), recipient: targetId, retries: 0 });
     this._handleMessage({
       content: content,
       _own: true,
       timestamp: Date.now(),
       pending: true,
       recipient: targetId,
       source: 'self',
       messageId: messageId
     }, 'self');
     if (targetId && targetTransport === 'ble' && this.bleInterface && typeof this.bleInterface.sendChatMessage === 'function') {
       try {
         console.log('[NEXO] Enviando via sendChatMessage a UUID:', targetId);
         // FIX: Timeout 25s para dar tiempo a conexion BLE + cola
         await withTimeoutNAP(this.bleInterface.sendChatMessage(targetId, content, messageId), 25000, 'BLE.sendChatMessage');
         DEBUG.success('Enviado via BLE a ' + targetId, 'MSG_BLE');
         this._updateMessageStatus(messageId, 'sent');
         return true;
       } catch (e) {
         DEBUG.warn('BLE directo fallo: ' + (e.message || 'unknown'), 'MSG_BLE_FAIL');
       }
     }
     var nordicPeers = this.nordicMesh && this.nordicMesh.getPeers ? this.nordicMesh.getPeers() : [];
     if (nordicPeers.length > 0) {
       try {
         await this.nordicMesh.sendMessage(nordicPeers[0].id, content);
         DEBUG.success('Sent via Nordic', 'MSG_NORDIC');
         this._updateMessageStatus(messageId, 'sent');
         return true;
       } catch (e) {
         DEBUG.error('NORDIC_009', 'Send failed: ' + (e.message || 'unknown'));
       }
     }
     if (this.mesh && this.mesh.getPeerCount && this.mesh.getPeerCount() > 0) {
       try {
         await this.mesh.broadcast({ content: content });
         DEBUG.success('Sent via Hybrid', 'MSG_HYBRID');
         this._updateMessageStatus(messageId, 'sent');
         return true;
       } catch (e) {
         DEBUG.error('MESH_005', 'Broadcast failed: ' + (e.message || 'unknown'));
       }
     }
     if (this.bridge) {
       var result = await this.bridge.send({ content: content });
       if (result) {
         DEBUG.success('Sent via Bridge', 'MSG_BRIDGE');
         this._updateMessageStatus(messageId, 'sent');
         return true;
       }
     }
     if (this.wsClient && this.wsClient.isConnected && this.wsClient.isConnected()) {
       this.wsClient.send({ content: content });
       DEBUG.success('Sent via WebSocket', 'MSG_WS');
       this._updateMessageStatus(messageId, 'sent');
       return true;
     }
     DEBUG.warn('No hay dispositivos NEXO disponibles.', 'MSG_FAIL');
     this._updateMessageStatus(messageId, 'error');
     return false;
   } catch (err) {
     DEBUG.error('APP_008', 'SendMessage critical: ' + (err.message || 'unknown'));
     this._updateMessageStatus(messageId, 'error');
     return false;
   }
 }

 _handleMessage(msg, source) {
   if (this._isDestroyed) return;
   try {
     if (msg.messageId) {
       var now = Date.now();
       if (this._messageDedupMap.has(msg.messageId)) {
         if (source !== 'self') {
           DEBUG.log('Deduplicado ' + (msg.messageId ? msg.messageId.substring(0, 8) : '') + ' de ' + source, 'debug', 'DEDUP');
         }
         return;
       }
       this._messageDedupMap.set(msg.messageId, now);
       if (this._messageDedupMap.size > this._maxProcessedIds) {
         var oldestKey = null;
         var oldestTime = Infinity;
         var entries = Array.from(this._messageDedupMap.entries());
         for (var i = 0; i < entries.length; i++) {
           if (entries[i][1] < oldestTime) {
             oldestTime = entries[i][1];
             oldestKey = entries[i][0];
           }
         }
         if (oldestKey) this._messageDedupMap.delete(oldestKey);
       }
       var keysToDelete = [];
       this._messageDedupMap.forEach(function(v, k) {
         if (now - v > this._dedupTTL) keysToDelete.push(k);
       }.bind(this));
       for (var i = 0; i < keysToDelete.length; i++) {
         this._messageDedupMap.delete(keysToDelete[i]);
       }
     }
     var enriched = Object.assign({}, msg, {
       _own: !!msg._own,
       _source: source,
       _ts: Date.now(),
       _id: Math.random().toString(36).substr(2, 9)
     });
     this.config.onMessage(enriched);
     var vaultContactId = enriched._own ? enriched.recipient : (enriched.senderNexoId || enriched.deviceUUID || enriched.sender);
     if (vaultContactId) this._saveMessageToVault(vaultContactId, enriched);
     if (!enriched._own && this.activeContact && (enriched.sender === this.activeContact.id || enriched.sender === this.activeContact.nexoId) && enriched.messageId) {
       var self = this;
       setTimeout(function() { self._sendReadReceipt(enriched.messageId, enriched.sender); }, 800);
     }
   } catch (err) {
     DEBUG.error('APP_005', 'Message handler: ' + (err.message || 'unknown'));
   }
 }

 async _partialCleanup() {
   if (this.nordicMesh) { try { if (this.nordicMesh.destroy) await this.nordicMesh.destroy(); } catch(e) {} this.nordicMesh = null; }
   if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
   if (this.wsClient) { try { if (this.wsClient.disconnect) await this.wsClient.disconnect(); } catch(e) {} this.wsClient = null; }
 }

 async destroy() {
   if (this._isDestroyed) return;
   this._isDestroyed = true;
   DEBUG.log('Cleanup...', 'info', 'DESTROY');

   this._resources.handlers.forEach(function(unsub) { try { unsub(); } catch(e) {} });
   this._resources.listeners.forEach(function(item) {
     try {
       if (item.target && item.target.removeEventListener) {
         item.target.removeEventListener(item.event, item.handler);
       }
     } catch(e) {}
   });
   this._resources.timers.forEach(function(t) { clearTimeout(t); });

   if (this._bleChatHandler) { this._bleChatHandler = null; }
   if (this._chatBackHandler) { this._chatBackHandler = null; }
   if (this._bleMessageHandler) { this._bleMessageHandler = null; }
   if (this.bleInterface) { try { this.bleInterface.destroy(); } catch(e) {} this.bleInterface = null; }
   if (this.nordicMesh) { try { if (this.nordicMesh.destroy) await this.nordicMesh.destroy(); } catch(e) {} this.nordicMesh = null; }
   if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
   if (this.wsClient) { try { if (this.wsClient.disconnect) await this.wsClient.disconnect(); } catch(e) {} this.wsClient = null; }
   if (this.vault) { try { if (this.vault.destroy) await this.vault.destroy(); } catch(e) {} this.vault = null; }
   this._pendingMessages.clear();
   DEBUG.success('Cleanup complete', 'DESTROY_OK');
 }

 getStatus() {
   var mode = 'offline';
   if (this.mesh && this.mesh.getStatus) {
     mode = this.mesh.getStatus().mode;
   } else if (this.nordicMesh && this.nordicMesh.getState && this.nordicMesh.getState() === 'messaging') {
     mode = 'p2p_ble';
   } else if (this.bleInterface && this.bleInterface.nativePlugin && this.bleInterface.connectedDevices && this.bleInterface.connectedDevices.size > 0) {
     mode = 'P2P_BLE';
   }
   return {
     initialized: this.initialized,
     mode: mode,
     hasBLEInterface: !!this.bleInterface,
     activeContact: this.activeContact ? { name: this.activeContact.name, transport: this.activeContact.transport } : null
   };
 }

 _cleanupPendingMessages() {
   var now = Date.now();
   var keysToDelete = [];
   this._pendingMessages.forEach(function(v, k) {
     if (now - v.timestamp > 300000) keysToDelete.push(k);
   });
   for (var i = 0; i < keysToDelete.length; i++) {
     this._pendingMessages.delete(keysToDelete[i]);
   }
 }

 _updateMessageStatus(messageId, status) {
   if (!messageId) return;
   var pending = this._pendingMessages.get(messageId);
   if (!pending) {
     if (window.NEXO_updateMessageStatus) window.NEXO_updateMessageStatus(messageId, status);
     return;
   }
   if (pending.status === 'read') return;
   if (pending.status === 'delivered' && status !== 'read') return;
   pending.status = status;
   this._pendingMessages.set(messageId, pending);
   if (window.NEXO_updateMessageStatus) window.NEXO_updateMessageStatus(messageId, status);
 }

 _handleACK(messageId, ackType) {
   if (!messageId) return;
   var pending = this._pendingMessages.get(messageId);
   if (!pending) {
     DEBUG.log('ACK recibido pero mensaje no en pending: ' + messageId, 'warn', 'ACK_WARN');
     return;
   }
   var newStatus = ackType === 'read' ? 'read' : (ackType === 'delivered' ? 'delivered' : 'sent');
   if (pending.status === 'read') return;
   if (pending.status === 'delivered' && newStatus !== 'read') return;
   pending.status = newStatus;
   this._pendingMessages.set(messageId, pending);
   if (window.NEXO_updateMessageStatus) window.NEXO_updateMessageStatus(messageId, newStatus);
   DEBUG.log('ACK recibido: ' + messageId + ' -> ' + newStatus, 'info', 'ACK_RECV');
 }

 _sendACK(deviceUUID, messageId) {
   if (!deviceUUID || !messageId) return;
   if (!this.bleInterface || !this.bleInterface.sendChatMessage) return;
   var payload = JSON.stringify({ type: 'ack', messageId: messageId, ackType: 'delivered', timestamp: Date.now() });
   this.bleInterface.sendChatMessage(deviceUUID, payload, messageId).catch(function(e) {});
 }

 _sendReadReceipt(messageId, recipientId) {
   if (!messageId || !recipientId) return;
   if (!this.bleInterface || !this.bleInterface.sendChatMessage) return;
   var payload = JSON.stringify({ type: 'read_receipt', messageId: messageId, timestamp: Date.now() });
   this.bleInterface.sendChatMessage(recipientId, payload, messageId).catch(function(e) {});
 }
}

export { NexoApp, DEBUG };
export default NexoApp;
