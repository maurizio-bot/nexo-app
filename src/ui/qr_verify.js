/**
 * qr_verify.js v1.0 — Número de seguridad por QR (como Signal).
 *
 * En vez de comparar 60 cifras a ojo, un teléfono muestra un QR y el otro lo escanea desde el chat. El QR lleva
 * 'NEXO-SN1|<NEXO ID de quien lo muestra>|<NEXO ID para quien es>|<60 cifras>'. Quien escanea calcula su propio
 * número con las claves que tiene guardadas: si coincide, las dos claves de identidad son las de verdad (nadie en
 * medio) y el contacto queda verificado. El QR no lleva nada secreto (el número sale de las claves públicas).
 * Generar: qrcode-generator; leer: jsQR sobre los fotogramas de la cámara (getUserMedia, como la cámara del chat).
 * Todo en el teléfono, sin internet ni servicios de Google.
 */
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';

var PREFIX = 'NEXO-SN1';
function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _digits(n) { return String(n || '').replace(/\D/g, ''); }

export function safetyQrPayload(myNx, theirNx, number) {
  return [PREFIX, _nid(myNx), _nid(theirNx), _digits(number)].join('|');
}

// Lo escaneado en el teléfono de myNx, en el chat con theirNx (number: el número que calcula este teléfono).
// 'ok' | 'invalid' (no es un QR de NEXO) | 'other' (es de otro contacto) | 'notme' (lo generó para otra persona)
// | 'mismatch' (mismo contacto, otro número: clave distinta, posible impostor)
export function checkSafetyQr(text, myNx, theirNx, number) {
  var p = String(text || '').trim().split('|');
  if (p.length !== 4 || p[0] !== PREFIX || !/^\d{60}$/.test(p[3])) return 'invalid';
  if (_nid(p[1]) !== _nid(theirNx)) return 'other';
  if (_nid(p[2]) !== _nid(myNx)) return 'notme';
  return p[3] === _digits(number) ? 'ok' : 'mismatch';
}

export function qrSvg(text) {
  var q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

function _overlay(id) {
  var old = document.getElementById(id);
  if (old) old.remove();
  var o = document.createElement('div');
  o.id = id;
  o.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px;color:#fff;font-size:14px;text-align:center;';
  document.body.appendChild(o);
  return o;
}
function _button(label, primary) {
  var b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'padding:10px 18px;border-radius:10px;border:none;font-size:14px;cursor:pointer;color:#fff;background:' + (primary ? '#00c8ff' : 'rgba(255,255,255,0.18)') + ';';
  return b;
}

// Muestra el QR a pantalla completa (fondo blanco para que la cámara del otro lo lea bien)
export function showSafetyQr(payload, caption) {
  var o = _overlay('qr-show-overlay');
  var box = document.createElement('div');
  box.className = 'qr-code';
  box.dataset.payload = payload;
  box.style.cssText = 'background:#fff;padding:10px;border-radius:12px;width:min(78vw,340px);height:min(78vw,340px);';
  box.innerHTML = qrSvg(payload);
  var svg = box.querySelector('svg');
  if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; }
  var t = document.createElement('div');
  t.textContent = caption || '';
  t.style.cssText = 'max-width:340px;white-space:pre-line;';
  var close = _button('Cerrar', false);
  close.onclick = function() { o.remove(); };
  o.appendChild(box);
  o.appendChild(t);
  o.appendChild(close);
  return o;
}

// Abre la cámara y busca un QR; onText(texto) al encontrarlo (y se cierra sola). Devuelve la función de cerrar.
export function openQrScanner(onText, caption) {
  var o = _overlay('qr-scan-overlay');
  var stream = null, timer = null, closed = false;
  var wrap = document.createElement('div');
  wrap.style.cssText = 'position:relative;width:min(86vw,380px);height:min(86vw,380px);border-radius:14px;overflow:hidden;background:#000;';
  var video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
  var frame = document.createElement('div');
  frame.style.cssText = 'position:absolute;inset:12%;border:3px solid #00c8ff;border-radius:12px;pointer-events:none;';
  wrap.appendChild(video);
  wrap.appendChild(frame);
  var t = document.createElement('div');
  t.className = 'qr-scan-text';
  t.textContent = caption || 'Apunta al QR';
  t.style.cssText = 'max-width:380px;white-space:pre-line;';
  var cancel = _button('Cancelar', false);
  o.appendChild(wrap);
  o.appendChild(t);
  o.appendChild(cancel);
  var canvas = document.createElement('canvas');
  var ctx = null;
  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    if (stream) stream.getTracks().forEach(function(tr) { tr.stop(); });
    video.srcObject = null;
    o.remove();
  }
  cancel.onclick = close;
  function tick() {
    if (closed || !video.videoWidth || video.readyState < 2) return;
    // Basta con 640 px de ancho: más rápido y los QR de NEXO son pequeños (versión 6)
    var scale = Math.min(1, 640 / video.videoWidth);
    var w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; ctx = null; }
    ctx = ctx || canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    var img = ctx.getImageData(0, 0, w, h);
    var r = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
    if (r && r.data) { close(); onText(r.data); }
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { t.textContent = 'Cámara no disponible'; return close; }
  var start = function(c) {
    return navigator.mediaDevices.getUserMedia(c).then(function(s) {
      if (closed) { s.getTracks().forEach(function(tr) { tr.stop(); }); return; }
      stream = s;
      video.srcObject = s;
      video.play().catch(function() {});
      timer = setInterval(tick, 200);
    });
  };
  start({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
    .catch(function() { return start({ video: true, audio: false }); })
    .catch(function(e) { t.textContent = 'No se pudo abrir la cámara: ' + ((e && e.message) || e); });
  return close;
}
