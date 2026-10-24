/**
 * lan.js v1.2 — Wi-Fi normal: hablar con un contacto que está en la misma red Wi-Fi (casa, oficina, un local),
 * aunque no esté a alcance de Bluetooth. Mucho más rápido que Bluetooth y sin montar grupo como Wi-Fi Direct.
 * v1.1 (reglas del dueño, docs/PENDIENTES.md): el Wi-Fi del mismo router manda. El latido y el corte los hace la
 *   parte nativa (LanHub), que sigue aunque la app esté en segundo plano: antes el latido era de la app y, al elegir
 *   una foto en la galería o con la pantalla bloqueada >25 s, el otro daba el Wi-Fi por caído y pasaba a Bluetooth.
 *   Un corte no cambia de camino enseguida: se reconecta y hay un margen (GRACE_MS). Mala señal (ida y vuelta muy
 *   lenta, medida por el latido nativo): lo nuevo va por Bluetooth hasta que mejora, y vuelve solo al Wi-Fi.
 * v1.2 (idea del dueño): además del anuncio mDNS, escaneo activo de la red (Kotlin LanBeacon): al entrar en una red
 *   Wi-Fi, al volver a la app y cada minuto pregunta a toda la red "¿hay algún NEXO?" (difusión y, al entrar o cada
 *   5 min, dirección por dirección). Sirve con routers, repetidores y redes en malla que no dejan pasar el mDNS.
 * v1.3 (ronda 2760, regla del dueño: el Wi-Fi se mantiene, sin brincar): mala señal solo tras ~12 s seguidos y se vuelve
 *   tras ~30 s buenos; con mala señal lo nuevo va por internet (los dos en Wi-Fi) y, si no hay, por Bluetooth; tras un
 *   corte se espera 15 s a que vuelva.
 *
 * - Cada teléfono se anuncia en la red (NSD/mDNS, lo mismo que Bonjour en iPhone) con una marca del día:
 *   SHA-256("nexo-lan|<NEXO ID>|<fecha UTC>") recortado. Solo quien ya conoce el NEXO ID (un contacto) la
 *   reconoce; un desconocido en la misma red no ve quién eres. Cambia cada día.
 * - Al ver la marca de un contacto se conecta (TCP, Kotlin LanHub). Antes de usar la conexión se comprueba con el
 *   cifrado de extremo a extremo: 'lv' lleva un número al azar cifrado para el contacto y solo el de verdad puede
 *   devolverlo ('lw'). Hasta entonces no se acepta nada más por ella.
 * - Comprobada, la conexión es un enlace más para la app (dispositivo "lan:<NEXO ID>"): textos, fotos, vídeos y
 *   archivos van por ella con el mismo protocolo (cifrado, confirmaciones, reenvíos) que por Bluetooth.
 */
import { e2eSealText, e2eOpenText, e2eOuterAd } from '../vault/e2e_proto.js';

var TICK_MS = 4000;
var REDISCOVER_MS = 60000;
var GRACE_MS = 15000;         // tras un corte: tiempo para recuperar el Wi-Fi antes de pasar a otro camino (2760: 15 s)
var VERIFY_LIMIT_MS = 30000;  // una conexión sin comprobar se cierra (impostor)
var BAD_RTT_MS = 1500, GOOD_RTT_MS = 800, BAD_IDLE_MS = 12000; // mala señal (latido nativo cada 4 s)
// Ronda 2760 (regla del dueño: que no brinque): mala 3 latidos seguidos (~12 s) para dejarlo; buena 8 (~30 s) para volver
var BAD_TICKS = 3, GOOD_TICKS = 8;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _day(offset) { var d = new Date(Date.now() + (offset || 0) * 86400000); return d.toISOString().substring(0, 10); }
function _rand() { var a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }

export async function lanToken(nexoId, day) {
  var data = new TextEncoder().encode('nexo-lan|' + _nid(nexoId) + '|' + day);
  var h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(h.slice(0, 8)).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

export class LanLink {
  constructor(ble) {
    this.ble = ble;
    // nx → { up, verified (la conexión actual), routable (se usa como camino), graceUntil, degraded, bad, good,
    //        nonce, upAt, verifyAt }
    this.links = new Map();
    this.addr = new Map();    // nx → { host, port } (última dirección conocida: reconectar sin esperar a la búsqueda)
    this.tokens = new Map();  // marca → nx de un contacto (hoy y ayer)
    this.status = null;
    this._myDay = null;
    this._lastStart = 0;
    this._timer = null;
    this._listeners = false;
  }

  init() {
    var self = this, pl = _plugin();
    if (!pl || typeof pl.lanStatus !== 'function') return Promise.resolve(null);
    if (!self._listeners && typeof pl.addListener === 'function') {
      self._listeners = true;
      pl.addListener('onLanPeer', function(ev) { self._onPeer(ev); });
      pl.addListener('onLanUp', function(ev) { self._onUp(ev); });
      pl.addListener('onLanDown', function(ev) { self._onDown(ev); });
      pl.addListener('onLanMessage', function(ev) { self._onMessage(ev); });
      // Al entrar en una red Wi-Fi (el nativo ya escaneó): anunciarse y buscar ya
      pl.addListener('onLanNet', function() { self.start(); });
      // Al volver a la app: buscar ya (no esperar al minuto), también dirección por dirección
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') self.start(true); });
    }
    if (!self._timer) self._timer = setInterval(function() { self._tick(); }, TICK_MS);
    return pl.lanStatus().then(function(st) {
      self.status = st || null;
      if (st && st.supported) self.start();
      return st;
    }).catch(function() { return null; });
  }

  // Anunciarse y buscar (también sirve para volver a buscar y para cambiar la marca al cambiar el día)
  async start(sweep) {
    var pl = _plugin(), me = _nid(this.ble && this.ble.localNexoId);
    if (!pl || typeof pl.lanStart !== 'function' || !me) return;
    this._lastStart = Date.now();
    try {
      var day = _day(0);
      if (this._myDay !== day || !this._myToken) { this._myToken = await lanToken(me, day); this._myDay = day; }
      await this.refreshTokens();
      var r = await pl.lanStart({ nexoId: me, token: this._myToken, sweep: !!sweep });
      if (r && r.wifi && !this._announced) { this._announced = true; console.log('[WIFI] Buscando contactos en la misma red Wi-Fi'); }
      if (r && !r.wifi) this._announced = false;
    } catch (e) { console.warn('[WIFI] No disponible: ' + (e && e.message)); }
  }

  // Marcas de los contactos (hoy y ayer: la medianoche no cae a la vez en todos los relojes)
  async refreshTokens() {
    var cs = (this.ble && typeof this.ble.getBLEContacts === 'function') ? this.ble.getBLEContacts() : [];
    var me = _nid(this.ble && this.ble.localNexoId), map = new Map();
    for (var i = 0; i < cs.length; i++) {
      var nx = _nid(cs[i].nexoId || cs[i].deviceUUID);
      if (!/^nx[0-9a-z]{8}$/.test(nx) || nx === me) continue;
      map.set(await lanToken(nx, _day(0)), nx);
      map.set(await lanToken(nx, _day(-1)), nx);
    }
    this.tokens = map;
  }

  // ¿Es el Wi-Fi el camino para este contacto? (también durante el margen tras un corte: se espera a que vuelva)
  // Con mala señal se deja el Wi-Fi solo si hay otro camino (2760, regla del dueño: internet; si no, Bluetooth); si no,
  // un Wi-Fi lento es mejor que nada
  canReach(nexoId) {
    var nx = _nid(nexoId), l = this.links.get(nx);
    if (!l || !l.routable) return false;
    if (l.degraded && this.ble) {
      if (this.ble.net && this.ble.net.canReach(nx)) return false;
      if (typeof this.ble._bleReadyFor === 'function' && this.ble._bleReadyFor(nx)) return false;
    }
    return true;
  }
  quality(nexoId) { var l = this.links.get(_nid(nexoId)); return l ? { rtt: l.rtt, idle: l.idle, degraded: !!l.degraded, up: !!l.up } : null; }

  send(nexoId, content) {
    var nx = _nid(nexoId), pl = _plugin(), l = this.links.get(nx);
    if (!pl || !l || !l.up) return Promise.reject(Object.assign(new Error('Sin Wi-Fi con ' + nx), { code: 'LAN_DOWN' }));
    return pl.lanSend({ nx: nx, content: content });
  }

  _raw(nx, obj) { return this.send(nx, JSON.stringify(obj)).catch(function() {}); }

  async _onPeer(ev) {
    if (!ev || !ev.token) return;
    var nx = this.tokens.get(ev.token);
    if (!nx) { await this.refreshTokens(); nx = this.tokens.get(ev.token); } // contacto añadido hace poco
    if (!nx) return;
    var prev = this.addr.get(nx);
    if (!prev || prev.host !== ev.host || prev.port !== ev.port) console.log('[WIFI] ' + nx + ' está en la misma red (' + (ev.src === 'scan' ? 'escaneo de la red' : 'anuncio mDNS') + ')');
    this.addr.set(nx, { host: ev.host, port: ev.port });
    var l = this.links.get(nx);
    if (l && l.up) return;
    this._connect(nx);
  }

  _connect(nx) {
    var a = this.addr.get(nx), pl = _plugin();
    if (a && pl && typeof pl.lanConnect === 'function') pl.lanConnect({ host: a.host, port: a.port }).catch(function() {});
  }

  _onUp(ev) {
    var nx = _nid(ev && ev.nx);
    if (!nx) return;
    var l = this.links.get(nx);
    if (!l) { l = { routable: false }; this.links.set(nx, l); }
    l.up = true; l.verified = false; l.nonce = null; l.upAt = Date.now(); l.verifyAt = 0;
    this._verify(nx);
  }

  _onDown(ev) {
    var nx = _nid(ev && ev.nx), l = this.links.get(nx);
    if (!l) return;
    l.up = false; l.verified = false;
    if (!l.routable) { this.links.delete(nx); return; }
    // Corte: no se cambia de camino todavía; se intenta recuperar el Wi-Fi durante GRACE_MS
    if (!l.graceUntil) {
      l.graceUntil = Date.now() + GRACE_MS;
      console.log('[WIFI] Corte con ' + nx + ': reconectando…');
      this._connect(nx);
      this.start();
    }
  }

  // Sin Wi-Fi con este contacto: lo pendiente sigue por Bluetooth / Jump
  _giveUp(nx, why) {
    var l = this.links.get(nx);
    this.links.delete(nx);
    var pl = _plugin();
    if (l && l.up && pl && typeof pl.lanDrop === 'function') pl.lanDrop({ nx: nx }).catch(function() {});
    if (l && l.routable) {
      console.log('[WIFI] Sin Wi-Fi con ' + nx + (why ? ' (' + why + ')' : '') + ': sigue por Bluetooth');
      if (this.ble && typeof this.ble._lanDown === 'function') this.ble._lanDown(nx);
    }
  }

  // 'lv': un número al azar cifrado para el contacto (solo el de verdad lo lee y lo puede devolver)
  async _verify(nx) {
    var l = this.links.get(nx), ack = this.ble && this.ble.ackSystem, me = _nid(this.ble && this.ble.localNexoId);
    if (!l || !l.up || !ack || typeof ack._target !== 'function') return;
    var t = ack._target(null, nx);
    if (!t) { console.log('[WIFI] ' + nx + ' en la misma red, pero aún sin su clave: por Bluetooth'); return; }
    l.nonce = _rand();
    l.verifyAt = Date.now();
    var id = 'lv' + _rand();
    try {
      var c = await e2eSealText(t, l.nonce, e2eOuterAd(me, nx, id));
      this._raw(nx, { v: 1, type: 'lv', from: me, to: nx, id: id, c: c });
    } catch (e) { console.warn('[WIFI] Comprobación con ' + nx + ' no enviada: ' + (e && e.message)); }
  }

  async _onMessage(ev) {
    var nx = _nid(ev && ev.nx), l = this.links.get(nx), content = (ev && ev.content) || '';
    if (!l) return;
    var o = null;
    if (content.charAt(0) === '{' && /"type":"l[pvw]"/.test(content)) { try { o = JSON.parse(content); } catch (e) { o = null; } }
    if (o && o.type === 'lp') return; // latido de builds anteriores (ahora es nativo)
    var me = _nid(this.ble && this.ble.localNexoId), ack = this.ble && this.ble.ackSystem;
    if (o && o.type === 'lv') {
      try {
        var r = await e2eOpenText(nx, o.c, e2eOuterAd(nx, me, o.id));
        var t = ack && ack._target(null, nx);
        if (!t) return;
        var id2 = 'lw' + _rand();
        var c2 = await e2eSealText(t, r.text, e2eOuterAd(me, nx, id2));
        this._raw(nx, { v: 1, type: 'lw', from: me, to: nx, id: id2, re: o.id, c: c2 });
        if (!l.verified && !l.nonce) this._verify(nx); // el otro también tiene que demostrar quién es
      } catch (e) { console.warn('[WIFI] Comprobación de ' + nx + ' ilegible: ' + (e && e.message)); }
      return;
    }
    if (o && o.type === 'lw') {
      try {
        var r2 = await e2eOpenText(nx, o.c, e2eOuterAd(nx, me, o.id));
        if (l.nonce && r2.text === l.nonce && !l.verified) {
          l.verified = true;
          var again = l.routable;
          l.routable = true; l.graceUntil = 0;
          if (again) {
            console.log('[WIFI] Wi-Fi con ' + nx + ' recuperado');
          } else {
            console.log('[WIFI] Conectado con ' + nx + ' por Wi-Fi (comprobado)');
            if (this.ble && typeof this.ble._lanUp === 'function') this.ble._lanUp(nx);
          }
        }
      } catch (e) { console.warn('[WIFI] Respuesta de ' + nx + ' ilegible: ' + (e && e.message)); }
      return;
    }
    if (!l.verified) return; // nada más hasta comprobar quién es
    if (this.ble && typeof this.ble._onLanPayload === 'function') this.ble._onLanPayload(nx, content);
  }

  async _tick() {
    var self = this, now = Date.now(), pl = _plugin();
    // Calidad medida por el latido nativo: ida y vuelta y tiempo sin recibir
    var q = {};
    if (pl && typeof pl.lanStatus === 'function' && self.links.size) {
      try { var st = await pl.lanStatus(); (st && st.peers || []).forEach(function(p) { q[_nid(p.nx)] = p; }); } catch (e) {}
    }
    self.links.forEach(function(l, nx) {
      if (!l.up) {
        if (l.graceUntil && now > l.graceUntil) self._giveUp(nx, 'no volvió en ' + Math.round(GRACE_MS / 1000) + ' s');
        else self._connect(nx);
        return;
      }
      if (!l.verified) {
        if (now - l.upAt > VERIFY_LIMIT_MS) { console.warn('[WIFI] Conexión con "' + nx + '" sin comprobar: se cierra'); self._giveUp(nx, 'sin comprobar'); return; }
        if (now - (l.verifyAt || 0) > 10000) self._verify(nx); // sin respuesta (p. ej. el otro aún no tenía nuestra clave)
        return;
      }
      var p = q[nx];
      if (!p) return;
      l.rtt = p.rtt; l.idle = p.idle;
      var bad = (p.rtt > BAD_RTT_MS) || (p.idle > BAD_IDLE_MS);
      var good = p.rtt >= 0 && p.rtt < GOOD_RTT_MS && p.idle < BAD_IDLE_MS;
      l.bad = bad ? (l.bad || 0) + 1 : 0;
      l.good = good ? (l.good || 0) + 1 : 0;
      if (!l.degraded && l.bad >= BAD_TICKS) {
        l.degraded = true;
        console.log('[WIFI] Señal Wi-Fi mala con ' + nx + ' (ida y vuelta ' + p.rtt + ' ms, ' + Math.round(p.idle / 1000) + ' s sin recibir): lo nuevo por otro camino');
        if (self.ble && typeof self.ble._lanDegraded === 'function') self.ble._lanDegraded(nx, true);
      } else if (l.degraded && l.good >= GOOD_TICKS) {
        l.degraded = false;
        console.log('[WIFI] Señal Wi-Fi buena otra vez con ' + nx + ': vuelve al Wi-Fi');
        if (self.ble && typeof self.ble._lanDegraded === 'function') self.ble._lanDegraded(nx, false);
      }
    });
    if (now - self._lastStart > REDISCOVER_MS || self._myDay !== _day(0)) self.start();
  }
}

export function createLan(ble) { return new LanLink(ble); }
