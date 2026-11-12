// 12-11 (diagnóstico S23 con la 3014, 22:13:49): una foto de 57 KB del S23 al S24 salió por el Redmi como PUENTE Bluetooth
// (justo tras la cámara, que corta y rehace todos los enlaces) y el puente no confirmó NI UN trozo: la ventana 0 se reenvió
// cada 8 s hasta agotar los 8 reintentos (73 s) y solo entonces se abortó; luego salió por internet en 2 s. Mientras tanto
// los textos ya iban al buzón de internet del S24. Escena: A–B–C en fila (A y C no se ven), B es el puente y tiene la app
// DORMIDA (no reenvía ni confirma nada); A tiene internet y C es contacto suyo con internet (buzón), pero C no está en línea.
//  J1: A suelta el puente pronto (≤ 30 s) y deja la foto en el buzón de archivos de C (✓ del buzón, no ✗).
//  J2: no se gastan los 8 reintentos de ventana sobre el puente.
//  J3: C arranca con internet y recibe la foto íntegra.
// Uso: node jumpdead.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
async function boot(name, native, relays) {
  native.listeners = new Map();
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`${new Date().toISOString().substring(14, 23)} [${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = relays; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win };
}
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function openChatWith(p, name) {
  let row; for (let i = 0; i < 100 && !row; i++) { row = Array.from(p.win.document.querySelectorAll('#main-contacts-list .ble-contact-row')).find((r) => (r.querySelector('.ble-contact-name') || {}).textContent === name); if (!row) await sleep(100); }
  click(p.win, row); await sleep(600); return !!row;
}
async function closeChat(p) { p.win.dispatchEvent(new p.win.CustomEvent('nexo:ble:closeChat', { detail: {} })); await sleep(300); }
async function sendText(p, t) { const i = p.win.document.getElementById('message-input'); i.value = t; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); click(p.win, p.win.document.getElementById('send-btn')); }
async function addFound(p, name) {
  let add = null;
  const find = () => { const row = Array.from(p.win.document.querySelectorAll('#ble-new-device > div')).find((d) => (d.querySelector('span') || {}).textContent === name); return row && row.querySelector('button'); };
  for (let i = 0; i < 400 && !add; i++) { await sleep(100); add = find(); if (!add && !p.win.bleInterface.isScanning) click(p.win, p.win.document.getElementById('ble-scan-btn')); }
  click(p.win, add); await sleep(2000);
  return !!add;
}
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Math.round((Date.now() - t0) / 100) / 10; await sleep(250); } return null; }
const statusOf = (p, msgId) => { const s = p.win.document.querySelector('.msg-status[data-msg-id="' + msgId + '"]'); const m = s && (s.className || '').match(/status-([a-z]+)/); return m ? m[1] : null; };

(async () => {
  const r = { prueba: 'jumpdead', build: path.basename(buildDir) };
  const relay = new NostrRelay(); const RELAYS = [await relay.start()];
  const radio = new Radio();
  const nat = {}, P = {};
  ['A', 'B', 'C'].forEach((n, i) => { const h = n.repeat(2); nat[n] = new NativePhone(n, [h, h, h, h, h, '0' + (i + 1)].join(':'), Object.assign({}, opts, { wifi: 'casa' + n, noTor: true })); radio.add(nat[n]); nat[n].load(); });
  // A con internet; B y C sin (C «no está en línea»: su buzón sí sirve)
  P.A = await boot('A', nat.A, RELAYS); P.B = await boot('B', nat.B, []); P.C = await boot('C', nat.C, []);
  const id = (n) => P[n].win.bleInterface.localNexoId.toLowerCase();
  async function pair(x, y) {
    const others = ['A', 'B', 'C'].filter((n) => n !== x && n !== y);
    others.forEach((o) => radio.block(nat[x], nat[o]));
    P[x].win.bleInterface.togglePanel(); const ok = await addFound(P[x], y); P[x].win.bleInterface.togglePanel();
    await sleep(800);
    await openChatWith(P[x], y); await sendText(P[x], 'hola ' + y); await sleep(2500);
    const keyOf = (a, b) => !!(P[a].win.vaultLoadContacts().find((c) => c.name === b) || {}).publicKey;
    for (let i = 0; i < 40 && !keyOf(x, y); i++) await sleep(500);
    for (let i = 0; i < 40 && !keyOf(y, x); i++) await sleep(500);
    await closeChat(P[x]);
    others.forEach((o) => radio.unblock(nat[x], nat[o]));
    return ok;
  }
  for (const [x, y] of [['A', 'B'], ['B', 'C'], ['A', 'C']]) if (!(await pair(x, y))) { console.log('JUMPDEAD ' + JSON.stringify({ prueba: 'jumpdead', resultado: 'FALLO', error: 'no empareja ' + x + y })); process.exit(1); }
  radio.block(nat.A, nat.C);
  r.ruta_por_B_s = await waitFor(() => !!P.A.win.bleInterface.relay.relayHop(id('C'), { files: true }), 60000);
  r.A_buzon_de_C = P.A.win.bleInterface.net.mailboxOk(id('C'));
  // El puente se duerme (app congelada: el enlace sigue arriba, no reenvía ni confirma nada)
  nat.B.setFrozen(true);
  await sleep(1500);
  await openChatWith(P.A, 'C');
  const foto = Buffer.alloc(40000); for (let i = 0; i < foto.length; i++) foto[i] = (i * 29 + 7) & 255;
  click(P.A.win, P.A.win.document.querySelector('.attach-menu-item[data-type="file"]')); await sleep(200);
  const fin = Array.from(P.A.win.document.querySelectorAll('input[type=file]')).pop();
  Object.defineProperty(fin, 'files', { value: [new P.A.win.File([foto], 'foto.png', { type: 'image/png' })] });
  fin.dispatchEvent(new P.A.win.Event('change'));
  const t0 = Date.now();
  let mid = null;
  await waitFor(async () => { const m = (await P.A.win.vaultLoadMessages(id('C'))).filter((x) => x._own && x.attachmentType).pop(); mid = m && m.messageId; return !!mid; }, 10000);
  r.por_puente = await waitFor(() => logs.some((l) => /\[A\].*\[JUMP\] Adjunto/.test(l)), 15000) !== null;
  r.J1_suelta_puente_y_buzon_s = await waitFor(() => logs.some((l) => new RegExp('\\[A\\].*\\[BLOB\\] ' + mid + '.*mando el puntero').test(l)), 150000);
  r.estado_A = statusOf(P.A, mid);
  r.J1_ok = typeof r.J1_suelta_puente_y_buzon_s === 'number' && (Date.now() - t0) > 0 && r.J1_suelta_puente_y_buzon_s <= 30 && r.estado_A !== 'failed';
  r.reintentos_de_ventana = logs.filter((l) => new RegExp('\\[A\\].*Window timeout, reenviando ventana.*' + mid).test(l)).length;
  r.J2_pocos_reintentos = r.reintentos_de_ventana <= 3 && !logs.some((l) => /\[A\].*Max window retries/.test(l));
  // C vuelve con internet: lee su buzón
  P.C.win.close(); nat.C.destroyActivity(); nat.C.load();
  P.C = await boot('C', nat.C, RELAYS);
  r.J3_C_recibe_s = await waitFor(async () => (await P.C.win.vaultLoadMessages(id('A'))).some((m) => m.attachmentType && (m.attachmentPayload === foto.toString('base64') || (m.attachmentRef && nat.C.files.get(m.attachmentRef) === foto.toString('base64')))), 60000);
  r.errores = logs.filter((l) => /Error procesando|No se pudo descifrar|ilegible/.test(l)).slice(0, 3);
  const ok = r.por_puente && r.J1_ok && r.J2_pocos_reintentos && typeof r.J3_C_recibe_s === 'number' && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('JUMPDEAD ' + JSON.stringify(r));
  fs.writeFileSync(path.join(__dirname, 'last_logs_jumpdead.txt'), logs.join('\n'));
  await relay.stop();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('JUMPDEAD {"prueba":"jumpdead","resultado":"FALLO","error":"' + String(e && e.message).replace(/"/g, "'") + '"}'); console.error(e && e.stack); fs.writeFileSync(path.join(__dirname, 'last_logs_jumpdead.txt'), logs.join('\n')); process.exit(1); });
