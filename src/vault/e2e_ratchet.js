/**
 * e2e_ratchet.js v1.0 — Protocolo 2 de cifrado de NEXO: el de Signal (X3DH + Double Ratchet) con WebCrypto.
 *
 * - Identidad: la de e2e_crypto.js (ECDH P-256, la del NEXO ID y las huellas ya aceptadas) + una clave de
 *   firma ECDSA P-256 que firma la "clave previa" (SPK). Paquete público (bundle): { ik, sk, spk, spkId, sig };
 *   viaja en el kx y en la tarjeta de contacto, así se puede escribir a quien nunca se ha conectado (Jump).
 * - Acuerdo inicial (X3DH sin claves de un solo uso): DH(IKa,SPKb) ‖ DH(EKa,IKb) ‖ DH(EKa,SPKb) → HKDF.
 * - Double Ratchet (especificación de Signal): cadena de envío/recepción con HMAC-SHA256, paso DH con cada
 *   respuesta, claves de mensajes saltados (orden distinto o perdidos). Cada mensaje: clave propia que se borra
 *   al usarla (secreto hacia delante) y renovación continua (si roban las claves de hoy, las de mañana no).
 * - Cada mensaje cifrado AES-GCM-256 con datos adicionales (AAD): identidades, cabecera y los datos del sobre
 *   (emisor | destino | id): no se pueden cambiar ni reenviar con otro id. Relleno de longitud antes de cifrar.
 * - Repeticiones: la clave de un mensaje se borra al usarlo; el primer mensaje (X3DH) se rechaza si su clave
 *   efímera ya se vio. Un reintento idéntico se reconoce (DUP) para poder confirmarlo sin mostrarlo dos veces.
 * - Estado en nexo_ratchet.json (fase 3: cifrado en reposo). Se guarda ANTES de entregar un texto cifrado:
 *   tras un cierre nunca se reutiliza una clave.
 * Formato: "E2:" + cabecera + ":" + datos cifrados (base64). Cabecera: dh.pn.n[.ik.ek.spkId] (base64 y números).
 */
import { initE2E, e2eMyPublicKey, e2eIdentityDH } from './e2e_crypto.js';

var STORE_FILE = 'nexo_ratchet.json';
var PREFIX = 'E2:';
var MAX_SKIP = 1000;          // mensajes saltados como máximo en una cadena
var MAX_SKIPPED_KEYS = 300;   // claves de mensajes aún no recibidos guardadas por sesión
var MAX_SESSIONS_PER_KEY = 3; // por contacto y clave de identidad (inicios simultáneos)
var MAX_KEYS_PER_PEER = 2;    // claves de identidad distintas a la vez por contacto (una aceptada + una pendiente)
var SPK_ROTATE_MS = 30 * 86400000;
var SEEN_EK_MAX = 1000;
var RECENT_MAX = 200;
var RECENT_MAX_CHARS = 65536;

var _store = null;
var _initP = null;
var _lock = Promise.resolve();
var _recent = new Map(); // texto cifrado → resultado (reintentos idénticos)

function _subtle() { return (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) || null; }
function _rand(n) { return window.crypto.getRandomValues(new Uint8Array(n)); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _b64(bytes) {
  var CH = 0x8000, s = '';
  for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function _unb64(b64) {
  var bin = atob(b64), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function _cat() {
  var len = 0, i;
  for (i = 0; i < arguments.length; i++) len += arguments[i].length;
  var out = new Uint8Array(len), o = 0;
  for (i = 0; i < arguments.length; i++) { out.set(arguments[i], o); o += arguments[i].length; }
  return out;
}
function _utf8(s) { return new TextEncoder().encode(s); }
function _err(msg, code) { var e = new Error(msg); e.code = code; return e; }
// Serializa todas las operaciones (el estado es uno solo)
function _serial(fn) {
  var run = _lock.then(fn, fn);
  _lock = run.catch(function() {});
  return run;
}

// ---------- primitivas ----------
async function _hkdf(ikm, salt, info, bytes) {
  var k = await _subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await _subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: _utf8(info) }, k, bytes * 8));
}
async function _hmac(key, data) {
  var k = await _subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await _subtle().sign('HMAC', k, data));
}
async function _genDH() {
  var kp = await _subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { priv: await _subtle().exportKey('jwk', kp.privateKey), pub: _b64(new Uint8Array(await _subtle().exportKey('raw', kp.publicKey))) };
}
async function _dh(privJwk, pubB64) {
  var priv = await _subtle().importKey('jwk', privJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  var pub = await _subtle().importKey('raw', _unb64(pubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return new Uint8Array(await _subtle().deriveBits({ name: 'ECDH', public: pub }, priv, 256));
}
async function _kdfRK(rkB64, dhOut) {
  var o = await _hkdf(dhOut, _unb64(rkB64), 'NEXO-RK-v2', 64);
  return { rk: _b64(o.subarray(0, 32)), ck: _b64(o.subarray(32)) };
}
async function _kdfCK(ckB64) {
  var ck = _unb64(ckB64);
  return { mk: _b64(await _hmac(ck, new Uint8Array([1]))), ck: _b64(await _hmac(ck, new Uint8Array([2]))) };
}
async function _seal(mkB64, plain, aad) {
  var o = await _hkdf(_unb64(mkB64), new Uint8Array(32), 'NEXO-MK-v2', 44);
  var key = await _subtle().importKey('raw', o.subarray(0, 32), 'AES-GCM', false, ['encrypt']);
  return new Uint8Array(await _subtle().encrypt({ name: 'AES-GCM', iv: o.subarray(32), additionalData: aad }, key, plain));
}
async function _open(mkB64, ct, aad) {
  var o = await _hkdf(_unb64(mkB64), new Uint8Array(32), 'NEXO-MK-v2', 44);
  var key = await _subtle().importKey('raw', o.subarray(0, 32), 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await _subtle().decrypt({ name: 'AES-GCM', iv: o.subarray(32), additionalData: aad }, key, ct));
}

// ---------- relleno (la longitud no delata el contenido) ----------
// Hasta 4 KB: múltiplos de 160 bytes (como Signal en textos); más: "Padmé" (≤12 % de más)
function _padLen(n) {
  if (n <= 4096) return Math.ceil(n / 160) * 160;
  var e = Math.floor(Math.log2(n)), s = Math.floor(Math.log2(e)) + 1, z = e - s, m = Math.pow(2, z) - 1;
  return (n + m) & ~m;
}
export function ratchetPad(bytes) {
  var out = new Uint8Array(_padLen(bytes.length + 1));
  out.set(bytes); out[bytes.length] = 0x80;
  return out;
}
export function ratchetUnpad(bytes) {
  var i = bytes.length - 1;
  while (i >= 0 && bytes[i] === 0) i--;
  if (i < 0 || bytes[i] !== 0x80) throw _err('Relleno no válido', 'BAD');
  return bytes.subarray(0, i);
}

// ---------- almacén ----------
async function _save() {
  var pl = _plugin();
  if (!pl || typeof pl.saveToFile !== 'function') return;
  await pl.saveToFile({ filename: STORE_FILE, content: JSON.stringify(_store) });
}

async function _newSpk(id) {
  var kp = await _genDH();
  var sig = await _signSpk(id, kp.pub);
  return { id: id, priv: kp.priv, pub: kp.pub, sig: sig, ts: Date.now() };
}
async function _signSpk(id, spkPub) {
  var priv = await _subtle().importKey('jwk', _store.sign.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  var data = _utf8('NEXO-SPK|' + id + '|' + spkPub + '|' + e2eMyPublicKey());
  return _b64(new Uint8Array(await _subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, data)));
}

export function ratchetAvailable() { return !!_subtle(); }

export function ratchetInit() {
  if (_initP) return _initP;
  _initP = (async function() {
    if (!_subtle()) return null;
    await initE2E();
    var pl = _plugin();
    try {
      if (pl && typeof pl.loadFromFile === 'function') {
        var r = await pl.loadFromFile({ filename: STORE_FILE });
        if (r && r.exists && r.content) _store = JSON.parse(r.content);
      }
    } catch (e) { console.warn('[E2E] No se pudo cargar el estado del protocolo 2:', e && e.message); }
    if (!_store || _store.v !== 1 || _store.ik !== e2eMyPublicKey()) {
      // Primera vez (o identidad nueva tras reinstalar): todo nuevo
      var skp = await _subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      _store = {
        v: 1, ik: e2eMyPublicKey(),
        sign: { priv: await _subtle().exportKey('jwk', skp.privateKey), pub: _b64(new Uint8Array(await _subtle().exportKey('raw', skp.publicKey))) },
        spks: [], peers: {}, sessions: {}, seenEk: {}
      };
      _store.spks.push(await _newSpk(1));
      await _save();
      console.log('[E2E] Protocolo 2 listo (claves nuevas)');
    } else if (Date.now() - _store.spks[0].ts > SPK_ROTATE_MS) {
      // Clave previa nueva cada 30 días; las dos anteriores se guardan para primeros mensajes atrasados
      _store.spks.unshift(await _newSpk(_store.spks[0].id + 1));
      _store.spks = _store.spks.slice(0, 3);
      await _save();
    }
    return _store;
  })();
  return _initP;
}

export async function ratchetMyBundle() {
  await ratchetInit();
  if (!_store) return null;
  var s = _store.spks[0];
  return { v: 2, ik: _store.ik, sk: _store.sign.pub, spk: s.pub, spkId: s.id, sig: s.sig };
}

function _validBundle(b) {
  var k = /^[A-Za-z0-9+/=]{80,100}$/;
  return b && k.test(b.ik || '') && k.test(b.sk || '') && k.test(b.spk || '') && typeof b.sig === 'string' && b.sig.length < 200 && b.spkId > 0;
}

// Guarda el paquete público de un contacto si la firma es válida. La confianza en b.ik la decide quien llama.
export function ratchetNotePeerBundle(nexoId, b) {
  return _serial(async function() {
    await ratchetInit();
    var nx = _nid(nexoId);
    if (!_store || !nx || !_validBundle(b)) return false;
    var cur = _store.peers[nx];
    if (cur && cur.ik === b.ik && cur.spk === b.spk && cur.spkId === b.spkId) return true;
    var pub = await _subtle().importKey('raw', _unb64(b.sk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    var ok = await _subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, _unb64(b.sig), _utf8('NEXO-SPK|' + b.spkId + '|' + b.spk + '|' + b.ik));
    if (!ok) { console.warn('[E2E] Paquete de claves de ' + nx + ' con firma no válida: descartado'); return false; }
    _store.peers[nx] = { ik: b.ik, sk: b.sk, spk: b.spk, spkId: b.spkId, sig: b.sig, ts: Date.now() };
    // Sesiones iniciadas sin respuesta con otra clave previa (rotada, o el otro perdió su estado): ya no se
    // envía por ellas (podría no entenderlas); se empieza otra con el paquete nuevo. Se guardan para recibir.
    _sessionsFor(nx).forEach(function(x) { if (x.rik === b.ik && x.pending && x.dhr !== b.spk) x.stale = true; });
    await _save();
    return true;
  });
}

export function ratchetPeerBundle(nexoId) {
  var p = _store && _store.peers[_nid(nexoId)];
  return p ? { v: 2, ik: p.ik, sk: p.sk, spk: p.spk, spkId: p.spkId, sig: p.sig } : null;
}

export function ratchetIsE2(s) { return typeof s === 'string' && s.indexOf(PREFIX) === 0; }

// ¿Hay con qué cifrar para este contacto y clave? (sesión con envío o paquete público)
export function ratchetCanEncrypt(nexoId, peerIk) {
  if (!_store) return false;
  var nx = _nid(nexoId);
  var list = (_store.sessions[nx] || []).filter(function(s) { return s.rik === peerIk && s.cks && !s.stale; });
  var p = _store.peers[nx];
  return list.length > 0 || !!(p && p.ik === peerIk);
}

// ---------- sesiones ----------
function _sessionsFor(nx) { return (_store.sessions[nx] = _store.sessions[nx] || []); }

function _keepSession(nx, s) {
  var list = _sessionsFor(nx).filter(function(x) { return x !== s && x.id !== s.id; });
  list.unshift(s);
  // Límite por clave de identidad y número de claves distintas. Las claves a las que ya hemos enviado
  // (aceptadas por el usuario) tienen prioridad: un impostor con claves nuevas no echa las sesiones buenas.
  var keys = [];
  list.forEach(function(x) { if (x.sent && keys.indexOf(x.rik) < 0) keys.push(x.rik); });
  list.forEach(function(x) { if (keys.indexOf(x.rik) < 0) keys.push(x.rik); });
  keys = keys.slice(0, MAX_KEYS_PER_PEER);
  var byKey = {}, out = [];
  list.forEach(function(x) {
    byKey[x.rik] = byKey[x.rik] || 0;
    if (byKey[x.rik] < MAX_SESSIONS_PER_KEY && keys.indexOf(x.rik) >= 0) { byKey[x.rik]++; out.push(x); }
  });
  _store.sessions[nx] = out;
}

async function _initiate(nx, peer) {
  var ek = await _genDH();
  var dh1 = await e2eIdentityDH(peer.spk);
  var dh2 = await _dh(ek.priv, peer.ik);
  var dh3 = await _dh(ek.priv, peer.spk);
  var sk = await _hkdf(_cat(new Uint8Array(32).fill(0xff), dh1, dh2, dh3), new Uint8Array(32), 'NEXO-X3DH-v2', 32);
  var dhs = await _genDH();
  var r = await _kdfRK(_b64(sk), await _dh(dhs.priv, peer.spk));
  return {
    id: 'i' + ek.pub.substring(0, 16), rik: peer.ik, ad: _store.ik + '|' + peer.ik,
    rk: r.rk, dhs: dhs, dhr: peer.spk, cks: r.ck, ckr: null, ns: 0, nr: 0, pn: 0,
    skipped: {}, skippedOrder: [], pending: { ik: _store.ik, ek: ek.pub, spkId: peer.spkId }, ek: ek.pub, created: Date.now()
  };
}

async function _respond(nx, h) {
  var spk = _store.spks.filter(function(x) { return x.id === h.spkId; })[0];
  if (!spk) throw _err('Clave previa desconocida', 'BAD');
  var dh1 = await _dh(spk.priv, h.ik);
  var dh2 = await e2eIdentityDH(h.ek);
  var dh3 = await _dh(spk.priv, h.ek);
  var sk = await _hkdf(_cat(new Uint8Array(32).fill(0xff), dh1, dh2, dh3), new Uint8Array(32), 'NEXO-X3DH-v2', 32);
  return {
    id: 'r' + h.ek.substring(0, 16), rik: h.ik, ad: h.ik + '|' + _store.ik,
    rk: _b64(sk), dhs: { priv: spk.priv, pub: spk.pub }, dhr: null, cks: null, ckr: null, ns: 0, nr: 0, pn: 0,
    skipped: {}, skippedOrder: [], pending: null, ek: h.ek, created: Date.now()
  };
}

function _headerStr(h) {
  var s = h.dh + '.' + h.pn + '.' + h.n;
  if (h.ik) s += '.' + h.ik + '.' + h.ek + '.' + h.spkId;
  return s;
}
function _parse(packed) {
  if (!ratchetIsE2(packed)) throw _err('No es protocolo 2', 'BAD');
  var parts = packed.substring(PREFIX.length).split(':');
  if (parts.length !== 2) throw _err('Formato no válido', 'BAD');
  var f = parts[0].split('.');
  if (f.length !== 3 && f.length !== 6) throw _err('Cabecera no válida', 'BAD');
  var h = { dh: f[0], pn: parseInt(f[1], 10), n: parseInt(f[2], 10) };
  if (f.length === 6) { h.ik = f[3]; h.ek = f[4]; h.spkId = parseInt(f[5], 10); }
  if (!(h.pn >= 0) || !(h.n >= 0) || h.n > 1e7 || h.pn > 1e7) throw _err('Cabecera no válida', 'BAD');
  return { h: h, hs: parts[0], ct: _unb64(parts[1]) };
}
function _aad(s, hs, outerAd) { return _utf8('NEXO2|' + s.ad + '|' + hs + '|' + (outerAd || '')); }

async function _skip(s, until) {
  if (!s.ckr) return;
  if (until - s.nr > MAX_SKIP) throw _err('Demasiados mensajes saltados', 'BAD');
  while (s.nr < until) {
    var r = await _kdfCK(s.ckr);
    s.ckr = r.ck;
    var key = s.dhr + '|' + s.nr;
    s.skipped[key] = r.mk;
    s.skippedOrder.push(key);
    s.nr++;
  }
  while (s.skippedOrder.length > MAX_SKIPPED_KEYS) delete s.skipped[s.skippedOrder.shift()];
}

// Descifra con una copia de la sesión; devuelve { s: sesión nueva, pt } o lanza
async function _tryDecrypt(s0, p, outerAd) {
  var s = JSON.parse(JSON.stringify(s0));
  var h = p.h, aad = _aad(s, p.hs, outerAd), mk;
  var key = h.dh + '|' + h.n;
  if (s.skipped[key]) {
    mk = s.skipped[key];
    delete s.skipped[key];
    s.skippedOrder = s.skippedOrder.filter(function(k) { return k !== key; });
  } else {
    if (h.dh === s.dhr && h.n < s.nr) throw _err('Mensaje ya recibido', 'DUP');
    // Cadena anterior sin clave guardada: ya se recibió (o caducó); no es un paso nuevo del ratchet
    if (s.oldDhr && s.oldDhr.indexOf(h.dh) >= 0) throw _err('Mensaje ya recibido', 'DUP');
    if (h.dh !== s.dhr) {
      await _skip(s, h.pn);
      if (s.dhr) { s.oldDhr = (s.oldDhr || []).concat([s.dhr]).slice(-5); }
      s.pn = s.ns; s.ns = 0; s.nr = 0; s.dhr = h.dh;
      var r1 = await _kdfRK(s.rk, await _dh(s.dhs.priv, s.dhr));
      s.rk = r1.rk; s.ckr = r1.ck;
      s.dhs = await _genDH();
      var r2 = await _kdfRK(s.rk, await _dh(s.dhs.priv, s.dhr));
      s.rk = r2.rk; s.cks = r2.ck;
    }
    await _skip(s, h.n);
    var c = await _kdfCK(s.ckr);
    s.ckr = c.ck; s.nr++;
    mk = c.mk;
  }
  var pt = await _open(mk, p.ct, aad);
  s.pending = null; // el otro ya tiene la sesión: no hace falta repetir la cabecera inicial
  s.stale = false;
  s.used = Date.now();
  return { s: s, pt: ratchetUnpad(pt) };
}

// Cifra bytes para un contacto (peerIk: su clave aceptada). outerAd: "emisor|destino|id".
export function ratchetEncrypt(nexoId, peerIk, bytes, outerAd) {
  return _serial(async function() {
    await ratchetInit();
    var nx = _nid(nexoId);
    if (!_store) throw _err('Protocolo 2 no disponible', 'NO_KEY');
    var s = _sessionsFor(nx).filter(function(x) { return x.rik === peerIk && x.cks && !x.stale; })[0];
    if (!s) {
      var peer = _store.peers[nx];
      if (!peer || peer.ik !== peerIk) throw _err('Sin paquete de claves del contacto', 'NO_KEY');
      s = await _initiate(nx, peer);
    }
    var c = await _kdfCK(s.cks);
    s.cks = c.ck;
    var h = { dh: s.dhs.pub, pn: s.pn, n: s.ns };
    if (s.pending) { h.ik = s.pending.ik; h.ek = s.pending.ek; h.spkId = s.pending.spkId; }
    s.ns++;
    s.sent = true;
    s.used = Date.now();
    var hs = _headerStr(h);
    var ct = await _seal(c.mk, ratchetPad(bytes), _aad(s, hs, outerAd));
    _keepSession(nx, s);
    await _save(); // antes de entregar el texto cifrado: nunca se reutiliza una clave
    return PREFIX + hs + ':' + _b64(ct);
  });
}

// Descifra. Devuelve { bytes, senderKey } (senderKey: clave de identidad del emisor; la confianza la decide
// quien llama). Errores: code 'DUP' (reintento de algo ya recibido), 'BAD' (no válido / no es para nosotros).
export function ratchetDecrypt(nexoId, packed, outerAd) {
  var cached = packed.length <= RECENT_MAX_CHARS && _recent.get(packed + '|' + outerAd);
  if (cached) return Promise.resolve(Object.assign({ dup: true }, cached));
  return _serial(async function() {
    await ratchetInit();
    var nx = _nid(nexoId);
    if (!_store) throw _err('Protocolo 2 no disponible', 'BAD');
    var p = _parse(packed);
    var list = _sessionsFor(nx).slice();
    if (p.h.ik) {
      // Primer mensaje (X3DH): sesión existente con esa clave efímera o una nueva
      var same = list.filter(function(x) { return x.ek === p.h.ek; });
      if (!same.length) {
        if (_store.seenEk[p.h.ek]) throw _err('Primer mensaje repetido', 'DUP');
        list = [await _respond(nx, p.h)].concat(list);
      } else list = same.concat(list.filter(function(x) { return x.ek !== p.h.ek; }));
    }
    var lastErr = null;
    for (var i = 0; i < list.length; i++) {
      try {
        var r = await _tryDecrypt(list[i], p, outerAd);
        if (p.h.ik) {
          _store.seenEk[p.h.ek] = Date.now();
          var ks = Object.keys(_store.seenEk);
          if (ks.length > SEEN_EK_MAX) ks.sort(function(a, b) { return _store.seenEk[a] - _store.seenEk[b]; }).slice(0, ks.length - SEEN_EK_MAX).forEach(function(k) { delete _store.seenEk[k]; });
        }
        _keepSession(nx, r.s);
        await _save();
        var out = { bytes: r.pt, senderKey: r.s.rik };
        // Solo textos y cabeceras (un archivo grande no se guarda en memoria; sus repeticiones las filtra el flujo)
        if (packed.length <= RECENT_MAX_CHARS) {
          _recent.set(packed + '|' + outerAd, out);
          if (_recent.size > RECENT_MAX) _recent.delete(_recent.keys().next().value);
        }
        return out;
      } catch (e) {
        if (!lastErr || (e && e.code === 'DUP')) lastErr = e;
      }
    }
    if (lastErr && lastErr.code === 'DUP') throw lastErr;
    throw _err('No se pudo descifrar (protocolo 2)', 'BAD');
  });
}

// El contacto recuperó su cuenta con Fénix (misma identidad, sesiones perdidas con su teléfono): se borran las
// sesiones con él; el próximo mensaje empieza una nueva (X3DH) con su paquete de claves
export function ratchetResetPeer(nexoId, ik) {
  return _serial(async function() {
    await ratchetInit();
    var nx = _nid(nexoId);
    if (!_store || !_store.sessions[nx]) return;
    _store.sessions[nx] = _store.sessions[nx].filter(function(s) { return s.rik !== ik; });
    await _save();
  });
}

// Clave de identidad rechazada por el usuario: fuera sus sesiones
export function ratchetForget(nexoId, ik) {
  return _serial(async function() {
    await ratchetInit();
    var nx = _nid(nexoId);
    if (!_store || !_store.sessions[nx]) return;
    _store.sessions[nx] = _store.sessions[nx].filter(function(s) { return s.rik !== ik; });
    if (_store.peers[nx] && _store.peers[nx].ik === ik) delete _store.peers[nx];
    await _save();
  });
}

// Textos y base64
export async function ratchetEncryptText(nx, ik, text, ad) { return ratchetEncrypt(nx, ik, _utf8(String(text)), ad); }
export async function ratchetDecryptText(nx, packed, ad) {
  var r = await ratchetDecrypt(nx, packed, ad);
  return { text: new TextDecoder().decode(r.bytes), senderKey: r.senderKey, dup: !!r.dup };
}
export async function ratchetEncryptB64(nx, ik, b64, ad) { return ratchetEncrypt(nx, ik, _unb64(b64), ad); }
export async function ratchetDecryptToB64(nx, packed, ad) {
  var r = await ratchetDecrypt(nx, packed, ad);
  return { b64: _b64(r.bytes), senderKey: r.senderKey, dup: !!r.dup };
}

// ---------- número de seguridad (como Signal: 60 cifras) ----------
async function _fp30(nx, ik) {
  var data = _cat(new Uint8Array([0, 0]), _unb64(ik), _utf8(_nid(nx)));
  var h = data;
  for (var i = 0; i < 5200; i++) h = new Uint8Array(await _subtle().digest('SHA-512', _cat(h, _unb64(ik))));
  var out = '';
  for (var j = 0; j < 6; j++) {
    var v = 0;
    for (var k = 0; k < 5; k++) v = v * 256 + h[j * 5 + k];
    out += ('00000' + (v % 100000)).slice(-5);
  }
  return out;
}
// 60 cifras en 12 grupos de 5; el mismo número en los dos teléfonos (ordenado por NEXO ID). Solo de las claves
// de identidad (como Signal): la de firma no protege nada por sí sola (sin la identidad no se descifra).
export async function ratchetSafetyNumber(myNx, theirNx, theirIk) {
  await ratchetInit();
  if (!_store || !theirIk) return '';
  var a = await _fp30(myNx, _store.ik), b = await _fp30(theirNx, theirIk);
  var s = _nid(myNx) < _nid(theirNx) ? a + b : b + a;
  return s.match(/.{5}/g).join(' ');
}
export function ratchetMySigningKey() { return _store ? _store.sign.pub : null; }
