/**
 * Bloquear contacto (dueño 24-11): lo de pantalla (la confirmación, el texto de las opciones y la lista de Ajustes). El núcleo
 * (quién está bloqueado, guardar, avisar a la parte nativa) está en bloqueo.js.
 */
import { t } from './i18n.js';
import { openSheet } from './chat_sheet.js';
import { _showInfoToast } from './ui_bits.js';
import { isBlocked, setBlocked } from './bloqueo.js';

function _n(id) { return (id || '').toString().toLowerCase().trim(); }
var NX_RE = /^nx[0-9a-z]{8}$/;

export function blockMenuLabel(nx) { return isBlocked(nx) ? t('block_off', 'Desbloquear') : t('block_on', 'Bloquear'); }

// Confirmación (como WhatsApp): «¿Bloquear a X?» con lo que pasa; desbloquear es directo
export function openBlockSheet(nx, name, done) {
  var id = _n(nx);
  if (!NX_RE.test(id)) return null;
  var who = String(name || '').trim() || id.toUpperCase();
  if (isBlocked(id)) {
    setBlocked(id, false);
    _showInfoToast(t('block_off_done', 'Desbloqueaste a ') + who, 2200);
    if (typeof done === 'function') done(false);
    return null;
  }
  return openSheet('nexo-block-menu', t('block_ask', '¿Bloquear a ') + who + '?',
    t('block_note', 'No recibirás sus mensajes, llamadas ni estados, y no verá tu foto ni tus estados. No se le avisa. En los grupos se le sigue viendo.'), [
    { label: t('block_on', 'Bloquear'), cls: 'chat-block', danger: true, fn: function() {
      setBlocked(id, true);
      _showInfoToast(t('block_on_done', 'Bloqueaste a ') + who, 2200);
      if (typeof done === 'function') done(true);
    } },
    { label: t('chat_cancel', 'Cancelar'), cls: 'mm-cancel', fn: function() {} }
  ]);
}


// En el chat de un bloqueado, en lugar de la caja de escribir: «Bloqueaste a este contacto. Toca para desbloquear.» (como WhatsApp)
export function paintBlockedBar(cid, name) {
  var area = typeof document !== 'undefined' ? document.getElementById('input-area') : null;
  if (!area) return;
  var id = _n(cid), bar = document.getElementById('nx-blocked-bar');
  if (!id || !isBlocked(id)) { area.classList.remove('nx-blocked'); if (bar) bar.remove(); return; }
  area.classList.add('nx-blocked');
  if (!bar) {
    bar = document.createElement('button');
    bar.id = 'nx-blocked-bar';
    bar.type = 'button';
    area.appendChild(bar);
  }
  bar.textContent = t('block_bar', 'Bloqueaste a este contacto. Toca para desbloquear.');
  bar.onclick = function(e) { e.stopPropagation(); openBlockSheet(id, name); };
}

// Ajustes → Seguridad → Privacidad: «Contactos bloqueados» (lista con «Desbloquear» en cada uno)
export function blockedListHtml() {
  return '<div class="nx-sub" style="margin-top:12px;font-weight:700;">' + t('block_list', 'Contactos bloqueados') + '</div><div id="nexo-blocked-list"></div>';
}
export function paintBlockedList(box, ids, nameOf) {
  if (!box) return;
  box.textContent = '';
  if (!ids.length) {
    var none = document.createElement('div');
    none.className = 'nx-sub';
    none.textContent = t('block_none', 'Ninguno. Puedes bloquear a alguien desde su chat o su perfil.');
    box.appendChild(none);
    return;
  }
  ids.forEach(function(nx) {
    var row = document.createElement('div');
    row.className = 'nx-blocked-row';
    var nm = document.createElement('span');
    nm.textContent = (nameOf && nameOf(nx)) || nx.toUpperCase();
    var b = document.createElement('button');
    b.className = 'nx-link';
    b.type = 'button';
    b.textContent = t('block_off', 'Desbloquear');
    b.onclick = function() { openBlockSheet(nx, nm.textContent, function() { paintBlockedList(box, ids.filter(function(x) { return x !== nx; }), nameOf); }); };
    row.appendChild(nm); row.appendChild(b);
    box.appendChild(row);
  });
}
