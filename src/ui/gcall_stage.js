/**
 * gcall_stage.js (#224, dueño 16-11: «cuando hago una videollamada con otro contacto y luego agrego un contacto a la videollamada, no
 * debería quitarse toda la parte de video»). La videollamada de GRUPO de 2 o 3 personas se ve como la 1-a-1:
 *  - con uno: su imagen a toda la pantalla y la mía pequeña flotando (arriba a la derecha);
 *  - con dos: la pantalla partida en dos mitades (arriba el que ya estaba —el de la 1-a-1—, abajo el otro) y la mía pequeña;
 *  - el que todavía suena: en su mitad, su círculo, su nombre, «Llamando…» y «Cancelar» (deja de sonarle; la llamada sigue);
 *  - dos toques (≤ 300 ms, en la misma persona): esa persona a toda la pantalla y la otra pequeña flotando; dos toques otra vez,
 *    mitades. Un toque solo muestra / oculta los botones (se espera a ver si hay un segundo toque: nunca hace las dos cosas).
 * Las imágenes son los MISMOS elementos de la llamada (no se recrean: sin parpadeo ni corte); groupcall_ui.js pone los botones.
 */
import { t } from './i18n.js';
import { personAvatar } from './person_avatar.js';
import { callButton, mirrorPeerPref } from './calls_ui.js';

var DBL_MS = 300;
var _st = { gid: '', focus: '', tap: null, single: null };

function _norm(x) { return String(x || '').toLowerCase().trim(); }
function _fmt(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

// Los demás (sin mí), el de la 1-a-1 primero
function _others(st, me) {
  var list = (st.members || []).map(_norm).filter(function(nx) { return nx && nx !== me; });
  var a = _norm(st.adopt);
  if (a && list.indexOf(a) > 0) { list.splice(list.indexOf(a), 1); list.unshift(a); }
  return list;
}

// ¿Esta llamada de grupo se ve así? Videollamada en curso (o recién heredada de la 1-a-1) con 1 o 2 personas más
export function stageWanted(st, me) {
  if (!st || !st.video) return false;
  if (!(st.state === 'active' || (st.state === 'calling' && st.adopt))) return false;
  var n = _others(st, _norm(me)).length;
  return n >= 1 && n <= 2;
}

function _css() {
  if (document.getElementById('nexo-gcs-style')) return;
  var s = document.createElement('style');
  s.id = 'nexo-gcs-style';
  s.textContent = [
    '#nexo-gcall-screen.gc-stagemode>.gc-pill,#nexo-gcall-screen.gc-stagemode>.gc-title,#nexo-gcall-screen.gc-stagemode>.gc-status,#nexo-gcall-screen.gc-stagemode>.gc-video,#nexo-gcall-screen.gc-stagemode>.gc-members{display:none !important}',
    '#nexo-gcall-screen.gc-stagemode>.gc-buttons.nc-row{position:absolute;left:8px;right:8px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:7;width:auto !important;margin:0 auto !important;transition:opacity .3s,transform .3s}',
    '#nexo-gcall-screen.gc-stagemode .gc-scrbar{z-index:9 !important}#nexo-gcall-screen.gc-stagemode #nexo-gscr-ask{z-index:10 !important}',
    '#nexo-gcall-screen.gcs-hide>.gc-buttons.nc-row,#nexo-gcall-screen.gcs-hide .gcs-top{opacity:0;pointer-events:none}',
    '#nexo-gcall-screen.gcs-hide>.gc-buttons.nc-row{transform:translateY(40%)}',
    '.gcs-stage{position:absolute;inset:0;z-index:1;background:#000;overflow:hidden;user-select:none;-webkit-user-select:none}',
    '.gcs-top{position:absolute;top:0;left:0;right:0;z-index:6;padding:calc(12px + env(safe-area-inset-top,0px)) 16px 30px;display:flex;flex-direction:column;align-items:center;gap:5px;background:linear-gradient(rgba(0,0,0,.6),transparent);pointer-events:none;transition:opacity .3s}',
    '.gcs-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);font-size:11.5px;opacity:.85}',
    '.gcs-names{font-size:16px;font-weight:700;text-align:center;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 8px rgba(0,0,0,.6)}',
    '.gcs-time{font-size:13px;opacity:.85;font-variant-numeric:tabular-nums;text-shadow:0 1px 8px rgba(0,0,0,.6)}',
    '.gcs-tile{position:absolute;overflow:hidden;background:#0b0c18;transition:top .22s,left .22s,width .22s,height .22s,border-radius .22s}',
    '.gcs-tile.gcs-full{top:0;left:0;width:100%;height:100%;z-index:1}',
    '.gcs-tile.gcs-up{top:0;left:0;width:100%;height:50%;z-index:1}',
    '.gcs-tile.gcs-down{top:50%;left:0;width:100%;height:50%;z-index:1;box-shadow:0 -1px 0 2px rgba(255,255,255,.16)}',
    '.gcs-tile.gcs-mini{top:84px;left:14px;width:104px;height:148px;z-index:4;border-radius:16px;border:2px solid rgba(255,255,255,.75);box-shadow:0 8px 26px rgba(0,0,0,.5)}',
    '.gcs-tile>.gcs-v{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;background:#000}',
    '.gcs-tile.gcs-screen>.gcs-v{object-fit:contain}',
    '.gcs-ph{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:var(--nx-bg);text-align:center;padding:0 12px}',
    '.gcs-tile.gcs-novideo>.gcs-ph,.gcs-tile.gcs-wait>.gcs-ph{display:flex}',
    '.gcs-avw{position:relative;width:88px;height:88px}',
    '.gcs-avw .nx-person-av{position:relative;z-index:1;width:88px !important;height:88px !important;min-width:88px !important;font-size:32px !important;border-radius:50%}',
    '.gcs-ring{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(0,200,255,.6);opacity:0}',
    '.gcs-wait .gcs-ring{animation:gcsPulse 2.4s ease-out infinite}.gcs-wait .gcs-ring.r2{animation-delay:1.2s;border-color:rgba(168,85,247,.6)}',
    '@keyframes gcsPulse{0%{transform:scale(1);opacity:.9}100%{transform:scale(1.7);opacity:0}}',
    '.gcs-pname{font-size:18px;font-weight:700;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.gcs-pst{font-size:13px;opacity:.8}',
    '#nexo-gcall-screen .gcs-ph .nc-btn.gcs-cancel{flex:none;width:76px;margin-top:6px}',
    '#nexo-gcall-screen .nc-btn.gcs-cancel .nc-ic svg{transform:rotate(135deg)}',
    '.gcs-lab{position:absolute;left:10px;bottom:8px;z-index:2;font-size:12px;background:rgba(0,0,0,.55);padding:2px 8px;border-radius:8px;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.gcs-n1 .gcs-lab,.gcs-tile.gcs-wait .gcs-lab,.gcs-tile.gcs-novideo .gcs-lab{display:none}',
    '.gcs-tile.gcs-mini .gcs-avw,.gcs-tile.gcs-mini .gcs-avw .nx-person-av{width:48px !important;height:48px !important;min-width:48px !important;font-size:18px !important}',
    '.gcs-tile.gcs-mini .gcs-pname{font-size:12px}.gcs-tile.gcs-mini .gcs-pst,.gcs-tile.gcs-mini .gcs-cancel,.gcs-tile.gcs-mini .gcs-lab{display:none !important}',
    '.gcs-self{position:absolute;z-index:5;top:84px;right:14px;width:104px;height:148px;border-radius:16px;overflow:hidden;border:2px solid rgba(255,255,255,.75);box-shadow:0 8px 26px rgba(0,0,0,.5);background:#1a1b2e}',
    '.gcs-n2:not(.gcs-focus) .gcs-self{width:92px;height:130px}',
    '.gcs-self.gcs-off{display:none}',
    '.gcs-self>video{width:100%;height:100%;object-fit:cover;display:block}'
  ].join('\n');
  document.head.appendChild(s);
}

function _tileOf(stage, nx) { return stage.querySelector('.gcs-tile[data-nx="' + nx + '"]'); }

function _makeTile(stage, nx, name) {
  var tl = document.createElement('div');
  tl.className = 'gcs-tile'; tl.setAttribute('data-nx', nx);
  var ph = document.createElement('div'); ph.className = 'gcs-ph';
  var avw = document.createElement('div'); avw.className = 'gcs-avw';
  avw.innerHTML = '<div class="gcs-ring"></div><div class="gcs-ring r2"></div>';
  avw.appendChild(personAvatar(nx, name));
  var pn = document.createElement('div'); pn.className = 'gcs-pname'; pn.textContent = name;
  var ps = document.createElement('div'); ps.className = 'gcs-pst';
  ph.appendChild(avw); ph.appendChild(pn); ph.appendChild(ps);
  var lab = document.createElement('span'); lab.className = 'gcs-lab'; lab.textContent = name;
  tl.appendChild(ph); tl.appendChild(lab);
  stage.insertBefore(tl, stage.querySelector('.gcs-self'));
  return tl;
}

// Un toque: botones sí / no; dos toques en la misma persona: a toda la pantalla ↔ mitades (solo con dos personas)
function _onTap(el, stage, e) {
  if (e.target && e.target.closest && e.target.closest('.nc-btn, .gcs-self')) return;
  var tile = e.target && e.target.closest ? e.target.closest('.gcs-tile') : null;
  var nx = tile ? tile.getAttribute('data-nx') : '', now = Date.now(), last = _st.tap;
  clearTimeout(_st.single); _st.single = null;
  if (tile && last && last.nx === nx && now - last.at <= DBL_MS) {
    _st.tap = null;
    if (!stage.classList.contains('gcs-n2')) return;
    _st.focus = _st.focus === nx ? '' : nx;
    _layout(stage);
    return;
  }
  _st.tap = { nx: nx, at: now };
  _st.single = setTimeout(function() { _st.single = null; _st.tap = null; el.classList.toggle('gcs-hide'); }, DBL_MS);
}

function _layout(stage) {
  var tiles = Array.prototype.slice.call(stage.querySelectorAll('.gcs-tile'));
  var two = tiles.length === 2;
  if (!two || !_tileOf(stage, _st.focus)) _st.focus = '';
  stage.classList.toggle('gcs-n1', tiles.length === 1); stage.classList.toggle('gcs-n2', two);
  stage.classList.toggle('gcs-focus', !!_st.focus);
  stage.setAttribute('data-focus', _st.focus);
  tiles.forEach(function(tl, i) {
    var nx = tl.getAttribute('data-nx');
    var pos = !two ? 'gcs-full' : _st.focus ? (nx === _st.focus ? 'gcs-full' : 'gcs-mini') : (i === 0 ? 'gcs-up' : 'gcs-down');
    ['gcs-full', 'gcs-up', 'gcs-down', 'gcs-mini'].forEach(function(c) { tl.classList.toggle(c, c === pos); });
  });
}

// opts: { me, name(nx) }
export function renderStage(el, st, gcall, opts) {
  _css();
  var me = _norm(opts && opts.me), nameOf = (opts && opts.name) || function(nx) { return String(nx || '').toUpperCase(); };
  if (_st.gid !== st.gid) { _st = { gid: st.gid, focus: '', tap: null, single: null }; el.classList.remove('gcs-hide'); }
  var stage = el.querySelector('.gcs-stage');
  if (!stage) {
    stage = document.createElement('div'); stage.className = 'gcs-stage';
    stage.innerHTML = '<div class="gcs-top"><div class="gcs-pill"><span>🔒</span><span class="gcs-e2e"></span></div><div class="gcs-names"></div><div class="gcs-time"></div></div><div class="gcs-self"></div>';
    stage.addEventListener('click', function(e) { _onTap(el, stage, e); });
    el.insertBefore(stage, el.firstChild);
  }
  var others = _others(st, me), legBy = {};
  (st.legs || []).forEach(function(l) { legBy[_norm(l.nx)] = l; });
  // Arriba: cifrada, con quién y cuánto lleva (desde que empezó la 1-a-1)
  stage.querySelector('.gcs-e2e').textContent = t('call_e2e', 'Cifrada de extremo a extremo');
  stage.querySelector('.gcs-names').textContent = others.map(nameOf).join(' · ');
  var since = st.since || 0;
  stage.querySelector('.gcs-time').textContent = st.held ? t('call_on_hold', 'En espera') : since ? _fmt(Math.max(0, Math.round((Date.now() - since) / 1000))) : '';
  // Una baldosa por persona (las mismas siempre: la imagen no se recrea)
  var keep = {};
  others.forEach(function(nx) {
    keep[nx] = 1;
    var l = legBy[nx] || {}, name = nameOf(nx);
    var tl = _tileOf(stage, nx) || _makeTile(stage, nx, name);
    stage.insertBefore(tl, stage.querySelector('.gcs-self')); // en el orden de la lista (arriba el de la 1-a-1)
    var inCall = l.state === 'active' || nx === _norm(st.adopt);
    var ce = inCall && gcall && gcall.remoteVideoEl ? gcall.remoteVideoEl(nx) : null;
    if (ce && ce.parentNode !== tl) { ce.classList.add('gcs-v'); tl.insertBefore(ce, tl.firstChild); }
    if (ce) {
      ce.style.cssText = '';
      ce.style.transform = !l.peerScreen && l.peerFront !== false && mirrorPeerPref() ? 'scaleX(-1)' : 'none';
    }
    var live = !!ce && !!(gcall && gcall.remoteLive && gcall.remoteLive(nx));
    tl.classList.toggle('gcs-wait', !inCall);
    tl.classList.toggle('gcs-novideo', inCall && !live);
    tl.classList.toggle('gcs-screen', !!l.peerScreen);
    var ps = tl.querySelector('.gcs-pst');
    ps.textContent = !inCall ? t('call_calling', 'Llamando…') : l.peerCam === false ? t('call_peer_cam_off', 'Cámara apagada') : l.reconnecting ? t('call_reconnecting', 'Reconectando…') : t('call_waiting_image', 'Esperando imagen…');
    // «Cancelar»: solo quien invitó, mientras le suena
    var cb = tl.querySelector('.gcs-cancel');
    if (!inCall && l.state === 'inviting') {
      if (!cb) {
        cb = callButton('phone', t('cancel', 'Cancelar'), 'gcs-cancel', function() { var g = gcall; if (g && g.cancelInvite) g.cancelInvite(nx); }, 'nc-red');
        tl.querySelector('.gcs-ph').appendChild(cb);
      }
    } else if (cb) cb.remove();
  });
  Array.prototype.slice.call(stage.querySelectorAll('.gcs-tile')).forEach(function(tl) { if (!keep[tl.getAttribute('data-nx')]) tl.remove(); });
  // Mi imagen, pequeña (como en la 1-a-1); oculta con la cámara apagada o compartiendo la pantalla
  var self = stage.querySelector('.gcs-self'), lv = gcall && gcall.localVideoEl ? gcall.localVideoEl() : null;
  if (lv && lv.parentNode !== self) { lv.classList.remove('nc-pip', 'nc-full', 'nc-preview'); lv.style.cssText = ''; self.appendChild(lv); }
  if (lv) lv.style.transform = st.front !== false ? 'scaleX(-1)' : 'none';
  self.classList.toggle('gcs-off', !lv || !st.cameraOn || !!st.screen);
  _layout(stage);
}

export function clearStage(el) {
  var stage = el && el.querySelector('.gcs-stage');
  if (stage) stage.remove();
  if (el) el.classList.remove('gcs-hide');
  clearTimeout(_st.single); _st.single = null; _st.tap = null;
}
