/**
 * calls_ui.js v2.0 — Pantallas de las llamadas (la lógica en calls.js): botones 📞 y 🎥 en la cabecera del chat (solo
 * chats 1:1), pantalla de llamada y la línea que queda en el chat al terminar.
 * v2.0 (ronda 2762, pedido del dueño: como WhatsApp con el estilo de NEXO): fondo oscuro con brillo cian/violeta, avatar
 * del contacto (sus iniciales y colores) con ondas mientras suena, nombre y estado; arriba "Cifrada de extremo a
 * extremo" y por dónde va (Wi-Fi / Bluetooth); abajo un panel de cristal con botones con icono y nombre. Entrante:
 * Rechazar / Contestar. Videollamada: la imagen del otro a pantalla completa, la propia pequeña (se arrastra a cualquier
 * esquina; tocarla cambia cuál se ve en grande), girar la cámara, y tocar la pantalla oculta o muestra los controles (se
 * ocultan solos a los 5 s). "Conexión inestable" si la voz del otro deja de llegar unos segundos.
 */
import { callEndedBg } from './call_bg.js';
import { haptic } from './haptics.js'; // NEXO Touch (2968): háptica del sistema
import { paintAvatar } from './avatar.js';
import { _normId, _getCurrentContactId } from './chat_format.js';
import { _renderMessage } from './render.js';
import { _pickContact } from './ui_bits.js';
import { _getGradientForUUID, _getInitials } from './ble_helpers.js';
import { _hideCameraPreviewOverlay } from './camera.js';
import { vaultAppendMessage, vaultFindContactByNexoId } from '../vault/vault_manager.js';
import { t } from './i18n.js';
import { isBlocked } from './bloqueo.js';
import { openCallReply, closeCallReply } from './call_reply.js';
import { registerCallBar, minimizeCall, canMinimize } from './call_bar.js';
import { initCallPip, miniOpen } from './call_pip.js';
import { bindCallGestures, peerTransform, zoomReset } from './call_gestos.js';
import { mergeCheck, mergeCalls } from './call_merge.js';
import { bridgeOf } from './call_bridge.js';
import { callToast, mergeKey, callShownName, confNotice, bridgeOther, secondAvatar } from './call_join_ui.js';

function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _calls() { var b = _bi(); return b && b.calls; }
function _name(nx) { var c = vaultFindContactByNexoId(nx); return (c && (c.name || c.displayName)) || String(nx || '').toUpperCase(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

var _tick = null, _ring = null, _speaker = false, _rmTimer = null;

// 3134 (dueño 15-11: «cuando marco a un contacto no escucho el clásico sonido del tuuu… tuuu…»): el tono de la llamada SALIENTE
// lo pone el teléfono (Kotlin ringback: el «está sonando» del sistema por el canal de llamada, que sale por el auricular, el altavoz
// o el manos libres Bluetooth). Antes era un pitido de la app (WebAudio, 425 Hz a volumen 0,12, como multimedia) que con la llamada
// ya en el modo de llamada del sistema no se oía. Sin ese método en el nativo (o si falla), el pitido de siempre.
function _startTone(incoming, vibrateOnly) {
  _stopTone();
  var pl = !incoming && !vibrateOnly ? _plugin() : null;
  if (pl && typeof pl.ringback === 'function') {
    var rg = _ring = { ctx: null, timer: null, native: true };
    Promise.resolve(pl.ringback({ on: true })).then(function() {
      if (_ring === rg) console.log('[CALL] Tono de llamada saliente: el del teléfono');
    }).catch(function(e) {
      if (_ring !== rg) return;
      _ring = null;
      console.warn('[CALL] Tono del teléfono: ' + (e && e.message) + ' (pitido de la app)');
      var c = _calls(), s = c && c.state();
      if (s && s.state === 'calling') _startWebTone(false);
    });
    return;
  }
  _startWebTone(incoming, vibrateOnly);
}
// Timbre (entrante) o tono de llamada (saliente) con WebAudio; vibración en la entrante
function _startWebTone(incoming, vibrateOnly) {
  _stopTone();
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  if (!vibrateOnly) { if (!AC) return; try { ctx = new AC(); } catch (e) { return; } }
  var beep = function() {
    if (ctx) try {
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
  if (_ring.native) { var pl = _plugin(); if (pl && typeof pl.ringback === 'function') Promise.resolve(pl.ringback({ on: false })).catch(function() {}); }
  clearInterval(_ring.timer);
  try { if (_ring.ctx) _ring.ctx.close(); } catch (e) {}
  _ring = null;
}
// Ronda 2770: el tono de una llamada entrante respeta el modo del teléfono (antes sonaba como multimedia aunque estuviera
// en silencio o en "No molestar"); con vibración, solo vibra. Con la app oculta ya suena el aviso del sistema (que lo
// respeta): no se suma el de la app (antes sonaban los dos).
function _startIncomingTone() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && _callNotif) return;
  var pl = _plugin();
  var ringing = function() { var c = _calls(), s = c && c.state(); return !!(s && s.state === 'ringing') && !_ring; };
  if (!pl || typeof pl.ringerMode !== 'function') { _startTone(true); return; }
  _ring = { ctx: null, timer: null, pending: true }; // (mientras se pregunta el modo: que no se pida dos veces)
  Promise.resolve(pl.ringerMode()).then(function(r) {
    if (_ring && _ring.pending) _ring = null;
    if (!ringing()) return;
    if (r && (r.mode === 'silent' || r.dnd)) { console.log('[CALL] Teléfono en silencio' + (r.dnd ? ' (No molestar)' : '') + ': llamada sin tono'); return; }
    _startTone(true, !!(r && r.mode === 'vibrate'));
  }).catch(function() { if (_ring && _ring.pending) _ring = null; if (ringing()) _startTone(true); });
}

// Modo de audio del teléfono en llamada (Kotlin callAudio): auricular o altavoz
function _audioMode(on) {
  // #220: al colgar una, si sigue otra llamada (la segunda o la de grupo), el teléfono sigue en modo llamada
  if (!on) { var bo = _bi(); if (bo && ((bo.calls2 && bo.calls2.call) || (bo.gcall && bo.gcall.gc))) return; }
  try {
    var pl = _plugin();
    if (pl && typeof pl.callAudio === 'function') pl.callAudio({ on: !!on, speaker: !!on && _speaker }).then(function(r) {
      if (!on) callEndedBg(_bi()); // 3318
      // Ronda 2761: al diagnóstico por dónde sale el sonido y con qué volumen (el audio de la llamada sale como multimedia);
      // ronda 2770: si el micrófono sigue con la pantalla bloqueada u otra app (servicio de micrófono del nativo) y si
      // tiene el foco de audio (la música de otra app se para)
      if (on && r) console.log('[CALL] Sonido del teléfono: ' + (r.device || (r.speakerOn ? 'altavoz' : 'auricular')) + ', volumen llamada ' + (r.volCall || '?') + ', multimedia ' + (r.volMedia || '?') +
        (r.fgs ? '; en segundo plano: ' + r.fgs : '') + (r.focus ? '; foco de audio: ' + r.focus : ''));
      // Ronda 2772: con cascos o Bluetooth no hay eco del altavoz: los filtros no bajan el micrófono
      var cm = on && r && _calls() && _calls().call && _calls().call.media;
      if (cm && typeof cm.headset === 'function') cm.headset(r.device === 'cascos' || r.device === 'Bluetooth');
    }).catch(function(e) { console.warn('[CALL] Modo llamada: ' + (e && e.message)); });
  } catch (e) {}
}

function _fmt(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

// Iconos (trazo blanco, 24x24)
var _IC = {
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>',
  micOff: '<path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.6 6M12 18v3M3 3l18 18"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  ear: '<path d="M6 8.5a6 6 0 0 1 12 0c0 3.5-3 4.5-3 7.5a3 3 0 0 1-6 0"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2-1.5 3.5"/>',
  cam: '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 11l6-3v8l-6-3z"/>',
  camOff: '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 11l6-3v8l-6-3zM3 3l18 18"/>',
  flip: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><path d="M9.5 13.5a2.5 2.5 0 0 0 4.6 1.3M14.5 12.5a2.5 2.5 0 0 0-4.6-1.3"/><path d="M14 15l.3-1.8 1.7.6M10 11l-.3 1.8-1.7-.6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  addp: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M18 8v6M15 11h6"/>',
  screen: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 15V8M9 11l3-3 3 3"/>',
  pause: '<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>',
  play: '<path d="M8 5.5l11 6.5-11 6.5z"/>',
  msg: '<path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  merge: '<path d="M6 3.5v4.5a6 6 0 0 0 6 6M18 3.5v4.5a6 6 0 0 1-6 6v6.5"/><path d="M8.5 18l3.5 3 3.5-3"/>' // 3216: dos caminos que se juntan
};
// #222 (dueño 15-11: «solo pueden ser dos llamadas independientes al mismo tiempo»): cuántas llamadas hay (1-a-1 ×2 y la de grupo)
export function callCount() { var b = _bi(); return b && typeof b._callCount === 'function' ? b._callCount() : 0; }
// Etiqueta de una llamada en espera (la puse yo / me puso el otro); '' si no
export function holdLabel(st) {
  if (!st) return '';
  if (st.userHold) return t('call_on_hold', 'En espera');
  if (st.peerHeld) return t('call_peer_hold', 'Te puso en espera');
  return '';
}
// Botón «En espera» / «Reanudar» (solo con dos llamadas a la vez o si ésta ya está en espera)
export function holdButton(calls, st) {
  var on = !!(st && (st.userHold || st.held && st.gid));
  return _btn(on ? 'play' : 'pause', on ? t('call_resume', 'Reanudar') : t('call_hold', 'En espera'), 'call-hold', function() { haptic('confirm'); calls.hold(!on); }, on ? 'nc-on' : '');
}
// Botón «Mensaje» en una llamada que suena estando en otra: la rechaza y le manda un texto al que llama
export function replyButton(nx, reject) {
  return _btn('msg', t('call_qr_btn', 'Mensaje'), 'call-reply', function() { haptic('confirm'); openCallReply(nx, _name(nx), reject); });
}
// 3216 (dueño 17-11, «Unir»): con dos llamadas (una sonando o las dos en curso), junta las dos en una de grupo (call_merge.js).
// ring: en la pantalla de la que suena («Unir a esta llamada»). null si no hay nada que unir; apagado (y al tocarlo dice por qué) si
// no se puede (solo internet con alguno, tope del grupo)
export function mergeButton(ring) {
  var m = mergeCheck(_bi(), _name); if (!m) return null;
  return _btn('merge', ring ? t('call_merge_in', 'Unir a esta llamada') : t('call_merge', 'Unir'), 'call-merge', function() {
    haptic('confirm');
    mergeCalls(_bi(), _name).catch(function(err) { callToast((err && err.message) || 'Error', 4000); });
  }, m.ok ? '' : 'nc-off');
}
function _svg(name, size) {
  return '<svg width="' + (size || 26) + '" height="' + (size || 26) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + _IC[name] + '</svg>';
}

// Estilos (una vez)
function _style() {
  if (document.getElementById('nexo-call-style')) return;
  _watchSplit();
  var st = document.createElement('style');
  st.id = 'nexo-call-style';
  st.textContent = [
    '#nexo-call-screen{position:fixed;inset:0;z-index:2147483645;color:#fff;overflow:hidden;background:var(--nx-bg);user-select:none;-webkit-user-select:none;font-family:inherit}',
    '#nexo-call-screen .nc-bg{position:absolute;inset:-20%;z-index:0;background:var(--nx-bg)}',
    '#nexo-call-screen .nc-top{position:absolute;top:0;left:0;right:0;z-index:3;padding:calc(16px + env(safe-area-inset-top,0px)) 16px 36px;display:flex;flex-direction:column;align-items:center;gap:8px;transition:opacity .3s}',
    '#nexo-call-screen .nc-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);font-size:11.5px;opacity:.85}',
    '#nexo-call-screen .nc-center{position:absolute;top:19%;left:0;right:0;z-index:2;display:flex;flex-direction:column;align-items:center;transition:opacity .3s}',
    '#nexo-call-screen .nc-av-wrap{position:relative;width:132px;height:132px;margin-bottom:24px}',
    '#nexo-call-screen .nc-av{position:relative;z-index:1;width:132px;height:132px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:48px;font-weight:700;color:#fff;box-shadow:0 0 0 2px rgba(255,255,255,.08),0 6px 18px rgba(0,0,0,.35)}',
    '#nexo-call-screen .nc-ring{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(0,200,255,.6);opacity:0}',
    // 3217 (puente): el segundo participante, más pequeño, abajo a la derecha del primero
    '#nexo-call-screen .nc-av2{position:absolute;z-index:2;right:-12px;bottom:-6px;width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;box-shadow:0 0 0 3px var(--nx-bg),0 4px 12px rgba(0,0,0,.35)}',
    'html.nc-split #nexo-call-screen .nc-av2{width:28px;height:28px;font-size:11px;right:-6px;bottom:-3px;box-shadow:0 0 0 2px var(--nx-bg)}',
    '#nexo-call-screen.nc-waiting .nc-ring{animation:ncPulse 2.4s ease-out infinite}',
    '#nexo-call-screen .nc-ring.r2{animation-delay:.8s;border-color:rgba(168,85,247,.6)}#nexo-call-screen .nc-ring.r3{animation-delay:1.6s}',
    '@keyframes ncPulse{0%{transform:scale(1);opacity:.9}100%{transform:scale(1.85);opacity:0}}',
    '#nexo-call-screen .call-name{font-size:28px;font-weight:800;text-align:center;padding:0 24px;letter-spacing:-0.3px}',
    '#nexo-call-screen .call-status{font-size:15px;opacity:.82;margin-top:8px;font-variant-numeric:tabular-nums;text-align:center}',
    '#nexo-call-screen .call-status.nc-warn{color:#ff8a80;opacity:1}',
    '#nexo-call-screen .call-note{font-size:12px;opacity:.6;margin-top:6px;text-align:center;padding:0 24px}',
    '#nexo-call-screen .call-note.nc-tap{opacity:1;color:var(--nx-cyan);text-decoration:underline;cursor:pointer;pointer-events:auto}',
    // #220 fase 1 (dueño 15-11): dos llamadas a la vez (1-a-1 + grupo) → pantalla dividida: la 1-a-1 arriba, la de grupo abajo,
    // cada una con sus botones (antes la 1-a-1 tapaba entera la de grupo). Las dos, más compactas.
    'html.nc-split #nexo-call-screen{inset:0 0 50% 0;border-bottom:2px solid rgba(255,255,255,.22)}',
    'html.nc-split #nexo-call-screen .nc-top{padding:calc(6px + env(safe-area-inset-top,0px)) 12px 6px;gap:4px}',
    'html.nc-split #nexo-call-screen .nc-center{top:14%}',
    'html.nc-split #nexo-call-screen .nc-av-wrap,html.nc-split #nexo-call-screen .nc-av{width:60px;height:60px}',
    'html.nc-split #nexo-call-screen .nc-av-wrap{margin-bottom:6px}',
    'html.nc-split #nexo-call-screen .nc-av{font-size:22px}',
    'html.nc-split #nexo-call-screen .call-name{font-size:18px}',
    'html.nc-split #nexo-call-screen .call-status{font-size:13px;margin-top:2px}',
    'html.nc-split #nexo-call-screen .nc-bottom{padding-bottom:6px}',
    'html.nc-split #nexo-call-screen .call-buttons:not(.nc-incoming){padding:8px 4px 6px}',
    'html.nc-split #nexo-gcall-screen{inset:50% 0 0 0 !important;padding:8px 12px calc(6px + env(safe-area-inset-bottom,0px)) !important;overflow:hidden}',
    'html.nc-split #nexo-gcall-screen .gc-pill{display:none !important}',
    'html.nc-split #nexo-gcall-screen .gc-title{margin-top:2px !important;font-size:16px !important}',
    'html.nc-split #nexo-gcall-screen .gc-status{margin-top:2px !important;font-size:12px !important}',
    'html.nc-split #nexo-gcall-screen .gc-video{margin-top:6px !important;max-height:42%;overflow:hidden}',
    'html.nc-split #nexo-gcall-screen .gc-members{margin-top:6px !important;gap:6px !important;min-height:0}',
    'html.nc-split #nexo-gcall-screen .gc-buttons{flex-shrink:0;padding:6px 0 2px !important}',
    // #220 fase 2: la SEGUNDA llamada 1-a-1 (calls2_ui.js): sola, toda la pantalla; con la primera, la mitad de abajo
    '#nexo-call2-screen{position:fixed;inset:0;z-index:2147483640;color:#fff;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:calc(16px + env(safe-area-inset-top,0px)) 8px calc(16px + env(safe-area-inset-bottom,0px));box-sizing:border-box;background:var(--nx-bg)}',
    'html.nc-split #nexo-call2-screen{inset:50% 0 0 0;padding:8px 8px calc(6px + env(safe-area-inset-bottom,0px))}',
    '#nexo-call2-screen .c2-video{position:absolute;inset:0;z-index:0;width:100%;height:100%;object-fit:cover;background:#000}',
    '#nexo-call2-screen .c2-head{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:4px;text-shadow:0 2px 10px rgba(0,0,0,.5)}',
    '#nexo-call2-screen .c2-tag{font-size:11px;padding:3px 10px;border-radius:999px;background:var(--nx-surface-2)}',
    '#nexo-call2-screen .c2-name{font-size:20px;font-weight:700;text-align:center}',
    '#nexo-call2-screen .c2-status{font-size:13px;opacity:.85;font-variant-numeric:tabular-nums}',
    '#nexo-call2-screen .call-buttons{position:relative;z-index:1;width:100%;max-width:440px;margin:0 auto;display:flex;flex-wrap:nowrap;justify-content:space-around;align-items:flex-start;padding:10px 4px 8px;box-sizing:border-box;border-radius:30px;background:var(--nx-glass);border:1px solid var(--nx-line)}',
    '#nexo-call2-screen .nc-btn{display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;color:#fff;cursor:pointer;padding:0;flex:1 1 0;min-width:0;max-width:76px;line-height:1.15;font-size:11.5px;-webkit-tap-highlight-color:transparent}',
    '#nexo-call2-screen .nc-btn .nc-ic{width:min(56px,calc(100% - 6px));height:clamp(36px,11.4vw,56px);border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--nx-surface-2);box-shadow:inset 0 0 0 1px var(--nx-line)}',
    '@supports (aspect-ratio:1/1){#nexo-call2-screen .nc-btn .nc-ic{height:auto;aspect-ratio:1/1}}',
    '#nexo-call2-screen .nc-btn.nc-on .nc-ic{background:#fff;color:#14152a}',
    '#nexo-call2-screen .nc-btn.nc-red .nc-ic{background:#ef4444;box-shadow:0 8px 24px rgba(239,68,68,.45)}',
    '#nexo-call2-screen .nc-btn.nc-green .nc-ic{background:var(--nx-grad);box-shadow:0 10px 30px rgba(0,200,255,.35),0 4px 12px rgba(168,85,247,.35)}',
    '#nexo-call2-screen .nc-btn.call-hangup .nc-ic svg,#nexo-call2-screen .nc-btn.call-reject .nc-ic svg{transform:rotate(135deg)}',
    '#nexo-call2-screen .nc-btn>span:last-child{max-width:calc(100% - 4px);text-align:center;overflow:hidden;text-overflow:ellipsis}',
    '#nexo-call-screen .nc-bottom{position:absolute;left:0;right:0;bottom:0;z-index:3;padding:0 8px calc(26px + env(safe-area-inset-bottom,0px));transition:transform .3s,opacity .3s}',
    '#nexo-call-screen .call-buttons{margin:0 auto;max-width:440px;display:flex;justify-content:space-around;align-items:flex-start;padding:16px 6px 12px;border-radius:30px;background:var(--nx-glass);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid var(--nx-line);box-shadow:0 10px 40px rgba(0,0,0,.35)}',
    '#nexo-call-screen .call-buttons.nc-incoming{background:none;border:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;justify-content:space-between;max-width:320px;padding:0 18px}',
    // 3216: sonando con «Mensaje» y «Unir a esta llamada» (cuatro botones): más ancho, y los nombres en dos líneas como mucho
    '#nexo-call-screen .call-buttons.nc-incoming.nc-four{max-width:400px;padding:0 6px}',
    '#nexo-call-screen .call-buttons.nc-incoming.nc-four .nc-btn{flex:1 1 0;min-width:0}', // cuatro columnas iguales (un nombre largo no aprieta a los demás)
    '#nexo-call-screen .call-buttons.nc-incoming.nc-four .nc-btn>span:last-child{max-width:calc(100% - 4px);text-align:center;line-height:1.15}',
    '.nc-btn.call-merge>span:last-child{max-width:76px;text-align:center;line-height:1.15}',
    '#nexo-call-screen .call-buttons:empty{display:none}',
    '#nexo-call-screen .nc-btn{display:flex;flex-direction:column;align-items:center;gap:7px;background:none;border:none;color:#fff;font-size:11.5px;cursor:pointer;padding:0;min-width:62px;-webkit-tap-highlight-color:transparent}',
    '#nexo-call-screen .nc-btn .nc-ic{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--nx-surface-2);box-shadow:inset 0 0 0 1px var(--nx-line);transition:transform .15s,background .2s,color .2s}',
    '#nexo-call-screen .nc-btn.nc-on .nc-ic{background:#fff;color:#14152a}',
    '.nc-btn.nc-off{opacity:.4}', // #222: apagado (con dos llamadas a la vez), al tocarlo dice por qué
    '#nexo-call-screen .nc-btn.nc-red .nc-ic{background:#ef4444;box-shadow:0 8px 24px rgba(239,68,68,.45)}',
    '#nexo-call-screen .nc-btn.nc-red:not(.call-screen) .nc-ic svg{transform:rotate(135deg)}', // (14-11: «Detener» de compartir pantalla no se gira)
    '#nexo-call-screen .nc-btn.nc-big .nc-ic{width:72px;height:72px}',
    // 14-11 (dueño, APK 3052: «los botones de abajo de la videollamada quedan muy anchos y el de colgar ni se ve en pantalla»):
    // en la videollamada van 7 botones y con 62 px de mínimo cada uno no cabían en un teléfono (360–412 de ancho): el de
    // colgar, el último, quedaba fuera. Ahora cada botón toma su parte del ancho (hasta 76 px), el círculo se encoge con él
    // (hasta 56 px) y el nombre baja un poco de tamaño: siempre caben todos y colgar se ve entero (en la llamada entrante,
    // sin cambios).
    '#nexo-call-screen .call-buttons:not(.nc-incoming){padding:14px 4px 10px}',
    '#nexo-call-screen .call-buttons:not(.nc-incoming) .nc-btn{flex:1 1 0;min-width:0;max-width:76px;gap:6px;line-height:1.15}',
    '#nexo-call-screen .call-buttons.nc-many .nc-btn{font-size:clamp(9.5px,2.65vw,11.5px)}',
    '#nexo-call-screen .call-buttons:not(.nc-incoming) .nc-btn .nc-ic{width:min(56px,calc(100% - 6px));height:clamp(36px,11.4vw,56px)}',
    '@supports (aspect-ratio:1/1){#nexo-call-screen .call-buttons:not(.nc-incoming) .nc-btn .nc-ic{height:auto;aspect-ratio:1/1}}',
    '#nexo-call-screen .call-buttons:not(.nc-incoming) .nc-btn>span:last-child{max-width:calc(100% - 4px);text-align:center;overflow:hidden;text-overflow:ellipsis}',
    // 14-11 (tras el pedido del dueño de la 1-a-1): la llamada de GRUPO tenía botones de texto de 120 px que, con vídeo, en un
    // teléfono de 360–412 ocupaban 4 filas (248 px, casi un tercio de la pantalla). Ahora la misma fila de círculos que la 1-a-1.
    '#nexo-gcall-screen .gc-buttons.nc-row{display:flex;flex-wrap:nowrap;justify-content:space-around;align-items:flex-start;gap:0;width:calc(100% + 24px);max-width:440px;margin:0 -12px;padding:14px 4px 10px;box-sizing:border-box;border-radius:30px;background:var(--nx-glass);border:1px solid var(--nx-line);box-shadow:0 10px 40px rgba(0,0,0,.35)}',
    '#nexo-gcall-screen .nc-btn{display:flex;flex-direction:column;align-items:center;gap:6px;background:none;border:none;color:#fff;cursor:pointer;padding:0;flex:1 1 0;min-width:0;max-width:76px;line-height:1.15;font-size:11.5px;-webkit-tap-highlight-color:transparent}',
    '#nexo-gcall-screen .gc-buttons.nc-many .nc-btn{font-size:clamp(9.5px,2.65vw,11.5px)}',
    '#nexo-gcall-screen .nc-btn .nc-ic{width:min(56px,calc(100% - 6px));height:clamp(36px,11.4vw,56px);border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--nx-surface-2);box-shadow:inset 0 0 0 1px var(--nx-line);transition:background .2s,color .2s}',
    '@supports (aspect-ratio:1/1){#nexo-gcall-screen .nc-btn .nc-ic{height:auto;aspect-ratio:1/1}}',
    '#nexo-gcall-screen .nc-btn.nc-on .nc-ic{background:#fff;color:#14152a}',
    '#nexo-gcall-screen .nc-btn.nc-red .nc-ic{background:#ef4444;box-shadow:0 8px 24px rgba(239,68,68,.45)}',
    '#nexo-gcall-screen .nc-btn.call-hangup .nc-ic svg{transform:rotate(135deg)}',
    '#nexo-gcall-screen .nc-btn>span:last-child{max-width:calc(100% - 4px);text-align:center;overflow:hidden;text-overflow:ellipsis}',
    '#nexo-call-screen .nc-btn.nc-green .nc-ic{background:var(--nx-grad);box-shadow:0 10px 30px rgba(0,200,255,.35),0 4px 12px rgba(168,85,247,.35);animation:ncBounce 1.4s ease-in-out infinite}',
    '@keyframes ncBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}',
    '#nexo-call-screen .call-remote-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;z-index:1}',
    '#nexo-call-screen .call-local-video{object-fit:cover;background:#1a1b2e}',
    // 3152: la videollamada saliente abre la cámara al llamar: mientras suena, uno se ve detrás (atenuado), como en WhatsApp
    '#nexo-call-screen .call-local-video.nc-preview{position:absolute;inset:0;width:100%;height:100%;z-index:1;border:none;border-radius:0;opacity:.55}',
    '#nexo-call-screen .nc-pip{position:absolute;z-index:4;width:104px;height:148px;border-radius:16px;border:2px solid rgba(255,255,255,.75);box-shadow:0 8px 26px rgba(0,0,0,.5);touch-action:none;transition:left .22s,top .22s}',
    '#nexo-call-screen .nc-full{position:absolute;inset:0;width:100%;height:100%;z-index:1;border-radius:0;border:none;object-fit:contain}',
    // Ronda 2772 (informe del dueño: "la imagen se ve muy cerca"): la imagen grande se ve entera salvo que a toda la
    // pantalla se vea casi toda (≥ 78 %); dos toques, al revés
    '#nexo-call-screen.nc-fill .nc-full{object-fit:cover}',
    '#nexo-call-screen.nc-video .nc-top{background:linear-gradient(rgba(0,0,0,.6),transparent)}',
    '#nexo-call-screen.nc-video .nc-bottom{background:linear-gradient(transparent,rgba(0,0,0,.5))}',
    '#nexo-call-screen.nc-video.nc-live .nc-center{opacity:0;pointer-events:none}',
    // Ronda 2769: sin imagen del otro (su cámara apagada, sin cámara o aún sin imagen): su foto y el motivo, no negro
    '#nexo-call-screen.nc-video.nc-live.nc-novideo .nc-center{opacity:1}',
    '#nexo-call-screen.nc-novideo .call-remote-video{visibility:hidden}',
    // 13-11 (dueño): compartir pantalla. Barra roja arriba mientras comparto (tocarla detiene); el aviso antes de empezar;
    // la pantalla del otro se ve ENTERA (nunca recortada) y sin espejo, y se puede ampliar con dos dedos
    '#nexo-call-screen .nc-scrbar{position:absolute;left:0;right:0;top:0;z-index:12;background:#dc2626;color:#fff;font-size:14px;font-weight:600;text-align:center;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px;cursor:pointer}',
    '#nexo-call-screen.nc-peer-screen .call-remote-video.nc-full{object-fit:contain !important;background:#000}',
    '#nexo-scr-ask{position:absolute;z-index:20}', // B-EST (26-11): el aviso común (.nx-ask, nexo_theme.css), dentro de la pantalla de llamada
    '#nexo-call-screen .nc-warnbar{display:none;margin-top:8px;font-size:13px;color:#fbbf24;text-shadow:0 1px 8px rgba(0,0,0,.7);text-align:center}',
    '#nexo-call-screen.nc-video.nc-live .nc-warnbar:not(:empty){display:block}',
    '#nexo-call-screen .nc-mini{display:none;font-size:17px;font-weight:600;text-shadow:0 1px 8px rgba(0,0,0,.6)}',
    '#nexo-call-screen.nc-video.nc-live .nc-mini{display:block}',
    '#nexo-call-screen.nc-hide .nc-top,#nexo-call-screen.nc-hide .nc-bottom{opacity:0;pointer-events:none}',
    '#nexo-call-screen.nc-hide .nc-bottom{transform:translateY(40%)}',
    // Ronda 2778 (pedido del dueño): contestar deslizando hacia arriba el botón verde. Una flecha sube sola de pista; el
    // icono sigue al dedo (por eso aquí se le quita el rebote de nc-green, que usa el mismo transform). El toque sigue
    // valiendo (alternativa).
    '#nexo-call-screen .nc-swipe-up{position:relative;touch-action:none}',
    '#nexo-call-screen .nc-swipe-up .nc-ic{animation:none}',
    '#nexo-call-screen .nc-swipe-up::before{content:"";position:absolute;left:50%;top:-24px;width:15px;height:15px;margin-left:-8px;border-left:3px solid var(--nx-cyan);border-top:3px solid var(--nx-cyan);border-radius:2px;animation:ncUp 1.2s ease-in-out infinite;pointer-events:none}',
    '@keyframes ncUp{0%,100%{transform:rotate(45deg) translateY(2px);opacity:.3}50%{transform:rotate(45deg) translateY(-6px);opacity:1}}',
    // #dueño 04-11: (a) EN la ventanita del sistema (PiP) se ve SOLO el vídeo del otro — sin controles ni MI imagen pequeña
    // (antes mi imagen 104x148 tapaba al otro en la ventanita chica).
    '#nexo-call-screen.nc-pipwin .nc-top,#nexo-call-screen.nc-pipwin .nc-bottom,#nexo-call-screen.nc-pipwin .nc-center,#nexo-call-screen.nc-pipwin .nc-pip{display:none!important}',
    '#nexo-call-screen.nc-pipwin .nc-full{object-fit:cover}',
    // 3155 (dueño 16-11: «la videollamada minimizada sale con todos los botones apretados en la ventanita»): la ventanita (miniatura
    // del sistema o la app en una ventana pequeña) enseña SOLO la imagen del otro, sin botones ni textos: con el aviso del sistema
    // (html.nx-pip) y, por si no llega, por el tamaño de la ventana (≤ 300 de ancho: ningún teléfono a pantalla completa lo es)
    'html.nx-pip #nexo-call-screen .nc-top,html.nx-pip #nexo-call-screen .nc-bottom,html.nx-pip #nexo-call-screen .nc-pip,html.nx-pip #nexo-call-screen .nc-min,html.nx-pip #nexo-call-screen .nc-scrbar,html.nx-pip #nexo-call-screen.nc-video.nc-live .nc-center{display:none!important}',
    'html.nx-pip #nexo-call-screen .nc-full{object-fit:cover}',
    '@media (max-width:300px){#nexo-call-screen .nc-top,#nexo-call-screen .nc-bottom,#nexo-call-screen .nc-pip,#nexo-call-screen .nc-min,#nexo-call-screen .nc-scrbar,#nexo-call-screen.nc-video.nc-live .nc-center{display:none!important}#nexo-call-screen .nc-full{object-fit:cover}#nexo-call-screen .nc-av-wrap,#nexo-call-screen .nc-av{width:64px;height:64px;font-size:24px}#nexo-call-screen .call-name{font-size:18px}}',
    // 3155: minimizar la llamada (barra arriba, call_bar.js): flecha arriba a la izquierda (también con el gesto «atrás»)
    '#nexo-call-screen .nc-min{position:absolute;top:calc(12px + env(safe-area-inset-top,0px));left:12px;z-index:5;width:40px;height:40px;border-radius:50%;border:none;padding:0;display:none;align-items:center;justify-content:center;color:#fff;background:rgba(255,255,255,.1);cursor:pointer;transition:opacity .3s}',
    '#nexo-call-screen.nc-canmin .nc-top{padding-left:62px;padding-right:62px}',
    '#nexo-call-screen.nc-canmin .nc-min{display:flex}#nexo-call-screen.nc-hide .nc-min{opacity:0;pointer-events:none}html.nc-split #nexo-call-screen .nc-min,#nexo-call-screen.nc-appmini .nc-min,#nexo-call-screen.nc-pipwin .nc-min{display:none!important}',
    // (b) al VOLVER a la app desde la miniatura, la llamada queda como MINI flotante (no a pantalla completa) y debajo se
    // usa la app (contactos/último chat). Tocar la mini la vuelve a abrir completa.
    '#nexo-call-screen.nc-appmini{inset:auto;right:12px;bottom:96px;width:112px;height:188px;border-radius:18px;overflow:hidden;box-shadow:0 12px 34px rgba(0,0,0,.55);border:2px solid rgba(255,255,255,.55)}',
    '#nexo-call-screen.nc-appmini .nc-top,#nexo-call-screen.nc-appmini .nc-bottom,#nexo-call-screen.nc-appmini .nc-center,#nexo-call-screen.nc-appmini .nc-pip,#nexo-call-screen.nc-appmini .nc-bg{display:none!important}',
    '#nexo-call-screen.nc-appmini .nc-full{object-fit:cover;border-radius:16px}'
  ].join('\n');
  document.head.appendChild(st);
}

function _screen() {
  var el = document.getElementById('nexo-call-screen');
  if (el && el.classList.contains('nc-gone')) { el.remove(); el = null; } // #224: la que pasó a grupo no se reutiliza
  if (el) return el;
  _style();
  el = document.createElement('div');
  el.id = 'nexo-call-screen';
  el.innerHTML = '<div class="nc-bg"></div>' +
    '<div class="nc-top"><div class="nc-pill nc-lock">' + _svg('lock', 13) + '<span>' + t('call_e2e', 'Cifrada de extremo a extremo') + '</span></div><div class="nc-mini"></div><div class="nc-warnbar"></div></div>' +
    '<div class="nc-center"><div class="nc-av-wrap"><div class="nc-ring"></div><div class="nc-ring r2"></div><div class="nc-ring r3"></div><div class="nc-av"></div></div>' +
    '<div class="call-name"></div><div class="call-status"></div><div class="call-note"></div></div>' +
    '<div class="nc-bottom"><div class="call-buttons"></div></div>' +
    '<button class="nc-min" aria-label="' + t('call_minimize', 'Minimizar') + '">' + _svg('down', 24) + '</button>';
  el.querySelector('.nc-min').addEventListener('click', function(e) { e.stopPropagation(); haptic('confirm'); minimizeCall('1'); });
  // Videollamada: los toques y el zoom de la imagen del otro viven en call_gestos.js (un toque muestra/oculta la barra; dos toques:
  // entera ↔ toda la pantalla, o tamaño normal si hay zoom; dos dedos, zoom solo de la imagen del otro)
  bindCallGestures(el, {
    miniOpen: miniOpen, autoHide: _autoHide,
    isLive: function(e) { return e.classList.contains('nc-live'); },
    target: function() { var c = _calls(), v = c && typeof c.videoViews === 'function' ? c.videoViews() : null, r = v && v.remote; return r && r.classList.contains('nc-full') && r.parentNode === el ? r : null; },
    toggleFill: function(e) { _fit.user = e.classList.contains('nc-fill') ? 'fit' : 'fill'; e.classList.toggle('nc-fill', _fit.user === 'fill'); }
  });
  document.body.appendChild(el);
  return el;
}

var _hideTimer = null;
function _autoHide(el) {
  clearTimeout(_hideTimer);
  if (!el.classList.contains('nc-live') || el.classList.contains('nc-hide')) return;
  _hideTimer = setTimeout(function() { if (el.classList.contains('nc-live')) el.classList.add('nc-hide'); }, 5000);
}

// #dueño 04-11: la miniatura del sistema (PiP): (a) al ENTRAR se ve solo el vídeo del otro (`nc-pipwin`); (b) al SALIR la llamada queda
// como MINI flotante (`nc-appmini`) y debajo se usa la app; tocar la mini la vuelve a abrir completa. 3277: el estado lo lleva
// call_pip.js (a prueba de avisos perdidos y de cambios repetidos); aquí solo se arranca.
if (typeof window !== 'undefined') initCallPip({ calls: _calls, syncSplit: function() { syncCallSplit(); }, autoHide: function(el) { _autoHide(el); } });

// 14-11 (dueño): con los botones al ancho del teléfono, un nombre largo de una sola palabra (en italiano «Altoparlante»,
// «Interrompi»; o con la letra del sistema agrandada) puede no caber: se le baja la letra lo justo (no menos de 8 px), en
// vez de cortarlo. Se mira al dibujar los botones y al girar o cambiar el tamaño de la pantalla.
function _fitLabels(bt) {
  if (!bt || bt.classList.contains('nc-incoming')) return;
  // nunca rompe la pantalla de la llamada: sin medidas (o sin Range.getBoundingClientRect), los nombres quedan como están
  try { Array.prototype.forEach.call(bt.querySelectorAll('.nc-btn > span:last-child'), function(l) {
    l.style.fontSize = '';
    // medida fina (no clientWidth/scrollWidth, que redondean: «Silenciado» se pasaba 0,3 px y salía «Silencia…»)
    var w = l.getBoundingClientRect().width;
    if (!w || typeof document.createRange !== 'function') return;
    var rg = document.createRange(); rg.selectNodeContents(l);
    if (typeof rg.getBoundingClientRect !== 'function') return;
    var sw = rg.getBoundingClientRect().width;
    if (sw <= w + 0.001) return; // (3217: «Raccrocher» se pasaba 0,03 px y salía «Raccroch…»: el navegador corta con CUALQUIER exceso; la medida va en 1/64 px)
    var fs = parseFloat(getComputedStyle(l).fontSize) || 11;
    l.style.fontSize = Math.max(8, Math.floor(fs * w / sw * 0.98 * 10) / 10) + 'px';
  }); } catch (e) {}
}
var _fitOnResize = false, _rszLog = null;
function _watchFit() {
  if (_fitOnResize) return; _fitOnResize = true;
  window.addEventListener('resize', function() {
    var el = document.getElementById('nexo-call-screen'); if (el) _fitLabels(el.querySelector('.call-buttons'));
    // 3229: el diagnóstico apunta si el teléfono se giró durante la llamada y cómo quedaron los botones
    if (el && el.classList.contains('nc-live')) { clearTimeout(_rszLog); _rszLog = setTimeout(function() { console.log('[CALL] Pantalla de llamada: ' + window.innerWidth + '×' + window.innerHeight + (window.innerWidth > window.innerHeight ? ' (horizontal)' : ' (vertical)') + ', botones ' + (el.classList.contains('nc-hide') ? 'ocultos' : 'visibles') + (document.documentElement.classList.contains('nx-pip') ? ', en ventanita' : '')); }, 800); }
    var g = document.getElementById('nexo-gcall-screen'); if (g) _fitLabels(g.querySelector('.gc-buttons.nc-row'));
  });
}

// 14-11: la pantalla de la llamada de GRUPO (groupcall_ui.js) usa los mismos botones redondos, estilos y ajuste de nombres
// #220 fase 1: con las dos pantallas de llamada a la vez (1-a-1 a la vista, no minimizada, y la de grupo) → pantalla dividida
export function syncCallSplit() {
  if (typeof document === 'undefined' || !document.documentElement) return false;
  var one = document.getElementById('nexo-call-screen'), grp = document.getElementById('nexo-gcall-screen') || document.getElementById('nexo-call2-screen');
  var on = !!(one && grp && !one.classList.contains('nc-appmini') && !one.classList.contains('nc-gone') && !one.classList.contains('nc-minimized') && !grp.classList.contains('nc-minimized')); // (#224: la que pasó a grupo no cuenta; 3155: ni una minimizada)
  if (on !== document.documentElement.classList.contains('nc-split')) {
    document.documentElement.classList.toggle('nc-split', on);
    console.log('[CALL] ' + (on ? 'Dos llamadas a la vez: pantalla dividida' : 'Una sola llamada: pantalla entera'));
  }
  return on;
}
var _splitObs = null;
function _watchSplit() {
  if (_splitObs || typeof MutationObserver !== 'function' || !document.body) return;
  try { _splitObs = new MutationObserver(function() { syncCallSplit(); }); _splitObs.observe(document.body, { childList: true }); } catch (e) {}
}
export function callButton(icon, label, cls, fn, extra) { return _btn(icon, label, cls, fn, extra); }
// #224: la pantalla de la videollamada que pasó a grupo se quita cuando la de grupo ya tiene sus imágenes (groupcall_ui.js)
export function dropHandedOffScreen() { var el = document.getElementById('nexo-call-screen'); if (el && el.classList.contains('nc-gone')) { el.remove(); syncCallSplit(); } }
export function ensureCallStyle() { _style(); }
export function fitCallLabels(bt) { _fitLabels(bt); _watchFit(); }

function _btn(icon, label, cls, fn, extra) {
  var b = document.createElement('button');
  b.className = 'nc-btn ' + cls + (extra ? ' ' + extra : '');
  b.innerHTML = '<span class="nc-ic">' + _svg(icon, extra && extra.indexOf('nc-big') >= 0 ? 32 : 26) + '</span><span>' + label + '</span>';
  b.onclick = function(e) { e.stopPropagation(); fn(); var sc = document.getElementById('nexo-call-screen'); if (sc) _autoHide(sc); };
  return b;
}

// Ronda 2778 (pedido del dueño): contestar deslizando el botón hacia arriba. Se arrastra el icono; al soltar por encima
// de ~55 px, contesta. El toque normal (onclick de _btn) sigue valiendo como alternativa; contestar es idempotente
// (calls.accept() solo hace algo con la llamada sonando), así que desliz + clic no contesta dos veces.
function _makeSwipeAccept(btn, onAccept) {
  var ic = btn.querySelector('.nc-ic'); if (!ic) return;
  var down = false, sy = 0, dy = 0, TH = 55, MAX = 96;
  var reset = function(anim) { ic.style.transition = anim ? 'transform .18s ease-out' : 'none'; ic.style.transform = ''; };
  btn.addEventListener('pointerdown', function(e) {
    down = true; dy = 0; sy = e.clientY; ic.style.transition = 'none';
    try { btn.setPointerCapture(e.pointerId); } catch (x) {}
  });
  btn.addEventListener('pointermove', function(e) {
    if (!down) return;
    dy = e.clientY - sy;
    var up = Math.max(0, Math.min(MAX, -dy));
    ic.style.transform = 'translateY(' + (-up) + 'px)';
    btn.style.opacity = String(1 - up / (MAX * 2.2));
  });
  var end = function() {
    if (!down) return;
    down = false; btn.style.opacity = '';
    var up = -dy;
    reset(true);
    if (up >= TH) onAccept();
  };
  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
}

// Imagen pequeña (la propia o, si se cambió, la del otro): se arrastra y queda en la esquina más cercana
var _pip = { swapped: false, corner: 'tr' };
function _placePip(el, node) {
  var W = el.clientWidth || window.innerWidth, H = el.clientHeight || window.innerHeight, w = 104, h = 148, m = 14;
  var top = _pip.corner.charAt(0) === 't' ? 84 : H - h - 150, left = _pip.corner.charAt(1) === 'l' ? m : W - w - m;
  node.style.left = left + 'px'; node.style.top = top + 'px';
}
function _makeDraggable(el, node) {
  if (node._ncDrag) return;
  node._ncDrag = true;
  var sx = 0, sy = 0, ox = 0, oy = 0, moved = false, down = false;
  node.addEventListener('pointerdown', function(e) {
    if (!node.classList.contains('nc-pip')) return;
    down = true; moved = false; sx = e.clientX; sy = e.clientY; ox = node.offsetLeft; oy = node.offsetTop;
    node.style.transition = 'none';
    try { node.setPointerCapture(e.pointerId); } catch (x) {}
  });
  node.addEventListener('pointermove', function(e) {
    if (!down) return;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    node.style.left = (ox + dx) + 'px'; node.style.top = (oy + dy) + 'px';
  });
  var up = function(e) {
    if (!down) return;
    down = false; node.style.transition = '';
    if (moved) {
      var W = el.clientWidth || window.innerWidth, H = el.clientHeight || window.innerHeight;
      _pip.corner = (node.offsetTop + 74 < H / 2 ? 't' : 'b') + (node.offsetLeft + 52 < W / 2 ? 'l' : 'r');
      _placePip(el, node);
    } else { _pip.swapped = !_pip.swapped; _videoLayout(el, _calls() && _calls().state()); }
    e.stopPropagation();
  };
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('click', function(e) { e.stopPropagation(); });
}

// Ronda 2772: ¿la imagen grande llena la pantalla? Sí si así se ve al menos el 78 % de ella (si no, se ve entera con
// bandas: en vertical, una imagen 3:4 en un teléfono alargado solo enseñaría el 62 %); dos toques lo cambian
var _fit = { user: null };
function _autoFill(el, node) {
  var w = node && (node.videoWidth || node.width), h = node && (node.videoHeight || node.height), W = el.clientWidth, H = el.clientHeight;
  if (!w || !h || !W || !H) return false;
  var k = Math.max(W / w, H / h);
  return Math.min(1, W / (w * k)) * Math.min(1, H / (h * k)) >= 0.78;
}
// Ronda 2772 (pedido del dueño: ver al otro como en un espejo): con su cámara de delante, la imagen del otro se pone en
// espejo aquí (como uno se ve a sí mismo); se quita en Perfil. Su cámara de detrás, nunca.
export function mirrorPeerPref() { try { return localStorage.getItem('nexo_call_mirror') !== '0'; } catch (e) { return true; } }
export function setMirrorPeerPref(on) { try { localStorage.setItem('nexo_call_mirror', on ? '1' : '0'); } catch (e) {} }

// Videollamada: la imagen del otro a pantalla completa y la propia pequeña (o al revés si se tocó la pequeña)
function _videoLayout(el, st) {
  var calls = _calls();
  if (!st || !st.video || st.state !== 'active' || !calls) return;
  var v = calls.videoViews();
  if (v.remote && v.remote.parentNode !== el) { v.remote.classList.add('call-remote-video'); el.insertBefore(v.remote, el.querySelector('.nc-top')); }
  if (v.local && v.local.parentNode !== el) { v.local.classList.add('call-local-video'); el.appendChild(v.local); }
  if (v.local) v.local.classList.remove('nc-preview'); // 3152: la vista previa de mientras sonaba pasa a ser la pequeña
  Array.prototype.forEach.call(el.querySelectorAll('.call-local-video, .call-remote-video'), function(n) { if (n !== v.local && n !== v.remote) n.remove(); }); // (de una llamada anterior: cruce)
  var big = _pip.swapped ? v.local : v.remote, small = _pip.swapped ? v.remote : v.local;
  if (big) { big.classList.remove('nc-pip'); big.classList.add('nc-full'); big.style.left = ''; big.style.top = ''; }
  if (small) { small.classList.remove('nc-full'); small.classList.add('nc-pip'); _placePip(el, small); _makeDraggable(el, small); }
  if (v.local) v.local.style.transform = (st.facing || 'user') === 'user' ? 'scaleX(-1)' : 'none'; // la de delante, como un espejo
  // 13-11: la pantalla del otro, entera y sin espejo (con el zoom de dos dedos si lo hay)
  el.classList.toggle('nc-peer-screen', !!st.peerScreen);
  // zoom (call_gestos.js) solo de la imagen del otro cuando es la grande; con la mía grande o sin imagen, tamaño normal
  if (_pip.swapped || !v.remote) zoomReset();
  if (v.remote) v.remote.style.transform = peerTransform(!st.peerScreen && st.peerFront === true && mirrorPeerPref());
  el.classList.toggle('nc-fill', !st.peerScreen && (_fit.user ? _fit.user === 'fill' : _autoFill(el, big)));
  if (v.local) v.local.style.visibility = st.screen || st.cameraOff || (st.camState && st.camState !== 'on') ? 'hidden' : '';
  _screenBar(el, st);
  el.classList.add('nc-live');
  // Ronda 2769: sin imagen del otro, su foto y el motivo (antes la pantalla quedaba negra)
  el.classList.toggle('nc-novideo', !!(st.peerCam && st.peerCam !== 'on') || !calls.remoteVideoLive());
}

// 13-11: compartir pantalla — barra roja mientras comparto (tocarla detiene) y aviso antes de empezar
function _screenBar(el, st) {
  var bar = el.querySelector('.nc-scrbar');
  if (!st.screen) { if (bar) bar.remove(); return; }
  if (bar) return;
  bar = document.createElement('div');
  bar.className = 'nc-scrbar';
  bar.textContent = t('call_screen_on', 'Compartiendo tu pantalla · Detener');
  bar.onclick = function(e) { e.stopPropagation(); var c = _calls(); if (c) c.shareScreen(false); };
  el.appendChild(bar);
}
function _screenAsk(el, onYes) {
  if (document.getElementById('nexo-scr-ask')) return;
  var ov = document.createElement('div');
  ov.id = 'nexo-scr-ask';
  ov.className = 'nx-ask';
  ov.innerHTML = '<div class="nc-ask-box nx-ask-card"><div class="nc-ask-txt nx-ask-text"></div><div class="nc-ask-btns nx-ask-actions"><button class="nc-ask-no nx-btn"></button><button class="nc-ask-yes nx-btn nx-btn-primary"></button></div></div>';
  ov.querySelector('.nc-ask-txt').textContent = t('call_screen_ask', 'Se verá TODO lo que haya en tu pantalla, también las notificaciones que lleguen. Android te pedirá permiso.');
  ov.querySelector('.nc-ask-no').textContent = t('cancel', 'Cancelar');
  ov.querySelector('.nc-ask-yes').textContent = t('call_screen_go', 'Compartir');
  ov.onclick = function(e) { e.stopPropagation(); if (e.target === ov) ov.remove(); };
  ov.querySelector('.nc-ask-no').onclick = function(e) { e.stopPropagation(); ov.remove(); };
  ov.querySelector('.nc-ask-yes').onclick = function(e) { e.stopPropagation(); ov.remove(); onYes(); };
  el.appendChild(ov);
}
// Ronda 2769: avisos de la llamada: mi micrófono, el del otro y mi cámara (en ese orden de importancia)
// (el motivo en palabras, no el nombre del error del navegador)
function _devErr(e) {
  e = String(e || '');
  if (!e || /^sin micr/i.test(e)) return '';
  if (/NotAllowed|PermissionDenied|Security/.test(e)) return t('call_err_no_permission', 'sin permiso');
  if (/NotFound|DevicesNotFound/.test(e)) return t('call_err_not_found', 'no encontrado');
  if (/NotReadable|Abort|TrackStart/.test(e)) return t('call_err_busy_other_app', 'ocupado por otra app');
  return e;
}
function _warnText(st, name) {
  if (!st || st.state !== 'active') return '';
  if (st.micState === 'retry') return t('call_mic_retrying', 'Tu micrófono no responde: reintentando…');
  var why = _devErr(st.micError);
  if (st.micState === 'none' || st.micError) return t('call_no_mic', 'Sin micrófono') + (why ? ' (' + why + ')' : '') + ': ' + name + t('call_cant_hear_you', ' no te oye');
  if (st.peerMic === 'retry' || st.peerMic === 'none') return t('call_peer_mic_prefix', 'El micrófono de ') + name + t('call_peer_mic_broken', ' no funciona: no se le oye');
  if (st.video && st.camState === 'retry' && !st.cameraOff) return t('call_cam_retrying', 'Tu cámara no está disponible: reintentando…');
  if (st.video && st.camState === 'none' && _camBlocked(st)) return t('call_cam_no_perm', 'NEXO no tiene permiso para la cámara: toca aquí para darlo');
  if (st.video && st.camState === 'none') return t('call_cam_voice_only', 'Tu cámara no funciona: solo voz');
  return '';
}
// 3098: la cámara no abre porque el permiso de NEXO está bloqueado (el Honor del 14-11: tres «NotAllowedError» y solo voz)
function _camBlocked(st) { return !!st && st.camState === 'none' && /NotAllowed|PermissionDenied/.test(String(st.camError || '')); }
// Lo que se ve en lugar de la imagen del otro (el vídeo solo va por Wi-Fi: por Bluetooth, solo voz)
// `isBt` es un booleano (no el texto ya traducido) para no depender del idioma en la lógica.
function _peerVideoText(st, isBt) {
  if (st.peerCam === 'off') return t('call_peer_cam_off', 'Cámara apagada');
  if (st.peerCam === 'none') return t('call_peer_cam_none', 'Sin cámara: solo voz');
  if (st.peerCam === 'retry') return t('call_peer_cam_retry', 'Su cámara no está disponible');
  return isBt ? t('call_no_wifi_voice_only', 'Sin Wi-Fi: solo voz (el vídeo vuelve con el Wi-Fi)') : t('call_waiting_image', 'Esperando imagen…');
}

// ¿El enlace activo es por Bluetooth? (true si hay enlace y NO es Wi-Fi). Fuente de la verdad para la lógica,
// separada del texto mostrado por _linkText (que ya va traducido).
function _isBtLink(nx) {
  var calls = _calls(), l = calls && typeof calls._link === 'function' ? calls._link(nx) : null;
  return !!l && l.indexOf('lan:') !== 0;
}

function _linkText(nx) {
  var calls = _calls(), l = calls && typeof calls._link === 'function' ? calls._link(nx) : null;
  return l ? (l.indexOf('lan:') === 0 ? t('call_via_wifi', 'por Wi-Fi') : l.indexOf('net:') === 0 ? t('call_via_internet', 'por internet') : t('call_via_bt', 'por Bluetooth')) : '';
}
// #dueño: al cerrarse la llamada cortada, volver al chat del contacto donde se hizo
function _openChatOf(nx) { try { var b = _bi(); if (b && typeof b.openChat === 'function') b.openChat(_normId(nx)).catch(function() {}); } catch (e) {} }

// 3152: la videollamada saliente abre la cámara al llamar: mientras suena, uno se ve a pantalla completa detrás
function _preview(el, st) {
  var calls = _calls(), v = st.video && calls && typeof calls.videoViews === 'function' ? calls.videoViews() : null, lv = v && v.local;
  if (!lv) return;
  if (lv.parentNode !== el) { lv.classList.add('call-local-video'); el.insertBefore(lv, el.querySelector('.nc-top')); }
  lv.classList.remove('nc-pip', 'nc-full'); lv.classList.add('nc-preview'); lv.style.left = ''; lv.style.top = '';
  lv.style.transform = (st.facing || 'user') === 'user' ? 'scaleX(-1)' : 'none';
  lv.style.visibility = st.cameraOff || (st.camState && st.camState !== 'on') ? 'hidden' : '';
}

function _render(st) {
  var calls = _calls();
  clearInterval(_tick);
  // #224: la videollamada pasó a llamada de GRUPO sin cortar («Agregar»): la pantalla se queda tal cual (con sus imágenes) hasta que
  // la de grupo las toma (dropHandedOffScreen); sin «Llamada terminada», sin dejar el modo llamada del teléfono
  if (st && st.state === 'ended' && (st.reason === 'upgrade' || st.reason === 'merged')) { // (3216: «Unir», igual)
    _stopTone(); clearTimeout(_hideTimer); closeCallReply(st.nx);
    var up = document.getElementById('nexo-call-screen');
    if (up) { up.classList.add('nc-gone'); clearTimeout(_rmTimer); _rmTimer = setTimeout(function() { _rmTimer = null; dropHandedOffScreen(); }, 4000); }
    _render._modeFor = null; _pip = { swapped: false, corner: 'tr' };
    syncCallSplit();
    return;
  }
  if (st && st.state === 'ended' && st.bridged === 'peer') { // 3217: uno salió del puente; el otro sigue conmigo (su pantalla)
    _stopTone(); clearTimeout(_hideTimer); closeCallReply(st.nx);
    var bgone = document.getElementById('nexo-call-screen'); if (bgone) bgone.remove();
    _render._modeFor = null; _pip = { swapped: false, corner: 'tr' };
    syncCallSplit();
    callToast(t('call_bridge_left', '{name} salió de la llamada').replace('{name}', _name(st.nx)), 3000);
    return;
  }
  if (!st || st.state === 'ended') {
    _stopTone(); clearTimeout(_hideTimer);
    if (st) closeCallReply(st.nx);
    var old = document.getElementById('nexo-call-screen');
    if (old) {
      old.classList.remove('nc-live', 'nc-hide', 'nc-waiting', 'nc-appmini'); // (3277: el final se ve entero y la llamada siguiente no nace como mini)
      var s0 = old.querySelector('.call-status');
      if (s0 && st) { s0.classList.remove('nc-warn'); s0.textContent = st.reason === 'busy' ? t('call_end_busy', 'Ocupado') : st.reason === 'rejected' ? t('call_end_rejected', 'Rechazada') : st.reason === 'unanswered' ? t('call_end_no_answer', 'No contesta') : st.reason === 'lost' ? t('call_end_lost', 'Se cortó') : st.reason === 'missed' ? t('call_end_missed', 'Llamada perdida') : t('call_end_finished', 'Llamada terminada') + (st.seconds ? ' · ' + _fmt(st.seconds) : ''); }
      Array.prototype.forEach.call(old.querySelectorAll('.call-remote-video, .call-local-video, .nc-scrbar, #nexo-scr-ask'), function(n) { n.remove(); });
      old.classList.remove('nc-peer-screen'); zoomReset();
      var bt0 = old.querySelector('.call-buttons'); bt0.innerHTML = '';
      // #dueño: si se CORTÓ por mala conexión ('lost'), la pantalla da 5 s para «Volver a llamar» y luego se cierra y
      // vuelve al chat del contacto donde se hizo la llamada. Cualquier otro final se quita en 1,4 s como siempre.
      if (st && st.reason === 'lost') {
        var lnx = st.nx, lvideo = !!st.video;
        bt0.appendChild(_btn('phone', t('call_call_again', 'Volver a llamar'), 'call-again', function() {
          var c2 = _calls(); if (!c2) return; clearTimeout(_rmTimer); _rmTimer = null;
          c2.start(lnx, lvideo).catch(function(err) { callToast((err && err.message) || 'Error', 3500); });
        }, 'nc-green'));
        clearTimeout(_rmTimer); _rmTimer = setTimeout(function() { _rmTimer = null; old.remove(); syncCallSplit(); _openChatOf(lnx); }, 5000);
      } else {
        clearTimeout(_rmTimer); _rmTimer = setTimeout(function() { _rmTimer = null; old.remove(); syncCallSplit(); }, 1400);
      }
    }
    _render._modeFor = null; _speaker = false; _pip = { swapped: false, corner: 'tr' };
    _audioMode(false);
    return;
  }
  clearTimeout(_rmTimer); _rmTimer = null; // ronda 2768: una llamada nueva no pierde su pantalla por el borrado de la anterior
  if (st.state !== 'ringing') closeCallReply(st.nx);
  var el = _screen(), name = _name(st.nx);
  syncCallSplit(); // #220: con la de grupo también abierta, pantalla dividida
  el.classList.toggle('nc-video', !!st.video);
  el.classList.toggle('nc-waiting', st.state === 'calling' || st.state === 'ringing');
  el.classList.toggle('nc-canmin', canMinimize('1')); // 3155: flecha para minimizar (en curso o llamando)
  var av = el.querySelector('.nc-av');
  av.className = 'nc-av ble-contact-avatar nx-person-av ' + _getGradientForUUID(String(st.nx || ''));
  av.style.backgroundImage = '';
  av.textContent = _getInitials(name);
  paintAvatar(av, st.nx); // ronda 2765: foto de perfil
  var brg = st.state === 'active' ? bridgeOf(_bi()) : null, shown = callShownName(st); // 3217: puente
  el.classList.toggle('nc-bridge', !!brg);
  secondAvatar(el.querySelector('.nc-av-wrap'), bridgeOther(st) || (st.state === 'active' && st.conf && st.conf[0] ? st.conf[0].nx : ''));
  if (!brg) confNotice(st);
  el.querySelector('.call-name').textContent = shown;
  var status = el.querySelector('.call-status'), note = el.querySelector('.call-note'), bt = el.querySelector('.call-buttons'), mini = el.querySelector('.nc-mini');
  var lock = el.querySelector('.nc-lock span'), via = _linkText(st.nx);
  lock.textContent = t('call_e2e', 'Cifrada de extremo a extremo') + (via ? ' · ' + via : '');
  bt.innerHTML = ''; bt.classList.remove('nc-incoming', 'nc-many', 'nc-four');
  // Ronda 2769: con el estado de la cámara (si lo hay) en vez de "sin cámara" fijo al empezar (ahora se reintenta)
  note.textContent = st.camState || st.micState ? _warnText(st, name) : st.micError ? t('call_no_mic', 'Sin micrófono') + (_devErr(st.micError) ? ': ' + _devErr(st.micError) : '') : st.video && st.videoOk === false ? t('call_no_cam_this_phone', 'Sin cámara en este teléfono: solo voz') : '';
  // 3098: con la cámara bloqueada, el aviso se toca y abre los permisos de NEXO (al volver, se reintenta la cámara)
  var camAsk = st.state === 'active' && st.video && _camBlocked(st) && !(st.micState === 'retry' || st.micState === 'none' || st.micError);
  note.classList.toggle('nc-tap', !!camAsk); // (3217: sin !!, en una llamada de voz camAsk era undefined y la clase se alternaba en cada repintado)
  note.onclick = camAsk ? function() { haptic('confirm'); calls.askCamPermission(); } : null;
  var warnbar = el.querySelector('.nc-warnbar');
  if (st.state === 'calling') {
    status.classList.remove('nc-warn');
    status.textContent = st.video ? t('call_videocalling', 'Videollamada…') : t('call_calling', 'Llamando…');
    if (st.video) _preview(el, st);
    bt.appendChild(_btn('phone', t('call_hangup', 'Colgar'), 'call-hangup', function() { haptic('confirm'); calls.hangup(); }, 'nc-red'));
    // 3152 (diagnóstico S24 16-11: la app pasó a segundo plano mientras sonaba y en toda la llamada no salió ni voz ni imagen): el
    // modo llamada del teléfono —y con él el servicio con permiso de micrófono, que Android solo deja arrancar con la app a la
    // vista— se pone al LLAMAR, no al contestar el otro (micrófono y cámara ya se abren al llamar, calls.js)
    if (_render._modeFor !== st.id) { _render._modeFor = st.id; _speaker = !!st.video; _audioMode(true); }
    if (!_ring) _startTone(false);
  } else if (st.state === 'ringing') {
    status.classList.remove('nc-warn');
    status.textContent = st.video ? t('call_incoming_video', 'Videollamada entrante') : t('call_incoming_voice', 'Llamada de voz entrante');
    bt.classList.add('nc-incoming');
    bt.appendChild(_btn('phone', t('call_reject', 'Rechazar'), 'call-reject', function() { calls.reject(); }, 'nc-red nc-big'));
    if (callCount() > 1) { var rnx = st.nx; bt.appendChild(replyButton(rnx, function() { var c = _calls(); if (c && c.call && c.call.nx === rnx && c.call.state === 'ringing') c.reject(); })); } // #222
    var mb0 = callCount() > 1 ? mergeButton(true) : null; if (mb0) { bt.appendChild(mb0); bt.classList.add('nc-four'); } // 3216
    // Ronda 2778 (pedido del dueño): contestar deslizando hacia arriba; el toque también vale
    var acc = _btn(st.video ? 'cam' : 'phone', t('call_swipe_or_tap', 'Desliza o toca'), 'call-accept', function() { haptic('confirm'); calls.accept(); }, 'nc-green nc-big nc-swipe-up');
    _makeSwipeAccept(acc, function() { calls.accept(); _autoHide(el); });
    bt.appendChild(acc);
    if (!_ring) _startIncomingTone();
  } else if (st.state === 'active') {
    _stopTone();
    var upd = function() {
      var cur = (calls && calls.state()) || st, dur = _fmt(Math.max(0, Math.round((Date.now() - (st.startedAt || Date.now())) / 1000)));
      // #dueño (internet): mala conexión → «Reconectando…» (lo marca calls.js); antes de eso, «Conexión inestable…»
      var recon = !!cur.reconnecting;
      var weak = !recon && cur.lastRx && Date.now() - cur.lastRx > 3000;
      var hl = holdLabel(cur); // #222: en espera (yo o el otro): ni «inestable» ni «reconectando»
      var slabel = hl ? hl + ' · ' + dur : recon ? t('call_reconnecting', 'Reconectando…') : weak ? t('call_unstable', 'Conexión inestable…') : dur;
      status.textContent = slabel;
      status.classList.toggle('nc-warn', !hl && (recon || !!weak));
      mini.textContent = shown + ' · ' + slabel;
      var via2 = _linkText(st.nx);
      lock.textContent = t('call_e2e', 'Cifrada de extremo a extremo') + (via2 ? ' · ' + via2 : '');
      if (st.video) {
        _videoLayout(el, cur);
        // Ronda 2769: en videollamada los avisos van arriba; sin imagen del otro, debajo de su nombre el motivo
        var w = _warnText(cur, name);
        if (warnbar) warnbar.textContent = w;
        note.textContent = el.classList.contains('nc-novideo') ? _peerVideoText(cur, _isBtLink(st.nx)) + (w ? ' · ' + w : '') : w;
      } else note.textContent = _warnText(cur, name) || (bridgeOf(_bi()) ? t('call_bridge_note', 'Unidas por tu teléfono: si cuelgas, termina para los dos') : '');
    };
    upd(); _tick = setInterval(upd, 1000);
    if (st.video) bt.appendChild(_btn('flip', t('call_flip', 'Girar'), 'call-flip', function() { calls.flipCamera(); }));
    // 13-11 (dueño): compartir pantalla (aviso antes; si ya comparto, «Detener»)
    if (st.video && typeof calls.shareScreen === 'function') bt.appendChild(_btn('screen', st.screen ? t('call_screen_stop', 'Detener') : t('call_screen', 'Pantalla'), 'call-screen', function() {
      if (st.screen) { calls.shareScreen(false); return; }
      _screenAsk(el, function() {
        calls.shareScreen(true).then(function(ok) { if (!ok) callToast(t('call_screen_no', 'No se compartió la pantalla'), 2500); })
          .catch(function(err) { callToast((err && err.message) || t('call_screen_no', 'No se compartió la pantalla'), 3500); });
      });
    }, st.screen ? 'nc-red' : ''));
    if (st.video) bt.appendChild(_btn(st.cameraOff ? 'camOff' : 'cam', st.cameraOff ? t('call_camera_off', 'Cámara no') : t('call_camera', 'Cámara'), 'call-camera', function() { calls.camera(!!st.cameraOff); }, st.cameraOff ? 'nc-on' : ''));
    // 3155 (dueño 16-11): «Vídeo» en una llamada de voz: pasa a videollamada sin colgar (el otro ve mi imagen y enciende la suya si quiere)
    if (!st.video && !brg && typeof calls.toVideo === 'function') bt.appendChild(_btn('cam', t('call_to_video', 'Vídeo'), 'call-tovideo', function() { // (3217: en el puente, solo voz)
      haptic('confirm');
      calls.toVideo().then(function(ok) { if (!ok) return; _speaker = true; _audioMode(true); var c2 = _calls(); if (c2) _render(c2.state()); })
        .catch(function(err) { callToast((err && err.message) || t('call_err_to_video', 'No se pudo pasar a videollamada'), 3500); });
    }));
    bt.appendChild(_btn(st.muted ? 'micOff' : 'mic', st.muted ? t('call_muted', 'Silenciado') : t('call_mute', 'Silenciar'), 'call-mute', function() { calls.mute(!st.muted); }, st.muted ? 'nc-on' : ''));
    // Altavoz / auricular (en la videollamada, altavoz de entrada)
    bt.appendChild(_btn(_speaker ? 'speaker' : 'ear', _speaker ? t('call_speaker', 'Altavoz') : t('call_earpiece', 'Auricular'), 'call-speaker', function() { _speaker = !_speaker; _audioMode(true); _render(calls.state()); }, _speaker ? 'nc-on' : ''));
    // #130 (dueño 31-10): AGREGAR un contacto a la llamada 1-a-1 → se convierte en llamada de GRUPO (el contacto actual + el
    // nuevo). De voz: cuelga la 1-a-1 y arranca el grupo (el otro entra solo, #221). #224: de vídeo, pasa a grupo SIN cortar.
    var two = callCount() > 1 && !brg; // (3217: en el puente, las dos van juntas: ni «En espera» ni «Unir»/«Agregar»)
    if (two || (st.userHold && !brg)) bt.appendChild(holdButton(calls, st)); // #222: en espera / reanudar
    var mb = two ? mergeButton(false) : null; // 3216: con dos llamadas, «Unir» en el sitio de «Agregar» (la barra no cambia)
    var confOn = !!(st.conf && st.conf.length); // 3217: me unieron por un puente: «Agregar» sacaría al que une de su puente
    if (mb) bt.appendChild(mb); else if (!brg && !confOn) bt.appendChild(_btn('addp', t('call_add', 'Agregar'), 'call-add', function() {
      if (callCount() > 1) { callToast(t('call_max_two_grp', 'Con dos llamadas a la vez no se puede pasar a llamada de grupo'), 3500); return; } // #222
      var cur = calls.state(); if (!cur) return;
      var peer = cur.nx, upId = cur.id, me = _normId(_bi() && _bi().localNexoId);
      var gcall = _bi() && _bi().gcall;
      if (!gcall) { callToast(t('grp_call_na', 'Las llamadas de grupo no están disponibles'), 3000); return; }
      _pickContact({ title: t('call_add_pick', 'Agregar a la llamada'), exclude: [peer, me], onPick: function(nx) {
        // #224 (dueño 16-11: «cuando hago una videollamada con otro contacto y luego agrego un contacto a la videollamada, no debería
        // quitarse toda la parte de video»): la videollamada pasa a la de grupo SIN cortar: la misma cámara, la imagen del otro en el
        // mismo sitio (arriba) y el nuevo sonando abajo; el otro entra solo (sin colgar: su lado hace lo mismo). De voz, como antes.
        var ad = typeof calls.handoff === 'function' ? calls.handoff() : null;
        if (ad) {
          gcall.start([peer, nx], true, null, { upgrade: { nx: peer, id: upId }, adopt: ad }).catch(function(err) {
            if (!(gcall.gc && gcall.gc.adopt)) { try { ad.media.stop(); } catch (e) {} }
            callToast((err && err.message) || 'Error', 3500);
          });
          return;
        }
        callToast(t('call_to_group', 'Convirtiendo en llamada de grupo…'), 2500);
        try { calls.hangup(); } catch (e) {}
        // #221 (dueño 15-11): el que ya estaba en la llamada entra solo a la de grupo (lleva el id de esta llamada), sin volver a contestar
        setTimeout(function() { gcall.start([peer, nx], false, null, { upgrade: { nx: peer, id: upId } }).catch(function(err) { callToast((err && err.message) || 'Error', 3500); }); }, 400);
      } });
    }, two ? 'nc-off' : ''));
    bt.appendChild(_btn('phone', t('call_hangup', 'Colgar'), 'call-hangup', function() { haptic('confirm'); calls.hangup(); }, 'nc-red'));
    bt.classList.toggle('nc-many', bt.children.length >= 6); // videollamada (7): letra algo menor; voz (4): como siempre
    _fitLabels(bt); _watchFit();
    if (!_render._modeFor || _render._modeFor !== st.id) { _render._modeFor = st.id; _speaker = !!st.video; _audioMode(true); _render(calls.state()); return; }
    if (st.video) _autoHide(el);
  }
}

// Llamada entrante con la app en segundo plano: aviso del teléfono (ronda 2763: como una llamada, con tono y
// Contestar / Rechazar; builds anteriores del nativo: aviso de mensaje)
function _notifyIncoming(st) {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return;
  var pl = _plugin();
  if (pl && typeof pl.notifyCall === 'function') { pl.notifyCall({ chatId: st.nx, name: _name(st.nx), video: !!st.video, offerId: st.offerMid || '' }).catch(function() {}); _callNotif = true; return; }
  if (pl && typeof pl.notifyMessage === 'function') pl.notifyMessage({ chatId: st.nx, name: _name(st.nx), msgId: st.id, text: t('call_incoming_notif', '📞 Llamada entrante'), count: 1 }).catch(function() {});
}
var _callNotif = false;
function _lockScreenDone() { var pl = _plugin(); if (pl && typeof pl.callScreenDone === 'function') pl.callScreenDone().catch(function() {}); }
function _clearCallNotif() { var pl = _plugin(); if (pl && typeof pl.clearCall === 'function') pl.clearCall().catch(function() {}); _callNotif = false; }

// Ronda 2763: lo que se tocó en el aviso de llamada (Contestar / Rechazar) se aplica a la llamada que está sonando.
// Ronda 2768: solo si es la misma oferta (si el nativo la dice): lo tocado en el aviso de una llamada ya colgada no
// contesta ni rechaza la siguiente de ese contacto
function _applyCallAction(r) {
  var calls = _calls(), st = calls && calls.state();
  if (!r || !st || st.state !== 'ringing') return;
  var mine = function(nx, offer) { return nx && _normId(nx) === _normId(st.nx) && (!offer || offer === st.offerMid); };
  if (r.answer && mine(r.answer, r.answerOffer)) { console.log('[CALL] Contestada desde el aviso'); calls.accept(); }
  else if (r.declined && mine(r.declined, r.declinedOffer)) { console.log('[CALL] Rechazada desde el aviso'); calls.reject(); }
}
function _checkCallAction() {
  var pl = _plugin();
  if (pl && typeof pl.callAction === 'function') pl.callAction().then(_applyCallAction).catch(function() {});
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
// #dueño 05-11: llamada + videollamada agrupadas a la DERECHA (en un contenedor) para que el nombre quede CENTRADO.
// El contenedor lo comparten la 1-a-1 (acá), la de grupo (groupcall_ui) — lo crea quien llegue primero.
function _headActions(header) {
  var a = document.getElementById('chat-head-actions');
  if (!a) { a = document.createElement('div'); a.id = 'chat-head-actions'; header.appendChild(a); }
  return a;
}
function _installButton() {
  var header = document.getElementById('chat-header');
  if (!header || document.getElementById('nexo-call-btn')) return;
  var actions = _headActions(header);
  var b = document.createElement('button');
  b.id = 'nexo-call-btn';
  b.title = t('call_btn_call_title', 'Llamar');
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>'; // ronda 2763: icono dibujado (antes un emoji)
  b.style.cssText = 'width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;font-size:18px;cursor:pointer;flex-shrink:0;margin-left:6px;';
  b.addEventListener('click', function(e) { e.stopPropagation(); _startCall(_getCurrentContactId(), false); });
  actions.appendChild(b);
  // Videollamada (solo con el contacto en el mismo Wi-Fi)
  var v = document.createElement('button');
  v.id = 'nexo-video-btn';
  v.title = t('call_btn_video_title', 'Videollamada');
  v.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 11l6-3v8l-6-3z"/></svg>'; // ronda 2763: icono dibujado (antes un emoji)
  v.style.cssText = b.style.cssText;
  v.addEventListener('click', function(e) { e.stopPropagation(); _startCall(_getCurrentContactId(), true); });
  actions.appendChild(v);
}
// #222 (dueño 15-11): llamar desde el chat. Con una llamada en curso con otro contacto, la nueva va por la SEGUNDA línea (la
// primera queda en espera al contestar el otro); con dos llamadas a la vez (contando la de grupo), no se puede llamar a nadie más.
function _startCall(cid, video) {
  var b = _bi(), c1 = b && b.calls, c2 = b && b.calls2, nx = _normId(cid);
  if (!c1 || !nx) return;
  if (isBlocked(nx)) { haptic('confirm'); callToast(t('block_call', 'Desbloquea a este contacto para llamarle'), 3000); return; } // bloqueo (24-11)
  if (callCount() >= 2) { haptic('confirm'); callToast(t('call_max_two', 'Ya tienes dos llamadas a la vez. Cuelga una para llamar a alguien más'), 3500); return; }
  var busyWith = [c1.call, c2 && c2.call].filter(Boolean).some(function(c) { return _normId(c.nx) === nx; });
  if (busyWith) { callToast(t('call_already_with', 'Ya estás en una llamada con este contacto'), 3000); return; }
  var lane = c1.call && c2 ? c2 : c1;
  lane.start(nx, !!video).catch(function(err) { callToast((err && err.message) || 'Error', 3500); });
}
if (typeof window !== 'undefined') window.NEXO_startCall = function(nx, video) { _startCall(nx, video); }; // 27-11: «Llamar» de la tarjeta de un miembro (member_card.js)
function _refreshButton() {
  var cid = _getCurrentContactId(), gs = _bi() && _bi().groups, show = cid && !(gs && gs.isGroup(cid)) ? '' : 'none';
  var full = callCount() >= 2; // #222: con dos llamadas, apagados (se ven, y al tocarlos dicen por qué)
  ['nexo-call-btn', 'nexo-video-btn'].forEach(function(id) {
    var b = document.getElementById(id); if (!b) return;
    b.style.display = show; b.style.opacity = full ? '0.35' : ''; b.setAttribute('aria-disabled', full ? 'true' : 'false');
    b.title = full ? t('call_max_two_short', 'Ya tienes dos llamadas') : (id === 'nexo-call-btn' ? t('call_btn_call_title', 'Llamar') : t('call_btn_video_title', 'Videollamada'));
  });
}

// Ronda 2769: la cámara del chat (fotos y vídeos) abierta debajo de la llamada tenía ocupada la cámara y, grabando
// vídeo, el micrófono: la llamada no podía abrirlos. Al empezar la llamada se cierra.
function _releaseChatCamera() {
  var ov = document.getElementById('camera-preview-overlay');
  if (ov && !ov.classList.contains('hidden')) { console.log('[CALL] Se cierra la cámara del chat: la usa la llamada'); _hideCameraPreviewOverlay(); }
}

var _lastCount = '';
function _onCountChange() {
  var n = callCount() + '|' + mergeKey(); // (3216: también si cambia lo que se puede unir: la otra pasó a en curso, etc.)
  if (n === _lastCount) return;
  _lastCount = n;
  _refreshButton();
  var c = _calls(); if (c && c.call && c.call.state !== 'ended') _render(c.state());
}

export function installCallsUi() {
  _installButton();
  // 3155: la llamada 1-a-1 minimizada (barra arriba, call_bar.js)
  registerCallBar('1', {
    el: function() { return document.getElementById('nexo-call-screen'); },
    can: function() { var c = _calls(), s = c && c.state(); return !!(s && (s.state === 'active' || s.state === 'calling')); },
    info: function() { var c = _calls(), s = c && c.state(); return s ? { name: callShownName(s), since: s.startedAt || 0, muted: !!s.muted, live: s.state === 'active' } : null; },
    mute: function(on) { var c = _calls(); if (c) c.mute(on); },
    hangup: function() { var c = _calls(); if (c) { haptic('confirm'); c.hangup(); } }
  });
  window.addEventListener('nexo:call', function(e) {
    var st = e && e.detail;
    if (st && (st.state === 'active' || st.state === 'calling')) _releaseChatCamera();
    if (st && st.state === 'ringing') { _notifyIncoming(st); _checkCallAction(); }
    else _clearCallNotif(); // contestada, colgada, perdida…: fuera el aviso que suena
    // Ronda 2765: acabó la llamada: si la app se abrió encima de la pantalla de bloqueo por ella, vuelve detrás
    if (!st || (st.state === 'ended' && st.reason !== 'upgrade' && st.reason !== 'merged')) _lockScreenDone(); // (#224: la que pasa a grupo sigue; 3216: y la que se une)
    _render(st);
    _onCountChange();
  });
  // #222: lo que depende de cuántas llamadas hay (botón «En espera», «Mensaje», botones del chat) se rehace al cambiar
  window.addEventListener('nexo:call2', _onCountChange);
  window.addEventListener('nexo:callBridge', _onCountChange); // 3217
  window.addEventListener('nexo:gcall', _onCountChange);
  // Abierta por una llamada que ya no está (se cortó antes de abrir): detrás de la pantalla de bloqueo
  setTimeout(function() { var c = _calls(); if (!c || !c.call) _lockScreenDone(); }, 8000);
  // Ronda 2768: una oferta que no suena (ocupado, vieja, ya terminada, cruce): fuera el aviso nativo que ya sonaba y, sin
  // llamada, la app vuelve detrás de la pantalla de bloqueo (antes seguía sonando y NEXO se veía sin desbloquear)
  window.addEventListener('nexo:callIgnored', function() { var c = _calls(); if (!c || !c.call || c.call.state !== 'ringing') _clearCallNotif(); if (!c || !c.call) _lockScreenDone(); });
  // Ronda 2768: abierta por un aviso de llamada que ya no existe: a los 15 s sin llamada, detrás del bloqueo y se descarta
  // lo que quedara de "Contestar"/"Rechazar" (si no, la siguiente llamada de ese contacto se contestaba sola)
  var _orphanCheck = function() { setTimeout(function() { var c = _calls(); if (c && c.call) return; _lockScreenDone(); var pl = _plugin(); if (pl && typeof pl.callAction === 'function') pl.callAction().catch(function() {}); }, 15000); };
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') _orphanCheck(); });
  try { var pl = _plugin(); if (pl && typeof pl.addListener === 'function') pl.addListener('onCallAction', function(r) { setTimeout(function() { _applyCallAction(r); }, 300); _orphanCheck(); }); } catch (e) {}
  window.addEventListener('nexo:callLog', function(e) { if (e && e.detail) _logLine(e.detail); });
  window.addEventListener('nexo:ble:openChat', function() { setTimeout(_refreshButton, 0); });
}
