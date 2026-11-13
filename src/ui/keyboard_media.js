/**
 * NEXO — GIF y stickers del TECLADO (3035, dueño 13-11, captura del S23: el teclado de Samsung decía «No es posible
 * introducir este contenido aquí»). La parte nativa (android/.../NexoWebView.java) anuncia al teclado que el cuadro de
 * escribir acepta GIF/PNG/JPEG/WebP y, cuando el teclado manda uno, llama a window.__nexoKeyboardImage(mime, dataUrl).
 * Aquí se valida (tipo de imagen, base64, tamaño) y se manda al chat abierto como imagen TAL CUAL (un GIF sigue animado).
 */
import { _sendAttachment } from './send.js';
import { _getCurrentContactId } from './chat_format.js';
import { _showInfoToast } from './ui_bits.js';
import { t } from './i18n.js';

var KB_MAX_B64 = Math.ceil(10 * 1024 * 1024 * 4 / 3) + 4; // 10 MB reales como mucho
var KB_RE = /^data:image\/(gif|png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+=*)$/;

export function keyboardImageReceived(mime, dataUrl) {
  var m = typeof dataUrl === 'string' ? KB_RE.exec(dataUrl) : null;
  if (!m) { _showInfoToast(t('kb_img_bad', 'No se pudo usar esa imagen del teclado'), 2500); return null; }
  var b64 = m[2];
  if (b64.length > KB_MAX_B64) { _showInfoToast(t('kb_img_big', 'Esa imagen del teclado es demasiado grande'), 2500); return null; }
  var cid = _getCurrentContactId();
  if (!cid) { _showInfoToast(t('kb_img_no_chat', 'Abre un chat para mandar el GIF o sticker'), 2500); return null; }
  var fmt = m[1] === 'jpg' ? 'jpeg' : m[1];
  var size = Math.floor(b64.length * 3 / 4);
  console.log('[ATTACH] ' + (fmt === 'gif' ? 'GIF' : 'Imagen') + ' del teclado (' + Math.round(size / 1024) + ' KB) → ' + cid); // i18n-ok
  return _sendAttachment('image', b64, { format: fmt, mime: 'image/' + fmt, size: size, kb: 1 });
}

if (typeof window !== 'undefined') window.__nexoKeyboardImage = keyboardImageReceived;
