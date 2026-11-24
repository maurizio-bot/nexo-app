/**
 * 3219: hoja de opciones que sube desde abajo, con el MISMO estilo que el menú de un mensaje (chat_actions._openMsgMenu): fondo oscuro
 * translúcido, hoja de cristal con su asa, filas .mm-item con un icono de trazo (blanco, grosor 2) y el texto. La usan «Silenciar
 * notificaciones» (chat_mute.js) y las opciones del chat (chat_menu.js). Todo con textContent (nombres y textos que vienen de otros
 * teléfonos nunca van como HTML); los SVG son fijos.
 */

// Iconos de trazo (24×24) por clase de la opción
export var SHEET_ICONS = {
  'mute-8h': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'mute-week': '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  'mute-always': '<path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A17.9 17.9 0 0 1 18 8"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M2 2l20 20"/>',
  'chat-mute': '<path d="M13.7 21a2 2 0 0 1-3.4 0"/><path d="M18.6 13A17.9 17.9 0 0 1 18 8"/><path d="M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.3-5"/><path d="M2 2l20 20"/>',
  'chat-unmute': '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  'chat-starred': '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  'chat-search': '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  'chat-block': '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>', // bloquear contacto (24-11)
  'mm-cancel': '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>'
};
export function sheetSvg(path, size) {
  return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'; // SVG fijo (sin datos)
}

// id: id del fondo (una sola a la vez); title/note: texto (o vacío); items: [{ label, cls, fn, danger }]
export function openSheet(id, title, note, items) {
  var old = document.getElementById(id);
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = id;
  box.className = 'nx-chat-sheet';
  var sheet = document.createElement('div');
  sheet.className = 'nx-chat-sheet-body';
  var close = function() { box.remove(); };
  if (title) {
    var h = document.createElement('div');
    h.className = 'nx-sheet-title';
    h.textContent = title;
    sheet.appendChild(h);
  }
  if (note) {
    var n = document.createElement('div');
    n.className = 'nx-sheet-note';
    n.textContent = note;
    sheet.appendChild(n);
  }
  (items || []).forEach(function(it) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mm-item ' + it.cls + (it.danger ? ' nx-danger' : '');
    var path = SHEET_ICONS[it.icon || it.cls];
    if (path) {
      var ic = document.createElement('span');
      ic.className = 'mm-ico';
      ic.innerHTML = sheetSvg(path, 20);
      b.appendChild(ic);
    }
    var lb = document.createElement('span');
    lb.className = 'nx-sheet-label';
    lb.textContent = String(it.label || '');
    b.appendChild(lb);
    if (it.sub) {
      var sb = document.createElement('span');
      sb.className = 'nx-sheet-sub';
      sb.textContent = it.sub;
      lb.appendChild(sb);
    }
    b.onclick = function(e) { e.stopPropagation(); close(); if (typeof it.fn === 'function') it.fn(); };
    sheet.appendChild(b);
  });
  box.onclick = function(e) { if (e.target === box) close(); };
  box.appendChild(sheet);
  document.body.appendChild(box);
  return box; // (el gesto «atrás» la cierra por su id: chat_nav.js)
}
