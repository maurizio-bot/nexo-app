// Contactos en común (PSI, Private Set Intersection) — src/ui/psi.js (#dueño 04-11, paso 3 del perfil). Dos NEXO
// descubren SOLO los contactos que tienen en común, sin revelarse el resto de la agenda ni ver la ajena.
// PARTE 1 (cripto PURA, determinista): con dos agendas conocidas, la intersección sale correcta, NO se filtra lo que
//   solo tiene uno, el cable es opaco (puntos, no IDs), los escalares son efímeros (dos corridas = cable distinto) y
//   un punto basura no rompe nada.
// PARTE 2 (de punta a punta, 2 teléfonos por el canal E2E real): A y B se agregan por ID (internet), se siembran
//   contactos compartidos y propios en cada uno, se corre el PSI y AMBOS ven la misma intersección (y NO los no comunes).
// Uso: node psi.js <dir_build>
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
const sortJ = (a) => JSON.stringify((a || []).slice().sort());

(async () => {
  const r1 = new NostrRelay(), r2 = new NostrRelay({ authRequired: true });
  RELAYS = [await r1.start(), await r2.start()];
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', Object.assign({}, base, { wifi: 'casa' }));
  const nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', Object.assign({}, base, { wifi: 'oficina' }));
  [nA, nB].forEach((n) => { radio.add(n); n.load(); });
  const A = await boot('A', nA), B = await boot('B', nB);
  const idA = A.bi.localNexoId.toLowerCase(), idB = B.bi.localNexoId.toLowerCase();
  const r = { build: path.basename(buildDir) };

  // ---------- PARTE 1: criptografía PURA (determinista, sin red) ----------
  const psi = A.win.__nexoPsi;
  const Aset = ['nxaonly001', 'nxshared01', 'nxshared02', 'nxaonly002'];
  const Bset = ['nxbonly001', 'nxshared01', 'nxshared02', 'nxbonly002'];
  const want = ['nxshared01', 'nxshared02'];
  const sA = psi.newScalar(), sB = psi.newScalar();
  const p1 = psi.round1(Aset, sA);
  const p2 = psi.round2(p1.a, Bset, sB);
  const common = psi.round3(p2.ab, p2.bb, p1.aIds, sA);
  r.cripto_interseccion = sortJ(common) === sortJ(want);
  r.cripto_sin_no_comunes = common.indexOf('nxaonly001') < 0 && common.indexOf('nxaonly002') < 0 && common.every((id) => Aset.indexOf(id) >= 0);
  // Cable OPACO: lo que viaja son puntos (hex de 66), nunca los IDs en claro.
  r.cripto_cable_opaco = p1.a.concat(p2.bb).every((h) => /^[0-9a-f]{66}$/.test(h)) && !/nx[0-9a-z]{8}/.test(JSON.stringify(p1.a) + JSON.stringify(p2.bb));
  // Escalares EFÍMEROS: otra corrida da otro cable, misma intersección (no se puede correlacionar entre corridas).
  const sA2 = psi.newScalar(), sB2 = psi.newScalar();
  const q1 = psi.round1(Aset, sA2), q2 = psi.round2(q1.a, Bset, sB2);
  const common2 = psi.round3(q2.ab, q2.bb, q1.aIds, sA2);
  r.cripto_efimero = sortJ(q1.a) !== sortJ(p1.a) && sortJ(common2) === sortJ(want);
  // ROBUSTO: un punto basura de la pareja no rompe (se ignora, hueco '').
  const pbad = psi.round2(['zz'].concat(p1.a), Bset, psi.newScalar());
  r.cripto_robusto = Array.isArray(pbad.ab) && pbad.ab[0] === '' && pbad.ab.length === p1.a.length + 1;

  // ---------- PARTE 2: de punta a punta por el canal E2E (2 teléfonos) ----------
  r.en_internet = await waitFor(() => A.bi.net && A.bi.net.online() && B.bi.net.online(), 20000);
  let sent = false;
  try { await A.bi.addByNexoId(idB); sent = true; } catch (e) { logs.push('[A] addByNexoId: ' + (e && e.message)); }
  r.solicitud = sent && await waitFor(() => B.bi.pendingRequests().some((x) => x.id === idA), 15000);
  if (r.solicitud) { try { await B.bi.acceptRequest(idA); } catch (e) { logs.push('[B] accept: ' + (e && e.message)); } }
  r.conectados = await waitFor(() => A.bi.net.canReach(idB) && B.bi.net.canReach(idA) && hasContact(A, idB) && hasContact(B, idA), 40000);

  // Sembrar agendas: 2 compartidos + 1 propio en cada uno. La intersección de las AGENDAS debe ser {shared01, shared02}
  // (cada uno es contacto del otro, pero no de sí mismo → idA/idB no cuentan como «en común»).
  ['nxshared01', 'nxshared02', 'nxaonly009'].forEach((id) => A.win.vaultGetOrCreateContact(id, id));
  ['nxshared01', 'nxshared02', 'nxbonly009'].forEach((id) => B.win.vaultGetOrCreateContact(id, id));

  // Correr el PSI (como al abrir la ficha estando en línea). Forzamos desde A; ambos deben terminar con el mismo resultado.
  A.win.__nexoPsiEnsure(idB, true);
  r.A_calcula = await waitFor(() => { const c = A.win.__nexoGetCommon(idB); return c && c.length === 2; }, 40000);
  r.B_calcula = await waitFor(() => { const c = B.win.__nexoGetCommon(idA); return c && c.length === 2; }, 20000);
  const cA = A.win.__nexoGetCommon(idB) || [], cB = B.win.__nexoGetCommon(idA) || [];
  r.A_interseccion = sortJ(cA) === sortJ(['nxshared01', 'nxshared02']);
  r.B_interseccion = sortJ(cB) === sortJ(['nxshared01', 'nxshared02']);
  // NO se cuela lo no común ni cada uno a sí mismo / al otro.
  r.sin_fuga = cA.indexOf('nxaonly009') < 0 && cA.indexOf('nxbonly009') < 0 && cA.indexOf(idA) < 0 && cA.indexOf(idB) < 0 &&
    cB.indexOf('nxaonly009') < 0 && cB.indexOf('nxbonly009') < 0 && cB.indexOf(idA) < 0 && cB.indexOf(idB) < 0;

  r.errores = logs.filter((l) => / error: /.test(l) && !/JSDOMERROR|styles\.css|Not implemented/.test(l)).slice(0, 5);
  const ok = r.cripto_interseccion && r.cripto_sin_no_comunes && r.cripto_cable_opaco && r.cripto_efimero && r.cripto_robusto &&
    r.en_internet && r.solicitud && r.conectados && r.A_calcula && r.B_calcula && r.A_interseccion && r.B_interseccion && r.sin_fuga && !r.errores.length;
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('PSI ' + JSON.stringify(r));
  if (!ok) console.log(logs.slice(-50).join('\n'));
  fs.writeFileSync(path.join(__dirname, 'last_logs_psi.txt'), logs.join('\n'));
  try { await r1.stop(); await r2.stop(); } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('PSI {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); console.log(logs.slice(-40).join('\n')); fs.writeFileSync(path.join(__dirname, 'last_logs_psi.txt'), logs.join('\n')); process.exit(1); });
