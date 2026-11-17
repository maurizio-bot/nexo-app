// Relé Nostr local para las pruebas (NIP-01 con NIP-40 caducidad y NIP-42 identificación): el mismo protocolo que los
// relés públicos (relay.damus.io, nos.lol…), que desde este entorno no se alcanzan. Comprueba id y firma de cada
// evento, rechaza los mayores que maxEventSize (como strfry, 64 KB), guarda lo que no ha caducado y lo reparte a las
// suscripciones (filtros kinds, #p, since, until, ids, authors, limit).
// opts: { maxEventSize, authRequired (para leer kind 1059 hay que identificarse con la clave de la etiqueta p),
//         latencyMs, dropEveryN (pierde un evento de cada N al repartir) }
//         tamper(ev) → ev' | null: relé MALICIOSO para las pruebas de la Fase B — devuelve una copia alterada del evento que
//         sirve (contenido cambiado, mismo id) o null para servirlo intacto. Se aplica solo al SERVIR (lo guardado queda bien).
//         3151 (releprop.js, relé público «de verdad» frente al propio): connectDelayMs (lo que tarda en abrir la conexión: TLS y
//         un servidor lejano o cargado), rateLimit { perSec, burst } (eventos que acepta por conexión; los de más: OK false
//         «rate-limited»), bwBps (bytes por segundo por conexión, en cada sentido; lo que pasa se encola en orden).
//         stats.bytesOut / bytesIn: lo que mandó y recibió.
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
    const cd = this.opts.connectDelayMs || 0;
    this.wss = new WebSocket.Server(cd ? { port, verifyClient: (info, cb) => setTimeout(() => cb(true), cd) } : { port });
    await new Promise((r) => this.wss.on('listening', r));
    this.url = 'ws://127.0.0.1:' + this.wss.address().port;
    this.wss.on('connection', (ws, req) => { ws.tag = String((req && req.url) || ''); if (this._asleep && Array.from(this._asleep).some((t) => ws.tag.indexOf(t) >= 0)) ws.mute = true; this._conn(ws); });
    return this.url;
  }
  stop() { if (this.wss) this.wss.clients.forEach((c) => c.terminate()); return new Promise((r) => (this.wss ? this.wss.close(() => r()) : r())); }
  // Cortar las conexiones de un "teléfono" (pruebas): los clientes se reconectan solos
  dropAll() { this.wss.clients.forEach((c) => c.terminate()); }
  // Conexiones MUDAS (pruebas, diagnóstico S24 3010): las que ya están abiertas siguen abiertas pero el relé no lee ni manda
  // nada por ellas — como una conexión muerta tras un rato en segundo plano, que el teléfono aún cree abierta. Las nuevas van bien.
  muteAll() { this.wss.clients.forEach((c) => { c.mute = true; }); }
  // 3085: solo las de un teléfono (su dirección de relé lleva «?p=<nombre>»): las conexiones que quedan colgadas del Wi-Fi viejo
  muteTag(tag) { let n = 0; this.wss.clients.forEach((c) => { if ((c.tag || '').indexOf(tag) >= 0) { c.mute = true; n++; } }); return n; }
  // 3096: la app de un teléfono DUERME (su JS no corre): sus conexiones quedan mudas y las que intente abrir también, hasta wakeTag
  sleepTag(tag) { (this._asleep = this._asleep || new Set()).add(tag); return this.muteTag(tag); }
  wakeTag(tag) { if (this._asleep) this._asleep.delete(tag); }
  // 3178 (acuses.js): los EVENT que manda un teléfono se RECHAZAN (OK false, como el tope de un puente o un relé que limita)
  // aunque sigue recibiendo lo suyo: su confirmación no sale. acceptTag lo deshace.
  rejectTag(tag) { (this._reject = this._reject || new Set()).add(tag); }
  acceptTag(tag) { if (this._reject) this._reject.delete(tag); }
  // 3179 (blobpuente.js): a las conexiones de ese teléfono no se les sirven los trozos del buzón de archivos (kind) — como un
  // puente que no consigue pasarlos —; lo demás, sí. showTag lo deshace.
  hideTag(tag, kind) { (this._hide = this._hide || new Map()).set(tag, kind); }
  showTag(tag) { if (this._hide) this._hide.delete(tag); }
  _hidden(ws, ev) { if (!this._hide || !this._hide.size || !ev) return false; for (const [t, k] of this._hide) if ((ws.tag || '').indexOf(t) >= 0 && ev.kind === k) return true; return false; }

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
    const bw = this.opts.bwBps || 0, lat = this.opts.latencyMs;
    const out = (s) => { if (ws.readyState === 1 && !ws.mute) { ws.send(s); this.stats.bytesOut = (this.stats.bytesOut || 0) + s.length; } };
    // 3151: con bwBps, cola en orden: cada mensaje sale cuando «terminó de pasar» el anterior (un EVENT nunca después de su EOSE)
    ws.outQ = []; ws.outFree = 0;
    const pumpOut = () => {
      if (ws.outT || !ws.outQ.length) return;
      ws.outT = setTimeout(() => { ws.outT = null; const it = ws.outQ.shift(); if (it) out(it.s); pumpOut(); }, Math.max(0, ws.outQ[0].at - Date.now()));
    };
    const send = (m) => {
      if (!bw) { setTimeout(() => out(JSON.stringify(m)), lat); return; }
      const s = JSON.stringify(m), now = Date.now(), at = Math.max(now + lat, ws.outFree) + s.length * 1000 / bw;
      ws.outFree = at; ws.outQ.push({ s, at }); pumpOut();
    };
    ws.sendM = send;
    const rl = this.opts.rateLimit;
    ws.tokens = rl ? rl.burst : 0; ws.tokAt = Date.now();
    const allow = () => {
      if (!rl) return true;
      const now = Date.now(); ws.tokens = Math.min(rl.burst, ws.tokens + (now - ws.tokAt) * rl.perSec / 1000); ws.tokAt = now;
      if (ws.tokens < 1) { this.stats.rateLimited = (this.stats.rateLimited || 0) + 1; return false; }
      ws.tokens -= 1; return true;
    };
    if (this.opts.authRequired) send(['AUTH', ws.challenge]);
    ws.inQ = []; ws.inFree = 0;
    const pumpIn = () => {
      if (ws.inT || !ws.inQ.length) return;
      ws.inT = setTimeout(() => { ws.inT = null; const it = ws.inQ.shift(); if (it) handle(it.data); pumpIn(); }, Math.max(0, ws.inQ[0].at - Date.now()));
    };
    ws.on('message', (data) => {
      this.stats.bytesIn = (this.stats.bytesIn || 0) + String(data).length;
      if (!bw) { handle(data); return; }
      const at = Math.max(Date.now(), ws.inFree) + String(data).length * 1000 / bw;
      ws.inFree = at; ws.inQ.push({ data, at }); pumpIn();
    });
    const handle = (data) => {
      if (ws.mute) return;
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
        if (!allow()) { send(['OK', ev.id, false, 'rate-limited: slow down']); return; }
        if (this._reject && Array.from(this._reject).some((t) => (ws.tag || '').indexOf(t) >= 0)) { this.stats.rejected.push('tag'); send(['OK', ev.id, false, 'rate-limited: tope (prueba)']); return; }
        // honorDeletes (3075): como los relés reales (NIP-09), un evento kind 5 borra los eventos que cita (del mismo autor)
        if (this.opts.honorDeletes && ev.kind === 5) {
          const ids = (ev.tags || []).filter((t) => t[0] === 'e').map((t) => t[1]);
          const before = this.events.length;
          this.events = this.events.filter((x) => !(ids.indexOf(x.id) >= 0 && x.pubkey === ev.pubkey));
          this.stats.deleted = (this.stats.deleted || 0) + (before - this.events.length);
        }
        if (!this.events.some((x) => x.id === ev.id)) {
          this.events.push(ev); this.stats.published++;
          this.wss.clients.forEach((c) => c.subs && c.subs.forEach((filters, sub) => {
            if (filters.some((f) => this._match(f, ev)) && this._canRead(c, ev) && !this._hidden(c, ev)) {
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
        const list = this.events.filter((ev) => !this._expired(ev, now) && filters.some((f) => this._match(f, ev)) && this._canRead(ws, ev) && !this._hidden(ws, ev));
        list.sort((a, b) => a.created_at - b.created_at).forEach((ev) => { const served = (this.opts.tamper && this.opts.tamper(ev)) || ev; if (served !== ev) this.stats.tampered = (this.stats.tampered || 0) + 1; send(['EVENT', sub, served]); });
        this.stats.reqs = (this.stats.reqs || 0) + 1; if (filters.some((f) => f.ids)) this.stats.reqIds = (this.stats.reqIds || 0) + 1;
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
    };
  }
}

module.exports = { NostrRelay };
