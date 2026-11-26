// INVITACIÓN A GRUPO (dueño 24-11: «al agregar a alguien a un grupo se le manda solicitud y debe tener opción de aceptar o rechazar»).
// A y B por Bluetooth:
//  I1  A crea un grupo con B → a B le llega como invitación: no está en su lista, sale en «Solicitudes para ti» («A te agregó al
//      grupo», Aceptar / Rechazar), el aviso de la lista la cuenta y la parte nativa lo tiene callado;
//  I2  mientras no acepta, lo que se escribe en el grupo se le guarda pero no avisa (ni la app ni el nativo);
//  I3  Aceptar → sale en su lista con lo que llegó, el nativo ya avisa y A ve «Se unió al grupo»;
//  I4  otro grupo: Rechazar → B sale, A ve «No aceptó la invitación», B deja de estar en el grupo de A y no recibe lo siguiente;
//  I5  una invitación sin contestar sigue tras reiniciar B (y el nativo la sigue callando).
// Contraprueba: la build de antes mete a B en el grupo directamente (I1 falla).
// Imprime GRUPOINVITA {json} y escribe last_logs_grupoinvita.txt. Uso: node grupoinvita.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true, noTor: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
const vis = {};
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.HTMLElement.prototype.scrollIntoView = function () {};
      Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => vis[name] || 'visible' });
      Object.defineProperty(win.document, 'hidden', { configurable: true, get: () => (vis[name] || 'visible') === 'hidden' });
      win.navigator.mediaDevices = { getUserMedia: () => Promise.reject(new Error('sin micrófono en el simulador')) };
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const $ = (p, sel) => p.win.document.querySelector(sel);
async function openChat(p, cid) { try { await p.win.bleInterface.openChat(cid); } catch (e) {} await sleep(600); }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function typeSend(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
async function msgsOf(p, cid) { try { return (await p.win.vaultLoadMessages(cid)) || []; } catch (e) { return []; } }
const has = async (p, cid, txt) => (await msgsOf(p, cid)).some((m) => !m.hidden && String(m.content).indexOf(txt) >= 0);
const statusOf = async (p, cid, txt) => { const m = (await msgsOf(p, cid)).find((x) => String(x.content).indexOf(txt) >= 0); return m ? m.status : null; };
const delivered = (st) => st === 'delivered' || st === 'read';
const msgNotifs = (n, chat, n0) => n.notifLog.slice(n0).filter((x) => x.chatId === chat && !x.call && !x.callEnd && !x.update);
const out = (r, code) => { console.log('GRUPOINVITA ' + JSON.stringify(r)); fs.writeFileSync(path.join(__dirname, 'last_logs_grupoinvita.txt'), logs.join('\n')); process.exit(code); };


async function newGroup(A, name) {
  A.win.NEXO_newGroupWith(); await sleep(400);
  const sheet = A.win.document.getElementById('nexo-group-sheet');
  sheet.querySelectorAll('.nexo-pick-row input').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); });
  const gnm = sheet.querySelector('#nexo-group-name'); gnm.value = name; gnm.dispatchEvent(new A.win.Event('input'));
  const before = Object.keys(A.win.bleInterface.groups.list);
  click(A.win, sheet.querySelector('#nexo-group-create')); await sleep(800);
  return Object.keys(A.win.bleInterface.groups.list).find((k) => before.indexOf(k) < 0);
}
const inList = (p, gid) => p.win.bleInterface.groups.all().some((g) => g.id === gid);
const rowsInv = (p) => { p.win.bleInterface.renderRequests(); return Array.from(p.win.document.querySelectorAll('#ble-requests-list .ble-group-invite')); };
async function sendGroup(A, gid, txt) { if (A.win.NEXO_openGroupChat) A.win.NEXO_openGroupChat(gid); await sleep(600); typeSend(A, txt); await sleep(300); await closeChat(A); }
const grpHas = async (p, gid, re) => (await msgsOf(p, gid)).some((m) => re.test(String(m.content)));

(async () => {
  const r = { prueba: 'grupoinvita', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA); let B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const okB = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!okB) out(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }), 1);
  await openChat(A, idB); typeSend(A, 'hola B'); await sleep(1500);
  r.emparejados_s = await waitFor(() => has(B, idA, 'hola B'), 30000);
  await closeChat(A);

  // ---------- I1: A crea un grupo con B → a B le llega como INVITACIÓN (no entra solo) ----------
  const g1 = await newGroup(A, 'Invitados');
  r.I1_llega_s = await waitFor(() => !!B.win.bleInterface.groups.get(g1), 60000);
  r.I1_invitado = !!(B.win.bleInterface.groups.isInvited && B.win.bleInterface.groups.isInvited(g1));
  r.I1_no_en_lista = !inList(B, g1);
  const row = rowsInv(B).find((x) => /Invitados/.test(x.textContent));
  r.I1_fila = row ? row.textContent.replace(/\s+/g, ' ').trim() : null;
  B.win.bleInterface.renderContactsList(); await sleep(400);
  r.I1_banner = ((B.win.document.getElementById('ble-req-banner') || {}).textContent || '').trim();
  r.I1_nativo_callado = !!(nB.muted && nB.muted.get(g1) === 0);
  r.I1_ok = r.I1_llega_s !== null && r.I1_invitado && r.I1_no_en_lista && /te agregó al grupo/.test(r.I1_fila || '') && /Aceptar/.test(r.I1_fila || '') && /Rechazar/.test(r.I1_fila || '') && /solicitud/.test(r.I1_banner) && r.I1_nativo_callado;

  // ---------- I2: mientras no acepta, lo del grupo se guarda pero NO avisa ----------
  vis.B = 'hidden'; nB.setAppActive(false); B.win.document.dispatchEvent(new B.win.Event('visibilitychange')); await sleep(400);
  const n2 = nB.notifLog.length;
  await sendGroup(A, g1, '[I2] antes de aceptar');
  r.I2_guardado_s = await waitFor(() => grpHas(B, g1, /\[I2\]/), 40000);
  await sleep(6000);
  r.I2_avisos = nB.notifLog.slice(n2).filter((x) => x.chatId === g1 || /I2/.test(String(x.text || ''))).length;
  vis.B = 'visible'; nB.setAppActive(true); B.win.document.dispatchEvent(new B.win.Event('visibilitychange')); await sleep(400);
  r.I2_ok = r.I2_guardado_s !== null && r.I2_avisos === 0;

  // ---------- I3: Aceptar → sale en la lista (con lo que llegó) y el grupo ve «Se unió al grupo» ----------
  const acc = rowsInv(B).find((x) => /Invitados/.test(x.textContent));
  click(B.win, acc && acc.querySelector('.grp-inv-accept')); await sleep(500);
  r.I3_en_lista = inList(B, g1) && !B.win.bleInterface.groups.isInvited(g1);
  r.I3_fila_quitada = !rowsInv(B).some((x) => /Invitados/.test(x.textContent));
  r.I3_nativo_ya_avisa = !(nB.muted && nB.muted.has(g1));
  r.I3_A_ve_se_unio_s = await waitFor(() => grpHas(A, g1, /Se unió al grupo/), 40000);
  r.I3_ok = r.I3_en_lista && r.I3_fila_quitada && r.I3_nativo_ya_avisa && r.I3_A_ve_se_unio_s !== null && await grpHas(B, g1, /\[I2\]/);

  // ---------- I4: otro grupo: Rechazar → B sale, el grupo ve «No aceptó la invitación» y B ya no recibe ----------
  const g2 = await newGroup(A, 'Rechazado');
  r.I4_llega_s = await waitFor(() => !!B.win.bleInterface.groups.get(g2), 60000);
  const rej = rowsInv(B).find((x) => /Rechazado/.test(x.textContent));
  click(B.win, rej && rej.querySelector('.grp-inv-reject')); await sleep(500);
  r.I4_fuera = !inList(B, g2) && !B.win.bleInterface.groups.isInvited(g2) && !rowsInv(B).some((x) => /Rechazado/.test(x.textContent));
  r.I4_A_ve_rechazo_s = await waitFor(() => grpHas(A, g2, /No aceptó la invitación/), 40000);
  await sleep(1500);
  r.I4_A_sin_B = (A.win.bleInterface.groups.get(g2).members || []).indexOf(idB) < 0;
  await sendGroup(A, g2, '[I4] tras rechazar');
  await sleep(6000);
  r.I4_B_no_recibe = !(await grpHas(B, g2, /\[I4\]/));
  r.I4_ok = r.I4_llega_s !== null && r.I4_fuera && r.I4_A_ve_rechazo_s !== null && r.I4_A_sin_B && r.I4_B_no_recibe;

  // ---------- I5: la invitación sigue tras reiniciar B ----------
  const g3 = await newGroup(A, 'Tras reiniciar');
  await waitFor(() => !!B.win.bleInterface.groups.get(g3), 60000);
  B.win.close(); nB.destroyActivity(); await sleep(1500);
  vis.B = 'visible'; nB.setAppActive(true); nB.load(); B = await boot('B', nB);
  await sleep(1500);
  r.I5_sigue_invitado = !!(B.win.bleInterface.groups.isInvited(g3)) && !inList(B, g3) && rowsInv(B).some((x) => /Tras reiniciar/.test(x.textContent));
  r.I5_nativo_callado = !!(nB.muted && nB.muted.get(g3) === 0);
  r.I5_ok = r.I5_sigue_invitado && r.I5_nativo_callado;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|micrófono|getUserMedia/.test(l)).slice(0, 5);
  const ok = r.I1_ok && r.I2_ok && r.I3_ok && r.I4_ok && r.I5_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  out(r, ok ? 0 : 1);
})().catch((e) => { console.error(e && e.stack); out({ prueba: 'grupoinvita', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") }, 1); });
