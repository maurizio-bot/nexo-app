/**
 * Dueño 25-11 (captura de la cabecera de un grupo con nombre largo): la cabecera del chat se acomoda a lo que cabe.
 *  1. El nombre nunca se mete debajo de los botones de la derecha (llamada, videollamada, ajustes del grupo: 2 o 3 según el chat):
 *     el hueco de la derecha se mide con los botones que hay (antes era fijo para 2 y con 3 se encimaba).
 *  2. Con el hueco ya medido, main.js (_fitContactName, 22-11) ajusta la letra: si cabe en 2 líneas, tamaño normal; si no, baja de a 1 px.
 *  3. La línea de abajo («6 personas: Roberto, Alex…») se corta con «…» antes de los botones (CSS en nexo_theme.css).
 *  4. En un grupo, tocar esa línea abre la lista de integrantes («Información» del grupo, en su sección de personas).
 */
import { _getCurrentContactId } from './chat_format.js';
import { openChatInfo } from './chat_info.js'; // dueño 27-11: la página «Información» (con la lista de personas)

function $(id) { return document.getElementById(id); }

export function fitChatHead() {
  var hdr = $('chat-header'), info = $('chat-contact-info'), nm = $('chat-contact-name'), act = $('chat-head-actions');
  if (!hdr || !info || !nm) return;
  var right = 12;
  if (act && act.offsetWidth) {
    var hr = hdr.getBoundingClientRect(), ar = act.getBoundingClientRect();
    right = Math.max(12, Math.round(hr.right - ar.left + 8));
  }
  info.style.setProperty('padding-right', right + 'px', 'important');
  if (typeof window.NEXO_fitContactName === 'function') window.NEXO_fitContactName(); // el tamaño de letra lo ajusta main.js (22-11) con el hueco ya medido
}

function _soon() { setTimeout(fitChatHead, 0); setTimeout(fitChatHead, 350); } // los botones de la derecha se ponen un instante después

export function installChatHeadFit() {
  window.addEventListener('nexo:ble:openChat', _soon);
  window.addEventListener('nexo:groups', _soon);
  window.addEventListener('resize', _soon);
  var sub = $('chat-contact-subtitle');
  if (sub && !sub._nxGrp) {
    sub._nxGrp = true;
    sub.addEventListener('click', function(e) {
      var cid = String(_getCurrentContactId() || '').toLowerCase(), bi = window.bleInterface;
      if (!cid || !bi || !bi.groups || !bi.groups.isGroup(cid)) return;
      e.stopPropagation();
      openChatInfo(cid);
      setTimeout(function() { var m = document.querySelector('.gset-member'); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center' }); }, 60);
    });
  }
  if (typeof MutationObserver === 'function') new MutationObserver(_soon).observe($('chat-header') || document.body, { childList: true, subtree: true });
}
