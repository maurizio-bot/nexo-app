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
// 3069 (desatasco, resync.js): lo ya contado se guarda en el teléfono (los últimos SEEN_KEEP). Tras reiniciar, un mensaje que el otro
// REENVÍA (desatasco del cifrado, o cualquier reenvío por id) y que ya estaba aquí no vuelve a avisar ni a sumar «no leídos»
var SEEN_FILE = 'nexo_notify_seen.json', SEEN_KEEP = 500;
// 3158 (PENDIENTES 13-11, leidoaviso.js): los msgId SIN LEER por chat también se guardan. Si Android mata la app después de avisar, al
// tocar el aviso la app arranca de cero y abre el chat: sin esto no quedaba nada que confirmar (vivían solo en memoria; el contador
// sí estaba guardado) y el que escribió veía «entregado» para siempre
var UNREAD_FILE = 'nexo_notify_unread.json', UNREAD_CHATS = 100;

function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _call(name, args) {
  var pl = _plugin();
  if (!pl || typeof pl[name] !== 'function') return Promise.resolve(null);
  try { return Promise.resolve(pl[name](args || {})).catch(function() { return null; }); } catch (e) { return Promise.resolve(null); }
}
function _visible() { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; }
// Dueño 14-11 (APK 3052: «a pantalla apagada no suena ni hay notificaciones; a pantalla encendida llegan puntuales»): el chat
// ABIERTO calla su aviso solo en un PARPADEO a segundo plano, como el nativo (BgNotifyPolicy.OPEN_CHAT_GRACE_MS, 3086). Pasado ese
// margen (pantalla apagada, otra app encima) avisa como cualquier otro chat.
var OPEN_CHAT_GRACE_MS = 15000;

export class Notifier {
  constructor(opts) {
    this.ble = opts.ble;                       // () => bleInterface
    this.currentChat = opts.currentChat;       // () => NEXO ID del chat abierto (o null)
    this.hidePreview = opts.hidePreview || function() { return false; };
    this.muted = opts.muted || function() { return false; };   // 3219: chat silenciado (chat_mute.js): cuenta como no leído, sin aviso
    this.sendRead = opts.sendRead;             // (nexoId, msgId) => confirmación de leído
    this.seen = new Map();                     // msgId de lo ya contado
    this.notified = new Set();                 // chats con notificación puesta
    this.unreadIds = new Map();                // chat → msgId sin leer (al abrirlo se confirma su lectura)
    this._seenWait = null;                     // 3069: lo que llega antes de leer lo guardado espera (un instante)
    var self = this;
    this._loadSeen();
    this._hiddenAt = _visible() ? 0 : Date.now(); // desde cuándo la app no está a la vista (0 = a la vista)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', function() {
      if (_visible()) { self._hiddenAt = 0; self.onVisible(); } else if (!self._hiddenAt) self._hiddenAt = Date.now();
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('nexo:unread', function(e) { self._onUnread((e && e.detail) || {}); });
      // #dueño 08-11: avisar al NATIVO qué chat está ABIERTO, para que el aviso de respaldo (el que da el nativo cuando el
      // teléfono congela la app en 2.º plano) NUNCA avise de la persona que tenés en pantalla. El nativo no lo sabía por su
      // cuenta (el chat abierto vivía solo en el JS) → podía asomar un aviso del chat abierto en un parpadeo a segundo plano.
      window.addEventListener('nexo:ble:openChat', function(e) {
        var d = (e && e.detail) || {};
        var cid = _nid(d.contactId || (d.contact && (d.contact.nexoId || d.contact.deviceUUID || d.contact.id)) || '');
        _call('setActiveChat', { chatId: cid });
      });
      window.addEventListener('nexo:ble:closeChat', function() { _call('setActiveChat', { chatId: '' }); });
    }
  }

  _loadSeen() {
    var self = this, pl = _plugin();
    if (!pl || typeof pl.loadFromFile !== 'function') return;
    self._seenWait = [];
    var done = function() { var q = self._seenWait || []; self._seenWait = null; q.forEach(function(m) { self.incoming(m); }); };
    var t = setTimeout(done, 3000); // sin respuesta del disco: no se retiene nada más
    var pSeen = Promise.resolve(pl.loadFromFile({ filename: SEEN_FILE })).then(function(r) {
      if (r && r.exists && r.content) {
        var arr = JSON.parse(r.content);
        if (Array.isArray(arr)) arr.forEach(function(k) { if (typeof k === 'string' && !self.seen.has(k)) self.seen.set(k, 0); });
      }
    }).catch(function() {});
    var pUnread = Promise.resolve(pl.loadFromFile({ filename: UNREAD_FILE })).then(function(r) { // 3158: lo guardado va antes de lo nuevo
      var o = r && r.exists && r.content ? JSON.parse(r.content) : null;
      if (o && typeof o === 'object') Object.keys(o).forEach(function(cid) {
        var cur = self.unreadIds.get(cid) || [];
        if (Array.isArray(o[cid])) self.unreadIds.set(cid, o[cid].filter(function(id) { return typeof id === 'string' && cur.indexOf(id) < 0; }).concat(cur).slice(-50));
      });
    }).catch(function() {});
    Promise.all([pSeen, pUnread]).then(function() { clearTimeout(t); if (self._seenWait) done(); });
  }
  // 3158: guarda/añade un msgId sin leer del chat (el «leído» sale al abrirlo) y lo deja en el teléfono enseguida
  _keepUnread(cid, msgId) {
    var ids = this.unreadIds.get(cid) || [];
    ids.push(msgId);
    if (ids.length > 50) ids.shift();
    this.unreadIds.set(cid, ids);
    this._saveUnreadSoon();
  }
  _saveUnreadSoon() {
    var self = this;
    if (self._unreadT) return;
    self._unreadT = setTimeout(function() {
      self._unreadT = null;
      var o = {}, keys = Array.from(self.unreadIds.keys());
      keys.slice(Math.max(0, keys.length - UNREAD_CHATS)).forEach(function(k) { o[k] = self.unreadIds.get(k); });
      _call('saveToFile', { filename: UNREAD_FILE, content: JSON.stringify(o) });
    }, 1000);
  }
  _saveSeenSoon() {
    var self = this;
    if (self._seenT) return;
    self._seenT = setTimeout(function() {
      self._seenT = null;
      var keys = Array.from(self.seen.keys());
      _call('saveToFile', { filename: SEEN_FILE, content: JSON.stringify(keys.slice(Math.max(0, keys.length - SEEN_KEEP))) });
    }, 3000);
  }

  // Mensaje recibido. m: { cid, name, msgId, preview }
  incoming(m) {
    var cid = _nid(m && m.cid);
    if (!cid) return;
    if (this._seenWait) { this._seenWait.push(m); return; }
    var key = cid + '|' + (m.msgId || '');
    if (m.msgId) {
      if (this.seen.has(key)) return;
      this.seen.set(key, Date.now());
      if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.keys().next().value);
      this._saveSeenSoon();
    }
    // #dueño 08-11: el chat que tenés ABIERTO nunca avisa ni suma no-leídos, AUNQUE la app esté un instante en segundo plano
    // (un parpadeo del sistema). Al volver ya ves el mensaje, así que una notificación de la persona que estás leyendo no
    // tiene sentido y molesta. Antes el corte solo valía con la app A LA VISTA (open && _visible): abierto + app oculta
    // sumaba no-leído y mandaba notificación de ese chat. Ahora: con el chat abierto se corta (a la vista o en un parpadeo, abajo). La confirmación de
    // leído sale al toque si la app está a la vista; en segundo plano se guarda y se manda al volver (onVisible → _onUnread).
    // 14-11: «siempre» era demasiado: con la pantalla apagada y la app aún despierta, el chat abierto callaba para siempre (el
    // vivo recibió y confirmó 10 textos sin un solo aviso). Ahora solo a la vista o en un parpadeo (< 15 s) a segundo plano.
    var open = _nid(this.currentChat()) === cid && (_visible() || (this._hiddenAt > 0 && Date.now() - this._hiddenAt < OPEN_CHAT_GRACE_MS));
    if (open) {
      if (m.msgId) {
        if (_visible() && this.sendRead) this.sendRead(cid, m.msgId);
        else if (this.sendRead) this._keepUnread(cid, m.msgId);
      }
      return;
    }
    if (m.msgId) this._keepUnread(cid, m.msgId);
    var bi = this.ble();
    var count = bi && typeof bi.bumpUnread === 'function' ? bi.bumpUnread(cid) : 0;
    // Notificación del teléfono solo con la app en segundo plano (a la vista ya se ve la burbuja numerada)
    // 3219: un chat SILENCIADO no avisa (ni suena ni vibra); el número de no leídos sí sube (en gris en la lista)
    if (!_visible() && this.muted(cid)) { console.log('[NOTIF] ' + cid + ' está silenciado: sin aviso'); return; }
    if (!_visible()) {
      this.notified.add(cid);
      _call('notifyMessage', { chatId: cid, name: m.name || 'NEXO', msgId: m.msgId || String(Date.now()), text: this.hidePreview(cid) ? '' : (m.preview || ''), count: count });
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
    // 3158: con la app recién arrancada (abrir desde el aviso) se espera a tener lo sin leer guardado (un instante)
    if (this._seenWait) { var me = this; setTimeout(function() { me._onUnread(d); }, 200); return; }
    var ids = this.unreadIds.get(cid) || [];
    if (this.unreadIds.delete(cid)) this._saveUnreadSoon();
    var self = this;
    if (this.sendRead) ids.forEach(function(id) { self.sendRead(cid, id); });
    // #dueño 04-11: al abrir/leer un chat con la app a la vista se quita SIEMPRE su notificación del teléfono, aunque
    // la haya puesto la parte NATIVA (aviso de respaldo cuando el teléfono congela la app en 2.º plano) y por eso no
    // esté en this.notified. Antes solo se quitaba la que puso el JS, así que en esos teléfonos quedaba el aviso del
    // chat que YA estás leyendo. Además syncNative() reconcilia el resto (número del icono y otras notificaciones):
    // sólo corría al volver a la vista, NO al entrar a un chat estando ya a la vista (navegar de la lista al chat).
    this.notified.delete(cid);
    _call('clearChatNotification', { chatId: cid });
    this.syncNative();
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
