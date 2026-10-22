// Puente Android → app en Chromium REAL con la CPU frenada: cada aviso del plugin cruza a la página como en el
// teléfono. Una foto (--kb, por defecto 300) de A a B y después de B a A: tiempo de llegada, avisos que cruzan
// el puente (onRemLog: el Kotlin registra cada trozo; la 2722 los escuchaba todos), lag del hilo de la interfaz.
// --kotlin-2722: el Kotlin de la 2722 (todos los registros cruzan si alguien escucha).
// Uso: node bridge.js <dir_build> [--kb=300] [--cpu=4] [--kotlin-2722]
'use strict';
const fs = require('fs');
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const { PW, bootPhone, phaseStart, phaseEnd, click, sleep } = require('./pw_harness');

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const kb = arg('kb', 300), cpu = arg('cpu', 4), oldKotlin = !!arg('kotlin-2722', false);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, remLogAll: oldKotlin };

async function sendPhoto(page, name, bytes) {
  await click(page, '.attach-menu-item[data-type="file"]');
  await sleep(150);
  await page.evaluate(([name, n]) => {
    const b = new Uint8Array(n); b[0] = 0xff; b[1] = 0xd8; for (let i = 2; i < n; i++) b[i] = (i * 31 + name.length) & 255;
    const fin = Array.from(document.querySelectorAll('input[type=file]')).pop();
    Object.defineProperty(fin, 'files', { configurable: true, value: [new File([b], name, { type: 'image/jpeg' })] });
    fin.dispatchEvent(new Event('change'));
  }, [name, bytes]);
}

(async () => {
  const logs = [];
  const browser = await PW.chromium.launch();
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const A = await bootPhone(browser, 'A', nA, dist, { cpuThrottle: cpu, logs });
  const B = await bootPhone(browser, 'B', nB, dist, { cpuThrottle: cpu, logs });
  const r = { build: path.basename(buildDir), kotlin: oldKotlin ? '2722 (todos los registros)' : '2723 (solo AT_REST y FILE_IO)', kb, cpu };
  await A.page.evaluate(() => window.bleInterface.togglePanel());
  let paired = false;
  for (let i = 0; i < 200 && !paired; i++) { await sleep(200); paired = await click(A.page, '#ble-new-device button'); if (!paired && !(await A.page.evaluate(() => window.bleInterface.isScanning))) await click(A.page, '#ble-scan-btn'); }
  await sleep(2500);
  await A.page.evaluate(() => window.bleInterface.togglePanel());
  if (!paired) { console.log('BRIDGE ' + JSON.stringify({ error: 'no empareja' })); process.exit(0); }
  const idA = await A.page.evaluate(() => window.bleInterface.localNexoId), idB = await B.page.evaluate(() => window.bleInterface.localNexoId);
  const say = (p, t) => p.page.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t);
  // Abrir el chat (con la CPU frenada tarda): reintentar hasta que haya contacto activo
  const openChat = async (p) => { for (let i = 0; i < 60; i++) { if (await p.page.evaluate(() => !!(window.NEXO.app && window.NEXO.app.activeContact))) return true; await click(p.page, '#main-contacts-list .ble-contact-row'); await sleep(500); } return false; };
  r.chat_A = await openChat(A); await say(A, 'hola'); await sleep(3000);
  r.chat_B = await openChat(B); await say(B, 'hola'); await sleep(3000);
  for (const [S, R, idS, label] of [[A, B, idA, 'A_a_B'], [B, A, idB, 'B_a_A']]) {
    const before = { a: nA.stats.remLogsToJs || 0, b: nB.stats.remLogsToJs || 0 };
    const st = await phaseStart([A, B]);
    const t0 = Date.now();
    await sendPhoto(S.page, label + '.jpg', kb * 1024);
    let s = null;
    for (let i = 0; i < 600 && s === null; i++) {
      await sleep(500);
      if (await R.page.evaluate(async (id) => (await window.vaultLoadMessages(id)).some((m) => m.attachmentType && !m._own), idS)) s = Math.round((Date.now() - t0) / 100) / 10;
    }
    const pe = await phaseEnd([A, B], st);
    r[label] = { llega_s: s, avisos_nativos_a_la_app: (nA.stats.remLogsToJs || 0) - before.a + (nB.stats.remLogsToJs || 0) - before.b,
      emisor: pe[S.name] && { cpu_pct: pe[S.name].cpu_pct, lag_max: pe[S.name].lag_max, largas_ms: pe[S.name].largas_ms },
      receptor: pe[R.name] && { cpu_pct: pe[R.name].cpu_pct, lag_max: pe[R.name].lag_max, largas_ms: pe[R.name].largas_ms } };
    await sleep(2000);
  }
  r.avisos_nativos_totales = (nA.stats.remLogs || 0) + (nB.stats.remLogs || 0);
  console.log('BRIDGE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_bridge.txt'), logs.join('\n'));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
