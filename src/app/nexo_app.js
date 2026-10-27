/**
 * NEXO App v5.0.23-FIX
 * FIX: Eliminado doble vaultAppendMessage (persistencia unificada en BLEInterface)
 * FIX: Eliminado _resendPendingMessages duplicado (gestión unificada en BLEInterface)
 * FIX: _bleMessageHandler simplificado — solo filtra ACKs y loguea
 * Base: v5.0.22-ACKFIX
 * Ronda 2796: borrado el prototipo MUERTO de pagos/transferencias (payment/transfer, modal, firma inventada):
 *   no tenía UI que lo disparara (ningún código emitía 'nexo:payment:*') y tenía un bug (`self` sin definir en
 *   _showPaymentModal). Los cobros reales son el adjunto 'cobro' (src/ui/cobro.js, sin custodia ni licencia).
 */

import { NEXO_CONFIG } from '../core/nexo_config.js';
import { NEXO_DIAG } from '../core/nap.js';
// Texto que viene de otro teléfono: nunca como HTML
function _esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

var DEBUG = window.DEBUG || {
  log: function() {},
  warn: function() {},
  error: function() {},
  info: function() {},
  success: function() {}
};

var _isGettingLocation = false;
var _lastLocationSent = 0;
var _LOCATION_DEBOUNCE_MS = 3000;

export class NexoApp {
  constructor(config) {
    this.config = config || {};
    this.bleInterface = null;
    this.activeContact = null;
    this.onMessage = this.config.onMessage || function() {};
    this.onStatusChange = this.config.onStatusChange || function() {};
    this.onError = this.config.onError || function() {};
    this.onVaultStateChange = this.config.onVaultStateChange || function() {};
    this.actionCallbacks = this.config.actionCallbacks || {};
    this._bleMessageHandler = null;
    console.log('[NEXO] App v5.0.23-FIX constructor');
  }

  init() {
    var self = this;
    return new Promise(function(resolve) {
      try {
        self._setupBLEListeners();
        self._setupVaultListeners();
        resolve();
      } catch (e) {
        console.error('[NEXO] init error:', e);
        resolve();
      }
    });
  }

  _setupBLEListeners() {
    var self = this;
    if (!window.bleInterface) {
      console.warn('[NEXO] bleInterface no disponible');
      return;
    }
    self.bleInterface = window.bleInterface;
    self._bleMessageHandler = function(e) {
      try {
        var detail = e.detail || {};
        var content = detail.content || detail.data || '';
        var ctrl = null;
        try {
          if (content && content.charAt(0) === '{') ctrl = JSON.parse(content);
        } catch (e) { ctrl = null; }
        if (ctrl && (ctrl.type === 'ack' || ctrl.type === 'read_receipt')) {
          var ackMid = ctrl.msgId || ctrl.messageId || ctrl.id || null;
          if (ackMid) {
            if (ctrl.type === 'ack') self._handleACK(ackMid, ctrl.ackType || 'delivered');
            if (ctrl.type === 'read_receipt') self._handleACK(ackMid, 'read');
          }
          return;
        }
        // Solo log y delegación — la persistencia y render los hacen BLEInterface y main.js
        // Seguridad: nunca el contenido ni el nombre en los registros (se guardan y se copian en el diagnóstico)
        console.log('[BLE_RECV] Mensaje ' + (detail.messageId || '') + ' de ' + (detail.senderNexoId || '?') + ' (' + String(detail.content || '').length + ' car.)');
        if (self.onMessage) self.onMessage(detail);
      } catch (err) {
        console.warn('[NEXO] _bleMessageHandler error:', err);
      }
    };
    window.addEventListener('nexo:ble:messageReceived', self._bleMessageHandler);
  }

  _setupVaultListeners() {
    var self = this;
    window.addEventListener('nexo:vault:messagesLoaded', function(e) {
      try {
        if (e && e.detail && Array.isArray(e.detail.messages)) {
          e.detail.messages.forEach(function(msg) {
            if (self.onMessage) self.onMessage(msg);
          });
        }
      } catch (err) {}
    });
  }

  _handleACK(messageId, ackType) {
    try {
      if (!messageId) return;
      ackType = ackType || 'delivered';
      console.log('[NEXO] ACK recibido:', messageId, ackType);
      if (window.NEXO_updateMessageStatus) {
        window.NEXO_updateMessageStatus(messageId, ackType);
      }
      var contactId = this._getCurrentContactId();
      if (contactId && window.vaultUpdateMessageStatus) {
        window.vaultUpdateMessageStatus(contactId, messageId, ackType).catch(function(e) {});
      }
    } catch (e) {
      console.warn('[NEXO] _handleACK error:', e);
    }
  }

  _getCurrentContactId() {
    if (this.activeContact) {
      return this.activeContact.nexoId || this.activeContact.id || this.activeContact.deviceUUID;
    }
    if (this.bleInterface && this.bleInterface._activeChatDeviceId) {
      return this.bleInterface._activeChatDeviceId;
    }
    return null;
  }

  sendMessage(msg) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        if (!msg || !msg.content) { reject(new Error('Mensaje vacio')); return; }
        var contactId = self._getCurrentContactId();
        if (!contactId) { reject(new Error('No hay contacto activo')); return; }
        var messageId = msg.msgId || msg.messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
        msg.msgId = messageId;
        msg.messageId = messageId;
        msg.timestamp = msg.timestamp || Date.now();
        var targetId = contactId;
        if (self.bleInterface) {
          var mappedMac = self.bleInterface._nexoIdToMac ? self.bleInterface._nexoIdToMac.get(_normId(contactId)) : null;
          if (mappedMac) targetId = mappedMac;
        }
        var seq = (typeof msg.seq === 'number') ? msg.seq : null;
        var content = msg.content;
        var isAttachment = false;
        try {
          var parsed = JSON.parse(content);
          if (parsed && parsed.type === 'attachment') isAttachment = true;
        } catch (e) {}
        if (isAttachment && self.bleInterface && self.bleInterface.sendFile) {
          self.bleInterface.sendFile(contactId, messageId, content, { type: 'attachment' })
            .then(function() {
              self._updateMessageStatus(messageId, 'sent');
              resolve();
            })
            .catch(function(err) {
              self._updateMessageStatus(messageId, 'failed');
              reject(err);
            });
          return;
        }
        if (self.bleInterface && self.bleInterface.sendChatMessage) {
          self.bleInterface.sendChatMessage(contactId, content, messageId, seq)
            .then(function() {
              self._updateMessageStatus(messageId, 'sent');
              resolve();
            })
            .catch(function(err) {
              // Sin clave de cifrado aún (NO_KEY): pendiente, se envía al recibirla
              self._updateMessageStatus(messageId, (err && err.code === 'NO_KEY') ? 'pending' : 'failed');
              reject(err);
            });
        } else {
          reject(new Error('BLE no disponible'));
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  _updateMessageStatus(messageId, status) {
    try {
      if (window.NEXO_updateMessageStatus) {
        window.NEXO_updateMessageStatus(messageId, status);
      }
      var contactId = this._getCurrentContactId();
      if (contactId && window.vaultUpdateMessageStatus) {
        window.vaultUpdateMessageStatus(contactId, messageId, status).catch(function(e) {});
      }
    } catch (e) {}
  }

  getStatus() {
    return {
      initialized: true,
      bleReady: !!(this.bleInterface && this.bleInterface.nativePlugin),
      contacts: this.bleInterface ? this.bleInterface.getBLEContacts().length : 0,
      activeContact: this.activeContact ? this.activeContact.nexoId : null
    };
  }

  destroy() {
    try {
      if (this._bleMessageHandler) {
        window.removeEventListener('nexo:ble:messageReceived', this._bleMessageHandler);
      }
    } catch (e) {}
  }
}

function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}

function _normMac(mac) {
  return (mac || '').toString().toLowerCase().replace(/[:-]/g, '').trim();
}
export { DEBUG };
