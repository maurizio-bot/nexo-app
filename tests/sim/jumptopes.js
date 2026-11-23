// Auditoría 23-11 (T-J1): topes de la malla Jump (ble_relay.js) contra alguien cerca que manda paquetes a mano.
//  ttl    un 'rq' con ttl 1000 se reparte con ttl ≤ MAX_HOPS-2 (antes, búsquedas sin fin)
//  hp     un paquete de paso con hp -100 sale con hp 1 (antes, saltos sin fin)
//  rq     de un mismo enlace se atienden ≤ 30 búsquedas por minuto; otro enlace sigue atendido
//  cola   60 paquetes de paso de un mismo vecino: en la cola quedan ≤ 50 suyos y lo de otro vecino no se pierde
//  rk     la custodia solo vale del enlace al que se dio el salto
//  seen   con 6000 ids recordados quedan ≤ 5000
// Uso: node jumptopes.js [dir_build]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { readsContentFallback: true, retain: ['onPayloadReceived'] });
  radio.add(nA); nA.load(); nA.listeners = new Map();
  const vc = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), { url: 'https://a.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: nA.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; } });
  const win = dom.window; for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100); await sleep(800);
  const ble = win.bleInterface, rel = ble.relay;
  const r = {}, mal = [], chk = (k, v) => { if (!v) mal.push(k); };
  rel.canRelay = () => true;
  rel._scan = () => Promise.resolve();
  const sent = [];
  ble._sendMessageNative = (dev, str) => { sent.push([dev, str]); return Promise.resolve(); };
  const X = 'CC:CC:CC:CC:CC:01', Y = 'DD:DD:DD:DD:DD:02';
  const rnd = () => Math.random().toString(36).slice(2, 10);
  const nx = () => 'nx' + (rnd() + '00000000').slice(0, 8);
  // ttl
  rel._handleRq({ type: 'rq', id: 'q-ttl', from: nx(), dst: nx(), ttl: 1000, path: [] }, X);
  const d = rel.discoveries.get('q-ttl');
  r.ttl_repartido = d ? d.ttl : null; chk('ttl_acotado', d && d.ttl <= 6);
  // rq por enlace
  for (let i = 0; i < 40; i++) rel._handleRq({ type: 'rq', id: 'q' + i, from: nx(), dst: nx(), ttl: 3, path: [] }, X);
  r.rq_atendidas_X = Array.from(rel.seen.keys()).filter((k) => /^rq:q\d+$/.test(k)).length;
  rel._handleRq({ type: 'rq', id: 'qY', from: nx(), dst: nx(), ttl: 3, path: [] }, Y);
  r.rq_Y_atendida = rel.seen.has('rq:qY');
  chk('rq_tope_por_enlace', r.rq_atendidas_X <= 30 && r.rq_atendidas_X >= 29 && r.rq_Y_atendida);
  // hp negativo
  const dst = nx();
  rel.intercept({ v: 1, type: 'ack', to: dst, from: nx(), msgId: 'hpneg', hp: -100 }, '', X);
  const it = rel.queue.find((q) => q.id === 'hpneg');
  r.hp_sale = it ? JSON.parse(it.data).hp : null; chk('hp_no_negativo', r.hp_sale === 1);
  // cuota de la cola por vecino
  rel.queue.forEach((q) => rel._drop(q)); rel.queue = [];
  rel.intercept({ v: 1, type: 'ack', to: dst, from: nx(), msgId: 'deY', hp: 0 }, '', Y);
  for (let i = 0; i < 60; i++) rel.intercept({ v: 1, type: 'ack', to: nx(), from: nx(), msgId: 'm' + i, hp: 0 }, '', X);
  r.cola_de_X = rel.queue.filter((q) => q.prev === 'cccccccccc01').length;
  r.cola_de_Y = rel.queue.filter((q) => q.prev === 'dddddddddd02').length;
  chk('cuota_por_vecino', r.cola_de_X <= 50 && r.cola_de_Y === 1);
  // rk solo del salto usado
  const ack = ble.ackSystem; let res = 0;
  ack.pendingAcks.set('rkid', { msgId: 'rkid', deviceId: X, resolve: () => { res++; }, reject: () => {}, timer: null, quiet: true });
  rel.intercept({ v: 1, type: 'rk', msgId: 'rkid', from: nx() }, '', Y);
  r.rk_otro_enlace = res;
  rel.intercept({ v: 1, type: 'rk', msgId: 'rkid', from: nx() }, '', X);
  r.rk_mismo_enlace = res;
  chk('rk_solo_del_salto', r.rk_otro_enlace === 0 && r.rk_mismo_enlace === 1);
  // seen con tope
  for (let i = 0; i < 6000; i++) rel._seenAdd('k' + i);
  r.seen = rel.seen.size; chk('seen_con_tope', r.seen <= 5000);
  r.fallos = mal; r.resultado = mal.length ? 'FALLO' : 'OK';
  console.log('JUMPTOPES ' + JSON.stringify(r));
  try { win.close(); } catch (e) {}
  process.exit(mal.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
