/**
 * estados_feed.js — 3230 (dueño 17-11 23:40: «así es como me imagino deben de ser los estados… la experiencia debe ser igual a TikTok»).
 * La pantalla Estados (estados_screen.js la abre deslizando Contactos a la izquierda desde media pantalla) es ahora:
 *  - ARRIBA, una fila de círculos DE LADO: el mío primero, con «Mi estado» DEBAJO (tocarlo = publicar uno), y a su lado los contactos
 *    que tienen estados: aro AZUL = tiene algo que no has visto; BLANCO = ya lo viste todo. Tocar uno lleva a sus estados.
 *  - A TODA LA PANTALLA, los estados uno tras otro (pantalla infinita), sin tener que tocar nada: al entrar se reproduce solo el
 *    primero —los míos; si no tengo, el más viejo—. Deslizar de abajo hacia arriba = el del siguiente contacto; de lado = otro estado
 *    del MISMO contacto. Foto, video, audio, texto o enlace, a pantalla completa y sin botones: dos toques = me gusta (sale un corazón),
 *    un toque = pausa / sigue (video y audio).
 *  - Cada estado que se ve queda visto (y guardado): cuando ya viste todos los de un contacto, su aro pasa de azul a blanco.
 *  - El video ya no enseña al empezar el cuadro gris con el triángulo de «play» del sistema: portada transparente y oculto hasta que
 *    da su primera imagen.
 * Orden: primero los contactos con algo sin ver y, entre ellos, el del estado sin ver más viejo; luego los ya vistos (igual).
 * Media: solo se carga la del estado a la vista y la de sus vecinos (de lado y arriba/abajo); la que queda lejos se suelta (memoria).
 * Las pruebas leen el estado a la vista por los id de siempre (#estado-view, #estado-pos, #estado-who, #estado-video, #estado-audio,
 * #estado-cargando, #estado-comentar-input): se ponen SOLO en el estado a la vista y se mueven con él.
 */
import { myStatuses, activeStatusContacts, statusAgo, statusMedia, likeStatus, iLiked, commentStatus, myLikes, myComments,
  openStatusCompose, openMyStatuses, statusSeen, markStatusSeen, playStatusMedia, freeStatusUrls, _toast } from './estados.js';
import { _getGradientForUUID, _getInitials } from './ble_helpers.js';
import { paintAvatar } from './avatar.js';
import { paintTextWithLinks } from './links.js';
import { t } from './i18n.js';

var TAP2_MS = 300;          // dos toques en menos de esto = me gusta (uno solo = pausa / sigue)
var IDLE_MS = 90;           // el dedo soltó y el deslizamiento se acomodó: ahí cambia el estado a la vista
var PREP_MS = 2000;         // al entrar (arrastre y luego soltar) se rehace una sola vez
var POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; // 1×1 transparente
var IDS = [['estado-view', null], ['estado-pos', '.nx-est-pos'], ['estado-who', '.nx-est-who'], ['estado-video', 'video.nx-est-media'],
  ['estado-audio', 'audio.nx-est-media'], ['estado-img-grande', 'img.nx-est-media'], ['estado-cargando', '.nx-est-loading'], ['estado-comentar-input', '.nx-est-cin']];

var _feed = null, _rings = null;
var _pages = [];            // [{ nx: 'me' | NEXO ID, name, items, s (estado a la vista en esa fila), hs (su fila de lado) }]
var _cur = { p: -1, s: 0 }; // estado a la vista: fila (contacto) y posición de lado
var _sig = '', _prepAt = 0, _mineN = 0;
var _on = false;            // la pantalla está a la vista: lo de la vista se reproduce
var _vT = null, _tap = { t: 0, sl: null, timer: null }, _likeAt = 0;

function _myNx() { var bi = window.bleInterface; return String((bi && bi.localNexoId) || '').toLowerCase(); }
function _myName() { try { return localStorage.getItem('nexo_display_name') || ''; } catch (e) { return ''; } }
function _kind(it) { return it.big ? it.big.k : it.vid ? 'vid' : it.img ? 'img' : it.aud ? 'aud' : ''; }
function _text(el, s) { if (!paintTextWithLinks(el, s)) el.textContent = s; }
function _av(cls, nx, label) {
  var a = document.createElement('div');
  a.className = cls + ' ble-contact-avatar ' + _getGradientForUUID(nx === 'me' ? (_myNx() || 'me') : nx);
  a.textContent = _getInitials(label || '·');
  try { paintAvatar(a, nx); } catch (e) {}
  return a;
}

// ---------- Qué se ve y en qué orden ----------
function _build() {
  var pages = [], mine = myStatuses();
  if (mine.length) pages.push({ nx: 'me', name: t('grp_my_status', 'Mi estado'), items: mine, s: 0 });
  var cs = activeStatusContacts().map(function(c) {
    var j = c.items.findIndex(function(it) { return !statusSeen(c.nx, it.sid); });
    return { nx: c.nx, name: c.name, items: c.items, s: j < 0 ? 0 : j, nuevo: j >= 0 ? 1 : 0, ts: c.items[j < 0 ? 0 : j].ts };
  });
  cs.sort(function(a, b) { return (b.nuevo - a.nuevo) || (a.ts - b.ts); });
  return pages.concat(cs);
}
// (un estado puede cambiar sin cambiar de sid —el «estado» único de antes, o su media que llega—: cuenta también su contenido)
function _sigOf(pages) {
  return pages.map(function(pg) {
    return pg.nx + ':' + pg.items.map(function(it) { return it.sid + '.' + it.ts + '.' + _kind(it) + '.' + String(it.t || '').length + '.' + String(it.img || it.vid || it.aud || '').length; }).join(',');
  }).sort().join('|');
}
function _unseen(pg) { return pg.nx !== 'me' && pg.items.some(function(it) { return !statusSeen(pg.nx, it.sid); }); }
function _firstUnseen(pg) { var j = pg.nx === 'me' ? -1 : pg.items.findIndex(function(it) { return !statusSeen(pg.nx, it.sid); }); return j < 0 ? 0 : j; }

// ---------- La fila de círculos de arriba ----------
function _ring(o) {
  var w = document.createElement('div');
  w.className = 'estado-chip nx-est-ring' + (o.mine ? ' nx-est-mine' : '');
  w.setAttribute('data-nx', o.nx); w.setAttribute('role', 'button');
  // el círculo va DIRECTO en el círculo-botón: el motor de toques (press.js) toma su forma redonda para la onda y el pulso
  var c = _av('nx-est-av' + (o.ring === 'new' ? '' : o.ring === 'seen' ? ' visto' : ' nx-est-noring'), o.nx, o.mine ? (_myName() || o.label) : o.label);
  var nm = document.createElement('div'); nm.className = 'nx-est-rname'; nm.textContent = o.label;
  w.appendChild(c); w.appendChild(nm);
  if (o.mine) { var plus = document.createElement('span'); plus.className = 'nx-est-plus'; plus.textContent = '+'; w.appendChild(plus); }
  w.addEventListener('click', function(e) { e.stopPropagation(); o.onTap(); });
  return w;
}
function _paintRings() {
  if (!_rings) return;
  var x = _rings.scrollLeft;
  _rings.innerHTML = '';
  _rings.appendChild(_ring({ mine: true, nx: 'me', label: t('grp_my_status', 'Mi estado'), ring: myStatuses().length ? 'seen' : '', onTap: _compose }));
  _pages.forEach(function(pg) {
    if (pg.nx !== 'me') _rings.appendChild(_ring({ nx: pg.nx, label: pg.name, ring: _unseen(pg) ? 'new' : 'seen', onTap: function() { feedGoNx(pg.nx); } }));
  });
  _rings.scrollLeft = x;
}

// ---------- Cada estado a pantalla completa ----------
function _slideEl(pg, it, j) {
  var mine = pg.nx === 'me', n = pg.items.length, k = _kind(it);
  var sl = document.createElement('div');
  sl.className = 'nx-est-slide' + (k === 'img' || k === 'vid' ? '' : ' nx-est-plain');
  sl.setAttribute('data-sid', it.sid);
  sl._nx = { pg: pg, it: it, k: k, loaded: false, tok: 0 };
  if (!k && it.t) { var bt = document.createElement('div'); bt.className = 'nx-est-bigtxt'; _text(bt, it.t); sl.appendChild(bt); }
  if (k === 'aud') sl.appendChild(_av('nx-est-audav', pg.nx, mine ? _myName() : pg.name));
  var info = document.createElement('div'); info.className = 'nx-est-info';
  if (k && it.t) { var cap = document.createElement('div'); cap.className = 'nx-est-cap'; _text(cap, it.t); info.appendChild(cap); }
  var row = document.createElement('div'); row.className = 'nx-est-irow';
  var av = _av('nx-est-iav', pg.nx, mine ? _myName() : pg.name);
  var col = document.createElement('div'); col.className = 'nx-est-icol';
  var who = document.createElement('div'); who.className = 'nx-est-who'; who.textContent = mine ? t('grp_my_status', 'Mi estado') : pg.name + ' ›';
  var meta = document.createElement('div'); meta.className = 'nx-est-meta';
  var when = document.createElement('span'); when.className = 'nx-est-when'; when.textContent = statusAgo(it.ts); meta.appendChild(when);
  if (n > 1) { var pos = document.createElement('span'); pos.className = 'nx-est-pos'; pos.textContent = (j + 1) + '/' + n; meta.appendChild(pos); }
  if (!mine) { var hr = document.createElement('span'); hr.className = 'nx-est-heart' + (iLiked(pg.nx, it.sid) ? ' on' : ''); hr.textContent = '❤️'; meta.appendChild(hr); }
  col.appendChild(who); col.appendChild(meta); row.appendChild(av); row.appendChild(col); info.appendChild(row);
  if (mine) {
    // mis estados: cuántos me gusta y comentarios; tocarlo abre «Mis estados» (quién, los comentarios y quitar uno)
    var ms = document.createElement('div'); ms.className = 'nx-est-mystats'; _mineStats(ms, it.sid);
    ms.addEventListener('click', function(e) { e.stopPropagation(); _above(openMyStatuses); });
    info.appendChild(ms);
  } else {
    // 2999: tocar el nombre (o su círculo) abre el chat con él
    who.title = t('est_open_chat', 'Abrir el chat');
    var chat = function(e) { e.stopPropagation(); var bi = window.bleInterface; try { if (bi && typeof bi.openChat === 'function') bi.openChat(pg.nx).catch(function() {}); } catch (err) {} };
    who.addEventListener('click', chat); av.addEventListener('click', chat);
    // comentario: le llega SOLO al dueño del estado; se manda con la tecla de enviar del teclado (sin botón)
    var f = document.createElement('form'); f.className = 'nx-est-cform'; f.setAttribute('action', '#');
    var cin = document.createElement('input'); cin.className = 'nx-est-cin'; cin.type = 'text'; cin.maxLength = 280; cin.autocomplete = 'off';
    cin.setAttribute('enterkeyhint', 'send'); cin.placeholder = t('est_comment_ph', 'Comentar (solo lo verá ') + pg.name + ')';
    f.appendChild(cin);
    f.addEventListener('submit', function(e) { e.preventDefault(); _comment(pg, it, cin); });
    cin.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); _comment(pg, it, cin); } });
    info.appendChild(f);
  }
  sl.appendChild(info);
  return sl;
}
function _mineStats(el, sid) { el.textContent = '❤️ ' + myLikes(sid) + '   💬 ' + myComments(sid).length + '   ›'; }
function _comment(pg, it, cin) {
  if (!String(cin.value || '').trim()) return;
  if (commentStatus(pg.nx, it.sid, cin.value)) { cin.value = ''; try { cin.blur(); } catch (e) {} _toast(t('est_comment_sent', 'Comentario enviado a ') + pg.name); }
}
function _pageEl(pg, i) {
  var el = document.createElement('div'); el.className = 'nx-est-page'; el.setAttribute('data-nx', pg.nx);
  var hs = document.createElement('div'); hs.className = 'nx-est-hs';
  pg.items.forEach(function(it, j) { hs.appendChild(_slideEl(pg, it, j)); });
  hs.addEventListener('scroll', function() { _onHScroll(pg); }, { passive: true });
  el.appendChild(hs);
  pg.hs = hs;
  return el;
}

// ---------- Media: cargar la de cerca, soltar la de lejos ----------
function _mediaOf(sl) { return sl ? sl.querySelector('video.nx-est-media, audio.nx-est-media') : null; }
function _load(sl) {
  var d = sl._nx;
  if (!d || d.loaded || !d.k) return;
  d.loaded = true;
  var tok = ++d.tok, it = d.it;
  if (!it.big) { _mk(sl, it.img || it.vid || it.aud); return; }
  var ph = document.createElement('div'); ph.className = 'nx-est-loading';
  ph.textContent = '⏳ ' + t('est_loading', 'Cargando…') + ' (' + Math.round(it.big.size / 1024) + ' KB)';
  sl.insertBefore(ph, sl.firstChild);
  _tagIfActive(sl);
  _bigQ.push({ sl: sl, tok: tok, ph: ph });
  _bigNext();
}
// La media grande se pide DE UNA EN UNA y primero la del estado a la vista: dos pedidas a la vez al mismo teléfono por el enlace
// directo no llegaban ninguna (estadovideo: «recodificado» y «h264» se quedaban en «Cargando…» al precargar el vecino).
var _bigQ = [], _bigBusy = false;
function _bigNext() {
  if (_bigBusy) return;
  _bigQ = _bigQ.filter(function(x) { return x.sl._nx && x.sl._nx.loaded && x.sl._nx.tok === x.tok; });   // los que se soltaron, fuera
  if (!_bigQ.length) return;
  var i = _bigQ.findIndex(function(x) { return _isActive(x.sl); });
  var job = _bigQ.splice(i < 0 ? 0 : i, 1)[0], d = job.sl._nx;
  _bigBusy = true;
  var done = function(m) {
    _bigBusy = false;
    if (d.loaded && d.tok === job.tok) {
      if (m) { job.ph.remove(); _mk(job.sl, m); } else job.ph.textContent = t('est_media_fail', 'No se pudo bajar todavía: se reintenta cuando el otro esté cerca o en línea');
    }
    _bigNext();
  };
  statusMedia(d.pg.nx, d.it).then(done, function() { done(null); });
}
function _mk(sl, data) {
  var d = sl._nx, el;
  if (d.k === 'img') { el = document.createElement('img'); el.alt = ''; el.decoding = 'async'; el.className = 'nx-est-media'; el.src = data; sl.insertBefore(el, sl.firstChild); _tagIfActive(sl); return; }
  el = document.createElement(d.k === 'vid' ? 'video' : 'audio');
  el.className = 'nx-est-media';
  el.preload = 'auto';
  el.playsInline = true;
  el.setAttribute('playsinline', 'playsinline');
  el.controls = false;
  if (d.k === 'vid') {
    el.loop = true; el.setAttribute('poster', POSTER); el.setAttribute('disablepictureinpicture', '');
    el.classList.add('nx-est-wait');
    var show = function() { el.classList.remove('nx-est-wait'); };
    el.addEventListener('loadeddata', show); el.addEventListener('playing', show);
  } else {
    el.addEventListener('ended', function() { sl.classList.add('nx-est-paused'); });
  }
  el.addEventListener('play', function() { sl.classList.add('nx-est-playing'); });
  el.addEventListener('pause', function() { sl.classList.remove('nx-est-playing'); });
  sl.insertBefore(el, sl.firstChild);
  playStatusMedia(el, data, sl, d.pg.nx + ' ' + d.it.sid);   // URL blob: (la CSP no deja «data:»); si no se puede, un aviso
  _tagIfActive(sl);
  if (_on && _isActive(sl)) _play(el);
}
function _unload(sl) {
  var d = sl._nx;
  if (!d || !d.loaded) return;
  d.loaded = false; d.tok++;
  Array.prototype.forEach.call(sl.querySelectorAll('.nx-est-media,.nx-est-loading,.estado-no-se-ve'), function(m) {
    if (m.tagName === 'VIDEO' || m.tagName === 'AUDIO') { try { m.pause(); m.removeAttribute('src'); m.load(); } catch (e) {} }
    m.remove();
  });
  sl.classList.remove('nx-est-playing', 'nx-est-paused');
  freeStatusUrls(sl);
}
function _play(m) {
  var p;
  try { p = m.play(); } catch (e) { return; }
  if (p && typeof p.catch === 'function') p.catch(function(err) {
    // si el teléfono no deja reproducir con sonido sin un toque, el video va sin sonido (como TikTok al abrir)
    if (m.tagName === 'VIDEO' && !m.muted && err && err.name === 'NotAllowedError' && m.isConnected) {
      console.log('[ESTADOS] El teléfono no deja reproducir con sonido sin tocar: el video va sin sonido');
      m.muted = true; _play(m);
    }
  });
}
function _pauseSl(sl) { var m = _mediaOf(sl); if (m && !m.paused) { try { m.pause(); } catch (e) {} } if (sl) sl.classList.remove('nx-est-paused'); }
function _pauseAll() { _pages.forEach(function(pg) { if (pg.hs) Array.prototype.forEach.call(pg.hs.children, _pauseSl); }); }
function _resume() {
  var sl = _slide(_cur.p, _cur.s);
  if (!sl || sl.classList.contains('nx-est-paused')) return;
  var m = _mediaOf(sl); if (m && m.paused && !m.ended) _play(m);
}
// carga lo de cerca (el de la vista, sus vecinos de lado y el que toca arriba/abajo), suelta el resto; solo suena el de la vista
function _manage() {
  _pages.forEach(function(pg, i) {
    var kids = pg.hs ? pg.hs.children : [];
    for (var j = 0; j < kids.length; j++) {
      var act = i === _cur.p && j === _cur.s;
      var near = i === _cur.p ? Math.abs(j - _cur.s) <= 1 : (Math.abs(i - _cur.p) === 1 && j === pg.s);
      if (near) _load(kids[j]); else _unload(kids[j]);
      if (!act) _pauseSl(kids[j]);
    }
  });
}

// ---------- El estado a la vista ----------
function _slide(p, s) { var pg = _pages[p]; return pg && pg.hs ? pg.hs.children[s] || null : null; }
function _isActive(sl) { return !!sl && sl === _slide(_cur.p, _cur.s); }
function _tag() {
  if (!_feed) return;
  IDS.forEach(function(x) { var o = document.getElementById(x[0]); if (o && _feed.contains(o)) o.removeAttribute('id'); });
  var sl = _slide(_cur.p, _cur.s); if (!sl) return;
  IDS.forEach(function(x) { var el = x[1] ? sl.querySelector(x[1]) : sl; if (el && !document.getElementById(x[0])) el.id = x[0]; });
}
function _tagIfActive(sl) { if (_isActive(sl)) _tag(); }
function _activate(p, s, restart) {
  var pg = _pages[p]; if (!pg) return;
  var same = _cur.p === p && _cur.s === s;
  _cur = { p: p, s: s }; pg.s = s;
  _tag(); _manage(); _bigNext();
  var sl = _slide(p, s);
  if (!_on || !sl) return;
  sl.classList.remove('nx-est-paused');
  var m = _mediaOf(sl);
  if (m) { if (restart || !same) { try { m.currentTime = 0; } catch (e) {} } _play(m); }
  var d = sl._nx;
  if (d && pg.nx !== 'me' && !statusSeen(pg.nx, d.it.sid)) markStatusSeen(pg.nx, d.it.sid);   // el aro pasa a blanco al verlos todos
}
function _go(p, s, restart) {
  if (!_pages.length || !_feed) return;
  p = Math.max(0, Math.min(_pages.length - 1, p | 0));
  var pg = _pages[p]; s = Math.max(0, Math.min(pg.items.length - 1, s | 0));
  var H = _feed.clientHeight, W = pg.hs ? pg.hs.clientWidth : 0;
  if (H) _feed.scrollTop = p * H;
  if (W) pg.hs.scrollLeft = s * W;
  _activate(p, s, restart);
}
function _onVScroll() {
  clearTimeout(_vT);
  _vT = setTimeout(function() {
    var H = _feed.clientHeight; if (!H || !_pages.length) return;
    var p = Math.max(0, Math.min(_pages.length - 1, Math.round(_feed.scrollTop / H)));
    if (p !== _cur.p) _activate(p, _pages[p].s, true);
  }, IDLE_MS);
}
function _onHScroll(pg) {
  clearTimeout(pg._t);
  pg._t = setTimeout(function() {
    var W = pg.hs.clientWidth; if (!W) return;
    var s = Math.max(0, Math.min(pg.items.length - 1, Math.round(pg.hs.scrollLeft / W))), p = _pages.indexOf(pg);
    if (p === _cur.p && s !== _cur.s) _activate(p, s, true); else if (p !== _cur.p) pg.s = s;
  }, IDLE_MS);
}
function _onResize() {   // (el teclado del comentario, girar el teléfono): que el de la vista siga entero
  var pg = _pages[_cur.p]; if (!pg || !_feed) return;
  var H = _feed.clientHeight, W = pg.hs.clientWidth;
  if (H) _feed.scrollTop = _cur.p * H;
  if (W) pg.hs.scrollLeft = _cur.s * W;
}

// ---------- Toques: uno = pausa / sigue; dos = me gusta ----------
function _onClick(e) {
  var tg = e.target;
  if (!tg || !tg.closest || tg.closest('.nx-est-cform, .nx-est-mystats, .nx-est-who, .nx-est-iav, a, [class*="nx-link"]')) return;
  var sl = tg.closest('.nx-est-slide'); if (!sl) return;
  var now = Date.now();
  if (_tap.sl === sl && now - _tap.t < TAP2_MS) { clearTimeout(_tap.timer); _tap.t = 0; _like(sl); return; }
  clearTimeout(_tap.timer); _tap.t = now; _tap.sl = sl;
  _tap.timer = setTimeout(function() { _tap.t = 0; _toggle(sl); }, TAP2_MS);
}
function _onDbl(e) {   // (los WebView que sí mandan «dblclick»; el doble toque de arriba ya lo contó)
  var sl = e.target && e.target.closest ? e.target.closest('.nx-est-slide') : null;
  if (!sl || e.target.closest('.nx-est-cform, a')) return;
  clearTimeout(_tap.timer); _tap.t = 0;
  if (Date.now() - _likeAt > 500) _like(sl);
}
function _toggle(sl) {
  var m = _mediaOf(sl); if (!m || !_isActive(sl)) return;
  if (m.paused) { sl.classList.remove('nx-est-paused'); _play(m); } else { try { m.pause(); } catch (e) {} sl.classList.add('nx-est-paused'); }
}
function _like(sl) {
  var d = sl && sl._nx; if (!d) return;
  _likeAt = Date.now();
  if (d.pg.nx === 'me') return;
  var had = iLiked(d.pg.nx, d.it.sid), ok = had || likeStatus(d.pg.nx, d.it.sid);
  var b = document.createElement('div'); b.className = 'nx-est-burst'; b.textContent = '❤️'; sl.appendChild(b);
  setTimeout(function() { try { b.remove(); } catch (e) {} }, 900);
  if (ok) { var h = sl.querySelector('.nx-est-heart'); if (h) h.classList.add('on'); }
  if (ok && !had) console.log('[ESTADOS] Me gusta (dos toques) al estado ' + d.it.sid + ' de ' + d.pg.nx);
}

// ---------- Ventanas encima (publicar, «Mis estados»): se pausa y al cerrarse sigue ----------
function _above(fn) {
  _pauseAll();
  fn();
  try {
    var mo = new MutationObserver(function() { if (document.getElementById('estado-overlay')) return; mo.disconnect(); if (_on) _resume(); });
    mo.observe(document.body, { childList: true });
  } catch (e) {}
}
function _compose() { _above(openStatusCompose); }

// ---------- Lo que usa estados_screen.js ----------
export function feedMount(root) {
  if (_feed && _feed.isConnected) return _feed;
  _feed = document.createElement('div'); _feed.id = 'est-feed'; _feed.className = 'nx-est-feed';
  var top = document.createElement('div'); top.className = 'nx-est-top';
  _rings = document.createElement('div'); _rings.id = 'est-rings'; _rings.className = 'nx-est-rings';
  top.appendChild(_rings);
  root.appendChild(_feed); root.appendChild(top);
  _feed.addEventListener('scroll', _onVScroll, { passive: true });
  _feed.addEventListener('click', _onClick);
  _feed.addEventListener('dblclick', _onDbl);
  window.addEventListener('resize', _onResize);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') _pauseAll(); else if (_on && !document.getElementById('estado-overlay')) _resume();
  });
  return _feed;
}
// Rehace la pantalla si cambió lo que hay (llegó o caducó un estado, publiqué uno); si no, solo los aros y mis contadores.
// force: al entrar (orden y primer estado de cada contacto al día).
export function feedRender(force) {
  if (!_feed) return false;
  var pages = _build(), sig = _sigOf(pages), mineN = myStatuses().length;
  if (force && sig === _sig && Date.now() - _prepAt < PREP_MS) force = false;   // arrastre y soltar: una vez
  if (force || sig !== _sig || !_feed.firstChild) {
    var pg0 = _pages[_cur.p], keep = pg0 ? { nx: pg0.nx, sid: (pg0.items[_cur.s] || {}).sid } : null, published = mineN > _mineN;
    _pauseAll();
    _pages.forEach(function(pg) { if (pg.hs) Array.prototype.forEach.call(pg.hs.children, _unload); });
    _feed.innerHTML = '';
    _sig = sig; _pages = pages; _cur = { p: -1, s: 0 };
    if (force) _prepAt = Date.now();
    if (!pages.length) {
      var e = document.createElement('div'); e.className = 'nx-est-empty';
      e.textContent = t('est_none_yet', 'Aún no hay estados de tus contactos. Cuando publiquen uno, saldrá aquí.');
      _feed.appendChild(e);
    } else {
      pages.forEach(function(pg, i) { _feed.appendChild(_pageEl(pg, i)); });
      if (!force && _on) {
        if (published && pages[0].nx === 'me') _go(0, pages[0].items.length - 1, true);   // acabo de publicar: se ve el mío
        else {
          var p = keep ? pages.findIndex(function(x) { return x.nx === keep.nx; }) : -1;
          if (p < 0) _go(0, pages[0].s, true);
          else { var s = pages[p].items.findIndex(function(it) { return it.sid === keep.sid; }); _go(p, s < 0 ? pages[p].s : s, false); }
        }
      }
    }
  } else if (_pages[0] && _pages[0].nx === 'me' && _pages[0].hs) {
    Array.prototype.forEach.call(_pages[0].hs.querySelectorAll('.nx-est-mystats'), function(el, j) { _mineStats(el, _pages[0].items[j].sid); });
  }
  _mineN = mineN;
  _paintRings();
  return true;
}
// La pantalla se ve (on) o se fue (off). Al entrar empieza por el primero (los míos o el más viejo) y se reproduce solo.
export function feedShow(on) {
  _on = !!on;
  if (!_on) { _pauseAll(); return; }
  feedRender(true);
  if (_pages.length) { _go(0, _pages[0].s, true); console.log('[ESTADOS] A pantalla completa: ' + _pages.length + ' con estados; empieza ' + (_pages[0].nx === 'me' ? 'por los míos' : 'por el más viejo sin ver')); }
}
// Tocar el círculo de un contacto: a sus estados, en el primero que no he visto
export function feedGoNx(nx) {
  var p = _pages.findIndex(function(pg) { return pg.nx === nx; });
  if (p < 0) return false;
  _go(p, _firstUnseen(_pages[p]), true);
  return true;
}
if (typeof window !== 'undefined') {
  // pruebas: moverse como con el dedo (dp: contactos abajo/arriba; ds: estados de lado) y leer el de la vista
  window.__nexoEstGo = function(dp, ds) {
    if (_cur.p < 0) return null;
    var p = _cur.p + (dp | 0);
    if (!_pages[p]) return null;
    _go(p, dp ? _pages[p].s : _cur.s + (ds | 0), true);
    return window.__nexoEstCur();
  };
  window.__nexoEstCur = function() {
    var pg = _pages[_cur.p]; if (!pg) return null;
    var sl = _slide(_cur.p, _cur.s), m = _mediaOf(sl);
    return { nx: pg.nx, sid: (pg.items[_cur.s] || {}).sid, p: _cur.p, s: _cur.s, n: _pages.length, on: _on, suena: !!(m && !m.paused) };
  };
}
