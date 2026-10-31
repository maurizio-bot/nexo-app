/**
 * NEXO — Conexiones Bluetooth (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752, sin cambios):
 * supervisor de enlaces, pings, reconexión, búsqueda de contactos perdidos, teléfonos encontrados al escanear y
 * esperar a que un enlace esté listo.
 */
import { BLE_STATES, SUPERVISOR_STATES, _addBLEContact, _getBLEContacts, _isGenericName, _niceName, _showToast, _getContactByDeviceId, _getContactByUUID, _hasNativeMethod, _isBLEContact, _isResendable, _normId, _normMac, _safeDispatchEvent, _safeNativeCall, _saveBLEContacts, _vNx, _vaultGetOrCreateContact, _vaultLoadMessages } from './ble_helpers.js';


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
    if (self._cameraBlePaused) return;
    if (!self._activeChatDeviceId && self.connectedDevices.size === 0) return;
    self.connectedDevices.forEach(function(device, deviceId) {
      var state = self._getDeviceState(deviceId);
      if (state.state !== BLE_STATES.READY_TO_CHAT && state.state !== BLE_STATES.NOTIFICATIONS_READY) return;

      // Protección: no matar la conexión mientras se envía un archivo
      if (self._hasActiveFileTransfer(deviceId)) {
        console.log('[BLEInterface] Supervisor: transferencia activa, skip ping/zombie para', deviceId);
        return;
      }

      var lastPong = self._lastPongTime.get(deviceId) || 0;
      var timeSincePong = Date.now() - lastPong;
      if (lastPong === 0 || timeSincePong > 16000) {
        self._pingDevice(deviceId).then(function(result) {
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
    // Ronda 2760: al diagnóstico (antes no quedaba rastro y en los teléfonos el enlace se rehacía cada ~30 s)
    console.warn('[BLEInterface] Enlace ' + (self._macToNexoId.get(_normMac(deviceId)) || deviceId) + ' sin respuesta a 2 pings: desconectado para reconectar');
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
    // Ronda 2766 (revisión): la espera crece de verdad (2, 4, 8, 16, 30 s…): antes el contador se borraba antes de
    // cada reintento, siempre eran 2 s y cada vuelta lanzaba una búsqueda (Android ignora más de 5 en 30 s: a partir de
    // ahí las búsquedas llegaban vacías). Se deja de insistir con esta dirección si el contacto ya está conectado por
    // otro camino o tras ~2,5 min (la búsqueda de contactos perdidos sigue aparte)
    var attempt = self._reconnectAttempts.get(deviceId) || 0;
    if (attempt >= 8 || (nx && (self._bleReadyFor(nx) || (self.lan && self.lan.canReach(nx))))) { self._reconnectAttempts.delete(deviceId); self._backoffTimers.delete(deviceId); return; }
    var delay = Math.min(2000 * Math.pow(2, attempt), 30000);
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

  _autoScanForKnownContacts(opts) {
    var self = this;
    if (self._cameraBlePaused) return;
    if (self.isScanning) return;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'startScan')) return;
    // Build 2838: compuerta GLOBAL antes del throttle propio — equipo que no puede escanear (error 4), enfriamiento
    // tras un throttle de Android, o ventana de 5/30 s ya llena (contando también los escaneos del usuario y de la
    // reconexión). Si está bloqueado, se salta; el bucle de reconexión/presencia vuelve a intentar.
    if (self._scanUnsupported) return;
    if (Date.now() < (self._scanBlockedUntil || 0)) return;
    if (self._scanWindowFull && self._scanWindowFull()) return;
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
      }).catch(function(e) { console.warn('[BLEInterface] Auto-scan fallo:', e.message); });
  },

  // Build 2838: compuerta global de arranques de escaneo. ¿Está llena la ventana de Android (5/30 s)? Poda y mira.
  _scanWindowFull() {
    var now = Date.now();
    var win = this._scanWindowMs || 30000;
    this._scanStartTimes = (this._scanStartTimes || []).filter(function(t) { return now - t < win; });
    return this._scanStartTimes.length >= (this._scanWindowMax || 4);
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
      _showToast('Ya no se ve ese teléfono. Buscando otra vez…', 'warn');
      this.foundDevices.delete(deviceId); this.renderNewDeviceBar();
      if (!this.isScanning && typeof this.toggleScan === 'function') this.toggleScan();
      return;
    }
    var name = _niceName(device.name, device.deviceUUID);
    var nexoId = device.deviceUUID || '';
    if (!nexoId || nexoId.length !== 10 || nexoId.indexOf('NX') !== 0) {
      console.warn('[ADD] Agregar: sin NEXO ID (' + nexoId + ')');
      _showToast('No se pudo agregar: ese teléfono no dijo su NEXO ID. Que abra "Agregar" y vuelve a buscar.', 'warn');
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
    this._autoConnectGATT(device.id || deviceId, device);
    // Ronda 2764: si ya estaba conectado, su kx (clave y nombre del teléfono) no se repetía: se le pide
    if (typeof this._sendKx === 'function' && device.id && !/^(lan|net)/i.test(String(device.id))) { var selfK = this; setTimeout(function() { selfK._sendKx(device.id, true, true); }, 800); }
    this.foundDevices.delete(deviceId);
    this.renderNewDeviceBar();
    this.renderContactsList();
    this.renderOnlineStrip();
    this.togglePanel();
  },

  _autoConnectGATT(deviceId, device) {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) return Promise.resolve();
    if (!deviceId) return Promise.resolve();
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
