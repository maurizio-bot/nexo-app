/**
 * NEXO — Cobros (pagos, Fase 1). Un mensaje de "cobro" en el chat: importe, concepto y CÓMO te pagan (alias/CBU,
 * enlace o QR de un proveedor ya licenciado —Mercado Pago, PayPal…— o "efectivo"). NEXO NUNCA toca el dinero: es
 * "mensajería de cobros" (como una factura o un "Request to Pay"), así que no necesita licencia ni servidor; el cobro
 * viaja cifrado como cualquier mensaje (Bluetooth/Wi-Fi/Jump/internet). _sendAttachment lo da main.js con cobroUse().
 */
import { _closeAttachMenu, _showPermissionError, _showInfoToast } from './ui_bits.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _sendAttachment;
export function cobroUse(d) { _sendAttachment = d._sendAttachment; } // [/pegamento]

// "Cómo te pagan" se recuerda por teléfono (comodidad; no es un dato sensible nuevo: es tu alias/enlace público)
var COBRO_METODO_KEY = 'nexo_cobro_metodo';
var COBRO_MONEDA_KEY = 'nexo_cobro_moneda';
export var MONEDAS = ['ARS', 'MXN', 'USD', 'EUR', 'COP', 'CLP', 'PEN', 'UYU', 'BRL', 'BOB', 'PYG', 'GTQ', 'DOP'];

function _recall(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
function _remember(k, v) { try { if (v) localStorage.setItem(k, v); } catch (e) {} }

// Ronda 2793 (pedido del dueño): la moneda por defecto se detecta del país/idioma del teléfono (antes arrancaba fija en
// ARS). Solo es el valor INICIAL; si el dueño elige otra, se recuerda (COBRO_MONEDA_KEY) y manda esa.
var _PAIS_MONEDA = { MX: 'MXN', AR: 'ARS', US: 'USD', CO: 'COP', CL: 'CLP', PE: 'PEN', UY: 'UYU', BR: 'BRL', BO: 'BOB', PY: 'PYG', GT: 'GTQ', DO: 'DOP', ES: 'EUR' };
function _defaultMoneda() {
  try {
    var loc = (navigator.languages && navigator.languages[0]) || navigator.language || '';
    var m = /[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(String(loc));
    var cur = m && _PAIS_MONEDA[m[1].toUpperCase()];
    if (cur && MONEDAS.indexOf(cur) >= 0) return cur;
  } catch (e) {}
  return 'USD';
}

export function _handleCobro() {
  _closeAttachMenu();
  _openCobroSheet();
}

// Hoja de composición (modal): importe + moneda + concepto + cómo te pagan.
export function _openCobroSheet() {
  if (document.getElementById('cobro-sheet')) return;
  var metodo0 = _recall(COBRO_METODO_KEY, '');
  var moneda0 = _recall(COBRO_MONEDA_KEY, 'ARS');
  var ov = document.createElement('div');
  ov.id = 'cobro-sheet';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.6);display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(2px);';
  var opciones = MONEDAS.map(function(m) { return '<option value="' + m + '"' + (m === moneda0 ? ' selected' : '') + '>' + m + '</option>'; }).join('');
  ov.innerHTML =
    '<div style="background:#14141c;width:100%;max-width:460px;border-radius:18px 18px 0 0;padding:18px 18px 22px;box-shadow:0 -8px 30px rgba(0,0,0,0.5);">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;"><span style="font-size:20px;">💵</span><b style="font-size:16px;color:#fff;">Pedir un cobro</b></div>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px;">' +
        '<input id="cobro-importe" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0,00" style="flex:1;min-width:0;padding:12px;border-radius:10px;border:1px solid #2a2a3a;background:#0f0f16;color:#fff;font-size:18px;">' +
        '<select id="cobro-moneda" style="width:92px;padding:12px;border-radius:10px;border:1px solid #2a2a3a;background:#0f0f16;color:#fff;font-size:14px;">' + opciones + '</select>' +
      '</div>' +
      '<input id="cobro-concepto" type="text" maxlength="80" placeholder="Concepto (opcional): p. ej. almuerzo" style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a2a3a;background:#0f0f16;color:#fff;font-size:14px;margin-bottom:10px;">' +
      '<input id="cobro-metodo" type="text" maxlength="120" value="' + _attr(metodo0) + '" placeholder="Cómo te pagan: alias/CBU, PayPal.me/vos, Mercado Pago, efectivo…" style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a2a3a;background:#0f0f16;color:#fff;font-size:14px;margin-bottom:6px;">' +
      '<div style="font-size:11px;color:#888;margin-bottom:14px;line-height:1.4;">NEXO no cobra ni guarda tu dinero: manda un pedido de cobro con tus datos para que te paguen por fuera (banco, Mercado Pago, PayPal, efectivo…).</div>' +
      '<div style="display:flex;gap:10px;">' +
        '<button id="cobro-cancel" style="flex:1;padding:12px;border-radius:10px;border:1px solid #2a2a3a;background:transparent;color:#bbb;font-size:14px;cursor:pointer;">Cancelar</button>' +
        '<button id="cobro-send" style="flex:2;padding:12px;border-radius:10px;border:none;background:#22c55e;color:#06220f;font-weight:700;font-size:15px;cursor:pointer;">Enviar cobro</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
  var close = function() { if (ov.parentNode) ov.parentNode.removeChild(ov); };
  ov.addEventListener('click', function(e) { if (e.target === ov) close(); });
  ov.querySelector('#cobro-cancel').addEventListener('click', close);
  var imp = ov.querySelector('#cobro-importe');
  setTimeout(function() { try { imp.focus(); } catch (e) {} }, 50);
  ov.querySelector('#cobro-send').addEventListener('click', function() {
    var importe = parseFloat(String(imp.value).replace(',', '.'));
    if (!(importe > 0)) { imp.style.borderColor = '#ff3b30'; _showInfoToast('Pon un importe mayor que 0.', 3000); return; }
    var moneda = ov.querySelector('#cobro-moneda').value || 'ARS';
    var concepto = String(ov.querySelector('#cobro-concepto').value || '').slice(0, 80);
    var metodo = String(ov.querySelector('#cobro-metodo').value || '').slice(0, 120);
    _remember(COBRO_METODO_KEY, metodo);
    _remember(COBRO_MONEDA_KEY, moneda);
    close();
    _sendCobro(importe, moneda, concepto, metodo);
  });
}

export function _sendCobro(importe, moneda, concepto, metodo) {
  if (typeof _sendAttachment !== 'function') { _showPermissionError('No se pudo enviar el cobro (app no lista).'); return; }
  // redondeo a 2 decimales para no arrastrar basura de coma flotante
  var monto = Math.round(Number(importe) * 100) / 100;
  var data = { importe: monto, moneda: String(moneda || 'ARS').slice(0, 5), concepto: String(concepto || ''), metodo: String(metodo || ''), ts: Date.now() };
  // payload NO vacío (render.js solo arma el adjunto si attachmentPayload existe); meta lleva lo mismo para dibujar
  _sendAttachment('cobro', JSON.stringify(data), data);
  console.log('[ATTACH] Cobro enviado: ' + monto + ' ' + data.moneda);
}

// Escape para meter un valor dentro de un atributo HTML (value="…") sin romperlo ni inyectar
function _attr(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var _esc = _attr; // mismo escape para texto dentro del HTML (viene del otro teléfono: nunca como HTML)

function _fmtMonto(n) {
  var x = Number(n);
  if (!isFinite(x)) return '0';
  try { return x.toLocaleString('es', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); } catch (e) { return (Math.round(x * 100) / 100).toString(); }
}

// Dibuja la tarjeta de cobro en el chat (emisor y receptor). `cob` = meta {importe, moneda, concepto, metodo}.
// `msg._own`: si es un cobro que mandé yo (lo veo como "enviado") o uno que me mandan (botón para pagar/copiar).
export function _renderCobroCard(container, cob, msg) {
  var importe = _fmtMonto(cob && cob.importe);
  var moneda = _esc((cob && cob.moneda) || '');
  var concepto = String((cob && cob.concepto) || '');
  var metodo = String((cob && cob.metodo) || '');
  var own = !!(msg && msg._own);
  var esURL = /^https?:\/\//i.test(metodo.trim());
  // Ronda 2791 (informe del dueño): la tarjeta tenía un borde verde grueso y se veía «enmarcada»; ahora igual que la de
  // Ubicación (mismo radio 12px, fondo sutil rgba(0,0,0,0.3), SIN borde, max 260px). El verde queda solo en el 💵, el
  // texto y los botones.
  var html = '<div style="border-radius:12px;overflow:hidden;background:rgba(0,0,0,0.3);max-width:260px;">';
  html += '<div style="display:flex;align-items:center;gap:6px;padding:9px 12px 4px;font-size:12px;color:#8fe0ab;">💵 ' + (own ? 'Cobro enviado' : 'Te piden un cobro') + '</div>';
  html += '<div style="padding:0 12px;font-size:24px;font-weight:800;color:#fff;line-height:1.15;">' + importe + ' <span style="font-size:13px;font-weight:600;opacity:0.8;">' + moneda + '</span></div>';
  if (concepto) html += '<div style="padding:2px 12px 0;font-size:13px;color:#cfd8d2;">' + _esc(concepto) + '</div>';
  if (metodo) html += '<div style="padding:8px 12px 0;font-size:12px;color:#9aa;">Cómo pagar: <span style="color:#dfe;">' + _esc(metodo) + '</span></div>';
  html += '<div style="display:flex;gap:8px;padding:10px 12px 12px;">';
  if (metodo && esURL) html += '<a href="' + _attr(metodo.trim()) + '" target="_blank" rel="noopener" style="flex:1;text-align:center;padding:8px;background:rgba(34,197,94,0.3);border-radius:8px;color:#fff;text-decoration:none;font-size:13px;">Abrir enlace</a>';
  if (metodo) html += '<button class="cobro-copy" style="flex:1;padding:8px;background:rgba(255,255,255,0.12);border:none;border-radius:8px;color:#fff;font-size:13px;cursor:pointer;">Copiar datos</button>';
  html += '</div></div>';
  container.innerHTML = html;
  var copyBtn = container.querySelector('.cobro-copy');
  if (copyBtn) copyBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var txt = metodo + (concepto ? ' — ' + concepto : '') + ' (' + importe + ' ' + moneda + ')';
    var done = function() { copyBtn.textContent = 'Copiado ✓'; setTimeout(function() { copyBtn.textContent = 'Copiar datos'; }, 1500); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, function() { _fallbackCopy(txt, done); }); }
      else _fallbackCopy(txt, done);
    } catch (err) { _fallbackCopy(txt, done); }
  });
}

function _fallbackCopy(txt, done) {
  try {
    var ta = document.createElement('textarea');
    ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    if (typeof done === 'function') done();
  } catch (e) {}
}
