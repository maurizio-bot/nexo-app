// #94 «ver una vez»: A manda una FOTO marcada «ver una vez» a B. Comprueba: llega con attachmentMeta.once; en B la
// burbuja dice «Toca para ver · una vez» (sin <img>); en A (emisor) dice «enviada» sin previa; al tocar en B se abre a
// pantalla completa y el medio se CONSUME (se borra payload/content/blob, queda onceSeen) y no se puede reabrir ni al
// cerrar y volver a abrir el chat.
// Uso: node once.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; }

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };

  // Emparejar por Bluetooth
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('ONCE ' + JSON.stringify({ resultado: 'FAIL', error: 'no empareja' })); process.exit(0); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  await openChat(A);

  // A manda una FOTO «ver una vez» (por el camino real de adjuntos; expuesto como NEXO_sendAttachment para la prueba)
  const b64 = Buffer.alloc(2400, 7).toString('base64');
  A.win.NEXO_sendAttachment('image', b64, { format: 'jpeg', width: 120, height: 90, once: true });
  await sleep(400);

  // Llega a B con attachmentMeta.once (el flag viaja por el sobre del adjunto)
  const onceMsgOf = async (p, from) => (await p.win.vaultLoadMessages(from)).find((m) => !m._own && m.attachmentType === 'image' && m.attachmentMeta && m.attachmentMeta.once);
  r.llega_a_B = await waitFor(async () => !!(await onceMsgOf(B, idA)), 25000);
  const bMsg = (await onceMsgOf(B, idA)) || {};
  r.meta_once_en_B = bMsg.attachmentMeta ? bMsg.attachmentMeta.once === true : null;
  const mid = bMsg.msgId || bMsg.messageId;

  // B abre el chat: la burbuja dice «una vez», sin <img>
  await openChat(B); await sleep(800);
  const bBubble = () => Array.from(B.win.document.querySelectorAll('#messages-container .message.other')).find((m) => /una vez|Abierta/.test(m.textContent));
  r.B_burbuja_una_vez = !!bBubble() && /una vez/.test(bBubble().textContent) && !bBubble().querySelector('img');

  // A (emisor) ve «enviada», sin previa
  const aBubble = Array.from(A.win.document.querySelectorAll('#messages-container .message.own')).find((m) => /una vez/.test(m.textContent));
  r.A_burbuja_enviada = !!aBubble && /enviada/.test(aBubble.textContent) && !aBubble.querySelector('img');

  // B toca para ver: se abre a pantalla completa y se consume
  const tap = bBubble() && bBubble().querySelector('.msg-once-tap');
  click(B.win, tap); await sleep(500);
  r.visor_abierto = !!B.win.document.querySelector('#fullscreen-media-overlay img');
  // Consumido en el vault: onceSeen, sin payload, sin content, sin ref
  r.consumido = await waitFor(async () => { const m = (await B.win.vaultLoadMessages(idA)).find((x) => (x.msgId || x.messageId) === mid); return m && m.onceSeen === true && !m.attachmentPayload && !m.attachmentRef && !m.content; }, 10000);
  // La burbuja ahora dice «Abierta»
  r.B_burbuja_abierta = !!bBubble() && /Abierta/.test(bBubble().textContent) && !bBubble().querySelector('img');

  // Cerrar y reabrir el chat: sigue «Abierta», sin medio (no se puede reabrir ni resucitar desde content)
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300);
  await openChat(B); await sleep(700);
  const reMsg = (await B.win.vaultLoadMessages(idA)).find((x) => (x.msgId || x.messageId) === mid) || {};
  r.sigue_consumida = reMsg.onceSeen === true && !reMsg.attachmentPayload && !reMsg.content;
  r.reabre_sin_medio = !!bBubble() && /Abierta/.test(bBubble().textContent) && !bBubble().querySelector('img');

  // Auditoría 2800 (regresión HIGH): una RETRANSMISIÓN del mismo msgId tras consumir, con el payload DENTRO de
  // content (como viaja por relé/internet) y meta SIN `once`, NO debe resucitar la foto. Es el reenvío real del
  // emisor al reconectar (su registro saliente no se borra, #12). Antes el merge conservaba content y al reabrir
  // el chat `render.js` lo reconstruía y repintaba la foto.
  const reviveContent = JSON.stringify({ type: 'attachment', attachmentType: 'image', payload: b64, meta: { format: 'jpeg', width: 120, height: 90 } });
  await B.win.vaultAppendMessage(idA, { msgId: mid, messageId: mid, _own: false, type: 'text', content: reviveContent });
  await sleep(300);
  const revVault = (await B.win.vaultLoadMessages(idA)).find((x) => (x.msgId || x.messageId) === mid) || {};
  r.retransmision_no_revive_vault = revVault.onceSeen === true && !revVault.content && !revVault.attachmentPayload;
  B.win.dispatchEvent(new B.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300);
  await openChat(B); await sleep(700);
  r.retransmision_no_revive_ui = !!bBubble() && /Abierta/.test(bBubble().textContent) && !bBubble().querySelector('img');

  r.errores = logs.filter((l) => /TypeError|undefined is not|No se pudo descifrar/.test(l)).slice(0, 4);
  const ok = r.llega_a_B && r.meta_once_en_B === true && r.B_burbuja_una_vez && r.A_burbuja_enviada && r.visor_abierto &&
    r.consumido && r.B_burbuja_abierta && r.sigue_consumida && r.reabre_sin_medio &&
    r.retransmision_no_revive_vault && r.retransmision_no_revive_ui && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('ONCE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_once.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_once.txt'), logs.join('\n')); process.exit(1); });
