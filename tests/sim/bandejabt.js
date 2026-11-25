// 3269 (PRIORIDAD 1 del dueño, «Bluetooth entero en el servicio nativo», FASE 3; COLA 29): la BANDEJA DE SALIDA también por BLUETOOTH.
// NEXO es no quedarse sin camino: SIN internet (el metro, una multitud) escribo a alguien que en ese momento no está cerca (⏳) y
// guardo el teléfono. Cuando aparece por Bluetooth mi app ya está dormida (o cerrada): antes el mensaje no salía hasta abrir NEXO.
// Ahora lo escribe el NATIVO por ese enlace (el mismo paquete cifrado que mandaría la app) y la ✓✓ firmada del otro lo retira.
//  1) App DORMIDA (JS congelado): B se aleja, A escribe y bloquea; B vuelve → B lo recibe SIN que A abra NEXO; al abrir, ✓✓ y una copia.
//  2) App CERRADA: lo mismo cerrando NEXO.
//  3) 3271, los DOS dormidos (dos teléfonos en el bolsillo): nadie abriría el enlace → el nativo de A busca a B (escaneo corto y filtrado),
//     conecta y escribe; el nativo de B avisa y confirma; al mirar B el teléfono el mensaje ya está en el chat. (--sin-llamar: no lo abre)
// Contraprueba: node bandejabt.js <dir> --sin-bandeja (el nativo de antes): con A dormida el mensaje NO llega.
// Sin relés (nadie tiene internet). Uso: node bandejabt.js <dir_build> [--sin-bandeja]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, noOutboxBle: process.argv.includes('--sin-bandeja'), noOutboxDial: process.argv.includes('--sin-llamar') };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  let vis = 'visible';
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => vis === 'hidden' });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  const p = { name, native, win };
  p.setActive = (active) => { vis = active ? 'visible' : 'hidden'; win.document.dispatchEvent(new win.Event('visibilitychange')); native.setAppActive(active); };
  return p;
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const save = () => fs.writeFileSync(path.join(__dirname, 'last_logs_bandejabt.txt'), logs.join('\n'));

(async () => {
  const sinBandeja = process.argv.includes('--sin-bandeja');
  const r = { prueba: 'bandejabt', build: path.basename(buildDir), sin_bandeja: sinBandeja };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { noOutboxBle: false }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { r.error = 'no empareja'; r.resultado = 'FALLO'; console.log('BANDEJABT ' + JSON.stringify(r)); save(); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  const has = async (p, from, f) => (await p.win.vaultLoadMessages(from)).some(f);
  const count = async (p, from, text) => (await p.win.vaultLoadMessages(from)).filter((m) => m.content === text && !m._own).length;
  const vaultStatus = async (p, to, text) => { const m = (await p.win.vaultLoadMessages(to)).find((x) => x.content === text && x._own); return m ? m.status : null; };
  const sinSalir = (st) => st === 'pending' || st === 'sending';
  const linked = (p, nx) => { const l = p.win.bleInterface.linkOf(nx); return !!l && l !== 'none'; };
  r.base_llega = await waitFor(() => has(B, idA, (m) => m.content === 'hola B'), 20000) !== null;
  // las claves de firma del ✓✓ ya están en los dos nativos (la app las da al conocer al contacto)
  r.claves_firma = await waitFor(() => !!(nA.ackKeys && nA.ackKeys.get(idB)) && !!(nB.ackKeys && nB.ackKeys.get(idA)), 30000) !== null;

  // ===== 1) App DORMIDA =====
  radio.block(nA, nB); // B se aleja
  r.d_sin_enlace_s = await waitFor(() => !linked(A, idB), 90000);
  const t1 = 'BT-dormida ' + 'x'.repeat(300);
  sendText(A, t1); await sleep(3000);
  r.d_estado = await vaultStatus(A, idB, t1);
  r.d_queda_sin_salir = sinSalir(r.d_estado);
  A.setActive(false); // guarda el teléfono
  r.d_bandeja_s = await waitFor(() => nA.outbox && nA.outbox.items.length === 1, 15000);
  r.d_bandeja_cifrada = !!(nA.outbox && nA.outbox.items[0] && nA.outbox.items[0].nx === idB && nA.outbox.items[0].p.indexOf('BT-dormida') < 0);
  nA.setFrozen(true); await sleep(500); // Android duerme la página
  const escritas0 = nA.stats.outboxBle || 0;
  radio.unblock(nA, nB); // B aparece por Bluetooth
  r.d_llega_con_A_dormida_s = await waitFor(() => has(B, idA, (m) => m.content === t1 && !m._own), sinBandeja ? 45000 : 120000);
  r.d_lo_escribio_el_nativo = (nA.stats.outboxBle || 0) > escritas0;
  r.d_confirmado_en_el_nativo_s = await waitFor(() => nA.outbox && nA.outbox.items.length === 0 && (nA.outboxConfirmed || []).length >= 1, sinBandeja ? 3000 : 30000);
  r.d_A_seguia_dormida = nA.jsFrozen === true && sinSalir(await vaultStatus(A, idB, t1));
  nA.setFrozen(false); A.setActive(true); // A abre NEXO
  r.d_confirmado_al_abrir_s = await waitFor(async () => ['delivered', 'read'].includes(await vaultStatus(A, idB, t1)), 90000);
  await sleep(5000);
  r.d_una_copia = (await count(B, idA, t1)) === 1;

  if (!sinBandeja) {
    // ===== 2) App CERRADA =====
    await waitFor(() => linked(A, idB), 60000);
    radio.block(nA, nB);
    r.c_sin_enlace_s = await waitFor(() => !linked(A, idB), 90000);
    const t2 = 'BT-cerrada';
    sendText(A, t2); await sleep(3000);
    r.c_queda_sin_salir = sinSalir(await vaultStatus(A, idB, t2));
    A.setActive(false);
    r.c_bandeja_s = await waitFor(() => nA.outbox && nA.outbox.items.length === 1, 15000);
    await sleep(1000);
    A.win.close(); nA.destroyActivity(); // cierra NEXO (el proceso sigue vivo con el servicio y su servidor Bluetooth)
    const escritas1 = nA.stats.outboxBle || 0;
    radio.unblock(nA, nB);
    r.c_llega_con_A_cerrada_s = await waitFor(() => has(B, idA, (m) => m.content === t2 && !m._own), 120000);
    r.c_lo_escribio_el_nativo = (nA.stats.outboxBle || 0) > escritas1;
    r.c_confirmado_en_el_nativo_s = await waitFor(() => nA.outbox && nA.outbox.items.length === 0, 30000);
    nA.load(); A = await boot('A', nA);
    await openChatWith(A, 'B');
    r.c_confirmado_al_abrir_s = await waitFor(async () => ['delivered', 'read'].includes(await vaultStatus(A, idB, t2)), 90000);
    await sleep(5000);
    r.c_una_copia = (await count(B, idA, t2)) === 1;
  }
  if (!sinBandeja) {
    // ===== 3) 3271: los DOS con la app dormida (dos teléfonos en el bolsillo): nadie más abriría el enlace → lo abre el nativo de A =====
    await waitFor(() => linked(A, idB), 60000);
    radio.block(nA, nB);
    r.z_sin_enlace_s = await waitFor(() => !linked(A, idB) && !linked(B, idA), 90000);
    const t3 = 'BT-los-dos-dormidos';
    sendText(A, t3); await sleep(3000);
    r.z_queda_sin_salir = sinSalir(await vaultStatus(A, idB, t3));
    A.setActive(false);
    r.z_bandeja_s = await waitFor(() => nA.outbox && nA.outbox.items.length === 1, 15000);
    nA.setFrozen(true);
    B.setActive(false); await sleep(500); nB.setFrozen(true); // B también guarda el teléfono
    const dials0 = nA.stats.outboxDials || 0, escritas3 = nA.stats.outboxBle || 0, avisos0 = nB.notifLog.length;
    await sleep(2000);
    radio.unblock(nA, nB); // se acercan, los dos con la pantalla apagada
    r.z_nativo_abre_el_enlace_s = await waitFor(() => (nA.stats.outboxDials || 0) > dials0, 240000);
    r.z_lo_escribio_el_nativo_s = await waitFor(() => (nA.stats.outboxBle || 0) > escritas3, 60000);
    r.z_B_avisa_dormido_s = await waitFor(() => nB.notifLog.length > avisos0, 60000);
    r.z_confirmado_en_el_nativo_s = await waitFor(() => nA.outbox && nA.outbox.items.length === 0, 60000);
    r.z_los_dos_seguian_dormidos = nA.jsFrozen === true && nB.jsFrozen === true;
    nB.setFrozen(false); B.setActive(true); // B mira el teléfono
    r.z_en_el_chat_de_B_s = await waitFor(() => has(B, idA, (m) => m.content === t3 && !m._own), 60000);
    nA.setFrozen(false); A.setActive(true);
    r.z_confirmado_al_abrir_s = await waitFor(async () => ['delivered', 'read'].includes(await vaultStatus(A, idB, t3)), 90000);
    await sleep(5000);
    r.z_una_copia = (await count(B, idA, t3)) === 1;
  }
  r.retos = nA.stats.outboxChallenges || 0; r.reto_ms = nA.stats.outboxChallengeMs || []; // 3A (23-11): reto antes de entregar (medida)
  r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar/.test(l)).slice(0, 3);
  const bools = ['base_llega', 'claves_firma', 'd_queda_sin_salir', 'd_bandeja_cifrada', 'd_lo_escribio_el_nativo', 'd_A_seguia_dormida', 'd_una_copia'].concat(sinBandeja ? [] : ['c_queda_sin_salir', 'c_lo_escribio_el_nativo', 'c_una_copia', 'z_queda_sin_salir', 'z_los_dos_seguian_dormidos', 'z_una_copia']);
  const nums = ['d_sin_enlace_s', 'd_bandeja_s', 'd_llega_con_A_dormida_s', 'd_confirmado_en_el_nativo_s', 'd_confirmado_al_abrir_s'].concat(sinBandeja ? [] : ['c_sin_enlace_s', 'c_bandeja_s', 'c_llega_con_A_cerrada_s', 'c_confirmado_en_el_nativo_s', 'c_confirmado_al_abrir_s', 'z_sin_enlace_s', 'z_bandeja_s', 'z_nativo_abre_el_enlace_s', 'z_lo_escribio_el_nativo_s', 'z_B_avisa_dormido_s', 'z_confirmado_en_el_nativo_s', 'z_en_el_chat_de_B_s', 'z_confirmado_al_abrir_s']);
  r.fallan = bools.filter((k) => r[k] !== true).concat(nums.filter((k) => r[k] === null || r[k] === undefined));
  if (r.errores.length) r.fallan.push('errores');
  r.resultado = r.fallan.length ? 'FALLO' : 'OK';
  console.log('BANDEJABT ' + JSON.stringify(r));
  save();
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); save(); console.log('BANDEJABT ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
