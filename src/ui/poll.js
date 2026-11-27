/**
 * 3361 (plan del dueño 27-11, docs/PLAN_CAPACIDAD_27-11.md §6): ENCUESTAS en el chat (1 a 1 y grupos).
 * - Adjuntar → Más → Encuesta: pregunta + 2 a 10 opciones, una o varias respuestas. Viaja como adjunto 'poll' (cifrado como todo).
 * - Votar = tocar una opción (otra vez la quita). El voto viaja como acción oculta { act:'vote', id, o:[índices], ts } al otro (o a
 *   todo el grupo). Cada teléfono guarda los votos (gana el más nuevo de cada persona) y pinta barras y cuántos.
 * - En un grupo cada copia del mensaje tiene su id (gm…_xxxxxxxx): el voto usa el id común (gm…) para que cuente en todas.
 */
import { t } from './i18n.js';
import { _closeAttachMenu, _showInfoToast } from './ui_bits.js';
import { _normId, _myNexoId, _getCurrentContactId } from './chat_format.js';
import { _sendTextTo } from './send.js';
import { haptic } from './haptics.js';

var _sendAttachment;
export function pollUse(d) { _sendAttachment = d._sendAttachment; }

var KEY = 'nexo_polls', MAX_OPTS = 10, MAX_Q = 200, MAX_O = 100;
var GM_RE = /^(gm[0-9a-z]+)(?:_[0-9a-z]{8})?$/;
var ID_OK = /^[0-9a-zA-Z_]{4,80}$/;

function _all() { try { var o = JSON.parse(localStorage.getItem(KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
function _saveAll(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
function _groups() { return window.bleInterface && window.bleInterface.groups; }
function _esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
export function pollWireId(id) { var m = GM_RE.exec(String(id || '')); return m ? m[1] : String(id || ''); }

// Pregunta y opciones saneadas (vienen del otro teléfono)
export function pollClean(meta) {
  var q = String((meta && meta.q) || '').slice(0, MAX_Q).trim();
  var opts = Array.isArray(meta && meta.opts) ? meta.opts.map(function(x) { return String(x || '').slice(0, MAX_O).trim(); }).filter(Boolean).slice(0, MAX_OPTS) : [];
  if (!q || opts.length < 2) return null;
  return { q: q, opts: opts, multi: !!(meta && meta.multi) };
}

// Votos de una encuesta: { votante: { o:[...], ts } }
export function pollVotes(pid) { return _all()[pollWireId(pid)] || {}; }
function _applyVote(pid, voter, o, ts) {
  var all = _all(), k = pollWireId(pid), v = all[k] || {}, cur = v[voter];
  if (cur && cur.ts >= ts) return false;
  v[voter] = { o: o, ts: ts }; all[k] = v;
  var keys = Object.keys(all); if (keys.length > 500) delete all[keys[0]];
  _saveAll(all);
  return true;
}
export function pollCounts(pid, n) {
  var c = []; for (var i = 0; i < n; i++) c.push(0);
  var v = pollVotes(pid), voters = 0;
  Object.keys(v).forEach(function(who) { var o = v[who].o || []; if (o.length) voters++; o.forEach(function(i) { if (i >= 0 && i < n) c[i]++; }); });
  return { counts: c, voters: voters };
}

// Votar (o quitar) la opción i de la encuesta del mensaje msgId en el chat cid
export function pollVote(cid, msgId, i, meta) {
  var p = pollClean(meta); if (!p || !(i >= 0 && i < p.opts.length)) return false;
  cid = _normId(cid);
  var me = _myNexoId(), pid = pollWireId(msgId), mine = (pollVotes(pid)[me] || { o: [] }).o.slice(), ts = Math.max(Date.now(), ((pollVotes(pid)[me] || {}).ts || 0) + 1);
  var at = mine.indexOf(i);
  if (at >= 0) mine.splice(at, 1); else if (p.multi) mine.push(i); else mine = [i];
  _applyVote(pid, me, mine, ts);
  var act = { type: 'nexo_act', act: 'vote', id: pid, o: mine, ts: ts };
  var gs = _groups(), g = gs && gs.isGroup && gs.isGroup(cid) ? gs.get(cid) : null;
  if (g) { act.g = g.id; var wire = JSON.stringify(act); (g.members || []).forEach(function(nx) { var k = _normId(nx); if (k && k !== me) _sendTextTo(k, wire, '', true); }); }
  else _sendTextTo(cid, JSON.stringify(act), '', true);
  try { haptic('tap'); } catch (e) {}
  _repaint(pid);
  return true;
}

// Llega el voto de otro
export function pollOnAction(senderId, act) {
  var from = _normId(senderId);
  if (!act || !ID_OK.test(String(act.id || '')) || !Array.isArray(act.o) || typeof act.ts !== 'number') return;
  if (act.g) { var gs = _groups(), g = gs && gs.get ? gs.get(String(act.g)) : null; if (!g || !(g.members || []).some(function(nx) { return _normId(nx) === from; })) return; }
  var o = act.o.filter(function(i) { return Number.isInteger(i) && i >= 0 && i < MAX_OPTS; }).slice(0, MAX_OPTS);
  if (_applyVote(String(act.id), from, o, Math.min(act.ts, Date.now() + 60000))) _repaint(pollWireId(act.id));
}

var _cards = {}; // pid → [{ el, meta, cid, msgId }]
function _repaint(pid) { (_cards[pid] || []).forEach(function(c) { if (c.el.isConnected) _fill(c); }); _cards[pid] = (_cards[pid] || []).filter(function(c) { return c.el.isConnected; }); }

function _fill(c) {
  var p = pollClean(c.meta); if (!p) return;
  var pid = pollWireId(c.msgId), me = _myNexoId(), mine = (pollVotes(pid)[me] || { o: [] }).o, cnt = pollCounts(pid, p.opts.length);
  var max = Math.max(1, Math.max.apply(null, cnt.counts));
  var h = '<div class="poll-q" style="font-weight:700;font-size:15px;margin-bottom:4px;">📊 ' + _esc(p.q) + '</div>'
    + '<div style="font-size:12px;color:var(--nx-muted);margin-bottom:8px;">' + _esc(p.multi ? t('poll_multi', 'Puedes elegir varias') : t('poll_single', 'Elige una')) + '</div>';
  p.opts.forEach(function(o, i) {
    var on = mine.indexOf(i) >= 0, n = cnt.counts[i], pct = Math.round(100 * n / max);
    h += '<button class="poll-opt' + (on ? ' on' : '') + '" data-i="' + i + '" style="position:relative;display:flex;align-items:center;gap:8px;width:100%;min-height:44px;margin:4px 0;padding:8px 10px;border-radius:10px;border:1px solid ' + (on ? '#00c8ff' : 'var(--nx-line,#2a2a3a)') + ';background:rgba(255,255,255,0.04);color:inherit;font-size:14px;text-align:left;cursor:pointer;overflow:hidden;">'
      + '<span style="position:absolute;left:0;top:0;bottom:0;width:' + pct + '%;background:rgba(0,200,255,0.18);pointer-events:none;"></span>'
      + '<span style="position:relative;width:18px;flex-shrink:0;">' + (on ? '✓' : '') + '</span>'
      + '<span style="position:relative;flex:1;min-width:0;overflow-wrap:anywhere;">' + _esc(o) + '</span>'
      + '<span class="poll-n" style="position:relative;font-weight:700;">' + n + '</span></button>';
  });
  h += '<div class="poll-voters" style="font-size:12px;color:var(--nx-muted);margin-top:6px;">' + _esc(cnt.voters === 1 ? t('poll_voter1', '1 votó') : t('poll_voters', '{n} votaron').replace('{n}', cnt.voters)) + '</div>';
  c.el.innerHTML = h;
  Array.prototype.forEach.call(c.el.querySelectorAll('.poll-opt'), function(b) {
    b.addEventListener('click', function(e) { e.stopPropagation(); pollVote(c.cid, c.msgId, Number(b.getAttribute('data-i')), c.meta); });
  });
}

// Tarjeta en la burbuja (render.js)
export function renderPollCard(container, meta, msg) {
  var el = document.createElement('div'); el.className = 'poll-card';
  el.style.cssText = 'min-width:220px;max-width:280px;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,0.3);';
  var msgId = msg && (msg.msgId || msg.messageId), cid = _normId((msg && msg.groupId) || _getCurrentContactId());
  var c = { el: el, meta: meta, cid: cid, msgId: msgId };
  var pid = pollWireId(msgId);
  (_cards[pid] = _cards[pid] || []).push(c);
  _fill(c);
  container.appendChild(el);
}

// Hoja para crear la encuesta
export function openPollSheet() {
  try { _closeAttachMenu(); } catch (e) {}
  if (document.getElementById('poll-sheet')) return;
  var ov = document.createElement('div'); ov.id = 'poll-sheet';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center;';
  var box = document.createElement('div');
  box.style.cssText = 'background:var(--nx-surface,#14141c);width:100%;max-width:460px;max-height:90vh;overflow-y:auto;border-radius:18px 18px 0 0;padding:18px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;';
  var inSt = 'width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid var(--nx-line,#2a2a3a);background:#0f0f16;color:#fff;font-size:15px;';
  box.innerHTML = '<b style="font-size:16px;color:#fff;">📊 ' + _esc(t('poll_title', 'Nueva encuesta')) + '</b>'
    + '<input id="poll-q" maxlength="' + MAX_Q + '" placeholder="' + _esc(t('poll_q_ph', 'Pregunta')) + '" style="' + inSt + '">'
    + '<div id="poll-opts" style="display:flex;flex-direction:column;gap:8px;"></div>'
    + '<button id="poll-add" class="nx-btn" style="min-height:44px;">＋ ' + _esc(t('poll_add', 'Agregar opción')) + '</button>'
    + '<label style="display:flex;align-items:center;gap:10px;min-height:44px;color:#ddd;font-size:14px;"><input id="poll-multi" type="checkbox" style="width:22px;height:22px;"> ' + _esc(t('poll_multi_lbl', 'Permitir varias respuestas')) + '</label>'
    + '<div style="display:flex;gap:10px;"><button id="poll-cancel" class="nx-btn" style="flex:1;min-height:44px;">' + _esc(t('chat_cancel', 'Cancelar')) + '</button>'
    + '<button id="poll-send" class="nx-btn nx-btn-primary" style="flex:2;min-height:44px;">' + _esc(t('poll_send', 'Enviar encuesta')) + '</button></div>';
  ov.appendChild(box); document.body.appendChild(ov);
  var optsBox = box.querySelector('#poll-opts');
  var addOpt = function() {
    if (optsBox.children.length >= MAX_OPTS) return;
    var i = document.createElement('input'); i.className = 'poll-o'; i.maxLength = MAX_O; i.style.cssText = inSt;
    i.placeholder = t('poll_opt_ph', 'Opción {n}').replace('{n}', optsBox.children.length + 1);
    optsBox.appendChild(i);
  };
  addOpt(); addOpt();
  var close = function() { if (ov.parentNode) ov.parentNode.removeChild(ov); };
  ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
  box.querySelector('#poll-cancel').addEventListener('click', close);
  box.querySelector('#poll-add').addEventListener('click', addOpt);
  box.querySelector('#poll-send').addEventListener('click', function() {
    var meta = pollClean({ q: box.querySelector('#poll-q').value, opts: Array.prototype.map.call(optsBox.querySelectorAll('.poll-o'), function(x) { return x.value; }), multi: box.querySelector('#poll-multi').checked });
    if (!meta) { _showInfoToast(t('poll_need', 'Escribe la pregunta y al menos 2 opciones.'), 2600); return; }
    close();
    sendPoll(meta);
  });
  setTimeout(function() { try { box.querySelector('#poll-q').focus(); } catch (e) {} }, 50);
}

export function sendPoll(meta, opts) {
  var p = pollClean(meta);
  if (!p || typeof _sendAttachment !== 'function') return false;
  _sendAttachment('poll', JSON.stringify(p), p, opts);
  console.log('[ATTACH] Encuesta enviada: ' + p.opts.length + ' opciones'); // i18n-ok: registro
  return true;
}

if (typeof window !== 'undefined') { window.NEXO_sendPoll = sendPoll; window.NEXO_pollVote = pollVote; window.NEXO_pollCounts = pollCounts; window.NEXO_openPollSheet = openPollSheet; }
