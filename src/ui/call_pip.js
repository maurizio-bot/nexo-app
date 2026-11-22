/**
 * call_pip.js (3277, dueño 22-11: «al pasar varias veces de pantalla normal a miniatura, que ya no haya problemas»; «al abrir la app
 * aparecía el chat y la miniatura, pero la miniatura ya no respondía»; capturas: la ventanita del sistema enseñando el chat apretado).
 *
 * LA MINIATURA DE LA VIDEOLLAMADA, A PRUEBA DE AVISOS PERDIDOS. Hasta hoy todo colgaba de UN aviso de Android por cada cambio
 * (MainActivity.onPictureInPictureModeChanged → window.__nexoPipChanged): si uno no llegaba, llegaba tarde o la app se había rehecho
 * por debajo, la pantalla se quedaba con las marcas de la vez anterior (la ventanita con el chat apretado, la app sin botones, la mini
 * flotante sin abrir). Ahora el estado sale de la VERDAD y se puede aplicar las veces que haga falta sin romper nada:
 *   - pipApply(on) deja TODAS las marcas como tocan (html.nx-pip, nc-pipwin, nc-appmini, la barra de la llamada minimizada); repetirlo
 *     no cambia nada; la mini flotante solo se pone en el paso miniatura → app, con la videollamada en curso;
 *   - pipSync() le pregunta al nativo si de verdad está en miniatura (pipState) al cambiar el tamaño de la ventana, al volver a verse,
 *     tras cada aviso y, mientras dura la miniatura, cada 2,5 s; si un aviso llega mientras se pregunta, manda el aviso;
 *   - en la miniatura del sistema los toques NO llegan a la app: si llega uno con la miniatura marcada, ya no lo está (se corrige ya);
 *   - en miniatura SIN llamada que enseñar (la app se rehízo, la llamada terminó): se le dice al nativo que la cierre, en vez de dejar
 *     el chat apretado en la ventanita;
 *   - la mini flotante se abre por la POSICIÓN del toque aunque el clic no llegue a la pantalla de la llamada.
 * Cada paso queda en el registro ([CALL] Miniatura…) y lo raro manda un diagnóstico automático («miniatura»).
 *
 * 3282 (dueño 22-11: «si estoy en un chat y deslizo hacia arriba, en lugar de quedarse en segundo plano aplica lo que aplicaría en una
 * videollamada y crea la miniatura… que no haya conflicto entre si hay o no videollamada con lo que hace el gesto»). Lo que decide el
 * gesto es UNA marca del teléfono («al irse, pasar a miniatura»), que la llamada ponía y quitaba con avisos sueltos (al activarse, al
 * pasar a vídeo, al colgar): bastaba que uno llegara tarde, o que la marca se pusiera sin llamada viva, para que quedara puesta y el
 * gesto metiera el chat en la ventanita. Ahora la marca dice SIEMPRE la verdad: pipWanted() = «hay una videollamada viva AHORA» (la
 * 1-a-1 activa con vídeo, o la de grupo ya empezada con vídeo); en cada cambio de cualquier llamada, al volver a verse y al arrancar
 * se compara con lo que tiene el teléfono y se corrige en los DOS sentidos (se quita si sobra, se pone si falta). Una llamada de voz
 * nunca la deja puesta. El teléfono, además, la quita solo al terminar el audio de la llamada y no entra en miniatura sin llamada.
 * calls_ui.js lo arranca con initCallPip({ calls, syncSplit, autoHide }).
 */
import { restoreCall } from './call_bar.js';

var _on = false, _gen = 0, _syncT = null, _poll = null, _deps = {}, _down = null, _ready = false, _saidAt = 0;

function _plug() { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; } catch (e) { return null; } }
function _one() { return document.getElementById('nexo-call-screen'); }
function _st() { try { var c = _deps.calls && _deps.calls(); return (c && c.state && c.state()) || null; } catch (e) { return null; } }
// ¿Hay una llamada que enseñar en la ventanita? (la 1-a-1 viva, la de grupo o la segunda)
function _showable() {
  var st = _st(), el = _one();
  if (st && st.state !== 'ended' && el && !el.classList.contains('nc-gone')) return true; // i18n-ok: código
  return !!(document.getElementById('nexo-gcall-screen') || document.getElementById('nexo-call2-screen'));
}
function _liveVideo() { var st = _st(); return !!(st && st.video && st.state === 'active'); }
function _gc() { try { var b = window.bleInterface; return (b && b.gcall && b.gcall.gc) || null; } catch (e) { return null; } }
/** 3282: ¿hay AHORA una videollamada viva? Es lo único que decide si el gesto de irse de la app pasa a la miniatura. */
export function pipWanted() {
  if (_liveVideo()) return true;
  var g = _gc();
  return !!(g && g.startedAt && g.state !== 'ended' && (g.video || g.cameraOn)); // i18n-ok: código
}
function _what() { var st = _st(); return st ? (st.video ? 'videollamada ' : 'llamada de voz ') + st.state : document.getElementById('nexo-gcall-screen') ? 'llamada de grupo' : 'sin llamada'; } // i18n-ok: registro
function _odd(info) { var now = Date.now(); if (now - _saidAt < 60000) return; _saidAt = now; try { window.dispatchEvent(new CustomEvent('nexo:diag:symptom', { detail: { kind: 'miniatura', info: info } })); } catch (e) {} }

function _noCall(why) {
  console.warn('[CALL] Miniatura del sistema sin llamada que enseñar (' + why + '): se cierra'); // i18n-ok: registro
  var p = _plug();
  try { if (p && typeof p.setPipActive === 'function') p.setPipActive({ on: false }); } catch (e) {}
}

/** ¿Está la app en la miniatura del sistema? (lo último aplicado) */
export function pipOn() { return _on; }

/** Deja todas las marcas como tocan para «en miniatura» / «a pantalla normal». Se puede repetir sin efectos. */
export function pipApply(on, why) {
  on = !!on;
  var was = _on, root = document.documentElement, el = _one();
  _on = on;
  root.classList.toggle('nx-pip', on); // también la de grupo (gcall_stage) y la barra (call_bar)
  if (on) {
    restoreCall(); // la ventanita enseña la llamada, no la app con la barra
    if (el) { el.classList.add('nc-pipwin'); el.classList.remove('nc-appmini'); }
    if (!_poll) _poll = setInterval(function() { pipSync('repaso', 0); }, 2500);
    if (!_showable()) { _noCall(why); if (!was) _odd('en miniatura sin llamada'); }
  } else {
    clearInterval(_poll); _poll = null;
    if (el) {
      el.classList.remove('nc-pipwin');
      // (b) del 04-11: al VOLVER de la miniatura, la videollamada queda como mini flotante y debajo se usa la app
      if (was && _liveVideo()) el.classList.add('nc-appmini');
    }
  }
  try { if (_deps.syncSplit) _deps.syncSplit(); } catch (e) {}
  if (was !== on) console.log('[CALL] Miniatura del sistema: ' + (on ? 'entra' : 'sale') + ' (' + why + '), ' + _what() + ', ventana ' + window.innerWidth + '×' + window.innerHeight + (!on && el && el.classList.contains('nc-appmini') ? ', queda la mini flotante' : '')); // i18n-ok: registro
}

/** Pregunta al nativo la verdad y corrige lo que no cuadre. */
export function pipSync(why, delay) {
  clearTimeout(_syncT);
  _syncT = setTimeout(function() {
    var p = _plug(), g = _gen, q;
    if (!p || typeof p.pipState !== 'function') return;
    try { q = p.pipState(); } catch (e) { return; }
    Promise.resolve(q).then(function(r) {
      if (!r || typeof r.pip !== 'boolean' || g !== _gen) return; // llegó un aviso mientras se preguntaba: manda el aviso
      if (r.pip !== _on) {
        console.warn('[CALL] Miniatura del sistema: el aviso de Android no llegó (' + why + '): en realidad ' + (r.pip ? 'SÍ' : 'NO') + ' está en miniatura; se corrige'); // i18n-ok: registro
        _odd('aviso perdido: ' + (r.pip ? 'entrar' : 'salir'));
      }
      pipApply(r.pip, why);
      // 3282: la marca «pasar a miniatura al irse» tiene que decir la verdad. Puesta sin videollamada viva (quedó de antes, llegó un
      // aviso tarde, hay solo una llamada de voz): fuera, o el gesto de irse metería el chat en la ventanita. Y si falta con la
      // videollamada viva (el teléfono la quitó al ponerla en espera), se vuelve a poner.
      var want = pipWanted();
      if (!r.pip && typeof r.wanted === 'boolean' && r.wanted !== want) {
        console.warn('[CALL] Miniatura: la marca «al irse, pasar a miniatura» estaba ' + (r.wanted ? 'PUESTA sin videollamada viva' : 'QUITADA con la videollamada viva') + ' (' + why + ', ' + _what() + '): se corrige'); // i18n-ok: registro
        if (r.wanted) _odd('marca de miniatura sin videollamada'); // i18n-ok: diagnóstico
        var p2 = _plug();
        try { if (p2 && typeof p2.setPipActive === 'function') p2.setPipActive({ on: want }); } catch (e) {}
      }
    }).catch(function() {});
  }, delay == null ? 300 : delay);
}

/** La mini flotante vuelve a pantalla completa (con sus botones a la vista). */
export function miniOpen(el, why) {
  el = el || _one();
  if (!el || !el.classList.contains('nc-appmini')) return false;
  el.classList.remove('nc-appmini', 'nc-hide', 'nc-pipwin');
  try { if (_deps.autoHide) _deps.autoHide(el); } catch (e) {}
  try { if (_deps.syncSplit) _deps.syncSplit(); } catch (e) {}
  console.log('[CALL] Mini flotante: pantalla completa (' + (why || 'toque') + ')'); // i18n-ok: registro
  return true;
}

export function initCallPip(deps) {
  _deps = deps || {};
  if (_ready || typeof window === 'undefined' || typeof document === 'undefined') return;
  _ready = true;
  // El aviso de Android (MainActivity). Después se confirma con el nativo, por si llegó desordenado
  window.__nexoPipChanged = function(active) {
    _gen++;
    try { pipApply(!!active, 'aviso de Android'); } catch (e) {}
    pipSync('confirmación', 700);
  };
  window.addEventListener('resize', function() { pipSync('cambio de tamaño'); });
  window.addEventListener('focus', function() { pipSync('foco'); });
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'visible') pipSync('vuelve a verse'); });
  // En la miniatura del sistema los toques no llegan a la app: un toque con la miniatura marcada = ya no está en miniatura
  document.addEventListener('pointerdown', function(e) {
    _down = { x: e.clientX, y: e.clientY, at: Date.now() };
    if (e.isTrusted === false) return; // (los toques de las pruebas no cuentan como verdad)
    if (!_on && !document.documentElement.classList.contains('nx-pip')) return;
    _gen++;
    console.warn('[CALL] Toque con la miniatura del sistema marcada: ya no está en miniatura; se corrige'); // i18n-ok: registro
    _odd('aviso perdido: salir (toque)');
    pipApply(false, 'toque');
  }, true);
  // La mini flotante se abre por la posición del toque, aunque el clic no llegue a la pantalla de la llamada
  document.addEventListener('pointerup', function(e) {
    var el = _one(), d = _down; _down = null;
    if (!el || !d || !el.classList.contains('nc-appmini')) return;
    var r = el.getBoundingClientRect(), inside = function(x, y) { return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
    if (!inside(e.clientX, e.clientY) || !inside(d.x, d.y) || Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 16 || Date.now() - d.at > 700) return;
    setTimeout(function() { if (el.isConnected && el.classList.contains('nc-appmini')) miniOpen(el, 'toque que no llegó a la pantalla de la llamada'); }, 350); // i18n-ok: registro
  }, true);
  // 3282: cada cambio de una llamada (empieza, pasa a vídeo, en espera, termina; también la de grupo) → la marca al día. Una sola
  // pregunta al teléfono por tanda de avisos (si ya hay una en camino no se aplaza: los avisos seguidos no la dejan sin hacer)
  var markT = null;
  var markSoon = function() { if (markT) return; markT = setTimeout(function() { markT = null; pipSync('cambio en la llamada', 0); }, 400); };
  window.addEventListener('nexo:call', markSoon);
  window.addEventListener('nexo:gcall', markSoon);
  // Al arrancar la app no hay llamada: si el nativo aún cree que sí (la app se rehízo por debajo), se le quita
  setTimeout(function() { pipSync('arranque', 0); }, 4000);
}
