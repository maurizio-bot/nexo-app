/**
 * groups_ui.js v1.0 (ronda 2758, plan del dueño punto 14) — Pantallas de los grupos (la lógica está en groups.js):
 * botón 👥 en la cabecera para crear un grupo (nombre + elegir contactos), abrir el chat de un grupo y su menú
 * (miembros y salir del grupo).
 */
import { _contactsStyles } from './share_contacts.js';
import { ratchetPeerBundle } from '../vault/e2e_ratchet.js';
import { _normId } from './chat_format.js';
import { vaultLoadContacts } from '../vault/vault_manager.js';
import { _renderMessage } from './render.js';
import { _showInfoToast } from './ui_bits.js';

function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _groups() { var b = _bi(); return b && b.groups; }
function _toast(t) { try { _showInfoToast(t, 3000); } catch (e) { console.log('[GROUP] ' + t); } }

// Texto de la cabecera: "3 personas: Ana, Luis, tú"
export function groupSubtitle(g) {
  var gs = _groups(), me = _normId(_bi() && _bi().localNexoId);
  if (!g || !gs) return '';
  var names = g.members.map(function(nx) { return nx === me ? 'tú' : gs.memberName(nx); });
  return g.members.length + ' personas: ' + names.join(', ');
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

// Hoja para crear un grupo: nombre y contactos
export function openCreateGroupSheet() {
  var gs = _groups();
  if (!gs) return;
  _contactsStyles();
  var all = (vaultLoadContacts() || []).filter(function(c) { return /^nx[0-9a-z]{8}$/.test(_normId(c.nexoId || c.deviceUUID)); });
  var old = document.getElementById('nexo-group-sheet');
  if (old) old.remove();
  var sheet = document.createElement('div');
  sheet.id = 'nexo-group-sheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0a0a15;color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;';
  sheet.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
    '<button id="nexo-group-cancel" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:18px;padding:8px 14px;font-size:14px;">Cancelar</button>' +
    '<div style="font-size:18px;font-weight:700;">Nuevo grupo</div><div style="width:70px"></div></div>' +
    '<input id="nexo-group-name" maxlength="60" placeholder="Nombre del grupo" style="background:rgba(255,255,255,0.08);border:none;border-radius:10px;padding:12px;color:#fff;font-size:16px;margin-bottom:8px;">' +
    '<div style="font-size:13px;opacity:0.7;margin:4px 2px 6px;">Elige quién está en el grupo</div>' +
    '<div id="nexo-group-list" style="flex:1;overflow-y:auto;"></div>' +
    '<button id="nexo-group-create" disabled style="background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:12px;padding:14px;font-size:16px;font-weight:600;margin-top:8px;opacity:0.5;">Crear grupo</button>';
  document.body.appendChild(sheet);
  var listEl = sheet.querySelector('#nexo-group-list'), btn = sheet.querySelector('#nexo-group-create'), nameEl = sheet.querySelector('#nexo-group-name');
  var chosen = {};
  function refresh() {
    var n = Object.keys(chosen).length;
    var ok = n > 0 && nameEl.value.trim().length > 0;
    btn.disabled = !ok; btn.style.opacity = ok ? '1' : '0.5';
    btn.textContent = n ? 'Crear grupo (' + (n + 1) + ' personas)' : 'Crear grupo';
  }
  if (!all.length) listEl.innerHTML = '<div style="opacity:0.7;padding:16px 4px;">Aún no tienes contactos.</div>';
  all.forEach(function(c) {
    var id = _normId(c.nexoId || c.deviceUUID);
    var row = document.createElement('label');
    row.className = 'nexo-pick-row';
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.nx = id;
    var nm = document.createElement('div'); nm.textContent = c.name || id.toUpperCase();
    row.appendChild(cb); row.appendChild(nm);
    cb.addEventListener('change', function() { if (cb.checked) chosen[id] = true; else delete chosen[id]; refresh(); });
    listEl.appendChild(row);
  });
  nameEl.addEventListener('input', refresh);
  sheet.querySelector('#nexo-group-cancel').onclick = function() { sheet.remove(); };
  btn.onclick = function() {
    var g;
    try { g = gs.create(nameEl.value, Object.keys(chosen)); } catch (e) { _toast(e.message); return; }
    sheet.remove();
    var bi = _bi();
    if (bi && typeof bi.renderContactsList === 'function') bi.renderContactsList();
    openGroupChat(g.id);
    // Primer mensaje: así el grupo aparece en los teléfonos de todos, con las tarjetas de los miembros
    sendGroupText(g.id, JSON.stringify({ type: 'nexo_txt', t: '👥 Creó el grupo «' + g.name + '»' }), '👥 Creó el grupo', null, memberCards(g));
  };
  setTimeout(function() { try { nameEl.focus(); } catch (e) {} }, 50);
}

// Mandar un texto al grupo desde la app (burbuja propia, último mensaje y envío a cada miembro)
export function sendGroupText(gid, wire, plain, msgId, cards) {
  var gs = _groups(), bi = _bi();
  if (!gs || !gs.isGroup(gid)) return null;
  msgId = msgId || ('gm' + Date.now() + Math.random().toString(36).substr(2, 6));
  var seq = bi && typeof bi.getNextSeq === 'function' ? bi.getNextSeq() : 0;
  var vm = { msgId: msgId, messageId: msgId, contactNexoId: gid, content: wire, _own: true, status: 'sending', timestamp: Date.now(), seq: seq };
  // Se dibuja si el chat del grupo está abierto y se guarda en su historial
  _renderMessage(vm);
  if (bi && typeof bi.noteContactMessage === 'function') bi.noteContactMessage(gid, String(plain || '').substring(0, 50), vm.timestamp);
  gs.sendText(gid, wire, msgId, seq, null, cards);
  return msgId;
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
  add('💬  Abrir', 'gm-open', function() { openGroupChat(g.id); });
  add('🚪  Salir del grupo', 'gm-leave', function() {
    gs.leave(g.id);
    var bi = _bi();
    if (bi && typeof bi.renderContactsList === 'function') bi.renderContactsList();
  }, true);
  add('Cancelar', 'gm-cancel', function() {});
  box.onclick = function(e) { if (e.target === box) box.remove(); };
  box.appendChild(sheet);
  document.body.appendChild(box);
}

// Botón 👥 en la cabecera de la pantalla principal
export function installGroupButton() {
  var header = document.getElementById('main-header');
  if (!header || document.getElementById('nexo-new-group-btn')) return;
  var b = document.createElement('button');
  b.id = 'nexo-new-group-btn';
  b.title = 'Nuevo grupo';
  b.textContent = '👥';
  b.style.cssText = 'position:absolute;right:14px;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;font-size:20px;cursor:pointer;z-index:5;';
  if (getComputedStyle(header).position === 'static') header.style.position = 'relative';
  b.addEventListener('click', function(e) { e.stopPropagation(); openCreateGroupSheet(); });
  header.appendChild(b);
}
