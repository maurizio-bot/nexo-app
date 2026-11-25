/**
 * NEXO — 3207 (dueño 17-11: «quiero que implementes el mismo protocolo de aceptar un contacto como en dispositivos lejanos a
 * dispositivos cercanos»). Antes, el «+» de un teléfono cercano lo agregaba al momento y el otro lo agregaba solo con el primer
 * mensaje, sin que nadie le preguntara. Ahora es como por NEXO ID: el «+» manda una SOLICITUD por el enlace directo (Bluetooth o
 * Wi-Fi; si no sale, por internet) y el otro la ve en «Solicitudes para ti» con Aceptar / Eliminar (y su aviso). Al aceptar,
 * él me agrega y me contesta; de mi lado (decisión del dueño, 17-11: «Quedan agregados») se agrega SOLO si la respuesta trae la
 * MISMA llave que ese teléfono me dijo de cerca (su kx) al pedirla; si no coincide, va a la bandeja para confirmarla a mano
 * (como SEC-2 por internet). Si los dos se piden a la vez, quedan agregados sin más. A un contacto que ya me tiene se le contesta
 * solo. Paquete: { v:1, type:'nq', k:'req'|'acc', from, pk, nm, ph?, em? } (claro, como el kx: lleva la llave pública y el
 * nombre; el teléfono y el correo van ENMASCARADOS, como por internet).
 */
import { t } from './i18n.js';
import { _addBLEContact, _getBLEContacts, _saveBLEContacts, _isBLEContact, _normId, _normMac, _safeDispatchEvent, _showToast, _vaultGetOrCreateContact } from './ble_helpers.js';
import { myProfile, maskPhone, maskEmail } from './profile_data.js';
import { e2eMyPublicKey, initE2E } from '../vault/e2e_crypto.js';

var NX_RE = /^nx[0-9a-z]{8}$/;
var RETRY_MS = [900, 3000, 8000];   // la solicitud se repite si aún no contestan (el enlace puede tardar en quedar listo)
var NET_FALLBACK_MS = 9000;         // sin respuesta por el enlace directo: también por internet (si hay)

export const BLE_NEARREQ_METHODS = {
  // Simulador: la batería de pruebas (cientos de pruebas que agregan con «+») acepta sola, como antes; la prueba de esto lo apaga.
  // En el teléfono el nativo no tiene simNearAutoAccept (la llamada falla): nunca se acepta solo.
  _nearAuto() {
    var self = this;
    if (!self._nearAutoP) {
      var pl = self.nativePlugin;
      self._nearAutoP = new Promise(function(resolve) {
        try { Promise.resolve(pl && typeof pl.simNearAutoAccept === 'function' ? pl.simNearAutoAccept() : null).then(function(r) { resolve(!!(r && r.on === true)); }, function() { resolve(false); }); } catch (e) { resolve(false); }
      });
    }
    return self._nearAutoP;
  },

  _saveContactsNear(cs) { try { _saveBLEContacts(cs); _safeDispatchEvent('nexo:e2e:key', { changed: false, confirmed: true }); } catch (e) {} },

  _nearOut(nx) { return this._reqStore('nexo_req_out').find(function(x) { return x.id === nx; }) || null; },

  // El «+» de un teléfono cercano que no es contacto
  _nearRequest(nexoId, name, device) {
    var self = this, nx = _normId(nexoId);
    if (!NX_RE.test(nx)) return;
    var kxp = self._kxPeers && self._kxPeers.get(nx);
    var out = self._reqStore('nexo_req_out').filter(function(x) { return x.id !== nx; });
    out.unshift({ id: nx, at: Date.now(), near: 1, pk: (kxp && kxp.pk) || '', name: name || '' });
    self._reqSave('nexo_req_out', out);
    _safeDispatchEvent('nexo:ble:reqSent', { id: nx, near: true });
    console.log('[ADD] Solicitud a ' + nx + ' (' + (name || '?') + ', cerca): espera a que la acepte'); // i18n-ok: registro
    _showToast(t('near_req_sent', 'Solicitud enviada a {name}. Aparecerá en tus contactos cuando la acepte.').replace(/\{name\}/g, function() { return name || nx.toUpperCase(); }), 'info');
    var devId = device && device.id;
    RETRY_MS.forEach(function(ms) { setTimeout(function() { if (self._nearOut(nx) && !_isBLEContact(nx)) self._sendNear(nx, 'req', devId); }, ms); });
    setTimeout(function() {
      if (!self._nearOut(nx) || _isBLEContact(nx) || !self.net || typeof self.net.sendRequest !== 'function') return;
      var mp = myProfile();
      self.net.sendRequest(nx, 'req', self.localDeviceName || '', { ph: maskPhone(mp.phone), em: maskEmail(mp.email) }).then(function() {
        console.log('[ADD] Solicitud a ' + nx + ' también por internet (sin respuesta por el enlace directo)'); // i18n-ok: registro
      }, function() {});
    }, NET_FALLBACK_MS);
  },

  // Manda la solicitud o la respuesta por el enlace directo con ese teléfono (la dirección que dio, o la de su NEXO ID)
  _sendNear(nx, kind, devId) {
    var self = this;
    var dev = devId || (typeof self._resolveDeviceIdForNexoId === 'function' ? self._resolveDeviceIdForNexoId(nx) : null);
    if (!dev || /^net:/i.test(String(dev))) return Promise.resolve(false);
    return initE2E().then(function() {
      var pk = e2eMyPublicKey();
      if (!pk || !self.localNexoId) return false;
      var mp = myProfile();
      var pkt = { v: 1, type: 'nq', k: kind, from: _normId(self.localNexoId), pk: pk, nm: String(self.localDeviceName || '').substring(0, 40) };
      var ph = maskPhone(mp.phone), em = maskEmail(mp.email);
      if (ph) pkt.ph = ph;
      if (em) pkt.em = em;
      return Promise.resolve(self._sendMessageNative(dev, JSON.stringify(pkt), null)).then(function() { return true; }, function() { return false; });
    }).catch(function() { return false; });
  },

  // Agregar de verdad a un teléfono cercano (lo que antes hacía el «+» al momento): contacto, su llave y su paquete del kx
  // 9A (23-11): aviso (una vez por NEXO ID y sesión) de que dos teléfonos dicen ser la misma persona
  _nearClash(nx) {
    this._clashSaid = this._clashSaid || new Set();
    if (this._clashSaid.has(nx)) return;
    this._clashSaid.add(nx);
    _showToast(t('near_clash', '⚠️ Dos teléfonos cercanos dicen ser {id}: no se agrega a ninguno. Comparad el número de seguridad en persona.').replace(/\{id\}/g, function() { return nx.toUpperCase(); }), 'warn');
  },

  _nearAddContact(nx, name, pk, devId) {
    var self = this, NX = String(nx).toUpperCase();
    var kxp = self._kxPeers && self._kxPeers.get(nx);
    if (kxp && kxp.cf && !_isBLEContact(NX)) { console.warn('[ADD] ' + nx + ': dos teléfonos dicen ser él: no se agrega'); self._nearClash(nx); return; } // i18n-ok: registro
    if (!_isBLEContact(NX)) {
      _addBLEContact({ deviceUUID: NX, name: name || (kxp && kxp.name) || NX, deviceId: (devId && !/^net:/i.test(String(devId))) ? devId : ((kxp && kxp.deviceId) || null) });
      _vaultGetOrCreateContact(NX, name || NX, name || '');
      if (typeof self._applyNtNow === 'function') self._applyNtNow(NX);
      if (typeof self._offerReinstallMerge === 'function') self._offerReinstallMerge(NX);
    }
    try {
      if (pk && typeof self._noteSenderKey === 'function') self._noteSenderKey(NX, pk);
      // 8A (23-11): agregarse de cerca, con la misma llave que dijo de cerca, sí confirma una clave que llegó «de oídas»
      if (pk) { var csN = _getBLEContacts(), cN = csN.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; }); if (cN && cN.pkHearsay && cN.publicKey === pk && kxp && kxp.pk === pk) { delete cN.pkHearsay; delete cN.pkConflict; self._saveContactsNear(csN); } }
      if (kxp && kxp.b2 && kxp.pk === pk && typeof self._notePeerBundle === 'function') self._notePeerBundle(NX, kxp.b2);
    } catch (e) {}
    self._reqSave('nexo_req_out', self._reqStore('nexo_req_out').filter(function(x) { return x.id !== nx; }));
    self._reqSave('nexo_req_in', self._reqStore('nexo_req_in').filter(function(x) { return x.id !== nx; }));
    if (typeof self.renderContactsList === 'function') self.renderContactsList();
    if (typeof self.renderOnlineStrip === 'function') self.renderOnlineStrip();
    // el kx completo (paquete del protocolo 2) para que el cifrado quede listo ya
    var dev = devId || (kxp && kxp.deviceId);
    if (dev && !/^(lan|net)/i.test(String(dev)) && typeof self._sendKx === 'function') self._sendKx(dev, true, true);
  },

  // Llega un paquete 'nq' por un enlace directo
  _onNearReq(deviceId, p) {
    var self = this, nx = _normId(p && p.from), pk = p && p.pk;
    if (!NX_RE.test(nx) || typeof pk !== 'string' || !pk || nx === _normId(self.localNexoId)) return;
    if (p.k !== 'req' && p.k !== 'acc') return;
    // la llave tiene que ser la que ese teléfono dijo de cerca (su kx), y la conexión la suya: si no, es otro hablando por él
    var kxp = self._kxPeers && self._kxPeers.get(nx);
    if (kxp && kxp.pk && kxp.pk !== pk) { console.warn('[ADD] Solicitud de cerca de ' + nx + ' con otra llave: descartada'); return; } // i18n-ok: registro
    if (kxp && kxp.cf) { self._nearClash(nx); return; } // 9A (23-11): dos teléfonos dicen ser él
    var mapped = self._macToNexoId && self._macToNexoId.get(_normMac(deviceId));
    if (mapped && _normId(mapped) !== nx) { console.warn('[ADD] Solicitud de cerca que dice ser de ' + nx + ' por la conexión de ' + _normId(mapped) + ': descartada'); return; } // i18n-ok: registro
    var name = typeof p.nm === 'string' ? p.nm.trim().substring(0, 40) : '';
    var known = _getBLEContacts().find(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; });
    if (p.k === 'req') {
      // ya es mi contacto (me borró, o se repite): le contesto solo
      if (known) { if (!known.publicKey || known.publicKey === pk) self._sendNear(nx, 'acc', deviceId); return; }
      var mine = self._nearOut(nx);
      self._nearAuto().then(function(auto) {
        if (_isBLEContact(nx)) return;
        // los dos se pidieron a la vez (o el simulador): quedan agregados
        if (auto || (mine && (!mine.pk || mine.pk === pk))) {
          self._nearAddContact(nx, name, pk, deviceId);
          self._sendNear(nx, 'acc', deviceId);
          if (mine) _safeDispatchEvent('nexo:ble:reqAccepted', { id: nx, name: name });
          return;
        }
        self._onNetRequest({ id: nx, pk: pk, name: name, ph: p.ph || '', em: p.em || '', kind: 'req', near: 1, dev: deviceId });
      });
      return;
    }
    // 'acc': aceptó MI solicitud. Con la misma llave que me dijo de cerca al pedirla → agregado; si no, a la bandeja (confirmar)
    if (known) return;
    var out = self._nearOut(nx);
    if (out && out.near && (out.pk ? out.pk === pk : (kxp && kxp.pk === pk))) {
      console.log('[ADD] ' + nx + ' aceptó la solicitud de cerca: agregado'); // i18n-ok: registro
      self._nearAddContact(nx, name || out.name || '', pk, deviceId);
      _safeDispatchEvent('nexo:ble:reqAccepted', { id: nx, name: name || out.name || '' });
      _showToast(t('near_req_accepted', '✅ {name} aceptó tu solicitud: ya es tu contacto').replace(/\{name\}/g, function() { return name || out.name || nx.toUpperCase(); }), 'info');
      return;
    }
    self._onNetRequest({ id: nx, pk: pk, name: name, ph: p.ph || '', em: p.em || '', kind: 'acc', near: 1, dev: deviceId });
  },
};
