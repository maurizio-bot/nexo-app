// Ayudante de NetBgTest (JVM): hace lo mismo que la app (net_link.js) con las mismas librerías (noble, WebCrypto).
//  node netbg_helper.mjs vectors  → JSON con firmas Schnorr, etiquetas del día, sobres y ids de evento de referencia
//  node netbg_helper.mjs relay    → arranca un relé Nostr local que exige identificación (NIP-42), escribe su URL y
//                                   publica lo que se le pide por la entrada estándar:
//                                   {"kraw":hex,"from":nx,"to":nx,"body":{...},"created_at":s?} (un JSON por línea)
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import readline from 'readline';
const here = path.dirname(fileURLToPath(import.meta.url));
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

const mode = process.argv[2];
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
  console.log(JSON.stringify(out));
  process.exit(0);
}
if (mode === 'relay') {
  const require = createRequire(import.meta.url);
  const { NostrRelay } = require(path.join(here, '../sim/nostr_relay.js'));
  const relay = new NostrRelay({ authRequired: true, latencyMs: 5 });
  const url = await relay.start();
  console.log('URL ' + url);
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
      ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m[0] === 'OK') { console.log('PUBLISHED ' + m[2]); try { ws.close(); } catch (e) {} resolve(); } });
      ws.on('error', () => resolve());
    }).catch(() => resolve());
  });
  let chain = Promise.resolve(); // cola: una publicación tras otra, en el orden de llegada de las líneas
  rl.on('line', (line) => {
    if (!line.trim()) return;
    if (line.trim() === 'STATS') { chain = chain.then(() => { console.log('STATS ' + JSON.stringify({ auths: relay.stats.auths, published: relay.stats.published, rejected: relay.stats.rejected })); }); return; }
    chain = chain.then(() => publish(line));
  });
}
