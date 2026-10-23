/**
 * NEXO — Perfil y Fénix (sacados de main.js en la ronda 2752, sin cambios en su código): la ficha de Perfil (NEXO ID,
 * Fénix, Seguridad, Internet, Diagnóstico) y los avisos de Fénix (recuperación, mensajes recuperados, petición de
 * ayuda de un teléfono nuevo). Lo que usa del resto de la app se lo da main.js con profileUse().
 */
import { securitySectionHtml, renderSecuritySection } from './app_lock.js';
import { _diagnosticText } from './diag.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _showInfoToast;
export function profileUse(d) { _showInfoToast = d._showInfoToast; } // [/pegamento]

function _openProfileSheet() {
  var old = document.getElementById('nexo-profile-sheet');
  if (old) old.remove();
  var bi = window.bleInterface || {};
  var sheet = document.createElement('div');
  sheet.id = 'nexo-profile-sheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#0a0a15;color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;font-family:inherit;overflow-y:auto;';
  sheet.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
    '<div style="font-size:20px;font-weight:700;">Perfil</div><button id="nexo-profile-close" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:18px;padding:8px 14px;font-size:14px;">Cerrar</button></div>' +
    '<div style="font-size:14px;opacity:0.85;margin-bottom:12px;">Mi NEXO ID: <b id="nexo-profile-id"></b></div>' +
    '<div style="font-size:16px;font-weight:600;margin:8px 0;">Fénix</div>' +
    '<div id="nexo-fenix-status" style="font-size:12px;opacity:0.8;margin-bottom:8px;white-space:pre-line;"></div>' +
    '<button id="nexo-fenix-recover" style="background:rgba(255,255,255,0.12);color:#fff;border:none;border-radius:12px;padding:10px;font-size:14px;margin-bottom:12px;">Recuperar mi cuenta (teléfono nuevo)</button>' +
    securitySectionHtml() +
    // v9.9.51: internet (relés públicos y Tor, src/net/net_link.js)
    '<div style="font-size:16px;font-weight:600;margin:8px 0;">Internet</div>' +
    '<div id="nexo-net-status" style="font-size:12px;opacity:0.8;margin-bottom:8px;white-space:pre-line;"></div>' +
    '<label style="display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:12px;"><input type="checkbox" id="nexo-net-tor"> Usar Tor con Wi-Fi (oculta tu IP; más lento)</label>' +
    '<div style="font-size:16px;font-weight:600;margin:8px 0;">Diagnóstico</div>' +
    '<div style="font-size:12px;opacity:0.7;margin-bottom:8px;">Registro de lo que hace la app (incluye la sesión anterior). Cópialo y pégalo para revisar un fallo.</div>' +
    '<button id="nexo-diag-copy" style="background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:12px;padding:12px;font-size:15px;font-weight:600;margin-bottom:8px;">Copiar diagnóstico</button>' +
    '<textarea id="nexo-diag-text" readonly style="flex:1;min-height:220px;width:100%;box-sizing:border-box;background:#000;color:#9fe;border:1px solid #234;border-radius:8px;font-size:10px;font-family:monospace;padding:8px;"></textarea>';
  document.body.appendChild(sheet);
  sheet.querySelector('#nexo-profile-id').textContent = bi.localNexoId || '?';
  var ta = sheet.querySelector('#nexo-diag-text');
  ta.value = _diagnosticText();
  ta.scrollTop = ta.scrollHeight;
  sheet.querySelector('#nexo-profile-close').onclick = function() { sheet.remove(); };
  _renderFenixStatus();
  renderSecuritySection();
  _renderNetStatus();
  var torBox = sheet.querySelector('#nexo-net-tor');
  if (torBox) {
    torBox.checked = !!(bi.net && bi.net.torWanted());
    torBox.onchange = function() { if (bi.net) { bi.net.setTor(torBox.checked); setTimeout(_renderNetStatus, 300); } };
  }
  sheet.querySelector('#nexo-fenix-recover').onclick = function() {
    var fx = bi.fenix;
    if (!fx) return;
    if (fx.recovery) { fx.cancelRecovery(); _renderFenixStatus(); return; }
    if (!window.confirm('Recuperar tu cuenta: pide a tus contactos (al menos 6) que estén cerca con NEXO abierto. A cada uno le saldrá un aviso para confirmar que eres tú. ¿Empezar?')) return;
    fx.startRecovery(bi.localDeviceName || '');
    _renderFenixStatus();
  };
  sheet.querySelector('#nexo-diag-copy').onclick = function() {
    var btn = this, txt = ta.value;
    var ok = function() { btn.textContent = 'Copiado ✓'; setTimeout(function() { btn.textContent = 'Copiar diagnóstico'; }, 2000); };
    var fallback = function() { try { ta.focus(); ta.select(); document.execCommand('copy'); ok(); } catch (e) { btn.textContent = 'Selecciona el texto y cópialo'; } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok).catch(fallback);
    else fallback();
  };
}
window.addEventListener('nexo:ui:profile', _openProfileSheet);

// ===================== v9.9.44: Protocolo Fénix (src/fenix/fenix.js, docs/FENIX.md) =====================
var _fenixRecoveryText = '';
function _renderNetStatus() {
  var el = document.getElementById('nexo-net-status');
  var net = window.bleInterface && window.bleInterface.net;
  if (!el || !net) return;
  var open = net._openCount ? net._openCount() : 0, total = net.relayUrls ? net.relayUrls().length : 0;
  var on = 0, tor = 0;
  net.peers.forEach(function(p) { if (p.up) on++; if (p.torOk) tor++; });
  var t = net.tor || {};
  el.textContent = 'Relés públicos: ' + open + ' de ' + total + ' conectados' + (open ? '' : ' (sin internet o sin contactos con NEXO actualizado)') +
    '\nContactos en línea por internet: ' + on +
    '\nTor: ' + (!net.torWanted() ? 'apagado' : t.ready ? 'listo' + (tor ? ' · ' + tor + ' contacto(s) directo por Tor' : '') : t.starting ? 'arrancando…' : (net.wifi ? (t.error ? 'no disponible (' + t.error + ')' : 'en espera') : 'solo con Wi-Fi'));
}
function _renderFenixStatus() {
  var el = document.getElementById('nexo-fenix-status');
  var btn = document.getElementById('nexo-fenix-recover');
  var fx = window.bleInterface && window.bleInterface.fenix;
  if (!el || !fx) return;
  var st = fx.status();
  var txt;
  if (fx.recovery) txt = _fenixRecoveryText || 'Buscando contactos cerca…';
  else if (!st.active) txt = 'Tu cuenta se protegerá sola cuando tengas ' + st.min + ' contactos con NEXO actualizado (tienes ' + st.eligible + ').';
  else txt = '🔥 Cuenta protegida: ' + st.delivered + ' de ' + (st.n * st.copies) + ' fragmentos entregados (' + st.copies + (st.copies > 1 ? ' copias' : ' copia') + '). Se recupera con ' + st.t + ' contactos.' + (st.lost ? ' ' + st.lost + ' contacto(s) perdidos: sus fragmentos pasan a otros.' : '');
  // v9.9.50: Fénix fase 2 (mensajes de texto en segmentos, 2 copias)
  if (st.active && st.segs) txt += '\n💬 Mensajes protegidos: ' + st.msgs + ' (' + st.segsSafe + ' de ' + st.segs + ' segmentos ya en 2 contactos).';
  if (st.guarding) txt += '\nGuardas fragmentos de ' + st.guarding + ' contacto(s) (no puedes leerlos).';
  el.textContent = txt;
  if (btn) btn.textContent = fx.recovery ? 'Cancelar la recuperación' : 'Recuperar mi cuenta (teléfono nuevo)';
}
window.addEventListener('nexo:fenix:recovery', function(e) {
  var d = (e && e.detail) || {};
  _fenixRecoveryText = d.state === 'cancelled' ? '' : 'Recuperando: ' + d.got + ' de ' + d.need + ' fragmentos (preguntados ' + d.asked + ' teléfonos cerca). Tus contactos deben confirmar en su pantalla.';
  _renderFenixStatus();
});
window.addEventListener('nexo:fenix:messages', function(e) {
  var d = (e && e.detail) || {};
  _showInfoToast('🔥 Fénix: ' + (d.added || 0) + ' mensaje(s) recuperados', 3500);
  if (window.bleInterface && typeof window.bleInterface.renderContactsList === 'function') window.bleInterface.renderContactsList();
  _renderFenixStatus();
});
window.addEventListener('nexo:fenix:restored', function(e) {
  var d = (e && e.detail) || {};
  _fenixRecoveryText = '✅ Cuenta ' + (d.nexoId || '') + ' recuperada con ' + (d.contacts || 0) + ' contactos. Reiniciando…';
  _renderFenixStatus();
  _showInfoToast('✅ Cuenta recuperada. Reiniciando NEXO…', 3000);
  setTimeout(function() { try { window.location.reload(); } catch (err) {} }, 2500);
});
// En el teléfono de un contacto: alguien con un teléfono nuevo pide recuperar su cuenta
window.addEventListener('nexo:fenix:request', function(e) {
  var d = (e && e.detail) || {};
  var fx = window.bleInterface && window.bleInterface.fenix;
  if (!fx || !d.rid || !Array.isArray(d.choices)) return;
  var old = document.getElementById('nexo-fenix-ask');
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = 'nexo-fenix-ask';
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:16px;';
  var card = document.createElement('div');
  card.style.cssText = 'background:#11121f;color:#fff;border-radius:16px;padding:18px;max-width:340px;width:100%;font-size:14px;';
  var h = document.createElement('div');
  h.style.cssText = 'font-size:17px;font-weight:700;margin-bottom:8px;';
  h.textContent = '🔥 Recuperar una cuenta';
  var p = document.createElement('div');
  p.style.cssText = 'opacity:0.85;margin-bottom:12px;';
  p.textContent = 'Un teléfono nuevo cerca' + (d.name ? ' ("' + d.name + '")' : '') + ' pide recuperar su cuenta NEXO. Ayúdale solo si la persona está contigo y estás seguro de quién es. ¿Quién es?';
  card.appendChild(h); card.appendChild(p);
  var close = function() { box.remove(); };
  d.choices.forEach(function(c) {
    var b = document.createElement('button');
    b.className = 'fenix-yes';
    b.style.cssText = 'display:block;width:100%;margin-bottom:8px;padding:10px;border:none;border-radius:10px;background:#00c8ff;color:#fff;font-size:15px;';
    b.textContent = 'Es ' + c.name;
    b.onclick = function() { close(); fx.answerRecovery(d.rid, c.nx); };
    card.appendChild(b);
  });
  var no = document.createElement('button');
  no.className = 'fenix-no';
  no.style.cssText = 'display:block;width:100%;padding:10px;border:none;border-radius:10px;background:rgba(255,255,255,0.15);color:#fff;font-size:15px;';
  no.textContent = 'No lo sé / no es nadie de ellos';
  no.onclick = function() { close(); fx.answerRecovery(d.rid, null); };
  card.appendChild(no);
  box.appendChild(card);
  document.body.appendChild(box);
});
