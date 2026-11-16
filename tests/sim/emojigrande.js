// 3151 — EMOJI GRANDE Y SIN BURBUJA (dueño 16-11: «cuando mande uno de estos emoji 🤣😋, los del teclado, no quiero que tengan
// burbuja y quiero que sean más grandes porque ni se ven, al menos 3 veces más grandes»). Existía desde el 29-10, pero solo para los
// textos envueltos (respuesta o reenvío): los mensajes normales llegan en claro y salían con burbuja y a 16 px.
// Chromium real (hace falta :has y getComputedStyle). A le manda a B «hola» (con burbuja), «🤣😋» y «😋»:
//  G1  en los dos teléfonos los mensajes de solo emoji no tienen burbuja (sin fondo ni degradado ni sombra);
//  G2  y miden al menos 3 veces el texto normal (≥ 48 px con el texto a 16 px);
//  G3  el texto normal sigue con su burbuja y su tamaño;
//  G4  (3164) y su burbuja no recorta las letras: sin overflow hidden (con el radio de 12 px se comía la punta de la «h»).
// Contraprueba: en la 3149 G1 y G2 fallan (burbuja y 16 px).
// Uso: node emojigrande.js <dir_build>
'use strict';
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');
const dist = path.resolve(process.argv[2], 'dist');
(async () => {
  const r = { prueba: 'emojigrande', build: path.basename(process.argv[2]) };
  const browser = await PW.chromium.launch();
  const radio = new Radio();
  const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true, noTor: true };
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const logs = [];
  const A = (await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' })).page;
  const B = (await bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' })).page;
  const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await A.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; await A.evaluate(() => { if (!window.bleInterface.isScanning) { const b = document.getElementById('ble-scan-btn'); if (b) b.click(); } }); }
  await click(A, '#ble-new-device button'); await sleep(1800);
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  await A.evaluate(() => { const row = document.querySelector('#main-contacts-list .ble-contact-row'); if (row) row.click(); }); await sleep(800);
  const send = async (txt) => { await A.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').click(); }, txt); await sleep(1200); };
  await send('hola'); await send('🤣😋'); await send('😋');
  await sleep(2000);
  await B.evaluate(() => { const row = document.querySelector('#main-contacts-list .ble-contact-row'); if (row) row.click(); }); await sleep(1500);
  const measure = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#messages-container .message')).map((m) => {
    const c = m.querySelector('.msg-content') || m; const tx = m.querySelector('.msg-text');
    const cs = getComputedStyle(m);
    return { t: (tx || c).textContent.replace(/\d\d:\d\d.*$/, '').trim(), px: parseFloat(getComputedStyle(tx || c).fontSize), ov: getComputedStyle(c).overflowX,
      burbuja: !(cs.backgroundImage === 'none' && /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) && cs.boxShadow === 'none') };
  }));
  const pick = (list, s) => list.find((x) => x.t.indexOf(s) === 0);
  for (const [name, p] of [['A', A], ['B', B]]) {
    const L = await measure(p);
    const h = pick(L, 'hola'), two = pick(L, '🤣😋'), one = L.find((x) => x.t === '😋');
    r[name] = { texto: h && { px: h.px, burbuja: h.burbuja, ov: h.ov }, dos: two && { px: two.px, burbuja: two.burbuja }, uno: one && { px: one.px, burbuja: one.burbuja } };
  }
  const okSide = (s) => s && s.texto && s.dos && s.uno && s.texto.burbuja && s.texto.ov === 'visible' && !s.dos.burbuja && !s.uno.burbuja && s.dos.px >= 3 * s.texto.px && s.uno.px >= 3 * s.texto.px;
  r.G1_G2_G3_A = okSide(r.A); r.G1_G2_G3_B = okSide(r.B);
  const ok = r.G1_G2_G3_A && r.G1_G2_G3_B;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('EMOJIGRANDE ' + JSON.stringify(r));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('EMOJIGRANDE ' + JSON.stringify({ prueba: 'emojigrande', resultado: 'FALLO', error: String(e && e.stack).slice(0, 400) })); process.exit(1); });
