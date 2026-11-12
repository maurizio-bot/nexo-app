import { e2eAvailable, e2eAckTag } from '../vault/e2e_crypto.js';
import { e2eAnyEncrypted, e2eOuterAd, e2eSealText, e2eSealB64, e2eOpenText, e2eOpenToB64 } from '../vault/e2e_proto.js';
import { ratchetCanEncrypt } from '../vault/e2e_ratchet.js';
import { NET_MAX_B64_BYTES } from './media_limits.js';
import { stageBlob, loadBlobOut, saveBlobOut, pointerReusable, _b64ToBytes as _blobB64ToBytes } from '../net/blob_mailbox.js'; // Fase B (2969): buzón de ARCHIVOS en relés
/**
* v3.14.0: el mismo mensaje troceado distinto por otro camino (puente cortado y reenvío directo) ya no se queda sin completar
* v3.13.0: trozos de archivo en binario por Bluetooth (BinFrame.kt; sin el 33 % del base64) con quien lo anuncia
*         ('bf' en kx, pings y acks); con builds anteriores, el JSON de siempre.
* v3.12.1: el registro de arranque dice la versión real (decía v3.2.12).
* v3.12.0: internet: enlace "net:" (trozos de 8-16 KB; archivos solo si los dos están en Wi-Fi).
* v3.11.0: remitente sellado por Jump: el nombre y el NEXO ID de quien manda un flujo van en un sobre para el destino
*         (meta.sealedFrom → fr "sx:…"); las confirmaciones dirigidas también (ble._sealObj).
* v3.10.0: Wi-Fi normal (lan.js): por un enlace "lan:<NEXO ID>" van trozos grandes y los archivos sin Wi-Fi Direct;
*         si el Wi-Fi se cae a mitad, el envío sigue por Bluetooth (useLink).
* v3.9.0: cada trozo lleva su comprobación (k): uno dañado por el camino se vuelve a pedir en vez de aceptarse
*         (la foto acababa sin poder descifrarse). Tiempos de cada texto en el diagnóstico ([SEND]).
* v3.8.0: Fénix: los archivos con meta.type 'fenix' van a fenix.onFile (no al chat ni a su progreso).
* v3.7.1: Wi-Fi Direct fallido: WD_FAILED si no cabe por Bluetooth (antes quedaba pendiente para siempre);
*         el HD de un vídeo (hasta BLE_HD_MAX_CHARS) sigue por Bluetooth como antes de Wi-Fi Direct.
* v3.7.0: Protocolo 2 de cifrado (e2e_ratchet.js, como Signal) con los contactos que lo tienen; el 1 con builds
*         anteriores (e2e_proto.js elige). Los datos del sobre (emisor|destino|id) van atados al cifrado: el id
*         se fija antes de cifrar. Nombre y miniatura de un archivo: ids "<id>#n" y "<id>#t". Un reintento de
*         algo ya descifrado (DUP) no se muestra otra vez.
* v3.6.0: Wi-Fi Direct (wifi_direct.js): los archivos grandes van primero por Wi-Fi Direct si el contacto
*         está a alcance y también lo tiene; si falla, por Bluetooth como siempre (_sendFileBest).
* v3.5.0: Jump (ble_relay.js): envío a un destino por otro teléfono (opts.dst / meta.dst: se cifra
*         para el destino; trozos con 'dt' y 'hp'), custodia 'rk', reenvío de flujos en un puente
*         (forwardStream) y ack de extremo a extremo dirigido al origen.
* v3.4.0: Cifrado de extremo a extremo: textos (cortos y largos) y adjuntos se cifran aquí con la
*         clave pública del destinatario (nunca salen en claro; sin clave → NO_KEY y queda pendiente)
*         y se descifran al llegar (también nombre y miniatura del archivo). Una transferencia entregada se borra del registro de salientes
*         (antes se reenviaba entera al abrir la app o reconectar).
* v3.3.4: Miniatura del vídeo ('th') en la cabecera.
* v3.3.3: Vídeo HD: cabecera 'hf' (mensaje que mejora), tiempo máximo según tamaño y sin
*         transferencias duplicadas al reanudar una que sigue en curso.
* v3.3.2: Eventos de progreso de envío y recepción de archivos (cada 5 %).
* v3.3.1: Sincronización de sesión con el seq correcto (solo mensajes recibidos del otro) y reenvío de
 *         lo propio sin confirmar.
 * v3.3.0: Transferencias sin tormenta de retransmisiones: NACK solo de huecos reales, ack agrupado
 *         (cada 4 trozos o 150 ms), sin reenvío por ack parcial, la ventana avanza al confirmarse,
 *         trozos de 360, ventana 8, sin persistir cada trozo recibido (se escribía y nunca se leía).
 * FIX v3.2.13: read_receipt ya no se descarta tras el ack del mismo mensaje; mensajes largos
 *             reensamblados se guardan (sin fromVault); el MIME viaja en 'mt'.
 * FIX v3.2.12: resumeOutgoingTransfers respeta tx.type — antes reenviaba SIEMPRE
 *             vía sendChunkedMessage (tipo 'chat'), corrompiendo fotos/videos
 *             interrumpidos (llegaban como texto plano en vez de adjunto)
 * FIX v3.2.12: width/height de imagen ahora viajan en el chunk 0 (se descartaban)
 * FIX v3.2.12: eliminado ChatStream.handlePartialAck (código muerto, nunca se
 *             invocaba; _handleBlockAck ya tiene la lógica real inline)
 * FIX: Transferencia de archivos/fotos fiable — chunk 60, ventana 3, pacing 40ms
 * FIX: Timeout global de archivos 10 min (escala con nº de chunks)
 * FIX: Assembly timeout 120s (fotos grandes)
 * FIX: Emisor ya NO dispara fileComplete con data=null (solo receptor)
 * FIX: Meta de recepción incluye type/format/sender de forma consistente
 * FIX: firstChunkMax 40 para archivos (respeta MTU BLE)
 * FIX: restaurado _normMac/_normId (rompían envío de archivos)
 * FIX: getBLEContacts vía this.ble (resumeOutgoingTransfers y _resolveNexoId)
 * Base: v3.2.11-NEXO
 */
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
const TINY_MTU = 50;                      // MTU <= esto es el caso degenerado (23): negociación inestable / enlace al límite
const BLE_TINY_MTU_DEFER_CHARS = 300000;  // archivo (base64) por encima de esto NO se arranca por MTU mínimo: queda pendiente
const MTU_DEFER_MAX_WAIT_MS = 300000;     // 5 min esperando un camino mejor; luego se intenta igual por Bluetooth (no perder)
// #dueño 02-11 (CRASH al subir 2 archivos a un chat con tiempo): resumeOutgoingTransfers arrancaba TODAS las
// transferencias pendientes a la vez. En un chat viejo con muchas pendientes (segmentos Fénix, mensajes sin entregar)
// eran decenas de ChatStreams simultáneos, cada uno con su temporizador reintentando sobre un enlace caído/MTU 23 → el
// hilo principal del WebView se saturaba (timers + logs + reconstruir el contenido de cada una) y la app se CONGELABA
// (ANR). Ahora se reanudan como mucho MAX_RESUME_CONCURRENT a la vez (el resto en cola) y el contenido se reconstruye
// perezosamente al arrancar cada una, no todas de golpe.
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
const NET_CHAT_CHUNK = 8000;
const NET_TEXT_ONE = 20000;     // un texto (ya cifrado) hasta este tamaño va en un solo paquete (buzón)
function _isLanDevice(deviceId) { var d = (deviceId || '').toString().toLowerCase(); return d.indexOf('lan:') === 0 || /^lannx[0-9a-z]{8}$/.test(d); }
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
export class BleAckSystem {
  constructor(bleInterface) {
    this.ble = bleInterface;
    this.pendingAcks = new Map();
    this.ackTimeoutMs = SHORT_MSG_TIMEOUT_MS;
    this.maxRetries = SHORT_MSG_MAX_RETRIES;
    this.receivedAcks = new Set();
    this.maxReceivedAcks = 500;
    this.chunkSize = CHAT_CHUNK_SIZE;
    this.windowSize = CHAT_WINDOW_SIZE;
    this.windowTimeoutMs = CHAT_WINDOW_TIMEOUT_MS;
    this.outgoingStreams = new Map();
    // 3007: transferencias grandes por internet a medias guardadas en el teléfono (msgId → { a, total, meta, blocks })
    this._bigxIn = new Map();
    this._bigxLoadIndex(0);
    this.preparing = new Set(); // ids cifrándose (aún sin ack pendiente ni flujo): cuentan como en vuelo
    // #129 parte 2 (dueño 01-11): tope de transferencias de ARCHIVO simultáneas por enlace Bluetooth (MTU 23 se
    // inunda si arrancan muchas a la vez; los textos/acks/control quedaban atrás → mensajes en ○). Las que no caben
    // esperan en esta cola y arrancan al liberarse un hueco. net:/lan:/Wi-Fi Direct NO se limitan.
    this._fileStartQueue = new Map(); // fileId -> { deviceId, data, meta, at, waiters:[{resolve,reject}] }
    this._maxBleFilesPerLink = 1;
    this._chatPrep = new Map(); // id → envío de un texto en curso (cifrándose, en flujo o esperando ✓✓): no sale dos veces a la vez
    this._mtuDeferSince = new Map(); // #B2: msgId → cuándo se aplazó por 1ª vez (MTU mínimo + archivo grande); tras un rato se intenta igual
    // #CRASH 02-11: cola global para reanudar transferencias pendientes sin saturar (ver MAX_RESUME_CONCURRENT)
    this._resumeQueue = [];          // trabajos pendientes de reanudar { cid, tx, contactDeviceId }
    this._resumeActive = 0;          // transferencias reanudadas en vuelo ahora mismo
    this._resumeSeen = new Set();    // transferId ya en cola o en vuelo (no encolar dos veces)
    this._done = new Map();     // id → cuándo se confirmó (entregado o leído): no se reenvía
    this.incomingBuffers = new Map();
    this.pendingFragments = new Map();
    this.maxFragmentAge = 300000;
    this.pendingOutgoingFiles = new Map();
    this.pendingOutgoingTransfers = new Map();
    this.blockAckTimers = new Map();
    this.completedMessages = new Map();
    this._startCleanupInterval();
    console.log('[BleAckSystem] v3.14.0-NEXO iniciado');
  }
  _resolveNexoId(deviceId) {
    // Enlaces Wi-Fi e internet: el NEXO ID va en el propio identificador ("lan:nx…", "net:nx…")
    var v = (deviceId || '').toString().toLowerCase().match(/^(?:lan|net):?(nx[0-9a-z]{8})$/);
    if (v) return v[1];
    var mac = _normMac(deviceId);
    if (this.ble && this.ble._macToNexoId) {
      var nx = this.ble._macToNexoId.get(mac);
      if (nx) return nx;
    }
    var contacts = (this.ble && typeof this.ble.getBLEContacts === 'function') ? this.ble.getBLEContacts() : [];
    for (var i = 0; i < contacts.length; i++) {
      if (_normMac(contacts[i].deviceId) === mac) return _normId(contacts[i].nexoId);
    }
    return mac;
  }
  // Ronda 2760: ¿hay un archivo o texto largo yendo o viniendo con ese teléfono? (el vigilante de la conexión no la
  // corta mientras tanto; lo preguntaba desde siempre pero no existía y cortaba enlaces a mitad de una foto)
  hasActiveTransfer(deviceId) {
    var nx = this._resolveNexoId(deviceId), now = Date.now(), self = this, busy = false;
    var same = function(d) { return d && (_normMac(d) === _normMac(deviceId) || self._resolveNexoId(d) === nx); };
    // #dueño 09-11 (diagnóstico S24 12:15, tablet zombi por Bluetooth): un flujo saliente que lleva > XFER_STUCK_MS sin NINGÚN
    // ACK no «protege» el enlace. Antes el vigilante saltaba el ping/zombie PARA SIEMPRE («transferencia activa») mientras cada
    // pendiente se arrastraba 8 reintentos de ventana sobre un enlace muerto y, al abortar, arrancaba el siguiente sobre el
    // mismo. Atascado → se pinga; sin pong, zombi → se rehace el enlace y lo pendiente se reanuda por el nuevo (como siempre).
    this.outgoingStreams.forEach(function(s) { if (!busy && s && !s.aborted && same(s.deviceId) && now - (s.lastAckAt || s.startTime || now) < XFER_STUCK_MS) busy = true; });
    this.incomingBuffers.forEach(function(b) { if (!busy && b && now - (b.lastActivity || 0) < 30000 && same(b.deviceId)) busy = true; });
    return busy;
  }
  // 2975: ¿hay un archivo/texto largo yendo o viniendo por ESE enlace exacto (p. ej. "lan:nx…")? Lo usa el latido del Wi-Fi para
  // no tomar por mala señal la ida y vuelta inflada por la propia carga (una transferencia por Bluetooth con el mismo contacto
  // no carga el Wi-Fi: por eso aquí no se resuelve al contacto como en hasActiveTransfer).
  hasActiveTransferOn(deviceId) {
    var id = _normMac(deviceId), now = Date.now(), busy = false;
    this.outgoingStreams.forEach(function(s) { if (!busy && s && !s.aborted && _normMac(s.deviceId) === id && now - (s.lastAckAt || s.startTime || now) < XFER_STUCK_MS) busy = true; });
    this.incomingBuffers.forEach(function(b) { if (!busy && b && _normMac(b.deviceId) === id && now - (b.lastActivity || 0) < 30000) busy = true; });
    return busy;
  }
  // 2993 (diagnóstico automático del dueño, vivo 10-11 16:46: un mensaje de grupo al tablet, por el puente del S24, agotó sus 8 reintentos —31 s—
  // y quedó ✗ mientras una foto de 212 KB salía por ese mismo Bluetooth): ¿hay OTRO envío avanzando ahora (ACKs en los últimos 8 s)?
  // Mientras sí, un texto que espera no gasta reintentos (la radio está ocupada, no muerta).
  _otherProgressing(excludeMsgId) {
    var now = Date.now(), busy = false;
    this.outgoingStreams.forEach(function(st, id) {
      if (busy || id === excludeMsgId || !st || st.aborted) return;
      if (st.lastAckAt && now - st.lastAckAt < 8000) busy = true;
    });
    return busy;
  }
  // #dueño 05-11: ¿hay un envío INTERACTIVO (texto/foto/sticker, no un archivo grande) activo AHORA? Si sí, un archivo
  // grande le cede la radio para que lo chico salga ya. Los streams terminados ya no están en outgoingStreams.
  _interactiveActive(excludeMsgId) {
    var active = false;
    this.outgoingStreams.forEach(function(s, id) {
      if (active || id === excludeMsgId || !s || s.aborted || s._bulk) return;
      active = true;
    });
    return active;
  }
  // _fromPrep: llamada interna con el texto ya cifrado por este mismo envío
  sendChunkedMessage(deviceId, content, meta, messageId, seq, _fromPrep) {
    var self = this;
    var dst = meta && meta.dst, to = meta && meta.to;
    // Ronda 2767 (revisión): el mismo texto largo no sale dos veces a la vez. Al reconectar arrancaban varios reenvíos
    // de lo pendiente y cada uno lo cifraba otra vez (distinto): el otro mezclaba los trozos de los dos, no lo podía
    // descifrar y se perdía, mientras aquí constaba como entregado
    if (messageId) {
      var running = self.outgoingStreams.get(messageId);
      if (running && !running.aborted && running._promise) return running._promise;
      if (!_fromPrep && self._chatPrep.has(messageId)) return self._chatPrep.get(messageId);
    }
    if (e2eAvailable() && content && !e2eAnyEncrypted(content)) {
      if (content.length <= 150) return self.sendWithRetry(deviceId, content, messageId, seq, { dst: dst, to: to });
      var cid = messageId || _newMsgId();
      var p = self._preparingFor(cid, self._ensurePeerKey(deviceId, dst, to)
        .then(function(t) { return e2eSealText(t, content, self._outAd(t, cid)); }))
        .then(function(enc) { return self.sendChunkedMessage(deviceId, enc, meta, cid, seq, true); });
      self._chatPrep.set(cid, p);
      var clear = function() { if (self._chatPrep.get(cid) === p) self._chatPrep.delete(cid); };
      p.then(clear, clear);
      return p;
    }
    // v3.12.0: por internet un texto va en un solo paquete: sirve de buzón (el otro puede no estar en línea; un flujo
    // por trozos esperaría confirmaciones que no llegan)
    if (_isNetDevice(deviceId) && !dst && content.length <= NET_TEXT_ONE && (!e2eAvailable() || e2eAnyEncrypted(content))) {
      return self._sendWithRetryRaw(deviceId, content, messageId || _newMsgId(), seq);
    }
    if (dst && content.length > 150 && !(meta && 'sealedFrom' in meta)) {
      return self._withSealedFrom(Object.assign({}, meta)).then(function(m2) { return self.sendChunkedMessage(deviceId, content, m2, messageId, seq, _fromPrep); });
    }
    return new Promise(function(resolve, reject) {
      var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
      var senderId = (self.ble && self.ble.localNexoId) || ((self.ble && self.ble.localDeviceUUID) ? self.ble.localDeviceUUID : 'unknown');
      var fromName = (self.ble && self.ble.localDeviceName) || 'NEXO';
      var ts = Date.now();
      if (meta && meta.sealedFrom) { senderId = meta.sealedFrom; fromName = ''; }
      var finalMeta = Object.assign({}, meta || {}, { f: fromName, fr: senderId, ts: ts });
      if (typeof seq !== 'number') {
        seq = (self.ble && typeof self.ble.getNextSeq === 'function') ? self.ble.getNextSeq() : 0;
      }
      finalMeta.seq = seq;
      if (content.length <= 150) {
        self.sendWithRetry(deviceId, content, msgId, seq, { dst: dst, to: to }).then(resolve).catch(reject);
        return;
      }
      var stream = new ChatStream(self, deviceId, msgId, content, finalMeta, 'chat');
      self.outgoingStreams.set(msgId, stream);
      stream._promise = stream.start();
      stream._promise.then(function() {
        if (self.outgoingStreams.get(msgId) === stream) self.outgoingStreams.delete(msgId);
        resolve();
      }).catch(function(err) {
        if (self.outgoingStreams.get(msgId) === stream) self.outgoingStreams.delete(msgId);
        reject(err);
      });
    });
  }
  sendFile(deviceId, fileId, base64Data, meta) {
    var self = this;
    var running = self.outgoingStreams.get(fileId);
    if (running && !running.aborted && running._promise) return running._promise;
    // 3007: hay un envío GRANDE guardado a medias para este archivo y el camino para archivos grandes es internet → se sigue con
    // lo guardado (mismo contenido cifrado, misma marca 'a'): el receptor reconoce lo que ya tiene y el envío salta hasta ahí.
    if (!(meta && (meta._noBigx || meta.fwd)) && typeof window !== 'undefined' && typeof window.vaultBigxOutHas === 'function' && window.vaultBigxOutHas(fileId)) {
      var cidR = (meta && (meta.dst || meta.to)) ? _nxOf(meta.dst || meta.to) : self._resolveNexoId(deviceId);
      var bestR = (cidR && self.ble && typeof self.ble._resolveDeviceIdForNexoId === 'function') ? self.ble._resolveDeviceIdForNexoId(cidR, true) : null;
      var netR = _isNetDevice(deviceId) ? deviceId : ((bestR && _isNetDevice(bestR)) ? bestR : null);
      if (netR) {
        return self._preparingFor(fileId, window.vaultBigxOutGet(fileId).then(function(x) {
          if (!x) {
            if (base64Data) return self.sendFile(deviceId, fileId, base64Data, Object.assign({}, meta || {}, { _noBigx: true }));
            throw Object.assign(new Error('Contacto no disponible: queda pendiente'), { code: 'PEER_ABSENT' });
          }
          console.log('[BleAckSystem] ' + fileId + ': sigo el archivo grande donde iba (guardado en el teléfono; sin volver a leerlo ni cifrarlo)');
          var m2 = Object.assign({}, x.rec.meta || {}, { _att: x.rec.att, _bigxResumed: true });
          if (meta && meta.to && !m2.dst) m2.to = meta.to;
          return self._sendFileBest(netR, fileId, x.content, m2);
        }));
      }
      // Sin internet para archivos grandes ahora (p. ej. Wi-Fi local): sale como siempre, con el adjunto
      if (!base64Data) return Promise.reject(Object.assign(new Error('Contacto no disponible: queda pendiente'), { code: 'PEER_ABSENT' }));
    }
    // 3007: null = «seguir con lo guardado» y ya no hay nada guardado → queda ⏳ y la siguiente vuelta carga el adjunto
    if (base64Data === null) return Promise.reject(Object.assign(new Error('Contacto no disponible: queda pendiente'), { code: 'PEER_ABSENT' }));
    if (e2eAvailable() && base64Data && !e2eAnyEncrypted(base64Data)) {
      // También el nombre y la miniatura del vídeo, que van en la cabecera
      var m = meta || {};
      return self._preparingFor(fileId, self._ensurePeerKey(deviceId, m.dst, m.to).then(function(t) {
        return Promise.all([
          e2eSealB64(t, base64Data, self._outAd(t, fileId)),
          (m.thumb && !e2eAnyEncrypted(m.thumb)) ? e2eSealB64(t, m.thumb, self._outAd(t, fileId + '#t')) : m.thumb,
          (m.name && !e2eAnyEncrypted(m.name)) ? e2eSealText(t, m.name, self._outAd(t, fileId + '#n')) : m.name
        ]);
      })).then(function(r) {
        var em = Object.assign({}, m);
        if (r[1]) em.thumb = r[1];
        if (r[2]) em.name = r[2];
        return self._withSealedFrom(em).then(function(em2) { return self._sendFileBest(deviceId, fileId, r[0], em2); });
      });
    }
    return self._sendFileBest(deviceId, fileId, base64Data, meta);
  }
  // v3.11.0: por Jump (meta.dst) a un contacto que entiende el remitente sellado: nombre y NEXO ID en sobre
  _withSealedFrom(meta) {
    var self = this, ble = self.ble;
    if (!meta || !meta.dst || meta.sealedFrom || !ble || typeof ble.sealedFrom !== 'function') return Promise.resolve(meta || {});
    return ble.sealedFrom(meta.dst, ble.localDeviceName || 'NEXO', ble.localNexoId).then(function(sf) {
      meta.sealedFrom = sf || null;
      return meta;
    }).catch(function() { meta.sealedFrom = null; return meta; });
  }
  // Receptor: el remitente de un flujo llegó sellado ("sx:…"): se abre (una vez) y se pone en la cabecera
  _unsealFrom(buf) {
    var self = this, fr = buf && buf.meta && buf.meta.fr;
    if (!fr || String(fr).indexOf('sx:') !== 0 || !self.ble || typeof self.ble.openSealedFrom !== 'function') return Promise.resolve(buf);
    if (!buf._unsealing) {
      buf._unsealing = self.ble.openSealedFrom(fr).then(function(o) {
        buf.meta.fr = buf.meta.senderNexoId = buf.meta.fromNexoId = o.fr;
        if (o.f) buf.meta.f = o.f;
        return buf;
      }).catch(function(e) { console.warn('[JUMP] Remitente sellado ilegible: ' + (e && e.message)); buf.meta.badSeal = true; return buf; });
    }
    return buf._unsealing;
  }
  // v3.10.0: se cayó el Wi-Fi con un contacto (oldId "lan:<nx>"). Lo que iba por él sigue por `next` (Bluetooth);
  // lo que no cabe por Bluetooth (vídeo original, archivo grande) o si no hay Bluetooth, se para con WD_FAILED /
  // PEER_ABSENT y quien lo mandó decide (vídeo: previa + HD; lo demás: pendiente hasta que vuelva un camino).
  relink(oldId, next, opts) {
    var self = this, nd = _normMac(oldId);
    self.pendingAcks.forEach(function(e) { if (next && _normMac(e.deviceId) === nd) e.deviceId = next; });
    self.outgoingStreams.forEach(function(st, id) {
      if (!st || _normMac(st.deviceId) !== nd) return;
      if (opts && opts.textsOnly && st.type === 'file') return; // 3022: el archivo espera el margen del Wi-Fi
      var limit = (st.meta && st.meta.hdFor) ? BLE_HD_MAX_CHARS : BLE_FILE_MAX_CHARS;
      var tooBig = st.type === 'file' && ((st.meta && st.meta.wdOnly) || String(st.content || '').length > limit);
      // 2975 (diagnóstico del dueño 13:35): Wi-Fi DEGRADADO (no caído) con un archivo grande en vuelo: el enlace sigue arriba y
      // el archivo no cabe por el camino nuevo → se queda donde está (antes se abortaba a ⏳ y el siguiente intento empezaba de cero)
      if (tooBig && opts && opts.keepTooBig) return;
      // 3006 (diagnóstico S24 11-11 07:48: el APK de 25 MB a un contacto se abortó en el instante en que éste salió «ya no está
      // en línea por internet» → ⏳ y el siguiente intento, de cero): un archivo GRANDE por internet sin otro camino NO se aborta
      // al caerse el contacto; el envío queda vivo esperando (rama «enlace caído» de _onWindowTimeout: sin reenviar, con el toque
      // de despertador) hasta NET_BIG_IDLE_MS sin confirmaciones, y al volver el contacto sigue donde iba (el receptor guarda lo
      // recibido ese mismo rato).
      if (!next && st.type === 'file' && _isNetDevice(st.deviceId) && st.total >= NET_BIG_MIN_CHUNKS) {
        console.log('[ChatStream] ' + id + ': el contacto salió de internet; el archivo grande espera a que vuelva (sigue donde iba)');
        try { self._dispatchStatus(id, 'pending'); } catch (e2) {}
        return;
      }
      if (next && !tooBig) {
        if (st.tooBigFor(next)) self._restartStream(st, id, next); else st.useLink(next);
        return;
      }
      // #dueño 02-11: al caerse el Wi-Fi, solo el VÍDEO ORIGINAL (wdOnly) va por su camino aparte (previa + HD → WD_FAILED).
      // Un archivo/foto grande NO se marca ✗: queda PENDIENTE (PEER_ABSENT, ⏳) y resumeOutgoingTransfers lo reenvía
      // cuando vuelva Wi-Fi/internet (el registro sigue en el vault). Antes todo lo «tooBig» caía a 'failed' y parecía perdido.
      var videoWd = tooBig && st.meta && st.meta.wdOnly;
      var e = new Error(videoWd ? 'Wi-Fi caído y no cabe por Bluetooth' : 'Contacto no disponible: queda pendiente');
      e.code = videoWd ? 'WD_FAILED' : 'PEER_ABSENT';
      var rej = st.reject; st.reject = null;
      st.abort();
      self.outgoingStreams.delete(id);
      if (st.type === 'file') self._dispatchFileProgress(id, 0, 1, videoWd ? 'failed' : 'sending', 0);
      if (rej) rej(e);
    });
  }
  // Ronda 2767 (revisión): el envío sigue por otro enlace en el que sus trozos no caben (trozos de Wi-Fi de 24 KB por
  // un Bluetooth de MTU 23: cada uno tarda más de lo que el nativo del otro espera a completarlo y lo descarta; la foto
  // no terminaba nunca). Se vuelve a empezar por el enlace nuevo, el mismo contenido en trozos a su medida (el otro
  // ve otro intento y empieza de nuevo); quien lo mandó sigue esperando la misma promesa
  _restartStream(st, id, next) {
    var self = this, res = st.resolve, rej = st.reject;
    st.resolve = null; st.reject = null;
    st.abort();
    if (self.outgoingStreams.get(id) === st) self.outgoingStreams.delete(id);
    console.log('[ChatStream] ' + id + ': sus trozos no caben por el enlace nuevo: se vuelve a empezar con trozos a su medida');
    var ns = new ChatStream(self, next, id, st.content, st.meta, st.type);
    self.outgoingStreams.set(id, ns);
    ns._promise = ns.start();
    ns._promise.then(function() {
      if (self.outgoingStreams.get(id) === ns) self.outgoingStreams.delete(id);
      if (res) res();
    }, function(e) {
      if (self.outgoingStreams.get(id) === ns) self.outgoingStreams.delete(id);
      if (rej) rej(e);
    });
  }
  // v3.13.0: el otro teléfono entiende trozos binarios (lo dice con 'bf' en sus acks y pings)
  markBin(deviceId, off) {
    if (!deviceId || _isLanDevice(deviceId) || _isNetDevice(deviceId)) return;
    if (!this._binPeers) this._binPeers = new Set();
    var nx = this._resolveNexoId(deviceId), keys = [_normMac(deviceId)];
    if (nx) keys.push(_normId(nx));
    var set = this._binPeers;
    keys.forEach(function(k) { if (off) set.delete(k); else set.add(k); });
  }
  peerBin(deviceId) {
    if (!this._binPeers || !deviceId || _isLanDevice(deviceId) || _isNetDevice(deviceId)) return false;
    if (this._binPeers.has(_normMac(deviceId))) return true;
    var nx = this._resolveNexoId(deviceId);
    return !!(nx && this._binPeers.has(_normId(nx)));
  }
  // Datos de cabecera de un archivo (los mismos por Bluetooth y por Wi-Fi Direct)
  _fileMeta(meta, size) {
    var senderId = (this.ble && this.ble.localNexoId) || ((this.ble && this.ble.localDeviceUUID) ? this.ble.localDeviceUUID : 'unknown');
    var fromName = (this.ble && this.ble.localDeviceName) || 'NEXO';
    var seq = (this.ble && typeof this.ble.getNextSeq === 'function') ? this.ble.getNextSeq() : 0;
    // v3.11.0: por Jump con remitente sellado, el nombre y el NEXO ID van en el sobre (meta.sealedFrom)
    if (meta && meta.sealedFrom) { fromName = ''; senderId = meta.sealedFrom; }
    return Object.assign({}, meta || {}, {
      f: fromName,
      fr: senderId,
      senderNexoId: senderId,
      ts: Date.now(),
      seq: seq,
      file: true,
      type: (meta && meta.type) ? meta.type : 'file',
      size: (meta && meta.size) ? meta.size : size
    });
  }
  // v3.6.0: Wi-Fi Direct primero si se puede (mucho más rápido); si falla, Bluetooth
  _sendFileBest(deviceId, fileId, data, meta) {
    var self = this, wd = self.ble && self.ble.wifiDirect;
    // #dueño 07-11 (REGLA ÚNICA de caminos, en el ÚNICO embudo por el que pasan TODOS los envíos de archivo): un archivo
    // PESADO (> tope de Bluetooth) nunca se arrastra por Bluetooth si hay algo mejor. Aunque el que llama ya haya resuelto
    // un enlace Bluetooth sin pedir «preferir internet» (p. ej. el reintento de pendientes, _resendPendingMessages, que
    // resolvía Bluetooth sin preferNet), aquí se RE-RESUELVE con preferNet para un archivo grande en un envío DIRECTO (no
    // Jump/puente): si el contacto tiene Wi-Fi de la misma red o internet, se va por ahí; si no, el propio flujo de abajo
    // prueba Wi-Fi Direct antes que Bluetooth crudo. Así NINGÚN camino puede saltarse la regla (antes cada uno decidía suelto).
    if (data && data.length > BLE_FILE_MAX_CHARS && !_isNetDevice(deviceId) && !_isLanDevice(deviceId) &&
        !(meta && (meta.dst || meta.fwd)) && self.ble && typeof self.ble._resolveDeviceIdForNexoId === 'function') {
      try {
        var cidHeavy = (meta && meta.to) || self._resolveNexoId(deviceId);
        if (cidHeavy) {
          var better = self.ble._resolveDeviceIdForNexoId(cidHeavy, true);
          if (better && (_isNetDevice(better) || _isLanDevice(better))) {
            console.log('[BleAckSystem] archivo grande re-ruteado de Bluetooth a ' + (_isLanDevice(better) ? 'Wi-Fi' : 'internet') + ' (regla única de caminos) fileId=' + fileId);
            deviceId = better;
          }
        }
      } catch (e) {}
    }
    // v3.10.0: misma red Wi-Fi: por ahí directamente (rápido, sin montar grupo; también el vídeo original)
    if (_isNetDevice(deviceId)) {
      // Ronda 2780 (pedido del dueño): fotos y archivos medianos SIEMPRE por internet: por Tor directo/Wi-Fi si está en
      // línea (filesOk), o al buzón de los relés si no (mailboxOk), bajo el tope. Si ni eso, queda pendiente y se reintenta.
      var net = self.ble && self.ble.net, cid = self._resolveNexoId(deviceId);
      // #dueño 06-11: un archivo GRANDE por internet (> ~12 MB) prefiere Tor DIRECTO (los relés no aguantan 25 MB). Se
      // marca al contacto y se arranca Tor a demanda (no hace nada si el usuario apagó Tor). Lo chico/mediano sigue por
      // relés (rápido). Con el latido (2930/2931) manteniendo despiertos a los dos, se forma el Tor directo y el archivo va por ahí.
      var torBig = (typeof window !== 'undefined' && Number(window.NEXO_NET_TOR_PREFER_BYTES)) || NET_TOR_PREFER_BYTES;
      if (net && typeof net.preferTorFor === 'function' && cid && data && data.length > torBig) net.preferTorFor(cid);
      // 2970 (diagnóstico del dueño S24 09-11): acá `data` YA viene SELLADO de extremo a extremo (sendFile sella antes de
      // elegir camino), así que el buzón de archivos (Fase B) NO se decide aquí: se decide ANTES de sellar, en el embudo
      // bleInterface.sendFile y en el reenvío de pendientes (ble_messages.js). El enganche que estaba acá mandaba al buzón
      // de archivos contenido sellado y hasta segmentos de Fénix (reanudaciones) → «atob … not correctly encoded».
      // Y un flujo por relés a un contacto AUSENTE no sirve de nada (la ventana espera confirmaciones EN VIVO: se quedaba
      // «Ventana sin ACK con el enlace caído» con el archivo entero en memoria): por internet solo si el contacto está EN
      // LÍNEA (canReach); si no, queda ⏳ pendiente y lo reanuda _netUp/_netOnline (los ≤ 5 MB ya fueron al buzón de archivos).
      var netOk = net && typeof net.canReach === 'function' && net.canReach(cid) && (net.filesOk(cid) || (net.mailboxOk(cid) && data && data.length <= NET_MAX_B64_BYTES));
      if (!netOk) {
        var en = new Error('Contacto no disponible: queda pendiente'); en.code = 'PEER_ABSENT';
        return Promise.reject(en);
      }
      return self._sendFileJS(deviceId, fileId, data, meta);
    }
    if (_isLanDevice(deviceId)) return self._sendFileJS(deviceId, fileId, data, meta);
    if (!data || !wd || (meta && meta.dst) || !wd.eligible(deviceId, data.length)) {
      // Vídeo original pensado para Wi-Fi Direct que ya no puede ir por ahí: la app lo manda como previa + HD
      if (meta && meta.wdOnly) { var e0 = new Error('Wi-Fi Direct no disponible'); e0.code = 'WD_FAILED'; return Promise.reject(e0); }
      return self._sendFileJS(deviceId, fileId, data, meta);
    }
    var running = self.outgoingStreams.get(fileId);
    if (running && !running.aborted && running._promise) return running._promise;
    self._dispatchFileProgress(fileId, 0, 1, 'sending', 1);
    return wd.send(deviceId, fileId, data, self._fileMeta(meta, data.length)).then(function() {
      self._dispatchStatus(fileId, 'delivered');
      self._dispatchFileProgress(fileId, 1, 1, 'delivered', 100);
    }, function(err) {
      // v3.7.1: falló Wi-Fi Direct. Si no cabe por Bluetooth (o es el vídeo original, que la app manda por
      // otro camino) → WD_FAILED: quien llama decide (vídeo: previa + HD por Bluetooth; archivo: fallido con
      // aviso). Hasta la 2712 quedaba "pendiente" para siempre (1 % en el emisor). El HD sí va por Bluetooth.
      var limit = (meta && meta.hdFor) ? BLE_HD_MAX_CHARS : BLE_FILE_MAX_CHARS;
      if ((meta && meta.wdOnly) || data.length > limit) {
        var e = new Error('Wi-Fi Direct falló (' + (err && err.message) + ')');
        e.code = 'WD_FAILED';
        self._dispatchFileProgress(fileId, 0, 1, 'failed', 0);
        throw e;
      }
      return self._sendFileJS(deviceId, fileId, data, meta);
    });
  }
  // ===== Fase B/C (2969/2971): BUZÓN DE ARCHIVOS en relés — ver src/net/blob_mailbox.js =====
  // Registro de blobs salientes: fileId → { expires, rec (sk, ids, relays), ptr, to: { cid: 'sent'|'delivered' }, byRef, group }.
  // Fase C: UN archivo se cifra y sube UNA sola vez; varios destinatarios (grupo, varios chats, reenvíos) comparten el mismo
  // blob y reciben solo el puntero. Un puntero VIGENTE guardado en el mensaje de origen (meta.blobPtr) se reenvía POR REFERENCIA.
  _blobRecord(fileId) {
    if (!this._blobOut) this._blobOut = loadBlobOut();
    var r = this._blobOut.get(fileId);
    return (r && r.expires > Date.now()) ? r : null;
  }
  _stageBlobOnce(fileId, data, meta) {
    var self = this, net = self.ble && self.ble.net;
    var live = self._blobRecord(fileId);
    if (live && live.ptr) return Promise.resolve(live);
    var ref = meta && meta.blobPtr;
    if (pointerReusable(ref)) {
      var recRef = { expires: ref.expires * 1000, rec: null, ptr: ref, to: {}, byRef: true };
      self._blobOut.set(fileId, recRef); saveBlobOut(self._blobOut);
      console.log('[BLOB] ' + fileId + ' va POR REFERENCIA (el mismo archivo ya está en los relés, huella ' + String(ref.hash).substring(0, 12) + '…): no se vuelve a subir nada');
      return Promise.resolve(recRef);
    }
    if (!self._blobOutRunning) self._blobOutRunning = new Map();
    if (self._blobOutRunning.has(fileId)) return self._blobOutRunning.get(fileId);
    var type = (meta && meta.type) || 'file';
    self._dispatchFileProgress(fileId, 0, 1, 'sending', 1);
    console.log('[BLOB] ' + fileId + ' (' + type + ', ' + Math.round(data.length * 3 / 4 / 1024) + ' KB) → buzón de archivos: cifro una vez y subo trozos a los relés');
    var p = stageBlob(net, data, { onProgress: function(i, n) { self._dispatchFileProgress(fileId, i, n, 'sending', Math.max(1, Math.round(95 * i / n))); } }).then(function(res) {
      var rec = { expires: res.pointer.expires * 1000, rec: res.outRecord, ptr: res.pointer, to: {} };
      self._blobOut.set(fileId, rec); saveBlobOut(self._blobOut);
      console.log('[BLOB] ' + fileId + ': ' + res.pointer.chunks.length + ' trozos en ' + res.pointer.relays.length + ' relés (réplica mínima ' + res.replication + ')');
      return rec;
    });
    self._blobOutRunning.set(fileId, p);
    var clear = function() { self._blobOutRunning.delete(fileId); };
    p.then(clear, clear);
    return p;
  }
  // El puntero (chiquito, E2E) a UN destinatario por su buzón normal; se anota a quién fue (la limpieza espera a TODOS)
  _sendBlobPointer(cid, fileId, rec, meta) {
    var self = this, type = (meta && meta.type) || 'file';
    var metaWire = Object.assign({}, meta || {}); delete metaWire.to; delete metaWire.dst; delete metaWire.fwd; delete metaWire.blobPtr;
    var att = { type: 'attachment', attachmentType: type, payload: 'ptr', meta: Object.assign({}, metaWire, { ptr: 1, size: rec.ptr.raw }), ptr: rec.ptr };
    console.log('[BLOB] ' + fileId + ': mando el puntero al buzón de ' + cid);
    return self.ble._sendViaNetMailbox(cid, JSON.stringify(att), fileId).then(function() {
      var cur = self._blobOut.get(fileId);
      if (cur) { cur.to = cur.to || {}; if (cur.to[cid] !== 'delivered') cur.to[cid] = 'sent'; saveBlobOut(self._blobOut); }
      self._dispatchStatus(fileId, 'sent'); // ✓ «en el buzón» (el icono limpio, no «✓ 99 %» de progreso)
    });
  }
  // Un reenvío futuro de este mensaje va por referencia: el puntero se guarda en el propio mensaje (meta.blobPtr)
  _rememberBlobPtr(chatId, fileId, ptr) {
    try { if (typeof window !== 'undefined' && window.vaultSetMessageFields) window.vaultSetMessageFields(chatId, fileId, { metaMerge: { blobPtr: ptr } }).catch(function() {}); } catch (e) {}
  }
  // Archivo a UN contacto (ausente, o en línea solo por internet con puntero reutilizable): resuelve con ✓ al guardarse el
  // puntero en un relé; el ✓✓ llega con el ack del receptor cuando bajó, verificó y descifró. Un puntero ya mandado a ese
  // contacto no se vuelve a mandar (reenvíos de pendientes).
  _sendFileViaBlobMailbox(cid, fileId, data, meta) {
    var self = this;
    var live = self._blobRecord(fileId);
    if (live && live.to && live.to[cid]) { console.log('[BLOB] ' + fileId + ' ya está en el buzón de ' + cid + ' (puntero vigente hasta ' + new Date(live.expires).toISOString() + '): no se vuelve a mandar'); return Promise.resolve(); }
    return self._stageBlobOnce(fileId, data, meta).then(function(rec) {
      self._rememberBlobPtr(cid, fileId, rec.ptr);
      return self._sendBlobPointer(cid, fileId, rec, meta);
    }).catch(function(e) {
      // «⏳, nunca ✗» (contratos §7): si ningún relé guardó un trozo o se cayó internet a mitad, el archivo queda PENDIENTE y
      // se reintenta al volver internet (_netOnline → _resendPendingMessages → buzón de archivos); jamás se marca fallido
      console.warn('[BLOB] ' + fileId + ' no pudo subirse al buzón de archivos (' + ((e && e.message) || 'sin relés') + '): queda pendiente');
      self._dispatchStatus(fileId, 'pending');
      var en = new Error('Buzón de archivos no disponible: queda pendiente'); en.code = 'PEER_ABSENT';
      throw en;
    });
  }
  // Fase C: adjunto de GRUPO por referencia — se sube UNA vez y cada miembro recibe el puntero dentro del sobre del grupo
  // (groups.sendText). Devuelve el puntero. `members` = a quién se le manda (se espera a TODOS antes de borrar los trozos).
  stageBlobFor(msgId, data, meta, members) {
    var self = this;
    return self._stageBlobOnce(msgId, data, meta).then(function(rec) {
      rec.to = rec.to || {}; (members || []).forEach(function(nx) { var k = _normId(nx); if (k && !rec.to[k]) rec.to[k] = 'sent'; });
      rec.group = true; saveBlobOut(self._blobOut);
      return rec.ptr;
    });
  }
  // Al confirmar un receptor (✓✓) se anota; cuando confirmaron TODOS se pide a los relés que borren los trozos (NIP-09,
  // best-effort; la caducidad de 7 días es la garantía). Por referencia (los trozos son de otro envío) solo se olvida el registro.
  _blobCleanup(ackMsgId, acker) {
    var self = this;
    if (!self._blobOut || !self._blobOut.size) return;
    var key = self._blobOut.has(ackMsgId) ? ackMsgId : String(ackMsgId).split('_')[0]; // grupo: wid = gm…_<sufijo del miembro>
    var rec = self._blobOut.get(key);
    if (!rec) return;
    var who = _normId(acker || '');
    if (!who && rec.group) { var mm = /_([0-9a-z]{8})$/.exec(String(ackMsgId)); if (mm) who = 'nx' + mm[1]; }
    rec.to = rec.to || {};
    if (who) rec.to[who] = 'delivered'; else Object.keys(rec.to).forEach(function(k) { rec.to[k] = 'delivered'; });
    var left = Object.keys(rec.to).filter(function(k) { return rec.to[k] !== 'delivered'; });
    if (left.length) { saveBlobOut(self._blobOut); console.log('[BLOB] ' + key + ' confirmado por ' + (who || '?') + '; faltan ' + left.length + ' destinatario(s)'); return; }
    self._blobOut.delete(key); saveBlobOut(self._blobOut);
    var net = self.ble && self.ble.net;
    if (rec.byRef || !net || !rec.rec || !rec.rec.sk || typeof net.blobDeleteEvent !== 'function') { console.log('[BLOB] ' + key + ' confirmado por todos' + (rec.byRef ? ' (por referencia: los trozos son de otro envío y caducan solos)' : '')); return; }
    try {
      var ev = net.blobDeleteEvent(_blobB64ToBytes(rec.rec.sk), rec.rec.ids);
      net.publishEach(ev, 8000).then(function(ok) { console.log('[BLOB] ' + key + ' confirmado por todos: pedí borrar sus ' + rec.rec.ids.length + ' trozos (' + ok.length + ' relés aceptaron; igual caducan solos)'); });
    } catch (e) {}
  }
  _sendFileJS(deviceId, fileId, base64Data, meta) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!base64Data || typeof base64Data !== 'string' || base64Data.length === 0) {
        reject(new Error('Datos de archivo vacios'));
        return;
      }
      // v3.3.3: reanudar (resumeOutgoingTransfers) una transferencia que sigue en curso creaba un segundo
      // flujo con el mismo id que pisaba al primero
      var running = self.outgoingStreams.get(fileId);
      if (running && !running.aborted && running._promise) {
        console.log('[BleAckSystem] sendFile ya en curso fileId=' + fileId);
        running._promise.then(resolve, reject);
        return;
      }
      // #129 parte 2: si ya está esperando en la cola de arranque (otro reenvío pidió lo mismo), no duplicar
      var q = self._fileStartQueue.get(fileId);
      if (q) { q.waiters.push({ resolve: resolve, reject: reject }); return; }
      // #129 parte 2 (dueño 01-11): no inundar un enlace BLUETOOTH (MTU 23) arrancando muchas transferencias de
      // archivo a la vez. Máximo _maxBleFilesPerLink por enlace Bluetooth; las demás esperan en cola y arrancan al
      // liberarse un hueco, así los textos/acks/control (que NO se limitan) tienen aire y no se quedan en ○ detrás de
      // miles de trozos. net:/lan:/Wi-Fi Direct no tienen la cola nativa de Bluetooth → no se limitan.
      // #dueño 05-11: cupo POR CLASE. Un archivo GRANDE hace cola detrás de otro grande; uno CHICO (foto/sticker) hace
      // cola detrás de otro chico — PERO un chico arranca YA aunque haya un grande en curso (son clases distintas) → la
      // foto no espera a que termine el archivo grande, y a la vez NO se inunda el enlace con muchos (máx. 1 por clase, #129).
      var isBle = !_isNetDevice(deviceId) && !_isLanDevice(deviceId);
      if (isBle && self._bleFileSlots(deviceId, _isBulkFileData(base64Data)) >= self._maxBleFilesPerLink) {
        self._fileStartQueue.set(fileId, { deviceId: deviceId, data: base64Data, meta: meta, at: Date.now(), waiters: [{ resolve: resolve, reject: reject }] });
        console.log('[BleAckSystem] sendFile EN COLA (enlace Bluetooth ocupado) fileId=' + fileId + ' to=' + deviceId + ' cola=' + self._fileStartQueue.size);
        return;
      }
      self._startFileStream(deviceId, fileId, base64Data, meta, resolve, reject);
    });
  }
  // #129 parte 2: nº de transferencias de ARCHIVO activas hacia ese enlace Bluetooth (mismo teléfono; net:/lan: no cuentan)
  _bleFileSlots(deviceId, bulk) {
    var self = this, n = 0, mac = _normMac(deviceId), nx = self._resolveNexoId(deviceId);
    self.outgoingStreams.forEach(function(s) {
      if (!s || s.aborted || s.type !== 'file' || (!!s._bulk !== !!bulk)) return;   // #dueño 05-11: cupo POR CLASE (grandes con grandes, chicos con chicos) → 1 grande + 1 chico a la vez; muchos de la misma clase hacen cola (sigue sin inundar, #129)
      if (_isNetDevice(s.deviceId) || _isLanDevice(s.deviceId)) return;
      if (_normMac(s.deviceId) === mac || self._resolveNexoId(s.deviceId) === nx) n++;
    });
    return n;
  }
  _startFileStream(deviceId, fileId, base64Data, meta, resolve, reject) {
    var self = this;
    var finalMeta = self._fileMeta(meta, base64Data.length);
    console.log('[BleAckSystem] sendFile START fileId=' + fileId + ' type=' + finalMeta.type + ' bytes(b64)=' + base64Data.length + ' to=' + deviceId);
    // #129 (dueño 31-10): un respaldo FÉNIX de fondo NO debe parar el escaneo de contactos (sí lo hace una foto/archivo que el usuario espera).
    if (self.ble && typeof self.ble._stopAutoScan === 'function' && finalMeta.type !== 'fenix' && !_isNetDevice(deviceId)) self.ble._stopAutoScan();   // 3016: por internet no usa la radio
    var stream = new ChatStream(self, deviceId, fileId, base64Data, finalMeta, 'file');
    self.outgoingStreams.set(fileId, stream);
    // 3007: archivo grande del usuario por internet → se guarda (cifrado) para poder seguir donde iba; se borra al entregarse
    var bigx = _isNetDevice(deviceId) && base64Data.length >= BIGX_MIN_CHARS && _bigxUserId(fileId) && !(meta && meta.fwd) && typeof window !== 'undefined' && typeof window.vaultBigxOutPut === 'function';
    if (bigx && !finalMeta._bigxResumed) {
      var metaX = Object.assign({}, meta || {}); delete metaX._att; delete metaX._bigxResumed; delete metaX._noBigx;
      try { window.vaultBigxOutPut(fileId, { att: stream.att, cid: self._resolveNexoId(deviceId), meta: metaX }, base64Data).catch(function() {}); } catch (e) {}
    }
    stream._promise = stream.start();
    stream._promise.then(function() {
      self.outgoingStreams.delete(fileId);
      if (bigx || finalMeta._bigxResumed) { try { window.vaultBigxOutDrop(fileId).catch(function() {}); } catch (e) {} }
      console.log('[BleAckSystem] sendFile OK fileId=' + fileId);
      resolve();
      self._pumpFileQueue(deviceId);
    }).catch(function(err) {
      self.outgoingStreams.delete(fileId);
      console.warn('[BleAckSystem] sendFile FAIL fileId=' + fileId, err && err.message);
      reject(err);
      self._pumpFileQueue(deviceId);
    });
  }
  // #129 parte 2: al liberarse un hueco, arrancar la siguiente transferencia de archivo en cola para ese enlace Bluetooth
  _pumpFileQueue(deviceId) {
    var self = this;
    if (!self._fileStartQueue || self._fileStartQueue.size === 0) return;
    var mac = _normMac(deviceId), nx = self._resolveNexoId(deviceId), pick = null, pickId = null;
    self._fileStartQueue.forEach(function(it, id) {
      if (pick || _isNetDevice(it.deviceId) || _isLanDevice(it.deviceId)) return;
      if (!(_normMac(it.deviceId) === mac || self._resolveNexoId(it.deviceId) === nx)) return;
      if (self._bleFileSlots(it.deviceId, _isBulkFileData(it.data)) < self._maxBleFilesPerLink) { pick = it; pickId = id; }  // arranca el siguiente de la clase (grande/chico) que tenga hueco
    });
    if (!pick) return;
    self._fileStartQueue.delete(pickId);
    var waiters = pick.waiters || [];
    self._startFileStream(pick.deviceId, pickId, pick.data, pick.meta,
      function() { waiters.forEach(function(w) { try { w.resolve(); } catch (e) {} }); },
      function(err) { waiters.forEach(function(w) { try { w.reject(err); } catch (e) {} }); });
  }
  processIncomingFragment(dataObj) {
    try {
      var deviceId = dataObj.deviceId;
      var content = dataObj.content;
      var msg = JSON.parse(content);
      var type = msg.t || msg.type;
      if (type === 'ba' || type === 'block_ack') { this._handleBlockAck(msg); return true; }
      if (type === 'ack' || type === 'read_receipt') { this.processIncomingAck(content); return true; }
      if (type === 'ping' || type === 'pong') { if (msg.bf) this.markBin(deviceId); return false; } // 'bf': entiende trozos binarios
      if (type === 'n') { this._handleNack(msg); return true; }
      if (type === 'a') { this._handleLegacyChunkAck(msg); return true; }
      if (type === 'ss') { this._handleSessionSync(deviceId, msg); return true; }
      if (type === 'sr') { this._handleSessionSyncResponse(deviceId, msg); return true; }
      if (type === 'c' || type === 'f') {
        this._handleIncomingChunk(deviceId, msg, type, dataObj.ts);
        return true;
      }
      if (type === 'fm' || type === 'fd') {
        console.warn('[BleAckSystem] Ignorando chunk nativo obsoleto:', type);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }
  // rxTs: cuándo llegó este trozo (con la app cerrada, cuándo lo guardó la parte nativa)
  _handleIncomingChunk(deviceId, msg, type, rxTs) {
    var self = this;
    var msgId = msg.m || msg.msgId;
    var idx = (typeof msg.i === 'number') ? msg.i : msg.idx;
    var total = (typeof msg.n === 'number') ? msg.n : msg.total;
    var data = msg.d || msg.data;
    var from = msg.fr || msg.from;
    var seq = (typeof msg.seq === 'number') ? msg.seq : 0;
    if (!msgId || typeof idx !== 'number' || typeof total !== 'number') return;
    if (total <= 0 || idx < 0 || idx >= total) return;
    // Robustez (auditoría 2804): un 'n' (total) desproporcionado haría que el block-ack / NACK recorrieran miles de
    // millones de índices en el hilo principal (congelación de la interfaz → ANR). Por encima de MAX_CHUNKS es un
    // ataque: se ignora. Esto también acota idx (idx<total), así que corta el array de huecos de más abajo.
    if (total > MAX_CHUNKS) return;
    // Trozo dañado por el camino: se ignora (queda como hueco y se vuelve a pedir)
    if (msg.k !== undefined && msg.k !== _chunkCheck(msg)) {
      self.stats = self.stats || {}; self.stats.badChunks = (self.stats.badChunks || 0) + 1;
      console.warn('[BleAckSystem] Trozo ' + idx + ' de ' + msgId + ' dañado: se vuelve a pedir');
      // Se pide ya (sin esperar a notar el hueco): el emisor lo reenvía enseguida
      if (!self.completedMessages.get(msgId)) self._sendNack(deviceId, msgId, [idx]);
      return;
    }
    var completed = self.completedMessages.get(msgId);
    if (completed) {
      // Ronda 2767: mientras se descifra no se confirma (si no se puede descifrar, el emisor no lo da por entregado)
      if (!completed.pending) self._sendFinalAck(deviceId, msgId, total);
      return;
    }
    // P6 (dueño 01-11): el MISMO mensaje ya llegó ENTERO por otro camino (internet/Jump/BLE corto; dedup central
    // _receivedMessageIds). No reabrir un reensamblado BLE con trozos tardíos que nunca completaría: acusar recibo (que el
    // emisor pare) y salir. Cubre el orden «internet antes, trozos BLE después»; el buffer ya a medias lo cierra dropAssembly.
    if (self.ble && self.ble._receivedMessageIds && self.ble._receivedMessageIds.has(msgId)) {
      self._sendFinalAck(deviceId, msgId, total);
      return;
    }
    var buf = self.incomingBuffers.get(msgId);
    if (buf && buf._loading) return;   // 3007: se está trayendo del teléfono lo ya recibido para juntarlo
    // 3007: archivo grande por internet a medias guardado en el teléfono (p. ej. tras reiniciarse la app) → seguir donde iba
    if (!buf && type !== 'c' && _isNetDevice(deviceId)) buf = self._bigxRestore(deviceId, msgId, msg, total);
    // Ronda 2767: otro intento del mismo mensaje (marca 'a' distinta: cifrado otra vez, distinto). Sus trozos no se
    // mezclan con los del anterior (antes salía ilegible y se perdía): si el anterior está parado, se empieza de nuevo
    if (buf && (msg.a || '') !== (buf.a || '')) {
      if (Date.now() - (buf.lastActivity || 0) < 4000) return;
      console.warn('[BleAckSystem] ' + msgId + ': llega otro intento: se empieza de nuevo');
      if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
      if (buf.ackTimer) clearTimeout(buf.ackTimer);
      self.incomingBuffers.delete(msgId);
      self._bigxForget(msgId);   // 3007: lo guardado era de otro intento
      buf = null;
    }
    // Ronda 2758: el mismo mensaje llega por otro camino troceado distinto (el puente Jump lo empezó y se cortó, y el
    // emisor lo manda directo): si lo que había a medias está parado, se empieza con el nuevo (antes se mezclaban los
    // trozos y no se completaba nunca); si los dos siguen activos, se sigue con el primero
    if (buf && buf.total !== total) {
      if (Date.now() - (buf.lastActivity || 0) < 4000) return;
      console.warn('[BleAckSystem] ' + msgId + ' llega troceado distinto (' + buf.total + ' → ' + total + ' trozos): se empieza de nuevo');
      if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
      self.incomingBuffers.delete(msgId);
      self._bigxForget(msgId);   // 3007
      buf = null;
    }
    if (!buf && idx !== 0) {
      var missing = [];
      for (var i = 0; i <= Math.min(idx, total - 1); i++) missing.push(i);
      self._sendNack(deviceId, msgId, missing);
      return;
    }
    if (!buf) {
      var resolvedType = msg.tp || msg.type || (type === 'f' ? 'file' : null);
      var resolvedFrom = from || msg.fr || 'unknown';
      buf = {
        chunks: new Map(), total: total,
        meta: {
          f: msg.f || 'NEXO',
          fr: resolvedFrom,
          senderNexoId: resolvedFrom,
          fromNexoId: resolvedFrom,
          ts: msg.ts || Date.now(),
          // Ronda 2767 (revisión): la hora del mensaje en este teléfono es la de su llegada (la del primer trozo), como la
          // de un texto corto. Antes un texto largo o un archivo llevaba la hora del otro teléfono al mandarlo: con los
          // relojes desfasados (lo normal sin red) o al reenviarse, salían desordenados con los textos cortos
          rxTs: (typeof rxTs === 'number' && rxTs > 0) ? rxTs : Date.now(),
          seq: seq,
          type: resolvedType,
          name: msg.fn || msg.name,
          mime: msg.mt || msg.mime,
          size: msg.fs || msg.size,
          format: msg.ft || msg.format,
          duration: (typeof msg.du === 'number' && msg.du > 0 && msg.du < 86400) ? msg.du : undefined, // 3015: nota de voz
          mimeType: (typeof msg.am === 'string' && /^audio\/[a-z0-9.+-]+(;[ a-z0-9=.,"-]*)?$/i.test(msg.am) && msg.am.length < 80) ? msg.am : undefined,
          width: msg.w || msg.width,
          height: msg.h || msg.height,
          hdFor: msg.hf || null,
          preview: msg.pv === 1,
          once: msg.o1 === 1, // #94 «ver una vez»

          thumb: msg.th || null,
          pages: msg.pg || null,
          dst: msg.dt || null,
          hp: msg.hp || 0
        },
        received: 0, deviceId: deviceId, lastActivity: Date.now(),
        isChat: type === 'c', nackSent: false, a: msg.a || ''
      };
      self.incomingBuffers.set(msgId, buf);
      // #129 (dueño 31-10): recibir un respaldo FÉNIX de fondo tampoco debe parar el escaneo de contactos.
      if (!buf.isChat && buf.meta.type !== 'fenix' && !_isNetDevice(deviceId) && self.ble && typeof self.ble._stopAutoScan === 'function') self.ble._stopAutoScan();
      buf.assemblyTimer = setTimeout(function() {
        if (self.incomingBuffers.has(msgId)) {
          console.warn('[BleAckSystem] Assembly timeout msgId=' + msgId);
          self._reportIncomingProgress(msgId, self.incomingBuffers.get(msgId), 'failed');
          self.incomingBuffers.delete(msgId);
        }
      }, _assemblyTimeoutFor(_isNetDevice(deviceId), buf.isChat, buf.total));
    }
    if (!buf.chunks.has(idx)) {
      buf.chunks.set(idx, data || '');
      buf.received++;
      if (typeof buf.maxIdx !== 'number' || idx > buf.maxIdx) buf.maxIdx = idx;
      buf.lastActivity = Date.now();
      if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
      buf.assemblyTimer = setTimeout(function() {
        if (self.incomingBuffers.has(msgId)) {
          console.warn('[BleAckSystem] Assembly timeout msgId=' + msgId);
          self._reportIncomingProgress(msgId, self.incomingBuffers.get(msgId), 'failed');
          self.incomingBuffers.delete(msgId);
        }
      }, _assemblyTimeoutFor(_isNetDevice(deviceId), buf.isChat, buf.total));
    }
    self._bigxMaybeSave(deviceId, msgId, buf, idx);   // 3007
    var senderId = from || (buf.meta && buf.meta.fr) || 'unknown';
    if (buf.received >= buf.total) {
      if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
      if (buf.ackTimer) { clearTimeout(buf.ackTimer); buf.ackTimer = null; }
      self._assembleAndDispatch(buf, deviceId, senderId, msgId);
      return;
    }
    // v3.3.0: ack agrupado (antes uno por trozo: saturaba la cola nativa de 80 ms por notify)
    self._scheduleBlockAck(deviceId, msgId, buf);
    self._reportIncomingProgress(msgId, buf);
    // v3.3.0: NACK solo de huecos reales (por debajo del mayor índice recibido). Antes incluía todos
    // los trozos futuros ("2-767") y el emisor los reenviaba todos: tormenta de retransmisiones.
    var gaps = self._findGaps(buf);
    var now = Date.now();
    if (gaps.length > 0 && (!buf.lastNackAt || now - buf.lastNackAt > NACK_INTERVAL_MS)) {
      buf.lastNackAt = now;
      self._sendNack(deviceId, msgId, gaps);
    }
  }
  // ── 3007: recepción de archivos grandes por internet que sigue donde iba (bloques en el teléfono) ──
  _bigxLoadIndex(n) {
    var self = this;
    try {
      if (typeof window !== 'undefined' && typeof window.vaultBigxInIndex === 'function') {
        window.vaultBigxInIndex().then(function(m) { Object.keys(m || {}).forEach(function(k) { if (!self._bigxIn.has(k)) self._bigxIn.set(k, m[k]); }); }).catch(function() {});
      } else if (n < 20) setTimeout(function() { self._bigxLoadIndex(n + 1); }, 500);   // main.js aún no lo expuso
    } catch (e) {}
  }
  _bigxForget(msgId) {
    var had = this._bigxIn.has(msgId);
    this._bigxIn.delete(msgId);
    try { if (typeof window !== 'undefined' && typeof window.vaultBigxInDrop === 'function') window.vaultBigxInDrop(msgId).catch(function() {}); } catch (e) {}
    return had;
  }
  // Rehace el buffer de un archivo grande a medias desde lo guardado (sus bloques quedan como «en el teléfono»: valor null)
  _bigxRestore(deviceId, msgId, msg, total) {
    var self = this, rec = self._bigxIn.get(msgId);
    if (!rec) return null;
    if (rec.a !== (msg.a || '') || rec.total !== total) {
      console.log('[BleAckSystem] ' + msgId + ': llega otro intento del archivo grande: lo guardado de antes no sirve, se empieza de nuevo');
      self._bigxForget(msgId);
      return null;
    }
    var buf = { chunks: new Map(), total: total, meta: rec.meta || {}, received: 0, deviceId: deviceId, lastActivity: Date.now(), isChat: false, nackSent: false, a: rec.a, diskBlocks: new Set(), bigx: true };
    (rec.blocks || []).forEach(function(k) {
      var s0 = k * BIGX_BLOCK, e0 = Math.min(total, s0 + BIGX_BLOCK);
      for (var i = s0; i < e0; i++) { if (!buf.chunks.has(i)) { buf.chunks.set(i, null); buf.received++; if (typeof buf.maxIdx !== 'number' || i > buf.maxIdx) buf.maxIdx = i; } }
      buf.diskBlocks.add(k);
    });
    if (!buf.diskBlocks.size) return null;
    buf.assemblyTimer = setTimeout(function() {
      if (self.incomingBuffers.get(msgId) === buf) {
        console.warn('[BleAckSystem] Assembly timeout msgId=' + msgId);
        self._reportIncomingProgress(msgId, buf, 'failed');
        self.incomingBuffers.delete(msgId);
      }
    }, _assemblyTimeoutFor(true, false, total));
    self.incomingBuffers.set(msgId, buf);
    if (!_isNetDevice(buf.deviceId) && self.ble && typeof self.ble._stopAutoScan === 'function') self.ble._stopAutoScan();
    console.log('[BleAckSystem] ' + msgId + ': sigo recibiendo el archivo grande donde iba (' + buf.received + ' de ' + total + ' trozos guardados en el teléfono)');
    return buf;
  }
  // Guarda en el teléfono el bloque de idx si ya está completo (y libera esa memoria: queda como «en el teléfono»)
  _bigxMaybeSave(deviceId, msgId, buf, idx) {
    if (!buf || buf.isChat || buf.total < BIGX_MIN_CHUNKS || !_isNetDevice(deviceId) || !_bigxUserId(msgId)) return;
    if (typeof window === 'undefined' || typeof window.vaultBigxInPutBlock !== 'function') return;
    var k = Math.floor(idx / BIGX_BLOCK);
    buf.diskBlocks = buf.diskBlocks || new Set(); buf._bigxSaving = buf._bigxSaving || new Set();
    if (buf.diskBlocks.has(k) || buf._bigxSaving.has(k)) return;
    var arr = _bigxFullBlock(buf.chunks, k, buf.total);
    if (!arr) return;
    var self = this, s0 = k * BIGX_BLOCK, e0 = s0 + BIGX_BLOCK;
    buf.bigx = true; buf._bigxSaving.add(k);
    window.vaultBigxInPutBlock(msgId, k, arr, { a: buf.a || '', total: buf.total, meta: buf.meta, from: buf.meta && buf.meta.fr }).then(function(ok) {
      buf._bigxSaving.delete(k);
      if (!ok || buf._assembled || buf._loading || self.incomingBuffers.get(msgId) !== buf) return;   // juntándose: se queda en memoria
      buf.diskBlocks.add(k);
      for (var j = s0; j < e0; j++) { if (typeof buf.chunks.get(j) === 'string') buf.chunks.set(j, null); }
      var rec = self._bigxIn.get(msgId);
      if (!rec || rec.a !== (buf.a || '') || rec.total !== buf.total) { rec = { a: buf.a || '', total: buf.total, meta: buf.meta, blocks: [] }; self._bigxIn.set(msgId, rec); }
      if (rec.blocks.indexOf(k) < 0) rec.blocks.push(k);
    }, function() { buf._bigxSaving.delete(k); });
  }
  // Trae del teléfono los bloques guardados (de uno en uno) y junta; si falta alguno, se piden de nuevo esos trozos
  _bigxLoadThenAssemble(buf, deviceId, senderId, msgId) {
    var self = this;
    buf._loading = true;
    var ks = [], bad = [];   // los bloques que están solo en el teléfono (trozos con valor null)
    for (var iq = 0; iq < buf.total; iq++) { if (buf.chunks.get(iq) === null) { var kq = Math.floor(iq / BIGX_BLOCK); if (ks.indexOf(kq) < 0) ks.push(kq); } }
    var step = function(i) {
      if (i >= ks.length) return Promise.resolve();
      var k = ks[i];
      return Promise.resolve(window.vaultBigxInGetBlock(msgId, k)).then(function(arr) {
        var s0 = k * BIGX_BLOCK, e0 = Math.min(buf.total, s0 + BIGX_BLOCK);
        if (!arr || arr.length !== e0 - s0) bad.push(k);
        else for (var j = s0; j < e0; j++) { if (buf.chunks.get(j) === null) buf.chunks.set(j, arr[j - s0]); }
        return step(i + 1);
      });
    };
    step(0).then(function() {
      buf._loading = false;
      if (bad.length) {
        bad.forEach(function(k) {
          buf.diskBlocks.delete(k);
          var s0 = k * BIGX_BLOCK, e0 = Math.min(buf.total, s0 + BIGX_BLOCK);
          for (var j = s0; j < e0; j++) { if (buf.chunks.get(j) === null) { buf.chunks.delete(j); buf.received--; } }
        });
        console.warn('[BleAckSystem] ' + msgId + ': faltan ' + bad.length + ' bloque(s) guardados en el teléfono: se piden de nuevo');
        buf.lastActivity = Date.now();
        self._sendNack(deviceId, msgId, self._findMissing(buf));
        return;
      }
      self._assembleAndDispatch(buf, deviceId, senderId, msgId);
    }, function() { buf._loading = false; });
  }
  _findGaps(buf) {
    var gaps = [];
    for (var i = 0; i < buf.maxIdx; i++) {
      if (!buf.chunks.has(i)) gaps.push(i);
    }
    return gaps;
  }
  _scheduleBlockAck(deviceId, msgId, buf) {
    var self = this;
    if (buf.received % ACK_EVERY === 0) {
      if (buf.ackTimer) { clearTimeout(buf.ackTimer); buf.ackTimer = null; }
      self._sendBlockAck(deviceId, msgId, buf);
      return;
    }
    if (buf.ackTimer) return;
    buf.ackTimer = setTimeout(function() {
      buf.ackTimer = null;
      if (self.incomingBuffers.get(msgId) === buf) self._sendBlockAck(deviceId, msgId, buf);
    }, ACK_DEBOUNCE_MS);
  }
  _findMissing(buf) {
    var missing = [];
    for (var i = 0; i < buf.total; i++) {
      if (!buf.chunks.has(i)) missing.push(i);
    }
    return missing;
  }
  _assembleAndDispatch(buf, deviceId, senderId, msgId) {
    var self = this;
    // 3007: parte de lo recibido está en el teléfono (bloques guardados) → traerlo primero (de bloque en bloque) y juntar después
    if (buf && buf.diskBlocks && buf.diskBlocks.size) {
      for (var iz = 0; iz < buf.total; iz++) { if (buf.chunks.get(iz) === null) { self._bigxLoadThenAssemble(buf, deviceId, senderId, msgId); return; } }
    }
    if (buf) buf._assembled = true;
    if (buf && (buf.bigx || self._bigxIn.has(msgId))) self._bigxForget(msgId);
    // #dueño 06-11 (paso 2b): archivo GRANDE por internet COMPLETO → suelto el «mantenerme despierto» (lo había tomado
    // _sendBlockAck). Si por algo no llegáramos acá (transferencia muerta), el nativo lo suelta igual por su tope duro.
    try { if (buf && !buf.isChat && _isNetDevice(deviceId) && buf.total > NET_TOR_PREFER_CHUNKS && self.ble && self.ble.net && typeof self.ble.net.xferKeepAwake === 'function') self.ble.net.xferKeepAwake(false); } catch (e) {}
    var assembled = '';
    for (var i = 0; i < buf.total; i++) {
      assembled += buf.chunks.has(i) ? buf.chunks.get(i) : '';
    }
    self.incomingBuffers.delete(msgId);
    // Ronda 2767 (revisión): la confirmación final sale cuando ya se ha podido descifrar. Antes salía al juntar los
    // trozos: si no se podía descifrar, se perdía y el emisor lo daba por entregado. Mientras se descifra, los trozos
    // repetidos no se confirman; si no se puede, se olvida y el emisor lo reintenta (o lo marca como no enviado)
    var entry = { total: buf.total, expireAt: Date.now() + COMPLETED_TTL_MS, pending: true };
    self.completedMessages.set(msgId, entry);
    var finalAck = function(ok) {
      if (self.completedMessages.get(msgId) !== entry) return;
      if (!ok) { self.completedMessages.delete(msgId); return; }
      entry.pending = false;
      self._sendFinalAck(deviceId, msgId, buf.total);
    };
    // Jump: va para otro teléfono → hacer de puente (no se muestra ni se descifra aquí)
    var relay = self.ble && self.ble.relay;
    if (relay && buf.meta.dst && relay.onStreamComplete(buf.isChat ? 'chat' : 'file', msgId, assembled, buf.meta, deviceId)) { finalAck(true); return; }
    // v3.11.0: remitente sellado: abrir antes de seguir
    if (String(buf.meta.fr || '').indexOf('sx:') === 0) {
      self._unsealFrom(buf).then(function() {
        if (buf.meta.badSeal) { finalAck(true); return; }
        self._finishAssembly(buf, deviceId, buf.meta.fr, msgId, assembled, finalAck);
      }, function() { finalAck(false); });
      return;
    }
    self._finishAssembly(buf, deviceId, senderId, msgId, assembled, finalAck);
  }
  _finishAssembly(buf, deviceId, senderId, msgId, assembled, finalAck) {
    var self = this, called = false;
    var done = function(ok) {
      if (called) return; // una sola vez (un fallo después de leerlo no lo deshace)
      called = true;
      if (finalAck) finalAck(ok);
      // Llegó por otro teléfono: confirmación de extremo a extremo al origen (ronda 2767: cuando ya se pudo leer)
      if (ok && buf.meta.hp > 0 && buf.meta.fr) self.sendAck(deviceId, msgId, buf.meta.fr);
    };
    if (buf.isChat) {
      self._dispatchChunkedMessageComplete(senderId, assembled, buf.meta, deviceId, msgId, done);
    } else {
      self._dispatchFileComplete(msgId, assembled, buf.meta, done);
      self._dispatchFileProgress(msgId, buf.total, buf.total, 'received', 100);
    }
  }
  _sendNack(deviceId, msgId, indices) {
    var ranges = _compressRanges(indices);
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'n', m: msgId, r: ranges, bf: 1 });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }
  _sendBlockAck(deviceId, msgId, buf) {
    // #dueño 06-11 (LATIDO de vuelta): si estoy RECIBIENDO un archivo por internet, al confirmar un bloque le devuelvo el
    // «toque» FCM al que ENVÍA para que su app tampoco se duerma a mitad del envío → los dos se mantienen despiertos
    // hasta terminar. net_link lo throttlea a 1 cada 15 s (bucket propio), así que es barato aunque confirme muchos
    // bloques; en un envío sano (los dos despiertos) el toque extra es inofensivo. Solo archivos por net (no textos/BT).
    if (buf && !buf.isChat && _isNetDevice(deviceId) && this.ble && this.ble.net && typeof this.ble.net.wakeKeepAlive === 'function') {
      try { var _nxKa = this._resolveNexoId(deviceId); if (_nxKa) this.ble.net.wakeKeepAlive(_nxKa); } catch (e) {}
      // #dueño 06-11: si lo que recibo es un archivo GRANDE por internet, arranco Tor a demanda (no hace nada si lo apagué)
      // para que se forme el Tor directo con el que envía (él también lo prefiere) → los 25 MB viajan por Tor, no por relés.
      try { if (buf.total > NET_TOR_PREFER_CHUNKS && typeof this.ble.net.ensureTor === 'function') this.ble.net.ensureTor(); } catch (e) {}
      // #dueño 06-11 (paso 2b): y le pido al nativo que me mantenga despierto de corrido (wakelock + Wi-Fi) mientras dura
      // el envío largo, para no dormirme con la pantalla apagada. Se re-toma en cada bloque (se renueva); se suelta al
      // completar el archivo (_assembleAndDispatch) y, por las dudas, el nativo tiene un tope duro de seguridad.
      try { if (buf.total > NET_TOR_PREFER_CHUNKS && typeof this.ble.net.xferKeepAwake === 'function') this.ble.net.xferKeepAwake(true); } catch (e) {}
    }
    var received = [];
    for (var i = 0; i < buf.total; i++) {
      if (buf.chunks.has(i)) received.push(i);
    }
    var ranges = _compressRanges(received);
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ba', m: msgId, r: ranges, n: buf.total, bf: 1 });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }
  _sendFinalAck(deviceId, msgId, total) {
    var ranges = (total <= 1) ? '0' : '0-' + (total - 1);
    var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ba', m: msgId, r: ranges, n: total, f: 1, bf: 1 });
    if (this.ble && this.ble._sendMessageNative) {
      this.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
    }
  }
  _handleNack(msg) {
    var msgId = msg.m;
    var indices = [];
    if (msg.r) {
      indices = _decompressRanges(msg.r);
    } else {
      indices = msg.k || [];
    }
    var stream = this.outgoingStreams.get(msgId);
    if (stream && msg.bf) this.markBin(stream.deviceId);
    if (stream) stream.handleNack(indices);
  }
  _handleBlockAck(msg) {
    var msgId = msg.m || msg.msgId;
    var total = msg.n || 0;
    var isFinal = msg.f === 1;
    var stream = this.outgoingStreams.get(msgId);
    if (!stream) return;
    if (msg.bf) this.markBin(stream.deviceId);
    stream.lastAckAt = Date.now(); stream._downWaitMs = 0;
    if (isFinal) {
      console.log('[BleAckSystem] handleFinalAck msgId=' + msgId);
      stream.handleFinalAck();
      return;
    }
    var ackedIndices = [];
    if (msg.r) {
      ackedIndices = _decompressRanges(msg.r);
    } else if (typeof msg.b === 'string' && msg.b.length > 0) {
      for (var i = 0; i < Math.min(msg.b.length, stream.total); i++) {
        if (msg.b.charAt(i) === '1') ackedIndices.push(i);
      }
    } else if (typeof msg.b === 'number') {
      var bitmap = msg.b;
      for (var i = 0; i < stream.total; i++) {
        if (bitmap & (1 << i)) ackedIndices.push(i);
      }
    }
    for (var i = 0; i < ackedIndices.length; i++) {
      var idx = ackedIndices[i];
      if (idx >= 0 && idx < stream.total) stream.ackedMask[idx] = true;
    }
    var oldWindowStart = stream.windowStart;
    while (stream.windowStart < stream.total && stream.ackedMask[stream.windowStart]) {
      stream.windowStart++;
    }
    if (stream.windowStart !== oldWindowStart) {
      console.log('[BleAckSystem] windowStart avanzo: ' + oldWindowStart + ' -> ' + stream.windowStart);
      // v3.3.2: progreso de envío (cada 5 %) para la burbuja propia
      var pctOut = Math.floor(stream.windowStart * 100 / stream.total);
      if (stream.type === 'file' && !stream.meta.fwd && pctOut < 100 && (typeof stream._lastPct !== 'number' || pctOut - stream._lastPct >= 5)) {
        stream._lastPct = pctOut;
        this._dispatchFileProgress(msgId, stream.windowStart, stream.total, 'sending', pctOut);
      }
    }
    if (stream.windowStart < stream.total) {
      var windowEnd = Math.min(stream.windowStart + stream.windowSize, stream.total);
      var missingInWindow = [];
      for (var i = stream.windowStart; i < windowEnd; i++) {
        if (!stream.ackedMask[i]) missingInWindow.push(i);
      }
      // v3.3.0: lo no confirmado de la ventana suele seguir en vuelo; los huecos reales llegan por
      // NACK y las pérdidas por timeout de ventana. Antes se reenviaba aquí: retransmisiones espurias.
    }
    var sentAllAcked = stream._windowResolve && stream._windowEndAtSend > stream._windowStartAtSend;
    for (var w = stream._windowStartAtSend; sentAllAcked && w < stream._windowEndAtSend; w++) {
      if (!stream.ackedMask[w]) sentAllAcked = false;
    }
    if (sentAllAcked && stream.windowStart < stream.total) {
      // v3.3.0: ventana confirmada => seguir ya (antes esperaba al timeout de 3-8 s por ventana)
      if (stream.timer) { clearTimeout(stream.timer); stream.timer = null; }
      var res = stream._windowResolve;
      stream._windowResolve = null;
      stream._windowReject = null;
      res();
    }
    // 3005: el otro volvió a confirmar durante el «sondeo» → ritmo normal ya (no esperar al minuto del sondeo)
    if (stream._probing) {
      stream._probing = false; stream.windowRetryCount = 0;
      console.log('[BleAckSystem] El otro volvió a confirmar: sigo al ritmo normal msgId=' + msgId);
      if (!stream.aborted && stream._windowResolve && stream.windowStart < stream.total) {
        if (stream.timer) { clearTimeout(stream.timer); stream.timer = null; }
        stream._retransmitWindow();
      }
    }
    if (stream.windowStart >= stream.total) {
      console.log('[BleAckSystem] Mensaje completo, finalizando msgId=' + msgId);
      if (stream.timer) clearTimeout(stream.timer);
      stream._finish();
    }
  }
  _handleLegacyChunkAck(msg) {
    var msgId = msg.m;
    var isFinal = msg.f === 1;
    var stream = this.outgoingStreams.get(msgId);
    if (!stream) return;
    if (isFinal) {
      stream.handleFinalAck();
      return;
    }
    var mask = msg.r || '';
    for (var i = 0; i < Math.min(mask.length, stream.total); i++) {
      if (mask.charAt(i) === '1') stream.ackedMask[i] = true;
    }
    while (stream.windowStart < stream.total && stream.ackedMask[stream.windowStart]) {
      stream.windowStart++;
    }
    if (stream.timer) clearTimeout(stream.timer);
    if (stream.windowStart >= stream.total) {
      stream._finish();
    } else if (stream._windowResolve) {
      stream._windowResolve();
      stream._windowResolve = null;
      stream._windowReject = null;
    }
  }
  // Auditoría M6 (2998): «ss»/«sr» llegan SIN firmar. Una «ss» falsa de un desconocido hacía reenviar los propios mensajes (ya cifrados) y
  // revelaba el último número de secuencia. Ahora solo se atiende si el NEXO ID que dice ser coincide con el DUEÑO CONOCIDO de ese enlace
  // (el que ya resolvió el flujo de enlace: Wi-Fi/internet por su id, Bluetooth por el mapa MAC→NEXO ID); si no, se ignora.
  _syncFromLinkOwner(deviceId, claimed) {
    var linkNx = this._resolveNexoId(deviceId);
    var ok = !!claimed && /^nx[0-9a-z]{8}$/.test(String(linkNx || '')) && _normId(claimed) === _normId(linkNx);
    if (!ok) console.log('[BleAckSystem] Sync ignorado: quien lo manda (' + (claimed || '?') + ') no es el dueño conocido de este enlace');
    return ok;
  }
  _handleSessionSync(deviceId, msg) {
    var self = this;
    var peerLastSeq = msg.l || 0;
    var peerNexoId = msg.fr || msg.from;
    if (!self._syncFromLinkOwner(deviceId, peerNexoId)) return;
    var myLastSeq = 0;
    if (window.vaultLoadMessages && peerNexoId) {
      window.vaultLoadMessages(peerNexoId).then(function(msgs) {
        if (msgs && msgs.length > 0) {
          myLastSeq = _maxSeqFromPeer(msgs);
        }
        var resp = JSON.stringify({ v: PROTOCOL_VERSION, t: 'sr', fr: (self.ble && self.ble.localNexoId) || 'unknown', l: myLastSeq });
        if (self.ble && self.ble._sendMessageNative) {
          self.ble._sendMessageNative(deviceId, resp, null).catch(function(){});
        }
      }).catch(function(){});
    }
  }
  _handleSessionSyncResponse(deviceId, msg) {
    var self = this;
    var peerLastSeq = msg.l || 0;
    var peerNexoId = msg.fr || msg.from;
    if (!peerNexoId || !window.vaultLoadMessages) return;
    if (!self._syncFromLinkOwner(deviceId, peerNexoId)) return;
    window.vaultLoadMessages(peerNexoId).then(function(msgs) {
      if (!msgs) return;
      // v3.3.1: peerLastSeq es el mayor seq NUESTRO que el otro tiene (antes mezclaba los contadores de
      // ambos teléfonos y dejaba sin reenviar). Se reenvía lo propio sin confirmar: pendiente/fallido
      // siempre; 'sent' (sin ack) si su seq es mayor que lo que el otro tiene. Máx. 7 días y 50 mensajes.
      var cutoff = Date.now() - 7 * 86400000;
      // Ronda 2767: lo pendiente lo manda la vuelta de reenvíos del contacto (una sola a la vez y en orden); antes esta
      // lista lo mandaba también, a la vez que ella. Aquí solo lo que salió (✓) y el otro dice no tener
      var bi = self.ble;
      if (bi && typeof bi._resendPendingMessages === 'function') bi._resendPendingMessages(peerNexoId);
      var pending = msgs.filter(function(m) {
        if (m._own !== true || m.attachmentType || (m.timestamp || 0) < cutoff) return false;
        var mid = m.msgId || m.messageId;
        if (bi && typeof bi._isMsgInFlight === 'function' && bi._isMsgInFlight(mid)) return false;
        if (self.isDone(mid)) return false;
        return m.status === 'sent' && (m.seq || 0) > peerLastSeq;
      }).slice(-50);
      if (pending.length === 0) return;
      console.log('[BleAckSystem] Sync: reenviando', pending.length, 'mensajes faltantes a', peerNexoId);
      var idx = 0;
      function sendNext() {
        if (idx >= pending.length) return;
        var m = pending[idx++];
        var txt = m.content || m.text || '';
        // Ronda 2766: son mensajes del chat de ese contacto: van a él (si la conexión es de otro, no salen)
        if (txt.length <= 150) {
          self.sendWithRetry(deviceId, txt, m.msgId, m.seq, { to: peerNexoId }).then(sendNext).catch(sendNext);
        } else {
          self.sendChunkedMessage(deviceId, txt, { to: peerNexoId }, m.msgId, m.seq).then(sendNext).catch(sendNext);
        }
      }
      sendNext();
    }).catch(function(){});
  }
  sendSessionSync(deviceId, peerNexoId) {
    var self = this;
    var myLastSeq = 0;
    if (window.vaultLoadMessages) {
      window.vaultLoadMessages(peerNexoId).then(function(msgs) {
        myLastSeq = _maxSeqFromPeer(msgs);
        var payload = JSON.stringify({ v: PROTOCOL_VERSION, t: 'ss', fr: (self.ble && self.ble.localNexoId) || 'unknown', l: myLastSeq });
        if (self.ble && self.ble._sendMessageNative) {
          self.ble._sendMessageNative(deviceId, payload, null).catch(function(){});
        }
      }).catch(function(){});
    }
  }
  // ===== v3.4.0: E2E =====
  _contactOf(deviceId, dst) {
    var nx = _normId(dst || this._resolveNexoId(deviceId));
    var cs = (this.ble && typeof this.ble.getBLEContacts === 'function') ? this.ble.getBLEContacts() : [];
    for (var i = 0; i < cs.length; i++) if (_normId(cs[i].nexoId || cs[i].deviceUUID) === nx) return cs[i];
    return null;
  }
  // Clave para cifrar a este contacto (null si no hay, o si cambió y el usuario aún no la aceptó)
  _peerKey(deviceId, dst) {
    var c = this._contactOf(deviceId, dst);
    return (c && c.publicKey && !c.pendingKey) ? c.publicKey : null;
  }
  // Con qué cifrar para este contacto: { nx, key, proto } o null. Con protocolo 2 hace falta su paquete de
  // claves (o una sesión); nunca se vuelve al 1 con quien ya tiene el 2.
  _target(deviceId, dst) {
    var c = this._contactOf(deviceId, dst);
    if (!c || !c.publicKey || c.pendingKey) return null;
    var nx = _normId(c.nexoId || c.deviceUUID);
    if (c.proto === 2) return ratchetCanEncrypt(nx, c.publicKey) ? { nx: nx, key: c.publicKey, proto: 2 } : null;
    return { nx: nx, key: c.publicKey, proto: 1 };
  }
  _outAd(t, id) { return e2eOuterAd(this.ble && this.ble.localNexoId, t.nx, id); }
  _inAd(from, id) { return e2eOuterAd(from, this.ble && this.ble.localNexoId, id); }
  // Destino para cifrar; si falta su clave (o su paquete del protocolo 2) se pide (kx) y se espera hasta 5 s.
  // to: el contacto al que va (directo). Ronda 2766 (revisión: el arreglo de la 2764 no bastaba): se cifra para él y
  // solo si la conexión es suya; si resulta ser de otro, ni se cifra ni se manda (queda pendiente). Antes se cifraba
  // para quien dijera la conexión: un archivo para el S24 salía cifrado para el Vivo y el Vivo lo leía.
  _ensurePeerKey(deviceId, dst, to) {
    to = _nxOf(to) || null; // solo un NEXO ID (no una dirección)
    var self = this, who = dst || to || null;
    if (to && !dst && self.ble && typeof self.ble._destNx === 'function') {
      var owner = self.ble._destNx(deviceId);
      if (owner && owner !== _normId(to)) {
        console.warn('[SEND] No se cifra para ' + _normId(to) + ' por la conexión de ' + owner + ': queda pendiente');
        var ew = new Error('La conexión es de otro contacto: queda pendiente'); ew.code = 'PEER_ABSENT';
        return Promise.reject(ew);
      }
    }
    var k = self._target(deviceId, who);
    if (k) return Promise.resolve(k);
    var c = self._contactOf(deviceId, who);
    if (c && c.pendingKey) {
      // Clave cambiada sin aceptar: no se cifra para la nueva (podría ser un impostor) ni para la vieja
      var ek = new Error('La clave del contacto cambió: acéptala en el chat para enviar');
      ek.code = 'NO_KEY';
      return Promise.reject(ek);
    }
    // Destino por otro teléfono: la clave se pide de extremo a extremo (kx dirigido), no al puente
    if (dst && self.ble && typeof self.ble._sendKxRouted === 'function') self.ble._sendKxRouted(dst, true);
    else if (self.ble && typeof self.ble._sendKx === 'function') self.ble._sendKx(deviceId, true);
    return new Promise(function(resolve, reject) {
      var t0 = Date.now();
      (function poll() {
        var key = self._target(deviceId, who);
        if (key) return resolve(key);
        if (Date.now() - t0 > 5000) {
          var e = new Error('Sin clave de cifrado del contacto');
          e.code = 'NO_KEY';
          console.warn('[E2E] Sin clave pública de ' + (who || self._resolveNexoId(deviceId)) + ': el mensaje queda pendiente');
          return reject(e);
        }
        setTimeout(poll, 250);
      })();
    });
  }
  // Mientras se espera la clave y se cifra, el id cuenta como en vuelo (si no, un reenvío simultáneo lo
  // mandaba otra vez)
  _preparingFor(id, promise) {
    var self = this;
    if (!id) return promise;
    self.preparing.add(id);
    var done = function() { self.preparing.delete(id); };
    promise.then(done, done);
    return promise;
  }
  // 'ok' | 'hold' (clave distinta de la del contacto: retener hasta que el usuario decida) | 'drop'
  // (protocolo 1 de quien ya usa el 2)
  _checkSender(nexoId, r) {
    if (this.ble && typeof this.ble._checkSender === 'function') return this.ble._checkSender(nexoId, r.senderKey, r.proto);
    return 'ok';
  }
  _hold(nexoId, release, id) {
    if (this.ble && typeof this.ble._quarantine === 'function') this.ble._quarantine(nexoId, release, id);
  }
  // opts.dst: destino final (Jump) si deviceId es un puente
  sendWithRetry(deviceId, content, messageId, seq, opts) {
    var self = this;
    var dst = opts && opts.dst, to = opts && opts.to;
    if (content && content.length > 150 && !e2eAnyEncrypted(content)) {
      return self.sendChunkedMessage(deviceId, content, dst ? { dst: dst } : (to ? { to: to } : {}), messageId, seq);
    }
    var mid = messageId || _newMsgId();
    // Ronda 2766: a quién va (el 'dn' del paquete), fijado desde ya para este id
    if (_nxOf(to) && !dst && self.ble) { self.ble._msgDest = self.ble._msgDest || new Map(); self.ble._msgDest.set(mid, _nxOf(to)); }
    if (!e2eAvailable() || e2eAnyEncrypted(content)) return self._sendWithRetryRaw(deviceId, content, mid, seq, dst);
    // Ronda 2767: si ya se está mandando (cifrándose o esperando su confirmación), se espera con ese envío
    if (self._chatPrep.has(mid)) return self._chatPrep.get(mid);
    var pend = self.pendingAcks.get(mid);
    if (pend && !pend.raw) return self._sendWithRetryRaw(deviceId, content, mid, seq, dst);
    var t0 = Date.now();
    var p = self._preparingFor(mid, self._ensurePeerKey(deviceId, dst, to)
      .then(function(t) { return e2eSealText(t, content, self._outAd(t, mid)); }))
      .then(function(enc) { return self._sendWithRetryRaw(deviceId, enc, mid, seq, dst, { t0: t0, seal: Date.now() - t0 }); });
    self._chatPrep.set(mid, p);
    var clear = function() { if (self._chatPrep.get(mid) === p) self._chatPrep.delete(mid); };
    p.then(clear, clear);
    return p;
  }
  // Jump: un puente reenvía un paquete tal cual y espera la confirmación del siguiente salto
  sendRawWithRetry(deviceId, packet, msgId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var entry = { msgId: msgId, deviceId: deviceId, content: packet, raw: true, quiet: true,
        resolve: resolve, reject: reject, retries: 0, timer: null, sentAt: Date.now() };
      var prev = self.pendingAcks.get(msgId);
      if (prev) { clearTimeout(prev.timer); prev.reject(new Error('reemplazado')); }
      self.pendingAcks.set(msgId, entry);
      self._doSend(entry);
    });
  }
  // 'rk': el puente guardó el mensaje (✓ enviado; ✓✓ cuando confirme el destino)
  handleCustody(msgId) {
    var entry = msgId && this.pendingAcks.get(msgId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pendingAcks.delete(msgId);
    entry.resolve();
    if (!entry.quiet) this._dispatchStatus(msgId, 'sent');
  }
  // Un ack de extremo a extremo que pasa por este puente confirma también su salto
  resolveHopQuiet(msgId) {
    var entry = msgId && this.pendingAcks.get(msgId);
    if (!entry || !entry.quiet) return;
    clearTimeout(entry.timer);
    this.pendingAcks.delete(msgId);
    entry.resolve();
  }
  // timing: { t0, seal } para el diagnóstico (cuánto tarda cada texto y en qué)
  _sendWithRetryRaw(deviceId, content, messageId, seq, dst, timing) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var msgId = messageId || ('msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6));
      // Ronda 2767 (revisión): si ese mismo mensaje ya está esperando su confirmación, se espera con él. Antes se
      // pisaba su entrada sin parar su temporizador: los reintentos se gastaban el doble de rápido y quien lo mandó
      // primero se quedaba esperando para siempre (y con él el resto de su lista de pendientes)
      var prev = self.pendingAcks.get(msgId);
      if (prev && !prev.raw) {
        var r0 = prev.resolve, j0 = prev.reject;
        prev.resolve = function(v) { r0(v); resolve(v); };
        prev.reject = function(e) { j0(e); reject(e); };
        return;
      }
      var entry = {
        msgId: msgId, deviceId: deviceId, content: content, dst: dst || null,
        resolve: resolve, reject: reject, retries: 0, timer: null, sentAt: Date.now(),
        t0: (timing && timing.t0) || Date.now(), seal: (timing && timing.seal) || 0, outMs: 0
      };
      self.pendingAcks.set(msgId, entry);
      self._dispatchStatus(msgId, 'sending');
      self._doSend(entry);
    });
  }
  _doSend(entry) {
    var self = this;
    if (!entry.quiet) self._dispatchStatus(entry.msgId, 'sending');
    if (!self.ble || typeof self.ble._sendMessageNative !== 'function') {
      entry.reject(new Error('BLE no disponible'));
      self.pendingAcks.delete(entry.msgId);
      return;
    }
    var delay = SHORT_MSG_BACKOFF_DELAYS[Math.min(entry.retries, SHORT_MSG_BACKOFF_DELAYS.length - 1)];
    var sendP = entry.raw ? self.ble._sendRawNative(entry.deviceId, entry.content)
      : self.ble._sendMessageNative(entry.deviceId, entry.content, entry.msgId, undefined, entry.dst);
    var tOut = Date.now();
    sendP
      .then(function() {
        if (!entry.outMs) entry.outMs = Date.now() - tOut;
        entry.timer = setTimeout(function() { self._onAckTimeout(entry.msgId); }, delay);
      })
      .catch(function(err) {
        if (entry.retries < self.maxRetries) {
          entry.retries++;
          console.warn('[BleAckSystem] Envio nativo fallo msgId=' + entry.msgId + ', reintento ' + entry.retries + '/' + self.maxRetries);
          setTimeout(function() { self._doSend(entry); }, delay);
        } else {
          self.pendingAcks.delete(entry.msgId);
          entry.reject(err);
          // Ronda 2767: si es que se espera a un camino (Wi-Fi cortado, contacto ausente), pendiente y no "!"
          var waiting = err && (err.code === 'LAN_DOWN' || err.code === 'PEER_ABSENT' || err.code === 'NO_KEY');
          if (!entry.quiet) self._dispatchStatus(entry.msgId, waiting ? 'pending' : 'failed');
        }
      });
  }
  _onAckTimeout(msgId) {
    var entry = this.pendingAcks.get(msgId);
    if (!entry) return;
    if (entry.retries < this.maxRetries) {
      entry.retries++;
      console.log('[BleAckSystem] ACK timeout msgId=' + msgId + ' reintento ' + entry.retries + '/' + this.maxRetries);
      this._doSend(entry);
    } else {
      this.pendingAcks.delete(msgId);
      entry.reject(new Error('ACK timeout'));
      if (!entry.quiet) this._dispatchStatus(msgId, 'failed');
    }
  }
  processIncomingAck(content) {
    var self = this;
    var ack;
    try { ack = JSON.parse(content); } catch (e) { return false; }
    var ackMsgId = ack.msgId || ack.messageId || ack.id || null;
    if (!ackMsgId) return false;
    if (ack.type !== 'ack' && ack.type !== 'read_receipt') return false;
    // Auditoría C1 (ronda 2777): con un contacto moderno (protocolo 2) se exige que la confirmación venga firmada con
    // el secreto de la pareja; una confirmación sin firma válida (falsa) se ignora para no marcar "entregado"/"leído"
    // algo que quizá no llegó (si no, un tercero que supiera el msgId paraba los reintentos y el mensaje se perdía con
    // ✓✓). Con contactos de protocolo 1 o desconocidos se mantiene el comportamiento de antes (compatibilidad).
    var acker = _normId(ack.from);
    var c = this._contactOf(null, acker);
    if (c && c.proto === 2 && c.publicKey && !c.pendingKey && _ackRe.test(acker)) {
      var myNx = _normId(this.ble && this.ble.localNexoId);
      var fields = ack.type + '|' + ackMsgId + '|' + acker + '|' + myNx;
      e2eAckTag(c.publicKey, fields).then(function(exp) {
        if (ack.a && exp && _ctEq(String(ack.a), exp)) self._applyAck(ack, ackMsgId);
        else console.warn('[BleAckSystem] Confirmación sin firma válida de ' + acker + ' (' + ackMsgId + '): ignorada');
      }).catch(function() {});
      return true;
    }
    return this._applyAck(ack, ackMsgId);
  }
  // Aplica una confirmación ya aceptada (firmada, o de un contacto antiguo): dedup y marcar entregado/leído
  _applyAck(ack, ackMsgId) {
    try {
      // 3016: una confirmación del contacto quita la espera de reenvíos sin confirmar (ble_messages `_resendBackoff`)
      var bmap = this.ble && this.ble._resendBackoff, bnx = _normId(ack.from);
      // 3020: la confirmación de un mensaje oculto de PROTOCOLO (el pedido de diagnóstico emparejado) no prueba que lo
      // atascado ya pase: no quita la espera (si no, cada pedido daba una vuelta de reenvío de más; resendloop.js)
      var nbk = this.ble && this.ble._noBackoffAckIds, nbHit = !!(nbk && nbk.has(ackMsgId));
      if (nbHit) nbk.delete(ackMsgId);
      if (bmap && bnx && bmap.has(bnx) && !nbHit) { var bb = bmap.get(bnx), bble = this.ble; if (bb && bb.timer) clearTimeout(bb.timer); bmap.delete(bnx); setTimeout(function() { try { bble._resendPendingMessages(bnx); } catch (e) {} }, 300); }
      // FIX v3.2.13: dedup por tipo+id; antes el 'ack' de un mensaje hacía descartar su 'read_receipt'
      var ackKey = ack.type + ':' + ackMsgId;
      var entry = this.pendingAcks.get(ackMsgId);
      // v3.4.0: un ack repetido también resuelve un reenvío que lo espera (antes se descartaba y el
      // mensaje, ya entregado, acababa en rojo tras 5 reintentos)
      if (this.receivedAcks.has(ackKey) && !entry) return true;
      this.receivedAcks.add(ackKey);
      if (this.receivedAcks.size > this.maxReceivedAcks) {
        var first = this.receivedAcks.values().next().value;
        this.receivedAcks.delete(first);
      }
      var status = ack.type === 'read_receipt' ? 'read' : 'delivered';
      if (status === 'delivered' && this._blobOut && this._blobOut.size) this._blobCleanup(ackMsgId, ack.from); // Fase B/C: el archivo ya está en el otro teléfono (en grupo, en ESE miembro)
      // 3004 (investigación 11-11): un «leído» de un ARCHIVO propio que todavía no se entregó es el de su tarjeta de cita (mismo id;
      // los teléfonos con versiones anteriores lo siguen mandando): no lo da por leído ni por hecho. Antes lo marcaba ✓✓, dejaba de
      // reenviarse y, si la app se reiniciaba antes de entregarlo, se perdía en silencio.
      if (status === 'read' && !entry && !this._done.has(ackMsgId) && ack.from && typeof window.vaultLoadMessages === 'function') {
        var selfR = this;
        window.vaultLoadMessages(_normId(ack.from)).then(function(msgs) {
          var m = (msgs || []).find(function(x) { return (x.msgId || x.messageId || x.id) === ackMsgId; });
          if (m && m._own && (m.attachmentType || m.attachmentRef) && _readTooEarly(m.status)) {
            console.log('[BleAckSystem] «Leído» de ' + ackMsgId + ' ignorado: el archivo aún no se entregó (es el de su tarjeta de cita)');
            return;
          }
          selfR._dispatchStatus(ackMsgId, status);
        }).catch(function() { selfR._dispatchStatus(ackMsgId, status); });
        return true;
      }
      if (entry) {
        clearTimeout(entry.timer);
        this.pendingAcks.delete(ackMsgId);
        entry.resolve();
        if (!entry.quiet) this._dispatchStatus(ackMsgId, status);
        if (!entry.quiet && !entry.raw && entry.t0) {
          console.log('[SEND] Texto entregado en ' + (Date.now() - entry.t0) + ' ms (cifrar ' + entry.seal + ' ms, salir por Bluetooth ' +
            entry.outMs + ' ms, reintentos ' + entry.retries + ')');
        }
      } else {
        this._dispatchStatus(ackMsgId, status);
      }
      return true;
    } catch (e) { return false; }
  }
  // routeTo: origen de un mensaje que llegó por otro teléfono (Jump): el ack vuelve dirigido a él
  sendAck(deviceId, msgId, routeTo) { this._sendReceipt('ack', deviceId, msgId, routeTo); }
  sendReadReceipt(deviceId, msgId, routeTo) { this._sendReceipt('read_receipt', deviceId, msgId, routeTo); }
  // Auditoría C1 (ronda 2777): la confirmación se firma con el secreto de la pareja (si el contacto es proto 2 y hay
  // clave) para que el emisor pueda comprobar que es de verdad. `a` es un campo más: los contactos antiguos lo ignoran.
  _sendReceipt(type, deviceId, msgId, routeTo) {
    var self = this, myNx = (this.ble && this.ble.localNexoId) || 'unknown';
    var obj = { v: 1, type: type, msgId: msgId, from: myNx, ts: Date.now() };
    var target = _normId(routeTo) || _normId(this._resolveNexoId(deviceId));
    var out = function() {
      if (routeTo) { obj.to = String(routeTo).toLowerCase(); self._sendRouted(obj, deviceId); return; }
      if (self.ble && self.ble._sendMessageNative) self.ble._sendMessageNative(deviceId, JSON.stringify(obj), null).catch(function() {});
    };
    var c = this._contactOf(deviceId, routeTo);
    if (c && c.proto === 2 && c.publicKey && !c.pendingKey && _ackRe.test(target)) {
      e2eAckTag(c.publicKey, type + '|' + msgId + '|' + _normId(myNx) + '|' + target).then(function(a) { if (a) obj.a = a; out(); }).catch(out);
    } else out();
  }
  _sendRouted(obj, fallbackDeviceId) {
    var relay = this.ble && this.ble.relay;
    // v3.11.0: en sobre sellado para el destino si lo entiende (el puente no ve de quién es la confirmación)
    if (relay && this.ble && typeof this.ble._sealObj === 'function') {
      this.ble._sealObj(obj.to, obj).then(function(o) { relay.sendRouted(o); }).catch(function() { relay.sendRouted(obj); });
      return;
    }
    if (relay) { relay.sendRouted(obj); return; }
    if (fallbackDeviceId && this.ble && this.ble._sendMessageNative) this.ble._sendMessageNative(fallbackDeviceId, JSON.stringify(obj), null).catch(function(){});
  }
  // Jump: un puente reenvía un flujo completo (texto largo o archivo) tal cual hacia el siguiente salto
  forwardStream(deviceId, msgId, data, meta, kind) {
    var self = this;
    var running = self.outgoingStreams.get(msgId);
    if (running && !running.aborted && running._promise) return running._promise;
    var fm = Object.assign({}, meta, { fwd: true });
    if (typeof fm.seq !== 'number') fm.seq = 0;
    var stream = new ChatStream(self, deviceId, msgId, data, fm, kind === 'chat' ? 'chat' : 'file');
    self.outgoingStreams.set(msgId, stream);
    stream._promise = stream.start();
    return stream._promise.then(function() { self.outgoingStreams.delete(msgId); },
      function(err) { self.outgoingStreams.delete(msgId); throw err; });
  }
  _processBlockAck(msg) {
    var transferId = msg.transferId;
    var tx = this.pendingOutgoingTransfers.get(transferId);
    if (!tx) return;
    var mask = msg.receivedMask || '';
    for (var i = 0; i < Math.min(mask.length, tx.total); i++) { tx.ackMask[i] = mask.charAt(i) === '1'; }
    if (tx.ackMask.every(function(v){return v;})) { this._completeLegacyTransfer(transferId); }
  }
  _completeLegacyTransfer(transferId) {
    var tx = this.pendingOutgoingTransfers.get(transferId);
    if (!tx) return;
    this.pendingOutgoingTransfers.delete(transferId);
    if (!tx.legacy) { tx.resolve(); this._dispatchStatus(transferId, 'delivered'); }
  }
  cancelFileSend(fileId) {
    var tx = this.outgoingStreams.get(fileId) || this.pendingOutgoingTransfers.get(fileId);
    if (tx && tx.contactNexoId && window.vaultSetOutgoingStatus) window.vaultSetOutgoingStatus(tx.contactNexoId, fileId, 'cancelled').catch(function(){});
    this.outgoingStreams.delete(fileId);
    this.pendingOutgoingTransfers.delete(fileId);
    this.pendingOutgoingFiles.delete(fileId);
    this._dispatchFileProgress(fileId, 0, 0, 'cancelled');
  }
  resumeOutgoingTransfers() {
    var self = this;
    if (!window.vaultGetPendingOutgoingTransfers) return;
    // 3003 (diagnóstico automático S24 build 3001, 11-11 03:42: la app arrancó 3 veces en 1 min con un APK de 25 MB pendiente para tres
    // contactos): cada «Reenviando pending para X» y cada evento de enlace llamaba aquí, y esto recorre TODOS los contactos leyendo el
    // almacén de transferencias (trozos base64 de los archivos grandes, ~450–750 ms cada lectura): N reenvíos × 21 contactos en segundos →
    // memoria del WebView → reinicio. Se juntan las llamadas: como mucho un escaneo a la vez y como mínimo RESUME_SCAN_GAP_MS entre
    // escaneos; las llamadas intermedias se reducen a UN escaneo pendiente que corre al final (nada se pierde, solo se agrupa).
    var nowS = Date.now();
    var gap = RESUME_SCAN_GAP_MS - (nowS - (self._resumeScanAt || 0));
    if (self._resumeScanBusy || gap > 0) {
      if (!self._resumeScanTimer) {
        self._resumeScanTimer = setTimeout(function() { self._resumeScanTimer = null; self.resumeOutgoingTransfers(); }, Math.max(gap, 250));
      }
      return;
    }
    self._resumeScanAt = nowS;
    self._resumeScanBusy = true;
    var scans = [];
    var contacts = (self.ble && typeof self.ble.getBLEContacts === 'function') ? self.ble.getBLEContacts() : [];
    contacts.forEach(function(contact) {
      var cid = _normId(contact.nexoId);
      if (!cid) return;
      scans.push(window.vaultGetPendingOutgoingTransfers(cid).then(function(list) {
        if (!list || list.length === 0) return;
        return self._dropDeliveredTransfers(cid, list);
      }).then(function(list) {
        if (!list || list.length === 0) return;
        console.log('[BleAckSystem] Resume:', list.length, 'outgoing para', cid);
        // #CRASH 02-11: NO arrancar todas a la vez — encolar y reanudar como mucho MAX_RESUME_CONCURRENT a la vez.
        list.forEach(function(tx) {
          if (tx.status !== 'sending' && tx.status !== 'pending') return;
          // dedup: si ya está en vuelo (un ChatStream real) o ya encolada, no la metas otra vez (resumeOutgoingTransfers
          // se llama en cada evento de enlace; sin esto se recreaba el enjambre en cada reconexión)
          if (self.outgoingStreams.has(tx.transferId) || self._resumeSeen.has(tx.transferId)) return;
          self._resumeSeen.add(tx.transferId);
          self._resumeQueue.push({ cid: cid, tx: tx, contactDeviceId: contact.deviceId });
        });
        self._pumpResume();
      }).catch(function(){}));
    });
    Promise.all(scans).then(function() { self._resumeScanBusy = false; }, function() { self._resumeScanBusy = false; });
  }
  // #CRASH 02-11: arrancar hasta MAX_RESUME_CONCURRENT reanudaciones a la vez; al terminar una, entra la siguiente.
  _pumpResume() {
    var self = this;
    var max = (typeof window !== 'undefined' && Number(window.NEXO_MAX_RESUME)) || MAX_RESUME_CONCURRENT;
    while (self._resumeActive < max && self._resumeQueue.length > 0) {
      var job = self._resumeQueue.shift();
      self._resumeActive++;
      (function(j) {
        var done = function() {
          self._resumeActive--;
          self._resumeSeen.delete(j.tx.transferId);
          self._pumpResume();
        };
        var p;
        try { p = self._resumeRunOne(j); } catch (e) { p = null; }
        if (p && typeof p.then === 'function') p.then(done, done); else done();
      })(job);
    }
  }
  // #dueño 07-11 (lentitud BT): ¿aplazar AHORA un respaldo de fondo (Fénix)? Sí si el usuario tiene la radio (app en PRIMER
  // PLANO) o si el enlace del destino está atascado/muerto (_bleCongested). Así un respaldo no compite con el usuario ni
  // martilla un enlace malo, ni siquiera al REANUDAR. No aplica a lo del usuario (texto/foto/archivo). En el simulador y si
  // falta la señal de primer plano, _foreground es undefined → no aplaza (el respaldo corre).
  _fenixDeferNow(deviceId) {
    var ble = this.ble;
    if (!ble) return false;
    if (ble._foreground === true) return true;
    return !!(typeof ble._bleCongested === 'function' && ble._bleCongested(deviceId));
  }
  // Reanuda UNA transferencia: resuelve el mejor camino de AHORA y reconstruye el contenido perezosamente (no todas de
  // golpe). Devuelve la promesa del envío (o null si no hay camino). El registro se borra al entregarse.
  _resumeRunOne(job) {
    var self = this, cid = job.cid, tx = job.tx, contactDeviceId = job.contactDeviceId;
    // v3.10.0: por el mejor camino de ahora (Wi-Fi, Bluetooth); el guardado puede ser un Wi-Fi que ya no está
    var content = tx.chunks.map(function(c) { return (typeof c === 'string') ? c : (c.data || c.d || ''); }).join('');
    var isFileTx = tx.type === 'file';   // FIX: respetar tx.type (una foto/vídeo interrumpido no se reenvía como texto plano)
    // #dueño 06-11: un archivo grande (> tope de Bluetooth) prefiere internet/Wi-Fi antes que un Bluetooth listo (si no,
    // se arrastra por BT y no llega: un APK de 25 MB = 148 mil trozos). preferNet solo para archivos grandes.
    var bigFile = isFileTx && content.length > BLE_FILE_MAX_CHARS;
    var best = (self.ble && typeof self.ble._resolveDeviceIdForNexoId === 'function') ? self.ble._resolveDeviceIdForNexoId(cid, bigFile) : null;
    var devId = best || tx.deviceId || contactDeviceId;
    if (_isLanDevice(devId) && !(self.ble && self.ble.lan && self.ble.lan.canReach(cid))) devId = contactDeviceId;
    // Por internet: texto/medios en línea; archivos por Tor/Wi-Fi (filesOk) o al buzón de los relés (mailboxOk)
    var net = self.ble && self.ble.net;
    // 2970: un archivo por internet solo con el contacto EN LÍNEA (canReach); el buzón de relés no sirve para un flujo con
    // ventanas de confirmación (ver _sendFileBest). Los ≤ 5 MB a un ausente van por el buzón de archivos desde el reenvío de pendientes.
    if (_isNetDevice(devId) && !(net && typeof net.canReach === 'function' && net.canReach(cid) && (tx.type === 'file' ? (net.filesOk(cid) || net.mailboxOk(cid)) : true))) devId = contactDeviceId;
    if (!devId) return null;
    // #dueño 09-11 (diagnóstico S24 12:15, APK de 35 MB a la tablet por Bluetooth): un archivo que NO cabe por Bluetooth y cuyo
    // único camino de AHORA es un Bluetooth queda ⏳ SIN sellarlo ni partirlo (antes: sendFile lo sellaba entero para que
    // ChatStream lo aplazara igual, en CADA reanudación → memoria y CPU en cada vuelta). Lo re-rutea el evento de enlace
    // (Wi-Fi/internet) como hasta ahora; un puente Jump (fwd) no aplica (ChatStream tampoco lo aplaza).
    if (bigFile && !_isNetDevice(devId) && !_isLanDevice(devId) && !(tx.meta && tx.meta.fwd)) { console.log('[BleAckSystem] ' + tx.transferId + ': archivo grande, no cabe por Bluetooth: espera Wi-Fi/internet (sin sellar ni partir)'); return null; }
    // #dueño 07-11 (lentitud BT): NO reanudar un respaldo de fondo (Fénix) si el usuario tiene la radio (app en primer plano)
    // o si el enlace del destino está atascado/muerto. Se queda PENDIENTE (como «sin camino») y se reintenta cuando convenga; la
    // redundancia de Fénix cubre el respaldo. Tapa el hueco del diagnóstico: la REANUDACIÓN saltaba el freno que el respaldo ya
    // respeta al elegir (2951/2952). Solo afecta a Fénix: lo del usuario (texto/foto/archivo) se reanuda siempre.
    if ((tx.type === 'fenix' || (tx.meta && tx.meta.type === 'fenix')) && self._fenixDeferNow(devId)) return null;
    // Ronda 2766: a quién va (es su chat): si la conexión resulta ser de otro, no sale por ella
    var txMeta = Object.assign({}, tx.meta || {}, (tx.meta && tx.meta.dst) ? {} : { to: cid });
    var resumePromise = isFileTx
      ? self.sendFile(devId, tx.transferId, content, txMeta)
      : self.sendChunkedMessage(devId, content, txMeta, tx.transferId, (tx.meta && tx.meta.seq));
    return resumePromise.then(function() {
      if (window.vaultRemoveOutgoingTransfer) window.vaultRemoveOutgoingTransfer(cid, tx.transferId).catch(function(){});
    });
  }
  // v3.4.0: hasta la 2701 el registro de una transferencia terminada no se borraba y al abrir la app o
  // reconectar se volvían a enviar textos largos, fotos y vídeos ya entregados (hasta 50). Los que ya
  // constan como entregados en el historial (o HD enviado) se borran aquí sin reenviarlos.
  _dropDeliveredTransfers(cid, list) {
    if (!window.vaultLoadMessages) return Promise.resolve(list);
    return window.vaultLoadMessages(cid).catch(function() { return []; }).then(function(msgs) {
      var byId = {};
      (msgs || []).forEach(function(m) { var id = m.msgId || m.messageId || m.id; if (id) byId[id] = m; });
      return list.filter(function(tx) {
        var isHd = /_hd$/.test(tx.transferId);
        var m = byId[isHd ? tx.transferId.replace(/_hd$/, '') : tx.transferId];
        var done = !!m && (isHd ? m.hdStatus === 'sent' : (m.status === 'delivered' || m.status === 'read'));
        if (done && window.vaultRemoveOutgoingTransfer) window.vaultRemoveOutgoingTransfer(cid, tx.transferId).catch(function(){});
        return !done;
      });
    });
  }
  // done(ok): ronda 2767, si se pudo leer (la confirmación final espera a esto)
  // wasE2e: ronda 2768, el texto ya viene descifrado (llegó cifrado de extremo a extremo)
  _dispatchChunkedMessageComplete(senderId, content, meta, deviceId, msgId, done, wasE2e) {
    var self = this;
    if (e2eAnyEncrypted(content)) {
      var from = meta.fr || senderId;
      e2eOpenText(from, content, self._inAd(from, msgId)).then(function(r) {
        if (done) done(true);
        if (r.dup) return;
        var go = function() { self._dispatchChunkedMessageComplete(senderId, r.text, meta, deviceId, msgId, null, true); };
        var v = self._checkSender(from, r);
        if (v === 'drop') return;
        if (v === 'hold') { self._hold(from, go, msgId); return; }
        go();
      }).catch(function(e) {
        if (e && e.code === 'DUP') { if (done) done(true); return; }
        console.warn('[E2E] No se pudo descifrar el mensaje ' + msgId + ':', e && e.message);
        if (done) done(false);
      });
      return;
    }
    if (done) done(true);
    // Ronda 2768 (seguridad): sin cifrar y dice ser de un contacto: lo escribió otro (ver ble_messages._prePayload)
    if (!wasE2e && self._plainFromContact(meta.fr || senderId)) { console.warn('[E2E] Texto largo sin cifrar que dice ser de ' + _normId(meta.fr || senderId) + ': descartado'); return; }
    try {
      window.dispatchEvent(new CustomEvent('nexo:ble:messageReceived', {
        detail: {
          deviceId: meta.hp > 0 ? null : deviceId, deviceUUID: meta.fr || senderId,
          content: content, senderName: meta.f || 'NEXO',
          senderNexoId: meta.fr || senderId, messageId: msgId || meta.msgId,
          source: 'ble', timestamp: meta.rxTs || meta.ts || Date.now(), seq: meta.seq || 0, e2e: !!wasE2e
          // FIX v3.2.13: sin fromVault; con fromVault main.js no lo guardaba y se perdía si el chat estaba cerrado
        }
      }));
    } catch (e) {}
  }
  _dispatchStatus(msgId, status) {
    if (msgId && (status === 'delivered' || status === 'read')) {
      this._done.set(msgId, Date.now());
      if (this._done.size > 3000) this._done.delete(this._done.keys().next().value);
    }
    try { window.dispatchEvent(new CustomEvent('nexo:ble:ackStatus', { detail: { msgId: msgId, status: status } })); } catch (e) {}
  }
  // Ronda 2767: ya confirmado en esta sesión (un reenvío que arrancó antes no lo vuelve a mandar)
  isDone(msgId) { return !!msgId && this._done.has(msgId); }
  // P6 (dueño 01-11): el MISMO mensaje llegó ENTERO por otro camino (internet/Jump/BLE corto). Cierra un reensamblado BLE
  // que quedó a medias con ese msgId para que NO caduque a los 120 s con un «Assembly timeout» (y un falso «fallo» de un
  // mensaje que SÍ llegó). Lo llama ble_messages.onPayloadReceived al recibir/deduplicar un mensaje completo. Devuelve true
  // si había un reensamblado que cerrar.
  dropAssembly(msgId) {
    if (!msgId) return false;
    var buf = this.incomingBuffers.get(msgId);
    if (!buf) return false;
    if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
    if (buf.ackTimer) clearTimeout(buf.ackTimer);
    this.incomingBuffers.delete(msgId);
    console.log('[BleAckSystem] reensamblado de ' + msgId + ' cerrado: el mensaje llegó entero por otro camino');
    return true;
  }
  _dispatchFileProgress(fileId, sent, total, status, percent, extra) {
    try { window.dispatchEvent(new CustomEvent('nexo:ble:fileProgress', { detail: Object.assign({ fileId: fileId, sent: sent, total: total, status: status, percent: percent || 0, direction: 'out' }, extra || {}) })); } catch (e) {}
  }
  // v3.3.2: progreso de recepción (cada 5 %) para mostrar "Recibiendo foto… N%" mientras llega
  _reportIncomingProgress(msgId, buf, status) {
    if (buf.isChat || buf.meta.type === 'fenix') return;
    if (String(buf.meta.fr || '').indexOf('sx:') === 0) { this._unsealFrom(buf); return; } // aún sellado: se abre
    var me = _normId(this.ble && this.ble.localNexoId);
    if (buf.meta.dst && _normId(buf.meta.dst) !== me) return; // de paso (Jump): no es para este teléfono
    var pct = status === 'failed' ? 0 : Math.floor(buf.received * 100 / buf.total);
    if (status !== 'failed' && (pct >= 100 || (typeof buf.lastPct === 'number' && pct - buf.lastPct < 5))) return;
    buf.lastPct = pct;
    this._dispatchFileProgress(msgId, buf.received, buf.total, status || 'receiving', pct, {
      direction: 'in', senderNexoId: buf.meta.fr, fileType: buf.meta.type, mime: buf.meta.mime,
      name: e2eAnyEncrypted(buf.meta.name) ? undefined : buf.meta.name, hdFor: buf.meta.hdFor
    });
  }
  // Ronda 2768: ¿algo sin cifrar que dice ser de un contacto? (lo suyo siempre llega cifrado: lo escribió otro)
  _plainFromContact(fr) {
    return !!(this.ble && typeof this.ble._isKnownSender === 'function' && this.ble._isKnownSender(fr));
  }
  // wasE2e: ronda 2768, el archivo ya viene descifrado
  _dispatchFileComplete(fileId, data, meta, done, wasE2e) {
    var self = this;
    if (e2eAnyEncrypted(data)) {
      var dm = Object.assign({}, meta || {});
      var from = dm.fr || dm.senderNexoId || dm.fromNexoId;
      Promise.all([
        e2eOpenToB64(from, data, self._inAd(from, fileId)),
        e2eAnyEncrypted(dm.thumb) ? e2eOpenToB64(from, dm.thumb, self._inAd(from, fileId + '#t')).then(function(t) { return t.b64; }, function() { return null; }) : dm.thumb,
        e2eAnyEncrypted(dm.name) ? e2eOpenText(from, dm.name, self._inAd(from, fileId + '#n')).then(function(t) { return t.text; }, function() { return null; }) : dm.name
      ]).then(function(r) {
        if (done) done(true);
        if (r[0].dup) return;
        dm.thumb = r[1] || null;
        dm.name = r[2] || undefined;
        var go = function() { self._dispatchFileComplete(fileId, r[0].b64, dm, null, true); };
        var v = self._checkSender(from, r[0]);
        if (v === 'drop') return;
        if (v === 'hold') { self._hold(from, go, fileId); return; }
        go();
      }).catch(function(e) {
        if (e && e.code === 'DUP') { if (done) done(true); return; }
        console.warn('[E2E] No se pudo descifrar el archivo ' + fileId + ':', e && e.message);
        if (done) done(false);
      });
      return;
    }
    if (done) done(true);
    try {
      var m = meta || {};
      var sender = m.senderNexoId || m.fromNexoId || m.fr || null;
      if (!wasE2e && self._plainFromContact(sender)) { console.warn('[E2E] Archivo sin cifrar que dice ser de ' + _normId(sender) + ': descartado'); return; }
      // Fénix: fragmentos y respuestas de recuperación (no son mensajes del chat)
      if (m.type === 'fenix') { if (self.ble && self.ble.fenix) self.ble.fenix.onFile(fileId, data, m, sender); return; }
      if (self.ble && typeof self.ble._citaResolved === 'function') self.ble._citaResolved(fileId); // Fase D (2972): si había un marcador de cita, se cumplió
      window.dispatchEvent(new CustomEvent('nexo:ble:fileComplete', {
        detail: {
          fileId: fileId,
          data: data,
          meta: m,
          senderNexoId: sender
        }
      }));
    } catch (e) {}
  }
  _startCleanupInterval() {
    var self = this;
    setInterval(function() {
      var now = Date.now();
      self.incomingBuffers.forEach(function(buf, msgId) {
        if (now - buf.lastActivity > Math.max(self.maxFragmentAge, _assemblyTimeoutFor(_isNetDevice(buf.deviceId), buf.isChat, buf.total))) {
          if (buf.assemblyTimer) clearTimeout(buf.assemblyTimer);
          self.incomingBuffers.delete(msgId);
        }
      });
      // Ronda 2767 (revisión): por inactividad (10 min sin confirmaciones), no por el tiempo desde el principio: un vídeo
      // HD o un archivo grande por un Bluetooth lento se cortaba a los 10 min aunque avanzara (se quedaba en "○ 44%")
      self.outgoingStreams.forEach(function(stream, msgId) {
        var idleMax = (stream.type === 'file' && _isNetDevice(stream.deviceId) && stream.total >= NET_BIG_MIN_CHUNKS) ? NET_BIG_IDLE_MS : self.maxFragmentAge * 2; // 3005
        if (now - (stream.lastAckAt || stream.startTime) > idleMax) { stream.abort(); self.outgoingStreams.delete(msgId); }
      });
      self.pendingAcks.forEach(function(entry, msgId) {
        if (now - entry.sentAt > self.maxFragmentAge) { clearTimeout(entry.timer); self.pendingAcks.delete(msgId); try { entry.reject(new Error('Timeout global')); } catch(e) {} }
      });
      self.completedMessages.forEach(function(data, msgId) {
        if (now > data.expireAt) self.completedMessages.delete(msgId);
      });
    }, 30000);
  }
}
function ChatStream(ackSystem, deviceId, msgId, content, meta, type) {
  this.ackSystem = ackSystem;
  this.ble = ackSystem.ble;
  this.deviceId = deviceId;
  this.msgId = msgId;
  this.content = content;
  this.meta = meta;
  var isFile = type === 'file';
  this.chunkSize = isFile ? FILE_CHUNK_SIZE : CHAT_CHUNK_SIZE;
  this.windowSize = isFile ? FILE_WINDOW_SIZE : CHAT_WINDOW_SIZE;
  this.windowTimeoutMs = isFile ? FILE_WINDOW_TIMEOUT_MS : CHAT_WINDOW_TIMEOUT_MS;
  // v3.3.0: ajustar al MTU negociado. El nativo escribe trozos de (MTU-13) caracteres, uno cada
  // 40-80 ms; con MTU pequeño un paquete grande ocupa muchas escrituras y la ventana debe ser menor
  // y esperar más (si no, timeouts espurios y la cola nativa de 500 se llena y descarta).
  var mtu = (this.ble && typeof this.ble.getMtu === 'function') ? this.ble.getMtu(deviceId) : 0;
  // v3.10.0: por Wi-Fi (misma red) trozos grandes: no hay MTU ni escrituras de 20-500 bytes
  if (_isLanDevice(deviceId) || _isNetDevice(deviceId)) mtu = LAN_PSEUDO_MTU;
  // v3.14.0 (ronda 2757): el nativo escribe (MTU - 3) bytes reales por escritura (máx. 512), no MTU - 13 caracteres
  var perWrite = mtu ? Math.min(Math.max(mtu - 3, 20), 512) : 0;
  var overhead = 90; // cabecera JSON de un trozo ('v','t','m','i','n','d')
  if (_isLanDevice(deviceId)) { this.chunkSize = isFile ? LAN_FILE_CHUNK : LAN_CHAT_CHUNK; perWrite = this.chunkSize + overhead; }
  if (_isNetDevice(deviceId)) { this.chunkSize = isFile ? NET_FILE_CHUNK : NET_CHAT_CHUNK; perWrite = this.chunkSize + overhead; }
  // Trozos grandes aunque ocupen 2-3 escrituras (menos paquetes y acks); solo se reducen si un
  // paquete necesitaría más de 3 escrituras (MTU pequeño). Medido: MTU 247 => 18 s/foto con 360
  // frente a 27 s ajustando a una sola escritura.
  if (!perWrite) this.chunkSize = Math.min(this.chunkSize, 200);
  else if (Math.ceil((this.chunkSize + overhead) / perWrite) > 3) this.chunkSize = Math.max(SMALL_MTU_MIN_CHUNK(), 3 * perWrite - overhead);
  this.writesPerPacket = perWrite ? Math.ceil((this.chunkSize + overhead) / perWrite) : 2;
  if (this.writesPerPacket > 2) this.windowSize = Math.min(this.windowSize, 4);
  this.windowTimeoutMs = Math.max(this.windowTimeoutMs, this.windowSize * this.writesPerPacket * 100 + 3000);
  // v3.13.0: en binario caben 4/3 más caracteres de base64 en las mismas escrituras (múltiplo de 4)
  this.bin = isFile && perWrite > 0 && !(meta && meta.dst) && ackSystem.peerBin(deviceId) && !!(this.ble && typeof this.ble._sendBinaryNative === 'function');
  if (this.bin) this.chunkSize = Math.max(60, Math.floor((this.writesPerPacket * perWrite - overhead - 7) * 4 / 3 / 4) * 4);
  if (this.bin) console.log('[BIN] ' + msgId + ' en binario: MTU ' + mtu + ', trozos de ' + this.chunkSize + ' caracteres');
  this.pacingDelayMs = isFile ? FILE_PACING_DELAY_MS : CHAT_PACING_DELAY_MS;
  this.baseTimeoutMs = isFile ? GLOBAL_TIMEOUT_MS : 45000;
  this.type = type || 'chat';
  // #dueño 05-11: un ARCHIVO grande es "bulk" (cede la radio a lo interactivo). Texto, foto, sticker, voz y vídeo-previa
  // son interactivos (tienen prioridad). Umbral por tamaño del contenido.
  this._bulk = (this.type === 'file') && (typeof content === 'string') && content.length > INTERACTIVE_MAX_CHARS;
  this._yieldSince = 0;
  this.chunks = [];
  this.total = 0;
  this.sentMask = [];
  this.ackedMask = [];
  this.windowStart = 0;
  this.resolve = null;
  this.reject = null;
  this.timer = null;
  this.startTime = Date.now();
  this.aborted = false;
  this.windowRetryCount = 0;
  this.maxWindowRetries = MAX_WINDOW_RETRIES;
  this.globalTimeout = null;
  this.globalTimeoutMs = this.baseTimeoutMs;
  // Ronda 2767: marca de este intento en cada trozo ('a'): otro intento del mismo mensaje va cifrado distinto y el
  // receptor no debe mezclar sus trozos
  this.att = (meta && typeof meta._att === 'string' && meta._att) ? meta._att : Math.random().toString(36).substr(2, 3); // 3007: al seguir un envío guardado, la MISMA marca
  this._windowResolve = null;
  this._windowReject = null;
  this._windowStartAtSend = 0;
  this._windowEndAtSend = 0;
  if (isFile) {
    console.log('[ChatStream] MODO ARCHIVO. chunk=' + this.chunkSize + ' window=' + this.windowSize + ' pacing=' + this.pacingDelayMs + 'ms');
  }
}
// v3.10.0: el enlace cambió a mitad (Wi-Fi caído → Bluetooth): los trozos ya están hechos (el receptor espera esos),
// así que se adapta el ritmo: ventana pequeña y esperas largas (un trozo de Wi-Fi son muchas escrituras Bluetooth)
// Ronda 2767: ¿sus trozos son demasiado grandes para ese enlace Bluetooth? (más de 100 escrituras por trozo: con MTU 23,
// un trozo de Wi-Fi tarda más de los 10 s que el nativo del otro espera a completarlo)
ChatStream.prototype.tooBigFor = function(deviceId) {
  if (_isLanDevice(deviceId) || _isNetDevice(deviceId)) return false;
  var mtu = (this.ble && typeof this.ble.getMtu === 'function') ? this.ble.getMtu(deviceId) : 0;
  var perWrite = mtu ? Math.min(Math.max(mtu - 3, 20), 512) : 20;
  // 3022 (prueba del dueño 12-11: un respaldo de Fénix siguió por Bluetooth con trozos de Wi-Fi de 24 000 letras —~48 escrituras
  // cada uno, por debajo del umbral de 100— y tapó el Bluetooth ~40 s: los textos de los dos lados sin confirmar). Un trozo que
  // necesita más de BT_RECHUNK_WRITES escrituras se rehace a la medida del Bluetooth (entre trozo y trozo pasan los textos).
  return Math.ceil((this.chunkSize + 90) / perWrite) > BT_RECHUNK_WRITES;
};
ChatStream.prototype.useLink = function(deviceId) {
  this.deviceId = deviceId;
  if (_isLanDevice(deviceId) || _isNetDevice(deviceId)) return;
  var mtu = (this.ble && typeof this.ble.getMtu === 'function') ? this.ble.getMtu(deviceId) : 0;
  var perWrite = mtu ? Math.min(Math.max(mtu - 3, 20), 512) : 20;
  this.writesPerPacket = Math.ceil((this.chunkSize + 90) / perWrite);
  if (this.writesPerPacket > 3) {
    this.windowSize = Math.max(1, Math.min(this.windowSize, Math.floor(300 / this.writesPerPacket) || 1)); // cola nativa: 500
    this.windowTimeoutMs = Math.max(this.windowTimeoutMs, this.windowSize * this.writesPerPacket * 60 + 5000);
  }
  console.log('[ChatStream] ' + this.msgId + ' sigue por Bluetooth: ventana ' + this.windowSize + ', espera ' + this.windowTimeoutMs + ' ms');
};
// #87 (diagnóstico del dueño 28-10): ¿el enlace de este stream está ARRIBA ahora mismo? Si está caído (p. ej. el otro
// teléfono con el GATT roto que se reconecta a cada rato, o el Wi-Fi que parpadea), una ventana que caduca NO es que el
// receptor rechace: es que no hay por dónde. En ese caso no se gasta un reintento del tope (que abortaría el archivo).
// Sesgo seguro: ante la duda devuelve true (cuenta el reintento, como antes); solo devuelve false cuando el enlace se ve
// claramente caído. El límite real sigue siendo el timeout global (60 s sin ningún ACK) y la limpieza por inactividad.
ChatStream.prototype._linkUp = function() {
  try {
    var ble = this.ble, dev = this.deviceId;
    if (!ble || !dev) return true;
    // Solo se aplica a Wi-Fi local (lan:) e internet (net:), que es donde se vio el problema del dueño (foto por
    // lan:nx09acdb61, vídeo/imagen por net:nx0ed4a8be) y donde la señal de «caído» es fiable (canReach/online). Para
    // Bluetooth crudo NO se toca el flujo: ya tiene su propia resiliencia (_sendFailed → PEER_ABSENT → queda pendiente
    // y se reanuda al volver el camino); meter aquí connectedDevices daba falsos «caído» y colgaba transferencias BLE.
    // #124 (build 2840, informe del dueño: un archivo a un contacto offline por internet no se enviaba y storm-
    // retransmitía). Antes esto preguntaba net.online() = «¿tengo YO internet?» → con el contacto APAGADO el enlace
    // parecía arriba, la ventana reintentaba hasta el tope y fallaba. Ahora pregunta net.canReach(nx) = «¿está el
    // CONTACTO en línea?» (p.up, visto hace <150 s), igual que el camino Wi-Fi de abajo. Contacto ausente → enlace
    // «caído» → la ventana ESPERA sin tormenta ni gastar reintentos; los trozos ya quedan en el buzón de relés y, al
    // conectarse el contacto (_netUp → resumeOutgoingTransfers), fluyen los ACKs y se entrega (store-and-forward).
    if (_isNetDevice(dev)) {
      if (!(ble.net && typeof ble.net.canReach === 'function')) return true;
      var nxn = this.ackSystem && this.ackSystem._resolveNexoId ? this.ackSystem._resolveNexoId(dev) : null;
      return ble.net.canReach(nxn);
    }
    if (_isLanDevice(dev)) {
      var nx = this.ackSystem && this.ackSystem._resolveNexoId ? this.ackSystem._resolveNexoId(dev) : null;
      return !(ble.lan && typeof ble.lan.canReach === 'function') || ble.lan.canReach(nx);
    }
    return true; // Bluetooth y cualquier otro: comportamiento de siempre
  } catch (e) { return true; }
};
// #dueño 02-11 (B2): ¿este archivo es GRANDE y el único camino de ahora es un Bluetooth de MTU MÍNIMO? Entonces NO lo
// arranques (martillaría la cola nativa minutos/horas): déjalo pendiente y espera un camino mejor. Devuelve true =
// aplazar. Solo Bluetooth crudo (net:/lan:/Wi-Fi Direct no tienen cola MTU-23); solo archivos; nunca reenvíos (fwd).
ChatStream.prototype._shouldDeferTinyMtu = function() {
  try {
    if (this.type !== 'file') return false;
    var dev = this.deviceId;
    if (_isNetDevice(dev) || _isLanDevice(dev)) return false;        // Wi-Fi/internet: sin cola MTU-23 → nunca aplazar
    if (this.meta && this.meta.fwd) return false;                    // reenvío/puente Jump: no aplica
    // #dueño 06-11 (diagnóstico: un APK de 25 MB se fue por un Bluetooth SANO = 148 550 trozos y no llegó nunca): un
    // archivo DEMASIADO GRANDE para Bluetooth (> BLE_FILE_MAX_CHARS) NO se manda por Bluetooth, tenga el MTU que tenga.
    // Queda ⏳ pendiente SIEMPRE y espera Wi-Fi/internet (el resolvedor, con preferNet, lo re-rutea por ahí). La app ya
    // considera «> tope BLE» como demasiado grande para Bluetooth; antes solo frenaba el caso de MTU mínimo (≤50).
    if ((this.content ? this.content.length : 0) > BLE_FILE_MAX_CHARS) { try { this.ackSystem._mtuDeferSince.set(this.msgId, Date.now()); } catch (e) {} return true; }
    var ble = this.ble;
    var mtu = (ble && typeof ble.getMtu === 'function') ? ble.getMtu(dev) : 0;
    var tiny = (typeof window !== 'undefined' && Number(window.NEXO_TINY_MTU)) || TINY_MTU;
    // #dueño 05-11 (diagnóstico de 2 teléfonos: un archivo de 34 MB se fue por Bluetooth MTU 23 y tapó la cola para TODO
    // —textos, fotos, ACKs—). El MTU se negocia unas décimas DESPUÉS de arrancar sendFile, así que acá getMtu devolvía 0
    // (desconocido) y la condición vieja `!(mtu>0 && mtu<=tiny)` daba return false → NO aplazaba → el archivote arrancaba
    // por MTU 23. Ahora: solo un MTU CONOCIDO y SANO (> tiny) se manda ya; MTU mínimo (≤tiny) O desconocido (0, aún sin
    // negociar) cae a la decisión de aplazar de abajo (y resumeOutgoingTransfers lo re-rutea por Wi-Fi/internet; si tras el
    // tope no aparece nada mejor, se intenta igual por Bluetooth: nunca se pierde).
    if (mtu > tiny) return false;                                    // MTU conocido y sano → comportamiento de siempre
    var big = (typeof window !== 'undefined' && Number(window.NEXO_BLE_DEFER_CHARS)) || BLE_TINY_MTU_DEFER_CHARS;
    if (!this.content || this.content.length <= big) return false;   // archivo chico (foto/preview): cabe por MTU 23 → se manda
    // Anti-inanición: esperar un rato por un camino mejor; si ya esperó bastante, intentar igual por Bluetooth (no perder)
    var waitMs = (typeof window !== 'undefined' && Number(window.NEXO_MTU_DEFER_MS)) || MTU_DEFER_MAX_WAIT_MS;
    var map = this.ackSystem._mtuDeferSince, since = map.get(this.msgId), now = Date.now();
    if (!since) { map.set(this.msgId, now); return true; }
    if (now - since < waitMs) return true;
    map.delete(this.msgId);                                          // ya esperó bastante → intentar por Bluetooth igual
    return false;
  } catch (e) { return false; }
};
ChatStream.prototype.start = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    // #dueño 06-11 (paso 2b, PAREJO con el receptor): el que ENVÍA un archivo GRANDE por internet también se mantiene
    // despierto de CORRIDO (candado + Wi-Fi, vía net.xferKeepAwake) para no dormirse a mitad del envío largo con la
    // pantalla apagada. Se toma abajo (ya con self.total, solo si es archivo grande por net) y se SUELTA pase lo que pase:
    // envuelvo resolve/reject —único modo en que la promesa termina— para liberarlo tanto en éxito como en fallo. El
    // nativo igual tiene un tope duro de 20 min por si algún camino raro no soltara. self._xferHeld lo comparte con el
    // renovado de _onWindowTimeout (envíos muy lentos > 20 min).
    var _releaseXfer = function () { if (!self._xferHeld) return; self._xferHeld = false; try { if (self.ble && self.ble.net && typeof self.ble.net.xferKeepAwake === 'function') self.ble.net.xferKeepAwake(false); } catch (e) {} };
    var _rs = resolve, _rj = reject;
    resolve = function (v) { _releaseXfer(); _rs(v); };
    reject = function (e) { _releaseXfer(); _rj(e); };
    self.resolve = resolve;
    self.reject = reject;
    self.lastAckAt = Date.now();
    // #dueño 07-11 (CRASH, diagnóstico S24 «se ralentizó hasta crashear tras un par de fotos y un vídeo»): un archivo
    // que NO va por Bluetooth (demasiado grande para BT, o MTU mínimo) y que se re-resolvía a un enlace Bluetooth se
    // PARTÍA en decenas de miles de trozos (_splitChunks; un APK de 35 MB = ~99 mil) ANTES de decidir aplazarlo, y eso
    // pasaba en CADA reintento (cada ~10 s) → partir + armar máscaras + persistir llenaba la memoria y tiraba la app.
    // Ahora se DECIDE aplazar ANTES de partir (_shouldDeferTinyMtu solo mira self.content, no los trozos): si aplaza, se
    // persiste el registro para reanudar con el CONTENIDO entero como UN solo trozo (barato; resumeOutgoingTransfers lo
    // re-rutea por Wi-Fi/internet y parte con chunk grande por el camino bueno) y se rechaza, SIN partir ni armar máscaras.
    if (self.type === 'file' && self._shouldDeferTinyMtu()) {
      self.aborted = true;
      // Persistir para reanudar por internet: el contenido entero como UN trozo (vaultCreateOutgoingTransfer devuelve el
      // existente si ya estaba → no duplica; el resume reconstruye el contenido uniendo los trozos, así que [content] basta).
      if (window.vaultCreateOutgoingTransfer && !self.meta.fwd && !/^cs[0-9a-f]{12}$/.test(self.msgId)) {
        var cidDefer = self.meta.dst || self.ackSystem._resolveNexoId(self.deviceId);
        try { window.vaultCreateOutgoingTransfer(cidDefer, self.msgId, self.type, 1, [self.content], self.meta, self.deviceId).catch(function(){}); } catch (e) {}
      }
      console.warn('[ChatStream] Archivo grande (' + (self.content ? self.content.length : 0) + ' b64) → ⏳ pendiente, no por Bluetooth (SIN partir); espero Wi-Fi/internet. msgId=' + self.msgId);
      self.ackSystem._dispatchStatus(self.msgId, 'pending');
      // #dueño 06-11: si YA hay internet/Wi-Fi para el contacto, re-rutear pronto por ahí (resumeOutgoingTransfers re-resuelve con preferNet).
      try {
        var cidBetter = (self.meta && self.meta.dst) ? self.meta.dst : self.ackSystem._resolveNexoId(self.deviceId);
        var netB = self.ble && self.ble.net, lanB = self.ble && self.ble.lan;
        // 2970 (diagnóstico del dueño S24 09-11, APK de 25 MB a la tablet por Bluetooth): «mejor camino» = el contacto EN LÍNEA
        // por internet (canReach) o por Wi-Fi. Con mailboxOk (= tengo internet y el contacto es de internet, esté o no) se
        // re-reanudaba cada segundo sin que hubiera camino → leía 35 MB del disco y armaba el base64 cada ~1,5 s (la
        // «ralentización» del diagnóstico). Ahora, sin camino real, queda ⏳ y lo despierta el evento de enlace (_netUp/_linkUp).
        var hasBetter = (netB && typeof netB.canReach === 'function' && netB.canReach(cidBetter)) || (lanB && lanB.canReach && lanB.canReach(cidBetter));
        if (hasBetter) setTimeout(function() { try { self.ackSystem.resumeOutgoingTransfers(); } catch (e) {} }, 1000);
      } catch (e) {}
      // El motivo SIEMPRE contiene «no cabe por Bluetooth» → send.js lo deja ⏳ pendiente (no ✗). Demasiado grande para BT
      // (cualquier MTU, el bug del APK) vs MTU mínimo/desconocido (B2, #dueño 02-11).
      var _tooBig = (self.content ? self.content.length : 0) > BLE_FILE_MAX_CHARS;
      reject(new Error('archivo grande no cabe por Bluetooth ' + (_tooBig ? '(demasiado grande)' : 'de MTU mínimo') + ' ahora: en espera de Wi-Fi/internet'));
      return;
    }
    self._splitChunks();
    if (self.total === 0) { reject(new Error('Vacio')); return; }
    if (self.type === 'file' && _isNetDevice(self.deviceId) && self.total > NET_TOR_PREFER_CHUNKS) {
      try { if (self.ble && self.ble.net && typeof self.ble.net.xferKeepAwake === 'function') { self.ble.net.xferKeepAwake(true); self._xferHeld = true; } } catch (e) {}
    }
    var estimatedWindows = Math.ceil(self.total / self.windowSize);
    var timeoutPerWindow = self.windowTimeoutMs * (MAX_WINDOW_RETRIES + 2);
    var baseTo = (self.type === 'file') ? FILE_GLOBAL_TIMEOUT_MS : self.baseTimeoutMs;
    self.globalTimeoutMs = Math.max(baseTo, estimatedWindows * timeoutPerWindow);
    // Cap razonable: 15 min max; archivos grandes (vídeo HD) hasta 60 min a un mínimo de ~1,5 KB/s
    var cap = (self.type === 'file') ? Math.min(3600000, Math.max(900000, Math.round(self.content.length / 1.5))) : 900000;
    if (self.globalTimeoutMs > cap) self.globalTimeoutMs = cap;
    console.log('[ChatStream] START msgId=' + self.msgId + ' type=' + self.type + ' totalChunks=' + self.total + ' totalWindows=' + estimatedWindows + ' timeout=' + self.globalTimeoutMs + 'ms');
    // Ronda 2768: una señal de llamada no se guarda para reanudarla (al reiniciar la app se reenviaba la oferta de una
    // llamada ya terminada)
    if (window.vaultCreateOutgoingTransfer && !self.meta.fwd && !/^cs[0-9a-f]{12}$/.test(self.msgId)) {
      var cid = self.meta.dst || self.ackSystem._resolveNexoId(self.deviceId);
      window.vaultCreateOutgoingTransfer(cid, self.msgId, self.type, self.total, self.chunks, self.meta, self.deviceId).catch(function(){});
    }
    // #dueño 02-11 (B2) + #dueño 07-11 (CRASH): la decisión de NO ir por Bluetooth (demasiado grande / MTU mínimo) ahora
    // se toma ARRIBA, ANTES de _splitChunks, para no partir decenas de miles de trozos al pedo en cada reintento. El
    // registro queda ⏳ pendiente y resumeOutgoingTransfers lo reenvía por Wi-Fi/internet; anti-inanición en _shouldDeferTinyMtu.
    var armGlobal = function(ms) {
      self.globalTimeout = setTimeout(function() {
        if (self.aborted) return;
        // Ronda 2767 (revisión): si sigue avanzando (confirmaciones en el último minuto) se le da más tiempo, hasta 2 h:
        // un vídeo HD o un archivo grande por un Bluetooth lento no terminaba nunca
        if (Date.now() - (self.lastAckAt || 0) < 60000 && Date.now() - self.startTime < 7200000) { armGlobal(300000); return; }
        // #124 (build 2840): el contacto está AUSENTE (sin camino; p. ej. apagado y solo por internet, net.canReach
        // falso). NO es un fallo: el archivo queda EN ESPERA (store-and-forward). Los trozos ya están en el buzón de
        // relés y, al conectarse el contacto (_netUp → resumeOutgoingTransfers) o al reabrir la app, se entrega. Se
        // marca 'pending' (⏳ «esperando», no ✗) y se re-chequea cada 5 min, hasta 2 h en memoria; luego se suelta
        // (queda persistido en el vault para reanudar). Antes se marcaba 'failed' y parecía perdido.
        if (!self._linkUp()) {
          if (!self.aborted) self.ackSystem._dispatchStatus(self.msgId, 'pending');
          if (Date.now() - self.startTime < 7200000) { armGlobal(300000); return; }
          self.abort(); reject(new Error('Contacto ausente: queda en espera')); return;
        }
        // #dueño 08-11: un archivo por INTERNET a un contacto ALCANZABLE no se marca ✗ ni pide «reintentar»: queda ⏳ y se
        // re-arma el tope; el bucle de ventanas sigue reintentando SOLO y renovando el despertador hasta que fluye. (ver
        // _netFileAutoRetry) Antes el timeout global lo marcaba 'failed' → botón de reintentar que el dueño tenía que tocar.
        if (self._netFileAutoRetryNow()) { if (!self.aborted) try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {} armGlobal(300000); return; }
        console.error('[ChatStream] GLOBAL TIMEOUT msgId=' + self.msgId);
        self.abort();
        reject(new Error('Timeout global ' + (self.type === 'file' ? '3min+' : '45s+')));
        self.ackSystem._dispatchStatus(self.msgId, 'failed');
      }, ms);
    };
    armGlobal(self.globalTimeoutMs);
    self._runWindowLoop();
  });
};
ChatStream.prototype._runWindowLoop = function() {
  var self = this;
  function next() {
    if (self.aborted) {
      console.log('[ChatStream] _runWindowLoop abortado msgId=' + self.msgId);
      return;
    }
    if (self.windowStart >= self.total) {
      console.log('[ChatStream] _runWindowLoop: windowStart >= total, finalizando msgId=' + self.msgId);
      self._finish();
      return;
    }
    // #dueño 05-11: PRIORIDAD — un archivo grande cede la radio a lo chico/interactivo que esté activo (foto/texto),
    // así la foto no espera detrás del archivo. Acotado a BULK_YIELD_MAX_MS seguidos: el archivo siempre avanza.
    if (self._bulk && BULK_PRIO() && self.ackSystem && self.ackSystem._interactiveActive(self.msgId)) {
      var nowY = Date.now();
      if (!self._yieldSince) self._yieldSince = nowY;
      if (nowY - self._yieldSince < BULK_YIELD_MAX_MS) { setTimeout(next, BULK_YIELD_STEP_MS); return; }
    } else if (self._yieldSince) { self._yieldSince = 0; }
    console.log('[ChatStream] _runWindowLoop: enviando ventana. windowStart=' + self.windowStart + ' msgId=' + self.msgId);
    self._sendWindow().then(function() {
      console.log('[ChatStream] _sendWindow RESUELTA. windowStart ahora=' + self.windowStart + ' msgId=' + self.msgId);
      self.windowRetryCount = 0;
      setTimeout(next, self.pacingDelayMs);
    }).catch(function(err) {
      console.warn('[ChatStream] _sendWindow RECHAZADA. retry=' + self.windowRetryCount + ' msgId=' + self.msgId);
      self.windowRetryCount++;
      if (self.windowRetryCount > self.maxWindowRetries) {
        self.abort();
        // #dueño 02-11 (diagnóstico coche: el archivo moría por BLE MTU 23 congestionado): un ARCHIVO que agota los
        // reintentos NO se marca ✗ ni se pierde — el registro sigue en el vault y resumeOutgoingTransfers lo reenvía
        // por el mejor camino cuando vuelva Wi-Fi/internet. Queda ⏳ 'pending'. El texto (chat) sí sigue 'failed'.
        self.ackSystem._dispatchStatus(self.msgId, self.type === 'file' ? 'pending' : 'failed');
        if (self.reject) self.reject(new Error('Max window retries'));
        return;
      }
      console.log('[ChatStream] Ventana fallo, reintentando. retry=' + self.windowRetryCount);
      setTimeout(next, 500 * self.windowRetryCount);
    });
  }
  next();
};
ChatStream.prototype._splitChunks = function() {
  var str = this.content;
  var size = this.chunkSize;
  var arr = [];
  var i = 0;
  // Chunk 0 lleva meta (fr, type, format…): limitar datos para no reventar MTU
  var firstChunkMax = (this.type === 'file') ? Math.min(size, 120) : Math.min(size, 200);
  // v3.13.0: en binario, un trozo termina justo donde empiezan los datos en base64 y los siguientes van alineados
  var body = this.bin ? _b64BodyStart(str) : -1;
  while (i < str.length) {
    var remaining = str.length - i;
    var chunkSize = (arr.length === 0) ? Math.min(firstChunkMax, remaining) : Math.min(size, remaining);
    var end = i + chunkSize;
    if (body > i && body < end) end = body;
    if (end < str.length &&
        str.charCodeAt(end - 1) >= 0xD800 && str.charCodeAt(end - 1) <= 0xDBFF &&
        str.charCodeAt(end) >= 0xDC00 && str.charCodeAt(end) <= 0xDFFF) {
      end--;
    }
    arr.push(str.substring(i, end));
    i = end;
  }
  this.chunks = arr;
  this.total = arr.length;
  this.sentMask = new Array(this.total).fill(false);
  this.ackedMask = new Array(this.total).fill(false);
  console.log('[ChatStream] _splitChunks: ' + this.total + ' chunks. chunk0=' + (this.chunks[0] ? this.chunks[0].length : 0) + ' chars, chunkN=' + (this.chunks[1] ? this.chunks[1].length : 0) + ' chars');
};
ChatStream.prototype._sendWindow = function() {
  var self = this;
  return new Promise(function(resolve, reject) {
    self._windowResolve = resolve;
    self._windowReject = reject;
    self._windowStartAtSend = self.windowStart;
    self._windowEndAtSend = Math.min(self.windowStart + self.windowSize, self.total);
    var end = self._windowEndAtSend;
    var myStart = self._windowStartAtSend;
    function sendNext(idx) {
      // v3.3.0: si la ventana ya se cerró por ack (y empezó otra), este envío termina aquí
      if (self._windowStartAtSend !== myStart) return;
      if (idx >= end || self.aborted) {
        var allAcked = true;
        for (var i = self._windowStartAtSend; i < self._windowEndAtSend; i++) {
          if (!self.ackedMask[i]) { allAcked = false; break; }
        }
        if (allAcked) {
          if (self.timer) clearTimeout(self.timer);
          console.log('[ChatStream] _sendWindow RESOLVIENDO (ventana completa) msgId=' + self.msgId);
          resolve();
        } else {
          console.log('[ChatStream] _sendWindow iniciando timer (esperando ACKs) msgId=' + self.msgId);
          self._startWindowTimer();
        }
        return;
      }
      if (self.ackedMask[idx]) {
        console.log('[ChatStream] Chunk ' + idx + ' ya acked, saltando msgId=' + self.msgId);
        setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
        return;
      }
      self.sentMask[idx] = true;
      self._sendChunk(idx)
        .then(function() {
          self._nativeFails = 0; self._busyWaits = 0; // pasó un trozo: la cola drena y el enlace va bien
          setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
        })
        .catch(function(err) {
          if (self.aborted) return;
          // #dueño 08-11: un respaldo Fénix de FONDO sobre un Bluetooth ya marcado atascado se rinde YA (queda pendiente),
          // sin seguir martillando la cola nativa ni tapar la radio del usuario. Antes de tratar la contrapresión.
          if (self._bgShouldYieldBle()) { self._giveUpPending(); return; }
          // #129 (dueño 01-11): «Cola de escritura llena» (BLE_BUSY) NO es fallo del enlace: es contrapresión de la cola
          // nativa (MTU 23). Esperar más y reintentar el MISMO trozo, SIN contar como fallo (no cambiar de camino ni abortar).
          if (self._isBusyErr(err)) {
            var wait = self._busyBackoff();
            if (wait < 0) { self._giveUpPending(); return; } // ~5 min saturado sin que pase un trozo: enlace muerto
            setTimeout(function() { sendNext(idx); }, wait);
            return;
          }
          if (self._sendFailed(idx, err)) setTimeout(function() { sendNext(idx); }, self._nativeFails > 10 ? 1000 : 200);
        });
    }
    sendNext(self.windowStart);
  });
};
// Un trozo no salió. true: reintentar (quizá por otro enlace); false: el envío queda pendiente (PEER_ABSENT)
ChatStream.prototype._sendFailed = function(idx, err) {
  var self = this;
  var fails = self._nativeFails = (self._nativeFails || 0) + 1;
  if (fails === 1 || fails % 20 === 0) console.warn('[ChatStream] Envio nativo fallo chunk', idx, err && err.message, '(' + fails + ')');
  // v3.10.0: el enlace ya no sirve (p. ej. Wi-Fi caído): seguir por el mejor camino de ahora. Antes se
  // reintentaba para siempre cada 200 ms por el mismo enlace.
  var bi = self.ble, nx = self._dn || self.ackSystem._resolveNexoId(self.deviceId);
  var wrong = err && err.code === 'WRONG_PEER';
  // #dueño 06-11: un archivo grande que falla por un enlace NO debe re-rutearse a otro Bluetooth (se arrastra en miles de
  // trozos); prefiere internet/Wi-Fi si el contacto es alcanzable por ahí.
  var bigFile = self.type === 'file' && self.content && self.content.length > BLE_FILE_MAX_CHARS;
  // 3022: un ARCHIVO a medias por Wi-Fi espera el margen del corte (regla del dueño 23-10: no cambia de camino por un pico);
  // al vencer, lan._giveUp → _lanDown lo pasa al otro camino (y se rehace a su medida si hace falta)
  if (self.type === 'file' && !wrong && _isLanDevice(self.deviceId) && bi && bi.lan && typeof bi.lan.inGrace === 'function' && bi.lan.inGrace(nx)) return true;
  var best = ((fails >= 3 || wrong) && bi && typeof bi._resolveDeviceIdForNexoId === 'function') ? bi._resolveDeviceIdForNexoId(nx, bigFile) : null;
  if (best && _normMac(best) !== _normMac(self.deviceId)) {
    if (self.tooBigFor(best)) { self.ackSystem._restartStream(self, self.msgId, best); return false; }
    self.useLink(best);
  }
  if (fails > 120 || (wrong && !best)) {
    // ~2 min sin poder enviar: queda pendiente y se reanuda al volver a haber camino
    self._giveUpPending();
    return false;
  }
  return true;
};
// #129 (dueño 01-11): ¿el trozo falló porque la cola nativa está llena (contrapresión), no por el enlace? (delegan en las
// funciones puras _isBusyErr/_busyBackoffMs, exportadas para la prueba busyback.js)
ChatStream.prototype._isBusyErr = function(err) { return _isBusyErr(err); };
// #129: espera escalonada ante la cola llena. Cuenta los reintentos SEGUIDOS sin que pase ningún trozo; pasado
// BUSY_MAX_WAITS (~5 min saturado) devuelve -1 = darse por saturado. Se reinicia a 0 al pasar un trozo.
ChatStream.prototype._busyBackoff = function() {
  var n = this._busyWaits = (this._busyWaits || 0) + 1;
  if (n === 1 || n % 50 === 0) console.warn('[ChatStream] Cola nativa llena (contrapresión) en ' + this.msgId + ' (' + n + ')');
  return _busyBackoffMs(n);
};
// #129: dejar el envío pendiente (se reanuda al volver a haber camino). Reutilizado por _sendFailed y por la contrapresión.
ChatStream.prototype._giveUpPending = function() {
  var self = this;
  var e = new Error('Contacto no disponible: queda pendiente'); e.code = 'PEER_ABSENT';
  var rej = self.reject; self.reject = null;
  self.abort();
  self.ackSystem.outgoingStreams.delete(self.msgId);
  if (rej) rej(e);
};
// #dueño 08-11: ¿este stream es un respaldo Fénix de FONDO sobre un Bluetooth atascado y debe rendir la radio YA? (ver
// _fenixYieldBle). Se consulta en el bucle de trozos para que un respaldo en vuelo no siga martillando un enlace que el
// nativo ya marcó muerto (_bleCongested). El usuario (no-Fénix) nunca entra acá.
ChatStream.prototype._bgShouldYieldBle = function() {
  var dev = this.deviceId;
  var isBle = !_isNetDevice(dev) && !_isLanDevice(dev);
  var cong = false;
  try { cong = !!(this.ble && typeof this.ble._bleCongested === 'function' && this.ble._bleCongested(dev)); } catch (e) {}
  return _fenixYieldBle(this.meta && this.meta.type, isBle, cong);
};
// #dueño 08-11: ¿este archivo por INTERNET debe seguir reintentando SOLO (sin pedir «reintentar» al usuario)? Sí mientras el
// contacto siga alcanzable (_linkUp = canReach) y no se pase el presupuesto. Consultado en los dos puntos donde antes
// abortaba / marcaba ✗ (ver _netFileAutoRetry).
ChatStream.prototype._netFileAutoRetryNow = function() {
  try {
    return _netFileAutoRetry(this.type, _isNetDevice(this.deviceId), this._linkUp(),
      Date.now() - (this.startTime || Date.now()), NET_FILE_AUTORETRY_BUDGET_MS);
  } catch (e) { return false; }
};
// v3.13.0: binario si se puede (no el trozo 0, que lleva los datos del archivo y la miniatura); si no, JSON
ChatStream.prototype._sendChunk = function(idx) {
  var d = this.chunks[idx];
  // Ronda 2764: la conexión resultó ser de otro (ver _remapDevice): no seguir por ella
  if (this._dn && this.ble && typeof this.ble._destNx === 'function') {
    var cur = this.ble._destNx(this.deviceId);
    if (cur && cur !== this._dn) { var ew = new Error('la conexión es de otro contacto'); ew.code = 'WRONG_PEER'; return Promise.reject(ew); }
  }
  if (this.bin && idx > 0 && this.ackSystem.peerBin(this.deviceId) && _binOk(d)) {
    var head = JSON.parse(this._buildChunk(idx));
    delete head.d;
    var self = this;
    return this.ble._sendBinaryNative(this.deviceId, JSON.stringify(head), d).catch(function(e) {
      if (!e || e.code !== 'UNIMPLEMENTED') throw e;
      self.bin = false; // nativo sin trozos binarios: el resto como siempre
      return self.ble._sendMessageNative(self.deviceId, self._buildChunk(idx), self.msgId + '_' + idx);
    });
  }
  return this.ble._sendMessageNative(this.deviceId, this._buildChunk(idx), this.msgId + '_' + idx);
};
ChatStream.prototype._buildChunk = function(idx) {
  var isFirst = idx === 0;
  var obj = {
    v: PROTOCOL_VERSION,
    t: this.type === 'chat' ? 'c' : 'f',
    m: this.msgId,
    i: idx,
    n: this.total,
    d: this.chunks[idx],
    a: this.att
  };
  if (isFirst) {
    obj.f = (this.meta.f || 'NEXO').substring(0, 12);
    obj.fr = this.meta.fr || 'unknown';
    obj.ts = this.meta.ts || Date.now();
    if (typeof this.meta.seq === 'number') obj.seq = this.meta.seq;
    if (this.meta.type) obj.tp = this.meta.type;
    if (this.meta.name) obj.fn = this.meta.name;
    if (this.meta.mime) obj.mt = this.meta.mime;
    if (this.meta.size) obj.fs = this.meta.size;
    if (this.meta.format) obj.ft = this.meta.format;
    // 3015: nota de voz como archivo: su duración y su tipo de audio (la burbuja los muestra)
    if (this.meta.duration) obj.du = this.meta.duration;
    if (this.meta.mimeType) obj.am = this.meta.mimeType;
    // FIX: width/height se perdían (nunca se empaquetaban), quedaban null en el receptor
    if (this.meta.width) obj.w = this.meta.width;
    if (this.meta.height) obj.h = this.meta.height;
    if (this.meta.hdFor) obj.hf = this.meta.hdFor;
    if (this.meta.preview) obj.pv = 1;
    if (this.meta.once) obj.o1 = 1; // #94 «ver una vez»: el medio se consume al abrirlo en el receptor
    if (this.meta.thumb) obj.th = this.meta.thumb; // miniatura JPEG del vídeo (poster) o 1.ª página del PDF
    if (this.meta.pages) obj.pg = this.meta.pages;
    if (this.meta.dst) obj.dt = this.meta.dst;
    if (this.meta.hp) obj.hp = this.meta.hp;
    // Ronda 2764: a quién va (directo; se fija la primera vez: aunque la conexión resulte ser de otro, sigue siendo
    // para el mismo); el que lo recibe lo ignora si no es él
    var bdn = this.ble;
    if (!this.meta.dst && bdn && typeof bdn._destNx === 'function') { if (this._dn === undefined) this._dn = _nxOf(this.meta.to) || bdn._destNx(this.deviceId); if (this._dn) obj.dn = this._dn; }
    // Ronda 2759: oferta de llamada troceada: con la app del otro cerrada, su aviso dice "Llamada entrante" (BgInbox.kt)
    var bi0 = typeof window !== 'undefined' && window.bleInterface;
    if (this.type === 'chat' && bi0 && bi0._callOut && bi0._callOut.has(this.msgId)) obj.cl = 1;
    // Ronda 2760: texto largo oculto (acción, señal de llamada): sin aviso en el otro teléfono (BgInbox.kt)
    var bq = typeof window !== 'undefined' && window.bleInterface;
    if (this.type === 'chat' && bq && bq._quietOut && bq._quietOut.has(this.msgId)) obj.q = 1;
    // Ronda 2763: foto o texto largo de un grupo (directo): el id del grupo para el aviso con la app cerrada
    if (!this.meta.dst && bq && bq._groupOut && bq._groupOut.has(this.msgId)) obj.g = bq._groupOut.get(this.msgId);
  }
  obj.k = _chunkCheck(obj);
  return JSON.stringify(obj);
};
ChatStream.prototype._startWindowTimer = function(waitMs) {
  var self = this;
  if (self.timer) clearTimeout(self.timer);
  var ms = waitMs || self.windowTimeoutMs;
  console.log('[ChatStream] Timer iniciado (' + ms + 'ms) msgId=' + self.msgId);
  self.timer = setTimeout(function() {
    self._onWindowTimeout();
  }, ms);
};
ChatStream.prototype._onWindowTimeout = function() {
  var self = this;
  if (self.aborted) return;
  var allAcked = true;
  for (var i = self._windowStartAtSend; i < self._windowEndAtSend; i++) {
    if (!self.ackedMask[i]) { allAcked = false; break; }
  }
  console.log('[ChatStream] _onWindowTimeout. ventanaOriginal=[' + self._windowStartAtSend + ',' + self._windowEndAtSend + ') allAcked=' + allAcked + ' windowStartActual=' + self.windowStart + ' msgId=' + self.msgId);
  if (allAcked) {
    console.log('[ChatStream] Ventana original completa por ACKs tardios. Resolviendo. msgId=' + self.msgId);
    self.windowRetryCount = 0; self._downWaitMs = 0;
    if (self._windowResolve) {
      self._windowResolve();
      self._windowResolve = null;
      self._windowReject = null;
    }
  } else {
    // #87 (28-10): el enlace está CAÍDO ahora → esperar a que vuelva sin gastar un reintento del tope (no abortar el
    // archivo por un corte del Bluetooth/Wi-Fi). No se reenvía (saturaría la cola nativa); el timeout global (60 s sin
    // ACK) sigue siendo el límite si no vuelve nunca. Al volver y fluir los ACKs, el bucle resetea el contador.
    // #dueño 06-11 (LATIDO de despertador): un ARCHIVO por INTERNET que no avanza = el que recibe se durmió y por eso no
    // confirma. Le re-disparamos el «toque» (net_link lo throttlea a 1 cada 15 s, así que es barato) para que su app
    // vuelva, siga recibiendo y confirme; en cuanto fluyan los ACKs ya no hay timeout → no más toques. Solo net: + file.
    if (_isNetDevice(self.deviceId) && self.type === 'file' && self.ble && self.ble.net && typeof self.ble.net.wakeKeepAlive === 'function') {
      try { var _cidKa = (self.meta && self.meta.dst) ? self.meta.dst : self.ackSystem._resolveNexoId(self.deviceId); if (_cidKa) self.ble.net.wakeKeepAlive(_cidKa); } catch (e) {}
      // #dueño 06-11 (paso 2b, PAREJO): renovar el candado del que ENVÍA en un archivo grande por net (el acquire resetea
      // el tope de 20 min), para que un envío lento (> 20 min) no se duerma a mitad. Se suelta al terminar (start()).
      try { if (self.total > NET_TOR_PREFER_CHUNKS && typeof self.ble.net.xferKeepAwake === 'function') { self.ble.net.xferKeepAwake(true); self._xferHeld = true; } } catch (e) {}
    }
    if (!self._linkUp()) {
      // #dueño 07-11: el contacto de internet/Wi-Fi está AUSENTE (store-and-forward). Marcar 'pending' («esperando», reloj
      // ⏳) PRONTO para que la burbuja no se quede en ○ («clavado») hasta el tope global de 10 min; el audio/archivo ya
      // quedó para el buzón y se entrega al reconectar. Solo archivos (el texto al buzón ya muestra ✓ por otro camino).
      if (self.type === 'file') { try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {} }
      // 2985 (diagnóstico del dueño 10-11, build 2984): con el contacto ausente esto se repetía cada 3,8 s sin parar (hasta 2 h en memoria:
      // ~950 vueltas por hora y por flujo, y el registro del diagnóstico se llenaba de estas líneas). La espera ahora CRECE
      // (3,8 s → 7,6 → 15 → 30 s, tope) y vuelve a la normal en cuanto el enlace está arriba o llegan ACKs. No se gasta reintento ni se aborta.
      // Un ARCHIVO por internet re-dispara el «toque» de despertador en cada vencimiento (net_link lo frena a 1 cada 15 s): su tope es 15 s
      // para no aflojar ese latido; el resto (texto, lo demás) llega a 30 s.
      var _cap = (_isNetDevice(self.deviceId) && self.type === 'file') ? LINK_DOWN_WAIT_FILE_MS : LINK_DOWN_WAIT_MAX_MS;
      self._downWaitMs = Math.min(Math.max((self._downWaitMs || 0) * 2, self.windowTimeoutMs), _cap);
      console.log('[ChatStream] Ventana sin ACK con el enlace caído: espero a que vuelva (no gasta reintento; reviso en ' + Math.round(self._downWaitMs / 1000) + ' s) msgId=' + self.msgId);
      self._startWindowTimer(self._downWaitMs);
      return;
    }
    self._downWaitMs = 0; // el enlace está arriba: la espera vuelve a la normal
    // 2976 (primer diagnóstico AUTOMÁTICO del dueño): el nativo SOLTÓ el mensaje por ese Bluetooth («Write fallo… descartado
    // entero» → onWriteDropped → marcado muerto), pero las escrituras «sin respuesta» no fallan en JS, así que el respaldo
    // Fénix no pasaba por el catch de _sendChunk y seguía reenviando la ventana cada 8 s (7 reintentos × 12 trozos a MTU 23)
    // sobre un enlace muerto. Rendir también AQUÍ (solo Fénix; lo del usuario mantiene toda su paciencia, #129).
    if (self._bgShouldYieldBle()) {
      console.log('[ChatStream] Respaldo Fénix sobre un Bluetooth muerto: se rinde, queda pendiente msgId=' + self.msgId);
      self._giveUpPending();
      return;
    }
    // 2993: un TEXTO cuya ventana vence mientras otro envío avanza por la radio no gasta reintento ni reenvía (sería más carga): espera con
    // backoff (3,8 → 7,6 → 15 s) hasta TEXT_BUSY_GRACE_MS desde que arrancó; pasado eso, o sin otro envío avanzando, el presupuesto de siempre.
    if (self.type !== 'file' && Date.now() - self.startTime < TEXT_BUSY_GRACE_MS && self.ackSystem._otherProgressing(self.msgId)) {
      self._busyWaitMs = Math.min(Math.max((self._busyWaitMs || 0) * 2, self.windowTimeoutMs), 15000);
      console.log('[ChatStream] Ventana sin ACK mientras otro envío avanza por la radio: espero sin gastar reintento (reviso en ' + Math.round(self._busyWaitMs / 1000) + ' s) msgId=' + self.msgId);
      self._startWindowTimer(self._busyWaitMs);
      return;
    }
    self._busyWaitMs = 0;
    // 3002 (diagnóstico automático del 11-11, S24 14:55): un TEXTO por Bluetooth cuyo enlace el nativo ya soltó («Write fallo…
    // descartado entero» → _markBleDead) reenviaba la ventana 8 veces (~64 s) sobre un enlace muerto y acababa ✗ («Max window
    // retries»). Un texto no se pierde por eso: se rinde YA y queda ⏳ pendiente (PEER_ABSENT); se reenvía solo al volver un camino
    // (_markBleDead ya re-ruteó a internet/Wi-Fi si había; si no, lo reenvía el flujo de pendientes). Los archivos tienen su propia regla.
    if (self.type !== 'file' && self._textOnDeadBle()) {
      console.log('[ChatStream] Texto sobre un Bluetooth que el nativo ya soltó: se rinde, queda pendiente msgId=' + self.msgId);
      try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {}
      self._giveUpPending();
      return;
    }
    self.windowRetryCount++;
    // 3021: archivo por un PUENTE Jump que no confirmó ni un trozo → soltar el puente (ver BRIDGE_STALL_RETRIES)
    if (self.type === 'file' && self.meta && self.meta.dst && self.windowStart === 0 && self.windowRetryCount >= BRIDGE_STALL_RETRIES && !_isNetDevice(self.deviceId)) {
      var dstS = _normId(self.meta.dst), viaS = '';
      try { viaS = _normId(self.ble && self.ble._macToNexoId && self.ble._macToNexoId.get(_normMac(self.deviceId))); } catch (e) {}
      console.warn('[ChatStream] Puente ' + (viaS || self.deviceId) + ' sin confirmar ni un trozo de ' + self.msgId + ' tras ' + self.windowRetryCount + ' ventanas: lo suelto y va por otro camino (buzón/internet) a ' + dstS);
      try { if (self.ble && self.ble.relay && typeof self.ble.relay.bridgeStalled === 'function') self.ble.relay.bridgeStalled(viaS || self.deviceId, BRIDGE_STALL_MS); } catch (e) {}
      try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {}
      self._giveUpPending();
      var bleS = self.ble;
      if (dstS && bleS && typeof bleS._resendPendingMessages === 'function') setTimeout(function() { try { bleS._resendPendingMessages(dstS); } catch (e) {} }, 500);
      return;
    }
    // 3005: archivo grande por internet y el otro no confirma → «sondeo» (1 trozo por minuto) en vez de reenviar la ventana
    // entera cada 8 s al vacío. Mantiene el contador en el tope mientras siga el presupuesto de reintento solo (2 h, contacto
    // alcanzable); si se acaba, cae al tope de siempre (abajo).
    if (_isNetDevice(self.deviceId) && self.type === 'file' && self.total >= NET_BIG_MIN_CHUNKS && self.windowRetryCount > NET_SILENT_FULL_RETRIES) {
      if (self.windowRetryCount > self.maxWindowRetries && self._netFileAutoRetryNow()) {
        self.windowRetryCount = self.maxWindowRetries;
        try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {}
      }
      if (self.windowRetryCount <= self.maxWindowRetries) {
        if (!self._probing) console.log('[ChatStream] El otro no confirma: pruebo con 1 trozo cada ' + Math.round(NET_SILENT_PROBE_MS / 1000) + ' s hasta que conteste msgId=' + self.msgId);
        self._probing = true;
        self._probe();
        return;
      }
    }
    if (self.windowRetryCount > self.maxWindowRetries && self.type !== 'file' && /^(msg|gm)[0-9a-z]+/i.test(String(self.msgId || ''))) {
      // 3009 (PENDIENTES 12b; diagnóstico b2987 «gm…_1e29ab2f»: texto de grupo a una app dormida, 8 reintentos y ✗): un TEXTO del
      // usuario (o su copia para un miembro de grupo) que agota los reintentos con el enlace ARRIBA es un otro que no confirma
      // (app congelada o dormida: su nativo avisa pero no puede confirmar un texto troceado). No es un fallo: queda ⏳ pendiente
      // (PEER_ABSENT) y lo reenvía la cola de pendientes de ese contacto cuando vuelva (app al frente, enlace nuevo), como el 3002
      // con un Bluetooth muerto. Antes quedaba ✗ y el usuario tenía que reintentar a mano.
      console.log('[ChatStream] Texto sin confirmar tras ' + self.maxWindowRetries + ' reintentos (la app del otro no contesta): queda pendiente, no ✗ msgId=' + self.msgId);
      try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {}
      self._giveUpPending();
      return;
    }
    if (self.windowRetryCount > self.maxWindowRetries) {
      // #dueño 08-11: un archivo por INTERNET a un contacto ALCANZABLE NO aborta ni pide reintentar: resetea el contador,
      // queda ⏳ y reintenta la ventana SOLO (el despertador ya se renovó arriba). Solo aborta si el contacto no es
      // alcanzable (rama de arriba) o al pasar el tope de 2 h. (ver _netFileAutoRetry) Mantiene VIVO el mismo stream para no
      // depender de un re-disparo externo (contacto que vuelve / app al frente) que antes no llegaba solo.
      if (self._netFileAutoRetryNow()) { self.windowRetryCount = 0; try { self.ackSystem._dispatchStatus(self.msgId, 'pending'); } catch (e) {} self._retransmitWindow(); return; }
      console.warn('[ChatStream] Max window retries alcanzado para', self.msgId);
      try { window.dispatchEvent(new CustomEvent('nexo:diag:symptom', { detail: { kind: 'reintentos', info: self.type + ' ' + self.msgId } })); } catch (e) {} // 2974: síntoma → diagnóstico automático
      self.abort();
      if (self._windowReject) {
        self._windowReject(new Error('Max window retries'));
        self._windowReject = null;
        self._windowResolve = null;
      }
      // #dueño 02-11: un ARCHIVO que agota reintentos queda ⏳ 'pending' (persistido, se reenvía al volver una ruta),
      // no ✗ 'failed'. El texto sí sigue 'failed'.
      self.ackSystem._dispatchStatus(self.msgId, self.type === 'file' ? 'pending' : 'failed');
      return;
    }
    console.log('[ChatStream] Window timeout, reenviando ventana desde', self.windowStart, 'retry', self.windowRetryCount, 'msgId=' + self.msgId);
    self._retransmitWindow();
  }
};
// 3002: ¿el enlace de este flujo es un Bluetooth que el nativo ya marcó muerto/atascado (onWriteDropped → _markBleDead)?
ChatStream.prototype._textOnDeadBle = function() {
  var dev = this.deviceId;
  if (_isNetDevice(dev) || _isLanDevice(dev)) return false;
  try { return !!(this.ble && typeof this.ble._bleCongested === 'function' && this.ble._bleCongested(dev)); } catch (e) { return false; }
};
// 3005: «sondeo» de un archivo grande por internet cuyo receptor no confirma: reenvía SOLO el primer trozo sin confirmar y
// revisa en NET_SILENT_PROBE_MS. Si el otro lo tiene a medias, lo confirma (→ ritmo normal); si lo perdió, pide lo que falta (NACK).
ChatStream.prototype._probe = function() {
  var self = this;
  var idx = self.windowStart;
  while (idx < self.total && self.ackedMask[idx]) idx++;
  self._retxGen = (self._retxGen || 0) + 1;   // corta una cadena de reenvío en curso
  if (idx < self.total) {
    console.log('[ChatStream] Sondeo: reenvío solo el trozo ' + idx + ' (reviso en ' + Math.round(NET_SILENT_PROBE_MS / 1000) + ' s) msgId=' + self.msgId);
    self._sendChunk(idx).then(function() { self._nativeFails = 0; }, function() {});
  }
  self._startWindowTimer(NET_SILENT_PROBE_MS);
};
ChatStream.prototype._retransmitWindow = function() {
  var self = this;
  var end = Math.min(self.windowStart + self.windowSize, self.total);
  var gen = self._retxGen = (self._retxGen || 0) + 1;   // 2995: una sola cadena de reenvío a la vez (la nueva sustituye a la vieja)
  console.log('[ChatStream] _retransmitWindow: [' + self.windowStart + ',' + end + ') msgId=' + self.msgId);
  function sendNext(idx) {
    if (self.aborted || gen !== self._retxGen) return;
    if (idx >= end) {
      self._startWindowTimer();
      return;
    }
    if (self.ackedMask[idx]) {
      setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
      return;
    }
    self._sendChunk(idx)
      .then(function() {
        self._nativeFails = 0;
        setTimeout(function() { sendNext(idx + 1); }, self.pacingDelayMs);
      })
      .catch(function(err) {
        // Ronda 2766 (revisión): como al enviar la ventana. Antes se reintentaba cada 200 ms por el mismo enlace hasta el
        // tiempo máximo (45 s un texto, hasta 15 min un archivo), también por una conexión que resultó ser de otro
        if (self.aborted) return;
        // #dueño 08-11: respaldo Fénix de fondo sobre un Bluetooth atascado → rendir YA (igual que en _sendWindow).
        if (self._bgShouldYieldBle()) { self._giveUpPending(); return; }
        if (self._sendFailed(idx, err)) setTimeout(function() { sendNext(idx); }, self._nativeFails > 10 ? 1000 : 200);
      });
  }
  sendNext(self.windowStart);
};
var NACK_MIN_GAP_MS = 1000;   // 2995: un reenvío por NACK como mucho por segundo y flujo
ChatStream.prototype.handleNack = function(indices) {
  var self = this;
  if (self.aborted) return;
  indices = indices || [];
  // 2995 (diagnóstico del dueño 10-11 12:39, APK de 25 MB S24→vivo): el receptor repetía «faltan 0…95» cada ~150 ms y CADA aviso
  // reenviaba todos esos trozos y, si el envío fallaba (los relés no respondían), encadenaba otra vuelta de la ventana a los
  // 500 ms: ~100 reenvíos de la misma ventana en 10 s (más de 100 cadenas a la vez) y el registro lleno de líneas «handleNack».
  // Ahora hay UN reenvío por NACK en curso: los avisos que llegan mientras tanto se juntan y se atienden de una vez al acabar.
  if (self._nackBusy && Date.now() - (self._nackBusyAt || 0) < 20000) {   // (20 s de seguro por si un envío no vuelve nunca)
    self._nackPend = self._nackPend || {};
    indices.forEach(function(i) { self._nackPend[i] = true; });
    self._nackMerged = (self._nackMerged || 0) + 1;
    return;
  }
  self._nackBusy = true; self._nackBusyAt = Date.now();
  console.log('[ChatStream] handleNack: ' + indices.length + ' trozo(s)' + (indices.length ? ' [' + indices[0] + '…' + indices[indices.length - 1] + ']' : '') + (self._nackMerged ? ' (' + self._nackMerged + ' avisos juntados)' : '') + ' msgId=' + self.msgId);
  self._nackMerged = 0;
  if (self.timer) clearTimeout(self.timer);
  var promises = [];
  indices.forEach(function(idx) {
    if (idx >= 0 && idx < self.total) {
      self.sentMask[idx] = true;
      promises.push(self._sendChunk(idx));
    }
  });
  function done(failed) {
    // como mucho un reenvío por NACK cada NACK_MIN_GAP_MS (aunque el envío fallara al instante): los avisos de ese rato se juntan
    var wait = Math.max(0, NACK_MIN_GAP_MS - (Date.now() - self._nackBusyAt));
    setTimeout(function() {
      self._nackBusy = false;
      if (self.aborted) return;
      var pend = Object.keys(self._nackPend || {}).map(Number);
      self._nackPend = {};
      if (pend.length) { self.handleNack(pend); return; }
      if (failed) { if (!self._retxQueued) { self._retxQueued = true; setTimeout(function() { self._retxQueued = false; if (!self.aborted) self._retransmitWindow(); }, 500); } }
      else self._startWindowTimer();
    }, wait);
  }
  Promise.all(promises).then(function() { done(false); }).catch(function() { done(true); });
};
ChatStream.prototype.handleFinalAck = function() {
  console.log('[ChatStream] handleFinalAck msgId=' + this.msgId);
  if (this.timer) clearTimeout(this.timer);
  this._finish();
};
ChatStream.prototype._finish = function() {
  if (this.aborted) return;
  console.log('[ChatStream] _finish msgId=' + this.msgId);
  this.aborted = true;
  try { this.ackSystem._mtuDeferSince.delete(this.msgId); } catch (e) {} // #B2: entregado → fuera del registro de aplazados
  if (this.timer) clearTimeout(this.timer);
  if (this.globalTimeout) clearTimeout(this.globalTimeout);
  // Velocidad real por salto (la usa el selector de camino de Jump)
  var relay = this.ackSystem.ble && this.ackSystem.ble.relay;
  if (relay && this.type === 'file') relay.noteSpeed(this.content.length, Date.now() - this.startTime);
  // Jump: el ack final de un puente es custodia (✓); el ✓✓ llega con el ack del destino
  if (!this.meta.fwd) this.ackSystem._dispatchStatus(this.msgId, this.meta.dst ? 'sent' : 'delivered');
  // v3.4.0: entregado → fuera del registro de salientes (si no, se reenviaba al abrir la app o reconectar)
  if (window.vaultRemoveOutgoingTransfer && !this.meta.fwd) {
    window.vaultRemoveOutgoingTransfer(this.meta.dst || this.ackSystem._resolveNexoId(this.deviceId), this.msgId).catch(function(){});
  }
  // NO disparar fileComplete en el emisor: el receptor lo emite al ensamblar.
  // Antes se enviaba data=null y podía interferir con listeners.
  if (this.type === 'file' && !this.meta.fwd) {
    this.ackSystem._dispatchFileProgress(this.msgId, this.total, this.total, this.meta.dst ? 'sent' : 'delivered', 100);
  }
  if (this.resolve) {
    this.resolve();
    this.resolve = null;
    this.reject = null;
  }
};
ChatStream.prototype.abort = function() {
  console.log('[ChatStream] abort msgId=' + this.msgId);
  this.aborted = true;
  if (this.timer) clearTimeout(this.timer);
  if (this.globalTimeout) clearTimeout(this.globalTimeout);
  if (this._windowResolve) {
    this._windowResolve();
    this._windowResolve = null;
    this._windowReject = null;
  }
  if (this.reject) this.reject(new Error('Abortado'));
};
export function createAckSystem(bleInterface) {
return new BleAckSystem(bleInterface);
}
