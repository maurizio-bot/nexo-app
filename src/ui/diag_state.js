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
import { _getBLEContacts, _isPinned, _normId, _normMac } from './ble_helpers.js';
import { _msgContactMap } from './chat_state.js'; // COLA 35: a quién va cada mensaje propio
import { exitsInit, exitsLines } from './diag_exits.js'; // 3120: cierres de la app
import { thermalWord } from './call_power.js'; // 3256: temperatura y estado térmico

var TRACE_MAX = 40;              // mensajes con línea de tiempo (los más recientes)
var SLOW_MS = 2 * 60 * 1000;     // «entrega lenta»: más de 2 min con camino
var _trace = new Map();          // msgId -> { nx, t0, via0, ev: [[t, estado, vía]] }
var _peerBuild = Object.create(null); // nx -> build que dijo en su kx
var _power = null, _powerAt = 0;
// 3034 (diagnóstico de …c95d 12-11: «entrega lenta 2761 s»): con la app en segundo plano el teléfono no se entera de la ✓✓
// hasta volver (la app está congelada), aunque el otro lo recibió al momento. Lo lento era ESTE teléfono dormido, no la
// entrega: si la app estuvo en segundo plano desde que salió el mensaje, no cuenta como «entrega lenta».
var _hidden = false, _backAt = 0;

function _bi() { return (typeof window !== 'undefined' && window.bleInterface) || null; }
function _tail(nx) { nx = _normId(nx); return nx ? '…' + nx.slice(-4) : '?'; }
// 3117 (dueño 15-11: «agrega a tus diagnósticos el nombre del contacto, así podré decirte quién es; por ID no lo sé»): el nombre con
// que el teléfono tiene guardado al contacto, junto a su ID corto. Recortado y sin caracteres que rompan la línea.
function _nameOf(nx) {
  nx = _normId(nx); if (!nx) return '';
  var c = null; try { c = (_getBLEContacts() || []).find(function(x) { return x && _normId(x.nexoId || x.deviceUUID) === nx; }); } catch (e) {}
  var n = c ? String(c.name || c.displayName || '') : '';
  n = n.replace(/[\r\n():·→]/g, ' ').replace(/\s+/g, ' ').trim();
  return n ? ' (' + n.slice(0, 24) + ')' : '';
}
// COLA 35 (diagnóstico: «→ ?» en los mensajes que salieron sin camino y en un archivo grande): sin enlace en curso no hay deviceId
// en pendingAcks, pero el PROPIO mensaje sabe a quién va (el chat que lo envió, o el destino fijado al mandarlo)
function _nxOfMsg(bi, id) {
  var c = ''; try { c = _normId(_msgContactMap[id]); } catch (e) {}
  if (/^nx[0-9a-z]{8}$/.test(c)) return c;
  try { c = _normId(bi && bi._msgDest && bi._msgDest.get(id)); } catch (e2) { c = ''; }
  return /^nx[0-9a-z]{8}$/.test(c) ? c : '';
}
function _hhmmss(ts) { var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }

// La build del otro (kx «bd»): solo dígitos, corta
export function diagNotePeerBuild(nx, bd) {
  nx = _normId(nx); bd = String(bd == null ? '' : bd);
  if (!/^nx[0-9a-z]{8}$/.test(nx) || !/^(\d{1,6}|dev)$/.test(bd)) return;
  _peerBuild[nx] = bd;
}

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
  // 3130 (diagnóstico de …5928 15-11 13:51: «entrega_lenta 294 s» de un aviso INTERNO —la petición de estados y foto al deslizar—
  // a un teléfono con la app cerrada): lo oculto (estados, foto, señales) no es un mensaje del usuario: no se mide
  try { if (bi && bi._quietOut && bi._quietOut.has(id)) return; } catch (eq) {}
  try { var pa = bi && bi.ackSystem && bi.ackSystem.pendingAcks && bi.ackSystem.pendingAcks.get(id); dev = pa && pa.deviceId; } catch (e1) {}
  var tr = _trace.get(id);
  if (!tr) {
    if (d.status === 'delivered' || d.status === 'read') return; // solo los que vimos salir (no los de otra sesión)
    var nx = (dev ? _nxOfDev(bi, dev) : '') || _nxOfMsg(bi, id);
    var via0 = 'none'; try { if (nx && bi && typeof bi.linkOf === 'function') via0 = bi.linkOf(nx); } catch (e2) {}
    tr = { nx: nx, t0: now, via0: via0, ev: [] };
    _trace.set(id, tr);
    try { if (typeof window.NEXO_noteSent === 'function') window.NEXO_noteSent(via0); } catch (eS) {} // 3259: salió por este camino
    if (_trace.size > TRACE_MAX) _trace.delete(_trace.keys().next().value);
  }
  if (!tr.nx) tr.nx = (dev ? _nxOfDev(bi, dev) : '') || _nxOfMsg(bi, id);
  var last = tr.ev[tr.ev.length - 1];
  // 3128 (diagnóstico S24 3067 15-11 08:41): una foto ✓✓ y leída en 4 s recibió otra confirmación por otro camino 3,5 min
  // después y salía «entrega_lenta 217 s». Solo la PRIMERA confirmación mide la entrega; las repetidas quedan en la línea de tiempo.
  var doneBefore = tr.ev.some(function(x) { return x[1] === 'delivered' || x[1] === 'read'; });
  // 3130: «(repetida)» solo si ya hubo una igual o mayor (entregado tras entregado/leído, leído tras leído); leído tras entregado es lo normal
  var rk = function(st) { return st === 'read' ? 2 : st === 'delivered' ? 1 : 0; };
  var repeated = rk(d.status) > 0 && tr.ev.some(function(x) { return rk(x[1]) >= rk(d.status); });
  var via = dev ? _viaKind(dev) : '';
  if (last && last[1] === d.status && last[2] === via) return;
  tr.ev.push([now, d.status, via, repeated ? 1 : 0]);
  if (tr.ev.length > 12) tr.ev.splice(1, 1);
  var slowMs = (typeof window.NEXO_DIAG_SLOW_MS === 'number' && window.NEXO_DIAG_SLOW_MS >= 0) ? window.NEXO_DIAG_SLOW_MS : SLOW_MS; // perilla de prueba
  var asleep = _hidden || _backAt > tr.t0; // 3034: la app estuvo en segundo plano mientras esperaba la ✓✓
  if (d.status === 'delivered' && !doneBefore) { try { if (typeof window.NEXO_noteDelivered === 'function') window.NEXO_noteDelivered(tr.via0, asleep ? -1 : now - tr.t0, id); } catch (eD) {} } // 3259: primera ✓✓: tiempo por camino
  if ((d.status === 'delivered') && !doneBefore && !tr.slow && !asleep && tr.via0 !== 'none' && now - tr.t0 > slowMs) {
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
  if (typeof document !== 'undefined') {
    _hidden = document.visibilityState === 'hidden';
    document.addEventListener('visibilitychange', function() {
      var h = document.visibilityState === 'hidden';
      if (_hidden && !h) _backAt = Date.now();
      _hidden = h;
    });
  }
  setTimeout(_refreshPower, 3000);
  setInterval(_refreshPower, 60000);
  setTimeout(function() { try { exitsInit(); } catch (e) {} }, 2000); // 3120: una vez por arranque
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
    if (typeof _power.temp === 'number') parts.push('temperatura ' + (Math.round(_power.temp * 10) / 10).toFixed(1).replace('.', ',') + ' °C' + (thermalWord(_power.thermal) ? ' (estado térmico ' + thermalWord(_power.thermal) + ')' : '')); // 3256
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
    try { if (typeof net.torState === 'function') parts.push('Tor ' + net.torState()); } catch (e) {} // 3046
    // dueño 13-11: puente a internet por un NEXO cercano (gw_link.js): por cuáles salgo yo y a cuántos les presto el mío
    try {
      var gs = net.gw && net.gw.summary();
      if (gs && gs.bridges.length) parts.push('internet POR PUENTE: ' + gs.bridges.join(', '));
      if (gs && (gs.serving || gs.stats.sessions)) parts.push('presto internet a ' + gs.serving + ' ahora (' + gs.stats.sessions + ' sesiones, ' + gs.stats.up + ' subidos, ' + gs.stats.rejected + ' rechazados)');
    } catch (e) {}
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
    try { var np = bi.net && bi.net.peers && bi.net.peers.get(nx); if (np) p.push('internet ' + (np.up ? 'en línea' + (np.wifi ? ' (Wi-Fi)' : ' (datos)') : 'fuera') + (np.lastRx ? ', oído hace ' + Math.round((now - np.lastRx) / 1000) + ' s' : '') + (np.torOk ? ', Tor directo' : np.torUp ? ', Tor abierto sin confirmar' : '')); } catch (e) {}
    try { if (bi.lan && bi.lan.canReach(nx)) p.push('Wi-Fi local'); } catch (e) {}
    if (!c.nt) p.push('sin internet anunciado');
    // 3023: qué caminos rápidos tiene ese contacto (los anuncia en su kx): Wi-Fi Direct, archivos grandes, L2CAP
    try { var fast = []; if (bi.wifiDirect && bi.wifiDirect.peers && bi.wifiDirect.peers.has(nx)) fast.push('WD'); if (bi.bigFiles && bi.bigFiles.peers && bi.bigFiles.peers.has(nx)) fast.push('grandes'); if (bi.bigFiles && bi.bigFiles.l2Peers && bi.bigFiles.l2Peers.has(nx)) fast.push('L2CAP'); p.push('rápidos: ' + (fast.length ? fast.join('+') : 'ninguno')); } catch (e) {}
    try { if (bi._lostPeers && bi._lostPeers.has(nx)) p.push('se le busca'); } catch (e) {}
    try { var bo = bi._resendBackoff && bi._resendBackoff.get(nx); if (bo && bo.n) p.push('reenvío en espera ×' + bo.n); } catch (e) {}
    try { if (typeof window.NEXO_avatarDiag === 'function') p.push(window.NEXO_avatarDiag(nx)); } catch (e) {} // 3060: estado de su foto de perfil
    if (c.lastSeen) p.push('visto ' + _hhmmss(c.lastSeen));
    // 3183 (dueño 17-11, el vivo siempre arriba): qué lo pone en su lugar de la lista (fijado / hora del último mensaje)
    try { if (_isPinned(nx)) p.push('FIJADO arriba'); } catch (e) {}
    if (c.lastMessageAt) { var lm = Math.round((now - c.lastMessageAt) / 60000); p.push(lm < -1 ? 'últ. msj EN EL FUTURO (+' + (-lm) + ' min)' : 'últ. msj hace ' + Math.max(0, lm) + ' min'); } // i18n-ok: texto para el desarrollador
    p.push('build ' + (_peerBuild[nx] || '?'));
    return '  ' + _tail(nx) + _nameOf(nx) + ': ' + p.join(' · ');
  });
}

function _traceRows() {
  var out = [];
  _trace.forEach(function(tr, id) {
    out.push('  ' + id.slice(-8) + ' → ' + _tail(tr.nx) + _nameOf(tr.nx) + ' (camino al mandar ' + tr.via0 + '): ' + tr.ev.map(function(e) {
      return _hhmmss(e[0]) + ' ' + e[1] + (e[2] ? '/' + e[2] : '') + (e[3] ? ' (repetida)' : ''); // i18n-ok: texto para el desarrollador
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
  // 3081: velocidad real de hoy por camino y cuánto tarda cada camino en quedar listo (usage_stats)
  try { var sp = typeof window.NEXO_speedLines === 'function' ? window.NEXO_speedLines() : []; if (sp.length) { out.push('Velocidad de hoy por camino:'); out = out.concat(sp); } } catch (e) {} // i18n-ok
  try { var pw = window.__nexoPower && typeof window.__nexoPower.lines === 'function' ? window.__nexoPower.lines() : []; if (pw.length) { out.push('Uso de hoy:'); out = out.concat(pw.map(function(l) { return '  ' + l; })); } } catch (e) {} // i18n-ok: 3119
  try { var rl = bi && bi.net && typeof bi.net.rxLine === 'function' ? bi.net.rxLine() : ''; if (rl) out.push('  ' + rl); } catch (e) {} // 3128: datos que llegan de los relés
  try { out = out.concat(exitsLines()); } catch (e) {} // 3120: cierres de la app y su motivo
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
