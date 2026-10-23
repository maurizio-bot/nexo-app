// Relé Nostr local para las pruebas (NIP-01 con NIP-40 caducidad y NIP-42 identificación): el mismo protocolo que los
// relés públicos (relay.damus.io, nos.lol…), que desde este entorno no se alcanzan. Comprueba id y firma de cada
// evento, rechaza los mayores que maxEventSize (como strfry, 64 KB), guarda lo que no ha caducado y lo reparte a las
// suscripciones (filtros kinds, #p, since, until, ids, authors, limit).
// opts: { maxEventSize, authRequired (para leer kind 1059 hay que identificarse con la clave de la etiqueta p),
//         latencyMs, dropEveryN (pierde un evento de cada N al repartir) }
'use strict';
const path = require('path');
const WebSocket = require('ws');
const deps = path.join(__dirname, '.deps/node_modules');

let noble = null;
async function loadNoble() {
  if (noble) return noble;
  const { pathToFileURL } = require('url');
  const sec = await import(pathToFileURL(path.join(deps, '@noble/curves/secp256k1.js')).href);
  const sha = await import(pathToFileURL(path.join(deps, '@noble/hashes/sha2.js')).href);
  const utils = await import(pathToFileURL(path.join(deps, '@noble/hashes/utils.js')).href);
  noble = { schnorr: sec.schnorr, sha256: sha.sha256, hex: utils.bytesToHex, unhex: utils.hexToBytes };
  return noble;
}

class NostrRelay {
  constructor(opts = {}) {
    this.opts = Object.assign({ maxEventSize: 65536, authRequired: false, latencyMs: 30 }, opts);
    this.events = [];
    this.stats = { published: 0, rejected: [], delivered: 0, auths: 0, conns: 0 };
  }
  async start(port = 0) {
    await loadNoble();
    this.wss = new WebSocket.Server({ port });
    await new Promise((r) => this.wss.on('listening', r));
    this.url = 'ws://127.0.0.1:' + this.wss.address().port;
    this.wss.on('connection', (ws) => this._conn(ws));
    return this.url;
  }
  stop() { if (this.wss) this.wss.clients.forEach((c) => c.terminate()); return new Promise((r) => (this.wss ? this.wss.close(() => r()) : r())); }
  // Cortar las conexiones de un "teléfono" (pruebas): los clientes se reconectan solos
  dropAll() { this.wss.clients.forEach((c) => c.terminate()); }

  _valid(ev) {
    const { schnorr, sha256, hex, unhex } = noble;
    if (!ev || typeof ev.id !== 'string' || typeof ev.pubkey !== 'string' || typeof ev.sig !== 'string') return 'invalid: campos';
    const ser = JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
    if (hex(sha256(new TextEncoder().encode(ser))) !== ev.id) return 'invalid: id';
    try { if (!schnorr.verify(unhex(ev.sig), unhex(ev.id), unhex(ev.pubkey))) return 'invalid: firma'; } catch (e) { return 'invalid: firma'; }
    return null;
  }
  _expired(ev, now) { const t = (ev.tags || []).find((x) => x[0] === 'expiration'); return t && Number(t[1]) <= now; }
  _match(f, ev) {
    if (f.ids && !f.ids.includes(ev.id)) return false;
    if (f.kinds && !f.kinds.includes(ev.kind)) return false;
    if (f.authors && !f.authors.includes(ev.pubkey)) return false;
    if (f.since && ev.created_at < f.since) return false;
    if (f.until && ev.created_at > f.until) return false;
    for (const k of Object.keys(f)) {
      if (k[0] !== '#') continue;
      const name = k.substring(1), vals = f[k];
      if (!(ev.tags || []).some((t) => t[0] === name && vals.includes(t[1]))) return false;
    }
    return true;
  }
  _canRead(ws, ev) {
    if (!this.opts.authRequired || ev.kind !== 1059) return true;
    const p = (ev.tags || []).filter((t) => t[0] === 'p').map((t) => t[1]);
    return p.some((x) => ws.authed.has(x));
  }
  _conn(ws) {
    this.stats.conns++;
    ws.subs = new Map(); ws.authed = new Set();
    ws.challenge = Math.random().toString(36).substring(2);
    const send = (m) => setTimeout(() => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }, this.opts.latencyMs);
    ws.sendM = send;
    if (this.opts.authRequired) send(['AUTH', ws.challenge]);
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(String(data)); } catch (e) { send(['NOTICE', 'invalid json']); return; }
      if (!Array.isArray(m)) return;
      const now = Math.floor(Date.now() / 1000);
      if (m[0] === 'EVENT') {
        const ev = m[1], size = String(data).length;
        if (size > this.opts.maxEventSize) { this.stats.rejected.push('grande ' + size); send(['OK', ev && ev.id, false, 'invalid: event too large']); return; }
        const bad = this._valid(ev);
        if (bad) { this.stats.rejected.push(bad); send(['OK', ev && ev.id, false, bad]); return; }
        if (this._expired(ev, now)) { send(['OK', ev.id, false, 'invalid: expired']); return; }
        if (!this.events.some((x) => x.id === ev.id)) {
          this.events.push(ev); this.stats.published++;
          this.wss.clients.forEach((c) => c.subs && c.subs.forEach((filters, sub) => {
            if (filters.some((f) => this._match(f, ev)) && this._canRead(c, ev)) {
              this.stats.delivered++;
              if (this.opts.dropEveryN && this.stats.delivered % this.opts.dropEveryN === 0) return;
              c.sendM(['EVENT', sub, ev]);
            }
          }));
        }
        send(['OK', ev.id, true, '']);
      } else if (m[0] === 'REQ') {
        const sub = m[1], filters = m.slice(2);
        if (this.opts.authRequired && !ws.authed.size) { send(['CLOSED', sub, 'auth-required: identifícate para leer mensajes privados']); return; }
        ws.subs.set(sub, filters);
        const list = this.events.filter((ev) => !this._expired(ev, now) && filters.some((f) => this._match(f, ev)) && this._canRead(ws, ev));
        list.sort((a, b) => a.created_at - b.created_at).forEach((ev) => send(['EVENT', sub, ev]));
        send(['EOSE', sub]);
      } else if (m[0] === 'CLOSE') {
        ws.subs.delete(m[1]);
      } else if (m[0] === 'AUTH') {
        const ev = m[1], bad = this._valid(ev);
        const tags = (ev && ev.tags) || [];
        const okCh = tags.some((t) => t[0] === 'challenge' && t[1] === ws.challenge);
        if (!bad && ev.kind === 22242 && okCh) { ws.authed.add(ev.pubkey); this.stats.auths++; send(['OK', ev.id, true, '']); }
        else send(['OK', ev && ev.id, false, 'auth-required: ' + (bad || 'reto incorrecto')]);
      }
    });
  }
}

module.exports = { NostrRelay };
