/**
 * groups_ui.js v1.0 (ronda 2758, plan del dueño punto 14) — Pantallas de los grupos (la lógica está en groups.js):
 * botón 👥 en la cabecera para crear un grupo (nombre + elegir contactos), abrir el chat de un grupo y su menú
 * (miembros y salir del grupo).
 */
import { _contactsStyles, _pickAvatar, SHEET_CLOSE_SVG } from './share_contacts.js';
import { ratchetPeerBundle } from '../vault/e2e_ratchet.js';
import { _normId } from './chat_format.js';
import { vaultLoadContacts } from '../vault/vault_manager.js';
import { _renderMessage } from './render.js';
import { _showInfoToast } from './ui_bits.js';
import { t } from './i18n.js';
import { isPreviewHidden, toggleHidePreview } from './chat_hide_preview.js';
import { isMuted, muteMenuLabel, openMuteSheet } from './chat_mute.js'; // 3219: silenciar el grupo
import { openGroupSettings, groupOptionsPicker, installGroupPanel } from './group_panel.js'; // 22-11 (COLA 4b): Ajustes del grupo
import { historyAllowed, requestHistory } from './group_history.js'; // 24-11: historial para los nuevos

function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _groups() { var b = _bi(); return b && b.groups; }
function _toast(t) { try { _showInfoToast(t, 3000); } catch (e) { console.log('[GROUP] ' + t); } }

// Texto de la cabecera: "3 personas: Ana, Luis, tú"
export function groupSubtitle(g) {
  var gs = _groups(), me = _normId(_bi() && _bi().localNexoId);
  if (!g || !gs) return '';
  var names = g.members.map(function(nx) { return nx === me ? t('prof_group_you', 'tú') : gs.memberName(nx); });
  return g.members.length + t('prof_group_people', ' personas: ') + names.join(', ');
}

// Abrir el chat de un grupo (como openChat de un contacto, sin Bluetooth: cada mensaje va a cada miembro por su camino)
export function openGroupChat(gid) {
  var bi = _bi(), gs = _groups(), g = gs && gs.get(gid);
  if (!bi || !g) return false;
  bi._activeChatDeviceId = g.id;
  bi._activeChatDeviceIdNative = null;
  if (window.NEXO && window.NEXO.app) window.NEXO.app.activeContact = { nexoId: g.id, name: g.name, displayName: g.name, isGroup: true };
  if (typeof bi.clearUnread === 'function') bi.clearUnread(g.id);
  var app = document.getElementById('app');
  if (app) app.classList.remove('hidden');
  var nameInput = document.getElementById('chat-contact-name');
  if (nameInput) nameInput.value = g.name;
  try { window.dispatchEvent(new CustomEvent('nexo:ble:openChat', { detail: { contactId: g.id, name: g.name, deviceId: null, transport: 'group', source: 'groups' } })); } catch (e) {}
  var sub = document.getElementById('chat-contact-subtitle');
  if (sub) sub.textContent = groupSubtitle(g);
  if (bi.elements && bi.elements.panel) bi.elements.panel.classList.remove('active');
  if (bi.elements && bi.elements.overlay) bi.elements.overlay.classList.remove('active');
  try { window.dispatchEvent(new CustomEvent('nexo:vault:messagesLoaded', { detail: { contactId: g.id } })); } catch (e) {}
  return true;
}

// Hoja para crear un grupo: nombre y contactos. 3222: `pre` (opcional) = el contacto con el que se abre (⋮ «Crear grupo»): ya elegido y arriba
export function openCreateGroupSheet(pre) {
  var gs = _groups();
  if (!gs) return;
  _contactsStyles();
  var all = (vaultLoadContacts() || []).filter(function(c) { return /^nx[0-9a-z]{8}$/.test(_normId(c.nexoId || c.deviceUUID)); });
  var preNx = '';
  if (pre) { var pc = all.filter(function(c) { return c.deviceUUID === pre || _normId(c.nexoId || c.deviceUUID) === _normId(pre); })[0]; if (pc) { preNx = _normId(pc.nexoId || pc.deviceUUID); all = [pc].concat(all.filter(function(c) { return c !== pc; })); } }
  var old = document.getElementById('nexo-group-sheet');
  if (old) old.remove();
  var sheet = document.createElement('div');
  sheet.id = 'nexo-group-sheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:var(--nx-bg);color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;';
  sheet.innerHTML = '<div class="nx-page-head nx-sheet-head">' +
    '<div class="nx-page-title">' + t('prof_group_new', 'Nuevo grupo') + '</div>' +
    '<button id="nexo-group-cancel" class="nx-round-btn" aria-label="' + t('cancel') + '" title="' + t('cancel') + '">' + SHEET_CLOSE_SVG + '</button></div>' +
    // dueño 23-11: lo PRIMERO son las opciones (dos); el nombre y los contactos aparecen al elegir una
    '<div style="font-size:15px;margin:2px 2px 8px;">' + t('grp_opts_q', '¿Cómo será el grupo?') + '</div>' +
    '<div id="nexo-group-mode"></div>' +
    '<div id="nexo-group-step2" style="display:none;flex:1;flex-direction:column;min-height:0;">' +
    '<input id="nexo-group-name" maxlength="60" placeholder="' + t('prof_group_name_ph', 'Nombre del grupo') + '" style="background:rgba(255,255,255,0.08);border:none;border-radius:10px;padding:12px;color:#fff;font-size:16px;margin-bottom:8px;">' +
    '<div style="font-size:13px;color:var(--nx-muted);margin:4px 2px 6px;">' + t('prof_group_choose', 'Elige quién está en el grupo') + '</div>' +
    '<div id="nexo-group-admhint" style="display:none;font-size:13px;color:var(--nx-muted);margin:0 2px 6px;">' + t('grp_adm_hint', 'Toca «Admin» junto a quien quieras que administre contigo') + '</div>' +
    '<div id="nexo-group-list" style="flex:1;overflow-y:auto;"></div>' +
    '<button id="nexo-group-create" disabled style="background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:600;margin-top:8px;opacity:0.5;">' + t('prof_group_create', 'Crear grupo') + '</button>' + '</div>';
  document.body.appendChild(sheet);
  var listEl = sheet.querySelector('#nexo-group-list'), btn = sheet.querySelector('#nexo-group-create'), nameEl = sheet.querySelector('#nexo-group-name');
  // #dueño 31-10: nombre por defecto «Grupo N» (editable). Así siempre hay un nombre (no bloquea crear) y el dueño lo cambia si quiere.
  try { var _gn = Object.keys((gs && gs.list) || {}).length + 1; nameEl.value = t('prof_group_default_pre', 'Grupo ') + _gn; } catch (e) {}
  var chosen = {}, admins = {}, step2 = sheet.querySelector('#nexo-group-step2'), admHint = sheet.querySelector('#nexo-group-admhint');
  var mode = groupOptionsPicker(sheet.querySelector('#nexo-group-mode'), null, function() { paintAdmins(); }, function() { step2.style.display = 'flex'; paintAdmins(); });
  // «Personalizado»: junto a cada contacto elegido, «Admin» para que administre con el creador desde el principio
  function paintAdmins() {
    var on = mode.custom();
    admHint.style.display = on ? 'block' : 'none';
    listEl.querySelectorAll('.nexo-pick-admin').forEach(function(b) {
      var id = b.dataset.nx, vis = on && !!chosen[id], sel = vis && !!admins[id];
      b.style.display = vis ? '' : 'none';
      b.style.borderColor = sel ? '#00c8ff' : 'rgba(255,255,255,0.18)'; b.style.background = sel ? 'rgba(0,200,255,0.15)' : 'none';
      b.setAttribute('aria-pressed', sel ? 'true' : 'false');
    });
  }
  function refresh() {
    var n = Object.keys(chosen).length;
    var ok = n > 0;
    btn.disabled = !ok; btn.style.opacity = ok ? '1' : '0.5';
    // Ronda 2792 + informe del dueño 31-10 («selecciono contactos pero no se habilita Crear grupo»): el NOMBRE es OPCIONAL
    // (create() ya pone «Grupo» o uno por defecto con los nombres si se deja vacío), así que el botón se habilita en cuanto
    // hay AL MENOS UN contacto. Antes exigía nombre y el dueño veía el botón gris aunque hubiera elegido a alguien.
    btn.textContent = !n ? t('prof_group_need_contact', 'Elige al menos un contacto') : t('prof_group_create_n_pre', 'Crear grupo (') + (n + 1) + t('prof_group_create_n_post', ' personas)');
  }
  if (!all.length) listEl.innerHTML = '<div style="color:var(--nx-muted);font-size:15px;line-height:1.5;text-align:center;padding:24px;">' + t('prof_group_no_contacts', 'Aún no tienes contactos.') + '</div>';
  all.forEach(function(c) {
    var id = _normId(c.nexoId || c.deviceUUID);
    var row = document.createElement('label');
    row.className = 'nexo-pick-row';
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.nx = id;
    var nm = document.createElement('div'); nm.className = 'nx-pick-name'; nm.textContent = c.name || id.toUpperCase();
    var ab = document.createElement('button'); ab.type = 'button'; ab.className = 'nexo-pick-admin'; ab.dataset.nx = id; ab.textContent = t('grp_admin_chip', 'Admin');
    ab.style.cssText = 'display:none;margin-left:auto;padding:6px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);background:none;color:#fff;font-size:13px;';
    ab.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); if (admins[id]) delete admins[id]; else admins[id] = true; paintAdmins(); });
    row.appendChild(cb); row.appendChild(_pickAvatar(id, c.name || id)); row.appendChild(nm); row.appendChild(ab);
    cb.addEventListener('change', function() { if (cb.checked) chosen[id] = true; else { delete chosen[id]; delete admins[id]; } refresh(); paintAdmins(); });
    if (id === preNx) { cb.checked = true; chosen[id] = true; }
    listEl.appendChild(row);
  });
  refresh();
  nameEl.addEventListener('input', refresh);
  sheet.querySelector('#nexo-group-cancel').onclick = function() { sheet.remove(); };
  btn.onclick = function() {
    var g;
    // El nombre viene con «Grupo N» por defecto y es editable; si aun así quedara vacío, create() pone «Grupo».
    try { g = gs.create(nameEl.value, Object.keys(chosen)); } catch (e) { _toast(e.message); return; }
    sheet.remove();
    var bi = _bi();
    if (bi && typeof bi.renderContactsList === 'function') bi.renderContactsList();
    openGroupChat(g.id);
    // Primer mensaje: así el grupo aparece en los teléfonos de todos, con las tarjetas de los miembros
    // 22-11 (COLA 4b): con el estado firmado (v1: modo elegido, el creador único admin); si no se pudo firmar, como antes
    var opts = mode.value();
    opts.ad = mode.custom() ? Object.keys(admins).filter(function(x) { return chosen[x]; }) : [];
    var txt = '👥 ' + t('grp_n_created', 'Creó el grupo ') + '«' + g.name + '»';
    var p = typeof gs.signGenesis === 'function' ? gs.signGenesis(g.id, opts) : Promise.resolve(null);
    p.then(function(chain) {
      sendGroupText(g.id, JSON.stringify(chain ? { type: 'nexo_txt', t: txt, gs: 1 } : { type: 'nexo_txt', t: txt }), '👥 ' + t('grp_n_created', 'Creó el grupo '), null, memberCards(g), chain ? { extra: { s: chain } } : null);
    });
  };
}

// Mandar un texto al grupo desde la app (burbuja propia, último mensaje y envío a cada miembro)
// opt (22-11, COLA 4b): { to: a quién (por defecto, los miembros), extra: campos del estado del grupo } — un cambio del estado
export function sendGroupText(gid, wire, plain, msgId, cards, opt) {
  var gs = _groups(), bi = _bi();
  if (!gs || !gs.isGroup(gid)) return null;
  opt = opt || {};
  if (!opt.extra && typeof gs.canWrite === 'function' && gs.get(gid).s && !gs.canWrite(gid)) { _toast(groupWriteBlockReason(gid)); return null; }
  msgId = msgId || ('gm' + Date.now() + Math.random().toString(36).substr(2, 6));
  var seq = bi && typeof bi.getNextSeq === 'function' ? bi.getNextSeq() : 0;
  var vm = { msgId: msgId, messageId: msgId, contactNexoId: gid, content: wire, _own: true, status: 'sending', timestamp: Date.now(), seq: seq };
  // Se dibuja si el chat del grupo está abierto y se guarda en su historial
  _renderMessage(vm);
  if (bi && typeof bi.noteContactMessage === 'function') bi.noteContactMessage(gid, String(plain || '').substring(0, 50), vm.timestamp);
  gs.sendText(gid, wire, msgId, seq, opt.to || null, cards, opt.extra || null);
  return msgId;
}

// 22-11 (COLA 4b): por qué no puedo escribir en este grupo ('' si sí puedo)
export function groupWriteBlockReason(gid) {
  var gs = _groups(), g = gs && gs.get(gid);
  if (!g || typeof gs.canWrite !== 'function' || gs.canWrite(gid)) return '';
  if (g.kicked || g.left) return t('grp_err_not_member', 'Ya no estás en este grupo');
  return t('grp_only_admins_write', 'Solo los administradores pueden escribir en este grupo');
}

// Tarjetas de los miembros (como compartir contactos: NEXO ID, nombre y claves aceptadas)
export function memberCards(g) {
  var all = vaultLoadContacts() || [];
  return g.members.map(function(nx) {
    var c = all.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c || !c.publicKey || c.pendingKey) return null;
    var card = { nexoId: nx.toUpperCase(), name: c.name || '', publicKey: c.publicKey };
    var b2 = ratchetPeerBundle(nx);
    if (b2 && b2.ik === c.publicKey) card.b2 = b2;
    if (c.ss) card.ss = 1;
    if (c.nt) card.nt = 1;
    return card;
  }).filter(Boolean);
}

// Menú ⋮ de un grupo en la lista: miembros y salir
export function openGroupMenu(gid) {
  var gs = _groups(), g = gs && gs.get(gid);
  if (!g) return;
  var old = document.getElementById('nexo-group-menu');
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = 'nexo-group-menu';
  box.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;justify-content:center;';
  var sheet = document.createElement('div');
  sheet.style.cssText = 'background:#14152a;color:#fff;width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:14px 0;';
  var title = document.createElement('div');
  title.style.cssText = 'padding:4px 20px 8px;font-size:17px;font-weight:700;';
  title.textContent = g.name;
  var mem = document.createElement('div');
  mem.className = 'nexo-group-members';
  mem.style.cssText = 'padding:0 20px 10px;font-size:13px;opacity:0.8;';
  mem.textContent = groupSubtitle(g);
  sheet.appendChild(title); sheet.appendChild(mem);
  var add = function(label, cls, fn, danger) {
    var b = document.createElement('button');
    b.className = 'mm-item ' + cls;
    b.textContent = label;
    b.style.cssText = 'display:block;width:100%;text-align:left;padding:14px 20px;background:none;border:none;font-size:16px;color:' + (danger ? '#ff6b6b' : '#fff') + ';';
    b.onclick = function(e) { e.stopPropagation(); box.remove(); fn(); };
    sheet.appendChild(b);
  };
  add('💬  ' + t('prof_open', 'Abrir'), 'gm-open', function() { openGroupChat(g.id); });
  if (!g.kicked) add('⚙️  ' + t('grp_settings', 'Ajustes del grupo'), 'gm-settings', function() { openGroupSettings(g.id); }); // 22-11 (COLA 4b)
  var meH = String((window.bleInterface && window.bleInterface.localNexoId) || '').toLowerCase();
  if (!g.kicked && !g.left && String(g.createdBy || '').toLowerCase() !== meH && historyAllowed(g.id)) add('📜  ' + t('grp_hist_btn', 'Ver mensajes anteriores'), 'gm-history', function() { requestHistory(g.id); }); // 24-11
  add(isPreviewHidden(g.id) ? '👁  ' + t('chat_show_preview', 'Mostrar el texto en los avisos') : '🙈  ' + t('chat_hide_preview', 'Ocultar el texto en los avisos'), 'gm-hidetext', function() { toggleHidePreview(g.id); });
  add((isMuted(g.id) ? '🔔  ' : '🔕  ') + muteMenuLabel(g.id), 'gm-mute', function() { openMuteSheet(g.id); }); // 3219
  add('🚪  ' + (g.kicked ? t('grp_remove_list', 'Quitar de la lista') : t('prof_group_leave', 'Salir del grupo')), 'gm-leave', function() {
    gs.leave(g.id);
    var bi = _bi();
    if (bi && typeof bi.renderContactsList === 'function') bi.renderContactsList();
  }, true);
  add(t('cancel'), 'gm-cancel', function() {});
  box.onclick = function(e) { if (e.target === box) box.remove(); };
  box.appendChild(sheet);
  document.body.appendChild(box);
}

// 3222 (dueño 17-11: «quitamos el botón de grupos de arriba… el botón de agregar puede también servir para crear un grupo, son la
// misma cosa con diferente número de contactos»; y en los ⋮ de cada contacto, «Crear grupo»): ya no hay botón 👥 en la cabecera.
// 26-11 (dueño): el botón redondo de abajo SOLO agrega contactos; «Crear grupo» vive en los ⋮ del contacto, que abren «Nuevo grupo» con él ya elegido (window.NEXO_newGroupWith).
export function installGroupButton() {
  window.NEXO_groupCards = memberCards; // 22-11: para mandar las tarjetas al ponerse al día (group_admin.js)
  window.NEXO_toast = _toast;
  window.NEXO_openGroupSettings = openGroupSettings;
  window.NEXO_groupPhoto = function(gid) { var gs = _groups(); return gs && typeof gs.photoOf === 'function' ? gs.photoOf(gid) : null; }; // G6: lista y cabecera
  installGroupPanel();
  window.NEXO_newGroupWith = function(uuid) { openCreateGroupSheet(uuid); };
}

