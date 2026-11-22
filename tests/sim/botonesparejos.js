// Botones parejos (cola 32, queja del dueño: «los botones no son parejos entre pantallas»). Mide en Perfil, Ajustes (cada sección),
// Agregar contactos y el menú de adjuntar, a 360 px y letra normal:
//  (a) botones HERMANOS en la misma fila con alturas distintas (> 2 px),
//  (b) botones del MISMO TIPO (misma clase) en la pantalla con radios de esquina distintos o con tamaños de letra distintos,
//  (c) botones hermanos en la misma fila con tamaños de letra distintos.
//  (d) familia nx-btn / invitar+Agregar: misma altura, letra y radio en toda la pantalla.
// Un botón redondo (icono, ancho = alto) no se compara con los rectangulares. Lista lo que sale y termina con «resultado: OK|FALLO».
// Uso: node botonesparejos.js <dir_build>
'use strict';
const path = require('path');
const { PW, bootPhone, click, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2] || 'builds/wip', 'dist');
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true };

const ANALIZAR = `(function () {
  var W = window.innerWidth, H = window.innerHeight, P = [];
  function desc(e) { var s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; else if (e.className && typeof e.className === 'string') s += '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.'); return s; }
  function visible(e) {
    for (var n = e; n && n !== document.documentElement; n = n.parentElement) { var cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; }
    var r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W)) return false;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2, t = document.elementFromPoint(cx, cy);
    return !!t && (e.contains(t) || t.contains(e));
  }
  var btns = Array.prototype.slice.call(document.querySelectorAll('button,[role=button],input[type=button],.btn')).filter(visible).map(function (b) {
    var r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    return { b: b, r: r, fs: parseFloat(cs.fontSize), rad: parseFloat(cs.borderTopLeftRadius) || 0, pos: cs.position,
      redondo: Math.abs(r.width - r.height) < 2 || parseFloat(cs.borderTopLeftRadius) >= r.height / 2 - 1,
      conTexto: Array.prototype.some.call(b.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); }) || !!b.querySelector('span') && (b.innerText || '').trim().length > 0,
      tipo: Array.prototype.slice.call(b.classList).sort().join('.') };
  });
  // (a) y (c): hermanos en la misma fila
  var grupos = new Map();
  btns.forEach(function (x) { var p = x.b.parentElement; if (!grupos.has(p)) grupos.set(p, []); grupos.get(p).push(x); });
  grupos.forEach(function (l) {
    for (var i = 0; i < l.length; i++) for (var j = i + 1; j < l.length; j++) {
      var a = l[i], b = l[j]; if (a.pos === 'absolute' || b.pos === 'absolute') continue;
      var oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (!(oy > Math.min(a.r.height, b.r.height) * 0.6)) continue;   // no están en la misma fila
      if (Math.abs(a.r.height - b.r.height) > 2) P.push({ tipo: 'alturas', el: desc(a.b) + ' x ' + desc(b.b), x: Math.round(a.r.height) + ' vs ' + Math.round(b.r.height), texto: (a.b.innerText || '').trim().slice(0, 15) + ' | ' + (b.b.innerText || '').trim().slice(0, 15) });
      if (a.conTexto && b.conTexto && Math.abs(a.fs - b.fs) > 0.5) P.push({ tipo: 'letra_fila', el: desc(a.b) + ' x ' + desc(b.b), x: a.fs + ' vs ' + b.fs, texto: (a.b.innerText || '').trim().slice(0, 15) + ' | ' + (b.b.innerText || '').trim().slice(0, 15) });
    }
  });
  // (b) mismo tipo en la pantalla: radio y letra
  var porTipo = {};
  btns.forEach(function (x) { if (!x.tipo || x.redondo || !x.conTexto) return; (porTipo[x.tipo] = porTipo[x.tipo] || []).push(x); });
  Object.keys(porTipo).forEach(function (k) {
    var l = porTipo[k]; if (l.length < 2) return;
    var r0 = l[0], dr = l.filter(function (x) { return Math.abs(x.rad - r0.rad) > 0.5; }), df = l.filter(function (x) { return Math.abs(x.fs - r0.fs) > 0.5; });
    if (dr.length) P.push({ tipo: 'radio', el: '.' + k, x: l.map(function (x) { return x.rad; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / '), texto: l.slice(0, 3).map(function (x) { return (x.b.innerText || '').trim().slice(0, 12); }).join(' | ') });
    if (df.length) P.push({ tipo: 'letra_tipo', el: '.' + k, x: l.map(function (x) { return x.fs; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / '), texto: l.slice(0, 3).map(function (x) { return (x.b.innerText || '').trim().slice(0, 12); }).join(' | ') });
  });
  // (d) familia de botones de texto con relleno (nx-btn*, invitar y «Agregar»): misma altura, letra y radio en toda la pantalla
  var fam = {};
  btns.forEach(function (x) {
    if (x.redondo || !x.conTexto) return;
    var f = /(^|\s)nx-btn(-primary)?(\s|$)/.test(x.b.className) ? 'nx-btn' : (/^ble-(inv-|addid-btn)/.test(x.b.id) ? 'invitar' : ''); if (f) (fam[f] = fam[f] || []).push(x);
  });
  Object.keys(fam).forEach(function (k) {
    var l = fam[k], h0 = l[0].r.height;
    [['altura_familia', function (x) { return Math.round(x.r.height); }, 1], ['letra_familia', function (x) { return x.fs; }, 0.5], ['radio_familia', function (x) { return x.rad; }, 0.5]].forEach(function (c) {
      var v = l.map(c[1]), mx = Math.max.apply(null, v), mn = Math.min.apply(null, v);
      if (mx - mn > c[2]) P.push({ tipo: c[0], el: k, x: v.filter(function (q, i, a) { return a.indexOf(q) === i; }).join(' / '), texto: l.slice(0, 4).map(function (x) { return (x.b.innerText || '').trim().slice(0, 12); }).join(' | ') });
    });
  });
  if (window.__DUMP) btns.forEach(function (x) { if (!x.redondo) P.push({ tipo: 'dump', el: desc(x.b), x: Math.round(x.r.width) + 'x' + Math.round(x.r.height) + ' r' + x.rad + ' f' + x.fs, texto: (x.b.innerText || '').trim().slice(0, 14) }); });
  return P;
})()`;

(async () => {
  const browser = await PW.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const radio = new Radio(); const logs = [];
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A] = (await Promise.all([
    bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana', lang: 'es' }),
    bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Beto', lang: 'es' })])).map((x) => x.page);
  await A.setViewportSize({ width: 360, height: 800 });
  if (process.env.DUMP) await A.evaluate(() => { window.__DUMP = true; });
  const problemas = [], vistos = new Set();
  const medir = async (nombre) => {
    await sleep(250);
    const pr = await A.evaluate(ANALIZAR);
    pr.forEach((p) => { const k = nombre + p.tipo + p.el + p.x; if (vistos.has(k)) return; vistos.add(k); problemas.push({ pantalla: nombre, ...p }); });
  };
  // Agregar contactos (con un dispositivo encontrado)
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await A.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; if (!(await A.evaluate(() => window.bleInterface.isScanning))) await click(A, '#ble-scan-btn'); }
  await medir('agregar_contactos');
  await click(A, '#ble-new-device button'); await sleep(1500);
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  // menú de adjuntar
  await click(A, '#main-contacts-list .ble-contact-row'); await sleep(500);
  await click(A, '#attach-btn'); await sleep(300);
  await medir('chat_adjuntar');
  await click(A, '#attach-btn'); await sleep(300);
  await A.evaluate(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }))); await sleep(500);
  // Perfil y Ajustes (lista y cada sección)
  await click(A, '#nexo-profile-btn'); await sleep(600);
  await medir('perfil');
  await A.evaluate(() => document.getElementById('nexo-open-settings').click()); await sleep(900);
  await medir('ajustes');
  const secs = await A.evaluate(() => Array.from(document.querySelectorAll('.nx-set-row')).map((r) => r.getAttribute('data-sec')));
  for (const k of secs) {
    await A.evaluate((k) => document.querySelector('.nx-set-row[data-sec="' + k + '"]').click(), k); await sleep(500);
    await medir('ajustes_' + k);
    await A.evaluate(() => document.getElementById('nexo-settings-back').click()); await sleep(250);
  }
  await browser.close();
  console.log(JSON.stringify(problemas, null, 1));
  console.log('resultado: ' + (problemas.length ? 'FALLO (' + problemas.length + ')' : 'OK'));
  console.log('BOTONESPAREJOS ' + JSON.stringify({ resultado: problemas.length ? 'FALLO' : 'OK', problemas: problemas.length })); // para ci.js
  process.exit(problemas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
