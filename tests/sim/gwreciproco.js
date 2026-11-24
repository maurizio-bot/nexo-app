// 3323 (dueño 24-11, decisión B: «lo que yo ayudo, me ayudan»): el que presta su internet da TEXTOS a cualquiera, pero fotos, audios y
// archivos solo a quien le ayudó en los últimos 30 días (le prestó su internet o le hizo de puente). Prueba del lado que presta (GwLink):
//  oferta_f0      a quien no me ayudó le ofrezco con f:0 (solo textos); a quien sí, f:1
//  texto_pasa     un texto (evento 1059 pequeño) sube al relé para cualquiera
//  trozo_no       un trozo del buzón de archivos (1064) de quien no me ayudó se rechaza como un relé («restricted»)
//  baja_no        lo grande que baja (> 16 KB) no se le pasa a quien no me ayudó
//  ayudante_si    a quien me ayudó: el trozo sube y lo grande baja
//  caduca         pasados 30 días, otra vez solo textos
//  cliente        el que pide: con un puente f:0 los archivos no salen por él (quedan ⏳); con f:1 o sin f (versión anterior), sí
// Uso: node gwreciproco.js
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  global.window = global.window || {};
  const { GwLink } = await importSrc('net/gw_link.js');
  const H = await importSrc('net/gw_helpers.js');
  const { netMakeEvent } = await importSrc('net/net_link.js');
  H._helpReset();
  const r = {}, mal = [], chk = (k, v) => { r[k] = !!v; if (!v) mal.push(k); };
  const R = 'wss://relay.example';
  const sent = [];
  const sockets = [];
  const net = {
    relays: new Map([[R, { open: true }]]), wifi: true,
    _newSocket(url) { const ws = { url, up: [], send(d) { this.up.push(d); }, close() {} }; sockets.push(ws); setTimeout(() => ws.onopen && ws.onopen(), 0); return ws; },
    ble: { _sendMessageNative(dev, str) { sent.push({ dev, p: JSON.parse(str) }); return Promise.resolve(); }, _macToNexoId: new Map(), relay: null },
  };
  const gw = new GwLink(net);
  gw.me = () => 'nxtttttttt';
  const A = 'nxaaaaaaaa', B = 'nxbbbbbbbb';
  const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
  const last = (op) => sent.filter((s) => s.p.op === op).pop();
  const sk = new Uint8Array(require('crypto').randomBytes(32));
  const frame = (kind, content) => JSON.stringify(['EVENT', netMakeEvent(sk, kind, [['p', 'ab'.repeat(32)]], content)]);

  gw.handle({ v: 1, type: 'ig', op: 'q', from: A }, 'devA'); await sleep(5);
  chk('oferta_f0', last('a') && last('a').p.f === 0 && last('a').p.u.length === 1);
  gw.handle({ v: 1, type: 'ig', op: 'o', from: A, s: '0123456789ab', u: R }, 'devA'); await sleep(10);
  const ws = sockets[0];
  gw.handle({ v: 1, type: 'ig', op: 'f', from: A, s: '0123456789ab', d: frame(1059, 'hola') }, 'devA'); await sleep(5);
  chk('texto_pasa', ws.up.length === 1);
  gw.handle({ v: 1, type: 'ig', op: 'f', from: A, s: '0123456789ab', d: frame(1064, 'x'.repeat(30000)) }, 'devA'); await sleep(5);
  const no = last('e') && JSON.parse(last('e').p.d);
  chk('trozo_no', ws.up.length === 1 && no && no[0] === 'OK' && no[2] === false && /restricted/.test(no[3]));
  const nE = sent.filter((s) => s.p.op === 'e').length;
  ws.onmessage({ data: '["EVENT","s",' + JSON.stringify({ content: 'y'.repeat(20000) }) + ']' }); await sleep(5);
  ws.onmessage({ data: '["EOSE","s"]' }); await sleep(5);
  const eNow = sent.filter((s) => s.p.op === 'e');
  chk('baja_no', eNow.length === nE + 1 && eNow[eNow.length - 1].p.d === '["EOSE","s"]');

  // A me ayuda (me prestó su internet / me hizo de puente)
  H.noteHelp(A, 'prueba');
  gw.handle({ v: 1, type: 'ig', op: 'q', from: A }, 'devA'); await sleep(5);
  gw.handle({ v: 1, type: 'ig', op: 'f', from: A, s: '0123456789ab', d: frame(1064, 'x'.repeat(30000)) }, 'devA'); await sleep(5);
  ws.onmessage({ data: '["EVENT","s",' + JSON.stringify({ content: 'y'.repeat(20000) }) + ']' }); await sleep(5);
  chk('ayudante_si', last('a').p.f === 1 && ws.up.length === 2 && /yyyy/.test(last('e').p.d));
  // B no
  gw.handle({ v: 1, type: 'ig', op: 'q', from: B }, 'devB'); await sleep(5);
  chk('otro_no', last('a').p.f === 0);
  // caduca
  const realNow = Date.now; Date.now = () => realNow() + 31 * 24 * 3600 * 1000;
  chk('caduca', !H.helped(A));
  Date.now = realNow;

  // cliente: un puente f:0 no lleva archivos
  const net2 = { relays: new Map(), ble: net.ble };
  const cli = new GwLink(net2); cli.me = () => 'nxcccccccc';
  cli.bridges.set('nxtttttttt', { nx: 'nxtttttttt', files: false, wifi: true });
  const c0 = cli.fileMaxB64();
  cli.bridges.set('nxtttttttt', { nx: 'nxtttttttt', files: true, wifi: false });
  const c1 = cli.fileMaxB64();
  cli.tick = () => {}; cli._cliOffer('nxuuuuuuuu', 'devU', { u: [R], w: 1 });
  chk('cliente', c0 === 0 && c1 > 0 && cli.offers.get('nxuuuuuuuu').files === true);

  r.fallos = mal; r.resultado = mal.length ? 'FALLO' : 'OK';
  console.log('GWRECIPROCO ' + JSON.stringify(r));
  process.exit(mal.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
