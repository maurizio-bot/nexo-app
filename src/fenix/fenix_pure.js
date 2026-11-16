/**
 * NEXO Fénix — funciones puras (sin estado ni radio), separadas de fenix.js para que no pase de 1000 líneas (3146).
 * fenix.js las vuelve a exportar: quien las importe de allí sigue igual.
 */
var DAY = 86400000;
function _nid(id) { return (id || '').toString().toLowerCase().trim(); }

// Lentitud en Bluetooth (#dueño 07-11): ¿SALTAR a este custodio en esta vuelta del respaldo Fénix? Se salta si está en
// cooldown por un fallo reciente (un envío de respaldo que falla muele la radio 2–8 min por los reintentos de ventana y
// retrasa los chats), o si su ÚNICO camino es un Bluetooth muerto/atascado (dev REAL + isDead: el nativo soltó un mensaje
// por él). Con internet/Wi-Fi (dev VIRTUAL «net…»/«lan…») NUNCA se salta: por ahí el respaldo va rápido y no estorba. La
// redundancia (segCopies en otros custodios) cubre el respaldo mientras tanto. Pura y testable.
export function _fenixSkipHolder(now, coldUntil, dev, isDead) {
  if (coldUntil && now < coldUntil) return true;
  if (isDead && !/^(lan|net)/.test(String(dev || ''))) return true;
  return false;
}

// Regla del dueño (07-11): el usuario es la prioridad, es el dueño de la radio. Con la app en PRIMER PLANO (foreground===true),
// los envíos pesados de respaldo Fénix ESPERAN (no estorban lo que hace el usuario); en segundo plano se reanudan. Defensivo:
// solo pausa cuando hay señal CIERTA de primer plano (===true); undefined/false (el simulador, o si falta la señal) → corre,
// para no dejar nunca el respaldo sin hacerse. En uso real el teléfono pasa a segundo plano a cada rato (pantalla apagada,
// cambio de app), así que el respaldo tiene ventanas de sobra. Pura y testable.
export function _fenixFgPaused(foreground) { return foreground === true; }

// Anti-abuso / anti-IA (07-11): ¿cabe otra petición de recuperación en la ventana, o es spam? Poda `win` a las de la
// última `winMs` y, si ya hay `max`, devuelve false (no mostrar); si cabe, apunta `now` y devuelve true. Pura y testable.
export function _recWindowOk(win, now, max, winMs) {
  var i = 0;
  while (i < win.length) { if (now - win[i] >= winMs) win.splice(i, 1); else i++; }
  if (win.length >= max) return false;
  win.push(now);
  return true;
}

// 3137 (dueño 15-11: «si yo he tenido muchos contactos vía Bluetooth… es una persona cercana… si en ningún momento he usado Bluetooth
// con alguien, no está tan cercano y no lo puedo ocupar para recuperar la cuenta a través del Bluetooth… si no hay, ocupar los
// contactos más recientes, pero que sea una recuperación vía internet o Wi-Fi»; y: «los guardianes los tiene que elegir la
// aplicación; si los elige el usuario, los puede elegir el impostor»). Los guardianes los elige la app sola por CÓMO te conectas:
// primero los CERCANOS (Bluetooth en varios días distintos) y, si no alcanzan, los más recientes, marcados como «por internet».
// Apunta el día de una conexión por Bluetooth con nx (uno por día; se olvida lo de hace más de keepDays). true si cambió.
export function _fenixNoteBt(close, nx, now, keepDays) {
  if (!close || !nx) return false;
  var day = Math.floor(now / DAY), keep = keepDays || 90, list = Array.isArray(close[nx]) ? close[nx] : [];
  var fresh = list.filter(function(d) { return typeof d === 'number' && day - d < keep; });
  var changed = fresh.length !== list.length;
  if (fresh.indexOf(day) < 0) { fresh.push(day); changed = true; }
  if (fresh.length > keep) fresh = fresh.slice(-keep);
  close[nx] = fresh;
  return changed;
}
// Días distintos con Bluetooth con nx en los últimos winDays
export function _fenixBtDays(close, nx, now, winDays) {
  var day = Math.floor(now / DAY), w = winDays || 60, list = (close && Array.isArray(close[nx])) ? close[nx] : [];
  return list.filter(function(d) { return day - d < w && d <= day; }).length;
}
// Orden de los posibles guardianes: los cercanos (Bluetooth en ≥ minDays días) primero, por días y luego por el último mensaje;
// después los demás por el último mensaje. Cada uno sale con _fxVia: 'bt' (se recupera en persona) o 'net' (por internet/Wi-Fi).
export function _fenixRank(list, close, now, cfg) {
  var min = (cfg && cfg.closeMinDays) || 3, win = (cfg && cfg.closeWinDays) || 60;
  var out = (list || []).map(function(c) {
    var nx = _nid(c.nexoId || c.deviceUUID), d = _fenixBtDays(close, nx, now, win);
    return Object.assign({}, c, { _btDays: d, _fxVia: d >= min ? 'bt' : 'net' });
  });
  return out.sort(function(a, b) {
    if (a._fxVia !== b._fxVia) return a._fxVia === 'bt' ? -1 : 1;
    if (a._fxVia === 'bt' && a._btDays !== b._btDays) return b._btDays - a._btDays;
    return (b.lastMessageAt || 0) - (a.lastMessageAt || 0);
  });
}
