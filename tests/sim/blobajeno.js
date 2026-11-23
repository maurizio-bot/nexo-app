// Auditoría 23-11 (T-R1): un contacto pone en su PUNTERO de archivo un relé que no es de los míos. Antes se abría como uno más de
// los míos y se quedaba en mi lista: recibía mi suscripción con todas mis etiquetas de buzón (#p), mi AUTH (NIP-42) y lo que
// publico. Ahora: el archivo baja igual (idéntico), pero por ese relé solo se pide por id; nada de #p, ni AUTH, ni EVENT mío, y
// al terminar la conexión se cierra (no queda en mi lista).
// Uso: node blobajeno.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
const { NostrRelay } = require('./nostr_relay');

(async () => {
  const r = { prueba: 'blobajeno' };
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const mine = new NostrRelay(), foreign = new NostrRelay({ authRequired: true });
  const U1 = await mine.start(), UX = await foreign.start();
  const seenX = [];
  foreign.wss.on('connection', (ws, req) => { ws.on('message', (m) => seenX.push(String(m))); });
  global.window = { NEXO_NET_RELAYS: [U1] };
  const { NetLink } = await importSrc('net/net_link.js');
  const B = await importSrc('net/blob_mailbox.js');
  B.blobCryptoUse(globalThis.crypto);
  const mkNet = async (id, urls) => {
    const net = new NetLink({ localNexoId: id, getBLEContacts: () => [] });
    urls.forEach((u) => net._connect(u));
    for (let i = 0; i < 100 && net.openRelayUrls().length < urls.length; i++) await sleep(50);
    return net;
  };
  // el contacto (A) solo usa el relé ajeno; yo (Bn) solo el mío
  const netA = await mkNet('nxa0000001', [UX]);
  const netB = await mkNet('nxb0000002', [U1]);
  netB.inTags = netB.inTags || new Map();
  const N = 120 * 1024, raw = new Uint8Array(N); for (let i = 0; i < N; i++) raw[i] = (i * 31 + 7) & 255;
  const b64 = Buffer.from(raw).toString('base64');
  const staged = await B.stageBlob(netA, b64);
  const ptr = staged.pointer;
  r.puntero_reles = ptr.relays;
  const before = seenX.length;
  const got = await B.fetchBlob(netB, ptr, { log: () => {} });
  await sleep(300);
  r.llega_identico = got && got.b64 === b64;
  const mineMsgs = seenX.slice(before);
  r.mensajes_al_ajeno = mineMsgs.map((m) => { try { const a = JSON.parse(m); return a[0] + (a[2] && typeof a[2] === 'object' ? ':' + Object.keys(a[2]).join('+') : ''); } catch (e) { return '?'; } });
  r.sin_suscripcion_p = !mineMsgs.some((m) => m.indexOf('"#p"') >= 0);
  r.sin_auth = !mineMsgs.some((m) => /^\["AUTH"/.test(m));
  r.sin_publicar = !mineMsgs.some((m) => /^\["EVENT"/.test(m));
  r.solo_por_id = mineMsgs.filter((m) => /^\["REQ"/.test(m)).every((m) => { const a = JSON.parse(m); return Object.keys(a[2]).join() === 'ids'; });
  r.no_queda_en_mi_lista = !netB.relays.has(UX) && !(netB.fetchRelays && netB.fetchRelays.size);
  await sleep(300);
  // de las conexiones del relé ajeno solo queda la de A (la de B se cerró)
  r.conexion_cerrada = Array.from(foreign.wss.clients).filter((c) => c.readyState === 1).length === 1;
  const ok = r.llega_identico && r.sin_suscripcion_p && r.sin_auth && r.sin_publicar && r.solo_por_id && r.no_queda_en_mi_lista && r.conexion_cerrada;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLOBAJENO ' + JSON.stringify(r));
  try { netA.stop && netA.stop(); netB.stop && netB.stop(); } catch (e) {}
  await mine.stop(); await foreign.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
