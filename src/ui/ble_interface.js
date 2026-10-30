import { initE2E, e2eMyPublicKey, e2eSealAnon, e2eOpenAnon, e2eAckKey } from '../vault/e2e_crypto.js';
import { e2eAnyEncrypted, e2eOuterAd, e2eOpenText, e2eAllowsE1 } from '../vault/e2e_proto.js';
import { ratchetInit, ratchetMyBundle, ratchetNotePeerBundle, ratchetForget, ratchetResetPeer, ratchetMyPqId, ratchetPeerPqId } from '../vault/e2e_ratchet.js';
import { createRelay } from './ble_relay.js';
import { createWifiDirect } from './wifi_direct.js';
import { createLan } from './lan.js';
import { createBigFiles } from './big_file.js';
import { createGroups } from './groups.js';
import { createCalls } from './calls.js';
import { callCodecs, createCallMedia } from './call_media.js';
import { createVoiceFx } from './call_voice_fx.js';
import { createNet } from '../net/net_link.js';
import { createFenix } from '../fenix/fenix.js';
import { BLE_NEXO_ID_VAULT_FILE, BLE_PINNED_VAULT_FILE, BLE_UUID_VAULT_FILE, BLE_SEQ_COUNTER_FILE, GRADIENTS, _blePinnedCache, _bleUUIDCache, _getGradientForUUID, _getInitials, _generateNexoId, _saveNexoIdToVault, _loadNexoIdFromVault, _getOrCreateNexoId, _lanId, _netId, _netNx, _vNx, _lanNx, _isProtocolShaped, _chatKind, _cut, _messagePreview, _formatTime, _generateUUID, _loadDeviceUUID, _normId, _normMac, _getBLEContacts, _saveBLEContacts, _addBLEContact, _removeBLEContact, _isBLEContact, _getContactByUUID, _getContactByDeviceId, _getPinnedContacts, _togglePinnedContact, _loadPinnedFromVault, _loadSeqCounter, _saveSeqCounter, _isPinned, BLE_STATES, SUPERVISOR_STATES, _hasNativeMethod, _safeNativeCall, _safeDispatchEvent, _showToast, _isControlPacket, _isResendable, _failStatus, _vaultUpdateMessageStatus, _vaultGetOrCreateContact, _vaultAppendMessage, _hydrateAttachments, _vaultLoadMessages, _autoScanRegister, _autoScanUnregister, _autoScanStart } from './ble_helpers.js';
import { BLE_UI_METHODS } from './ble_ui.js';
import { BLE_CONTACT_METHODS } from './ble_contacts.js';
import { BLE_LINK_METHODS } from './ble_links.js';
import { BLE_KEY_METHODS } from './ble_keys.js';
import { BLE_CAMERA_METHODS } from './ble_camera_pause.js';
import { BLE_JUMP_METHODS } from './ble_jump_send.js';
import { BLE_MESSAGE_METHODS } from './ble_messages.js';
import { BLE_CONNECTION_METHODS } from './ble_connections.js';
import { BLE_PRIVACY_METHODS } from './ble_privacy.js';














































export class BLEInterface {
  constructor(bleMesh) {
    this.bleMesh = bleMesh;
    this.isScanning = false;
    this.foundDevices = new Map();
    this.connectedDevices = new Map();
    this.isVisible = false;
    this.elements = {};
    this.newDevicesCount = 0;
    this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    this.isDummyMode = !bleMesh && !this.nativePlugin;
    this.meshType = this._detectMeshType();
    this.isAdvertising = false;
    this.canAdvertise = false;
    this.localDeviceName = '';
    this.localDeviceUUID = null;
    this.localNexoId = null;
    this._activeChatDeviceId = null;
    this._activeChatDeviceIdNative = null;
    this._deviceStates = new Map();
    this._nexoIdToMac = new Map();
    this._macToNexoId = new Map();
    this._sxHops = new Set(); // v6.11.1: vecinos que reenvían sobres 'sx' (kx con ss:1)
    this._pqHave = new Map(); // v6.12.0: NEXO ID → id de mi clave poscuántica que dice tener (kx 'ph')
    this._receivedMessageIds = new Set();
    this._maxMessageIds = 1000;
    this._dedupTTL = 300000;
    this._pendingMessageQueue = new Map();
    this._readyResolvers = new Map();
    this._notificationFallbackTimers = new Map();
    this.ackSystem = null;
    this.relay = createRelay(this);
    this.wifiDirect = createWifiDirect(this);
    this.lan = createLan(this);
    this.bigFiles = createBigFiles(this);
    this.groups = createGroups(this); // ronda 2758: chats de grupo
    // Ronda 2758: llamadas de voz (window.NEXO_callMediaFactory: audio de prueba en el simulador)
    // (ronda 2772: con los filtros de voz)
    var mf = function(o) { return (window.NEXO_callMediaFactory || createCallMedia)(Object.assign({ voiceFx: createVoiceFx }, o)); };
    mf.codecs = function() { return window.NEXO_callMediaFactory ? 'opus,ulaw' : callCodecs(); };
    this.calls = createCalls(this, mf);
    this.net = createNet(this);
    this.fenix = createFenix(this);
    this._localSeqCounter = 0;
    this._seqCounterLoaded = false;
    this._pendingPings = new Map();
    this._lastPongTime = new Map();
    this._pingInterval = null;
    this._pingIntervalMs = 8000;
    // Ronda 2760: 8 s (antes 3): la respuesta sale detrás de lo que el otro tenga en su cola de escritura
    this._pingTimeoutMs = 8000;
    this._pingMaxFails = 4; // ronda 2814 (#87): más tolerante — un enlace flojo (MTU bajo/Vivo) tarda en contestar; antes (2) lo cortaba cada ~30 s aunque el otro seguía ahí
    this._pingFailCount = new Map();
    // Ronda 2814 (#87): throttle del auto-escaneo (NO el del usuario). Android deja de dar resultados con >5 escaneos
    // en 30 s; con un enlace flojo que se corta y reconecta en bucle se lanzaban escaneos en ráfaga y lo saturaban
    // (scan lento). Mínimo 8 s entre auto-escaneos → como mucho ~4 en 30 s.
    this._autoScanMinMs = 8000;
    this._lastAutoScanAt = 0;
    // Build 2838 (pedido del dueño: «escaneo rápido y robusto en todas las situaciones… y un concierto con miles de
    // NEXO»). Compuerta GLOBAL de arranques de escaneo (no solo el auto): Android deja de dar resultados con >5
    // startScan/30 s (AOSP NUM_SCAN_DURATIONS_KEPT=5, EXCESSIVE_SCANNING_PERIOD_MS=30000) y a veces NI avisa (Nordic
    // Scanner-Compat #18). La defensa primaria es NO llegar al límite: se cuentan TODOS los arranques (usuario + auto +
    // reconexión) en una ventana deslizante y se difiere el que pasaría de _scanWindowMax (uno por debajo de 5, de margen).
    this._scanStartTimes = [];
    this._scanWindowMs = 30000;
    this._scanWindowMax = 4;
    this._scanBlockedUntil = 0;   // tras un onScanFailed de throttle, no reintentar hasta aquí
    this._scanFailBackoff = 0;    // backoff exponencial acotado para errores recuperables (3/5)
    this._scanDeferTimer = null;
    this._userDeferTimer = null;
    this._userScanWanted = 0;     // el usuario pidió buscar hace poco → la recuperación reintenta
    this._scanUnsupported = false; // error 4: este equipo no puede escanear como se pidió
    this._supervisorStates = new Map();
    this._supervisorTimer = null;
    this._supervisorIntervalMs = 6000;
    this._backoffTimers = new Map();
    this._reconnectAttempts = new Map();
    this._notifiedPeers = new Set();
    this._cameraBlePaused = false;
    this._cameraBleResumeWaiters = [];
    this._cameraBlePausedDevices = [];
    this._cameraBleWasAdvertising = false;
    this._lostPeers = new Set();
    // #87 (diagnóstico del dueño 28-10): un contacto cuyo GATT nunca aparece (reason 'no_service', MTU 23) se
    // reconectaba por Bluetooth cada ~15 s PARA SIEMPRE → cientos de «despertares» y batería. Tras varios no_service
    // seguidos se pausa SOLO el Bluetooth con ese contacto (backoff exponencial); internet/Wi-Fi/Jump siguen igual.
    this._noServiceStreak = new Map();   // NEXO ID -> no_service seguidos
    this._bleCooldownUntil = new Map();  // NEXO ID -> hasta cuándo no reintentar Bluetooth
    this._noServiceThreshold = 4;        // a partir de aquí, pausa
    this._bleCooldownBaseMs = 30000;     // 30 s, se duplica
    this._bleCooldownMaxMs = 600000;     // tope 10 min
    this._mtuByDevice = new Map(); // MAC normalizada -> MTU negociado (lo devuelve sendMessage nativo)
    this._reconnectScanTimer = null;
    this._reconnectScanAttempts = 0;
    console.log('[BLEInterface] v6.14.0-NEXO iniciado');
  }

  _detectMeshType() {
    if (!this.bleMesh) return 'none';
    if (typeof this.bleMesh.getState === 'function') return 'nordic';
    if (typeof this.bleMesh.getStatus === 'function') return 'hybrid';
    return 'unknown';
  }

  init() {
    var self = this;
    this.createDOM();
    this.setupEventListeners();
    if (!this.nativePlugin) {
      this.nativePlugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
      if (this.nativePlugin) this.isDummyMode = !this.bleMesh && !this.nativePlugin;
    }
    this._loadContactsAndInit();
    return this;
  }

  setAckSystem(ackSystem) {
    this.ackSystem = ackSystem;
    console.log('[BLEInterface] AckSystem vinculado');
  }


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
  }

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
    this.elements.panel.classList.remove('active');
    this.elements.overlay.classList.remove('active');
    this.renderContactsList();
    this.renderOnlineStrip();
    setTimeout(function() { if (!self.isDummyMode && self.nativePlugin) self._autoScanForKnownContacts(); }, 500);
    setTimeout(function() { self._flushAllPendingMessages(); }, 3000);
    // v6.1.7: antes un solo escaneo de 6 s al abrir; si no veía al otro, nadie volvía a buscar
    setTimeout(function() { if (!self.isDummyMode && self.nativePlugin) self._startPresenceSearch(120000); }, 7000);
    setTimeout(function() { self._backfillLastMessageAt(); }, 1500);
  }

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
      self.connectedDevices.forEach(function(d, deviceId) {
        if (_normMac(deviceId) !== key) return;
        self.connectedDevices.delete(deviceId);
        self._supervisorStates.delete(deviceId); self._lastPongTime.delete(deviceId); self._pingFailCount.delete(deviceId);
      });
    });
    if (keysToDelete.length > 0) console.log('[BLEInterface] Cleanup stale states:', keysToDelete.length);
  }




  /**
   * v6.1.1: No forzar reconexión destructiva si hay transferencia de archivo activa.
   */





  /**
   * v6.1.1: Resolución robusta de deviceId.
   * Prioridad: mapeo actualizado → contact.deviceId → connectedDevices → foundDevices.
   */
  _resolveDeviceIdForNexoId(nexoId) {
    var nx = _normId(nexoId);
    if (!nx) return null;

    // v6.10.0: misma red Wi-Fi (enlace comprobado): por ahí, es lo más rápido
    if (this.lan && this.lan.canReach(nx)) return _lanId(nx);
    // v6.13.0 (regla del dueño): los dos en Wi-Fi, aunque sean módems distintos → por internet antes que Bluetooth
    if (this.net && this.net.canReach(nx) && this.net.bothWifi(nx)) return _netId(nx);

    // 0. v6.1.6: preferir un enlace YA LISTO con ese NEXO ID. Android usa direcciones distintas para
    // anunciarse y para conectarse como cliente: el otro puede estar conectado por una dirección
    // distinta de la del escaneo.
    // Ronda 2760: el de MTU más alto si hay varios (_bleReadyFor)
    var ready = this._bleReadyFor(nx);
    if (ready) return ready;
    // Internet con datos móviles en alguno: después del Bluetooth listo (antes que una dirección sin conectar)
    if (this.net && this.net.canReach(nx)) return _netId(nx);

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
    return found;
  }

  getMtu(deviceId) {
    var m = this._mtuByDevice.get(_normMac(deviceId));
    if (m) return m;
    var nx = this._macToNexoId.get(_normMac(deviceId));
    var mapped = nx ? this._nexoIdToMac.get(nx) : null;
    return (mapped && this._mtuByDevice.get(mapped)) || 0;
  }


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
    this._bleCooldownUntil.delete(_normId(nexoId));
    var ndPeer = _normMac(deviceId);
    if (!this._macToNexoId.get(ndPeer)) this._macToNexoId.set(ndPeer, _normId(nexoId));
    this._sendKx(deviceId, false);
    if (this.relay) this.relay.onLinkChange();
    this._resendRelayedDirect(nexoId, deviceId);
    this._processPendingMessages(deviceId);
    var key = _normMac(deviceId) + ':' + _normId(nexoId);
    if (this._notifiedPeers.has(key)) { console.log('[BLEInterface] Peer ready dup ignorado:', nexoId); return; }
    this._notifiedPeers.add(key);
    console.log('[BLEInterface] Peer ready:', nexoId);
    _safeDispatchEvent('nexo:ble:peerReady', { deviceId: deviceId, nexoId: nexoId });
  }


  _initNexoId() {
    var self = this;
    _getOrCreateNexoId().then(function(nexoId) {
      self.localNexoId = nexoId;
      console.log('[BLEInterface] NEXO ID:', nexoId);
      // Ronda 2755: el anuncio (NEXO ID visible o código rotativo) lo decide ble_privacy.js
      self._startPrivacy();
    });
  }

  // C1 (2777): da a la parte nativa, por contacto, la clave con la que firmar la confirmación (✓✓) del modo cerrado.
  // La clave se deriva del secreto de la pareja (misma que usa el emisor para comprobarla). Se queda en memoria del
  // proceso nativo (sobrevive con la app cerrada, como la config de internet); no se guarda en disco.
  _pushAckKeys() {
    var self = this, pl = self.nativePlugin;
    if (!pl || !_hasNativeMethod(pl, 'setAckKeys')) return Promise.resolve();
    var cs = _getBLEContacts(), jobs = [], keys = [];
    cs.forEach(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      if (!/^nx[0-9a-z]{8}$/.test(nx) || !c.publicKey || c.pendingKey) return;
      jobs.push(e2eAckKey(c.publicKey).then(function(k) { if (k) keys.push({ nx: nx, key: k }); }).catch(function() {}));
    });
    return Promise.all(jobs).then(function() {
      if (keys.length) return _safeNativeCall(pl, 'setAckKeys', { keys: keys }).catch(function() {});
    }).catch(function() {});
  }

  _setupAppStateListener() {
    var self = this;
    // v6.1.7: @capacitor/app no está instalado: el bloque de abajo nunca se activaba y al volver a la app
    // no se reconectaba ni se vaciaba la cola. Ahora avisan el nativo (onAppStateChange) y el WebView
    // (visibilitychange); se usa el primero que llegue.
    if (self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'addListener')) {
      self.nativePlugin.addListener('onAppStateChange', function(st) {
        if (st && st.isActive) self._onAppResumed('nativo');
      });
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') self._onAppResumed('visibilidad');
        else self._pushAckKeys(); // C1 (2777): antes de irse a segundo plano, dar a la parte nativa las claves para firmar el ✓✓ del modo cerrado
      });
    }
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      var appPlugin = window.Capacitor.Plugins.App;
      if (_hasNativeMethod(appPlugin, 'addListener')) {
        appPlugin.addListener('appStateChange', function(state) {
          try {
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
  }

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
  }

  _autoStartAdvertising() {
    var self = this;
    if (self.isDummyMode || !self.nativePlugin) return Promise.resolve();
    if (!_hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) return Promise.resolve();
    return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
      .then(function(btState) {
        var canAdv = btState && btState.canAdvertise;
        var serverReady = btState && btState.serverReady;
        if ((canAdv || serverReady) && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
          return _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).then(function() { self.isAdvertising = true; self.canAdvertise = true; self.updateVisibilityButton(); }).catch(function() {});
        }
      }).catch(function() {});
  }

  _loadLocalDeviceInfo() {
    var self = this;
    if (!self.nativePlugin || !_hasNativeMethod(self.nativePlugin, 'getLocalDeviceInfo')) return Promise.resolve();
    return _safeNativeCall(self.nativePlugin, 'getLocalDeviceInfo', {}).then(function(info) {
      self.localDeviceName = (info && info.deviceName) || '';
      // v6.12.0: Bluetooth de largo alcance (LE Coded PHY) en este teléfono (Jump con más alcance); para el diagnóstico
      if (info && typeof info.codedPhy === 'boolean' && self._codedPhy !== info.codedPhy) {
        self._codedPhy = info.codedPhy;
        console.log('[JUMP] Largo alcance (LE Coded): ' + (info.codedPhy ? 'sí' : 'no en este teléfono'));
      }
    }).catch(function() {});
  }

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
    this._nativeScanStoppedListener = this.nativePlugin.addListener('onScanStopped', function() {
      try { if (self.isScanning) { self.isScanning = false; self._autoScanActive = false; self.updateScanButton(); } } catch (e) {}
    });
  }

  _onScanFound(data, retried) {
    var self = this;
    try {
      var deviceId = data.deviceId || '';
      var name = data.name || '';
      if (!deviceId) return;
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
  }

  _setupNativeServerReadyListener() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeServerReadyListener = this.nativePlugin.addListener('onServerReady', function(data) {
      try { console.log('[BLEInterface] onServerReady:', data); } catch (e) {}
    });
  }

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
            var streak = (self._noServiceStreak.get(nsId) || 0) + 1;
            self._noServiceStreak.set(nsId, streak);
            if (streak >= self._noServiceThreshold) {
              var backoff = Math.min(self._bleCooldownMaxMs, self._bleCooldownBaseMs * Math.pow(2, streak - self._noServiceThreshold));
              self._bleCooldownUntil.set(nsId, Date.now() + backoff);
              console.warn('[BLEInterface] ' + peerUUID + ' sin servicio GATT ' + streak + ' veces: pauso Bluetooth ' + Math.round(backoff / 1000) + ' s (sigo por internet/Wi-Fi/Jump)');
            }
          } else {
            self._noServiceStreak.delete(nsId); // un corte normal no cuenta como GATT roto
          }
          self._markPeerLost(peerUUID);
          _autoScanRegister(peerUUID);
          _autoScanStart();
        }
        if (self.relay) self.relay.onLinkChange();
        _safeDispatchEvent('nexo:ble:deviceDisconnected', { deviceId: deviceId, deviceUUID: peerUUID });
        if (self.isAdvertising && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'startAdvertising')) {
          _safeNativeCall(self.nativePlugin, 'startAdvertising', {}).catch(function() {});
        }
      } catch (e) {}
    });
  }

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
  }

  _setDeviceState(deviceId, state, meta) {
    meta = meta || {};
    if (!deviceId) return;
    var stateObj = Object.assign({}, meta, { state: state, timestamp: Date.now() });
    // FIX v6.1.3: clave normalizada; los eventos nativos traen 'AA:BB:..' y el mapeo NXID->MAC 'aabb..'
    this._deviceStates.set(_normMac(deviceId), stateObj);
  }

  _getDeviceState(deviceId) {
    if (!deviceId) return { state: BLE_STATES.DISCONNECTED };
    return this._deviceStates.get(_normMac(deviceId)) || { state: BLE_STATES.DISCONNECTED };
  }


  // Devuelve el paquete listo para procesar (descifrado) o null si ya se atendió aquí

  // v6.2.0: intercambio de claves públicas (al conectar, o si el otro la pide con rq)


  // Clave pública de un contacto: la primera se guarda; si cambia se acepta y se avisa (como WhatsApp)
  // Devuelve false si la clave del emisor es distinta de la guardada: sin servidor que autentique, cualquiera
  // cerca podría decir "soy X" con otra clave. Esa clave queda pendiente hasta que el usuario la acepte.

  // Mensaje descifrado: 'ok', 'hold' (clave distinta de la aceptada) o 'drop' (protocolo 1 de quien ya usa
  // el 2, pasado el margen: sería la repetición de un mensaje viejo)

  // ===== v6.11.0: remitente sellado (Jump) =====
  // El contacto entiende los sobres 'sx' (lo dijo en su kx)
  // v6.12.0: ¿hay que mandarle mi clave poscuántica (1,6 KB)? Solo si no dijo ya que tiene la actual
  // v6.11.1: el vecino deviceId (el primer puente) reenvía sobres 'sx' tal cual (lo dijo en su kx)
  // Clave para sellar a este contacto (solo si lo entiende y su clave está aceptada)
  // Paquete (texto JSON) en sobre para nexoId: { v, type:'sx', to, msgId, c } (msgId: el de dentro si es un mensaje,
  // para la custodia del puente; si no, uno al azar). Sin clave o si no lo entiende, tal cual.
  // Paquete dirigido (confirmación, kx…) que sale por Jump: en sobre solo si el puente de ahora lo reenvía bien
  // Remitente de un flujo (texto largo, foto, archivo) por Jump: "sx:" + sobre con { f, fr } (o null)

  // Fénix: el contacto lo tiene (puede guardar fragmentos); se recuerda en el contacto

  // Fénix: el contacto recuperó su cuenta en otro teléfono (misma clave): sesiones del protocolo 2 nuevas

  // El contacto habla el protocolo 2 con su clave aceptada: desde ahora solo ese

  // Paquete de claves del protocolo 2 (kx o tarjeta): solo el de la clave aceptada; el de una pendiente se
  // guarda en el contacto hasta que el usuario la acepte


  // Mensajes retenidos por clave cambiada (en memoria; si la app se cierra, el emisor los reenvía al no
  // haber recibido confirmación)

  // Número de seguridad comprobado en persona (se guarda la clave verificada: si cambia, deja de estarlo)





  // ---------------------------------------------------------------------------
  // Cámara: pause / resume
  // ---------------------------------------------------------------------------




  // ---------------------------------------------------------------------------
  // Envío de mensajes y archivos
  // ---------------------------------------------------------------------------

  // dst (Jump): destino final si deviceId es un puente; va en 'to' del sobre

  // Jump: un paquete ya hecho (de otro teléfono) sale tal cual

  // Jump: apareció una ruta hacia nexoId → lo que esperaba en cola o pendiente en el historial sale por ella

  // Texto por un puente (Jump). Rechaza si no hay ruta.

  // Jump: lo que salió por un puente y aún no tiene ✓✓ se reenvía directo si aparece enlace con el
  // destino (el puente pudo quedarse sin camino; el destino descarta duplicados por id)


  // kx de extremo a extremo (Jump): pedir/enviar la clave pública a un destino por las rutas



  /**
   * v6.1.1: sendFile con espera post-cámara bloqueante + reintento READY.
   */



  openChat(deviceUUID) {
    var self = this;
    return new Promise(function(resolve, reject) {
      try {
        var uuid = _normId(deviceUUID);
        if (!uuid) { reject(new Error('ID no válido')); return; }
        // Ronda 2758: un grupo no es un teléfono (groups_ui.js)
        if (self.groups && self.groups.isGroup(uuid) && typeof window.NEXO_openGroupChat === 'function') { window.NEXO_openGroupChat(uuid); resolve(); return; }
        var contact = _getContactByUUID(uuid);
        var deviceId = contact ? contact.deviceId : null;
        if (!deviceId) {
          deviceId = self._resolveDeviceIdForNexoId(uuid);
        }
        // v6.1.11: sin dirección conocida (contacto compartido aún no visto) el chat se abre igual y se
        // busca al contacto; antes se rechazaba y no se podía abrir
        if (!deviceId) self._markPeerLost(uuid);
        self._activeChatDeviceId = uuid;
        self._activeChatDeviceIdNative = deviceId;
        if (window.NEXO && window.NEXO.app) {
          window.NEXO.app.activeContact = contact || { nexoId: uuid, name: (contact && contact.name) || 'NEXO', displayName: (contact && contact.name) || 'NEXO' };
        }
        self.newDevicesCount = 0;
        self.updateBadge();
        if (contact) {
          contact.unreadCount = 0;
          var contacts = _getBLEContacts();
          var idx = contacts.findIndex(function(c) { return _normId(c.nexoId || c.deviceUUID) === uuid; });
          if (idx >= 0) { contacts[idx].unreadCount = 0; contacts[idx].isNewShared = false; _saveBLEContacts(contacts); self.renderContactsList(); self.renderOnlineStrip(); }
        }
        _safeDispatchEvent('nexo:unread', { nexoId: uuid, count: 0 });
        var state = self._getDeviceState(deviceId);
        var isFullyReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
        var isConnecting = state.state === BLE_STATES.CONNECTING || state.state === BLE_STATES.DISCOVERING_SERVICES;

        function finishOpenChat() {
          var appContainer = document.getElementById('app');
          if (appContainer) appContainer.classList.remove('hidden');
          var nameInput = document.getElementById('chat-contact-name');
          var subtitle = document.getElementById('chat-contact-subtitle');
          var displayName = (contact && contact.name) || 'NEXO';
          if (nameInput) nameInput.value = displayName;
          if (subtitle) subtitle.textContent = '';
          _safeDispatchEvent('nexo:ble:openChat', { contactId: uuid, name: displayName, deviceId: deviceId, transport: 'ble', source: 'ble_interface' });
          self.elements.panel.classList.remove('active');
          self.elements.overlay.classList.remove('active');
        }
        finishOpenChat();
        self._resendPendingMessages(uuid);
        // v6.1.12: solo se avisa; main.js dibuja la última página del historial. Antes se cargaba aquí
        // TODO el historial leyendo de disco todos sus adjuntos y main.js lo dibujaba entero
        _safeDispatchEvent('nexo:vault:messagesLoaded', { contactId: uuid });
        resolve();
        if (deviceId && !isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          if (!isConnecting) {
            console.log('[BLEInterface] openChat: forcing connectToDevice for', deviceId);
            _safeNativeCall(self.nativePlugin, 'connectToDevice', { deviceId: deviceId }).catch(function() {});
          }
        }
      } catch (fatalErr) {
        console.error('[BLEInterface] FATAL openChat:', fatalErr);
        reject(fatalErr);
      }
    });
  }


  // ---------------------------------------------------------------------------
  // Visibility / Scan / DOM
  // ---------------------------------------------------------------------------

  _setupNativeAdvertisingListeners() {
    if (!this.nativePlugin) return;
    if (!_hasNativeMethod(this.nativePlugin, 'addListener')) return;
    var self = this;
    this._nativeAdStartedListener = this.nativePlugin.addListener('onAdvertiseStarted', function() {});
    this._nativeAdFailedListener = this.nativePlugin.addListener('onAdvertiseFailed', function() {});
  }

  // v6.1.8: se llamaba con cada paquete recibido (pings, trozos de foto) y reconstruía toda la lista

  // v6.14.0: mensajes sin leer de cada chat (la burbuja numerada). Los usa notify.js

  // v6.1.8: único punto que actualiza el último mensaje de un contacto (enviado o recibido)

  // v6.1.11: contactos recibidos en una tarjeta compartida. Se validan (NX + 8), se omite el propio y
  // los ya existentes; los nuevos quedan marcados (parpadean en la lista hasta abrir su chat) y se
  // empiezan a buscar por radio. Devuelve { added: [...], existing: [...] }.

  // v6.1.8: contactos guardados antes de lastMessageAt: se toma del historial


  destroy() {
    var self = this;
    console.log('[BLEInterface] destroy()');
    self._stopConnectionSupervisor();
    self._stopPingInterval();
    if (self._reconnectScanTimer) { clearTimeout(self._reconnectScanTimer); self._reconnectScanTimer = null; }
    self._lostPeers.clear();
    self._backoffTimers.forEach(function(t) { clearTimeout(t); });
    self._backoffTimers.clear();
    self._reconnectAttempts.clear();
    ['_nativePayloadListener', '_nativeDeviceConnectedListener', '_nativeDeviceDisconnectedListener',
     '_nativeServicesReadyListener', '_nativeNotificationsListener', '_nativeConnectionFailedListener',
     '_nativeScanFailedListener', '_nativeServerReadyListener', '_nativeAdStartedListener',
     '_nativeAdFailedListener'].forEach(function(prop) {
      if (self[prop]) { try { self[prop].remove(); } catch (e) {} self[prop] = null; }
    });
    self._notificationFallbackTimers.forEach(function(t) { clearTimeout(t); });
    self._notificationFallbackTimers.clear();
    self._readyResolvers.forEach(function(r) {
      clearTimeout(r.timer);
      try { r.reject(new Error('Interface destroyed')); } catch (e) {}
    });
    self._readyResolvers.clear();
    self._pendingPings.forEach(function(p) { clearTimeout(p.timer); });
    self._pendingPings.clear();
    self._pendingMessageQueue.clear();
    self.connectedDevices.clear();
    self.foundDevices.clear();
    self._deviceStates.clear();
    self._supervisorStates.clear();
    self._lastPongTime.clear();
    self._pingFailCount.clear();
    self._nexoIdToMac.clear();
    self._macToNexoId.clear();
    self._receivedMessageIds.clear();
    self._notifiedPeers.clear();
  }
}
Object.assign(BLEInterface.prototype, BLE_CONNECTION_METHODS);
Object.assign(BLEInterface.prototype, BLE_MESSAGE_METHODS);
Object.assign(BLEInterface.prototype, BLE_JUMP_METHODS);
Object.assign(BLEInterface.prototype, BLE_CAMERA_METHODS);
Object.assign(BLEInterface.prototype, BLE_KEY_METHODS);
Object.assign(BLEInterface.prototype, BLE_LINK_METHODS);
Object.assign(BLEInterface.prototype, BLE_CONTACT_METHODS);
Object.assign(BLEInterface.prototype, BLE_UI_METHODS);
Object.assign(BLEInterface.prototype, BLE_PRIVACY_METHODS);
export function initBLEInterface(bleMesh) {
  var instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}
