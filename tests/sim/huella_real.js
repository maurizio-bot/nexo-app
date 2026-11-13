// 3065 (dueño 13-11: «cualquier cosa subida por un user se debe ligar a su ID así ya no hay error»): la huella de la foto de perfil
// medida en Chrome DE VERDAD (el simulador no dibuja imágenes). Se generan retratos (fondo, aro, cabeza, pelo, ropa, rótulo) y a cada
// uno se le hace lo que haría alguien para copiarlo: re-guardarlo, captura del visor a pantalla completa, recortarlo (acercar la cara,
// desplazado), ponerle borde, cambiar el brillo. Se cuenta cuántas copias reconoce la huella v1 (3028) y la v2 (img_print.js), y
// cuántos pares de fotos DISTINTAS confunde cada una (retratos al azar y retratos de la misma «plantilla» con otra persona).
// Uso: node huella_real.js [--n=60]   (sin build: usa src/ui/img_print.js directamente)
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '--n=60').slice(4));
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'img_print.js'), 'utf8').replace(/^export /gm, '');

const pageCode = `
${src}
window.IP = { printOfImage, printSame, printScore };
function rng(seed) { let a = seed >>> 0; return function() { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function col(r) { return 'rgb(' + Math.floor(r() * 255) + ',' + Math.floor(r() * 255) + ',' + Math.floor(r() * 255) + ')'; }
const SKIN = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d1a07a'];
const HAIR = ['#090806', '#2c222b', '#3b3024', '#4e433f', '#6a4e42', '#b55239', '#a7856a'];
// Retrato: tpl fija la composición (fondo, aro, rótulo, posiciones); person cambia la persona (piel, pelo, ropa, rasgos)
function portrait(tplSeed, personSeed) {
  const T = rng(tplSeed), P = rng(personSeed);
  const cv = document.createElement('canvas'); cv.width = cv.height = 480; const g = cv.getContext('2d');
  const bg = Math.floor(T() * 4);
  if (bg === 0) { const gr = g.createLinearGradient(0, 0, 480, 480); gr.addColorStop(0, col(T)); gr.addColorStop(1, col(T)); g.fillStyle = gr; g.fillRect(0, 0, 480, 480); }
  else if (bg === 1) { g.fillStyle = col(T); g.fillRect(0, 0, 480, 480); }
  else if (bg === 2) { g.fillStyle = col(T); g.fillRect(0, 0, 480, 480); for (let i = 0; i < 25; i++) { g.fillStyle = col(T); g.fillRect(T() * 480, T() * 480, 20 + T() * 140, 20 + T() * 140); } }
  else { for (let x = 0; x < 480; x += 40) { g.fillStyle = col(T); g.fillRect(x, 0, 40, 480); } }
  const hx = 240 + (T() - 0.5) * 60, hy = 200 + (T() - 0.5) * 50;
  if (T() < 0.5) { g.strokeStyle = col(T); g.lineWidth = 18 + T() * 16; g.beginPath(); g.arc(240, 240, 190 + T() * 30, 0, Math.PI * 2); g.stroke(); }
  // ropa
  g.fillStyle = col(P); g.beginPath(); g.ellipse(hx, 470, 150 + P() * 50, 140, 0, 0, Math.PI * 2); g.fill();
  if (P() < 0.6) { g.fillStyle = col(P); g.beginPath(); g.moveTo(hx - 25, 340); g.lineTo(hx + 25, 340); g.lineTo(hx, 450); g.fill(); }
  // cabeza
  const hw = 80 + P() * 30, hh = 100 + P() * 30;
  g.fillStyle = SKIN[Math.floor(P() * SKIN.length)]; g.beginPath(); g.ellipse(hx, hy, hw, hh, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = HAIR[Math.floor(P() * HAIR.length)]; g.beginPath(); g.ellipse(hx, hy - hh * 0.55, hw * (1 + P() * 0.15), hh * (0.45 + P() * 0.3), 0, Math.PI, Math.PI * 2); g.fill();
  if (P() < 0.4) { g.beginPath(); g.ellipse(hx, hy + hh * 0.55, hw * 0.7, hh * 0.4, 0, 0, Math.PI); g.fill(); } // barba
  g.fillStyle = '#222'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(hx + s * hw * 0.38, hy - 5, 9, 6, 0, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = '#7a3b2e'; g.lineWidth = 5; g.beginPath(); g.arc(hx, hy + hh * 0.35, 22, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  if (T() < 0.5) { g.fillStyle = col(T); g.fillRect(140, 400, 200, 50); g.fillStyle = col(T); g.font = 'bold 26px sans-serif'; g.fillText('PI AUTOMATION', 145, 435); }
  for (let i = 0; i < 2500; i++) { g.fillStyle = 'rgba(' + Math.floor(P() * 255) + ',' + Math.floor(P() * 255) + ',' + Math.floor(P() * 255) + ',0.08)'; g.fillRect(P() * 480, P() * 480, 3, 3); } // grano
  return cv;
}
function load(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; }); }
// Lo que hace Perfil (makeAvatar): cuadrado central, 160 px, JPEG 0.82
async function avatar(src) {
  const im = src.tagName === 'CANVAS' ? src : await load(src);
  const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height, s = Math.min(w, h);
  const cv = document.createElement('canvas'); cv.width = cv.height = 160;
  cv.getContext('2d').drawImage(im, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 160, 160);
  return cv.toDataURL('image/jpeg', 0.82);
}
async function printOf(url) { const im = await load(url); return IP.printOfImage(im, () => document.createElement('canvas')); }
function canvasOf(w, h, fill) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); if (fill) { g.fillStyle = fill; g.fillRect(0, 0, w, h); } return [cv, g]; }
// Copias
async function copies(av, r) {
  const im = await load(av), out = {};
  // captura del visor a pantalla completa (1080×2340): foto ampliada a lo ancho, botón ✕ y barra arriba; Perfil corta el cuadrado central
  { const [cv, g] = canvasOf(1080, 2340, '#000'); g.imageSmoothingEnabled = true; g.drawImage(im, 0, 630, 1080, 1080); g.fillStyle = '#fff'; g.font = '60px sans-serif'; g.fillText('✕', 980, 120); g.fillText('9:13', 40, 60);
    out.captura_visor = await avatar(cv.toDataURL('image/png')); }
  // captura recortada a mano: el cuadro se desplaza ±4 % y cambia de tamaño ±6 %
  { const [cv, g] = canvasOf(1080, 2340, '#000'); g.drawImage(im, 0, 630, 1080, 1080); const s = 1080 * (0.94 + r() * 0.12), x = (r() - 0.5) * 0.08 * 1080, y = 630 + (r() - 0.5) * 0.08 * 1080;
    const [c2, g2] = canvasOf(Math.round(s), Math.round(s), '#000'); g2.drawImage(cv, x, y, s, s, 0, 0, s, s); out.captura_recortada = await avatar(c2); }
  // acercar la cara: recorte del 75–90 % desplazado
  { const f = 0.75 + r() * 0.15, s = 160 * f, x = r() * (160 - s), y = r() * (160 - s); const [cv, g] = canvasOf(320, 320); g.drawImage(im, x, y, s, s, 0, 0, 320, 320); out.recorte = await avatar(cv); }
  // borde alrededor (6–15 %), blanco, negro o de color
  { const b = 0.06 + r() * 0.09, n = Math.round(320 / (1 - 2 * b)); const [cv, g] = canvasOf(n, n, ['#fff', '#000', col(r)][Math.floor(r() * 3)]); g.drawImage(im, (n - 320) / 2, (n - 320) / 2, 320, 320); out.borde = await avatar(cv); }
  // brillo ±12 % y JPEG peor
  { const [cv, g] = canvasOf(160, 160); g.filter = 'brightness(' + (0.88 + r() * 0.24) + ')'; g.drawImage(im, 0, 0); out.brillo = cv.toDataURL('image/jpeg', 0.55); }
  return out;
}
window.runHuella = async function(N) {
  const r = rng(777), res = { v1: {}, v2: {}, n: N }, kinds = ['captura_visor', 'captura_recortada', 'recorte', 'borde', 'brillo'];
  kinds.forEach((k) => { res.v1[k] = 0; res.v2[k] = 0; });
  const prints = [], famPrints = [];
  for (let i = 0; i < N; i++) {
    const av = await avatar(portrait(1000 + i, 5000 + i));
    const p = await printOf(av); prints.push(p);
    const cp = await copies(av, r);
    for (const k of kinds) { const q = await printOf(cp[k]); if (IP.printSame({ b: p.b, c: p.c }, { b: q.b, c: q.c })) res.v1[k]++; if (IP.printSame(q, p)) res.v2[k]++; }
  }
  // misma plantilla, otra persona (como dos empleados con la foto de la empresa)
  for (let f = 0; f < Math.ceil(N / 4); f++) for (let j = 0; j < 4; j++) famPrints.push({ f, p: await printOf(await avatar(portrait(9000 + f, 20000 + f * 10 + j))) });
  let fp1 = 0, fp2 = 0, pairs = 0, ffp1 = 0, ffp2 = 0, fpairs = 0;
  for (let i = 0; i < prints.length; i++) for (let j = i + 1; j < prints.length; j++) { pairs++; const a = prints[i], b = prints[j]; if (IP.printSame({ b: a.b, c: a.c }, { b: b.b, c: b.c })) fp1++; if (IP.printSame(a, b)) fp2++; }
  for (let i = 0; i < famPrints.length; i++) for (let j = i + 1; j < famPrints.length; j++) { if (famPrints[i].f !== famPrints[j].f) continue; fpairs++; const a = famPrints[i].p, b = famPrints[j].p; if (IP.printSame({ b: a.b, c: a.c }, { b: b.b, c: b.c })) ffp1++; if (IP.printSame(a, b)) ffp2++; }
  res.distintas = { pares: pairs, v1: fp1, v2: fp2 }; res.misma_plantilla = { pares: fpairs, v1: ffp1, v2: ffp2 };
  // tiempo de una comparación (sin memoria: miniaturas nuevas)
  const a = await printOf(await avatar(portrait(31337, 31338))), b2 = await printOf(await avatar(portrait(31339, 31340)));
  const t0 = performance.now(); for (let i = 0; i < 20; i++) IP.printScore(Object.assign({}, a, { t: a.t + '' }), Object.assign({}, b2, { t: b2.t })); res.ms_por_comparacion = +((performance.now() - t0) / 20).toFixed(2);
  return res;
};
`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: pageCode });
  const res = await page.evaluate((n) => window.runHuella(n), N);
  await browser.close();
  const pct = (x) => Math.round((100 * x) / res.n);
  const r = { prueba: 'huella_real', n: res.n };
  Object.keys(res.v2).forEach((k) => { r[k] = { v1: pct(res.v1[k]) + '%', v2: pct(res.v2[k]) + '%' }; });
  r.distintas_confundidas = res.distintas; r.misma_plantilla_confundidas = res.misma_plantilla;
  const v2all = Object.keys(res.v2).every((k) => res.v2[k] >= res.v1[k]);
  r.ms_por_comparacion = res.ms_por_comparacion;
  const ok = v2all && res.v2.captura_visor / res.n >= 0.98 && res.v2.brillo / res.n >= 0.98 && res.v2.recorte / res.n >= 0.95 && res.v2.borde / res.n >= 0.95 && res.v2.captura_recortada / res.n >= 0.75 &&
    res.distintas.v2 === 0 && res.misma_plantilla.v2 <= Math.max(1, Math.floor(res.misma_plantilla.pares / 100)) && res.misma_plantilla.v2 < res.misma_plantilla.v1;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('HUELLAREAL ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('HUELLAREAL ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
