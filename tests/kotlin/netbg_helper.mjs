// Ayudante de NetBgTest (JVM): hace lo mismo que la app (net_link.js) con las mismas librerías (noble, WebCrypto).
//  node netbg_helper.mjs vectors  → JSON con firmas Schnorr, etiquetas del día, sobres y ids de evento de referencia
//  node netbg_helper.mjs relay    → arranca un relé Nostr local que exige identificación (NIP-42), escribe su URL y
//                                   publica lo que se le pide por la entrada estándar:
//                                   {"kraw":hex,"from":nx,"to":nx,"body":{...},"created_at":s?} (un JSON por línea)
//                                   3190: {"req":{"from":nx,"to":nx,"t":"req"|"acc","name":"…","ago":s?}} = una SOLICITUD de contacto
//                                   hecha por el código REAL de la app (NetLink.sendRequest del bundle compilado) y publicada;
//                                   {"raw":{"to":nx,"content":"…"}} = basura al buzón de solicitudes de `to`
//                                   3192: PK = la clave pública de la identidad REAL de este proceso (el emisor A);
//                                   {"send":{"from":nx,"to":nx,"toPk":b64,"p":"…","ago":s?}} = NetLink.send REAL de A (sella, firma
//                                   y publica el sobre igual que en el teléfono); {"acks":{"me":nx,"peer":nx,"peerPk":b64}} = A lee
//                                   lo del relé con su NetLink REAL (_onEvent: firma del evento, etiqueta, sobre) y comprueba cada ✓✓
//                                   con e2eAckTag como BleAckSystem.processIncomingAck → ACKS [{msgId, from, ok}]
//                                   3268: {"inbox":{"me":nx,"peer":nx,"peerPk":b64}} = lo que la app real `me` recibe de `peer` → INBOX {got:[{nx,p}], f}
//  node netbg_helper.mjs reqvectors → 3190: etiquetas del buzón de solicitudes (_reqTagPub) y solicitudes cifradas por la app real
//  node netbg_helper.mjs peer       → 3192: otra app REAL (el receptor B, con su propia identidad): PK; luego, por la entrada estándar,
//                                   {"cfg":{"me":nx,"relays":[url],"contacts":[{nx,name,pk}],"lastSeen":ms?}} → CFG <lo que manda a netBgConfig>
//                                   (NetLink._bgConfig real) y ACK <lo que manda a setAckKeys> (e2eAckKey, como _pushAckKeys);
//                                   {"drain":{"me":nx,"contacts":[…],"events":[…]}} → DRAINED: lo que la app recoge de netBgDrain
//                                   (NetLink._drainBg real: firma, etiqueta, sobre) y entrega al chat (_onNetPayload)
//  node netbg_helper.mjs multi [n] → 3204: n relés locales (4 por defecto) que exigen identificarse: URLS [url…] (el orden común);
//                                   PK = la identidad REAL del emisor A; {"send":{…,"only":[i…]}} = NetLink.send REAL de A publicado
//                                   solo en esos relés (por defecto en todos los que están en pie); {"acks":{…}} como en relay, más
//                                   `on` = en qué relés está cada ✓✓; {"down":i} / {"up":i} = tirar / volver a levantar el relé i (mismo
//                                   puerto y lo guardado); STATS → [{reqs, subs, open, conns, auths}] por relé (reqs = todos los REQ
//                                   recibidos, también los rechazados por no identificarse; subs = suscripciones vivas)
// El código real sale de tests/sim/builds/<NEXO_BUILD o wip>/src (bash tests/sim/build.sh wip; en CI se compila antes de estas pruebas).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import readline from 'readline';
const here = path.dirname(fileURLToPath(import.meta.url));
// Lo que lee la prueba (stdout). 3190: los registros del código de la app (p. ej. «[E2E] Identidad nueva») van a stderr (realNet)
const say = console.log.bind(console);
const deps = path.join(here, '../sim/.deps/node_modules');
const { schnorr } = await import(pathToFileURL(path.join(deps, '@noble/curves/secp256k1.js')).href);
const { sha256 } = await import(pathToFileURL(path.join(deps, '@noble/hashes/sha2.js')).href);
const { hmac } = await import(pathToFileURL(path.join(deps, '@noble/hashes/hmac.js')).href);
const { bytesToHex, hexToBytes } = await import(pathToFileURL(path.join(deps, '@noble/hashes/utils.js')).href);
const N = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
const utf8 = (s) => new TextEncoder().encode(s);
const scalar = (b) => { const x = BigInt('0x' + bytesToHex(b)) % (N - 1n) + 1n; return hexToBytes(x.toString(16).padStart(64, '0')); };
const _nidLower = (x) => String(x || '').trim().toLowerCase();
const day = (o) => new Date(Date.now() + (o || 0) * 86400000).toISOString().substring(0, 10);
const tag = (kraw, to, d) => { const sk = scalar(hmac(sha256, kraw, utf8('tag|' + to + '|' + d))); return { sk: bytesToHex(sk), pub: bytesToHex(schnorr.getPublicKey(sk)) }; };
async function seal(kraw, from, to, body) {
  const key = await crypto.subtle.importKey('raw', kraw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8('NEXO-NET|' + from + '|' + to) }, key, utf8(JSON.stringify(body))));
  const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
  return Buffer.from(all).toString('base64');
}
function event(sk, kind, tags, content, created_at) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const id = sha256(utf8(JSON.stringify([0, pubkey, created_at, kind, tags, content])));
  return { id: bytesToHex(id), pubkey, created_at, kind, tags, content, sig: bytesToHex(schnorr.sign(id, sk)) };
}

// 3190: el código REAL de la app (no una copia): NetLink.sendRequest cifra y firma la solicitud igual que en el teléfono
let _real = null;
async function realNet() {
  if (_real) return _real;
  const dir = path.resolve(here, '../sim/builds', process.env.NEXO_BUILD || 'wip', 'src');
  if (!fs.existsSync(path.join(dir, 'net/net_link.js'))) throw new Error('falta ' + dir + ' (bash tests/sim/build.sh wip)');
  if (!globalThis.window) globalThis.window = { crypto: globalThis.crypto };
  console.log = (...a) => console.error(...a); console.warn = (...a) => console.error(...a);
  const e2e = await import(pathToFileURL(path.join(dir, 'vault/e2e_crypto.js')).href);
  await e2e.initE2E(); // la identidad (clave pública que va en la solicitud)
  const net = await import(pathToFileURL(path.join(dir, 'net/net_link.js')).href);
  const shared = await import(pathToFileURL(path.join(dir, 'net/net_link_shared.js')).href);
  _real = { NetLink: net.NetLink, shared, pk: e2e.e2eMyPublicKey(), e2e };
  return _real;
}
// Solicitud ('req') o aceptación ('acc') de `from` para `to`, tal como la publica la app (el evento firmado, sin mandarlo a ningún relé)
async function realRequest(from, to, type, name, agoS) {
  const { NetLink } = await realNet();
  const nl = new NetLink({ localNexoId: from });
  nl.online = () => true;
  let ev = null;
  nl._publish = (e) => { ev = e; return Promise.resolve(); };
  const realNow = Date.now;
  if (agoS) Date.now = () => realNow() - agoS * 1000; // hecha hace `ago` segundos (created_at y ts de entonces)
  try { await nl.sendRequest(to, type, name, {}); } finally { Date.now = realNow; }
  return ev;
}

// 3192: una app REAL (NetLink) con un contacto: lo justo de `ble` que usa NetLink (mi ID y el contacto con su clave, por internet)
async function realApp(me, contacts, onPayload) {
  const { NetLink } = await realNet();
  const ble = { localNexoId: me, getBLEContacts: () => contacts.map((c) => ({ nexoId: c.nx, name: c.name || '', publicKey: c.pk, nt: 1 })) };
  if (onPayload) ble._onNetPayload = onPayload;
  const nl = new NetLink(ble);
  nl.online = () => true;
  nl.tick = async () => {}; nl._hello = () => {}; nl._wake = () => {}; // sin conexiones propias a los relés: solo lo que se le pide
  return nl;
}

const mode = process.argv[2];
if (mode === 'peer') {
  const { pk, e2e } = await realNet();
  say('PK ' + pk);
  const rl = readline.createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    chain = chain.then(async () => {
      const o = JSON.parse(line);
      if (o.cfg) {
        const c = o.cfg;
        let got = null;
        globalThis.window.NEXO_NET_RELAYS = c.relays;
        globalThis.window.Capacitor = { Plugins: { NexoBLE: { netBgConfig: async (x) => { got = x; return {}; }, saveToFile: async () => ({}) } } };
        const nl = await realApp(c.me, c.contacts);
        if (c.lastSeen) nl.state.lastSeen = c.lastSeen; // lo último que vio la app (since = eso + 1 s)
        await nl._bgConfig();
        const keys = [];
        for (const x of c.contacts) keys.push({ nx: x.nx, key: await e2e.e2eAckKey(x.pk) });
        say('CFG ' + JSON.stringify(got));
        say('ACK ' + JSON.stringify({ keys }));
      } else if (o.drain) {
        const d = o.drain, out = [];
        globalThis.window.Capacitor = { Plugins: { NexoBLE: { netBgDrain: async () => ({ events: d.events }), saveToFile: async () => ({}) } } };
        const nl = await realApp(d.me, d.contacts, (nx, p) => out.push({ nx, p }));
        await nl._refreshTags();
        const n = await nl._drainBg();
        say('DRAINED ' + JSON.stringify({ n, got: out }));
      }
    }).catch((e) => say('ERROR ' + (e && e.message)));
  });
}
if (mode === 'reqvectors') {
  const { shared, pk, NetLink } = await realNet();
  const out = { tags: [], reqs: [], pk };
  for (const id of ['nxbbbbbbbb', 'NX1A2B3C4D', ' nx0z9y8x7w ']) for (const d of [day(0), day(-1), '2026-02-28']) out.tags.push({ id, day: d, pub: shared._reqTagPub(id, d) });
  const cases = [['nxaaaaaaaa', 'nxbbbbbbbb', 'req', 'Ana'], ['nxaaaaaaaa', 'nxbbbbbbbb', 'acc', 'Ana <b>María</b> con un nombre larguísimo que pasa de cuarenta'], ['nxcccccccc', 'NX1A2B3C4D', 'req', '']];
  for (const [from, to, t, name] of cases) {
    const ev = await realRequest(from, to, t, name);
    // lo que la app de `to` saca de esa solicitud (NetLink._onReq → ble._onNetRequest), para comparar con lo que abre NetBg
    let app = null;
    await new NetLink({ localNexoId: to, _onNetRequest: (info) => { app = info; } })._onReq(ev.content);
    out.reqs.push({ from, to, t, name, ev, app });
  }
  out.today = day(0);
  say(JSON.stringify(out));
  process.exit(0);
}
if (mode === 'vectors') {
  const out = { sigs: [], tags: [], seals: [], ids: [] };
  for (let i = 0; i < 6; i++) {
    const sk = schnorr.utils.randomSecretKey(), msg = crypto.getRandomValues(new Uint8Array(32)), aux = crypto.getRandomValues(new Uint8Array(32));
    out.sigs.push({ sk: bytesToHex(sk), msg: bytesToHex(msg), aux: bytesToHex(aux), pub: bytesToHex(schnorr.getPublicKey(sk)), sig: bytesToHex(schnorr.sign(msg, sk, aux)) });
  }
  for (let i = 0; i < 4; i++) {
    const kraw = crypto.getRandomValues(new Uint8Array(32)), to = 'nx' + (10000000 + i);
    for (const d of [day(0), day(-1)]) out.tags.push({ kraw: bytesToHex(kraw), to, day: d, ...tag(kraw, to, d) });
  }
  const kraw = crypto.getRandomValues(new Uint8Array(32));
  out.seals.push({ kraw: bytesToHex(kraw), from: 'nxaaaaaaaa', to: 'nxbbbbbbbb', body: { t: 1, p: '{"type":"chat","msgId":"m1"}', n: 'm1' }, b64: await seal(kraw, 'nxaaaaaaaa', 'nxbbbbbbbb', { t: 1, p: '{"type":"chat","msgId":"m1"}', n: 'm1' }) });
  const sk = schnorr.utils.randomSecretKey();
  const ev = event(sk, 22242, [['relay', 'wss://relay.example.com/x'], ['challenge', 'abc"\\/\n']], '', 1700000000);
  out.ids.push({ sk: bytesToHex(sk), tags: ev.tags, content: '', created_at: 1700000000, id: ev.id });
  out.today = day(0);
  say(JSON.stringify(out));
  process.exit(0);
}
if (mode === 'relay') {
  const require = createRequire(import.meta.url);
  const { NostrRelay } = require(path.join(here, '../sim/nostr_relay.js'));
  const relay = new NostrRelay({ authRequired: true, latencyMs: 5 });
  const url = await relay.start();
  say('URL ' + url);
  const WS = createRequire(path.join(here, '../sim/nostr_relay.js'))('ws');
  const rl = readline.createInterface({ input: process.stdin });
  // Publicar EN SERIE: cada evento llega del todo (espera su OK, y para entonces el relé ya lo repartió a las
  // suscripciones) antes de mandar el siguiente. Si no, dos mensajes seguidos (mismo created_at, que va en segundos)
  // corren una carrera por llegar al relé —cada línea se publica por su propio ws tras un `await seal`— y el
  // suscriptor los veía a veces al revés (NetBgTest.dePuntaAPuntaConUnReleQueExigeIdentificarse fallaba [m2, m1]).
  const publish = (line) => new Promise((resolve) => {
    const o = JSON.parse(line);
    const kraw = hexToBytes(o.kraw);
    seal(kraw, o.from, o.to, o.body).then((content) => {
      const t = tag(kraw, o.to, day(0));
      const ev = event(schnorr.utils.randomSecretKey(), 1059, [['p', t.pub], ['expiration', String(Math.floor(Date.now() / 1000) + 3600)]], content, o.created_at || Math.floor(Date.now() / 1000));
      const ws = new WS(url);
      ws.on('open', () => ws.send(JSON.stringify(['EVENT', ev])));
      ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m[0] === 'OK') { say('PUBLISHED ' + m[2]); try { ws.close(); } catch (e) {} resolve(); } });
      ws.on('error', () => resolve());
    }).catch(() => resolve());
  });
  // 3190: publica un evento ya hecho (la solicitud de la app real, o basura) y espera su OK
  const publishEv = (ev) => new Promise((resolve) => {
    const ws = new WS(url);
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', ev])));
    ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m[0] === 'OK') { say('PUBLISHED ' + m[2]); try { ws.close(); } catch (e) {} resolve(); } });
    ws.on('error', () => resolve());
  });
  const publishReq = async (line) => {
    const o = JSON.parse(line);
    if (o.req) { const q = o.req; return publishEv(await realRequest(q.from, q.to, q.t || 'req', q.name || '', q.ago || 0)); }
    const { shared } = await realNet();
    const r = o.raw; // basura dirigida al buzón de solicitudes de r.to (firma válida, contenido que no se descifra)
    return publishEv(event(schnorr.utils.randomSecretKey(), 1059, [['p', shared._reqTagPub(r.to, day(0))]], r.content, Math.floor(Date.now() / 1000)));
  };
  let chain = Promise.resolve(); // cola: una publicación tras otra, en el orden de llegada de las líneas
  rl.on('line', (line) => {
    if (!line.trim()) return;
    if (line.trim() === 'STATS') { chain = chain.then(() => { say('STATS ' + JSON.stringify({ auths: relay.stats.auths, published: relay.stats.published, rejected: relay.stats.rejected, conns: relay.stats.conns, open: relay.wss.clients.size })); }); return; }
    // 3192: la identidad real de este proceso (el emisor A de NetBgSinAppTest)
    if (line.trim() === 'PK') { chain = chain.then(async () => { const { pk } = await realNet(); say('PK ' + pk); }).catch((e) => say('ERROR ' + (e && e.message))); return; }
    if (/^\{"send"/.test(line.trim())) {
      chain = chain.then(async () => {
        const s = JSON.parse(line).send;
        globalThis.window = globalThis.window || { crypto: globalThis.crypto };
        globalThis.window.NEXO_NET_RELAYS = [url];
        const nl = await realApp(s.from, [{ nx: s.to, name: s.name || '', pk: s.toPk }]);
        let ev = null;
        nl._publishOwn = (e) => { ev = e; return Promise.resolve(true); };
        const realNow = Date.now;
        if (s.ago) Date.now = () => realNow() - s.ago * 1000; // hecho hace `ago` segundos (created_at y t de entonces)
        try { await nl.send(s.to, s.p); } finally { Date.now = realNow; }
        await publishEv(ev);
      }).catch((e) => say('ERROR ' + (e && e.message)));
      return;
    }
    if (/^\{"acks"/.test(line.trim())) {
      chain = chain.then(async () => {
        const a = JSON.parse(line).acks, got = [];
        const { e2e } = await realNet();
        const nl = await realApp(a.me, [{ nx: a.peer, pk: a.peerPk }], (nx, p) => got.push({ nx, p }));
        await nl._refreshTags();
        for (const ev of relay.events.slice()) await nl._onEvent(JSON.parse(JSON.stringify(ev)));
        const out = [];
        for (const g of got) {
          let k = null; try { k = JSON.parse(g.p); } catch (e) { continue; }
          if (!k || k.type !== 'ack') continue;
          const exp = await e2e.e2eAckTag(a.peerPk, 'ack|' + k.msgId + '|' + _nidLower(k.from) + '|' + a.me);
          out.push({ msgId: k.msgId, from: k.from, via: g.nx, ok: !!(k.a && exp && k.a === exp) });
        }
        say('ACKS ' + JSON.stringify(out));
      }).catch((e) => say('ERROR ' + (e && e.message)));
      return;
    }
    // 3268 (bandeja de salida nativa): lo que la app REAL `me` recibe del relé de `peer` con su NetLink (_onEvent: firma, etiqueta,
    // sobre): INBOX {got:[{nx,p}], f} — los paquetes tal cual le llegan al chat (_onNetPayload) y el token del toque que leyó del sobre
    if (/^\{"inbox"/.test(line.trim())) {
      chain = chain.then(async () => {
        const a = JSON.parse(line).inbox, got = [];
        const nl = await realApp(a.me, [{ nx: a.peer, pk: a.peerPk }], (nx, p) => got.push({ nx, p }));
        await nl._refreshTags();
        for (const ev of relay.events.slice()) { try { await nl._onEvent(JSON.parse(JSON.stringify(ev))); } catch (e) {} }
        const peer = nl.peers.get(a.peer);
        say('INBOX ' + JSON.stringify({ got, f: (peer && peer.fcmToken) || '' }));
      }).catch((e) => say('ERROR ' + (e && e.message)));
      return;
    }
    // Lo que el relé tiene guardado (para comprobar lo que PUBLICA NetBg, p. ej. la confirmación de entrega del #87)
    if (line.trim() === 'DUMP') { chain = chain.then(() => { say('EVENTS ' + JSON.stringify(relay.events.map((e) => ({ tags: e.tags, content: e.content })))); }); return; }
    if (/^\{"(req|raw)"/.test(line.trim())) { chain = chain.then(() => publishReq(line).catch((e) => say('ERROR ' + (e && e.message)))); return; }
    chain = chain.then(() => publish(line));
  });
}
// 3204: varios relés (la parte nativa con datos móviles escucha solo los 2 primeros sanos de la lista)
if (mode === 'multi') {
  const require = createRequire(import.meta.url);
  const { NostrRelay } = require(path.join(here, '../sim/nostr_relay.js'));
  const WS = createRequire(path.join(here, '../sim/nostr_relay.js'))('ws');
  const n = Number(process.argv[3] || 4);
  const relays = [], ports = [], reqs = [], down = [];
  // Cada REQ que llega (antes de que el relé mire si se identificó)
  const watch = (i) => relays[i].wss.on('connection', (ws) => ws.on('message', (d) => { try { if (JSON.parse(String(d))[0] === 'REQ') reqs[i]++; } catch (e) {} }));
  for (let i = 0; i < n; i++) {
    const r = new NostrRelay({ authRequired: true, latencyMs: 5 });
    const u = await r.start();
    relays.push(r); ports.push(Number(new URL(u).port)); reqs.push(0); down.push(false); watch(i);
  }
  const urls = relays.map((r) => r.url);
  say('URLS ' + JSON.stringify(urls));
  const publishOn = (ev, i) => new Promise((resolve) => {
    const ws = new WS(urls[i]);
    const done = (ok) => { try { ws.close(); } catch (e) {} resolve(ok); };
    ws.on('open', () => ws.send(JSON.stringify(['EVENT', ev])));
    ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m[0] === 'OK') done(!!m[2]); });
    ws.on('error', () => done(false));
  });
  const rl = readline.createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  const q = (fn) => { chain = chain.then(fn).catch((e) => say('ERROR ' + (e && e.message))); };
  rl.on('line', (line) => {
    const t = line.trim();
    if (!t) return;
    if (t === 'PK') { q(async () => { const { pk } = await realNet(); say('PK ' + pk); }); return; }
    if (t === 'STATS') {
      q(async () => say('STATS ' + JSON.stringify(relays.map((r, i) => {
        let subs = 0; if (!down[i]) r.wss.clients.forEach((c) => { subs += c.subs ? c.subs.size : 0; });
        return { reqs: reqs[i], subs, open: down[i] ? 0 : r.wss.clients.size, conns: r.stats.conns, auths: r.stats.auths };
      }))));
      return;
    }
    const o = JSON.parse(t);
    if (o.down !== undefined) { q(async () => { const i = o.down; down[i] = true; await relays[i].stop(); say('DOWN ' + i); }); return; }
    if (o.up !== undefined) { q(async () => { const i = o.up; await relays[i].start(ports[i]); watch(i); down[i] = false; say('UP ' + i); }); return; }
    if (o.send) {
      q(async () => {
        const s = o.send;
        globalThis.window = globalThis.window || { crypto: globalThis.crypto };
        globalThis.window.NEXO_NET_RELAYS = urls;
        const nl = await realApp(s.from, [{ nx: s.to, name: s.name || '', pk: s.toPk }]);
        let ev = null;
        nl._publishOwn = (e) => { ev = e; return Promise.resolve(true); };
        const realNow = Date.now;
        if (s.ago) Date.now = () => realNow() - s.ago * 1000;
        try { await nl.send(s.to, s.p); } finally { Date.now = realNow; }
        const on = [];
        for (const i of (s.only || urls.map((u, k) => k))) if (!down[i] && await publishOn(ev, i)) on.push(i);
        say('PUBLISHED ' + JSON.stringify(on));
      });
      return;
    }
    if (o.acks) {
      q(async () => {
        const a = o.acks, got = [];
        const { e2e } = await realNet();
        const nl = await realApp(a.me, [{ nx: a.peer, pk: a.peerPk }], (nx, p) => got.push({ nx, p }));
        await nl._refreshTags();
        const all = new Map(); // id → { ev, on: [relés que lo tienen] }
        relays.forEach((r, i) => r.events.forEach((ev) => { const x = all.get(ev.id) || { ev, on: [] }; x.on.push(i); all.set(ev.id, x); }));
        const out = [];
        for (const x of all.values()) {
          const before = got.length;
          await nl._onEvent(JSON.parse(JSON.stringify(x.ev)));
          for (const g of got.slice(before)) {
            let k = null; try { k = JSON.parse(g.p); } catch (e) { continue; }
            if (!k || k.type !== 'ack') continue;
            const exp = await e2e.e2eAckTag(a.peerPk, 'ack|' + k.msgId + '|' + _nidLower(k.from) + '|' + a.me);
            out.push({ msgId: k.msgId, from: k.from, ok: !!(k.a && exp && k.a === exp), on: x.on });
          }
        }
        say('ACKS ' + JSON.stringify(out));
      });
    }
  });
}
