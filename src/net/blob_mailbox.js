/**
 * NEXO — BUZÓN DE ARCHIVOS en relés (Fase B de la entrega offline; docs/CONTRATOS_ENTREGA_OFFLINE_FASE_AB.md, build 2969).
 *
 * Problema: un archivo a un contacto DORMIDO (apagado, solo por internet) no llegaba nunca si los dos no coincidían en
 * línea: el flujo por trozos con ventanas de ACK necesita al otro despierto. Los textos sí tienen buzón (relés); los
 * archivos no. Esto es el buzón de archivos, sin servidor propio: los relés Nostr guardan el archivo cifrado y el
 * contacto lo baja cuando despierte, aunque el que lo mandó ya no esté.
 *
 * Orden FIJO (regla dura §4): leer → cifrar TODO el archivo UNA vez con (k, nonce) aleatorios (AES-256-GCM) → huella del
 * cifrado → partir el CIFRADO en trozos de 40 KB → publicar cada trozo como un evento del relé (sin etiqueta del
 * destinatario: se baja por su id, el relé no correlaciona quién baja qué) en TODOS los relés abiertos (réplica) → mandar
 * al contacto, por el buzón normal E2E, un PUNTERO chiquito (k, nonce, huella, tamaño, ids de los trozos, relés, caducidad).
 * NUNCA al revés (partir y cifrar trozo por trozo llevaría a reusar nonce = romper GCM).
 *
 * El que recibe, OBLIGATORIO y en orden: (1) RECHAZA el puntero si pasa los techos anti-DoS (trozos, tamaño, miniatura)
 * ANTES de reservar o iterar nada (clase #2804/#2941); (2) por trozo, comprueba que el id del evento (= SHA-256 de todo
 * el evento, trozo incluido) coincide con el del puntero y el largo con el declarado: un relé malicioso no puede cambiar
 * un byte sin que se note → se pide a OTRO relé; (3) al armar, SHA-256(blob) == huella; (4) descifra con (k, nonce): GCM
 * confirma la integridad. Si algo no cuadra, no se muestra basura: se reintenta o se descarta.
 *
 * Lo que esta Fase NO hace (va en C/D/E): reenvío/fan-out por referencia, miniatura en el puntero, stream directo al
 * coincidir, blob-store de terceros. Los textos y el toque FCM (Fase A) siguen igual.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export var CHUNK_RAW_BYTES = 40 * 1024;          // 40 KB → base64 ≈ 54,6 KB + evento < ~60 KB del relé (lección 2964: el tope es sobre lo YA codificado)
export var MAILBOX_MAX_BYTES = 5 * 1024 * 1024;   // lo que se stagea en relés en Fase B (~125 trozos)
export var RELAY_REPLICATION = 3;                 // objetivo: cada trozo en ≥3 relés (los que haya abiertos)
export var MAX_POINTER_CHUNKS = 10000;            // techo anti-DoS: rechazo inmediato, ANTES de reservar nada
export var MAX_POINTER_BYTES = 64 * 1024 * 1024;  // ídem, tamaño
export var MAX_CHUNK_BYTES = 64 * 1024;           // un trozo declarado más grande que esto es basura
export var MAX_POINTER_RELAYS = 10;
export var BLOB_TTL_SEC = 7 * 86400;              // caducidad en los relés (NIP-40): la garantía real de limpieza
export var MAX_CONCURRENT = 3;                    // bajadas pesadas a la vez; el resto en cola
export var THUMB_MAX_BYTES = 16 * 1024;
export var FETCH_BATCH = 16;                      // ids por REQ
export var PUBLISH_PARALLEL = 3;                  // trozos publicándose a la vez (ritmo acotado por relé)
export var BLOB_KIND = 1064;                      // kind de los eventos-trozo: NO 1059 (los relés con NIP-42 solo dejan leer 1059 al etiquetado)

var _cryptoObj = (typeof crypto !== 'undefined') ? crypto : null;
// [pegamento] pruebas (jsdom/node): inyectar el webcrypto a usar
export function blobCryptoUse(c) { _cryptoObj = c || ((typeof crypto !== 'undefined') ? crypto : null); }

// ---------- codificación ----------
export function _b64ToBytes(b64) {
  var s = atob(b64), o = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
  return o;
}
export function _bytesToB64(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function _b64Bytes(b64) { var l = (b64 || '').length; if (!l) return 0; var pad = b64.charAt(l - 1) === '=' ? (b64.charAt(l - 2) === '=' ? 2 : 1) : 0; return Math.floor(l * 3 / 4) - pad; }
function _rand(n) { var a = new Uint8Array(n); _cryptoObj.getRandomValues(a); return a; }
function _utf8(s) { return new TextEncoder().encode(s); }
export async function _sha256Hex(bytes) {
  try { if (_cryptoObj && _cryptoObj.subtle) return bytesToHex(new Uint8Array(await _cryptoObj.subtle.digest('SHA-256', bytes))); } catch (e) {}
  return bytesToHex(sha256(bytes));
}
// Id de un evento Nostr (NIP-01): SHA-256 de [0, pubkey, created_at, kind, tags, content]. Es la huella del TROZO: cambiar
// un byte del contenido cambia el id → el receptor lo detecta sin una huella aparte (pura, síncrona: noble).
export function _eventId(ev) {
  return bytesToHex(sha256(_utf8(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
}

// ---------- cripto del blob: UN (k, nonce) por blob, NUNCA reusado ----------
export async function encryptBlob(bytes) {
  var k = _rand(32), nonce = _rand(12);
  var key = await _cryptoObj.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt']);
  var ct = new Uint8Array(await _cryptoObj.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, bytes));
  return { k: k, nonce: nonce, ct: ct };
}
export async function decryptBlob(ct, k, nonce) {
  var key = await _cryptoObj.subtle.importKey('raw', k, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await _cryptoObj.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct)); // lanza si algo cambió
}
// Partir el CIFRADO (después de cifrar entero, nunca antes)
export function splitChunks(ct, size) {
  var s = size || CHUNK_RAW_BYTES, out = [];
  for (var i = 0; i < ct.length; i += s) out.push(ct.subarray(i, Math.min(i + s, ct.length)));
  return out;
}

// ---------- puntero v1 ----------
var HEX64 = /^[0-9a-f]{64}$/, B64_32 = /^[A-Za-z0-9+/]{43}=$/, B64_12 = /^[A-Za-z0-9+/]{16}$/;
// ¿Es un puntero válido y dentro de los techos? Devuelve null (ok) o el motivo. TODO se decide con números del puntero,
// sin reservar ni un byte del archivo ni recorrer más allá de los techos (anti-DoS).
export function validatePointer(ptr, nowSec) {
  if (!ptr || typeof ptr !== 'object') return 'no es un puntero';
  if (ptr.v !== 1 || ptr.kind !== 'file-pointer' || ptr.alg !== 'AES-256-GCM') return 'versión/algoritmo';
  if (typeof ptr.k !== 'string' || !B64_32.test(ptr.k)) return 'llave';
  if (typeof ptr.nonce !== 'string' || !B64_12.test(ptr.nonce)) return 'nonce';
  if (typeof ptr.hash !== 'string' || !HEX64.test(ptr.hash)) return 'huella';
  if (!Number.isInteger(ptr.size) || ptr.size < 17 || ptr.size > MAX_POINTER_BYTES) return 'tamaño (' + ptr.size + ')';
  if (!Number.isInteger(ptr.raw) || ptr.raw < 1 || ptr.raw > ptr.size) return 'tamaño original';
  if (!Number.isInteger(ptr.chunk) || ptr.chunk < 1024 || ptr.chunk > MAX_CHUNK_BYTES) return 'tamaño de trozo';
  if (!Array.isArray(ptr.chunks) || ptr.chunks.length < 1 || ptr.chunks.length > MAX_POINTER_CHUNKS) return 'cantidad de trozos (' + (ptr.chunks && ptr.chunks.length) + ')';
  if (ptr.chunks.length !== Math.ceil(ptr.size / ptr.chunk)) return 'trozos no cuadran con el tamaño';
  if (!Array.isArray(ptr.relays) || ptr.relays.length < 1 || ptr.relays.length > MAX_POINTER_RELAYS || !ptr.relays.every(function(u) { return typeof u === 'string' && /^wss?:\/\//.test(u) && u.length < 200; })) return 'relés';
  if (!Number.isInteger(ptr.expires) || ptr.expires <= (nowSec || Math.floor(Date.now() / 1000))) return 'caducado';
  if (ptr.thumb != null && (typeof ptr.thumb !== 'string' || _b64Bytes(ptr.thumb) > THUMB_MAX_BYTES)) return 'miniatura';
  var sum = 0, seen = Object.create(null);
  for (var i = 0; i < ptr.chunks.length; i++) {
    var c = ptr.chunks[i];
    if (!c || c.i !== i || !Number.isInteger(c.n) || c.n < 1 || c.n > ptr.chunk || typeof c.id !== 'string' || !HEX64.test(c.id)) return 'trozo ' + i;
    if (i < ptr.chunks.length - 1 && c.n !== ptr.chunk) return 'trozo ' + i + ' corto';
    if (seen[c.id]) return 'trozo ' + i + ' repetido';
    seen[c.id] = 1;
    if (c.r != null && (!Array.isArray(c.r) || !c.r.every(function(x) { return Number.isInteger(x) && x >= 0 && x < ptr.relays.length; }))) return 'relés del trozo ' + i;
    sum += c.n;
  }
  if (sum !== ptr.size) return 'suma de trozos';
  return null;
}
// Reserva (una sola vez, ya validado) y arma el cifrado a partir de los trozos verificados
export function assembleChunks(parts, ptr) {
  var out = new Uint8Array(ptr.size), off = 0;
  for (var i = 0; i < ptr.chunks.length; i++) {
    var p = parts[i];
    if (!p || p.length !== ptr.chunks[i].n) throw Object.assign(new Error('Falta el trozo ' + i), { code: 'BLOB_INCOMPLETE' });
    out.set(p, off); off += p.length;
  }
  return out;
}
// ¿Puede ir por el buzón de archivos? (tope de Fase B; interruptor NEXO_BLOB_MAILBOX=false para apagarlo)
export function blobMailboxEligible(dataB64, meta) {
  if (typeof window !== 'undefined' && window.NEXO_BLOB_MAILBOX === false) return false;
  if (meta && (meta.dst || meta.fwd)) return false; // Jump y reenvíos: Fase C
  return typeof dataB64 === 'string' && dataB64.length > 0 && _b64Bytes(dataB64) <= MAILBOX_MAX_BYTES;
}
// ¿Este contenido de mensaje es un PUNTERO a un archivo del buzón? Devuelve el adjunto {type:'attachment', payload:'ptr', ptr, ...} o null
export function blobPointerIn(content, ctrl) {
  try {
    var a = (ctrl && ctrl.payload && ctrl.payload.attachment) ? ctrl.payload.attachment : null;
    if (!a && typeof content === 'string' && content.indexOf('"ptr"') >= 0 && content.charAt(0) === '{') a = JSON.parse(content);
    if (a && a.type === 'attachment' && a.payload === 'ptr' && a.ptr && typeof a.ptr === 'object') return a;
  } catch (e) {}
  return null;
}

// ---------- emisor: cifrar una vez, partir, publicar con réplica, armar el puntero ----------
// net: NetLink (randomKey, blobEvent, publishEach). Devuelve { pointer, outRecord: { sk, ids, relays, expires }, replication }.
export async function stageBlob(net, dataB64, opts) {
  var o = opts || {};
  var bytes = _b64ToBytes(dataB64);
  if (bytes.length > MAILBOX_MAX_BYTES) throw Object.assign(new Error('Archivo demasiado grande para el buzón de archivos'), { code: 'BLOB_TOO_BIG' });
  var enc = await encryptBlob(bytes);                 // 1) cifrar TODO, una vez
  var hash = await _sha256Hex(enc.ct);                // 2) huella del cifrado
  var pieces = splitChunks(enc.ct, CHUNK_RAW_BYTES);  // 3) partir el cifrado
  var sk = net.randomKey();                           // una clave por blob (permite un solo evento de borrado al confirmar)
  var exp = Math.floor(Date.now() / 1000) + (o.ttlSec || BLOB_TTL_SEC);
  var timeout = o.publishTimeoutMs || 10000;
  var relays = [], chunks = new Array(pieces.length), ids = new Array(pieces.length), minRep = Infinity;
  var publishOne = async function(i) {
    var ev = net.blobEvent(sk, _bytesToB64(pieces[i]), exp);
    var ok = await net.publishEach(ev, timeout);
    if (!ok.length) ok = await net.publishEach(ev, timeout); // un reintento (el mismo evento: mismo id)
    if (!ok.length) throw Object.assign(new Error('Ningún relé guardó el trozo ' + i), { code: 'NET_DOWN' });
    ok.forEach(function(u) { if (relays.indexOf(u) < 0) relays.push(u); });
    chunks[i] = { i: i, n: pieces[i].length, id: ev.id, r: ok.map(function(u) { return relays.indexOf(u); }) };
    ids[i] = ev.id;
    if (ok.length < minRep) minRep = ok.length;
    if (o.onProgress) o.onProgress(i + 1, pieces.length);
  };
  for (var b = 0; b < pieces.length; b += PUBLISH_PARALLEL) {       // 4) publicar, ritmo acotado
    var batch = [];
    for (var j = b; j < Math.min(b + PUBLISH_PARALLEL, pieces.length); j++) batch.push(publishOne(j));
    await Promise.all(batch);
  }
  var pointer = { v: 1, kind: 'file-pointer', alg: 'AES-256-GCM', k: _bytesToB64(enc.k), nonce: _bytesToB64(enc.nonce), hash: hash,
    size: enc.ct.length, raw: bytes.length, chunk: CHUNK_RAW_BYTES, chunks: chunks, relays: relays, expires: exp };
  if (typeof o.thumb === 'string' && _b64Bytes(o.thumb) <= THUMB_MAX_BYTES) pointer.thumb = o.thumb;
  return { pointer: pointer, outRecord: { sk: _bytesToB64(sk), ids: ids, relays: relays, expires: exp }, replication: minRep === Infinity ? 0 : minRep };
}

// ---------- receptor: bajar por id, verificar cada trozo, armar, verificar el todo, descifrar ----------
// net: NetLink (openRelayUrls, ensureRelay, fetchEvents). Lanza con code BLOB_PTR / NET_DOWN / BLOB_INCOMPLETE / BLOB_HASH / BLOB_GCM.
export async function fetchBlob(net, ptr, opts) {
  var o = opts || {}, log = o.log || function() {};
  var why = validatePointer(ptr);
  if (why) throw Object.assign(new Error('Puntero rechazado: ' + why), { code: 'BLOB_PTR' });
  // relés: primero los del puntero (se abren a demanda si hace falta), después cualquier otro abierto
  var urls = [];
  for (var k = 0; k < ptr.relays.length; k++) {
    var u = ptr.relays[k];
    try { if (await net.ensureRelay(u, o.connectMs || 6000)) urls.push(u); } catch (e) {}
  }
  (net.openRelayUrls ? net.openRelayUrls() : []).forEach(function(u) { if (urls.indexOf(u) < 0) urls.push(u); });
  if (!urls.length) throw Object.assign(new Error('Sin relés para bajar el archivo'), { code: 'NET_DOWN' });
  var parts = new Array(ptr.chunks.length), byId = new Map(), bad = 0, fetched = 0;
  ptr.chunks.forEach(function(c) { byId.set(c.id, c); });
  var missing = function() { var m = []; for (var i = 0; i < ptr.chunks.length; i++) if (!parts[i]) m.push(i); return m; };
  for (var u2 = 0; u2 < urls.length; u2++) {
    var url = urls[u2], ri = ptr.relays.indexOf(url), left = missing();
    if (!left.length) break;
    // lo que este relé debería tener según el puntero; si no sabemos (otro relé), se le pide todo lo que falta
    var want = left.filter(function(i) { var c = ptr.chunks[i]; return ri < 0 || !c.r || !c.r.length || c.r.indexOf(ri) >= 0; });
    if (!want.length) continue;
    for (var b = 0; b < want.length; b += FETCH_BATCH) {
      var ids = want.slice(b, b + FETCH_BATCH).filter(function(i) { return !parts[i]; }).map(function(i) { return ptr.chunks[i].id; });
      if (!ids.length) continue;
      var evs = [];
      try { evs = await net.fetchEvents(url, ids, o.timeoutMs || 15000); } catch (e) { evs = []; }
      for (var e2 = 0; e2 < evs.length; e2++) {
        var ev = evs[e2], c = ev && byId.get(ev.id);
        if (!c || parts[c.i]) continue;
        fetched++;
        var bytes = null;
        try { if (typeof ev.content === 'string' && ev.content.length <= MAX_CHUNK_BYTES * 2) bytes = _b64ToBytes(ev.content); } catch (e3) { bytes = null; }
        // el id del evento ES la huella del trozo: si el relé tocó un byte, el id recalculado no coincide
        if (!bytes || bytes.length !== c.n || ev.kind !== BLOB_KIND || _eventId(ev) !== c.id) { bad++; log('[BLOB] trozo ' + c.i + ' de ' + url + ' NO coincide con su huella: se pide a otro relé'); continue; }
        parts[c.i] = bytes;
      }
    }
  }
  var still = missing();
  if (still.length) throw Object.assign(new Error('Faltan ' + still.length + ' de ' + ptr.chunks.length + ' trozos'), { code: 'BLOB_INCOMPLETE', missing: still.length, bad: bad });
  var ct = assembleChunks(parts, ptr);
  var hash = await _sha256Hex(ct);
  if (hash !== ptr.hash) throw Object.assign(new Error('La huella del archivo no coincide'), { code: 'BLOB_HASH' });
  var plain;
  try { plain = await decryptBlob(ct, _b64ToBytes(ptr.k), _b64ToBytes(ptr.nonce)); } catch (e4) { throw Object.assign(new Error('No se pudo descifrar (GCM)'), { code: 'BLOB_GCM' }); }
  if (plain.length !== ptr.raw) throw Object.assign(new Error('Tamaño descifrado inesperado'), { code: 'BLOB_HASH' });
  return { bytes: plain, b64: _bytesToB64(plain), bad: bad, fetched: fetched, relays: urls.length };
}

// ---------- registro del emisor (para borrar del relé al confirmar; la caducidad es la garantía) ----------
var OUT_KEY = 'nexo_blob_out';
export function loadBlobOut(store) {
  var m = new Map(), st = store || ((typeof localStorage !== 'undefined') ? localStorage : null);
  try {
    var raw = st && st.getItem(OUT_KEY), now = Date.now();
    if (raw) Object.entries(JSON.parse(raw)).forEach(function(kv) { if (kv[1] && kv[1].expires > now) m.set(kv[0], kv[1]); });
  } catch (e) {}
  return m;
}
export function saveBlobOut(map, store) {
  var st = store || ((typeof localStorage !== 'undefined') ? localStorage : null);
  try {
    var o = {}, now = Date.now();
    map.forEach(function(v, k) { if (v && v.expires > now) o[k] = v; });
    if (st) st.setItem(OUT_KEY, JSON.stringify(o));
  } catch (e) {}
}
// Reintentos de una bajada que falló (relé caído, sin internet): 30 s → 2 m → 8 m → 30 m → 30 m… hasta que el puntero caduque
export var FETCH_RETRY_MS = [30000, 120000, 480000, 1800000];
export function _fetchRetryDelay(tries) { return FETCH_RETRY_MS[Math.min(Math.max(0, tries - 1), FETCH_RETRY_MS.length - 1)]; }

// ---------- Fase C (2971): dedup local por huella — el que recibe recuerda qué blobs ya tiene (hash → dónde está) ----------
var SEEN_KEY = 'nexo_blob_seen', SEEN_MAX = 300;
export function loadBlobSeen(store) {
  var m = new Map(), st = store || ((typeof localStorage !== 'undefined') ? localStorage : null);
  try { var raw = st && st.getItem(SEEN_KEY); if (raw) Object.entries(JSON.parse(raw)).forEach(function(kv) { m.set(kv[0], kv[1]); }); } catch (e) {}
  return m;
}
export function saveBlobSeen(map, store) {
  var st = store || ((typeof localStorage !== 'undefined') ? localStorage : null);
  try {
    while (map.size > SEEN_MAX) map.delete(map.keys().next().value);
    var o = {}; map.forEach(function(v, k) { o[k] = v; });
    if (st) st.setItem(SEEN_KEY, JSON.stringify(o));
  } catch (e) {}
}
// ¿Puntero vigente y bien formado para REENVIAR POR REFERENCIA (el mismo blob ya vive en los relés: no se vuelve a subir)?
export function pointerReusable(ptr) { return !!ptr && typeof ptr === 'object' && validatePointer(ptr) === null; }
