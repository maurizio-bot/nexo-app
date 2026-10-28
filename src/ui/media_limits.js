/**
 * NEXO — Límites de tamaño y URLs de vídeos/imágenes en pantalla (sacado de main.js en la ronda 2752, sin cambios):
 * máximo por Bluetooth y por Wi-Fi Direct, aviso de "demasiado grande" y liberar las URL al salir del chat.
 */
import { _wdReach, _netReach, _bigLocalRoute } from './ui_bits.js';


export var _objectURLRegistry = [];

/** Tope base64 para BLE (aprox. \~250KB binario). Fotos comprimidas suelen quedar bajo esto. */
// v9.9.26: ~3 MB en base64 (~2,2 MB de archivo). A la velocidad real de BLE (unos KB/s) 8 MB eran
// más de 20 minutos y bloqueaban la app; por encima de esto no se envía.
export var MAX_BLE_B64_BYTES = 3000000;

export var MAX_BLE_FILE_BYTES = Math.floor(MAX_BLE_B64_BYTES * 3 / 4);

// v9.9.39: con Wi-Fi Direct (contacto a alcance que también lo tiene) el límite sube a ~22 MB
export var WD_MAX_B64_BYTES = 30000000;

// Ronda 2780: por internet (Tor directo o buzón de los relés) las fotos y archivos SIEMPRE se pueden mandar, aunque el
// otro no esté cerca ni en Wi-Fi. 28-10 (pedido del dueño: «archivos grandes por internet; Tor y si no, relés; todos los
// tamaños»): el tope por internet sube de ~6 MB a ~22 MB (igual que Wi-Fi Direct), tanto por Tor como por el buzón de los
// relés. El archivo ya se parte en trozos (como hasta ahora con ~6 MB) y CADA trozo prueba primero Tor (sin relés, sin
// carga) y, si no hay Tor con ese contacto, cae a los relés (más eventos; aceptable para envíos puntuales). Por encima de
// ~22 MB hace falta Wi-Fi/Wi-Fi Direct con el otro cerca (o la Fase B: archivos muy grandes por Tor directo). El vídeo HD
// ya manda la previa.
export var NET_MAX_B64_BYTES = 30000000;

// Ronda 2786 (pedido del dueño: "que permita el envío de archivos grandes cuando hay internet"): con Tor DIRECTO (una
// conexión .onion entre los dos teléfonos, sin relés) no hay tope de 64 KB por evento, así que por ahí los archivos
// grandes también salen por internet, como por Wi-Fi Direct. Mismo tope que Wi-Fi Direct (~22 MB) para no cargar en
// memoria más de lo ya probado. Por los relés (sin Tor) se mantiene el tope de medianos.
export var NET_TOR_MAX_B64_BYTES = WD_MAX_B64_BYTES;

// ¿hay una conexión Tor DIRECTA con el contacto ahora mismo? (net.via() === 'tor'; p.torOk en net_link.js). Si la hay,
// un archivo grande puede ir por internet por ese canal P2P (sin el límite por evento de los relés públicos).
export function _torDirect(contactId) {
  var bi = window.bleInterface;
  if (!bi || !contactId || !bi.net || typeof bi.net.via !== 'function') return false;
  try { return bi.net.via(contactId) === 'tor'; } catch (e) { return false; }
}

export function _maxB64For(contactId) {
  if (_wdReach(contactId)) return WD_MAX_B64_BYTES;   // Wi-Fi local / Wi-Fi Direct: ~22 MB
  // internet para fotos y archivos SOLO si no hay camino local de archivos grandes (L2CAP): lo local va antes (regla del
  // dueño) y un archivo grande cerca debe salir por L2CAP, no en trozos por el sobre. Por Tor directo, hasta ~22 MB;
  // por los relés, medianos (~6 MB).
  if (_netReach(contactId) && !_bigLocalRoute(contactId)) return _torDirect(contactId) ? NET_TOR_MAX_B64_BYTES : NET_MAX_B64_BYTES;
  return MAX_BLE_B64_BYTES;                            // solo Bluetooth: ~2,2 MB
}

export function _tooBigMessage(bytes, contactId) {
  if (_wdReach(contactId)) return 'Archivo demasiado grande (' + (bytes / 1048576).toFixed(1) + ' MB). Máximo ~' + (WD_MAX_B64_BYTES * 3 / 4 / 1048576).toFixed(0) + ' MB.';
  if (_netReach(contactId)) {
    return 'Archivo demasiado grande para internet (' + (bytes / 1048576).toFixed(1) + ' MB). Por internet van hasta ~' + (NET_MAX_B64_BYTES * 3 / 4 / 1048576).toFixed(0) + ' MB; para archivos más grandes, por Wi-Fi o Wi-Fi Direct con el otro cerca.';
  }
  var bi = window.bleInterface;
  var hint = (bi && bi.wifiDirect && bi.wifiDirect.supported()) ? ' Con Wi-Fi Direct (los dos con NEXO actualizado y cerca) se pueden enviar hasta ~22 MB.' : '';
  return 'Archivo demasiado grande para Bluetooth (' + (bytes / 1048576).toFixed(1) + ' MB). Máximo ~' + (MAX_BLE_FILE_BYTES / 1048576).toFixed(1) + ' MB.' + hint;
}

export function _cleanupObjectURLs() {
  try {
    _objectURLRegistry.forEach(function(url) {
      try { URL.revokeObjectURL(url); } catch (e) {}
    });
    _objectURLRegistry = [];
    console.log('[MAIN] ObjectURLs limpiados');
  } catch (e) {
    console.warn('[MAIN] _cleanupObjectURLs error:', e);
  }
}
