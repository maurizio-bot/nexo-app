// Cobros (pagos Fase 1): A manda un "cobro" a B por el menú de adjuntar. Comprueba: llega a B como adjunto tipo
// 'cobro' con importe/moneda/concepto/método; la tarjeta se dibuja en el emisor ("Cobro enviado") y en el receptor
// ("Te piden un cobro") con el importe; el concepto/método del otro teléfono NO se inyecta como HTML; botón "Copiar".
// Uso: node cobro.js <dir_build> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 25), asymmetric: true, noL2: true };
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

async function sendCobro(p, { importe, moneda, concepto, metodo }) {
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="cobro"]'));
  await sleep(200);
  const sheet = p.win.document.getElementById('cobro-sheet');
  if (!sheet) return false;
  const set = (id, v) => { const el = sheet.querySelector('#' + id); if (!el) return; el.value = String(v); el.dispatchEvent(new p.win.Event('input', { bubbles: true })); el.dispatchEvent(new p.win.Event('change', { bubbles: true })); };
  set('cobro-importe', importe);
  if (moneda) set('cobro-moneda', moneda);
  if (concepto !== undefined) set('cobro-concepto', concepto);
  if (metodo !== undefined) set('cobro-metodo', metodo);
  click(p.win, sheet.querySelector('#cobro-send'));
  await sleep(400);
  return true;
}
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
  if (!add) { console.log('COBRO ' + JSON.stringify({ resultado: 'FAIL', error: 'no empareja' })); process.exit(0); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  await openChat(A);

  // A manda un cobro con un concepto/método "peligrosos" (prueba de inyección)
  const xssConcepto = '<img src=x onerror="window.__cxss=1">almuerzo';
  const metodo = 'Mercado Pago: alias.nexo';
  r.hoja_abrio = await sendCobro(A, { importe: 1500.5, moneda: 'ARS', concepto: xssConcepto, metodo: metodo });
  r.hoja_se_cerro = !A.win.document.getElementById('cobro-sheet');

  // Llega a B como adjunto 'cobro'. Como la ubicación/el audio, el adjunto que NO es image/video/file se guarda dentro
  // de content (JSON); solo image/video/file suben attachmentType a primer nivel (ble_messages.js). Se parsea como render.
  const cobroOf = (msgs) => {
    for (const m of (msgs || [])) {
      if (m._own) continue;
      if (m.attachmentType === 'cobro') return m.attachmentMeta || {};
      if (typeof m.content === 'string' && m.content.indexOf('"cobro"') >= 0) {
        try { const p = JSON.parse(m.content); if (p && p.attachmentType === 'cobro') return p.meta || {}; } catch (e) {}
      }
    }
    return null;
  };
  r.llega_a_B = await waitFor(async () => !!cobroOf(await B.win.vaultLoadMessages(idA)), 20000);
  const meta = cobroOf(await B.win.vaultLoadMessages(idA)) || {};
  r.meta = { importe: meta.importe, moneda: meta.moneda, concepto: meta.concepto, metodo: meta.metodo };
  r.meta_ok = meta.importe === 1500.5 && meta.moneda === 'ARS' && meta.concepto === xssConcepto && meta.metodo === metodo;

  await openChat(B); await sleep(1200);
  // Tarjetas dibujadas
  const ownCard = Array.from(A.win.document.querySelectorAll('#messages-container .message.own')).map((m) => m.textContent).join(' | ');
  const bCard = Array.from(B.win.document.querySelectorAll('#messages-container .message.other')).map((m) => m.textContent).join(' | ');
  r.tarjeta_emisor = /Cobro enviado/.test(ownCard) && /1\.?500/.test(ownCard) && /ARS/.test(ownCard);
  r.tarjeta_receptor = /Te piden un cobro/.test(bCard) && /1\.?500/.test(bCard) && /Mercado Pago/.test(bCard);
  // Botón copiar en el receptor
  r.boton_copiar = !!B.win.document.querySelector('#messages-container .message.other .cobro-copy');
  // Inyección: el concepto peligroso NO debe ejecutarse ni meter un <img src=x>
  r.sin_inyeccion = !A.win.__cxss && !B.win.__cxss && !B.win.document.querySelector('#messages-container img[src="x"]') && !A.win.document.querySelector('#messages-container img[src="x"]');

  r.errores = logs.filter((l) => /TypeError|undefined is not|No se pudo|Error procesando/.test(l)).slice(0, 4);
  const ok = r.hoja_abrio && r.hoja_se_cerro && r.llega_a_B && r.meta_ok && r.tarjeta_emisor && r.tarjeta_receptor && r.boton_copiar && r.sin_inyeccion && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('COBRO ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_cobro.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_cobro.txt'), logs.join('\n')); process.exit(1); });
