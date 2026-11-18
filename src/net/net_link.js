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
 * Relés de prueba: window.NEXO_NET_RELAYS. Relé PROPIO (3151): OWN_RELAYS / window.NEXO_OWN_RELAYS (net_own.js).
 */
import { GwLink, GW_FILE_MAX_B64 } from './gw_link.js';
import { DEFAULT_RELAYS, SPARE_RELAYS, OWN_PUBLIC_BACKUP, OWN_BLOB_PAR, _relaySafe, _nid, _plugin, STATE_FILE, RELAY_BG_PROBE_MS, TICK_MS, _cat, _utf8, _scalar, _day, _reqScalar, _reqTagPub, UP_MS, RELAY_IDLE_PROBE_MS, netEventValid, _unb64, _reqAesKey, TTL_CHUNK, TTL_MSG, TTL_RT, _rnd, _b64, MAX_CONTENT, TTL_HELLO, _event, KIND, HELLO_MS } from './net_link_shared.js';
import { e2eIdentityDH, e2eMyPublicKey } from '../vault/e2e_crypto.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { netRelays } from './net_relays.js';
import { netTor } from './net_tor.js';
import { netWake } from './net_wake.js';
import { netPublish } from './net_publish.js';
import { netOwn } from './net_own.js';

var REFRESH_QUIET_MS = 30000, REFRESH_GAP_MS = 60000; // 3130: deslizar no vuelve a pedir a un relé que entrega en vivo, y 1 vez/min
var PROBE_MS = 20000;         // 3147: saludo al abrir el chat / al escribir, como mucho uno cada 20 s por contacto
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

  // 3114: los relés de siempre + los de reserva que estén en uso
  relayUrls() { var base = this._baseRelayUrls(), on = (this._spareOn || []).filter(function(u) { return base.indexOf(u) < 0; }); return on.length ? base.concat(on) : base; }
  _sparePool() {
    var cfg = (typeof window !== 'undefined') ? window.NEXO_NET_RELAYS : undefined, sp = (typeof window !== 'undefined') ? window.NEXO_SPARE_RELAYS : undefined;
    var pool = ((cfg === undefined ? (sp || SPARE_RELAYS) : (sp || [])) || []).filter(_relaySafe);
    if (!this._ownList().length) return pool;
    // 3151: con relé propio, los públicos de siempre que no quedaron junto a él van primero en la reserva
    var base = this._baseRelayUrls(), rest = this._pubRelayUrls().filter(function(u) { return base.indexOf(u) < 0; });
    return rest.concat(pool.filter(function(u) { return rest.indexOf(u) < 0 && base.indexOf(u) < 0; }));
  }
  // 3151: con relé propio, él primero y OWN_PUBLIC_BACKUP públicos de respaldo; sin él, los públicos de siempre
  _baseRelayUrls() {
    var pub = this._pubRelayUrls(), own = this._ownList();
    if (!own.length) return pub;
    return own.concat(pub.filter(function(u) { return own.indexOf(u) < 0; }).slice(0, OWN_PUBLIC_BACKUP));
  }
  _pubRelayUrls() {
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
      // 3099 (S24 3054 14-11 17:48: «Relés listos tras el cambio de red en 3173,6 s»): lo que tarde con la app en segundo plano no es
      // lo que tarda en conectar: la medida del cambio de red se abandona al irse (no entra en la velocidad del diagnóstico)
      if (document.visibilityState === 'hidden') { self._bgSinceDirty = true; self._hiddenAt = Date.now(); self._netChangeAt = 0; self._bgConfig(); }
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
    // 3193: ni Wi-Fi ni cable = datos móviles (escuchar en 2 relés y subir 2 copias); sin la consulta (sin la parte nativa) no se sabe: como siempre
    try { var st = pl && typeof pl.lanStatus === 'function' ? await pl.lanStatus() : null; self.wifi = !!(st && st.wifi); if (st && typeof st.wifi === 'boolean') self._metered = !st.wifi; } catch (e) {}
    var changed = await self._refreshTags();
    if (changed) self._bgConfig();
    if (!self.inTags.size && !self.reqTags.size) { self._closeAll(); return; }
    // 3190: también sin contactos por internet (alguien nuevo): lo recibido en segundo plano puede ser una solicitud a mi buzón
    if (self._drainPending && (self.inTags.size || self.reqTags.size)) { self._drainPending = false; self._drainBg(); }
    self._spareCheck(); // 3114: ¿falta algún relé sano? → uno de reserva
    self._ownSync(); // 3151: suscripciones según el relé propio (sin propio no hace nada)
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
        if (up && p.probeT0 && now - p.probeT0 < 60000) { // 3147: contestó al saludo de abrir el chat
          console.log('[RUTA] ' + nx + ' contesta: listo por internet ' + (now - p.probeT0) + ' ms después de abrir el chat'); // i18n-ok
          try { if (typeof window.NEXO_noteConnect === 'function') window.NEXO_noteConnect('ruta', now - p.probeT0); } catch (e) {}
        }
        if (up) p.probeT0 = 0;
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
  // 3151: hacia el relé propio sano, OWN_BLOB_PAR trozos a la vez (no tiene los límites de ritmo de los públicos)
  blobPar() { if (this.gwOnly() && this.gw) return this.gw.blobPar(); return this.blobTargets() ? OWN_BLOB_PAR : 0; }
  blobPublishMs(t) { return this.gwOnly() && this.gw ? this.gw.publishMs(t) : t; }
  blobFetchBatch(url) { var r = this._relayFor(url); return r && r.gw && this.gw ? this.gw.fetchBatch(r) : 0; }
  blobFetchMs(url, t) { var r = this._relayFor(url); return r && r.gw && this.gw ? this.gw.fetchMs(r, t) : t; }
  // Buzón: dejarle un texto aunque no esté en línea
  mailboxOk(nexoId) {
    var nx = _nid(nexoId);
    return this.online() && this._netContacts().some(function(c) { return _nid(c.nexoId || c.deviceUUID) === nx; });
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
      if (p.some(function(x) { return self._isReqTag(x); })) await this._onReq(ev.content);
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
    try { this._bgGaps(res && res.gaps); } catch (e) {} // 3205: y a qué relés que soltó con datos hay que pedirles desde cuándo
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

  // 3190 (dueño 17-11): ¿etiqueta de MI buzón de solicitudes (hoy o ayer)? También con la app oculta (reqTags vacío): lo que la parte
  // nativa recibió en segundo plano entra por _drainBg y, si no se reconociera aquí, quedaría «visto» sin pasar a la bandeja.
  _isReqTag(x) {
    if (this.reqTags.has(x)) return true;
    var me = this.me(), d = _day(0);
    if (!me) return false;
    if (!this._reqMine || this._reqMine.me !== me || this._reqMine.day !== d) this._reqMine = { me: me, day: d, pubs: [_reqTagPub(me, _day(0)), _reqTagPub(me, _day(-1))] };
    return this._reqMine.pubs.indexOf(x) >= 0;
  }

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
      this.ble._onNetRequest({ id: from, pk: o.pk, name: String(o.name || '').replace(/[<>]/g, '').slice(0, 40), kind: o.t, ph: typeof o.ph === 'string' ? o.ph.replace(/[<>]/g, '').slice(0, 16) : '', em: typeof o.em === 'string' ? o.em.replace(/[<>]/g, '').slice(0, 24) : '', ic: typeof o.ic === 'string' && /^[2-9A-HJ-NP-Z]{8}$/.test(o.ic) ? o.ic : '' });
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
    if (o.h && !o.r && now - t < UP_MS && t >= (peer.roT || 0)) { peer.ro = o.ro === 1; peer.roT = t; } // 3151: ¿lee del relé propio?
    if (o.h) {
      // Saludo: contestar si hace rato que no le saludamos (así los dos se ven en línea enseguida)
      if (!o.r && now - t < UP_MS && now - (peer.helloAt || 0) > 20000) this._hello(nx); // 3234: r = respuesta del nativo (no se contesta)
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
    // 3210: el primer trozo de un envío oculto (respaldo Fénix, medio de un estado: q:1) no es un mensaje nuevo (sin aviso nativo)
    else if (o && (o.t === 'c' || o.t === 'f') && o.i === 0 && !o.hf && o.q !== 1 && typeof o.m === 'string') id = o.m;
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
    // 3190 (dueño 17-11: «hay que poner esa notificación: hay un contacto que te quiere agregar»): la parte nativa también escucha mi
    // buzón de solicitudes en segundo plano y avisa. Para eso: todos mis contactos (NEXO ID y nombre: «ya es contacto» y el aviso de
    // posible impostor con el nombre de uno de ellos), a quién mandé yo una solicitud (su «acc» es «aceptó tu solicitud») y desde cuándo
    // la app ya no escucha su buzón (lo de antes ya lo recibió ella a la vista: sin aviso doble). Nada secreto: el buzón sale de mi ID.
    var me = this.me(), known = [], seenNx = {};
    var all = (this.ble && typeof this.ble.getBLEContacts === 'function') ? (this.ble.getBLEContacts() || []) : [];
    all.forEach(function(c) { var nx = _nid(c && (c.nexoId || c.deviceUUID)); if (/^nx[0-9a-z]{8}$/.test(nx) && nx !== me && !seenNx[nx]) { seenNx[nx] = 1; known.push({ nx: nx, name: String(c.name || '') }); } });
    var reqOut = ((this.ble && typeof this.ble._reqStore === 'function') ? this.ble._reqStore('nexo_req_out') : []).map(function(x) { return _nid(x && x.id); }).filter(function(nx) { return /^nx[0-9a-z]{8}$/.test(nx); });
    var reqSince = (this._hiddenAt && this.online()) ? this._hiddenAt - 120000 : 0;
    var sig = list.map(function(c) { return c.nx + c.kraw; }).join(',') + '|' + this.relayUrls().join(',') + '|' + known.map(function(k) { return k.nx + ':' + k.name; }).join(',') + '|' + reqOut.join(',');
    // Desde justo después de lo último que recogió la app (lo ya visto no vuelve a avisar)
    var since = this.state.lastSeen ? this.state.lastSeen + 1000 : Date.now() - 600000;
    if (sig === this._bgSig && !this._bgSinceDirty) return;
    this._bgSig = sig; this._bgSinceDirty = false;
    try { await pl.netBgConfig({ me: me, relays: this.relayUrls(), since: since, contacts: list, known: known, reqOut: reqOut, reqSince: reqSince }); } catch (e) {}
  }

  _saveState() {
    var self = this, pl = _plugin();
    if (self._saveT || !pl) return;
    self._saveT = setTimeout(function() { self._saveT = null; pl.saveToFile({ filename: STATE_FILE, content: JSON.stringify(self.state) }).catch(function() {}); }, 2000);
  }

  // ---------- enviar ----------
  _ttlFor(content) {
    if (/^\{"type":"vf"/.test(content)) return TTL_RT; // 3128: parte de llamada (1-a-1 o de grupo)
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
    if (opts && opts.hello) { body.h = 1; if (this.tor.ready && this.tor.onion) { body.o = this.tor.onion; body.op = this.tor.port; } if (this.fcmToken) body.f = this.fcmToken; if (this._ownHealthy()) body.ro = 1; } // 3151: ro = «leo del relé propio»
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
    // 3151: lo pesado (parte de llamada, trozo de un archivo en vivo) solo al relé propio si los dos leemos de él (net_own.js)
    var pub = this._publishOwn(ev, (opts && opts.hello) || ttl === TTL_MSG ? null : this._ownOnlyFor(nx));
    // FCM «despertador» (#87, Fase 2): salió por el buzón de los relés (si fuera por Tor directo ya habría vuelto
    // arriba). M1 (auditoría 28-10): pedir el «toque» SOLO por un mensaje nuevo de verdad (nid: texto nuevo o primer
    // trozo de un archivo) — NUNCA por cada trozo/ack/control; un archivo grande serían miles de toques = cuota de FCM
    // agotada (tumbaría el propio #87) y batería del par. El throttle por par (en _wake) cubre además las ráfagas.
    if (!(opts && opts.hello) && nid) { var self = this; pub.then(function() { self._wake(nx, callOffer); }, function() {}); }
    return pub;
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
    if (extra && typeof extra.ic === 'string' && /^[2-9A-HJ-NP-Z]{8}$/.test(extra.ic)) payload.ic = extra.ic; // 3129: código de su enlace de invitación
    var key = await crypto.subtle.importKey('raw', _reqAesKey(to), 'AES-GCM', false, ['encrypt']);
    var iv = _rnd(12);
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, _utf8(JSON.stringify(payload))));
    var b64 = _b64(_cat(iv, ct));
    var ev = _event(schnorr.utils.randomSecretKey(), KIND, [['p', _reqTagPub(to, _day(0))], ['expiration', String(Math.floor(Date.now() / 1000) + TTL_MSG)]], b64);
    return this._publish(ev);
  }

  _hello(nx) {
    var p = this.peers.get(nx) || {};
    this.peers.set(nx, p);
    p.helloAt = Date.now();
    p.helloOwn = this._ownHealthy(); // 3151: este saludo dice «leo del propio» (ro)
    this.send(nx, '', { hello: true }).catch(function() {});
  }
  // 3147 (dueño 16-11: «preparar el mejor camino al ABRIR el chat, para que enviar sea instantáneo»): un saludo cifrado ya (el
  // otro contesta y se ve en línea por internet en ~1 s) si hace > 20 s que no le saludamos ni sabemos de él. Lo llaman abrir el
  // chat y empezar a escribir (ble_interface _prepRoute); como mucho uno cada 20 s por contacto. Sin relés abiertos no hace nada.
  probe(nexoId, why) {
    var nx = _nid(nexoId), now = Date.now();
    if (!/^nx[0-9a-z]{8}$/.test(nx) || !this.pairs.has(nx) || !this.online()) return false;
    var p = this._peer(nx);
    if (now - (p.helloAt || 0) < PROBE_MS || now - (p.lastRx || 0) < PROBE_MS) return false;
    p.probeT0 = p.up ? 0 : now;
    console.log('[RUTA] ' + (why || 'Al abrir el chat') + ': saludo por internet a ' + nx + (p.up ? ' (ya en línea, se refresca)' : ' (sin noticias suyas hace ' + (p.lastRx ? Math.round((now - p.lastRx) / 1000) + ' s)' : 'esta sesión)'))); // i18n-ok
    this._hello(nx);
    return true;
  }
  // Alta por ID (ronda 2779): tras agregar un contacto nuevo (al aceptar una solicitud o al llegar la aceptación de la
  // mía), forzar el saludo para que los dos se vean en línea enseguida (el saludo normal del tick no saluda a un contacto
  // que aún no está "en línea"). Refresca etiquetas/suscripción y saluda.
  greet() { var self = this; return this.tick().then(function() { self._helloAll(true); }); }

  // Saludo a los contactos: al conectar (o al volver a la app) a todos; después, cada minuto a los que están en línea
  // 3095 (dueño 14-11, deslizar para actualizar en Contactos: «que haya una sincronización entre lo que veo yo y lo que hay en los
  // otros dispositivos»): comprobar los relés (el que no contesta se rehace), volver a pedir a cada relé abierto lo de los últimos
  // minutos (desde lo último visto − 10 min: lo ya recibido se descarta solo) y avisar a los contactos de que estoy en línea.
  // 3130 (diagnóstico S24 3069 15-11 13:51, línea nueva «bajado de los relés»: 10,1 MB en 34 min, 8,8 MB YA VISTOS; deslizó 4 veces
  // en 3 s y cada vez cada relé volvía a mandar los últimos 10 min): solo se vuelve a pedir a un relé que lleva un rato callado (el que
  // está entregando en vivo ya lo trae todo) y como mucho una vez por minuto; la comprobación de los relés sigue en cada deslizar.
  refresh(why) {
    var self = this, n = 0, now = Date.now();
    if (!self.online()) return { relays: 0 };
    self._probeRelays(why || 'actualizar', 0);
    self.relays.forEach(function(r) {
      if (!r.open || !r.ws) return;
      n++;
      if (now - (r.rxAt || 0) < REFRESH_QUIET_MS || now - (r.refreshAt || 0) < REFRESH_GAP_MS) return;
      r.refreshAt = now;
      self._subscribe(r);
    });
    self._helloAll(true);
    return { relays: n };
  }
  _helloAll(force) {
    var self = this, now = Date.now();
    if (!self.online()) return;
    var first = !self._greeted;
    self._greeted = true;
    self._netContacts().forEach(function(c) {
      var nx = _nid(c.nexoId || c.deviceUUID), p = self.peers.get(nx) || {};
      // 3133 (saludonuevo.js; destapado por blobfan.js en la 3129): un contacto que pasa a tener internet con los relés YA abiertos
      // (se conocieron en persona después de abrir la app) no recibía saludo: solo se saludaba al abrir los relés y luego a los que
      // ya estaban en línea; si los dos tenían internet de antes, ninguno saludaba y no se veían en línea por internet hasta reabrir
      // la app. Ahora, al que aún no se saludó en esta sesión, un saludo (uno solo: helloAt queda puesto).
      if (force || first || !p.helloAt || (p.up && now - (p.helloAt || 0) > HELLO_MS)) self._hello(nx);
    });
  }
}

// Reestructuración 15-11: métodos de NetLink repartidos en net_relays.js, net_tor.js, net_wake.js, net_publish.js (y net_own.js, 3151); se unen a la clase como sus métodos normales.
function _mixNetLink(o) { Object.getOwnPropertyNames(o).forEach(function(k) { Object.defineProperty(NetLink.prototype, k, { value: o[k], writable: true, configurable: true, enumerable: false }); }); }
_mixNetLink(netRelays); _mixNetLink(netTor); _mixNetLink(netWake); _mixNetLink(netPublish); _mixNetLink(netOwn);
export function createNet(ble) { return new NetLink(ble); }

// Lo que otros archivos importan de aquí (ahora en net_link_shared.js)
export { netEventValid, netMakeEvent } from './net_link_shared.js';
