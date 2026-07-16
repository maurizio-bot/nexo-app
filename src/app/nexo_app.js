/**
 * NEXO App v5.0.17-ATTACH-FIX
 * Base: v5.0.16-KEYBOARD-FIX-BACK
 * FIX: Attach handlers (Foto/Video/Archivo/Ubicación) renderizan burbuja local
 * FIX: Eliminado attachment_handlers.js externo, todo integrado en _initInputBarV2
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
import { vaultLoadMessages, vaultAppendMessage, vaultUpdateMessageStatus } from '../vault/crypto_vault.js';

function withTimeoutNAP(promise, ms, context) {
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
    if (config.relayUrls) this.config.relayUrls = config.relayUrls;
    if (config.enableGestures !== undefined) this.config.enableGestures = config.enableGestures;
    if (config.enableMesh !== undefined) this.config.enableMesh = config.enableMesh;
    if (config.onMessage) this.config.onMessage = config.onMessage;
    if (config.onStatusChange) this.config.onStatusChange = config.onStatusChange;
    if (config.onError) this.config.onError = config.onError;
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
    DEBUG.log('NEXO v5.0.17-ATTACH-FIX iniciando...', 'info', 'APP_INIT');
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
      DEBUG.success('NEXO v5.0.17-ATTACH-FIX Ready', 'APP_READY');
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
          self.activeContact = { id: detail.contactId, name: detail.name, address: detail.address, transport: detail.transport };
          var appContainer = document.getElementById('app');
          if (appContainer) appContainer.classList.remove('hidden');
          document.body.classList.add('chat-view-active');
          var backBtn = document.getElementById('chat-back-btn');
          if (backBtn) backBtn.classList.add('visible');
          var nameInput = document.getElementById('chat-contact-name');
          var subtitle = document.getElementById('chat-contact-subtitle');
          if (nameInput) nameInput.value = detail.name || '';
          if (subtitle) subtitle.textContent = '';
          DEBUG.success('Chat activo: ' + (detail.name || '') + ' [' + (detail.transport || 'unknown').toUpperCase() + ']', 'BLE_CHAT');
          try {
            var storedMessages = await self._loadMessagesFromVault(detail.contactId);
            storedMessages.sort(function(a, b) { return (a._ts || 0) - (b._ts || 0); });
            storedMessages.forEach(function(m) { self.config.onMessage(m); });
          } catch (e) {}
          self._updateMode('P2P_BLE');
          self.config.onStatusChange('CHAT:' + (detail.name || ''));
          var bottomNav = document.getElementById('ble-bottom-nav');
          if (bottomNav) {
            var navItems = bottomNav.querySelectorAll('.ble-nav-item');
            navItems.forEach(function(n) { n.classList.remove('active'); });
            var chatsTab = bottomNav.querySelector('[data-tab="chats"]');
            if (chatsTab) chatsTab.classList.add('active');
          }
        } catch (handlerErr) {
          console.error('[NexoApp] Error en _bleChatHandler:', handlerErr);
          DEBUG.error('BLE_UI_001', 'Error en chat handler: ' + (handlerErr.message || 'unknown'));
        }
      };
      window.addEventListener('nexo:ble:openChat', this._bleChatHandler);

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

      this._nativeDeviceDisconnectedHandler = function(e) {
        try {
          self._updateMode('OFFLINE');
          self.config.onStatusChange('OFFLINE');
        } catch (err) {
          console.warn('[NexoApp] Error en _nativeDeviceDisconnectedHandler:', err);
        }
      };
      window.addEventListener('nexo:ble:deviceDisconnected', this._nativeDeviceDisconnectedHandler);

      this._bleMessageHandler = function(e) {
        try {
          var detail = e.detail || {};
          var localUUID = self.bleInterface && self.bleInterface.localDeviceUUID ? self.bleInterface.localDeviceUUID : '';
          var senderUUID = detail.deviceUUID || '';
          if (senderUUID && localUUID && _normId(senderUUID) === _normId(localUUID)) {
            console.log('[BLE_RECV] Mensaje propio ignorado por UUID');
            return;
          }
          console.log('[BLE_RECV] Mensaje de ' + (detail.senderName || '') + ': ' + (detail.content ? detail.content.substring(0, 30) : '') + '...');
          var resolvedName = detail.senderName;
          if (!resolvedName || resolvedName === 'NEXO Peer') {
            var nid = (detail.deviceId || '').toString().toLowerCase().trim();
            var connDev = self.bleInterface && self.bleInterface.connectedDevices ? self.bleInterface.connectedDevices.get(nid) : null;
            var foundDev = self.bleInterface && self.bleInterface.foundDevices ? self.bleInterface.foundDevices.get(nid) : null;
            resolvedName = (connDev && connDev.name) || (foundDev && foundDev.name) || detail.senderName || '';
          }
          var messageId = null;
          var content = detail.content || detail.data || '';
          if (content.charAt(0) === '{' || (detail.data && detail.data.charAt(0) === '{')) {
            try {
              var json = JSON.parse(detail.data || content || '{}');
              if (json.msgId) messageId = json.msgId;
              if (json.messageId) messageId = json.messageId;
              if (json.payload && json.payload.senderNexoId) senderUUID = json.payload.senderNexoId;
              if (json.payload && json.payload.text) content = json.payload.text;
              if (json.deviceUUID) senderUUID = json.deviceUUID;
              if (json.from && !senderUUID) senderUUID = json.from;
            } catch (e) {}
          }
          if (messageId && content && (content.indexOf('"type":"ack"') !== -1 || content.indexOf('"type":"read_receipt"') !== -1)) {
            try {
              var ctrl = JSON.parse(detail.content || detail.data || content);
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
          self._handleMessage({
            content: detail.content,
            sender: detail.deviceId,
            senderName: resolvedName,
            source: detail.source || 'ble_direct',
            timestamp: detail.timestamp || Date.now(),
            messageId: detail.messageId,
            deviceUUID: detail.deviceUUID || detail.deviceId,
            _own: false
          }, 'ble_direct');
          if (senderUUID && detail.messageId) {
            setTimeout(function() { self._sendACK(senderUUID, detail.messageId); }, 100);
          }
        } catch (handlerErr) {
          console.error('[NexoApp] Error en _bleMessageHandler:', handlerErr);
          DEBUG.error('BLE_UI_002', 'Error en message handler: ' + (handlerErr.message || 'unknown'));
        }
      };
      window.addEventListener('nexo:ble:messageReceived', this._bleMessageHandler);
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
      var self = this;
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
    /* === INPUT BAR v2 — Attach menu + Send/Mic toggle + Attach handlers === */
    self._initInputBarV2();
  }

  _initInputBarV2() {
    var self = this;
    var input = document.getElementById('message-input');
    var sendBtn = document.getElementById('send-btn');
    var attachBtn = document.getElementById('attach-btn');
    var attachMenu = document.getElementById('attach-menu');

    if (!input || !sendBtn) return;

    // Toggle Send / Mic según contenido
    function updateSendButton() {
      var text = (input.value || '').trim();
      if (text.length > 0) {
        sendBtn.classList.remove('mic-mode');
      } else {
        sendBtn.classList.add('mic-mode');
      }
    }
    input.addEventListener('input', updateSendButton);
    updateSendButton(); // estado inicial

    // Attach menu toggle
    if (attachBtn && attachMenu) {
      attachBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var isVisible = attachMenu.classList.contains('visible');
        if (isVisible) {
          attachMenu.classList.remove('visible');
          attachMenu.classList.add('hidden');
          attachBtn.classList.remove('active');
        } else {
          attachMenu.classList.remove('hidden');
          // Force reflow
          void attachMenu.offsetWidth;
          attachMenu.classList.add('visible');
          attachBtn.classList.add('active');
        }
      });

      // Cerrar menú al tocar fuera
      document.addEventListener('click', function(e) {
        if (!attachMenu.contains(e.target) && e.target !== attachBtn) {
          attachMenu.classList.remove('visible');
          attachMenu.classList.add('hidden');
          attachBtn.classList.remove('active');
        }
      });

      // === ATTACH HANDLERS REALES ===
      var menuItems = attachMenu.querySelectorAll('.attach-menu-item');
      menuItems.forEach(function(item) {
        item.addEventListener('click', function() {
          var type = item.getAttribute('data-type');
          attachMenu.classList.remove('visible');
          attachMenu.classList.add('hidden');
          attachBtn.classList.remove('active');

          // Helpers burbuja
          function getMessagesContainer() {
            return document.getElementById('messages-container');
          }
          function scrollToBottom() {
            var c = getMessagesContainer();
            if (c) c.scrollTop = c.scrollHeight;
          }
          function renderOwnBubble(htmlContent, typeLabel) {
            var container = getMessagesContainer();
            if (!container) { console.error('[Attach] No contenedor'); return; }
            var bubble = document.createElement('div');
            bubble.className = 'message own message-attachment';
            bubble.style.cssText = 'align-self:flex-end;max-width:75%;margin:6px 16px 6px auto;padding:8px;border-radius:18px;background:linear-gradient(135deg,#0082FC,#6B4EFF);color:#E5E5E5;font-size:14px;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:6px;';
            bubble.innerHTML = htmlContent + '<div style="font-size:10px;opacity:0.7;text-align:right;margin-top:4px;">' + typeLabel + '</div>';
            container.appendChild(bubble);
            scrollToBottom();
          }

          if (type === 'photo') {
            if (!window.Capacitor || !window.Capacitor.Plugins || !window.Capacitor.Plugins.Camera) {
              alert('Plugin Camera no disponible'); return;
            }
            var Camera = window.Capacitor.Plugins.Camera;
            Camera.getPhoto({
              quality: 90, allowEditing: false,
              resultType: Camera.CameraResultType.Base64,
              source: Camera.CameraSource.Prompt, saveToGallery: false
            }).then(function(image) {
              if (image && image.base64String) {
                var dataUrl = 'data:image/jpeg;base64,' + image.base64String;
                var html = '<div style="border-radius:12px;overflow:hidden;background:#000;"><img src="' + dataUrl + '" style="max-width:240px;max-height:300px;width:100%;height:auto;display:block;object-fit:cover;" alt="Foto"></div>';
                renderOwnBubble(html, '📷 Foto');
                window._lastAttachmentPayload = { type: 'image', data: dataUrl, width: image.width, height: image.height };
              }
            }).catch(function(err) {
              console.error('[FOTO] Error:', err);
              if (err.message && err.message.indexOf('cancelled') === -1) alert('Error foto: ' + err.message);
            });
          } else if (type === 'video') {
            var inputVid = document.createElement('input');
            inputVid.type = 'file'; inputVid.accept = 'video/*'; inputVid.style.display = 'none';
            inputVid.onchange = function(ev) {
              var file = ev.target.files[0]; if (!file) return;
              var url = URL.createObjectURL(file);
              var html = '<div style="border-radius:12px;overflow:hidden;background:#000;"><video src="' + url + '" style="max-width:240px;max-height:200px;width:100%;display:block;" controls preload="metadata"></video></div>';
              renderOwnBubble(html, '🎬 Video');
              window._lastAttachmentPayload = { type: 'video', file: file, url: url };
            };
            document.body.appendChild(inputVid); inputVid.click();
            setTimeout(function() { inputVid.remove(); }, 5000);
          } else if (type === 'file') {
            var inputFile = document.createElement('input');
            inputFile.type = 'file'; inputFile.style.display = 'none';
            inputFile.onchange = function(ev) {
              var file = ev.target.files[0]; if (!file) return;
              var sizeStr = file.size > 1024*1024 ? (file.size/(1024*1024)).toFixed(1) + ' MB' : (file.size/1024).toFixed(0) + ' KB';
              var html = '<div style="display:flex;align-items:center;gap:10px;padding:8px;background:rgba(0,0,0,0.2);border-radius:10px;"><div style="font-size:24px;">📄</div><div style="overflow:hidden;"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;">' + file.name + '</div><div style="font-size:11px;opacity:0.7;">' + sizeStr + '</div></div></div>';
              renderOwnBubble(html, '📎 Archivo');
              window._lastAttachmentPayload = { type: 'file', file: file };
            };
            document.body.appendChild(inputFile); inputFile.click();
            setTimeout(function() { inputFile.remove(); }, 5000);
          } else if (type === 'location') {
            if (!navigator.geolocation) { alert('Geolocalización no disponible'); return; }
            navigator.geolocation.getCurrentPosition(function(pos) {
              var lat = pos.coords.latitude, lng = pos.coords.longitude;
              var mapsUrl = 'https://www.google.com/maps?q=' + lat + ',' + lng;
              var html = '<a href="' + mapsUrl + '" target="_blank" style="text-decoration:none;color:inherit;"><div style="background:rgba(0,0,0,0.2);border-radius:10px;padding:10px;display:flex;align-items:center;gap:10px;"><div style="font-size:28px;">📍</div><div><div style="font-weight:600;">Mi ubicación</div><div style="font-size:11px;opacity:0.8;">' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '</div></div></div></a>';
              renderOwnBubble(html, '🌍 Ubicación');
              window._lastAttachmentPayload = { type: 'location', lat: lat, lng: lng };
            }, function(err) { alert('Error ubicación: ' + err.message); }, { enableHighAccuracy: true, timeout: 10000 });
          }
        });
      });
    }

    // Mic button placeholder
    sendBtn.addEventListener('click', function(e) {
      if (sendBtn.classList.contains('mic-mode')) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[NEXO] Mic presionado — placeholder');
        return;
      }
      // Si es modo send, el handler original de sendMessage ya existe
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
    if (cid.indexOf('nx') !== 0 && window.bleInterface && window.bleInterface.getContacts) {
      var contacts = window.bleInterface.getContacts();
      var found = contacts.find(function(c) { return _normId(c.deviceId) === cid; });
      if (found && found.deviceUUID) cid = _normId(found.deviceUUID);
    }
    if (!cid) return;
    try {
      await vaultAppendMessage(cid, {
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
    } catch (e) {
      console.warn('[NexoApp] Error guardando mensaje:', e.message);
    }
  }

  async _loadMessagesFromVault(contactId) {
    try {
      var cid = _normId(contactId);
      if (!cid) return [];
      var raw = await vaultLoadMessages(cid);
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
      await vaultUpdateMessageStatus(cid, messageId, status);
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
      var targetId = recipient || (this.activeContact ? this.activeContact.id : null);
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
          await withTimeoutNAP(this.bleInterface.sendChatMessage(targetId, content, messageId), 15000, 'BLE.sendChatMessage');
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
      return false;
    } catch (err) {
      DEBUG.error('APP_008', 'SendMessage critical: ' + (err.message || 'unknown'));
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
          this._messageDedupMap.forEach(function(v, k) {
            if (v < oldestTime) { oldestTime = v; oldestKey = k; }
          });
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
      var vaultContactId = enriched._own ? enriched.recipient : (enriched.deviceUUID || enriched.sender);
      if (!vaultContactId && !enriched._own && enriched.sender && window.bleInterface && window.bleInterface.getContacts) {
        var contacts = window.bleInterface.getContacts();
        var found = contacts.find(function(c) { return _normId(c.deviceId) === _normId(enriched.sender); });
        if (found && found.deviceUUID) vaultContactId = _normId(found.deviceUUID);
      }
      if (vaultContactId) this._saveMessageToVault(vaultContactId, enriched);
      if (!enriched._own && this.activeContact && enriched.sender === this.activeContact.id && enriched.messageId) {
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
    if (this._bleChatHandler) {
      try { window.removeEventListener('nexo:ble:openChat', this._bleChatHandler); } catch(e) {}
      this._bleChatHandler = null;
    }
    if (this._chatBackHandler) {
      var chatBackBtn = document.getElementById('chat-back-btn');
      if (chatBackBtn) chatBackBtn.removeEventListener('click', this._chatBackHandler);
      this._chatBackHandler = null;
    }
    if (this._bleMessageHandler) {
      try { window.removeEventListener('nexo:ble:messageReceived', this._bleMessageHandler); } catch(e) {}
      this._bleMessageHandler = null;
    }
    if (this.bleInterface) {
      try { this.bleInterface.destroy(); } catch(e) {}
      this.bleInterface = null;
    }
    if (this.nordicMesh) {
      this._resources.handlers.forEach(function(unsub) { try { unsub(); } catch(e) {} });
      try { if (this.nordicMesh.destroy) await this.nordicMesh.destroy(); } catch(e) {}
      this.nordicMesh = null;
    }
    if (this.mesh) { try { this.mesh.destroy(); } catch(e) {} this.mesh = null; }
    if (this.wsClient) { try { if (this.wsClient.disconnect) await this.wsClient.disconnect(); } catch(e) {} this.wsClient = null; }
    if (this.vault) { try { if (this.vault.destroy) await this.vault.destroy(); } catch(e) {} this.vault = null; }
    this._resources.timers.forEach(function(t) { clearTimeout(t); });
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

/*
Focos de Interés:
1. FIX v5.0.12: Silenciar toasts rem.info/warn/error/success
2. FIX v5.0.12: Deduplicación de contactos por MAC
3. Implementación de infraestructura ACK completa (pending/sent/delivered/read)
4. Eliminación de la doble pantalla (no appendItems en TheStream)
5. Envío de ACK automático al recibir mensaje BLE
6. Envío de Read Receipt cuando el chat está activo con el remitente
7. Corrección de la firma del método _sendACK y _sendReadReceipt (remoción de *)
8. FIX: Contactos en pantalla principal (no en panel BLE)
9. FIX: Al cerrar chat vuelve a principal, no reabre panel BLE
10. FIX v5.0.13: Persistencia async/await para vault_fs
11. FIX-BACK: Cerrar panel BLE al hacer back desde chat
12. INPUT BAR v2: Attach menu + Send/Mic toggle
13. FIX v5.0.17: Attach handlers (Foto/Video/Archivo/Ubicación) renderizan burbuja local
*/
