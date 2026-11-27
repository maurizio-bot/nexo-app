/**
 * 3219 (dueño 17-11, funciones de WhatsApp dentro del chat): las OPCIONES DEL CHAT, como al tocar la cabecera en WhatsApp. Se abren al
 * tocar el círculo del contacto (o del grupo) en la cabecera del chat (#chat-contact-avatar; sin un botón más en la cabecera: el dueño
 * la quiere despejada, 05-11). Hoja con el estilo del menú de un mensaje: «Buscar en el chat», «Mensajes destacados» y «Silenciar
 * notificaciones» / «Activar sonido» (con «Silenciado hasta …» debajo). Pinta también el altavoz tachado de la cabecera.
 */
import { t } from './i18n.js';
import { _getCurrentContactId, _normId } from './chat_format.js';
import { openSheet } from './chat_sheet.js';
import { isMuted, mutedLabel, muteMenuLabel, openMuteSheet, paintHeaderMute } from './chat_mute.js';
import { openStarredSheet } from './chat_star.js';
import { openChatSearch } from './search_ui.js';
import { blockMenuLabel, openBlockSheet, paintBlockedBar } from './bloqueo_ui.js';
import { openFind, openFindGroup, findOn } from './find_ui.js';
import { disappearOf, disappearLabel, openDisappearSheet, installDisappear } from './chat_disappear.js';

function _name() { var n = document.getElementById('chat-contact-name'); return (n && n.value) || ''; }

export function openChatMenu() {
  var cid = _normId(_getCurrentContactId());
  if (!cid) return null;
  var muted = isMuted(cid);
  // 3345 (dueño 25-11, modo multitud): buscar al contacto entre la gente; en un grupo, ver quién está cerca
  var bg = window.bleInterface && window.bleInterface.groups, grp = bg && bg.isGroup && bg.isGroup(cid) ? bg.get(cid) : null;
  var find = !findOn() ? [] : /^nx[0-9a-z]{8}$/.test(cid) ? [{ label: t('find_menu', 'Buscar a {name} entre la gente').replace('{name}', _name()), cls: 'chat-find', fn: function() { openFind(cid, _name()); } }]
    : grp ? [{ label: t('find_grp_menu', '¿Quién del grupo está cerca?'), cls: 'chat-find', fn: function() { openFindGroup(cid, grp.members || [], grp.name || _name()); } }] : [];
  return openSheet('nexo-chat-menu', _name(), '', find.concat([
    { label: t('misc_search_in_chat', 'Buscar en el chat'), cls: 'chat-search', fn: function() { openChatSearch(); } },
    { label: t('star_title', 'Mensajes destacados'), cls: 'chat-starred', fn: function() { openStarredSheet(cid); } },
    { label: t('dsp_title', 'Mensajes temporales'), sub: disappearOf(cid) ? disappearLabel(disappearOf(cid).ttl) : '', cls: 'chat-disappear', fn: function() { setTimeout(function() { openDisappearSheet(cid, openSheet); }, 0); } }, // 3360
    { label: muteMenuLabel(cid), sub: muted ? mutedLabel(cid) : '', cls: muted ? 'chat-unmute' : 'chat-mute', fn: function() { openMuteSheet(cid); } }
  ].concat(/^nx[0-9a-z]{8}$/.test(cid) ? [{ label: blockMenuLabel(cid), cls: 'chat-block', danger: true, fn: function() { openBlockSheet(cid, _name()); } }] : []).concat([ // bloqueo (24-11): solo de un contacto
    { label: t('chat_cancel', 'Cancelar'), cls: 'mm-cancel', fn: function() {} }
  ])));
}

function _paintMute() { paintHeaderMute(_normId(_getCurrentContactId())); }
function _paintBlock() { paintBlockedBar(_normId(_getCurrentContactId()), _name()); }

export function installChatMenu() {
  installDisappear(); // 3360: mensajes temporales (barrido de lo caducado)
  var av = document.getElementById('chat-contact-avatar');
  if (av && !av._nxMenu) {
    av._nxMenu = true;
    av.setAttribute('role', 'button');
    av.setAttribute('aria-label', t('chat_opts', 'Opciones del chat'));
    av.removeAttribute('aria-hidden');
    av.addEventListener('click', function(e) { e.stopPropagation(); openChatMenu(); });
  }
  window.addEventListener('nexo:ble:openChat', function() { setTimeout(_paintMute, 0); setTimeout(_paintBlock, 0); });
  window.addEventListener('nexo:ble:closeChat', function() { paintHeaderMute(''); paintBlockedBar(''); });
  window.addEventListener('nexo:mute', _paintMute);
  window.addEventListener('nexo:block', _paintBlock); // bloqueo (24-11)
}
