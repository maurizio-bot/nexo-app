// 3137 — GUARDIANES DE FÉNIX ELEGIDOS POR LA APP SEGÚN CÓMO TE CONECTAS (dueño 15-11: «los guardianes los tiene que elegir la
// aplicación; si los elige el usuario, los puede elegir el impostor… si he tenido muchos contactos vía Bluetooth es una persona
// cercana… si nunca usé Bluetooth con alguien no lo puedo ocupar para recuperar por Bluetooth… si no hay, los más recientes, pero
// que sea una recuperación vía internet o Wi-Fi»). Antes: los 10 contactos con el último mensaje más reciente, sin mirar si se ven
// en persona (con todos en el extranjero no se podía recuperar: hay que estar cerca de 6).
//  C1  un día de Bluetooth se apunta una sola vez; se cuentan días distintos; lo de hace más de 90 días se olvida;
//  C2  orden: primero los cercanos (Bluetooth en ≥ 3 días), por días; luego los demás por el último mensaje, marcados «por internet»;
//  C3  reparto: los cercanos reciben fragmento y quedan «cercanos»; los huecos, los más recientes «por internet»;
//  C4  un contacto que pasa a ser cercano toma el fragmento de un guardián por internet (el menos reciente), como mucho 2 al día;
//  C5  solo cuenta el Bluetooth: una conexión por internet o Wi-Fi no suma días;
//  C6  el guardián sabe si es cercano o por internet (va en la entrega y lo guarda).
// Contraprueba: en la 3136 no existen _fenixNoteBt/_fenixRank (C1–C6 fallan).
// Uso: node fenixcerca.js <dir_build>
'use strict';
const { importSrc } = require('./srcmod');
const DAY = 86400000;
(async () => {
  const r = { prueba: 'fenixcerca' };
  global.window = global.window || { crypto: globalThis.crypto };
  const mod = await importSrc('fenix/fenix.js');
  const { _fenixNoteBt, _fenixBtDays, _fenixRank, Fenix } = mod;
  if (typeof _fenixNoteBt !== 'function' || typeof _fenixRank !== 'function') { r.resultado = 'FALLO'; r.error = 'sin elección por cercanía'; console.log('FENIXCERCA ' + JSON.stringify(r)); process.exit(1); }
  const NOW = Date.UTC(2026, 10, 15, 12);
  // C1
  const cl = {};
  _fenixNoteBt(cl, 'nxaaaaaaa1', NOW); _fenixNoteBt(cl, 'nxaaaaaaa1', NOW + 3600000);
  const oneDay = _fenixBtDays(cl, 'nxaaaaaaa1', NOW, 60);
  _fenixNoteBt(cl, 'nxaaaaaaa1', NOW + DAY); _fenixNoteBt(cl, 'nxaaaaaaa1', NOW + 2 * DAY);
  const threeDays = _fenixBtDays(cl, 'nxaaaaaaa1', NOW + 2 * DAY, 60);
  _fenixNoteBt(cl, 'nxaaaaaaa1', NOW + 100 * DAY, 90);
  const afterLong = _fenixBtDays(cl, 'nxaaaaaaa1', NOW + 100 * DAY, 60);
  r.C1 = { un_dia: oneDay, tres_dias: threeDays, tras_100_dias: afterLong, guardados: cl.nxaaaaaaa1.length };
  r.C1_ok = oneDay === 1 && threeDays === 3 && afterLong === 1 && cl.nxaaaaaaa1.length === 1;
  // C2
  const close = {};
  const days = (nx, n) => { for (let i = 0; i < n; i++) _fenixNoteBt(close, nx, NOW - i * DAY); };
  const mk = (n, last) => ({ nexoId: 'nx0000000' + n, name: 'C' + n, publicKey: 'k' + n, proto: 2, fx: 1, lastMessageAt: NOW - last * 60000 });
  const cs = [mk(1, 500), mk(2, 1), mk(3, 300), mk(4, 2), mk(5, 3), mk(6, 4)];
  days('nx00000001', 5); days('nx00000003', 3); days('nx00000004', 1); // C1 y C3 cercanos; C4 un solo día (no)
  const rank = _fenixRank(cs, close, NOW, { closeMinDays: 3, closeWinDays: 60 });
  r.C2_orden = rank.map((c) => c.name + ':' + c._fxVia).join(',');
  r.C2_ok = r.C2_orden === 'C1:bt,C3:bt,C2:net,C4:net,C5:net,C6:net';
  // C3–C6 con un Fenix de verdad y un «teléfono» de mentira
  let contacts = cs.map((c) => Object.assign({}, c));
  const sent = [];
  const ble = { localNexoId: 'nx0000000a', localDeviceName: 'Dueño', getBLEContacts: () => contacts, _foreground: false,
    _resolveDeviceIdForNexoId: () => null, _getDeviceState: () => ({}),
    ackSystem: { sendFile: async (dev, id, data) => { sent.push(JSON.parse(Buffer.from(data, 'base64').toString('utf8'))); } } };
  const fx = new Fenix(ble);
  fx.cfg = Object.assign({}, fx.cfg, { n: 4, t: 3, min: 4, mirror: 99, closeMinDays: 3, closeWinDays: 60, swapsPerDay: 2 });
  fx.close = close; fx.tick = () => {};
  fx.state = { v: 1, n: 4, t: 3, shares: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)], ep: 1, nodes: {}, blob: 'x', bh: 'y' };
  const realNow = Date.now; Date.now = () => NOW;
  fx._assign(fx._eligible());
  const viaOf = () => Object.keys(fx.state.nodes).filter((nx) => !fx.state.nodes[nx].lost).sort().map((nx) => nx.slice(-1) + ':' + fx.state.nodes[nx].via).join(',');
  r.C3_reparto = viaOf();
  r.C3_ok = r.C3_reparto === '1:bt,2:net,3:bt,4:net';
  // C4: C5 y C6 pasan a cercanos (3 días de Bluetooth); C4 también, pero solo 2 cambios al día
  ['nx00000005', 'nx00000006'].forEach((nx) => days(nx, 3));
  days('nx00000004', 3);
  const ch = fx._rebalance(fx._eligible());
  fx._assign(fx._eligible());
  r.C4_reparto = viaOf();
  const lostWhy = Object.keys(fx.state.nodes).filter((nx) => fx.state.nodes[nx].lost).map((nx) => nx.slice(-1) + ':' + fx.state.nodes[nx].why).sort().join(',');
  r.C4_salen = lostWhy;
  // C4 ya guardián pasa a cercano: conserva su fragmento y se le entrega de nuevo (ahora «cercano»); C2 (por internet) cede el suyo a C5
  r.C4_cambios_hoy = fx.state.swaps.n;
  r.C4_ok = ch && lostWhy === '2:cercano' && r.C4_reparto === '1:bt,3:bt,4:bt,5:bt' && fx.state.nodes.nx00000004.ep === -1 && fx.state.swaps.n === 1;
  // tope: 4 guardianes por internet y 3 contactos que pasan a cercanos el mismo día → solo 2 cambios
  const c2 = {}; const cs2 = [1, 2, 3, 4, 5, 6, 7].map((n) => mk(n, n));
  let contacts2 = cs2;
  const fx2 = new Fenix(Object.assign({}, ble, { getBLEContacts: () => contacts2 }));
  fx2.cfg = fx.cfg; fx2.close = c2; fx2.tick = () => {};
  fx2.state = { v: 1, n: 4, t: 3, shares: fx.state.shares, ep: 1, nodes: {} };
  fx2._assign(fx2._eligible()); // C1–C4 por internet (los más recientes)
  [5, 6, 7].forEach((n) => { for (let i = 0; i < 3; i++) _fenixNoteBt(c2, 'nx0000000' + n, NOW - i * DAY); });
  fx2._rebalance(fx2._eligible()); fx2._assign(fx2._eligible());
  const near2 = Object.keys(fx2.state.nodes).filter((nx) => !fx2.state.nodes[nx].lost && fx2.state.nodes[nx].via === 'bt').length;
  r.C4_tope = { cambios: fx2.state.swaps.n, cercanos: near2 };
  r.C4_tope_dia = fx2.state.swaps.n === 2 && near2 === 2;
  // C5: solo Bluetooth suma
  const c5 = {}; fx.close = c5;
  fx.markPeer('nx00000002', 'netnx00000002', 1); fx.markPeer('nx00000002', 'lannx00000002', 1);
  const viaNet = _fenixBtDays(c5, 'nx00000002', NOW, 60);
  fx.markPeer('nx00000002', 'AA:BB:CC:DD:EE:02', 1);
  r.C5 = { por_internet_o_wifi: viaNet, por_bluetooth: _fenixBtDays(c5, 'nx00000002', NOW, 60) };
  r.C5_ok = viaNet === 0 && r.C5.por_bluetooth === 1;
  // C6: la entrega dice si es cercano o por internet y el guardián lo guarda
  fx.close = close;
  const nodeNet = { idx: 1, via: 'net', ep: -1 }, nodeBt = { idx: 2, via: 'bt', ep: -1 };
  fx.state.nodes.nx00000008 = nodeNet; fx.state.nodes.nx00000009 = nodeBt;
  fx._saveState = async () => {};
  await fx._put('nx00000008', 'dev8', nodeNet); await fx._put('nx00000009', 'dev9', nodeBt);
  const g = new Fenix({ localNexoId: 'nx0000000g' }); g.cfg = fx.cfg; g._saveStore = async () => {};
  for (const pl of sent) await g._onPut(pl, 'nx0000000a');
  r.C6 = { entregas: sent.map((p) => p.rv).join(','), guardado: g.store.owners.nx0000000a && g.store.owners.nx0000000a.rv };
  r.C6_ok = r.C6.entregas === 'net,bt' && r.C6.guardado === 'bt';
  Date.now = realNow;
  const ok = r.C1_ok && r.C2_ok && r.C3_ok && r.C4_ok && r.C4_tope_dia && r.C5_ok && r.C6_ok;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FENIXCERCA ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FENIXCERCA ' + JSON.stringify({ prueba: 'fenixcerca', resultado: 'FALLO', error: String(e && e.stack).slice(0, 400) })); process.exit(1); });
