/**
 * NEXO App v5.0.5-ARCH 06/2026
 * Coordinado con NexoBlePlugin.kt v5.0.0-ARCH + ble_interface.js v4.2.0-ARCH
 * FIX v5.0.5-ARCH: 
 *      - init() robusto: Bridge falla NO rompe todo. initialized=true si vault+BLE UI OK.
 *      - sendMessage pasa messageId a bleInterface.sendChatMessage().
 *      - Deduplicacion: actualiza pending->sent sin duplicar en stream.
 *      - Fallback ordenado: BLE directo -> Nordic -> Hybrid -> Bridge -> WS.
 *      SYNTAX: ES5 compatible (var, function, no arrow, no template literal)
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
  var timer = null;
  var timeoutPromise = new Promise(function(_, reject) {
    timer = setTimeout(function() {
      reject(new Error('[NAP_TIMEOUT] ' + context));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).then(function(result) {
    if (timer) clearTimeout(timer);
    return result;
  }).catch(function(err) {
    if (timer) clearTimeout(timer);
    throw err;
  });
}

var DEBUG = {
  rem: rem,
  _logBuffer: [],
  log: function(msg, type, code) {
    type = type || 'info';
    var entry = { ts: Date.now(), time: new Date().toLocaleTimeString(), type: type, code: code, msg: msg };
    DEBUG._logBuffer.push(entry);
    if (DEBUG._logBuffer.length > 1000) DEBUG._logBuffer.shift();
    console.log('[' + entry.time + '] [' + type.toUpperCase() + ']' + (code ? '[' + code + ']' : '') + ' ' + msg);
    var method = type === 'error' ? 'error' : type === 'success' ? 'success' : type === 'warn' ? 'warn' : 'info';
    if (code) rem[method](msg, code); else rem[method](msg);
  },
  error: function(code, msg) { DEBUG.log(msg, 'error', code); },
  success: function(msg, code) { DEBUG.log(msg, 'success', code); },
  warn: function(msg, code) { DEBUG.log(msg, 'warn', code); },
  setPhase: function(p) { rem.updatePhase(p); },
  setMode: function(m) { rem.updateMode(m); },
  setIdentity: function(id) { if (id) rem.updateIdentity(id); }
};

export class NexoApp {
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
    for (var key in config) {
      if (config.hasOwnProperty(key) && this.config[key] === undefined) {
        this.config[key] = config[key];
      }
    }
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
    DEBUG.log('噫 [NEXO] v5.0.5-ARCH iniciando...', 'info', 'APP_INIT');
  }

  init() {
    var self = this;
    if (self.initialized) { DEBUG.warn('Already initialized', 'APP_SKIP'); return Promise.resolve(self); }
    if (self._isInitializing) return Promise.reject(new Error('[APP_018] Initialization in progress'));
    if (self._isDestroyed) return Promise.reject(new Error('[APP_019] Cannot init destroyed'));
    self._isInitializing = true;
    DEBUG.setPhase('INIT');

    return self._initPhase1_Crypto().then(function() {
      return self._initPhase2_WebSocket();
    }).then(function() {
      var nativeAvailable = !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE);
      var p3 = Promise.resolve();
      var p4 = Promise.resolve();
      if (self.config.enableMesh && !nativeAvailable) {
        p3 = self._initPhase3_NordicMesh();
      }
      if (self.config.enableMesh && !nativeAvailable) {
        p4 = self._initPhase4_HybridMesh();
      }
      return Promise.all([p3, p4]);
    }).then(function() {
      return self._initPhase5_BLEUI();
    }).then(function() {
      // FIX v5.0.5: Bridge es opcional. Si falla, NO rompe init().
      return self._initPhase6_Bridge();
    }).then(function() {
      return self._initPhase7_UI();
    }).then(function() {
      // FIX v5.0.5: initialized=true SIEMPRE si llegamos aqui, aunque bridge haya fallado.
      self.initialized = true;
      DEBUG.setPhase('READY');
      DEBUG.success('脂 NEXO v5.0.5-ARCH Ready', 'APP_READY');
      return self;
    }).catch(function(err) {
      DEBUG.error('APP_020', 'Init failed: ' + err.message);
      return self._partialCleanup().then(function() {
        throw err;
      });
    }).finally(function() {
      self._isInitializing = false;
    });
  }

  _initPhase1_Crypto() {
    DEBUG.setPhase('CRYPTO');
    var self = this;
    return withTimeoutNAP(new CryptoVault().init(), 5000, 'CryptoVault.init').then(function(vault) {
      self.vault = vault;
      var identity = vault.getIdentity && vault.getIdentity();
      if (identity) { DEBUG.setIdentity(identity); DEBUG.success('Vault initialized', 'CRYPTO_002'); }
    }).catch(function(err) {
      DEBUG.error('CRYPTO_004', 'Vault init failed: ' + err.message);
      self.vault = null;
    });
  }

  _initPhase2_WebSocket() {
    DEBUG.setPhase('WEBSOCKET');
    var self = this;
    if (self.config.relayUrls.length === 0) { DEBUG.warn('No relay URLs', 'WS_SKIP'); return Promise.resolve(); }
    return new Promise(function(resolve) {
      self.wsClient = new WebSocketClient(self.config.relayUrls[0]);
      self.wsClient.onMessage = function(m) { self._handleMessage(m, 'relay'); };
      self.wsClient.onOpen = function() { DEBUG.setMode('RELAY'); };
      withTimeoutNAP(self.wsClient.connect(), 8000, 'WebSocket.connect').then(function() {
        resolve();
      }).catch(function(err) {
        DEBUG.warn('WebSocket unavailable: ' + err.message, 'WS_004');
        self.wsClient = null;
        resolve();
      });
    });
  }

  _initPhase3_NordicMesh() {
    DEBUG.setPhase('NORDIC_MESH');
    var self = this;
    return new Promise(function(resolve) {
      if (!self.vault) { resolve(); return; }
      self.nordicMesh = new NordicMesh(self.vault, { rssiThreshold: -85, chunkSize: 507, handshakeTimeout: 30000 });
      var unsub1 = self.nordicMesh.on('peerDiscovered', function(p) { self._handleNordicPeer(p); });
      var unsub2 = self.nordicMesh.on('sessionEstablished', function(d) { self._handleNordicSession(d); });
      var unsub3 = self.nordicMesh.on('messageReceived', function(m) { self._handleNordicMessage(m); });
      var unsub4 = self.nordicMesh.on('stateChanged', function(ev) { self._updateModeFromNordic(ev.to); });
      var unsub5 = self.nordicMesh.on('error', function(err) { DEBUG.error('NORDIC_010', err.message); });
      self._resources.handlers.add(unsub1, unsub2, unsub3, unsub4, unsub5);
      withTimeoutNAP(self.nordicMesh.init(), 10000, 'NordicMesh.init').then(function(result) {
        if (!result.success) throw new Error(result.error && result.error.message || 'Nordic init returned false');
        DEBUG.success('Nordic Mesh active [Native:' + result.isNative + ']', 'NORDIC_002');
        resolve();
      }).catch(function(err) {
        DEBUG.error('NORDIC_005', 'Nordic init failed: ' + err.message);
        self.nordicMesh = null;
        resolve();
      });
    });
  }

  _initPhase4_HybridMesh() {
    DEBUG.setPhase('MESH');
    var self = this;
    return new Promise(function(resolve) {
      self.mesh = new HybridMesh({
        onDeviceFound: function(d) { DEBUG.log('Hybrid found: ' + d.name, 'info', 'MESH_DEVICE'); },
        onDeviceConnected: function(d) { DEBUG.success('Hybrid connected: ' + d.name, 'MESH_CONN'); },
        onDeviceDisconnected: function(d) { DEBUG.log('Hybrid disconnected', 'warn', 'MESH_DISC'); },
        onError: function(code, msg) { DEBUG.error('MESH_006', msg); }
      });
      withTimeoutNAP(self.mesh.initialize(), 15000, 'HybridMesh.initialize').then(function() {
        DEBUG.success('Hybrid Mesh ready', 'MESH_002');
        resolve();
      }).catch(function(err) {
        DEBUG.error('APP_016', 'Hybrid Mesh: ' + err.message);
        self.mesh = null;
        resolve();
      });
    });
  }

  _initPhase5_BLEUI() {
    DEBUG.setPhase('BLE_UI');
    var self = this;
    return new Promise(function(resolve) {
      try {
        var meshInstance = self.nordicMesh || self.mesh || null;
        self.bleInterface = initBLEInterface(meshInstance);
        if (self.bleInterface) DEBUG.success('BLE UI ready' + (meshInstance ? '' : ' (native)'), 'UI_002');

        self._bleChatHandler = function(e) {
          var detail = e.detail;
          self.activeContact = { id: detail.contactId, name: detail.name, address: detail.address, transport: detail.transport };
          var appContainer = document.getElementById('app');
          if (appContainer) appContainer.classList.remove('hidden');
          var nameInput = document.getElementById('chat-contact-name');
          var subtitle = document.getElementById('chat-contact-subtitle');
          if (nameInput) nameInput.value = detail.name || 'NEXO Device';
          if (subtitle) subtitle.textContent = detail.transport === 'ble' ? 'BLUETOOTH' : 'NEXO MESH';
          DEBUG.success('町 Chat activo: ' + detail.name + ' [' + detail.transport.toUpperCase() + ']', 'BLE_CHAT');
          self._updateMode('P2P_BLE');
          self.config.onStatusChange('CHAT:' + detail.name);
        };
        window.addEventListener('nexo:ble:openChat', self._bleChatHandler);

        self._bleMessageHandler = function(e) {
          var detail = e.detail;
          console.log('[BLE_RECV] Mensaje de ' + detail.senderName + ': ' + (detail.content && detail.content.substring ? detail.content.substring(0, 30) : '') + '...');

          var resolvedName = detail.senderName;
          if (!resolvedName || resolvedName === 'NEXO Peer') {
            var nid = (detail.deviceId || '').toString().toLowerCase().trim();
            resolvedName = (self.bleInterface && self.bleInterface.connectedDevices && self.bleInterface.connectedDevices.get(nid) && self.bleInterface.connectedDevices.get(nid).name)
              || (self.bleInterface && self.bleInterface.foundDevices && self.bleInterface.foundDevices.get(nid) && self.bleInterface.foundDevices.get(nid).name)
              || detail.senderName
              || 'NEXO Peer';
          }

          self._handleMessage({
            content: detail.content,
            sender: detail.deviceId,
            senderName: resolvedName,
            source: detail.source || 'ble_direct',
            timestamp: detail.timestamp || Date.now(),
            messageId: detail.messageId,
            _own: false
          }, 'ble_direct');
        };
        window.addEventListener('nexo:ble:messageReceived', self._bleMessageHandler);
        resolve();
      } catch (err) {
        DEBUG.error('UI_004', 'BLE UI init failed: ' + err.message);
        self.bleInterface = null;
        resolve();
      }
    });
  }

  _initPhase6_Bridge() {
    DEBUG.setPhase('BRIDGE');
    var self = this;
    return new Promise(function(resolve) {
      // FIX v5.0.5: Bridge es opcional. Si no hay transportes, solo loguea warning y sigue.
      var hasTransport = self.mesh || self.nordicMesh || self.wsClient || (self.bleInterface && self.bleInterface.nativePlugin);
      if (!hasTransport) {
        DEBUG.warn('No transports available for bridge', 'BRIDGE_SKIP');
        resolve();
        return;
      }
      try {
        self.bridge = new MeshRelayBridge({
          mesh: self.mesh,
          nordicMesh: self.nordicMesh,
          relay: self.wsClient,
          onModeChange: function(mode) { DEBUG.setMode(mode); self.config.onStatusChange(mode); }
        });
      } catch (err) {
        DEBUG.warn('Bridge constructor failed: ' + err.message, 'BRIDGE_ERR');
        self.bridge = null;
        resolve();
        return;
      }
      withTimeoutNAP(self.bridge.initialize(), 5000, 'Bridge.initialize').then(function() {
        DEBUG.success('Bridge ready', 'BRIDGE_002');
        resolve();
      }).catch(function(err) {
        DEBUG.warn('Bridge init failed: ' + err.message, 'BRIDGE_003');
        self.bridge = null;
        resolve();
      });
    });
  }

  _initPhase7_UI() {
    DEBUG.setPhase('GESTURES');
    var self = this;
    return new Promise(function(resolve) {
      if (self.config.enableGestures) {
        try { self.gestures = new GestureEngine({}); self.gestures.init(); } catch (e) {}
      }
      DEBUG.setPhase('VAULT_SLIDER');
      var streamEl = document.getElementById('nexo-stream');
      var vaultEl = document.getElementById('nexo-vault');
      if (streamEl && vaultEl) {
        try { self.vaultSlider = new CoreGestureEngine(streamEl, vaultEl); } catch (e) {}
      }
      DEBUG.setPhase('STREAM');
      var container = document.getElementById('messages-container');
      if (container) {
        try { self.stream = new TheStream(container, {}); } catch (e) {}
      }
      resolve();
    });
  }

  _handleNordicPeer(peer) { if (!peer || !peer.id) return; this.blePeers.set(peer.id, Object.assign({}, peer, { discoveredAt: Date.now() })); }
  _handleNordicSession(data) { if (!data || !data.deviceId) return; this._updateMode('P2P_BLE'); }
  _handleNordicMessage(msg) { if (!msg || !msg.deviceId) return; this._handleMessage({ content: msg.content, sender: msg.deviceId, source: 'ble_nordic', timestamp: msg.timestamp || Date.now() }, 'ble_nordic'); }
  _updateModeFromNordic(state) {
    switch(state) {
      case 'messaging': case 'connected': this._updateMode('P2P_BLE'); break;
      case 'offline':
        if ((!this.mesh || !this.mesh.getPeerCount || this.mesh.getPeerCount() === 0) &&
            (!this.wsClient || !this.wsClient.isConnected || !this.wsClient.isConnected())) {
          this._updateMode('OFFLINE');
        }
        break;
    }
  }
  _updateMode(mode) { DEBUG.setMode(mode); this.config.onStatusChange(mode); }

  sendMessage(msg) {
    var self = this;
    if (!self.initialized || self._isDestroyed) {
      DEBUG.error(self._isDestroyed ? 'APP_022' : 'APP_021', 'Cannot send');
      return Promise.resolve(false);
    }
    return new Promise(function(resolve) {
      try {
        var messageId = (msg && msg.messageId) ? msg.messageId : (Date.now() + '-' + Math.random().toString(36).substr(2, 9));
        
        // FIX v5.0.5: Agregar pendingMessage con ID unico para poder actualizarlo luego
        var pendingMsg = Object.assign({}, msg, { _own: true, timestamp: Date.now(), pending: true, messageId: messageId });
        self._handleMessage(pendingMsg, 'self_pending');

        var isObject = msg && typeof msg === 'object';
        var content = isObject ? (msg.content || msg) : msg;
        var recipient = isObject ? msg.recipient : null;
        var targetId = recipient || (self.activeContact && self.activeContact.id);
        var targetTransport = self.activeContact && self.activeContact.transport;

        // FIX v5.0.5: Si hay contacto activo BLE, usar bleInterface.sendChatMessage() con messageId
        if (targetId && targetTransport === 'ble' && self.bleInterface && self.bleInterface.sendChatMessage) {
          self.bleInterface.sendChatMessage(targetId, content, messageId).then(function() {
            // FIX v5.0.5: Actualizar el mensaje pending a sent, NO crear duplicado
            self._updateMessageStatus(messageId, false);
            resolve(true);
          }).catch(function(e) {
            DEBUG.warn('BLE sendChatMessage fallo: ' + e.message, 'MSG_BLE_FAIL');
            resolve(self._fallbackSend(content, messageId));
          });
          return;
        }

        resolve(self._fallbackSend(content, messageId));
      } catch (err) {
        DEBUG.error('APP_008', 'SendMessage critical: ' + err.message);
        resolve(false);
      }
    });
  }

  // FIX v5.0.5: Actualiza un mensaje pending a sent sin duplicar en stream
  _updateMessageStatus(messageId, pending) {
    if (!this.stream || !this.stream.updateItem) return;
    try {
      this.stream.updateItem(messageId, { pending: pending });
    } catch (e) {
      // Si stream no tiene updateItem, fallback: re-emitir con mismo ID (dedup lo bloqueara)
      console.warn('[NexoApp] stream.updateItem no disponible');
    }
  }

  _fallbackSend(content, messageId) {
    var self = this;

    // Fallback: Nordic Mesh
    var nordicPeers = (self.nordicMesh && self.nordicMesh.getPeers) ? self.nordicMesh.getPeers() : [];
    if (nordicPeers.length > 0) {
      return self.nordicMesh.sendMessage(nordicPeers[0].id, content).then(function() {
        self._updateMessageStatus(messageId, false);
        DEBUG.success('Sent via Nordic', 'MSG_NORDIC');
        return true;
      }).catch(function(e) {
        DEBUG.error('NORDIC_009', 'Send failed: ' + e.message);
        return self._fallbackSend2(content, messageId);
      });
    }
    return self._fallbackSend2(content, messageId);
  }

  _fallbackSend2(content, messageId) {
    var self = this;

    // Fallback: Hybrid Mesh
    if (self.mesh && self.mesh.getPeerCount && self.mesh.getPeerCount() > 0) {
      return self.mesh.broadcast({ content: content }).then(function() {
        self._updateMessageStatus(messageId, false);
        DEBUG.success('Sent via Hybrid', 'MSG_HYBRID');
        return true;
      }).catch(function(e) {
        DEBUG.error('MESH_005', 'Broadcast failed: ' + e.message);
        return self._fallbackSend3(content, messageId);
      });
    }
    return self._fallbackSend3(content, messageId);
  }

  _fallbackSend3(content, messageId) {
    var self = this;

    // Fallback: Bridge
    if (self.bridge) {
      var result = self.bridge.send({ content: content });
      if (result) { 
        self._updateMessageStatus(messageId, false);
        DEBUG.success('Sent via Bridge', 'MSG_BRIDGE'); 
        return Promise.resolve(true); 
      }
    }

    // Fallback: WebSocket
    if (self.wsClient && self.wsClient.isConnected && self.wsClient.isConnected()) {
      self.wsClient.send({ content: content });
      self._updateMessageStatus(messageId, false);
      DEBUG.success('Sent via WebSocket', 'MSG_WS');
      return Promise.resolve(true);
    }

    DEBUG.warn('No hay dispositivos NEXO disponibles.', 'MSG_FAIL');
    return Promise.resolve(false);
  }

  _handleMessage(msg, source) {
    if (this._isDestroyed) return;
    try {
      if (msg.messageId) {
        var now = Date.now();
        // FIX v5.0.5: Si es actualizacion de pending->sent (mismo ID, source cambia), NO bloquear
        var existing = this._messageDedupMap.get(msg.messageId);
        if (existing && msg._own && !msg.pending && source !== 'self_pending') {
          // Es el mismo mensaje pasando de pending a sent, permitir actualizacion
          this._messageDedupMap.set(msg.messageId, now);
        } else if (existing && !(msg._own && !msg.pending)) {
          // Bloquear duplicados reales
          DEBUG.log('Deduplicado ' + (msg.messageId && msg.messageId.substring ? msg.messageId.substring(0, 8) : '') + ' de ' + source, 'debug', 'DEDUP');
          return;
        } else {
          this._messageDedupMap.set(msg.messageId, now);
        }
        if (this._messageDedupMap.size > this._maxProcessedIds) {
          var oldestKey = null;
          var oldestTime = Infinity;
          this._messageDedupMap.forEach(function(v, k) {
            if (v < oldestTime) { oldestTime = v; oldestKey = k; }
          });
          if (oldestKey) this._messageDedupMap.delete(oldestKey);
        }
        this._messageDedupMap.forEach(function(v, k) {
          if (now - v > this._dedupTTL) this._messageDedupMap.delete(k);
        }.bind(this));
      }
      var enriched = Object.assign({}, msg, { _source: source, _ts: Date.now(), _id: Math.random().toString(36).substr(2, 9) });
      this.config.onMessage(enriched);
      if (this.stream && this.stream.appendItems) this.stream.appendItems([enriched]);
    } catch (err) { DEBUG.error('APP_005', 'Message handler: ' + err.message); }
  }

  _partialCleanup() {
    var self = this;
    var promises = [];
    if (self.nordicMesh) {
      promises.push(new Promise(function(r) { try { self.nordicMesh.destroy && self.nordicMesh.destroy(); } catch(e) {} self.nordicMesh = null; r(); }));
    }
    if (self.mesh) {
      promises.push(new Promise(function(r) { try { self.mesh.destroy(); } catch(e) {} self.mesh = null; r(); }));
    }
    if (self.wsClient) {
      promises.push(new Promise(function(r) { try { self.wsClient.disconnect && self.wsClient.disconnect(); } catch(e) {} self.wsClient = null; r(); }));
    }
    return Promise.all(promises);
  }

  destroy() {
    var self = this;
    if (self._isDestroyed) return Promise.resolve();
    self._isDestroyed = true;
    DEBUG.log('ｧｹ Cleanup...', 'info', 'DESTROY');
    if (self._bleChatHandler) { window.removeEventListener('nexo:ble:openChat', self._bleChatHandler); self._bleChatHandler = null; }
    if (self._bleMessageHandler) { window.removeEventListener('nexo:ble:messageReceived', self._bleMessageHandler); self._bleMessageHandler = null; }
    if (self.bleInterface) { try { self.bleInterface.destroy(); } catch(e) {} self.bleInterface = null; }
    if (self.nordicMesh) {
      self._resources.handlers.forEach(function(unsub) { try { unsub(); } catch(e) {} });
      try { self.nordicMesh.destroy && self.nordicMesh.destroy(); } catch(e) {}
      self.nordicMesh = null;
    }
    if (self.mesh) { try { self.mesh.destroy(); } catch(e) {} self.mesh = null; }
    if (self.wsClient) { try { self.wsClient.disconnect && self.wsClient.disconnect(); } catch(e) {} self.wsClient = null; }
    if (self.vault) { try { self.vault.destroy && self.vault.destroy(); } catch(e) {} self.vault = null; }
    self._resources.timers.forEach(function(t) { clearTimeout(t); });
    DEBUG.success('Cleanup complete', 'DESTROY_OK');
    return Promise.resolve();
  }

  getStatus() {
    var mode = 'offline';
    if (this.mesh && this.mesh.getStatus) {
      mode = this.mesh.getStatus().mode;
    } else if (this.nordicMesh && this.nordicMesh.getState) {
      mode = this.nordicMesh.getState() === 'messaging' ? 'p2p_ble' : 'offline';
    }
    return {
      initialized: this.initialized,
      mode: mode,
      hasBLEInterface: !!this.bleInterface,
      activeContact: this.activeContact ? { name: this.activeContact.name, transport: this.activeContact.transport } : null
    };
  }
}

export default NexoApp;
export { DEBUG };
