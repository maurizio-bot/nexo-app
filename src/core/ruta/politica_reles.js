// Fase 1 (internet) del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §B.5, decisión del dueño 28-11 «conexiones sólidas, una a la
// vez»): UNA sola política de relés, PURA (sin red, sin reloj propio, sin estado global), que usan la app (net_publish.js) y, copiada línea
// a línea, la parte nativa (RelayPolicy.kt). Las dos se prueban con los MISMOS vectores (tests/vectores/politica_reles.json): si una se
// separa de la otra, falla la prueba de las dos.
// PORQUÉ: hasta la 3167 la app ponía en pausa al relé que limita/castiga y el nativo (app oculta o cerrada) le seguía mandando todo (ignoraba
// el «OK false»): cada sobre más es otra infracción y lleva al «banned» (diag. S24 26-11 y 27-11 23:33). Y la app daba ✓ con que lo guardara
// CUALQUIER relé, aunque fuera uno que el otro no lee (caso S24→S23 27-11 21:53: audios en ✓ que nunca llegaron).

export const LIMITES = Object.freeze({
  RATE_COOL_MS: 20000, RATE_COOL_MAX_MS: 600000,     // «rate-limited / slow down / too many»: 20 s, 40 s … 10 min
  BAN_COOL_MS: 600000, BAN_COOL_MAX_MS: 7200000,     // «banned / restricted / blocked»: 10 min, 20 min … 2 h
  POLICY_COOL_MS: 6 * 3600000,                       // no nos deja publicar (web of trust, pago, prueba de trabajo…): 6 h
  LIMIT_FORGET_MS: 1800000,                          // sin otro «no» en 30 min, la pausa vuelve a empezar desde abajo
  LECTURAS_VIGENCIA_MS: 24 * 3600000,                // un anuncio de «dónde leo» caduca a las 24 h (contrato B.5.1)
  LECTURAS_MAX: 12,                                  // relés que se anuncian / se aceptan de un contacto como mucho
});

// Qué clase de «no» es el texto de un OK false: 'rate', 'ban', 'policy' o '' (no es un límite: duplicado, inválido, falta identificarse…)
export function tipoLimite(msg) {
  var m = String(msg || '');
  if (/^(duplicate|invalid|auth-required|error):/i.test(m)) return '';
  // (la clave de cada sobre es nueva cada vez: «pubkey is not in our web of trust» no se arregla nunca con ese relé)
  if (/web of trust|not in our|policy|pubkey is not|whitelist|allowlist|paid|payment|^pow:/i.test(m)) return 'policy';
  if (/banned|^restricted:|^blocked:/i.test(m)) return 'ban';
  if (/rate.?limit|slow down|too many|too fast/i.test(m)) return 'rate';
  return '';
}

// La pausa que toca para el n-ésimo «no» seguido de ese tipo (ms)
export function pausaMs(kind, n) {
  n = Math.max(1, n || 1);
  if (kind === 'policy') return LIMITES.POLICY_COOL_MS;
  if (kind === 'ban') return Math.min(LIMITES.BAN_COOL_MS * Math.pow(2, n - 1), LIMITES.BAN_COOL_MAX_MS);
  if (kind === 'rate') return Math.min(LIMITES.RATE_COOL_MS * Math.pow(2, n - 1), LIMITES.RATE_COOL_MAX_MS);
  return 0;
}

// Un relé dijo «no» (msg) a las `now`: el estado de su pausa tras ese «no». prev = { kind, n, at, hasta } o null. Devuelve null si el «no»
// no es un límite (el estado queda como estaba).
export function anotarLimite(prev, msg, now) {
  var kind = tipoLimite(msg); if (!kind) return null;
  var p = prev || {};
  var n = (p.kind === kind && now - (p.at || 0) < LIMITES.LIMIT_FORGET_MS) ? (p.n || 0) + 1 : 1;
  return { kind: kind, n: n, at: now, hasta: now + pausaMs(kind, n) };
}

// Juntar las pausas que conoce cada ejecutor (app y nativo): por relé, la que dure más (nunca se acorta una pausa por juntarlas).
// a, b: { url: { kind, n, at, hasta } }. Las vencidas hace más de LIMIT_FORGET_MS se olvidan.
export function juntarPausas(a, b, now) {
  var out = {};
  [a || {}, b || {}].forEach(function(m) {
    Object.keys(m).forEach(function(u) {
      var x = m[u]; if (!x || typeof x.hasta !== 'number') return;
      if (now - Math.max(x.hasta, x.at || 0) > LIMITES.LIMIT_FORGET_MS) return;
      var y = out[u];
      if (!y || x.hasta > y.hasta || (x.hasta === y.hasta && (x.n || 0) > (y.n || 0))) out[u] = { kind: String(x.kind || ''), n: x.n || 1, at: x.at || 0, hasta: x.hasta };
    });
  });
  return out;
}

// El anuncio de «dónde leo» de un contacto, ya limpio: solo los relés que también conozco (pool: los míos de siempre, los de reserva y el
// propio). PORQUÉ del filtro: un contacto (o quien le robe la clave) no puede hacerme abrir relés suyos ni mandar mis sobres a uno que no
// conozco (lo mismo que T-R1 con los punteros de archivo). Sin cruce con lo mío, o caducado: null (= no sé dónde lee: como hoy).
export function lecturasDe(anuncio, pool, now) {
  if (!anuncio || !Array.isArray(anuncio.lee) || typeof anuncio.at !== 'number') return null;
  if (now - anuncio.at > LIMITES.LECTURAS_VIGENCIA_MS || anuncio.at - now > 600000) return null;
  var p = pool || [], out = [];
  anuncio.lee.slice(0, LIMITES.LECTURAS_MAX).forEach(function(u) { if (typeof u === 'string' && p.indexOf(u) >= 0 && out.indexOf(u) < 0) out.push(u); });
  return out.length ? out : null;
}

// A qué relés publicar un sobre para un contacto (contrato B.5.2: «publicar donde el otro lee»). relays: [{ url, abierto, hasta, soloLeer,
// puente }] en el orden de mi lista. lee: sus lecturas (lecturasDe) o null. Devuelve:
//   { publicar: [urls], pausados: [urls], motivo }  — motivo:
//   'suyos'        publicar en los suyos que tengo abiertos y sin pausa (también los que yo solo escucho: un relé de reserva que escucho
//                  y él lee es justo donde hay que dejarlo);
//   'sin_anuncio'  no sé dónde lee: los míos abiertos sin pausa que no son solo de escucha (como hasta la 3167);
//   'en_pausa'     los suyos (o, sin anuncio, todos los míos) abiertos están en pausa: pendiente sin mandar nada (no sumar infracciones);
//   'ninguno_suyo' ninguno de los suyos está abierto ahora: pendiente sin mandar (un ✓ en un relé que no lee mentiría).
//   'sin_reles'    nada abierto.
export function destinos(relays, lee, now) {
  var abiertos = (relays || []).filter(function(r) { return r && r.abierto && !r.puente; });
  if (!abiertos.length) return { publicar: [], pausados: [], motivo: 'sin_reles' };
  var enPausa = function(r) { return !!(r.hasta && r.hasta > now); };
  var cand = lee ? abiertos.filter(function(r) { return lee.indexOf(r.url) >= 0; }) : abiertos.filter(function(r) { return !r.soloLeer; });
  var libres = cand.filter(function(r) { return !enPausa(r); }), pausados = cand.filter(enPausa).map(function(r) { return r.url; });
  if (libres.length) return { publicar: libres.map(function(r) { return r.url; }), pausados: pausados, motivo: lee ? 'suyos' : 'sin_anuncio' };
  if (pausados.length) return { publicar: [], pausados: pausados, motivo: 'en_pausa' };
  return { publicar: [], pausados: [], motivo: lee ? 'ninguno_suyo' : 'sin_reles' };
}

// ¿Este OK da ✓? (contrato B.5.2: «✓ solo si lo aceptó uno de su lista»). Sin anuncio, cualquiera de los míos (como hoy).
export function daGuardado(url, lee) { return !lee || lee.indexOf(url) >= 0; }
