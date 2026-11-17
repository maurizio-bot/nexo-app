// 3207 (dueño 17-11: «quiero que implementes el mismo protocolo de aceptar un contacto como en dispositivos lejanos a dispositivos
// cercanos»). Antes, el «+» de un teléfono cercano lo agregaba al momento y el otro lo agregaba solo con el primer mensaje. Ahora el
// «+» manda una SOLICITUD por Bluetooth y el otro la acepta o la elimina en «Solicitudes para ti»; al aceptar, quien la mandó queda
// agregado solo si la respuesta trae la misma llave que ese teléfono le dijo de cerca (decisión del dueño: «Quedan agregados»).
// A, B, C y D solo por Bluetooth (sin internet), SIN la aceptación automática del simulador:
//  N1  A toca «+» en B: aviso «Solicitud enviada»; A NO tiene a B todavía; a B le llega la solicitud (bandeja, cartel en la lista y
//      aviso «quiere agregarte») y B NO tiene a A;
//  N2  B toca «Aceptar»: B tiene a A; A tiene a B (sin confirmar nada, con su llave) y el aviso «aceptó tu solicitud»; se escriben en
//      los dos sentidos (cifrado listo);
//  N3  C toca «+» en B y B toca «Eliminar»: ninguno tiene al otro; la bandeja de B queda vacía;
//  N4  C y D se tocan «+» a la vez: quedan agregados los dos sin aceptar a mano;
//  N5  una respuesta con OTRA llave a una solicitud de A pendiente: por Bluetooth se descarta y por internet va a la bandeja para
//      confirmar (no se agrega sola); la respuesta buena después sí agrega;
//  N6  a quien ya me tiene (me borró y me vuelve a pedir) se le contesta solo y queda agregado;
//  N7  textos nuevos en los 5 idiomas.
// Imprime SOLICITUDCERCA {json} y escribe last_logs_solicitudcerca.txt. Contraprueba b3206: el «+» agrega al momento (FALLO).
// Uso: node solicitudcerca.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifi: null, nearAutoAccept: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DL extends ResourceLoader { constructor(d) { super(); this.d = d; } fetch(u) { const f = path.join(this.d, decodeURIComponent(new URL(u).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('x')); } }
const logs = [];
const T0 = Date.now();
const ts = () => String(((Date.now() - T0) / 1000).toFixed(1)).padStart(6) + 's';
async function boot(name, native) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${ts()} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously', resources: new DL(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = []; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; win.HTMLElement.prototype.scrollIntoView = function () {};
      // los avisos (toasts) que salen, para comprobarlos
      win.__toasts = [];
      const MO = win.MutationObserver;
      win.addEventListener('DOMContentLoaded', () => { try { new MO((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.textContent && n.textContent.length < 300) win.__toasts.push(n.textContent); }))).observe(win.document.body, { childList: true }); } catch (e) {} });
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
const $ = (p, sel) => p.win.document.querySelector(sel);
async function openChat(p, cid) { try { await p.win.bleInterface.openChat(cid); } catch (e) {} await sleep(600); }
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function typeSend(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function tapPlus(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  const wasOpen = p.win.document.getElementById('ble-panel') && p.win.bleInterface._panelOpen;
  p.win.bleInterface.togglePanel();
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(300);
  void wasOpen;
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
const nxOf = (p) => p.win.bleInterface.localNexoId.toLowerCase();
const has = (p, q) => (p.win.vaultLoadContacts ? (p.win.vaultLoadContacts() || []) : []).some((c) => String(c.nexoId || c.deviceUUID || '').toLowerCase() === nxOf(q));
const isContact = (p, q) => { try { return p.win.bleInterface._isKnownSender(nxOf(q)); } catch (e) { return has(p, q); } };
const inbox = (p) => { try { return p.win.bleInterface.pendingRequests() || []; } catch (e) { return []; } };
const outbox = (p) => { try { return JSON.parse(p.win.localStorage.getItem('nexo_req_out') || '[]'); } catch (e) { return []; } };
const toasted = (p, re) => (p.win.__toasts || []).some((x) => re.test(x));
async function msgsOf(p, cid) { try { return (await p.win.vaultLoadMessages(cid)) || []; } catch (e) { return []; } }
const plain = (c) => { try { const o = JSON.parse(c); if (o && o.type === 'nexo_txt') return o.t; } catch (e) {} return String(c || ''); };
const got = (p, from, t) => async () => (await msgsOf(p, nxOf(from))).some((m) => !m._own && plain(m.content) === t);
async function reqButton(p, fromName, which) {
  p.win.bleInterface.renderRequests();
  const rows = Array.from(p.win.document.querySelectorAll('#ble-requests-list > div'));
  const row = rows.find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === fromName);
  if (!row) return null;
  const bs = row.querySelectorAll('button');
  return which === 'ok' ? bs[0] : bs[1];
}

(async () => {
  const r = { prueba: 'solicitudcerca', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', base), nD = new NativePhone('D', 'DD:DD:DD:DD:DD:04', base);
  [nA, nB, nC, nD].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB), C = await boot('C', nC), D = await boot('D', nD);
  const fin = (ok) => { r.resultado = ok ? 'OK' : 'FALLO'; console.log('SOLICITUDCERCA ' + JSON.stringify(r)); fs.writeFileSync(path.join(__dirname, 'last_logs_solicitudcerca.txt'), logs.join('\n')); process.exit(ok ? 0 : 1); };

  // ---- N1 ----
  r.N1_mas = await tapPlus(A, 'B');
  await sleep(500);
  r.N1_aviso_enviada = toasted(A, /Solicitud enviada a B/);
  r.N1_A_aun_no_tiene_a_B = !isContact(A, B);
  r.N1_B_recibe_s = await waitFor(() => inbox(B).some((x) => x.id === nxOf(A)), 15000);
  r.N1_B_bandeja_cerca = !!inbox(B).find((x) => x.id === nxOf(A) && x.near === 1 && x.name === 'A');
  r.N1_B_no_tiene_a_A = !isContact(B, A);
  r.N1_B_aviso = toasted(B, /A quiere agregarte/);
  B.win.bleInterface.renderContactsList();
  r.N1_B_cartel = !!$(B, '#ble-req-banner');
  await sleep(4000); // los reintentos de la solicitud no agregan nada ni duplican
  r.N1_una_sola_en_bandeja = inbox(B).filter((x) => x.id === nxOf(A)).length === 1 && !isContact(A, B) && !isContact(B, A);

  // ---- N2 ----
  click(B.win, await reqButton(B, 'A', 'ok'));
  r.N2_B_tiene_a_A_s = await waitFor(() => isContact(B, A), 5000);
  r.N2_A_tiene_a_B_s = await waitFor(() => isContact(A, B), 15000);
  r.N2_A_sin_confirmar = !inbox(A).some((x) => x.id === nxOf(B)) && !outbox(A).some((x) => x.id === nxOf(B));
  r.N2_A_aviso = toasted(A, /B aceptó tu solicitud/);
  r.N2_B_bandeja_vacia = inbox(B).length === 0;
  await sleep(1500);
  await openChat(A, nxOf(B)); typeSend(A, 'hola B, ya somos contactos'); await closeChat(A);
  r.N2_A_a_B_s = await waitFor(got(B, A, 'hola B, ya somos contactos'), 20000);
  await openChat(B, nxOf(A)); typeSend(B, 'hola A'); await closeChat(B);
  r.N2_B_a_A_s = await waitFor(got(A, B, 'hola A'), 20000);

  // ---- N3: C pide a B y B elimina ----
  await tapPlus(C, 'B');
  r.N3_B_recibe_s = await waitFor(() => inbox(B).some((x) => x.id === nxOf(C)), 15000);
  click(B.win, await reqButton(B, 'C', 'no'));
  await sleep(4000);
  r.N3_ninguno = !isContact(B, C) && !isContact(C, B) && !inbox(B).some((x) => x.id === nxOf(C));

  // ---- N4: C y D se piden a la vez ----
  await Promise.all([tapPlus(C, 'D'), tapPlus(D, 'C')]);
  r.N4_mutuo_s = await waitFor(() => isContact(C, D) && isContact(D, C), 15000);
  r.N4_sin_bandeja = !inbox(C).some((x) => x.id === nxOf(D)) && !inbox(D).some((x) => x.id === nxOf(C));

  // ---- N5: respuesta con otra llave a una solicitud pendiente de A (A pide a D; D no contesta todavía) ----
  await tapPlus(A, 'D');
  await waitFor(() => inbox(D).some((x) => x.id === nxOf(A)), 15000);
  const devD = ((A.win.bleInterface._kxPeers || new Map()).get(nxOf(D)) || {}).deviceId || 'DD:DD:DD:DD:DD:04';
  const fakePk = String(((A.win.bleInterface._kxPeers || new Map()).get(nxOf(D)) || {}).pk || 'x').split('').reverse().join('');
  if (A.win.bleInterface._onNearReq) A.win.bleInterface._onNearReq(devD, { v: 1, type: 'nq', k: 'acc', from: nxOf(D), pk: fakePk, nm: 'D' });
  await sleep(300);
  r.N5_bt_otra_llave_descartada = !isContact(A, D) && !inbox(A).some((x) => x.id === nxOf(D));
  A.win.bleInterface._onNetRequest({ id: nxOf(D), pk: fakePk, name: 'D', kind: 'acc' });
  await sleep(300);
  r.N5_internet_otra_llave_a_confirmar = !isContact(A, D) && !!inbox(A).find((x) => x.id === nxOf(D) && x.acc === true);
  // la buena: D acepta de verdad
  A.win.bleInterface.rejectRequest(nxOf(D)); // (la falsa fuera)
  click(D.win, await reqButton(D, 'A', 'ok'));
  r.N5_buena_agrega_s = await waitFor(() => isContact(A, D) && isContact(D, A), 15000);

  // ---- N6: B me borra y me vuelve a pedir: A (que ya lo tiene) contesta solo ----
  try { B.win.bleInterface.removeContact(A.win.bleInterface.localNexoId); } catch (e) {}
  await sleep(500);
  r.N6_B_borro = !isContact(B, A);
  await tapPlus(B, 'A');
  r.N6_vuelve_s = await waitFor(() => isContact(B, A), 15000);
  r.N6_A_sin_bandeja = !inbox(A).some((x) => x.id === nxOf(B));

  // ---- N7 ----
  const srcDir = path.join(__dirname, '..', '..', 'src', 'ui', 'i18n');
  r.N7_idiomas = ['es', 'it', 'en', 'pt', 'fr'].every((l) => { const s = fs.readFileSync(path.join(srcDir, l + '.js'), 'utf8'); return ['near_req_sent', 'near_req_accepted'].every((k) => new RegExp('\\n  ' + k + ': "').test(s)); });

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.N1_mas && r.N1_aviso_enviada && r.N1_A_aun_no_tiene_a_B && r.N1_B_recibe_s !== null && r.N1_B_bandeja_cerca && r.N1_B_no_tiene_a_A && r.N1_B_aviso && r.N1_B_cartel && r.N1_una_sola_en_bandeja &&
    r.N2_B_tiene_a_A_s !== null && r.N2_A_tiene_a_B_s !== null && r.N2_A_sin_confirmar && r.N2_A_aviso && r.N2_B_bandeja_vacia && r.N2_A_a_B_s !== null && r.N2_B_a_A_s !== null &&
    r.N3_B_recibe_s !== null && r.N3_ninguno && r.N4_mutuo_s !== null && r.N4_sin_bandeja &&
    r.N5_bt_otra_llave_descartada && r.N5_internet_otra_llave_a_confirmar && r.N5_buena_agrega_s !== null &&
    r.N6_B_borro && r.N6_vuelve_s !== null && r.N6_A_sin_bandeja && r.N7_idiomas && !r.errores.length;
  fin(ok);
})().catch((e) => { console.log('SOLICITUDCERCA ' + JSON.stringify({ prueba: 'solicitudcerca', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_solicitudcerca.txt'), logs.join('\n')); process.exit(1); });
