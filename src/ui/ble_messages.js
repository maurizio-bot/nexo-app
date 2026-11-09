/**
 * NEXO — Mensajes por Bluetooth, Wi-Fi e internet (métodos de BLEInterface sacados de ble_interface.js en la ronda
 * 2752, sin cambios): lo que llega (descifrar, comprobar remitente, guardar, avisar) y lo que sale (texto, archivos,
 * pendientes, reenvío al reconectar).
 */
import { e2eOpenAnon } from '../vault/e2e_crypto.js';
import { e2eAnyEncrypted, e2eOpenText, e2eOuterAd } from '../vault/e2e_proto.js';
import { groupAttachment, parseGroupEnvelope } from './groups.js';
import { NET_MAX_B64_BYTES } from './media_limits.js';
import { parseCallSignal } from './calls.js';
import { parseGroupCallSignal } from './group_call.js';
import { BLE_STATES, SUPERVISOR_STATES, _addBLEContact, _chatKind, _isGenericName, _failStatus, _getBLEContacts, _getContactByDeviceId, _getContactByUUID, _hasNativeMethod, _hydrateAttachments, _isBLEContact, _isControlPacket, _isProtocolShaped, _isResendable, _lanNx, _messagePreview, _netNx, _normId, _normMac, _safeDispatchEvent, _safeNativeCall, _saveBLEContacts, _saveSeqCounter, _vaultAppendMessage, _vaultGetOrCreateContact, _vaultLoadMessages, _vaultUpdateMessageStatus } from './ble_helpers.js';
import { blobPointerIn, validatePointer, fetchBlob, blobMailboxEligible, pointerReusable, loadBlobSeen, saveBlobSeen, citaIn, validateCita, loadCitaIn, saveCitaIn, loadCitaOut, saveCitaOut, _fetchRetryDelay, _b64Bytes as _blobB64Bytes, MAX_CONCURRENT as BLOB_MAX_CONCURRENT, MAILBOX_MAX_BYTES as BLOB_MAILBOX_MAX_BYTES } from '../net/blob_mailbox.js'; // Fase B (2969): buzón de ARCHIVOS


// Build 2836 (pedido del dueño): margen para la «red de seguridad de entrega». Si un mensaje enviado por Bluetooth no
// se confirma «entregado» en este tiempo, se deja además en el buzón de relés (dispara el toque FCM de alta prioridad).
var DELIVERY_SAFETY_MS = 10000;

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
        self._noteWakePending(nx); // Build 2967 (Fase A): tocar (wake FCM) al contacto con pendientes; el tick lo quita si ya es alcanzable
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
    if (ack && ack._chatPrep && ack._chatPrep.has(msgId)) return true;
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
    // #dueño 04-11: el nativo avisa cuando SUELTA un mensaje por un enlace BT muerto/atascado (~6 s sin poder escribir).
    // En vez de seguir martillando el BT, se re-rutea al toque por internet/Wi-Fi (regla «internet antes que un BT muerto»).
    if (this._nativeWriteDroppedListener) { try { this._nativeWriteDroppedListener.remove(); } catch (e) {} }
    this._nativeWriteDroppedListener = this.nativePlugin.addListener('onWriteDropped', function(d) {
      if (d && d.mac && typeof self._markBleDead === 'function') self._markBleDead(d.mac);
    });
  },

  _prePayload(data) {
    var self = this;
    // Ronda 2760: cualquier cosa que llega por un enlace Bluetooth demuestra que está vivo (el vigilante solo contaba
    // la respuesta a su ping; si esa se retrasaba, cortaba un enlace que funcionaba)
    if (data && data.deviceId && !/^(lan|net)/i.test(data.deviceId) && self._lastPongTime) self._lastPongTime.set(data.deviceId, Date.now());
    // #dueño 04-11: recibir algo por un enlace BT es prueba de que está vivo → se quita el cooldown de «muerto» (vuelve a elegible)
    if (data && data.deviceId && !/^(lan|net)/i.test(data.deviceId) && typeof self._clearBleDead === 'function') self._clearBleDead(data.deviceId);
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
    if (raw.indexOf('"type":"ni"') >= 0) {
      var pni = null;
      try { pni = JSON.parse(raw); } catch (e) {}
      if (pni && pni.type === 'ni') { self._wrongPeer(data.deviceId, pni.from, pni.x); return Promise.resolve(null); }
    }
    // Ronda 2764 (informe del dueño: lo que la tablet mandaba al S24 sonaba y avisaba en el Vivo): un paquete directo
    // lleva a quién va ('dn'); si no es para este teléfono no se procesa (ni aviso, ni ✓✓) y se le dice al otro ('ni')
    // para que corrija a quién tiene apuntada esta conexión
    if (raw.indexOf('"dn":"') >= 0) {
      var dnm = /"dn":"(nx[0-9a-z]{8})"/i.exec(raw), me0 = _normId(self.localNexoId);
      if (dnm && me0 && _normId(dnm[1]) !== me0) { self._notMine(data.deviceId, _normId(dnm[1])); return Promise.resolve(null); }
    }
    // Wi-Fi Direct: control de una transferencia (por Bluetooth)
    if (/"type":"w[qanf]"/.test(raw) && self.wifiDirect) {
      var pw = null;
      try { pw = JSON.parse(raw); } catch (e) {}
      if (pw && self.wifiDirect.handle(pw, data.deviceId)) return Promise.resolve(null);
    }
    // Llamadas de voz (ronda 2758, calls.js): paquete de voz cifrado con la clave de la llamada
    if (/"type":"vf"/.test(raw) && (self.calls || self.gcall)) {
      var pv0 = null;
      try { pv0 = JSON.parse(raw); } catch (e) {}
      if (pv0 && pv0.type === 'vf') {
        // #128: primero a la llamada de GRUPO (onFrame devuelve true si el tramo es suyo); si no, a la 1-a-1
        if (self.gcall && self.gcall.onFrame(pv0, data.deviceId)) return Promise.resolve(null);
        if (self.calls) self.calls.onFrame(pv0, data.deviceId); // ronda 2768: y por dónde llegó
        return Promise.resolve(null);
      }
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
    // Ronda 2768 (revisión de llamadas, seguridad): un mensaje sin cifrar lo puede escribir cualquier teléfono cercano
    // diciendo ser otro (el servidor Bluetooth acepta escrituras de cualquiera): se mostraba como suyo, sonaban llamadas
    // falsas y la voz salía cifrada con una clave del intruso. Desde la 2702 todo lo de un contacto va cifrado: lo que
    // dice ser de un contacto (o de alguien cuya clave tenemos) y no lo está, se descarta
    if (raw.indexOf('"type":"chat"') >= 0 && raw.indexOf('E1:') < 0 && raw.indexOf('E2:') < 0) {
      var pc = null;
      try { pc = JSON.parse(raw); } catch (e) {}
      var claimed = pc && pc.type === 'chat' && pc.payload ? _normId(pc.from || pc.payload.senderNexoId || '') : '';
      if (claimed && self._isKnownSender(claimed)) {
        console.warn('[E2E] Mensaje sin cifrar que dice ser de ' + claimed + ': descartado');
        return Promise.resolve(null);
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
      // Ronda 2764: el kx dice quién está al otro lado de esta conexión: si la tenía apuntada como de otro, se corrige
      // (solo si su clave es la que conozco de él: un impostor no se lleva lo de otro)
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '') && p.pk && (!self._contactKey(p.from) || self._contactKey(p.from) === p.pk)) self._remapDevice(data.deviceId, p.from, 'kx');
      // Asociar la dirección (un teléfono que se conectó a nosotros y no es contacto no tenía mapeo)
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '')) self._kickPeer(data.deviceId, p.from);
      // Ronda 2755: si era un NEXO anónimo (código rotativo), ya se sabe quién es
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '') && self.relay && typeof self.relay.identify === 'function') self.relay.identify(data.deviceId, p.from);
      if (p.j && self.relay) self.relay.markCapable(p.from);
      // Ronda 2764: su nombre (el anuncio no lo trae: salía "Unknown"); solo si el que tengo es genérico
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '') && typeof p.nm === 'string' && p.nm.trim()) self._notePeerName(p.from, p.nm);
      // Ronda 2764: con "Agregar" abierto, un NEXO cercano que no es contacto (se identificó con su kx) sale en la lista
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '') && !_isBLEContact(p.from) && Date.now() < (self._visibleUntil || 0) && !/^(lan|net)/i.test(String(data.deviceId)))
        self.onDeviceFound({ id: data.deviceId, name: typeof p.nm === 'string' ? p.nm.substring(0, 40) : '', rssi: -60, nexoId: String(p.from).toUpperCase() });
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
      if (self.bigFiles) { if (p.bg) self.bigFiles.markPeer(p.from); else self.bigFiles.unmarkPeer(p.from); self.bigFiles.markL2(p.from, !!p.l2); } // archivos grandes (2756; L2CAP 2758)
      // Responder con el nuestro (cada lado sabe así que el otro entiende Jump; máx. 1 cada 15 s)
      if (p.rq || p.j) self._sendKx(data.deviceId, false, !!p.rq);
      return Promise.resolve(null);
    }
    if (viaRelay) data = Object.assign({}, data, { viaRelay: true, relayOrigin: _normId(p.from) });
    if (p && p.v === 1 && p.type === 'chat' && p.payload && e2eAnyEncrypted(p.payload.text)) {
      var sender = p.from || p.payload.senderNexoId;
      // Ronda 2758: lo que llega al abrir la app (buzón de la app cerrada, eventos retenidos) puede llegar antes de
      // cargar el NEXO ID propio, que va en los datos autenticados: sin esperar, el descifrado fallaba y se perdía
      return self._whenLocalId().then(function() {
        return e2eOpenText(sender, p.payload.text, e2eOuterAd(sender, self.localNexoId, p.msgId));
      }).then(function(r) {
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

  // El NEXO ID propio (se carga al arrancar); como mucho 20 s
  _whenLocalId() {
    var self = this;
    if (self.localNexoId) return Promise.resolve(self.localNexoId);
    return new Promise(function(resolve) {
      var n = 0;
      (function wait() { if (self.localNexoId || ++n > 400) resolve(self.localNexoId); else setTimeout(wait, 50); })();
    });
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
            // Ronda 2768 (seguridad): el primer trozo sin cifrar de un texto largo o un archivo que dice ser de un
            // contacto lo escribió otro (se descarta al juntarse): no apunta esta conexión como suya
            var plainChunk = (p0.t === 'c' || p0.t === 'f') && typeof p0.d === 'string' && !/^E[12]:/.test(p0.d) && self._isKnownSender(from0);
            if (!passing && !plainChunk && /^nx[0-9a-z]{8}$/i.test(from0)) self._kickPeer(deviceId, from0);
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
            var fragmentHandled = self.ackSystem.processIncomingFragment({ deviceId: deviceId, content: trimmedContent, ts: data.timestamp });
            if (fragmentHandled) return;
          }
          // Ronda 2766 (revisión): el ping y el pong siguen hasta su respuesta, más abajo. Este return los descartaba
          // desde siempre: ningún ping se contestaba y el vigilante cortaba cada ~30 s todo enlace parado (lo que el
          // dueño vio en la ronda 2760: el enlace se rehacía cada ~30 s y las fotos por Bluetooth no llegaban)
          if (!(protoCheck && (protoCheck.type === 'ping' || protoCheck.type === 'pong'))) return;
        }
        if (self.ackSystem) {
          var fragmentHandled = self.ackSystem.processIncomingFragment({ deviceId: deviceId, content: content, ts: data.timestamp });
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
            try { if (typeof window !== 'undefined' && window.nexoPerf) window.nexoPerf.record('rtt', rtt); } catch (e) {} // ronda 2808: rendimiento (pasivo)
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
        // Ronda 2768 (seguridad): un mensaje de un contacto que no llegó cifrado lo escribió otro (ver _prePayload): ni se
        // guarda, ni se muestra, ni cambia la dirección del contacto (antes la pasaba a la del intruso)
        if (!isControl && senderUUID && self._isKnownSender(senderUUID) && !(ctrl && ctrl.type === 'chat' && ctrl.payload && ctrl.payload.e2e === true)) {
          console.warn('[E2E] Mensaje sin cifrar atribuido a ' + _normId(senderUUID) + ': descartado');
          return;
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
        // Fase B (build 2969): PUNTERO a un archivo del buzón de relés (adjunto con payload 'ptr'): se baja, verifica y descifra
        // ANTES de guardar/mostrar/confirmar — el ✓✓ significa «el archivo YA está en este teléfono». Solo 1-a-1 (grupo/Jump: Fase C).
        if (!isControl && senderUUID && messageId && !data._blobResolved) {
          var ptrAtt = blobPointerIn(content, ctrl);
          if (ptrAtt) { self._blobPointerReceived(deviceId, senderUUID, messageId, ptrAtt, data, ackTo); return; }
          // Fase C (2971): puntero DENTRO de un sobre de GRUPO (foto/archivo al grupo subido UNA vez): el sobre se valida como
          // un mensaje de grupo normal (miembro, grupo conocido) y se baja; al completar se reinyecta el sobre con el adjunto entero
          // (el adjunto va como texto DENTRO del sobre: sus comillas llegan escapadas, por eso no se busca '"ptr"' literal)
          if (content.indexOf('"nexo_grp"') >= 0 && content.indexOf('ptr') >= 0) {
            var genvP = parseGroupEnvelope(content), gatt = genvP ? blobPointerIn(genvP.c) : null;
            if (gatt) {
              var grpP = (senderUUID && self.groups) ? self.groups.receive(genvP, senderUUID, messageId) : null;
              if (!grpP) { console.warn('[GROUP] Sobre de grupo con puntero descartado (de ' + senderUUID + ')'); return; }
              self._blobPointerReceived(deviceId, senderUUID, messageId, gatt, data, ackTo, genvP);
              return;
            }
          }
          // Fase D (2972): AVISO («cita») de un archivo > 5 MB que no cabe en el buzón de archivos: marcador en el chat, «ya estoy» al
          // emisor (+ toque FCM) y toque mutuo; el archivo llega por el flujo directo cuando coinciden
          var citaAtt = citaIn(content, ctrl);
          if (citaAtt) { self._citaReceived(deviceId, senderUUID, messageId, citaAtt, data, ackTo); return; }
          if (content.indexOf('"nexo_cita"') >= 0) {
            var citaSig = _chatKind(content);
            if (citaSig && citaSig.type === 'nexo_cita') { if (self.ackSystem) self.ackSystem.sendAck(deviceId, messageId, ackTo); self._onCitaReply(senderUUID, citaSig); return; }
          }
        }
        // P6 (dueño 01-11): este mensaje llegó ENTERO por este camino (internet/Jump/BLE corto). Si quedó un reensamblado
        // BLE a medias del mismo msgId (el emisor empezó por Bluetooth y acabó por otra vía), ciérralo: así no caduca a los
        // 120 s con un «Assembly timeout» ni un falso «fallo» de un mensaje que SÍ llegó.
        if (messageId && self.ackSystem && typeof self.ackSystem.dropAssembly === 'function') self.ackSystem.dropAssembly(messageId);
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
        // Ronda 2758: mensaje de grupo (sobre nexo_grp): va al chat del grupo; si no vale (no es miembro), fuera
        var grp = null, genv = !attachmentData ? parseGroupEnvelope(msgContent) : null;
        if (genv) {
          grp = senderUUID && self.groups ? self.groups.receive(genv, senderUUID, messageId) : null;
          if (!grp) { console.warn('[GROUP] Sobre de grupo descartado (de ' + senderUUID + ')'); return; }
          msgContent = grp.content;
          attachmentData = groupAttachment(msgContent); // foto, audio, archivo… dentro del sobre (fase 2)
        }
        // Ronda 2758: señal de una llamada de voz (no es un mensaje: ni se guarda ni se muestra)
        var csig = !grp && !attachmentData ? parseCallSignal(msgContent) : null;
        // Ronda 2768: solo señales que llegaron cifradas de extremo a extremo (una sin cifrar la puede escribir cualquiera)
        if (csig) {
          if (self.calls && senderUUID && ctrl && ctrl.payload && ctrl.payload.e2e === true) self.calls.onSignal(senderUUID, csig, messageId);
          else console.warn('[CALL] Señal sin cifrar descartada (de ' + senderUUID + ')');
          return;
        }
        // #128: señal de llamada de GRUPO (como la 1-a-1: solo si llegó cifrada E2E; ni se guarda ni se muestra)
        var gsig = !grp && !attachmentData ? parseGroupCallSignal(msgContent) : null;
        if (gsig) {
          if (self.gcall && senderUUID && ctrl && ctrl.payload && ctrl.payload.e2e === true) self.gcall.onSignal(senderUUID, gsig);
          else console.warn('[GCALL] Señal sin cifrar descartada (de ' + senderUUID + ')');
          return;
        }
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
          _vaultAppendMessage(grp ? grp.gid : senderUUID, vaultMsg, false);
          if (!grp) self._citaResolved(messageId); // Fase D: si era el archivo de una cita, el marcador se cumplió
        }
        // v6.14.0: el contador de no leídos lo lleva notify.js (todas las vías: texto largo, fotos, archivos…)
        var pv = _messagePreview(content, attachmentData && attachmentData.attachmentType);
        if (grp) { var gpv = _messagePreview(msgContent, attachmentData && attachmentData.attachmentType); if (gpv !== null && !isControl) self.groups.noteMessage(grp.gid, self.groups.memberName(senderUUID) + ': ' + gpv, data.timestamp || Date.now()); }
        else if (senderUUID && !isControl && pv !== null) self.noteContactMessage(senderUUID, pv, data.timestamp || Date.now());
        _safeDispatchEvent('nexo:ble:messageReceived', {
          groupId: grp ? grp.gid : undefined,
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

  _notePeerName(nexoId, nm) {
    var nx = _normId(nexoId), name = String(nm).replace(/[\u0000-\u001f<>]/g, '').trim().substring(0, 40);
    if (!name || _isGenericName(name)) return;
    var found = this.foundDevices && this.foundDevices.get(nx);
    if (found && _isGenericName(found.name)) { found.name = name; this.renderNewDeviceBar(); }
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
          self._waitIfCameraPaused().then(function() {
            self.sendChatMessage(deviceUUID, content, msgId, msgSeq).then(resolve).catch(reject);
          }).catch(reject);
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
        if (!isConnecting && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
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
          if (!self.net || !self.net.mailboxOk(nx)) return;              // sin internet/token: no se puede (el reintento Bluetooth sigue)
          console.log('[NET] red de seguridad de entrega: ' + msgId + ' sin confirmar por Bluetooth → buzón + toque FCM');
          self._sendViaNetMailbox(nx, content, msgId, seq).catch(function() {});
        } catch (e) {}
      }, DELIVERY_SAFETY_MS);
    } catch (e) {}
  },

  // Fase B/C: archivo a un contacto AUSENTE (ni Bluetooth listo, ni Wi-Fi, ni en línea por internet) teniendo yo internet →
  // BUZÓN DE ARCHIVOS (≤ 5 MB; no Jump): cifrado una vez en los relés + puntero E2E en su buzón. Fase C: si el adjunto trae un
  // puntero VIGENTE (meta.blobPtr: ya vive en los relés —reenvío de algo recibido o enviado por el buzón—) va POR REFERENCIA
  // también a un contacto EN LÍNEA solo por internet (0 subidas); con Bluetooth/Wi-Fi listos sigue el camino local directo.
  // Devuelve la promesa del envío (✓ al guardarse el puntero) o null si no aplica.
  _fileToBlobMailbox(nexoId, fileId, base64Data, meta) {
    var self = this, nx = _normId(nexoId), net = self.net;
    if (!nx || !net || !self.ackSystem || typeof self.ackSystem._sendFileViaBlobMailbox !== 'function') return null;
    if (self.lan && typeof self.lan.canReach === 'function' && self.lan.canReach(nx)) return null;
    if (typeof self._bleReadyFor === 'function' && self._bleReadyFor(nx)) return null;
    var byRef = pointerReusable(meta && meta.blobPtr);
    if (!byRef && (typeof net.canReach !== 'function' || net.canReach(nx))) return null;
    if (!net.mailboxOk(nx) || !blobMailboxEligible(base64Data, meta)) return null;
    return self.ackSystem._sendFileViaBlobMailbox(nx, fileId, base64Data, meta);
  },
  // ===== Fase B/C: llegó un PUNTERO a un archivo del buzón de relés (1-a-1 o dentro de un sobre de GRUPO) =====
  // Orden obligatorio: techos anti-DoS (validatePointer, sin reservar nada) → ¿ya tengo este blob? (dedup local por huella,
  // Fase C) → si no, bajar por id de los relés del puntero → verificar cada trozo por su id → armar → huella → descifrar (GCM)
  // → recién entonces guardar, mostrar, avisar y confirmar (✓✓), reinyectando el adjunto completo por el mismo camino que un
  // adjunto normal (mismo msgId, mismo sobre E2E; en grupo, el mismo sobre nexo_grp con el adjunto entero). El puntero se
  // guarda en el mensaje (meta.blobPtr): un reenvío va por referencia. Dedup: un puntero repetido solo re-confirma. Si la
  // bajada falla, reintento con freno (30 s → 2 m → 8 m → 30 m…) hasta que caduque; máximo BLOB_MAX_CONCURRENT bajadas a la vez.
  _blobPointerReceived(deviceId, senderUUID, messageId, att, data, ackTo, genv) {
    var self = this;
    if (self._receivedMessageIds.has(messageId)) { if (self.ackSystem) self.ackSystem.sendAck(deviceId, messageId, ackTo); return; }
    var why = validatePointer(att.ptr);
    if (why) { console.warn('[BLOB] Puntero de ' + senderUUID + ' rechazado (' + why + '): no se baja nada'); return; }
    if (!self._blobIn) self._blobIn = new Map();
    if (self._blobIn.has(messageId)) return; // ya bajando / en cola
    var job = { deviceId: deviceId, senderUUID: senderUUID, messageId: messageId, att: att, data: data, ackTo: ackTo, genv: genv || null, tries: 0, running: false, timer: null };
    self._blobIn.set(messageId, job);
    console.log('[BLOB] Puntero de ' + senderUUID + (genv ? ' (grupo ' + genv.g + ')' : '') + ' (' + att.attachmentType + ', ' + att.ptr.chunks.length + ' trozos, ' + Math.round(att.ptr.raw / 1024) + ' KB): bajo del buzón de archivos');
    self._blobRunQueue();
  },
  _blobSeenMap() { if (!this._blobSeen) this._blobSeen = loadBlobSeen(); return this._blobSeen; },
  // Fase C (dedup local por huella): ¿ya tengo este mismo blob (misma huella y misma llave) en algún chat? → su contenido, sin bajar
  _blobTryLocal(j) {
    var self = this, ptr = j.att.ptr, seen = self._blobSeenMap().get(ptr.hash);
    if (!seen || seen.k !== ptr.k || typeof window === 'undefined' || !window.vaultLoadMessages) return Promise.resolve(null);
    return window.vaultLoadMessages(seen.chat).then(function(list) {
      var m = (list || []).find(function(x) { return (x.messageId || x.msgId) === seen.msgId && x.attachmentType && !x.deleted; });
      if (!m) return null;
      if (m.attachmentPayload && typeof m.attachmentPayload === 'string' && m.attachmentPayload.length > 16) return m.attachmentPayload;
      return (m.attachmentRef && window.vaultLoadFile) ? window.vaultLoadFile(m.attachmentRef) : null;
    }).then(function(b64) { return (typeof b64 === 'string' && _blobB64Bytes(b64) === ptr.raw) ? b64 : null; }).catch(function() { return null; });
  },
  _blobComplete(j, b64, how) {
    var self = this;
    self._blobIn.delete(j.messageId);
    var meta = Object.assign({}, j.att.meta || {}); delete meta.ptr; meta.blobPtr = j.att.ptr; // Fase C: un reenvío va por referencia
    var full = { type: 'attachment', attachmentType: j.att.attachmentType, payload: b64, meta: meta };
    var chat = j.genv ? _normId(j.genv.g) : _normId(j.senderUUID);
    try { var seen = self._blobSeenMap(); seen.set(j.att.ptr.hash, { k: j.att.ptr.k, chat: chat, msgId: j.messageId, at: Date.now() }); saveBlobSeen(seen); } catch (e) {}
    var text = j.genv ? JSON.stringify(Object.assign({}, j.genv, { c: JSON.stringify(full) })) : JSON.stringify(full);
    var env = { v: 1, type: 'chat', from: j.senderUUID, msgId: j.messageId, ts: j.data.timestamp || Date.now(), payload: { text: text, e2e: true, senderNexoId: j.senderUUID } };
    if (!j.genv) env.payload.attachment = full;
    var wire = JSON.stringify(env);
    console.log('[BLOB] ' + j.messageId + ' ' + how + ' (' + Math.round(_blobB64Bytes(b64) / 1024) + ' KB): se guarda y se confirma');
    self._handlePayload(Object.assign({}, j.data, { content: wire, data: wire, reassembled: true, _blobResolved: true }));
    self._blobRunQueue();
  },
  _blobRunQueue() {
    var self = this;
    if (!self._blobIn) return;
    var running = 0;
    self._blobIn.forEach(function(j) { if (j.running) running++; });
    self._blobIn.forEach(function(j) {
      if (running >= BLOB_MAX_CONCURRENT || j.running || j.timer) return;
      running++; j.running = true; j.tries++;
      self._blobTryLocal(j).then(function(local) {
        if (local) return self._blobComplete(j, local, 'ya lo tenía (mismo archivo, no se baja nada)');
        return fetchBlob(self.net, j.att.ptr, { log: function(s) { console.log(s); } }).then(function(res) {
          self._blobComplete(j, res.b64, 'bajado y verificado (' + res.relays + ' relés, ' + res.bad + ' trozos malos descartados)');
        });
      }).catch(function(e) {
        j.running = false;
        var expMs = (j.att.ptr.expires || 0) * 1000;
        if (e && (e.code === 'BLOB_PTR' || e.code === 'BLOB_GCM' || e.code === 'BLOB_HASH')) { console.warn('[BLOB] ' + j.messageId + ' descartado: ' + e.message); self._blobIn.delete(j.messageId); self._blobRunQueue(); return; }
        if (Date.now() + 30000 > expMs) { console.warn('[BLOB] ' + j.messageId + ' caducó sin poder bajarse (' + (e && e.message) + ')'); self._blobIn.delete(j.messageId); self._blobRunQueue(); return; }
        var wait = _fetchRetryDelay(j.tries);
        console.warn('[BLOB] ' + j.messageId + ' no se pudo bajar (' + (e && e.message) + '): reintento en ' + Math.round(wait / 1000) + ' s');
        j.timer = setTimeout(function() { j.timer = null; self._blobRunQueue(); }, wait);
        self._blobRunQueue();
      });
    });
  },
  // ===== Fase D (2972): la «CITA» para archivos > 5 MB (no caben en el buzón de archivos) a un contacto AUSENTE =====
  // Emisor: deja en su buzón un aviso chiquito (nombre, tamaño, id) UNA vez por archivo; el archivo queda ⏳ y entra al toque FCM
  // por pendientes (Fase A). Receptor: marcador «esperando» en el chat, contesta «ya estoy» (+ toque FCM al emisor) y entra al
  // toque mutuo; cuando coinciden, el flujo directo de siempre lo entrega y el marcador se vuelve el archivo (mismo id).
  _citaOutMap() { if (!this._citaOut) this._citaOut = loadCitaOut(); return this._citaOut; },
  _citaInMap() { if (!this._citaIn) this._citaIn = loadCitaIn(); return this._citaIn; },
  _fileCita(nexoId, fileId, base64Data, meta) {
    var bytes = (typeof base64Data === 'string') ? Math.floor(base64Data.length * 3 / 4) : Number(base64Data) || 0;
    return this._fileCitaBytes(nexoId, fileId, bytes, meta);
  },
  _fileCitaBytes(nexoId, fileId, bytes, meta) {
    var self = this, nx = _normId(nexoId), net = self.net, type = (meta && meta.type) || 'file';
    if (!nx || !fileId || !net || !bytes || bytes <= BLOB_MAILBOX_MAX_BYTES) return false; // ≤ 5 MB: eso es el buzón de archivos
    if (meta && (meta.dst || meta.fwd || meta.big || meta.hdFor)) return false;
    if (type !== 'image' && type !== 'video' && type !== 'file') return false;
    if (typeof net.canReach !== 'function' || net.canReach(nx) || typeof net.mailboxOk !== 'function' || !net.mailboxOk(nx)) return false;
    if (self.lan && typeof self.lan.canReach === 'function' && self.lan.canReach(nx)) return false;
    if (typeof self._bleReadyFor === 'function' && self._bleReadyFor(nx)) return false;
    var out = self._citaOutMap(), prev = out.get(String(fileId));
    self._noteWakePending(nx); // el archivo grande pendiente entra al toque por pendientes (Fase A)
    if (prev && prev.cid === nx) return true; // ya avisado
    var metaWire = Object.assign({}, meta || {}); delete metaWire.to; delete metaWire.blobPtr; delete metaWire.thumb;
    var att = { type: 'attachment', attachmentType: type, payload: 'cita', meta: Object.assign({}, metaWire, { cita: 1, size: bytes }),
      cita: { v: 1, id: String(fileId), bytes: bytes, name: metaWire.name ? String(metaWire.name).substring(0, 200) : undefined, mime: metaWire.mime ? String(metaWire.mime).substring(0, 100) : undefined } };
    out.set(String(fileId), { cid: nx, at: Date.now(), bytes: bytes }); saveCitaOut(out);
    console.log('[CITA] ' + fileId + ' (' + Math.round(bytes / 1048576) + ' MB) a ' + nx + ' ausente: le dejo el aviso en su buzón; el archivo queda ⏳ hasta coincidir');
    if (self.ackSystem && typeof self.ackSystem._dispatchStatus === 'function') self.ackSystem._dispatchStatus(String(fileId), 'pending'); // ⏳ «esperando que se conecte» visible (contratos §7), nunca ✗
    self._sendViaNetMailbox(nx, JSON.stringify(att), String(fileId) + '_c').catch(function(e) { out.delete(String(fileId)); saveCitaOut(out); console.warn('[CITA] el aviso de ' + fileId + ' no salió: ' + (e && e.message)); });
    return true;
  },
  _fileCitaFromMsg(nexoId, m) {
    var t = m.attachmentType, mm = m.attachmentMeta || {}, p = m.attachmentPayload;
    var bytes = (typeof p === 'string' && p.length > 16) ? Math.floor(p.length * 3 / 4) : Number(mm.size) || 0;
    if (!t || mm.big) return false;
    return this._fileCitaBytes(nexoId, m.messageId || m.msgId || m.id, bytes, Object.assign({ type: t }, mm));
  },
  _citaReceived(deviceId, senderUUID, messageId, att, data, ackTo) {
    var self = this, why = validateCita(att.cita);
    if (self.ackSystem && messageId) self.ackSystem.sendAck(deviceId, messageId, ackTo);
    if (why) { console.warn('[CITA] aviso de ' + senderUUID + ' rechazado (' + why + ')'); return; }
    if (messageId && self._receivedMessageIds.has(messageId)) return;
    if (messageId) self._receivedMessageIds.add(messageId);
    var fileId = att.cita.id, nx = _normId(senderUUID), inMap = self._citaInMap();
    if (inMap.has(fileId)) { self._citaReply(nx, fileId); return; }
    inMap.set(fileId, { from: nx, bytes: att.cita.bytes, at: Date.now() }); saveCitaIn(inMap);
    var meta = Object.assign({}, att.meta || {}); delete meta.ptr;
    meta.cita = { bytes: att.cita.bytes, from: nx, at: Date.now(), realType: att.attachmentType };
    if (att.cita.name && !meta.name) meta.name = att.cita.name;
    if (att.cita.mime && !meta.mime) meta.mime = att.cita.mime;
    if (!meta.size) meta.size = att.cita.bytes;
    var marker = { type: 'attachment', attachmentType: 'file', payload: 'cita', meta: meta };
    var ts = data.timestamp || Date.now();
    var vaultMsg = { messageId: fileId, content: JSON.stringify(marker), _own: false, status: 'delivered', timestamp: ts, senderName: '', senderNexoId: nx, seq: 0,
      attachmentType: 'file', attachmentPayload: null, attachmentMeta: meta };
    console.log('[CITA] ' + nx + ' tiene un archivo de ' + Math.round(att.cita.bytes / 1048576) + ' MB para mí (' + fileId + '): marcador en el chat, le aviso que ya estoy y lo toco si hace falta');
    _vaultLoadMessages(nx).then(function(list) {
      var cur = (list || []).find(function(x) { return (x.messageId || x.msgId) === fileId; });
      if (cur && (cur.attachmentPayload || cur.attachmentRef)) { inMap.delete(fileId); saveCitaIn(inMap); return; } // ya lo tengo
      if (!cur) _vaultAppendMessage(nx, vaultMsg, false);
      self.noteContactMessage(nx, '📦 ' + (meta.name || 'archivo'), ts);
      _safeDispatchEvent('nexo:ble:messageReceived', { deviceId: deviceId, deviceUUID: nx, content: vaultMsg.content, messageId: fileId, senderName: '', senderNexoId: nx, seq: 0, timestamp: ts, attachmentType: 'file', attachmentPayload: null, attachmentMeta: meta });
    }).catch(function() {});
    self._noteWakePending(nx); // toque MUTUO (Fase A): si el que tiene el archivo duerme, lo despierto yo con freno creciente
    self._citaReply(nx, fileId);
  },
  _citaReply(nx, fileId) {
    var self = this;
    if (!self.net || typeof self.net.mailboxOk !== 'function' || !self.net.mailboxOk(nx)) return;
    var wire = JSON.stringify({ type: 'nexo_cita', id: String(fileId), ok: 1 });
    self._sendViaNetMailbox(nx, wire, 'cr' + String(fileId).replace(/[^A-Za-z0-9]/g, '').substring(0, 40) + Date.now().toString(36)).catch(function() {});
  },
  _onCitaReply(from, sig) {
    var self = this, nx = _normId(from);
    console.log('[CITA] ' + nx + ' ya está (espera ' + (sig && sig.id) + '): saludo y reenvío lo pendiente en cuanto lo vea en línea');
    try { if (self.net && typeof self.net.greet === 'function') self.net.greet(); } catch (e) {}
    setTimeout(function() { try { self._resendPendingMessages(nx); } catch (e) {} }, 2500);
    setTimeout(function() { try { self._resendPendingMessages(nx); } catch (e) {} }, 15000);
  },
  _citaResolved(fileId) {
    if (!fileId) return;
    var m = this._citaInMap();
    if (!m.has(fileId)) return;
    m.delete(fileId); saveCitaIn(m);
    console.log('[CITA] ' + fileId + ' llegó: marcador cumplido');
  },
  // ¿Sigo esperando un archivo grande de este contacto? (mantiene el toque mutuo de la Fase A)
  _citaPendingFrom(nx) {
    var m = this._citaInMap(), any = false; nx = _normId(nx);
    m.forEach(function(v) { if (v && _normId(v.from) === nx) any = true; });
    return any;
  },
  // Volvió internet / un relé: reintentar ya lo que esperaba su turno
  _blobRetryNow() {
    var self = this;
    if (!self._blobIn || !self._blobIn.size) return;
    self._blobIn.forEach(function(j) { if (j.timer) { clearTimeout(j.timer); j.timer = null; } });
    self._blobRunQueue();
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
          // Último intento: active chat (ronda 2766: no si esa dirección consta como de otro contacto)
          if (self._activeChatDeviceId === uuid && self._activeChatDeviceIdNative && !self._macOfOther(self._activeChatDeviceIdNative, uuid)) {
            deviceId = self._activeChatDeviceIdNative;
          }
        }
        if (!deviceId && self.relay && self.relay.relayHop(uuid)) deviceId = uuid;
        if (!deviceId) {
          // Fase B (build 2969): contacto AUSENTE por todos los caminos pero con internet propio → BUZÓN DE ARCHIVOS (≤ 5 MB):
          // el archivo llega aunque los dos nunca coincidan en línea. Antes: PEER_ABSENT → ⏳ hasta coincidir.
          var viaBlob0 = self._fileToBlobMailbox(uuid, fileId, base64Data, meta);
          if (viaBlob0) { viaBlob0.then(resolve, reject); return; }
          self._fileCita(uuid, fileId, base64Data, meta); // Fase D (2972): > 5 MB a un ausente → aviso chiquito en su buzón (el archivo queda ⏳)
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
          // Ronda 2766: a quién va (se cifra para él y solo sale por una conexión suya)
          var m2 = (meta && meta.dst) ? meta : Object.assign({}, meta || {}, { to: uuid });
          self.ackSystem.sendFile(deviceId, fileId, base64Data, m2)
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
            var dev = self._resolveDeviceIdForNexoId(uuid) || (self._macOfOther(deviceId, uuid) ? null : deviceId);
            // Fase C (2971): el adjunto ya vive en los relés (puntero vigente: reenvío de algo recibido/enviado por el buzón) y el
            // contacto está solo por internet → va POR REFERENCIA (0 subidas) aunque esté en línea; con Bluetooth/Wi-Fi, directo
            if (_netNx(dev) && meta && meta.blobPtr) { var viaRef = self._fileToBlobMailbox(uuid, fileId, base64Data, meta); if (viaRef) { viaRef.then(resolve, reject); return; } }
            // Ronda 2780 (pedido del dueño): fotos y archivos medianos SIEMPRE se pueden mandar por internet. Si el otro
            // está en línea van por Tor directo/Wi-Fi (filesOk); si no, al buzón de los relés (mailboxOk) y llegan cuando
            // abre, igual que los textos. Bajo un tope (~6 MB de archivo): los más grandes son la fase 2 (Tor). Antes solo
            // salían con los dos en Wi-Fi; por eso una foto a un contacto lejano/desconectado no llegaba.
            var netMediaOk = self.net && (self.net.filesOk(uuid) || (self.net.mailboxOk(uuid) && base64Data.length <= NET_MAX_B64_BYTES));
            var netNo = !!_netNx(dev) && !netMediaOk;
            if (netNo) dev = self._bleReadyFor(uuid) || dev;
            var st = self._getDeviceState(dev);
            if ((!netNo || !_netNx(dev)) && (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY)) {
              deviceId = dev;
              startTransfer();
              return;
            }
            // v6.3.0 Jump: por otro teléfono si hay ruta
            var rh = self.relay && self.relay.relayHop(uuid, { files: true });
            // Fase C (2971): un puente por INTERNET (2 saltos cargando a otro teléfono, con su dato) no le gana al buzón de archivos
            // (una copia en los relés + toque FCM) si el archivo puede ir por ahí; con puntero vigente va por referencia (0 bytes).
            // Un puente por Bluetooth (local, gratis) sí va primero.
            if (rh && _netNx(rh.deviceId)) { var viaBlobJ = self._fileToBlobMailbox(uuid, fileId, base64Data, meta); if (viaBlobJ) { viaBlobJ.then(resolve, reject); return; } }
            if (rh) {
              deviceId = rh.deviceId;
              meta = Object.assign({}, meta || {}, { dst: uuid });
              console.log('[JUMP] Adjunto ' + fileId + ' a ' + uuid + ' por ' + rh.via);
              self._noteRelayedOut(fileId, uuid);
              self.relay.plan(uuid, (meta && meta.type) || 'file', base64Data.length);
              startTransfer();
              return;
            }
            // Fase B (build 2969): sin enlace listo ni ruta Jump, nada conectándose y el contacto AUSENTE por internet → al
            // BUZÓN DE ARCHIVOS ya (no se esperan los 8 s: no hay nada que esperar). Si algo se está conectando, se le da
            // el plazo; al vencer, también va al buzón de archivos antes que quedar ⏳.
            var busy = st.state === BLE_STATES.CONNECTING || st.state === BLE_STATES.DISCOVERING_SERVICES;
            if (!busy || Date.now() >= deadline) {
              var viaBlob = self._fileToBlobMailbox(uuid, fileId, base64Data, meta);
              if (viaBlob) { viaBlob.then(resolve, reject); return; }
              self._fileCita(uuid, fileId, base64Data, meta); // Fase D (2972): > 5 MB → aviso chiquito (una vez); el archivo queda ⏳
            }
            if (!nudged) {
              nudged = true;
              console.log('[BLEInterface] sendFile: contacto no listo (' + (st.state || '?') + '), buscando…');
              self._markPeerLost(uuid);
              if (dev && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice') && st.state !== BLE_STATES.CONNECTING) {
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
    // Ronda 2767 (revisión): una sola vuelta a la vez por contacto. Al reconectar se pedía 4–6 veces seguidas (enlace
    // listo, clave, chat abierto…) y cada vuelta mandaba su lista sin mirar las demás: un texto largo salía varias veces
    // a la vez. Si ya hay una en marcha (con avances en los últimos 30 s), se repite al acabar
    var nxKey = _normId(nexoId);
    self._resendRun = self._resendRun || new Map();
    var cur = self._resendRun.get(nxKey);
    if (cur && Date.now() - cur.at < 30000) { cur.again = true; return; }
    var run = { at: Date.now(), again: false };
    self._resendRun.set(nxKey, run);
    var finish = function() {
      if (self._resendRun.get(nxKey) !== run) return;
      self._resendRun.delete(nxKey);
      if (run.again) setTimeout(function() { self._resendPendingMessages(nexoId); }, 300);
    };
    var idOf = function(m) { return m.msgId || m.messageId || m.id; };
    // Fase B (2969): ¿adjunto que puede ir al buzón de archivos? (foto/vídeo/archivo con sus datos; no el «archivo grande» de Wi-Fi)
    // Vale ANTES de cargar el adjunto del disco (2970, diagnóstico del dueño: un APK de 25 MB pendiente se leía del disco en cada
    // vuelta —«leyendo lento» ×decenas— para después descartarse por tamaño): foto/vídeo/archivo, con datos (en línea o en
    // disco: attachmentRef), no «archivo grande» de Wi-Fi, y tamaño declarado dentro del tope del buzón (si no se conoce, se mira al cargar).
    var blobCandidate = function(m) {
      var t = m.attachmentType, p = m.attachmentPayload, mm = m.attachmentMeta, ref = m.attachmentRef;
      if ((!t || !p) && !ref && m.content && typeof m.content === 'string' && m.content.charAt(0) === '{') {
        try { var pr = JSON.parse(m.content); if (pr && pr.type === 'attachment') { t = pr.attachmentType; p = pr.payload; mm = pr.meta; } } catch (e) {}
      }
      if (!(t && (p || ref) && !(mm && mm.big) && (t === 'image' || t === 'video' || t === 'file'))) return false;
      var size = (p && typeof p === 'string') ? p.length : (mm && Number(mm.size)) || 0;
      return !size || size <= BLOB_MAILBOX_MAX_BYTES * 4 / 3 + 8;
    };
    var getPending = (window.vaultGetPendingMessages && typeof window.vaultGetPendingMessages === 'function')
      ? window.vaultGetPendingMessages(nexoId)
      : _vaultLoadMessages(nexoId).then(function(msgs) {
          return msgs.filter(_isResendable);
        });
    // No reenviar lo que sigue en vuelo en esta sesión (cola JS, ACK pendiente o stream activo); se mira antes de cargar
    // los adjuntos de disco (antes se cargaban todos en cada vuelta)
    // El camino se decide ANTES de cargar los adjuntos del disco (2970): si no hay enlace ni ruta, solo se cargan los que
    // pueden ir al buzón de archivos; lo demás queda en espera sin leer megas del disco en cada vuelta.
    var deviceId = self._resolveDeviceIdForNexoId(nexoId);
    var st = deviceId ? self._getDeviceState(deviceId) : {};
    var direct = st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY;
    var rh = direct ? null : (self.relay && self.relay.relayHop(nexoId));
    var blobOnly = false;
    getPending = getPending.then(function(list) {
      list = (list || []).filter(function(m) { return !self._isMsgInFlight(idOf(m)); });
      if (!direct && !rh) {
        // Fase B (build 2969): sin enlace ni ruta pero CON internet propio y el contacto AUSENTE → los ARCHIVOS pendientes
        // (foto/vídeo/archivo ≤ 5 MB) van al BUZÓN DE ARCHIVOS (cifrados en los relés + puntero en su buzón); el resto sigue
        // en espera (toque FCM, Fase A). Antes TODO quedaba ⏳ hasta coincidir en línea.
        blobOnly = !!(self.net && typeof self.net.mailboxOk === 'function' && self.net.mailboxOk(nexoId) && !self.net.canReach(nexoId) && list.some(blobCandidate));
        if (blobOnly) list = list.filter(blobCandidate);
        else if (list.length) { console.log('[BLEInterface] ' + list.length + ' pending para ' + nexoId + ': sin enlace ni ruta, quedan en espera'); self._noteWakePending(nexoId); if (self.relay) self.relay.discover(nexoId); list.forEach(function(m) { try { self._fileCitaFromMsg(nexoId, m); } catch (e) {} }); return []; }
      }
      return _hydrateAttachments(list);
    });
    getPending.then(function(pending) {
      pending = pending || [];
      if (pending.length === 0) { finish(); return; }
      var relayDst = null;
      if (!direct) {
        if (!rh) {
          console.log('[BLEInterface] ' + pending.length + ' archivo(s) pendiente(s) para ' + nexoId + ': sin enlace ni ruta, van al buzón de archivos');
          self._noteWakePending(nexoId); // Build 2967 (Fase A): lo que queda en espera entra al wake-por-pendiente (toque FCM con backoff)
          if (self.relay) self.relay.discover(nexoId);
        } else {
          deviceId = rh.deviceId;
          relayDst = _normId(nexoId);
          console.log('[JUMP] Reenviando', pending.length, 'pending para', nexoId, 'por', rh.via);
          pending.forEach(function(m) { self._noteRelayedOut(m.msgId || m.messageId || m.id, relayDst); });
        }
      } else {
        console.log('[BLEInterface] Reenviando', pending.length, 'pending para', nexoId);
        if (self.ackSystem && typeof self.ackSystem.resumeOutgoingTransfers === 'function') {
          try { self.ackSystem.resumeOutgoingTransfers(deviceId); } catch (e) {}
        }
      }
      var idx = 0;
      function sendNext() {
        run.at = Date.now();
        if (idx >= pending.length) { finish(); return; }
        var msg = pending[idx++];
        var mid = idOf(msg);
        // Ronda 2767: se vuelve a mirar justo antes de mandarlo (otra vuelta o un envío nuevo pudo mandarlo ya)
        if (!mid || self._isMsgInFlight(mid) || (self.ackSystem && typeof self.ackSystem.isDone === 'function' && self.ackSystem.isDone(mid))) {
          sendNext();
          return;
        }
        if (blobOnly && !blobCandidate(msg)) { sendNext(); return; } // Fase B: sin enlace solo salen los archivos (al buzón de archivos)
        _vaultUpdateMessageStatus(nexoId, mid, 'sending');
        try {
          if (window.NEXO_updateMessageStatus) {
            window.NEXO_updateMessageStatus(mid, 'sending');
          }
        } catch (e) {}

        var attachmentType = msg.attachmentType || null;
        var attachmentPayload = msg.attachmentPayload || null;
        var attachmentMeta = msg.attachmentMeta || null;

        if ((!attachmentType || !attachmentPayload) && msg.content && typeof msg.content === 'string' && msg.content.charAt(0) === '{') {
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
          // Ronda 2767: directo, a quién va (como al enviarlo: se cifra para él y solo sale por una conexión suya)
          var fileMeta = Object.assign(
            { type: attachmentType },
            attachmentMeta || {},
            relayDst ? { dst: relayDst } : { to: nxKey }
          );
          doSend = blobOnly
            ? function() { // Fase B (2969): al buzón de archivos (si justo dejó de aplicar, queda pendiente)
              return self._fileToBlobMailbox(nxKey, mid, attachmentPayload, fileMeta) ||
                Promise.reject(Object.assign(new Error('Contacto no disponible: queda pendiente'), { code: 'PEER_ABSENT' }));
            }
            : function() {
              return self.ackSystem.sendFile(
                deviceId,
                mid,
                attachmentPayload,
                fileMeta
              );
            };
          console.log('[BLEInterface] Reenviando ADJUNTO' + (blobOnly ? ' al buzón de archivos' : '') + ':', attachmentType, mid);
        } else {
          var txt;
          if (bigMeta) txt = JSON.stringify({ type: 'attachment', attachmentType: 'file', payload: 'big', meta: attachmentMeta });
          // Ronda 2767 (revisión): nota de voz, ubicación… van como texto con el adjunto dentro, como al enviarlos. El
          // historial guarda el adjunto aparte y el texto como "[adjunto]": antes llegaba ese texto, no la nota de voz
          else if (attachmentType && attachmentPayload) txt = JSON.stringify({ type: 'attachment', attachmentType: attachmentType, payload: attachmentPayload, meta: attachmentMeta || {} });
          else if (attachmentType) {
            console.warn('[BLEInterface] Adjunto pendiente sin sus datos (no se pudo leer del teléfono): no se reenvía', mid);
            _vaultUpdateMessageStatus(nexoId, mid, 'failed');
            try { if (window.NEXO_updateMessageStatus) window.NEXO_updateMessageStatus(mid, 'failed'); } catch (e3) {}
            sendNext();
            return;
          }
          else txt = msg.content || msg.text || '';
          if (
            txt.length > 180 &&
            self.ackSystem &&
            typeof self.ackSystem.sendChunkedMessage === 'function'
          ) {
            doSend = function() {
              return self.ackSystem.sendChunkedMessage(
                deviceId,
                txt,
                relayDst ? { dst: relayDst } : { to: nxKey },
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
                relayDst ? { dst: relayDst } : { to: nxKey }
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
