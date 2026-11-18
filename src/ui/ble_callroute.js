import { _normId, _isGroupCopy, _groupCopyGid } from './ble_helpers.js';
// Métodos de BLE_MESSAGE_METHODS: LLAMADAS: cuántas hay, en espera, a qué línea va cada señal, la radio durante una llamada.
// Reestructuración 15-11: movidos TAL CUAL desde ble_messages.js, que los une en BLE_MESSAGE_METHODS.
export const BLE_CALLROUTE_METHODS = {

  // 3058 (diagnóstico del dueño 13-11 07:28, S24 + vivo en la 3039): al apagar el Wi-Fi en una videollamada, la voz siguió por
  // Bluetooth, pero al colgar y volver a llamar la oferta no llegó en 10 s, el «colgar» del vivo tampoco, y el Motorola vio al
  // S24 «zombi». A la vez los dos le mandaban por Bluetooth, una y otra vez, lo pendiente a la tablet (lejos y con la app dormida:
  // directo, y el vivo como puente Jump). Regla: con una LLAMADA en curso (sonando o hablando, de 2 o de grupo) la radio
  // Bluetooth es de la llamada: lo de fondo que iría por Bluetooth (reenvío de pendientes, reanudaciones, custodias Jump, Fénix)
  // espera a colgar y entonces sale. Lo nuevo que escribe el usuario y las señales de la llamada salen como siempre; lo que
  // va por Wi-Fi o internet no espera.
  _callBusy() { return !!((this.calls && this.calls.call) || (this.calls2 && this.calls2.call) || (this.gcall && this.gcall.gc)); },
  // #222 (dueño 15-11: «contestar y poder pausar la otra en automático y poderla revisar manualmente»): las llamadas a la vez
  // (1-a-1 primera, 1-a-1 segunda, grupo; máximo 2). Al empezar a hablar en una, las demás en curso pasan a EN ESPERA; al colgar,
  // si queda una sola y estaba en espera por el usuario, vuelve sola.
  _callList() { var l = []; if (this.calls && this.calls.call) l.push(this.calls); if (this.calls2 && this.calls2.call) l.push(this.calls2); if (this.gcall && this.gcall.gc) l.push(this.gcall); return l; },
  _callActive(x) { return x === this.gcall ? !!(x.gc && x.gc.state === 'active') : !!(x.call && x.call.state === 'active'); },
  _callHeldByUser(x) { return x === this.gcall ? !!(x.gc && x.gc.held) : !!(x.call && x.call.userHold); },
  _callCount() { return this._callList().length; },
  _holdOthers(keep) {
    var self = this;
    var br = self._bridge && self._bridge.on ? self._bridge : null; // 3217: las dos del puente («Unir» por mi teléfono) siguen las dos en curso
    self._callList().forEach(function(x) { if (x !== keep && !(br && br.has(x) && br.has(keep)) && self._callActive(x) && !self._callHeldByUser(x) && typeof x.hold === 'function') x.hold(true); });
  },
  _resumeLoneCall() {
    var self = this;
    clearTimeout(self._resumeT);
    self._resumeT = setTimeout(function() {
      var act = self._callList().filter(function(x) { return self._callActive(x); });
      if (act.length === 1 && self._callHeldByUser(act[0]) && typeof act[0].hold === 'function') act[0].hold(false);
    }, 300);
  },
  // #220 fase 2: ¿a qué llamada va esta señal? A la que la tiene (por id o por el contacto); una llamada NUEVA con la primera ya
  // ocupada con otro contacto va a la segunda; con dos llamadas ya en curso (contando la de grupo), la primera contesta «ocupado».
  _callSignal(from, o, mid) {
    var c1 = this.calls, c2 = this.calls2;
    if (!c2 || !o) return c1 && c1.onSignal(from, o, mid);
    var nx = _normId(from), a = c1 && c1.call, b = c2.call, id = o.id;
    if (b && (b.id === id || (b.nx === nx && o.op !== 'offer'))) return c2.onSignal(from, o, mid);
    if (a && (a.id === id || a.nx === nx)) return c1.onSignal(from, o, mid);
    var busy = (a ? 1 : 0) + (b ? 1 : 0) + (this.gcall && this.gcall.gc ? 1 : 0);
    if (o.op === 'offer' && busy === 1 && !b && (a || (this.gcall && this.gcall.gc))) {
      if (!a) return c1.onSignal(from, o, mid); // con la de grupo en curso, la nueva 1-a-1 va a la primera
      console.log('[CALL] Segunda llamada (de ' + nx + ') mientras hablas con ' + a.nx + ': suena abajo');
      return c2.onSignal(from, o, mid);
    }
    return c1.onSignal(from, o, mid); // con dos en curso, la primera contesta «ocupado» (máximo 2)
  },
  // 3097 (diagnóstico S24 3054 14-11 16:15–16:19: videollamada por Wi-Fi con el Xiaomi y lo del S23, que solo iba por Bluetooth,
  // esperó 4,5 min a colgar): la radio Bluetooth solo es de la llamada si la llamada va POR Bluetooth (alguno de sus tramos ahora).
  // Por Wi-Fi, internet directo o relés, el Bluetooth queda libre para lo de fondo. Ante la duda (error al mirar), como antes.
  _callUsesBle() {
    if (!this._callBusy()) return false;
    var isBle = function(l) { return !!l && !/^(lan|net|p2p|wd):/i.test(String(l)); };
    try {
      var calls = this.calls, c = calls && calls.call;
      if (c && typeof calls._link === 'function' && isBle(calls._link(_normId(c.nx)))) return true;
      var calls2 = this.calls2, c2 = calls2 && calls2.call;
      if (c2 && typeof calls2._link === 'function' && isBle(calls2._link(_normId(c2.nx)))) return true;
      var g = this.gcall, gc = g && g.gc, hit = false;
      if (gc && gc.legs && typeof g._link === 'function') gc.legs.forEach(function(leg, nx) { if (!hit && isBle(g._link(_normId(nx)))) hit = true; });
      return hit;
    } catch (e) { return true; }
  },
  // ¿Lo de fondo para este contacto iría por Bluetooth (directo o por un puente Bluetooth) estando en llamada? → espera a colgar
  _callRadioHold(nexoId, why) {
    var self = this, nx = _normId(nexoId);
    if (!nx || !self._callUsesBle()) return false;
    var dev = self._resolveDeviceIdForNexoId(nx);
    if (dev && /^(lan|net)/i.test(String(dev))) return false;
    if (!dev) { var rh = self.relay && self.relay.relayHop(nx); if (!rh || /^(lan|net)/i.test(String(rh.deviceId))) return false; }
    self._callHeld = self._callHeld || new Set();
    if (!self._callHeld.has(nx)) console.log('[BLEInterface] En llamada: ' + (why || 'lo pendiente') + ' para ' + nx + ' por Bluetooth espera a colgar (la radio es de la llamada)');
    self._callHeld.add(nx);
    return true;
  },
  // Al colgar (calls.js / group_call.js): sale lo que esperó (después de la señal de colgar)
  _afterCallRadio() {
    var self = this;
    clearTimeout(self._afterCallT);
    self._afterCallT = setTimeout(function() {
      if (self._callBusy()) return;
      var held = self._callHeld ? Array.from(self._callHeld) : [];
      self._callHeld = new Set();
      if (held.length) console.log('[BLEInterface] Llamada terminada: sale lo que esperaba por Bluetooth (' + held.join(', ') + ')');
      held.forEach(function(nx) {
        try { var dev = self._resolveDeviceIdForNexoId(nx); if (dev) self._processPendingMessages(dev); } catch (e) {}
        try { self._resendPendingMessages(nx); } catch (e) {}
      });
      try { if (self.ackSystem && typeof self.ackSystem.resumeOutgoingTransfers === 'function') self.ackSystem.resumeOutgoingTransfers(); } catch (e) {}
      try { if (self.relay && typeof self.relay._flushQueue === 'function') self.relay._flushQueue(); } catch (e) {}
    }, 1500);
  },

  // 3033: los mensajes guardados como ocultos (acciones) se reenvían sin aviso en el otro teléfono (ver _resendPendingMessages)
  // 3076 (notifghost.js G5): la COPIA de un mensaje de grupo también se guarda oculta en el chat del miembro, pero para él es un
  // mensaje: no va callada (antes salía con q:1 y el miembro con la app cerrada no se enteraba) y recupera el id del grupo para
  // que su aviso caiga en el grupo y no en el chat 1-a-1 (ese mapa vivía solo en memoria y se perdía al reiniciar la app).
  _markHiddenQuiet(list) {
    var self = this;
    (list || []).forEach(function(m) {
      var id = m && (m.msgId || m.messageId || m.id);
      if (!id || m.hidden !== true) return;
      if (_isGroupCopy(m)) {
        var gid = _groupCopyGid(m);
        if (gid) { self._groupOut = self._groupOut || new Map(); self._groupOut.set(id, gid); if (self._groupOut.size > 500) self._groupOut.delete(self._groupOut.keys().next().value); }
        if (self._quietOut) self._quietOut.delete(id);
        return;
      }
      self._quietOut = self._quietOut || new Set(); self._quietOut.add(id);
    });
  },
};
