/**
 * NEXO — Acciones del chat (sacadas de main.js en la ronda 2752, sin cambios en su código): burbuja de texto con su
 * cita, menú de la burbuja (responder, reenviar, copiar, eliminar para mí / para todos), barra de respuesta, hoja de
 * reenvío y aplicar el "eliminar para todos" que llega. Lo que usa del resto de la app se lo da main.js.
 */
import { findOnAction, findOn } from './find_ui.js';
import { haptic } from './haptics.js'; // NEXO Touch (2968): háptica del sistema
import { applyAvatar, avatarQueryReceived } from './avatar.js';
import { applyContactProfile } from './profile_share.js';
import { psiOnAction } from './psi.js';
import { applyChatWallpaper } from './wallpaper.js';
import { applyStatus, likeReceived, commentReceived, statusQueryReceived, statusMediaRequested } from './estados.js';
import { tttOnAction } from './ttt.js';
import { connect4OnAction } from './connect4.js';
import { tetrisVersusOnAction } from './tetris_versus.js';
import { _PREVIEW_BY_TYPE, _chatKind, _contactName, _cut, _findMessage, _getCurrentContactId, _msgSummary, _myNexoId, _normId, _peerUnderstands, _plainText } from './chat_format.js';
import { _showInfoToast } from './ui_bits.js';
import { _videoFormat } from './video_tools.js';
import { stickerAsset, isValidStickerImg, isValidStickerVid, stickerVideoEl, addReceivedSticker } from './stickers.js';
import { vaultBlankMessage, vaultDeleteMessage, vaultEditMessage, vaultLoadContacts, vaultLoadFile, vaultLoadMessages, vaultReactMessage, vaultSaveContacts } from '../vault/vault_manager.js';
import { _editableText } from '../vault/vault_shared.js'; // 3195: qué contenido es un texto que se edita
import { t } from './i18n.js';
import { _pickAvatar, SHEET_CLOSE_SVG } from './share_contacts.js';
import { isSelecting, startSelect, selectFromBubble } from './msg_select.js'; // 3206: elegir varios mensajes y reenviarlos
import { paintTextWithLinks } from './links.js'; // 3161: enlaces que se tocan (+ tarjeta de TikTok/Instagram/Facebook/YouTube)
import { _isBLEContact } from './ble_helpers.js'; // dueño 23-11: vista previa solo de contactos
import { canStar, toggleStar } from './chat_star.js'; // 3219: mensajes destacados (solo aquí)
import { canPin, chatPinUse, isPinned, pinOnAction, togglePin, unpinId } from './chat_pin.js'; // 3219: fijar mensajes (para los dos)
import { disappearOnAction } from './chat_disappear.js'; // 3360: mensajes temporales
import { pollOnAction } from './poll.js'; // 3361: encuestas
import { onHistoryQuery, onHistoryReply } from './group_history.js'; // historial para los nuevos del grupo (24-11)

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _renderMessage, _sendAttachment, _sendTextTo;
export function chatActionsUse(d) { _renderMessage = d._renderMessage; _sendAttachment = d._sendAttachment; _sendTextTo = d._sendTextTo; chatPinUse(d); } // [/pegamento]


export var _renderedMessageIds = new Set();

// ===================== v9.9.45: chat tipo WhatsApp: responder, reenviar, eliminar, copiar =====================
// Mantener pulsada una burbuja (o clic derecho) abre el menú; deslizarla a la derecha responde.
// Formato (solo con contactos 2715+, que lo entienden; a los demás va el texto solo):
//   texto con respuesta o reenviado: {"type":"nexo_txt","t":texto,"rp":{id,a,s,k},"fw":1}
//   eliminar para todos:              {"type":"nexo_act","act":"del","id":msgId}  (no se muestra)
//   editar (2782; 3195: ts y grupos):  {"type":"nexo_act","act":"edit","id":msgId,"t":texto nuevo,"ts":hora,"g":grupo si es de grupo}
var _replyCid = '';                     // 24-11 (dueño): de qué chat es la respuesta (no viaja en el mensaje)
export var _replyTo = null;               // { id, a: autor (NEXO ID), s: resumen, k: tipo }

export var DELETE_ALL_MS = 24 * 3600000;  // "eliminar para todos" hasta 24 h después de enviarlo
export var EDIT_MS = 15 * 60000;           // ronda 2782: editar un mensaje propio hasta 15 min después de enviarlo
export var EDIT_GRACE_MS = 2 * 60000;      // 3195: margen para escribir la edición si se abrió justo antes de los 15 min
export var _editing = null;                // ronda 2782: { id, cid, ts, orig } del mensaje que se está editando (lo lee _doSend)
export var QUICK_REACTION = '❤️';           // ronda 2783: doble toque en un mensaje = reaccionar con este emoji
export var REACTION_SET = ['👍', '❤️', '😂', '😮', '😢', '🙏']; // emojis del menú "Reaccionar"

// Mensaje de SOLO emoji (1–3): se muestra grande y SIN burbuja, como WhatsApp (pedido del dueño 29-10). Devuelve cuántos
// emojis hay (0 = no aplica: hay texto, no hay emoji, o son más de 3). Defensivo: si el navegador no soporta \p{...} o
// Intl.Segmenter, devuelve 0 (comportamiento normal, nunca rompe).
function _emojiOnly(text) {
  var s = String(text == null ? '' : text).trim();
  if (!s) return 0;
  var core = s.replace(/\s+/g, '');
  if (!core) return 0;
  try {
    // Si al quitar pictográficos + combinadores (ZWJ, selector de variación, tonos de piel, banderas) queda algo, hay texto
    if (core.replace(/[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu, '').length > 0) return 0;
    if (!/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/u.test(core)) return 0;
    var n;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) n = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(core)).length;
    else { var m = core.match(/(\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|[️\u{1F3FB}-\u{1F3FF}])*)|([\u{1F1E6}-\u{1F1FF}]{2})/gu); n = m ? m.length : 1; }
    return (n >= 1 && n <= 3) ? n : 0;
  } catch (e) { return 0; }
}
try { if (typeof window !== 'undefined') window.__nexoEmojiOnly = _emojiOnly; } catch (e) {} // gancho de pruebas (función pura)

// Burbuja de texto: eliminado, reenviado, respuesta citada (todo como texto: viene de otro teléfono)
export function _fillTextBubble(contentDiv, msg, isOwn) {
  if (msg.deleted) {
    contentDiv.classList.add('msg-deleted');
    contentDiv.style.fontStyle = 'italic';
    contentDiv.style.opacity = '0.7';
    contentDiv.textContent = isOwn ? t('chat_deleted_by_me', '🚫 Eliminaste este mensaje') : t('chat_deleted', '🚫 Se eliminó este mensaje');
    return;
  }
  var raw = msg.content || msg.text || '';
  var k = _chatKind(raw);
  // Sticker (2829): se dibuja el SVG ESTÁTICO del pack por su ID; nunca bytes del emisor. ID desconocido → emoji de
  // respaldo (jamás el JSON crudo). Sin burbuja: el CSS la quita con :has(.msg-sticker), igual que con fotos/emoji.
  if (k && k.type === 'nexo_sticker') {
    var sp = document.createElement('span');
    sp.className = 'msg-sticker';
    // Sticker PROPIO (2878): lleva imagen. Se VALIDA (formato+tamaño) y se pinta como <img>, NUNCA innerHTML (anti-XSS).
    if (isValidStickerImg(k.img)) {
      var sim = document.createElement('img');
      sim.src = k.img; sim.alt = '';
      sp.appendChild(sim);
    } else if (isValidStickerVid(k.vid)) {
      // 3213: sticker de VIDEO (clip validado, silenciado y en bucle, desde un blob:)
      var sv = stickerVideoEl(k.vid);
      if (sv) sp.appendChild(sv); else sp.textContent = '🎟️';
    } else {
      var path = stickerAsset(k.s);           // sticker del pack: imagen 3D empaquetada (ruta FIJA de confianza, no bytes del emisor)
      if (path) { var pim = document.createElement('img'); pim.src = path; pim.alt = ''; sp.appendChild(pim); }
      else { sp.textContent = '🎟️'; }        // id desconocido / dato inválido → respaldo
    }
    contentDiv.appendChild(sp);
    return;
  }
  if (!k || k.type !== 'nexo_txt') {
    // 3151 (dueño 16-11: «los emoji del teclado… que no tengan burbuja y que sean más grandes, ni se ven»): el emoji grande solo
    // se aplicaba a los textos envueltos (respuesta/reenvío); los mensajes normales llegan en claro y salían con burbuja y a 16 px
    var pj = _emojiOnly(raw);
    // 3161: con enlaces http/https, se tocan (links.js; nodos DOM, nunca HTML); sin enlaces, como siempre
    // Dueño 23-11: vista previa de enlaces solo en lo propio o de un contacto (en grupo, de un miembro que no es contacto: tarjeta sin bajar nada)
    var lkFrom = isOwn ? '' : (msg.senderNexoId || (msg.groupId ? '' : _getCurrentContactId()) || '');
    if (!pj) { if (!paintTextWithLinks(contentDiv, raw, { preview: !!isOwn || (!!lkFrom && _isBLEContact(lkFrom)) })) contentDiv.textContent = raw; return; }
    var pe = document.createElement('span');
    pe.className = 'msg-text emoji-jumbo emoji-' + pj;
    pe.textContent = String(raw).trim();
    contentDiv.appendChild(pe);
    return;
  }
  if (k.fw) {
    var fw = document.createElement('div');
    fw.className = 'msg-forwarded';
    fw.style.cssText = 'font-size:11px;font-style:italic;opacity:0.7;margin-bottom:2px;';
    fw.textContent = t('chat_forwarded', '↪ Reenviado');
    contentDiv.appendChild(fw);
  }
  if (k.rp && k.rp.id) contentDiv.appendChild(_replyQuoteEl(k.rp));
  var ts = document.createElement('span');
  ts.className = 'msg-text';
  if (!paintTextWithLinks(ts, k.t)) ts.textContent = String(k.t || ''); // 3161: enlaces que se tocan
  // Emoji grande sin burbuja: solo si el mensaje es 1–3 emojis sueltos (no reenviado, no respuesta citada). El CSS quita
  // la burbuja con :has(.msg-text.emoji-jumbo), igual que ya hace con las fotos/vídeos.
  var ej = (!k.fw && !(k.rp && k.rp.id)) ? _emojiOnly(k.t) : 0;
  if (ej) ts.classList.add('emoji-jumbo', 'emoji-' + ej);
  contentDiv.appendChild(ts);
}

// 27-11 (dueño: «deslizo para responder, mando un audio y se va solo»): la cita también va en los adjuntos (nota de voz, foto,
// archivo…) en meta.rp. Viene del otro teléfono: solo textos (textContent) y recortados.
export function _replyQuoteEl(rp) {
  var q = document.createElement('div');
  q.className = 'msg-quote';
  q.style.cssText = 'border-left:2px solid var(--nx-cyan,#00c8ff);background:rgba(0,0,0,0.25);border-radius:6px;padding:4px 8px;margin-bottom:4px;cursor:pointer;font-size:12px;';
  var who = document.createElement('div');
  who.style.cssText = 'color:#00c8ff;font-weight:600;';
  who.textContent = _normId(rp.a) === _myNexoId() ? t('chat_you', 'Tú') : _contactName(rp.a);
  var what = document.createElement('div');
  what.style.cssText = 'opacity:0.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;';
  what.textContent = String(rp.s || '').slice(0, 200);
  q.appendChild(who); q.appendChild(what);
  var rid = String(rp.id || '');
  q.onclick = function(e) { e.stopPropagation(); _scrollToMessage(rid); };
  return q;
}
// La respuesta en curso de ESE chat (y se quita la barra): la usa un adjunto al salir. null si no hay o es de otro chat.
export function _takeReplyFor(cid) {
  if (!_replyTo || !cid || _replyCid !== _normId(cid)) return null;
  var r = _replyTo; _cancelReply(); return r;
}
export function _validRp(rp) {
  return !!(rp && typeof rp === 'object' && typeof rp.id === 'string' && rp.id && rp.id.length <= 120);
}

export function _scrollToMessage(id) {
  var el = null; try { el = document.querySelector('.message[data-msg-id="' + (window.CSS && window.CSS.escape ? window.CSS.escape(String(id)) : String(id)) + '"]'); } catch (e) {}
  if (!el) { _showInfoToast(t('chat_quote_gone', 'El mensaje citado ya no está en el chat'), 2500); return; }
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
  if (armed && !_replyHintArmed) { _replyHintArmed = true; haptic('gesture'); /* NEXO Touch (2968): «responder» armado → tick del sistema, no un zumbido */ }
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
  var timer = null, startX = 0, startY = 0, lastDx = 0, lastDy = 0, target = null, swiping = false, fired = false, lastTapId = null, lastTapAt = 0, ptr = null, onLink = false;
  var REPLY_PX = 60; // 3143: cuánto hay que deslizar para responder
  var bubbleOf = function(e) {
    var m = e.target && e.target.closest ? e.target.closest('.message') : null;
    return (m && m.dataset.msgId && !m.classList.contains('progress-placeholder')) ? m : null;
  };
  // 3143: un mensaje que aún no está en el vault (recién enviado, o con otro id) se puede responder igual: se arma desde la burbuja
  var domMsg = function(div) {
    var tx = div.querySelector('.msg-text'), own = div.classList.contains('own');
    var att = div.querySelector('img:not(.nx-loc-map),video,audio,.audio-player,[data-fullscreen-type]'); // 3201: el mapa de una ubicación no es una foto
    var txt = tx ? tx.textContent : (div.querySelector('.msg-content') || div).textContent;
    return { msgId: div.dataset.msgId, _own: own, content: att && !tx ? '' : String(txt || ''), attachmentType: (!tx && att) ? (att.tagName === 'VIDEO' ? 'video' : (att.tagName === 'AUDIO' || (att.className || '').indexOf('audio') > -1 ? 'audio' : 'image')) : undefined };
  };
  var reply = function(div) {
    var id = div.dataset.msgId, cid = _getCurrentContactId();
    if (!id || !cid) return;
    _findMessage(cid, id).then(function(m) { _startReply(id, m || domMsg(div)); });
  };
  var resetBubble = function(t) {
    _hideReplyHint();
    window.__nexoBubbleSwiping = false;
    t.style.transition = 'transform 0.15s';
    t.style.transform = '';
    setTimeout(function() { t.style.transition = ''; }, 200);
  };
  mc.addEventListener('pointerdown', function(e) {
    if (e.isPrimary === false) return;   // 3143: un segundo dedo (pellizco) no empieza otro gesto
    var m = bubbleOf(e);
    if (!m) return;
    target = m; ptr = e.pointerId; startX = e.clientX; startY = e.clientY; lastDx = 0; lastDy = 0; swiping = false; fired = false;
    onLink = !!(e.target.closest && e.target.closest('a.nx-link, a.nx-link-card')); // 3161
    clearTimeout(timer);
    timer = setTimeout(function() { fired = true; _openMsgMenu(m); }, 500);
  });
  mc.addEventListener('pointermove', function(e) {
    if (!target || (ptr !== null && e.pointerId !== ptr)) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    lastDx = dx; lastDy = dy;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(timer);
    // Deslizar la burbuja = responder, a la derecha o a la izquierda. 3223: también desde su parte izquierda (antes, a menos de
    // 40 px del borde se dejaba para «volver» y deslizar un mensaje recibido desde ahí cerraba el chat; ver chat_nav._setupSwipeBack).
    // 3143: antes exigía |dx| > 1,5·|dy| en CADA movimiento (un pulgar siempre se desvía un poco hacia abajo y el gesto no
    // arrancaba) y, una vez arrancado, volvía a perderse si el dedo bajaba. Ahora basta |dx| > |dy| para empezar y,
    // empezado, el gesto queda fijado como horizontal hasta soltar.
    if (!swiping && !isSelecting() && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) { // 3206: eligiendo, no se responde deslizando
      swiping = true; window.__nexoBubbleSwiping = true;
    }
    if (swiping) {
      var tx = dx > 0 ? Math.min(dx, 80) : Math.max(dx, -80);
      target.style.transform = 'translateX(' + tx + 'px)';
      _showReplyHint(target, tx);
    }
  });
  // 3143: ya fijado el gesto horizontal, que el navegador no lo cambie por un scroll vertical (se perdía el desliz con un pointercancel)
  mc.addEventListener('touchmove', function(e) { if (swiping && e.cancelable) e.preventDefault(); }, { passive: false });
  var end = function(e) {
    clearTimeout(timer);
    if (!target) return;
    if (ptr !== null && e.pointerId !== undefined && e.pointerId !== ptr) return;
    var t = target;
    // 3143: se usa lo último medido en pointermove (un pointercancel trae clientX = 0 y daba un desplazamiento falso)
    var dx = lastDx, dy = lastDy, cancelled = e.type === 'pointercancel';
    target = null; ptr = null;
    if (swiping) {
      swiping = false;
      resetBubble(t);
      if (Math.abs(dx) > REPLY_PX) reply(t);   // responder deslizando (izquierda o derecha)
      return;
    }
    // 3161: un toque en un enlace lo abre fuera de NEXO (links.js); no cuenta para el doble toque (la pulsación larga sí abre el menú)
    if (onLink) { lastTapId = null; return; }
    // Doble toque en la burbuja = reaccionar con ❤️ (en fotos/vídeos no: ahí el doble toque amplía en el visor)
    if (!fired && !cancelled && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
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
  if (!id || !cid || isSelecting()) return; // 3206: eligiendo mensajes, el doble toque no reacciona
  _findMessage(cid, id).then(function(m) {
    if (!m || m.deleted || m.attachmentType) return;
    _reactTo(cid, id, QUICK_REACTION);
  });
}

// 3140: iconos de trazo (24×24) de las opciones del menú de un mensaje
var _MM_ICONS = {
  'mm-reply': '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  'mm-forward': '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  'mm-select': '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8 12.5l2.8 2.8L16.5 9"/>',
  'mm-sticker-add': '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  'mm-copy': '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  'mm-edit': '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  'mm-star': '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>', // 3219
  'mm-pin': '<path d="M12 17v5"/><path d="M9 3h6"/><path d="M10 3v6.5L6.5 13.5V15h11v-1.5L14 9.5V3"/>', // 3219
  'mm-del-me': '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  'mm-del-all': '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  'mm-cancel': '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>'
};
export function _openMsgMenu(div) {
  var id = div && div.dataset.msgId, cid = _getCurrentContactId();
  if (!id || !cid) return;
  if (isSelecting()) { selectFromBubble(div); return; } // 3206: eligiendo mensajes, la pulsación larga marca o desmarca
  _findMessage(cid, id).then(function(msg) {
    if (!msg) return;
    var old = document.getElementById('nexo-msg-menu');
    if (old) old.remove();
    var isOwn = !!msg._own, deleted = !!msg.deleted;
    var box = document.createElement('div');
    box.id = 'nexo-msg-menu';
    box.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(0,0,0,0.45);display:flex;align-items:flex-end;justify-content:center;';
    var sheet = document.createElement('div');
    sheet.style.cssText = 'background:#14152a;color:#fff;width:100%;max-width:420px;border-radius:16px 16px 0 0;padding:4px 0 8px;'; // dueño 24-11: más compacto
    var close = function() { box.remove(); div.style.background = ''; };
    var add = function(label, cls, fn, danger) {
      var b = document.createElement('button');
      b.className = 'mm-item ' + cls;
      b.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:10px 18px;background:none;border:none;font-size:15px;color:' + (danger ? '#ff6b6b' : '#fff') + ';';
      // 3140 (dueño 16-11: «como mi pantalla de Contactos»): un icono de trazo igual para todas las opciones en lugar del
      // glifo/emoji que traía el texto traducido (↩ ↪ ⧉ ✏️ 🗑 ⭐); se quita del texto al mostrarlo
      var path = _MM_ICONS[cls];
      if (path) {
        var ic = document.createElement('span');
        ic.className = 'mm-ico';
        ic.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'; // SVG fijo (sin datos)
        b.appendChild(ic);
      }
      var lb = document.createElement('span');
      lb.textContent = String(label || '').replace(/^[^\p{L}\p{N}]+/u, '');
      b.appendChild(lb);
      b.onclick = function(e) { e.stopPropagation(); close(); fn(); };
      sheet.appendChild(b);
    };
    if (!deleted) {
      // Ronda 2783: barra de reacciones arriba del menú (como WhatsApp)
      var rbar = document.createElement('div');
      rbar.style.cssText = 'display:flex;justify-content:space-around;align-items:center;padding:2px 6px 4px;border-bottom:1px solid rgba(255,255,255,0.08);';
      REACTION_SET.forEach(function(e) {
        var rb = document.createElement('button');
        rb.className = 'mm-react';
        rb.textContent = e;
        rb.style.cssText = 'background:none;border:none;font-size:24px;line-height:1;padding:0;width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer;'; // revisión visual 28-11: toque de 44 px (antes 40×30)
        rb.onclick = function(ev) { ev.stopPropagation(); close(); _reactTo(cid, id, e); };
        rbar.appendChild(rb);
      });
      sheet.appendChild(rbar);
    }
    // Dueño 23-11: «Responder» ya se hace deslizando la burbuja (3143): sale del menú y en su lugar, arriba, va «Editar» (mensajes propios
    // de texto, hasta 15 min; los demás no se pueden editar)
    if (_canEdit(cid, msg)) add(t('chat_edit', '✏️  Editar'), 'mm-edit', function() { _startEdit(id, msg); });
    // 3164: una foto o un vídeo de «ver una vez» (propio o recibido, visto o no) no se reenvía: el otro lo mandó para verse una vez
    var onceMsg = !!(msg.onceSeen || (msg.attachmentMeta && msg.attachmentMeta.once));
    if (!deleted && !onceMsg) add(t('chat_forward', '↪  Reenviar'), 'mm-forward', function() { _openForwardSheet(msg); });
    // 3206 (dueño 17-11: «al reenviar hay que agregar la multiselección»): elegir varios y reenviarlos juntos (msg_select.js)
    if (!deleted && !onceMsg) add(t('chat_select', '☑  Seleccionar'), 'mm-select', function() { startSelect(cid, id); });
    // 3032 (dueño 12-11): un sticker PROPIO que me mandaron (con su dibujo) se puede agregar a mis stickers
    var stk = (!isOwn && !deleted) ? _chatKind(msg.content || '') : null;
    if (stk && stk.type === 'nexo_sticker' && (isValidStickerImg(stk.img) || isValidStickerVid(stk.vid))) {
      add(t('chat_sticker_add', '⭐  Agregar a mis stickers'), 'mm-sticker-add', function() {
        addReceivedSticker(isValidStickerImg(stk.img) ? stk.img : null, stk.vid).then(function(res) {
          if (_showInfoToast) _showInfoToast(res === 'added' ? t('chat_sticker_added', 'Sticker agregado a tus stickers') : (res === 'dup' ? t('chat_sticker_dup', 'Ya tienes este sticker') : t('chat_sticker_bad', 'No se pudo agregar el sticker')), 2500);
        });
      });
    }
    // Dueño 24-11: «Copiar» sale de este menú: ya está en la barra de «Seleccionar» (3311), junto a «Reenviar»
    // 3219: destacar (solo aquí) y fijar arriba del chat (para los dos)
    if (canStar(msg)) add(msg.starred ? t('chat_unstar', '⭐  Quitar destacado') : t('chat_star', '⭐  Destacar'), 'mm-star', function() { toggleStar(cid, msg); });
    if (canPin(cid, msg)) add(isPinned(_normId(cid), id) ? t('chat_unpin', '📌  Desfijar') : t('chat_pin', '📌  Fijar'), 'mm-pin', function() { togglePin(cid, msg); });
    add(t('chat_delete_me', '🗑  Eliminar para mí'), 'mm-del-me', function() { _deleteForMe(cid, id); }, true);
    // 28-11 (dueño: «a grupos falta el botón eliminar para todos»): también en un grupo (a cada miembro, como editar, 3195)
    var gsDel = window.bleInterface && window.bleInterface.groups, inGroup = !!(gsDel && typeof gsDel.isGroup === 'function' && gsDel.isGroup(cid));
    if (isOwn && !deleted && Date.now() - (msg.timestamp || 0) < DELETE_ALL_MS && (inGroup || _peerUnderstands(cid))) {
      add(t('chat_delete_all', '🗑  Eliminar para todos'), 'mm-del-all', function() { _deleteForAll(cid, msg); }, true);
    }
    add(t('chat_cancel', 'Cancelar'), 'mm-cancel', function() {});
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
    if (_editing) _cancelEdit(); // 3195: responder deja la edición (las dos a la vez no tienen sentido)
    var sum = _msgSummary(m);
    if (_normId(_getCurrentContactId()) !== _normId(cid)) return; // se cambió de chat mientras se buscaba el mensaje
    _replyTo = { id: id, a: m._own ? _myNexoId() : _normId(m.senderNexoId || cid), s: sum.s, k: sum.k };
    _replyCid = _normId(cid);
    _renderReplyBar();
    var input = document.getElementById('message-input');
    if (input) input.focus();
  });
}

export function _cancelReply() { _replyTo = null; _replyCid = ''; _renderReplyBar(); }

// 24-11 (dueño: «si salgo de ese chat y abro otro se mantiene»): la respuesta (y la edición) son SOLO del chat donde se empezaron.
// Al abrir otro chat o cerrar este se quitan, por cualquier camino (atrás, gesto, aviso, compartir, abrir desde otro chat).
function _chatChanged() {
  var cur = _normId(_getCurrentContactId());
  if (_replyTo && _replyCid !== cur) _cancelReply();
  if (_editing && _editing.cid !== cur) _cancelEdit();
}
try {
  window.addEventListener('nexo:ble:openChat', function() { setTimeout(_chatChanged, 0); });
  window.addEventListener('nexo:ble:closeChat', function() { if (_replyTo) _cancelReply(); if (_editing) _cancelEdit(); });
} catch (e) {}

// 3195: las barras «Respondiendo a» y «Editando mensaje» van DENTRO de la barra de escribir (fija abajo), justo encima de ella.
// Antes se metían en la página DETRÁS de esa barra (fija y opaca desde la 3140) y no se veían: medido en Chromium a 360 px, las
// dos quedaban bajo la barra de escribir y su ✕ bajo el botón enviar (el dueño no veía «Editando mensaje»). Mientras hay una, el
// chat deja sitio abajo para que no tape el último mensaje.
function _mountInputBar(bar) {
  var area = document.getElementById('input-area');
  if (!area) return false;
  bar.style.position = 'absolute'; bar.style.left = '10px'; bar.style.right = '10px'; bar.style.bottom = '100%';
  bar.style.margin = '0 0 4px'; bar.style.boxSizing = 'border-box'; bar.style.zIndex = '1';
  bar.style.background = 'linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0.08)), var(--nx-bg, #000)'; // el mismo tono, opaco
  area.appendChild(bar);
  _inputBarSpace();
  return true;
}
function _inputBarSpace() {
  var mc = document.getElementById('messages-container');
  if (!mc) return;
  var on = !!(document.getElementById('reply-bar') || document.getElementById('edit-bar'));
  var atEnd = mc.scrollHeight - mc.scrollTop - mc.clientHeight < 60;
  mc.style.paddingBottom = on ? 'calc(132px + env(keyboard-inset-height, 0px))' : '';
  if (on && atEnd) mc.scrollTop = mc.scrollHeight;
}

export function _renderReplyBar() {
  var old = document.getElementById('reply-bar');
  if (old) { old.remove(); _inputBarSpace(); }
  if (!_replyTo) return;
  var area = document.getElementById('input-area');
  if (!area) return;
  var bar = document.createElement('div');
  bar.id = 'reply-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-left:2px solid var(--nx-cyan,#00c8ff);border-radius:8px;color:#fff;font-size:13px;';
  var txt = document.createElement('div');
  txt.style.cssText = 'flex:1;min-width:0;';
  var who = document.createElement('div');
  who.style.cssText = 'color:#00c8ff;font-weight:600;';
  who.textContent = t('chat_replying_to', 'Respondiendo a ') + (_replyTo.a === _myNexoId() ? t('chat_you_obj', 'ti') : _contactName(_replyTo.a));
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
  _mountInputBar(bar);
}

// 3195 (dueño 17-11: «al pulsar un mensaje enviado agrega la posibilidad de editarlo»): ¿sale «Editar» en el menú de este mensaje?
// Como WhatsApp: solo un mensaje PROPIO de texto (ni foto, audio, archivo, sticker ni «ver una vez»; ni reenviado ni eliminado),
// hasta EDIT_MS después de enviarlo, en 1-a-1 (con un contacto que entiende las acciones, como «eliminar para todos») y en grupo.
export function _canEdit(cid, msg) {
  if (!cid || !msg || !msg._own || msg.deleted || msg.attachmentType || msg.onceSeen || (msg.attachmentMeta && msg.attachmentMeta.once)) return false;
  if (_editableText(msg.content || msg.text || '') == null) return false;
  if (!(Date.now() - (msg.timestamp || 0) < EDIT_MS)) return false;
  var gs = window.bleInterface && window.bleInterface.groups;
  if (gs && gs.isGroup(cid)) { var g = gs.get(cid); return !!(g && !g.left); }
  return _peerUnderstands(cid);
}

// Ronda 2782: editar un mensaje propio. Pone su texto en la caja y, al enviar, _doSend manda la edición (no uno nuevo).
export function _startEdit(id, msg) {
  var cid = _getCurrentContactId();
  var orig = msg ? _editableText(msg.content || msg.text || '') : null;
  if (!id || !cid || orig == null) return;
  _cancelReply();
  _editing = { id: id, cid: _normId(cid), ts: msg.timestamp || 0, orig: orig };
  var input = document.getElementById('message-input');
  if (input) { input.value = orig; try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} input.focus(); }
  _renderEditBar();
}

// keepInput: el texto se queda en la caja (salió de la edición sin descartar lo escrito). Sin edición en curso no toca la caja
// (3195: se llama también al cambiar de chat y no debe borrar lo que se estaba escribiendo).
export function _cancelEdit(keepInput) {
  var was = !!_editing;
  _editing = null;
  _renderEditBar();
  var input = document.getElementById('message-input');
  if (was && !keepInput && input) { input.value = ''; try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
}

// 3195: el botón enviar con una edición en curso (app_setup._doSend). 'sent' = edición mandada; 'same' = el texto no cambió (no se
// manda nada); 'late' = pasaron los 15 min (avisa; el texto se queda en la caja para mandarlo como mensaje nuevo); 'other' = la
// edición era de otro chat (se olvida y el texto sale como mensaje nuevo de este chat)
export function _submitEdit(text) {
  var e = _editing;
  if (!e || !e.id) return 'other';
  if (e.cid !== _normId(_getCurrentContactId())) { _cancelEdit(true); return 'other'; }
  if (Date.now() - (e.ts || 0) > EDIT_MS + EDIT_GRACE_MS) {
    _cancelEdit(true);
    _showInfoToast(t('chat_edit_late_a', 'Ya no se puede editar: pasaron más de ') + Math.round(EDIT_MS / 60000) + t('chat_edit_late_b', ' minutos'), 3000);
    return 'late';
  }
  _editing = null;
  _renderEditBar();
  if (String(text) === String(e.orig).trim()) return 'same';
  _editForAll(e.cid, e.id, text);
  return 'sent';
}
// 3195: cambiar de chat o cerrarlo deja la edición (la barra «Editando mensaje» no pasa a otro chat)
if (typeof window !== 'undefined') ['nexo:ble:openChat', 'nexo:ble:closeChat'].forEach(function(ev) { window.addEventListener(ev, function() { if (_editing) _cancelEdit(); }); });

export function _renderEditBar() {
  var old = document.getElementById('edit-bar');
  if (old) { old.remove(); _inputBarSpace(); }
  if (!_editing) return;
  var area = document.getElementById('input-area');
  if (!area) return;
  var bar = document.createElement('div');
  bar.id = 'edit-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;border-left:2px solid var(--nx-purple,#a855f7);border-radius:8px;color:#fff;font-size:13px;';
  var txt = document.createElement('div');
  txt.style.cssText = 'flex:1;min-width:0;color:#c9a6ff;font-weight:600;'; // 3140: violeta NEXO (antes amarillo)
  txt.textContent = t('chat_editing_msg', '✏️ Editando mensaje');
  var x = document.createElement('button');
  x.className = 'edit-cancel';
  x.textContent = '✕';
  x.style.cssText = 'background:none;border:none;color:#fff;font-size:18px;padding:4px 8px;';
  x.onclick = function() { _cancelEdit(); }; // 3195: sin pasarle el evento (sería «conservar el texto»)
  bar.appendChild(txt); bar.appendChild(x);
  _mountInputBar(bar);
}

export function _copyText(text) {
  var ok = function() { _showInfoToast(t('chat_copied', 'Copiado'), 1500); };
  var fallback = function() {
    try { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok(); } catch (e) {}
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok).catch(fallback);
  else fallback();
}

// 3206: msg puede ser una LISTA (los elegidos con «Seleccionar», ya en el orden del chat): se mandan de a uno, en ese orden, a cada
// chat elegido; onSent se llama al tocar «Reenviar» (cierra la selección)
export function _openForwardSheet(msg, onSent) {
  var msgs = Array.isArray(msg) ? msg : [msg];
  var old = document.getElementById('nexo-forward-sheet');
  if (old) old.remove();
  var all = (vaultLoadContacts() || []).filter(function(c) { return c && (c.nexoId || c.deviceUUID); });
  var chosen = {};
  var box = document.createElement('div');
  box.id = 'nexo-forward-sheet';
  box.style.cssText = 'position:fixed;inset:0;z-index:6000;background:var(--nx-bg);color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;';
  // 3140 (zona hojas): cabecera como la de Contactos (título a la izquierda, ✕ redonda a la derecha)
  var head = document.createElement('div');
  head.className = 'nx-page-head nx-sheet-head';
  var title = document.createElement('div');
  title.className = 'nx-page-title';
  title.textContent = t('chat_forward_to', 'Reenviar a…');
  var cancel = document.createElement('button');
  cancel.id = 'nexo-forward-cancel';
  cancel.className = 'nx-round-btn';
  cancel.setAttribute('aria-label', t('chat_cancel', 'Cancelar')); cancel.title = t('chat_cancel', 'Cancelar');
  cancel.innerHTML = SHEET_CLOSE_SVG;
  cancel.onclick = function() { box.remove(); };
  head.appendChild(title); head.appendChild(cancel);
  var list = document.createElement('div');
  list.style.cssText = 'flex:1;overflow-y:auto;';
  var send = document.createElement('button');
  send.className = 'fw-send';
  send.style.cssText = 'margin-top:12px;padding:12px;border:none;border-radius:12px;background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;font-size:15px;font-weight:600;';
  var refresh = function() { var n = Object.keys(chosen).length; send.textContent = n ? t('chat_forward_n', 'Reenviar (') + n + ')' : t('chat_choose_chats', 'Elige uno o más chats'); send.disabled = !n; };
  all.forEach(function(c) {
    var id = _normId(c.nexoId || c.deviceUUID);
    var row = document.createElement('label');
    row.className = 'fw-row';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.onchange = function() { if (cb.checked) chosen[id] = true; else delete chosen[id]; refresh(); };
    var nm = document.createElement('span');
    nm.className = 'fw-name nx-pick-name';
    nm.textContent = c.name || id.toUpperCase();
    row.appendChild(cb); row.appendChild(_pickAvatar(id, c.name || id)); row.appendChild(nm);
    list.appendChild(row);
  });
  send.onclick = function() {
    var ids = Object.keys(chosen);
    if (!ids.length) return;
    box.remove();
    if (typeof onSent === 'function') { try { onSent(); } catch (e) {} }
    (async function() { for (var k = 0; k < msgs.length; k++) await _forwardToMany(ids, msgs[k]); })().then(function() {
      _showInfoToast(t('chat_forwarded_to', 'Reenviado a ') + ids.length + (ids.length === 1 ? t('chat_chat_sing', ' chat') : t('chat_chat_plur', ' chats')), 2000);
    });
  };
  refresh();
  box.appendChild(head); box.appendChild(list); box.appendChild(send);
  document.body.appendChild(box);
}

// 2995 (dueño 10-11: mandó un APK de 25 MB a un contacto, este lo REENVIÓ A 10 CONTACTOS Y LA APP SE CERRÓ): cada reenvío lee el archivo
// entero (35 MB en base64), lo guarda en el vault, lo cifra y lo trocea: unas 4 copias en memoria POR contacto, y a los 10 a la vez
// eran ~1,5 GB en el WebView → se cerraba. Ahora un adjunto GRANDE (> FWD_SEQ_CHARS) se reenvía de a UN contacto: se lee del disco una
// sola vez, se manda al primero y, cuando ese envío termina (o queda pendiente), al siguiente. Lo chico sigue yendo a la vez.
var FWD_SEQ_CHARS = 1500000;
var FWD_STEP_MAX_MS = 30 * 60 * 1000;   // tope por contacto, por si un envío no vuelve nunca
// 3201: una UBICACIÓN recibida 1-a-1 se guarda tal como llegó (el adjunto dentro de content, attachmentType vacío: render.js la lee de
// ahí). Al reenviarla iba como TEXTO con el JSON dentro (el otro veía el JSON); ahora va como ubicación, con su mapa (meta.map) tal cual,
// sin volver a bajarlo
function _fwdAttachment(msg) {
  if (!msg || msg.attachmentType || typeof msg.content !== 'string' || msg.content.indexOf('"location"') < 0) return msg;
  var p = null;
  try { p = JSON.parse(msg.content); } catch (e) { return msg; }
  if (!p || p.type !== 'attachment' || p.attachmentType !== 'location' || typeof p.payload !== 'string' || !p.payload) return msg;
  return Object.assign({}, msg, { attachmentType: 'location', attachmentPayload: p.payload, attachmentMeta: (p.meta && typeof p.meta === 'object') ? p.meta : {} });
}
export async function _forwardToMany(ids, msg) {
  ids = ids || [];
  msg = _fwdAttachment(msg);
  if (!msg || !msg.attachmentType || ids.length < 2) return Promise.all(ids.map(function(cid) { return _forwardTo(cid, msg); }));
  var prep = await _forwardPrepare(msg);
  if (!prep || !prep.payload || prep.payload.length <= FWD_SEQ_CHARS) return Promise.all(ids.map(function(cid) { return _forwardTo(cid, msg, prep); }));
  console.log('[ATTACH] Reenvío de un adjunto grande (' + Math.round(prep.payload.length * 3 / 4 / 1048576) + ' MB) a ' + ids.length + ' chats: de a uno');
  for (var i = 0; i < ids.length; i++) {
    await new Promise(function(resolve) {
      var done = false, to = setTimeout(function() { if (!done) { done = true; resolve(); } }, FWD_STEP_MAX_MS);
      var settle = function() { if (!done) { done = true; clearTimeout(to); resolve(); } };
      _forwardTo(ids[i], msg, prep, settle).then(function(launched) { if (!launched) settle(); }, settle);
    });
  }
  prep = null;
}

// Lee UNA vez lo que hay que reenviar (carga del disco, HD del vídeo, limpia marcas). null si no se puede (ya avisó).
async function _forwardPrepare(msg) {
  var payload = msg.attachmentPayload;
  var meta = Object.assign({}, msg.attachmentMeta || {});
  if (meta.thumbOnly || meta.lazyRef) { payload = null; delete meta.thumbOnly; delete meta.fullRef; delete meta.lazyRef; }
  if (!payload && msg.attachmentRef) payload = await vaultLoadFile(msg.attachmentRef);
  if (msg.attachmentType === 'video' && msg.hdRef) {
    var hd = await vaultLoadFile(msg.hdRef);
    if (hd) { payload = hd; if (msg.hdMime) { meta.mime = msg.hdMime; meta.format = _videoFormat(msg.hdMime); } }
  }
  return { payload: payload, meta: meta };
}

export async function _forwardTo(cid, msg, prep, onSettled) {
  msg = _fwdAttachment(msg);
  if (msg.attachmentType) {
    if (msg.onceSeen || (msg.attachmentMeta && msg.attachmentMeta.once)) return false; // 3164: «ver una vez» nunca se reenvía
    if (!prep) prep = await _forwardPrepare(msg);
    var payload = prep.payload;
    var meta = Object.assign({}, prep.meta);
    if (meta.big) { _showInfoToast(t('chat_big_no_forward', 'Los archivos grandes todavía no se pueden reenviar'), 2500); return; }
    ['preview', 'hdSize', 'hdFor', 'hd', 'wdOnly', 'fwd', 'rp'].forEach(function(k) { delete meta[k]; });
    if (!payload) { _showInfoToast(t('chat_forward_file_gone', 'No se pudo reenviar: el archivo ya no está'), 2500); return; }
    console.log('[ATTACH] Reenviando ' + msg.attachmentType + ' a ' + cid);
    var gsF = window.bleInterface && window.bleInterface.groups;
    var idF = _sendAttachment(msg.attachmentType, payload, meta, { contactId: cid, onSettled: (gsF && gsF.isGroup(cid)) ? null : onSettled });
    return !!idF && !(gsF && gsF.isGroup(cid));   // true: el envío avisará (onSettled) al terminar
  }
  var text = _plainText(msg.content);
  var wire = _peerUnderstands(cid) ? JSON.stringify({ type: 'nexo_txt', t: text, fw: 1 }) : text;
  _sendTextTo(cid, wire, text);
}

// Vista previa de la lista de chats según el último mensaje que queda (lo eliminado no se ve ahí)
// 3195: en un GRUPO solo se cambia si su último mensaje es el editado (msgId), con el «quién: » de la lista; ni la hora, ni el orden,
// ni los no leídos (Groups.setPreview)
export function _refreshChatPreview(cid, msgId) {
  var gsp = window.bleInterface && window.bleInterface.groups;
  if (gsp && gsp.isGroup(cid)) {
    if (!msgId || typeof gsp.setPreview !== 'function') return Promise.resolve();
    return vaultLoadMessages(cid).then(function(list) {
      var last = null;
      (list || []).forEach(function(m) { if (!m.hidden && (!last || (m.timestamp || 0) >= (last.timestamp || 0))) last = m; });
      if (!last || (last.msgId || last.messageId) !== msgId || last.deleted || last.attachmentType) return;
      gsp.setPreview(cid, (last._own ? 'Tú' : gsp.memberName(last.senderNexoId)) + ': ' + _cut(_plainText(last.content), 50));
      var bg = window.bleInterface;
      if (bg && typeof bg.renderContactsList === 'function') bg.renderContactsList();
    }).catch(function() {});
  }
  return vaultLoadMessages(cid).then(function(list) {
    var last = null;
    (list || []).forEach(function(m) { if (!m.hidden && (!last || (m.timestamp || 0) >= (last.timestamp || 0))) last = m; });
    var contacts = vaultLoadContacts() || [];
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === _normId(cid); });
    if (!c) return;
    c.lastMessage = !last ? '' : last.deleted ? t('chat_msg_deleted', '🚫 Mensaje eliminado') : last.attachmentType ? (_PREVIEW_BY_TYPE[last.attachmentType] || t('chat_file', '📎 Archivo')) : _cut(_plainText(last.content), 50);
    vaultSaveContacts(contacts);
    var bi = window.bleInterface;
    if (bi && typeof bi.renderContactsList === 'function') bi.renderContactsList();
  }).catch(function() {});
}

// 3268: un mensaje ⏳ que se borra ya no debe salir: fuera también de la bandeja de salida nativa (ble_outbox.js)
function _outboxForget(id) { try { var bi = window.bleInterface; if (bi && typeof bi._outboxDrop === 'function') bi._outboxDrop(id, true); } catch (e) {} }

export function _deleteForMe(cid, id) {
  var el = document.querySelector('.message[data-msg-id="' + id + '"]');
  if (el) el.remove();
  _renderedMessageIds.delete(id);
  if (_replyTo && _replyTo.id === id) _cancelReply();
  _outboxForget(id);
  vaultDeleteMessage(cid, id).then(function() { return _refreshChatPreview(cid); }).catch(function() {});
  unpinId(cid, id, true); // dueño 23-11: un mensaje fijado que se borra deja de estar fijado (aquí; el otro sigue con el suyo)
  console.log('[CHAT] Mensaje eliminado para mí');
}

export function _deleteForAll(cid, msg) {
  var id = msg.msgId || msg.messageId;
  _outboxForget(id);
  // 28-11: en un GRUPO, la misma acción oculta (cifrada de extremo a extremo) a cada miembro con el id del grupo (g); cada uno la aplica a
  // su copia (id + sus 8 letras) solo si el mensaje lo escribí yo (como la edición, 3195)
  var gs = window.bleInterface && window.bleInterface.groups, g = gs && typeof gs.isGroup === 'function' && gs.isGroup(cid) ? gs.get(cid) : null;
  if (g) {
    var wire = JSON.stringify({ type: 'nexo_act', act: 'del', id: id, g: g.id }), me = _myNexoId(), n = 0;
    (g.members || []).forEach(function(nx) { if (_normId(nx) && _normId(nx) !== me) { _sendTextTo(_normId(nx), wire, '', true); n++; } });
    console.log('[CHAT] Mensaje del grupo ' + g.id + ' eliminado para todos (a ' + n + ' persona(s))');
  } else _sendTextTo(cid, JSON.stringify({ type: 'nexo_act', act: 'del', id: id }), '', true);
  vaultBlankMessage(cid, id).then(function() { _rerenderBlank(id, msg); return _refreshChatPreview(cid); }).catch(function() {});
  unpinId(cid, id, false); // dueño 23-11: borrado para todos: deja de estar fijado también para todos
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
// 3195: con la hora de la edición (ts: gana la más nueva aunque lleguen desordenadas) y también en GRUPO: la misma acción oculta
// (cifrada de extremo a extremo, por todos los caminos, sin aviso ni «no leído») a cada miembro, con el id del grupo (g) y el id del
// mensaje del grupo; cada uno la aplica a su copia (ese id + sus 8 letras, groups.js) solo si viene de quien lo escribió.
export function _editForAll(cid, id, newText) {
  cid = _normId(cid);
  return _findMessage(cid, id).then(function(m) {
    // la hora de cada edición, siempre mayor que la de la anterior de este mensaje (aunque el reloj del teléfono haya ido hacia atrás)
    var ts = Math.max(Date.now(), ((m && m.editTs) || 0) + 1), act = { type: 'nexo_act', act: 'edit', id: id, t: newText, ts: ts };
    var gs = window.bleInterface && window.bleInterface.groups, g = gs && gs.isGroup(cid) ? gs.get(cid) : null;
    if (g) {
      act.g = g.id;
      var wire = JSON.stringify(act), me = _myNexoId(), n = 0;
      (g.members || []).forEach(function(nx) { if (_normId(nx) && _normId(nx) !== me) { _sendTextTo(_normId(nx), wire, '', true); n++; } });
      console.log('[CHAT] Mensaje del grupo ' + g.id + ' editado (a ' + n + ' persona(s))');
    } else {
      _sendTextTo(cid, JSON.stringify(act), '', true);
      console.log('[CHAT] Mensaje editado');
    }
    return vaultEditMessage(cid, id, newText, { ts: ts }).then(function(r) { if (r !== true) return; _rerenderEdited(cid, id); return _refreshChatPreview(cid, id); });
  }).catch(function() {});
}

// 3195: la marca «Editado» junto a la hora (la usa también render.js al dibujar la burbuja)
export function _editedMark() {
  var s = document.createElement('span');
  s.className = 'msg-edited';
  s.textContent = t('chat_edited', 'Editado');
  s.style.cssText = 'opacity:0.6;font-size:11px;margin:0 5px;';
  return s;
}

// 3195: la burbuja editada se cambia EN SU SITIO (texto nuevo y «Editado»): antes se quitaba y se volvía a dibujar, y el chat saltaba
// al final (una edición de un mensaje de más arriba movía lo que se estaba leyendo). Las reacciones y el nombre del grupo se quedan.
export function _rerenderEdited(cid, id) {
  _findMessage(cid, id).then(function(m) {
    if (!m || m.deleted) return;
    var el = document.querySelector('.message[data-msg-id="' + id + '"]');
    if (!el) return;
    var old = el.querySelector('.msg-content');
    if (!old || !old.parentNode) { el.remove(); _renderedMessageIds.delete(id); _renderMessage(m, true); return; }
    var cd = document.createElement('div');
    cd.className = 'msg-content';
    cd.style.borderRadius = '12px';
    cd.style.overflow = 'hidden';
    _fillTextBubble(cd, m, !!m._own);
    old.parentNode.replaceChild(cd, old);
    var meta = el.querySelector('.msg-meta');
    if (meta && m.edited && !meta.querySelector('.msg-edited')) {
      var tm = meta.querySelector('.msg-time');
      meta.insertBefore(_editedMark(), tm ? tm.nextSibling : meta.firstChild);
    }
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
  if (act && act.act === 'e2e') { if (typeof window.NEXO_resyncOnAct === 'function') window.NEXO_resyncOnAct(senderId, act); return; } // 3067/3069: desatasco del cifrado (resync.js)
  if (act && act.act === 'wp') { applyChatWallpaper(senderId, act); return; } // ronda 2890: fondo de chat compartido (wallpaper.js)
  if (act && act.act === 'st') { applyStatus(senderId, act); return; } // ronda 2799: Estado (Stream fase 1, estados.js)
  if (act && act.act === 'sl') { likeReceived(senderId, act); return; } // ronda 2906: «me gusta» a mi estado (estados.js fase 2)
  if (act && act.act === 'sc') { commentReceived(senderId, act); return; } // 3032: comentario a mi estado (solo lo veo yo)
  if (act && act.act === 'sq') { statusQueryReceived(senderId, !!act.auto); if (act.av) avatarQueryReceived(senderId); return; } // 3138: auto (al agregar) con su propio freno
  if (act && act.act === 'avq') { avatarQueryReceived(senderId, typeof act.h === 'string' ? act.h.substring(0, 20) : ''); return; } // 3129: ¿mi foto que tiene está al día?   // 3032: me piden mis estados (deslizar para actualizar); 3095: y mi foto
  if (act && act.act === 'sm') { statusMediaRequested(senderId, act); return; } // 3032: me piden la media grande de un estado
  if (act && act.act === 'prof') { applyContactProfile(senderId, act); return; } // #dueño 04-11: datos de perfil completos (profile_share.js)
  if (act && act.act === 'psi') { psiOnAction(senderId, act); return; } // #dueño 04-11 paso 3: contactos en común (PSI, psi.js)
  if (act && act.act === 'vote') { pollOnAction(senderId, act); return; } // 3361: voto de una encuesta (poll.js)
  if (act && act.act === 'dsp') { disappearOnAction(senderId, act); return; } // 3360: mensajes temporales (chat_disappear.js)
  if (act && act.act === 'pin') { pinOnAction(senderId, act); return; } // 3219: fijar un mensaje arriba del chat (chat_pin.js)
  if (act && act.act === 'fnd') { if (findOn()) findOnAction(senderId, act); return; } // 26-11 (B0): escondido; la acción se ignora // 3345 (modo multitud): buscarse entre la gente (find_ui.js)
  if (act && act.act === 'ghq') { onHistoryQuery(senderId, act); return; } // 24-11: un nuevo del grupo me pide los mensajes anteriores
  if (act && act.act === 'ghr') { onHistoryReply(senderId, act); return; } // 24-11: llegan los mensajes anteriores del grupo
  if (act && act.act === 'game') { // ronda 2830+: juegos por turnos; se enruta por act.g
    if (act.g === 'c4') connect4OnAction(senderId, act);   // Conecta 4 (connect4.js)
    else if (act.g === 'tetvs') tetrisVersusOnAction(senderId, act); // Tetris versus por eventos (tetris_versus.js)
    else tttOnAction(senderId, act);                        // Tres en raya (ttt.js)
    return;
  }
  // Ronda 2782: el contacto editó uno de SUS mensajes de texto
  // 3175: si el mensaje aún no llegó (la edición se adelantó), se guarda y se aplica al llegar (vault_early_acts.js)
  // 3195: gana la más nueva por su hora (ts); y la de un mensaje de GRUPO (g): solo de un miembro, a mi copia (id + mis 8 letras,
  // groups.js) y solo si ese mensaje lo escribió él (la de otro es un intento de suplantación: se ignora)
  if (act && act.act === 'edit' && act.id && typeof act.t === 'string') {
    var who = _normId(senderId), cide = who, mide = String(act.id);
    var ets = (typeof act.ts === 'number' && isFinite(act.ts) && act.ts > 0) ? act.ts : 0;
    if (act.g) {
      var gse = window.bleInterface && window.bleInterface.groups, ge = gse ? gse.get(act.g) : null, me = _myNexoId();
      if (!ge || ge.left || (ge.members || []).indexOf(who) < 0 || !/^gm[0-9a-z]+$/.test(mide) || !me) { console.warn('[CHAT] Edición de grupo descartada (de ' + who + ': no es miembro o el grupo no está)'); return; }
      cide = ge.id; mide = mide + '_' + me.substring(2);
    }
    vaultEditMessage(cide, mide, act.t, { fromPeer: true, author: who, ts: ets }).then(function(r) { // solo texto suyo, no borrado
      if (r === 'queued') { console.log('[CHAT] ' + who + ' editó un mensaje que aún no llegó (' + mide + '): se aplicará al llegar'); return; }
      if (r === 'author') { console.warn('[CHAT] Edición de ' + mide + ' descartada: ' + who + ' no lo escribió (suplantación)'); return; }
      if (r === 'stale') { console.log('[CHAT] Edición de ' + mide + ' más vieja o repetida: se queda la más nueva'); return; }
      if (r !== true) return;
      console.log('[CHAT] ' + who + ' editó ' + mide);
      if (_normId(_getCurrentContactId()) === cide) _rerenderEdited(cide, mide);
      return _refreshChatPreview(cide, mide);
    }).catch(function() {});
    return;
  }
  // Ronda 2783: el contacto reaccionó a un mensaje con un emoji (3175: o a uno que aún no llegó: se aplica al llegar)
  if (act && act.act === 'react' && act.id && typeof act.e === 'string') {
    var cidr = _normId(senderId);
    vaultReactMessage(cidr, act.id, cidr, act.e, true).then(function(ok) {
      if (ok === 'queued') { console.log('[CHAT] ' + cidr + ' reaccionó a un mensaje que aún no llegó: se aplicará al llegar'); return; }
      if (ok === true && _normId(_getCurrentContactId()) === cidr) _rerenderReactions(cidr, act.id);
    }).catch(function() {});
    return;
  }
  if (!act || act.act !== 'del' || !act.id) return;
  var cid = _normId(senderId), midd = String(act.id), whod = cid;
  // 28-11: eliminado para todos en un GRUPO: solo de un miembro, a mi copia (id + mis 8 letras) y solo si ese mensaje lo escribió él
  if (act.g) {
    var gsd = window.bleInterface && window.bleInterface.groups, gd = gsd ? gsd.get(act.g) : null, med = _myNexoId();
    if (!gd || gd.left || (gd.members || []).indexOf(whod) < 0 || !/^gm[0-9a-z]+$/.test(midd) || !med) { console.warn('[CHAT] Eliminado de grupo descartado (de ' + whod + ': no es miembro o el grupo no está)'); return; }
    cid = gd.id; midd = midd + '_' + med.substring(2);
  }
  // 3175: si el mensaje aún no llegó, queda la lápida: cuando llegue no se mostrará ni se guardará (ni su adjunto, ni su aviso)
  vaultBlankMessage(cid, midd, true, whod).then(function(r) { // solo mensajes que escribió quien lo pide
    if (r === 'queued') { console.log('[CHAT] ' + whod + ' eliminó para todos un mensaje que aún no llegó: no se mostrará'); return; }
    if (r === 'author') { console.warn('[CHAT] Eliminado de ' + midd + ' descartado: ' + whod + ' no lo escribió (suplantación)'); return; }
    if (r !== true) return;
    console.log('[CHAT] ' + whod + ' eliminó un mensaje para todos');
    if (_normId(_getCurrentContactId()) === cid) _findMessage(cid, midd).then(function(m) { if (m) _rerenderBlank(midd, m); });
    return _refreshChatPreview(cid);
  }).catch(function() {});
}

// 3175: llegó un mensaje con acciones que se le habían adelantado (vault_messages._appendMessageNow ya las aplicó al guardarlo):
// su burbuja se vuelve a dibujar con lo guardado (texto editado, reacción, o «Se eliminó este mensaje») y la vista previa de la
// lista se rehace (no se queda con el texto de un mensaje eliminado)
if (typeof window !== 'undefined') window.addEventListener('nexo:vault:earlyActs', function(e) {
  var d = (e && e.detail) || {}, cid = _normId(d.cid), id = d.msgId;
  if (!cid || !id) return;
  console.log('[CHAT] Llegó ' + id + ' de ' + cid + ' con ' + (d.del ? '«eliminar para todos»' : [d.edit ? 'edición' : '', d.react ? 'reacción' : ''].filter(Boolean).join(' y ')) + ' que se adelantó: aplicada');
  if (_normId(_getCurrentContactId()) === cid) {
    _findMessage(cid, id).then(function(m) {
      if (!m || !document.querySelector('.message[data-msg-id="' + id + '"]')) return;
      if (d.del) _rerenderBlank(id, m);
      else if (d.edit) { _rerenderEdited(cid, id); if (d.react) _rerenderReactions(cid, id); } // 3195: en su sitio (y sus reacciones)
      else if (d.react) _rerenderReactions(cid, id);
    });
  }
  _refreshChatPreview(cid, id);
});

// Gancho de pruebas (tests/sim/fwdbig.js)
try { if (typeof window !== 'undefined') window.__nexoForwardMany = _forwardToMany; } catch (e) {}
