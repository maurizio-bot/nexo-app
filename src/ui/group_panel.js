/**
 * group_panel.js (22-11, COLA 4b «Grupos: administración», G1/G3/G4/G5/G6/G7/G9) — Pantalla «Ajustes del grupo» (desde los ⋮ del
 * grupo): nombre y foto, modo (Control / Colegas) e interruptores, «Designar administradores» (con buscador), agregar personas,
 * expulsar («Solo expulsar» / «Expulsar y bloquear»), «Personas bloqueadas» (solo si hay) con «Desbloquear», fondo del grupo y
 * salir. Cada botón aparece solo si quien mira tiene permiso (group_state.gsCan); aun así, el que recibe vuelve a comprobarlo.
 * También bloquea la barra de escribir con el motivo cuando no se puede escribir en el grupo abierto (G5).
 */
import { _contactsStyles, _pickAvatar, SHEET_CLOSE_SVG } from './share_contacts.js';
import { _normId } from './chat_format.js';
import { vaultLoadContacts } from '../vault/vault_manager.js';
import { makeAvatar } from './avatar.js';
import { makeWallpaper, setChatWallpaperFor, chatWallpaperFor, clearChatWallpaperFor, wpShareLimits } from './wallpaper.js';
import { _showInfoToast } from './ui_bits.js';
import { GS_MAX_MEMBERS } from './group_state.js';
import { t } from './i18n.js';

function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _gs() { var b = _bi(); return b && b.groups; }
function _me() { return _normId(_bi() && _bi().localNexoId); }
function _toast(s) { try { _showInfoToast(s, 3200); } catch (e) {} }
function _el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
var BTN = 'display:block;width:100%;text-align:left;padding:13px 4px;background:none;border:none;border-bottom:1px solid rgba(255,255,255,0.08);font-size:16px;color:#fff;';
function _btn(cls, label, fn, danger) {
  var b = _el('button', cls, label); b.type = 'button';
  b.style.cssText = BTN + (danger ? 'color:#ff6b6b;' : '');
  b.addEventListener('click', function(e) { e.stopPropagation(); fn(); });
  return b;
}
function _sheet(id, title) {
  var old = document.getElementById(id); if (old) old.remove();
  _contactsStyles();
  var sh = _el('div'); sh.id = id;
  sh.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:var(--nx-bg,#0b0c1a);color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;';
  var head = _el('div', 'nx-page-head nx-sheet-head');
  head.appendChild(_el('div', 'nx-page-title', title));
  var x = _el('button', 'nx-round-btn gset-close'); x.type = 'button'; x.innerHTML = SHEET_CLOSE_SVG; x.setAttribute('aria-label', t('cancel'));
  x.addEventListener('click', function() { sh.remove(); });
  head.appendChild(x); sh.appendChild(head);
  var body = _el('div', 'gset-body'); body.style.cssText = 'flex:1;overflow-y:auto;';
  sh.appendChild(body);
  document.body.appendChild(sh);
  return { sheet: sh, body: body };
}
function _fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
// Lista con buscador por nombre y casillas: items [{ nx, name, on, locked }] → onSave(lista de NEXO ID marcados)
function _pickList(id, title, items, saveLabel, onSave, max) {
  var p = _sheet(id, title);
  var q = _el('input', 'gset-q'); q.placeholder = t('grp_search', 'Buscar por nombre');
  q.style.cssText = 'background:rgba(255,255,255,0.08);border:none;border-radius:10px;padding:12px;color:#fff;font-size:16px;margin-bottom:8px;width:100%;box-sizing:border-box;';
  p.body.appendChild(q);
  var list = _el('div'); p.body.appendChild(list);
  var on = {};
  items.forEach(function(it) {
    if (it.on) on[it.nx] = true;
    var row = _el('label', 'nexo-pick-row gset-pick'); row.dataset.nx = it.nx; row.dataset.q = _fold(it.name);
    var cb = _el('input'); cb.type = 'checkbox'; cb.checked = !!it.on; cb.disabled = !!it.locked;
    cb.addEventListener('change', function() {
      if (cb.checked && max && Object.keys(on).length >= max) { cb.checked = false; _toast(t('grp_max_a', 'Máximo ') + GS_MAX_MEMBERS + t('grp_max_people', ' personas')); return; }
      if (cb.checked) on[it.nx] = true; else delete on[it.nx];
    });
    row.appendChild(cb); row.appendChild(_pickAvatar(it.nx, it.name)); row.appendChild(_el('div', 'nx-pick-name', it.name + (it.tag ? ' · ' + it.tag : '')));
    list.appendChild(row);
  });
  if (!items.length) list.appendChild(_el('div', 'gset-empty', t('grp_nobody', 'No hay nadie para elegir')));
  q.addEventListener('input', function() { var f = _fold(q.value); Array.prototype.forEach.call(list.children, function(r) { if (r.dataset) r.style.display = !f || (r.dataset.q || '').indexOf(f) >= 0 ? '' : 'none'; }); });
  var save = _btn(id + '-save gset-save', saveLabel, function() { p.sheet.remove(); onSave(Object.keys(on)); });
  save.style.cssText = 'background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:600;margin-top:8px;';
  p.sheet.appendChild(save);
  return p;
}
function _run(promise) { return Promise.resolve(promise).catch(function(e) { _toast((e && e.message) || String(e)); }); }

// Elegir el modo (al crear el grupo y en Ajustes): Control (el creador y los admins mandan) / Colegas (todos hacen todo)
export function groupModePicker(host, initial, onPick) {
  var val = initial === 'c' ? 'c' : 'o';
  if (!host) return { value: function() { return val; } };
  host.innerHTML = '';
  host.style.cssText = 'display:flex;gap:8px;margin:4px 0 8px;';
  var mk = function(md, label, sub) {
    var b = _el('button', 'gset-mode gset-mode-' + md); b.type = 'button';
    b.style.cssText = 'flex:1;text-align:left;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,0.18);background:none;color:#fff;font-size:15px;';
    b.appendChild(_el('div', '', label)); var s = _el('div', '', sub); s.style.cssText = 'font-size:12px;opacity:0.7;margin-top:2px;'; b.appendChild(s);
    b.addEventListener('click', function(e) { e.preventDefault(); val = md; paint(); if (onPick) onPick(md); });
    host.appendChild(b); return b;
  };
  var bc = mk('c', t('grp_mode_c', 'Control'), t('grp_mode_c_sub', 'Solo los administradores escriben, agregan y cambian el grupo'));
  var bo = mk('o', t('grp_mode_o', 'Colegas'), t('grp_mode_o_sub', 'Todos escriben, agregan y cambian el grupo; expulsar, solo el creador'));
  function paint() { [[bc, 'c'], [bo, 'o']].forEach(function(x) { x[0].style.borderColor = val === x[1] ? '#00c8ff' : 'rgba(255,255,255,0.18)'; x[0].setAttribute('aria-pressed', val === x[1] ? 'true' : 'false'); }); }
  paint();
  return { value: function() { return val; } };
}

function _roleTag(s, nx) {
  if (s.cr === nx) return t('grp_role_creator', 'Creador');
  if (s.ad.indexOf(nx) >= 0) return t('grp_role_admin', 'Admin');
  return '';
}

// ===== Ajustes del grupo =====
export function openGroupSettings(gid) {
  var gs = _gs(), g = gs && gs.get(gid);
  if (!g || typeof gs.state !== 'function') return;
  var p = _sheet('nexo-gset', t('grp_settings', 'Ajustes del grupo'));
  var me = _me();
  function paint() {
    g = gs.get(gid);
    if (!g || g.kicked || g.left) { p.sheet.remove(); return; }
    var s = gs.state(gid), b = p.body, can = function(w, x) { return gs.can(gid, w, x); };
    b.innerHTML = '';
    // Foto y nombre
    var top = _el('div'); top.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:10px;';
    var av = _el('div', 'ble-contact-avatar gset-photo'); av.style.cssText = 'width:64px;height:64px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:26px;background:#2a2c48;';
    var img = gs.photoOf(gid);
    if (img) { av.style.backgroundImage = 'url("' + img + '")'; av.style.backgroundSize = 'cover'; } else av.textContent = '👥';
    top.appendChild(av);
    var nm = _el('input', 'gset-name'); nm.value = s.n; nm.maxLength = 60; nm.disabled = !can('edit');
    nm.style.cssText = 'flex:1;background:rgba(255,255,255,0.08);border:none;border-radius:10px;padding:12px;color:#fff;font-size:16px;';
    top.appendChild(nm); b.appendChild(top);
    if (can('edit')) {
      nm.addEventListener('change', function() { _run(gs.renameSigned(gid, nm.value)); });
      var fin = _el('input', 'gset-photo-file'); fin.type = 'file'; fin.accept = 'image/*'; fin.style.display = 'none';
      fin.addEventListener('change', function() { var f = fin.files && fin.files[0]; if (f) _run(makeAvatar(f).then(function(u) { return gs.setPhoto(gid, u); })); });
      b.appendChild(fin);
      av.style.cursor = 'pointer';
      av.addEventListener('click', function() { fin.click(); });
      b.appendChild(_btn('gset-photo-btn', '🖼️  ' + (img ? t('grp_photo_change', 'Cambiar la foto del grupo') : t('grp_photo_set', 'Poner foto del grupo')), function() { fin.click(); }));
      if (img) b.appendChild(_btn('gset-photo-del', '🗑️  ' + t('grp_photo_del', 'Quitar la foto del grupo'), function() { _run(gs.setPhoto(gid, '')); }));
    }
    // Modo e interruptores (solo quien hace de creador los cambia; los demás los ven)
    var boss = can('settings');
    var mh = _el('div', 'gset-sec', t('grp_mode', 'Modo del grupo')); mh.style.cssText = 'font-size:13px;opacity:0.7;margin:12px 2px 2px;'; b.appendChild(mh);
    if (boss) {
      var mp = _el('div'); b.appendChild(mp);
      groupModePicker(mp, s.md, function(md) { if (md !== s.md) _run(gs.setSettings(gid, { md: md, ow: md === 'c' ? 1 : 0 })); });
      var sw = function(cls, key, label) {
        var row = _el('label', 'nexo-pick-row ' + cls); var cb = _el('input'); cb.type = 'checkbox'; cb.checked = !!s[key];
        cb.addEventListener('change', function() { var o = {}; o[key] = cb.checked ? 1 : 0; _run(gs.setSettings(gid, o)); });
        row.appendChild(cb); row.appendChild(_el('div', 'nx-pick-name', label)); b.appendChild(row);
      };
      sw('gset-ow', 'ow', t('grp_n_ow1', 'Solo los administradores escriben'));
      if (s.md === 'o') sw('gset-oa', 'oa', t('grp_n_oa1', 'Solo los administradores agregan'));
    } else {
      var info = _el('div', 'gset-mode-info', (s.md === 'c' ? t('grp_mode_c', 'Control') : t('grp_mode_o', 'Colegas')) + (s.ow ? ' · ' + t('grp_n_ow1', 'Solo los administradores escriben') : '') + (s.oa && s.md === 'o' ? ' · ' + t('grp_n_oa1', 'Solo los administradores agregan') : ''));
      info.style.cssText = 'padding:8px 2px;font-size:15px;'; b.appendChild(info);
    }
    // Designar administradores
    if (can('promote')) b.appendChild(_btn('gset-admins', '⭐  ' + t('grp_admins', 'Designar administradores'), function() {
      var items = s.m.map(function(nx) { return { nx: nx, name: nx === me ? t('prof_group_you', 'tú') : gs.memberName(nx), on: s.ad.indexOf(nx) >= 0, locked: nx === s.cr || (s.ad.indexOf(nx) >= 0 && !can('demote') && nx !== me) }; });
      _pickList('nexo-gset-admins', t('grp_admins', 'Designar administradores'), items, t('grp_save', 'Guardar'), function(list) { _run(gs.setAdmins(gid, list)); });
    }));
    // Agregar personas (G3): contactos que no están ni bloqueados aquí; el nuevo no ve lo anterior
    if (can('add') && s.m.length < GS_MAX_MEMBERS) b.appendChild(_btn('gset-add', '➕  ' + t('grp_add', 'Agregar personas'), function() {
      var all = (vaultLoadContacts() || []).map(function(c) { return { nx: _normId(c.nexoId || c.deviceUUID), name: c.name || '' }; })
        .filter(function(c) { return /^nx[0-9a-z]{8}$/.test(c.nx) && s.m.indexOf(c.nx) < 0 && s.bl.indexOf(c.nx) < 0; })
        .map(function(c) { return { nx: c.nx, name: c.name || c.nx.toUpperCase() }; });
      var pk = _pickList('nexo-gset-addl', t('grp_add', 'Agregar personas'), all, t('grp_add_go', 'Agregar'), function(list) {
        if (!list.length) return;
        var cards = typeof window.NEXO_groupCards === 'function' ? window.NEXO_groupCards({ members: s.m.concat(list) }) : null;
        _run(gs.addMembers(gid, list, cards));
      }, GS_MAX_MEMBERS - s.m.length);
      var note = _el('div', 'gset-note', t('grp_add_note', 'Quien entra no ve los mensajes de antes.')); note.style.cssText = 'font-size:13px;opacity:0.7;margin:6px 2px;'; pk.sheet.insertBefore(note, pk.sheet.lastChild);
    }));
    // Miembros, con expulsar (G4/G9)
    var mt = _el('div', 'gset-sec', s.m.length + t('prof_group_people', ' personas: ').replace(/:\s*$/, '')); mt.style.cssText = 'font-size:13px;opacity:0.7;margin:14px 2px 2px;'; b.appendChild(mt);
    s.m.forEach(function(nx) {
      var row = _el('div', 'gset-member'); row.dataset.nx = nx; row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 2px;border-bottom:1px solid rgba(255,255,255,0.06);';
      var name = nx === me ? t('prof_group_you', 'tú') : gs.memberName(nx);
      row.appendChild(_pickAvatar(nx, name));
      var nmEl = _el('div', 'gset-member-name', name); nmEl.style.cssText = 'flex:1;'; row.appendChild(nmEl);
      var tag = _roleTag(s, nx); if (tag) { var tg = _el('span', 'gset-role', tag); tg.style.cssText = 'font-size:12px;color:#00c8ff;'; row.appendChild(tg); }
      if (nx !== me && can('kick', nx)) {
        var k = _el('button', 'gset-kick', t('grp_kick', 'Expulsar')); k.type = 'button';
        k.style.cssText = 'background:none;border:1px solid #ff6b6b;color:#ff6b6b;border-radius:10px;padding:6px 10px;font-size:14px;';
        k.addEventListener('click', function() { _kickSheet(gid, nx, name); });
        row.appendChild(k);
      }
      b.appendChild(row);
    });
    // Personas bloqueadas (solo si hay)
    if (s.bl.length) b.appendChild(_btn('gset-blocked', '⛔  ' + t('grp_blocked', 'Personas bloqueadas') + ' (' + s.bl.length + ')', function() { _blockedSheet(gid); }));
    // Fondo del grupo (G7): local en este teléfono; quien puede cambiar el grupo lo comparte con todos
    b.appendChild(_btn('gset-wp', '🎨  ' + t('grp_wp', 'Fondo del grupo'), function() { _wpSheet(gid); }));
    b.appendChild(_btn('gset-leave', '🚪  ' + t('prof_group_leave', 'Salir del grupo'), function() { p.sheet.remove(); Promise.resolve(gs.leave(gid)).then(function() { var bi = _bi(); if (bi && bi.renderContactsList) bi.renderContactsList(); }); }, true));
  }
  paint();
  var onCh = function(e) { if (!document.body.contains(p.sheet)) { window.removeEventListener('nexo:groups', onCh); return; } if (!e.detail || !e.detail.id || e.detail.id === gid) paint(); };
  window.addEventListener('nexo:groups', onCh);
  return p.sheet;
}

function _kickSheet(gid, nx, name) {
  var gs = _gs(), p = _sheet('nexo-gset-kick', t('grp_kick', 'Expulsar') + ': ' + name);
  p.body.appendChild(_btn('gset-kick-only', t('grp_kick_only', 'Solo expulsar'), function() { p.sheet.remove(); _run(gs.kick(gid, nx, false)); }, true));
  if (gs.can(gid, 'block', nx)) {
    p.body.appendChild(_btn('gset-kick-block', t('grp_kick_block', 'Expulsar y bloquear'), function() { p.sheet.remove(); _run(gs.kick(gid, nx, true)); }, true));
    var n = _el('div', 'gset-note', t('grp_block_note', 'El bloqueo es solo para este grupo: nadie podrá volver a agregarlo hasta que lo desbloquees. No cambia el contacto fuera del grupo.'));
    n.style.cssText = 'font-size:13px;opacity:0.7;margin:8px 2px;'; p.body.appendChild(n);
  }
  p.body.appendChild(_btn('gset-kick-cancel', t('cancel'), function() { p.sheet.remove(); }));
}

function _blockedSheet(gid) {
  var gs = _gs(), p = _sheet('nexo-gset-bl', t('grp_blocked', 'Personas bloqueadas'));
  function paint() {
    var s = gs.state(gid); p.body.innerHTML = '';
    if (!s.bl.length) { p.sheet.remove(); return; }
    s.bl.forEach(function(nx) {
      var row = _el('div', 'gset-bl-row'); row.dataset.nx = nx; row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid rgba(255,255,255,0.06);';
      var name = gs.memberName(nx);
      row.appendChild(_pickAvatar(nx, name));
      var ne = _el('div', '', name); ne.style.cssText = 'flex:1;'; row.appendChild(ne);
      if (gs.can(gid, 'unblock', nx)) {
        var u = _el('button', 'gset-unblock', t('grp_unblock', 'Desbloquear')); u.type = 'button';
        u.style.cssText = 'background:none;border:1px solid #00c8ff;color:#00c8ff;border-radius:10px;padding:6px 10px;font-size:14px;';
        u.addEventListener('click', function() { _run(gs.unblock(gid, nx)).then(paint); });
        row.appendChild(u);
      }
      p.body.appendChild(row);
    });
  }
  paint();
}

// Fondo del grupo (G7): como el de un chat normal, guardado con el id del grupo; «Compartir» lo manda a cada miembro
function _wpSheet(gid) {
  var gs = _gs(), p = _sheet('nexo-gset-wpl', t('grp_wp', 'Fondo del grupo'));
  var fin = _el('input', 'gset-wp-file'); fin.type = 'file'; fin.accept = 'image/*'; fin.style.display = 'none'; p.body.appendChild(fin);
  fin.addEventListener('change', function() {
    var f = fin.files && fin.files[0]; if (!f) return;
    var lim = wpShareLimits(); // del tamaño de un fondo que se comparte (entra en un sobre del grupo por cualquier camino)
    _run(makeWallpaper(f, lim.edge, lim.len).then(function(u) { if (!setChatWallpaperFor(gid, u)) throw new Error(t('grp_err_photo', 'Esa foto no sirve')); p.sheet.remove(); _toast(t('grp_wp_set', 'Fondo puesto en este teléfono')); }));
  });
  p.body.appendChild(_btn('gset-wp-pick', '🖼️  ' + t('grp_wp_pick', 'Elegir fondo'), function() { fin.click(); }));
  if (chatWallpaperFor(gid)) {
    if (gs.can(gid, 'edit')) p.body.appendChild(_btn('gset-wp-share', '📤  ' + t('grp_wp_share', 'Compartir el fondo con el grupo'), function() { p.sheet.remove(); _shareWp(gid); }));
    p.body.appendChild(_btn('gset-wp-clear', '🗑️  ' + t('grp_wp_clear', 'Quitar el fondo'), function() { clearChatWallpaperFor(gid); p.sheet.remove(); }));
  }
}
function _shareWp(gid) {
  var gs = _gs(), img = chatWallpaperFor(gid);
  if (!img || !gs.can(gid, 'edit')) return;
  // Va dentro del sobre del grupo como acción oculta (wp); el que recibe comprueba que quien lo manda puede cambiar el grupo
  var id = gs.sendText(gid, JSON.stringify({ type: 'nexo_act', act: 'gwp', img: img }), null, null, null, null, { wp: 1 });
  if (id) _toast(t('grp_wp_shared', 'Fondo compartido con el grupo'));
}

// ===== G5: la barra de escribir, bloqueada con el motivo =====
var _phOrig = null;
export function refreshGroupComposer() {
  var input = document.getElementById('message-input'), send = document.getElementById('send-btn'), att = document.getElementById('attach-btn');
  if (!input) return;
  var gs = _gs(), bi = _bi(), cid = bi && bi._activeChatDeviceId;
  var why = '';
  if (gs && cid && gs.isGroup(cid) && typeof gs.canWrite === 'function') {
    var g = gs.get(cid);
    if (g.kicked || g.left) why = t('grp_err_not_member', 'Ya no estás en este grupo');
    else if (g.s && !gs.canWrite(cid)) why = t('grp_only_admins_write', 'Solo los administradores pueden escribir en este grupo');
  }
  if (why) {
    if (_phOrig === null) _phOrig = input.getAttribute('placeholder') || '';
    input.value = ''; input.disabled = true; input.setAttribute('placeholder', why); input.classList.add('nx-locked');
    if (send) send.disabled = true; if (att) att.disabled = true;
  } else if (input.classList.contains('nx-locked')) {
    input.disabled = false; input.setAttribute('placeholder', _phOrig || ''); input.classList.remove('nx-locked'); _phOrig = null;
    if (send) send.disabled = false; if (att) att.disabled = false;
  }
}
export function installGroupPanel() {
  window.addEventListener('nexo:ble:openChat', function() { setTimeout(refreshGroupComposer, 0); });
  window.addEventListener('nexo:ble:closeChat', function() { setTimeout(refreshGroupComposer, 0); });
  window.addEventListener('nexo:groups', function() { refreshGroupComposer(); });
}
