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
 * v1.4 (3022/3023, dueño 12-11): durante el margen lo nuevo va por otro camino listo; el margen es el promedio medido de
 *   reconexión con ese contacto + 2 s, entre 2 y 5 s (sin Wi-Fi propio: se cambia al momento).
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
var GRACE_MS = 15000;         // (hasta la 3022) margen fijo tras un corte; desde la 3023 el margen es _graceMs (abajo)
// 3023 (dueño 12-11: «15 s son muchos… toma el tiempo promedio de reconexión de cada tipo, agrégale 2 s, y ese es el máximo»,
// y «5 s máximo»): margen tras un corte = promedio de las últimas reconexiones REALES con ese contacto + 2 s, entre 2 y 5 s; sin
// medidas, 5 s. Si ESTE teléfono no tiene Wi-Fi (apagado/sin red), no hay nada que esperar: se cambia al momento.
var GRACE_MIN_MS = 2000, GRACE_MAX_MS = 5000, GRACE_EXTRA_MS = 2000, GRACE_DEFAULT_MS = 5000, RECOV_KEEP = 5, RECOV_MAX_MS = 60000;
var VERIFY_LIMIT_MS = 30000;  // una conexión sin comprobar se cierra (impostor)
// 2978 (diagnósticos del dueño 09-11 13:42 y 15:57: «Conexión con la tablet/el vivo sin comprobar: se cierra» SIEMPRE a los 30 s, y el
// APK esperando Wi-Fi): la comprobación la contesta el JS del otro; si su app está dormida (pantalla apagada, WebView congelado)
// no hay quién conteste aunque su nativo tenga la conexión viva (latido con ida y vuelta). Mientras el latido diga que el otro
// está vivo se espera más (sin usar el enlace: sigue sin ser camino) y a los 8 s se le manda un «toque» FCM para que su app
// despierte y conteste. Sin latido (impostor o nativo caído), los 30 s de siempre.
var VERIFY_ALIVE_LIMIT_MS = 180000, VERIFY_WAKE_MS = 8000;
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
    // 3069: comprobándose otra vez tras un desfase de cifrado (recheck): lo nuevo va por otro camino si lo hay (el otro, recién
    // arrancado, aún no da por bueno este Wi-Fi y descarta lo que le llegue por él)
    if (l.rechecking && Date.now() < l.rechecking && this._otherPath(nx)) return false;
    // 3022 (prueba del dueño 12-11, los dos apagan el Wi-Fi con el Bluetooth listo): en el margen de un corte (regla del dueño
    // 23-10: se espera a que vuelva) lo NUEVO no va al Wi-Fi caído si hay otro camino listo; antes el nativo fallaba 5 veces por
    // texto y llegaban a los ~40 s. Un archivo a medias sigue esperando el margen (no se re-resuelve: va con su enlace).
    if (!l.up && l.graceUntil && this._otherPath(nx)) return false;
    if (l.degraded && this.ble) {
      if (this.ble.net && this.ble.net.canReach(nx)) return false;
      if (typeof this.ble._bleReadyFor === 'function' && this.ble._bleReadyFor(nx)) return false;
    }
    return true;
  }
  // 3069 (desatasco, resync.js): desfase de cifrado con este contacto → el Wi-Fi se vuelve a comprobar YA (con la sesión nueva) en vez
  // de esperar a la vuelta de 10 s; mientras, lo nuevo sale por Bluetooth/internet si hay (canReach). Lo que llegue por Wi-Fi se sigue
  // aceptando (la conexión ya estaba comprobada).
  recheck(nexoId) {
    var nx = _nid(nexoId), l = this.links.get(nx);
    if (!l || !l.up) return false;
    l.rechecking = Date.now() + 15000;
    this._verify(nx);
    return true;
  }
  // 3023: margen tras un corte con este contacto (ver GRACE_*): promedio de sus últimas reconexiones + 2 s, entre 2 y 5 s
  _graceMs(nx) {
    var a = this._recovFor(nx);
    if (!a.length) return GRACE_DEFAULT_MS;
    var avg = a.reduce(function(x, y) { return x + y; }, 0) / a.length;
    return Math.round(Math.min(GRACE_MAX_MS, Math.max(GRACE_MIN_MS, avg + GRACE_EXTRA_MS)));
  }
  _recovFor(nx) {
    if (!this._recov) { this._recov = {}; try { this._recov = JSON.parse(localStorage.getItem('nexo_lan_recov') || '{}') || {}; } catch (e) { this._recov = {}; } }
    var a = this._recov[nx]; return Array.isArray(a) ? a.filter(function(v) { return typeof v === 'number' && v >= 0; }) : [];
  }
  // Volvió el Wi-Fi con este contacto tras un corte (dentro o después del margen): se anota cuánto tardó (hasta 1 min)
  _noteRecovery(nx) {
    var t = this._cutAt && this._cutAt.get(nx); if (!t) return 0;
    this._cutAt.delete(nx);
    var d = Date.now() - t; if (d > RECOV_MAX_MS) return 0;
    var a = this._recovFor(nx); a.push(d); if (a.length > RECOV_KEEP) a = a.slice(-RECOV_KEEP);
    this._recov[nx] = a;
    try { localStorage.setItem('nexo_lan_recov', JSON.stringify(this._recov)); } catch (e) {}
    return d;
  }
  // 3022: ¿el Wi-Fi con este contacto está caído y en su margen de recuperación?
  inGrace(nexoId) { var l = this.links.get(_nid(nexoId)); return !!(l && l.routable && !l.up && l.graceUntil && Date.now() < l.graceUntil); }
  _otherPath(nx) {
    var b = this.ble; if (!b) return false;
    try { if (typeof b._bleReadyFor === 'function' && b._bleReadyFor(nx)) return true; } catch (e) {}
    try { if (b.net && b.net.canReach(nx)) return true; } catch (e) {}
    return false;
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
    // Corte: no se cambia de camino todavía; se intenta recuperar el Wi-Fi durante el margen (3023: medido, 2–5 s)
    if (!l.graceUntil) {
      var self = this, g = this._graceMs(nx);
      l.graceMs = g; l.graceUntil = Date.now() + g;
      this._cutAt = this._cutAt || new Map(); if (!this._cutAt.has(nx)) this._cutAt.set(nx, Date.now());
      console.log('[WIFI] Corte con ' + nx + ': reconectando… (espero hasta ' + (g / 1000).toFixed(1) + ' s)');
      // al vencer el margen, cambiar en ese momento (no al siguiente latido de 4 s)
      setTimeout(function() { var l2 = self.links.get(nx); if (l2 && !l2.up && l2.graceUntil && Date.now() >= l2.graceUntil) self._giveUp(nx, 'no volvió en ' + (g / 1000).toFixed(1) + ' s'); }, g + 30);
      // ¿este teléfono sigue con Wi-Fi? Sin Wi-Fi propio no vuelve: se cambia ya
      var pl0 = _plugin();
      if (pl0 && typeof pl0.lanStatus === 'function') pl0.lanStatus().then(function(st) { var l3 = self.links.get(nx); if (st && st.wifi === false && l3 && !l3.up && l3.graceUntil) self._giveUp(nx, 'este teléfono no tiene Wi-Fi'); }).catch(function() {});
      this._connect(nx);
      this.start();
      // 3022: los textos que esperaban confirmación por el Wi-Fi pasan ya al otro camino listo (los archivos esperan el margen)
      if (this._otherPath(nx) && this.ble && typeof this.ble._lanSoftDown === 'function') this.ble._lanSoftDown(nx);
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
        // el otro también tiene que demostrar quién es. 3069: si mi comprobación anterior quedó sin respuesta (p. ej. cifrada con una
        // sesión que ya no le sirve), se repite ya: su comprobación me acaba de traer la sesión buena
        if (!l.verified && (!l.nonce || Date.now() - (l.reLvAt || 0) > 1000)) { if (l.nonce) l.reLvAt = Date.now(); this._verify(nx); }
      } catch (e) {
        console.warn('[WIFI] Comprobación de ' + nx + ' ilegible: ' + (e && e.message));
        if (typeof window.NEXO_resyncNote === 'function' && e && (e.code === 'BAD' || e.code === 'DESYNC')) window.NEXO_resyncNote(nx, null, e.code); // 3069
      }
      return;
    }
    if (o && o.type === 'lw') {
      try {
        var r2 = await e2eOpenText(nx, o.c, e2eOuterAd(nx, me, o.id));
        if (l.nonce && r2.text === l.nonce && l.verified && l.rechecking) { l.rechecking = 0; console.log('[WIFI] Wi-Fi con ' + nx + ' comprobado otra vez tras el desfase de cifrado'); }
        else if (l.nonce && r2.text === l.nonce && !l.verified) {
          l.rechecking = 0;
          l.verified = true;
          var again = l.routable;
          l.routable = true; l.graceUntil = 0;
          var recMs = this._noteRecovery(nx);
          if (again) {
            console.log('[WIFI] Wi-Fi con ' + nx + ' recuperado' + (recMs ? ' en ' + (recMs / 1000).toFixed(1) + ' s' : ''));
          } else {
            console.log('[WIFI] Conectado con ' + nx + ' por Wi-Fi (comprobado)');
            try { if (l.upAt && typeof window.NEXO_noteConnect === 'function') window.NEXO_noteConnect('wifi', Date.now() - l.upAt); } catch (e) {} // 3081
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
        if (l.graceUntil && now > l.graceUntil) self._giveUp(nx, 'no volvió en ' + ((l.graceMs || GRACE_DEFAULT_MS) / 1000).toFixed(1) + ' s');
        else self._connect(nx);
        return;
      }
      if (!l.verified) {
        var pq = q[nx], alive = !!(pq && pq.rtt >= 0 && pq.idle < BAD_IDLE_MS); // 2978: su nativo contesta el latido
        if (now - l.upAt > (alive ? VERIFY_ALIVE_LIMIT_MS : VERIFY_LIMIT_MS)) { console.warn('[WIFI] Conexión con "' + nx + '" sin comprobar' + (alive ? ' (su app no contestó en ' + Math.round(VERIFY_ALIVE_LIMIT_MS / 1000) + ' s)' : '') + ': se cierra'); self._giveUp(nx, 'sin comprobar'); return; }
        if (now - (l.verifyAt || 0) > 10000) self._verify(nx); // sin respuesta (p. ej. el otro aún no tenía nuestra clave)
        // 2978: conectado por Wi-Fi pero su app no contesta → está dormida: un toque FCM (frenado por par en net_link) la despierta
        if (!l.woke && alive && now - l.upAt > VERIFY_WAKE_MS && self.ble && self.ble.net && typeof self.ble.net.wakeFor === 'function') {
          l.woke = true;
          try { if (self.ble.net.wakeFor(nx)) console.log('[WIFI] ' + nx + ' conectado por Wi-Fi pero su app no contesta la comprobación: toque para despertarla'); } catch (e) {}
        }
        return;
      }
      var p = q[nx];
      if (!p) return;
      l.rtt = p.rtt; l.idle = p.idle;
      // 2975 (diagnóstico del dueño 13:35, APK de 25 MB a la tablet por Wi-Fi): el latido viaja por el MISMO canal que los trozos
      // de 24 KB en vuelo, así que con una transferencia la ida y vuelta se infla por la CARGA (5509 ms con «0 s sin recibir»)
      // y el enlace se daba por malo justo cuando mejor andaba (y el archivo caía a Bluetooth, donde no cabe → ⏳ y de cero).
      // Ahora, mientras haya un archivo/texto largo yendo o viniendo por ESTE enlace Wi-Fi (con confirmaciones recientes), la ida
      // y vuelta alta no cuenta: solo «sin recibir» > 12 s. Sin transferencia, la regla de siempre (mala señal = ida y vuelta alta).
      var ack = self.ble && self.ble.ackSystem;
      var carga = !!(ack && typeof ack.hasActiveTransferOn === 'function' && ack.hasActiveTransferOn('lan:' + nx));
      var bad = (p.idle > BAD_IDLE_MS) || (p.rtt > BAD_RTT_MS && !carga);
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
