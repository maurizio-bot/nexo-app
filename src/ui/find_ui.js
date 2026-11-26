/**
 * 3345 (dueño 25-11, MODO MULTITUD / EDC: «lo primero en una multitud es buscar a las personas que conoces y poderte reencontrar»).
 * BUSCAR A UN CONTACTO ENTRE LA GENTE, sin internet ni enlace (opciones del chat → «Buscar a …»; en un grupo, «¿Quién del grupo está
 * cerca?»):
 *  - la SEÑAL de su Bluetooth en grande (muy cerca / cerca / lejos / apenas) y si te acercas o te alejas, con un toque al mejorar.
 *    Mientras la pantalla está abierta el escaneo no para (uno largo de 90 s, relanzado cada minuto: dentro del límite de Android);
 *  - «Hacer sonar su teléfono»: le llega un mensaje normal (avisa aunque tenga la app cerrada, por cualquier camino) y, si tiene la app
 *    a la vista, su teléfono vibra y le abre «X te está buscando» con «Buscar a X» y la pantalla de luz;
 *  - «Pantalla de luz»: la pantalla parpadea en colores con tu nombre, para que te vean entre la gente (de noche, en un concierto);
 *  - «Compartir mi ubicación» (para cuando está más lejos de lo que llega el Bluetooth): la mía va cada 8 s, cifrada, solo a él y solo
 *    mientras esta pantalla esté abierta (30 min como mucho); con la suya y la mía se ve la distancia y una flecha hacia él (brújula).
 * Las acciones van ocultas ({type:'nexo_act', act:'fnd', op}) y no se guardan en el chat. Datos y cuentas: find_near.js.
 */
import { t } from './i18n.js';
import { _normId, _getBLEContacts, _hasNativeMethod, _safeNativeCall, _showToast, _getInitials } from './ble_helpers.js';
import { paintAvatar } from './avatar.js';
import { _getAttachmentPlugins } from './ui_bits.js';
import { _sendTextTo } from './send.js';
import { myDisplayName } from './display_name.js';
import { haptic } from './haptics.js';
import { nearInfo, nearList, locNote, locOf, locForget, distM, bearingDeg, bearingWord, distShow } from './find_near.js';

// 26-11 (B0, dueño): «Buscar a X entre la gente» está ESCONDIDO hasta el modo concierto (docs/MODO_CONCIERTO.md). El código sigue; se enciende con
// window.__nexoFindOn = true (las pruebas) o cambiando esto cuando llegue el modo concierto.
export function findOn() { try { return window.__nexoFindOn === true; } catch (e) { return false; } }
export var FIND_SCAN_MS = 90000;        // escaneo largo que pide la pantalla
export var FIND_RESCAN_MS = 60000;      // y se relanza cada minuto (Android degrada un escaneo largo)
export var LOC_EVERY_MS = 8000;         // mi ubicación, cada 8 s como mucho
export var LOC_SHARE_MAX_MS = 30 * 60000;
export var RING_GAP_MS = 20000;         // «hacer sonar» a la misma persona, una vez cada 20 s

var Z = 'z-index:2147483640;';
var BTN = 'display:block;width:100%;max-width:420px;margin:6px auto;padding:14px;border:none;border-radius:14px;font-size:16px;color:#fff;background:rgba(255,255,255,0.10);';
var COLORS = ['#ff7043', '#ffb300', '#00e5ff', '#00e676'];
var _st = null;            // pantalla de buscar abierta
var _ringAt = new Map();   // nx → cuándo le hice sonar
var _rang = new Map();     // nx → cuándo me hizo sonar (si la app no estaba a la vista)
var _peerShareSeen = new Map();

function _bi() { return (typeof window !== 'undefined' && window.bleInterface) || null; }
function _name(nx) {
  var c = _getBLEContacts().find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
  return (c && c.name) || String(nx || '').toUpperCase();
}
function _el(tag, css, txt) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (txt) e.textContent = txt; return e; }
function _btn(label, fn, cls) { var b = _el('button', BTN, label); b.type = 'button'; if (cls) b.className = cls; b.addEventListener('click', function(e) { e.stopPropagation(); fn(); }); return b; }
function _age(ms) { var s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? t('find_age_s', '{n} s').replace('{n}', s) : t('find_age_m', '{n} min').replace('{n}', Math.round(s / 60)); }
function _visible() { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; }

// ─── acciones ocultas ───
function _sendAct(nx, o) {
  var bi = _bi();
  if (!bi || typeof bi.sendChatMessage !== 'function') return Promise.reject(new Error('sin la app'));
  var mid = 'fd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  bi._quietOut = bi._quietOut || new Set(); bi._quietOut.add(mid); // sin aviso en el otro teléfono (es una acción, no un mensaje)
  return bi.sendChatMessage(nx, JSON.stringify(Object.assign({ type: 'nexo_act', act: 'fnd' }, o)), mid);
}

/** Recibido de `sender` (chat_actions._applyChatAction). */
export function findOnAction(sender, act) {
  var nx = _normId(sender);
  if (!nx || !act) return;
  if (act.op === 'loc') {
    if (!locNote(nx, act)) return;
    if (_st && _st.nx === nx) { _geoStart(); _paint(); return; }
    var last = _peerShareSeen.get(nx) || 0;
    _peerShareSeen.set(nx, Date.now());
    if (_visible() && Date.now() - last > 5 * 60000) _showToast(t('find_peer_sharing', '📍 {name} comparte su ubicación contigo para encontrarse. Toca su foto en el chat → «Buscar».').replace('{name}', _name(nx)), 'info');
    return;
  }
  if (act.op === 'loc_off') { locForget(nx); _peerShareSeen.delete(nx); if (_st && _st.nx === nx) _paint(); return; }
  if (act.op === 'ring') {
    if (Date.now() - (Number(act.ts) || Date.now()) > 5 * 60000) return; // un aviso viejo (llegó tarde por otro camino) ya no suena
    if (_visible()) _rangShow(nx); else _rang.set(nx, Date.now());
  }
}

// Al volver a la app: si alguien me hizo sonar hace menos de 3 min, se le muestra
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function() {
  if (!_visible()) return;
  _rang.forEach(function(at, nx) { _rang.delete(nx); if (Date.now() - at < 3 * 60000) _rangShow(nx); });
});

function _rangShow(nx) {
  var old = document.getElementById('nexo-find-rang'); if (old) old.remove();
  var nm = _name(nx);
  var ov = _el('div', 'position:fixed;inset:0;' + Z + 'background:rgba(0,0,0,0.82);color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:stretch;padding:24px;box-sizing:border-box;text-align:center;');
  ov.id = 'nexo-find-rang';
  ov.appendChild(_el('div', 'font-size:56px;margin-bottom:8px;', '📡'));
  ov.appendChild(_el('div', 'font-size:22px;font-weight:700;margin-bottom:6px;', t('find_rang_title', '{name} te está buscando').replace('{name}', nm)));
  ov.appendChild(_el('div', 'font-size:15px;opacity:0.8;margin-bottom:18px;', t('find_rang_sub', 'Está cerca de ti entre la gente.')));
  ov.appendChild(_btn(t('find_rang_go', 'Buscar a {name}').replace('{name}', nm), function() { ov.remove(); openFind(nx); }, 'find-rang-go'));
  ov.appendChild(_btn('💡 ' + t('find_light', 'Pantalla de luz'), function() { ov.remove(); openLight(); }, 'find-rang-light'));
  ov.appendChild(_btn(t('find_close', 'Cerrar'), function() { ov.remove(); }, 'find-rang-close'));
  document.body.appendChild(ov);
  try { if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 700]); } catch (e) {}
}

/** «Hacer sonar su teléfono»: un mensaje normal (llega y avisa por cualquier camino, aunque tenga la app cerrada) + la acción oculta. */
export function findRing(nx) {
  nx = _normId(nx);
  var now = Date.now();
  if (now - (_ringAt.get(nx) || 0) < RING_GAP_MS) { _showToast(t('find_ring_wait', 'Ya le avisaste: espera unos segundos.'), 'info'); return false; }
  _ringAt.set(nx, now);
  var txt = t('find_ring_msg', '📡 Te estoy buscando: estoy cerca. Toca mi foto en este chat → «Buscar» para encontrarme.');
  _sendTextTo(nx, txt, txt, false);
  _sendAct(nx, { op: 'ring', ts: now }).catch(function() {});
  haptic('confirm');
  _showToast(t('find_ring_sent', 'Le avisé: su teléfono vibra y le dice que lo buscas.'), 'info');
  return true;
}

// ─── pantalla de luz ───
export function openLight() {
  var old = document.getElementById('nexo-find-light'); if (old) old.remove();
  var ov = _el('div', 'position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:#000;transition:background 0.15s;');
  ov.id = 'nexo-find-light';
  ov.appendChild(_el('div', 'font-size:44px;font-weight:800;padding:0 16px;word-break:break-word;', myDisplayName() || 'NEXO'));
  ov.appendChild(_el('div', 'font-size:14px;margin-top:12px;opacity:0.7;padding:0 24px;', t('find_light_hint', 'Levanta el teléfono para que te vean. Toca para cerrar.')));
  var cs = ['#ffffff', '#00e5ff', '#ff2bd6', '#ffe600'], i = 0;
  ov.style.background = cs[0];
  var tm = setInterval(function() { if (!ov.isConnected) { clearInterval(tm); return; } i = (i + 1) % cs.length; ov.style.background = cs[i]; }, 450);
  ov.addEventListener('click', function() { clearInterval(tm); ov.remove(); });
  document.body.appendChild(ov);
  return ov;
}

// ─── escaneo sin parar mientras se busca (pantalla de un contacto o lista del grupo) ───
var _sc = { want: 0, mine: false, at: 0, tryAt: 0, timer: null };
function _scanTick() {
  var bi = _bi();
  if (!_sc.want || !bi || !bi.nativePlugin || !_hasNativeMethod(bi.nativePlugin, 'startScan')) return;
  if ((bi._btIsOff && bi._btIsOff()) || bi._cameraBlePaused || bi._scanUnsupported) return;
  var now = Date.now();
  if (_sc.mine && now - _sc.at < FIND_RESCAN_MS) { if (!bi.isScanning) bi.isScanning = true; return; } // el mío sigue (aunque otro temporizador lo diera por parado)
  if (now - _sc.tryAt < 5000) return;
  if (now < (bi._scanBlockedUntil || 0) || (bi._scanWindowFull && bi._scanWindowFull())) return; // límite de Android: espera su hueco
  _sc.tryAt = now;
  var start = function() {
    if (!_sc.want) return;
    if (bi._noteScanStart) bi._noteScanStart();
    _safeNativeCall(bi.nativePlugin, 'startScan', { filtered: true, durationMs: FIND_SCAN_MS }).then(function() {
      if (!_sc.want) { _safeNativeCall(bi.nativePlugin, 'stopScan', {}).catch(function() {}); return; }
      _sc.mine = true; _sc.at = Date.now();
      bi.isScanning = true; bi._autoScanActive = false;
      if (typeof bi.updateScanButton === 'function') bi.updateScanButton();
    }).catch(function(e) { console.warn('[FIND] No se pudo buscar por Bluetooth: ' + (e && e.message)); });
  };
  if (bi.isScanning && _hasNativeMethod(bi.nativePlugin, 'stopScan')) _safeNativeCall(bi.nativePlugin, 'stopScan', {}).then(start, start);
  else start();
}
// el nativo paró el escaneo por su cuenta (se acabó su tiempo): el siguiente repaso lo relanza
if (typeof window !== 'undefined') window.NEXO_findScanStopped = function() { if (_sc.mine) { _sc.mine = false; _sc.tryAt = 0; } };
function _scanHold() {
  _sc.want++;
  if (!_sc.timer) _sc.timer = setInterval(_scanTick, 1000);
  _scanTick();
}
function _scanRelease() {
  if (_sc.want > 0) _sc.want--;
  if (_sc.want) return;
  clearInterval(_sc.timer); _sc.timer = null;
  var bi = _bi(), was = _sc.mine;
  _sc.mine = false; _sc.at = 0;
  if (!was || !bi || !bi.nativePlugin) return;
  if (_hasNativeMethod(bi.nativePlugin, 'stopScan')) _safeNativeCall(bi.nativePlugin, 'stopScan', {}).catch(function() {});
  bi.isScanning = false;
  if (typeof bi.updateScanButton === 'function') bi.updateScanButton();
}

// ─── mi ubicación (solo con la pantalla abierta y si hace falta: compartir o ver la distancia a la suya) ───
function _geoStart() {
  var st = _st;
  if (!st || st.geo) return;
  st.geo = 'arrancando';
  var G = _getAttachmentPlugins().Geolocation;
  var onPos = function(pos) {
    if (_st !== st || !pos || !pos.coords) return;
    st.me = { la: pos.coords.latitude, lo: pos.coords.longitude, ac: pos.coords.accuracy || 0, ts: Date.now() };
    st.geoErr = '';
    _locSend(); _paint();
  };
  var onErr = function(e) { if (_st !== st) return; st.geoErr = /denied|permission|permiso/i.test((e && e.message) || '') ? 'perm' : 'gps'; _paint(); };
  if (G && typeof G.watchPosition === 'function') {
    var ask = (typeof G.checkPermissions === 'function' && typeof G.requestPermissions === 'function')
      ? G.checkPermissions().then(function(p) { return (p.location === 'granted' || p.coarseLocation === 'granted') ? p : G.requestPermissions(); })
        .then(function(p) { if (p.location !== 'granted' && p.coarseLocation !== 'granted') throw new Error('permiso denegado'); })
      : Promise.resolve();
    ask.then(function() {
      return G.watchPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }, function(pos, err) { if (err) onErr(err); else onPos(pos); });
    }).then(function(id) {
      if (_st !== st) { try { G.clearWatch({ id: id }); } catch (e) {} return; }
      st.geo = { cap: id };
    }).catch(function(e) { if (_st === st) { st.geo = null; onErr(e); } });
  } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
    st.geo = { web: navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }) };
  } else { st.geo = null; st.geoErr = 'gps'; }
}
function _geoStop(st) {
  var g = st.geo; st.geo = null;
  if (!g || typeof g !== 'object') return;
  try {
    if (g.cap !== undefined) { var G = _getAttachmentPlugins().Geolocation; if (G && G.clearWatch) G.clearWatch({ id: g.cap }); }
    if (g.web !== undefined && navigator.geolocation) navigator.geolocation.clearWatch(g.web);
  } catch (e) {}
}
function _locSend() {
  var st = _st;
  if (!st || !st.share || !st.me) return;
  var now = Date.now();
  if (now > st.shareUntil) { _shareSet(false); return; }
  if (now - (st.locSentAt || 0) < LOC_EVERY_MS) return;
  if (st.locBusy && now - st.locBusy < 120000) return; // la anterior aún no salió (sin camino ahora): no se amontonan
  st.locSentAt = now; st.locBusy = now;
  var done = function() { if (st.locBusy === now) st.locBusy = 0; };
  _sendAct(st.nx, { op: 'loc', la: Math.round(st.me.la * 1e6) / 1e6, lo: Math.round(st.me.lo * 1e6) / 1e6, ac: Math.round(st.me.ac), ts: st.me.ts }).then(done, done);
}
function _shareSet(on) {
  var st = _st;
  if (!st) return;
  if (!on && st.share) _sendAct(st.nx, { op: 'loc_off', ts: Date.now() }).catch(function() {});
  st.share = !!on;
  st.shareUntil = on ? Date.now() + LOC_SHARE_MAX_MS : 0;
  if (on) { st.locSentAt = 0; _geoStart(); _locSend(); }
  _paint();
}

// ─── brújula ───
function _onOrient(e) {
  if (!_st || !e) return;
  var h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
  if (h === null || !isFinite(h)) return;
  var so = (typeof screen !== 'undefined' && screen.orientation && screen.orientation.angle) || 0;
  _st.heading = ((h + so) % 360 + 360) % 360; _st.headingAt = Date.now();
}

// ─── la pantalla ───
/** Abre «Buscar a …» para el contacto `nx`. */
export function openFind(nx, name) {
  nx = _normId(nx);
  if (!/^nx[0-9a-z]{8}$/.test(nx)) return null;
  closeFind();
  var nm = name || _name(nx);
  var ov = _el('div', 'position:fixed;inset:0;' + Z + 'background:var(--nx-bg,#0b0c1a);color:#fff;display:flex;flex-direction:column;align-items:stretch;padding:16px;box-sizing:border-box;overflow-y:auto;text-align:center;');
  ov.id = 'nexo-find';
  var head = _el('div', 'display:flex;align-items:center;gap:12px;text-align:left;margin-bottom:8px;');
  var av = _el('div', 'width:44px;height:44px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.12);font-weight:700;overflow:hidden;');
  var avs = _el('span', '', _getInitials(nm)); av.appendChild(avs);
  try { paintAvatar(av, nx, avs); } catch (e) {}
  head.appendChild(av);
  head.appendChild(_el('div', 'flex:1;min-width:0;font-size:18px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', t('find_title', 'Buscar a {name}').replace('{name}', nm)));
  var x = _btn('✕', closeFind, 'find-close'); x.style.cssText = 'width:40px;height:40px;border:none;border-radius:50%;background:rgba(255,255,255,0.10);color:#fff;font-size:18px;flex:none;';
  x.setAttribute('aria-label', t('find_close', 'Cerrar'));
  head.appendChild(x); ov.appendChild(head);
  var viz = _el('div', 'position:relative;width:min(64vw,260px);height:min(64vw,260px);margin:18px auto 10px;display:flex;align-items:center;justify-content:center;');
  var dot = _el('div', 'border-radius:50%;transition:all 0.6s ease;'); dot.className = 'find-dot';
  var arrow = _el('div', 'position:absolute;inset:0;display:none;align-items:flex-start;justify-content:center;font-size:40px;transition:transform 0.4s ease;', '▲'); arrow.className = 'find-arrow';
  viz.appendChild(dot); viz.appendChild(arrow); ov.appendChild(viz);
  var lv = _el('div', 'font-size:24px;font-weight:700;min-height:30px;'); lv.className = 'find-level'; ov.appendChild(lv);
  var tr = _el('div', 'font-size:16px;min-height:22px;margin-top:4px;'); tr.className = 'find-trend'; ov.appendChild(tr);
  var geo = _el('div', 'font-size:15px;min-height:20px;margin:10px 0 4px;opacity:0.9;'); geo.className = 'find-geo'; ov.appendChild(geo);
  var hint = _el('div', 'font-size:13px;opacity:0.65;margin:4px 8px 12px;', t('find_hint', 'Camina despacio y mira si sube. La gente y el cuerpo tapan la señal: gira despacio sobre ti.')); ov.appendChild(hint);
  ov.appendChild(_btn('📳 ' + t('find_ring', 'Hacer sonar su teléfono'), function() { findRing(nx); }, 'find-ring'));
  var sh = _btn('', function() { _shareSet(!(_st && _st.share)); }, 'find-share'); ov.appendChild(sh);
  var shn = _el('div', 'font-size:12px;opacity:0.7;margin:0 8px 6px;'); shn.className = 'find-share-note'; ov.appendChild(shn);
  ov.appendChild(_btn('💡 ' + t('find_light', 'Pantalla de luz'), openLight, 'find-light'));
  document.body.appendChild(ov);
  _st = { nx: nx, name: nm, el: ov, dot: dot, arrow: arrow, lv: lv, tr: tr, geo: null, geoEl: geo, sh: sh, shn: shn, lastLevel: -1, share: false, shareUntil: 0 };
  if (typeof window !== 'undefined') { window.addEventListener('deviceorientationabsolute', _onOrient); window.addEventListener('deviceorientation', _onOrient); }
  if (locOf(nx)) _geoStart();
  _st.timer = setInterval(function() { _locSend(); _paint(); }, 1000);
  _scanHold(); _paint();
  console.log('[FIND] Buscar a ' + nx + ' abierto');
  return ov;
}

export function closeFind() {
  var st = _st;
  if (!st) return;
  if (st.share) _shareSet(false);
  _st = null;
  clearInterval(st.timer);
  _geoStop(st); _scanRelease();
  if (typeof window !== 'undefined') { window.removeEventListener('deviceorientationabsolute', _onOrient); window.removeEventListener('deviceorientation', _onOrient); }
  if (st.el && st.el.parentNode) st.el.remove();
  console.log('[FIND] Buscar a ' + st.nx + ' cerrado');
}

function _paint() {
  var st = _st;
  if (!st) return;
  var now = Date.now(), i = nearInfo(st.nx, now), nm = st.name;
  var lvTxt = [t('find_lv0', 'Muy lejos: la señal apenas llega'), t('find_lv1', 'Lejos'), t('find_lv2', 'Cerca'), t('find_lv3', 'Muy cerca: a unos pasos')];
  var size = i.level < 0 ? 22 : 34 + i.level * 22;
  st.dot.style.width = st.dot.style.height = size + '%';
  st.dot.style.background = i.level < 0 ? 'rgba(255,255,255,0.12)' : COLORS[i.level];
  st.dot.style.boxShadow = i.level < 0 ? 'none' : '0 0 ' + (12 + i.level * 14) + 'px ' + COLORS[i.level];
  st.lv.textContent = i.level >= 0 ? lvTxt[i.level] : i.lastAt ? t('find_lost', 'Dejé de verlo hace {s}').replace('{s}', _age(now - i.lastAt)) : t('find_none', 'No lo veo por Bluetooth');
  st.lv.dataset.level = String(i.level);
  st.tr.textContent = i.trend > 0 ? t('find_up', 'Te estás acercando ▲') : i.trend < 0 ? t('find_down', 'Te estás alejando ▼') : '';
  if (i.level > st.lastLevel && st.lastLevel >= 0) haptic('confirm'); // mejoró: un toque
  st.lastLevel = i.level;
  // su ubicación (si la comparte) y la mía
  var rl = locOf(st.nx, now), g = '', showArrow = false;
  if (rl && st.me) {
    var ds = distShow(distM(st.me, rl), st.me.ac, rl.ac);
    if (ds.close) g = t('find_geo_close', 'Los GPS dicen que están muy cerca: sigue la señal de Bluetooth.');
    else {
      var b = bearingDeg(st.me, rl), w = bearingWord(b);
      g = t('find_geo', 'A unos {d} hacia el {dir}').replace('{d}', ds.txt).replace('{dir}', t(w[0], w[1]));
      var compass = st.headingAt && now - st.headingAt < 3000;
      st.arrow.style.transform = 'rotate(' + Math.round(compass ? b - st.heading : b) + 'deg)';
      showArrow = true;
      if (!compass) g += ' · ' + t('find_arrow_north', 'flecha con el norte arriba');
    }
    if (now - rl.ts > 30000) g += ' · ' + t('find_geo_age', 'su ubicación de hace {s}').replace('{s}', _age(now - rl.ts));
  } else if (rl) g = st.geoErr === 'perm' ? t('find_geo_noperm', 'Activa la ubicación del teléfono para ver a qué distancia está.') : t('find_geo_wait', 'Buscando tu ubicación para ver la distancia…');
  else if (i.level < 1) g = t('find_geo_ask', 'Si está más lejos de lo que llega el Bluetooth, compartan su ubicación para ver distancia y dirección.');
  st.geoEl.textContent = g;
  st.arrow.style.display = showArrow ? 'flex' : 'none';
  st.sh.textContent = '📍 ' + (st.share ? t('find_share_off', 'Dejar de compartir mi ubicación') : t('find_share_on', 'Compartir mi ubicación'));
  st.shn.textContent = st.share ? (st.geoErr === 'perm' ? t('find_geo_noperm', 'Activa la ubicación del teléfono para ver a qué distancia está.') : t('find_share_note', 'Compartes tu ubicación con {name} mientras esta pantalla esté abierta (30 min como mucho).').replace('{name}', nm)) : '';
}

/** ¿Quién del grupo está cerca? Lista de los miembros que son mis contactos, del más cercano al más lejano; tocar uno lo busca. */
export function openFindGroup(gid, members, title) {
  var old = document.getElementById('nexo-find-group'); if (old) old.remove();
  var mine = {}; _getBLEContacts().forEach(function(c) { mine[_normId(c.nexoId || c.deviceUUID)] = c.name || ''; });
  var ids = (members || []).map(_normId).filter(function(nx) { return nx in mine; });
  var ov = _el('div', 'position:fixed;inset:0;' + Z + 'background:var(--nx-bg,#0b0c1a);color:#fff;display:flex;flex-direction:column;padding:16px;box-sizing:border-box;');
  ov.id = 'nexo-find-group';
  var head = _el('div', 'display:flex;align-items:center;gap:12px;margin-bottom:8px;');
  head.appendChild(_el('div', 'flex:1;font-size:18px;font-weight:700;', t('find_grp_title', 'Cerca de ti en {name}').replace('{name}', title || '')));
  var shut = function() { if (!ov._nxOpen) return; ov._nxOpen = false; clearInterval(tm); ov.remove(); _scanRelease(); };
  var x = _btn('✕', shut, 'find-close'); x.style.cssText = 'width:40px;height:40px;border:none;border-radius:50%;background:rgba(255,255,255,0.10);color:#fff;font-size:18px;';
  head.appendChild(x); ov.appendChild(head);
  ov.appendChild(_el('div', 'font-size:13px;opacity:0.65;margin-bottom:8px;', t('find_grp_hint', 'Toca a alguien para buscarlo.')));
  var list = _el('div', 'flex:1;overflow-y:auto;'); ov.appendChild(list);
  var lvTxt = [t('find_lv0', 'Muy lejos: la señal apenas llega'), t('find_lv1', 'Lejos'), t('find_lv2', 'Cerca'), t('find_lv3', 'Muy cerca: a unos pasos')];
  var row = function(nx, sub, color) {
    var r = _btn('', function() { openFind(nx, mine[nx]); shut(); }, 'find-grp-row');
    r.style.cssText = 'display:flex;align-items:center;gap:12px;width:100%;padding:12px 4px;border:none;border-bottom:1px solid rgba(255,255,255,0.08);background:none;color:#fff;text-align:left;font-size:16px;';
    r.dataset.nx = nx;
    r.appendChild(_el('span', 'width:14px;height:14px;border-radius:50%;flex:none;background:' + color + ';'));
    var tx = _el('span', 'flex:1;min-width:0;'); tx.appendChild(_el('div', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;', mine[nx] || nx.toUpperCase()));
    tx.appendChild(_el('div', 'font-size:12px;opacity:0.7;', sub)); r.appendChild(tx);
    return r;
  };
  var draw = function() {
    if (!ov.isConnected) { shut(); return; }
    list.innerHTML = '';
    var near = nearList(ids), seen = {};
    if (!near.length) list.appendChild(_el('div', 'opacity:0.7;padding:12px 4px;', t('find_grp_none', 'No veo cerca a nadie del grupo por Bluetooth.')));
    near.forEach(function(i) { seen[i.nx] = 1; list.appendChild(row(i.nx, lvTxt[i.level], COLORS[i.level])); });
    var far = ids.filter(function(nx) { return !seen[nx]; });
    if (far.length) list.appendChild(_el('div', 'font-size:13px;opacity:0.6;margin:14px 4px 4px;', t('find_grp_far', 'No los veo cerca')));
    far.forEach(function(nx) { list.appendChild(row(nx, locOf(nx) ? t('find_grp_loc', 'Comparte su ubicación') : '', 'rgba(255,255,255,0.15)')); });
  };
  var tm = setInterval(draw, 1500);
  ov._nxOpen = true;
  document.body.appendChild(ov);
  _scanHold();
  draw();
  return ov;
}

/** [pruebas] estado de la pantalla abierta */
export function _findState() { return _st; }
