/**
 * 3268 (PRIORIDAD 1 del dueño, «Bluetooth entero en el servicio nativo», FASE 3; COLA 29): BANDEJA DE SALIDA nativa — lado de la app.
 *
 * Lo que fallaba (diagnósticos «pendiente_viejo» del 20 y 21-11): un texto que se quedó ⏳ porque en ese momento no había camino no
 * salía hasta que el usuario volvía a ABRIR NEXO: reenviar era cosa de esta página, y Android la duerme a los pocos segundos de
 * bloquear el teléfono, o la cierra. El servicio nativo sigue vivo y con internet (NetBg.kt), pero no sabía qué había pendiente.
 *
 * Ahora, cada vez que la app se oculta (y cuando un texto se queda sin camino), se le entrega al nativo la lista ENTERA de los textos
 * que aún no salieron, ya cifrados de punta a punta y en el MISMO sobre que el envío normal (_chatEnv): él los sube al buzón de los
 * relés en cuanto hay uno abierto e insiste hasta la ✓✓ (NetOutbox.kt). El nativo no ve el contenido ni tiene las claves del mensaje.
 * Al volver, la app sigue como siempre (un repetido no hace daño: el que recibe descarta por msgId y vuelve a confirmar).
 *
 * Entra: texto propio visible, ⏳ pendiente o a medio enviar, de un contacto con el que hay internet (clave de pareja). No entra (lo
 * sigue mandando la app): adjuntos, llamadas, acciones ocultas y textos de más de OUT_TXT_MAX caracteres.
 */
import { e2eAnyEncrypted, e2eSealText } from '../vault/e2e_proto.js';
import { e2eAvailable } from '../vault/e2e_crypto.js';
import { _hasNativeMethod, _normId, _safeNativeCall } from './ble_helpers.js';

var OUT_MAX = 100;          // como NetOutbox.MAX_ITEMS
var OUT_TXT_MAX = 12000;    // caracteres del texto: ya cifrado y en su sobre entra de sobra en un evento de relé (NetOutbox.MAX_P)
var OUT_P_MAX = 40000;      // NetOutbox.MAX_P
var OUT_SOON_MS = 400;

// ¿Este mensaje guardado es un texto que puede ir a la bandeja? (pura: bandeja.js)
export function outboxFits(m) {
  if (!m || m._own !== true || m.hidden === true) return false;
  if (m.status !== 'pending' && m.status !== 'sending') return false;
  if (m.attachmentType || m.attachmentRef || m.attachmentPayload || m._bigx) return false;
  var txt = m.content || m.text || '';
  if (typeof txt !== 'string' || !txt || txt.length > OUT_TXT_MAX) return false;
  if (txt.charAt(0) === '{') { try { var o = JSON.parse(txt); if (o && (o.type === 'attachment' || o.type === 'nexo_call' || o.type === 'nexo_gcall')) return false; } catch (e) {} }
  return true;
}

export const BLE_OUTBOX_METHODS = {
  // Se engancha una vez (ble_startup): al ocultarse la app, la bandeja al día; cuando un mensaje sale o se confirma, fuera de ella
  _outboxInit() {
    var self = this;
    if (self._outboxOn) return;
    self._outboxOn = true;
    try {
      if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'hidden') self._outboxSync('la app se oculta');
      });
      window.addEventListener('nexo:ble:ackStatus', function(e) {
        var d = e && e.detail;
        if (d && d.msgId && (d.status === 'sent' || d.status === 'delivered' || d.status === 'read')) self._outboxDrop(d.msgId);
        else if (d && d.msgId && d.status === 'pending') self._outboxSoon('un mensaje quedó pendiente'); // también con la app ya oculta
      });
    } catch (e) {}
  },

  // Ese contacto tiene textos pendientes sin camino (ble_messages: «sin enlace ni ruta»): que la bandeja los tome
  _outboxNote(nexoId) {
    var nx = _normId(nexoId);
    if (!nx) return;
    (this._outboxNx || (this._outboxNx = new Set())).add(nx);
    this._outboxSoon('pendientes sin camino');
  },

  // Varias peticiones seguidas = una puesta al día
  _outboxSoon(why) {
    var self = this;
    if (self._outboxT) return;
    self._outboxT = setTimeout(function() { self._outboxT = null; self._outboxSync(why); }, OUT_SOON_MS);
  },

  // El paquete de un texto para la bandeja: cifrado de punta a punta y en el sobre de siempre. Cada mensaje se cifra UNA vez (se guarda
  // en memoria mientras siga pendiente). enc = ya viene cifrado (un envío en curso); si no, se cifra aquí.
  _outboxItem(nx, id, txt, seq, ts, enc) {
    var self = this, ack = self.ackSystem;
    var cache = self._outboxPk || (self._outboxPk = new Map());
    if (cache.has(id)) return Promise.resolve(cache.get(id));
    if (!ack || !e2eAvailable()) return Promise.resolve(null);
    var sealed = enc ? Promise.resolve(enc)
      : e2eAnyEncrypted(txt) ? Promise.resolve(txt)
        : ack._ensurePeerKey('net:' + nx, null, nx).then(function(t) { return e2eSealText(t, txt, ack._outAd(t, id)); });
    return sealed.then(function(c) {
      var env = self._chatEnv(c, id, (typeof seq === 'number') ? seq : self.getNextSeq(), null);
      env.dn = nx; // a quién va (como _sendMessageNative: el que lo recibe lo ignora si no es él)
      var p = JSON.stringify(env);
      if (p.length > OUT_P_MAX) return null;
      var peer = self.net && self.net.peers && self.net.peers.get(nx);
      var it = { id: id, nx: nx, p: p, at: Number(ts) || Date.now(), wk: (peer && peer.fcmToken) || '' };
      cache.set(id, it);
      return it;
    }).catch(function() { return null; });
  },

  // Deja en el nativo la lista entera de lo que aún no salió (reemplaza a la anterior). Devuelve cuántos.
  _outboxSync(why) {
    var self = this, pl = self.nativePlugin;
    if (!pl || !_hasNativeMethod(pl, 'netOutboxSet') || !self.net || typeof self.net._netContacts !== 'function') return Promise.resolve(0);
    if (self._outboxBusy) { self._outboxAgain = why || 'otra vez'; return Promise.resolve(0); }
    self._outboxBusy = true;
    var items = [], seen = {};
    var add = function(it) { if (it && !seen[it.id] && items.length < OUT_MAX) { seen[it.id] = 1; items.push(it); } };
    var work = Promise.resolve();
    var netNx = {}, cand = {};
    try { self.net._netContacts().forEach(function(c) { netNx[_normId(c.nexoId || c.deviceUUID)] = 1; }); } catch (e) {}
    // De qué chats mirar: a quién se le mandó algo en esta sesión (_msgDest) y los que tienen pendientes sin camino (_outboxNote). No
    // se lee el historial de todos los contactos cada vez que la app se oculta.
    try { if (self._msgDest) self._msgDest.forEach(function(nx) { if (netNx[nx]) cand[nx] = 1; }); } catch (e) {}
    try { if (self._outboxNx) self._outboxNx.forEach(function(nx) { if (netNx[nx]) cand[nx] = 1; }); } catch (e) {}
    // lo guardado como pendiente (⏳) o a medio enviar de cada uno
    Object.keys(cand).forEach(function(nx) {
      work = work.then(function() {
        if (items.length >= OUT_MAX || typeof window.vaultLoadMessages !== 'function') return null;
        return window.vaultLoadMessages(nx).then(function(list) {
          var chain = Promise.resolve(), any = false;
          (list || []).forEach(function(m) {
            var id = m && (m.msgId || m.messageId || m.id);
            if (!id || !outboxFits(m)) return;
            if (self._callOut && self._callOut.has(id)) return; // una llamada vieja no debe sonar tarde
            if (self._quietOut && self._quietOut.has(id)) return;
            any = true;
            chain = chain.then(function() { return self._outboxItem(nx, id, m.content || m.text || '', m.seq, m.timestamp, null); }).then(add);
          });
          if (!any && self._outboxNx) self._outboxNx.delete(nx);
          return chain;
        }).catch(function() {});
      });
    });
    return work.then(function() {
      var cache = self._outboxPk || (self._outboxPk = new Map());
      cache.forEach(function(v, k) { if (!seen[k]) cache.delete(k); });
      var sig = items.map(function(x) { return x.id; }).join(',');
      if (sig === (self._outboxSig || '')) return items.length;
      return _safeNativeCall(pl, 'netOutboxSet', { items: items, f: self.net.fcmToken || '', url: (typeof self.net.senderUrl === 'function' && self.net.senderUrl()) || '' }).then(function(r) {
        self._outboxSig = sig;
        console.log('[NET] Bandeja de salida: ' + items.length + ' texto(s) pendiente(s) a cargo del teléfono (' + (why || 'puesta al día') + '): salen por internet aunque NEXO se duerma'); // i18n-ok: registro
        return items.length;
      });
    }).catch(function() { return 0; }).then(function(n) {
      self._outboxBusy = false;
      if (self._outboxAgain) { var w = self._outboxAgain; self._outboxAgain = null; self._outboxSoon(w); }
      return n;
    });
  },

  // Ese mensaje ya salió (✓) o se confirmó (✓✓): el nativo deja de encargarse
  _outboxDrop(id) {
    var self = this, pl = self.nativePlugin;
    if (!id || !self._outboxSig || (',' + self._outboxSig + ',').indexOf(',' + id + ',') < 0) return;
    self._outboxSig = self._outboxSig.split(',').filter(function(x) { return x !== id; }).join(',');
    if (self._outboxPk) self._outboxPk.delete(id);
    if (pl && _hasNativeMethod(pl, 'netOutboxDrop')) _safeNativeCall(pl, 'netOutboxDrop', { id: id }).catch(function() {});
  }
};
