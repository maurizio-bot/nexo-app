// 3239 (diagnóstico del dueño 18-11 11:43: 50 paquetes «sx» para otro teléfono salieron TODOS a la vez hacia el mismo siguiente teléfono y al
// no confirmar ninguno se reintentaron los 50 cada ~2 s): hacia el mismo siguiente teléfono van como mucho HOP_MAX_PAR a la vez; al
// terminar uno sale el siguiente; hacia otro teléfono no se estorban; lo que no es «con confirmación» no cuenta.
// Uso: node puentetope.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'puentetope' };
  const noop = () => {};
  global.window = global; global.window.addEventListener = noop; global.window.removeEventListener = noop;
  global.document = global.document || { addEventListener: noop, removeEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add: noop, remove: noop }, addEventListener: noop, appendChild: noop, setAttribute: noop }), body: { appendChild: noop }, documentElement: { style: {} }, visibilityState: 'visible' };
  const m = await importSrc('ui/ble_relay.js');
  const MAX = m.HOP_MAX_PAR === undefined ? 6 : m.HOP_MAX_PAR;
  const salidas = [];
  const resolvers = [];
  const hacia = (dev) => ({ deviceId: dev, direct: true, via: 'x' });
  const nuevo = () => {
    const rel = Object.create(m.BleRelay.prototype);
    rel._sending = new Set(); rel._hopFail = new Map();
    rel.queue = [];
    rel.me = () => 'nx1n36c283';
    rel.ble = { ackSystem: { sendRawWithRetry: (dev, data, id) => { salidas.push(dev + '|' + id); return new Promise((ok, ko) => resolvers.push({ ok, ko, id })); } } };
    rel.nextHop = (dst) => hacia(dst === 'nxaaaaaaaa' ? '11:11:11:11:11:11' : '22:22:22:22:22:22');
    rel._touch = noop; rel._saveQueue = noop; rel._drop = noop;
    rel._remove = function(it) { this.queue = this.queue.filter((q) => q !== it); };
    rel._flushQueue = function() { this.queue.slice().forEach((it) => this._trySend(it)); };
    rel._seenRecently = () => false; rel._connectNearby = noop; rel.canRelay = () => true; rel.discover = noop;
    return rel;
  };
  const rel = nuevo();
  const item = (i, dst) => ({ id: 'sx' + i, kind: 'pkt', reliable: true, dst: dst || 'nxaaaaaaaa', origin: 'nx0g6ef54e', data: '{}', prev: '', ts: Date.now(), tries: 0 });
  for (let i = 0; i < 50; i++) { const it = item(i); rel.queue.push(it); rel._trySend(it); }
  r.salen_solo_el_tope = salidas.length === MAX;
  // otro siguiente teléfono no se estorba
  const otro = item(900, 'nxbbbbbbbb'); rel.queue.push(otro); rel._trySend(otro);
  r.otro_telefono_sale = salidas.length === MAX + 1;
  // al confirmarse uno, sale el siguiente
  resolvers[0].ok();
  await new Promise((res) => setTimeout(res, 30));
  r.al_terminar_uno_sale_otro = salidas.filter((s) => s.startsWith('11:11')).length === MAX + 1;
  r.nunca_pasa_del_tope = (() => { return salidas.filter((s) => s.startsWith('11:11')).length - 1 <= MAX; })();
  r.resultado = ['salen_solo_el_tope', 'otro_telefono_sale', 'al_terminar_uno_sale_otro', 'nunca_pasa_del_tope'].every((k) => r[k]) ? 'OK' : 'FALLO';
  r.salieron = salidas.length;
  console.log('PUENTETOPE ' + JSON.stringify(r));
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.log('PUENTETOPE ' + JSON.stringify({ prueba: 'puentetope', error: String(e && e.stack || e).slice(0, 500), resultado: 'FALLO' })); process.exit(1); });
