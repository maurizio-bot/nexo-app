// ID Bluetooth rotativo (ronda 2755, plan del dueño punto 4; cálculo en ble_rid.js). Métodos de BLEInterface.
import { initE2E, e2eMyPublicKey } from '../vault/e2e_crypto.js';
import { RidBook, ridKey, ridIsToken, ridEpochSeconds, RID_VISIBLE_MS } from './ble_rid.js';
import { _getBLEContacts, _hasNativeMethod, _safeNativeCall, _normMac, _normId } from './ble_helpers.js';

var CHECK_MS = 30000;

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
  },

  _renderVisibleNote() {
    var el = typeof document !== 'undefined' && document.getElementById('ble-visible-note');
    if (!el) return;
    el.textContent = Date.now() < (this._visibleUntil || 0) ? 'Visible para agregar mientras esta pantalla esté abierta' : '';
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
  _identifyNearby(deviceId) {
    var self = this, now = Date.now();
    self._idAsked = self._idAsked || new Map();
    if (!deviceId || now - (self._idAsked.get(deviceId) || 0) < 10000) return;
    self._idAsked.set(deviceId, now);
    var st = self._getDeviceState ? self._getDeviceState(deviceId) : null;
    var ready = st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready');
    console.log('[ADD] NEXO cercano sin reconocer (' + deviceId + '): ' + (ready ? 'se le pregunta quién es' : 'conectando para saber quién es'));
    if (ready && typeof self._sendKx === 'function') self._sendKx(deviceId, true, true);
    else if (self.relay && typeof self.relay._connectAnon === 'function') self.relay._connectAnon(deviceId);
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
          if (Date.now() < (self._visibleUntil || 0)) self._identifyNearby(data.deviceId);
        }
      }).catch(function() {});
      return null;
    }
    return null;
  },
};
