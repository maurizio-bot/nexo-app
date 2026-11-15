import { _hasNativeMethod, _normMac, _normId, _getContactByDeviceId, BLE_STATES, _getBLEContacts, _saveBLEContacts, _autoScanUnregister, SUPERVISOR_STATES, _safeDispatchEvent, _autoScanRegister, _autoScanStart, _safeNativeCall } from './ble_helpers.js';
import { CODED_ONLY_MS, CODED_HOLD_MS } from './ble_interface_shared.js';
// Métodos de BLEInterface: AVISOS DEL NATIVO: escaneo (lo que se encuentra), servidor listo, conexiones y desconexiones, estado de cada teléfono.
// Reestructuración 15-11: movidos TAL CUAL desde ble_interface.js, que los une a la clase (como métodos normales).
export const bleNativeEvents = {

  _setupNativeScanListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeDeviceFoundListener = this.nativePlugin.addListener('onDeviceFound', function(data) { self._onScanFound(data); });
    this._nativeScanFailedListener = this.nativePlugin.addListener('onScanFailed', function(data) {
      self._onScanFailed(data);
    });
    // Ronda 2766: el nativo paró la búsqueda (a los 15 s): la app ya no busca (antes se quedaba en "buscando" y ninguna
    // búsqueda automática volvía a arrancar)
    // 3082: Bluetooth apagado/encendido por el usuario (Kotlin registerBluetoothStateReceiver)
    this._nativeBtStateListener = this.nativePlugin.addListener('onBluetoothStateChanged', function(data) {
      try { self._onBtState(data); } catch (e) {}
    });
    this._nativeScanStoppedListener = this.nativePlugin.addListener('onScanStopped', function() {
      try { if (self.isScanning) { self.isScanning = false; self._autoScanActive = false; self.updateScanButton(); } } catch (e) {}
    });
  },

  _onScanFound(data, retried) {
    var self = this;
    try {
      var deviceId = data.deviceId || '';
      var name = data.name || '';
      if (!deviceId) return;
      // 3009 (diagnóstico S24 11-11 10:14, «el Bluetooth está lento»): cada teléfono con NEXO anuncia por DOS direcciones —la normal
      // (1M) y la de LARGO ALCANCE (LE Coded)— con el mismo código. La app se conectaba también a la de largo alcance de teléfonos que
      // estaban al lado (rssi -49/-63) y esas conexiones fallaban (133/147) tras 2–10 s cada una, una y otra vez, ocupando la cola de
      // conexiones de Android mientras la normal entraba en < 0,5 s. Si al mismo código se lo vio por la dirección normal hace < 20 s,
      // la copia de largo alcance se ignora (está cerca); si SOLO se ve por largo alcance (lejos de verdad), se usa como siempre.
      var advTok = String(data.nexoId || '');
      if (advTok) {
        var nowC = Date.now();
        self._seen1MTok = self._seen1MTok || new Map();
        if (!data.coded) {
          self._seen1MTok.set(advTok, nowC); if (self._seen1MTok.size > 300) self._seen1MTok.delete(self._seen1MTok.keys().next().value);
          if (self._codedOnly) self._codedOnly.delete(advTok); // se ve por la normal: está cerca
        }
        else if (nowC - (self._seen1MTok.get(advTok) || 0) < 20000) {
          self._codedSkipLog = self._codedSkipLog || new Map();
          if (nowC - (self._codedSkipLog.get(advTok) || 0) > 60000) { self._codedSkipLog.set(advTok, nowC); console.log('[BLEInterface] Copia de largo alcance (LE Coded) de un teléfono que está cerca: no me conecto por ahí (' + _normMac(deviceId).slice(-4) + ')'); }
          return;
        }
        // 3012 (registro del teléfono de Marcos, 11-11 13:45: «Agregar» tardó ~75 s): si la copia de largo alcance llegaba ANTES que
        // la normal (el orden es arbitrario), la 3009 la dejaba pasar → conexión que falla a los segundos y atasca la cola de
        // Android. Ahora una copia de largo alcance sin la normal ESPERA CODED_HOLD_MS: si en ese rato aparece la normal, se
        // descarta; si no (teléfono lejos de verdad, solo llega por largo alcance), se usa — y las siguientes ya sin esperar.
        else if (!data._codedOk) {
          self._codedOnly = self._codedOnly || new Map();
          if (nowC - (self._codedOnly.get(advTok) || 0) > CODED_ONLY_MS) {
            self._codedHold = self._codedHold || new Map();
            if (!self._codedHold.has(advTok)) {
              self._codedHold.set(advTok, setTimeout(function() {
                self._codedHold.delete(advTok);
                if (Date.now() - (self._seen1MTok.get(advTok) || 0) < 20000) return; // apareció por la normal: está cerca
                self._codedOnly.set(advTok, Date.now()); if (self._codedOnly.size > 300) self._codedOnly.delete(self._codedOnly.keys().next().value);
                self._onScanFound(Object.assign({}, data, { _codedOk: true }), retried);
              }, CODED_HOLD_MS));
            }
            return;
          }
        }
      }
      // Ronda 2755: código rotativo → NEXO ID del contacto, o NEXO anónimo (relay.noteAnon) y nada más
      var nexoId = self._ridFound(data, retried);
      if (nexoId === null) return;
      if (self._cameraBlePaused) {
        console.log('[BLEInterface] Scan event ignorado (cámara pausada):', deviceId);
        return;
      }
      var nd = _normMac(deviceId);
      var nx = _normId(nexoId);
      if (nd && nx) { self._nexoIdToMac.set(nx, nd); self._macToNexoId.set(nd, nx); }
      if (nx && self.relay) self.relay.noteSeen(nx, deviceId, data.rssi);
      self.onDeviceFound({ id: deviceId, name: name, rssi: data.rssi, nexoId: nexoId });
    } catch (e) {}
  },

  _setupNativeServerReadyListener() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
      try { console.log('[BLEInterface] onServerReady:', data); } catch (e) {}
    });
  },

  _setupNativeConnectionListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeDeviceConnectedListener = this.nativePlugin.addListener('onDeviceConnected', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var nd = _normMac(deviceId);
        var peerUUID = null;
        var contact = _getContactByDeviceId(deviceId);
        if (contact) peerUUID = contact.nexoId || contact.deviceUUID;
        var displayName = data.name || (contact ? contact.name : null) || '';
        self.connectedDevices.set(deviceId, { id: deviceId, name: displayName, direction: data.direction || 'outgoing', role: data.role || 'client', servicesReady: data.servicesReady || false, deviceUUID: peerUUID });
        self._setDeviceState(deviceId, data.role === 'server' ? BLE_STATES.READY_TO_CHAT : BLE_STATES.CONNECTING, { direction: data.direction, role: data.role, deviceUUID: peerUUID });
        if (peerUUID && nd) { var nx = _normId(peerUUID); self._nexoIdToMac.set(nx, nd); self._macToNexoId.set(nd, nx); }
        if (peerUUID) {
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(peerUUID); });
          if (idx >= 0) { contacts[idx].online = true; contacts[idx].lastSeen = Date.now(); contacts[idx].deviceId = deviceId; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
          _autoScanUnregister(peerUUID);
        }
        self._pingFailCount.set(deviceId, 0);
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now() });
        _safeDispatchEvent('nexo:ble:deviceConnected', { deviceId: deviceId, deviceUUID: peerUUID, name: displayName });
        // 3012: alguien desconocido se conectó a este teléfono (lado servidor) con «Agregar» abierto: preguntarle quién es
        // (0,6 s: lo que tarda el otro en poder recibir; _linkReadyUnknown insiste una vez más si no contesta)
        if (!peerUUID && data.role === 'server' && typeof self._linkReadyUnknown === 'function') setTimeout(function() { try { self._linkReadyUnknown(deviceId); } catch (e) {} }, 600);
        if (peerUUID) {
          setTimeout(function() {
            var st = self._getDeviceState(deviceId);
            if (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) {
              self._notifyPeerReady(deviceId, peerUUID);
              self._processPendingMessages(deviceId);
              self._resendPendingMessages(peerUUID);
            }
          }, 1500);
        }
        setTimeout(function() {
          if (self.ackSystem && self.ackSystem.sendSessionSync && peerUUID) {
            self.ackSystem.sendSessionSync(deviceId, peerUUID);
          }
        }, 2000);
      } catch (e) {}
    });

    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        // Si la desconexión es por pausa de cámara, no limpiar mapeos ni lanzar eventos de "offline"
        if (self._cameraBlePaused) {
          console.log('[BLEInterface] Desconexión causada por pausa de cámara:', deviceId);
          self.connectedDevices.delete(deviceId);
          self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
          return;
        }
        var peerUUID = null;
        var contact = _getContactByDeviceId(deviceId);
        if (contact) peerUUID = contact.nexoId || contact.deviceUUID;
        // Ronda 2760: al diagnóstico (con la dirección: puede haber varios enlaces con el mismo contacto)
        console.log('[BLEInterface] Enlace ' + (peerUUID || '?') + ' (' + _normMac(deviceId).slice(-4) + ') desconectado' + (data.reason ? ': ' + data.reason : ''));
        // 3068 (diagnóstico automático S24 13-11 15:04, recién actualizado: «enlace_abre_cierra» con el Motorola, su app cerrada): solo
        // cuenta como «abre y cierra» un enlace que llegó a estar LISTO (peerReady). Los intentos «sin servicio» (no_service y su eco
        // sin motivo ~1 s después) nunca abrieron nada: los frena la pausa por no_service y ya salen en el diagnóstico; contarlos
        // aquí daba la alarma cada vez que el otro tiene la app cerrada (y tras reiniciar la app, que vuelve a probar 4 veces).
        var flapNx = peerUUID || self._macToNexoId.get(_normMac(deviceId));
        // 3093 (diagnóstico automático S24 14-11 11:52, «enlace_abre_cierra» con el vivo): el enlace REPETIDO que la propia app
        // acaba de cerrar (Dedup) contaba también como «desconexión»: con sus cierres por repetido ya contados aparte, daba un
        // aviso falso de enlace que se cae (y un diagnóstico de 20 KB por la radio). Lo cerrado por la deduplicación no cuenta.
        var dupClosed = !!(self._dupClosedUntil && (self._dupClosedUntil.get(_normMac(deviceId)) || 0) > Date.now());
        if (typeof self._noteLinkFlap === 'function' && flapNx && !dupClosed && self._notifiedPeers.has(_normMac(deviceId) + ':' + _normId(flapNx))) self._noteLinkFlap(flapNx, 'desconexion'); // 3020
        self.connectedDevices.delete(deviceId);
        self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.OFFLINE, since: Date.now() });
        self._lastPongTime.delete(deviceId);
        self._pingFailCount.delete(deviceId);
        if (peerUUID) { var key = _normMac(deviceId) + ':' + _normId(peerUUID); self._notifiedPeers.delete(key); }
        if (peerUUID) {
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === _normId(peerUUID); });
          if (idx >= 0) { contacts[idx].online = false; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
          // #87: GATT roto (no_service) muchas veces seguidas → pausar Bluetooth con este contacto un rato (backoff)
          var nsId = _normId(peerUUID);
          if (data.reason === 'no_service') {
            // 3025: la racha caduca si el último no_service fue hace más de 10 min (fallos sueltos de días distintos no suman)
            // 3063 (diagnóstico automático S24 13-11 10:23, «enlace_abre_cierra» con el vivo, su app cerrada): la pausa máxima (10 min)
            // duraba lo mismo que la caducidad, así que al acabar la pausa la racha ya había caducado y volvía a empezar de cero: 4
            // intentos (8 cortes) en ráfaga cada 10 min. La caducidad cuenta desde el FIN de la pausa, no desde el último no_service.
            var nsLast = Math.max(self._noServiceLast.get(nsId) || 0, self._bleCooldownUntil.get(nsId) || 0);
            var streak = (Date.now() - nsLast > self._noServiceDecayMs ? 0 : (self._noServiceStreak.get(nsId) || 0)) + 1;
            self._noServiceStreak.set(nsId, streak);
            self._noServiceLast.set(nsId, Date.now());
            if (streak >= self._noServiceThreshold) {
              var backoff = Math.min(self._bleCooldownMaxMs, self._bleCooldownBaseMs * Math.pow(2, streak - self._noServiceThreshold));
              self._bleCooldownUntil.set(nsId, Date.now() + backoff);
              console.warn('[BLEInterface] ' + peerUUID + ' sin servicio GATT ' + streak + ' veces: pauso Bluetooth ' + Math.round(backoff / 1000) + ' s (sigo por internet/Wi-Fi/Jump)');
            }
          }
          // 3025 (diagnósticos del S24 12-11 con el Motorola: «no_service» cada ~1-2 s durante minutos, en 3012, 3018 y 3019):
          // cada no_service venía seguido ~1 s después de un corte SIN motivo de la misma dirección (el eco del lado servidor
          // de la misma conexión), y ese corte borraba la racha → nunca llegaba a 4 y la pausa no saltaba nunca. Un corte
          // normal ya NO borra la racha: solo la borra conectar bien (_notifyPeerReady), y caduca sola a los 10 min.
          self._markPeerLost(peerUUID);
          _autoScanRegister(peerUUID);
          _autoScanStart();
        }
        if (self.relay) self.relay.onLinkChange();
        // 3084: el enlace se acaba de caer: sigue «cerca» 1 min para la reconexión rápida (_btNearby)
        if (peerUUID && /^nx[0-9a-z]{8}$/.test(_normId(peerUUID))) { self._linkLostAt = self._linkLostAt || new Map(); self._linkLostAt.set(_normId(peerUUID), Date.now()); if (self._linkLostAt.size > 300) self._linkLostAt.delete(self._linkLostAt.keys().next().value); }
        _safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: deviceId, deviceUUID: peerUUID });
        if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
          _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).catch(function() {});
        }
      } catch (e) {}
    });
  },

  _setupNativeStateListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeServicesReadyListener = this.nativePlugin.addListener('onServicesReady', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        self._setDeviceState(deviceId, BLE_STATES.DISCOVERING_SERVICES, { servicesReady: true });
        var device = self.connectedDevices.get(deviceId);
        if (device) { device.servicesReady = true; self.connectedDevices.set(deviceId, device); }
        var fallbackTimer = setTimeout(function() {
          var st = self._getDeviceState(deviceId);
          if (st.state === BLE_STATES.DISCOVERING_SERVICES) {
            self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT);
            self._resolveReadyToChat(deviceId);
            var nxFb = self._macToNexoId.get(_normMac(deviceId));
            if (nxFb) self._notifyPeerReady(deviceId, nxFb);
            else if (typeof self._linkReadyUnknown === 'function') self._linkReadyUnknown(deviceId); // 3012
          }
        }, 3000);
        self._notificationFallbackTimers.set(deviceId, fallbackTimer);
      } catch (e) {}
    });

    this._nativeNotificationsListener = this.nativePlugin.addListener('onNotificationsEnabled', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var ft = self._notificationFallbackTimers.get(deviceId);
        if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(deviceId); }
        var peerUUID = null;
        var contact = _getContactByDeviceId(deviceId);
        if (contact) peerUUID = contact.nexoId || contact.deviceUUID;
        self._setDeviceState(deviceId, BLE_STATES.READY_TO_CHAT, { notificationsEnabled: true, deviceUUID: peerUUID });
        self._resolveReadyToChat(deviceId);
        self._processPendingMessages(deviceId);
        var nxFlush = self._macToNexoId.get(_normMac(deviceId));
        if (!nxFlush && contact) nxFlush = contact.nexoId || contact.deviceUUID;
        if (nxFlush) {
          self._notifyPeerReady(deviceId, nxFlush);
          if (self.ackSystem && self.ackSystem.sendSessionSync) {
            setTimeout(function() { self.ackSystem.sendSessionSync(deviceId, nxFlush); }, 300);
          }
          setTimeout(function() { self._resendPendingMessages(nxFlush); }, 500);
        }
        else if (typeof self._linkReadyUnknown === 'function') self._linkReadyUnknown(deviceId); // 3012: «Agregar»: preguntar quién es YA
        self._pingFailCount.set(deviceId, 0);
        self._lastPongTime.set(deviceId, Date.now());
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.HEALTHY, since: Date.now() });
      } catch (e) {}
    });

    this._nativeConnectionFailedListener = this.nativePlugin.addListener('onConnectionFailed', function(data) {
      try {
        var deviceId = data.deviceId || '';
        if (!deviceId) return;
        var ft = self._notificationFallbackTimers.get(deviceId);
        if (ft) { clearTimeout(ft); self._notificationFallbackTimers.delete(deviceId); }
        self._setDeviceState(deviceId, BLE_STATES.ERROR, { lastError: data.reason });
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.OFFLINE, since: Date.now(), error: data.reason });
      } catch (e) {}
    });
  },

  _setDeviceState(deviceId, state, meta) {
    meta = meta || {};
    if (!deviceId) return;
    var stateObj = Object.assign({}, meta, { state: state, timestamp: Date.now() });
    // 3081: cuánto tarda una conexión Bluetooth en quedar lista (desde «conectando» hasta lista para hablar), para el diagnóstico
    var prevC = this._deviceStates.get(_normMac(deviceId));
    if (!/^(lan|net)/i.test(String(deviceId))) {
      if (state === BLE_STATES.CONNECTING) stateObj.connAt = (prevC && prevC.state === BLE_STATES.CONNECTING && prevC.connAt) || Date.now();
      else if (prevC && prevC.connAt && (state === BLE_STATES.READY_TO_CHAT || state === BLE_STATES.NOTIFICATIONS_READY)) { try { if (typeof window.NEXO_noteConnect === 'function') window.NEXO_noteConnect('bluetooth', Date.now() - prevC.connAt); } catch (e) {} }
      else if (prevC && prevC.connAt && state !== BLE_STATES.DISCONNECTED) stateObj.connAt = prevC.connAt;
    }
    // 3027: el papel del enlace (cliente/servidor) se conserva entre cambios de estado del MISMO enlace (lo usa el dedup
    // para desempatar igual que el otro teléfono); al desconectarse se olvida
    if (!('role' in meta) && state !== BLE_STATES.DISCONNECTED) {
      var prevSt = this._deviceStates.get(_normMac(deviceId));
      if (prevSt && prevSt.role && prevSt.state !== BLE_STATES.DISCONNECTED) stateObj.role = prevSt.role;
    }
    // FIX v6.1.3: clave normalizada; los eventos nativos traen 'AA:BB:..' y el mapeo NXID->MAC 'aabb..'
    this._deviceStates.set(_normMac(deviceId), stateObj);
  },

  _getDeviceState(deviceId) {
    if (!deviceId) return { state: BLE_STATES.DISCONNECTED };
    return this._deviceStates.get(_normMac(deviceId)) || { state: BLE_STATES.DISCONNECTED };
  },
};
