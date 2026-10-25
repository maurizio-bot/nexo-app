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
import { paintAvatar } from './avatar.js';
import { _normId, _getCurrentContactId } from './chat_format.js';
import { _renderMessage } from './render.js';
import { _showInfoToast } from './ui_bits.js';
import { _getGradientForUUID, _getInitials } from './ble_helpers.js';
import { _hideCameraPreviewOverlay } from './camera.js';
import { vaultAppendMessage, vaultFindContactByNexoId } from '../vault/vault_manager.js';

function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _calls() { var b = _bi(); return b && b.calls; }
function _name(nx) { var c = vaultFindContactByNexoId(nx); return (c && (c.name || c.displayName)) || String(nx || '').toUpperCase(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }

var _tick = null, _ring = null, _speaker = false, _rmTimer = null;

// Timbre (entrante) o tono de llamada (saliente) con WebAudio; vibración en la entrante
function _startTone(incoming, vibrateOnly) {
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
  try {
    var pl = _plugin();
    if (pl && typeof pl.callAudio === 'function') pl.callAudio({ on: !!on, speaker: !!on && _speaker }).then(function(r) {
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
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
};
function _svg(name, size) {
  return '<svg width="' + (size || 26) + '" height="' + (size || 26) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + _IC[name] + '</svg>';
}

// Estilos (una vez)
function _style() {
  if (document.getElementById('nexo-call-style')) return;
  var st = document.createElement('style');
  st.id = 'nexo-call-style';
  st.textContent = [
    '#nexo-call-screen{position:fixed;inset:0;z-index:2147483645;color:#fff;overflow:hidden;background:#05060d;user-select:none;-webkit-user-select:none;font-family:inherit}',
    '#nexo-call-screen .nc-bg{position:absolute;inset:-20%;z-index:0;background:radial-gradient(circle at 28% 22%,rgba(0,200,255,.30),transparent 45%),radial-gradient(circle at 76% 72%,rgba(168,85,247,.32),transparent 50%),linear-gradient(160deg,#0a0a15,#14152a 60%,#0b1a33);animation:ncAurora 14s ease-in-out infinite alternate}',
    '@keyframes ncAurora{from{transform:translate(0,0) scale(1)}to{transform:translate(-4%,3%) scale(1.08)}}',
    '#nexo-call-screen .nc-top{position:absolute;top:0;left:0;right:0;z-index:3;padding:calc(16px + env(safe-area-inset-top,0px)) 16px 36px;display:flex;flex-direction:column;align-items:center;gap:8px;transition:opacity .3s}',
    '#nexo-call-screen .nc-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);font-size:11.5px;opacity:.85}',
    '#nexo-call-screen .nc-center{position:absolute;top:19%;left:0;right:0;z-index:2;display:flex;flex-direction:column;align-items:center;transition:opacity .3s}',
    '#nexo-call-screen .nc-av-wrap{position:relative;width:132px;height:132px;margin-bottom:24px}',
    '#nexo-call-screen .nc-av{position:relative;z-index:1;width:132px;height:132px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:48px;font-weight:700;color:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.12),0 14px 44px rgba(0,200,255,.28)}',
    '#nexo-call-screen .nc-ring{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(0,200,255,.6);opacity:0}',
    '#nexo-call-screen.nc-waiting .nc-ring{animation:ncPulse 2.4s ease-out infinite}',
    '#nexo-call-screen .nc-ring.r2{animation-delay:.8s;border-color:rgba(168,85,247,.6)}#nexo-call-screen .nc-ring.r3{animation-delay:1.6s}',
    '@keyframes ncPulse{0%{transform:scale(1);opacity:.9}100%{transform:scale(1.85);opacity:0}}',
    '#nexo-call-screen .call-name{font-size:28px;font-weight:700;text-align:center;padding:0 24px;text-shadow:0 2px 12px rgba(0,0,0,.4)}',
    '#nexo-call-screen .call-status{font-size:15px;opacity:.82;margin-top:8px;font-variant-numeric:tabular-nums;text-align:center}',
    '#nexo-call-screen .call-status.nc-warn{color:#fbbf24;opacity:1}',
    '#nexo-call-screen .call-note{font-size:12px;opacity:.6;margin-top:6px;text-align:center;padding:0 24px}',
    '#nexo-call-screen .nc-bottom{position:absolute;left:0;right:0;bottom:0;z-index:3;padding:0 14px calc(26px + env(safe-area-inset-bottom,0px));transition:transform .3s,opacity .3s}',
    '#nexo-call-screen .call-buttons{margin:0 auto;max-width:440px;display:flex;justify-content:space-around;align-items:flex-start;padding:16px 6px 12px;border-radius:30px;background:rgba(20,21,42,.55);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.09);box-shadow:0 10px 40px rgba(0,0,0,.35)}',
    '#nexo-call-screen .call-buttons.nc-incoming{background:none;border:none;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;justify-content:space-between;max-width:320px;padding:0 18px}',
    '#nexo-call-screen .call-buttons:empty{display:none}',
    '#nexo-call-screen .nc-btn{display:flex;flex-direction:column;align-items:center;gap:7px;background:none;border:none;color:#fff;font-size:11.5px;cursor:pointer;padding:0;min-width:62px;-webkit-tap-highlight-color:transparent}',
    '#nexo-call-screen .nc-btn .nc-ic{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.13);transition:transform .15s,background .2s,color .2s}',
    '#nexo-call-screen .nc-btn:active .nc-ic{transform:scale(.9)}',
    '#nexo-call-screen .nc-btn.nc-on .nc-ic{background:#fff;color:#14152a}',
    '#nexo-call-screen .nc-btn.nc-red .nc-ic{background:#ef4444;box-shadow:0 8px 24px rgba(239,68,68,.45)}',
    '#nexo-call-screen .nc-btn.nc-red .nc-ic svg{transform:rotate(135deg)}',
    '#nexo-call-screen .nc-btn.nc-big .nc-ic{width:72px;height:72px}',
    '#nexo-call-screen .nc-btn.nc-green .nc-ic{background:linear-gradient(135deg,#22c55e,#00c8ff);box-shadow:0 10px 30px rgba(34,197,94,.5);animation:ncBounce 1.4s ease-in-out infinite}',
    '@keyframes ncBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}',
    '#nexo-call-screen .call-remote-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;z-index:1}',
    '#nexo-call-screen .call-local-video{object-fit:cover;background:#1a1b2e}',
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
    '#nexo-call-screen .nc-warnbar{display:none;margin-top:8px;font-size:13px;color:#fbbf24;text-shadow:0 1px 8px rgba(0,0,0,.7);text-align:center}',
    '#nexo-call-screen.nc-video.nc-live .nc-warnbar:not(:empty){display:block}',
    '#nexo-call-screen .nc-mini{display:none;font-size:17px;font-weight:600;text-shadow:0 1px 8px rgba(0,0,0,.6)}',
    '#nexo-call-screen.nc-video.nc-live .nc-mini{display:block}',
    '#nexo-call-screen.nc-hide .nc-top,#nexo-call-screen.nc-hide .nc-bottom{opacity:0;pointer-events:none}',
    '#nexo-call-screen.nc-hide .nc-bottom{transform:translateY(40%)}'
  ].join('\n');
  document.head.appendChild(st);
}

function _screen() {
  var el = document.getElementById('nexo-call-screen');
  if (el) return el;
  _style();
  el = document.createElement('div');
  el.id = 'nexo-call-screen';
  el.innerHTML = '<div class="nc-bg"></div>' +
    '<div class="nc-top"><div class="nc-pill nc-lock">' + _svg('lock', 13) + '<span>Cifrada de extremo a extremo</span></div><div class="nc-mini"></div><div class="nc-warnbar"></div></div>' +
    '<div class="nc-center"><div class="nc-av-wrap"><div class="nc-ring"></div><div class="nc-ring r2"></div><div class="nc-ring r3"></div><div class="nc-av"></div></div>' +
    '<div class="call-name"></div><div class="call-status"></div><div class="call-note"></div></div>' +
    '<div class="nc-bottom"><div class="call-buttons"></div></div>';
  // Videollamada: tocar la pantalla muestra / oculta los controles
  el.addEventListener('click', function(e) {
    if (!el.classList.contains('nc-live') || (e.target && e.target.closest && e.target.closest('.nc-btn, .nc-pip'))) return;
    el.classList.toggle('nc-hide');
    _autoHide(el);
  });
  // Ronda 2772: dos toques en la imagen grande: entera (cabe en la pantalla) ↔ a toda la pantalla (se recorta). El
  // doble toque se mira también a mano (no todos los WebView mandan dblclick); un cambio por doble toque
  var lastTap = 0, lastFill = 0;
  var onVideo = function(e) { return el.classList.contains('nc-live') && !(e.target && e.target.closest && e.target.closest('.nc-btn, .nc-pip')); };
  var fill = function() { var now = Date.now(); if (now - lastFill < 250) return; lastFill = now; _fit.user = el.classList.contains('nc-fill') ? 'fit' : 'fill'; el.classList.toggle('nc-fill', _fit.user === 'fill'); };
  el.addEventListener('dblclick', function(e) { if (onVideo(e)) fill(); });
  el.addEventListener('pointerup', function(e) {
    if (e.pointerType !== 'touch' || !onVideo(e)) return;
    var now = Date.now();
    if (now - lastTap < 350) { lastTap = 0; fill(); } else lastTap = now;
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

function _btn(icon, label, cls, fn, extra) {
  var b = document.createElement('button');
  b.className = 'nc-btn ' + cls + (extra ? ' ' + extra : '');
  b.innerHTML = '<span class="nc-ic">' + _svg(icon, extra && extra.indexOf('nc-big') >= 0 ? 32 : 26) + '</span><span>' + label + '</span>';
  b.onclick = function(e) { e.stopPropagation(); fn(); var sc = document.getElementById('nexo-call-screen'); if (sc) _autoHide(sc); };
  return b;
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
  var big = _pip.swapped ? v.local : v.remote, small = _pip.swapped ? v.remote : v.local;
  if (big) { big.classList.remove('nc-pip'); big.classList.add('nc-full'); big.style.left = ''; big.style.top = ''; }
  if (small) { small.classList.remove('nc-full'); small.classList.add('nc-pip'); _placePip(el, small); _makeDraggable(el, small); }
  if (v.local) v.local.style.transform = (st.facing || 'user') === 'user' ? 'scaleX(-1)' : 'none'; // la de delante, como un espejo
  if (v.remote) v.remote.style.transform = st.peerFront === true && mirrorPeerPref() ? 'scaleX(-1)' : 'none';
  el.classList.toggle('nc-fill', _fit.user ? _fit.user === 'fill' : _autoFill(el, big));
  if (v.local) v.local.style.visibility = st.cameraOff || (st.camState && st.camState !== 'on') ? 'hidden' : '';
  el.classList.add('nc-live');
  // Ronda 2769: sin imagen del otro, su foto y el motivo (antes la pantalla quedaba negra)
  el.classList.toggle('nc-novideo', !!(st.peerCam && st.peerCam !== 'on') || !calls.remoteVideoLive());
}

// Ronda 2769: avisos de la llamada: mi micrófono, el del otro y mi cámara (en ese orden de importancia)
// (el motivo en palabras, no el nombre del error del navegador)
function _devErr(e) {
  e = String(e || '');
  if (!e || /^sin micr/i.test(e)) return '';
  if (/NotAllowed|PermissionDenied|Security/.test(e)) return 'sin permiso';
  if (/NotFound|DevicesNotFound/.test(e)) return 'no encontrado';
  if (/NotReadable|Abort|TrackStart/.test(e)) return 'ocupado por otra app';
  return e;
}
function _warnText(st, name) {
  if (!st || st.state !== 'active') return '';
  if (st.micState === 'retry') return 'Tu micrófono no responde: reintentando…';
  var why = _devErr(st.micError);
  if (st.micState === 'none' || st.micError) return 'Sin micrófono' + (why ? ' (' + why + ')' : '') + ': ' + name + ' no te oye';
  if (st.peerMic === 'retry' || st.peerMic === 'none') return 'El micrófono de ' + name + ' no funciona: no se le oye';
  if (st.video && st.camState === 'retry' && !st.cameraOff) return 'Tu cámara no está disponible: reintentando…';
  if (st.video && st.camState === 'none') return 'Tu cámara no funciona: solo voz';
  return '';
}
// Lo que se ve en lugar de la imagen del otro (el vídeo solo va por Wi-Fi: por Bluetooth, solo voz)
function _peerVideoText(st, via) {
  if (st.peerCam === 'off') return 'Cámara apagada';
  if (st.peerCam === 'none') return 'Sin cámara: solo voz';
  if (st.peerCam === 'retry') return 'Su cámara no está disponible';
  return via === 'por Bluetooth' ? 'Sin Wi-Fi: solo voz (el vídeo vuelve con el Wi-Fi)' : 'Esperando imagen…';
}

function _linkText(nx) {
  var calls = _calls(), l = calls && typeof calls._link === 'function' ? calls._link(nx) : null;
  return l ? (l.indexOf('lan:') === 0 ? 'por Wi-Fi' : 'por Bluetooth') : '';
}

function _render(st) {
  var calls = _calls();
  clearInterval(_tick);
  if (!st || st.state === 'ended') {
    _stopTone(); clearTimeout(_hideTimer);
    var old = document.getElementById('nexo-call-screen');
    if (old) {
      old.classList.remove('nc-live', 'nc-hide', 'nc-waiting');
      var s0 = old.querySelector('.call-status');
      if (s0 && st) { s0.classList.remove('nc-warn'); s0.textContent = st.reason === 'busy' ? 'Ocupado' : st.reason === 'rejected' ? 'Rechazada' : st.reason === 'unanswered' ? 'No contesta' : st.reason === 'lost' ? 'Se cortó' : st.reason === 'missed' ? 'Llamada perdida' : 'Llamada terminada' + (st.seconds ? ' · ' + _fmt(st.seconds) : ''); }
      old.querySelector('.call-buttons').innerHTML = '';
      Array.prototype.forEach.call(old.querySelectorAll('.call-remote-video, .call-local-video'), function(n) { n.remove(); });
      clearTimeout(_rmTimer); _rmTimer = setTimeout(function() { _rmTimer = null; old.remove(); }, 1400);
    }
    _render._modeFor = null; _speaker = false; _pip = { swapped: false, corner: 'tr' };
    _audioMode(false);
    return;
  }
  clearTimeout(_rmTimer); _rmTimer = null; // ronda 2768: una llamada nueva no pierde su pantalla por el borrado de la anterior
  var el = _screen(), name = _name(st.nx);
  el.classList.toggle('nc-video', !!st.video);
  el.classList.toggle('nc-waiting', st.state === 'calling' || st.state === 'ringing');
  var av = el.querySelector('.nc-av');
  av.className = 'nc-av ' + _getGradientForUUID(String(st.nx || ''));
  av.style.backgroundImage = '';
  av.textContent = _getInitials(name);
  paintAvatar(av, st.nx); // ronda 2765: foto de perfil
  el.querySelector('.call-name').textContent = name;
  var status = el.querySelector('.call-status'), note = el.querySelector('.call-note'), bt = el.querySelector('.call-buttons'), mini = el.querySelector('.nc-mini');
  var lock = el.querySelector('.nc-lock span'), via = _linkText(st.nx);
  lock.textContent = 'Cifrada de extremo a extremo' + (via ? ' · ' + via : '');
  bt.innerHTML = ''; bt.classList.remove('nc-incoming');
  // Ronda 2769: con el estado de la cámara (si lo hay) en vez de "sin cámara" fijo al empezar (ahora se reintenta)
  note.textContent = st.camState || st.micState ? _warnText(st, name) : st.micError ? 'Sin micrófono' + (_devErr(st.micError) ? ': ' + _devErr(st.micError) : '') : st.video && st.videoOk === false ? 'Sin cámara en este teléfono: solo voz' : '';
  var warnbar = el.querySelector('.nc-warnbar');
  if (st.state === 'calling') {
    status.classList.remove('nc-warn');
    status.textContent = st.video ? 'Videollamada…' : 'Llamando…';
    bt.appendChild(_btn('phone', 'Colgar', 'call-hangup', function() { calls.hangup(); }, 'nc-red'));
    if (!_ring) _startTone(false);
  } else if (st.state === 'ringing') {
    status.classList.remove('nc-warn');
    status.textContent = st.video ? 'Videollamada entrante' : 'Llamada de voz entrante';
    bt.classList.add('nc-incoming');
    bt.appendChild(_btn('phone', 'Rechazar', 'call-reject', function() { calls.reject(); }, 'nc-red nc-big'));
    bt.appendChild(_btn(st.video ? 'cam' : 'phone', 'Contestar', 'call-accept', function() { calls.accept(); }, 'nc-green nc-big'));
    if (!_ring) _startIncomingTone();
  } else if (st.state === 'active') {
    _stopTone();
    var upd = function() {
      var cur = (calls && calls.state()) || st, t = _fmt(Math.max(0, Math.round((Date.now() - (st.startedAt || Date.now())) / 1000)));
      var weak = cur.lastRx && Date.now() - cur.lastRx > 3000;
      status.textContent = weak ? 'Conexión inestable…' : t;
      status.classList.toggle('nc-warn', !!weak);
      mini.textContent = name + ' · ' + (weak ? 'Conexión inestable…' : t);
      var via2 = _linkText(st.nx);
      lock.textContent = 'Cifrada de extremo a extremo' + (via2 ? ' · ' + via2 : '');
      if (st.video) {
        _videoLayout(el, cur);
        // Ronda 2769: en videollamada los avisos van arriba; sin imagen del otro, debajo de su nombre el motivo
        var w = _warnText(cur, name);
        if (warnbar) warnbar.textContent = w;
        note.textContent = el.classList.contains('nc-novideo') ? _peerVideoText(cur, via2) + (w ? ' · ' + w : '') : w;
      } else note.textContent = _warnText(cur, name);
    };
    upd(); _tick = setInterval(upd, 1000);
    if (st.video) bt.appendChild(_btn('flip', 'Girar', 'call-flip', function() { calls.flipCamera(); }));
    if (st.video) bt.appendChild(_btn(st.cameraOff ? 'camOff' : 'cam', st.cameraOff ? 'Cámara no' : 'Cámara', 'call-camera', function() { calls.camera(!!st.cameraOff); }, st.cameraOff ? 'nc-on' : ''));
    bt.appendChild(_btn(st.muted ? 'micOff' : 'mic', st.muted ? 'Silenciado' : 'Silenciar', 'call-mute', function() { calls.mute(!st.muted); }, st.muted ? 'nc-on' : ''));
    // Altavoz / auricular (en la videollamada, altavoz de entrada)
    bt.appendChild(_btn(_speaker ? 'speaker' : 'ear', _speaker ? 'Altavoz' : 'Auricular', 'call-speaker', function() { _speaker = !_speaker; _audioMode(true); _render(calls.state()); }, _speaker ? 'nc-on' : ''));
    bt.appendChild(_btn('phone', 'Colgar', 'call-hangup', function() { calls.hangup(); }, 'nc-red'));
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
  if (pl && typeof pl.notifyMessage === 'function') pl.notifyMessage({ chatId: st.nx, name: _name(st.nx), msgId: st.id, text: '📞 Llamada entrante', count: 1 }).catch(function() {});
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
function _installButton() {
  var header = document.getElementById('chat-header');
  if (!header || document.getElementById('nexo-call-btn')) return;
  var b = document.createElement('button');
  b.id = 'nexo-call-btn';
  b.title = 'Llamar';
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>'; // ronda 2763: icono dibujado (antes un emoji)
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
  v.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 11l6-3v8l-6-3z"/></svg>'; // ronda 2763: icono dibujado (antes un emoji)
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

// Ronda 2769: la cámara del chat (fotos y vídeos) abierta debajo de la llamada tenía ocupada la cámara y, grabando
// vídeo, el micrófono: la llamada no podía abrirlos. Al empezar la llamada se cierra.
function _releaseChatCamera() {
  var ov = document.getElementById('camera-preview-overlay');
  if (ov && !ov.classList.contains('hidden')) { console.log('[CALL] Se cierra la cámara del chat: la usa la llamada'); _hideCameraPreviewOverlay(); }
}

export function installCallsUi() {
  _installButton();
  window.addEventListener('nexo:call', function(e) {
    var st = e && e.detail;
    if (st && (st.state === 'active' || st.state === 'calling')) _releaseChatCamera();
    if (st && st.state === 'ringing') { _notifyIncoming(st); _checkCallAction(); }
    else _clearCallNotif(); // contestada, colgada, perdida…: fuera el aviso que suena
    // Ronda 2765: acabó la llamada: si la app se abrió encima de la pantalla de bloqueo por ella, vuelve detrás
    if (!st || st.state === 'ended') _lockScreenDone();
    _render(st);
  });
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
