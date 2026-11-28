// Fase 1 del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §B.1, §B.3, §B.5.6): el ESTADO POR CONTACTO que usa el enrutador
// (`ContactoRuta`): dónde está (lugar), si su app está despierta, dónde lee por internet, si sus toques llegan degradados, y la
// anti-oscilación (permanencia y freno). PURO: sin red ni reloj propio (`now` lo pasa quien llama). En la fase 1 solo lo usa la SOMBRA y
// el banco de escenarios (tests/sim/mundo); el mando llega en la fase 5 (contrato D.3).

export const RUTA = Object.freeze({
  CERCA_MS: 120000,          // visto por BLE/WD/mDNS hace < 120 s = CERCA; y al dejar de verlo se espera 120 s antes de pasarlo a LEJOS
  LEJOS_MS: 24 * 3600000,    // oído por internet en las últimas 24 h = LEJOS
  APP_MS: 150000,            // UP_MS de hoy: un paquete de su app hace < 150 s = APP
  NATIVO_MS: 600000,         // solo contesta su nativo en < 10 min = NATIVO
  PERMANENCIA_MS: 60000,     // tras un cambio voluntario, 60 s sin otro con ese contacto y tipo
  FRENO_VENTANA_MS: 600000,  // > 4 cambios voluntarios en 10 min → fijado 10 min
  FRENO_MAX: 4,
  FIJADO_MS: 600000,
  ESTABLE_MS: 30000,         // MEJOR_ESTABLE exige 30 s LISTO seguidos
});

export function nuevo(nx) {
  return { nx: String(nx || ''), lugar: 'DESCONOCIDO', lugarPorque: '', lugarAt: 0, cercaHasta: 0, despierto: 'DESCONOCIDO', despiertoAt: 0,
    leeEn: null, fcm: { tiene: false, degradado: false }, cambios: [], fijadoHasta: 0, fijadoEn: '' };
}

// Lugar (B.1). h: { lan (LISTO/DEGRADADO/MARGEN con él), bleAt, wdAt, mdnsAt (última vez visto), jump1 (ruta Jump de 1 salto), netAt
// (última vez oído por internet) }. Devuelve el ContactoRuta con lugar/lugarPorque/lugarAt al día (mismo objeto).
export function ponerLugar(cr, h, now) {
  h = h || {};
  var visto = Math.max(h.bleAt || 0, h.wdAt || 0, h.mdnsAt || 0), antes = cr.lugar, l, p;
  if (h.lan) { l = 'MISMA_WIFI'; p = 'lan'; }
  else if ((visto && now - visto < RUTA.CERCA_MS) || h.jump1) { l = 'CERCA'; p = h.jump1 && !(visto && now - visto < RUTA.CERCA_MS) ? 'jump1' : 'visto'; cr.cercaHasta = Math.max(cr.cercaHasta || 0, (visto || now) + RUTA.CERCA_MS); }
  // CERCA → LEJOS solo tras 120 s sin verlo (el BLE se pierde a ratos aunque esté al lado)
  else if (antes === 'CERCA' && now < (cr.cercaHasta || 0)) { l = 'CERCA'; p = 'margen'; }
  else if (h.netAt && now - h.netAt < RUTA.LEJOS_MS) { l = 'LEJOS'; p = 'net'; }
  else { l = 'DESCONOCIDO'; p = ''; }
  if (l !== antes) cr.lugarAt = now;
  cr.lugar = l; cr.lugarPorque = p;
  return cr;
}

// Despierto (B.1, V2). h: { appAt, nativoAt, fcm (tiene toque) }. «Dormido» no es causa de cambio de camino: es causa de toque y espera.
export function ponerDespierto(cr, h, now) {
  h = h || {};
  var d = (h.appAt && now - h.appAt < RUTA.APP_MS) ? 'APP' : (h.nativoAt && now - h.nativoAt < RUTA.NATIVO_MS) ? 'NATIVO' : h.fcm ? 'DORMIDO' : 'DESCONOCIDO';
  if (d !== cr.despierto) cr.despiertoAt = now;
  cr.despierto = d;
  if (cr.fcm) cr.fcm.tiene = !!h.fcm;
  return cr;
}

// B.5.6 Toques degradados: el que recibe compara la prioridad con la que llegó el toque con la pedida. Android baja a «normal» los toques
// de una app que pide «alta» y no muestra nada al usuario (cupo de FCM): esos toques llegan tarde o nunca despiertan.
export function toqueDegradado(prio, original) { return Number(original) === 1 && Number(prio) === 2; } // RemoteMessage: 1 = HIGH, 2 = NORMAL
// ¿Hay que tocar? tipo: 'llamada' | 'texto' | 'archivo'. primeroPendiente: es el 1.er mensaje sin ✓✓ con él. Con toques degradados solo
// las llamadas y el primer pendiente (cada toque de más gasta su cupo y empeora los siguientes).
export function tocar(cr, tipo, primeroPendiente) {
  if (!cr || !cr.fcm || !cr.fcm.tiene) return false;
  if (tipo === 'llamada') return true;
  if (cr.despierto === 'APP') return false;
  return cr.fcm.degradado ? !!primeroPendiente : true;
}

// Anti-oscilación (B.3.3 y B.3.4): ¿se permite un cambio de camino con este contacto y tipo, por esta causa? forzoso = CAIDA/SIN_AVANCE/
// USUARIO (siempre se atiende). Devuelve { ok, porque }. No anota nada: `anotarCambio` lo hace cuando el cambio ocurre.
export function puedeCambiar(cr, tipo, causa, now) {
  var forzoso = causa === 'CAIDA' || causa === 'SIN_AVANCE' || causa === 'USUARIO';
  if (forzoso) return { ok: true, porque: 'forzoso' };
  if (cr.fijadoHasta && now < cr.fijadoHasta) return { ok: false, porque: 'fijado' };
  var ult = null;
  for (var i = cr.cambios.length - 1; i >= 0; i--) { var c = cr.cambios[i]; if (c.tipo === tipo && c.voluntario) { ult = c; break; } }
  if (ult && now - ult.at < RUTA.PERMANENCIA_MS) return { ok: false, porque: 'permanencia' };
  return { ok: true, porque: '' };
}
// Anota un cambio hecho; si con él pasan de 4 voluntarios en 10 min, fija el carril con menos fallos (el que llega aquí: `a`) 10 min.
export function anotarCambio(cr, tipo, de, a, causa, now) {
  var voluntario = !(causa === 'CAIDA' || causa === 'SIN_AVANCE' || causa === 'USUARIO');
  cr.cambios.push({ tipo: tipo, de: de, a: a, causa: causa, at: now, voluntario: voluntario });
  cr.cambios = cr.cambios.filter(function(c) { return now - c.at < RUTA.FRENO_VENTANA_MS; });
  var n = cr.cambios.filter(function(c) { return c.voluntario; }).length;
  if (voluntario && n > RUTA.FRENO_MAX) { cr.fijadoHasta = now + RUTA.FIJADO_MS; cr.fijadoEn = a; return 'FIJADO_ANTIOSCILACION'; }
  return '';
}
