/**
 * 3276 (PRIORIDAD 1 del dueño, «Bluetooth entero en el servicio nativo», FASE 4: conexiones a demanda con tope; estudio de multitud
 * del 17-11, docs/EDC_LIMITES.md, cambio n.º 2): GESTOR DE ENLACES Bluetooth.
 *
 * Android aguanta ~7 enlaces Bluetooth a la vez. Hasta hoy NEXO conectaba con TODO contacto que veía cerca, sin tope ni orden: con
 * 10 contactos dormidos alrededor (un vagón, un concierto) los enlaces se llenaban y el contacto que SÍ tenía un mensaje esperando
 * no conectaba nunca (222 intentos rechazados en 2 min en el estudio), y las conexiones «de paso» (Jump, puente) se llevaban huecos.
 *
 * Decisión del dueño (22-11): con POCOS contactos cerca todo sigue como siempre (enlaces abiertos = entrega al instante; abrir un
 * enlace es lo lento y lo frágil del Bluetooth). Solo cuando no caben todos entra el orden:
 *   - tope LINK_CAP (6: uno de margen sobre lo que aguanta Android);
 *   - por «estar cerca» se conecta con hasta LINK_CONTACT_MAX (4) contactos; el resto queda SIN enlace y se conecta A DEMANDA;
 *   - un hueco queda reservado para quien tiene algo esperando (pendientes) o el chat abierto, y otro para una conexión de paso;
 *   - si aun así no hay sitio, quien tiene pendientes (o el chat abierto) DESALOJA al menos importante que no esté ocupado:
 *     primero una conexión de paso, luego el contacto que lleva más tiempo callado (pendientes > chat abierto > reciente);
 *   - cuando sobran contactos «por estar cerca» (pasó la urgencia), el que lleva más de 2 min callado suelta su enlace.
 * Nunca se cierra un enlace ocupado (transferencia, llamada, chat abierto) ni uno recién abierto (aún identificándose).
 * LINK_CAP y LINK_CONTACT_MAX se pueden cambiar con window.NEXO_LINK_CAP / NEXO_LINK_CONTACTS (p. ej. 1 contacto = «siempre a demanda»).
 *
 * linkPlan y linkTrim son puras (tests/sim/enlacestope.js).
 */
import { BLE_STATES, _hasNativeMethod, _normId, _normMac, _safeNativeCall } from './ble_helpers.js';

export var LINK_CAP = 6;
export var LINK_CONTACT_MAX = 4;
export var LINK_IDLE_MS = 120000;
export var LINK_FRESH_MS = 15000;   // un enlace recién abierto aún se está identificando: no se toca
export var LINK_PEND_MAX_MS = 30 * 60000; // 3284: lo mandado en esta sesión cuenta como «esperando» hasta 30 min sin confirmar (después, las otras señales)
export var CONN_YIELD_MIN_MS = 1500;   // 3284: un intento de conexión más joven que esto aún puede salir bien: no cede
export var CONN_YIELD_HOLD_MS = 20000; // 3284: quien cedió el paso no vuelve a intentarlo (sin prisa) en este rato

function _prio(l) { return l.busy ? 4 : l.pending ? 3 : l.chat ? 2 : l.contact ? 1 : 0; }
// El menos importante que se puede cerrar entre los de prioridad < maxPrio (a igual prioridad, el que lleva más tiempo callado)
function _victim(links, maxPrio) {
  var best = null;
  links.forEach(function(l) {
    var p = _prio(l);
    if (p >= maxPrio || p >= 4 || l.fresh) return;
    if (!best || p < _prio(best) || (p === _prio(best) && (l.lastAt || 0) < (best.lastAt || 0))) best = l;
  });
  return best;
}

/**
 * ¿Se puede abrir un enlace nuevo? links = los que hay (abiertos o conectando): { key, contact, pending, chat, busy, fresh, lastAt }.
 * want = quién pide: { contact, pending, chat } (sin contact = conexión de paso). Devuelve { allow, close: [key], why }.
 */
export function linkPlan(links, want, opts) {
  var cap = (opts && opts.cap) || LINK_CAP, cmax = (opts && opts.contacts) || LINK_CONTACT_MAX;
  var n = links.length, wp = want.pending ? 3 : want.chat ? 2 : want.contact ? 1 : 0;
  if (want.manual) wp = Math.max(wp, 3); // «Agregar» / abrir a mano: intención del usuario
  if (wp >= 2) {
    if (n < cap) return { allow: true, close: [], why: 'hay sitio' };
    var v = _victim(links, wp);
    return v ? { allow: true, close: [v.key], why: 'desaloja a ' + (v.contact ? 'un contacto callado' : 'una conexión de paso') } : { allow: false, close: [], why: 'todos los enlaces están ocupados' }; // i18n-ok: registro
  }
  if (wp === 1) {
    var normales = links.filter(function(l) { return l.contact; }).length;
    if (normales < cmax && n < cap - 1) return { allow: true, close: [], why: 'hay sitio' };
    return { allow: false, close: [], why: normales >= cmax ? 'ya hay ' + normales + ' contactos enlazados: a demanda' : 'el hueco libre es para quien tenga pendientes' }; // i18n-ok: registro
  }
  // de paso (Jump, puente): solo con dos huecos libres (uno queda para un contacto con pendientes) y sin nadie esperando
  if (opts && opts.waiting) return { allow: false, close: [], why: 'hay un contacto esperando enlace' }; // i18n-ok: registro
  return n < cap - 1 ? { allow: true, close: [], why: 'hay sitio' } : { allow: false, close: [], why: 'sin hueco para conexiones de paso' };
}

/** Repaso: qué enlaces soltar ahora. Por encima del tope, el menos importante; y los contactos de sobra que llevan > 2 min callados. */
export function linkTrim(links, opts) {
  var cap = (opts && opts.cap) || LINK_CAP, cmax = (opts && opts.contacts) || LINK_CONTACT_MAX, now = (opts && opts.now) || Date.now();
  var idleMs = (opts && opts.idleMs) || LINK_IDLE_MS, rest = links.slice(), out = [];
  while (rest.length > cap) { var v = _victim(rest, 4); if (!v) break; out.push(v.key); rest.splice(rest.indexOf(v), 1); }
  var calm = function() { return rest.filter(function(l) { return _prio(l) === 1; }); };
  while (calm().length > cmax) {
    var c = calm().filter(function(l) { return !l.fresh && now - (l.lastAt || 0) > idleMs; }).sort(function(a, b) { return (a.lastAt || 0) - (b.lastAt || 0); })[0];
    if (!c) break;
    out.push(c.key); rest.splice(rest.indexOf(c), 1);
  }
  return out;
}

export const BLE_LINKMGR_METHODS = {
  _linkOpts() {
    var w = (typeof window !== 'undefined') ? window : {};
    return { cap: Number(w.NEXO_LINK_CAP) || LINK_CAP, contacts: Number(w.NEXO_LINK_CONTACTS) || LINK_CONTACT_MAX, idleMs: Number(w.NEXO_LINK_IDLE_MS) || LINK_IDLE_MS, now: Date.now() };
  },
  // ¿Ese contacto tiene algo esperando salir? (lo que ya se sabe sin leer historiales)
  // 3284 (multitud.js --b-dormido): el gestor solo sabía de pendientes por dos marcas que no siempre se ponen (la bandeja y el
  // calendario de toques: un mensaje recién escrito a quien justo se alejó no estaba en ninguna). Con 4 contactos ya enlazados, al
  // contacto con el mensaje esperando se le negaba el enlace («a demanda») como a uno más. Ahora cuenta también lo que se mandó en
  // esta sesión y sigue sin confirmar (_msgDest + ackSystem.isDone: en memoria, sin leer historiales; se rehace como mucho cada 2 s).
  _linkPendNow() {
    var self = this, now = Date.now();
    if (self._lpSet && now - (self._lpAt || 0) < 2000) return self._lpSet;
    var set = new Set(), ack = self.ackSystem, first = self._lpFirst || (self._lpFirst = new Map());
    try {
      if (self._msgDest && ack && typeof ack.isDone === 'function') {
        self._msgDest.forEach(function(nx, id) {
          if (ack.isDone(id)) { first.delete(id); return; }
          var t = first.get(id);
          if (!t) { t = now; first.set(id, t); }
          if (now - t < LINK_PEND_MAX_MS) set.add(_normId(nx));
        });
        if (first.size > 2500) Array.from(first.keys()).forEach(function(k) { if (!self._msgDest.has(k)) first.delete(k); });
      }
    } catch (e) {}
    self._lpSet = set; self._lpAt = now;
    return set;
  },
  _linkPending(nx) {
    if (!nx) return false;
    if (this._outboxNx && this._outboxNx.has(nx)) return true;
    if (this._pendingWake && this._pendingWake.has(nx)) return true;
    return this._linkPendNow().has(nx);
  },
  /**
   * 3284 (modo vagón / multitud, EDC; multitud.js --b-dormido: mi contacto llega con el teléfono en el bolsillo entre 500 NEXO, lo veo a
   * los 9 s y su mensaje pendiente tardaba 50 s): PASO LIBRE en la cola de conexiones. Android abre los enlaces Bluetooth de uno en
   * uno, y un intento con un teléfono que ya se alejó tarda ~15 s en fallar: la conexión del contacto que SÍ tiene un mensaje
   * esperando hacía cola detrás de los intentos «por estar cerca» y de las conexiones de paso. Ahora, cuando se va a conectar con
   * alguien con prisa (mensajes esperando, chat abierto o «Agregar»), los intentos SIN prisa que siguen en el aire se cancelan (el
   * nativo suelta el intento: disconnectDevice) y no se repiten en 20 s; después vuelven solos por su camino de siempre. No se toca
   * un enlace ya abierto, ni un intento con otro contacto que también tiene prisa, ni uno que acaba de empezar.
   */
  _connUrgent(nx, opts) {
    nx = _normId(nx || '');
    if (opts && (opts.manual || opts.why === 'pendientes')) return true;
    return !!nx && (this._linkPending(nx) || nx === _normId(this._activeChatDeviceId || ''));
  },
  _connYielded(deviceId) { return !!(this._connYieldUntil && (this._connYieldUntil.get(_normMac(deviceId)) || 0) > Date.now()); },
  _connYield(forNx) {
    var self = this, now = Date.now(), n = 0, pl = self.nativePlugin;
    if (!pl || !_hasNativeMethod(pl, 'disconnectDevice')) return 0;
    forNx = _normId(forNx || '');
    self._connUrgentUntil = now + 8000; // mientras se abre este enlace no empieza ninguna conexión de paso (_linkRoom)
    var hold = self._connYieldUntil || (self._connYieldUntil = new Map());
    var cancel = function(key) {
      hold.set(_normMac(key), now + CONN_YIELD_HOLD_MS);
      if (hold.size > 200) hold.delete(hold.keys().next().value);
      _safeNativeCall(pl, 'disconnectDevice', { deviceId: key }).catch(function() {});
      n++;
    };
    // (1) intentos con contactos «por estar cerca» (sin mensajes esperando ni el chat abierto)
    Array.from(self._deviceStates.entries()).forEach(function(e) {
      var key = e[0], st = e[1];
      if (/^(lan|net|wd)/i.test(key) || st.state !== BLE_STATES.CONNECTING || st.role !== 'client') return;
      if (now - (st.timestamp || now) < CONN_YIELD_MIN_MS) return;
      var nx = _normId(self._macToNexoId.get(_normMac(key)) || self._macToNexoId.get(key) || (self.connectedDevices.get(key) || {}).deviceUUID || '');
      if (nx && (nx === forNx || self._connUrgent(nx))) return;
      cancel(key);
      self._setDeviceState(key, BLE_STATES.DISCONNECTED);
      self.connectedDevices.delete(key);
    });
    // (2) conexiones de paso (Jump, «quién es») que aún no llegaron a abrirse
    var relay = self.relay;
    if (relay && relay.transient && typeof relay._isReady === 'function') Array.from(relay.transient.entries()).forEach(function(e) {
      var t = e[1];
      if (!t || !t.deviceId || relay._isReady(t.deviceId) || now - (t.since || now) < CONN_YIELD_MIN_MS) return;
      relay.transient.delete(e[0]);
      if (relay._connecting && typeof relay._connecting.delete === 'function') relay._connecting.delete(e[0]);
      cancel(t.deviceId);
    });
    if (n && now - (self._connYieldSaid || 0) > 30000) {
      self._connYieldSaid = now;
      console.log('[BT] Paso libre: ' + n + ' intento(s) de conexión sin prisa ceden el turno a ' + (forNx || 'quien el usuario está agregando') + ' (mensajes esperando o chat abierto)'); // i18n-ok: registro
    }
    return n;
  },
  // Antes de pedir una conexión (ble_connections._autoConnectGATT): tope de enlaces y prioridades (3276) y paso libre en la cola (3284):
  // quien tiene prisa pasa primero; quien no la tiene y acaba de ceder el paso espera su rato. Devuelve si se puede conectar ya.
  _linkGo(deviceId, device, opts) {
    var self = this, nx = self._btPauseKey(deviceId, device), urgent = self._connUrgent(nx, opts);
    if (!urgent && self._connYielded(deviceId)) return false;
    if (!self._linkRoom({ nx: nx, manual: !!(opts && opts.manual), why: opts && opts.why })) return false;
    if (urgent) self._connYield(nx);
    return true;
  },
  // Los enlaces Bluetooth que hay (abiertos o conectando), con lo que hace falta para decidir
  _linkList() {
    var self = this, now = Date.now(), out = [], contacts = {};
    try { (self.getBLEContacts() || []).forEach(function(c) { var nx = _normId(c && (c.nexoId || c.deviceUUID)); if (nx) contacts[nx] = 1; }); } catch (e) {}
    var activeNx = _normId(self._activeChatDeviceId || ''), activeMac = self._activeChatDeviceIdNative ? _normMac(self._activeChatDeviceIdNative) : '';
    self._deviceStates.forEach(function(st, key) {
      if (/^(lan|net|wd)/i.test(key)) return;
      var live = st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY, conn = st.state === BLE_STATES.CONNECTING || st.state === BLE_STATES.CONNECTED;
      if (!live && !conn) return;
      var nx = _normId(self._macToNexoId.get(key) || '');
      var opened = st.openedAt || st.timestamp || 0;
      out.push({
        key: key, nx: nx, role: st.role || '', contact: !!(nx && contacts[nx]),
        pending: self._linkPending(nx), chat: !!(nx && nx === activeNx) || (!!activeMac && _normMac(key) === activeMac),
        busy: !!(typeof self._hasActiveFileTransfer === 'function' && self._hasActiveFileTransfer(key)) || !!(self.calls && self.calls.call && nx && _normId(self.calls.call.peer || '') === nx),
        fresh: conn || (opened > 0 && now - opened < LINK_FRESH_MS),
        lastAt: Math.max((self._lastPongTime && self._lastPongTime.get(key)) || 0, opened)
      });
    });
    return out;
  },
  _linkClose(key, why) {
    var self = this, st = self._getDeviceState(key) || {};
    console.log('[BT] Tope de enlaces: se suelta ' + (_normId(self._macToNexoId.get(key) || '') || key) + ' (' + why + ')'); // i18n-ok: registro
    self._linkClosedAt = self._linkClosedAt || new Map();
    self._linkClosedAt.set(_normMac(key), Date.now());
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'disconnectDevice')) _safeNativeCall(self.nativePlugin, 'disconnectDevice', st.role === 'server' ? { deviceId: key, server: true } : { deviceId: key }).catch(function() {});
  },
  // 3277: con «Agregar» abierto (el usuario está buscando gente) las conexiones de paso para saber quién es cada NEXO cercano las
  // reparte el relevo con su propio tope y su rotación (ble_relay._transientCap / _closeIdleTransient; regla del dueño 11-11: «todo
  // NEXO cercano sale al instante»): el gestor no las frena ni el repaso las suelta. (Frenarlas en 5 dejaba la rotación parada:
  // el relevo solo suelta al que ya se identificó cuando llega a SU tope, 6, y con nueve NEXO cerca el sexto no salía nunca.)
  _linkAddOpen() { return Date.now() < (this._visibleUntil || 0); },
  /**
   * Antes de abrir un enlace: ¿hay sitio? Si quien pide tiene prioridad y no lo hay, desaloja. want: { nx, manual, why, hop }.
   * Devuelve true si se puede conectar ya.
   */
  _linkRoom(want) {
    var self = this;
    if (want && want.hop && self._linkAddOpen()) return true;
    if (want && want.hop && (self._connUrgentUntil || 0) > Date.now()) return false; // 3284: se está abriendo el enlace de alguien con prisa
    var nx = _normId((want && want.nx) || ''), links = self._linkList(), o = self._linkOpts();
    var isContact = false;
    try { isContact = !!nx && (self.getBLEContacts() || []).some(function(c) { return _normId(c && (c.nexoId || c.deviceUUID)) === nx; }); } catch (e) {}
    var w = { contact: isContact && !(want && want.hop), manual: !!(want && want.manual),
      pending: isContact && (self._linkPending(nx) || (want && want.why === 'pendientes')), chat: isContact && nx === _normId(self._activeChatDeviceId || '') };
    if (!w.contact) o.waiting = !!(self._linkWaitUntil && self._linkWaitUntil > Date.now());
    var p = linkPlan(links, w, o);
    if (!p.allow) {
      if (w.contact && (w.pending || w.chat)) self._linkWaitUntil = Date.now() + 30000; // nadie de paso mientras este espera
      var k = nx || 'paso', said = self._linkSaid || (self._linkSaid = new Map());
      if (Date.now() - (said.get(k) || 0) > 60000) { said.set(k, Date.now()); if (said.size > 300) said.clear(); console.log('[BT] Tope de enlaces (' + links.length + '/' + o.cap + '): ' + (nx || 'conexión de paso') + ' sin enlace por ahora: ' + p.why); } // i18n-ok: registro
      return false;
    }
    p.close.forEach(function(key) { self._linkClose(key, 'hace sitio a ' + (nx || 'otro') + (w.pending ? ', que tiene mensajes esperando' : w.chat ? ', con el chat abierto' : '')); }); // i18n-ok: registro
    return true;
  },
  // Repaso (vigilante): por encima del tope o con contactos callados de sobra, se sueltan
  _linkTrimTick() {
    var self = this;
    if (self._linkAddOpen()) return 0;
    var links = self._linkList(), o = self._linkOpts();
    if (links.length < o.cap - 1) return 0;
    var out = linkTrim(links, o);
    out.forEach(function(key) { self._linkClose(key, links.length > o.cap ? 'por encima del tope' : 'callado más de 2 min y sobran'); }); // i18n-ok: registro
    return out.length;
  }
};
