/**
 * NEXO — SEGUNDA llamada 1-a-1 a la vez (#220 fase 2, dueño 15-11: «estaba en dos llamadas diferentes al mismo tiempo… la pantalla
 * dividida y con sus respectivos botones, con su respectiva cámara… se pueden hacer dos videollamadas o dos llamadas al mismo tiempo
 * y nada más»). La segunda llamada es otra instancia de calls.js (bleInterface.calls2, lane 2, eventos 'nexo:call2'). Su pantalla
 * va en la mitad de abajo cuando la primera sigue (calls_ui.syncCallSplit) y en toda la pantalla cuando se queda sola.
 * Suena dentro de la app (no pasa por la llamada del sistema): Contestar / Rechazar; en curso: Silenciar, Cámara (videollamada),
 * Colgar. Con la app en segundo plano, aviso de mensaje «Llamada de X (estás en otra llamada)».
 */
import { callButton, ensureCallStyle, fitCallLabels, syncCallSplit } from './calls_ui.js';
import { vaultFindContactByNexoId } from '../vault/vault_manager.js';
import { t } from './i18n.js';

function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _calls2() { var b = _bi(); return b && b.calls2; }
function _name(nx) { var c = vaultFindContactByNexoId(nx); return (c && (c.name || c.displayName)) || String(nx || '').toUpperCase(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _fmt(s) { s = Math.max(0, Math.floor(s)); var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }

var _tick = null, _rm = null, _vid = null;

function _screen() {
  var el = document.getElementById('nexo-call2-screen');
  if (el) return el;
  ensureCallStyle();
  el = document.createElement('div');
  el.id = 'nexo-call2-screen';
  el.innerHTML = '<div class="c2-head"><span class="c2-tag"></span><div class="c2-name"></div><div class="c2-status"></div></div>' +
    '<div class="call-buttons"></div>';
  (document.body || document.documentElement).appendChild(el);
  return el;
}

function _remove() {
  clearInterval(_tick); _tick = null;
  var el = document.getElementById('nexo-call2-screen');
  if (el) el.remove();
  _vid = null;
  syncCallSplit();
}

function _attachVideo(el, calls) {
  var v = calls && typeof calls.videoViews === 'function' ? calls.videoViews() : null;
  var remote = v && v.remote;
  if (remote && remote !== _vid) {
    if (_vid && _vid.parentNode === el) _vid.remove();
    remote.classList.add('c2-video');
    el.insertBefore(remote, el.firstChild);
    _vid = remote;
  }
}

function _render(st) {
  var calls = _calls2();
  clearTimeout(_rm); _rm = null;
  if (!st || st.state === 'ended') {
    clearInterval(_tick); _tick = null;
    var old = document.getElementById('nexo-call2-screen');
    if (!old) { syncCallSplit(); return; }
    var s0 = old.querySelector('.c2-status');
    if (s0 && st) s0.textContent = st.reason === 'busy' ? t('call_end_busy', 'Ocupado') : st.reason === 'rejected' ? t('call_end_rejected', 'Rechazada') : t('call_end_finished', 'Llamada terminada');
    old.querySelector('.call-buttons').innerHTML = '';
    _rm = setTimeout(_remove, 1400);
    return;
  }
  var el = _screen();
  syncCallSplit();
  el.querySelector('.c2-tag').textContent = t('call2_second', 'Segunda llamada');
  el.querySelector('.c2-name').textContent = _name(st.nx);
  var status = el.querySelector('.c2-status'), bt = el.querySelector('.call-buttons');
  bt.innerHTML = '';
  clearInterval(_tick); _tick = null;
  if (st.state === 'ringing') {
    status.textContent = st.video ? t('call_incoming_video', 'Videollamada entrante') : t('call_incoming_voice', 'Llamada entrante');
    bt.appendChild(callButton('phone', t('call_reject', 'Rechazar'), 'call-reject', function() { calls.reject(); }, 'nc-red'));
    bt.appendChild(callButton(st.video ? 'cam' : 'phone', t('call2_accept', 'Contestar'), 'call-accept', function() { calls.accept(); }, 'nc-green'));
    _notifyHidden(st);
  } else if (st.state === 'calling') {
    status.textContent = st.video ? t('call_videocalling', 'Videollamada…') : t('call_calling', 'Llamando…');
    bt.appendChild(callButton('phone', t('call_hangup', 'Colgar'), 'call-hangup', function() { calls.hangup(); }, 'nc-red'));
  } else {
    var upd = function() { var s = calls.state(); if (s && s.startedAt) status.textContent = _fmt((Date.now() - s.startedAt) / 1000); };
    upd(); _tick = setInterval(upd, 1000);
    bt.appendChild(callButton(st.muted ? 'micOff' : 'mic', st.muted ? t('call_muted', 'Silenciado') : t('call_mute', 'Silenciar'), 'call-mute', function() { calls.mute(!calls.state().muted); }, st.muted ? 'nc-on' : ''));
    if (st.video) bt.appendChild(callButton(st.cameraOff ? 'camOff' : 'cam', st.cameraOff ? t('call_camera_off', 'Cámara no') : t('call_camera', 'Cámara'), 'call-camera', function() { calls.camera(!!calls.state().cameraOff); }, st.cameraOff ? 'nc-on' : ''));
    bt.appendChild(callButton('phone', t('call_hangup', 'Colgar'), 'call-hangup', function() { calls.hangup(); }, 'nc-red'));
    if (st.video) _attachVideo(el, calls);
  }
  fitCallLabels(bt);
}

// Con la app en segundo plano, la segunda llamada avisa como mensaje (la del sistema la tiene la primera)
function _notifyHidden(st) {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return;
  var pl = _plugin();
  if (pl && typeof pl.notifyMessage === 'function') pl.notifyMessage({ chatId: st.nx, name: _name(st.nx), msgId: 'c2_' + (st.id || ''), text: t('call2_notif', '📞 Llamada (estás en otra llamada)'), count: 1 }).catch(function() {});
}

export function installCalls2Ui() {
  window.addEventListener('nexo:call2', function(e) { _render(e && e.detail); });
}
