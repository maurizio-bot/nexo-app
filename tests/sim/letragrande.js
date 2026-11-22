// Cola 32: la app debe verse bien con cualquier tamaño de letra del sistema y cualquier ancho de teléfono.
// Recorre las pantallas principales en anchos 320/360/412 px y letra 100/130/160 % y mide solo, por pantalla:
//  (a) elementos que se salen del ancho o provocan desplazamiento horizontal,
//  (b) textos cortados sin puntos suspensivos en botones y cabeceras,
//  (c) botones de una misma fila con alturas distintas (> 2 px) o que se enciman.
// La letra del sistema (textZoom de la WebView) se simula como ella: escala el tamaño de letra de cada elemento
// SIN tocar el ancho de la pantalla ni las cajas (no es un zoom de página).
// Uso: node letragrande.js <dir_build> [carpeta_capturas]  → imprime JSON con los problemas y «resultado: OK|FALLO».
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, click, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2] || 'builds/wip', 'dist');
const shotsDir = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const ANCHOS = [320, 360, 412], LETRAS = [1, 1.3, 1.6];
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true };

// Se ejecuta en la página: aplica la letra (escala el font-size calculado de cada elemento)
const APLICAR_LETRA = `(function (escala) {
  var all = Array.prototype.slice.call(document.querySelectorAll('body *'));
  all.forEach(function (e) { if (e.__lgOrig !== undefined) { if (e.__lgOrig) e.setAttribute('style', e.__lgOrig); else e.removeAttribute('style'); e.__lgOrig = undefined; } });
  var tam = all.map(function (e) { return parseFloat(getComputedStyle(e).fontSize); });
  if (escala !== 1) all.forEach(function (e, i) { e.__lgOrig = e.getAttribute('style') || ''; e.style.setProperty('font-size', (tam[i] * escala) + 'px', 'important'); });
  window.dispatchEvent(new Event('resize'));
  // en el teléfono el tamaño de letra cambia con la app cerrada: al abrir el chat se reajusta el nombre (main.js, _fitContactName)
  window.dispatchEvent(new CustomEvent('nexo:ble:linkChange', { detail: {} }));
  return true;
})`;
const ANALIZAR = `(function () {
  var W = window.innerWidth, H = window.innerHeight, P = [];
  function desc(e) { var s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; else if (e.className && typeof e.className === 'string') s += '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.'); return s; }
  function visible(e) {
    for (var n = e; n && n !== document.documentElement; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    }
    var r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  }
  // dentro de un carril que se desliza o de un contenedor que recorta a propósito: no cuenta como salido
  function recortado(e) {
    for (var n = e.parentElement; n && n !== document.body; n = n.parentElement) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(n).overflowX) && n.getBoundingClientRect().width > 0) return true;
    }
    return false;
  }
  var els = Array.prototype.slice.call(document.querySelectorAll('body *')).filter(function (e) {
    if (/^(script|style|link|meta|svg|path|g|circle|rect|line|polyline|defs|use|canvas)$/i.test(e.tagName)) return false;
    if (!visible(e)) return false; var r = e.getBoundingClientRect(); if (!(r.bottom > 0 && r.top < H && r.right > 0 && r.left < W - 1)) return false; // fuera de la pantalla por completo (hojas escondidas con transform): no se ve
    // tapado por otra pantalla encima (la de abajo sigue en el DOM): no cuenta
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx > 0 && cx < W && cy > 0 && cy < H) { var t = document.elementFromPoint(cx, cy); if (t && !(e.contains(t) || t.contains(e))) return false; }
    return true;
  });
  // (a) salidas por la derecha o la izquierda
  els.forEach(function (e) {
    var r = e.getBoundingClientRect();
    if ((r.right > W + 1 || r.left < -1) && !recortado(e) && r.left < W && r.right > 0)
      P.push({ tipo: 'salido', el: desc(e), x: Math.round(r.left) + '..' + Math.round(r.right), texto: (e.innerText || '').trim().slice(0, 30) });
  });
  // el texto mismo se sale de la pantalla o lo recorta un contenedor con overflow:hidden (se ve cortado aunque la caja quepa)
  els.forEach(function (e) {
    var nodos = Array.prototype.filter.call(e.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); });
    if (!nodos.length || e.matches('textarea,input')) return;
    var tr = null; nodos.forEach(function (nd) { var rg = document.createRange(); rg.selectNodeContents(nd); var q = rg.getBoundingClientRect(); if (!q.width) return; tr = tr ? { left: Math.min(tr.left, q.left), right: Math.max(tr.right, q.right), width: 1 } : { left: q.left, right: q.right, width: q.width }; }); if (!tr) return; // solo el texto propio (no el de los hijos)
    var motivo = '', cse = getComputedStyle(e), er = e.getBoundingClientRect();
    // texto de una sola línea con puntos suspensivos dentro de una caja que cabe en la pantalla: se ve «Texto…», no cortado
    var conPuntos = cse.textOverflow === 'ellipsis' && /(hidden|clip)/.test(cse.overflowX) && er.right <= W + 1 && er.left >= -1;
    if (conPuntos) return;
    if (tr.right > W + 1 || tr.left < -1) motivo = 'pantalla';
    for (var n = e; n && n !== document.body && !motivo; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (/(auto|scroll)/.test(cs.overflowX)) break;
      if (/(hidden|clip)/.test(cs.overflowX) && !(n === e && cs.textOverflow === 'ellipsis')) { var nr = n.getBoundingClientRect(); if (tr.right > nr.right + 1 || tr.left < nr.left - 1) motivo = 'recortado por ' + desc(n); }
    }
    var cs0 = getComputedStyle(e);
    if (!motivo && cs0.display !== 'inline' && cs0.overflowX === 'visible' && e.clientWidth > 0 && (tr.right > er.right + 6 || tr.left < er.left - 6)) motivo = 'desborda su caja (' + Math.round(tr.right) + ' > ' + Math.round(er.right) + ')';
    if (motivo) P.push({ tipo: 'cortado', el: desc(e), x: 'texto ' + Math.round(tr.left) + '..' + Math.round(tr.right) + ' ' + motivo, texto: (e.innerText || '').trim().slice(0, 30) });
  });
  if (document.documentElement.scrollWidth > W + 1) P.push({ tipo: 'salido', el: 'documento', x: 'scrollWidth ' + document.documentElement.scrollWidth, texto: '' });
  // (b) textos cortados (en ancho sin puntos suspensivos, o en alto)
  els.forEach(function (e) {
    if (e.matches('textarea,input[type=text]') && e.value && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 1) && (e.matches('[id*=name],[id*=title],[id*=header] *,header *') || e.rows === 1))
      P.push({ tipo: 'cortado', el: desc(e), x: 'scroll ' + e.scrollWidth + 'x' + e.scrollHeight + ' / client ' + e.clientWidth + 'x' + e.clientHeight, texto: e.value.slice(0, 30) });
    if (!e.matches('button,[role=button],a,h1,h2,h3,label,header *,[id*=header] *,[class*=btn],[class*=title],[class*=name]')) return;
    var tieneTexto = Array.prototype.some.call(e.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); });
    if (!tieneTexto) return;
    var cs = getComputedStyle(e), clampV = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    var cortaX = /(hidden|clip)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis';
    var cortaY = /(hidden|clip)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2 && !clampV;
    if (cortaX || cortaY) P.push({ tipo: 'cortado', el: desc(e), x: 'scroll ' + e.scrollWidth + 'x' + e.scrollHeight + ' / client ' + e.clientWidth + 'x' + e.clientHeight, texto: (e.innerText || '').trim().slice(0, 30) });
  });
  // (c) botones hermanos: encimados o de distinta altura en la misma fila
  var btns = els.filter(function (e) { return e.matches('button,[role=button],input[type=button],.btn,[class*=-btn]'); });
  var grupos = new Map();
  btns.forEach(function (b) { var p = b.parentElement; if (!grupos.has(p)) grupos.set(p, []); grupos.get(p).push(b); });
  grupos.forEach(function (lista) {
    for (var i = 0; i < lista.length; i++) for (var j = i + 1; j < lista.length; j++) {
      var a = lista[i], b = lista[j], ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      if (a.contains(b) || b.contains(a)) continue;
      var ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 2 && oy > 2) { P.push({ tipo: 'encimado', el: desc(a) + ' x ' + desc(b), x: Math.round(ox) + 'x' + Math.round(oy), texto: (a.innerText || '').trim().slice(0, 15) + ' | ' + (b.innerText || '').trim().slice(0, 15) }); continue; }
      if (oy > Math.min(ra.height, rb.height) * 0.6 && Math.abs(ra.height - rb.height) > 2 && getComputedStyle(a).position !== 'absolute' && getComputedStyle(b).position !== 'absolute')
        P.push({ tipo: 'alturas', el: desc(a) + ' x ' + desc(b), x: Math.round(ra.height) + ' vs ' + Math.round(rb.height), texto: (a.innerText || '').trim().slice(0, 15) + ' | ' + (b.innerText || '').trim().slice(0, 15) });
    }
  });
  return P;
})()`;

(async () => {
  const browser = await PW.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const logs = [];
  // nombres largos a propósito: son lo que más se encima con letra grande
  const [A, B] = (await Promise.all([
    bootPhone(browser, 'A', nA, dist, { phone: true, logs, seedName: 'Ana María de los Ángeles', lang: 'es' }),
    bootPhone(browser, 'B', nB, dist, { phone: true, logs, seedName: 'Maximiliano Fernández', lang: 'es' })])).map((x) => x.page);
  const send = (p, t) => p.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t);
  const cerrarChat = () => A.evaluate(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} })));
  const problemas = [];
  const medirPantalla = async (nombre) => {
    for (const w of ANCHOS) for (const l of LETRAS) {
      await A.setViewportSize({ width: w, height: 800 }); await sleep(120);
      await A.evaluate(APLICAR_LETRA + '(' + l + ')'); await sleep(150);
      const pr = await A.evaluate(ANALIZAR);
      const vistos = new Set();
      pr.forEach((p) => { const k = p.tipo + p.el + p.x; if (vistos.has(k)) return; vistos.add(k); problemas.push({ pantalla: nombre, ancho: w, letra: Math.round(l * 100) + '%', ...p }); });
      if (shotsDir && ((w === 320 && l === 1.6) || (w === 412 && l === 1))) await A.screenshot({ path: path.join(shotsDir, nombre + '_' + w + '_' + Math.round(l * 100) + '.png') });
    }
    await A.evaluate(APLICAR_LETRA + '(1)'); await A.setViewportSize({ width: 393, height: 851 }); await sleep(100);
  };

  // Agregar contactos: panel de dispositivos con uno encontrado
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); if (await A.evaluate(() => !!document.querySelector('#ble-new-device button'))) break; if (!(await A.evaluate(() => window.bleInterface.isScanning))) await click(A, '#ble-scan-btn'); }
  await medirPantalla('agregar_contactos');
  await click(A, '#ble-new-device button'); await sleep(1500);
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  // Chat con mensajes largos y cortos
  await click(A, '#main-contacts-list .ble-contact-row'); await sleep(500);
  await send(A, 'Hola 😀'); await sleep(1200);
  await click(B, '#main-contacts-list .ble-contact-row'); await sleep(500);
  await send(B, 'Este es un mensaje bastante largo para ver cómo se parte en varias líneas, con una palabraenormesinespaciosquepodriadesbordarlaburbujadelchatsinqueseacorte y un enlace https://ejemplo.com/una/ruta/muy/larga/que/no/cabe/en/la/pantalla/del/telefono?x=1234567890'); await sleep(1500);
  await send(A, 'Ok'); await sleep(1200);
  await send(A, 'Mensaje mío también largo: nos vemos mañana en la estación del metro a las ocho de la mañana, no se te olvide traer lo que quedamos.'); await sleep(1500);
  await medirPantalla('chat');
  await click(A, '#attach-btn'); await sleep(300);
  await medirPantalla('chat_adjuntar');
  await click(A, '#attach-btn'); await sleep(300);
  // Llamada (si el simulador llega a ella)
  const llamo = await click(A, '#nexo-call-btn'); await sleep(2500);
  const hayLlamada = await A.evaluate(() => Array.from(document.querySelectorAll('[id*=call]')).some((d) => d.id !== 'nexo-call-btn' && d.offsetWidth > 0));
  if (llamo && hayLlamada) await medirPantalla('llamada'); else console.error('AVISO: no se llegó a la pantalla de llamada (llamo=' + llamo + ')');
  await A.evaluate(() => { const b = document.querySelector('.call-hangup, [class*=hangup], #nexo-call-end'); if (b) b.click(); }); await sleep(800);
  await cerrarChat(); await sleep(500);
  await send(B, 'Otro sin leer'); await sleep(1500);
  await medirPantalla('lista_contactos');
  await click(A, '#nexo-profile-btn'); await sleep(600);
  await medirPantalla('perfil');
  await A.evaluate(() => document.getElementById('nexo-open-settings').click()); await sleep(900);
  await medirPantalla('ajustes');
  const secs = await A.evaluate(() => Array.from(document.querySelectorAll('.nx-set-row')).map((r) => r.getAttribute('data-sec')));
  for (const k of secs) {
    await A.evaluate((k) => document.querySelector('.nx-set-row[data-sec="' + k + '"]').click(), k); await sleep(500);
    await medirPantalla('ajustes_' + k);
    await A.evaluate(() => document.getElementById('nexo-settings-back').click()); await sleep(250);
  }
  await browser.close();
  const porTipo = {}, porPantalla = {};
  problemas.forEach((p) => { porTipo[p.tipo] = (porTipo[p.tipo] || 0) + 1; porPantalla[p.pantalla] = (porPantalla[p.pantalla] || 0) + 1; });
  console.log(JSON.stringify({ total: problemas.length, porTipo, porPantalla, problemas }, null, 1));
  console.log('resultado: ' + (problemas.length ? 'FALLO' : 'OK'));
  process.exit(problemas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
