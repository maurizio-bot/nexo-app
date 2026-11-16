// A6 (cola de pulido, 10-11): captura la hoja de Ajustes completa (viewport alto) para revisar orden, nombres y duplicados.
// Uso: node ajustes_shots.js <dir_build> <carpeta_capturas>
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');
const dist = path.resolve(process.argv[2], 'dist');
const out = path.resolve(process.argv[3] || 'shots_ajustes');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await PW.chromium.launch();
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true });
  radio.add(nA); nA.load();
  const logs = [];
  const { page } = await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' });
  await page.setViewportSize({ width: 393, height: 852 });
  await sleep(800);
  await page.evaluate(() => document.getElementById('nexo-profile-btn').click()); await sleep(600);
  await page.evaluate(() => document.getElementById('nexo-open-settings').click()); await sleep(900);
  // 3142: Ajustes = lista corta de secciones; se captura la lista y cada sección (con el texto de todo el panel)
  await page.screenshot({ path: path.join(out, 'ajustes_lista.png') });
  const secs = await page.evaluate(() => Array.from(document.querySelectorAll('.nx-set-row')).map((r) => r.getAttribute('data-sec')));
  let txt = 'LISTA:\n' + await page.evaluate(() => document.getElementById('nexo-settings-sheet').innerText);
  for (const k of secs) {
    await page.evaluate((k) => document.querySelector('.nx-set-row[data-sec="' + k + '"]').click(), k); await sleep(500);
    await page.setViewportSize({ width: 393, height: 1700 }); await sleep(200);
    await page.screenshot({ path: path.join(out, 'ajustes_' + k + '.png') });
    txt += '\n\n=== ' + k + ' ===\n' + await page.evaluate(() => document.getElementById('nexo-settings-sheet').innerText);
    await page.setViewportSize({ width: 393, height: 852 });
    await page.evaluate(() => document.getElementById('nexo-settings-back').click()); await sleep(250);
  }
  fs.writeFileSync(path.join(out, 'ajustes_texto.txt'), txt);
  await browser.close();
  console.log('AJUSTES_SHOTS ok ' + txt.length);
})().catch((e) => { console.error(e); process.exit(1); });
