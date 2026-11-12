/**
 * NEXO — ESTADO para el diagnóstico (3020, plan del dueño 12-11: «más claro el diagnóstico, mejor lo puedes arreglar»).
 * Lo que faltaba al leer los diagnósticos reales y obligaba a adivinar:
 *  - la ZONA HORARIA (las líneas llevan la hora local del teléfono; sin ella no se cruzan dos teléfonos),
 *  - el estado del teléfono (pantalla, ahorro de batería/Doze, Wi-Fi o datos, relés, batería),
 *  - por CONTACTO: por dónde va ahora (Bluetooth/Wi-Fi/internet/nada), su enlace Bluetooth (MTU), si está en línea por
 *    internet (Wi-Fi o datos), si se le busca, la espera de reenvío y la BUILD que tiene instalada (la dice en su kx),
 *  - la LÍNEA DE TIEMPO de cada mensaje propio reciente: cada cambio de estado con su hora y por dónde salía.
 * Además compacta las líneas repetidas del registro (un bucle de cientos de líneas iguales se vuelve una con «×N»).
 * Sin contenido de mensajes ni nombres: solo la parte final del NEXO ID de cada contacto (los 4 últimos caracteres).
 * Síntoma «entrega_lenta»: un texto propio que tardó más de SLOW_MS en llegar habiendo camino al mandarlo.
 */
import { _getBLEContacts, _normId, _normMac } from './ble_helpers.js';

var TRACE_MAX = 40;              // mensajes con línea de tiempo (los más recientes)
var SLOW_MS = 2 * 60 * 1000;     // «entrega lenta»: más de 2 min con camino
var _trace = new Map();          // msgId -> { nx, t0, via0, ev: [[t, estado, vía]] }
var _peerBuild = Object.create(null); // nx -> build que dijo en su kx
var _power = null, _powerAt = 0;

function _bi() { return (typeof window !== 'undefined' && window.bleInterface) || null; }
function _tail(nx) { nx = _normId(nx); return nx ? '…' + nx.slice(-4) : '?'; }
function _hhmmss(ts) { var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }

// La build del otro (kx «bd»): solo dígitos, corta
export function diagNotePeerBuild(nx, bd) {
  nx = _normId(nx); bd = String(bd == null ? '' : bd);
  if (!/^nx[0-9a-z]{8}$/.test(nx) || !/^(\d{1,6}|dev)$/.test(bd)) return;
  _peerBuild[nx] = bd;
}
export function diagPeerBuild(nx) { return _peerBuild[_normId(nx)] || null; }

// Por dónde sale un mensaje ahora: el enlace de su envío en curso (Bluetooth/Wi-Fi/internet) o «?»
function _viaKind(dev) {
  var d = String(dev || '');
  if (/^net:/.test(d)) return 'internet';
  if (/^lan:/.test(d)) return 'wifi';
  if (/^wd:/.test(d)) return 'wifi-direct';
  return d ? 'bluetooth' : '?';
}
function _nxOfDev(bi, dev) {
  var d = String(dev || ''), m = /^(?:net|lan|wd):(nx[0-9a-z]{8})$/.exec(d);
  if (m) return m[1];
  try { return _normId(bi && bi._macToNexoId && bi._macToNexoId.get(_normMac(d))); } catch (e) { return ''; }
}
function _onStatus(e) {
  var d = e && e.detail; if (!d || !d.msgId || !d.status) return;
  var id = String(d.msgId); if (/^(kx_|ack_|ping|gm)/.test(id)) return;
  var bi = _bi(), now = Date.now(), dev = null;
  try { var pa = bi && bi.ackSystem && bi.ackSystem.pendingAcks && bi.ackSystem.pendingAcks.get(id); dev = pa && pa.deviceId; } catch (e1) {}
  var tr = _trace.get(id);
  if (!tr) {
    if (d.status === 'delivered' || d.status === 'read') return; // solo los que vimos salir (no los de otra sesión)
    var nx = dev ? _nxOfDev(bi, dev) : '';
    var via0 = 'none'; try { if (nx && bi && typeof bi.linkOf === 'function') via0 = bi.linkOf(nx); } catch (e2) {}
    tr = { nx: nx, t0: now, via0: via0, ev: [] };
    _trace.set(id, tr);
    if (_trace.size > TRACE_MAX) _trace.delete(_trace.keys().next().value);
  }
  if (!tr.nx && dev) tr.nx = _nxOfDev(bi, dev);
  var last = tr.ev[tr.ev.length - 1];
  var via = dev ? _viaKind(dev) : '';
  if (last && last[1] === d.status && last[2] === via) return;
  tr.ev.push([now, d.status, via]);
  if (tr.ev.length > 12) tr.ev.splice(1, 1);
  var slowMs = (typeof window.NEXO_DIAG_SLOW_MS === 'number' && window.NEXO_DIAG_SLOW_MS >= 0) ? window.NEXO_DIAG_SLOW_MS : SLOW_MS; // perilla de prueba
  if ((d.status === 'delivered') && !tr.slow && tr.via0 !== 'none' && now - tr.t0 > slowMs) {
    tr.slow = true;
    try { window.dispatchEvent(new CustomEvent('nexo:diag:symptom', { detail: { kind: 'entrega_lenta', info: tr.nx + ' ' + id + ' ' + Math.round((now - tr.t0) / 1000) + ' s, camino al mandar ' + tr.via0 } })); } catch (e3) {}
  }
}

// Batería, pantalla, ahorro, Doze y red del teléfono (nativo getPowerStatus; se pide como mucho cada 60 s)
function _refreshPower() {
  var pl = (typeof window !== 'undefined') && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  if (!pl || typeof pl.getPowerStatus !== 'function' || Date.now() - _powerAt < 60000) return;
  _powerAt = Date.now();
  try { pl.getPowerStatus().then(function(r) { if (r) _power = Object.assign({ at: Date.now() }, r); }).catch(function() {}); } catch (e) {}
}

var _inited = false;
export function diagStateInit() {
  if (_inited || typeof window === 'undefined') return;
  _inited = true;
  window.addEventListener('nexo:ble:ackStatus', _onStatus);
  setTimeout(_refreshPower, 3000);
  setInterval(_refreshPower, 60000);
}

function _tz() {
  var off = -new Date().getTimezoneOffset(), s = off >= 0 ? '+' : '-', a = Math.abs(off);
  var name = ''; try { name = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  return 'UTC' + s + ('0' + Math.floor(a / 60)).slice(-2) + ':' + ('0' + (a % 60)).slice(-2) + (name ? ' (' + name + ')' : '');
}

function _phoneLine(bi) {
  // 3023 (diagnóstico del vivo 12-11: «app visible · pantalla apagada»): en algunos teléfonos el WebView no avisa al pasar a
  // segundo plano; el estado bueno es el que avisa la parte nativa (_foreground, onAppStateChange)
  var fg = bi && typeof bi._foreground === 'boolean' ? bi._foreground : !(typeof document !== 'undefined' && document.visibilityState === 'hidden');
  var parts = ['app ' + (fg ? 'en primer plano' : 'en segundo plano')];
  if (_power) {
    if (_power.level != null) parts.push('batería ' + _power.level + '%' + (_power.charging ? ' cargando' : ''));
    if (_power.powerSave) parts.push('AHORRO DE BATERÍA');
    if (_power.idle) parts.push('DOZE');
    if (_power.interactive === false) parts.push('pantalla apagada');
    if (_power.ignoringOpt === false) parts.push('optimización de batería ACTIVA para NEXO'); // i18n-ok: texto del diagnóstico
    if (_power.net) parts.push('red ' + _power.net);
    if (_power.hotspot) parts.push('comparte datos (punto de acceso)');
  }
  var net = bi && bi.net;
  if (net) {
    var open = 0; try { open = net._openCount(); } catch (e) {}
    parts.push('relés abiertos ' + open + (net.wifi ? ' (Wi-Fi)' : ' (datos/otra)'));
  }
  // 3023: Wi-Fi ENCENDIDO o APAGADO (no es lo mismo que «sin red»: Wi-Fi Direct lo necesita encendido) y caminos rápidos propios
  try { var wd = bi && bi.wifiDirect; if (wd && wd.status) parts.push('Wi-Fi ' + (wd.status.wifiOn === false ? 'APAGADO' : wd.status.wifiOn ? 'encendido' : '?') + ' · Wi-Fi Direct ' + (wd.supported && wd.supported() ? 'sí' : 'no')); } catch (e) {}
  try { if (bi && bi.bigFiles) parts.push('Bluetooth L2CAP ' + (bi.bigFiles.l2Ok ? 'sí' : 'no')); } catch (e) {}
  if (bi && bi.lan && bi.lan.links) { try { var nl = 0; bi.lan.links.forEach(function(l) { if (l && l.up) nl++; }); parts.push('enlaces Wi-Fi local ' + nl); } catch (e) {} }
  return parts.join(' · ');
}

function _contactRows(bi) {
  var cs = []; try { cs = _getBLEContacts() || []; } catch (e) {}
  var now = Date.now();
  return cs.filter(function(c) { return c && !c.isGroup; }).slice(0, 30).map(function(c) {
    var nx = _normId(c.nexoId || c.deviceUUID), p = [];
    try { p.push('camino ' + bi.linkOf(nx)); } catch (e) { p.push('camino ?'); }
    try { var r = bi._bleReadyFor(nx); if (r) p.push('BT listo MTU ' + ((bi._mtuByDevice && bi._mtuByDevice.get(r)) || '?')); } catch (e) {}
    try { var np = bi.net && bi.net.peers && bi.net.peers.get(nx); if (np) p.push('internet ' + (np.up ? 'en línea' + (np.wifi ? ' (Wi-Fi)' : ' (datos)') : 'fuera') + (np.lastRx ? ', oído hace ' + Math.round((now - np.lastRx) / 1000) + ' s' : '')); } catch (e) {}
    try { if (bi.lan && bi.lan.canReach(nx)) p.push('Wi-Fi local'); } catch (e) {}
    if (!c.nt) p.push('sin internet anunciado');
    // 3023: qué caminos rápidos tiene ese contacto (los anuncia en su kx): Wi-Fi Direct, archivos grandes, L2CAP
    try { var fast = []; if (bi.wifiDirect && bi.wifiDirect.peers && bi.wifiDirect.peers.has(nx)) fast.push('WD'); if (bi.bigFiles && bi.bigFiles.peers && bi.bigFiles.peers.has(nx)) fast.push('grandes'); if (bi.bigFiles && bi.bigFiles.l2Peers && bi.bigFiles.l2Peers.has(nx)) fast.push('L2CAP'); p.push('rápidos: ' + (fast.length ? fast.join('+') : 'ninguno')); } catch (e) {}
    try { if (bi._lostPeers && bi._lostPeers.has(nx)) p.push('se le busca'); } catch (e) {}
    try { var bo = bi._resendBackoff && bi._resendBackoff.get(nx); if (bo && bo.n) p.push('reenvío en espera ×' + bo.n); } catch (e) {}
    if (c.lastSeen) p.push('visto ' + _hhmmss(c.lastSeen));
    p.push('build ' + (_peerBuild[nx] || '?'));
    return '  ' + _tail(nx) + ': ' + p.join(' · ');
  });
}

function _traceRows() {
  var out = [];
  _trace.forEach(function(tr, id) {
    out.push('  ' + id.slice(-8) + ' → ' + _tail(tr.nx) + ' (camino al mandar ' + tr.via0 + '): ' + tr.ev.map(function(e) {
      return _hhmmss(e[0]) + ' ' + e[1] + (e[2] ? '/' + e[2] : '');
    }).join(' → ') + (tr.slow ? '  [LENTO]' : ''));
  });
  return out.slice(-25);
}

// La sección ESTADO completa (cabe en ~4 KB con 30 contactos)
export function diagStateText() {
  var bi = _bi(), out = ['===== ESTADO (' + _hhmmss(Date.now()) + ' hora local) =====', 'Zona horaria: ' + _tz()];
  try { out.push('Teléfono: ' + _phoneLine(bi)); } catch (e) { out.push('Teléfono: ?'); }
  if (bi) {
    var rows = []; try { rows = _contactRows(bi); } catch (e) {}
    out.push('Contactos (' + rows.length + '):'); out = out.concat(rows);
  }
  var tr = _traceRows();
  if (tr.length) { out.push('Mensajes propios recientes (línea de tiempo):'); out = out.concat(tr); }
  return out.join('\n') + '\n';
}

// Compactación: líneas seguidas iguales salvo la hora y los números (bucle de reintentos, escaneos…) → la primera y
// «↳ ×N más hasta HH:MM:SS». Así un bucle no se come el diagnóstico y se ve que ES un bucle (y cuánto duró).
export function diagCompactLines(lines) {
  var out = [], prevKey = null, run = 0, lastTs = '';
  function norm(l) { return String(l).replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s*/, '').replace(/\d+/g, '#'); }
  function flush() { if (run > 0) out.push('   ↳ ×' + run + ' más iguales hasta ' + lastTs); run = 0; }
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i], k = norm(l);
    if (k === prevKey && k.length > 0) { run++; lastTs = (/^(\d{2}:\d{2}:\d{2})/.exec(l) || [])[1] || lastTs; continue; }
    flush(); out.push(l); prevKey = k;
  }
  flush();
  return out;
}

export { SLOW_MS as DIAG_SLOW_MS };
