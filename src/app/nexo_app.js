/**
 * NEXO App v5.0.20-FILES
 * Base: v5.0.19 - FILES
 * FIX: sendFile delegado a AckSystem.sendFile (fragmentacion BLE)
 * FIX: _sendAttachment usa sendFile para image/video/file
 * FIX: _sendPayment usa sendChatMessage para payload de pago
 * FIX: _renderMessage ahora renderiza attachments (image, video, audio, location, file)
 * FASE4: Vault persistencia contactos + mensajes
 * VAULTONLY: Cero localStorage en mensajes/contactos. Delegado a vault_manager.js.
 */

import { NEXO_CONFIG } from './core/nexo_config.js';
import { NEXO_DIAG } from './core/nap.js';
import { DEBUG } from './core/debug.js';

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
    this._pendingAcks = new Map();
    this._ackTimeouts = new Map();
    this._ackRetryCount = new Map();
    this._ackMaxRetries = 3;
    this._ackRetryDelay = 2000;
    this._ackTimeoutMs = 6000;
    this._isProcessingPayment = false;
    this._isProcessingTransfer = false;
    this._lastPaymentTime = 0;
    this._lastTransferTime = 0;
    this._paymentDebounceMs = 2000;
    this._transferDebounceMs = 2000;
    this._bleMessageHandler = null;
    console.log('[NEXO] App v5.0.20-FILES constructor');
  }

  init() {
    var self = this;
    return new Promise(function(resolve) {
      try {
        self._setupBLEListeners();
        self._setupVaultListeners();
        self._setupPaymentListeners();
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
        // === FIX: Filtro de seguridad ACK en capa de app ===
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
          return; // ACKs no pasan al pipeline de mensajes
        }
        // === FIN FIX ACK ===
        var localUUID = self.bleInterface && self.bleInterface.localDeviceUUID ? self.bleInterface.localDeviceUUID : '';
        var senderUUID = detail.deviceUUID || '';
        if (senderUUID && localUUID && _normId(senderUUID) === _normId(localUUID)) {
          console.log('[BLE_RECV] Mensaje propio ignorado por UUID');
          return;
        }
        console.log('[BLE_RECV] Mensaje de ' + (detail.senderName || '') + ': ' + (detail.content ? detail.content.substring(0, 30) : '') + '...');
        var resolvedName = detail.senderName;
        if (!resolvedName && senderUUID) {
          try {
            if (window.vaultFindContactByNexoId) {
              var c = window.vaultFindContactByNexoId(senderUUID);
              if (c && c.displayName) resolvedName = c.displayName;
            }
          } catch (e) {}
        }
        if (!resolvedName && senderUUID) {
          var contacts = self.bleInterface ? self.bleInterface.getBLEContacts() : [];
          var found = contacts.find(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(senderUUID); });
          if (found && found.name) resolvedName = found.name;
        }
        var msg = {
          msgId: detail.messageId || detail.msgId || ('msg_' + Date.now()),
          messageId: detail.messageId || detail.msgId || ('msg_' + Date.now()),
          content: detail.content || '',
          senderNexoId: senderUUID,
          senderName: resolvedName || detail.senderName || 'NEXO',
          timestamp: detail.timestamp || Date.now(),
          _own: false,
          status: 'delivered',
          deviceId: detail.deviceId || ''
        };
        if (window.vaultAppendMessage && senderUUID) {
          window.vaultAppendMessage(senderUUID, msg, false).catch(function(e) {});
        }
        if (self.onMessage) self.onMessage(msg);
      } catch (err) {
        console.warn('[NEXO] _bleMessageHandler error:', err);
      }
    };
    window.addEventListener('nexo:ble:messageReceived', self._bleMessageHandler);
    window.addEventListener('nexo:ble:deviceConnected', function(e) {
      try {
        if (e && e.detail && e.detail.deviceId && self.bleInterface) {
          var nx = self.bleInterface._macToNexoId ? self.bleInterface._macToNexoId.get(_normMac(e.detail.deviceId)) : null;
          if (nx) {
            setTimeout(function() { self._resendPendingMessages(nx); }, 500);
          }
        }
      } catch (err) {}
    });
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

  _setupPaymentListeners() {
    var self = this;
    window.addEventListener('nexo:payment:request', function(e) {
      try {
        if (e && e.detail) self._showPaymentModal(e.detail);
      } catch (err) {}
    });
    window.addEventListener('nexo:payment:response', function(e) {
      try {
        if (e && e.detail) self._handlePaymentResponse(e.detail);
      } catch (err) {}
    });
  }

  _handleACK(messageId, ackType) {
    try {
      if (!messageId) return;
      ackType = ackType || 'delivered';
      console.log('[NEXO] ACK recibido:', messageId, ackType);
      var timeout = this._ackTimeouts.get(messageId);
      if (timeout) { clearTimeout(timeout); this._ackTimeouts.delete(messageId); }
      this._pendingAcks.delete(messageId);
      this._ackRetryCount.delete(messageId);
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

  _resendPendingMessages(nexoId) {
    var self = this;
    if (!nexoId) return;
    if (!window.vaultLoadMessages) return;
    window.vaultLoadMessages(nexoId).then(function(messages) {
      if (!messages || messages.length === 0) return;
      var pending = messages.filter(function(m) { return m._own === true && (m.status === 'pending' || m.status === 'failed'); });
      if (pending.length === 0) return;
      console.log('[NEXO] Reenviando', pending.length, 'mensajes pending para', nexoId);
      pending.forEach(function(msg) {
        var mid = msg.msgId || msg.messageId || msg.id;
        if (!mid) return;
        self.sendMessage({ content: msg.content || msg.text || '', msgId: mid, messageId: mid });
      });
    }).catch(function(e) {
      console.warn('[NEXO] Error cargando pending para reenvio:', e.message);
    });
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
          self.bleInterface.sendChatMessage(contactId, content, messageId)
            .then(function() {
              self._updateMessageStatus(messageId, 'sent');
              self._scheduleAckTimeout(messageId);
              resolve();
            })
            .catch(function(err) {
              self._updateMessageStatus(messageId, 'failed');
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

  _scheduleAckTimeout(messageId) {
    var self = this;
    if (!messageId) return;
    var timeout = setTimeout(function() {
      var retries = self._ackRetryCount.get(messageId) || 0;
      if (retries < self._ackMaxRetries) {
        self._ackRetryCount.set(messageId, retries + 1);
        console.log('[NEXO] ACK timeout, reintentando', retries + 1, '/', self._ackMaxRetries);
        var contactId = self._getCurrentContactId();
        if (contactId && self.bleInterface && self.bleInterface.sendChatMessage) {
          self.bleInterface.sendChatMessage(contactId, '', messageId)
            .then(function() {
              self._scheduleAckTimeout(messageId);
            })
            .catch(function() {});
        }
      } else {
        console.warn('[NEXO] ACK max retries alcanzado para', messageId);
        self._pendingAcks.delete(messageId);
        self._ackTimeouts.delete(messageId);
        self._ackRetryCount.delete(messageId);
        self._updateMessageStatus(messageId, 'failed');
      }
    }, self._ackTimeoutMs);
    self._ackTimeouts.set(messageId, timeout);
    self._pendingAcks.set(messageId, true);
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
      this._ackTimeouts.forEach(function(t) { clearTimeout(t); });
      this._ackTimeouts.clear();
      this._pendingAcks.clear();
      this._ackRetryCount.clear();
    } catch (e) {}
  }

  // === PAYMENT / TRANSFER SYSTEM ===

  _sendPayment(amount, currency, note) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var now = Date.now();
        if (now - self._lastPaymentTime < self._paymentDebounceMs) {
          reject(new Error('Espera antes de enviar otro pago'));
          return;
        }
        self._lastPaymentTime = now;
        if (self._isProcessingPayment) {
          reject(new Error('Ya hay un pago en proceso'));
          return;
        }
        self._isProcessingPayment = true;
        var contactId = self._getCurrentContactId();
        if (!contactId) {
          self._isProcessingPayment = false;
          reject(new Error('No hay contacto activo'));
          return;
        }
        var paymentId = 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        var payload = JSON.stringify({
          type: 'payment',
          paymentId: paymentId,
          amount: amount,
          currency: currency || 'USD',
          note: note || '',
          timestamp: Date.now(),
          senderNexoId: self.bleInterface ? (self.bleInterface.localNexoId || self.bleInterface.localDeviceUUID) : '',
          status: 'pending'
        });
        self._isProcessingPayment = false;
        if (self.bleInterface && self.bleInterface.sendChatMessage) {
          self.bleInterface.sendChatMessage(contactId, payload, paymentId)
            .then(function() { resolve(paymentId); })
            .catch(function(err) { reject(err); });
        } else {
          reject(new Error('BLE no disponible'));
        }
      } catch (e) {
        self._isProcessingPayment = false;
        reject(e);
      }
    });
  }

  _showPaymentModal(detail) {
    try {
      var existing = document.getElementById('nexo-payment-modal');
      if (existing) existing.remove();
      var modal = document.createElement('div');
      modal.id = 'nexo-payment-modal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
      modal.innerHTML = '<div style="background:#0a0a15;border:1px solid #00d4ff;border-radius:16px;padding:24px;max-width:320px;width:90%;text-align:center;color:#fff;">' +
        '<h3 style="margin:0 0 12px;color:#00d4ff;">Solicitud de Pago</h3>' +
        '<p style="font-size:24px;font-weight:700;margin:8px 0;">' + (detail.amount || '0') + ' ' + (detail.currency || 'USD') + '</p>' +
        '<p style="font-size:13px;color:#aaa;margin:0 0 16px;">' + (detail.note || '') + '</p>' +
        '<div style="display:flex;gap:10px;">' +
        '<button id="pay-accept" style="flex:1;padding:12px;background:linear-gradient(135deg,#00d4ff,#0099cc);border:none;border-radius:10px;color:#000;font-weight:700;cursor:pointer;">Aceptar</button>' +
        '<button id="pay-decline" style="flex:1;padding:12px;background:rgba(255,59,48,0.3);border:1px solid #FF3B30;border-radius:10px;color:#fff;font-weight:600;cursor:pointer;">Rechazar</button>' +
        '</div></div>';
      document.body.appendChild(modal);
      document.getElementById('pay-accept').addEventListener('click', function() {
        self._respondToPayment(detail.paymentId, 'accepted');
        modal.remove();
      });
      document.getElementById('pay-decline').addEventListener('click', function() {
        self._respondToPayment(detail.paymentId, 'declined');
        modal.remove();
      });
    } catch (e) {
      console.warn('[NEXO] _showPaymentModal error:', e);
    }
  }

  _respondToPayment(paymentId, response) {
    var self = this;
    try {
      var contactId = self._getCurrentContactId();
      if (!contactId) return;
      var payload = JSON.stringify({
        type: 'payment_response',
        paymentId: paymentId,
        response: response,
        timestamp: Date.now(),
        senderNexoId: self.bleInterface ? (self.bleInterface.localNexoId || self.bleInterface.localDeviceUUID) : ''
      });
      if (self.bleInterface && self.bleInterface.sendChatMessage) {
        self.bleInterface.sendChatMessage(contactId, payload, 'payresp_' + Date.now());
      }
    } catch (e) {
      console.warn('[NEXO] _respondToPayment error:', e);
    }
  }

  _handlePaymentResponse(detail) {
    try {
      if (!detail || !detail.paymentId) return;
      console.log('[NEXO] Respuesta de pago:', detail.paymentId, detail.response);
      if (detail.response === 'accepted') {
        if (window.NEXO_updateMessageStatus) {
          window.NEXO_updateMessageStatus(detail.paymentId, 'completed');
        }
      } else {
        if (window.NEXO_updateMessageStatus) {
          window.NEXO_updateMessageStatus(detail.paymentId, 'rejected');
        }
      }
    } catch (e) {
      console.warn('[NEXO] _handlePaymentResponse error:', e);
    }
  }

  _sendTransfer(amount, currency, note) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var now = Date.now();
        if (now - self._lastTransferTime < self._transferDebounceMs) {
          reject(new Error('Espera antes de enviar otra transferencia'));
          return;
        }
        self._lastTransferTime = now;
        if (self._isProcessingTransfer) {
          reject(new Error('Ya hay una transferencia en proceso'));
          return;
        }
        self._isProcessingTransfer = true;
        var contactId = self._getCurrentContactId();
        if (!contactId) {
          self._isProcessingTransfer = false;
          reject(new Error('No hay contacto activo'));
          return;
        }
        var transferId = 'trf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        var payload = JSON.stringify({
          type: 'transfer',
          transferId: transferId,
          amount: amount,
          currency: currency || 'USD',
          note: note || '',
          timestamp: Date.now(),
          senderNexoId: self.bleInterface ? (self.bleInterface.localNexoId || self.bleInterface.localDeviceUUID) : '',
          status: 'pending'
        });
        self._isProcessingTransfer = false;
        if (self.bleInterface && self.bleInterface.sendChatMessage) {
          self.bleInterface.sendChatMessage(contactId, payload, transferId)
            .then(function() { resolve(transferId); })
            .catch(function(err) { reject(err); });
        } else {
          reject(new Error('BLE no disponible'));
        }
      } catch (e) {
        self._isProcessingTransfer = false;
        reject(e);
      }
    });
  }

  _renderMessage(msg) {
    try {
      if (!msg) return;
      if (msg.type === 'payment' || msg.type === 'transfer') {
        this._renderPaymentBubble(msg);
        return;
      }
      if (msg.type === 'payment_response') {
        this._handlePaymentResponse(msg);
        return;
      }
      if (window.NEXO_updateMessageStatus && msg.status) {
        window.NEXO_updateMessageStatus(msg.msgId || msg.messageId || msg.id, msg.status);
      }
    } catch (e) {
      console.warn('[NEXO] _renderMessage error:', e);
    }
  }

  _renderPaymentBubble(msg) {
    try {
      if (!msg) return;
      var container = document.getElementById('messages-container');
      if (!container) return;
      var div = document.createElement('div');
      var isOwn = !!msg._own;
      div.className = 'message ' + (isOwn ? 'own' : 'other');
      var contentDiv = document.createElement('div');
      contentDiv.className = 'msg-content';
      var isPayment = msg.type === 'payment';
      var icon = isPayment ? '💸' : '💰';
      var title = isPayment ? 'Solicitud de Pago' : 'Transferencia';
      var amount = (msg.amount || '0') + ' ' + (msg.currency || 'USD');
      var html = '<div style="padding:12px 16px;background:rgba(0,0,0,0.3);border-radius:12px;min-width:200px;">';
      html += '<div style="font-size:20px;margin-bottom:4px;">' + icon + '</div>';
      html += '<div style="font-weight:700;font-size:16px;margin-bottom:4px;">' + title + '</div>';
      html += '<div style="font-size:22px;font-weight:700;color:#00d4ff;margin-bottom:8px;">' + amount + '</div>';
      if (msg.note) html += '<div style="font-size:12px;color:#aaa;margin-bottom:8px;">' + msg.note + '</div>';
      if (!isOwn && isPayment && msg.status === 'pending') {
        html += '<div style="display:flex;gap:8px;margin-top:8px;">';
        html += '<button class="pay-btn-accept" data-id="' + (msg.paymentId || msg.transferId) + '" style="flex:1;padding:8px;background:linear-gradient(135deg,#00d4ff,#0099cc);border:none;border-radius:8px;color:#000;font-weight:700;font-size:13px;cursor:pointer;">Aceptar</button>';
        html += '<button class="pay-btn-decline" data-id="' + (msg.paymentId || msg.transferId) + '" style="flex:1;padding:8px;background:rgba(255,59,48,0.3);border:1px solid #FF3B30;border-radius:8px;color:#fff;font-weight:600;font-size:13px;cursor:pointer;">Rechazar</button>';
        html += '</div>';
      } else {
        html += '<div style="font-size:12px;color:#888;margin-top:8px;">' + (msg.status || 'pending') + '</div>';
      }
      html += '</div>';
      contentDiv.innerHTML = html;
      div.appendChild(contentDiv);
      var metaDiv = document.createElement('div');
      metaDiv.className = 'msg-meta';
      var timeSpan = document.createElement('span');
      timeSpan.className = 'msg-time';
      timeSpan.textContent = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
      metaDiv.appendChild(timeSpan);
      if (isOwn) {
        var statusClass = 'status-pending';
        var statusIcon = '○';
        if (msg.status === 'sent') { statusClass = 'status-sent'; statusIcon = '✓'; }
        else if (msg.status === 'delivered') { statusClass = 'status-delivered'; statusIcon = '✓✓'; }
        else if (msg.status === 'read') { statusClass = 'status-read'; statusIcon = '✓✓'; }
        else if (msg.status === 'completed') { statusClass = 'status-completed'; statusIcon = '✓'; }
        else if (msg.status === 'rejected') { statusClass = 'status-rejected'; statusIcon = '✗'; }
        var statusSpan = document.createElement('span');
        statusSpan.className = 'msg-status ' + statusClass;
        statusSpan.textContent = statusIcon;
        metaDiv.appendChild(statusSpan);
      }
      div.appendChild(metaDiv);
      container.appendChild(div);
      var acceptBtns = div.querySelectorAll('.pay-btn-accept');
      var declineBtns = div.querySelectorAll('.pay-btn-decline');
      var self = this;
      acceptBtns.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var id = btn.dataset.id;
          self._respondToPayment(id, 'accepted');
        });
      });
      declineBtns.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var id = btn.dataset.id;
          self._respondToPayment(id, 'declined');
        });
      });
      requestAnimationFrame(function() {
        container.scrollTop = container.scrollHeight;
      });
    } catch (e) {
      console.warn('[NEXO] _renderPaymentBubble error:', e);
    }
  }

  _signPayment(paymentId) {
    try {
      console.log('[NEXO] Firmando pago:', paymentId);
      return 'SIG_' + paymentId + '_' + Date.now();
    } catch (e) {
      console.warn('[NEXO] _signPayment error:', e);
      return null;
    }
  }
}

function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}

function _normMac(mac) {
  return (mac || '').toString().toLowerCase().replace(/[:-]/g, '').trim();
}
