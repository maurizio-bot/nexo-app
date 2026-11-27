/**
 * NEXO — Aviso de ahorro de batería al instalar (pedido del dueño, ronda 2811):
 * «lo de quitar el ahorro de batería, deberías poner eso como aviso cuando se instala la app como los permisos
 *  que se piden aceptar y con eso aseguramos que el user a descargar la app cumpla y de ahí la app funcione como debe».
 *
 * Antes se saltaba en mudo al ajuste del sistema (openAlertSetting battery) y era fácil de ignorar. Ahora, como un
 * permiso: una pantalla a toda la vista explica POR QUÉ (sin desactivar el ahorro de batería el sistema congela NEXO y
 * los mensajes/llamadas llegan tarde), con un botón grande que abre el ajuste del sistema. Al volver se comprueba:
 * si quedó exento, listo; y si el teléfono es de los agresivos (Vivo —el del dueño—, Samsung, Xiaomi…), una segunda
 * pantalla guía además al «inicio automático» del fabricante, que Android no deja comprobar.
 *
 * No se insiste para siempre: si el dueño lo pospone («Ahora no»), vuelve a aparecer unos pocos arranques y luego queda
 * en Perfil → Ajustes → «Avisos con la pantalla apagada». En cuanto el sistema marca a NEXO como exento, no vuelve a
 * salir nunca. Todo lo nativo pasa por el plugin NexoBLE (alertSettings / openAlertSetting), igual que Perfil → Ajustes.
 */

import { t } from './i18n.js';

var SKIP_LIMIT = 3; // tras posponerlo esta veces, deja de aparecer solo (sigue en Ajustes)
var DONE_KEY = 'nexo_bat_prompt_done';
var SKIP_KEY = 'nexo_bat_prompt_skips';
var SKIP_AT_KEY = 'nexo_bat_prompt_skip_at'; // 3153: cuándo se pospuso por última vez
var RETRY_MS = 7 * 24 * 3600 * 1000;       // agotados los avisos, vuelve como mucho 1 vez cada 7 días mientras siga sin exención

// Fabricantes que esconden ajustes propios de inicio automático / segundo plano (Android no los deja comprobar).
// Mismos que el botón «Abrir» de Perfil → Ajustes (openAlertSetting what:'vendor') y la lista nativa del plugin.
var VENDOR_LABEL = {
  vivo: 'Vivo', iqoo: 'iQOO', samsung: 'Samsung', xiaomi: 'Xiaomi', redmi: 'Redmi', poco: 'Poco',
  oppo: 'Oppo', realme: 'Realme', oneplus: 'OnePlus', huawei: 'Huawei', honor: 'Honor'
};
var VENDOR_HINT = {
  vivo: t('prof_bat_hint_vivo', 'En tu Vivo, abre «Inicio automático» y «Alto consumo en segundo plano» y activa NEXO.'),
  iqoo: t('prof_bat_hint_iqoo', 'En tu iQOO, abre «Inicio automático» y «Alto consumo en segundo plano» y activa NEXO.'),
  samsung: t('prof_bat_hint_samsung', 'En tu Samsung, pon la batería de NEXO «Sin restricciones» y quítala de «Apps en suspensión».'),
  xiaomi: t('prof_bat_hint_xiaomi', 'En tu Xiaomi, abre «Inicio automático» y activa NEXO; en Otros permisos, permite «Ventanas emergentes en segundo plano» (para contestar llamadas con manos libres).'),
  redmi: t('prof_bat_hint_redmi', 'En tu Redmi, abre «Inicio automático» y activa NEXO; en Otros permisos, permite «Ventanas emergentes en segundo plano» (para contestar llamadas con manos libres).'),
  poco: t('prof_bat_hint_poco', 'En tu Poco, abre «Inicio automático» y activa NEXO; en Otros permisos, permite «Ventanas emergentes en segundo plano» (para contestar llamadas con manos libres).'),
  oppo: t('prof_bat_hint_oppo', 'En tu Oppo, permite el «Inicio automático» de NEXO.'),
  realme: t('prof_bat_hint_realme', 'En tu Realme, permite el «Inicio automático» de NEXO.'),
  oneplus: t('prof_bat_hint_oneplus', 'En tu OnePlus, permite el «Inicio automático» de NEXO.'),
  huawei: t('prof_bat_hint_huawei', 'En tu Huawei, en «Inicio de apps» pon NEXO «a mano» y actívalo todo.'),
  honor: t('prof_bat_hint_honor', 'En tu Honor, en «Inicio de apps» pon NEXO «a mano» y actívalo todo.')
};

function _plugin() {
  try {
    return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
  } catch (e) { return null; }
}
function _get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _vendorKey(v) {
  v = String(v || '').toLowerCase();
  var keys = Object.keys(VENDOR_LABEL);
  for (var i = 0; i < keys.length; i++) if (v.indexOf(keys[i]) >= 0) return keys[i];
  return null;
}

function _injectStyles() {
  if (document.getElementById('nexo-bat-overlay-styles')) return;
  var style = document.createElement('style');
  style.id = 'nexo-bat-overlay-styles';
  style.textContent = '#nexo-bat-overlay { position: fixed; inset: 0; background: var(--nx-bg,#000); z-index: 2147483646; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); }'
    + ' #nexo-bat-overlay .bat-in { background: var(--nx-sheet); border: 1px solid var(--nx-line); border-radius: var(--nx-radius); padding: 30px 26px; max-width: 360px; width: 90%; text-align: center; color: #fff; box-shadow: none; box-sizing: border-box; }'
    + ' #nexo-bat-overlay .bat-icon { font-size: 54px; margin-bottom: 10px; }'
    + ' #nexo-bat-overlay h2 { margin: 0 0 12px; font-size: 22px; font-weight: 800; letter-spacing: -0.3px; color: #fff; }'
    + ' #nexo-bat-overlay p { margin: 0 0 10px; font-size: 14px; color: var(--nx-muted); line-height: 1.5; }'
    + ' #nexo-bat-overlay .bat-why { background: var(--nx-surface); border: 1px solid var(--nx-line); border-radius: 14px; padding: 11px 13px; font-size: 13px; color: var(--nx-text); margin: 4px 0 16px; text-align: left; }'
    + ' #nexo-bat-overlay .bat-ok { color: var(--nx-cyan); font-weight: 700; }'
    + ' #nexo-bat-overlay .bat-primary { display: block; width: 100%; margin: 6px 0; padding: 15px; background: var(--nx-grad); color: #fff; border: none; border-radius: 14px; font-weight: 700; font-size: 15px; cursor: pointer; box-shadow: 0 10px 30px rgba(0,200,255,0.35), 0 4px 12px rgba(168,85,247,0.35); }'
    + ' #nexo-bat-overlay .bat-ghost { display: block; width: 100%; margin: 4px 0 0; padding: 10px; background: transparent; color: var(--nx-muted); border: none; font-size: 13px; cursor: pointer; }'
    + '';
  document.head.appendChild(style);
}

/**
 * Muestra el aviso si hace falta. opts: { plugin, settings, onDone }.
 *  - settings: resultado de alertSettings() ya pedido (opcional; si no, se pide aquí).
 *  - onDone(reason): 'exempt' | 'granted' | 'skip' | 'skipped-enough' | 'already' | 'no-plugin' | 'error'.
 */
export function batteryGuard(opts) {
  opts = opts || {};
  var pl = opts.plugin || _plugin();
  var done = typeof opts.onDone === 'function' ? opts.onDone : function () {};
  if (!pl || typeof pl.alertSettings !== 'function') { done('no-plugin'); return; }
  var force = !!opts.force; // 3247: desde el aviso «te llegaron mensajes tarde»: sin límites de veces
  if (_get(DONE_KEY) === '1' && !force && !opts.settings) { done('already'); return; } // ya exento alguna vez: no molestar
  if (document.getElementById('nexo-bat-overlay') || document.getElementById('nexo-perm-overlay')) return; // ya hay una pantalla
  var skips = parseInt(_get(SKIP_KEY) || '0', 10) || 0;

  var proceed = function (r) {
    if (!r) { done('error'); return; }
    if (r.battery === true) { _set(DONE_KEY, '1'); done('exempt'); return; } // el sistema ya deja a NEXO en segundo plano
    if (_get(DONE_KEY) === '1') { _set(DONE_KEY, '0'); _set(SKIP_KEY, '0'); } // 3247: estuvo exento y ya no (el sistema o el usuario lo quitó): se vuelve a pedir
    var skipAt = parseInt(_get(SKIP_AT_KEY) || '0', 10) || 0;
    if (!force && skips >= SKIP_LIMIT && !(skipAt > 0 && Date.now() - skipAt >= RETRY_MS)) { done('skipped-enough'); return; } // ya se pospuso bastante; queda en Ajustes
    _showOverlay(pl, r, done);
  };

  if (opts.settings) { proceed(opts.settings); return; }
  pl.alertSettings().then(proceed).catch(function () { done('error'); });
}

function _showOverlay(pl, settings, done) {
  _injectStyles();
  var vk = _vendorKey(settings && settings.vendor);
  var overlay = document.createElement('div');
  overlay.id = 'nexo-bat-overlay';
  var box = document.createElement('div');
  box.className = 'bat-in';
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  var awaiting = false;      // esperando que el dueño vuelva del ajuste del sistema
  var recheckTimers = [];
  var finished = false;

  function _clearTimers() { recheckTimers.forEach(function (t) { clearTimeout(t); }); recheckTimers = []; }
  function _cleanup() {
    _clearTimers();
    document.removeEventListener('visibilitychange', onVis);
    document.removeEventListener('resume', onVis);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
  function _finish(reason) { if (finished) return; finished = true; _cleanup(); done(reason); }
  function _skip() {
    _set(SKIP_KEY, String((parseInt(_get(SKIP_KEY) || '0', 10) || 0) + 1));
    _set(SKIP_AT_KEY, String(Date.now()));
    _finish('skip');
  }

  // Paso 1: pedir la exención del ahorro de batería (el ajuste del sistema).
  function renderBatteryStep() {
    box.innerHTML = '';
    var icon = document.createElement('div'); icon.className = 'bat-icon'; icon.textContent = '🔋';
    var h = document.createElement('h2'); h.textContent = t('prof_bat_step_title', 'Un paso para que NEXO funcione siempre');
    var p = document.createElement('p'); p.textContent = t('prof_bat_step_body', 'NEXO recibe tus mensajes y llamadas aunque la app esté en segundo plano o la pantalla apagada.');
    var why = document.createElement('div'); why.className = 'bat-why';
    why.textContent = t('prof_bat_why', '⚠️ Si no desactivas el ahorro de batería para NEXO, el teléfono lo congela y los mensajes y las llamadas llegan tarde o no llegan.');
    var primary = document.createElement('button'); primary.className = 'bat-primary'; primary.id = 'nexo-bat-allow';
    primary.textContent = t('prof_bat_disable', 'Desactivar ahorro de batería');
    var ghost = document.createElement('button'); ghost.className = 'bat-ghost'; ghost.id = 'nexo-bat-skip';
    ghost.textContent = t('prof_bat_later', 'Ahora no');
    box.append(icon, h, p, why, primary, ghost);
    primary.onclick = function () {
      awaiting = true;
      try { pl.openAlertSetting({ what: 'battery' }).catch(function () {}); } catch (e) {}
      // El ajuste del sistema no siempre dispara 'resume'/visibilitychange: reintentos por si acaso.
      _clearTimers();
      [1500, 3500, 6500].forEach(function (ms) { recheckTimers.push(setTimeout(recheck, ms)); });
    };
    ghost.onclick = renderConfirmStep; // 3247: «Ahora no» ya no cierra en silencio: hay que decir que no a propósito
  }

  // 3247 (dueño 18-11): confirmar el «no», explicando en una frase lo que cuesta
  function renderConfirmStep() {
    box.innerHTML = '';
    var icon = document.createElement('div'); icon.className = 'bat-icon'; icon.textContent = '⚠️';
    var h = document.createElement('h2'); h.textContent = t('prof_bat_sure', '¿Seguro?');
    var p = document.createElement('p'); p.textContent = t('prof_bat_sure_body', 'Sin este ajuste tus mensajes y llamadas llegan tarde o no llegan, y tus contactos verán que tienes NEXO limitado.');
    var primary = document.createElement('button'); primary.className = 'bat-primary'; primary.id = 'nexo-bat-back';
    primary.textContent = t('prof_bat_sure_back', 'Volver y activarlo');
    var ghost = document.createElement('button'); ghost.className = 'bat-ghost'; ghost.id = 'nexo-bat-skip-sure';
    ghost.textContent = t('prof_bat_sure_no', 'Seguir sin activarlo');
    box.append(icon, h, p, primary, ghost);
    primary.onclick = renderBatteryStep;
    ghost.onclick = _skip;
  }

  // Paso 2 (solo fabricantes agresivos): guiar al «inicio automático» que Android no deja comprobar.
  function renderVendorStep() {
    box.innerHTML = '';
    var label = VENDOR_LABEL[vk] || t('prof_bat_your_phone', 'tu teléfono');
    var icon = document.createElement('div'); icon.className = 'bat-icon'; icon.textContent = '📱';
    var ok = document.createElement('p'); ok.innerHTML = '<span class="bat-ok">' + t('prof_bat_disabled_ok', '✅ Ahorro de batería desactivado.') + '</span>';
    var h = document.createElement('h2'); h.textContent = t('prof_bat_last_step', 'Un último ajuste en tu ') + label;
    var p = document.createElement('p'); p.textContent = VENDOR_HINT[vk] || t('prof_bat_hint_generic', 'Permite que NEXO se inicie solo y funcione en segundo plano.');
    var primary = document.createElement('button'); primary.className = 'bat-primary'; primary.id = 'nexo-bat-vendor';
    primary.textContent = t('prof_bat_open_settings', 'Abrir ajustes de ') + label;
    var ghost = document.createElement('button'); ghost.className = 'bat-ghost'; ghost.id = 'nexo-bat-vendor-done';
    ghost.textContent = t('prof_bat_done', 'Listo');
    box.append(icon, ok, h, p, primary, ghost);
    primary.onclick = function () { try { pl.openAlertSetting({ what: 'vendor' }).catch(function () {}); } catch (e) {} };
    ghost.onclick = function () { _finish('granted'); };
  }

  // Al volver del ajuste del sistema, comprobar si ya quedó exento.
  function recheck() {
    if (finished || !awaiting) return;
    try {
      pl.alertSettings().then(function (r2) {
        if (finished) return;
        if (r2 && r2.battery === true) {
          awaiting = false;
          _clearTimers();
          _set(DONE_KEY, '1'); // exento: no vuelve a salir nunca
          if (vk) renderVendorStep(); else _finish('granted');
        }
        // Si sigue sin exención, se deja la pantalla para que lo reintente.
      }).catch(function () {});
    } catch (e) {}
  }
  function onVis() {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible' && awaiting) recheck();
  }
  document.addEventListener('visibilitychange', onVis);
  document.addEventListener('resume', onVis);

  renderBatteryStep();
}

// UMD / global, como el resto de módulos de UI
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { batteryGuard: batteryGuard };
} else if (typeof window !== 'undefined') {
  window.NEXO_batteryGuard = batteryGuard;
}
