/**
 * call_join_ui.js — lo que se VE de «Unir» (3216) y del puente (3217), aparte de calls_ui.js (que pasaba de las 1.000 líneas):
 *  - callToast: aviso corto POR ENCIMA de la pantalla de la llamada. 3217: el de siempre (ui_bits._showInfoToast, #perm-error-toast)
 *    NO se ve en ninguna parte: critical.css («FIX #2: Ocultar REM / toasts / logs / debug», desde el 10-09) esconde todo lo que lleve
 *    «toast» en el id o la clase. Este usa su propio elemento (#nexo-call-aviso: sin «toast», «log», «rem-» ni «debug»);
 *  - callShownName: «A y B» (en el teléfono que une, los dos de sus llamadas; en el de A o B, el que les une y quién más está);
 *  - confNotice: en el de A o B, «B se unió a la llamada» / «B salió de la llamada» cuando cambia quién más está ('conf');
 *  - secondAvatar: el segundo participante, pequeño, junto al primero;
 *  - mergeKey: lo que se puede unir ahora (para rehacer los botones solo si cambia).
 */
import { t } from './i18n.js';
import { _normId } from './chat_format.js';
import { _getGradientForUUID, _getInitials } from './ble_helpers.js';
import { paintAvatar } from './avatar.js';
import { vaultFindContactByNexoId } from '../vault/vault_manager.js';
import { mergeCheck } from './call_merge.js';
import { bridgeOf } from './call_bridge.js';

function _bi() { return window.bleInterface || (window.NEXO && window.NEXO.app && window.NEXO.app.bleInterface) || null; }
export function contactName(nx) { var c = vaultFindContactByNexoId(nx); return (c && (c.name || c.displayName)) || String(nx || '').toUpperCase(); }

export function callToast(text, ms) {
  var old = document.getElementById('nexo-call-aviso'); if (old) old.remove();
  var el = document.createElement('div');
  el.id = 'nexo-call-aviso'; el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;top:calc(12px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:2147483646;max-width:90vw;box-sizing:border-box;' +
    'padding:12px 20px;border-radius:16px;background:var(--nx-sheet,#141826);border:1px solid var(--nx-line,rgba(255,255,255,.14));color:var(--nx-text,#fff);' +
    'font-size:13px;font-weight:600;line-height:1.35;text-align:center;box-shadow:0 10px 34px rgba(0,0,0,.5);pointer-events:none;';
  el.textContent = text;
  (document.body || document.documentElement).appendChild(el);
  setTimeout(function() { if (el.parentNode) el.remove(); }, ms || 4000);
}

export function mergeKey() { var b = _bi(), m = mergeCheck(b, contactName); return (m ? (m.ok ? m.kind : 'n') : '') + (bridgeOf(b) ? '|b' : ''); }

function _both(a, b) { return t('call_bridge_names', '{a} y {b}').replace('{a}', a).replace('{b}', b); }
function _confName(w) { var c = vaultFindContactByNexoId(w.nx); return (c && (c.name || c.displayName)) || w.n || String(w.nx || '').toUpperCase(); }
// En el teléfono que une: el otro participante del puente (el de mi otra llamada)
export function bridgeOther(st) { var br = st && st.state === 'active' ? bridgeOf(_bi()) : null; return br ? br.peers().filter(function(x) { return x !== _normId(st.nx); })[0] || '' : ''; }
export function callShownName(st) {
  var name = contactName(st.nx), o = bridgeOther(st);
  if (o) return _both(name, contactName(o));
  if (st.state === 'active' && st.conf && st.conf.length) return _both(name, st.conf.map(_confName).join(', '));
  return name;
}
var _confSeen = {};
export function confNotice(st) {
  if (!st || !st.id || st.state !== 'active') return;
  var prev = _confSeen[st.id] || [], now = (st.conf || []).slice();
  now.forEach(function(w) { if (!prev.some(function(p) { return p.nx === w.nx; })) callToast(t('grp_joined', '{name} se unió a la llamada').replace('{name}', _confName(w)), 3000); });
  prev.forEach(function(p) { if (!now.some(function(w) { return w.nx === p.nx; })) callToast(t('call_bridge_left', '{name} salió de la llamada').replace('{name}', _confName(p)), 3000); });
  _confSeen[st.id] = now; var ks = Object.keys(_confSeen); if (ks.length > 4) delete _confSeen[ks[0]];
}
// El segundo participante (puente) junto al avatar del primero (wrap: .nc-av-wrap); sin nx, se quita
export function secondAvatar(wrap, nx) {
  var a2 = wrap && wrap.querySelector('.nc-av2');
  if (!nx) { if (a2) a2.remove(); return; }
  if (!wrap) return;
  if (!a2) { a2 = document.createElement('div'); wrap.appendChild(a2); }
  a2.className = 'nc-av2 ble-contact-avatar nx-person-av ' + _getGradientForUUID(String(nx));
  a2.style.backgroundImage = ''; a2.textContent = _getInitials(contactName(nx)); paintAvatar(a2, nx);
}
