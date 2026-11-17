// 3173 (dueño 17-11, diagnóstico S24 19:52–19:57: «algunos mensajes se tardaban en salir»): el S24 (más de 20 chats) mandó a
// la Vivo y a la tablet, con la app dormida, la pregunta oculta de la foto de perfil (avq, 4 s tras conectar); su nativo la
// confirmó (✓✓, «Texto entregado en 4207 ms») y aun así la vuelta de reenvío decía «Reenviando 1 pending para nx09acdb61» cada
// ~18 s durante 4 min sin mandar nada, y al reiniciar la app la MISMA se mandó otra vez. Causa: la caché de historiales es un
// LRU de 20 chats; la copia oculta se borra al entregarse y los «enviado» que llegan después la buscan en TODOS los chats, lo
// que vaciaba la caché antes de los 300 ms del guardado agrupado: el borrado (o el ✓✓) nunca llegaba al disco, la siguiente
// lectura traía la versión vieja («enviando») y quedaba pendiente para siempre (isDone en la sesión → se saltaba sin arreglarla).
// A, B y C por Bluetooth; A tiene además 24 contactos (como el S24). B y C con la app en segundo plano y congelada (su nativo
// confirma a los 4 s). A se reinicia → avq a B y a C, confirmadas por su nativo:
//  P1  ninguna vuelta «Reenviando N pending» a B ni a C en el minuto siguiente (contraprueba 3172: 5 vueltas a B);
//  P2  en el DISCO de A nada de lo entregado queda pendiente/enviando (ni en lo que la app lee);
//  P3  B y C despiertan y A se reinicia otra vez: nada de lo ya entregado sale otra vez (contraprueba: «Pending OK» del avq);
//  P4  un texto de GRUPO a B y C (2 miembros, Bluetooth) queda entregado en el disco y no vuelve a la vuelta de reenvío.
// Uso: node pendcache.js <dir_build> [--otros=24]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const NOTROS = Number((process.argv.find((a) => a.startsWith('--otros=')) || '--otros=24').split('=')[1]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true, wifi: null };
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
      win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 200 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(500); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
const RESENDABLE = /^(pending|failed|sending|queued)$/;
// App dormida: en segundo plano y congelada (el nativo sigue: confirma a los 4 s); antes de irse, la app le dio las claves de firma
async function sleepApp(n, P) { await P.win.bleInterface._pushAckKeys(); n.setAppActive(false); n.setFrozen(true); const bi = P.win.bleInterface; P.win.clearInterval(bi._supervisorTimer); bi._supervisorTimer = null; }
function wakeApp(n, P) { n.setFrozen(false); n.setAppActive(true); const bi = P.win.bleInterface; bi._supervisorTimer = P.win.setInterval(() => bi._runSupervisorCycle(), bi._supervisorIntervalMs); }

(async () => {
  const r = { prueba: 'pendcache', build: path.basename(buildDir), otros: NOTROS };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', base), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', base), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', base);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA); const B = await boot('B', nB); const C = await boot('C', nC);
  const idA = A.win.bleInterface.localNexoId.toLowerCase(), idB = B.win.bleInterface.localNexoId.toLowerCase(), idC = C.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const pB = await addFound(A, 'B'); const pC = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  if (!pB || !pC) { console.log('PENDCACHE ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }))); process.exit(1); }
  await openChatWith(A, 'B'); sendText(A, 'hola B'); await sleep(2500); await closeChat(A);
  await openChatWith(A, 'C'); sendText(A, 'hola C'); await sleep(2500); await closeChat(A);
  await openChatWith(B, 'A'); sendText(B, 'hola A de B'); await sleep(2500); await closeChat(B);
  await openChatWith(C, 'A'); sendText(C, 'hola A de C'); await sleep(2500); await closeChat(C);
  // Los demás contactos de A (con su historial), como en el S24
  for (let i = 0; i < NOTROS; i++) {
    const nx = 'nxfa0000' + String(i).padStart(2, '0');
    A.win.vaultSaveContact({ nexoId: nx, displayName: 'Otro ' + i });
    await A.win.vaultSaveMessages(nx, [{ msgId: 'msgf' + i, messageId: 'msgf' + i, content: 'hola ' + i, text: 'hola ' + i, _own: false, status: 'delivered', timestamp: Date.now() - 86400000, senderNexoId: nx }]);
  }
  await sleep(6000);
  await sleepApp(nB, B); await sleepApp(nC, C);

  // ---- Fase 1: A se reinicia (como el S24); las avq a B y C las confirma su nativo ----
  A.win.close(); nA.destroyActivity(); await sleep(1500); nA.load(); A = await boot('A', nA);
  const delivered = new Set();
  const listen = (P) => P.win.addEventListener('nexo:ble:ackStatus', (e) => { const d = e.detail || {}; if (d.msgId && /delivered|read/.test(d.status)) delivered.add(d.msgId); });
  listen(A);
  // Lo que hay en el DISCO de A (sin tocar la caché de la app: leerla la refresca)
  const onDisk = (nx) => { try { const t = nA.files.get('nexo_vault_msgs_v2_' + nx + '.json'); return t ? (JSON.parse(t).messages || []) : []; } catch (e) { return []; } };
  const seen = {};
  const poll = setInterval(() => { for (const nx of [idB, idC]) { const cur = {}; onDisk(nx).filter((m) => m._own && m.hidden).forEach((m) => { cur[m.msgId] = m.status; }); Object.keys(Object.assign({}, cur, seen[nx] || {})).forEach((k) => { const a = (seen[nx] || {})[k], b = cur[k]; if (a !== b) logs.push(ts() + ' [A] PRUEBA disco ' + nx + ' ' + k + ' ' + a + ' -> ' + b); }); seen[nx] = cur; } }, 50);
  r.avq_entregadas_s = await waitFor(() => delivered.size >= 2, 60000);
  const mark1 = logs.length;
  await sleep(60000);
  const reB = new RegExp('\\[A\\] log: \\[BLEInterface\\] Reenviando \\d+ pending para ' + idB), reC = new RegExp('\\[A\\] log: \\[BLEInterface\\] Reenviando \\d+ pending para ' + idC);
  r.P1_vueltas_B = logs.slice(mark1).filter((l) => reB.test(l)).length;
  r.P1_vueltas_C = logs.slice(mark1).filter((l) => reC.test(l)).length;
  r.entregados_fase1 = delivered.size;
  const stuckIn = (list) => list.filter((m) => m._own && RESENDABLE.test(m.status) && delivered.has(m.msgId)).map((m) => m.msgId + ':' + m.status + ':' + String(m.content).substring(0, 36));
  r.P2_disco = stuckIn(onDisk(idB).concat(onDisk(idC)));
  r.P2_app = stuckIn((await A.win.vaultLoadMessages(idB)).concat(await A.win.vaultLoadMessages(idC)));

  // ---- Fase 2: B y C despiertan; A se reinicia otra vez: lo ya entregado no sale otra vez ----
  wakeApp(nB, B); wakeApp(nC, C);
  await sleep(4000);
  const ids1 = Array.from(delivered);
  A.win.close(); nA.destroyActivity(); await sleep(1500); nA.load(); A = await boot('A', nA);
  listen(A);
  const mark2 = logs.length;
  await waitFor(() => A.win.bleInterface.linkOf && A.win.bleInterface.linkOf(idB) && A.win.bleInterface.linkOf(idC), 40000);
  await sleep(15000);
  r.P3_otra_vez = ids1.filter((id) => logs.slice(mark2).some((l) => /\[A\] /.test(l) && (l.indexOf('Pending OK: ' + id) >= 0 || l.indexOf('msgId=' + id + ' reintento') >= 0)));

  // ---- P4: texto de GRUPO a B y C (Bluetooth), con los 26 chats ----
  const g = A.win.bleInterface.groups.create('Amigos', [idB, idC]);
  const gm = A.win.NEXO_sendGroupText(g.id, 'texto de grupo', 'texto de grupo');
  const wids = [gm + '_' + idB.substring(2), gm + '_' + idC.substring(2)];
  r.P4_llega_s = await waitFor(async () => (await B.win.vaultLoadMessages(g.id)).some((m) => /texto de grupo/.test(String(m.content))) && (await C.win.vaultLoadMessages(g.id)).some((m) => /texto de grupo/.test(String(m.content))), 40000);
  r.P4_entregado_s = await waitFor(() => wids.every((w) => delivered.has(w)), 30000);
  const mark4 = logs.length;
  await sleep(25000);
  r.P4_disco = wids.map((w) => { const m = onDisk(idB).concat(onDisk(idC)).find((x) => x.msgId === w); return m ? m.status : 'borrada'; });
  r.P4_vueltas = logs.slice(mark4).filter((l) => reB.test(l) || reC.test(l)).length;
  clearInterval(poll);

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch/.test(l)).slice(0, 5);
  const ok = r.entregados_fase1 >= 2 && r.P1_vueltas_B === 0 && r.P1_vueltas_C === 0 && !r.P2_disco.length && !r.P2_app.length && !r.P3_otra_vez.length &&
    r.P4_llega_s !== null && r.P4_entregado_s !== null && r.P4_disco.every((s) => !RESENDABLE.test(s)) && r.P4_vueltas === 0 && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PENDCACHE ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_pendcache.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PENDCACHE ' + JSON.stringify({ prueba: 'pendcache', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") })); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_pendcache.txt'), logs.join('\n')); process.exit(1); });
