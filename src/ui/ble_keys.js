/**
 * NEXO — Claves y seguridad (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752, sin cambios):
 * intercambio de claves (kx), clave de cada contacto y cambio de clave (retener/aceptar/rechazar), remitente sellado
 * para Jump, poscuántico, Fénix y verificación.
 */
import { e2eMyPublicKey, e2eOpenAnon, e2eSealAnon, initE2E } from '../vault/e2e_crypto.js';
import { e2eAllowsE1 } from '../vault/e2e_proto.js';
import { ratchetForget, ratchetMyBundle, ratchetMyPqId, ratchetNotePeerBundle, ratchetPeerPqId, ratchetResetPeer } from '../vault/e2e_ratchet.js';
import { _getBLEContacts, _normId, _normMac, _safeDispatchEvent, _saveBLEContacts, _vNx, _vaultLoadMessages } from './ble_helpers.js';


export const BLE_KEY_METHODS = {
  _sendKx(deviceId, request, force) {
    var self = this;
    if (!deviceId) return;
    var key = _normMac(deviceId) + (request ? ':rq' : '');
    var now = Date.now();
    if (!force && now - ((self._kxSentAt && self._kxSentAt[key]) || 0) < 15000) return;
    self._kxSentAt = self._kxSentAt || {};
    self._kxSentAt[key] = now;
    var peerNx = _normId(self._macToNexoId.get(_normMac(deviceId)) || _vNx(deviceId) || '');
    initE2E().then(function() { return ratchetMyBundle(self._pqNeeded(peerNx)).catch(function() { return null; }); }).then(function(b2) {
      var pk = e2eMyPublicKey();
      if (!pk || !self.localNexoId) return;
      // j:1 = entiende Jump (rutas): solo a quien lo diga se le mandan 'rt' (una build anterior los
      // mostraría como mensajes de texto). b2: paquete de claves del protocolo 2.
      var pkt = { v: 1, type: 'kx', from: self.localNexoId, pk: pk, j: 1 };
      if (b2) pkt.b2 = b2;
      pkt.fx = 3; // Fénix: 1 = la cuenta; 2 = también los mensajes (segmentos); 3 = también fotos y archivos (2757)
      pkt.ss = 1; // entiende el remitente sellado (sobres 'sx' por Jump)
      pkt.nt = 1; // v6.13.0: internet por relés públicos
      pkt.bf = 1; // ronda 2753: entiende trozos binarios de archivos por Bluetooth
      pkt.bg = 1; // ronda 2756: archivos grandes por Wi-Fi / Wi-Fi Direct (big_file.js)
      if (self.bigFiles && self.bigFiles.l2Ok) pkt.l2 = 1; // ronda 2758: y por Bluetooth L2CAP (Android 10+)
      if (peerNx) pkt.ph = ratchetPeerPqId(peerNx); // v6.12.0: qué clave poscuántica suya tengo (no hace falta repetirla)
      var rs = self.fenix ? self.fenix.resetMark() : 0;
      if (rs) pkt.rs = rs;
      if (self.wifiDirect && self.wifiDirect.supported()) pkt.wd = 1;
      if (request) pkt.rq = 1;
      return self._sendMessageNative(deviceId, JSON.stringify(pkt), null);
    }).catch(function() {});
  },

  _contactKey(nexoId) {
    var nx = _normId(nexoId);
    var c = _getBLEContacts().find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    return (c && c.publicKey) || null;
  },

  _noteSenderKey(nexoId, pk) {
    var nx = _normId(nexoId);
    if (!nx || !pk || !/^nx[0-9a-z]{8}$/.test(nx)) return true;
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c || c.publicKey === pk) return true;
    if (!c.publicKey) {
      c.publicKey = pk;
      console.log('[E2E] Clave de ' + nx + ' guardada');
      _saveBLEContacts(contacts);
      _safeDispatchEvent('nexo:e2e:key', { nexoId: nx, changed: false });
      return true;
    }
    if (c.pendingKey !== pk) {
      c.pendingKey = pk;
      c.keyChangedAt = Date.now();
      console.warn('[E2E] La clave de ' + nx + ' cambió: pendiente de aceptar (no se muestra ni se le envía nada)');
      _saveBLEContacts(contacts);
      _safeDispatchEvent('nexo:e2e:key', { nexoId: nx, changed: true });
    }
    return false;
  },

  _checkSender(nexoId, key, proto) {
    var nx = _normId(nexoId);
    var c = _getBLEContacts().find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (proto !== 2 && !e2eAllowsE1(c)) { console.warn('[E2E] Mensaje de ' + nx + ' con protocolo 1 descartado (ya usa el 2)'); return 'drop'; }
    if (this._noteSenderKey(nx, key) === false) return 'hold';
    if (proto === 2) this._markProto2(nx, key);
    return 'ok';
  },

  _noteSealPeer(nexoId) {
    var nx = _normId(nexoId);
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (c && !c.ss) { c.ss = 1; _saveBLEContacts(contacts); }
  },

  _pqNeeded(nexoId) {
    var nx = _normId(nexoId);
    return !nx || !this._pqHave.has(nx) || this._pqHave.get(nx) !== ratchetMyPqId();
  },

  hopSeals(deviceId) {
    var nx = _vNx(deviceId) || this._macToNexoId.get(_normMac(deviceId));
    return !!nx && this._sxHops.has(_normId(nx));
  },

  _sealKeyFor(nexoId) {
    var nx = _normId(nexoId);
    var c = _getBLEContacts().find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    return (c && c.ss && c.publicKey && !c.pendingKey) ? c.publicKey : null;
  },

  _sealString(nexoId, json, msgId) {
    var nx = _normId(nexoId), key = this._sealKeyFor(nx);
    if (!key) return Promise.resolve(json);
    var id = msgId || ('sx' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6));
    return e2eSealAnon(key, json).then(function(c) { return JSON.stringify({ v: 1, type: 'sx', to: nx, msgId: id, c: c }); });
  },

  _sealObj(nexoId, obj) {
    var hop = this.relay && typeof this.relay.nextHop === 'function' ? this.relay.nextHop(nexoId) : null;
    if (!hop || hop.direct || !this.hopSeals(hop.deviceId)) return Promise.resolve(obj);
    return this._sealString(nexoId, JSON.stringify(obj), null).then(function(s) { return JSON.parse(s); });
  },

  sealedFrom(nexoId, f, fr) {
    var key = this._sealKeyFor(nexoId);
    if (!key) return Promise.resolve(null);
    return e2eSealAnon(key, JSON.stringify({ f: f || '', fr: fr || '' })).then(function(c) { return 'sx:' + c; });
  },

  openSealedFrom(sealed) {
    return e2eOpenAnon(String(sealed).substring(3)).then(function(t) { var o = JSON.parse(t); return { f: String(o.f || ''), fr: _normId(o.fr) }; });
  },

  _noteFenixPeer(nexoId, deviceId, level) {
    var nx = _normId(nexoId), lvl = Math.max(1, Math.min(9, Number(level) || 1));
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (c && (c.fx || 0) !== lvl) { c.fx = lvl; _saveBLEContacts(contacts); }
    if (this.fenix) this.fenix.markPeer(nx, deviceId, lvl);
  },

  _noteRestored(nexoId, pk, rs) {
    var nx = _normId(nexoId);
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c || !pk || c.publicKey !== pk || !(rs > (c.rsSeen || 0)) || rs > Date.now() + 60000) return;
    c.rsSeen = rs;
    _saveBLEContacts(contacts);
    console.log('[FENIX] ' + nx + ' recuperó su cuenta: sesiones de cifrado nuevas');
    ratchetResetPeer(nx, pk).catch(function() {});
  },

  _markProto2(nexoId, key) {
    var nx = _normId(nexoId);
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c || !key || c.publicKey !== key || c.proto === 2) return;
    c.proto = 2;
    c.proto2At = Date.now();
    _saveBLEContacts(contacts);
    console.log('[E2E] ' + nx + ': protocolo 2');
  },

  _notePeerBundle(nexoId, b) {
    var self = this, nx = _normId(nexoId);
    if (!b || typeof b !== 'object' || !/^nx[0-9a-z]{8}$/.test(nx)) return Promise.resolve(false);
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c || !c.publicKey) return Promise.resolve(false);
    if (b.ik !== c.publicKey) {
      if (c.pendingKey && b.ik === c.pendingKey) { c.pendingBundle = b; _saveBLEContacts(contacts); }
      return Promise.resolve(false);
    }
    return ratchetNotePeerBundle(nx, b).then(function(ok) {
      if (ok) self._markProto2(nx, b.ik);
      return ok;
    }).catch(function() { return false; });
  },

  _ackIfStored(deviceId, nexoId, msgId, routeTo) {
    var self = this;
    if (!msgId || !self.ackSystem) return;
    _vaultLoadMessages(_normId(nexoId)).then(function(msgs) {
      var known = (msgs || []).some(function(m) { return (m.msgId || m.messageId || m.id) === msgId; });
      if (known) self.ackSystem.sendAck(deviceId, msgId, routeTo);
    }).catch(function() {});
  },

  _quarantine(nexoId, release, id) {
    var nx = _normId(nexoId);
    this._held = this._held || [];
    // Un reintento del mismo mensaje no cuenta dos veces
    if (id && this._held.some(function(h) { return h.id === id; })) return;
    this._held.push({ nx: nx, release: release, id: id || null, ts: Date.now() });
    if (this._held.length > 50) this._held.shift();
    console.warn('[E2E] Mensaje de ' + nx + ' retenido: clave cambiada sin aceptar');
    _safeDispatchEvent('nexo:e2e:held', { nexoId: nx, count: this.heldCount(nx) });
  },

  setContactVerified(nexoId, on) {
    var nx = _normId(nexoId);
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c || !c.publicKey || c.pendingKey) return false;
    if (on) c.verified = c.publicKey; else delete c.verified;
    _saveBLEContacts(contacts);
    _safeDispatchEvent('nexo:e2e:key', { nexoId: nx, changed: false, verified: !!on });
    return true;
  },

  heldCount(nexoId) {
    var nx = _normId(nexoId);
    return (this._held || []).filter(function(h) { return h.nx === nx; }).length;
  },

  acceptContactKey(nexoId) {
    var self = this, nx = _normId(nexoId);
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c || !c.pendingKey) return false;
    c.publicKey = c.pendingKey;
    delete c.pendingKey;
    c.keyAcceptedAt = Date.now();
    // Identidad nueva: protocolo, verificación y paquete de claves empiezan de cero
    var pb = c.pendingBundle;
    delete c.pendingBundle; delete c.proto; delete c.proto2At; delete c.verified;
    // Ya anunció el protocolo 2 con esta clave: desde ya (lo pendiente no debe salir con el 1)
    if (pb && pb.ik === c.publicKey) { c.proto = 2; c.proto2At = Date.now(); }
    _saveBLEContacts(contacts);
    var noted = pb ? self._notePeerBundle(nx, pb) : Promise.resolve(false);
    console.log('[E2E] Clave nueva de ' + nx + ' aceptada por el usuario');
    var held = (self._held || []).filter(function(h) { return h.nx === nx; });
    self._held = (self._held || []).filter(function(h) { return h.nx !== nx; });
    held.forEach(function(h) { try { h.release(); } catch (e) {} });
    _safeDispatchEvent('nexo:e2e:key', { nexoId: nx, changed: false, accepted: true });
    noted.then(function() { self._resendPendingMessages(nx); });
    return true;
  },

  rejectContactKey(nexoId) {
    var nx = _normId(nexoId);
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c || !c.pendingKey) return false;
    c.rejectedKey = c.pendingKey;
    delete c.pendingKey;
    delete c.pendingBundle;
    _saveBLEContacts(contacts);
    ratchetForget(nx, c.rejectedKey).catch(function() {});
    this._held = (this._held || []).filter(function(h) { return h.nx !== nx; });
    console.warn('[E2E] Clave nueva de ' + nx + ' rechazada por el usuario');
    _safeDispatchEvent('nexo:e2e:key', { nexoId: nx, changed: false, rejected: true });
    // Lo que esperaba sale cifrado con la clave de siempre
    this._resendPendingMessages(nx);
    return true;
  }
};
