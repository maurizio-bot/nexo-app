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

var KEY_ON = 'nexo_updater', KEY_LAST = 'nexo_upd_last', KEY_AVAIL = 'nexo_upd_avail', KEY_SNOOZE = 'nexo_upd_snooze', KEY_NOTIFIED = 'nexo_upd_notified';
var GAP_MS = 6 * 60 * 60 * 1000;      // una consulta cada 6 h como mucho
var SNOOZE_MS = 24 * 60 * 60 * 1000;  // «Ahora no» calla ESE número un día
var _busy = false, _pct = -1, _listening = false;
// 3008 (dueño 11-11: «si pulso afuera mientras descargo y luego vuelvo me hace volver a descargar… una vez descargada el único botón es
// instalar»): DESCARGAR e INSTALAR van separados. «Descargar» baja el APK en el nativo y sigue aunque se cierre la ventana o se salga de
// la app; al terminar avisa (aviso del sistema + mensaje) y desde ahí el único botón es «Instalar», que abre el instalador con lo ya
// bajado (nunca vuelve a bajar). El estado se le pregunta al nativo (mode: 'status') al abrir Ajustes, al volver a la app y mientras
// baja, así que al reabrir la ventana se ve «Descargando… X %» o «Instalar», nunca otra vez «Descargar».
var _ready = 0, _pollT = null;

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
      _renderBanner(); _emit(); _maybeNotify(); _refreshState();
      return { state: 'newer', build: r.build };
    }
    try { localStorage.removeItem(KEY_AVAIL); } catch (e) {}
    _removeBanner(); _notifyCancel(); _emit();
    if (r && typeof r.build === 'number') return { state: 'current', build: r.build };
    return { state: (r && r.reason && r.reason !== 'none') ? 'error' : 'current' };
  }).catch(function() { return { state: 'error' }; });
}

function _toast(k, d, kind) { try { _showToast(t(k, d), kind || 'info'); } catch (e) {} }
function _stopPoll() { if (_pollT) { clearInterval(_pollT); _pollT = null; } }
function _startPoll() { if (!_pollT) _pollT = setInterval(function() { _refreshState(); }, 4000); }
function _onReady(build) {
  var a = updaterAvailable();
  if (!a || a.build !== build) return;
  var was = _ready === build;
  _ready = build; _busy = false; _pct = -1; _stopPoll(); _renderBanner(); _emit();
  if (!was) { console.log('[UPDATER] la ' + build + ' ya está descargada: lista para instalar'); _toast('upd_ready_toast', 'Actualización descargada. Toca «Instalar».', 'success'); }
}
// Pregunta al nativo si la versión ofrecida ya está bajada o se está bajando (p. ej. tras cerrar la ventana o rehacerse la pantalla)
function _refreshState() {
  var a = updaterAvailable(), pl = _plugin();
  if (!a || !pl || typeof pl.updateInstall !== 'function') { _stopPoll(); return Promise.resolve(null); }
  return Promise.resolve(pl.updateInstall({ url: a.url, build: a.build, mode: 'status' })).then(function(r) {
    if (!r) return r;
    if (r.ready) { _onReady(a.build); return r; }
    if (r.downloading) { if (!_busy) { _busy = true; _renderBanner(); } _startPoll(); return r; }
    if (_ready === a.build) { _ready = 0; _renderBanner(); _emit(); }   // el sistema borró lo bajado: se vuelve a ofrecer «Descargar»
    if (_busy && !_dlCall) { _busy = false; _pct = -1; _stopPoll(); _renderBanner(); }   // la descarga murió (p. ej. sin internet)
    return r;
  }).catch(function() { return null; });
}
var _dlCall = false;
/** Baja el APK de la versión ofrecida (sin instalar). Sigue aunque se cierre la ventana; al terminar avisa. */
export function updaterDownload() {
  var a = updaterAvailable(), pl = _plugin();
  if (!a || !pl || typeof pl.updateInstall !== 'function') return Promise.resolve({ ready: false, reason: 'unavailable' });
  if (_ready === a.build) return Promise.resolve({ ready: true });
  if (_busy) { _toast('upd_busy_toast', 'Ya se está descargando. Te aviso al terminar.'); return Promise.resolve({ downloading: true }); }
  _busy = true; _pct = 0; _dlCall = true; _renderBanner(); _notifyCancel(); _startPoll();
  _toast('upd_bg_toast', 'Descargando la actualización. Puedes seguir usando NEXO: te aviso al terminar.');
  console.log('[UPDATER] descargando la ' + a.build + ' (sigue aunque se cierre la ventana)');
  return Promise.resolve(pl.updateInstall({ url: a.url, build: a.build, mode: 'download' })).then(function(r) {
    _dlCall = false;
    if (r && r.ready) { _onReady(a.build); return r; }
    if (r && r.downloading) return r;                          // ya se estaba bajando: avisa al terminar (evento o consulta)
    _busy = false; _pct = -1; _stopPoll(); _renderBanner();
    console.log('[UPDATER] no se pudo descargar: ' + ((r && r.reason) || 'net'));
    _toast('upd_failed', 'No se pudo bajar la actualización. Revisa tu internet y prueba otra vez.', 'warn');
    return r || { ready: false, reason: 'net' };
  }).catch(function() { _dlCall = false; _busy = false; _pct = -1; _stopPoll(); _renderBanner(); _toast('upd_failed', 'No se pudo bajar la actualización. Revisa tu internet y prueba otra vez.', 'warn'); return { ready: false, reason: 'net' }; });
}

/** «Instalar»: abre el instalador con lo YA bajado. Si aún no está bajado, lo baja (y avisa al terminar; luego «Instalar»). */
export function updaterInstall() {
  var a = updaterAvailable(), pl = _plugin();
  if (!a || !pl || typeof pl.updateInstall !== 'function') return Promise.resolve({ opened: false, reason: 'unavailable' });
  if (_ready !== a.build) return updaterDownload().then(function(r) { return { opened: false, reason: (r && r.ready) ? 'downloaded' : ((r && r.downloading) ? 'downloading' : ((r && r.reason) || 'net')) }; });
  return Promise.resolve(pl.updateInstall({ url: a.url, build: a.build, mode: 'open' })).then(function(r) {
    if (r && r.opened) { console.log('[UPDATER] instalador abierto para la ' + a.build); _notifyCancel(); return r; }
    var why = (r && r.reason) || 'launch';
    console.log('[UPDATER] no se pudo abrir el instalador: ' + why);
    if (why === 'missing') { _ready = 0; _renderBanner(); return updaterDownload().then(function() { return { opened: false, reason: 'missing' }; }); }
    if (why === 'install_permission') _toast('upd_need_permission_install', 'Permite a NEXO instalar aplicaciones y vuelve a tocar «Instalar».', 'warn');
    else _toast('upd_failed', 'No se pudo bajar la actualización. Revisa tu internet y prueba otra vez.', 'warn');
    return r || { opened: false, reason: why };
  }).catch(function() { return { opened: false, reason: 'launch' }; });
}

// 2991 (pedido del dueño): en Perfil → Ajustes el botón es «Buscar ahora» y, cuando hay una versión nueva, pasa a «Instalar actualización (N)»
// (y al tocarlo baja e instala); mientras baja muestra el avance. Se mantiene al día desde aquí (consulta, avance, descarte).
function _installLabel(a) { return t('upd_install_btn', 'Instalar actualización') + ' (' + a.build + ')'; }
function _downloadLabel(a) { return t('upd_download_btn', 'Descargar actualización') + ' (' + a.build + ')'; }
// Lo que muestra Ajustes según el estado (el mismo al dibujarlo y al actualizarlo): { label, status, disabled }
function _settingsView() {
  var a = updaterAvailable(), me = updaterBuildNum();
  if (a && _busy) return { label: t('upd_downloading', 'Descargando…') + (_pct > 0 ? ' ' + _pct + ' %' : ''), status: t('upd_bg_toast', 'Descargando la actualización. Puedes seguir usando NEXO: te aviso al terminar.'), disabled: true };
  if (a && _ready === a.build) return { label: _installLabel(a), status: t('upd_ready_status', 'Descargada: lista para instalar') + ' (' + a.build + ')', disabled: false };
  if (a) return { label: _downloadLabel(a), status: t('upd_new', 'Hay una versión nueva de NEXO') + ' (' + a.build + ')', disabled: false };
  return { label: t('upd_check_now', 'Buscar ahora'), status: t('upd_current', 'Tu versión') + ': ' + (me != null ? me : 'dev'), disabled: false };
}
function _syncSettings() {
  try {
    var btn = document.getElementById('nexo-updater-now'), st = document.getElementById('nexo-updater-status');
    if (!btn) return;
    var v = _settingsView();
    btn.disabled = v.disabled; btn.textContent = v.label;
    if (st && (v.disabled || updaterAvailable())) st.textContent = v.status;
  } catch (e) {}
}

// 2994 (pedido del dueño 10-11): aviso del sistema «Hay una versión nueva de NEXO» con botón «Actualizar». Una sola vez por número
// de versión y solo si la app NO se está viendo (con la app a la vista ya está el aviso de abajo). «Actualizar» en el aviso abre
// NEXO y arranca la descarga (evento nativo onUpdateAction → updaterInstall). Se quita al instalar, al descartar o si ya no aplica.
function _notifyCancel() { try { var pl = _plugin(); if (pl && typeof pl.updateNotifyCancel === 'function') pl.updateNotifyCancel(); } catch (e) {} }
function _maybeNotify() {
  try {
    var a = updaterAvailable(), pl = _plugin();
    if (!a || !pl || typeof pl.updateNotify !== 'function' || !updaterEnabled() || _snoozed(a) || _busy || _ready === a.build) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
    if (parseInt(_lsGet(KEY_NOTIFIED), 10) === a.build) return;
    _lsSet(KEY_NOTIFIED, String(a.build));
    Promise.resolve(pl.updateNotify({ build: a.build, size: a.size || 0 })).catch(function() {});
    console.log('[UPDATER] aviso del sistema por la versión ' + a.build);
  } catch (e) {}
}

function _removeBanner() { try { var b = document.getElementById('nexo-update-banner'); if (b && b.parentNode) b.parentNode.removeChild(b); } catch (e) {} }

function _renderBanner() {
  _syncSettings();
  try {
    var a = updaterAvailable();
    var ready = !!(a && _ready === a.build);
    if (!a || !updaterEnabled() || (_snoozed(a) && !_busy && !ready)) { _removeBanner(); return; }
    var b = document.getElementById('nexo-update-banner');
    if (!b) {
      b = document.createElement('div'); b.id = 'nexo-update-banner';
      b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:max(16px,env(safe-area-inset-bottom));z-index:9000;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;font-weight:600;display:flex;align-items:center;gap:10px;box-shadow:0 6px 22px rgba(0,0,0,0.45);';
      document.body.appendChild(b);
    }
    var mb = a.size ? ' (' + Math.max(1, Math.round(a.size / 1048576)) + ' MB)' : '';
    var text = _busy ? (t('upd_downloading', 'Descargando…') + (_pct > 0 ? ' ' + _pct + ' %' : ''))
      : ready ? ('NEXO ' + a.build + ' ' + t('upd_ready', 'descargada'))
      : (t('upd_new', 'Hay una versión nueva de NEXO') + ' (' + a.build + ')' + mb);
    var btnCss = 'background:#fff;color:#102;border:none;border-radius:10px;padding:8px 12px;font-weight:700;';
    b.innerHTML = '<span style="font-size:18px;">⬆️</span><span style="flex:1;min-width:0;" id="nexo-update-text"></span>' +
      (_busy ? '' : ready
        ? '<button id="nexo-update-now" style="' + btnCss + '">' + t('upd_install', 'Instalar') + '</button>'   // ya bajada: el único botón es «Instalar»
        : '<button id="nexo-update-now" style="' + btnCss + '">' + t('upd_download', 'Descargar') + '</button>' +
          '<button id="nexo-update-later" style="background:transparent;color:#fff;border:none;padding:8px 6px;opacity:0.9;">' + t('upd_later', 'Ahora no') + '</button>');
    b.querySelector('#nexo-update-text').textContent = text;
    var now = b.querySelector('#nexo-update-now'), later = b.querySelector('#nexo-update-later');
    if (now) now.onclick = function() { if (ready) updaterInstall(); else updaterDownload(); };
    if (later) later.onclick = function() { _lsSet(KEY_SNOOZE, JSON.stringify({ build: a.build, until: Date.now() + SNOOZE_MS })); _removeBanner(); _notifyCancel(); };
  } catch (e) {}
}

/** Arranque (main.js): escucha el avance de la descarga y consulta si toca. */
export function updaterInit() {
  try {
    var pl = _plugin();
    if (pl && typeof pl.addListener === 'function' && !_listening) {
      _listening = true;
      pl.addListener('onUpdateProgress', function(d) { if (d && typeof d.pct === 'number') { _pct = d.pct; if (!_busy && updaterAvailable() && _ready !== updaterAvailable().build) _busy = true; _renderBanner(); } });
      pl.addListener('onUpdateReady', function(d) { if (d && typeof d.build === 'number') _onReady(d.build); });   // 3008: bajada (aunque la ventana esté cerrada)
      // Botón «Actualizar» del aviso del sistema: la app se abre y baja/instala (si el estado guardado ya no la ofrece, consulta antes)
      pl.addListener('onUpdateAction', function(d) {
        if (!d || !d.install) return;
        console.log('[UPDATER] «Actualizar» desde el aviso del sistema');
        if (updaterAvailable()) updaterInstall();
        else updaterCheck(true).then(function(r) { if (r && r.state === 'newer') updaterInstall(); });
      });
    }
    _renderBanner();
    _refreshState();   // 3008: ¿quedó bajada (o bajándose) de antes? → «Instalar» / «Descargando…» sin volver a bajar
    setTimeout(function() { updaterCheck(false); }, 8000);   // sin competir con el arranque
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') { updaterCheck(false); _refreshState(); }
      else _maybeNotify();   // te vas de la app con una versión nueva pendiente → aviso del sistema (una vez por número)
    });
    // Con la app en segundo plano también se mira (updaterCheck se limita solo a una consulta cada 6 h)
    setInterval(function() { updaterCheck(false); }, 30 * 60 * 1000);
  } catch (e) {}
}

// ---- Perfil → Ajustes: interruptor + «Buscar ahora» ----
export function updaterInnerHtml() {
  var me = updaterBuildNum();
  return '<div class="nx-sub" style="margin-bottom:8px;">' + t('upd_sub', 'NEXO avisa cuando hay una versión nueva y la baja con un toque. Solo se consulta GitHub (público): no se manda nada tuyo.') + '</div>' +
    '<label class="nx-row" style="display:flex;align-items:center;gap:10px;"><input type="checkbox" id="nexo-updater-on"' + (updaterEnabled() ? ' checked' : '') + '><span>' + t('upd_auto', 'Buscar versiones nuevas solo') + '</span></label>' +
    '<div class="nx-sub" id="nexo-updater-status" style="margin:6px 0;"></div>' +
    '<button id="nexo-updater-now" class="nx-btn nx-btn-primary"></button>';
}
export function renderUpdaterSection(sheet) {
  if (!sheet) return;
  var box = sheet.querySelector('#nexo-updater-on'), btn = sheet.querySelector('#nexo-updater-now'), st = sheet.querySelector('#nexo-updater-status');
  if (box) box.onchange = function() { setUpdaterEnabled(box.checked); };
  // 3008: se dibuja con el estado de AHORA (bajando / bajada / por bajar) y se le pregunta al nativo por si cambió con la ventana cerrada
  if (st) st.textContent = _settingsView().status;
  _syncSettings(); _refreshState();
  if (btn) btn.onclick = function() {
    var av = updaterAvailable();
    if (av && _ready === av.build) { updaterInstall(); return; }   // ya bajada: «Instalar actualización (N)»
    if (av) { if (!_busy) updaterDownload(); return; }             // hay una nueva: «Descargar actualización (N)»
    if (st) st.textContent = t('upd_checking', 'Buscando…');
    updaterCheck(true).then(function(r) {
      if (!st) return;
      var me = updaterBuildNum();
      if (r.state === 'newer') { st.textContent = t('upd_new', 'Hay una versión nueva de NEXO') + ' (' + r.build + ')'; _syncSettings(); }
      else if (r.state === 'current') st.textContent = t('upd_uptodate', 'Ya tienes la última') + ' (' + (me != null ? me : 'dev') + ')';
      else if (r.state === 'unsupported') st.textContent = t('upd_unsupported', 'Esta versión no se actualiza sola.');
      else st.textContent = t('upd_error', 'No se pudo consultar. Revisa tu internet.');
    });
  };
}

// Gancho de pruebas (tests/sim/updater.js)
try { if (typeof window !== 'undefined') window.__nexoUpdater = { check: updaterCheck, install: updaterInstall, download: updaterDownload, available: updaterAvailable, enabled: updaterEnabled, setEnabled: setUpdaterEnabled, state: function() { return { busy: _busy, ready: _ready, pct: _pct }; } }; } catch (e) {}
