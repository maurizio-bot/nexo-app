// 3276 (PRIORIDAD 1 del dueño, FASE 4: conexiones a demanda con tope; estudio de multitud del 17-11, docs/EDC_LIMITES.md): GESTOR DE ENLACES.
// Android aguanta ~7 enlaces Bluetooth. Antes NEXO conectaba con todo contacto cercano sin tope ni orden: con 10 contactos dormidos
// alrededor, el que SÍ tenía un mensaje esperando no conectaba nunca. Ahora (decisión del dueño 22-11: con pocos cerca, como siempre):
//  1) linkPlan / linkTrim (puras): tope 6, hasta 4 contactos «por estar cerca», hueco reservado para quien tiene pendientes o el chat
//     abierto y otro para una conexión de paso; quien tiene pendientes desaloja al menos importante que no esté ocupado; los contactos
//     callados de sobra sueltan su enlace a los 2 min; nunca se cierra uno ocupado ni uno recién abierto.
//  2) La app de verdad (bleInterface real): con pocos enlaces conecta como siempre; con los enlaces llenos, un contacto más NO conecta,
//     uno con mensajes esperando SÍ (y se cierra el más callado), una conexión de paso no entra mientras alguien espera, y el repaso
//     suelta lo que sobra; con «Agregar» abierto las conexiones de paso las reparte el relevo (3277).
// Uso: node enlacestope.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { importSrc } = require('./srcmod');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
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
const save = () => fs.writeFileSync(path.join(__dirname, 'last_logs_enlacestope.txt'), logs.join('\n'));

(async () => {
  const r = { prueba: 'enlacestope', build: path.basename(buildDir) };
  const { linkPlan, linkTrim, LINK_CAP, LINK_CONTACT_MAX, LINK_IDLE_MS } = await importSrc('ui/ble_linkmgr.js');
  const now = 10000000;
  const L = (key, o) => Object.assign({ key, contact: true, pending: false, chat: false, busy: false, fresh: false, lastAt: now - 5000 }, o || {});
  const o = { now };
  const pocos = [L('a'), L('b')];
  r.P_pocos_como_siempre = linkPlan(pocos, { contact: true }, o).allow === true && linkPlan(pocos, {}, o).allow === true && linkPlan(pocos, { contact: true, pending: true }, o).close.length === 0;
  const cuatro = [L('a'), L('b'), L('c'), L('d')];
  r.P_quinto_contacto_a_demanda = linkPlan(cuatro, { contact: true }, o).allow === false;
  r.P_quinto_con_pendientes_entra = (() => { const p = linkPlan(cuatro, { contact: true, pending: true }, o); return p.allow && p.close.length === 0; })();
  r.P_quinto_con_chat_abierto_entra = linkPlan(cuatro, { contact: true, chat: true }, o).allow === true;
  r.P_de_paso_con_dos_huecos = linkPlan(cuatro, {}, o).allow === true && linkPlan(cuatro.concat([L('e', { pending: true })]), {}, o).allow === false;
  r.P_de_paso_no_si_alguien_espera = linkPlan(pocos, {}, { now, waiting: true }).allow === false;
  const lleno = [L('a', { lastAt: now - 300000 }), L('b', { lastAt: now - 9000 }), L('c', { busy: true, lastAt: now - 900000 }), L('d', { chat: true, lastAt: now - 800000 }), L('e', { pending: true }), L('paso', { contact: false, lastAt: now - 1000 })];
  const pl1 = linkPlan(lleno, { contact: true, pending: true }, o);
  r.P_lleno_pendientes_desaloja_el_de_paso = pl1.allow === true && pl1.close.join() === 'paso';
  const lleno2 = lleno.filter((l) => l.key !== 'paso').concat([L('f', { lastAt: now - 60000 })]);
  const pl2 = linkPlan(lleno2, { contact: true, pending: true }, o);
  r.P_luego_el_contacto_mas_callado = pl2.allow === true && pl2.close.join() === 'a';
  const pl3 = linkPlan(lleno2, { contact: true, chat: true }, o);
  r.P_chat_abierto_tambien_desaloja = pl3.allow === true && pl3.close.join() === 'a';
  r.P_nunca_ocupado_ni_chat_ni_pendiente = !pl2.close.includes('c') && !pl2.close.includes('d') && !pl2.close.includes('e');
  const todosOcupados = [1, 2, 3, 4, 5, 6].map((i) => L('x' + i, { busy: true }));
  r.P_todos_ocupados_no_entra = linkPlan(todosOcupados, { contact: true, pending: true }, o).allow === false;
  r.P_recien_abierto_no_se_toca = linkPlan([1, 2, 3, 4, 5, 6].map((i) => L('y' + i, { fresh: true })), { contact: true, pending: true }, o).allow === false;
  r.P_agregar_a_mano_entra = linkPlan(lleno2, { manual: true }, o).allow === true;
  // repaso
  r.T_pocos_nada = linkTrim(cuatro, o).length === 0;
  const cinco = [L('a', { lastAt: now - LINK_IDLE_MS - 1 }), L('b'), L('c'), L('d'), L('e', { lastAt: now - LINK_IDLE_MS - 9000 })];
  r.T_sobra_un_contacto_callado = linkTrim(cinco, o).join() === 'e';
  r.T_sobra_pero_todos_recientes = linkTrim([L('a'), L('b'), L('c'), L('d'), L('e')], o).length === 0;
  const siete = lleno.concat([L('g', { lastAt: now - 50000 })]);
  const t7 = linkTrim(siete, o);
  r.T_por_encima_del_tope_el_menos_importante = t7[0] === 'paso' && !t7.includes('c') && !t7.includes('d') && !t7.includes('e');
  r.P_siempre_a_demanda_con_un_numero = linkPlan([L('a')], { contact: true }, { now, contacts: 1 }).allow === false && linkPlan([L('a')], { contact: true, pending: true }, { now, contacts: 1 }).allow === true;
  r.P_constantes = LINK_CAP === 6 && LINK_CONTACT_MAX === 4 && LINK_IDLE_MS === 120000;

  // ===== 2) la app de verdad =====
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base));
  radio.add(nA); nA.load();
  const A = await boot('A', nA);
  const bi = A.win.bleInterface, pl = bi.nativePlugin;
  const NX = (i) => 'nxcccccc' + String(i).padStart(2, '0'), MAC = (i) => 'c0ffee0000' + String(i).padStart(2, '0');
  const contacts = []; for (let i = 1; i <= 9; i++) contacts.push({ nexoId: NX(i), deviceUUID: NX(i), name: 'C' + i, publicKey: 'pk' + i });
  const getC = bi.getBLEContacts.bind(bi);
  bi.getBLEContacts = () => getC().concat(contacts);
  const calls = [];
  pl.connectToDevice = (a) => { calls.push('conecta ' + a.deviceId); return Promise.resolve({ connected: false, error: 'prueba' }); };
  pl.disconnectDevice = (a) => { calls.push('cierra ' + a.deviceId + (a.server ? ' (servidor)' : '')); return Promise.resolve({}); };
  bi._linkLostAt = bi._linkLostAt || new A.win.Map();
  const cerca = (i) => bi._linkLostAt.set(NX(i), Date.now());
  const enlace = (i, calladoMs, role) => {
    bi._macToNexoId.set(MAC(i), NX(i)); bi._nexoIdToMac.set(NX(i), MAC(i));
    bi._setDeviceState(MAC(i), 'ready_to_chat', { role: role || 'client' });
    const st = bi._getDeviceState(MAC(i)); st.openedAt = Date.now() - 600000;
    bi._lastPongTime.set(MAC(i), Date.now() - calladoMs);
  };
  const conecta = async (i, opts) => { const n0 = calls.length; cerca(i); bi._macToNexoId.set(MAC(i), NX(i)); await bi._autoConnectGATT(MAC(i), { name: 'C' + i, deviceUUID: NX(i) }, opts || {}); await sleep(50); const got = calls.slice(n0); bi._setDeviceState(MAC(i), 'disconnected'); return got; };
  // con pocos enlaces: como siempre
  enlace(1, 5000); enlace(2, 5000);
  r.A_pocos_conecta_como_siempre = (await conecta(3)).join() === 'conecta ' + MAC(3);
  // cuatro contactos enlazados: el quinto, sin nada pendiente, NO conecta (a demanda)
  enlace(3, 200000); enlace(4, 400000, 'server');
  r.A_enlaces = bi._linkList().length;
  r.A_quinto_no_conecta = (await conecta(5)).length === 0;
  r.A_lo_dice_el_registro = logs.some((l) => /Tope de enlaces \(4\/6\).*a demanda/.test(l));
  // con mensajes esperando SÍ conecta (usa el hueco reservado, sin cerrar a nadie)
  bi._outboxNx = bi._outboxNx || new A.win.Set(); bi._outboxNx.add(NX(5));
  r.A_quinto_con_pendientes_conecta = (await conecta(5)).join() === 'conecta ' + MAC(5);
  // enlaces LLENOS (6): uno con pendientes desaloja al más callado (el 4, de servidor) y conecta
  enlace(5, 3000); enlace(6, 3000);
  bi._outboxNx.delete(NX(5)); bi._outboxNx.add(NX(7));
  const c7 = await conecta(7, { why: 'pendientes' });
  r.A_lleno_desaloja_al_mas_callado = c7.join() === 'cierra ' + MAC(4) + ' (servidor),conecta ' + MAC(7);
  r.A_registro_del_desalojo = logs.some((l) => l.indexOf('se suelta ' + NX(4)) >= 0 && /mensajes esperando/.test(l));
  // una conexión de paso no entra con los enlaces llenos
  r.A_de_paso_no_entra = bi._linkRoom({ hop: true }) === false;
  // 3277: con «Agregar» abierto, las conexiones de paso las reparte el relevo (su tope y su rotación): el gestor no las frena ni el
  // repaso suelta nada (addlento.js: con nueve NEXO cerca, el sexto no salía nunca en la lista)
  bi._visibleUntil = Date.now() + 60000;
  const nAg = calls.length;
  r.A_agregar_abierto_de_paso_entra = bi._linkRoom({ hop: true }) === true;
  r.A_agregar_abierto_sin_repaso = bi._linkTrimTick() === 0 && calls.length === nAg;
  bi._visibleUntil = 0;
  r.A_agregar_cerrado_vuelve_el_tope = bi._linkRoom({ hop: true }) === false;
  // el repaso: sobran contactos callados (6 enlazados, tope de 4 «por estar cerca»): suelta a los que llevan > 2 min callados
  const n1 = calls.length; bi._outboxNx.clear();
  const sueltos = bi._linkTrimTick();
  r.A_repaso_suelta_callados = sueltos === 2 && calls.slice(n1).join() === 'cierra ' + MAC(4) + ' (servidor),cierra ' + MAC(3);
  // un enlace con el chat abierto nunca se suelta
  bi._activeChatDeviceId = NX(3);
  const n2 = calls.length; bi._linkTrimTick();
  r.A_chat_abierto_no_se_suelta = !calls.slice(n2).some((c) => c.indexOf(MAC(3)) >= 0);
  r.errores = logs.filter((l) => /TypeError|ReferenceError/.test(l)).slice(0, 3);

  const skip = { prueba: 1, build: 1, A_enlaces: 1, errores: 1 };
  r.fallan = Object.keys(r).filter((k) => !skip[k] && r[k] !== true);
  if (r.errores.length) r.fallan.push('errores');
  r.resultado = r.fallan.length ? 'FALLO' : 'OK';
  console.log('ENLACESTOPE ' + JSON.stringify(r));
  save();
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); save(); console.log('ENLACESTOPE ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
