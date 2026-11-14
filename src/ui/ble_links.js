/**
 * NEXO — Enlaces Wi-Fi e internet (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752, sin cambios):
 * el contacto aparece o desaparece por Wi-Fi (lan:) o internet (net:), paquetes que llegan por ahí, buzón de
 * internet y por dónde va cada contacto (linkOf).
 */
import { t } from './i18n.js';
import { BLE_STATES, _getBLEContacts, _lanId, _netId, _netNx, _normId, _normMac, _safeDispatchEvent, _saveBLEContacts, _vNx } from './ble_helpers.js';
import { myProfile, maskPhone, maskEmail } from './profile_data.js'; // #dueño 04-11 (perfil 2b): datos enmascarados en la solicitud

// #dueño 04-11 (regla de caminos): cuando el Bluetooth SUELTA un mensaje (enlace muerto/atascado, p. ej. MTU 23), ese
// enlace se considera muerto este rato y NO se elige para enviar → el resolvedor cae a internet/Wi-Fi («internet antes
// que un Bluetooth muerto»). Vuelve a estar disponible al expirar o al recibir algo por él (prueba de vida).
var BLE_DEAD_TTL_MS = 20000;

export const BLE_LINK_METHODS = {
  _lanUp(nexoId) {
    var nx = _normId(nexoId), id = _lanId(nx), nd = _normMac(id);
    this._deviceStates.set(nd, { state: BLE_STATES.READY_TO_CHAT, since: Date.now(), lan: true });
    this._macToNexoId.set(nd, nx);
    this._lostPeers.delete(nx);
    if (this.relay) this.relay.onLinkChange();
    this._processPendingMessages(id);
    this._resendPendingMessages(nx);
    _safeDispatchEvent('nexo:ble:linkChange', { nexoId: nx, via: 'wifi' });
  },

  // 3022: corte de Wi-Fi en su margen con otro camino listo: los TEXTOS en vuelo pasan a ese camino; los archivos se quedan
  // esperando el margen (regla del dueño 23-10: «una foto a medias no cambia de camino por un pico»). lan.canReach ya no da el
  // Wi-Fi para lo nuevo mientras esté caído.
  _lanSoftDown(nexoId) {
    var nx = _normId(nexoId), next = this._resolveDeviceIdForNexoId(nx);
    if (!next || /^lan/i.test(String(next))) return;
    console.log('[WIFI] Corte con ' + nx + ': los textos en vuelo siguen por ' + (_netNx(next) ? 'internet' : 'Bluetooth') + ' mientras se espera al Wi-Fi');
    if (this.ackSystem && typeof this.ackSystem.relink === 'function') this.ackSystem.relink(_lanId(nx), next, { textsOnly: true });
  },

  _lanDown(nexoId) {
    var self = this, nx = _normId(nexoId), nd = _normMac(_lanId(nx));
    self._deviceStates.delete(nd);
    var next = self._resolveDeviceIdForNexoId(nx);
    var st = next ? self._getDeviceState(next) : {};
    var direct = !!next && !_vNx(next) && (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY);
    if (!direct && next && _netNx(next) && this.net && this.net.canReach(nx)) direct = true; // sigue por internet
    // Textos esperando confirmación y envíos por trozos siguen por Bluetooth donde iban (ble_ack.relink)
    if (self.ackSystem && typeof self.ackSystem.relink === 'function') self.ackSystem.relink(_lanId(nx), direct ? next : null);
    if (!direct) self._markPeerLost(nx);
    if (self.relay) self.relay.onLinkChange();
    _safeDispatchEvent('nexo:ble:linkChange', { nexoId: nx, via: direct ? 'bluetooth' : 'none' });
  },

  // Ronda 2760: con varios enlaces listos con el mismo contacto (Android usa direcciones distintas), el de MTU más alto
  // (en los teléfonos del dueño convivían uno de 23 y otro de 512: la foto salía por el de 23, ~20 veces más lento)
  _bleReadyFor(nexoId) {
    var self = this, nx = _normId(nexoId), found = null, best = -1, now = Date.now();
    this._deviceStates.forEach(function(st, key) {
      if (/^(lan|net)nx/.test(key) || (st.state !== BLE_STATES.READY_TO_CHAT && st.state !== BLE_STATES.NOTIFICATIONS_READY)) return;
      if (_normId(self._macToNexoId.get(key)) !== nx) return;
      // #dueño 04-11: un enlace BT que acaba de soltar un mensaje (muerto/atascado) NO se elige → el resolvedor cae a
      // internet. Se re-habilita al expirar el cooldown o al recibir algo por él (_clearBleDead).
      if (self._bleDeadUntil && (self._bleDeadUntil.get(key) || 0) > now) return;
      var mtu = (self._mtuByDevice && self._mtuByDevice.get(key)) || 185; // sin medir: entre el mínimo y el bueno
      if (mtu > best) { best = mtu; found = key; }
    });
    return found;
  },

  // #dueño 04-11: el Bluetooth soltó un mensaje (enlace muerto/atascado ~los 6 s del nativo). En vez de seguir martillando
  // el BT, lo marco muerto un rato y MUEVO lo que iba por ahí al mejor camino de AHORA (internet/Wi-Fi) con relink, si lo
  // hay. Cumple «internet antes que un Bluetooth muerto» y baja la espera. Si no hay otro camino, no cambia nada (sigue el
  // flujo normal del BT: reintento/pendiente). El cooldown evita volver a elegir el mismo enlace muerto al toque.
  _markBleDead(mac) {
    var self = this, nd = _normMac(mac);
    if (!nd || !this._bleDeadUntil) return;
    var until = Date.now() + BLE_DEAD_TTL_MS;
    this._bleDeadUntil.set(nd, until);
    var nx = _normId(this._macToNexoId.get(nd));
    if (!nx) return;
    // Android usa VARIAS direcciones BT para el mismo NEXO (anunciar vs conectar); con MTU 23 suelen estar todas igual de
    // mal. Marco muertas TODAS las de este contacto → el resolvedor cae a internet de una, sin ir dirección por dirección.
    this._deviceStates.forEach(function (st, key) {
      if (/^(lan|net)nx/.test(key)) return;
      if (_normId(self._macToNexoId.get(key)) === nx) self._bleDeadUntil.set(key, until);
    });
    var next = this._resolveDeviceIdForNexoId(nx); // ya saltea el BT muerto (cooldown) → internet/Wi-Fi si hay
    if (next && _vNx(next)) {
      console.warn('[BLEInterface] BT de ' + nx + ' soltó un mensaje (muerto): re-ruteo a ' + next + ' (lo salto ' + Math.round(BLE_DEAD_TTL_MS / 1000) + ' s)');
      if (this.ackSystem && typeof this.ackSystem.relink === 'function') this.ackSystem.relink(nd, next);
      if (typeof this._resendPendingMessages === 'function') this._resendPendingMessages(nx);
    }
  },
  _clearBleDead(mac) { var nd = _normMac(mac); if (nd && this._bleDeadUntil) this._bleDeadUntil.delete(nd); },
  // Lentitud en Bluetooth (#dueño 07-11): ¿este enlace está marcado muerto/atascado AHORA (el nativo soltó un mensaje por él)?
  // Lo usa Fénix para NO mandar respaldos por un Bluetooth atascado (congestiona la radio y retrasa los chats del usuario).
  _bleCongested(deviceId) { var nd = _normMac(deviceId); return !!(nd && this._bleDeadUntil && (this._bleDeadUntil.get(nd) || 0) > Date.now()); },

  _lanDegraded(nexoId, on) {
    var nx = _normId(nexoId);
    if (on) {
      // Ronda 2760 (regla del dueño): Wi-Fi muy malo → internet (los dos en Wi-Fi); si no, Bluetooth
      var to = (this.net && this.net.canReach(nx) && this.net.bothWifi(nx)) ? _netId(nx) : this._bleReadyFor(nx);
      if (to && this.ackSystem && typeof this.ackSystem.relink === 'function') this.ackSystem.relink(_lanId(nx), to, { keepTooBig: true }); // 2975: lo grande sigue por el Wi-Fi (degradado ≠ caído)
    }
    _safeDispatchEvent('nexo:ble:linkChange', { nexoId: nx, via: this.linkOf(nx) });
  },

  _onLanPayload(nexoId, content) {
    var self = this;
    var data = { deviceId: _lanId(nexoId), content: content, data: content, source: 'lan', timestamp: Date.now(), reassembled: true };
    self._payloadChain = (self._payloadChain || Promise.resolve())
      .then(function() { return self._prePayload(data); })
      .then(function(d) { if (d) self._handlePayload(d); })
      .catch(function(e) { console.warn('[BLEInterface] Error procesando paquete (Wi-Fi):', e && e.message); });
  },

  _netUp(nexoId) {
    var nx = _normId(nexoId), id = _netId(nx), nd = _normMac(id);
    this._deviceStates.set(nd, { state: BLE_STATES.READY_TO_CHAT, since: Date.now(), net: true });
    this._macToNexoId.set(nd, nx);
    this._lostPeers.delete(nx);
    if (this.relay) this.relay.onLinkChange();
    this._processPendingMessages(id);
    this._resendPendingMessages(nx);
    _safeDispatchEvent('nexo:ble:linkChange', { nexoId: nx, via: this.linkOf(nx) });
  },

  _netDown(nexoId) {
    var self = this, nx = _normId(nexoId), nd = _normMac(_netId(nx));
    self._deviceStates.delete(nd);
    var next = self._resolveDeviceIdForNexoId(nx);
    var st = next ? self._getDeviceState(next) : {};
    var direct = !!next && !_vNx(next) && (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY);
    if (self.ackSystem && typeof self.ackSystem.relink === 'function') self.ackSystem.relink(_netId(nx), direct ? next : null);
    if (!direct) self._markPeerLost(nx);
    if (self.relay) self.relay.onLinkChange();
    _safeDispatchEvent('nexo:ble:linkChange', { nexoId: nx, via: self.linkOf(nx) });
  },

  // Ronda 2780 (pedido del dueño): al VOLVER el internet (los relés se reconectan), reactivar las fotos/archivos y
  // textos propios que quedaron pendientes o fallidos — aunque el otro no esté en línea, van al buzón de los relés.
  // net_link lo llama cuando se abre la primera conexión a un relé. Complementa a _netUp (que ya reactiva cuando el
  // contacto pasa a Wi-Fi) para el caso de que sea MI internet el que faltaba al mandar.
  _netOnline() {
    var self = this;
    try { if (typeof self._blobRetryNow === 'function') self._blobRetryNow(); } catch (e) {} // Fase B (2969): bajadas del buzón de archivos que esperaban internet
    try { if (self.ackSystem && typeof self.ackSystem.resumeOutgoingTransfers === 'function') self.ackSystem.resumeOutgoingTransfers(); } catch (e) {}
    var cs = (self.net && typeof self.net._netContacts === 'function') ? self.net._netContacts() : [];
    cs.forEach(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      if (nx && typeof self._resendPendingMessages === 'function') { try { self._resendPendingMessages(nx); } catch (e) {} }
    });
  },

  _onNetPayload(nexoId, content) {
    var self = this;
    var data = { deviceId: _netId(nexoId), content: content, data: content, source: 'net', timestamp: Date.now(), reassembled: true };
    self._payloadChain = (self._payloadChain || Promise.resolve())
      .then(function() { return self._prePayload(data); })
      .then(function(d) { if (d) self._handlePayload(d); })
      .catch(function(e) { console.warn('[BLEInterface] Error procesando paquete (internet):', e && e.message); });
  },

  _noteNetPeer(nexoId) {
    var nx = _normId(nexoId);
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c) { this._ntKnown = this._ntKnown || new Set(); this._ntKnown.add(nx); return; }
    if (!c.nt) { c.nt = 1; _saveBLEContacts(contacts); if (this.net) this.net.tick(); }
  },

  // 3020: el contacto se acaba de crear y ya había dicho que tiene internet (su kx nt:1 llegó antes de ser contacto): se
  // aplica y se guarda YA. Antes solo se aplicaba en el siguiente ciclo de internet (segundos después); si la app se cerraba
  // antes, se perdía: al volver no se leía el buzón de internet de ese contacto (ni sus textos ni sus archivos pendientes).
  _applyNtNow(nexoId) {
    var nx = _normId(nexoId);
    if (!nx || !this._ntKnown || !this._ntKnown.has(nx)) return;
    this._applyNtKnown();
    if (this.net) this.net.tick();
  },

  _applyNtKnown() {
    if (!this._ntKnown || !this._ntKnown.size) return;
    var self = this, contacts = _getBLEContacts(), changed = false;
    contacts.forEach(function(c) { var nx = _normId(c.nexoId || c.deviceUUID); if (self._ntKnown.has(nx) && !c.nt) { c.nt = 1; changed = true; self._ntKnown.delete(nx); } });
    if (changed) _saveBLEContacts(contacts);
  },

  // ---------- Alta por ID (ronda 2779): solicitudes de contacto por internet (sin estar cerca) ----------
  // El amigo te pasa su NEXO ID (p. ej. por WhatsApp); lo pegas y le mandas una solicitud. Él la acepta o la elimina
  // (anti-spam). La clave que llega así entra "sin verificar" (el banner del chat pide comparar el número de seguridad).
  _reqStore(key) { try { return JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem(key)) || '[]') || []; } catch (e) { return []; } },
  _reqSave(key, arr) { try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify((arr || []).slice(0, 60))); } catch (e) {} },

  // Anti-automatización / anti-IA (07-11): ¿se procesa esta solicitud entrante, o es parte de una INUNDACIÓN? Hasta hoy
  // no había NINGÚN freno: una IA/bot que conozca NEXO IDs (son semi-públicos) podía llenar el buzón de solicitudes y
  // spamear avisos a velocidad de máquina. Dos topes, muy por encima del uso real (unas pocas al día) y muy por debajo
  // de un flood: (1) por ORIGEN, no más de una cada REQ_MIN_MS; (2) GLOBAL, no más de REQ_MAX por ventana REQ_WIN_MS.
  // Una 'acc' que responde a una solicitud MÍA saliente queda EXENTA del tope global (la inicié yo), pero sí se throttlea
  // por origen. Solo DESCARTA el exceso: no toca claves, ni cifrado, ni el envío. Umbrales configurables para la prueba.
  _reqFlood(nx, exemptGlobal) {
    var cfg = (typeof window !== 'undefined' && window.NEXO_REQ_FLOOD) || {};
    var MIN = cfg.min != null ? cfg.min : 30000;        // 30 s entre solicitudes del mismo origen
    var WIN = cfg.win != null ? cfg.win : 3600000;      // ventana de 1 h para el tope global
    var MAX = cfg.max != null ? cfg.max : 20;           // máx. solicitudes nuevas por ventana (legítimo: unas pocas/día)
    var now = Date.now();
    this._reqSeen = this._reqSeen || new Map();
    this._reqWin = (this._reqWin || []).filter(function(t) { return now - t < WIN; });
    if (now - (this._reqSeen.get(nx) || 0) < MIN) return false;     // mismo origen martillando → descartar
    if (!exemptGlobal && this._reqWin.length >= MAX) return false;  // inundación global → descartar
    this._reqSeen.set(nx, now);                                     // solo se registra lo ACEPTADO (el flood ni llega aquí)
    if (!exemptGlobal) this._reqWin.push(now);
    if (this._reqSeen.size > 512) { var cut = now - WIN, m = this._reqSeen; m.forEach(function(t, k) { if (t < cut) m.delete(k); }); }
    return true;
  },

  // Mandar una solicitud de contacto a un NEXO ID. Devuelve una promesa (error legible si falla).
  addByNexoId(id) {
    var self = this, nx = _normId(id);
    if (!/^nx[0-9a-z]{8}$/.test(nx)) return Promise.reject(new Error(t('add_err_badid', 'Ese no parece un NEXO ID (empieza por NX y 8 más)')));
    if (nx === _normId(self.localNexoId)) return Promise.reject(new Error(t('add_err_self', 'Ese es tu propio ID')));
    if (_getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; })) return Promise.reject(new Error(t('add_err_dup', 'Ya tienes a ese contacto')));
    if (!self.net) return Promise.reject(new Error(t('add_err_nonet', 'Esta versión no tiene internet')));
    var _mp = myProfile(); // perfil 2b: mando mis datos ENMASCARADOS (los completos van al aceptar, por E2E)
    return self.net.sendRequest(nx, 'req', self.localDeviceName || '', { ph: maskPhone(_mp.phone), em: maskEmail(_mp.email) }).then(function() {
      var out = self._reqStore('nexo_req_out').filter(function(x) { return x.id !== nx; });
      out.unshift({ id: nx, at: Date.now() });
      self._reqSave('nexo_req_out', out);
      _safeDispatchEvent('nexo:ble:reqSent', { id: nx });
      return true;
    });
  },

  // Llega algo a mi buzón de solicitudes (lo descifró net_link). req = me quieren agregar; acc = aceptaron mi solicitud.
  _onNetRequest(info) {
    var self = this, nx = _normId(info && info.id), pk = info && info.pk, name = (info && info.name) || '';
    if (!/^nx[0-9a-z]{8}$/.test(nx) || typeof pk !== 'string') return;
    if (_getBLEContacts().some(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; })) return; // ya es contacto
    var out = self._reqStore('nexo_req_out');
    var isMyAcc = info.kind === 'acc' && out.some(function(x) { return x.id === nx; });
    // Anti-IA: frenar una inundación de solicitudes antes de tocar nada (buzón, avisos). El exceso se descarta en silencio.
    if (!self._reqFlood(nx, isMyAcc)) return;
    // SEC-2 (07-11): una 'acc' que acepta MI solicitud saliente ya NO agrega la clave EN SILENCIO. Un impostor que conozca
    // tu NEXO ID y el del destino (ambos semi-públicos) podía forjar una 'acc' con SU clave mientras tuvieras una solicitud
    // saliente pendiente, y se colaba como «ese contacto» sin que te enteraras (hombre en el medio). Ahora TODA 'acc'/'req'
    // va a la BANDEJA para confirmarla a conciencia; al confirmar se agrega «sin verificar» y conviene comparar el número de
    // seguridad. La 'acc' a una solicitud mía se marca (acc:true) para mostrarla como «aceptó tu solicitud».
    if (isMyAcc) self._reqSave('nexo_req_out', out.filter(function(x) { return x.id !== nx; })); // ya respondió: fuera de salientes
    var inbox = self._reqStore('nexo_req_in').filter(function(x) { return x.id !== nx; });
    inbox.unshift({ id: nx, pk: pk, name: name, ph: (info && info.ph) || '', em: (info && info.em) || '', at: Date.now(), acc: isMyAcc });
    self._reqSave('nexo_req_in', inbox);
    _safeDispatchEvent('nexo:ble:reqIncoming', { id: nx, name: name, count: inbox.length, acc: isMyAcc });
  },

  pendingRequests() { return this._reqStore('nexo_req_in'); },

  // Aceptar una solicitud entrante: agrego su clave (sin verificar), le aviso (acc) y el canal se enciende
  acceptRequest(id) {
    var self = this, nx = _normId(id);
    var inbox = self._reqStore('nexo_req_in'), req = inbox.find(function(x) { return x.id === nx; });
    if (!req || !req.pk) return Promise.reject(new Error(t('add_err_gone', 'Esa solicitud ya no está')));
    self.addSharedContacts([{ nexoId: nx, name: req.name || '', publicKey: req.pk, nt: 1 }], null, { quiet: true });
    self._reqSave('nexo_req_in', inbox.filter(function(x) { return x.id !== nx; }));
    if (self.net) self.net.greet();
    _safeDispatchEvent('nexo:ble:reqIncoming', { count: self._reqStore('nexo_req_in').length });
    // SEC-2: si esto CONFIRMA la aceptación de MI solicitud (req.acc), el otro ya me agregó al aceptar: no hace falta
    // devolverle otra 'acc' (evita un ida y vuelta infinito). El canal seguro se enciende con el saludo/greet de arriba.
    if (req.acc) { _safeDispatchEvent('nexo:ble:reqAccepted', { id: nx, name: req.name || '' }); return Promise.resolve(); }
    var _mp = myProfile(); // perfil 2b: al aceptar también mando mis datos enmascarados en la respuesta
    return (self.net ? self.net.sendRequest(nx, 'acc', self.localDeviceName || '', { ph: maskPhone(_mp.phone), em: maskEmail(_mp.email) }) : Promise.resolve()).catch(function() {});
  },

  // Eliminar una solicitud entrante (no se agrega nada)
  rejectRequest(id) {
    var self = this, nx = _normId(id);
    self._reqSave('nexo_req_in', self._reqStore('nexo_req_in').filter(function(x) { return x.id !== nx; }));
    _safeDispatchEvent('nexo:ble:reqIncoming', { count: self._reqStore('nexo_req_in').length });
  },

  _sendViaNetMailbox(nexoId, content, msgId, seq) {
    var nx = _normId(nexoId);
    if (!this.net || !this.net.mailboxOk(nx) || !this.ackSystem) return Promise.reject(Object.assign(new Error('Sin internet'), { code: 'PEER_ABSENT' }));
    console.log('[NET] ' + msgId + ' al buzón de internet de ' + nx);
    return this.ackSystem.sendWithRetry(_netId(nx), content, msgId, seq);
  },

  linkOf(nexoId) {
    var nx = _normId(nexoId);
    if (this.lan && this.lan.canReach(nx)) return 'wifi';
    var dev = this._resolveDeviceIdForNexoId(nx);
    if (_netNx(dev)) {
      // 2976 (primer diagnóstico AUTOMÁTICO del dueño, 09-11 16:01, «pendiente viejo… enlace internet»): un contacto cuyo
      // identificador guardado es «net:…» (agregado por ID / solo internet) daba «internet» aunque estuviera APAGADO. Con eso
      // _wakeSleepingPeer no lo tocaba al abrir el chat («ya hay enlace vivo») y el bucle de toques por pendientes lo daba por
      // «ya alcanzable» y lo BORRABA: un texto llevaba 25 h ⏳ sin un solo toque FCM. «internet» = EN LÍNEA por internet
      // (canReach, lo que ya usa _linkUp); si no lo está, sigue (puente Jump o nada).
      if (this.net && typeof this.net.canReach === 'function' && this.net.canReach(nx)) return 'internet';
    } else {
      var st = dev ? this._getDeviceState(dev).state : null;
      if (st === BLE_STATES.READY_TO_CHAT || st === BLE_STATES.NOTIFICATIONS_READY) return 'bluetooth';
    }
    if (this.relay && this.relay.relayHop(nx)) return 'jump';
    return 'none';
  },

  // P2 (dueño 01-11): al ABRIR el chat con un contacto DORMIDO (sin enlace directo vivo), pedir el «toque» FCM por
  // internet para que despierte ANTES de que el usuario escriba — así el 1er mensaje no espera ni se pierde, el enlace se
  // forma antes y aparece el tipo de conexión. Si ya hay enlace (Wi-Fi/Bluetooth/internet), no hace nada. El propio _wake
  // tiene throttle por par, así que abrir el chat varias veces no spamea. Devuelve 'waking' si lanzó el toque, o el via.
  // 3073 (dueño 14-11: «con un texto no hay problema, pero con un audio o un archivo se tarda en despertar el otro… manda un
  // despertador cuando uno entra al chat»): con `why` (al abrir el chat, al abrir «adjuntar» o al empezar a grabar un audio) se
  // despierta AUNQUE haya enlace Bluetooth o el otro parezca en línea por internet: eso lo sostiene su parte nativa con la app
  // dormida (los textos pasan, pero un audio o un archivo necesitan su app despierta para bajarlo y confirmar los trozos). Solo
  // el Wi-Fi comprobado garantiza su app despierta. El toque tiene su freno por contacto (8 s) en net_link.
  _wakeSleepingPeer(nexoId, why) {
    var nx = _normId(nexoId);
    var via = this.linkOf(nx);
    if (via === 'wifi') return via; // Wi-Fi comprobado: su app contestó, está despierta
    if (!why && (via === 'bluetooth' || via === 'internet')) return via; // ya hay enlace vivo: nada que despertar
    var woke = !!(this.net && typeof this.net.wakeFor === 'function' && this.net.wakeFor(nx, why));
    if (woke) this._wakingPeer = { nx: nx, t: Date.now() };
    return woke ? 'waking' : via;
  },

  // P2: ¿estamos esperando que ESTE contacto despierte (toque lanzado hace poco y aún sin enlace)? La interfaz lo usa para
  // mostrar «Conectando…» en el subtítulo mientras llega la presencia del otro; al formarse el enlace, el via real manda.
  isWaking(nexoId) {
    var w = this._wakingPeer;
    return !!(w && w.nx === _normId(nexoId) && (Date.now() - w.t) < 30000);
  }
};
