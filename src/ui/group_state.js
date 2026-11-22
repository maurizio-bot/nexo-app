/**
 * group_state.js (22-11, COLA 4b «Grupos: administración», tarea G2) — ESTADO del grupo: quién manda y qué se puede.
 * Sin servidor: cada teléfono guarda el estado de cada grupo y lo valida él mismo. Un cambio (agregar, expulsar, bloquear,
 * designar administradores, nombre, foto, modo e interruptores) es un estado NUEVO, con versión v+1, FIRMADO por quien lo hace
 * (ECDSA P-256 con su clave de identidad, la misma que conocen sus contactos y que viaja en las tarjetas del grupo). El que lo
 * recibe comprueba (1) la firma, (2) que quien firma era miembro y (3) que el cambio, comparado con el estado que él ya tenía,
 * está PERMITIDO a quien firma según ese estado anterior. Si no, se descarta: nunca se fía de que el que manda se porte bien.
 * Gana la versión mayor; en empate, el administrador más antiguo (luego el menor NEXO ID; luego la menor firma: determinista).
 * Campos (cortos: viajan con cada cambio):
 *   g  id del grupo          v  versión (1 = creación; 0 = grupo viejo sin estado, implícito y sin firma)
 *   cr creador (o null)      ad administradores por antigüedad (el creador, el primero)
 *   md 'c' control | 'o' colegas      ow 1 = solo admins escriben      oa 1 = solo admins agregan (en control, siempre)
 *   m  miembros (≤ 32)       bl bloqueados en ESTE grupo (≤ 64)       n nombre       ph huella de la foto del grupo ('' sin)
 *   by quien firma           t  cuándo (su reloj; solo informativo)  sg firma (base64, 64 bytes r||s)
 * Permisos (los hace cumplir el que recibe): escribir: todos, o solo admins con ow. Nombre y foto: en control, admins; en colegas,
 * todos. Agregar: admins en control o con oa; si no, todos. Expulsar a un miembro normal: en control, un admin; en colegas, el
 * creador. Expulsar a un admin, bloquear, desbloquear, quitar admins y cambiar modo o interruptores: solo el creador. Designar
 * admins: un admin. El creador no es expulsable. Salir: siempre (si sale el creador, pasa todo al admin más antiguo; si no queda
 * creador ni admins el grupo queda ABIERTO: todos pueden todo, también desbloquear y volver a agregar).
 * Puro (sin la app): la verificación usa @noble/curves (síncrona); firmar lo hace e2e_crypto.js (la privada no sale de allí).
 */
import { p256 } from '@noble/curves/nist.js';

export var GS_MAX_MEMBERS = 32;
export var GS_MAX_BLOCKED = 64;
export var GS_LOG_KEEP = 16;     // estados guardados por grupo (para validar pasos y mandarlos a quien va atrasado)
export var GS_CHAIN_SEND = 6;    // estados que viajan con cada cambio (cubren a quien se perdió hasta 5 cambios)
var NX_RE = /^nx[0-9a-z]{8}$/;
var GID_RE = /^gr[0-9a-z]{8}$/;
var SIG_RE = /^[A-Za-z0-9+/]{86}==$/;

function _nid(x) { return (x || '').toString().toLowerCase().trim(); }
function _ids(a, max) {
  if (!Array.isArray(a) || a.length > max) return null;
  var o = [];
  for (var i = 0; i < a.length; i++) { var x = _nid(a[i]); if (!NX_RE.test(x) || o.indexOf(x) >= 0) return null; o.push(x); }
  return o;
}
function _has(a, x) { return a.indexOf(x) >= 0; }
function _minus(a, b) { return a.filter(function(x) { return b.indexOf(x) < 0; }); }
function _b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
function _unb64(s) { var b = atob(s), o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }

// Normaliza un estado que llega de fuera; null si no tiene la forma correcta (antes de mirar nada más)
export function gsClean(s) {
  if (!s || typeof s !== 'object') return null;
  var g = _nid(s.g), v = Number(s.v), m = _ids(s.m, GS_MAX_MEMBERS), ad = _ids(s.ad, GS_MAX_MEMBERS), bl = _ids(s.bl || [], GS_MAX_BLOCKED);
  if (!GID_RE.test(g) || !(v >= 1 && v <= 1e9 && Math.floor(v) === v) || !m || !ad || !bl) return null;
  var cr = s.cr ? _nid(s.cr) : null, by = _nid(s.by);
  if ((cr && !NX_RE.test(cr)) || !NX_RE.test(by)) return null;
  if (s.md !== 'c' && s.md !== 'o') return null;
  if (typeof s.n !== 'string' || s.n.length > 60 || typeof (s.ph || '') !== 'string' || (s.ph || '').length > 64) return null;
  if (typeof s.sg !== 'string' || !SIG_RE.test(s.sg)) return null;
  // coherencia interna: admins y creador son miembros (salvo el que firma su propia salida), el creador es el primer admin,
  // nadie bloqueado es miembro
  if (ad.some(function(x) { return !_has(m, x); }) || (cr && (!_has(m, cr) || ad[0] !== cr))) return null;
  if (bl.some(function(x) { return _has(m, x); })) return null;
  return { g: g, v: v, cr: cr, ad: ad, md: s.md, ow: s.ow ? 1 : 0, oa: s.oa ? 1 : 0, m: m, bl: bl, n: s.n, ph: s.ph || '', by: by, t: Number(s.t) || 0, sg: s.sg };
}

// Lo que se firma (orden fijo, con una etiqueta propia: no se confunde con ninguna otra firma)
export function gsSigned(s) {
  return new TextEncoder().encode(JSON.stringify(['nexo-gs-1', s.g, s.v, s.cr || null, s.ad, s.md, s.ow ? 1 : 0, s.oa ? 1 : 0, s.m, s.bl, s.n, s.ph || '', s.by, s.t || 0]));
}

// ¿La firma es de la clave pública (base64, 65 bytes sin comprimir) de quien firma?
export function gsVerify(s, pubB64) {
  try {
    if (!s || !pubB64) return false;
    return p256.verify(_unb64(s.sg), gsSigned(s), _unb64(pubB64), { lowS: false }) === true;
  } catch (e) { return false; }
}
export function gsSigToB64(bytes) { return _b64(bytes); }

// Estado implícito de un grupo VIEJO (sin estado firmado): el que lo creó (según este teléfono) es el único admin, modo colegas
// (así sigue igual que antes: todos escriben, agregan y renombran; expulsar, solo el creador)
export function gsImplicit(g) {
  var m = (g.members || []).slice(), cr = _nid(g.createdBy);
  if (!_has(m, cr)) cr = null;
  return { g: g.id, v: 0, cr: cr, ad: cr ? [cr] : [], md: 'o', ow: 0, oa: 0, m: m, bl: [], n: g.name || '', ph: '', by: null, t: 0, sg: '' };
}

// ---- roles y permisos ----
export function gsOpen(s) { return !s.cr && !s.ad.length; }
export function gsIsAdmin(s, x) { x = _nid(x); return _has(s.m, x) && (gsOpen(s) || _has(s.ad, x)); }
// Quien hace de creador: el creador; si no lo hay, el admin más antiguo; en un grupo abierto, cualquiera
export function gsIsBoss(s, x) { x = _nid(x); return _has(s.m, x) && (gsOpen(s) || (s.cr ? s.cr === x : s.ad[0] === x)); }
export function gsCan(s, x, what, target) {
  x = _nid(x);
  if (!s || !_has(s.m, x)) return false;
  if (gsOpen(s)) return true;
  switch (what) {
    case 'write': return !s.ow || gsIsAdmin(s, x);
    case 'edit': return s.md === 'o' || gsIsAdmin(s, x);                    // nombre y foto (y compartir el fondo)
    case 'add': return (s.md === 'c' || s.oa) ? gsIsAdmin(s, x) : true;
    case 'kick': {
      var tg = _nid(target);
      if (!_has(s.m, tg) || tg === x || tg === s.cr) return false;        // al creador, nunca
      if (_has(s.ad, tg)) return gsIsBoss(s, x);                          // a un admin, solo el creador
      return s.md === 'c' ? gsIsAdmin(s, x) : gsIsBoss(s, x);
    }
    case 'block': case 'unblock': case 'demote': case 'settings': return gsIsBoss(s, x);
    case 'promote': return gsIsAdmin(s, x);
  }
  return false;
}

// ¿Es `next` un paso PERMITIDO desde `prev` para quien lo firma? null si sí; si no, el motivo (para el registro)
export function gsStepError(prev, next) {
  if (!prev || !next || prev.g !== next.g) return 'otro grupo';
  var a = next.by;
  if (!_has(prev.m, a)) return 'quien firma no era miembro';
  if (_has(prev.bl, a)) return 'quien firma está bloqueado';
  var removed = _minus(prev.m, next.m), added = _minus(next.m, prev.m);
  var same = function(k) { return JSON.stringify(prev[k]) === JSON.stringify(next[k]); };
  // Salir: solo se quita a sí mismo y nada más cambia (si era el creador, pasa al admin más antiguo)
  if (!_has(next.m, a)) {
    if (removed.length !== 1 || added.length || !same('bl') || !same('n') || !same('ph') || !same('md') || !same('ow') || !same('oa')) return 'una salida que cambia otras cosas'; // i18n-ok: registro
    var ad2 = prev.ad.filter(function(x) { return x !== a; });
    if (JSON.stringify(ad2) !== JSON.stringify(next.ad)) return 'salida con admins cambiados';
    var cr2 = prev.cr === a ? (ad2[0] || null) : prev.cr;
    if ((cr2 || null) !== (next.cr || null)) return 'salida con otro creador';
    return null;
  }
  if ((prev.cr || null) !== (next.cr || null)) {
    // el creador solo cambia al salir; en un grupo sin creador (se fue) el admin más antiguo no se nombra creador a sí mismo
    return 'cambio de creador';
  }
  var i;
  for (i = 0; i < removed.length; i++) if (!gsCan(prev, a, 'kick', removed[i])) return 'no puede expulsar a ' + removed[i];
  if (added.length && !gsCan(prev, a, 'add')) return 'no puede agregar'; // i18n-ok: registro
  var blAdd = _minus(next.bl, prev.bl), blDel = _minus(prev.bl, next.bl);
  if (blAdd.length && !gsCan(prev, a, 'block')) return 'no puede bloquear'; // i18n-ok: registro
  if (blDel.length && !gsCan(prev, a, 'unblock')) return 'no puede desbloquear'; // i18n-ok: registro
  for (i = 0; i < blAdd.length; i++) if (blAdd[i] === prev.cr || blAdd[i] === a) return 'bloqueo no válido';
  // admins: los que siguen, en el mismo orden; los nuevos, al final (antigüedad)
  var keep = prev.ad.filter(function(x) { return _has(next.ad, x); });
  if (JSON.stringify(next.ad.slice(0, keep.length)) !== JSON.stringify(keep)) return 'orden de admins cambiado';
  var adAdd = _minus(next.ad, prev.ad), adDel = _minus(prev.ad, next.ad).filter(function(x) { return !_has(removed, x); });
  if (adAdd.length && !gsCan(prev, a, 'promote')) return 'no puede designar admins'; // i18n-ok: registro
  for (i = 0; i < adDel.length; i++) {
    if (adDel[i] === prev.cr) return 'el creador no deja de ser admin'; // i18n-ok: registro
    if (adDel[i] !== a && !gsCan(prev, a, 'demote')) return 'no puede quitar admins'; // i18n-ok: registro
  }
  if ((!same('n') || !same('ph')) && !gsCan(prev, a, 'edit')) return 'no puede cambiar el nombre ni la foto'; // i18n-ok: registro
  if ((!same('md') || !same('ow') || !same('oa')) && !gsCan(prev, a, 'settings')) return 'no puede cambiar los ajustes'; // i18n-ok: registro
  return null;
}

// Creación (v1): quien firma es el creador, único admin, sin bloqueados
export function gsGenesisError(s) {
  if (s.v !== 1 || s.cr !== s.by || JSON.stringify(s.ad) !== JSON.stringify([s.by]) || s.bl.length) return 'creación no válida';
  return null;
}

// Antigüedad de quien firma en el estado base (menor = más antiguo): admins por su orden, después los demás por NEXO ID
function _rank(base, x) { var i = base.ad.indexOf(x); return i >= 0 ? i : 1000; }
// En EMPATE de versión (dos cambios a la vez desde el mismo estado), ¿gana `a` sobre `b`?
export function gsWins(a, b, base) {
  var ra = _rank(base, a.by), rb = _rank(base, b.by);
  if (ra !== rb) return ra < rb;
  if (a.by !== b.by) return a.by < b.by;
  return a.sg < b.sg;
}

// Estado nuevo a partir de `prev` con cambios `ch` (sin firmar: falta sg). Lo usa quien hace el cambio.
export function gsNext(prev, by, ch) {
  var s = { g: prev.g, v: (prev.v || 0) + 1, cr: prev.cr, ad: prev.ad.slice(), md: prev.md, ow: prev.ow, oa: prev.oa, m: prev.m.slice(), bl: prev.bl.slice(), n: prev.n, ph: prev.ph || '', by: _nid(by), t: Date.now(), sg: '' };
  Object.keys(ch || {}).forEach(function(k) { s[k] = ch[k]; });
  return s;
}

// Lo que cambió de `prev` a `next` (para los avisos «X hizo admin a Y»)
export function gsDiff(prev, next) {
  return {
    by: next.by,
    added: _minus(next.m, prev.m), removed: _minus(prev.m, next.m).filter(function(x) { return x !== next.by; }),
    left: !_has(next.m, next.by), blocked: _minus(next.bl, prev.bl), unblocked: _minus(prev.bl, next.bl),
    promoted: _minus(next.ad, prev.ad), demoted: _minus(prev.ad, next.ad).filter(function(x) { return _has(next.m, x); }),
    creator: (prev.cr || null) !== (next.cr || null) ? (next.cr || null) : undefined,
    name: prev.n !== next.n ? next.n : undefined, photo: (prev.ph || '') !== (next.ph || '') ? (next.ph || '') : undefined,
    mode: prev.md !== next.md ? next.md : undefined, ow: prev.ow !== next.ow ? next.ow : undefined, oa: prev.oa !== next.oa ? next.oa : undefined
  };
}
