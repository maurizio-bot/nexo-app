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
  'chat-find': '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2"/>', // 3345: buscar entre la gente
  'chat-disappear': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="M9 2h6"/>', // 27-11: mensajes temporales (antes sin icono)
  'chat-block': '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>', // bloquear contacto (24-11)
  'mm-cancel': '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  // B-EST (26-11): los de las demás hojas (grupo, fondo, responder llamada) con el mismo trazo, en vez de emojis
  'nx-open': '<path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.6A8.5 8.5 0 1 1 21 12z"/>',
  'nx-gear': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  'nx-history': '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  'nx-eye': '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/>',
  'nx-eye-off': '<path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.4 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.1 3.9"/><path d="M6.6 6.6A17 17 0 0 0 2.5 12S6 19 12 19a9.6 9.6 0 0 0 4.2-.9"/>',
  'nx-leave': '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  'nx-image': '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 16l-5-5L5 20"/>',
  'nx-palette': '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 9.7C21 5.9 17 3 12 3z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="9.5" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  'nx-share': '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  'nx-trash': '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  'nx-person-add': '<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>',
  'nx-person-x': '<circle cx="10" cy="8" r="4"/><path d="M3 21a7 7 0 0 1 14 0"/><path d="M17 9l5 5M22 9l-5 5"/>',
  'nx-edit': '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'
};
export function sheetSvg(path, size) {
  return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'; // SVG fijo (sin datos)
}

// B-EST (26-11): una fila de hoja suelta (la misma que pone openSheet) para las hojas que arman su propio contenido: icono de trazo
// (clave de SHEET_ICONS) y el texto con textContent. cls: sus clases propias (las que buscan las pruebas y el código).
export function sheetRow(label, icon, cls, danger) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'mm-item' + (cls ? ' ' + cls : '') + (danger ? ' nx-danger' : '');
  if (SHEET_ICONS[icon]) {
    var ic = document.createElement('span');
    ic.className = 'mm-ico';
    ic.innerHTML = sheetSvg(SHEET_ICONS[icon], 20);
    b.appendChild(ic);
  }
  var lb = document.createElement('span');
  lb.className = 'nx-sheet-label';
  lb.textContent = String(label == null ? '' : label);
  b.appendChild(lb);
  return b;
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
