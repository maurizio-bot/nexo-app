/**
 * NEXO — Vista previa REAL de los enlaces (COLA 31, decidido por el dueño 23-11: «real e imposible de falsificar; que el sitio no vea
 * ni a quien manda ni a quien recibe; NEXO no puede servir para dañar desde dentro»).
 *  - La baja ESTE teléfono (el que recibe), directo del sitio y POR TOR, en nativo (linkPreview, PluginLinkPreview.kt): la WebView no
 *    puede (CORS) y así el sitio no ve la IP. NADA de lo que mande el emisor se usa: solo la URL que está en el texto del mensaje.
 *  - Solo título + imagen; la imagen llega ya recomprimida por el nativo (JPEG pequeño) y aquí se vuelve a validar (forma y tope).
 *  - Sin internet, Tor sin arrancar o el sitio caído: se queda la tarjeta segura (logo del sitio + dominio real) y la vista previa
 *    aparece sola al volver la red (onNetChange / «online»). Si el sitio rechaza Tor (tras otro circuito): tarjeta segura.
 *  - Redirección a OTRO dominio: no hay vista previa; la tarjeta lo avisa y abrir pide confirmación. Dominio con letras de otro
 *    alfabeto (punycode «xn--»): abrir pide confirmación mostrando cómo se lee. Nunca una vista inventada.
 * Todo se pinta con nodos DOM y atributos (data-t + ::before): el texto de la burbuja sigue siendo exactamente el mensaje.
 */
import { t } from './i18n.js';

// Qué enlaces tienen vista previa: todos los https (dueño 23-11); solo de mensajes propios o de contactos (links.js, chat_actions.js).
export var PREVIEW_ANY_SITE = true;   // dueño 23-11: vista previa para TODOS los sitios (solo de mensajes propios o de contactos: links.js)
var MAX_CACHE = 80, MAX_RUN = 2, MAX_QUEUE = 40;
export var IMG_MAX = 120000;              // caracteres del data: (el nativo entrega ≤ 64 KB → ~86 000)
var MAX_TITLE = 200;
var AGAIN_MS = { red: 60000, tor: 60000, offline: 60000, rechaza: 30 * 60000, sin_datos: 6 * 3600000, invalido: Infinity, redirige: Infinity, ok: Infinity };
var STATES = Object.keys(AGAIN_MS);

var cache = new Map();   // url → { st, title, image, to, at }
var queue = [], running = 0, listening = false;
var inflight = new Set();

function _plugin() {
  var pl = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  return pl && typeof pl.linkPreview === 'function' ? pl : null;
}

/** Texto para enseñar: sin controles, marcas de dirección ni invisibles; espacios juntos; ≤ MAX_TITLE */
export function cleanTitle(s) {
  if (typeof s !== 'string') return '';
  var c = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿؜￹-￻]/g, ' ').replace(/\s+/g, ' ').trim();
  var a = Array.from(c);
  return a.length > MAX_TITLE ? a.slice(0, MAX_TITLE).join('') : c;
}
var IMG_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
var HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;

/** Lo que dice el nativo, revisado: estado conocido, título limpio, imagen solo JPEG en base64 y con tope, dominio bien formado. */
export function sanitize(res) {
  var r = res && typeof res === 'object' ? res : {};
  var st = STATES.indexOf(r.status) >= 0 ? r.status : 'red';
  var out = { st: st, title: '', image: '', to: '', at: Date.now() };
  if (st === 'ok') {
    out.title = cleanTitle(r.title);
    if (!out.title) { out.st = 'sin_datos'; return out; }      // sin título no hay vista previa (nunca una inventada)
    if (typeof r.image === 'string' && r.image.length <= IMG_MAX && IMG_RE.test(r.image)) out.image = r.image;
  }
  if (st === 'redirige') { var to = String(r.to || '').toLowerCase(); out.to = HOST_RE.test(to) ? to : ''; }
  return out;
}

// ===== Punycode (RFC 3492, solo decodificar) para enseñar cómo se LEE un dominio «xn--» =====
function _adapt(d, num, first) { d = first ? Math.floor(d / 700) : d >> 1; d += Math.floor(d / num); var k = 0; while (d > 455) { d = Math.floor(d / 35); k += 36; } return k + Math.floor(36 * d / (d + 38)); }
export function punyDecode(s) {
  if (!/^[a-z0-9-]+$/.test(s)) return null;
  var n = 128, i = 0, bias = 72, out = [], b = s.lastIndexOf('-'), p = 0;
  if (b > 0) { for (; p < b; p++) out.push(s.charCodeAt(p)); p = b + 1; } else if (b === 0) p = 1;
  while (p < s.length) {
    var old = i, w = 1;
    for (var k = 36; ; k += 36) {
      if (p >= s.length) return null;
      var c = s.charCodeAt(p++), d = c <= 57 ? c - 22 : c - 97;
      if (d < 0 || d >= 36) return null;
      i += d * w;
      var tt = k <= bias ? 1 : (k >= bias + 26 ? 26 : k - bias);
      if (d < tt) break;
      w *= 36 - tt;
      if (w > 1e12) return null;
    }
    bias = _adapt(i - old, out.length + 1, old === 0);
    n += Math.floor(i / (out.length + 1)); i %= out.length + 1;
    if (n > 0x10ffff) return null;
    out.splice(i++, 0, n);
  }
  try { return String.fromCodePoint.apply(null, out); } catch (e) { return null; }
}

/** ¿El dominio usa letras de otro alfabeto (punycode)? → { shown: cómo se lee } o null */
export function lookalike(hostname) {
  var h = String(hostname || '').toLowerCase();
  if (h.indexOf('xn--') < 0) return null;
  var shown = h.split('.').map(function(l) { return l.indexOf('xn--') === 0 ? (punyDecode(l.slice(4)) || l) : l; }).join('.');
  return { shown: shown };
}

/** Aviso antes de abrir (texto para confirmar) o null si se abre sin preguntar */
export function openWarning(url) {
  var u; try { u = new URL(url); } catch (e) { return null; }
  var lk = lookalike(u.hostname);
  if (lk) return t('link_warn_lookalike', 'Cuidado: «{host}» usa letras de otro alfabeto (se lee «{shown}») y puede imitar a otro sitio. ¿Abrirlo de todos modos?').replace(/\{host\}/g, u.hostname).replace(/\{shown\}/g, lk.shown);
  var c = cache.get(u.href);
  if (c && c.st === 'redirige') return t('link_warn_redirect', 'Cuidado: este enlace de {host} te lleva a otro sitio: {to}. ¿Abrirlo de todos modos?').replace(/\{host\}/g, u.hostname.replace(/^www\./, '')).replace(/\{to\}/g, c.to || '?');
  return null;
}

// ===== Pintar =====
function _span(cls, txt) { var s = document.createElement('span'); s.className = cls; s.setAttribute('data-t', txt); return s; }

function _apply(card, c) {
  if (!card || card.getAttribute('data-nx-prev-st') === c.st + (c.at || '')) return;
  card.setAttribute('data-nx-prev-st', c.st + (c.at || ''));
  Array.prototype.slice.call(card.querySelectorAll('.nx-lc-img, .nx-lc-title, .nx-lc-warn')).forEach(function(x) { x.remove(); });
  card.classList.remove('nx-lc-prev');
  var txt = card.querySelector('.nx-lc-txt');
  if (c.st === 'ok') {
    card.classList.add('nx-lc-prev');
    if (c.image) {
      var im = document.createElement('img');
      im.className = 'nx-lc-img'; im.alt = ''; im.decoding = 'async'; im.draggable = false; im.referrerPolicy = 'no-referrer';
      im.src = c.image;
      card.insertBefore(im, card.firstChild);
    }
    if (txt) txt.insertBefore(_span('nx-lc-title', c.title), txt.firstChild);
  } else if (c.st === 'redirige' && txt) {
    txt.appendChild(_span('nx-lc-warn', t('link_redirects', '⚠ Lleva a otro sitio: {to}').replace(/\{to\}/g, c.to || '?')));
  }
}

function _paintAll(url) {
  if (typeof document === 'undefined') return;
  var c = cache.get(url); if (!c) return;
  Array.prototype.slice.call(document.querySelectorAll('a.nx-link-card[data-nx-prev]')).forEach(function(card) {
    if (card.getAttribute('data-nx-prev') === url) _apply(card, c);
  });
}

function _store(url, c) {
  cache.delete(url); cache.set(url, c);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  _paintAll(url);
}

function _pump() {
  var pl = _plugin();
  while (pl && running < MAX_RUN && queue.length) {
    var url = queue.shift();
    running++;
    (function(u) {
      var done = function(res) { running--; inflight.delete(u); _store(u, sanitize(res)); _pump(); };
      try { Promise.resolve(pl.linkPreview({ url: u })).then(done, function() { done({ status: 'red' }); }); } catch (e) { done({ status: 'red' }); }
    })(url);
  }
}

function _request(url) {
  if (inflight.has(url) || queue.length >= MAX_QUEUE) return;
  inflight.add(url); queue.push(url); _pump();
}

// La red volvió: se piden otra vez las que esperaban internet (o Tor)
function _retryWaiting() {
  cache.forEach(function(c, url) { if (c.st === 'offline' || c.st === 'red' || c.st === 'tor') _request(url); });
}
function _listen() {
  if (listening) return; listening = true;
  try { window.addEventListener('online', _retryWaiting); } catch (e) {}
  try {
    var pl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
    if (pl && typeof pl.addListener === 'function') pl.addListener('onNetChange', function(ev) { if (ev && ev.type && ev.type !== 'none') _retryWaiting(); });
  } catch (e) {}
}

/** ¿Este enlace lleva vista previa? Solo https (por http la podría falsificar quien esté en medio) */
export function wantsPreview(link) { return !!link && /^https:\/\//.test(link.url) && (PREVIEW_ANY_SITE || !!link.site); }

/** Engancha la tarjeta segura de `link` a su vista previa: la pinta si ya está y, si no (o toca reintentar), la pide al nativo */
export function attachPreview(card, link) {
  if (!wantsPreview(link) || !_plugin()) return;
  _listen();
  card.setAttribute('data-nx-prev', link.url);
  var c = cache.get(link.url);
  if (c) _apply(card, c);
  if (!c || Date.now() - c.at >= AGAIN_MS[c.st]) _request(link.url);
}

export function _resetForTest() { cache.clear(); queue = []; running = 0; inflight.clear(); }
