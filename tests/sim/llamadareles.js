// 3128 — Datos de una llamada por relés (diagnóstico S24 3067 15-11 08:41: 176 MB en el día; una videollamada de 12,6 min por
// relés con el S23 en datos móviles y, YA COLGADA, 66 MB más en 17 min; relay.damus.io «se cae sin parar»). Las partes de voz e
// imagen de una llamada por relés caducaban a los 7 días, como un mensaje: cada vez que un relé se caía y volvía, la suscripción
// nueva (desde lo último visto − 10 min) volvía a bajar hasta 10 min de llamada.
//  L1  una parte de llamada (1-a-1 o de grupo, tipo «vf») caduca en el relé a los 2 min; un texto sigue a 7 días y un trozo a 1 día;
//  L2  relé de prueba (NIP-40, como los públicos): 400 partes de una llamada ya colgada; el relé se cae y vuelve → la suscripción
//      nueva no baja NINGUNA (3127: las 400 otra vez, ~0,5 MB por relé y por caída);
//      durante la llamada, una caída solo vuelve a bajar los últimos 2 min (no 10);
//  L3  el diagnóstico dice cuánto se bajó de los relés y cuánto era repetido (por relé).
//  L4  3130 (diagnóstico S24 3069 13:51: 8,8 de 10,1 MB bajados YA VISTOS; deslizó 4 veces en 3 s): «deslizar para actualizar» solo
//      vuelve a pedir a un relé callado (no al que entrega en vivo) y como mucho una vez por minuto.
// Contraprueba: en la 3127 L1 y L2 fallan y no hay línea de datos de los relés.
// Uso: node llamadareles.js [dir_build]
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const WebSocket = require('ws');
const { importSrc, buildDir } = require('./srcmod');
const { NostrRelay } = require('./nostr_relay');
const deps = path.join(__dirname, '.deps/node_modules');
(async () => {
  const r = { prueba: 'llamadareles', build: path.basename(buildDir) };
  const { NetLink } = await importSrc('net/net_link.js');
  const sec = await import(pathToFileURL(path.join(deps, '@noble/curves/secp256k1.js')).href);
  const sha = await import(pathToFileURL(path.join(deps, '@noble/hashes/sha2.js')).href);
  const ut = await import(pathToFileURL(path.join(deps, '@noble/hashes/utils.js')).href);
  const net = new NetLink({ localNexoId: 'nxa0000001' });
  const vf = JSON.stringify({ type: 'vf', c: 'clabc123', s: 7, d: 'A'.repeat(400) });
  const ttlVf = net._ttlFor(vf), ttlTxt = net._ttlFor('{"v":1,"type":"chat","msgId":"m1"}'), ttlChunk = net._ttlFor('{"v":1,"t":"c","i":1}');
  r.L1_ttl = { parte_llamada: ttlVf, texto: ttlTxt, trozo: ttlChunk };
  r.L1_ok = ttlVf <= 120 && ttlTxt === 7 * 86400 && ttlChunk === 86400;

  // ---- L2: relé con caducidad (NIP-40) ----
  const relay = new NostrRelay({ latencyMs: 1 });
  await relay.start();
  const sk = sec.schnorr.utils.randomSecretKey(), pub = ut.bytesToHex(sec.schnorr.getPublicKey(sk));
  const tag = 'f'.repeat(64);
  const mkEv = (createdAt, ttl, content) => {
    const tags = [['p', tag], ['expiration', String(createdAt + ttl)]];
    const id = ut.bytesToHex(sha.sha256(new TextEncoder().encode(JSON.stringify([0, pub, createdAt, 1059, tags, content]))));
    return { id, pubkey: pub, created_at: createdAt, kind: 1059, tags, content, sig: ut.bytesToHex(sec.schnorr.sign(ut.hexToBytes(id), sk)) };
  };
  const body = 'B'.repeat(1100); // una parte de voz sellada (~1,1 KB como en el teléfono)
  const now0 = Math.floor(Date.now() / 1000);
  const publish = (evs) => new Promise((res) => {
    const ws = new WebSocket(relay.url); let left = evs.length;
    ws.on('open', () => evs.forEach((ev) => ws.send(JSON.stringify(['EVENT', ev]))));
    ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m[0] === 'OK' && --left === 0) { ws.close(); res(); } });
  });
  // la parte la arma el teléfono AHORA con su caducidad: para «una parte de hace N s» se corre la hora de las dos marcas
  let seq = 0;
  const sentAgo = (ago) => mkEv(now0 - ago, ttlVf, body + (seq++)); // cada parte distinta (id distinto)
  // (a) partes mandadas hace 118 s (en la 3128 les quedan 2 s en el relé): se publican y se espera a que caduquen
  const old = []; for (let i = 0; i < 400; i++) old.push(sentAgo(118));
  await publish(old);
  await new Promise((res) => setTimeout(res, 3000));
  const reqCount = (since) => new Promise((res) => {
    const ws = new WebSocket(relay.url); let n = 0, bytes = 0;
    ws.on('open', () => ws.send(JSON.stringify(['REQ', 'x', { kinds: [1059], '#p': [tag], since }])));
    ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m[0] === 'EVENT') { n++; bytes += String(d).length; } else if (m[0] === 'EOSE') { ws.close(); res({ n, bytes }); } });
  });
  // la llamada ya colgó; el relé se cae y vuelve: suscripción nueva desde lo último visto − 10 min, como _subscribe
  const afterCall = await reqCount(now0 - 600);
  r.L2_tras_colgar = afterCall.n + ' partes, ' + Math.round(afterCall.bytes / 1024) + ' KB';
  r.L2_tras_colgar_no_baja = afterCall.n === 0;
  // (b) llamada EN CURSO de 10 min (la última parte hace 1 s): una caída vuelve a bajar como mucho los últimos 2 min
  const live = []; for (let i = 0; i < 400; i++) live.push(sentAgo(600 - Math.floor(i * 600 / 400) + 1));
  const liveOk = live.filter((e) => Number(e.tags[1][1]) > now0);
  await publish(liveOk);
  const during = await reqCount(now0 - 600), again = during.n - afterCall.n; // solo las de esta llamada
  r.L2_en_llamada = again + ' de 400 partes otra vez';
  r.L2_en_llamada_solo_2_min = again <= 400 * 125 / 600 + 2;
  await relay.stop();

  // ---- L3: el diagnóstico cuenta lo bajado de los relés y lo repetido ----
  const n3 = new NetLink({ localNexoId: 'nxa0000001' });
  n3.seen = new Map();
  const relayR = { sub: 'nxsub1', waits: new Map(), open: true };
  n3._onEvent = async function () {};
  let hasLine = typeof n3._onRelayMsg === 'function' && typeof n3.rxLine === 'function';
  if (hasLine) {
    const ev1 = { id: 'a'.repeat(64), kind: 1059, tags: [], content: body };
    const msg = JSON.stringify(['EVENT', 'nxsub1', ev1]);
    n3._onRelayMsg('wss://relay.damus.io', relayR, msg);         // nuevo
    n3.seen.set(ev1.id, Date.now());
    for (let i = 0; i < 3; i++) n3._onRelayMsg('wss://relay.damus.io', relayR, msg); // repetido ×3 (caídas)
    n3._onRelayMsg('wss://nos.lol', relayR, msg);                // el mismo por otro relé
    r.L3_linea = n3.rxLine();
  }
  r.L3_ok = hasLine && /bajado de los relés desde que se abrió la app \(hace 1 min\): \d+ KB, 5 eventos, 4 ya vistos \(\d+ KB\) · relay\.damus\.io \d+ KB \(repetido \d+ KB\) · nos\.lol \d+ KB \(repetido \d+ KB\)/.test(r.L3_linea || '');

  // ---- L4: deslizar para actualizar no vuelve a pedir a los relés que entregan en vivo ----
  const n4 = new NetLink({ localNexoId: 'nxa0000001' });
  const subs = [];
  n4.relays = new Map([['wss://vivo.test', { open: true, ws: {}, rxAt: Date.now() - 2000 }], ['wss://callado.test', { open: true, ws: {}, rxAt: Date.now() - 90000 }]]);
  n4._probeRelays = () => {}; n4._helloAll = () => {}; n4.online = () => true;
  n4._subscribe = (rl) => { subs.push(rl === n4.relays.get('wss://vivo.test') ? 'vivo' : 'callado'); };
  for (let i = 0; i < 4; i++) n4.refresh('prueba');
  r.L4_pedidos = subs.join(',');
  r.L4_ok = subs.join(',') === 'callado';
  const ok = r.L1_ok && r.L2_tras_colgar_no_baja && r.L2_en_llamada_solo_2_min && r.L3_ok && r.L4_ok;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('LLAMADARELES ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('LLAMADARELES ' + JSON.stringify({ prueba: 'llamadareles', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
