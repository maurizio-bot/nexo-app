// ID Bluetooth rotativo (ronda 2755, plan del dueño punto 4; cálculo en ble_rid.js). Métodos de BLEInterface.
import { t } from './i18n.js';
import { initE2E, e2eMyPublicKey } from '../vault/e2e_crypto.js';
import { RidBook, ridKey, ridIsToken, ridEpochSeconds, RID_VISIBLE_MS } from './ble_rid.js';
import { _getBLEContacts, _hasNativeMethod, _safeNativeCall, _normMac, _normId } from './ble_helpers.js';

var CHECK_MS = 30000;
// 3012: un NEXO cercano no-contacto que ya dijo quién es se lista al abrir «Agregar» si sigue conectado, si el escaneo lo vio
// hace menos de KX_PEER_SEEN_MS o si lo dijo hace menos de KX_PEER_FRESH_MS
var KX_PEER_SEEN_MS = 60000, KX_PEER_FRESH_MS = 90000;

export const BLE_PRIVACY_METHODS = {
  // Arranca con el NEXO ID ya conocido: anuncio y códigos de los contactos; se revisa cada 30 s (contactos nuevos,
  // fin de la visibilidad). El cambio de código de cada época lo hace la parte nativa sola.
  _startPrivacy() {
    var self = this;
    if (!self._ridBook) self._ridBook = new RidBook();
    if (self._privacyTimer) return;
    self._advertise();
    self._privacyTimer = setInterval(function() { self._advertise(); }, CHECK_MS);
  },

  // Sin contactos todavía no hay nada que proteger y hay que poder ser agregado: visible
  _isVisible() {
    return Date.now() < (this._visibleUntil || 0) || _getBLEContacts().length === 0;
  },

  // Pantalla "Agregar" abierta: el NEXO ID se anuncia (como antes) durante RID_VISIBLE_MS o hasta cerrarla
  setVisible(on) {
    this._visibleUntil = on ? Date.now() + RID_VISIBLE_MS : 0;
    this._advertise();
    this._renderVisibleNote();
    if (on) { try { this._listKnownNearby(); } catch (e) {} }
  },

  // 3012 (registro del teléfono de Marcos, 11-11: Austin se identificó justo con «Agregar» cerrado y al reabrir no salía).
  // Quién dijo ser cada NEXO cercano que NO es contacto (su kx directo): se recuerda un rato aunque «Agregar» esté cerrado.
  _noteKxPeer(deviceId, p) {
    var nx = _normId(p && p.from);
    if (!/^nx[0-9a-z]{8}$/.test(nx) || !deviceId || /^(lan|net)/i.test(String(deviceId))) return;
    this._kxPeers = this._kxPeers || new Map();
    var old = this._kxPeers.get(nx) || {};
    var nm = typeof p.nm === 'string' ? p.nm.replace(/[\u0000-\u001f<>]/g, '').trim().substring(0, 40) : '';
    this._kxPeers.delete(nx);
    this._kxPeers.set(nx, { deviceId: deviceId, name: nm || old.name || '', pk: (typeof p.pk === 'string' && p.pk) || old.pk || '', b2: p.b2 || old.b2 || null, ts: Date.now() });
    if (this._kxPeers.size > 60) this._kxPeers.delete(this._kxPeers.keys().next().value);
  },

  // Al abrir «Agregar»: (1) salen YA los NEXO cercanos no-contacto de los que ya se sabe quiénes son (siguen conectados o se
  // vieron hace poco); (2) a los conectados que aún no dijeron quiénes son, se les pregunta ahora.
  _listKnownNearby() {
    var self = this, now = Date.now();
    var readyDev = function(dev) { var st = dev && self._getDeviceState ? self._getDeviceState(dev) : null; return !!(st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready')); };
    (self._kxPeers || new Map()).forEach(function(k, nx) {
      if (_getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; })) return;
      var near = self.relay && self.relay.nearby && self.relay.nearby.get(nx);
      var alive = readyDev(k.deviceId) || (near && now - near.ts < KX_PEER_SEEN_MS) || now - k.ts < KX_PEER_FRESH_MS;
      if (!alive) return;
      self.onDeviceFound({ id: (readyDev(k.deviceId) || !near) ? k.deviceId : near.deviceId, name: k.name || '', rssi: -60, nexoId: nx.toUpperCase() });
    });
    if (self._deviceStates && typeof self._deviceStates.forEach === 'function') self._deviceStates.forEach(function(v, dev) {
      if (/^(lan|net)/i.test(String(dev)) || !(v && (v.state === 'ready_to_chat' || v.state === 'notifications_ready'))) return;
      var nx = _normId(self._macToNexoId.get(_normMac(dev)) || '');
      if (nx && (_getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; }) || (self._kxPeers && self._kxPeers.has(nx)))) return;
      self._askWho(dev, 'al abrir Agregar');
    });
  },

  // Pregunta «quién eres» (kx con petición) por una conexión lista; como mucho una vez cada 3 s por conexión
  _askWho(deviceId, why) {
    var self = this, now = Date.now(), nd = _normMac(deviceId);
    if (!deviceId || /^(lan|net)/i.test(String(deviceId)) || typeof self._sendKx !== 'function') return;
    self._whoAsked = self._whoAsked || new Map();
    // cada 3 s las primeras veces; si no contesta (su app duerme), cada 15 s: no se le martilla
    var wa = self._whoAsked.get(nd) || { ts: 0, n: 0 };
    if (now - wa.ts < (wa.n < 3 ? 3000 : 15000)) return;
    self._whoAsked.set(nd, { ts: now, n: wa.n + 1 }); if (self._whoAsked.size > 200) self._whoAsked.delete(self._whoAsked.keys().next().value);
    if (self.relay && typeof self.relay.noteAsked === 'function') self.relay.noteAsked(deviceId);
    console.log('[ADD] NEXO cercano sin reconocer (' + deviceId + '): se le pregunta quién es' + (why ? ' (' + why + ')' : ''));
    self._sendKx(deviceId, true, true);
  },

  // Una conexión quedó lista y no se sabe de quién es: si «Agregar» está abierto (o se conectó justo para saber quién es),
  // se le pregunta YA. Antes solo se preguntaba al volver a verlo en el escaneo, ≥ 10 s después (registro de Marcos: 11 s por teléfono).
  _linkReadyUnknown(deviceId) {
    var self = this, nd = _normMac(deviceId), now = Date.now();
    if (!deviceId || /^(lan|net)/i.test(String(deviceId)) || self._macToNexoId.get(nd)) return;
    var wanted = self._idWant && now - (self._idWant.get(nd) || 0) < 30000;
    if (!wanted && !(now < (self._visibleUntil || 0))) return;
    self._askWho(deviceId, 'recién conectado');
    // el kx puede perderse (enlace recién hecho): una segunda vez si sigue sin saberse
    setTimeout(function() { if (!self._macToNexoId.get(nd) && Date.now() < (self._visibleUntil || 0)) self._askWho(deviceId, 'otra vez'); }, 3200);
  },

  _renderVisibleNote() {
    var el = typeof document !== 'undefined' && document.getElementById('ble-visible-note');
    if (!el) return;
    el.textContent = Date.now() < (this._visibleUntil || 0) ? t('ble_visible_note', 'Visible para agregar mientras esta pantalla esté abierta') : '';
  },

  _advertise() {
    var self = this;
    if (!self.localNexoId) return Promise.resolve();
    if (self._ridBook) self._ridBook.refresh(_getBLEContacts()).catch(function() {});
    return initE2E().then(function() { return ridKey(e2eMyPublicKey()); }).catch(function() { return null; }).then(function(key) {
      var visible = self._isVisible();
      // Sin contactos: visible "para siempre" hasta que haya alguno (se revisa cada 30 s)
      var until = visible ? Math.max(self._visibleUntil || 0, Date.now() + CHECK_MS * 3) : 0;
      var sig = [self.localNexoId, key, visible].join('|');
      if (sig === self._advSig && (!visible || until - (self._advUntil || 0) < CHECK_MS * 2)) return;
      self._advSig = sig; self._advUntil = until;
      if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'setAdvertisingData')) return;
      if (self._advVisibleLog !== visible) { self._advVisibleLog = visible; console.log('[BLEInterface] Anuncio: ' + (!key ? 'NEXO ID (sin clave aún)' : visible ? 'NEXO ID (visible para agregar)' : 'código rotativo')); }
      var args = { nexoId: self.localNexoId };
      if (key) { args.ridKey = key; args.visibleUntil = until; args.epochS = ridEpochSeconds(); }
      return _safeNativeCall(self.nativePlugin, 'setAdvertisingData', args).catch(function() {});
    });
  },

  // Lo que llega del escaneo: NEXO ID (visible o build anterior) tal cual; un código rotativo se traduce si es de
  // un contacto; si no, es un NEXO anónimo (Jump y Fénix pueden conectar con él y saber quién es al conectar).
  // Devuelve el NEXO ID a usar o null si no hay que seguir.
  _identifyNearby(deviceId, tok) {
    var self = this, now = Date.now();
    self._idAsked = self._idAsked || new Map();
    if (!deviceId) return;
    var st = self._getDeviceState ? self._getDeviceState(deviceId) : null;
    var ready = st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready');
    // 3012: ya conectado → si ya dijo quién es, a la lista (sin volver a preguntar); si no, se le pregunta (con su propio
    // freno), sin esperar los 10 s del intento de conexión
    if (ready) {
      var nxK = _normId(self._macToNexoId.get(_normMac(deviceId)) || '');
      var kp = nxK && self._kxPeers ? self._kxPeers.get(nxK) : null;
      if (kp) {
        if (!_getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nxK; })) self.onDeviceFound({ id: deviceId, name: kp.name || '', rssi: -60, nexoId: nxK.toUpperCase() });
        return;
      }
      self._askWho(deviceId);
      return;
    }
    if (now - (self._idAsked.get(deviceId) || 0) < 10000) return;
    // 3012: el mismo código por otra dirección (el teléfono cambió de dirección): una sola conexión por código a la vez
    if (tok) {
      self._idTok = self._idTok || new Map();
      var it = self._idTok.get(tok);
      if (it && it.mac !== _normMac(deviceId) && now - it.ts < 12000) return;
      self._idTok.set(tok, { mac: _normMac(deviceId), ts: now }); if (self._idTok.size > 200) self._idTok.delete(self._idTok.keys().next().value);
    }
    self._idAsked.set(deviceId, now); if (self._idAsked.size > 300) self._idAsked.delete(self._idAsked.keys().next().value);
    self._idWant = self._idWant || new Map();
    self._idWant.set(_normMac(deviceId), now); if (self._idWant.size > 200) self._idWant.delete(self._idWant.keys().next().value);
    var ok = !!(self.relay && typeof self.relay._connectAnon === 'function' && self.relay._connectAnon(deviceId));
    if (ok) console.log('[ADD] NEXO cercano sin reconocer (' + deviceId + '): conectando para saber quién es');
    else self._idAsked.delete(deviceId); // sin hueco ahora: se reintenta en la próxima vista (no dentro de 10 s)
  },

  _ridFound(data, retry) {
    var self = this, tok = data.nexoId || '';
    if (!ridIsToken(tok)) return tok;
    if (!self._ridBook) self._ridBook = new RidBook();
    var nx = self._ridBook.lookup(tok);
    if (nx) return String(nx).toUpperCase();
    if (!retry) {
      // La lista puede estar desfasada (época nueva, contacto recién agregado): se rehace y se mira otra vez
      self._ridBook.refresh(_getBLEContacts()).then(function() {
        if (self._ridBook.lookup(tok)) self._onScanFound(data, true);
        else {
          if (self.relay && typeof self.relay.noteAnon === 'function') self.relay.noteAnon(data.deviceId, tok, data.rssi);
          // Ronda 2764 (informe del dueño: tras borrar contactos "no los ve"): con "Agregar" abierto, saber quién es este
          // NEXO que no reconozco (sigue teniéndome como contacto y no anuncia su NEXO ID): su kx lo dice y sale en la lista
          if (Date.now() < (self._visibleUntil || 0)) self._identifyNearby(data.deviceId, tok);
        }
      }).catch(function() {});
      return null;
    }
    return null;
  },
};
