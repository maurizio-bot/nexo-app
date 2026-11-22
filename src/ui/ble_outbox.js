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
import { BLE_STATES, _hasNativeMethod, _normId, _safeNativeCall } from './ble_helpers.js';
import { ridKey, ridEpochSeconds } from './ble_rid.js';

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
      // Al arrancar: lo que el nativo guardó de la sesión anterior (la app pudo morir con mensajes en la bandeja). Se miran esos chats y
      // la lista se rehace con lo que SIGUE pendiente (lo entregado, borrado o fallido sale de la bandeja).
      setTimeout(function() { self._outboxAdopt(); }, 8000);
      window.addEventListener('nexo:ble:ackStatus', function(e) {
        var d = e && e.detail;
        if (d && d.msgId && (d.status === 'sent' || d.status === 'delivered' || d.status === 'read')) self._outboxDrop(d.msgId);
        else if (d && d.msgId && d.status === 'pending') self._outboxSoon('un mensaje quedó pendiente'); // también con la app ya oculta
      });
    } catch (e) {}
  },

  _outboxAdopt() {
    var self = this, pl = self.nativePlugin;
    if (!pl || !_hasNativeMethod(pl, 'netOutboxList')) return Promise.resolve(0);
    return _safeNativeCall(pl, 'netOutboxList', {}).then(function(r) {
      var list = (r && Array.isArray(r.items)) ? r.items : [];
      if (!list.length) return 0;
      var nxs = self._outboxNx || (self._outboxNx = new Set());
      list.forEach(function(x) { if (x && x.nx) nxs.add(_normId(x.nx)); });
      if (!self._outboxSig) self._outboxSig = list.map(function(x) { return x.id; }).join(',');
      console.log('[NET] Bandeja de salida: el teléfono tenía ' + list.length + ' mensaje(s) a su cargo de antes: se revisa cuáles siguen pendientes'); // i18n-ok: registro
      return self._outboxSync('al arrancar');
    }).catch(function() { return 0; });
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
      if (p.length > OUT_P_MAX) return { skip: true }; // no cabe: lo manda la app
      var peer = self.net && self.net.peers && self.net.peers.get(nx);
      var it = { id: id, nx: nx, p: p, at: Number(ts) || Date.now(), wk: (peer && peer.fcmToken) || '' };
      cache.set(id, it);
      return it;
    }).catch(function() { return null; });
  },

  // Deja en el nativo la lista entera de lo que aún no salió (reemplaza a la anterior). Devuelve cuántos.
  _outboxSync(why) {
    var self = this, pl = self.nativePlugin;
    if (!pl || !_hasNativeMethod(pl, 'netOutboxSet') || !self.net) return Promise.resolve(0);
    if (self._outboxBusy) { self._outboxAgain = why || 'otra vez'; return Promise.resolve(0); }
    self._outboxBusy = true;
    var items = [], seen = {}, broke = false;
    var add = function(it) {
      if (!it) { broke = true; return; }  // no se pudo armar (clave aún no lista…): esta vuelta no se toca la lista del nativo
      if (!it.skip && !seen[it.id] && items.length < OUT_MAX) { seen[it.id] = 1; items.push(it); }
    };
    var work = Promise.resolve();
    var netNx = {}, cand = {}, pubs = {};
    // 3269: cualquier contacto con clave (no solo los de internet): por Bluetooth el nativo no necesita nada más; por internet solo
    // sube lo de quienes tienen secreto de pareja (los demás esperan en la bandeja)
    try { (self.getBLEContacts() || []).forEach(function(c) { var nx = _normId(c && (c.nexoId || c.deviceUUID)); if (c && c.publicKey && !c.pendingKey && /^nx[0-9a-z]{8}$/.test(nx)) { netNx[nx] = 1; pubs[nx] = c.publicKey; } }); } catch (e) {}
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
      if (broke) { // se reintenta con calma (2 s, 4 s… hasta 1 min; 8 veces): la próxima vez que la app se oculte se vuelve a intentar igual
        self._outboxBroke = (self._outboxBroke || 0) + 1;
        if (self._outboxBroke <= 8) setTimeout(function() { self._outboxSync('reintento'); }, Math.min(60000, 1000 * Math.pow(2, self._outboxBroke)));
        return items.length;
      }
      self._outboxBroke = 0;
      var cache = self._outboxPk || (self._outboxPk = new Map());
      cache.forEach(function(v, k) { if (!seen[k]) cache.delete(k); });
      var sig = items.map(function(x) { return x.id; }).join(',');
      // 3269: los enlaces Bluetooth LISTOS de esos contactos (ya identificados por la app): por ellos también sale lo pendiente
      var links = [], want = {};
      items.forEach(function(x) { want[x.nx] = 1; });
      try {
        if (items.length && self._macToNexoId) self._macToNexoId.forEach(function(nx, mac) {
          var st = self._getDeviceState(mac) || {};
          if (want[_normId(nx)] && (st.state === BLE_STATES.READY_TO_CHAT || st.state === BLE_STATES.NOTIFICATIONS_READY) && links.length < 64) links.push({ mac: mac, nx: _normId(nx) });
        });
      } catch (e) {}
      var lsig = links.map(function(l) { return l.mac; }).sort().join(',');
      if (sig === (self._outboxSig || '') && (!items.length || lsig === (self._outboxLinks || ''))) return items.length;
      // 3279: la clave de los códigos rotativos de cada contacto con algo pendiente. El nativo busca a ese contacto escaneando y lo que
      // ve en el aire es su código de los 15 min, no su NEXO ID: con esta clave (la misma con la que la app lo reconoce, sale de su clave
      // PÚBLICA) lo reconoce él también (OutboxRid.kt). Sin ella el nativo no abría nunca el enlace en teléfonos reales (3271).
      var rk = {}, rkWork = Promise.resolve(), rkc = self._outboxRk || (self._outboxRk = new Map());
      Object.keys(want).forEach(function(nx) {
        var pub = pubs[nx], k = nx + ':' + pub;
        if (!pub) return;
        if (rkc.has(k)) { rk[nx] = rkc.get(k); return; }
        rkWork = rkWork.then(function() { return ridKey(pub); }).then(function(h) { if (h) { rkc.set(k, h); rk[nx] = h; } }).catch(function() {});
      });
      return rkWork.then(function() {
        return _safeNativeCall(pl, 'netOutboxSet', { items: items, links: links, rk: rk, ep: ridEpochSeconds(), f: self.net.fcmToken || '', url: (typeof self.net.senderUrl === 'function' && self.net.senderUrl()) || '' });
      }).then(function(r) {
        self._outboxSig = sig; self._outboxLinks = lsig;
        console.log('[NET] Bandeja de salida: ' + items.length + ' texto(s) pendiente(s) a cargo del teléfono (' + (why || 'puesta al día') + '): salen por internet aunque NEXO se duerma'); // i18n-ok: registro
        return items.length;
      });
    }).catch(function() { return 0; }).then(function(n) {
      self._outboxBusy = false;
      if (self._outboxAgain) { var w = self._outboxAgain; self._outboxAgain = null; self._outboxSoon(w); }
      return n;
    });
  },

  // Ese mensaje ya salió (✓) o se confirmó (✓✓): el nativo deja de encargarse. force = se borró (chat_actions): se le dice al nativo
  // aunque esta sesión de la app no se lo haya entregado (pudo quedar guardado de una sesión anterior).
  _outboxDrop(id, force) {
    var self = this, pl = self.nativePlugin;
    if (!id) return;
    var had = !!self._outboxSig && (',' + self._outboxSig + ',').indexOf(',' + id + ',') >= 0;
    if (!had && !force) return;
    if (had) self._outboxSig = self._outboxSig.split(',').filter(function(x) { return x !== id; }).join(',');
    if (self._outboxPk) self._outboxPk.delete(id);
    if (pl && _hasNativeMethod(pl, 'netOutboxDrop')) _safeNativeCall(pl, 'netOutboxDrop', { id: id }).catch(function() {});
  }
};
