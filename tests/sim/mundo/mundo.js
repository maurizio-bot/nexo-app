// Banco «mundo» del contrato de los caminos (docs/CONTRATO_CAMINOS_28-11.md §C): reloj simulado, teléfonos con su ContactoRuta y su
// Calendario (app y «nativo» con testigo y diario), y relés Nostr SIMULADOS (modelo en memoria: OK / duplicate / rate-limited / banned /
// blocked, entrega en vivo a quien escucha y bajada al despertar). Mide en cada escenario: sobres por mensaje (escrituras en relés),
// cambios de camino con causa, tiempo hasta ✓ y ✓✓, duplicados vistos por el receptor (debe ser 0) y sobres a relés en pausa (0).
// Lo que NO simula: la radio real y el código de red de la app (eso lo prueban net.js, bignet.js, relevo.js, leeen.js…). Aquí se prueba
// la LÓGICA nueva (calendario, política de relés, estado por contacto) contra los escenarios de la fase 1.
'use strict';

function Mundo(mods, opts) {
  this.M = mods; this.t = 1800000000000; this.t0 = this.t; this.reles = {}; this.tel = {}; this.semilla = (opts && opts.semilla) || 7;
  this.cola = []; // [{at, fn}]
}
Mundo.prototype.rnd = function() { this.semilla = (this.semilla * 1103515245 + 12345) % 2147483648; return this.semilla / 2147483648; };
Mundo.prototype.rele = function(url, o) {
  this.reles[url] = Object.assign({ url: url, ev: new Map(), limitaHasta: 0, castigaHasta: 0, politica: false, limitePorMin: 0, escrituras: [], enPausa: 0, subs: new Set(), caido: false }, o || {});
  return this.reles[url];
};
Mundo.prototype.luego = function(ms, fn) { this.cola.push({ at: this.t + ms, fn: fn }); };
// Publicar un evento en un relé: la respuesta como la da un relé Nostr
Mundo.prototype.publicar = function(url, ev, de) {
  var r = this.reles[url]; if (!r || r.caido) return { ok: false, msg: 'error: no conecta' };
  r.escrituras.push({ at: this.t, id: ev.id, ids: ev.ids, de: de && de.nx });
  var pz = de && de.misPausas && de.misPausas(); if (pz && pz[url] && pz[url].hasta > this.t) r.enPausa++;
  if (r.politica) return { ok: false, msg: 'blocked: Policy violated and pubkey is not in our web of trust' };
  if (this.t < r.castigaHasta) return { ok: false, msg: 'banned: too many rate-limit violations, try again later' };
  if (this.t < r.limitaHasta) return { ok: false, msg: 'rate-limited: slow down' };
  if (r.limitePorMin) { var t = this.t, n = r.escrituras.filter(function(e) { return t - e.at < 60000; }).length; if (n > r.limitePorMin) { r.limitados = (r.limitados || 0) + 1; return { ok: false, msg: 'rate-limited: too many gift wraps' }; } }
  if (r.ev.has(ev.id)) return { ok: false, msg: 'duplicate: already have this event' };
  r.ev.set(ev.id, ev);
  var self = this; r.subs.forEach(function(nx) { var tel = self.tel[nx]; if (tel && ev.p === nx) self.luego(300, function() { tel.recibir(ev, url); }); }); // en vivo: solo lo NUEVO
  return { ok: true, msg: '' };
};

// ---------- Teléfono ----------
function Tel(mundo, nx, o) {
  var M = mundo.M; this.w = mundo; this.nx = nx; o = o || {};
  this.lee = o.lee || [];             // dónde escucho (y anuncio)
  this.mios = o.mios || this.lee.slice(); // dónde publico sin anuncio (los míos de siempre)
  this.soloLeer = o.soloLeer || [];   // reservas que solo escucho
  this.app = o.app !== false;         // la app a la vista/viva
  this.escucha = o.escucha !== false; // alguien (app o nativo) escucha los relés
  this.fcm = o.fcm !== false; this.fcmDegradado = !!o.fcmDegradado; this.toqueDespierta = o.toqueDespierta !== false;
  this.cal = new M.C.Calendario({ rnd: mundo.rnd.bind(mundo), quien: 'app' });
  this.nat = new M.C.Calendario({ rnd: mundo.rnd.bind(mundo), quien: 'nativo' });
  this.testigo = new M.C.Testigo(); this.testigo.tomar('app', mundo.t, true);
  this.pausas = {}; this.pausasNat = {}; this.puntos = {};
  this.cr = {}; this.anuncios = {};    // nx → ContactoRuta; nx → {lee, at}
  this.recibidos = {}; this.dups = 0; this.toques = 0; this.toquesPor = {}; this.cambios = [];
  this.eventos = {};                   // msgId → ev (el MISMO evento firmado para republicar)
  this.juntar = o.juntar !== false;
  this.republicados = 0; this.rateLimited = 0;
  var self = this;
  this.lee.concat(this.soloLeer).forEach(function(u) { if (mundo.reles[u]) mundo.reles[u].subs.add(self.nx); });
}
Tel.prototype.ejecutor = function() { return this.app ? this.cal : this.nat; };
Tel.prototype.contacto = function(nx) { return this.cr[nx] || (this.cr[nx] = this.w.M.R.nuevo(nx)); };
Tel.prototype.ocultar = function() { // A.7.3: al ocultarse, pasa el testigo con el plan (el nativo hereda calendario y pausas)
  this.app = false; this.testigo.pasar('nativo', this.w.t);
  this.nat.unir(this.cal.diario); this.pausasNat = this.w.M.P.juntarPausas(this.pausasNat, this.pausas, this.w.t);
};
Tel.prototype.mostrar = function() { // la app vuelve: toma el testigo y UNE el diario del nativo ANTES de mandar nada
  this.app = true; this.testigo.tomar('app', this.w.t, true);
  this.cal.unir(this.nat.diario); this.pausas = this.w.M.P.juntarPausas(this.pausas, this.pausasNat, this.w.t);
};
Tel.prototype.misPausas = function() { return this.app ? this.pausas : this.pausasNat; };
Tel.prototype.anunciar = function(a) { var b = this.w.tel[a]; if (b) b.anuncios[this.nx] = { lee: this.lee.slice(), at: this.w.t }; };
Tel.prototype.escribir = function(a, msgId, tipo, chars) { return this.ejecutor().crear({ msgId: msgId, nx: a, tipo: tipo || 'TEXTO', chars: chars || 200 }, this.w.t); };

// Un tick: vence plazos, manda lo debido (juntado), toca lo que toca
Tel.prototype.tick = function() {
  var w = this.w, M = w.M, now = w.t, self = this, cal = this.ejecutor(), quien = this.app ? 'app' : 'nativo';
  if (!this.testigo.puede(quien, now)) { if (!this.testigo.tomar(quien, now)) return; }
  cal.vencer(now);
  var deb = cal.debidos(now); if (!deb.length) { this._tocar(cal); return; }
  var lista = deb.map(function(r) { return { msgId: r.msgId, nx: r.nx, carril: 'net.relay', tipo: r.tipo, chars: r.chars }; });
  var grupos = this.juntar ? M.C.juntar(lista) : lista.map(function(m) { return [m.msgId]; });
  grupos.forEach(function(ids) { self._mandar(cal, ids); });
  this._tocar(cal);
};
Tel.prototype._mandar = function(cal, ids) {
  var w = this.w, M = w.M, now = w.t, self = this, r0 = cal.get(ids[0]), nx = r0.nx;
  var pool = Object.keys(w.reles), an = this.anuncios[nx], lee = an ? M.P.lecturasDe(an, pool, now) : null;
  var pausas = this.misPausas();
  var vista = this.mios.concat(this.soloLeer).map(function(u) { var p = pausas[u]; return { url: u, abierto: !w.reles[u].caido, hasta: p ? p.hasta : 0, soloLeer: self.soloLeer.indexOf(u) >= 0 }; });
  var d = M.P.destinos(vista, lee, now);
  if (!d.publicar.length) {
    var e = d.motivo === 'en_pausa' ? M.MO.error('LIMITADO', Math.max(1000, Math.min.apply(null, d.pausados.map(function(u) { return pausas[u].hasta; })) - now)) : M.MO.error('SIN_RUTA');
    ids.forEach(function(id) { cal.resultado(id, 'net.relay', { error: e }, now); });
    return;
  }
  var dest = M.PU.ordenar(d.publicar, this.puntos, now); if (lee) dest = dest.slice(0, 2); // objetivo: 2 de su lista (B.5.2)
  if (!cal.salirJuntos(ids, 'net.relay', now, dest.join(','))) return; // cupo por contacto: queda en PAUSADO(CUPO)
  // el MISMO evento firmado si es un reintento de lo mismo (republicar.js); uno nuevo si no
  var clave = ids.join('+'), mismo = ids.every(function(id) { var r = cal.get(id); return r && r.mismoEvento; });
  var ev = (mismo && this.eventos[clave]) || { id: 'ev' + Math.floor(w.rnd() * 1e9).toString(36) + ids.length, p: nx, ids: ids.slice(), de: this.nx };
  if (mismo && this.eventos[clave]) this.republicados++;
  this.eventos[clave] = ev;
  var guardo = false, castigo = null;
  dest.forEach(function(u) {
    var t0 = w.t, res = w.publicar(u, ev, self), acc = M.MO.deRele(res.ok, res.msg);
    M.PU.anotar(self.puntos[u] || (self.puntos[u] = M.PU.nuevo()), acc.aceptado, 300, acc.error && acc.error.tipo === 'LIMITADO', now);
    if (acc.aceptado && M.P.daGuardado(u, lee)) guardo = u;
    if (!acc.aceptado) {
      if (/rate-limited/.test(res.msg)) self.rateLimited++;
      var st = M.P.anotarLimite(pausas[u] || null, res.msg, now); if (st) pausas[u] = st;
      castigo = acc.error;
    }
  });
  ids.forEach(function(id) {
    if (guardo) cal.resultado(id, 'net.relay', { aceptado: true, donde: { tipo: 'rele', url: guardo } }, now);
    else cal.resultado(id, 'net.relay', { error: castigo && castigo.tipo === 'LIMITADO' ? M.MO.error(castigo.causa, 20000) : (castigo || M.MO.error('DESCONOCIDO')) }, now);
  });
};
Tel.prototype._tocar = function(cal) {
  var w = this.w, M = w.M, self = this, ts = cal.toques(w.t);
  var pend = {}; // el primer pendiente sin ✓✓ por contacto
  cal.m.forEach(function(r) { if (M.MO.reenviable(r) && !pend[r.nx]) pend[r.nx] = r.msgId; });
  ts.forEach(function(t) {
    var b = w.tel[t.nx], cr = self.contacto(t.nx);
    cr.fcm = { tiene: !!(b && b.fcm), degradado: !!(b && b.fcmDegradado) }; // B.5.6: él lo anunció en su saludo
    if (b) M.R.ponerDespierto(cr, { appAt: b.app ? w.t : 0, fcm: b.fcm }, w.t);
    if (!M.R.tocar(cr, 'texto', pend[t.nx] === t.msgId)) return;
    self.toques++; self.toquesPor[t.msgId] = (self.toquesPor[t.msgId] || 0) + 1;
    if (b && !b.escucha && !b.fcmDegradado && b.toqueDespierta) w.luego(3000, function() { b.despertar(); });
  });
};
// Recibir un evento (en vivo o al bajar): deduplicar por msgId; el acuse V3 vuelve al emisor 1 s después
Tel.prototype.recibir = function(ev, url) {
  if (!this.escucha) return;
  var self = this, w = this.w, a = w.tel[ev.de];
  ev.ids.forEach(function(id) {
    if (self.recibidos[id]) { if (self.recibidos[id] !== ev.id) self.dups++; return; }
    self.recibidos[id] = ev.id;
    if (a) w.luego(1000, function() { a.ejecutor().acuse(id, w.t); });
  });
};
// Despierta (toque o abre la app): baja lo que hay para él en los relés que lee
Tel.prototype.despertar = function(conApp) {
  var w = this.w, self = this; this.escucha = true; if (conApp) this.app = true;
  this.lee.concat(this.soloLeer).forEach(function(u) { var r = w.reles[u]; if (!r) return; r.subs.add(self.nx); r.ev.forEach(function(ev) { if (ev.p === self.nx) self.recibir(ev, u); }); });
};
Tel.prototype.dormir = function() { var w = this.w, self = this; this.escucha = false; this.app = false; Object.keys(w.reles).forEach(function(u) { w.reles[u].subs.delete(self.nx); }); };

// Avanzar el reloj de 1 s en 1 s
Mundo.prototype.correr = function(ms, cada) {
  var fin = this.t + ms, self = this;
  while (this.t < fin) {
    this.t += (cada || 1000);
    this.cola.sort(function(a, b) { return a.at - b.at; });
    while (this.cola.length && this.cola[0].at <= this.t) { var c = this.cola.shift(); c.fn(); }
    Object.keys(this.tel).forEach(function(nx) { self.tel[nx].tick(); });
  }
};
Mundo.prototype.telefono = function(nx, o) { this.tel[nx] = new Tel(this, nx, o); return this.tel[nx]; };
// Escrituras de un mensaje en relés (sobres de ese mensaje: un sobre juntado cuenta para todos los que lleva)
Mundo.prototype.escriturasDe = function(msgId) {
  var n = 0, self = this;
  Object.keys(this.reles).forEach(function(u) { self.reles[u].escrituras.forEach(function(e) { if (e.ids && e.ids.indexOf(msgId) >= 0) n++; }); });
  return n;
};
Mundo.prototype.escrituras = function() { var n = 0, self = this; Object.keys(this.reles).forEach(function(u) { n += self.reles[u].escrituras.length; }); return n; };
Mundo.prototype.enPausa = function() { var n = 0, self = this; Object.keys(this.reles).forEach(function(u) { n += self.reles[u].enPausa; }); return n; };

module.exports = { Mundo: Mundo };
