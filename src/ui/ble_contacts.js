/**
 * NEXO — Contactos y no leídos (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752, sin cambios):
 * contadores de no leídos, último mensaje de cada chat, contactos compartidos, quitar y consultar contactos.
 */
import { _cut, _getBLEContacts, _getContactByUUID, _messagePreview, _normId, _removeBLEContact, _safeDispatchEvent, _saveBLEContacts, _vaultLoadMessages } from './ble_helpers.js';


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
    if ((c.lastMessageAt || 0) > t) return;
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
    (Array.isArray(list) ? list : []).forEach(function(c) {
      var id = String((c && c.nexoId) || '').trim();
      if (!/^NX[0-9A-Z]{8}$/i.test(id)) return;
      var nx = _normId(id);
      if (nx === me) return;
      var name = _cut(String((c && c.name) || '').replace(/[<>]/g, '').trim(), 40) || id.toUpperCase();
      var cur = contacts.find(function(x) { return _normId(x.nexoId || x.deviceUUID) === nx; });
      if (cur) {
        if (!cur.publicKey && c && typeof c.publicKey === 'string' && /^[A-Za-z0-9+/=]{80,100}$/.test(c.publicKey)) { cur.publicKey = c.publicKey; keyFilled = true; }
        if (c && c.b2) bundles.push([nx, c.b2]);
        res.existing.push(cur.name || name);
        return;
      }
      var pk = (c && typeof c.publicKey === 'string' && /^[A-Za-z0-9+/=]{80,100}$/.test(c.publicKey)) ? c.publicKey : '';
      contacts.push({
        nexoId: nx, deviceUUID: nx, name: name, deviceId: null, addedAt: Date.now(), lastSeen: 0,
        online: false, unreadCount: 0, lastMessage: '', isNewShared: !(opts && opts.quiet), sharedBy: _normId(sharedBy) || null,
        publicKey: pk, ss: pk && c.ss ? 1 : undefined, // v6.11.1: así el primer mensaje ya puede ir sellado
        nt: pk && c.nt ? 1 : undefined // v6.13.0: y por internet
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
    var contacts = _getBLEContacts().filter(function(c) { return !c.lastMessageAt && (c.nexoId || c.deviceUUID); });
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

  getContacts() { return _getBLEContacts(); },

  getContactByUUID(deviceUUID) { return _getContactByUUID(deviceUUID); }
};
