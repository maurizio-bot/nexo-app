// Ayudante de NetBgTest (JVM): hace lo mismo que la app (net_link.js) con las mismas librerías (noble, WebCrypto).
//  node netbg_helper.mjs vectors  → JSON con firmas Schnorr, etiquetas del día, sobres y ids de evento de referencia
//  node netbg_helper.mjs relay    → arranca un relé Nostr local que exige identificación (NIP-42), escribe su URL y
//                                   publica lo que se le pide por la entrada estándar:
//                                   {"kraw":hex,"from":nx,"to":nx,"body":{...},"created_at":s?} (un JSON por línea)
//                                   3190: {"req":{"from":nx,"to":nx,"t":"req"|"acc","name":"…","ago":s?}} = una SOLICITUD de contacto
//                                   hecha por el código REAL de la app (NetLink.sendRequest del bundle compilado) y publicada;
//                                   {"raw":{"to":nx,"content":"…"}} = basura al buzón de solicitudes de `to`
//  node netbg_helper.mjs reqvectors → 3190: etiquetas del buzón de solicitudes (_reqTagPub) y solicitudes cifradas por la app real
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
  _real = { NetLink: net.NetLink, shared, pk: e2e.e2eMyPublicKey() };
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

const mode = process.argv[2];
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
    if (line.trim() === 'STATS') { chain = chain.then(() => { say('STATS ' + JSON.stringify({ auths: relay.stats.auths, published: relay.stats.published, rejected: relay.stats.rejected })); }); return; }
    // Lo que el relé tiene guardado (para comprobar lo que PUBLICA NetBg, p. ej. la confirmación de entrega del #87)
    if (line.trim() === 'DUMP') { chain = chain.then(() => { say('EVENTS ' + JSON.stringify(relay.events.map((e) => ({ tags: e.tags, content: e.content })))); }); return; }
    if (/^\{"(req|raw)"/.test(line.trim())) { chain = chain.then(() => publishReq(line).catch((e) => say('ERROR ' + (e && e.message)))); return; }
    chain = chain.then(() => publish(line));
  });
}
