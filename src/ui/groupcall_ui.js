/**
 * groupcall_ui.js (#128, build 2846+): pantalla y botón de las LLAMADAS EN GRUPO (la lógica, en group_call.js).
 * Fase 1 = audio (malla). Incremento 1: cableado + pantalla; el audio real llega con call_group_media (incremento 2),
 * así que por ahora la pantalla muestra el estado de la malla (quién está, conectando, etc.) sin sonido.
 *
 * Botón «Llamar al grupo» en la cabecera del chat (solo cuando el chat es un grupo; los botones 1-a-1 de calls_ui se
 * ocultan ahí). La pantalla escucha nexo:gcall (estado), nexo:gcallRing (entrante) y nexo:gcallEnded (fin).
 */
import { t } from './i18n.js';
import { _showInfoToast } from './ui_bits.js';
import { _getCurrentContactId, _normId } from './chat_format.js';

function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _gcall() { var b = _bi(); return b && b.gcall; }
function _groups() { var b = _bi(); return b && b.groups; }
function _me() { return _normId(_bi() && _bi().localNexoId); }
function _memberName(nx) { var gs = _groups(); return (gs && typeof gs.memberName === 'function' && gs.memberName(nx)) || (nx || '').toUpperCase(); }

// Texto del estado de un tramo (participante) de la malla. #130 (dueño 31-10): un tramo activo que pierde la voz muestra
// «Reconectando…» (como la 1-a-1); a los 15 s pasa a «Sin señal» (la llamada sigue con los demás).
function _legLabel(state, reconnecting) {
  if (state === 'active') return reconnecting ? t('call_reconnecting', 'Reconectando…') : t('grp_leg_active', 'En la llamada');
  if (state === 'offering' || state === 'waiting' || state === 'inviting' || state === 'new') return t('grp_leg_connecting', 'Conectando…');
  if (state === 'lost') return t('grp_leg_lost', 'Sin señal');
  if (state === 'gone') return t('grp_leg_gone', 'Salió');
  return t('grp_leg_connecting', 'Conectando…');
}

function _screen() {
  var el = document.getElementById('nexo-gcall-screen');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'nexo-gcall-screen';
  el.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:flex;flex-direction:column;align-items:center;' +
    'background:radial-gradient(circle at 30% 20%,rgba(0,200,255,.22),transparent 45%),radial-gradient(circle at 75% 75%,rgba(168,85,247,.24),transparent 50%),linear-gradient(160deg,#0a0a15,#14152a 60%,#0b1a33);' +
    'color:#fff;font-family:inherit;padding:32px 20px;box-sizing:border-box;';
  el.innerHTML =
    '<div class="gc-pill" style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.08);padding:5px 12px;border-radius:14px;font-size:12px;">' +
    '<span>🔒</span><span class="gc-e2e"></span></div>' +
    '<div class="gc-title" style="margin-top:18px;font-size:22px;font-weight:700;text-align:center;"></div>' +
    '<div class="gc-status" style="margin-top:6px;font-size:14px;opacity:0.8;"></div>' +
    '<div class="gc-members" style="margin-top:26px;width:100%;max-width:340px;display:flex;flex-direction:column;gap:10px;flex:1;overflow:auto;"></div>' +
    '<div class="gc-buttons" style="display:flex;gap:22px;justify-content:center;padding:14px 0 6px;"></div>';
  (document.body || document.documentElement).appendChild(el);
  return el;
}

function _btn(label, cls, fn) {
  var b = document.createElement('button');
  b.className = 'gc-btn ' + cls;
  b.textContent = label;
  var base = 'min-width:120px;padding:14px 18px;border:none;border-radius:16px;font-size:15px;font-weight:600;color:#fff;cursor:pointer;';
  var bg = cls === 'gc-red' ? 'background:linear-gradient(135deg,#ff4d4f,#c1121f);' : cls === 'gc-green' ? 'background:linear-gradient(135deg,#22c55e,#00c8ff);' : 'background:rgba(255,255,255,0.14);';
  b.style.cssText = base + bg;
  b.addEventListener('click', function(e) { e.stopPropagation(); fn(); });
  return b;
}

function _remove() { var el = document.getElementById('nexo-gcall-screen'); if (el) el.remove(); }

// #130 (dueño 31-10): al cortarse la llamada de grupo, volver al chat del grupo donde se hizo (como la 1-a-1)
function _openChatOf(cid) { try { var b = _bi(); cid = _normId(cid); if (b && typeof b.openChat === 'function' && cid) b.openChat(cid).catch(function() {}); } catch (e) {} }

// Pantalla de FIN cuando la llamada se cortó por quedarse sin nadie (análogo al corte 'lost' de la 1-a-1): 5 s con
// «Volver a llamar» y luego se cierra y vuelve al chat del grupo. Cualquier otro final (colgar, rechazar) se quita sin más.
var _endTimer = null;
function _removeEnded() { clearTimeout(_endTimer); _endTimer = null; var el = document.getElementById('nexo-gcall-ended'); if (el) el.remove(); }
function _showEnded(detail) {
  _remove(); _removeEnded();
  var chatId = _normId(detail && detail.chatId);
  var el = document.createElement('div');
  el.id = 'nexo-gcall-ended';
  el.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;' +
    'background:radial-gradient(circle at 30% 20%,rgba(0,200,255,.22),transparent 45%),radial-gradient(circle at 75% 75%,rgba(168,85,247,.24),transparent 50%),linear-gradient(160deg,#0a0a15,#14152a 60%,#0b1a33);' +
    'color:#fff;font-family:inherit;padding:32px 20px;box-sizing:border-box;';
  var title = document.createElement('div'); title.style.cssText = 'font-size:22px;font-weight:700;text-align:center;'; title.textContent = t('grp_call_title', 'Llamada de grupo');
  var sub = document.createElement('div'); sub.style.cssText = 'font-size:15px;opacity:0.85;'; sub.textContent = t('call_end_lost', 'Se cortó');
  var bar = document.createElement('div'); bar.style.cssText = 'margin-top:20px;';
  bar.appendChild(_btn(t('call_call_again', 'Volver a llamar'), 'gc-green', function() {
    _removeEnded();
    var gcall = _gcall(), gs = _groups();
    if (!gcall) return;
    var g = (gs && chatId) ? gs.get(chatId) : null;
    var members = (g && g.members) || (detail && detail.members) || [];
    gcall.start(members, !!(detail && detail.video), chatId).catch(function(err) { _showInfoToast((err && err.message) || 'Error', 3500); });
  }));
  el.appendChild(title); el.appendChild(sub); el.appendChild(bar);
  (document.body || document.documentElement).appendChild(el);
  _endTimer = setTimeout(function() { _removeEnded(); _openChatOf(chatId); }, 5000);
}

function _render(st) {
  var gcall = _gcall();
  if (!st) { _remove(); return; }
  var el = _screen();
  var me = _me();
  el.querySelector('.gc-e2e').textContent = t('call_e2e', 'Cifrada de extremo a extremo');
  // El gid de la llamada es propio (gc…), no el id del chat de grupo, así que el título es genérico.
  el.querySelector('.gc-title').textContent = t('grp_call_title', 'Llamada de grupo');
  var status = el.querySelector('.gc-status');
  if (st.state === 'ringing') status.textContent = t('grp_ring_in', 'Llamada de grupo entrante');
  else if (st.state === 'calling') status.textContent = t('grp_calling', 'Llamando…');
  else status.textContent = '';

  // Lista de participantes: yo + cada miembro con el estado de su tramo
  var legByNx = {};
  (st.legs || []).forEach(function(l) { legByNx[_normId(l.nx)] = l; });
  var box = el.querySelector('.gc-members');
  box.innerHTML = '';
  (st.members || []).forEach(function(nx) {
    nx = _normId(nx);
    var lg = legByNx[nx];
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,0.06);border-radius:12px;padding:10px 14px;';
    var name = document.createElement('span');
    name.style.cssText = 'font-size:15px;font-weight:600;';
    name.textContent = nx === me ? t('chat_you', 'Tú') : _memberName(nx);
    var sub = document.createElement('span');
    // «Reconectando…» en ámbar, «Sin señal» en rojo (como los avisos de mala conexión de la 1-a-1); el resto, tenue
    sub.style.cssText = 'font-size:12px;opacity:0.8;color:' + (lg && lg.state === 'lost' ? '#ff6b6b' : (lg && lg.reconnecting ? '#ffc23d' : 'rgba(255,255,255,0.7)')) + ';';
    sub.textContent = nx === me ? '' : _legLabel(lg && lg.state, lg && lg.reconnecting);
    row.appendChild(name); row.appendChild(sub);
    box.appendChild(row);
  });

  var bt = el.querySelector('.gc-buttons');
  bt.innerHTML = '';
  if (st.state === 'ringing') {
    bt.appendChild(_btn(t('call_reject', 'Rechazar'), 'gc-red', function() { if (_gcall()) _gcall().reject(); }));
    bt.appendChild(_btn(t('grp_join', 'Entrar'), 'gc-green', function() { if (_gcall()) _gcall().accept(); }));
  } else {
    bt.appendChild(_btn(t('call_hangup', 'Colgar'), 'gc-red', function() { if (_gcall()) _gcall().hangup(); }));
  }
}

// Botón «Llamar al grupo» en la cabecera del chat (solo en chats de grupo)
function _installGroupButton() {
  var header = document.getElementById('chat-header');
  if (!header || document.getElementById('nexo-gcall-btn')) return;
  var b = document.createElement('button');
  b.id = 'nexo-gcall-btn';
  b.title = t('grp_call_group_btn', 'Llamar al grupo');
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/><circle cx="18" cy="6" r="3" fill="#00c8ff" stroke="none"/></svg>';
  b.style.cssText = 'width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;font-size:18px;cursor:pointer;flex-shrink:0;margin-left:6px;display:none;';
  b.addEventListener('click', function(e) {
    e.stopPropagation();
    var gcall = _gcall(), gs = _groups(), cid = _getCurrentContactId();
    if (!gcall || !gs || !cid) return;
    var g = gs.get(cid);
    if (!g || !g.members) return;
    gcall.start(g.members, false, cid).catch(function(err) { _showInfoToast((err && err.message) || 'Error', 3500); });
  });
  header.appendChild(b);
}

function _refreshGroupButton() {
  var cid = _getCurrentContactId(), gs = _groups();
  var show = cid && gs && typeof gs.isGroup === 'function' && gs.isGroup(cid) ? '' : 'none';
  var b = document.getElementById('nexo-gcall-btn'); if (b) b.style.display = show;
}

function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _clearCallNotif() { var pl = _plugin(); if (pl && typeof pl.clearCall === 'function') pl.clearCall().catch(function() {}); }

// #dueño 31-10: una llamada de grupo entrante con la app en segundo plano/pantalla apagada tiene que SONAR y salir a
// pantalla completa (contestar/rechazar), igual que la 1-a-1. Antes la pantalla de grupo solo aparecía con la app abierta.
// Con la app oculta, se posta el aviso nativo de LLAMADA (CallStyle, full-screen intent que enciende la pantalla).
function _notifyGroupIncoming(ring) {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return;
  var pl = _plugin(), gc = _gcall(), st = gc && gc.state ? gc.state() : null;
  if (!pl || !st || st.state !== 'ringing' || typeof pl.notifyCall !== 'function') return;
  var host = (ring && ring.from) || st.host || '';
  pl.notifyCall({ chatId: host, name: _memberName(host), video: !!st.video, offerId: (ring && ring.gid) || st.gid || '' }).catch(function() {});
}

// «Contestar»/«Rechazar» tocados en el aviso nativo (pantalla de bloqueo): solo si hay una llamada de GRUPO sonando.
function _applyGroupCallAction(r) {
  var gc = _gcall(); var st = gc && gc.state ? gc.state() : null;
  if (!st || st.state !== 'ringing') return;
  if (r && (r.answer || r.answerOffer)) { try { gc.accept(); } catch (e) {} }
  else if (r && (r.declined || r.declinedOffer)) { try { gc.reject(); } catch (e) {} }
}

export function installGroupCallUi() {
  _installGroupButton();
  window.addEventListener('nexo:gcall', function(e) {
    var st = e && e.detail;
    if (st) _removeEnded(); // una llamada nueva/en curso quita la pantalla de «Volver a llamar» si quedaba
    if (!st || st.state === 'active') _clearCallNotif(); // contestada/terminada: fuera el aviso de llamada entrante
    _render(st);
  });
  window.addEventListener('nexo:gcallRing', function(e) { _removeEnded(); var gc = _gcall(); _render(gc && gc.state ? gc.state() : null); _notifyGroupIncoming(e && e.detail); });
  // #130 (dueño 31-10): si se cortó por quedarse sin nadie (empty) y sabemos el chat del grupo, 5 s de «Volver a llamar» y
  // volver a ese chat (como la 1-a-1). Cualquier otro final (colgar, rechazar, no contesta) cierra la pantalla sin más.
  window.addEventListener('nexo:gcallEnded', function(e) {
    _clearCallNotif();
    var d = e && e.detail;
    if (d && d.why === 'empty' && _normId(d.chatId)) _showEnded(d);
    else _remove();
  });
  window.addEventListener('nexo:ble:openChat', function() { setTimeout(_refreshGroupButton, 0); });
  // #dueño: contestar/rechazar la llamada de grupo desde el aviso nativo (también para grupos, como la 1-a-1)
  try { var pl = _plugin(); if (pl && typeof pl.addListener === 'function') pl.addListener('onCallAction', function(r) { setTimeout(function() { _applyGroupCallAction(r); }, 300); }); } catch (e) {}
}
