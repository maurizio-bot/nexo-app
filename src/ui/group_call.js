/**
 * group_call.js v1.0 (build 2839+, pedido del dueño: «llamadas y videollamadas en grupo»). FASE 1 = AUDIO (malla).
 *
 * Sin servidor: cada participante mantiene un TRAMO (leg) con cada OTRO participante. Manda su voz a cada uno y mezcla
 * localmente lo que recibe (la mezcla es casi gratis: en Web Audio cada tramo decodificado suma al mismo destino). Grupo
 * chico (≤ GMAX_AUDIO) porque la malla crece como N²; salas grandes exigirían un servidor (rompe el modelo P2P).
 *
 * Reusa el transporte 1-a-1: por tramo, solo enlace DIRECTO (Wi-Fi/Bluetooth, como calls.js; nada de Jump/internet: el
 * retraso no sirve para hablar) y los paquetes de voz van como control `{type:'vf', c:<id del tramo>, s, d}` (los enruta
 * ble_messages.js a onFrame). No toca calls.js (las llamadas 1-a-1 siguen igual).
 *
 * Señalización de grupo (cifrada E2E como cualquier mensaje; silenciosa salvo la invitación):
 *   { type:'nexo_gcall', op, gid, from, to, roster:[nx…], k(clave de grupo, en offer/invite), co(codecs), v, ts }
 *   op: 'invite' (te invito al grupo), 'offer'/'accept' (abrir el tramo de un par), 'leave' (me voy), 'end' (fin).
 * Clave de grupo ÚNICA (la crea quien inicia, viaja cifrada en invite/offer); el AAD de cada paquete incluye el emisor,
 * así una voz de B→A no se puede replicar como si fuera de C. Por par, el NEXO ID MENOR manda el 'offer' (el otro acepta),
 * para no duplicar el tramo (misma idea que el «cruce» de calls.js).
 *
 * Esta capa es agnóstica de los medios: `mediaHub` (se inyecta; call_group_media.js en la build de medios) captura el
 * micrófono UNA vez y entrega un decodificador/mezclador por tramo. Aquí va la señalización, los tramos y el enrutado.
 */

import { t } from './i18n.js';

var GMAX_AUDIO = 5;          // tope de participantes en audio (malla N²; ≤5 es cómodo)
var GRING_MS = 45000;        // invitación sin contestar
var GWEAK_MS = 4000;         // #130 (dueño 31-10): un tramo sin voz > esto → «Reconectando…» (como la 1-a-1), sin cerrarlo
var GSILENCE_MS = 15000;     // un tramo sin recibir nada en 15 s → se cierra (los demás siguen); como el corte 1-a-1
var GDEAD_MS = 180000;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }
function _hex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

export function parseGroupCallSignal(content) {
  if (typeof content !== 'string' || content.indexOf('"nexo_gcall"') < 0) return null;
  try {
    var o = JSON.parse(content);
    if (!o || o.type !== 'nexo_gcall' || typeof o.gid !== 'string' || !/^[a-z0-9]{6,40}$/.test(o.gid)) return null;
    if (!/^(invite|offer|accept|leave|end)$/.test(o.op || '')) return null;
    return o;
  } catch (e) { return null; }
}

export class GroupCall {
  constructor(ble, mediaHubFactory) {
    this.ble = ble;
    this.mediaHubFactory = mediaHubFactory; // (opts) => hub de medios (micrófono compartido + mezcla); se inyecta
    this.gc = null;                         // { gid, dir, state, key, cryptoKey, video, legs:Map<nx,leg>, roster:Set, startedAt }
    this._dead = new Map();
  }

  _markDead(gid) { var now = Date.now(), d = this._dead; d.set(gid, now); d.forEach(function(t, k) { if (now - t > GDEAD_MS) d.delete(k); }); }
  _nidSelf() { var b = this.ble; return _nid(b && (b.localNexoId || (b.getLocalNexoId && b.getLocalNexoId()))); }
  state() {
    var g = this.gc; if (!g) return null;
    var legs = []; g.legs.forEach(function(l, nx) { legs.push({ nx: nx, state: l.state, talking: !!l.talking, reconnecting: !!l.reconnecting }); });
    return { gid: g.gid, dir: g.dir, state: g.state, video: !!g.video, legs: legs, members: Array.from(g.roster), chatId: g.chatId || '' };
  }
  _set(o) { if (!this.gc) return; if (o) Object.assign(this.gc, o); _emit('nexo:gcall', this.state()); }

  _importKey(hex) { return crypto.subtle.importKey('raw', _fromHexGC(hex), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }

  // ¿Hay enlace directo con un par? (reusa la lógica 1-a-1 de calls si está, si no un fallback mínimo)
  _link(nx, preferBle) {
    var c = this.ble && this.ble.calls;
    if (c && typeof c._link === 'function') return c._link(nx, preferBle);
    var ble = this.ble;
    var bt = ble && typeof ble._bleReadyFor === 'function' ? ble._bleReadyFor(nx) : null;
    var q = ble && ble.lan && typeof ble.lan.quality === 'function' ? ble.lan.quality(nx) : null;
    if (q && q.up && ble.lan.canReach(nx) && !(preferBle && bt)) return 'lan:' + nx;
    return bt;
  }

  // Un tramo nuevo (par nx) dentro de la llamada de grupo. El id del tramo es DETERMINISTA por par (los dos lados
  // calculan el mismo: gid~<nx menor>-<nx mayor>) → el paquete `vf` que manda uno lo reconoce el otro (sin intercambiar
  // ids). La dirección la distingue el AAD (lleva el emisor), no el id.
  _leg(nx) {
    var g = this.gc; if (!g) return null;
    var l = g.legs.get(nx);
    if (!l) { var pair = [this._nidSelf(), nx].sort().join('-'); l = { nx: nx, state: 'new', id: g.gid + '~' + pair, sendSeq: 0, lastRx: 0, seen: null }; g.legs.set(nx, l); }
    return l;
  }

  // Iniciar una llamada de grupo con una lista de contactos (members: [nexoId]). video reservado para la Fase 2.
  // chatId (opcional): el id del chat de grupo desde el que se llama, para volver a él si la llamada se corta (#130 dueño).
  start(members, video, chatId) {
    var self = this, me = self._nidSelf();
    if (self.gc) return Promise.reject(new Error(t('grp_call_busy', 'Ya hay una llamada en curso')));
    var list = (members || []).map(_nid).filter(function(x) { return x && x !== me; });
    list = list.filter(function(x, i) { return list.indexOf(x) === i; }); // sin repetidos
    if (!list.length) return Promise.reject(new Error(t('grp_call_need_one', 'Hace falta al menos un contacto')));
    if (list.length + 1 > GMAX_AUDIO) return Promise.reject(new Error(t('grp_max_a', 'Máximo ') + GMAX_AUDIO + t('grp_max_call', ' en una llamada de grupo')));
    var gid = 'gc' + Date.now().toString(36) + _hex(4), key = _hex(32);
    var roster = new Set([me].concat(list));
    self.gc = { gid: gid, dir: 'out', state: 'calling', key: key, video: !!video, legs: new Map(), roster: roster, startedAt: 0, createdAt: Date.now(), chatId: _nid(chatId) || '' };
    list.forEach(function(nx) { self._leg(nx).state = 'inviting'; });
    _emit('nexo:gcall', self.state());
    self._ringTimer = setTimeout(function() {
      // nadie entró en 45 s → se cancela
      if (self.gc && self.gc.gid === gid && self.gc.state === 'calling') self._finish('unanswered');
    }, window.NEXO_GCALL_RING_MS || GRING_MS);
    return self._importKey(key).then(function(k) {
      if (!self.gc || self.gc.gid !== gid) return;
      self.gc.cryptoKey = k;
      // invitar a cada miembro con el roster y la clave de grupo
      list.forEach(function(nx) { self._signal(nx, 'invite', { roster: Array.from(roster), k: key, co: self._codecs(), v: video ? 1 : 0 }); });
    });
  }

  _codecs() { var c = this.ble && this.ble.calls; return (c && typeof c._codecs === 'function') ? 'opus,ulaw' : 'opus,ulaw'; }

  // Contestar una invitación entrante (dir 'in', state 'ringing')
  accept() {
    var self = this, g = self.gc;
    if (!g || g.dir !== 'in' || g.state !== 'ringing') return;
    clearTimeout(self._ringTimer);
    self._set({ state: 'active' });
    self._begin();
    // abrir tramo con cada OTRO miembro del roster: por par, el NEXO ID menor manda 'offer'
    var me = self._nidSelf();
    g.roster.forEach(function(nx) {
      if (nx === me) return;
      var l = self._leg(nx);
      if (nx === g.host) { self._signal(nx, 'accept', {}); l.state = 'active'; } // al que invitó: aceptar
      else if (me < nx) { self._signal(nx, 'offer', {}); l.state = 'offering'; } // yo inicio ese par
      else l.state = 'waiting'; // el otro iniciará
    });
  }

  reject() { var g = this.gc; if (g && g.dir === 'in' && g.state === 'ringing') { this._signal(g.host, 'leave', {}); this._finish('rejected'); } }

  // Colgar / salir de la llamada de grupo
  hangup() {
    var self = this, g = self.gc; if (!g) return;
    g.roster.forEach(function(nx) { if (nx !== self._nidSelf()) self._signal(nx, 'leave', {}); });
    self._finish('ended');
  }

  _begin() {
    var self = this, g = self.gc; if (!g || g.startedAt) return;
    g.startedAt = Date.now();
    // Micrófono compartido: una captura, un codificador → el paquete codificado va a TODOS los tramos
    if (self.mediaHubFactory) {
      try {
        g.hub = self.mediaHubFactory({
          codecs: 'opus,ulaw', video: !!g.video,
          onPacket: function(bytes) { self._broadcast(bytes); },
        });
        if (g.hub && g.hub.start) Promise.resolve(g.hub.start()).catch(function(e) { console.warn('[GCALL] micrófono: ' + (e && e.message)); });
      } catch (e) { console.warn('[GCALL] sin audio: ' + (e && e.message)); }
    }
    self._watch = setInterval(function() { self._tick(); }, 1000);
  }

  // Vigilante por segundo: cierra tramos mudos (sin tumbar la llamada) y termina si no queda nadie
  _tick() {
    var self = this, g = self.gc; if (!g || g.state !== 'active') return;
    var now = Date.now(), alive = 0, me = self._nidSelf();
    var weak = window.NEXO_GCALL_WEAK_MS || GWEAK_MS, silence = window.NEXO_GCALL_SILENCE_MS || GSILENCE_MS;
    g.legs.forEach(function(l, nx) {
      if (l.state === 'active') {
        var gap = l.lastRx ? now - l.lastRx : 0;
        // #130 (dueño 31-10): un tramo activo que deja de recibir voz muestra «Reconectando…» (como la 1-a-1); a los 15 s
        // sin nada se cierra ESE tramo (los demás siguen). Se deja de contar como vivo.
        if (l.lastRx && gap > silence) { l.state = 'lost'; l.reconnecting = false; }
        else l.reconnecting = !!(l.lastRx && gap > weak);
      } else if (l.reconnecting) l.reconnecting = false;
      if (l.state === 'active' || l.state === 'offering' || l.state === 'waiting') alive++;
    });
    if (alive === 0 && now - g.startedAt > silence) { self._finish('empty'); return; }
    self._set(null);
  }

  // Mandar el paquete de voz (ya codificado) a cada tramo con enlace directo
  _broadcast(bytes) {
    var self = this, g = self.gc; if (!g || g.state !== 'active' || !g.cryptoKey) return;
    g.legs.forEach(function(l, nx) {
      if (l.state !== 'active') return;
      self._sendTo(l, bytes);
    });
  }

  _sendTo(l, bytes) {
    var self = this, g = self.gc, me = self._nidSelf();
    var link = self._link(l.nx);
    if (!link) return; // ese par no tiene camino ahora; su tramo seguirá intentando
    var seq = l.sendSeq++;
    var iv = crypto.getRandomValues(new Uint8Array(12));
    // AAD: gid|emisor|nº → una voz de un par no se puede hacer pasar por otro
    var ad = new TextEncoder().encode(g.gid + '|' + me + '|' + seq);
    crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: ad }, g.cryptoKey, bytes).then(function(ct) {
      var out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
      var pk = { type: 'vf', c: l.id, s: seq, d: _b64GC(out) };
      return self.ble._sendMessageNative(link, JSON.stringify(pk), null);
    }).catch(function() {});
  }

  // Paquete de voz recibido para un tramo (lo enruta ble_messages: busca el tramo por el id del paquete)
  onFrame(p, via) {
    var self = this, g = self.gc;
    if (!g || g.state !== 'active' || typeof p.d !== 'string') return false;
    var leg = null; g.legs.forEach(function(l) { if (l.id === p.c) leg = l; });
    if (!leg || !g.cryptoKey) return false;
    var raw; try { raw = _unb64GC(p.d); } catch (e) { return true; }
    if (raw.length < 29) return true;
    // AAD con el emisor = el par de ese tramo
    var ad = new TextEncoder().encode(g.gid + '|' + leg.nx + '|' + p.s);
    crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: ad }, g.cryptoKey, raw.subarray(12)).then(function(pt) {
      if (self.gc !== g) return;
      var sk = p.s; leg.seen = leg.seen || new Set();
      if (leg.seen.has(sk)) return; leg.seen.add(sk); if (leg.seen.size > 1000) leg.seen.delete(leg.seen.values().next().value);
      leg.lastRx = Date.now();
      if (pt.byteLength <= 2) return; // «sigo aquí» sin voz
      if (g.hub && g.hub.play) g.hub.play(leg.nx, new Uint8Array(pt), p.s); // mezcla: el hub reproduce por tramo
    }).catch(function() {});
    return true;
  }

  _signal(nx, op, extra) {
    var ble = this.ble, g = this.gc;
    var o = Object.assign({ type: 'nexo_gcall', op: op, gid: g && g.gid, from: this._nidSelf(), to: _nid(nx), ts: Date.now() }, extra || {});
    if (!ble || typeof ble.sendChatMessage !== 'function') return Promise.resolve();
    var mid = 'gcs' + _hex(6);
    // la invitación SÍ avisa (llamada entrante); el resto es señalización silenciosa
    if (op !== 'invite') { ble._quietOut = ble._quietOut || new Set(); ble._quietOut.add(mid); }
    else { ble._callOut = ble._callOut || new Set(); ble._callOut.add(mid); }
    var p = ble.sendChatMessage(nx, JSON.stringify(o), mid).catch(function(e) { console.warn('[GCALL] señal ' + op + ' no enviada: ' + (e && e.message)); });
    // como en 1-a-1: la invitación también al buzón de relés → despierta al dormido (FCM)
    if (op === 'invite' && ble.net && typeof ble.net.mailboxOk === 'function' && ble.net.mailboxOk(nx) && typeof ble._sendViaNetMailbox === 'function') {
      ble._sendViaNetMailbox(nx, JSON.stringify(o), mid).catch(function() {});
    }
    return p;
  }

  // Señal de grupo recibida
  onSignal(fromNexoId, o) {
    var self = this, nx = _nid(fromNexoId), g = self.gc, me = self._nidSelf();
    if (!o || _nid(o.from) !== nx) return;
    if (o.op === 'invite') {
      if (self._dead.has(o.gid)) return;
      if (g) { self._signal(nx, 'leave', { gid: o.gid }); return; } // ya estoy en otra llamada → ocupado
      if (typeof o.k !== 'string' || !/^[0-9a-f]{64}$/.test(o.k)) return;
      var roster = new Set((o.roster || []).map(_nid)); roster.add(nx); roster.add(me);
      if (roster.size > GMAX_AUDIO) return;
      self.gc = { gid: o.gid, dir: 'in', state: 'ringing', key: o.k, video: o.v === 1, host: nx, legs: new Map(), roster: roster, startedAt: 0, createdAt: Date.now() };
      self._importKey(o.k).then(function(k) { if (self.gc && self.gc.gid === o.gid) { self.gc.cryptoKey = k; _emit('nexo:gcall', self.state()); _emit('nexo:gcallRing', { gid: o.gid, from: nx, members: Array.from(roster) }); } });
      return;
    }
    if (!g || g.gid !== o.gid) {
      if (o.op !== 'leave' && o.op !== 'end') self._signal(nx, 'leave', { gid: o.gid });
      return;
    }
    if (o.op === 'leave') { self._dropLeg(nx); return; }
    if (o.op === 'end') { if (g.dir === 'in' && nx === g.host) self._finish('ended'); else self._dropLeg(nx); return; }
    // El que INICIÓ (dir 'out', 'calling') pasa a activo con la PRIMERA aceptación (arranca su micrófono compartido)
    if (g.dir === 'out' && g.state === 'calling' && o.op === 'accept') { clearTimeout(self._ringTimer); self._set({ state: 'active' }); self._begin(); }
    if (g.state !== 'active') return; // offer/accept solo cuando ya estoy en la llamada
    g.roster.add(nx);
    var l = self._leg(nx);
    if (o.op === 'offer') { // el otro abre el par conmigo → acepto y el tramo queda activo
      self._signal(nx, 'accept', {}); l.state = 'active';
    } else if (o.op === 'accept') {
      l.state = 'active';
    }
    self._set(null);
  }

  _dropLeg(nx) {
    var g = this.gc; if (!g) return;
    var l = g.legs.get(nx); if (l) l.state = 'gone';
    g.roster.delete(nx);
    if (g.hub && g.hub.drop) try { g.hub.drop(nx); } catch (e) {} // #128 inc.2: liberar el decodificador del que se fue
    this._set(null);
    // si no queda nadie vivo, terminar
    var alive = 0, me = this._nidSelf();
    g.legs.forEach(function(ll) { if (ll.state === 'active' || ll.state === 'offering' || ll.state === 'waiting') alive++; });
    if (g.roster.size <= 1 || (g.startedAt && alive === 0)) this._finish('empty');
  }

  _finish(why) {
    var self = this, g = self.gc; if (!g) return;
    clearTimeout(self._ringTimer); clearInterval(self._watch);
    if (g.hub && g.hub.stop) try { g.hub.stop(); } catch (e) {}
    self._markDead(g.gid);
    self.gc = null;
    _emit('nexo:gcall', null);
    // #130 (dueño 31-10): al cortarse, la pantalla da «Volver a llamar» y vuelve al chat del grupo (como la 1-a-1). Se
    // mandan el chat del grupo (si se llamó desde uno) y los miembros, para rehacer la llamada.
    _emit('nexo:gcallEnded', { gid: g.gid, why: why, chatId: g.chatId || '', video: !!g.video, members: Array.from(g.roster) });
    console.log('[GCALL] fin (' + why + ') ' + g.gid);
  }
}

// helpers locales (calls.js no los exporta)
function _fromHexGC(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
function _b64GC(u8) { var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function _unb64GC(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

export function createGroupCall(ble, mediaHubFactory) { return new GroupCall(ble, mediaHubFactory); }
