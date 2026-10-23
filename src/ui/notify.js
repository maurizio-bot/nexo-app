/**
 * NEXO — Mensajes sin leer y notificaciones (v1.0, ronda 2750)
 *
 * Un único punto por el que pasan todos los mensajes recibidos (texto corto o largo, foto, vídeo, archivo; por
 * Bluetooth, Wi-Fi, internet o Jump): main.js llama a incoming() desde _handleIncomingMessage.
 * - Si el chat de ese contacto está abierto y la app a la vista: no cuenta como no leído.
 * - Si no: suma 1 al contador del chat (la burbuja numerada de la lista) y, con la app en segundo plano, avisa con
 *   una notificación del teléfono (una por chat, con el número de mensajes; el icono de la app muestra ese número).
 * - La confirmación de "leído" de un chat abierto solo sale con la app a la vista; si llega en segundo plano espera.
 * - Al abrir un chat o volver a la app con él abierto: contador a 0 y se quita su notificación.
 * Con el bloqueo de la app activado la notificación no lleva el texto del mensaje.
 */
var MAX_SEEN = 2000;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _call(name, args) {
  var pl = _plugin();
  if (!pl || typeof pl[name] !== 'function') return Promise.resolve(null);
  try { return Promise.resolve(pl[name](args || {})).catch(function() { return null; }); } catch (e) { return Promise.resolve(null); }
}
function _visible() { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; }

export class Notifier {
  constructor(opts) {
    this.ble = opts.ble;                       // () => bleInterface
    this.currentChat = opts.currentChat;       // () => NEXO ID del chat abierto (o null)
    this.hidePreview = opts.hidePreview || function() { return false; };
    this.sendRead = opts.sendRead;             // (nexoId, msgId) => confirmación de leído
    this.seen = new Map();                     // msgId de lo ya contado
    this.notified = new Set();                 // chats con notificación puesta
    this.unreadIds = new Map();                // chat → msgId sin leer (al abrirlo se confirma su lectura)
    var self = this;
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function() { if (_visible()) self.onVisible(); });
    if (typeof window !== 'undefined') window.addEventListener('nexo:unread', function(e) { self._onUnread((e && e.detail) || {}); });
  }

  // Mensaje recibido. m: { cid, name, msgId, preview }
  incoming(m) {
    var cid = _nid(m && m.cid);
    if (!cid) return;
    var key = cid + '|' + (m.msgId || '');
    if (m.msgId) {
      if (this.seen.has(key)) return;
      this.seen.set(key, Date.now());
      if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.keys().next().value);
    }
    var open = _nid(this.currentChat()) === cid;
    if (open && _visible()) {
      if (m.msgId && this.sendRead) this.sendRead(cid, m.msgId);
      return;
    }
    if (m.msgId) {
      var ids = this.unreadIds.get(cid) || [];
      ids.push(m.msgId);
      if (ids.length > 50) ids.shift();
      this.unreadIds.set(cid, ids);
    }
    var bi = this.ble();
    var count = bi && typeof bi.bumpUnread === 'function' ? bi.bumpUnread(cid) : 0;
    // Notificación del teléfono solo con la app en segundo plano (a la vista ya se ve la burbuja numerada)
    if (!_visible()) {
      this.notified.add(cid);
      _call('notifyMessage', { chatId: cid, name: m.name || 'NEXO', msgId: m.msgId || String(Date.now()), text: this.hidePreview() ? '' : (m.preview || ''), count: count });
    }
  }

  // La app vuelve a estar a la vista: el chat abierto queda leído
  onVisible() {
    var cid = _nid(this.currentChat());
    if (cid) {
      var bi = this.ble();
      if (bi && typeof bi.clearUnread === 'function') bi.clearUnread(cid); else this._onUnread({ nexoId: cid, count: 0 });
    }
    this.syncNative();
  }

  // Cambió el contador de un chat (lo avisa ble_interface). A 0 (chat abierto): se confirma la lectura de lo que
  // estaba sin leer —solo con la app a la vista— y se quita su notificación
  _onUnread(d) {
    var cid = _nid(d.nexoId);
    if (!cid || d.count > 0) return;
    if (!_visible()) return;
    var ids = this.unreadIds.get(cid) || [];
    this.unreadIds.delete(cid);
    var self = this;
    if (this.sendRead) ids.forEach(function(id) { self.sendRead(cid, id); });
    if (this.notified.has(cid)) { this.notified.delete(cid); _call('clearChatNotification', { chatId: cid }); }
  }

  // Android 13+: pedir el permiso de notificaciones si falta (una vez por arranque)
  ensurePermission() {
    return _call('ensureNotificationPermission').then(function(r) {
      if (r && r.granted === false) console.warn('[NOTIF] Notificaciones no permitidas: no se avisará de mensajes con la app cerrada');
      return r;
    });
  }

  // Los contadores de la app mandan: el teléfono ajusta o quita las notificaciones que haya (también las que puso
  // la parte nativa con la app en segundo plano) y el número del icono
  syncNative() {
    var bi = this.ble();
    var list = bi && typeof bi.unreadSummary === 'function' ? bi.unreadSummary() : [];
    return _call('syncUnread', { chats: list });
  }
}

export function createNotifier(opts) { return new Notifier(opts); }
