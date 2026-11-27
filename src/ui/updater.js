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
import { t, getLang } from './i18n.js';
import { _showToast } from './ble_helpers.js';
import { isStoreBuild } from './store_flag.js'; // COLA 26: la versión de Google Play no lleva actualizador

var KEY_ON = 'nexo_updater', KEY_LAST = 'nexo_upd_last', KEY_AVAIL = 'nexo_upd_avail', KEY_SNOOZE = 'nexo_upd_snooze', KEY_NOTIFIED = 'nexo_upd_notified', KEY_CUR = 'nexo_upd_curnotes';
var GAP_MS = 6 * 60 * 60 * 1000;      // una consulta cada 6 h como mucho
var SNOOZE_MS = 24 * 60 * 60 * 1000;  // «Ahora no» calla ESE número un día
var _busy = false, _pct = -1, _listening = false;
// 3008 (dueño 11-11: «si pulso afuera mientras descargo y luego vuelvo me hace volver a descargar… una vez descargada el único botón es
// instalar»): DESCARGAR e INSTALAR van separados. «Descargar» baja el APK en el nativo y sigue aunque se cierre la ventana o se salga de
// la app; al terminar avisa (aviso del sistema + mensaje) y desde ahí el único botón es «Instalar», que abre el instalador con lo ya
// bajado (nunca vuelve a bajar). El estado se le pregunta al nativo (mode: 'status') al abrir Ajustes, al volver a la app y mientras
// baja, así que al reabrir la ventana se ve «Descargando… X %» o «Instalar», nunca otra vez «Descargar».
var _ready = 0, _pollT = null;
// 3110 (dueño 15-11: «al pulsar el botón de ajuste se inicia en automático la búsqueda… que no diga búsqueda sino actualiza a la última
// versión»): al abrir Ajustes se consulta sola (como mucho una vez cada SETTINGS_GAP_MS: GitHub limita las consultas sin cuenta) y el
// botón dice lo que hay: «Actualizar a la versión N», «Tienes la última versión» o, si no se pudo consultar, «Volver a intentar».
var SETTINGS_GAP_MS = 2 * 60 * 1000, _settingsAt = 0, _lastCheck = null, _checking = false;
function _settingsGap() { var v = (typeof window !== 'undefined') ? window.NEXO_UPDATER_SETTINGS_GAP_MS : undefined; return (typeof v === 'number' && v >= 0) ? v : SETTINGS_GAP_MS; }

function _lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function _lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function _plugin() { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; } catch (e) { return null; } }
function _emit() { try { window.dispatchEvent(new CustomEvent('nexo:updater:changed')); } catch (e) {} }
function _json(k) { try { var o = JSON.parse(_lsGet(k) || 'null'); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; } }

/** Número de build propio (entero) o null si es una compilación sin número («dev»). */
export function updaterBuildNum() { var b = (typeof window !== 'undefined') ? window.NEXO_BUILD : ''; return /^\d+$/.test(String(b || '')) ? parseInt(b, 10) : null; }
export function updaterEnabled() { return !isStoreBuild() && !(typeof window !== 'undefined' && window.NEXO_UPDATER === false) && _lsGet(KEY_ON) !== '0'; }
export function setUpdaterEnabled(on) { _lsSet(KEY_ON, on ? '1' : '0'); console.log('[UPDATER] ' + (on ? 'encendido' : 'apagado') + ' por el usuario'); if (!on) _removeBanner(); else _renderBanner(); _emit(); }
export function updaterAvailable() { if (isStoreBuild()) return null; var a = _json(KEY_AVAIL), me = updaterBuildNum(); return (a && me != null && typeof a.build === 'number' && a.build > me && /^https:\/\//.test(String(a.url || ''))) ? a : null; }
function _gap() { var v = (typeof window !== 'undefined') ? window.NEXO_UPDATER_GAP_MS : undefined; return (typeof v === 'number' && v >= 0) ? v : GAP_MS; }
function _snoozed(a) { var s = _json(KEY_SNOOZE); return !!(s && a && s.build === a.build && typeof s.until === 'number' && Date.now() < s.until); }

// 3105 (dueño 15-11: «donde está el botón de actualizar, lo que se tocó y lo que se actualizó… una breve descripción… para tener ya
// un antecedente para cuando se suba a Google Play»): las NOVEDADES de cada versión son la descripción de su lanzamiento (el workflow
// la toma de NOVEDADES.md), en el formato de Google Play: un bloque por idioma `<es-419>…</es-419>`, `<it-IT>…`, `<en-US>…`. Se
// muestra el del idioma de la app (si falta, el español). Siempre como TEXTO (nunca HTML).
export function updaterNotesText(raw, lang) {
  raw = String(raw || ''); lang = String(lang || 'es').slice(0, 2).toLowerCase();
  var re = /<([a-z]{2})(?:-[A-Za-z0-9]{2,3})?>([\s\S]*?)<\/\1(?:-[A-Za-z0-9]{2,3})?>/g, m, by = {};
  while ((m = re.exec(raw))) if (!by[m[1]]) by[m[1]] = m[2].trim();
  return by[lang] || by.es || by.en || '';
}
function _lang() { try { return getLang(); } catch (e) { return 'es'; } }
/** Novedades de la versión nueva (la que se ofrece) y de la instalada, ya en el idioma de la app; '' si no hay. */
export function updaterNotes() {
  var a = updaterAvailable(), c = _json(KEY_CUR), me = updaterBuildNum();
  return { next: a ? updaterNotesText(a.notes, _lang()) : '', nextBuild: a ? a.build : null,
    current: (c && me != null && c.build === me) ? updaterNotesText(c.notes, _lang()) : '', currentBuild: me };
}

/** Consulta si hay una versión nueva. manual=true: ignora el límite de tiempo y el interruptor. Resuelve {state, build?}:
 *  'newer' | 'current' | 'error' | 'unsupported' | 'skipped'. */
export function updaterCheck(manual) {
  var me = updaterBuildNum(), pl = _plugin();
  if (isStoreBuild() || me == null || !pl || typeof pl.updateCheck !== 'function') return Promise.resolve({ state: 'unsupported' });
  if (!manual && !updaterEnabled()) return Promise.resolve({ state: 'skipped' });
  if (!manual && Date.now() - (parseInt(_lsGet(KEY_LAST), 10) || 0) < _gap()) { _renderBanner(); return Promise.resolve({ state: 'skipped' }); }
  _lsSet(KEY_LAST, String(Date.now()));
  return Promise.resolve(pl.updateCheck({ current: me })).then(function(r) {
    if (r && typeof r.curNotes === 'string' && r.curNotes) _lsSet(KEY_CUR, JSON.stringify({ build: me, notes: r.curNotes.slice(0, 4000) })); // 3105
    if (r && typeof r.build === 'number' && r.build > me && /^https:\/\//.test(String(r.url || ''))) {
      _lsSet(KEY_AVAIL, JSON.stringify({ build: r.build, url: r.url, size: r.size || 0, notes: typeof r.notes === 'string' ? r.notes.slice(0, 4000) : '' }));
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

function _toast(text, kind) { try { _showToast(text, kind || 'info'); } catch (e) {} }
function _stopPoll() { if (_pollT) { clearInterval(_pollT); _pollT = null; } }
function _startPoll() { if (!_pollT) _pollT = setInterval(function() { _refreshState(); }, 4000); }
function _onReady(build) {
  var a = updaterAvailable();
  if (!a || a.build !== build) return;
  var was = _ready === build;
  _ready = build; _busy = false; _pct = -1; _stopPoll(); _renderBanner(); _emit();
  if (!was) { console.log('[UPDATER] la ' + build + ' ya está descargada: lista para instalar'); _toast(t('upd_ready_toast', 'Actualización descargada. Toca «Instalar».'), 'success'); }
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
// 3208 (diagnóstico de Marcos 17-11 14:14, build 3043: «descargando la 3090» y a los 24 s «no se pudo descargar: net» por un corte de
// 3 s de su Wi-Fi; había que volver a tocar «Descargar» y nadie lo hizo): una descarga que se corta por la red se reintenta SOLA, unas
// pocas veces y cada vez más espaciado (si entretanto ya se bajó, se está bajando o ya no hay versión nueva, no hace nada)
var _retryT = null, _retryN = 0;
function _retryLater(build) {
  var waits = (typeof window !== 'undefined' && Array.isArray(window.NEXO_UPD_RETRY_MS)) ? window.NEXO_UPD_RETRY_MS : [20000, 60000, 180000];
  if (_retryN >= waits.length) { _retryN = 0; return false; }
  var ms = waits[_retryN++];
  clearTimeout(_retryT);
  console.log('[UPDATER] se cortó la descarga de la ' + build + ': la reintento sola en ' + Math.round(ms / 1000) + ' s (intento ' + _retryN + ' de ' + waits.length + ')'); // i18n-ok: registro
  _retryT = setTimeout(function() {
    _retryT = null;
    var a = updaterAvailable();
    if (!a || a.build !== build || _ready === build || _busy) return;
    updaterDownload(true);
  }, ms);
  return true;
}
// 25-11 (dueño, diag S23 del 24-11: «bajó e instaló la 3150 a los 3 min de llamada; a los 6 s de reiniciar volvió a llamar»): con una
// llamada en curso (1-a-1 o de grupo, sonando o activa) NO se baja ni se abre el instalador: reiniciar la app la corta. Queda anotado
// qué se quería hacer y se hace solo, unos segundos después de colgar.
var _afterCall = null, _afterT = null;
function _inCall() {
  try {
    var b = window.bleInterface, c = b && b.calls && b.calls.call, g = b && b.gcall && b.gcall.gc;
    return !!((c && c.state !== 'ended') || (g && g.state !== 'ended'));
  } catch (e) { return false; }
}
function _deferForCall(what) {
  if (!_inCall()) return false;
  if (!_afterCall) {
    console.log('[UPDATER] hay una llamada en curso: la ' + (what === 'install' ? 'instalación' : 'descarga') + ' espera a que cuelgues'); // i18n-ok: registro
    _toast(t('upd_wait_call', 'Hay una llamada en curso: la actualización espera a que cuelgues.'));
  }
  if (_afterCall !== 'install') _afterCall = what;
  if (typeof window !== 'undefined' && !_deferForCall._on) {
    _deferForCall._on = true;
    var chk = function() { clearTimeout(_afterT); _afterT = setTimeout(function() { if (_inCall() || !_afterCall) return; var w = _afterCall; _afterCall = null; console.log('[UPDATER] se colgó: sigo con la ' + (w === 'install' ? 'instalación' : 'descarga')); (w === 'install' ? updaterInstall() : updaterDownload(true)); }, 4000); }; // i18n-ok: registro
    window.addEventListener('nexo:call', chk); window.addEventListener('nexo:gcall', chk);
  }
  return true;
}
/** Baja el APK de la versión ofrecida (sin instalar). Sigue aunque se cierre la ventana; al terminar avisa. */
export function updaterDownload(auto) {
  if (_ready !== (updaterAvailable() || {}).build && _deferForCall('download')) return Promise.resolve({ ready: false, reason: 'in_call' });
  if (!auto) { clearTimeout(_retryT); _retryT = null; _retryN = 0; } // tocar «Descargar» empieza la cuenta de reintentos otra vez
  var a = updaterAvailable(), pl = _plugin();
  if (!a || !pl || typeof pl.updateInstall !== 'function') return Promise.resolve({ ready: false, reason: 'unavailable' });
  if (_ready === a.build) return Promise.resolve({ ready: true });
  if (_busy) { _toast(t('upd_busy_toast', 'Ya se está descargando. Te aviso al terminar.')); return Promise.resolve({ downloading: true }); }
  _busy = true; _pct = 0; _dlCall = true; _renderBanner(); _notifyCancel(); _startPoll();
  _toast(t('upd_bg_toast', 'Descargando la actualización. Puedes seguir usando NEXO: te aviso al terminar.'));
  console.log('[UPDATER] descargando la ' + a.build + ' (sigue aunque se cierre la ventana)');
  return Promise.resolve(pl.updateInstall({ url: a.url, build: a.build, mode: 'download' })).then(function(r) {
    _dlCall = false;
    if (r && r.ready) { _onReady(a.build); return r; }
    if (r && r.downloading) return r;                          // ya se estaba bajando: avisa al terminar (evento o consulta)
    _busy = false; _pct = -1; _stopPoll(); _renderBanner();
    console.log('[UPDATER] no se pudo descargar: ' + ((r && r.reason) || 'net'));
    var again = (!r || !r.reason || r.reason === 'net') && _retryLater(a.build); // 3208
    if (!auto || !again) _toast(t('upd_failed', 'No se pudo bajar la actualización. Revisa tu internet y prueba otra vez.'), 'warn');
    return r || { ready: false, reason: 'net' };
  }).catch(function() {
    _dlCall = false; _busy = false; _pct = -1; _stopPoll(); _renderBanner();
    var again = _retryLater(a.build); // 3208
    if (!auto || !again) _toast(t('upd_failed', 'No se pudo bajar la actualización. Revisa tu internet y prueba otra vez.'), 'warn');
    return { ready: false, reason: 'net' };
  });
}

/** «Instalar»: abre el instalador con lo YA bajado. Si aún no está bajado, lo baja (y avisa al terminar; luego «Instalar»). */
export function updaterInstall() {
  var a = updaterAvailable(), pl = _plugin();
  if (!a || !pl || typeof pl.updateInstall !== 'function') return Promise.resolve({ opened: false, reason: 'unavailable' });
  if (_deferForCall('install')) return Promise.resolve({ opened: false, reason: 'in_call' });
  if (_ready !== a.build) return updaterDownload().then(function(r) { return { opened: false, reason: (r && r.ready) ? 'downloaded' : ((r && r.downloading) ? 'downloading' : ((r && r.reason) || 'net')) }; });
  return Promise.resolve(pl.updateInstall({ url: a.url, build: a.build, mode: 'open' })).then(function(r) {
    if (r && r.opened) { console.log('[UPDATER] instalador abierto para la ' + a.build); _notifyCancel(); return r; }
    var why = (r && r.reason) || 'launch';
    console.log('[UPDATER] no se pudo abrir el instalador: ' + why);
    if (why === 'missing') { _ready = 0; _renderBanner(); return updaterDownload().then(function() { return { opened: false, reason: 'missing' }; }); }
    if (why === 'install_permission') _toast(t('upd_need_permission_install', 'Permite a NEXO instalar aplicaciones y vuelve a tocar «Instalar».'), 'warn');
    else _toast(t('upd_failed', 'No se pudo bajar la actualización. Revisa tu internet y prueba otra vez.'), 'warn');
    return r || { opened: false, reason: why };
  }).catch(function() { return { opened: false, reason: 'launch' }; });
}

// 2991 (pedido del dueño): en Perfil → Ajustes el botón es «Buscar ahora» y, cuando hay una versión nueva, pasa a «Instalar actualización (N)»
// (y al tocarlo baja e instala); mientras baja muestra el avance. Se mantiene al día desde aquí (consulta, avance, descarte).
function _installLabel(a) { return t('upd_install_btn', 'Instalar actualización') + ' (' + a.build + ')'; }
function _downloadLabel(a) { return t('upd_update_to', 'Actualizar a la versión') + ' ' + a.build; }
// Lo que muestra Ajustes según el estado (el mismo al dibujarlo y al actualizarlo): { label, status, disabled }
function _settingsView() {
  var a = updaterAvailable(), me = updaterBuildNum();
  if (a && _busy) return { label: t('upd_downloading', 'Descargando…') + (_pct > 0 ? ' ' + _pct + ' %' : ''), status: t('upd_bg_toast', 'Descargando la actualización. Puedes seguir usando NEXO: te aviso al terminar.'), disabled: true };
  if (a && _ready === a.build) return { label: _installLabel(a), status: t('upd_ready_status', 'Descargada: lista para instalar') + ' (' + a.build + ')', disabled: false };
  if (a) return { label: _downloadLabel(a), status: t('upd_new', 'Hay una versión nueva de NEXO') + ' (' + a.build + ')', disabled: false };
  if (_checking) return { label: t('upd_checking', 'Buscando…'), status: t('upd_current', 'Tu versión') + ': ' + (me != null ? me : 'dev'), disabled: true };
  if (_lastCheck === 'current') return { label: t('upd_latest_btn', 'Tienes la última versión'), status: t('upd_uptodate', 'Ya tienes la última') + ' (' + (me != null ? me : 'dev') + ')', disabled: true };
  if (_lastCheck === 'error') return { label: t('upd_retry', 'Volver a intentar'), status: t('upd_error', 'No se pudo consultar. Revisa tu internet.'), disabled: false };
  if (_lastCheck === 'unsupported') return { label: t('upd_check_now', 'Buscar ahora'), status: t('upd_unsupported', 'Esta versión no se actualiza sola.'), disabled: true };
  return { label: t('upd_check_now', 'Buscar ahora'), status: t('upd_current', 'Tu versión') + ': ' + (me != null ? me : 'dev'), disabled: false };
}
// 3105: «Lo nuevo en la versión N» (la que se ofrece, encima del botón) y «Lo nuevo de tu versión» (la instalada)
function _notesBlock(title, text) {
  var d = document.createElement('div');
  d.className = 'nexo-upd-notes';
  d.style.cssText = 'margin:6px 0 10px;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,0.06);';
  var h = document.createElement('div'); h.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:4px;'; h.textContent = title;
  var b = document.createElement('div'); b.style.cssText = 'font-size:13px;line-height:1.45;white-space:pre-wrap;opacity:0.92;'; b.textContent = text;
  d.appendChild(h); d.appendChild(b);
  return d;
}
function _renderNotes() {
  var box = document.getElementById('nexo-updater-notes'); if (!box) return;
  var n = updaterNotes();
  box.innerHTML = '';
  if (n.next) box.appendChild(_notesBlock(t('upd_notes_next', 'Lo nuevo en la versión') + ' ' + n.nextBuild, n.next));
  if (n.current) box.appendChild(_notesBlock(t('upd_notes_current', 'Lo nuevo de tu versión') + ' (' + n.currentBuild + ')', n.current));
}
function _syncSettings() {
  try {
    _renderNotes();
    var btn = document.getElementById('nexo-updater-now'), st = document.getElementById('nexo-updater-status');
    if (!btn) return;
    var v = _settingsView();
    btn.disabled = v.disabled; btn.textContent = v.label;
    if (st) st.textContent = v.status;
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
    Promise.resolve(pl.updateNotify({ build: a.build, size: a.size || 0, notes: updaterNotesText(a.notes, _lang()).slice(0, 1500) })).catch(function() {}); // 3107: con sus novedades
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
      b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:max(16px,env(safe-area-inset-bottom));z-index:9000;padding:12px 14px;border-radius:var(--nx-radius,18px);background:var(--nx-sheet,#0e0f1e);border:1px solid var(--nx-line,rgba(255,255,255,0.08));backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:#fff;font-weight:600;display:flex;align-items:center;gap:10px;box-shadow:0 10px 34px rgba(0,0,0,0.5);';
      document.body.appendChild(b);
    }
    var mb = a.size ? ' (' + Math.max(1, Math.round(a.size / 1048576)) + ' MB)' : '';
    var text = _busy ? (t('upd_downloading', 'Descargando…') + (_pct > 0 ? ' ' + _pct + ' %' : ''))
      : ready ? ('NEXO ' + a.build + ' ' + t('upd_ready', 'descargada'))
      : (t('upd_new', 'Hay una versión nueva de NEXO') + ' (' + a.build + ')' + mb);
    var btnCss = 'background:var(--nx-grad,linear-gradient(135deg,#00c8ff,#a855f7));color:#fff;border:none;border-radius:14px;padding:8px 14px;font-weight:700;box-shadow:0 3px 10px rgba(0,200,255,0.35);';
    var nn = updaterNotesText(a.notes, _lang());
    b.innerHTML = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;"><path d="M12 20V5M6 11l6-6 6 6"/></svg><span style="flex:1;min-width:0;"><span id="nexo-update-text"></span>' +
      (nn ? '<span id="nexo-update-whatsnew" style="display:block;font-size:12px;font-weight:600;text-decoration:underline;opacity:0.95;cursor:pointer;margin-top:2px;"></span>' : '') + '</span>' +
      (_busy ? '' : ready
        ? '<button id="nexo-update-now" style="' + btnCss + '">' + t('upd_install', 'Instalar') + '</button>'   // ya bajada: el único botón es «Instalar»
        : '<button id="nexo-update-now" style="' + btnCss + '">' + t('upd_download', 'Descargar') + '</button>' +
          '<button id="nexo-update-later" style="background:transparent;color:var(--nx-muted,#c9cde0);border:none;padding:8px 6px;">' + t('upd_later', 'Ahora no') + '</button>');
    b.querySelector('#nexo-update-text').textContent = text;
    var wn = b.querySelector('#nexo-update-whatsnew');
    if (wn) { wn.textContent = t('upd_whatsnew', '¿Qué trae?'); wn.onclick = function(e) { e.stopPropagation(); _openNotesSheet(a, nn); }; }
    var now = b.querySelector('#nexo-update-now'), later = b.querySelector('#nexo-update-later');
    if (now) now.onclick = function() { if (ready) updaterInstall(); else updaterDownload(); };
    if (later) later.onclick = function() { _lsSet(KEY_SNOOZE, JSON.stringify({ build: a.build, until: Date.now() + SNOOZE_MS })); _removeBanner(); _notifyCancel(); };
  } catch (e) {}
}

// 3105: hoja con las novedades de la versión nueva y su botón (Descargar / Instalar)
function _openNotesSheet(a, text) {
  try {
    var old = document.getElementById('nexo-update-notes-sheet'); if (old) old.remove();
    var ov = document.createElement('div'); ov.id = 'nexo-update-notes-sheet';
    ov.className = 'nx-chat-sheet'; ov.style.zIndex = '9500'; // B-EST (26-11): la hoja común, con su asa y su título de hoja
    var sh = document.createElement('div');
    sh.className = 'nx-chat-sheet-body nx-sheet-tall';
    var h = document.createElement('div'); h.className = 'nx-sheet-title'; h.textContent = t('upd_notes_next', 'Lo nuevo en la versión') + ' ' + a.build;
    var body = document.createElement('div'); body.className = 'nx-sheet-text nx-sheet-scroll'; body.textContent = text;
    var ready = _ready === a.build;
    var go = document.createElement('button'); go.className = 'nx-btn nx-btn-primary';
    go.textContent = ready ? t('upd_install', 'Instalar') : t('upd_download', 'Descargar');
    go.onclick = function() { ov.remove(); if (ready) updaterInstall(); else if (!_busy) updaterDownload(); };
    var close = document.createElement('button'); close.className = 'nx-btn';
    close.textContent = t('chat_close', 'Cerrar'); close.onclick = function() { ov.remove(); };
    ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
    sh.appendChild(h); sh.appendChild(body); if (!_busy) sh.appendChild(go); sh.appendChild(close);
    ov.appendChild(sh); document.body.appendChild(ov);
  } catch (e) {}
}

/** Arranque (main.js): escucha el avance de la descarga y consulta si toca. */
export function updaterInit() {
  if (isStoreBuild()) return;   // COLA 26: en Google Play no se consulta GitHub, no hay avisos ni banner
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
  if (isStoreBuild()) return '';
  var me = updaterBuildNum();
  return '<div class="nx-sub" style="margin-bottom:8px;">' + t('upd_sub', 'NEXO avisa cuando hay una versión nueva y la baja con un toque. Solo se consulta GitHub (público): no se manda nada tuyo.') + '</div>' +
    '<label class="nx-row" style="display:flex;align-items:center;gap:10px;font-size:14px;"><input type="checkbox" id="nexo-updater-on"' + (updaterEnabled() ? ' checked' : '') + '><span>' + t('upd_auto', 'Buscar versiones nuevas solo') + '</span></label>' +
    '<div class="nx-sub" id="nexo-updater-status" style="margin:6px 0;"></div>' +
    '<div id="nexo-updater-notes"></div>' +
    '<button id="nexo-updater-now" class="nx-btn nx-btn-primary"></button>';
}
export function renderUpdaterSection(sheet) {
  if (!sheet || isStoreBuild()) return;
  var box = sheet.querySelector('#nexo-updater-on'), btn = sheet.querySelector('#nexo-updater-now'), st = sheet.querySelector('#nexo-updater-status');
  if (box) box.onchange = function() { setUpdaterEnabled(box.checked); };
  // 3008: se dibuja con el estado de AHORA (bajando / bajada / por bajar) y se le pregunta al nativo por si cambió con la ventana cerrada
  var check = function() {
    _checking = true; _syncSettings();
    updaterCheck(true).then(function(r) { _checking = false; _lastCheck = r && r.state === 'newer' ? null : (r && r.state); _syncSettings(); });
  };
  _syncSettings(); _refreshState();
  // 3110: al abrir Ajustes se mira sola si hay una nueva (si no hay ya una conocida y no se miró hace nada)
  if (!updaterAvailable() && updaterBuildNum() != null && Date.now() - _settingsAt >= _settingsGap()) { _settingsAt = Date.now(); check(); }
  if (btn) btn.onclick = function() {
    var av = updaterAvailable();
    if (av && _ready === av.build) { updaterInstall(); return; }   // ya bajada: «Instalar actualización (N)»
    if (av) { if (!_busy) updaterDownload(); return; }             // hay una nueva: «Actualizar a la versión N»
    _settingsAt = Date.now(); check();                             // «Volver a intentar» (o sin consulta todavía)
  };
}

// Gancho de pruebas (tests/sim/updater.js)
try { if (typeof window !== 'undefined') window.__nexoUpdater = { notes: updaterNotes, notesText: updaterNotesText, check: updaterCheck, install: updaterInstall, download: updaterDownload, available: updaterAvailable, enabled: updaterEnabled, setEnabled: setUpdaterEnabled, state: function() { return { busy: _busy, ready: _ready, pct: _pct }; } }; } catch (e) {}
