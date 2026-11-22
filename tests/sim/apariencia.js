// Ajustes → Apariencia (cola 33). Comprueba, en Chromium con la app real:
//  (1) sin elección guardada, una burbuja propia queda con los estilos calculados de SIEMPRE (degradado celeste→morado, texto blanco,
//      hora/✓✓/enlace de siempre, letra de siempre) y no hay clases ni variables puestas en <html>;
//  (2) la sección «Apariencia» existe en Ajustes, con su burbujita de ejemplo, y «Dos colores» es la primera opción;
//  (3) cada combinación (1 o 2 colores × pleno/cristal × 4 letras) pinta la burbujita de ejemplo Y una burbuja real del chat con las variables;
//  (4) color claro → texto oscuro (y hora, ✓✓ y enlace legibles: contraste ≥ 3 contra los dos colores); color oscuro → texto blanco;
//  (5) cristal = translúcido (alfa < 1) y pleno = sólido;
//  (6) la letra cambia en toda la app (body y botones) y es una pila del sistema (sin @font-face ni archivos de fuentes);
//  (7) reiniciar la app (otra página con el mismo «teléfono») conserva la elección;
//  (8) «Restablecer» deja los valores de fábrica y guarda archivo vacío; (9) un archivo corrupto no rompe nada.
// Uso: node apariencia.js <dir_build>
'use strict';
const path = require('path');
const { PW, bootPhone, click, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2] || 'builds/wip', 'dist');
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true };
const fallos = [];
const ok = (c, m) => { if (!c) { fallos.push(m); console.log('FALLO: ' + m); } };
const lum = (rgb) => { const c = rgb.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const cr = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

// Se ejecuta en la página: estilos calculados de la burbuja propia (la de ejemplo o la primera real del chat)
const LEER = `(function (sel) {
  var m = document.querySelector(sel); if (!m) return null;
  var cs = getComputedStyle(m), q = function (s) { var e = m.querySelector(s); return e ? getComputedStyle(e) : null; };
  var tm = q('.msg-time'), st = q('.msg-status'), ln = q('.nx-link'), tx = q('.msg-text');
  var rgb = function (c) { var a = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!a) return null; var p = a[1].split(',').map(parseFloat); return p.length < 4 ? p.concat([1]) : p; };
  var cols = (cs.backgroundImage.match(/rgba?\\([^)]+\\)/g) || []).map(rgb);
  var root = document.documentElement;
  return { fondo: cs.backgroundImage, cols: cols, color: cs.color, borde: cs.borderTopColor, blur: cs.backdropFilter || cs.webkitBackdropFilter || '',
    txt: (tx || cs).color, hora: tm && tm.color, estado: st && st.color, enlace: ln && ln.color, letra: getComputedStyle(document.body).fontFamily,
    letraBtn: (document.querySelector('button') ? getComputedStyle(document.querySelector('button')).fontFamily : ''),
    clases: root.className, vars: root.getAttribute('style') || '' };
})`;

async function arrancar(browser, radio, nat, name, logs) {
  const { page } = await bootPhone(browser, name, nat, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' });
  return page;
}

(async () => {
  const browser = await PW.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const radio = new Radio(); const logs = [];
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  let A = await arrancar(browser, radio, nA, 'A', logs);
  const B = await arrancar(browser, radio, nB, 'B', logs);
  const send = (p, t) => p.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t);

  // contacto y un mensaje propio en el chat de A
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await A.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; if (!(await A.evaluate(() => window.bleInterface.isScanning))) await click(A, '#ble-scan-btn'); }
  await click(A, '#ble-new-device button'); await sleep(1500);
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  await click(A, '#main-contacts-list .ble-contact-row'); await sleep(500);
  await send(A, 'Hola, mensaje propio https://nexo.app'); await sleep(1500);
  const REAL = '#messages-container .message.own';

  // (1) de fábrica: lo de hoy
  const f0 = await A.evaluate(LEER + '(' + JSON.stringify(REAL) + ')');
  ok(f0, 'hay una burbuja propia real en el chat');
  if (f0) {
    ok(f0.fondo === 'linear-gradient(135deg, rgb(0, 200, 255), rgb(168, 85, 247))', '(1) degradado de siempre, es: ' + f0.fondo);
    ok(f0.color === 'rgb(255, 255, 255)', '(1) texto blanco de siempre, es: ' + f0.color);
    ok(f0.hora === 'rgba(255, 255, 255, 0.55)', '(1) hora de siempre, es: ' + f0.hora);
    ok(f0.borde === 'rgba(0, 0, 0, 0)', '(1) sin contorno (transparente), es: ' + f0.borde);
    ok(!f0.blur || f0.blur === 'none', '(1) sin desenfoque en la propia, es: ' + f0.blur);
    ok(/-apple-system/.test(f0.letra), '(1) letra de siempre, es: ' + f0.letra);
    ok(f0.clases === '' && !/--burbuja|--nx-font/.test(f0.vars), '(1) <html> sin clases ni variables de apariencia: ' + f0.clases + ' | ' + f0.vars);
  }
  const base = f0;

  // (2) la sección existe en Ajustes
  await click(A, '#nexo-profile-btn'); await sleep(600);
  await A.evaluate(() => document.getElementById('nexo-open-settings').click()); await sleep(900);
  ok(await A.evaluate(() => !!document.querySelector('.nx-set-row[data-sec="look"]')), '(2) existe la sección Apariencia en Ajustes');
  await A.evaluate(() => document.querySelector('.nx-set-row[data-sec="look"]').click()); await sleep(500);
  ok(await A.evaluate(() => !!document.querySelector('#apar-demo')), '(2) hay burbujita de ejemplo');
  ok(await A.evaluate(() => document.querySelector('#apar-n button').getAttribute('data-n') === '2'), '(2) «Dos colores» es la primera opción');
  ok(await A.evaluate(() => document.querySelectorAll('#apar-sw1 button').length >= 8 && !!document.querySelector('input[type=color]#apar-in1')), '(2) paleta + selector libre');
  const demo0 = await A.evaluate(LEER + "('#apar-demo')");
  ok(demo0 && demo0.fondo === base.fondo, '(2) el ejemplo sin elección se ve como las burbujas de siempre');

  // (3)–(6) combinaciones: se elige con los controles de verdad (paleta / selector libre / botones)
  const setColor = (i, hex) => A.evaluate(([i, hex]) => { const e = document.getElementById('apar-in' + i); e.value = hex; e.dispatchEvent(new Event('input', { bubbles: true })); }, [i, hex]);
  // esperado: 'oscuro' / 'claro' solo en los casos evidentes; en los demás se exige que el texto sea la mejor de las dos opciones
  const CASOS = [
    { n: 2, c1: '#00c8ff', c2: '#a855f7', estilo: 'pleno', fabrica: true }, // los de siempre elegidos a mano = de fábrica (texto blanco de siempre)
    { n: 2, c1: '#ef4444', c2: '#f97316', estilo: 'pleno' },
    { n: 2, c1: '#facc15', c2: '#e5e7eb', estilo: 'pleno', esperado: 'oscuro' },
    { n: 1, c1: '#22c55e', c2: '#000000', estilo: 'pleno' },
    { n: 1, c1: '#ffffff', c2: '#000000', estilo: 'pleno', esperado: 'oscuro' },
    { n: 1, c1: '#1e3a8a', c2: '#000000', estilo: 'pleno', esperado: 'claro' },
    { n: 2, c1: '#00c8ff', c2: '#14b8a6', estilo: 'pleno' },
    { n: 2, c1: '#ec4899', c2: '#6366f1', estilo: 'cristal', esperado: 'claro' },
    { n: 1, c1: '#facc15', c2: '#000000', estilo: 'cristal', esperado: 'claro' }
  ];
  for (const c of CASOS) {
    const etq = JSON.stringify(c);
    await A.evaluate((n) => document.querySelector('#apar-n button[data-n="' + n + '"]').click(), c.n);
    await setColor(1, c.c1); if (c.n === 2) await setColor(2, c.c2);
    await A.evaluate((e) => document.querySelector('#apar-estilo button[data-e="' + e + '"]').click(), c.estilo);
    await sleep(120);
    for (const [sel, nom] of [['#apar-demo', 'ejemplo'], [REAL, 'real']]) {
      const r = await A.evaluate(LEER + '(' + JSON.stringify(sel) + ')');
      if (!r) { ok(false, nom + ' no encontrada ' + etq); continue; }
      const c2 = c.n === 1 ? c.c1 : c.c2, v = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
      ok(r.cols.length === 2, '(3) ' + nom + ' degradado de 2 paradas ' + etq + ': ' + r.fondo);
      if (r.cols.length === 2) {
        ok(r.cols[0].slice(0, 3).join() === v(c.c1).join() && r.cols[1].slice(0, 3).join() === v(c2).join(), '(3) ' + nom + ' colores = elegidos ' + etq + ': ' + r.fondo);
        if (c.estilo === 'cristal') ok(r.cols.every((q) => q[3] < 0.6) && /blur/.test(r.blur), '(5) ' + nom + ' cristal translúcido con desenfoque ' + etq + ': ' + r.fondo + ' ' + r.blur);
        else ok(r.cols.every((q) => q[3] === 1) && (!r.blur || r.blur === 'none'), '(5) ' + nom + ' pleno sólido ' + etq);
      }
      const col = (s) => (/rgba?\(([^)]+)\)/.exec(s) || [0, '0,0,0'])[1].split(',').map(parseFloat);
      const t = col(r.txt);
      const oscuro = lum(t) < 0.2;
      if (c.fabrica) { ok(r.color === 'rgb(255, 255, 255)' && r.hora === base.hora, '(1) la combinación de fábrica elegida a mano deja lo de siempre ' + etq); continue; }
      if (c.esperado) ok(oscuro === (c.esperado === 'oscuro'), '(4) ' + nom + ' texto ' + c.esperado + ' ' + etq + ': ' + r.txt);
      if (c.estilo === 'pleno') {
        const fondos = [v(c.c1), v(c2)], peor = (fg) => Math.min(...fondos.map((f) => cr(fg, f)));
        const mejor = Math.max(peor([255, 255, 255]), peor([17, 17, 17]));
        ok(peor(t) >= mejor - 0.01, '(4) ' + nom + ' el texto es la mejor opción de contraste ' + etq + ': ' + r.txt);
        for (const [k, v2] of [['txt', r.txt], ['enlace', r.enlace]]) ok(mejor < 3 || cr(col(v2), v(c.c1)) >= 3 && cr(col(v2), v(c2)) >= 3, '(4) ' + nom + ' ' + k + ' legible (contraste ≥ 3) ' + etq + ': ' + v2);
        for (const [k, v2] of [['estado', r.estado], ['hora', r.hora]]) {
          // hora y ✓ llevan transparencia: se mezclan con el fondo antes de medir el contraste
          const q = col(v2), a = q.length > 3 ? q[3] : 1;
          for (const f of fondos) { const m = q.slice(0, 3).map((x, i) => x * a + f[i] * (1 - a)); ok(cr(m, f) >= 2.2, '(4) ' + nom + ' ' + k + ' legible (≥ 2,2) sobre ' + f + ' ' + etq + ': ' + v2); }
        }
      }
    }
  }
  // letra: 4 familias; cambia body y botones
  const vistas = new Set();
  for (const f of ['serif', 'redonda', 'mono', 'sistema']) {
    await A.evaluate((f) => document.querySelector('#apar-fuente button[data-f="' + f + '"]').click(), f); await sleep(100);
    const r = await A.evaluate(LEER + '("#apar-demo")');
    vistas.add(r.letra);
    if (f === 'sistema') ok(/-apple-system/.test(r.letra) && !/nx-font-custom/.test(r.clases), '(6) «La de siempre» vuelve a la letra de siempre: ' + r.letra);
    else { ok(!/-apple-system/.test(r.letra), '(6) ' + f + ' cambia la letra del body: ' + r.letra); ok(r.letraBtn === r.letra, '(6) ' + f + ' también en botones: ' + r.letraBtn); }
  }
  ok(vistas.size === 4, '(6) cuatro letras distintas: ' + vistas.size);
  const fuentesRed = await A.evaluate(() => Array.from(document.styleSheets).reduce((n, s) => { try { return n + Array.from(s.cssRules).filter((r) => r.type === 5).length; } catch (e) { return n; } }, 0));
  ok(fuentesRed === 0, '(6) la app no declara @font-face (nada se baja): ' + fuentesRed);

  // (7) elección final que se conservará al reiniciar
  const FIN = { n: 2, c1: '#facc15', c2: '#f97316', estilo: 'pleno', fuente: 'serif' };
  await A.evaluate((n) => document.querySelector('#apar-n button[data-n="' + n + '"]').click(), 2);
  await setColor(1, FIN.c1); await setColor(2, FIN.c2);
  await A.evaluate((e) => document.querySelector('#apar-estilo button[data-e="' + e + '"]').click(), FIN.estilo);
  await A.evaluate((f) => document.querySelector('#apar-fuente button[data-f="' + f + '"]').click(), FIN.fuente); await sleep(400);
  const guardado = JSON.parse(nA.files.get('nexo_apariencia.json') || 'null');
  ok(guardado && guardado.c1 === FIN.c1 && guardado.c2 === FIN.c2 && guardado.estilo === 'pleno' && guardado.fuente === 'serif', '(7) se guardó en el archivo: ' + JSON.stringify(guardado));
  const antes = await A.evaluate(LEER + '(' + JSON.stringify(REAL) + ')');
  await A.close();
  A = await arrancar(browser, radio, nA, 'A', logs); await sleep(800);
  await A.evaluate(() => { try { window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} })); } catch (e) {} });
  const despues = await A.evaluate(LEER + '("#apar-demo")');   // no hay ejemplo: se mira <html>
  const html = await A.evaluate(() => ({ c: document.documentElement.className, v: document.documentElement.style.getPropertyValue('--burbuja-1') + '|' + document.documentElement.style.getPropertyValue('--burbuja-2'), f: getComputedStyle(document.body).fontFamily }));
  ok(despues === null && /nx-bub-custom/.test(html.c) && html.v === FIN.c1 + '|' + FIN.c2, '(7) tras reiniciar la app se conserva el color: ' + JSON.stringify(html));
  ok(/Georgia/.test(html.f), '(7) tras reiniciar se conserva la letra: ' + html.f);
  ok(antes && antes.color === 'rgb(17, 17, 17)', '(7) (antes de reiniciar) texto oscuro sobre amarillo→naranja: ' + (antes && antes.color));

  // (8) Restablecer
  await click(A, '#nexo-profile-btn'); await sleep(600);
  await A.evaluate(() => document.getElementById('nexo-open-settings').click()); await sleep(900);
  await A.evaluate(() => document.querySelector('.nx-set-row[data-sec="look"]').click()); await sleep(400);
  ok(await A.evaluate(() => document.querySelector('#apar-in1').value) === FIN.c1, '(7) los controles muestran lo guardado');
  await A.evaluate(() => document.getElementById('apar-reset').click()); await sleep(400);
  const r8 = await A.evaluate(LEER + '("#apar-demo")');
  ok(r8.fondo === base.fondo && r8.color === base.color && r8.hora === base.hora && r8.letra === base.letra, '(8) Restablecer deja los valores de fábrica: ' + r8.fondo + ' ' + r8.color + ' ' + r8.letra);
  ok(r8.clases === '' && !/--burbuja|--nx-font/.test(r8.vars), '(8) <html> limpio tras restablecer: ' + r8.clases + ' | ' + r8.vars);
  ok(nA.files.get('nexo_apariencia.json') === '{}', '(8) archivo vacío tras restablecer: ' + nA.files.get('nexo_apariencia.json'));
  ok(await A.evaluate(() => document.querySelector('#apar-n button.on').getAttribute('data-n') === '2' && document.querySelector('#apar-estilo button.on').getAttribute('data-e') === 'pleno'), '(8) los controles vuelven a «Dos colores / Pleno»');

  // (9) archivo corrupto o con valores raros: valores de fábrica y la app sigue
  nA.files.set('nexo_apariencia.json', '{"n":7,"c1":"rojo;}</style>","c2":"#zzzzzz","estilo":"x","fuente":"__proto__"}');
  await A.close();
  A = await arrancar(browser, radio, nA, 'A', logs); await sleep(600);
  const h9 = await A.evaluate(() => ({ c: document.documentElement.className, s: document.documentElement.getAttribute('style') || '' }));
  ok(h9.c === '' && !/--burbuja|--nx-font/.test(h9.s), '(9) valores raros → de fábrica: ' + JSON.stringify(h9));
  nA.files.set('nexo_apariencia.json', 'no es json');
  await A.close();
  A = await arrancar(browser, radio, nA, 'A', logs); await sleep(600);
  ok(await A.evaluate(() => !!document.getElementById('main-contacts-list')), '(9) archivo corrupto: la app arranca');
  const errs = logs.filter((l) => /PAGEERROR/.test(l));
  ok(errs.length === 0, 'sin errores de página: ' + errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('resultado: ' + (fallos.length ? 'FALLO (' + fallos.length + ')' : 'OK'));
  console.log('APARIENCIA ' + JSON.stringify({ resultado: fallos.length ? 'FALLO' : 'OK', fallos: fallos })); // para ci.js
  process.exit(fallos.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
