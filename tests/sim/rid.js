// ID Bluetooth rotativo (ronda 2755). Tres teléfonos: A y B son contactos, C es un desconocido cerca.
// Épocas de 20 s (en la app son 15 min) para ver varios cambios de código.
// Comprueba: tras agregarse, en el aire ya no está el NEXO ID ni el nombre de A y B (solo códigos que cambian);
// A y B se siguen reconociendo y se reconectan tras varios cambios de código; C no los ve ni los puede agregar;
// con "Agregar" abierto B vuelve a ser visible (C lo ve) y al cerrar deja de serlo; un mensaje de A a B cuando B
// vuelve, llega.
// Uso: node rid.js <build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const EPOCH_S = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, address, radio) {
  const native = new NativePhone(name, address, { readsContentFallback: true, mtu: 247, pace: [15, 15], retain: ['onPayloadReceived'] });
  radio.add(native); native.load();
  const vc = new VirtualConsole();
  ['log', 'info', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.NEXO_RID_EPOCH_S = EPOCH_S; win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function openChat(p) {
  let row = null;
  for (let i = 0; i < 300 && !row; i++) { row = p.win.document.querySelector('#main-contacts-list .ble-contact-row'); if (!row) await sleep(100); }
  click(p.win, row); await sleep(300);
}
const panelOpen = (p) => p.win.document.getElementById('ble-panel') && p.win.document.getElementById('ble-panel').classList.contains('active');
const has = (p, t) => Array.from(p.win.document.querySelectorAll('#messages-container .message:not(.own)')).some((m) => m.textContent.indexOf(t) >= 0);
const scanFor = async (p, ms) => { try { p.win.bleInterface._autoScanForKnownContacts(); } catch (e) {} await sleep(ms || 2500); };
const adsBy = (radio, name, since) => (radio.airAds || []).filter((a) => a.by === name && a.t >= since);
const found = (p) => Array.from(p.win.bleInterface.foundDevices.keys());

(async () => {
  const radio = new Radio();
  const [A, B, C] = await Promise.all([boot('A', 'AA:AA:AA:AA:AA:01', radio), boot('B', 'BB:BB:BB:BB:BB:02', radio), boot('C', 'CC:CC:CC:CC:CC:03', radio)]);
  const nxA = A.win.bleInterface.localNexoId, nxB = B.win.bleInterface.localNexoId;
  const r = {};
  // 1. A abre "Agregar" y agrega a B (B aún no tiene contactos: visible)
  A.win.bleInterface.togglePanel();
  r.A_visible_con_agregar_abierto = A.native.advertisedVisible();
  let add = null;
  for (let i = 0; i < 400 && !add; i++) {
    await sleep(100);
    add = Array.from(A.win.document.querySelectorAll('#ble-new-device > div')).find((d) => d.textContent.indexOf('B') >= 0 || true);
    add = add && add.querySelector('button');
    if (!add && !A.win.bleInterface.isScanning) click(A.win, A.win.document.getElementById('ble-scan-btn'));
  }
  // Agregar a B en concreto (C también está a la vista)
  const bKey = nxB.toLowerCase();
  if (A.win.bleInterface.foundDevices.has(bKey)) A.win.bleInterface._addNewDevice(bKey); else click(A.win, add);
  await sleep(1500);
  if (panelOpen(A)) A.win.bleInterface.togglePanel();
  await openChat(A);
  await sendText(A, 'hola B'); await sleep(3000);
  await openChat(B);
  r.llega_primer_mensaje = has(B, 'hola B');
  r.A_contactos = A.win.bleInterface.getBLEContacts().map((c) => c.nexoId);
  r.B_contactos = B.win.bleInterface.getBLEContacts().map((c) => c.nexoId);
  // 2. Con contactos y sin "Agregar" abierto: en el aire, códigos (ni NEXO ID ni nombre)
  for (let i = 0; i < 40 && (A.native.advertisedVisible() || B.native.advertisedVisible()); i++) await sleep(1000);
  const t0 = Date.now();
  for (let k = 0; k < 3; k++) { await scanFor(C, 2000); await sleep(EPOCH_S * 1000 / 2); }
  const adsA = adsBy(radio, 'A', t0), adsB = adsBy(radio, 'B', t0);
  r.A_anuncia_codigos = adsA.length > 0 && adsA.every((a) => /^R[a-z2-7]{9}$/.test(a.adv));
  r.B_anuncia_codigos = adsB.length > 0 && adsB.every((a) => /^R[a-z2-7]{9}$/.test(a.adv));
  r.codigos_distintos_B = new Set(adsB.map((a) => a.adv)).size;
  r.nexo_id_en_el_aire = (radio.airAds || []).filter((a) => a.t >= t0 && (a.adv === nxA || a.adv === nxB)).length;
  // 3. C (desconocido) no los ve: ni en su lista de nuevos ni por NEXO ID
  r.C_ve_a_A_o_B = found(C).filter((k) => k === nxA.toLowerCase() || k === nxB.toLowerCase());
  // 4. B se aleja varias épocas; A le escribe; al volver B (con otro código) se reconectan y llega
  B.native.setOffline(true);
  await sleep(1500);
  await sendText(A, 'mientras estabas lejos');
  await sleep(EPOCH_S * 1000 * 2 + 3000);
  const tokAntes = (adsB[adsB.length - 1] || {}).adv;
  B.native.setOffline(false);
  let back = false; const tb = Date.now();
  for (let i = 0; i < 90 && !back; i++) { if (i % 6 === 0) await scanFor(A, 500); await sleep(1000); back = has(B, 'mientras estabas lejos'); }
  r.llega_tras_cambiar_codigo = back;
  r.segundos_hasta_llegar = Math.round((Date.now() - tb) / 1000);
  const tokDespues = (adsBy(radio, 'B', tb).pop() || {}).adv;
  r.codigo_de_B_cambio = !!(tokAntes && tokDespues && tokAntes !== tokDespues);
  // 5. B abre "Agregar": visible (C lo ve con su NEXO ID); al cerrar vuelve al código
  B.win.bleInterface.togglePanel();
  await sleep(500);
  await scanFor(C, 2500);
  r.con_agregar_abierto_C_ve_a_B = found(C).includes(nxB.toLowerCase());
  B.win.bleInterface.togglePanel();
  await sleep(1000);
  r.al_cerrar_B_vuelve_al_codigo = !B.native.advertisedVisible();
  const errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  r.errores = errores;
  const ok = r.A_visible_con_agregar_abierto && r.llega_primer_mensaje && r.A_anuncia_codigos && r.B_anuncia_codigos && r.codigos_distintos_B >= 2 &&
    r.nexo_id_en_el_aire === 0 && r.C_ve_a_A_o_B.length === 0 && r.llega_tras_cambiar_codigo && r.codigo_de_B_cambio &&
    r.con_agregar_abierto_C_ve_a_B && r.al_cerrar_B_vuelve_al_codigo;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('RID ' + JSON.stringify(r));
  if (!ok) fs.writeFileSync(path.join(__dirname, 'last_logs_rid.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_rid.txt'), logs.join('\n')); process.exit(1); });
