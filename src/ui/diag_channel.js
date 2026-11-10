/**
 * NEXO — CANAL DIRECTO de diagnósticos a Claude (2992; pendiente importante #3 del dueño 10-11: «que lleguen a Claude por tiempo, sin copiar y
 * pegar»; su visto bueno a las llaves: «lo de las llaves está bien, estamos en fase de testeo»).
 *
 * Idea: el mismo texto que el diagnóstico automático manda al desarrollador (síntomas y resumen diario) se cifra TAMBIÉN para una llave de
 * DIAGNÓSTICO aparte —NO la identidad del dueño— y se publica en los relés públicos que la app ya usa. Una tarea programada de Claude
 * (tools/diag_reader.cjs) los baja, los descifra con la mitad privada (variable de entorno NEXO_DIAG_PRIV de SU entorno, nunca en el repositorio ni
 * en la app) y deja un informe. Solo lo que ya se manda al desarrollador; mismo interruptor del diagnóstico automático (autodiag.js); si el
 * interruptor está apagado no sale nada.
 *
 * Formato v1: evento Nostr kind 1065 firmado con una clave de UN SOLO USO (anónimo), etiqueta ['t','nexo-diag-<16 hex de SHA-256(pública)>'] (para
 * que el lector filtre) y caducidad de 7 días; contenido = base64( modo(1 byte: 1 JSON, 2 gzip) ‖ pública efímera (33) ‖ nonce (12) ‖ AES-256-GCM ).
 * Clave AES = SHA-256('NEXO-DIAG-v1|' ‖ x de ECDH secp256k1(efímera, pública de diagnóstico)); AAD = 'NEXO-DIAG-v1'.
 * Sin relé abierto el evento queda en una cola chica (3) y se reintenta (al volver a la app y cada minuto un rato).
 * Perillas de prueba: window.NEXO_DIAG_CHANNEL_PUB (otra pública), window.__nexoDiagChannel.
 */
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export var DIAG_CHANNEL_PUB = '03e28bb18b3ce6f1a0c1748b590f8ae73c6d409fe41f1eb660d236b5761f26ef5f';   // pública (hex comprimida, 33 bytes) de tools/diag_keygen.cjs; la privada vive solo en el entorno de Claude (NEXO_DIAG_PRIV)
export var DIAG_KIND = 1065;
var KEY_OUT = 'nexo_diagch_out';
var TTL_SEC = 7 * 86400, MAX_OUT = 3, MAX_EVENT_CHARS = 60000, SHORT_TEXT = 12000;
var _utf8 = function(s) { return new TextEncoder().encode(s); };
var AAD = _utf8('NEXO-DIAG-v1');

function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _net() { try { return (typeof window !== 'undefined' && window.bleInterface && window.bleInterface.net) || null; } catch (e) { return null; } }
function _cat() { var n = 0, i; for (i = 0; i < arguments.length; i++) n += arguments[i].length; var o = new Uint8Array(n), p = 0; for (i = 0; i < arguments.length; i++) { o.set(arguments[i], p); p += arguments[i].length; } return o; }
function _b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }

export function diagChannelPub() {
  var p = (typeof window !== 'undefined' && typeof window.NEXO_DIAG_CHANNEL_PUB === 'string') ? window.NEXO_DIAG_CHANNEL_PUB : DIAG_CHANNEL_PUB;
  return /^0[23][0-9a-f]{64}$/i.test(p || '') ? p.toLowerCase() : '';
}
export function diagChannelAvailable() { return !!diagChannelPub(); }
export function diagChannelTag(pubHex) { return 'nexo-diag-' + bytesToHex(sha256(hexToBytes(pubHex))).slice(0, 16); }

async function _gzip(bytes) {
  var cs = new CompressionStream('gzip'), w = cs.writable.getWriter(); w.write(bytes); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
/** Cifra `obj` (JSON) para la pública de diagnóstico → base64 (formato v1). */
export async function diagChannelSeal(obj, pubHex) {
  var json = _utf8(JSON.stringify(obj)), mode = 1, body = json;
  try { if (typeof CompressionStream === 'function') { var z = await _gzip(json); if (z.length < json.length) { mode = 2; body = z; } } } catch (e) {}
  var eph = secp256k1.utils.randomSecretKey(), ephPub = secp256k1.getPublicKey(eph, true);
  var shared = secp256k1.getSharedSecret(eph, hexToBytes(pubHex), true).slice(1);
  var aes = await crypto.subtle.importKey('raw', sha256(_cat(_utf8('NEXO-DIAG-v1|'), shared)), 'AES-GCM', false, ['encrypt']);
  var nonce = crypto.getRandomValues(new Uint8Array(12));
  var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: AAD }, aes, body));
  return _b64(_cat(new Uint8Array([mode]), ephPub, nonce, ct));
}
function _event(content, tag, expSec) {
  var sk = schnorr.utils.randomSecretKey(), pubkey = bytesToHex(schnorr.getPublicKey(sk)), created_at = Math.floor(Date.now() / 1000);
  var tags = [['t', tag], ['expiration', String(expSec)]];
  var id = sha256(_utf8(JSON.stringify([0, pubkey, created_at, DIAG_KIND, tags, content])));
  return { id: bytesToHex(id), pubkey: pubkey, created_at: created_at, kind: DIAG_KIND, tags: tags, content: content, sig: bytesToHex(schnorr.sign(id, sk)) };
}

function _outLoad() { try { var a = JSON.parse(_lsGet(KEY_OUT) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function _outSave(a) { _lsSet(KEY_OUT, JSON.stringify(a.slice(-MAX_OUT))); }
function _expSec(ev) { var t = (ev.tags || []).filter(function(x) { return x[0] === 'expiration'; })[0]; return t ? Number(t[1]) : 0; }

async function _publish(ev) {
  var net = _net(); if (!net || typeof net.publishEach !== 'function') return [];
  try { return await net.publishEach(ev, 10000); } catch (e) { return []; }
}
/** Reintenta lo que quedó en la cola (sin relé abierto la vez anterior). Devuelve cuántos salieron. */
export async function diagChannelFlush() {
  var out = _outLoad(), now = Math.floor(Date.now() / 1000), keep = [], sent = 0;
  for (var i = 0; i < out.length; i++) {
    var ev = out[i];
    if (!ev || _expSec(ev) <= now) continue;
    var oks = await _publish(ev);
    if (oks.length) sent++; else keep.push(ev);
  }
  _outSave(keep);
  if (keep.length) setTimeout(function() { diagChannelFlush(); }, 60000);
  if (sent) console.log('[DIAGCH] salieron ' + sent + ' diagnóstico(s) de la cola');
  return sent;
}
/** Manda (sym, info, text) al canal. Resuelve true si algún relé lo aceptó; si no, queda en la cola y se reintenta. */
export async function diagChannelSend(sym, info, text, build) {
  var pub = diagChannelPub(); if (!pub) return false;
  try {
    var payload = { v: 1, sym: String(sym || ''), info: String(info || ''), build: String(build || ''), at: Date.now(), text: String(text || '') };
    var content = await diagChannelSeal(payload, pub);
    if (content.length > MAX_EVENT_CHARS) { payload.text = payload.text.slice(-SHORT_TEXT); content = await diagChannelSeal(payload, pub); }
    if (content.length > MAX_EVENT_CHARS) return false;
    var ev = _event(content, diagChannelTag(pub), Math.floor(Date.now() / 1000) + TTL_SEC);
    var oks = await _publish(ev);
    if (oks.length) { console.log('[DIAGCH] «' + payload.sym + '» publicado en ' + oks.length + ' relé(s)'); return true; }
    var q = _outLoad(); q.push(ev); _outSave(q);
    console.log('[DIAGCH] «' + payload.sym + '» sin relé abierto: queda en la cola');
    setTimeout(function() { diagChannelFlush(); }, 60000);
    return false;
  } catch (e) { console.log('[DIAGCH] no se pudo mandar: ' + (e && e.message)); return false; }
}
/** Arranque: reintenta la cola un rato después y cada vez que se vuelve a la app. */
export function diagChannelInit() {
  try {
    if (typeof window === 'undefined') return;
    window.__nexoDiagChannel = { send: diagChannelSend, flush: diagChannelFlush, seal: diagChannelSeal, tag: diagChannelTag, pub: diagChannelPub, outbox: _outLoad, available: diagChannelAvailable };
    setTimeout(function() { if (_outLoad().length) diagChannelFlush(); }, 45000);
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible' && _outLoad().length) diagChannelFlush(); });
  } catch (e) {}
}
