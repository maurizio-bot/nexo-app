/**
 * NEXO App v5.0.21-SEQFIX
 * Base v5.0.19 - Lógica pura, ZERO persistencia
 * FIX: _sendMessage usa payload con seq
 * FASE4: App pura, delega todo vault a main.js
 */

import { NEXO_CONFIG } from '../core/nexo_config.js';
import { DEBUG } from '../core/nap.js';

var _contacts = [];
var _activeContact = null;
var _messageQueue = [];
var _isReady = false;
var _pendingCallbacks = [];
var _bleInterface = null;
var _ackSystem = null;
var _paymentCallbacks = {};

function _executeWhenReady(fn) {
  if (_isReady && fn) fn();
  else if (fn) _pendingCallbacks.push(fn);
}

export class NexoApp {
  constructor() {
    console.log('[NEXO] App v5.0.21-SEQFIX constructor');
    this.version = '5.0.21-SEQFIX';
    this.initialized = false;
    this.activeContact = null;
    this.bleInterface = null;
    this._listeners = {};
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    var idx = this._listeners[event].indexOf(callback);
    if (idx !== -1) this._listeners[event].splice(idx, 1);
  }

  _emit(event, data) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(function(cb) {
      try { cb(data); } catch(e) {}
    });
  }

  init() {
    var self = this;
    console.log('[NEXO] App.init() v5.0.21-SEQFIX');
    try {
      if (window.NEXO && window.NEXO.diag && typeof window.NEXO.diag.hideSplash === 'function') {
        window.NEXO.diag.hideSplash();
      }
      _isReady = true;
      _pendingCallbacks.forEach(function(fn) { try { fn(); } catch(e) {} });
      _pendingCallbacks = [];
      self.initialized = true;
      console.log('[NEXO] App inicializada correctamente');
    } catch (e) {
      console.error('[NEXO] App.init() error:', e);
    }
  }

  setBLEInterface(bleInterface) {
    this.bleInterface = bleInterface;
    _bleInterface = bleInterface;
    console.log('[NEXO] BLE Interface asignada');
  }

  setAckSystem(ackSystem) {
    this._ackSystem = ackSystem;
    _ackSystem = ackSystem;
  }

  get contacts() { return _contacts; }
  get activeContact() { return _activeContact; }

  setActiveContact(contact) {
    _activeContact = contact;
    this.activeContact = contact;
    if (contact) {
      window.dispatchEvent(new CustomEvent('nexo:contactSelected', { detail: contact }));
    }
  }

  addContact(contact) {
    if (!contact || !contact.nexoId) {
      console.warn('[NEXO] addContact: contacto inválido');
      return null;
    }
    var existing = _contacts.find(function(c) { return c.nexoId === contact.nexoId; });
    if (existing) {
      Object.assign(existing, contact);
      return existing;
    }
    _contacts.push(contact);
    window.dispatchEvent(new CustomEvent('nexo:contactAdded', { detail: contact }));
    return contact;
  }

  removeContact(nexoId) {
    var idx = _contacts.findIndex(function(c) { return c.nexoId === nexoId; });
    if (idx !== -1) {
      _contacts.splice(idx, 1);
      if (_activeContact && _activeContact.nexoId === nexoId) {
        _activeContact = null;
        this.activeContact = null;
      }
      window.dispatchEvent(new CustomEvent('nexo:contactRemoved', { detail: { nexoId: nexoId } }));
    }
  }

  findContact(nexoId) {
    return _contacts.find(function(c) { return c.nexoId === nexoId; });
  }

  sendMessage(msg) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        if (!msg || !msg.content) {
          reject(new Error('Mensaje inválido'));
          return;
        }
        var contactId = _activeContact ? _activeContact.nexoId : null;
        if (!contactId) {
          reject(new Error('No hay contacto activo'));
          return;
        }
        if (_bleInterface && _bleInterface.sendChatMessage) {
          _bleInterface.sendChatMessage(contactId, msg.content, msg.msgId || msg.messageId)
            .then(resolve)
            .catch(reject);
        } else {
          reject(new Error('BLE Interface no disponible'));
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  onMessage(msg) {
    this._emit('message', msg);
  }

  openAddContact() {
    window.dispatchEvent(new CustomEvent('nexo:openAddContact'));
  }

  closeChat() {
    _activeContact = null;
    this.activeContact = null;
    window.dispatchEvent(new CustomEvent('nexo:chatClosed'));
  }

  openChat(contact) {
    if (contact) {
      this.setActiveContact(contact);
    }
    window.dispatchEvent(new CustomEvent('nexo:openChat', { detail: contact || _activeContact }));
  }

  showPaymentModal() {
    window.dispatchEvent(new CustomEvent('nexo:showPaymentModal'));
  }

  _bleMessageHandler(detail) {
    try {
      var senderUUID = detail.deviceUUID || detail.senderNexoId || detail.deviceId || '';
      var resolvedName = detail.senderName || 'NEXO';
      var msg = {
        msgId: detail.messageId || detail.msgId || ('msg_' + Date.now()),
        messageId: detail.messageId || detail.msgId || ('msg_' + Date.now()),
        content: detail.content || '',
        senderNexoId: senderUUID,
        senderName: resolvedName || detail.senderName || 'NEXO',
        timestamp: detail.timestamp || Date.now(),
        _own: false,
        status: 'delivered',
        deviceId: detail.deviceId || '',
        seq: detail.seq
      };
      this.onMessage(msg);
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', { detail: msg }));
    } catch (e) {
      console.warn('[NEXO] _bleMessageHandler error:', e);
    }
  }

  _bleDeviceConnectedHandler(detail) {
    window.dispatchEvent(new CustomEvent('nexo:ble:deviceConnected', { detail: detail }));
  }

  _bleDeviceDisconnectedHandler(detail) {
    window.dispatchEvent(new CustomEvent('nexo:ble:deviceDisconnected', { detail: detail }));
  }

  _paymentRequestHandler(detail) {
    window.dispatchEvent(new CustomEvent('nexo:payment:request', { detail: detail }));
  }

  _paymentResponseHandler(detail) {
    window.dispatchEvent(new CustomEvent('nexo:payment:response', { detail: detail }));
  }
}

export { NexoApp, DEBUG };
