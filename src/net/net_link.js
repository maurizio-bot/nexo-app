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
import { GwLink, GW_FILE_MAX_B64 } from './gw_link.js';

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
var BLOB_KIND = 1064;         // Fase B (2969): eventos-TROZO del buzón de archivos (sin etiqueta p; se bajan por id). No 1059: los relés con NIP-42 solo dejan leer 1059 al etiquetado
var UP_MS = 150000;           // visto hace menos: en línea
var HELLO_MS = 60000;         // saludo a los contactos en línea mientras la app está abierta
var TICK_MS = 15000;
var TTL_MSG = 7 * 86400, TTL_CHUNK = 86400, TTL_HELLO = 600; // caducidad en los relés (s)
var MAX_CONTENT = 60000;      // tamaño máximo de un evento que aceptan los relés habituales (~64 KB)
var MAX_RELAY_FRAME = 300000; // SEC-4 (auditoría 28-10): tope de un frame de relé antes de analizarlo (como SafeJson nativo)
// P5 (dueño 01-11): un relé que FLAPEA (abre y se cae enseguida, muchas veces) desestabiliza internet (en el diagnóstico
// damus.io se cerró 37×). Se detecta por conexiones de vida corta y se aparta un rato — pero SOLO si quedan otros relés
// abiertos (mejor un relé que flapea que quedarse sin internet).
var RELAY_STABLE_MS = 20000;        // una conexión de relé de menos de esto cuenta como «flap» (abrió y se cayó enseguida)
var RELAY_FLAP_WINDOW_MS = 300000;  // ventana para contar flaps (5 min)
var RELAY_FLAP_MAX = 3;             // nº de flaps en la ventana para considerar el relé inestable
var RELAY_FLAP_PENALTY_MS = 300000; // cuánto se aparta un relé inestable (5 min) antes de reintentar
// 3011 (diagnóstico S24 3010, 11-11 19:25 UTC): conexión a un relé «abierta» pero MUERTA (tras un rato en segundo plano o un
// cambio de red el teléfono no se entera hasta minutos después). Se le hace una pregunta mínima y, si no contesta, se reconecta.
var RELAY_PROBE_MS = 5000;          // tiempo para contestar a la pregunta de comprobación
var RELAY_IDLE_PROBE_MS = 120000;   // un relé callado más que esto (con la app a la vista) se comprueba
var RELAY_BG_PROBE_MS = 10000;      // al volver a la app tras al menos esto en segundo plano, se comprueban todos
var RELAY_PROBE_ID = '0000000000000000000000000000000000000000000000000000000000000000';
var RELAY_OFFLINE_RETRY_MS = 15000; // medición de caminos (3050): sin NINGÚN relé propio abierto, se reintenta como mucho cada 15 s
var RELAY_MIN_OTHERS = 2;           // solo se aparta si quedan al menos tantos OTROS relés abiertos (no quedarse sin red)
var WAKE_MIN_MS = 8000;       // M1 (auditoría 28-10): como mucho un «toque» FCM por par cada 8 s (ráfaga de textos)
var CALL_WAKE_MIN_MS = 3000;  // #130 (dueño 30-10): una llamada insiste en despertar — throttle propio, más corto y
                              // aparte del de textos (un texto reciente NO silencia el toque de una llamada entrante)
var XFER_WAKE_MIN_MS = 15000; // #dueño 06-11 (latido de despertador para archivo grande por internet): mientras una
                              // transferencia por internet NO avanza (el que recibe se durmió), re-despertarlo como
                              // mucho cada 15 s (bucket propio, sparse: no gasta la cuota de FCM; con avance no hay
                              // timeout → no hay toques). 15 s = el dueño lo pidió corto porque el envío ya es lento.
                              // Configurable para las pruebas con window.NEXO_XFER_WAKE_MS.
// FCM «despertador» (#87, Fase 2): enviador por defecto. Se desplegó en Cloudflare Workers (gratis, sin tarjeta) en vez de
// Firebase Functions (que exige el plan Blaze); hace lo mismo (POST { to } -> «toque» solo-datos de alta prioridad) firmando
// con la cuenta de servicio del proyecto nexo-7994a. Se puede cambiar con setSender. Al mandar a un contacto por el buzón de
// los relés, se le pide a este enviador que dispare el «toque» de Google que despierta su teléfono aunque esté cerrado. Por
// aquí SOLO va el token (nunca el contenido). Ver push-sender/cloudflare/ y docs/FCM.md.
var DEFAULT_SENDER = 'https://nexo-wake.maurizioamistani.workers.dev';
var STATE_FILE = 'nexo_net.json';
var N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'); // orden de secp256k1

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _relayHost(url) { return String(url || '').replace(/^wss?:\/\//, '').replace(/\/.*$/, ''); } // P5: host del relé para el registro
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

// Defensa en profundidad (auditoría, 2998): antes NO se comprobaba la firma del evento Nostr ni que su id fuera el sha256 de su contenido, así
// que un relé podía tocar cualquier campo (fecha, etiquetas) de un evento que reenvía. Ahora un evento del buzón solo entra si su id es el
// sha256 canónico (NIP-01) y su firma Schnorr es válida para su pubkey. (El contenido ya iba cifrado y autenticado por pareja: esto cierra
// la manipulación de lo de fuera del sobre.)
export function netEventValid(ev) {
  try {
    if (!ev || typeof ev.id !== 'string' || typeof ev.pubkey !== 'string' || typeof ev.sig !== 'string') return false;
    if (!/^[0-9a-f]{64}$/.test(ev.id) || !/^[0-9a-f]{64}$/.test(ev.pubkey) || !/^[0-9a-f]{128}$/.test(ev.sig)) return false;
    var id = sha256(_utf8(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content])));
    if (bytesToHex(id) !== ev.id) return false;
    return schnorr.verify(hexToBytes(ev.sig), id, hexToBytes(ev.pubkey)) === true;
  } catch (e) { return false; }
}
export var netMakeEvent = _event;   // para las pruebas (tests/sim/evsig.js)

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
    this.fcmToken = ''; // token FCM de ESTE teléfono (lo da el nativo); se comparte con los contactos en el saludo
    this.tor = { ready: false, onion: '', port: 0, starting: false, triedAt: 0, error: '' };
    this._tagSig = '';
    this._timer = null;
    this.gw = new GwLink(this); // dueño 13-11: puente a internet por un NEXO cercano (gw_link.js)
  }

  relayUrls() {
    // NEXO_NET_RELAYS puede estar SIN definir (producción normal → relés por defecto) o ser una lista EXPLÍCITA,
    // incluida la lista vacía (el simulador la usa para decir "sin internet").
    var cfg = (typeof window !== 'undefined') ? window.NEXO_NET_RELAYS : undefined;
    var safe = (cfg || DEFAULT_RELAYS).filter(_relaySafe);
    if (safe.length) return safe;
    // Sin relés seguros. Ronda 2789: distinguir dos casos (antes ambos caían a DEFAULT_RELAYS, y eso convertía una
    // lista vacía explícita en los relés PÚBLICOS reales → en CI algunas pruebas "se conectaban a internet" y su
    // resultado quedaba al azar; así fallaron las APK 2788 y 2789):
    //  - lista EXPLÍCITAMENTE vacía ([]) → respetar "sin relés" (no inventar internet).
    //  - configuraron relés pero TODOS eran en claro (ws:// remoto) → caer a los wss:// por defecto (F9: no dejar sin internet).
    return (cfg && cfg.length === 0) ? [] : DEFAULT_RELAYS;
  }
  me() { return _nid(this.ble && this.ble.localNexoId); }

  async init() {
    var self = this, pl = _plugin();
    if (self._inited) return;
    self._inited = true;
    try { var r = pl && await pl.loadFromFile({ filename: STATE_FILE }); if (r && r.exists && r.content) self.state = JSON.parse(r.content) || self.state; } catch (e) {}
    self._migrateState();
    // FCM «despertador» (#87, Fase 2): el token de este teléfono (para que los contactos puedan despertarlo) y los
    // tokens que ya conocíamos de ellos (sobreviven al reinicio, así se puede despertar aunque no haya saludo reciente).
    try { if (pl && typeof pl.getFcmToken === 'function') { var ft = await pl.getFcmToken(); if (ft && ft.token) self.fcmToken = ft.token; } } catch (e) {}
    try { if (self.state.peerFcm) Object.keys(self.state.peerFcm).forEach(function(nx) { self._peer(nx).fcmToken = self.state.peerFcm[nx]; }); } catch (e) {}
    self._drainPending = true; // 3033: al arrancar, lo que la parte nativa recibió con la app cerrada entra ya (ver _drainBg)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function() {
      // A segundo plano: la parte nativa sigue desde lo último que vio la app
      if (document.visibilityState === 'hidden') { self._bgSinceDirty = true; self._hiddenAt = Date.now(); self._bgConfig(); }
      if (document.visibilityState === 'visible') {
        // Tras un rato en segundo plano las conexiones pueden haberse caído: reconectar ya (sin esperar la pausa)
        self.relays.forEach(function(r) { r.retryAt = 0; r.backoff = 2000; });
        // 3011: y las que siguen «abiertas» pueden estar muertas sin saberlo (S24 3010: 12 min fuera → todo ✗): comprobarlas
        if (self._hiddenAt && Date.now() - self._hiddenAt >= RELAY_BG_PROBE_MS) self._probeRelays('al volver a la app');
        self._hiddenAt = 0;
        self._drainPending = true; // 3033: lo que llegó en segundo plano entra al chat ya, sin esperar a los relés
        self.tick().then(function() { self._helloAll(true); });
      }
    });
    if (pl && typeof pl.addListener === 'function') {
      // Entró a una red Wi-Fi: si no tengo internet propio, reconectar YA (antes se esperaba la pausa de reintento, hasta 2 min)
      pl.addListener('onLanNet', function() { if (!self._realOpenCount()) self.relays.forEach(function(r) { if (!r.gw && !r.ws) { r.retryAt = 0; r.backoff = 2000; } }); self.tick(); });
      // 3085: cambió la red por defecto del teléfono (Wi-Fi ↔ datos móviles; Kotlin watchDefaultNetwork)
      pl.addListener('onNetChange', function(ev) { try { self._onNetChange(ev); } catch (e) {} });
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
    try { self.gw.tick(); } catch (e) { console.warn('[GW] ' + (e && e.message)); }
    try { var st = pl && typeof pl.lanStatus === 'function' ? await pl.lanStatus() : null; self.wifi = !!(st && st.wifi); } catch (e) {}
    var changed = await self._refreshTags();
    if (changed) self._bgConfig();
    if (!self.inTags.size && !self.reqTags.size) { self._closeAll(); return; }
    if (self._drainPending && self.inTags.size) { self._drainPending = false; self._drainBg(); }
    var urls = self.relayUrls();
    urls.forEach(function(u) {
      var r = self.relays.get(u);
      if (!r || (!r.ws && now >= (r.retryAt || 0))) self._connect(u);
      else if (changed && r.open) { if (r.challenge) self._auth(u, r, r.challenge); self._subscribe(r); }
    });
    // En línea / desconectado
    self.peers.forEach(function(p, nx) {
      var up = now - (p.lastRx || 0) < UP_MS && (self.online() || !!p.torUp); // 3050: sin relés no está «en línea por internet»
      // Pasó a Wi-Fi estando en línea: lo que esperaba (archivos) puede salir ya
      if (up && p.up && p.wifi && !p.wifiWas && self.wifi && self.ble && typeof self.ble._netUp === 'function') self.ble._netUp(nx);
      p.wifiWas = !!p.wifi;
      if (up !== !!p.up) {
        p.up = up;
        console.log('[NET] ' + nx + (up ? ' en línea por internet' + (p.wifi ? ' (Wi-Fi)' : ' (datos móviles)') : ' ya no está en línea por internet'));
        if (self.ble) { if (up && typeof self.ble._netUp === 'function') self.ble._netUp(nx); else if (!up && typeof self.ble._netDown === 'function') self.ble._netDown(nx); }
      }
    });
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      // 3011: un relé que lleva rato sin decir nada puede estar muerto sin saberlo (cambio de red): se comprueba
      var idle = false; self.relays.forEach(function(r) { if (r.open && !r.probing && now - (r.rxAt || r.openedAt || now) > RELAY_IDLE_PROBE_MS) idle = true; });
      if (idle) self._probeRelays('callado más de 2 min', RELAY_IDLE_PROBE_MS);
      self._helloAll(false);
    }
    self._torTick();
  }

  _openCount() { var n = 0; this.relays.forEach(function(r) { if (r.open) n++; }); return n; }
  online() { return this._openCount() > 0; }
  // Dueño 13-11: en línea SOLO por un puente (otro NEXO cercano presta su internet, gw_link.js). Por ahí van textos;
  // archivos y fotos no (filesOk/mailboxFilesOk): quedan ⏳ hasta tener internet propio o un camino directo.
  _realOpenCount() { var n = 0; this.relays.forEach(function(r) { if (r.open && !r.gw) n++; }); return n; }
  gwOnly() { return this._openCount() > 0 && this._realOpenCount() === 0; }
  canReach(nexoId) {
    var nx = _nid(nexoId), p = this.peers.get(nx);
    // por el puente, un contacto con Bluetooth directo listo va por su Bluetooth (no «internet» por el Bluetooth de otro)
    if (this.gwOnly() && this.ble && typeof this.ble._bleReadyFor === 'function' && this.ble._bleReadyFor(nx)) return false;
    return !!(p && p.up && (this.online() || p.torOk) && this.pairs.has(nx));
  }
  via(nexoId) { var p = this.peers.get(_nid(nexoId)); return p && p.torOk ? 'tor' : 'relés'; }
  bothWifi(nexoId) { var p = this.peers.get(_nid(nexoId)); return !!(this.wifi && p && p.wifi); }
  // Archivos por internet solo si los dos están en Wi-Fi (con datos móviles cuestan dinero)
  filesOk(nexoId) { return this.canReach(nexoId) && this.bothWifi(nexoId) && !this.gwOnly(); }
  // Buzón para ARCHIVOS/fotos (y el buzón de archivos): como mailboxOk; por un puente solo lo pequeño (parte 3 del puente,
  // dueño 13-11: fotos y notas de voz del chat hasta GW_FILE_MAX_B64 caracteres). Sin tamaño (b64len) no pasa por un puente.
  // Parte 4: con Wi-Fi Direct al puente y el puente en Wi-Fi, hasta lo que admite el buzón de archivos (gw.fileMaxB64).
  mailboxFilesOk(nexoId, b64len) {
    if (!this.mailboxOk(nexoId)) return false;
    if (!this.gwOnly()) return true;
    var max = this.gw && typeof this.gw.fileMaxB64 === 'function' ? this.gw.fileMaxB64() : GW_FILE_MAX_B64;
    return typeof b64len === 'number' && b64len > 0 && b64len <= max;
  }
  // Parte 4 del puente: una foto/archivo con este contacto por internet va al BUZÓN DE ARCHIVOS aunque esté en línea (yo sin
  // internet propio, o él está por un puente): sus trozos el puente los acota por bytes y los lleva en un paquete por Wi-Fi
  // Direct; como mensajes sueltos irían de uno en uno por Bluetooth
  viaBridge(nexoId) { var p = this.peers.get(_nid(nexoId)); return this.gwOnly() || !!(p && p.gw && p.up); }
  // Parte 4 del puente (blob_mailbox.js): sin internet propio, trozos a la vez y esperas según el camino al puente (Wi-Fi
  // Direct: tandas grandes en un paquete; Bluetooth: un trozo son ~3 s de radio). 0 = lo de siempre.
  blobPar() { return this.gwOnly() && this.gw ? this.gw.blobPar() : 0; }
  blobPublishMs(t) { return this.gwOnly() && this.gw ? this.gw.publishMs(t) : t; }
  blobFetchBatch(url) { var r = this._relayFor(url); return r && r.gw && this.gw ? this.gw.fetchBatch(r) : 0; }
  blobFetchMs(url, t) { var r = this._relayFor(url); return r && r.gw && this.gw ? this.gw.fetchMs(r, t) : t; }
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
    if (!self._openCount()) self._netTryAt = self._netTryAt || Date.now(); // 3081: desde cuándo se intenta tener internet
    try { ws = r.factory ? r.factory() : new WebSocket(url); } catch (e) { r.retryAt = Date.now() + r.backoff; return; }
    r.ws = ws; r.open = false;
    ws.onopen = function() {
      r.open = true; r.backoff = 2000; r.openedAt = Date.now(); r.rxAt = r.openedAt;
      self._subscribe(r);
      if (!r.gw && self.gw && typeof self.gw.realBack === 'function') self.gw.realBack(); // 3052: soltar los puentes a tiempo
      // 3050: a los vecinos a los que dije «no tengo internet», se lo ofrezco ya
      if (!r.gw && self.gw && self.gw.askedBy && self.gw.askedBy.size) setTimeout(function() { try { self.gw._offerAskers(Date.now()); } catch (e) {} }, 500);
      if (self._netChangeAt && !r.gw) {
        console.log('[NET] Relés listos tras el cambio de red en ' + ((Date.now() - self._netChangeAt) / 1000).toFixed(1).replace('.', ',') + ' s'); // i18n-ok: registro (3085)
        try { if (typeof window.NEXO_noteConnect === 'function') window.NEXO_noteConnect('internet', Date.now() - self._netChangeAt); } catch (e) {}
        self._netChangeAt = 0;
      }
      if (self._openCount() === 1) {
        console.log('[NET] Conectado a internet por relés públicos');
        try { if (self._netTryAt && typeof window.NEXO_noteConnect === 'function') window.NEXO_noteConnect('internet', Date.now() - self._netTryAt); } catch (e) {} // 3081
        self._netTryAt = 0;
        setTimeout(function() { self._helloAll(!self._greeted); }, 300); // avisar a los contactos de que estoy
        // Ronda 2780 (pedido del dueño): volvió el internet → reenviar fotos/archivos/textos que quedaron en espera
        if (self.ble && typeof self.ble._netOnline === 'function') setTimeout(function() { self.ble._netOnline(); }, 800);
      }
    };
    ws.onmessage = function(ev) { r.rxAt = Date.now(); self._onRelayMsg(url, r, ev.data); };
    ws.onclose = function() {
      var was = r.open;
      var stableFor = r.openedAt ? (Date.now() - r.openedAt) : 0; r.openedAt = 0;
      r.open = false; r.ws = null; r.sub = null;
      // P5: decide el retraso (reintento normal con backoff, o apartar el relé si flapea y quedan otros)
      var delay = self._noteRelayClose(r, url, stableFor);
      if (r._sidelined) { if (!r._sidelinedLog) { console.log('[NET] Relé inestable ' + _relayHost(url) + ': lo aparto ~' + Math.round(delay / 60000) + ' min (se cae sin parar)'); r._sidelinedLog = true; } }
      else { r._sidelinedLog = false; }
      r.waits.forEach(function(fn) { fn(false); }); r.waits.clear();
      if (was && !self.online()) { console.log('[NET] Sin relés: internet no disponible'); self._peersDown(); }
      if (was && !r.gw && !self._realOpenCount() && self.gw && typeof self.gw.realLost === 'function') self.gw.realLost();
      // 3050: sin internet propio, el reintento va a su hora (no al siguiente latido de 15 s): al volver la señal se nota en ≤ 15 s
      if (!r.gw && !self._realOpenCount()) setTimeout(function() {
        if (!r.ws && self.relays.get(url) === r && Date.now() >= (r.retryAt || 0) && (self.inTags.size || self.reqTags.size)) self._connect(url);
      }, delay + 50);
    };
    ws.onerror = function() {};
  }
  // Medición de caminos (3050): sin NINGÚN relé (ni propio ni por puente) los contactos dejan de estar «en línea por internet» YA
  // (antes seguían así hasta que caducaba su último saludo, ~2 min): sus envíos y el puente de Jump por internet pasan al
  // Bluetooth al momento (se vio un texto reintentado 5 veces por «internet» y en cola casi 2 min). Tor directo no depende de esto.
  _peersDown() {
    var self = this;
    self.peers.forEach(function(p, nx) {
      if (!p.up || p.torUp) return;
      p.up = false;
      if (self.ble && typeof self.ble._netDown === 'function') { try { self.ble._netDown(nx); } catch (e) {} }
    });
  }
  // P5 (dueño 01-11): relés abiertos distintos de `url` (para decidir si se puede apartar uno que flapea sin quedarse sin red)
  _openRelaysExcept(url) { var n = 0; this.relays.forEach(function(r, u) { if (u !== url && r.open) n++; }); return n; }
  // P5: al cerrarse un relé, actualiza su contador de flaps y elige el retraso del próximo intento. Un relé que abrió y se
  // cayó enseguida (vida < RELAY_STABLE_MS) suma un flap; con RELAY_FLAP_MAX flaps en la ventana y ≥RELAY_MIN_OTHERS relés
  // abiertos, se aparta RELAY_FLAP_PENALTY_MS (en vez del backoff normal). Una conexión estable olvida los flaps viejos.
  _noteRelayClose(r, url, stableFor, now) {
    now = now || Date.now();
    if (stableFor > 0 && stableFor < RELAY_STABLE_MS) {
      r.flapTimes = (r.flapTimes || []).filter(function(t) { return now - t < RELAY_FLAP_WINDOW_MS; });
      r.flapTimes.push(now);
    } else if (stableFor >= RELAY_STABLE_MS) {
      r.flapTimes = []; // estuvo estable: no arrastrar flaps antiguos
    }
    if ((r.flapTimes || []).length >= RELAY_FLAP_MAX && this._openRelaysExcept(url) >= RELAY_MIN_OTHERS) {
      r._sidelined = true;
      r.retryAt = now + RELAY_FLAP_PENALTY_MS;
      return RELAY_FLAP_PENALTY_MS;
    }
    r._sidelined = false;
    var delay = r.backoff;
    // Medición de caminos (dueño 13-11, 3050): sin internet propio la pausa crecía hasta 2 min; al volver la señal (datos
    // móviles o Wi-Fi) la app tardaba ~75 s en darse cuenta y seguía por el puente. Sin ningún relé propio abierto, como mucho
    // RELAY_OFFLINE_RETRY_MS (sin red, el intento falla al instante y no gasta). Con otros relés abiertos, la pausa de siempre.
    if (!this._realOpenCount()) delay = Math.min(delay, RELAY_OFFLINE_RETRY_MS);
    r.retryAt = now + delay;
    r.backoff = Math.min(r.backoff * 2, 120000);
    return delay;
  }
  _closeAll() { this.relays.forEach(function(r) { try { if (r.ws) r.ws.close(); } catch (e) {} }); }
  _send(r, arr) { try { if (r.ws && r.open) { r.ws.send(JSON.stringify(arr)); return true; } } catch (e) {} return false; }
  // 3011: pregunta mínima (una búsqueda por un id que no existe: todo relé contesta EOSE) a los relés abiertos; el que no dice
  // NADA en RELAY_PROBE_MS se da por muerto y se reconecta. minIdle: solo los que llevan callados al menos eso.
  _probeRelays(why, minIdle) {
    var self = this, t0 = Date.now();
    self.relays.forEach(function(r, u) {
      if (!r.open || !r.ws || r.probing) return;
      if (minIdle && t0 - (r.rxAt || r.openedAt || t0) <= minIdle) return;
      var ws = r.ws, sub = 'pb' + bytesToHex(_rnd(4));
      r.probing = true;
      self._send(r, ['REQ', sub, { ids: [RELAY_PROBE_ID], limit: 1 }]);
      setTimeout(function() {
        r.probing = false;
        if (r.ws !== ws || !r.open) return;            // ya se cerró o se reconectó entretanto
        if ((r.rxAt || 0) < t0) self._dropDead(u, r, why);
        else self._send(r, ['CLOSE', sub]);
      }, RELAY_PROBE_MS);
    });
  }
  // 3085 (dueño 14-11: «el S24 cambia de Wi-Fi a datos en automático y muy rápido, ¿por qué nosotros somos lentos?»): la app solo
  // escuchaba «entré a un Wi-Fi»; al pasar de Wi-Fi a datos (o al revés) sus conexiones a los relés quedaban colgadas de la red vieja
  // —abiertas para la app, muertas de verdad— hasta que fallaban o hasta la comprobación de relés callados (redcambio.js: lo que le
  // mandaban tardaba 28 s en entrar). Ahora, al cambiar la red, se cierran y se abren por la nueva al momento, y se mide cuánto tardan.
  _onNetChange(ev) {
    var self = this, t = String((ev && ev.type) || ''), prev = String((ev && ev.prev) || '');
    var NAMES = { wifi: 'Wi-Fi', cell: 'datos móviles', eth: 'cable', vpn: 'VPN', none: 'sin red', other: 'otra red' }; // i18n-ok: registro
    var nm = function(x) { return NAMES[x] || x || '?'; };
    console.log('[NET] Cambio de red: ' + nm(prev) + ' → ' + nm(t) + (t === 'none' ? ': espero a que vuelva' : ': reconecto los relés ya')); // i18n-ok: registro para el diagnóstico
    if (t === 'none') { self._netChangeAt = 0; return; }
    self._netChangeAt = Date.now();
    self.relays.forEach(function(r, u) {
      if (r.gw) return;   // los puentes Bluetooth no dependen de la red del teléfono
      if (r.ws) self._dropDead(u, r, 'cambio de red');
      else { r.retryAt = 0; r.backoff = 2000; }
    });
    self.tick();
  }
  // 3011: los relés que no dijeron nada desde `since` (a un envío sin respuesta de ninguno) se dan por muertos
  _dropSilent(since, why) {
    var self = this;
    self.relays.forEach(function(r, u) { if (r.open && r.ws && (r.rxAt || 0) < since) self._dropDead(u, r, why); });
  }
  // 3011: cierra una conexión muerta SIN esperar su cierre (en una conexión muerta puede tardar minutos) y reconecta ya
  _dropDead(url, r, why) {
    var ws = r.ws, was = r.open;
    console.warn('[NET] Relé ' + _relayHost(url) + (why === 'cambio de red' ? ': la red cambió, reconecto por la nueva' : ' no contesta (' + why + '): conexión muerta, reconecto')); // i18n-ok: registro
    if (ws) { ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null; try { ws.close(); } catch (e) {} }
    r.open = false; r.ws = null; r.sub = null; r.openedAt = 0; r.probing = false;
    r.waits.forEach(function(fn) { try { fn(false, 'conexión muerta'); } catch (e) {} }); r.waits.clear();
    if (was && !this.online()) { console.log('[NET] Sin relés: internet no disponible'); this._peersDown(); }
    r.retryAt = 0; r.backoff = 2000;
    this._connect(url);
  }

  _subscribe(r) {
    if (r.sub) this._send(r, ['CLOSE', r.sub]);
    r.sub = 'nx' + bytesToHex(_rnd(6));
    var since = Math.max(0, Math.floor((this.state.lastSeen || (Date.now() - 2 * 86400000)) / 1000) - 600);
    this._send(r, ['REQ', r.sub, { kinds: [KIND], '#p': Array.from(this.inTags.keys()).concat(Array.from(this.reqTags.keys())), since: since }]);
  }

  _onRelayMsg(url, r, data) {
    var m;
    // SEC-4 (auditoría 28-10): un relé malicioso podría mandar un frame enorme → pico de memoria del WebView. Igual que
    // el nativo (SafeJson), se descarta lo que exceda con holgura un evento legítimo antes de analizarlo.
    if (typeof data === 'string' && data.length > MAX_RELAY_FRAME) { console.warn('[NET] Frame de relé demasiado grande (' + data.length + '): descartado'); return; }
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!Array.isArray(m)) return;
    // Fase B (2969): respuestas a una bajada por id (fetchEvents) — van a su recolector, no al buzón
    if (r.fetches && typeof m[1] === 'string' && r.fetches.has(m[1])) {
      var fj = r.fetches.get(m[1]);
      if (m[0] === 'EVENT' && m[2]) fj.onEvent(m[2]);
      else if (m[0] === 'EOSE' || m[0] === 'CLOSED') fj.done();
      return;
    }
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
      var ev = _event(sk, 22242, [['relay', r.realUrl || url], ['challenge', challenge]], ''); // por un puente: el relé de verdad
      r.waits.set(ev.id, function() { if (--pending === 0) { r.authed = true; if (r.needSub) { r.needSub = false; self._subscribe(r); } } });
      self._send(r, ['AUTH', ev]);
    });
  }

  async _onEvent(ev) {
    if (!ev || typeof ev.id !== 'string' || this.seen.has(ev.id)) return;
    if (!netEventValid(ev)) { this._badSig = (this._badSig || 0) + 1; if (this._badSig <= 3 || this._badSig % 50 === 0) console.warn('[NET] Evento con id o firma inválidos: descartado (' + this._badSig + ')'); return; }
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
    // SEC-1 (auditoría 28-10): created_at es externo y la firma del evento no se verifica; un contacto —o un relé que
    // reenvía un sobre cambiándole la fecha— podía ponerlo en el futuro y envenenar lastSeen → el filtro `since` saltaba
    // al futuro y el teléfono dejaba de recibir CUALQUIER mensaje por internet, para siempre. Se acota a «ahora» (igual
    // que el Estado con fecha futura, EST1).
    var at = Math.min((Number(ev.created_at) || 0) * 1000, Date.now());
    if (at > (this.state.lastSeen || 0)) { this.state.lastSeen = at; this._saveState(); }
    this._deliver(nx, o);
  }

  // 3033 (dueño 12-11: «si me llega un mensaje ya debe de quedarse en el chat y no cargarse cuando yo abro el chat»): con la
  // app en segundo plano la parte nativa (NetBg) recibe y AVISA, pero el mensaje se volvía a pedir a los relés al volver (17 s
  // o más si un relé no contestaba). Ahora la parte nativa guarda los eventos que recibió y aquí entran en el acto, por el
  // mismo camino que los del relé (firma, pareja, repetidos: _onEvent). Lo que luego mande el relé ya está visto.
  async _drainBg() {
    var pl = _plugin();
    if (!pl || typeof pl.netBgDrain !== 'function') return 0;
    var res = null;
    try { res = await pl.netBgDrain(); } catch (e) { return 0; }
    var evs = (res && Array.isArray(res.events)) ? res.events : [];
    // 3044 (diagnóstico S24 APK 3033: «500 sobre(s) … entran ya» tras una llamada en segundo plano con la app viva: eran
    // repetidos que la app ya había procesado; _onEvent los descarta, pero el registro los contaba como nuevos)
    var n = 0, dup = 0;
    for (var i = 0; i < evs.length && i < 600; i++) {
      var ev = null;
      try { ev = typeof evs[i] === 'string' ? JSON.parse(evs[i]) : evs[i]; } catch (e) { ev = null; }
      if (!ev || typeof ev !== 'object') continue;
      if (typeof ev.id === 'string' && this.seen.has(ev.id)) { dup++; continue; }
      try { await this._onEvent(ev); n++; } catch (e) {}
    }
    if (n) console.log('[NET] ' + n + ' sobre(s) que el teléfono recibió en segundo plano: entran ya (sin esperar a los relés)' + (dup ? '; ' + dup + ' repetido(s) ya vistos' : ''));
    else if (dup) console.log('[NET] Lo recibido en segundo plano ya lo tenía la app: ' + dup + ' repetido(s), nada nuevo');
    return n;
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
      this.ble._onNetRequest({ id: from, pk: o.pk, name: String(o.name || '').replace(/[<>]/g, '').slice(0, 40), kind: o.t, ph: typeof o.ph === 'string' ? o.ph.replace(/[<>]/g, '').slice(0, 16) : '', em: typeof o.em === 'string' ? o.em.replace(/[<>]/g, '').slice(0, 24) : '' });
    }
  }

  _deliver(nx, o) {
    var peer = this._peer(nx);
    var t = Number(o.t) || 0, now = Date.now();
    // Su dirección de Tor (va en el saludo cifrado): si los dos tenemos Tor, conectar directamente
    if (typeof o.o === 'string' && /^[a-z2-7]{56}\.onion$/.test(o.o)) { peer.onion = o.o; peer.torPort = Number(o.op) || 0; this._torDial(nx); }
    // FCM «despertador» (#87, Fase 2): su token (va en el saludo cifrado de la pareja). Se guarda para poder pedir el
    // «toque» que lo despierta cuando le mandemos algo por el buzón. Longitud acotada (un token real ~140-200 chars).
    if (typeof o.f === 'string' && o.f.length >= 20 && o.f.length <= 4096 && o.f !== peer.fcmToken) {
      peer.fcmToken = o.f;
      if (!this.state.peerFcm) this.state.peerFcm = {};
      this.state.peerFcm[nx] = o.f; this._saveState();
    }
    // Solo lo reciente cuenta para "en línea" (lo guardado de hace rato es del buzón)
    if (now - t < UP_MS && t > (peer.lastRx || 0)) { peer.lastRx = t; peer.wifi = !!o.w; peer.gw = !!o.g; }
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
    // Build 2837 (pedido del dueño): una oferta de llamada/videollamada también despierta — tiene que SONAR aunque el
    // otro esté dormido en ahorro de batería (antes solo despertaban los mensajes de texto/archivos).
    else if (o && o.type === 'nexo_call' && o.op === 'offer' && typeof o.id === 'string') id = o.id;
    // #130b (dueño 31-10): una INVITACIÓN a una llamada de GRUPO (nexo_gcall/invite) también despierta y suena como
    // llamada. La invitación REAL va type:'chat' con cl:1 por fuera (sendChatMessage); se acepta también la cruda por si
    // algún camino la mandara sin sobre (p. ej. el buzón directo de group_call._signal).
    else if (o && o.type === 'nexo_gcall' && o.op === 'invite' && typeof o.gid === 'string') id = o.gid;
    else if (o && (o.t === 'c' || o.t === 'f') && o.i === 0 && !o.hf && typeof o.m === 'string') id = o.m;
    if (!id) return null;
    var quiet = this.ble && this.ble._quietOut;
    return quiet && quiet.has(id) ? null : id;
  }
  // #130 (dueño 30-10): ¿es una OFERTA de llamada/videollamada? (para que el «toque» insista en despertar, con su
  // propio throttle, aunque un texto reciente ya haya gastado el de textos). El sobre REAL que arma la app para una
  // oferta es type:'chat' con la marca cl:1 por FUERA (ble_messages `_sendMessageNative`, la MISMA marca que lee el
  // nativo en BgInbox); la oferta va cifrada dentro, así que NO se puede mirar «nexo_call» en el texto. Se acepta
  // también la oferta cruda (type:'nexo_call') por si algún camino la mandara sin sobre. Barato: guarda antes de parsear.
  _isCallOffer(p) {
    if (typeof p !== 'string' || (p.indexOf('"cl":1') < 0 && p.indexOf('nexo_call') < 0 && p.indexOf('nexo_gcall') < 0)) return false;
    try { var o = JSON.parse(p); return !!(o && (o.cl === 1 || (o.type === 'nexo_call' && o.op === 'offer') || (o.type === 'nexo_gcall' && o.op === 'invite'))); } catch (e) { return false; }
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
  // Dueño 10-11: «Tor siempre» debe venir DESAPAGADO por defecto y que lo active el usuario si quiere. Antes de 2867 el
  // defecto era «encendido», y teléfonos con ese estado viejo lo muestran palomeado sin que el usuario lo haya pedido.
  // Una sola vez (marca torMig): se quita el «true» heredado; si el usuario lo vuelve a encender, se respeta para siempre.
  _migrateState() {
    var st = this.state;
    if (!st || st.torMig) return false;
    st.torMig = 1;
    var changed = false;
    if (st.tor === true) { delete st.tor; changed = true; }
    this._saveState();
    return changed;
  }
  // Tor es MÁS LENTO que los relés: por defecto NO corre (pedido del dueño 01-11: «no quiero Tor por defecto siendo más
  // lento»). Se enciende de dos formas: (1) el usuario lo activa a mano en Ajustes para ocultar su IP siempre
  // (state.tor === true); (2) BAJO DEMANDA (_torNeeded) cuando una videollamada o un archivo grande van por internet, que
  // solo pueden ir por Tor directo (los relés no pueden). Si state.tor === false, el usuario lo apagó aposta: ni a demanda.
  torWanted() { return this.state.tor === true || (this.state.tor !== false && !!this._torNeeded); }
  setTor(on) {
    this.state.tor = !!on; this._saveState();
    var pl = _plugin();
    if (!on && pl && typeof pl.torStop === 'function') { this._torNeeded = false; pl.torStop().catch(function() {}); this.tor.ready = false; this.tor.onion = ''; this.peers.forEach(function(p) { p.torUp = p.torOk = false; }); }
    else this.tick();
  }
  // 3046 (diagnóstico S24 APK 3033 13-11: videollamada por internet sin imagen y ni una línea de Tor en el registro): estado
  // de Tor en palabras, para el diagnóstico (cabecera ESTADO y línea de la llamada)
  torState() {
    var t = this.tor || {};
    if (this.state && this.state.tor === false) return 'APAGADO en Ajustes';
    if (t.ready) return 'listo';
    if (t.starting) return 'arrancando';
    if (t.error) return 'falló (' + String(t.error).slice(0, 60) + ')';
    return this.torWanted() ? 'pedido' : 'sin usar';
  }
  // Pide Tor para ESTA sesión (vídeo/archivo grande por internet). No hace nada si el usuario lo apagó a mano. Devuelve si
  // ya está listo; si no, lo intenta arrancar (tarda unos segundos la 1ª vez) y los caminos que lo necesitan esperan a via==='tor'.
  ensureTor() { if (this.state.tor === false) return false; this._torNeeded = true; this.tick(); return this.tor.ready; }
  // ¿El usuario encendió Tor A MANO (privacidad siempre)? El interruptor de Ajustes refleja ESTO, no el arranque bajo
  // demanda (_torNeeded), para que la casilla no se «palomee» sola por una videollamada. Por defecto apagado (#dueño 01-11).
  torManual() { return this.state.tor === true; }
  // ¿Preferir Tor para ESTE envío? Solo si el usuario lo encendió a mano (privacidad siempre), si no hay relés (offline,
  // Tor es el único camino) o si el que llama lo pide (opts.tor: vídeo/archivo grande por internet, que los relés no
  // pueden). Lo NORMAL online → false → relés (rápido). Extraído para poder probarlo. #dueño 01-11.
  _preferTor(opts) { return (this.state.tor === true) || !this.online() || !!(opts && opts.tor); }
  // #dueño 06-11: un ARCHIVO GRANDE por internet prefiere Tor DIRECTO (sin relés: los relés no aguantan ~25 MB). El que
  // ENVÍA marca al contacto con preferTorFor al arrancar el envío (y arranca Tor a demanda); el que RECIBE arranca Tor
  // (ensureTor) al recibir bloques de un archivo grande. Así, con los dos despiertos (latido 2930/2931), se forma el Tor
  // directo y el archivo viaja por ahí. Dura un rato (TTL): mientras dura el envío. No hace nada si el usuario apagó Tor
  // (ensureTor respeta state.tor===false). send() lee _torPreferred para preferir Tor para ese contacto.
  preferTorFor(nexoId, ttlMs) {
    try {
      var nx = _nid(nexoId); if (!nx) return;
      if (!this._torPref) this._torPref = new Map();
      this._torPref.set(nx, Date.now() + (ttlMs || 600000)); // 10 min por defecto (lo que suele durar un envío grande)
      this.ensureTor();
    } catch (e) {}
  }
  _torPreferred(nexoId) { try { var t = this._torPref && this._torPref.get(_nid(nexoId)); return !!t && t > Date.now(); } catch (e) { return false; } }
  _torTick() {
    var pl = _plugin(), now = Date.now();
    if (!pl || typeof pl.torStart !== 'function' || !this.torWanted() || this.tor.ready || this.tor.starting) return;
    // Con Wi-Fi para la privacidad automática (arrancar Tor gasta datos); pero BAJO DEMANDA (_torNeeded: el usuario
    // arrancó un vídeo/archivo grande por internet) se permite también con datos, porque lo pidió él. Siempre hace falta
    // tener contactos con los que usarlo; reintento cada 10 min.
    if ((!this.wifi && !this._torNeeded) || !this.inTags.size || now - (this.tor.triedAt || 0) < 600000) return;
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
    if (this.gwOnly()) body.g = 1; // puente parte 4: «estoy por un puente»: mándame fotos/archivos al buzón de archivos
    if (opts && opts.hello) { body.h = 1; if (this.tor.ready && this.tor.onion) { body.o = this.tor.onion; body.op = this.tor.port; } if (this.fcmToken) body.f = this.fcmToken; }
    // #130b (dueño 31-10): una oferta de llamada/videollamada (1-a-1 o invitación de grupo) marca el sobre con cl:1, para
    // que la escucha nativa de internet en segundo plano (NetBg) la saque como LLAMADA a pantalla completa (enciende el
    // teléfono, Contestar/Rechazar), no como un aviso de mensaje. El síntoma del dueño era justo ese: con la pantalla
    // apagada sonaba y llegaba «un mensaje nuevo» en vez de la pantalla de llamada.
    else { body.p = String(content); var nid = this._newMsgId(body.p); if (nid) body.n = nid; var callOffer = nid ? this._isCallOffer(body.p) : false; if (callOffer) body.cl = 1; }
    // 3087: «colgar» del que llama (env.ce = id de su oferta) también por fuera del sobre: la escucha nativa de internet (NetBg) deja
    // de sonar al momento con la app cerrada
    if (body.p) { var ceM = /"ce":"(cs[0-9a-f]{12})"/.exec(body.p); if (ceM) body.ce = ceM[1]; }
    // 3089: oferta de VIDEOllamada (env.cv o la señal cruda con v:1): la escucha nativa de internet dice «Videollamada entrante»
    if (body.cl && body.p && (/"cv":1/.test(body.p) || (/"nexo_call"/.test(body.p) && /"op":"offer"/.test(body.p) && /"v":1/.test(body.p)))) body.cv = 1;
    // Build 2967 (Fase A, docs/CONTRATOS_ENTREGA_OFFLINE_FASE_AB.md §6 «token en los dos sentidos»): la MARCA del buzón de un
    // mensaje NUEVO lleva también mi token FCM. Antes iba SOLO en el saludo, que caduca en el relé a los 10 min (TTL_HELLO):
    // un contacto dormido horas leía mi mensaje (TTL 7 días) pero no mi token → no podía tocarme a mí (mutuo) ni despertarme
    // después si mi token había rotado. Una vez por mensaje (nid), nunca por trozo/ack/control (peso ~160 B). El que recibe
    // ya guarda el token de cualquier sobre (_deliver).
    if (!(opts && opts.hello) && nid && this.fcmToken) body.f = this.fcmToken;
    var seal = async function() { var iv = _rnd(12); var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: _utf8('NEXO-NET|' + me + '|' + nx) }, pair.aes, _utf8(JSON.stringify(body)))); return _b64(_cat(iv, ct)); };
    var b64 = await seal();
    var peer = this._peer(nx), pl = _plugin();
    // Tor es más lento: para lo NORMAL (texto, fotos) se prefieren los relés (rápido). Se usa Tor solo si el usuario lo
    // encendió a mano para privacidad (state.tor === true), si no hay relés (offline) o si el que llama lo pide
    // (opts.tor: vídeo/archivo grande por internet, que los relés no pueden). Si no, se cae a los relés más abajo (sin
    // pérdida: si los relés fallan, el mensaje queda pendiente y se reintenta / buzón). #dueño 01-11.
    var preferTor = this._preferTor(opts) || this._torPreferred(nx); // #dueño 06-11: un archivo grande marcó a este contacto para Tor
    if (preferTor && peer.torUp && (peer.torOk || (opts && opts.hello)) && pl && typeof pl.torSend === 'function') {
      try { await pl.torSend({ nx: nx, content: b64 }); return true; } catch (e) { peer.torUp = false; peer.torOk = false; }
    }
    // Lección 2964 (el tope del relé es sobre el evento YA codificado): si el token hace que el sobre se pase, va SIN token
    // antes que no ir (p. ej. el primer trozo de un archivo, que ya viene al límite).
    if (b64.length > MAX_CONTENT && body.f && !(opts && opts.hello)) { delete body.f; b64 = await seal(); }
    if (b64.length > MAX_CONTENT) throw Object.assign(new Error('Demasiado grande para internet'), { code: 'NET_TOO_BIG' });
    var ttl = (opts && opts.hello) ? TTL_HELLO : this._ttlFor(String(content || ''));
    var tag = this._tag(pair, nx, _day(0));
    var ev = _event(schnorr.utils.randomSecretKey(), KIND, [['p', tag.pub], ['expiration', String(Math.floor(Date.now() / 1000) + ttl)]], b64);
    var pub = this._publish(ev);
    // FCM «despertador» (#87, Fase 2): salió por el buzón de los relés (si fuera por Tor directo ya habría vuelto
    // arriba). M1 (auditoría 28-10): pedir el «toque» SOLO por un mensaje nuevo de verdad (nid: texto nuevo o primer
    // trozo de un archivo) — NUNCA por cada trozo/ack/control; un archivo grande serían miles de toques = cuota de FCM
    // agotada (tumbaría el propio #87) y batería del par. El throttle por par (en _wake) cubre además las ráfagas.
    if (!(opts && opts.hello) && nid) { var self = this; pub.then(function() { self._wake(nx, callOffer); }, function() {}); }
    return pub;
  }

  // FCM «despertador» (#87, Fase 2): URL del enviador (Cloud Function del dueño). Por defecto la estándar del proyecto;
  // se puede cambiar (setSender) si el despliegue da otra. Vacía = despertador apagado (no se piden toques).
  senderUrl() { return (this.state.senderUrl != null) ? this.state.senderUrl : DEFAULT_SENDER; }
  setSender(url) { this.state.senderUrl = String(url == null ? '' : url); this._saveState(); }
  // Pide al enviador que dispare el «toque» de Google al token del contacto. SOLO viaja el token (nunca el contenido);
  // el mensaje ya va cifrado por el camino normal. Defensivo: si no hay token/enviador o falla la red, no pasa nada.
  _wake(nx, isCall, why) {
    try {
      var peer = this.peers.get(_nid(nx)); if (!peer || !peer.fcmToken) return;
      var url = this.senderUrl(); if (!url) return;
      if (typeof fetch !== 'function') return;
      var viaGw = this.gwOnly(); // sin internet propio: el «toque» lo pide el puente (gw_link.js)
      // M1 (auditoría 28-10): throttle por par — como mucho un toque cada WAKE_MIN_MS (una ráfaga de textos despierta
      // una sola vez; NetBg ya baja el resto en esa sesión). #130 (dueño 30-10): una llamada tiene su propio throttle
      // (CALL_WAKE_MIN_MS), más corto y aparte, para que SIEMPRE despierte aunque un texto reciente haya gastado el de
      // textos (el informe «al llamar no siempre despierta»); dos ofertas pegadas siguen pidiendo un solo toque.
      var now = Date.now();
      if (isCall) {
        if (peer._callWakeAt && (now - peer._callWakeAt) < CALL_WAKE_MIN_MS) return;
        peer._callWakeAt = now;
      } else {
        if (peer._wakeAt && (now - peer._wakeAt) < WAKE_MIN_MS) return;
        peer._wakeAt = now;
      }
      var self = this;
      if (why) console.log('[WAKE] toque a ' + _nid(nx) + ' (' + why + '): que su app esté despierta antes de que salga algo pesado'); // i18n-ok
      if (viaGw) { this.gw.wake(peer.fcmToken); return; }
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: peer.fcmToken }) })
        .then(function(res) {
          // 404 = token caducado/desregistrado: lo olvidamos para pedir uno nuevo en el próximo saludo
          if (res && res.status === 404) { peer.fcmToken = ''; if (self.state.peerFcm) { delete self.state.peerFcm[_nid(nx)]; self._saveState(); } }
        })
        .catch(function() {});
    } catch (e) {}
  }

  // #dueño 06-11 — LATIDO de despertador para un archivo grande por internet. Mientras una transferencia por internet
  // está EN CURSO pero NO avanza (típico: el que recibe tiene la app dormida y por eso no confirma los trozos), se le
  // re-dispara el «toque» para que su app vuelva, siga recibiendo y confirme. Tiene su PROPIO throttle (XFER_WAKE_MIN_MS,
  // bucket _xferWakeAt), aparte del de textos y del de llamadas: como mucho un toque cada 15 s, así que es barato (no
  // gasta la cuota de FCM) y, en cuanto el envío vuelve a fluir, deja de haber timeouts → deja de haber toques. SOLO el
  // token viaja (como _wake), nunca el contenido. Lo llama ble_ack.js en cada window-timeout de un archivo por net:.
  wakeKeepAlive(nexoId) {
    try {
      var nx = _nid(nexoId);
      var peer = this.peers.get(nx); if (!peer || !peer.fcmToken) return false;
      var url = this.senderUrl(); if (!url) return false;
      if (typeof fetch !== 'function') return false;
      var minMs = (typeof window !== 'undefined' && Number(window.NEXO_XFER_WAKE_MS)) || XFER_WAKE_MIN_MS;
      var now = Date.now();
      if (peer._xferWakeAt && (now - peer._xferWakeAt) < minMs) return false;
      peer._xferWakeAt = now;
      var self = this;
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: peer.fcmToken }) })
        .then(function(res) {
          if (res && res.status === 404) { peer.fcmToken = ''; if (self.state.peerFcm) { delete self.state.peerFcm[nx]; self._saveState(); } }
        })
        .catch(function() {});
      return true;
    } catch (e) { return false; }
  }

  // #dueño 06-11 (paso 2b del envío de 25 MB): mientras RECIBO un archivo GRANDE por internet, le pido al nativo que me
  // mantenga despierto de CORRIDO (wakelock + Wi-Fi) para no dormirme a mitad del envío largo con la pantalla apagada;
  // y lo suelto al completarlo. Guardado: si no hay plugin nativo (simulador/navegador) o no tiene el método, es un
  // no-op silencioso. El nativo tiene un tope DURO de seguridad (XferAwake.MAX_HOLD_MS) por si no llega el «soltar».
  xferKeepAwake(on) {
    try {
      var pl = _plugin();
      if (pl && typeof pl.xferKeepAwake === 'function') pl.xferKeepAwake({ on: !!on });
    } catch (e) {}
  }

  // P2 (dueño 01-11): «toque» FCM A PETICIÓN (p.ej. al ABRIR el chat), para despertar a un contacto dormido por internet
  // ANTES de que el usuario escriba — así el 1er mensaje no espera ni se pierde, el enlace se forma antes y aparece el tipo
  // de conexión. Solo si tenemos su token FCM y hay internet (relés abiertos). Reusa el throttle de _wake (una ráfaga de
  // aperturas no spamea). Devuelve true si hay a quién/por dónde despertar, para que la interfaz muestre «Conectando…».
  wakeFor(nexoId, why) {
    try {
      var nx = _nid(nexoId);
      var peer = this.peers.get(nx);
      if (!peer || !peer.fcmToken) return false;
      if (!this.senderUrl() || !this.online()) return false;
      this._wake(nx, false, why);
      return true;
    } catch (e) { return false; }
  }

  // Alta por ID (ronda 2779): deja una solicitud ('req') o una aceptación ('acc') en el buzón del ID `to`, cifrada con la
  // clave de ese ID. Lleva mi NEXO ID, mi clave pública (para que el otro pueda encender el canal seguro) y mi nombre.
  // Se conecta a los relés si hace falta. Resuelve cuando un relé la guardó.
  async sendRequest(toId, type, name, extra) {
    var to = _nid(toId), me = this.me(), pk = e2eMyPublicKey();
    if (!/^nx[0-9a-z]{8}$/.test(to)) throw new Error('ID no válido (debe ser NX y 8 más)');
    if (to === me) throw new Error('Ese es tu propio ID');
    if (!pk) throw new Error('Este teléfono aún no tiene clave de identidad');
    if (!this.online()) { await this.tick(); }
    if (!this.online()) throw Object.assign(new Error('Sin internet para mandar la solicitud'), { code: 'NET_DOWN' });
    var payload = { v: 1, t: type === 'acc' ? 'acc' : 'req', from: me, pk: pk, name: String(name || '').replace(/[<>]/g, '').slice(0, 40), ts: Date.now() };
    // #dueño 04-11 (perfil 2b): la solicitud lleva SOLO los datos ENMASCARADOS (tel = últimos dígitos, correo = primeras
    // letras). El buzón se cifra con una clave derivable del ID destino (no es E2E fuerte), así que los datos COMPLETOS
    // NUNCA viajan acá: llegan por el canal seguro recién al aceptar. Enmascarado = reconocer sin regalar el dato.
    if (extra && typeof extra.ph === 'string' && extra.ph) payload.ph = extra.ph.slice(0, 16);
    if (extra && typeof extra.em === 'string' && extra.em) payload.em = extra.em.slice(0, 24);
    var key = await crypto.subtle.importKey('raw', _reqAesKey(to), 'AES-GCM', false, ['encrypt']);
    var iv = _rnd(12);
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, _utf8(JSON.stringify(payload))));
    var b64 = _b64(_cat(iv, ct));
    var ev = _event(schnorr.utils.randomSecretKey(), KIND, [['p', _reqTagPub(to, _day(0))], ['expiration', String(Math.floor(Date.now() / 1000) + TTL_MSG)]], b64);
    return this._publish(ev);
  }

  // ---------- Fase B (build 2969): BUZÓN DE ARCHIVOS (src/net/blob_mailbox.js) ----------
  // Los trozos de un archivo cifrado van como eventos BLOB_KIND SIN etiqueta p (se bajan por id: el relé no correlaciona
  // quién baja qué), con caducidad; se publican en TODOS los relés abiertos (réplica) y se piden a UN relé por id.
  randomKey() { return schnorr.utils.randomSecretKey(); }
  // Sin relés propios, los relés de verdad a los que llego por los puentes (parte 3: fotos pequeñas por el puente)
  openRelayUrls() {
    var out = [];
    this.relays.forEach(function(r, u) { if (r.open && !r.gw) out.push(u); });
    if (!out.length) this.relays.forEach(function(r) { if (r.open && r.gw && r.realUrl && out.indexOf(r.realUrl) < 0) out.push(r.realUrl); });
    return out;
  }
  // El relé (propio o por un puente) con el que hablar para esta URL de relé de verdad
  _relayFor(url) {
    var r = this.relays.get(url);
    if (r && r.open) return r;
    var g = null;
    this.relays.forEach(function(x) { if (!g && x.gw && x.open && x.realUrl === url) g = x; });
    return g || r || null;
  }
  blobEvent(sk, contentB64, expiresSec) { return _event(sk, BLOB_KIND, [['expiration', String(expiresSec)]], contentB64); }
  // NIP-09: pedir el borrado de los trozos (firmado con la clave del blob) al confirmar; best-effort (la caducidad es la garantía)
  blobDeleteEvent(sk, ids) { return _event(sk, 5, (ids || []).map(function(id) { return ['e', id]; }), ''); }
  // Conectar a demanda a un relé del puntero que no tengamos (solo wss:// o localhost); resuelve true si quedó abierto
  // force (3073, diagnóstico S24 14-11 18:41: un audio del S23 «faltan 5 de 5 trozos» una y otra vez): para bajar un archivo cuyo
  // único relé está apartado por inestable o esperando su reintento, se intenta igual una vez (si no, el archivo no baja nunca
  // mientras dure el apartado: 5 min)
  ensureRelay(url, waitMs, force) {
    var self = this;
    if (!_relaySafe(url)) return Promise.resolve(false);
    var r = self._relayFor(url);
    if (r && r.open) return Promise.resolve(true);
    if (self.gwOnly()) return Promise.resolve(false); // sin internet propio no se puede abrir otro relé (solo los de los puentes)
    r = self.relays.get(url);
    if (force && r && !r.ws && r.retryAt > Date.now()) { console.log('[NET] Relé ' + _relayHost(url) + ' apartado, pero tiene un archivo que hace falta: lo abro igual'); r.retryAt = 0; } // i18n-ok
    if (!r || (!r.ws && (!r.retryAt || r.retryAt <= Date.now()))) { try { self._connect(url); } catch (e) { return Promise.resolve(false); } }
    return new Promise(function(resolve) {
      var t0 = Date.now(), iv = setInterval(function() {
        var rr = self.relays.get(url);
        if (rr && rr.open) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 > (waitMs || 6000)) { clearInterval(iv); resolve(false); }
      }, 100);
    });
  }
  // Publica en TODOS los relés abiertos y devuelve los que dijeron OK (acá importa la RÉPLICA, no «al menos uno»)
  // opts (3042, dueño 13-11: un GIF de 4,6 MB tardaba ~6 min en subir al buzón de archivos): { enough, graceMs } — con
  // `enough` relés que ya dijeron OK se espera como mucho graceMs más a los demás y se sigue (antes, un relé abierto pero
  // muerto hacía esperar el tope entero, 10 s, a CADA tanda de trozos)
  publishEach(ev, timeoutMs, opts) {
    var self = this;
    return new Promise(function(resolve) {
      var open = [];
      self.relays.forEach(function(r, u) { if (r.open && !r.gw) open.push({ r: r, u: u }); });
      // Sin relés propios: un trozo del buzón de archivos sale por los puentes (parte 3; el puente lo acota por bytes). Lo demás
      // (borrados, el canal de diagnósticos…) no pasa por un puente. Se informa la URL del relé de verdad (va en el puntero).
      var viaGw = false;
      if (!open.length && ev && ev.kind === BLOB_KIND) {
        viaGw = true;
        self.relays.forEach(function(r) { if (r.open && r.gw && r.realUrl && !open.some(function(o) { return o.u === r.realUrl; }) && (!self.gw || typeof self.gw.blobRelayOk !== 'function' || self.gw.blobRelayOk(r))) open.push({ r: r, u: r.realUrl }); });
      }
      if (!open.length) { resolve([]); return; }
      var oks = [], left = open.length, done = false, grace = null;
      var enough = opts && opts.enough ? Math.min(opts.enough, open.length) : open.length;
      if (viaGw && opts && opts.enough) enough = 1; // puente parte 4: un relé (por cualquier puente) ya lo tiene; los demás, con margen
      var finish = function() { if (done) return; done = true; clearTimeout(timer); clearTimeout(grace); open.forEach(function(o) { o.r.waits.delete(ev.id); }); resolve(oks); };
      var timer = setTimeout(finish, timeoutMs || 10000);
      open.forEach(function(o) {
        o.r.waits.set(ev.id, function(ok) {
          if (ok && oks.indexOf(o.u) < 0) oks.push(o.u);
          if (--left === 0) { finish(); return; }
          if (oks.length >= enough && !grace) grace = setTimeout(finish, (opts && opts.graceMs) || 1500);
        });
        if (!self._send(o.r, ['EVENT', ev])) { o.r.waits.delete(ev.id); if (--left === 0) finish(); }
      });
    });
  }
  // Pide eventos por id a UN relé (REQ con filtro ids) y devuelve los que llegaron hasta el EOSE o el tope de tiempo
  fetchEvents(url, ids, timeoutMs) {
    var self = this, r = self._relayFor(url);
    if (!r || !r.open || !ids || !ids.length) return Promise.resolve([]);
    return new Promise(function(resolve) {
      var sub = 'bf' + bytesToHex(_rnd(6)), got = [], done = false;
      if (!r.fetches) r.fetches = new Map();
      var finish = function() { if (done) return; done = true; clearTimeout(timer); r.fetches.delete(sub); try { self._send(r, ['CLOSE', sub]); } catch (e) {} resolve(got); };
      var timer = setTimeout(finish, timeoutMs || 15000);
      // Por un puente (parte 4) el tope es SIN PROGRESO: por Bluetooth cada trozo tarda segundos en llegar y no hay que cortar
      // una bajada que avanza
      r.fetches.set(sub, { onEvent: function(ev) {
        if (ev && typeof ev.id === 'string' && ids.indexOf(ev.id) >= 0) { got.push(ev); if (got.length >= ids.length) { finish(); return; } }
        if (r.gw && !done) { clearTimeout(timer); timer = setTimeout(finish, timeoutMs || 15000); }
      }, done: finish });
      if (!self._send(r, ['REQ', sub, { ids: ids }])) finish();
    });
  }

  _publish(ev) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var open = [];
      self.relays.forEach(function(r) { if (r.open) open.push(r); });
      if (!open.length) { reject(Object.assign(new Error('Sin relés'), { code: 'NET_DOWN' })); return; }
      var left = open.length, done = false, why = '';
      // L3 (auditoría 28-10): al cerrar la promesa (OK, rechazo o timeout) se quita ev.id de TODOS los relés abiertos;
      // antes solo lo borraba el que contestaba OK, y con un relé que acepta pero nunca manda OK, r.waits crecía toda la
      // conexión (fuga lenta).
      var cleanup = function() { open.forEach(function(r) { r.waits.delete(ev.id); }); };
      var tSent = Date.now();
      // 3011: sin respuesta de NINGÚN relé → los que no dijeron nada desde el envío están muertos: se reconectan (el reintento va por una conexión nueva)
      var timer = setTimeout(function() { if (!done) { done = true; cleanup(); self._dropSilent(tSent, 'sin respuesta a un envío'); reject(Object.assign(new Error('Los relés no respondieron'), { code: 'NET_DOWN' })); } }, 12000);
      open.forEach(function(r) {
        r.waits.set(ev.id, function(ok, msg) {
          if (done) return;
          if (ok) { done = true; clearTimeout(timer); cleanup(); resolve(true); return; }
          why = msg || why;
          if (--left === 0) { done = true; clearTimeout(timer); cleanup(); reject(Object.assign(new Error('Rechazado por los relés: ' + why), { code: 'NET_REJECTED' })); }
        });
        if (!self._send(r, ['EVENT', ev])) { r.waits.delete(ev.id); if (--left === 0 && !done) { done = true; clearTimeout(timer); cleanup(); reject(Object.assign(new Error('Sin relés'), { code: 'NET_DOWN' })); } }
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
