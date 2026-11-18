/**
 * 3219 (dueño 17-11: «todas las funciones de WhatsApp… de forma práctica y cómoda, ergonómica y estética»): SILENCIAR un chat o un
 * grupo — 8 horas, 1 semana o siempre — y «Activar sonido». Un chat silenciado no suena, no vibra ni avisa: con la app en segundo
 * plano lo calla notify.js (opción muted de main.js) y con la app congelada en segundo plano o CERRADA lo calla la parte nativa
 * (setMutedChats → MutedChats.kt: Bluetooth en PluginBackground y internet en NetBgHome, también sin la app). Los mensajes llegan
 * igual y cuentan como no leídos (el número en gris en la lista). Las LLAMADAS sí suenan, como en WhatsApp: solo se callan mensajes.
 * Es solo de este teléfono (no viaja al otro). Se guarda cifrado (archivo del vault vía plugin, AtRestStore: nexo_muted.json).
 * Dónde se elige: tocar el círculo del contacto en la cabecera del chat (chat_menu.js), el ⋮ de un contacto en la lista (ble_ui.js)
 * y el ⋮ de un grupo (groups_ui.js). Un altavoz tachado discreto junto al nombre en la lista y en la cabecera del chat.
 */
import { t, getLang } from './i18n.js';
import { openSheet } from './chat_sheet.js';
import { _showInfoToast } from './ui_bits.js';

export var MUTE_FILE = 'nexo_muted.json';
export var MUTE_8H_MS = 8 * 3600000;
export var MUTE_WEEK_MS = 7 * 24 * 3600000;
var ID_RE = /^(nx|gr)[0-9a-z]{8}$/;
// El altavoz tachado (trazo, como los iconos de los menús)
var MUTE_SVG_PATH = '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M23 9l-6 6"/><path d="M17 9l6 6"/>';

var _m = null;        // chat (NEXO ID o id de grupo) → hasta cuándo (ms); 0 = siempre
var _timer = null;    // repintar cuando venza el silencio más cercano

function _n(id) { return (id || '').toString().toLowerCase().trim(); }
function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _all() { if (!_m) _m = {}; return _m; }
function _alive(until, now) { return until === 0 || (typeof until === 'number' && until > now); }

// Hasta cuándo está silenciado (ms; 0 = siempre) o null si no lo está
export function mutedUntil(chatId) {
  var u = _all()[_n(chatId)];
  return (u != null && _alive(u, Date.now())) ? u : null;
}
export function isMuted(chatId) { return mutedUntil(chatId) !== null; }

function _clean() {
  var m = _all(), now = Date.now();
  Object.keys(m).forEach(function(k) { if (!ID_RE.test(k) || !_alive(m[k], now)) delete m[k]; });
}

// Lo que sabe la parte nativa (para callar los avisos con la app congelada o cerrada): [{id, until}]
function _pushNative() {
  var p = _plugin();
  if (!p || typeof p.setMutedChats !== 'function') return;
  var m = _all();
  try { Promise.resolve(p.setMutedChats({ chats: Object.keys(m).map(function(k) { return { id: k, until: m[k] }; }) })).catch(function() {}); } catch (e) {}
}

function _save() {
  _clean();
  var p = _plugin();
  if (p && typeof p.saveToFile === 'function') {
    try { Promise.resolve(p.saveToFile({ filename: MUTE_FILE, content: JSON.stringify({ muted: _all(), savedAt: Date.now() }) })).catch(function() {}); } catch (e) {}
  }
  _pushNative();
}

// Al vencer un silencio (8 h, 1 semana) se quita el icono de la lista y de la cabecera (la parte nativa mira la hora ella sola)
function _schedule() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  var m = _all(), now = Date.now(), next = 0;
  Object.keys(m).forEach(function(k) { if (m[k] > now && (!next || m[k] < next)) next = m[k]; });
  if (!next) return;
  _timer = setTimeout(function() { _timer = null; _clean(); _changed(''); _schedule(); }, Math.min(next - now + 500, 2147483000));
}

function _changed(id) {
  try { window.dispatchEvent(new CustomEvent('nexo:mute', { detail: { id: id } })); } catch (e) {}
  var bi = typeof window !== 'undefined' ? window.bleInterface : null;
  if (bi && typeof bi.renderContactsList === 'function') { try { bi.renderContactsList(); } catch (e) {} }
}

// ms: null (o false) = quitar el silencio; 0 = siempre; > 0 = durante ese tiempo
export function setMuted(chatId, ms) {
  var id = _n(chatId);
  if (!ID_RE.test(id)) return false;
  if (ms === null || ms === false || ms === undefined || ms < 0) delete _all()[id];
  else _all()[id] = ms === 0 ? 0 : Date.now() + ms;
  _save();
  _schedule();
  console.log('[MUTE] ' + id + (isMuted(id) ? ' silenciado ' + (ms === 0 ? 'siempre' : 'durante ' + Math.round(ms / 60000) + ' min') : ': sonido activado'));
  _changed(id);
  return isMuted(id);
}

export function loadMuted() {
  var p = _plugin();
  if (!p || typeof p.loadFromFile !== 'function') { _pushNative(); return Promise.resolve(); }
  try {
    return Promise.resolve(p.loadFromFile({ filename: MUTE_FILE })).then(function(r) {
      if (r && r.exists && r.content) {
        try {
          var d = JSON.parse(r.content), src = d && d.muted;
          if (src && typeof src === 'object') Object.keys(src).forEach(function(k) { var u = Number(src[k]); if (isFinite(u) && u >= 0 && !(_n(k) in _all())) _all()[_n(k)] = u; });
        } catch (e) {}
      }
      _clean(); _pushNative(); _schedule(); _changed('');
    }).catch(function() { _pushNative(); });
  } catch (e) { _pushNative(); return Promise.resolve(); }
}

// «Silenciado hasta el 18/11, 22:30» / «Silenciado»
export function mutedLabel(chatId) {
  var u = mutedUntil(chatId);
  if (u === null) return '';
  if (u === 0) return t('mute_forever', 'Silenciado');
  var d = new Date(u), when, lang = getLang();
  try { when = d.toLocaleString(lang === 'pt' ? 'pt-BR' : lang, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { when = d.toLocaleString(); }
  return t('mute_until', 'Silenciado hasta el ') + when;
}

// Hoja «Silenciar notificaciones» (8 horas / 1 semana / Siempre). Con el chat ya silenciado, quita el silencio.
export function openMuteSheet(chatId) {
  var id = _n(chatId);
  if (!ID_RE.test(id)) return null;
  if (isMuted(id)) { setMuted(id, null); _showInfoToast(t('mute_off_done', 'Sonido activado'), 1800); return null; }
  var pick = function(ms) { return function() { setMuted(id, ms); _showInfoToast(t('mute_on_done', 'Chat silenciado'), 1800); }; };
  return openSheet('nexo-mute-menu', t('mute_title', 'Silenciar notificaciones'), t('mute_note', 'No sonará ni avisará de sus mensajes. Las llamadas sí suenan.'), [
    { label: t('mute_8h', '8 horas'), cls: 'mute-8h', fn: pick(MUTE_8H_MS) },
    { label: t('mute_week', '1 semana'), cls: 'mute-week', fn: pick(MUTE_WEEK_MS) },
    { label: t('mute_always', 'Siempre'), cls: 'mute-always', fn: pick(0) },
    { label: t('chat_cancel', 'Cancelar'), cls: 'mm-cancel', fn: function() {} }
  ]);
}
// Texto de la opción en los menús (⋮ de la lista y del grupo, y el de la cabecera del chat)
export function muteMenuLabel(chatId) { return isMuted(chatId) ? t('mute_off', 'Activar sonido') : t('mute_title', 'Silenciar notificaciones'); }

// El altavoz tachado (span con SVG fijo: sin datos)
export function muteIcon(size) {
  var s = document.createElement('span');
  s.className = 'nx-mute-ico';
  s.setAttribute('aria-label', t('mute_forever', 'Silenciado'));
  s.innerHTML = '<svg viewBox="0 0 24 24" width="' + (size || 14) + '" height="' + (size || 14) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + MUTE_SVG_PATH + '</svg>';
  return s;
}

// Fila de la lista de Contactos (ble_ui.renderContactsList): el icono junto al nombre y el número de no leídos en gris
export function markMutedRow(row, chatId) {
  if (!row || !isMuted(chatId)) return;
  var nm = row.querySelector('.ble-contact-name');
  if (nm && !nm.querySelector('.nx-mute-ico')) {
    var txt = document.createElement('span');
    txt.className = 'nx-mute-name';
    while (nm.firstChild) txt.appendChild(nm.firstChild);
    nm.classList.add('nx-muted-name');
    nm.appendChild(txt);
    nm.appendChild(muteIcon(14));
  }
  var b = row.querySelector('.ble-unread-badge');
  if (b) b.classList.add('nx-muted-badge');
}

// Cabecera del chat: el icono delante del subtítulo («🔇 En línea · ᛒ»)
export function paintHeaderMute(chatId) {
  var sub = document.getElementById('chat-contact-subtitle');
  if (!sub || !sub.parentNode) return;
  var row = document.getElementById('chat-sub-row');
  if (!row) {
    row = document.createElement('div');
    row.id = 'chat-sub-row';
    sub.parentNode.insertBefore(row, sub);
    row.appendChild(sub);
  }
  var ico = document.getElementById('chat-mute-ico');
  if (chatId && isMuted(chatId)) {
    if (!ico) { ico = muteIcon(13); ico.id = 'chat-mute-ico'; row.insertBefore(ico, sub); }
  } else if (ico) ico.remove();
}

try { if (typeof window !== 'undefined') window.__nexoMute = { set: setMuted, until: mutedUntil, isMuted: isMuted }; } catch (e) {} // gancho de pruebas (silenciar.js)
