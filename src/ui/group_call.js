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
import { callPowerStart, callPowerTick, callPowerEnd } from './call_power.js'; // COLA 7: batería y temperatura también en la llamada de grupo

var GMAX_AUDIO = 5;          // tope de participantes en audio (malla N²; ≤5 es cómodo)
var GRING_MS = 45000;        // invitación sin contestar
var GWEAK_MS = 4000;         // #130 (dueño 31-10): un tramo sin voz > esto → «Reconectando…» (como la 1-a-1), sin cerrarlo
var GSILENCE_MS = 15000;     // un tramo sin recibir nada en 15 s → se cierra (los demás siguen); como el corte 1-a-1
var GUPGRADE_MS = 20000;     // #221: la invitación de «Agregar» llega como mucho 20 s después de colgar la 1-a-1 (si no, suena)
var GMISS_MS = 30000;        // #dueño 31-10: una invitación entrante sin contestar en 30 s → perdida («llamada perdida de grupo»)
var GINVITE_MAX_AGE = 60000; // #dueño 31-10: una invitación más vieja que esto (re-entrega del buzón tras colgar/reabrir) se ignora: no re-suena
var GDEAD_MS = 180000;
var GPARK_MS = 5000;         // 3216 (unir llamadas): el «abrir tramo» que llega antes que mi invitación espera esto (luego, «me voy»)
// Dueño 13-11, compartir pantalla parte 2 (llamada de GRUPO): como la 1-a-1 (lado largo 960, ≤ 5 imágenes por segundo). El
// estado («comparto la pantalla») va a cada tramo como paquete cifrado 'c' al empezar/terminar y cada 5 s mientras dure (así
// lo sabe también el que entra tarde); las versiones anteriores lo ignoran.
var GSCREEN_LONG = 960, GSCREEN_FPS = 5, GSTATE_EVERY_MS = 5000, GSTATE_TAIL_MS = 10000;
// 3155: la videollamada de grupo también pasa a la miniatura del sistema (PiP) al irse de la app (como la 1-a-1)
function _pipGC(on) { var p = _plugGC(); if (p && typeof p.setPipActive === 'function') { try { p.setPipActive({ on: !!on }); } catch (e) {} } }
function _plugGC() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
export function gcallMax() { return GMAX_AUDIO; } // 3216: «Unir» (call_merge.js) mira el tope antes de tocar ninguna llamada
function _emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }
function _hex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

export function parseGroupCallSignal(content) {
  if (typeof content !== 'string' || content.indexOf('"nexo_gcall"') < 0) return null;
  try {
    var o = JSON.parse(content);
    if (!o || o.type !== 'nexo_gcall' || typeof o.gid !== 'string' || !/^[a-z0-9]{6,40}$/.test(o.gid)) return null;
    // (3152: «en espera» de #222 —hold/unhold— no pasaba de aquí: llegaba como un mensaje más del chat y el otro nunca lo sabía)
    if (!/^(invite|offer|accept|leave|end|hold|unhold)$/.test(o.op || '')) return null;
    return o;
  } catch (e) { return null; }
}

export class GroupCall {
  constructor(ble, mediaHubFactory) {
    this.ble = ble;
    this.mediaHubFactory = mediaHubFactory; // (opts) => hub de medios (micrófono compartido + mezcla); se inyecta
    this.gc = null;                         // { gid, dir, state, key, cryptoKey, video, legs:Map<nx,leg>, roster:Set, startedAt }
    this._dead = new Map();
    this._invTs = new Map(); // #224: hora (del que invita) de la última invitación que sonó, por llamada
  }

  _markDead(gid) { var now = Date.now(), d = this._dead; d.set(gid, now); d.forEach(function(t, k) { if (now - t > GDEAD_MS) d.delete(k); }); }
  _nidSelf() { var b = this.ble; return _nid(b && (b.localNexoId || (b.getLocalNexoId && b.getLocalNexoId()))); }
  state() {
    var g = this.gc; if (!g) return null;
    var legs = []; g.legs.forEach(function(l, nx) { legs.push({ nx: nx, state: l.state, talking: !!l.talking, reconnecting: !!l.reconnecting, peerScreen: !!l.peerScreen, peerHeld: !!l.peerHeld, peerFront: l.peerFront !== false, peerCam: l.peerCam !== false }); });
    return { gid: g.gid, dir: g.dir, state: g.state, video: !!g.video, cameraOn: !!g.cameraOn, muted: !!g.muted, screen: !!g.screen, held: !!g.held, host: g.host || '', legs: legs, members: Array.from(g.roster), chatId: g.chatId || '',
      adopt: g.adopt ? g.adopt.nx : '', since: (g.adopt && g.adopt.since) || g.startedAt || 0, front: !(g.hub && g.hub.facing) || g.hub.facing() === 'user', // #224
      up: !!g.up }; // 3216: entré desde una llamada 1-a-1 EN CURSO con el que invita (los que llegan después «se unen» a ella)
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
  // #221 (dueño 15-11): opts.upgrade = { nx, id } cuando sale de «Agregar» en una llamada 1-a-1: a ese contacto la invitación le lleva
  // el id de la llamada que teníamos (up) y entra solo, sin volver a contestar (solo si de verdad estaba en esa llamada conmigo).
  // 3216 (dueño 17-11, «Unir»): opts.upgrade también puede ser una LISTA (las dos llamadas que se unen: cada uno lleva el id de la suya)
  // y cada entrada puede decir v (0/1: si SU llamada era de vídeo; su cámara sigue como estaba) y ul (solo si esa llamada sigue viva).
  start(members, video, chatId, opts) {
    var self = this, me = self._nidSelf(), up = opts && opts.upgrade;
    var ups = !up ? [] : Array.isArray(up) ? up : [up];
    if (self.gc) return Promise.reject(new Error(t('grp_call_busy', 'Ya hay una llamada en curso')));
    // #222 (dueño 15-11): máximo dos llamadas a la vez (contando las 1-a-1)
    if (self.ble && typeof self.ble._callCount === 'function' && self.ble._callCount() >= 2) return Promise.reject(new Error(t('call_max_two', 'Ya tienes dos llamadas a la vez. Cuelga una para llamar a alguien más')));
    var list = (members || []).map(_nid).filter(function(x) { return x && x !== me; });
    list = list.filter(function(x, i) { return list.indexOf(x) === i; }); // sin repetidos
    if (!list.length) return Promise.reject(new Error(t('grp_call_need_one', 'Hace falta al menos un contacto')));
    if (list.length + 1 > GMAX_AUDIO) return Promise.reject(new Error(t('grp_max_a', 'Máximo ') + GMAX_AUDIO + t('grp_max_call', ' en una llamada de grupo')));
    var gid = 'gc' + Date.now().toString(36) + _hex(4), key = _hex(32);
    var roster = new Set([me].concat(list));
    self.gc = { gid: gid, dir: 'out', state: 'calling', key: key, video: !!video, legs: new Map(), roster: roster, startedAt: 0, createdAt: Date.now(), chatId: _nid(chatId) || '' };
    list.forEach(function(nx) { self._leg(nx).state = 'inviting'; self._inviteTimeout(nx); });
    var ad = opts && opts.adopt; // #224: la videollamada 1-a-1 que pasa a grupo sin cortar (su captura y la imagen del otro)
    if (ad && ad.media && list.indexOf(_nid(ad.nx)) >= 0) self._adopt(ad);
    _emit('nexo:gcall', self.state());
    self._ringTimer = setTimeout(function() {
      // nadie entró en 45 s → se cancela
      if (self.gc && self.gc.gid === gid && self.gc.state === 'calling') self._finish('unanswered');
    }, window.NEXO_GCALL_RING_MS || GRING_MS);
    return self._importKey(key).then(function(k) {
      if (!self.gc || self.gc.gid !== gid) return;
      self.gc.cryptoKey = k;
      // invitar a cada miembro con el roster y la clave de grupo
      list.forEach(function(nx) {
        var ex = { roster: Array.from(roster), k: key, co: self._codecs(), v: video ? 1 : 0 };
        ups.forEach(function(u) { if (u && _nid(u.nx) === nx && typeof u.id === 'string') self._upEx(ex, u); }); // #221 / 3216
        self._signal(nx, 'invite', ex);
      });
    });
  }

  _upEx(ex, u) { ex.up = u.id; if (u.v === 0 || u.v === 1) ex.v = u.v; if (u.ul) ex.ul = 1; }

  // #224 (dueño 16-11: «cuando hago una videollamada con otro contacto y luego agrego un contacto a la videollamada, no debería quitarse
  // toda la parte de video»): la de grupo hereda lo vivo de la videollamada 1-a-1 (calls.handoff): la cámara sigue abierta, la imagen
  // del otro sigue en su sitio, y su tramo es el primero en la pantalla (arriba). Los medios se montan ya (sin esperar a que entre nadie).
  _adopt(ad) {
    var g = this.gc; if (!g || !ad || !ad.media) return;
    g.adopt = { nx: _nid(ad.nx), media: ad.media, since: ad.startedAt || 0 };
    g.cameraOn = !ad.cameraOff; g.muted = !!ad.muted;
    var l = this._leg(g.adopt.nx); if (l && typeof ad.peerFront === 'boolean') l.peerFront = ad.peerFront;
    this._makeHub();
    if (!(g.hub && g.hub.adopted)) { try { ad.media.stop(); } catch (e) {} g.adopt = null; } // (medios sin herencia: los de siempre)
    _pipGC(true); // 3155: sigue siendo videollamada
  }
  _makeHub() {
    var self = this, g = self.gc; if (!g || g.hub || !self.mediaHubFactory) return;
    try {
      // #138 (dueño 31-10): TODA llamada de grupo es CAPAZ de vídeo. Si es VIDEOLLAMADA, la cámara arranca encendida
      // (cameraStart, el mismo camino probado de la 1-a-1); si es llamada de voz, la cámara empieza apagada y se enciende
      // con el botón (sin re-llamar). El vídeo se difunde por `onVideoPacket`.
      g.hub = self.mediaHubFactory({
        codecs: 'opus,ulaw', video: true, cameraStart: !!g.video, adopt: g.adopt ? { media: g.adopt.media, nx: g.adopt.nx } : null,
        onPacket: function(bytes) { self._broadcast(bytes); },
        onVideoPacket: function(bytes) { self._broadcastVideo(bytes); },
        onNeedKey: function(nx) { self._askKey(nx); }, // #224: la imagen de un tramo se paró: que mande una completa
      });
    } catch (e) { console.warn('[GCALL] sin audio: ' + (e && e.message)); }
  }
  _askKey(nx) { var g = this.gc, l = g && g.legs.get(_nid(nx)); if (l && l.state === 'active') this._sendTo(l, new Uint8Array([1]), 'k'); }
  // Un tramo se abre: imagen completa ya (si no, hasta 5 s sin imagen) y mi estado (cámara, cuál, pantalla)
  _legUp() { var g = this.gc; if (!g) return; if (g.hub && g.hub.requestKey) { try { g.hub.requestKey(); } catch (e) {} } this._sendStateAll(); }
  remoteLive(nx) { var g = this.gc; return !!(g && g.hub && g.hub.remoteLive && g.hub.remoteLive(_nid(nx))); }

  // #224: «Cancelar» en la baldosa de quien todavía suena: deja de sonarle y la llamada sigue con los demás. Si contesta igual (se
  // cruzó con la cancelación), se le dice que se fue.
  cancelInvite(nexoId) {
    var self = this, g = self.gc, nx = _nid(nexoId), l = g && g.legs.get(nx);
    if (!l || l.state !== 'inviting') return false;
    self._signal(nx, 'leave', {});
    l.state = 'cancelled'; g.roster.delete(nx);
    (g.cancelled = g.cancelled || new Set()).add(nx);
    console.log('[GCALL] Invitación a ' + nx + ' cancelada');
    self._set(null);
    if (g.roster.size <= 1 || !self._alive(true)) self._finish('empty');
    return true;
  }
  // ¿Cuántos tramos siguen (o pueden seguir)? (con invitados: también los que aún suenan). 3152 (diagnóstico S23 16-11: la de
  // grupo de «Agregar» quedó viva sin nadie —el que invitó colgó y el tercero nunca contestó— y volvió sola, con la cámara, al colgar
  // la siguiente llamada): si el que invitó ya se fue, los que todavía no entraron no me retienen en la llamada.
  _alive(withInvited) {
    var g = this.gc, n = 0; if (!g) return 0;
    var hostGone = g.dir === 'in' && !!g.host && !g.roster.has(g.host);
    g.legs.forEach(function(l) { if (l.state === 'active' || (!hostGone && (l.state === 'offering' || l.state === 'waiting')) || (withInvited && l.state === 'inviting')) n++; });
    return n;
  }
  // #224: me voy sin haber entrado (rechazo, no contesté, el que invitó colgó): se lo digo a TODOS, no solo al que invitó (los que
  // ya estaban dentro me tenían como «llamando» y se quedaban esperándome)
  _leaveAll() { var self = this, g = self.gc, me = self._nidSelf(); if (g) g.roster.forEach(function(nx) { if (nx !== me) self._signal(nx, 'leave', {}); }); }

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
      if (nx === g.host) { self._signal(nx, 'accept', {}); l.state = 'active'; self._legUp(); } // al que invitó: aceptar
      else if (g.earlyOffers && g.earlyOffers.has(nx)) { self._signal(nx, 'accept', {}); l.state = 'active'; self._legUp(); } // 3106: me lo abrió mientras sonaba
      // #130 (dueño 31-10): si entro TARDE (me agregaron a una llamada ya en curso, late:1), abro el tramo con TODOS (los que
      // ya estaban no van a iniciar hacia mí); si no, la regla normal: el NEXO ID menor manda 'offer' y el otro espera.
      else if (g.late || me < nx) { self._signal(nx, 'offer', {}); l.state = 'offering'; self._inviteTimeout(nx); }
      else { l.state = 'waiting'; self._inviteTimeout(nx); } // el otro iniciará (#224: si no entra en 45 s, «No contestó», como en el que invita)
    });
  }

  reject() { var g = this.gc; if (g && g.dir === 'in' && g.state === 'ringing') { this._leaveAll(); this._finish('rejected'); } }

  // #dueño 31-10: silenciar/activar MI micrófono en la llamada de grupo (el botón, como en la 1-a-1). No afecta a lo que
  // se oye de los demás; solo deja de mandar mi voz. El hub de medios comparte una sola captura, así que silencia todo.
  mute(on) {
    var g = this.gc; if (!g) return;
    g.muted = !!on;
    if (g.hub && g.hub.mute) { try { g.hub.mute(!!on || !!g.held); } catch (e) {} }
    this._set(null);
  }

  // #222 (dueño 15-11): la llamada de grupo EN ESPERA mientras hablo en otra (al contestar la otra, sola; reanudar con el botón).
  // Mi micrófono manda silencio (los tramos siguen vivos), no oigo ni veo a nadie, mi imagen no sale y los demás ven «en espera».
  hold(on) {
    var self = this, g = self.gc; if (!g || g.state !== 'active' || !!g.held === !!on) return;
    if (!on && self.ble && typeof self.ble._holdOthers === 'function') self.ble._holdOthers(self);
    g.held = !!on;
    if (g.hub && g.hub.mute) { try { g.hub.mute(!!on || !!g.muted); } catch (e) {} }
    g.legs.forEach(function(l, nx) { if (l.state === 'active') self._signal(nx, on ? 'hold' : 'unhold', {}); });
    console.log('[GCALL] ' + (on ? 'En espera (otra llamada)' : 'Reanudada'));
    self._set(null);
  }

  // #138 (dueño 31-10): encender/apagar MI cámara en la llamada de grupo SIN re-llamar (la interfaz ya es de vídeo). El hub
  // comparte una sola captura; al encenderla, mi imagen se difunde a los tramos (por Wi-Fi) y los demás la ven.
  camera(on) {
    var g = this.gc; if (!g) return;
    g.cameraOn = !!on;
    if (on) _pipGC(true); // 3155
    if (g.hub && g.hub.camera) { try { g.hub.camera(!!on); } catch (e) {} }
    this._set(null);
  }

  // Dueño 13-11: COMPARTIR PANTALLA en la llamada de GRUPO (parte 2). Igual que la 1-a-1: el nativo pide el permiso de
  // Android y manda ~5 imágenes por segundo (onScreenFrame); la captura compartida (hub) las codifica EN LUGAR de la cámara y
  // la malla las reparte a cada tramo por su camino de vídeo (Wi-Fi). Los demás saben que es una pantalla (estado 'c').
  shareScreen(on) {
    var self = this, g = this.gc, pl = _plugGC();
    if (!g || g.state !== 'active' || !g.hub) return Promise.resolve(false);
    if (!on) { self._screenStop('detenido'); return Promise.resolve(false); }
    if (g.screen) return Promise.resolve(true);
    if (!pl || typeof pl.screenShareStart !== 'function') return Promise.reject(Object.assign(new Error('Este teléfono no puede compartir la pantalla'), { code: 'SCREEN_NA' }));
    self._screenHooks(pl);
    return pl.screenShareStart({ maxLong: GSCREEN_LONG, fps: GSCREEN_FPS }).then(function(r) {
      if (!r || !r.granted) return false;
      if (self.gc !== g || g.state !== 'active') { try { pl.screenShareStop(); } catch (e) {} return false; }
      g.screen = true;
      if (g.hub && g.hub.screen) { try { g.hub.screen(true); } catch (e) {} }
      var n = 0; g.legs.forEach(function(l) { if (l.state === 'active') n++; });
      console.log('[GCALL] Compartiendo la pantalla con el grupo (' + n + ' tramo(s))');
      self._set(null); self._sendStateAll();
      return true;
    });
  }
  _screenHooks(pl) {
    var self = this;
    if (self._scrHooked || !pl || typeof pl.addListener !== 'function') return;
    self._scrHooked = true;
    pl.addListener('onScreenFrame', function(ev) { var g = self.gc; if (g && g.screen && g.hub && g.hub.screenFrame && ev && typeof ev.d === 'string') g.hub.screenFrame(ev.d, Number(ev.w) || 0, Number(ev.h) || 0); });
    pl.addListener('onScreenShareStopped', function() { var g = self.gc; if (g && g.screen) self._screenStop('parada por el sistema', true); });
  }
  _screenStop(why, byNative) {
    var g = this.gc; if (!g || !g.screen) return;
    g.screen = false; g._scrOffUntil = Date.now() + GSTATE_TAIL_MS;
    var pl = _plugGC();
    if (!byNative && pl && typeof pl.screenShareStop === 'function') { try { pl.screenShareStop(); } catch (e) {} }
    if (g.hub && g.hub.screen) { try { g.hub.screen(false); } catch (e) {} }
    console.log('[GCALL] Dejo de compartir la pantalla (' + why + ')');
    this._set(null); this._sendStateAll();
  }
  // Estado propio a cada tramo activo (cifrado, kind 'c'): ¿comparto la pantalla?, ¿cámara encendida?
  _sendStateAll() {
    var self = this, g = this.gc; if (!g || g.state !== 'active' || !g.cryptoKey) return;
    g._stAt = Date.now();
    var bytes = new TextEncoder().encode(JSON.stringify({ scr: !!g.screen, cam: !!g.cameraOn, front: !(g.hub && g.hub.facing) || g.hub.facing() === 'user' })); // #224: front
    g.legs.forEach(function(l) { if (l.state === 'active') self._sendTo(l, bytes, 'c'); });
  }

  // Cámara de delante / de detrás (igual que la 1-a-1); devuelve una promesa con la orientación final.
  flip() {
    var self = this, g = this.gc; if (!g || !g.hub || !g.hub.flip) return Promise.resolve();
    var done = function(f) { if (self.gc === g) { self._sendStateAll(); self._set(null); } return f; }; // #224: los demás, con o sin espejo
    try { return Promise.resolve(g.hub.flip()).then(done, function() {}); } catch (e) { return Promise.resolve(); }
  }

  // #138: elementos de vídeo para la rejilla (los coloca groupcall_ui.js): mi vista propia y la imagen de cada tramo.
  localVideoEl() { var g = this.gc; return (g && g.hub && g.hub.localVideo) ? g.hub.localVideo() : null; }
  remoteVideoEl(nx) { var g = this.gc; return (g && g.hub && g.hub.remoteCanvas) ? g.hub.remoteCanvas(_nid(nx)) : null; }

  // #130 (dueño 31-10): AGREGAR un contacto a una llamada de grupo EN CURSO. Lo puede hacer cualquier participante. Al nuevo
  // se le invita con el roster y la clave de grupo actuales y la marca late:1 (para que, al entrar, abra su tramo con TODOS
  // los que ya estaban; ellos no van a iniciar hacia él). Los que ya estaban abren su tramo con el nuevo al llegarles su
  // oferta (onSignal 'offer' ya lo hace cuando la llamada está activa).
  // 3216 («Unir»): opts = { up, v } cuando el que entra es el de mi OTRA llamada (sonando o en curso): entra solo, como en #221.
  addMember(nexoId, opts) {
    var self = this, g = self.gc, nx = _nid(nexoId), me = self._nidSelf();
    if (!g || g.state !== 'active') return Promise.reject(new Error(t('grp_call_none', 'No hay una llamada de grupo en curso')));
    if (!nx || nx === me) return Promise.reject(new Error(t('grp_call_need_one', 'Hace falta al menos un contacto')));
    if (g.roster.has(nx)) return Promise.reject(new Error(t('grp_already_in', 'Ya está en la llamada')));
    if (g.roster.size + 1 > GMAX_AUDIO) return Promise.reject(new Error(t('grp_max_a', 'Máximo ') + GMAX_AUDIO + t('grp_max_call', ' en una llamada de grupo')));
    g.roster.add(nx);
    if (g.cancelled) g.cancelled.delete(nx); // #224: se le había cancelado y se le vuelve a agregar
    self._leg(nx).state = 'inviting';
    self._inviteTimeout(nx);
    self._set(null);
    var ex = { roster: Array.from(g.roster), k: g.key, co: self._codecs(), v: g.video ? 1 : 0, late: 1 };
    if (opts && typeof opts.up === 'string') self._upEx(ex, { id: opts.up, v: opts.v, ul: 1 });
    return self._signal(nx, 'invite', ex);
  }

  // Colgar / salir de la llamada de grupo
  hangup() {
    var self = this, g = self.gc; if (!g) return;
    g.roster.forEach(function(nx) { if (nx !== self._nidSelf()) self._signal(nx, 'leave', {}); });
    self._finish('ended');
  }

  _begin() {
    var self = this, g = self.gc; if (!g || g.startedAt) return;
    g.startedAt = Date.now();
    try { callPowerStart(g, 'de grupo'); } catch (eP) {} // COLA 7: batería y temperatura como en la 1 a 1
    if (self.ble && typeof self.ble._holdOthers === 'function') { try { self.ble._holdOthers(self); } catch (e) {} } // #222: la otra, en espera
    // Micrófono compartido: una captura, un codificador → el paquete codificado va a TODOS los tramos
    if (!g.adopt) g.cameraOn = !!g.video; // (#224: la heredada sigue como estaba)
    if (g.video || g.cameraOn) _pipGC(true); // 3155
    self._makeHub();
    if (g.hub && g.hub.start && !g.hub.adopted) { try { Promise.resolve(g.hub.start()).catch(function(e) { console.warn('[GCALL] micrófono: ' + (e && e.message)); }); } catch (e) { console.warn('[GCALL] sin audio: ' + (e && e.message)); } }
    self._watch = setInterval(function() { self._tick(); }, 1000);
  }

  // Vigilante por segundo: cierra tramos mudos (sin tumbar la llamada) y termina si no queda nadie
  _tick() {
    var self = this, g = self.gc; if (!g || g.state !== 'active') return;
    var now = Date.now(), me = self._nidSelf();
    var weak = window.NEXO_GCALL_WEAK_MS || GWEAK_MS, silence = window.NEXO_GCALL_SILENCE_MS || GSILENCE_MS;
    g.legs.forEach(function(l, nx) {
      if (l.state === 'active') {
        var gap = l.lastRx ? now - l.lastRx : 0;
        // #130 (dueño 31-10): un tramo activo que deja de recibir voz muestra «Reconectando…» (como la 1-a-1); a los 15 s
        // sin nada se cierra ESE tramo (los demás siguen). Se deja de contar como vivo.
        if (l.lastRx && gap > silence) { l.state = 'lost'; l.reconnecting = false; }
        else l.reconnecting = !!(l.lastRx && gap > weak);
      } else if (l.reconnecting) l.reconnecting = false;
    });
    if (!self._alive(false) && now - g.startedAt > silence) { self._finish('empty'); return; }
    // compartir pantalla: el estado se repite cada 5 s mientras comparto (y un rato después de parar), para el que entró tarde
    if ((g.screen || now < (g._scrOffUntil || 0)) && now - (g._stAt || 0) >= GSTATE_EVERY_MS) self._sendStateAll();
    try { callPowerTick(g); } catch (eP) {} // COLA 7
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

  // #138: difundir MI imagen (vídeo ya codificado) a cada tramo activo (como _broadcast pero marcado kind 'v')
  _broadcastVideo(bytes) {
    var self = this, g = self.gc; if (!g || g.state !== 'active' || !g.cryptoKey) return;
    if (g.held) return; // #222: en espera, mi imagen no sale
    g.legs.forEach(function(l) { if (l.state === 'active') self._sendTo(l, bytes, 'v'); });
  }

  _sendTo(l, bytes, kind) {
    var self = this, g = self.gc, me = self._nidSelf();
    var link = self._link(l.nx);
    // #dueño 31-10: la VOZ va SOLO por enlace DIRECTO (Bluetooth o misma Wi-Fi). Por los relés de internet (net:) el retraso
    // es de segundos: no sirve para hablar y solo inunda el relé. Sin enlace directo, el tramo espera a que vuelva (no hay voz).
    if (!link || String(link).indexOf('net:') === 0) return;
    // #138: el VÍDEO (kind 'v', ~300 kb/s) solo por Wi-Fi (lan:); por Bluetooth no cabe (igual que la videollamada 1-a-1).
    if (kind === 'v' && String(link).indexOf('lan:') !== 0) return;
    // nº de secuencia propio por tipo: la voz y el vídeo no comparten contador (ni la marca anti-repetición del receptor)
    var seq = kind === 'v' ? (l.sendVSeq = (l.sendVSeq || 0) + 1) : kind === 'c' || kind === 'k' ? (l.sendCSeq = (l.sendCSeq || 0) + 1) : l.sendSeq++;
    var iv = crypto.getRandomValues(new Uint8Array(12));
    // AAD: gid|emisor|<tipo>nº → una voz/imagen de un par no se puede hacer pasar por otro (voz = tipo vacío, compat. 2852)
    var ad = new TextEncoder().encode(g.gid + '|' + me + '|' + (kind || '') + seq);
    crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: ad }, g.cryptoKey, bytes).then(function(ct) {
      var out = new Uint8Array(12 + ct.byteLength); out.set(iv, 0); out.set(new Uint8Array(ct), 12);
      var pk = { type: 'vf', c: l.id, s: seq, d: _b64GC(out) };
      if (kind) pk.k = kind;
      return self.ble._sendMessageNative(link, JSON.stringify(pk), null);
    }).catch(function() {});
  }

  // Paquete de voz recibido para un tramo (lo enruta ble_messages: busca el tramo por el id del paquete)
  onFrame(p, via) {
    var self = this, g = self.gc;
    if (!g || g.state !== 'active' || typeof p.d !== 'string') return false;
    var leg = null; g.legs.forEach(function(l) { if (l.id === p.c) leg = l; });
    if (!leg || !g.cryptoKey) return false;
    var k = p.k || '';
    if (k && k !== 'v' && k !== 'c' && k !== 'k') return true; // en grupo: voz, vídeo ('v'), estado ('c') y «manda una imagen completa» ('k', #224)
    var raw; try { raw = _unb64GC(p.d); } catch (e) { return true; }
    if (raw.length < 29) return true;
    // AAD con el emisor = el par de ese tramo y el tipo (voz = vacío; vídeo = 'v')
    var ad = new TextEncoder().encode(g.gid + '|' + leg.nx + '|' + k + p.s);
    crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: ad }, g.cryptoKey, raw.subarray(12)).then(function(pt) {
      if (self.gc !== g) return;
      var sk = (k || 'a') + p.s; leg.seen = leg.seen || new Set(); // voz y vídeo numeran aparte: la marca incluye el tipo
      if (leg.seen.has(sk)) return; leg.seen.add(sk); if (leg.seen.size > 1000) leg.seen.delete(leg.seen.values().next().value);
      leg.lastRx = Date.now();
      if (g.held && k !== 'c') return; // #222: en espera: ni voz ni imagen (el tramo sigue vivo)
      if (k === 'k') { if (g.hub && g.hub.requestKey) g.hub.requestKey(); return; } // #224
      if (k === 'v') { if (g.hub && g.hub.playVideo) g.hub.playVideo(leg.nx, new Uint8Array(pt)); return; } // imagen del par
      if (k === 'c') { // estado del par: ¿comparte su pantalla? (para verla entera y sin espejo)
        var o = null; try { o = JSON.parse(new TextDecoder().decode(pt)); } catch (e) {}
        var scr = !!(o && o.scr === true);
        if (o && typeof o.front === 'boolean' && o.front !== (leg.peerFront !== false)) { leg.peerFront = o.front; self._set(null); } // #224
        if (o && typeof o.cam === 'boolean' && o.cam !== (leg.peerCam !== false)) { leg.peerCam = o.cam; self._set(null); }
        if (scr !== !!leg.peerScreen) { leg.peerScreen = scr; console.log('[GCALL] ' + leg.nx + (scr ? ' comparte su pantalla' : ' dejó de compartir su pantalla')); self._set(null); }
        return;
      }
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
      // #224: una llamada que ya terminó aquí no vuelve a sonar (re-entregas del buzón)… salvo que me inviten OTRA VEZ a ella (le
      // cancelaron la invitación y lo vuelven a agregar): una invitación posterior a la última que sonó
      if (self._dead.has(o.gid) && !(o.late === 1 && Number(o.ts) > (self._invTs.get(o.gid) || Infinity))) return;
      // #dueño 31-10: una invitación VIEJA (re-entrega del buzón de relés después de colgar, o al reabrir la app que perdió
      // la memoria de llamadas terminadas) NO debe volver a sonar. Una invitación de verdad llega al instante.
      if (o.ts && Date.now() - Number(o.ts) > GINVITE_MAX_AGE) return;
      if (g) { if (g.gid === o.gid) return; self._signal(nx, 'leave', { gid: o.gid }); return; } // ya en otra llamada → ocupado (si es la MISMA, es re-entrega: ignorar, no avisar «leave»)
      var upg = o.up ? self._upgradeFrom(nx, o.up, o.ul === 1) : null; // #221: viene de «Agregar» en la llamada que tenía con él (3216: o de «Unir»)
      // #220 (dueño 15-11: «dos llamadas al mismo tiempo y nada más»): con dos 1-a-1 en curso, la de grupo no entra (ocupado)
      var b1 = self.ble && self.ble.calls && self.ble.calls.call, b2 = self.ble && self.ble.calls2 && self.ble.calls2.call;
      if (b1 && b2 && !(upg && upg.live)) { self._signal(nx, 'leave', { gid: o.gid }); return; }
      if (typeof o.k !== 'string' || !/^[0-9a-f]{64}$/.test(o.k)) return;
      var roster = new Set((o.roster || []).map(_nid)); roster.add(nx); roster.add(me);
      if (roster.size > GMAX_AUDIO) return;
      // 3216: el que entra solo (#221/«Unir») sigue con la cámara como la tenía en SU llamada: la invitación no puede encenderla si era de voz
      self.gc = { gid: o.gid, dir: 'in', state: 'ringing', key: o.k, video: o.v === 1 && !(upg && upg.video === false), host: nx, legs: new Map(), roster: roster, startedAt: 0, createdAt: Date.now(), late: o.late === 1,
        up: !!(upg && upg.wasActive) };
      self._unpark(o.gid);
      self._invTs.set(o.gid, Number(o.ts) || 0); if (self._invTs.size > 50) self._invTs.delete(self._invTs.keys().next().value);
      // #dueño 31-10: si no se contesta en 30 s, la entrante se da por PERDIDA (deja de sonar, queda «llamada perdida de
      // grupo»); los que sí contestaron siguen entre ellos.
      clearTimeout(self._ringTimer);
      self._ringTimer = setTimeout(function() { if (self.gc && self.gc.gid === o.gid && self.gc.state === 'ringing') { self._leaveAll(); self._finish('missed'); } }, window.NEXO_GCALL_MISS_MS || GMISS_MS);
      if (upg && upg.live) { // la 1-a-1 que pasa a grupo (él ya colgó la suya)
        // #224: si era videollamada y la de grupo también, la de grupo hereda su captura y la imagen del otro (sin cortar)
        var ad = null;
        if (self.gc.video && typeof upg.lane.handoff === 'function') { try { ad = upg.lane.handoff(); } catch (e) { ad = null; } }
        if (ad && ad.media && _nid(ad.nx) === nx) self._adopt(ad);
        else if (ad && ad.media) { try { ad.media.stop(); } catch (e) {} }
        else { try { upg.lane._finish('merged', false); } catch (e) {} } // 3216: pasa a la de grupo (sin «Llamada terminada» ni «cancelada»)
      }
      self._importKey(o.k).then(function(k) {
        if (!self.gc || self.gc.gid !== o.gid) return;
        self.gc.cryptoKey = k;
        if (upg) { // #221: entra solo (sin sonar ni volver a contestar)
          console.log('[GCALL] Entro solo a la llamada de grupo de ' + nx + ': venía de la llamada con él');
          self.accept();
          return;
        }
        _emit('nexo:gcall', self.state()); _emit('nexo:gcallRing', { gid: o.gid, from: nx, members: Array.from(roster) });
      });
      return;
    }
    if (!g || g.gid !== o.gid) {
      // 3216 («Unir»): los otros dos entran solos casi a la vez y el «abrir tramo» de uno puede llegarle al otro antes que su invitación
      if (o.op === 'offer' && !g && !self._dead.has(o.gid)) { self._park(nx, o.gid); return; }
      if (o.op !== 'leave' && o.op !== 'end') self._signal(nx, 'leave', { gid: o.gid });
      return;
    }
    // #dueño 31-10: si TODAVÍA está sonando (no contesté) y el que invitó se va/cuelga → se cancela para mí (deja de sonar)
    // y queda como «llamada perdida de grupo». Antes se quedaba sonando si el grupo tenía 3+ miembros.
    if ((o.op === 'leave' || o.op === 'end') && g.dir === 'in' && g.state === 'ringing' && nx === g.host) { self._leaveAll(); self._finish('missed'); return; }
    if (o.op === 'leave') { self._dropLeg(nx); return; }
    if (o.op === 'end') { if (g.dir === 'in' && nx === g.host) self._finish('ended'); else self._dropLeg(nx); return; }
    // El que INICIÓ (dir 'out', 'calling') pasa a activo con la PRIMERA aceptación (arranca su micrófono compartido)
    if (g.dir === 'out' && g.state === 'calling' && o.op === 'accept') { clearTimeout(self._ringTimer); self._set({ state: 'active' }); self._begin(); }
    // 3106 (lo destapó #221): un compañero que ya contestó me abre el tramo mientras a mí todavía me suena; antes se perdía y, si yo
    // tenía el NEXO ID mayor, al contestar esperaba un «offer» que ya no iba a llegar: los dos no se oían. Se guarda y se contesta al entrar.
    if (o.op === 'offer' && g.dir === 'in' && g.state === 'ringing' && g.roster.has(nx)) { (g.earlyOffers = g.earlyOffers || new Set()).add(nx); return; }
    if (g.cancelled && g.cancelled.has(nx) && (o.op === 'offer' || o.op === 'accept')) { self._signal(nx, 'leave', {}); return; } // #224: le cancelé la invitación
    if (g.state !== 'active') return; // offer/accept solo cuando ya estoy en la llamada
    if (o.op === 'hold' || o.op === 'unhold') { // #222: el otro puso la llamada de grupo en espera (está en otra)
      var hl = g.legs.get(nx); if (hl) { hl.peerHeld = o.op === 'hold'; hl.lastRx = Date.now(); console.log('[GCALL] ' + nx + (hl.peerHeld ? ' te puso en espera' : ' volvió')); }
      self._set(null); return;
    }
    g.roster.add(nx);
    var l = self._leg(nx);
    var was = l.state;
    if (o.op === 'offer') { // el otro abre el par conmigo → acepto y el tramo queda activo
      self._signal(nx, 'accept', {}); l.state = 'active';
    } else if (o.op === 'accept') {
      l.state = 'active';
    }
    if (was !== 'active' && l.state === 'active') self._legUp(); // #224
    if (g.held && (o.op === 'offer' || o.op === 'accept')) self._signal(nx, 'hold', {}); // el que entra con la llamada en espera
    self._set(null);
  }

  // 3100 (dueño 15-11: «agregué otro dispositivo, nunca le apareció o nunca aceptó, entonces quedó ahí»; S24 14-11 16:15–16:19):
  // la llamada pasa a activa con el primero que contesta y el que no contestaba quedaba «Conectando…» para siempre. Cada invitado
  // tiene los mismos 45 s que la llamada entera: si no entra, «No contestó» y sale (si no queda nadie, la llamada termina).
  // #221: ¿la invitación viene de «Agregar» en una llamada 1-a-1 que tenía de verdad con ese contacto? La que sigue en curso (su
  // «colgar» aún no llegó) o la que terminó hace menos de GUPGRADE_MS. Con cualquier otro id o contacto, suena como siempre.
  // 3216 («Unir», dueño 17-11): también la llamada que YO le estoy haciendo y todavía le suena (él la une a la que tenía: entro sin que
  // conteste). liveOnly (ul en la invitación de «Unir»): solo la que sigue en curso; si ya la colgué, la invitación suena como siempre.
  // video: si ESA llamada era de vídeo (la de grupo no me enciende la cámara si era de voz); wasActive: veníamos hablando.
  _upgradeFrom(nx, id, liveOnly) {
    var b = this.ble, lanes = [b && b.calls, b && b.calls2], now = Date.now();
    for (var i = 0; i < lanes.length; i++) {
      var l = lanes[i]; if (!l) continue;
      var c = l.call;
      if (c && c.id === id && _nid(c.nx) === nx && (c.state === 'active' || (c.state === 'calling' && c.dir === 'out'))) return { live: true, lane: l, video: !!c.video, wasActive: c.state === 'active' };
      var e = l.lastEnded;
      if (!liveOnly && e && e.id === id && _nid(e.nx) === nx && e.active && now - e.at < GUPGRADE_MS) return { live: false, lane: l, video: e.video, wasActive: true };
    }
    return null;
  }

  // 3216: «abrir tramo» de una llamada de grupo cuya invitación aún no me llegó: se guarda GPARK_MS; si llega, se contesta al entrar
  // (como los de 3106); si no, «me voy» (lo de siempre)
  _park(nx, gid) {
    var self = this, p = self._parked = self._parked || new Map(), k = gid + '|' + nx;
    if (p.has(k)) return;
    p.set(k, setTimeout(function() { p.delete(k); if (!self.gc || self.gc.gid !== gid) self._signal(nx, 'leave', { gid: gid }); }, GPARK_MS));
  }
  _unpark(gid) {
    var g = this.gc, p = this._parked; if (!g || !p) return;
    p.forEach(function(tm, k) {
      var i = k.lastIndexOf('|'); if (k.slice(0, i) !== gid) return;
      clearTimeout(tm); p.delete(k);
      var px = k.slice(i + 1); if (g.roster.has(px)) (g.earlyOffers = g.earlyOffers || new Set()).add(px);
    });
  }

  _inviteTimeout(nx) {
    var self = this, g = self.gc; if (!g) return;
    var gid = g.gid;
    setTimeout(function() {
      var gg = self.gc, l = gg && gg.gid === gid && gg.legs.get(nx);
      // (#224: también el que entró y se quedó esperando a uno que nunca llegó —«offering»/«waiting»—)
      if (!l || (l.state !== 'inviting' && l.state !== 'offering' && l.state !== 'waiting') || gg.state !== 'active') return; // sin contestar nadie, la cierra el temporizador general
      l.state = 'noanswer';
      gg.roster.delete(nx);
      console.log('[GCALL] ' + nx + ' no contestó: sale de la llamada');
      self._set(null);
      if (gg.roster.size <= 1 || !self._alive(true)) self._finish('empty');
    }, window.NEXO_GCALL_RING_MS || GRING_MS);
  }

  _dropLeg(nx) {
    var g = this.gc; if (!g) return;
    var l = g.legs.get(nx); if (l) l.state = 'gone';
    g.roster.delete(nx);
    if (g.hub && g.hub.drop) try { g.hub.drop(nx); } catch (e) {} // #128 inc.2: liberar el decodificador del que se fue
    this._set(null);
    // si no queda nadie vivo, terminar
    if (g.roster.size <= 1 || (g.startedAt && !this._alive(false))) this._finish('empty'); // (3152: el que invitó se fue y nadie más entró: fin)
  }

  _finish(why) {
    var self = this, g = self.gc; if (!g) return;
    if (g.screen) self._screenStop('colgó'); // la captura de pantalla no sigue tras colgar
    clearTimeout(self._ringTimer); clearInterval(self._watch);
    if (g.hub && g.hub.stop) try { g.hub.stop(); } catch (e) {}
    self._markDead(g.gid);
    if (g.startedAt) try { callPowerEnd(g, (Date.now() - g.startedAt) / 1000, 'de grupo'); } catch (eP) {} // COLA 7
    self.gc = null;
    var c1 = self.ble && self.ble.calls && self.ble.calls.call; if (!(c1 && c1.video && c1.state === 'active')) _pipGC(false); // 3155
    if (self.ble && typeof self.ble._afterCallRadio === 'function') { try { self.ble._afterCallRadio(); } catch (e) {} } // 3058: sale lo que esperó a colgar
    if (self.ble && typeof self.ble._resumeLoneCall === 'function') { try { self.ble._resumeLoneCall(); } catch (e) {} } // #222: la que quedó en espera vuelve
    _emit('nexo:gcall', null);
    // #130 (dueño 31-10): al cortarse, la pantalla da «Volver a llamar» y vuelve al chat del grupo (como la 1-a-1). Se
    // mandan el chat del grupo (si se llamó desde uno) y los miembros, para rehacer la llamada.
    _emit('nexo:gcallEnded', { gid: g.gid, why: why, chatId: g.chatId || '', host: g.host || '', video: !!g.video, members: Array.from(g.roster) });
    console.log('[GCALL] fin (' + why + ') ' + g.gid);
  }
}

// helpers locales (calls.js no los exporta)
function _fromHexGC(h) { var a = new Uint8Array(h.length / 2); for (var i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
function _b64GC(u8) { var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function _unb64GC(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }

export function createGroupCall(ble, mediaHubFactory) { return new GroupCall(ble, mediaHubFactory); }
