// 3357 (dueño 27-11, docs/ENRUTADO_27-11.md §4; diag. S24 21:53 y 23:33: decenas de sobres de golpe → relés «rate-limited» → «banned»):
// cupo de sobres por minuto. Con 2 relés de prueba reales (NetLink de verdad):
//  C1  sin límites recientes: 90 sobres PESADOS (trozos del buzón de archivos) en un minuto salen sin esperar; el 91.º espera su turno;
//  C2  los TEXTOS nunca esperan, aunque el cupo esté lleno;
//  C3  tras un límite de un relé, el cupo baja a 30/min y lo pesado sale repartido (uno cada 2 s);
//  C4  contraprueba: al relé propio (only = propio) no se aplica.
// Uso: node cuporele.js [dir_build]
'use strict';
const { NostrRelay } = require('./nostr_relay');
const { importSrc } = require('./srcmod');
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

(async () => {
  const r = { prueba: 'cuporele' };
  const r1 = new NostrRelay(), r2 = new NostrRelay();
  const U1 = await r1.start(), U2 = await r2.start();
  global.window = { NEXO_NET_RELAYS: [U1, U2] };
  const { NetLink } = await importSrc('net/net_link.js');
  const S = await importSrc('net/net_link_shared.js');
  const net = new NetLink({ localNexoId: 'nxa0000001', getBLEContacts: () => [] });
  [U1, U2].forEach((u) => net._connect(u));
  for (let i = 0; i < 100 && net.openRelayUrls().length < 2; i++) await sleep(50);
  const blob = () => ({ kind: S.BLOB_KIND, content: 'x'.repeat(100) });
  const text = () => ({ kind: S.KIND, content: 'y'.repeat(100) });

  // C1: 90 sobres en el último minuto
  for (let i = 0; i < 90; i++) net._quotaNote();
  const w1 = net._quotaWait(blob());
  net._pubTimes = []; net._quotaNextAt = 0;
  for (let i = 0; i < 89; i++) net._quotaNote();
  r.C1_dentro_del_cupo_sale = net._quotaWait(blob()) === 0;
  r.C1_pasado_el_cupo_espera = w1 > 50000; // el primero de la ventana libera su sitio dentro de ~60 s
  // C2: el texto no espera nunca
  for (let i = 0; i < 200; i++) net._quotaNote();
  r.C2_texto_sale_ya = net._quotaWait(text()) === 0;
  // C3: tras un límite, 30/min y repartido
  net._pubTimes = []; net._quotaNextAt = 0; net._limitAt = Date.now();
  for (let i = 0; i < 30; i++) net._quotaNote();
  const a = net._quotaWait(blob()), b = net._quotaWait(blob());
  r.C3_tras_limite_baja_y_reparte = a > 50000 && Math.round((b - a) / 100) === 20;
  net._limitAt = 0; net._pubTimes = []; net._quotaNextAt = 0;
  // integración: publishEach cuenta y sale; con el cupo lleno, un trozo pesado tarda
  const ok0 = await net.publishEach(Object.assign(net.blobEvent(net.randomKey(), 'QUJD', Math.floor(Date.now() / 1000) + 600)), 3000);
  r.publica_y_cuenta = ok0.length === 2 && net._pubTimes.length === 1;
  // C4: al relé propio no (simulado: la lista propia es U1)
  net._ownList = () => [U1]; net._isOwn = (u) => u === U1;
  for (let i = 0; i < 200; i++) net._quotaNote();
  const t0 = Date.now();
  await net.publishEach(net.blobEvent(net.randomKey(), 'REVG', Math.floor(Date.now() / 1000) + 600), 3000, { only: [U1] });
  r.C4_propio_sin_cupo = Date.now() - t0 < 2000;

  const ok = Object.keys(r).filter((k) => k !== 'prueba').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('CUPORELE ' + JSON.stringify(r));
  [r1, r2].forEach((q) => q.stop());
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('CUPORELE ' + JSON.stringify({ prueba: 'cuporele', resultado: 'FALLO', error: String(e && e.stack || e).slice(0, 400) })); process.exit(1); });
