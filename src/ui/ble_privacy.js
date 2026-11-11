// ID Bluetooth rotativo (ronda 2755, plan del dueño punto 4; cálculo en ble_rid.js). Métodos de BLEInterface.
import { t } from './i18n.js';
import { initE2E, e2eMyPublicKey } from '../vault/e2e_crypto.js';
import { RidBook, ridKey, ridIsToken, ridEpoch, ridEpochSeconds, RID_VISIBLE_MS } from './ble_rid.js';
import { _getBLEContacts, _hasNativeMethod, _safeNativeCall, _normMac, _normId } from './ble_helpers.js';

var CHECK_MS = 30000;
// 3012: un NEXO cercano no-contacto que ya dijo quién es se lista al abrir «Agregar» si sigue conectado, si el escaneo lo vio
// hace menos de KX_PEER_SEEN_MS o si lo dijo hace menos de KX_PEER_FRESH_MS
var KX_PEER_SEEN_MS = 60000, KX_PEER_FRESH_MS = 90000;
// 3013: filas «identificando…»: cuánto dura una sin volver a verla, desde cuándo se dice «no responde», y cuántas como mucho
var ANON_ROW_TTL_MS = 12000, ANON_ROW_SLOW_MS = 7000, ANON_ROWS_MAX = 8;

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
    // 3013: sus códigos rotativos (de su clave): la próxima vez que el escaneo lo vea se reconoce sin conectar
    var self = this;
    // la fila «identificando…» de ESTA dirección ya sobra (si dijo quién es por otra dirección, la quita _anonResolved por código)
    if (self._anonSeen) self._anonSeen.forEach(function(a, tok) { if (_normMac(a.deviceId) === _normMac(deviceId)) { if (self._addPending && self._addPending.tok === tok) self._addPending.nx = nx; self._anonSeen.delete(tok); } });
    if (old.pk !== self._kxPeers.get(nx).pk || !self._kxTok) self._kxTokRefresh(true);
    if (self._addPending && self._addPending.nx === nx && Date.now() - self._addPending.ts < 30000) { self._addPending = null; setTimeout(function() { try { self._addNewDevice(nx); } catch (e) {} }, 50); }
  },

  // Al abrir «Agregar»: (1) salen YA los NEXO cercanos no-contacto de los que ya se sabe quiénes son (siguen conectados o se
  // vieron hace poco); (2) a los conectados que aún no dijeron quiénes son, se les pregunta ahora.
  _listKnownNearby() {
    var self = this, now = Date.now();
    var readyDev = function(dev) { var st = dev && self._getDeviceState ? self._getDeviceState(dev) : null; return !!(st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready')); };
    (self._kxPeers || new Map()).forEach(function(k, nx) {
      if (_getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; })) return;
      var near = self.relay && self.relay.nearby && self.relay.nearby.get(nx);
      var alive = readyDev(k.deviceId) || (near && now - near.ts < KX_PEER_SEEN_MS) || (k.seen && now - k.seen < KX_PEER_SEEN_MS) || now - k.ts < KX_PEER_FRESH_MS;
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

  // 3013 (regla del dueño 11-11: «cualquiera que tiene NEXO debe aparecer al instante en un escaneo»): la app le deja al nativo
  // su «tarjeta» (el kx sin el paquete de claves) para que conteste «quién soy» aunque la app duerma o esté cerrada (nativeKx)
  _syncKxCard() {
    var self = this, pl = self.nativePlugin;
    if (!pl || !_hasNativeMethod(pl, 'setKxCard') || typeof self._kxPacketBase !== 'function') return;
    var pkt = self._kxPacketBase();
    if (!pkt) return;
    pkt.nk = 1;
    var card = JSON.stringify(pkt);
    if (card === self._kxCardSent) return;
    self._kxCardSent = card;
    _safeNativeCall(pl, 'setKxCard', { card: card }).catch(function() { self._kxCardSent = null; });
  },

  // 3013: códigos rotativos de los NEXO cercanos NO-contacto que ya dijeron quiénes son (su kx trae la clave pública, y de ella
  // salen sus códigos): al volver a verlos en el escaneo se reconocen SIN conectar (aunque cambien de dirección).
  _kxTokRefresh(force) {
    var self = this, e = ridEpoch();
    if (!self._kxPeers || !self._kxPeers.size || !self._ridBook) return Promise.resolve();
    if (!force && self._kxTokEpoch === e) return Promise.resolve();
    if (self._kxTokBusy) return self._kxTokBusy;
    var list = []; self._kxPeers.forEach(function(k, nx) { if (k.pk) list.push([nx, k.pk]); });
    self._kxTokBusy = (async function() {
      var m = new Map();
      for (var i = 0; i < list.length; i++) {
        var toks = await self._ridBook.tokensFor(list[i][1]).catch(function() { return []; });
        toks.forEach(function(tk) { m.set(tk, list[i][0]); });
      }
      self._kxTok = m; self._kxTokEpoch = e;
    })().then(function() { self._kxTokBusy = null; self._anonResolved(); }, function() { self._kxTokBusy = null; });
    return self._kxTokBusy;
  },

  // Un anónimo visto en el escaneo resultó ser alguien que ya dijo quién es: fuera su fila «identificando…»; y si el usuario
  // había tocado «+» en esa fila, se agrega ahora
  _anonResolved() {
    var self = this, changed = false, addNx = null;
    if (!self._anonSeen || !self._kxTok) return;
    self._anonSeen.forEach(function(a, tok) {
      var nx = self._kxTok.get(tok);
      if (!nx) return;
      self._anonSeen.delete(tok); changed = true;
      if (self._addPending && self._addPending.tok === tok && Date.now() - self._addPending.ts < 30000) addNx = nx;
      var kp = self._kxPeers && self._kxPeers.get(nx);
      if (kp && Date.now() < (self._visibleUntil || 0) && !_getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; }))
        self.onDeviceFound({ id: a.deviceId, name: kp.name || '', rssi: a.rssi, nexoId: nx.toUpperCase() });
    });
    if (changed && typeof self.renderNewDeviceBar === 'function') self.renderNewDeviceBar();
    if (addNx) { self._addPending = null; try { self._addNewDevice(addNx); } catch (e) {} }
  },

  // Filas «NEXO cercano · identificando…» para la lista de «Agregar» (ble_ui.renderNewDeviceBar): las más cercanas primero
  _anonRows() {
    var self = this, now = Date.now(), out = [];
    if (!self._anonSeen || !(now < (self._visibleUntil || 0))) return out;
    self._anonSeen.forEach(function(a, tok) {
      if (now - a.ts > ANON_ROW_TTL_MS) { self._anonSeen.delete(tok); return; }
      out.push({ tok: tok, deviceId: a.deviceId, rssi: a.rssi, waiting: now - a.first > ANON_ROW_SLOW_MS, pending: !!(self._addPending && self._addPending.tok === tok) });
    });
    out.sort(function(x, y) { return (y.rssi || -100) - (x.rssi || -100); });
    return out.slice(0, ANON_ROWS_MAX);
  },

  // El usuario tocó «+» en una fila que aún no dijo quién es: se le pregunta ya y se agrega en cuanto conteste
  _addAnon(tok) {
    var self = this, a = self._anonSeen && self._anonSeen.get(tok);
    if (!a) return;
    self._addPending = { tok: tok, ts: Date.now() };
    if (self._idAsked) self._idAsked.delete(a.deviceId);
    if (self._whoAsked) self._whoAsked.delete(_normMac(a.deviceId)); // lo pide el usuario: se le pregunta ya, sin freno
    self._identifyNearby(a.deviceId, tok);
    if (typeof self.renderNewDeviceBar === 'function') self.renderNewDeviceBar();
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
    self._sendKx(deviceId, true, true, true); // 3013: ligero (solo «quién eres»)
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
      try { self._syncKxCard(); } catch (eC) {} // 3013: «quién soy» para que el nativo conteste con la app dormida
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
      self._ridBook.refresh(_getBLEContacts()).then(function() { return self._kxTokRefresh(); }).then(function() {
        if (self._ridBook.lookup(tok)) self._onScanFound(data, true);
        else {
          // 3013: ¿es un NEXO no-contacto que ya dijo quién es (su código sale de la clave que dijo)? Se reconoce sin conectar
          var knx = self._kxTok ? self._kxTok.get(tok) : null, kp = knx && self._kxPeers ? self._kxPeers.get(knx) : null;
          if (kp) {
            kp.seen = Date.now(); kp.deviceId = data.deviceId;
            if (self.relay && typeof self.relay.noteSeen === 'function') self.relay.noteSeen(knx, data.deviceId, data.rssi);
            if (self._anonSeen) self._anonSeen.delete(tok);
            if (Date.now() < (self._visibleUntil || 0) && !_getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === knx; }))
              self.onDeviceFound({ id: data.deviceId, name: kp.name || '', rssi: data.rssi, nexoId: knx.toUpperCase() });
            return;
          }
          // 3013 (regla del dueño): con «Agregar» abierto, TODO NEXO cercano sale al instante: primero como «identificando…»
          // (el anuncio no dice quién es) y en cuanto contesta, con su nombre
          if (Date.now() < (self._visibleUntil || 0)) {
            self._anonSeen = self._anonSeen || new Map();
            var prevA = self._anonSeen.get(tok);
            self._anonSeen.set(tok, { deviceId: data.deviceId, rssi: typeof data.rssi === 'number' ? data.rssi : -100, ts: Date.now(), first: prevA ? prevA.first : Date.now() });
            if (!prevA && typeof self.renderNewDeviceBar === 'function') self.renderNewDeviceBar();
          }
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
