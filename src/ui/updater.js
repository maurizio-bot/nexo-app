/**
 * NEXO — Actualizador automático del APK de probadores (2986; pedido del dueño 10-11: «las actualizaciones automáticas», lo que más
 * le gustó). Sus probadores casi nunca actualizan a mano, así que los arreglos no llegan. La app consulta (con el plugin nativo)
 * los lanzamientos públicos `nightly-N` del repositorio en GitHub; si hay uno con número mayor que el propio, muestra un aviso
 * «Hay una versión nueva» con «Actualizar» (descarga el APK y lo abre en el instalador del sistema, que pide su confirmación y exige
 * la MISMA firma) y «Ahora no» (calla ese número un día). Nunca instala sola: Android siempre pide un toque.
 * - Solo en compilaciones con número (las del workflow inyectan window.NEXO_BUILD); el simulador y las locales («dev») no consultan.
 * - Máximo una consulta cada UPD_GAP_MS (6 h) salvo «Buscar ahora»; interruptor en Perfil → Ajustes. La versión de Google Play no
 *   usa esto (se actualiza por Play): window.NEXO_UPDATER = false lo apaga de raíz.
 * - Lo único que sale del teléfono es una petición pública a GitHub (sin ningún dato del usuario; GitHub ve la IP, como cualquier web).
 * Perillas de prueba (tests/sim): window.NEXO_BUILD, NEXO_UPDATER, NEXO_UPDATER_GAP_MS.
 */
import { t } from './i18n.js';
import { _showToast } from './ble_helpers.js';

var KEY_ON = 'nexo_updater', KEY_LAST = 'nexo_upd_last', KEY_AVAIL = 'nexo_upd_avail', KEY_SNOOZE = 'nexo_upd_snooze';
var GAP_MS = 6 * 60 * 60 * 1000;      // una consulta cada 6 h como mucho
var SNOOZE_MS = 24 * 60 * 60 * 1000;  // «Ahora no» calla ESE número un día
var _busy = false, _pct = -1, _listening = false;

function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _plugin() { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; } catch (e) { return null; } }
function _emit() { try { window.dispatchEvent(new CustomEvent('nexo:updater:changed')); } catch (e) {} }
function _json(k) { try { var o = JSON.parse(_lsGet(k) || 'null'); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; } }

/** Número de build propio (entero) o null si es una compilación sin número («dev»). */
export function updaterBuildNum() { var b = (typeof window !== 'undefined') ? window.NEXO_BUILD : ''; return /^\d+$/.test(String(b || '')) ? parseInt(b, 10) : null; }
export function updaterEnabled() { return !(typeof window !== 'undefined' && window.NEXO_UPDATER === false) && _lsGet(KEY_ON) !== '0'; }
export function setUpdaterEnabled(on) { _lsSet(KEY_ON, on ? '1' : '0'); console.log('[UPDATER] ' + (on ? 'encendido' : 'apagado') + ' por el usuario'); if (!on) _removeBanner(); else _renderBanner(); _emit(); }
export function updaterAvailable() { var a = _json(KEY_AVAIL), me = updaterBuildNum(); return (a && me != null && typeof a.build === 'number' && a.build > me && /^https:\/\//.test(String(a.url || ''))) ? a : null; }
function _gap() { var v = (typeof window !== 'undefined') ? window.NEXO_UPDATER_GAP_MS : undefined; return (typeof v === 'number' && v >= 0) ? v : GAP_MS; }
function _snoozed(a) { var s = _json(KEY_SNOOZE); return !!(s && a && s.build === a.build && typeof s.until === 'number' && Date.now() < s.until); }

/** Consulta si hay una versión nueva. manual=true: ignora el límite de tiempo y el interruptor. Resuelve {state, build?}:
 *  'newer' | 'current' | 'error' | 'unsupported' | 'skipped'. */
export function updaterCheck(manual) {
  var me = updaterBuildNum(), pl = _plugin();
  if (me == null || !pl || typeof pl.updateCheck !== 'function') return Promise.resolve({ state: 'unsupported' });
  if (!manual && !updaterEnabled()) return Promise.resolve({ state: 'skipped' });
  if (!manual && Date.now() - (parseInt(_lsGet(KEY_LAST), 10) || 0) < _gap()) { _renderBanner(); return Promise.resolve({ state: 'skipped' }); }
  _lsSet(KEY_LAST, String(Date.now()));
  return Promise.resolve(pl.updateCheck()).then(function(r) {
    if (r && typeof r.build === 'number' && r.build > me && /^https:\/\//.test(String(r.url || ''))) {
      _lsSet(KEY_AVAIL, JSON.stringify({ build: r.build, url: r.url, size: r.size || 0 }));
      console.log('[UPDATER] hay una versión nueva: ' + r.build + ' (esta es la ' + me + ')');
      _renderBanner(); _emit();
      return { state: 'newer', build: r.build };
    }
    try { localStorage.removeItem(KEY_AVAIL); } catch (e) {}
    _removeBanner(); _emit();
    if (r && typeof r.build === 'number') return { state: 'current', build: r.build };
    return { state: (r && r.reason && r.reason !== 'none') ? 'error' : 'current' };
  }).catch(function() { return { state: 'error' }; });
}

/** Descarga el APK y lo abre en el instalador del sistema. */
export function updaterInstall() {
  var a = updaterAvailable(), pl = _plugin();
  if (!a || !pl || typeof pl.updateInstall !== 'function' || _busy) return Promise.resolve({ opened: false, reason: 'unavailable' });
  _busy = true; _pct = 0; _renderBanner();
  return Promise.resolve(pl.updateInstall({ url: a.url })).then(function(r) {
    _busy = false; _pct = -1; _renderBanner();
    if (r && r.opened) { console.log('[UPDATER] instalador abierto para la ' + a.build); return r; }
    var why = (r && r.reason) || 'net';
    console.log('[UPDATER] no se pudo actualizar: ' + why);
    try {
      if (why === 'install_permission') _showToast(t('upd_need_permission', 'Permite a NEXO instalar aplicaciones y vuelve a tocar «Actualizar».'), 'warn');
      else _showToast(t('upd_failed', 'No se pudo bajar la actualización. Revisa tu internet y prueba otra vez.'), 'warn');
    } catch (e) {}
    return r || { opened: false, reason: why };
  }).catch(function() { _busy = false; _pct = -1; _renderBanner(); try { _showToast(t('upd_failed', 'No se pudo bajar la actualización. Revisa tu internet y prueba otra vez.'), 'warn'); } catch (e) {} return { opened: false, reason: 'net' }; });
}

function _removeBanner() { try { var b = document.getElementById('nexo-update-banner'); if (b && b.parentNode) b.parentNode.removeChild(b); } catch (e) {} }

function _renderBanner() {
  try {
    var a = updaterAvailable();
    if (!a || !updaterEnabled() || (_snoozed(a) && !_busy)) { _removeBanner(); return; }
    var b = document.getElementById('nexo-update-banner');
    if (!b) {
      b = document.createElement('div'); b.id = 'nexo-update-banner';
      b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:max(16px,env(safe-area-inset-bottom));z-index:9000;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;font-weight:600;display:flex;align-items:center;gap:10px;box-shadow:0 6px 22px rgba(0,0,0,0.45);';
      document.body.appendChild(b);
    }
    var mb = a.size ? ' (' + Math.max(1, Math.round(a.size / 1048576)) + ' MB)' : '';
    var text = _busy ? (t('upd_downloading', 'Descargando…') + (_pct > 0 ? ' ' + _pct + ' %' : '')) : (t('upd_new', 'Hay una versión nueva de NEXO') + ' (' + a.build + ')' + mb);
    b.innerHTML = '<span style="font-size:18px;">⬆️</span><span style="flex:1;min-width:0;" id="nexo-update-text"></span>' +
      (_busy ? '' : '<button id="nexo-update-now" style="background:#fff;color:#102;border:none;border-radius:10px;padding:8px 12px;font-weight:700;">' + t('upd_now', 'Actualizar') + '</button>' +
        '<button id="nexo-update-later" style="background:transparent;color:#fff;border:none;padding:8px 6px;opacity:0.9;">' + t('upd_later', 'Ahora no') + '</button>');
    b.querySelector('#nexo-update-text').textContent = text;
    var now = b.querySelector('#nexo-update-now'), later = b.querySelector('#nexo-update-later');
    if (now) now.onclick = function() { updaterInstall(); };
    if (later) later.onclick = function() { _lsSet(KEY_SNOOZE, JSON.stringify({ build: a.build, until: Date.now() + SNOOZE_MS })); _removeBanner(); };
  } catch (e) {}
}

/** Arranque (main.js): escucha el avance de la descarga y consulta si toca. */
export function updaterInit() {
  try {
    var pl = _plugin();
    if (pl && typeof pl.addListener === 'function' && !_listening) {
      _listening = true;
      pl.addListener('onUpdateProgress', function(d) { if (d && typeof d.pct === 'number') { _pct = d.pct; _renderBanner(); } });
    }
    _renderBanner();
    setTimeout(function() { updaterCheck(false); }, 8000);   // sin competir con el arranque
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') updaterCheck(false); });
  } catch (e) {}
}

// ---- Perfil → Ajustes: interruptor + «Buscar ahora» ----
export function updaterInnerHtml() {
  var me = updaterBuildNum();
  return '<div class="nx-sub" style="margin-bottom:8px;">' + t('upd_sub', 'NEXO avisa cuando hay una versión nueva y la baja con un toque. Solo se consulta GitHub (público): no se manda nada tuyo.') + '</div>' +
    '<label class="nx-row" style="display:flex;align-items:center;gap:10px;"><input type="checkbox" id="nexo-updater-on"' + (updaterEnabled() ? ' checked' : '') + '><span>' + t('upd_auto', 'Buscar versiones nuevas solo') + '</span></label>' +
    '<div class="nx-sub" id="nexo-updater-status" style="margin:6px 0;">' + t('upd_current', 'Tu versión') + ': ' + (me != null ? me : 'dev') + '</div>' +
    '<button id="nexo-updater-now" class="nx-btn">' + t('upd_check_now', 'Buscar ahora') + '</button>';
}
export function renderUpdaterSection(sheet) {
  if (!sheet) return;
  var box = sheet.querySelector('#nexo-updater-on'), btn = sheet.querySelector('#nexo-updater-now'), st = sheet.querySelector('#nexo-updater-status');
  if (box) box.onchange = function() { setUpdaterEnabled(box.checked); };
  if (btn) btn.onclick = function() {
    if (st) st.textContent = t('upd_checking', 'Buscando…');
    updaterCheck(true).then(function(r) {
      if (!st) return;
      var me = updaterBuildNum();
      if (r.state === 'newer') st.textContent = t('upd_new', 'Hay una versión nueva de NEXO') + ' (' + r.build + ')';
      else if (r.state === 'current') st.textContent = t('upd_uptodate', 'Ya tienes la última') + ' (' + (me != null ? me : 'dev') + ')';
      else if (r.state === 'unsupported') st.textContent = t('upd_unsupported', 'Esta versión no se actualiza sola.');
      else st.textContent = t('upd_error', 'No se pudo consultar. Revisa tu internet.');
    });
  };
}

// Gancho de pruebas (tests/sim/updater.js)
try { if (typeof window !== 'undefined') window.__nexoUpdater = { check: updaterCheck, install: updaterInstall, available: updaterAvailable, enabled: updaterEnabled, setEnabled: setUpdaterEnabled }; } catch (e) {}
