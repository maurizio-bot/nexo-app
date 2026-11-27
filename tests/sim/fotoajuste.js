// 28-11 (dueño: «revisa el formato de cómo se suben las fotos de perfil, grupo y chat para que no se recorten tanto y también suban con buena
// calidad»). Antes la foto de perfil (y la de grupo, la misma función) se cortaba SOLA al cuadrado del centro y salía a 160 px. En Chromium
// real (360 px), con una foto ALARGADA (600×1500: franja roja arriba, verde al centro, azul abajo):
//  F1 al elegirla se abre el ajuste (círculo, barra de zoom, «Usar foto», «Cancelar»); de entrada cubre el círculo (como antes);
//  F2 alejando del todo se ve la foto ENTERA: el resultado tiene la franja roja arriba Y la azul abajo (antes solo se veía el verde) y a
//     los lados la misma foto desenfocada (no negro);
//  F3 arrastrar mueve: arrastrando hacia abajo con zoom de cubrir, arriba queda la franja roja;
//  F4 calidad: sale a 384 px (antes 160) y cabe en el tope de un aviso de foto (≤ 60 000 caracteres), también con una foto con mucho detalle;
//  F5 «Cancelar» cierra sin error visible (code CANCEL) y sin cambiar nada.
// Uso: node fotoajuste.js [dir_build]
'use strict';
const path = require('path');
const { PW, bootPhone, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');
const dist = path.resolve(process.argv[2] || 'builds/wip', 'dist');
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true };

(async () => {
  const r = { prueba: 'fotoajuste' };
  let browser;
  try { browser = await PW.chromium.launch(); } catch (e) { browser = await PW.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
  const radio = new Radio(), logs = [];
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts); radio.add(nA); nA.load();
  const { page } = await bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' });
  // foto alargada de prueba (o con ruido: mucho detalle) como File, y makeAvatar real
  const start = (noise) => page.evaluate((noise) => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 1500; const x = c.getContext('2d');
    x.fillStyle = '#ff0000'; x.fillRect(0, 0, 600, 300); x.fillStyle = '#00ff00'; x.fillRect(0, 300, 600, 900); x.fillStyle = '#0000ff'; x.fillRect(0, 1200, 600, 300);
    if (noise) { const d = x.getImageData(0, 0, 600, 1500); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; } x.putImageData(d, 0, 0); }
    return new Promise((res) => c.toBlob((b) => { window.__av = { done: false }; window.NEXO_avatarMake(new File([b], 'larga.png', { type: 'image/png' })).then((u) => { window.__av = { done: true, url: u }; }, (e) => { window.__av = { done: true, err: e && e.code }; }); res(true); }, 'image/png'));
  }, noise);
  const waitDlg = async () => { for (let i = 0; i < 50; i++) { if (await page.$('#nexo-avatar-crop')) return true; await sleep(100); } return false; };
  const result = async () => { for (let i = 0; i < 50; i++) { const v = await page.evaluate(() => window.__av); if (v && v.done) return v; await sleep(100); } return null; };
  // colores del resultado en puntos (fracción del lado)
  const probe = (url, pts) => page.evaluate(({ url, pts }) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); res({ w: im.width, px: pts.map(([fx, fy]) => Array.from(x.getImageData(Math.round(fx * (im.width - 1)), Math.round(fy * (im.height - 1)), 1, 1).data).slice(0, 3)) }); }; im.src = url; }), { url, pts });
  const is = (c, k) => k === 'r' ? c[0] > 180 && c[1] < 90 && c[2] < 90 : k === 'g' ? c[1] > 180 && c[0] < 90 && c[2] < 90 : k === 'b' ? c[2] > 180 && c[0] < 90 && c[1] < 90 : false;

  // F1 + F2
  await start(false);
  r.F1_abre = await waitDlg();
  r.F1_partes = await page.evaluate(() => ({ zoom: !!document.querySelector('#nexo-avatar-crop .nexo-av-zoom'), usar: (document.querySelector('#nexo-avatar-crop .nexo-av-use') || {}).textContent, cancelar: (document.querySelector('#nexo-avatar-crop .nexo-av-cancel') || {}).textContent, titulo: document.querySelector('#nexo-avatar-crop div').textContent }));
  r.F1 = r.F1_abre && r.F1_partes.zoom && r.F1_partes.usar === 'Usar foto' && r.F1_partes.cancelar === 'Cancelar' && r.F1_partes.titulo === 'Ajusta la foto';
  await page.evaluate(() => { const z = document.querySelector('#nexo-avatar-crop .nexo-av-zoom'); z.value = '0'; z.dispatchEvent(new Event('input')); });
  await page.click('#nexo-avatar-crop .nexo-av-use');
  const v2 = await result();
  const p2 = v2 && v2.url ? await probe(v2.url, [[0.5, 0.1], [0.5, 0.5], [0.5, 0.9], [0.05, 0.5]]) : null;
  r.F2_colores = p2 && p2.px;
  r.F2 = !!p2 && is(p2.px[0], 'r') && is(p2.px[1], 'g') && is(p2.px[2], 'b') && (p2.px[3][0] + p2.px[3][1] + p2.px[3][2]) > 60; // a los lados: la foto desenfocada, no negro
  // F4 (con la de F2)
  r.F4_px = p2 && p2.w; r.F4_largo = v2 && v2.url && v2.url.length;

  // F3: cubrir (de entrada) y arrastrar hacia abajo
  await start(false);
  await waitDlg();
  const box = await (await page.$('#nexo-avatar-crop canvas')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + i * 60);
  await page.mouse.up();
  await page.click('#nexo-avatar-crop .nexo-av-use');
  const v3 = await result();
  const p3 = v3 && v3.url ? await probe(v3.url, [[0.5, 0.15], [0.05, 0.5]]) : null;
  r.F3_colores = p3 && p3.px;
  r.F3 = !!p3 && is(p3.px[0], 'r');

  // F4: una foto con mucho detalle también cabe
  await start(true);
  await waitDlg();
  await page.click('#nexo-avatar-crop .nexo-av-use');
  const v4 = await result();
  r.F4_ruido_largo = v4 && v4.url && v4.url.length;
  r.F4 = r.F4_px === 384 && r.F4_largo > 0 && r.F4_largo <= 60000 && r.F4_ruido_largo > 0 && r.F4_ruido_largo <= 60000;

  // F5
  await start(false);
  await waitDlg();
  await page.click('#nexo-avatar-crop .nexo-av-cancel');
  const v5 = await result();
  r.F5 = !!v5 && v5.err === 'CANCEL' && !(await page.$('#nexo-avatar-crop'));

  const ok = r.F1 && r.F2 && r.F3 && r.F4 && r.F5;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('FOTOAJUSTE ' + JSON.stringify(r));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('FOTOAJUSTE {"resultado":"FALLO","error":' + JSON.stringify(String(e && e.stack)) + '}'); process.exit(1); });
