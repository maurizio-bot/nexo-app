/**
 * call_bar.js (3155, dueño 16-11: «cuando salgo de la llamada para ver los chats, una barrita arriba como la de WhatsApp»). La llamada
 * MINIMIZADA dentro de la app: la pantalla de la llamada se oculta (sin cortar nada: la imagen sigue llegando) y arriba queda una barra
 * con con quién y cuánto lleva, Silenciar y Colgar; tocarla vuelve a la pantalla de la llamada. Se minimiza con el gesto «atrás» o la
 * flecha de arriba a la izquierda de la pantalla (1-a-1 de voz o de vídeo y la de grupo; con dos llamadas a la vez, no). En la
 * miniatura del sistema (PiP) la llamada vuelve a verse entera (la ventanita enseña la imagen, no la app).
 * Cada pantalla se registra con registerCallBar(tipo, { el, can, info, mute, hangup }).
 */
import { t } from './i18n.js';

var _prov = {}, _kind = '', _timer = null;
var IC_MIC = '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>';
var IC_MICOFF = '<path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3"/><path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.6 6M12 18v3M3 3l18 18"/>';
var IC_PHONE = '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>';
function _svg(p) { return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }
function _fmt(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

function _css() {
  if (document.getElementById('nexo-callbar-style')) return;
  var s = document.createElement('style');
  s.id = 'nexo-callbar-style';
  s.textContent = [
    '#nexo-call-screen.nc-minimized,#nexo-gcall-screen.nc-minimized{display:none !important}',
    '#nexo-call-bar{position:fixed;top:0;left:0;right:0;z-index:2147483644;display:flex;align-items:center;gap:10px;box-sizing:border-box;padding:calc(6px + env(safe-area-inset-top,0px)) 10px 6px 14px;min-height:52px;background:var(--nx-grad,linear-gradient(135deg,#00c8ff,#a855f7));color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.35);cursor:pointer;-webkit-tap-highlight-color:transparent;font-family:inherit}',
    '#nexo-call-bar .ncb-dot{width:9px;height:9px;border-radius:50%;background:#fff;flex:none;animation:ncbPulse 1.6s ease-in-out infinite}',
    '@keyframes ncbPulse{0%,100%{opacity:1}50%{opacity:.35}}',
    '#nexo-call-bar .ncb-txt{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.2}',
    '#nexo-call-bar .ncb-name{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}',
    '#nexo-call-bar .ncb-sub{font-size:12px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#nexo-call-bar button{flex:none;width:40px;height:40px;border-radius:50%;border:none;display:flex;align-items:center;justify-content:center;color:#fff;background:rgba(0,0,0,.22);cursor:pointer;padding:0}',
    '#nexo-call-bar button.ncb-on{background:#fff;color:#14152a}',
    '#nexo-call-bar button.ncb-hang{background:#ef4444}#nexo-call-bar button.ncb-hang svg{transform:rotate(135deg)}',
    // la app baja lo que mide la barra (no queda nada tapado)
    'html.nx-callbar #app{padding-top:var(--nx-cb-h,52px);box-sizing:border-box}',
    'html.nx-pip #nexo-call-bar{display:none}'
  ].join('\n');
  document.head.appendChild(s);
}

export function registerCallBar(kind, prov) { _prov[kind] = prov; }

function _screenOf(kind) { var p = _prov[kind]; return p && p.el ? p.el() : null; }
// La pantalla de llamada que se ve ahora y se puede minimizar (con dos llamadas a la vez, ninguna)
function _visibleKind() {
  if (document.documentElement.classList.contains('nc-split')) return '';
  var ks = Object.keys(_prov);
  for (var i = 0; i < ks.length; i++) {
    var el = _screenOf(ks[i]), p = _prov[ks[i]];
    if (el && el.isConnected && !el.classList.contains('nc-minimized') && !el.classList.contains('nc-gone') && !el.classList.contains('nc-appmini') && p.can && p.can()) return ks[i];
  }
  return '';
}
export function canMinimize(kind) { var p = _prov[kind]; return !!(p && p.can && p.can()) && !document.documentElement.classList.contains('nc-split'); }

export function minimizeCall(kind) {
  kind = kind || _visibleKind();
  var el = _screenOf(kind);
  if (!kind || !el || !canMinimize(kind)) return false;
  _css();
  if (_kind && _kind !== kind) restoreCall();
  _kind = kind;
  el.classList.add('nc-minimized');
  _bar();
  console.log('[CALL] Llamada minimizada: barra arriba');
  return true;
}

export function restoreCall() {
  var el = _kind ? _screenOf(_kind) : null;
  if (el) el.classList.remove('nc-minimized');
  _kind = '';
  clearInterval(_timer); _timer = null;
  var b = document.getElementById('nexo-call-bar'); if (b) b.remove();
  document.documentElement.classList.remove('nx-callbar');
}

function _bar() {
  var b = document.getElementById('nexo-call-bar');
  if (!b) {
    b = document.createElement('div');
    b.id = 'nexo-call-bar'; b.setAttribute('role', 'button');
    b.innerHTML = '<span class="ncb-dot"></span><div class="ncb-txt"><div class="ncb-name"></div><div class="ncb-sub"></div></div><button class="ncb-mute"></button><button class="ncb-hang"></button>';
    b.addEventListener('click', function(e) { if (e.target && e.target.closest && e.target.closest('button')) return; restoreCall(); });
    b.querySelector('.ncb-mute').addEventListener('click', function(e) { e.stopPropagation(); var p = _prov[_kind], i = p && p.info && p.info(); if (p && p.mute && i) p.mute(!i.muted); setTimeout(_paint, 0); });
    b.querySelector('.ncb-hang').addEventListener('click', function(e) { e.stopPropagation(); var p = _prov[_kind]; if (p && p.hangup) p.hangup(); });
    document.body.appendChild(b);
    clearInterval(_timer); _timer = setInterval(_paint, 1000);
  }
  _paint();
  document.documentElement.classList.add('nx-callbar');
  document.documentElement.style.setProperty('--nx-cb-h', b.offsetHeight + 'px');
}

function _paint() {
  var b = document.getElementById('nexo-call-bar'), p = _prov[_kind], i = p && p.info ? p.info() : null;
  if (!b) return;
  if (!i || !p.can()) { restoreCall(); return; } // la llamada terminó
  var dur = i.live && i.since ? _fmt(Math.max(0, Math.round((Date.now() - i.since) / 1000))) : t('call_calling', 'Llamando…');
  b.querySelector('.ncb-name').textContent = (i.name || '') + ' · ' + dur;
  b.querySelector('.ncb-sub').textContent = t('call_bar_back', 'Toca para volver');
  var m = b.querySelector('.ncb-mute'), ic = i.muted ? 'off' : 'on';
  // 3181: el icono solo se rehace si cambia (rehacerlo cada segundo borraba la onda del dedo a mitad del toque)
  if (m.getAttribute('data-ic') !== ic) { m.innerHTML = _svg(i.muted ? IC_MICOFF : IC_MIC); m.setAttribute('data-ic', ic); }
  m.classList.toggle('ncb-on', !!i.muted);
  m.setAttribute('aria-label', i.muted ? t('call_muted', 'Silenciado') : t('call_mute', 'Silenciar'));
  var h = b.querySelector('.ncb-hang'); if (!h.firstChild) h.innerHTML = _svg(IC_PHONE); h.setAttribute('aria-label', t('call_hangup', 'Colgar'));
}

if (typeof window !== 'undefined') {
  // El gesto «atrás» (chat_nav.js lo pregunta primero): con la pantalla de una llamada a la vista, la minimiza
  window.__nexoCallBack = function() {
    try {
      var ask = document.getElementById('nexo-scr-ask') || document.getElementById('nexo-gscr-ask');
      if (ask) { ask.remove(); return true; }
      if (document.getElementById('nexo-contact-picker') || document.getElementById('nexo-call-reply')) return false; // se cierran primero (chat_nav)
      return minimizeCall('');
    } catch (e) { return false; }
  };
  var _upd = function() { if (_kind) setTimeout(_paint, 0); };
  window.addEventListener('nexo:call', _upd);
  window.addEventListener('nexo:gcall', _upd);
}
