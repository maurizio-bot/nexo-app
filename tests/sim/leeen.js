// Fase 1 (internet) del contrato de los caminos, 28-11 (docs/CONTRATO_CAMINOS_28-11.md §B.5): «dónde leo» y «publicar donde el otro lee».
// Caso real: diag. S24 27-11 21:53 (3160): los relés de siempre del S24 limitaban, entraban los de RESERVA y lo que salía solo por ellos daba ✓
// sin llegar nunca (el S23 no los leía). Relés simulados: 2 de siempre (r0, r1), 2 de reserva (s0 que A solo escucha, s1 que A usa para publicar).
//  E1  el saludo lleva mi lista de lectura (lr) y quien lo recibe la guarda (sobrevive en el estado; caduca a las 24 h);
//  E2  B lee en r0, r1 y s0; r0 y r1 en pausa: el sobre va SOLO a s0 (una reserva que A solo escucha) y no a s1 (que B no lee);
//  E3  B lee solo en r0 y r1, los dos en pausa: queda pendiente al momento SIN mandar nada (y lo reconoce como espera, no como fallo);
//  E4  ninguno de los de B abierto: pendiente «en espera» sin mandar nada; un anuncio con relés que no conozco se ignora (como hasta hoy);
//  E5  sin anuncio: como hasta la 3167 (los míos abiertos sin pausa que no son solo de escucha);
//  E6  la parte nativa recibe lo mismo: lo que escucho (también lo), dónde lee cada contacto y las pausas; y las pausas que pone el nativo
//      se respetan al volver la app.
// Uso: node leeen.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
const { NostrRelay } = require('./nostr_relay');
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

(async () => {
  const r = { prueba: 'leeen' };
  const relays = [new NostrRelay(), new NostrRelay(), new NostrRelay(), new NostrRelay()];
  const U = [];
  for (const x of relays) U.push(await x.start());
  const [R0, R1, S0, S1] = U;
  global.window = { NEXO_NET_RELAYS: [R0, R1], NEXO_SPARE_RELAYS: [S0, S1] };
  const { NetLink } = await importSrc('net/net_link.js');
  const S = await importSrc('net/net_link_shared.js');
  const H = await importSrc('ui/ble_helpers.js');
  const net = new NetLink({ localNexoId: 'nxa0000001', getBLEContacts: () => [] });
  U.forEach((u) => net._connect(u));
  for (let i = 0; i < 100 && net.openRelayUrls().length + 0 < 4 && [...net.relays.values()].filter((x) => x.open).length < 4; i++) await sleep(50);
  // A: s0 solo de escucha, s1 en uso para publicar
  net.relays.get(S0).lo = true; net.relays.get(S1).lo = false;
  const mk = () => S.netMakeEvent(net.randomKey(), S.KIND, [['p', 'ab'.repeat(32)], ['expiration', String(Math.floor(Date.now() / 1000) + 600)]], 'x'.repeat(40));
  const evs = () => relays.map((x) => x.stats.published);
  const B = 'nxb0000001';

  // E1
  const lr = net.myReads();
  net._deliver(B, { h: 1, t: Date.now(), w: 1, lr: [R0, R1, S0] });
  r.mi_lista = lr.length;
  r.guardado = JSON.stringify(net.state.peerLee && net.state.peerLee[B] && net.state.peerLee[B].lee);
  r.E1 = lr.length === 4 && [R0, R1, S0].every((u) => (net.peerReads(B) || []).indexOf(u) >= 0);

  // E2
  const far = Date.now() + 60000;
  net.relays.get(R0).coolUntil = far; net.relays.get(R1).coolUntil = far;
  const e0 = evs();
  const ok2 = await net._publish(mk(), null, B).then(() => true, (e) => String(e.message));
  await sleep(200);
  const e1 = evs();
  r.E2_reparto = e1.map((v, i) => v - e0[i]);
  r.E2 = ok2 === true && r.E2_reparto.join() === '0,0,1,0';

  // E3
  net._deliver(B, { h: 1, t: Date.now() + 1, w: 1, lr: [R0, R1] });
  const err3 = await net._publish(mk(), null, B).then(() => null, (e) => e);
  await sleep(200);
  const e2 = evs();
  r.E3_mandados = e2.reduce((a, b) => a + b, 0) - e1.reduce((a, b) => a + b, 0);
  r.E3 = !!err3 && err3.code === 'NET_REJECTED' && H._resendWaitErr(err3) && H._failStatus(err3) === 'pending' && r.E3_mandados === 0;

  // E4
  net.relays.get(R0).coolUntil = 0; net.relays.get(R1).coolUntil = 0;
  const w0 = net.relays.get(R0).ws, w1 = net.relays.get(R1).ws;
  net.relays.get(R0).open = false; net.relays.get(R1).open = false;
  const err4 = await net._publish(mk(), null, B).then(() => null, (e) => e);
  net.relays.get(R0).open = true; net.relays.get(R1).open = true;
  const e3 = evs();
  r.E4_mandados = e3.reduce((a, b) => a + b, 0) - e2.reduce((a, b) => a + b, 0);
  net._deliver(B, { h: 1, t: Date.now() + 2, w: 1, lr: ['wss://relay.de-otro.example'] });
  r.E4_ajeno = net.peerReads(B);
  r.E4 = !!err4 && H._resendWaitErr(err4) && H._failStatus(err4) === 'pending' && r.E4_mandados === 0 && r.E4_ajeno === null && !!w0 && !!w1;

  // E5
  net.relays.get(S0).lo = true; net.relays.get(S1).lo = false; net._spareCheck = () => {}; net._spareOn = [S1];
  const ok5 = await net._publish(mk(), null, 'nxc0000001').then(() => true, () => false);
  await sleep(200);
  const e4 = evs();
  r.E5_reparto = e4.map((v, i) => v - e3[i]);
  r.E5 = ok5 && r.E5_reparto.join() === '1,1,0,1';

  // E6
  net._deliver(B, { h: 1, t: Date.now() + 3, w: 1, lr: [R0, S0] });
  net.relays.get(R1).coolUntil = Date.now() + 90000; net.relays.get(R1).limitKind = 'rate'; net.relays.get(R1).limitN = 1; net.relays.get(R1).limitAt = Date.now();
  let cfg = null;
  const pl = { netBgConfig: async (c) => { cfg = c; return {}; }, netBgDrain: async () => ({ events: [], gaps: {}, cool: { [R0]: { kind: 'ban', n: 1, at: Date.now(), hasta: Date.now() + 600000 } } }) };
  net._netContacts = () => [{ nexoId: B, publicKey: 'x', name: 'B', nt: 1 }];
  net._pair = async () => ({ kraw: new Uint8Array(32) });
  global.window.Capacitor = { Plugins: { NexoBLE: pl } };
  await net._bgConfig();
  r.E6_cfg = cfg ? { lo: cfg.lo, lee: cfg.contacts && cfg.contacts[0] && cfg.contacts[0].lee, cool: Object.keys(cfg.cool || {}) } : 'sin llamada';
  await net._drainBg();
  r.E6_pausa_del_nativo = net.relayCooling(net.relays.get(R0));
  r.E6 = !!cfg && cfg.lo.join() === S0 && net.relays.get(S0).lo === true && (cfg.contacts[0].lee || []).join() === [R0, S0].join() && cfg.cool[R1] && cfg.cool[R1].hasta > Date.now() && r.E6_pausa_del_nativo === true;

  const ok = r.E1 && r.E2 && r.E3 && r.E4 && r.E5 && r.E6;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('LEEEN ' + JSON.stringify(r));
  try { net._closeAll(); net.relays.forEach((x) => { x.retryAt = Date.now() + 9e6; }); clearInterval(net._timer); } catch (e) {}
  for (const x of relays) await x.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('LEEEN {"resultado":"FALLO","error":' + JSON.stringify(String(e && e.stack)) + '}'); process.exit(1); });
