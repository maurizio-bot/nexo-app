// Fase 1 del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §B.4 y §A.7.3): UN CALENDARIO POR MENSAJE y UN EJECUTOR A LA VEZ.
// PURO: sin red, sin temporizadores y sin reloj propio (`now` lo pasa quien llama; el azar se inyecta para poder probarlo). Quien lo usa
// pregunta `debidos(now)`, manda lo que toca, y le cuenta el resultado con `resultado()`; el calendario decide CUÁNDO va el siguiente
// intento y QUÉ toques tocan. En la fase 1 lo usan la SOMBRA y el banco de escenarios (tests/sim/mundo): no manda en la app todavía
// (contrato D.3: el mando llega cuando la sombra muestre que coincide). Las piezas mecánicas (esperas, topes, toques, cupo por contacto,
// juntar) tienen copia en Kotlin (RutaCalendario.kt) con los mismos vectores (tests/vectores/calendario.json).
// PORQUÉ (auditoría 28-11 §4): hoy reenvían 14 mecanismos distintos sin saber unos de otros; un texto a quien duerme salía ~70 veces.
import { tipoDe, REPUBLICAR_POR, reenviable } from './motivos.js';

export const CAL = Object.freeze({
  BASE_TEXTO_MS: 2000, BASE_ARCH_MS: 15000, TECHO_MS: 600000,   // espera tras FALLO: random(0, min(techo, base·2^n))
  TOPE_HORA: 3, LENTO_MS: 30 * 60000,                            // ≤ 3 intentos por mensaje y carril por hora; luego uno cada 30 min
  OCUPADO_MIN_MS: 2000, OCUPADO_MAX_MS: 10000,                   // OCUPADO no castiga: 2–10 s con azar
  TOQUES_MS: Object.freeze([0, 120000, 600000, 1800000, 7200000]), // GUARDADO: toque al entrar y a 2, 10, 30 min y 2 h (si sigue sin ✓✓)
  SIN_ACK_MIN_MS: 8000, SIN_ACK_MAX_MS: 60000,                   // él APP y sin ✓✓: max(3·p90, 8 s), tope 60 s
  PLAZO_TEXTO_MS: 15000,                                         // un envío de texto sin respuesta del camino en 15 s = SIN_AVANCE
  SIN_AVANCE_MS: 60000,                                          // un archivo: 60 s sin un byte confirmado = SIN_AVANCE (sin tope mientras avance)
  SOBRES_MIN: 6,                                                 // ≤ 6 sobres por minuto a un mismo contacto (textos juntados)
  MAX_CONTENT: 60000,                                            // un sobre juntado no pasa de 60 000 car.
  TESTIGO_MS: 20000,                                             // el testigo dura 20 s y se renueva
});

// Espera con azar completo (B.4.4). r ∈ [0, 1).
export function espera(base, n, r) { return Math.floor((r || 0) * Math.min(CAL.TECHO_MS, base * Math.pow(2, Math.max(0, n || 0)))); }
export function esArchivo(tipo) { return /^ARCH_|^NOTA_VOZ$/.test(String(tipo || '')); }
// Intentos en ese carril en la última hora
export function intentosHora(intentos, carril, now) { return (intentos || []).filter(function(i) { return i.carril === carril && now - i.at < 3600000; }).length; }
// El plazo «sin ACK» de un texto con un p90 medido (ms) del carril con él
export function sinAckMs(p90) { return Math.min(CAL.SIN_ACK_MAX_MS, Math.max(CAL.SIN_ACK_MIN_MS, 3 * (p90 || 0))); }
// ¿Cuándo toca el siguiente intento tras un FALLO? n = fallos seguidos de ese mensaje en ese carril; usados = intentos en la última hora.
export function siguienteTrasFallo(tipo, n, usados, now, r) {
  if (usados >= CAL.TOPE_HORA) return { at: now + CAL.LENTO_MS, lento: true };
  return { at: now + espera(esArchivo(tipo) ? CAL.BASE_ARCH_MS : CAL.BASE_TEXTO_MS, n, r), lento: false };
}
// Cuándo toca el toque i-ésimo de un mensaje GUARDADO a las `guardadoAt` (Infinity = ya no hay más)
export function toqueAt(guardadoAt, i) { return i < CAL.TOQUES_MS.length ? guardadoAt + CAL.TOQUES_MS[i] : Infinity; }
// Sobres a ese contacto en el último minuto: ¿cabe otro?
export function cabeSobre(salidas, now) { return (salidas || []).filter(function(t) { return now - t < 60000; }).length < CAL.SOBRES_MIN; }
// Juntar (B.4.3): textos y acuses al mismo contacto y carril en un mismo tick, en sobres de ≤ MAX_CONTENT car. Entrada: [{msgId, nx,
// carril, tipo, chars}] en orden; salida: [[msgId…]…] (lo que no se junta va solo).
export function juntar(lista) {
  var out = [], abiertos = {};
  (lista || []).forEach(function(m) {
    if (m.tipo !== 'TEXTO' && m.tipo !== 'ACUSE') { out.push([m.msgId]); return; }
    var k = m.nx + '|' + m.carril, g = abiertos[k], c = m.chars || 0;
    if (g && g.chars + c <= CAL.MAX_CONTENT) { g.ids.push(m.msgId); g.chars += c; return; }
    g = abiertos[k] = { ids: [m.msgId], chars: c }; out.push(g.ids);
  });
  return out;
}

// ---------- Testigo: un ejecutor a la vez (A.7.3) ----------
export function Testigo() { this.ejecutor = 'app'; this.hasta = 0; this.epoca = 0; }
// La app lo toma al verse o al arrancar; el nativo, cuando la app se lo pasa al ocultarse o cuando vence sin renovarse.
Testigo.prototype.tomar = function(quien, now, forzar) {
  if (quien === this.ejecutor) { this.hasta = now + CAL.TESTIGO_MS; return true; }
  if (!forzar && now < this.hasta) return false;
  this.ejecutor = quien; this.hasta = now + CAL.TESTIGO_MS; this.epoca++; return true;
};
Testigo.prototype.pasar = function(a, now) { this.ejecutor = a; this.hasta = now + CAL.TESTIGO_MS; this.epoca++; };
Testigo.prototype.puede = function(quien, now) { return quien === this.ejecutor && now < this.hasta; };

// ---------- El calendario ----------
export function Calendario(opts) {
  opts = opts || {};
  this.rnd = typeof opts.rnd === 'function' ? opts.rnd : Math.random;
  this.quien = opts.quien || 'app';
  this.m = new Map();     // msgId → registro (B.4.2)
  this.diario = [];       // solo añadir: lo que pasó (A.7.3), para unirlo en el otro ejecutor
  this.vistos = {};       // claves del diario ya aplicadas (unir es idempotente)
  this.salidas = {};      // nx → [at de sobres] (cupo por contacto)
}
Calendario.prototype._d = function(e) { e.por = e.por || this.quien; var k = e.msgId + '|' + e.ev + '|' + e.at + '|' + (e.carril || ''); if (this.vistos[k]) return; this.vistos[k] = 1; this.diario.push(e); };

Calendario.prototype.crear = function(o, now) {
  if (this.m.has(o.msgId)) return this.m.get(o.msgId);
  var r = { msgId: o.msgId, nx: o.nx, grupoId: o.grupoId || null, tipo: o.tipo || 'TEXTO', chars: o.chars || 0, creadoAt: now, estado: 'CREADO',
    motivo: '', intentos: [], guardadoEn: [], fallos: {}, fuera: {}, proximoAt: now, plazoAt: Infinity, guardadoAt: 0, toqueI: 0, toqueAt: Infinity,
    mismoEvento: false, reenvioApp: false, entregadoAt: 0, cambios: [], sobres: 0, lento: false, bytesOk: 0, avanceAt: 0 };
  this.m.set(o.msgId, r);
  this._d({ msgId: r.msgId, ev: 'crear', at: now, nx: r.nx, tipo: r.tipo, chars: r.chars });
  return r;
};
Calendario.prototype.get = function(id) { return this.m.get(id) || null; };
// Lo que toca mandar ya (en orden de creación)
Calendario.prototype.debidos = function(now) {
  var out = [];
  this.m.forEach(function(r) { if ((r.estado === 'CREADO' || r.estado === 'PAUSADO') && r.proximoAt <= now) out.push(r); });
  return out;
};
// Sale un sobre de este mensaje por `carril` (rele: url si es internet). Devuelve false si no cabe en el cupo por contacto.
Calendario.prototype.salir = function(id, carril, now, rele) {
  var r = this.m.get(id); if (!r || !reenviable(r)) return false;
  var s = this.salidas[r.nx] || (this.salidas[r.nx] = []);
  if (!cabeSobre(s, now)) { r.estado = 'PAUSADO'; r.motivo = 'CUPO'; r.proximoAt = s[s.length - CAL.SOBRES_MIN] + 60000; return false; }
  s.push(now); while (s.length > 40) s.shift();
  var ult = r.intentos.length ? r.intentos[r.intentos.length - 1].carril : '';
  if (ult && ult !== carril) r.cambios.push({ de: ult, a: carril, at: now });
  r.intentos.push({ carril: carril, at: now, rele: rele || '' }); r.sobres++;
  r.estado = 'EN_CAMINO'; r.motivo = ''; r.proximoAt = Infinity;
  // un archivo: plazo POR AVANCE (A.5.2): sin tope de duración mientras avance; 60 s sin un byte confirmado = SIN_AVANCE
  if (esArchivo(r.tipo)) { r.avanceAt = now; r.plazoAt = now + CAL.SIN_AVANCE_MS; } else r.plazoAt = now + CAL.PLAZO_TEXTO_MS;
  this._d({ msgId: id, ev: 'salir', at: now, carril: carril, rele: rele || '', mismo: r.mismoEvento, desde: r.bytesOk });
  return true;
};
// Juntar varios en UN sobre: cuenta como un solo sobre del cupo por contacto
Calendario.prototype.salirJuntos = function(ids, carril, now, rele) {
  var self = this, prim = ids[0]; if (!self.salir(prim, carril, now, rele)) return false;
  ids.slice(1).forEach(function(id) {
    var r = self.m.get(id); if (!r || !reenviable(r)) return;
    r.intentos.push({ carril: carril, at: now, rele: rele || '', junto: prim }); r.estado = 'EN_CAMINO'; r.motivo = ''; r.proximoAt = Infinity; r.plazoAt = now + CAL.PLAZO_TEXTO_MS;
    self._d({ msgId: id, ev: 'salir', at: now, carril: carril, rele: rele || '', junto: prim });
  });
  return true;
};
// El resultado de un envío. res: { aceptado: true, donde: { tipo: 'rele'|'puente'|'transporte', url?, via? } } | { error: ErrorCamino }
Calendario.prototype.resultado = function(id, carril, res, now) {
  var r = this.m.get(id); if (!r || !reenviable(r)) return null;
  r.plazoAt = Infinity;
  if (res && res.aceptado) {
    if (r.estado !== 'GUARDADO') { r.guardadoAt = now; r.toqueI = 0; r.toqueAt = toqueAt(now, 0); }
    r.estado = 'GUARDADO'; r.motivo = ''; r.proximoAt = Infinity; r.mismoEvento = false; r.fallos[carril] = 0;
    if (res.donde) r.guardadoEn.push(Object.assign({ at: now }, res.donde));
    this._d({ msgId: id, ev: 'guardado', at: now, carril: carril, donde: res.donde || null });
    return 'GUARDADO';
  }
  var e = (res && res.error) || { tipo: 'FALLO', causa: 'DESCONOCIDO' }, t = e.tipo || tipoDe(e.causa), hecho;
  if (t === 'OCUPADO') { r.estado = 'CREADO'; r.proximoAt = now + CAL.OCUPADO_MIN_MS + Math.floor(this.rnd() * (CAL.OCUPADO_MAX_MS - CAL.OCUPADO_MIN_MS)); hecho = 'reintento'; }
  else if (t === 'LIMITADO') { r.estado = 'PAUSADO'; r.motivo = 'LIMITADO'; r.proximoAt = now + (e.esperaMs || 20000); r.mismoEvento = true; hecho = 'pausa'; }
  else if (t === 'SIN_CAMINO') { r.estado = 'PAUSADO'; r.motivo = 'SIN_CAMINO'; r.proximoAt = Infinity; hecho = 'pausa'; }
  else if (t === 'NO_REINTENTAR') { r.fuera[carril] = true; r.estado = 'CREADO'; r.proximoAt = now; hecho = 'fuera'; }
  else if (t === 'CANCELADO') { r.borrado = true; r.estado = 'CREADO'; r.proximoAt = Infinity; hecho = 'fin'; }
  else if (t === 'DORMIDO') { r.estado = 'CREADO'; r.proximoAt = now + CAL.SIN_ACK_MAX_MS; hecho = 'toque'; }
  else {
    var n = r.fallos[carril] = (r.fallos[carril] || 0) + 1, s = siguienteTrasFallo(r.tipo, n - 1, intentosHora(r.intentos, carril, now), now, this.rnd());
    r.estado = 'CREADO'; r.proximoAt = s.at; r.lento = s.lento; r.mismoEvento = true; hecho = s.lento ? 'lento' : 'reintento';
  }
  this._d({ msgId: id, ev: 'rechazo', at: now, carril: carril, causa: e.causa || '', hecho: hecho, prox: r.proximoAt });
  return hecho;
};
// Avance de un archivo: bytes confirmados por el otro lado (o por el relé). Solo un byte NUEVO alarga el plazo.
Calendario.prototype.avance = function(id, bytesOk, now) {
  var r = this.m.get(id); if (!r || r.estado !== 'EN_CAMINO' || !(bytesOk > r.bytesOk)) return false;
  r.bytesOk = bytesOk; r.avanceAt = now; r.plazoAt = now + CAL.SIN_AVANCE_MS; r.fallos[r.intentos.length ? r.intentos[r.intentos.length - 1].carril : ''] = 0;
  return true;
};
// Desde dónde reanudar (A.5.2 `desde`): lo ya confirmado; nunca desde cero si algo se confirmó
Calendario.prototype.desde = function(id) { var r = this.m.get(id); return r ? r.bytesOk : 0; };
// Envíos sin respuesta pasado su plazo → FALLO(SIN_AVANCE) (texto: 15 s sin respuesta; archivo: 60 s sin un byte nuevo)
Calendario.prototype.vencer = function(now) {
  var self = this, out = [];
  this.m.forEach(function(r) { if (r.estado === 'EN_CAMINO' && r.plazoAt <= now) { var c = r.intentos.length ? r.intentos[r.intentos.length - 1].carril : ''; self.resultado(r.msgId, c, { error: { tipo: 'FALLO', causa: 'SIN_AVANCE' } }, now); out.push(r.msgId); } });
  return out;
};
// Avisos de fuera (B.4.3): 'camino_listo' | 'contacto_visto' sacan de la pausa SIN_CAMINO y del modo lento; 'contacto_app' devuelve lo
// GUARDADO hace más de `sinAck` ms sin ✓✓ para UN envío (una sola vez por mensaje).
Calendario.prototype.avisar = function(ev, nx, now, sinAck) {
  var out = [];
  this.m.forEach(function(r) {
    if (r.nx !== nx || !reenviable(r)) return;
    if ((ev === 'camino_listo' || ev === 'contacto_visto') && ((r.estado === 'PAUSADO' && r.motivo === 'SIN_CAMINO') || (r.estado === 'CREADO' && r.lento))) {
      r.estado = 'CREADO'; r.motivo = ''; r.lento = false; r.proximoAt = now; out.push(r.msgId);
    } else if (ev === 'contacto_app' && r.estado === 'GUARDADO' && !r.reenvioApp && now - r.guardadoAt >= (sinAck || CAL.SIN_ACK_MIN_MS)) {
      r.reenvioApp = true; r.estado = 'CREADO'; r.proximoAt = now; out.push(r.msgId);
    }
  });
  return out;
};
// Lo GUARDADO que hay que republicar (el MISMO evento) por RELE_PERDIO / LISTA_NUEVA / CADUCA
Calendario.prototype.republicar = function(id, causa, now) {
  var r = this.m.get(id); if (!r || r.estado !== 'GUARDADO' || REPUBLICAR_POR.indexOf(causa) < 0) return false;
  r.estado = 'CREADO'; r.proximoAt = now; r.mismoEvento = true; r.cambios.push({ de: 'GUARDADO', a: 'republicar', causa: causa, at: now });
  this._d({ msgId: id, ev: 'republicar', at: now, causa: causa });
  return true;
};
// Toques que tocan ya (lo GUARDADO sin ✓✓); avanza cada uno al siguiente
Calendario.prototype.toques = function(now) {
  var out = [], self = this;
  this.m.forEach(function(r) {
    if (r.estado !== 'GUARDADO' || r.toqueAt > now) return;
    out.push({ msgId: r.msgId, nx: r.nx, i: r.toqueI });
    while (r.toqueAt <= now) { r.toqueI++; r.toqueAt = toqueAt(r.guardadoAt, r.toqueI); }
    self._d({ msgId: r.msgId, ev: 'toque', at: now, i: r.toqueI }); // el otro ejecutor no repite el mismo toque al unir el diario
  });
  return out;
};
Calendario.prototype.acuse = function(id, now, leido) {
  var r = this.m.get(id); if (!r) return false;
  if (r.estado !== 'LEIDO') { r.estado = leido ? 'LEIDO' : 'ENTREGADO'; r.entregadoAt = r.entregadoAt || now; r.proximoAt = Infinity; r.toqueAt = Infinity; r.plazoAt = Infinity; }
  this._d({ msgId: id, ev: leido ? 'leido' : 'acuse', at: now });
  return true;
};
// El único temporizador: lo más cercano de todo (proximoAt, plazo o toque)
Calendario.prototype.proximo = function() {
  var t = Infinity;
  this.m.forEach(function(r) { if (!reenviable(r)) return; t = Math.min(t, r.estado === 'GUARDADO' ? r.toqueAt : r.estado === 'EN_CAMINO' ? r.plazoAt : r.proximoAt); });
  return t;
};
// Unir el diario del otro ejecutor (idempotente): lo que el nativo hizo con la app oculta (o al revés) ANTES de mandar nada
Calendario.prototype.unir = function(diario) {
  var self = this, n = 0;
  (diario || []).forEach(function(e) {
    var k = e.msgId + '|' + e.ev + '|' + e.at + '|' + (e.carril || ''); if (self.vistos[k]) return;
    self.vistos[k] = 1; self.diario.push(e); n++;
    var r = self.m.get(e.msgId);
    if (e.ev === 'crear' && !r) { r = self.crear({ msgId: e.msgId, nx: e.nx, tipo: e.tipo, chars: e.chars }, e.at); return; }
    if (!r) return;
    if (e.ev === 'salir') { r.intentos.push({ carril: e.carril, at: e.at, rele: e.rele || '', por: e.por }); r.sobres++; if (r.estado !== 'GUARDADO' && reenviable(r)) { r.estado = 'EN_CAMINO'; r.proximoAt = Infinity; r.plazoAt = e.at + CAL.PLAZO_TEXTO_MS; } }
    else if (e.ev === 'guardado' && reenviable(r)) { if (r.estado !== 'GUARDADO') { r.guardadoAt = e.at; r.toqueI = 0; r.toqueAt = toqueAt(e.at, 0); } r.estado = 'GUARDADO'; r.proximoAt = Infinity; r.plazoAt = Infinity; if (e.donde) r.guardadoEn.push(Object.assign({ at: e.at }, e.donde)); }
    else if (e.ev === 'rechazo' && r.estado === 'EN_CAMINO') { r.estado = e.hecho === 'pausa' ? 'PAUSADO' : 'CREADO'; r.proximoAt = typeof e.prox === 'number' ? e.prox : e.at; r.plazoAt = Infinity; }
    else if (e.ev === 'toque' && r.estado === 'GUARDADO' && e.i > r.toqueI) { r.toqueI = e.i; r.toqueAt = toqueAt(r.guardadoAt, e.i); }
    else if (e.ev === 'acuse' || e.ev === 'leido') { r.estado = e.ev === 'leido' ? 'LEIDO' : (r.estado === 'LEIDO' ? 'LEIDO' : 'ENTREGADO'); r.proximoAt = Infinity; r.toqueAt = Infinity; r.plazoAt = Infinity; }
  });
  return n;
};
// Para ruta_plan.json (A.7.2): lo que sigue pendiente
Calendario.prototype.pendientes = function() {
  var out = [];
  this.m.forEach(function(r) { if (reenviable(r)) out.push({ msgId: r.msgId, nx: r.nx, tipo: r.tipo, estado: r.estado, proximoAt: r.proximoAt === Infinity ? null : r.proximoAt, intentos: r.intentos.length, guardadoEn: r.guardadoEn }); });
  return out;
};
