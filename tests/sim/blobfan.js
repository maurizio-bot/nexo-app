// Fase C de la entrega offline (build 2971): CIFRAR UNA VEZ, BLOB COMPARTIDO y REENVÍO/FAN-OUT POR REFERENCIA — tres teléfonos.
// A, B y C se conocen por Bluetooth; A crea el grupo «Familia» [B, C]; después cada uno a su casa (solo internet, 3 relés).
//  (1) B y C APAGAN el teléfono. A manda una foto de 200 KB AL GRUPO: se cifra y sube UNA sola vez (5 trozos kind 1064 por
//      relé, no 10) y cada miembro recibe dentro del sobre del grupo un PUNTERO chiquito; la burbuja de A pasa a ✓.
//  (2) B vuelve → la foto aparece en el chat del grupo, idéntica. C vuelve → también. Entonces A ve ✓✓ (los dos) y pide
//      BORRAR los trozos (kind 5) una sola vez (una clave por blob, dos destinatarios).
//  (3) REENVÍO POR REFERENCIA: B reenvía esa foto a C (los dos en línea): ni un trozo nuevo en los relés (0 subidas), y C,
//      que YA tenía ese blob (misma huella y llave), no baja nada (dedup local): el mensaje aparece en el chat B→C idéntico.
//  (4) C apaga; A le reenvía la misma foto al chat 1-a-1 (puntero guardado en su propio mensaje del grupo): 0 subidas; C vuelve
//      y la tiene (sin bajar: ya la tenía); A ve ✓✓.
//  (5) Nada legible en los relés; sin errores.
// Uso: node blobfan.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived', 'onLanMessage', 'onLanUp', 'onLanDown'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noL2: true };
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
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 300))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(500); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function sendFile(p, name, bytes) {
  const b = Buffer.alloc(bytes); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + name.length * 7) & 255;
  click(p.win, p.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(100);
  const fin = Array.from(p.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { configurable: true, value: [new p.win.File([b], name, { type: 'application/octet-stream' })] });
  fin.dispatchEvent(new p.win.Event('change'));
  return b;
}
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(200); } return null; }
// Apagar un teléfono de verdad: primero se le cortan los relés (que no alcance a leer nada más), después la ventana y el nativo
function shutdown(p) {
  try { p.win.bleInterface.net._closeAll(); p.win.bleInterface.net.relays.forEach((rl) => { rl.retryAt = Date.now() + 9e6; }); } catch (e) {}
  p.win.close(); p.native.destroyActivity();
}
const vaultMsgs = (p, chat) => p.win.vaultLoadMessages(chat);
async function findMsg(p, chat, b64, own) {
  const list = await vaultMsgs(p, chat);
  return list.find((m) => !!m._own === !!own && m.attachmentType && !m.deleted && !m.hidden && (m.attachmentPayload || p.native.files.get(m.attachmentRef)) === b64) || null;
}

(async () => {
  const r = { prueba: 'blobfan', build: path.basename(buildDir) };
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true }), r3 = new NostrRelay();
  RELAYS = [await r1.start(), await r2.start(), await r3.start()];
  const relays = [r1, r2, r3];
  const count1064 = () => relays.reduce((n, x) => n + x.events.filter((e) => e.kind === 1064).length, 0);
  const reqIds = () => relays.map((x) => x.stats.reqIds || 0).join(',');
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa', noTor: true }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina', noTor: true }));
  const nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', Object.assign({}, base, { wifi: 'campo', noTor: true }));
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  let A = await boot('A', nA), B = await boot('B', nB), C = await boot('C', nC);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  const idA = id(A), idB = id(B), idC = id(C);
  // Se conocen en persona: A↔B, A↔C y B↔C (claves + «nt»)
  A.win.bleInterface.togglePanel(); const pAB = await addFound(A, 'B'); const pAC = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  B.win.bleInterface.togglePanel(); const pBC = await addFound(B, 'C'); B.win.bleInterface.togglePanel();
  if (!pAB || !pAC || !pBC) { console.log('BLOBFAN ' + JSON.stringify({ prueba: 'blobfan', resultado: 'FALLO', error: 'no empareja ' + [pAB, pAC, pBC].join(',') })); process.exit(1); }
  for (const [p, n] of [[A, 'B'], [A, 'C'], [B, 'C']]) { await openChatWith(p, n); sendText(p, 'hola ' + n); await sleep(2500); await closeChat(p); }
  const gid = A.win.bleInterface.groups.create('Familia', [idB, idC]).id;
  A.win.NEXO_openGroupChat(gid); await sleep(600);
  sendText(A, 'hola familia');
  r.grupo_en_B_y_C = await waitFor(() => !!B.win.bleInterface.groups.get(gid) && !!C.win.bleInterface.groups.get(gid), 60000);
  // Cada uno a su casa: sin Bluetooth, en línea por internet
  radio.block(nA, nB); radio.block(nA, nC); radio.block(nB, nC);
  const netA = () => A.win.bleInterface.net, ackA = () => A.win.bleInterface.ackSystem;
  const via = (p, nx) => p.win.bleInterface.linkOf(nx);
  [A, B, C].forEach((p) => p.win.bleInterface.net.tick());
  r.todos_por_internet_s = await waitFor(() => via(A, idB) === 'internet' && via(A, idC) === 'internet' && via(B, idC) === 'internet', 60000);

  // ===== (1) B y C apagan; A manda una foto de 200 KB al GRUPO =====
  shutdown(B); shutdown(C); await sleep(500);
  [idB, idC].forEach((nx) => { const p = netA().peers.get(nx); if (p) p.lastRx = 0; }); await netA().tick();
  r.A_ve_a_los_dos_ausentes = await waitFor(() => !netA().canReach(idB) && !netA().canReach(idC), 15000) !== null;
  const ev0 = count1064();
  const foto = await sendFile(A, 'foto_grupo.jpg', 200000);
  const b64 = foto.toString('base64');
  let msgA = null;
  r.grupo_registrado_s = await waitFor(async () => !!(msgA = await findMsg(A, gid, b64, true)), 10000);
  const gm = msgA && msgA.messageId;
  const stA = () => (A.win.bleInterface.groups.st[gm] || {}).m || {};
  r.A_tick_grupo_s = await waitFor(() => Object.keys(stA()).length === 2 && Object.values(stA()).every((s) => s === 'sent' || s === 'delivered'), 30000);
  r.una_sola_subida = (count1064() - ev0) === 5 * 3; // 200 KB → 5 trozos, en 3 relés, UNA vez (no una por miembro)
  r.trozos_por_rele = relays.map((x) => x.events.filter((e) => e.kind === 1064).length).join(',');
  const recA = ackA()._blobOut && ackA()._blobOut.get(gm);
  r.A_registra_dos_destinatarios = !!(recA && recA.to && Object.keys(recA.to).length === 2);
  r.A_guardo_puntero_en_su_mensaje = !!(msgA && msgA.attachmentMeta && msgA.attachmentMeta.blobPtr) || (await findMsg(A, gid, b64, true) || {}).attachmentMeta?.blobPtr != null;
  const blobs = r1.events.filter((e) => e.kind === 1064);

  // ===== (2) B y C vuelven: la foto en el chat del grupo; A ✓✓ y un solo borrado =====
  nB.load(); B = await boot('B', nB);
  let msgB = null;
  r.B_recibe_en_grupo_s = await waitFor(async () => !!(msgB = await findMsg(B, gid, b64, false)), 60000);
  r.B_mensaje_con_puntero_guardado = !!(msgB && msgB.attachmentMeta && msgB.attachmentMeta.blobPtr && msgB.attachmentMeta.blobPtr.hash);
  nC.load(); C = await boot('C', nC);
  let msgC = null;
  r.C_recibe_en_grupo_s = await waitFor(async () => !!(msgC = await findMsg(C, gid, b64, false)), 60000);
  r.A_doble_tick_grupo_s = await waitFor(() => Object.values(stA()).length === 2 && Object.values(stA()).every((s) => s === 'delivered' || s === 'read'), 30000);
  r.un_solo_borrado_kind5 = await waitFor(() => relays.some((x) => x.events.filter((e) => e.kind === 5 && blobs.length && e.pubkey === blobs[0].pubkey).length === 1), 10000) !== null;
  r.A_limpio_registro_grupo = !(ackA()._blobOut && ackA()._blobOut.has(gm));

  // ===== (3) B reenvía la foto a C (en línea): por REFERENCIA, 0 subidas; C ya la tenía: 0 bajadas =====
  r.B_y_C_en_linea_s = await waitFor(() => via(B, idC) === 'internet' && B.win.bleInterface.net.canReach(idC), 60000);
  const ev3 = count1064(), req3 = reqIds();
  const metaFwd = Object.assign({}, msgB.attachmentMeta || {});
  B.win.NEXO_sendAttachment('file', b64, metaFwd, { contactId: idC });
  let msgC2 = null;
  r.C_recibe_reenvio_s = await waitFor(async () => !!(msgC2 = await findMsg(C, idB, b64, false)), 60000);
  r.reenvio_sin_subir = count1064() === ev3;
  r.reenvio_sin_bajar = reqIds() === req3 && logs.some((l) => /\[C\].*\[BLOB\].*ya lo tenía/.test(l));
  r.B_log_por_referencia = logs.some((l) => /\[B\].*\[BLOB\].*POR REFERENCIA/.test(l));

  // ===== (4) C apaga; A reenvía la misma foto al chat 1-a-1 con C: por referencia (puntero de su mensaje del grupo) =====
  shutdown(C); await sleep(500);
  const pC = netA().peers.get(idC); if (pC) pC.lastRx = 0; await netA().tick();
  await waitFor(() => !netA().canReach(idC), 15000);
  const ev4 = count1064();
  const msgA2 = await findMsg(A, gid, b64, true);
  A.win.NEXO_sendAttachment('file', b64, Object.assign({}, msgA2.attachmentMeta || {}), { contactId: idC });
  let msgA3 = null;
  r.A_reenvio_registrado_s = await waitFor(async () => !!(msgA3 = await findMsg(A, idC, b64, true)), 10000);
  const sel = (p, mid) => { const s = p.win.document.querySelector('.msg-status[data-msg-id="' + mid + '"]'); const m = s && (s.className || '').match(/status-([a-z]+)/); return m ? m[1] : null; };
  r.A_reenvio_sin_subir = count1064() === ev4;
  nC.load(); C = await boot('C', nC);
  r.C_recibe_reenvio_de_A_s = await waitFor(async () => !!(await findMsg(C, idA, b64, false)), 60000);
  r.A_reenvio_doble_tick_s = await waitFor(async () => { const m = await findMsg(A, idC, b64, true); return !!m && (m.status === 'delivered' || m.status === 'read'); }, 30000);

  // ===== (5) relés y errores =====
  const all = relays.map((x) => x.events.map((e) => JSON.stringify(e)).join('\n')).join('\n').toLowerCase();
  r.reles_ven_algo = ['foto_grupo', idA, idB, idC, '"type"', b64.substring(0, 24).toLowerCase()].filter((x) => all.indexOf(x) >= 0);
  r.errores = logs.filter((l) => /ilegible|Error procesando|No se pudo descifrar|\[BLOB\].*( descartado:|rechazado \(|no se pudo bajar|caducó|no pudo subirse)/.test(l)).slice(0, 3);
  r.contenido_en_registros = logs.filter((l) => l.indexOf(b64.substring(0, 24)) >= 0).length;

  const numeric = ['grupo_en_B_y_C', 'todos_por_internet_s', 'grupo_registrado_s', 'A_tick_grupo_s', 'B_recibe_en_grupo_s', 'C_recibe_en_grupo_s', 'A_doble_tick_grupo_s', 'B_y_C_en_linea_s', 'C_recibe_reenvio_s', 'A_reenvio_registrado_s', 'C_recibe_reenvio_de_A_s', 'A_reenvio_doble_tick_s'];
  const info = { prueba: 1, build: 1, resultado: 1, trozos_por_rele: 1 };
  const ok = numeric.every((k) => typeof r[k] === 'number') && r.reles_ven_algo.length === 0 && r.errores.length === 0 && r.contenido_en_registros === 0 &&
    Object.keys(r).every((k) => info[k] || typeof r[k] !== 'boolean' || r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLOBFAN ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_blobfan.txt'), logs.join('\n'));
  await Promise.all(relays.map((x) => x.stop()));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLOBFAN {"prueba":"blobfan","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_blobfan.txt'), logs.join('\n')); process.exit(1); });
