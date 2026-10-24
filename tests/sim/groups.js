// Chats de grupo (ronda 2758, plan del dueño punto 14). A conoce a B y a C; B y C no se conocen.
// 1. A crea el grupo "Amigos" con B y C (botón 👥): aparece en la lista de los tres; B y C reciben las tarjetas del
//    otro (pueden escribirse cifrado). La burbuja de A pasa a ✓✓ cuando les llegó a los dos.
// 2. B escribe en el grupo: llega a A y a C en el chat del grupo (con el nombre de quien escribe), no en el chat 1:1;
//    con el chat cerrado cuenta como no leído y el último mensaje de la lista es "B: …".
// 3. Una respuesta larga de C (texto de más de un trozo) también llega a los dos.
// 4. Las copias de cada miembro no se ven en los chats 1:1 (ni al reabrirlos).
// 5. C sale del grupo: A y B lo ven y ya no le mandan.
// Uso: node groups.js <dir_build> [--io-delay=25]
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone } = require('./native_mock');

const buildDir = path.resolve(process.argv[2]);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k)); if (!a) return d; const v = a.split('=')[1]; return v === undefined ? true : Number(v); };
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: arg('io-delay', 0), asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native) {
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.CapacitorCustomPlatform = { name: 'android' }; require('./native_mock').installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const rows = (p) => Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).map((r) => ({ name: (r.querySelector('.ble-contact-name') || {}).textContent, msg: (r.querySelector('.ble-contact-msg') || {}).textContent, unread: Number((r.querySelector('.ble-unread-badge') || {}).textContent || 0) }));
async function openChatWith(p, name) {
  const row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name);
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p) {
  let add = null;
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = p.win.document.querySelector('#ble-new-device > div button'); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
}
const bubbles = (p) => Array.from(p.win.document.querySelectorAll('#messages-container .message')).map((m) => ({ own: m.classList.contains('own'), who: (m.querySelector('.msg-group-sender') || {}).textContent || '', text: (m.querySelector('.msg-content') || {}).textContent || '', st: ((m.querySelector('.msg-status') || {}).className || '').replace('msg-status status-', '') }));
const wait = async (c, s) => { for (let i = 0; i < s * 5 && !c(); i++) await sleep(200); return !!c(); };
const vaultHas = async (p, cid, re) => (await p.win.vaultLoadMessages(cid)).some((m) => re.test(m.content || ''));

(async () => {
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts), nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', opts);
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const [A, B, C] = await Promise.all([boot('A', nA), boot('B', nB), boot('C', nC)]);
  const id = (p) => p.win.bleInterface.localNexoId.toLowerCase();
  A.win.bleInterface.togglePanel(); await addFound(A); await addFound(A); A.win.bleInterface.togglePanel();
  await sleep(1500);
  for (const n of ['B', 'C']) { await openChatWith(A, n); await sendText(A, 'hola ' + n); await sleep(2500); await closeChat(A); }
  const r = { build: path.basename(buildDir) };
  r.B_conoce_a_C_antes = B.win.vaultLoadContacts().some((c) => (c.nexoId || '').toLowerCase() === id(C));
  // 1. A crea el grupo
  click(A.win, A.win.document.getElementById('nexo-new-group-btn')); await sleep(400);
  const sheet = A.win.document.getElementById('nexo-group-sheet');
  r.boton_grupo = !!sheet;
  if (!sheet) { console.log('GROUPS ' + JSON.stringify(Object.assign(r, { resultado: 'FALLO' }))); fs.writeFileSync(path.join(__dirname, 'last_logs_groups.txt'), logs.join('\n')); process.exit(1); }
  const nm = sheet.querySelector('#nexo-group-name'); nm.value = 'Amigos'; nm.dispatchEvent(new A.win.Event('input'));
  sheet.querySelectorAll('.nexo-pick-row input').forEach((cb) => { cb.checked = true; cb.dispatchEvent(new A.win.Event('change')); });
  r.texto_boton = sheet.querySelector('#nexo-group-create').textContent;
  click(A.win, sheet.querySelector('#nexo-group-create')); await sleep(500);
  const gid = Object.keys(A.win.bleInterface.groups.list)[0];
  r.cabecera_A = (A.win.document.getElementById('chat-contact-subtitle') || {}).textContent;
  r.grupo_en_B = await wait(() => rows(B).some((x) => x.name === '👥 Amigos'), 60);
  r.grupo_en_C = await wait(() => rows(C).some((x) => x.name === '👥 Amigos'), 60);
  r.creado_entregado_en_A = await wait(() => bubbles(A).some((b) => b.own && /Creó el grupo/.test(b.text) && /delivered|read/.test(b.st)), 60) ? true : bubbles(A).map((b) => b.st);
  r.B_conoce_a_C_despues = B.win.vaultLoadContacts().some((c) => (c.nexoId || '').toLowerCase() === id(C));
  r.C_conoce_a_B_despues = C.win.vaultLoadContacts().some((c) => (c.nexoId || '').toLowerCase() === id(B));
  await closeChat(A);
  // 2. B escribe en el grupo
  await openChatWith(B, '👥 Amigos');
  r.cabecera_B = (B.win.document.getElementById('chat-contact-subtitle') || {}).textContent;
  await sendText(B, 'hola grupo, soy B');
  r.llega_a_A = await wait(() => rows(A).some((x) => x.name === '👥 Amigos' && /B: hola grupo/.test(x.msg)), 90);
  r.no_leido_A = (rows(A).find((x) => x.name === '👥 Amigos') || {}).unread;
  r.llega_a_C = await (async () => { for (let i = 0; i < 300; i++) { if (await vaultHas(C, gid, /hola grupo, soy B/)) return true; await sleep(300); } return false; })();
  r.no_va_al_chat_1a1_de_C = !(await vaultHas(C, id(B), /hola grupo/)) && !(await vaultHas(A, id(B), /hola grupo/));
  r.estado_en_B = await wait(() => bubbles(B).some((b) => b.own && b.text === 'hola grupo, soy B' && /delivered|read/.test(b.st)), 90) ? 'entregado a todos' : bubbles(B).filter((b) => b.own).map((b) => b.st);
  await openChatWith(C, '👥 Amigos');
  r.burbuja_en_C = bubbles(C).filter((b) => !b.own).map((b) => b.who + ': ' + b.text);
  // 3. C responde con un texto largo
  const largo = 'respuesta larga de C ' + 'x'.repeat(1500);
  await sendText(C, largo);
  r.largo_llega_a_A = await (async () => { for (let i = 0; i < 300; i++) { if (await vaultHas(A, gid, /respuesta larga de C/)) return true; await sleep(300); } return false; })();
  r.largo_llega_a_B = await (async () => { for (let i = 0; i < 300; i++) { if (await vaultHas(B, gid, /respuesta larga de C/)) return true; await sleep(300); } return false; })();
  // 4. Las copias no se ven en los chats 1:1 (B abre su chat con A)
  await closeChat(B); await openChatWith(B, 'A'); await sleep(800);
  r.chat_1a1_B_A = bubbles(B).map((b) => b.text.substring(0, 30));
  r.sin_sobres_en_1a1 = !bubbles(B).some((b) => /nexo_grp|hola grupo/.test(b.text));
  await closeChat(B);
  // 5. C sale del grupo
  await closeChat(C);
  C.win.NEXO_openGroupMenu(gid); await sleep(300);
  click(C.win, C.win.document.querySelector('#nexo-group-menu .gm-leave')); await sleep(500);
  r.C_ya_no_lo_tiene = !rows(C).some((x) => x.name === '👥 Amigos');
  r.A_ve_que_salio = await wait(() => (A.win.bleInterface.groups.get(gid) || {}).members.length === 2, 90);
  r.B_ve_que_salio = await wait(() => (B.win.bleInterface.groups.get(gid) || {}).members.length === 2, 90);
  await openChatWith(A, '👥 Amigos'); await sendText(A, 'ya sin C'); await sleep(4000);
  r.no_se_manda_a_C = !(await vaultHas(A, id(C), /ya sin C/)) && !(await vaultHas(C, gid, /ya sin C/));
  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css/.test(l)).slice(0, 5);
  const ok = r.grupo_en_B && r.grupo_en_C && r.creado_entregado_en_A === true && r.B_conoce_a_C_despues && r.C_conoce_a_B_despues && r.llega_a_A && r.no_leido_A === 1 &&
    r.llega_a_C && r.no_va_al_chat_1a1_de_C && r.estado_en_B === 'entregado a todos' && r.burbuja_en_C.some((x) => /^B: hola grupo/.test(x)) && r.largo_llega_a_A && r.largo_llega_a_B &&
    r.sin_sobres_en_1a1 && r.C_ya_no_lo_tiene && r.A_ve_que_salio && r.B_ve_que_salio && r.no_se_manda_a_C && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('GROUPS ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_groups.txt'), logs.join('\n'));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(__dirname, 'last_logs_groups.txt'), logs.join('\n')); process.exit(1); });
