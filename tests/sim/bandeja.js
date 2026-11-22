// 3268 (PRIORIDAD 1 del dueño, «Bluetooth entero en el servicio nativo», FASE 3; COLA 29): BANDEJA DE SALIDA nativa.
// Diagnósticos «pendiente_viejo» (20 y 21-11): un texto que se quedó ⏳ porque no había camino no salía hasta volver a ABRIR NEXO
// (reenviar era cosa de la página, que Android duerme o cierra). Ahora la app le deja al teléfono sus textos pendientes ya cifrados de
// punta a punta y el nativo los sube al buzón de los relés sin la app.
// A y B se conocen en persona y luego cada uno en su casa (solo internet, dos relés locales, uno pide identificarse).
//  1) App DORMIDA: A sin internet escribe un texto corto y uno largo (⏳), bloquea el teléfono; la página no puede mandar nada (dormida).
//     Vuelve el internet: el NATIVO los sube (netbg_mock.pumpOutbox = NetBg.pumpOutbox) → B los recibe y descifra SIN que A abra NEXO.
//     Al abrir A: ✓✓, el nativo deja de encargarse y B tiene UNA copia de cada uno.
//  2) App CERRADA: lo mismo, pero A cierra NEXO tras escribir; al volver a abrirla el mensaje ya está entregado.
//  3) Qué entra en la bandeja (función pura): textos propios visibles ⏳/enviando; no adjuntos, llamadas, ocultos, fallidos ni enormes.
// Contraprueba incluida: antes de que el nativo suba nada, B NO tiene los mensajes (la página sola no los manda).
// Uso: node bandeja.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');
const { pumpOutbox } = require('./netbg_mock');
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
const save = () => fs.writeFileSync(path.join(__dirname, 'last_logs_bandeja.txt'), logs.join('\n'));

(async () => {
  const r = { prueba: 'bandeja', build: path.basename(buildDir) };
  // 3) Qué entra (pura)
  const { outboxFits } = await importSrc('ui/ble_outbox.js');
  const M = (o) => Object.assign({ _own: true, status: 'pending', content: 'hola' }, o);
  r.entra_texto_pendiente = outboxFits(M({})) === true && outboxFits(M({ status: 'sending' })) === true;
  r.no_entra_ajeno_ni_oculto = outboxFits(M({ _own: false })) === false && outboxFits(M({ hidden: true })) === false;
  r.no_entra_fallido_ni_entregado = outboxFits(M({ status: 'failed' })) === false && outboxFits(M({ status: 'delivered' })) === false && outboxFits(M({ status: 'sent' })) === false;
  r.no_entra_adjunto = outboxFits(M({ attachmentType: 'image' })) === false && outboxFits(M({ attachmentRef: 'f1' })) === false &&
    outboxFits(M({ content: JSON.stringify({ type: 'attachment', attachmentType: 'audio', payload: 'x' }) })) === false;
  r.no_entra_llamada = outboxFits(M({ content: JSON.stringify({ type: 'nexo_call', op: 'offer', id: 'c1' }) })) === false;
  r.no_entra_enorme_ni_vacio = outboxFits(M({ content: 'x'.repeat(12001) })) === false && outboxFits(M({ content: '' })) === false && outboxFits(null) === false;

  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' })), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const paired = await addFound(A, 'B'); A.win.bleInterface.togglePanel();
  if (!paired) { r.error = 'no empareja'; r.resultado = 'FALLO'; console.log('BANDEJA ' + JSON.stringify(r)); save(); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(3000);
  await openChatWith(B, 'A'); sendText(B, 'hola A'); await sleep(3000);
  radio.block(nA, nB); // cada uno a su casa: sin Bluetooth
  A.win.bleInterface.net.tick(); B.win.bleInterface.net.tick();
  r.en_linea_por_internet = await waitFor(() => A.win.bleInterface.linkOf(idB) === 'internet' && B.win.bleInterface.linkOf(idA) === 'internet', 60000) !== null;
  const has = async (p, from, f) => (await p.win.vaultLoadMessages(from)).some(f);
  const count = async (p, from, text) => (await p.win.vaultLoadMessages(from)).filter((m) => m.content === text && !m._own).length;
  const status = (p, text) => { const el = Array.from(p.win.document.querySelectorAll('#messages-container .message.own')).find((m) => m.textContent.indexOf(text) >= 0); const s = el && el.querySelector('.msg-status'); return s ? s.className.replace('msg-status status-', '') : null; };
  const vaultStatus = async (p, to, text) => { const m = (await p.win.vaultLoadMessages(to)).find((x) => x.content === text && x._own); return m ? m.status : null; };
  sendText(A, 'antes de todo');
  r.base_llega = await waitFor(() => has(B, idA, (m) => m.content === 'antes de todo'), 30000) !== null;
  await waitFor(() => ['delivered', 'read'].includes(status(A, 'antes de todo')), 20000);
  // sin internet para la PÁGINA de A (la app no puede subir nada: como dormida); el nativo sí tendrá internet después
  const cutNet = (p) => { const net = p.win.bleInterface.net; net.relays.forEach((rl) => { try { if (rl.ws) rl.ws.close(); } catch (e) {} }); return sleep(400).then(() => { net.relays.forEach((rl) => { rl.open = false; rl.ws = null; rl.retryAt = Date.now() + 9e6; }); }); };
  const holdNet = (p) => { p.win.bleInterface.net.relays.forEach((rl) => { if (!rl.open) rl.retryAt = Date.now() + 9e6; }); };

  // ===== 1) App DORMIDA =====
  A.win.NEXO_RETRY_MS = 1500;
  await cutNet(A);
  r.d_sin_internet = await waitFor(() => !A.win.bleInterface.net.online(), 10000) !== null;
  const corto = 'BANDEJA-dormida corto', largo = 'BANDEJA-dormida largo ' + 'abcdefghij'.repeat(60);
  sendText(A, corto); await sleep(600); sendText(A, largo);
  const sinSalir = (st) => st === 'pending' || st === 'sending'; // ⏳ en espera o a medio enviar: los dos van a la bandeja
  await sleep(3000);
  r.d_estados = [await vaultStatus(A, idB, corto), await vaultStatus(A, idB, largo)];
  r.d_quedan_pendientes = sinSalir(r.d_estados[0]) && sinSalir(r.d_estados[1]);
  A.setActive(false); holdNet(A); // bloquea el teléfono
  r.d_bandeja_s = await waitFor(() => nA.outbox && nA.outbox.items.length === 2, 15000);
  const items = (nA.outbox && nA.outbox.items) || [];
  const envs = items.map((x) => { try { return JSON.parse(x.p); } catch (e) { return null; } });
  r.d_bandeja_para_B = items.length === 2 && items.every((x) => x.nx === idB) && envs.every((e) => e && e.type === 'chat' && e.from && e.msgId && e.dn === idB && e.ss === 1);
  r.d_bandeja_cifrada = items.length === 2 && items.every((x) => x.p.indexOf('BANDEJA') < 0 && x.p.indexOf('abcdefghij') < 0);
  r.d_ids_son_los_del_chat = envs.length === 2 && envs.every((e, i) => e && e.msgId === items[i].id);
  holdNet(A); await sleep(6000); holdNet(A);
  r.d_contraprueba_B_no_lo_tiene = !(await has(B, idA, (m) => m.content === corto)) && !(await has(B, idA, (m) => m.content === largo));
  // vuelve el internet del TELÉFONO: el nativo sube lo de la bandeja (la página sigue dormida)
  const p1 = await pumpOutbox(nA);
  r.d_nativo_publica = p1.publicados.length === 2 && p1.sin_rele.length === 0 && p1.sin_contacto.length === 0;
  r.d_corto_llega_s = await waitFor(() => has(B, idA, (m) => m.content === corto && !m._own), 30000);
  r.d_largo_llega_s = await waitFor(() => has(B, idA, (m) => m.content === largo && !m._own), 30000);
  r.d_A_sigue_dormida = !A.win.bleInterface.net.online();
  // A abre NEXO: ✓✓ y el nativo deja de encargarse
  A.setActive(true); A.win.bleInterface.net.tick();
  r.d_confirmados_s = await waitFor(async () => ['delivered', 'read'].includes(await vaultStatus(A, idB, corto)) && ['delivered', 'read'].includes(await vaultStatus(A, idB, largo)), 60000);
  await sleep(4000);
  r.d_nativo_suelta = (nA.outboxDrops || []).length >= 2 && items.every((x) => (nA.outboxDrops || []).includes(x.id)) && nA.outbox.items.length === 0;
  r.d_una_copia = (await count(B, idA, corto)) === 1 && (await count(B, idA, largo)) === 1;

  // ===== 2) App CERRADA =====
  await cutNet(A);
  await waitFor(() => !A.win.bleInterface.net.online(), 10000);
  const cerr = 'BANDEJA-cerrada';
  sendText(A, cerr);
  await sleep(3000);
  r.c_estado = await vaultStatus(A, idB, cerr);
  r.c_queda_pendiente = sinSalir(r.c_estado);
  A.setActive(false); holdNet(A);
  r.c_bandeja_s = await waitFor(() => nA.outbox && nA.outbox.items.length === 1, 15000);
  await sleep(1500); // lo guardado llega al disco
  A.win.close(); nA.destroyActivity(); // el usuario cierra NEXO (el proceso sigue vivo con el servicio)
  await sleep(4000);
  r.c_contraprueba_B_no_lo_tiene = !(await has(B, idA, (m) => m.content === cerr));
  const p2 = await pumpOutbox(nA);
  r.c_nativo_publica = p2.publicados.length === 1;
  r.c_llega_con_A_cerrada_s = await waitFor(() => has(B, idA, (m) => m.content === cerr && !m._own), 30000);
  // A vuelve a abrir NEXO: el mensaje ya está entregado (✓✓) y B tiene una sola copia
  nA.load(); A = await boot('A', nA);
  await openChatWith(A, 'B');
  r.c_confirmado_al_abrir_s = await waitFor(async () => ['delivered', 'read'].includes(await vaultStatus(A, idB, cerr)), 90000);
  await sleep(5000);
  r.c_una_copia = (await count(B, idA, cerr)) === 1;
  r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar/.test(l)).slice(0, 3);
  r.contenido_en_registros = logs.filter((l) => /BANDEJA-/.test(l)).length;

  const bools = ['entra_texto_pendiente', 'no_entra_ajeno_ni_oculto', 'no_entra_fallido_ni_entregado', 'no_entra_adjunto', 'no_entra_llamada', 'no_entra_enorme_ni_vacio',
    'en_linea_por_internet', 'base_llega', 'd_sin_internet', 'd_quedan_pendientes', 'd_bandeja_para_B', 'd_bandeja_cifrada', 'd_ids_son_los_del_chat', 'd_contraprueba_B_no_lo_tiene',
    'd_nativo_publica', 'd_A_sigue_dormida', 'd_nativo_suelta', 'd_una_copia', 'c_queda_pendiente', 'c_contraprueba_B_no_lo_tiene', 'c_nativo_publica', 'c_una_copia'];
  const nums = ['d_bandeja_s', 'd_corto_llega_s', 'd_largo_llega_s', 'd_confirmados_s', 'c_bandeja_s', 'c_llega_con_A_cerrada_s', 'c_confirmado_al_abrir_s'];
  r.fallan = bools.filter((k) => r[k] !== true).concat(nums.filter((k) => r[k] === null || r[k] === undefined));
  if (r.errores.length) r.fallan.push('errores'); if (r.contenido_en_registros) r.fallan.push('contenido_en_registros');
  r.resultado = r.fallan.length ? 'FALLO' : 'OK';
  console.log('BANDEJA ' + JSON.stringify(r));
  save();
  await r1.stop(); await r2.stop();
  process.exit(r.resultado === 'OK' ? 0 : 1);
})().catch((e) => { console.error('FALLO:', e.stack); save(); console.log('BANDEJA ' + JSON.stringify({ resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
