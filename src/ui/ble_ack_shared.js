
// Constantes y ayudantes de BleAckSystem (reestructuración 15-11: antes, la cabecera de ble_ack.js). Lo usan ble_ack.js, sus piezas
// (ble_ack_files/incoming/resume.js) y chat_stream.js.
const PROTOCOL_VERSION = 2;
// v3.3.0: trozos de 360 caracteres (con la cabecera JSON caben en una escritura con MTU 512;
// con MTU menor el nativo los parte y los reensambla). Antes 80-90 => 4-5x más paquetes.
const CHAT_CHUNK_SIZE = 360;
const CHAT_WINDOW_SIZE = 8;
const CHAT_WINDOW_TIMEOUT_MS = 3000;
const CHAT_PACING_DELAY_MS = 2;
const FILE_CHUNK_SIZE = 360;
// Ronda 2757: con MTU pequeño (20 bytes por escritura) un trozo de 60 era 60 de datos + 90 de cabecera: el 60 % de la
// radio en cabeceras. Medido (MTU 23, foto 45 KB): 60 → 191 s, 240 → 95 s; con 2 % de pérdidas 240 → 423 s, 360 → 567 s
function SMALL_MTU_MIN_CHUNK() { return (typeof window !== 'undefined' && Number(window.NEXO_SMALL_CHUNK)) || 240; }
const FILE_WINDOW_SIZE = 12;
// Receptor: confirma cada ACK_EVERY trozos o tras ACK_DEBOUNCE_MS sin más trozos (antes, uno por trozo)
const ACK_EVERY = 4;
const ACK_DEBOUNCE_MS = 150;
const NACK_INTERVAL_MS = 1500;
const FILE_WINDOW_TIMEOUT_MS = 8000;
const FILE_PACING_DELAY_MS = 2; // el nativo ya regula el ritmo (control de flujo por callback)
const MAX_WINDOW_RETRIES = 8;
// 3021 (diagnóstico S23 12-11 22:13: foto de 57 KB por el Redmi como puente, ni un trozo confirmado en 73 s): un ARCHIVO por un
// PUENTE Jump que no confirma ni un trozo en tantas ventanas se suelta y el archivo sale por el siguiente camino (buzón de archivos,
// internet); ese puente queda fuera para archivos BRIDGE_STALL_MS. Un puente vivo confirma la ventana 0 en ~1 s.
const BRIDGE_STALL_RETRIES = 2;
// 3044 (diagnósticos automáticos 13-11, S24 APK 3032/3033 → vivo por Wi-Fi local, síntoma «reintentos»): un respaldo Fénix sin un
// solo trozo confirmado tras estas ventanas, con el enlace VIVO, es una app dormida al otro lado (el sistema la congela en segundo
// plano): se rinde y queda para más tarde (Fénix salta a ese custodio un rato), sin 8 reenvíos ni diagnóstico. Solo Fénix (#129).
const FENIX_SILENT_RETRIES = 2;
const BT_RECHUNK_WRITES = 8; // 3022: un trozo de más escrituras Bluetooth que esto se rehace al pasar a Bluetooth (ver tooBigFor)
const BRIDGE_STALL_MS = 5 * 60 * 1000;
// #dueño 09-11 (diagnóstico S24 12:15): un flujo saliente > XFER_STUCK_MS sin NINGÚN ACK ya no cuenta como «transferencia
// activa» para proteger el enlace del ping/zombie del vigilante (hasActiveTransfer): un enlace Bluetooth zombi (las escrituras
// «salen», no vuelve nada) se detecta y se rehace aunque haya flujos encima (2 ventanas de archivo de 8 s + margen).
const XFER_STUCK_MS = 20000;
// #dueño 05-11 («la foto tarda detrás de un archivo grande»): PRIORIDAD para lo chico/interactivo. Un ARCHIVO grande le
// CEDE la radio mientras haya un envío interactivo (texto, foto, sticker) activo, para que la foto salga YA — como Fénix
// cede a la actividad del usuario (2905). Acotado: el archivo no cede más de BULK_YIELD_MAX_MS seguidos (siempre avanza,
// nunca se muere de hambre). Solo retrasa ventanas del archivo; no toca el protocolo de ventana/ACK (sin pérdida).
const INTERACTIVE_MAX_CHARS = 600000;   // ~450 KB: foto/sticker/voz/vídeo-previa = interactivo; archivos/vídeo HD grandes = bulk
const BULK_YIELD_STEP_MS = 120;         // cada cuánto el archivo re-mira si lo interactivo ya terminó
const BULK_YIELD_MAX_MS = 2500;         // tope de cesión continua: pasado esto manda una ventana igual
function BULK_PRIO() { return (typeof window === 'undefined') || window.NEXO_BULK_PRIO !== false; } // interruptor (prueba/seguridad)
function _isBulkFileData(data) { return typeof data === 'string' && data.length > INTERACTIVE_MAX_CHARS; } // archivo "grande"
// #129 (dueño 01-11): «Cola de escritura llena» (BLE_BUSY) es CONTRAPRESIÓN, no un fallo del enlace: la cola nativa (con
// MTU 23 son ~26 escrituras por mensajito) va llena y drena despacio. Se espera más y se reintenta el MISMO trozo, sin
// contar como fallo (no cambiar de camino ni abortar). Solo si NINGÚN trozo pasa durante ~5 min seguidos se da por
// saturado (enlace muerto). Antes se trataba como fallo y podía cambiar de enlace o abortar un enlace SANO (141× en el log).
const BUSY_MAX_WAITS = 150; // reintentos de contrapresión seguidos (sin que pase ningún trozo) antes de dejar pendiente
// #129: ¿el error de envío es «cola nativa llena» (BLE_BUSY = contrapresión) y no un fallo del enlace?
export function _isBusyErr(err) { return !!(err && err.code === 'BLE_BUSY'); }
// #129: espera (ms) ante la cola llena según el nº de reintentos SEGUIDOS n (1,2,3,…): 600 → 1200 → 2400 → 2400 (tope),
// para dar tiempo a que la cola MTU-23 drene. n > BUSY_MAX_WAITS devuelve -1 (saturado de verdad: dejar pendiente).
export function _busyBackoffMs(n) { return n > BUSY_MAX_WAITS ? -1 : Math.min(300 * Math.pow(2, Math.min(n, 3)), 2400); }
// #dueño 08-11 (diagnóstico lentitud BT, dos WiFi): un respaldo Fénix EN VUELO a un enlace Bluetooth ATASCADO seguía
// martillando la cola nativa («Cola de escritura llena») hasta ~5 min (BUSY_MAX_WAITS) tapando la radio y la UI para el
// usuario, AUNQUE el nativo ya hubiera marcado el enlace muerto (onWriteDropped → _markBleDead → _bleCongested). Las rondas
// 2951/2952/2954 frenan al ELEGIR/REANUDAR, pero NO a un stream ya corriendo. ¿Un respaldo de FONDO debe rendir el
// Bluetooth AHORA? Sí si: es Fénix (metaType==='fenix'), va por Bluetooth crudo (no net:/lan:, que no tienen cola MTU-23),
// y el enlace está marcado atascado/muerto (congested). Entonces se rinde y queda pendiente (Fénix tiene redundancia; el
// resume lo reintenta luego o por internet). Lo del usuario (texto/foto/archivo) NO se toca: mantiene toda la paciencia de
// #129. Pura y exportada para la prueba fenixyield.js.
// 3026: ¿es un respaldo Fénix? (no se guarda para reanudar: Fénix reintenta por su cuenta)
function _isFenixTx(meta) { return !!(meta && meta.type === 'fenix'); }
// 3032: tampoco se guarda para reanudar la media de un estado (se vuelve a pedir si hace falta)
function _noResumeTx(meta) { return _isFenixTx(meta) || !!(meta && meta.type === 'stmedia'); }
export function _fenixYieldBle(metaType, deviceIsBle, congested) {
  return metaType === 'fenix' && !!deviceIsBle && !!congested;
}
// #dueño 08-11 (diagnóstico de dos WiFi, archivos grandes por INTERNET): un archivo de 34 MB por internet arrancaba en ○,
// se quedaba en 0%, y SOLO avanzaba ~5% cada vez que el dueño tocaba «reintentar» — no era autónomo pese a los despertadores
// (2930–2937). Causa: cuando el envío se estancaba un rato (Tor directo parpadea), (a) el timeout global lo marcaba ✗
// 'failed' → botón de reintentar que el usuario tenía que tocar, y (b) agotar los reintentos de ventana ABORTABA el stream
// → dependía de un re-disparo externo (contacto que vuelve / app al frente) que no llegaba solo. Regla nueva: un archivo
// por internet a un contacto ALCANZABLE (canReach) se reenvía SOLO, sin pedir nada al usuario, mientras siga alcanzable y
// dentro del presupuesto de tiempo (2 h). No aborta ni marca ✗: queda ⏳ y el bucle de ventanas sigue reintentando y
// renovando el despertador hasta que fluye. Solo si el contacto se vuelve INALCANZABLE cae al store-and-forward de siempre
// (pending, se entrega al reconectar), y al pasar el tope se suelta (persistido, reanudable). Pura y exportada: prueba netfileauto.js.
const NET_FILE_AUTORETRY_BUDGET_MS = 7200000; // 2 h reintentando solo mientras el contacto siga alcanzable; luego store-and-forward
// 3004: estados de un archivo propio en los que un «leído» llega antes de tiempo (no se entregó todavía). Pura (prueba bigsend.js).
export function _readTooEarly(status) {
  return status === 'pending' || status === 'sending' || status === 'queued' || status === 'failed';
}
export function _netFileAutoRetry(type, isNet, reachable, elapsedMs, budgetMs) {
  return type === 'file' && !!isNet && !!reachable && (elapsedMs || 0) < (budgetMs || 0);
}
// #dueño 02-11 (B2, diagnóstico del coche): no MARTILLAR un Bluetooth de MTU MÍNIMO con un archivo GRANDE. Con MTU 23
// cada escritura lleva ~20 bytes útiles: un archivo de cientos de KB son decenas de miles de escrituras (minutos/horas)
// que congestionan la cola nativa, gastan batería/radio y suelen morir al moverse (el coche). En vez de arrancar y
// martillar, el archivo queda ⏳ PENDIENTE (el registro sigue en el vault) y resumeOutgoingTransfers lo reenvía por
// Wi-Fi / internet / Wi-Fi Direct en cuanto aparezca un camino mejor. Anti-inanición: si tras MTU_DEFER_MAX_WAIT_MS no
// apareció ningún camino mejor, se intenta IGUAL por Bluetooth (crawl) — así un contacto SOLO-Bluetooth nunca pierde el
// archivo; solo se evita el martilleo inútil mientras pueda llegar Wi-Fi. Las fotos/vistas previas chicas (por debajo
// del tope) SÍ se mandan por MTU 23 (caben en pocos minutos). Un enlace sano negocia MTU >= 185.
const LONG_TEXT_TINY_BLE = 4000;           // 3032: texto (cifrado o no) desde este tamaño no va por un Bluetooth de MTU mínimo si hay internet
const TINY_MTU = 50;                      // MTU <= esto es el caso degenerado (23): negociación inestable / enlace al límite
const BLE_TINY_MTU_DEFER_CHARS = 300000;  // archivo (base64) por encima de esto NO se arranca por MTU mínimo: queda pendiente
const MTU_DEFER_MAX_WAIT_MS = 300000;     // 5 min esperando un camino mejor; luego se intenta igual por Bluetooth (no perder)
// #dueño 02-11 (CRASH al subir 2 archivos a un chat con tiempo): resumeOutgoingTransfers arrancaba TODAS las
// transferencias pendientes a la vez. En un chat viejo con muchas pendientes (segmentos Fénix, mensajes sin entregar)
// eran decenas de ChatStreams simultáneos, cada uno con su temporizador reintentando sobre un enlace caído/MTU 23 → el
// hilo principal del WebView se saturaba (timers + logs + reconstruir el contenido de cada una) y la app se CONGELABA
// (ANR). Ahora se reanudan como mucho MAX_RESUME_CONCURRENT a la vez (el resto en cola) y el contenido se reconstruye
// perezosamente al arrancar cada una, no todas de golpe.
// 3041: ¿la transferencia guardada es la copia de un estado (acción oculta nexo_act «st»)? (se mira el principio del contenido)
function _isStatusTx(tx) {
  try {
    var c0 = tx && tx.chunks && tx.chunks.length ? tx.chunks.slice(0, 3).map(function(c) { return (typeof c === 'string') ? c : (c && (c.data || c.d)) || ''; }).join('') : '';
    return c0.indexOf('"type":"nexo_act"') >= 0 && /"act":"st"/.test(c0);
  } catch (e) { return false; }
}
const RESUME_FAIL_BASE_MS = 15000, RESUME_FAIL_MAX_MS = 600000; // 3038: espera tras una reanudación que se rindió (15 s, 30 s… 10 min)
const RESUME_SCAN_GAP_MS = 2500;          // 3003: mínimo entre dos escaneos completos de transferencias pendientes (resumeOutgoingTransfers)
const MAX_RESUME_CONCURRENT = 3;          // transferencias reanudadas a la vez (global); el resto espera en cola
// v3.10.0: Wi-Fi normal (lan.js): trozos grandes por la misma red
const LAN_FILE_CHUNK = 24000;
const LAN_CHAT_CHUNK = 8000;
const LAN_PSEUDO_MTU = 65535;
// v3.12.0: enlace por internet (relés públicos, net_link.js): "net:<NEXO ID>" (normalizado "netnx…")
function _isNetDevice(deviceId) { var d = (deviceId || '').toString().toLowerCase(); return d.indexOf('net:') === 0 || /^netnx[0-9a-z]{8}$/.test(d); }
const NET_FILE_CHUNK = 16000;   // un evento de relé admite ~64 KB (con cifrado y base64)
// #dueño 06-11: por encima de ~12 MB (que los relés sí aguantan, probado en bignet.js) un archivo por INTERNET prefiere
// TOR DIRECTO (sin relés, sin tope de tamaño). Umbral en caracteres base64 (~16 M ≈ 12 MB reales). Configurable en pruebas.
const NET_TOR_PREFER_BYTES = 16000000;
const NET_TOR_PREFER_CHUNKS = 1000;   // del lado del que recibe: tantos trozos de 16 KB ≈ 12 MB → archivo grande, arranca Tor
var TEXT_BUSY_GRACE_MS = 180000;   // 2993: cuánto puede un texto esperar sin gastar reintentos detrás de otro envío (ver _onWindowTimeout)
var LINK_DOWN_WAIT_FILE_MS = 15000; // y para un archivo por internet (mantiene vivo el toque de despertador)
var LINK_DOWN_WAIT_MAX_MS = 30000; // 2985: tope de la espera con el enlace caído (ver _onWindowTimeout)
// 3096 (diagnósticos vivo y S24 14-11 13:03–13:05): un TEXTO en trozos que el teléfono del otro ya confirmó (✓✓ de su nativo: NetBg lo
// guardó para la app) no se reenvía mientras su app duerme: lo recoge de los relés al despertar (pide lo de los últimos minutos). Antes
// se reenviaba la ventana cada ~4 s (el S24 acumuló 109 sobres) y a los 8 reintentos volvía a ⏳. Espera creciente, sin gastar
// reintentos, hasta PEER_SAFE_MAX_MS desde el ✓✓; pasado eso, lo de siempre.
var PEER_SAFE_FIRST_MS = 15000, PEER_SAFE_CAP_MS = 60000, PEER_SAFE_MAX_MS = 600000;
const NET_CHAT_CHUNK = 8000;
const NET_TEXT_ONE = 20000;     // un texto (ya cifrado) hasta este tamaño va en un solo paquete (buzón)
const PTR_ONE_MAX = 12000;      // 3031: puntero del buzón de archivos sin cifrar; cifrado (relleno + base64) queda < NET_TEXT_ONE
function _isLanDevice(deviceId) { var d = (deviceId || '').toString().toLowerCase(); return d.indexOf('lan:') === 0 || /^lannx[0-9a-z]{8}$/.test(d); }
// 3080: un archivo por Bluetooth pasa al camino rápido (upgradeLinks) si le quedan al menos UPGRADE_MIN_LEFT letras; a internet,
// solo si el Bluetooth medido en ese envío (tras UPGRADE_MEASURE_MS) va por debajo de UPGRADE_NET_RATE letras/s (~9 KB/s: lo
// medido por los relés en los teléfonos del dueño, 14-11); el mismo envío no se mueve otra vez antes de UPGRADE_COOLDOWN_MS
const UPGRADE_MIN_LEFT = 100000, UPGRADE_MEASURE_MS = 8000, UPGRADE_NET_RATE = 12000, UPGRADE_COOLDOWN_MS = 60000;
const BLE_FILE_MAX_CHARS = 3100000; // tope por Bluetooth (main.js MAX_BLE_B64_BYTES + cabecera de cifrado)
const BLE_HD_MAX_CHARS = 9500000;   // HD de vídeo (main.js MAX_HD_B64_BYTES + relleno y cabecera de cifrado)
// Robustez (auditoría 2804): tope de trozos por mensaje. El mayor mensaje real (BLE_HD_MAX_CHARS) troceado al mínimo
// (~40-60 por trozo con MTU chico) son ~158.000 trozos. Un trozo que dice tener más (el 'n') es un ataque: sin este
// tope, _sendBlockAck / _findMissing / el array de huecos recorrían hasta miles de millones de índices en el hilo
// principal (congelación → ANR). 300.000 deja el doble de margen sobre cualquier envío legítimo.
const MAX_CHUNKS = 300000;
const ASSEMBLY_TIMEOUT_MS = 120000;
// 3005 (investigación 11-11 §9: el APK de 25 MB por internet se paraba en el trozo 180/2213 y cada intento empezaba de cero).
// Archivo GRANDE por internet (≥ NET_BIG_MIN_CHUNKS trozos, ~1 MB): el que RECIBE guarda lo recibido 30 min sin trozos nuevos
// (antes 2 min: si su app se dormía más de eso lo tiraba y el otro tenía que volver a mandarlo todo) y el que ENVÍA mantiene el
// envío vivo ese mismo rato; si el otro deja de confirmar, tras NET_SILENT_FULL_RETRIES reenvíos de ventana pasa a «sondeo»:
// UN trozo cada NET_SILENT_PROBE_MS (antes ~80 trozos/min al vacío a los relés) y vuelve al ritmo normal en cuanto confirma.
const NET_BIG_MIN_CHUNKS = 64;
const NET_BIG_IDLE_MS = 1800000;
var NET_SILENT_FULL_RETRIES = 1;
var NET_SILENT_PROBE_MS = 60000;
// 3124 (PLAN etapa 1; diagnóstico S23 3057 19:46: vídeo HD a …6482 con 8 reintentos en 64 s): un ARCHIVO del usuario por un enlace
// LOCAL (Bluetooth o Wi-Fi) sin un solo trozo confirmado tras SLEEP_FILE_RETRIES ventanas, con el enlace vivo, es una app dormida al
// otro lado: se le toca para que despierte y se «sondea» con 1 trozo cada SLEEP_PROBE_MS (antes la ventana entera cada 8 s, 8 veces);
// al primer trozo confirmado sigue al ritmo normal. Si en SLEEP_PROBE_MAX_MS no despierta, queda ⏳ (sale solo al volver).
// 3127 (diagnóstico S24 3067 08:01: nota de voz de 56 KB al S23 dormido con datos móviles, la ventana entera reenviada cada 8 s
// durante 138 s): un archivo PEQUEÑO por internet sin un trozo confirmado también entra en sondeo, 1 trozo cada NET_SMALL_PROBE_MS
// (los relés guardan lo publicado; reenviarlo todo solo gasta datos de los dos)
var NET_SMALL_PROBE_MS = 15000;
var SLEEP_FILE_RETRIES = 2;
var SLEEP_PROBE_MS = 10000;
var SLEEP_PROBE_MAX_MS = 3 * 60 * 1000;
// 3007 (dueño 11-11, «(a) aquí está mi OK»): archivo GRANDE por internet que SIGUE DONDE IBA aunque se corte más de 30 min o se
// reinicie la app de cualquiera de los dos. El que envía guarda el contenido ya cifrado + su marca 'a' (vaultBigxOutPut) y al
// reanudar manda exactamente lo mismo (sin releer ni cifrar el adjunto); el que recibe guarda cada bloque completo de
// BIGX_BLOCK trozos (vaultBigxInPutBlock) y, tras reiniciarse, rehace lo recibido y lo confirma: el que envía salta lo que ya llegó.
const BIGX_MIN_CHARS = 2000000;    // envío: contenido (cifrado) a partir del cual se guarda para seguir donde iba
const BIGX_BLOCK = 64;             // = vault_manager.BIGX_BLOCK
const BIGX_MIN_CHUNKS = 128;       // recepción: trozos a partir de los cuales se guardan bloques en el teléfono
function _bigxUserId(id) { return /^msg[0-9a-z]+$/i.test(String(id || '')); }
// ¿bloque k completo en memoria (todos sus trozos como texto, no ya en el teléfono)? Devuelve sus trozos o null. El último bloque no.
export function _bigxFullBlock(chunks, k, total) {
  var s = k * BIGX_BLOCK, e = s + BIGX_BLOCK;
  if (e >= total) return null;
  var arr = [];
  for (var i = s; i < e; i++) { var v = chunks.get(i); if (typeof v !== 'string') return null; arr.push(v); }
  return arr;
}
export function _assemblyTimeoutFor(isNet, isChat, total) { return (isNet && !isChat && total >= NET_BIG_MIN_CHUNKS) ? NET_BIG_IDLE_MS : ASSEMBLY_TIMEOUT_MS; }
const COMPLETED_TTL_MS = 60000;
const GLOBAL_TIMEOUT_MS = 180000;
const FILE_GLOBAL_TIMEOUT_MS = 600000;
const SHORT_MSG_TIMEOUT_MS = 1000;
const SHORT_MSG_MAX_RETRIES = 5;
const SHORT_MSG_BACKOFF_DELAYS = [1000, 1000, 1500, 2000, 2500, 3000];
function _normMac(mac) {
  return (mac || '').toString().toLowerCase().replace(/[:-]/g, '').trim();
}
// v3.13.0 (ronda 2753): trozos de archivo en binario por Bluetooth (BinFrame.kt). Un trozo va así si es base64
// canónico (al llegar, el nativo lo vuelve a poner en base64 y debe salir el mismo texto) y el otro teléfono avisó
// con 'bf' de que lo entiende; si no, el trozo JSON de siempre. Se ahorra el 33 % del base64 por la radio.
var _B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function _binOk(s) {
  if (!s || s.length % 4 || !_B64_RE.test(s)) return false;
  try { return btoa(atob(s)) === s; } catch (e) { return false; }
}
// Dónde empiezan los datos en base64 (tras la cabecera del cifrado "E2:…:"): los trozos se alinean a partir de ahí
function _b64BodyStart(str) {
  for (var i = Math.min(str.length, 16384) - 1; i >= 0; i--) {
    var c = str.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 61)) return i + 1;
  }
  return 0;
}
function _newMsgId() { return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6); }
// v3.9.0: comprobación de cada trozo (FNV-1a de 32 bits de lo que importa). Si por Bluetooth se pierde un
// pedazo de un paquete, lo que queda puede seguir siendo un JSON válido con los datos más cortos: el receptor lo
// aceptaba y la foto entera acababa sin poder descifrarse (perdida en silencio). Builds anteriores no la mandan.
function _chunkCheck(o) {
  var s = [o.m, o.i, o.n, o.d, o.th || '', o.fn || ''].join('|');
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}
// Auditoría C1 (ronda 2777): firma de las confirmaciones. Un NEXO ID válido y comparación en tiempo constante del MAC.
var _ackRe = /^nx[0-9a-z]{8}$/;
function _ctEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Un NEXO ID válido o '' (ronda 2767: 'to' solo cuenta si es un NEXO ID, no una dirección)
function _nxOf(id) {
  var n = _normId(id);
  return /^nx[0-9a-z]{8}$/.test(n) ? n : '';
}
// Mayor seq de los mensajes RECIBIDOS del otro (su contador); los propios usan nuestro contador
function _maxSeqFromPeer(msgs) {
  var max = 0;
  (msgs || []).forEach(function(m) { if (!m._own && typeof m.seq === 'number' && m.seq > max) max = m.seq; });
  return max;
}
function _compressRanges(indices) {
  if (!indices || indices.length === 0) return '';
  var result = [];
  var start = indices[0];
  var prev = indices[0];
  for (var i = 1; i <= indices.length; i++) {
    if (i < indices.length && indices[i] === prev + 1) {
      prev = indices[i];
    } else {
      result.push(start === prev ? start.toString() : start + '-' + prev);
      if (i < indices.length) { start = indices[i]; prev = indices[i]; }
    }
  }
  return result.join(',');
}
function _decompressRanges(str) {
  var result = [];
  if (!str) return result;
  var parts = str.split(',');
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) continue;
    var dash = part.indexOf('-');
    if (dash >= 0) {
      var s = parseInt(part.substring(0, dash), 10);
      var e = parseInt(part.substring(dash + 1), 10);
      if (isNaN(s) || isNaN(e)) continue;
      for (var j = s; j <= e; j++) result.push(j);
    } else {
      var n = parseInt(part, 10);
      if (!isNaN(n)) result.push(n);
    }
  }
  return result;
}

export { PROTOCOL_VERSION, CHAT_CHUNK_SIZE, CHAT_WINDOW_SIZE, CHAT_WINDOW_TIMEOUT_MS, CHAT_PACING_DELAY_MS, FILE_CHUNK_SIZE, SMALL_MTU_MIN_CHUNK, FILE_WINDOW_SIZE, ACK_EVERY, ACK_DEBOUNCE_MS, NACK_INTERVAL_MS, FILE_WINDOW_TIMEOUT_MS, FILE_PACING_DELAY_MS, MAX_WINDOW_RETRIES, BRIDGE_STALL_RETRIES, FENIX_SILENT_RETRIES, BT_RECHUNK_WRITES, BRIDGE_STALL_MS, XFER_STUCK_MS, INTERACTIVE_MAX_CHARS, BULK_YIELD_STEP_MS, BULK_YIELD_MAX_MS, BULK_PRIO, _isBulkFileData, BUSY_MAX_WAITS, _isFenixTx, _noResumeTx, NET_FILE_AUTORETRY_BUDGET_MS, LONG_TEXT_TINY_BLE, TINY_MTU, BLE_TINY_MTU_DEFER_CHARS, MTU_DEFER_MAX_WAIT_MS, _isStatusTx, RESUME_FAIL_BASE_MS, RESUME_FAIL_MAX_MS, RESUME_SCAN_GAP_MS, MAX_RESUME_CONCURRENT, LAN_FILE_CHUNK, LAN_CHAT_CHUNK, LAN_PSEUDO_MTU, _isNetDevice, NET_FILE_CHUNK, NET_TOR_PREFER_BYTES, NET_TOR_PREFER_CHUNKS, TEXT_BUSY_GRACE_MS, LINK_DOWN_WAIT_FILE_MS, LINK_DOWN_WAIT_MAX_MS, PEER_SAFE_FIRST_MS, PEER_SAFE_CAP_MS, PEER_SAFE_MAX_MS, NET_CHAT_CHUNK, NET_TEXT_ONE, PTR_ONE_MAX, _isLanDevice, UPGRADE_MIN_LEFT, UPGRADE_MEASURE_MS, UPGRADE_NET_RATE, UPGRADE_COOLDOWN_MS, BLE_FILE_MAX_CHARS, BLE_HD_MAX_CHARS, MAX_CHUNKS, ASSEMBLY_TIMEOUT_MS, NET_BIG_MIN_CHUNKS, NET_BIG_IDLE_MS, NET_SILENT_FULL_RETRIES, NET_SILENT_PROBE_MS, SLEEP_FILE_RETRIES, SLEEP_PROBE_MS, SLEEP_PROBE_MAX_MS, NET_SMALL_PROBE_MS, BIGX_MIN_CHARS, BIGX_BLOCK, BIGX_MIN_CHUNKS, _bigxUserId, COMPLETED_TTL_MS, GLOBAL_TIMEOUT_MS, FILE_GLOBAL_TIMEOUT_MS, SHORT_MSG_TIMEOUT_MS, SHORT_MSG_MAX_RETRIES, SHORT_MSG_BACKOFF_DELAYS, _normMac, _B64_RE, _binOk, _b64BodyStart, _newMsgId, _chunkCheck, _normId, _ackRe, _ctEq, _nxOf, _maxSeqFromPeer, _compressRanges, _decompressRanges };
