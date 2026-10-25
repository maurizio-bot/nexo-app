// Alta por ID (ronda 2779, src/net/net_link.js + src/ui/ble_links.js): agregar a alguien que NO está cerca, por internet,
// con su NEXO ID (te lo pasa por WhatsApp). No hay servidor donde "buscar" un ID: se le deja una SOLICITUD en un buzón de
// los relés derivado de su ID; él la acepta o la elimina (anti-spam). Al aceptar, se intercambian las claves y el canal
// seguro de pareja se enciende solo. La clave entra "sin verificar" (se compara el número de seguridad aparte).
// Comprueba: (1) A agrega a B por su ID, B ve la solicitud y acepta → los dos quedan de contacto por internet (con clave);
// (2) una solicitud de un desconocido (C) queda pendiente y, al eliminarla, no agrega nada. Nadie se agrega sin aceptar.
// Uso: node reqadd.js <dir_build>
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole, ResourceLoader } = require('jsdom');
const { Radio, NativePhone, installWebCrypto } = require('./native_mock');
const { NostrRelay } = require('./nostr_relay');

const buildDir = path.resolve(process.argv[2]);
const base = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [15, 15], ioDelay: 25, asymmetric: true, noTor: true };
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
  ['log', 'warn', 'error'].forEach((l) => vc.on(l, (...a) => logs.push(`[${name}] ${l}: ` + a.map(String).join(' ').substring(0, 250))));
  const dom = new JSDOM(fs.readFileSync(path.join(buildDir, 'dist', 'index.html'), 'utf8'), {
    url: 'https://' + name.toLowerCase() + '.nexo.test/index.html', runScripts: 'dangerously',
    resources: new DistLoader(path.join(buildDir, 'dist')), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) { win.NEXO_NET_RELAYS = RELAYS; win.CapacitorCustomPlatform = { name: 'android' }; installWebCrypto(win); win.Capacitor = { Plugins: { NexoBLE: native.plugin() } }; win.HTMLElement.prototype.scrollTo = function () {}; },
  });
  const win = dom.window;
  for (let i = 0; i < 100 && !(win.NEXO && win.NEXO.initialized); i++) await sleep(100);
  await sleep(800);
  return { name, native, win, bi: win.bleInterface };
}
const contactsOf = (p) => (p.bi.getBLEContacts ? p.bi.getBLEContacts() : []);
const hasContact = (p, id) => contactsOf(p).find((c) => (c.nexoId || c.deviceUUID || '').toLowerCase() === id.toLowerCase());
async function waitFor(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(300); } return false; }

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
  const r = { build: path.basename(buildDir) };

  // Los tres están en internet (relés), sin conocerse de antes (sin Bluetooth). Deben conectarse para recibir solicitudes.
  r.en_internet = await waitFor(() => A.bi.net && A.bi.net.online() && B.bi.net.online() && C.bi.net.online(), 20000);

  // 1) A agrega a B por su NEXO ID (como si B se lo hubiera pasado por WhatsApp). B no es contacto de A todavía.
  let sent = false;
  try { await A.bi.addByNexoId(idB); sent = true; } catch (e) { logs.push('[A] addByNexoId: ' + (e && e.message)); }
  r.solicitud_enviada = sent;
  // B recibe la solicitud en su bandeja (no se agrega nada solo)
  r.B_ve_solicitud = await waitFor(() => B.bi.pendingRequests().some((x) => x.id === idA), 15000);
  r.B_no_agrego_solo = !hasContact(B, idA) || !r.B_ve_solicitud ? !hasContact(B, idA) : true;
  // (comprobación directa: antes de aceptar, B NO tiene a A de contacto)
  r.pendiente_sin_agregar = r.B_ve_solicitud && !hasContact(B, idA);

  // 2) B acepta → agrega a A (con su clave) y avisa a A; A recibe la aceptación y agrega a B
  if (r.B_ve_solicitud) { try { await B.bi.acceptRequest(idA); } catch (e) { logs.push('[B] accept: ' + (e && e.message)); } }
  r.B_agrego_a_A = await waitFor(() => { const c = hasContact(B, idA); return !!(c && c.publicKey && c.nt); }, 10000);
  r.A_agrego_a_B = await waitFor(() => { const c = hasContact(A, idB); return !!(c && c.publicKey && c.nt); }, 20000);
  // "Sin verificar": la clave llegó por internet, no en persona (no marcada como verificada)
  const cAB = hasContact(A, idB);
  r.sin_verificar = !!(cAB && cAB.publicKey && cAB.verified !== true && cAB.keyVerified !== true);
  // El canal seguro de pareja se enciende solo (se ven en línea por internet)
  r.se_conectan = await waitFor(() => A.bi.net.canReach(idB) && B.bi.net.canReach(idA), 40000);

  // 3) Anti-spam: C (desconocido) manda una solicitud a A; queda pendiente; A la elimina y no se agrega nada
  try { await C.bi.addByNexoId(idA); } catch (e) { logs.push('[C] addByNexoId: ' + (e && e.message)); }
  r.A_ve_solicitud_C = await waitFor(() => A.bi.pendingRequests().some((x) => x.id === idC), 15000);
  r.C_no_agregado_solo = !hasContact(A, idC);
  if (r.A_ve_solicitud_C) A.bi.rejectRequest(idC);
  await sleep(500);
  r.rechazo_funciona = !A.bi.pendingRequests().some((x) => x.id === idC) && !hasContact(A, idC);

  const ok = r.en_internet && r.solicitud_enviada && r.B_ve_solicitud && r.pendiente_sin_agregar && r.B_agrego_a_A &&
    r.A_agrego_a_B && r.sin_verificar && r.se_conectan && r.A_ve_solicitud_C && r.C_no_agregado_solo && r.rechazo_funciona;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('REQADD ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-50).join('\n'));
  try { await r1.stop(); await r2.stop(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('REQADD {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); console.log(logs.slice(-40).join('\n')); process.exit(1); });
