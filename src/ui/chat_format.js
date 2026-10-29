/**
 * NEXO — Formato de los mensajes del chat (sacado de main.js en la ronda 2752, sin cambios): NEXO ID normalizado,
 * chat abierto, tipo de mensaje (respuesta, reenviado, acción), texto plano y vista previa sin partir emojis, nombres,
 * buscar un mensaje en pantalla y orden de los estados (enviando → enviado → entregado → leído).
 */
import { vaultLoadContacts, vaultLoadMessages } from '../vault/vault_manager.js';


export var _STATUS_RANK = {
  pending: 1, queued: 2, sending: 3, sent: 4, delivered: 5, read: 6, failed: 0
};

export function _statusRank(s) {
  return _STATUS_RANK[s] || 0;
}

export function _canUpgradeStatus(fromStatus, toStatus) {
  if (!toStatus) return false;
  if (toStatus === 'failed') return true; // failed siempre se permite (es terminal)
  if (!fromStatus) return true;
  // Nunca degradar delivered/read a sent/sending/pending/failed
  return _statusRank(toStatus) >= _statusRank(fromStatus);
}

export function _getDomMessageStatus(messageId) {
  try {
    var el = document.querySelector('.msg-status[data-msg-id="' + messageId + '"]');
    if (!el) return null;
    var cls = el.className || '';
    var m = cls.match(/status-(pending|queued|sending|sent|delivered|read|failed)/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

export function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}

export function _getCurrentContactId() {
  if (window.NEXO.app && window.NEXO.app.activeContact) {
    return window.NEXO.app.activeContact.nexoId || window.NEXO.app.activeContact.id;
  }
  return null;
}

export function _chatKind(content) {
  if (typeof content !== 'string' || content.charAt(0) !== '{' || content.indexOf('"nexo_') < 0) return null;
  try { var p = JSON.parse(content); return (p && (p.type === 'nexo_txt' || p.type === 'nexo_act' || p.type === 'nexo_sticker')) ? p : null; } catch (e) { return null; }
}

export function _plainText(content) { var k = _chatKind(content); return k ? String(k.t || '') : String(content || ''); }

export function _myNexoId() { var bi = window.bleInterface; return _normId(bi && bi.localNexoId); }

export function _contactName(nx) {
  var c = (vaultLoadContacts() || []).find(function(x) { return _normId(x.nexoId || x.deviceUUID) === _normId(nx); });
  return (c && c.name) || String(nx || '').toUpperCase();
}

export function _peerUnderstands(cid) {
  var c = (vaultLoadContacts() || []).find(function(x) { return _normId(x.nexoId || x.deviceUUID) === _normId(cid); });
  return !!(c && c.fx);
}

// Recortar texto sin partir un emoji ni otro carácter de dos unidades (quedaría "�")
export function _cut(s, n) { s = String(s == null ? '' : s); if (s.length <= n) return s; var c = s.charCodeAt(n - 1); return s.substring(0, (c >= 0xD800 && c <= 0xDBFF) ? n - 1 : n); }

// Etiqueta de vista previa de un adjunto. Para un ARCHIVO se usa su NOMBRE (meta.name, como lo lee file_card.js), no la
// palabra genérica «Archivo» (informe del dueño 29-10: al responder a un archivo salía «Archivo» en vez del nombre).
function _attachLabel(at, meta) {
  if (at === 'file') {
    var fn = meta && (meta.name || meta.fileName);
    return fn ? '📎 ' + String(fn) : '📎 Archivo';
  }
  return _PREVIEW_BY_TYPE[at] || '📎 Archivo';
}

export function _msgSummary(msg) {
  // 1) Adjunto en campos (lo normal en el vault): foto, vídeo, audio, ubicación, archivo…
  if (msg.attachmentType) return { k: msg.attachmentType, s: _attachLabel(msg.attachmentType, msg.attachmentMeta) };
  // 2) Un adjunto puede venir codificado DENTRO de content ({"type":"attachment","attachmentType":"…","meta":{…}}).
  //    Sin esto, responder a una ubicación o a un archivo guardado así mostraba el JSON crudo («código») en vez de
  //    «📍 Ubicación» o «📎 <nombre>» (informes del dueño 28/29-10).
  if (typeof msg.content === 'string' && msg.content.indexOf('"attachmentType"') > -1) {
    try {
      var p = JSON.parse(msg.content);
      if (p && p.type === 'attachment' && p.attachmentType) return { k: p.attachmentType, s: _attachLabel(p.attachmentType, p.meta) };
    } catch (e) {}
  }
  // 3) Texto normal (nexo_txt / nexo_act) → su texto plano, recortado sin partir emojis. Un sticker (nexo_sticker, 2829)
  //    muestra «🎟️ Sticker», nunca el JSON crudo.
  var k = _chatKind(msg.content);
  if (k && k.type === 'nexo_sticker') return { k: 'sticker', s: '🎟️ Sticker' };
  if (k) return { k: 'text', s: _cut(String(k.t || ''), 100) };
  // 4) Cualquier OTRO JSON de protocolo (descriptor de archivo, trozo, control…): NUNCA mostrar el «código» crudo. Se
  //    intenta sacar un nombre de archivo; si no, etiqueta genérica. (El archivo del dueño caía aquí y salía como código.)
  if (typeof msg.content === 'string' && msg.content.charAt(0) === '{') {
    try {
      var o = JSON.parse(msg.content);
      var fn2 = o && ((o.meta && (o.meta.name || o.meta.fileName)) || o.name || o.fileName || o.fn);
      if (fn2) return { k: 'file', s: '📎 ' + String(fn2) };
    } catch (e2) {}
    return { k: 'file', s: '📎 Archivo' };
  }
  // 5) Texto suelto (sin envoltorio).
  return { k: 'text', s: _cut(_plainText(msg.content), 100) };
}

export function _findMessage(cid, id) {
  return vaultLoadMessages(cid).then(function(list) {
    return (list || []).find(function(m) { return (m.msgId || m.messageId) === id; }) || null;
  }).catch(function() { return null; });
}

// v9.9.29: la lista de contactos se ordena por el último mensaje enviado o recibido
export var _PREVIEW_BY_TYPE = { contact: '👤 Contacto', image: '📷 Foto', video: '🎬 Vídeo', audio: '🎤 Audio', voice: '🎤 Audio', location: '📍 Ubicación', file: '📎 Archivo', sticker: '🎟️ Sticker' };

// Gancho para las pruebas (tests/sim/chatactions.js): comprobar el resumen de respuesta de un adjunto codificado en
// content (ubicación/foto) sin depender del GPS. Es una función pura de solo lectura.
try { if (typeof window !== 'undefined') window.__nexoMsgSummary = _msgSummary; } catch (e) {}
