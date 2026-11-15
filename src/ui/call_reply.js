/**
 * NEXO — Responder una llamada entrante con un MENSAJE (#222, dueño 15-11: «si hay una llamada de grupo y entra otra, se debe de
 * poder visualizar y con la opción de pulsar en llamada más tarde para que se envíe un mensaje así… un botón de contestación
 * rápida… o la opción de ingresar un texto»). Hoja de abajo con frases listas y «Escribir…»: al elegir, la llamada se rechaza y el
 * texto le llega al que llama como un mensaje normal del chat (queda en el chat de los dos).
 */
import { _sendTextTo } from './send.js';
import { _showInfoToast } from './ui_bits.js';
import { t } from './i18n.js';

function _presets() {
  return [
    t('call_qr_busy', 'Estoy en otra llamada, te llamo en cuanto termine'),
    t('call_qr_later', 'No puedo hablar ahora, te llamo más tarde'),
    t('call_qr_msg', 'No puedo contestar, escríbeme por aquí')
  ];
}

// Manda el texto al que llama (después de rechazar la llamada)
export function sendCallReply(nx, text, reject) {
  text = String(text || '').trim();
  if (!nx || !text) return false;
  try { if (typeof reject === 'function') reject(); } catch (e) {}
  var id = _sendTextTo(nx, text, text);
  console.log('[CALL] Respuesta con mensaje a ' + nx + (id ? '' : ' (no se pudo enviar)'));
  if (id) _showInfoToast(t('call_qr_sent', 'Mensaje enviado'), 2000);
  return !!id;
}

// Hoja «Responder con mensaje» (name: nombre del que llama; reject: rechaza la llamada que suena)
export function openCallReply(nx, name, reject) {
  var old = document.getElementById('nexo-call-reply'); if (old) old.remove();
  var ov = document.createElement('div');
  ov.id = 'nexo-call-reply';
  ov.setAttribute('data-nx', String(nx || ''));
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(0,0,0,0.55);';
  var sheet = document.createElement('div');
  sheet.style.cssText = 'background:#14152a;color:#fff;border-radius:18px 18px 0 0;max-height:80vh;display:flex;flex-direction:column;gap:8px;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));box-sizing:border-box;font-family:inherit;';
  var h = document.createElement('div');
  h.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:4px;';
  h.textContent = t('call_qr_title', 'Responder con mensaje') + (name ? ' · ' + name : '');
  sheet.appendChild(h);
  var rowCss = 'text-align:left;background:rgba(255,255,255,0.07);border:none;color:#fff;border-radius:12px;padding:12px 14px;font-size:15px;cursor:pointer;font-family:inherit;';
  var close = function() { ov.remove(); };
  _presets().forEach(function(txt) {
    var b = document.createElement('button');
    b.className = 'nexo-qr-preset';
    b.style.cssText = rowCss;
    b.textContent = txt;
    b.addEventListener('click', function(e) { e.stopPropagation(); close(); sendCallReply(nx, txt, reject); });
    sheet.appendChild(b);
  });
  // «Escribir…»: un cuadro de texto propio y «Enviar»
  var write = document.createElement('button');
  write.className = 'nexo-qr-write';
  write.style.cssText = rowCss + 'opacity:0.9;';
  write.textContent = t('call_qr_write', 'Escribir…');
  var box = document.createElement('div');
  box.style.cssText = 'display:none;gap:8px;align-items:flex-end;';
  var ta = document.createElement('textarea');
  ta.rows = 2; ta.maxLength = 500;
  ta.placeholder = t('call_qr_placeholder', 'Tu mensaje');
  ta.style.cssText = 'flex:1;min-width:0;resize:none;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);color:#fff;border-radius:12px;padding:10px 12px;font-size:15px;font-family:inherit;box-sizing:border-box;';
  var send = document.createElement('button');
  send.className = 'nexo-qr-send';
  send.style.cssText = 'background:#16a34a;border:none;color:#fff;border-radius:12px;padding:12px 16px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;';
  send.textContent = t('call_qr_send', 'Enviar');
  send.addEventListener('click', function(e) { e.stopPropagation(); var v = ta.value.trim(); if (!v) { ta.focus(); return; } close(); sendCallReply(nx, v, reject); });
  box.appendChild(ta); box.appendChild(send);
  write.addEventListener('click', function(e) { e.stopPropagation(); write.style.display = 'none'; box.style.display = 'flex'; ta.focus(); });
  sheet.appendChild(write); sheet.appendChild(box);
  var cancel = document.createElement('button');
  cancel.style.cssText = 'margin-top:4px;background:rgba(255,255,255,0.12);border:none;color:#fff;border-radius:12px;padding:12px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;';
  cancel.textContent = t('misc_cancel', 'Cancelar');
  cancel.addEventListener('click', function(e) { e.stopPropagation(); close(); });
  sheet.appendChild(cancel);
  ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
  ov.appendChild(sheet);
  (document.body || document.documentElement).appendChild(ov);
  return ov;
}

// Si la llamada que suena se termina (colgó el otro, la contesté desde otro lado), la hoja se cierra sola
export function closeCallReply(nx) {
  var o = document.getElementById('nexo-call-reply');
  if (o && (!nx || o.getAttribute('data-nx') === String(nx))) o.remove();
}
