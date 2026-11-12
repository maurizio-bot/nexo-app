/**
 * NEXO — Contactos y no leídos (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752, sin cambios):
 * contadores de no leídos, último mensaje de cada chat, contactos compartidos, quitar y consultar contactos.
 */
import { _cut, _getBLEContacts, _getContactByUUID, _messagePreview, _normId, _removeBLEContact, _safeDispatchEvent, _saveBLEContacts, _showToast, _vaultLoadMessages } from './ble_helpers.js';
import { t } from './i18n.js';


export const BLE_CONTACT_METHODS = {
  getBLEContacts() { return _getBLEContacts(); },

  bumpUnread(nexoId) {
    var nx = _normId(nexoId);
    if (this.groups && this.groups.isGroup(nx)) { var gn = this.groups.bumpUnread(nx); this.renderContactsList(); _safeDispatchEvent('nexo:unread', { nexoId: nx, count: gn }); return gn; } // ronda 2758
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c) return 0;
    c.unreadCount = (c.unreadCount || 0) + 1;
    c.lastSeen = Date.now();
    _saveBLEContacts(contacts);
    this.renderContactsList();
    _safeDispatchEvent('nexo:unread', { nexoId: nx, count: c.unreadCount });
    return c.unreadCount;
  },

  clearUnread(nexoId) {
    var nx = _normId(nexoId);
    if (this.groups && this.groups.isGroup(nx)) { this.groups.clearUnread(nx); this.renderContactsList(); _safeDispatchEvent('nexo:unread', { nexoId: nx, count: 0 }); return; }
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (c && c.unreadCount) { c.unreadCount = 0; _saveBLEContacts(contacts); this.renderContactsList(); }
    _safeDispatchEvent('nexo:unread', { nexoId: nx, count: 0 });
  },

  unreadSummary() {
    return _getBLEContacts().map(function(c) {
      return { chatId: _normId(c.nexoId || c.deviceUUID), name: c.name || '', count: c.unreadCount || 0 };
    }).filter(function(x) { return x.chatId; }).concat(this.groups ? this.groups.all().map(function(g) { return { chatId: g.id, name: g.name, count: g.unreadCount || 0 }; }) : []);
  },

  noteContactMessage(nexoId, preview, ts) {
    var nx = _normId(nexoId);
    if (!nx) return;
    if (this.groups && this.groups.isGroup(nx)) { this.groups.noteMessage(nx, preview ? 'Tú: ' + preview : '', ts); this.renderContactsList(); return; } // propios en un grupo
    var contacts = _getBLEContacts();
    var c = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
    if (!c) return;
    var t = ts || Date.now();
    // #dueño 08-11 (orden de la lista): con un mensaje (entrante o saliente) el contacto YA NO es «nuevo sin ver» → deja de
    // flotar arriba y se ordena por el más reciente como todos. El «nuevo arriba» queda solo para un contacto recién agregado
    // (de una tarjeta/grupo) con el que todavía NO cruzaste ningún mensaje. Antes solo se limpiaba al ABRIR el chat, así que un
    // contacto que te escribía pero cuyo chat no abriste se quedaba clavado arriba aunque su último mensaje fuera viejo.
    var cleared = !!c.isNewShared; if (cleared) c.isNewShared = false;
    // 3010: >= (no >): el mismo mensaje anotado dos veces (ble_messages y main.js) no vuelve a guardar ni redibujar
    if ((c.lastMessageAt || 0) >= t) { if (cleared) { _saveBLEContacts(contacts); this.renderContactsList(); } return; }
    c.lastMessageAt = t;
    if (preview) c.lastMessage = preview;
    _saveBLEContacts(contacts);
    this.renderContactsList();
  },

  // opts.quiet (ronda 2758, miembros de un grupo): sin resaltarlos como "nuevo contacto"
  addSharedContacts(list, sharedBy, opts) {
    var self = this;
    var res = { added: [], existing: [] }, keyFilled = false, bundles = [];
    var me = _normId(self.localNexoId);
    var contacts = _getBLEContacts();
    (Array.isArray(list) ? list.slice(0, 500) : []).forEach(function(c) { // 2805: tope anti-DoS (lista enorme de un contacto)
      var id = String((c && c.nexoId) || '').trim();
      if (!/^NX[0-9A-Z]{8}$/i.test(id)) return;
      var nx = _normId(id);
      if (nx === me) return;
      var name = _cut(String((c && c.name) || '').replace(/[<>]/g, '').trim(), 40) || id.toUpperCase();
      var cur = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
      if (cur) {
        // H3 (07-11): una clave que llega «de oídas» (tarjeta compartida o cartas de un grupo, sharedBy≠null) entra SIN
        // VERIFICAR: se usa igual (no rompe «compartir contacto»), pero queda marcada pkHearsay para avisar en el banner y
        // empujar a comparar el número de seguridad. Se confirma sola cuando el propio contacto conecta directo (_noteSenderKey).
        if (!cur.publicKey && c && typeof c.publicKey === 'string' && /^[A-Za-z0-9+/=]{80,100}$/.test(c.publicKey)) { cur.publicKey = c.publicKey; if (_normId(sharedBy)) cur.pkHearsay = 1; keyFilled = true; }
        if (c && c.b2) bundles.push([nx, c.b2]);
        res.existing.push(cur.name || name);
        return;
      }
      var pk = (c && typeof c.publicKey === 'string' && /^[A-Za-z0-9+/=]{80,100}$/.test(c.publicKey)) ? c.publicKey : '';
      contacts.push({
        nexoId: nx, deviceUUID: nx, name: name, deviceId: null, addedAt: Date.now(), lastSeen: 0,
        online: false, unreadCount: 0, lastMessage: '', isNewShared: !(opts && opts.quiet), sharedBy: _normId(sharedBy) || null,
        publicKey: pk, ss: pk && c.ss ? 1 : undefined, // v6.11.1: así el primer mensaje ya puede ir sellado
        nt: pk && c.nt ? 1 : undefined, // v6.13.0: y por internet
        pkHearsay: (pk && _normId(sharedBy)) ? 1 : undefined // H3 (07-11): clave «de oídas» (tarjeta/grupo) → sin verificar hasta contacto directo o número de seguridad
      });
      if (pk && c.b2) bundles.push([nx, c.b2]);
      res.added.push(name);
      self._markPeerLost(nx);
    });
    if (keyFilled && !res.added.length) _saveBLEContacts(contacts);
    if (res.added.length) {
      _saveBLEContacts(contacts);
      self.renderContactsList();
      self._startPresenceSearch(120000);
      console.log('[BLEInterface] Contactos compartidos agregados:', res.added.join(', '));
    }
    // Paquetes de claves del protocolo 2 que trae la tarjeta (solo si son de la clave del contacto)
    bundles.forEach(function(x) { self._notePeerBundle(x[0], x[1]); });
    return res;
  },

  _backfillLastMessageAt() {
    var self = this;
    var all = _getBLEContacts();
    // #dueño 08-11 (hueco del 2955): un contacto que YA tiene mensajes pero quedó marcado isNewShared de una build vieja
    // (donde el flag solo se limpiaba al ABRIR el chat, y este chat nunca se abrió) seguía FLOTANDO arriba con su mensaje
    // viejo (vivo Y03 06:44 por encima de Galaxy «Ahora»). Al arrancar, cualquier contacto con lastMessageAt deja de ser
    // «nuevo sin ver» → se limpia el flag persistido (el orden y el resalte quedan bien). El «nuevo arriba» queda solo
    // para uno SIN ningún mensaje. (El sort además ya lo ignora en vivo, pero acá lo dejamos limpio en disco.)
    var staleCleared = 0;
    all.forEach(function(c) { if (c.isNewShared && c.lastMessageAt) { c.isNewShared = false; staleCleared++; } });
    if (staleCleared) { _saveBLEContacts(all); self.renderContactsList(); }
    var contacts = all.filter(function(c) { return !c.lastMessageAt && (c.nexoId || c.deviceUUID); });
    if (!contacts.length) return;
    Promise.all(contacts.map(function(c) {
      var nx = _normId(c.nexoId || c.deviceUUID);
      return _vaultLoadMessages(nx).then(function(msgs) {
        var last = (msgs || []).reduce(function(m, x) { return (x.timestamp || 0) > ((m && m.timestamp) || 0) ? x : m; }, null);
        if (last) self.noteContactMessage(nx, _messagePreview(last.content || last.text, last.attachmentType), last.timestamp);
      }).catch(function() {});
    }));
  },

  removeContact(deviceUUID) {
    try {
      _removeBLEContact(deviceUUID);
      // Ronda 2764: sus códigos rotativos dejan de reconocerse ya (antes, hasta la siguiente revisión, ~30 s)
      if (this._ridBook) this._ridBook.refresh(_getBLEContacts(), true).catch(function() {});
      console.log('[ADD] Contacto eliminado: ' + deviceUUID);
      this.renderContactsList();
      this.renderNewDeviceBar();
      this.renderOnlineStrip();
    } catch (e) {}
  },

  // 3018 (opción A del dueño 12-11): al reinstalar NEXO el teléfono estrena NEXO ID y clave; para los demás es un contacto
  // NUEVO y el viejo se quedaba en la lista con sus pendientes (y la app lo buscaba sin fin). Al entrar un contacto nuevo con
  // el MISMO nombre que uno que ya está (y que ahora no se alcanza por ningún camino) se pregunta si es el mismo teléfono
  // reinstalado; si sí, el chat viejo y lo pendiente pasan al nuevo (lo pendiente sale cifrado con la clave nueva al enviarse)
  // y el viejo se borra. Nunca se une sin preguntar: dos personas pueden llamarse igual.
  _reinstallCandidates(newNexoId) {
    var self = this, nx = _normId(newNexoId);
    var norm = function(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
    var all = _getBLEContacts();
    var cur = all.find(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; });
    var name = norm(cur && cur.name);
    if (!cur || !name || name === 'nexo' || name === nx) return [];
    var reach = function(o) {
      try {
        if (typeof self._bleReadyFor === 'function' && self._bleReadyFor(o)) return true;
        if (self.lan && typeof self.lan.canReach === 'function' && self.lan.canReach(o)) return true;
        if (self.net && typeof self.net.canReach === 'function' && self.net.canReach(o)) return true;
      } catch (e) {}
      return false;
    };
    return all.filter(function(c) {
      var o = _normId(c.nexoId || c.deviceUUID);
      if (!o || o === nx || !/^nx[0-9a-z]{8}$/.test(o)) return false;
      if (self.groups && typeof self.groups.isGroup === 'function' && self.groups.isGroup(o)) return false;
      return norm(c.name) === name && !reach(o); // si los dos están a la vez, son dos teléfonos distintos
    }).sort(function(a, b) { return (b.lastSeen || b.addedAt || 0) - (a.lastSeen || a.addedAt || 0); });
  },

  _offerReinstallMerge(newNexoId) {
    var self = this, nx = _normId(newNexoId);
    if (!nx) return;
    self._reinstallAsked = self._reinstallAsked || new Set();
    if (self._reinstallAsked.has(nx)) return;
    var cands = self._reinstallCandidates(nx);
    if (!cands.length) return;
    self._reinstallAsked.add(nx);
    var old = cands[0], oldNx = _normId(old.nexoId || old.deviceUUID), name = old.name || '';
    console.log('[ADD] ' + nx + ' se llama igual que ' + oldNx + ' (sin camino ahora): se pregunta si es el mismo teléfono reinstalado');
    try { window.dispatchEvent(new CustomEvent('nexo:diag:symptom', { detail: { kind: 'contacto_duplicado', info: oldNx + ' → ' + nx + ' (mismo nombre)' } })); } catch (e) {} // 3020
    setTimeout(function() {
      var ok = false;
      try { ok = window.confirm(t('merge_reinstall_q', '«{name}» ya estaba en tus contactos con otro NEXO ID. ¿Es el mismo teléfono, reinstalado? Si dices que sí, el chat anterior y lo pendiente pasan a este y el contacto viejo se borra.').replace('{name}', name)); } catch (e) { ok = false; }
      if (!ok) { console.log('[ADD] ' + nx + ': el usuario dice que NO es el mismo que ' + oldNx); return; }
      self._mergeContactInto(oldNx, nx).catch(function(e) { console.warn('[ADD] No se pudo unir ' + oldNx + ' con ' + nx + ': ' + ((e && e.message) || e)); });
    }, 600);
  },

  async _mergeContactInto(oldNexoId, newNexoId) {
    var self = this, oldNx = _normId(oldNexoId), nx = _normId(newNexoId);
    if (!oldNx || !nx || oldNx === nx || !window.vaultSaveMessages) return false;
    var a = (await _vaultLoadMessages(oldNx)) || [], b = (await _vaultLoadMessages(nx)) || [];
    var seen = new Set();
    var merged = a.concat(b).filter(function(m) {
      var id = m && (m.msgId || m.messageId || m.id);
      if (!m) return false;
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id); return true;
    }).sort(function(x, y) { return (x.timestamp || 0) - (y.timestamp || 0); });
    // Lo propio aún no entregado vuelve a «pendiente» y se cortan sus envíos en curso hacia el viejo (iban a una dirección/clave
    // que ya no existe y, al fallar, apuntaban su estado en el chat viejo: el mensaje se quedaba «enviando» para siempre en el
    // nuevo). Lo reenvía la vuelta de pendientes del contacto nuevo, cifrado con su clave.
    var ack = self.ackSystem;
    merged.forEach(function(m) {
      if (!m._own || m.status === 'delivered' || m.status === 'read') return;
      var id = m.msgId || m.messageId || m.id;
      m.status = 'pending';
      if (!id || !ack) return;
      try {
        var e = ack.pendingAcks && ack.pendingAcks.get(id);
        if (e) { clearTimeout(e.timer); ack.pendingAcks.delete(id); var er = new Error('interrupted: contacto unido a ' + nx); try { e.reject(er); } catch (e2) {} }
        var st = ack.outgoingStreams && ack.outgoingStreams.get(id);
        if (st && typeof st.abort === 'function') st.abort();
        if (ack.outgoingStreams) ack.outgoingStreams.delete(id);
        if (ack.preparing) ack.preparing.delete(id);
        if (ack._chatPrep) ack._chatPrep.delete(id);
      } catch (e3) {}
    });
    // la cola de «esperando conexión» hacia el viejo (el envío esperaba a que su Bluetooth volviera)
    var gone = new Set(merged.filter(function(m) { return m._own && m.status === 'pending'; }).map(function(m) { return m.msgId || m.messageId || m.id; }));
    if (self._pendingMessageQueue && gone.size) {
      self._pendingMessageQueue.forEach(function(q, dev) {
        if (!Array.isArray(q)) return;
        var keep = q.filter(function(it) { return !(it && gone.has(it.messageId)); });
        if (keep.length !== q.length) { if (keep.length) self._pendingMessageQueue.set(dev, keep); else self._pendingMessageQueue.delete(dev); }
      });
    }
    // primero se guarda el chat unido en el contacto nuevo; solo si se guardó, se vacía el viejo (nada se pierde a medias)
    var saved = await window.vaultSaveMessages(nx, merged);
    if (saved === false) throw new Error('no se pudo guardar el chat unido');
    await window.vaultSaveMessages(oldNx, []);
    var all = _getBLEContacts(), oc = all.find(function(c) { return _normId(c.nexoId || c.deviceUUID) === oldNx; }), nc = all.find(function(c) { return _normId(c.nexoId || c.deviceUUID) === nx; });
    if (oc && nc) {
      if (oc.pinned && !nc.pinned) nc.pinned = oc.pinned;
      nc.unreadCount = (nc.unreadCount || 0) + (oc.unreadCount || 0);
      _saveBLEContacts(all);
    }
    [self._lostPeers, self._pendingWake, self._resendBackoff, self._nexoIdToMac].forEach(function(m) { try { if (m && typeof m.delete === 'function') m.delete(oldNx); } catch (e) {} });
    self.removeContact(oldNx);
    var last = merged[merged.length - 1];
    if (last && typeof self.noteContactMessage === 'function') self.noteContactMessage(nx, _messagePreview(last.content || last.text, last.attachmentType), last.timestamp);
    console.log('[ADD] Unido ' + oldNx + ' → ' + nx + ' (mismo teléfono reinstalado): ' + a.length + ' mensaje(s) pasados');
    try { _showToast(t('merge_reinstall_done', 'Listo: el chat anterior pasó a este contacto.'), 'info'); } catch (e) {}
    _safeDispatchEvent('nexo:vault:messagesLoaded', { contactId: nx });
    self.renderContactsList();
    if (typeof self._resendPendingMessages === 'function') self._resendPendingMessages(nx);
    return true;
  },

  getContacts() { return _getBLEContacts(); },

  getContactByUUID(deviceUUID) { return _getContactByUUID(deviceUUID); }
};
