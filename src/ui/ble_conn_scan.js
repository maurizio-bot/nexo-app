import { _hasNativeMethod, _safeNativeCall, _scanWindowFullAt, _normMac, _normId, _isBLEContact, _getBLEContacts, _isGenericName, _saveBLEContacts, BLE_STATES, _showToast, _niceName, _isPathDev } from './ble_helpers.js';
import { t } from './i18n.js';
import { nearNote } from './find_near.js';
// Métodos de BLE_CONNECTION_METHODS: búsqueda de contactos conocidos, ventanas de escaneo, teléfonos encontrados y conexión GATT automática.
// Reestructuración 23-11: movidos TAL CUAL desde ble_connections.js, que los une en BLE_CONNECTION_METHODS.
export const BLE_CONN_SCAN = {

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
      nearNote(nx, device.rssi); // 3345 (modo multitud): su señal, para «Buscar a…» (find_near.js)
      var contacts = _getBLEContacts();
      var idx = contacts.findIndex(function(c) {
        return _normId(c.nexoId || c.deviceUUID) === nx;
      });
      // 3345 (EDC, docs/EDC_LIMITES.md «ver a un contacto en el escaneo guarda toda la libreta»): con la pantalla de buscar el escaneo
      // no para y cada contacto cercano avisa cada segundo. La libreta se guarda y la lista se repinta solo si algo cambia (deja de
      // estar en línea, otra dirección, otro nombre) o cada 15 s (lo «en línea» mira el último minuto)
      var c0 = idx >= 0 ? contacts[idx] : null;
      var fixName = !!(c0 && device.name && !_isGenericName(device.name) && _isGenericName(c0.name));
      var changed = !c0 || !c0.online || c0.deviceId !== deviceId || fixName || Date.now() - (c0.lastSeen || 0) > 15000;
      if (c0 && changed) {
        c0.online = true;
        c0.lastSeen = Date.now();
        c0.deviceId = deviceId;
        if (fixName) c0.name = device.name;
        _saveBLEContacts(contacts);
      }
      if (changed) {
        this.renderContactsList();
        this.renderOnlineStrip();
      }
      var state = this._getDeviceState(deviceId);
      // 3019 (diagnóstico S24 del dueño 12-11, vivo nx09acdb61): si ya hay un enlace LISTO y sano con este contacto por OTRA
      // dirección (Android usa una para anunciarse y otra para conectarse), no se abre un segundo: el limpiador de enlaces
      // repetidos lo cerraba al minuto y el escaneo lo volvía a abrir (conectar/cerrar cada ~60 s). Sí se abre si el que hay
      // va al mínimo (MTU 23: el nuevo puede ser mejor) o si esta dirección se acaba de cerrar por repetida.
      // 3167b: ni si el OTRO acaba de cortar este enlace (su desempate, 3027): reabrirlo solo daba otro corte (abrir/cerrar cada ~60 s)
      var readyOther = (typeof this._bleReadyFor === 'function') ? this._bleReadyFor(nx) : null;
      var readyMtu = readyOther ? ((this._mtuByDevice && this._mtuByDevice.get(readyOther)) || 185) : 0;
      var dupCooling = !!(this._dupClosedUntil && (this._dupClosedUntil.get(nd) || 0) > Date.now()) || !!(this._peerCutUntil && (this._peerCutUntil.get(nd) || 0) > Date.now());
      var haveGoodLink = !!readyOther && readyOther !== nd && readyMtu > 23;
      // 3327: ya no se frena el enlace nuevo de cliente del NEXO ID mayor (3257): el menor, que decide los repetidos, se queda con el
      // más reciente, así que el nuevo no se cierra; y es lo que saca al mayor de un enlace de servidor viejo tras volver la app.
      // v6.1.6: también desde ERROR (p.ej. se conectó cuando el otro tenía la app cerrada)
      // 3168 (APK 3078 parada en radiollamada L): el enfriamiento solo frena si de verdad QUEDA otro enlace listo con el contacto; si
      // se cayeron los dos a la vez (el primero aún veía al otro «listo»), esta dirección tiene que poder reabrirse ya
      var cooling = dupCooling && !!readyOther && readyOther !== nd;
      if ((state.state === BLE_STATES.DISCONNECTED || state.state === BLE_STATES.ERROR) && !haveGoodLink && !cooling) {
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
      this._newBarSoon(!!device.kx); // 3184 (estudio EDC 17-11): agrupado (antes, la lista entera con cada aviso del escaneo); su kx, al momento
    } else {
      existing.id = deviceId;
      existing.name = !_isGenericName(device.name) ? device.name : (existing.name || device.name || '');
      existing.rssi = device.rssi;
      existing.lastSeen = Date.now();
      existing.deviceUUID = nexoId;
      this.foundDevices.set(nx, existing);
      this._newBarSoon(!!device.kx); // 3184
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
      // 3207 (dueño 17-11: «el mismo protocolo de aceptar un contacto como en dispositivos lejanos»): ya no se agrega al momento:
      // se le manda una SOLICITUD y queda agregado cuando la acepta (ble_near_req.js)
      this._nearRequest(nexoId, name, device);
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

  // 3033: NEXO ID con el que se guarda la pausa de Bluetooth de una dirección/contacto
  _btPauseKey(deviceId, device) {
    var nx = (device && (device.deviceUUID || device.nexoId)) || '';
    if (!nx && deviceId && this._macToNexoId) nx = this._macToNexoId.get(_normMac(deviceId)) || '';
    return _normId(nx || deviceId);
  },
  // 3033: ¿Bluetooth en pausa con este contacto (no_service repetido)? Lo consultan también Jump y los envíos
  _btPaused(nxOrDevice) {
    if (!this._bleCooldownUntil || !nxOrDevice) return 0;
    var k = /^nx/i.test(String(nxOrDevice)) ? _normId(nxOrDevice) : this._btPauseKey(nxOrDevice, null);
    var cd = this._bleCooldownUntil.get(k) || 0;
    return cd > Date.now() ? cd - Date.now() : 0;
  },

  // 3084 (dueño 14-11: «si un contacto no está al alcance del Bluetooth ni siquiera debería intentarlo; siempre primero las vías
  // más rápidas»; diagnóstico S24 08:06: al volver la app se pedía conectar por Bluetooth a los 15 contactos con algo pendiente, por
  // su dirección guardada, sin haberlos visto: cada intento ocupa la cola de conexiones de Android unos segundos y retrasa las de
  // verdad). Cerca = enlace listo, visto al escanear hace < 2 min, o enlace caído hace < 1 min (sigue al lado: reconexión rápida).
  // Si no, no se intenta: lo suyo va por internet/Wi-Fi o espera, y en cuanto el escaneo lo vea se conecta solo (onDeviceFound).
  _btNearby(nx) {
    nx = _normId(nx);
    if (!/^nx[0-9a-z]{8}$/.test(nx)) return true;   // un NEXO sin identificar (de paso): lo decide Jump
    if (typeof this._bleReadyFor === 'function' && this._bleReadyFor(nx)) return true;
    if (this.relay && typeof this.relay._seenRecently === 'function' && this.relay._seenRecently(nx, 120000)) return true;
    var lost = this._linkLostAt && this._linkLostAt.get(nx);
    return !!(lost && Date.now() - lost < 60000);
  },
  _btFarSkip(nx, why) {
    nx = _normId(nx);
    this._btFarLogAt = this._btFarLogAt || new Map();
    var now = Date.now();
    if (now - (this._btFarLogAt.get(nx) || 0) < 300000) return;
    this._btFarLogAt.set(nx, now);
    if (this._btFarLogAt.size > 300) this._btFarLogAt.delete(this._btFarLogAt.keys().next().value);
    console.log('[BLEInterface] ' + nx + ': no está cerca por Bluetooth (no visto en 2 min): no intento conectar (' + why + '); va por internet/Wi-Fi o espera a verlo'); // i18n-ok: registro para el diagnóstico
  },

  _autoConnectGATT(deviceId, device, opts) {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'connectToDevice')) return Promise.resolve();
    if (!deviceId) return Promise.resolve();
    // 3084: no a quien no está cerca (salvo el «Agregar» del usuario, que es intención explícita)
    if (!(opts && opts.manual) && !_isPathDev(deviceId)) {
      var nxNear = self._btPauseKey(deviceId, device);
      if (nxNear && !self._btNearby(nxNear)) { self._btFarSkip(nxNear, (opts && opts.why) || 'reconexión'); return Promise.resolve(); }
    }
    // 3075 (diagnóstico S24 14-11 19:14): un camino guardado de internet / Wi-Fi local / Wi-Fi Direct («net:nx…», «lan:nx…»,
    // «wd:nx…») NO es una dirección Bluetooth: pedir al nativo conectar ahí dejaba un enlace fantasma «conectando» y, con el
    // realme, un «zombi» falso (pings a un Bluetooth que no existe). Esos caminos los lleva su propia capa; aquí no se toca nada.
    if (_isPathDev(deviceId)) return Promise.resolve();
    // #87 / A2 (análisis 02-11, batería): si este contacto está en PAUSA de Bluetooth (no_service repetido → backoff),
    // NO auto-reconectar aunque el escaneo lo vea o un mensaje lo quiera enviar. Era la OTRA puerta por la que se saltaba
    // el backoff y se volvía a martillar la radio (los «627 despertares» del diagnóstico del Vivo). El tick de re-búsqueda
    // ya respetaba la pausa; ahora también la auto-conexión por resultado de escaneo/reconexión/cámara. Mientras tanto el
    // contacto sigue llegando por internet/Wi-Fi/Jump (la pausa es SOLO del Bluetooth). Una conexión MANUAL del usuario
    // (opts.manual, p.ej. tocar «Agregar») SÍ pasa, porque es intención explícita.
    if (!(opts && opts.manual) && self._bleCooldownUntil) {
      // 3033 (diagnóstico S24 12-11 22:25, Motorola con el GATT roto: «pauso Bluetooth 600 s» y aun así conectar/cortar cada
      // 1–3 s, 21 veces): el resultado de escaneo trae el contacto en nexoId (no en deviceUUID) y se buscaba la pausa por la
      // DIRECCIÓN → nunca la encontraba y volvía a conectar. Ahora se busca por su NEXO ID venga como venga.
      var nxCd = self._btPauseKey(deviceId, device);
      var cd = self._bleCooldownUntil.get(nxCd) || 0;
      if (cd > Date.now()) { console.log('[BLEInterface] Auto-conexion omitida: ' + nxCd + ' en pausa Bluetooth (no_service), ' + Math.round((cd - Date.now()) / 1000) + ' s'); return Promise.resolve(); }
    }
    var state = self._getDeviceState(deviceId);
    if (state.state === BLE_STATES.CONNECTING && state.timestamp && (Date.now() - state.timestamp > 8000)) {
      self._forceDisconnectAndReconnect(deviceId);
      return Promise.resolve();
    }
    if (state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY || state.state === BLE_STATES.CONNECTING) return Promise.resolve();
    if (!self._linkGo(deviceId, device, opts)) return Promise.resolve(); // 3276 (fase 4): tope de enlaces y prioridades; 3284: paso libre en la cola (ble_linkmgr)
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
  },
};
