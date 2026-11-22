/**
 * NEXO — «Tu teléfono silencia a NEXO» (COLA 22, dueño 22-11). Lo que el USUARIO dejó apagado en el teléfono y hace que no se entere:
 *  (1) un CANAL de avisos de NEXO apagado o sin sonido (mensajes o llamadas): «no te vas a enterar de los mensajes», con el botón que
 *      abre ESE canal (silencedOpen → ajustes del canal; el interruptor general de avisos ya lo cubre notif_banner.js);
 *  (2) «No molestar»: se explica UNA vez cada 14 días y solo si lleva activo un buen rato (no por un rato de cine o de reunión).
 * Una tarjeta fija en Contactos (como phone_sleep.js), nunca dos a la vez, y ninguna si ya hay el banner de avisos o la tarjeta de
 * «tu teléfono cerró NEXO». Los canales: como mucho una vez al día, «Ahora no» y «No volver a mostrar» por causa. Desaparece sola al
 * arreglarlo (se recomprueba al volver a la app). La decisión de qué está mal la toma el nativo (SilencedPolicy.kt).
 * Perillas de prueba: window.NEXO_SILENCED_NOW (reloj), NEXO_SILENCED_DELAY_MS (espera inicial), NEXO_SILENCED_DND_MS (cuánto debe llevar el DND).
 */
import { t } from './i18n.js';

var DAY_MS = 24 * 3600 * 1000, DND_GAP_MS = 14 * DAY_MS, DND_SINCE_MS = 30 * 60 * 1000, DELAY_MS = 9000;

function _plugin() { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; } catch (e) { return null; } }
function _get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _del(k) { try { localStorage.removeItem(k); } catch (e) {} }
function _now() { return (typeof window !== 'undefined' && typeof window.NEXO_SILENCED_NOW === 'function') ? window.NEXO_SILENCED_NOW() : Date.now(); }
function _num(k) { return parseInt(_get(k) || '0', 10) || 0; }
function _remove() { var c = document.getElementById('nexo-silenced-card'); if (c && c.parentNode) c.parentNode.removeChild(c); }

/** Puro (probado en silenciado.js): de la respuesta de silencedState, qué explicar: { cause: 'ch'|'dnd'|null, text, tip, btn, what }. */
export function plan(r) {
  var iss = (r && Array.isArray(r.issues)) ? r.issues : [];
  var m = r && r.messages, c = r && r.calls;
  if (m === 'off' || m === 'quiet' || c === 'off' || c === 'quiet') {
    var off = (m === 'off' ? 1 : 0) + (c === 'off' ? 2 : 0), quiet = (m === 'quiet' ? 1 : 0) + (c === 'quiet' ? 2 : 0), text;
    if (off === 3) text = t('silenced_both_off', 'Tu teléfono tiene apagados los avisos de mensajes y de llamadas de NEXO: no te vas a enterar de nada.');
    else if (off === 1) text = t('silenced_msg_off', 'Tu teléfono tiene apagados los avisos de mensajes de NEXO: no te vas a enterar de los mensajes.');
    else if (off === 2) text = t('silenced_call_off', 'Tu teléfono tiene apagados los avisos de llamadas de NEXO: no te vas a enterar de las llamadas.');
    else if (quiet === 3) text = t('silenced_both_quiet', 'Los avisos de mensajes y de llamadas de NEXO están sin sonido en tu teléfono: pueden pasarte sin que los notes.');
    else if (quiet === 1) text = t('silenced_msg_quiet', 'Los avisos de mensajes de NEXO están sin sonido en tu teléfono: pueden pasarte sin que los notes.');
    else text = t('silenced_call_quiet', 'Los avisos de llamadas de NEXO están sin ventana o sin sonido en tu teléfono: una llamada puede pasarte sin que la notes.');
    var msgIssue = (m === 'off' || m === 'quiet');
    return { cause: 'ch', text: text, tip: t('silenced_ch_tip', 'Abre el ajuste, activa el aviso y déjalo con sonido y en importancia «Alta» o «Urgente».'), btn: t('silenced_btn_open', 'Abrir el ajuste'), what: msgIssue ? 'messages' : 'calls' };
  }
  if (iss.indexOf('dnd_total') >= 0) return { cause: 'dnd', text: t('silenced_dnd_total', 'Tienes «No molestar» en silencio total: no sonará ningún mensaje ni llamada de NEXO.'), tip: t('silenced_dnd_tip', 'Si quieres enterarte, apágalo o permite a NEXO en sus excepciones.'), btn: t('silenced_btn_dnd', 'Ver «No molestar»'), what: 'dnd' };
  if (iss.indexOf('dnd_priority') >= 0) return { cause: 'dnd', text: t('silenced_dnd_priority', 'Tienes «No molestar» activado: los avisos de NEXO pueden no sonar.'), tip: t('silenced_dnd_tip', 'Si quieres enterarte, apágalo o permite a NEXO en sus excepciones.'), btn: t('silenced_btn_dnd', 'Ver «No molestar»'), what: 'dnd' };
  return { cause: null };
}

function _card(p, pl) {
  var host = document.getElementById('contacts-view');
  if (!host || document.getElementById('nexo-silenced-card')) return false;
  var c = document.createElement('div'); c.id = 'nexo-silenced-card'; c.setAttribute('data-cause', p.cause);
  c.style.cssText = 'margin:8px 12px 4px;padding:14px;background:var(--nx-surface,#1a1b2e);border:1px solid var(--nx-line,#333);border-radius:var(--nx-radius,16px);color:var(--nx-text,#fff);font-size:13px;line-height:1.45;';
  var b = document.createElement('div'); b.className = 'nx-sil-body'; b.style.fontWeight = '700'; b.textContent = p.text;
  var q = document.createElement('div'); q.className = 'nx-sil-tip'; q.style.cssText = 'margin-top:6px;color:var(--nx-muted,#aaa);'; q.textContent = p.tip;
  var row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;';
  var go = document.createElement('button'); go.id = 'nexo-silenced-go'; go.textContent = p.btn;
  go.style.cssText = 'padding:10px 14px;border:none;border-radius:12px;background:var(--nx-grad,#3b82f6);color:#fff;font-weight:700;';
  go.onclick = function() {
    try { Promise.resolve(pl.silencedOpen({ what: p.what })).catch(function() {}); } catch (e) {}
    [1500, 4000].forEach(function(ms) { setTimeout(silencedCheck, ms); }); // al volver del ajuste, si ya quedó, la tarjeta se va
  };
  var later = document.createElement('button'); later.id = 'nexo-silenced-later'; later.textContent = t('sleep_btn_later', 'Ahora no');
  var never = document.createElement('button'); never.id = 'nexo-silenced-never'; never.textContent = t('sleep_btn_never', 'No volver a mostrar');
  row.appendChild(go);
  [later, never].forEach(function(x) { x.style.cssText = 'padding:10px 12px;border:none;border-radius:12px;background:transparent;color:var(--nx-muted,#aaa);'; row.appendChild(x); });
  later.onclick = _remove;
  never.onclick = function() { _set('nexo_silenced_off_' + p.cause, '1'); _remove(); };
  c.append(b, q, row); host.insertBefore(c, host.firstChild);
  return true;
}

/** Mira el estado y, si toca, muestra UNA tarjeta. Devuelve la causa mostrada ('ch' | 'dnd') o null. */
export function silencedCheck() {
  var pl = _plugin();
  if (!pl || typeof pl.silencedState !== 'function') return Promise.resolve(null);
  return Promise.resolve(pl.silencedState()).then(function(r) {
    var p = plan(r), now = _now(), mine = document.getElementById('nexo-silenced-card');
    // «No molestar»: se anota desde cuándo está activo; si se apaga, se olvida
    if (r && r.dnd === true) { if (!_num('nexo_silenced_dnd_since')) _set('nexo_silenced_dnd_since', String(now)); } else _del('nexo_silenced_dnd_since');
    if (!p.cause) { _remove(); return null; }
    if (mine) { if (mine.getAttribute('data-cause') !== p.cause) _remove(); else return null; } // arreglado lo uno o cambió la causa
    if (document.getElementById('nexo-notif-banner') || document.getElementById('nexo-sleep-card')) return null; // ya hay otro aviso: una cosa a la vez
    if (_get('nexo_silenced_off_' + p.cause) === '1') return null;
    var gap = p.cause === 'dnd' ? DND_GAP_MS : DAY_MS;
    if (now - _num('nexo_silenced_at_' + p.cause) < gap && _num('nexo_silenced_at_' + p.cause) > 0) return null;
    if (p.cause === 'dnd') {
      var need = (typeof window.NEXO_SILENCED_DND_MS === 'number') ? window.NEXO_SILENCED_DND_MS : DND_SINCE_MS;
      if (now - _num('nexo_silenced_dnd_since') < need) return null; // lleva poco: puede ser un rato de reunión
    }
    if (_card(p, pl)) { _set('nexo_silenced_at_' + p.cause, String(now)); return p.cause; }
    return null;
  }).catch(function() { return null; });
}

export function silencedInstall() {
  if (typeof window === 'undefined' || window.__nexoSilenced) return;
  window.__nexoSilenced = { check: silencedCheck, plan: plan };
  var d = (typeof window.NEXO_SILENCED_DELAY_MS === 'number') ? window.NEXO_SILENCED_DELAY_MS : DELAY_MS;
  setTimeout(function() { silencedCheck(); }, d);
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') silencedCheck(); });
}
