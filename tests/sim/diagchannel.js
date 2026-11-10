// Canal directo de diagnósticos a Claude (2992; pendiente importante #3 del dueño 10-11). Prueba de extremo a extremo con relés Nostr del simulador
// (NIP-01) y el NetLink real en Node: la app (src/ui/diag_channel.js) cifra el diagnóstico para la llave de DIAGNÓSTICO (aparte de la identidad del
// dueño), lo publica en los relés, y el lector de Claude (tools/diag_reader.cjs) lo baja y lo descifra con la mitad privada. Comprueba:
//   (1) el evento sale a los 2 relés, kind 1065, con la etiqueta de la llave y caducidad, firmado por una clave de un solo uso, y el contenido NO
//       lleva el texto en claro; cabe en el límite del relé (64 KB) aunque el diagnóstico sea de ~40 KB (gzip);
//   (2) el lector lo descifra y recupera síntoma, build y texto idénticos; con otra llave privada NO descifra; un evento alterado se descarta;
//   (3) sin relé abierto el evento queda en la cola y, cuando hay relés, flush() lo publica y el lector ve los dos;
//   (4) sin llave pública (canal apagado) no sale nada; el interruptor del diagnóstico apagado lo corta en autodiag.js (lo vigila autodiag.js).
// Uso: node diagchannel.js [dir_build]
'use strict';
const path = require('path');
const { importSrc } = require('./srcmod');
const { NostrRelay } = require('./nostr_relay');
const WebSocket = require('ws');
const reader = require('../../tools/diag_reader.cjs');

(async () => {
  const r = { prueba: 'diagchannel' };
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  const U1 = await r1.start(), U2 = await r2.start();
  const store = new Map();
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const { secp256k1 } = await import(require('url').pathToFileURL(path.join(__dirname, '.deps/node_modules/@noble/curves/secp256k1.js')).href);
  const { bytesToHex } = await import(require('url').pathToFileURL(path.join(__dirname, '.deps/node_modules/@noble/hashes/utils.js')).href);
  const priv = secp256k1.utils.randomSecretKey(), privHex = bytesToHex(priv), pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
  const other = bytesToHex(secp256k1.utils.randomSecretKey());
  global.window = { NEXO_NET_RELAYS: [U1, U2], NEXO_DIAG_CHANNEL_PUB: pubHex };
  const { NetLink } = await importSrc('net/net_link.js');
  const DC = await importSrc('ui/diag_channel.js');
  const mkNet = async (urls) => {
    const net = new NetLink({ localNexoId: 'nxa0000001', getBLEContacts: () => [] });
    urls.forEach((u) => net._connect(u));
    for (let i = 0; i < 100 && net.openRelayUrls().length < urls.length; i++) await sleep(50);
    return net;
  };
  const net = await mkNet([U1, U2]);
  global.window.bleInterface = { net };
  r.dos_reles = net.openRelayUrls().length === 2;
  r.disponible = DC.diagChannelAvailable() === true && DC.diagChannelPub() === pubHex;

  // (1) publicar un diagnóstico grande (~40 KB de registro típico, comprimible)
  const lines = []; for (let i = 0; i < 700; i++) lines.push('05:34:' + String(i % 60).padStart(2, '0') + '.' + (100 + i % 900) + ' [BLEInterface] Re-búsqueda de contactos ["nx1905c1ee","nx1ba0e10b"] intento ' + (i % 9));
  const TEXT = 'NEXO diagnóstico AUTOMÁTICO · síntoma: zombi (prueba) · build 2992\n' + lines.join('\n') + '\nSECRETO-EN-CLARO-123';
  r.texto_kb = Math.round(TEXT.length / 1024);
  const ok1 = await DC.diagChannelSend('zombi', 'prueba', TEXT, '2992');
  r.publica = ok1 === true;
  await sleep(300);
  const evs1 = r1.events.filter((e) => e.kind === 1065), evs2 = r2.events.filter((e) => e.kind === 1065);
  r.en_los_dos_reles = evs1.length === 1 && evs2.length === 1;
  const ev = evs1[0] || {};
  const tag = (ev.tags || []).find((t) => t[0] === 't');
  r.etiqueta_y_caducidad = !!tag && tag[1] === DC.diagChannelTag(pubHex) && (ev.tags || []).some((t) => t[0] === 'expiration' && Number(t[1]) > Date.now() / 1000 + 6 * 86400);
  r.contenido_cifrado = typeof ev.content === 'string' && Buffer.from(ev.content, 'base64').toString('latin1').indexOf('SECRETO-EN-CLARO') < 0 && ev.content.indexOf('SECRETO') < 0;
  r.cabe_en_el_rele = JSON.stringify(ev).length < 65536;
  r.contenido_kb = Math.round((ev.content || '').length / 1024);

  // (2) el lector lo descifra
  const rd = await reader.readDiagnostics({ privHex, relays: [U1, U2], sinceSec: Math.floor(Date.now() / 1000) - 3600, WebSocket, timeoutMs: 8000 });
  r.lector_recibe_uno = rd.list.length === 1 && rd.bad.firma === 0 && rd.bad.descifrado === 0;
  const e = rd.list[0] || {};
  r.lector_descifra = e.sym === 'zombi' && e.info === 'prueba' && e.build === '2992' && e.text === TEXT;
  const rdBad = await reader.readDiagnostics({ privHex: other, relays: [U1], sinceSec: 0, WebSocket, timeoutMs: 8000 });
  r.otra_llave_no_ve_nada = rdBad.list.length === 0;           // otra privada tiene OTRA etiqueta: ni siquiera pide estos eventos
  const direct = await reader.openDiag(ev.content, other).then(() => false, () => true);
  r.otra_llave_no_descifra = direct === true;
  r.evento_alterado_se_descarta = (await reader.eventOk(Object.assign({}, ev, { content: ev.content.slice(0, -4) + 'AAAA' }))) === false && (await reader.eventOk(ev)) === true;

  // (3) sin relé abierto: cola y reintento
  const netOff = await mkNet([]);
  global.window.bleInterface = { net: netOff };
  const ok2 = await DC.diagChannelSend('resumen_diario', '2026-11-09', 'RESUMEN\nmensajes enviados: 3', '2992');
  r.sin_rele_en_cola = ok2 === false && DC.diagChannelPub() === pubHex && JSON.parse(store.get('nexo_diagch_out') || '[]').length === 1;
  global.window.bleInterface = { net };
  const salieron = await DC.diagChannelFlush();
  r.flush_publica = salieron === 1 && JSON.parse(store.get('nexo_diagch_out') || '[]').length === 0;
  await sleep(300);
  const rd2 = await reader.readDiagnostics({ privHex, relays: [U1, U2], sinceSec: Math.floor(Date.now() / 1000) - 3600, WebSocket, timeoutMs: 8000 });
  r.lector_ve_los_dos = rd2.list.length === 2 && rd2.list.some((x) => x.sym === 'resumen_diario' && /mensajes enviados: 3/.test(x.text));

  // (4) sin pública: canal apagado
  global.window.NEXO_DIAG_CHANNEL_PUB = 'nada';
  const n0 = r1.events.length;
  r.apagado_no_sale = DC.diagChannelAvailable() === false && (await DC.diagChannelSend('x', 'y', 'z', '1')) === false && r1.events.length === n0;

  const keys = ['dos_reles', 'disponible', 'publica', 'en_los_dos_reles', 'etiqueta_y_caducidad', 'contenido_cifrado', 'cabe_en_el_rele', 'lector_recibe_uno', 'lector_descifra', 'otra_llave_no_ve_nada', 'otra_llave_no_descifra', 'evento_alterado_se_descarta', 'sin_rele_en_cola', 'flush_publica', 'lector_ve_los_dos', 'apagado_no_sale'];
  const ok = keys.every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('DIAGCHANNEL ' + JSON.stringify(r));
  await r1.stop(); await r2.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('DIAGCHANNEL ' + JSON.stringify({ prueba: 'diagchannel', resultado: 'FALLO', error: String(e && e.stack || e).slice(0, 400) })); process.exit(1); });
