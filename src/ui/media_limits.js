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

// Ronda 2780 (pedido del dueño): por internet (Tor directo o buzón de los relés) las fotos y archivos medianos SIEMPRE
// se pueden mandar, aunque el otro no esté cerca ni en Wi-Fi. Tope ~8 MB base64 (~6 MB de archivo): por encima iría muy
// lento por los relés (los archivos muy grandes son la fase 2, por Tor). El vídeo HD ya manda la previa.
export var NET_MAX_B64_BYTES = 8000000;

export function _maxB64For(contactId) {
  if (_wdReach(contactId)) return WD_MAX_B64_BYTES;   // Wi-Fi local / Wi-Fi Direct: ~22 MB
  // internet (Tor/relés) para fotos y archivos medianos SOLO si no hay camino local de archivos grandes (L2CAP): lo local
  // va antes (regla del dueño) y un archivo grande cerca debe salir por L2CAP, no en trozos por el sobre
  if (_netReach(contactId) && !_bigLocalRoute(contactId)) return NET_MAX_B64_BYTES;
  return MAX_BLE_B64_BYTES;                            // solo Bluetooth: ~2,2 MB
}

export function _tooBigMessage(bytes, contactId) {
  if (_wdReach(contactId)) return 'Archivo demasiado grande (' + (bytes / 1048576).toFixed(1) + ' MB). Máximo ~' + (WD_MAX_B64_BYTES * 3 / 4 / 1048576).toFixed(0) + ' MB.';
  if (_netReach(contactId)) return 'Archivo demasiado grande para internet (' + (bytes / 1048576).toFixed(1) + ' MB). Por internet hasta ~' + (NET_MAX_B64_BYTES * 3 / 4 / 1048576).toFixed(0) + ' MB; los más grandes, con el contacto en el mismo Wi-Fi, con Wi-Fi Direct o cerca por Bluetooth.';
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
