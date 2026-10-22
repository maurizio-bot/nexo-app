/**
 * e2e_proto.js v1.0 — Una sola interfaz para los dos protocolos de cifrado.
 * - Protocolo 2 (e2e_ratchet.js, el de Signal) con quien lo anuncie: paquete de claves 'b2' en el kx o en la
 *   tarjeta de contacto, o un mensaje E2 válido suyo. El contacto queda marcado (proto 2, proto2At).
 * - Protocolo 1 (e2e_crypto.js) con builds anteriores.
 * - Sin vuelta atrás: a un contacto con protocolo 2 no se le cifra con el 1, y lo que llegue de él con el 1
 *   solo se acepta durante E1_GRACE_MS desde el cambio (lo que ya estaba en camino: transferencias guardadas
 *   duran 24 h). Después, un E1 suyo sería la repetición de un mensaje viejo (el 1 no las detecta).
 * Datos del sobre atados al cifrado (solo protocolo 2): "emisor|destino|id" (NEXO ID en minúsculas).
 */
import { e2eIsEncrypted, e2eEncryptText, e2eEncryptB64, e2eDecryptText, e2eDecryptToB64 } from './e2e_crypto.js';
import { ratchetIsE2, ratchetEncryptText, ratchetEncryptB64, ratchetDecryptText, ratchetDecryptToB64 } from './e2e_ratchet.js';

export var E1_GRACE_MS = 26 * 3600000;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }

export function e2eAnyEncrypted(s) { return e2eIsEncrypted(s) || ratchetIsE2(s); }
export function e2eOuterAd(from, to, id) { return _nid(from) + '|' + _nid(to) + '|' + String(id || ''); }

// ¿Se acepta un mensaje de protocolo 1 de este contacto?
export function e2eAllowsE1(contact) {
  return !(contact && contact.proto === 2 && Date.now() - (contact.proto2At || 0) > E1_GRACE_MS);
}

// t: { nx, key, proto } (destino, su clave aceptada y el protocolo a usar)
export function e2eSealText(t, text, ad) { return t.proto === 2 ? ratchetEncryptText(t.nx, t.key, text, ad) : e2eEncryptText(t.key, text); }
export function e2eSealB64(t, b64, ad) { return t.proto === 2 ? ratchetEncryptB64(t.nx, t.key, b64, ad) : e2eEncryptB64(t.key, b64); }

// Devuelven { text | b64, senderKey, proto, dup }. Errores del protocolo 2 con code 'DUP' o 'BAD'.
export async function e2eOpenText(fromNx, packed, ad) {
  var r = ratchetIsE2(packed) ? await ratchetDecryptText(fromNx, packed, ad) : await e2eDecryptText(packed);
  r.proto = ratchetIsE2(packed) ? 2 : 1;
  return r;
}
export async function e2eOpenToB64(fromNx, packed, ad) {
  var r = ratchetIsE2(packed) ? await ratchetDecryptToB64(fromNx, packed, ad) : await e2eDecryptToB64(packed);
  r.proto = ratchetIsE2(packed) ? 2 : 1;
  return r;
}
