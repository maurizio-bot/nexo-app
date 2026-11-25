/**
 * NEXO — Conexiones Bluetooth (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752, sin cambios):
 * supervisor de enlaces, pings, reconexión, búsqueda de contactos perdidos, teléfonos encontrados al escanear y
 * esperar a que un enlace esté listo.
 */
import { t } from './i18n.js';
import { BLE_STATES, SUPERVISOR_STATES, _getBLEContacts, _jitteredBackoff, _showToast, _netNx, _lanNx, _getContactByDeviceId, _getContactByUUID, _hasNativeMethod, _isBLEContact, _isResendable, _normId, _normMac, _safeDispatchEvent, _safeNativeCall, _dupBleLinksToClose, _vNx, _vaultLoadMessages, _wakeShouldFire, _wakeAdvance, _wakeNewEntry, WAKE_GIVEUP_MS, _isQuietHidden, _isPathDev } from './ble_helpers.js';
import { noteHelp as _gwNoteHelp } from '../net/gw_helpers.js';
import { BLE_CONN_SCAN } from './ble_conn_scan.js';

// 3099: con una transferencia en curso la re-búsqueda de contactos perdidos se aplaza, pero como mucho esto seguido: luego una vuelta
var SCAN_HOLD_MAX_MS = 180000;

const _BLE_CONNECTION_METHODS_BASE = {
  _startConnectionSupervisor() {
    var self = this;
    if (self._supervisorTimer) { clearInterval(self._supervisorTimer); self._supervisorTimer = null; }
    self._supervisorTimer = setInterval(function() { self._runSupervisorCycle(); }, self._supervisorIntervalMs);
    console.log('[BLEInterface] Supervisor iniciado');
    if (self.relay) self.relay.start();
    if (self.fenix) self.fenix.init();
    if (self.lan) self.lan.init();
    if (self.net) self.net.init();
    // 3013: aviso cuando Wi-Fi Direct no puede usarse por tener el Wi-Fi apagado (aquí o en el otro teléfono)
    if (self.wifiDirect && !self._wdOffListener && typeof window !== 'undefined') {
      self._wdOffListener = function(e) {
        _showToast((e && e.detail && e.detail.peer)
          ? t('wd_wifi_off_peer', 'El otro teléfono tiene el Wi-Fi apagado: se envía por Bluetooth (más lento).')
          : t('wd_wifi_off_me', 'Wi-Fi apagado: se envía por Bluetooth (más lento). Enciende el Wi-Fi —no hace falta red— para enviar rápido.'), 'warn');
      };
      window.addEventListener('nexo:wd:wifiOff', self._wdOffListener);
    }
    if (self.wifiDirect) self.wifiDirect.init().then(function(st) {
      // Los ya conectados aún no sabían que tenemos Wi-Fi Direct: repetir el kx con wd:1
      if (st && st.supported) self._deviceStates.forEach(function(v, k) {
        if (v.state === BLE_STATES.READY_TO_CHAT || v.state === BLE_STATES.NOTIFICATIONS_READY) self._sendKx(k, false, true);
      });
    });
  },

  _stopConnectionSupervisor() {
    if (this._supervisorTimer) { clearInterval(this._supervisorTimer); this._supervisorTimer = null; }
    this._pendingPings.forEach(function(p) { clearTimeout(p.timer); });
    this._pendingPings.clear();
    this._backoffTimers.forEach(function(t) { clearTimeout(t); });
    this._backoffTimers.clear();
  },

  _hasActiveFileTransfer(deviceId) {
    try {
      if (!this.ackSystem) return false;
      if (typeof this.ackSystem.hasActiveTransfer === 'function') {
        return this.ackSystem.hasActiveTransfer(deviceId);
      }
      // Fallback: mirar si hay outgoing transfers pendientes
      if (typeof this.ackSystem.getOutgoingTransfers === 'function') {
        var outs = this.ackSystem.getOutgoingTransfers(deviceId);
        return outs && outs.length > 0;
      }
    } catch (e) {}
    return false;
  },

  _runSupervisorCycle() {
    var self = this;
    try { if (self.ackSystem && typeof self.ackSystem.upgradeAll === 'function') self.ackSystem.upgradeAll('repaso'); } catch (e) {} // 3080
    // Build 2967 (Fase A, entrega offline): tocar (wake FCM) a los contactos con PENDIENTES, ANTES de la compuerta de abajo
    // (que corta si no hay enlaces vivos — justo el caso offline). El propio tick tiene su freno de 30 s.
    self._tickWakePending(); try { self._pushAckKeysIfChanged(); self._linkTrimTick(); } catch (e) {} // 16b: claves de firma del ✓✓ nativo al día (contacto nuevo, clave aceptada)
    if (self._cameraBlePaused) return;
    if (!self._activeChatDeviceId && self.connectedDevices.size === 0) return;
    self.connectedDevices.forEach(function(device, deviceId) {
      var state = self._getDeviceState(deviceId);
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) return;
      // 2995: con el Bluetooth apagado un enlace Bluetooth «listo» es solo un recuerdo: no se le manda ping ni se da por «zombi»
      if (self._btIsOff() && !_netNx(deviceId) && !_lanNx(deviceId)) return;

      // 3330: enlace recuperado y aún sin oír nada por él → se comprueba ya (sin la protección de «transferencia activa»)
      var unv = self._unverified && self._unverified.get(deviceId);
      if (unv && (self._lastPongTime.get(deviceId) || 0) > unv) { self._unverified.delete(deviceId); unv = 0; }
      if (unv && Date.now() - unv > 120000) { self._unverified.delete(deviceId); unv = 0; }
      // Protección: no matar la conexión mientras se envía un archivo
      if (!unv && self._hasActiveFileTransfer(deviceId)) {
        console.log('[BLEInterface] Supervisor: transferencia activa, skip ping/zombie para', deviceId);
        return;
      }

      var lastPong = self._lastPongTime.get(deviceId) || 0;
      var timeSincePong = Date.now() - lastPong;
      if (unv || lastPong === 0 || timeSincePong > 16000) {
        // #dueño 02-11 (A3): si ya hay un ping en vuelo para este enlace, NO disparar otro (el ciclo es cada 6 s pero
        // el ping caduca a los 8 s; apilarlos hacía que la desconexión saliera 2-3 veces seguidas). Uno a la vez.
        if (self._pingInFlight && self._pingInFlight.has(deviceId)) return;
        (self._pingInFlight || (self._pingInFlight = new Set())).add(deviceId);
        self._pingDevice(deviceId).then(function(result) {
          self._pingInFlight.delete(deviceId);
          self._pingFailCount.set(deviceId, 0);
          var prevState = self._supervisorStates.get(deviceId);
          if (prevState && prevState.state === SUPERVISOR_STATES.ZOMBIE) {
            var nx = self._macToNexoId.get(_normMac(deviceId));
            if (nx && self.ackSystem && self.ackSystem.sendSessionSync) {
              console.log('[BLEInterface] Zombie recovery, enviando session sync a', nx);
              self.ackSystem.sendSessionSync(deviceId, nx);
            }
          }
          self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now(), rtt: result.rtt });
        }).catch(function(err) {
          self._pingInFlight.delete(deviceId);
          var fails = (self._pingFailCount.get(deviceId) || 0) + 1;
          self._pingFailCount.set(deviceId, fails);
          var unvF = !!(self._unverified && self._unverified.has(deviceId) && !((self._lastPongTime.get(deviceId) || 0) > self._unverified.get(deviceId)));
          if (unvF) console.warn('[BLEInterface] Enlace recuperado ' + deviceId + ' sin respuesta al primer ping: medio muerto, lo rehago');
          if (unvF || fails >= self._pingMaxFails) {
            if (unvF) self._unverified.delete(deviceId);
            // Solo forzar si NO hay transferencia activa (3330: un enlace recuperado sin comprobar no se protege)
            if (unvF || !self._hasActiveFileTransfer(deviceId)) {
              self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.ZOMBIE, since: Date.now() });
              self._forceDisconnectAndReconnect(deviceId);
            } else {
              console.log('[BLEInterface] Supervisor: zombie detectado pero transferencia activa → no reconectar');
            }
          } else {
            self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.DEGRADED, since: Date.now(), failCount: fails });
          }
        });
      }
    });
    // Build 2960: tras los pings, barrer enlaces Bluetooth repetidos al mismo NEXO y cerrar los de sobra (dedup).
    self._dedupBleLinks();
  },

  // Build 2960: dedup de enlaces Bluetooth (fase «conectar» del orden del Bluetooth). Android abre varias conexiones a una
  // misma persona (dirección BT rotativa + anunciar vs conectar); al mandar ya se elige el mejor (_bleReadyFor), pero los
  // de sobra quedan ABIERTOS y tapan la radio (parte de la «foto lenta de cerca»). Acá, en cada ciclo del supervisor, se
  // agrupan los enlaces LISTOS por NEXO; con 2+, se conserva el mejor (mayor MTU, no muerto) y se cierran los demás con el
  // disconnectDevice nativo que ya existe. Salvaguardas: freno (_dupDebounceMs: deben coexistir un rato, no un traspaso),
  // enfriamiento por MAC (_dupCloseCooldownMs), y NUNCA se cierra un enlace en transferencia ni el del chat activo (busy).
  // 3020 (diagnóstico más claro): un enlace Bluetooth que se abre y se cierra en bucle con el mismo contacto es un síntoma
  // (S24 12-11: conectar/cerrar «repetido» cada ~60 s). Cuenta cierres por contacto en 10 min: 6 desconexiones o 3 cierres
  // por repetido → diagnóstico automático (como mucho uno cada 30 min por contacto; los límites globales siguen aparte).
  _noteLinkFlap(nexoId, why) {
    var nx = _normId(nexoId); if (!/^nx[0-9a-z]{8}$/.test(nx)) return;
    var now = Date.now(), key = nx + '|' + why;
    this._flapLog = this._flapLog || new Map(); this._flapSaid = this._flapSaid || new Map();
    var arr = (this._flapLog.get(key) || []).filter(function(t) { return now - t < 600000; });
    arr.push(now); this._flapLog.set(key, arr);
    var need = why === 'repetido' ? 3 : 6;
    if (arr.length >= need && now - (this._flapSaid.get(nx) || 0) > 1800000) {
      this._flapSaid.set(nx, now);
      _safeDispatchEvent('nexo:diag:symptom', { kind: 'enlace_abre_cierra', info: nx + ' ' + arr.length + ' ' + (why === 'repetido' ? 'cierres por enlace repetido' : 'desconexiones') + ' en 10 min' });
    }
  },

  _dedupBleLinks() {
    var self = this;
    if (self._cameraBlePaused || self.isDummyMode) return;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'disconnectDevice')) return;
    var now = Date.now();
    var activeMac = self._activeChatDeviceIdNative ? _normMac(self._activeChatDeviceIdNative) : null;
    var byNexo = new Map(), me = _normId(self.localNexoId);
    self._deviceStates.forEach(function(st, key) {
      if (/^(lan|net)nx/.test(key)) return; // solo Bluetooth (no internet/Wi-Fi)
      if (st.state !== BLE_STATES.READY_TO_CHAT && st.state !== BLE_STATES.NOTIFICATIONS_READY) return;
      var nx = _normId(self._macToNexoId.get(key));
      if (!nx) return;
      var arr = byNexo.get(nx) || [];
      var decider = !!me && me < nx; // 3327: los repetidos con este contacto los decido yo
      arr.push({
        key: key,
        mtu: (self._mtuByDevice && self._mtuByDevice.get(key)) || 185,
        dead: self._bleCongested(key),
        // 3262: cuándo se abrió el enlace. 3327: uno que yo cerré por repetido hace < 10 min y volvió a abrirse no cuenta como «el más
        // nuevo» (si no, el que decide se quedaría con él al acabar el enfriamiento y cerraría el bueno: vaivén, dupserver.js S5)
        since: ((self._dupClosedAt && now - (self._dupClosedAt.get(_normMac(key)) || -1e13) < 600000) ? 0 : ((st && (st.openedAt || st.since)) || 0)),
        role: (st && st.role) || null, // 3027: cliente/servidor (desempate común con el otro teléfono)
        heard: (self._lastPongTime && self._lastPongTime.get(key)) || 0, // 3233: último paquete recibido por este enlace
        // 3167b: uno que el otro ya cortó (y el nativo reabrió) no cuenta como ocupado: si no, nadie lo cerraba de este lado
        // 3327: para el que decide (NEXO ID menor) el chat abierto no frena el cierre: lo que iba por ahí pasa al que se queda (3239) y
        // el chat sigue por él; si frenara, con el chat abierto por el enlace viejo nadie cerraría nunca el repetido
        busy: (self._hasActiveFileTransfer(key) || (!decider && !!activeMac && _normMac(key) === activeMac)) && !((self._peerCutUntil && self._peerCutUntil.get(_normMac(key))) > now)
      });
      byNexo.set(nx, arr);
    });
    byNexo.forEach(function(links, nx) {
      if (links.length < 2) { self._dupSeenSince.delete(nx); return; } // sin repetidos: nada que hacer
      var seen = self._dupSeenSince.get(nx);
      if (!seen) { self._dupSeenSince.set(nx, now); return; }           // primera vez: arrancar el freno, no cerrar aún
      if (now - seen < self._dupDebounceMs) return;                     // aún no estables (podría ser un traspaso)
      var toClose = _dupBleLinksToClose(links, me ? { iAmLower: me < nx, now: now, waitedMs: now - seen } : { now: now }); // 3327: decide el de NEXO ID menor (el otro solo ve caer uno)
      for (var i = 0; i < toClose.length; i++) {
        var key = toClose[i];
        if ((self._dupClosedUntil.get(key) || 0) > now) continue;       // enfriamiento por MAC
        self._dupClosedUntil.set(key, now + self._dupCloseCooldownMs);
        self._dupClosedAt = self._dupClosedAt || new Map(); self._dupClosedAt.set(_normMac(key), now); if (self._dupClosedAt.size > 100) self._dupClosedAt.delete(self._dupClosedAt.keys().next().value);
        console.log('[BLEInterface] Dedup: cierro enlace repetido ' + key + ' de ' + nx + ' (me quedo con el mejor); enlaces: ' + links.map(function(l) { return l.key.slice(-4) + ':' + (l.role || '?') + ':mtu' + l.mtu + (l.dead ? ':muerto' : ''); }).join(' '));
        self._noteLinkFlap(nx, 'repetido');
        // 3167 (diagnóstico S24↔realme 3075 16-11 15:17): server:true → el nativo corta también un enlace ENTRANTE (el otro es
        // cliente de nuestro servidor GATT). Sin eso solo cerraba el lado cliente: el enlace de servidor que 3027 manda cerrar al
        // de NEXO ID menor seguía vivo y se seguía usando (cada mensaje salía por los dos enlaces).
        _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: key, server: true }).catch(function() {});
        // 3239 (diagnóstico del dueño 18-11 11:43: tras cerrar el repetido 44c15d1bcd55, el texto largo siguió escribiéndole 9 s al cerrado hasta
        // «Write fallo ~6 s: 20 trozos descartados»): lo que iba por el enlace cerrado pasa AL INSTANTE al que se queda
        self._rebindOutgoing(key, links.filter(function(l) { return toClose.indexOf(l.key) < 0; })[0]);
      }
    });
  },

  // 3239: pasa los envíos en curso (flujos por trozos y textos esperando su confirmación) de un enlace cerrado al que se queda
  _rebindOutgoing(fromKey, keeper) {
    var ack = this.ackSystem;
    if (!ack || !keeper || !keeper.key || _normMac(keeper.key) === _normMac(fromKey)) return 0;
    var from = _normMac(fromKey), n = 0;
    try {
      if (ack.outgoingStreams) ack.outgoingStreams.forEach(function(st) {
        if (st && !st.aborted && st.deviceId && _normMac(st.deviceId) === from && typeof st.useLink === 'function') { st.useLink(keeper.key); n++; }
      });
      if (ack.pendingAcks) ack.pendingAcks.forEach(function(en) {
        if (en && en.deviceId && !en.raw && _normMac(en.deviceId) === from) { en.deviceId = keeper.key; n++; }
      });
    } catch (e) {}
    if (n) console.log('[BLEInterface] ' + n + ' envío(s) en curso pasan del enlace cerrado ' + fromKey + ' al que se queda ' + keeper.key);
    return n;
  },

  // Build 2967 (Fase A, docs/CONTRATOS_ENTREGA_OFFLINE_FASE_AB.md): un contacto con PENDIENTES a quien no alcanzamos por
  // ningún enlace recibe el «toque» FCM con freno creciente, hasta que despierte o hasta el techo (→ PASSIVE: deja de tocar
  // activo; el ⏳ del mensaje pendiente queda igual, y al abrir su chat se re-dispara como siempre). El calendario y la
  // rendición son funciones PURAS (ble_helpers, testeadas). Alta de contactos: _noteWakePending (desde el flush de pendientes
  // y desde el envío que queda «en espera»). Nunca re-cifra ni toca el nativo.
  _noteWakePending(nexoId) {
    var nx = _normId(nexoId);
    if (!nx || !/^nx[0-9a-z]{8}$/.test(nx)) return; // solo contactos (NEXO ID); un grupo u otro id no tiene a quién tocar
    if (!this._pendingWake) this._pendingWake = new Map();
    if (!this._pendingWake.has(nx)) this._pendingWake.set(nx, _wakeNewEntry(Date.now())); // preserva el existente (incl. PASSIVE)
  },

  _tickWakePending() {
    var self = this;
    if (!self._pendingWake || self._pendingWake.size === 0) return;
    var now = Date.now();
    if (now - (self._lastWakeTick || 0) < 30000) return; // freno: a lo sumo cada 30 s (no por cada tick de 6 s del supervisor)
    self._lastWakeTick = now;
    self._pendingWake.forEach(function(entry, nx) {
      var via = (typeof self.linkOf === 'function') ? self.linkOf(nx) : null;
      if (via === 'wifi') { self._pendingWake.delete(nx); return; } // Wi-Fi comprobado: su app contestó → lo entrega el camino normal
      // 3088 (idea del dueño 14-11: «cada mensaje a un teléfono dormido lleva su despertador hasta que haya confirmación»): con un
      // enlace Bluetooth o internet que PARECE vivo, la app del otro puede estar dormida (el vivo del 14-11: Bluetooth sano, nativo
      // contestando, 40 min sin confirmar y sin nadie que lo despertara). Ya no sale de la lista por verse alcanzable: sale cuando
      // no queda nada suyo sin confirmar desde hace un rato; mientras, se le sigue tocando con el mismo freno creciente.
      var reach = (via === 'bluetooth' || via === 'internet');
      var d = _wakeShouldFire(entry, now, WAKE_GIVEUP_MS);
      if (d === 'wait') return;
      if (d === 'passive') {
        if (!entry.passive) { entry.passive = true; console.log('[WAKE] ' + nx + ' → PASSIVE (rendido tras ' + entry.attempt + ' toques / tope de tiempo); se entrega al verlo o al abrir su chat'); }
        return;
      }
      // d === 'fire': antes de tocar, confirmar que SIGUE habiendo pendientes (si ya se entregaron por otro camino —buzón+ack
      // con el otro en 2.º plano, Jump— no hay a quién despertar y la entrada se va sola). Asíncrono (lee la bóveda) y raro.
      var stillP = reach ? (typeof self._wakeStuckPending === 'function' ? self._wakeStuckPending(nx) : Promise.resolve(false)) : self._wakeStillPending(nx);
      stillP.then(function(still) {
        if (!self._pendingWake || self._pendingWake.get(nx) !== entry) return; // la entrada cambió mientras tanto
        if (!still) { self._pendingWake.delete(nx); console.log('[WAKE] ' + nx + (reach ? ' alcanzable y sin nada atascado: fin del toque' : ' ya no tiene pendientes: fin del toque')); return; } // i18n-ok: registro
        // con enlace aparente, el toque va igual (why): su app no confirma
        var fired = (typeof self._wakeSleepingPeer === 'function') ? self._wakeSleepingPeer(nx, reach ? 'sin confirmar' : undefined) : null;
        if (fired === 'waking') {
          self._pendingWake.set(nx, _wakeAdvance(entry, now, Math.random()));
          console.log('[WAKE] toque a ' + nx + ' (intento ' + (entry.attempt + 1) + (reach ? ', enlace ' + via + ' pero sin confirmar' : ', por pendientes') + ')'); // i18n-ok: registro
        } else if (fired === 'wifi' || fired === 'bluetooth' || fired === 'internet') {
          self._pendingWake.delete(nx); // se volvió alcanzable justo al tocar
        } // else (falsy): no se pudo tocar (sin token/internet) → se reintenta en el próximo tick, sin avanzar el backoff
      });
    });
  },

  // 3088: con un enlace que parece vivo, ¿hay algo suyo (que vaya a LEER) sin confirmar desde hace más de WAKE_STUCK_MS? Mira los
  // mensajes propios del chat en estado pendiente/enviando/enviado (sin ✓✓). Sin bóveda o ante un error: no (no se toca de más).
  _wakeStuckPending(nx) {
    try {
      var w = (typeof window !== 'undefined') ? window : null;
      if (!w || typeof _vaultLoadMessages !== 'function') return Promise.resolve(false);
      var now = Date.now();
      return _vaultLoadMessages(nx).then(function(msgs) {
        return (msgs || []).some(function(m) {
          if (!m || !m._own || m.deleted || _isQuietHidden(m)) return false;
          var st = m.status || '';
          if (st !== 'pending' && st !== 'sending' && st !== 'sent') return false;
          var t = Number(m.timestamp || m.ts || 0);
          return t > 0 && now - t > 20000 && now - t < 7 * 24 * 3600000;
        });
      }, function() { return false; });
    } catch (e) { return Promise.resolve(false); }
  },

  // ¿Sigue habiendo mensajes pendientes para este contacto? Lee la bóveda (igual que el flush); sin bóveda (sim puro) o
  // ante un error se asume que sí (mejor un toque de más que dejar a alguien sin despertar).
  _wakeStillPending(nx) {
    try {
      var w = (typeof window !== 'undefined') ? window : null;
      var p = (w && typeof w.vaultGetPendingMessages === 'function') ? w.vaultGetPendingMessages(nx)
        : (w ? _vaultLoadMessages(nx).then(function(msgs) { return msgs.filter(function(m) { return _isResendable(m, nx); }); }) : null);
      if (!p) return Promise.resolve(true);
      var selfW = this;
      // 3076 (dueño 14-11: «las notificaciones de cuando recibo un diagnóstico me aparecen como notificación»): solo cuenta lo que el
      // otro va a LEER. Un diagnóstico automático, un estado o una foto de perfil pendientes no le despiertan con un toque FCM (el
      // Motorola tocaba al S24 cada pocos minutos «por pendientes» que eran sus diagnósticos); llegan cuando coincidan.
      return Promise.resolve(p).then(function(pending) { return (pending || []).some(function(m) { return !_isQuietHidden(m); }) || (typeof selfW._citaPendingFrom === 'function' && selfW._citaPendingFrom(nx)); }, function() { return true; }); // Fase D: esperar un archivo grande también es «pendiente»
    } catch (e) { return Promise.resolve(true); }
  },

  _pingDevice(deviceId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!deviceId) { reject(new Error('No deviceId')); return; }
      var state = self._getDeviceState(deviceId);
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) { reject(new Error('Not ready')); return; }
      var pingId = 'ping_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
      var payload = JSON.stringify({ v: 1, type: 'ping', pingId: pingId, ts: Date.now(), fromNexoId: self.localNexoId || self.localDeviceUUID, bf: 1 });
      var timer = setTimeout(function() {
        var p = self._pendingPings.get(pingId);
        if (p) { self._pendingPings.delete(pingId); reject(new Error('Ping timeout')); }
      }, self._pingTimeoutMs);
      self._pendingPings.set(pingId, { resolve: resolve, reject: reject, timer: timer, ts: Date.now() });
      self._sendMessageNative(deviceId, payload, pingId).catch(function(e) {
        var p = self._pendingPings.get(pingId);
        if (p) { clearTimeout(p.timer); self._pendingPings.delete(pingId); reject(e); }
      });
    });
  },

  _forceDisconnectAndReconnect(deviceId) {
    var self = this;
    // #dueño 02-11 (A3): idempotente — si este enlace YA está en reconexión (o ya no está conectado), no repetir la
    // desconexión ni el log (un ping apilado que caduca tarde no debe volver a dispararla). Defensa extra al dedup.
    var sup = self._supervisorStates.get(deviceId);
    if (sup && sup.state === SUPERVISOR_STATES.RECONNECTING) return;
    if (self._pingInFlight) self._pingInFlight.delete(deviceId);
    // Ronda 2760: al diagnóstico (antes no quedaba rastro y en los teléfonos el enlace se rehacía cada ~30 s)
    // 3187 (diagnóstico automático S24 3082 17-11 04:04, zombi con la tableta): el texto decía «2 pings» fijo; el límite es
    // _pingMaxFails (4 desde la ronda 2814)
    console.warn('[BLEInterface] Enlace ' + (self._macToNexoId.get(_normMac(deviceId)) || deviceId) + ' sin respuesta a ' + self._pingMaxFails + ' pings: desconectado para reconectar');
    // 2974: síntoma → diagnóstico automático. 3013 (canal de diagnósticos 11-11: 3 de 5 «zombi» traían una DIRECCIÓN, no un contacto):
    // solo si el enlace es de un CONTACTO; una conexión de paso con un NEXO sin identificar que no contesta (app dormida, versión
    // anterior) se suelta igual, pero no es un fallo que mandar al desarrollador
    var nxZ = self._macToNexoId.get(_normMac(deviceId));
    if (nxZ && _isBLEContact(nxZ)) _safeDispatchEvent('nexo:diag:symptom', { kind: 'zombi', info: String(nxZ) });
    self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
    self.connectedDevices.delete(deviceId);
    // 3187: la cuenta de pings de este enlace ya no la borra la vuelta a la app (_cleanupStaleStates): se borra aquí, al soltarlo,
    // para que el enlace que se abra después con esta dirección empiece de 0 aunque no llegue su onDeviceDisconnected
    self._pingFailCount.delete(deviceId);
    self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.RECONNECTING, since: Date.now() });
    var oldTimer = self._backoffTimers.get(deviceId);
    if (oldTimer) { clearTimeout(oldTimer); self._backoffTimers.delete(deviceId); }
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
      _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId })
        .catch(function() {}).finally(function() { setTimeout(function() { self._attemptAutoReconnect(deviceId); }, 500); });
    } else { setTimeout(function() { self._attemptAutoReconnect(deviceId); }, 500); }
    var nx = self._macToNexoId.get(_normMac(deviceId));
    _safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: deviceId, deviceUUID: nx, reason: 'supervisor_zombie' });
  },

  _attemptAutoReconnect(deviceId) {
    var self = this;
    var nx = self._macToNexoId.get(_normMac(deviceId));
    if ((self._reconnectAttempts.get(deviceId) || 0) % 2 === 0) self._autoScanForKnownContacts(); // una vuelta sí y otra no
    if (nx) {
      var contact = _getContactByUUID(nx);
      if (contact && contact.deviceId) setTimeout(function() { self._autoConnectGATT(contact.deviceId, { name: contact.name, deviceUUID: nx }, { why: 'reconexión' }); }, 800);
    }
    // Ronda 2766 (revisión): la espera crece de verdad (antes el contador se borraba antes de cada reintento, siempre
    // eran 2 s y cada vuelta lanzaba una búsqueda; Android ignora más de 5 en 30 s: a partir de ahí las búsquedas
    // llegaban vacías). Se deja de insistir con esta dirección si el contacto ya está conectado por otro camino o tras
    // ~2,5 min (la búsqueda de contactos perdidos sigue aparte).
    // C-1 (07-11): la espera lleva JITTER (fórmula única _jitteredBackoff, misma que el nativo): ~1–2, 2–4, 4–8, 8–16,
    // 15–30 s… en vez de 2, 4, 8, 16, 30 s clavados. Así, si varios teléfonos se cortan a la vez (grupo, concierto,
    // coche), no reintentan todos en el MISMO instante chocando en la radio (GATT 133, ventana de escaneo llena).
    var attempt = self._reconnectAttempts.get(deviceId) || 0;
    if (attempt >= 8 || (nx && (self._bleReadyFor(nx) || (self.lan && self.lan.canReach(nx))))) { self._reconnectAttempts.delete(deviceId); self._backoffTimers.delete(deviceId); return; }
    var delay = _jitteredBackoff(attempt, 2000, 30000);
    self._reconnectAttempts.set(deviceId, attempt + 1);
    var timer = setTimeout(function() {
      var currentState = self._getDeviceState(deviceId);
      if (currentState.state === BLE_STATES.DISCONNECTED || currentState.state === BLE_STATES.ERROR) self._attemptAutoReconnect(deviceId);
      else self._reconnectAttempts.delete(deviceId);
    }, delay);
    self._backoffTimers.set(deviceId, timer);
  },

  _seedNativeConnections() {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'getConnectedDevices')) return;
    _safeNativeCall(self.nativePlugin, 'getConnectedDevices', {}).then(function(res) {
      var list = (res && res.devices) || [];
      list.forEach(function(d) {
        var deviceId = d.id || d.address;
        if (!deviceId || !d.ready) return;
        var st = self._getDeviceState(deviceId);
        if (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) return;
        var contact = _getContactByDeviceId(deviceId);
        var nx = self._macToNexoId.get(_normMac(deviceId)) || (contact ? _normId(contact.nexoId || contact.deviceUUID) : null);
        self.connectedDevices.set(deviceId, { id: deviceId, name: d.name || '', direction: d.direction, role: d.role, servicesReady: true, deviceUUID: nx });
        self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { role: d.role, seeded: true });
        // 3255 (diagnósticos S24↔Austin 19-11 14:23 y 14:56, «enlace_abre_cierra»): un enlace cerrado por repetido volvía «recuperado» ~60 s
        // después y el desempate lo cerraba otra vez. Para ver la causa en el próximo diagnóstico: papel del enlace y si se cerró hace poco.
        var dupAgo = self._dupClosedAt && self._dupClosedAt.get(_normMac(deviceId));
        console.log('[BLEInterface] Conexión existente recuperada al arrancar:', deviceId, nx || '(sin id)', '(' + (d.role || '?') + '/' + (d.direction || '?') + (dupAgo ? '; cerrada por repetida hace ' + Math.round((Date.now() - dupAgo) / 1000) + ' s' : '') + ')');
        // 3330 (diagnóstico S24↔Austin 24-11 14:54, los dos en 3148): el enlace «recuperado» al volver la app puede ser medio muerto
        // (el servicio del otro se reinició y ya no oye por él: las escrituras «salen» y nada vuelve). Se queda «sin comprobar» hasta oír
        // algo por él: el vigilante le hace ping YA y con UN ping sin respuesta lo rehace (antes, 4 pings ~55 s con el texto atascado).
        self._unverified = self._unverified || new Map(); self._unverified.set(deviceId, Date.now());
        if (nx) {
          self._notifyPeerReady(deviceId, nx);
          if (self.ackSystem && self.ackSystem.sendSessionSync) self.ackSystem.sendSessionSync(deviceId, nx);
          self._resendPendingMessages(nx);
        }
        else if (typeof self._askWhoIs === 'function') self._askWhoIs(deviceId); // 3263 (fase 2, enlaces heredados al abrir la app): sin saber de quién es, se le pregunta «quién eres»
      });
      // 3332 (diagnóstico S24 24-11 17:23): con varias conexiones de paso al mismo contacto recuperadas a la vez, la primera no veía aún a
      // las otras «listas» y se quedaba: una 2.ª vuelta, ya con todas sembradas, cierra las de paso que sobran (nunca la última)
      if (self.relay && typeof self.relay.identify === 'function') list.forEach(function(d) {
        var id = d.id || d.address, nx2 = id && self._macToNexoId.get(_normMac(id));
        if (id && d.ready && nx2) { try { self.relay.identify(id, nx2); } catch (e) {} }
      });
    }).catch(function() {});
  },

  // 3323 (reciprocidad del puente): el NEXO de este enlace me trajo un paquete de otro (me hizo de puente): queda en la libreta
  _creditBridge(deviceId, origin) {
    var nx = _normId(this._macToNexoId && this._macToNexoId.get(_normMac(deviceId)));
    if (!/^nx[0-9a-z]{8}$/.test(nx) || nx === _normId(origin) || nx === _normId(this.localNexoId)) return;
    try { _gwNoteHelp(nx, 'me hizo de puente por Bluetooth'); } catch (e) {} // i18n-ok: registro para el diagnóstico
  },

  _kickPeer(deviceId, nexoId) {
    var nx = _normId(nexoId);
    if (!nx || !deviceId) return;
    var nd = _normMac(deviceId);
    if (!this._macToNexoId.get(nd)) this._macToNexoId.set(nd, nx);
    if (!this._nexoIdToMac.get(nx) && !_vNx(deviceId)) this._nexoIdToMac.set(nx, nd);
    if (!this._lastKick) this._lastKick = new Map();
    var now = Date.now();
    if (now - (this._lastKick.get(nx) || 0) < 4000) return;
    this._lastKick.set(nx, now);
    var st = this._getDeviceState(deviceId);
    if (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) {
      this._processPendingMessages(deviceId);
      this._resendPendingMessages(nx);
    }
  },

  _markPeerLost(nexoId) {
    var nx = _normId(nexoId);
    if (!nx) return;
    this._lostPeers.add(nx);
    this._startReconnectScanLoop();
  },

  _startReconnectScanLoop() {
    var self = this;
    if (self._reconnectScanTimer || self.isDummyMode || !self.nativePlugin) return;
    self._reconnectScanAttempts = 0;
    self._reconnectLoopStart = Date.now();
    function schedule(ms) { self._reconnectScanTimer = setTimeout(tick, ms); }
    function tick() {
      self._reconnectScanTimer = null;
      var now = Date.now();
      var presence = now < (self._presenceUntil || 0) && self._hasUnreadyContacts();
      // #87: los contactos en pausa de Bluetooth (no_service repetido) NO disparan re-búsqueda hasta que termine su
      // pausa; así un teléfono con el GATT roto deja de martillar la radio (cientos de «despertares» en el diagnóstico).
      var activeLost = [], nextCooldown = Infinity;
      self._lostPeers.forEach(function(p) {
        var cd = (self._bleCooldownUntil && self._bleCooldownUntil.get(p)) || 0;
        if (cd > now) nextCooldown = Math.min(nextCooldown, cd); else activeLost.push(p);
      });
      if (activeLost.length === 0 && !presence) {
        // si alguno está en pausa, volver a mirar justo cuando acabe; si no hay ninguno, parar el bucle
        if (nextCooldown < Infinity) schedule(Math.min(60000, Math.max(1000, nextCooldown - now)));
        else self._reconnectScanAttempts = 0;
        return;
      }
      var elapsed = now - self._reconnectLoopStart;
      var hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      var interval = hidden ? 60000 : (self._reconnectScanAttempts < 8 ? 15000 : 60000);
      var go = function() {
        // v6.1.13: escanear comparte la radio con las conexiones; durante una transferencia de archivo
        // se salta este turno (en el teléfono real la foto/vídeo iba más lenta)
        if (self._transferActive(true)) {
          var nowP = Date.now();
          var holdMax = (typeof window !== 'undefined' && window.NEXO_SCAN_HOLD_MAX_MS) || SCAN_HOLD_MAX_MS;
          // 3099 (S24 3054 14-11 17:48: «48 min sin buscar … transferencia en curso», 46 de ellos con la app en segundo plano): un
          // hueco largo entre vueltas es la app suspendida, no «sin buscar»: se vuelve a contar desde aquí
          if (self._scanHeldLastAt && nowP - self._scanHeldLastAt > Math.max(3 * interval, 120000)) { self._scanHeldSince = 0; self._scanHeldSaid = false; }
          self._scanHeldLastAt = nowP;
          if (!self._scanHeldSince) self._scanHeldSince = nowP;
          var held = nowP - self._scanHeldSince;
          if (held < holdMax) { console.log('[BLEInterface] Re-búsqueda aplazada: transferencia en curso'); return; }
          // 3020: búsqueda frenada más de 3 min seguidos (contactos perdidos sin buscarse) → síntoma, una vez por racha
          if (!self._scanHeldSaid) { self._scanHeldSaid = true; _safeDispatchEvent('nexo:diag:symptom', { kind: 'busqueda_frenada', info: Math.round(held / 60000) + ' min sin buscar a ' + activeLost.length + ' contacto(s): transferencia en curso; se busca igual' }); }
          // 3099: una transferencia que no acaba (el S23 mandaba un trozo por segundo) no deja sin buscar a los demás: una vuelta
          // cada SCAN_HOLD_MAX_MS aunque siga (comparte la radio unos segundos; lo pendiente de los perdidos no espera para siempre)
          console.log('[BLEInterface] Re-búsqueda aplazada ' + Math.round(held / 1000) + ' s por una transferencia: busco igual (una vuelta)');
          self._scanHeldSince = nowP;
        } else { self._scanHeldSince = 0; self._scanHeldSaid = false; self._scanHeldLastAt = 0; }
        if (!self._cameraBlePaused && !self.isScanning) {
          self._reconnectScanAttempts++;
          console.log('[BLEInterface] Re-búsqueda de contactos', activeLost, presence ? '(+presencia)' : '', 'intento', self._reconnectScanAttempts, hidden ? 'oculta' : '');
          self._autoScanForKnownContacts({ filtered: hidden });
        }
      };
      if (elapsed < 1800000 || presence) { go(); schedule(interval); return; }
      self._lostPeersWithPending().then(function(withPending) {
        if (withPending.length === 0) { self._reconnectScanAttempts = 0; return; }
        go(); schedule(300000);
      }).catch(function() { schedule(300000); });
    }
    schedule(2000);
  },

  _stopAutoScan() {
    var self = this;
    if (!self.isScanning || !self._autoScanActive || !self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'stopScan')) return;
    self._autoScanActive = false;
    console.log('[BLEInterface] Escaneo automático detenido: transferencia en curso');
    _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() { self.isScanning = false; self.updateScanButton(); }).catch(function() { self.isScanning = false; });
  },

  // 3016 (diagnóstico del dueño 12-11): con radioOnly, una transferencia que va POR INTERNET (net:) no cuenta: no usa la
  // radio Bluetooth y un APK de 25 MB por relés tardaba >30 min con la re-búsqueda de contactos PARADA todo ese rato.
  _transferActive(radioOnly) {
    var ack = this.ackSystem;
    if (!ack) return false;
    var busy = false, now = Date.now();
    var viaNet = function(d) { d = (d || '').toString().toLowerCase(); return d.indexOf('net:') === 0 || /^netnx[0-9a-z]{8}$/.test(d); };
    // v6.2.0: solo si el otro sigue confirmando (si cerró la app a mitad, el flujo sigue vivo hasta su
    // tiempo máximo y sin re-búsqueda no se le volvía a encontrar para continuar)
    // #129 (dueño 31-10, «escaneo lento»): un respaldo FÉNIX (type:'fenix') es tarea de FONDO y nadie lo espera. Sobre un
    // enlace degradado (MTU 23 «ready» pero lentísimo, «Cola de escritura llena») arrastra hasta 15 min y dejaba el escaneo
    // de contactos PARADO todo ese rato. Solo las transferencias que el usuario sí espera (foto/vídeo/archivo) pausan el
    // escaneo; un respaldo Fénix no debe frenar el descubrimiento de contactos.
    if (ack.outgoingStreams) ack.outgoingStreams.forEach(function(st) { if (st && st.type === 'file' && !st.aborted && !(st.meta && st.meta.type === 'fenix') && !(radioOnly && viaNet(st.deviceId)) && now - (st.lastAckAt || 0) < 10000) busy = true; });
    if (!busy && ack.incomingBuffers) ack.incomingBuffers.forEach(function(b) { if (b && !b.isChat && !(b.meta && b.meta.type === 'fenix') && !(radioOnly && viaNet(b.deviceId)) && now - (b.lastActivity || 0) < 5000) busy = true; });
    return busy;
  },

  _hasUnreadyContacts() {
    var self = this;
    return (_getBLEContacts() || []).some(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      if (!nx) return false;
      var dev = self._resolveDeviceIdForNexoId(nx);
      if (!dev) return true;
      var st = self._getDeviceState(dev).state;
      return st !== BLE_STATES.READY_TO_CHAT && st !== BLE_STATES.NOTIFICATIONS_READY;
    });
  },

  _lostPeersWithPending() {
    var peers = Array.from(this._lostPeers);
    return Promise.all(peers.map(function(nx) {
      return _vaultLoadMessages(nx).then(function(msgs) { return (msgs || []).some(function(m) { return _isResendable(m, nx); }) ? nx : null; }).catch(function() { return null; });
    })).then(function(r) { return r.filter(Boolean); });
  },

  _startPresenceSearch(ms) {
    this._presenceUntil = Date.now() + (ms || 120000);
    if (this._reconnectScanTimer) { clearTimeout(this._reconnectScanTimer); this._reconnectScanTimer = null; }
    this._startReconnectScanLoop();
  },

  _waitForReadyToChat(deviceId, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!deviceId) { reject(new Error('deviceId invalido')); return; }
      var state = self._getDeviceState(deviceId);
      if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY) {
        resolve();
        return;
      }
      var timer = setTimeout(function() {
        self._readyResolvers.delete(_normMac(deviceId));
        reject(new Error('Timeout esperando READY_TO_CHAT'));
      }, timeoutMs || 12000);
      self._readyResolvers.set(_normMac(deviceId), { resolve: resolve, timer: timer });
    });
  },

  _resolveReadyToChat(deviceId) {
    if (!deviceId) return;
    var resolver = this._readyResolvers.get(_normMac(deviceId));
    if (resolver) {
      clearTimeout(resolver.timer);
      resolver.resolve();
      this._readyResolvers.delete(_normMac(deviceId));
    }
    this._processPendingMessages(deviceId);
  },

  // 2995 (diagnóstico del dueño 10-11, teléfono Nubia con el Bluetooth APAGADO: «Auto-scan fallo: Bluetooth desactivado» una y otra vez, 6
  // «Re-búsqueda» en 2 min y un «zombi» falso de un enlace Bluetooth que ya no existía, que además se mandaba al desarrollador): con el
  // Bluetooth apagado no se busca ni se comprueba ningún enlace Bluetooth; se vuelve a mirar cada minuto y se avisa una sola vez.
  _btIsOff() { return Date.now() < (this._btOffUntil || 0); },
  _noteBtOff() {
    var self = this;
    if (!self._btOffLogged) {
      self._btOffLogged = true;
      console.log('[BLEInterface] Bluetooth apagado: no se busca ni se comprueban enlaces Bluetooth (se vuelve a mirar cada minuto)');
      try { _showToast(t('bt_off_hint', 'Enciende el Bluetooth para hablar con teléfonos cercanos. Por internet sigues conectado.'), 'warn'); } catch (e) {}
    }
    self._btOffUntil = Date.now() + 60000;
  },
  // 3082 (btoff.js; dueño 14-11: «el Bluetooth es la emergencia»): el aviso nativo de Bluetooth apagado/encendido
  // (onBluetoothStateChanged) no tenía quien lo escuchara: al volver a encenderlo la app seguía creyéndolo apagado hasta 60 s
  // (sin buscar): sin internet y con la app del otro cerrada, un texto tardaba ~60 s en salir por Bluetooth. Ahora, al encenderse,
  // se busca y se reintenta lo pendiente enseguida; al apagarse, se deja de buscar al momento (sin esperar a que falle un escaneo).
  _onBtState(data) {
    var self = this;
    var on = !!(data && (data.enabled === true || data.state === 'on'));
    if (!on) { self._noteBtOff(); self._dropBtLinks(); return; }
    var wasOff = self._btOffLogged || self._btIsOff();
    self._btOffUntil = 0; self._btOffLogged = false;
    if (!wasOff) return;
    console.log('[BLEInterface] Bluetooth encendido otra vez: busco y reintento lo pendiente'); // i18n-ok: registro para el diagnóstico
    self._lastAutoScanAt = 0;
    // el nativo rehace el servidor GATT y el anuncio al encenderse (Kotlin 3072): un momento antes de buscar
    setTimeout(function() {
      try { self._startPresenceSearch(120000); } catch (e) {}
      try { self._flushAllPendingMessages(); } catch (e) {}
    }, 800);
  },

  // 3250 (diagnóstico automático de Roberto 19-11 07:14, 3107, «zombi» con el S24): al apagar el Bluetooth el nativo cierra sus enlaces
  // (Kotlin: «GATT client cerrado», «GATT_SERVER Detenido») SIN avisar de cada desconexión. La app seguía creyendo listo el enlace con el
  // dueño: al volver a encenderlo, 4 textos por él fallaron 6 s cada uno («enlace congestionado», MTU 23) y a los ~50 s el vigilante lo dio
  // por «zombi» (con su diagnóstico automático). Ahora, al apagarse, todos los enlaces Bluetooth se dan por cerrados al momento (lo pendiente
  // va por internet/Wi-Fi y al encenderse se busca y reconecta, 3082).
  _dropBtLinks() {
    var self = this, ids = {};
    try {
      self.connectedDevices.forEach(function(v, k) { ids[k] = 1; });
      self._deviceStates.forEach(function(st, k) { if (st && st.state !== BLE_STATES.DISCONNECTED) ids[k] = 1; });
    } catch (e) {}
    var n = 0;
    Object.keys(ids).forEach(function(id) {
      if (!id || _isPathDev(id)) return;   // solo enlaces Bluetooth (no net:/lan:)
      n++;
      try { self._onNativeDisconnected({ deviceId: id, reason: 'bt_off' }); } catch (e) {}
    });
    if (n) console.log('[BLEInterface] Bluetooth apagado: ' + n + ' enlace(s) Bluetooth cerrados (lo pendiente sigue por internet/Wi-Fi)'); // i18n-ok: registro
  }
};
// Reestructuración 23-11: BLE_CONNECTION_METHODS = estos métodos + los de ble_conn_scan.js (mismos nombres, mismo objeto).
export const BLE_CONNECTION_METHODS = Object.assign({}, _BLE_CONNECTION_METHODS_BASE, BLE_CONN_SCAN);

