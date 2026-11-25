/**
 * NEXO — «Tu teléfono duerme a NEXO» (COLA 22, dueño 22-11; diagnóstico de Roberto, Motorola: 3 «Foreground kill» en 7 días y 4 h sin
 * recibir). Lo que NO arregla el código —el sistema del teléfono cierra o frena a NEXO— se le EXPLICA al usuario con lo que debe hacer:
 *  (1) CIERRES POR EL SISTEMA: con los motivos de cierre que ya entrega el nativo (getExitReasons, ver diag_exits.js), si en las
 *      últimas 24 h el sistema cerró NEXO («Foreground kill», terminada por el sistema, congelada por el sistema, uso excesivo), una
 *      tarjeta dice cuántas veces y por qué, y qué ajustar: el ahorro de batería (botón que lo abre), el inicio automático del
 *      fabricante (botón) o la ficha de la app (Motorola y demás). Los fallos propios de la app y la falta de memoria NO entran aquí.
 *  (2) QUITADA DE RECIENTES: si el motivo fue «cerrada por el usuario / detenida» (deslizar en recientes o «Forzar detención»), una
 *      tarjeta avisa de que así NEXO deja de recibir hasta que se abra otra vez.
 * Una tarjeta fija en Contactos (no un aviso que desaparece), una sola a la vez, como mucho una vez al día por causa, con «Ahora no»
 * y «No volver a mostrar». Los avisos desactivados ya los cubre notif_banner.js; el ahorro de batería al instalar, battery_prompt.js.
 * Perillas de prueba: window.NEXO_EXITS_NOW (reloj, el mismo de diag_exits), window.NEXO_SLEEP_DELAY_MS (espera inicial).
 */
import { t } from './i18n.js';
import { exitsInit } from './diag_exits.js';

var DAY_MS = 24 * 3600 * 1000, DELAY_MS = 8000;
var VENDORS = ['vivo', 'iqoo', 'samsung', 'xiaomi', 'redmi', 'poco', 'oppo', 'realme', 'oneplus', 'huawei', 'honor'];
var R_SYSTEM = { 2: 1, 9: 1, 13: 1, 14: 1 }, R_USER = { 10: 1, 11: 1 };

function _plugin() { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; } catch (e) { return null; } }
function _get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _now() { return (typeof window !== 'undefined' && typeof window.NEXO_EXITS_NOW === 'function') ? window.NEXO_EXITS_NOW() : Date.now(); }
function _isolated(e) { return /isolated/i.test(String((e && e.desc) || '')); }
function _fgKill(e) { return /foreground kill|bg restricted|background restrict/i.test(String((e && e.desc) || '')); }

/** Puro (probado en phonesleep.js): de la respuesta de getExitReasons saca los cierres de las últimas 24 h por causa. */
export function analyze(res, now) {
  var out = { kills: [], recents: [] };
  if (!res || !Array.isArray(res.exits)) return out;
  res.exits.forEach(function(e) {
    if (!e || _isolated(e) || !(now - e.t >= 0 && now - e.t <= DAY_MS)) return;
    if (_fgKill(e) || R_SYSTEM[e.reason]) out.kills.push(e);
    else if (R_USER[e.reason]) out.recents.push(e);
  });
  return out;
}

function _motive(kills) {
  if (kills.filter(_fgKill)[0]) return t('sleep_why_fgkill', 'Android la cerró para ahorrar recursos («Foreground kill»)');
  var r = kills[0] && kills[0].reason;
  if (r === 14) return t('sleep_why_frozen', 'el sistema la congeló');
  if (r === 9) return t('sleep_why_resources', 'uso excesivo de recursos');
  return t('sleep_why_system', 'el sistema la terminó');
}

function _remove() { var c = document.getElementById('nexo-sleep-card'); if (c && c.parentNode) c.parentNode.removeChild(c); }

// Qué decirle y qué abrir según el teléfono: ahorro de batería activo > ajustes del fabricante conocidos > ficha de la app
function _advice(settings) {
  var s = settings || {}, vend = String(s.vendor || '');
  if (s.battery === false) return { text: t('sleep_fix_battery', 'El ahorro de batería tiene limitado a NEXO. Quítaselo: Ajustes → Batería (o Apps → NEXO → Batería) → NEXO «Sin restricciones».'), btn: t('sleep_btn_battery', 'Quitar ahorro'), what: 'battery' };
  if (VENDORS.some(function(v) { return vend.indexOf(v) >= 0; })) return { text: t('sleep_fix_vendor', 'Tu teléfono tiene un gestor propio que cierra apps en segundo plano. Abre sus ajustes y permite a NEXO el inicio automático y el segundo plano.'), btn: t('sleep_btn_open', 'Abrir ajustes'), what: 'vendor' };
  return { text: t('sleep_fix_other', 'Ajustes → Apps → NEXO → Batería → «Sin restricciones» (o «No optimizar»). Si tu teléfono tiene un modo de ahorro propio, déjalo apagado para NEXO.'), btn: t('sleep_btn_open', 'Abrir ajustes'), what: 'app' };
}

function _card(cause, body, tip, btn, onBtn) {
  var host = document.getElementById('contacts-view');
  if (!host || document.getElementById('nexo-sleep-card')) return false;
  var c = document.createElement('div'); c.id = 'nexo-sleep-card'; c.setAttribute('data-cause', cause);
  c.style.cssText = 'margin:8px 12px 4px;padding:14px;background:var(--nx-surface,#1a1b2e);border:1px solid var(--nx-line,#333);border-radius:var(--nx-radius,16px);color:var(--nx-text,#fff);font-size:13px;line-height:1.45;';
  var p = document.createElement('div'); p.className = 'nx-sleep-body'; p.style.fontWeight = '700'; p.textContent = body;
  var q = document.createElement('div'); q.className = 'nx-sleep-tip'; q.style.cssText = 'margin-top:6px;color:var(--nx-muted,#aaa);'; q.textContent = tip;
  var row = document.createElement('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;';
  if (btn) {
    var go = document.createElement('button'); go.id = 'nexo-sleep-go'; go.textContent = btn;
    go.style.cssText = 'padding:10px 14px;border:none;border-radius:12px;background:var(--nx-grad,#3b82f6);color:#fff;font-weight:700;';
    go.onclick = function() { try { onBtn(); } catch (e) {} };
    row.appendChild(go);
  }
  var later = document.createElement('button'); later.id = 'nexo-sleep-later'; later.textContent = btn ? t('sleep_btn_later', 'Ahora no') : t('sleep_btn_ok', 'Entendido');
  var never = document.createElement('button'); never.id = 'nexo-sleep-never'; never.textContent = t('sleep_btn_never', 'No volver a mostrar');
  [later, never].forEach(function(b) { b.style.cssText = 'padding:10px 12px;border:none;border-radius:12px;background:transparent;color:var(--nx-muted,#aaa);'; row.appendChild(b); });
  later.onclick = _remove;
  never.onclick = function() { _set('nexo_sleep_off_' + cause, '1'); _remove(); };
  c.append(p, q, row); host.insertBefore(c, host.firstChild);
  return true;
}

function _due(cause) { return _get('nexo_sleep_off_' + cause) !== '1' && _now() - (parseInt(_get('nexo_sleep_at_' + cause) || '0', 10) || 0) >= DAY_MS; }

/** Mira los cierres de hoy y, si toca, muestra UNA tarjeta. Devuelve la causa mostrada ('kill' | 'recents') o null. */
export function sleepCheck() {
  var pl = _plugin();
  if (!pl || typeof pl.getExitReasons !== 'function' || document.getElementById('nexo-sleep-card')) return Promise.resolve(null);
  return exitsInit().then(function(res) {
    var a = analyze(res, _now()), shown = null;
    if (a.kills.length && _due('kill')) {
      return Promise.resolve(typeof pl.alertSettings === 'function' ? pl.alertSettings().catch(function() { return null; }) : null).then(function(s) {
        var ad = _advice(s), n = a.kills.length, why = _motive(a.kills);
        var body = n === 1 ? t('sleep_kill_one', 'Tu teléfono cerró NEXO hoy: {why}.').replace('{why}', why) : t('sleep_kill_many', 'Tu teléfono cerró NEXO {n} veces hoy: {why}.').replace('{n}', n).replace('{why}', why);
        if (_card('kill', body, t('sleep_kill_tip', 'Cerrada, NEXO no recibe mensajes ni llamadas hasta que la abres.') + ' ' + ad.text, ad.btn, function() { pl.openAlertSetting({ what: ad.what }).catch(function() {}); })) { _set('nexo_sleep_at_kill', String(_now())); shown = 'kill'; }
        return shown;
      });
    }
    if (a.recents.length && _due('recents')) {
      if (_card('recents', t('sleep_rec_text', 'NEXO se cerró desde recientes o con «Forzar detención».'), t('sleep_rec_tip', 'Cerrada así, NEXO deja de recibir mensajes y llamadas hasta que la abres otra vez. Para seguir recibiendo, déjala en recientes y no la deslices (en muchos teléfonos puedes ponerle candado).'), '', null)) { _set('nexo_sleep_at_recents', String(_now())); shown = 'recents'; }
    }
    return shown;
  }).catch(function() { return null; });
}

export function phoneSleepInstall() {
  if (typeof window === 'undefined' || window.__nexoPhoneSleep) return;
  window.__nexoPhoneSleep = { check: sleepCheck, analyze: analyze };
  var d = (typeof window.NEXO_SLEEP_DELAY_MS === 'number') ? window.NEXO_SLEEP_DELAY_MS : DELAY_MS;
  setTimeout(function() { sleepCheck(); }, d);
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') sleepCheck(); });
}
