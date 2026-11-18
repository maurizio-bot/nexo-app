/**
 * call_bridge.js — «Unir» con MI teléfono de PUENTE (build 3217; el dueño lo aprobó el 17-11 a las 19:25: su caso real son amigos que
 * llaman cada uno desde su casa, por internet, y la llamada de grupo —malla por Bluetooth o el mismo Wi-Fi, 3216— no puede).
 * Las dos llamadas 1-a-1 siguen tal cual, cada una por su camino (internet directo o relés, Bluetooth o Wi-Fi), las dos en curso y sin
 * espera. A cada uno le llega mi micrófono MÁS la voz del otro y nunca la suya (sin eco): call_media.js decodifica la voz de A para
 * oírla y, con setTap, la pasa a mi llamada con B, que la suma a mi micrófono (mixIn) antes de codificar; y al revés. Como el audio
 * de toda llamada 1-a-1 va en los mismos paquetes cifrados por cualquier camino (también el canal directo de internet), la mezcla
 * vale para todos los caminos.
 *  - A y B reciben 'conf' (por la señalización que ya tienen conmigo) con quién más está: ven a los tres y «B se unió a la llamada».
 *    Las versiones que no lo entienden lo ignoran y simplemente oyen la mezcla.
 *  - Si uno cuelga, el otro sigue conmigo en su llamada 1-a-1 normal (y se le dice que el otro salió). Si cuelgo yo, se acaba todo:
 *    el puente soy yo. Silenciar me silencia en las dos.
 *  - Solo VOZ en esta versión: si una de las dos era videollamada, la imagen sigue entre cada uno y yo (no se reenvía de uno a otro).
 *  - Sin temporizadores ni procesos propios: la mezcla trabaja dentro del audio de cada llamada y se suelta al colgar.
 */

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }

export function bridgeOf(ble) { var b = ble && ble._bridge; return b && b.on ? b : null; }

function Bridge(ble, lanes, nameOf) {
  this.ble = ble; this.lanes = lanes.slice(0, 2); this.nameOf = nameOf; this.on = true; this.ending = false; this.since = Date.now();
  this.ids = this.lanes.map(function(l) { return l.call && l.call.id; });
}
Bridge.prototype.has = function(l) { return this.on && this.lanes.indexOf(l) >= 0; };
Bridge.prototype.other = function(l) { return this.lanes[0] === l ? this.lanes[1] : this.lanes[0]; };
Bridge.prototype.peers = function() { return this.lanes.map(function(l) { return l.call ? _nid(l.call.nx) : ''; }).filter(Boolean); };
Bridge.prototype.video = function() { return this.lanes.some(function(l) { return !!(l.call && l.call.video); }); };
Bridge.prototype._name = function(nx) { return (this.nameOf && this.nameOf(nx)) || String(nx || '').toUpperCase(); };
// La voz decodificada de cada uno entra en lo que le mando al otro
Bridge.prototype._wire = function() {
  var self = this, n = 0;
  self.lanes.forEach(function(l) {
    var m = l.call && l.call.media, o = self.other(l);
    if (!m || typeof m.setTap !== 'function') return;
    m.setTap(function(pcm, rate) {
      var c2 = o.call, m2 = c2 && c2.media;
      if (self.on && m2 && c2.state === 'active' && typeof m2.mixIn === 'function') m2.mixIn(pcm, rate);
    });
    n++;
  });
  return n;
};
Bridge.prototype._unwire = function() {
  this.lanes.forEach(function(l) { var m = l.call && l.call.media; if (m && typeof m.setTap === 'function') { try { m.setTap(null); } catch (e) {} } });
};
// A cada uno: quién más está (el otro); [] = ya no hay nadie más
Bridge.prototype._announce = function(l, who) {
  var c = l && l.call; if (!c || c.state !== 'active' || typeof l._signal !== 'function') return;
  l._signal(c.nx, 'conf', { who: who });
};
// Una de las dos terminó (calls._finish): con la otra sola ya no hay puente; si no la colgué yo, al otro se le dice que salió
Bridge.prototype.laneEnded = function(l) {
  if (!this.on || this.lanes.indexOf(l) < 0) return;
  this.on = false;
  this._unwire();
  if (this.ble && this.ble._bridge === this) this.ble._bridge = null;
  var o = this.other(l);
  if (!this.ending) this._announce(o, []);
  console.log('[CALL] Puente terminado (' + (this.ending ? 'colgué yo' : 'uno colgó: el otro sigue conmigo') + ')');
  if (o.call && typeof o._set === 'function') o._set({}); // su pantalla vuelve a ser la de una llamada normal
  _emit('nexo:callBridge', null);
};
// Colgar yo = se acaba todo
Bridge.prototype.hangupAll = function() {
  if (this.ending) return; this.ending = true;
  this.lanes.slice().forEach(function(l) { if (l.call) { try { l.hangup(); } catch (e) {} } });
};
// Silenciar me silencia en las dos (la voz de uno al otro sigue pasando)
Bridge.prototype.mirrorMute = function(l, on) {
  var o = this.other(l), c = o && o.call; if (!c) return;
  c.muted = !!on;
  if (c.media && c.media.mute) { try { c.media.mute(!!on || !!c.held); } catch (e) {} }
};
Bridge.prototype.state = function() {
  var self = this;
  return { on: self.on, since: self.since, peers: self.peers(), video: self.video(), names: self.peers().map(function(nx) { return self._name(nx); }) };
};

// Empieza el puente con las dos llamadas 1-a-1 (una en curso; la otra en curso, en espera o sonando: se contesta ya)
export function startBridge(ble, lanes, nameOf) {
  if (!ble || !lanes || lanes.length !== 2 || bridgeOf(ble)) return Promise.reject(new Error('sin dos llamadas'));
  var br = new Bridge(ble, lanes, nameOf);
  ble._bridge = br; // antes de contestar: así la que contesto no deja a la otra en espera (_holdOthers)
  lanes.forEach(function(l) { var c = l.call; if (c && c.dir === 'in' && c.state === 'ringing') l.accept(); });
  lanes.forEach(function(l) { var c = l.call; if (c && (c.userHold || c.held) && typeof l._applyHold === 'function') { c.userHold = false; l._applyHold(c); } });
  var wired = br._wire();
  var a = lanes[0].call, b = lanes[1].call;
  if (a && b) {
    br._announce(lanes[0], [{ nx: _nid(b.nx), n: br._name(b.nx) }]);
    br._announce(lanes[1], [{ nx: _nid(a.nx), n: br._name(a.nx) }]);
  }
  console.log('[CALL] Unir por PUENTE (mi teléfono mezcla): ' + br.peers().join(' y ') + (wired < 2 ? ' — sin mezcla en ' + (2 - wired) + ' de las dos' : '') + (br.video() ? ' (el vídeo sigue entre cada uno y yo)' : ''));
  lanes.forEach(function(l) { if (l.call && typeof l._set === 'function') l._set({}); });
  _emit('nexo:callBridge', br.state());
  return Promise.resolve(true);
}
