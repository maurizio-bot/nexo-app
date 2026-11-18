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

function _name() { var n = document.getElementById('chat-contact-name'); return (n && n.value) || ''; }

export function openChatMenu() {
  var cid = _normId(_getCurrentContactId());
  if (!cid) return null;
  var muted = isMuted(cid);
  return openSheet('nexo-chat-menu', _name(), '', [
    { label: t('misc_search_in_chat', 'Buscar en el chat'), cls: 'chat-search', fn: function() { openChatSearch(); } },
    { label: t('star_title', 'Mensajes destacados'), cls: 'chat-starred', fn: function() { openStarredSheet(cid); } },
    { label: muteMenuLabel(cid), sub: muted ? mutedLabel(cid) : '', cls: muted ? 'chat-unmute' : 'chat-mute', fn: function() { openMuteSheet(cid); } },
    { label: t('chat_cancel', 'Cancelar'), cls: 'mm-cancel', fn: function() {} }
  ]);
}

function _paintMute() { paintHeaderMute(_normId(_getCurrentContactId())); }

export function installChatMenu() {
  var av = document.getElementById('chat-contact-avatar');
  if (av && !av._nxMenu) {
    av._nxMenu = true;
    av.setAttribute('role', 'button');
    av.setAttribute('aria-label', t('chat_opts', 'Opciones del chat'));
    av.removeAttribute('aria-hidden');
    av.addEventListener('click', function(e) { e.stopPropagation(); openChatMenu(); });
  }
  window.addEventListener('nexo:ble:openChat', function() { setTimeout(_paintMute, 0); });
  window.addEventListener('nexo:ble:closeChat', function() { paintHeaderMute(''); });
  window.addEventListener('nexo:mute', _paintMute);
}
