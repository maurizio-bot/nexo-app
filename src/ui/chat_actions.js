/**
 * NEXO — Acciones del chat (sacadas de main.js en la ronda 2752, sin cambios en su código): burbuja de texto con su
 * cita, menú de la burbuja (responder, reenviar, copiar, eliminar para mí / para todos), barra de respuesta, hoja de
 * reenvío y aplicar el "eliminar para todos" que llega. Lo que usa del resto de la app se lo da main.js.
 */
import { applyAvatar } from './avatar.js';
import { applyStatus } from './estados.js';
import { _PREVIEW_BY_TYPE, _chatKind, _contactName, _cut, _findMessage, _getCurrentContactId, _msgSummary, _myNexoId, _normId, _peerUnderstands, _plainText } from './chat_format.js';
import { _showInfoToast } from './ui_bits.js';
import { _videoFormat } from './video_tools.js';
import { vaultBlankMessage, vaultDeleteMessage, vaultEditMessage, vaultLoadContacts, vaultLoadFile, vaultLoadMessages, vaultReactMessage, vaultSaveContacts } from '../vault/vault_manager.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _renderMessage, _sendAttachment, _sendTextTo;
export function chatActionsUse(d) { _renderMessage = d._renderMessage; _sendAttachment = d._sendAttachment; _sendTextTo = d._sendTextTo; } // [/pegamento]


export var _renderedMessageIds = new Set();

// ===================== v9.9.45: chat tipo WhatsApp: responder, reenviar, eliminar, copiar =====================
// Mantener pulsada una burbuja (o clic derecho) abre el menú; deslizarla a la derecha responde.
// Formato (solo con contactos 2715+, que lo entienden; a los demás va el texto solo):
//   texto con respuesta o reenviado: {"type":"nexo_txt","t":texto,"rp":{id,a,s,k},"fw":1}
//   eliminar para todos:              {"type":"nexo_act","act":"del","id":msgId}  (no se muestra)
export var _replyTo = null;               // { id, a: autor (NEXO ID), s: resumen, k: tipo }

export var DELETE_ALL_MS = 24 * 3600000;  // "eliminar para todos" hasta 24 h después de enviarlo
export var EDIT_MS = 15 * 60000;           // ronda 2782: editar un mensaje propio hasta 15 min después de enviarlo
export var _editing = null;                // ronda 2782: { id, cid } del mensaje que se está editando (lo lee _doSend)
export var QUICK_REACTION = '❤️';           // ronda 2783: doble toque en un mensaje = reaccionar con este emoji
export var REACTION_SET = ['👍', '❤️', '😂', '😮', '😢', '🙏']; // emojis del menú "Reaccionar"

// Burbuja de texto: eliminado, reenviado, respuesta citada (todo como texto: viene de otro teléfono)
export function _fillTextBubble(contentDiv, msg, isOwn) {
  if (msg.deleted) {
    contentDiv.classList.add('msg-deleted');
    contentDiv.style.fontStyle = 'italic';
    contentDiv.style.opacity = '0.7';
    contentDiv.textContent = isOwn ? '🚫 Eliminaste este mensaje' : '🚫 Se eliminó este mensaje';
    return;
  }
  var raw = msg.content || msg.text || '';
  var k = _chatKind(raw);
  if (!k || k.type !== 'nexo_txt') { contentDiv.textContent = raw; return; }
  if (k.fw) {
    var fw = document.createElement('div');
    fw.className = 'msg-forwarded';
    fw.style.cssText = 'font-size:11px;font-style:italic;opacity:0.7;margin-bottom:2px;';
    fw.textContent = '↪ Reenviado';
    contentDiv.appendChild(fw);
  }
  if (k.rp && k.rp.id) {
    var q = document.createElement('div');
    q.className = 'msg-quote';
    q.style.cssText = 'border-left:3px solid #00c8ff;background:rgba(0,0,0,0.25);border-radius:6px;padding:4px 8px;margin-bottom:4px;cursor:pointer;font-size:12px;';
    var who = document.createElement('div');
    who.style.cssText = 'color:#00c8ff;font-weight:600;';
    who.textContent = _normId(k.rp.a) === _myNexoId() ? 'Tú' : _contactName(k.rp.a);
    var what = document.createElement('div');
    what.style.cssText = 'opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;';
    what.textContent = String(k.rp.s || '');
    q.appendChild(who); q.appendChild(what);
    q.onclick = function(e) { e.stopPropagation(); _scrollToMessage(k.rp.id); };
    contentDiv.appendChild(q);
  }
  var t = document.createElement('span');
  t.className = 'msg-text';
  t.textContent = String(k.t || '');
  contentDiv.appendChild(t);
}

export function _scrollToMessage(id) {
  var el = document.querySelector('.message[data-msg-id="' + id + '"]');
  if (!el) { _showInfoToast('El mensaje citado ya no está en el chat', 2500); return; }
  try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
  el.classList.add('msg-highlight');
  el.style.transition = 'background 0.4s';
  el.style.background = 'rgba(0,200,255,0.25)';
  setTimeout(function() { el.style.background = ''; el.classList.remove('msg-highlight'); }, 1400);
}

// F (informe del dueño 28-10): al deslizar una burbuja para responder no había NINGUNA señal de que el gesto iba bien.
// Ahora aparece una flecha ↩ que crece con el desliz y, al pasar el umbral (ya se va a responder), se ilumina y vibra
// (como WhatsApp). Es solo visual (no toca el mensaje); si no hay getBoundingClientRect/vibrate, no rompe.
var _replyHintArmed = false;
function _showReplyHint(bubble, tx) {
  var h = document.getElementById('nexo-reply-hint');
  if (!h) {
    h = document.createElement('div');
    h.id = 'nexo-reply-hint';
    h.textContent = '↩';
    h.style.cssText = 'position:fixed;z-index:5500;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:19px;color:#fff;pointer-events:none;transition:background .1s,transform .08s;';
    document.body.appendChild(h);
  }
  var rect; try { rect = bubble.getBoundingClientRect(); } catch (e) { rect = { top: 0, height: 40, left: 0, right: 0 }; }
  var prog = Math.min(1, Math.abs(tx) / 60), armed = Math.abs(tx) >= 60;
  h.style.top = (rect.top + rect.height / 2 - 19) + 'px';
  h.style.left = (tx > 0 ? rect.left - 46 : rect.right + 8) + 'px';
  h.style.opacity = String(0.2 + 0.8 * prog);
  h.style.transform = 'scale(' + (0.6 + 0.5 * prog) + ')';
  h.style.background = armed ? 'rgba(0,200,255,0.95)' : 'rgba(255,255,255,0.18)';
  if (armed && !_replyHintArmed) { _replyHintArmed = true; try { if (navigator.vibrate) navigator.vibrate(15); } catch (e) {} }
  else if (!armed) _replyHintArmed = false;
}
function _hideReplyHint() {
  _replyHintArmed = false;
  var h = document.getElementById('nexo-reply-hint');
  if (h) h.remove();
}

export function _setupMessageActions() {
  var mc = document.getElementById('messages-container');
  if (!mc || mc._nexoActions) return;
  mc._nexoActions = true;
  mc.style.touchAction = 'pan-y';
  var timer = null, startX = 0, startY = 0, target = null, swiping = false, fired = false, lastTapId = null, lastTapAt = 0;
  var bubbleOf = function(e) {
    var m = e.target && e.target.closest ? e.target.closest('.message') : null;
    return (m && m.dataset.msgId && !m.classList.contains('progress-placeholder')) ? m : null;
  };
  mc.addEventListener('pointerdown', function(e) {
    var m = bubbleOf(e);
    if (!m) return;
    target = m; startX = e.clientX; startY = e.clientY; swiping = false; fired = false;
    clearTimeout(timer);
    timer = setTimeout(function() { fired = true; _openMsgMenu(m); }, 500);
  });
  mc.addEventListener('pointermove', function(e) {
    if (!target) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(timer);
    // Deslizar la burbuja = responder. A la derecha (lejos del borde izquierdo, que es "volver") o a la izquierda
    // (lo que pidió el dueño): en ambos sentidos.
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5 && (dx > 0 ? startX > 40 : true)) {
      swiping = true;
      var tx = dx > 0 ? Math.min(dx, 80) : Math.max(dx, -80);
      target.style.transform = 'translateX(' + tx + 'px)';
      _showReplyHint(target, tx);
    }
  });
  var end = function(e) {
    clearTimeout(timer);
    if (!target) return;
    var t = target;
    var dx = (typeof e.clientX === 'number' ? e.clientX : startX) - startX;
    var dy = (typeof e.clientY === 'number' ? e.clientY : startY) - startY;
    target = null;
    if (swiping) {
      swiping = false;
      _hideReplyHint();
      t.style.transition = 'transform 0.15s';
      t.style.transform = '';
      setTimeout(function() { t.style.transition = ''; }, 200);
      if (Math.abs(dx) > 60) _startReply(t.dataset.msgId);   // responder deslizando (izquierda o derecha)
      return;
    }
    // Doble toque en la burbuja = reaccionar con ❤️ (en fotos/vídeos no: ahí el doble toque amplía en el visor)
    if (!fired && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      var now = Date.now(), id = t.dataset.msgId;
      if (lastTapId === id && now - lastTapAt < 320) { lastTapId = null; lastTapAt = 0; _doubleTapBubble(t); }
      else { lastTapId = id; lastTapAt = now; }
    }
  };
  mc.addEventListener('pointerup', end);
  mc.addEventListener('pointercancel', end);
  mc.addEventListener('contextmenu', function(e) {
    var m = bubbleOf(e);
    if (!m) return;
    e.preventDefault();
    if (!fired) _openMsgMenu(m);
  });
  // Tras abrir el menú con una pulsación larga no se abre además la foto o el vídeo
  mc.addEventListener('click', function(e) { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } }, true);
}

// Ronda 2783: doble toque en una burbuja de texto = reaccionar con ❤️. En fotos/vídeos no (ahí el doble toque amplía
// en el visor a pantalla completa, file_card.js).
function _doubleTapBubble(div) {
  var id = div && div.dataset.msgId, cid = _getCurrentContactId();
  if (!id || !cid) return;
  _findMessage(cid, id).then(function(m) {
    if (!m || m.deleted || m.attachmentType) return;
    _reactTo(cid, id, QUICK_REACTION);
  });
}

export function _openMsgMenu(div) {
  var id = div && div.dataset.msgId, cid = _getCurrentContactId();
  if (!id || !cid) return;
  _findMessage(cid, id).then(function(msg) {
    if (!msg) return;
    var old = document.getElementById('nexo-msg-menu');
    if (old) old.remove();
    var isOwn = !!msg._own, deleted = !!msg.deleted;
    var box = document.createElement('div');
    box.id = 'nexo-msg-menu';
    box.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;justify-content:center;';
    var sheet = document.createElement('div');
    sheet.style.cssText = 'background:#14152a;color:#fff;width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:8px 0 14px;';
    var close = function() { box.remove(); div.style.background = ''; };
    var add = function(label, cls, fn, danger) {
      var b = document.createElement('button');
      b.className = 'mm-item ' + cls;
      b.textContent = label;
      b.style.cssText = 'display:block;width:100%;text-align:left;padding:14px 20px;background:none;border:none;font-size:16px;color:' + (danger ? '#ff6b6b' : '#fff') + ';';
      b.onclick = function(e) { e.stopPropagation(); close(); fn(); };
      sheet.appendChild(b);
    };
    if (!deleted) {
      // Ronda 2783: barra de reacciones arriba del menú (como WhatsApp)
      var rbar = document.createElement('div');
      rbar.style.cssText = 'display:flex;justify-content:space-around;align-items:center;padding:10px 12px 12px;border-bottom:1px solid rgba(255,255,255,0.08);';
      REACTION_SET.forEach(function(e) {
        var rb = document.createElement('button');
        rb.className = 'mm-react';
        rb.textContent = e;
        rb.style.cssText = 'background:none;border:none;font-size:27px;line-height:1;padding:4px 6px;cursor:pointer;';
        rb.onclick = function(ev) { ev.stopPropagation(); close(); _reactTo(cid, id, e); };
        rbar.appendChild(rb);
      });
      sheet.appendChild(rbar);
    }
    if (!deleted) add('↩  Responder', 'mm-reply', function() { _startReply(id, msg); });
    if (!deleted) add('↪  Reenviar', 'mm-forward', function() { _openForwardSheet(msg); });
    if (!deleted && !msg.attachmentType) add('⧉  Copiar', 'mm-copy', function() { _copyText(_plainText(msg.content)); });
    if (isOwn && !deleted && !msg.attachmentType && Date.now() - (msg.timestamp || 0) < EDIT_MS && _peerUnderstands(cid)) {
      add('✏️  Editar', 'mm-edit', function() { _startEdit(id, msg); });
    }
    add('🗑  Eliminar para mí', 'mm-del-me', function() { _deleteForMe(cid, id); }, true);
    if (isOwn && !deleted && Date.now() - (msg.timestamp || 0) < DELETE_ALL_MS && _peerUnderstands(cid)) {
      add('🗑  Eliminar para todos', 'mm-del-all', function() { _deleteForAll(cid, msg); }, true);
    }
    add('Cancelar', 'mm-cancel', function() {});
    box.onclick = function(e) { if (e.target === box) close(); };
    box.appendChild(sheet);
    div.style.background = 'rgba(0,200,255,0.12)';
    document.body.appendChild(box);
  });
}

export function _startReply(id, msg) {
  var cid = _getCurrentContactId();
  if (!id || !cid) return;
  (msg ? Promise.resolve(msg) : _findMessage(cid, id)).then(function(m) {
    if (!m || m.deleted) return;
    var sum = _msgSummary(m);
    _replyTo = { id: id, a: m._own ? _myNexoId() : _normId(m.senderNexoId || cid), s: sum.s, k: sum.k };
    _renderReplyBar();
    var input = document.getElementById('message-input');
    if (input) input.focus();
  });
}

export function _cancelReply() { _replyTo = null; _renderReplyBar(); }

export function _renderReplyBar() {
  var old = document.getElementById('reply-bar');
  if (old) old.remove();
  if (!_replyTo) return;
  var area = document.getElementById('input-area');
  if (!area || !area.parentNode) return;
  var bar = document.createElement('div');
  bar.id = 'reply-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 10px 4px;padding:6px 10px;border-left:3px solid #00c8ff;background:rgba(255,255,255,0.08);border-radius:8px;color:#fff;font-size:13px;';
  var txt = document.createElement('div');
  txt.style.cssText = 'flex:1;min-width:0;';
  var who = document.createElement('div');
  who.style.cssText = 'color:#00c8ff;font-weight:600;';
  who.textContent = 'Respondiendo a ' + (_replyTo.a === _myNexoId() ? 'ti' : _contactName(_replyTo.a));
  var what = document.createElement('div');
  what.style.cssText = 'opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  what.textContent = _replyTo.s;
  txt.appendChild(who); txt.appendChild(what);
  var x = document.createElement('button');
  x.className = 'reply-cancel';
  x.textContent = '✕';
  x.style.cssText = 'background:none;border:none;color:#fff;font-size:18px;padding:4px 8px;';
  x.onclick = _cancelReply;
  bar.appendChild(txt); bar.appendChild(x);
  area.parentNode.insertBefore(bar, area);
}

// Ronda 2782: editar un mensaje propio. Pone su texto en la caja y, al enviar, _doSend manda la edición (no uno nuevo).
export function _startEdit(id, msg) {
  var cid = _getCurrentContactId();
  if (!id || !cid) return;
  _cancelReply();
  _editing = { id: id, cid: _normId(cid) };
  var input = document.getElementById('message-input');
  if (input) { input.value = _plainText(msg.content); try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} input.focus(); }
  _renderEditBar();
}

export function _cancelEdit() {
  _editing = null;
  _renderEditBar();
  var input = document.getElementById('message-input');
  if (input) { input.value = ''; try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
}

export function _renderEditBar() {
  var old = document.getElementById('edit-bar');
  if (old) old.remove();
  if (!_editing) return;
  var area = document.getElementById('input-area');
  if (!area || !area.parentNode) return;
  var bar = document.createElement('div');
  bar.id = 'edit-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 10px 4px;padding:6px 10px;border-left:3px solid #ffc107;background:rgba(255,255,255,0.08);border-radius:8px;color:#fff;font-size:13px;';
  var txt = document.createElement('div');
  txt.style.cssText = 'flex:1;min-width:0;color:#ffc107;font-weight:600;';
  txt.textContent = '✏️ Editando mensaje';
  var x = document.createElement('button');
  x.className = 'edit-cancel';
  x.textContent = '✕';
  x.style.cssText = 'background:none;border:none;color:#fff;font-size:18px;padding:4px 8px;';
  x.onclick = _cancelEdit;
  bar.appendChild(txt); bar.appendChild(x);
  area.parentNode.insertBefore(bar, area);
}

export function _copyText(text) {
  var ok = function() { _showInfoToast('Copiado', 1500); };
  var fallback = function() {
    try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok(); } catch (e) {}
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok).catch(fallback);
  else fallback();
}

export function _openForwardSheet(msg) {
  var old = document.getElementById('nexo-forward-sheet');
  if (old) old.remove();
  var all = (vaultLoadContacts() || []).filter(function(c) { return c && (c.nexoId || c.deviceUUID); });
  var chosen = {};
  var box = document.createElement('div');
  box.id = 'nexo-forward-sheet';
  box.style.cssText = 'position:fixed;inset:0;z-index:6000;background:#0a0a15;color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;';
  var head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';
  var title = document.createElement('div');
  title.style.cssText = 'font-size:18px;font-weight:700;';
  title.textContent = 'Reenviar a…';
  var cancel = document.createElement('button');
  cancel.textContent = 'Cancelar';
  cancel.style.cssText = 'background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:16px;padding:8px 14px;';
  cancel.onclick = function() { box.remove(); };
  head.appendChild(title); head.appendChild(cancel);
  var list = document.createElement('div');
  list.style.cssText = 'flex:1;overflow-y:auto;';
  var send = document.createElement('button');
  send.className = 'fw-send';
  send.style.cssText = 'margin-top:12px;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;font-size:15px;font-weight:600;';
  var refresh = function() { var n = Object.keys(chosen).length; send.textContent = n ? 'Reenviar (' + n + ')' : 'Elige uno o más chats'; send.disabled = !n; };
  all.forEach(function(c) {
    var id = _normId(c.nexoId || c.deviceUUID);
    var row = document.createElement('label');
    row.className = 'fw-row';
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid rgba(255,255,255,0.06);';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.onchange = function() { if (cb.checked) chosen[id] = true; else delete chosen[id]; refresh(); };
    var nm = document.createElement('span');
    nm.className = 'fw-name';
    nm.textContent = c.name || id.toUpperCase();
    row.appendChild(cb); row.appendChild(nm);
    list.appendChild(row);
  });
  send.onclick = function() {
    var ids = Object.keys(chosen);
    if (!ids.length) return;
    box.remove();
    Promise.all(ids.map(function(cid) { return _forwardTo(cid, msg); })).then(function() {
      _showInfoToast('Reenviado a ' + ids.length + (ids.length === 1 ? ' chat' : ' chats'), 2000);
    });
  };
  refresh();
  box.appendChild(head); box.appendChild(list); box.appendChild(send);
  document.body.appendChild(box);
}

export async function _forwardTo(cid, msg) {
  if (msg.attachmentType) {
    var payload = msg.attachmentPayload;
    if (!payload && msg.attachmentRef) payload = await vaultLoadFile(msg.attachmentRef);
    var meta = Object.assign({}, msg.attachmentMeta || {});
    // Vídeo propio: el original (HD) si está guardado
    if (msg.attachmentType === 'video' && msg.hdRef) {
      var hd = await vaultLoadFile(msg.hdRef);
      if (hd) { payload = hd; if (msg.hdMime) { meta.mime = msg.hdMime; meta.format = _videoFormat(msg.hdMime); } }
    }
    if (meta.big) { _showInfoToast('Los archivos grandes todavía no se pueden reenviar', 2500); return; }
    ['preview', 'hdSize', 'hdFor', 'hd', 'wdOnly', 'fwd'].forEach(function(k) { delete meta[k]; });
    if (!payload) { _showInfoToast('No se pudo reenviar: el archivo ya no está', 2500); return; }
    console.log('[ATTACH] Reenviando ' + msg.attachmentType + ' a ' + cid);
    _sendAttachment(msg.attachmentType, payload, meta, { contactId: cid });
    return;
  }
  var text = _plainText(msg.content);
  var wire = _peerUnderstands(cid) ? JSON.stringify({ type: 'nexo_txt', t: text, fw: 1 }) : text;
  _sendTextTo(cid, wire, text);
}

// Vista previa de la lista de chats según el último mensaje que queda (lo eliminado no se ve ahí)
export function _refreshChatPreview(cid) {
  return vaultLoadMessages(cid).then(function(list) {
    var last = null;
    (list || []).forEach(function(m) { if (!m.hidden && (!last || (m.timestamp || 0) >= (last.timestamp || 0))) last = m; });
    var contacts = vaultLoadContacts() || [];
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === _normId(cid); });
    if (!c) return;
    c.lastMessage = !last ? '' : last.deleted ? '🚫 Mensaje eliminado' : last.attachmentType ? (_PREVIEW_BY_TYPE[last.attachmentType] || '📎 Archivo') : _cut(_plainText(last.content), 50);
    vaultSaveContacts(contacts);
    var bi = window.bleInterface;
    if (bi && typeof bi.renderContactsList === 'function') bi.renderContactsList();
  }).catch(function() {});
}

export function _deleteForMe(cid, id) {
  var el = document.querySelector('.message[data-msg-id="' + id + '"]');
  if (el) el.remove();
  _renderedMessageIds.delete(id);
  if (_replyTo && _replyTo.id === id) _cancelReply();
  vaultDeleteMessage(cid, id).then(function() { return _refreshChatPreview(cid); }).catch(function() {});
  console.log('[CHAT] Mensaje eliminado para mí');
}

export function _deleteForAll(cid, msg) {
  var id = msg.msgId || msg.messageId;
  _sendTextTo(cid, JSON.stringify({ type: 'nexo_act', act: 'del', id: id }), '', true);
  vaultBlankMessage(cid, id).then(function() { _rerenderBlank(id, msg); return _refreshChatPreview(cid); }).catch(function() {});
  console.log('[CHAT] Mensaje eliminado para todos');
}

export function _rerenderBlank(id, msg) {
  var el = document.querySelector('.message[data-msg-id="' + id + '"]');
  if (!el) return;
  el.remove();
  _renderedMessageIds.delete(id);
  _renderMessage(Object.assign({}, msg, { deleted: true, content: '', attachmentType: null, attachmentPayload: null, attachmentRef: null, attachmentMeta: null }), true);
}

// Ronda 2782: editar un mensaje propio ya enviado (manda la edición al otro y la aplica aquí)
export function _editForAll(cid, id, newText) {
  _sendTextTo(cid, JSON.stringify({ type: 'nexo_act', act: 'edit', id: id, t: newText }), '', true);
  vaultEditMessage(cid, id, newText).then(function() { _rerenderEdited(cid, id, newText); return _refreshChatPreview(cid); }).catch(function() {});
  console.log('[CHAT] Mensaje editado');
}

export function _rerenderEdited(cid, id, newText) {
  _findMessage(cid, id).then(function(m) {
    if (!m) return;
    var el = document.querySelector('.message[data-msg-id="' + id + '"]');
    if (el) { el.remove(); _renderedMessageIds.delete(id); }
    _renderMessage(Object.assign({}, m, { content: newText, edited: true }), true);
  });
}

// ===================== Ronda 2783: reaccionar con un emoji =====================
// Doble toque en un mensaje = ❤️ (QUICK_REACTION). El menú "Reaccionar" permite elegir otro. Se guarda en el vault
// (reactions: { NEXO ID de quien reacciona: emoji }) y, si el contacto lo entiende, se le manda la acción oculta
// {type:'nexo_act',act:'react',id,e}. Volver a tocar el mismo emoji lo quita (e:''). Igual por Bluetooth/Wi-Fi/internet.
export function _reactTo(cid, msgId, emoji) {
  cid = _normId(cid);
  if (!cid || !msgId) return;
  _findMessage(cid, msgId).then(function(m) {
    if (!m || m.deleted) return;
    var me = _myNexoId();
    var cur = (m.reactions && m.reactions[me]) || '';
    var next = (cur === emoji) ? '' : emoji;            // el mismo otra vez = quitar
    if (_peerUnderstands(cid)) _sendTextTo(cid, JSON.stringify({ type: 'nexo_act', act: 'react', id: msgId, e: next }), '', true);
    vaultReactMessage(cid, msgId, me, next).then(function() { _rerenderReactions(cid, msgId); });
  });
}

export function _rerenderReactions(cid, msgId) {
  _findMessage(_normId(cid), msgId).then(function(m) {
    var el = document.querySelector('.message[data-msg-id="' + msgId + '"]');
    if (el && m) _renderReactions(el, m.reactions, !!m._own);
  });
}

// Dibuja (o actualiza) la fila de reacciones de una burbuja. Agrupa por emoji con su cuenta y resalta el mío.
export function _renderReactions(msgEl, reactions, isOwn) {
  if (!msgEl) return;
  var old = msgEl.querySelector('.msg-reactions');
  if (old) old.remove();
  var keys = reactions ? Object.keys(reactions) : [];
  if (!keys.length) return;
  var counts = {};
  keys.forEach(function(k) { var e = reactions[k]; if (e) counts[e] = (counts[e] || 0) + 1; });
  var emojis = Object.keys(counts);
  if (!emojis.length) return;
  var mine = (reactions[_myNexoId()]) || '';
  var row = document.createElement('div');
  row.className = 'msg-reactions';
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;' + (isOwn ? 'justify-content:flex-end;' : '');
  emojis.forEach(function(e) {
    var pill = document.createElement('span');
    pill.className = 'reaction-pill' + (e === mine ? ' mine' : '');
    pill.style.cssText = 'background:' + (e === mine ? 'rgba(0,200,255,0.28)' : 'rgba(255,255,255,0.12)') + ';border-radius:12px;padding:1px 7px;font-size:13px;line-height:1.5;';
    pill.textContent = counts[e] > 1 ? (e + ' ' + counts[e]) : e;
    row.appendChild(pill);
  });
  msgEl.appendChild(row);
}

// Recibido: el contacto eliminó para todos uno de SUS mensajes
export function _applyChatAction(senderId, act) {
  if (act && act.act === 'av') { applyAvatar(senderId, act); return; } // ronda 2765: foto de perfil (avatar.js)
  if (act && act.act === 'st') { applyStatus(senderId, act); return; } // ronda 2799: Estado (Stream fase 1, estados.js)
  // Ronda 2782: el contacto editó uno de SUS mensajes de texto
  if (act && act.act === 'edit' && act.id && typeof act.t === 'string') {
    var cide = _normId(senderId);
    _findMessage(cide, act.id).then(function(m) {
      if (!m || m._own || m.deleted || m.attachmentType) return; // solo texto suyo, no borrado
      return vaultEditMessage(cide, act.id, act.t).then(function() {
        if (_normId(_getCurrentContactId()) === cide) _rerenderEdited(cide, act.id, act.t);
        return _refreshChatPreview(cide);
      });
    });
    return;
  }
  // Ronda 2783: el contacto reaccionó a un mensaje con un emoji
  if (act && act.act === 'react' && act.id && typeof act.e === 'string') {
    var cidr = _normId(senderId);
    vaultReactMessage(cidr, act.id, cidr, act.e).then(function(ok) {
      if (ok && _normId(_getCurrentContactId()) === cidr) _rerenderReactions(cidr, act.id);
    });
    return;
  }
  if (!act || act.act !== 'del' || !act.id) return;
  var cid = _normId(senderId);
  _findMessage(cid, act.id).then(function(m) {
    if (!m || m._own || m.deleted) return; // solo mensajes que escribió quien lo pide
    console.log('[CHAT] ' + cid + ' eliminó un mensaje para todos');
    return vaultBlankMessage(cid, act.id).then(function() {
      if (_normId(_getCurrentContactId()) === cid) _rerenderBlank(act.id, m);
      return _refreshChatPreview(cid);
    });
  });
}
