// Fase 1 (internet) del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §B.5.3 y §B.5.4): PUNTUAR los relés y el CUPO por relé
// que baja a la mitad 1 h tras un límite. PURO (sin red ni reloj propio). La app lo usa en net_publish.js (ordenar destinos y el cupo de
// lo pesado) y la parte nativa tiene la misma cuenta (RelayPolicy.kt `quotaPerMin`) con los vectores tests/vectores/politica_reles.json.
// PORQUÉ: tras un «rate-limited» la app volvía a los 5 min al ritmo de siempre (600 sobres pesados/min) y el mismo relé volvía a
// limitar, y así hasta el «banned» (diag. S24 26-11/27-11). Y los destinos iban en el orden de la lista, aunque uno no guardara nada.

export const PUNTOS = Object.freeze({
  CUPO_MIN: 600,              // sobres pesados por minuto sin límites (QUOTA_PER_MIN de hoy)
  CUPO_CALMA: 30,             // los 5 primeros minutos tras un límite (QUOTA_CALM_PER_MIN de hoy)
  CALMA_MS: 300000,
  MITAD_MS: 3600000,          // y luego, la mitad durante 1 h
  SUBIDA_MS: 3600000,         // y después vuelve despacio (lineal) en otra hora
  CASTIGO_VENTANA_MS: 24 * 3600000,
  ALFA: 0.2,                  // media móvil del tiempo hasta el OK
});

// Sobres pesados por minuto que admite el cupo, a las `now`, si el último límite de un relé fue a las `limitAt` (0 = nunca)
export function cupoPorMin(limitAt, now) {
  var b = PUNTOS.CUPO_MIN;
  if (!limitAt || now < limitAt) return b;
  var d = now - limitAt;
  if (d < PUNTOS.CALMA_MS) return PUNTOS.CUPO_CALMA;
  if (d < PUNTOS.CALMA_MS + PUNTOS.MITAD_MS) return Math.floor(b / 2);
  if (d < PUNTOS.CALMA_MS + PUNTOS.MITAD_MS + PUNTOS.SUBIDA_MS) return Math.floor(b / 2 + (b / 2) * (d - PUNTOS.CALMA_MS - PUNTOS.MITAD_MS) / PUNTOS.SUBIDA_MS);
  return b;
}

// Estado de un relé: { pub, ok, tOk (ms, media), llego, castigos: [at…] }
export function nuevo() { return { pub: 0, ok: 0, tOk: 0, llego: 0, castigos: [] }; }
// Se publicó ahí: ok (aceptó o duplicate), ms hasta la respuesta, castigo (rate/ban/policy)
export function anotar(st, ok, ms, castigo, now) {
  st = st || nuevo(); st.pub++;
  if (ok) { st.ok++; st.tOk = st.tOk ? Math.round(st.tOk * (1 - PUNTOS.ALFA) + (ms || 0) * PUNTOS.ALFA) : (ms || 0); }
  if (castigo) st.castigos.push(now);
  st.castigos = st.castigos.filter(function(t) { return now - t < PUNTOS.CASTIGO_VENTANA_MS; }).slice(-50);
  return st;
}
// Un mensaje publicado ahí terminó en ✓✓ sin republicar («llegó»)
export function llego(st) { st = st || nuevo(); st.llego++; return st; }
// La puntuación (más alta = mejor). Sin datos: 0,5 (ni premia ni castiga a un relé nuevo).
export function puntuar(st, now) {
  if (!st || !st.pub) return 0.5;
  var acept = (st.ok + 1) / (st.pub + 2), lleg = (st.llego + 1) / (st.ok + 2), rap = 1 / (1 + (st.tOk || 0) / 2000);
  var cast = (st.castigos || []).filter(function(t) { return now - t < PUNTOS.CASTIGO_VENTANA_MS; }).length;
  return Math.round((acept * 0.5 + lleg * 0.3 + rap * 0.2) / (1 + cast * 0.5) * 1000) / 1000;
}
// Ordena las URLs de mayor a menor puntuación; a igual puntuación, el orden de entrada (la lista del usuario)
export function ordenar(urls, mapa, now) {
  return (urls || []).map(function(u, i) { return { u: u, i: i, p: puntuar(mapa && mapa[u], now) }; })
    .sort(function(a, b) { return b.p - a.p || a.i - b.i; }).map(function(x) { return x.u; });
}
