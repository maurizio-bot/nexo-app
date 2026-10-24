/**
 * NEXO — Funciones auxiliares de la interfaz Bluetooth (sacadas de ble_interface.js en la ronda 2752, sin cambios):
 * NEXO ID, UUID, contactos y fijados en el vault, ids de enlace (lan:/net:), vista previa, estados, llamadas seguras al
 * plugin nativo, eventos y registro de mensajes.
 */

/**
 * BLE Interface v6.14.0-NEXO
 * v6.14.0: contadores de no leídos (bumpUnread/clearUnread/unreadSummary) para notify.js, por todas las vías.
 * v6.13.1: el registro de arranque dice la versión real (decía v6.1.1 desde hace meses).
 * v6.13.0: internet (net_link.js): enlace "net:<NEXO ID>" por relés públicos o Tor, buzón de textos, nt:1 en el kx.
 * v6.12.0: poscuántico (e2e_ratchet v1.1): el paquete de claves lleva la clave ML-KEM; el kx dice cuál del otro tengo
 *         ('ph') para no repetirla (1,6 KB) en cada conexión.
 * v6.11.1: solo se sella si el primer puente lo reenvía bien (kx ss:1; una build anterior envolvía el sobre como texto
 *         suyo y no llegaba): _sxHops / hopSeals. El destino también desenvuelve ese caso. El chat lleva ss:1 (dentro de
 *         un mensaje que se descifra bien cuenta como aviso: contactos compartidos que nunca hicieron kx).
 * v6.11.0: remitente sellado (como el "sealed sender" de Signal): lo que va por Jump a un contacto que lo entiende
 *         (kx ss:1) viaja en un sobre anónimo para el destino (S1, e2e_crypto): los puentes ven a quién va, no quién lo
 *         manda. También las confirmaciones dirigidas, el kx dirigido y el remitente de los flujos.
 * v6.10.0: Wi-Fi normal (lan.js): un contacto en la misma red es el enlace "lan:<NEXO ID>", preferido sobre
 *         Bluetooth; si se cae, lo pendiente sigue por Bluetooth / Jump (_lanUp, _lanDown, _onLanPayload, linkOf).
 * v6.9.1: un paquete dañado (JSON roto o trozo suelto) se descarta; antes salía en el chat como texto.
 * v6.9.0: chat tipo WhatsApp: textos con respuesta/reenviado ('nexo_txt') en la vista previa; las acciones
 *         ('nexo_act', eliminar para todos) no se guardan como mensaje ni cuentan como no leídas. * v6.8.0: Protocolo Fénix (src/fenix/fenix.js): el kx anuncia fx:1 (y 'rs' tras recuperar una cuenta: los
 *         contactos borran las sesiones del protocolo 2 con ella); paquetes de control 'fp'/'fo'/'fq'/'fd'.
 * v6.7.0: Protocolo 2 de cifrado (como Signal): el kx y las tarjetas de contacto llevan el paquete de claves
 *         'b2'; solo se guarda si es de la clave aceptada del contacto (el de una clave pendiente espera a que
 *         el usuario la acepte). El contacto pasa a proto 2 y ya no se le cifra con el 1; lo que llegue de él
 *         con el 1 se descarta pasado el margen (e2eAllowsE1). Un reintento de un texto ya descifrado tras
 *         reiniciar (DUP) se confirma solo si está en el historial.
 * v6.6.0: Seguridad (anti-suplantación): la clave de un contacto no cambia sola. Una clave distinta queda
 *         pendiente (pendingKey); lo que llega cifrado con ella se retiene y no se le envía nada hasta que
 *         el usuario la acepte (acceptContactKey) o la rechace (rejectContactKey).
 * v6.5.0: Wi-Fi Direct (wifi_direct.js): el kx anuncia wd:1 si el teléfono lo tiene; paquetes de control
 *         'wq'/'wa'/'wn'/'wf' por Bluetooth; una transferencia por Wi-Fi Direct cuenta como en vuelo.
 * v6.4.0: Jump con cualquier teléfono NEXO: lo visto al escanear se anota (relay.noteSeen); sin enlace ni
 *         ruta se busca camino bajo demanda (relay.discover); se responde al kx (el lado servidor también
 *         dice que entiende Jump) y los escaneos de Jump no muestran el aviso de dispositivo nuevo.
 * v6.3.0: Jump (ble_relay.js): si el contacto no está a alcance pero otro teléfono conectado tiene ruta,
 *         textos y adjuntos salen por él ('to'/'dt' = destino); lo que llega por otro teléfono no se
 *         asocia a la dirección del puente y su ack vuelve dirigido al origen; kx de extremo a extremo.
 * v6.2.0: Cifrado de extremo a extremo: intercambio de claves públicas al conectar ('kx', o a petición
 *         con rq), clave del contacto guardada la primera vez y aviso si cambia; textos cortos
 *         descifrados en un paso previo en orden (ble_ack cifra/descifra el resto). La re-búsqueda solo
 *         se aplaza por un envío de archivo que avanza (uno parado ya no la bloquea).
 * v6.1.13: la re-búsqueda no escanea mientras hay una transferencia de archivo (comparten la radio).
 * v6.1.12: abrir chat ya no carga el historial completo con sus adjuntos (lo pagina main.js).
 * v6.1.11: Contactos compartidos (addSharedContacts) con parpadeo hasta abrir su chat. Un contacto que
 *          aún no se ha visto por radio se puede abrir y escribir: los mensajes quedan en cola y se
 *          entregan al encontrarlo (antes: "Dispositivo no encontrado" / no se abría el chat).
 * v6.1.10: la pestaña Perfil abre el registro de diagnóstico.
 * FIX v6.1.9: Cola de mensajes por contacto (antes por dirección Bluetooth: al reabrir la app el otro
 *             cambia de dirección y la cola vieja no salía nunca). sendFile sin el otro presente ya no
 *             espera ~40 s a una dirección concreta: falla rápido (PEER_ABSENT) y el adjunto queda para
 *             el reenvío al reconectar (antes se perdía). Adjuntos 'sending' sin transferencia viva se
 *             reenvían.
 * FIX v6.1.8: Lista de contactos ordenada por el último mensaje enviado o recibido (lastMessageAt);
 *             antes por lastSeen, que cambia con cada ping/escaneo y hacía saltar la lista. La hora y
 *             el texto de la fila son los del último mensaje. Redibujado agrupado (máx. cada 300 ms).
 * FIX v6.1.7: Al volver a la app (aviso nativo o visibilitychange) se reconecta, se sincroniza y se
 *             vacía la cola (dependía de @capacitor/app, no instalado). Re-búsqueda sin el tope de
 *             10 min, también con la app oculta (escaneo filtrado), y búsqueda de 2 min al abrir/volver.
 * FIX v6.1.6: Mensajes que no aparecían al reabrir la app: cola de pendientes con ack y reintentos;
 *             reenvío inmediato al recibir cualquier paquete del otro; conexiones abiertas por el
 *             nativo antes del JS se recuperan (getConnectedDevices); reconexión también desde ERROR;
 *             se prefiere un enlace listo aunque su dirección no sea la del escaneo.
 * FIX v6.1.5: textos cortos con confirmación y reintentos (sendWithRetry); guarda el MTU que devuelve
 *             el nativo (getMtu) para que ble_ack ajuste el tamaño de los trozos.
 * FIX v6.1.4: Tras reiniciar la app, los mensajes que quedaron en 'sending' se reenvían.
 * FIX v6.1.4: Re-búsqueda automática (cada 15s, máx ~10 min) de contactos desconectados o con
 *             mensajes en cola; antes nadie re-escaneaba y la cola no salía hasta abrir "Gente".
 *             Conexión entrante (rol servidor) también vacía la cola de pendientes.
 * FIX v6.1.3: Estados, cola de pendientes y esperas READY usan MAC normalizada como clave.
 *             El mapeo NXID->MAC devuelve 'aabbcc..' y los eventos nativos 'AA:BB:CC..';
 *             el envío nunca veía el dispositivo como listo y los mensajes se quedaban en cola.
 * FIX v6.1.2: _sendMessageNative envía "message" (no "content") con sobre v1 chat;
 *             desde v6.1.1 todos los envíos llegaban vacíos al nativo.
 * FIX v6.1.1: Espera post-cámara 100% bloqueante + reintento automático.
 *             Resolución de deviceId reforzada (evita MAC nulo/obsoleto).
 *             Supervisor no fuerza reconexión destructiva mientras hay
 *             transferencia de archivo activa (consulta ackSystem).
 * FIX v6.1.0: resumeBLEAfterCamera reconecta ACTIVAMENTE a los dispositivos
 *             que pauseBLEForCamera desconectó.
 * FIX: pauseBLEForCamera realmente bloquea envíos hasta resume
 * FIX: sendFile espera a que la cámara libere BLE si estaba pausado
 * FIX: Eliminado sendFileNative y listeners de archivo nativo (Opcion C)
 * FIX: Sync bidireccional — ambos lados envían sessionSync al conectar
 * FIX: Filtro de protocolo v3 (block_ack 'ba') para ble_ack.js v3.x
 * Base: v6.0.9-NEXO
 */
export var BLE_NEXO_ID_VAULT_FILE = 'nexo_advertising_id.json';

export var BLE_PINNED_VAULT_FILE = 'nexo_ble_pinned.json';

export var BLE_UUID_VAULT_FILE = 'nexo_device_uuid.json';

export var BLE_SEQ_COUNTER_FILE = 'nexo_seq_counter.json';

export var GRADIENTS = [
  'ble-gradient-1', 'ble-gradient-2', 'ble-gradient-3', 'ble-gradient-4',
  'ble-gradient-5', 'ble-gradient-6', 'ble-gradient-7', 'ble-gradient-8'
];

export var _blePinnedCache = [];

export var _bleUUIDCache = null;

export function _getGradientForUUID(uuid) {
  var hash = 0;
  for (var i = 0; i < uuid.length; i++) {
    hash = ((hash << 5) - hash) + uuid.charCodeAt(i);
    hash |= 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

export function _getInitials(name) {
  name = (name || '').toString().trim();
  // Ronda 2765: la primera letra o número de cada palabra (un grupo "👥 Familia" salía "�F": se partía el emoji)
  var parts = name.split(/\s+/).map(function(p) { return Array.from(p).find(function(c) { return /[\p{L}\p{N}]/u.test(c); }) || ''; }).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].toUpperCase();
  return (parts[0] + parts[parts.length - 1]).toUpperCase();
}

export function _generateNexoId() {
  var now = new Date();
  var seconds = now.getSeconds();
  var secBase36 = seconds.toString(36).toUpperCase().padStart(2, '0');
  var uuidPart = _generateUUID().replace(/-/g, '').substring(0, 6).toUpperCase();
  return 'NX' + secBase36 + uuidPart;
}

export function _saveNexoIdToVault(nexoId) {
  return new Promise(function(resolve) {
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.saveToFile === 'function') {
      _safeNativeCall(plugin, 'saveToFile', {
        filename: BLE_NEXO_ID_VAULT_FILE,
        content: JSON.stringify({ nexoId: nexoId, createdAt: Date.now() })
      }).then(function() { resolve(nexoId); }).catch(function() { resolve(nexoId); });
    } else { resolve(nexoId); }
  });
}

export function _loadNexoIdFromVault() {
  return new Promise(function(resolve) {
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.loadFromFile === 'function') {
      _safeNativeCall(plugin, 'loadFromFile', { filename: BLE_NEXO_ID_VAULT_FILE })
        .then(function(result) {
          if (result && result.exists && result.content) {
            try {
              var data = JSON.parse(result.content);
              if (data.nexoId && data.nexoId.length === 10 && data.nexoId.indexOf('NX') === 0) {
                resolve(data.nexoId); return;
              }
            } catch (e) {}
          }
          resolve(null);
        }).catch(function() { resolve(null); });
    } else { resolve(null); }
  });
}

export function _getOrCreateNexoId() {
  return new Promise(function(resolve) {
    _loadNexoIdFromVault().then(function(existingId) {
      if (existingId) { resolve(existingId); return; }
      var newId = _generateNexoId();
      _saveNexoIdToVault(newId).then(function(id) { resolve(id); });
    });
  });
}

// Texto corto del último mensaje para la lista de contactos
// Todo lo que se manda por Bluetooth es un objeto JSON con v, t o type arriba; lo demás es un trozo de otro
// mensaje (p. ej. un objeto de dentro que la recomposición nativa sacó suelto tras perderse un trozo)
// v6.10.0: enlace Wi-Fi con un contacto = dispositivo "lan:<NEXO ID>" (normalizado: "lannx…")
export function _lanId(nx) { return 'lan:' + _normId(nx); }

// v6.13.0: enlace por internet (relés públicos, net_link.js) = dispositivo "net:<NEXO ID>" (normalizado: "netnx…")
export function _netId(nx) { return 'net:' + _normId(nx); }

export function _netNx(deviceId) {
  var d = (deviceId || '').toString().toLowerCase();
  if (d.indexOf('net:') === 0) return d.substring(4);
  return /^netnx[0-9a-z]{8}$/.test(d) ? d.substring(3) : null;
}

// NEXO ID de un enlace que no es Bluetooth (Wi-Fi o internet)
export function _vNx(deviceId) { return _lanNx(deviceId) || _netNx(deviceId); }

export function _lanNx(deviceId) {
  var d = (deviceId || '').toString().toLowerCase();
  if (d.indexOf('lan:') === 0) return d.substring(4);
  return /^lannx[0-9a-z]{8}$/.test(d) ? d.substring(3) : null;
}

export function _isProtocolShaped(s) {
  try { var o = JSON.parse(s); return !!o && typeof o === 'object' && (o.v !== undefined || o.t !== undefined || o.type !== undefined); } catch (e) { return false; }
}

// v6.9.0: texto con respuesta / reenviado ('nexo_txt') y acciones del chat ('nexo_act': eliminar para todos)
export function _chatKind(content) {
  if (typeof content !== 'string' || content.charAt(0) !== '{' || content.indexOf('"nexo_') < 0) return null;
  try { var p = JSON.parse(content); return (p && (p.type === 'nexo_txt' || p.type === 'nexo_act')) ? p : null; } catch (e) { return null; }
}

// Recortar texto sin partir un emoji ni otro carácter de dos unidades (quedaría "�")
export function _cut(s, n) { s = String(s == null ? '' : s); if (s.length <= n) return s; var c = s.charCodeAt(n - 1); return s.substring(0, (c >= 0xD800 && c <= 0xDBFF) ? n - 1 : n); }

export function _messagePreview(content, attachmentType) {
  var t = attachmentType;
  var k = !t ? _chatKind(content) : null;
  if (k && k.type === 'nexo_act') return null;
  if (k) return _cut(k.t, 50);
  if (!t && typeof content === 'string' && content.charAt(0) === '{') {
    try { var p = JSON.parse(content); if (p && p.attachmentType) t = p.attachmentType; } catch (e) {}
  }
  if (t === 'image') return '📷 Foto';
  if (t === 'video') return '🎬 Vídeo';
  if (t === 'audio' || t === 'voice') return '🎤 Audio';
  if (t === 'location') return '📍 Ubicación';
  if (t === 'contact') return '👤 Contacto';
  if (t) return '📎 Archivo';
  return _cut(content, 50);
}

export function _formatTime(ts) {
  if (!ts) return '';
  var now = Date.now();
  var diff = now - ts;
  if (diff < 60000) return 'Ahora';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) {
    var d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
  }
  if (diff < 172800000) return 'Ayer';
  var days = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  return days[new Date(ts).getDay()];
}

export function _generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function _loadDeviceUUID() {
  return new Promise(function(resolve) {
    if (_bleUUIDCache) { resolve(_bleUUIDCache); return; }
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.loadFromFile === 'function') {
      _safeNativeCall(plugin, 'loadFromFile', { filename: BLE_UUID_VAULT_FILE })
        .then(function(result) {
          if (result && result.exists && result.content) {
            try {
              var data = JSON.parse(result.content);
              if (data.uuid) { _bleUUIDCache = data.uuid; resolve(data.uuid); return; }
            } catch (e) {}
          }
          var newUUID = _generateUUID();
          _bleUUIDCache = newUUID;
          _safeNativeCall(plugin, 'saveToFile', {
            filename: BLE_UUID_VAULT_FILE,
            content: JSON.stringify({ uuid: newUUID, createdAt: Date.now() })
          }).catch(function() {});
          resolve(newUUID);
        }).catch(function() {
          var newUUID = _generateUUID();
          _bleUUIDCache = newUUID;
          resolve(newUUID);
        });
    } else {
      var newUUID = _generateUUID();
      _bleUUIDCache = newUUID;
      resolve(newUUID);
    }
  });
}

export function _normId(id) {
  return (id || '').toString().toLowerCase().trim();
}

export function _normMac(mac) {
  return (mac || '').toString().toLowerCase().replace(/[:-]/g, '').trim();
}

export function _getBLEContacts() {
  if (window.vaultLoadContacts && typeof window.vaultLoadContacts === 'function') {
    return window.vaultLoadContacts();
  }
  return [];
}

export function _saveBLEContacts(contacts) {
  if (window.vaultSaveContacts && typeof window.vaultSaveContacts === 'function') {
    window.vaultSaveContacts(contacts);
  }
}

export function _addBLEContact(contact) {
  var uuid = _normId(contact.deviceUUID || contact.nexoId);
  if (!uuid) return false;
  var contacts = _getBLEContacts();
  var now = Date.now();
  var existingIdx = contacts.findIndex(function(c) {
    return _normId(c.nexoId || c.deviceUUID) === uuid;
  });
  if (existingIdx >= 0) {
    var existing = contacts[existingIdx];
    existing.nexoId = uuid;
    existing.deviceUUID = uuid;
    if (contact.name) existing.name = contact.name;
    existing.lastSeen = now;
    existing.online = true;
    if (contact.deviceId) existing.deviceId = contact.deviceId;
    _saveBLEContacts(contacts);
    return true;
  }
  contacts.push({
    nexoId: uuid,
    deviceUUID: uuid,
    name: contact.name || '',
    deviceId: contact.deviceId || null,
    addedAt: now,
    lastSeen: now,
    online: true,
    unreadCount: 0,
    lastMessage: ''
  });
  _saveBLEContacts(contacts);
  return true;
}

// Ronda 2764 (informe del dueño: al buscar salían "desconocidos"): el anuncio Bluetooth casi nunca trae el nombre del
// teléfono y el nativo ponía "Unknown". Nombre a mostrar: el del teléfono si se sabe; si no, "NEXO" y 4 letras del ID
// (el nombre de verdad llega con su kx al conectar: nm)
export function _isGenericName(name) { return !name || /^(unknown|nexo peer|nexo device|nexo [0-9a-z]{4})$/i.test(String(name).trim()); }
export function _niceName(name, nexoId) {
  if (!_isGenericName(name)) return String(name).trim();
  var nx = String(nexoId || '').toUpperCase();
  return nx ? 'NEXO ' + nx.slice(-4) : 'NEXO';
}

export function _removeBLEContact(deviceUUID) {
  var uuid = _normId(deviceUUID);
  var contacts = _getBLEContacts().filter(function(c) { return _normId(c.nexoId || c.deviceUUID) !== uuid; });
  _saveBLEContacts(contacts);
}

export function _isBLEContact(deviceUUID) {
  var uuid = _normId(deviceUUID);
  if (!uuid) return false;
  return _getBLEContacts().some(function(c) {
    return _normId(c.nexoId || c.deviceUUID) === uuid;
  });
}

export function _getContactByUUID(deviceUUID) {
  var uuid = _normId(deviceUUID);
  return _getBLEContacts().find(function(c) { return _normId(c.nexoId || c.deviceUUID) === uuid; });
}

export function _getContactByDeviceId(deviceId) {
  if (!deviceId) return null;
  var nd = _normMac(deviceId);
  return _getBLEContacts().find(function(c) { return _normMac(c.deviceId) === nd; });
}

export function _getPinnedContacts() {
  return _blePinnedCache || [];
}

export function _togglePinnedContact(deviceUUID) {
  var uuid = _normId(deviceUUID);
  var pinned = _getPinnedContacts();
  var idx = pinned.indexOf(uuid);
  if (idx >= 0) pinned.splice(idx, 1); else pinned.push(uuid);
  _blePinnedCache = pinned;
  var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
  if (plugin && typeof plugin.saveToFile === 'function') {
    _safeNativeCall(plugin, 'saveToFile', {
      filename: BLE_PINNED_VAULT_FILE,
      content: JSON.stringify({ pinned: pinned, savedAt: Date.now() })
    }).catch(function() {});
  }
  return idx < 0;
}

export function _loadPinnedFromVault() {
  return new Promise(function(resolve) {
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.loadFromFile === 'function') {
      _safeNativeCall(plugin, 'loadFromFile', { filename: BLE_PINNED_VAULT_FILE })
        .then(function(result) {
          if (result && result.exists && result.content) {
            try {
              var data = JSON.parse(result.content);
              if (data.pinned && Array.isArray(data.pinned)) { _blePinnedCache = data.pinned; }
            } catch (e) {}
          }
          resolve();
        }).catch(function() { resolve(); });
    } else { resolve(); }
  });
}

export function _loadSeqCounter() {
  return new Promise(function(resolve) {
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.loadFromFile === 'function') {
      _safeNativeCall(plugin, 'loadFromFile', { filename: BLE_SEQ_COUNTER_FILE })
        .then(function(result) {
          if (result && result.exists && result.content) {
            try { var data = JSON.parse(result.content); if (typeof data.seq === 'number') { resolve(data.seq); return; } } catch (e) {}
          }
          resolve(0);
        }).catch(function() { resolve(0); });
    } else { resolve(0); }
  });
}

export function _saveSeqCounter(seq) {
  return new Promise(function(resolve) {
    var plugin = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null;
    if (plugin && typeof plugin.saveToFile === 'function') {
      _safeNativeCall(plugin, 'saveToFile', {
        filename: BLE_SEQ_COUNTER_FILE,
        content: JSON.stringify({ seq: seq, updatedAt: Date.now() })
      }).then(function() { resolve(); }).catch(function() { resolve(); });
    } else { resolve(); }
  });
}

export function _isPinned(deviceUUID) {
  return _getPinnedContacts().indexOf(_normId(deviceUUID)) >= 0;
}

export var BLE_STATES = {
  DISCONNECTED: 'disconnected', CONNECTING: 'connecting',
  DISCOVERING_SERVICES: 'discovering_services', NOTIFICATIONS_READY: 'notifications_ready',
  READY_TO_CHAT: 'ready_to_chat', ERROR: 'error', RECONNECTING: 'reconnecting'
};

export var SUPERVISOR_STATES = {
  UNKNOWN: 'unknown', HEALTHY: 'healthy', CHECKING: 'checking',
  DEGRADED: 'degraded', ZOMBIE: 'zombie', RECONNECTING: 'reconnecting', OFFLINE: 'offline'
};

export function _hasNativeMethod(plugin, method) {
  return plugin && typeof plugin[method] === 'function';
}

export function _safeNativeCall(plugin, method, args) {
  return new Promise(function(resolve, reject) {
    if (!plugin) { reject(new Error('Plugin nativo no disponible')); return; }
    if (typeof plugin[method] !== 'function') { reject(new Error('Metodo ' + method + ' no disponible')); return; }
    try {
      var result = plugin[method](args);
      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      } else { resolve(result); }
    } catch (e) { reject(e); }
  });
}

export function _safeDispatchEvent(eventName, detail) {
  try { window.dispatchEvent(new CustomEvent(eventName, { detail: detail })); } catch (e) {}
}

export function _showToast(message, type) {
  type = type || 'info';
  var colors = { info: '#0082FC', warn: '#FFC107', error: '#FF5252', success: '#4CAF50' };
  var toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);padding:12px 20px;border-radius:10px;background:' + (colors[type] || colors.info) + ';color:' + (type === 'warn' ? '#000' : '#fff') + ';font-size:14px;font-weight:600;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,0.4);opacity:0;transition:opacity 0.3s ease;pointer-events:none;max-width:80%;text-align:center;';
  document.body.appendChild(toast);
  requestAnimationFrame(function() { toast.style.opacity = '1'; });
  setTimeout(function() { toast.style.opacity = '0'; setTimeout(function() { if (toast.parentNode) toast.remove(); }, 300); }, 3500);
}

export function _isControlPacket(content) {
  if (!content || typeof content !== 'string' || content.charAt(0) !== '{') return false;
  try {
    var obj = JSON.parse(content);
    if (obj.type === 'ack' || obj.type === 'read_receipt' || obj.type === 'ping' || obj.type === 'pong' || obj.type === 'kx' || obj.type === 'ni' || obj.type === 'rt' || obj.type === 'rk' || obj.type === 'rq' || obj.type === 'rp' ||
        obj.type === 'wq' || obj.type === 'wa' || obj.type === 'wn' || obj.type === 'wf' ||
        obj.type === 'gq' || obj.type === 'ga' || obj.type === 'gn' || obj.type === 'gf' || obj.type === 'gr' || obj.type === 'vf' ||
        obj.type === 'fp' || obj.type === 'fo' || obj.type === 'fq' || obj.type === 'fd' ||
        obj.type === 'chat_meta' || obj.type === 'chat_chunk' || obj.type === 'block_ack' ||
        obj.type === 'file_meta' || obj.type === 'file_chunk' || obj.type === 'file_resume') return true;
    if (obj.t === 'c' || obj.t === 'f' || obj.t === 'n' || obj.t === 'a' || obj.t === 'ba' || obj.t === 'ss' || obj.t === 'sr') return true;
    return false;
  } catch (e) { return false; }
}

// Mensajes propios que deben reenviarse. Incluye 'sending'/'queued': tras cerrar la app ya no hay
// nada en vuelo y antes se quedaban así para siempre. Adjuntos en 'sending' los reanuda
// resumeOutgoingTransfers (ble_ack), no aquí, para no duplicar la transferencia.
export function _isResendable(m) {
  if (!m || m._own !== true) return false;
  if (m.status === 'pending' || m.status === 'failed') return true;
  // v6.1.9: también adjuntos. Si la transferencia sigue viva, _isMsgInFlight la excluye y
  // ble_ack.sendFile reutiliza la que esté en curso con el mismo id (no se duplica).
  if (m.status === 'sending' || m.status === 'queued') return true;
  return false;
}

// v6.2.0: sin clave de cifrado del contacto (aún no la envió) o contacto ausente → sigue pendiente, no fallido
export function _failStatus(err) {
  return (err && (err.code === 'NO_KEY' || err.code === 'PEER_ABSENT')) ? 'pending' : 'failed';
}

export function _vaultUpdateMessageStatus(nexoId, msgId, status) {
  try {
    if (window.vaultUpdateMessageStatus && typeof window.vaultUpdateMessageStatus === 'function') {
      return window.vaultUpdateMessageStatus(nexoId, msgId, status);
    }
  } catch (e) {}
  return Promise.resolve();
}

export function _vaultGetOrCreateContact(nexoId, displayName, deviceName) {
  try {
    if (window.vaultGetOrCreateContact && typeof window.vaultGetOrCreateContact === 'function') {
      return window.vaultGetOrCreateContact(nexoId, displayName || deviceName);
    }
  } catch (e) {}
  return Promise.resolve();
}

export function _vaultAppendMessage(nexoId, msg, isOwn) {
  try {
    if (window.vaultAppendMessage && typeof window.vaultAppendMessage === 'function') {
      return window.vaultAppendMessage(nexoId, msg, isOwn);
    }
  } catch (e) {}
  return Promise.resolve();
}

export function _hydrateAttachments(msgs) {
  try {
    if (window.vaultHydrateAttachments && typeof window.vaultHydrateAttachments === 'function') return window.vaultHydrateAttachments(msgs);
  } catch (e) {}
  return Promise.resolve(msgs);
}

export function _vaultLoadMessages(nexoId) {
  try {
    if (window.vaultLoadMessages && typeof window.vaultLoadMessages === 'function') {
      return window.vaultLoadMessages(nexoId);
    }
  } catch (e) {}
  return Promise.resolve([]);
}

export function _autoScanRegister(nexoId) {
  try { if (window.autoScan && typeof window.autoScan.register === 'function') window.autoScan.register(nexoId); } catch (e) {}
}

export function _autoScanUnregister(nexoId) {
  try { if (window.autoScan && typeof window.autoScan.unregister === 'function') window.autoScan.unregister(nexoId); } catch (e) {}
}

export function _autoScanStart() {
  try { if (window.autoScan && typeof window.autoScan.start === 'function') window.autoScan.start(); } catch (e) {}
}
