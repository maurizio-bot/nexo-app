/**
 * move_account.js v1.0 (ronda 2759, plan del dueño punto 15, opción A) — Pasar la cuenta a un teléfono nuevo.
 * Con los dos teléfonos en el mismo Wi-Fi (o uno haciendo de punto de acceso del otro):
 *  1. Teléfono NUEVO: Perfil → "Traer mi cuenta de otro teléfono": abre un puerto y muestra un QR con su IP, el puerto
 *     y una clave de un solo uso (NEXO-MOVE1|ip|puerto|id|token|clave).
 *  2. Teléfono VIEJO: Perfil → "Pasar mi cuenta a un teléfono nuevo" → lee el QR. La parte nativa (AccountMove.kt)
 *     empaqueta todo lo de NEXO (NEXO ID, identidad y claves, contactos, historial, fotos, grupos, Fénix, archivos
 *     grandes), lo cifra con esa clave y lo manda.
 *  3. El nuevo lo guarda (con su propio cifrado en reposo) y SOLO entonces confirma; los dos se reinician: el nuevo
 *     ya con la cuenta, el viejo vacío (como recién instalado). Para los contactos no cambia nada (mismas claves).
 */
import { qrSvg, openQrScanner } from './qr_verify.js';
import { vaultFlushAll } from '../vault/vault_manager.js';
import { t } from './i18n.js';

function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

var _listening = false, _screen = null;
function _listen() {
  var pl = _plugin();
  if (_listening || !pl || typeof pl.addListener !== 'function') return;
  _listening = true;
  pl.addListener('onMoveProgress', function(ev) {
    if (!_screen || !ev) return;
    var pct = ev.total ? Math.floor(ev.bytes * 100 / ev.total) : 0;
    _screen.status((ev.dir === 'in' ? t('prof_move_receiving', 'Recibiendo tu cuenta…') + ' ' : t('prof_move_sending', 'Pasando tu cuenta…') + ' ') + pct + ' % (' + _kb(ev.bytes) + ')');
  });
  pl.addListener('onMoveDone', function(ev) {
    if (!ev) return;
    console.log('[MOVE] ' + (ev.dir === 'in' ? 'Recibir' : 'Pasar') + ': ' + (ev.ok ? 'hecho (' + ev.files + ' archivos, ' + _kb(ev.bytes || 0) + ')' : 'fallo: ' + ev.error));
    if (!_screen) _screen = _overlay();
    if (ev.ok) {
      _screen.status(ev.dir === 'in' ? t('prof_move_received', '✅ Cuenta recibida. NEXO se reinicia con tu cuenta…')
        : t('prof_move_sent', '✅ Tu cuenta ya está en el teléfono nuevo. Este teléfono queda vacío y NEXO se reinicia.'));
      _screen.done();
    } else {
      _screen.status(t('prof_move_fail_pre', 'No se pudo ') + (ev.dir === 'in' ? t('prof_move_verb_recv', 'recibir') : t('prof_move_verb_send', 'pasar')) + t('prof_move_fail_mid', ' la cuenta: ') + (ev.error || t('prof_error', 'error')) + (ev.dir === 'out' ? t('prof_move_nothing_erased', '\nEn este teléfono no se borró nada.') : ''));
      _screen.closable();
    }
  });
}

function _overlay() {
  var old = document.getElementById('nexo-move-screen');
  if (old) old.remove();
  var o = document.createElement('div');
  o.id = 'nexo-move-screen';
  o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0a0a15;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;box-sizing:border-box;text-align:center;font-size:15px;';
  var qr = document.createElement('div'); qr.className = 'move-qr';
  var st = document.createElement('div'); st.className = 'move-status'; st.style.cssText = 'max-width:360px;white-space:pre-line;';
  var btn = document.createElement('button'); btn.className = 'move-close'; btn.textContent = t('cancel');
  btn.style.cssText = 'padding:10px 18px;border-radius:10px;border:none;font-size:14px;color:#fff;background:rgba(255,255,255,0.18);';
  btn.onclick = function() { o.remove(); _screen = null; };
  o.appendChild(qr); o.appendChild(st); o.appendChild(btn);
  document.body.appendChild(o);
  return {
    el: o,
    qr: function(text) {
      qr.style.cssText = 'background:#fff;padding:10px;border-radius:12px;width:min(78vw,320px);height:min(78vw,320px);';
      qr.dataset.payload = text;
      qr.innerHTML = qrSvg(text);
      var svg = qr.querySelector('svg'); if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; }
    },
    status: function(t) { st.textContent = t; },
    done: function() { qr.innerHTML = ''; qr.style.cssText = ''; btn.style.display = 'none'; },
    closable: function() { btn.textContent = t('close'); btn.style.display = ''; }
  };
}

// Teléfono NUEVO
export function startReceiveAccount() {
  var pl = _plugin();
  _listen();
  _screen = _overlay();
  if (!pl || typeof pl.moveReceive !== 'function') { _screen.status(t('prof_move_cant_receive', 'Esta versión no puede recibir una cuenta.')); _screen.closable(); return Promise.resolve(null); }
  _screen.status(t('prof_move_preparing', 'Preparando…'));
  return pl.moveReceive().then(function(r) {
    var text = ['NEXO-MOVE1', r.ip, r.port, r.id, r.token, r.key].join('|');
    _screen.qr(text);
    _screen.status(t('prof_move_recv_instr', 'En tu teléfono ANTERIOR: Perfil → "Pasar mi cuenta a un teléfono nuevo" y apunta la cámara a este código.\nLos dos en el mismo Wi-Fi. Todo lo que había en este teléfono se sustituye por tu cuenta.'));
    return text;
  }).catch(function(e) {
    _screen.status((e && e.message) || t('prof_move_prepare_fail', 'No se pudo preparar'));
    _screen.closable();
    return null;
  });
}

// Teléfono VIEJO: con el texto del QR (lo lee la cámara; las pruebas lo pasan directo)
export function sendAccountTo(qrText) {
  var pl = _plugin();
  var p = String(qrText || '').split('|');
  _listen();
  if (p[0] !== 'NEXO-MOVE1' || p.length !== 6) { _screen = _overlay(); _screen.status(t('prof_move_wrong_qr', 'Ese código no es de "Traer mi cuenta".')); _screen.closable(); return Promise.resolve(false); }
  _screen = _overlay();
  _screen.status(t('prof_move_saving', 'Guardando lo pendiente…'));
  return vaultFlushAll().catch(function() {}).then(function() {
    _screen.status(t('prof_move_sending', 'Pasando tu cuenta…'));
    return pl.moveSend({ ip: p[1], port: Number(p[2]), id: p[3], token: p[4], key: p[5] });
  }).then(function() { return true; }, function() { return false; });
}

export function startSendAccount() {
  if (!window.confirm(t('prof_move_send_confirm', 'Pasar tu cuenta a un teléfono nuevo: todo (NEXO ID, contactos, chats, fotos, grupos) pasa al otro teléfono y ESTE se queda vacío. Los dos deben estar en el mismo Wi-Fi. ¿Seguir?'))) return;
  openQrScanner(function(text) { sendAccountTo(text); }, t('prof_move_scan_caption', 'Apunta al código de "Traer mi cuenta" del teléfono nuevo'));
}

// Para las pruebas del simulador
if (typeof window !== 'undefined') { window.NEXO_moveReceive = startReceiveAccount; window.NEXO_moveSendTo = sendAccountTo; }
