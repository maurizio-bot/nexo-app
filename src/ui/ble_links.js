/**
 * NEXO — Enlaces Wi-Fi e internet (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752, sin cambios):
 * el contacto aparece o desaparece por Wi-Fi (lan:) o internet (net:), paquetes que llegan por ahí, buzón de
 * internet y por dónde va cada contacto (linkOf).
 */
import { BLE_STATES, _getBLEContacts, _lanId, _netId, _netNx, _normId, _normMac, _safeDispatchEvent, _saveBLEContacts, _vNx } from './ble_helpers.js';


export const BLE_LINK_METHODS = {
  _lanUp(nexoId) {
    var nx = _normId(nexoId), id = _lanId(nx), nd = _normMac(id);
    this._deviceStates.set(nd, { state: BLE_STATES.READY_TO_CHAT, since: Date.now(), lan: true });
    this._macToNexoId.set(nd, nx);
    this._lostPeers.delete(nx);
    if (this.relay) this.relay.onLinkChange();
    this._processPendingMessages(id);
    this._resendPendingMessages(nx);
    _safeDispatchEvent('nexo:ble:linkChange', { nexoId: nx, via: 'wifi' });
  },

  _lanDown(nexoId) {
    var self = this, nx = _normId(nexoId), nd = _normMac(_lanId(nx));
    self._deviceStates.delete(nd);
    var next = self._resolveDeviceIdForNexoId(nx);
    var st = next ? self._getDeviceState(next) : {};
    var direct = !!next && !_vNx(next) && (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY);
    if (!direct && next && _netNx(next) && this.net && this.net.canReach(nx)) direct = true; // sigue por internet
    // Textos esperando confirmación y envíos por trozos siguen por Bluetooth donde iban (ble_ack.relink)
    if (self.ackSystem && typeof self.ackSystem.relink === 'function') self.ackSystem.relink(_lanId(nx), direct ? next : null);
    if (!direct) self._markPeerLost(nx);
    if (self.relay) self.relay.onLinkChange();
    _safeDispatchEvent('nexo:ble:linkChange', { nexoId: nx, via: direct ? 'bluetooth' : 'none' });
  },

  // Ronda 2760: con varios enlaces listos con el mismo contacto (Android usa direcciones distintas), el de MTU más alto
  // (en los teléfonos del dueño convivían uno de 23 y otro de 512: la foto salía por el de 23, ~20 veces más lento)
  _bleReadyFor(nexoId) {
    var self = this, nx = _normId(nexoId), found = null, best = -1;
    this._deviceStates.forEach(function(st, key) {
      if (/^(lan|net)nx/.test(key) || (st.state !== BLE_STATES.READY_TO_CHAT && st.state !== BLE_STATES.NOTIFICATIONS_READY)) return;
      if (_normId(self._macToNexoId.get(key)) !== nx) return;
      var mtu = (self._mtuByDevice && self._mtuByDevice.get(key)) || 185; // sin medir: entre el mínimo y el bueno
      if (mtu > best) { best = mtu; found = key; }
    });
    return found;
  },

  _lanDegraded(nexoId, on) {
    var nx = _normId(nexoId);
    if (on) {
      // Ronda 2760 (regla del dueño): Wi-Fi muy malo → internet (los dos en Wi-Fi); si no, Bluetooth
      var to = (this.net && this.net.canReach(nx) && this.net.bothWifi(nx)) ? _netId(nx) : this._bleReadyFor(nx);
      if (to && this.ackSystem && typeof this.ackSystem.relink === 'function') this.ackSystem.relink(_lanId(nx), to);
    }
    _safeDispatchEvent('nexo:ble:linkChange', { nexoId: nx, via: this.linkOf(nx) });
  },

  _onLanPayload(nexoId, content) {
    var self = this;
    var data = { deviceId: _lanId(nexoId), content: content, data: content, source: 'lan', timestamp: Date.now(), reassembled: true };
    self._payloadChain = (self._payloadChain || Promise.resolve())
      .then(function() { return self._prePayload(data); })
      .then(function(d) { if (d) self._handlePayload(d); })
      .catch(function(e) { console.warn('[BLEInterface] Error procesando paquete (Wi-Fi):', e && e.message); });
  },

  _netUp(nexoId) {
    var nx = _normId(nexoId), id = _netId(nx), nd = _normMac(id);
    this._deviceStates.set(nd, { state: BLE_STATES.READY_TO_CHAT, since: Date.now(), net: true });
    this._macToNexoId.set(nd, nx);
    this._lostPeers.delete(nx);
    if (this.relay) this.relay.onLinkChange();
    this._processPendingMessages(id);
    this._resendPendingMessages(nx);
    _safeDispatchEvent('nexo:ble:linkChange', { nexoId: nx, via: this.linkOf(nx) });
  },

  _netDown(nexoId) {
    var self = this, nx = _normId(nexoId), nd = _normMac(_netId(nx));
    self._deviceStates.delete(nd);
    var next = self._resolveDeviceIdForNexoId(nx);
    var st = next ? self._getDeviceState(next) : {};
    var direct = !!next && !_vNx(next) && (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY);
    if (self.ackSystem && typeof self.ackSystem.relink === 'function') self.ackSystem.relink(_netId(nx), direct ? next : null);
    if (!direct) self._markPeerLost(nx);
    if (self.relay) self.relay.onLinkChange();
    _safeDispatchEvent('nexo:ble:linkChange', { nexoId: nx, via: self.linkOf(nx) });
  },

  _onNetPayload(nexoId, content) {
    var self = this;
    var data = { deviceId: _netId(nexoId), content: content, data: content, source: 'net', timestamp: Date.now(), reassembled: true };
    self._payloadChain = (self._payloadChain || Promise.resolve())
      .then(function() { return self._prePayload(data); })
      .then(function(d) { if (d) self._handlePayload(d); })
      .catch(function(e) { console.warn('[BLEInterface] Error procesando paquete (internet):', e && e.message); });
  },

  _noteNetPeer(nexoId) {
    var nx = _normId(nexoId);
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c) { this._ntKnown = this._ntKnown || new Set(); this._ntKnown.add(nx); return; }
    if (!c.nt) { c.nt = 1; _saveBLEContacts(contacts); if (this.net) this.net.tick(); }
  },

  _applyNtKnown() {
    if (!this._ntKnown || !this._ntKnown.size) return;
    var self = this, contacts = _getBLEContacts(), changed = false;
    contacts.forEach(function(c) { var nx = _normId(c.nexoId || c.deviceUUID); if (self._ntKnown.has(nx) && !c.nt) { c.nt = 1; changed = true; self._ntKnown.delete(nx); } });
    if (changed) _saveBLEContacts(contacts);
  },

  // ---------- Alta por ID (ronda 2779): solicitudes de contacto por internet (sin estar cerca) ----------
  // El amigo te pasa su NEXO ID (p. ej. por WhatsApp); lo pegas y le mandas una solicitud. Él la acepta o la elimina
  // (anti-spam). La clave que llega así entra "sin verificar" (el banner del chat pide comparar el número de seguridad).
  _reqStore(key) { try { return JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem(key)) || '[]') || []; } catch (e) { return []; } },
  _reqSave(key, arr) { try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify((arr || []).slice(0, 60))); } catch (e) {} },

  // Mandar una solicitud de contacto a un NEXO ID. Devuelve una promesa (error legible si falla).
  addByNexoId(id) {
    var self = this, nx = _normId(id);
    if (!/^nx[0-9a-z]{8}$/.test(nx)) return Promise.reject(new Error('Ese no parece un NEXO ID (empieza por NX y 8 más)'));
    if (nx === _normId(self.localNexoId)) return Promise.reject(new Error('Ese es tu propio ID'));
    if (_getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; })) return Promise.reject(new Error('Ya tienes a ese contacto'));
    if (!self.net) return Promise.reject(new Error('Esta versión no tiene internet'));
    return self.net.sendRequest(nx, 'req', self.localDeviceName || '').then(function() {
      var out = self._reqStore('nexo_req_out').filter(function(x) { return x.id !== nx; });
      out.unshift({ id: nx, at: Date.now() });
      self._reqSave('nexo_req_out', out);
      _safeDispatchEvent('nexo:ble:reqSent', { id: nx });
      return true;
    });
  },

  // Llega algo a mi buzón de solicitudes (lo descifró net_link). req = me quieren agregar; acc = aceptaron mi solicitud.
  _onNetRequest(info) {
    var self = this, nx = _normId(info && info.id), pk = info && info.pk, name = (info && info.name) || '';
    if (!/^nx[0-9a-z]{8}$/.test(nx) || typeof pk !== 'string') return;
    if (_getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; })) return; // ya es contacto
    var out = self._reqStore('nexo_req_out');
    if (info.kind === 'acc' && out.some(function(x) { return x.id === nx; })) {
      // Aceptaron MI solicitud: agrego su clave (sin verificar) y el canal seguro se enciende solo
      self.addSharedContacts([{ nexoId: nx, name: name, publicKey: pk, nt: 1 }], null, { quiet: true });
      self._reqSave('nexo_req_out', out.filter(function(x) { return x.id !== nx; }));
      if (self.net) self.net.greet();
      console.log('[BLEInterface] ' + nx + ' aceptó la solicitud: contacto agregado por internet (sin verificar)');
      _safeDispatchEvent('nexo:ble:reqAccepted', { id: nx, name: name });
      return;
    }
    // Solicitud entrante (o una aceptación que no esperaba): a la bandeja, para aceptar o eliminar
    var inbox = self._reqStore('nexo_req_in').filter(function(x) { return x.id !== nx; });
    inbox.unshift({ id: nx, pk: pk, name: name, at: Date.now() });
    self._reqSave('nexo_req_in', inbox);
    _safeDispatchEvent('nexo:ble:reqIncoming', { id: nx, name: name, count: inbox.length });
  },

  pendingRequests() { return this._reqStore('nexo_req_in'); },

  // Aceptar una solicitud entrante: agrego su clave (sin verificar), le aviso (acc) y el canal se enciende
  acceptRequest(id) {
    var self = this, nx = _normId(id);
    var inbox = self._reqStore('nexo_req_in'), req = inbox.find(function(x) { return x.id === nx; });
    if (!req || !req.pk) return Promise.reject(new Error('Esa solicitud ya no está'));
    self.addSharedContacts([{ nexoId: nx, name: req.name || '', publicKey: req.pk, nt: 1 }], null, { quiet: true });
    self._reqSave('nexo_req_in', inbox.filter(function(x) { return x.id !== nx; }));
    if (self.net) self.net.greet();
    _safeDispatchEvent('nexo:ble:reqIncoming', { count: self._reqStore('nexo_req_in').length });
    return (self.net ? self.net.sendRequest(nx, 'acc', self.localDeviceName || '') : Promise.resolve()).catch(function() {});
  },

  // Eliminar una solicitud entrante (no se agrega nada)
  rejectRequest(id) {
    var self = this, nx = _normId(id);
    self._reqSave('nexo_req_in', self._reqStore('nexo_req_in').filter(function(x) { return x.id !== nx; }));
    _safeDispatchEvent('nexo:ble:reqIncoming', { count: self._reqStore('nexo_req_in').length });
  },

  _sendViaNetMailbox(nexoId, content, msgId, seq) {
    var nx = _normId(nexoId);
    if (!this.net || !this.net.mailboxOk(nx) || !this.ackSystem) return Promise.reject(Object.assign(new Error('Sin internet'), { code: 'PEER_ABSENT' }));
    console.log('[NET] ' + msgId + ' al buzón de internet de ' + nx);
    return this.ackSystem.sendWithRetry(_netId(nx), content, msgId, seq);
  },

  linkOf(nexoId) {
    var nx = _normId(nexoId);
    if (this.lan && this.lan.canReach(nx)) return 'wifi';
    var dev = this._resolveDeviceIdForNexoId(nx);
    if (_netNx(dev)) return 'internet';
    var st = dev ? this._getDeviceState(dev).state : null;
    if (st === BLE_STATES.READY_TO_CHAT || st === BLE_STATES.NOTIFICATIONS_READY) return 'bluetooth';
    if (this.relay && this.relay.relayHop(nx)) return 'jump';
    return 'none';
  }
};
