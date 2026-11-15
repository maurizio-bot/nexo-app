// 3129 — ENLACE DE INVITACIÓN (PLAN etapa 2; dueño 15-11: «WhatsApp y TikTok… tu ajuste me parece bien»; la página va en su GitHub).
// Tres teléfonos solo por internet (relés), sin conocerse:
//  I1  A toca «WhatsApp» en «Invitar a NEXO»: se comparte (shareText nativo, WhatsApp primero) el texto de la invitación con
//      https://maurizio-bot.github.io/nexo-app/i#<ID de A>-<código de 8>;
//  I2  B pega el TEXTO ENTERO en «Agregar por NEXO ID» y toca «Agregar»: a A le llega la solicitud marcada «aceptó tu invitación»,
//      pero NO se agrega sola (SEC-2: se acepta a mano); A acepta y quedan conectados;
//  I3  C usa el MISMO enlace después: su solicitud llega como una normal (el código es de UN uso);
//  I4  un código de hace 8 días ya no vale; uno ajeno o mal formado tampoco;
//  I5  la app de B se abre con el enlace (nativo onInviteLink): «Agregar» abierto con el ID de A puesto y el aviso de quién invitó.
//  I6  3135 (anti-suplantación): C se pone el MISMO nombre que B (ya contacto de A): su solicitud sale en la bandeja de A con el aviso
//      rojo «Ya tienes a… con otro NEXO ID… puede ser un impostor» (contraprueba 3134: sin aviso).
// Contraprueba: en la 3128 no hay «Invitar a NEXO» (I1 falla) y el campo corta lo pegado a 10 letras.
// Uso: node invitacion.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
let RELAYS = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class DistLoader extends ResourceLoader {
  constructor(dir) { super(); this.dir = dir; }
  fetch(url) { const f = path.join(this.dir, decodeURIComponent(new URL(url).pathname)); return fs.existsSync(f) ? Promise.resolve(fs.readFileSync(f)) : Promise.reject(new Error('no existe ' + f)); }
}
const logs = [];
const shared = {};
async function boot(name, native) {
  native.listeners = new Map();
  shared[name] = [];
  const vc = new VirtualConsole();
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win);
      const pl = native.plugin();
      pl.shareText = async (o) => { shared[name].push(o); return { via: (o && o.pkgs && o.pkgs[0]) || 'menu' }; };
      win.Capacitor = { Plugins: { NexoBLE: pl } }; win.HTMLElement.prototype.scrollTo = function () {};
    },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win, bi: win.bleInterface };
}
const contactsOf = (p) => (p.bi.getBLEContacts ? p.bi.getBLEContacts() : []);
const hasContact = (p, id) => contactsOf(p).find((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === id.toLowerCase());
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(300); } return false; }
const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
async function addByText(p, text) {
  const inp = p.win.document.getElementById('ble-addid-input');
  if (!inp) return false;
  inp.value = text.slice(0, Number(inp.getAttribute('maxlength')) || 1e9); // lo que deja pegar el campo
  click(p.win, p.win.document.getElementById('ble-addid-btn'));
  return true;
}

(async () => {
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  const nC = new NativePhone('C', 'CC:CC:CC:CC:CC:03', Object.assign({}, base, { wifi: 'calle' }));
  [nA, nB, nC].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB), C = await boot('C', nC);
  const idA = A.bi.localNexoId.toLowerCase(), idB = B.bi.localNexoId.toLowerCase(), idC = C.bi.localNexoId.toLowerCase();
  const r = { prueba: 'invitacion', build: path.basename(buildDir) };
  r.en_internet = await waitFor(() => A.bi.net && A.bi.net.online() && B.bi.net.online() && C.bi.net.online(), 20000);

  // I1: A toca «WhatsApp»
  const btn = A.win.document.getElementById('ble-inv-whatsapp');
  r.I1_hay_boton = !!btn && !!A.win.document.getElementById('ble-inv-tiktok') && !!A.win.document.getElementById('ble-inv-more');
  click(A.win, btn);
  await waitFor(() => shared.A.length > 0, 3000);
  const sh = shared.A[0] || {};
  const m = String(sh.text || '').match(/https:\/\/maurizio-bot\.github\.io\/nexo-app\/i#(NX[0-9A-Z]{8})-([2-9A-HJ-NP-Z]{8})/);
  r.I1_texto = String(sh.text || '').slice(0, 90);
  r.I1_ok = r.I1_hay_boton && !!m && m[1].toLowerCase() === idA && Array.isArray(sh.pkgs) && sh.pkgs[0] === 'com.whatsapp' && /NEXO/.test(sh.text || '');
  const code = m ? m[2] : '';

  // I2: B pega el texto entero
  await addByText(B, String(sh.text || ''));
  r.I2_A_ve_solicitud = await waitFor(() => A.bi.pendingRequests().some((x) => x.id === idB), 20000);
  const reqB = A.bi.pendingRequests().find((x) => x.id === idB) || {};
  r.I2_marca_invitacion = reqB.inv === true;
  r.I2_no_entra_sola = !hasContact(A, idB);
  try { A.bi.renderRequests(); } catch (e) {}
  r.I2_bandeja_dice = /aceptó tu invitación/.test((A.win.document.getElementById('ble-requests-list') || {}).textContent || '');
  if (r.I2_A_ve_solicitud) { try { await A.bi.acceptRequest(idB); } catch (e) { logs.push('[A] accept: ' + (e && e.message)); } }
  r.I2_B_ve_aceptacion = await waitFor(() => B.bi.pendingRequests().some((x) => x.id === idA && x.acc), 20000);
  if (r.I2_B_ve_aceptacion) { try { await B.bi.acceptRequest(idA); } catch (e) {} }
  r.I2_conectados = await waitFor(() => !!hasContact(A, idB) && !!hasContact(B, idA) && A.bi.net.canReach(idB) && B.bi.net.canReach(idA), 40000);

  // I3: C usa el mismo enlace después → solicitud normal (código de un uso)
  C.win.bleInterface.localDeviceName = B.win.bleInterface.localDeviceName; // I6: C se pone el nombre de B
  await addByText(C, String(sh.text || ''));
  r.I3_A_ve_solicitud_C = await waitFor(() => A.bi.pendingRequests().some((x) => x.id === idC), 20000);
  const reqC = A.bi.pendingRequests().find((x) => x.id === idC) || {};
  r.I3_sin_marca = r.I3_A_ve_solicitud_C && reqC.inv !== true && !hasContact(A, idC);
  try { A.bi.renderRequests(); } catch (e) {}
  r.I6_aviso = ((A.win.document.querySelector('#ble-requests-list .ble-req-twin') || {}).textContent || '').slice(0, 200);
  r.I6_ok = /impostor/.test(r.I6_aviso) && r.I6_aviso.indexOf(idB.toUpperCase()) >= 0 && A.win.document.querySelectorAll('#ble-requests-list .ble-req-twin').length === 1;

  // I4: caducidad y códigos ajenos
  const inv = A.win.__nexoInvite;
  let I4 = false;
  if (inv) {
    const fresh = inv.create(idA);
    let now = Date.now();
    A.win.NEXO_INVITE_NOW = () => now;
    const okNow = inv.take(fresh.code, false);
    now += 8 * 24 * 3600 * 1000;
    const okLater = inv.take(fresh.code, false);
    A.win.NEXO_INVITE_NOW = undefined;
    I4 = okNow === true && okLater === false && inv.take('ZZZZZZZZ', false) === false && inv.take('abc', false) === false && inv.take(code, false) === false;
  }
  r.I4_ok = I4;

  // I5: la app de B se abre con el enlace (nativo onInviteLink)
  const inpB = B.win.document.getElementById('ble-addid-input');
  if (inpB) inpB.value = '';
  nB.emit('onInviteLink', { id: idA, code: 'ABCDEFGH' });
  await sleep(500);
  const noteB = (B.win.document.getElementById('ble-addid-note') || {}).textContent || '';
  r.I5_campo = inpB ? inpB.value : '';
  r.I5_ok = !!inpB && inpB.value === idA.toUpperCase() + '-ABCDEFGH' && noteB.indexOf(idA.toUpperCase()) >= 0 && /invitó/.test(noteB) && B.win.document.getElementById('ble-panel').classList.contains('active');

  const ok = r.en_internet && r.I1_ok && r.I2_A_ve_solicitud && r.I2_marca_invitacion && r.I2_no_entra_sola && r.I2_bandeja_dice && r.I2_conectados && r.I3_sin_marca && r.I4_ok && r.I5_ok && r.I6_ok;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('INVITACION ' + JSON.stringify(r));
  if (!ok) console.log(logs.filter((l) => /INVITE|solicitud|error/i.test(l)).slice(-30).join('\n'));
  try { await r1.stop(); await r2.stop(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('INVITACION ' + JSON.stringify({ prueba: 'invitacion', resultado: 'FALLO', error: String(e && e.message) })); console.log(logs.slice(-30).join('\n')); process.exit(1); });
