// Fase 1 del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §B.4.2 y §D.2): reintentar por internet = republicar el MISMO
// evento ya firmado y cifrado (mismo id), no volver a cifrar. PORQUÉ: cada re-cifrado es un evento NUEVO para el relé (otro «gift wrap»
// que cuenta para su límite: «rate-limited: too many gift wraps» → «banned», diag. 26-11/27-11) y otro sobre que el otro teléfono baja
// y descarta. Con el mismo id, el relé que ya lo tenía contesta «duplicate» (no cuenta como otro) y el que recibe lo cuenta una vez.
// PURA: sin red ni reloj propio (el «ahora» y el día los pasa quien llama). El mismo paquete al mismo contacto, el mismo día de etiqueta
// y dentro de la ventana, devuelve el evento guardado; si no, null (se cifra uno nuevo, como siempre).

export const REPUB = Object.freeze({
  VENTANA_MS: 30 * 60000,   // un reintento dentro de 30 min reusa el evento (lo guardado no se republica antes: _netWindowStored)
  MARGEN_CADUCA_S: 120,     // no reusar un evento al que le quedan < 2 min de vida en el relé
  MAX: 400,                 // eventos recordados como mucho (los más viejos se olvidan)
});

// Huella corta del paquete (FNV-1a de 32 bits + largo): no guarda el texto en memoria, solo su huella
export function huella(s) {
  s = String(s == null ? '' : s);
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return s.length.toString(36) + '.' + h.toString(36);
}

export function Republicar() { this.m = new Map(); }
Republicar.prototype.clave = function(nx, paquete, dia) { return String(nx) + '|' + String(dia) + '|' + huella(paquete); };
// El evento a reusar, o null
Republicar.prototype.buscar = function(nx, paquete, dia, ahora) {
  var k = this.clave(nx, paquete, dia), e = this.m.get(k);
  if (!e) return null;
  var exp = 0;
  try { (e.ev.tags || []).forEach(function(t) { if (t && t[0] === 'expiration') exp = Number(t[1]) || 0; }); } catch (x) {}
  if (ahora - e.at > REPUB.VENTANA_MS || (exp && exp * 1000 - ahora < REPUB.MARGEN_CADUCA_S * 1000)) { this.m.delete(k); return null; }
  e.veces++;
  return e;
};
Republicar.prototype.guardar = function(nx, paquete, dia, ev, ttl, ahora) {
  var k = this.clave(nx, paquete, dia);
  this.m.delete(k);
  this.m.set(k, { ev: ev, ttl: ttl, at: ahora, veces: 0 });
  while (this.m.size > REPUB.MAX) this.m.delete(this.m.keys().next().value);
};
// Se olvida (el contacto cambió de clave o de relés: el evento viejo ya no sirve)
Republicar.prototype.olvidar = function(nx) {
  var p = String(nx) + '|', self = this;
  Array.from(this.m.keys()).forEach(function(k) { if (k.indexOf(p) === 0) self.m.delete(k); });
};
