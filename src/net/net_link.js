/**
 * net_link.js v1.1 — Internet por relés públicos (Nostr): hablar con un contacto que está lejos (otra casa, otra
 * ciudad) cuando los dos tienen internet. Decisión del dueño (23-10-2026): relés públicos ahora; Tor después.
 *
 * - Relés: servidores públicos de Nostr (WebSocket, protocolo NIP-01). Guardan y reparten "eventos"; no son de NEXO
 *   y cualquiera puede usarlos. Se usan varios a la vez (lo que llega por uno o por otro vale igual).
 * - Para cada pareja de contactos A–B hay un secreto que solo ellos dos pueden calcular (ECDH de sus claves de
 *   identidad, las de siempre). Con él:
 *   · cada evento va cifrado (AES-256-GCM): el relé no ve nada del mensaje, ni el tipo, ni los NEXO IDs;
 *   · va dirigido a una "etiqueta" (p) que cambia cada día y solo A y B saben calcular: el relé no sabe quién es
 *     quién ni quién habla con quién; dos días distintos no se pueden enlazar;
 *   · cada evento lo firma una clave al azar distinta (no se puede saber que dos eventos son del mismo teléfono).
 *   Lo que sí ve el relé: la dirección IP de cada teléfono y cuándo se conecta (para ocultarla: Tor, siguiente fase).
 * - Buzón: los eventos se guardan en los relés (caducan: textos y confirmaciones 7 días, trozos de archivos 1 día).
 *   Si el otro está desconectado o con la app cerrada, lo recoge al volver (pide lo nuevo desde la última vez).
 * - En línea: al conectarse, cada teléfono saluda ('nh') a sus contactos; con saludos cada minuto mientras la app
 *   está abierta. Visto hace < 150 s = en línea: el enlace "net:<NEXO ID>" es un camino más para la app (textos,
 *   fotos, archivos, confirmaciones, con el mismo protocolo que por Bluetooth o Wi-Fi).
 * - Reglas del dueño: Wi-Fi primero. Si los dos están en Wi-Fi (aunque sean módems distintos) va por internet antes
 *   que por Bluetooth; con datos móviles en alguno, solo textos (los archivos esperan al Wi-Fi o a otro camino).
 * - Solo con contactos que lo anuncian (kx nt:1) y con clave aceptada.
 * Tor (fase 2, ronda 2735): con Wi-Fi, cada teléfono arranca Tor (Kotlin, tor-android) y tiene una dirección .onion
 *   fija. Se la pasa a sus contactos dentro del saludo cifrado ('o'); si los dos tienen Tor, se conectan directamente
 *   por Tor y lo que se mandan va por ahí: sin relés y sin que nadie vea la IP de ninguno. Los relés siguen para el
 *   buzón y para saber quién está en línea. Por Tor viaja el mismo sobre cifrado de la pareja: lo que no se descifra
 *   con la clave de ese contacto se descarta y la conexión se cierra (nadie puede hacerse pasar por él).
 *   Se puede apagar en Perfil (state.tor = false).
 * Segundo plano (v1.1, ronda 2750): el emisor marca dentro del sobre de la pareja 'n' = msgId cuando el paquete es un
 *   mensaje nuevo que se ve (texto, primer trozo de un texto largo, foto o archivo; no confirmaciones, saludos ni
 *   acciones como borrar). Con la app en segundo plano la parte nativa (NetBg.kt) escucha los relés con las mismas
 *   etiquetas (le damos el secreto de cada pareja con netBgConfig) y, al ver 'n', pone la notificación. El mensaje
 *   sigue cifrado de extremo a extremo hasta que la app lo recoge.
 * Relés de prueba: window.NEXO_NET_RELAYS.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { e2eIdentityDH, e2eMyPublicKey } from '../vault/e2e_crypto.js';

var DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom'];

// F9 (auditoría ronda 2774): solo relés CIFRADOS (wss://). Por un relé en claro (ws://) un espía de la red vería las
// ETIQUETAS de tu suscripción (las 'p' de tu buzón) y podría ligarte a tus contactos. Se permite ws:// únicamente a
// localhost/loopback (pruebas y relé propio en el mismo equipo), nunca a un host remoto.
function _relaySafe(u) {
  u = String(u || '');
  if (/^wss:\/\//i.test(u)) return true;
  if (/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(u)) return true;
  if (/^ws:\/\//i.test(u)) { try { console.warn('[NET] Relé en claro ignorado (usa wss://): ' + u); } catch (e) {} }
  return false;
}
var KIND = 1059;              // el de los mensajes privados envueltos de Nostr (los relés lo aceptan)
var UP_MS = 150000;           // visto hace menos: en línea
var HELLO_MS = 60000;         // saludo a los contactos en línea mientras la app está abierta
var TICK_MS = 15000;
var TTL_MSG = 7 * 86400, TTL_CHUNK = 86400, TTL_HELLO = 600; // caducidad en los relés (s)
var MAX_CONTENT = 60000;      // tamaño máximo de un evento que aceptan los relés habituales (~64 KB)
var STATE_FILE = 'nexo_net.json';
var N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'); // orden de secp256k1

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _day(offset) { return new Date(Date.now() + (offset || 0) * 86400000).toISOString().substring(0, 10); }
function _utf8(s) { return new TextEncoder().encode(s); }
function _b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function _unb64(b) { var s = atob(b), o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
function _cat(a, b) { var o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }
function _rnd(n) { return crypto.getRandomValues(new Uint8Array(n)); }
// Clave secp256k1 válida a partir de 32 bytes (para la etiqueta del día: los dos la calculan igual)
function _scalar(bytes) { var x = BigInt('0x' + bytesToHex(bytes)) % (N - 1n) + 1n; return hexToBytes(x.toString(16).padStart(64, '0')); }

// Evento Nostr firmado (NIP-01) con la clave sk
function _event(sk, kind, tags, content) {
  var pubkey = bytesToHex(schnorr.getPublicKey(sk));
  var created_at = Math.floor(Date.now() / 1000);
  var id = sha256(_utf8(JSON.stringify([0, pubkey, created_at, kind, tags, content])));
  return { id: bytesToHex(id), pubkey: pubkey, created_at: created_at, kind: kind, tags: tags, content: content, sig: bytesToHex(schnorr.sign(id, sk)) };
}

// Alta por ID (ronda 2779): "buzón de solicitudes" de un NEXO ID. A diferencia de la etiqueta de pareja (que necesita el
// secreto ECDH de las dos claves), este buzón se deriva SOLO del NEXO ID, así que cualquiera que conozca tu ID (te lo
// pasas por WhatsApp) puede dejarte una solicitud de contacto; tú la aceptas o la eliminas (anti-spam). Clave secp256k1
// de la etiqueta (p del evento) y clave AES para cifrar el contenido: el contenido solo lo lee quien conoce el ID
// completo (no es secreto fuerte —el ID es corto— pero evita que un relé lo lea a ciegas). Rota por día (hoy y ayer).
function _reqScalar(id, day) { return _scalar(sha256(_utf8('NEXO-REQ-v1|' + _nid(id) + '|' + day))); }
function _reqTagPub(id, day) { return bytesToHex(schnorr.getPublicKey(_reqScalar(id, day))); }
function _reqAesKey(id) { return sha256(_utf8('NEXO-REQ-ENC-v1|' + _nid(id))); }

export class NetLink {
  constructor(ble) {
    this.ble = ble;
    this.relays = new Map();   // url → { ws, open, backoff, retryAt, sub, waits: Map(id → fn) }
    this.peers = new Map();    // nx → { lastRx, wifi, up, helloAt }
    this.pairs = new Map();    // nx → { pub, kraw, aes }
    this.inTags = new Map();   // etiqueta (p) → nx (para mí, hoy y ayer)
    this.reqTags = new Map();  // alta por ID: etiqueta (p) de MI buzón de solicitudes → sk (hoy y ayer)
    this.tagKeys = [];         // claves de mis etiquetas (AUTH, NIP-42)
    this.seen = new Map();     // id de evento → cuándo (no procesar dos veces lo que llega por varios relés)
    this.state = { lastSeen: 0 };
    this.wifi = false;
    this.tor = { ready: false, onion: '', port: 0, starting: false, triedAt: 0, error: '' };
    this._tagSig = '';
    this._timer = null;
  }

  relayUrls() {
    var urls = (typeof window !== 'undefined' && window.NEXO_NET_RELAYS) || DEFAULT_RELAYS;
    var safe = (urls || []).filter(_relaySafe);
    return safe.length ? safe : DEFAULT_RELAYS; // si todos eran en claro, caer a los wss:// por defecto (nunca sin internet por esto)
  }
  me() { return _nid(this.ble && this.ble.localNexoId); }

  async init() {
    var self = this, pl = _plugin();
    if (self._inited) return;
    self._inited = true;
    try { var r = pl && await pl.loadFromFile({ filename: STATE_FILE }); if (r && r.exists && r.content) self.state = JSON.parse(r.content) || self.state; } catch (e) {}
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function() {
      // A segundo plano: la parte nativa sigue desde lo último que vio la app
      if (document.visibilityState === 'hidden') { self._bgSinceDirty = true; self._bgConfig(); }
      if (document.visibilityState === 'visible') {
        // Tras un rato en segundo plano las conexiones pueden haberse caído: reconectar ya (sin esperar la pausa)
        self.relays.forEach(function(r) { r.retryAt = 0; r.backoff = 2000; });
        self.tick().then(function() { self._helloAll(true); });
      }
    });
    if (pl && typeof pl.addListener === 'function') {
      pl.addListener('onLanNet', function() { self.tick(); });
      if (typeof pl.torStart === 'function') {
        pl.addListener('onTorReady', function(ev) { self._onTorReady(ev); });
        pl.addListener('onTorUp', function(ev) { var p = self._peer(_nid(ev && ev.nx)); p.torUp = true; p.torOk = false; self._hello(_nid(ev.nx)); });
        pl.addListener('onTorDown', function(ev) { var p = self._peer(_nid(ev && ev.nx)); if (p.torOk) console.log('[NET] ' + _nid(ev.nx) + ': conexión Tor cerrada'); p.torUp = false; p.torOk = false; });
        pl.addListener('onTorMessage', function(ev) { self._onTorMessage(ev); });
      }
    }
    self._timer = setInterval(function() { self.tick(); }, TICK_MS);
    await self.tick();
  }

  // Contactos con los que se puede ir por internet: lo anunciaron (nt) y su clave está aceptada
  _netContacts() {
    if (this.ble && typeof this.ble._applyNtKnown === 'function') this.ble._applyNtKnown();
    var cs = (this.ble && typeof this.ble.getBLEContacts === 'function') ? this.ble.getBLEContacts() : [];
    var me = this.me();
    return cs.filter(function(c) { var nx = _nid(c.nexoId || c.deviceUUID); return c && c.nt && c.publicKey && !c.pendingKey && /^nx[0-9a-z]{8}$/.test(nx) && nx !== me; });
  }

  async _pair(nx, pub) {
    var p = this.pairs.get(nx);
    if (p && p.pub === pub) return p;
    var bits = await e2eIdentityDH(pub);
    var kraw = sha256(_cat(_utf8('NEXO-NET-v1|'), bits));
    var aes = await crypto.subtle.importKey('raw', kraw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    p = { pub: pub, kraw: kraw, aes: aes };
    this.pairs.set(nx, p);
    return p;
  }
  // Etiqueta (clave secp256k1 y su clave pública = p del evento) de lo que va para `to` en el día `day`
  _tag(pair, to, day) {
    var sk = _scalar(hmac(sha256, pair.kraw, _utf8('tag|' + to + '|' + day)));
    return { sk: sk, pub: bytesToHex(schnorr.getPublicKey(sk)) };
  }

  async _refreshTags() {
    var me = this.me(), cs = this._netContacts(), inTags = new Map(), keys = [];
    for (var i = 0; i < cs.length; i++) {
      var nx = _nid(cs[i].nexoId || cs[i].deviceUUID);
      try {
        var pair = await this._pair(nx, cs[i].publicKey);
        [0, -1].forEach(function(o) { var t = this._tag(pair, me, _day(o)); inTags.set(t.pub, nx); keys.push(t.sk); }, this);
      } catch (e) {}
    }
    // Alta por ID (ronda 2779): mi propio buzón de solicitudes (hoy y ayer), para recibir solicitudes de contacto de
    // quien conozca mi NEXO ID. Va en la misma suscripción y en las claves de identificación (NIP-42). Solo con la app
    // abierta: en segundo plano no se escuchan solicitudes (quedan en el buzón del relé hasta que se abre la app).
    var reqTags = new Map();
    if (me && (typeof document === 'undefined' || document.visibilityState !== 'hidden') && this._wantReq !== false) {
      [0, -1].forEach(function(o) { var sk = _reqScalar(me, _day(o)); reqTags.set(_reqTagPub(me, _day(o)), sk); keys.push(sk); });
    }
    this.inTags = inTags; this.reqTags = reqTags; this.tagKeys = keys;
    var sig = Array.from(inTags.keys()).concat(Array.from(reqTags.keys())).sort().join(',');
    var changed = sig !== this._tagSig;
    this._tagSig = sig;
    return changed;
  }

  async tick() {
    var self = this, now = Date.now(), pl = _plugin();
    if (!self.me()) return;
    try { var st = pl && typeof pl.lanStatus === 'function' ? await pl.lanStatus() : null; self.wifi = !!(st && st.wifi); } catch (e) {}
    var changed = await self._refreshTags();
    if (changed) self._bgConfig();
    if (!self.inTags.size && !self.reqTags.size) { self._closeAll(); return; }
    var urls = self.relayUrls();
    urls.forEach(function(u) {
      var r = self.relays.get(u);
      if (!r || (!r.ws && now >= (r.retryAt || 0))) self._connect(u);
      else if (changed && r.open) { if (r.challenge) self._auth(u, r, r.challenge); self._subscribe(r); }
    });
    // En línea / desconectado
    self.peers.forEach(function(p, nx) {
      var up = now - (p.lastRx || 0) < UP_MS;
      // Pasó a Wi-Fi estando en línea: lo que esperaba (archivos) puede salir ya
      if (up && p.up && p.wifi && !p.wifiWas && self.wifi && self.ble && typeof self.ble._netUp === 'function') self.ble._netUp(nx);
      p.wifiWas = !!p.wifi;
      if (up !== !!p.up) {
        p.up = up;
        console.log('[NET] ' + nx + (up ? ' en línea por internet' + (p.wifi ? ' (Wi-Fi)' : ' (datos móviles)') : ' ya no está en línea por internet'));
        if (self.ble) { if (up && typeof self.ble._netUp === 'function') self.ble._netUp(nx); else if (!up && typeof self.ble._netDown === 'function') self.ble._netDown(nx); }
      }
    });
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') self._helloAll(false);
    self._torTick();
  }

  _openCount() { var n = 0; this.relays.forEach(function(r) { if (r.open) n++; }); return n; }
  online() { return this._openCount() > 0; }
  canReach(nexoId) { var p = this.peers.get(_nid(nexoId)); return !!(p && p.up && (this.online() || p.torOk) && this.pairs.has(_nid(nexoId))); }
  via(nexoId) { var p = this.peers.get(_nid(nexoId)); return p && p.torOk ? 'tor' : 'relés'; }
  bothWifi(nexoId) { var p = this.peers.get(_nid(nexoId)); return !!(this.wifi && p && p.wifi); }
  // Archivos por internet solo si los dos están en Wi-Fi (con datos móviles cuestan dinero)
  filesOk(nexoId) { return this.canReach(nexoId) && this.bothWifi(nexoId); }
  // Buzón: dejarle un texto aunque no esté en línea
  mailboxOk(nexoId) {
    var nx = _nid(nexoId);
    return this.online() && this._netContacts().some(function(c) { return _nid(c.nexoId || c.deviceUUID) === nx; });
  }

  // ---------- relés ----------
  _connect(url) {
    var self = this, r = self.relays.get(url) || { backoff: 2000, waits: new Map() };
    self.relays.set(url, r);
    var ws;
    try { ws = new WebSocket(url); } catch (e) { r.retryAt = Date.now() + r.backoff; return; }
    r.ws = ws; r.open = false;
    ws.onopen = function() {
      r.open = true; r.backoff = 2000;
      self._subscribe(r);
      if (self._openCount() === 1) {
        console.log('[NET] Conectado a internet por relés públicos');
        setTimeout(function() { self._helloAll(!self._greeted); }, 300); // avisar a los contactos de que estoy
        // Ronda 2780 (pedido del dueño): volvió el internet → reenviar fotos/archivos/textos que quedaron en espera
        if (self.ble && typeof self.ble._netOnline === 'function') setTimeout(function() { self.ble._netOnline(); }, 800);
      }
    };
    ws.onmessage = function(ev) { self._onRelayMsg(url, r, ev.data); };
    ws.onclose = function() {
      var was = r.open;
      r.open = false; r.ws = null; r.sub = null;
      r.retryAt = Date.now() + r.backoff; r.backoff = Math.min(r.backoff * 2, 120000);
      r.waits.forEach(function(fn) { fn(false); }); r.waits.clear();
      if (was && !self.online()) console.log('[NET] Sin relés: internet no disponible');
    };
    ws.onerror = function() {};
  }
  _closeAll() { this.relays.forEach(function(r) { try { if (r.ws) r.ws.close(); } catch (e) {} }); }
  _send(r, arr) { try { if (r.ws && r.open) { r.ws.send(JSON.stringify(arr)); return true; } } catch (e) {} return false; }

  _subscribe(r) {
    if (r.sub) this._send(r, ['CLOSE', r.sub]);
    r.sub = 'nx' + bytesToHex(_rnd(6));
    var since = Math.max(0, Math.floor((this.state.lastSeen || (Date.now() - 2 * 86400000)) / 1000) - 600);
    this._send(r, ['REQ', r.sub, { kinds: [KIND], '#p': Array.from(this.inTags.keys()).concat(Array.from(this.reqTags.keys())), since: since }]);
  }

  _onRelayMsg(url, r, data) {
    var m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!Array.isArray(m)) return;
    if (m[0] === 'EVENT' && m[1] === r.sub && m[2]) this._onEvent(m[2]);
    else if (m[0] === 'OK') { var fn = r.waits.get(m[1]); if (fn) { r.waits.delete(m[1]); fn(!!m[2], m[3]); } }
    else if (m[0] === 'AUTH' && typeof m[1] === 'string') { r.challenge = m[1]; this._auth(url, r, m[1]); }
    else if (m[0] === 'CLOSED' && m[1] === r.sub) {
      // Algunos relés piden identificarse (NIP-42) para leer mensajes privados: tras hacerlo, se vuelve a pedir
      if (/^auth-required/.test(String(m[2] || ''))) { r.sub = null; if (r.authed) this._subscribe(r); else r.needSub = true; }
    }
  }

  // NIP-42: el relé pide demostrar quién lee: se firma su reto con las claves de mis etiquetas
  _auth(url, r, challenge) {
    var self = this;
    var keys = self.tagKeys.slice(0, 40), pending = keys.length;
    r.authed = false;
    keys.forEach(function(sk) {
      var ev = _event(sk, 22242, [['relay', url], ['challenge', challenge]], '');
      r.waits.set(ev.id, function() { if (--pending === 0) { r.authed = true; if (r.needSub) { r.needSub = false; self._subscribe(r); } } });
      self._send(r, ['AUTH', ev]);
    });
  }

  async _onEvent(ev) {
    if (!ev || typeof ev.id !== 'string' || this.seen.has(ev.id)) return;
    this.seen.set(ev.id, Date.now());
    if (this.seen.size > 3000) { var cut = Date.now() - 3600000; this.seen.forEach(function(t, k) { if (t < cut) this.seen.delete(k); }, this); }
    var self = this;
    var p = (ev.tags || []).filter(function(t) { return t && t[0] === 'p'; }).map(function(t) { return t[1]; });
    var nx = null;
    for (var i = 0; i < p.length && !nx; i++) nx = this.inTags.get(p[i]) || null;
    if (!nx) {
      // Alta por ID (ronda 2779): ¿va dirigido a mi buzón de solicitudes? (req = me quieren agregar; acc = aceptaron la mía)
      if (p.some(function(x) { return self.reqTags.has(x); })) await this._onReq(ev.content);
      return;
    }
    var o = await this._open(nx, ev.content);
    if (!o) { console.warn('[NET] Evento ilegible para ' + nx + ': descartado'); return; }
    if (ev.created_at * 1000 > (this.state.lastSeen || 0)) { this.state.lastSeen = ev.created_at * 1000; this._saveState(); }
    this._deliver(nx, o);
  }

  // Sobre de la pareja (relé o Tor): null si no se descifra con la clave de ese contacto
  async _open(nx, b64) {
    var pair = this.pairs.get(nx), me = this.me();
    if (!pair || typeof b64 !== 'string') return null;
    try {
      var raw = _unb64(b64);
      var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: _utf8('NEXO-NET|' + nx + '|' + me) }, pair.aes, raw.subarray(12));
      return JSON.parse(new TextDecoder().decode(new Uint8Array(pt)));
    } catch (e) { return null; }
  }
  _peer(nx) { var p = this.peers.get(nx); if (!p) { p = {}; this.peers.set(nx, p); } return p; }

  // Alta por ID (ronda 2779): llegó algo a mi buzón de solicitudes. Lo descifro con la clave de MI ID (solo quien conoce
  // mi ID completo pudo cifrarlo). Aviso a la app: req = me quieren agregar; acc = aceptaron mi solicitud. La clave que
  // llega NO está verificada en persona: la app deja el contacto "sin verificar" hasta comparar el número de seguridad.
  async _onReq(b64) {
    if (typeof b64 !== 'string') return;
    var o;
    try {
      var raw = _unb64(b64);
      var key = await crypto.subtle.importKey('raw', _reqAesKey(this.me()), 'AES-GCM', false, ['decrypt']);
      var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12));
      o = JSON.parse(new TextDecoder().decode(new Uint8Array(pt)));
    } catch (e) { return; }
    if (!o || (o.t !== 'req' && o.t !== 'acc')) return;
    var from = _nid(o.from);
    if (!/^nx[0-9a-z]{8}$/.test(from) || from === this.me()) return;
    if (typeof o.pk !== 'string' || !/^[A-Za-z0-9+/=]{80,100}$/.test(o.pk)) return;
    if (this.ble && typeof this.ble._onNetRequest === 'function') {
      this.ble._onNetRequest({ id: from, pk: o.pk, name: String(o.name || '').replace(/[<>]/g, '').slice(0, 40), kind: o.t });
    }
  }

  _deliver(nx, o) {
    var peer = this._peer(nx);
    var t = Number(o.t) || 0, now = Date.now();
    // Su dirección de Tor (va en el saludo cifrado): si los dos tenemos Tor, conectar directamente
    if (typeof o.o === 'string' && /^[a-z2-7]{56}\.onion$/.test(o.o)) { peer.onion = o.o; peer.torPort = Number(o.op) || 0; this._torDial(nx); }
    // Solo lo reciente cuenta para "en línea" (lo guardado de hace rato es del buzón)
    if (now - t < UP_MS && t > (peer.lastRx || 0)) { peer.lastRx = t; peer.wifi = !!o.w; }
    if (o.h) {
      // Saludo: contestar si hace rato que no le saludamos (así los dos se ven en línea enseguida)
      if (now - t < UP_MS && now - (peer.helloAt || 0) > 20000) this._hello(nx);
      if (!peer.up && now - t < UP_MS) this.tick();
      return;
    }
    if (!peer.up && now - t < UP_MS) this.tick();
    if (typeof o.p === 'string' && this.ble && typeof this.ble._onNetPayload === 'function') this.ble._onNetPayload(nx, o.p);
  }

  // msgId si el paquete es un mensaje nuevo que se ve (para la notificación en segundo plano del otro)
  _newMsgId(p) {
    if (typeof p !== 'string' || p.charAt(0) !== '{') return null;
    var o; try { o = JSON.parse(p); } catch (e) { return null; }
    var id = null;
    if (o && o.type === 'chat' && typeof o.msgId === 'string') id = o.msgId;
    else if (o && (o.t === 'c' || o.t === 'f') && o.i === 0 && !o.hf && typeof o.m === 'string') id = o.m;
    if (!id) return null;
    var quiet = this.ble && this.ble._quietOut;
    return quiet && quiet.has(id) ? null : id;
  }

  // La parte nativa escucha los relés con la app en segundo plano (NetBg.kt): se le da lo justo para reconocer los
  // sobres de cada pareja (el secreto de la pareja, que no sale del teléfono)
  async _bgConfig() {
    var pl = _plugin();
    if (!pl || typeof pl.netBgConfig !== 'function' || !this.me()) return;
    var cs = this._netContacts(), list = [];
    for (var i = 0; i < cs.length; i++) {
      var nx = _nid(cs[i].nexoId || cs[i].deviceUUID);
      try { var pair = await this._pair(nx, cs[i].publicKey); list.push({ nx: nx, name: cs[i].name || '', kraw: bytesToHex(pair.kraw) }); } catch (e) {}
    }
    var sig = list.map(function(c) { return c.nx + c.kraw; }).join(',') + '|' + this.relayUrls().join(',');
    // Desde justo después de lo último que recogió la app (lo ya visto no vuelve a avisar)
    var since = this.state.lastSeen ? this.state.lastSeen + 1000 : Date.now() - 600000;
    if (sig === this._bgSig && !this._bgSinceDirty) return;
    this._bgSig = sig; this._bgSinceDirty = false;
    try { await pl.netBgConfig({ me: this.me(), relays: this.relayUrls(), since: since, contacts: list }); } catch (e) {}
  }

  _saveState() {
    var self = this, pl = _plugin();
    if (self._saveT || !pl) return;
    self._saveT = setTimeout(function() { self._saveT = null; pl.saveToFile({ filename: STATE_FILE, content: JSON.stringify(self.state) }).catch(function() {}); }, 2000);
  }

  // ---------- enviar ----------
  _ttlFor(content) {
    if (/^\{"v":1,"t":"[cf]"/.test(content)) return TTL_CHUNK;
    return TTL_MSG;
  }

  // ---------- Tor ----------
  torWanted() { return this.state.tor !== false; }
  setTor(on) {
    this.state.tor = !!on; this._saveState();
    var pl = _plugin();
    if (!on && pl && typeof pl.torStop === 'function') { pl.torStop().catch(function() {}); this.tor.ready = false; this.tor.onion = ''; this.peers.forEach(function(p) { p.torUp = p.torOk = false; }); }
    else this.tick();
  }
  _torTick() {
    var pl = _plugin(), now = Date.now();
    if (!pl || typeof pl.torStart !== 'function' || !this.torWanted() || this.tor.ready || this.tor.starting) return;
    // Solo con Wi-Fi (arrancar Tor gasta datos) y si hay contactos con los que usarlo; reintento cada 10 min
    if (!this.wifi || !this.inTags.size || now - (this.tor.triedAt || 0) < 600000) return;
    this.tor.starting = true; this.tor.triedAt = now;
    console.log('[NET] Arrancando Tor…');
    var self = this;
    pl.torStart({ nexoId: this.me() }).catch(function(e) { self.tor.starting = false; self.tor.error = (e && e.message) || 'error'; });
  }
  _onTorReady(ev) {
    this.tor.starting = false;
    if (!ev || ev.error || !ev.onion) { this.tor.error = (ev && ev.error) || 'error'; console.warn('[NET] Tor no disponible: ' + this.tor.error); return; }
    this.tor.ready = true; this.tor.onion = ev.onion; this.tor.port = Number(ev.port) || 0; this.tor.error = '';
    console.log('[NET] Tor listo (dirección .onion propia)');
    this._helloAll(true); // los contactos reciben la dirección y se conectan
    var self = this;
    this.peers.forEach(function(p, nx) { self._torDial(nx); });
  }
  _torDial(nx) {
    var p = this._peer(nx), pl = _plugin(), now = Date.now();
    if (!this.tor.ready || !p.onion || p.torUp || now - (p.torDialAt || 0) < 60000 || !pl || typeof pl.torConnect !== 'function') return;
    p.torDialAt = now;
    pl.torConnect({ host: p.onion, port: p.torPort || this.tor.port }).catch(function() {});
  }
  async _onTorMessage(ev) {
    var nx = _nid(ev && ev.nx), p = this._peer(nx);
    var o = await this._open(nx, ev && ev.content);
    if (!o) {
      // No es de ese contacto (o no tenemos su clave): fuera
      console.warn('[NET] Conexión Tor de "' + nx + '" que no se puede comprobar: se cierra');
      var pl = _plugin(); if (pl && typeof pl.torDrop === 'function') pl.torDrop({ nx: nx }).catch(function() {});
      p.torUp = false; p.torOk = false;
      return;
    }
    if (!p.torOk) { p.torOk = true; console.log('[NET] ' + nx + ' conectado por Tor (directo, sin relés)'); }
    this._deliver(nx, o);
  }

  // Manda un paquete (texto JSON del protocolo) al contacto: por Tor si hay conexión comprobada con él; si no, a los
  // relés. Se resuelve cuando salió por Tor o al menos un relé lo guardó
  async send(nexoId, content, opts) {
    var nx = _nid(nexoId), me = this.me();
    var c = this._netContacts().find(function(x) { return _nid(x.nexoId || x.deviceUUID) === nx; });
    var tp = this.peers.get(nx);
    if (!c || !(this.online() || (tp && tp.torUp))) throw Object.assign(new Error('Sin internet con ' + nx), { code: 'NET_DOWN' });
    var pair = await this._pair(nx, c.publicKey);
    var body = { t: Date.now(), w: this.wifi ? 1 : 0 };
    if (opts && opts.hello) { body.h = 1; if (this.tor.ready && this.tor.onion) { body.o = this.tor.onion; body.op = this.tor.port; } }
    else { body.p = String(content); var nid = this._newMsgId(body.p); if (nid) body.n = nid; }
    var iv = _rnd(12);
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: _utf8('NEXO-NET|' + me + '|' + nx) }, pair.aes, _utf8(JSON.stringify(body))));
    var b64 = _b64(_cat(iv, ct));
    var peer = this._peer(nx), pl = _plugin();
    if (peer.torUp && (peer.torOk || (opts && opts.hello)) && pl && typeof pl.torSend === 'function') {
      try { await pl.torSend({ nx: nx, content: b64 }); return true; } catch (e) { peer.torUp = false; peer.torOk = false; }
    }
    if (b64.length > MAX_CONTENT) throw Object.assign(new Error('Demasiado grande para internet'), { code: 'NET_TOO_BIG' });
    var ttl = (opts && opts.hello) ? TTL_HELLO : this._ttlFor(String(content || ''));
    var tag = this._tag(pair, nx, _day(0));
    var ev = _event(schnorr.utils.randomSecretKey(), KIND, [['p', tag.pub], ['expiration', String(Math.floor(Date.now() / 1000) + ttl)]], b64);
    return this._publish(ev);
  }

  // Alta por ID (ronda 2779): deja una solicitud ('req') o una aceptación ('acc') en el buzón del ID `to`, cifrada con la
  // clave de ese ID. Lleva mi NEXO ID, mi clave pública (para que el otro pueda encender el canal seguro) y mi nombre.
  // Se conecta a los relés si hace falta. Resuelve cuando un relé la guardó.
  async sendRequest(toId, type, name) {
    var to = _nid(toId), me = this.me(), pk = e2eMyPublicKey();
    if (!/^nx[0-9a-z]{8}$/.test(to)) throw new Error('ID no válido (debe ser NX y 8 más)');
    if (to === me) throw new Error('Ese es tu propio ID');
    if (!pk) throw new Error('Este teléfono aún no tiene clave de identidad');
    if (!this.online()) { await this.tick(); }
    if (!this.online()) throw Object.assign(new Error('Sin internet para mandar la solicitud'), { code: 'NET_DOWN' });
    var payload = { v: 1, t: type === 'acc' ? 'acc' : 'req', from: me, pk: pk, name: String(name || '').replace(/[<>]/g, '').slice(0, 40), ts: Date.now() };
    var key = await crypto.subtle.importKey('raw', _reqAesKey(to), 'AES-GCM', false, ['encrypt']);
    var iv = _rnd(12);
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, _utf8(JSON.stringify(payload))));
    var b64 = _b64(_cat(iv, ct));
    var ev = _event(schnorr.utils.randomSecretKey(), KIND, [['p', _reqTagPub(to, _day(0))], ['expiration', String(Math.floor(Date.now() / 1000) + TTL_MSG)]], b64);
    return this._publish(ev);
  }

  _publish(ev) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var open = [];
      self.relays.forEach(function(r) { if (r.open) open.push(r); });
      if (!open.length) { reject(Object.assign(new Error('Sin relés'), { code: 'NET_DOWN' })); return; }
      var left = open.length, done = false, why = '';
      var timer = setTimeout(function() { if (!done) { done = true; reject(Object.assign(new Error('Los relés no respondieron'), { code: 'NET_DOWN' })); } }, 12000);
      open.forEach(function(r) {
        r.waits.set(ev.id, function(ok, msg) {
          if (done) return;
          if (ok) { done = true; clearTimeout(timer); resolve(true); return; }
          why = msg || why;
          if (--left === 0) { done = true; clearTimeout(timer); reject(Object.assign(new Error('Rechazado por los relés: ' + why), { code: 'NET_REJECTED' })); }
        });
        if (!self._send(r, ['EVENT', ev])) { r.waits.delete(ev.id); if (--left === 0 && !done) { done = true; clearTimeout(timer); reject(Object.assign(new Error('Sin relés'), { code: 'NET_DOWN' })); } }
      });
    });
  }

  _hello(nx) {
    var p = this.peers.get(nx) || {};
    this.peers.set(nx, p);
    p.helloAt = Date.now();
    this.send(nx, '', { hello: true }).catch(function() {});
  }
  // Alta por ID (ronda 2779): tras agregar un contacto nuevo (al aceptar una solicitud o al llegar la aceptación de la
  // mía), forzar el saludo para que los dos se vean en línea enseguida (el saludo normal del tick no saluda a un contacto
  // que aún no está "en línea"). Refresca etiquetas/suscripción y saluda.
  greet() { var self = this; return this.tick().then(function() { self._helloAll(true); }); }

  // Saludo a los contactos: al conectar (o al volver a la app) a todos; después, cada minuto a los que están en línea
  _helloAll(force) {
    var self = this, now = Date.now();
    if (!self.online()) return;
    var first = !self._greeted;
    self._greeted = true;
    self._netContacts().forEach(function(c) {
      var nx = _nid(c.nexoId || c.deviceUUID), p = self.peers.get(nx) || {};
      if (force || first || (p.up && now - (p.helloAt || 0) > HELLO_MS)) self._hello(nx);
    });
  }
}

export function createNet(ble) { return new NetLink(ble); }
