import { _normId, _isGenericName, _getBLEContacts, _saveBLEContacts, _lanNx, _netNx, _normMac, _hasNativeMethod, _isControlPacket, _safeNativeCall, _vaultUpdateMessageStatus, BLE_STATES, _failStatus, _isPathDev } from './ble_helpers.js';
// Build 2836 (pedido del dueño): margen para la «red de seguridad de entrega». Si un mensaje enviado por Bluetooth no
// se confirma «entregado» en este tiempo, se deja además en el buzón de relés (dispara el toque FCM de alta prioridad).
var DELIVERY_SAFETY_MS = 10000;

// Métodos de BLE_MESSAGE_METHODS: ENVÍO de textos: a quién va, por qué enlace, escritura al nativo, pendientes y red de seguridad de entrega.
// Reestructuración 15-11: movidos TAL CUAL desde ble_messages.js, que los une en BLE_MESSAGE_METHODS.
export const BLE_SEND_METHODS = {

  _notePeerName(nexoId, nm) {
    var nx = _normId(nexoId), name = String(nm).replace(/[\u0000-\u001f<>]/g, '').trim().substring(0, 40);
    if (!name || _isGenericName(name)) return;
    var found = this.foundDevices && this.foundDevices.get(nx);
    if (found && _isGenericName(found.name)) { found.name = name; this._newBarSoon(true); } // 3184: su nombre (kx), al momento
    var contacts = _getBLEContacts(), c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c || !_isGenericName(c.name)) return;
    c.name = name;
    _saveBLEContacts(contacts);
    console.log('[ADD] Nombre de ' + nx + ': ' + name);
    this.renderContactsList(); this.renderOnlineStrip();
  },

  // ===== Ronda 2764: cada conexión, de quien es de verdad =====
  // NEXO ID al que va lo que sale por esta conexión ('' si no se sabe)
  _destNx(deviceId) {
    var d = String(deviceId || '');
    var nx = _lanNx(d) || _netNx(d) || (/^nx[0-9a-z]{8}$/i.test(d) ? d : this._macToNexoId.get(_normMac(d)));
    nx = _normId(nx || '');
    return /^nx[0-9a-z]{8}$/.test(nx) ? nx : '';
  },
  // ¿Esta dirección consta como de otro contacto (no de nx)?
  _macOfOther(mac, nx) {
    var owner = _normId(this._macToNexoId.get(_normMac(mac)) || '');
    return !!owner && /^nx[0-9a-z]{8}$/.test(_normId(nx)) && owner !== _normId(nx);
  },
  // Esta conexión es de nx (lo dijo su kx o su 'ni'): fuera de cualquier otro contacto que la tuviera apuntada
  _remapDevice(deviceId, nexoId, why) {
    var nd = _normMac(deviceId), nx = _normId(nexoId || '');
    if (!nd || /^(lan|net)/i.test(String(deviceId)) || !/^nx[0-9a-z]{8}$/.test(nx)) return;
    var old = _normId(this._macToNexoId.get(nd) || '');
    if (old === nx) return;
    if (old) {
      console.warn('[SEND] La conexión ' + deviceId + ' estaba apuntada como de ' + old + ' y es de ' + nx + ' (' + why + '): corregido');
      if (_normMac(this._nexoIdToMac.get(old) || '') === nd) this._nexoIdToMac.delete(old);
      var contacts = _getBLEContacts(), changed = false;
      contacts.forEach(function(c) { if (_normId(c.nexoId || c.deviceUUID) === old && _normMac(c.deviceId || '') === nd) { c.deviceId = null; changed = true; } });
      if (changed) _saveBLEContacts(contacts);
    }
    this._macToNexoId.set(nd, nx);
    if (!this._nexoIdToMac.get(nx) || this._macOfOther(this._nexoIdToMac.get(nx), nx)) this._nexoIdToMac.set(nx, nd);
    var cd = this.connectedDevices.get(deviceId);
    if (cd) cd.deviceUUID = nx.toUpperCase();
    if (old) { var self = this; setTimeout(function() { self._resendPendingMessages(old); }, 500); }
  },
  // Llegó algo que va a otro (dn): no se procesa; se le dice al que lo mandó (una vez cada 5 s por conexión)
  _notMine(deviceId, dn) {
    var me = _normId(this.localNexoId), now = Date.now();
    this._niSent = this._niSent || new Map();
    if (now - (this._niSent.get(deviceId) || 0) < 5000) return;
    this._niSent.set(deviceId, now);
    console.warn('[SEND] Llegó por ' + deviceId + ' algo que va a ' + dn + ': no es para este teléfono (se ignora y se avisa)');
    this._sendMessageNative(deviceId, JSON.stringify({ v: 1, type: 'ni', from: me, x: dn }), null).catch(function() {});
  },
  // El otro dice que no es dn: esta conexión es suya, no de dn
  _wrongPeer(deviceId, from, dn) {
    var nd = _normMac(deviceId), wrong = _normId(dn || ''), real = _normId(from || '');
    if (!nd || /^(lan|net)/i.test(String(deviceId))) return;
    console.warn('[SEND] ' + (real || 'El otro') + ' dice que lo enviado por ' + deviceId + ' (para ' + wrong + ') no es para él');
    // M5/M6 (#dueño 07-11, control sin autenticar): un 'ni' puede re-apuntar esta conexión a 'real'. Solo lo honro si 'real' es
    // un CONTACTO conocido — así un DESCONOCIDO no puede forjar un 'ni' para re-etiquetar/re-enrutar la conexión (es molestia:
    // el contenido ya lo protege el cifrado E2E, pero sin esto podía estorbar el enrutado o inferir presencia). Un 'ni' legítimo
    // (corregir un mensaje mal dirigido entre los que ya hablan) siempre viene de un contacto, así que no rompe el caso real.
    if (/^nx[0-9a-z]{8}$/.test(real) && this._isKnownSender(real)) { if (_normId(this._macToNexoId.get(nd) || '') !== real) this._remapDevice(deviceId, real, 'no era él'); }
    else if (!/^nx[0-9a-z]{8}$/.test(real) && _normId(this._macToNexoId.get(nd) || '') === wrong) { this._macToNexoId.delete(nd); if (_normMac(this._nexoIdToMac.get(wrong) || '') === nd) this._nexoIdToMac.delete(wrong); }
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
      if (knownMac && !self._macOfOther(knownMac, deviceId)) targetId = knownMac;
      var outgoing = content;
      // Ronda 2764: un sobre sellado de Jump va tal cual a quien lo entiende (kx ss:1). Antes el puente lo metía en un
      // mensaje suyo y el teléfono siguiente (su parte nativa, con la app en segundo plano o cerrada) avisaba de
      // "Mensaje nuevo" por un paquete que solo estaba de paso
      var sxIn = null;
      if (content && content.indexOf('"type":"sx"') >= 0) { try { sxIn = JSON.parse(content); } catch (e) {} if (!sxIn || sxIn.type !== 'sx') sxIn = null; }
      var sxRaw = !!(sxIn && !dst && self.hopSeals(deviceId));
      if (!sxRaw && !_isControlPacket(content)) {
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
        var env = { v: 1, type: 'chat', from: senderId, to: dst ? _normId(dst) : '', ts: Date.now(), seq: msgSeq, msgId: msgId, payload: payloadObj, ss: 1, nt: 1 };
        // Ronda 2758: acción oculta (borrar para todos…): si el otro tiene la app cerrada, sin notificación
        if (self._quietOut && self._quietOut.has(msgId)) env.q = 1;
        // Ronda 2763: mensaje de grupo directo (no por Jump): el id del grupo (al azar, sin nombre) va por fuera para que
        // el aviso con la app cerrada lleve el nombre del grupo (BgInbox.kt)
        if (!dst && self._groupOut && self._groupOut.has(msgId)) env.g = self._groupOut.get(msgId);
        // Ronda 2759: oferta de llamada: con la app del otro cerrada, su aviso dice "Llamada entrante" (BgInbox.kt)
        if (self._callOut && self._callOut.has(msgId)) env.cl = 1;
        if (self._callVideoOut && self._callVideoOut.has(msgId)) env.cv = 1; // 3089: videollamada (el aviso nativo lo dice)
        // 3087: «colgar» del que llama: el id de su oferta por fuera, para que el nativo del otro deje de sonar con la app cerrada
        if (self._callEndOut && self._callEndOut.has(msgId)) env.ce = self._callEndOut.get(msgId);
        // Sobre de paso hacia una build anterior (lo desenvuelve como texto del puente): sin aviso si no es para ella
        if (sxIn && _normId(sxIn.to) !== self._destNx(deviceId)) env.q = 1;
        // Ronda 2764: a quién va (el que lo recibe lo ignora si no es él; ver _prePayload). Se fija la primera vez: un
        // reintento sigue siendo para el mismo aunque la conexión resultara ser de otro (entonces va por la buena)
        var dn0 = '';
        if (!dst) {
          self._msgDest = self._msgDest || new Map();
          dn0 = self._msgDest.get(msgId) || self._destNx(deviceId);
          if (dn0) { self._msgDest.set(msgId, dn0); if (self._msgDest.size > 2000) self._msgDest.delete(self._msgDest.keys().next().value); }
          var curDn = (!viaLan && !viaNet) ? self._destNx(deviceId) : '';
          if (dn0 && curDn && curDn !== dn0) {
            var right = self._resolveDeviceIdForNexoId(dn0);
            if (right && _normMac(right) !== _normMac(deviceId) && self._destNx(right) !== curDn) {
              console.log('[SEND] ' + msgId + ' es para ' + dn0 + ': por su conexión, no por la de ' + curDn);
              self._sendMessageNative(right, content, msgId, msgSeq, dst).then(resolve, reject);
              return;
            }
            var ePa = new Error('Contacto no disponible: queda pendiente'); ePa.code = 'PEER_ABSENT';
            reject(ePa);
            return;
          }
        }
        if (dn0) env.dn = dn0;
        outgoing = JSON.stringify(env);
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
    // 3058: en llamada, lo que esperaba en memoria para este contacto (escrito cuando no estaba) no sale por Bluetooth hasta colgar;
    // las señales de llamada (cs…/gcs…) sí salen (p. ej. la oferta que esperaba a que apareciera el otro)
    if (self._callUsesBle() && !/^(lan|net)/i.test(String(deviceId))) {
      var isSig = function(it) { return /^g?cs/.test(String(it.messageId || '')); };
      var later = queue.filter(function(it) { return !isSig(it); });
      if (later.length) {
        var hk = nxQ ? 'nx:' + _normId(nxQ) : _normMac(deviceId);
        self._pendingMessageQueue.set(hk, later.concat(self._pendingMessageQueue.get(hk) || []));
        self._callHeld = self._callHeld || new Set();
        var hnx = nxQ ? _normId(nxQ) : null;
        if (hnx && !self._callHeld.has(hnx)) console.log('[BLEInterface] En llamada: ' + later.length + ' mensaje(s) en espera para ' + hnx + ' por Bluetooth esperan a colgar (la radio es de la llamada)');
        if (hnx) self._callHeld.add(hnx);
        queue = queue.filter(isSig);
        if (!queue.length) return;
      }
    }
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
        // Ronda 2766: a quién va, desde el principio (dn del paquete y para quién se cifra)
        if (/^nx[0-9a-z]{8}$/.test(uuid)) { self._msgDest = self._msgDest || new Map(); self._msgDest.set(msgId, uuid); }

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
          // 3197 (hallazgo del ayudante de la 3193, 17-11): mientras espera a que se cierre la cámara (≤ 8 s) cuenta como en vuelo; antes
          // el reenvío de pendientes lo mandaba en ese rato y al cerrarla salía otra vez
          var heldCam = self._holdOut(msgId);
          self._waitIfCameraPaused().then(function() {
            self.sendChatMessage(deviceUUID, content, msgId, msgSeq).then(resolve).catch(reject);
            heldCam();
          }).catch(function(err) { heldCam(); reject(err); });
          return;
        }

        function doSend() {
          var isLong = content.length > 180;
          if (isLong && self.ackSystem && typeof self.ackSystem.sendChunkedMessage === 'function') {
            self.ackSystem.sendChunkedMessage(deviceId, content, { to: uuid }, msgId, msgSeq)
              .then(function() { _vaultUpdateMessageStatus(uuid, msgId, 'sent'); resolve(); })
              .catch(function(err) { _vaultUpdateMessageStatus(uuid, msgId, _failStatus(err)); reject(err); });
            return;
          } else if (self.ackSystem && typeof self.ackSystem.sendWithRetry === 'function') {
            // v6.1.5: con confirmación y reintentos; antes un paquete perdido en el aire se perdía
            // para siempre aunque mostrara ✓ (el receptor descarta duplicados por id)
            self.ackSystem.sendWithRetry(deviceId, content, msgId, msgSeq, { to: uuid })
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

        if (isReady) { doSend(); self._armDeliverySafetyNet(uuid, content, msgId, msgSeq); return; }
        if (tryMailbox(enqueueMsg)) {
          if (self.relay) self.relay.discover(uuid);
          return;
        }
        enqueueMsg();
        self._markPeerLost(uuid);
        // v6.4.0: sin enlace directo: buscar camino por otros teléfonos NEXO (Jump bajo demanda)
        if (self.relay) self.relay.discover(uuid);
        // 3033: con el Bluetooth en pausa (GATT roto) no se fuerza la conexión: el texto espera por internet/Wi-Fi/Jump
        // 3072: ni un destino «net:»/«lan:» (no es un Bluetooth; el nativo lo veía como «netnx…» y no hacía nada)
        // 3084: ni a quien no está cerca por Bluetooth (no visto hace poco): el texto va por internet/Wi-Fi/Jump o espera a verlo
        if (!isConnecting && !_isPathDev(deviceId) && typeof self._btNearby === 'function' && !self._btNearby(uuid)) self._btFarSkip(uuid, 'al mandar');
        else if (!isConnecting && !_isPathDev(deviceId) && !(typeof self._btPaused === 'function' && self._btPaused(uuid)) && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          console.log('[BLEInterface] sendChatMessage: forcing connectToDevice for', deviceId);
          _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId }).catch(function() {});
        }
      } catch (fatal) { reject(fatal); }
    });
  },

  // Build 2836 (pedido del dueño: «enviar mensaje con ahorro de batería, como WhatsApp que siempre llega»): red de
  // seguridad de entrega. El mensaje sale primero por Bluetooth (rápido y local). Si a los ~10 s NO se confirmó
  // «entregado» —el otro puede estar dormido en ahorro de batería, con su app/servicio parados por el fabricante—, se
  // deja ADEMÁS una copia en el buzón de relés, que dispara el «toque» FCM de ALTA prioridad (atraviesa Doze/ahorro): el
  // otro despierta y recibe por internet, o por Bluetooth al revivir su servicio. Mismo msgId → el receptor deduplica
  // (nunca llega doble) y un solo acuse de entrega resuelve el estado. Es el modelo servidor+push de WhatsApp.
  // Defensivo: solo con internet + token del contacto (mailboxOk); nada para acciones ocultas; si ya se entregó, no hace nada.
  _armDeliverySafetyNet(nexoId, content, msgId, seq) {
    var self = this;
    try {
      if (!self.net || !msgId) return;
      if (self._quietOut && self._quietOut.has(msgId)) return; // acción oculta (react/edit/estado): no despertar al otro
      if (self._callOut && self._callOut.has(msgId)) return;   // oferta de llamada: ya dispara su propio toque inmediato (calls.js, build 2837)
      var nx = _normId(nexoId);
      setTimeout(function() {
        try {
          if (self.ackSystem && self.ackSystem.isDone(msgId)) return;    // ya entregado/leído por Bluetooth: nada
          // 3088 (idea del dueño 14-11: «cada mensaje que se le manda a un teléfono dormido lleve su despertador hasta que haya
          // confirmación de que despertó»): sin ✓✓ a los ~10 s, el contacto entra al calendario de toques (30 s → 2 m → 8 m…) y
          // sigue ahí aunque parezca alcanzable, mientras lo suyo siga sin confirmar (_tickWakePending)
          if (typeof self._noteWakePending === 'function') self._noteWakePending(nx);
          if (!self.net || !self.net.mailboxOk(nx)) return;              // sin internet/token: no se puede (el reintento Bluetooth sigue)
          console.log('[NET] red de seguridad de entrega: ' + msgId + ' sin confirmar por Bluetooth → buzón + toque FCM');
          self._sendViaNetMailbox(nx, content, msgId, seq).catch(function() {});
        } catch (e) {}
      }, DELIVERY_SAFETY_MS);
    } catch (e) {}
  },
};
