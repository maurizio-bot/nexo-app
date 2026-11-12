/**
 * NEXO — Diagnóstico AUTOMÁTICO al desarrollador (build 2974; pedido del dueño 09-11: «que el diagnóstico se haga solo y
 * que me llegue»). Sus probadores casi nunca mandan el diagnóstico a mano. Ahora, cuando la app detecta un SÍNTOMA
 * (enlace Bluetooth zombi, un envío que agota sus reintentos, un pendiente viejo con el contacto alcanzable, un error de
 * código), arma el mismo texto de Perfil → Copiar diagnóstico (recortado a DIAG_MAX_CHARS, lo más reciente) y lo manda
 * CIFRADO de extremo a extremo al NEXO ID del desarrollador como mensaje OCULTO de protocolo ({type:'nexo_diag'}): no
 * aparece en ningún chat (ni en el del que manda ni en el del que recibe), viaja por el camino que haya (Bluetooth,
 * Wi-Fi, buzón de relés) y, sin camino, queda pendiente y sale solo al volver (misma cola que cualquier mensaje). Nunca
 * sale del teléfono hacia un servicio externo: el repositorio es público y el diagnóstico lleva IDs y direcciones de
 * terceros. Sin contenido de mensajes (el diagnóstico nunca lo tuvo).
 * Límites (patrón Signal/ACRA, investigación 09-11): uno cada GAP_MS, MAX_PER_DAY por día, el mismo síntoma una vez cada
 * SAME_MS; interruptor en Perfil (encendido por defecto en estas builds de prueba, aviso la primera vez que se manda);
 * «últimos envíos» a la vista con ✓ cuando el desarrollador lo confirma. El desarrollador ve «Diagnósticos recibidos (N)»
 * en su Perfil y los copia de una vez (sus propios síntomas van directo a esa lista, sin viajar).
 * Perillas de prueba (tests/sim): window.NEXO_DIAG_DEV, NEXO_AUTODIAG_GAP_MS, NEXO_AUTODIAG_MAX_DAY, NEXO_AUTODIAG_OLD_MS,
 * NEXO_AUTODIAG_SCAN_MS, NEXO_AUTODIAG_PAIR_MS (3020), NEXO_DIAG_SLOW_MS (3020, diag_state.js).
 */
import { _diagnosticText } from './diag.js';
import { _getBLEContacts, _isResendable, _normId, _showToast, _tooBigForBt } from './ble_helpers.js';
import { _sendTextTo } from './send.js';
import { t } from './i18n.js';
import { diagChannelAvailable, diagChannelInit, diagChannelSend } from './diag_channel.js'; // 2992: canal directo a Claude

export var DIAG_DEV_NX = 'nx1n36c283'; // el S24 del dueño (Fénix conserva el NEXO ID al cambiar de teléfono)
// 3020 (dueño 12-11, «más diagnósticos = más arreglos»): antes 2 h / 3 por día / el mismo síntoma 24 h; se perdían casi
// todos los síntomas de un día malo. Ahora la recogida es cada hora y los límites dejan pasar lo que hace falta.
var GAP_MS = 10 * 60 * 1000;           // como mucho un diagnóstico automático cada 10 min
var MAX_PER_DAY = 30;                  // y 30 por día
var SAME_MS = 2 * 60 * 60 * 1000;      // el mismo síntoma (tipo + detalle) una vez cada 2 h
var DIAG_MAX_CHARS = 40000;            // ~40 KB por envío (cabecera + lo más reciente)
var INBOX_MAX = 20, SENT_MAX = 10;
var OLD_PENDING_MS = 30 * 60 * 1000;   // un pendiente de más de 30 min con el contacto ALCANZABLE es un síntoma
var SCAN_MS = 5 * 60 * 1000;           // barrido de pendientes viejos
var KEY_ON = 'nexo_autodiag', KEY_STATE = 'nexo_autodiag_state', KEY_INBOX = 'nexo_diag_in';
var _inbox = null, _reportedPending = {}, _errSeen = {}, _ackIds = {};

function _knob(name, def) { try { var v = (typeof window !== 'undefined') ? window[name] : undefined; return (typeof v === 'number' && v >= 0) ? v : def; } catch (e) { return def; } }
function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _emit() { try { window.dispatchEvent(new CustomEvent('nexo:autodiag:changed')); } catch (e) {} }
function _me() { var bi = (typeof window !== 'undefined') ? window.bleInterface : null; return _normId(bi && (bi.localNexoId || bi.localDeviceUUID)); }
function _isContact(nx) { return (_getBLEContacts() || []).some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; }); }
function _state() { try { var s = JSON.parse(_lsGet(KEY_STATE) || '{}'); return (s && typeof s === 'object') ? s : {}; } catch (e) { return {}; } }
function _saveState(s) { _lsSet(KEY_STATE, JSON.stringify(s)); }
function _dayKey(now) { return new Date(now).toISOString().substring(0, 10); }
function _kb(n) { return Math.max(1, Math.round(n / 1024)); }

// Número de build (lo inyecta el workflow en dist/index.html: window.NEXO_BUILD); en el simulador y en local, «dev».
export function autoDiagBuild() { var b = (typeof window !== 'undefined' && window.NEXO_BUILD) || ''; return /^\d+$/.test(String(b)) ? String(b) : 'dev'; }
// 2991 (B, dueño 10-11: «el sentido por defecto»): en estas builds de prueba va ENCENDIDO por defecto. Para probadores externos / Google Play
// la compilación fija window.NEXO_DIAG_DEFAULT = 'ask': apagado hasta que la persona conteste una pregunta única («Aceptar» / «Ahora no»).
// Lo que la persona eligió (nexo_autodiag 1/0) manda siempre. El resumen diario de uso (usage_stats.js) usa este mismo interruptor.
function _defaultAsk() { return (typeof window !== 'undefined') && window.NEXO_DIAG_DEFAULT === 'ask'; }
export function autoDiagEnabled() { var v = _lsGet(KEY_ON); if (v === '1') return true; if (v === '0') return false; return !_defaultAsk(); }
/** ¿Falta contestar la pregunta única? (solo con NEXO_DIAG_DEFAULT = 'ask' y sin elección previa) */
export function autoDiagNeedsAsk() { return _defaultAsk() && _lsGet(KEY_ON) == null; }
/** Muestra la pregunta única (una vez). Devuelve true si la mostró. */
export function autoDiagAskOnce() {
  try {
    if (!autoDiagNeedsAsk() || document.getElementById('nexo-diag-ask')) return false;
    var ov = document.createElement('div'); ov.id = 'nexo-diag-ask';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:24px;';
    var box = document.createElement('div');
    box.style.cssText = 'background:#14152a;color:#fff;max-width:420px;width:100%;border-radius:16px;padding:20px;box-shadow:0 10px 40px rgba(0,0,0,0.5);';
    var h = document.createElement('div'); h.style.cssText = 'font-size:18px;font-weight:700;margin-bottom:8px;'; h.textContent = t('diag_ask_title', 'Ayudar a mejorar NEXO');
    var p = document.createElement('div'); p.style.cssText = 'font-size:14px;line-height:1.45;opacity:0.9;margin-bottom:16px;'; p.textContent = t('diag_ask_text', 'Si algo falla, NEXO puede mandar un diagnóstico técnico al desarrollador, y una vez al día un resumen de uso (solo números). Va cifrado y nunca incluye tus mensajes ni nombres. Puedes cambiarlo cuando quieras en Perfil → Ajustes.');
    var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    var no = document.createElement('button'); no.id = 'nexo-diag-ask-no'; no.textContent = t('diag_ask_no', 'Ahora no'); no.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.35);border-radius:10px;padding:10px 14px;';
    var yes = document.createElement('button'); yes.id = 'nexo-diag-ask-yes'; yes.textContent = t('diag_ask_yes', 'Aceptar'); yes.style.cssText = 'background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:10px;padding:10px 16px;font-weight:700;';
    var done = function(on) { setAutoDiagEnabled(on); if (ov.parentNode) ov.parentNode.removeChild(ov); };
    no.onclick = function() { done(false); }; yes.onclick = function() { done(true); };
    row.appendChild(no); row.appendChild(yes); box.appendChild(h); box.appendChild(p); box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
    return true;
  } catch (e) { return false; }
}
export function setAutoDiagEnabled(on) { _lsSet(KEY_ON, on ? '1' : '0'); console.log('[AUTODIAG] ' + (on ? 'encendido' : 'apagado') + ' por el usuario'); _emit(); }
export function autoDiagDevNx() { return _normId((typeof window !== 'undefined' && window.NEXO_DIAG_DEV) || DIAG_DEV_NX); }

// Recorte: la cabecera (3 líneas) + la línea del síntoma + lo MÁS RECIENTE hasta DIAG_MAX_CHARS
function _compose(kind, info) {
  var full = '';
  try { full = _diagnosticText(); } catch (e) { full = 'NEXO diagnóstico (no se pudo armar: ' + (e && e.message) + ')'; }
  var head = 'NEXO diagnóstico AUTOMÁTICO · síntoma: ' + kind + (info ? ' (' + info + ')' : '') + ' · build ' + autoDiagBuild() + ' · ' + new Date().toISOString() + '\n';
  var max = DIAG_MAX_CHARS - head.length;
  if (full.length <= max) return head + full;
  // 3020: se conserva la cabecera ENTERA hasta el primer registro (incluye la sección ESTADO: zona, caminos, línea de tiempo)
  var cut = full.search(/\n===== (REGISTRO NATIVO|SESIÓN)/);
  var top = (cut > 0 && cut < max / 2) ? full.substring(0, cut) : full.split('\n').slice(0, 3).join('\n');
  top += '\n… (recortado: se manda lo más reciente) …\n'; // i18n-ok: texto del diagnóstico (para el desarrollador)
  return head + top + full.substring(full.length - (max - top.length));
}

// Síntoma → diagnóstico al desarrollador. Devuelve por qué NO se mandó, o 'enviado' / 'local' (soy el desarrollador).
export function autoDiagReport(kind, info) {
  kind = String(kind || 'sintoma').substring(0, 40); info = String(info == null ? '' : info).substring(0, 120);
  if (!autoDiagEnabled()) return 'apagado';
  var now = Date.now(), s = _state(), dev = autoDiagDevNx(), me = _me(), id = null;
  var key = kind + '|' + info;
  if (s.same && s.same[key] && now - s.same[key] < SAME_MS) return 'repetido';
  if (s.lastAt && now - s.lastAt < _knob('NEXO_AUTODIAG_GAP_MS', GAP_MS)) return 'espera';
  var day = _dayKey(now); if (s.day !== day) { s.day = day; s.count = 0; }
  if ((s.count || 0) >= _knob('NEXO_AUTODIAG_MAX_DAY', MAX_PER_DAY)) return 'tope';
  var isDev = !!me && me === dev;
  var viaCh = diagChannelAvailable();            // 2992: canal directo a Claude (relés, llave de diagnóstico aparte)
  var devOk = isDev || (!!dev && _isContact(dev));
  if (!devOk && !viaCh) { console.log('[AUTODIAG] síntoma «' + kind + '»: el desarrollador no está entre los contactos → no se manda'); return 'sin_contacto'; }
  var text = _compose(kind, info);
  if (viaCh) { try { diagChannelSend(kind, info, text, autoDiagBuild()); } catch (e) {} }
  if (isDev) {
    _store({ from: me, at: now, sym: kind, info: info, build: autoDiagBuild(), text: text, seen: false, local: true });
  } else if (devOk) {
    var wire = JSON.stringify({ type: 'nexo_diag', v: 1, sym: kind, info: info, build: autoDiagBuild(), at: now, text: text });
    id = _sendTextTo(dev, wire, '', true);
    if (!id) { if (!viaCh) return 'no_envio'; }
    else _ackIds[id] = now;
  }
  s.lastAt = now; s.count = (s.count || 0) + 1;
  s.same = s.same || {}; s.same[key] = now;
  Object.keys(s.same).forEach(function(k) { if (now - s.same[k] > SAME_MS) delete s.same[k]; });
  s.sent = s.sent || []; s.sent.unshift({ at: now, sym: kind, info: info, kb: _kb(text.length), id: id, ok: isDev || !devOk });
  if (s.sent.length > SENT_MAX) s.sent.length = SENT_MAX;
  var first = !s.first; if (first) s.first = now;
  _saveState(s);
  console.log('[AUTODIAG] síntoma «' + kind + '»' + (info ? ' (' + info + ')' : '') + ' → diagnóstico ' + (isDev ? 'guardado en este teléfono (soy el desarrollador)' : 'al desarrollador ' + dev + ' (' + id + ')') + ', ' + _kb(text.length) + ' KB');
  _askPeer(kind, info, now); // 3020 (B): el otro teléfono implicado manda el suyo (si lo tiene encendido)
  if (first && !isDev) { try { _showToast(t('autodiag_first_toast', 'Se mandó un diagnóstico técnico al desarrollador (sin tus mensajes). Puedes apagarlo en Perfil.'), 'info'); } catch (e) {} }
  _emit();
  return isDev ? 'local' : 'enviado';
}

// 2989: resumen diario de uso (usage_stats.js): mismo canal cifrado y mismo interruptor; no gasta el cupo de síntomas (2 h / 3 por día).
// Devuelve 'enviado' | 'local' (soy el desarrollador) | 'apagado' | 'sin_contacto' | 'no_envio'.
export function autoDiagSendSummary(day, text) {
  if (!autoDiagEnabled()) return 'apagado';
  var now = Date.now(), dev = autoDiagDevNx(), me = _me(), isDev = !!me && me === dev;
  var viaCh = diagChannelAvailable(), devOk = isDev || (!!dev && _isContact(dev));
  if (!devOk && !viaCh) return 'sin_contacto';
  var full = 'NEXO RESUMEN DIARIO de uso · ' + day + ' · build ' + autoDiagBuild() + '\n' + String(text || '').substring(0, 4000);
  var sym = 'resumen_diario';
  if (viaCh) { try { diagChannelSend(sym, day, full, autoDiagBuild()); } catch (e) {} }
  if (isDev) { _store({ from: me, at: now, sym: sym, info: day, build: autoDiagBuild(), text: full, seen: false, local: true }); }
  else if (devOk) {
    var wire = JSON.stringify({ type: 'nexo_diag', v: 1, sym: sym, info: day, build: autoDiagBuild(), at: now, text: full });
    var id = _sendTextTo(dev, wire, '', true);
    if (!id) { if (!viaCh) return 'no_envio'; }
    else _ackIds[id] = now;
  }
  _emit();
  return isDev ? 'local' : 'enviado';
}

// 3020 (B, plan de diagnóstico del dueño 12-11): DIAGNÓSTICO EMPAREJADO. Un fallo entre dos teléfonos se entiende con los
// DOS registros (quién mandó, quién no confirmó). Si el síntoma nombra a un contacto (su NEXO ID va al principio del
// detalle) y hay camino con él ahora, se le pide —con un mensaje oculto cifrado, sin texto— que mande el suyo. Él lo manda
// SOLO si tiene el diagnóstico automático encendido (su interruptor manda) y con sus propios límites. Un pedido por contacto
// cada PAIR_ASK_MS; un diagnóstico pedido no pide a su vez (sin ping-pong). Una build anterior ignora el pedido (sin «text»).
var PAIR_ASK_MS = 30 * 60 * 1000, _pairAsked = {}, _pairGot = {};
function _askPeer(kind, info, now) {
  if (/^par:/.test(kind)) return;
  var m = /^(nx[0-9a-z]{8})\b/.exec(String(info || '')); if (!m) return;
  var nx = m[1], bi = (typeof window !== 'undefined') ? window.bleInterface : null;
  if (nx === _me() || !_isContact(nx) || now - (_pairAsked[nx] || 0) < _knob('NEXO_AUTODIAG_PAIR_MS', PAIR_ASK_MS)) return;
  var via = 'none'; try { via = bi && typeof bi.linkOf === 'function' ? bi.linkOf(nx) : 'none'; } catch (e) {}
  if (via === 'none') return; // sin camino ahora: no se deja un pedido pendiente que llegaría tarde
  _pairAsked[nx] = now;
  var id = _sendTextTo(nx, JSON.stringify({ type: 'nexo_diag', v: 1, req: 1, sym: kind, at: now }), '', true);
  // su confirmación no cuenta como «el contacto ya confirma» para la espera de reenvíos (ble_ack._applyAck)
  if (id && bi) { bi._noBackoffAckIds = bi._noBackoffAckIds || new Set(); bi._noBackoffAckIds.add(id); if (bi._noBackoffAckIds.size > 50) bi._noBackoffAckIds.delete(bi._noBackoffAckIds.values().next().value); }
  console.log('[AUTODIAG] pido a ' + nx + ' su diagnóstico (síntoma «' + kind + '», camino ' + via + ')' + (id ? '' : ': no salió'));
}
function _pairRequest(from, k) {
  var now = Date.now(), sym = String(k.sym || 'sintoma').replace(/[^a-z_]/gi, '').substring(0, 30) || 'sintoma';
  if (!_isContact(from)) return 'no_contacto';
  if (now - (_pairGot[from] || 0) < _knob('NEXO_AUTODIAG_PAIR_MS', PAIR_ASK_MS)) return 'reciente';
  _pairGot[from] = now;
  var r = autoDiagReport('par:' + sym, 'pedido por ' + from);
  console.log('[AUTODIAG] ' + from + ' pidió mi diagnóstico (su síntoma «' + sym + '»): ' + r);
  return r;
}

// Lo que llega de un probador (main.js, mensaje oculto nexo_diag ya descifrado): a la bandeja, nunca al chat
export function autoDiagReceived(fromNx, k) {
  if (k && k.v === 1 && k.req === 1) { var fr = _normId(fromNx); if (/^nx[0-9a-z]{8}$/.test(fr)) _pairRequest(fr, k); return true; } // 3020 (B)
  if (!k || k.v !== 1 || typeof k.text !== 'string') return false;
  var from = _normId(fromNx);
  if (!/^nx[0-9a-z]{8}$/.test(from)) return false;
  var text = k.text.substring(0, DIAG_MAX_CHARS + 2000);
  _store({ from: from, at: Date.now(), sentAt: Number(k.at) || 0, sym: String(k.sym || '').substring(0, 40), info: String(k.info || '').substring(0, 120), build: String(k.build || '').substring(0, 12), text: text, seen: false });
  console.log('[AUTODIAG] llegó un diagnóstico automático de ' + from + ' (' + (k.sym || '?') + ', build ' + (k.build || '?') + ', ' + _kb(text.length) + ' KB)');
  try { _showToast(t('autodiag_received_toast', 'Llegó un diagnóstico automático de ') + from, 'info'); } catch (e) {}
  return true;
}

function _store(entry) { var list = autoDiagInbox(); list.unshift(entry); if (list.length > INBOX_MAX) list.length = INBOX_MAX; _inbox = list; _saveInbox(); _emit(); }
function _saveInbox() { _lsSet(KEY_INBOX, JSON.stringify(_inbox || [])); }
export function autoDiagInbox() {
  if (_inbox) return _inbox;
  try { _inbox = JSON.parse(_lsGet(KEY_INBOX) || '[]'); } catch (e) { _inbox = []; }
  if (!Array.isArray(_inbox)) _inbox = [];
  return _inbox;
}
export function autoDiagNewCount() { return autoDiagInbox().filter(function(e) { return !e.seen; }).length; }
export function autoDiagInboxText(onlyNew) {
  return autoDiagInbox().filter(function(e) { return !onlyNew || !e.seen; }).map(function(e) {
    return '===== DIAGNÓSTICO AUTOMÁTICO de ' + e.from + ' · ' + new Date(e.at).toISOString() + ' · síntoma: ' + e.sym + (e.info ? ' (' + e.info + ')' : '') + ' · build ' + (e.build || '?') + ' =====\n' + e.text;
  }).join('\n\n');
}
export function autoDiagMarkSeen() { autoDiagInbox().forEach(function(e) { e.seen = true; }); _saveInbox(); _emit(); }
export function autoDiagClearInbox() { _inbox = []; _saveInbox(); _emit(); }
export function autoDiagSentList() { return _state().sent || []; }

// Pendientes VIEJOS con el contacto alcanzable (texto o archivo que lleva > OLD_PENDING_MS ⏳ aunque hay camino): un síntoma
// por barrido, cada mensaje una sola vez. Mensajes ocultos (acciones, los propios diagnósticos) no cuentan.
export function autoDiagScanPending() {
  var bi = (typeof window !== 'undefined') ? window.bleInterface : null;
  if (!bi || typeof bi.linkOf !== 'function' || typeof window.vaultLoadMessages !== 'function') return Promise.resolve(null);
  // Pendientes del contacto: la API del vault si está expuesta; si no, el historial filtrado como hace el reenvío de pendientes
  var pend = function(nx) { return (typeof window.vaultGetPendingMessages === 'function') ? window.vaultGetPendingMessages(nx) : window.vaultLoadMessages(nx).then(function(l) { return (l || []).filter(function(m) { return _isResendable(m, nx); }); }); };
  var oldMs = _knob('NEXO_AUTODIAG_OLD_MS', OLD_PENDING_MS), now = Date.now(), found = null;
  var reach = (_getBLEContacts() || []).map(function(c) { return _normId(c.nexoId || c.deviceUUID); }).filter(function(nx) { try { return !!nx && bi.linkOf(nx) !== 'none'; } catch (e) { return false; } });
  return reach.reduce(function(p, nx) {
    return p.then(function() {
      if (found) return;
      return pend(nx).then(function(list) {
        (list || []).some(function(m) {
          var id = m.msgId || m.messageId || m.id;
          if (!id || m.hidden || _reportedPending[id] || now - (m.timestamp || now) < oldMs) return false;
          // 2999 (diagnóstico real leído por el canal, 11-11): un archivo grande que NO cabe por Bluetooth espera Wi-Fi/internet a propósito (la app del otro
          // dormida, p. ej.): no es un fallo y llenaba el diagnóstico con «pendiente viejo» de 34 h. Solo cuenta si el enlace de ahora ya serviría.
          var via0 = ''; try { via0 = bi.linkOf(nx); } catch (e0) {}
          // 3032 (diagnóstico S24 3025 12-11 14:20: «pendiente viejo» de 428 min de un APK de 25 MB al vivo con enlace «jump»): un puente
          // Jump también va por Bluetooth, así que tampoco sirve para un archivo que no cabe por Bluetooth.
          if ((via0 === 'bluetooth' || via0 === 'jump') && _tooBigForBt(m)) return false;
          _reportedPending[id] = now;
          found = { nx: nx, id: id, min: Math.round((now - m.timestamp) / 60000), via: bi.linkOf(nx) };
          return true;
        });
      }).catch(function() {});
    });
  }, Promise.resolve()).then(function() {
    if (found) autoDiagReport('pendiente_viejo', found.nx + ' ' + found.id + ' ' + found.min + ' min, enlace ' + found.via);
    return found;
  });
}

export function autoDiagInit() {
  if (typeof window === 'undefined' || window.__nexoAutoDiag) return;
  setTimeout(function() { autoDiagAskOnce(); }, 6000);
  diagChannelInit();   // 2992: canal directo a Claude (cola de reintentos)   // 2991: pregunta única (solo con NEXO_DIAG_DEFAULT = 'ask')
  window.addEventListener('nexo:diag:symptom', function(e) { var d = (e && e.detail) || {}; try { autoDiagReport(d.kind || 'sintoma', d.info || ''); } catch (err) {} });
  // Errores de código: un rato después, para que la línea [ERROR] ya esté en el registro; cada mensaje una sola vez por sesión
  window.addEventListener('error', function(e) {
    var msg = String((e && e.message) || ''); if (!msg || /Script error|ResizeObserver/i.test(msg) || _errSeen[msg]) return;
    _errSeen[msg] = 1; setTimeout(function() { try { autoDiagReport('error', msg.substring(0, 100)); } catch (err) {} }, 1500);
  });
  window.addEventListener('unhandledrejection', function(e) {
    var msg = String((e && e.reason && (e.reason.message || e.reason)) || ''); if (!msg || _errSeen['p:' + msg]) return;
    _errSeen['p:' + msg] = 1; setTimeout(function() { try { autoDiagReport('promesa', msg.substring(0, 100)); } catch (err) {} }, 1500);
  });
  // ✓ en «últimos envíos» cuando el desarrollador confirma el mensaje oculto
  window.addEventListener('nexo:ble:ackStatus', function(e) {
    var d = e && e.detail; if (!d || !d.msgId || !_ackIds[d.msgId] || (d.status !== 'delivered' && d.status !== 'read')) return;
    var s = _state(); (s.sent || []).forEach(function(x) { if (x.id === d.msgId) x.ok = true; }); _saveState(s); delete _ackIds[d.msgId]; _emit();
  });
  var scanMs = _knob('NEXO_AUTODIAG_SCAN_MS', SCAN_MS);
  setTimeout(function() { autoDiagScanPending(); setInterval(autoDiagScanPending, scanMs); }, Math.min(scanMs, 60000));
  window.__nexoAutoDiag = { ask: autoDiagAskOnce, needsAsk: autoDiagNeedsAsk, report: autoDiagReport, inbox: autoDiagInbox, text: autoDiagInboxText, state: _state, enabled: autoDiagEnabled, setEnabled: setAutoDiagEnabled, clear: autoDiagClearInbox, markSeen: autoDiagMarkSeen, scan: autoDiagScanPending, newCount: autoDiagNewCount, dev: autoDiagDevNx };
  console.log('[AUTODIAG] activo (' + (autoDiagEnabled() ? 'encendido' : 'apagado') + '); desarrollador ' + autoDiagDevNx() + '; build ' + autoDiagBuild());
}

// ---- Perfil → Ajustes (profile.js): interruptor, últimos envíos y la bandeja del desarrollador ----
function _fmtTime(ts) { try { var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); } catch (e) { return '?'; } }
function _fmtDate(ts) { try { var d = new Date(ts); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + _fmtTime(ts); } catch (e) { return '?'; } }
function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
export function autoDiagInnerHtml() {
  var on = autoDiagEnabled(), isDev = !!_me() && _me() === autoDiagDevNx();
  var sent = autoDiagSentList(), inbox = autoDiagInbox(), nuevos = autoDiagNewCount();
  var h = '<label style="display:flex;align-items:center;gap:10px;font-size:14px;"><input type="checkbox" id="nexo-autodiag-on"' + (on ? ' checked' : '') + '> ' + t('autodiag_toggle', 'Mandar un diagnóstico técnico al desarrollador cuando la app detecta un fallo') + '</label>' +
    '<div class="nx-sub" style="margin-top:6px;">' + t('autodiag_sub', 'Se manda solo (enlace Bluetooth muerto, un envío que no sale, un error). Va cifrado de extremo a extremo al desarrollador, sin el contenido de tus mensajes; como mucho uno cada 2 horas y 3 por día. Además, una vez al día se manda un resumen de uso: solo números (cuántos mensajes y de qué tipo), sin contenido ni nombres.') + '</div>' +
    '<div class="nx-sub" id="nexo-autodiag-sent" style="margin-top:6px;">' + (sent.length
      ? _esc(t('autodiag_sent_last', 'Últimos envíos:') + ' ' + sent.slice(0, 3).map(function(x) { return _fmtDate(x.at) + ' ' + x.sym + ' ' + x.kb + ' KB' + (x.ok ? ' ✓' : ' ⏳'); }).join(' · '))
      : _esc(t('autodiag_sent_none', 'Todavía no se mandó ninguno'))) + '</div>';
  if (isDev || inbox.length) {
    h += '<div style="margin-top:10px;font-weight:600;">' + t('autodiag_inbox_title', 'Diagnósticos recibidos') + ' (' + inbox.length + (nuevos ? ', ' + nuevos + ' ' + t('autodiag_new', 'nuevos') : '') + ')</div>' +
      '<div class="nx-sub" id="nexo-autodiag-list" style="font-family:monospace;font-size:11px;">' + (inbox.length
        ? inbox.slice(0, 8).map(function(e) { return _esc((e.seen ? '  ' : '● ') + e.from + ' · ' + _fmtDate(e.at) + ' · ' + e.sym + ' · build ' + (e.build || '?') + ' · ' + _kb(e.text.length) + ' KB'); }).join('<br>')
        : _esc(t('autodiag_none', 'Ninguno todavía'))) + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">' +
      '<button id="nexo-autodiag-copy-new" class="nx-btn nx-btn-primary">' + t('autodiag_copy_new', 'Copiar los nuevos') + '</button>' +
      '<button id="nexo-autodiag-copy-all" class="nx-btn">' + t('autodiag_copy_all', 'Copiar todos') + '</button>' +
      '<button id="nexo-autodiag-clear" class="nx-btn">' + t('autodiag_clear', 'Borrar') + '</button></div>';
  }
  return h;
}
function _copy(text, btn, label) {
  var ok = function() { btn.textContent = t('autodiag_copied', 'Copiado ✓'); setTimeout(function() { btn.textContent = label; }, 2000); };
  var fb = function() { try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.parentNode.removeChild(ta); ok(); } catch (e) { btn.textContent = t('autodiag_copy_fail', 'No se pudo copiar'); } };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok).catch(fb); else fb();
}
export function renderAutoDiagSection(sheet) {
  if (!sheet) return;
  var box = sheet.querySelector('#nexo-autodiag-on');
  if (box) box.onchange = function() { setAutoDiagEnabled(box.checked); };
  var bNew = sheet.querySelector('#nexo-autodiag-copy-new'), bAll = sheet.querySelector('#nexo-autodiag-copy-all'), bClr = sheet.querySelector('#nexo-autodiag-clear');
  if (bNew) bNew.onclick = function() { var txt = autoDiagInboxText(true); if (!txt) { bNew.textContent = t('autodiag_none', 'Ninguno todavía'); setTimeout(function() { bNew.textContent = t('autodiag_copy_new', 'Copiar los nuevos'); }, 1500); return; } _copy(txt, bNew, t('autodiag_copy_new', 'Copiar los nuevos')); autoDiagMarkSeen(); };
  if (bAll) bAll.onclick = function() { var txt = autoDiagInboxText(false); if (!txt) return; _copy(txt, bAll, t('autodiag_copy_all', 'Copiar todos')); autoDiagMarkSeen(); };
  if (bClr) bClr.onclick = function() { if (!window.confirm(t('autodiag_clear_confirm', '¿Borrar los diagnósticos recibidos?'))) return; autoDiagClearInbox(); var l = sheet.querySelector('#nexo-autodiag-list'); if (l) l.textContent = t('autodiag_none', 'Ninguno todavía'); };
}
