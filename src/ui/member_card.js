/**
 * member_card.js (dueño 27-11, aprobado: «como WhatsApp») — en un grupo, tocar el nombre de un miembro (sobre su mensaje o en la lista de
 * personas de «Información») abre su TARJETA: foto, nombre y NEXO ID; si es contacto mío, «Mensaje», «Llamar» e «Info» (su página de
 * información); si no lo es, «No está en tus contactos» y «Agregar» (la solicitud de contacto, como antes en la lista de miembros).
 * PORQUÉ: antes tocar a un miembro abría su chat directo (o solo «Agregar»); la tarjeta deja elegir sin salir del grupo.
 * Vive encima de todo (también de «Información», que es una pantalla completa); atrás o tocar fuera la cierra.
 */
import { t } from './i18n.js';
import { _normId } from './chat_format.js';
import { personAvatar } from './person_avatar.js';
import { sheetRow } from './chat_sheet.js';
import { _getBLEContacts } from './ble_helpers.js';
import { _showInfoToast } from './ui_bits.js';
import { isSelecting } from './msg_select.js';

var NX_RE = /^nx[0-9a-z]{8}$/;
function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
function _el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function _toast(s) { try { _showInfoToast(s, 3200); } catch (e) {} }
function _me() { var b = _bi(); return _normId(b && b.localNexoId); }
export function isContactNx(nx) { try { return _getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; }); } catch (e) { return false; } }
function _nameOf(nx, fallback) {
  try { var c = _getBLEContacts().filter(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; })[0]; if (c && c.name) return c.name; } catch (e) {}
  var gs = _bi() && _bi().groups;
  if (gs && typeof gs.memberName === 'function') { try { return gs.memberName(nx); } catch (e) {} }
  return fallback || nx.toUpperCase();
}
// Cierra las pantallas de encima del chat (Información, Ajustes del grupo y sus hojas) antes de ir a otro chat
function _closePanels() { document.querySelectorAll('.nx-panel').forEach(function(p) { p.remove(); }); }
function _openChat(nx) {
  var bi = _bi(); if (!bi || typeof bi.openChat !== 'function') return Promise.resolve();
  _closePanels();
  return Promise.resolve(bi.openChat(nx)).catch(function() {});
}

export function openMemberCard(nx, name) {
  nx = _normId(nx);
  if (!NX_RE.test(nx) || nx === _me()) return null;
  var old = document.getElementById('nexo-member-card'); if (old) old.remove();
  var contact = isContactNx(nx);
  name = contact ? _nameOf(nx, name) : (name || _nameOf(nx));
  var box = _el('div', 'nx-chat-sheet'); box.id = 'nexo-member-card';
  box.style.zIndex = '2147483647'; // encima de «Información» (pantalla completa)
  var sheet = _el('div', 'nx-chat-sheet-body nx-mcard');
  var close = function() { box.remove(); };
  var av = personAvatar(nx, name, 84); av.classList.add('nx-mcard-av'); sheet.appendChild(av);
  sheet.appendChild(_el('div', 'nx-mcard-name', name));
  sheet.appendChild(_el('div', 'nx-mcard-id', 'NEXO ID: ' + nx.toUpperCase()));
  var row = _el('div', 'nx-mcard-acts');
  function act(cls, icon, label, fn) {
    var b = _el('button', 'nx-mcard-btn ' + cls); b.type = 'button';
    var ic = _el('span', 'nx-mcard-ico'); ic.innerHTML = icon; b.appendChild(ic);
    b.appendChild(_el('span', 'nx-mcard-lbl', label));
    b.addEventListener('click', function(e) { e.stopPropagation(); close(); fn(); });
    row.appendChild(b);
  }
  var SVG = function(p) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; };
  if (contact) {
    act('mcard-msg', SVG('<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.6A8.5 8.5 0 1 1 21 12z"/>'), t('mcard_msg', 'Mensaje'), function() { _openChat(nx); });
    act('mcard-call', SVG('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'), t('call_btn_call_title', 'Llamar'), function() {
      if (typeof window.NEXO_startCall === 'function') window.NEXO_startCall(nx, false);
    });
    act('mcard-info', SVG('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/>'), t('mcard_info', 'Info'), function() {
      _openChat(nx).then(function() { setTimeout(function() { if (typeof window.NEXO_openChatInfo === 'function') window.NEXO_openChatInfo(nx); }, 350); });
    });
    sheet.appendChild(row);
  } else {
    sheet.appendChild(_el('div', 'nx-sheet-note nx-mcard-note', t('grp_not_contact', 'No está en tus contactos.')));
    var add = sheetRow(t('add', 'Agregar'), 'nx-person-add', 'mcard-add gset-mem-add');
    add.addEventListener('click', function(e) {
      e.stopPropagation(); close();
      var bi = _bi(); if (!bi || typeof bi.addByNexoId !== 'function') return;
      Promise.resolve(bi.addByNexoId(nx)).then(function() { _toast(t('grp_req_sent', 'Solicitud enviada')); }, function(err) { _toast((err && err.message) || 'Error'); });
    });
    sheet.appendChild(add);
  }
  box.addEventListener('click', function(e) { if (e.target === box) close(); });
  box.appendChild(sheet);
  document.body.appendChild(box);
  return box;
}

// Tocar el nombre (o el círculo) de quien escribió un mensaje en un grupo
export function installMemberCard() {
  var mc = document.getElementById('messages-container');
  if (!mc || mc._nxMcard) return;
  mc._nxMcard = true;
  mc.addEventListener('click', function(e) {
    var f = e.target && e.target.closest && e.target.closest('.msg-group-from');
    if (!f || !f.dataset || !f.dataset.nx) return;
    if (isSelecting()) return; // seleccionando mensajes: el toque marca la burbuja
    e.stopPropagation(); e.preventDefault();
    var w = f.querySelector('.msg-group-sender');
    openMemberCard(f.dataset.nx, w ? w.textContent : '');
  }, true);
}
