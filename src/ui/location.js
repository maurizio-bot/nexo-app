/**
 * NEXO — Enviar la ubicación (sacado de main.js en la ronda 2752, sin cambios en su código): GPS con reintento por
 * red, avisos claros y envío. _sendAttachment lo da main.js con locationUse().
 */
import { _closeAttachMenu, _getAttachmentPlugins, _hideInfoToast, _showInfoToast, _showPermissionError } from './ui_bits.js';
import { t } from './i18n.js';
import { _getCurrentContactId } from './chat_format.js';
import { locationMap, LOC_MAP_WAIT_MS } from './location_map.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _sendAttachment;
export function locationUse(d) { _sendAttachment = d._sendAttachment; } // [/pegamento]


export var _lastLocationSent = 0;

export var _LOCATION_DEBOUNCE_MS = 3000;

export var _isGettingLocation = false;

// v9.9.43: ubicación. Antes, sin señal de GPS (interior) no se veía nada durante ~35 s y luego tampoco
// (el error se callaba). Ahora: aviso mientras se busca; GPS hasta 12 s; si no responde, la última posición
// conocida o la de la red; si nada, aviso claro. Líneas [ATTACH] Ubicación… en el diagnóstico.
export async function _handleLocation() {
  if (_isGettingLocation) return;
  _isGettingLocation = true;
  _closeAttachMenu();
  var G = _getAttachmentPlugins().Geolocation;
  var t0 = Date.now();
  var why = '';
  var pos = null;
  _showInfoToast(t('media_getting_location', '📍 Obteniendo tu ubicación…'), 30000);
  try {
    if (G && typeof G.getCurrentPosition === 'function') {
      try {
        if (typeof G.checkPermissions === 'function' && typeof G.requestPermissions === 'function') {
          var perm = await G.checkPermissions();
          if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
            var req = await G.requestPermissions();
            if (req.location !== 'granted' && req.coarseLocation !== 'granted') why = 'permiso denegado';
          }
        }
        if (!why) {
          pos = await G.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 })
            .catch(function(e) { why = (e && e.message) || 'error'; return null; });
          if (!pos && !/denied|permission|not enabled|disabled/i.test(why)) {
            console.log('[ATTACH] Ubicación: el GPS no respondió (' + why + '), probando la última conocida o por red');
            pos = await G.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 })
              .catch(function(e) { why = (e && e.message) || why; return null; });
          }
        }
      } catch (e) { why = (e && e.message) || 'error'; }
    } else {
      pos = await _browserPosition().catch(function(e) { why = (e && e.message) || 'sin API de ubicación'; return null; });
    }
    if (pos && pos.coords) {
      _hideInfoToast();
      console.log('[ATTACH] Ubicación obtenida en ' + Math.round((Date.now() - t0) / 100) / 10 + ' s (precisión ' + Math.round(pos.coords.accuracy || 0) + ' m)');
      await _sendLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); // 3201: con su mapa (≤ 4 s) o sin él
      return;
    }
    console.warn('[ATTACH] Ubicación no disponible tras ' + Math.round((Date.now() - t0) / 100) / 10 + ' s: ' + why);
    if (/permiso|denied|permission/i.test(why)) _showPermissionError('ubicación');
    else if (/not enabled|disabled|services/i.test(why)) _showInfoToast(t('media_enable_gps', 'Activa la ubicación (GPS) del teléfono y vuelve a intentarlo.'), 5000);
    else _showInfoToast(t('media_location_fail', 'No se pudo obtener tu ubicación (sin señal de GPS). Prueba cerca de una ventana o al aire libre.'), 6000);
  } finally {
    _isGettingLocation = false;
  }
}

// 3201 (dueño 17-11: miniatura del mapa al mandar la ubicación; eligió la opción A): antes de mandarla se arma UNA vez la miniatura
// del mapa (location_map.js: 2–4 teselas de OpenStreetMap, pin y crédito) y va DENTRO del mensaje cifrado (meta.map); quien la
// recibe no pide nada a nadie. Sin internet sale al momento sin mapa; si el mapa no está en LOC_MAP_WAIT_MS, también sin él. Va al
// chat donde se tocó «Ubicación» aunque mientras tanto se abra otro. Si tarda, un aviso «Preparando el mapa…».
export function _sendLocation(lat, lng, accuracy) {
  var now = Date.now();
  if (now - _lastLocationSent < _LOCATION_DEBOUNCE_MS) {
    console.log('[ATTACH:LOCATION] Ignorado por debounce');
    return Promise.resolve();
  }
  _lastLocationSent = now;
  var cid = _getCurrentContactId();
  var meta = { lat: lat, lng: lng, accuracy: accuracy || 0 };
  var payload = JSON.stringify(meta);
  var toast = false;
  var slow = setTimeout(function() { toast = true; _showInfoToast(t('media_location_map', '📍 Preparando el mapa…'), LOC_MAP_WAIT_MS + 1000); }, 700);
  return locationMap(lat, lng, accuracy, LOC_MAP_WAIT_MS).then(function(map) {
    clearTimeout(slow);
    if (toast) _hideInfoToast();
    if (map) meta.map = map;
    _sendAttachment('location', payload, meta, cid ? { contactId: cid } : undefined);
    console.log('[ATTACH] Ubicacion enviada' + (map ? ' con mapa' : ' sin mapa'));
  });
}

// Sin el plugin: la API del navegador
export function _browserPosition() {
  return new Promise(function(resolve, reject) {
    if (!navigator.geolocation) { reject(new Error('sin API de ubicación')); return; }
    navigator.geolocation.getCurrentPosition(resolve, function(err) {
      reject(new Error(err && err.code === 1 ? 'permission denied' : ((err && err.message) || 'error')));
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });
}
