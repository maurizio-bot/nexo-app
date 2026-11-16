/**
 * NEXO — Enlaces que se tocan en los mensajes (3161, dueño 16-11: «compartir de forma práctica vídeos de TikTok, Facebook, Instagram
 * (y YouTube) en el chat»). Antes un enlace llegaba como texto simple. Ahora:
 *  - los http/https de un texto se pintan como enlace (nodos DOM, nunca innerHTML: el texto viene de otro teléfono);
 *  - si hay uno de TikTok, Instagram, Facebook (fb.watch) o YouTube (youtu.be), debajo una tarjeta con el nombre del sitio, su color e
 *    inicial y el dominio. NO se descarga nada de internet para la tarjeta (ni vista previa ni logo): privacidad;
 *  - tocar el enlace o la tarjeta lo abre FUERA de NEXO (openUrl nativo: Intent.ACTION_VIEW → la app de TikTok/Instagram/… si está
 *    instalada; si no, el navegador). Para volver, el «atrás» de Android.
 * Seguridad: solo http/https (nunca javascript:, intent:, file:, content:…), sin «usuario@» en la dirección (engaño típico:
 * https://www.tiktok.com@malo.com) y a lo nativo va la URL ya normalizada por el navegador (la misma que decide el dominio que se ve).
 * El texto de la tarjeta va por CSS (attr) para que el texto de la burbuja (.msg-content) siga siendo exactamente el mensaje: lo leen
 * la búsqueda del chat, «responder» desde la burbuja y las pruebas (igual que la inicial de _pickAvatar).
 */
import { t } from './i18n.js';
import { _showInfoToast } from './ui_bits.js';

var MAX_URL = 2048;      // más largo: se deja como texto
var MAX_LINKS = 30;      // enlaces tocables por mensaje (el resto, texto)
var URL_RE = /\bhttps?:\/\/[^\s<>"'`\\\u0000-\u001f\u007f]+/gi;

// Sitios con tarjeta: dominio y sus subdominios (vm.tiktok.com, m.youtube.com…). Colores propios del sitio, sin logos.
var SITES = [
  { k: 'tiktok', name: 'TikTok', ini: 'T', hosts: ['tiktok.com'] },
  { k: 'instagram', name: 'Instagram', ini: 'I', hosts: ['instagram.com', 'instagr.am'] },
  { k: 'facebook', name: 'Facebook', ini: 'F', hosts: ['facebook.com', 'fb.watch', 'fb.com', 'fb.me'] },
  { k: 'youtube', name: 'YouTube', ini: 'Y', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] }
];

/** URL http/https válida (objeto URL) o null. Rechaza otros esquemas, sin dominio, con «usuario@» o demasiado larga. */
export function safeHttpUrl(s) {
  if (typeof s !== 'string' || !s || s.length > MAX_URL || !/^https?:\/\//i.test(s)) return null;
  var u;
  try { u = new URL(s); } catch (e) { return null; }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname || u.username || u.password) return null;
  return u;
}

/** El sitio con tarjeta de un dominio (o null) */
export function siteOf(hostname) {
  var h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  for (var i = 0; i < SITES.length; i++) {
    for (var j = 0; j < SITES[i].hosts.length; j++) {
      var d = SITES[i].hosts[j];
      if (h === d || h.slice(-(d.length + 1)) === '.' + d) return SITES[i];
    }
  }
  return null;
}

// Quita del final lo que casi siempre es de la frase: «mira https://x.com/a.», «(https://x.com)», «https://x.com…», un emoji pegado
function _trimTail(u) {
  for (;;) {
    var c = u.charAt(u.length - 1);
    if (!c) return u;
    if ('.,;:!?¡¿»«"\'…'.indexOf(c) >= 0) { u = u.slice(0, -1); continue; }
    var pairs = { ')': '(', ']': '[', '}': '{' };
    if (pairs[c] && u.split(pairs[c]).length < u.split(c).length) { u = u.slice(0, -1); continue; }
    try {
      var last = Array.from(u).pop();
      if (/\p{Extended_Pictographic}/u.test(last)) { u = u.slice(0, u.length - last.length); continue; }
    } catch (e) {}
    return u;
  }
}

/** Enlaces de un texto: [{ start, end, url (normalizada), site }]. Solo http/https bien formados. */
export function findLinks(text) {
  var s = String(text == null ? '' : text), out = [], m;
  if (s.indexOf('://') < 0) return out;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(s)) && out.length < MAX_LINKS) {
    var raw = _trimTail(m[0]);
    var u = safeHttpUrl(raw);
    if (!u) continue;
    out.push({ start: m.index, end: m.index + raw.length, url: u.href, host: u.hostname.replace(/^www\./, ''), site: siteOf(u.hostname) });
  }
  return out;
}

// Lo pinta todo como texto: el enlace es un <a> con href ya validado; nada del remitente se interpreta como HTML
function _anchor(cls, url) {
  var a = document.createElement('a');
  a.className = cls;
  a.href = url;
  a.rel = 'noopener noreferrer nofollow';
  a.referrerPolicy = 'no-referrer';
  a.draggable = false;
  a.addEventListener('click', function(e) {
    e.preventDefault();      // el WebView no navega: se abre fuera
    e.stopPropagation();
    openExternal(url);
  });
  return a;
}

function _card(link) {
  var s = link.site;
  var a = _anchor('nx-link-card nx-site-' + s.k, link.url);
  a.setAttribute('data-site', s.name);
  var label = t('link_open_in', 'Abrir en {site}').replace(/\{site\}/g, s.name) + ' · ' + link.host;
  a.setAttribute('aria-label', label);
  a.title = label;
  var ini = document.createElement('span');
  ini.className = 'nx-lc-ini';
  ini.setAttribute('data-t', s.ini);
  var txt = document.createElement('span');
  txt.className = 'nx-lc-txt';
  var nm = document.createElement('span');
  nm.className = 'nx-lc-name';
  nm.setAttribute('data-t', s.name);
  var host = document.createElement('span');
  host.className = 'nx-lc-host';
  host.setAttribute('data-t', link.host);
  txt.appendChild(nm); txt.appendChild(host);
  var go = document.createElement('span');
  go.className = 'nx-lc-go';
  a.appendChild(ini); a.appendChild(txt); a.appendChild(go);
  return a;
}

/**
 * Pinta `text` en `el` con sus enlaces tocables y, si alguno es de un sitio con tarjeta, la tarjeta del primero debajo.
 * Devuelve false (y no toca `el`) si el texto no tiene ningún enlace: el que llama lo pinta como siempre (textContent).
 */
export function paintTextWithLinks(el, text) {
  var s = String(text == null ? '' : text);
  var links = findLinks(s);
  if (!links.length) return false;
  var pos = 0, card = null;
  links.forEach(function(l) {
    if (l.start > pos) el.appendChild(document.createTextNode(s.slice(pos, l.start)));
    var a = _anchor('nx-link', l.url);
    a.textContent = s.slice(l.start, l.end);
    el.appendChild(a);
    pos = l.end;
    if (!card && l.site) card = l;
  });
  if (pos < s.length) el.appendChild(document.createTextNode(s.slice(pos)));
  if (card) el.appendChild(_card(card));
  return true;
}

/** Abre un enlace http/https FUERA de NEXO (nativo openUrl; sin él —navegador de escritorio—, una ventana nueva). */
export function openExternal(url) {
  var u = safeHttpUrl(String(url || ''));
  if (!u) return Promise.resolve(false);
  var fail = function() { _showInfoToast(t('link_open_fail', 'No se pudo abrir el enlace'), 2500); return false; };
  var pl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  if (pl && typeof pl.openUrl === 'function') {
    return Promise.resolve(pl.openUrl({ url: u.href })).then(function(r) { return (r && r.opened === false) ? fail() : true; }, fail);
  }
  try { window.open(u.href, '_blank', 'noopener'); return Promise.resolve(true); } catch (e) { return Promise.resolve(fail()); }
}
