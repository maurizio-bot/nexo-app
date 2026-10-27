/**
 * NEXO — Perfil, Ajustes y Fénix. Ronda 2807 (pedido del dueño «organizar bien mi perfil con el menú ajustes»):
 * se separan en DOS pantallas — «Perfil» (identidad: NEXO ID, foto, compartir, cómo te ven) y «Ajustes» (todo lo
 * configurable: tu cuenta Fénix/cambiar de teléfono, seguridad, avisos, llamadas/tono, internet, diagnóstico). El
 * gesto secreto (dibujar la «N») vive ahora en AJUSTES. Lo que usa del resto de la app se lo da main.js con profileUse().
 */
import { securitySectionHtml, renderSecuritySection } from './app_lock.js';
import { _diagnosticText } from './diag.js';
import { startReceiveAccount, startSendAccount } from './move_account.js';
import { clearMyAvatar, makeAvatar, myAvatar, paintAvatar, setMyAvatar } from './avatar.js';
import { mirrorPeerPref, setMirrorPeerPref } from './calls_ui.js';
import { attachNexoUnlockGesture } from './nexo_game.js';
import { perfSectionHtml, renderPerfSection } from './perf.js';

// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)
var _showInfoToast;
export function profileUse(d) { _showInfoToast = d._showInfoToast; } // [/pegamento]

// ===================== Perfil (identidad) =====================
function _openProfileSheet() {
  var old = document.getElementById('nexo-profile-sheet');
  if (old) old.remove();
  var old2 = document.getElementById('nexo-settings-sheet');
  if (old2) old2.remove();
  var bi = window.bleInterface || {};
  var sheet = document.createElement('div');
  sheet.id = 'nexo-profile-sheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483646;color:#fff;box-sizing:border-box;font-family:inherit;overflow-y:auto;';
  sheet.innerHTML = '<div class="nx-profile-in">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 14px;">' +
    '<div style="font-size:26px;font-weight:800;">Perfil</div><button id="nexo-profile-close" class="nx-btn" style="width:auto;margin:0;padding:9px 16px;">Cerrar</button></div>' +
    '<div class="nx-card nx-id-card"><div class="nx-av" id="nexo-profile-av" title="Cambiar foto" style="cursor:pointer;"></div><div style="flex:1;min-width:0;"><div class="nx-idtxt">Mi NEXO ID</div><b id="nexo-profile-id"></b>' +
    '<div id="nexo-profile-seen" class="nx-idtxt" style="margin-top:2px;"></div>' +
    '<div><button id="nexo-av-pick" class="nx-link">Cambiar foto</button> <button id="nexo-av-clear" class="nx-link" style="display:none;">Quitar</button> <button id="nexo-id-share" class="nx-link">Compartir mi ID</button></div></div></div>' +
    // Ronda 2807: el resto (seguridad, avisos, llamadas, internet, diagnóstico, cuenta) se abre en Ajustes
    '<button id="nexo-open-settings" class="nx-btn nx-btn-primary" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:4px;font-size:16px;padding:14px;">⚙️ Ajustes</button>' +
    '<div class="nx-sub" style="text-align:center;margin-top:2px;">Seguridad, avisos, llamadas, internet, diagnóstico y tu cuenta (Fénix, cambiar de teléfono).</div>' +
    // Ronda 2810 (pedido del dueño): el gesto secreto de la «N» vive en el espacio negro de ABAJO de Perfil, no en
    // Ajustes (donde el scroll se comía el trazo). touch-action:none → aquí el dedo dibuja, no hace scroll.
    '<div id="nexo-gesture-zone" style="flex:1;min-height:220px;touch-action:none;"></div>' +
    '</div>';
  document.body.appendChild(sheet);
  sheet.querySelector('#nexo-profile-id').textContent = bi.localNexoId || '?';
  // Ronda 2771 (revisión, parte 4): cómo te ven tus contactos (el nombre del teléfono) y sus iniciales en el círculo
  var myName = String(bi.localDeviceName || '').trim();
  sheet.querySelector('#nexo-profile-seen').textContent = myName ? 'Tus contactos te ven como «' + myName + '» (el nombre del teléfono)' : '';
  var initials = function(n) { var w = n.split(/\s+/).filter(Boolean); return ((w[0] || '').charAt(0) + (w[1] || '').charAt(0)).toUpperCase(); };
  // Ronda 2765: foto de perfil (avatar.js): tocar el círculo o "Cambiar foto"
  var avEl = sheet.querySelector('#nexo-profile-av'), clr = sheet.querySelector('#nexo-av-clear');
  var paintMine = function() {
    avEl.style.backgroundImage = ''; avEl.textContent = (myName && initials(myName)) || String(bi.localNexoId || '?').replace(/^NX/i, '').charAt(0).toUpperCase() || 'N';
    paintAvatar(avEl, 'me'); clr.style.display = myAvatar() ? '' : 'none';
  };
  paintMine();
  var pick = function() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
    inp.onchange = function() {
      var f = inp.files && inp.files[0];
      inp.remove();
      if (!f) return;
      makeAvatar(f).then(function(url) {
        if (!setMyAvatar(url)) throw new Error('foto no válida');
        paintMine();
        if (_showInfoToast) _showInfoToast('Foto de perfil lista: tus contactos la verán al conectar', 3000);
      }).catch(function(e) { if (_showInfoToast) _showInfoToast('No se pudo usar esa foto: ' + ((e && e.message) || 'error'), 3500); });
    };
    document.body.appendChild(inp);
    inp.click();
  };
  avEl.onclick = pick;
  sheet.querySelector('#nexo-av-pick').onclick = pick;
  // Ronda 2779 (pedido del dueño): compartir mi NEXO ID para que un amigo lejano me agregue (por WhatsApp, etc.)
  var shareBtn = sheet.querySelector('#nexo-id-share');
  if (shareBtn) shareBtn.onclick = function() {
    var id = String(bi.localNexoId || '').toUpperCase();
    if (!id || id === '?') return;
    var msg = 'Agrégame en NEXO con mi ID: ' + id;
    try { if (navigator.share) { navigator.share({ text: msg }).catch(function() {}); return; } } catch (e) {}
    var done = function() { shareBtn.textContent = 'ID copiado ✓'; setTimeout(function() { shareBtn.textContent = 'Compartir mi ID'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(id).then(done).catch(function() { if (_showInfoToast) _showInfoToast('Tu NEXO ID: ' + id, 5000); });
    else if (_showInfoToast) _showInfoToast('Tu NEXO ID: ' + id, 5000);
  };
  clr.onclick = function() { clearMyAvatar(); paintMine(); };
  sheet.querySelector('#nexo-profile-close').onclick = function() { sheet.remove(); };
  sheet.querySelector('#nexo-open-settings').onclick = function() { _openSettingsSheet(); };
  // Juego secreto (pedido del dueño): dibujar la «N» de NEXO en el espacio negro de abajo abre el mini-arcade oculto.
  var gz = sheet.querySelector('#nexo-gesture-zone');
  if (gz) attachNexoUnlockGesture(gz);
}
window.addEventListener('nexo:ui:profile', _openProfileSheet);

// ===================== Ajustes (todo lo configurable) =====================
function _openSettingsSheet() {
  var old = document.getElementById('nexo-settings-sheet');
  if (old) old.remove();
  var perfil = document.getElementById('nexo-profile-sheet');
  if (perfil) perfil.remove(); // una sola hoja a la vez: Ajustes reemplaza a Perfil («‹ Perfil» la vuelve a abrir)
  var bi = window.bleInterface || {};
  var sheet = document.createElement('div');
  sheet.id = 'nexo-settings-sheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483646;color:#fff;box-sizing:border-box;font-family:inherit;overflow-y:auto;';
  // una tarjeta por sección (estilo NEXO, nexo_theme.css)
  var card = function(ico, title, body) { return '<div class="nx-card"><div class="nx-h"><span class="nx-ico">' + ico + '</span>' + title + '</div>' + body + '</div>'; };
  sheet.innerHTML = '<div class="nx-profile-in">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 14px;gap:10px;">' +
    '<div style="display:flex;align-items:center;gap:8px;min-width:0;"><button id="nexo-settings-back" class="nx-btn" style="width:auto;margin:0;padding:9px 13px;">‹ Perfil</button><div style="font-size:26px;font-weight:800;">Ajustes</div></div>' +
    '<button id="nexo-settings-close" class="nx-btn" style="width:auto;margin:0;padding:9px 16px;flex-shrink:0;">Cerrar</button></div>' +
    // Cuenta (Fénix + cambiar de teléfono)
    card('🔥', 'Fénix (respaldo de tu cuenta)', '<div id="nexo-fenix-status" class="nx-sub"></div>' +
      '<button id="nexo-fenix-recover" class="nx-btn">Recuperar mi cuenta (teléfono nuevo)</button>') +
    // Ronda 2759: pasar la cuenta de un teléfono a otro (move_account.js)
    card('📲', 'Cambiar de teléfono', '<div class="nx-sub">Con los dos teléfonos en el mismo Wi-Fi: en el nuevo, "Traer mi cuenta"; en este, "Pasar mi cuenta" y lee su código. Pasa todo (contactos, chats, fotos, grupos) y este queda vacío.</div>' +
      '<button id="nexo-move-send" class="nx-btn">Pasar mi cuenta a un teléfono nuevo</button>' +
      '<button id="nexo-move-receive" class="nx-btn">Traer mi cuenta de otro teléfono</button>') +
    '<div class="nx-card">' + securitySectionHtml() + '</div>' +
    // Ronda 2765 (pedido del dueño): que los avisos y las llamadas lleguen con la pantalla apagada y la enciendan
    card('🔔', 'Avisos con la pantalla apagada', '<div class="nx-sub">Para que los mensajes y las llamadas lleguen con la app cerrada o la pantalla apagada.</div>' +
      '<div id="nexo-alert-rows"></div>' +
      '<label style="display:flex;align-items:center;gap:10px;font-size:14px;margin-top:6px;"><input type="checkbox" id="nexo-wake-msg"> Encender la pantalla con un mensaje nuevo</label>') +
    // Ronda 2772 (pedido del dueño): ver al otro como en un espejo (con su cámara de delante)
    card('🎥', 'Videollamadas', '<label style="display:flex;align-items:center;gap:10px;font-size:14px;"><input type="checkbox" id="nexo-call-mirror"> Ver al otro como en un espejo (su cámara de delante)</label>' +
      '<div class="nx-sub" style="margin-top:6px;">Sin espejo lo ves como te vería en persona: un papel con letras se lee bien.</div>') +
    // Ronda 2774 (pedido del dueño): elegir el tono de las llamadas y videollamadas; por defecto, el del teléfono.
    card('📞', 'Tono de llamada y videollamada', '<div class="nx-sub">Suena igual en llamadas y videollamadas. Por defecto usa el tono de llamada de tu teléfono.</div>' +
      '<button id="nexo-ringtone-btn" class="nx-btn" style="margin-top:6px;">Elegir tono…</button>') +
    // v9.9.51: internet (relés públicos y Tor, src/net/net_link.js)
    card('🌐', 'Internet', '<div id="nexo-net-status" class="nx-sub"></div>' +
      '<label style="display:flex;align-items:center;gap:10px;font-size:14px;margin-bottom:4px;"><input type="checkbox" id="nexo-net-tor"> Usar Tor con Wi-Fi (oculta tu IP; más lento)</label>') +
    // Ronda 2808 (pedido del dueño «rendimiento api de nexo»): medición en vivo del rendimiento de NEXO
    perfSectionHtml() +
    card('🩺', 'Diagnóstico', '<div class="nx-sub">Registro de lo que hace la app (incluye la sesión anterior). Cópialo y pégalo para revisar un fallo.</div>' +
      '<button id="nexo-diag-copy" class="nx-btn nx-btn-primary">Copiar diagnóstico</button>' +
      '<textarea id="nexo-diag-text" readonly style="min-height:220px;width:100%;box-sizing:border-box;color:#9fe;font-size:10px;font-family:monospace;padding:8px;"></textarea>') +
    '</div>';
  document.body.appendChild(sheet);
  // (Ronda 2810) El gesto secreto de la «N» ya NO vive aquí: el scroll de Ajustes se comía el trazo. Está en Perfil.
  var ta = sheet.querySelector('#nexo-diag-text');
  ta.value = _diagnosticText();
  ta.scrollTop = ta.scrollHeight;
  sheet.querySelector('#nexo-settings-close').onclick = function() { sheet.remove(); };
  sheet.querySelector('#nexo-settings-back').onclick = function() { sheet.remove(); _openProfileSheet(); };
  _renderFenixStatus();
  renderSecuritySection();
  _renderNetStatus();
  _renderAlertSettings();
  renderPerfSection(); // ronda 2808: rendimiento en vivo
  { var pr = sheet.querySelector('#nexo-perf-refresh'); if (pr) pr.onclick = function () { renderPerfSection(); }; }
  var mirBox = sheet.querySelector('#nexo-call-mirror');
  if (mirBox) { mirBox.checked = mirrorPeerPref(); mirBox.onchange = function() { setMirrorPeerPref(mirBox.checked); }; }
  // Tono de llamada/videollamada (ronda 2774): enseña el actual y abre el selector del teléfono al tocarlo
  var ringBtn = sheet.querySelector('#nexo-ringtone-btn');
  if (ringBtn) {
    var pl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
    var showTone = function(t) { ringBtn.textContent = '🔔 ' + (t || 'Tono del teléfono'); };
    if (pl && typeof pl.getCallRingtone === 'function') pl.getCallRingtone().then(function(r) { showTone(r && r.title); }).catch(function() { showTone(''); });
    else { ringBtn.style.display = 'none'; }
    ringBtn.onclick = function() {
      if (!pl || typeof pl.pickCallRingtone !== 'function') return;
      pl.pickCallRingtone().then(function(r) { if (r && r.changed) showTone(r.title); }).catch(function() {});
    };
  }
  var torBox = sheet.querySelector('#nexo-net-tor');
  if (torBox) {
    torBox.checked = !!(bi.net && bi.net.torWanted());
    torBox.onchange = function() { if (bi.net) { bi.net.setTor(torBox.checked); setTimeout(_renderNetStatus, 300); } };
  }
  sheet.querySelector('#nexo-move-send').onclick = function() { sheet.remove(); startSendAccount(); };
  sheet.querySelector('#nexo-move-receive').onclick = function() {
    if (!window.confirm('Traer tu cuenta de otro teléfono: lo que haya en ESTE teléfono se sustituye por tu cuenta. ¿Seguir?')) return;
    sheet.remove(); startReceiveAccount();
  };
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
window.addEventListener('nexo:ui:settings', _openSettingsSheet);
try { if (typeof window !== 'undefined') window.__nexoOpenSettings = _openSettingsSheet; } catch (e) {}

// Ronda 2759: botón 👤 en la cabecera (junto al 👥). La barra de abajo (Chats · Gente · Mapa · Perfil) queda fuera de la
// pantalla en los teléfonos y Perfil (con el diagnóstico) no se podía abrir.
export function installProfileButton() {
  var header = document.getElementById('main-header');
  if (!header || document.getElementById('nexo-profile-btn')) return;
  var b = document.createElement('button');
  b.id = 'nexo-profile-btn';
  b.title = 'Perfil';
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'; // ronda 2763: icono dibujado (antes un emoji)
  b.style.cssText = 'position:absolute;right:62px;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;border:none;font-size:20px;cursor:pointer;z-index:5;';
  if (getComputedStyle(header).position === 'static') header.style.position = 'relative';
  b.addEventListener('click', function(e) { e.stopPropagation(); _openProfileSheet(); });
  header.appendChild(b);
}

// Ronda 2765: qué falta para que los avisos lleguen con la pantalla apagada (cada cosa con su botón para arreglarla)
function _renderAlertSettings() {
  var box = document.getElementById('nexo-alert-rows'), wake = document.getElementById('nexo-wake-msg');
  var pl = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE;
  if (!box || !pl || typeof pl.alertSettings !== 'function') { if (box) box.textContent = 'Esta versión no lo permite.'; return; }
  pl.alertSettings().then(function(r) {
    var rows = [
      { k: 'notifications', ok: r.notifications, t: 'Notificaciones', no: 'Desactivadas: no llega ningún aviso' },
      { k: 'fullScreen', ok: r.fullScreen, t: 'Llamadas a pantalla completa', no: 'No permitidas: la llamada sale solo como aviso' },
      { k: 'battery', ok: r.battery, t: 'Funcionar en segundo plano', no: 'El ahorro de batería puede congelar NEXO y retrasar los avisos' }
    ];
    // Ronda 2772: lo que cada fabricante esconde aparte y Android no deja comprobar (con su pantalla, si se encuentra)
    var VEND = { vivo: 'Vivo: activa «Inicio automático» y «Alto consumo en segundo plano» para NEXO', iqoo: 'iQOO: activa «Inicio automático» y «Alto consumo en segundo plano» para NEXO',
      samsung: 'Samsung: batería de NEXO «Sin restricciones» y que no esté en «Apps en suspensión»', xiaomi: 'Xiaomi: activa «Inicio automático» para NEXO',
      redmi: 'Redmi: activa «Inicio automático» para NEXO', poco: 'Poco: activa «Inicio automático» para NEXO', oppo: 'Oppo: permite el inicio automático de NEXO',
      realme: 'Realme: permite el inicio automático de NEXO', oneplus: 'OnePlus: permite el inicio automático de NEXO', huawei: 'Huawei: en «Inicio de apps», NEXO a mano y todo activado',
      honor: 'Honor: en «Inicio de apps», NEXO a mano y todo activado' };
    var vk = Object.keys(VEND).filter(function(k) { return String(r.vendor || '').indexOf(k) >= 0; })[0];
    if (vk) rows.push({ k: 'vendor', info: true, t: VEND[vk] });
    box.innerHTML = '';
    rows.forEach(function(x) {
      var row = document.createElement('div');
      row.className = 'nx-alert-row';
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);';
      var t = document.createElement('div');
      t.style.cssText = 'font-size:14px;';
      t.textContent = x.info ? '📱 ' + x.t : (x.ok ? '✅ ' : '⚠️ ') + x.t + (x.ok ? '' : ' — ' + x.no);
      row.appendChild(t);
      if (!x.ok) {
        var b = document.createElement('button');
        b.className = 'nx-btn'; b.style.cssText = 'width:auto;margin:0;padding:8px 14px;flex-shrink:0;';
        b.textContent = x.info ? 'Abrir' : 'Arreglar'; b.dataset.what = x.k;
        b.onclick = function() { pl.openAlertSetting({ what: x.k }).catch(function() {}); setTimeout(_renderAlertSettings, 4000); };
        row.appendChild(b);
      }
      box.appendChild(row);
    });
    if (wake) { wake.checked = r.wakeOnMessage !== false; wake.onchange = function() { pl.setWakeOnMessage({ on: wake.checked }).catch(function() {}); }; }
  }).catch(function() { box.textContent = 'No se pudo comprobar.'; });
}
// Al volver de los ajustes del sistema, se vuelve a mirar
document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible' && document.getElementById('nexo-alert-rows')) _renderAlertSettings(); });

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
