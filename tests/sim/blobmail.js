// Fase B de la entrega offline (build 2969): BUZÓN DE ARCHIVOS en relés (src/net/blob_mailbox.js + NetLink.publishEach/
// fetchEvents). Batería ADVERSARIAL de los contratos (docs/CONTRATOS_ENTREGA_OFFLINE_FASE_AB.md §8) con relés Nostr reales del
// simulador (NIP-01) y el NetLink real en Node: (1) cifrar UNA vez → huella → partir → publicar con RÉPLICA en 3 relés, sin
// etiqueta del destinatario y con caducidad; (2) el receptor baja por id, verifica y arma el MISMO archivo; (3) un relé
// MALICIOSO que sirve trozos alterados → se detecta por la huella (id) y se re-baja de otro; (4) un relé caído → la
// redundancia cubre; (5) puntero gigante/absurdo → rechazo INMEDIATO sin reservar ni tocar la red; (6) huella/llave/trozo
// malos → se rechaza, nunca se muestra basura; (7) borrado al confirmar (NIP-09) best-effort; (8) decisiones puras.
// Uso: node blobmail.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
const { NostrRelay } = require('./nostr_relay');

(async () => {
  const r = { prueba: 'blobmail' };
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  // relé 3 = MALICIOSO: sirve cada 3.º trozo con un byte cambiado (el id se queda igual: así se nota que la huella es la que manda)
  const r1 = new NostrRelay(), r2 = new NostrRelay(), r3 = new NostrRelay({ tamper: (ev) => { if (ev.kind !== 1064) return null; r3.served = (r3.served || 0) + 1; if (r3.served % 3) return null; const c = ev.content; return Object.assign({}, ev, { content: (c.charAt(0) === 'A' ? 'B' : 'A') + c.slice(1) }); } });
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
  r.tres_reles_abiertos = netA.openRelayUrls().length === 3;

  // archivo de prueba: 300 KB pseudoaleatorios (→ 8 trozos de 40 KB)
  const N = 300 * 1024, raw = new Uint8Array(N); let x = 12345; for (let i = 0; i < N; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; raw[i] = x & 255; }
  const b64 = Buffer.from(raw).toString('base64');
  const t0 = Date.now();
  const staged = await B.stageBlob(netA, b64);
  const ptr = staged.pointer;
  r.subida_ms = Date.now() - t0;
  r.puntero_valido = B.validatePointer(ptr) === null;
  r.ocho_trozos = ptr.chunks.length === 8 && ptr.chunks[7].n === (N + 16) - 7 * 40960 && ptr.chunk === 40960;
  r.replica_3 = staged.replication === 3 && ptr.relays.length === 3 && ptr.chunks.every((c) => c.r.length === 3);
  r.cifrado_distinto_del_original = ptr.size === N + 16 && ptr.raw === N; // GCM: +16 de etiqueta; el relé nunca ve el claro
  const evs = r1.events.filter((e) => e.kind === 1064);
  r.eventos_en_cada_rele = evs.length === 8 && r2.events.filter((e) => e.kind === 1064).length === 8 && r3.events.filter((e) => e.kind === 1064).length === 8;
  r.sin_etiqueta_destinatario = evs.every((e) => !e.tags.some((t) => t[0] === 'p'));
  const now = Math.floor(Date.now() / 1000);
  r.caducidad_7_dias = evs.every((e) => { const t = e.tags.find((t) => t[0] === 'expiration'); return t && Number(t[1]) > now + 6.9 * 86400 && Number(t[1]) <= now + 7 * 86400 + 5; });
  r.trozo_entra_en_el_rele = evs.every((e) => e.content.length < 60000) && evs[0].content.length === Math.ceil(40960 / 3) * 4;
  r.misma_clave_por_blob = new Set(evs.map((e) => e.pubkey)).size === 1; // una clave por blob → un solo borrado al confirmar
  r.nada_legible = !evs.some((e) => Buffer.from(e.content, 'base64').subarray(0, 64).equals(Buffer.from(raw.subarray(0, 64))));

  // 2) bajar y armar: idéntico al original
  const netB = await mkNet([U1, U2, U3]);
  const got = await B.fetchBlob(netB, ptr);
  r.llega_identico = got.bytes.length === N && Buffer.from(got.bytes).equals(Buffer.from(raw)) && got.b64 === b64;
  r.bajada_sin_trozos_malos = got.bad === 0 && r3.stats.reqIds === undefined; // del relé 3 no se pidió nada (los otros dos alcanzaron)

  // 3) RELÉ MALICIOSO primero: el puntero ordena los relés con el malo adelante → sirve trozos alterados → se detectan y se
  //    re-bajan de otro relé; el archivo sale IDÉNTICO
  const reorder = (p, order) => Object.assign({}, p, { relays: order, chunks: p.chunks.map((c) => Object.assign({}, c, { r: c.r.map((i) => order.indexOf(p.relays[i])) })) });
  const ptrMal = reorder(ptr, [U3, U1, U2]);
  const got3 = await B.fetchBlob(netB, ptrMal, { log: () => {} });
  r.rele_malicioso_detectado = got3.bad >= 2 && (r3.stats.tampered || 0) >= 2;
  r.rele_malicioso_no_cuela = Buffer.from(got3.bytes).equals(Buffer.from(raw));

  // 4) un relé CAÍDO (el primero del puntero): la redundancia cubre
  await r1.stop();
  const got4 = await B.fetchBlob(netB, ptr, { connectMs: 1500 });
  r.rele_caido_redundancia = Buffer.from(got4.bytes).equals(Buffer.from(raw)) && got4.relays >= 1;

  // 5) ANTI-DoS: punteros absurdos → rechazo inmediato, sin reservar ni pedir nada a la red
  let fetches = 0; const origFetch = netB.fetchEvents; netB.fetchEvents = function() { fetches++; return origFetch.apply(this, arguments); };
  const tDos = Date.now();
  const giant = Object.assign({}, ptr, { chunks: new Array(20000).fill(0).map((_, i) => ({ i, n: 40960, id: ptr.chunks[0].id })), size: 20000 * 40960, raw: 20000 * 40960 });
  const huge = Object.assign({}, ptr, { size: 100 * 1024 * 1024, raw: 100 * 1024 * 1024 });
  const thumbed = Object.assign({}, ptr, { thumb: 'A'.repeat(30000) });
  const expired = Object.assign({}, ptr, { expires: Math.floor(Date.now() / 1000) - 10 });
  const badChunk = Object.assign({}, ptr, { chunks: ptr.chunks.map((c, i) => i === 3 ? Object.assign({}, c, { n: 70000 }) : c) });
  const errs = [];
  for (const p of [giant, huge, thumbed, expired, badChunk, null, { v: 1 }]) { try { await B.fetchBlob(netB, p); errs.push('acepto'); } catch (e) { errs.push(e.code); } }
  r.antidos_rechazo_inmediato = errs.every((c) => c === 'BLOB_PTR') && fetches === 0 && (Date.now() - tDos) < 500;
  r.antidos_motivos = [B.validatePointer(giant), B.validatePointer(huge), B.validatePointer(thumbed), B.validatePointer(expired), B.validatePointer(badChunk)].map((s) => String(s).split(' ')[0]).join(',');

  // 6) huella/llave/trozo malos → nunca basura
  const codes = {};
  try { await B.fetchBlob(netB, Object.assign({}, ptr, { hash: 'ab'.repeat(32) })); } catch (e) { codes.hash = e.code; }
  try { await B.fetchBlob(netB, Object.assign({}, ptr, { k: Buffer.alloc(32, 7).toString('base64') })); } catch (e) { codes.key = e.code; }
  try { await B.fetchBlob(netB, Object.assign({}, ptr, { chunks: ptr.chunks.map((c, i) => i === 2 ? Object.assign({}, c, { id: 'cd'.repeat(32) }) : c) })); } catch (e) { codes.missing = e.code; }
  r.huella_mala_rechaza = codes.hash === 'BLOB_HASH';
  r.llave_mala_rechaza = codes.key === 'BLOB_GCM';
  r.trozo_inexistente_incompleto = codes.missing === 'BLOB_INCOMPLETE';

  // 7) borrado al confirmar (NIP-09): un evento kind 5 con los 8 ids, firmado con la clave del blob; los relés lo aceptan
  const del = netA.blobDeleteEvent(B._b64ToBytes(staged.outRecord.sk), staged.outRecord.ids);
  const okDel = await netA.publishEach(del, 5000);
  r.borrado_pedido = del.kind === 5 && del.tags.filter((t) => t[0] === 'e').length === 8 && del.pubkey === evs[0].pubkey && okDel.length >= 1;

  // 8) puras
  r.elegible = B.blobMailboxEligible(b64) === true && B.blobMailboxEligible('A'.repeat(Math.ceil(5 * 1024 * 1024 * 4 / 3) + 8)) === false && B.blobMailboxEligible(b64, { dst: 'x' }) === false && B.blobMailboxEligible('') === false;
  r.reintentos = B._fetchRetryDelay(1) === 30000 && B._fetchRetryDelay(2) === 120000 && B._fetchRetryDelay(4) === 1800000 && B._fetchRetryDelay(9) === 1800000;
  const att = { type: 'attachment', attachmentType: 'image', payload: 'ptr', meta: { ptr: 1 }, ptr: ptr };
  r.puntero_detectado = !!B.blobPointerIn(JSON.stringify(att)) && !B.blobPointerIn('hola') && !B.blobPointerIn(JSON.stringify({ type: 'attachment', payload: 'AAAA' })) && !!B.blobPointerIn('', { payload: { attachment: att } });
  r.orden_cifrar_luego_partir = (() => { const enc = { ct: new Uint8Array(100000) }; const parts = B.splitChunks(enc.ct, 40960); return parts.length === 3 && parts[2].length === 100000 - 2 * 40960; })();
  // 2974: el primer carácter del contenido es base64 al azar; si ya era «X», «X» + resto no cambiaba nada y la prueba fallaba 1 de 64 veces
  // (falló en GitHub en la 2973 y nunca en local). Se cambia por un carácter DISTINTO del que hay.
  const otro = evs[0].content.charAt(0) === 'X' ? 'Y' : 'X';
  r.id_de_evento_es_huella = B._eventId(evs[0]) === evs[0].id && B._eventId(Object.assign({}, evs[0], { content: otro + evs[0].content.slice(1) })) !== evs[0].id;

  await Promise.all([r2.stop(), r3.stop()]);
  netA._closeAll(); netB._closeAll();
  const info = { prueba: 1, resultado: 1, subida_ms: 1, antidos_motivos: 1 };
  const ok = Object.keys(r).filter((k) => !info[k]).every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLOBMAIL ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLOBMAIL {"resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); process.exit(1); });
