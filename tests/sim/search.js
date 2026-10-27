// Buscar dentro del chat (lupa de la cabecera): A y B emparejados; A escribe varios textos y recibe uno de B.
// Comprueba: la lupa está en la cabecera y abre una barra debajo; al teclear, oculta las burbujas que no
// coinciden, resalta las que sí (propias y recibidas) y cuenta cuántas; vaciar y cerrar restauran todo.
// Uso: node search.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChat(p) { click(p.win, p.win.document.querySelector('#main-contacts-list .ble-contact-row')); await sleep(500); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); await sleep(250); }
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; }

// Teclea en la barra de búsqueda y devuelve {visibles, resaltados, cuenta}
async function search(p, q) {
  const inp = p.win.document.getElementById('nexo-search-input');
  inp.value = q; inp.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  await sleep(150);
  const all = Array.from(p.win.document.querySelectorAll('#messages-container .message'));
  const visibles = all.filter((m) => !m.classList.contains('msg-search-hidden'));
  const resaltados = all.filter((m) => m.classList.contains('msg-search-hit'));
  const cuenta = (p.win.document.getElementById('nexo-search-count') || {}).textContent || '';
  return { total: all.length, visibles: visibles.length, resaltados: resaltados.length, cuenta };
}

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const [A, B] = await Promise.all([boot('A', nA), boot('B', nB)]);
  const r = { build: path.basename(buildDir) };

  // Emparejar por Bluetooth (como en cobro.js)
  A.win.bleInterface.togglePanel();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = A.win.document.querySelector('#ble-new-device > div button'); if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn')); }
  if (!add) { console.log('SEARCH ' + JSON.stringify({ resultado: 'FAIL', error: 'no empareja' })); process.exit(0); }
  click(A.win, add); await sleep(2500);
  A.win.bleInterface.togglePanel();
  const idA = A.win.bleInterface.localNexoId.toLowerCase();
  await openChat(A);

  // A escribe varios textos (dos con "tacos"); B contesta uno (para buscar también en un recibido)
  await sendText(A, 'hola buenos dias');
  await sendText(A, 'vamos a comer tacos');
  await sendText(A, 'nos vemos en el parque');
  await sendText(A, 'tacos al pastor porfa');
  r.B_recibe = await waitFor(async () => (await B.win.vaultLoadMessages(idA)).some((m) => !m._own && /parque/.test(m.content || '')), 15000);
  await openChat(B); await sleep(400);
  await sendText(B, 'de acuerdo con los tacos');
  // A recibe la respuesta de B y se pinta en su chat
  r.A_recibe_respuesta = await waitFor(() => Array.from(A.win.document.querySelectorAll('#messages-container .message.other')).some((m) => /de acuerdo con los tacos/.test(m.textContent)), 15000);
  await sleep(400);

  // La lupa está en la cabecera
  const btn = A.win.document.getElementById('nexo-search-btn');
  r.lupa_en_cabecera = !!btn && btn.closest('#chat-header') === A.win.document.getElementById('chat-header');

  // Al pulsarla aparece la barra debajo de la cabecera
  click(A.win, btn); await sleep(200);
  const bar = A.win.document.getElementById('nexo-search-bar');
  r.barra_visible = !!bar && bar.style.display === 'flex';
  r.barra_debajo_cabecera = !!bar && bar.previousElementSibling === A.win.document.getElementById('chat-header');

  const totalMsgs = A.win.document.querySelectorAll('#messages-container .message').length;
  r.total_mensajes = totalMsgs;

  // Buscar "tacos": coincide en 2 propios + 1 recibido = 3
  const t = await search(A, 'tacos');
  r.tacos = t;
  r.tacos_ok = t.resaltados === 3 && t.visibles === 3 && /3 resultados/.test(t.cuenta);

  // Buscar "parque": 1
  const pq = await search(A, 'parque');
  r.parque = pq;
  r.parque_ok = pq.resaltados === 1 && pq.visibles === 1 && /1 resultado\b/.test(pq.cuenta);

  // Mayúsculas/acentos de más: insensible a mayúsculas
  const may = await search(A, 'TACOS');
  r.insensible_mayusculas = may.resaltados === 3;

  // Sin coincidencias: 0, todo oculto
  const no = await search(A, 'zzzxxx-no-existe');
  r.sin_resultados = no.resaltados === 0 && no.visibles === 0 && /0 resultados/.test(no.cuenta);

  // Vaciar: se restauran todos
  const vacio = await search(A, '');
  r.vaciar_restaura = vacio.visibles === totalMsgs && vacio.resaltados === 0 && vacio.cuenta === '';

  // Buscar de nuevo y cerrar con la ✕: barra oculta y todo restaurado
  await search(A, 'tacos');
  click(A.win, A.win.document.getElementById('nexo-search-close')); await sleep(200);
  const barHidden = A.win.document.getElementById('nexo-search-bar').style.display === 'none';
  const afterClose = Array.from(A.win.document.querySelectorAll('#messages-container .message'));
  r.cerrar_restaura = barHidden && afterClose.every((m) => !m.classList.contains('msg-search-hidden') && !m.classList.contains('msg-search-hit'));

  // Abrir búsqueda y luego cerrar el chat: la búsqueda se resetea sola
  click(A.win, A.win.document.getElementById('nexo-search-btn')); await sleep(150);
  await search(A, 'parque');
  A.win.dispatchEvent(new A.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(200);
  r.cerrar_chat_resetea = A.win.document.getElementById('nexo-search-bar').style.display === 'none' &&
    Array.from(A.win.document.querySelectorAll('#messages-container .message')).every((m) => !m.classList.contains('msg-search-hidden'));

  r.errores = logs.filter((l) => /TypeError|undefined is not|No se pudo descifrar|Error procesando/.test(l)).slice(0, 4);
  const ok = r.lupa_en_cabecera && r.barra_visible && r.barra_debajo_cabecera && r.tacos_ok && r.parque_ok &&
    r.insensible_mayusculas && r.sin_resultados && r.vaciar_restaura && r.cerrar_restaura && r.cerrar_chat_resetea &&
    r.A_recibe_respuesta && r.errores.length === 0;
  r.resultado = ok ? 'OK' : 'FAIL';
  console.log('SEARCH ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_search.txt'), logs.join('\n'));
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_search.txt'), logs.join('\n')); process.exit(1); });
