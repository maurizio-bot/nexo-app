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

var SKIP_LIMIT = 3; // tras posponerlo esta veces, deja de aparecer solo (sigue en Ajustes)
var DONE_KEY = 'nexo_bat_prompt_done';
var SKIP_KEY = 'nexo_bat_prompt_skips';

// Fabricantes que esconden ajustes propios de inicio automático / segundo plano (Android no los deja comprobar).
// Mismos que el botón «Abrir» de Perfil → Ajustes (openAlertSetting what:'vendor') y la lista nativa del plugin.
var VENDOR_LABEL = {
  vivo: 'Vivo', iqoo: 'iQOO', samsung: 'Samsung', xiaomi: 'Xiaomi', redmi: 'Redmi', poco: 'Poco',
  oppo: 'Oppo', realme: 'Realme', oneplus: 'OnePlus', huawei: 'Huawei', honor: 'Honor'
};
var VENDOR_HINT = {
  vivo: 'En tu Vivo, abre «Inicio automático» y «Alto consumo en segundo plano» y activa NEXO.',
  iqoo: 'En tu iQOO, abre «Inicio automático» y «Alto consumo en segundo plano» y activa NEXO.',
  samsung: 'En tu Samsung, pon la batería de NEXO «Sin restricciones» y quítala de «Apps en suspensión».',
  xiaomi: 'En tu Xiaomi, abre «Inicio automático» y activa NEXO.',
  redmi: 'En tu Redmi, abre «Inicio automático» y activa NEXO.',
  poco: 'En tu Poco, abre «Inicio automático» y activa NEXO.',
  oppo: 'En tu Oppo, permite el «Inicio automático» de NEXO.',
  realme: 'En tu Realme, permite el «Inicio automático» de NEXO.',
  oneplus: 'En tu OnePlus, permite el «Inicio automático» de NEXO.',
  huawei: 'En tu Huawei, en «Inicio de apps» pon NEXO «a mano» y actívalo todo.',
  honor: 'En tu Honor, en «Inicio de apps» pon NEXO «a mano» y actívalo todo.'
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
  style.textContent = '#nexo-bat-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.94); z-index: 2147483646; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px); }'
    + ' #nexo-bat-overlay .bat-in { background: #0a0a15; border: 1px solid #00d4ff; border-radius: 16px; padding: 30px 26px; max-width: 360px; width: 90%; text-align: center; color: #fff; box-shadow: 0 0 40px rgba(0,212,255,0.15); box-sizing: border-box; }'
    + ' #nexo-bat-overlay .bat-icon { font-size: 54px; margin-bottom: 10px; }'
    + ' #nexo-bat-overlay h2 { margin: 0 0 12px; font-size: 20px; color: #00d4ff; }'
    + ' #nexo-bat-overlay p { margin: 0 0 10px; font-size: 14px; color: #ccc; line-height: 1.5; }'
    + ' #nexo-bat-overlay .bat-why { background: rgba(255,170,0,0.1); border: 1px solid rgba(255,170,0,0.3); border-radius: 10px; padding: 11px 13px; font-size: 13px; color: #ffcc66; margin: 4px 0 16px; text-align: left; }'
    + ' #nexo-bat-overlay .bat-ok { color: #00ff88; font-weight: 700; }'
    + ' #nexo-bat-overlay .bat-primary { display: block; width: 100%; margin: 6px 0; padding: 15px; background: linear-gradient(135deg,#00d4ff,#0099cc); color: #000; border: none; border-radius: 10px; font-weight: 700; font-size: 15px; cursor: pointer; }'
    + ' #nexo-bat-overlay .bat-ghost { display: block; width: 100%; margin: 4px 0 0; padding: 10px; background: transparent; color: #666; border: none; font-size: 13px; cursor: pointer; }'
    + ' #nexo-bat-overlay .bat-primary:active { transform: scale(0.98); }';
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
  if (_get(DONE_KEY) === '1') { done('already'); return; } // ya exento alguna vez: no molestar
  if (document.getElementById('nexo-bat-overlay') || document.getElementById('nexo-perm-overlay')) return; // ya hay una pantalla
  var skips = parseInt(_get(SKIP_KEY) || '0', 10) || 0;

  var proceed = function (r) {
    if (!r) { done('error'); return; }
    if (r.battery === true) { _set(DONE_KEY, '1'); done('exempt'); return; } // el sistema ya deja a NEXO en segundo plano
    if (skips >= SKIP_LIMIT) { done('skipped-enough'); return; } // ya se pospuso bastante; queda en Ajustes
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
    _finish('skip');
  }

  // Paso 1: pedir la exención del ahorro de batería (el ajuste del sistema).
  function renderBatteryStep() {
    box.innerHTML = '';
    var icon = document.createElement('div'); icon.className = 'bat-icon'; icon.textContent = '🔋';
    var h = document.createElement('h2'); h.textContent = 'Un paso para que NEXO funcione siempre';
    var p = document.createElement('p'); p.textContent = 'NEXO recibe tus mensajes y llamadas aunque la app esté en segundo plano o la pantalla apagada.';
    var why = document.createElement('div'); why.className = 'bat-why';
    why.textContent = '⚠️ Si no desactivas el ahorro de batería para NEXO, el teléfono lo congela y los mensajes y las llamadas llegan tarde o no llegan.';
    var primary = document.createElement('button'); primary.className = 'bat-primary'; primary.id = 'nexo-bat-allow';
    primary.textContent = 'Desactivar ahorro de batería';
    var ghost = document.createElement('button'); ghost.className = 'bat-ghost'; ghost.id = 'nexo-bat-skip';
    ghost.textContent = 'Ahora no';
    box.append(icon, h, p, why, primary, ghost);
    primary.onclick = function () {
      awaiting = true;
      try { pl.openAlertSetting({ what: 'battery' }).catch(function () {}); } catch (e) {}
      // El ajuste del sistema no siempre dispara 'resume'/visibilitychange: reintentos por si acaso.
      _clearTimers();
      [1500, 3500, 6500].forEach(function (ms) { recheckTimers.push(setTimeout(recheck, ms)); });
    };
    ghost.onclick = _skip;
  }

  // Paso 2 (solo fabricantes agresivos): guiar al «inicio automático» que Android no deja comprobar.
  function renderVendorStep() {
    box.innerHTML = '';
    var label = VENDOR_LABEL[vk] || 'tu teléfono';
    var icon = document.createElement('div'); icon.className = 'bat-icon'; icon.textContent = '📱';
    var ok = document.createElement('p'); ok.innerHTML = '<span class="bat-ok">✅ Ahorro de batería desactivado.</span>';
    var h = document.createElement('h2'); h.textContent = 'Un último ajuste en tu ' + label;
    var p = document.createElement('p'); p.textContent = VENDOR_HINT[vk] || 'Permite que NEXO se inicie solo y funcione en segundo plano.';
    var primary = document.createElement('button'); primary.className = 'bat-primary'; primary.id = 'nexo-bat-vendor';
    primary.textContent = 'Abrir ajustes de ' + label;
    var ghost = document.createElement('button'); ghost.className = 'bat-ghost'; ghost.id = 'nexo-bat-vendor-done';
    ghost.textContent = 'Listo';
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
