/**
 * NEXO — Mensajes por Bluetooth, Wi-Fi e internet (métodos de BLEInterface sacados de ble_interface.js en la ronda
 * 2752, sin cambios): lo que llega (descifrar, comprobar remitente, guardar, avisar) y lo que sale (texto, archivos,
 * pendientes, reenvío al reconectar).
 */
import { BLE_STATES, _failStatus, _getBLEContacts, _hasNativeMethod, _hydrateAttachments, _isResendable, _attMissDecision, _attMissCooling, _normId, _safeDispatchEvent, _safeNativeCall, _saveSeqCounter, _vaultLoadMessages, _vaultUpdateMessageStatus, _tooBigForBt, _netNx } from './ble_helpers.js';
import { MAILBOX_MAX_BYTES as BLOB_MAILBOX_MAX_BYTES } from '../net/blob_mailbox.js';
import { BLE_RECEIVE_METHODS } from './ble_receive.js';
import { BLE_SEND_METHODS } from './ble_send.js';
import { BLE_BLOB_METHODS } from './ble_blobs.js';
import { BLE_CALLROUTE_METHODS } from './ble_callroute.js';



const _BLE_MESSAGE_METHODS_BASE = {
  _flushAllPendingMessages() {
    var self = this;
    console.log('[BLEInterface] Flush global pending...');
    var contacts = _getBLEContacts();
    if (!contacts || contacts.length === 0) { console.log('[BLEInterface] No contactos'); return; }
    contacts.forEach(function(contact) {
      var nx = _normId(contact.nexoId || contact.deviceUUID);
      if (!nx) return;
      var getPending = (window.vaultGetPendingMessages && typeof window.vaultGetPendingMessages === 'function')
        ? window.vaultGetPendingMessages(nx)
        : _vaultLoadMessages(nx).then(function(msgs) { return msgs.filter(function(m) { return _isResendable(m, nx); }); });
      getPending.then(function(pending) {
        if (!pending || pending.length === 0) return;
        console.log('[BLEInterface]', nx, 'tiene', pending.length, 'pending');
        self._noteWakePending(nx); // Build 2967 (Fase A): tocar (wake FCM) al contacto con pendientes; el tick lo quita si ya es alcanzable
        var deviceId = contact.deviceId || self._resolveDeviceIdForNexoId(nx);
        if (deviceId) {
          var state = self._getDeviceState(deviceId);
          var isReady = state.state === BLE_STATES.READY_TO_CHAT || state.state === BLE_STATES.NOTIFICATIONS_READY;
          if (isReady) { self._resendPendingMessages(nx); }
          else {
            self._markPeerLost(nx);
            if (state.state !== BLE_STATES.CONNECTING && state.state !== BLE_STATES.DISCOVERING_SERVICES) {
              self._autoConnectGATT(deviceId, { name: contact.name, deviceUUID: nx }, { why: 'pendientes' });
            }
          }
        } else { self._markPeerLost(nx); self._autoScanForKnownContacts(); }
      }).catch(function(e) { console.warn('[BLEInterface] Error flush', nx, e.message); });
    });
  },

  // 3008 (dueño 11-11: «me llegan notificaciones y luego entro y no hay mensajes nuevos»): avisar al nativo de los mensajes YA
  // recibidos con la app abierta, para que si el otro teléfono reenvía alguno (un envío que en su lado seguía pendiente) con esta app
  // cerrada, no salga «Mensaje nuevo» (SeenMsgs.kt). Por tandas, cada 3 s como mucho.
  _noteSeen(id) {
    var self = this;
    if (!id || !_hasNativeMethod(self.nativePlugin, 'markMsgsSeen')) return;
    (self._seenQ = self._seenQ || []).push(String(id));
    if (self._seenT) return;
    self._seenT = setTimeout(function() {
      self._seenT = null;
      var ids = self._seenQ.splice(0, self._seenQ.length);
      if (ids.length) _safeNativeCall(self.nativePlugin, 'markMsgsSeen', { ids: ids }).catch(function() {});
    }, 3000);
  },

  _isMsgInFlight(msgId) {
    if (!msgId) return false;
    var found = false;
    this._pendingMessageQueue.forEach(function(q) { q.forEach(function(it) { if (it.messageId === msgId) found = true; }); });
    if (found) return true;
    var ack = this.ackSystem;
    if (ack && ack.pendingAcks && ack.pendingAcks.has(msgId)) return true;
    if (ack && ack.outgoingStreams && ack.outgoingStreams.has(msgId)) return true;
    if (ack && ack.preparing && ack.preparing.has(msgId)) return true;
    if (ack && ack._chatPrep && ack._chatPrep.has(msgId)) return true;
    if (this.wifiDirect && this.wifiDirect.out.has(msgId)) return true;
    // 3050 (medición de caminos): subiéndose al buzón de archivos (por un puente son decenas de segundos). Antes el reenvío de
    // pendientes lo volvía a mandar a la vez, trozo a trozo por el puente, y chocaba con su tope de eventos
    if (ack && ack._blobOutRunning && ack._blobOutRunning.has(msgId)) return true;
    // 3197 (hallazgo del ayudante de la 3193, 17-11): ya está saliendo pero aún no llegó al sistema de envío (ver _holdOut)
    if (this._outHold && this._outHold.has(String(msgId))) return true;
    return false;
  },

  // 3197 (hallazgo del ayudante de la 3193, 17-11): un archivo elegido esperaba medio segundo («margen para estabilizar radio»; más con
  // la cámara abierta o un enlace que se está conectando) antes de entrar al sistema de envío y en ese rato no contaba como en vuelo.
  // Si llegaba algo del contacto (su anuncio de rutas 'rt' → _kickPeer → reenvío de pendientes), el reenvío lo mandaba por trozos por
  // los relés y el envío original lo subía además al buzón de archivos: salía DOS veces (con datos móviles, el doble de gasto). Lo
  // mismo un texto que espera a que se cierre la cámara. Desde que empieza a salir hasta que lo toma el sistema de envío (cuyas marcas
  // siguen: flujo, cifrando, subiendo al buzón, cola) o falla, cuenta como en vuelo; si falla, el reenvío lo retoma. Devuelve el «soltar».
  _holdOut(msgId) {
    var self = this, k = String(msgId || '');
    if (!k) return function() {};
    self._outHold = self._outHold || new Map();
    self._outHold.set(k, (self._outHold.get(k) || 0) + 1);
    var held = true;
    return function() {
      if (!held) return;
      held = false;
      var n = (self._outHold.get(k) || 1) - 1;
      if (n > 0) self._outHold.set(k, n); else self._outHold.delete(k);
    };
  },

  getNextSeq() {
    this._localSeqCounter = (this._localSeqCounter + 1) >>> 0;
    _saveSeqCounter(this._localSeqCounter);
    return this._localSeqCounter;
  },

  _resendPendingMessages(nexoId) {
    var self = this;
    if (!nexoId) return;
    // 3178 (ciudad 17-11): los acuses (entregado/leído) que no salieron van ya por el camino que haya con este contacto
    try { if (self.ackSystem && typeof self.ackSystem.flushReceipts === 'function') self.ackSystem.flushReceipts(nexoId, 'camino con el contacto'); } catch (e) {}
    // Ronda 2767 (revisión): una sola vuelta a la vez por contacto. Al reconectar se pedía 4–6 veces seguidas (enlace
    // listo, clave, chat abierto…) y cada vuelta mandaba su lista sin mirar las demás: un texto largo salía varias veces
    // a la vez. Si ya hay una en marcha (con avances en los últimos 30 s), se repite al acabar
    var nxKey = _normId(nexoId);
    self._resendRun = self._resendRun || new Map();
    // 3016 (diagnóstico S23 del dueño 12-11): un camino que acepta el envío pero nunca confirma (el otro con la app dormida,
    // un enlace a medias) hacía una vuelta tras otra sin pausa: «ACK timeout 1..5/5» → «Pending fallo» → 0,3 s → «Reenviando»
    // (>16 min, una vuelta cada ~22 s). Tras una vuelta en la que TODO falló por falta de confirmación se espera 15 s, luego
    // 30, 60 y como mucho 2 min; cualquier confirmación de ese contacto (o un envío que sale bien) quita la espera.
    self._resendBackoff = self._resendBackoff || new Map();
    var bo = self._resendBackoff.get(nxKey);
    if (bo && Date.now() < bo.until) {
      if (!bo.timer) {
        console.log('[BLEInterface] ' + nxKey + ': no confirma lo reenviado; próxima vuelta en ' + Math.round((bo.until - Date.now()) / 1000) + ' s');
        bo.timer = setTimeout(function() { bo.timer = null; self._resendPendingMessages(nexoId); }, bo.until - Date.now() + 50);
      }
      return;
    }
    var cur = self._resendRun.get(nxKey);
    if (cur && Date.now() - cur.at < 30000) { cur.again = true; return; }
    if (self._callRadioHold(nxKey)) return; // 3058: en llamada, lo pendiente por Bluetooth espera a colgar
    // 3058 (la tablet del diagnóstico 07:28: conectada, con la app dormida y lejos): si la vuelta anterior no confirmó NADA, esta
    // empieza por UNA prueba (lo más corto, sin reanudar lo grande): si se confirma sigue todo al momento; si no, no se manda el
    // resto (antes: los 6 pendientes, uno de 55 trozos, ~1,5 min de radio por vuelta, y otra vez a los 15–120 s)
    var probe = !!(bo && bo.n >= 1);
    var run = { at: Date.now(), again: false, ok: 0, noAck: 0, other: 0 };
    self._resendRun.set(nxKey, run);
    var finish = function() {
      if (self._resendRun.get(nxKey) !== run) return;
      self._resendRun.delete(nxKey);
      if (run.ok > 0 || run.noAck === 0 || run.other > 0) self._resendBackoff.delete(nxKey);
      else {
        var b = self._resendBackoff.get(nxKey) || { n: 0, until: 0, timer: null };
        b.n++; b.until = Date.now() + Math.min(120000, 15000 * Math.pow(2, b.n - 1));
        self._resendBackoff.set(nxKey, b);
        // 3020: síntoma para el diagnóstico automático (una vez por racha: al llegar a la 3.ª vuelta sin confirmar)
        if (b.n === 3) _safeDispatchEvent('nexo:diag:symptom', { kind: 'reenvio_sin_fin', info: nxKey + ' ' + run.noAck + ' sin confirmar, 3 vueltas' });
      }
      if (run.again) setTimeout(function() { self._resendPendingMessages(nexoId); }, 300);
    };
    var idOf = function(m) { return m.msgId || m.messageId || m.id; };
    // Fase B (2969): ¿adjunto que puede ir al buzón de archivos? (foto/vídeo/archivo con sus datos; no el «archivo grande» de Wi-Fi)
    // Vale ANTES de cargar el adjunto del disco (2970, diagnóstico del dueño: un APK de 25 MB pendiente se leía del disco en cada
    // vuelta —«leyendo lento» ×decenas— para después descartarse por tamaño): foto/vídeo/archivo, con datos (en línea o en
    // disco: attachmentRef), no «archivo grande» de Wi-Fi, y tamaño declarado dentro del tope del buzón (si no se conoce, se mira al cargar).
    var blobCandidate = function(m) {
      var t = m.attachmentType, p = m.attachmentPayload, mm = m.attachmentMeta, ref = m.attachmentRef;
      if ((!t || !p) && !ref && m.content && typeof m.content === 'string' && m.content.charAt(0) === '{') {
        try { var pr = JSON.parse(m.content); if (pr && pr.type === 'attachment') { t = pr.attachmentType; p = pr.payload; mm = pr.meta; } } catch (e) {}
      }
      // 3224: también la nota de voz (desde la 3015 se manda como archivo y al enviarla ya va al buzón de archivos; en el reenvío no)
      if (!(t && (p || ref) && !(mm && mm.big) && (t === 'image' || t === 'video' || t === 'file' || t === 'audio'))) return false;
      var size = (p && typeof p === 'string') ? p.length : (mm && Number(mm.size)) || 0;
      return !size || size <= BLOB_MAILBOX_MAX_BYTES * 4 / 3 + 8;
    };
    // Parte 3 del puente: tamaño del adjunto (para mailboxFilesOk: por un puente solo lo pequeño; 0 = no se sabe → no)
    var blobLen = function(m) {
      var p = m.attachmentPayload, mm = m.attachmentMeta;
      if (!p && m.content && typeof m.content === 'string' && m.content.charAt(0) === '{') { try { var pr = JSON.parse(m.content); if (pr && pr.type === 'attachment') { p = pr.payload; mm = pr.meta; } } catch (e) {} }
      return (p && typeof p === 'string') ? p.length : (mm && Number(mm.size)) || 0;
    };
    var getPending = (window.vaultGetPendingMessages && typeof window.vaultGetPendingMessages === 'function')
      ? window.vaultGetPendingMessages(nexoId)
      : _vaultLoadMessages(nexoId).then(function(msgs) {
          return msgs.filter(function(m) { return _isResendable(m, nexoId); });
        });
    // No reenviar lo que sigue en vuelo en esta sesión (cola JS, ACK pendiente o stream activo); se mira antes de cargar
    // los adjuntos de disco (antes se cargaban todos en cada vuelta)
    // El camino se decide ANTES de cargar los adjuntos del disco (2970): si no hay enlace ni ruta, solo se cargan los que
    // pueden ir al buzón de archivos; lo demás queda en espera sin leer megas del disco en cada vuelta.
    var deviceId = self._resolveDeviceIdForNexoId(nexoId);
    var st = deviceId ? self._getDeviceState(deviceId) : {};
    var direct = st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY;
    var rh = direct ? null : (self.relay && self.relay.relayHop(nexoId));
    var blobOnly = false, bridgedNet = false;
    // #dueño 09-11 (diagnóstico S24 12:15, APK de 35 MB a la tablet conectada por Bluetooth): con enlace Bluetooth DIRECTO y
    // sin Wi-Fi/internet con el contacto, un archivo que NO cabe por Bluetooth (> tope BLE en base64) NO se carga del disco.
    // Antes cada «Reenviando pending» (evento de enlace, vuelta al frente, flush) leía los 35 MB («leyendo lento (adjunto)»),
    // los sellaba y ChatStream los aplazaba igual: el teléfono arrastrándose. Queda ⏳ y lo re-rutea el evento de enlace
    // (Wi-Fi/internet), como hasta ahora. Tamaño declarado (meta.size) o el adjunto ya en memoria; si no se conoce, se carga.
    var btDirect = !!(direct && deviceId && !/^(lan|net)/i.test(String(deviceId)));
    // 2974 (diagnóstico del dueño 13:21): también por un PUENTE Jump por Bluetooth («Reenviando 1 pending para la tablet por el vivo»
    // leía los 35 MB igual): un archivo que no cabe por Bluetooth tampoco cabe por un puente Bluetooth.
    var btHop = !!(rh && rh.deviceId && !/^(lan|net)/i.test(String(rh.deviceId)));
    var betterPath = !!((self.net && typeof self.net.canReach === 'function' && self.net.canReach(nexoId)) || (self.lan && typeof self.lan.canReach === 'function' && self.lan.canReach(nexoId)));
    var tooBigForBt = _tooBigForBt;
    // 3004: freno de bucle de arranque — los ids que ya murieron BIGSEND_MAX_TRIES veces enviándose no se reintentan solos
    var blockedP = (typeof window.vaultBigSendBlockedIds === 'function') ? window.vaultBigSendBlockedIds().catch(function() { return new Set(); }) : Promise.resolve(new Set());
    getPending = Promise.all([getPending, blockedP]).then(function(pr) {
      var list = pr[0], blocked = pr[1];
      list = (list || []).filter(function(m) { return !self._isMsgInFlight(idOf(m)); });
      // 3173 (dueño 17-11, diagnóstico S24 19:53–19:57: «Reenviando 1 pending para nx09acdb61» cada ~18 s durante 4 min sin mandar
      // nada): lo que YA se confirmó (✓✓) en esta sesión pero el almacén aún tiene pendiente se saltaba más abajo (isDone) sin
      // arreglarlo, vuelta tras vuelta, y tras reiniciar la app se mandaba otra vez. Ahora se le pone «entregado» y no cuenta.
      var ackD = self.ackSystem;
      var yaHecho = (ackD && typeof ackD.isDone === 'function') ? list.filter(function(m) { return ackD.isDone(idOf(m)); }) : [];
      if (yaHecho.length) {
        console.log('[BLEInterface] ' + nxKey + ': ' + yaHecho.length + ' pendiente(s) ya entregado(s) en esta sesión: se corrige su estado (no se reenvían)');
        yaHecho.forEach(function(m) {
          var id = idOf(m);
          _vaultUpdateMessageStatus(nexoId, id, 'delivered');
          try { if (window.NEXO_updateMessageStatus) window.NEXO_updateMessageStatus(id, 'delivered'); } catch (e) {}
        });
        list = list.filter(function(m) { return yaHecho.indexOf(m) < 0; });
      }
      // 3033 (dueño 12-11: «me aparecieron nueve mensajes nuevos y no vi ninguno»): una acción OCULTA (estado, foto de perfil,
      // me gusta, reacción, borrar…) va «callada» (sin aviso ni toque en el otro teléfono) solo si su id está en _quietOut,
      // que vive en memoria. Al reenviarla desde la cola tras reiniciar la app ya no estaba → salía como MENSAJE NUEVO y el
      // otro teléfono avisaba «N mensajes nuevos» que al abrir no existían. Lo guardado como oculto se reenvía callado.
      self._markHiddenQuiet(list);
      if (blocked && blocked.size) {
        list = list.filter(function(m) {
          var id = idOf(m);
          if (!blocked.has(id)) return true;
          self._bigBlockedNoted = self._bigBlockedNoted || new Set();
          if (!self._bigBlockedNoted.has(id)) {
            self._bigBlockedNoted.add(id);
            console.warn('[BLEInterface] ' + id + ': archivo grande que no terminó de enviarse en sus últimos intentos (posible cierre de la app): no se reintenta solo; queda para «reintentar»');
            _vaultUpdateMessageStatus(nexoId, id, 'failed');
            try { if (window.NEXO_updateMessageStatus) window.NEXO_updateMessageStatus(id, 'failed'); } catch (e) {}
          }
          return false;
        });
      }
      // 3003: un adjunto que acaba de fallar al leerse del disco se enfría (no se relee 25 MB en cada vuelta); sigue ⏳ pendiente
      var nowCool = Date.now();
      list = list.filter(function(m) { return !(m && (m.attachmentRef || m.attachmentType) && _attMissCooling(self._attMiss, idOf(m), nowCool)); });
      // 3050: con un puente de por medio (yo sin internet propio, o él por un puente) y solo internet con él, los archivos van al
      // buzón de archivos (en paquetes por Wi-Fi Direct al puente), no trozo a trozo como mensajes por el puente
      bridgedNet = !!(direct && deviceId && /^net/i.test(String(deviceId)) && self.net && typeof self.net.viaBridge === 'function' && self.net.viaBridge(nexoId));
      if (!direct && !rh) {
        // Fase B (build 2969): sin enlace ni ruta pero CON internet propio y el contacto AUSENTE → los ARCHIVOS pendientes
        // (foto/vídeo/archivo ≤ 5 MB) van al BUZÓN DE ARCHIVOS (cifrados en los relés + puntero en su buzón); el resto sigue
        // en espera (toque FCM, Fase A). Antes TODO quedaba ⏳ hasta coincidir en línea.
        var blobFits = function(m) { return blobCandidate(m) && self.net.mailboxFilesOk(nexoId, blobLen(m)); }; // parte 3: por un puente, solo lo pequeño
        blobOnly = !!(self.net && typeof self.net.mailboxFilesOk === 'function' && self.net.mailboxOk(nexoId) && !self.net.canReach(nexoId) && list.some(blobFits));
        if (blobOnly) list = list.filter(blobFits);
        else if (list.length) { console.log('[BLEInterface] ' + list.length + ' pending para ' + nexoId + ': sin enlace ni ruta, quedan en espera'); self._noteWakePending(nexoId); try { self._outboxNote(nexoId); } catch (eO) {} if (self.relay) self.relay.discover(nexoId); list.forEach(function(m) { try { self._fileCitaFromMsg(nexoId, m); } catch (e) {} }); return []; }
      }
      // Parte 3 del puente (13-11): sin internet propio (solo por un puente) y sin Bluetooth/Wi-Fi con el contacto, un archivo que NO
      // pasa por el puente (más de GW_FILE_MAX_B64: vídeo, archivo grande) no se lee del disco en cada vuelta ni se intenta: queda ⏳
      // hasta tener internet propio (antes: 1 MB leído del disco cada ~20 s y la burbuja de vuelta a «enviando»). Tamaño desconocido: se intenta.
      var gwNow = !!(self.net && typeof self.net.gwOnly === 'function' && self.net.gwOnly());
      if (!gwNow && self._gwWaitSaid) self._gwWaitSaid = null; // con internet propio otra vez: la próxima vez que falte se vuelve a avisar
      if (gwNow && !btDirect && !btHop && !(self.lan && typeof self.lan.canReach === 'function' && self.lan.canReach(nexoId))) {
        var noGw = list.filter(function(m) { if (!(m && (m.attachmentRef || m.attachmentType))) return false; var n = blobLen(m); return n > 0 && !self.net.mailboxFilesOk(nexoId, n); });
        if (noGw.length) {
          self._gwWaitSaid = self._gwWaitSaid || new Set();
          var nuevos = noGw.filter(function(m) { return !self._gwWaitSaid.has(idOf(m)); });
          if (nuevos.length) console.log('[BLEInterface] ' + noGw.length + ' archivo(s) para ' + nexoId + ' no pasan por el puente (sin internet propio): esperan internet (sin leer del disco)');
          nuevos.forEach(function(m) {
            var id = idOf(m); self._gwWaitSaid.add(id);
            _vaultUpdateMessageStatus(nexoId, id, 'pending');
            try { if (window.NEXO_updateMessageStatus) window.NEXO_updateMessageStatus(id, 'pending'); } catch (e) {}
          });
          list = list.filter(function(m) { return noGw.indexOf(m) < 0; });
        }
      }
      // 3053: por CUALQUIER puente Jump (también si el primer tramo es Wi-Fi: el vivo leía 75 MB del disco en cada vuelta para
      // mandarlos por el S24 y fallar después)
      if ((btDirect || btHop || !!rh) && !betterPath) {
        var grandes = list.filter(tooBigForBt);
        if (grandes.length) { console.log('[BLEInterface] ' + grandes.length + ' archivo(s) grande(s) para ' + nexoId + ' no caben por Bluetooth: esperan Wi-Fi/internet (sin leer del disco)'); list = list.filter(function(m) { return !tooBigForBt(m); }); }
      }
      // 2976: qué adjuntos se leen del disco en esta vuelta (el primer diagnóstico automático mostró 4 lecturas de ~450 ms justo
      // después de «no caben por Bluetooth» sin saber de qué archivo eran): tipo y tamaño declarado; sin nombres ni contenido.
      // 3007 (dueño 11-11, «(a)»): un archivo grande cuyo envío por internet quedó GUARDADO a medias (cifrado, en el teléfono) y que
      // ahora sale por internet NO se vuelve a leer del disco ni a cifrar: sigue con lo guardado (ble_ack.js sendFile → vaultBigxOutGet).
      // Por Wi-Fi local (más rápido) se manda como siempre. Antes cada reanudación leía los 35 MB del adjunto por el puente.
      var netOnlyX = !!(self.net && typeof self.net.canReach === 'function' && self.net.canReach(nexoId)) && !(self.lan && typeof self.lan.canReach === 'function' && self.lan.canReach(nexoId));
      if (netOnlyX && typeof window.vaultBigxOutHas === 'function') {
        var nX = 0;
        list = list.map(function(m) { if (m && window.vaultBigxOutHas(idOf(m))) { nX++; return Object.assign({}, m, { _bigx: true, attachmentRef: null, attachmentPayload: null }); } return m; });
        if (nX) console.log('[BLEInterface] ' + nexoId + ': ' + nX + ' archivo(s) grande(s) siguen donde iban (guardados en el teléfono, sin leer el adjunto)');
      }
      var conAdj = list.filter(function(m) { return m && !m._bigx && (m.attachmentRef || m.attachmentType); });
      if (conAdj.length) console.log('[BLEInterface] ' + nexoId + ': se cargan ' + conAdj.length + ' adjunto(s) del disco para reenviar: ' + conAdj.map(function(m) { var mm = m.attachmentMeta || {}; return (m.attachmentType || '?') + (mm.size ? ' ' + Math.round(Number(mm.size) / 1024) + ' KB' : ' ?KB') + (mm.big ? ' big' : ''); }).join(', '));
      return _hydrateAttachments(list);
    });
    getPending.then(function(pending) {
      pending = pending || [];
      if (pending.length === 0) { finish(); return; }
      var relayDst = null;
      if (!direct) {
        if (!rh) {
          console.log('[BLEInterface] ' + pending.length + ' archivo(s) pendiente(s) para ' + nexoId + ': sin enlace ni ruta, van al buzón de archivos');
          self._noteWakePending(nexoId); // Build 2967 (Fase A): lo que queda en espera entra al wake-por-pendiente (toque FCM con backoff)
          if (self.relay) self.relay.discover(nexoId);
        } else {
          deviceId = rh.deviceId;
          relayDst = _normId(nexoId);
          console.log('[JUMP] Reenviando', pending.length, 'pending para', nexoId, 'por', rh.via);
          pending.forEach(function(m) { self._noteRelayedOut(m.msgId || m.messageId || m.id, relayDst); });
        }
      } else {
        console.log('[BLEInterface] Reenviando', pending.length, 'pending para', nexoId + (probe && pending.length > 1 ? ' (primero una prueba: la vuelta anterior no confirmó nada)' : ''));
        if (!probe && self.ackSystem && typeof self.ackSystem.resumeOutgoingTransfers === 'function') {
          try { self.ackSystem.resumeOutgoingTransfers(deviceId); } catch (e) {}
        }
      }
      // 3058: la prueba es lo más corto (un texto antes que un adjunto)
      if (probe && pending.length > 1) {
        var sizeOf = function(m) { return (m.attachmentType || m.attachmentRef ? 1e9 : 0) + String(m.content || m.text || '').length; };
        pending = pending.slice().sort(function(a, b) { return sizeOf(a) - sizeOf(b); });
      }
      // 3058: tras el primero de una vuelta de prueba: confirmado → sigue todo (y lo grande se reanuda); sin confirmar → se para aquí
      var probeDone = function() {
        if (!probe) return false;
        probe = false;
        if (run.ok > 0) {
          if (direct && self.ackSystem && typeof self.ackSystem.resumeOutgoingTransfers === 'function') { try { self.ackSystem.resumeOutgoingTransfers(deviceId); } catch (e) {} }
          return false;
        }
        if (run.noAck > 0 && idx < pending.length) {
          console.log('[BLEInterface] ' + nxKey + ': no confirma ni la prueba: los otros ' + (pending.length - idx) + ' pendiente(s) esperan a la próxima vuelta (no se martilla el enlace)');
          finish();
          return true;
        }
        return false;
      };
      var idx = 0;
      function sendNext() {
        run.at = Date.now();
        if (idx >= pending.length) { finish(); return; }
        var msg = pending[idx++];
        var mid = idOf(msg);
        // Ronda 2767: se vuelve a mirar justo antes de mandarlo (otra vuelta o un envío nuevo pudo mandarlo ya)
        if (!mid || self._isMsgInFlight(mid) || (self.ackSystem && typeof self.ackSystem.isDone === 'function' && self.ackSystem.isDone(mid))) {
          sendNext();
          return;
        }
        if (blobOnly && !blobCandidate(msg)) { sendNext(); return; } // Fase B: sin enlace solo salen los archivos (al buzón de archivos)
        _vaultUpdateMessageStatus(nexoId, mid, 'sending');
        try {
          if (window.NEXO_updateMessageStatus) {
            window.NEXO_updateMessageStatus(mid, 'sending');
          }
        } catch (e) {}

        var attachmentType = msg.attachmentType || null;
        var attachmentPayload = msg.attachmentPayload || null;
        var attachmentMeta = msg.attachmentMeta || null;

        if ((!attachmentType || !attachmentPayload) && msg.content && typeof msg.content === 'string' && msg.content.charAt(0) === '{') {
          try {
            var parsed = JSON.parse(msg.content);
            if (parsed && parsed.type === 'attachment') {
              attachmentType = parsed.attachmentType || null;
              attachmentPayload = parsed.payload || null;
              attachmentMeta = parsed.meta || null;
            }
          } catch (e) {}
        }

        var msgSeq = (typeof msg.seq === 'number') ? msg.seq : undefined;
        var doSend;
        // Ronda 2756: archivo grande (big_file.js): el mensaje es pequeño (nombre, tamaño, clave) y va como texto; el
        // archivo va aparte por Wi-Fi. Sin clave aún se está preparando: nada que reenviar todavía.
        var bigMeta = attachmentMeta && attachmentMeta.big;
        if (bigMeta && !bigMeta.key) { sendNext(); return; }

        if (
          attachmentType &&
          (attachmentPayload || msg._bigx) &&
          !bigMeta &&
          (attachmentType === 'image' ||
           attachmentType === 'video' ||
           attachmentType === 'file' ||
           attachmentType === 'audio')   // 3015: la nota de voz se reenvía como archivo (como al enviarla)
        ) {
          if (!self.ackSystem || typeof self.ackSystem.sendFile !== 'function') {
            console.warn('[BLEInterface] AckSystem sin sendFile para pending:', mid);
            _vaultUpdateMessageStatus(nexoId, mid, 'failed');
            try {
              if (window.NEXO_updateMessageStatus) {
                window.NEXO_updateMessageStatus(mid, 'failed');
              }
            } catch (e2) {}
            sendNext();
            return;
          }
          // 3021: el puente de esta ruta no confirmó ni un trozo de un archivo hace poco (relay.bridgeStalled): el archivo NO vuelve
          // por él; va al buzón de archivos si se puede y, si no, queda ⏳ (lo de texto sigue por el puente con su custodia)
          var stalledFile = !!(relayDst && rh && self.relay && typeof self.relay.isBridgeStalled === 'function' && self.relay.isBridgeStalled(rh.via));
          if (stalledFile && !(self.net && typeof self.net.mailboxFilesOk === 'function' && blobCandidate(msg) && self.net.mailboxFilesOk(nxKey, blobLen(msg)))) {
            console.log('[JUMP] ' + mid + ': el puente ' + rh.via + ' no avanzó con archivos hace poco y no hay buzón de archivos: queda en espera');
            _vaultUpdateMessageStatus(nexoId, mid, 'pending');
            try { if (window.NEXO_updateMessageStatus) window.NEXO_updateMessageStatus(mid, 'pending'); } catch (e4) {}
            sendNext();
            return;
          }
          // Ronda 2767: directo, a quién va (como al enviarlo: se cifra para él y solo sale por una conexión suya)
          var fileMeta = Object.assign(
            { type: attachmentType },
            attachmentMeta || {},
            (relayDst && !stalledFile) ? { dst: relayDst } : { to: nxKey }
          );
          var gwBlob = bridgedNet && blobCandidate(msg) && self.net.mailboxFilesOk(nxKey, blobLen(msg));
          doSend = (blobOnly || stalledFile || gwBlob)
            ? function() { // Fase B (2969): al buzón de archivos (si justo dejó de aplicar, queda pendiente)
              return self._fileToBlobMailbox(nxKey, mid, attachmentPayload, fileMeta) ||
                Promise.reject(Object.assign(new Error('Contacto no disponible: queda pendiente'), { code: 'PEER_ABSENT' }));
            }
            : function() {
              // 3224 (diagnóstico de la S23 17-11 20:41, nota de voz de 2,7 MB «trabada en el 15 %»): un adjunto pendiente que se
              // reenvía a un contacto EN LÍNEA solo por los relés iba como flujo por trozos (cada ventana espera su confirmación a
              // través de los relés; con su app en segundo plano no avanza): llegó a los 17 min, a 2,2 KB/s. Como al enviarlo
              // (3128), va al buzón de archivos; > 5 MB, por Tor o sin los datos en memoria, sigue el flujo por trozos.
              var viaBlobOn = (!relayDst && _netNx(deviceId)) ? self._fileToBlobMailbox(nxKey, mid, attachmentPayload, fileMeta, true) : null;
              if (viaBlobOn) return viaBlobOn;
              return self.ackSystem.sendFile(
                deviceId,
                mid,
                attachmentPayload || null,   // 3007: null = sigue con lo guardado (msg._bigx)
                fileMeta
              );
            };
          console.log('[BLEInterface] Reenviando ADJUNTO' + ((blobOnly || stalledFile || gwBlob) ? ' al buzón de archivos' : '') + ':', attachmentType, mid);
        } else {
          var txt;
          if (bigMeta) txt = JSON.stringify({ type: 'attachment', attachmentType: 'file', payload: 'big', meta: attachmentMeta });
          // Ronda 2767 (revisión): nota de voz, ubicación… van como texto con el adjunto dentro, como al enviarlos. El
          // historial guarda el adjunto aparte y el texto como "[adjunto]": antes llegaba ese texto, no la nota de voz
          else if (attachmentType && attachmentPayload) txt = JSON.stringify({ type: 'attachment', attachmentType: attachmentType, payload: attachmentPayload, meta: attachmentMeta || {} });
          else if (attachmentType) {
            // 2995: no se marca ✗ a la primera (puede estar a medio escribir tras un reinicio): queda ⏳ y se reintenta; solo tras 3 fallos y 5 min
            // 3063 (diagnósticos S24 3041 13-11: el APK de 25 MB del 10-11 seguía «pendiente viejo» 4117 min y se releía del disco cada
            // vez que su contacto aparecía): la cuenta de intentos vivía solo en memoria y la app se cerraba antes de juntar 3 en 5 min.
            // Ahora se guarda con el mensaje (attMissN/attMissT0): varias sesiones cortas también lo dan por ilegible.
            var memoAM = self._attMiss || (self._attMiss = {});
            if (!memoAM[mid] && Number(msg.attMissN) > 0) memoAM[mid] = { n: Number(msg.attMissN), t0: Number(msg.attMissT0) || Date.now() };
            var miss = _attMissDecision(memoAM, mid, Date.now());
            if (miss === 'wait') {
              try { if (typeof window.vaultPatchMessage === 'function') window.vaultPatchMessage(nexoId, mid, { attMissN: memoAM[mid].n, attMissT0: memoAM[mid].t0 }); } catch (e6) {}
              console.log('[BLEInterface] Adjunto pendiente sin sus datos (aún no se lee del teléfono): queda ⏳ y se reintenta', mid);
              sendNext();
              return;
            }
            console.warn('[BLEInterface] Adjunto pendiente sin sus datos (no se pudo leer del teléfono tras varios intentos): no se reenvía solo (✗, «Reintentar» a mano)', mid);
            _vaultUpdateMessageStatus(nexoId, mid, 'failed');
            // 3038: marca para no volver a leerlo del disco en cada vuelta (25 MB cada 15–60 s durante días); «Reintentar» la quita
            try { if (typeof window.vaultPatchMessage === 'function') window.vaultPatchMessage(nexoId, mid, { attMissing: true }); } catch (e5) {}
            if (self._attMiss) delete self._attMiss[mid];
            try { if (window.NEXO_updateMessageStatus) window.NEXO_updateMessageStatus(mid, 'failed'); } catch (e3) {}
            sendNext();
            return;
          }
          else txt = msg.content || msg.text || '';
          if (
            txt.length > 180 &&
            self.ackSystem &&
            typeof self.ackSystem.sendChunkedMessage === 'function'
          ) {
            doSend = function() {
              return self.ackSystem.sendChunkedMessage(
                deviceId,
                txt,
                relayDst ? { dst: relayDst } : { to: nxKey },
                mid,
                msgSeq
              );
            };
          } else if (self.ackSystem) {
            doSend = function() {
              return self.ackSystem.sendWithRetry(
                deviceId,
                txt,
                mid,
                msgSeq,
                relayDst ? { dst: relayDst } : { to: nxKey }
              );
            };
          } else {
            doSend = function() {
              return self._sendMessageNative(
                deviceId,
                txt,
                mid,
                msgSeq
              );
            };
          }
        }

        // 3004: un intento grande se anota ANTES (llega al disco) y se borra al terminar sin morir (freno de bucle de arranque)
        var bigTry = ((typeof attachmentPayload === 'string' && attachmentPayload.length > 2000000) || !!msg._bigx) && typeof window.vaultBigSendBegin === 'function';
        var endTry = function() { if (bigTry && typeof window.vaultBigSendEnd === 'function') window.vaultBigSendEnd(mid).catch(function() {}); };
        (bigTry ? window.vaultBigSendBegin(mid).catch(function() {}).then(function() { return doSend(); }) : doSend())
          .then(function(v) { endTry(); return v; }, function(err) { endTry(); throw err; })
          .then(function() {
            console.log('[BLEInterface] Pending OK:', mid);
            run.ok++;
            probeDone();
            _vaultUpdateMessageStatus(nexoId, mid, 'sent');
            try {
              if (window.NEXO_updateMessageStatus) {
                window.NEXO_updateMessageStatus(mid, 'sent');
              }
            } catch (e) {}
            sendNext();
          })
          .catch(function(e) {
            console.warn('[BLEInterface] Pending fallo:', mid, e.message);
            if (/ACK timeout/i.test((e && e.message) || '') || (e && e.code === 'IN_MAILBOX')) run.noAck++; else run.other++;
            if (probeDone()) return;
            // No marcar failed de forma agresiva si es transitorio
            var isTransient = /timeout|abort|network|disconnected|not ready|busy|interrupted|temporary/i.test(e.message || '') || _failStatus(e) !== 'failed'; // 3211: también «ya en el buzón de internet»
            if (!isTransient) {
              _vaultUpdateMessageStatus(nexoId, mid, 'failed');
              try {
                if (window.NEXO_updateMessageStatus) {
                  window.NEXO_updateMessageStatus(mid, 'failed');
                }
              } catch (e2) {}
            }
            sendNext();
          });
      }
      sendNext();
    }).catch(function(e) {
      console.warn('[BLEInterface] Error cargando pending:', e.message);
    });
  }
};
// Reestructuración 15-11: BLE_MESSAGE_METHODS = estos métodos + los de ble_receive.js, ble_send.js, ble_blobs.js, ble_callroute.js (mismos nombres, mismo objeto).
export const BLE_MESSAGE_METHODS = Object.assign({}, _BLE_MESSAGE_METHODS_BASE, BLE_RECEIVE_METHODS, BLE_SEND_METHODS, BLE_BLOB_METHODS, BLE_CALLROUTE_METHODS);



