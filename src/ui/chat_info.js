/**
 * chat_info.js (dueño 27-11, «propuesta B» aprobada: «parejo en ambos, pero menos botones mejor») — la cabecera del chat y del grupo:
 *  · Tocar la FOTO = VER la foto en grande (sin foto: el círculo con las iniciales). En un grupo, si puedo cambiarlo, «Cambiar foto»
 *    (el ajuste de avatar_crop) y «Quitar foto». En 1-a-1 la foto del contacto solo se ve (es suya; la mía se cambia en Perfil).
 *    PORQUÉ: es lo que el usuario espera (WhatsApp/Telegram) y no debe hacer otra cosa.
 *  · Tocar el NOMBRE (con un «›» pequeño para que se note) = página «Información» con TODO: en 1-a-1 cambiar el nombre, buscar,
 *    destacados, temporales, silenciar y bloquear; en un grupo, esas opciones del chat + lo que tenía la rueda (nombre, foto, opciones,
 *    miembros, fondo, salir). Se quitó la rueda del grupo: un solo sitio para todo, igual en chats y grupos.
 *  · El nombre de la cabecera ya no se edita al tocarlo (se cambia en «Información»).
 * Las opciones que abren una hoja (silenciar, temporales, bloquear, destacados, buscar) cierran antes la página: las hojas viven
 * debajo de las pantallas a pantalla completa (z 8500) y así se ven sobre el chat, como al tocarlas antes desde el círculo.
 */
import { t } from './i18n.js';
import { _getCurrentContactId, _normId } from './chat_format.js';
import { chatOptionItems } from './chat_menu.js';
import { openGroupSettings } from './group_panel.js';
import { avatarOf, makeAvatar } from './avatar.js';
import { _getGradientForUUID, _getInitials } from './ble_helpers.js';
import { sheetRow } from './chat_sheet.js';
import { _showInfoToast } from './ui_bits.js';

function $(id) { return document.getElementById(id); }
function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _gs() { var b = _bi(); return b && b.groups; }
function _el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function _cid() { return _normId(_getCurrentContactId()); }
function _isGroup(cid) { var gs = _gs(); return !!(gs && cid && gs.isGroup && gs.isGroup(cid)); }
function _name() { var n = $('chat-contact-name'); return (n && n.value) || ''; }
function _toast(s) { try { _showInfoToast(s, 3200); } catch (e) {} }
function _run(p) { return Promise.resolve(p).catch(function(e) { if (e && e.code === 'CANCEL') return; _toast((e && e.message) || String(e)); }); }

// La foto (data URL) del chat: la del contacto o la del grupo; null si no hay
export function chatPhotoOf(cid) {
  if (!cid) return null;
  if (_isGroup(cid)) { var gs = _gs(); return (gs && typeof gs.photoOf === 'function' && gs.photoOf(cid)) || null; }
  return avatarOf(cid) || null;
}

function _panel(id, title) {
  var old = $(id); if (old) old.remove();
  var sh = _el('div', 'nx-panel'); sh.id = id;
  sh.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
  if (title) { var head = _el('div', 'nx-page-head nx-sheet-head'); head.appendChild(_el('div', 'nx-page-title', title)); sh.appendChild(head); }
  var body = _el('div', 'nx-panel-body'); sh.appendChild(body);
  document.body.appendChild(sh);
  return { sheet: sh, body: body };
}

// ===== Visor de la foto =====
export function openPhotoView(cid) {
  cid = _normId(cid || _cid());
  if (!cid) return null;
  var old = $('nexo-photo-view'); if (old) old.remove();
  var box = _el('div', 'nx-panel nx-photo-view'); box.id = 'nexo-photo-view';
  var stage = _el('div', 'nx-photo-stage'); box.appendChild(stage);
  var name = _name();
  var cap = _el('div', 'nx-photo-name', name); box.appendChild(cap);
  var acts = _el('div', 'nx-photo-acts'); box.appendChild(acts);
  function paint() {
    stage.innerHTML = '';
    var img = chatPhotoOf(cid);
    if (img) { var im = _el('img', 'nx-photo-img'); im.alt = name; im.src = img; stage.appendChild(im); }
    else {
      stage.appendChild(_el('div', 'ble-contact-avatar nx-photo-ini ' + _getGradientForUUID(cid), _getInitials(name || cid)));
    }
    acts.innerHTML = '';
    var gs = _gs();
    if (_isGroup(cid) && gs && typeof gs.can === 'function' && gs.can(cid, 'edit')) {
      var fin = _el('input', 'nx-photo-file'); fin.type = 'file'; fin.accept = 'image/*'; fin.style.display = 'none';
      fin.addEventListener('change', function() { var f = fin.files && fin.files[0]; if (f) _run(makeAvatar(f).then(function(u) { return gs.setPhoto(cid, u); }).then(paint)); });
      acts.appendChild(fin);
      var ch = sheetRow(img ? t('photo_change', 'Cambiar foto') : t('grp_photo_set', 'Poner foto del grupo'), 'nx-image', 'nx-photo-change nx-row');
      ch.addEventListener('click', function(e) { e.stopPropagation(); fin.click(); });
      acts.appendChild(ch);
      if (img) {
        var del = sheetRow(t('grp_photo_del', 'Quitar la foto del grupo'), 'nx-trash', 'nx-photo-del nx-row', true);
        del.addEventListener('click', function(e) { e.stopPropagation(); _run(Promise.resolve(gs.setPhoto(cid, '')).then(paint)); });
        acts.appendChild(del);
      }
    }
  }
  paint();
  // Cerrar: atrás (chat_nav cierra la .nx-panel de más arriba), deslizar abajo o tocar fuera de la foto
  var y0 = null;
  box.addEventListener('touchstart', function(e) { y0 = e.touches && e.touches[0] ? e.touches[0].clientY : null; }, { passive: true });
  box.addEventListener('touchend', function(e) { var y = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : null; if (y0 !== null && y !== null && y - y0 > 90) box.remove(); y0 = null; });
  stage.addEventListener('click', function(e) { if (e.target === stage) box.remove(); });
  document.body.appendChild(box);
  return box;
}

// ===== Página «Información» =====
// Las opciones del chat como filas de la página; al tocar una, la página se cierra y se abre la hoja sobre el chat
function _optionRows(host, cid, panel) {
  var sec = _el('div', 'nx-sec-label nx-info-sec', t('chat_opts', 'Opciones del chat'));
  host.appendChild(sec);
  chatOptionItems(cid, _name()).forEach(function(it) {
    var b = sheetRow(it.label, it.icon || it.cls, it.cls + ' nx-row nx-info-opt', it.danger);
    if (it.sub) { var lb = b.querySelector('.nx-sheet-label'); var sb = _el('span', 'nx-sheet-sub', it.sub); if (lb) lb.appendChild(sb); }
    b.addEventListener('click', function(e) { e.stopPropagation(); var p = panel(); if (p) p.remove(); if (typeof it.fn === 'function') it.fn(); });
    host.appendChild(b);
  });
}

export function openChatInfo(cid) {
  cid = _normId(cid || _cid());
  if (!cid) return null;
  if (_isGroup(cid)) {
    var gp = null;
    gp = openGroupSettings(cid, { title: t('chat_info', 'Información'), extra: function(body) { _optionRows(body, cid, function() { return gp; }); } });
    return gp;
  }
  var p = _panel('nexo-chat-info', t('chat_info', 'Información'));
  var b = p.body;
  var top = _el('div', 'nx-info-top');
  var av = _el('div', 'ble-contact-avatar nx-info-photo ' + _getGradientForUUID(cid), _getInitials(_name() || cid));
  var img = chatPhotoOf(cid);
  if (img) { av.style.backgroundImage = 'url("' + img + '")'; av.style.backgroundSize = 'cover'; av.style.backgroundPosition = 'center'; av.textContent = ''; }
  av.setAttribute('role', 'button'); av.setAttribute('aria-label', t('photo_see', 'Ver foto'));
  av.addEventListener('click', function(e) { e.stopPropagation(); openPhotoView(cid); });
  top.appendChild(av);
  var nm = _el('input', 'nx-input nx-info-name'); nm.value = _name(); nm.maxLength = 60;
  nm.setAttribute('aria-label', t('chat_info_name', 'Nombre del contacto'));
  // Cambiar el nombre: lo mismo que hacía la cabecera (app_setup._setupChatHeader guarda al salir del campo)
  nm.addEventListener('change', function() {
    var v = String(nm.value || '').trim(); if (!v) { nm.value = _name(); return; }
    var h = $('chat-contact-name'); if (!h) return;
    h.value = v;
    try { h.dispatchEvent(new Event('blur')); } catch (e) {}
    try { h.dispatchEvent(new Event('input')); } catch (e) {} // el alto y la letra del nombre (main._fitContactName)
    placeChevron();
    var bi = _bi(); if (bi && typeof bi.renderContactsList === 'function') { try { bi.renderContactsList(); } catch (e) {} }
  });
  nm.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); nm.blur(); } });
  top.appendChild(nm);
  b.appendChild(top);
  if (/^nx[0-9a-z]{8}$/.test(cid)) b.appendChild(_el('div', 'nx-note nx-info-id', 'NEXO ID: ' + cid.toUpperCase()));
  _optionRows(b, cid, function() { return p.sheet; });
  return p.sheet;
}

// ===== El «›» junto al nombre: al final de la última línea del nombre =====
var _mir = null;
export function placeChevron() {
  try {
    var info = $('chat-contact-info'), nm = $('chat-contact-name'), ch = $('chat-name-chev');
    if (!info || !nm || !ch) return;
    if (!nm.value || !nm.clientWidth) { ch.style.display = 'none'; return; }
    var cs = getComputedStyle(nm);
    if (!_mir) { _mir = _el('div'); _mir.setAttribute('aria-hidden', 'true'); _mir.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;'; document.body.appendChild(_mir); }
    ['fontSize', 'fontWeight', 'fontFamily', 'letterSpacing', 'lineHeight', 'wordBreak', 'overflowWrap', 'whiteSpace', 'paddingLeft', 'paddingRight', 'boxSizing'].forEach(function(k) { _mir.style[k] = cs[k]; });
    _mir.style.width = nm.clientWidth + 'px';
    _mir.textContent = nm.value;
    var mk = _el('span', '', '​'); _mir.appendChild(mk);
    var lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.15 || 20;
    var maxTop = Math.ceil(nm.clientHeight - lh + 1); // si el nombre pasa de 2 líneas, el «›» va al final de lo que se ve
    var x = mk.offsetLeft, y = Math.min(mk.offsetTop, Math.max(0, maxTop));
    var ir = info.getBoundingClientRect(), nr = nm.getBoundingClientRect();
    ch.style.display = '';
    ch.style.left = Math.round(nr.left - ir.left + x + 2) + 'px';
    ch.style.top = Math.round(nr.top - ir.top + y + (lh - ch.offsetHeight) / 2) + 'px';
  } catch (e) {}
}
function _soonChev() { setTimeout(placeChevron, 0); setTimeout(placeChevron, 120); setTimeout(placeChevron, 450); }

export function installChatInfo() {
  var av = $('chat-contact-avatar');
  if (av && !av._nxInfo) {
    av._nxInfo = true;
    av.setAttribute('role', 'button');
    av.setAttribute('aria-label', t('photo_see', 'Ver foto'));
    av.removeAttribute('aria-hidden');
    av.addEventListener('click', function(e) { e.stopPropagation(); openPhotoView(); });
  }
  var nm = $('chat-contact-name'), info = $('chat-contact-info');
  if (nm && info && !nm._nxInfo) {
    nm._nxInfo = true;
    nm.readOnly = true; // dueño 27-11: el nombre se cambia en «Información», no al tocarlo
    nm.setAttribute('role', 'button');
    nm.setAttribute('aria-label', t('chat_info', 'Información'));
    nm.style.cursor = 'pointer';
    nm.addEventListener('click', function(e) { e.stopPropagation(); e.preventDefault(); try { nm.blur(); } catch (x) {} openChatInfo(); });
    var ch = _el('span', '', '›'); ch.id = 'chat-name-chev'; ch.setAttribute('aria-hidden', 'true');
    ch.addEventListener('click', function(e) { e.stopPropagation(); openChatInfo(); });
    info.appendChild(ch);
    nm.addEventListener('input', _soonChev);
  }
  window.addEventListener('nexo:ble:openChat', _soonChev);
  window.addEventListener('nexo:groups', _soonChev);
  window.addEventListener('resize', _soonChev);
  // Si la foto cambia con el visor abierto (llega la del contacto o la del grupo), se repinta al reabrir; la cabecera ya la repinta main.js
}
