/**
 * NEXO — Responder una llamada entrante con un MENSAJE (#222, dueño 15-11: «si hay una llamada de grupo y entra otra, se debe de
 * poder visualizar y con la opción de pulsar en llamada más tarde para que se envíe un mensaje así… un botón de contestación
 * rápida… o la opción de ingresar un texto»). Hoja de abajo con frases listas y «Escribir…»: al elegir, la llamada se rechaza y el
 * texto le llega al que llama como un mensaje normal del chat (queda en el chat de los dos).
 */
import { _sendTextTo } from './send.js';
import { _showInfoToast } from './ui_bits.js';
import { t } from './i18n.js';
import { sheetRow } from './chat_sheet.js'; // B-EST (26-11): filas de hoja comunes

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
  // B-EST (26-11): la hoja común (como las opciones del chat): asa, título de hoja, cada frase como fila con su icono y «Cancelar» al final
  ov.className = 'nx-chat-sheet';
  ov.style.zIndex = '2147483646'; // por encima de la pantalla de llamada
  var sheet = document.createElement('div');
  sheet.className = 'nx-chat-sheet-body nx-sheet-tall';
  var h = document.createElement('div');
  h.className = 'nx-sheet-title';
  h.textContent = t('call_qr_title', 'Responder con mensaje') + (name ? ' · ' + name : '');
  sheet.appendChild(h);
  var close = function() { ov.remove(); };
  _presets().forEach(function(txt) {
    var b = sheetRow(txt, 'nx-open', 'nexo-qr-preset');
    b.addEventListener('click', function(e) { e.stopPropagation(); close(); sendCallReply(nx, txt, reject); });
    sheet.appendChild(b);
  });
  // «Escribir…»: un cuadro de texto propio y «Enviar»
  var write = sheetRow(t('call_qr_write', 'Escribir…'), 'nx-edit', 'nexo-qr-write');
  var box = document.createElement('div');
  box.className = 'nx-qr-box';
  box.style.display = 'none';
  var ta = document.createElement('textarea');
  ta.rows = 2; ta.maxLength = 500;
  ta.className = 'nx-input';
  ta.placeholder = t('call_qr_placeholder', 'Tu mensaje');
  var send = document.createElement('button');
  send.className = 'nexo-qr-send nx-btn nx-btn-primary';
  send.textContent = t('call_qr_send', 'Enviar');
  send.addEventListener('click', function(e) { e.stopPropagation(); var v = ta.value.trim(); if (!v) { ta.focus(); return; } close(); sendCallReply(nx, v, reject); });
  box.appendChild(ta); box.appendChild(send);
  write.addEventListener('click', function(e) { e.stopPropagation(); write.style.display = 'none'; box.style.display = 'flex'; ta.focus(); });
  sheet.appendChild(write); sheet.appendChild(box);
  var cancel = sheetRow(t('misc_cancel', 'Cancelar'), 'mm-cancel', 'nexo-qr-cancel');
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
