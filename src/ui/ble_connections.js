/**
 * NEXO — Conexiones Bluetooth (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752, sin cambios):
 * supervisor de enlaces, pings, reconexión, búsqueda de contactos perdidos, teléfonos encontrados al escanear y
 * esperar a que un enlace esté listo.
 */
import { t } from './i18n.js';
import { BLE_STATES, SUPERVISOR_STATES, _addBLEContact, _getBLEContacts, _isGenericName, _jitteredBackoff, _niceName, _showToast, _netNx, _lanNx, _getContactByDeviceId, _getContactByUUID, _hasNativeMethod, _isBLEContact, _isResendable, _normId, _normMac, _safeDispatchEvent, _safeNativeCall, _saveBLEContacts, _scanWindowFullAt, _dupBleLinksToClose, _vNx, _vaultGetOrCreateContact, _vaultLoadMessages, _wakeShouldFire, _wakeAdvance, _wakeNewEntry, WAKE_GIVEUP_MS } from './ble_helpers.js';


export const BLE_CONNECTION_METHODS = {
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
    // Build 2967 (Fase A, entrega offline): tocar (wake FCM) a los contactos con PENDIENTES, ANTES de la compuerta de abajo
    // (que corta si no hay enlaces vivos — justo el caso offline). El propio tick tiene su freno de 30 s.
    self._tickWakePending();
    if (self._cameraBlePaused) return;
    if (!self._activeChatDeviceId && self.connectedDevices.size === 0) return;
    self.connectedDevices.forEach(function(device, deviceId) {
      var state = self._getDeviceState(deviceId);
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) return;
      // 2995: con el Bluetooth apagado un enlace Bluetooth «listo» es solo un recuerdo: no se le manda ping ni se da por «zombi»
      if (self._btIsOff() && !_netNx(deviceId) && !_lanNx(deviceId)) return;

      // Protección: no matar la conexión mientras se envía un archivo
      if (self._hasActiveFileTransfer(deviceId)) {
        console.log('[BLEInterface] Supervisor: transferencia activa, skip ping/zombie para', deviceId);
        return;
      }

      var lastPong = self._lastPongTime.get(deviceId) || 0;
      var timeSincePong = Date.now() - lastPong;
      if (lastPong === 0 || timeSincePong > 16000) {
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
          if (fails >= self._pingMaxFails) {
            // Solo forzar si NO hay transferencia activa
            if (!self._hasActiveFileTransfer(deviceId)) {
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
  _dedupBleLinks() {
    var self = this;
    if (self._cameraBlePaused || self.isDummyMode) return;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'disconnectDevice')) return;
    var now = Date.now();
    var activeMac = self._activeChatDeviceIdNative ? _normMac(self._activeChatDeviceIdNative) : null;
    var byNexo = new Map();
    self._deviceStates.forEach(function(st, key) {
      if (/^(lan|net)nx/.test(key)) return; // solo Bluetooth (no internet/Wi-Fi)
      if (st.state !== BLE_STATES.READY_TO_CHAT && st.state !== BLE_STATES.NOTIFICATIONS_READY) return;
      var nx = _normId(self._macToNexoId.get(key));
      if (!nx) return;
      var arr = byNexo.get(nx) || [];
      arr.push({
        key: key,
        mtu: (self._mtuByDevice && self._mtuByDevice.get(key)) || 185,
        dead: self._bleCongested(key),
        since: (st && st.since) || 0,
        busy: self._hasActiveFileTransfer(key) || (!!activeMac && _normMac(key) === activeMac)
      });
      byNexo.set(nx, arr);
    });
    byNexo.forEach(function(links, nx) {
      if (links.length < 2) { self._dupSeenSince.delete(nx); return; } // sin repetidos: nada que hacer
      var seen = self._dupSeenSince.get(nx);
      if (!seen) { self._dupSeenSince.set(nx, now); return; }           // primera vez: arrancar el freno, no cerrar aún
      if (now - seen < self._dupDebounceMs) return;                     // aún no estables (podría ser un traspaso)
      var toClose = _dupBleLinksToClose(links);
      for (var i = 0; i < toClose.length; i++) {
        var key = toClose[i];
        if ((self._dupClosedUntil.get(key) || 0) > now) continue;       // enfriamiento por MAC
        self._dupClosedUntil.set(key, now + self._dupCloseCooldownMs);
        console.log('[BLEInterface] Dedup: cierro enlace repetido ' + key + ' de ' + nx + ' (me quedo con el mejor)');
        _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: key }).catch(function() {});
      }
    });
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
      if (via === 'wifi' || via === 'bluetooth' || via === 'internet') { self._pendingWake.delete(nx); return; } // ya alcanzable → lo entrega el camino normal
      var d = _wakeShouldFire(entry, now, WAKE_GIVEUP_MS);
      if (d === 'wait') return;
      if (d === 'passive') {
        if (!entry.passive) { entry.passive = true; console.log('[WAKE] ' + nx + ' → PASSIVE (rendido tras ' + entry.attempt + ' toques / tope de tiempo); se entrega al verlo o al abrir su chat'); }
        return;
      }
      // d === 'fire': antes de tocar, confirmar que SIGUE habiendo pendientes (si ya se entregaron por otro camino —buzón+ack
      // con el otro en 2.º plano, Jump— no hay a quién despertar y la entrada se va sola). Asíncrono (lee la bóveda) y raro.
      self._wakeStillPending(nx).then(function(still) {
        if (!self._pendingWake || self._pendingWake.get(nx) !== entry) return; // la entrada cambió mientras tanto
        if (!still) { self._pendingWake.delete(nx); console.log('[WAKE] ' + nx + ' ya no tiene pendientes: fin del toque'); return; }
        var fired = (typeof self._wakeSleepingPeer === 'function') ? self._wakeSleepingPeer(nx) : null;
        if (fired === 'waking') {
          self._pendingWake.set(nx, _wakeAdvance(entry, now, Math.random()));
          console.log('[WAKE] toque a ' + nx + ' (intento ' + (entry.attempt + 1) + ', por pendientes)');
        } else if (fired === 'wifi' || fired === 'bluetooth' || fired === 'internet') {
          self._pendingWake.delete(nx); // se volvió alcanzable justo al tocar
        } // else (falsy): no se pudo tocar (sin token/internet) → se reintenta en el próximo tick, sin avanzar el backoff
      });
    });
  },

  // ¿Sigue habiendo mensajes pendientes para este contacto? Lee la bóveda (igual que el flush); sin bóveda (sim puro) o
  // ante un error se asume que sí (mejor un toque de más que dejar a alguien sin despertar).
  _wakeStillPending(nx) {
    try {
      var w = (typeof window !== 'undefined') ? window : null;
      var p = (w && typeof w.vaultGetPendingMessages === 'function') ? w.vaultGetPendingMessages(nx)
        : (w ? _vaultLoadMessages(nx).then(function(msgs) { return msgs.filter(_isResendable); }) : null);
      if (!p) return Promise.resolve(true);
      var selfW = this;
      return Promise.resolve(p).then(function(pending) { return !!(pending && pending.length) || (typeof selfW._citaPendingFrom === 'function' && selfW._citaPendingFrom(nx)); }, function() { return true; }); // Fase D: esperar un archivo grande también es «pendiente»
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
    console.warn('[BLEInterface] Enlace ' + (self._macToNexoId.get(_normMac(deviceId)) || deviceId) + ' sin respuesta a 2 pings: desconectado para reconectar');
    _safeDispatchEvent('nexo:diag:symptom', { kind: 'zombi', info: String(self._macToNexoId.get(_normMac(deviceId)) || deviceId) }); // 2974: síntoma → diagnóstico automático
    self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
    self.connectedDevices.delete(deviceId);
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
      if (contact && contact.deviceId) setTimeout(function() { self._autoConnectGATT(contact.deviceId, { name: contact.name, deviceUUID: nx }); }, 800);
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
        console.log('[BLEInterface] Conexión existente recuperada al arrancar:', deviceId, nx || '(sin id)');
        if (nx) {
          self._notifyPeerReady(deviceId, nx);
          if (self.ackSystem && self.ackSystem.sendSessionSync) self.ackSystem.sendSessionSync(deviceId, nx);
          self._resendPendingMessages(nx);
        }
      });
    }).catch(function() {});
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
        if (self._transferActive()) { console.log('[BLEInterface] Re-búsqueda aplazada: transferencia en curso'); return; }
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

  _transferActive() {
    var ack = this.ackSystem;
    if (!ack) return false;
    var busy = false, now = Date.now();
    // v6.2.0: solo si el otro sigue confirmando (si cerró la app a mitad, el flujo sigue vivo hasta su
    // tiempo máximo y sin re-búsqueda no se le volvía a encontrar para continuar)
    // #129 (dueño 31-10, «escaneo lento»): un respaldo FÉNIX (type:'fenix') es tarea de FONDO y nadie lo espera. Sobre un
    // enlace degradado (MTU 23 «ready» pero lentísimo, «Cola de escritura llena») arrastra hasta 15 min y dejaba el escaneo
    // de contactos PARADO todo ese rato. Solo las transferencias que el usuario sí espera (foto/vídeo/archivo) pausan el
    // escaneo; un respaldo Fénix no debe frenar el descubrimiento de contactos.
    if (ack.outgoingStreams) ack.outgoingStreams.forEach(function(st) { if (st && st.type === 'file' && !st.aborted && !(st.meta && st.meta.type === 'fenix') && now - (st.lastAckAt || 0) < 10000) busy = true; });
    if (!busy && ack.incomingBuffers) ack.incomingBuffers.forEach(function(b) { if (b && !b.isChat && !(b.meta && b.meta.type === 'fenix') && now - (b.lastActivity || 0) < 5000) busy = true; });
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
      return _vaultLoadMessages(nx).then(function(msgs) { return (msgs || []).some(_isResendable) ? nx : null; }).catch(function() { return null; });
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

  _autoScanForKnownContacts(opts) {
    var self = this;
    if (self._cameraBlePaused) return;
    if (self._btIsOff()) return;
    if (self.isScanning) return;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'startScan')) return;
    // Build 2838: compuerta GLOBAL antes del throttle propio — equipo que no puede escanear (error 4), enfriamiento
    // tras un throttle de Android, o ventana de 5/30 s ya llena (contando también los escaneos del usuario y de la
    // reconexión). Si está bloqueado, se salta; el bucle de reconexión/presencia vuelve a intentar.
    if (self._scanUnsupported) return;
    if (Date.now() < (self._scanBlockedUntil || 0)) return;
    // Build 2959: cupo reservado — el FONDO se detiene en _bgScanWindowMax (uno por debajo del tope del usuario), para
    // dejar siempre un hueco de la ventana de Android libre al escaneo del usuario. El usuario sigue usando _scanWindowFull.
    if (self._scanWindowFullBg && self._scanWindowFullBg()) return;
    // Ronda 2814 (#87): throttle. Al menos _autoScanMinMs entre auto-escaneos, para NO pasar el límite de Android
    // (~5/30 s, deja de dar resultados) cuando un enlace flojo se corta y reconecta en bucle. El escaneo del usuario
    // (toggleScan en ble_ui.js) no pasa por aquí, así que buscar a mano sigue inmediato. La reconexión directa por
    // GATT (con la MAC conocida) tampoco depende de esto; solo se aplaza el escaneo redundante, que de todos modos
    // reintenta el bucle de reconexión.
    var nowScan = Date.now();
    if (nowScan - (self._lastAutoScanAt || 0) < (self._autoScanMinMs || 8000)) return;
    self._lastAutoScanAt = nowScan;
    console.log('[BLEInterface] Auto-scan iniciado');
    // v6.12.0: lo que se ve en "dispositivos nuevos" sigue sirviendo hasta que el escaneo lo vuelva a encontrar
    // (antes el "+" de esas filas no hacía nada: el dispositivo ya no estaba en foundDevices)
    self._recentFound = new Map(self.foundDevices);
    self.foundDevices.clear();
    if (self._noteScanStart) self._noteScanStart();
    // Build 2838: SIEMPRE con el filtro NEXO (manufacturer-data). En un concierto el controlador descarta el ruido del
    // estadio (miles de pulseras/beacons/otros teléfonos) ANTES de llegar a la app — palanca nº1 de robustez a escala;
    // antes el auto-escaneo en primer plano iba sin filtro. Solo nos interesan anuncios NEXO de todos modos.
    _safeNativeCall(self.nativePlugin, 'startScan', { filtered: true })
      .then(function() {
        self._scanFailBackoff = 0;
        if (self._btOffLogged) { console.log('[BLEInterface] Bluetooth encendido otra vez'); }
        self._btOffUntil = 0; self._btOffLogged = false;
        self.isScanning = true;
        self._autoScanActive = true;
        var token = self._autoScanToken = (self._autoScanToken || 0) + 1;
        self.updateScanButton();
        setTimeout(function() {
          // Solo si sigue siendo este escaneo automático (no cortar uno posterior del usuario)
          if (self._autoScanToken !== token || !self._autoScanActive) return;
          self._autoScanActive = false;
          if (self.isScanning && _hasNativeMethod(self.nativePlugin, 'stopScan')) {
            _safeNativeCall(self.nativePlugin, 'stopScan', {}).then(function() {
              self.isScanning = false;
              self.updateScanButton();
            }).catch(function() {
              self.isScanning = false;
              self.updateScanButton();
            });
          }
        }, 6000);
      }).catch(function(e) {
        if (/desactivad|disabled|turned off|not enabled|bluetooth.*off/i.test(String((e && e.message) || ''))) { self._noteBtOff(); return; }
        console.warn('[BLEInterface] Auto-scan fallo:', e.message);
      });
  },

  // Build 2838: compuerta global de arranques de escaneo. ¿Está llena la ventana de Android (5/30 s)? Poda y mira.
  // Este es el tope del USUARIO (_scanWindowMax); el fondo usa _scanWindowFullBg (uno por debajo, cupo reservado).
  _scanWindowFull() {
    var now = Date.now();
    var win = this._scanWindowMs || 30000;
    this._scanStartTimes = (this._scanStartTimes || []).filter(function(t) { return now - t < win; });
    return _scanWindowFullAt(this._scanStartTimes.length, this._scanWindowMax || 4);
  },

  // Build 2959: compuerta del FONDO. Usa _bgScanWindowMax (< _scanWindowMax), así el bucle de reconexión deja siempre
  // al menos un arranque libre en la ventana para el escaneo del usuario. Cuenta la MISMA ventana deslizante.
  _scanWindowFullBg() {
    var now = Date.now();
    var win = this._scanWindowMs || 30000;
    this._scanStartTimes = (this._scanStartTimes || []).filter(function(t) { return now - t < win; });
    return _scanWindowFullAt(this._scanStartTimes.length, this._bgScanWindowMax || 3);
  },

  _noteScanStart() {
    this._scanStartTimes = this._scanStartTimes || [];
    this._scanStartTimes.push(Date.now());
  },

  // Cuánto falta (ms) para que se libere un hueco en la ventana de 30 s.
  _scanWindowWaitMs() {
    var now = Date.now();
    var win = this._scanWindowMs || 30000;
    var max = this._scanWindowMax || 4;
    var arr = (this._scanStartTimes || []).filter(function(t) { return now - t < win; }).sort(function(a, b) { return a - b; });
    if (arr.length < max) return 0;
    return Math.max(0, win - (now - arr[arr.length - max]) + 60);
  },

  // Build 2838: máquina de recuperación ante onScanFailed. Android a veces NO avisa del throttle (Nordic Scanner-Compat
  // #18), así que la compuerta es la defensa primaria; esto cubre el camino del error explícito (stack ocupado, sin
  // recursos de hardware en multitud, etc.). Receta por código (guía Punchthrough + AOSP ScanCallback).
  _onScanFailed(data) {
    var self = this;
    var code = (data && typeof data.errorCode === 'number') ? data.errorCode : 0;
    try { self.isScanning = false; self._autoScanActive = false; self.updateScanButton(); } catch (e) {}
    // 1 = ALREADY_STARTED: ya hay un escaneo; no es un fallo. Se trata como «sigue buscando».
    if (code === 1) { self.isScanning = true; try { self.updateScanButton(); } catch (e) {} return; }
    // 4 = FEATURE_UNSUPPORTED: este equipo no puede escanear como se pidió → no reintentar en bucle.
    if (code === 4) { self._scanUnsupported = true; return; }
    var now = Date.now();
    var wantScan = (self._presenceUntil || 0) > now || (self._userScanWanted || 0) > now;
    // 6 = SCANNING_TOO_FREQUENTLY (a veces aflora como 2 = APPLICATION_REGISTRATION_FAILED): esperar a vaciar la
    // ventana de 30 s y un solo reintento.
    if (code === 6 || code === 2) {
      self._scanBlockedUntil = now + 31000;
      self._scanStartTimes = []; // para Android la ventana está «llena»; dejar que se enfríe
      if (wantScan) self._scheduleScanRetry((self._scanBlockedUntil - now) + 100);
      return;
    }
    // 3 = INTERNAL_ERROR, 5 = OUT_OF_HARDWARE_RESOURCES: backoff exponencial corto y acotado.
    if (code === 3 || code === 5) {
      self._scanFailBackoff = Math.min(self._scanFailBackoff ? self._scanFailBackoff * 2 : 1500, 12000);
      if (wantScan) self._scheduleScanRetry(self._scanFailBackoff);
      return;
    }
    // Otros códigos: un reintento suave.
    if (wantScan) self._scheduleScanRetry(2000);
  },

  _scheduleScanRetry(ms) {
    var self = this;
    if (self._scanDeferTimer) clearTimeout(self._scanDeferTimer);
    self._scanDeferTimer = setTimeout(function() {
      self._scanDeferTimer = null;
      if (self.isScanning) return;
      if (Date.now() < (self._scanBlockedUntil || 0)) { self._scheduleScanRetry((self._scanBlockedUntil - Date.now()) + 100); return; }
      self._lastAutoScanAt = 0; // reintento deliberado de recuperación: no lo frena el throttle de 8 s (la ventana 5/30 s sí lo protege)
      self._autoScanForKnownContacts();
    }, Math.max(200, ms || 2000));
  },

  _stopPingInterval() {
    if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
    this._pendingPings.forEach(function(p) { clearTimeout(p.timer); });
    this._pendingPings.clear();
  },

  onDeviceFound(device) {
    var deviceId = device.id || '';
    if (!deviceId) return;
    var nexoId = device.nexoId || '';
    if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
      return;
    }
    var nd = _normMac(deviceId);
    var nx = _normId(nexoId);
    if (nd && nx) {
      this._nexoIdToMac.set(nx, nd);
      this._macToNexoId.set(nd, nx);
    }
    var isContact = _isBLEContact(nexoId);
    if (isContact) {
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) {
        return _normId(c.nexoId || c.deviceUUID) === nx;
      });
      if (idx >= 0) {
        contacts[idx].online = true;
        contacts[idx].lastSeen = Date.now();
        contacts[idx].deviceId = deviceId;
        if (device.name && !_isGenericName(device.name) && _isGenericName(contacts[idx].name)) {
          contacts[idx].name = device.name;
        }
        _saveBLEContacts(contacts);
      }
      this.renderContactsList();
      this.renderOnlineStrip();
      var state = this._getDeviceState(deviceId);
      // v6.1.6: también desde ERROR (p.ej. se conectó cuando el otro tenía la app cerrada)
      if (state.state === BLE_STATES.DISCONNECTED || state.state === BLE_STATES.ERROR) {
        this._autoConnectGATT(deviceId, device);
      }
      return;
    }
    var existing = this.foundDevices.get(nx);
    if (!existing) {
      device.lastSeen = Date.now();
      device.deviceUUID = nexoId;
      this.foundDevices.set(nx, device);
      // Escaneo de Jump (buscar camino para otros): no avisar de "dispositivo nuevo"
      if (!this._relayScan) { this.newDevicesCount++; this.updateBadge(); }
      this.renderNewDeviceBar();
    } else {
      existing.id = deviceId;
      existing.name = !_isGenericName(device.name) ? device.name : (existing.name || device.name || '');
      existing.rssi = device.rssi;
      existing.lastSeen = Date.now();
      existing.deviceUUID = nexoId;
      this.foundDevices.set(nx, existing);
      this.renderNewDeviceBar();
    }
  },

  _addNewDevice(deviceId) {
    var self = this;
    if (!deviceId) {
      var bar = this.elements.newDeviceBar;
      if (bar && bar.dataset) {
        deviceId = bar.dataset.deviceId || '';
      }
    }
    var device = this.foundDevices.get(deviceId) || (this._recentFound && this._recentFound.get(deviceId));
    // Ronda 2764 (informe del dueño: "al pulsar agregar no pasaba nada"): nunca en silencio
    if (!device) {
      console.warn('[ADD] Agregar ' + deviceId + ': ya no está en la lista (se dejó de ver); se vuelve a buscar');
      _showToast(t('add_toast_gone', 'Ya no se ve ese teléfono. Buscando otra vez…'), 'warn');
      this.foundDevices.delete(deviceId); this.renderNewDeviceBar();
      if (!this.isScanning && typeof this.toggleScan === 'function') this.toggleScan();
      return;
    }
    var name = _niceName(device.name, device.deviceUUID);
    var nexoId = device.deviceUUID || '';
    if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
      console.warn('[ADD] Agregar: sin NEXO ID (' + nexoId + ')');
      _showToast(t('add_toast_noid', 'No se pudo agregar: ese teléfono no dijo su NEXO ID. Que abra "Agregar" y vuelve a buscar.'), 'warn');
      return;
    }
    console.log('[ADD] Agregar ' + _normId(nexoId) + ' (' + name + ') por ' + (device.id || deviceId));
    if (!_isBLEContact(nexoId)) {
      _addBLEContact({
        deviceUUID: nexoId,
        name: name,
        deviceId: device.id || null
      });
      _vaultGetOrCreateContact(nexoId, name, device.name);
      // 3012: si este teléfono ya dijo quién es (su kx directo, _noteKxPeer), su clave se guarda al agregarlo: el cifrado queda
      // listo ya y se le reconoce por su código rotativo aunque cambie de dirección (sin clave no se puede calcular su código)
      var kxp = this._kxPeers && this._kxPeers.get(_normId(nexoId));
      if (kxp && kxp.pk && typeof this._noteSenderKey === 'function') {
        try { this._noteSenderKey(nexoId, kxp.pk); if (kxp.b2 && typeof this._notePeerBundle === 'function') this._notePeerBundle(nexoId, kxp.b2); } catch (eK) {}
      }
    } else {
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) {
        return _normId(c.nexoId || c.deviceUUID) === _normId(nexoId);
      });
      if (idx >= 0) {
        contacts[idx].deviceId = device.id || contacts[idx].deviceId;
        contacts[idx].lastSeen = Date.now();
        contacts[idx].online = true;
        _saveBLEContacts(contacts);
      }
    }
    this._autoConnectGATT(device.id || deviceId, device, { manual: true }); // «Agregar» es intención del usuario → ignora la pausa Bluetooth
    // Ronda 2764: si ya estaba conectado, su kx (clave y nombre del teléfono) no se repetía: se le pide
    if (typeof this._sendKx === 'function' && device.id && !/^(lan|net)/i.test(String(device.id))) { var selfK = this; setTimeout(function() { selfK._sendKx(device.id, true, true); }, 800); }
    this.foundDevices.delete(deviceId);
    this.renderNewDeviceBar();
    this.renderContactsList();
    this.renderOnlineStrip();
    this.togglePanel();
  },

  _autoConnectGATT(deviceId, device, opts) {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) return Promise.resolve();
    if (!deviceId) return Promise.resolve();
    // #87 / A2 (análisis 02-11, batería): si este contacto está en PAUSA de Bluetooth (no_service repetido → backoff),
    // NO auto-reconectar aunque el escaneo lo vea o un mensaje lo quiera enviar. Era la OTRA puerta por la que se saltaba
    // el backoff y se volvía a martillar la radio (los «627 despertares» del diagnóstico del Vivo). El tick de re-búsqueda
    // ya respetaba la pausa; ahora también la auto-conexión por resultado de escaneo/reconexión/cámara. Mientras tanto el
    // contacto sigue llegando por internet/Wi-Fi/Jump (la pausa es SOLO del Bluetooth). Una conexión MANUAL del usuario
    // (opts.manual, p.ej. tocar «Agregar») SÍ pasa, porque es intención explícita.
    if (!(opts && opts.manual) && self._bleCooldownUntil) {
      var nxCd = _normId((device && device.deviceUUID) || deviceId);
      var cd = self._bleCooldownUntil.get(nxCd) || 0;
      if (cd > Date.now()) { console.log('[BLEInterface] Auto-conexion omitida: ' + nxCd + ' en pausa Bluetooth (no_service), ' + Math.round((cd - Date.now()) / 1000) + ' s'); return Promise.resolve(); }
    }
    var state = self._getDeviceState(deviceId);
    if (state.state === BLE_STATES.CONNECTING && state.timestamp && (Date.now() - state.timestamp > 8000)) {
      self._forceDisconnectAndReconnect(deviceId);
      return Promise.resolve();
    }
    if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.CONNECTING) return Promise.resolve();
    self._setDeviceState(deviceId, BLE_STATES.CONNECTING, { direction: 'outgoing', role: 'client', auto: true });
    self.connectedDevices.set(deviceId, { id: deviceId, name: (device && device.name) || '', direction: 'outgoing', servicesReady: false, deviceUUID: device && device.deviceUUID });
    var connTarget = deviceId;
    var normTarget = _normMac(deviceId);
    if (!/^[0-9a-f]{12}$/.test(normTarget)) {
      var mapped = self._nexoIdToMac.get(_normId(deviceId));
      if (mapped) connTarget = mapped;
    }
    return _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: connTarget })
      .then(function(result) {
        if (result && (result.connected || result.alreadyConnected)) {
          return self._waitForReadyToChat(deviceId, 8000).then(function() {});
        } else {
          self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
        }
      })
      .catch(function(e) {
        self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
      });
  },

  disconnect(deviceId) {
    var self = this;
    if (self.isDummyMode) return Promise.resolve();
    if (!deviceId) return Promise.resolve();
    var bt = self._backoffTimers.get(deviceId);
    if (bt) { clearTimeout(bt); self._backoffTimers.delete(deviceId); }
    self._reconnectAttempts.delete(deviceId);
    if (_hasNativeMethod(self.nativePlugin, 'disconnectDevice')) {
      return _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId })
        .then(function() {
          if (self._activeChatDeviceId) {
            self._activeChatDeviceId = null;
            self._activeChatDeviceIdNative = null;
            self.updateBadge();
          }
        }).catch(function() {});
    }
    return Promise.resolve();
  }
};
