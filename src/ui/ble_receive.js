import { _hasNativeMethod, _normId, _isBLEContact, _isProtocolShaped, SUPERVISOR_STATES, _normMac, _getContactByDeviceId, _getContactByUUID, _addBLEContact, _getBLEContacts, _saveBLEContacts, _vaultGetOrCreateContact, _chatKind, _vaultAppendMessage, _messagePreview, _safeDispatchEvent } from './ble_helpers.js';
import { e2eOpenAnon } from '../vault/e2e_crypto.js';
import { diagNotePeerBuild } from './diag_state.js';
import { e2eAnyEncrypted, e2eOpenText, e2eOuterAd } from '../vault/e2e_proto.js';
import { blobPointerIn, citaIn } from '../net/blob_mailbox.js';
import { parseGroupEnvelope, groupAttachment } from './groups.js';
import { parseCallSignal } from './calls.js';
import { parseGroupCallSignal } from './group_call.js';
import { vaultEarlyTombstoned } from '../vault/vault_early_acts.js';
// 3069: ¿texto cifrado del protocolo 2 en una sesión ya hecha? (cabecera de 3 campos: no es un primer mensaje X3DH)
function _e2Established(packed) {
  if (typeof packed !== 'string' || packed.indexOf('E2:') !== 0) return false;
  var hs = packed.substring(3).split(':')[0];
  return hs.split('.').length === 3;
}

// Métodos de BLE_MESSAGE_METHODS: RECEPCIÓN: lo que entrega el nativo (paquetes, textos, señales) y su reparto.
// Reestructuración 15-11: movidos TAL CUAL desde ble_messages.js, que los une en BLE_MESSAGE_METHODS.
export const BLE_RECEIVE_METHODS = {

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
    if (/"type":"w[qanfx]"/.test(raw) && self.wifiDirect) {
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
        if (self.calls2) self.calls2.onFrame(pv0, data.deviceId); // #220: la segunda llamada (cada una solo acepta los suyos, por id)
        return Promise.resolve(null);
      }
    }
    // Archivos grandes (ronda 2756, big_file.js): control de una transferencia
    if (/"type":"g[qanfr]"/.test(raw) && self.bigFiles) {
      var pg = null;
      try { pg = JSON.parse(raw); } catch (e) {}
      if (pg && self.bigFiles.handle(pg, data.deviceId)) return Promise.resolve(null);
    }
    // Dueño 13-11: puente a internet por un NEXO cercano (gw_link.js): lo de un teléfono sin internet o del que le presta el suyo
    if (raw.indexOf('"type":"ig"') >= 0 && self.net && self.net.gw) {
      var pgw = null;
      try { pgw = JSON.parse(raw); } catch (e) {}
      if (pgw && pgw.type === 'ig' && self.net.gw.handle(pgw, data.deviceId)) return Promise.resolve(null);
    }
    // Fénix: pingeo, borrado y petición de recuperación (directos, sin 'to'); 3148: registro de sucesión y veto ('fs'/'fv', ocultos)
    if (/"type":"f[poqdsv]"/.test(raw) && self.fenix) {
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
    if (!jump && raw.indexOf('"type":"kx"') < 0 && raw.indexOf('"type":"nq"') < 0 && raw.indexOf('E1:') < 0 && raw.indexOf('E2:') < 0) return Promise.resolve(data);
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
        if (p.from && p.bd) diagNotePeerBuild(p.from, p.bd); // 3020: su build, para el diagnóstico
        if (p.from) self._pqHave.set(_normId(p.from), Number(p.ph) || 0);
        if (p.rq) self._sendKxRouted(p.from, false);
        return Promise.resolve(null);
      }
      if (p.from && p.pk) self._noteSenderKey(p.from, p.pk);
      if (p.from && p.pk && self.fenix && self.fenix.ent) self.fenix.ent.onKx(p.from, p.pk, data.deviceId); // 3148: llave vieja tras una sucesión
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
      // 3012: quién dijo ser (aunque «Agregar» esté cerrado ahora: al abrirlo sale sin esperar otro kx)
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '') && !_isBLEContact(p.from) && typeof self._noteKxPeer === 'function') self._noteKxPeer(data.deviceId, p);
      // Ronda 2764: con "Agregar" abierto, un NEXO cercano que no es contacto (se identificó con su kx) sale en la lista
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '') && !_isBLEContact(p.from) && Date.now() < (self._visibleUntil || 0) && !/^(lan|net)/i.test(String(data.deviceId)))
        self.onDeviceFound({ id: data.deviceId, name: typeof p.nm === 'string' ? p.nm.substring(0, 40) : '', rssi: -60, nexoId: String(p.from).toUpperCase(), kx: true }); // 3184: kx = dijo quién es (se dibuja al momento)
      if (p.from && p.rs) self._noteRestored(p.from, p.pk, p.rs);
      if (p.fx && p.from) self._noteFenixPeer(p.from, data.deviceId, Number(p.fx) || 1);
      if (p.ss && p.from) self._noteSealPeer(p.from);
      if (p.nt && p.from) self._noteNetPeer(p.from);
      if (p.from && p.bd) diagNotePeerBuild(p.from, p.bd); // 3020: su build, para el diagnóstico
      if (self.ackSystem) self.ackSystem.markBin(data.deviceId, !p.bf); // ronda 2753: trozos binarios (una build anterior no los entiende)
      // (3012: un kx «ligero» —lt— o contestado por el nativo con la app dormida —nk— no dice nada de lo poscuántico: no se toca)
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '') && !p.lt && !p.nk) self._pqHave.set(_normId(p.from), Number(p.ph) || 0);
      // v6.11.1: ¿este vecino reenvía sobres 'sx' bien? (las builds anteriores los envolvían como texto suyo)
      if (/^nx[0-9a-z]{8}$/i.test(p.from || '')) { if (p.ss) self._sxHops.add(_normId(p.from)); else self._sxHops.delete(_normId(p.from)); }
      if (p.wd && self.wifiDirect) self.wifiDirect.markPeer(p.from);
      else if (self.wifiDirect) self.wifiDirect.unmarkPeer(p.from); // ya no lo anuncia (p.ej. sin permiso)
      if (self.bigFiles) { if (p.bg) self.bigFiles.markPeer(p.from); else self.bigFiles.unmarkPeer(p.from); self.bigFiles.markL2(p.from, !!p.l2); } // archivos grandes (2756; L2CAP 2758)
      // Responder con el nuestro (cada lado sabe así que el otro entiende Jump; máx. 1 cada 15 s)
      // (3012: a «solo dime quién eres» —id— se contesta ligero; el completo va al agregar o al escribirse)
      // y a una RESPUESTA ligera (lt) o del nativo con la app dormida (nk) no se le contesta nada: ya se sabe lo que hacía falta
      if (p.rq || (p.j && !p.lt && !p.nk)) self._sendKx(data.deviceId, false, !!p.rq, !!(p.rq && p.id));
      return Promise.resolve(null);
    }
    // 3207: solicitud de contacto de cerca (o su respuesta): solo por un enlace directo, nunca de paso por otro teléfono
    if (p && p.type === 'nq') { if (!viaRelay && typeof self._onNearReq === 'function') self._onNearReq(data.deviceId, p); return Promise.resolve(null); }
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
        // 3069: desatasco (resync.js): se apunta para pedírselo otra vez; si era de una sesión ya hecha, puede ser un atasco
        if (typeof window.NEXO_resyncNote === 'function' && e && (e.code === 'DESYNC' || (e.code === 'BAD' && _e2Established(p.payload.text)))) window.NEXO_resyncNote(sender, p.msgId, e.code);
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

  // Fase B/C (2969/2971), 3177: ¿es un PUNTERO a un archivo del buzón de relés (adjunto con payload 'ptr', 1-a-1 o DENTRO de un sobre de
  // GRUPO)? Entonces se baja, verifica y descifra ANTES de guardar/mostrar/confirmar (_blobPointerReceived) y devuelve true. Una sola
  // función para los dos caminos por los que llega un mensaje: los cortos (_handlePayload) y los textos largos por trozos
  // (ble_ack_resume._dispatchChunkedMessageComplete). 3177 (prueba de ciudad 17-11): el sobre de grupo con puntero es largo (~700 letras)
  // y por Bluetooth llega por trozos; ese camino no miraba el puntero y guardaba la foto rota (contenido 'ptr', 2 bytes) sin bajarla.
  // En el grupo el sobre se valida como un mensaje de grupo normal (miembro, grupo conocido); al completar se reinyecta el sobre con el
  // adjunto entero (el adjunto va como texto DENTRO del sobre: sus comillas llegan escapadas, por eso no se busca '"ptr"' literal).
  _routeBlobPointer(deviceId, senderUUID, messageId, content, ctrl, data, ackTo) {
    var self = this;
    if (!senderUUID || !messageId || typeof content !== 'string' || (data && data._blobResolved)) return false;
    var ptrAtt = blobPointerIn(content, ctrl);
    if (ptrAtt) { self._blobPointerReceived(deviceId, senderUUID, messageId, ptrAtt, data, ackTo); return true; }
    if (content.indexOf('"nexo_grp"') >= 0 && content.indexOf('ptr') >= 0) {
      var genvP = parseGroupEnvelope(content), gatt = genvP ? blobPointerIn(genvP.c) : null;
      if (gatt) {
        var grpP = self.groups ? self.groups.receive(genvP, senderUUID, messageId) : null;
        if (!grpP) { console.warn('[GROUP] Sobre de grupo con puntero descartado (de ' + senderUUID + ')'); return true; }
        self._blobPointerReceived(deviceId, senderUUID, messageId, gatt, data, ackTo, genvP);
        return true;
      }
    }
    return false;
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
            if (typeof self._applyNtNow === 'function') self._applyNtNow(senderUUID); // 3020: su «tengo internet» se guarda ya
            self.renderContactsList(); self.renderOnlineStrip();
            if (typeof self._offerReinstallMerge === 'function') self._offerReinstallMerge(senderUUID); // 3018: ¿mismo teléfono reinstalado?
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
          if (self._routeBlobPointer(deviceId, senderUUID, messageId, content, ctrl, data, ackTo)) return;
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
        // 3075: el ✓✓ de un adjunto que llegó por el buzón de archivos dice «ya lo bajé» (got): solo así el otro borra sus trozos
        var ackExtra = data && data._blobResolved ? { got: 1 } : null;
        if (messageId && self._receivedMessageIds.has(messageId)) {
          if (!isControl && self.ackSystem) self.ackSystem.sendAck(deviceId, messageId, ackTo, ackExtra);
          return;
        }
        if (messageId) {
          self._receivedMessageIds.add(messageId);
          if (!isControl) self._noteSeen(messageId);   // 3008: el nativo ya no avisa de un reenvío de este mensaje con la app cerrada
          if (self._receivedMessageIds.size > self._maxMessageIds) {
            var first = self._receivedMessageIds.values().next().value;
            self._receivedMessageIds.delete(first);
          }
          if (!isControl && self.ackSystem) self.ackSystem.sendAck(deviceId, messageId, ackTo, ackExtra);
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
          if (self.calls && senderUUID && ctrl && ctrl.payload && ctrl.payload.e2e === true) self._callSignal(senderUUID, csig, messageId);
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
        if (chatAct && (chatAct.type === 'nexo_act' || chatAct.type === 'nexo_diag')) isControl = true; // 2974: el diagnóstico automático es de protocolo (lo guarda autodiag.js, no el chat)
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
        else if (senderUUID && !isControl && pv !== null && !vaultEarlyTombstoned(senderUUID, messageId)) self.noteContactMessage(senderUUID, pv, data.timestamp || Date.now(), messageId); // 3183: con su id (un reenvío no lo sube); 3175: lo eliminado para todos antes de llegar no pone su texto en la lista
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
};
