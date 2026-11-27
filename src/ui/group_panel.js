/**
 * group_panel.js (22-11, COLA 4b «Grupos: administración», G1/G3/G4/G5/G6/G7/G9) — Pantalla «Ajustes del grupo» (desde los ⋮ del
 * grupo): nombre y foto, modo (Control / Colegas) e interruptores, «Designar administradores» (con buscador), agregar personas,
 * expulsar («Solo expulsar» / «Expulsar y bloquear»), «Personas bloqueadas» (solo si hay) con «Desbloquear», fondo del grupo y
 * salir. Cada botón aparece solo si quien mira tiene permiso (group_state.gsCan); aun así, el que recibe vuelve a comprobarlo.
 * También bloquea la barra de escribir con el motivo cuando no se puede escribir en el grupo abierto (G5).
 */
import { _contactsStyles, _pickAvatar } from './share_contacts.js';
import { _normId } from './chat_format.js';
import { vaultLoadContacts } from '../vault/vault_manager.js';
import { makeAvatar } from './avatar.js';
import { makeWallpaper, setChatWallpaperFor, chatWallpaperFor, clearChatWallpaperFor, wpShareLimits, groupWpOffer, useGroupWpOffer, setGroupWpOpener } from './wallpaper.js';
import { _showInfoToast } from './ui_bits.js';
import { GS_MAX_MEMBERS } from './group_state.js';
import { t } from './i18n.js';
import { _doChatBack } from './chat_nav.js';
import { openMemberCard } from './member_card.js'; // 27-11: la tarjeta de un miembro
import { sheetSvg, SHEET_ICONS } from './chat_sheet.js'; // B-EST (26-11): iconos de trazo de las hojas

function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _gs() { var b = _bi(); return b && b.groups; }
function _me() { return _normId(_bi() && _bi().localNexoId); }
function _toast(s) { try { _showInfoToast(s, 3200); } catch (e) {} }
function _el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
// B-EST (26-11, dueño: «un mismo estilo»): cada opción es una fila de hoja (.mm-item.nx-row, la de las opciones del chat) con su icono
// de trazo en vez del emoji del texto; sin rayas entre filas. El icono sale de la clase de la opción (las que buscan las pruebas).
var ROW_ICO = { 'gset-photo-btn': 'nx-image', 'gset-photo-del': 'nx-trash', 'gset-admins': 'chat-starred', 'gset-add': 'nx-person-add',
  'gset-blocked': 'chat-block', 'gset-wp': 'nx-palette', 'gset-leave': 'nx-leave', 'gset-mem-add': 'nx-person-add', 'gset-mem-cancel': 'mm-cancel',
  'gset-kick-only': 'nx-person-x', 'gset-kick-block': 'chat-block', 'gset-kick-cancel': 'mm-cancel', 'gset-wp-pick': 'nx-image', 'gset-wp-share': 'nx-share', 'gset-wp-clear': 'nx-trash', 'gset-wp-offer': 'nx-image' };
function _btn(cls, label, fn, danger) {
  var b = _el('button', 'mm-item nx-row ' + cls + (danger ? ' nx-danger' : '')); b.type = 'button';
  var ico = SHEET_ICONS[ROW_ICO[String(cls).split(' ')[0]]];
  if (ico) { var ic = _el('span', 'mm-ico'); ic.innerHTML = sheetSvg(ico, 20); b.appendChild(ic); label = String(label).replace(/^\S+\s{2}/, ''); } // el emoji del texto lo hace el icono
  b.appendChild(_el('span', 'nx-sheet-label', label));
  b.addEventListener('click', function(e) { e.stopPropagation(); fn(); });
  return b;
}
function _sheet(id, title) {
  var old = document.getElementById(id); if (old) old.remove();
  _contactsStyles();
  var sh = _el('div'); sh.id = id;
  sh.className = 'nx-panel'; // B-EST (26-11): pantalla como Nuevo grupo / Reenviar (cabecera de Contactos arriba del todo, sin 16 px de más)
  sh.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
  var head = _el('div', 'nx-page-head nx-sheet-head');
  head.appendChild(_el('div', 'nx-page-title', title));
  // Dueño 26-11 (3160): sin botón X; se vuelve con el gesto o el botón atrás de Android, como el resto de la app (chat_nav: .nx-panel)
  sh.appendChild(head);
  var body = _el('div', 'gset-body nx-panel-body');
  sh.appendChild(body);
  document.body.appendChild(sh);
  return { sheet: sh, body: body };
}
function _fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
// Lista con buscador por nombre y casillas: items [{ nx, name, on, locked }] → onSave(lista de NEXO ID marcados)
function _pickList(id, title, items, saveLabel, onSave, max) {
  var p = _sheet(id, title);
  var q = _el('input', 'gset-q nx-input'); q.placeholder = t('grp_search', 'Buscar por nombre');
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
  save.className = id + '-save gset-save nx-btn nx-btn-primary'; // el botón principal de la pantalla (como «Crear grupo»)
  p.sheet.appendChild(save);
  return p;
}
function _run(promise) { return Promise.resolve(promise).catch(function(e) { if (e && e.code === 'CANCEL') return; _toast((e && e.message) || String(e)); }); } // 28-11: cerrar el ajuste de la foto no es un error

// Elegir el modo (al crear el grupo y en Ajustes): Control (el creador y los admins mandan) / Colegas (todos hacen todo)
// OPCIONES del grupo (dueño 23-11: «lo primero al crear un grupo son las opciones; algo muy rápido, dos nada más»). También en
// «Ajustes del grupo». «Todos participan»: todos escriben, suben y comparten. «Personalizado»: para escribir, para agregar personas
// y para cambiar nombre y foto, «Todos» o «Solo administradores» (por dentro ow, oa y md: 'c' = nombre y foto solo administradores,
// que además expulsan; 'o' = todos, expulsar solo el creador). cur: el estado actual, o null al crear (entonces «Personalizado»
// empieza con todo en «Solo administradores»). onChange(cambios) en cada toque que cambia algo; onPick() al elegir una de las dos.
export function groupOptionsPicker(host, cur, onChange, onPick) {
  var v = cur ? { md: cur.md === 'c' ? 'c' : 'o', ow: cur.ow ? 1 : 0, oa: cur.oa ? 1 : 0 } : { md: 'o', ow: 0, oa: 0 };
  var custom = !!cur && (v.md === 'c' || !!v.ow || !!v.oa), picked = !!cur;
  var api = { value: function() { return { md: v.md, ow: v.ow, oa: v.oa }; }, custom: function() { return custom; }, picked: function() { return picked; } };
  if (!host) return api;
  host.innerHTML = '';
  var mk = function(cls, label, sub, fn) {
    var b = _el('button', 'gset-mode nx-opt ' + cls); b.type = 'button';
    b.appendChild(_el('div', 'nx-opt-t', label)); b.appendChild(_el('div', 'nx-opt-d', sub));
    b.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); fn(); });
    host.appendChild(b); return b;
  };
  var bAll = mk('gset-mode-o', t('grp_opt_all', 'Todos participan'), t('grp_opt_all_sub', 'Todos pueden escribir, subir y compartir'), function() {
    var ch = {};
    if (v.md !== 'o') ch.md = 'o'; if (v.ow) ch.ow = 0; if (v.oa) ch.oa = 0;
    v = { md: 'o', ow: 0, oa: 0 }; custom = false; picked = true; paint();
    if (onChange && Object.keys(ch).length) onChange(ch);
    if (onPick) onPick();
  });
  var bCus = mk('gset-mode-p', t('grp_opt_custom', 'Personalizado'), t('grp_opt_custom_sub', 'Tú eliges quién escribe, quién agrega y quién cambia el grupo'), function() {
    if (!custom && !cur) v = { md: 'c', ow: 1, oa: 1 };
    custom = true; picked = true; paint();
    if (onPick) onPick();
  });
  var rows = _el('div', 'gset-rows'); host.appendChild(rows);
  var ROWS = [['ow', t('grp_row_write', 'Escribir y compartir')], ['oa', t('grp_row_add', 'Agregar personas')], ['md', t('grp_row_edit', 'Cambiar nombre y foto')]];
  var isAdm = function(k) { return k === 'md' ? v.md === 'c' : !!v[k]; };
  function mark(b, on) { b.style.borderColor = on ? '#00c8ff' : ''; b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  function paint() {
    mark(bAll, picked && !custom); mark(bCus, custom);
    rows.innerHTML = ''; rows.style.display = custom ? 'block' : 'none';
    if (!custom) return;
    ROWS.forEach(function(r) {
      var line = _el('div', 'gset-row nx-opt-row gset-row-' + r[0]);
      line.appendChild(_el('div', 'nx-opt-row-t', r[1]));
      [[0, 'gset-who-all', t('grp_who_all', 'Todos')], [1, 'gset-who-adm', t('grp_who_admins', 'Solo administradores')]].forEach(function(o) {
        var sel = isAdm(r[0]) === !!o[0];
        var b = _el('button', o[1] + ' nx-chip' + (sel ? ' nx-chip-on' : ''), o[2]); b.type = 'button';
        mark(b, sel);
        b.addEventListener('click', function(e) {
          e.preventDefault(); e.stopPropagation();
          if (isAdm(r[0]) === !!o[0]) return;
          var ch = {};
          if (r[0] === 'md') { v.md = o[0] ? 'c' : 'o'; ch.md = v.md; } else { v[r[0]] = o[0]; ch[r[0]] = o[0]; }
          paint();
          if (onChange) onChange(ch);
        });
        line.appendChild(b);
      });
      rows.appendChild(line);
    });
  }
  paint();
  return api;
}
// Las opciones en una línea (para quien no las puede cambiar)
export function groupOptionsText(s) {
  if (s.md !== 'c' && !s.ow && !s.oa) return t('grp_opt_all', 'Todos participan') + ' · ' + t('grp_opt_all_sub', 'Todos pueden escribir, subir y compartir');
  var w = function(on) { return on ? t('grp_who_admins', 'Solo administradores') : t('grp_who_all', 'Todos'); };
  return t('grp_opt_custom', 'Personalizado') + ' · ' + t('grp_row_write', 'Escribir y compartir') + ': ' + w(s.ow) + ' · ' + t('grp_row_add', 'Agregar personas') + ': ' + w(s.oa) + ' · ' + t('grp_row_edit', 'Cambiar nombre y foto') + ': ' + w(s.md === 'c');
}

function _roleTag(s, nx) {
  if (s.cr === nx) return t('grp_role_creator', 'Creador');
  if (s.ad.indexOf(nx) >= 0) return t('grp_role_admin', 'Admin');
  return '';
}

// ===== Ajustes del grupo =====
// opts (dueño 27-11, propuesta B): { title, extra(body) } — la página «Información» del grupo (chat_info.js) usa esta misma pantalla con
// su título y, debajo del nombre y la foto, las opciones del chat (buscar, destacados, temporales, silenciar)
export function openGroupSettings(gid, opts) {
  var gs = _gs(), g = gs && gs.get(gid);
  if (!g || typeof gs.state !== 'function') return;
  opts = opts || {};
  var p = _sheet('nexo-gset', opts.title || t('grp_settings', 'Ajustes del grupo'));
  var me = _me();
  function paint() {
    g = gs.get(gid);
    if (!g || g.kicked || g.left) { p.sheet.remove(); return; }
    var s = gs.state(gid), b = p.body, can = function(w, x) { return gs.can(gid, w, x); };
    b.innerHTML = '';
    // Foto y nombre
    var top = _el('div', 'gset-top');
    var av = _el('div', 'ble-contact-avatar gset-photo'); av.style.cssText = 'width:64px;height:64px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:26px;background:#2a2c48;';
    var img = gs.photoOf(gid);
    if (img) { av.style.backgroundImage = 'url("' + img + '")'; av.style.backgroundSize = 'cover'; } else av.textContent = '👥';
    top.appendChild(av);
    var nm = _el('input', 'gset-name nx-input'); nm.value = s.n; nm.maxLength = 60; nm.disabled = !can('edit');
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
    if (typeof opts.extra === 'function') { try { opts.extra(b); } catch (x) {} }
    // Modo e interruptores (solo quien hace de creador los cambia; los demás los ven)
    var boss = can('settings');
    var mh = _el('div', 'gset-sec nx-sec-label', t('grp_opts', 'Opciones del grupo')); b.appendChild(mh);
    if (boss) {
      var mp = _el('div', 'gset-opts'); b.appendChild(mp);
      groupOptionsPicker(mp, s, function(ch) { _run(gs.setSettings(gid, ch)); });
    } else {
      var info = _el('div', 'gset-mode-info nx-note', groupOptionsText(s));
      b.appendChild(info);
    }
    // Historial para los nuevos (dueño 24-11, opción B): lo cambia quien hace de creador; los demás lo ven
    var hxOn = !s.hx;
    var hxRow = _el('label', 'gset-hist nx-check-row');
    var hxBox = _el('input', 'gset-hist-box'); hxBox.type = 'checkbox'; hxBox.checked = hxOn; hxBox.disabled = !boss;
    hxRow.appendChild(hxBox); hxRow.appendChild(_el('span', '', t('grp_hist_opt', 'Los nuevos pueden ver los mensajes anteriores (últimos 30 días)')));
    if (boss) hxBox.addEventListener('change', function() { _run(gs.setSettings(gid, { hx: hxBox.checked ? 0 : 1 })); });
    b.appendChild(hxRow);
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
      var note = _el('div', 'gset-note nx-note', s.hx ? t('grp_add_note', 'Quien entra no ve los mensajes de antes.') : t('grp_add_note_hist', 'Le llega una invitación; al entrar puede pedir los mensajes de los últimos 30 días.')); pk.sheet.insertBefore(note, pk.sheet.lastChild);
    }));
    // Miembros, con expulsar (G4/G9)
    var mt = _el('div', 'gset-sec nx-sec-label', s.m.length + t('prof_group_people', ' personas: ').replace(/:\s*$/, '')); b.appendChild(mt);
    s.m.forEach(function(nx) {
      var row = _el('div', 'gset-member nx-person-row'); row.dataset.nx = nx; // como una fila de Contactos (sin rayas)
      var name = nx === me ? t('prof_group_you', 'tú') : gs.memberName(nx);
      row.appendChild(_pickAvatar(nx, name));
      var nmEl = _el('div', 'gset-member-name nx-pick-name', name); row.appendChild(nmEl);
      // Dueño 23-11: tocar a un miembro abre su chat si ya es contacto; si no, «Agregar» (solicitud de contacto)
      if (nx !== me) { row.style.cursor = 'pointer'; row.addEventListener('click', function(e) { if (e.target && e.target.closest && e.target.closest('.gset-kick')) return; _memberTap(p.sheet, nx, name); }); }
      var tag = _roleTag(s, nx); if (tag) { var tg = _el('span', 'gset-role nx-role-tag', tag); row.appendChild(tg); }
      if (nx !== me && can('kick', nx)) {
        var k = _el('button', 'gset-kick nx-chip nx-chip-danger', t('grp_kick', 'Expulsar')); k.type = 'button';
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

// Tocar a un miembro: dueño 27-11, su TARJETA (foto, nombre, NEXO ID; Mensaje / Llamar / Info, o Agregar si no es contacto: member_card.js)
function _memberTap(panel, nx, name) { openMemberCard(nx, name); }

// Dueño 27-11 (propuesta B): ya NO hay rueda en la cabecera del grupo; todo está en «Información» (tocar el nombre, chat_info.js).
// Se conserva la función (la llaman al abrir/cerrar el chat) para quitar una rueda que hubiera quedado puesta.
export function refreshGroupGear() {
  var b = document.getElementById('nexo-gset-btn');
  if (b) b.remove();
}

function _kickSheet(gid, nx, name) {
  var gs = _gs(), p = _sheet('nexo-gset-kick', t('grp_kick', 'Expulsar') + ': ' + name);
  p.body.appendChild(_btn('gset-kick-only', t('grp_kick_only', 'Solo expulsar'), function() { p.sheet.remove(); _run(gs.kick(gid, nx, false)); }, true));
  if (gs.can(gid, 'block', nx)) {
    p.body.appendChild(_btn('gset-kick-block', t('grp_kick_block', 'Expulsar y bloquear'), function() { p.sheet.remove(); _run(gs.kick(gid, nx, true)); }, true));
    var n = _el('div', 'gset-note', t('grp_block_note', 'El bloqueo es solo para este grupo: nadie podrá volver a agregarlo hasta que lo desbloquees. No cambia el contacto fuera del grupo.'));
    n.className = 'gset-note nx-note'; p.body.appendChild(n);
  }
  p.body.appendChild(_btn('gset-kick-cancel', t('cancel'), function() { p.sheet.remove(); }));
}

function _blockedSheet(gid) {
  var gs = _gs(), p = _sheet('nexo-gset-bl', t('grp_blocked', 'Personas bloqueadas'));
  function paint() {
    var s = gs.state(gid); p.body.innerHTML = '';
    if (!s.bl.length) { p.sheet.remove(); return; }
    s.bl.forEach(function(nx) {
      var row = _el('div', 'gset-bl-row nx-person-row'); row.dataset.nx = nx;
      var name = gs.memberName(nx);
      row.appendChild(_pickAvatar(nx, name));
      var ne = _el('div', 'nx-pick-name', name); row.appendChild(ne);
      if (gs.can(gid, 'unblock', nx)) {
        var u = _el('button', 'gset-unblock nx-chip nx-chip-accent', t('grp_unblock', 'Desbloquear')); u.type = 'button';
        u.addEventListener('click', function() { _run(gs.unblock(gid, nx)).then(paint); });
        row.appendChild(u);
      }
      p.body.appendChild(row);
    });
  }
  paint();
}

// Fondo del grupo (G7): como el de un chat normal, guardado con el id del grupo; «Compartir» lo manda a cada miembro
// Dueño 26-11: cada quien lo cambia SOLO para sí; compartirlo es opcional y lo puede hacer cualquiera que escriba en el grupo. Si otro
// comparte uno mientras yo tengo el mío, el mío se queda y el suyo aparece aquí para usarlo si quiero.
function _canShareWp(gs, gid) { return typeof gs.canWrite === 'function' ? gs.canWrite(gid) : gs.can(gid, 'edit'); }
function _wpSheet(gid) {
  var gs = _gs(), p = _sheet('nexo-gset-wpl', t('grp_wp', 'Fondo del grupo'));
  var sub = _el('div', 'gset-wp-sub', t('grp_wp_only_me', 'El fondo que elijas es solo para ti. Si quieres, compártelo con el grupo.'));
  sub.style.cssText = 'font-size:14px;opacity:.75;padding:4px 4px 10px;line-height:1.35;';
  p.body.appendChild(sub);
  var fin = _el('input', 'gset-wp-file'); fin.type = 'file'; fin.accept = 'image/*'; fin.style.display = 'none'; p.body.appendChild(fin);
  fin.addEventListener('change', function() {
    var f = fin.files && fin.files[0]; if (!f) return;
    var lim = wpShareLimits(); // del tamaño de un fondo que se comparte (entra en un sobre del grupo por cualquier camino)
    _run(makeWallpaper(f, lim.edge, lim.len).then(function(u) { if (!setChatWallpaperFor(gid, u)) throw new Error(t('grp_err_photo', 'Esa foto no sirve')); p.sheet.remove(); _toast(t('grp_wp_set', 'Fondo puesto en este teléfono')); }));
  });
  p.body.appendChild(_btn('gset-wp-pick', '🖼️  ' + t('grp_wp_pick', 'Elegir fondo'), function() { fin.click(); }));
  if (chatWallpaperFor(gid)) {
    if (_canShareWp(gs, gid)) p.body.appendChild(_btn('gset-wp-share', '📤  ' + t('grp_wp_share', 'Compartir el fondo con el grupo'), function() { p.sheet.remove(); _shareWp(gid); }));
    p.body.appendChild(_btn('gset-wp-clear', '🗑️  ' + t('grp_wp_clear', 'Quitar el fondo'), function() { clearChatWallpaperFor(gid); p.sheet.remove(); }));
  }
  groupWpOffer(gid).then(function(o) {
    if (!o || !o.img || !document.body.contains(p.sheet)) return;
    var who = (gs && typeof gs.memberName === 'function') ? gs.memberName(o.from) : o.from.toUpperCase();
    var b = _btn('gset-wp-offer', '🎨  ' + t('grp_wp_use_offer', 'Usar el fondo que compartió') + ' ' + who, function() {
      p.sheet.remove();
      if (useGroupWpOffer(gid)) _toast(t('grp_wp_set', 'Fondo puesto en este teléfono'));
    });
    p.body.insertBefore(b, p.body.querySelector('.gset-wp-pick').nextSibling);
  });
}
function _shareWp(gid) {
  var gs = _gs(), img = chatWallpaperFor(gid);
  if (!img || !_canShareWp(gs, gid)) return;
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
  setGroupWpOpener(function(gid) { _wpSheet(gid); }); // 27-11: pulsación larga sobre el fondo de un grupo → su hoja del fondo
  window.addEventListener('nexo:ble:openChat', function() { setTimeout(function() { refreshGroupComposer(); refreshGroupGear(); }, 0); });
  window.addEventListener('nexo:ble:closeChat', function() { setTimeout(function() { refreshGroupComposer(); refreshGroupGear(); }, 0); });
  window.addEventListener('nexo:groups', function(e) {
    // Me expulsaron (dueño 22-11): el grupo desaparece de la lista; si lo tenía abierto, se vuelve a la lista
    var d = e && e.detail, bi = _bi();
    if (d && d.gone && bi) {
      var old = document.getElementById('nexo-gset'); if (old) old.remove();
      if (bi._activeChatDeviceId === d.id) { try { _doChatBack(); } catch (x) {} }
      if (typeof bi.renderContactsList === 'function') bi.renderContactsList();
    }
    refreshGroupComposer(); refreshGroupGear();
  });
}
