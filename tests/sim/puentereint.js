// 3354 (dueño 27-11, diag. S24 21:53 y 23:33, builds 3160/3161): 6 paquetes de puente (sxmwy5…) salían con 5 reintentos SEGUIDOS cada uno
// (~1–3 s entre ellos) y otra vez a los 10 min: por internet, cada reintento es un sobre más al relé que ya limitaba → damus «banned».
// Ahora el puente manda cada paquete UNA vez por internet (el relé lo guarda) y espera la confirmación 8 s; por Bluetooth/Wi-Fi, 1 reintento.
// Si no confirma, decide su calendario (_hopFail: 15 s, 30 s… hasta 10 min), uno solo. Contraprueba: un envío normal (sin opciones)
// mantiene sus 5 reintentos. Uso: node puentereint.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const r = { prueba: 'puentereint' };
  const noop = () => {};
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop; global.window.dispatchEvent = noop;
  global.document = global.document || { addEventListener: noop, removeEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop }), body: { appendChild: noop }, documentElement: { style: {} }, visibilityState: 'visible' };
  const { BleAckSystem } = await importSrc('ui/ble_ack.js');
  const m = await importSrc('ui/ble_relay.js');

  // (1) BleAckSystem real: cuántas veces sale un paquete que nadie confirma
  const ackOf = () => { const a = Object.create(BleAckSystem.prototype); a.pendingAcks = new Map(); a.maxRetries = 5; a.sends = 0; a.ble = { _sendRawNative: () => { a.sends++; return Promise.resolve(); }, _sendMessageNative: () => Promise.resolve() }; return a; };
  const a0 = ackOf(); let rej0 = false;
  a0.sendRawWithRetry('net:nxb0000001', '{}', 'sxprueba1', { maxRetries: 0, ackWaitMs: 30 }).catch(() => { rej0 = true; });
  await sleep(200);
  r.internet_un_solo_envio = a0.sends === 1 && rej0 && !a0.pendingAcks.has('sxprueba1');
  const a1 = ackOf();
  a1.sendRawWithRetry('AA:BB:CC:DD:EE:01', '{}', 'sxprueba2', { maxRetries: 1, ackWaitMs: 30 }).catch(noop);
  await sleep(250);
  r.bluetooth_un_reintento = a1.sends === 2;
  // contraprueba: sin opciones, lo de siempre (5 reintentos); se acelera con ackWaitMs para no esperar ~10 s
  const a2 = ackOf();
  a2.sendRawWithRetry('AA:BB:CC:DD:EE:01', '{}', 'sxprueba3', { ackWaitMs: 20 }).catch(noop);
  await sleep(400);
  r.contraprueba_normal_5 = a2.sends === 6;
  // una confirmación a tiempo para todo (el paquete no se vuelve a mandar)
  const a3 = ackOf(); let ok3 = false;
  a3.sendRawWithRetry('net:nxb0000001', '{}', 'sxprueba4', { maxRetries: 0, ackWaitMs: 200 }).then(() => { ok3 = true; });
  await sleep(20); a3.handleCustody('sxprueba4'); await sleep(250);
  r.confirmado_no_reenvia = ok3 && a3.sends === 1;

  // (2) El puente pide esas opciones según el camino del siguiente salto
  const pedidas = [];
  const rel = Object.create(m.BleRelay.prototype);
  rel._sending = new Set(); rel._hopFail = new Map(); rel.queue = []; rel.me = () => 'nx1n36c283';
  rel.ble = { ackSystem: { sendRawWithRetry: (dev, data, id, o) => { pedidas.push({ dev, o }); return Promise.reject(new Error('ACK timeout')); } } };
  rel.nextHop = (dst) => ({ deviceId: dst === 'nxaaaaaaaa' ? 'net:nxaaaaaaaa' : '22:22:22:22:22:22', direct: true, via: 'x' });
  rel._touch = noop; rel._saveQueue = noop; rel._drop = noop; rel._remove = function(it) { this.queue = this.queue.filter((q) => q !== it); };
  rel._flushQueue = noop; rel._seenRecently = () => false; rel._connectNearby = noop; rel.canRelay = () => true; rel.discover = noop;
  const item = (id, dst) => ({ id, kind: 'pkt', reliable: true, dst, origin: 'nx0g6ef54e', data: '{}', prev: '', ts: Date.now(), tries: 0 });
  const iNet = item('sxmwy5a', 'nxaaaaaaaa'), iBt = item('sxmwy5b', 'nxbbbbbbbb');
  rel.queue.push(iNet, iBt); rel._trySend(iNet); rel._trySend(iBt);
  await sleep(30);
  const pn = pedidas.find((p) => p.dev.startsWith('net:')), pb = pedidas.find((p) => p.dev.startsWith('22:'));
  r.puente_internet_pide_1 = !!(pn && pn.o && pn.o.maxRetries === 0);
  r.puente_bt_pide_1_reintento = !!(pb && pb.o && pb.o.maxRetries === 1);
  // tras no confirmar, el MISMO paquete no sale al momento: espera su turno del calendario
  const antes = pedidas.length; rel._trySend(iNet); await sleep(20);
  r.calendario_espera = pedidas.length === antes && rel._hopFail.size === 2;
  if (rel._hopFail) rel._hopFail.forEach((v) => { if (v.timer) clearTimeout(v.timer); });

  const ok = Object.keys(r).filter((k) => k !== 'prueba').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PUENTEREINT ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PUENTEREINT ' + JSON.stringify({ prueba: 'puentereint', error: String(e && e.stack || e).slice(0, 500), resultado: 'FALLO' })); process.exit(1); });
