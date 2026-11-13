// 3042 (dueño 13-11, S24 APK 3032, 21:29: «cargué un gif y se está tardando mucho»): un GIF de 4,6 MB a un contacto sin conexión
// va al buzón de archivos (117 trozos, 3 a la vez) y cada tanda esperaba a TODOS los relés abiertos; con un relé abierto pero
// muerto (esa noche nos.lol y nostr.mom: «no contesta… conexión muerta») cada tanda esperaba el tope de 10 s → ~6 min.
// Prueba: 3 relés, uno abierto pero callado; un archivo de 300 KB (8 trozos, 3 tandas). Debe subir en < 8 s con réplica ≥ 2
// y bajarse idéntico (antes: ~30 s, una tanda = 10 s).
// Uso: node blobslow.js [dir_build]
'use strict';
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');
(async () => {
  const r = { prueba: 'blobslow' };
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const r1 = new NostrRelay(), r2 = new NostrRelay(), r3 = new NostrRelay();
  const U1 = await r1.start(), U2 = await r2.start(), U3 = await r3.start();
  global.window = { NEXO_NET_RELAYS: [U1, U2, U3] };
  const { NetLink } = await importSrc('net/net_link.js');
  const B = await importSrc('net/blob_mailbox.js');
  B.blobCryptoUse(globalThis.crypto);
  const mkNet = async (urls) => {
    const net = new NetLink({ localNexoId: 'nxa0000001', getBLEContacts: () => [] });
    urls.forEach((u) => net._connect(u));
    for (let i = 0; i < 100 && net.openRelayUrls().length < urls.length; i++) await sleep(50);
    return net;
  };
  const netA = await mkNet([U1, U2, U3]);
  r.tres_abiertos = netA.openRelayUrls().length === 3;
  r3.muteAll(); // abierto pero muerto: no contesta nada
  const N = 300 * 1024, raw = new Uint8Array(N); let x = 777; for (let i = 0; i < N; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; raw[i] = x & 255; }
  const b64 = Buffer.from(raw).toString('base64');
  const t0 = Date.now();
  const staged = await B.stageBlob(netA, b64);
  r.subida_ms = Date.now() - t0;
  r.replica = staged.replication;
  const netB = await mkNet([U1, U2]);
  const got = await B.fetchBlob(netB, staged.pointer);
  r.llega_identico = Buffer.from(got.bytes).equals(Buffer.from(raw));
  const ok = r.tres_abiertos && r.subida_ms < 8000 && r.replica >= 2 && r.llega_identico;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLOBSLOW ' + JSON.stringify(r));
  [r1, r2, r3].forEach((q) => q.stop());
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLOBSLOW ' + JSON.stringify({ prueba: 'blobslow', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
