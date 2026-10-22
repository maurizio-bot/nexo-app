// Perfil de CPU (Chromium real, CDP Profiler) del receptor B: ráfaga de 40 textos con el chat abierto
// y abrir el chat con historial grande. Agrupa el tiempo propio por función (archivo:línea).
// Uso: node profile.js <dir_build> [--cpu=4] [--hist=400] [--top=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const { PW, bootPhone, sleep } = require('./pw_harness');

const buildDir = path.resolve(process.argv[2]);
const dist = path.join(buildDir, 'dist');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const CPU = arg('cpu', 4), HIST = arg('hist', 400), TOP = arg('top', 25);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25 };
const ID = { A: 'NXA0000001', B: 'NXB0000002' }, ADDR = { A: 'AA:AA:AA:AA:AA:01', B: 'BB:BB:BB:BB:BB:02' };

function summarize(profile) {
  const nodes = new Map(); profile.nodes.forEach((n) => nodes.set(n.id, n));
  const self = new Map();
  const dt = profile.timeDeltas; let total = 0;
  profile.samples.forEach((id, i) => {
    const n = nodes.get(id); const cf = n.callFrame; const d = (dt[i] || 0) / 1000; total += d;
    const file = (cf.url || '').split('/').pop();
    const key = (cf.functionName || '(anónima)') + ' ' + file + ':' + (cf.lineNumber + 1);
    self.set(key, (self.get(key) || 0) + d);
  });
  const top = Array.from(self.entries()).filter(([k]) => !/^\(idle\)|^\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([k, v]) => Math.round(v) + ' ms  ' + k);
  return { total_ms: Math.round(total), idle_ms: Math.round(self.get('(idle) :0') || 0), top };
}

(async () => {
  const browser = await PW.chromium.launch();
  const radio = new Radio();
  const nA = new NativePhone('A', ADDR.A, opts), nB = new NativePhone('B', ADDR.B, opts);
  const c = (n) => ({ nexoId: ID[n].toLowerCase(), deviceUUID: ID[n].toLowerCase(), name: n, deviceId: ADDR[n], addedAt: 1, lastSeen: 0 });
  const now = Date.now(), msgs = [];
  for (let i = 0; i < HIST; i++) { const own = i % 3 === 0, id = 'h' + i; msgs.push({ msgId: id, messageId: id, content: 'Mensaje de historial número ' + i + ' con algo de texto', senderNexoId: own ? 'nxb0000002' : 'nxa0000001', timestamp: now - (HIST - i) * 60000, seq: i + 1, status: own ? 'read' : 'delivered', _own: own }); }
  nA.files.set('nexo_advertising_id.json', JSON.stringify({ nexoId: ID.A })); nA.files.set('nexo_vault_contacts.json', JSON.stringify({ contacts: [c('B')] }));
  nB.files.set('nexo_advertising_id.json', JSON.stringify({ nexoId: ID.B })); nB.files.set('nexo_vault_contacts.json', JSON.stringify({ contacts: [c('A')] }));
  nB.files.set('nexo_vault_msgs_v2_nxa0000001.json', JSON.stringify({ messages: msgs }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const logs = [];
  const [A, B] = await Promise.all([bootPhone(browser, 'A', nA, dist, { cpuThrottle: CPU, logs }), bootPhone(browser, 'B', nB, dist, { cpuThrottle: CPU, logs })]);
  await sleep(10000);
  const open = (p, name) => p.page.evaluate((name) => { const r = Array.from(document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((x) => (x.querySelector('.ble-contact-name') || {}).textContent === name); if (r) r.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!r; }, name);
  const back = (p) => p.page.evaluate(() => { const b = document.getElementById('chat-back-btn'); if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await open(A, 'B'); await sleep(1500); await open(B, 'A'); await sleep(3000);
  const res = { build: path.basename(buildDir) };
  await B.cdp.send('Profiler.enable'); await B.cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  // 1) Ráfaga recibida con el chat abierto
  await B.cdp.send('Profiler.start');
  for (let i = 0; i < 40; i++) {
    await A.page.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, 'rafaga ' + i);
    await sleep(150);
  }
  await sleep(6000);
  res.rafaga_recibida = summarize((await B.cdp.send('Profiler.stop')).profile);
  // 2) Abrir el chat con historial grande
  await back(B); await sleep(1500);
  await B.cdp.send('Profiler.start');
  await open(B, 'A'); await sleep(4000);
  res.abrir_chat = summarize((await B.cdp.send('Profiler.stop')).profile);
  console.log('PROFILE ' + JSON.stringify(res, null, 1));
  fs.writeFileSync(path.join(__dirname, 'last_logs_profile.txt'), logs.join('\n'));
  await browser.close(); process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); process.exit(1); });
