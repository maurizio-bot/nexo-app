import { createRelay } from './ble_relay.js';
import { createWifiDirect } from './wifi_direct.js';
import { createLan } from './lan.js';
import { createBigFiles } from './big_file.js';
import { createGroups } from './groups.js';
import { createCallMedia, callCodecs } from './call_media.js';
import { createVoiceFx } from './call_voice_fx.js';
import { createCalls } from './calls.js';
import { createGroupMedia } from './call_group_media.js';
import { createGroupCall } from './group_call.js';
import { createNet } from '../net/net_link.js';
import { createFenix } from '../fenix/fenix.js';
import { appLockConfirm } from './app_lock.js';
import { _hasNativeMethod, _safeNativeCall, _normId, _getContactByUUID, _getBLEContacts, _saveBLEContacts, _safeDispatchEvent, BLE_STATES, _isPathDev } from './ble_helpers.js';
import { BLE_CONNECTION_METHODS } from './ble_connections.js';
import { BLE_MESSAGE_METHODS } from './ble_messages.js';
import { BLE_JUMP_METHODS } from './ble_jump_send.js';
import { BLE_CAMERA_METHODS } from './ble_camera_pause.js';
import { BLE_KEY_METHODS } from './ble_keys.js';
import { BLE_NEARREQ_METHODS } from './ble_near_req.js'; // 3207: solicitud de contacto también de cerca
import { applyDisplayName } from './display_name.js'; // 3218: el nombre FIJO manda sobre el del teléfono
import { BLE_LINK_METHODS } from './ble_links.js';
import { BLE_CONTACT_METHODS } from './ble_contacts.js';
import { BLE_OUTBOX_METHODS } from './ble_outbox.js'; // 3268: bandeja de salida nativa (fase 3)
import { BLE_UI_METHODS } from './ble_ui.js';
import { BLE_PRIVACY_METHODS } from './ble_privacy.js';
import { bleStartup } from './ble_startup.js';
import { bleNativeEvents } from './ble_native_events.js';














































// 3012: copia de LARGO ALCANCE (LE Coded) sin la normal: cuánto se espera a que aparezca la normal, y cuánto vale «solo por largo alcance»
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
    this._bleDeadUntil = new Map(); // #dueño 04-11: MAC BT -> hasta cuándo se considera muerta (soltó un mensaje) y se salta a internet
    this._sxHops = new Set(); // v6.11.1: vecinos que reenvían sobres 'sx' (kx con ss:1)
    this._pqHave = new Map(); // v6.12.0: NEXO ID → id de mi clave poscuántica que dice tener (kx 'ph')
    this._receivedMessageIds = new Set();
    this._maxMessageIds = 1000;
    this._dedupTTL = 300000;
    // Build 2960: dedup de enlaces Bluetooth repetidos al mismo NEXO (fase «conectar»). El barrido corre en el ciclo del
    // supervisor; con freno para no cerrar en un traspaso momentáneo (los duplicados deben coexistir _dupDebounceMs) y
    // enfriamiento por MAC para no cerrar-y-reabrir. Nunca cierra un enlace en transferencia ni el del chat activo.
    this._dupSeenSince = new Map();        // nexoId -> cuándo se vieron por primera vez ≥2 enlaces listos
    this._dupClosedUntil = new Map();      // MAC -> hasta cuándo no reintentar cerrarla
    this._dupDebounceMs = 12000;           // los duplicados deben coexistir este tiempo antes de cerrar (> un traspaso)
    this._dupCloseCooldownMs = 60000;      // tras cerrar una MAC, no reintentar por un rato (ya está desconectada)
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
    // #220 fase 2 (dueño 15-11): una SEGUNDA llamada 1-a-1 a la vez (máximo 2 llamadas en total, contando la de grupo)
    this.calls2 = createCalls(this, mf, { lane: 2 });
    // #128: llamadas en grupo (malla, group_call.js) con medios reales (call_group_media.js sobre call_media.js: un
    // micrófono compartido + un decodificador por tramo). El simulador inyecta window.NEXO_gcallMediaFactory (sin
    // micrófono/WebAudio); el audio real lo prueba el dueño en los teléfonos.
    var gmf = function(o) { return window.NEXO_gcallMediaFactory ? window.NEXO_gcallMediaFactory(o) : createGroupMedia(Object.assign({ voiceFx: createVoiceFx }, o)); };
    this.gcall = createGroupCall(this, gmf);
    this.net = createNet(this);
    this.fenix = createFenix(this);
    if (this.fenix.ent) this.fenix.ent.gate = appLockConfirm; // 3148: vetar una recuperación pide el desbloqueo de NEXO (si lo hay)
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
    // #dueño 02-11 (A3): el supervisor corre cada 6 s pero un ping tarda hasta 8 s en caducar → se apilaban 2-3 pings
    // del MISMO enlace en vuelo; al caducar juntos, cada catch sumaba fallo y disparaba la desconexión → el «sin
    // respuesta a 2 pings» salía triplicado. Este set evita apilar: un enlace con un ping en vuelo no recibe otro.
    this._pingInFlight = new Set();   // deviceId con un ping en vuelo (no apilar)
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
    // Build 2959: CUPO RESERVADO. El bucle de FONDO (reconexión/presencia) se detiene un hueco antes del límite del
    // usuario, para que SIEMPRE quede al menos un arranque libre en la ventana de Android. Así, al abrir «Agregar», el
    // escaneo del usuario nunca se difiere («Buscando en un momento…») por culpa del fondo. El usuario usa _scanWindowMax.
    this._bgScanWindowMax = 3;
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
    this._noServiceLast = new Map();     // 3025: NEXO ID -> cuándo fue el último no_service (la racha caduca)
    this._noServiceDecayMs = 600000;     // 3025: 10 min sin no_service → la racha empieza de cero
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

  _autoStartAdvertising() {
    var self = this;
    if (self.isDummyMode || !self.nativePlugin) return Promise.resolve();
    if (!_hasNativeMethod(self.nativePlugin, 'isBluetoothEnabled')) return Promise.resolve();
    return _safeNativeCall(self.nativePlugin, 'isBluetoothEnabled', {})
      .then(function(btState) {
        // 3082: Bluetooth apagado al abrir la app: se sabe ya (antes, solo cuando fallaba el primer escaneo)
        if (btState && btState.enabled === false && typeof self._noteBtOff === 'function') self._noteBtOff();
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
      // 3218: si ya hay nombre FIJO (display_name.js, #dueño 06-11) manda él. Antes, si el nativo respondía DESPUÉS de aplicarlo (en la
      // prueba: aplicado a los 319 ms, pisado a los 327 ms), durante ~4 s —hasta que nameGate lo volvía a poner— la app usaba el nombre
      // del teléfono: lo enseñaba la cabecera y lo podía mandar a quien conectara en ese rato (saludo, solicitudes).
      applyDisplayName(self);
      try { window.dispatchEvent(new CustomEvent('nexo:me')); } catch (e) {} // 3218: mi nombre en la cabecera de Contactos
      // v6.12.0: Bluetooth de largo alcance (LE Coded PHY) en este teléfono (Jump con más alcance); para el diagnóstico
      if (info && typeof info.codedPhy === 'boolean' && self._codedPhy !== info.codedPhy) {
        self._codedPhy = info.codedPhy;
        console.log('[JUMP] Largo alcance (LE Coded): ' + (info.codedPhy ? 'sí' : 'no en este teléfono'));
      }
    }).catch(function() {});
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
        // 3017 (diagnósticos S23 y HONOR del dueño 12-11): primero el mejor camino VIVO (Wi-Fi comprobado, internet, enlace
        // Bluetooth listo); la dirección guardada en el contacto solo si no hay otro. Antes se usaba primero la guardada y se
        // forzaba la conexión a ella aunque ya no sirviera (dirección rotada, o un enlace repetido que la app misma cerró):
        // enlace a medias y escrituras atascadas ~6 s antes de pasar al Wi-Fi.
        var deviceId = self._resolveDeviceIdForNexoId(uuid) || (contact ? contact.deviceId : null) || null;
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
        // P2 (dueño 01-11): si el contacto está DORMIDO (sin enlace vivo), pedir el «toque» FCM AL ABRIR el chat (no solo
        // al enviar): el 1er mensaje ya no espera ni se pierde y el subtítulo pasa a «Conectando…» hasta que llega la
        // presencia del otro (entonces se ve el tipo real: Wi-Fi / Bluetooth / internet). Si ya hay enlace, no hace nada.
        try { if (typeof self._wakeSleepingPeer === 'function') self._wakeSleepingPeer(uuid, 'al abrir el chat'); } catch (e) {} // 3073: también con enlace (su app puede dormir)
        self._prepRoute(uuid, 'al abrir el chat', true); // 3147: saludo por internet ya (el Bluetooth, abajo) — motivo para el registro, no se muestra // i18n-ok
        // v6.1.12: solo se avisa; main.js dibuja la última página del historial. Antes se cargaba aquí
        // TODO el historial leyendo de disco todos sus adjuntos y main.js lo dibujaba entero
        _safeDispatchEvent('nexo:vault:messagesLoaded', { contactId: uuid });
        resolve();
        // 3072: un destino «net:» (solo por internet) no es un Bluetooth: no hay nada que conectar (el nativo lo veía como «netnx…»)
        if (deviceId && !_isPathDev(deviceId) && !isFullyReady && self.nativePlugin && _hasNativeMethod(self.nativePlugin, 'connectToDevice')) {
          // 3040 (diagnóstico S24 13-11 21:28 con …707a, que tenía el Bluetooth apagado): abrir el chat forzaba la conexión
          // aunque ese contacto estuviera en pausa Bluetooth (no_service repetido): otro no_service y una pausa más larga.
          // Con la pausa puesta no se fuerza (el mensaje sale por internet/Wi-Fi/Jump; la pausa se acaba sola).
          var paused = typeof self._btPaused === 'function' ? (self._btPaused(uuid) || self._btPaused(deviceId)) : 0;
          if (paused) console.log('[BLEInterface] openChat: ' + _normId(uuid) + ' en pausa Bluetooth (' + Math.round(paused / 1000) + ' s): no fuerzo la conexión');
          else if (typeof self._btNearby === 'function' && !self._btNearby(uuid)) self._btFarSkip(uuid, 'al abrir el chat'); // 3084
          else if (!isConnecting) {
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


  // 3147 (dueño 16-11: «preparar el mejor camino cuando el usuario ABRE un chat, para que enviar sea instantáneo»): al abrir el chat
  // y al empezar a escribir, un saludo cifrado por internet (net.probe: el otro contesta y se ve en línea en ~1 s) y, al escribir,
  // la conexión Bluetooth si está cerca (visto hace < 2 min), sin enlace ni intento en curso y sin pausa. Sin escaneos nuevos
  // (regla de batería). Como mucho una vez cada 20 s por contacto (el saludo, con el tope de net.probe). Solo contactos 1 a 1.
  _prepRoute(nexoId, why, internetOnly) {
    var nx = _normId(nexoId), now = Date.now();
    if (!/^nx[0-9a-z]{8}$/.test(nx) || (this.groups && typeof this.groups.isGroup === 'function' && this.groups.isGroup(nx))) return;
    try { if (this.net && typeof this.net.probe === 'function') this.net.probe(nx, why); } catch (e) {}
    if (internetOnly || !this.nativePlugin || !_hasNativeMethod(this.nativePlugin, 'connectToDevice')) return;
    this._routeAt = this._routeAt || new Map();
    if (now - (this._routeAt.get(nx) || 0) < 20000) return;
    this._routeAt.set(nx, now);
    if (this._routeAt.size > 200) this._routeAt.delete(this._routeAt.keys().next().value);
    var dev = this._resolveDeviceIdForNexoId(nx) || ((_getContactByUUID(nx) || {}).deviceId) || null;
    if (!dev || _isPathDev(dev)) return;
    var st = this._getDeviceState(dev).state;
    if (st === BLE_STATES.READY_TO_CHAT || st === BLE_STATES.NOTIFICATIONS_READY || st === BLE_STATES.CONNECTING || st === BLE_STATES.DISCOVERING_SERVICES) return;
    if (typeof this._btPaused === 'function' && (this._btPaused(nx) || this._btPaused(dev))) return;
    if (typeof this._btNearby === 'function' && !this._btNearby(nx)) return;
    console.log('[RUTA] ' + why + ': ' + nx + ' está cerca: conecto por Bluetooth'); // i18n-ok
    _safeNativeCall(this.nativePlugin, 'connectToDevice', { deviceId: dev }).catch(function() {});
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
    // #dueño 01-11 (GRAVE): una llamada TELEFÓNICA le quita el foco de audio a la videollamada NEXO. El nativo avisa
    // (onCallInterruption {paused}); calls RETIENE la llamada en vez de dejar que se corte, y la reanuda al volver el foco.
    this._nativeCallInterruptionListener = this.nativePlugin.addListener('onCallInterruption', function(ev) {
      try { if (self.calls && typeof self.calls._onInterruption === 'function') self.calls._onInterruption(!!(ev && ev.paused)); } catch (e) {}
    });
    // Build 2882 (ConnectionService parte 2): el sistema (coche/auriculares/reloj/pantalla de bloqueo) pidió COLGAR la
    // llamada activa o SALIENTE por Telecom. Colgar la llamada NEXO en curso si es de ese contacto (el camino de
    // "rechazar" del aviso solo vale mientras SUENA; esto cubre colgar una llamada ya en marcha o saliente).
    this._nativeTelecomEndListener = this.nativePlugin.addListener('onTelecomEnd', function(ev) {
      try {
        var st = self.calls && typeof self.calls.state === 'function' ? self.calls.state() : null;
        var nx = (ev && ev.nx ? String(ev.nx) : '').toLowerCase();
        if (st && st.nx && (!nx || String(st.nx).toLowerCase() === nx) && typeof self.calls.hangup === 'function') self.calls.hangup();
      } catch (e) {}
    });
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

// Reestructuración 15-11: métodos de BLEInterface repartidos en ble_startup.js, ble_native_events.js; se unen a la clase como sus métodos normales.
function _mixBLEInterface(o) { Object.getOwnPropertyNames(o).forEach(function(k) { Object.defineProperty(BLEInterface.prototype, k, { value: o[k], writable: true, configurable: true, enumerable: false }); }); }
_mixBLEInterface(bleStartup); _mixBLEInterface(bleNativeEvents);
Object.assign(BLEInterface.prototype, BLE_CONNECTION_METHODS);
Object.assign(BLEInterface.prototype, BLE_MESSAGE_METHODS);
Object.assign(BLEInterface.prototype, BLE_JUMP_METHODS);
Object.assign(BLEInterface.prototype, BLE_CAMERA_METHODS);
Object.assign(BLEInterface.prototype, BLE_KEY_METHODS);
Object.assign(BLEInterface.prototype, BLE_NEARREQ_METHODS);
Object.assign(BLEInterface.prototype, BLE_LINK_METHODS);
Object.assign(BLEInterface.prototype, BLE_CONTACT_METHODS);
Object.assign(BLEInterface.prototype, BLE_OUTBOX_METHODS);
Object.assign(BLEInterface.prototype, BLE_UI_METHODS);
Object.assign(BLEInterface.prototype, BLE_PRIVACY_METHODS);
export function initBLEInterface(bleMesh) {
  var instance = new BLEInterface(bleMesh).init();
  window.bleInterface = instance;
  return instance;
}
