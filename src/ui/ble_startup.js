import { _getBLEContacts, _normMac, _normId, _loadPinnedFromVault, _loadSeqCounter, _loadDeviceUUID, _generateUUID, _lanId, _netId, _getContactByUUID, _safeDispatchEvent, _getOrCreateNexoId, _hasNativeMethod, _safeNativeCall, BLE_STATES } from './ble_helpers.js';
import { e2eAckKey } from '../vault/e2e_crypto.js';
var NET_LIMIT_MS = 60000; // 3347: tiempo sin preferir internet tras un «rate-limited» de los relés
// Métodos de BLEInterface: ARRANQUE y vuelta de la app: contactos, NEXO ID, estados viejos, a qué enlace va cada contacto, MTU, primer plano / segundo plano.
// Reestructuración 15-11: movidos TAL CUAL desde ble_interface.js, que los une a la clase (como métodos normales).
export const bleStartup = {


  _loadContactsAndInit() {
    var self = this;
    var contacts = _getBLEContacts();
    if (contacts && contacts.length > 0) {
      contacts.forEach(function(c) {
        if (c.deviceId && (c.nexoId || c.deviceUUID)) {
          var nd = _normMac(c.deviceId);
          var nx = _normId(c.nexoId || c.deviceUUID);
          if (nd && nx) { self._nexoIdToMac.set(nx, nd); self._macToNexoId.set(nd, nx); }
        }
      });
    }
    _loadPinnedFromVault().then(function() { self._continueInit(); }).catch(function() { self._continueInit(); });
  },

  _continueInit() {
    var self = this;
    var selfSeq = this;
    _loadSeqCounter().then(function(seq) { selfSeq._localSeqCounter = seq; selfSeq._seqCounterLoaded = true; }).catch(function() { selfSeq._localSeqCounter = 0; selfSeq._seqCounterLoaded = true; });
    if (this.isDummyMode) { this.updateStatus('OFFLINE (Dummy)'); }
    else {
      this.updateStatus();
      this._setupNativeScanListeners();
      this._setupNativeConnectionListeners();
      this._setupNativePayloadListener();
      this._setupNativeStateListeners();
      this._setupNativeServerReadyListener();
      setTimeout(function() { self._seedNativeConnections(); }, 300);
      this._loadLocalDeviceInfo();
      this._initVisibility();
      this._initNexoId();
      this._autoStartAdvertising();
    }
    _loadDeviceUUID().then(function(uuid) { self.localDeviceUUID = uuid; }).catch(function() { self.localDeviceUUID = _generateUUID(); });
    this._cleanupStaleStates();
    this._startConnectionSupervisor();
    this._setupAppStateListener();
    setTimeout(function() { self._pushAckKeys(); }, 4000); // C1 (2777): dar pronto a la parte nativa las claves de firma del ✓✓
    try { self._outboxInit(); } catch (eO) {} // 3268 (fase 3): bandeja de salida nativa (los textos pendientes salen aunque la app se duerma)
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
    this.renderContactsList();
    this.renderOnlineStrip();
    setTimeout(function() { if (!self.isDummyMode && self.nativePlugin) self._autoScanForKnownContacts(); }, 500);
    setTimeout(function() { self._flushAllPendingMessages(); }, 3000);
    // v6.1.7: antes un solo escaneo de 6 s al abrir; si no veía al otro, nadie volvía a buscar
    setTimeout(function() { if (!self.isDummyMode && self.nativePlugin) self._startPresenceSearch(120000); }, 7000);
    setTimeout(function() { self._backfillLastMessageAt(); }, 1500);
  },

  _cleanupStaleStates() {
    var self = this;
    var now = Date.now();
    var keysToDelete = [];
    // Ronda 2766 (revisión): los enlaces Wi-Fi e internet (lan…/net…) los llevan lan.js y net_link.js (suben y bajan
    // solos); antes se borraban aquí al volver a la app (guardan 'since', no 'timestamp') y ya no se mandaba nada por
    // Wi-Fi hasta que se caía y volvía (p.ej. una foto elegida en la galería se quedaba en "enviando")
    self._deviceStates.forEach(function(state, deviceId) { if (/^(lan|net)nx/.test(deviceId)) return; if (now - (state.timestamp || state.since || 0) > 10000) keysToDelete.push(deviceId); });
    keysToDelete.forEach(function(key) {
      self._deviceStates.delete(key);
      // connectedDevices y supervisor usan el deviceId nativo (con ':'), no la clave normalizada
      // 3187 (diagnóstico automático S24 3082 17-11 04:04, zombi con la tableta): la cuenta de pings sin respuesta y el último pong
      // del enlace NO se borran aquí. Si el MISMO enlace sigue abierto en el nativo, _seedNativeConnections lo recupera enseguida y
      // el vigilante sigue contando donde iba; antes volvía a 0 en cada vuelta a la app y con la tableta dormida del todo el S24
      // entró y salió 3 veces y tardó 104 s y 9 pings en darlo por muerto (zombivuelta.js). Un enlace que de verdad se cae y se
      // reabre empieza de 0 igual (onDeviceDisconnected los borra, _forceDisconnectAndReconnect borra la cuenta al soltarlo;
      // onDeviceConnected, onNotificationsEnabled y cualquier cosa que llegue por él, el pong incluido, ponen 0).
      self.connectedDevices.forEach(function(d, deviceId) {
        if (_normMac(deviceId) !== key) return;
        self.connectedDevices.delete(deviceId);
        self._supervisorStates.delete(deviceId);
      });
    });
    if (keysToDelete.length > 0) console.log('[BLEInterface] Cleanup stale states:', keysToDelete.length);
  },




  /**
   * v6.1.1: No forzar reconexión destructiva si hay transferencia de archivo activa.
   */





  /**
   * v6.1.1: Resolución robusta de deviceId.
   * Prioridad: mapeo actualizado → contact.deviceId → connectedDevices → foundDevices.
   */
  _resolveDeviceIdForNexoId(nexoId, preferNet) {
    var nx = _normId(nexoId);
    if (!nx) return null;

    // v6.10.0: misma red Wi-Fi (enlace comprobado): por ahí, es lo más rápido
    if (this.lan && this.lan.canReach(nx)) return _lanId(nx);
    // v6.13.0 (regla del dueño): los dos en Wi-Fi, aunque sean módems distintos → por internet antes que Bluetooth
    // 3079 (dueño 14-11: «el Bluetooth es la emergencia, solo por si no hay otro camino; fuera de eso, siempre el más rápido»):
    // también con datos móviles, internet va ANTES que un Bluetooth listo (antes, sin estar los dos en Wi-Fi, el Bluetooth listo
    // iba primero para ahorrar datos: textos y fotos salían por Bluetooth con internet disponible; btemerg.js). canReach ya
    // excluye el internet que llega solo por un PUENTE si con ese contacto hay Bluetooth directo (net_link.canReach).
    // 3347 (diag. Roberto 3159 26-11 16:42, «rate-limited: too many gift wraps»): con los relés LIMITANDO a este teléfono, internet deja
    // de ir primero mientras dure el castigo: lo que sale va por el Wi-Fi o el Bluetooth listos (si no hay otro, internet al final)
    var netHot = this._netLimitedNow();
    if (!netHot && this.net && this.net.canReach(nx)) return _netId(nx);

    // #dueño 06-11 (diagnóstico: un APK de 25 MB a un contacto en línea por internet se iba por BLUETOOTH, partido en
    // 148 mil trozos, y nunca llegaba): un archivo DEMASIADO GRANDE para Bluetooth prefiere internet ANTES que un
    // Bluetooth listo. preferNet lo activan solo los envíos de archivo grande (ble_ack.js). Si el contacto no es
    // alcanzable por internet ahora, cae al Bluetooth de abajo (y ble_ack lo deja pendiente hasta que haya internet/Wi-Fi).
    if (preferNet && !netHot && this.net && this.net.canReach(nx)) return _netId(nx);

    // 0. v6.1.6: preferir un enlace YA LISTO con ese NEXO ID. Android usa direcciones distintas para
    // anunciarse y para conectarse como cliente: el otro puede estar conectado por una dirección
    // distinta de la del escaneo.
    // Ronda 2760: el de MTU más alto si hay varios (_bleReadyFor)
    var ready = this._bleReadyFor(nx);
    if (ready) return ready;

    // 1. Mapeo vivo
    // (ronda 2764: no una dirección que consta como de otro contacto)
    var mappedMac = this._nexoIdToMac.get(nx);
    if (mappedMac && !this._macOfOther(mappedMac, nx)) return mappedMac;

    // 2. Contacto en vault
    var contact = _getContactByUUID(nx);
    if (contact && contact.deviceId) {
      var nd = _normMac(contact.deviceId);
      if (nd && !this._macOfOther(nd, nx)) {
        this._nexoIdToMac.set(nx, nd);
        this._macToNexoId.set(nd, nx);
        return nd;
      }
    }

    // 3. Dispositivos conectados
    var found = null;
    this.connectedDevices.forEach(function(d) {
      if (!found && _normId(d.deviceUUID) === nx) found = d.id;
    });
    if (found) return found;

    // 4. Dispositivos encontrados en scan
    this.foundDevices.forEach(function(d) {
      if (!found && _normId(d.deviceUUID) === nx) found = d.id;
    });
    if (!found && netHot && this.net && this.net.canReach(nx)) return _netId(nx); // 3347: sin otro camino, internet aunque limiten
    return found;
  },

  // 3347: los relés dijeron «rate-limited / too many / slow down» → NET_LIMIT_MS sin preferir internet (otro sobre ahora = más castigo)
  _noteNetLimited(err) {
    var m = String((err && err.message) || '');
    if (!(err && err.code === 'NET_REJECTED' && /rate.?limit|slow down|too many/i.test(m))) return false;
    if (!this._netLimitedNow()) console.log('[NET] Los relés limitan a este teléfono: ' + Math.round(NET_LIMIT_MS / 1000) + ' s sin preferir internet (va por Wi-Fi o Bluetooth si hay)'); // i18n-ok: registro
    this._netLimitUntil = Date.now() + NET_LIMIT_MS;
    return true;
  },
  _netLimitedNow() { return !!(this._netLimitUntil && Date.now() < this._netLimitUntil); },

  getMtu(deviceId) {
    var m = this._mtuByDevice.get(_normMac(deviceId));
    if (m) return m;
    var nx = this._macToNexoId.get(_normMac(deviceId));
    var mapped = nx ? this._nexoIdToMac.get(nx) : null;
    return (mapped && this._mtuByDevice.get(mapped)) || 0;
  },


  // v6.1.6: el nativo puede tener conexiones abiertas desde antes de que el JS escuchara (app recién
  // abierta): sus eventos onDeviceConnected se perdieron. Se consultan y se dan por listas.

  // v6.1.6: cualquier paquete del otro prueba que su app está viva: reenviar lo pendiente ya
  // (antes se esperaba a timeouts o a la siguiente reconexión). Máx. una vez cada 4 s por contacto.


  // v6.1.7: re-búsqueda sin rendirse mientras haya algo que entregar. Antes: máx. 40 intentos (10 min)
  // y nada con la app oculta; si el otro volvía después, nadie reconectaba.
  //  - visible: cada 15 s los 2 primeros minutos, luego cada 60 s
  //  - oculta: cada 60 s con escaneo filtrado (sin filtro Android no da resultados con pantalla apagada)
  //  - pasados 30 min solo sigue (cada 5 min) si quedan mensajes pendientes para un contacto perdido
  //  - además, al abrir/volver a la app se busca 2 min a todo contacto no conectado (puede tener
  //    mensajes para nosotros)

  // v6.1.13: al empezar una transferencia de archivo se corta el escaneo automático en curso
  // (comparte la radio); un escaneo del usuario (panel Gente) no se toca




  // v6.1.7: al abrir la app o volver a ella, buscar un rato a los contactos no conectados

  // ===== v6.10.0: Wi-Fi normal (lan.js) =====
  // Enlace Wi-Fi comprobado: un dispositivo más, listo para chatear; lo pendiente sale por él
  // Se cayó: lo que iba por Wi-Fi sigue por Bluetooth (o Jump, o queda en espera) sin perderse
  // ¿Hay enlace Bluetooth directo y listo con este contacto? (sin contar el Wi-Fi)
  // Señal Wi-Fi mala (on) o buena otra vez (off). Con mala señal y Bluetooth listo, lo nuevo va por Bluetooth y lo
  // que estaba saliendo por Wi-Fi sigue por Bluetooth; al mejorar, lo nuevo vuelve al Wi-Fi solo.
  // Lo que llega por Wi-Fi entra por el mismo camino que lo de Bluetooth
  // ===== v6.13.0: internet por relés públicos (net_link.js) =====
  // El contacto entiende internet por relés (kx nt:1)
  // (si aún no es contacto, p. ej. su primer mensaje crea el contacto justo después, se recuerda y se aplica luego)
  // Contactos creados después de saber que tienen internet (ver _noteNetPeer)
  // Texto al buzón de internet (el contacto no está en línea por ningún camino): ✓ al guardarlo un relé, ✓✓ cuando
  // lo recoja y confirme

  // Por dónde va ahora un contacto (para la interfaz y el diagnóstico)

  _notifyPeerReady(deviceId, nexoId) {
    if (!deviceId || !nexoId) return;
    this._lostPeers.delete(_normId(nexoId));
    // #87: el contacto conectó bien → se olvida la racha de no_service y la pausa de Bluetooth
    this._noServiceStreak.delete(_normId(nexoId));
    this._noServiceLast.delete(_normId(nexoId));
    this._bleCooldownUntil.delete(_normId(nexoId));
    var ndPeer = _normMac(deviceId);
    if (!this._macToNexoId.get(ndPeer)) this._macToNexoId.set(ndPeer, _normId(nexoId));
    this._sendKx(deviceId, false);
    // 24-11 (diagnóstico S24 22:52): el Vivo dormido se identificó por el nativo (sin kx por la app): su conexión «de paso» seguía
    // apuntada como anónima y a los 60 s se cerraba «sin uso» con mensajes para él. Al estar listo, ya se sabe quién es.
    if (this.relay && typeof this.relay.identify === 'function') { try { this.relay.identify(deviceId, nexoId); } catch (e) {} }
    if (this.relay) this.relay.onLinkChange();
    this._resendRelayedDirect(nexoId, deviceId);
    this._processPendingMessages(deviceId);
    var key = _normMac(deviceId) + ':' + _normId(nexoId);
    if (this._notifiedPeers.has(key)) { console.log('[BLEInterface] Peer ready dup ignorado:', nexoId); return; }
    this._notifiedPeers.add(key);
    console.log('[BLEInterface] Peer ready:', nexoId);
    _safeDispatchEvent('nexo:ble:peerReady', { deviceId: deviceId, nexoId: nexoId });
  },


  _initNexoId() {
    var self = this;
    // 3215: la promesa queda a mano para quien necesite el NEXO ID propio antes de que esté (las confirmaciones al arrancar)
    self._nexoIdP = _getOrCreateNexoId().then(function(nexoId) {
      self.localNexoId = nexoId;
      console.log('[BLEInterface] NEXO ID:', nexoId);
      try { window.dispatchEvent(new CustomEvent('nexo:me')); } catch (e) {} // 3218: la cabecera (mi círculo va con el color de mi ID)
      // Ronda 2755: el anuncio (NEXO ID visible o código rotativo) lo decide ble_privacy.js
      self._startPrivacy();
      return nexoId;
    });
  },

  // C1 (2777): da a la parte nativa, por contacto, la clave con la que firmar la confirmación (✓✓) del modo cerrado.
  // La clave se deriva del secreto de la pareja (misma que usa el emisor para comprobarla). Se queda en memoria del
  // proceso nativo (sobrevive con la app cerrada, como la config de internet); no se guarda en disco.
  _pushAckKeys() {
    var self = this, pl = self.nativePlugin;
    if (!pl || !_hasNativeMethod(pl, 'setAckKeys')) return Promise.resolve();
    var cs = _getBLEContacts(), jobs = [], keys = [], sig = self._ackKeysSig(cs);
    cs.forEach(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      if (!/^nx[0-9a-z]{8}$/.test(nx) || !c.publicKey || c.pendingKey) return;
      jobs.push(e2eAckKey(c.publicKey).then(function(k) { if (k) keys.push({ nx: nx, key: k }); }).catch(function() {}));
    });
    return Promise.all(jobs).then(function() {
      if (keys.length) return _safeNativeCall(pl, 'setAckKeys', { keys: keys }).then(function() { self._ackKeysPushed = sig; }).catch(function() {});
      self._ackKeysPushed = sig;
    }).catch(function() {});
  },

  // 16b (diagnóstico 20-11 11:09, S24↔VICK recién agregado): las claves solo se daban al nativo 4 s tras arrancar y al pasar a segundo
  // plano. Con un contacto agregado (o una clave aceptada) DESPUÉS, si el sistema congelaba o cerraba la app sin dar tiempo a ese
  // último aviso, el nativo confirmaba SIN firma y el otro teléfono lo ignoraba («Confirmación sin firma válida»): el mensaje seguía
  // dando vueltas hasta reabrir la app. Ahora, en cada repaso del supervisor (6 s), si cambió el conjunto contacto+clave se vuelven a dar.
  // Huella barata (sin cifrado): NEXO ID + clave pública de los contactos con clave firme.
  _ackKeysSig(cs) {
    var out = [];
    (cs || _getBLEContacts() || []).forEach(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      if (/^nx[0-9a-z]{8}$/.test(nx) && c.publicKey && !c.pendingKey) out.push(nx + ':' + c.publicKey);
    });
    return out.sort().join('|');
  },
  _pushAckKeysIfChanged() {
    var sig = this._ackKeysSig();
    if (sig === (this._ackKeysPushed || '') || this._ackKeysBusy) return false;
    var self = this; self._ackKeysBusy = true;
    var done = function() { self._ackKeysBusy = false; };
    this._pushAckKeys().then(done, done);
    return true;
  },

  _setupAppStateListener() {
    var self = this;
    // 2976 (primer diagnóstico AUTOMÁTICO del dueño): al ARRANCAR en frío, _foreground quedaba undefined hasta el primer cambio
    // de estado (el nativo solo avisa en las transiciones) → el resume de Fénix salía al toque con el usuario en pantalla
    // (dos respaldos sobre Bluetooth a MTU 23 nada más abrir la app). En el teléfono real el WebView de Android sabe si está
    // visible desde el principio; se reconoce por el puente nativo que inyecta Capacitor (window.androidBridge; el simulador no
    // lo tiene —isNativePlatform() ahí también da true por CapacitorCustomPlatform— y queda como estaba: undefined → corre).
    // Perilla de prueba: window.NEXO_SIM_ANDROID_BRIDGE.
    try {
      if ((window.androidBridge || window.NEXO_SIM_ANDROID_BRIDGE) && typeof document !== 'undefined' && document.visibilityState) self._foreground = (document.visibilityState === 'visible');
    } catch (e) {}
    // v6.1.7: @capacitor/app no está instalado: el bloque de abajo nunca se activaba y al volver a la app
    // no se reconectaba ni se vaciaba la cola. Ahora avisan el nativo (onAppStateChange) y el WebView
    // (visibilitychange); se usa el primero que llegue.
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'addListener')) {
      self.nativePlugin.addListener('onAppStateChange', function(st) {
        self._foreground = !!(st && st.isActive); // regla del dueño (07-11): el usuario es la prioridad; con la app en PRIMER PLANO, Fénix y los procesos de fondo no usan la radio
        if (st && st.isActive) self._onAppResumed('nativo');
      });
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function() {
        self._foreground = (document.visibilityState === 'visible'); // regla del dueño (07-11): primer plano → Fénix/fondo en pausa; segundo plano → reanudan
        if (document.visibilityState === 'visible') self._onAppResumed('visibilidad');
        else self._pushAckKeys(); // C1 (2777): antes de irse a segundo plano, dar a la parte nativa las claves para firmar el ✓✓ del modo cerrado
      });
    }
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      var appPlugin = window.Capacitor.Plugins.App;
      if (_hasNativeMethod(appPlugin, 'addListener')) {
        appPlugin.addListener('appStateChange', function(state) {
          try {
            self._foreground = !!(state && state.isActive); // regla del dueño (07-11): usuario primero; primer plano → Fénix/fondo en pausa
            if (state && state.isActive === true) {
              self.renderContactsList(); self.renderOnlineStrip();
              setTimeout(function() { if (!self.isDummyMode && self.nativePlugin && !self.isScanning) self._autoScanForKnownContacts(); }, 500);
              if (!self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
                _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).then(function() { self.isAdvertising = true; self.updateVisibilityButton(); }).catch(function() {});
              }
              self._cleanupStaleStates();
              setTimeout(function() { self._flushAllPendingMessages(); }, 2000);
            }
          } catch (e) {}
        });
      }
    }
  },

  _onAppResumed(source) {
    var self = this;
    var now = Date.now();
    if (now - (self._lastResumeAt || 0) < 2000) return;
    self._lastResumeAt = now;
    if (self.isDummyMode || !self.nativePlugin) return;
    console.log('[BLEInterface] App de vuelta en primer plano (' + source + ')');
    try { self.renderContactsList(); self.renderOnlineStrip(); } catch (e) {}
    self._cleanupStaleStates();
    // Conexiones que siguieron vivas: pedir al otro lo que nos falte y reenviar lo nuestro
    self._seedNativeConnections();
    self._deviceStates.forEach(function(st, key) {
      if (st.state !== BLE_STATES.READY_TO_CHAT && st.state !== BLE_STATES.NOTIFICATIONS_READY) return;
      var nx = self._macToNexoId.get(key);
      if (!nx) return;
      if (self.ackSystem && self.ackSystem.sendSessionSync) self.ackSystem.sendSessionSync(key, nx);
      self._resendPendingMessages(nx);
    });
    self._startPresenceSearch(120000);
    setTimeout(function() { self._flushAllPendingMessages(); }, 1500);
  },
};
