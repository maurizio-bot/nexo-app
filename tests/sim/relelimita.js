// 3348 (diagnósticos del dueño 26-11 14:47–17:11, builds 3156/3159: 4 textos al S23 con «!»; los relés decían «rate-limited: too many
// gift wraps from this address» y luego «banned: too many rate-limit violations»; otro, «Policy violated and pubkey is not in our web
// of trust»). Antes cada sobre seguía yendo a TODOS los relés abiertos aunque uno ya limitara: cada uno era otra infracción → castigo.
// Ahora (relé simulado con el «no» de cada caso):
//  L1  el relé que limita / castiga / no nos deja queda en pausa para publicar (cada uno con su tipo) y los siguientes sobres NO le llegan;
//      el que acepta los recibe todos;
//  L2  entra el relé de reserva (en pausa = caído para la reserva);
//  L3  con TODOS en pausa, el envío queda pendiente al momento (NET_REJECTED que ble_ack reconoce como límite) sin mandar nada;
//  L4  tras la pausa se prueba otra vez y, si vuelve a decir que no, la pausa se dobla;
//  L5  tras un límite, lo PESADO sale con un respiro entre evento y evento y lo pequeño (un texto) sale sin esperar;
//  L6  un «no» que no es límite (duplicado, inválido, falta identificarse) no pone en pausa; las pausas: 20 s → 40 s … 10 min,
//      castigo 10 min …, política 6 h.
// Uso: node relelimita.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
const { NostrRelay } = require('./nostr_relay');
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

(async () => {
  const r = { prueba: 'relelimita' };
  const SAY = ['rate-limited: too many gift wraps from this address, try again later', 'banned: too many rate-limit violations, try again later', 'blocked: Policy violated and pubkey is not in our web of trust'];
  const relays = [new NostrRelay({ refuse: () => SAY[0] }), new NostrRelay({ refuse: () => SAY[1] }), new NostrRelay({ refuse: () => SAY[2] }), new NostrRelay(), new NostrRelay()];
  const U = [];
  for (const x of relays) U.push(await x.start());
  global.window = { NEXO_NET_RELAYS: U.slice(0, 4), NEXO_SPARE_RELAYS: [U[4]] };
  const { NetLink } = await importSrc('net/net_link.js');
  const S = await importSrc('net/net_link_shared.js');
  const P = await importSrc('net/net_publish.js');
  const net = new NetLink({ localNexoId: 'nxa0000001', getBLEContacts: () => [] });
  U.slice(0, 4).forEach((u) => net._connect(u));
  for (let i = 0; i < 100 && net.openRelayUrls().length < 4; i++) await sleep(50);
  const mk = (len) => S.netMakeEvent(net.randomKey(), S.KIND, [['p', 'ab'.repeat(32)], ['expiration', String(Math.floor(Date.now() / 1000) + 600)]], 'x'.repeat(len || 40));
  const evs = () => relays.map((x) => x.stats.events || 0);
  const rel = (i) => net.relays.get(U[i]);

  // L1
  r.primero_sale = await net._publish(mk()).then(() => true, () => false);
  await sleep(300);
  r.pausa = [0, 1, 2, 3].map((i) => (net.relayCooling ? net.relayCooling(rel(i)) : false)); // contraprueba: sin 3348 no existe
  r.tipos = [0, 1, 2].map((i) => rel(i).limitKind);
  for (let i = 0; i < 6; i++) await net._publish(mk());
  await sleep(200);
  const e1 = evs();
  r.eventos_por_rele = e1.slice(0, 4);
  r.L1 = r.primero_sale && r.pausa.join() === 'true,true,true,false' && r.tipos.join() === 'rate,ban,policy' && e1[0] === 1 && e1[1] === 1 && e1[2] === 1 && e1[3] === 7;

  // contraprueba (CONTRA=1 con el build de antes de 3348): los 7 sobres le llegan también a los que limitan
  if (process.env.CONTRA) { console.log('RELELIMITA_CONTRA ' + JSON.stringify({ eventos_por_rele: r.eventos_por_rele, L1: r.L1 })); process.exit(r.L1 ? 1 : 0); }

  // L2
  for (let i = 0; i < 60 && !(rel(4) && rel(4).open); i++) await sleep(50);
  r.L2 = !!(rel(4) && rel(4).open) && (net._spareOn || []).indexOf(U[4]) >= 0;

  // L3
  const far = Date.now() + 60000;
  rel(3).coolUntil = far; if (rel(4)) rel(4).coolUntil = far;
  const before = evs().reduce((a, b) => a + b, 0);
  const t0 = Date.now();
  const err = await net._publish(mk()).then(() => null, (e) => e);
  const after = evs().reduce((a, b) => a + b, 0);
  const isLimit = (e) => { const m = String((e && e.message) || ''); return /Rechazado por los relés/.test(m) && /rate.?limit|slow down|too many|banned/i.test(m); }; // como ble_ack _relayLimited
  r.todos_en_pausa = { codigo: err && err.code, ms: Date.now() - t0, mandados: after - before };
  r.L3 = !!err && err.code === 'NET_REJECTED' && isLimit(err) && Date.now() - t0 < 500 && after === before;
  rel(3).coolUntil = 0; if (rel(4)) rel(4).coolUntil = 0;

  // L4
  const c1 = rel(0).coolUntil - rel(0).limitAt;
  rel(0).coolUntil = 0;
  await net._publish(mk());
  await sleep(300);
  const c2 = rel(0).coolUntil - rel(0).limitAt;
  r.pausas_rele_que_limita_s = [Math.round(c1 / 1000), Math.round(c2 / 1000)];
  r.L4 = evs()[0] === 2 && c1 === 20000 && c2 === 40000;

  // L5 (seguimos dentro de la calma de 5 min tras el límite)
  const got = [];
  relays[3].opts.refuse = (ev) => { if (ev.content.length > 4000) got.push(Date.now()); return null; };
  const tb = Date.now();
  const bulk = [mk(5000), mk(5000), mk(5000)].map((e) => net._publish(e));
  const ts = Date.now();
  await net._publish(mk(60));
  const smallMs = Date.now() - ts;
  await Promise.all(bulk);
  const gaps = got.slice(1).map((t, i) => t - got[i]);
  r.pesado_respiro_ms = gaps; r.texto_ms = smallMs;
  r.L5 = got.length === 3 && gaps.every((g) => g >= 1000) && smallMs < 800 && Date.now() - tb >= 2000;

  // L6
  r.L6 = P.relayLimitKind('duplicate: already have this event') === '' && P.relayLimitKind('invalid: event too large') === '' && P.relayLimitKind('auth-required: we only accept events from registered users') === '' &&
    P.relayLimitKind('rate-limited: slow down matey') === 'rate' && P.relayLimitKind('banned: too many rate-limit violations') === 'ban' && P.relayLimitKind(SAY[2]) === 'policy' &&
    P.relayCoolMs('rate', 1) === 20000 && P.relayCoolMs('rate', 2) === 40000 && P.relayCoolMs('rate', 20) === 600000 &&
    P.relayCoolMs('ban', 1) === 600000 && P.relayCoolMs('ban', 9) === 7200000 && P.relayCoolMs('policy', 1) === 6 * 3600000;

  const ok = r.L1 && r.L2 && r.L3 && r.L4 && r.L5 && r.L6;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RELELIMITA ' + JSON.stringify(r));
  try { net._closeAll(); net.relays.forEach((x) => { x.retryAt = Date.now() + 9e6; }); clearInterval(net._timer); } catch (e) {}
  for (const x of relays) await x.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('RELELIMITA {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
