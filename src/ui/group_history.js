/**
 * HISTORIAL PARA LOS NUEVOS (dueño 24-11, opción B): quien entra a un grupo puede pedir los mensajes anteriores con un botón
 * («📜 Ver mensajes anteriores»: en el chat del grupo si acaba de entrar, y siempre en el ⋮ del grupo). Lo deciden los administradores
 * en Ajustes del grupo → Opciones («Los nuevos ven los mensajes anteriores»), ACTIVADO de entrada (estado firmado: hx = 1 lo cierra).
 * - Se pide a UN miembro (el que me agregó primero; si no contesta en 25 s, al siguiente que esté a mi alcance): acción oculta 1-a-1
 *   cifrada de punta a punta como todo, por cualquier camino { type:'nexo_act', act:'ghq', g, since }.
 * - El que contesta (si el grupo lo permite, quien pide es miembro y no se lo pidió hace < 10 min) manda lo de los últimos 30 días, hasta
 *   500 mensajes: textos, fotos, audios y archivos de hasta 200 KB (lo más grande va como aviso: «📎 archivo no incluido»), en partes de
 *   ~250 KB: { act:'ghr', g, p, n, it:[{ i, f, ts, c, at, ap, am }] }.
 * - No viajan los avisos que cada teléfono se pone a sí mismo (ids «gsn…»: «Te agregaron al grupo», «Nuevo en el grupo: …»).
 * - Quien lo recibe lo guarda en el chat del grupo con el id que tendría (id del grupo + mis 8 letras: no se repite lo que ya tengo),
 *   marcado hist:1 (y de quién vino), sin avisos ni «no leídos». Solo de un miembro del grupo y para un grupo en el que estoy.
 * Aviso de seguridad (para la auditoría final): el historial lo manda UN miembro; no hay firma por mensaje, así que ese miembro podría
 * inventar lo que otro dijo antes de que yo entrara (como cualquier copia de un historial). Se marca de quién vino.
 */
import { t } from './i18n.js';
import { _sendTextTo } from './send.js';

var DAY = 86400000;
export var HIST_DAYS = 30, HIST_MAX = 500, HIST_ATT_MAX = 200 * 1024, HIST_PART = 250 * 1024, HIST_WAIT_MS = 25000, HIST_GAP_MS = 10 * 60000;
var NX_RE = /^nx[0-9a-z]{8}$/, GID_RE = /^gr[0-9a-z]{8}$/, ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
var _served = {};     // gid|nx → cuándo le contesté (freno)
var _asking = {};     // gid → { order, idx, timer, got }

function _n(x) { return (x || '').toString().toLowerCase().trim(); }
function _bi() { return typeof window !== 'undefined' ? window.bleInterface : null; }
function _gs() { var b = _bi(); return b && b.groups; }
function _me() { var b = _bi(); return _n(b && b.localNexoId); }
function _emit(n, d) { try { window.dispatchEvent(new CustomEvent(n, { detail: d })); } catch (e) {} }
function _toast(s) { try { if (window.NEXO_toast) window.NEXO_toast(s); } catch (e) {} }
function _base(id) { return String(id || '').replace(/_[0-9a-z]{8}$/, ''); }

// ¿El grupo deja que los nuevos vean lo anterior? (estado firmado: hx = 1 lo cierra; un grupo viejo, sin estado, sí)
export function historyAllowed(gid) {
  var gs = _gs(); if (!gs) return false;
  var s = typeof gs.state === 'function' ? gs.state(gid) : null;
  return !(s && s.hx);
}
// ¿Enseño el botón en el chat? Entré yo por invitación hace menos de 30 días, aún no lo traje y el grupo lo permite
export function historyOffer(gid) {
  var gs = _gs(), g = gs && gs.get(gid);
  if (!g || g.left || g.kicked || g.inv || !g.joinedAt || g.histGot) return false;
  return Date.now() - g.joinedAt < HIST_DAYS * DAY && historyAllowed(gid);
}

// ---------- pedir ----------
export function requestHistory(gid) {
  var gs = _gs(), g = gs && gs.get(gid), me = _me(), bi = _bi();
  if (!g || g.left || g.kicked || !me) return false;
  if (!historyAllowed(gid)) { _toast(t('grp_hist_closed', 'Este grupo no comparte los mensajes anteriores con quien entra')); return false; }
  var others = (g.members || []).filter(function(x) { return x !== me && NX_RE.test(x); });
  var reach = function(nx) { try { return bi && typeof bi.linkOf === 'function' && bi.linkOf(nx) !== 'none'; } catch (e) { return false; } };
  var order = [];
  if (g.joinBy && others.indexOf(g.joinBy) >= 0) order.push(g.joinBy);
  others.filter(reach).forEach(function(x) { if (order.indexOf(x) < 0) order.push(x); });
  others.forEach(function(x) { if (order.indexOf(x) < 0) order.push(x); });
  if (!order.length) return false;
  var prev = _asking[gid]; if (prev && prev.timer) clearTimeout(prev.timer);
  _asking[gid] = { order: order, idx: 0, timer: null, got: 0 };
  _toast(t('grp_hist_asking', '📜 Pidiendo los mensajes anteriores…'));
  _askNext(gid);
  return true;
}
function _askNext(gid) {
  var a = _asking[gid];
  if (!a || a.got) return;
  if (a.idx >= a.order.length) { delete _asking[gid]; _toast(t('grp_hist_none', 'Nadie del grupo pudo mandar los mensajes anteriores ahora. Prueba más tarde.')); return; }
  var nx = a.order[a.idx++];
  console.log('[GROUP] Historial de ' + gid + ': se lo pido a ' + nx);
  _sendTextTo(nx, JSON.stringify({ type: 'nexo_act', act: 'ghq', g: gid, since: Date.now() - HIST_DAYS * DAY }), '', true);
  a.timer = setTimeout(function() { a.timer = null; if (!a.got) _askNext(gid); }, HIST_WAIT_MS);
}

// ---------- contestar ----------
export function onHistoryQuery(from, act) {
  var gs = _gs(), nx = _n(from), gid = _n(act && act.g), me = _me();
  var g = gs && GID_RE.test(gid) ? gs.get(gid) : null;
  if (!g || g.left || g.kicked || g.inv || !NX_RE.test(nx) || (g.members || []).indexOf(nx) < 0 || (g.members || []).indexOf(me) < 0) { console.warn('[GROUP] Petición de historial de ' + nx + ' para ' + gid + ' descartada (no es miembro o el grupo no está)'); return; }
  if (!historyAllowed(gid)) { console.log('[GROUP] Historial de ' + gid + ' cerrado para los nuevos: no lo mando a ' + nx); return; }
  var key = gid + '|' + nx, now = Date.now();
  if (now - (_served[key] || 0) < HIST_GAP_MS) { console.log('[GROUP] Historial de ' + gid + ' ya mandado a ' + nx + ' hace poco'); return; }
  _served[key] = now;
  var since = Math.max(Number(act.since) || 0, now - HIST_DAYS * DAY);
  var load = window.vaultLoadMessages ? window.vaultLoadMessages(gid) : Promise.resolve([]);
  Promise.resolve(load).then(function(list) {
    var msgs = (list || []).filter(function(m) { return m && !m.hidden && !m.deleted && !m.once && (m.timestamp || 0) >= since && ID_RE.test(String(m.msgId || m.messageId || '')) &&
        String(m.msgId || m.messageId).indexOf('gsn') !== 0; }); // los avisos que cada teléfono se pone a sí mismo («Te agregaron…») no viajan
    msgs.sort(function(a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
    if (msgs.length > HIST_MAX) msgs = msgs.slice(msgs.length - HIST_MAX);
    var hyd = typeof window.vaultHydrateAttachments === 'function' ? window.vaultHydrateAttachments(msgs) : Promise.resolve(msgs);
    return Promise.resolve(hyd).catch(function() { return msgs; });
  }).then(function(msgs) {
    // 3349 (dueño 26-11: «hay imágenes del historial que no se descargan»): una FOTO de más de 200 KB ya no se cambia por el aviso
    // «📎 Archivo grande no incluido»: va una copia reducida (lado ≤ 1280, sacada aquí) o, si no se puede, su miniatura guardada (480);
    // solo si no hay ninguna de las dos va el aviso. Y nunca viajan las marcas locales de la burbuja (thumbOnly/fullRef/lazyRef:
    // nombres de archivos de ESTE teléfono; en el otro la foto se quedaba en miniatura sin poder abrirse).
    return Promise.all((msgs || []).map(function(m) {
      var pl = typeof m.attachmentPayload === 'string' ? m.attachmentPayload : '';
      if (m.attachmentType !== 'image' || !pl || pl.length <= HIST_ATT_MAX * 4 / 3 || (m.attachmentMeta && m.attachmentMeta.once)) return m;
      return _smallImage(m, pl).then(function(s) { return s ? Object.assign({}, m, { attachmentPayload: s, attachmentMeta: Object.assign({}, m.attachmentMeta || {}, { format: 'jpeg', histSmall: 1 }) }) : m; });
    }));
  }).then(function(msgs) {
    var items = (msgs || []).map(function(m) {
      var o = { i: _base(m.msgId || m.messageId), f: m._own ? me : _n(m.senderNexoId), ts: m.timestamp || 0, c: String(m.content || m.text || '') };
      if (m.attachmentType) {
        o.at = m.attachmentType; o.am = _wireMeta(m.attachmentMeta);
        var pl = typeof m.attachmentPayload === 'string' ? m.attachmentPayload : '';
        if (pl && pl.length > 16 && pl.length <= HIST_ATT_MAX * 4 / 3) o.ap = pl;
        else { o.at = null; o.am = null; o.c = '📎 ' + t('grp_hist_big', 'Archivo grande no incluido en el historial') + ((m.attachmentMeta && m.attachmentMeta.name) ? ': ' + String(m.attachmentMeta.name).substring(0, 80) : ''); }
      }
      if (o.c.length > HIST_PART) o.c = o.c.substring(0, 2000);
      return o;
    }).filter(function(o) { return NX_RE.test(o.f); });
    // en partes de ~250 KB
    var parts = [], cur = [], size = 0;
    items.forEach(function(o) { var l = JSON.stringify(o).length; if (cur.length && size + l > HIST_PART) { parts.push(cur); cur = []; size = 0; } cur.push(o); size += l; });
    if (cur.length || !parts.length) parts.push(cur);
    parts.forEach(function(it, k) { _sendTextTo(nx, JSON.stringify({ type: 'nexo_act', act: 'ghr', g: gid, p: k + 1, n: parts.length, it: it }), '', true); });
    console.log('[GROUP] Historial de ' + gid + ' mandado a ' + nx + ': ' + items.length + ' mensaje(s) en ' + parts.length + ' parte(s)');
  }).catch(function(e) { console.warn('[GROUP] No se pudo mandar el historial de ' + gid + ': ' + (e && e.message)); });
}

// 3349: lo de la burbuja que es de ESTE teléfono (o del envío por el buzón) no viaja en el historial
function _wireMeta(am) {
  if (!am || typeof am !== 'object') return null;
  var o = Object.assign({}, am);
  ['thumbOnly', 'fullRef', 'lazyRef', 'blobPtr', 'ptr', 'cita', 'to'].forEach(function(k) { delete o[k]; });
  return o;
}
// 3349: copia reducida de una foto grande para el historial (JPEG, lado ≤ 1280 y que quepa en HIST_ATT_MAX); si no se puede (sin
// lienzo, o tarda), su miniatura guardada (la del chat, 480). null = ninguna.
export var HIST_IMG_SIDES = [1280, 960, 720];
function _smallImage(m, b64) {
  var id = String(m.msgId || m.messageId || '');
  var thumb = function() {
    var name = 'nexo_thumb_' + id.replace(/[^A-Za-z0-9_-]/g, '_') + '.b64';
    return (typeof window.vaultLoadFile === 'function' ? Promise.resolve(window.vaultLoadFile(name)) : Promise.resolve(null)).then(function(t) {
      return (typeof t === 'string' && t.length > 16 && t.length <= HIST_ATT_MAX * 4 / 3) ? t : null;
    }, function() { return null; });
  };
  return new Promise(function(resolve) {
    var done = false, fin = function(v) { if (!done) { done = true; clearTimeout(tm); resolve(v); } };
    var tm = setTimeout(function() { fin(null); }, 4000);
    try {
      if (typeof document === 'undefined' || typeof Image === 'undefined') { fin(null); return; }
      var img = new Image();
      img.onload = function() {
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!w || !h) { fin(null); return; }
          for (var i = 0; i < HIST_IMG_SIDES.length; i++) {
            var k = Math.min(1, HIST_IMG_SIDES[i] / Math.max(w, h)), c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
            var ctx = c.getContext && c.getContext('2d'); if (!ctx) { fin(null); return; }
            ctx.drawImage(img, 0, 0, c.width, c.height);
            var out = (c.toDataURL('image/jpeg', 0.7) || '').split(',')[1];
            if (out && out.length <= HIST_ATT_MAX * 4 / 3) { fin(out); return; }
          }
          fin(null);
        } catch (e) { fin(null); }
      };
      img.onerror = function() { fin(null); };
      img.src = 'data:image/' + ((m.attachmentMeta && m.attachmentMeta.format) || 'jpeg') + ';base64,' + b64;
    } catch (e) { fin(null); }
  }).then(function(v) { return v || thumb(); }).then(function(v) {
    console.log('[GROUP] Historial: foto ' + id + ' de ' + Math.round(b64.length * 3 / 4 / 1024) + ' KB → ' + (v ? 'copia reducida de ' + Math.round(v.length * 3 / 4 / 1024) + ' KB' : 'sin copia reducida (va el aviso)'));
    return v;
  });
}

// ---------- recibir ----------
export function onHistoryReply(from, act) {
  var gs = _gs(), nx = _n(from), gid = _n(act && act.g), me = _me();
  var g = gs && GID_RE.test(gid) ? gs.get(gid) : null;
  if (!g || g.left || g.kicked || g.inv || !me || (g.members || []).indexOf(nx) < 0 || !Array.isArray(act.it)) { console.warn('[GROUP] Historial de ' + nx + ' para ' + gid + ' descartado'); return; }
  var a = _asking[gid];
  if (a) { a.got = 1; if (a.timer) { clearTimeout(a.timer); a.timer = null; } }
  var now = Date.now(), min = now - (HIST_DAYS + 1) * DAY, mine8 = '_' + me.substring(2);
  var load = window.vaultLoadMessages ? window.vaultLoadMessages(gid) : Promise.resolve([]);
  Promise.resolve(load).then(function(list) {
    var have = {};
    (list || []).forEach(function(m) { have[_base(m.msgId || m.messageId)] = 1; });
    var add = act.it.filter(function(o) {
      return o && ID_RE.test(String(o.i || '')) && NX_RE.test(_n(o.f)) && typeof o.c === 'string' && o.c.length <= HIST_PART &&
        Number(o.ts) > min && Number(o.ts) <= now + 60000 && !have[_base(o.i)];
    }).slice(0, HIST_MAX);
    var chain = Promise.resolve();
    add.forEach(function(o) {
      var f = _n(o.f), own = f === me;
      var vm = { messageId: own ? _base(o.i) : _base(o.i) + mine8, content: o.c, _own: own, status: own ? 'delivered' : 'read', timestamp: Number(o.ts),
        senderName: own ? '' : gs.memberName(f), senderNexoId: own ? me : f, seq: 0, hist: 1, histBy: nx, groupId: gid,
        attachmentType: typeof o.at === 'string' ? o.at : null, attachmentPayload: typeof o.ap === 'string' ? o.ap : null, attachmentMeta: (o.am && typeof o.am === 'object') ? o.am : null };
      have[_base(o.i)] = 1;
      chain = chain.then(function() { return window.vaultAppendMessage ? window.vaultAppendMessage(gid, vm) : null; }).catch(function() {});
    });
    return chain.then(function() { return add.length; });
  }).then(function(n) {
    if (Number(act.p) >= Number(act.n)) { g.histGot = now; if (typeof gs._save === 'function') gs._save(); delete _asking[gid]; }
    console.log('[GROUP] Historial de ' + gid + ' de ' + nx + ': ' + n + ' mensaje(s) nuevos (parte ' + act.p + '/' + act.n + ')');
    if (Number(act.p) >= Number(act.n)) _toast(t('grp_hist_done', '📜 Ya tienes los mensajes anteriores del grupo'));
    _emit('nexo:vault:messagesLoaded', { contactId: gid, history: 1 });
    _emit('nexo:groups', { id: gid });
  });
}

// ---------- botón en el chat del grupo ----------
export function paintHistoryButton(cid) {
  var old = typeof document !== 'undefined' ? document.getElementById('nx-grp-hist') : null;
  var gid = _n(cid);
  if (!GID_RE.test(gid) || !historyOffer(gid)) { if (old) old.remove(); return; }
  if (old) return;
  var b = document.createElement('button');
  b.id = 'nx-grp-hist'; b.type = 'button';
  b.textContent = '📜 ' + t('grp_hist_btn', 'Ver mensajes anteriores');
  b.onclick = function(e) { e.stopPropagation(); if (requestHistory(gid)) b.remove(); };
  document.body.appendChild(b);
}
try {
  if (typeof window !== 'undefined') {
    window.addEventListener('nexo:ble:openChat', function(e) { var d = (e && e.detail) || {}; setTimeout(function() { paintHistoryButton(d.contactId || ''); }, 0); });
    window.addEventListener('nexo:ble:closeChat', function() { paintHistoryButton(''); });
    window.__nexoHist = { request: requestHistory, offer: historyOffer, allowed: historyAllowed };
  }
} catch (e) {}
