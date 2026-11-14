// 3073 (diagnóstico S24 14-11 18:41, build 3047): un audio del S23 (169 KB, 5 trozos) «no se pudo bajar (Faltan 5 de 5 trozos)»
// una y otra vez. El S23 lo subió a UN solo relé (réplica mínima 1) y ese relé estaba apartado en el S24 por inestable («lo aparto
// ~5 min»): ensureRelay no lo abría mientras durara el apartado y el archivo no bajaba. Ahora, para bajar un archivo, el relé del
// puntero se abre igual una vez.
// Uso: node blobside.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
const { NostrRelay } = require('./nostr_relay');

(async () => {
  const r = { prueba: 'blobside' };
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  const U1 = await r1.start(), U2 = await r2.start();
  global.window = { NEXO_NET_RELAYS: [U1, U2] };
  const { NetLink } = await importSrc('net/net_link.js');
  const B = await importSrc('net/blob_mailbox.js');
  B.blobCryptoUse(globalThis.crypto);
  const mkNet = async (urls) => {
    const net = new NetLink({ localNexoId: 'nxa0000001', getBLEContacts: () => [] });
    urls.forEach((u) => net._connect(u));
    for (let i = 0; i < 100 && net.openRelayUrls().length < urls.length; i++) await sleep(50);
    return net;
  };
  // el que manda solo tiene abierto el relé 2: el audio queda SOLO ahí
  const netA = await mkNet([U2]);
  const N = 120 * 1024, raw = new Uint8Array(N); let x = 7; for (let i = 0; i < N; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; raw[i] = x & 255; }
  const staged = await B.stageBlob(netA, Buffer.from(raw).toString('base64'));
  const ptr = staged.pointer;
  r.solo_un_rele = ptr.relays.length === 1 && ptr.relays[0] === U2;
  // el que recibe tiene el relé 1 abierto y el relé 2 APARTADO (se cerró hace poco y su reintento es dentro de 5 min)
  const netB = await mkNet([U1, U2]);
  const rr = netB.relays.get(U2);
  try { rr.ws.close(); } catch (e) {}
  for (let i = 0; i < 40 && rr.ws; i++) await sleep(50);
  rr.retryAt = Date.now() + 300000; rr._sidelined = true;
  r.rele_apartado = !rr.open && rr.retryAt > Date.now();
  const logs = []; const realLog = console.log; console.log = function () { logs.push(Array.from(arguments).join(' ')); };
  let got = null, err = null;
  try { got = await B.fetchBlob(netB, ptr, { connectMs: 3000 }); } catch (e) { err = e && e.message; } finally { console.log = realLog; }
  r.baja_igual = !!got && Buffer.from(got.bytes).equals(Buffer.from(raw));
  r.error = err;
  r.queda_escrito = logs.some((l) => /apartado, pero tiene un archivo que hace falta/.test(l));
  const ok = r.solo_un_rele && r.rele_apartado && r.baja_igual;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLOBSIDE ' + JSON.stringify(r));
  try { netA._closeAll && netA._closeAll(); netB._closeAll && netB._closeAll(); } catch (e) {}
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLOBSIDE ' + JSON.stringify({ prueba: 'blobside', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
