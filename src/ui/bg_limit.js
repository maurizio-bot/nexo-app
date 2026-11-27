// 3247 (dueño 18-11, diagnósticos de Katy —Honor, ahorro de batería ACTIVO— y Yael: «Hazlo»): NEXO limitado por el ahorro de
// batería. Android no deja activar ese ajuste por la app; solo se puede pedir. Aquí:
//  (1) este teléfono sabe si está limitado (alertSettings().battery === false) y lo dice en su saludo cifrado (net_link: lm);
//  (2) en el chat de un contacto limitado, una línea: «X tiene NEXO limitado: sus mensajes pueden tardar» (para que quien
//      escribe le pida activarlo, en vez de pensar que la app falla);
//  (3) si a este teléfono limitado le llegan mensajes con > 2 min de retraso al abrir la app, un aviso con el botón para
//      arreglarlo (el momento en que más gente lo acepta). Como mucho uno cada 6 h.
import { t } from './i18n.js';
import { batteryGuard } from './battery_prompt.js';

export var LATE_MS = 120000;      // un mensaje que llega con más de 2 min de retraso cuenta como «tarde»
var BURST_MS = 60000;             // solo cuenta lo que entra en el primer minuto tras volver a la app (lo atrasado)
var NOTE_GAP_MS = 6 * 3600 * 1000;
var NOTE_KEY = 'nexo_late_note_at';
var _visibleAt = Date.now(), _late = 0, _seen = {}, _noteT = null, _chatNx = '';

function _plugin() { try { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE; } catch (e) { return null; } }
function _get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _nid(x) { return String(x || '').toLowerCase(); }

// Puro (probado en bglimit.js): ¿llegó tarde? El msgId lleva la hora de envío del remitente (msg + 13 cifras de ms).
export function lateBy(msgId, now) {
  var m = /^msg(\d{13})/.exec(String(msgId || ''));
  if (!m) return 0;
  var d = (now || Date.now()) - Number(m[1]);
  return d > LATE_MS ? d : 0;
}

// ¿Está limitado este teléfono? Se lee del sistema al arrancar y al volver a la app; si cambia, se saluda a todos (lo sepan ya).
export function bgLimitRefresh() {
  var pl = _plugin();
  if (!pl || typeof pl.alertSettings !== 'function') return Promise.resolve(null);
  return pl.alertSettings().then(function(r) {
    if (!r || typeof r.battery !== 'boolean') return null;
    var lim = r.battery === false, before = window.NEXO_BG_LIMITED;
    window.NEXO_BG_LIMITED = lim;
    if (before !== lim) {
      console.log('[ENERGIA] NEXO limitado por el ahorro de batería: ' + (lim ? 'sí (se avisa a los contactos)' : 'no')); // i18n-ok: registro
      if (before !== undefined) { try { var n = window.bleInterface && window.bleInterface.net; if (n && typeof n._helloAll === 'function') n._helloAll(true); } catch (e) {} }
    }
    return lim;
  }).catch(function() { return null; });
}

export function peerLimited(nx) {
  try { var st = window.bleInterface.net.state; return !!(st && st.peerLim && st.peerLim[_nid(nx)]); } catch (e) { return false; }
}

// (2) Línea en el chat de un contacto limitado
function _paintChatNote() {
  try {
    var mc = document.getElementById('messages-container'); if (!mc || !mc.parentNode) return;
    var el = document.getElementById('nexo-peer-lim');
    var show = !!_chatNx && peerLimited(_chatNx);
    if (!show) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      el = document.createElement('div'); el.id = 'nexo-peer-lim';
      el.style.cssText = 'margin:6px 12px 0;padding:8px 12px;border-radius:12px;background:var(--nx-surface,#1a1b2e);border:1px solid var(--nx-line,#333);color:var(--nx-text,#fff);font-size:12.5px;line-height:1.4;';
      mc.parentNode.insertBefore(el, mc);
    }
    var nameEl = document.getElementById('chat-contact-name');
    var name = (nameEl && nameEl.value) || t('peer_lim_someone', 'Este contacto');
    el.textContent = t('peer_lim_note', '{name} tiene NEXO limitado por el ahorro de batería: sus mensajes pueden tardar. Pídele que lo active en NEXO.').replace('{name}', name);
    el.style.display = '';
  } catch (e) {}
}

// (3) Aviso de «te llegaron mensajes tarde»
function _showLateNote(n) {
  if (document.getElementById('nexo-late-note') || document.getElementById('nexo-bat-overlay')) return;
  var at = parseInt(_get(NOTE_KEY) || '0', 10) || 0;
  if (Date.now() - at < NOTE_GAP_MS) return;
  _set(NOTE_KEY, String(Date.now()));
  console.log('[ENERGIA] ' + n + ' mensaje(s) llegaron con más de 2 min de retraso y NEXO está limitado: se avisa'); // i18n-ok: registro
  var box = document.createElement('div'); box.id = 'nexo-late-note';
  box.className = 'nx-ask-card nx-float-card'; // B-EST (26-11): la tarjeta del aviso común, flotando sobre Contactos
  box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:84px;z-index:2147483640;';
  var p = document.createElement('div'); p.className = 'nx-ask-text';
  p.textContent = (n === 1 ? t('late_note_one', 'Te llegó un mensaje tarde.') : t('late_note_many', 'Te llegaron {n} mensajes tarde.').replace('{n}', n)) + ' ' +
    t('late_note_why', 'El ahorro de batería tiene a NEXO limitado en este teléfono y eso frena tus mensajes.');
  var row = document.createElement('div'); row.className = 'nx-ask-actions';
  var fix = document.createElement('button'); fix.id = 'nexo-late-fix'; fix.textContent = t('late_note_fix', 'Arreglarlo'); fix.className = 'nx-btn nx-btn-primary';
  var no = document.createElement('button'); no.id = 'nexo-late-later'; no.textContent = t('prof_bat_later', 'Ahora no'); no.className = 'nx-btn';
  row.append(no, fix); box.append(p, row); document.body.appendChild(box);
  var close = function() { if (box.parentNode) box.parentNode.removeChild(box); };
  no.onclick = close;
  fix.onclick = function() { close(); batteryGuard({ plugin: _plugin(), force: true, onDone: function() { bgLimitRefresh(); } }); };
}

function _onMsg(e) {
  var d = e && e.detail; if (!d || window.NEXO_BG_LIMITED !== true) return;
  var id = d.messageId; if (!id || _seen[id]) return;
  var now = Date.now();
  if (document.visibilityState === 'visible' && now - _visibleAt > BURST_MS) return; // en vivo, no es lo atrasado
  if (!lateBy(id, now)) return;
  _seen[id] = 1; _late++;
  clearTimeout(_noteT);
  _noteT = setTimeout(function() { if (document.visibilityState !== 'visible' || !_late) return; var n = _late; _late = 0; _showLateNote(n); }, 4000);
}

export function bgLimitInstall() {
  if (window.__nexoBgLimit) return; window.__nexoBgLimit = true;
  window.addEventListener('nexo:ble:messageReceived', _onMsg);
  window.addEventListener('nexo:ble:openChat', function(e) { var d = e && e.detail; var c = d && d.contact; _chatNx = _nid(d && (d.contactId || (c && (c.nexoId || c.deviceUUID || c.id)) || '')); setTimeout(_paintChatNote, 60); });
  window.addEventListener('nexo:peerlimit', function(e) {
    var d = e && e.detail; if (d) console.log('[ENERGIA] ' + d.nx + (d.lim ? ' tiene NEXO limitado por el ahorro de batería' : ' ya no tiene NEXO limitado')); // i18n-ok: registro
    _paintChatNote();
  });
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') { _visibleAt = Date.now(); bgLimitRefresh(); }
  });
  setTimeout(bgLimitRefresh, 1500);
}
if (typeof window !== 'undefined') { window.NEXO_peerLimited = peerLimited; }
