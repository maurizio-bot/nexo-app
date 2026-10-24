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
