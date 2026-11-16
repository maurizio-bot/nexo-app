/**
 * NEXO — El círculo de una persona, IGUAL en toda la app (3140, dueño 16-11: «¿por qué la pantalla de agregar contactos no tiene el
 * circulito de colores de perfil como mi pantalla de Contactos?»). Es exactamente el de la lista de Contactos (ble_ui.js): clase
 * .ble-contact-avatar + uno de los 8 degradados .ble-gradient-N según el NEXO ID, la inicial (_getInitials) y, si la hay, su foto
 * (paintAvatar). Úsalo en cualquier fila de personas (agregar, solicitudes, nuevo grupo, compartir, reenviar, estados, cabeceras).
 *   personAvatar(nx, name, size)      → <div> listo para meter en el DOM
 *   personAvatarHtml(nx, name, size)  → el mismo círculo como texto (para plantillas con innerHTML); después paintPersonAvatars(raíz)
 *                                      pone las fotos de los que tengan
 */
import { _getGradientForUUID, _getInitials, _normId } from './ble_helpers.js';
import { paintAvatar } from './avatar.js';

var NX_RE = /^nx[0-9a-z]{8}$/;

function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function _sizeStyle(size) {
  var n = Number(size) || 0;
  if (!n) return '';
  return 'width:' + n + 'px;height:' + n + 'px;min-width:' + n + 'px;font-size:' + Math.max(10, Math.round(n * 0.35)) + 'px;flex-shrink:0;';
}

export function personAvatar(nx, name, size) {
  var id = _normId(nx || '');
  var el = document.createElement('div');
  el.className = 'ble-contact-avatar nx-person-av ' + _getGradientForUUID(id || String(name || ''));
  el.textContent = _getInitials(name || id || '');
  var st = _sizeStyle(size);
  if (st) el.style.cssText = st;
  if (NX_RE.test(id)) { el.setAttribute('data-nx', id); try { paintAvatar(el, id); } catch (e) {} }
  return el;
}

export function personAvatarHtml(nx, name, size) {
  var id = _normId(nx || '');
  return '<div class="ble-contact-avatar nx-person-av ' + _getGradientForUUID(id || String(name || '')) + '"' +
    (NX_RE.test(id) ? ' data-nx="' + id + '"' : '') + (size ? ' style="' + _sizeStyle(size) + '"' : '') + '>' + _esc(_getInitials(name || id || '')) + '</div>';
}

// Pone la foto de perfil en los círculos hechos con personAvatarHtml (los que tengan foto)
export function paintPersonAvatars(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  Array.prototype.forEach.call(root.querySelectorAll('.nx-person-av[data-nx]'), function(el) {
    try { paintAvatar(el, el.getAttribute('data-nx')); } catch (e) {}
  });
}
