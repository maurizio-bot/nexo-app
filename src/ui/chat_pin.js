/**
 * 3219 (dueño 17-11, funciones de WhatsApp dentro del chat): FIJAR mensajes dentro del chat, para los dos. Mantener pulsado un mensaje →
 * «Fijar» / «Desfijar» (menú de chat_actions). Hasta PIN_MAX (3) por chat: al fijar un cuarto se quita el más antiguo (con aviso).
 * Arriba del chat, una franja con el último fijado; al tocarla salta a ese mensaje (chat_star.jumpToMessage, también si está más
 * arriba de lo dibujado) y pasa al siguiente fijado (rota entre ellos; unas rayitas a la izquierda dicen cuántos hay y cuál se ve).
 * Viaja como «Editar»: una acción OCULTA cifrada de extremo a extremo (nexo_act, por todos los caminos, sin aviso ni «no leído»):
 *     {"type":"nexo_act","act":"pin","id":msgId,"on":1|0,"ts":hora,"g":grupo si es de grupo}
 * Gana la más nueva por su hora (ts), aunque lleguen desordenadas o repetidas. En 1-a-1 sale solo a un contacto que entiende las
 * acciones (fx, como editar y reaccionar); una versión vieja la ignora sin romper nada (_applyChatAction no la conoce: ni se muestra
 * ni avisa). En GRUPO también: va a cada miembro con el id del mensaje del grupo (gm…, sin las 8 letras de mi copia); cada uno la
 * aplica a SU copia (ese id, o id + sus 8 letras) solo si viene de un miembro. Cualquier miembro puede fijar (como en WhatsApp).
 * Lo fijado se guarda cifrado (archivo del vault vía plugin: nexo_pins.json), por chat: { id: { on, ts, by } }.
 */
import { t } from './i18n.js';
import { _getCurrentContactId, _msgSummary, _myNexoId, _normId, _peerUnderstands } from './chat_format.js';
import { vaultLoadMessages } from '../vault/vault_manager.js';
import { _showInfoToast } from './ui_bits.js';
import { jumpToMessage } from './chat_star.js';

export var PIN_FILE = 'nexo_pins.json';
export var PIN_MAX = 3;
var KEEP_PER_CHAT = 30;   // lo desfijado se recuerda (con su hora) para que una acción vieja no lo vuelva a fijar
var ID_OK = /^[0-9a-zA-Z_]{4,80}$/;
var GM_RE = /^(gm[0-9a-z]+)(?:_[0-9a-z]{8})?$/;
var PIN_PATH = '<path d="M12 17v5"/><path d="M9 3h6"/><path d="M10 3v6.5L6.5 13.5V15h11v-1.5L14 9.5V3"/>';

var _sendTextTo = null;    // [pegamento] lo da chat_actions (chatActionsUse)
export function chatPinUse(d) { _sendTextTo = d._sendTextTo; }

var _st = null;            // chat → { msgId: { on: 1|0, ts, by } }
var _shown = {};           // chat → índice del fijado que se ve en la franja
var _missing = {};         // chat → hay fijados cuyo mensaje aún no está (llegará): se vuelve a mirar al llegar algo

function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _all() { if (!_st) _st = {}; return _st; }
function _groups() { return window.bleInterface && window.bleInterface.groups; }

function _save() {
  var p = _plugin();
  if (!p || typeof p.saveToFile !== 'function') return;
  try { Promise.resolve(p.saveToFile({ filename: PIN_FILE, content: JSON.stringify({ pins: _all(), savedAt: Date.now() }) })).catch(function() {}); } catch (e) {}
}

export function loadPins() {
  var p = _plugin();
  if (!p || typeof p.loadFromFile !== 'function') return Promise.resolve();
  try {
    return Promise.resolve(p.loadFromFile({ filename: PIN_FILE })).then(function(r) {
      if (!(r && r.exists && r.content)) return;
      try {
        var d = JSON.parse(r.content), src = d && d.pins;
        if (src && typeof src === 'object') Object.keys(src).forEach(function(cid) {
          var e = src[cid]; if (!e || typeof e !== 'object') return;
          Object.keys(e).forEach(function(id) { var x = e[id]; if (x && ID_OK.test(id) && typeof x.ts === 'number') _set(_normId(cid), id, !!x.on, x.ts, x.by || ''); });
        });
      } catch (e) {}
      renderPinBar();
    }).catch(function() {});
  } catch (e) { return Promise.resolve(); }
}

// Los fijados de un chat (ids), del más nuevo al más viejo; como mucho PIN_MAX
export function pinsOf(cid) {
  var e = _all()[_normId(cid)] || {};
  return Object.keys(e).filter(function(id) { return e[id].on; }).sort(function(a, b) { return e[b].ts - e[a].ts; }).slice(0, PIN_MAX);
}
export function isPinned(cid, id) { var e = _all()[_normId(cid)]; return !!(e && e[id] && e[id].on); }

// Aplica un fijar/desfijar con su hora (gana la más nueva). Más de PIN_MAX fijados: el más viejo queda desfijado. true = cambió.
function _set(cid, id, on, ts, by) {
  var all = _all(), e = all[cid] || (all[cid] = {}), prev = e[id];
  if (prev && prev.ts >= ts) return false;
  e[id] = { on: on ? 1 : 0, ts: ts, by: by || '' };
  var ons = Object.keys(e).filter(function(k) { return e[k].on; }).sort(function(a, b) { return e[b].ts - e[a].ts; });
  ons.slice(PIN_MAX).forEach(function(k) { e[k].on = 0; });
  var ks = Object.keys(e);
  if (ks.length > KEEP_PER_CHAT) ks.filter(function(k) { return !e[k].on; }).sort(function(a, b) { return e[a].ts - e[b].ts; }).slice(0, ks.length - KEEP_PER_CHAT).forEach(function(k) { delete e[k]; });
  return true;
}

// El id que viaja: en 1-a-1 el del mensaje; en un grupo el del mensaje del grupo (gm…, sin las 8 letras de mi copia). null = no viaja.
function _wireId(cid, id) {
  var gs = _groups();
  if (gs && gs.isGroup(cid)) { var m = GM_RE.exec(String(id || '')); return m ? m[1] : null; }
  return id;
}

export function canPin(cid, msg) { return !!(msg && !msg.deleted && !msg.hidden && (msg.msgId || msg.messageId)); }

function _send(cid, id, on, ts) {
  if (typeof _sendTextTo !== 'function') return 0;
  var wid = _wireId(cid, id);
  if (!wid) return 0;
  var act = { type: 'nexo_act', act: 'pin', id: wid, on: on ? 1 : 0, ts: ts };
  var gs = _groups(), g = gs && gs.isGroup(cid) ? gs.get(cid) : null;
  if (g) {
    if (g.left) return 0;
    act.g = g.id;
    var wire = JSON.stringify(act), me = _myNexoId(), n = 0;
    (g.members || []).forEach(function(nx) { if (_normId(nx) && _normId(nx) !== me) { _sendTextTo(_normId(nx), wire, '', true); n++; } });
    return n;
  }
  if (!_peerUnderstands(cid)) return 0;   // un teléfono que no entiende las acciones: queda fijado solo aquí
  _sendTextTo(cid, JSON.stringify(act), '', true);
  return 1;
}

// Fijar o desfijar desde el menú del mensaje
export function togglePin(cid, msg) {
  cid = _normId(cid);
  var id = msg && (msg.msgId || msg.messageId);
  if (!cid || !id || !canPin(cid, msg)) return false;
  var e = _all()[cid] || {}, prev = e[id], on = !isPinned(cid, id), me = _myNexoId();
  var ts = Math.max(Date.now(), ((prev && prev.ts) || 0) + 1);
  var before = pinsOf(cid), evicted = on && before.length >= PIN_MAX ? before[before.length - 1] : null;
  _set(cid, id, on, ts, me);
  if (evicted) { var ev = (_all()[cid] || {})[evicted]; if (ev) ev.ts = Math.max(ev.ts, ts); }
  _save();
  var n = _send(cid, id, on, ts);
  if (evicted) { _send(cid, evicted, false, ts); _showInfoToast(t('pin_max', 'Máximo 3 mensajes fijados: se quitó el más antiguo'), 2800); }
  console.log('[PIN] ' + id + (on ? ' fijado' : ' desfijado') + ' en ' + cid + ' (a ' + n + ' persona(s))');
  if (on) _shown[cid] = 0;
  renderPinBar();
  return on;
}

// Dueño 23-11: quitar un fijado por su id, AUNQUE el mensaje ya no exista (borrado): antes solo se podía desde el menú del mensaje, y un
// mensaje borrado ya no tiene menú. local=true: solo en este teléfono (borrado «para mí»); si no, se avisa al otro (o al grupo).
export function unpinId(cid, id, local) {
  cid = _normId(cid);
  if (!cid || !id || !isPinned(cid, id)) return false;
  var prev = (_all()[cid] || {})[id], ts = Math.max(Date.now(), ((prev && prev.ts) || 0) + 1);
  _set(cid, id, false, ts, _myNexoId());
  _save();
  var n = local ? 0 : _send(cid, id, false, ts);
  console.log('[PIN] ' + id + ' desfijado en ' + cid + (local ? ' (solo aquí)' : ' (a ' + n + ' persona(s))'));
  renderPinBar();
  return true;
}

// Recibido: un contacto (o un miembro del grupo) fijó o desfijó un mensaje
export function pinOnAction(senderId, act) {
  var who = _normId(senderId);
  if (!act || typeof act.id !== 'string' || !ID_OK.test(act.id) || !who) return;
  var ts = (typeof act.ts === 'number' && isFinite(act.ts) && act.ts > 0) ? act.ts : Date.now();
  var on = act.on === 1 || act.on === true;
  if (!act.g) { _apply(who, act.id, on, ts, who); return; }
  var gs = _groups(), g = gs ? gs.get(act.g) : null, me = _myNexoId(), base = String(act.id);
  if (!g || g.left || (g.members || []).indexOf(who) < 0 || !/^gm[0-9a-z]+$/.test(base) || !me) { console.warn('[PIN] Fijado de grupo descartado (de ' + who + ': no es miembro o el grupo no está)'); return; }
  var gid = _normId(g.id), mine = base + '_' + me.substring(2);
  // mi copia del mensaje: el id tal cual si lo escribí yo; si no, id + mis 8 letras (groups.js)
  vaultLoadMessages(gid).then(function(list) {
    var own = (list || []).some(function(m) { return (m.msgId || m.messageId) === base; });
    _apply(gid, own ? base : mine, on, ts, who);
  }).catch(function() { _apply(gid, mine, on, ts, who); });
}
function _apply(cid, id, on, ts, by) {
  if (!_set(cid, id, on, ts, by)) { console.log('[PIN] Fijado de ' + id + ' más viejo o repetido: se queda el más nuevo'); return; }
  _save();
  console.log('[PIN] ' + by + (on ? ' fijó ' : ' desfijó ') + id + ' en ' + cid);
  if (on) _shown[cid] = 0;
  if (_normId(_getCurrentContactId()) === cid) renderPinBar();
}

// ---------- la franja de arriba del chat ----------
function _closePinMenu() { var m = document.getElementById('nexo-pin-menu'); if (m) m.remove(); document.removeEventListener('click', _outside, true); }
function _outside(ev) { var m = document.getElementById('nexo-pin-menu'); if (m && !m.contains(ev.target)) _closePinMenu(); }
function _pinMenu(bar, cid, id) {
  if (document.getElementById('nexo-pin-menu')) { _closePinMenu(); return; }
  var menu = document.createElement('div');
  menu.id = 'nexo-pin-menu';
  menu.setAttribute('role', 'menu');
  var add = function(label, cls, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pm-item' + (cls ? ' ' + cls : ''); b.setAttribute('role', 'menuitem'); b.textContent = label;
    b.onclick = function(e) { if (e) e.stopPropagation(); _closePinMenu(); fn(); };
    menu.appendChild(b);
  };
  // Dueño 24-11: el menú (pulsación larga) es solo para quitar; tocar ya salta al mensaje y pasa al siguiente fijado
  add(t('pin_remove', 'Quitar'), 'pm-danger', function() { unpinId(cid, id, false); });
  bar.appendChild(menu);
  setTimeout(function() { document.addEventListener('click', _outside, true); }, 0);
}

function _removeBar() { _closePinMenu(); var b = document.getElementById('nexo-pin-bar'); if (b) b.remove(); }

var _renderSeq = 0;
export function renderPinBar() {
  var cid = _normId(_getCurrentContactId());
  var ids = cid ? pinsOf(cid) : [];
  if (!ids.length) { _removeBar(); return Promise.resolve(null); }
  var seq = ++_renderSeq;
  return vaultLoadMessages(cid).then(function(list) {
    if (seq !== _renderSeq || _normId(_getCurrentContactId()) !== cid) return null;
    var byId = {};
    (list || []).forEach(function(m) { byId[m.msgId || m.messageId] = m; });
    // Dueño 23-11: un fijado cuyo mensaje se borró sigue en la franja («Mensaje eliminado») para que se pueda quitar; solo se esconde
    // uno cuyo mensaje aún no llegó (llegará)
    var live = ids.filter(function(id) { return !!byId[id]; });
    _missing[cid] = live.length < ids.length;
    if (!live.length) { _removeBar(); return null; }
    var idx = (_shown[cid] || 0) % live.length, id = live[idx];
    var header = document.getElementById('chat-header');
    if (!header || !header.parentNode) return null;
    var bar = document.getElementById('nexo-pin-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'nexo-pin-bar';
      bar.setAttribute('role', 'button');
      // Dueño 24-11 (sustituye al menú al tocar del 23-11): un TOQUE salta al fijado que se ve y la franja pasa al siguiente; una
      // PULSACIÓN LARGA abre «Quitar» (también para un fijado cuyo mensaje se borró)
      var lpT = null, lpFired = false, lpX = 0, lpY = 0;
      var openMenu = function() {
        var c = _normId(_getCurrentContactId()), cur = bar.dataset.msgId;
        if (!c || !cur || document.getElementById('nexo-pin-menu')) return;
        lpFired = true;
        _pinMenu(bar, c, cur);
      };
      var lpClear = function() { if (lpT) { clearTimeout(lpT); lpT = null; } };
      bar.addEventListener('pointerdown', function(ev) {
        if (ev.target && ev.target.closest && ev.target.closest('#nexo-pin-menu')) return;
        lpFired = false; lpX = ev.clientX || 0; lpY = ev.clientY || 0; lpClear();
        lpT = setTimeout(function() { lpT = null; openMenu(); }, 500);
      });
      bar.addEventListener('pointermove', function(ev) { if (lpT && (Math.abs((ev.clientX || 0) - lpX) > 10 || Math.abs((ev.clientY || 0) - lpY) > 10)) lpClear(); });
      bar.addEventListener('pointerup', lpClear);
      bar.addEventListener('pointercancel', lpClear);
      // en Android la pulsación larga del WebView llega también como «contextmenu»
      bar.addEventListener('contextmenu', function(ev) { if (ev && ev.preventDefault) ev.preventDefault(); lpClear(); openMenu(); });
      bar.onclick = function(ev) {
        if (ev && ev.target && ev.target.closest && ev.target.closest('#nexo-pin-menu')) return;
        if (lpFired) { lpFired = false; return; }          // el toque que cierra la pulsación larga no salta
        if (document.getElementById('nexo-pin-menu')) { _closePinMenu(); return; }
        var c = _normId(_getCurrentContactId()), cur = bar.dataset.msgId;
        if (!c || !cur) return;
        _shown[c] = ((Number(bar.dataset.idx) || 0) + 1) % (Number(bar.dataset.count) || 1); // la franja pasa al siguiente fijado
        if (bar.dataset.gone !== '1') jumpToMessage(cur);
        renderPinBar();
      };
    }
    if (bar.parentNode !== header.parentNode || bar.previousSibling !== header) header.parentNode.insertBefore(bar, header.nextSibling);
    var gone = !!byId[id].deleted;
    bar.dataset.msgId = id; bar.dataset.idx = String(idx); bar.dataset.count = String(live.length); bar.dataset.gone = gone ? '1' : '0';
    _closePinMenu();
    bar.innerHTML = '';
    var ticks = document.createElement('div');
    ticks.className = 'pb-ticks';
    live.forEach(function(x, i) { var s = document.createElement('span'); if (i === idx) s.className = 'on'; ticks.appendChild(s); });
    var ic = document.createElement('span');
    ic.className = 'pb-ico';
    ic.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + PIN_PATH + '</svg>'; // SVG fijo
    var txt = document.createElement('div');
    txt.className = 'pb-txt';
    var lb = document.createElement('div');
    lb.className = 'pb-lbl';
    lb.textContent = t('pin_label', 'Mensaje fijado') + (live.length > 1 ? ' · ' + (idx + 1) + '/' + live.length : '');
    var msg = document.createElement('div');
    msg.className = 'pb-msg';
    msg.textContent = gone ? t('chat_msg_deleted', '🚫 Mensaje eliminado') : _msgSummary(byId[id]).s;
    txt.appendChild(lb); txt.appendChild(msg);
    bar.appendChild(ticks); bar.appendChild(ic); bar.appendChild(txt);
    return bar;
  }).catch(function() { return null; });
}

if (typeof window !== 'undefined') {
  window.addEventListener('nexo:ble:openChat', function() { setTimeout(renderPinBar, 30); });
  window.addEventListener('nexo:ble:closeChat', _removeBar);
  // Un fijado cuyo mensaje aún no había llegado: al llegar algo a ese chat se vuelve a mirar
  var _again = null;
  var _soon = function() { var c = _normId(_getCurrentContactId()); if (!c || !_missing[c] || _again) return; _again = setTimeout(function() { _again = null; renderPinBar(); }, 600); };
  window.addEventListener('nexo:ble:messageReceived', _soon);
  window.addEventListener('nexo:vault:earlyActs', _soon);
  window.__nexoPins = { pinsOf: pinsOf, isPinned: isPinned, unpinId: unpinId, render: renderPinBar }; // gancho de pruebas (fijarmsg.js)
}
