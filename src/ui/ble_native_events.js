import { _hasNativeMethod, _normMac, _normId, _getContactByDeviceId, BLE_STATES, _getBLEContacts, _saveBLEContacts, _autoScanUnregister, SUPERVISOR_STATES, _safeDispatchEvent, _autoScanRegister, _autoScanStart, _safeNativeCall } from './ble_helpers.js';
import { CODED_ONLY_MS, CODED_HOLD_MS } from './ble_interface_shared.js';
// 3203: una ráfaga de desconexiones pide UN solo startAdvertising (ver _kickAdvertising)
const ADV_KICK_MS = 400, ADV_KICK_MAX_MS = 2000;
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
    // 3129: la app se abrió (o volvió) con un enlace de invitación (InviteLink.kt ya validó dirección, ID y código)
    this._nativeInviteListener = this.nativePlugin.addListener('onInviteLink', function(data) {
      try { console.log('[INVITE] abierto con una invitación de ' + String((data && data.id) || '').toUpperCase()); self._pendingInvite = { id: data && data.id, code: (data && data.code) || '' }; _safeDispatchEvent('nexo:invite', self._pendingInvite); } catch (e) {}
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

    this._nativeDeviceDisconnectedListener = this.nativePlugin.addListener('onDeviceDisconnected', function(data) { self._onNativeDisconnected(data); });
  },

  // 3250: el manejo de «enlace desconectado», aparte para poder usarlo también al apagarse el Bluetooth (ble_connections._onBtState)
  _onNativeDisconnected(data) {
    var self = this;
      try {
        var deviceId = (data && data.deviceId) || '';
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
        if (typeof self._noteLinkFlap === 'function' && flapNx && !dupClosed && data.reason !== 'bt_off' && self._notifiedPeers.has(_normMac(deviceId) + ':' + _normId(flapNx))) self._noteLinkFlap(flapNx, 'desconexion'); // 3020
        var prevSt = self._getDeviceState(deviceId) || {};
        var cutClient = !dupClosed && data.reason !== 'stuck' && prevSt.role === 'client' && (prevSt.state === BLE_STATES.READY_TO_CHAT || prevSt.state === BLE_STATES.NOTIFICATIONS_READY);
        self.connectedDevices.delete(deviceId);
        self._setDeviceState(deviceId, BLE_STATES.DISCONNECTED);
        // 3167b (diagnóstico S24↔realme 3075 16-11 15:17): el otro cortó un enlace nuestro de CLIENTE (p. ej. su desempate de
        // repetidos, 3027) y con ese contacto queda OTRO enlace listo → el nativo lo reabría solo a los ~1,5–3 s (startAutoReconnect)
        // y vuelta a empezar. disconnectDevice (sin server) cancela esos reintentos. Si era el ÚNICO enlace no se toca: sigue
        // reconectando como siempre. Y el desempate ya no lo cuenta «ocupado» (chat abierto) si vuelve a aparecer (_peerCutUntil).
        if (cutClient && flapNx) {
          var cutKey = _normMac(deviceId), other = typeof self._bleReadyFor === 'function' ? self._bleReadyFor(flapNx) : null;
          if (other && _normMac(other) !== cutKey) {
            self._peerCutUntil = self._peerCutUntil || new Map(); self._peerCutUntil.set(cutKey, Date.now() + 600000);
            if (self._peerCutUntil.size > 100) self._peerCutUntil.delete(self._peerCutUntil.keys().next().value);
            console.log('[BLEInterface] Enlace ' + _normId(flapNx) + ' (' + cutKey.slice(-4) + ') cortado por el otro; sigo por (' + _normMac(other).slice(-4) + '): no lo reabro');
            if (_hasNativeMethod(self.nativePlugin, 'disconnectDevice')) _safeNativeCall(self.nativePlugin, 'disconnectDevice', { deviceId: deviceId }).catch(function() {});
          }
        }
        // 3168: si con este contacto ya no queda NINGÚN enlace listo (p. ej. se cayeron los dos a la vez y el primero aún veía al otro),
        // se quitan sus marcas de «cortado por el otro»: si no, su dirección quedaba 10 min sin reabrirse (radiollamada L: 54 s sin enlace)
        if (flapNx && self._peerCutUntil && self._peerCutUntil.size && !(typeof self._bleReadyFor === 'function' && self._bleReadyFor(flapNx))) {
          var cutNx = _normId(flapNx);
          Array.from(self._peerCutUntil.keys()).forEach(function(k) { if (_normId(self._macToNexoId.get(k) || '') === cutNx) self._peerCutUntil.delete(k); });
        }
        // 3265 (vivoarriba.js con la fase 2): el freno de 15 s del «quién soy» (kx) es por CONEXIÓN; si el enlace se cae y vuelve antes de
        // 15 s, el otro lado se quedaba sin saber de quién era el enlace nuevo («Enlace ? …») y no reenviaba lo pendiente
        if (self._kxSentAt) { var kxM = _normMac(deviceId); delete self._kxSentAt[kxM]; delete self._kxSentAt[kxM + ':rq']; }
        self._supervisorStates.set(deviceId, { state: SUPERVISOR_STATES.OFFLINE, since: Date.now() });
        self._lastPongTime.delete(deviceId);
        self._pingFailCount.delete(deviceId);
        // 3283 (diagnóstico automático S24 22-11 14:56, build 3117, «6 desconexiones en 10 min» con el vivo): con una dirección distinta
        // de la guardada en su contacto («Enlace ? …») la marca «llegó a estar listo» no se borraba y cada reintento fallido o aviso
        // repetido contaba como otra caída. Se borra también por el NEXO ID de la dirección (flapNx).
        var notiNx = peerUUID || flapNx;
        if (notiNx) { var key = _normMac(deviceId) + ':' + _normId(notiNx); self._notifiedPeers.delete(key); }
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
        if (self.isAdvertising) self._kickAdvertising(); // 3203: agrupado (una ráfaga de desconexiones = un solo startAdvertising)
      } catch (e) {}
  },

  // 3203 (diagnóstico de Roberto, Motorola edge 40 neo 3087, 17-11 09:32): al volver a la app, 24 «[ADVERTISING] startAdvertising»
  // seguidos en el mismo milisegundo (09:32:04.155–.182): uno por cada desconexión que se acumuló con la app en segundo plano (llegan
  // todas de golpe al volver; 21 eran del mismo teléfono sin identificar). Las peticiones de una ráfaga se juntan: sale UNA,
  // ADV_KICK_MS después de la última (como mucho ADV_KICK_MAX_MS después de la primera), y con el estado de ese momento (el último
  // pedido gana: si entre tanto se dejó de anunciar, no se pide). Una desconexión suelta sigue pidiéndolo (no se pierde el reinicio).
  _kickAdvertising() {
    var self = this, now = Date.now();
    var k = self._advKick || (self._advKick = { first: now, t: null });
    if (k.t) clearTimeout(k.t);
    k.t = setTimeout(function() {
      self._advKick = null;
      if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).catch(function() {});
    }, Math.max(0, Math.min(ADV_KICK_MS, k.first + ADV_KICK_MAX_MS - now)));
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
    // 3262: cuándo se abrió ESTE enlace (se conserva entre sus cambios de estado; al caerse se olvida). El desempate de enlaces
    // repetidos del mismo papel se queda con el más reciente (antes miraba `since`, que nadie ponía: siempre 0)
    if (state !== BLE_STATES.DISCONNECTED && state !== BLE_STATES.ERROR) {
      stateObj.openedAt = (prevC && prevC.openedAt && prevC.state !== BLE_STATES.DISCONNECTED && prevC.state !== BLE_STATES.ERROR) ? prevC.openedAt : Date.now();
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
