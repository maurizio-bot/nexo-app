/**
 * calls_ui.js v1.0 (ronda 2758) — Pantallas de las llamadas de voz (la lógica en calls.js): botón 📞 en la cabecera
 * del chat (solo chats 1:1), pantalla de llamada (saliente, entrante con timbre, en curso con tiempo y silencio) y la
 * línea que queda en el chat al terminar.
 */
import { _normId, _getCurrentContactId } from './chat_format.js';
import { _renderMessage } from './render.js';
import { _showInfoToast } from './ui_bits.js';
import { vaultAppendMessage, vaultFindContactByNexoId } from '../vault/vault_manager.js';

function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _calls() { var b = _bi(); return b && b.calls; }
function _name(nx) { var c = vaultFindContactByNexoId(nx); return (c && (c.name || c.displayName)) || String(nx || '').toUpperCase(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

var _tick = null, _ring = null;

// Timbre (entrante) o tono de llamada (saliente) con WebAudio; vibración en la entrante
function _startTone(incoming) {
  _stopTone();
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  var ctx;
  try { ctx = new AC(); } catch (e) { return; }
  var beep = function() {
    try {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = incoming ? 880 : 425; g.gain.value = incoming ? 0.25 : 0.12;
      o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (incoming ? 0.4 : 1.0));
    } catch (e) {}
    if (incoming && navigator.vibrate) try { navigator.vibrate([400, 200, 400]); } catch (e) {}
  };
  beep();
  _ring = { ctx: ctx, timer: setInterval(beep, incoming ? 1500 : 4000) };
}
function _stopTone() {
  if (!_ring) return;
  clearInterval(_ring.timer);
  try { _ring.ctx.close(); } catch (e) {}
  _ring = null;
}

// Videollamada: la imagen del otro a pantalla completa y la propia en una esquina
function _videoLayout(el, st) {
  var calls = _calls();
  if (!st.video || st.state !== 'active' || !calls) return;
  var v = calls.videoViews();
  if (v.remote && v.remote.parentNode !== el) {
    v.remote.className = 'call-remote-video';
    v.remote.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;z-index:-1;';
    el.insertBefore(v.remote, el.firstChild);
  }
  if (v.local && v.local.parentNode !== el) {
    v.local.className = 'call-local-video';
    v.local.style.cssText = 'position:absolute;right:14px;top:14px;width:96px;height:128px;object-fit:cover;border-radius:10px;border:2px solid rgba(255,255,255,0.6);transform:scaleX(-1);background:#222;';
    el.appendChild(v.local);
  }
}

function _fmt(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

function _screen() {
  var el = document.getElementById('nexo-call-screen');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'nexo-call-screen';
  el.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:linear-gradient(160deg,#0a0a15,#14152a 60%,#0f3460);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:64px 24px 56px;box-sizing:border-box;';
  el.innerHTML = '<div style="text-align:center;"><div style="width:96px;height:96px;border-radius:50%;background:linear-gradient(135deg,#00c8ff,#a855f7);display:flex;align-items:center;justify-content:center;font-size:40px;margin:0 auto 18px;">📞</div>' +
    '<div class="call-name" style="font-size:24px;font-weight:700;"></div><div class="call-status" style="font-size:15px;opacity:0.8;margin-top:8px;"></div><div class="call-note" style="font-size:12px;opacity:0.6;margin-top:6px;"></div></div>' +
    '<div class="call-buttons" style="display:flex;gap:36px;align-items:center;"></div>';
  document.body.appendChild(el);
  return el;
}
function _btn(label, color, cls, fn) {
  var b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.style.cssText = 'width:68px;height:68px;border-radius:50%;border:none;font-size:26px;color:#fff;background:' + color + ';cursor:pointer;';
  b.onclick = function(e) { e.stopPropagation(); fn(); };
  return b;
}

function _render(st) {
  var calls = _calls();
  clearInterval(_tick);
  if (!st || st.state === 'ended') {
    _stopTone();
    var old = document.getElementById('nexo-call-screen');
    if (old) {
      var s0 = old.querySelector('.call-status');
      if (s0 && st) s0.textContent = st.reason === 'busy' ? 'Ocupado' : st.reason === 'rejected' ? 'Rechazada' : st.reason === 'unanswered' ? 'No contesta' : st.reason === 'lost' ? 'Se cortó' : 'Llamada terminada';
      old.querySelector('.call-buttons').innerHTML = '';
      setTimeout(function() { old.remove(); }, 1200);
    }
    try { var pl = _plugin(); if (pl && typeof pl.callAudio === 'function') pl.callAudio({ on: false }).catch(function() {}); } catch (e) {}
    return;
  }
  var el = _screen();
  el.querySelector('.call-name').textContent = _name(st.nx);
  var status = el.querySelector('.call-status'), note = el.querySelector('.call-note'), bt = el.querySelector('.call-buttons');
  bt.innerHTML = '';
  note.textContent = st.micError ? 'Sin micrófono: ' + st.micError : st.video && st.videoOk === false ? 'Sin cámara en este teléfono: solo voz' : (st.codec ? 'Cifrada de extremo a extremo · ' + (st.codec === 'opus' ? 'Opus' : 'μ-law') : 'Cifrada de extremo a extremo');
  _videoLayout(el, st);
  if (st.state === 'calling') {
    status.textContent = st.video ? 'Videollamando…' : 'Llamando…';
    bt.appendChild(_btn('✕', '#e53935', 'call-hangup', function() { calls.hangup(); }));
    if (!_ring) _startTone(false);
  } else if (st.state === 'ringing') {
    status.textContent = st.video ? 'Videollamada entrante' : 'Llamada entrante';
    bt.appendChild(_btn('✕', '#e53935', 'call-reject', function() { calls.reject(); }));
    bt.appendChild(_btn('📞', '#43a047', 'call-accept', function() { calls.accept(); }));
    if (!_ring) _startTone(true);
  } else if (st.state === 'active') {
    _stopTone();
    var upd = function() { status.textContent = _fmt(Math.max(0, Math.round((Date.now() - (st.startedAt || Date.now())) / 1000))); if (st.video) _videoLayout(el, st); };
    upd(); _tick = setInterval(upd, 1000);
    bt.appendChild(_btn(st.muted ? '🔇' : '🎤', st.muted ? '#555' : 'rgba(255,255,255,0.18)', 'call-mute', function() { calls.mute(!st.muted); }));
    if (st.video) bt.appendChild(_btn(st.cameraOff ? '🚫' : '📷', st.cameraOff ? '#555' : 'rgba(255,255,255,0.18)', 'call-camera', function() { calls.camera(!!st.cameraOff); }));
    bt.appendChild(_btn('✕', '#e53935', 'call-hangup', function() { calls.hangup(); }));
    try { var pl2 = _plugin(); if (pl2 && typeof pl2.callAudio === 'function') pl2.callAudio({ on: true }).catch(function() {}); } catch (e) {}
  }
}

// Llamada entrante con la app en segundo plano: aviso del teléfono
function _notifyIncoming(st) {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return;
  var pl = _plugin();
  if (pl && typeof pl.notifyMessage === 'function') pl.notifyMessage({ chatId: st.nx, name: _name(st.nx), msgId: st.id, text: '📞 Llamada entrante', count: 1 }).catch(function() {});
}

// Línea en el chat al terminar (solo en este teléfono)
function _logLine(d) {
  var id = 'cl' + Date.now() + Math.random().toString(36).substr(2, 4);
  var me = _normId(_bi() && _bi().localNexoId);
  var m = { msgId: id, messageId: id, content: d.text, _own: !!d.own, status: d.own ? 'read' : 'delivered', timestamp: Date.now(), contactNexoId: d.nx, senderNexoId: d.own ? me : d.nx };
  if (_normId(_getCurrentContactId()) === _normId(d.nx)) _renderMessage(m);
  else vaultAppendMessage(d.nx, m).catch(function() {});
  var b = _bi();
  if (b && typeof b.noteContactMessage === 'function') b.noteContactMessage(d.nx, d.text, Date.now());
}

// Botón 📞 en la cabecera del chat
function _installButton() {
  var header = document.getElementById('chat-header');
  if (!header || document.getElementById('nexo-call-btn')) return;
  var b = document.createElement('button');
  b.id = 'nexo-call-btn';
  b.title = 'Llamar';
  b.textContent = '📞';
  b.style.cssText = 'width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;font-size:18px;cursor:pointer;flex-shrink:0;margin-left:6px;';
  b.addEventListener('click', function(e) {
    e.stopPropagation();
    var calls = _calls(), cid = _getCurrentContactId();
    if (!calls || !cid) return;
    calls.start(cid).catch(function(err) { _showInfoToast(err.message, 3500); });
  });
  header.appendChild(b);
  // Videollamada (solo con el contacto en el mismo Wi-Fi)
  var v = document.createElement('button');
  v.id = 'nexo-video-btn';
  v.title = 'Videollamada';
  v.textContent = '🎥';
  v.style.cssText = b.style.cssText;
  v.addEventListener('click', function(e) {
    e.stopPropagation();
    var calls = _calls(), cid = _getCurrentContactId();
    if (!calls || !cid) return;
    calls.start(cid, true).catch(function(err) { _showInfoToast(err.message, 3500); });
  });
  header.appendChild(v);
}
function _refreshButton() {
  var cid = _getCurrentContactId(), gs = _bi() && _bi().groups, show = cid && !(gs && gs.isGroup(cid)) ? '' : 'none';
  ['nexo-call-btn', 'nexo-video-btn'].forEach(function(id) { var b = document.getElementById(id); if (b) b.style.display = show; });
}

export function installCallsUi() {
  _installButton();
  window.addEventListener('nexo:call', function(e) {
    var st = e && e.detail;
    if (st && st.state === 'ringing') _notifyIncoming(st);
    _render(st);
  });
  window.addEventListener('nexo:callLog', function(e) { if (e && e.detail) _logLine(e.detail); });
  window.addEventListener('nexo:ble:openChat', function() { setTimeout(_refreshButton, 0); });
}
