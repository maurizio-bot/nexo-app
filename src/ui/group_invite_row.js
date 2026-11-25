/**
 * group_invite_row.js — Invitación a grupo (dueño 24-11): la fila de «Solicitudes para ti» «👥 Nombre del grupo · X te agregó» con
 * Aceptar / Rechazar. Los textos van con textContent (vienen de otros). Sacado de ble_ui.js (tope de 1000 líneas, tests/sim/tamano.js).
 */
import { haptic } from './haptics.js';
import { t } from './i18n.js';

export function groupInviteRow(self, g) {
  var row = document.createElement('div');
  row.className = 'ble-group-invite';
  row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px;border-radius:var(--nx-radius);margin:2px 0;';
  var info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0;';
  var nm = document.createElement('div'); nm.className = 'ble-contact-name'; nm.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  nm.textContent = '👥 ' + (g.name || t('grp_default_name', 'Grupo'));
  var sub = document.createElement('div'); sub.style.cssText = 'font-size:12px;color:var(--nx-muted);margin-top:2px;white-space:normal;';
  var who = (self.groups && typeof self.groups.memberName === 'function' && g.invBy) ? self.groups.memberName(g.invBy) : String(g.invBy || '').toUpperCase();
  sub.textContent = t('grp_inv_sub', '{name} te agregó al grupo ({n} personas)').replace('{name}', who || '?').replace('{n}', String((g.members || []).length));
  info.appendChild(nm); info.appendChild(sub);
  var ok = document.createElement('button'); ok.className = 'grp-inv-accept'; ok.textContent = t('req_btn_accept', 'Aceptar');
  ok.style.cssText = 'flex-shrink:0;padding:7px 12px;border-radius:14px;border:none;background:var(--nx-grad);box-shadow:0 3px 10px rgba(0,200,255,.35);color:#fff;font-weight:600;cursor:pointer;';
  var no = document.createElement('button'); no.className = 'grp-inv-reject'; no.textContent = t('grp_inv_reject', 'Rechazar');
  no.style.cssText = 'flex-shrink:0;padding:7px 10px;border-radius:14px;border:1px solid var(--nx-line);background:var(--nx-surface-2);color:#fff;cursor:pointer;';
  ok.addEventListener('click', function() { ok.disabled = no.disabled = true; self.groups.acceptInvite(g.id); try { haptic('confirm'); } catch (e) {} self.renderRequests(); self.renderContactsList(); });
  no.addEventListener('click', function() { ok.disabled = no.disabled = true; self.groups.rejectInvite(g.id); self.renderRequests(); self.renderContactsList(); });
  var av = document.createElement('div'); av.className = 'ble-contact-avatar'; av.style.cssText = 'width:40px;height:40px;min-width:40px;display:flex;align-items:center;justify-content:center;font-size:18px;'; av.textContent = '👥';
  row.appendChild(av); row.appendChild(info); row.appendChild(ok); row.appendChild(no);
  return row;
}
