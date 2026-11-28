/**
 * req_cards.js — Solicitudes ARRIBA de la lista de chats (dueño 28-11): en vez del cartel «👋 1 solicitud para ti — toca para ver» que
 * llevaba al panel «Agregar», las solicitudes (y las invitaciones a grupo) salen ahí mismo con Aceptar / Rechazar.
 *  - Brillan 2–3 veces al llegar y al volver a la app (que se noten), luego quedan fijas con borde de color: nada de parpadeo
 *    continuo (cansa, empuja a aceptar sin leer el aviso de impostor y a algunos les marea).
 *  - Aceptar abre el chat; si no te escribió nada, la caja dice «Saluda a {nombre} 👋» (solo el texto de ayuda: no hay que borrar
 *    nada). Si te escribió («te escribió»), se abre con su mensaje. Una invitación a grupo abre el grupo.
 *  - Rechazar la quita y ya. Más de 3: «Ver todas (N)» abre «Solicitudes para ti».
 * La fila (requestRow) es la misma en la lista y en el panel «Agregar» (sacada de ble_ui.js: tope de 1000 líneas).
 */
import { haptic } from './haptics.js';
import { t } from './i18n.js';
import { personAvatar } from './person_avatar.js';

var SHOWN_MAX = 3;
var GLOW_MS = 2700;      // 3 brillos de 0,9 s
var _seen = {};          // id → cuándo empezó a brillar en esta vuelta a la app
var _visHooked = false;

function _hookVisibility() {
  if (_visHooked || typeof document === 'undefined') return;
  _visHooked = true;
  try { document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') _seen = {}; }); } catch (e) {}
}

function _css() {
  if (typeof document === 'undefined' || document.getElementById('nx-req-css')) return;
  var st = document.createElement('style');
  st.id = 'nx-req-css';
  st.textContent = '@keyframes nxReqGlow{0%,100%{box-shadow:0 0 0 0 rgba(0,200,255,0)}50%{box-shadow:0 0 0 3px rgba(0,200,255,.55),0 0 18px rgba(168,85,247,.55)}}' +
    '.nx-req-glow{animation:nxReqGlow .9s ease-in-out 3}' +
    '@media (prefers-reduced-motion: reduce){.nx-req-glow{animation:none}}';
  (document.head || document.documentElement).appendChild(st);
}

/** Al aceptar: cerrar el panel si estaba abierto y abrir el chat; «Saluda a…» como ayuda en la caja de escribir. */
export function openAfterAccept(self, id, name, greet) {
  try { if (self.elements && self.elements.panel && self.elements.panel.classList.contains('active')) self.togglePanel(); } catch (e) {}
  if (typeof self.openChat !== 'function') return;
  Promise.resolve(self.openChat(id)).then(function() { if (greet) greetHint(id, name); }).catch(function() {});
}

/** La caja de escribir dice «Saluda a {nombre} 👋» hasta que escribes algo o sales de ese chat. */
export function greetHint(id, name) {
  if (typeof document === 'undefined') return;
  var inp = document.getElementById('message-input');
  if (!inp) return;
  var orig = t('ph_mensaje', 'Mensaje...');
  inp.placeholder = t('req_greet_ph', 'Saluda a {name} 👋').replace('{name}', function() { return name || String(id || '').toUpperCase(); });
  var me = String(id || '').toLowerCase(), timer = null;
  function restore() {
    try { inp.placeholder = orig; inp.removeEventListener('input', restore); } catch (e) {}
    if (timer) clearInterval(timer);
  }
  inp.addEventListener('input', restore);
  timer = setInterval(function() {
    var ac = window.NEXO && window.NEXO.app && window.NEXO.app.activeContact;
    var cur = ac ? String(ac.nexoId || ac.id || '').toLowerCase() : '';
    var app = document.getElementById('app');
    if (cur !== me || (app && app.classList.contains('hidden'))) restore();
  }, 1000);
}

/** Una solicitud de contacto: foto, nombre, NEXO ID, aviso de impostor, datos enmascarados, Aceptar / Eliminar. */
export function requestRow(self, req) {
  var row = document.createElement('div');
  row.className = 'ble-req-row';
  row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px;border-radius:var(--nx-radius);margin:2px 0;';
  var info = document.createElement('div'); info.style.cssText = 'flex:1;min-width:0;';
  var nm = document.createElement('div'); nm.className = 'ble-contact-name'; nm.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  nm.textContent = req.name || String(req.id || '').toUpperCase();
  var sub = document.createElement('div'); sub.style.cssText = 'font-size:12px;color:var(--nx-muted);margin-top:2px;';
  sub.textContent = String(req.id || '').toUpperCase() + ' · ' + (req.acc ? t('req_sub_acc', 'aceptó tu solicitud — confírmala') : req.inv ? t('req_from_invite', 'aceptó tu invitación') : t('req_sub_in', 'quiere agregarte'));
  info.appendChild(nm); info.appendChild(sub);
  // 3135 (anti-suplantación, dueño 15-11): ya tengo a alguien con este nombre → es OTRO teléfono (o un impostor)
  var twin = (typeof self._twinByName === 'function' && !req.acc) ? self._twinByName(req.name, req.id) : null;
  if (twin) {
    var tw = document.createElement('div'); tw.className = 'ble-req-twin'; tw.style.cssText = 'font-size:12px;color:#ff8a80;margin-top:3px;white-space:normal;';
    tw.textContent = t('req_same_name', '⚠️ Ya tienes a «{name}» con otro NEXO ID ({id}). Es otro teléfono: puede ser un impostor. Confírmalo con una llamada antes de aceptar.').replace('{name}', twin.name || '').replace('{id}', String(twin.nexoId || '').toUpperCase());
    info.appendChild(tw);
  }
  // #dueño 04-11 (perfil 2b): tel/correo ENMASCARADOS (reconocer sin regalar el dato); lo completo llega al aceptar (E2E)
  if (req.ph || req.em) {
    var det = document.createElement('div'); det.style.cssText = 'font-size:11px;color:var(--nx-muted);margin-top:3px;';
    var bits = [];
    if (req.ph) bits.push('📱 ' + req.ph);
    if (req.em) bits.push('✉️ ' + req.em);
    det.textContent = bits.join('   ·   ');
    info.appendChild(det);
  }
  var ok = document.createElement('button'); ok.className = 'ble-req-accept'; ok.textContent = req.acc ? t('req_btn_confirm', 'Confirmar') : t('req_btn_accept', 'Aceptar');
  ok.style.cssText = 'flex-shrink:0;padding:7px 12px;border-radius:14px;border:none;background:var(--nx-grad);box-shadow:0 3px 10px rgba(0,200,255,.35);color:#fff;font-weight:600;cursor:pointer;';
  var no = document.createElement('button'); no.className = 'ble-req-reject'; no.textContent = t('req_btn_delete', 'Eliminar');
  no.style.cssText = 'flex-shrink:0;padding:7px 10px;border-radius:14px;border:1px solid var(--nx-line);background:var(--nx-surface-2);color:#fff;cursor:pointer;';
  ok.addEventListener('click', function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    ok.disabled = no.disabled = true;
    self.acceptRequest(req.id).then(function() {
      haptic('confirm'); self.renderRequests(); self.renderContactsList();
      openAfterAccept(self, String(req.id || '').toLowerCase(), req.name || '', !req.msg); // «te escribió»: se abre con su mensaje
    }).catch(function() { ok.disabled = no.disabled = false; });
  });
  no.addEventListener('click', function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    self.rejectRequest(req.id); self.renderRequests(); self.renderContactsList();
  });
  row.appendChild(personAvatar(req.id, req.name || String(req.id || '')));
  row.appendChild(info); row.appendChild(ok); row.appendChild(no);
  return row;
}

/** Arriba de la lista de chats: las solicitudes e invitaciones con sus botones (id ble-req-banner, como el cartel de antes). */
export function prependReqCards(self, list, invRow) {
  if (!list) return;
  var reqs = (typeof self.pendingRequests === 'function' && self.pendingRequests()) || [];
  var invs = (self.groups && typeof self.groups.invitations === 'function') ? self.groups.invitations() : [];
  var n = reqs.length + invs.length;
  if (!n) return;
  _css(); _hookVisibility();
  var box = document.createElement('div');
  box.id = 'ble-req-banner';
  box.style.cssText = 'margin:8px 12px 10px;padding:6px 6px 4px;border-radius:16px;border:1.5px solid rgba(0,200,255,.55);background:linear-gradient(135deg,rgba(0,200,255,.10),rgba(168,85,247,.12));';
  var head = document.createElement('div');
  head.style.cssText = 'padding:6px 8px 2px;font-size:13px;font-weight:700;color:#fff;display:flex;align-items:center;gap:7px;';
  head.textContent = '👋 ' + n + ' ' + (n === 1 ? t('req_banner_one', 'solicitud para ti') : t('req_banner_many', 'solicitudes para ti'));
  box.appendChild(head);
  var items = invs.map(function(g) { return { k: 'g:' + g.id, el: function() { return invRow(g); } }; })
    .concat(reqs.map(function(r) { return { k: 'r:' + r.id + (r.acc ? ':a' : ''), el: function() { return requestRow(self, r); } }; }));
  // La lista se redibuja a menudo (mensajes, conexiones): el brillo sigue donde iba (retraso negativo) y no vuelve a empezar.
  var now = Date.now(), glowAt = 0;
  items.slice(0, SHOWN_MAX).forEach(function(it) {
    box.appendChild(it.el());
    if (!_seen[it.k]) _seen[it.k] = now;
    if (now - _seen[it.k] < GLOW_MS) glowAt = Math.max(glowAt, _seen[it.k]);
  });
  if (n > SHOWN_MAX) {
    var more = document.createElement('button');
    more.className = 'ble-req-more';
    more.style.cssText = 'display:block;width:100%;padding:8px;border:none;background:none;color:#7fdcff;font-size:13px;font-weight:600;cursor:pointer;';
    more.textContent = t('req_see_all', 'Ver todas ({n})').replace('{n}', String(n));
    more.addEventListener('click', function() { try { self.openRequests(); } catch (e) {} });
    box.appendChild(more);
  }
  if (glowAt) { box.className = 'nx-req-glow'; box.style.animationDelay = '-' + (now - glowAt) + 'ms'; }
  if (list.firstChild) list.insertBefore(box, list.firstChild);
  else list.appendChild(box);
}
