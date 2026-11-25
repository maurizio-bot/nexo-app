/**
 * wifi_direct.js v1.2 — Fotos, vídeos y archivos por Wi-Fi Direct con un contacto a alcance.
 * v1.3: entregado en cuanto el receptor confirma por el propio socket (tiene todos los bytes): antes se esperaba
 *       además 'wf' por Bluetooth y, si tardaba >45 s, se daba por fallido y el vídeo se volvía a mandar como
 *       previa + HD por Bluetooth aunque ya hubiera llegado. Tiempos por fase en el diagnóstico.
 * v1.2: si falla con un contacto, no se vuelve a intentar con él durante FAIL_COOLDOWN_MS (todo va por
 *       Bluetooth); sin permiso en este teléfono deja de anunciarse y de usarse; esperas acotadas (permiso
 *       y envío). Hasta la 2712 el permiso de Android 13+ no estaba declarado y nunca se concedía.
 *
 * Bluetooth es el canal de control; Wi-Fi Direct solo lleva el contenido (ya cifrado de extremo a extremo):
 *   A → B  'wq' { id, size, meta }        ¿recibes por Wi-Fi Direct?
 *   B      crea un grupo (nombre y contraseña aleatorios, nuevos en cada envío) y abre un socket
 *   B → A  'wa' { id, c: E1(credenciales) } (cifradas para A) — o 'wn' si no puede
 *   A      se une al grupo y manda el contenido; B confirma por el socket, lo entrega a la app y
 *   B → A  'wf' { id }                     entregado (✓✓)
 * Si algo falla, el archivo sigue por Bluetooth como siempre. Solo con teléfonos que anuncian que lo
 * tienen (kx con wd:1, Android 10+) y para contenidos de más de WD_MIN_BYTES (para poco no compensa
 * montar el grupo). Una transferencia a la vez.
 * v1.4 (ronda 2756): archivos grandes (big_file.js): 'wq' con big:1; el receptor abre el socket con un token (va en
 *       las credenciales cifradas) y lo recibido va a disco (BigFile.kt), no a la app; el emisor manda desde el disco.
 */
import { e2eEncryptText, e2eDecryptText, e2eMyPublicKey } from '../vault/e2e_crypto.js';
import { e2eAnyEncrypted } from '../vault/e2e_proto.js';
import { t } from './i18n.js';
import { _showToast } from './ble_helpers.js';
import { readPower, powerNow } from './call_power.js'; // 3258: batería y temperatura al empezar/terminar cada transferencia

// 3023 (dueño 12-11: «quiero que entre en automático si hay Bluetooth y el Wi-Fi de los dos activo»): desde ~100 KB en base64
// (~75 KB de archivo). Medido en sus teléfonos el 12-11: por Bluetooth binario (MTU 517) una foto de 143 K letras tardó 8 s;
// montar el grupo cuesta ~5 s: por encima de esto Wi-Fi Direct ya gana. Sin tope arriba: lo de más de ~22 MB va como «archivo
// grande» (big_file.js, de disco a disco) también por Wi-Fi Direct, hasta 1 GB.
export var WD_MIN_BYTES = 100000;
export var WD_MAX_BYTES = 30000000;  // contenido cifrado en base64 (~22 MB de archivo)
// Paso 2/3 de la política de caminos (dueño 04-11): si el grupo WD ya está PREPARADO (caliente), el montaje ya se pagó →
// umbral más bajo (WD vale la pena para archivos medianos). TTL del «preparado» sin uso (se suelta por ociosidad).
export var WD_MIN_BYTES_READY = 20000;
// 3261 (diseño del dueño 20-11): Wi-Fi Direct NO tiene preferencia sobre internet; entra si llega ANTES. Tiempos estimados:
// internet = tamaño / velocidad medida de este momento (sin medida: 30 KB/s, lo que dan los relés); Wi-Fi Direct ≈ 4 s de montar el
// grupo + tamaño a 5 MB/s. Se cambia solo si gana claro (1,5 veces más rápido y al menos 3 s menos): un cambio de camino por nada no.
export var WD_SETUP_S = 4, WD_KBPS = 5000, NET_KBPS_PRIOR = 30;
export function wdPlan(bytes, netKbps) {
  var kb = bytes / 1024;
  var tNet = kb / Math.max(0.1, netKbps > 0 ? netKbps : NET_KBPS_PRIOR), tWd = WD_SETUP_S + kb / WD_KBPS;
  return { use: tWd * 1.5 < tNet && tNet - tWd >= 3, tNet: Math.round(tNet * 10) / 10, tWd: Math.round(tWd * 10) / 10 };
}
var WD_READY_TTL_MS = 45000;
var OFFER_TIMEOUT_MS = 25000;
export var WD_ACK_WAIT_MS = 20000;   // T-E1: quien recibe tiene el socket abierto hasta esto esperando a descifrarlo (nativo: WD_ACK_WAIT_MS)
var PERM_TIMEOUT_MS = 60000;
var FAIL_COOLDOWN_MS = 10 * 60000;
// 3013 (dueño 11-11: «primero es Wi-Fi Direct… no veo que funcione»; diagnósticos 08 y 10-11: «No se pudo crear el grupo (2)»):
// - el estado (¿Wi-Fi encendido?) se vuelve a leer antes de cada intento: con el Wi-Fi APAGADO Android contesta «ocupado» y
//   Wi-Fi Direct no puede funcionar; ahora se dice claro (aviso al usuario) y NO cuenta como fallo (no hay 10 min de castigo);
// - si falla el MONTAJE del grupo (el nativo ya reintentó ~5 s), se vuelve a probar a los 2 min, no a los 10.
var STATUS_FRESH_MS = 4000;
var GROUP_FAIL_COOLDOWN_MS = 2 * 60000;
var WIFI_OFF_NOTE_MS = 60000;
var WIFI_OFF_NOTE_BIG_MS = 600000;
var WIFI_OFF_RE = /wi-?fi apagado/i;
var GROUP_FAIL_RE = /crear el grupo|no se pudo conectar|grupo no se form/i;
// P8 (dueño 01-11): al ver el 1er contacto cercano con Wi-Fi Direct, pedir el permiso un poco después (no justo al
// conectar, para no chocar con la interfaz de conexión) y UNA sola vez por sesión, para que esté listo antes de la 1ª
// transferencia grande. Antes solo se pedía al intentar una transferencia; si el usuario estaba lejos entonces, se perdía.
var PERM_PROACTIVE_DELAY_MS = 2500;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _mac(m) { return (m || '').toString().toLowerCase().replace(/[:-]/g, '').trim(); }
// 3258: medidas del día (usage_stats.js) — solo números; nunca rompen el envío
function _noteWd(ev, o) { try { if (typeof window !== 'undefined' && typeof window.NEXO_noteWd === 'function') window.NEXO_noteWd(ev, o); } catch (e) {} }
function _noteConn(ms) { try { if (typeof window !== 'undefined' && typeof window.NEXO_noteConnect === 'function' && ms >= 0) window.NEXO_noteConnect('wifi-direct', ms); } catch (e) {} }
// 3258: batería y temperatura del teléfono durante una transferencia por Wi-Fi Direct (las dos puntas: quien envía y quien recibe).
// p0 = muestra al empezar (readPower); al terminar se lee otra y sale una línea. Menos de 5 s no dice nada (un punto de batería no se mide en eso).
function _wdPowerStart() { var box = { p0: null, t0: Date.now() }; try { readPower().then(function(x) { box.p0 = x; }).catch(function() {}); } catch (e) {} return box; }
function _wdPowerEnd(box, tag, ok) {
  try {
    if (!box || Date.now() - box.t0 < 5000) return;
    readPower().then(function(p1) {
      var secs = Math.round((Date.now() - box.t0) / 1000);
      console.log('[WIFI-DIRECT] ' + tag + (ok ? '' : ' (falló)') + ' en ' + secs + ' s: ' + powerNow(box.p0) + ' → ' + powerNow(p1)); // i18n-ok: texto para el desarrollador
    }).catch(function() {});
  } catch (e) {}
}
// Códigos de WifiP2pManager.ActionListener.onFailure que el nativo devuelve al montar el grupo
var GROUP_CODES = { 0: 'interno', 1: 'no soporta', 2: 'ocupado' }; // cortos: las medidas del día guardan la causa en 40 letras // i18n-ok: texto para el desarrollador
// 3272 (COLA 4): qué decirle al usuario según la causa (texto verdadero y qué puede hacer). Una vez por minuto por causa y lado.
var AVISO_MS = 60000;
var BT_MAX_CHARS = 3100000;   // tope de un archivo por Bluetooth (BLE_FILE_MAX_CHARS de ble_ack_shared.js): más grande no cabe y espera
function _avisoText(kind, peer, grande) {
  var head = '';
  if (kind === 'perm') head = peer
    ? t('wd_aviso_perm_peer', 'Al otro teléfono le falta el permiso «Dispositivos cercanos» de NEXO.')
    : t('wd_aviso_perm_me', 'Falta el permiso «Dispositivos cercanos» de NEXO (Ajustes → Apps → NEXO → Permisos).');
  else if (kind === 'nosoporta') head = peer
    ? t('wd_aviso_nosoporta_peer', 'El otro teléfono no admite Wi-Fi Direct.')
    : t('wd_aviso_nosoporta_me', 'Este teléfono no admite Wi-Fi Direct.');
  else if (kind === 'grupo') head = peer
    ? t('wd_aviso_grupo_peer', 'El otro teléfono no pudo montar Wi-Fi Direct (Android lo tenía ocupado).')
    : t('wd_aviso_grupo_me', 'Android no pudo montar Wi-Fi Direct (lo tenía ocupado). Si se repite, apaga y enciende el Wi-Fi.');
  else if (kind === 'union') head = t('wd_aviso_union', 'No se pudo unir al grupo de Wi-Fi Direct del otro teléfono. Acerquen los teléfonos.');
  else if (kind === 'corte') head = t('wd_aviso_corte', 'Se cortó Wi-Fi Direct a mitad del envío (¿se alejaron?). Acerquen los teléfonos para ir rápido.');
  if (!head) return '';
  // lo que pasa con el archivo: lo chico sigue por Bluetooth; lo que no cabe en Bluetooth queda pendiente (no se pierde)
  return head + ' ' + (grande
    ? t('wd_aviso_cola_pend', 'Este archivo no cabe en Bluetooth: queda pendiente hasta que haya Wi-Fi Direct o el mismo Wi-Fi.')
    : t('wd_aviso_cola_bt', 'Mientras, los archivos van por Bluetooth (más lento).'));
}
// ¿Qué aviso merece este error? ('' = ninguno: cosas pasajeras como «ocupado con otra transferencia» o «sin respuesta»)
function _avisoKind(e) {
  var code = e && e.code, m = String((e && e.message) || e || '');
  if (code === 'WD_WIFI_OFF' || (e && e.wifiOff) || WIFI_OFF_RE.test(m)) return '';   // el del Wi-Fi apagado ya lo da _wifiOffNote
  if (/sin permiso/i.test(m)) return 'perm';
  var gc = /crear el grupo \((\d+)/i.exec(m);
  if (gc) return gc[1] === '1' ? 'nosoporta' : 'grupo';
  if (/el otro no puede \(no soportado/i.test(m)) return 'nosoporta';
  if (code === 'WD_CONNECT' || /no se pudo conectar|grupo no se form/i.test(m) || code === 'WD_TIMEOUT') return 'union'; // i18n-ok: código interno
  if (code === 'WD_SEND' || /envío fallido|envío sin terminar/i.test(m)) return 'corte';
  return '';
}
function _wdCause(e) {
  var code = e && e.code, m = String((e && e.message) || e || '');
  if (code === 'WD_GROUP' || /crear el grupo/i.test(m)) { // 3272: con el código de Android (0 error interno, 1 no soportado, 2 ocupado) para saber CUÁL fue
    var gc = /crear el grupo \((\d+)/i.exec(m);
    return 'no se pudo crear el grupo' + (gc ? ' (' + gc[1] + (GROUP_CODES[gc[1]] ? ' ' + GROUP_CODES[gc[1]] : '') + ')' : ''); // i18n-ok: texto para el desarrollador
  }
  if (code === 'WD_CONNECT' || /no se pudo conectar/i.test(m)) return 'no se pudo conectar al grupo'; // i18n-ok: texto para el desarrollador
  if (code === 'WD_TIMEOUT' || /grupo no se form/i.test(m)) return 'el grupo no se formó (20 s)'; // i18n-ok: texto para el desarrollador
  if (code === 'WD_SEND' || /envío fallido/i.test(m)) return 'envío cortado';
  if (code === 'WD_WIFI_OFF' || (e && e.wifiOff) || WIFI_OFF_RE.test(m)) return 'Wi-Fi apagado';
  if (code === 'WD_UNAVAILABLE' || /no disponible/i.test(m)) return 'no disponible';
  if (code === 'WD_SOCKET') return 'socket';
  if (/sin permiso/i.test(m)) return 'sin permiso';
  if (/sin respuesta/i.test(m)) return 'el otro no respondió (25 s)'; // i18n-ok: texto para el desarrollador
  if (/el otro no puede \(ocupado/i.test(m)) return 'el otro estaba ocupado';
  if (/el otro no puede/i.test(m)) return 'el otro no puede'; // i18n-ok: texto para el desarrollador
  if (/envío sin terminar/i.test(m)) return 'envío sin terminar';
  if (/accept timed out/i.test(m)) return 'el otro no llegó a conectar (90 s)'; // i18n-ok: texto para el desarrollador
  return 'otro';
}
function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

export class WifiDirect {
  constructor(ble) {
    this.ble = ble;
    this.status = null;          // { supported, granted, wifiOn }
    this.peers = new Set();      // nexoIds que anunciaron wd:1
    this.out = new Map();        // id → { onCreds, onDone, reject }
    this.incoming = new Map();   // id → { meta, deviceId, from, ts }
    this.busy = false;
    this.denied = false;         // el permiso se pidió y no se concedió
    this.failUntil = {};         // nexoId → hasta cuándo no se intenta (falló)
    this._asked = false;
    this._listener = null;
    this.wdReady = new Map();    // paso 2: nexoId → hasta cuándo el grupo WD está «preparado» (lo marca el nativo; hoy vacío)
  }

  init() {
    var self = this, pl = _plugin();
    if (!pl || typeof pl.wifiDirectStatus !== 'function') return Promise.resolve(null);
    if (!self._listener && typeof pl.addListener === 'function') {
      self._listener = pl.addListener('onWifiDirectReceived', function(ev) { self._onReceived(ev); });
    }
    return pl.wifiDirectStatus().then(function(st) {
      self.status = st || null;
      if (st && st.granted) self.denied = false;
      if (st && st.supported) console.log('[WIFI-DIRECT] Disponible' + (st.granted ? '' : ' (falta permiso)') + (st.wifiOn ? '' : ', Wi-Fi apagado'));
      return st;
    }).catch(function() { return null; });
  }

  supported() { return !!(this.status && this.status.supported) && !this.denied; }
  // Falló con este contacto: un rato todo por Bluetooth (no se deja nada esperando a Wi-Fi Direct)
  noteFail(nexoId, why) {
    var nx = _nid(nexoId);
    if (!nx) return;
    var ms = GROUP_FAIL_RE.test(String(why || '')) ? GROUP_FAIL_COOLDOWN_MS : FAIL_COOLDOWN_MS;
    this.failUntil[nx] = Date.now() + ms;
    this._dropWdReady(nx);       // si falló, el «preparado» ya no vale
    console.warn('[WIFI-DIRECT] Con ' + nx + ' no funcionó: por Bluetooth durante ' + Math.round(ms / 60000) + ' min');
  }
  // 3013: estado al día antes de cada intento (¿sigue el Wi-Fi encendido? ¿se concedió el permiso?)
  _refreshStatus() {
    var self = this, pl = _plugin();
    if (!pl || typeof pl.wifiDirectStatus !== 'function') return Promise.resolve(self.status);
    if (self._statusAt && Date.now() - self._statusAt < STATUS_FRESH_MS) return Promise.resolve(self.status);
    return pl.wifiDirectStatus().then(function(st) {
      if (!st) return self.status;
      var was = self.status ? self.status.wifiOn : undefined;
      self.status = Object.assign({}, self.status || {}, st);
      self._statusAt = Date.now();
      if (st.granted) self.denied = false;
      if (was !== undefined && was !== st.wifiOn) console.log('[WIFI-DIRECT] Wi-Fi ' + (st.wifiOn ? 'encendido: Wi-Fi Direct disponible otra vez' : 'apagado'));
      return self.status;
    }).catch(function() { return self.status; });
  }
  // 3013: Wi-Fi apagado (aquí o en el otro teléfono): al registro siempre; aviso al usuario como mucho una vez por minuto
  // 24-11 (dueño, 3b): con un archivo grande el aviso es otro (no va por Bluetooth: espera y se manda solo al encender el Wi-Fi) y
  // se repite poco (el archivo reintenta solo cada ~15 s)
  _wifiOffNote(peerSide, big) {
    console.warn('[WIFI-DIRECT] Wi-Fi APAGADO en ' + (peerSide ? 'el otro teléfono' : 'este teléfono') + ': va por Bluetooth (Wi-Fi Direct necesita el Wi-Fi encendido, aunque no haya red)');
    var now = Date.now(), k = (peerSide ? 'peer' : 'me') + (big ? ':big' : '');
    this._offNoteAt = this._offNoteAt || {};
    if (now - (this._offNoteAt[k] || 0) < (big ? WIFI_OFF_NOTE_BIG_MS : WIFI_OFF_NOTE_MS)) return;
    this._offNoteAt[k] = now;
    try { if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('nexo:wd:wifiOff', { detail: { peer: !!peerSide, big: !!big } })); } catch (e) {}
  }
  // 3272: aviso al usuario de por qué este archivo va por Bluetooth (peer = la causa está en el OTRO teléfono)
  _aviso(kind, peer, grande) {
    var txt = _avisoText(kind, peer, grande);
    if (!txt) return;
    console.warn('[WIFI-DIRECT] Aviso al usuario (' + kind + (peer ? ', el otro' : ', este') + '): ' + txt); // i18n-ok: registro
    var now = Date.now(), k = kind + (peer ? ':peer' : ':me');
    this._avisoAt = this._avisoAt || {};
    if (now - (this._avisoAt[k] || 0) < AVISO_MS) return;
    this._avisoAt[k] = now;
    try { _showToast(txt, 'warn'); } catch (e) {}
  }
  _avisoErr(e, mine, size) {  // mine = el error lo vimos nosotros (si viene de «el otro no puede (…)», la causa es del otro teléfono)
    var k = _avisoKind(e);
    if (!k) return;
    var peer = !mine || /el otro no puede/i.test(String((e && e.message) || ''));
    this._aviso(k, peer, size > BT_MAX_CHARS);
  }
  _cooling(nx) { return (this.failUntil[nx] || 0) > Date.now(); }
  unmarkPeer(nexoId) { var nx = _nid(nexoId); this._dropWdReady(nx); if (nx && this.peers.delete(nx)) console.log('[WIFI-DIRECT] ' + nx + ' ya no lo tiene disponible'); }
  markPeer(nexoId) { var nx = _nid(nexoId); if (nx && !this.peers.has(nx)) { this.peers.add(nx); console.log('[WIFI-DIRECT] ' + nx + ' también lo tiene'); this._maybeAskPerm(); } }
  // P8 (dueño 01-11): ¿pedir ahora el permiso de Wi-Fi Direct de forma proactiva? Sí si: este teléfono lo soporta, aún no
  // está concedido, no se denegó, y no se ha pedido ya (ni lazy ni proactivo) en esta sesión. (función pura, para la prueba)
  _shouldAskPermNow() {
    if (!this.supported() || this.denied || this._asked || this._permProactive) return false;
    if (this.status && this.status.granted) return false;
    return true;
  }
  // P8: lanza la petición del permiso una vez, con un pequeño retraso (no al conectar), para tenerlo listo antes de la 1ª
  // transferencia grande. El throttle real (self._asked) y el timeout están en _ensurePermission.
  _maybeAskPerm() {
    if (!this._shouldAskPermNow()) return;
    this._permProactive = true;
    var self = this;
    setTimeout(function() { self._ensurePermission().catch(function() {}); }, PERM_PROACTIVE_DELAY_MS);
  }

  _nexoOf(deviceId) { return _nid(this.ble && this.ble._macToNexoId && this.ble._macToNexoId.get(_mac(deviceId))); }
  // Auditoría 23-11 (T-E1): una respuesta ('wa'/'wn'/'wf') solo vale si llega por el MISMO enlace al que se ofreció (la misma
  // dirección o, si el Bluetooth la ve por el otro lado de la conexión, la del mismo NEXO). Antes valía desde cualquier enlace.
  _sameLink(a, b) {
    if (_mac(a) && _mac(a) === _mac(b)) return true;
    var na = this._nexoOf(a);
    return !!na && na === this._nexoOf(b);
  }
  // T-E1: el nativo tiene el socket abierto esperando esto: ok = ya se pudo leer (manda el byte de «recibido», la entrega de quien
  // envía); no = no se pudo (cierra sin confirmar: quien envía sigue por Bluetooth, no lo da por entregado)
  _nativeAck(id, ok) {
    var pl = _plugin();
    if (pl && typeof pl.wifiDirectCancel === 'function') { try { pl.wifiDirectCancel({ transferId: id, ack: ok ? 1 : 0 }).catch(function() {}); } catch (e) {} }
  }

  _directReady(deviceId) {
    var st = this.ble && typeof this.ble._getDeviceState === 'function' ? this.ble._getDeviceState(deviceId) : null;
    return !!(st && (st.state === 'ready_to_chat' || st.state === 'notifications_ready'));
  }

  // ¿Se puede usar con este contacto ahora? (los dos lo tienen y hay enlace Bluetooth directo)
  // 3260: ignoreCool = para un archivo GRANDE que no tiene otro camino, el castigo por un fallo reciente no debe cerrarle la puerta
  // (sin eso un solo fallo de Wi-Fi Direct dejaba el archivo de 150 MB «sin camino» durante 2–10 min en vez de volver a intentarlo)
  canReach(nexoId, ignoreCool) {
    var nx = _nid(nexoId);
    if (!this.supported() || !this.peers.has(nx) || (!ignoreCool && this._cooling(nx)) || !this.ble) return false;
    // 3013: con el Wi-Fi apagado no hay Wi-Fi Direct (el estado se refresca solo, sin esperar)
    if (!this._statusAt || Date.now() - this._statusAt > 15000) this._refreshStatus();
    if (this.status && this.status.wifiOn === false) return false;
    var dev = typeof this.ble._resolveDeviceIdForNexoId === 'function' ? this.ble._resolveDeviceIdForNexoId(nx) : null;
    return !!dev && this._directReady(dev);
  }

  // 3258: ¿por qué Wi-Fi Direct sí o no para este archivo? (para los contadores del día; pura, sin efectos)
  _whyNot(deviceId, bytes, big) {
    if (!this.status || !this.status.supported) return { no: 'este teléfono no lo tiene' }; // i18n-ok: texto para el desarrollador
    if (this.denied) return { no: 'sin permiso' };
    if (!big && bytes > WD_MAX_BYTES) return { no: 'demasiado grande (va como archivo grande)' };
    if (this.busy) return { no: 'ocupado con otra transferencia' };
    var nx = this._nexoOf(deviceId);
    if (!this.peers.has(nx)) return { no: 'el otro no lo anuncia' }; // i18n-ok: texto para el desarrollador
    if (this._cooling(nx)) return { no: 'castigo por un fallo reciente' }; // i18n-ok: texto para el desarrollador
    if (this.status.wifiOn === false) return { no: 'Wi-Fi apagado aquí' };
    if (!this._directReady(deviceId)) return { no: 'sin enlace Bluetooth directo' };
    if (big) return { use: 'archivo grande' }; // un archivo grande no depende del tamaño mínimo
    var mtu = (this.ble && typeof this.ble.getMtu === 'function') ? this.ble.getMtu(deviceId) : 0;
    var tiny = (typeof window !== 'undefined' && Number(window.NEXO_TINY_MTU)) || 50;
    var btLento = ((typeof window === 'undefined') || window.NEXO_WD_TINY !== false) && mtu > 0 && mtu <= tiny;
    if (bytes >= WD_MIN_BYTES) return { use: 'tamaño' };
    if (this._isWdReady(nx)) return bytes >= WD_MIN_BYTES_READY ? { use: 'grupo ya preparado' } : { no: 'archivo chico' };
    if (btLento) return bytes >= WD_MIN_BYTES_READY ? { use: 'Bluetooth lento (MTU 23)' } : { no: 'archivo chico' };
    return { no: 'archivo chico (<100 KB) con Bluetooth normal' };
  }
  // 3261: el contacto está en línea por internet (el camino elegido) Y cerca por Bluetooth (enlace directo listo): ¿este archivo llega
  // antes por Wi-Fi Direct? Devuelve { use, dev (el enlace Bluetooth por el que se arma), tNet, tWd } o null si Wi-Fi Direct no se puede.
  // Hallazgo que lo motiva (19-11): con el contacto en línea por internet un archivo nunca probaba Wi-Fi Direct (foto: 25 s; aquí ≈ 3 s).
  planFor(nexoId, bytes) {
    var nx = _nid(nexoId);
    if (!this.supported() || this.busy || !(bytes >= WD_MIN_BYTES) || bytes > WD_MAX_BYTES) return null;
    if (!this.peers.has(nx) || this._cooling(nx) || (this.status && this.status.wifiOn === false)) return null;
    var dev = (this.ble && typeof this.ble._bleReadyFor === 'function') ? this.ble._bleReadyFor(nx) : null;
    if (!dev || !this._directReady(dev)) return null;
    var kbps = null;
    try { kbps = (typeof window !== 'undefined' && typeof window.NEXO_recentSpeed === 'function') ? window.NEXO_recentSpeed('internet', 'out') : null; } catch (e) {}
    var p = wdPlan(bytes, kbps);
    p.dev = dev; p.netKbps = kbps;
    console.log('[WIFI-DIRECT] ' + nx + ' está en línea por internet y cerca por Bluetooth: ' + Math.round(bytes / 1024) + ' KB ≈ ' + p.tNet + ' s por internet (' +
      (kbps ? kbps + ' KB/s medidos' : 'sin medida: se suponen ' + NET_KBPS_PRIOR + ' KB/s') + ') y ≈ ' + p.tWd + ' s por Wi-Fi Direct → ' + (p.use ? 'Wi-Fi Direct' : 'internet')); // i18n-ok: registro
    _noteWd(p.use ? 'use' : 'no', { why: p.use ? 'más rápido que internet' : 'internet llega antes' }); // i18n-ok: texto para el desarrollador
    return p;
  }
  noteChoice(deviceId, bytes) {
    if (!(bytes >= WD_MIN_BYTES_READY)) return;
    var w = this._whyNot(deviceId, bytes);
    _noteWd(w.no ? 'no' : 'use', { why: w.no || w.use });
  }

  eligible(deviceId, bytes) {
    if (this.busy || !this.supported() || bytes > WD_MAX_BYTES) return false;
    var nx = this._nexoOf(deviceId);
    if (!(this.peers.has(nx) && !this._cooling(nx) && this._directReady(deviceId))) return false;
    // Umbral dinámico (política de caminos, dueño 04-11): WD vale la pena para archivos MEDIANOS (no solo ≥150 KB) cuando:
    //  - el grupo ya está PREPARADO/caliente (warm — paso NATIVO siguiente; hoy _isWdReady es false), O
    //  - el Bluetooth con este contacto quedó en MTU MÍNIMO (23, lentísimo): aunque montar el grupo cueste ~5 s, por BT 23
    //    un archivo mediano son MINUTOS; WD lo esquiva (diagnóstico del dueño 05-11). Si WD falla, `_sendFileBest` cae a
    //    Bluetooth igual (nunca se pierde). Interruptor NEXO_WD_TINY para apagarlo si en los teléfonos molesta.
    var mtu = (this.ble && typeof this.ble.getMtu === 'function') ? this.ble.getMtu(deviceId) : 0;
    var tiny = (typeof window !== 'undefined' && Number(window.NEXO_TINY_MTU)) || 50;
    var btLento = ((typeof window === 'undefined') || window.NEXO_WD_TINY !== false) && mtu > 0 && mtu <= tiny;
    var min = (this._isWdReady(nx) || btLento) ? WD_MIN_BYTES_READY : WD_MIN_BYTES;
    return bytes >= min;
  }

  // ----- Paso 2 (política de caminos): preparar WD por adelantado cuando hay Bluetooth, para que el 1er envío no pague el
  // montaje de ~5 s. El estado «preparado» lo marcará la parte NATIVA (mantener el grupo caliente) cuando exista; acá van
  // la LÓGICA (pura, para la prueba) y el estado, listos. Hasta que el nativo llame _setWdReady, nada cambia de conducta. -----
  _isWdReady(nx) { nx = _nid(nx); var u = this.wdReady.get(nx) || 0; if (u && u < Date.now()) { this.wdReady.delete(nx); return false; } return u > 0; }
  _setWdReady(nx, ttlMs) { nx = _nid(nx); if (nx) this.wdReady.set(nx, Date.now() + (ttlMs || WD_READY_TTL_MS)); }
  _dropWdReady(nx) { nx = _nid(nx); if (nx && this.wdReady) this.wdReady.delete(nx); }
  // ¿Conviene preparar WD con este contacto ahora? (pura, para la prueba) Reusa canReach (soportado + él lo tiene + no en
  // cooldown + enlace Bluetooth DIRECTO vivo); solo si no está ya preparado. NO prepara sin BT directo (no hay por dónde
  // armarlo y no debe tocar el Wi-Fi/internet normal).
  _shouldPrepareWD(nx) { return this.canReach(nx) && !this._isWdReady(_nid(nx)); }

  _ensurePermission() {
    var self = this, pl = _plugin();
    if (self.status && self.status.granted) return Promise.resolve(true);
    if (!pl || typeof pl.requestWifiDirectPermission !== 'function' || self._asked) return Promise.resolve(false);
    self._asked = true;
    var timer = null;
    return Promise.race([
      pl.requestWifiDirectPermission().then(function(r) { return !!(r && r.granted); }).catch(function() { return false; }),
      new Promise(function(res) { timer = setTimeout(function() { res(null); }, PERM_TIMEOUT_MS); })
    ]).then(function(ok) {
      clearTimeout(timer);
      if (ok === null) { self._asked = false; return false; } // sin respuesta: se puede volver a pedir
      if (self.status) self.status.granted = ok;
      if (!ok) { self.denied = true; console.warn('[WIFI-DIRECT] Permiso no concedido: todo por Bluetooth'); self._aviso('perm', false); }
      return ok;
    });
  }

  _ctl(deviceId, obj) {
    obj.v = 1;
    obj.from = _nid(this.ble.localNexoId);
    return this.ble._sendMessageNative(deviceId, JSON.stringify(obj), null);
  }

  // Envío: resuelve cuando el otro confirma que lo tiene; rechaza si hay que ir por Bluetooth
  // opts (puente a internet, parte 4: gw_link.js): { offerMs: espera corta a que el otro monte el grupo, gw: 1 (el
  // fallo lo lleva el puente: sin castigo de 10 min con un contacto), nx: con quién (puede no ser contacto) }
  send(deviceId, fileId, data, meta, opts) {
    var self = this, o = opts || {};
    var peer = o.nx || self._nexoOf(deviceId);
    self.busy = true;
    var hosted = false;
    var t0 = Date.now();
    var pw = _wdPowerStart();
    _noteWd('try', { dir: 'out' });
    return self._ensurePermission().then(function(ok) {
      if (!ok) throw new Error('sin permiso de Wi-Fi Direct');
      return self._refreshStatus();
    }).then(function(ws) {
      if (ws && ws.wifiOn === false) { var eOff = new Error('Wi-Fi apagado en este teléfono'); eOff.wifiOff = 'me'; throw eOff; }
      return new Promise(function(resolve, reject) {
        var st = { reject: reject, deviceId: deviceId };
        var offerTimer = setTimeout(function() { self.out.delete(fileId); reject(new Error('sin respuesta')); }, o.offerMs || OFFER_TIMEOUT_MS);
        st.onNo = function(why) { hosted = false; clearTimeout(offerTimer); self.out.delete(fileId); var eNo = new Error('el otro no puede (' + (why || '?') + ')'); if (WIFI_OFF_RE.test(String(why || ''))) eNo.wifiOff = 'peer'; reject(eNo); };
        st.onCreds = function(c) {
          clearTimeout(offerTimer);
          var tCreds = Date.now();
          st.onDone = function() {}; // 'wf' llega después; la entrega ya la confirmó el socket
          e2eDecryptText(c).then(function(r) {
            var cr = JSON.parse(r.text);
            console.log('[WIFI-DIRECT] Enviando ' + fileId + ' (' + Math.round(data.length / 1024) + ' KB) a ' + peer);
            // Tope: unirse al grupo (~20 s) + el contenido a 100 KB/s como mínimo + lo que el otro tarda en descifrarlo antes de
            // confirmar (T-E1, WD_ACK_WAIT_MS)
            var sendTimer = null;
            return Promise.race([
              _plugin().wifiDirectSend({ ssid: cr.s, passphrase: cr.p, port: cr.o, transferId: fileId, data: data, token: typeof cr.t === 'string' ? cr.t : '', jsTs: Date.now() }),
              new Promise(function(res, rej) { sendTimer = setTimeout(function() { rej(new Error('envío sin terminar')); }, 30000 + WD_ACK_WAIT_MS + Math.round(data.length / 100)); })
            ]).then(function(v) { clearTimeout(sendTimer); return v; }, function(e) { clearTimeout(sendTimer); throw e; });
          }).then(function(res) {
            var sec = function(ms) { return Math.round((ms || 0) / 100) / 10 + ' s'; };
            // Fases: oferta→credenciales (el otro crea el grupo), paso de datos a Android, unirse al grupo, envío
            console.log('[WIFI-DIRECT] ' + fileId + ' fases: grupo del otro ' + sec(tCreds - t0) + ', a Android ' + sec(res && res.bridgeMs) +
              ', unirse ' + sec(res && res.joinMs) + ', envío ' + sec(res && res.xferMs) + ' (' + Math.round((data.length / 1024) / Math.max(0.1, ((res && res.xferMs) || 1) / 1000)) + ' KB/s)');
            // 3258: tiempos del día (quien envía): unirse, velocidad pura, Wi-Fi normal, «conexión lista»
            if (res && res.joinMs >= 0) _noteWd('join', { ms: res.joinMs });
            if (res && res.xferMs > 0) _noteWd('xfer', { bytes: data.length, ms: res.xferMs });
            if (res && typeof res.apStart === 'number') _noteWd('ap', { before: res.apStart, after: res.apJoined });
            _noteConn((tCreds - t0) + ((res && res.joinMs) || 0));
            self.out.delete(fileId);
            resolve();
          }).catch(function(e) { self.out.delete(fileId); reject(e); });
        };
        self.out.set(fileId, st);
        var wire = Object.assign({}, meta);
        if (wire.xs) { delete wire.caption; delete wire.once; } // 4A (23-11): con el sello (xs), el comentario y «ver una vez» no van en claro en la oferta
        hosted = true;   // desde aquí el otro puede estar montando (o tener montado) el grupo para esto
        self._ctl(deviceId, { type: 'wq', id: fileId, size: data.length, meta: wire, pk: e2eMyPublicKey() }).catch(function(e) { hosted = false; clearTimeout(offerTimer); self.out.delete(fileId); reject(e); });
      });
    }).then(function() {
      self.busy = false;
      _noteWd('ok', { dir: 'out', act: Date.now() - t0 });
      _wdPowerEnd(pw, 'envío ' + fileId, true);
      console.log('[WIFI-DIRECT] ' + fileId + ' entregado en ' + Math.round((Date.now() - t0) / 100) / 10 + ' s');
      try { if (typeof window.NEXO_noteSpeed === 'function') window.NEXO_noteSpeed('wifi-direct', 'out', Math.round(String(data || '').length * 3 / 4), Date.now() - t0); } catch (e) {} // 3081
    }, function(e) {
      self.busy = false;
      if (hosted) self._cancelPeer(deviceId, fileId);
      _noteWd('fail', { dir: 'out', cause: _wdCause(e), act: Date.now() - t0 });
      _wdPowerEnd(pw, 'envío ' + fileId, false);
      console.warn('[WIFI-DIRECT] ' + fileId + ': ' + (e && e.message) + ' → por Bluetooth');
      // 3013: Wi-Fi apagado (aquí, o lo dijo el otro, o lo dijo Android al unirse) no es un fallo de Wi-Fi Direct: sin castigo
      if (e && (e.wifiOff || e.code === 'WD_WIFI_OFF')) self._wifiOffNote(e.wifiOff === 'peer');
      else { self._avisoErr(e, true, String(data || '').length); if (!o.gw) self.noteFail(peer, e && e.message); }
      throw e;
    });
  }

  // Archivo grande ya cifrado en disco (big_file.js): misma negociación; el contenido va de disco a disco
  sendBig(deviceId, fileId, size) {
    var self = this, peer = self._nexoOf(deviceId);
    if (self.busy) return Promise.reject(new Error('Wi-Fi Direct ocupado'));
    self.busy = true;
    var hosted = false;
    var t0 = Date.now();
    var pw = _wdPowerStart();
    _noteWd('try', { dir: 'out' });
    return self._ensurePermission().then(function(ok) {
      if (!ok) throw new Error('sin permiso de Wi-Fi Direct');
      return self._refreshStatus();
    }).then(function(ws) {
      if (ws && ws.wifiOn === false) { var eOff = new Error('Wi-Fi apagado en este teléfono'); eOff.wifiOff = 'me'; throw eOff; }
      return new Promise(function(resolve, reject) {
        var st = { deviceId: deviceId };
        var offerTimer = setTimeout(function() { self.out.delete(fileId); reject(new Error('sin respuesta')); }, OFFER_TIMEOUT_MS);
        st.onNo = function(why) { hosted = false; clearTimeout(offerTimer); self.out.delete(fileId); var eNo = new Error('el otro no puede (' + (why || '?') + ')'); if (WIFI_OFF_RE.test(String(why || ''))) eNo.wifiOff = 'peer'; reject(eNo); };
        st.onCreds = function(c) {
          clearTimeout(offerTimer);
          var tCreds = Date.now();
          st.onDone = function() {};
          e2eDecryptText(c).then(function(r) {
            var cr = JSON.parse(r.text);
            if (!cr.t) throw new Error('sin token');
            return _plugin().wifiDirectSend({ ssid: cr.s, passphrase: cr.p, port: cr.o, transferId: fileId, bigToken: cr.t, jsTs: Date.now() });
          }).then(function(res) {
            // 3258: lo mismo que en send(): unirse, velocidad pura, Wi-Fi normal, «conexión lista»
            if (res && res.joinMs >= 0) _noteWd('join', { ms: res.joinMs });
            if (res && res.xferMs > 0 && res.bytes > 0) _noteWd('xfer', { bytes: res.bytes, ms: res.xferMs });
            if (res && typeof res.apStart === 'number') _noteWd('ap', { before: res.apStart, after: res.apJoined });
            _noteConn((tCreds - t0) + ((res && res.joinMs) || 0));
            self.out.delete(fileId); resolve(res);
          }, function(e) { self.out.delete(fileId); reject(e); });
        };
        self.out.set(fileId, st);
        hosted = true;
        self._ctl(deviceId, { type: 'wq', id: fileId, size: size, big: 1, meta: {}, pk: e2eMyPublicKey() }).catch(function(e) { hosted = false; clearTimeout(offerTimer); self.out.delete(fileId); reject(e); });
      });
    }).then(function(r) { self.busy = false; _noteWd('ok', { dir: 'out', act: Date.now() - t0 }); _wdPowerEnd(pw, 'envío grande ' + fileId, true); return r; }, function(e) {
      self.busy = false;
      if (hosted) self._cancelPeer(deviceId, fileId);
      _noteWd('fail', { dir: 'out', cause: _wdCause(e), act: Date.now() - t0 });
      _wdPowerEnd(pw, 'envío grande ' + fileId, false);
      console.warn('[WIFI-DIRECT] Archivo grande ' + fileId + ': ' + (e && e.message));
      // Cortado a mitad (WD_SEND: se alejó, se apagó…): Wi-Fi Direct sí funciona con él; se puede reintentar ya
      // (3013: Wi-Fi apagado tampoco es un fallo de Wi-Fi Direct)
      if (e && (e.wifiOff || e.code === 'WD_WIFI_OFF')) self._wifiOffNote(e.wifiOff === 'peer', true);
      else { self._avisoErr(e, true, Infinity); if (!(e && e.code === 'WD_SEND')) self.noteFail(peer, e && e.message); }
      throw e;
    });
  }

  // Fin de un archivo grande recibido (lo avisa big_file.js): libera Wi-Fi Direct para otra transferencia
  // 3258: también anota cómo terminó un archivo grande recibido (ok o con su causa) y cuánto tardó de principio a fin
  bigFinished(id, ok, error) {
    var inc = this.incoming.get(id);
    if (!this.incoming.delete(id)) return;
    this.busy = false;
    if (inc) _wdPowerEnd(inc.pw, 'recepción grande ' + id, !(ok === false || error));
    if (ok === false || error) _noteWd('fail', { dir: 'in', cause: _wdCause({ message: error }), act: Date.now() - ((inc && inc.ts) || Date.now()) });
    else _noteWd('ok', { dir: 'in', act: Date.now() - ((inc && inc.ts) || Date.now()) });
  }

  // Paquetes de control (llegan por Bluetooth). true si era de Wi-Fi Direct.
  handle(p, deviceId) {
    var self = this;
    if (!p || !/^w[qanfx]$/.test(p.type || '')) return false;
    var id = String(p.id || '');
    if (!id) return true;
    var st = self.out.get(id);
    if (/^w[anf]$/.test(p.type) && st && !self._sameLink(st.deviceId, deviceId)) { console.warn('[WIFI-DIRECT] ' + id + ': respuesta por otro enlace: ignorada'); return true; }
    if (p.type === 'wa') { if (st && st.onCreds) st.onCreds(p.c); return true; }
    if (p.type === 'wn') { if (st && st.onNo) st.onNo(p.why); return true; }
    if (p.type === 'wf') { if (st && st.onDone) st.onDone(); return true; }
    if (p.type === 'wx') { self._onCancel(id, deviceId); return true; }
    // 'wq': nos ofrecen un archivo
    var from = _nid(p.from);
    var no = function(why) { self._ctl(deviceId, { type: 'wn', id: id, why: why }).catch(function() {}); };
    // 3258: un rechazo nuestro también cuenta como intento fallido de recibir (con su causa)
    var refuse = function(why) { _noteWd('try', { dir: 'in' }); _noteWd('fail', { dir: 'in', cause: 'rechazamos: ' + why }); no(why); };
    if (!self.supported()) { refuse('no soportado'); return true; }
    if (self.busy || self.incoming.size) { refuse('ocupado'); return true; }
    var big = p.big === 1 && self.ble.bigFiles;
    if (!(p.size > 0) || p.size > (big ? 1.1 * 1024 * 1024 * 1024 : WD_MAX_BYTES)) { refuse('tamaño'); return true; }
    // Clave para cifrar las credenciales: la guardada del contacto o, si aún no es contacto, la que trae la
    // oferta (las credenciales solo sirven para mandarnos datos, que igualmente deben venir cifrados)
    var ckey = self.ble.ackSystem && self.ble.ackSystem._peerKey(deviceId, from);
    var key = ckey || ((typeof p.pk === 'string' && /^[A-Za-z0-9+/=]{80,100}$/.test(p.pk)) ? p.pk : null);
    if (!key) { refuse('sin clave'); return true; }
    // Auditoría 23-11 (T-L1): montar el grupo (Wi-Fi normal a medias, batería, ocupado para otros) solo para un contacto con clave
    // guardada… o para el paquete del PUENTE a internet que esperamos de ese vecino (gw_link: sesión abierta con él por este enlace;
    // el puente no es contacto por naturaleza). Cualquier otro desconocido: «no» y su archivo llega igual en trozos por Bluetooth
    // (nada se pierde: solo no se le monta Wi-Fi Direct a quien no conocemos).
    var gwDir = p.meta && p.meta.gw, gwL = self.ble.net && self.ble.net.gw;
    if (!ckey && !((gwDir === 'u' || gwDir === 'd') && gwL && typeof gwL.wdExpect === 'function' && gwL.wdExpect(from, deviceId, gwDir))) { refuse('no es contacto'); return true; }
    // Auditoría 23-11 (T-D1): un archivo GRANDE (a disco, hasta 1,1 GB) solo de un contacto con clave guardada, nunca con la que trae la oferta
    if (big && !(from && typeof self.ble._contactKey === 'function' && self.ble._contactKey(from))) { refuse('no es contacto'); return true; }
    if (big && self.ble.bigFiles.saved && self.ble.bigFiles.saved[id] === 'got') { refuse('ya lo tengo'); return true; }
    self.busy = true;
    self._hosting = { id: id, deviceId: deviceId };   // por si llega su «cancelar» mientras se monta el grupo
    var tH = Date.now();
    var pwIn = _wdPowerStart();
    _noteWd('try', { dir: 'in' });
    // Token de la conexión (T-L1: también para lo no grande): va en las credenciales cifradas; el nativo solo acepta a quien lo traiga
    var bigToken = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    self._ensurePermission().then(function(ok) {
      if (!ok) throw new Error('sin permiso');  // (denied ya marcado: el próximo kx no lo anuncia)
      return self._refreshStatus();
    }).then(function(ws) {
      // 3013: con el Wi-Fi apagado no se puede montar el grupo (Android contesta «ocupado»): se dice claro al otro
      if (ws && ws.wifiOn === false) { var eOff = new Error('Wi-Fi apagado'); eOff.wifiOff = true; throw eOff; }
      var args = { transferId: id, size: p.size };
      if (big) args.bigToken = bigToken; else args.token = bigToken;
      return _plugin().wifiDirectHost(args);
    }).then(function(cr) {
      // 3258 (quien recibe monta el grupo): tiempo, reintentos del sistema y su código, y el Wi-Fi normal al empezar
      if (cr && cr.groupMs >= 0) _noteWd('group', { ms: cr.groupMs, attempts: cr.attempts, reasons: cr.reasons });
      self._hosting = null;
      // el otro ya se rindió mientras se montaba el grupo: se baja ya (no se le mandan las credenciales)
      if (self._cancelled && self._cancelled.delete(id)) { self._nativeCancel(id); var eC = new Error('cancelado por quien envía'); eC.cancelled = true; throw eC; }
      self.incoming.set(id, { meta: p.meta || {}, deviceId: deviceId, from: from, ts: Date.now(), big: !!big, pw: pwIn, apStart: cr && typeof cr.apStart === 'number' ? cr.apStart : null });
      // Un archivo grande puede tardar: el tope lo pone el propio socket (sin datos 60 s → error → bigFinished)
      if (big) self.ble.bigFiles._set(id, { dir: 'in', state: 'receiving', bytes: 0, total: p.size, nx: from });
      else setTimeout(function() { if (self.incoming.delete(id)) self.busy = false; }, 120000);
      var creds = { s: cr.ssid, p: cr.passphrase, o: cr.port, t: bigToken };
      return e2eEncryptText(key, JSON.stringify(creds));
    }).then(function(c) {
      return self._ctl(deviceId, { type: 'wa', id: id, c: c });
    }).catch(function(e) {
      self.busy = false;
      self._hosting = null;
      if (self._cancelled) self._cancelled.delete(id);
      self.incoming.delete(id);
      _noteWd('fail', { dir: 'in', cause: _wdCause(e), act: Date.now() - tH });
      _wdPowerEnd(pwIn, 'recepción ' + id, false);
      console.warn('[WIFI-DIRECT] No puedo recibir ' + id + ': ' + (e && e.message));
      if (e && e.cancelled) return;   // lo canceló el otro: ni aviso ni respuesta
      var off = !!(e && (e.wifiOff || e.code === 'WD_WIFI_OFF' || WIFI_OFF_RE.test(String(e.message || ''))));
      if (off) self._wifiOffNote(false); else self._avisoErr(e, true, p.size);
      no(off ? 'Wi-Fi apagado' : (e && e.message));
    });
    return true;
  }

  // 3287 (23-11, «cancelar»): quien ofreció un archivo y no pudo mandarlo (no logró unirse al grupo, se cortó, se cansó de esperar)
  // se lo dice al otro, que tenía el grupo montado esperándolo hasta 90 s (ocupado para cualquier otra transferencia, con el Wi-Fi
  // normal a medias y gastando batería). Con «wx» lo baja al momento.
  _cancelPeer(deviceId, id) {
    this._ctl(deviceId, { type: 'wx', id: id }).catch(function() {});
  }
  _nativeCancel(id) {
    var pl = _plugin();
    if (pl && typeof pl.wifiDirectCancel === 'function') { try { pl.wifiDirectCancel({ transferId: id }).catch(function() {}); } catch (e) {} }
  }
  // Llega «wx» de quien nos ofreció `id`: solo vale del mismo enlace por el que vino la oferta
  _onCancel(id, deviceId) {
    var inc = this.incoming.get(id);
    if (inc && inc.deviceId === deviceId) {
      console.log('[WIFI-DIRECT] ' + id + ': quien envía canceló (no pudo unirse o se cortó): bajo el grupo ya');
      this._nativeCancel(id);   // el nativo cierra y avisa (onWifiDirectReceived / onBigDone con error): ahí se libera todo
      return;
    }
    var h = this._hosting;
    if (h && h.id === id && h.deviceId === deviceId) { (this._cancelled = this._cancelled || new Set()).add(id); console.log('[WIFI-DIRECT] ' + id + ': quien envía canceló mientras se montaba el grupo'); }
  }

  _onReceived(ev) {
    var self = this;
    var id = ev && ev.transferId;
    var inc = id && self.incoming.get(id);
    self.incoming.delete(id);
    self.busy = false;
    if (!inc) return;
    // 3258: lo recibido por Wi-Fi Direct al día (tiempo de principio a fin, velocidad pura de lectura, Wi-Fi normal)
    if (ev.error || !ev.data) _noteWd('fail', { dir: 'in', cause: _wdCause({ message: ev.error }), act: Date.now() - inc.ts });
    else {
      _wdPowerEnd(inc.pw, 'recepción ' + id, true);
      _noteWd('ok', { dir: 'in', act: Date.now() - inc.ts });
      if (ev.readMs > 0) _noteWd('xfer', { bytes: ev.bytes || ev.data.length, ms: ev.readMs });
      if (inc.apStart !== null && inc.apStart !== undefined && typeof ev.apMhz === 'number') _noteWd('ap', { before: inc.apStart, after: ev.apMhz });
    }
    // Puente a internet (parte 4): un paquete de frames del relé (trozos del buzón ya cifrados para el contacto: aquí no
    // hay nada que abrir) → gw_link.js, que lo valida como si hubiera llegado por Bluetooth
    var gwDir = inc.meta && inc.meta.gw;
    if (gwDir === 'u' || gwDir === 'd') {
      var gw = self.ble && self.ble.net && self.ble.net.gw;
      if (ev.error || !ev.data || !gw) { console.warn('[WIFI-DIRECT] Paquete del puente ' + id + ' fallido: ' + (ev.error || 'vacío')); return; }
      console.log('[WIFI-DIRECT] Paquete del puente ' + id + ' (' + Math.round(ev.data.length / 1024) + ' KB)' + (ev.readMs ? ', lectura ' + Math.round(ev.readMs / 100) / 10 + ' s' : ''));
      var gwOk = gw.wdIn(inc.from, inc.deviceId, ev.data, gwDir) !== false;
      self._nativeAck(id, gwOk);
      if (gwOk) self._ctl(inc.deviceId, { type: 'wf', id: id }).catch(function() {});
      return;
    }
    if (ev.error || !ev.data || !e2eAnyEncrypted(ev.data)) {
      if (!ev.error) self._nativeAck(id, false);
      console.warn('[WIFI-DIRECT] Recepción de ' + id + ' fallida: ' + (ev.error || 'contenido no válido'));
      return;
    }
    console.log('[WIFI-DIRECT] Recibido ' + id + ' (' + Math.round(ev.data.length / 1024) + ' KB)' +
      (ev.ts ? ', de Android a la app ' + Math.round((Date.now() - ev.ts) / 100) / 10 + ' s' : '') + (ev.readMs ? ', lectura ' + Math.round(ev.readMs / 100) / 10 + ' s' : ''));
    var ack = self.ble.ackSystem;
    if (!ack) { self._nativeAck(id, false); return; }
    // T-E1 (como los trozos desde la 2767): completo y confirmado SOLO tras descifrarlo bien. Antes se marcaba completo y el byte de
    // «recibido» salía al tener los bytes: si no se podía leer (desfase de claves) se perdía en silencio con ✓✓ en quien envía.
    var m = Object.assign({}, inc.meta, { fr: inc.meta.fr || inc.from, senderNexoId: inc.meta.fr || inc.from, fromNexoId: inc.meta.fr || inc.from });
    var called = false;
    ack._dispatchFileComplete(id, ev.data, m, function(ok) {
      if (called) return; called = true;
      // Como un flujo terminado: si luego llega también por Bluetooth, se descarta (solo si se pudo leer: si no, los trozos sí valen)
      if (ok && ack.completedMessages) ack.completedMessages.set(id, { total: 1, expireAt: Date.now() + 600000 });
      self._nativeAck(id, ok);
      if (ok) self._ctl(inc.deviceId, { type: 'wf', id: id }).catch(function() {});
      else console.warn('[WIFI-DIRECT] ' + id + ': llegó pero no se pudo descifrar: sin confirmar (quien envía sigue por Bluetooth)');
    });
  }
}

export function createWifiDirect(ble) { return new WifiDirect(ble); }
