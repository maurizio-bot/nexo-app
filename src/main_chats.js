import { vaultLoadContacts, vaultFindContactByNexoId, vaultSaveContact, vaultGetOrCreateContact, initVault } from './vault/vault_manager.js';
import { _normId, _PREVIEW_BY_TYPE, _cut, _plainText, _chatKind, _getCurrentContactId } from './ui/chat_format.js';
import { isGroupId, parseGroupEnvelope, groupAttachment } from './ui/groups.js';
import { openGroupChat } from './ui/groups_ui.js';
import { _clearMessageContainer, _setupBackButton } from './ui/chat_nav.js';
import { _loadPersistedMessages, _renderMessage, _removeIncomingPlaceholder, _onFileProgress, _updateMessageStatus, _updateMessageStorageStatus } from './ui/render.js';
import { parseCallSignal } from './ui/calls.js';
import { parseGroupCallSignal } from './ui/group_call.js';
import { _applyChatAction, _setupMessageActions } from './ui/chat_actions.js';
import { autoDiagReceived, autoDiagInit } from './ui/autodiag.js';
import { _notifier, _autoScan, _refreshLinkSubtitle, _askBackgroundOnce, SAFETY_TIMEOUT } from './main.js';
import { _resumeHdTransfers, _applyHdUpgrade, _onHdSent, _hdOutbox, _videoTimes, _startHd, _resumeHdForMsg } from './ui/video_send.js';
import { _noteContactMessage } from './ui/send.js';
import { isGroupWire, startGroupMedia } from './ui/group_media.js';
import { _msgContactMap } from './ui/chat_state.js';
import { NEXO_CONFIG } from './core/nexo_config.js';
import { NexoApp } from './app/nexo_app.js';
import { _toggleVaultUI, _focusInput, _setupMessageInput, _setupVaultToggle, _setupChatHeader, _setupKeyboardShortcuts, _setupJumpButton, _forceHideSplash, _enableFallbackMode } from './ui/app_setup.js';
import { rem } from './ui/rem.js';
import { initBLEInterface } from './ui/ble_interface.js';
import { createAckSystem } from './ui/ble_ack.js';
import { loadDisplayName, nameGate, applyDisplayName } from './ui/display_name.js';
import { welcomeGuide } from './ui/welcome_guide.js';
import { notifBannerInit } from './ui/notif_banner.js';
import { avatarInit } from './ui/avatar.js';
import { updaterInit } from './ui/updater.js';
import { usageInit } from './ui/usage_stats.js';
import { profileInit } from './ui/profile_data.js';
import { profileShareInit } from './ui/profile_share.js';
import { psiInit } from './ui/psi.js';
import { gameStatsInit } from './ui/game_stats.js';
import { wallpaperInit } from './ui/wallpaper.js';
import { estadosInit } from './ui/estados.js';
import { estadosScreenInit } from './ui/estados_screen.js';
import { NEXO_DIAG } from './core/nap.js';
import { shareInInit } from './ui/share_in.js'; // 3161: NEXO en el menú «Compartir» de Android (texto y enlaces)
// main.js — abrir el chat correcto (desde un aviso, el único sin leer…) y el mensaje que llega.
// Reestructuración 15-11: movido TAL CUAL desde main.js (solo declaraciones; lo que se ejecuta al arrancar sigue allí, en su orden).



// 2995 (dueño 10-11: «al pulsar una notificación no me manda al chat que mandó el mensaje»): con la app cerrada el nativo avisa
// antes de que el vault y la interfaz estén listos; abrir entonces creaba un contacto «NEXO» vacío o no hacía nada. Espera (hasta
// 30 s) a que la app termine de arrancar y entonces abre el chat.
function _openChatWhenReady(deviceId, n) {
  try {
    if (window.NEXO && window.NEXO.initialized && window.NEXO.app && window.NEXO.app.bleInterface) { _openChatFromNotification(deviceId); return; }
  } catch (e) {}
  if (n < 60) setTimeout(function() { _openChatWhenReady(deviceId, n + 1); }, 500);
}

// 2999 (dueño 10-11: «pulso la notificación y no me abre el chat sino el estado anterior o Ajustes»): el aviso genérico «Mensaje nuevo» no trae
// chat; antes solo se abría si UN solo chat tenía mensajes sin leer (con 20 contactos casi nunca). Ahora se abre el chat con el mensaje sin
// leer MÁS RECIENTE (el que acaba de llegar).
function _latestUnreadChat(bi) {
  var u = bi.unreadSummary().filter(function(x) { return x.count > 0; });
  if (!u.length) return null;
  var best = null, bestAt = -1;
  u.forEach(function(x) {
    var at = 0;
    try {
      if (bi.groups && bi.groups.isGroup(x.chatId)) { var g = bi.groups.get(x.chatId); at = (g && g.lastMessageAt) || 0; }
      else { var c = (vaultLoadContacts() || []).find(function(k) { return _normId(k.nexoId || k.deviceUUID) === _normId(x.chatId); }); at = (c && c.lastMessageAt) || 0; }
    } catch (e) {}
    if (at > bestAt) { bestAt = at; best = x.chatId; }
  });
  return best;
}
function _openSoleUnreadWhenReady(n) {
  try {
    var bi = window.NEXO && window.NEXO.initialized && window.NEXO.app && window.NEXO.app.bleInterface;
    if (bi && typeof bi.unreadSummary === 'function' && _latestUnreadChat(bi)) {
      // hay mensajes: se deja un instante por si llega algo más reciente y se decide con lo que haya
      setTimeout(function() {
        try { var id = _latestUnreadChat(bi); if (id) { console.log('[NOTIF] Aviso genérico tocado: abro el chat con el último mensaje sin leer (' + id + ')'); _openChatFromNotification(id); } } catch (e) {}
      }, 1200);
      return;
    }
  } catch (e) {}
  if (n < 24) setTimeout(function() { _openSoleUnreadWhenReady(n + 1); }, 500);
}

// Al abrir un chat desde un aviso se cierra lo que hubiera encima (Ajustes, perfiles, un estado): si no, el chat se abre DETRÁS y se ve la pantalla de antes
function _closeSheetsForChat() {
  ['nexo-settings-sheet', 'nexo-profile-sheet', 'nexo-contact-profile', 'estado-overlay'].forEach(function(id) {
    try { var el = document.getElementById(id); if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
  });
}

function _openChatFromNotification(deviceId) {
  try {
    if (!window.NEXO.app) return;
    _closeSheetsForChat();
    console.log('[NOTIF] Aviso tocado: abro el chat ' + deviceId);
    // Ronda 2760: aviso de un grupo → su chat; aviso sin remitente conocido (Jump con remitente oculto y la app
    // cerrada) → solo se abre la app. Antes se guardaba un "contacto" con ese id
    if (isGroupId(deviceId)) { openGroupChat(_normId(deviceId)); return; }
    if (!/^nx[0-9a-z]{8}$/.test(_normId(deviceId))) return;
    _clearMessageContainer();
    var contact = vaultFindContactByNexoId(deviceId);
    if (!contact) {
      contact = { nexoId: deviceId, displayName: 'NEXO' };
      vaultSaveContact(contact);
    }
    if (!contact.name) contact.name = contact.displayName || 'NEXO';
    // v9.9.52: por openChat (pone a 0 los no leídos y quita la notificación)
    var obi = window.NEXO.app.bleInterface;
    if (obi && typeof obi.openChat === 'function') { obi.openChat(_normId(deviceId)).catch(function() {}); return; }
    window.NEXO.app.activeContact = contact;
    if (window.NEXO.app.bleInterface) {
      window.NEXO.app.bleInterface._activeChatDeviceId = deviceId;
    }
    window.dispatchEvent(new CustomEvent('nexo:ble:openChat', { detail: { contact: contact } }));
    document.body.classList.add('chat-view-active');
    var backBtn = document.getElementById('chat-back-btn');
    if (backBtn) backBtn.classList.add('visible');
    var nameInput = document.getElementById('chat-contact-name');
    if (nameInput) nameInput.value = contact.name || 'NEXO';
    _loadPersistedMessages();
    console.log('[MAIN] Chat abierto desde notificacion:', deviceId);
  } catch (e) {
    console.warn('[MAIN] _openChatFromNotification error:', e);
  }
}

function _handleIncomingMessage(msg) {
  try {
    if (!msg) return;
    if (msg.fromVault === true) {
      _renderMessage(msg, true);
      return;
    }
    if (msg.content && typeof msg.content === 'string') {
      var trimmed = msg.content.trim();
      if (trimmed.charAt(0) === '{') {
        try {
          var protoCheck = JSON.parse(trimmed);
          if (protoCheck.jump && typeof protoCheck.jump.ttl === 'number') {
            console.warn('[MAIN] Protocol wrapper v1 con jump descartado:', protoCheck.msgId);
            return;
          }
          if (protoCheck.type === 'chat_meta' || protoCheck.type === 'chat_chunk' ||
              protoCheck.type === 'file_meta' || protoCheck.type === 'file_chunk' ||
              protoCheck.type === 'file_resume' || protoCheck.type === 'ack' ||
              protoCheck.type === 'read_receipt' || protoCheck.type === 'ping' || protoCheck.type === 'kx' ||
              protoCheck.type === 'rt' || protoCheck.type === 'rk' || protoCheck.type === 'rq' || protoCheck.type === 'rp' ||
              /^w[qanf]$/.test(protoCheck.type || '') || /^f[poqd]$/.test(protoCheck.type || '') ||
              protoCheck.type === 'pong' ||
              protoCheck.t === 'c' || protoCheck.t === 'f' || protoCheck.t === 'n' ||
              protoCheck.t === 'a' || protoCheck.t === 'ba' || protoCheck.t === 'ss' || protoCheck.t === 'sr') {
            console.warn('[MAIN] Protocol JSON defensively dropped:', protoCheck.type || protoCheck.t);
            return;
          }
        } catch (e) {}
      }
    }
    // Ronda 2758: señal de llamada que llegó por el camino de los textos largos
    var csg = !msg.groupId ? parseCallSignal(msg.content) : null;
    if (csg) { var bcs = window.bleInterface && window.bleInterface.calls; if (bcs && msg.e2e === true) window.bleInterface._callSignal(msg.senderNexoId || msg.deviceUUID, csg, msg.messageId); else console.warn('[CALL] Señal sin cifrar descartada'); return; }
    // #128: señal de llamada de GRUPO por el camino de los textos largos (como la 1-a-1)
    var gcsg = !msg.groupId ? parseGroupCallSignal(msg.content) : null;
    if (gcsg) { var bgc = window.bleInterface && window.bleInterface.gcall; if (bgc && msg.e2e === true) bgc.onSignal(msg.senderNexoId || msg.deviceUUID, gcsg); else console.warn('[GCALL] Señal sin cifrar descartada'); return; }
    // Ronda 2758: mensaje de grupo que llegó por el camino de los textos largos (los cortos ya vienen con groupId)
    var bgs = window.bleInterface && window.bleInterface.groups;
    if (!msg.groupId) {
      var genv = parseGroupEnvelope(msg.content);
      if (genv) {
        var gr = bgs ? bgs.receive(genv, msg.senderNexoId || msg.deviceUUID, msg.messageId || msg.msgId) : null;
        if (!gr) return;
        msg.groupId = gr.gid; msg.content = gr.content;
        var gat = groupAttachment(gr.content);
        if (gat) { msg.attachmentType = gat.attachmentType; msg.attachmentPayload = gat.payload; msg.attachmentMeta = gat.meta || {}; }
        var gpv = gat ? (_PREVIEW_BY_TYPE[gat.attachmentType] || '📎 Archivo') : _cut(_plainText(gr.content), 50);
        bgs.noteMessage(gr.gid, bgs.memberName(msg.senderNexoId) + ': ' + gpv, msg.timestamp || Date.now());
      }
    }
    // v9.9.45: acción del chat (eliminar para todos): se aplica, no se muestra
    var chatAct = _chatKind(msg.content);
    if (chatAct && chatAct.type === 'nexo_act') { _applyChatAction(msg.senderNexoId || msg.deviceUUID, chatAct); return; }
    // 2974: diagnóstico automático de un probador: a la bandeja de Perfil, nunca al chat
    if (chatAct && chatAct.type === 'nexo_diag') { try { autoDiagReceived(msg.senderNexoId || msg.deviceUUID, chatAct); } catch (e) {} return; }
    var bi = window.NEXO.app && window.NEXO.app.bleInterface;
    var localUUID = (bi && bi.localNexoId) || (bi && bi.localDeviceUUID) || '';
    var senderUUID = msg.senderNexoId || msg.deviceUUID || '';
    if (senderUUID && localUUID && _normId(senderUUID) === _normId(localUUID)) {
      console.log('[MAIN] Mensaje propio ignorado');
      return;
    }
    if (msg.senderNexoId) {
      vaultGetOrCreateContact(msg.senderNexoId, msg.senderName || 'NEXO');
    }
    // 3010 (dueño 11-11: «la lista no se ordena desde el último de conversación»): un texto LARGO (> 180 letras, llega troceado
    // por este camino) no subía al contacto arriba ni cambiaba su último mensaje; solo lo hacían los cortos (ble_messages).
    // Ahora todo mensaje 1-a-1 recibido lo anota. Si ya se anotó con la misma hora (los cortos, los archivos), no hace nada.
    if (!msg.groupId && senderUUID && bi && typeof bi.noteContactMessage === 'function') {
      var npv = msg.attachmentType ? (_PREVIEW_BY_TYPE[msg.attachmentType] || '📎 Archivo') : _cut(_plainText(msg.content), 50);
      try { bi.noteContactMessage(senderUUID, npv, msg.timestamp || Date.now()); } catch (e) {}
    }
    // 3012 (dueño 11-11: avisos sin mensaje): el nativo sabe que ESTE mensaje ya está en el teléfono (también los largos y los
    // archivos, que no pasan por ble_messages): si el otro lo reenvía con esta app cerrada, no sale «Mensaje nuevo»
    if (bi && typeof bi._noteSeen === 'function' && msg.msgId) { try { bi._noteSeen(msg.msgId); } catch (e) {} }
    _renderMessage(msg);
    if (window.NEXO.app && typeof window.NEXO.app.onMessage === 'function') {
      try { window.NEXO.app.onMessage(msg); } catch (omErr) {}
    }
    // v9.9.52: no leídos, notificación y confirmación de leído (solo con el chat abierto y la app a la vista)
    var senderId = msg.senderNexoId || msg.sender || '';
    var msgId = msg.messageId || msg.msgId || '';
    if (senderId) {
      var sc = vaultFindContactByNexoId(senderId);
      var who = (sc && (sc.name || sc.displayName)) || msg.senderName || 'NEXO';
      var pvw = msg.attachmentType ? (_PREVIEW_BY_TYPE[msg.attachmentType] || '📎 Archivo') : _cut(_plainText(msg.content), 80);
      var grpN = msg.groupId && bgs ? bgs.get(msg.groupId) : null;
      // 3004 (investigación 11-11): la tarjeta de CITA («📦 … esperando que los dos estén en línea») lleva el MISMO id que el archivo
      // que vendrá. Su «leído» marcaba el ARCHIVO como leído en el que lo manda sin haberse entregado (y podía perderse). Para el
      // aviso y el «leído» se usa un id propio (#cita) que no se confirma; cuando llega el archivo de verdad, se confirma él.
      var nId = (msg.attachmentMeta && msg.attachmentMeta.cita && !msg.attachmentPayload && !msg.attachmentRef) ? msgId + '#cita' : msgId;
      _notifier.incoming(grpN ? { cid: grpN.id, msgId: nId, name: grpN.name, preview: who + ': ' + pvw }
        : { cid: senderId, msgId: nId, name: who, preview: pvw });
    }
  } catch (err) {
    console.warn('[MAIN] _handleIncomingMessage error:', err && err.message);
  }
}

function _registerCriticalListeners() {
  try {
    window.addEventListener('nexo:ble:deviceConnected', function(e) {
      if (e && e.detail && e.detail.deviceId) {
        if (_autoScan) _autoScan.unregisterDevice(e.detail.deviceId);
      }
    });
    window.addEventListener('nexo:ble:peerReady', function(e) {
      try {
        if (e && e.detail && e.detail.nexoId) {
          var nx = _normId(e.detail.nexoId);
          console.log('[MAIN] peerReady:', nx);
          if (window.NEXO.app && window.NEXO.app.bleInterface) {
            window.NEXO.app.bleInterface._resendPendingMessages(nx);
          }
          // v9.9.30: vídeos HD que quedaron pendientes o a medias
          setTimeout(function() { _resumeHdTransfers(nx); }, 3000);
          _refreshLinkSubtitle();
        }
      } catch (err) {
        console.warn('[MAIN] peerReady handler error:', err.message);
      }
    });
    window.addEventListener('nexo:ble:deviceDisconnected', function(e) {
      if (e && e.detail && e.detail.deviceId) {
        var nid = e.detail.nexoId || e.detail.deviceId;
        if (_autoScan) {
          _autoScan.registerKnownDevice(e.detail.deviceId, nid);
          _autoScan.start();
        }
      }
    });
    // v9.9.34: al abrir un chat se dibuja solo la última página (ver _loadPersistedMessages)
    window.addEventListener('nexo:vault:messagesLoaded', function(e) {
      var d = (e && e.detail) || {};
      if (d.contactId && _normId(d.contactId) === _normId(_getCurrentContactId())) _loadPersistedMessages();
    });
    window.addEventListener('nexo:ble:messageReceived', function(e) {
      if (e && e.detail) {
        _handleIncomingMessage(e.detail);
      }
    });
    window.addEventListener('nexo:ble:fileComplete', function(e) {
      try {
        var d = e.detail || {};
        if (!d.fileId || !d.data) {
          console.warn('[MAIN] fileComplete ignorado: falta fileId o data', d && d.fileId, !!(d && d.data));
          return;
        }
        var meta = d.meta || {};
        if (meta.hdFor) {
          _applyHdUpgrade(meta.senderNexoId || meta.fromNexoId || meta.fr || d.senderNexoId, meta.hdFor, d.data, meta);
          return;
        }
        _removeIncomingPlaceholder(d.fileId);
        _noteContactMessage(meta.senderNexoId || meta.fromNexoId || meta.fr || d.senderNexoId, meta.type || meta.tp || 'file', Date.now());
        console.log('[MAIN] Archivo recibido via fileComplete:', d.fileId, 'type=', meta.type, 'fr=', meta.fr, 'len=', (d.data || '').length);
        var senderId = meta.senderNexoId || meta.fromNexoId || meta.fromId || meta.fr || d.senderNexoId || null;
        var recvMsg = {
          msgId: d.fileId,
          messageId: d.fileId,
          attachmentType: meta.type || meta.tp || 'file',
          attachmentPayload: d.data,
          attachmentMeta: meta,
          senderNexoId: senderId,
          senderName: meta.fromName || meta.f || 'NEXO',
          _own: false,
          status: 'delivered',
          timestamp: meta.rxTs || meta.ts || Date.now() // ronda 2767: la de llegada (ble_ack.js)
        };
        _handleIncomingMessage(recvMsg);
      } catch (err) {
        console.warn('[MAIN] Error en fileComplete handler:', err && err.message);
      }
    });
    window.addEventListener('nexo:ble:fileProgress', function(e) {
      try { _onFileProgress(e && e.detail); } catch (err) {}
    });
    // Ronda 2758: estado de un mensaje de grupo (el menor de los de cada miembro, groups.js)
    window.addEventListener('nexo:groups:status', function(e) {
      var d = (e && e.detail) || {};
      if (!d.msgId || !d.status) return;
      _updateMessageStatus(d.msgId, d.status);
      _updateMessageStorageStatus(d.msgId, d.status, d.gid);
    });
    window.addEventListener('nexo:ble:ackStatus', function(e) {
      try {
        if (e && e.detail && e.detail.msgId) {
          if (window._sentFallbackTimers && window._sentFallbackTimers[e.detail.msgId]) {
            clearTimeout(window._sentFallbackTimers[e.detail.msgId]);
            delete window._sentFallbackTimers[e.detail.msgId];
          }
          var sid = e.detail.msgId, st = e.detail.status;
          if (/_hd$/.test(sid)) {
            // (el HD de un vídeo de grupo lo lleva group_media.js)
            if ((st === 'delivered' || st === 'read') && !isGroupWire(sid.replace(/_hd$/, ''))) { var base = sid.replace(/_hd$/, ''); _onHdSent(_msgContactMap[base] || (_hdOutbox[base] && _hdOutbox[base].cid), base); }
            return;
          }
          _updateMessageStatus(sid, st);
          _updateMessageStorageStatus(sid, st);
          if (st === 'delivered' || st === 'read') {
            if (_videoTimes[sid] && !_videoTimes[sid].previewS) {
              _videoTimes[sid].previewS = Math.round((Date.now() - _videoTimes[sid].t0) / 1000);
              console.log('[VIDEO] Previa entregada en ' + _videoTimes[sid].previewS + ' s (' + _videoTimes[sid].previewKB + ' KB)');
            }
            if (_hdOutbox[sid]) _startHd(_hdOutbox[sid].cid, sid);
            else _resumeHdForMsg(sid);
          }
        }
      } catch (err) {
        console.warn('[MAIN] Error en ackStatus handler:', err.message);
      }
    });
    console.log('[MAIN] Critical listeners registered early');
  } catch (err) {
    console.warn('[MAIN] _registerCriticalListeners error:', err);
  }
}

async function initializeNexoApp() {
  try {
    await initVault();
    NEXO_CONFIG.assert(typeof NexoApp === 'function', 'NexoApp debe ser una clase valida');
    _registerCriticalListeners();
    var nexoConfig = {
      relayUrls: ['wss://relay.nexo.local:8080', 'wss://backup.nexo.local:8081'],
      bleTimeout: (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.BLE) ? NEXO_CONFIG.TIMEOUTS.BLE : 30000,
      enableGestures: true,
      enableMesh: true,
      onMessage: function(msg) {
        console.log('[NEXO] Mensaje recibido:', msg.msgId || msg.messageId);
      },
      onStatusChange: function(mode) {
        console.log('Modo:', mode);
      },
      onError: function(err) {
        console.error('App error:', err);
      },
      onVaultStateChange: function(isOpen) { _toggleVaultUI(isOpen); },
      actionCallbacks: {
        onReact: function(id) { rem.success('Reaccion anadida', 'REACT_OK'); },
        onReply: function(id) { _focusInput(id ? ('@' + id.substr(0, 8) + ' ') : ''); },
        onForward: function(id) { rem.info('Listo para reenviar', 'FORWARD_READY'); }
      }
    };
    window.NEXO.app = new NexoApp(nexoConfig);
    try {
      if (!window.bleInterface) {
        initBLEInterface();
      }
    } catch (bleInitErr) {
      console.warn('[MAIN] initBLEInterface error:', bleInitErr);
    }
    try {
      // FIX v9.9.26: NEXO.app.bleInterface se asigna en NEXO.app.init() (más abajo), así que aquí
      // seguía en null y el AckSystem nunca se vinculaba (sin entregado/leído, sendFile rechazado).
      var biEarly = (window.NEXO.app && window.NEXO.app.bleInterface) || window.bleInterface;
      if (biEarly) {
        var ackEarly = createAckSystem(biEarly);
        biEarly.setAckSystem(ackEarly);
        console.log('[MAIN] BleAckSystem vinculado EARLY');
      } else {
        console.warn('[MAIN] BleAckSystem NO vinculado: bleInterface no disponible');
      }
    } catch (ackEarlyErr) {
      console.warn('[MAIN] AckSystem early vinculo fallo:', ackEarlyErr);
    }
    setTimeout(function() {
      var bi = window.NEXO.app && window.NEXO.app.bleInterface;
      var ack = bi && bi.ackSystem;
      if (ack && typeof ack.resumeOutgoingTransfers === 'function') {
        ack.resumeOutgoingTransfers();
      }
    }, 3000);
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) {
        window.Capacitor.Plugins.NexoBLE.addListener('onNotificationOpened', function(event) {
          if (event && event.deviceId) {
            setTimeout(function() {
              _openChatWhenReady(event.deviceId, 0);
            }, 500);
          } else if (event && event.source === 'wake') {
            // El aviso genérico «Mensaje nuevo» (despertar por FCM) no sabe quién escribió: al tocarlo se abre el chat SOLO si
            // hay un único chat con mensajes sin leer (si hay varios, se queda en la lista)
            setTimeout(function() { _openSoleUnreadWhenReady(0); }, 500);
          }
        });
      }
    } catch (notifErr) {
      console.log('[MAIN] Notificacion listener no disponible:', notifErr);
    }
    // 3161: un texto o enlace compartido con NEXO desde otra app (el nativo lo retiene hasta aquí; la hoja sale con la app lista)
    shareInInit();
    // Al arrancar, los contadores de la app mandan sobre las notificaciones que hubiera en el teléfono
    // #dueño 05-11: la PRIMERA vez, la guía de bienvenida (welcome_guide.js) y, al cerrarla, el aviso de batería de
    // siempre. Si ya se vio la guía, welcomeGuide llama a _askBackgroundOnce al instante → mismo comportamiento de antes.
    // #dueño 06-11: ANTES de la bienvenida, la 1.ª vez se pide el NOMBRE (obligatorio, no se puede cambiar después; evita
    // perfiles falsos). Si ya está fijado, nameGate pasa de largo (y aplica el nombre). Luego la guía y el aviso de batería.
    setTimeout(function() { _notifier.syncNative(); Promise.resolve(_notifier.ensurePermission()).then(function(pr) { try { notifBannerInit(!!(pr && pr.granted === false)); } catch (e) {} loadDisplayName().then(function() { nameGate(window.bleInterface, { onDone: function() { welcomeGuide({ onDone: _askBackgroundOnce }); } }); }); }).catch(function() {}); }, 4000);
    var initPromise = window.NEXO.app.init();
    var timeoutPromise = new Promise(function(resolve, reject) {
      setTimeout(function() { reject(new Error('INIT_TIMEOUT')); }, (NEXO_CONFIG && NEXO_CONFIG.TIMEOUTS && NEXO_CONFIG.TIMEOUTS.CONNECT) ? NEXO_CONFIG.TIMEOUTS.CONNECT + 3000 : 13000);
    });
    try {
      await Promise.race([initPromise, timeoutPromise]);
    } catch (timeoutErr) {}
    window.NEXO.initialized = true;
    startGroupMedia(); // ronda 2764: HD y archivos grandes en grupos (reanudar lo pendiente)
    avatarInit(); // ronda 2765: foto de perfil
    updaterInit(); // 2986: avisa de una versión nueva (solo compilaciones con número; consulta GitHub, público)
    usageInit(); // 2989: contadores de uso y resumen diario al desarrollador
    autoDiagInit(); // 2974: diagnóstico automático al desarrollador (síntomas → mensaje oculto nexo_diag)
    profileInit(); // ronda 2910: datos de mi perfil (nombre y apellido, teléfono, correo — opcionales)
    loadDisplayName().then(function() { applyDisplayName(window.bleInterface); }); // #dueño 06-11: el nombre fijo elegido pisa el del teléfono (lo ven los contactos)
    profileShareInit(); // #dueño 04-11: compartir mis datos COMPLETOS con los contactos por E2E + guardar los suyos (perfil 2b/3)
    psiInit(); // #dueño 04-11 paso 3: «contactos en común» por PSI (psi.js) — al conectar, el ID menor inicia el cálculo
    gameStatsInit(); // #dueño 05-11: ranking cabeza a cabeza de los juegos (Fase A)
    wallpaperInit(); // ronda 2889: fondo de pantalla (lista + chats)
    estadosInit(); // ronda 2799: Estados (Stream fase 1)
    estadosScreenInit(); // 3169 (dueño 17-11): los estados en su propia pantalla, deslizando Contactos hacia la izquierda
    window.addEventListener('nexo:avatar', function() { var b = window.bleInterface; if (b) { try { b.renderContactsList(); b.renderOnlineStrip(); } catch (e) {} } });
    clearTimeout(SAFETY_TIMEOUT);
    try {
      if (window.NEXO.app && window.NEXO.app.bleInterface) {
        var bi = window.NEXO.app.bleInterface;
        console.log('[MAIN] BLE Interface estado:', {
          localUUID: bi.localDeviceUUID,
          activeChatId: bi._activeChatDeviceId,
          contacts: bi.getBLEContacts ? bi.getBLEContacts().length : 0
        });
      }
    } catch (logErr) { console.warn('[MAIN] Log BLE error:', logErr); }
    _setupMessageInput();
    _setupMessageActions();
    _setupVaultToggle();
    _setupChatHeader();
    _setupKeyboardShortcuts();
    _setupJumpButton();
    _setupBackButton();
    await _loadPersistedMessages();
    console.log('[MAIN] Fase 4 hooks OK');
    NEXO_DIAG.hideSplash();
    _forceHideSplash();
    console.log('NEXO ' + window.NEXO.version + ' Inicializado');
    try {
      var status = window.NEXO.app.getStatus ? window.NEXO.app.getStatus() : null;
      if (status) console.log('[NEXO STATUS]', status);
    } catch (statusErr) {}
  } catch (error) {
    console.error('Error en NexoApp:', error);
    clearTimeout(SAFETY_TIMEOUT);
    try {
      NEXO_DIAG.error('APP_INIT_ERROR', error.message || 'unknown');
      NEXO_DIAG.hideSplash();
    } catch (diagErr) {}
    _forceHideSplash();
    _enableFallbackMode();
  }
}

export { _openChatWhenReady, _latestUnreadChat, _openSoleUnreadWhenReady, _closeSheetsForChat, _openChatFromNotification, _handleIncomingMessage, _registerCriticalListeners, initializeNexoApp };
