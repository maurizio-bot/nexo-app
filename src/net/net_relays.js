import { _relayHost, RELAY_TARGET_OPEN, RELAY_DEAD_FAILS, RELAY_STABLE_MS, RELAY_FLAP_WINDOW_MS, RELAY_FLAP_MAX, RELAY_MIN_OTHERS, RELAY_FLAP_PENALTY_MS, RELAY_OFFLINE_RETRY_MS, _rnd, RELAY_PROBE_ID, RELAY_PROBE_MS, NET_CHANGE_SETTLE_MS, KIND, MAX_RELAY_FRAME, _event } from './net_link_shared.js';
import { bytesToHex } from '@noble/hashes/utils.js';
// Métodos de NetLink: RELÉS: conectar, caídas y relés inestables, cambios de red, comprobar los callados, suscribirse y lo que llega de ellos.
// Reestructuración 15-11: movidos TAL CUAL desde net_link.js, que los une a la clase (como métodos normales).
export const netRelays = {

  // ---------- relés ----------
  _connect(url) {
    var self = this, r = self.relays.get(url) || { backoff: 2000, waits: new Map() };
    self.relays.set(url, r);
    var ws;
    if (!self._openCount()) self._netTryAt = self._netTryAt || Date.now(); // 3081: desde cuándo se intenta tener internet
    try { ws = r.factory ? r.factory() : new WebSocket(url); } catch (e) { r.retryAt = Date.now() + r.backoff; return; }
    r.ws = ws; r.open = false;
    ws.onopen = function() {
      r.open = true; r.backoff = 2000; r.openedAt = Date.now(); r.rxAt = r.openedAt; r.fails = 0;
      self._spareCheck(); // 3114: volvió uno de los de siempre → quizá sobra el de reserva
      self._subscribe(r);
      if (!r.gw && self.gw && typeof self.gw.realBack === 'function') self.gw.realBack(); // 3052: soltar los puentes a tiempo
      // 3050: a los vecinos a los que dije «no tengo internet», se lo ofrezco ya
      if (!r.gw && self.gw && self.gw.askedBy && self.gw.askedBy.size) setTimeout(function() { try { self.gw._offerAskers(Date.now()); } catch (e) {} }, 500);
      if (self._netChangeAt && !r.gw) {
        console.log('[NET] Relés listos tras el cambio de red en ' + ((Date.now() - self._netChangeAt) / 1000).toFixed(1).replace('.', ',') + ' s'); // i18n-ok: registro (3085)
        try { if (typeof window.NEXO_noteConnect === 'function') window.NEXO_noteConnect('internet', Date.now() - self._netChangeAt); } catch (e) {}
        self._netChangeAt = 0;
      }
      if (self._openCount() === 1) {
        console.log('[NET] Conectado a internet por relés públicos');
        try { if (self._netTryAt && typeof window.NEXO_noteConnect === 'function') window.NEXO_noteConnect('internet', Date.now() - self._netTryAt); } catch (e) {} // 3081
        self._netTryAt = 0;
        setTimeout(function() { self._helloAll(!self._greeted); }, 300); // avisar a los contactos de que estoy
        // Ronda 2780 (pedido del dueño): volvió el internet → reenviar fotos/archivos/textos que quedaron en espera
        if (self.ble && typeof self.ble._netOnline === 'function') setTimeout(function() { self.ble._netOnline(); }, 800);
      }
    };
    ws.onmessage = function(ev) { r.rxAt = Date.now(); self._onRelayMsg(url, r, ev.data); };
    ws.onclose = function() {
      var was = r.open;
      if (!was) r.fails = (r.fails || 0) + 1; // 3114: intentos seguidos que no llegaron a abrir
      var stableFor = r.openedAt ? (Date.now() - r.openedAt) : 0; r.openedAt = 0;
      r.open = false; r.ws = null; r.sub = null;
      // P5: decide el retraso (reintento normal con backoff, o apartar el relé si flapea y quedan otros)
      var delay = self._noteRelayClose(r, url, stableFor);
      if (r._sidelined) { if (!r._sidelinedLog) { console.log('[NET] Relé inestable ' + _relayHost(url) + ': lo aparto ~' + Math.round(delay / 60000) + ' min (se cae sin parar)'); r._sidelinedLog = true; } }
      else { r._sidelinedLog = false; }
      r.waits.forEach(function(fn) { fn(false); }); r.waits.clear();
      if (was && !self.online()) { console.log('[NET] Sin relés: internet no disponible'); self._peersDown(); }
      if (was && !r.gw && !self._realOpenCount() && self.gw && typeof self.gw.realLost === 'function') self.gw.realLost();
      if (!was && r.fails >= RELAY_DEAD_FAILS) self._spareCheck(); // 3114: no conecta → reserva al momento (sin esperar al latido)
      // 3050: sin internet propio, el reintento va a su hora (no al siguiente latido de 15 s): al volver la señal se nota en ≤ 15 s
      if (!r.gw && !self._realOpenCount()) setTimeout(function() {
        if (!r.ws && self.relays.get(url) === r && Date.now() >= (r.retryAt || 0) && (self.inTags.size || self.reqTags.size)) self._connect(url);
      }, delay + 50);
    };
    ws.onerror = function() {};
  },
  // Medición de caminos (3050): sin NINGÚN relé (ni propio ni por puente) los contactos dejan de estar «en línea por internet» YA
  // (antes seguían así hasta que caducaba su último saludo, ~2 min): sus envíos y el puente de Jump por internet pasan al
  // Bluetooth al momento (se vio un texto reintentado 5 veces por «internet» y en cola casi 2 min). Tor directo no depende de esto.
  _peersDown() {
    var self = this;
    self.peers.forEach(function(p, nx) {
      if (!p.up || p.torUp) return;
      p.up = false;
      if (self.ble && typeof self.ble._netDown === 'function') { try { self.ble._netDown(nx); } catch (e) {} }
    });
  },
  // P5 (dueño 01-11): relés abiertos distintos de `url` (para decidir si se puede apartar uno que flapea sin quedarse sin red)
  _openRelaysExcept(url) { var n = 0; this.relays.forEach(function(r, u) { if (u !== url && r.open) n++; }); return n; },
  // P5: al cerrarse un relé, actualiza su contador de flaps y elige el retraso del próximo intento. Un relé que abrió y se
  // cayó enseguida (vida < RELAY_STABLE_MS) suma un flap; con RELAY_FLAP_MAX flaps en la ventana y ≥RELAY_MIN_OTHERS relés
  // abiertos, se aparta RELAY_FLAP_PENALTY_MS (en vez del backoff normal). Una conexión estable olvida los flaps viejos.
  _noteRelayClose(r, url, stableFor, now) {
    now = now || Date.now();
    if (stableFor > 0 && stableFor < RELAY_STABLE_MS) {
      r.flapTimes = (r.flapTimes || []).filter(function(t) { return now - t < RELAY_FLAP_WINDOW_MS; });
      r.flapTimes.push(now);
    } else if (stableFor >= RELAY_STABLE_MS) {
      r.flapTimes = []; // estuvo estable: no arrastrar flaps antiguos
    }
    if ((r.flapTimes || []).length >= RELAY_FLAP_MAX && this._openRelaysExcept(url) >= RELAY_MIN_OTHERS) {
      r._sidelined = true;
      r.retryAt = now + RELAY_FLAP_PENALTY_MS;
      return RELAY_FLAP_PENALTY_MS;
    }
    r._sidelined = false;
    var delay = r.backoff;
    // Medición de caminos (dueño 13-11, 3050): sin internet propio la pausa crecía hasta 2 min; al volver la señal (datos
    // móviles o Wi-Fi) la app tardaba ~75 s en darse cuenta y seguía por el puente. Sin ningún relé propio abierto, como mucho
    // RELAY_OFFLINE_RETRY_MS (sin red, el intento falla al instante y no gasta). Con otros relés abiertos, la pausa de siempre.
    if (!this._realOpenCount()) delay = Math.min(delay, RELAY_OFFLINE_RETRY_MS);
    r.retryAt = now + delay;
    r.backoff = Math.min(r.backoff * 2, 120000);
    return delay;
  },
  // 3114 (dueño 15-11): con menos de RELAY_TARGET_OPEN relés sanos entre los de siempre y los de reserva en uso, entra el siguiente de
  // reserva (en orden fijo). Solo si hay internet: algún relé abierto o, si caen TODOS los de siempre, la red dice que hay conexión
  // (sin red fallan todos y no tiene sentido probar más). Cuando los de siempre vuelven a bastar, se sueltan los de reserva.
  _spareCheck() {
    var self = this, pool = self._sparePool(); if (!pool.length) return;
    var base = self._baseRelayUrls(); self._spareOn = self._spareOn || [];
    var isDown = function(u) { var r = self.relays.get(u); return !!(r && !r.open && ((r.fails || 0) >= RELAY_DEAD_FAILS || r._sidelined)); };
    var want = Math.min(RELAY_TARGET_OPEN, base.length);
    var healthy = base.concat(self._spareOn).filter(function(u) { return !isDown(u); }).length;
    var allBaseDown = base.length > 0 && base.every(isDown);
    var online = self._realOpenCount() > 0 || (allBaseDown && !(typeof navigator !== 'undefined' && navigator.onLine === false));
    if (healthy < want && online) {
      var next = pool.filter(function(u) { return base.indexOf(u) < 0 && self._spareOn.indexOf(u) < 0 && !isDown(u); })[0];
      if (!next) return;
      self._spareOn.push(next);
      console.log('[NET] Relé de reserva ' + _relayHost(next) + ': no conecta ' + base.concat(self._spareOn).filter(isDown).map(_relayHost).join(', ')); // i18n-ok: registro
      self._connect(next);
      try { self._bgConfig(); } catch (e) {}
      return;
    }
    var baseOpen = base.filter(function(u) { var r = self.relays.get(u); return !!(r && r.open); }).length;
    if (self._spareOn.length && baseOpen >= want) {
      var drop = self._spareOn.splice(0);
      drop.forEach(function(u) { var r = self.relays.get(u); if (r && r.ws) { r.ws.onclose = null; r.ws.onopen = null; try { r.ws.close(); } catch (e) {} } self.relays.delete(u); });
      console.log('[NET] Los relés de siempre vuelven a estar bien: suelto los de reserva (' + drop.map(_relayHost).join(', ') + ')'); // i18n-ok: registro
      try { self._bgConfig(); } catch (e) {}
    }
  },
  _closeAll() { this.relays.forEach(function(r) { try { if (r.ws) r.ws.close(); } catch (e) {} }); },
  _send(r, arr) { try { if (r.ws && r.open) { r.ws.send(JSON.stringify(arr)); return true; } } catch (e) {} return false; },
  // 3011: pregunta mínima (una búsqueda por un id que no existe: todo relé contesta EOSE) a los relés abiertos; el que no dice
  // NADA en RELAY_PROBE_MS se da por muerto y se reconecta. minIdle: solo los que llevan callados al menos eso.
  _probeRelays(why, minIdle) {
    var self = this, t0 = Date.now();
    self.relays.forEach(function(r, u) {
      if (!r.open || !r.ws || r.probing) return;
      if (minIdle && t0 - (r.rxAt || r.openedAt || t0) <= minIdle) return;
      var ws = r.ws, sub = 'pb' + bytesToHex(_rnd(4));
      r.probing = true;
      self._send(r, ['REQ', sub, { ids: [RELAY_PROBE_ID], limit: 1 }]);
      setTimeout(function() {
        r.probing = false;
        if (r.ws !== ws || !r.open) return;            // ya se cerró o se reconectó entretanto
        if ((r.rxAt || 0) < t0) self._dropDead(u, r, why);
        else self._send(r, ['CLOSE', sub]);
      }, RELAY_PROBE_MS);
    });
  },
  // 3085 (dueño 14-11: «el S24 cambia de Wi-Fi a datos en automático y muy rápido, ¿por qué nosotros somos lentos?»): la app solo
  // escuchaba «entré a un Wi-Fi»; al pasar de Wi-Fi a datos (o al revés) sus conexiones a los relés quedaban colgadas de la red vieja
  // —abiertas para la app, muertas de verdad— hasta que fallaban o hasta la comprobación de relés callados (redcambio.js: lo que le
  // mandaban tardaba 28 s en entrar). Ahora, al cambiar la red, se cierran y se abren por la nueva al momento, y se mide cuánto tardan.
  // 3109 (diagnóstico S23 3057 15-11 19:46:10: al volver la app llegaron 4 avisos en 3 ms —Wi-Fi → sin red → datos → Wi-Fi → datos— y
  // cada uno cerró y reabrió TODOS los relés: 3 vueltas de conexiones a medias; luego más de un minuto sin relés por datos): los avisos
  // seguidos se juntan (NET_CHANGE_SETTLE_MS) y se actúa una sola vez, con la red en la que quedó.
  _onNetChange(ev) {
    var self = this, t = String((ev && ev.type) || ''), prev = String((ev && ev.prev) || '');
    if (!self._netBurst) self._netBurst = { from: prev, seq: [] };
    self._netBurst.seq.push(t);
    clearTimeout(self._netBurstT);
    self._netBurstT = setTimeout(function() { var b = self._netBurst; self._netBurst = null; if (b) self._applyNetChange(b.from, b.seq); }, NET_CHANGE_SETTLE_MS);
  },
  _applyNetChange(prev, seq) {
    var self = this, t = seq[seq.length - 1];
    var NAMES = { wifi: 'Wi-Fi', cell: 'datos móviles', eth: 'cable', vpn: 'VPN', none: 'sin red', other: 'otra red' }; // i18n-ok: registro
    var nm = function(x) { return NAMES[x] || x || '?'; };
    var burst = seq.length > 1 ? ' (' + seq.length + ' avisos seguidos: ' + [prev].concat(seq).map(nm).join(' → ') + '; una sola vez)' : ''; // i18n-ok: registro
    console.log('[NET] Cambio de red: ' + nm(prev) + ' → ' + nm(t) + burst + (t === 'none' ? ': espero a que vuelva' : ': reconecto los relés ya')); // i18n-ok: registro para el diagnóstico
    if (t === 'none') { self._netChangeAt = 0; return; }
    self._netChangeAt = Date.now();
    self.relays.forEach(function(r, u) {
      if (r.gw) return;   // los puentes Bluetooth no dependen de la red del teléfono
      r.fails = 0; // 3114: los fallos de la red vieja no cuentan para la reserva
      if (r.ws) self._dropDead(u, r, 'cambio de red');
      else { r.retryAt = 0; r.backoff = 2000; }
    });
    self.tick();
  },
  // 3011: los relés que no dijeron nada desde `since` (a un envío sin respuesta de ninguno) se dan por muertos
  _dropSilent(since, why) {
    var self = this;
    self.relays.forEach(function(r, u) { if (r.open && r.ws && (r.rxAt || 0) < since) self._dropDead(u, r, why); });
  },
  // 3011: cierra una conexión muerta SIN esperar su cierre (en una conexión muerta puede tardar minutos) y reconecta ya
  _dropDead(url, r, why) {
    var ws = r.ws, was = r.open;
    console.warn('[NET] Relé ' + _relayHost(url) + (why === 'cambio de red' ? ': la red cambió, reconecto por la nueva' : ' no contesta (' + why + '): conexión muerta, reconecto')); // i18n-ok: registro
    if (ws) { ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null; try { ws.close(); } catch (e) {} }
    r.open = false; r.ws = null; r.sub = null; r.openedAt = 0; r.probing = false;
    r.waits.forEach(function(fn) { try { fn(false, 'conexión muerta'); } catch (e) {} }); r.waits.clear();
    if (was && !this.online()) { console.log('[NET] Sin relés: internet no disponible'); this._peersDown(); }
    r.retryAt = 0; r.backoff = 2000;
    this._connect(url);
  },

  _subscribe(r) {
    if (r.sub) this._send(r, ['CLOSE', r.sub]);
    r.sub = 'nx' + bytesToHex(_rnd(6));
    var since = Math.max(0, Math.floor((this.state.lastSeen || (Date.now() - 2 * 86400000)) / 1000) - 600);
    this._send(r, ['REQ', r.sub, { kinds: [KIND], '#p': Array.from(this.inTags.keys()).concat(Array.from(this.reqTags.keys())), since: since }]);
  },

  _onRelayMsg(url, r, data) {
    var m;
    // SEC-4 (auditoría 28-10): un relé malicioso podría mandar un frame enorme → pico de memoria del WebView. Igual que
    // el nativo (SafeJson), se descarta lo que exceda con holgura un evento legítimo antes de analizarlo.
    if (typeof data === 'string' && data.length > MAX_RELAY_FRAME) { console.warn('[NET] Frame de relé demasiado grande (' + data.length + '): descartado'); return; }
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!Array.isArray(m)) return;
    // Fase B (2969): respuestas a una bajada por id (fetchEvents) — van a su recolector, no al buzón
    if (r.fetches && typeof m[1] === 'string' && r.fetches.has(m[1])) {
      var fj = r.fetches.get(m[1]);
      if (m[0] === 'EVENT' && m[2]) fj.onEvent(m[2]);
      else if (m[0] === 'EOSE' || m[0] === 'CLOSED') fj.done();
      return;
    }
    if (m[0] === 'EVENT' && m[1] === r.sub && m[2]) this._onEvent(m[2]);
    else if (m[0] === 'OK') { var fn = r.waits.get(m[1]); if (fn) { r.waits.delete(m[1]); fn(!!m[2], m[3]); } }
    else if (m[0] === 'AUTH' && typeof m[1] === 'string') { r.challenge = m[1]; this._auth(url, r, m[1]); }
    else if (m[0] === 'CLOSED' && m[1] === r.sub) {
      // Algunos relés piden identificarse (NIP-42) para leer mensajes privados: tras hacerlo, se vuelve a pedir
      if (/^auth-required/.test(String(m[2] || ''))) { r.sub = null; if (r.authed) this._subscribe(r); else r.needSub = true; }
    }
  },

  // NIP-42: el relé pide demostrar quién lee: se firma su reto con las claves de mis etiquetas
  _auth(url, r, challenge) {
    var self = this;
    var keys = self.tagKeys.slice(0, 40), pending = keys.length;
    r.authed = false;
    keys.forEach(function(sk) {
      var ev = _event(sk, 22242, [['relay', r.realUrl || url], ['challenge', challenge]], ''); // por un puente: el relé de verdad
      r.waits.set(ev.id, function() { if (--pending === 0) { r.authed = true; if (r.needSub) { r.needSub = false; self._subscribe(r); } } });
      self._send(r, ['AUTH', ev]);
    });
  },
};
