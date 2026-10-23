/**
 * NEXO — Envíos por Jump (métodos de BLEInterface sacados de ble_interface.js en la ronda 2752, sin cambios): pendientes
 * por otro teléfono, reenvío directo cuando vuelve el contacto y claves por la ruta.
 */
import { e2eMyPublicKey, initE2E } from '../vault/e2e_crypto.js';
import { ratchetMyBundle, ratchetPeerPqId } from '../vault/e2e_ratchet.js';
import { _failStatus, _hydrateAttachments, _normId, _normMac, _vaultLoadMessages, _vaultUpdateMessageStatus } from './ble_helpers.js';


export const BLE_JUMP_METHODS = {
  _flushPendingViaRelay(nexoId) {
    var self = this;
    var nx = _normId(nexoId);
    var hop = self.relay && self.relay.relayHop(nx);
    if (!hop) return;
    var keys = ['nx:' + nx];
    var mac = self._nexoIdToMac.get(nx);
    if (mac) keys.push(_normMac(mac));
    var queue = [];
    keys.forEach(function(k) {
      var q = self._pendingMessageQueue.get(k);
      if (q && q.length) { queue = queue.concat(q); self._pendingMessageQueue.delete(k); }
    });
    if (queue.length) console.log('[JUMP] ' + queue.length + ' en cola para ' + nx + ' salen por ' + hop.via);
    queue.forEach(function(item) {
      self._sendViaRelay(nx, item.content, item.messageId, item.seq)
        .then(function() { _vaultUpdateMessageStatus(nx, item.messageId, 'sent'); if (item.resolve) item.resolve(); })
        .catch(function(err) {
          var q = self._pendingMessageQueue.get('nx:' + nx) || [];
          q.push(item);
          self._pendingMessageQueue.set('nx:' + nx, q);
          _vaultUpdateMessageStatus(nx, item.messageId, _failStatus(err));
        });
    });
    self._resendPendingMessages(nx);
  },

  _sendViaRelay(nexoId, content, msgId, seq) {
    var self = this;
    var nx = _normId(nexoId);
    var hop = self.relay && self.relay.relayHop(nx);
    if (!hop || !self.ackSystem) return Promise.reject(Object.assign(new Error('Sin ruta'), { code: 'PEER_ABSENT' }));
    console.log('[JUMP] Enviando ' + msgId + ' a ' + nx + ' por ' + hop.via + ' (' + hop.hops + ' saltos)');
    self._noteRelayedOut(msgId, nx);
    if (content.length > 180) return self.ackSystem.sendChunkedMessage(hop.deviceId, content, { dst: nx }, msgId, seq);
    return self.ackSystem.sendWithRetry(hop.deviceId, content, msgId, seq, { dst: nx });
  },

  _noteRelayedOut(msgId, nexoId) {
    if (!msgId) return;
    this._relayedOut = this._relayedOut || new Map();
    this._relayedOut.set(msgId, { nx: _normId(nexoId), ts: Date.now() });
  },

  _resendRelayedDirect(nexoId, deviceId) {
    var self = this, nx = _normId(nexoId);
    if (!self._relayedOut || !self._relayedOut.size || !self.ackSystem) return;
    var ids = [];
    self._relayedOut.forEach(function(v, id) {
      if (Date.now() - v.ts > 86400000) self._relayedOut.delete(id);
      else if (v.nx === nx && Date.now() - v.ts > 3000) ids.push(id);
    });
    if (!ids.length) return;
    _vaultLoadMessages(nx).then(function(msgs) {
      return _hydrateAttachments((msgs || []).filter(function(m) {
        var id = m.msgId || m.messageId || m.id;
        if (ids.indexOf(id) < 0) return false;
        if (m.status === 'delivered' || m.status === 'read') { self._relayedOut.delete(id); return false; }
        return !self._isMsgInFlight(id);
      }));
    }).then(function(list) {
      (list || []).forEach(function(m) {
        var id = m.msgId || m.messageId || m.id;
        self._relayedOut.delete(id);
        console.log('[JUMP] ' + id + ' salió por un puente sin ✓✓: se reenvía directo a ' + nx);
        var p = (m.attachmentType && m.attachmentPayload)
          ? self.ackSystem.sendFile(deviceId, id, m.attachmentPayload, Object.assign({ type: m.attachmentType }, m.attachmentMeta || {}))
          : (String(m.content || '').length > 180
            ? self.ackSystem.sendChunkedMessage(deviceId, m.content, {}, id, m.seq)
            : self.ackSystem.sendWithRetry(deviceId, m.content || '', id, m.seq));
        p.catch(function() {});
      });
    }).catch(function() {});
  },

  _sendKxRouted(dst, request) {
    var self = this;
    var nx = _normId(dst);
    if (!nx || !self.relay) return;
    var key = 'r:' + nx + (request ? ':rq' : '');
    var now = Date.now();
    self._kxSentAt = self._kxSentAt || {};
    if (now - (self._kxSentAt[key] || 0) < 15000) return;
    self._kxSentAt[key] = now;
    initE2E().then(function() { return ratchetMyBundle(self._pqNeeded(nx)).catch(function() { return null; }); }).then(function(b2) {
      var pk = e2eMyPublicKey();
      if (!pk || !self.localNexoId) return;
      var pkt = { v: 1, type: 'kx', from: _normId(self.localNexoId), to: nx, pk: pk, msgId: 'kx_' + now, ss: 1, nt: 1, ph: ratchetPeerPqId(nx) };
      if (b2) pkt.b2 = b2;
      if (request) pkt.rq = 1;
      return self._sealObj(nx, pkt).then(function(o) { self.relay.sendRouted(o); });
    }).catch(function() {});
  }
};
