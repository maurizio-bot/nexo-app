// HISTORIAL PARA LOS NUEVOS DEL GRUPO (dueño 24-11, opción B). A, B y C por Bluetooth; A crea un grupo con B y hablan; luego agrega a C:
//  H1  C acepta la invitación → en el chat del grupo sale «📜 Ver mensajes anteriores» (y en el ⋮ del grupo);
//  H2  C lo toca → le llegan los mensajes de antes (de A y de B, con quién los dijo), sin avisos; el botón ya no sale;
//      lo que C ya tenía (el «Creó…»/«Te agregaron») no se repite;
//  H3  el creador lo cierra en Ajustes del grupo («Los nuevos pueden ver los mensajes anteriores» apagado): los demás ven el aviso,
//      otro grupo con eso cerrado no ofrece el botón y si C lo pide igual, nadie se lo manda.
//  H2b 3349 (dueño 26-11: «hay imágenes del historial que no se descargan»): las fotos de antes también llegan (chica, mediana) y la GRANDE
//      (más que el tope) llega como copia reducida en vez del aviso «Archivo grande no incluido».
//  H2c (dueño 26-11, 3160): lo mismo con una imagen grande mandada desde «Archivo» ('file', «1000103065.png»): llega como foto.
// Contraprueba: la build de antes no tiene botón (H1 falla).
// Imprime GRUPOHIST {json} y escribe last_logs_grupohistorial.txt. Uso: node grupohistorial.js <dir_build>
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
const out = (r, code) => { console.log('GRUPOHIST ' + JSON.stringify(r)); fs.writeFileSync(path.join(__dirname, 'last_logs_grupohistorial.txt'), logs.join('\n')); process.exit(code); };


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
  const r = { prueba: 'grupohistorial', build: path.basename(buildDir) };
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base)), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base)), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', Object.assign({}, base));
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB), C = await boot('C', nC);
  // B acepta al momento (lo de la invitación ya tiene su prueba)
  B.win.addEventListener('nexo:groups:invite', (e) => setTimeout(() => { try { B.win.bleInterface.groups.acceptInvite(e.detail.id); } catch (x) {} }, 50));
  const idB = B.win.bleInterface.localNexoId.toLowerCase(), idC = C.win.bleInterface.localNexoId.toLowerCase(), idA = A.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); const okB = await addFound(A, 'B'); const okC = await addFound(A, 'C'); A.win.bleInterface.togglePanel();
  if (!okB || !okC) out(Object.assign(r, { resultado: 'FALLO', error: 'no empareja' }), 1);
  await openChat(A, idB); typeSend(A, 'hola B'); await sleep(1200); await closeChat(A);
  await openChat(A, idC); typeSend(A, 'hola C'); await sleep(1200); await closeChat(A);
  r.emparejados_s = await waitFor(() => has(C, idA, 'hola C'), 30000);
  // grupo de A con B (solo B; C se agrega después)
  const gid = A.win.bleInterface.groups.create('Historia', [idB]).id;
  A.win.NEXO_sendGroupText(gid, JSON.stringify({ type: 'nexo_txt', t: '👥 Creó el grupo «Historia»' }), 'creó');
  await waitFor(() => !!B.win.bleInterface.groups.get(gid) && !B.win.bleInterface.groups.isInvited(gid), 60000);
  await sleep(1500);
  await sendGroup(A, gid, '[H] primero de A');
  await waitFor(() => grpHas(B, gid, /primero de A/), 30000);
  await sendGroup(B, gid, '[H] respuesta de B');
  r.charla_s = await waitFor(() => grpHas(A, gid, /respuesta de B/), 30000);
  // 3349 (dueño 26-11: «hay imágenes del historial que no se descargan»): fotos de antes (una chica y una de 150 KB) también deben llegarle a C
  const mkImg = (n, seed) => { const b = Buffer.alloc(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x & 255; } b[0] = 0xff; b[1] = 0xd8; return b.toString('base64'); };
  const IMG1 = mkImg(30000, 11), IMG2 = mkImg(150000, 22);
  if (A.win.NEXO_openGroupChat) A.win.NEXO_openGroupChat(gid); await sleep(500);
  A.win.NEXO_sendAttachment('image', IMG1, { format: 'jpeg', mime: 'image/jpeg' }, { contactId: gid }); await sleep(800);
  A.win.NEXO_sendAttachment('image', IMG2, { format: 'jpeg', mime: 'image/jpeg' }, { contactId: gid }); await sleep(800);
  // y una GRANDE (300 KB, más que el tope del historial): le llega a C una copia reducida (aquí su miniatura guardada: el simulador no tiene lienzo)
  const IMG3 = mkImg(300000, 33), TH3 = mkImg(20000, 44);
  A.win.NEXO_sendAttachment('image', IMG3, { format: 'jpeg', mime: 'image/jpeg' }, { contactId: gid }); await sleep(800);
  // H2c (dueño 26-11, 3160: «📎 Archivo grande no incluido: 1000103065.png»): una imagen GRANDE mandada desde «Archivo» ('file', png con nombre)
  const IMG4 = mkImg(300000, 55), TH4 = mkImg(18000, 66);
  A.win.NEXO_sendAttachment('file', IMG4, { name: '1000103065.png', size: 225000, type: 'image/png', mime: 'image/png' }, { contactId: gid });
  await closeChat(A);
  await waitFor(async () => { const l = await msgsOf(A, gid); return l.some((m) => m.attachmentType === 'image' && m._own && m.attachmentRef && !l.filter((x) => x.attachmentType === 'image').every((x) => x.attachmentRef !== m.attachmentRef)); }, 10000);
  { const hy = await A.win.vaultHydrateAttachments((await msgsOf(A, gid)).filter((m) => m.attachmentType === 'image')); const m3 = hy.find((m) => m.attachmentPayload === IMG3);
    r.foto_grande_registrada = !!m3; if (m3) await A.win.Capacitor.Plugins.NexoBLE.saveToFile({ filename: 'nexo_thumb_' + String(m3.msgId).replace(/[^A-Za-z0-9_-]/g, '_') + '.b64', content: TH3 }); }
  await waitFor(async () => { const hy = await A.win.vaultHydrateAttachments((await msgsOf(A, gid)).filter((m) => m.attachmentType === 'file')); return hy.some((m) => m.attachmentPayload === IMG4); }, 10000);
  { const hy = await A.win.vaultHydrateAttachments((await msgsOf(A, gid)).filter((m) => m.attachmentType === 'file')); const m4 = hy.find((m) => m.attachmentPayload === IMG4);
    r.png_registrado = !!m4; if (m4) await A.win.Capacitor.Plugins.NexoBLE.saveToFile({ filename: 'nexo_thumb_' + String(m4.msgId).replace(/[^A-Za-z0-9_-]/g, '_') + '.b64', content: TH4 }); }
  const imgsIn = async (p) => { const ms0 = await msgsOf(p, gid); const hy = p.win.vaultHydrateAttachments ? await p.win.vaultHydrateAttachments(ms0.filter((m) => m.attachmentType === 'image')) : []; return hy.map((m) => m.attachmentPayload); };
  r.fotos_en_B_s = await waitFor(async () => { const l = await imgsIn(B); return l.indexOf(IMG1) >= 0 && l.indexOf(IMG2) >= 0; }, 90000);
  await sleep(1000);

  // ---------- H1: A agrega a C → C acepta → botón ----------
  const cards = A.win.NEXO_groupCards ? A.win.NEXO_groupCards({ members: [idA, idB, idC] }) : null;
  await A.win.bleInterface.groups.addMembers(gid, [idC], cards);
  r.H1_invitado_s = await waitFor(() => C.win.bleInterface.groups.isInvited && C.win.bleInterface.groups.isInvited(gid), 60000);
  const acc = rowsInv(C).find((x) => /Historia/.test(x.textContent));
  click(C.win, acc && acc.querySelector('.grp-inv-accept')); await sleep(600);
  if (C.win.NEXO_openGroupChat) C.win.NEXO_openGroupChat(gid); await sleep(700);
  const btn = C.win.document.getElementById('nx-grp-hist');
  r.H1_boton = btn ? btn.textContent : null;
  r.H1_no_tiene_lo_de_antes = !(await grpHas(C, gid, /primero de A/));
  C.win.NEXO_openGroupMenu(gid); await sleep(300);
  r.H1_en_menu = !!C.win.document.querySelector('#nexo-group-menu .gm-history');
  { const m = C.win.document.getElementById('nexo-group-menu'); if (m) m.remove(); }
  r.H1_ok = r.H1_invitado_s !== null && /Ver mensajes anteriores/.test(r.H1_boton || '') && r.H1_no_tiene_lo_de_antes && r.H1_en_menu;

  // ---------- H2: lo toca → llegan los de antes ----------
  const n2 = nC.notifLog.length;
  const before = (await msgsOf(C, gid)).length;
  click(C.win, btn); await sleep(300);
  r.H2_llega_s = await waitFor(async () => (await grpHas(C, gid, /primero de A/)) && (await grpHas(C, gid, /respuesta de B/)), 60000);
  const ms = await msgsOf(C, gid);
  const deB = ms.find((m) => /respuesta de B/.test(String(m.content)));
  r.H2_de_B = deB ? String(deB.senderNexoId).toLowerCase() === idB : false;
  r.H2_avisos = nC.notifLog.slice(n2).filter((x) => x.chatId === gid).length;
  const ids = ms.map((m) => m.msgId); r.H2_sin_repetidos = new Set(ids).size === ids.length;
  r.H2_creo_una_vez = ms.filter((m) => /Creó el grupo/.test(String(m.content)) && String(m.msgId).indexOf('gsn') !== 0).length === 1; // (el aviso propio «gsn…» de C es aparte)
  await closeChat(C); if (C.win.NEXO_openGroupChat) C.win.NEXO_openGroupChat(gid); await sleep(600);
  r.H2_boton_se_va = !C.win.document.getElementById('nx-grp-hist');
  await closeChat(C);
  r.H2_fotos_s = await waitFor(async () => { const l = await imgsIn(C); return l.indexOf(IMG1) >= 0 && l.indexOf(IMG2) >= 0; }, 30000);
  r.H2_fotos = (await imgsIn(C)).map((x) => (x === IMG1 ? 'chica' : x === IMG2 ? 'mediana' : x === TH3 ? 'grande_reducida' : x === TH4 ? 'png_reducido' : String(x || 'nada').length));
  r.H2c_png_como_foto = r.H2_fotos.indexOf('png_reducido') >= 0 && !(await grpHas(C, gid, /no incluido[^\n]*1000103065/));
  r.H2_grande_reducida = r.H2_fotos.indexOf('grande_reducida') >= 0 && !(await grpHas(C, gid, /Archivo grande no incluido/));
  r.H2_ok = r.H2_llega_s !== null && r.H2_fotos_s !== null && r.H2_grande_reducida && r.H2c_png_como_foto && r.H2_de_B && r.H2_avisos === 0 && r.H2_sin_repetidos && r.H2_creo_una_vez && r.H2_boton_se_va && ms.length > before;

  // ---------- H3: el creador lo cierra ----------
  A.win.NEXO_openGroupSettings(gid); await sleep(400);
  const box = A.win.document.querySelector('#nexo-gset .gset-hist-box');
  r.H3_interruptor = !!box && box.checked === true && !box.disabled;
  if (box) { box.checked = false; box.dispatchEvent(new A.win.Event('change')); }
  await sleep(800);
  { const s = A.win.document.getElementById('nexo-gset'); if (s) s.remove(); }
  r.H3_cerrado_en_C_s = await waitFor(() => C.win.__nexoHist && !C.win.__nexoHist.allowed(gid), 60000);
  r.H3_aviso_en_B = await waitFor(() => grpHas(B, gid, /ya no ven los mensajes anteriores/), 30000);
  C.win.NEXO_openGroupMenu(gid); await sleep(300);
  r.H3_sin_menu = !C.win.document.querySelector('#nexo-group-menu .gm-history');
  { const m = C.win.document.getElementById('nexo-group-menu'); if (m) m.remove(); }
  // aunque alguien lo pida «a mano», nadie lo manda
  const lA = logs.length;
  C.win.Capacitor && C.win.bleInterface && (await C.win.bleInterface.sendChatMessage(idA, JSON.stringify({ type: 'nexo_act', act: 'ghq', g: gid, since: 0 }), 'msg_' + Date.now() + '_hq').catch(() => {}));
  await sleep(5000);
  r.H3_A_no_manda = logs.slice(lA).some((l) => /\[A\] log: \[GROUP\] Historial de \S+ cerrado para los nuevos/.test(l)) && !logs.slice(lA).some((l) => /\[A\] log: \[GROUP\] Historial de \S+ mandado/.test(l));
  r.H3_ok = r.H3_interruptor && r.H3_cerrado_en_C_s !== null && r.H3_aviso_en_B !== null && r.H3_sin_menu && r.H3_A_no_manda;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented|GLOBAL TIMEOUT|net::ERR|fetch|micrófono|getUserMedia/.test(l)).slice(0, 5);
  const ok = r.H1_ok && r.H2_ok && r.H3_ok && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  out(r, ok ? 0 : 1);
})().catch((e) => { console.error(e && e.stack); out({ prueba: 'grupohistorial', resultado: 'FALLO', error: String(e && e.message).replace(/"/g, "'") }, 1); });
