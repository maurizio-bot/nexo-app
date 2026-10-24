/**
 * NEXO — Mensajes por Bluetooth, Wi-Fi e internet (métodos de BLEInterface sacados de ble_interface.js en la ronda
 * 2752, sin cambios): lo que llega (descifrar, comprobar remitente, guardar, avisar) y lo que sale (texto, archivos,
 * pendientes, reenvío al reconectar).
 */
import { e2eOpenAnon } from '../vault/e2e_crypto.js';
import { e2eAnyEncrypted, e2eOpenText, e2eOuterAd } from '../vault/e2e_proto.js';
import { BLE_STATES, SUPERVISOR_STATES, _addBLEContact, _chatKind, _failStatus, _getBLEContacts, _getContactByDeviceId, _getContactByUUID, _hasNativeMethod, _hydrateAttachments, _isBLEContact, _isControlPacket, _isProtocolShaped, _isResendable, _lanNx, _messagePreview, _netNx, _normId, _normMac, _safeDispatchEvent, _safeNativeCall, _saveBLEContacts, _saveSeqCounter, _vaultAppendMessage, _vaultGetOrCreateContact, _vaultLoadMessages, _vaultUpdateMessageStatus } from './ble_helpers.js';


export const BLE_MESSAGE_METHODS = {
  _flushAllPendingMessages() {
    var self = this;
    console.log('[BLEInterface] Flush global pending...');
    var contacts = _getBLEContacts();
    if (!contacts || contacts.length === 0) { console.log('[BLEInterface] No contactos'); return; }
    contacts.forEach(function(contact) {
      var nx = _normId(contact.nexoId || contact.deviceUUID);
      if (!nx) return;
      var getPending = (window.vaultGetPendingMessages && typeof window.vaultGetPendingMessages === 'function')
        ? window.vaultGetPendingMessages(nx)
        : _vaultLoadMessages(nx).then(function(msgs) { return msgs.filter(_isResendable); });
      getPending.then(function(pending) {
        if (!pending || pending.length === 0) return;
        console.log('[BLEInterface]', nx, 'tiene', pending.length, 'pending');
        var deviceId = contact.deviceId || self._resolveDeviceIdForNexoId(nx);
        if (deviceId) {
          var state = self._getDeviceState(deviceId);
          var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
          if (isReady) { self._resendPendingMessages(nx); }
          else {
            self._markPeerLost(nx);
            if (state.state !== BLE_STATES.CONNECTING && state.state !== BLE_STATES.DISCOVERING_SERVICES) {
              self._autoConnectGATT(deviceId, { name: contact.name, deviceUUID: nx });
            }
          }
        } else { self._markPeerLost(nx); self._autoScanForKnownContacts(); }
      }).catch(function(e) { console.warn('[BLEInterface] Error flush', nx, e.message); });
    });
  },

  _isMsgInFlight(msgId) {
    if (!msgId) return false;
    var found = false;
    this._pendingMessageQueue.forEach(function(q) { q.forEach(function(it) { if (it.messageId === msgId) found = true; }); });
    if (found) return true;
    var ack = this.ackSystem;
    if (ack && ack.pendingAcks && ack.pendingAcks.has(msgId)) return true;
    if (ack && ack.outgoingStreams && ack.outgoingStreams.has(msgId)) return true;
    if (ack && ack.preparing && ack.preparing.has(msgId)) return true;
    if (this.wifiDirect && this.wifiDirect.out.has(msgId)) return true;
    return false;
  },

  getNextSeq() {
    this._localSeqCounter = (this._localSeqCounter + 1) >>> 0;
    _saveSeqCounter(this._localSeqCounter);
    return this._localSeqCounter;
  },

  _setupNativePayloadListener() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    if (this._nativePayloadListener) { try { this._nativePayloadListener.remove(); } catch (e) {} }
    var self = this;
    // v6.2.0: paso previo en orden (cadena de promesas): descifra textos cortos E2E y atiende 'kx'
    this._payloadChain = Promise.resolve();
    this._nativePayloadListener = this.nativePlugin.addListener('onPayloadReceived', function(data) {
      self._payloadChain = self._payloadChain
        .then(function() { return self._prePayload(data); })
        .then(function(d) { if (d) self._handlePayload(d); })
        .catch(function(e) { console.warn('[BLEInterface] Error procesando paquete:', e && e.message); });
    });
  },

  _prePayload(data) {
    var self = this;
    // Ronda 2753: trozo binario (el nativo trae la cabecera y los datos en base64): se rehace el trozo JSON de siempre
    if (data && typeof data.bin === 'string') {
      var bh = String(data.content || '');
      if (bh.charAt(0) !== '{' || bh.charAt(bh.length - 1) !== '}' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.bin)) return Promise.resolve(null);
      var full = bh.slice(0, -1) + (bh.length > 2 ? ',' : '') + '"d":"' + data.bin + '"}';
      // Diagnóstico: una línea por transferencia (no por trozo)
      var bm = (bh.match(/"m":"([^"]+)"/) || [])[1];
      if (bm && self._binSeen !== bm) { self._binSeen = bm; console.log('[BIN] Llegan trozos binarios de ' + bm); }
      data = Object.assign({}, data, { content: full, data: full, bin: undefined });
    }
    var raw = (data && (data.content || data.data || data.message) || '').trim();
    if (raw.charAt(0) !== '{') return Promise.resolve(data);
    // Wi-Fi Direct: control de una transferencia (por Bluetooth)
    if (/"type":"w[qanf]"/.test(raw) && self.wifiDirect) {
      var pw = null;
      try { pw = JSON.parse(raw); } catch (e) {}
      if (pw && self.wifiDirect.handle(pw, data.deviceId)) return Promise.resolve(null);
    }
    // Archivos grandes (ronda 2756, big_file.js): control de una transferencia
    if (/"type":"g[qanfr]"/.test(raw) && self.bigFiles) {
      var pg = null;
      try { pg = JSON.parse(raw); } catch (e) {}
      if (pg && self.bigFiles.handle(pg, data.deviceId)) return Promise.resolve(null);
    }
    // Fénix: pingeo, borrado y petición de recuperación (directos, sin 'to')
    if (/"type":"f[poqd]"/.test(raw) && self.fenix) {
      var pf = null;
      try { pf = JSON.parse(raw); } catch (e) {}
      if (pf && !pf.to && self.fenix.handle(pf, data.deviceId)) return Promise.resolve(null);
    }
    // v6.11.1: un puente con una build anterior (sin 'sx') reenvía el sobre como texto suyo ({type:'chat', payload:
    // {text: sobre}}): se saca el sobre y se trata como si hubiera llegado tal cual (abrir si es para mí; si no, Jump)
    if (raw.indexOf('\\"type\\":\\"sx\\"') >= 0) {
      var pw2 = null;
      try { pw2 = JSON.parse(raw); } catch (e) {}
      var wt = pw2 && pw2.type === 'chat' && !pw2.to && pw2.payload && typeof pw2.payload.text === 'string' ? pw2.payload.text : '';
      var wrapped = null;
      if (wt.charAt(0) === '{') { try { wrapped = JSON.parse(wt); } catch (e) {} }
      if (wrapped && wrapped.type === 'sx' && /^nx[0-9a-z]{8}$/i.test(wrapped.to || '')) {
        return self._prePayload(Object.assign({}, data, { content: wt, data: wt }));
      }
    }
    // v6.11.0: sobre sellado para este teléfono (remitente oculto a los puentes): se abre y se procesa lo de dentro
    if (raw.indexOf('"type":"sx"') >= 0) {
      var ps = null;
      try { ps = JSON.parse(raw); } catch (e) {}
      if (ps && ps.type === 'sx' && _normId(ps.to) === _normId(self.localNexoId)) {
        // v6.12.0: el puente que lo trajo espera confirmación de este salto (no ve qué hay dentro: puede ser una
        // confirmación o un kx, que no se confirman por su id); sin ella lo guardaba y reintentaba sin fin
        if (Number(ps.hp) > 0 && ps.msgId && self.relay) self.relay._sendCustody(data.deviceId, ps.msgId);
        return e2eOpenAnon(ps.c).then(function(inner) {
          var ip = null;
          try { ip = JSON.parse(inner); } catch (e) {}
          if (!ip || typeof ip !== 'object') return null;
          if (Number(ps.hp) > 0) ip.hp = Number(ps.hp); // saltos del sobre (la confirmación vuelve por las rutas)
          var txt = JSON.stringify(ip);
          return self._prePayload(Object.assign({}, data, { content: txt, data: txt, sealed: true }));
        }).catch(function(e) { console.warn('[JUMP] Sobre sellado ilegible: ' + (e && e.message)); return null; });
      }
    }
    var jump = /"to":"nx/i.test(raw) || /"type":"r[tkqp]"/.test(raw);
    if (!jump && raw.indexOf('"type":"kx"') < 0 && raw.indexOf('E1:') < 0 && raw.indexOf('E2:') < 0) return Promise.resolve(data);
    var p;
    try { p = JSON.parse(raw); } catch (e) { return Promise.resolve(data); }
    // Jump: rutas, custodia y paquetes de paso hacia otro teléfono
    if (jump && p && /^r[tqp]$/.test(p.type || '') && /^nx[0-9a-z]{8}$/i.test(p.from || '')) self._kickPeer(data.deviceId, p.from);
    if (jump && self.relay && self.relay.intercept(p, raw, data.deviceId)) return Promise.resolve(null);
    var viaRelay = !!(p && p.to && Number(p.hp) > 0);
    if (p && p.type === 'kx') {
      if (viaRelay) {
        // Clave pedida por otro teléfono: solo se acepta si aún no hay ninguna (un puente no puede
        // cambiar una clave ya conocida)
        if (p.from && p.pk && !self._contactKey(p.from)) self._noteSenderKey(p.from, p.pk);
        if (p.from && p.b2) self._notePeerBundle(p.from, p.b2);
        if (p.ss && p.from) self._noteSealPeer(p.from);
        if (p.nt && p.from) self._noteNetPeer(p.from);
        if (p.from) self._pqHave.set(_normId(p.from), Number(p.ph) || 0);
        if (p.rq) self._sendKxRouted(p.from, false);
        return Promise.resolve(null);
      }
      if (p.from && p.pk) self._noteSenderKey(p.from, p.pk);
      if (p.from && p.b2) self._notePeerBundle(p.from, p.b2);
      // Asociar la dirección (un teléfono que se conectó a nosotros y no es contacto no tenía mapeo)
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '')) self._kickPeer(data.deviceId, p.from);
      // Ronda 2755: si era un NEXO anónimo (código rotativo), ya se sabe quién es
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '') && self.relay && typeof self.relay.identify === 'function') self.relay.identify(data.deviceId, p.from);
      if (p.j && self.relay) self.relay.markCapable(p.from);
      if (p.from && p.rs) self._noteRestored(p.from, p.pk, p.rs);
      if (p.fx && p.from) self._noteFenixPeer(p.from, data.deviceId, Number(p.fx) || 1);
      if (p.ss && p.from) self._noteSealPeer(p.from);
      if (p.nt && p.from) self._noteNetPeer(p.from);
      if (self.ackSystem) self.ackSystem.markBin(data.deviceId, !p.bf); // ronda 2753: trozos binarios (una build anterior no los entiende)
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '')) self._pqHave.set(_normId(p.from), Number(p.ph) || 0);
      // v6.11.1: ¿este vecino reenvía sobres 'sx' bien? (las builds anteriores los envolvían como texto suyo)
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '')) { if (p.ss) self._sxHops.add(_normId(p.from)); else self._sxHops.delete(_normId(p.from)); }
      if (p.wd && self.wifiDirect) self.wifiDirect.markPeer(p.from);
      else if (self.wifiDirect) self.wifiDirect.unmarkPeer(p.from); // ya no lo anuncia (p.ej. sin permiso)
      if (self.bigFiles) { if (p.bg) self.bigFiles.markPeer(p.from); else self.bigFiles.unmarkPeer(p.from); } // archivos grandes (2756)
      // Responder con el nuestro (cada lado sabe así que el otro entiende Jump; máx. 1 cada 15 s)
      if (p.rq || p.j) self._sendKx(data.deviceId, false, !!p.rq);
      return Promise.resolve(null);
    }
    if (viaRelay) data = Object.assign({}, data, { viaRelay: true, relayOrigin: _normId(p.from) });
    if (p && p.v === 1 && p.type === 'chat' && p.payload && e2eAnyEncrypted(p.payload.text)) {
      var sender = p.from || p.payload.senderNexoId;
      return e2eOpenText(sender, p.payload.text, e2eOuterAd(sender, self.localNexoId, p.msgId)).then(function(r) {
        var v = self._checkSender(sender, r.senderKey, r.proto);
        if (v === 'drop') return null;
        if (p.ss && v === 'ok') self._noteSealPeer(sender); // v6.11.1: lo dice dentro de un mensaje que descifra bien
        if (p.nt && v === 'ok') self._noteNetPeer(sender);  // v6.13.0: idem, internet por relés
        p.payload.text = r.text;
        p.payload.e2e = true;
        var out = Object.assign({}, data);
        out.e2eSenderKey = r.senderKey; // si el remitente aún no es contacto, se guarda al crearlo
        out.e2eProto = r.proto;
        out.content = out.data = JSON.stringify(p);
        // Clave distinta de la conocida: retenido (sin mostrar ni confirmar) hasta que el usuario decida
        if (v === 'hold') { self._quarantine(sender, function() { self._handlePayload(out); }, p.msgId); return null; }
        return out;
      }).catch(function(e) {
        // Reintento de uno ya descifrado (tras reiniciar no queda el texto): confirmarlo si se guardó
        if (e && e.code === 'DUP') { self._ackIfStored(data.deviceId, sender, p.msgId, viaRelay ? _normId(p.from) : null); return null; }
        console.warn('[E2E] No se pudo descifrar un mensaje de ' + (p.from || '?') + ': ' + (e && e.message));
        return null;
      });
    }
    return Promise.resolve(data);
  },

  _handlePayload(data) {
    var self = this;
    (function() {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        self._lastPongTime.set(deviceId, Date.now());
        self._pingFailCount.set(deviceId, 0);
        try {
          var raw0 = (data.content || data.data || '').trim();
          if (raw0.charAt(0) === '{') {
            var p0 = JSON.parse(raw0);
            var from0 = p0.fr || p0.fromNexoId || p0.from || (p0.payload && p0.payload.senderNexoId) || '';
            // Jump: lo que llega por otro teléfono no es del dueño de esta dirección
            var passing = data.viaRelay || p0.dt || (p0.to && Number(p0.hp) > 0);
            if (!passing && /^nx[0-9a-z]{8}$/i.test(from0)) self._kickPeer(deviceId, from0);
          }
        } catch (kickErr) {}
        var source = data.source || 'unknown';
        if (source !== 'gatt_server' && source !== 'gatt_client' && source !== 'broadcast') source = 'gatt_client';
        var messageId = null, senderName = null, senderUUID = null;
        var content = data.content || data.data || data.message || '';
        var trimmedContent = (content || '').trim();
        var isProtocol = false;
        // v6.9.1: paquete dañado (JSON roto o un trozo suelto de otro mensaje): se descarta. Antes se mostraba en
        // el chat como "mensaje de código" (lo que llega por Bluetooth es siempre JSON completo)
        var c0 = trimmedContent.charAt(0);
        if (c0 === '"' || (c0 === '{' && !_isProtocolShaped(trimmedContent))) {
          console.warn('[BLEInterface] Paquete dañado descartado (' + trimmedContent.length + ' car.)');
          return;
        }
        try {
          if (trimmedContent.charAt(0) === '{') {
            var protoCheck = JSON.parse(trimmedContent);
            if (protoCheck.type === 'chat_meta' || protoCheck.type === 'chat_chunk' || protoCheck.type === 'file_meta' ||
                protoCheck.type === 'file_chunk' || protoCheck.type === 'file_resume' || protoCheck.type === 'ack' ||
                protoCheck.type === 'read_receipt' || protoCheck.type === 'ping' ||
                protoCheck.type === 'pong' || protoCheck.type === 'block_ack') isProtocol = true;
            if (protoCheck.t === 'c' || protoCheck.t === 'f' || protoCheck.t === 'n' || protoCheck.t === 'a' || protoCheck.t === 'ba' || protoCheck.t === 'ss' || protoCheck.t === 'sr') isProtocol = true;
          }
        } catch (e) {}
        if (isProtocol) {
          if (self.ackSystem) {
            var fragmentHandled = self.ackSystem.processIncomingFragment({ deviceId: deviceId, content: trimmedContent });
            if (fragmentHandled) return;
          }
          return;
        }
        if (self.ackSystem) {
          var fragmentHandled = self.ackSystem.processIncomingFragment({ deviceId: deviceId, content: content });
          if (fragmentHandled) return;
        }
        var ctrl = null;
        try { if (content && content.charAt(0) === '{') ctrl = JSON.parse(content); } catch (e) { ctrl = null; }

        var isControl = !!(ctrl && (
          ctrl.type === 'ack' || ctrl.type === 'read_receipt' || ctrl.type === 'ping' || ctrl.type === 'pong' ||
          ctrl.type === 'chat_meta' || ctrl.type === 'chat_chunk' || ctrl.type === 'block_ack' ||
          ctrl.type === 'file_meta' || ctrl.type === 'file_chunk' || ctrl.type === 'file_resume' ||
          ctrl.t === 'ba'
        ));
        if (ctrl && (ctrl.type === 'ack' || ctrl.type === 'read_receipt')) {
          if (self.ackSystem) self.ackSystem.processIncomingAck(content);
          return;
        }
        if (ctrl && ctrl.type === 'ping') {
          var pongPayload = JSON.stringify({ v: 1, type: 'pong', pingId: ctrl.pingId, ts: Date.now(), fromNexoId: self.localNexoId || self.localDeviceUUID });
          self._sendMessageNative(deviceId, pongPayload, 'pong_' + ctrl.pingId).catch(function() {});
          return;
        }
        if (ctrl && ctrl.type === 'pong') {
          var pending = self._pendingPings.get(ctrl.pingId);
          if (pending) {
            clearTimeout(pending.timer);
            self._pendingPings.delete(ctrl.pingId);
            var rtt = Date.now() - pending.ts;
            self._lastPongTime.set(deviceId, Date.now());
            self._pingFailCount.set(deviceId, 0);
            self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now(), rtt: rtt });
            pending.resolve({ rtt: rtt });
          }
          return;
        }
        var msgSeq = 0;
        if (content.charAt(0) === '{' || (data.data && data.data.charAt(0) === '{')) {
          try {
            var json = JSON.parse(data.data || content || '{}');
            if (json.msgId) messageId = json.msgId;
            if (json.messageId) messageId = json.messageId;
            if (typeof json.seq === 'number') msgSeq = json.seq;

            if (json.v === 1 && json.type === 'chat' && json.payload) {
              if (typeof json.payload.text === 'string') content = json.payload.text;
              if (json.payload.senderName) senderName = json.payload.senderName;
              if (json.payload.senderNexoId) senderUUID = json.payload.senderNexoId;
              if (!messageId && json.msgId) messageId = json.msgId;
            } else {
              if (json.payload) {
                if (json.payload.senderName) senderName = json.payload.senderName;
                if (json.payload.text) content = json.payload.text;
                if (json.payload.senderNexoId) senderUUID = json.payload.senderNexoId;
              }
              if (json.senderName) senderName = json.senderName;
              if (json.deviceName) senderName = json.deviceName;
              if (json.deviceUUID) senderUUID = json.deviceUUID;
              if (json.content) content = json.content;
              if (json.from && !senderUUID) senderUUID = json.from;
              if (!messageId && json.payload && json.payload.messageId) messageId = json.payload.messageId;
            }
          } catch (e) {}
        }
        if (!senderUUID) {
          var nd = _normMac(deviceId);
          senderUUID = self._macToNexoId.get(nd) || null;
        }
        if (!senderUUID) {
          var contactByDevice = _getContactByDeviceId(deviceId);
          if (contactByDevice) senderUUID = contactByDevice.nexoId || contactByDevice.deviceUUID;
        }
        if (!senderName || senderName === '') {
          var contact = _getContactByUUID(senderUUID);
          var cname = contact ? contact.name : null;
          senderName = cname || (self.connectedDevices.get(deviceId) && self.connectedDevices.get(deviceId).name) || (self.foundDevices.get(deviceId) && self.foundDevices.get(deviceId).name) || '';
        }
        if (senderUUID && senderName && senderName !== '') {
          if (!_isBLEContact(senderUUID)) {
            _addBLEContact({ deviceUUID: senderUUID, name: senderName, deviceId: data.viaRelay ? null : deviceId });
            if (data.e2eSenderKey) self._noteSenderKey(senderUUID, data.e2eSenderKey);
            if (data.e2eSenderKey && data.e2eProto === 2) self._markProto2(senderUUID, data.e2eSenderKey);
            self.renderContactsList(); self.renderOnlineStrip();
          } else {
            var contacts2 = _getBLEContacts();
            var idx2 = contacts2.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(senderUUID); });
            if (idx2 >= 0 && !data.viaRelay) { contacts2[idx2].online = true; contacts2[idx2].lastSeen = Date.now(); contacts2[idx2].deviceId = deviceId; _saveBLEContacts(contacts2); self.renderContactsList(); self.renderOnlineStrip(); }
          }
          _vaultGetOrCreateContact(senderUUID, senderName, self.connectedDevices.get(deviceId) && self.connectedDevices.get(deviceId).name);
        }
        var ackTo = data.viaRelay ? data.relayOrigin : null;
        if (messageId && self._receivedMessageIds.has(messageId)) {
          if (!isControl && self.ackSystem) self.ackSystem.sendAck(deviceId, messageId, ackTo);
          return;
        }
        if (messageId) {
          self._receivedMessageIds.add(messageId);
          if (self._receivedMessageIds.size > self._maxMessageIds) {
            var first = self._receivedMessageIds.values().next().value;
            self._receivedMessageIds.delete(first);
          }
          if (!isControl && self.ackSystem) self.ackSystem.sendAck(deviceId, messageId, ackTo);
        }
        var attachmentData = null;
        if (ctrl && ctrl.payload && ctrl.payload.attachment) attachmentData = ctrl.payload.attachment;
        var msgContent = attachmentData ? JSON.stringify(attachmentData) : content;
        // Acción del chat (eliminar para todos): no es un mensaje; la aplica main.js
        var chatAct = _chatKind(msgContent);
        if (chatAct && chatAct.type === 'nexo_act') isControl = true;
        if (!isControl && senderUUID) {
          var vaultMsg = {
            messageId: messageId || ('recv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
            content: msgContent, _own: false, status: 'delivered', timestamp: data.timestamp || Date.now(),
            senderName: senderName, senderNexoId: senderUUID, seq: msgSeq || 0,
            attachmentType: attachmentData ? attachmentData.attachmentType : null,
            attachmentPayload: attachmentData ? attachmentData.payload : null,
            attachmentMeta: attachmentData ? attachmentData.meta : null
          };
          _vaultAppendMessage(senderUUID, vaultMsg, false);
        }
        // v6.14.0: el contador de no leídos lo lleva notify.js (todas las vías: texto largo, fotos, archivos…)
        var pv = _messagePreview(content, attachmentData && attachmentData.attachmentType);
        if (senderUUID && !isControl && pv !== null) self.noteContactMessage(senderUUID, pv, data.timestamp || Date.now());
        _safeDispatchEvent('nexo:ble:messageReceived', {
          deviceId: deviceId,
          deviceUUID: senderUUID,
          content: msgContent,
          messageId: messageId,
          senderName: senderName,
          senderNexoId: senderUUID,
          seq: msgSeq || 0,
          timestamp: data.timestamp || Date.now(),
          attachmentType: attachmentData ? attachmentData.attachmentType : null,
          attachmentPayload: attachmentData ? attachmentData.payload : null,
          attachmentMeta: attachmentData ? attachmentData.meta : null
        });
      } catch (e) {
        console.warn('[BLEInterface] onPayloadReceived error:', e && e.message);
      }
    })();
  },

  _sendMessageNative(deviceId, content, messageId, seq, dst) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var viaLan = _lanNx(deviceId), viaNet = _netNx(deviceId);
      if (!viaLan && !viaNet && (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'sendMessage'))) {
        reject(new Error('sendMessage nativo no disponible'));
        return;
      }
      // FIX v6.1.2: el nativo lee 'message' (no 'content'); desde v6.1.1 se enviaba vacío.
      // Mensajes normales viajan en el sobre v1 'chat' con datos del remitente (como en v6.1.0);
      // los paquetes de control (ack, ping, chunks, sync) van tal cual.
      var targetId = deviceId;
      var knownMac = self._nexoIdToMac.get(_normId(deviceId));
      if (knownMac) targetId = knownMac;
      var outgoing = content;
      if (!_isControlPacket(content)) {
        var senderId = self.localNexoId || self.localDeviceUUID;
        var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
        var msgSeq = (typeof seq === 'number') ? seq : self.getNextSeq();
        var payloadObj = { text: content, senderNexoId: senderId, senderName: self.localDeviceName || 'Nexo Device', timestamp: Date.now() };
        if (content && content.charAt(0) === '{') {
          try {
            var parsedContent = JSON.parse(content);
            if (parsedContent && parsedContent.type === 'attachment') payloadObj.attachment = parsedContent;
          } catch (e) {}
        }
        outgoing = JSON.stringify({ v: 1, type: 'chat', from: senderId, to: dst ? _normId(dst) : '', ts: Date.now(), seq: msgSeq, msgId: msgId, payload: payloadObj, ss: 1, nt: 1 });
      }
      var send = function(out) {
        if (viaLan) { self.lan.send(viaLan, out).then(resolve).catch(reject); return; }
        if (viaNet) {
          if (!self.net) { reject(new Error('Sin internet')); return; }
          self.net.send(viaNet, out).then(function(r) {
            // Un mensaje guardado en un relé ya está a salvo (buzón): ✓ y sin reintentos; ✓✓ cuando el otro confirme
            if (!_isControlPacket(content) && messageId && self.ackSystem) self.ackSystem.handleCustody(messageId);
            resolve(r);
          }).catch(reject);
          return;
        }
        _safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: targetId, message: out })
          .then(function(r) {
            if (r && typeof r.mtu === 'number' && r.mtu >= 23) self._noteMtu(targetId, r.mtu);
            resolve(r);
          })
          .catch(reject);
      };
      // v6.11.0: por Jump (dst), en sobre sellado para el destino: los puentes no ven quién lo manda
      if (dst && !_isControlPacket(content) && self.hopSeals(deviceId)) {
        var mid = null;
        try { mid = JSON.parse(outgoing).msgId; } catch (e) {}
        self._sealString(dst, outgoing, mid).then(send).catch(function() { send(outgoing); });
        return;
      }
      send(outgoing);
    });
  },

  // Ronda 2753: trozo de archivo en binario (BinFrame.kt). Solo Bluetooth directo
  _sendBinaryNative(deviceId, header, b64) {
    var self = this;
    if (_lanNx(deviceId) || _netNx(deviceId) || !self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'sendBinary')) {
      var e = new Error('sendBinary no disponible'); e.code = 'UNIMPLEMENTED';
      return Promise.reject(e);
    }
    var targetId = self._nexoIdToMac.get(_normId(deviceId)) || deviceId;
    return _safeNativeCall(self.nativePlugin, 'sendBinary', { deviceId: targetId, header: header, data: b64 }).then(function(r) {
      if (r && typeof r.mtu === 'number' && r.mtu >= 23) self._noteMtu(targetId, r.mtu);
      return r;
    });
  },

  // Ronda 2757 (plan punto 8): MTU de cada enlace; al diagnóstico cuando cambia (23 = mínimo: todo ~20 veces más lento)
  _noteMtu(targetId, mtu) {
    var nd = _normMac(targetId), prev = this._mtuByDevice.get(nd);
    this._mtuByDevice.set(nd, mtu);
    if (prev === mtu) return;
    var nx = this._macToNexoId.get(nd) || nd;
    if (mtu <= 23) console.warn('[MTU] ' + nx + ': ' + mtu + ' (mínimo: Bluetooth muy lento con este teléfono)');
    else console.log('[MTU] ' + nx + ': ' + mtu);
  },

  _sendRawNative(deviceId, packet) {
    var self = this;
    if (_lanNx(deviceId) && self.lan) return self.lan.send(_lanNx(deviceId), packet);
    if (_netNx(deviceId) && self.net) return self.net.send(_netNx(deviceId), packet);
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'sendMessage')) return Promise.reject(new Error('sendMessage nativo no disponible'));
    return _safeNativeCall(self.nativePlugin, 'sendMessage', { deviceId: deviceId, message: packet });
  },

  _processPendingMessages(deviceId) {
    var self = this;
    // v6.1.9: cola por contacto ('nx:<id>') + la antigua por dirección
    var keys = [_normMac(deviceId)];
    var nxQ = self._macToNexoId.get(_normMac(deviceId));
    if (nxQ) keys.push('nx:' + _normId(nxQ));
    var queue = [];
    keys.forEach(function(k) {
      var q = self._pendingMessageQueue.get(k);
      if (q && q.length) { queue = queue.concat(q); self._pendingMessageQueue.delete(k); }
    });
    if (queue.length === 0) return;
    queue.forEach(function(item) {
      // v6.1.6: con confirmación y reintentos. Antes salía una sola vez sin ack: si el otro teléfono
      // acababa de abrir la app y su JS aún no escuchaba, se perdía mostrando ✓.
      var send = (self.ackSystem && typeof self.ackSystem.sendWithRetry === 'function')
        ? self.ackSystem.sendWithRetry(deviceId, item.content, item.messageId, item.seq)
        : self._sendMessageNative(deviceId, item.content, item.messageId, item.seq);
      send.then(function() { if (item.resolve) item.resolve(); })
        .catch(function(err) { if (item.reject) item.reject(err); });
    });
  },

  sendChatMessage(deviceUUID, content, messageId, seq) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('deviceUUID vacio')); return; }
        var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
        var msgSeq = (typeof seq === 'number') ? seq : self.getNextSeq();

        var deviceId = self._resolveDeviceIdForNexoId(uuid);
        // v6.3.0 Jump: sin enlace directo pero con ruta por otro teléfono → sale por él
        var relayHop = self.relay && self.relay.relayHop(uuid);
        if (relayHop && !self._cameraBlePaused) {
          self._sendViaRelay(uuid, content, msgId, msgSeq)
            .then(function() { _vaultUpdateMessageStatus(uuid, msgId, 'sent'); resolve(); })
            .catch(function(err) {
              // Sin custodia: queda en cola para el contacto (directo o por otra ruta)
              var qr = self._pendingMessageQueue.get('nx:' + uuid) || [];
              qr.push({ content: content, messageId: msgId, seq: msgSeq, resolve: resolve, reject: reject });
              self._pendingMessageQueue.set('nx:' + uuid, qr);
              console.warn('[JUMP] Sin confirmación del puente, en cola:', err && err.message);
            });
          return;
        }
        // v6.13.0: sin camino ahora pero con internet: al buzón (lo recoge al conectarse)
        var tryMailbox = function(onFail) {
          if (!self.net || !self.net.mailboxOk(uuid)) return false;
          self._sendViaNetMailbox(uuid, content, msgId, msgSeq)
            .then(function() { _vaultUpdateMessageStatus(uuid, msgId, 'sent'); resolve(); })
            .catch(function(err) { console.warn('[NET] Buzón no disponible: ' + (err && err.message)); onFail(); });
          return true;
        };
        if (!deviceId) {
          if (self.relay) self.relay.discover(uuid);
          if (tryMailbox(function() {
            var qm = self._pendingMessageQueue.get('nx:' + uuid) || [];
            qm.push({ content: content, messageId: msgId, seq: msgSeq, resolve: resolve, reject: reject });
            self._pendingMessageQueue.set('nx:' + uuid, qm);
          })) return;
          // v6.1.11: contacto aún no visto por radio (p.ej. compartido): en cola hasta encontrarlo
          var q0 = self._pendingMessageQueue.get('nx:' + uuid) || [];
          q0.push({ content: content, messageId: msgId, seq: msgSeq, resolve: resolve, reject: reject });
          self._pendingMessageQueue.set('nx:' + uuid, q0);
          console.log('[BLEInterface] sendChatMessage: contacto aún no visto, en cola hasta encontrarlo', uuid);
          self._markPeerLost(uuid);
          return;
        }

        var state = self._getDeviceState(deviceId);
        var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
        var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;

        if (self._cameraBlePaused) {
          self._waitIfCameraPaused().then(function() {
            self.sendChatMessage(deviceUUID, content, msgId, msgSeq).then(resolve).catch(reject);
          }).catch(reject);
          return;
        }

        function doSend() {
          var isLong = content.length > 180;
          if (isLong && self.ackSystem && typeof self.ackSystem.sendChunkedMessage === 'function') {
            self.ackSystem.sendChunkedMessage(deviceId, content, {}, msgId, msgSeq)
              .then(function() { _vaultUpdateMessageStatus(uuid, msgId, 'sent'); resolve(); })
              .catch(function(err) { _vaultUpdateMessageStatus(uuid, msgId, _failStatus(err)); reject(err); });
            return;
          } else if (self.ackSystem && typeof self.ackSystem.sendWithRetry === 'function') {
            // v6.1.5: con confirmación y reintentos; antes un paquete perdido en el aire se perdía
            // para siempre aunque mostrara ✓ (el receptor descarta duplicados por id)
            self.ackSystem.sendWithRetry(deviceId, content, msgId, msgSeq)
              .then(function() { _vaultUpdateMessageStatus(uuid, msgId, 'sent'); resolve(); })
              .catch(function(err) { _vaultUpdateMessageStatus(uuid, msgId, _failStatus(err)); reject(err); });
          } else {
            self._sendMessageNative(deviceId, content, msgId, msgSeq)
              .then(function() { _vaultUpdateMessageStatus(uuid, msgId, 'sent'); resolve(); })
              .catch(function(err) { _vaultUpdateMessageStatus(uuid, msgId, 'failed'); reject(err); });
          }
        }

        function enqueueMsg() {
          var qKey = 'nx:' + uuid;
          var queue = self._pendingMessageQueue.get(qKey) || [];
          queue.push({ content: content, messageId: msgId, seq: msgSeq, resolve: resolve, reject: reject });
          self._pendingMessageQueue.set(qKey, queue);
        }

        if (isReady) { doSend(); return; }
        if (tryMailbox(enqueueMsg)) {
          if (self.relay) self.relay.discover(uuid);
          return;
        }
        enqueueMsg();
        self._markPeerLost(uuid);
        // v6.4.0: sin enlace directo: buscar camino por otros teléfonos NEXO (Jump bajo demanda)
        if (self.relay) self.relay.discover(uuid);
        if (!isConnecting && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          console.log('[BLEInterface] sendChatMessage: forcing connectToDevice for', deviceId);
          _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId }).catch(function() {});
        }
      } catch (fatal) { reject(fatal); }
    });
  },

  sendFile(deviceUUID, fileId, base64Data, meta) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('deviceUUID vacio')); return; }
        if (!base64Data) { reject(new Error('base64Data vacio')); return; }

        var deviceId = self._resolveDeviceIdForNexoId(uuid);
        if (!deviceId) {
          // Último intento: active chat
          if (self._activeChatDeviceId === uuid && self._activeChatDeviceIdNative) {
            deviceId = self._activeChatDeviceIdNative;
          }
        }
        if (!deviceId && self.relay && self.relay.relayHop(uuid)) deviceId = uuid;
        if (!deviceId) {
          // v6.1.11: contacto aún no visto: el adjunto queda pendiente y se reenvía al encontrarlo
          self._markPeerLost(uuid);
          if (self.relay) self.relay.discover(uuid);
          var eNf = new Error('Contacto no disponible: queda pendiente');
          eNf.code = 'PEER_ABSENT';
          reject(eNf);
          return;
        }

        if (!self.ackSystem || typeof self.ackSystem.sendFile !== 'function') {
          reject(new Error('AckSystem no disponible'));
          return;
        }

        function startTransfer() {
          console.log('[BLEInterface] sendFile START fileId=' + fileId + ' deviceId=' + deviceId + ' b64len=' + base64Data.length);
          self.ackSystem.sendFile(deviceId, fileId, base64Data, meta || {})
            .then(function() { resolve(); })
            .catch(function(err) { reject(err); });
        }

        // v6.1.9: el dispositivo se resuelve en cada intento (el otro puede volver con otra dirección).
        // Si en 8 s no hay enlace listo con ese contacto: PEER_ABSENT; el adjunto queda pendiente y se
        // reenvía al reconectar. Antes esperaba ~40 s a la dirección vieja y el vídeo se perdía.
        function ensureReadyThenSend() {
          var deadline = Date.now() + 8000;
          var nudged = false;
          (function check() {
            var dev = self._resolveDeviceIdForNexoId(uuid) || deviceId;
            // v6.13.0: por internet, archivos solo si los dos están en Wi-Fi (con datos móviles esperan)
            var netNo = !!_netNx(dev) && !(self.net && self.net.filesOk(uuid));
            if (netNo) dev = self._bleReadyFor(uuid) || dev;
            var st = self._getDeviceState(dev);
            if ((!netNo || !_netNx(dev)) && (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY)) {
              deviceId = dev;
              startTransfer();
              return;
            }
            // v6.3.0 Jump: por otro teléfono si hay ruta
            var rh = self.relay && self.relay.relayHop(uuid, { files: true });
            if (rh) {
              deviceId = rh.deviceId;
              meta = Object.assign({}, meta || {}, { dst: uuid });
              console.log('[JUMP] Adjunto ' + fileId + ' a ' + uuid + ' por ' + rh.via);
              self._noteRelayedOut(fileId, uuid);
              self.relay.plan(uuid, (meta && meta.type) || 'file', base64Data.length);
              startTransfer();
              return;
            }
            if (!nudged) {
              nudged = true;
              console.log('[BLEInterface] sendFile: contacto no listo (' + (st.state || '?') + '), buscando…');
              self._markPeerLost(uuid);
              if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice') && st.state !== BLE_STATES.CONNECTING) {
                _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: dev }).catch(function() {});
              }
            }
            if (Date.now() >= deadline) {
              if (self.relay) self.relay.discover(uuid);
              var e = new Error('Contacto no disponible: queda pendiente');
              e.code = 'PEER_ABSENT';
              reject(e);
              return;
            }
            setTimeout(check, 500);
          })();
        }

        // Flujo post-cámara
        var afterCamera = function() {
          // Pequeño margen para estabilizar radio
          setTimeout(ensureReadyThenSend, 500);
        };

        if (self._cameraBlePaused) {
          self._waitIfCameraPaused()
            .then(afterCamera)
            .catch(reject);
        } else {
          afterCamera();
        }
      } catch (fatal) { reject(fatal); }
    });
  },

  _resendPendingMessages(nexoId) {
    var self = this;
    if (!nexoId) return;
    var getPending = (window.vaultGetPendingMessages && typeof window.vaultGetPendingMessages === 'function')
      ? window.vaultGetPendingMessages(nexoId)
      : _vaultLoadMessages(nexoId).then(function(msgs) {
          return msgs.filter(_isResendable);
        });
    getPending = getPending.then(_hydrateAttachments);
    getPending.then(function(pending) {
      // No reenviar lo que sigue en vuelo en esta sesión (cola JS, ACK pendiente o stream activo)
      pending = (pending || []).filter(function(m) { return !self._isMsgInFlight(m.msgId || m.messageId || m.id); });
      if (pending.length === 0) return;
      var deviceId = self._resolveDeviceIdForNexoId(nexoId);
      var st = deviceId ? self._getDeviceState(deviceId) : {};
      var direct = st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY;
      var relayDst = null;
      if (!direct) {
        // v6.3.0 Jump: por otro teléfono si hay ruta
        var rh = self.relay && self.relay.relayHop(nexoId);
        if (!rh) {
          console.log('[BLEInterface] ' + pending.length + ' pending para ' + nexoId + ': sin enlace ni ruta, quedan en espera');
          if (self.relay) self.relay.discover(nexoId);
          return;
        }
        deviceId = rh.deviceId;
        relayDst = _normId(nexoId);
        console.log('[JUMP] Reenviando', pending.length, 'pending para', nexoId, 'por', rh.via);
        pending.forEach(function(m) { self._noteRelayedOut(m.msgId || m.messageId || m.id, relayDst); });
      } else {
        console.log('[BLEInterface] Reenviando', pending.length, 'pending para', nexoId);
        if (self.ackSystem && typeof self.ackSystem.resumeOutgoingTransfers === 'function') {
          try { self.ackSystem.resumeOutgoingTransfers(deviceId); } catch (e) {}
        }
      }
      var idx = 0;
      function sendNext() {
        if (idx >= pending.length) return;
        var msg = pending[idx++];
        var mid = msg.msgId || msg.messageId || msg.id;
        if (!mid) {
          sendNext();
          return;
        }
        _vaultUpdateMessageStatus(nexoId, mid, 'sending');
        try {
          if (window.NEXO_updateMessageStatus) {
            window.NEXO_updateMessageStatus(mid, 'sending');
          }
        } catch (e) {}

        var attachmentType = msg.attachmentType || null;
        var attachmentPayload = msg.attachmentPayload || null;
        var attachmentMeta = msg.attachmentMeta || null;

        if (!attachmentType && msg.content && typeof msg.content === 'string') {
          try {
            var parsed = JSON.parse(msg.content);
            if (parsed && parsed.type === 'attachment') {
              attachmentType = parsed.attachmentType || null;
              attachmentPayload = parsed.payload || null;
              attachmentMeta = parsed.meta || null;
            }
          } catch (e) {}
        }

        var msgSeq = (typeof msg.seq === 'number') ? msg.seq : undefined;
        var doSend;
        // Ronda 2756: archivo grande (big_file.js): el mensaje es pequeño (nombre, tamaño, clave) y va como texto; el
        // archivo va aparte por Wi-Fi. Sin clave aún se está preparando: nada que reenviar todavía.
        var bigMeta = attachmentMeta && attachmentMeta.big;
        if (bigMeta && !bigMeta.key) { sendNext(); return; }

        if (
          attachmentType &&
          attachmentPayload &&
          !bigMeta &&
          (attachmentType === 'image' ||
           attachmentType === 'video' ||
           attachmentType === 'file')
        ) {
          if (!self.ackSystem || typeof self.ackSystem.sendFile !== 'function') {
            console.warn('[BLEInterface] AckSystem sin sendFile para pending:', mid);
            _vaultUpdateMessageStatus(nexoId, mid, 'failed');
            try {
              if (window.NEXO_updateMessageStatus) {
                window.NEXO_updateMessageStatus(mid, 'failed');
              }
            } catch (e2) {}
            sendNext();
            return;
          }
          var fileMeta = Object.assign(
            { type: attachmentType },
            attachmentMeta || {},
            relayDst ? { dst: relayDst } : {}
          );
          doSend = function() {
            return self.ackSystem.sendFile(
              deviceId,
              mid,
              attachmentPayload,
              fileMeta
            );
          };
          console.log('[BLEInterface] Reenviando ADJUNTO:', attachmentType, mid);
        } else {
          var txt = bigMeta ? JSON.stringify({ type: 'attachment', attachmentType: 'file', payload: 'big', meta: attachmentMeta }) : (msg.content || msg.text || '');
          if (
            txt.length > 180 &&
            self.ackSystem &&
            typeof self.ackSystem.sendChunkedMessage === 'function'
          ) {
            doSend = function() {
              return self.ackSystem.sendChunkedMessage(
                deviceId,
                txt,
                relayDst ? { dst: relayDst } : {},
                mid,
                msgSeq
              );
            };
          } else if (self.ackSystem) {
            doSend = function() {
              return self.ackSystem.sendWithRetry(
                deviceId,
                txt,
                mid,
                msgSeq,
                relayDst ? { dst: relayDst } : undefined
              );
            };
          } else {
            doSend = function() {
              return self._sendMessageNative(
                deviceId,
                txt,
                mid,
                msgSeq
              );
            };
          }
        }

        doSend()
          .then(function() {
            console.log('[BLEInterface] Pending OK:', mid);
            _vaultUpdateMessageStatus(nexoId, mid, 'sent');
            try {
              if (window.NEXO_updateMessageStatus) {
                window.NEXO_updateMessageStatus(mid, 'sent');
              }
            } catch (e) {}
            sendNext();
          })
          .catch(function(e) {
            console.warn('[BLEInterface] Pending fallo:', mid, e.message);
            // No marcar failed de forma agresiva si es transitorio
            var isTransient = /timeout|abort|network|disconnected|not ready|busy|interrupted|temporary/i.test(e.message || '') || _failStatus(e) === 'pending';
            if (!isTransient) {
              _vaultUpdateMessageStatus(nexoId, mid, 'failed');
              try {
                if (window.NEXO_updateMessageStatus) {
                  window.NEXO_updateMessageStatus(mid, 'failed');
                }
              } catch (e2) {}
            }
            sendNext();
          });
      }
      sendNext();
    }).catch(function(e) {
      console.warn('[BLEInterface] Error cargando pending:', e.message);
    });
  }
};
