/**
 * e2e_crypto.js v1.1 — Cifrado de extremo a extremo de NEXO (WebCrypto). Protocolo 1 (clave fija por
 * pareja); el protocolo 2 (Double Ratchet) está en e2e_ratchet.js y usa e2eIdentityDH.
 * - Identidad: par ECDH P-256 por teléfono, guardado en el almacenamiento interno de la app
 *   (archivo nexo_e2e_identity.json). La clave pública se comparte; la privada no sale del teléfono.
 * - Clave por pareja: ECDH(mi privada, su pública) → HKDF-SHA256 (info con ambas públicas ordenadas)
 *   → AES-GCM 256. Cada mensaje lleva un IV aleatorio de 12 bytes.
 * - Formato: "E1:<pública del emisor>:<iv>:<datos cifrados>" (base64). Incluir la pública del emisor
 *   permite descifrar siempre (también el primer mensaje, antes de intercambiar claves).
 * Se cifra el contenido (texto, adjuntos); la información de entrega (quién, a quién, ids, acks) va
 * en claro porque la necesitan los puentes (jump) para encaminar.
 */
var IDENTITY_FILE = 'nexo_e2e_identity.json';
var PREFIX = 'E1:';
var _identity = null;      // { priv: CryptoKey, pubB64: string }
var _initPromise = null;
var _keyCache = new Map(); // pública del otro → CryptoKey AES-GCM

function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _subtle() { return (window.crypto && window.crypto.subtle) || null; }

function _bytesToB64(bytes) {
  var CH = 0x8000, s = '';
  for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function _b64ToBytes(b64) {
  var bin = atob(b64), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function e2eAvailable() { return !!_subtle(); }

// Carga o crea la identidad. Idempotente.
export function initE2E() {
  if (_initPromise) return _initPromise;
  _initPromise = (async function() {
    var subtle = _subtle();
    if (!subtle) { console.warn('[E2E] WebCrypto no disponible: sin cifrado'); return null; }
    var pl = _plugin();
    try {
      if (pl && typeof pl.loadFromFile === 'function') {
        var r = await pl.loadFromFile({ filename: IDENTITY_FILE });
        if (r && r.exists && r.content) {
          var data = JSON.parse(r.content);
          if (data && data.priv && data.pub) {
            var priv = await subtle.importKey('jwk', data.priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
            _identity = { priv: priv, pubB64: data.pub };
            console.log('[E2E] Identidad cargada, huella ' + (await e2eFingerprint(data.pub)));
            return _identity;
          }
        }
      }
    } catch (e) { console.warn('[E2E] No se pudo cargar la identidad:', e && e.message); }
    var kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    var pubRaw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
    var privJwk = await subtle.exportKey('jwk', kp.privateKey);
    var pubB64 = _bytesToB64(pubRaw);
    _identity = { priv: kp.privateKey, pubB64: pubB64 };
    if (pl && typeof pl.saveToFile === 'function') {
      try { await pl.saveToFile({ filename: IDENTITY_FILE, content: JSON.stringify({ v: 1, priv: privJwk, pub: pubB64, createdAt: Date.now() }) }); }
      catch (e) { console.warn('[E2E] No se pudo guardar la identidad:', e && e.message); }
    }
    console.log('[E2E] Identidad nueva, huella ' + (await e2eFingerprint(pubB64)));
    return _identity;
  })();
  return _initPromise;
}

export function e2eMyPublicKey() { return _identity ? _identity.pubB64 : null; }

// v1.1: ECDH con la clave de identidad (para el acuerdo inicial del protocolo 2, e2e_ratchet.js). La
// privada no sale de este módulo: solo se devuelve el secreto compartido (32 bytes).
export async function e2eIdentityDH(peerPubB64) {
  await initE2E();
  if (!_identity) throw new Error('E2E sin identidad');
  var subtle = _subtle();
  var peer = await subtle.importKey('raw', _b64ToBytes(peerPubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: peer }, _identity.priv, 256));
}

// Huella legible de una clave pública (para comparar en persona): 5 grupos de 4 cifras hex
export async function e2eFingerprint(pubB64) {
  var subtle = _subtle();
  if (!subtle || !pubB64) return '';
  var h = new Uint8Array(await subtle.digest('SHA-256', _b64ToBytes(pubB64)));
  var hex = Array.prototype.map.call(h.subarray(0, 10), function(b) { return ('0' + b.toString(16)).slice(-2); }).join('').toUpperCase();
  return hex.match(/.{4}/g).join(' ');
}

export function e2eIsEncrypted(s) { return typeof s === 'string' && s.indexOf(PREFIX) === 0; }
export function e2eSenderKey(s) { return e2eIsEncrypted(s) ? s.split(':')[1] : null; }

async function _pairKey(peerPubB64) {
  var cached = _keyCache.get(peerPubB64);
  if (cached) return cached;
  var subtle = _subtle();
  await initE2E();
  if (!_identity) throw new Error('E2E sin identidad');
  var peer = await subtle.importKey('raw', _b64ToBytes(peerPubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  var secret = await subtle.deriveBits({ name: 'ECDH', public: peer }, _identity.priv, 256);
  var hk = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  var pair = [_identity.pubB64, peerPubB64].sort().join('|');
  var key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('NEXO-E2E-v1|' + pair) },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  _keyCache.set(peerPubB64, key);
  return key;
}

async function _encryptBytes(peerPubB64, bytes) {
  await initE2E();
  var key = await _pairKey(peerPubB64);
  var iv = window.crypto.getRandomValues(new Uint8Array(12));
  var ct = new Uint8Array(await _subtle().encrypt({ name: 'AES-GCM', iv: iv }, key, bytes));
  return PREFIX + _identity.pubB64 + ':' + _bytesToB64(iv) + ':' + _bytesToB64(ct);
}
async function _decryptBytes(packed) {
  var parts = packed.split(':');
  if (parts.length !== 4 || parts[0] + ':' !== PREFIX) throw new Error('Formato E2E no válido');
  var key = await _pairKey(parts[1]);
  var pt = await _subtle().decrypt({ name: 'AES-GCM', iv: _b64ToBytes(parts[2]) }, key, _b64ToBytes(parts[3]));
  return { bytes: new Uint8Array(pt), senderKey: parts[1] };
}

// v2729 (remitente sellado, Jump): sobre anónimo para un destinatario. Clave efímera nueva en cada sobre + la clave
// de identidad del destinatario (ECDH P-256 → HKDF → AES-256-GCM). A diferencia de E1, no lleva la clave del
// remitente: quien lo ve pasar (un puente) no sabe quién lo manda. Formato "S1:<efímera>:<iv>:<cifrado>"; datos
// adicionales: el destinatario (no se puede reenviar a otro).
var SEAL_PREFIX = 'S1:';
export function e2eIsSealed(s) { return typeof s === 'string' && s.indexOf(SEAL_PREFIX) === 0; }
export async function e2eSealAnon(peerPubB64, text) {
  var subtle = _subtle();
  await initE2E();
  var eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  var ephPub = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  var peer = await subtle.importKey('raw', _b64ToBytes(peerPubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  var key = await _sealKey(await subtle.deriveBits({ name: 'ECDH', public: peer }, eph.privateKey, 256), _bytesToB64(ephPub), peerPubB64);
  var iv = window.crypto.getRandomValues(new Uint8Array(12));
  var ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: new TextEncoder().encode(peerPubB64) }, key, new TextEncoder().encode(String(text))));
  return SEAL_PREFIX + _bytesToB64(ephPub) + ':' + _bytesToB64(iv) + ':' + _bytesToB64(ct);
}
export async function e2eOpenAnon(packed) {
  var parts = String(packed || '').split(':');
  if (parts.length !== 4 || parts[0] + ':' !== SEAL_PREFIX) throw new Error('Sobre no válido');
  var subtle = _subtle();
  await initE2E();
  if (!_identity) throw new Error('E2E sin identidad');
  var eph = await subtle.importKey('raw', _b64ToBytes(parts[1]), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  var key = await _sealKey(await subtle.deriveBits({ name: 'ECDH', public: eph }, _identity.priv, 256), parts[1], _identity.pubB64);
  var pt = await subtle.decrypt({ name: 'AES-GCM', iv: _b64ToBytes(parts[2]), additionalData: new TextEncoder().encode(_identity.pubB64) }, key, _b64ToBytes(parts[3]));
  return new TextDecoder().decode(pt);
}
async function _sealKey(secret, ephPubB64, recipientPubB64) {
  var subtle = _subtle();
  var hk = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('NEXO-SEAL-v1|' + ephPubB64 + '|' + recipientPubB64) },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Texto (UTF-8) ↔ paquete cifrado
export function e2eEncryptText(peerPubB64, text) { return _encryptBytes(peerPubB64, new TextEncoder().encode(String(text))); }
export async function e2eDecryptText(packed) {
  var r = await _decryptBytes(packed);
  return { text: new TextDecoder().decode(r.bytes), senderKey: r.senderKey };
}
// Adjunto en base64 ↔ paquete cifrado (se cifran los bytes, no el texto base64)
export function e2eEncryptB64(peerPubB64, b64) { return _encryptBytes(peerPubB64, _b64ToBytes(b64)); }
export async function e2eDecryptToB64(packed) {
  var r = await _decryptBytes(packed);
  return { b64: _bytesToB64(r.bytes), senderKey: r.senderKey };
}
