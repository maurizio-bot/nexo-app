// Dueño 23-11: el «+» del chat abría TODOS los botones a la vista. Ahora abre con los 4 más usados (cámara, galería, archivo, ubicación)
// y una flechita; al tocarla sube una fila con el resto (contacto, cobro, stickers, juegos, buscar). Al cerrar y volver a abrir, otra vez
// solo los 4. Se mira el HTML y el CSS de la build y se prueba el comportamiento con Chromium. Uso: node attachmas.js [dir_build]
'use strict';
const fs = require('fs'), path = require('path');
const { buildDir } = require('./srcmod');
(async () => {
  const r = { prueba: 'attachmas' };
  const html = fs.readFileSync(path.join(buildDir, 'index.html'), 'utf8');
  const menu = html.slice(html.indexOf('<div id="attach-menu"'), html.indexOf('<!-- Camera Preview Overlay'));
  const items = [...menu.matchAll(/<div class="attach-menu-item[^"]*" data-type="([a-z]+)"( data-sec="1")?/g)].map((m) => ({ t: m[1], sec: !!m[2] }));
  r.primeros = items.filter((x) => !x.sec && x.t !== 'more').map((x) => x.t);
  r.secundarios = items.filter((x) => x.sec).map((x) => x.t);
  r.flechita = items.some((x) => x.t === 'more');
  const css = ['critical.css'].map((f) => fs.readFileSync(path.join(buildDir, 'src/styles', f), 'utf8')).join('\n');
  const { chromium } = require('playwright');
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 400, height: 800 } });
  await pg.setContent('<style>' + css + '</style><body>' + menu + '</body>');
  const vis = () => pg.evaluate(() => Array.from(document.querySelectorAll('#attach-menu .attach-menu-item')).filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.dataset.type));
  await pg.evaluate(() => { const m = document.getElementById('attach-menu'); m.classList.remove('hidden'); m.classList.add('visible'); });
  r.al_abrir = await vis();
  await pg.evaluate(() => document.getElementById('attach-menu').classList.toggle('expanded'));
  r.con_flechita = await vis();
  r.dos_filas = await pg.evaluate(() => { const ys = new Set(Array.from(document.querySelectorAll('#attach-menu .attach-menu-item')).filter((e) => getComputedStyle(e).display !== 'none').map((e) => Math.round(e.getBoundingClientRect().top))); return ys.size; });
  await b.close();
  // el JS: la flechita cambia «expanded» y cerrar el menú lo quita
  const setup = fs.readFileSync(path.join(buildDir, 'src/ui/app_setup.js'), 'utf8'), bits = fs.readFileSync(path.join(buildDir, 'src/ui/ui_bits.js'), 'utf8');
  r.js_flechita = /type === 'more'\) \{ var am = document\.getElementById\('attach-menu'\); if \(am\) am\.classList\.toggle\('expanded'\)/.test(setup);
  r.js_cerrar_vuelve_a_4 = /menu\.classList\.remove\('expanded'\)/.test(bits);
  const ok = JSON.stringify(r.primeros) === '["camera","gallery","file","location"]' && JSON.stringify(r.secundarios) === '["contact","cobro","sticker","games","search"]' && r.flechita &&
    JSON.stringify(r.al_abrir) === '["camera","gallery","file","location","more"]' && r.con_flechita.length === 10 && r.dos_filas === 2 && r.js_flechita && r.js_cerrar_vuelve_a_4;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('ATTACHMAS ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ATTACHMAS ' + JSON.stringify({ prueba: 'attachmas', error: String(e && e.stack || e).slice(0, 300), resultado: 'FALLO' })); process.exit(1); });
