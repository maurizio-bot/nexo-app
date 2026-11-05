/**
 * psi.js — Perfil enriquecido, paso 3 (pedido del dueño 04-11): «contactos en común» entre dos NEXO, con criptografía
 * PRIVADA (PSI, Private Set Intersection). Cada uno descubre SOLO los contactos que tienen en común, sin revelarle al
 * otro el resto de su agenda ni ver la agenda ajena.
 *
 * Cómo (PSI por Diffie-Hellman, conmutativo, semi-honesto — el modelo que encaja con «dos contactos que ya se conectaron»):
 *   - Cada contacto es su NEXO ID. H(id) = hash-a-curva (secp256k1) de 'NEXO-PSI-v1|'+id → un punto.
 *   - El que INICIA (A, el de NEXO ID menor) manda {H(x)^a : x en mi agenda}, MEZCLADO (a = escalar secreto efímero).
 *   - El otro (B) responde: por cada punto recibido p, p^b = H(x)^(a·b) (MISMO orden), y además {H(y)^b : y en SU agenda},
 *     MEZCLADO (b = su escalar efímero).
 *   - A eleva los de B a ^a → H(y)^(a·b), arma un conjunto, y los compara con sus H(x)^(a·b): los que coinciden son los
 *     contactos EN COMÚN (los x de A que también están en B). A no puede invertir los H(y) de B que no tiene → no aprende
 *     el resto de la agenda de B. B nunca puede quitar el ^a de lo de A → no aprende la agenda de A.
 *   - A le manda a B la lista de IDs en común (son contactos que B YA tiene → no se le revela nada nuevo); B la filtra
 *     contra su propia agenda (defensa: solo muestra IDs que realmente tiene). Así ambos ven el mismo resultado.
 *   - Fuga mínima y aceptada (semi-honesto): cada lado aprende el TAMAÑO de la agenda del otro (cantidad de puntos). No
 *     los IDs. Escalares efímeros por corrida → dos corridas no se pueden correlacionar.
 *
 * Transporte: acción oculta E2E ({type:'nexo_act', act:'psi', st:1|2|3, ...}) por el canal cifrado, como profile_share /
 * avatar. Se dispara BAJO DEMANDA: al abrir la ficha del contacto (⋮ → Perfil) estando en línea — que es justo cuando
 * interesa ver «contactos en común». NO corre solo en cada conexión: así no gasta batería/tráfico ni revela el tamaño de
 * la agenda a cada contacto en cada encuentro, y no se mezcla con el conteo de mensajes de otras pruebas. Resultado
 * cacheado por contacto (nexo_psi_<nx>.json) con TTL y un hash de mi agenda (si cambia o caduca, se recalcula).
 */
import { secp256k1, secp256k1_hasher } from '@noble/curves/secp256k1.js';
import { _normId, _getBLEContacts } from './ble_helpers.js';
import { _sendTextTo } from './send.js';

var NX_RE = /^nx[0-9a-z]{8}$/;
var MAX_SET = 500;          // tope de contactos por corrida (evita trabajo desmedido)
var MAX_WIRE = 1000;        // tope de puntos aceptados de la pareja (anti-DoS: no elevar millones de puntos)
var TTL_MS = 12 * 3600 * 1000;  // no recalcular si el resultado es más nuevo que esto y mi agenda no cambió

var _P = secp256k1.Point;
var _N = _P.CURVE().n;
function _enc(s) { return new TextEncoder().encode(s); }
function _rndScalar() {
  var b = new Uint8Array(48);
  (typeof globalThis !== 'undefined' && globalThis.crypto ? globalThis.crypto : window.crypto).getRandomValues(b);
  var x = 0n; for (var i = 0; i < b.length; i++) x = (x << 8n) | BigInt(b[i]);
  x = x % (_N - 1n); return x + 1n;                 // en [1, n-1]
}
function _Hpt(id) { return secp256k1_hasher.hashToCurve(_enc('NEXO-PSI-v1|' + id)); }  // hash-a-curva del ID
function _blind(id, s) { return _Hpt(id).multiply(s).toHex(true); }                    // H(id)^s (hex comprimido)
function _raise(hex, s) { try { return _P.fromHex(hex).multiply(s).toHex(true); } catch (e) { return ''; } } // p^s, '' si inválido
function _shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// ---- Lógica PURA del protocolo (testeable: dos lados con agendas conocidas → intersección correcta, sin fugas) ----
export function psiNewScalar() { return _rndScalar(); }
/** Ronda 1 (A): devuelve { a:[H(x)^s mezclados], aIds:[los x en ESE orden] } para recordar a qué x corresponde cada a[i]. */
export function psiRound1(ids, s) {
  var pairs = (ids || []).slice(0, MAX_SET).map(function (id) { return { id: id, h: _blind(id, s) }; });
  _shuffle(pairs);
  return { a: pairs.map(function (p) { return p.h; }), aIds: pairs.map(function (p) { return p.id; }) };
}
/** Ronda 2 (B): ab = cada punto de A elevado a ^b (MISMO orden); bb = los míos H(y)^b mezclados. */
export function psiRound2(aHexes, myIds, s) {
  var ab = (aHexes || []).slice(0, MAX_WIRE).map(function (h) { return _raise(h, s); });
  var bb = (myIds || []).slice(0, MAX_SET).map(function (id) { return _blind(id, s); });
  _shuffle(bb);
  return { ab: ab, bb: bb };
}
/** Ronda 3 (A): eleva los bb a ^a, arma conjunto y devuelve los aIds cuyos ab[i] coinciden = contactos en común. */
export function psiRound3(abHexes, bbHexes, aIds, s) {
  var set = Object.create(null);
  (bbHexes || []).slice(0, MAX_WIRE).forEach(function (h) { var r = _raise(h, s); if (r) set[r] = 1; });
  var common = [];
  var ab = abHexes || [];
  for (var i = 0; i < aIds.length; i++) { if (ab[i] && set[ab[i]]) common.push(aIds[i]); }
  return common;
}

// ---- Estado vivo ----
var _started = false;
var _cache = {};              // NEXO ID → { ts, mh, c:[ids en común] }
var _sessions = Object.create(null); // NEXO ID → { s, aIds } mientras A espera la ronda 2

function _pl() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _load(name) {
  var pl = _pl();
  if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
  return pl.loadFromFile({ filename: name }).then(function (r) { return r && r.exists && r.content ? JSON.parse(r.content) : null; }).catch(function () { return null; });
}
function _save(name, obj) { var pl = _pl(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: name, content: JSON.stringify(obj) }).catch(function () {}); }
function _hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
function _contactIds() { return _getBLEContacts().map(function (c) { return _normId(c.nexoId || c.deviceUUID); }).filter(function (nx) { return NX_RE.test(nx); }); }
function _myHash() { return _hash(_contactIds().sort().join('|')); }

function _store(nx, common) {
  var rec = { ts: Date.now(), mh: _myHash(), c: common.slice() };
  _cache[nx] = rec;
  _save('nexo_psi_' + nx + '.json', rec);
  try { window.dispatchEvent(new CustomEvent('nexo:psi', { detail: { nx: nx, common: rec.c } })); } catch (e) {}
  console.log('[PSI] contactos en común con ' + nx + ': ' + common.length);
}

/** Arrancar una corrida con nx (al abrir su ficha, estando en línea). No re-corre si ya hay resultado fresco (mi agenda
 *  igual y dentro del TTL) ni si hay una corrida en curso. El que abre la ficha SIEMPRE puede iniciar (sin regla de turno:
 *  si abren los dos a la vez, dan el mismo resultado, es idempotente). */
export function psiEnsure(nx) {
  nx = _normId(nx);
  if (!NX_RE.test(nx)) return;
  if (_sessions[nx]) return;                                  // ya hay una corrida en curso con este contacto
  var c = _cache[nx];
  if (c && c.mh === _myHash() && (Date.now() - c.ts) < TTL_MS) return;   // resultado fresco → no recalcular
  var s = _rndScalar();
  var r = psiRound1(_contactIds(), s);
  _sessions[nx] = { s: s, aIds: r.aIds };
  _sendTextTo(nx, JSON.stringify({ type: 'nexo_act', act: 'psi', st: 1, a: r.a }), '', true);
}

/** Acción PSI entrante (chat_actions._applyChatAction). Enruta por st y manda la respuesta por el mismo canal E2E. */
export function psiOnAction(sender, act) {
  var nx = _normId(sender);
  if (!NX_RE.test(nx) || !act) return;
  try {
    if (act.st === 1) {
      if (!Array.isArray(act.a)) return;
      var sB = _rndScalar();
      var r2 = psiRound2(act.a, _contactIds(), sB);
      _sendTextTo(nx, JSON.stringify({ type: 'nexo_act', act: 'psi', st: 2, ab: r2.ab, bb: r2.bb }), '', true);
      return;
    }
    if (act.st === 2) {
      var sess = _sessions[nx];
      if (!sess) return;                                      // ronda 2 sin ronda 1 mía (vieja/duplicada) → ignorar
      delete _sessions[nx];
      if (!Array.isArray(act.ab) || !Array.isArray(act.bb)) return;
      var common = psiRound3(act.ab, act.bb, sess.aIds, sess.s);
      _store(nx, common);
      _sendTextTo(nx, JSON.stringify({ type: 'nexo_act', act: 'psi', st: 3, c: common }), '', true);
      return;
    }
    if (act.st === 3) {
      var mineSet = Object.create(null);
      _contactIds().forEach(function (id) { mineSet[id] = 1; });
      var got = (Array.isArray(act.c) ? act.c : []).map(_normId).filter(function (id) { return NX_RE.test(id) && mineSet[id]; });
      _store(nx, got);                                        // solo IDs que YO también tengo (defensa contra inyección)
      return;
    }
  } catch (e) { console.warn('[PSI] onAction:', e && e.message); }
}

/** Para la ficha del contacto (profile.js). Devuelve el array de IDs en común (puede ser vacío) o null si nunca se calculó. */
export function getCommonContacts(nx) {
  var c = _cache[_normId(nx)];
  return c && Array.isArray(c.c) ? c.c.slice() : null;
}

export function psiInit() {
  if (_started) return;
  _started = true;
  // Cargar los resultados ya calculados (para mostrarlos al instante en la ficha). NO se dispara nada solo: el cálculo
  // arranca cuando el usuario abre la ficha del contacto (profile.js → psiEnsure), no en cada conexión.
  _contactIds().forEach(function (nx) {
    _load('nexo_psi_' + nx + '.json').then(function (o) { if (o && Array.isArray(o.c)) _cache[nx] = { ts: o.ts || 0, mh: o.mh || '', c: o.c }; });
  });
}

// Ganchos de prueba (tests/sim): JS puro, el plugin no está en jsdom.
try {
  if (typeof window !== 'undefined') {
    window.__nexoPsiEnsure = psiEnsure;
    window.__nexoGetCommon = getCommonContacts;
    window.__nexoPsi = { round1: psiRound1, round2: psiRound2, round3: psiRound3, newScalar: psiNewScalar, blind: _blind };
  }
} catch (e) {}
