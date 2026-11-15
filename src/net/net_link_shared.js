import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
// Constantes y ayudantes de NetLink (reestructuración 15-11: antes, la cabecera de net_link.js).
var DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom'];
// 3114 (dueño 15-11: «si un servidor no funciona se ocupa otro y eso debe ser algo rápido, no debe detectarse en el uso diario»): relés
// de RESERVA, en este orden (los dos teléfonos eligen el mismo: así se siguen encontrando). Uno de los de siempre que no conecta
// RELAY_DEAD_FAILS veces seguidas se da por caído y entra el siguiente de reserva para tener RELAY_TARGET_OPEN sanos; cuando los de
// siempre vuelven, se sueltan. Solo con los relés por defecto (con una lista propia o en el simulador: window.NEXO_SPARE_RELAYS).
var SPARE_RELAYS = ['wss://offchain.pub', 'wss://relay.snort.social', 'wss://nostr.oxtr.dev', 'wss://relay.nostr.bg', 'wss://nostr-pub.wellorder.net'];
var RELAY_TARGET_OPEN = 3;
var RELAY_DEAD_FAILS = 2;

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
var NET_CHANGE_SETTLE_MS = 250;      // 3109: avisos de cambio de red más juntos que esto se tratan como uno (el último manda)
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

export { DEFAULT_RELAYS, SPARE_RELAYS, RELAY_TARGET_OPEN, RELAY_DEAD_FAILS, _relaySafe, KIND, BLOB_KIND, UP_MS, HELLO_MS, TICK_MS, TTL_MSG, TTL_CHUNK, TTL_HELLO, MAX_CONTENT, MAX_RELAY_FRAME, NET_CHANGE_SETTLE_MS, RELAY_STABLE_MS, RELAY_FLAP_WINDOW_MS, RELAY_FLAP_MAX, RELAY_FLAP_PENALTY_MS, RELAY_PROBE_MS, RELAY_IDLE_PROBE_MS, RELAY_BG_PROBE_MS, RELAY_PROBE_ID, RELAY_OFFLINE_RETRY_MS, RELAY_MIN_OTHERS, WAKE_MIN_MS, CALL_WAKE_MIN_MS, XFER_WAKE_MIN_MS, DEFAULT_SENDER, STATE_FILE, N, _nid, _relayHost, _plugin, _day, _utf8, _b64, _unb64, _cat, _rnd, _scalar, _event, _reqScalar, _reqTagPub, _reqAesKey };
