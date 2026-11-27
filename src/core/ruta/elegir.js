// Fase 1 del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §B.2 y §D.3 1a): MODO SOMBRA del cambio entre caminos.
// `situacion()` y `elegirTexto()` son PURAS (sin red, sin reloj, sin estado global): de los hechos de un contacto sacan la situación (S1–S9)
// y el camino que la tabla TEXTO elegiría. `Sombra` solo CUENTA y ANOTA «[RUTA-SOMBRA] elegiría X / se hizo Y»: NO manda nada ni cambia
// el camino de hoy. PORQUÉ (contrato D.3): medir la tabla con el tráfico real antes de darle el mando; las diferencias enseñan qué
// casos escondidos cubren hoy los mecanismos viejos. Para pasar la fase 1: coincidir ≥ 95 % o cada diferencia explicada.
// Los hechos vienen de ADAPTADORES de lo de hoy (aproximados, contrato D.3 [RIESGO]): Wi-Fi local lista, Bluetooth cerca, internet propio,
// el otro oído por internet, buzón posible, puente Jump.

// hechos: { lan, cerca, yoNet, gw, elNet, buzon, jump }  (todos booleanos)
//   lan   = Wi-Fi local con él comprobada (lan.canReach)       cerca = Bluetooth con él listo o visto hace poco
//   yoNet = tengo internet propio (no solo prestado)            gw    = solo internet prestado por un vecino (puente)
//   elNet = lo oigo por internet ahora (net.canReach)           buzon = puedo dejarle algo en los relés (mailboxOk)
//   jump  = hay ruta por otro teléfono (relayHop)
export function situacion(h) {
  h = h || {};
  if (h.lan) return 'S1';
  if (h.cerca) return (h.yoNet && h.elNet) ? 'S3' : 'S4';
  if (h.yoNet && h.buzon) return h.elNet ? 'S5' : 'S6';
  if (h.gw && h.buzon) return 'S7';
  if (h.jump) return 'S8';
  return 'S9';
}

// Tabla TEXTO (B.2.3): el 1.º de cada situación
var PRIMERO_TEXTO = { S1: 'lan', S2: 'net.relay', S3: 'net.relay', S4: 'ble.gatt', S5: 'net.relay', S6: 'net.relay', S7: 'net.gw', S8: 'jump', S9: 'PAUSADO' };
export function elegirTexto(h) { var s = situacion(h); return { sit: s, carril: PRIMERO_TEXTO[s] }; }

// El camino que se usó de verdad, con lo que decidió el código de hoy
//   real: { deviceId, jump, buzon, gwOnly }  →  'lan' | 'net.relay' | 'net.gw' | 'ble.gatt' | 'wd' | 'jump' | 'PAUSADO'
export function carrilReal(real) {
  real = real || {};
  if (real.jump) return 'jump';
  var d = String(real.deviceId || '').toLowerCase();
  if (/^lan:?nx/.test(d)) return 'lan';
  if (/^wd:?nx/.test(d)) return 'wd';
  if (/^net:?nx/.test(d)) return real.gwOnly ? 'net.gw' : 'net.relay';
  if (d) return 'ble.gatt';
  if (real.buzon) return real.gwOnly ? 'net.gw' : 'net.relay';
  return 'PAUSADO';
}

// Contador de la sombra: total, iguales y las diferencias por «situación:elegiría>se hizo»
export function Sombra(log) {
  this.total = 0; this.iguales = 0; this.difs = {};
  this._log = typeof log === 'function' ? log : function() {};
}
Sombra.prototype.anotar = function(msgId, tipo, hechos, real) {
  var e = elegirTexto(hechos), hizo = carrilReal(real), igual = e.carril === hizo;
  this.total++;
  if (igual) this.iguales++;
  else { var k = e.sit + ':' + e.carril + '>' + hizo; this.difs[k] = (this.difs[k] || 0) + 1; }
  this._log('[RUTA-SOMBRA] ' + String(msgId || '?') + ' ' + tipo + ' ' + e.sit + ' elegiría ' + e.carril + ' / se hizo ' + hizo + (igual ? '' : ' ≠'));
  if (this.total % 20 === 0) this._log('[RUTA-SOMBRA] resumen: ' + this.resumen());
  return { sit: e.sit, elegiria: e.carril, hizo: hizo, igual: igual };
};
Sombra.prototype.resumen = function() {
  var p = this.total ? Math.round(this.iguales * 100 / this.total) : 100, self = this;
  var d = Object.keys(this.difs).sort(function(a, b) { return self.difs[b] - self.difs[a]; }).slice(0, 6).map(function(k) { return k + ' ×' + self.difs[k]; });
  return this.iguales + '/' + this.total + ' iguales (' + p + ' %)' + (d.length ? '; diferencias: ' + d.join(', ') : '');
};
