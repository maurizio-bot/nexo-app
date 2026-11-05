/**
 * game_stats.js — Ranking cabeza a cabeza de los juegos (Fase A, pedido del dueño 05-11: «la lista de contactos con las
 * puntuaciones para fomentar la competencia»). Guarda, por CONTACTO y por JUEGO, victorias/derrotas/empates.
 *
 * Local y persistente (plugin saveToFile/loadFromFile, cifrado en reposo como el perfil y los fondos). NO viaja por la
 * red: cada teléfono lleva su propia cuenta desde SU punto de vista. Como cada jugada lleva el tablero completo y es
 * determinista (ttt.js/connect4.js validan todo al recibir), los dos teléfonos ven el mismo final y cuentan igual: el
 * que gana suma 1 victoria, el que pierde 1 derrota. Sin servidor ni sincronización.
 */
import { _normId } from './ble_helpers.js';
import { _contactName } from './chat_format.js';

var FILE = 'nexo_game_stats.json';
var NX_RE = /^nx[0-9a-z]{8}$/;
var _stats = {};         // { <nx>: { <gameId>: { w, l, d } } }
var _loaded = false;

function _pl() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _load() {
  var pl = _pl();
  if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
  return pl.loadFromFile({ filename: FILE }).then(function (r) { return r && r.exists && r.content ? JSON.parse(r.content) : null; }).catch(function () { return null; });
}
function _save() { var pl = _pl(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: FILE, content: JSON.stringify(_stats) }).catch(function () {}); }

export function gameStatsInit() {
  if (_loaded) return;
  _loaded = true;
  _load().then(function (o) { if (o && typeof o === 'object' && !Array.isArray(o)) _stats = o; });
}

// Registrar el resultado de UNA partida terminada. La idempotencia (no contar dos veces la misma partida) la hace el
// llamador con un flag por gid (connect4.js: g.recorded). result: 'win' | 'loss' | 'draw'.
export function recordGameResult(nx, gameId, result) {
  nx = _normId(nx);
  if (!NX_RE.test(nx) || !gameId) return;
  gameId = String(gameId).slice(0, 16);
  var c = _stats[nx] || (_stats[nx] = {});
  var g = c[gameId] || (c[gameId] = { w: 0, l: 0, d: 0 });
  if (result === 'win') g.w++;
  else if (result === 'loss') g.l++;
  else g.d++;
  _save();
}

// Cabeza a cabeza contra un contacto en un juego: { w, l, d }.
export function headToHead(nx, gameId) {
  nx = _normId(nx);
  var g = _stats[nx] && _stats[nx][gameId];
  return g ? { w: g.w | 0, l: g.l | 0, d: g.d | 0 } : { w: 0, l: 0, d: 0 };
}

// Ranking: una fila por contacto con el total (sumando todos los juegos, o solo `gameId` si se pasa), ordenado por
// diferencia (victorias − derrotas) y luego por victorias. Solo contactos con alguna partida jugada.
export function leaderboard(gameId) {
  var out = [];
  Object.keys(_stats).forEach(function (nx) {
    if (!NX_RE.test(nx)) return;
    var games = _stats[nx], w = 0, l = 0, d = 0;
    Object.keys(games).forEach(function (gId) {
      if (gameId && gId !== gameId) return;
      var g = games[gId]; w += g.w | 0; l += g.l | 0; d += g.d | 0;
    });
    if (w + l + d > 0) out.push({ nx: nx, name: _contactName(nx), w: w, l: l, d: d });
  });
  out.sort(function (a, b) { return (b.w - b.l) - (a.w - a.l) || (b.w - a.w) || (a.l - b.l); });
  return out;
}

// Ganchos de prueba (tests/sim).
try {
  if (typeof window !== 'undefined') {
    window.__nexoGameRecord = function (nx, gameId, result) { recordGameResult(nx, gameId, result); };
    window.__nexoGameH2H = function (nx, gameId) { return headToHead(nx, gameId); };
    window.__nexoGameLeaderboard = function (gameId) { return leaderboard(gameId); };
    window.__nexoGameStatsRaw = function () { return JSON.parse(JSON.stringify(_stats)); };
  }
} catch (e) {}
